-- =============================================================================
-- JEU « tu-preferes » (Tu préfères ? multi-écrans) — idempotent (create or replace).
-- Dépend de schema.sql (game_action, start_match, finish_match).
--
-- Chaque manche : un dilemme « A ou B ? ». Chaque joueur envoie DEUX choix secrets :
-- son propre choix (`choice`) et son pari sur le choix de la majorité (`bet`).
-- Les réponses restent dans `server.answers` (privé) jusqu'à la révélation ; le state
-- public n'expose que `answered` (qui a répondu). Le joueur retrouve SA réponse dans
-- match_secrets ({round, choice, bet}) après un rechargement.
--
-- Phases : answering -> reveal -> (answering …) -> finished.
-- Révélation : quand tous ont répondu, à l'échéance (`deadline` + {"type":"tick"}),
-- ou forcée par l'hôte ({"type":"reveal"}).
--
-- Points (calculés sur les joueurs ayant répondu) :
--   * +1 si le pari = le choix majoritaire. Égalité parfaite (ou personne n'a
--     répondu) : PAS de majorité, personne ne marque le point de pari.
--   * Rebelle (+1 si p_options.rebel, défaut true) : le SEUL joueur de son camp
--     alors que l'autre camp compte au moins 2 joueurs (donc ≥ 3 réponses ; une
--     égalité 1 contre 1 ne fait pas de rebelle). Le statut est toujours compté
--     dans les stats, le point seulement si l'option est active.
-- Gagnant(s) = max de points (ex-aequo inclus), personne si tout le monde a 0.
-- =============================================================================

-- Ouvre la manche p_round (1-based) : dilemme public, réponses vidées, échéance.
create or replace function public._tp_open_round(p_state jsonb, p_server jsonb, p_round integer)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
begin
  p_state := p_state || jsonb_build_object(
    'phase', 'answering',
    'round', p_round,
    'dilemma', p_server->'dilemmas'->(p_round - 1),
    'answered', '[]'::jsonb,
    'deadline', to_jsonb(now() + make_interval(secs => (p_state->>'timer')::integer)));
  p_server := jsonb_set(p_server, '{answers}', '{}'::jsonb);
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

create or replace function public.game_tu_preferes_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_d      jsonb := p_options->'dilemmas';
  v_rounds integer;
  v_timer  integer;
  v_rebel  boolean;
  v_zero   jsonb;
  v_stats  jsonb;
  v_state  jsonb;
  v_server jsonb;
begin
  if cardinality(p_players) < 2 then raise exception 'not_enough_players'; end if;
  if cardinality(p_players) > 9 then raise exception 'too_many_players'; end if;
  if v_d is null or jsonb_typeof(v_d) <> 'array' or jsonb_array_length(v_d) = 0 then
    raise exception 'missing_dilemmas';
  end if;
  if exists (select 1 from jsonb_array_elements(v_d) e
              where jsonb_typeof(e) <> 'object'
                 or jsonb_typeof(e->'a') is distinct from 'string'
                 or jsonb_typeof(e->'b') is distinct from 'string'
                 or char_length(btrim(e->>'a')) = 0 or char_length(btrim(e->>'b')) = 0
                 or char_length(e->>'a') > 200 or char_length(e->>'b') > 200) then
    raise exception 'invalid_dilemmas';
  end if;

  begin
    v_rounds := coalesce(nullif(p_options->>'rounds', '')::integer, 15);
  exception when others then v_rounds := 15;
  end;
  v_rounds := least(greatest(v_rounds, 1), 50, jsonb_array_length(v_d));

  begin
    v_timer := coalesce(nullif(p_options->>'timer', '')::integer, 30);
  exception when others then v_timer := 30;
  end;
  v_timer := least(greatest(v_timer, 10), 120);

  v_rebel := coalesce(p_options->'rebel', 'true'::jsonb) <> 'false'::jsonb;

  select jsonb_agg(jsonb_build_object(
           'id', left(coalesce(nullif(e->>'id', ''), 'd' || o), 40),
           'a', btrim(e->>'a'),
           'b', btrim(e->>'b'),
           'theme', case when jsonb_typeof(e->'theme') = 'string' then left(e->>'theme', 30) end)
         order by o)
    into v_d
    from jsonb_array_elements(v_d) with ordinality as t(e, o) where o <= v_rounds;

  select jsonb_object_agg(p::text, 0),
         jsonb_object_agg(p::text, jsonb_build_object('bets_ok', 0, 'rebel', 0, 'norm', 0, 'answered', 0))
    into v_zero, v_stats
    from unnest(p_players) p;

  v_state := jsonb_build_object(
    'game', 'tu-preferes',
    'phase', 'answering',
    'round', 1,
    'total_rounds', v_rounds,
    'timer', v_timer,
    'rebel_bonus', v_rebel,
    'deadline', null,
    'dilemma', null,
    'players', to_jsonb(p_players),
    'answered', '[]'::jsonb,
    'scores', v_zero,
    'stats', v_stats,
    'last_reveal', null,
    'history', '[]'::jsonb,
    'winners', null,
    'results', null);
  v_server := jsonb_build_object('dilemmas', v_d, 'answers', '{}'::jsonb);

  return public._tp_open_round(v_state, v_server, 1) || jsonb_build_object('secrets', '{}'::jsonb);
