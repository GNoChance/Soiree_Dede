-- =============================================================================
-- JEU « action-ou-verite » (Action ou vérité multi-écrans) — idempotent.
-- Dépend de schema.sql (game_action, start_match, finish_match).
--
-- Un tour :
--   1. choose  : la ROUE (animation front, tirage serveur) désigne `target` ;
--                il choisit {"type":"choose","kind":"action"|"verite"}.
--                Échéance (`deadline` = fin de roue + 15 s) → choix aléatoire.
--   2. vote    : les AUTRES joueurs reçoivent 3 `proposals` du type choisi (tirées
--                dans le lot passé à start_match, sans répétition dans la partie)
--                et votent {"type":"vote_card","index":0..2}. Votes secrets
--                (`server.card_votes`) ; public : `voted`. Dépouillement quand tous
--                ont voté ou à l'échéance (30 s). Égalité → tirage parmi les
--                ex-aequo ; aucun vote → tirage parmi les 3.
--   3. perform : `card` (gagnante) publique, `card_vote` = détail du dépouillement.
--                Le désigné la réalise (`timer_until` = minuteur doux de 60 s pour
--                une action si soft_timer, jamais imposé). Les autres jugent
--                {"type":"vote_result","success":true|false} (secret jusqu'au
--                dépouillement, public : `validated`). Majorité stricte de 👍
--                (up > down) → +1 point. Le désigné peut {"type":"refuse"} →
--                gage tiré au sort, 0 point. Échéance dure 150 s.
--   4. result  : `last_result`. {"type":"next"} (hôte) → tour suivant ou fin ;
--                si `auto`, échéance 12 s puis tick.
-- {"type":"next"} (hôte) fait aussi avancer les autres phases (choose → type
-- aléatoire, vote/perform → dépouillement avec les votes reçus).
-- {"type":"stop"} (hôte, toute phase) → fin de partie avec les scores actuels
-- (le tour en cours est abandonné). Indispensable si total_rounds = 0 (illimité).
-- {"type":"tick"} : n'importe qui, ignoré sans erreur avant l'échéance.
--
-- Roue : on ne désigne jamais le même joueur 2 fois de suite, et on tire parmi
-- les joueurs qui ont eu le MOINS de passages (`turns`).
-- Gagnant(s) = max de points (ex-aequo), personne si tout le monde a 0.
-- =============================================================================

-- Constantes (secondes).
create or replace function public._aov_const(p_key text)
returns integer language sql immutable
set search_path = public, extensions
as $$
  select case p_key
    when 'spin' then 6        -- durée de l'animation de roue
    when 'choose' then 15     -- temps pour choisir action/vérité (après la roue)
    when 'vote' then 30       -- vote des propositions
    when 'perform' then 150   -- réalisation + jugement (échéance dure)
    when 'soft' then 60       -- minuteur doux d'une action
    when 'reveal' then 4      -- animation de révélation de la carte (avant le minuteur doux)
    when 'auto' then 12       -- passage automatique au tour suivant
  end
$$;

-- Incrémente stats[pl][key].
create or replace function public._aov_bump(p_stats jsonb, p_pl text, p_key text, p_n integer default 1)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select jsonb_set(p_stats, array[p_pl, p_key],
                   to_jsonb(coalesce((p_stats->p_pl->>p_key)::integer, 0) + p_n), true)
$$;

-- Joueurs votants du tour (tous sauf le désigné), dans l'ordre des joueurs.
create or replace function public._aov_voters(p_state jsonb)
returns text[] language sql immutable
set search_path = public, extensions
as $$
  select coalesce(array_agg(pl order by o), '{}')
    from jsonb_array_elements_text(p_state->'players') with ordinality as t(pl, o)
   where pl is distinct from p_state->>'target'
$$;

-- Ouvre le tour p_round : tirage du désigné (roue), phase choose.
create or replace function public._aov_open_round(p_state jsonb, p_server jsonb, p_round integer)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_last   text := p_server->>'last_target';
  v_n      integer := jsonb_array_length(p_state->'players');
  v_target text;
  v_until  timestamptz := now() + make_interval(secs => public._aov_const('spin'));
