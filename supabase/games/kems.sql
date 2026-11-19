-- =============================================================================
-- JEU « kems » (Kems, le jeu de cartes de la cour de récré) — idempotent (create or replace).
-- Dépend de schema.sql (game_action, start_match, finish_match).
-- Conception : docs/superpowers/specs/2026-11-19-kems-design.md (section 10 = décisions).
--
-- 2 à 4 équipes (red, blue, green, yellow : ordre fixe) de EXACTEMENT 2 joueurs ; les autres sont
-- sur le banc (p_players hors équipes, absents de state.players : ils regardent).
-- Cartes : 4 joueurs = 32 cartes (7 -> As), 6 ou 8 joueurs = 52 cartes. Id d'une carte = valeur + couleur
-- (« 7H », « 10S », « AD »…) ; couleurs S (pique) H (coeur) D (carreau) C (trèfle).
-- Phases : signs (les équipes choisissent leur signe, « Prêt » ou 45 s) -> playing (échanges simultanés,
-- balayage du centre, KEMS / CONTRE-KEMS) -> reveal (6 s, mains retournées) -> playing … -> finished.
--
-- Secrets : les mains ne sont JAMAIS dans le state public avant la révélation. server.hands = {joueur: [4 cartes]}
-- (autoritaire) ; match_secrets[joueur] = {round, hand, square, sign_ideas, v}. state.hand_ver[joueur] augmente à
-- chaque nouvelle main (le front relit son secret). game_action verrouille la ligne du match : les échanges
-- simultanés sont sérialisés, le premier arrivé gagne (le 2e reçoit card_taken).
-- Le signe, lui, se fait dans la vraie vie : le serveur ne le connaît pas (il ne distribue que des idées).
-- =============================================================================

-- Mélange d'un tableau jsonb.
create or replace function public._kems_shuffle(p jsonb)
returns jsonb language sql volatile
set search_path = public, extensions
as $$ select coalesce(jsonb_agg(x order by random()), '[]'::jsonb) from jsonb_array_elements(coalesce(p, '[]'::jsonb)) x $$;

-- Une main de 4 cartes est-elle un carré (4 cartes de même valeur) ?
create or replace function public._kems_square(p_hand jsonb)
returns boolean language sql immutable
set search_path = public, extensions
as $$
  select coalesce(jsonb_typeof(p_hand) = 'array' and jsonb_array_length(p_hand) = 4
         and (select count(distinct left(c, -1)) from jsonb_array_elements_text(p_hand) c) = 1, false)
$$;

-- Ajoute p_delta au compteur p_key du joueur p_pid (server.pstats).
create or replace function public._kems_bump(p_server jsonb, p_pid text, p_key text, p_delta integer)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select case when p_server->'pstats' ? p_pid
    then jsonb_set(p_server, array['pstats', p_pid, p_key],
                   to_jsonb(coalesce((p_server->'pstats'->p_pid->>p_key)::integer, 0) + p_delta))
    else p_server end
$$;

-- Idem pour les compteurs d'équipe publics (state.tstats : kems, counters, errors, countered).
create or replace function public._kems_tbump(p_state jsonb, p_team text, p_key text, p_delta integer)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select jsonb_set(p_state, array['tstats', p_team, p_key],
                   to_jsonb(coalesce((p_state->'tstats'->p_team->>p_key)::integer, 0) + p_delta))
$$;

-- Secret d'un joueur (main, carré, idées de signe). La version vient de state.hand_ver (déjà incrémentée).
create or replace function public._kems_secret(p_state jsonb, p_server jsonb, p_pid text)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'round', (p_state->>'round')::integer,
    'hand', coalesce(p_server->'hands'->p_pid, '[]'::jsonb),
    'square', public._kems_square(p_server->'hands'->p_pid),
    'sign_ideas', coalesce(p_server->'signs'->p_pid, '[]'::jsonb),
    'v', coalesce((p_state->'hand_ver'->>p_pid)::integer, 1))
$$;

