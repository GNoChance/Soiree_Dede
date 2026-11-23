-- MORCEAU 5 / 6 — -- GÉNÉRÉ par scripts/build-sql.mjs — ne pas éditer. Idempotent. À exécuter dans l'ordre (1, puis 2…) dans Supabase > SQL Editor > Run.

-- ===== games\loup-garou.sql =====
-- =============================================================================
-- JEU « Loup-garou » (id loup-garou) — jeu de rôles caché multi-écrans
-- Idempotent (create or replace). Dispatché par start_match / game_action.
-- Contrat complet (state public, secrets, actions, choix de règles) :
--   src/games/loup-garou/types.ts
--
-- Rôles : loup, villageois, voyante, sorciere, cupidon, chasseur, protecteur.
-- Phases : roles -> night(step) -> reveal(dawn) -> [hunter -> reveal(hunter)]
--          -> day -> vote -> reveal(vote) -> [hunter…] -> night … -> finished
-- Étapes de nuit (ordre) : cupidon, amoureux (nuit 1 seulement) -> voyante ->
--   protecteur -> loups -> sorciere. Une étape existe si le rôle est dans la
--   composition (publique), qu'il soit vivant ou non : durée minimale + aléa
--   pour ne pas trahir qui est mort.
-- Rien de secret dans le state public : rôles, votes des loups, résultats de la
-- voyante, potions, amoureux et cible des loups vivent dans `server` + secrets.
-- =============================================================================

create or replace function public._lg_iso(p_ts timestamptz)
returns text language sql stable
set search_path = public, extensions
as $$
  select to_char(p_ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$$;

-- Composition suggérée selon le nombre de joueurs (miroir de suggestComposition
-- dans src/games/loup-garou/types.ts). Les villageois complètent.
create or replace function public._lg_suggest(p_n integer)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select (case
    when p_n <= 5 then '{"loup":1,"voyante":1,"sorciere":1,"chasseur":0,"cupidon":0,"protecteur":0}'
    when p_n = 6  then '{"loup":2,"voyante":1,"sorciere":1,"chasseur":1,"cupidon":0,"protecteur":0}'
    when p_n = 7  then '{"loup":2,"voyante":1,"sorciere":1,"chasseur":1,"cupidon":1,"protecteur":0}'
    when p_n = 8  then '{"loup":2,"voyante":1,"sorciere":1,"chasseur":1,"cupidon":1,"protecteur":1}'
    else               '{"loup":2,"voyante":1,"sorciere":1,"chasseur":1,"cupidon":1,"protecteur":1}'
  end)::jsonb;
$$;

-- Durées des étapes de nuit (secondes) : minimum (même si le rôle est mort) et maximum.
create or replace function public._lg_step_min(p_step text)
returns integer language sql immutable
set search_path = public, extensions
as $$
  select case p_step when 'cupidon' then 15 when 'amoureux' then 10 when 'voyante' then 12
                     when 'protecteur' then 10 when 'loups' then 18 when 'sorciere' then 12 else 10 end;
$$;

create or replace function public._lg_step_max(p_step text)
returns integer language sql immutable
set search_path = public, extensions
as $$
  select case p_step when 'cupidon' then 45 when 'amoureux' then 10 when 'voyante' then 40
                     when 'protecteur' then 35 when 'loups' then 75 when 'sorciere' then 45 else 30 end;
$$;

-- Joueurs vivants ayant le rôle p_role (ordre de `alive`).
create or replace function public._lg_alive_role(p_state jsonb, p_server jsonb, p_role text)
returns text[] language sql immutable
set search_path = public, extensions
as $$
  select coalesce(array_agg(a order by o), '{}'::text[])
    from jsonb_array_elements_text(p_state->'alive') with ordinality as t(a, o)
   where p_server->'roles'->>a = p_role;
$$;

-- Étapes de la nuit courante (state.night), selon la composition publique.
create or replace function public._lg_steps(p_state jsonb)
returns text[] language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v text[] := '{}';
  c jsonb  := p_state->'composition';
begin
  if coalesce((p_state->>'night')::integer, 1) = 1 and coalesce((c->>'cupidon')::integer, 0) > 0 then
    v := array_append(v, 'cupidon');
    v := array_append(v, 'amoureux');
  end if;
  if coalesce((c->>'voyante')::integer, 0) > 0 then v := array_append(v, 'voyante'); end if;
  if coalesce((c->>'protecteur')::integer, 0) > 0 then v := array_append(v, 'protecteur'); end if;
  v := array_append(v, 'loups');
  if coalesce((c->>'sorciere')::integer, 0) > 0 then v := array_append(v, 'sorciere'); end if;
  return v;
end $$;

-- Joueurs qui doivent agir pendant l'étape (vivants avec le rôle).
create or replace function public._lg_actors(p_state jsonb, p_server jsonb, p_step text)
returns text[] language plpgsql immutable
set search_path = public, extensions
as $$
begin
  return case p_step
    when 'cupidon'    then public._lg_alive_role(p_state, p_server, 'cupidon')
    when 'voyante'    then public._lg_alive_role(p_state, p_server, 'voyante')
    when 'protecteur' then public._lg_alive_role(p_state, p_server, 'protecteur')
    when 'loups'      then public._lg_alive_role(p_state, p_server, 'loup')
    when 'sorciere'   then case
      when coalesce((p_server->'potions'->>'life')::boolean, false)
        or coalesce((p_server->'potions'->>'death')::boolean, false)
      then public._lg_alive_role(p_state, p_server, 'sorciere') else '{}'::text[] end
    else '{}'::text[] end;
end $$;

create or replace function public._lg_pair(p_state jsonb, p_server jsonb)
returns jsonb language sql immutable
set search_path = public, extensions
as $$ select jsonb_build_object('state', p_state, 'server', p_server); $$;

-- Début d'une étape de nuit. Échéance : max si un acteur vivant doit agir,
-- sinon min + aléa (0-6 s) pour simuler une hésitation.
create or replace function public._lg_begin_step(p_state jsonb, p_server jsonb, p_step text)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_min    integer := public._lg_step_min(p_step);
  v_max    integer := public._lg_step_max(p_step);
  v_actors text[];
  v_secs   double precision;
begin
  p_server := p_server || jsonb_build_object('done', false);
  if p_step = 'loups' then p_server := p_server || jsonb_build_object('wolf_votes', '{}'::jsonb); end if;
  if p_step = 'amoureux' then p_server := p_server || jsonb_build_object('lovers_known', true); end if;
  v_actors := public._lg_actors(p_state, p_server, p_step);
  v_secs := case when p_step = 'amoureux' then v_max
                 when cardinality(v_actors) = 0 then v_min + random() * 6
                 else v_max end;
  p_state := p_state || jsonb_build_object(
    'phase', 'night', 'step', p_step,
    'step_started', public._lg_iso(now()), 'step_max', v_max,
    'deadline', public._lg_iso(now() + make_interval(secs => v_secs)));
  return public._lg_pair(p_state, p_server);
end $$;

-- L'acteur a fini : l'étape se termine au plus tôt à début + min (+ aléa 0-3 s).
create or replace function public._lg_mark_done(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_min_end timestamptz := (p_state->>'step_started')::timestamptz
                           + make_interval(secs => public._lg_step_min(p_state->>'step'));
begin
  p_server := p_server || jsonb_build_object('done', true);
  p_state := p_state || jsonb_build_object('deadline',
    public._lg_iso(greatest(now(), v_min_end) + make_interval(secs => random() * 3)));
  return public._lg_pair(p_state, p_server);
end $$;

create or replace function public._lg_cur(p_server jsonb, p_key text, p_val jsonb)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select p_server || jsonb_build_object('cur', coalesce(p_server->'cur', '{}'::jsonb) || jsonb_build_object(p_key, p_val));
$$;

-- Tue un joueur (si vivant) : rôle révélé, chasseur en attente, chagrin de l'amoureux.
create or replace function public._lg_kill(p_state jsonb, p_server jsonb, p_id text, p_cause text)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_role  text := p_server->'roles'->>p_id;
  v_entry jsonb;
  v_other text;
begin
  if p_id is null or not coalesce((p_state->'alive') ? p_id, false) then
    return public._lg_pair(p_state, p_server);
  end if;
  p_state := p_state || jsonb_build_object('alive',
    (select coalesce(jsonb_agg(a order by o), '[]'::jsonb)
       from jsonb_array_elements_text(p_state->'alive') with ordinality as t(a, o) where a <> p_id));
  v_entry := jsonb_build_object('id', p_id, 'role', v_role, 'cause', p_cause,
                                'night', coalesce((p_state->>'night')::integer, 0),
                                'when', coalesce(p_state->'reveal'->>'kind', 'dawn'));
  p_state := p_state || jsonb_build_object('dead', coalesce(p_state->'dead', '[]'::jsonb) || jsonb_build_array(v_entry));
  if jsonb_typeof(p_state->'reveal') = 'object' then
    p_state := jsonb_set(p_state, '{reveal,deaths}',
                         coalesce(p_state->'reveal'->'deaths', '[]'::jsonb) || jsonb_build_array(v_entry));
  end if;
  if v_role = 'chasseur' then
    p_state := p_state || jsonb_build_object('hunter_pending', p_id);
  end if;
  if coalesce(p_server->'lovers', '[]'::jsonb) ? p_id then
    select x into v_other from jsonb_array_elements_text(p_server->'lovers') x where x <> p_id limit 1;
    return public._lg_kill(p_state, p_server, v_other, 'chagrin');
  end if;
  return public._lg_pair(p_state, p_server);
end $$;

-- Camp d'un joueur : 'amoureux' (couple mixte loup + non-loup), 'loups' ou 'village'.
create or replace function public._lg_camp(p_server jsonb, p_id text)
returns text language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_l jsonb := coalesce(p_server->'lovers', '[]'::jsonb);
begin
  if jsonb_array_length(v_l) = 2 and v_l ? p_id
     and ((p_server->'roles'->>(v_l->>0)) = 'loup') <> ((p_server->'roles'->>(v_l->>1)) = 'loup') then
    return 'amoureux';
  end if;
  return case when p_server->'roles'->>p_id = 'loup' then 'loups' else 'village' end;
end $$;

-- Vainqueur ou null.
--  * amoureux mixtes vivants : gagnent s'ils sont les 2 derniers ; les loups
--    « purs » gagnent s'ils sont au moins aussi nombreux que les autres vivants.
--  * sinon : village si plus aucun loup vivant ; loups si loups >= autres vivants.
create or replace function public._lg_winner(p_state jsonb, p_server jsonb)
returns text language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_alive  text[] := array(select jsonb_array_elements_text(p_state->'alive'));
  v_n      integer := cardinality(v_alive);
  v_wolves integer := cardinality(public._lg_alive_role(p_state, p_server, 'loup'));
  v_l      jsonb := coalesce(p_server->'lovers', '[]'::jsonb);
  v_pure   integer;
begin
  if jsonb_array_length(v_l) = 2 and public._lg_camp(p_server, v_l->>0) = 'amoureux'
     and (v_l->>0) = any(v_alive) and (v_l->>1) = any(v_alive) then
    if v_n = 2 then return 'amoureux'; end if;
    v_pure := v_wolves - 1;
    if v_pure > 0 and v_pure >= v_n - v_pure then return 'loups'; end if;
    return null;
  end if;
  if v_wolves = 0 then return 'village'; end if;
  if v_wolves >= v_n - v_wolves then return 'loups'; end if;
  return null;
end $$;

-- Stats de fin de partie pour les trophées (features/trophees.sql), lues dans dead / history / nights.
create or replace function public._lg_tstats(p_state jsonb, p_server jsonb, p_pl text, p_winner text)
returns jsonb language plpgsql stable
set search_path = public, extensions
as $$
declare
  v_roles   jsonb := coalesce(p_server->'roles', '{}'::jsonb);
  v_role    text := v_roles->>p_pl;
  v_won     boolean := public._lg_camp(p_server, p_pl) = p_winner;
  v_alive   boolean := coalesce((p_state->'alive') ? p_pl, false);
  v_hist    jsonb := coalesce(p_state->'history', '[]'::jsonb);
  v_recv    integer;
  v_wvotes  integer;
  v_powers  integer := 0;
  v_wolves_alive integer;
  v_wolves_start integer;
begin
  -- votes du village contre moi / votes que j'ai donnés à un loup (révélations de vote)
  select count(*) filter (where v.value = p_pl),
         count(*) filter (where v.key = p_pl and v_roles->>v.value = 'loup')
    into v_recv, v_wvotes
    from jsonb_array_elements(v_hist) h, jsonb_each_text(coalesce(h->'votes', '{}'::jsonb)) v
   where h->>'kind' = 'vote';

  -- pouvoirs réussis
  if v_role = 'voyante' then
    select count(*) into v_powers from jsonb_array_elements(coalesce(p_server->'nights', '[]'::jsonb)) n
     where n->>'seer' is not null and v_roles->>(n->>'seer') = 'loup';
  elsif v_role = 'sorciere' then
    select count(*) into v_powers from jsonb_array_elements(coalesce(p_server->'nights', '[]'::jsonb)) n
     where n->>'saved' is not null;
  elsif v_role = 'protecteur' then
    select count(*) into v_powers from jsonb_array_elements(coalesce(p_server->'nights', '[]'::jsonb)) n
     where n->>'protect' is not null and n->>'protect' = n->>'wolves';
  elsif v_role = 'chasseur' then
    select count(*) into v_powers from jsonb_array_elements(v_hist) h
     where h->>'kind' = 'hunter' and h->>'hunter' = p_pl and h->>'target' is not null
       and v_roles->>(h->>'target') = 'loup';
  end if;

  select count(*) filter (where v.value = 'loup' and (p_state->'alive') ? v.key),
         count(*) filter (where v.value = 'loup')
    into v_wolves_alive, v_wolves_start
    from jsonb_each_text(v_roles) v;

  return jsonb_build_object(
    'first_night_death', case when exists (select 1 from jsonb_array_elements(coalesce(p_state->'dead', '[]'::jsonb)) d
        where d->>'id' = p_pl and d->>'cause' = 'night' and (d->>'night')::integer = 1) then 1 else 0 end,
    'lynched_innocent', case when v_role <> 'loup' and exists (select 1 from jsonb_array_elements(coalesce(p_state->'dead', '[]'::jsonb)) d
        where d->>'id' = p_pl and d->>'cause' = 'vote') then 1 else 0 end,
    'died', case when v_alive then 0 else 1 end,
    'survived', case when v_alive then 1 else 0 end,
    'wolf_votes', v_wvotes,
    'won_village', case when v_won and public._lg_camp(p_server, p_pl) = 'village' then 1 else 0 end,
    'won_wolf', case when v_won and v_role = 'loup' then 1 else 0 end,
    'powers', v_powers,
    'simple_win', case when v_won and v_role = 'villageois' and v_alive then 1 else 0 end,
    'lamb', case when v_won and v_role = 'loup' and v_recv = 0 then 1 else 0 end,
    'lone_wolf', case when v_won and v_role = 'loup' and v_alive and v_wolves_alive = 1 and v_wolves_start >= 2 then 1 else 0 end);
end $$;

-- Fin de partie : rôles, amoureux et chronique des nuits rendus publics.
create or replace function public._lg_finish(p_state jsonb, p_server jsonb, p_winner text)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_results jsonb := '[]'::jsonb;
  p         text;
  v_won     boolean;
  v_alive   boolean;
begin
  for p in select jsonb_array_elements_text(p_state->'players') loop
    v_won := public._lg_camp(p_server, p) = p_winner;
    v_alive := (p_state->'alive') ? p;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'profile_id', p, 'won', v_won,
      'points', case when v_won and v_alive then 3 when v_won then 2 else 0 end,
      'placement', case when v_won then 1 else 2 end,
      'stats', public._lg_tstats(p_state, p_server, p, p_winner)));
  end loop;
  p_state := p_state || jsonb_build_object(
    'phase', 'finished', 'winner', p_winner, 'step', null, 'deadline', null, 'hunter', null,
    'roles', p_server->'roles', 'lovers', coalesce(p_server->'lovers', '[]'::jsonb),
    'chronicle', coalesce(p_server->'nights', '[]'::jsonb), 'results', v_results);
  return public._lg_pair(p_state, p_server);
