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
                       jsonb_strip_nulls(jsonb_build_object('n', e->'card'->>'name', 'r', e->>'r', 's', e->'card'->>'slug'))
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
    select t.o as turn_o, x.o as i, x.e->>'r' as r, x.e->>'s' as s
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
