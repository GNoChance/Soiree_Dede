-- =============================================================================
-- JEU « nom-de-code » (Nom de Code, inspiré de Codenames) — idempotent (create or replace).
-- Dépend de schema.sql (_normalize_word, game_action, start_match, finish_match).
-- Conception : docs/superpowers/specs/2026-11-19-nom-de-code-design.md.
--
-- 2 à 4 équipes (red, blue, green, yellow : ordre de jeu fixe), 2 joueurs min. par équipe,
-- un espion par équipe et par manche. Grille de 25 mots (5×5).
-- Phases : clue (l'espion de l'équipe active tape son indice) -> guess (l'équipe vote, la majorité
-- dévoile) -> clue de l'équipe suivante … -> round_end -> (manche suivante) … -> finished.
-- Secrets : la clé (couleur des 25 cases : équipe | 'neutral' | 'bomb') est dans server.key et,
-- pour les SEULS espions de la manche, dans match_secrets ({round, key}) ; les autres membres
-- reçoivent {round, key: null} à partir de la manche 2. La clé devient publique (state.key)
-- en fin de manche. Les joueurs du banc (p_players hors équipes) ne sont pas dans state.players :
-- ils regardent comme des spectateurs.
-- =============================================================================

-- Mélange d'un tableau jsonb.
create or replace function public._ndc_shuffle(p jsonb)
returns jsonb language sql volatile
set search_path = public, extensions
as $$ select coalesce(jsonb_agg(x order by random()), '[]'::jsonb) from jsonb_array_elements(coalesce(p, '[]'::jsonb)) x $$;

-- Échéance d'une phase selon le chrono choisi (null = Détendu).
create or replace function public._ndc_deadline(p_timer text, p_phase text)
returns jsonb language sql stable
set search_path = public, extensions
as $$
  select case
    when p_timer = 'normal' then to_jsonb(now() + make_interval(secs => case when p_phase = 'clue' then 120 else 180 end))
    when p_timer = 'fast'   then to_jsonb(now() + make_interval(secs => case when p_phase = 'clue' then 60 else 120 end))
    else 'null'::jsonb end
$$;

-- Espions de la dernière partie de Nom de Code terminée depuis moins de 12 h qui partage
-- au moins 2 joueurs avec p_players (pour ne pas les reprendre tout de suite).
create or replace function public._ndc_recent_spies(p_players uuid[])
returns uuid[] language sql stable security definer
set search_path = public, extensions
as $$
  select coalesce(array(
    select (t->>'spy')::uuid
      from (select m.state
              from public.matches m
             where m.game_id = 'nom-de-code' and m.status = 'finished'
               and m.finished_at > now() - interval '12 hours'
               and (select count(*) from jsonb_array_elements_text(
                      case when jsonb_typeof(m.state->'players') = 'array' then m.state->'players' else '[]'::jsonb end) x
                     where x::uuid = any(p_players)) >= 2
             order by m.finished_at desc
             limit 1) last,
           jsonb_array_elements(case when jsonb_typeof(last.state->'teams') = 'array' then last.state->'teams' else '[]'::jsonb end) t
     where t->>'spy' is not null), '{}'::uuid[])
$$;

-- Prépare la manche p_round : grille, clé, équipe qui commence, espions. Renvoie {state, server, secrets}.
-- Manche 1 : secrets des seuls espions ; manches suivantes : tous les membres ({round, key|null}).
create or replace function public._ndc_setup_round(p_state jsonb, p_server jsonb, p_round integer)
returns jsonb language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  v_teams   jsonb := p_state->'teams';
  v_n       integer := jsonb_array_length(p_state->'teams');
  v_counts  integer[];
  v_neutral integer;
  v_start   integer := floor(random() * jsonb_array_length(p_state->'teams'))::integer;  -- index 0-based
  v_cells   jsonb := '[]'::jsonb;
  v_key     jsonb;
  v_new     jsonb := '[]'::jsonb;
  v_t       jsonb;
  v_i       integer;
  v_total   integer;
  v_order   jsonb;
  v_spy     text;
  v_secrets jsonb := '{}'::jsonb;
  v_zero    jsonb := '{}'::jsonb;
  v_m       text;
