-- MORCEAU 5 / 5 — -- GÉNÉRÉ par scripts/build-sql.mjs — ne pas éditer. Idempotent. À exécuter dans l'ordre (1, puis 2…) dans Supabase > SQL Editor > Run.

-- ===== games\nom-de-code.sql =====
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
    jsonb_build_object('game', 'nom-de-code', 'players', v_players, 'bench', v_bench, 'rounds', v_rounds, 'timer', v_timer,
                       'total_rounds', v_total, 'round_wins', v_wins, 'teams', v_teams),
    jsonb_build_object('spy_order', v_order, 'words_all', v_words, 'stats', v_stats),
    1);
end $$;

-- Ajoute p_delta au compteur p_key du joueur p_pid (server.stats).
create or replace function public._ndc_bump(p_server jsonb, p_pid text, p_key text, p_delta integer)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select case when p_server->'stats' ? p_pid
    then jsonb_set(p_server, array['stats', p_pid, p_key],
                   to_jsonb(coalesce((p_server->'stats'->p_pid->>p_key)::integer, 0) + p_delta))
    else p_server end
$$;

-- best_clue (max) de l'espion de l'équipe active = mots de son équipe trouvés avec son indice.
create or replace function public._ndc_best_clue(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_spy text := (select t->>'spy' from jsonb_array_elements(p_state->'teams') t where t->>'id' = p_state->>'turn');
  v_n   integer := coalesce((p_state->>'turn_found')::integer, 0);
begin
  if v_spy is null or not ((p_server->'stats') ? v_spy) then return p_server; end if;
  return jsonb_set(p_server, array['stats', v_spy, 'best_clue'],
                   to_jsonb(greatest(coalesce((p_server->'stats'->v_spy->>'best_clue')::integer, 0), v_n)));
end $$;

-- Fin de partie : équipes au maximum de manches gagnées = gagnantes ; un résultat par membre d'équipe.
create or replace function public._ndc_finish(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_results jsonb;
begin
  with t as (
    select x->>'id' as id, x->'players' as players,
           coalesce((p_state->'round_wins'->>(x->>'id'))::integer, 0) as wins
      from jsonb_array_elements(p_state->'teams') x
  ), r as (
    select t.*, dense_rank() over (order by wins desc) as rk, max(wins) over () as best from t
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'profile_id', m, 'points', r.wins, 'won', r.wins = r.best, 'placement', r.rk,
           'stats', coalesce(p_server->'stats'->m, '{}'::jsonb))), '[]'::jsonb)
    into v_results
    from r, jsonb_array_elements_text(r.players) m;
  -- results aussi dans le state public : l'écran de résultats commun lit state.results
  p_state := p_state || jsonb_build_object('phase', 'finished', 'results', v_results, 'winners',
    (select jsonb_agg(x->>'id') from jsonb_array_elements(p_state->'teams') x
      where coalesce((p_state->'round_wins'->>(x->>'id'))::integer, 0)
          = (select max(coalesce((p_state->'round_wins'->>(y->>'id'))::integer, 0)) from jsonb_array_elements(p_state->'teams') y)));
  return jsonb_build_object('state', p_state, 'server', p_server, 'results', v_results);
end $$;

-- Fin de manche : victoire de p_winner (raison : words | bomb | last_team), clé rendue publique.
create or replace function public._ndc_end_round(p_state jsonb, p_server jsonb, p_winner text, p_reason text)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_win jsonb;
  v_m   text;