end $$;

create or replace function public._lg_begin_night(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
begin
  p_state := p_state || jsonb_build_object(
    'night', coalesce((p_state->>'night')::integer, 0) + 1,
    'reveal', null, 'votes', '{}'::jsonb, 'candidates', '[]'::jsonb, 'revote', false, 'first_vote', null);
  p_server := p_server || jsonb_build_object(
    'cur', jsonb_build_object('night', (p_state->>'night')::integer),
    'victim', null, 'protected', null, 'saved', false, 'poison', null);
  return public._lg_begin_step(p_state, p_server, (public._lg_steps(p_state))[1]);
end $$;

-- Fin de la nuit : morts (victime des loups sauf protégée/sauvée, empoisonné).
create or replace function public._lg_resolve_night(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_victim text := p_server->>'victim';
  v_r      jsonb;
  v_n      integer;
  v_cur    jsonb;
begin
  p_state := p_state || jsonb_build_object(
    'phase', 'reveal', 'step', null, 'after', 'day',
    'reveal', jsonb_build_object('kind', 'dawn', 'night', (p_state->>'night')::integer, 'deaths', '[]'::jsonb));
  if v_victim is not null and v_victim is distinct from p_server->>'protected'
     and not coalesce((p_server->>'saved')::boolean, false) then
    v_r := public._lg_kill(p_state, p_server, v_victim, 'night');
    p_state := v_r->'state'; p_server := v_r->'server';
  end if;
  if p_server->>'poison' is not null then
    v_r := public._lg_kill(p_state, p_server, p_server->>'poison', 'night');
    p_state := v_r->'state'; p_server := v_r->'server';
  end if;
  v_cur := coalesce(p_server->'cur', '{}'::jsonb) || jsonb_build_object(
    'night', (p_state->>'night')::integer,
    'deaths', (select coalesce(jsonb_agg(d->'id'), '[]'::jsonb) from jsonb_array_elements(p_state->'reveal'->'deaths') d));
  p_server := p_server || jsonb_build_object(
    'nights', coalesce(p_server->'nights', '[]'::jsonb) || jsonb_build_array(v_cur),
    'cur', null, 'last_protected', p_server->'protected', 'protected', null,
    'victim', null, 'saved', false, 'poison', null, 'wolf_votes', '{}'::jsonb, 'done', false);
  v_n := jsonb_array_length(p_state->'reveal'->'deaths');
  p_state := p_state || jsonb_build_object('deadline', public._lg_iso(now() + make_interval(secs => 10 + 4 * v_n)));
  return public._lg_pair(p_state, p_server);
end $$;

-- Fin d'une étape de nuit (échéance) : choix par défaut puis étape suivante.
create or replace function public._lg_end_step(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_step   text := p_state->>'step';
  v_steps  text[] := public._lg_steps(p_state);
  v_idx    integer;
  v_wolves text[];
  v_target text;
begin
  if v_step = 'loups' then
    v_wolves := public._lg_alive_role(p_state, p_server, 'loup');
    -- Majorité des loups vivants ; égalité -> tirage parmi les ex-aequo ; aucun vote -> personne.
    select t into v_target from (
      select value as t, count(*) as c
        from jsonb_each_text(coalesce(p_server->'wolf_votes', '{}'::jsonb))
       where key = any(v_wolves) and (p_state->'alive') ? value
       group by value) x
     order by c desc, random() limit 1;
    p_server := p_server || jsonb_build_object('victim', v_target);
    p_server := public._lg_cur(p_server, 'wolves', to_jsonb(v_target));
  end if;
  v_idx := array_position(v_steps, v_step);
  if v_idx is not null and v_idx < cardinality(v_steps) then
    return public._lg_begin_step(p_state, p_server, v_steps[v_idx + 1]);
  end if;
  return public._lg_resolve_night(p_state, p_server);
end $$;

create or replace function public._lg_begin_vote(p_state jsonb, p_server jsonb, p_candidates jsonb, p_revote boolean)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
begin
  p_state := p_state || jsonb_build_object(
    'phase', 'vote', 'votes', '{}'::jsonb, 'candidates', p_candidates, 'revote', p_revote,
    'deadline', public._lg_iso(now() + interval '75 seconds'));
  return public._lg_pair(p_state, p_server);
end $$;

-- Dépouillement : majorité relative ; 1re égalité -> revote entre ex-aequo ;
-- 2e égalité -> personne n'est éliminé ; aucun vote -> personne.
create or replace function public._lg_tally(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_counts  jsonb;
  v_max     integer;
  v_tied    jsonb;
  v_elim    text;
  v_outcome text;
  v_r       jsonb;
begin
  select coalesce(jsonb_object_agg(t, c), '{}'::jsonb), max(c) into v_counts, v_max from (
    select value as t, count(*)::integer as c
      from jsonb_each_text(coalesce(p_state->'votes', '{}'::jsonb))
     where (p_state->'alive') ? key and (p_state->'alive') ? value
     group by value) x;
  select coalesce(jsonb_agg(key order by key), '[]'::jsonb) into v_tied
    from jsonb_each_text(v_counts) where value::integer = v_max;

  if v_max is null then
    v_outcome := 'none';
  elsif jsonb_array_length(v_tied) = 1 then
    v_outcome := 'majority';
    v_elim := v_tied->>0;
  elsif not coalesce((p_state->>'revote')::boolean, false) then
    p_state := p_state || jsonb_build_object('first_vote',
      jsonb_build_object('votes', p_state->'votes', 'counts', v_counts, 'tied', v_tied));
    return public._lg_begin_vote(p_state, p_server, v_tied, true);
  else
    v_outcome := 'tie';
  end if;

  p_state := p_state || jsonb_build_object(
    'phase', 'reveal', 'after', 'night',
    'reveal', jsonb_build_object('kind', 'vote', 'night', (p_state->>'night')::integer,
                                 'votes', p_state->'votes', 'counts', v_counts, 'tied', v_tied,
                                 'outcome', v_outcome, 'eliminated', v_elim,
                                 'revote', coalesce((p_state->>'revote')::boolean, false),
                                 'deaths', '[]'::jsonb));
  if v_elim is not null then
    v_r := public._lg_kill(p_state, p_server, v_elim, 'vote');
    p_state := v_r->'state'; p_server := v_r->'server';
  end if;
  p_state := p_state || jsonb_build_object('deadline', public._lg_iso(now() + make_interval(
    secs => 10 + 4 * jsonb_array_length(p_state->'reveal'->'deaths'))));
  return public._lg_pair(p_state, p_server);
end $$;

-- Tir du chasseur (p_target null = pas de tir).
create or replace function public._lg_hunter_done(p_state jsonb, p_server jsonb, p_target text)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_r jsonb;
begin
  p_state := p_state || jsonb_build_object(
    'phase', 'reveal',
    'reveal', jsonb_build_object('kind', 'hunter', 'night', (p_state->>'night')::integer,
                                 'hunter', p_state->'hunter', 'target', p_target, 'deaths', '[]'::jsonb),
    'hunter', null);
  if p_target is not null then
    v_r := public._lg_kill(p_state, p_server, p_target, 'chasseur');
    p_state := v_r->'state'; p_server := v_r->'server';
  end if;
  p_state := p_state || jsonb_build_object('deadline', public._lg_iso(now() + make_interval(
    secs => 8 + 4 * jsonb_array_length(p_state->'reveal'->'deaths'))));
  return public._lg_pair(p_state, p_server);
end $$;

-- Après une révélation : chasseur en attente, sinon victoire, sinon jour / nuit.
create or replace function public._lg_after_reveal(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_w text;
begin
  if jsonb_typeof(p_state->'reveal') = 'object' then
    p_state := p_state || jsonb_build_object('history',
      coalesce(p_state->'history', '[]'::jsonb) || jsonb_build_array(p_state->'reveal'));
  end if;
  if p_state->>'hunter_pending' is not null then
    p_state := p_state || jsonb_build_object(
      'phase', 'hunter', 'hunter', p_state->'hunter_pending', 'hunter_pending', null,
      'deadline', public._lg_iso(now() + interval '40 seconds'));
    return public._lg_pair(p_state, p_server);
  end if;
  v_w := public._lg_winner(p_state, p_server);
  if v_w is not null then
    return public._lg_finish(p_state, p_server, v_w);
  end if;
  if p_state->>'after' = 'day' then
    p_state := p_state || jsonb_build_object(
      'phase', 'day', 'reveal', null, 'votes', '{}'::jsonb, 'candidates', '[]'::jsonb, 'revote', false,
      'first_vote', null,
      'deadline', public._lg_iso(now() + make_interval(secs => coalesce((p_state->>'debate_seconds')::integer, 180))));
    return public._lg_pair(p_state, p_server);
  end if;
  return public._lg_begin_night(p_state, p_server);
end $$;

-- Secrets de tous les joueurs (+ meneur non joueur), recalculés à chaque action.
create or replace function public._lg_secrets(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_out    jsonb := '{}'::jsonb;
  p        text;
  r        text;
  s        jsonb;
  v_step   text := case when p_state->>'phase' = 'night' then p_state->>'step' end;
  v_actors text[] := case when p_state->>'phase' = 'night'
                          then public._lg_actors(p_state, p_server, p_state->>'step') else '{}'::text[] end;
  v_known  boolean := coalesce((p_server->>'lovers_known')::boolean, false);
  v_lovers jsonb := coalesce(p_server->'lovers', '[]'::jsonb);
  v_wolves jsonb;
  v_other  text;
begin
  select coalesce(jsonb_agg(a order by o), '[]'::jsonb) into v_wolves
    from jsonb_array_elements_text(p_state->'players') with ordinality as t(a, o)
   where p_server->'roles'->>a = 'loup';
  for p in select jsonb_array_elements_text(p_state->'players') loop
    r := p_server->'roles'->>p;
    s := jsonb_build_object('role', r, 'night', coalesce((p_state->>'night')::integer, 0),
                            'step', v_step, 'acting', p = any(v_actors),
                            'done', p = any(v_actors) and coalesce((p_server->>'done')::boolean, false));
    if r = 'loup' then
      s := s || jsonb_build_object('wolves', v_wolves,
        'wolf_votes', case when v_step = 'loups' then coalesce(p_server->'wolf_votes', '{}'::jsonb) else '{}'::jsonb end);
    elsif r = 'voyante' then
      s := s || jsonb_build_object('seer', coalesce(p_server->'seer', '[]'::jsonb));
    elsif r = 'sorciere' then
      s := s || jsonb_build_object('potions', p_server->'potions',
        'victim', case when v_step = 'sorciere' then p_server->'victim' else 'null'::jsonb end);
    elsif r = 'protecteur' then
      s := s || jsonb_build_object('last_protected', coalesce(p_server->'last_protected', 'null'::jsonb));
    end if;
    if v_known and v_lovers ? p then
      select x into v_other from jsonb_array_elements_text(v_lovers) x where x <> p limit 1;
      s := s || jsonb_build_object('lover', jsonb_build_object(
        'id', v_other, 'role', p_server->'roles'->>v_other,
        'mixed', public._lg_camp(p_server, p) = 'amoureux'));
    end if;
    v_out := v_out || jsonb_build_object(p, s);
  end loop;
  if p_state->>'narrator' is not null then
    v_out := v_out || jsonb_build_object(p_state->>'narrator', jsonb_build_object(
      'narrator', true, 'roles', p_server->'roles', 'step', v_step,
      'lovers', case when v_known then v_lovers else '[]'::jsonb end));
  end if;
  return v_out;
end $$;

create or replace function public._lg_out(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
begin
  if p_state->>'phase' = 'finished' then
    return jsonb_build_object('state', p_state, 'server', p_server,
                              'secrets', public._lg_secrets(p_state, p_server), 'results', p_state->'results');
  end if;
  return jsonb_build_object('state', p_state, 'server', p_server, 'secrets', public._lg_secrets(p_state, p_server));
end $$;

-- -----------------------------------------------------------------------------
-- Démarrage
-- Options : {"composition": {"loup":2,"voyante":1,"sorciere":1,"chasseur":1,
--            "cupidon":1,"protecteur":1}, "debate_seconds": 180, "host_plays": true}
-- Composition absente -> suggestion automatique. host_plays=false : l'hôte (appelant
-- de start_match) est retiré des joueurs et devient meneur (secret : tous les rôles).
-- -----------------------------------------------------------------------------
create or replace function public.game_loup_garou_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  v_opts    jsonb := coalesce(p_options, '{}'::jsonb);
  v_host    text := public.current_profile_id()::text;
  v_players text[] := array(select x::text from unnest(p_players) x);
  v_narr    text;
  v_n       integer;
  v_comp    jsonb;
  v_l       integer;
  v_sum     integer;
  v_k       text;
  v_v       integer;
  v_deck    text[] := '{}';
  v_roles   jsonb := '{}'::jsonb;
  v_debate  integer := coalesce((v_opts->>'debate_seconds')::integer, 180);
  v_state   jsonb;
  v_server  jsonb;
  i         integer;
begin
  if v_host is not null and coalesce((v_opts->>'host_plays')::boolean, true) = false then
    v_players := array_remove(v_players, v_host);
  end if;
  if v_host is not null and not (v_host = any(v_players)) then v_narr := v_host; end if;
  v_n := cardinality(v_players);
  if v_n < 5 then raise exception 'not_enough_players'; end if;
  if v_n > 9 then raise exception 'too_many_players'; end if;

  v_comp := case when jsonb_typeof(v_opts->'composition') = 'object' then v_opts->'composition'
                 else public._lg_suggest(v_n) end;
  begin
    v_l := coalesce((v_comp->>'loup')::integer, 0);
    v_sum := v_l;
    foreach v_k in array array['voyante', 'sorciere', 'chasseur', 'cupidon', 'protecteur'] loop
      v_v := coalesce((v_comp->>v_k)::integer, 0);
      if v_v not in (0, 1) then raise exception 'invalid_composition'; end if;
      v_sum := v_sum + v_v;
      if v_v = 1 then v_deck := array_append(v_deck, v_k); end if;
    end loop;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'invalid_composition';
  end;
  if v_l < 1 or v_l * 2 >= v_n or v_sum > v_n then raise exception 'invalid_composition'; end if;
  for i in 1 .. v_l loop v_deck := array_append(v_deck, 'loup'); end loop;
  for i in 1 .. v_n - v_sum loop v_deck := array_append(v_deck, 'villageois'); end loop;

  select jsonb_object_agg(p, r) into v_roles
    from (select p, row_number() over () as k from unnest(v_players) as p) a
    join (select r, row_number() over () as k from (select r from unnest(v_deck) as r order by random()) z) b
      using (k);

  if v_debate < 30 or v_debate > 900 then v_debate := 180; end if;

  v_state := jsonb_build_object(
    'game', 'loup-garou', 'phase', 'roles',
    'players', to_jsonb(v_players), 'alive', to_jsonb(v_players), 'narrator', v_narr,
    'composition', jsonb_build_object(
      'loup', v_l, 'villageois', v_n - v_sum,
      'voyante', coalesce((v_comp->>'voyante')::integer, 0),
      'sorciere', coalesce((v_comp->>'sorciere')::integer, 0),
      'chasseur', coalesce((v_comp->>'chasseur')::integer, 0),
      'cupidon', coalesce((v_comp->>'cupidon')::integer, 0),
      'protecteur', coalesce((v_comp->>'protecteur')::integer, 0)),
    'debate_seconds', v_debate,
    'night', 0, 'step', null, 'step_started', null, 'step_max', null,
    'deadline', public._lg_iso(now() + interval '120 seconds'),
    'votes', '{}'::jsonb, 'candidates', '[]'::jsonb, 'revote', false, 'first_vote', null,
    'reveal', null, 'after', null, 'hunter', null, 'hunter_pending', null,
    'dead', '[]'::jsonb, 'history', '[]'::jsonb,
    'winner', null, 'roles', null, 'lovers', null, 'chronicle', null, 'results', null);
  v_server := jsonb_build_object(
    'roles', v_roles, 'lovers', '[]'::jsonb, 'lovers_known', false,
    'potions', jsonb_build_object('life', true, 'death', true),
    'seer', '[]'::jsonb, 'wolf_votes', '{}'::jsonb, 'done', false,
    'victim', null, 'protected', null, 'last_protected', null, 'saved', false, 'poison', null,
    'cur', null, 'nights', '[]'::jsonb);
  return jsonb_build_object('state', v_state, 'server', v_server,
                            'secrets', public._lg_secrets(v_state, v_server));
end $$;

-- -----------------------------------------------------------------------------
-- Actions
--   {"type":"tick"}                       tous : échéance dépassée -> suite (sinon inchangé)
--   {"type":"next"}                       hôte : roles -> nuit 1 ; reveal -> suite
--   {"type":"night_action", ...}          acteur de l'étape de nuit :
--       cupidon    {"targets":[a,b]}
--       voyante    {"target":x}
--       protecteur {"target":x}             (pas le même que la nuit précédente)
--       loups      {"target":x|null}        (vote modifiable, visible des autres loups)
--       sorciere   {"save":bool,"target":x|null}  (ou "potion":"life"|"death"|"none")
--   {"type":"end_debate"}                 hôte : jour -> vote
--   {"type":"day_vote","target":x}        vivant : vote public, modifiable
--   {"type":"close_vote"}                 hôte : dépouille maintenant
--   {"type":"hunter_shot","target":x|null}  chasseur mort
-- -----------------------------------------------------------------------------
create or replace function public.game_loup_garou_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  v_type   text := p_action->>'type';
  v_me     text := p_actor::text;
  v_phase  text := p_state->>'phase';
  v_step   text := p_state->>'step';
  v_target text := nullif(p_action->>'target', '');
  v_alive  boolean := coalesce((p_state->'alive') ? v_me, false);
  v_player boolean := coalesce((p_state->'players') ? v_me, false);
  v_r      jsonb;
  v_a      text;
  v_b      text;
  v_save   boolean;
  v_wolves text[];
  v_n      integer;
  v_pot    text;
begin
  if v_phase not in ('roles', 'night', 'reveal', 'hunter', 'day', 'vote') then
    raise exception 'wrong_phase';
  end if;

  -- ------------------------------------------------------------------ tick
  if v_type = 'tick' then
    if p_state->>'deadline' is null or now() < (p_state->>'deadline')::timestamptz then
      return jsonb_build_object('state', p_state, 'server', p_server);
    end if;
    v_r := case v_phase
      when 'roles'  then public._lg_begin_night(p_state, p_server)
      when 'night'  then public._lg_end_step(p_state, p_server)
      when 'reveal' then public._lg_after_reveal(p_state, p_server)
      when 'hunter' then public._lg_hunter_done(p_state, p_server, null)
      when 'day'    then public._lg_begin_vote(p_state, p_server, p_state->'alive', false)
      when 'vote'   then public._lg_tally(p_state, p_server)
    end;
    return public._lg_out(v_r->'state', v_r->'server');
  end if;

  -- ------------------------------------------------------------------ hôte
  if v_type in ('next', 'end_debate', 'close_vote') then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_type = 'next' and v_phase = 'roles' then
      v_r := public._lg_begin_night(p_state, p_server);
    elsif v_type = 'next' and v_phase = 'reveal' then
      v_r := public._lg_after_reveal(p_state, p_server);
    elsif v_type = 'end_debate' and v_phase = 'day' then
      v_r := public._lg_begin_vote(p_state, p_server, p_state->'alive', false);
    elsif v_type = 'close_vote' and v_phase = 'vote' then
      v_r := public._lg_tally(p_state, p_server);
    else
      raise exception 'wrong_phase';
    end if;
    return public._lg_out(v_r->'state', v_r->'server');
  end if;

  if v_type not in ('night_action', 'day_vote', 'hunter_shot') then raise exception 'unknown_action'; end if;
  if not v_player then raise exception 'not_a_player'; end if;

  -- ------------------------------------------------------------------ chasseur
  if v_type = 'hunter_shot' then
    if v_phase <> 'hunter' then raise exception 'wrong_phase'; end if;
    if p_state->>'hunter' is distinct from v_me then raise exception 'not_your_turn'; end if;
    if v_target is not null and (v_target = v_me or not ((p_state->'alive') ? v_target)) then
      raise exception 'invalid_target';
    end if;
    v_r := public._lg_hunter_done(p_state, p_server, v_target);
    return public._lg_out(v_r->'state', v_r->'server');
  end if;

  if not v_alive then raise exception 'not_alive'; end if;

  -- ------------------------------------------------------------------ vote du jour
  if v_type = 'day_vote' then
    if v_phase <> 'vote' then raise exception 'wrong_phase'; end if;
    if v_target is null or not ((p_state->'candidates') ? v_target) or not ((p_state->'alive') ? v_target) then
      raise exception 'invalid_target';
    end if;
    if v_target = v_me then raise exception 'cannot_vote_self'; end if;
    p_state := jsonb_set(p_state, array['votes', v_me], to_jsonb(v_target), true);
    select count(*) into v_n from jsonb_object_keys(p_state->'votes') k where (p_state->'alive') ? k;
    if v_n >= jsonb_array_length(p_state->'alive') then
      v_r := public._lg_tally(p_state, p_server);
      return public._lg_out(v_r->'state', v_r->'server');
    end if;
    return public._lg_out(p_state, p_server);
  end if;

  -- ------------------------------------------------------------------ actions de nuit
  if v_phase <> 'night' then raise exception 'wrong_phase'; end if;
  if not (v_me = any(public._lg_actors(p_state, p_server, v_step))) then raise exception 'not_your_turn'; end if;
  if v_step <> 'loups' and coalesce((p_server->>'done')::boolean, false) then raise exception 'already_acted'; end if;

  if v_step = 'cupidon' then
    v_a := p_action->'targets'->>0;
    v_b := p_action->'targets'->>1;
    if jsonb_typeof(p_action->'targets') <> 'array' or jsonb_array_length(p_action->'targets') <> 2
       or v_a is null or v_b is null or v_a = v_b
       or not ((p_state->'alive') ? v_a) or not ((p_state->'alive') ? v_b) then
      raise exception 'invalid_target';
    end if;
    p_server := p_server || jsonb_build_object('lovers', jsonb_build_array(v_a, v_b));
    p_server := public._lg_cur(p_server, 'lovers', jsonb_build_array(v_a, v_b));
    v_r := public._lg_mark_done(p_state, p_server);

  elsif v_step = 'voyante' then
    if v_target is null or v_target = v_me or not ((p_state->'alive') ? v_target) then
      raise exception 'invalid_target';
    end if;
    p_server := p_server || jsonb_build_object('seer', coalesce(p_server->'seer', '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object('night', (p_state->>'night')::integer, 'target', v_target,
                         'role', p_server->'roles'->>v_target)));
    p_server := public._lg_cur(p_server, 'seer', to_jsonb(v_target));
    v_r := public._lg_mark_done(p_state, p_server);

  elsif v_step = 'protecteur' then
    if v_target is null or not ((p_state->'alive') ? v_target)
       or v_target is not distinct from p_server->>'last_protected' then
      raise exception 'invalid_target';
    end if;
    p_server := p_server || jsonb_build_object('protected', v_target);
    p_server := public._lg_cur(p_server, 'protect', to_jsonb(v_target));
    v_r := public._lg_mark_done(p_state, p_server);

  elsif v_step = 'loups' then
    if v_target is not null and (not ((p_state->'alive') ? v_target) or p_server->'roles'->>v_target = 'loup') then
      raise exception 'invalid_target';
    end if;
    if v_target is null then
      p_server := p_server || jsonb_build_object('wolf_votes', coalesce(p_server->'wolf_votes', '{}'::jsonb) - v_me);
    else
      p_server := p_server || jsonb_build_object('wolf_votes',
        coalesce(p_server->'wolf_votes', '{}'::jsonb) || jsonb_build_object(v_me, v_target));
    end if;
    v_wolves := public._lg_alive_role(p_state, p_server, 'loup');
    if (select count(*) from unnest(v_wolves) w where p_server->'wolf_votes' ? w) = cardinality(v_wolves)
       and (select count(distinct p_server->'wolf_votes'->>w) from unnest(v_wolves) w) = 1 then
      -- Unanimité : l'étape se termine (après le minimum).
      v_r := public._lg_mark_done(p_state, p_server);
    elsif coalesce((p_server->>'done')::boolean, false) then
      -- Un loup change d'avis : l'unanimité est rompue, retour à l'échéance max.
      p_server := p_server || jsonb_build_object('done', false);
      p_state := p_state || jsonb_build_object('deadline', public._lg_iso(greatest(
        (p_state->>'step_started')::timestamptz + make_interval(secs => public._lg_step_max('loups')),
        now() + interval '5 seconds')));
      v_r := public._lg_pair(p_state, p_server);
    else
      v_r := public._lg_pair(p_state, p_server);
    end if;

  elsif v_step = 'sorciere' then
    v_pot := p_action->>'potion';
    v_save := coalesce((p_action->>'save')::boolean, false) or v_pot in ('life', 'both');
    if v_pot = 'none' or v_pot = 'life' then v_target := null; end if;
    if v_save then
      if not coalesce((p_server->'potions'->>'life')::boolean, false) then raise exception 'no_potion'; end if;
      if p_server->>'victim' is null then raise exception 'invalid_target'; end if;
    end if;
    if v_target is not null then
      if not coalesce((p_server->'potions'->>'death')::boolean, false) then raise exception 'no_potion'; end if;
      if v_target = v_me or not ((p_state->'alive') ? v_target) then raise exception 'invalid_target'; end if;
    end if;
    if v_save then
      p_server := p_server || jsonb_build_object('saved', true,
        'potions', p_server->'potions' || '{"life":false}'::jsonb);
      p_server := public._lg_cur(p_server, 'saved', to_jsonb(p_server->>'victim'));
    end if;
    if v_target is not null then
      p_server := p_server || jsonb_build_object('poison', v_target,
        'potions', p_server->'potions' || '{"death":false}'::jsonb);
      p_server := public._lg_cur(p_server, 'poison', to_jsonb(v_target));
    end if;
    v_r := public._lg_mark_done(p_state, p_server);

  else
    raise exception 'wrong_phase';
  end if;

  return public._lg_out(v_r->'state', v_r->'server');
end $$;

revoke all on function public._lg_iso(timestamptz) from public, anon, authenticated;
revoke all on function public._lg_suggest(integer) from public, anon, authenticated;
revoke all on function public._lg_step_min(text) from public, anon, authenticated;
revoke all on function public._lg_step_max(text) from public, anon, authenticated;
revoke all on function public._lg_alive_role(jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public._lg_steps(jsonb) from public, anon, authenticated;
revoke all on function public._lg_actors(jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public._lg_pair(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._lg_begin_step(jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public._lg_mark_done(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._lg_cur(jsonb, text, jsonb) from public, anon, authenticated;
revoke all on function public._lg_kill(jsonb, jsonb, text, text) from public, anon, authenticated;
revoke all on function public._lg_camp(jsonb, text) from public, anon, authenticated;
revoke all on function public._lg_winner(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._lg_finish(jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public._lg_tstats(jsonb, jsonb, text, text) from public, anon, authenticated;
revoke all on function public._lg_begin_night(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._lg_resolve_night(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._lg_end_step(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._lg_begin_vote(jsonb, jsonb, jsonb, boolean) from public, anon, authenticated;
revoke all on function public._lg_tally(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._lg_hunter_done(jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public._lg_after_reveal(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._lg_secrets(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._lg_out(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.game_loup_garou_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_loup_garou_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;


-- ===== games\menteur.sql =====
-- =============================================================================
-- JEU « Menteur » (id menteur) — dés de bluff (famille des « dés menteurs »)
-- Idempotent (create or replace). Dispatché par start_match / game_action.
--
-- Chaque joueur a 5 dés cachés (match_secrets). À chaque manche tout le monde
-- relance (tirage serveur random()). À tour de rôle : monter l'enchère
-- « N dés de valeur V » sur l'ensemble des dés de la table, ou crier « Menteur ! »
-- (ou « Pile ! » si la variante est active). Le perdant de la vérification perd
-- un dé ; à 0 dé on est éliminé ; le dernier joueur avec des dés gagne.
--
-- RÈGLES DES 1 (« Paco ») — les 1 sont JOKERS : ils comptent pour toutes les
-- valeurs, sauf quand l'enchère porte justement sur les 1.
--   * enchère normale -> normale : quantité supérieure, ou même quantité et
--     valeur supérieure ;
--   * normale (q, v) -> Paco : quantité >= ceil(q / 2) ;
--   * Paco (q) -> Paco : quantité > q ;
--   * Paco (q) -> normale : quantité >= 2q + 1 ;
--   * l'enchère d'OUVERTURE d'une manche ne peut pas porter sur les 1 ;
--   * une quantité ne peut jamais dépasser le nombre total de dés en jeu.
--   (Pas de manche « palifico » : variante non retenue.)
--
-- « Menteur ! » (joueur dont c'est le tour, une enchère existe) : on compte les
-- dés de la valeur annoncée + les 1 (sauf enchère Paco). Total >= quantité ->
-- celui qui a crié perd un dé ; sinon l'enchérisseur perd un dé. Le perdant
-- commence la manche suivante (s'il est éliminé : le joueur vivant suivant).
-- « Pile ! » (option, défaut off ; joueur dont c'est le tour) : total exactement
-- égal -> le crieur regagne un dé (plafonné à 5, sinon rien) ; sinon il en perd
-- un. Le crieur commence la manche suivante (ou le vivant suivant s'il est sorti).
--
-- MINUTEUR (deadline + {"type":"tick"}) :
--   * phase bidding : à l'échéance, enchère minimale automatique pour le joueur
--     dont c'est le tour = même valeur, quantité + 1 ; en ouverture : 1 dé de la
--     valeur (hors 1) la plus fréquente dans SES dés (égalité -> la plus haute).
--     Si cette enchère dépasse le nombre de dés en jeu -> « Menteur ! » automatique.
--   * phase reveal : à l'échéance, manche suivante (ou fin de partie si c'était
--     la dernière vérification). L'hôte peut accélérer avec {"type":"next"}.
--
-- server : {"dice": {"<uid>": [1..6, ...]}}  (dés de la manche en cours)
-- secret d'un joueur : {"round": n, "dice": [..]}  ([] une fois éliminé)
-- Contrat complet (state public, actions) : src/games/menteur/types.ts.
-- =============================================================================

create or replace function public._mtr_iso(p_ts timestamptz)
returns text language sql stable
set search_path = public, extensions
as $$
  select to_char(p_ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$$;

-- p_n dés tirés au sort.
create or replace function public._mtr_roll(p_n integer)
returns jsonb language sql volatile
set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(1 + floor(random() * 6)::integer), '[]'::jsonb)
    from generate_series(1, greatest(p_n, 0));
$$;

-- Joueur vivant suivant p_from dans l'ordre de la table (p_from peut être éliminé).
create or replace function public._mtr_next(p_state jsonb, p_from text)
returns text language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_order text[] := array(select jsonb_array_elements_text(p_state->'order'));
  v_n     integer := cardinality(v_order);
  v_cur   integer := coalesce(array_position(v_order, p_from), 1);
  i       integer;
begin
  for i in 1 .. v_n loop
    v_cur := v_cur % v_n + 1;
    if (p_state->'alive') ? v_order[v_cur] then return v_order[v_cur]; end if;
  end loop;
  return null;
end $$;

-- L'enchère (p_q, p_f) est-elle valide après p_bid (null = ouverture) ?
create or replace function public._mtr_valid(p_q integer, p_f integer, p_bid jsonb, p_total integer)
returns boolean language plpgsql immutable
set search_path = public, extensions
as $$
declare
  cq integer;
  cf integer;
begin
  if p_q is null or p_f is null or p_f < 1 or p_f > 6 or p_q < 1 or p_q > p_total then return false; end if;
  if p_bid is null or jsonb_typeof(p_bid) <> 'object' then
    return p_f <> 1;  -- ouverture : pas sur les Paco
  end if;
  cq := (p_bid->>'qty')::integer;
  cf := (p_bid->>'face')::integer;
  if cf = 1 then
    if p_f = 1 then return p_q > cq; end if;
    return p_q >= 2 * cq + 1;
  end if;
  if p_f = 1 then return p_q >= ceil(cq / 2.0)::integer; end if;
  return p_q > cq or (p_q = cq and p_f > cf);
end $$;

-- Nouvelle manche : tout le monde relance. Renvoie {state, server, secrets}.
create or replace function public._mtr_new_round(p_state jsonb, p_server jsonb, p_starter text, p_grace integer)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_round   integer := coalesce((p_state->>'round')::integer, 0) + 1;
  v_dice    jsonb := '{}'::jsonb;
  v_secrets jsonb := '{}'::jsonb;
  v_total   integer := 0;
  v_d       jsonb;
  p         text;
begin
  for p in select jsonb_array_elements_text(p_state->'players') loop
    if (p_state->'alive') ? p then
      v_d := public._mtr_roll((p_state->'dice_count'->>p)::integer);
      v_dice := v_dice || jsonb_build_object(p, v_d);
      v_total := v_total + jsonb_array_length(v_d);
    else
      v_d := '[]'::jsonb;
    end if;
    v_secrets := v_secrets || jsonb_build_object(p, jsonb_build_object('round', v_round, 'dice', v_d));
  end loop;
  p_server := p_server || jsonb_build_object('dice', v_dice);
  p_state := p_state || jsonb_build_object(
    'phase', 'bidding',
    'round', v_round,
    'starter', p_starter,
    'turn', p_starter,
    'turn_seq', coalesce((p_state->>'turn_seq')::integer, 0) + 1,
    'bid', null,
    'bids', '[]'::jsonb,
    'total_dice', v_total,
    'reveal', null,
    'deadline', public._mtr_iso(now() + make_interval(secs => case
      when coalesce((p_state->'absent'->>p_starter)::boolean, false) then 8   -- absent auto : tour express
      else (p_state->>'turn_seconds')::integer + p_grace end)));
  return jsonb_build_object('state', p_state, 'server', p_server, 'secrets', v_secrets);
end $$;

-- Stats de fin de partie pour les trophées (features/trophees.sql) : rejoue history[] (qui perd / gagne un dé).
create or replace function public._mtr_tstats(p_state jsonb, p_pl text, p_winner text)
returns jsonb language plpgsql stable
set search_path = public, extensions
as $$
declare
  v_n       integer := jsonb_array_length(p_state->'players');
  v_dice    jsonb := (select jsonb_object_agg(x, 5) from jsonb_array_elements_text(p_state->'players') x);
  v_alive   integer := v_n;
  v_comeback boolean := false;
  v_lost    boolean := false;
  v_false_liar integer := 0; v_caught integer := 0; v_good_liar integer := 0;
  v_exact integer := 0; v_big integer := 0; v_pile integer := 0; v_pure integer := 0;
  h         jsonb;
begin
  for h in select value from jsonb_array_elements(coalesce(p_state->'history', '[]'::jsonb)) loop
    if h->>'kind' = 'liar' then
      if h->>'caller' = p_pl and h->>'loser' = p_pl then v_false_liar := v_false_liar + 1; end if;
      if h->'bid'->>'by' = p_pl and h->>'loser' = p_pl then v_caught := v_caught + 1; end if;
      if h->>'caller' = p_pl and h->>'loser' is not null and h->>'loser' <> p_pl then v_good_liar := v_good_liar + 1; end if;
      if h->'bid'->>'by' = p_pl and (h->>'count')::integer = (h->'bid'->>'qty')::integer then v_exact := v_exact + 1; end if;
      if h->'bid'->>'by' = p_pl and coalesce((h->>'pure')::boolean, false) then v_pure := v_pure + 1; end if;
      if h->'bid'->>'by' = p_pl and (h->'bid'->>'qty')::integer >= 8
         and (h->>'count')::integer >= (h->'bid'->>'qty')::integer then v_big := v_big + 1; end if;
    elsif h->>'kind' = 'pile' and h->>'caller' = p_pl and h->>'loser' is null then
      v_pile := v_pile + 1;
    end if;
    if h->>'loser' is not null then
      v_dice := jsonb_set(v_dice, array[h->>'loser'], to_jsonb((v_dice->>(h->>'loser'))::integer - 1));
      if h->>'loser' = p_pl then v_lost := true; end if;
      if h->>'eliminated' is not null then v_alive := v_alive - 1; end if;
      -- tombé à un seul dé alors qu'il restait 3 joueurs ou plus
      if h->>'loser' = p_pl and (v_dice->>p_pl)::integer = 1 and v_alive >= 3 then v_comeback := true; end if;
    end if;
    if h->>'gainer' is not null then
      v_dice := jsonb_set(v_dice, array[h->>'gainer'], to_jsonb((v_dice->>(h->>'gainer'))::integer + 1));
    end if;
  end loop;
  return jsonb_build_object(
    'first_out', case when p_state->'eliminated'->>0 = p_pl then 1 else 0 end,
    'false_liar', v_false_liar, 'caught', v_caught, 'good_liar', v_good_liar,
    'last_die_win', case when p_winner = p_pl and (p_state->'dice_count'->>p_pl)::integer = 1 then 1 else 0 end,
    'pile_ok', v_pile, 'exact_bids', v_exact, 'pure_bluffs', v_pure, 'big_bid', v_big,
    'comeback', case when p_winner = p_pl and v_comeback then 1 else 0 end,
    'captain', case when p_winner = p_pl and not v_lost and v_n >= 3 then 1 else 0 end);
end $$;

-- Fin de partie : vainqueur = dernier vivant, puis ordre d'élimination inverse.
create or replace function public._mtr_finish(p_state jsonb)
returns jsonb language plpgsql stable
set search_path = public, extensions
as $$
declare
  v_n       integer := jsonb_array_length(p_state->'players');
  v_ranked  text[] := array(select jsonb_array_elements_text(p_state->'alive'))
                      || array(select e from jsonb_array_elements_text(p_state->'eliminated') with ordinality as t(e, o)
                                order by o desc);
  v_results jsonb := '[]'::jsonb;
  i         integer;
begin
  for i in 1 .. cardinality(v_ranked) loop
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'profile_id', v_ranked[i],
      'placement', i,
      'points', v_n - i,
      'won', i = 1,
      'stats', public._mtr_tstats(p_state, v_ranked[i], v_ranked[1])));
  end loop;
  return p_state || jsonb_build_object(
    'phase', 'finished',
    'deadline', null,
    'turn', null,
    'winner', v_ranked[1],
    'results', v_results);
end $$;

-- Vérification (« Menteur ! » ou « Pile ! ») -> phase reveal.
create or replace function public._mtr_resolve(p_state jsonb, p_server jsonb, p_caller text, p_kind text, p_auto boolean)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_bid     jsonb := p_state->'bid';
  v_q       integer := (v_bid->>'qty')::integer;
  v_f       integer := (v_bid->>'face')::integer;
  v_by      text := v_bid->>'by';
  v_count   integer;
  v_loser   text := null;
  v_gainer  text := null;
  v_elim    text := null;
  v_next    text;
  v_n       integer;
  v_secs    numeric;
  v_entry   jsonb;
  v_pure    boolean;
begin
  select count(*)::integer into v_count
    from jsonb_each(coalesce(p_server->'dice', '{}'::jsonb)) as t(k, v),
         jsonb_array_elements_text(v) as d(x)
   where x::integer = v_f or (v_f <> 1 and x::integer = 1);

  if p_kind = 'liar' then
    v_loser := case when v_count >= v_q then p_caller else v_by end;
  elsif v_count = v_q then
    if (p_state->'dice_count'->>p_caller)::integer < 5 then v_gainer := p_caller; end if;
  else
    v_loser := p_caller;
  end if;

  -- Coup de bluff : enchère contestée (« Menteur ! »), vraie, alors que l'enchérisseur n'avait aucun dé de
  -- cette valeur ni joker. Calculé ici et stocké dans l'historique (les dés sont révélés de toute façon).
  v_pure := p_kind = 'liar' and v_count >= v_q
            and not exists (select 1 from jsonb_array_elements_text(coalesce(p_server->'dice'->v_by, '[]'::jsonb)) d(x)
                             where x::integer = v_f or (v_f <> 1 and x::integer = 1));

  if v_loser is not null then
    v_n := (p_state->'dice_count'->>v_loser)::integer - 1;
    p_state := jsonb_set(p_state, array['dice_count', v_loser], to_jsonb(v_n));
    if v_n <= 0 then
      v_elim := v_loser;
      p_state := p_state || jsonb_build_object('alive', (p_state->'alive') - v_loser,
                                               'eliminated', (p_state->'eliminated') || to_jsonb(v_loser));
    end if;
  end if;
  if v_gainer is not null then
    p_state := jsonb_set(p_state, array['dice_count', v_gainer],
                         to_jsonb((p_state->'dice_count'->>v_gainer)::integer + 1));
  end if;

  -- Qui commence la manche suivante : le perdant (Menteur) / le crieur (Pile).
  v_next := case when p_kind = 'liar' then v_loser else p_caller end;
  if not ((p_state->'alive') ? v_next) then v_next := public._mtr_next(p_state, v_next); end if;

  -- Durée de la révélation (le front illumine les dés comptés un par un, 0,4 s chacun).
  v_secs := least(20, 7 + 0.4 * v_count);
  v_entry := jsonb_build_object(
    'round', p_state->'round',
    'kind', p_kind,
    'caller', p_caller,
    'auto', p_auto,
    'bid', v_bid,
    'dice', coalesce(p_server->'dice', '{}'::jsonb),
    'count', v_count,
    'exact', v_count = v_q,
    'loser', v_loser,
    'gainer', v_gainer,
    'eliminated', v_elim,
    'next_starter', v_next,
    'final', jsonb_array_length(p_state->'alive') <= 1);

  return p_state || jsonb_build_object(
    'phase', 'reveal',
    'turn', null,
    'reveal', v_entry,
    'history', coalesce(p_state->'history', '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object('round', p_state->'round', 'kind', p_kind, 'caller', p_caller, 'bid', v_bid,
                         'count', v_count, 'loser', v_loser, 'gainer', v_gainer, 'eliminated', v_elim,
                         'pure', v_pure)),
    'deadline', public._mtr_iso(now() + make_interval(secs => v_secs::double precision)));
end $$;

-- -----------------------------------------------------------------------------
-- Démarrage. Options : {"turn_seconds": 30|45|60 (défaut 45), "pile": bool (défaut false)}
-- -----------------------------------------------------------------------------
create or replace function public.game_menteur_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_n      integer := cardinality(p_players);
  v_secs   integer := case when coalesce(p_options->>'turn_seconds', '') in ('30', '45', '60')
                           then (p_options->>'turn_seconds')::integer else 45 end;
  v_pile   boolean := coalesce(p_options->>'pile', 'false') = 'true';
  v_order  text[];
  v_counts jsonb := '{}'::jsonb;
  v_state  jsonb;
  v_r      jsonb;
  p        text;
begin
  if v_n < 2 then raise exception 'not_enough_players'; end if;
  if v_n > 9 then raise exception 'too_many_players'; end if;
  v_order := array(select x::text from unnest(p_players) as t(x) order by random());
  foreach p in array v_order loop
    v_counts := v_counts || jsonb_build_object(p, 5);
  end loop;

  v_state := jsonb_build_object(
    'game', 'menteur',
    'phase', 'bidding',
    'players', to_jsonb(p_players),
    'order', to_jsonb(v_order),
    'alive', to_jsonb(v_order),
    'eliminated', '[]'::jsonb,
    'dice_count', v_counts,
    'total_dice', 5 * v_n,
    'round', 0,
    'starter', null,
    'turn', null,
    'turn_seq', 0,
    'turn_seconds', v_secs,
    'pile_enabled', v_pile,
    'bid', null,
    'bids', '[]'::jsonb,
    'reveal', null,
    'history', '[]'::jsonb,
    'deadline', null,
    'winner', null,
    'results', null);
  -- 10 s de grâce au premier tour (le temps que tout le monde arrive et secoue).
  v_r := public._mtr_new_round(v_state, '{}'::jsonb, v_order[1], 10);
  return v_r;
end $$;

-- -----------------------------------------------------------------------------
-- Actions :
--   {"type":"bid","qty":n,"face":1..6}   {"type":"liar"}   {"type":"pile"}
--   {"type":"next"} (hôte, phase reveal)   {"type":"tick"}
-- -----------------------------------------------------------------------------
create or replace function public.game_menteur_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_type    text := p_action->>'type';
  v_me      text := p_actor::text;
  v_turn    text := p_state->>'turn';
  v_phase   text := p_state->>'phase';
  v_total   integer := coalesce((p_state->>'total_dice')::integer, 0);
  v_bid     jsonb := p_state->'bid';
  v_q       integer;
  v_f       integer;
  v_auto    boolean := false;
  v_kind    text;
  v_r       jsonb;
  v_secrets jsonb := null;
  v_bids    jsonb;
begin
  if v_phase not in ('bidding', 'reveal') then
    if v_type = 'tick' then return jsonb_build_object('state', p_state, 'server', p_server); end if;
    raise exception 'wrong_phase';
  end if;
  if jsonb_typeof(v_bid) <> 'object' then v_bid := null; end if;

  -- ---------------------------------------------------------------- tick
  if v_type = 'tick' then
    if p_state->>'deadline' is null or now() < (p_state->>'deadline')::timestamptz then
      return jsonb_build_object('state', p_state, 'server', p_server);  -- trop tôt / déjà traité
    end if;
    if v_phase = 'reveal' then
      v_type := 'advance';
    else
      v_auto := true;
      v_me := v_turn;
      if v_bid is null then
        -- Ouverture : 1 dé de la valeur (hors 1) la plus fréquente dans mes dés.
        select x::integer into v_f
          from jsonb_array_elements_text(coalesce(p_server->'dice'->v_turn, '[]'::jsonb)) as d(x)
         where x::integer <> 1
         group by x order by count(*) desc, x::integer desc limit 1;
        v_q := 1;
        v_f := coalesce(v_f, 6);
        v_type := 'bid';
      else
        v_q := (v_bid->>'qty')::integer + 1;
        v_f := (v_bid->>'face')::integer;
        v_type := case when v_q <= v_total then 'bid' else 'liar' end;
      end if;
    end if;
  elsif v_type = 'next' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase <> 'reveal' then raise exception 'wrong_phase'; end if;
    v_type := 'advance';
  elsif v_type in ('bid', 'liar', 'pile') then
    if not ((p_state->'players') ? v_me) then raise exception 'not_a_player'; end if;
    if not ((p_state->'alive') ? v_me) then raise exception 'not_alive'; end if;
    if v_phase <> 'bidding' then raise exception 'wrong_phase'; end if;
    if v_turn is distinct from v_me then raise exception 'not_your_turn'; end if;
    if v_type = 'bid' then
      if jsonb_typeof(p_action->'qty') <> 'number' or jsonb_typeof(p_action->'face') <> 'number' then
        raise exception 'invalid_bid';
      end if;
      v_q := floor((p_action->>'qty')::numeric)::integer;
      v_f := floor((p_action->>'face')::numeric)::integer;
      if v_q::numeric <> (p_action->>'qty')::numeric or v_f::numeric <> (p_action->>'face')::numeric
         or v_f < 1 or v_f > 6 or v_q < 1 or v_q > v_total then
        raise exception 'invalid_bid';
      end if;
      if v_bid is null and v_f = 1 then raise exception 'paco_opening'; end if;
    else
      if v_bid is null then raise exception 'no_bid_yet'; end if;
      if v_type = 'pile' and not coalesce((p_state->>'pile_enabled')::boolean, false) then
        raise exception 'pile_disabled';
      end if;
    end if;
  else
    raise exception 'unknown_action';
  end if;

  -- Absent auto : 2 tours consécutifs joués par tick -> tours express ; une action du joueur le fait revenir.
  if v_auto then
    p_state := p_state || jsonb_build_object('idle', coalesce(p_state->'idle', '{}'::jsonb)
      || jsonb_build_object(v_me, coalesce((p_state->'idle'->>v_me)::integer, 0) + 1));
    if (p_state->'idle'->>v_me)::integer >= 2 and not coalesce((p_state->'absent'->>v_me)::boolean, false) then
      p_state := p_state || jsonb_build_object('absent', coalesce(p_state->'absent', '{}'::jsonb)
        || jsonb_build_object(v_me, true));
    end if;
  elsif v_type in ('bid', 'liar', 'pile') then
    if p_state->'idle' ? v_me then
      p_state := p_state || jsonb_build_object('idle', (p_state->'idle') - v_me);
    end if;
    if coalesce((p_state->'absent'->>v_me)::boolean, false) then
      p_state := p_state || jsonb_build_object('absent', (p_state->'absent') - v_me,
                                               'returned', v_me, 'returned_seq', coalesce((p_state->>'turn_seq')::integer, 0));
    end if;
  end if;

  -- ---------------------------------------------------------------- application
  if v_type = 'bid' then
    if not public._mtr_valid(v_q, v_f, v_bid, v_total) then raise exception 'bid_too_low'; end if;
    v_bids := coalesce(p_state->'bids', '[]'::jsonb);
    select coalesce(jsonb_agg(e order by o), '[]'::jsonb) into v_bids
      from jsonb_array_elements(v_bids) with ordinality as t(e, o)
     where o > jsonb_array_length(v_bids) - 29;
    v_bid := jsonb_build_object('qty', v_q, 'face', v_f, 'by', v_me, 'auto', v_auto);
    p_state := p_state || jsonb_build_object(
      'bid', v_bid,
      'bids', v_bids || jsonb_build_array(v_bid),
      'turn', public._mtr_next(p_state, v_me),
      'turn_seq', coalesce((p_state->>'turn_seq')::integer, 0) + 1,
      'deadline', public._mtr_iso(now() + make_interval(secs => case
        when coalesce((p_state->'absent'->>public._mtr_next(p_state, v_me))::boolean, false) then 8
        else (p_state->>'turn_seconds')::integer end)));

  elsif v_type in ('liar', 'pile') then
    p_state := public._mtr_resolve(p_state, p_server, v_me, v_type, v_auto);

  elsif v_type = 'advance' then
    if coalesce((p_state->'reveal'->>'final')::boolean, false) then
      p_state := public._mtr_finish(p_state);
    else
      v_r := public._mtr_new_round(p_state, p_server, p_state->'reveal'->>'next_starter', 6);
      p_state := v_r->'state';
      p_server := v_r->'server';
      v_secrets := v_r->'secrets';
    end if;
  end if;

  if p_state->>'phase' = 'finished' then
    return jsonb_build_object('state', p_state, 'server', p_server, 'results', p_state->'results');
  end if;
  if v_secrets is not null then
    return jsonb_build_object('state', p_state, 'server', p_server, 'secrets', v_secrets);
  end if;
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

revoke all on function public._mtr_iso(timestamptz) from public, anon, authenticated;
revoke all on function public._mtr_roll(integer) from public, anon, authenticated;
revoke all on function public._mtr_next(jsonb, text) from public, anon, authenticated;
revoke all on function public._mtr_valid(integer, integer, jsonb, integer) from public, anon, authenticated;
revoke all on function public._mtr_new_round(jsonb, jsonb, text, integer) from public, anon, authenticated;
revoke all on function public._mtr_finish(jsonb) from public, anon, authenticated;
revoke all on function public._mtr_tstats(jsonb, text, text) from public, anon, authenticated;
revoke all on function public._mtr_resolve(jsonb, jsonb, text, text, boolean) from public, anon, authenticated;
revoke all on function public.game_menteur_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_menteur_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;


-- ===== games\mini-golf.sql =====
-- =============================================================================
-- JEU « mini-golf » (Mini-golf 3D, 20 trous de kermesse + 9 trous « Défi ») — idempotent.
-- Dépend de schema.sql (game_action, start_match, finish_match).
-- Conception : docs/superpowers/specs/2026-11-19-mini-golf-design.md.
--
-- Tout le monde joue LE MÊME TROU en même temps, chacun sa balle sur son téléphone
-- (physique 3D côté client, positions diffusées en broadcast `golf:<matchId>`, jamais
-- en base). Le serveur ne reçoit qu'UNE écriture par joueur et par trou :
--   {"type":"hole","hole":h,"strokes":n,"holed":true|false,"stats":{water,mill_hits,bank_shot}}
-- h = index (0-based) du trou dans state.holes. Rentrée : 1 ≤ n ≤ cap (6, ou par + 2) ; non rentrée
-- (cap coups joués) : score cap + 1. Temps minimum (anti-triche minimal) : (n − balles à l'eau) × 1,5 s depuis
-- hole_started_at (fin de l'annonce du trou). Doublon : ignoré sans erreur.
--
-- Parcours (option course) : « kermesse » = trous 1..9 dans l'ordre ; « random » (défaut) = 9 trous tirés au
-- sort parmi les 20 premiers ; « express » = 5 trous tirés au sort parmi les 20 ; « defi » = trous 21..29 dans
-- l'ordre (longs trous, pars 4 à 6 : jamais tirés au sort).
-- Coups max sur un trou : _mg_cap(par) = max(6, par + 2) ; balle non rentrée : _mg_picked(par) = cap + 1
-- (7 sur un par 2 à 4, 8 sur un par 5, 9 sur un par 6). Tirage côté serveur, trié par par croissant
-- (ordre aléatoire entre trous de même par) : on commence par les plus faciles, on finit sur un par 4.
--
-- Phases : playing (trou h, chrono `timer` s, 0 = sans chrono) -> hole_end (6 s, classement
-- provisoire) -> playing (trou h+1) ... ; au dernier trou : finished directement.
-- Trou terminé : tous ont fini, échéance du chrono (absents = 7), ou `next` de l'hôte.
-- =============================================================================

-- Les 29 trous : par de chaque trou (pars[id - 1]), parcours « La Kermesse du village » (1..9), « Défi » (21..29),
-- et pool = les ids 1..pool sont tirés au sort (aléatoire, express).
-- Dupliqué avec src/games/mini-golf/holes.ts (synchro vérifiée par tools/sql-tests/mini-golf.mjs).
create or replace function public._mg_course()
returns jsonb language sql immutable
set search_path = public, extensions
as $$ select '{"pars":[2,2,3,3,3,3,3,3,4,3,3,3,2,3,4,3,3,3,3,3,4,4,6,4,4,4,4,4,5],"kermesse":[1,2,3,4,5,6,7,8,9],"defi":[21,22,23,24,25,26,27,28,29],"pool":20}'::jsonb $$;

-- Ancienne constante (score 7 partout), remplacée par _mg_picked(par).
drop function if exists public._mg_max_score();

-- Coups max sur un trou de par p_par (dupliqué : maxStrokes() de holes.ts).
create or replace function public._mg_cap(p_par integer)
returns integer language sql immutable
set search_path = public, extensions
as $$ select greatest(6, coalesce(p_par, 3) + 2) $$;

-- Score d'un trou non rentré (balle ramassée, chrono écoulé, fin forcée) : coups max + 1 (pickedUp() de holes.ts).
create or replace function public._mg_picked(p_par integer)
returns integer language sql immutable
set search_path = public, extensions
as $$ select public._mg_cap(p_par) + 1 $$;

-- Ouvre le trou n° p_idx (index dans state.holes) : 3 s d'annonce puis chrono.
create or replace function public._mg_open_hole(p_state jsonb, p_idx integer)
returns jsonb language plpgsql
set search_path = public, extensions
as $$
declare
  v_timer integer := coalesce((p_state->>'timer')::integer, 0);
  v_start timestamptz := now() + interval '3 seconds';
begin
  return p_state || jsonb_build_object(
    'phase', 'playing',
    'hole', p_idx,
    'round', p_idx + 1,
    'hole_started_at', v_start,
    'deadline', case when v_timer > 0 then to_jsonb(v_start + make_interval(secs => v_timer)) else 'null'::jsonb end,
    'done', '[]'::jsonb);
end $$;

-- Ajoute un compteur de trophée (server.tstats[joueur][clé] += delta).
create or replace function public._mg_bump(p_server jsonb, p_pid text, p_key text, p_delta integer)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select jsonb_set(coalesce(p_server, '{}'::jsonb), array['tstats', p_pid],
    coalesce(p_server->'tstats'->p_pid, '{}'::jsonb)
      || jsonb_build_object(p_key, coalesce((p_server->'tstats'->p_pid->>p_key)::integer, 0) + p_delta), true)
$$;

-- Inscrit le score p_score du joueur p_pid au trou courant (carte, total, fini).
create or replace function public._mg_record(p_state jsonb, p_pid text, p_score integer)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_card jsonb := coalesce(p_state->'cards'->p_pid, '[]'::jsonb);
  v_h    integer := (p_state->>'hole')::integer;
begin
  -- La carte d'un joueur a exactement `hole` cases avant l'écriture (trous précédents tous clos).
  while jsonb_array_length(v_card) < v_h loop
    v_card := v_card || to_jsonb(public._mg_picked((p_state->'pars'->>jsonb_array_length(v_card))::integer));
  end loop;
  v_card := (select coalesce(jsonb_agg(e order by i), '[]'::jsonb)
               from jsonb_array_elements(v_card) with ordinality t(e, i) where i <= v_h)
            || to_jsonb(p_score);
  p_state := jsonb_set(p_state, array['cards', p_pid], v_card, true);
  p_state := jsonb_set(p_state, array['totals', p_pid],
                       to_jsonb((select coalesce(sum(x::integer), 0) from jsonb_array_elements_text(v_card) x)), true);
  if not ((p_state->'done') ? p_pid) then
    p_state := jsonb_set(p_state, '{done}', (p_state->'done') || to_jsonb(p_pid));
  end if;
  return p_state;
end $$;

-- Stats de fin de partie pour les trophées (features/trophees.sql) : calculées depuis la carte
-- (pars, birdies, aces, under_par, clean_card) + compteurs client bornés (server.tstats).
create or replace function public._mg_tstats(p_state jsonb, p_server jsonb, p_pid text)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_card  jsonb := coalesce(p_state->'cards'->p_pid, '[]'::jsonb);
  v_pars  jsonb := p_state->'pars';
  v_n     integer := jsonb_array_length(p_state->'holes');
  v_ts    jsonb := coalesce(p_server->'tstats'->p_pid, '{}'::jsonb);
  i       integer;
  v_sc    integer;
  v_par   integer;
  v_inpar integer := 0;
  v_birds integer := 0;
  v_aces  integer := 0;
  v_tot   integer := 0;
  v_ptot  integer := 0;
  v_clean boolean := true;
  v_full  boolean := jsonb_array_length(v_card) = v_n;
begin
  for i in 0 .. v_n - 1 loop
    v_par := (v_pars->>i)::integer;
    v_ptot := v_ptot + v_par;
    v_sc := (v_card->>i)::integer;
    if v_sc is null then v_clean := false; continue; end if;
    v_tot := v_tot + v_sc;
    if v_sc <= v_par then v_inpar := v_inpar + 1; else v_clean := false; end if;
    if v_sc < v_par then v_birds := v_birds + 1; end if;
    if v_sc = 1 then v_aces := v_aces + 1; end if;
  end loop;
  return jsonb_build_object(
    'total', v_tot,
    'holes', v_n,
    'pars', v_inpar,
    'birdies', v_birds,
    'aces', v_aces,
    'picked_up', coalesce((v_ts->>'picked_up')::integer, 0),
    'water', coalesce((v_ts->>'water')::integer, 0),
    'mill_hits', coalesce((v_ts->>'mill_hits')::integer, 0),
    'bank_shot', least(1, coalesce((v_ts->>'bank_shot')::integer, 0)),
    'under_par', case when v_n = 9 and v_full and v_tot < v_ptot then 1 else 0 end,
    'clean_card', case when v_n = 9 and v_full and v_clean then 1 else 0 end);
end $$;

-- Fin de partie : classement (plus petit total), points = n − rang + 1, gagnant(s) = rang 1.
create or replace function public._mg_finish(p_state jsonb, p_server jsonb, p_forced boolean)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_n       integer := jsonb_array_length(p_state->'players');
  v_results jsonb;
  v_winners jsonb;
begin
  with t as (
    select x as pid, coalesce((p_state->'totals'->>x)::integer, 0) as total
      from jsonb_array_elements_text(p_state->'players') x
  ), r as (
    select t.*, rank() over (order by total) as rk from t
  )
  select jsonb_agg(jsonb_build_object(
           'profile_id', pid, 'points', v_n - rk + 1, 'won', rk = 1, 'placement', rk,
           'stats', public._mg_tstats(p_state, p_server, pid))
         order by rk, pid),
         coalesce(jsonb_agg(pid order by pid) filter (where rk = 1), '[]'::jsonb)
    into v_results, v_winners
    from r;
  p_state := p_state || jsonb_build_object('phase', 'finished', 'deadline', null, 'forced', p_forced,
                                           'winners', v_winners, 'results', v_results);
  return jsonb_build_object('state', p_state, 'server', p_server, 'results', v_results);
end $$;

-- Clôt le trou courant : absents = 7 ; dernier trou -> fin de partie, sinon classement 6 s.
create or replace function public._mg_close_hole(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  pl text;
begin
  for pl in select x from jsonb_array_elements_text(p_state->'players') x loop
    if not ((p_state->'done') ? pl) then
      p_state := public._mg_record(p_state, pl, public._mg_picked((p_state->'pars'->>((p_state->>'hole')::integer))::integer));
    end if;
  end loop;
  if (p_state->>'hole')::integer >= jsonb_array_length(p_state->'holes') - 1 then
    return public._mg_finish(p_state, p_server, false);
  end if;
  p_state := p_state || jsonb_build_object('phase', 'hole_end', 'deadline', now() + interval '6 seconds');
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Options : {"course": "random"|"kermesse"|"express"|"defi", "timer": 60|90|0 secondes par trou (0 = sans chrono)}.
-- Anciennes options (sans course) : {"holes": 9} = kermesse, {"holes": 5} = express ; sinon aléatoire 9 trous.
create or replace function public.game_mini_golf_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_course jsonb := public._mg_course();
  v_mode   text;
  v_count  integer;
  v_timer  integer;
  v_holes  jsonb;
  v_pars   jsonb;
  v_empty  jsonb;
  v_zero   jsonb;
  v_state  jsonb;
begin
  -- 2 joueurs minimum : en solo, la victoire serait automatique (tenue Golfeur « farmable »).
  if coalesce(cardinality(p_players), 0) < 2 then raise exception 'not_enough_players'; end if;
  if cardinality(p_players) > 9 then raise exception 'too_many_players'; end if;

  v_mode := case when p_options->>'course' in ('random', 'kermesse', 'express', 'defi') then p_options->>'course'
                 when p_options->'course' is null and p_options->>'holes' = '9' then 'kermesse'
                 when p_options->'course' is null and p_options->>'holes' = '5' then 'express'
                 else 'random' end;
  v_timer := case when coalesce(p_options->>'timer', '') ~ '^\d{1,3}$' then (p_options->>'timer')::integer else 90 end;
  if v_timer not in (0, 60, 90) then v_timer := 90; end if;

  if v_mode in ('kermesse', 'defi') then
    v_holes := v_course->v_mode;
  else
    -- Tirage sans remise parmi les ids 1..pool (20), puis tri par par croissant (hasard entre pars égaux).
    v_count := case when v_mode = 'express' then 5 else 9 end;
    select jsonb_agg(d.id order by d.par, random()) into v_holes
      from (select o::integer as id, p::integer as par
              from jsonb_array_elements_text(v_course->'pars') with ordinality t(p, o)
             where o <= (v_course->>'pool')::integer
             order by random() limit v_count) d;
  end if;
  select jsonb_agg(v_course->'pars'->((h::integer) - 1) order by o) into v_pars
    from jsonb_array_elements_text(v_holes) with ordinality t(h, o);
  select jsonb_object_agg(p::text, '[]'::jsonb), jsonb_object_agg(p::text, 0) into v_empty, v_zero from unnest(p_players) p;

  v_state := jsonb_build_object(
    'game', 'mini-golf',
    'players', to_jsonb(p_players),
    'course', v_mode,
    'holes', v_holes,
    'pars', v_pars,
    'total_rounds', jsonb_array_length(v_holes),
    'timer', v_timer,
    'cards', v_empty,
    'totals', v_zero,
    'last_hole', null,
    'forced', false,
    'winners', null,
    'results', null);
  v_state := public._mg_open_hole(v_state, 0);

  return jsonb_build_object('state', v_state, 'server', jsonb_build_object('tstats', '{}'::jsonb), 'secrets', '{}'::jsonb);
end $$;

create or replace function public.game_mini_golf_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_type    text := p_action->>'type';
  v_phase   text := p_state->>'phase';
  v_me      text := p_actor::text;
  v_hole    integer := (p_state->>'hole')::integer;
  v_n       integer := jsonb_array_length(p_state->'holes');
  v_strokes integer;
  v_cap     integer;
  v_holed   boolean;
  v_score   integer;
  v_water   integer;
  v_mill    integer;
  v_bank    integer;
  v_hits    integer;
  v_st      jsonb;
  v_late    boolean := p_state->>'deadline' is not null and now() >= (p_state->>'deadline')::timestamptz;
  pl        text;
  i         integer;
begin
  -- ---------------------------------------------------------------- hole (fin de trou d'un joueur)
  if v_type = 'hole' then
    if not ((p_state->'players') ? v_me) then raise exception 'not_a_player'; end if;
    if v_phase = 'finished' then raise exception 'wrong_phase'; end if;
    if jsonb_typeof(p_action->'hole') is distinct from 'number' or (p_action->>'hole') !~ '^\d{1,2}$' then
      raise exception 'invalid_action';
    end if;
    if (p_action->>'hole')::integer <> v_hole then raise exception 'wrong_hole'; end if;
    -- Doublon (renvoi réseau, ou déjà ramassé par le chrono) : ignoré sans erreur.
    if (p_state->'done') ? v_me then return jsonb_build_object('state', p_state, 'server', p_server); end if;
    if v_phase <> 'playing' then raise exception 'wrong_phase'; end if;
    if jsonb_typeof(p_action->'holed') is distinct from 'boolean' then raise exception 'invalid_action'; end if;
    v_holed := (p_action->>'holed')::boolean;
    if jsonb_typeof(p_action->'strokes') is distinct from 'number' or (p_action->>'strokes') !~ '^\d{1,2}$' then
      raise exception 'invalid_strokes';
    end if;
    v_strokes := (p_action->>'strokes')::integer;
    v_cap := public._mg_cap((p_state->'pars'->>v_hole)::integer);
    if v_strokes < 1 or v_strokes > (case when v_holed then v_cap else v_cap + 1 end) then raise exception 'invalid_strokes'; end if;

    -- Compteurs de trophées déclarés par le client, bornés.
    v_st := case when jsonb_typeof(p_action->'stats') = 'object' then p_action->'stats' else '{}'::jsonb end;
    v_water := case when jsonb_typeof(v_st->'water') = 'number' and (v_st->>'water') ~ '^\d{1,2}$' then (v_st->>'water')::integer else 0 end;
    v_water := least(v_water, v_strokes - case when v_holed then 1 else 0 end);
    v_mill := case when jsonb_typeof(v_st->'mill_hits') = 'number' and (v_st->>'mill_hits') ~ '^\d{1,2}$' then least((v_st->>'mill_hits')::integer, v_strokes) else 0 end;
    v_bank := case when v_holed and jsonb_typeof(v_st->'bank_shot') = 'number' and (v_st->>'bank_shot')::numeric >= 1 then 1 else 0 end;

    -- Chrono dépassé (tolérance réseau 3 s) : le trou se clôt, l'envoi est ignoré (score 7).
    if v_late and now() > (p_state->>'deadline')::timestamptz + interval '3 seconds' then
      return public._mg_close_hole(p_state, p_server);
    end if;
    -- Temps minimum : chaque coup réellement joué prend au moins 1,5 s.
    v_hits := greatest(1, v_strokes - v_water);
    if now() < (p_state->>'hole_started_at')::timestamptz + make_interval(secs => v_hits * 1.5) then
      raise exception 'too_fast';
    end if;

    v_score := case when v_holed then v_strokes else v_cap + 1 end;
    p_state := public._mg_record(p_state, v_me, v_score);
    p_state := p_state || jsonb_build_object('last_hole', jsonb_build_object(
      'id', v_me, 'hole', v_hole, 'strokes', v_score, 'holed', v_holed, 'at', now()));
    if v_water > 0 then p_server := public._mg_bump(p_server, v_me, 'water', v_water); end if;
    if v_mill > 0 then p_server := public._mg_bump(p_server, v_me, 'mill_hits', v_mill); end if;
    if v_bank > 0 then p_server := public._mg_bump(p_server, v_me, 'bank_shot', 1); end if;
    if not v_holed then p_server := public._mg_bump(p_server, v_me, 'picked_up', 1); end if;

    if jsonb_array_length(p_state->'done') >= jsonb_array_length(p_state->'players') then
      return public._mg_close_hole(p_state, p_server);
    end if;
    -- Il ne reste qu'un joueur : le trou se clot 45 s apres (meme en « Sans chrono »),
    -- sans rallonger un chrono deja plus court.
    if jsonb_array_length(p_state->'done') >= jsonb_array_length(p_state->'players') - 1 then
      p_state := p_state || jsonb_build_object('deadline', to_jsonb(
        case when p_state->>'deadline' is not null
             then least((p_state->>'deadline')::timestamptz, now() + interval '45 seconds')
             else now() + interval '45 seconds' end));
    end if;
    return jsonb_build_object('state', p_state, 'server', p_server);

  -- ---------------------------------------------------------------- tick (échéances)
  elsif v_type = 'tick' then
    if v_phase = 'playing' and v_late then
      return public._mg_close_hole(p_state, p_server);
    elsif v_phase = 'hole_end' and v_late then
      return jsonb_build_object('state', public._mg_open_hole(p_state, v_hole + 1), 'server', p_server);
    end if;
    return jsonb_build_object('state', p_state, 'server', p_server);

  -- ---------------------------------------------------------------- next (hôte : couper le trou / passer le classement)
  elsif v_type = 'next' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase = 'playing' then
      return public._mg_close_hole(p_state, p_server);
    elsif v_phase = 'hole_end' then
      return jsonb_build_object('state', public._mg_open_hole(p_state, v_hole + 1), 'server', p_server);
    end if;
    raise exception 'wrong_phase';

  -- ---------------------------------------------------------------- end_game (hôte : trous restants = 7)
  elsif v_type = 'end_game' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase not in ('playing', 'hole_end') then raise exception 'wrong_phase'; end if;
    if v_phase = 'hole_end' then p_state := public._mg_open_hole(p_state, v_hole + 1); end if;
    loop
      for pl in select x from jsonb_array_elements_text(p_state->'players') x loop
        if not ((p_state->'done') ? pl) then
          p_state := public._mg_record(p_state, pl, public._mg_picked((p_state->'pars'->>((p_state->>'hole')::integer))::integer));
        end if;
      end loop;
      i := (p_state->>'hole')::integer;
      exit when i >= v_n - 1;
      p_state := p_state || jsonb_build_object('hole', i + 1, 'round', i + 2, 'done', '[]'::jsonb);
    end loop;
    return public._mg_finish(p_state, p_server, true);

  else
    raise exception 'unknown_action';
  end if;
end $$;

revoke all on function public._mg_course() from public, anon, authenticated;
revoke all on function public._mg_cap(integer) from public, anon, authenticated;
revoke all on function public._mg_picked(integer) from public, anon, authenticated;
revoke all on function public._mg_open_hole(jsonb, integer) from public, anon, authenticated;
revoke all on function public._mg_bump(jsonb, text, text, integer) from public, anon, authenticated;
revoke all on function public._mg_record(jsonb, text, integer) from public, anon, authenticated;
revoke all on function public._mg_tstats(jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public._mg_finish(jsonb, jsonb, boolean) from public, anon, authenticated;
revoke all on function public._mg_close_hole(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.game_mini_golf_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_mini_golf_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;


-- ===== games\morpion.sql =====
-- =============================================================================
-- JEU « Morpion » (id morpion) — jeu en DUEL (socle supabase/features/duel.sql ;
-- modèle : games/quatre-a-la-suite.sql). 3 variantes au choix de l'hôte
-- (p_options.board.variant, défaut classic) :
--   classic  : grille 3×3, aligner 3 ; grille pleine = nul.
--   giant    : grille 10×10, aligner 5 OU PLUS ; grille pleine = nul.
--   ultimate : 9 petits morpions 3×3 dans un grand. La case jouée dans un petit
--              morpion désigne le petit morpion où l'adversaire doit jouer ; s'il
--              est gagné ou plein, l'adversaire joue n'importe où. Un petit morpion
--              gagné devient un grand X/O (plus aucun coup dedans) ; gagner =
--              aligner 3 petits morpions ; les petits nuls ne comptent pour
--              personne ; nul quand il n'y a plus aucun coup possible.
-- ❌ (x) = le joueur qui commence la manche (duel.starter, alterné par le socle) ;
-- ⭕ (o) = l'autre.
--
-- Plateau public (state.board) :
--   {"variant": "classic"|"giant"|"ultimate",
--    "size": 3|10|9,                    -- côté de la grille de cases
--    "align": 3|5|3,                    -- alignement gagnant (ultime : 3 petits morpions)
--    "a": "<uid>", "b": "<uid>",        -- duellistes (couleurs du socle)
--    "x": "<uid>", "o": "<uid>",        -- ❌ / ⭕
--    "cells": [null|"x"|"o", …],        -- size² cases. classic/giant : i = ligne*size + colonne ;
--                                       -- ultimate : i = 9*petit + case (petit, case : 0..8, sens de lecture)
--    "count": n,                        -- coups joués
--    "last": {"cell": i, "by": "<uid>"} | null,
--    "lines": [[i, …], …] | null,       -- segments gagnants, chacun ordonné d'un bout à l'autre
--                                       -- (classic/giant : cases ; ultimate : petits morpions 0..8)
--    "boards": [null|"x"|"o"|"draw" ×9] | null,   -- ultimate : état des petits morpions (sinon null)
--    "next": 0..8 | null}               -- ultimate : petit morpion imposé (null = libre)
-- Coup : {"cell": i} (aucune autre clé, sinon invalid_move). Pas de secret, pas de server, pas de préparation.
-- Erreurs : invalid_move (format, hors grille), cell_taken, wrong_board (ultime :
-- hors du petit morpion imposé), board_closed (ultime : petit morpion terminé),
-- invalid_variant (démarrage). Miroir TS : src/games/morpion/logic.ts.
-- =============================================================================

-- Variante normalisée (absente / inconnue -> classic).
create or replace function public._morpion_variant(p_opts jsonb)
returns text language sql immutable
set search_path = public, extensions
as $$
  select case when jsonb_typeof(p_opts) = 'object' and p_opts->>'variant' in ('classic', 'giant', 'ultimate')
              then p_opts->>'variant' else 'classic' end;
$$;

-- Contenu de la case (r, c) d'une grille carrée p_n × p_n stockée à plat ; null si vide / hors grille.
create or replace function public._morpion_at(p_grid jsonb, p_n integer, p_r integer, p_c integer)
returns text language sql immutable
set search_path = public, extensions
as $$
  select case when p_r between 0 and p_n - 1 and p_c between 0 and p_n - 1 then p_grid->>(p_r * p_n + p_c) end;
$$;

-- Segments de p_sym alignés (>= p_align) passant par la case p_idx d'une grille
-- p_n × p_n, dans l'ordre : ligne, colonne, diagonale \, diagonale /. Chaque
-- segment est ordonné d'un bout à l'autre (sens de lecture). Null s'il n'y en a pas.
create or replace function public._morpion_runs(p_grid jsonb, p_n integer, p_idx integer, p_align integer, p_sym text)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_dirs integer[] := array[0,1, 1,0, 1,1, 1,-1];   -- (dr, dc)
  v_r    integer := p_idx / p_n;
  v_c    integer := p_idx % p_n;
  v_out  jsonb := '[]'::jsonb;
  v_seg  jsonb;
  dr     integer;
  dc     integer;
  k      integer;
  i      integer;
begin
  if p_sym is null or public._morpion_at(p_grid, p_n, v_r, v_c) is distinct from p_sym then return null; end if;
  for i in 0 .. 3 loop
    dr := v_dirs[i * 2 + 1];
    dc := v_dirs[i * 2 + 2];
    -- Recule jusqu'au début du segment…
    k := 0;
    while public._morpion_at(p_grid, p_n, v_r - (k + 1) * dr, v_c - (k + 1) * dc) = p_sym loop
      k := k + 1;
    end loop;
    -- … puis avance jusqu'à sa fin.
    v_seg := '[]'::jsonb;
    while public._morpion_at(p_grid, p_n, v_r - k * dr, v_c - k * dc) = p_sym loop
      v_seg := v_seg || to_jsonb((v_r - k * dr) * p_n + (v_c - k * dc));
      k := k - 1;
    end loop;
    if jsonb_array_length(v_seg) >= p_align then
      v_out := v_out || jsonb_build_array(v_seg);
    end if;
  end loop;
  return case when jsonb_array_length(v_out) > 0 then v_out end;
end $$;

-- Les 9 cases du petit morpion p_b (ultime), dans l'ordre de lecture.
create or replace function public._morpion_sub(p_cells jsonb, p_b integer)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select jsonb_agg(coalesce(p_cells->(9 * p_b + k), 'null'::jsonb) order by k) from generate_series(0, 8) as k;
$$;

-- Plus aucune case vide (null) ?
create or replace function public._morpion_full(p_grid jsonb)
returns boolean language sql immutable
set search_path = public, extensions
as $$
  select not exists (select 1 from jsonb_array_elements(p_grid) as e where jsonb_typeof(e) = 'null');
$$;

-- ---------------------------------------------------------------- hooks du socle

create or replace function public.game_morpion_board_new(p_ctx jsonb, p_a text, p_b text)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_var text := public._morpion_variant(p_ctx->'options');
  v_n   integer := case v_var when 'giant' then 10 when 'ultimate' then 9 else 3 end;
  v_x   text := case when p_ctx->>'starter' = p_b then p_b else p_a end;
begin
  return jsonb_build_object('board', jsonb_build_object(
    'variant', v_var,
    'size', v_n,
    'align', case when v_var = 'giant' then 5 else 3 end,
    'a', p_a, 'b', p_b,
    'x', v_x, 'o', case when v_x = p_a then p_b else p_a end,
    'cells', (select jsonb_agg('null'::jsonb) from generate_series(1, v_n * v_n)),
    'count', 0,
    'last', null,
    'lines', null,
    'boards', case when v_var = 'ultimate' then (select jsonb_agg('null'::jsonb) from generate_series(1, 9)) end,
    'next', null));
end $$;

create or replace function public.game_morpion_board_move(p_board jsonb, p_server jsonb, p_actor text, p_move jsonb)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_ult    boolean := p_board->>'variant' = 'ultimate';
  v_n      integer := (p_board->>'size')::integer;
  v_cells  jsonb := p_board->'cells';
  v_boards jsonb := p_board->'boards';
  v_next   integer := (p_board->>'next')::integer;
  v_sym    text;
  v_i      integer;
  v_b      integer;
  v_k      integer;
  v_lines  jsonb := null;
  v_out    text := null;
begin
  v_sym := case p_actor when p_board->>'x' then 'x' when p_board->>'o' then 'o' end;
  if v_sym is null then raise exception 'invalid_move'; end if;
  -- Format : EXACTEMENT {"cell": entier >= 0} dans la grille. Aucune autre clé :
  -- le socle recopie le coup tel quel dans le state public (duel.last_move) ; un
  -- champ parasite le gonflerait sur tous les téléphones.
  if jsonb_typeof(p_move) is distinct from 'object' then raise exception 'invalid_move'; end if;
  if (p_move - 'cell') <> '{}'::jsonb then raise exception 'invalid_move'; end if;
  if jsonb_typeof(p_move->'cell') is distinct from 'number' or coalesce(p_move->>'cell', '') !~ '^\d{1,3}$' then
    raise exception 'invalid_move';
  end if;
  v_i := (p_move->>'cell')::integer;
  if v_i >= v_n * v_n then raise exception 'invalid_move'; end if;

  if v_ult then
    v_b := v_i / 9;
    v_k := v_i % 9;
    if v_next is not null and v_b <> v_next then raise exception 'wrong_board'; end if;
    if jsonb_typeof(v_boards->v_b) is distinct from 'null' then raise exception 'board_closed'; end if;
  end if;
  if jsonb_typeof(v_cells->v_i) is distinct from 'null' then raise exception 'cell_taken'; end if;

  v_cells := jsonb_set(v_cells, array[v_i::text], to_jsonb(v_sym));

  if v_ult then
    -- Petit morpion : gagné (grand X/O) ou plein (nul, à personne) ?
    if public._morpion_runs(public._morpion_sub(v_cells, v_b), 3, v_k, 3, v_sym) is not null then
      v_boards := jsonb_set(v_boards, array[v_b::text], to_jsonb(v_sym));
      v_lines := public._morpion_runs(v_boards, 3, v_b, 3, v_sym);
    elsif public._morpion_full(public._morpion_sub(v_cells, v_b)) then
      v_boards := jsonb_set(v_boards, array[v_b::text], '"draw"'::jsonb);
    end if;
    -- La case jouée désigne le prochain petit morpion (libre s'il est terminé).
    v_next := case when jsonb_typeof(v_boards->v_k) = 'null' then v_k end;
    if v_lines is not null then v_out := 'win';
    elsif public._morpion_full(v_boards) then v_out := 'draw';   -- plus aucun coup possible
    end if;
  else
    v_lines := public._morpion_runs(v_cells, v_n, v_i, (p_board->>'align')::integer, v_sym);
    if v_lines is not null then v_out := 'win';
    elsif public._morpion_full(v_cells) then v_out := 'draw';
    end if;
  end if;

  p_board := p_board || jsonb_build_object(
    'cells', v_cells,
    'count', coalesce((p_board->>'count')::integer, 0) + 1,
    'last', jsonb_build_object('cell', v_i, 'by', p_actor),
    'lines', v_lines,
    'boards', v_boards,
    'next', case when v_ult and v_out is null then v_next end);
  if v_out = 'win' then
    -- 'game' : compteurs de fin de manche pour les trophées (L'ombre : Ultime gagné sans perdre un petit morpion)
    return jsonb_build_object('board', p_board, 'outcome', 'win', 'winner', p_actor,
      'game', jsonb_build_object('clean_ultimate',
        v_ult and not exists (select 1 from jsonb_array_elements_text(v_boards) b where b = case v_sym when 'x' then 'o' else 'x' end)));
  end if;
  return jsonb_build_object('board', p_board, 'outcome', v_out);
end $$;

-- Coup automatique (minuteur) : une case libre au hasard, en respectant la
-- contrainte de l'ultime (petit morpion imposé, sinon un petit morpion non terminé).
create or replace function public.game_morpion_board_auto(p_board jsonb, p_server jsonb, p_actor text)
returns jsonb language sql volatile
set search_path = public, extensions
as $$
  select jsonb_build_object('cell', i)
    from generate_series(0, (p_board->>'size')::integer * (p_board->>'size')::integer - 1) as i
   where jsonb_typeof(p_board->'cells'->i) = 'null'
     and (p_board->>'variant' is distinct from 'ultimate'
          or (jsonb_typeof(p_board->'boards'->(i / 9)) = 'null'
              and (p_board->>'next' is null or i / 9 = (p_board->>'next')::integer)))
   order by random() limit 1;
$$;

-- ---------------------------------------------------------------- moteur (délégation au socle)

-- Hook de trophées du socle duel (features/duel.sql, _duel_tstats) : stats propres au jeu.
-- La variante est celle de la session (session.board_options.variant).
create or replace function public.game_morpion_trophy_stats(p_state jsonb, p_pl text)
returns jsonb language sql stable
set search_path = public, extensions
as $$
  with v as (
    select public._morpion_variant(p_state->'session'->'board_options') as variant,
           coalesce((p_state->'session'->'stats'->p_pl->>'wins')::integer, 0) as wins
  ), g as (select * from public._duel_games(p_state, p_pl))
  select jsonb_build_object(
    'classic_fast_loss', case when v.variant = 'classic' then (select count(*) from g where lost and moves <= 7) else 0 end,
    'giant_wins', case when v.variant = 'giant' then (select count(*) from g where won) else 0 end,
    'win_classic', case when v.variant = 'classic' and v.wins >= 1 then 1 else 0 end,
    'win_giant', case when v.variant = 'giant' and v.wins >= 1 then 1 else 0 end,
    'win_ultimate', case when v.variant = 'ultimate' and v.wins >= 1 then 1 else 0 end,
    'classic_second_win', case when v.variant = 'classic' then (select count(*) from g where won and not i_started) else 0 end,
    'giant_fast_win', case when v.variant = 'giant' then (select count(*) from g where won and moves <= 13) else 0 end,
    'ultimate_duel_wins', case when v.variant = 'ultimate' then v.wins else 0 end,
    'clean_ultimate', case when v.variant = 'ultimate'
        then (select count(*) from public._duel_games_x(p_state, p_pl) x
               where x.won and coalesce((x.g->>'clean_ultimate')::boolean, false)) else 0 end)
  from v
$$;
revoke all on function public.game_morpion_trophy_stats(jsonb, text) from public, anon, authenticated;

create or replace function public.game_morpion_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare v_var jsonb := p_options->'board'->'variant';
begin
  if cardinality(p_players) > 9 then raise exception 'too_many_players'; end if;
  if v_var is not null and (jsonb_typeof(v_var) <> 'string' or v_var #>> '{}' not in ('classic', 'giant', 'ultimate')) then
    raise exception 'invalid_variant';
  end if;
  return public._duel_start('morpion', p_players, p_options);
end $$;

create or replace function public.game_morpion_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
begin
  return public._duel_action('morpion', p_state, p_server, p_actor, p_is_host, p_action);
end $$;

revoke all on function public._morpion_variant(jsonb) from public, anon, authenticated;
revoke all on function public._morpion_at(jsonb, integer, integer, integer) from public, anon, authenticated;
revoke all on function public._morpion_runs(jsonb, integer, integer, integer, text) from public, anon, authenticated;
revoke all on function public._morpion_sub(jsonb, integer) from public, anon, authenticated;
revoke all on function public._morpion_full(jsonb) from public, anon, authenticated;
revoke all on function public.game_morpion_board_new(jsonb, text, text) from public, anon, authenticated;
revoke all on function public.game_morpion_board_move(jsonb, jsonb, text, jsonb) from public, anon, authenticated;
revoke all on function public.game_morpion_board_auto(jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.game_morpion_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_morpion_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;


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

-- Échéance d'une phase selon le chrono choisi (Détendu = plafond 5/6 min).
create or replace function public._ndc_deadline(p_timer text, p_phase text)
returns jsonb language sql stable
set search_path = public, extensions
as $$
  select case
    when p_timer = 'normal' then to_jsonb(now() + make_interval(secs => case when p_phase = 'clue' then 120 else 180 end))
    when p_timer = 'fast'   then to_jsonb(now() + make_interval(secs => case when p_phase = 'clue' then 60 else 120 end))
    -- Détendu : plafond large (5 min / 6 min) pour qu'un espion ou un joueur parti ne bloque jamais la partie
    else to_jsonb(now() + make_interval(secs => case when p_phase = 'clue' then 300 else 360 end)) end
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
  p_server := p_server || jsonb_build_object('key', v_key, 'first', '{}'::jsonb, 'team_err', v_zero, 'team_ok', v_zero,
                                             'max_deficit', v_zero, 'last_turn', null);
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
    -- « Sans faute » : aucune erreur ET au moins un bon mot trouvé par l'équipe elle-même
    -- (sinon on gagne sans jouer quand l'adversaire touche la bombe au premier coup)
    if coalesce((p_server->'team_err'->>p_winner)::integer, 0) = 0
       and coalesce((p_server->'team_ok'->>p_winner)::integer, 0) >= 1 then
      p_server := public._ndc_bump(p_server, v_m, 'flawless', 1);
    end if;
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
  v_old  text := p_state->>'turn';
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
  -- last_turn : équipe dont le tour vient de se terminer (pour distinguer un indice « trop tard » d'un intrus)
  p_server := p_server || jsonb_build_object('first', '{}'::jsonb, 'last_turn', v_old);
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
  -- « Bon flair » : le premier à avoir posé sa tête, SEULEMENT s'il l'a laissée sur ce mot jusqu'au dévoilement
  -- (qui a retiré ou déplacé sa tête n'est plus dans v_voters).
  if v_c = v_turn and v_first is not null and v_first = any(v_voters) then p_server := public._ndc_bump(p_server, v_first, 'first_good', 1); end if;

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
    -- bons mots trouvés par l'équipe elle-même (pour « Sans faute »)
    p_server := p_server || jsonb_build_object('team_ok', coalesce(p_server->'team_ok', '{}'::jsonb)
      || jsonb_build_object(v_turn, coalesce((p_server->'team_ok'->>v_turn)::integer, 0) + 1));
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
    -- indice envoyé juste après la fin du chrono : le tour est déjà passé à une autre équipe,
    -- l'ancien espion reçoit « trop tard » (et non « seul l'espion… »)
    if v_phase in ('clue', 'guess') and v_me is distinct from v_spy
       and v_me = (select t->>'spy' from jsonb_array_elements(p_state->'teams') t where t->>'id' = p_server->>'last_turn') then
      raise exception 'clue_too_late';
    end if;
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
    'deadline', public._pdb_iso(now() + make_interval(secs => case
      when coalesce((p_state->'absent'->>p_player)::boolean, false) then 6   -- absent auto : tour express
      else coalesce((p_state->>'turn_seconds')::integer, 30) end)));
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
  if p_state->>'phase' <> 'playing' then
    if v_type = 'tick' then return jsonb_build_object('state', p_state, 'server', p_server); end if;
    raise exception 'wrong_phase';
  end if;

  -- Toute action du joueur lui-même remet son compteur d'auto à zéro et le fait revenir s'il était absent.
  if v_type <> 'tick' and (p_state->'players') ? v_me then
    if coalesce((p_state->'absent'->>v_me)::boolean, false) then
      p_state := p_state || jsonb_build_object('absent', (p_state->'absent') - v_me);
      p_state := public._pdb_log(p_state, jsonb_build_object('t', 'back', 'p', v_me));
    end if;
    if coalesce(p_state->'idle', '{}'::jsonb) ? v_me then
      p_state := p_state || jsonb_build_object('idle', (p_state->'idle') - v_me);
    end if;
  end if;

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
    -- Absent auto : 2 tours consécutifs joués par tick.
    p_state := p_state || jsonb_build_object('idle', coalesce(p_state->'idle', '{}'::jsonb)
      || jsonb_build_object(v_turn, coalesce((p_state->'idle'->>v_turn)::integer, 0) + 1));
    if (p_state->'idle'->>v_turn)::integer >= 2
       and not coalesce((p_state->'absent'->>v_turn)::boolean, false) then
      p_state := p_state || jsonb_build_object('absent', coalesce(p_state->'absent', '{}'::jsonb)
        || jsonb_build_object(v_turn, true));
      p_state := public._pdb_log(p_state, jsonb_build_object('t', 'absent', 'p', v_turn));
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
-- (le/la/les/l'/un/une), sans accents, espaces ni ponctuation, et sans s/x final
-- si le résultat fait plus de 3 caractères (lion = lions). Miroir : normalizeAnswer (logic.ts).
create or replace function public._pb_norm(p text)
returns text language sql immutable
set search_path = public, extensions
as $$
  select case when char_length(n) > 3 and n ~ '[sx]$' then left(n, -1) else n end
    from (select public._normalize_word(
            regexp_replace(lower(btrim(coalesce(p, ''))), '^(l\s*[''’`]\s*|(le|la|les|un|une)\s+)', '')) as n) t
$$;

-- Première lettre acceptée : celle du texte sans article OU du texte brut
-- (« La Réunion », « L'Italie » valent pour la lettre L). Miroir : autoStatus (logic.ts).
create or replace function public._pb_letter_ok(p text, p_letter text)
returns boolean language sql immutable
set search_path = public, extensions
as $$
  select left(public._pb_norm(p), 1) = lower(p_letter)
      or left(public._normalize_word(lower(btrim(coalesce(p, '')))), 1) = lower(p_letter)
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
                          when not public._pb_letter_ok(x.t, p_state->>'letter') then 'letter'
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
      'deadline', to_jsonb(now() + interval '15 seconds'),
      'answers', public._pb_build_answers(p_state, p_server),
      'contests', '{}'::jsonb));
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Catégorie suivante (ou scores après la dernière) : hôte (next_category) ou tick à l'échéance.
create or replace function public._pb_advance(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_cur integer := (p_state#>>'{validation,cat_index}')::integer;
begin
  if v_cur + 1 >= jsonb_array_length(p_state->'categories') then
    return public._pb_score(p_state, p_server);
  end if;
  p_state := jsonb_set(p_state, '{validation,cat_index}', to_jsonb(v_cur + 1));
  p_state := jsonb_set(p_state, '{validation,deadline}', to_jsonb(now() + interval '15 seconds'), true);
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
-- Refusée si contestée par la majorité stricte des AUTRES joueurs (et au moins 2 contestations :
-- à 2 joueurs, une contestation seule ne refuse rien).
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
      elsif v_cnt >= 2 and v_cnt * 2 > v_n - 1 then   -- à 2 joueurs : jamais refusée par un seul 👎
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
    'score_deadline', to_jsonb(now() + interval '20 seconds'),  -- animation des scores + lecture, puis tick -> manche suivante
    'validation', null,
    'scores', (select jsonb_object_agg(key, value::integer + coalesce((v_points->>key)::integer, 0))
                 from jsonb_each_text(p_state->'scores')),
    'uniques', (select jsonb_object_agg(key, value::integer + coalesce((v_uniq->>key)::integer, 0))
                  from jsonb_each_text(coalesce(p_state->'uniques', v_points))),
    'last_round', jsonb_build_object(
        'round', p_state->'round', 'letter', p_state->'letter',
        'points', v_points, 'uniques', v_uniq, 'detail', v_detail),
    'history', coalesce(p_state->'history', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'round', p_state->'round', 'letter', p_state->'letter', 'points', v_points, 'det', v_det,
        -- moments de fin de partie : mot valide le plus long, réponse la plus contestée (null si rien)
        'longest', (select jsonb_build_object('pl', e.pl, 'text', e.d->>'text', 'cat', e.cat)
                      from (select c.key as cat, x.key as pl, x.value as d
                              from jsonb_each(v_detail) c, jsonb_each(c.value) x) e
                     where e.d->>'status' in ('unique', 'shared')
                     order by char_length(e.d->>'text') desc, e.cat, e.pl limit 1),
        'hot', (select jsonb_build_object('pl', e.pl, 'text', e.d->>'text', 'cat', e.cat,
                                          'contests', (e.d->>'contests')::integer, 'status', e.d->>'status')
                  from (select c.key as cat, x.key as pl, x.value as d
                          from jsonb_each(v_detail) c, jsonb_each(c.value) x) e
                 where (e.d->>'contests')::integer > 0 and e.d->>'text' <> ''
                 order by (e.d->>'contests')::integer desc, e.cat, e.pl limit 1))));
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
    -- Validation : la catégorie avance seule à son échéance (state anciens sans deadline : inchangés).
    if v_phase = 'round_score' and p_state->>'score_deadline' is not null
       and now() >= (p_state->>'score_deadline')::timestamptz then
      if v_round >= (p_state->>'total_rounds')::integer then
        return public._pb_finish(p_state, p_server);
      end if;
      return public._pb_start_round(p_state - 'forced' - 'score_deadline', p_server, v_round + 1);
    end if;
    if v_phase = 'validation' and p_state#>>'{validation,deadline}' is not null
       and now() >= (p_state#>>'{validation,deadline}')::timestamptz then
      return public._pb_advance(p_state, p_server);
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
    -- Contestation sur la catégorie en cours : on laisse au moins 8 s pour en discuter (jamais raccourci).
    if v_value and v_idx = v_cur and p_state#>>'{validation,deadline}' is not null then
      p_state := jsonb_set(p_state, '{validation,deadline}', to_jsonb(greatest(
        (p_state#>>'{validation,deadline}')::timestamptz, now() + interval '8 seconds')));
    end if;
    return jsonb_build_object('state', p_state, 'server', p_server);

  -- ---------------------------------------------------------------- next_category
  elsif v_type = 'next_category' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase <> 'validation' then raise exception 'wrong_phase'; end if;
    return public._pb_advance(p_state, p_server);

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
revoke all on function public._pb_letter_ok(text, text) from public, anon, authenticated;
revoke all on function public._pb_advance(jsonb, jsonb) from public, anon, authenticated;
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
-- Échéance ~45 s (`placing_seconds`) : le devineur envoie `ready` ; sinon (absent) le tick
-- saute le tour. L'hôte peut aussi passer le tour (`skip_turn`).
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
    'deadline', public._qsj_iso(now() + make_interval(secs => coalesce((p_state->>'placing_seconds')::integer, 45))),
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
    'placing_seconds', 45,
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
    elsif v_phase = 'placing' then
      -- devineur absent : échéance passée → on saute son tour (rétrocompat : pas d'échéance = ignoré)
      if nullif(p_state->>'deadline', '') is null or now() < (p_state->>'deadline')::timestamptz then
        return jsonb_build_object('state', p_state, 'server', p_server);
      end if;
      return public._qsj_end_turn(p_state, p_server, true);
    end if;
    -- autre phase : ignoré sans erreur.
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