begin
  v_counts := case v_n when 2 then array[9, 8] when 3 then array[7, 6, 6] else array[6, 5, 5, 5] end;
  v_neutral := case v_n when 2 then 7 when 3 then 5 else 3 end;
  for v_i in 0 .. v_n - 1 loop
    v_t := v_teams->v_i;
    -- l'équipe qui commence prend le premier (plus grand) nombre, les suivantes dans l'ordre de jeu
    v_total := v_counts[((v_i - v_start + v_n) % v_n) + 1];
    select v_cells || coalesce(jsonb_agg(v_t->'id'), '[]'::jsonb) into v_cells from generate_series(1, v_total);
    v_order := p_server->'spy_order'->(v_t->>'id');
    v_spy := v_order->>((p_round - 1) % jsonb_array_length(v_order));
    v_new := v_new || jsonb_build_array(jsonb_build_object(
      'id', v_t->'id', 'players', v_t->'players', 'spy', v_spy, 'found', 0, 'total', v_total, 'eliminated', false));
    v_zero := v_zero || jsonb_build_object(v_t->>'id', 0);
  end loop;
  select v_cells || coalesce(jsonb_agg(to_jsonb('neutral'::text)), '[]'::jsonb) into v_cells from generate_series(1, v_neutral);
  v_cells := v_cells || jsonb_build_array('bomb');
  v_key := public._ndc_shuffle(v_cells);

  for v_i in 0 .. v_n - 1 loop
    v_t := v_new->v_i;
    for v_m in select jsonb_array_elements_text(v_t->'players') loop
      if v_m = v_t->>'spy' then
        v_secrets := v_secrets || jsonb_build_object(v_m, jsonb_build_object('round', p_round, 'key', v_key));
      elsif p_round > 1 then
        v_secrets := v_secrets || jsonb_build_object(v_m, jsonb_build_object('round', p_round, 'key', null));
      end if;
    end loop;
  end loop;

  p_state := p_state || jsonb_build_object(
    'phase', 'clue', 'round', p_round,
    'words', (select jsonb_agg(w order by o) from jsonb_array_elements(p_server->'words_all') with ordinality t(w, o)
               where o > (p_round - 1) * 25 and o <= p_round * 25),
    'teams', v_new, 'turn', v_new->v_start->'id',
    'revealed', '{}'::jsonb, 'clue', null, 'guesses_left', 0, 'votes', '{}'::jsonb, 'stop', '[]'::jsonb,
    'turn_found', 0, 'round_winner', null, 'round_end_reason', null, 'key', null,
    'deadline', public._ndc_deadline(p_state->>'timer', 'clue'));
  p_server := p_server || jsonb_build_object('key', v_key, 'first', '{}'::jsonb, 'team_err', v_zero, 'max_deficit', v_zero);
  return jsonb_build_object('state', p_state, 'server', p_server, 'secrets', v_secrets);
end $$;

create or replace function public.game_nom_de_code_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  v_in      jsonb := p_options->'teams';
  v_colors  text[] := array['red', 'blue', 'green', 'yellow'];
  v_c       text;
  v_k       text;
  v_members jsonb;
  v_teams   jsonb := '[]'::jsonb;
  v_players jsonb := '[]'::jsonb;
  v_seen    text[] := '{}';
  v_m       text;
  v_rounds  text := case when p_options->>'rounds' = 'each' then 'each' else 'one' end;
  v_timer   text := case when p_options->>'timer' in ('relaxed', 'normal', 'fast') then p_options->>'timer' else 'normal' end;
  v_total   integer;
  v_words   jsonb;
  v_g       integer;
  v_recent  uuid[];
  v_order   jsonb := '{}'::jsonb;
  v_stats   jsonb := '{}'::jsonb;
  v_wins    jsonb := '{}'::jsonb;
  v_bench   jsonb;
  v_t       jsonb;