begin
  with t as (
    select pl, coalesce((p_state->'turns'->>pl)::integer, 0) as n
      from jsonb_array_elements_text(p_state->'players') pl
     where v_n < 2 or pl is distinct from v_last
  )
  select pl into v_target from t where n = (select min(n) from t) order by random() limit 1;

  p_state := p_state || jsonb_build_object(
    'phase', 'choose',
    'round', p_round,
    'target', v_target,
    'kind', null,
    'kind_random', false,
    'spin', jsonb_build_object(
        'round', p_round,
        'target', v_target,
        'turns', 4 + floor(random() * 3)::integer,       -- tours complets (4 à 6)
        'offset', round((0.18 + random() * 0.64)::numeric, 3), -- position dans la part (0..1)
        'until', v_until),
    'deadline', v_until + make_interval(secs => public._aov_const('choose')),
    'timer_until', null,
    'proposals', '[]'::jsonb,
    'voted', '[]'::jsonb,
    'card', null,
    'card_vote', null,
    'validated', '[]'::jsonb,
    'turns', jsonb_set(p_state->'turns', array[v_target],
                       to_jsonb(coalesce((p_state->'turns'->>v_target)::integer, 0) + 1), true),
    'stats', public._aov_bump(p_state->'stats', v_target, 'turns'));
  p_server := p_server || jsonb_build_object('last_target', v_target,
                                             'card_votes', '{}'::jsonb, 'result_votes', '{}'::jsonb);
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Type choisi (ou tiré au sort) : 3 propositions, phase vote.
create or replace function public._aov_set_kind(p_state jsonb, p_server jsonb, p_kind text, p_random boolean)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_used  jsonb := coalesce(p_server->'used', '[]'::jsonb);
  v_props jsonb;
  v_t     text := p_state->>'target';