end $$;

-- Révélation de la manche en cours : choix publics, majorité, points.
create or replace function public._tp_reveal(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_ans     jsonb := coalesce(p_server->'answers', '{}'::jsonb);
  v_choices jsonb := '{}'::jsonb;
  v_bets    jsonb := '{}'::jsonb;
  v_ca      integer := 0;
  v_cb      integer := 0;
  v_maj     text;
  v_min     text;
  v_rebel   text;
  v_ok      text[] := '{}';
  v_rebels  text[] := '{}';
  v_gains   jsonb := '{}'::jsonb;
  v_scores  jsonb := p_state->'scores';
  v_stats   jsonb := p_state->'stats';
  v_bonus   boolean := coalesce((p_state->>'rebel_bonus')::boolean, true);
  v_pl      text;
  v_choice  text;
  v_bet     text;
  v_g       integer;
  v_st      jsonb;
begin
  -- Ordre stable = ordre des joueurs.
  for v_pl in select pl from jsonb_array_elements_text(p_state->'players') with ordinality as t(pl, o) order by o loop
    if v_ans ? v_pl then
      v_choices := v_choices || jsonb_build_object(v_pl, v_ans->v_pl->>'choice');
      v_bets    := v_bets    || jsonb_build_object(v_pl, v_ans->v_pl->>'bet');
      if v_ans->v_pl->>'choice' = 'a' then v_ca := v_ca + 1; else v_cb := v_cb + 1; end if;
    end if;
  end loop;

  v_maj := case when v_ca > v_cb then 'a' when v_cb > v_ca then 'b' end;
  v_min := case v_maj when 'a' then 'b' when 'b' then 'a' end;
  -- Rebelle : seul de son camp face à au moins 2 joueurs.
  if v_maj is not null and least(v_ca, v_cb) = 1 and greatest(v_ca, v_cb) >= 2 then
    select key into v_rebel from jsonb_each_text(v_choices) where value = v_min;
    v_rebels := array[v_rebel];
  end if;

  for v_pl in select pl from jsonb_array_elements_text(p_state->'players') with ordinality as t(pl, o) order by o loop
    v_g := 0;
    v_st := coalesce(v_stats->v_pl, jsonb_build_object('bets_ok', 0, 'rebel', 0, 'norm', 0, 'answered', 0));
    if v_choices ? v_pl then
      v_choice := v_choices->>v_pl;
      v_bet    := v_bets->>v_pl;
      v_st := jsonb_set(v_st, '{answered}', to_jsonb((v_st->>'answered')::integer + 1));
      if v_maj is not null and v_bet = v_maj then
        v_g := v_g + 1;
        v_ok := v_ok || v_pl;
        v_st := jsonb_set(v_st, '{bets_ok}', to_jsonb((v_st->>'bets_ok')::integer + 1));
      end if;
      if v_maj is not null and v_choice = v_maj then
        v_st := jsonb_set(v_st, '{norm}', to_jsonb((v_st->>'norm')::integer + 1));
      end if;
      if v_pl = any(v_rebels) then
        if v_bonus then v_g := v_g + 1; end if;
        v_st := jsonb_set(v_st, '{rebel}', to_jsonb((v_st->>'rebel')::integer + 1));
      end if;
    end if;
    v_gains  := v_gains || jsonb_build_object(v_pl, v_g);
    v_scores := jsonb_set(v_scores, array[v_pl], to_jsonb(coalesce((v_scores->>v_pl)::integer, 0) + v_g), true);
    v_stats  := jsonb_set(v_stats, array[v_pl], v_st, true);
  end loop;

  p_state := p_state || jsonb_build_object(
    'phase', 'reveal',
    'deadline', null,
    'scores', v_scores,
    'stats', v_stats,
    'last_reveal', jsonb_build_object(
        'round', p_state->'round', 'dilemma', p_state->'dilemma',
        'choices', v_choices, 'bets', v_bets,
        'counts', jsonb_build_object('a', v_ca, 'b', v_cb),
        'majority', v_maj,
        'bettors_ok', to_jsonb(v_ok), 'rebels', to_jsonb(v_rebels),
        'gains', v_gains),
    'history', coalesce(p_state->'history', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'round', p_state->'round', 'dilemma', p_state->'dilemma',
        'counts', jsonb_build_object('a', v_ca, 'b', v_cb),
        'majority', v_maj, 'rebels', to_jsonb(v_rebels))));

  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