-- state.deadline = prochaine échéance du tick pendant « playing » (balayage auto ou manche blanche).
create or replace function public._kems_playing_deadline(p_state jsonb)
returns jsonb language sql stable
set search_path = public, extensions
as $$
  select p_state || jsonb_build_object('deadline', to_jsonb(least(
    (p_state->'sweep'->>'deadline')::timestamptz, (p_state->>'round_deadline')::timestamptz)))
$$;

-- Distribue la manche p_round : paquet mélangé, 4 cartes par joueur, 4 au centre. Renvoie {state, server, secrets}.
create or replace function public._kems_deal(p_state jsonb, p_server jsonb, p_round integer)
returns jsonb language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  v_players text[] := array(select jsonb_array_elements_text(p_state->'players'));
  v_n       integer := array_length(v_players, 1);
  v_ranks   text[] := case when array_length(v_players, 1) <= 4
                           then array['7', '8', '9', '10', 'J', 'Q', 'K', 'A']
                           else array['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] end;
  v_deck    text[];
  v_i       integer;
  v_pid     text;
  v_hands   jsonb := '{}'::jsonb;
  v_ver     jsonb := coalesce(p_state->'hand_ver', '{}'::jsonb);
  v_secrets jsonb := '{}'::jsonb;
  v_sq      jsonb := '{}'::jsonb;
begin
  select array_agg(r || s order by random()) into v_deck
    from unnest(v_ranks) r, unnest(array['S', 'H', 'D', 'C']) s;
  for v_i in 1 .. v_n loop
    v_pid := v_players[v_i];
    v_hands := v_hands || jsonb_build_object(v_pid, to_jsonb(v_deck[(v_i - 1) * 4 + 1 : v_i * 4]));
    v_ver := v_ver || jsonb_build_object(v_pid, coalesce((v_ver->>v_pid)::integer, 0) + 1);
    if public._kems_square(v_hands->v_pid) then
      p_server := public._kems_bump(p_server, v_pid, 'squares', 1);
      v_sq := v_sq || jsonb_build_object(v_pid, p_round);
    end if;
  end loop;

  p_state := p_state || jsonb_build_object(
    'phase', 'playing', 'round', p_round, 'ready', '[]'::jsonb, 'hand_ver', v_ver,
    'center', to_jsonb(v_deck[v_n * 4 + 1 : v_n * 4 + 4]),
    'deck_count', array_length(v_deck, 1) - v_n * 4 - 4,
    'sweep', jsonb_build_object('votes', '[]'::jsonb, 'deadline', to_jsonb(now() + interval '10 seconds')),
    'round_deadline', to_jsonb(now() + interval '180 seconds'),
    'feed', '[]'::jsonb, 'call', null);
  p_state := public._kems_playing_deadline(p_state);
  p_server := p_server || jsonb_build_object(
    'deck', to_jsonb(v_deck[v_n * 4 + 5 : array_length(v_deck, 1)]), 'discard', '[]'::jsonb,
    'hands', v_hands, 'round_started_at', to_jsonb(now()),
    'sq_counted', coalesce(p_server->'sq_counted', '{}'::jsonb) || v_sq, 'last_swap', '{}'::jsonb);
  foreach v_pid in array v_players loop
    v_secrets := v_secrets || jsonb_build_object(v_pid, public._kems_secret(p_state, p_server, v_pid));
  end loop;
  return jsonb_build_object('state', p_state, 'server', p_server, 'secrets', v_secrets);
end $$;

-- Balaie le centre : 4 nouvelles cartes (pioche vide -> la défausse est remélangée, sans le centre balayé).
create or replace function public._kems_sweep(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  v_swept jsonb := p_state->'center';
  v_deck  jsonb := p_server->'deck';
  v_new   jsonb;
  v_need  integer;
begin
  v_new := (select coalesce(jsonb_agg(x order by o), '[]'::jsonb) from jsonb_array_elements(v_deck) with ordinality t(x, o) where o <= 4);
  v_deck := (select coalesce(jsonb_agg(x order by o), '[]'::jsonb) from jsonb_array_elements(v_deck) with ordinality t(x, o) where o > 4);
  v_need := 4 - jsonb_array_length(v_new);
  if v_need > 0 then
    v_deck := public._kems_shuffle(p_server->'discard');
    v_new := v_new || (select coalesce(jsonb_agg(x order by o), '[]'::jsonb) from jsonb_array_elements(v_deck) with ordinality t(x, o) where o <= v_need);
    v_deck := (select coalesce(jsonb_agg(x order by o), '[]'::jsonb) from jsonb_array_elements(v_deck) with ordinality t(x, o) where o > v_need);
    p_server := p_server || jsonb_build_object('discard', '[]'::jsonb);
  end if;
  p_server := p_server || jsonb_build_object('deck', v_deck, 'discard', (p_server->'discard') || v_swept);
  p_state := p_state || jsonb_build_object(
    'center', v_new, 'deck_count', jsonb_array_length(v_deck),
    'sweeps', coalesce((p_state->>'sweeps')::integer, 0) + 1,
    'sweep', jsonb_build_object('votes', '[]'::jsonb, 'deadline', to_jsonb(now() + interval '10 seconds')));
  return jsonb_build_object('state', public._kems_playing_deadline(p_state), 'server', p_server);
end $$;

-- Fin de partie : équipes à l'objectif = gagnantes (co-vainqueurs possibles) ; un résultat par membre d'équipe.
create or replace function public._kems_finish(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_results jsonb;
  v_t       jsonb;
  v_m       text;
  v_target  integer := (p_state->>'target')::integer;
begin
  -- Poker face : victoire sans erreur de l'équipe et sans contre réussi contre elle
  for v_t in select t from jsonb_array_elements(p_state->'teams') t where (t->>'score')::integer >= v_target loop
    if coalesce((p_state->'tstats'->(v_t->>'id')->>'errors')::integer, 0) = 0
       and coalesce((p_state->'tstats'->(v_t->>'id')->>'countered')::integer, 0) = 0 then
      for v_m in select jsonb_array_elements_text(v_t->'players') loop
        p_server := public._kems_bump(p_server, v_m, 'clean_win', 1);
      end loop;
    end if;
  end loop;
  with t as (
    select x->>'id' as id, x->'players' as players, (x->>'score')::integer as score
      from jsonb_array_elements(p_state->'teams') x
  ), r as (
    select t.*, dense_rank() over (order by score desc) as rk from t
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'profile_id', m, 'points', r.score, 'won', r.score >= v_target, 'placement', r.rk,
           'stats', coalesce(p_server->'pstats'->m, '{}'::jsonb))), '[]'::jsonb)
    into v_results
    from r, jsonb_array_elements_text(r.players) m;
  p_state := p_state || jsonb_build_object('phase', 'finished', 'results', v_results, 'deadline', null,
    'winners', (select jsonb_agg(x->>'id') from jsonb_array_elements(p_state->'teams') x where (x->>'score')::integer >= v_target));
  return jsonb_build_object('state', p_state, 'server', p_server, 'results', v_results);
end $$;

-- Fin de manche : applique p_call.deltas aux scores, retourne les mains (state.call) puis révélation ou fin de partie.
create or replace function public._kems_end_round(p_state jsonb, p_server jsonb, p_call jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_teams jsonb;
begin
  select jsonb_agg(t || jsonb_build_object('score',
           (t->>'score')::integer + coalesce((p_call->'deltas'->>(t->>'id'))::integer, 0)) order by o)
    into v_teams from jsonb_array_elements(p_state->'teams') with ordinality x(t, o);
  p_call := p_call || jsonb_build_object('hands', p_server->'hands', 'round', p_state->'round',
    'holders', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_each(p_server->'hands') e(k, v) where public._kems_square(v)));
  p_state := p_state || jsonb_build_object(
    'teams', v_teams, 'call', p_call, 'phase', 'reveal',
    'sweep', jsonb_build_object('votes', '[]'::jsonb, 'deadline', null),
    'deadline', to_jsonb(now() + interval '6 seconds'));
  if exists (select 1 from jsonb_array_elements(v_teams) t where (t->>'score')::integer >= (p_state->>'target')::integer) then
    return public._kems_finish(p_state, p_server);
  end if;
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

create or replace function public.game_kems_start(p_players uuid[], p_options jsonb)
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
  v_target  integer := case when p_options->>'target' in ('3', '5', '7') then (p_options->>'target')::integer else 5 end;
  v_pool    jsonb := case when jsonb_typeof(p_options->'signs') = 'array' then p_options->'signs' else '[]'::jsonb end;
  v_signs   jsonb := '{}'::jsonb;
  v_ideas   jsonb;
  v_pstats  jsonb := '{}'::jsonb;
  v_tstats  jsonb := '{}'::jsonb;
  v_ver     jsonb := '{}'::jsonb;
  v_secrets jsonb := '{}'::jsonb;
  v_bench   jsonb;
  v_state   jsonb;
  v_server  jsonb;
begin
  if v_in is null or jsonb_typeof(v_in) <> 'object' then raise exception 'invalid_teams'; end if;
  for v_k in select jsonb_object_keys(v_in) loop
    if not (v_k = any(v_colors)) then raise exception 'invalid_teams'; end if;
  end loop;
  foreach v_c in array v_colors loop
    continue when not (v_in ? v_c);
    v_members := v_in->v_c;
    if jsonb_typeof(v_members) <> 'array' or jsonb_array_length(v_members) <> 2 then raise exception 'invalid_teams'; end if;
    for v_m in select jsonb_array_elements_text(v_members) loop
      if v_m = any(v_seen) or not (v_m::uuid = any(p_players)) then raise exception 'invalid_teams'; end if;
      v_seen := v_seen || v_m;
    end loop;
    v_teams := v_teams || jsonb_build_array(jsonb_build_object('id', v_c, 'players', v_members, 'score', 0));
    v_players := v_players || v_members;
    v_tstats := v_tstats || jsonb_build_object(v_c, jsonb_build_object('kems', 0, 'counters', 0, 'errors', 0, 'countered', 0));
    -- 3 idées de signe par équipe, les mêmes pour les deux coéquipiers
    select coalesce(jsonb_agg(left(x, 80)), '[]'::jsonb) into v_ideas
      from (select x from jsonb_array_elements_text(v_pool) x where btrim(x) <> '' order by random() limit 3) q;
    for v_m in select jsonb_array_elements_text(v_members) loop
      v_signs := v_signs || jsonb_build_object(v_m, v_ideas);
    end loop;
  end loop;
  if jsonb_array_length(v_teams) not between 2 and 4 then raise exception 'invalid_teams'; end if;

  for v_m in select jsonb_array_elements_text(v_players) loop
    v_pstats := v_pstats || jsonb_build_object(v_m, jsonb_build_object(
      'false_kems', 0, 'countered', 0, 'false_counters', 0, 'squares', 0, 'team_kems', 0,
      'counters_ok', 0, 'fast_kems', 0, 'clean_win', 0, 'double_kems', 0));
    v_ver := v_ver || jsonb_build_object(v_m, 1);
  end loop;
  select coalesce(jsonb_agg(to_jsonb(p) order by o), '[]'::jsonb) into v_bench
    from unnest(p_players) with ordinality t(p, o) where not (p::text = any(v_seen));

  v_state := jsonb_build_object(
    'game', 'kems', 'phase', 'signs', 'players', v_players, 'bench', v_bench, 'round', 0, 'target', v_target,
    'teams', v_teams, 'ready', '[]'::jsonb, 'center', '[]'::jsonb, 'deck_count', 0,
    'sweep', jsonb_build_object('votes', '[]'::jsonb, 'deadline', null), 'round_deadline', null,
    'deadline', to_jsonb(now() + interval '45 seconds'), 'feed', '[]'::jsonb, 'swaps', 0, 'sweeps', 0,
    'hand_ver', v_ver, 'call', null, 'tstats', v_tstats);
  v_server := jsonb_build_object('signs', v_signs, 'pstats', v_pstats, 'hands', '{}'::jsonb, 'deck', '[]'::jsonb,
    'discard', '[]'::jsonb, 'sq_counted', '{}'::jsonb, 'last_swap', '{}'::jsonb);
  for v_m in select jsonb_array_elements_text(v_players) loop
    v_secrets := v_secrets || jsonb_build_object(v_m, public._kems_secret(v_state, v_server, v_m));
  end loop;
  return jsonb_build_object('state', v_state, 'server', v_server, 'secrets', v_secrets);
end $$;

create or replace function public.game_kems_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_type    text := p_action->>'type';
  v_phase   text := p_state->>'phase';
  v_me      text := p_actor::text;
  v_team    jsonb;
  v_partner text;
  v_n       integer := jsonb_array_length(p_state->'players');
  v_unchanged jsonb := jsonb_build_object('state', p_state, 'server', p_server);
  v_give    text;
  v_take    text;
  v_hand    jsonb;
  v_ms      bigint;
  v_votes   jsonb;
  v_res     jsonb;
  v_call    jsonb;
  v_deltas  jsonb;
  v_tid     text;
  v_target  jsonb;
  v_others  text[];
  v_ok      boolean;
  v_double  boolean;
  v_m       text;
  v_ver     jsonb;
  v_started timestamptz;
begin
  select t into v_team from jsonb_array_elements(p_state->'teams') t where t->'players' ? v_me;
  if v_team is not null then
    select x into v_partner from jsonb_array_elements_text(v_team->'players') x where x <> v_me limit 1;
  end if;

  -- ---------------------------------------------------------------- ready
  if v_type = 'ready' then
    if v_phase <> 'signs' then return v_unchanged; end if;
    if v_team is null then raise exception 'not_in_match'; end if;
    if not ((p_state->'ready') ? v_me) then
      p_state := p_state || jsonb_build_object('ready', (p_state->'ready') || to_jsonb(v_me));
    end if;
    if jsonb_array_length(p_state->'ready') >= v_n then return public._kems_deal(p_state, p_server, 1); end if;
    return jsonb_build_object('state', p_state, 'server', p_server);

  -- ---------------------------------------------------------------- swap {give, take} (identifiants de cartes)
  elsif v_type = 'swap' then
    if v_phase <> 'playing' then return v_unchanged; end if;
    if v_team is null then raise exception 'not_in_match'; end if;
    if jsonb_typeof(p_action->'give') <> 'string' or jsonb_typeof(p_action->'take') <> 'string' then raise exception 'invalid_action'; end if;
    v_give := p_action->>'give';
    v_take := p_action->>'take';
    -- double appui : un échange du même joueur moins de 250 ms après le précédent est ignoré
    v_ms := (extract(epoch from clock_timestamp()) * 1000)::bigint;
    if v_ms - coalesce((p_server->'last_swap'->>v_me)::bigint, 0) < 250 then return v_unchanged; end if;
    v_hand := p_server->'hands'->v_me;
    if not (v_hand ? v_give) then raise exception 'not_in_hand'; end if;
    if not ((p_state->'center') ? v_take) then raise exception 'card_taken'; end if;
    v_hand := (select jsonb_agg(case when c = v_give then v_take else c end order by o) from jsonb_array_elements_text(v_hand) with ordinality t(c, o));
    p_state := p_state || jsonb_build_object(
      'center', (select jsonb_agg(case when c = v_take then v_give else c end order by o) from jsonb_array_elements_text(p_state->'center') with ordinality t(c, o)),
      'swaps', coalesce((p_state->>'swaps')::integer, 0) + 1,
      'feed', (jsonb_build_array(jsonb_build_object('n', coalesce((p_state->>'swaps')::integer, 0) + 1, 'by', v_me, 'took', v_take, 'gave', v_give))
               || (p_state->'feed')) - 6,
      'sweep', jsonb_build_object('votes', '[]'::jsonb, 'deadline', to_jsonb(now() + interval '10 seconds')),
      'hand_ver', (p_state->'hand_ver') || jsonb_build_object(v_me, coalesce((p_state->'hand_ver'->>v_me)::integer, 0) + 1));
    p_state := public._kems_playing_deadline(p_state);
    p_server := p_server || jsonb_build_object(
      'hands', (p_server->'hands') || jsonb_build_object(v_me, v_hand),
      'last_swap', coalesce(p_server->'last_swap', '{}'::jsonb) || jsonb_build_object(v_me, v_ms));
    -- carré réuni : compté une fois par manche
    if public._kems_square(v_hand) and (p_server->'sq_counted'->>v_me) is distinct from (p_state->>'round') then
      p_server := public._kems_bump(p_server, v_me, 'squares', 1);
      p_server := p_server || jsonb_build_object('sq_counted', (p_server->'sq_counted') || jsonb_build_object(v_me, (p_state->>'round')::integer));
    end if;
    return jsonb_build_object('state', p_state, 'server', p_server,
                              'secrets', jsonb_build_object(v_me, public._kems_secret(p_state, p_server, v_me)));

  -- ---------------------------------------------------------------- sweep (bascule du vote « Suivantes »)
  elsif v_type = 'sweep' then
    if v_phase <> 'playing' then return v_unchanged; end if;
    if v_team is null then raise exception 'not_in_match'; end if;
    v_votes := p_state->'sweep'->'votes';
    if v_votes ? v_me then
      v_votes := (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements_text(v_votes) x where x <> v_me);
    else
      v_votes := v_votes || to_jsonb(v_me);
    end if;
    p_state := p_state || jsonb_build_object('sweep', (p_state->'sweep') || jsonb_build_object('votes', v_votes));
    if jsonb_array_length(v_votes) >= v_n then return public._kems_sweep(p_state, p_server); end if;
    return jsonb_build_object('state', p_state, 'server', p_server);

  -- ---------------------------------------------------------------- kems : le PARTENAIRE du détenteur du carré
  elsif v_type = 'kems' then
    if v_phase <> 'playing' then return v_unchanged; end if;
    if v_team is null then raise exception 'not_in_match'; end if;
    v_tid := v_team->>'id';
    v_ok := public._kems_square(p_server->'hands'->v_partner);
    if v_ok then
      v_double := public._kems_square(p_server->'hands'->v_me);
      v_started := (p_server->>'round_started_at')::timestamptz;
      v_deltas := jsonb_build_object(v_tid, case when v_double then 2 else 1 end);
      p_state := public._kems_tbump(p_state, v_tid, 'kems', 1);
      for v_m in select jsonb_array_elements_text(v_team->'players') loop
        p_server := public._kems_bump(p_server, v_m, 'team_kems', 1);
        if v_double then p_server := public._kems_bump(p_server, v_m, 'double_kems', 1); end if;
        if extract(epoch from now() - v_started) < 20 then p_server := public._kems_bump(p_server, v_m, 'fast_kems', 1); end if;
      end loop;
    else
      v_double := false;
      v_deltas := (select coalesce(jsonb_object_agg(t->>'id', 1), '{}'::jsonb) from jsonb_array_elements(p_state->'teams') t where t->>'id' <> v_tid);
      p_state := public._kems_tbump(p_state, v_tid, 'errors', 1);
      p_server := public._kems_bump(p_server, v_me, 'false_kems', 1);
    end if;
    v_call := jsonb_build_object('type', 'kems', 'by', v_me, 'team', v_tid, 'target', null, 'ok', v_ok, 'double', v_double, 'deltas', v_deltas);
    return public._kems_end_round(p_state, p_server, v_call);

  -- ---------------------------------------------------------------- counter {team} : CONTRE-KEMS
  elsif v_type = 'counter' then
    if v_phase <> 'playing' then return v_unchanged; end if;
    if v_team is null then raise exception 'not_in_match'; end if;
    v_tid := v_team->>'id';
    v_others := array(select t->>'id' from jsonb_array_elements(p_state->'teams') t where t->>'id' <> v_tid);
    if p_action->>'team' is null or jsonb_typeof(p_action->'team') = 'null' then
      if array_length(v_others, 1) <> 1 then raise exception 'invalid_action'; end if;
      v_target := to_jsonb(v_others[1]);
    elsif (p_action->>'team') = any(v_others) then
      v_target := to_jsonb(p_action->>'team');
    else
      raise exception 'invalid_action';
    end if;
    select t into v_res from jsonb_array_elements(p_state->'teams') t where t->>'id' = (v_target #>> '{}');
    v_ok := exists (select 1 from jsonb_array_elements_text(v_res->'players') x where public._kems_square(p_server->'hands'->x));
    if v_ok then
      v_deltas := jsonb_build_object(v_tid, 1);
      p_state := public._kems_tbump(public._kems_tbump(p_state, v_tid, 'counters', 1), v_target #>> '{}', 'countered', 1);
      p_server := public._kems_bump(p_server, v_me, 'counters_ok', 1);
      for v_m in select jsonb_array_elements_text(v_res->'players') loop
        p_server := public._kems_bump(p_server, v_m, 'countered', 1);
      end loop;
    else
      v_deltas := (select coalesce(jsonb_object_agg(t->>'id', 1), '{}'::jsonb) from jsonb_array_elements(p_state->'teams') t where t->>'id' <> v_tid);
      p_state := public._kems_tbump(p_state, v_tid, 'errors', 1);
      p_server := public._kems_bump(p_server, v_me, 'false_counters', 1);
    end if;
    v_call := jsonb_build_object('type', 'counter', 'by', v_me, 'team', v_tid, 'target', v_target, 'ok', v_ok, 'double', false, 'deltas', v_deltas);
    return public._kems_end_round(p_state, p_server, v_call);

  -- ---------------------------------------------------------------- tick (idempotent)
  elsif v_type = 'tick' then
    if v_phase = 'signs' and now() >= (p_state->>'deadline')::timestamptz then
      return public._kems_deal(p_state, p_server, 1);
    elsif v_phase = 'playing' then
      if now() >= (p_state->>'round_deadline')::timestamptz then
        -- manche blanche : on redistribue sans point
        return public._kems_end_round(p_state, p_server, jsonb_build_object(
          'type', 'timeout', 'by', null, 'team', null, 'target', null, 'ok', false, 'double', false, 'deltas', '{}'::jsonb));
      elsif now() >= (p_state->'sweep'->>'deadline')::timestamptz then
        return public._kems_sweep(p_state, p_server);
      end if;
    elsif v_phase = 'reveal' and now() >= (p_state->>'deadline')::timestamptz then
      return public._kems_deal(p_state, p_server, (p_state->>'round')::integer + 1);
    end if;
    return v_unchanged;

  -- ---------------------------------------------------------------- next (hôte : passer la révélation)
  elsif v_type = 'next' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase <> 'reveal' then return v_unchanged; end if;
    return public._kems_deal(p_state, p_server, (p_state->>'round')::integer + 1);

  else
    raise exception 'unknown_action';
  end if;
end $$;

revoke all on function public._kems_shuffle(jsonb) from public, anon, authenticated;
revoke all on function public._kems_square(jsonb) from public, anon, authenticated;
revoke all on function public._kems_bump(jsonb, text, text, integer) from public, anon, authenticated;
revoke all on function public._kems_tbump(jsonb, text, text, integer) from public, anon, authenticated;
revoke all on function public._kems_secret(jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public._kems_playing_deadline(jsonb) from public, anon, authenticated;
revoke all on function public._kems_deal(jsonb, jsonb, integer) from public, anon, authenticated;
revoke all on function public._kems_sweep(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._kems_finish(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._kems_end_round(jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.game_kems_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;
revoke all on function public.game_kems_start(uuid[], jsonb) from public, anon, authenticated;
