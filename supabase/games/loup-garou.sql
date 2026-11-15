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
      'placement', case when v_won then 1 else 2 end));
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