begin
  -- Priorité aux cartes jamais proposées dans la partie ; on recycle si le lot est épuisé.
  select coalesce(jsonb_agg(c), '[]'::jsonb) into v_props
    from (select c from jsonb_array_elements(p_server->'pool') c
           where c->>'kind' = p_kind
           order by (v_used ? (c->>'id')), random()
           limit 3) x;

  select coalesce(jsonb_agg(distinct u), '[]'::jsonb) into v_used
    from (select jsonb_array_elements_text(v_used) u
          union select e->>'id' from jsonb_array_elements(v_props) e) z;

  p_state := p_state || jsonb_build_object(
    'phase', 'vote',
    'kind', p_kind,
    'kind_random', p_random,
    'proposals', v_props,
    'voted', '[]'::jsonb,
    'deadline', now() + make_interval(secs => public._aov_const('vote')),
    'stats', public._aov_bump(p_state->'stats', v_t,
                              case p_kind when 'action' then 'actions' else 'verites' end));
  p_server := p_server || jsonb_build_object('used', v_used, 'card_votes', '{}'::jsonb);
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Dépouillement des votes de cartes : carte gagnante, phase perform.
create or replace function public._aov_tally_cards(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_votes  jsonb := coalesce(p_server->'card_votes', '{}'::jsonb);
  v_n      integer := jsonb_array_length(p_state->'proposals');
  v_counts jsonb;
  v_max    integer;
  v_tied   jsonb;
  v_win    integer;
  v_soft   boolean := coalesce((p_state->>'soft_timer')::boolean, true);
begin
  select jsonb_agg((select count(*) from jsonb_each_text(v_votes) where value::integer = i)::integer order by i)
    into v_counts from generate_series(0, v_n - 1) i;
  v_counts := coalesce(v_counts, '[]'::jsonb);
  select max(value::integer) into v_max from jsonb_array_elements_text(v_counts);
  select jsonb_agg((o - 1)::integer order by o) into v_tied
    from jsonb_array_elements_text(v_counts) with ordinality t(value, o) where value::integer = v_max;
  select value::integer into v_win from jsonb_array_elements_text(v_tied) order by random() limit 1;

  p_state := p_state || jsonb_build_object(
    'phase', 'perform',
    'card', (p_state->'proposals'->v_win) || jsonb_build_object('kind', p_state->>'kind'),
    'card_vote', jsonb_build_object(
        'votes', v_votes,
        'counts', v_counts,
        'winner', v_win,
        'tied', case when jsonb_array_length(v_tied) > 1 then v_tied else '[]'::jsonb end,
        'random', jsonb_array_length(v_tied) > 1),
    'validated', '[]'::jsonb,
    'deadline', now() + make_interval(secs => public._aov_const('perform')),
    'timer_until', case when v_soft and p_state->>'kind' = 'action'
                        then to_jsonb(now() + make_interval(secs => public._aov_const('reveal') + public._aov_const('soft')))
                        else 'null'::jsonb end);
  p_server := p_server || jsonb_build_object('result_votes', '{}'::jsonb);
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Fin du tour : outcome 'success' | 'fail' | 'refused', phase result.
create or replace function public._aov_close_round(p_state jsonb, p_server jsonb, p_refused boolean)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_votes   jsonb := case when p_refused then '{}'::jsonb else coalesce(p_server->'result_votes', '{}'::jsonb) end;
  v_t       text := p_state->>'target';
  v_up      integer;
  v_down    integer;
  v_outcome text;
  v_points  integer := 0;
  v_gage    text;
  v_stats   jsonb := p_state->'stats';
  v_auto    boolean := coalesce((p_state->>'auto')::boolean, false);
  r         record;
begin
  select count(*) filter (where value = 'true'), count(*) filter (where value = 'false')
    into v_up, v_down from jsonb_each_text(v_votes);

  if p_refused then
    v_outcome := 'refused';
    select g into v_gage from jsonb_array_elements_text(coalesce(p_server->'gages', '[]'::jsonb)) g
     order by random() limit 1;
    v_gage := coalesce(v_gage, 'Fais ta plus belle révérence en disant « Pardon, ô grand public ! »');
    v_stats := public._aov_bump(v_stats, v_t, 'refusals');
  elsif v_up > v_down then
    v_outcome := 'success';
    v_points := 1;
    v_stats := public._aov_bump(v_stats, v_t, 'success');
    -- Ovation : défi réussi à l'unanimité (3 votants min.) ; Même pas peur : carte de niveau 3 réussie
    if v_down = 0 and v_up >= 3 then v_stats := public._aov_bump(v_stats, v_t, 'unanimous'); end if;
    if p_state->'card'->>'level' = '3' then v_stats := public._aov_bump(v_stats, v_t, 'hard_success'); end if;
  else
    v_outcome := 'fail';
    v_stats := public._aov_bump(v_stats, v_t, 'fails');
  end if;

  for r in select key, value from jsonb_each_text(v_votes) loop
    v_stats := public._aov_bump(v_stats, r.key, case when r.value = 'true' then 'thumbs_up' else 'thumbs_down' end);
  end loop;

  p_state := p_state || jsonb_build_object(
    'phase', 'result',
    'deadline', case when v_auto then to_jsonb(now() + make_interval(secs => public._aov_const('auto'))) else 'null'::jsonb end,
    'timer_until', null,
    'scores', jsonb_set(p_state->'scores', array[v_t],
                        to_jsonb(coalesce((p_state->'scores'->>v_t)::integer, 0) + v_points), true),
    'stats', v_stats,
    'last_result', jsonb_build_object(
        'round', p_state->'round',
        'target', v_t,
        'kind', p_state->'kind',
        'card', p_state->'card',
        'outcome', v_outcome,
        'up', v_up, 'down', v_down,
        'votes', v_votes,
        'gage', v_gage,
        'points', v_points),
    'history', coalesce(p_state->'history', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'round', p_state->'round', 'target', v_t, 'kind', p_state->'kind',
        'text', p_state->'card'->>'text', 'outcome', v_outcome, 'gage', v_gage)));
  p_server := p_server || jsonb_build_object('result_votes', '{}'::jsonb, 'card_votes', '{}'::jsonb);
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Stats de fin de partie pour les trophées (features/trophees.sql) : s'ajoutent à state.stats[pl].
create or replace function public._aov_tstats(p_stats jsonb)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select jsonb_build_object('perfect',
    case when coalesce((p_stats->>'turns')::integer, 0) >= 5
          and coalesce((p_stats->>'success')::integer, 0) = coalesce((p_stats->>'turns')::integer, 0) then 1 else 0 end)