begin
  -- best_clue de l'espion actif si la manche s'arrête pendant ses devinettes
  p_server := public._ndc_best_clue(p_state, p_server);
  select t into v_win from jsonb_array_elements(p_state->'teams') t where t->>'id' = p_winner;
  p_server := public._ndc_bump(p_server, v_win->>'spy', 'spy_wins', 1);
  for v_m in select jsonb_array_elements_text(v_win->'players') loop
    if coalesce((p_server->'team_err'->>p_winner)::integer, 0) = 0 then p_server := public._ndc_bump(p_server, v_m, 'flawless', 1); end if;
    if coalesce((p_server->'max_deficit'->>p_winner)::integer, 0) >= 3 then p_server := public._ndc_bump(p_server, v_m, 'comeback', 1); end if;
  end loop;
  p_state := p_state || jsonb_build_object(
    'phase', 'round_end', 'round_winner', p_winner, 'round_end_reason', p_reason,
    'round_wins', (p_state->'round_wins') || jsonb_build_object(p_winner, coalesce((p_state->'round_wins'->>p_winner)::integer, 0) + 1),
    'key', p_server->'key', 'deadline', null, 'votes', '{}'::jsonb, 'stop', '[]'::jsonb);
  if (p_state->>'round')::integer >= (p_state->>'total_rounds')::integer then
    return public._ndc_finish(p_state, p_server);
  end if;
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Fin du tour : l'équipe suivante non éliminée (ordre des équipes, circulaire) passe à l'indice.
create or replace function public._ndc_end_turn(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_n    integer := jsonb_array_length(p_state->'teams');
  v_cur  integer;
  v_i    integer;
  v_next text := p_state->>'turn';
begin
  select o - 1 into v_cur from jsonb_array_elements(p_state->'teams') with ordinality t(x, o) where x->>'id' = p_state->>'turn';
  p_server := public._ndc_best_clue(p_state, p_server);
  for v_i in 1 .. v_n loop
    if not coalesce((p_state->'teams'->((v_cur + v_i) % v_n)->>'eliminated')::boolean, false) then
      v_next := p_state->'teams'->((v_cur + v_i) % v_n)->>'id';
      exit;
    end if;
  end loop;
  p_state := p_state || jsonb_build_object(
    'turn', v_next, 'phase', 'clue', 'clue', null, 'votes', '{}'::jsonb, 'stop', '[]'::jsonb,
    'guesses_left', 0, 'turn_found', 0, 'deadline', public._ndc_deadline(p_state->>'timer', 'clue'));
  p_server := p_server || jsonb_build_object('first', '{}'::jsonb);
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Dévoile la case p_idx pour l'équipe active, puis applique ses effets (manche gagnée, fin du tour…).
create or replace function public._ndc_reveal(p_state jsonb, p_server jsonb, p_idx integer)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_c      text := p_server->'key'->>p_idx;
  v_turn   text := p_state->>'turn';
  v_voters text[];
  v_v      text;
  v_first  text := p_server->'first'->>p_idx::text;
  v_teams  jsonb;
  v_owner  jsonb;
  v_alive  jsonb;
begin
  select coalesce(array_agg(key), '{}') into v_voters from jsonb_each_text(p_state->'votes') where value = p_idx::text;
  foreach v_v in array v_voters loop
    if v_c = 'bomb' then p_server := public._ndc_bump(p_server, v_v, 'bomb_votes', 1);
    elsif v_c not in ('neutral', 'bomb') and v_c <> v_turn then p_server := public._ndc_bump(p_server, v_v, 'enemy_reveals', 1);
    end if;
  end loop;
  if v_c = v_turn and v_first is not null then p_server := public._ndc_bump(p_server, v_first, 'first_good', 1); end if;

  select jsonb_agg(case
           when t->>'id' = v_c and v_c = v_turn then t || jsonb_build_object('found', (t->>'found')::integer + 1)
           when t->>'id' = v_c then t || jsonb_build_object('found', (t->>'found')::integer + 1)
           when v_c = 'bomb' and t->>'id' = v_turn then t || jsonb_build_object('eliminated', true)
           else t end order by o)
    into v_teams from jsonb_array_elements(p_state->'teams') with ordinality x(t, o);
  p_state := p_state || jsonb_build_object(
    'teams', v_teams,
    'revealed', (p_state->'revealed') || jsonb_build_object(p_idx::text, jsonb_build_object('color', v_c, 'by', v_turn)),
    'votes', '{}'::jsonb, 'stop', '[]'::jsonb);
  p_server := p_server || jsonb_build_object('first', '{}'::jsonb);
  if v_c = v_turn then
    p_state := p_state || jsonb_build_object('turn_found', (p_state->>'turn_found')::integer + 1,
                                             'guesses_left', (p_state->>'guesses_left')::integer - 1);
  else
    p_server := jsonb_set(p_server, array['team_err', v_turn], to_jsonb(coalesce((p_server->'team_err'->>v_turn)::integer, 0) + 1));
  end if;

  -- retard : (mots restants de l'équipe) − (mots restants de l'équipe en jeu la plus avancée)
  select p_server || jsonb_build_object('max_deficit', coalesce(p_server->'max_deficit', '{}'::jsonb) || coalesce(jsonb_object_agg(
           d.id, greatest(coalesce((p_server->'max_deficit'->>d.id)::integer, 0), d.rem - d.best)), '{}'::jsonb))
    into p_server
    from (select t->>'id' as id, (t->>'total')::integer - (t->>'found')::integer as rem,
                 min((t->>'total')::integer - (t->>'found')::integer) over () as best
            from jsonb_array_elements(v_teams) t where not (t->>'eliminated')::boolean) d;

  -- (a) l'équipe propriétaire du mot (non éliminée) a tout trouvé → elle gagne
  select t into v_owner from jsonb_array_elements(v_teams) t where t->>'id' = v_c;
  if v_owner is not null and not (v_owner->>'eliminated')::boolean
     and (v_owner->>'found')::integer >= (v_owner->>'total')::integer then
    return public._ndc_end_round(p_state, p_server, v_c, 'words');
  end if;
  -- (b) une seule équipe encore en jeu → elle gagne
  select jsonb_agg(t) into v_alive from jsonb_array_elements(v_teams) t where not (t->>'eliminated')::boolean;
  if jsonb_array_length(v_alive) = 1 then
    return public._ndc_end_round(p_state, p_server, v_alive->0->>'id',
                                 case when jsonb_array_length(v_teams) = 2 then 'bomb' else 'last_team' end);
  end if;
  -- (c)/(d) bombe, neutre, mot adverse ou plus d'essais → fin du tour
  if v_c <> v_turn or (p_state->>'guesses_left')::integer <= 0 then
    return public._ndc_end_turn(p_state, p_server);
  end if;
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

create or replace function public.game_nom_de_code_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_type  text := p_action->>'type';
  v_phase text := p_state->>'phase';
  v_me    text := p_actor::text;
  v_team  jsonb;
  v_spy   text;
  v_guess boolean;
  v_need  integer;
  v_word  text;
  v_n     numeric;
  v_idx   integer;
  v_cnt   integer;
  v_stop  jsonb;
  v_unchanged jsonb := jsonb_build_object('state', p_state, 'server', p_server);
begin
  select t into v_team from jsonb_array_elements(p_state->'teams') t where t->>'id' = p_state->>'turn';
  v_spy := v_team->>'spy';
  v_guess := coalesce((v_team->'players') ? v_me, false) and v_me is distinct from v_spy;
  v_need := (jsonb_array_length(coalesce(v_team->'players', '[]'::jsonb)) - 1) / 2 + 1;

  -- ---------------------------------------------------------------- clue
  if v_type = 'clue' then
    if v_phase <> 'clue' then raise exception 'wrong_phase'; end if;
    if v_me is distinct from v_spy then raise exception 'not_spy'; end if;
    v_word := btrim(coalesce(p_action->>'word', ''));
    v_n := case when jsonb_typeof(p_action->'n') = 'number' then (p_action->>'n')::numeric end;
    if v_word = '' or v_word ~ '\s' or char_length(v_word) > 24 or public._normalize_word(v_word) = ''
       or v_n is null or v_n <> trunc(v_n) or v_n < 1 or v_n > 9 then
      raise exception 'invalid_clue';
    end if;
    if exists (select 1 from jsonb_array_elements_text(p_state->'words') with ordinality t(w, o)
                where not ((p_state->'revealed') ? (o - 1)::text)
                  and public._normalize_word(w) = public._normalize_word(v_word)) then
      raise exception 'clue_is_grid_word';
    end if;
    p_state := p_state || jsonb_build_object(
      'clue', jsonb_build_object('word', v_word, 'n', v_n::integer), 'guesses_left', v_n::integer + 1,
      'turn_found', 0, 'votes', '{}'::jsonb, 'stop', '[]'::jsonb, 'phase', 'guess',
      'deadline', public._ndc_deadline(p_state->>'timer', 'guess'));
    return jsonb_build_object('state', p_state, 'server', p_server || jsonb_build_object('first', '{}'::jsonb));

  -- ---------------------------------------------------------------- vote
  elsif v_type = 'vote' then
    -- carte déjà dévoilée (vote simultané, y compris celui qui a fini le tour) : ignoré sans erreur
    if jsonb_typeof(p_action->'index') = 'number' and (p_state->'revealed') ? (p_action->>'index') then
      return v_unchanged;
    end if;
    if v_phase <> 'guess' then raise exception 'wrong_phase'; end if;
    if not v_guess then raise exception 'not_guesser'; end if;
    if p_action->'index' is null or jsonb_typeof(p_action->'index') = 'null' then
      return jsonb_build_object('state', p_state || jsonb_build_object('votes', (p_state->'votes') - v_me), 'server', p_server);
    end if;
    if jsonb_typeof(p_action->'index') <> 'number' then raise exception 'invalid_action'; end if;
    v_idx := (p_action->>'index')::integer;
    if v_idx < 0 or v_idx > 24 then raise exception 'invalid_action'; end if;
    p_state := p_state || jsonb_build_object('votes', (p_state->'votes') || jsonb_build_object(v_me, v_idx));
    if not ((p_server->'first') ? v_idx::text) then
      p_server := p_server || jsonb_build_object('first', coalesce(p_server->'first', '{}'::jsonb) || jsonb_build_object(v_idx::text, v_me));
    end if;
    select count(*) into v_cnt from jsonb_each_text(p_state->'votes') where value = v_idx::text;
    if v_cnt >= v_need then return public._ndc_reveal(p_state, p_server, v_idx); end if;
    return jsonb_build_object('state', p_state, 'server', p_server);

  -- ---------------------------------------------------------------- stop
  elsif v_type = 'stop' then
    -- stop tardif (le tour vient de finir) : ignoré sans erreur
    if v_phase <> 'guess' then return v_unchanged; end if;
    if not v_guess then raise exception 'not_guesser'; end if;
    if (p_state->>'turn_found')::integer = 0 then raise exception 'stop_too_early'; end if;
    if (p_state->'stop') ? v_me then
      v_stop := (p_state->'stop') - v_me;
    else
      v_stop := (p_state->'stop') || jsonb_build_array(v_me);
    end if;
    p_state := p_state || jsonb_build_object('stop', v_stop);
    if jsonb_array_length(v_stop) >= v_need then return public._ndc_end_turn(p_state, p_server); end if;
    return jsonb_build_object('state', p_state, 'server', p_server);

  -- ---------------------------------------------------------------- tick
  elsif v_type = 'tick' then
    if v_phase in ('clue', 'guess') and jsonb_typeof(p_state->'deadline') = 'string'
       and now() >= (p_state->>'deadline')::timestamptz then
      if v_phase = 'clue' then p_server := public._ndc_bump(p_server, v_spy, 'idle_clue', 1); end if;
      return public._ndc_end_turn(p_state, p_server);
    end if;
    return v_unchanged;

  -- ---------------------------------------------------------------- next_round (hôte)
  elsif v_type = 'next_round' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase <> 'round_end' or (p_state->>'round')::integer >= (p_state->>'total_rounds')::integer then
      raise exception 'wrong_phase';
    end if;
    return public._ndc_setup_round(p_state, p_server, (p_state->>'round')::integer + 1);

  -- ---------------------------------------------------------------- skip (hôte)
  elsif v_type = 'skip' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase not in ('clue', 'guess') then raise exception 'wrong_phase'; end if;
    return public._ndc_end_turn(p_state, p_server);

  else
    raise exception 'unknown_action';
  end if;
end $$;

revoke all on function public._ndc_bump(jsonb, text, text, integer) from public, anon, authenticated;
revoke all on function public._ndc_end_round(jsonb, jsonb, text, text) from public, anon, authenticated;
revoke all on function public._ndc_best_clue(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._ndc_finish(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._ndc_end_turn(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._ndc_reveal(jsonb, jsonb, integer) from public, anon, authenticated;
revoke all on function public.game_nom_de_code_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;
revoke all on function public._ndc_shuffle(jsonb) from public, anon, authenticated;
revoke all on function public._ndc_deadline(text, text) from public, anon, authenticated;
revoke all on function public._ndc_recent_spies(uuid[]) from public, anon, authenticated;
revoke all on function public._ndc_setup_round(jsonb, jsonb, integer) from public, anon, authenticated;
revoke all on function public.game_nom_de_code_start(uuid[], jsonb) from public, anon, authenticated;


-- ===== games\pas-de-bol.sql =====
-- =============================================================================
-- JEU « Pas de bol ! » (id pas-de-bol) — jeu de défausse inspiré du 8 américain
-- Idempotent (create or replace). Dispatché par start_match / game_action.
--
-- Cartes (jsonb) : {"id":"tomate-5-1","color":"tomate","kind":"num","value":5}
--   kind : num | plus2 | reverse | skip | wild | wild4 | perso ("perso":"<slug>")
--   color : tomate | soleil | menthe | ciel (absent pour wild / wild4 / perso)
-- server : {deck:[cartes], discard:[cartes sous la carte du dessus],
--           hands:{uid:[cartes]}, drawn:{player,id}|null}
-- secret d'un joueur : {hand:[cartes], drawn:id|null, v:int, peek?:{...}}
-- Contrat complet (state public, secrets, actions) : src/games/pas-de-bol/types.ts.
-- =============================================================================

create or replace function public._pdb_card(p_id text, p_color text, p_kind text,
                                            p_value integer default null, p_perso text default null)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select jsonb_strip_nulls(jsonb_build_object('id', p_id, 'color', p_color, 'kind', p_kind,
                                              'value', p_value, 'perso', p_perso));
$$;

-- Paquet complet (non mélangé). 108 cartes classiques + 9 cartes perso en mode « persos ».
create or replace function public._pdb_deck(p_persos boolean)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v  jsonb := '[]'::jsonb;
  c  text;
  s  text;
  n  integer;
  k  integer;
begin
  foreach c in array array['tomate', 'soleil', 'menthe', 'ciel'] loop
    v := v || jsonb_build_array(public._pdb_card(c || '-0', c, 'num', 0));
    for n in 1 .. 9 loop
      for k in 1 .. 2 loop
        v := v || jsonb_build_array(public._pdb_card(format('%s-%s-%s', c, n, k), c, 'num', n));
      end loop;
    end loop;
    for k in 1 .. 2 loop
      v := v || jsonb_build_array(
        public._pdb_card(format('%s-plus2-%s', c, k), c, 'plus2'),
        public._pdb_card(format('%s-reverse-%s', c, k), c, 'reverse'),
        public._pdb_card(format('%s-skip-%s', c, k), c, 'skip'));
    end loop;
  end loop;
  for k in 1 .. 4 loop
    v := v || jsonb_build_array(public._pdb_card('wild-' || k, null, 'wild'),
                                public._pdb_card('wild4-' || k, null, 'wild4'));
  end loop;
  if p_persos then
    foreach s in array array['kevin', 'cycy', 'dede', 'manon', 'mika', 'cecile', 'carole', 'marius', 'nini'] loop
      v := v || jsonb_build_array(public._pdb_card('perso-' || s, null, 'perso', null, s));
    end loop;
  end if;
  return v;
end $$;

create or replace function public._pdb_shuffle(p jsonb)
returns jsonb language sql volatile
set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(e order by random()), '[]'::jsonb) from jsonb_array_elements(p) as t(e);
$$;

create or replace function public._pdb_iso(p_ts timestamptz)
returns text language sql stable
set search_path = public, extensions
as $$
  select to_char(p_ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$$;

-- Joueur actif situé p_steps crans après p_from dans le sens du jeu (les joueurs
-- sortis sont sautés ; p_from peut lui-même être sorti).
create or replace function public._pdb_next(p_state jsonb, p_from text, p_steps integer)
returns text language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_order text[] := array(select jsonb_array_elements_text(p_state->'order'));
  v_n     integer := cardinality(v_order);
  v_dir   integer := coalesce((p_state->>'direction')::integer, 1);
  v_cur   integer := coalesce(array_position(v_order, p_from), 1);
  v_done  integer := 0;
  v_guard integer := 0;
begin
  if jsonb_array_length(coalesce(p_state->'active', '[]'::jsonb)) = 0 then return null; end if;
  loop
    v_cur := ((v_cur - 1 + v_dir) % v_n + v_n) % v_n + 1;
    if (p_state->'active') ? v_order[v_cur] then
      v_done := v_done + 1;
      if v_done >= greatest(p_steps, 1) then return v_order[v_cur]; end if;
    end if;
    v_guard := v_guard + 1;
    if v_guard > v_n * 4 then return null; end if;
  end loop;
end $$;

-- Début de tour. p_clear_open : le « Dernière carte ! » non annoncé de ce joueur
-- n'est plus dénonçable (son tour est revenu). Faux pour « Pause manette » (rejoue).
create or replace function public._pdb_start_turn(p_state jsonb, p_player text, p_clear_open boolean)
returns jsonb language plpgsql stable
set search_path = public, extensions
as $$
begin
  p_state := p_state || jsonb_build_object(
    'turn', p_player,
    'turn_phase', 'play',
    'turn_seq', coalesce((p_state->>'turn_seq')::integer, 0) + 1,
    'deadline', public._pdb_iso(now() + make_interval(secs => coalesce((p_state->>'turn_seconds')::integer, 30))));
  if p_clear_open and p_state->'last_card'->>p_player = 'open' then
    p_state := p_state #- array['last_card', p_player];
  end if;
  return p_state;
end $$;

-- Compteurs de trophées par joueur dans server.pstats (jamais dans le state public) :
-- ajoute p_n à p_key (ou prend le max si p_max).
create or replace function public._pdb_pst(p_server jsonb, p_pl text, p_key text, p_n numeric, p_max boolean default false)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_cur numeric := coalesce((p_server->'pstats'->p_pl->>p_key)::numeric, 0);
  v_new numeric := case when p_max then greatest(v_cur, p_n) else v_cur + p_n end;
begin
  return p_server || jsonb_build_object('pstats',
    coalesce(p_server->'pstats', '{}'::jsonb) || jsonb_build_object(p_pl,
      coalesce(p_server->'pstats'->p_pl, '{}'::jsonb) || jsonb_build_object(p_key, v_new)));
end $$;

-- Un cumul +2/+4 vient d'être pioché par p_player (p_count cartes) : plus gros tas, et les cartes
-- sont créditées (« infligées ») à ceux qui ont empilé (server.pend_src).
create or replace function public._pdb_cumul(p_server jsonb, p_player text, p_count integer)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  r record;
begin
  p_server := public._pdb_pst(p_server, p_player, 'big_draw', p_count, true);
  for r in select key, value::integer as n from jsonb_each_text(coalesce(p_server->'pend_src', '{}'::jsonb)) loop
    p_server := public._pdb_pst(p_server, r.key, 'inflicted', r.n);
  end loop;
  return p_server - 'pend_src';
end $$;

-- Met à jour le record de cartes en main de chaque joueur (appelé après chaque action et à la fin).
create or replace function public._pdb_track_hands(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  p text;
begin
  for p in select jsonb_array_elements_text(p_state->'players') loop
    p_server := public._pdb_pst(p_server, p, 'max_hand', coalesce((p_state->'counts'->>p)::integer, 0), true);
  end loop;
  return p_server;
end $$;

create or replace function public._pdb_log(p_state jsonb, p_entry jsonb)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_n   integer := coalesce((p_state->>'log_seq')::integer, 0) + 1;
  v_log jsonb := coalesce(p_state->'log', '[]'::jsonb);
  v_len integer := jsonb_array_length(v_log);
begin
  select coalesce(jsonb_agg(e order by o), '[]'::jsonb) into v_log
    from jsonb_array_elements(v_log) with ordinality as t(e, o)
   where o > v_len - 11;
  return p_state || jsonb_build_object('log', v_log || jsonb_build_array(p_entry || jsonb_build_object('n', v_n)),
                                       'log_seq', v_n);
end $$;

-- Fait piocher p_n cartes à p_player (pioche reconstituée avec la défausse si vide).
-- Renvoie {state, server, drawn:[cartes]}.
create or replace function public._pdb_draw(p_state jsonb, p_server jsonb, p_player text, p_n integer)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_hand  jsonb := coalesce(p_server->'hands'->p_player, '[]'::jsonb);
  v_drawn jsonb := '[]'::jsonb;
  v_card  jsonb;
  i       integer;
begin
  for i in 1 .. greatest(p_n, 0) loop
    if jsonb_array_length(p_server->'deck') = 0 then
      if jsonb_array_length(coalesce(p_server->'discard', '[]'::jsonb)) = 0 then exit; end if;
      p_server := p_server || jsonb_build_object('deck', public._pdb_shuffle(p_server->'discard'),
                                                 'discard', '[]'::jsonb);
      p_state := p_state || jsonb_build_object('reshuffles', coalesce((p_state->>'reshuffles')::integer, 0) + 1);
      p_state := public._pdb_log(p_state, jsonb_build_object('t', 'reshuffle'));
    end if;
    v_card := p_server->'deck'->0;
    p_server := jsonb_set(p_server, '{deck}', (p_server->'deck') - 0);
    v_hand := v_hand || jsonb_build_array(v_card);
    v_drawn := v_drawn || jsonb_build_array(v_card);
  end loop;
  p_server := jsonb_set(p_server, array['hands', p_player], v_hand, true);
  p_server := public._pdb_pst(p_server, p_player, 'drawn', jsonb_array_length(v_drawn));
  p_state := jsonb_set(p_state, array['counts', p_player], to_jsonb(jsonb_array_length(v_hand)), true);
  p_state := p_state || jsonb_build_object('draw_count', jsonb_array_length(p_server->'deck'));
  return jsonb_build_object('state', p_state, 'server', p_server, 'drawn', v_drawn);
end $$;

-- La carte peut-elle être posée sur la défausse (hors contrainte « carte piochée ») ?
create or replace function public._pdb_playable(p_state jsonb, p_card jsonb)
returns boolean language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_kind    text := p_card->>'kind';
  v_pending integer := coalesce((p_state->>'pending_draw')::integer, 0);
  v_top     jsonb := p_state->'top';
begin
  if v_pending > 0 then
    -- Cumul en attente : seulement surenchérir (+2 sur +2, +4 sur tout) ou la Capuche de Marius.
    return v_kind = 'wild4'
        or (v_kind = 'plus2' and p_state->>'pending_kind' = 'plus2')
        or (v_kind = 'perso' and p_card->>'perso' = 'marius');
  end if;
  if v_kind in ('wild', 'wild4', 'perso') then return true; end if;
  if p_card->>'color' = p_state->>'color' then return true; end if;
  if v_kind = 'num' then
    return v_top->>'kind' = 'num' and v_top->>'value' = p_card->>'value';
  end if;
  return v_top->>'kind' = v_kind;
end $$;

-- Fin de partie : ordre de sortie = classement, le dernier joueur avec des cartes perd.
-- won : les 3 premiers sortis s'il y a >= 5 joueurs, sinon seulement le 1er.
create or replace function public._pdb_finish(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql stable
set search_path = public, extensions
as $$
declare
  v_n       integer := jsonb_array_length(p_state->'players');
  v_ranked  text[] := array(select jsonb_array_elements_text(p_state->'out'))
                      || array(select jsonb_array_elements_text(p_state->'active'));
  v_results jsonb := '[]'::jsonb;
  v_hands   jsonb := '{}'::jsonb;
  v_ps      jsonb;
  i         integer;
begin
  p_server := public._pdb_track_hands(p_state, p_server);
  for i in 1 .. cardinality(v_ranked) loop
    v_ps := coalesce(p_server->'pstats'->v_ranked[i], '{}'::jsonb);
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'profile_id', v_ranked[i],
      'placement', i,
      'points', v_n - i,
      'won', (i = 1) or (v_n >= 5 and i <= 3),
      -- trophées (features/trophees.sql), cumulés dans server.pstats
      'stats', jsonb_build_object(
        'big_draw', coalesce((v_ps->>'big_draw')::integer, 0),
        'denounced', coalesce((v_ps->>'denounced')::integer, 0),
        'denounces', coalesce((v_ps->>'denounces')::integer, 0),
        'special_cards', coalesce((v_ps->>'specials')::integer, 0),
        'max_hand', coalesce((v_ps->>'max_hand')::integer, 0),
        'inflicted', coalesce((v_ps->>'inflicted')::integer, 0),
        'stacks', coalesce((v_ps->>'stacks')::integer, 0),
        -- Main propre : 1er sorti ayant pioché 2 cartes au plus ; Remontada : 1er sorti après 10+ cartes en main
        'clean_win', case when i = 1 and p_server->'pstats' is not null
                           and coalesce((v_ps->>'drawn')::integer, 0) <= 2 then 1 else 0 end,
        'comeback', case when i = 1 and coalesce((v_ps->>'max_hand')::integer, 0) >= 10 then 1 else 0 end)));
  end loop;
  -- Main du (des) perdant(s) révélée.
  select coalesce(jsonb_object_agg(a, coalesce(p_server->'hands'->a, '[]'::jsonb)), '{}'::jsonb) into v_hands
    from jsonb_array_elements_text(p_state->'active') as t(a);

  p_state := p_state || jsonb_build_object(
    'phase', 'finished',
    'deadline', null,
    'turn', null,
    'loser', p_state->'active'->>0,
    'final_hands', v_hands,
    'results', v_results);
  return jsonb_build_object('state', p_state, 'server', p_server, 'results', v_results);
end $$;

-- -----------------------------------------------------------------------------
-- Démarrage. Options : {"mode":"classique"|"persos"}
-- -----------------------------------------------------------------------------
create or replace function public.game_pas_de_bol_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_n       integer := cardinality(p_players);
  v_mode    text := case when coalesce(p_options->>'mode', '') = 'persos' then 'persos' else 'classique' end;
  v_deck    jsonb;
  v_order   text[];
  v_hands   jsonb := '{}'::jsonb;
  v_counts  jsonb := '{}'::jsonb;
  v_secrets jsonb := '{}'::jsonb;
  v_ver     jsonb := '{}'::jsonb;
  v_hand    jsonb;
  v_top     jsonb;
  v_idx     integer;
  v_state   jsonb;
  p         text;
begin
  if v_n < 2 then raise exception 'not_enough_players'; end if;
  if v_n > 9 then raise exception 'too_many_players'; end if;

  v_deck := public._pdb_shuffle(public._pdb_deck(v_mode = 'persos'));
  v_order := array(select x::text from unnest(p_players) as t(x) order by random());

  foreach p in array v_order loop
    select coalesce(jsonb_agg(e order by o), '[]'::jsonb) into v_hand
      from jsonb_array_elements(v_deck) with ordinality as t(e, o) where o <= 7;
    select coalesce(jsonb_agg(e order by o), '[]'::jsonb) into v_deck
      from jsonb_array_elements(v_deck) with ordinality as t(e, o) where o > 7;
    v_hands := v_hands || jsonb_build_object(p, v_hand);
    v_counts := v_counts || jsonb_build_object(p, 7);
    v_ver := v_ver || jsonb_build_object(p, 1);
    v_secrets := v_secrets || jsonb_build_object(p, jsonb_build_object('hand', v_hand, 'drawn', null, 'v', 1));
  end loop;

  -- Première carte de la défausse : le premier chiffre du paquet.
  select o - 1 into v_idx from jsonb_array_elements(v_deck) with ordinality as t(e, o)
   where e->>'kind' = 'num' order by o limit 1;
  v_top := v_deck->v_idx;
  v_deck := v_deck - v_idx;

  v_state := jsonb_build_object(
    'game', 'pas-de-bol',
    'phase', 'playing',
    'mode', v_mode,
    'players', to_jsonb(p_players),
    'order', to_jsonb(v_order),
    'active', to_jsonb(v_order),
    'out', '[]'::jsonb,
    'direction', 1,
    'color', v_top->>'color',
    'top', v_top,
    'pile', jsonb_build_array(v_top),
    'counts', v_counts,
    'hand_ver', v_ver,
    'draw_count', jsonb_array_length(v_deck),
    'pending_draw', 0,
    'pending_kind', null,
    'last_card', '{}'::jsonb,
    'turn_seconds', 30,
    'turn_seq', 0,
    'log', '[]'::jsonb,
    'log_seq', 0,
    'reshuffles', 0,
    'loser', null,
    'final_hands', null,
    'results', null);
  v_state := public._pdb_start_turn(v_state, v_order[1], true);
  -- 10 s de grâce pour le premier tour (le temps que tout le monde arrive).
  v_state := v_state || jsonb_build_object('deadline', public._pdb_iso(now() + interval '40 seconds'));

  return jsonb_build_object(
    'state', v_state,
    'server', jsonb_build_object('deck', v_deck, 'discard', '[]'::jsonb, 'hands', v_hands, 'drawn', null),
    'secrets', v_secrets);
end $$;

-- -----------------------------------------------------------------------------
-- Actions :
--   {"type":"play","card":"<id>","color"?:"tomate|soleil|menthe|ciel","target"?:"<uuid>","announce"?:bool}
--   {"type":"draw"}  {"type":"pass"}  {"type":"last_card"}  {"type":"denounce","target":"<uuid>"}
--   {"type":"tick"}
-- -----------------------------------------------------------------------------
create or replace function public.game_pas_de_bol_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_type     text := p_action->>'type';
  v_me       text := p_actor::text;
  v_old      jsonb := p_server;
  v_turn     text := p_state->>'turn';
  v_pending  integer := coalesce((p_state->>'pending_draw')::integer, 0);
  v_hand     jsonb;
  v_card     jsonb;
  v_idx      integer;
  v_kind     text;
  v_perso    text;
  v_color    text;
  v_target   text;
  v_r        jsonb;
  v_n        integer;
  v_skip     integer := 1;
  v_replay   boolean := false;
  v_reverse  boolean := false;
  v_peek     jsonb := null;
  v_entry    jsonb;
  v_act      text[];
  v_newh     jsonb;
  v_disc     jsonb;
  v_next     text;
  v_secrets  jsonb := '{}'::jsonb;
  v_sec      jsonb;
  v_od       text;
  v_sidx     integer;
  v_stolen   jsonb;
  v_nd       text;
  p          text;
  i          integer;
begin
  if p_state->>'phase' <> 'playing' then raise exception 'wrong_phase'; end if;

  -- ---------------------------------------------------------------- tick
  if v_type = 'tick' then
    if p_state->>'deadline' is null or now() < (p_state->>'deadline')::timestamptz then
      return jsonb_build_object('state', p_state, 'server', p_server);  -- trop tôt / déjà traité
    end if;
    if p_state->>'turn_phase' = 'drawn' then
      p_server := p_server || jsonb_build_object('drawn', null);
      p_state := public._pdb_log(p_state, jsonb_build_object('t', 'pass', 'p', v_turn, 'auto', true));
    else
      v_r := public._pdb_draw(p_state, p_server, v_turn, greatest(v_pending, 1));
      p_state := v_r->'state'; p_server := v_r->'server';
      p_state := public._pdb_log(p_state, jsonb_build_object(
        't', 'draw', 'p', v_turn, 'count', jsonb_array_length(v_r->'drawn'), 'auto', true, 'cumul', v_pending > 0));
      if v_pending > 0 then p_server := public._pdb_cumul(p_server, v_turn, jsonb_array_length(v_r->'drawn')); end if;
      p_state := p_state || jsonb_build_object('pending_draw', 0, 'pending_kind', null);
    end if;
    p_state := public._pdb_start_turn(p_state, public._pdb_next(p_state, v_turn, 1), true);

  -- ---------------------------------------------------------------- dernière carte !
  elsif v_type = 'last_card' then
    if p_state->'last_card'->>v_me is distinct from 'open' then raise exception 'wrong_phase'; end if;
    p_state := jsonb_set(p_state, array['last_card', v_me], '"safe"');
    p_state := public._pdb_log(p_state, jsonb_build_object('t', 'announce', 'p', v_me));

  -- ---------------------------------------------------------------- dénoncer
  elsif v_type = 'denounce' then
    v_target := p_action->>'target';
    if not ((p_state->'players') ? v_me) then raise exception 'not_a_player'; end if;
    if v_target is null or v_target = v_me then raise exception 'invalid_target'; end if;
    if p_state->'last_card'->>v_target is distinct from 'open' then raise exception 'wrong_phase'; end if;
    v_r := public._pdb_draw(p_state, p_server, v_target, 2);
    p_state := v_r->'state'; p_server := v_r->'server';
    p_state := p_state #- array['last_card', v_target];
    p_server := public._pdb_pst(public._pdb_pst(p_server, v_target, 'denounced', 1), v_me, 'denounces', 1);
    p_state := public._pdb_log(p_state, jsonb_build_object(
      't', 'denounce', 'p', v_me, 'target', v_target, 'count', jsonb_array_length(v_r->'drawn')));

  -- ---------------------------------------------------------------- piocher
  elsif v_type = 'draw' then
    if v_turn is distinct from v_me then raise exception 'not_your_turn'; end if;
    if p_state->>'turn_phase' <> 'play' then raise exception 'wrong_phase'; end if;
    if v_pending > 0 then
      v_r := public._pdb_draw(p_state, p_server, v_me, v_pending);
      p_state := v_r->'state'; p_server := v_r->'server';
      p_state := public._pdb_log(p_state, jsonb_build_object(
        't', 'draw', 'p', v_me, 'count', jsonb_array_length(v_r->'drawn'), 'cumul', true));
      p_server := public._pdb_cumul(p_server, v_me, jsonb_array_length(v_r->'drawn'));
      p_state := p_state || jsonb_build_object('pending_draw', 0, 'pending_kind', null);
      p_state := public._pdb_start_turn(p_state, public._pdb_next(p_state, v_me, 1), true);
    else
      v_r := public._pdb_draw(p_state, p_server, v_me, 1);
      p_state := v_r->'state'; p_server := v_r->'server';
      v_card := v_r->'drawn'->0;
      p_state := public._pdb_log(p_state, jsonb_build_object(
        't', 'draw', 'p', v_me, 'count', jsonb_array_length(v_r->'drawn')));
      if v_card is not null and public._pdb_playable(p_state, v_card) then
        -- La carte piochée est jouable : le joueur peut la poser (ou passer).
        p_server := p_server || jsonb_build_object('drawn', jsonb_build_object('player', v_me, 'id', v_card->>'id'));
        p_state := p_state || jsonb_build_object(
          'turn_phase', 'drawn',
          'deadline', public._pdb_iso(greatest((p_state->>'deadline')::timestamptz, now() + interval '10 seconds')));
      else
        p_state := public._pdb_start_turn(p_state, public._pdb_next(p_state, v_me, 1), true);
      end if;
    end if;

  -- ---------------------------------------------------------------- passer (après pioche)
  elsif v_type = 'pass' then
    if v_turn is distinct from v_me then raise exception 'not_your_turn'; end if;
    if p_state->>'turn_phase' <> 'drawn' then raise exception 'wrong_phase'; end if;
    p_server := p_server || jsonb_build_object('drawn', null);
    p_state := public._pdb_log(p_state, jsonb_build_object('t', 'pass', 'p', v_me));
    p_state := public._pdb_start_turn(p_state, public._pdb_next(p_state, v_me, 1), true);

  -- ---------------------------------------------------------------- jouer une carte
  elsif v_type = 'play' then
    if v_turn is distinct from v_me then raise exception 'not_your_turn'; end if;
    v_hand := coalesce(p_server->'hands'->v_me, '[]'::jsonb);
    select o - 1, e into v_idx, v_card
      from jsonb_array_elements(v_hand) with ordinality as t(e, o)
     where e->>'id' = p_action->>'card' limit 1;
    if v_idx is null then raise exception 'card_not_in_hand'; end if;
    if p_state->>'turn_phase' = 'drawn' and (v_card->>'id') is distinct from (p_server->'drawn'->>'id') then
      raise exception 'card_not_playable';
    end if;
    if not public._pdb_playable(p_state, v_card) then raise exception 'card_not_playable'; end if;

    v_kind := v_card->>'kind';
    v_perso := v_card->>'perso';
    if v_kind in ('wild', 'wild4') or v_perso in ('mika', 'cecile') then
      v_color := p_action->>'color';
      if v_color is null or v_color not in ('tomate', 'soleil', 'menthe', 'ciel') then
        raise exception 'invalid_color';
      end if;
    end if;
    if v_perso in ('cycy', 'manon', 'carole') then
      v_target := p_action->>'target';
      if v_target is null or v_target = v_me or not ((p_state->'active') ? v_target) then
        raise exception 'invalid_target';
      end if;
    end if;

    -- Compteurs de trophées (server.pstats)
    if v_kind <> 'num' then p_server := public._pdb_pst(p_server, v_me, 'specials', 1); end if;
    if v_kind in ('plus2', 'wild4') then
      if v_pending > 0 then p_server := public._pdb_pst(p_server, v_me, 'stacks', 1); end if;
      p_server := p_server || jsonb_build_object('pend_src', coalesce(p_server->'pend_src', '{}'::jsonb)
        || jsonb_build_object(v_me, coalesce((p_server->'pend_src'->>v_me)::integer, 0)
                                    + case when v_kind = 'plus2' then 2 else 4 end));
    end if;

    -- La carte quitte la main et passe sur la défausse.
    v_hand := v_hand - v_idx;
    p_server := jsonb_set(p_server, array['hands', v_me], v_hand);
    p_server := p_server || jsonb_build_object('drawn', null);
    if p_state->'top' is not null and jsonb_typeof(p_state->'top') = 'object' then
      p_server := jsonb_set(p_server, '{discard}', coalesce(p_server->'discard', '[]'::jsonb) || jsonb_build_array(p_state->'top'));
    end if;
    select coalesce(jsonb_agg(e order by o), '[]'::jsonb) into v_disc
      from jsonb_array_elements(coalesce(p_state->'pile', '[]'::jsonb)) with ordinality as t(e, o)
     where o > jsonb_array_length(coalesce(p_state->'pile', '[]'::jsonb)) - 3;
    p_state := p_state || jsonb_build_object('top', v_card, 'pile', v_disc || jsonb_build_array(v_card));
    p_state := jsonb_set(p_state, array['counts', v_me], to_jsonb(jsonb_array_length(v_hand)));
    if v_card ? 'color' then
      p_state := p_state || jsonb_build_object('color', v_card->>'color');
    elsif v_kind in ('wild', 'wild4') or v_perso = 'mika' then
      p_state := p_state || jsonb_build_object('color', v_color);
    end if;

    v_entry := jsonb_build_object('t', 'play', 'p', v_me, 'card', v_card, 'color', p_state->>'color');
    if v_target is not null then v_entry := v_entry || jsonb_build_object('target', v_target); end if;

    if v_kind = 'skip' then
      v_skip := 2;
    elsif v_kind = 'reverse' then
      v_reverse := true;
      p_state := p_state || jsonb_build_object('direction', -coalesce((p_state->>'direction')::integer, 1));
    elsif v_kind = 'plus2' then
      p_state := p_state || jsonb_build_object('pending_draw', v_pending + 2, 'pending_kind', 'plus2');
    elsif v_kind = 'wild4' then
      p_state := p_state || jsonb_build_object('pending_draw', v_pending + 4, 'pending_kind', 'wild4');
    elsif v_kind = 'perso' then
      if v_perso = 'kevin' then
        -- Pause manette : tu rejoues immédiatement.
        v_replay := true;
      elsif v_perso = 'cycy' then
        -- Câlin d'ours : échange de mains (sans effet si tu viens de poser ta dernière carte).
        if jsonb_array_length(v_hand) > 0 then
          v_newh := p_server->'hands'->v_target;
          p_server := jsonb_set(p_server, array['hands', v_target], v_hand);
          p_server := jsonb_set(p_server, array['hands', v_me], v_newh);
          p_state := jsonb_set(p_state, array['counts', v_me], to_jsonb(jsonb_array_length(v_newh)));
          p_state := jsonb_set(p_state, array['counts', v_target], to_jsonb(jsonb_array_length(v_hand)));
          v_hand := v_newh;
        end if;
      elsif v_perso = 'dede' then
        -- Reine de la soirée : tous les autres joueurs encore en jeu piochent 1.
        for p in select jsonb_array_elements_text(p_state->'active') loop
          if p <> v_me then
            v_r := public._pdb_draw(p_state, p_server, p, 1);
            p_state := v_r->'state'; p_server := v_r->'server';
            p_server := public._pdb_pst(p_server, v_me, 'inflicted', jsonb_array_length(v_r->'drawn'));
          end if;
        end loop;
      elsif v_perso = 'manon' then
        -- Petit carnet : la main de la cible est montrée en secret à Manon (secret.peek),
        -- puis elle lui prend 1 carte au hasard (sauf si la cible n'en a qu'une, ou si Manon
        -- vient de poser sa dernière carte).
        v_peek := jsonb_build_object('target', v_target, 'hand', p_server->'hands'->v_target,
                                     'until', public._pdb_iso(now() + interval '8 seconds'),
                                     'n', coalesce((p_state->>'log_seq')::integer, 0) + 1);
        v_newh := p_server->'hands'->v_target;
        if jsonb_array_length(v_newh) >= 2 and jsonb_array_length(v_hand) > 0 then
          select (o - 1)::integer, e into v_sidx, v_stolen
            from jsonb_array_elements(v_newh) with ordinality as t(e, o) order by random() limit 1;
          v_hand := v_hand || jsonb_build_array(v_stolen);
          p_server := jsonb_set(p_server, array['hands', v_target], v_newh - v_sidx);
          p_server := jsonb_set(p_server, array['hands', v_me], v_hand);
          p_state := jsonb_set(p_state, array['counts', v_target], to_jsonb(jsonb_array_length(v_newh) - 1));
          p_state := jsonb_set(p_state, array['counts', v_me], to_jsonb(jsonb_array_length(v_hand)));
          v_peek := v_peek || jsonb_build_object('stolen', v_stolen->>'id');
          v_entry := v_entry || jsonb_build_object('stolen', true);
        end if;
      elsif v_perso = 'mika' then
        -- Casquette à l'envers : inverse le sens (+ couleur choisie, déjà appliquée).
        p_state := p_state || jsonb_build_object('direction', -coalesce((p_state->>'direction')::integer, 1));
      elsif v_perso = 'cecile' then
        -- Grand ménage : défausse en plus toutes tes cartes de la couleur choisie.
        select coalesce(jsonb_agg(e order by o), '[]'::jsonb) into v_disc
          from jsonb_array_elements(v_hand) with ordinality as t(e, o) where e->>'color' = v_color;
        select coalesce(jsonb_agg(e order by o), '[]'::jsonb) into v_hand
          from jsonb_array_elements(v_hand) with ordinality as t(e, o) where (e->>'color') is distinct from v_color;
        p_server := jsonb_set(p_server, array['hands', v_me], v_hand);
        p_server := jsonb_set(p_server, '{discard}', (p_server->'discard') || v_disc);
        p_state := jsonb_set(p_state, array['counts', v_me], to_jsonb(jsonb_array_length(v_hand)));
        v_entry := v_entry || jsonb_build_object('discarded', v_disc, 'chosen', v_color);
      elsif v_perso = 'carole' then
        -- Coup de griffe : la cible pioche 3.
        v_r := public._pdb_draw(p_state, p_server, v_target, 3);
        p_state := v_r->'state'; p_server := v_r->'server';
        p_server := public._pdb_pst(p_server, v_me, 'inflicted', jsonb_array_length(v_r->'drawn'));
      elsif v_perso = 'marius' then
        -- Capuche : annule tout le cumul en attente ; sans cumul, le joueur suivant passe son tour.
        if v_pending > 0 then
          v_entry := v_entry || jsonb_build_object('blocked', v_pending);
        else
          v_skip := 2;
          v_entry := v_entry || jsonb_build_object('skipped', true);
        end if;
        p_state := p_state || jsonb_build_object('pending_draw', 0, 'pending_kind', null);
        p_server := p_server - 'pend_src';
      elsif v_perso = 'nini' then
        -- Glissade : chaque joueur (qui a encore des cartes) passe sa main au voisin, dans le sens du jeu.
        v_act := array(select a from jsonb_array_elements_text(p_state->'active') as t(a)
                        where jsonb_array_length(coalesce(p_server->'hands'->a, '[]'::jsonb)) > 0);
        v_n := cardinality(v_act);
        if v_n >= 2 then
          v_newh := '{}'::jsonb;
          for i in 1 .. v_n loop
            v_newh := v_newh || jsonb_build_object(
              v_act[(((i - 1 + coalesce((p_state->>'direction')::integer, 1)) % v_n) + v_n) % v_n + 1],
              p_server->'hands'->v_act[i]);
          end loop;
          for i in 1 .. v_n loop
            p_server := jsonb_set(p_server, array['hands', v_act[i]], v_newh->v_act[i]);
            p_state := jsonb_set(p_state, array['counts', v_act[i]], to_jsonb(jsonb_array_length(v_newh->v_act[i])));
          end loop;
        end if;
      end if;
    end if;

    p_state := public._pdb_log(p_state, v_entry);
    v_n := (p_state->'counts'->>v_me)::integer;

    if v_n = 0 then
      -- Plus de cartes : le joueur sort (ordre de sortie = classement).
      p_state := p_state || jsonb_build_object('out', (p_state->'out') || to_jsonb(v_me),
                                               'active', (p_state->'active') - v_me);
      p_state := p_state #- array['last_card', v_me];
      p_state := public._pdb_log(p_state, jsonb_build_object('t', 'out', 'p', v_me,
                                                             'place', jsonb_array_length(p_state->'out')));
      if jsonb_array_length(p_state->'active') <= 1 then
        p_server := p_server || jsonb_build_object('drawn', null);
        v_r := public._pdb_finish(p_state, p_server);
        p_state := v_r->'state';
      end if;
    elsif v_n = 1 then
      p_state := jsonb_set(p_state, array['last_card', v_me],
                           to_jsonb(case when coalesce((p_action->>'announce')::boolean, false) then 'safe' else 'open' end),
                           true);
      if coalesce((p_action->>'announce')::boolean, false) then
        p_state := public._pdb_log(p_state, jsonb_build_object('t', 'announce', 'p', v_me));
      end if;
    end if;

    if p_state->>'phase' = 'playing' then
      if v_replay and (p_state->'active') ? v_me then
        p_state := public._pdb_start_turn(p_state, v_me, false);
      else
        -- Inversion à 2 joueurs = passe ton tour (tu rejoues).
        if v_reverse and jsonb_array_length(p_state->'active') = 2 and (p_state->'active') ? v_me then
          v_skip := 2;
        end if;
        v_next := public._pdb_next(p_state, v_me, v_skip);
        p_state := public._pdb_start_turn(p_state, v_next, v_next <> v_me);
      end if;
    end if;

  else
    raise exception 'unknown_action';
  end if;

  -- ---------------------------------------------------------------- nettoyage + secrets
  -- « Dernière carte » : seulement pour les joueurs qui ont exactement 1 carte.
  for p in select jsonb_object_keys(coalesce(p_state->'last_card', '{}'::jsonb)) loop
    if coalesce((p_state->'counts'->>p)::integer, 0) <> 1 then
      p_state := p_state #- array['last_card', p];
    end if;
  end loop;

  p_server := public._pdb_track_hands(p_state, p_server);

  -- Secrets renvoyés uniquement pour les joueurs dont la main (ou la carte piochée) a changé.
  for p in select jsonb_array_elements_text(p_state->'players') loop
    v_od := case when v_old->'drawn'->>'player' = p then v_old->'drawn'->>'id' end;
    v_nd := case when p_server->'drawn'->>'player' = p then p_server->'drawn'->>'id' end;
    if (v_old->'hands'->p) is distinct from (p_server->'hands'->p)
       or v_od is distinct from v_nd
       or (p = v_me and v_peek is not null) then
      p_state := jsonb_set(p_state, array['hand_ver', p],
                           to_jsonb(coalesce((p_state->'hand_ver'->>p)::integer, 0) + 1), true);
      v_sec := jsonb_build_object('hand', coalesce(p_server->'hands'->p, '[]'::jsonb),
                                  'drawn', v_nd,
                                  'v', (p_state->'hand_ver'->>p)::integer);
      if p = v_me and v_peek is not null then v_sec := v_sec || jsonb_build_object('peek', v_peek); end if;
      v_secrets := v_secrets || jsonb_build_object(p, v_sec);
    end if;
  end loop;

  if p_state->>'phase' = 'finished' then
    return jsonb_build_object('state', p_state, 'server', p_server, 'secrets', v_secrets,
                              'results', p_state->'results');
  end if;
  return jsonb_build_object('state', p_state, 'server', p_server, 'secrets', v_secrets);
end $$;

revoke all on function public._pdb_card(text, text, text, integer, text) from public, anon, authenticated;
revoke all on function public._pdb_deck(boolean) from public, anon, authenticated;
revoke all on function public._pdb_shuffle(jsonb) from public, anon, authenticated;
revoke all on function public._pdb_iso(timestamptz) from public, anon, authenticated;
revoke all on function public._pdb_next(jsonb, text, integer) from public, anon, authenticated;
revoke all on function public._pdb_start_turn(jsonb, text, boolean) from public, anon, authenticated;
revoke all on function public._pdb_pst(jsonb, text, text, numeric, boolean) from public, anon, authenticated;
revoke all on function public._pdb_cumul(jsonb, text, integer) from public, anon, authenticated;
revoke all on function public._pdb_track_hands(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._pdb_log(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._pdb_draw(jsonb, jsonb, text, integer) from public, anon, authenticated;
revoke all on function public._pdb_playable(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._pdb_finish(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.game_pas_de_bol_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_pas_de_bol_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;


-- ===== games\petit-bac.sql =====
-- =============================================================================
-- JEU « petit-bac » (Petit bac multi-écrans) — idempotent (create or replace).
-- Dépend de schema.sql (_normalize_word, game_action, start_match, finish_match).
--
-- Phases : writing -> validation -> round_score -> (writing … ) -> finished.
-- Les réponses en cours d'écriture restent dans `server.answers` (privé) ;
-- le state public n'expose que `progress` (nb de cases remplies par joueur).
-- Chaque joueur récupère SES réponses dans match_secrets ({round, answers}).
-- =============================================================================

-- Normalisation d'une réponse : minuscules, sans article de tête
-- (le/la/les/l'/un/une), sans accents, espaces ni ponctuation.
create or replace function public._pb_norm(p text)
returns text language sql immutable
set search_path = public, extensions
as $$
  select public._normalize_word(
    regexp_replace(lower(btrim(coalesce(p, ''))), '^(l\s*[''’`]\s*|(le|la|les|un|une)\s+)', ''))
$$;

-- Nettoyage d'une saisie : espaces normalisés, 60 caractères max.
create or replace function public._pb_clean(p text)
returns text language sql immutable
set search_path = public, extensions
as $$ select left(btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g')), 60) $$;

-- Démarre la manche p_round (lettre déjà tirée dans server.letters).
create or replace function public._pb_start_round(p_state jsonb, p_server jsonb, p_round integer)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_letter text := p_server->'letters'->>(p_round - 1);
  v_start  timestamptz := now() + interval '4 seconds';  -- temps de l'animation de tirage
  v_zero   jsonb;
begin
  select jsonb_object_agg(x, 0) into v_zero from jsonb_array_elements_text(p_state->'players') x;
  p_state := p_state || jsonb_build_object(
    'phase', 'writing',
    'round', p_round,
    'letter', v_letter,
    'letters_used', coalesce(p_state->'letters_used', '[]'::jsonb) || to_jsonb(v_letter),
    'starts_at', v_start,
    'deadline', v_start + make_interval(secs => (p_state->>'duration')::integer),
    'progress', v_zero,
    'validation', null);
  p_server := p_server || jsonb_build_object('answers', '{}'::jsonb);
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- (Re)construit validation.answers à partir des réponses privées :
-- {catId: {uid: {text, norm, auto: null|'empty'|'letter'}}}.
create or replace function public._pb_build_answers(p_state jsonb, p_server jsonb)
returns jsonb language sql stable security definer
set search_path = public, extensions
as $$
  select coalesce(jsonb_object_agg(c->>'id', (
    select jsonb_object_agg(x.pl, jsonb_build_object(
             'text', x.t,
             'norm', public._pb_norm(x.t),
             'auto', case when public._pb_norm(x.t) = '' then 'empty'
                          when left(public._pb_norm(x.t), 1) <> lower(p_state->>'letter') then 'letter'
                          else null end))
      from (select pl, coalesce(p_server->'answers'->pl->>(c->>'id'), '') as t
              from jsonb_array_elements_text(p_state->'players') pl) x)), '{}'::jsonb)
  from jsonb_array_elements(p_state->'categories') c
$$;

create or replace function public._pb_to_validation(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
begin
  p_state := p_state || jsonb_build_object(
    'phase', 'validation',
    'validation', jsonb_build_object(
      'cat_index', 0,
      'answers', public._pb_build_answers(p_state, p_server),
      'contests', '{}'::jsonb));
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Compteur de trophées de la manche : det[pl][key] += 1.
create or replace function public._pb_bump(p_det jsonb, p_pl text, p_key text)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select p_det || jsonb_build_object(p_pl,
    coalesce(p_det->p_pl, '{}'::jsonb) || jsonb_build_object(p_key, coalesce((p_det->p_pl->>p_key)::integer, 0) + 1))
$$;

-- Barème de la manche : unique valide 2, valide partagée 1, refusée/vide 0.
-- Refusée si contestée par la majorité stricte des AUTRES joueurs.
create or replace function public._pb_score(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_n       integer := jsonb_array_length(p_state->'players');
  v_cat     text;
  pl        text;
  a         jsonb;
  v_cnt     integer;
  v_status  text;
  v_pts     integer;
  v_valid   jsonb;
  v_cd      jsonb;
  v_detail  jsonb := '{}'::jsonb;
  v_points  jsonb;
  v_uniq    jsonb;
  v_det     jsonb := '{}'::jsonb;
  v_c       text;
begin
  select jsonb_object_agg(x, 0) into v_points from jsonb_array_elements_text(p_state->'players') x;
  v_uniq := v_points;

  for v_cat in select c->>'id' from jsonb_array_elements(p_state->'categories') c loop
    v_valid := '{}'::jsonb;
    v_cd := '{}'::jsonb;
    for pl in select x from jsonb_array_elements_text(p_state->'players') x loop
      a := p_state#>array['validation', 'answers', v_cat, pl];
      v_cnt := coalesce(jsonb_array_length(p_state#>array['validation', 'contests', v_cat, pl]), 0);
      if a is null or a->>'auto' is not null then
        v_status := coalesce(a->>'auto', 'empty');
      elsif v_cnt * 2 > v_n - 1 then
        v_status := 'refused';
      else
        v_status := 'valid';
        v_valid := v_valid || jsonb_build_object(pl, a->>'norm');
      end if;
      v_cd := v_cd || jsonb_build_object(pl, jsonb_build_object(
                'text', coalesce(a->>'text', ''), 'status', v_status, 'pts', 0, 'contests', v_cnt));
    end loop;

    for pl in select key from jsonb_each_text(v_valid) loop
      select count(*) into v_cnt from jsonb_each_text(v_valid) where value = v_valid->>pl;
      v_pts := case when v_cnt > 1 then 1 else 2 end;
      v_cd := jsonb_set(v_cd, array[pl], (v_cd->pl) || jsonb_build_object(
                'status', case when v_cnt > 1 then 'shared' else 'unique' end, 'pts', v_pts));
      v_points := jsonb_set(v_points, array[pl], to_jsonb((v_points->>pl)::integer + v_pts));
      if v_pts = 2 then
        v_uniq := jsonb_set(v_uniq, array[pl], to_jsonb((v_uniq->>pl)::integer + 1));
      end if;
    end loop;
    v_detail := v_detail || jsonb_build_object(v_cat, v_cd);

    -- Compteurs de trophées : refusées, partagées, vides, grille pleine, contestations abouties
    for pl in select x from jsonb_array_elements_text(p_state->'players') x loop
      v_status := v_cd->pl->>'status';
      if v_status = 'refused' then
        v_det := public._pb_bump(v_det, pl, 'refused');
        for v_c in select x from jsonb_array_elements_text(
                     coalesce(p_state#>array['validation', 'contests', v_cat, pl], '[]'::jsonb)) x loop
          v_det := public._pb_bump(v_det, v_c, 'lawyer');
        end loop;
      elsif v_status = 'shared' then
        v_det := public._pb_bump(v_det, pl, 'shared');
      elsif v_status = 'empty' then
        v_det := public._pb_bump(v_det, pl, 'empty');
      end if;
      if v_status in ('unique', 'shared') then v_det := public._pb_bump(v_det, pl, 'valid'); end if;
    end loop;
  end loop;

  p_state := p_state || jsonb_build_object(
    'phase', 'round_score',
    'validation', null,
    'scores', (select jsonb_object_agg(key, value::integer + coalesce((v_points->>key)::integer, 0))
                 from jsonb_each_text(p_state->'scores')),
    'uniques', (select jsonb_object_agg(key, value::integer + coalesce((v_uniq->>key)::integer, 0))
                  from jsonb_each_text(coalesce(p_state->'uniques', v_points))),
    'last_round', jsonb_build_object(
        'round', p_state->'round', 'letter', p_state->'letter',
        'points', v_points, 'uniques', v_uniq, 'detail', v_detail),
    'history', coalesce(p_state->'history', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'round', p_state->'round', 'letter', p_state->'letter', 'points', v_points, 'det', v_det)));
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Stats de fin de partie pour les trophées (features/trophees.sql) : tout se lit dans history[].points.
create or replace function public._pb_tstats(p_state jsonb, p_pl text)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  with h as (
    select coalesce((e.v->'points'->>p_pl)::integer, 0) as mine,
           coalesce((select max(value::integer) from jsonb_each_text(e.v->'points')), 0) as mx,
           coalesce((e.v->'det'->p_pl->>'refused')::integer, 0) as refused,
           coalesce((e.v->'det'->p_pl->>'shared')::integer, 0) as shared,
           coalesce((e.v->'det'->p_pl->>'empty')::integer, 0) as empty,
           coalesce((e.v->'det'->p_pl->>'valid')::integer, 0) as valid,
           coalesce((e.v->'det'->p_pl->>'lawyer')::integer, 0) as lawyer
      from jsonb_array_elements(coalesce(p_state->'history', '[]'::jsonb)) as e(v)
  )
  select jsonb_build_object(
    'uniques', coalesce((p_state->'uniques'->>p_pl)::integer, 0),
    'refused', coalesce(sum(refused), 0),
    'shared', coalesce(sum(shared), 0),
    'max_empty', coalesce(max(empty), 0),
    'full_grids', count(*) filter (where valid >= jsonb_array_length(p_state->'categories')),
    'lawyer', coalesce(sum(lawyer), 0),
    'zero_rounds', count(*) filter (where mine = 0),
    'perfect_rounds', count(*) filter (where mine = 2 * jsonb_array_length(p_state->'categories')),
    'best_rounds', count(*) filter (where mine > 0 and mine = mx),
    'regular', case when count(*) >= 3 and min(mine) >= 8 then 1 else 0 end,
    'grand_slam', case when count(*) >= 4 and bool_and(mine = mx and mx > 0) then 1 else 0 end)
  from h
$$;

create or replace function public._pb_finish(p_state jsonb, p_server jsonb)
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
           'stats', public._pb_tstats(p_state, t.key))
         order by t.r, t.key)
    into v_results
    from (select key, value, rank() over (order by value::integer desc) as r
            from jsonb_each_text(p_state->'scores')) t;

  select coalesce(jsonb_agg(key order by key), '[]'::jsonb) into v_winners
    from jsonb_each_text(p_state->'scores') where v_max > 0 and value::integer = v_max;

  p_state := p_state || jsonb_build_object('phase', 'finished', 'winners', v_winners, 'results', v_results);
  return jsonb_build_object('state', p_state, 'server', p_server, 'results', v_results);
end $$;

-- Options : {"categories":[{"id","label","emoji"}] (1-12), "duration":90|120|180|300,
--            "rounds":1-15, "letters":["A",…] (lettres tirables, défaut A-V sans K/Q)}
create or replace function public.game_petit_bac_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_cats    jsonb := p_options->'categories';
  v_letters text[];
  v_dur     integer;
  v_rounds  integer;
  v_seq     jsonb;
  v_zero    jsonb;
  v_state   jsonb;
begin
  if cardinality(p_players) < 2 then raise exception 'not_enough_players'; end if;

  if v_cats is null or jsonb_typeof(v_cats) <> 'array'
     or jsonb_array_length(v_cats) not between 1 and 12 then
    raise exception 'invalid_categories';
  end if;
  if exists (select 1 from jsonb_array_elements(v_cats) c
              where jsonb_typeof(c) <> 'object'
                 or coalesce(c->>'id', '') !~ '^[a-z0-9_-]{1,40}$'
                 or char_length(btrim(coalesce(c->>'label', ''))) not between 1 and 40
                 or char_length(coalesce(c->>'emoji', '')) > 16)
     or (select count(distinct c->>'id') from jsonb_array_elements(v_cats) c) <> jsonb_array_length(v_cats) then
    raise exception 'invalid_categories';
  end if;
  select jsonb_agg(jsonb_build_object('id', c->>'id', 'label', btrim(c->>'label'),
                                      'emoji', coalesce(c->>'emoji', '')) order by o)
    into v_cats from jsonb_array_elements(v_cats) with ordinality as t(c, o);

  if jsonb_typeof(p_options->'letters') = 'array' then
    v_letters := array(select distinct upper(x) from jsonb_array_elements_text(p_options->'letters') x
                        where upper(x) ~ '^[A-Z]$');
  end if;
  if coalesce(cardinality(v_letters), 0) = 0 then
    v_letters := string_to_array('A,B,C,D,E,F,G,H,I,J,L,M,N,O,P,R,S,T,U,V', ',');
  end if;

  v_dur := coalesce(nullif(p_options->>'duration', '')::integer, 120);
  if v_dur not in (90, 120, 180, 300) then v_dur := 120; end if;
  v_rounds := coalesce(nullif(p_options->>'rounds', '')::integer, 5);
  v_rounds := least(greatest(v_rounds, 1), 15, cardinality(v_letters));

  -- Lettres de toute la partie tirées d'avance, sans répétition (secret serveur).
  select jsonb_agg(l) into v_seq
    from (select l from unnest(v_letters) l order by random() limit v_rounds) t;
  select jsonb_object_agg(p::text, 0) into v_zero from unnest(p_players) p;

  v_state := jsonb_build_object(
    'game', 'petit-bac',
    'phase', 'writing',
    'round', 1,
    'total_rounds', v_rounds,
    'players', to_jsonb(p_players),
    'categories', v_cats,
    'duration', v_dur,
    'letter', null,
    'letters_used', '[]'::jsonb,
    'starts_at', null,
    'deadline', null,
    'progress', v_zero,
    'validation', null,
    'scores', v_zero,
    'uniques', v_zero,
    'last_round', null,
    'history', '[]'::jsonb,
    'winners', null,
    'results', null);

  return public._pb_start_round(v_state, jsonb_build_object('letters', v_seq, 'answers', '{}'::jsonb), 1)
         || jsonb_build_object('secrets', '{}'::jsonb);
end $$;

create or replace function public.game_petit_bac_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_type     text := p_action->>'type';
  v_phase    text := p_state->>'phase';
  v_me       text := p_actor::text;
  v_player   boolean := (p_state->'players') ? p_actor::text;
  v_round    integer := (p_state->>'round')::integer;
  v_ans      jsonb;
  v_mine     jsonb;
  v_filled   integer;
  v_cat      text;
  v_idx      integer;
  v_cur      integer;
  v_ncat     integer := jsonb_array_length(p_state->'categories');
  v_target   text;
  v_value    boolean;
  v_list     jsonb;
  v_contests jsonb;
  v_res      jsonb;
begin
  -- ---------------------------------------------------------------- save
  if v_type = 'save' then
    if not v_player then raise exception 'not_a_player'; end if;
    v_ans := p_action->'answers';
    if v_ans is null or jsonb_typeof(v_ans) <> 'object' then raise exception 'invalid_action'; end if;
    -- Sauvegarde hors délai / d'une autre manche : ignorée sans erreur
    -- (tolérance réseau : acceptée jusqu'à 2 s après l'échéance, même si la
    -- validation a déjà commencé — les réponses affichées sont alors recalculées).
    if (p_action ? 'round' and (p_action->>'round') is distinct from (p_state->>'round'))
       or v_phase not in ('writing', 'validation')
       or now() > (p_state->>'deadline')::timestamptz + interval '2 seconds' then
      return jsonb_build_object('state', p_state, 'server', p_server);
    end if;

    v_mine := coalesce(p_server->'answers'->v_me, '{}'::jsonb);
    select v_mine || coalesce(jsonb_object_agg(c->>'id', public._pb_clean(v_ans->>(c->>'id'))), '{}'::jsonb)
      into v_mine
      from jsonb_array_elements(p_state->'categories') c
     where jsonb_typeof(v_ans->(c->>'id')) = 'string';
    select count(*) into v_filled from jsonb_each_text(v_mine) where value <> '';

    p_server := jsonb_set(p_server, array['answers', v_me], v_mine, true);
    p_state := jsonb_set(p_state, array['progress', v_me], to_jsonb(v_filled), true);
    if v_phase = 'validation' then
      p_state := jsonb_set(p_state, '{validation,answers}', public._pb_build_answers(p_state, p_server));
    end if;
    return jsonb_build_object('state', p_state, 'server', p_server,
      'secrets', jsonb_build_object(v_me, jsonb_build_object('round', v_round, 'answers', v_mine)));

  -- ---------------------------------------------------------------- tick
  elsif v_type = 'tick' then
    if v_phase = 'writing' and now() >= (p_state->>'deadline')::timestamptz then
      return public._pb_to_validation(p_state, p_server);
    end if;
    return jsonb_build_object('state', p_state, 'server', p_server);

  -- ---------------------------------------------------------------- end_round
  elsif v_type = 'end_round' then
    -- « STOP ! » : l'hôte à tout moment ; un joueur seulement s'il a rempli toutes ses cases.
    if not p_is_host and not v_player then raise exception 'not_a_player'; end if;
    if v_phase <> 'writing' then raise exception 'wrong_phase'; end if;
    -- Les dernières réponses du joueur peuvent voyager avec l'action (pas de course avec la sauvegarde auto).
    if v_player and jsonb_typeof(p_action->'answers') = 'object' then
      v_res := public.game_petit_bac_action(p_state, p_server, p_actor, p_is_host,
                 jsonb_build_object('type', 'save', 'round', v_round, 'answers', p_action->'answers'));
      p_state := v_res->'state';
      p_server := v_res->'server';
    end if;
    if not p_is_host and coalesce((p_state#>>array['progress', v_me])::integer, 0) < v_ncat then
      raise exception 'not_finished';
    end if;
    -- L'échéance devient « maintenant » : la tolérance de 2 s s'applique aussi.
    p_state := p_state || jsonb_build_object('deadline', least(now(), (p_state->>'deadline')::timestamptz),
                                             'forced', true);
    return public._pb_to_validation(p_state, p_server);

  -- ---------------------------------------------------------------- contest
  elsif v_type = 'contest' then
    if v_phase <> 'validation' then raise exception 'wrong_phase'; end if;
    if not v_player then raise exception 'not_a_player'; end if;
    v_cat := p_action->>'category';
    select o - 1 into v_idx
      from jsonb_array_elements(p_state->'categories') with ordinality as t(c, o)
     where c->>'id' = v_cat;
    if v_idx is null then raise exception 'invalid_action'; end if;
    v_cur := (p_state#>>'{validation,cat_index}')::integer;
    if v_idx > v_cur then raise exception 'wrong_phase'; end if;
    v_target := p_action->>'target';
    if v_target is null or not ((p_state->'players') ? v_target) then raise exception 'invalid_target'; end if;
    if v_target = v_me then raise exception 'cannot_vote_self'; end if;
    if p_state#>>array['validation', 'answers', v_cat, v_target, 'auto'] is not null then
      raise exception 'invalid_target';  -- déjà refusée automatiquement
    end if;
    v_value := coalesce((p_action->>'value')::boolean, true);

    v_contests := coalesce(p_state#>'{validation,contests}', '{}'::jsonb);
    select coalesce(jsonb_agg(x order by x), '[]'::jsonb) into v_list
      from (select x from jsonb_array_elements_text(coalesce(v_contests#>array[v_cat, v_target], '[]'::jsonb)) x
             where x <> v_me
            union
            select v_me where v_value) t;
    v_contests := v_contests || jsonb_build_object(v_cat,
                    coalesce(v_contests->v_cat, '{}'::jsonb) || jsonb_build_object(v_target, v_list));
    p_state := jsonb_set(p_state, '{validation,contests}', v_contests);
    return jsonb_build_object('state', p_state, 'server', p_server);

  -- ---------------------------------------------------------------- next_category
  elsif v_type = 'next_category' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase <> 'validation' then raise exception 'wrong_phase'; end if;
    v_cur := (p_state#>>'{validation,cat_index}')::integer;
    if v_cur + 1 >= v_ncat then
      return public._pb_score(p_state, p_server);
    end if;
    p_state := jsonb_set(p_state, '{validation,cat_index}', to_jsonb(v_cur + 1));
    return jsonb_build_object('state', p_state, 'server', p_server);

  -- ---------------------------------------------------------------- close_validation
  elsif v_type = 'close_validation' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase <> 'validation' then raise exception 'wrong_phase'; end if;
    return public._pb_score(p_state, p_server);

  -- ---------------------------------------------------------------- next_round
  elsif v_type = 'next_round' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase <> 'round_score' then raise exception 'wrong_phase'; end if;
    if v_round >= (p_state->>'total_rounds')::integer then
      return public._pb_finish(p_state, p_server);
    end if;
    return public._pb_start_round(p_state - 'forced', p_server, v_round + 1);

  else
    raise exception 'unknown_action';
  end if;
end $$;

revoke all on function public._pb_norm(text) from public, anon, authenticated;
revoke all on function public._pb_clean(text) from public, anon, authenticated;
revoke all on function public._pb_start_round(jsonb, jsonb, integer) from public, anon, authenticated;
revoke all on function public._pb_build_answers(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._pb_bump(jsonb, text, text) from public, anon, authenticated;
revoke all on function public._pb_to_validation(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._pb_score(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._pb_finish(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._pb_tstats(jsonb, text) from public, anon, authenticated;
revoke all on function public.game_petit_bac_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_petit_bac_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;


-- ===== games\quatre-a-la-suite.sql =====
-- =============================================================================
-- JEU « 4 à la suite » (id quatre-a-la-suite) — jeu en DUEL (socle
-- supabase/features/duel.sql). Règles traditionnelles « aligner 4 jetons » :
-- grille de 7 colonnes × 6 lignes, on lâche un jeton dans une colonne, il tombe
-- sur la plus basse case libre. 4 jetons alignés (horizontale, verticale ou
-- diagonale) = manche gagnée ; grille pleine = nul.
--
-- Plateau public (state.board) :
--   {"width":7, "height":6,
--    "cols": [["<uid>", ...] x7],      -- chaque colonne, du BAS vers le haut
--    "a": "<uid>", "b": "<uid>",       -- duellistes (a = couleur 1, b = couleur 2)
--    "count": n,                       -- jetons posés
--    "last": {"col":c, "row":r, "by":"<uid>"} | null,   -- row 0 = en bas
--    "line": [[c, r], ...] | null}     -- jetons gagnants (4 ou plus, plusieurs lignes possibles)
-- Coup : {"col": 0..6}. Pas de secret, pas de server, pas de préparation.
-- =============================================================================

-- Propriétaire de la case (c, r) ou null (hors grille / vide).
create or replace function public._q4s_cell(p_cols jsonb, p_c integer, p_r integer)
returns text language sql immutable
set search_path = public, extensions
as $$
  select case when p_c between 0 and 6 and p_r between 0 and 5 then p_cols->p_c->>p_r end;
$$;

-- Cases alignées (>= 4) passant par (c, r) pour p_who, toutes directions ; null sinon.
create or replace function public._q4s_line(p_cols jsonb, p_c integer, p_r integer, p_who text)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_dirs  integer[] := array[1,0, 0,1, 1,1, 1,-1];
  v_line  jsonb := '[]'::jsonb;
  v_seg   jsonb;
  dc      integer;
  dr      integer;
  k       integer;
  i       integer;
begin
  for i in 0 .. 3 loop
    dc := v_dirs[i * 2 + 1];
    dr := v_dirs[i * 2 + 2];
    v_seg := jsonb_build_array(jsonb_build_array(p_c, p_r));
    k := 1;
    while public._q4s_cell(p_cols, p_c + k * dc, p_r + k * dr) = p_who loop
      v_seg := v_seg || jsonb_build_array(jsonb_build_array(p_c + k * dc, p_r + k * dr));
      k := k + 1;
    end loop;
    k := 1;
    while public._q4s_cell(p_cols, p_c - k * dc, p_r - k * dr) = p_who loop
      v_seg := v_seg || jsonb_build_array(jsonb_build_array(p_c - k * dc, p_r - k * dr));
      k := k + 1;
    end loop;
    if jsonb_array_length(v_seg) >= 4 then
      v_line := v_line || (select coalesce(jsonb_agg(e), '[]'::jsonb) from jsonb_array_elements(v_seg) e
                            where not (v_line @> jsonb_build_array(e)));
    end if;
  end loop;
  return case when jsonb_array_length(v_line) > 0 then v_line end;
end $$;

-- Trophées : directions gagnantes du dernier jeton posé en (c, r) : {"n": nb de directions alignant >= 4,
-- "diag": une diagonale gagne, "five": un alignement de 5+ jetons}.
create or replace function public._q4s_kinds(p_cols jsonb, p_c integer, p_r integer, p_who text)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_dirs integer[] := array[1,0, 0,1, 1,1, 1,-1];
  v_n    integer := 0;
  v_diag boolean := false;
  v_five boolean := false;
  v_len  integer;
  dc     integer;
  dr     integer;
  k      integer;
  i      integer;
begin
  for i in 0 .. 3 loop
    dc := v_dirs[i * 2 + 1];
    dr := v_dirs[i * 2 + 2];
    v_len := 1;
    k := 1;
    while public._q4s_cell(p_cols, p_c + k * dc, p_r + k * dr) = p_who loop v_len := v_len + 1; k := k + 1; end loop;
    k := 1;
    while public._q4s_cell(p_cols, p_c - k * dc, p_r - k * dr) = p_who loop v_len := v_len + 1; k := k + 1; end loop;
    if v_len >= 4 then
      v_n := v_n + 1;
      if i >= 2 then v_diag := true; end if;
      if v_len >= 5 then v_five := true; end if;
    end if;
  end loop;
  return jsonb_build_object('n', v_n, 'diag', v_diag, 'five', v_five);
end $$;

-- ---------------------------------------------------------------- hooks du socle

create or replace function public.game_quatre_a_la_suite_board_new(p_ctx jsonb, p_a text, p_b text)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select jsonb_build_object('board', jsonb_build_object(
    'width', 7, 'height', 6,
    'cols', '[[],[],[],[],[],[],[]]'::jsonb,
    'a', p_a, 'b', p_b,
    'count', 0, 'last', null, 'line', null));
$$;

create or replace function public.game_quatre_a_la_suite_board_move(p_board jsonb, p_server jsonb, p_actor text, p_move jsonb)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_c     integer;
  v_r     integer;
  v_cols  jsonb := p_board->'cols';
  v_line  jsonb;
  v_count integer := coalesce((p_board->>'count')::integer, 0) + 1;
begin
  if jsonb_typeof(p_move->'col') is distinct from 'number' or coalesce(p_move->>'col', '') !~ '^[0-6]$' then
    raise exception 'invalid_move';
  end if;
  v_c := (p_move->>'col')::integer;
  v_r := jsonb_array_length(v_cols->v_c);
  if v_r >= 6 then raise exception 'column_full'; end if;
  v_cols := jsonb_set(v_cols, array[v_c::text], (v_cols->v_c) || to_jsonb(p_actor));
  v_line := public._q4s_line(v_cols, v_c, v_r, p_actor);
  p_board := p_board || jsonb_build_object(
    'cols', v_cols, 'count', v_count,
    'last', jsonb_build_object('col', v_c, 'row', v_r, 'by', p_actor),
    'line', v_line);
  if v_line is not null then
    -- 'game' : compteurs de fin de manche pour les trophées (socle duel : games[].x)
    return jsonb_build_object('board', p_board, 'outcome', 'win', 'winner', p_actor,
      'game', jsonb_build_object(
        'diag', (public._q4s_kinds(v_cols, v_c, v_r, p_actor)->>'diag')::boolean,
        'double', (public._q4s_kinds(v_cols, v_c, v_r, p_actor)->>'n')::integer >= 2
                  or (public._q4s_kinds(v_cols, v_c, v_r, p_actor)->>'five')::boolean));
  elsif v_count >= 42 then
    return jsonb_build_object('board', p_board, 'outcome', 'draw');
  end if;
  return jsonb_build_object('board', p_board, 'outcome', null);
end $$;

-- Coup automatique (minuteur) : une colonne non pleine au hasard.
create or replace function public.game_quatre_a_la_suite_board_auto(p_board jsonb, p_server jsonb, p_actor text)
returns jsonb language sql volatile
set search_path = public, extensions
as $$
  select jsonb_build_object('col', c)
    from generate_series(0, 6) as c
   where jsonb_array_length(p_board->'cols'->c) < 6
   order by random() limit 1;
$$;

-- ---------------------------------------------------------------- moteur (délégation au socle)

-- Hook de trophées du socle duel (features/duel.sql, _duel_tstats) : stats propres au jeu.
-- « jetons » = coups des deux joueurs au total.
create or replace function public.game_quatre_a_la_suite_trophy_stats(p_state jsonb, p_pl text)
returns jsonb language sql stable
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'fast_loss', count(*) filter (where lost and moves <= 10),
    'long_win', count(*) filter (where won and moves >= 36),
    'fast_win', count(*) filter (where won and moves <= 12),
    'diag_wins', count(*) filter (where won and coalesce((g->>'diag')::boolean, false)),
    'double_wins', count(*) filter (where won and coalesce((g->>'double')::boolean, false)))
  from public._duel_games_x(p_state, p_pl)
$$;
revoke all on function public.game_quatre_a_la_suite_trophy_stats(jsonb, text) from public, anon, authenticated;

create or replace function public.game_quatre_a_la_suite_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if cardinality(p_players) > 9 then raise exception 'too_many_players'; end if;
  return public._duel_start('quatre-a-la-suite', p_players, p_options);
end $$;

create or replace function public.game_quatre_a_la_suite_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
begin
  return public._duel_action('quatre-a-la-suite', p_state, p_server, p_actor, p_is_host, p_action);
end $$;

revoke all on function public._q4s_cell(jsonb, integer, integer) from public, anon, authenticated;
revoke all on function public._q4s_line(jsonb, integer, integer, text) from public, anon, authenticated;
revoke all on function public._q4s_kinds(jsonb, integer, integer, text) from public, anon, authenticated;
revoke all on function public.game_quatre_a_la_suite_board_new(jsonb, text, text) from public, anon, authenticated;
revoke all on function public.game_quatre_a_la_suite_board_move(jsonb, jsonb, text, jsonb) from public, anon, authenticated;
revoke all on function public.game_quatre_a_la_suite_board_auto(jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.game_quatre_a_la_suite_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_quatre_a_la_suite_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;


-- ===== games\qui-suis-je.sql =====
-- =============================================================================
-- JEU « qui-suis-je » (Qui suis-je ? — téléphone sur le front) — idempotent.
-- Contrat complet : src/games/qui-suis-je/types.ts (en-tête).
--
-- Options (p_options de start_match), préparées par le front de l'hôte :
--   {"rounds": 1|2, "turn_seconds": 45|60|90, "difficulty": "facile|mixte|difficile",
--    "themes": ["celebrites", ...],
--    "cards": [{"id":"qs0001","name":"Astérix","theme":"dessins-animes","difficulty":1,
--               "slug":"dede"?, "sub":"Delphine"?}, ...]}
--   `cards` = file unique consommée dans l'ordre par tous les tours (les cartes
--   non montrées d'un tour servent au suivant ; on reboucle si elle est épuisée).
-- Les cartes ne sont pas secrètes (tout le monde sauf le devineur doit les voir),
-- mais seule la carte courante est publiée dans le state ; la file vit dans `server`.
-- =============================================================================

-- Horodatage ISO-8601 UTC millisecondes (parsable partout, Safari compris).
create or replace function public._qsj_iso(p timestamptz)
returns text language sql immutable
set search_path = public, extensions
as $$ select to_char(p at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;

-- Tour p_turn : le devineur se prépare (pose le téléphone sur son front).
-- Pas d'échéance : le devineur envoie `ready` (l'hôte peut passer le tour).
create or replace function public._qsj_start_turn(p_state jsonb, p_server jsonb, p_turn integer)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_n integer := jsonb_array_length(p_state->'order');
begin
  p_state := p_state || jsonb_build_object(
    'phase', 'placing',
    'turn', p_turn,
    'round', ((p_turn - 1) / v_n) + 1,
    'guesser', p_state->'order'->((p_turn - 1) % v_n),
    'card', null,
    'card_index', 0,
    'starts_at', null,
    'deadline', null,
    'turn_found', 0,
    'turn_passed', 0,
    'turn_log', '[]'::jsonb);
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Carte suivante de la file (rebouclage en fin de file).
create or replace function public._qsj_next_card(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_len integer := jsonb_array_length(p_server->'cards');
  v_pos integer := coalesce((p_server->>'pos')::integer, 0);
begin
  if v_pos >= v_len then v_pos := 0; end if;
  p_state := p_state || jsonb_build_object('card', p_server->'cards'->v_pos);
  p_server := p_server || jsonb_build_object('pos', v_pos + 1);
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Fin du tour : récap 4 s.
create or replace function public._qsj_end_turn(p_state jsonb, p_server jsonb, p_skipped boolean)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_summary jsonb;
begin
  v_summary := jsonb_build_object(
    'turn', p_state->'turn',
    'guesser', p_state->'guesser',
    'found', coalesce((p_state->>'turn_found')::integer, 0),
    'passed', coalesce((p_state->>'turn_passed')::integer, 0),
    'skipped', p_skipped,
    -- log compact : [{n: nom, r: 'found'|'pass', s?: slug}]
    'log', coalesce((select jsonb_agg(
                       jsonb_strip_nulls(jsonb_build_object('n', e->'card'->>'name', 'r', e->>'r', 's', e->'card'->>'slug',
                                          'd', e->'card'->>'difficulty'))
                       order by o)
                       from jsonb_array_elements(coalesce(p_state->'turn_log', '[]'::jsonb)) with ordinality as x(e, o)),
                    '[]'::jsonb));
  p_state := p_state || jsonb_build_object(
    'phase', 'recap',
    'card', null,
    'starts_at', null,
    'deadline', public._qsj_iso(now() + make_interval(secs => (p_state->>'recap_seconds')::integer)),
    'last_turn', v_summary,
    'history', coalesce(p_state->'history', '[]'::jsonb) || jsonb_build_array(v_summary));
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Stats de fin de partie pour les trophées (features/trophees.sql) : tours du joueur dans history[].
create or replace function public._qsj_tstats(p_state jsonb, p_pl text)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  with t as (
    select e.o, (e.v->>'found')::integer as found, (e.v->>'passed')::integer as passed, e.v->'log' as log
      from jsonb_array_elements(coalesce(p_state->'history', '[]'::jsonb)) with ordinality as e(v, o)
     where e.v->>'guesser' = p_pl and not coalesce((e.v->>'skipped')::boolean, false)
  ), l as (
    select t.o as turn_o, x.o as i, x.e->>'r' as r, x.e->>'s' as s, x.e->>'d' as d
      from t, jsonb_array_elements(coalesce(t.log, '[]'::jsonb)) with ordinality as x(e, o)
  ), runs as (
    select turn_o, r, i - row_number() over (partition by turn_o, r order by i) as grp from l
  )
  select jsonb_build_object(
    'empty_turns', count(*) filter (where found = 0),
    'max_passed', coalesce(max(passed), 0),
    'clean_turns', count(*) filter (where passed = 0 and found >= 3),
    'best_turn', coalesce(max(found), 0),
    'steady', case when count(*) >= 2 and min(found) >= 5 then 1 else 0 end,
    'crew_found', (select count(*) from l where r = 'found' and s is not null),
    'hard_found', (select count(*) from l where r = 'found' and d = '3'),
    'best_run', coalesce((select max(c) from (select count(*) as c from runs where r = 'found' group by turn_o, grp) z), 0))
  from t
$$;

-- Fin de partie : classement par cartes trouvées.
create or replace function public._qsj_finish(p_state jsonb, p_server jsonb)
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
           'stats', jsonb_build_object('found', t.value::integer) || public._qsj_tstats(p_state, t.key))
         order by t.r, t.key)
    into v_results
    from (select key, value, rank() over (order by value::integer desc) as r
            from jsonb_each_text(p_state->'scores')) t;
  select coalesce(jsonb_agg(key order by key), '[]'::jsonb) into v_winners
    from jsonb_each_text(p_state->'scores') where v_max > 0 and value::integer = v_max;
  p_state := p_state || jsonb_build_object(
    'phase', 'finished', 'deadline', null, 'starts_at', null, 'card', null,
    'winners', v_winners, 'results', v_results);
  return jsonb_build_object('state', p_state, 'server', p_server, 'results', v_results);
end $$;

-- -----------------------------------------------------------------------------
-- Démarrage
-- -----------------------------------------------------------------------------
create or replace function public.game_qui_suis_je_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_n      integer := cardinality(p_players);
  v_rounds integer;
  v_secs   integer;
  v_diff   text;
  v_cards  jsonb := p_options->'cards';
  v_clean  jsonb;
  v_themes jsonb;
  v_order  jsonb;
  v_zero   jsonb;
  v_state  jsonb;
begin
  if v_n < 2 then raise exception 'not_enough_players'; end if;
  if v_n > 9 then raise exception 'too_many_players'; end if;
  v_rounds := coalesce(nullif(p_options->>'rounds', '')::integer, 1);
  if v_rounds not in (1, 2) then v_rounds := 1; end if;
  v_secs := coalesce(nullif(p_options->>'turn_seconds', '')::integer, 60);
  if v_secs not in (45, 60, 90) then v_secs := 60; end if;
  v_diff := coalesce(p_options->>'difficulty', 'mixte');
  if v_diff not in ('facile', 'mixte', 'difficile') then v_diff := 'mixte'; end if;

  if v_cards is null or jsonb_typeof(v_cards) <> 'array' then raise exception 'missing_cards'; end if;
  if jsonb_array_length(v_cards) < 5 then raise exception 'not_enough_cards'; end if;
  if jsonb_array_length(v_cards) > 800 then raise exception 'invalid_cards'; end if;
  if exists (
    select 1 from jsonb_array_elements(v_cards) c
     where jsonb_typeof(c) <> 'object'
        or jsonb_typeof(c->'name') is distinct from 'string'
        or char_length(btrim(c->>'name')) not between 1 and 60
        or (c ? 'slug' and jsonb_typeof(c->'slug') <> 'null'
            and (jsonb_typeof(c->'slug') <> 'string' or (c->>'slug') !~ '^[a-z0-9-]{2,24}$')))
  then
    raise exception 'invalid_cards';
  end if;
  select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'id', left(coalesce(nullif(btrim(c->>'id'), ''), 'c' || o), 40),
           'name', btrim(regexp_replace(c->>'name', '\s+', ' ', 'g')),
           'theme', left(coalesce(nullif(btrim(c->>'theme'), ''), 'divers'), 30),
           'difficulty', least(greatest(coalesce(
                           case when jsonb_typeof(c->'difficulty') = 'number' then (c->>'difficulty')::numeric::integer end, 2), 1), 3),
           'slug', case when jsonb_typeof(c->'slug') = 'string' then c->>'slug' end,
           'sub', case when jsonb_typeof(c->'sub') = 'string' and btrim(c->>'sub') <> '' then left(btrim(c->>'sub'), 40) end))
           order by o)
    into v_clean
    from jsonb_array_elements(v_cards) with ordinality as t(c, o);

  select coalesce(jsonb_agg(left(t, 30)), '[]'::jsonb) into v_themes
    from (select t from jsonb_array_elements_text(
            case when jsonb_typeof(p_options->'themes') = 'array' then p_options->'themes' else '[]'::jsonb end) t
           where btrim(t) <> '' limit 12) s;

  select jsonb_agg(p order by random()) into v_order from unnest(p_players) p;
  select jsonb_object_agg(p::text, 0) into v_zero from unnest(p_players) p;

  v_state := jsonb_build_object(
    'game', 'qui-suis-je',
    'phase', 'placing',
    'players', to_jsonb(p_players),
    'order', v_order,
    'round', 1,
    'total_rounds', v_rounds,
    'turn', 1,
    'total_turns', v_rounds * v_n,
    'difficulty', v_diff,
    'themes', v_themes,
    'turn_seconds', v_secs,
    'countdown_seconds', 4,
    'recap_seconds', 4,
    'scores', v_zero,
    'last_turn', null,
    'history', '[]'::jsonb,
    'winners', null,
    'results', null);

  return public._qsj_start_turn(v_state, jsonb_build_object('cards', v_clean, 'pos', 0), 1);
end $$;

-- -----------------------------------------------------------------------------
-- Actions
-- -----------------------------------------------------------------------------
create or replace function public.game_qui_suis_je_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_type  text := p_action->>'type';
  v_phase text := p_state->>'phase';
  v_me    text := p_actor::text;
  v_turn  integer := (p_state->>'turn')::integer;
  v_idx   integer;
  v_start timestamptz;
  v_r     text;
begin
  -- ---------------------------------------------------------------------- ready
  if v_type = 'ready' then
    if v_phase <> 'placing' then raise exception 'wrong_phase'; end if;
    if v_me <> p_state->>'guesser' then raise exception 'not_your_turn'; end if;
    v_start := now() + make_interval(secs => (p_state->>'countdown_seconds')::integer);
    p_state := p_state || jsonb_build_object(
      'phase', 'playing',
      'starts_at', public._qsj_iso(v_start),
      'deadline', public._qsj_iso(v_start + make_interval(secs => (p_state->>'turn_seconds')::integer)));
    return public._qsj_next_card(p_state, p_server);

  -- -------------------------------------------------------------- found / pass
  elsif v_type in ('found', 'pass') then
    if v_phase <> 'playing' then raise exception 'wrong_phase'; end if;
    if v_me <> p_state->>'guesser' then raise exception 'not_your_turn'; end if;
    -- Pendant le 3-2-1 : trop tôt. Après l'échéance : 1 s de grâce (latence réseau)
    -- tant que personne n'a envoyé le tick de fin.
    if now() < (p_state->>'starts_at')::timestamptz
       or now() >= (p_state->>'deadline')::timestamptz + interval '1 second' then
      raise exception 'wrong_phase';
    end if;
    begin
      v_idx := (p_action->>'index')::integer;
    exception when others then
      raise exception 'invalid_card';
    end;
    if v_idx is null then raise exception 'invalid_card'; end if;
    if v_idx <> (p_state->>'card_index')::integer then raise exception 'wrong_card'; end if;
    v_r := v_type;
    p_state := p_state || jsonb_build_object(
      'card_index', v_idx + 1,
      'turn_log', coalesce(p_state->'turn_log', '[]'::jsonb)
                  || jsonb_build_array(jsonb_build_object('i', v_idx, 'r', v_r, 'card', p_state->'card')),
      'turn_found', coalesce((p_state->>'turn_found')::integer, 0) + case when v_r = 'found' then 1 else 0 end,
      'turn_passed', coalesce((p_state->>'turn_passed')::integer, 0) + case when v_r = 'pass' then 1 else 0 end);
    if v_r = 'found' then
      p_state := p_state || jsonb_build_object('scores', (p_state->'scores')
                   || jsonb_build_object(v_me, coalesce((p_state->'scores'->>v_me)::integer, 0) + 1));
    end if;
    return public._qsj_next_card(p_state, p_server);

  -- ----------------------------------------------------------------------- tick
  elsif v_type = 'tick' then
    if v_phase = 'playing' then
      if now() < (p_state->>'deadline')::timestamptz then
        return jsonb_build_object('state', p_state, 'server', p_server);
      end if;
      return public._qsj_end_turn(p_state, p_server, false);
    elsif v_phase = 'recap' then
      if now() < (p_state->>'deadline')::timestamptz then
        return jsonb_build_object('state', p_state, 'server', p_server);
      end if;
      if v_turn >= (p_state->>'total_turns')::integer then
        return public._qsj_finish(p_state, p_server);
      end if;
      return public._qsj_start_turn(p_state, p_server, v_turn + 1);
    end if;
    -- placing (pas d'échéance) ou autre : ignoré sans erreur.
    return jsonb_build_object('state', p_state, 'server', p_server);

  -- ------------------------------------------------------------------ skip_turn
  elsif v_type = 'skip_turn' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase not in ('placing', 'playing') then raise exception 'wrong_phase'; end if;
    return public._qsj_end_turn(p_state, p_server, true);

  else
    raise exception 'unknown_action';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Droits : fonctions internes, appelées uniquement via start_match / game_action.
-- -----------------------------------------------------------------------------
revoke all on function public._qsj_iso(timestamptz) from public, anon, authenticated;
revoke all on function public._qsj_start_turn(jsonb, jsonb, integer) from public, anon, authenticated;
revoke all on function public._qsj_next_card(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._qsj_end_turn(jsonb, jsonb, boolean) from public, anon, authenticated;
revoke all on function public._qsj_tstats(jsonb, text) from public, anon, authenticated;
revoke all on function public._qsj_finish(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.game_qui_suis_je_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_qui_suis_je_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;


-- ===== games\tour-des-potes.sql =====
-- =============================================================================
-- JEU « Le Tour des Potes » (id tour-des-potes) — plateau d'achat / location
-- dans les villes des amis (Bayon-sur-Gironde, Pugnac, Berson, Bordeaux).
-- Idempotent (create or replace). Dispatché par start_match / game_action.
-- Contrat complet (state public, actions, options) : src/games/tour-des-potes/types.ts.
-- Noms / anecdotes des lieux : src/games/tour-des-potes/board.ts (front). Ici
-- seulement l'économie (prix, loyers, prix des maisons) : _tdp_board(), qui
-- DOIT rester identique à board.ts (vérifié par le test PGlite).
--
-- PLATEAU (40 cases, sens horaire) : 0 Départ (+200 en passant / s'arrêtant),
-- 10 « En visite / Au violon », 20 « Pause apéro », 30 « Direction le violon ».
-- 22 lieux (8 quartiers), 4 maisons des potes (5/15/25/35 : loyer 25/50/100/200
-- selon le nombre possédé), 2 services (12/28 : dés ×4, ×10 avec les deux),
-- 2 taxes (4 : 200, 38 : 100), cartes Hasard (7/22/36) et Entre potes (2/17/33).
--
-- TOUR : phase roll (dés serveur ; double = rejoue ; 3e double = violon)
--   -> déplacement -> résolution (loyer / taxe automatiques ; lieu libre
--   -> phase buy ; case Hasard / Entre potes -> phase card) -> phase manage
--   (construire / vendre, puis end_turn) ou de nouveau roll après un double.
--   Construire / vendre aussi en roll et jail (pas en buy / card).
-- CARTES : arrivé sur une case carte DIRECTEMENT par les dés (lancer normal ou
--   sortie du violon en lançant), le joueur passe en phase card
--   (pending = {cell, deck}) et pioche lui-même avec {"type":"draw"} ; la
--   carte est alors appliquée (déplacement, achat -> buy, loyer, violon…).
--   Une carte qui renvoie sur une autre case carte est appliquée aussitôt
--   (chaîne limitée à 4 cartes, pas de nouvelle phase card).
-- VIOLON : phase jail en début de tour : pay_jail (50), use_card, ou roll (tenter
--   un double ; au 3e échec on paie 50 et on avance du total des dés).
-- DETTE : argent négatif du joueur au trait -> phase debt (vendre des bâtiments
--   à moitié prix ; retour automatique dès que l'argent est >= 0). Si même en
--   vendant tout il ne peut pas payer -> faillite immédiate. Un autre joueur
--   endetté (carte « chacun te donne ») vend automatiquement, sinon faillite.
--   Le créancier est toujours payé en entier (la banque éponge la dette).
--   Faillite : biens rendus à la banque (libres, sans bâtiments), cartes
--   « Sortie du violon » remises dans leur paquet, joueur spectateur.
-- FIN : format chrono (à l'échéance, fin du tour du joueur en cours), tours
--   (N tours de table), classique (dernier en lice ; filet 3 h). Classement par
--   fortune = argent + prix des lieux + prix des bâtiments.
-- MINUTEUR : deadline + {"type":"tick"} (action automatique : lancer, tenter le
--   double, piocher, passer l'achat, finir le tour, vendre / faillite). turn_seconds = 0
--   -> pas de minuteur. L'hôte : {"type":"skip"} = joueur absent (marqué away,
--   ses tours sont joués automatiquement jusqu'à ce qu'il agisse / {"type":"back"}).
-- PRÉVU PLUS TARD (non implémenté) : hypothèques, enchères, échanges. Points
--   d'extension : nouvelles actions dans game_tour_des_potes_action, la valeur
--   récupérable d'un joueur est centralisée dans _tdp_sale_value, la fortune
--   dans _tdp_fortune.
-- CAGNOTTE : tax_pot = taxes payées sur les cases 4 / 38 depuis le dernier
--   ramassage (hors fortune) ; le joueur qui s'arrête sur « Pause apéro » (20)
--   la ramasse en entier (évènement 'pot', last_event.pot = montant, stat pot) ; round_rents = {round, payments: [{no,
--   payer, owner, cell, amount}]} = loyers payés pendant le tour de table en
--   cours (no = event_no du log rent ; 60 au plus ; vidé quand round change).
--   States antérieurs sans ces champs : lus avec coalesce.
--
-- server : {"decks": {"hasard": [ids], "potes": [ids]}} (ordre de pioche) ;
--   TEST UNIQUEMENT : "forced_dice": [[a,b], ...] (file de dés imposés, lue par
--   _tdp_roll ; aucun client ne peut écrire match_server_state).
-- =============================================================================

create or replace function public._tdp_iso(p_ts timestamptz)
returns text language sql stable
set search_path = public, extensions
as $$
  select to_char(p_ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$$;

-- Économie du plateau (miroir de src/games/tour-des-potes/board.ts).
-- rents (quartier) = [nu, 1 maison, 2, 3, 4, hôtel] ; house = prix d'une maison.
create or replace function public._tdp_board()
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select '[
    {"i":0,"type":"depart"},
    {"i":1,"type":"quartier","group":"bayon-1","price":60,"house":50,"rents":[2,10,30,90,160,250]},
    {"i":2,"type":"entre_potes"},
    {"i":3,"type":"quartier","group":"bayon-1","price":60,"house":50,"rents":[4,20,60,180,320,450]},
    {"i":4,"type":"taxe","amount":200},
    {"i":5,"type":"potes","group":"potes","price":200},
    {"i":6,"type":"quartier","group":"bayon-2","price":100,"house":50,"rents":[6,30,90,270,400,550]},
    {"i":7,"type":"hasard"},
    {"i":8,"type":"quartier","group":"bayon-2","price":100,"house":50,"rents":[6,30,90,270,400,550]},
    {"i":9,"type":"quartier","group":"bayon-2","price":120,"house":50,"rents":[8,40,100,300,450,600]},
    {"i":10,"type":"violon"},
    {"i":11,"type":"quartier","group":"pugnac-1","price":140,"house":100,"rents":[10,50,150,450,625,750]},
    {"i":12,"type":"service","group":"service","price":150},
    {"i":13,"type":"quartier","group":"pugnac-1","price":140,"house":100,"rents":[10,50,150,450,625,750]},
    {"i":14,"type":"quartier","group":"pugnac-1","price":160,"house":100,"rents":[12,60,180,500,700,900]},
    {"i":15,"type":"potes","group":"potes","price":200},
    {"i":16,"type":"quartier","group":"pugnac-2","price":180,"house":100,"rents":[14,70,200,550,750,950]},
    {"i":17,"type":"entre_potes"},
    {"i":18,"type":"quartier","group":"pugnac-2","price":180,"house":100,"rents":[14,70,200,550,750,950]},
    {"i":19,"type":"quartier","group":"pugnac-2","price":200,"house":100,"rents":[16,80,220,600,800,1000]},
    {"i":20,"type":"apero"},
    {"i":21,"type":"quartier","group":"berson-1","price":220,"house":150,"rents":[18,90,250,700,875,1050]},
    {"i":22,"type":"hasard"},
    {"i":23,"type":"quartier","group":"berson-1","price":220,"house":150,"rents":[18,90,250,700,875,1050]},
    {"i":24,"type":"quartier","group":"berson-1","price":240,"house":150,"rents":[20,100,300,750,925,1100]},
    {"i":25,"type":"potes","group":"potes","price":200},
    {"i":26,"type":"quartier","group":"berson-2","price":260,"house":150,"rents":[22,110,330,800,975,1150]},
    {"i":27,"type":"quartier","group":"berson-2","price":260,"house":150,"rents":[22,110,330,800,975,1150]},
    {"i":28,"type":"service","group":"service","price":150},
    {"i":29,"type":"quartier","group":"berson-2","price":280,"house":150,"rents":[24,120,360,850,1025,1200]},
    {"i":30,"type":"direction_violon"},
    {"i":31,"type":"quartier","group":"bordeaux-1","price":300,"house":200,"rents":[26,130,390,900,1100,1275]},
    {"i":32,"type":"quartier","group":"bordeaux-1","price":300,"house":200,"rents":[26,130,390,900,1100,1275]},
    {"i":33,"type":"entre_potes"},
    {"i":34,"type":"quartier","group":"bordeaux-1","price":320,"house":200,"rents":[28,150,450,1000,1200,1400]},
    {"i":35,"type":"potes","group":"potes","price":200},
    {"i":36,"type":"hasard"},
    {"i":37,"type":"quartier","group":"bordeaux-2","price":350,"house":200,"rents":[35,175,500,1100,1300,1500]},
    {"i":38,"type":"taxe","amount":100},
    {"i":39,"type":"quartier","group":"bordeaux-2","price":400,"house":200,"rents":[50,200,600,1400,1700,2000]}
  ]'::jsonb;
$$;

-- Cartes (textes originaux). kind : move_to {cell} | move_by {steps} |
-- nearest {target: potes|service} | jail | jail_card | gain {amount} |
-- pay {amount} | collect_each {amount} | pay_each {amount} | repairs {house, hotel} |
-- friend_gain / friend_pay {slug, amount} : le pote `slug` te donne / tu donnes au pote
-- (la banque s'il ne joue pas ou si c'est lui qui pioche).
-- Ids : hNN (paquet « hasard »), pNN (paquet « potes » = Entre potes) ; les paquets
-- sont construits dynamiquement (préfixe h/p) : ajouter une carte = ajouter une ligne.
-- h17+/p17+ : cartes « persos » (foot de Marius, muscu de Keke, travaux de Dédé…).
create or replace function public._tdp_cards()
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select '{
    "h01":{"deck":"hasard","kind":"move_to","cell":0,"text":"Le dernier bac part sans toi si tu traînes : file au Départ et empoche 200 €."},
    "h02":{"deck":"hasard","kind":"move_to","cell":39,"text":"Grand dîner chez des amis bordelais : avance jusqu’au dernier lieu de Bordeaux. Si tu passes par le Départ, touche 200 €."},
    "h03":{"deck":"hasard","kind":"move_to","cell":11,"text":"Rendez-vous à la fête des vendanges : avance jusqu’au premier lieu de Pugnac. Si tu passes par le Départ, touche 200 €."},
    "h04":{"deck":"hasard","kind":"move_to","cell":21,"text":"Pique-nique improvisé : avance jusqu’au premier lieu de Berson. Si tu passes par le Départ, touche 200 €."},
    "h05":{"deck":"hasard","kind":"move_to","cell":5,"text":"Apéro surprise chez Dédé & Nini : avance jusqu’à leur maison. Si tu passes par le Départ, touche 200 €."},
    "h06":{"deck":"hasard","kind":"nearest","target":"potes","text":"Covoiturage de dernière minute : avance jusqu’à la maison des potes la plus proche. Si elle a déjà un proprio, paie-lui le double du loyer."},
    "h07":{"deck":"hasard","kind":"nearest","target":"service","text":"Ta voiture fait un drôle de bruit : avance jusqu’au service le plus proche. S’il a un proprio, paie-lui 10 fois les dés."},
    "h08":{"deck":"hasard","kind":"move_by","steps":-3,"text":"Ton GPS t’a perdu au milieu des vignes : recule de 3 cases."},
    "h09":{"deck":"hasard","kind":"jail","text":"Les voisins se plaignent de la musique : direction le violon, sans passer par le Départ ni toucher 200 €."},
    "h10":{"deck":"hasard","kind":"jail_card","text":"Un copain gendarme te doit un service. Carte « Sortie du violon » : garde-la pour plus tard."},
    "h11":{"deck":"hasard","kind":"gain","amount":50,"text":"Tu remportes le concours de pétanque du village : la banque te verse 50 €."},
    "h12":{"deck":"hasard","kind":"gain","amount":150,"text":"Ta cave à vin a pris de la valeur : encaisse 150 €."},
    "h13":{"deck":"hasard","kind":"pay","amount":15,"text":"Flashé·e à 3 km/h au-dessus sur la rocade : paie 15 €."},
    "h14":{"deck":"hasard","kind":"repairs","house":25,"hotel":100,"text":"Gros orage sur l’estuaire : paie 25 € par maison et 100 € par hôtel pour les réparations."},
    "h15":{"deck":"hasard","kind":"pay_each","amount":50,"text":"Tu es désigné·e capitaine de soirée : offre 50 € d’essence à chaque joueur."},
    "h16":{"deck":"hasard","kind":"gain","amount":100,"text":"Ton ticket de tombola de la fête du village est gagnant : touche 100 €."},
    "h17":{"deck":"hasard","kind":"move_to","cell":39,"text":"Marius a match au Stade Chaban-Delmas : file l’encourager ! Si tu passes par le Départ, touche 200 €."},
    "h18":{"deck":"hasard","kind":"pay","amount":30,"text":"Keke t’a traîné·e à la salle de muscu : paie 30 € de séance d’essai. Les courbatures sont offertes."},
    "h20":{"deck":"hasard","kind":"friend_gain","slug":"cycy","amount":100,"text":"Cycy veut absolument aller aux Voûtes et t’invite ! Cycy te donne 100 €."},
    "h21":{"deck":"hasard","kind":"move_to","cell":25,"text":"Manon a perdu sa Switch et ne peut plus jouer à Animal Crossing : file chez Karo, Manon & Marius pour aider à la chercher ! Si tu passes par le Départ, touche 200 €."},
    "h22":{"deck":"hasard","kind":"friend_gain","slug":"mika","amount":50,"text":"Grâce à ton coup de main, Mika a fini son chantier en avance : Mika te donne 50 €."},
    "h23":{"deck":"hasard","kind":"move_by","steps":-3,"text":"Promenade avec Cécile et Kaya : Kaya a flairé une piste et fait demi-tour. Recule de 3 cases."},
    "h24":{"deck":"hasard","kind":"friend_pay","slug":"carole","amount":50,"text":"Journée plage avec Karo : c’est toi qui offres les glaces. Donne 50 € à Karo."},
    "h19":{"deck":"hasard","kind":"repairs","house":20,"hotel":80,"text":"Dédé débarque avec la caisse à outils pour « juste un petit coup de peinture » : paie 20 € par maison et 80 € par hôtel."},
    "p01":{"deck":"potes","kind":"move_to","cell":0,"text":"On t’a confié les clés de la salle des fêtes : retourne au Départ et touche 200 €."},
    "p02":{"deck":"potes","kind":"collect_each","amount":10,"text":"C’est ta crémaillère ! Chaque joueur te donne 10 € pour la déco."},
    "p03":{"deck":"potes","kind":"collect_each","amount":20,"text":"Ta playlist a fait danser tout le monde jusqu’à l’aube : chaque joueur te donne 20 €."},
    "p04":{"deck":"potes","kind":"pay","amount":50,"text":"Tu as oublié le dessert : file à la boulangerie, paie 50 €."},
    "p05":{"deck":"potes","kind":"gain","amount":100,"text":"La cagnotte du week-end entre potes te rembourse : touche 100 €."},
    "p06":{"deck":"potes","kind":"jail_card","text":"Tu connais le patron du bar d’en face. Carte « Sortie du violon » : garde-la pour plus tard."},
    "p07":{"deck":"potes","kind":"jail","text":"Le karaoké a un peu trop dérapé : direction le violon, sans passer par le Départ ni toucher 200 €."},
    "p08":{"deck":"potes","kind":"pay","amount":100,"text":"Facture du traiteur pour la soirée déguisée : paie 100 €."},
    "p09":{"deck":"potes","kind":"gain","amount":25,"text":"Deuxième au quiz du bar : touche 25 €."},
    "p10":{"deck":"potes","kind":"gain","amount":50,"text":"Tu retrouves un billet dans la poche de ta veste de l’hiver dernier : touche 50 €."},
    "p11":{"deck":"potes","kind":"repairs","house":40,"hotel":115,"text":"Ravalement de façade obligatoire : paie 40 € par maison et 115 € par hôtel."},
    "p12":{"deck":"potes","kind":"gain","amount":75,"text":"Vide-grenier réussi : tu as enfin vendu le vieux canapé. Touche 75 €."},
    "p13":{"deck":"potes","kind":"pay_each","amount":20,"text":"Tournée de chocolatines pour toute la bande : paie 20 € à chaque joueur."},
    "p14":{"deck":"potes","kind":"pay","amount":30,"text":"Tu as perdu ton pari sur le match de foot : paie 30 €."},
    "p15":{"deck":"potes","kind":"gain","amount":20,"text":"Remboursement de covoiturage : touche 20 €."},
    "p16":{"deck":"potes","kind":"gain","amount":10,"text":"Ta tarte aux fraises remporte le concours de la kermesse : touche 10 €."},
    "p17":{"deck":"potes","kind":"pay","amount":50,"text":"Tu pars voir le match de foot de Marius : tu paies ton coup à boire à la buvette. Paie 50 €."},
    "p18":{"deck":"potes","kind":"move_by","steps":-3,"text":"Séance jambes avec Keke : tu ne sens plus tes cuisses. Recule de 3 cases."},
    "p20":{"deck":"potes","kind":"friend_pay","slug":"cycy","amount":100,"text":"Cycy veut absolument aller aux Voûtes… et c’est toi qui invites ! Donne 100 € à Cycy."},
    "p21":{"deck":"potes","kind":"friend_pay","slug":"mika","amount":50,"text":"Mika a besoin d’aide pour son chantier : donne 50 € à Mika pour le matériel."},
    "p22":{"deck":"potes","kind":"move_by","steps":3,"text":"Promenade avec Cécile et Kaya : Kaya tire sur la laisse ! Avance de 3 cases."},
    "p23":{"deck":"potes","kind":"friend_gain","slug":"carole","amount":50,"text":"Journée plage avec Karo ! Karo t’offre les glaces : Karo te donne 50 €."},
    "p24":{"deck":"potes","kind":"pay","amount":30,"text":"Rendez-vous chez le toiletteur pour Irubie avec Nini : paie 30 €."},
    "p19":{"deck":"potes","kind":"gain","amount":50,"text":"Tu as donné un coup de main à Dédé sur le chantier tout le week-end : touche 50 € (et un apéro bien mérité)."}
  }'::jsonb;
$$;

create or replace function public._tdp_cell(p_i integer)
returns jsonb language sql immutable
set search_path = public, extensions
as $$ select public._tdp_board()->p_i; $$;

create or replace function public._tdp_group_cells(p_group text)
returns integer[] language sql immutable
set search_path = public, extensions
as $$
  select coalesce(array_agg((c->>'i')::integer order by (c->>'i')::integer), '{}')
    from jsonb_array_elements(public._tdp_board()) as c
   where c->>'group' = p_group;
$$;

create or replace function public._tdp_level(p_s jsonb, p_cell integer)
returns integer language sql immutable
set search_path = public, extensions
as $$ select coalesce((p_s->'buildings'->>p_cell::text)::integer, 0); $$;

create or replace function public._tdp_owns_group(p_s jsonb, p_p text, p_group text)
returns boolean language sql immutable
set search_path = public, extensions
as $$
  select not exists (select 1 from unnest(public._tdp_group_cells(p_group)) as x
                      where p_s->'owners'->>x::text is distinct from p_p);
$$;

-- Loyer de la case p_cell (0 si libre). p_mode 'card' : maison des potes ×2,
-- service = dés ×10 (cartes « la plus proche »).
create or replace function public._tdp_rent(p_s jsonb, p_cell integer, p_dice integer, p_mode text)
returns integer language plpgsql immutable
set search_path = public, extensions
as $$
declare
  c   jsonb := public._tdp_cell(p_cell);
  o   text := p_s->'owners'->>p_cell::text;
  n   integer;
  lvl integer;
  r   integer;
begin
  if o is null then return 0; end if;
  if c->>'type' = 'quartier' then
    lvl := public._tdp_level(p_s, p_cell);
    if lvl > 0 then return (c->'rents'->>lvl)::integer; end if;
    r := (c->'rents'->>0)::integer;
    if public._tdp_owns_group(p_s, o, c->>'group') then r := r * 2; end if;
    return r;
  end if;
  select count(*)::integer into n
    from jsonb_each_text(p_s->'owners') as e(k, val)
   where val = o and public._tdp_cell(k::integer)->>'type' = c->>'type';
  if c->>'type' = 'potes' then
    r := 25 * (2 ^ (n - 1))::integer;
    if p_mode = 'card' then r := r * 2; end if;
    return r;
  end if;
  if c->>'type' = 'service' then
    if p_mode = 'card' or n >= 2 then return p_dice * 10; end if;
    return p_dice * 4;
  end if;
  return 0;
end $$;

create or replace function public._tdp_props_value(p_s jsonb, p_p text)
returns integer language sql immutable
set search_path = public, extensions
as $$
  select coalesce(sum((public._tdp_cell(k::integer)->>'price')::integer), 0)::integer
    from jsonb_each_text(p_s->'owners') as e(k, val) where val = p_p;
$$;

create or replace function public._tdp_build_value(p_s jsonb, p_p text)
returns integer language sql immutable
set search_path = public, extensions
as $$
  select coalesce(sum(public._tdp_level(p_s, k::integer)
                      * coalesce((public._tdp_cell(k::integer)->>'house')::integer, 0)), 0)::integer
    from jsonb_each_text(p_s->'owners') as e(k, val) where val = p_p;
$$;

-- Ce qu'un joueur peut récupérer en liquidant (bâtiments à moitié prix).
-- Point d'extension (hypothèques plus tard).
create or replace function public._tdp_sale_value(p_s jsonb, p_p text)
returns integer language sql immutable
set search_path = public, extensions
as $$
  select coalesce(sum(public._tdp_level(p_s, k::integer)
                      * (coalesce((public._tdp_cell(k::integer)->>'house')::integer, 0) / 2)), 0)::integer
    from jsonb_each_text(p_s->'owners') as e(k, val) where val = p_p;
$$;

create or replace function public._tdp_fortune(p_s jsonb, p_p text)
returns integer language sql immutable
set search_path = public, extensions
as $$
  select coalesce((p_s->'cash'->>p_p)::integer, 0)
         + public._tdp_props_value(p_s, p_p) + public._tdp_build_value(p_s, p_p);
$$;

-- Journal : ajoute l'évènement (numéroté) à log (40 derniers) et à events
-- (évènements produits par l'action en cours, 80 au plus).
create or replace function public._tdp_log(p_s jsonb, p_e jsonb)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  n  integer := coalesce((p_s->>'event_no')::integer, 0) + 1;
  e  jsonb := p_e || jsonb_build_object('no', n);
  lg jsonb := coalesce(p_s->'log', '[]'::jsonb) || jsonb_build_array(e);
  ev jsonb := coalesce(p_s->'events', '[]'::jsonb) || jsonb_build_array(e);
begin
  while jsonb_array_length(lg) > 40 loop lg := lg - 0; end loop;
  while jsonb_array_length(ev) > 80 loop ev := ev - 0; end loop;
  return p_s || jsonb_build_object('event_no', n, 'log', lg, 'events', ev);
end $$;

-- Complète last_event (évènement « case atteinte » affiché sur tous les écrans).
create or replace function public._tdp_le(p_s jsonb, p_patch jsonb)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select p_s || jsonb_build_object('last_event', coalesce(p_s->'last_event', '{}'::jsonb) || p_patch);
$$;

create or replace function public._tdp_stat(p_s jsonb, p_p text, p_key text, p_delta integer)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select jsonb_set(p_s, array['stats', p_p, p_key],
                   to_jsonb(coalesce((p_s->'stats'->p_p->>p_key)::integer, 0) + p_delta));
$$;

-- Mouvement d'argent (null = banque).
create or replace function public._tdp_transfer(p_s jsonb, p_from text, p_to text, p_amount integer)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
begin
  if coalesce(p_amount, 0) = 0 then return p_s; end if;
  if p_from is not null then
    p_s := jsonb_set(p_s, array['cash', p_from], to_jsonb((p_s->'cash'->>p_from)::integer - p_amount));
  end if;
  if p_to is not null then
    p_s := jsonb_set(p_s, array['cash', p_to], to_jsonb((p_s->'cash'->>p_to)::integer + p_amount));
  end if;
  return p_s;
end $$;

create or replace function public._tdp_deadline(p_s jsonb, p_grace integer)
returns jsonb language sql stable
set search_path = public, extensions
as $$
  select p_s || jsonb_build_object('deadline',
    case when coalesce((p_s->>'turn_seconds')::integer, 0) > 0
         then to_jsonb(public._tdp_iso(now() + make_interval(secs => (p_s->>'turn_seconds')::integer + p_grace)))
         else 'null'::jsonb end);
$$;

-- Deux dés (file forced_dice du server en test).
create or replace function public._tdp_roll(g jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v jsonb := g->'v';
  f jsonb := g->'v'->'forced_dice';
  a integer;
  b integer;
begin
  if jsonb_typeof(f) = 'array' and jsonb_array_length(f) > 0 then
    a := (f->0->>0)::integer;
    b := (f->0->>1)::integer;
    v := jsonb_set(v, '{forced_dice}', f - 0);
  else
    a := 1 + floor(random() * 6)::integer;
    b := 1 + floor(random() * 6)::integer;
  end if;
  return jsonb_build_object('s', jsonb_set(g->'s', '{dice}', jsonb_build_array(a, b)), 'v', v);
end $$;

-- Avance de p_steps (> 0) : +200 en passant / s'arrêtant sur le Départ.
create or replace function public._tdp_advance(p_s jsonb, p_p text, p_steps integer)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  a integer := (p_s->'pos'->>p_p)::integer;
begin
  p_s := jsonb_set(p_s, array['pos', p_p], to_jsonb((a + p_steps) % 40));
  if a + p_steps >= 40 then
    p_s := public._tdp_transfer(p_s, null, p_p, 200);
    p_s := public._tdp_log(p_s, jsonb_build_object('player', p_p, 'kind', 'pass_go', 'amount', 200));
    p_s := public._tdp_stat(p_s, p_p, 'laps', 1);
    if p_s->'last_event'->>'player' = p_p then
      p_s := public._tdp_le(p_s, jsonb_build_object('passed_go', true));
    end if;
  end if;
  return p_s;
end $$;

create or replace function public._tdp_to_jail(p_s jsonb, p_p text, p_reason text)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
begin
  p_s := jsonb_set(p_s, array['pos', p_p], '10'::jsonb);
  p_s := jsonb_set(p_s, array['jail', p_p], '0'::jsonb);
  if p_s->>'turn' = p_p then p_s := p_s || jsonb_build_object('doubles', 0); end if;
  p_s := public._tdp_log(p_s, jsonb_build_object('player', p_p, 'kind', 'jail', 'reason', p_reason, 'cell', 10));
  p_s := public._tdp_stat(p_s, p_p, 'jail', 1);
  return public._tdp_le(p_s, jsonb_build_object('jail', p_reason, 'cell', 10));
end $$;

-- Loyer payé : ajouté à round_rents (tour de table en cours ; no = dernier
-- event_no, celui du log rent qui vient d'être écrit ; 60 entrées au plus).
create or replace function public._tdp_add_rent(p_s jsonb, p_payer text, p_owner text, p_cell integer, p_amount integer)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  rnd integer := coalesce((p_s->>'round')::integer, 1);
  pay jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_s->'round_rents') = 'object'
     and (p_s->'round_rents'->>'round')::integer = rnd
     and jsonb_typeof(p_s->'round_rents'->'payments') = 'array' then
    pay := p_s->'round_rents'->'payments';
  end if;
  pay := pay || jsonb_build_array(jsonb_build_object(
    'no', (p_s->>'event_no')::integer, 'payer', p_payer, 'owner', p_owner,
    'cell', p_cell, 'amount', p_amount));
  while jsonb_array_length(pay) > 60 loop pay := pay - 0; end loop;
  return p_s || jsonb_build_object('round_rents', jsonb_build_object('round', rnd, 'payments', pay));
end $$;

-- Résolution de la case où se trouve p_p. g = {s: state, v: server}.
-- p_depth = 0 : case atteinte par les dés (case carte -> phase card) ;
-- > 0 : déplacement par carte (case carte -> pioche immédiate, jusqu'à 4).
create or replace function public._tdp_land(g jsonb, p_p text, p_depth integer, p_mode text)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  s   jsonb := g->'s';
  v   jsonb := g->'v';
  i   integer := (g->'s'->'pos'->>p_p)::integer;
  c   jsonb := public._tdp_cell((g->'s'->'pos'->>p_p)::integer);
  t   text;
  o   text;
  amt integer;
  ds  integer;
begin
  t := c->>'type';
  s := public._tdp_le(s, jsonb_build_object('cell', i));
  if t in ('quartier', 'potes', 'service') then
    o := s->'owners'->>i::text;
    if o is null then
      s := s || jsonb_build_object('phase', 'buy',
                                   'pending', jsonb_build_object('cell', i, 'price', (c->>'price')::integer));
    elsif o <> p_p then
      ds := coalesce((s->'dice'->>0)::integer + (s->'dice'->>1)::integer, 7);
      amt := public._tdp_rent(s, i, ds, p_mode);
      s := public._tdp_transfer(s, p_p, o, amt);
      s := public._tdp_log(s, jsonb_build_object('player', p_p, 'kind', 'rent', 'cell', i, 'amount', amt, 'to', o));
      s := public._tdp_add_rent(s, p_p, o, i, amt);
      s := public._tdp_stat(s, p_p, 'rent_paid', amt);
      s := public._tdp_stat(s, o, 'rent_received', amt);
      s := public._tdp_le(s, jsonb_build_object('rent', jsonb_build_object('to', o, 'amount', amt)));
    end if;
  elsif t = 'taxe' then
    amt := (c->>'amount')::integer;
    s := public._tdp_transfer(s, p_p, null, amt);
    s := public._tdp_log(s, jsonb_build_object('player', p_p, 'kind', 'tax', 'cell', i, 'amount', amt));
    s := s || jsonb_build_object('tax_pot', coalesce((s->>'tax_pot')::integer, 0) + amt);
    s := public._tdp_le(s, jsonb_build_object('tax', amt));
  elsif t in ('hasard', 'entre_potes') then
    if p_depth = 0 then
      -- Atteinte directement par les dés : le joueur piochera lui-même (draw).
      s := s || jsonb_build_object('phase', 'card',
                                   'pending', jsonb_build_object('cell', i,
                                     'deck', case t when 'hasard' then 'hasard' else 'potes' end));
    elsif p_depth < 4 then
      return public._tdp_card(jsonb_build_object('s', s, 'v', v), p_p,
                              case t when 'hasard' then 'hasard' else 'potes' end, p_depth);
    end if;
  elsif t = 'apero' then
    -- Pause apéro : le joueur ramasse toute la cagnotte des taxes.
    amt := coalesce((s->>'tax_pot')::integer, 0);
    if amt > 0 then
      s := public._tdp_transfer(s, null, p_p, amt);
      s := public._tdp_log(s, jsonb_build_object('player', p_p, 'kind', 'pot', 'cell', i, 'amount', amt));
      s := public._tdp_stat(s, p_p, 'pot', amt);
      s := s || jsonb_build_object('tax_pot', 0);
      s := public._tdp_le(s, jsonb_build_object('pot', amt));
    end if;
  elsif t = 'direction_violon' then
    s := public._tdp_to_jail(s, p_p, 'case');
  end if;
  return jsonb_build_object('s', s, 'v', v);
end $$;

-- Pioche et applique une carte.
create or replace function public._tdp_card(g jsonb, p_p text, p_deck text, p_depth integer)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  s        jsonb := g->'s';
  v        jsonb := g->'v';
  deck     jsonb := coalesce(g->'v'->'decks'->p_deck, '[]'::jsonb);
  id       text;
  c        jsonb;
  k        text;
  pos      integer := (g->'s'->'pos'->>p_p)::integer;
  target   integer;
  q        text;
  amt      integer := null;
  n_house  integer;
  n_hotel  integer;
  cnt      integer;
begin
  if jsonb_array_length(deck) = 0 then return g; end if;
  id := deck->>0;
  deck := deck - 0;
  c := public._tdp_cards()->id;
  k := c->>'kind';
  if k = 'jail_card' then
    s := jsonb_set(s, array['jail_cards', p_p], coalesce(s->'jail_cards'->p_p, '[]'::jsonb) || to_jsonb(id));
  else
    deck := deck || to_jsonb(id);
  end if;
  v := jsonb_set(v, array['decks', p_deck], deck);

  -- Montant calculé (pour l'affichage).
  if k in ('gain', 'pay', 'friend_gain', 'friend_pay') then
    amt := (c->>'amount')::integer;
  elsif k in ('collect_each', 'pay_each') then
    select count(*)::integer into cnt from jsonb_array_elements_text(s->'alive') as x where x <> p_p;
    amt := (c->>'amount')::integer * cnt;
  elsif k = 'repairs' then
    select coalesce(sum(case when public._tdp_level(s, key::integer) between 1 and 4
                             then public._tdp_level(s, key::integer) else 0 end), 0)::integer,
           (count(*) filter (where public._tdp_level(s, key::integer) = 5))::integer
      into n_house, n_hotel
      from jsonb_each_text(s->'owners') where value = p_p;
    amt := n_house * (c->>'house')::integer + n_hotel * (c->>'hotel')::integer;
  end if;

  s := public._tdp_log(s, jsonb_build_object('player', p_p, 'kind', 'card', 'deck', p_deck, 'card', id,
                                             'text', c->>'text', 'card_kind', k, 'amount', amt));
  s := public._tdp_stat(s, p_p, 'cards', 1);
  s := public._tdp_le(s, jsonb_build_object('card', jsonb_build_object('deck', p_deck, 'id', id, 'text', c->>'text',
                                                                      'kind', k, 'amount', amt)));

  if k = 'move_to' then
    target := (c->>'cell')::integer;
    s := public._tdp_log(s, jsonb_build_object('player', p_p, 'kind', 'move', 'from', pos, 'cell', target));
    s := public._tdp_advance(s, p_p, (target - pos + 40) % 40);
    return public._tdp_land(jsonb_build_object('s', s, 'v', v), p_p, p_depth + 1, 'normal');
  elsif k = 'move_by' then
    target := (pos + (c->>'steps')::integer + 40) % 40;
    if (c->>'steps')::integer > 0 then
      s := public._tdp_advance(s, p_p, (c->>'steps')::integer); -- en avant : +200 si on passe le Départ
    else
      s := jsonb_set(s, array['pos', p_p], to_jsonb(target));
    end if;
    s := public._tdp_log(s, jsonb_build_object('player', p_p, 'kind', 'move', 'from', pos, 'cell', target));
    return public._tdp_land(jsonb_build_object('s', s, 'v', v), p_p, p_depth + 1, 'normal');
  elsif k = 'nearest' then
    select coalesce(
             (select (x->>'i')::integer from jsonb_array_elements(public._tdp_board()) as x
               where x->>'type' = c->>'target' and (x->>'i')::integer > pos order by (x->>'i')::integer limit 1),
             (select (x->>'i')::integer from jsonb_array_elements(public._tdp_board()) as x
               where x->>'type' = c->>'target' order by (x->>'i')::integer limit 1))
      into target;
    s := public._tdp_log(s, jsonb_build_object('player', p_p, 'kind', 'move', 'from', pos, 'cell', target));
    s := public._tdp_advance(s, p_p, (target - pos + 40) % 40);
    return public._tdp_land(jsonb_build_object('s', s, 'v', v), p_p, p_depth + 1, 'card');
  elsif k = 'jail' then
    s := public._tdp_to_jail(s, p_p, 'card');
  elsif k = 'gain' then
    s := public._tdp_transfer(s, null, p_p, amt);
  elsif k in ('pay', 'repairs') then
    s := public._tdp_transfer(s, p_p, null, amt);
  elsif k = 'collect_each' then
    for q in select jsonb_array_elements_text(s->'alive') loop
      if q <> p_p then s := public._tdp_transfer(s, q, p_p, (c->>'amount')::integer); end if;
    end loop;
  elsif k = 'pay_each' then
    for q in select jsonb_array_elements_text(s->'alive') loop
      if q <> p_p then s := public._tdp_transfer(s, p_p, q, (c->>'amount')::integer); end if;
    end loop;
  elsif k in ('friend_gain', 'friend_pay') then
    -- Carte perso : l'argent passe par le pote nommé s'il joue encore (et n'est pas
    -- celui qui pioche) ; sinon c'est la banque qui paie / encaisse.
    select a into q
      from jsonb_array_elements_text(s->'alive') as a
      join public.profiles pr on pr.id::text = a
     where pr.slug = c->>'slug' and a <> p_p
     limit 1;
    if k = 'friend_gain' then
      s := public._tdp_transfer(s, q, p_p, amt);
    else
      s := public._tdp_transfer(s, p_p, q, amt);
    end if;
  end if;
  return jsonb_build_object('s', s, 'v', v);
end $$;

-- Vente automatique de bâtiments (du plus haut niveau, puis du plus cher)
-- jusqu'à ce que l'argent soit >= 0 ou qu'il n'y ait plus rien à vendre.
create or replace function public._tdp_liquidate(p_s jsonb, p_p text)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  cell integer;
  lvl  integer;
  half integer;
  i    integer;
begin
  for i in 1 .. 200 loop
    exit when (p_s->'cash'->>p_p)::integer >= 0;
    select key::integer into cell
      from jsonb_each_text(p_s->'owners')
     where value = p_p and public._tdp_level(p_s, key::integer) > 0
     order by public._tdp_level(p_s, key::integer) desc,
              (public._tdp_cell(key::integer)->>'house')::integer desc, key::integer desc
     limit 1;
    exit when cell is null;
    lvl := public._tdp_level(p_s, cell) - 1;
    half := (public._tdp_cell(cell)->>'house')::integer / 2;
    if lvl = 0 then
      p_s := jsonb_set(p_s, '{buildings}', (p_s->'buildings') - cell::text);
    else
      p_s := jsonb_set(p_s, array['buildings', cell::text], to_jsonb(lvl));
    end if;
    p_s := public._tdp_transfer(p_s, null, p_p, half);
    p_s := public._tdp_log(p_s, jsonb_build_object('player', p_p, 'kind', 'sell', 'cell', cell, 'level', lvl,
                                                   'amount', half, 'auto', true));
  end loop;
  return p_s;
end $$;

-- Stats de fin de partie pour les trophées (features/trophees.sql), lues dans state.stats / owners / buildings.
-- p_other_max = fortune du meilleur autre joueur (0 pour un failli) ; p_n = nombre de joueurs.
create or replace function public._tdp_tstats(s jsonb, p_p text, p_bk boolean, p_rk integer, p_f integer, p_other_max integer, p_n integer)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'jail', coalesce((s->'stats'->p_p->>'jail')::integer, 0),
    'bankrupt', case when p_bk then 1 else 0 end,
    'rent_paid', coalesce((s->'stats'->p_p->>'rent_paid')::integer, 0),
    'rent_received', coalesce((s->'stats'->p_p->>'rent_received')::integer, 0),
    'bought', coalesce((s->'stats'->p_p->>'bought')::integer, 0),
    'laps', coalesce((s->'stats'->p_p->>'laps')::integer, 0),
    'pot', coalesce((s->'stats'->p_p->>'pot')::integer, 0),
    'cards', coalesce((s->'stats'->p_p->>'cards')::integer, 0),
    'hotel', case when not p_bk and exists (select 1 from jsonb_each_text(coalesce(s->'owners', '{}'::jsonb)) e
                       where e.value = p_p and public._tdp_level(s, e.key::integer) >= 5) then 1 else 0 end,
    'monopoly', case when not p_bk and (select count(distinct c->>'group') from jsonb_array_elements(public._tdp_board()) c
                       where c->>'type' = 'quartier' and public._tdp_owns_group(s, p_p, c->>'group')) >= 2 then 1 else 0 end,
    'tycoon', case when p_rk = 1 and p_n >= 3 and p_f > 0 and p_f >= 2 * greatest(coalesce(p_other_max, 0), 0) then 1 else 0 end)
$$;

-- Fin de partie : classement par fortune (en lice), puis faillis (le dernier
-- failli d'abord). Égalité de fortune = même rang (partagé).
create or replace function public._tdp_finish(g jsonb, p_reason text)
returns jsonb language plpgsql stable
set search_path = public, extensions
as $$
declare
  s       jsonb := g->'s';
  n       integer := jsonb_array_length(g->'s'->'players');
  nalive  integer := jsonb_array_length(g->'s'->'alive');
  nbk     integer := jsonb_array_length(coalesce(g->'s'->'bankrupt', '[]'::jsonb));
  ranking jsonb;
  results jsonb;
  winners jsonb;
begin
  with a as (
    select x as p, public._tdp_fortune(s, x) as f, o::integer as o
      from jsonb_array_elements_text(s->'alive') with ordinality as t(x, o)
  ), r as (
    select a.p, a.f, a.o, 1 + (select count(*) from a a2 where a2.f > a.f)::integer as rk, false as bk from a
    union all
    select x, 0, 1000 + o::integer, nalive + (nbk - o::integer + 1), true
      from jsonb_array_elements_text(coalesce(s->'bankrupt', '[]'::jsonb)) with ordinality as t(x, o)
  )
  select jsonb_agg(jsonb_build_object(
           'player', r.p, 'rank', r.rk, 'fortune', r.f,
           'cash', case when r.bk then 0 else (s->'cash'->>r.p)::integer end,
           'properties', public._tdp_props_value(s, r.p), 'buildings', public._tdp_build_value(s, r.p),
           'owned', (select count(*) from jsonb_each_text(s->'owners') e where e.value = r.p),
           'bankrupt', r.bk) order by r.rk, r.o),
         jsonb_agg(jsonb_build_object('profile_id', r.p, 'placement', r.rk, 'points', n - r.rk + 1,
                                      'won', r.rk = 1,
                                      'stats', public._tdp_tstats(s, r.p, r.bk, r.rk, r.f,
                                                 (select max(r2.f) from r r2 where r2.p <> r.p), n)) order by r.rk, r.o),
         coalesce(jsonb_agg(r.p order by r.o) filter (where r.rk = 1), '[]'::jsonb)
    into ranking, results, winners
    from r;
  s := public._tdp_log(s, jsonb_build_object('player', null, 'kind', 'finish', 'reason', p_reason));
  s := s || jsonb_build_object(
    'phase', 'finished',
    'deadline', null,
    'pending', null,
    'end_reason', p_reason,
    'winners', winners,
    'ranking', ranking,
    'results', results);
  return jsonb_build_object('s', s, 'v', g->'v');
end $$;

-- Faillite de p_p : biens à la banque, cartes rendues, spectateur.
create or replace function public._tdp_bankrupt(g jsonb, p_p text)
returns jsonb language plpgsql stable
set search_path = public, extensions
as $$
declare
  s  jsonb := g->'s';
  v  jsonb := g->'v';
  ow jsonb;
  bd jsonb;
  id text;
  dk text;
begin
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into bd
    from jsonb_each(coalesce(s->'buildings', '{}'::jsonb))
   where s->'owners'->>key is distinct from p_p;
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into ow
    from jsonb_each(coalesce(s->'owners', '{}'::jsonb))
   where value #>> '{}' <> p_p;
  for id in select jsonb_array_elements_text(coalesce(s->'jail_cards'->p_p, '[]'::jsonb)) loop
    dk := case when id like 'h%' then 'hasard' else 'potes' end;
    v := jsonb_set(v, array['decks', dk], coalesce(v->'decks'->dk, '[]'::jsonb) || to_jsonb(id));
  end loop;
  s := public._tdp_log(s, jsonb_build_object('player', p_p, 'kind', 'bankrupt',
                                             'amount', (s->'cash'->>p_p)::integer));
  s := s || jsonb_build_object(
    'owners', ow,
    'buildings', bd,
    'alive', (s->'alive') - p_p,
    'bankrupt', coalesce(s->'bankrupt', '[]'::jsonb) || to_jsonb(p_p),
    'jail', coalesce(s->'jail', '{}'::jsonb) - p_p,
    'jail_cards', coalesce(s->'jail_cards', '{}'::jsonb) - p_p,
    'away', coalesce(s->'away', '[]'::jsonb) - p_p);
  s := jsonb_set(s, array['cash', p_p], '0'::jsonb);
  g := jsonb_build_object('s', s, 'v', v);
  if jsonb_array_length(s->'alive') <= 1 then
    g := public._tdp_finish(g, 'last_standing');
  end if;
  return g;
end $$;

-- Tour suivant (ou fin de partie : tours atteints / échéance chrono / filet 3 h).
create or replace function public._tdp_next_turn(g jsonb)
returns jsonb language plpgsql stable
set search_path = public, extensions
as $$
declare
  s    jsonb := g->'s';
  ord  text[] := array(select jsonb_array_elements_text(g->'s'->'order'));
  n    integer;
  cur  integer;
  idx  integer;
  nxt  text := null;
  rnd  integer := coalesce((g->'s'->>'round')::integer, 1);
  i    integer;
begin
  if s->>'phase' = 'finished' then return g; end if;
  n := cardinality(ord);
  cur := coalesce(array_position(ord, s->>'turn'), 1);
  idx := cur;
  for i in 1 .. n loop
    idx := idx % n + 1;
    if (s->'alive') ? ord[idx] then nxt := ord[idx]; exit; end if;
  end loop;
  if nxt is null then return public._tdp_finish(g, 'last_standing'); end if;
  if idx <= cur then rnd := rnd + 1; end if;

  if s->>'format' = 'tours' and rnd > (s->>'total_rounds')::integer then
    return public._tdp_finish(g, 'rounds');
  end if;
  if s->>'ends_at' is not null and now() >= (s->>'ends_at')::timestamptz then
    return public._tdp_finish(g, case when s->>'format' = 'chrono' then 'time' else 'safety' end);
  end if;

  s := s || jsonb_build_object(
    'round', rnd,
    'round_rents', case when coalesce((s->'round_rents'->>'round')::integer, -1) = rnd
                       and jsonb_typeof(s->'round_rents'->'payments') = 'array'
                       then s->'round_rents'
                       else jsonb_build_object('round', rnd, 'payments', '[]'::jsonb) end,
    'turn', nxt,
    'turn_no', coalesce((s->>'turn_no')::integer, 0) + 1,
    'doubles', 0,
    'pending', null,
    'phase', case when coalesce(s->'jail', '{}'::jsonb) ? nxt then 'jail' else 'roll' end);
  s := public._tdp_log(s, jsonb_build_object('player', nxt, 'kind', 'turn', 'round', rnd,
                                             'turn_no', (s->>'turn_no')::integer));
  s := public._tdp_deadline(s, 0);
  return jsonb_build_object('s', s, 'v', g->'v');
end $$;

-- Après une résolution (lancer, pioche, achat, vente en dette…) : dettes des
-- autres joueurs (vente auto / faillite), puis phase du joueur au trait
-- (buy / card conservées, sinon roll après un double, sinon manage).
create or replace function public._tdp_settle(g jsonb)
returns jsonb language plpgsql stable
set search_path = public, extensions
as $$
declare
  s jsonb;
  t text;
  q text;
begin
  for q in select jsonb_array_elements_text(g->'s'->'alive') loop
    exit when g->'s'->>'phase' = 'finished';
    if q is distinct from g->'s'->>'turn' and (g->'s'->'cash'->>q)::integer < 0 then
      g := jsonb_set(g, '{s}', public._tdp_liquidate(g->'s', q));
      if (g->'s'->'cash'->>q)::integer < 0 then g := public._tdp_bankrupt(g, q); end if;
    end if;
  end loop;
  s := g->'s';
  if s->>'phase' = 'finished' then return g; end if;
  t := s->>'turn';

  if (s->'cash'->>t)::integer < 0 then
    if s->>'phase' = 'buy' then
      s := public._tdp_log(s, jsonb_build_object('player', t, 'kind', 'pass_buy',
                                                 'cell', (s->'pending'->>'cell')::integer));
      s := s || jsonb_build_object('pending', null);
    elsif s->>'phase' = 'card' then
      s := s || jsonb_build_object('pending', null);  -- (ne devrait pas arriver) pas de pioche endetté
    end if;
    if (s->'cash'->>t)::integer + public._tdp_sale_value(s, t) < 0 then
      g := public._tdp_bankrupt(jsonb_build_object('s', s, 'v', g->'v'), t);
      return public._tdp_next_turn(g);
    end if;
    s := s || jsonb_build_object('phase', 'debt');
    s := public._tdp_log(s, jsonb_build_object('player', t, 'kind', 'debt',
                                               'amount', -(s->'cash'->>t)::integer));
  elsif s->>'phase' not in ('buy', 'card') then
    s := s || jsonb_build_object('phase',
      case when coalesce((s->>'doubles')::integer, 0) > 0 and not (coalesce(s->'jail', '{}'::jsonb) ? t)
           then 'roll' else 'manage' end);
  end if;
  s := public._tdp_deadline(s, 0);
  return jsonb_build_object('s', s, 'v', g->'v');
end $$;

-- Nouveau last_event (lancer de dés du joueur au trait).
create or replace function public._tdp_new_event(p_s jsonb, p_t text, p_from integer)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select p_s || jsonb_build_object('last_event', jsonb_build_object(
    'no', (p_s->>'event_no')::integer, 'turn_no', (p_s->>'turn_no')::integer, 'player', p_t,
    'dice', p_s->'dice', 'double', (p_s->'dice'->>0) = (p_s->'dice'->>1),
    'from', p_from, 'cell', p_from, 'passed_go', false, 'rent', null, 'tax', null, 'card', null,
    'bought', false, 'jail', null));
$$;

-- Lancer normal (phase roll).
create or replace function public._tdp_do_roll(g jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  t     text := g->'s'->>'turn';
  s     jsonb;
  a     integer;
  b     integer;
  v_from integer;
  dbl   integer;
begin
  g := public._tdp_roll(g);
  s := g->'s';
  a := (s->'dice'->>0)::integer;
  b := (s->'dice'->>1)::integer;
  v_from := (s->'pos'->>t)::integer;
  dbl := case when a = b then coalesce((s->>'doubles')::integer, 0) + 1 else 0 end;
  s := s || jsonb_build_object('doubles', dbl);
  s := public._tdp_log(s, jsonb_build_object('player', t, 'kind', 'roll', 'dice', s->'dice', 'from', v_from,
                                             'cell', case when dbl >= 3 then 10 else (v_from + a + b) % 40 end,
                                             'double', a = b, 'doubles', dbl));
  s := public._tdp_new_event(s, t, v_from);
  if dbl >= 3 then
    s := public._tdp_to_jail(s, t, 'triple');
    return public._tdp_settle(jsonb_build_object('s', s, 'v', g->'v'));
  end if;
  s := public._tdp_advance(s, t, a + b);
  g := public._tdp_land(jsonb_build_object('s', s, 'v', g->'v'), t, 0, 'normal');
  return public._tdp_settle(g);
end $$;

-- Lancer au violon (phase jail) : tenter un double.
create or replace function public._tdp_jail_roll(g jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  t   text := g->'s'->>'turn';
  s   jsonb;
  a   integer;
  b   integer;
  att integer;
begin
  g := public._tdp_roll(g);
  s := g->'s';
  a := (s->'dice'->>0)::integer;
  b := (s->'dice'->>1)::integer;
  att := coalesce((s->'jail'->>t)::integer, 0) + 1;
  s := s || jsonb_build_object('doubles', 0);
  s := public._tdp_log(s, jsonb_build_object('player', t, 'kind', 'roll', 'dice', s->'dice', 'from', 10,
                                             'cell', case when a = b or att >= 3 then (10 + a + b) % 40 else 10 end,
                                             'double', a = b, 'jail_attempt', att));
  s := public._tdp_new_event(s, t, 10);
  if a = b or att >= 3 then
    if a <> b then
      s := public._tdp_transfer(s, t, null, 50);
      s := public._tdp_log(s, jsonb_build_object('player', t, 'kind', 'jail_out', 'how', 'forced', 'amount', 50));
      s := public._tdp_le(s, jsonb_build_object('jail', 'out_forced'));
    else
      s := public._tdp_log(s, jsonb_build_object('player', t, 'kind', 'jail_out', 'how', 'double'));
      s := public._tdp_le(s, jsonb_build_object('jail', 'out_double'));
    end if;
    s := s || jsonb_build_object('jail', (s->'jail') - t);
    s := public._tdp_advance(s, t, a + b);
    g := public._tdp_land(jsonb_build_object('s', s, 'v', g->'v'), t, 0, 'normal');
    return public._tdp_settle(g);
  end if;
  s := jsonb_set(s, array['jail', t], to_jsonb(att));
  s := public._tdp_log(s, jsonb_build_object('player', t, 'kind', 'jail_stay', 'jail_attempt', att));
  s := public._tdp_le(s, jsonb_build_object('jail', 'stay'));
  return public._tdp_settle(jsonb_build_object('s', s, 'v', g->'v'));
end $$;

-- Achat (ou refus) de la case proposée (phase buy).
create or replace function public._tdp_decide_buy(g jsonb, p_buy boolean)
returns jsonb language plpgsql stable
set search_path = public, extensions
as $$
declare
  s     jsonb := g->'s';
  t     text := g->'s'->>'turn';
  cell  integer := (g->'s'->'pending'->>'cell')::integer;
  price integer := (g->'s'->'pending'->>'price')::integer;
begin
  if p_buy then
    if (s->'cash'->>t)::integer < price then raise exception 'not_enough_cash'; end if;
    s := public._tdp_transfer(s, t, null, price);
    s := jsonb_set(s, array['owners', cell::text], to_jsonb(t));
    s := public._tdp_log(s, jsonb_build_object('player', t, 'kind', 'buy', 'cell', cell, 'amount', price));
    s := public._tdp_stat(s, t, 'bought', 1);
    if (s->'last_event'->>'player') = t and (s->'last_event'->>'cell')::integer = cell then
      s := public._tdp_le(s, jsonb_build_object('bought', true));
    end if;
  else
    s := public._tdp_log(s, jsonb_build_object('player', t, 'kind', 'pass_buy', 'cell', cell));
  end if;
  s := s || jsonb_build_object('phase', 'resolved', 'pending', null);
  return public._tdp_settle(jsonb_build_object('s', s, 'v', g->'v'));
end $$;

-- Pioche de la carte en attente (phase card) puis suite du tour.
create or replace function public._tdp_draw(g jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  t    text := g->'s'->>'turn';
  deck text := g->'s'->'pending'->>'deck';
begin
  g := jsonb_set(g, '{s}', (g->'s') || jsonb_build_object('phase', 'resolved', 'pending', null));
  if deck in ('hasard', 'potes') then
    g := public._tdp_card(g, t, deck, 0);
  end if;
  return public._tdp_settle(g);
end $$;

-- Une décision automatique pour le joueur au trait (minuteur / absent).
create or replace function public._tdp_auto_step(g jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  ph text := g->'s'->>'phase';
  t  text := g->'s'->>'turn';
begin
  g := jsonb_set(g, '{s}', public._tdp_log(g->'s', jsonb_build_object('player', t, 'kind', 'auto', 'phase', ph)));
  if ph = 'roll' then
    return public._tdp_do_roll(g);
  elsif ph = 'jail' then
    return public._tdp_jail_roll(g);
  elsif ph = 'card' then
    return public._tdp_draw(g);
  elsif ph = 'buy' then
    return public._tdp_decide_buy(g, false);
  elsif ph = 'manage' then
    return public._tdp_next_turn(g);
  elsif ph = 'debt' then
    g := jsonb_set(g, '{s}', public._tdp_liquidate(g->'s', t));
    return public._tdp_settle(g);
  end if;
  return g;
end $$;

-- Joue automatiquement tout le tour du joueur au trait.
create or replace function public._tdp_auto_turn(g jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  tn integer := (g->'s'->>'turn_no')::integer;
  i  integer;
begin
  for i in 1 .. 40 loop
    exit when g->'s'->>'phase' = 'finished' or (g->'s'->>'turn_no')::integer <> tn;
    g := public._tdp_auto_step(g);
  end loop;
  return g;
end $$;

-- Joueurs absents (away) : leurs tours sont joués d'office (au plus un tour de table par appel).
create or replace function public._tdp_run_away(g jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  i integer;
  n integer := jsonb_array_length(g->'s'->'players');
begin
  for i in 1 .. n loop
    exit when g->'s'->>'phase' = 'finished'
           or not (coalesce(g->'s'->'away', '[]'::jsonb) ? (g->'s'->>'turn'));
    g := public._tdp_auto_turn(g);
  end loop;
  return g;
end $$;

-- -----------------------------------------------------------------------------
-- Démarrage. Options : {"format": "chrono"|"tours"|"classique" (défaut chrono),
--   "minutes": 30|45|60 (chrono, défaut 45), "rounds": 10|15|20 (tours, défaut 15),
--   "turn_seconds": 0|30|45|60|90 (défaut 45 ; 0 = sans minuteur)}
-- -----------------------------------------------------------------------------
create or replace function public.game_tour_des_potes_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_n      integer := cardinality(p_players);
  v_opts   jsonb := coalesce(p_options, '{}'::jsonb);
  v_format text;
  v_min    integer;
  v_rounds integer;
  v_secs   integer;
  v_order  text[];
  v_cash   jsonb := '{}'::jsonb;
  v_pos    jsonb := '{}'::jsonb;
  v_stats  jsonb := '{}'::jsonb;
  v_state  jsonb;
  v_server jsonb;
  p        text;
begin
  if v_n < 2 then raise exception 'not_enough_players'; end if;
  if v_n > 9 then raise exception 'too_many_players'; end if;
  v_format := case when v_opts->>'format' in ('chrono', 'tours', 'classique') then v_opts->>'format' else 'chrono' end;
  v_min := case when coalesce(v_opts->>'minutes', '') in ('30', '45', '60') then (v_opts->>'minutes')::integer else 45 end;
  v_rounds := case when coalesce(v_opts->>'rounds', '') in ('10', '15', '20') then (v_opts->>'rounds')::integer else 15 end;
  v_secs := case when coalesce(v_opts->>'turn_seconds', '') in ('0', '30', '45', '60', '90')
                 then (v_opts->>'turn_seconds')::integer else 45 end;
  v_order := array(select x::text from unnest(p_players) as t(x) order by random());
  foreach p in array v_order loop
    v_cash := v_cash || jsonb_build_object(p, 1500);
    v_pos := v_pos || jsonb_build_object(p, 0);
    v_stats := v_stats || jsonb_build_object(p, jsonb_build_object(
      'laps', 0, 'rent_paid', 0, 'rent_received', 0, 'bought', 0, 'built', 0, 'jail', 0, 'cards', 0));
  end loop;

  v_server := jsonb_build_object('decks', jsonb_build_object(
    'hasard', (select jsonb_agg(k order by random()) from jsonb_object_keys(public._tdp_cards()) as k where k like 'h%'),
    'potes',  (select jsonb_agg(k order by random()) from jsonb_object_keys(public._tdp_cards()) as k where k like 'p%')));

  v_state := jsonb_build_object(
    'game', 'tour-des-potes',
    'phase', 'roll',
    'players', to_jsonb(p_players),
    'order', to_jsonb(v_order),
    'alive', to_jsonb(v_order),
    'bankrupt', '[]'::jsonb,
    'format', v_format,
    'minutes', case when v_format = 'chrono' then v_min end,
    'total_rounds', case when v_format = 'tours' then v_rounds end,
    'started_at', public._tdp_iso(now()),
    'ends_at', case v_format when 'chrono' then public._tdp_iso(now() + make_interval(mins => v_min))
                             when 'classique' then public._tdp_iso(now() + interval '3 hours') end,
    'last_turn', false,
    'turn_seconds', v_secs,
    'round', 1,
    'turn_no', 1,
    'turn', v_order[1],
    'doubles', 0,
    'dice', null,
    'cash', v_cash,
    'pos', v_pos,
    'owners', '{}'::jsonb,
    'buildings', '{}'::jsonb,
    'jail', '{}'::jsonb,
    'jail_cards', '{}'::jsonb,
    'away', '[]'::jsonb,
    'pending', null,
    'last_event', null,
    'events', '[]'::jsonb,
    'log', '[]'::jsonb,
    'event_no', 0,
    'stats', v_stats,
    'tax_pot', 0,
    'round_rents', jsonb_build_object('round', 1, 'payments', '[]'::jsonb),
    'deadline', null,
    'end_reason', null,
    'winners', null,
    'ranking', null,
    'results', null);
  v_state := public._tdp_log(v_state, jsonb_build_object('player', v_order[1], 'kind', 'turn', 'round', 1, 'turn_no', 1));
  -- 10 s de grâce au premier tour (le temps que tout le monde arrive).
  v_state := public._tdp_deadline(v_state, 10);
  return jsonb_build_object('state', v_state, 'server', v_server);
end $$;

-- -----------------------------------------------------------------------------
-- Actions (joueur au trait) : roll | pay_jail | use_card | draw | buy | pass |
--   build {cell} | sell {cell} | end_turn.  Tous : tick.  Hôte : skip.
--   Joueur absent : back.  (abort : moteur.)
-- -----------------------------------------------------------------------------
create or replace function public.game_tour_des_potes_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_type  text := p_action->>'type';
  v_me    text := p_actor::text;
  v_phase text := p_state->>'phase';
  s       jsonb;
  g       jsonb;
  t       text := p_state->>'turn';
  v_cell  integer;
  v_card  text;
  v_deck  text;
  c       jsonb;
  v_grp   integer[];
  lvl     integer;
  x       integer;
begin
  if v_phase is null or v_phase not in ('roll', 'jail', 'card', 'buy', 'manage', 'debt') then raise exception 'wrong_phase'; end if;

  if v_type = 'tick' then
    if p_state->>'deadline' is null or now() < (p_state->>'deadline')::timestamptz then
      return jsonb_build_object('state', p_state, 'server', p_server);  -- trop tôt / déjà traité
    end if;
  elsif v_type = 'skip' then
    if not p_is_host then raise exception 'not_host'; end if;
  elsif v_type = 'back' then
    if not ((p_state->'players') ? v_me) then raise exception 'not_a_player'; end if;
  elsif v_type in ('roll', 'pay_jail', 'use_card', 'draw', 'buy', 'pass', 'build', 'sell', 'end_turn') then
    if not ((p_state->'players') ? v_me) then raise exception 'not_a_player'; end if;
    if not ((p_state->'alive') ? v_me) then raise exception 'not_alive'; end if;
    if t is distinct from v_me then raise exception 'not_your_turn'; end if;
  else
    raise exception 'unknown_action';
  end if;

  s := p_state || jsonb_build_object('events', '[]'::jsonb);
  if s->>'ends_at' is not null and now() >= (s->>'ends_at')::timestamptz then
    s := s || jsonb_build_object('last_turn', true);
  end if;
  -- Un joueur qui agit lui-même n'est plus absent.
  if v_type not in ('tick', 'skip') and coalesce(s->'away', '[]'::jsonb) ? v_me then
    s := s || jsonb_build_object('away', (s->'away') - v_me);
    s := public._tdp_log(s, jsonb_build_object('player', v_me, 'kind', 'back'));
  end if;
  g := jsonb_build_object('s', s, 'v', coalesce(p_server, '{}'::jsonb));

  if v_type = 'tick' then
    g := public._tdp_auto_step(g);

  elsif v_type = 'skip' then
    if not (coalesce(s->'away', '[]'::jsonb) ? t) then
      s := s || jsonb_build_object('away', coalesce(s->'away', '[]'::jsonb) || to_jsonb(t));
      s := public._tdp_log(s, jsonb_build_object('player', t, 'kind', 'away'));
      g := jsonb_set(g, '{s}', s);
    end if;
    g := public._tdp_auto_turn(g);

  elsif v_type = 'back' then
    null;  -- traité ci-dessus (sans effet si le joueur n'était pas absent)

  elsif v_type = 'roll' then
    if v_phase = 'roll' then g := public._tdp_do_roll(g);
    elsif v_phase = 'jail' then g := public._tdp_jail_roll(g);
    else raise exception 'wrong_phase'; end if;

  elsif v_type in ('pay_jail', 'use_card') then
    if v_phase <> 'jail' then raise exception 'wrong_phase'; end if;
    if v_type = 'pay_jail' then
      if (s->'cash'->>t)::integer < 50 then raise exception 'not_enough_cash'; end if;
      s := public._tdp_transfer(s, t, null, 50);
      s := public._tdp_log(s, jsonb_build_object('player', t, 'kind', 'jail_out', 'how', 'pay', 'amount', 50));
    else
      v_card := s->'jail_cards'->t->>0;
      if v_card is null then raise exception 'no_jail_card'; end if;
      v_deck := case when v_card like 'h%' then 'hasard' else 'potes' end;
      g := jsonb_set(g, array['v', 'decks', v_deck],
                     coalesce(g->'v'->'decks'->v_deck, '[]'::jsonb) || to_jsonb(v_card));
      s := public._tdp_log(s, jsonb_build_object('player', t, 'kind', 'jail_out', 'how', 'card', 'card', v_card));
      if jsonb_array_length(s->'jail_cards'->t) <= 1 then
        s := s || jsonb_build_object('jail_cards', (s->'jail_cards') - t);
      else
        s := jsonb_set(s, array['jail_cards', t], (s->'jail_cards'->t) - 0);
      end if;
    end if;
    s := s || jsonb_build_object('jail', (s->'jail') - t, 'phase', 'roll');
    s := public._tdp_deadline(s, 0);
    g := jsonb_set(g, '{s}', s);

  elsif v_type = 'draw' then
    if v_phase <> 'card' then raise exception 'wrong_phase'; end if;
    g := public._tdp_draw(g);

  elsif v_type in ('buy', 'pass') then
    if v_phase <> 'buy' then raise exception 'wrong_phase'; end if;
    g := public._tdp_decide_buy(g, v_type = 'buy');

  elsif v_type in ('build', 'sell') then
    if v_type = 'build' and v_phase not in ('roll', 'jail', 'manage') then raise exception 'wrong_phase'; end if;
    if v_type = 'sell' and v_phase not in ('roll', 'jail', 'manage', 'debt') then raise exception 'wrong_phase'; end if;
    if jsonb_typeof(p_action->'cell') is distinct from 'number' then raise exception 'invalid_cell'; end if;
    if (p_action->>'cell')::numeric <> floor((p_action->>'cell')::numeric)
       or (p_action->>'cell')::numeric < 0 or (p_action->>'cell')::numeric > 39 then
      raise exception 'invalid_cell';
    end if;
    v_cell := (p_action->>'cell')::numeric::integer;
    c := public._tdp_cell(v_cell);
    if c->>'type' <> 'quartier' then raise exception 'not_buildable'; end if;
    if s->'owners'->>v_cell::text is distinct from t then raise exception 'not_owner'; end if;
    if not public._tdp_owns_group(s, t, c->>'group') then raise exception 'group_incomplete'; end if;
    v_grp := public._tdp_group_cells(c->>'group');
    lvl := public._tdp_level(s, v_cell);
    if v_type = 'build' then
      if lvl >= 5 then raise exception 'max_buildings'; end if;
      select min(public._tdp_level(s, y)) into x from unnest(v_grp) as y;
      if lvl > x then raise exception 'build_uneven'; end if;
      if (s->'cash'->>t)::integer < (c->>'house')::integer then raise exception 'not_enough_cash'; end if;
      s := public._tdp_transfer(s, t, null, (c->>'house')::integer);
      s := jsonb_set(s, array['buildings', v_cell::text], to_jsonb(lvl + 1));
      s := public._tdp_log(s, jsonb_build_object('player', t, 'kind', 'build', 'cell', v_cell, 'level', lvl + 1,
                                                 'amount', (c->>'house')::integer));
      s := public._tdp_stat(s, t, 'built', 1);
    else
      if lvl <= 0 then raise exception 'no_buildings'; end if;
      select max(public._tdp_level(s, y)) into x from unnest(v_grp) as y;
      if lvl < x then raise exception 'sell_uneven'; end if;
      s := public._tdp_transfer(s, null, t, (c->>'house')::integer / 2);
      if lvl - 1 = 0 then
        s := jsonb_set(s, '{buildings}', (s->'buildings') - v_cell::text);
      else
        s := jsonb_set(s, array['buildings', v_cell::text], to_jsonb(lvl - 1));
      end if;
      s := public._tdp_log(s, jsonb_build_object('player', t, 'kind', 'sell', 'cell', v_cell, 'level', lvl - 1,
                                                 'amount', (c->>'house')::integer / 2));
    end if;
    g := jsonb_set(g, '{s}', s);
    if v_phase = 'debt' then
      g := public._tdp_settle(g);
    else
      g := jsonb_set(g, '{s}', public._tdp_deadline(g->'s', 0));
    end if;

  elsif v_type = 'end_turn' then
    if v_phase <> 'manage' then raise exception 'wrong_phase'; end if;
    g := public._tdp_next_turn(g);
  end if;

  g := public._tdp_run_away(g);
  s := g->'s';
  if s->>'phase' = 'finished' then
    return jsonb_build_object('state', s, 'server', g->'v', 'results', s->'results');
  end if;
  return jsonb_build_object('state', s, 'server', g->'v');
end $$;

revoke all on function public._tdp_iso(timestamptz) from public, anon, authenticated;
revoke all on function public._tdp_board() from public, anon, authenticated;
revoke all on function public._tdp_cards() from public, anon, authenticated;
revoke all on function public._tdp_cell(integer) from public, anon, authenticated;
revoke all on function public._tdp_group_cells(text) from public, anon, authenticated;
revoke all on function public._tdp_level(jsonb, integer) from public, anon, authenticated;
revoke all on function public._tdp_owns_group(jsonb, text, text) from public, anon, authenticated;
revoke all on function public._tdp_rent(jsonb, integer, integer, text) from public, anon, authenticated;
revoke all on function public._tdp_props_value(jsonb, text) from public, anon, authenticated;
revoke all on function public._tdp_build_value(jsonb, text) from public, anon, authenticated;
revoke all on function public._tdp_sale_value(jsonb, text) from public, anon, authenticated;
revoke all on function public._tdp_fortune(jsonb, text) from public, anon, authenticated;
revoke all on function public._tdp_log(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._tdp_add_rent(jsonb, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public._tdp_le(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._tdp_stat(jsonb, text, text, integer) from public, anon, authenticated;
revoke all on function public._tdp_transfer(jsonb, text, text, integer) from public, anon, authenticated;
revoke all on function public._tdp_deadline(jsonb, integer) from public, anon, authenticated;
revoke all on function public._tdp_roll(jsonb) from public, anon, authenticated;
revoke all on function public._tdp_advance(jsonb, text, integer) from public, anon, authenticated;
revoke all on function public._tdp_to_jail(jsonb, text, text) from public, anon, authenticated;
revoke all on function public._tdp_land(jsonb, text, integer, text) from public, anon, authenticated;
revoke all on function public._tdp_card(jsonb, text, text, integer) from public, anon, authenticated;
revoke all on function public._tdp_liquidate(jsonb, text) from public, anon, authenticated;
revoke all on function public._tdp_finish(jsonb, text) from public, anon, authenticated;
revoke all on function public._tdp_tstats(jsonb, text, boolean, integer, integer, integer, integer) from public, anon, authenticated;
revoke all on function public._tdp_bankrupt(jsonb, text) from public, anon, authenticated;
revoke all on function public._tdp_next_turn(jsonb) from public, anon, authenticated;
revoke all on function public._tdp_settle(jsonb) from public, anon, authenticated;
revoke all on function public._tdp_new_event(jsonb, text, integer) from public, anon, authenticated;
revoke all on function public._tdp_do_roll(jsonb) from public, anon, authenticated;
revoke all on function public._tdp_jail_roll(jsonb) from public, anon, authenticated;
revoke all on function public._tdp_decide_buy(jsonb, boolean) from public, anon, authenticated;
revoke all on function public._tdp_draw(jsonb) from public, anon, authenticated;
revoke all on function public._tdp_auto_step(jsonb) from public, anon, authenticated;
revoke all on function public._tdp_auto_turn(jsonb) from public, anon, authenticated;
revoke all on function public._tdp_run_away(jsonb) from public, anon, authenticated;
revoke all on function public.game_tour_des_potes_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_tour_des_potes_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;


-- ===== games\tu-preferes.sql =====
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
         -- `by` : id du profil auteur d'une carte maison (optionnel, voir features/cartes-maison.sql)
         || case when (e->>'by') ~ '^[0-9a-f-]{36}$' then jsonb_build_object('by', e->>'by') else '{}'::jsonb end
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
        -- Rebelle lucide : seul de son avis ET pari gagné sur la même manche
        if v_bet = v_maj then
          v_st := jsonb_set(v_st, '{rebel_right}', to_jsonb(coalesce((v_st->>'rebel_right')::integer, 0) + 1), true);
        end if;
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

-- Stats de fin de partie pour les trophées (features/trophees.sql) : s'ajoutent à state.stats[pl]
-- (bets_ok, rebel, norm, answered).
create or replace function public._tp_tstats(p_state jsonb, p_pl text)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  with s as (
    select coalesce((p_state->'stats'->p_pl->>'answered')::integer, 0) as answered,
           coalesce((p_state->'stats'->p_pl->>'bets_ok')::integer, 0) as bets_ok,
           coalesce((p_state->'stats'->p_pl->>'norm')::integer, 0) as norm,
           (p_state->>'total_rounds')::integer as rounds
  )
  select jsonb_build_object(
    'rounds', rounds,
    'bets_lost', greatest(0, answered - bets_ok),
    'unanimous_rounds', (select count(*) from jsonb_array_elements(coalesce(p_state->'history', '[]'::jsonb)) e
                          where (coalesce((e->'counts'->>'a')::integer, 0) = 0 or coalesce((e->'counts'->>'b')::integer, 0) = 0)
                            and coalesce((e->'counts'->>'a')::integer, 0) + coalesce((e->'counts'->>'b')::integer, 0) >= 3),
    'minority', case when answered > 0 and (answered - norm) * 2 > answered then 1 else 0 end,
    'perfect_bets', case when rounds >= 10 and bets_ok = rounds then 1 else 0 end)
  from s
$$;

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
           'stats', coalesce(p_state->'stats'->t.key, '{}'::jsonb) || public._tp_tstats(p_state, t.key))
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
revoke all on function public._tp_tstats(jsonb, text) from public, anon, authenticated;
revoke all on function public.game_tu_preferes_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_tu_preferes_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;


-- ===== seed.sql =====
-- =============================================================================
-- Soirées de Dédé — seed des 9 profils (idempotent)
-- À exécuter APRÈS schema.sql. Ne touche jamais au PIN, à l'XP ni au pseudo
-- d'un profil existant (on conflict : prénom, expressions et ordre seulement).
-- =============================================================================

insert into public.profiles (slug, first_name, nickname, expressions, sort_order) values
  ('kevin',  'Kevin',    'Keke',   array['joie','colere','pleurs','boude','reflexion','dodo','bisou','clin_oeil','surprise','amoureux','cool','gamer'], 1),
  ('cycy',   'Cyrielle', 'Cycy',   array['joie','colere','pleurs','boude','reflexion','dodo','bisou','clin_oeil','surprise','amoureux','cool','gamer'], 2),
  ('dede',   'Delphine', 'Dédé',   array['joie','colere','pleurs','boude','reflexion','dodo','bisou','clin_oeil','surprise','amoureux','cool','gamer'], 3),
  ('manon',  'Manon',    'Manon',  array['joie','colere','pleurs','boude','reflexion','dodo','bisou','clin_oeil','surprise','amoureux','cool','gamer'], 4),
  ('mika',   'Michael',  'Mika',   array['joie','colere','pleurs','boude','reflexion','dodo','bisou','clin_oeil','surprise','amoureux','cool','gamer'], 5),
  ('cecile', 'Cécile',   'Cécile', array['joie','colere','pleurs','boude','reflexion','dodo','bisou','clin_oeil','surprise','amoureux','cool','gamer'], 6),
  ('carole', 'Carole',   'Karo',   array['joie','colere','pleurs','boude','reflexion','dodo','bisou','clin_oeil','surprise','pouces','timide','charmee'], 7),
  ('marius', 'Marius',   'Marius', array['joie','colere','pleurs','boude','reflexion','dodo','bisou','clin_oeil','surprise','amoureux','cool','gamer'], 8),
  ('nini',   'Nicolas',  'Nini',   array['joie','colere','pleurs','boude','reflexion','dodo','bisou','clin_oeil','surprise','pouces','timide','gamer'], 9)
on conflict (slug) do update
  set first_name  = excluded.first_name,
      expressions = excluded.expressions,
      sort_order  = excluded.sort_order;

-- Admin
update public.profiles set is_admin = (slug = 'kevin') where is_admin is distinct from (slug = 'kevin');

-- Expression équipée invalide (ex. expressions modifiées) -> retour à 'joie'
update public.profiles set equipped_expression = 'joie'
 where not (equipped_expression = any(expressions))
   and not (equipped_expression = any(public._costume_expressions()));  -- palette des tenues (pouces, timide, déterminé…)

-- Lignes de stats + déblocage par défaut
insert into public.player_stats (profile_id)
select id from public.profiles
on conflict (profile_id) do nothing;

insert into public.unlocks (profile_id, expression)
select id, 'joie' from public.profiles
on conflict (profile_id, expression) do nothing;
