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
  p_state := p_state || jsonb_build_object('phase', 'finished', 'winners',
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
    if v_phase <> 'guess' then raise exception 'wrong_phase'; end if;
    if not v_guess then raise exception 'not_guesser'; end if;
    if p_action->'index' is null or jsonb_typeof(p_action->'index') = 'null' then
      return jsonb_build_object('state', p_state || jsonb_build_object('votes', (p_state->'votes') - v_me), 'server', p_server);
    end if;
    if jsonb_typeof(p_action->'index') <> 'number' then raise exception 'invalid_action'; end if;
    v_idx := (p_action->>'index')::integer;
    if v_idx < 0 or v_idx > 24 then raise exception 'invalid_action'; end if;
    -- carte déjà dévoilée (deux votes simultanés) : ignoré sans erreur
    if (p_state->'revealed') ? v_idx::text then return v_unchanged; end if;
    p_state := p_state || jsonb_build_object('votes', (p_state->'votes') || jsonb_build_object(v_me, v_idx));
    if not ((p_server->'first') ? v_idx::text) then
      p_server := p_server || jsonb_build_object('first', coalesce(p_server->'first', '{}'::jsonb) || jsonb_build_object(v_idx::text, v_me));
    end if;
    select count(*) into v_cnt from jsonb_each_text(p_state->'votes') where value = v_idx::text;
    if v_cnt >= v_need then return public._ndc_reveal(p_state, p_server, v_idx); end if;
    return jsonb_build_object('state', p_state, 'server', p_server);

  -- ---------------------------------------------------------------- stop
  elsif v_type = 'stop' then
    if v_phase <> 'guess' then raise exception 'wrong_phase'; end if;
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