$$;

create or replace function public._aov_finish(p_state jsonb, p_server jsonb)
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
           'stats', coalesce(p_state->'stats'->t.key, '{}'::jsonb) || public._aov_tstats(p_state->'stats'->t.key))
         order by t.r, t.key)
    into v_results
    from (select key, value, rank() over (order by value::integer desc) as r
            from jsonb_each_text(p_state->'scores')) t;

  select coalesce(jsonb_agg(key order by key), '[]'::jsonb) into v_winners
    from jsonb_each_text(p_state->'scores') where v_max > 0 and value::integer = v_max;

  p_state := p_state || jsonb_build_object('phase', 'finished', 'deadline', null, 'timer_until', null,
                                           'winners', v_winners, 'results', v_results);
  return jsonb_build_object('state', p_state, 'server', p_server, 'results', v_results);
end $$;

create or replace function public.game_action_ou_verite_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_cards  jsonb := p_options->'cards';
  v_levels jsonb;
  v_rounds integer;
  v_gages  jsonb;
  v_zero   jsonb;
  v_stats  jsonb;
  v_state  jsonb;
  v_server jsonb;
begin
  if cardinality(p_players) < 3 then raise exception 'not_enough_players'; end if;
  if cardinality(p_players) > 9 then raise exception 'too_many_players'; end if;
  if v_cards is null or jsonb_typeof(v_cards) <> 'array' or jsonb_array_length(v_cards) = 0 then
    raise exception 'not_enough_cards';
  end if;
  if jsonb_array_length(v_cards) > 1000 or exists (
       select 1 from jsonb_array_elements(v_cards) e
        where jsonb_typeof(e) <> 'object'
           or (e->>'kind') is null or (e->>'kind') not in ('action', 'verite')
           or jsonb_typeof(e->'text') is distinct from 'string'
           or char_length(btrim(e->>'text')) = 0 or char_length(e->>'text') > 400
           or (e ? 'level' and (jsonb_typeof(e->'level') <> 'number' or (e->>'level') not in ('1', '2', '3')))) then
    raise exception 'invalid_cards';
  end if;

  -- Niveaux (1 soft, 2 fun, 3 osé tout public) ; vide / invalide = tous.
  select coalesce(jsonb_agg(distinct (x::integer) order by (x::integer)), '[]'::jsonb) into v_levels
    from jsonb_array_elements_text(case when jsonb_typeof(p_options->'levels') = 'array'
                                        then p_options->'levels' else '[]'::jsonb end) x
   where x in ('1', '2', '3');
  if jsonb_array_length(v_levels) = 0 then v_levels := '[1,2,3]'::jsonb; end if;

  -- Lot normalisé, filtré sur les niveaux.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', left(coalesce(nullif(e->>'id', ''), 'c' || o), 40),
           'kind', e->>'kind',
           'level', coalesce((e->>'level')::integer, 1),
           'text', btrim(e->>'text')) order by o), '[]'::jsonb)
    into v_cards
    from jsonb_array_elements(v_cards) with ordinality as t(e, o)
   where v_levels @> to_jsonb(coalesce((e->>'level')::integer, 1));
  if (select count(*) from jsonb_array_elements(v_cards) c where c->>'kind' = 'action') < 3
     or (select count(*) from jsonb_array_elements(v_cards) c where c->>'kind' = 'verite') < 3 then
    raise exception 'not_enough_cards';
  end if;

  -- Tours : 0 = illimité (jusqu'à ce que l'hôte arrête).
  begin
    v_rounds := coalesce(nullif(p_options->>'rounds', '')::integer, 10);
  exception when others then v_rounds := 10;
  end;
  v_rounds := least(greatest(v_rounds, 0), 100);

  select coalesce(jsonb_agg(left(btrim(g), 200)), '[]'::jsonb) into v_gages
    from jsonb_array_elements_text(case when jsonb_typeof(p_options->'gages') = 'array'
                                        then p_options->'gages' else '[]'::jsonb end) g
   where char_length(btrim(g)) > 0;

  select jsonb_object_agg(p::text, 0),
         jsonb_object_agg(p::text, jsonb_build_object('turns', 0, 'actions', 0, 'verites', 0, 'success', 0,
                                                      'fails', 0, 'refusals', 0, 'thumbs_up', 0, 'thumbs_down', 0))
    into v_zero, v_stats
    from unnest(p_players) p;

  v_state := jsonb_build_object(
    'game', 'action-ou-verite',
    'phase', 'choose',
    'round', 1,
    'total_rounds', v_rounds,
    'levels', v_levels,
    'soft_timer', coalesce(p_options->'soft_timer', 'true'::jsonb) <> 'false'::jsonb,
    'auto', coalesce(p_options->'auto', 'false'::jsonb) = 'true'::jsonb,
    'players', to_jsonb(p_players),
    'turns', v_zero,
    'scores', v_zero,
    'stats', v_stats,
    'last_result', null,
    'history', '[]'::jsonb,
    'winners', null,
    'results', null);
  v_server := jsonb_build_object('pool', v_cards, 'used', '[]'::jsonb, 'gages', v_gages,
                                 'last_target', null, 'card_votes', '{}'::jsonb, 'result_votes', '{}'::jsonb);

  return public._aov_open_round(v_state, v_server, 1) || jsonb_build_object('secrets', '{}'::jsonb);