begin
  if v_in is null or jsonb_typeof(v_in) <> 'object' then raise exception 'invalid_teams'; end if;
  for v_k in select jsonb_object_keys(v_in) loop
    if not (v_k = any(v_colors)) then raise exception 'invalid_teams'; end if;
  end loop;
  foreach v_c in array v_colors loop
    continue when not (v_in ? v_c);
    v_members := v_in->v_c;
    if jsonb_typeof(v_members) <> 'array' or jsonb_array_length(v_members) < 2 then raise exception 'invalid_teams'; end if;
    for v_m in select jsonb_array_elements_text(v_members) loop
      if v_m = any(v_seen) or not (v_m::uuid = any(p_players)) then raise exception 'invalid_teams'; end if;
      v_seen := v_seen || v_m;
    end loop;
    v_teams := v_teams || jsonb_build_array(jsonb_build_object('id', v_c, 'players', v_members));
    v_players := v_players || v_members;
    v_wins := v_wins || jsonb_build_object(v_c, 0);
  end loop;
  if jsonb_array_length(v_teams) not between 2 and 4 then raise exception 'invalid_teams'; end if;

  v_total := case when v_rounds = 'each'
                  then (select max(jsonb_array_length(t->'players')) from jsonb_array_elements(v_teams) t)
                  else 1 end;

  -- mots : au moins 25 par manche, non vides, sans doublon (normalisé) dans une même grille
  if jsonb_typeof(p_options->'words') <> 'array' or jsonb_array_length(p_options->'words') < 25 * v_total then
    raise exception 'invalid_action';
  end if;
  select jsonb_agg(to_jsonb(btrim(w)) order by o) into v_words
    from jsonb_array_elements_text(p_options->'words') with ordinality t(w, o) where o <= 25 * v_total;
  if exists (select 1 from jsonb_array_elements_text(v_words) w where w = '' or char_length(w) > 24) then
    raise exception 'invalid_action';
  end if;
  for v_g in 1 .. v_total loop
    if (select count(distinct public._normalize_word(w)) from jsonb_array_elements_text(v_words) with ordinality t(w, o)
         where o > (v_g - 1) * 25 and o <= v_g * 25) < 25 then
      raise exception 'invalid_action';
    end if;
  end loop;

  -- ordre de rotation des espions : mélangé, espions de la partie précédente en dernier
  v_recent := public._ndc_recent_spies(p_players);
  for v_t in select * from jsonb_array_elements(v_teams) loop
    v_order := v_order || jsonb_build_object(v_t->>'id',
      (select jsonb_agg(x order by ((x #>> '{}')::uuid = any(v_recent)), random()) from jsonb_array_elements(v_t->'players') x));
  end loop;
  for v_m in select jsonb_array_elements_text(v_players) loop
    v_stats := v_stats || jsonb_build_object(v_m, jsonb_build_object(
      'bomb_votes', 0, 'idle_clue', 0, 'enemy_reveals', 0, 'first_good', 0,
      'best_clue', 0, 'spy_wins', 0, 'flawless', 0, 'comeback', 0));
  end loop;
  select coalesce(jsonb_agg(to_jsonb(p) order by o), '[]'::jsonb) into v_bench
    from unnest(p_players) with ordinality t(p, o) where not (p::text = any(v_seen));

  return public._ndc_setup_round(
    jsonb_build_object('players', v_players, 'bench', v_bench, 'rounds', v_rounds, 'timer', v_timer,
                       'total_rounds', v_total, 'round_wins', v_wins, 'teams', v_teams),
    jsonb_build_object('spy_order', v_order, 'words_all', v_words, 'stats', v_stats),
    1);
end $$;

revoke all on function public._ndc_shuffle(jsonb) from public, anon, authenticated;
revoke all on function public._ndc_deadline(text, text) from public, anon, authenticated;
revoke all on function public._ndc_recent_spies(uuid[]) from public, anon, authenticated;
revoke all on function public._ndc_setup_round(jsonb, jsonb, integer) from public, anon, authenticated;
revoke all on function public.game_nom_de_code_start(uuid[], jsonb) from public, anon, authenticated;