create or replace function public._tp_finish(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_max     integer;
  v_results jsonb;
  v_winners jsonb;
begin
  select coalesce(max(value::integer), 0) into v_max from jsonb_each_text(p_state->'scores');

  select jsonb_agg(jsonb_build_object(
           'profile_id', t.key,
           'points', t.value::integer,
           'won', v_max > 0 and t.value::integer = v_max,
           'placement', t.r,
           'stats', coalesce(p_state->'stats'->t.key, '{}'::jsonb))
         order by t.r, t.key)
    into v_results
    from (select key, value, rank() over (order by value::integer desc) as r
            from jsonb_each_text(p_state->'scores')) t;

  select coalesce(jsonb_agg(key order by key), '[]'::jsonb) into v_winners
    from jsonb_each_text(p_state->'scores') where v_max > 0 and value::integer = v_max;

  p_state := p_state || jsonb_build_object('phase', 'finished', 'deadline', null,
                                           'winners', v_winners, 'results', v_results);
  return jsonb_build_object('state', p_state, 'server', p_server, 'results', v_results);
end $$;

create or replace function public.game_tu_preferes_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_type     text := p_action->>'type';
  v_phase    text := p_state->>'phase';
  v_round    integer := (p_state->>'round')::integer;
  v_total    integer := (p_state->>'total_rounds')::integer;
  v_deadline timestamptz := nullif(p_state->>'deadline', '')::timestamptz;
  v_choice   text;
  v_bet      text;
  v_answered jsonb;
  v_res      jsonb;
begin
  if v_type = 'tick' then
    -- Idempotent : ignoré sans erreur si trop tôt ou hors phase de réponse.
    if v_phase <> 'answering' or v_deadline is null or now() < v_deadline then
      return jsonb_build_object('state', p_state, 'server', p_server);
    end if;
    return public._tp_reveal(p_state, p_server);

  elsif v_type = 'answer' then
    if v_phase <> 'answering' then raise exception 'wrong_phase'; end if;
    if p_action ? 'round' and (p_action->>'round') is distinct from v_round::text then
      raise exception 'wrong_phase';
    end if;
    if not (p_state->'players' ? p_actor::text) then raise exception 'not_a_player'; end if;
    v_choice := p_action->>'choice';
    v_bet    := p_action->>'bet';
    if jsonb_typeof(p_action->'choice') is distinct from 'string' or v_choice not in ('a', 'b')
       or jsonb_typeof(p_action->'bet') is distinct from 'string' or v_bet not in ('a', 'b') then
      raise exception 'invalid_choice';
    end if;

    p_server := jsonb_set(p_server, array['answers', p_actor::text],
                          jsonb_build_object('choice', v_choice, 'bet', v_bet), true);
    select coalesce(jsonb_agg(pl order by o), '[]'::jsonb) into v_answered
      from jsonb_array_elements_text(p_state->'players') with ordinality as t(pl, o)
     where (p_server->'answers') ? pl;
    p_state := jsonb_set(p_state, '{answered}', v_answered);

    -- Tout le monde a répondu, ou réponse arrivée après l'échéance : on révèle.
    if jsonb_array_length(v_answered) >= jsonb_array_length(p_state->'players')
       or (v_deadline is not null and now() >= v_deadline) then
      v_res := public._tp_reveal(p_state, p_server);
    else
      v_res := jsonb_build_object('state', p_state, 'server', p_server);
    end if;
    return v_res || jsonb_build_object('secrets', jsonb_build_object(
      p_actor::text, jsonb_build_object('round', v_round, 'choice', v_choice, 'bet', v_bet)));

  elsif v_type = 'reveal' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase <> 'answering' then raise exception 'wrong_phase'; end if;
    return public._tp_reveal(p_state, p_server);

  elsif v_type = 'next' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase <> 'reveal' then raise exception 'wrong_phase'; end if;
    if v_round >= v_total then
      return public._tp_finish(p_state, p_server);
    end if;
    return public._tp_open_round(p_state, p_server, v_round + 1);

  else
    raise exception 'unknown_action';
  end if;
end $$;

revoke all on function public._tp_open_round(jsonb, jsonb, integer) from public, anon, authenticated;
revoke all on function public._tp_reveal(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._tp_finish(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.game_tu_preferes_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_tu_preferes_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;