end $$;

-- Fait avancer la phase en cours (échéance atteinte ou hôte).
create or replace function public._aov_advance(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_phase text := p_state->>'phase';
  v_round integer := (p_state->>'round')::integer;
  v_total integer := coalesce((p_state->>'total_rounds')::integer, 0);
begin
  if v_phase = 'choose' then
    return public._aov_set_kind(p_state, p_server, case when random() < 0.5 then 'action' else 'verite' end, true);
  elsif v_phase = 'vote' then
    return public._aov_tally_cards(p_state, p_server);
  elsif v_phase = 'perform' then
    return public._aov_close_round(p_state, p_server, false);
  elsif v_phase = 'result' then
    if v_total > 0 and v_round >= v_total then
      return public._aov_finish(p_state, p_server);
    end if;
    return public._aov_open_round(p_state, p_server, v_round + 1);
  end if;
  raise exception 'wrong_phase';
end $$;

create or replace function public.game_action_ou_verite_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_type     text := p_action->>'type';
  v_phase    text := p_state->>'phase';
  v_me       text := p_actor::text;
  v_target   text := p_state->>'target';
  v_deadline timestamptz := nullif(p_state->>'deadline', '')::timestamptz;
  v_voters   text[] := public._aov_voters(p_state);
  v_idx      integer;
  v_done     jsonb;
begin
  if v_type = 'tick' then
    if v_phase not in ('choose', 'vote', 'perform', 'result') or v_deadline is null or now() < v_deadline then
      return jsonb_build_object('state', p_state, 'server', p_server);
    end if;
    return public._aov_advance(p_state, p_server);

  elsif v_type = 'choose' then
    if v_phase <> 'choose' then raise exception 'wrong_phase'; end if;
    if v_me is distinct from v_target then raise exception 'not_your_turn'; end if;
    if jsonb_typeof(p_action->'kind') is distinct from 'string' or (p_action->>'kind') not in ('action', 'verite') then
      raise exception 'invalid_choice';
    end if;
    return public._aov_set_kind(p_state, p_server, p_action->>'kind', false);

  elsif v_type = 'vote_card' then
    if v_phase <> 'vote' then raise exception 'wrong_phase'; end if;
    if not (p_state->'players' ? v_me) then raise exception 'not_a_player'; end if;
    if v_me = v_target then raise exception 'target_cannot_vote'; end if;
    if jsonb_typeof(p_action->'index') is distinct from 'number' then raise exception 'invalid_choice'; end if;
    begin
      v_idx := (p_action->>'index')::integer;
    exception when others then raise exception 'invalid_choice';
    end;
    if v_idx < 0 or v_idx >= jsonb_array_length(p_state->'proposals') then raise exception 'invalid_choice'; end if;

    p_server := jsonb_set(p_server, array['card_votes', v_me], to_jsonb(v_idx), true);
    select coalesce(jsonb_agg(v order by array_position(v_voters, v)), '[]'::jsonb) into v_done
      from unnest(v_voters) v where (p_server->'card_votes') ? v;
    p_state := jsonb_set(p_state, '{voted}', v_done);
    if jsonb_array_length(v_done) >= cardinality(v_voters)
       or (v_deadline is not null and now() >= v_deadline) then
      return public._aov_tally_cards(p_state, p_server);
    end if;
    return jsonb_build_object('state', p_state, 'server', p_server);

  elsif v_type = 'vote_result' then
    if v_phase <> 'perform' then raise exception 'wrong_phase'; end if;
    if not (p_state->'players' ? v_me) then raise exception 'not_a_player'; end if;
    if v_me = v_target then raise exception 'target_cannot_vote'; end if;
    if jsonb_typeof(p_action->'success') is distinct from 'boolean' then raise exception 'invalid_choice'; end if;

    p_server := jsonb_set(p_server, array['result_votes', v_me], p_action->'success', true);
    select coalesce(jsonb_agg(v order by array_position(v_voters, v)), '[]'::jsonb) into v_done
      from unnest(v_voters) v where (p_server->'result_votes') ? v;
    p_state := jsonb_set(p_state, '{validated}', v_done);
    if jsonb_array_length(v_done) >= cardinality(v_voters)
       or (v_deadline is not null and now() >= v_deadline) then
      return public._aov_close_round(p_state, p_server, false);
    end if;
    return jsonb_build_object('state', p_state, 'server', p_server);

  elsif v_type = 'refuse' then
    if v_phase <> 'perform' then raise exception 'wrong_phase'; end if;
    if v_me is distinct from v_target then raise exception 'not_your_turn'; end if;
    return public._aov_close_round(p_state, p_server, true);

  elsif v_type = 'next' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase not in ('choose', 'vote', 'perform', 'result') then raise exception 'wrong_phase'; end if;
    -- Garde-fou double clic : next depuis result exige le bon numéro de tour s'il est fourni.
    if p_action ? 'round' and (p_action->>'round') is distinct from (p_state->>'round') then
      raise exception 'wrong_phase';
    end if;
    return public._aov_advance(p_state, p_server);

  elsif v_type = 'stop' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase not in ('choose', 'vote', 'perform', 'result') then raise exception 'wrong_phase'; end if;
    return public._aov_finish(p_state, p_server);

  else
    raise exception 'unknown_action';
  end if;
end $$;

revoke all on function public._aov_const(text) from public, anon, authenticated;
revoke all on function public._aov_bump(jsonb, text, text, integer) from public, anon, authenticated;
revoke all on function public._aov_voters(jsonb) from public, anon, authenticated;
revoke all on function public._aov_open_round(jsonb, jsonb, integer) from public, anon, authenticated;
revoke all on function public._aov_set_kind(jsonb, jsonb, text, boolean) from public, anon, authenticated;
revoke all on function public._aov_tally_cards(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._aov_close_round(jsonb, jsonb, boolean) from public, anon, authenticated;
revoke all on function public._aov_finish(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._aov_tstats(jsonb) from public, anon, authenticated;
revoke all on function public._aov_advance(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.game_action_ou_verite_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_action_ou_verite_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;
