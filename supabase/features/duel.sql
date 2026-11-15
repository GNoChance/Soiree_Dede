-- =============================================================================
-- SOCLE « Jeux en duel » (2 joueurs à la fois, le reste de la table regarde
-- et parie). Idempotent (create or replace). Chargé APRÈS schema.sql et AVANT
-- games/*.sql (ordre de scripts/build-sql.mjs : features puis games).
--
-- Un jeu en duel (4 à la suite, morpion, bataille navale…) ne fournit QUE son
-- plateau ; le socle gère la session (modes Roi de la table / Tournoi / Duel),
-- les tours, le minuteur (deadline + tick, coup auto), les paris des
-- spectateurs, les points de session et finish_match.
--
-- Contrat complet (state public, actions, hooks) : docs/ARCHITECTURE.md,
-- section « Jeux en duel », et src/features/duel/types.ts (miroir TS).
--
-- ---------------------------------------------------------------- BRANCHEMENT
--   game_<id>_start(p_players uuid[], p_options jsonb)
--       = select public._duel_start('<id>', p_players, p_options);
--   game_<id>_action(p_state, p_server, p_actor, p_is_host, p_action)
--       = select public._duel_action('<id>', p_state, p_server, p_actor, p_is_host, p_action);
--
-- ---------------------------------------------------------------- HOOKS DU JEU
-- (id '4-a-b' -> préfixe game_4_a_b_ ; joueurs = uuid en TEXTE)
--  * game_<id>_board_new(p_ctx jsonb, p_a text, p_b text) returns jsonb   [obligatoire]
--      p_ctx = {duel_no, game_no, a, b, starter, options}  (options = p_options.board)
--      -> {board: {...public}, server?: any, secrets?: {"<uid>": any}, setup_seconds?: int}
--  * game_<id>_board_move(p_board jsonb, p_server jsonb, p_actor text, p_move jsonb) returns jsonb [obligatoire]
--      lève une erreur métier si le coup est illégal (invalid_move, column_full…)
--      -> {board, server?, secrets?, outcome: null|'win'|'draw', winner?: uid, turn?: uid}
--      (turn absent = alternance ; server absent = inchangé)
--  * game_<id>_board_auto(p_board jsonb, p_server jsonb, p_actor text) returns jsonb [obligatoire]
--      -> un coup LÉGAL tiré au hasard (même format que p_move), rejoué via board_move.
--  * game_<id>_board_setup(p_board jsonb, p_server jsonb, p_actor text, p_move jsonb) returns jsonb [optionnel]
--      Phase de préparation SIMULTANÉE (ex. placer sa flotte) si board_new renvoie setup_seconds > 0.
--      Appelé avec : un coup de préparation du jeu ({type:'setup', move} côté client) ;
--      {"type":"ready"} (valider, lever setup_incomplete si besoin) ; {"type":"auto"}
--      (compléter AU HASARD la préparation de p_actor, à l'échéance) ; {"type":"begin"}
--      avec p_actor NULL (les deux sont prêts : passer au jeu). -> {board, server?, secrets?}
--
-- server (match_server_state) : {"board": <server du jeu>} — le jeu ne voit que sa part.
-- Secrets : upsert par game_action ; inclure duel_no/game_no dans le secret pour que
-- le front ignore celui d'un duel précédent (le socle ne supprime jamais un secret).
-- =============================================================================

create or replace function public._duel_iso(p_ts timestamptz)
returns text language sql stable
set search_path = public, extensions
as $$
  select to_char(p_ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$$;

-- Échéance ISO dans p_secs secondes.
create or replace function public._duel_in(p_secs numeric)
returns text language sql stable
set search_path = public, extensions
as $$
  select public._duel_iso(now() + make_interval(secs => p_secs::double precision));
$$;

create or replace function public._duel_shuffle(p text[])
returns text[] language sql volatile
set search_path = public, extensions
as $$
  select coalesce(array(select x from unnest(p) as t(x) order by random()), '{}'::text[]);
$$;

-- Nom de la fonction game_<id>_<suffix>(<args>) si elle existe, sinon null.
create or replace function public._duel_hook(p_game text, p_suffix text, p_args text)
returns text language plpgsql stable
set search_path = public, extensions
as $$
declare v_fn text;
begin
  if p_game is null or p_game !~ '^[a-z0-9-]{1,40}$' then raise exception 'unknown_game'; end if;
  v_fn := 'game_' || replace(p_game, '-', '_') || '_' || p_suffix;
  if to_regprocedure(format('public.%I(%s)', v_fn, p_args)) is null then return null; end if;
  return v_fn;
end $$;

create or replace function public._duel_fn(p_game text, p_suffix text, p_args text)
returns text language plpgsql stable
set search_path = public, extensions
as $$
declare v_fn text := public._duel_hook(p_game, p_suffix, p_args);
begin
  if v_fn is null then raise exception 'unknown_game'; end if;
  return v_fn;
end $$;

-- ---------------------------------------------------------------- appels des hooks

create or replace function public._duel_board_new(p_game text, p_ctx jsonb, p_a text, p_b text)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare v jsonb;
begin
  execute format('select public.%I($1, $2, $3)', public._duel_fn(p_game, 'board_new', 'jsonb, text, text'))
     into v using p_ctx, p_a, p_b;
  if v is null or jsonb_typeof(v->'board') is distinct from 'object' then raise exception 'invalid_board'; end if;
  return v;
end $$;

create or replace function public._duel_board_move(p_game text, p_board jsonb, p_server jsonb, p_actor text, p_move jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare v jsonb;
begin
  execute format('select public.%I($1, $2, $3, $4)', public._duel_fn(p_game, 'board_move', 'jsonb, jsonb, text, jsonb'))
     into v using p_board, p_server, p_actor, p_move;
  if v is null or jsonb_typeof(v->'board') is distinct from 'object' then raise exception 'invalid_board'; end if;
  return v;
end $$;

create or replace function public._duel_board_auto(p_game text, p_board jsonb, p_server jsonb, p_actor text)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare v jsonb;
begin
  execute format('select public.%I($1, $2, $3)', public._duel_fn(p_game, 'board_auto', 'jsonb, jsonb, text'))
     into v using p_board, p_server, p_actor;
  if v is null or jsonb_typeof(v) <> 'object' then raise exception 'invalid_move'; end if;
  return v;
end $$;

create or replace function public._duel_board_setup(p_game text, p_board jsonb, p_server jsonb, p_actor text, p_move jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_fn text := public._duel_hook(p_game, 'board_setup', 'jsonb, jsonb, text, jsonb');
  v    jsonb;
begin
  if v_fn is null then
    -- Pas de hook : préparation sans effet (le jeu n'a rien à préparer).
    return jsonb_build_object('board', p_board, 'server', p_server);
  end if;
  execute format('select public.%I($1, $2, $3, $4)', v_fn) into v using p_board, p_server, p_actor, p_move;
  if v is null or jsonb_typeof(v->'board') is distinct from 'object' then raise exception 'invalid_board'; end if;
  return v;
end $$;

-- ---------------------------------------------------------------- utilitaires

create or replace function public._duel_other(p_duel jsonb, p text)
returns text language sql immutable
set search_path = public, extensions
as $$
  select case when p = p_duel->>'a' then p_duel->>'b' else p_duel->>'a' end;
$$;

-- session.stats[p][key] += n
create or replace function public._duel_stat(p_session jsonb, p text, p_key text, p_n integer)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select jsonb_set(p_session, array['stats', p, p_key],
                   to_jsonb(coalesce((p_session->'stats'->p->>p_key)::integer, 0) + p_n));
$$;

-- session.scores[p] += n
create or replace function public._duel_score(p_session jsonb, p text, p_n integer)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select jsonb_set(p_session, array['scores', p],
                   to_jsonb(coalesce((p_session->'scores'->>p)::integer, 0) + p_n));
$$;

-- x = {state, server, secrets} : fusionne des secrets renvoyés par un hook.
create or replace function public._duel_add_secrets(p_x jsonb, p_secrets jsonb)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select case when jsonb_typeof(p_secrets) = 'object'
              then p_x || jsonb_build_object('secrets', coalesce(p_x->'secrets', '{}'::jsonb) || p_secrets)
              else p_x end;
$$;

-- ---------------------------------------------------------------- tournoi

-- Tableau à élimination directe. Taille = puissance de 2 >= n ; les exempts
-- (taille - n, toujours < taille/2) passent directement au tour 2. L'ordre des
-- matchs du 1er tour est tiré au sort (exempts répartis au hasard).
-- match = {a, b, winner, status: 'pending'|'done'|'bye', draws, random}
create or replace function public._duel_bracket_new(p_players text[])
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_n      integer := cardinality(p_players);
  v_size   integer := 2;
  v_byes   integer;
  v_r0     jsonb := '[]'::jsonb;
  v_rounds jsonb;
  v_k      integer := 1;
  v_m      integer;
  i        integer;
  r        integer;
begin
  while v_size < v_n loop v_size := v_size * 2; end loop;
  v_byes := v_size - v_n;
  for i in 1 .. v_size / 2 loop
    if i <= v_byes then
      v_r0 := v_r0 || jsonb_build_array(jsonb_build_object('a', p_players[v_k], 'b', null, 'winner', p_players[v_k],
                                                           'status', 'bye', 'draws', 0, 'random', false));
      v_k := v_k + 1;
    else
      v_r0 := v_r0 || jsonb_build_array(jsonb_build_object('a', p_players[v_k], 'b', p_players[v_k + 1], 'winner', null,
                                                           'status', 'pending', 'draws', 0, 'random', false));
      v_k := v_k + 2;
    end if;
  end loop;
  select jsonb_agg(e order by random()) into v_r0 from jsonb_array_elements(v_r0) as t(e);
  v_rounds := jsonb_build_array(v_r0);
  v_m := v_size / 4;
  while v_m >= 1 loop
    v_rounds := v_rounds || jsonb_build_array(
      (select jsonb_agg(jsonb_build_object('a', null, 'b', null, 'winner', null, 'status', 'pending', 'draws', 0, 'random', false))
         from generate_series(1, v_m)));
    v_m := v_m / 2;
  end loop;
  -- Propagation des exempts au tour 2.
  if jsonb_array_length(v_rounds) > 1 then
    for i in 0 .. jsonb_array_length(v_r0) - 1 loop
      if v_r0->i->>'status' = 'bye' then
        v_rounds := jsonb_set(v_rounds, array['1', (i / 2)::text, case when i % 2 = 0 then 'a' else 'b' end],
                              v_r0->i->'winner');
      end if;
    end loop;
  end if;
  return jsonb_build_object('size', v_size, 'byes', v_byes, 'rounds', v_rounds);
end $$;

-- Vainqueur du match (r, i) (0-based) -> qualifié au tour suivant.
create or replace function public._duel_bracket_win(p_bracket jsonb, p_r integer, p_i integer, p_w text, p_random boolean)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare v_b jsonb := p_bracket;
begin
  v_b := jsonb_set(v_b, array['rounds', p_r::text, p_i::text],
                   (v_b->'rounds'->p_r->p_i) || jsonb_build_object('winner', p_w, 'status', 'done', 'random', p_random));
  if p_r + 1 < jsonb_array_length(v_b->'rounds') then
    v_b := jsonb_set(v_b, array['rounds', (p_r + 1)::text, (p_i / 2)::text, case when p_i % 2 = 0 then 'a' else 'b' end],
                     to_jsonb(p_w));
  end if;
  return v_b;
end $$;

-- ---------------------------------------------------------------- appariement

-- Prochain duel de la session : {a, b, round?, match?, replay} ou null.
create or replace function public._duel_pair_next(p_state jsonb)
returns jsonb language plpgsql stable
set search_path = public, extensions
as $$
declare
  v_s   jsonb := p_state->'session';
  v_rds jsonb;
  v_m   jsonb;
  r     integer;
  i     integer;
begin
  if v_s->>'mode' = 'king' then
    if jsonb_array_length(v_s->'queue') < 2 then return null; end if;
    return jsonb_build_object('a', v_s->'queue'->>0, 'b', v_s->'queue'->>1, 'round', null, 'match', null, 'replay', false);
  elsif v_s->>'mode' = 'tournament' then
    v_rds := v_s->'bracket'->'rounds';
    for r in 0 .. jsonb_array_length(v_rds) - 1 loop
      for i in 0 .. jsonb_array_length(v_rds->r) - 1 loop
        v_m := v_rds->r->i;
        if v_m->>'status' = 'pending' and v_m->>'a' is not null and v_m->>'b' is not null then
          return jsonb_build_object('a', v_m->>'a', 'b', v_m->>'b', 'round', r, 'match', i,
                                    'replay', coalesce((v_m->>'draws')::integer, 0) > 0);
        end if;
      end loop;
    end loop;
    return null;
  else
    if coalesce((v_s->>'duel_count')::integer, 0) > 0 then return null; end if;
    return jsonb_build_object('a', v_s->'pair'->>0, 'b', v_s->'pair'->>1, 'round', null, 'match', null, 'replay', false);
  end if;
end $$;

-- Annonce le prochain duel : phase 'transition' (paris ouverts) pendant p_secs.
-- Premier joueur du duel : celui des deux qui a commencé le moins de manches
-- dans la session (égalité : au hasard) ; il alterne ensuite à chaque manche.
create or replace function public._duel_announce(p_state jsonb, p_secs numeric)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_s     jsonb := p_state->'session';
  v_next  jsonb := public._duel_pair_next(p_state);
  v_a     text;
  v_b     text;
  v_sa    integer;
  v_sb    integer;
  v_first text;
begin
  if v_next is null then raise exception 'no_next_duel'; end if;
  v_a := v_next->>'a';
  v_b := v_next->>'b';
  v_sa := coalesce((v_s->'stats'->v_a->>'starts')::integer, 0);
  v_sb := coalesce((v_s->'stats'->v_b->>'starts')::integer, 0);
  v_first := case when v_sa < v_sb then v_a when v_sb < v_sa then v_b
                  when random() < 0.5 then v_a else v_b end;
  return p_state || jsonb_build_object(
    'phase', 'transition',
    'board', null,
    'deadline', public._duel_in(p_secs),
    'duel', jsonb_build_object(
      'no', coalesce((v_s->>'duel_count')::integer, 0) + 1,
      'a', v_a, 'b', v_b,
      'first', v_first, 'starter', v_first, 'turn', null,
      'game_no', 0,
      'wins', jsonb_build_object(v_a, 0, v_b, 0),
      'games', '[]'::jsonb,
      'bets', '{}'::jsonb,
      'bets_until', null,
      'moves', 0, 'last_move', null,
      'outcome', null, 'winner', null,
      'ready', '[]'::jsonb,
      'result', null,
      'round', v_next->'round', 'match', v_next->'match',
      'replay', coalesce(v_next->'replay', 'false'::jsonb)));
end $$;

-- ---------------------------------------------------------------- manches

-- Nouvelle manche du duel courant : board_new, puis 'setup' ou 'playing'.
-- p_x = {state, server, secrets?} -> idem.
create or replace function public._duel_begin_game(p_game text, p_x jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_state   jsonb := p_x->'state';
  v_s       jsonb := v_state->'session';
  v_d       jsonb := v_state->'duel';
  v_g       integer := coalesce((v_d->>'game_no')::integer, 0) + 1;
  v_starter text;
  v_r       jsonb;
  v_setup   integer;
  v_secs    integer := coalesce((v_s->>'turn_seconds')::integer, 30);
begin
  v_starter := case when v_g % 2 = 1 then v_d->>'first' else public._duel_other(v_d, v_d->>'first') end;
  v_r := public._duel_board_new(p_game,
           jsonb_build_object('duel_no', v_d->'no', 'game_no', v_g, 'a', v_d->'a', 'b', v_d->'b',
                              'starter', v_starter, 'options', coalesce(v_s->'board_options', '{}'::jsonb)),
           v_d->>'a', v_d->>'b');
  v_setup := case when jsonb_typeof(v_r->'setup_seconds') = 'number' then (v_r->>'setup_seconds')::integer else 0 end;
  v_s := public._duel_stat(v_s, v_starter, 'starts', 1);
  v_d := v_d || jsonb_build_object(
    'game_no', v_g, 'starter', v_starter, 'moves', 0, 'last_move', null,
    'outcome', null, 'winner', null, 'ready', '[]'::jsonb,
    'bets_until', case when v_g = 1 then to_jsonb(public._duel_in(15)) else v_d->'bets_until' end);
  if v_setup > 0 then
    v_d := v_d || jsonb_build_object('turn', null);
    v_state := v_state || jsonb_build_object('phase', 'setup', 'deadline', public._duel_in(v_setup));
  else
    v_d := v_d || jsonb_build_object('turn', v_starter);
    v_state := v_state || jsonb_build_object('phase', 'playing', 'deadline', public._duel_in(v_secs));
  end if;
  v_state := v_state || jsonb_build_object('session', v_s, 'duel', v_d, 'board', v_r->'board');
  return public._duel_add_secrets(
    jsonb_build_object('state', v_state, 'server', jsonb_build_object('board', coalesce(v_r->'server', 'null'::jsonb)),
                       'secrets', coalesce(p_x->'secrets', '{}'::jsonb)),
    v_r->'secrets');
end $$;

-- Fin du duel : points, paris, série, file / tableau, historique, fin de session ?
create or replace function public._duel_end_duel(p_state jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_s      jsonb := p_state->'session';
  v_d      jsonb := p_state->'duel';
  v_a      text := v_d->>'a';
  v_b      text := v_d->>'b';
  v_wa     integer := coalesce((v_d->'wins'->>(v_d->>'a'))::integer, 0);
  v_wb     integer := coalesce((v_d->'wins'->>(v_d->>'b'))::integer, 0);
  v_w      text := null;
  v_l      text := null;
  v_adv    text := null;   -- qualifié au tirage (tournoi, 2e nul)
  v_right  jsonb := '[]'::jsonb;
  v_mode   text := v_s->>'mode';
  v_q      text[];
  v_m      jsonb;
  v_r      integer;
  v_i      integer;
  v_draws  integer;
  v_over   boolean := false;
  v_reason text := null;
  v_champ  text := null;
  v_minp   integer;
  v_nrds   integer;
  k        text;
  t        text;
begin
  if v_wa > v_wb then v_w := v_a; v_l := v_b;
  elsif v_wb > v_wa then v_w := v_b; v_l := v_a;
  end if;

  -- Points : victoire +3, nul +1 chacun. Stats.
  v_s := public._duel_stat(public._duel_stat(v_s, v_a, 'played', 1), v_b, 'played', 1);
  if v_w is not null then
    v_s := public._duel_score(v_s, v_w, 3);
    v_s := public._duel_stat(v_s, v_w, 'wins', 1);
    v_s := public._duel_stat(v_s, v_l, 'losses', 1);
  else
    v_s := public._duel_score(public._duel_score(v_s, v_a, 1), v_b, 1);
    v_s := public._duel_stat(public._duel_stat(v_s, v_a, 'draws', 1), v_b, 'draws', 1);
  end if;

  -- Paris : +1 si le pronostic est le vainqueur (un nul ne rapporte rien).
  for k, t in select key, value #>> '{}' from jsonb_each(coalesce(v_d->'bets', '{}'::jsonb)) loop
    v_s := public._duel_stat(v_s, k, 'bets', 1);
    if v_w is not null and t = v_w then
      v_s := public._duel_score(v_s, k, 1);
      v_s := public._duel_stat(v_s, k, 'bets_won', 1);
      v_right := v_right || to_jsonb(k);
    end if;
  end loop;

  -- Série de victoires consécutives.
  if v_w is null then
    v_s := v_s || jsonb_build_object('streak', jsonb_build_object('player', null, 'count', 0));
  elsif v_s->'streak'->>'player' = v_w then
    v_s := jsonb_set(v_s, '{streak,count}', to_jsonb(coalesce((v_s->'streak'->>'count')::integer, 0) + 1));
  else
    v_s := v_s || jsonb_build_object('streak', jsonb_build_object('player', v_w, 'count', 1));
  end if;

  -- Progression selon le mode.
  if v_mode = 'king' then
    v_q := array(select jsonb_array_elements_text(v_s->'queue'));
    -- duel = queue[1] (roi) vs queue[2] (challenger)
    if v_w is not null then
      v_q := array[v_w] || coalesce(v_q[3:], '{}'::text[]) || array[v_l];
    else
      v_q := coalesce(v_q[3:], '{}'::text[]) || array[v_a, v_b];
    end if;
    v_s := v_s || jsonb_build_object('queue', to_jsonb(v_q));
  elsif v_mode = 'tournament' then
    v_r := (v_d->>'round')::integer;
    v_i := (v_d->>'match')::integer;
    v_m := v_s->'bracket'->'rounds'->v_r->v_i;
    if v_w is not null then
      v_s := jsonb_set(v_s, '{bracket}', public._duel_bracket_win(v_s->'bracket', v_r, v_i, v_w, false));
    else
      v_draws := coalesce((v_m->>'draws')::integer, 0) + 1;
      v_s := jsonb_set(v_s, array['bracket', 'rounds', v_r::text, v_i::text, 'draws'], to_jsonb(v_draws));
      if v_draws >= 2 then
        -- Deuxième nul : qualification au tirage au sort.
        v_adv := case when random() < 0.5 then v_a else v_b end;
        v_s := jsonb_set(v_s, '{bracket}', public._duel_bracket_win(v_s->'bracket', v_r, v_i, v_adv, true));
      end if;
    end if;
  end if;

  v_s := v_s || jsonb_build_object(
    'duel_count', coalesce((v_s->>'duel_count')::integer, 0) + 1,
    'history', coalesce(v_s->'history', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'no', v_d->'no', 'a', v_a, 'b', v_b, 'winner', v_w, 'draw', v_w is null, 'advanced', v_adv,
      'wins', v_d->'wins', 'games', v_d->'games', 'bets', coalesce(v_d->'bets', '{}'::jsonb), 'bets_right', v_right,
      'round', v_d->'round', 'match', v_d->'match', 'replay', v_d->'replay')));

  -- Fin de session ?
  if v_mode = 'king' then
    select min(coalesce((value->>'played')::integer, 0)) into v_minp from jsonb_each(v_s->'stats');
    if v_minp >= 1 and coalesce((v_s->'streak'->>'count')::integer, 0) >= coalesce((v_s->>'streak_target')::integer, 3) then
      v_over := true; v_reason := 'streak';
    elsif v_minp >= coalesce((v_s->>'min_played')::integer, 2) then
      v_over := true; v_reason := 'rotation';
    elsif (v_s->>'duel_count')::integer >= 4 * jsonb_array_length(p_state->'players') + 10 then
      v_over := true; v_reason := 'limit';
    end if;
  elsif v_mode = 'tournament' then
    v_nrds := jsonb_array_length(v_s->'bracket'->'rounds');
    v_champ := v_s->'bracket'->'rounds'->(v_nrds - 1)->0->>'winner';
    if v_champ is not null then v_over := true; v_reason := 'bracket'; end if;
  else
    v_over := true; v_reason := 'duel'; v_champ := v_w;
  end if;
  v_s := v_s || jsonb_build_object('over', v_over, 'end_reason', v_reason, 'champion', v_champ);

  v_d := v_d || jsonb_build_object('result', jsonb_build_object(
    'winner', v_w, 'draw', v_w is null, 'advanced', v_adv, 'bets_right', v_right));
  return p_state || jsonb_build_object('session', v_s, 'duel', v_d);
end $$;

-- Fin d'une manche (coup gagnant ou grille pleine) -> phase 'result'.
create or replace function public._duel_end_game(p_state jsonb, p_outcome text, p_winner text, p_extra jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_s    jsonb := p_state->'session';
  v_d    jsonb := p_state->'duel';
  v_bo   integer := coalesce((v_s->>'best_of')::integer, 1);
  v_need integer := (coalesce((v_s->>'best_of')::integer, 1) + 1) / 2;
  v_done boolean;
begin
  if p_outcome = 'win' and (p_winner is null or p_winner not in (v_d->>'a', v_d->>'b')) then
    raise exception 'invalid_board';
  end if;
  if p_outcome = 'win' then
    v_d := jsonb_set(v_d, array['wins', p_winner], to_jsonb(coalesce((v_d->'wins'->>p_winner)::integer, 0) + 1));
  end if;
  v_d := v_d || jsonb_build_object(
    'outcome', p_outcome,
    'winner', case when p_outcome = 'win' then p_winner end,
    'turn', null,
    'games', coalesce(v_d->'games', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'no', v_d->'game_no', 'starter', v_d->'starter',
      'winner', case when p_outcome = 'win' then p_winner end, 'moves', v_d->'moves')))
    || coalesce(p_extra, '{}'::jsonb);
  v_done := (p_outcome = 'win' and (v_d->'wins'->>p_winner)::integer >= v_need)
            or (v_d->>'game_no')::integer >= v_bo;
  p_state := p_state || jsonb_build_object('duel', v_d);
  if v_done then p_state := public._duel_end_duel(p_state); end if;
  return p_state || jsonb_build_object('phase', 'result', 'deadline', public._duel_in(case when v_done then 5 else 4 end));
end $$;

-- Applique un coup de la phase 'playing'.
create or replace function public._duel_apply_move(p_game text, p_x jsonb, p_actor text, p_move jsonb, p_auto boolean)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_state  jsonb := p_x->'state';
  v_server jsonb := coalesce(p_x->'server', '{}'::jsonb);
  v_d      jsonb := v_state->'duel';
  v_r      jsonb;
  v_out    text;
  v_turn   text;
begin
  v_r := public._duel_board_move(p_game, v_state->'board', coalesce(v_server->'board', 'null'::jsonb), p_actor, p_move);
  v_out := v_r->>'outcome';
  if v_out is not null and v_out not in ('win', 'draw') then raise exception 'invalid_board'; end if;
  if v_r ? 'server' then v_server := v_server || jsonb_build_object('board', v_r->'server'); end if;
  v_d := v_d || jsonb_build_object(
    'moves', coalesce((v_d->>'moves')::integer, 0) + 1,
    'last_move', jsonb_build_object('by', p_actor, 'move', p_move, 'auto', p_auto));
  v_state := v_state || jsonb_build_object('board', v_r->'board', 'duel', v_d);
  if v_out is not null then
    v_state := public._duel_end_game(v_state, v_out, v_r->>'winner', null);
  else
    v_turn := coalesce(v_r->>'turn', public._duel_other(v_d, p_actor));
    if v_turn not in (v_d->>'a', v_d->>'b') then raise exception 'invalid_board'; end if;
    v_state := v_state || jsonb_build_object(
      'duel', v_d || jsonb_build_object('turn', v_turn),
      'deadline', public._duel_in(coalesce((v_state->'session'->>'turn_seconds')::integer, 30)));
  end if;
  return public._duel_add_secrets(p_x || jsonb_build_object('state', v_state, 'server', v_server), v_r->'secrets');
end $$;

-- Préparation simultanée : les deux sont prêts -> board_setup 'begin' -> 'playing'.
create or replace function public._duel_setup_begin(p_game text, p_x jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_state  jsonb := p_x->'state';
  v_server jsonb := coalesce(p_x->'server', '{}'::jsonb);
  v_d      jsonb := v_state->'duel';
  v_r      jsonb;
begin
  v_r := public._duel_board_setup(p_game, v_state->'board', coalesce(v_server->'board', 'null'::jsonb), null,
                                  '{"type":"begin"}'::jsonb);
  if v_r ? 'server' then v_server := v_server || jsonb_build_object('board', v_r->'server'); end if;
  v_state := v_state || jsonb_build_object(
    'phase', 'playing',
    'board', v_r->'board',
    'duel', v_d || jsonb_build_object('turn', v_d->>'starter'),
    'deadline', public._duel_in(coalesce((v_state->'session'->>'turn_seconds')::integer, 30)));
  return public._duel_add_secrets(p_x || jsonb_build_object('state', v_state, 'server', v_server), v_r->'secrets');
end $$;

-- Un coup de préparation (ou 'ready' / 'auto') pour p_actor.
create or replace function public._duel_setup_call(p_game text, p_x jsonb, p_actor text, p_move jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_state  jsonb := p_x->'state';
  v_server jsonb := coalesce(p_x->'server', '{}'::jsonb);
  v_r      jsonb;
begin
  v_r := public._duel_board_setup(p_game, v_state->'board', coalesce(v_server->'board', 'null'::jsonb), p_actor, p_move);
  if v_r ? 'server' then v_server := v_server || jsonb_build_object('board', v_r->'server'); end if;
  v_state := v_state || jsonb_build_object('board', v_r->'board');
  return public._duel_add_secrets(p_x || jsonb_build_object('state', v_state, 'server', v_server), v_r->'secrets');
end $$;

-- ---------------------------------------------------------------- fin de session

-- Classement par points de session. won : champion du tournoi / vainqueur du
-- duel / meilleur(s) score(s) (roi, ou session arrêtée sans champion ; max > 0).
-- Le champion (s'il existe) est classé 1er quels que soient les points.
create or replace function public._duel_finish(p_state jsonb, p_reason text)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_s       jsonb := p_state->'session';
  v_champ   text := v_s->>'champion';
  v_reason  text := coalesce(p_reason, v_s->>'end_reason');
  v_max     integer;
  v_winners jsonb;
  v_results jsonb;
begin
  if v_reason = 'stopped' and v_s->>'mode' = 'duel' then v_champ := null; end if;
  select max(value::integer) into v_max from jsonb_each_text(v_s->'scores');
  if v_champ is not null then
    v_winners := jsonb_build_array(v_champ);
  elsif v_s->>'mode' = 'duel' and v_reason = 'duel' then
    v_winners := '[]'::jsonb;  -- duel nul : personne ne gagne
  elsif coalesce(v_max, 0) > 0 then
    select jsonb_agg(key order by key) into v_winners from jsonb_each_text(v_s->'scores') where value::integer = v_max;
  else
    v_winners := '[]'::jsonb;
  end if;

  -- stats.duel_wins = duels remportés dans la session (tenues : chaque duel gagné compte).
  select jsonb_agg(jsonb_build_object('profile_id', p, 'points', pts, 'won', w, 'placement', pl,
                                      'stats', jsonb_build_object('duel_wins',
                                        coalesce((v_s->'stats'->p->>'wins')::integer, 0)))
                   order by pl, p)
    into v_results
    from (select p, pts, w, (rank() over (order by w desc, pts desc))::integer as pl
            from (select x.p, coalesce((v_s->'scores'->>x.p)::integer, 0) as pts, v_winners ? x.p as w
                    from jsonb_array_elements_text(p_state->'players') as x(p)) t) u;

  return p_state || jsonb_build_object(
    'phase', 'finished',
    'deadline', null,
    'winners', v_winners,
    'results', v_results,
    'session', v_s || jsonb_build_object('over', true, 'end_reason', v_reason, 'champion', v_champ));
end $$;

-- Après la phase 'result' : manche suivante, duel suivant ou fin de session.
create or replace function public._duel_advance(p_game text, p_x jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_state jsonb := p_x->'state';
begin
  if v_state->'duel'->'result' is null or jsonb_typeof(v_state->'duel'->'result') = 'null' then
    return public._duel_begin_game(p_game, p_x);             -- manche suivante (meilleur de 3)
  end if;
  if coalesce((v_state->'session'->>'over')::boolean, false) then
    return p_x || jsonb_build_object('state', public._duel_finish(v_state, null));
  end if;
  return p_x || jsonb_build_object('state', public._duel_announce(v_state, 5));
end $$;

-- ---------------------------------------------------------------- démarrage

-- Options : {mode: 'king'|'tournament'|'duel' (défaut king), best_of: 1|3 (mode
-- duel uniquement), duel_players: [uuid, uuid] (mode duel ; absent = au hasard),
-- turn_seconds: 10..120 (défaut 30), board: {...options propres au jeu}}
create or replace function public._duel_start(p_game text, p_players uuid[], p_options jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_n      integer := cardinality(p_players);
  v_opts   jsonb := coalesce(p_options, '{}'::jsonb);
  v_mode   text := coalesce(nullif(v_opts->>'mode', ''), 'king');
  v_ids    text[] := array(select x::text from unnest(p_players) as t(x));
  v_shuf   text[];
  v_bo     integer;
  v_secs   integer;
  v_scores jsonb := '{}'::jsonb;
  v_stats  jsonb := '{}'::jsonb;
  v_pair   text[];
  v_s      jsonb;
  v_state  jsonb;
  p        text;
begin
  perform public._duel_fn(p_game, 'board_new', 'jsonb, text, text');
  perform public._duel_fn(p_game, 'board_move', 'jsonb, jsonb, text, jsonb');
  perform public._duel_fn(p_game, 'board_auto', 'jsonb, jsonb, text');
  if v_n < 2 then raise exception 'not_enough_players'; end if;
  if v_n > 16 then raise exception 'too_many_players'; end if;
  if v_mode not in ('king', 'tournament', 'duel') then raise exception 'invalid_mode'; end if;
  v_bo := case when v_mode = 'duel' and v_opts->>'best_of' = '3' then 3 else 1 end;
  v_secs := case when coalesce(v_opts->>'turn_seconds', '') ~ '^\d{1,3}$'
                 then least(120, greatest(10, (v_opts->>'turn_seconds')::integer)) else 30 end;
  v_shuf := public._duel_shuffle(v_ids);

  foreach p in array v_ids loop
    v_scores := v_scores || jsonb_build_object(p, 0);
    v_stats := v_stats || jsonb_build_object(p, jsonb_build_object(
      'played', 0, 'wins', 0, 'draws', 0, 'losses', 0, 'bets', 0, 'bets_won', 0, 'starts', 0));
  end loop;

  if v_mode = 'duel' then
    if jsonb_typeof(v_opts->'duel_players') = 'array' and jsonb_array_length(v_opts->'duel_players') > 0 then
      v_pair := array(select jsonb_array_elements_text(v_opts->'duel_players'));
      if cardinality(v_pair) <> 2 or v_pair[1] = v_pair[2]
         or not (v_pair[1] = any(v_ids)) or not (v_pair[2] = any(v_ids)) then
        raise exception 'invalid_duel_players';
      end if;
    else
      v_pair := v_shuf[1:2];
    end if;
  end if;

  v_s := jsonb_build_object(
    'mode', v_mode,
    'best_of', v_bo,
    'turn_seconds', v_secs,
    'board_options', case when jsonb_typeof(v_opts->'board') = 'object' then v_opts->'board' else '{}'::jsonb end,
    'scores', v_scores,
    'stats', v_stats,
    'streak', jsonb_build_object('player', null, 'count', 0),
    'streak_target', 3,
    'min_played', 2,
    'duel_count', 0,
    'history', '[]'::jsonb,
    'queue', case when v_mode = 'king' then to_jsonb(v_shuf) end,
    'bracket', case when v_mode = 'tournament' then public._duel_bracket_new(v_shuf) end,
    'pair', case when v_mode = 'duel' then to_jsonb(v_pair) end,
    'over', false,
    'end_reason', null,
    'champion', null);

  v_state := jsonb_build_object(
    'game', p_game,
    'phase', 'transition',
    'players', to_jsonb(p_players),
    'session', v_s,
    'duel', null,
    'board', null,
    'deadline', null,
    'winners', null,
    'results', null);
  -- 8 s au premier duel : le temps que tout le monde arrive (et parie).
  v_state := public._duel_announce(v_state, 8);
  return jsonb_build_object('state', v_state, 'server', jsonb_build_object('board', null));
end $$;

-- ---------------------------------------------------------------- actions
--   {"type":"move","move":{...}}   duelliste dont c'est le tour (playing) ;
--                                  en 'setup' : coup de préparation (l'un ou l'autre)
--   {"type":"ready"}               duelliste, phase 'setup'
--   {"type":"bet","winner":uuid}   spectateur, paris ouverts (modifiable)
--   {"type":"tick"}                n'importe qui, à l'échéance (sinon sans effet)
--   {"type":"next"}                hôte : passe la transition / le résultat
--   {"type":"stop"}                hôte : termine la session maintenant (duel en cours ignoré)
create or replace function public._duel_action(
  p_game text, p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_type   text := p_action->>'type';
  v_me     text := p_actor::text;
  v_phase  text := p_state->>'phase';
  v_d      jsonb := p_state->'duel';
  v_x      jsonb := jsonb_build_object('state', p_state, 'server', coalesce(p_server, '{}'::jsonb), 'secrets', '{}'::jsonb);
  v_target text;
  v_open   boolean;
  v_ready  jsonb;
  v_move   jsonb;
  p        text;
begin
  if v_phase not in ('transition', 'setup', 'playing', 'result') then raise exception 'wrong_phase'; end if;

  if v_type = 'tick' then
    if p_state->>'deadline' is null or now() < (p_state->>'deadline')::timestamptz then
      return jsonb_build_object('state', p_state, 'server', p_server);  -- trop tôt / déjà traité
    end if;
    if v_phase = 'transition' then
      v_x := public._duel_begin_game(p_game, v_x);
    elsif v_phase = 'setup' then
      -- Échéance de la préparation : on complète au hasard pour les retardataires.
      foreach p in array array[v_d->>'a', v_d->>'b'] loop
        if not ((v_d->'ready') ? p) then
          v_x := public._duel_setup_call(p_game, v_x, p, '{"type":"auto"}'::jsonb);
        end if;
      end loop;
      v_x := jsonb_set(v_x, '{state,duel,ready}', jsonb_build_array(v_d->>'a', v_d->>'b'));
      v_x := public._duel_setup_begin(p_game, v_x);
    elsif v_phase = 'playing' then
      v_move := public._duel_board_auto(p_game, p_state->'board', coalesce(p_server->'board', 'null'::jsonb), v_d->>'turn');
      v_x := public._duel_apply_move(p_game, v_x, v_d->>'turn', v_move, true);
    else
      v_x := public._duel_advance(p_game, v_x);
    end if;

  elsif v_type = 'next' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase = 'transition' then
      v_x := public._duel_begin_game(p_game, v_x);
    elsif v_phase = 'result' then
      v_x := public._duel_advance(p_game, v_x);
    else
      raise exception 'wrong_phase';
    end if;

  elsif v_type = 'stop' then
    if not p_is_host then raise exception 'not_host'; end if;
    v_x := v_x || jsonb_build_object('state', public._duel_finish(p_state, 'stopped'));

  elsif v_type = 'bet' then
    if not ((p_state->'players') ? v_me) then raise exception 'not_a_player'; end if;
    if v_me in (v_d->>'a', v_d->>'b') then raise exception 'duelist_cannot_bet'; end if;
    v_target := p_action->>'winner';
    if v_target is null or v_target not in (v_d->>'a', v_d->>'b') then raise exception 'invalid_bet'; end if;
    v_open := v_phase = 'transition'
              or (v_phase in ('setup', 'playing') and (v_d->>'game_no')::integer = 1
                  and (coalesce((v_d->>'moves')::integer, 0) = 0
                       or now() < (v_d->>'bets_until')::timestamptz));
    if not v_open then raise exception 'bets_closed'; end if;
    v_x := jsonb_set(v_x, array['state', 'duel', 'bets', v_me], to_jsonb(v_target));

  elsif v_type = 'move' then
    if v_me not in (v_d->>'a', v_d->>'b') then raise exception 'not_duelist'; end if;
    v_move := p_action->'move';
    if v_move is null or jsonb_typeof(v_move) <> 'object' then raise exception 'invalid_move'; end if;
    if v_phase = 'playing' then
      if v_d->>'turn' is distinct from v_me then raise exception 'not_your_turn'; end if;
      v_x := public._duel_apply_move(p_game, v_x, v_me, v_move, false);
    elsif v_phase = 'setup' then
      if (v_d->'ready') ? v_me then raise exception 'already_ready'; end if;
      if v_move->>'type' in ('ready', 'auto', 'begin') then raise exception 'invalid_move'; end if;
      v_x := public._duel_setup_call(p_game, v_x, v_me, v_move);
    else
      raise exception 'wrong_phase';
    end if;

  elsif v_type = 'ready' then
    if v_me not in (v_d->>'a', v_d->>'b') then raise exception 'not_duelist'; end if;
    if v_phase <> 'setup' then raise exception 'wrong_phase'; end if;
    if (v_d->'ready') ? v_me then raise exception 'already_ready'; end if;
    v_x := public._duel_setup_call(p_game, v_x, v_me, '{"type":"ready"}'::jsonb);
    v_ready := (v_d->'ready') || to_jsonb(v_me);
    v_x := jsonb_set(v_x, '{state,duel,ready}', v_ready);
    if jsonb_array_length(v_ready) >= 2 then
      v_x := public._duel_setup_begin(p_game, v_x);
    end if;

  else
    raise exception 'unknown_action';
  end if;

  if v_x->'state'->>'phase' = 'finished' then
    return jsonb_build_object('state', v_x->'state', 'server', v_x->'server', 'results', v_x->'state'->'results');
  end if;
  if v_x->'secrets' <> '{}'::jsonb then
    return jsonb_build_object('state', v_x->'state', 'server', v_x->'server', 'secrets', v_x->'secrets');
  end if;
  return jsonb_build_object('state', v_x->'state', 'server', v_x->'server');
end $$;

-- ---------------------------------------------------------------- droits

revoke all on function public._duel_iso(timestamptz) from public, anon, authenticated;
revoke all on function public._duel_in(numeric) from public, anon, authenticated;
revoke all on function public._duel_shuffle(text[]) from public, anon, authenticated;
revoke all on function public._duel_hook(text, text, text) from public, anon, authenticated;
revoke all on function public._duel_fn(text, text, text) from public, anon, authenticated;
revoke all on function public._duel_board_new(text, jsonb, text, text) from public, anon, authenticated;
revoke all on function public._duel_board_move(text, jsonb, jsonb, text, jsonb) from public, anon, authenticated;
revoke all on function public._duel_board_auto(text, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public._duel_board_setup(text, jsonb, jsonb, text, jsonb) from public, anon, authenticated;
revoke all on function public._duel_other(jsonb, text) from public, anon, authenticated;
revoke all on function public._duel_stat(jsonb, text, text, integer) from public, anon, authenticated;
revoke all on function public._duel_score(jsonb, text, integer) from public, anon, authenticated;
revoke all on function public._duel_add_secrets(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._duel_bracket_new(text[]) from public, anon, authenticated;
revoke all on function public._duel_bracket_win(jsonb, integer, integer, text, boolean) from public, anon, authenticated;
revoke all on function public._duel_pair_next(jsonb) from public, anon, authenticated;
revoke all on function public._duel_announce(jsonb, numeric) from public, anon, authenticated;
revoke all on function public._duel_begin_game(text, jsonb) from public, anon, authenticated;
revoke all on function public._duel_end_duel(jsonb) from public, anon, authenticated;
revoke all on function public._duel_end_game(jsonb, text, text, jsonb) from public, anon, authenticated;
revoke all on function public._duel_apply_move(text, jsonb, text, jsonb, boolean) from public, anon, authenticated;
revoke all on function public._duel_setup_begin(text, jsonb) from public, anon, authenticated;
revoke all on function public._duel_setup_call(text, jsonb, text, jsonb) from public, anon, authenticated;
revoke all on function public._duel_finish(jsonb, text) from public, anon, authenticated;
revoke all on function public._duel_advance(text, jsonb) from public, anon, authenticated;
revoke all on function public._duel_start(text, uuid[], jsonb) from public, anon, authenticated;
revoke all on function public._duel_action(text, jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;
