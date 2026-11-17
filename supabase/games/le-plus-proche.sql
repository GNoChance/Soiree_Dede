-- =============================================================================
-- JEU « le-plus-proche » : estimations chiffrées multi-écrans
-- =============================================================================
-- Idempotent (create or replace). Contrat : src/games/le-plus-proche/types.ts.
--
-- p_options : {"duration": 30, "questions": [{id, theme, difficulty, prompt, unit?, answer:number, note?}]}
-- Les réponses de référence (answer, note) et les estimations des joueurs restent dans
-- match_server_state jusqu'à la révélation. Chaque joueur retrouve SA saisie dans son
-- secret {"round", "value", "answered": true} (rechargement de page).
--
-- Phases : question -> reveal -> question ... -> finished.
--   question : fin quand tous ont répondu (valeur ou « je ne sais pas »), à l'échéance
--              (tick) ou par l'hôte (reveal).
--   reveal   : pas d'échéance, l'hôte enchaîne (next).
-- Toute action portant un "round" différent de la manche courante est ignorée sans erreur.
--
-- Points d'une manche : classement par écart absolu |estimation - réponse| (ex-aequo =
-- même rang, rang « sportif » : 1, 1, 3…) : rang 1 = 3 pts, rang 2 = 2 pts, rang 3 = 1 pt.
-- Bonus +5 si l'estimation est EXACTE : arrondie au nombre de décimales de la réponse de
-- référence, elle lui est égale (réponse entière 1665 : 1665 ou 1665,4 sont exactes,
-- 1666 non ; réponse 3,14 : 3,141 est exacte). Une estimation exacte compte comme
-- un écart nul pour le classement.

-- Valeur absolue maximale acceptée (questions et estimations) : 1e15
-- (au-delà, les nombres JS perdent leur précision entière).
create or replace function public._lpp_num(p jsonb)
returns numeric language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v numeric;
begin
  if p is null or jsonb_typeof(p) <> 'number' then return null; end if;
  v := (p #>> '{}')::numeric;
  if abs(v) > 1e15 then return null; end if;
  return trim_scale(round(v, 6));
end $$;

-- Ouvre la manche d'index p_idx (0-based).
create or replace function public._lpp_open(p_state jsonb, p_server jsonb, p_idx integer)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_q   jsonb := p_server->'questions'->p_idx;
  v_now timestamptz := now();
begin
  p_state := p_state || jsonb_build_object(
    'phase', 'question',
    'round', p_idx + 1,
    'started_at', to_jsonb(v_now),
    'deadline', to_jsonb(v_now + make_interval(secs => (p_state->>'duration')::integer)),
    'question', v_q - 'answer' - 'note' - 'decimals',
    'answered', '[]'::jsonb);
  p_server := p_server || jsonb_build_object('answers', '{}'::jsonb);
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

create or replace function public.game_le_plus_proche_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_in   jsonb := p_options->'questions';
  v_dur  integer;
  v_qs   jsonb := '[]'::jsonb;
  e      jsonb;
  v_ans  numeric;
  v_zero jsonb;
begin
  if cardinality(p_players) < 2 then raise exception 'not_enough_players'; end if;
  if cardinality(p_players) > 9 then raise exception 'too_many_players'; end if;
  if v_in is null or jsonb_typeof(v_in) <> 'array' or jsonb_array_length(v_in) = 0 then
    raise exception 'missing_questions';
  end if;
  begin
    v_dur := coalesce(nullif(p_options->>'duration', '')::integer, 30);
  exception when others then v_dur := 30;
  end;
  v_dur := least(greatest(v_dur, 10), 120);

  for e in select value from jsonb_array_elements(v_in) with ordinality t(value, o) order by o limit 30 loop
    v_ans := public._lpp_num(e->'answer');
    if jsonb_typeof(e) <> 'object' or jsonb_typeof(e->'prompt') <> 'string'
       or char_length(btrim(e->>'prompt')) = 0 or char_length(e->>'prompt') > 500
       or v_ans is null then
      raise exception 'invalid_questions';
    end if;
    v_qs := v_qs || jsonb_build_array(jsonb_build_object(
      'id', left(coalesce(e->>'id', ''), 40),
      'theme', left(coalesce(e->>'theme', ''), 40),
      'difficulty', case when e->>'difficulty' in ('1', '2', '3') then (e->>'difficulty')::integer end,
      'prompt', e->>'prompt',
      'unit', case when jsonb_typeof(e->'unit') = 'string' and btrim(e->>'unit') <> ''
                   then left(btrim(e->>'unit'), 30) end,
      'answer', v_ans,
      'decimals', least(scale(v_ans), 6),
      'note', case when jsonb_typeof(e->'note') = 'string' and btrim(e->>'note') <> ''
                   then left(btrim(e->>'note'), 400) end));
  end loop;

  select jsonb_object_agg(p::text, 0) into v_zero from unnest(p_players) p;

  return public._lpp_open(
    jsonb_build_object(
      'game', 'le-plus-proche',
      'round', 1,
      'total_rounds', jsonb_array_length(v_qs),
      'duration', v_dur,
      'players', to_jsonb(p_players),
      'scores', v_zero,
      'exacts', v_zero,
      'last_reveal', null,
      'history', '[]'::jsonb,
      'winners', null,
      'results', null),
    jsonb_build_object('questions', v_qs),
    0) || jsonb_build_object('secrets', '{}'::jsonb);
end $$;

-- Révélation : classement de la manche, points, publication des estimations.
create or replace function public._lpp_reveal(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_round   integer := (p_state->>'round')::integer;
  v_q       jsonb := p_server->'questions'->(v_round - 1);
  v_ans     numeric := (v_q->>'answer')::numeric;
  v_dec     integer := coalesce((v_q->>'decimals')::integer, 0);
  v_answers jsonb := coalesce(p_server->'answers', '{}'::jsonb);
  v_ranking jsonb;
  v_points  jsonb;
  v_exact   jsonb;
  v_reveal  jsonb;
begin
  with a as (
    select key as pid, (value #>> '{}')::numeric as v
      from jsonb_each(v_answers) where jsonb_typeof(value) = 'number'
  ), d as (
    select pid, v, round(v, v_dec) = v_ans as exact, abs(v - v_ans) as gap from a
  ), r as (
    select pid, v, exact, gap,
           rank() over (order by case when exact then 0 else gap end) as rk
      from d
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'profile_id', pid, 'value', v, 'gap', gap, 'rank', rk, 'exact', exact,
           'points', case rk when 1 then 3 when 2 then 2 when 3 then 1 else 0 end
                     + case when exact then 5 else 0 end)
         order by rk, gap, pid), '[]'::jsonb)
    into v_ranking from r;

  select coalesce(jsonb_object_agg(x->>'profile_id', (x->>'points')::integer), '{}'::jsonb)
    into v_points from jsonb_array_elements(v_ranking) x where (x->>'points')::integer > 0;
  select coalesce(jsonb_object_agg(x->>'profile_id', 1), '{}'::jsonb)
    into v_exact from jsonb_array_elements(v_ranking) x where (x->>'exact')::boolean;

  v_reveal := jsonb_build_object(
    'round', v_round,
    'question', p_state->'question',
    'answer', v_ans,
    'note', v_q->'note',
    'answers', v_answers,
    'ranking', v_ranking,
    'points', v_points);

  p_state := p_state || jsonb_build_object(
    'phase', 'reveal',
    'deadline', null,
    'scores', (select jsonb_object_agg(key, value::integer + coalesce((v_points->>key)::integer, 0))
                 from jsonb_each_text(p_state->'scores')),
    'exacts', (select jsonb_object_agg(key, value::integer + coalesce((v_exact->>key)::integer, 0))
                 from jsonb_each_text(p_state->'exacts')),
    'last_reveal', v_reveal,
    'history', coalesce(p_state->'history', '[]'::jsonb) || jsonb_build_array(
      v_reveal - 'points' - 'question' || jsonb_build_object(
        'id', v_q->'id', 'theme', v_q->'theme', 'prompt', v_q->'prompt', 'unit', v_q->'unit')));
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Stats de fin de partie pour les trophées (features/trophees.sql) : tout se lit dans history[].ranking.
create or replace function public._lpp_tstats(p_state jsonb, p_pl text)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  with h as (
    select e.o, (e.v->>'answer')::numeric as ans, e.v->'ranking' as rk
      from jsonb_array_elements(coalesce(p_state->'history', '[]'::jsonb)) with ordinality as e(v, o)
  ), m as (
    select h.o, h.ans,
           (select r from jsonb_array_elements(h.rk) r where r->>'profile_id' = p_pl limit 1) as me,
           jsonb_array_length(h.rk) as n,
           (select max((r->>'rank')::integer) from jsonb_array_elements(h.rk) r) as maxrank,
           (select count(*) from jsonb_array_elements(h.rk) r where (r->>'rank')::integer = 1) as nfirst
      from h
  ), x as (
    select m.o, m.ans, m.n, m.maxrank, m.nfirst, (m.me is not null) as ans_ok,
           coalesce((m.me->>'rank')::integer, 0) as rank, coalesce((m.me->>'points')::integer, 0) as pts,
           coalesce((m.me->>'exact')::boolean, false) as exact,
           (m.me->>'value')::numeric as val, (m.me->>'gap')::numeric as gap
      from m
  ), g1 as (
    select x.*, x.o - row_number() over (partition by (x.pts = 0) order by x.o) as grp from x
  ), g2 as (
    select x.*, x.o - row_number() over (partition by (x.rank = 1) order by x.o) as grp from x
  )
  select jsonb_build_object(
    'farthest', (select count(*) from x where ans_ok and n >= 3 and rank = maxrank and rank > 1),
    'way_off', (select count(*) from x where ans_ok and ans <> 0 and (abs(val) >= 10 * abs(ans) or abs(val) <= abs(ans) / 10)),
    'scoreless_run', coalesce((select max(c) from (select count(*) as c from g1 where pts = 0 group by grp) z), 0),
    'closest', (select count(*) from x where rank = 1),
    'seconds', (select count(*) from x where rank = 2),
    'tied_closest', (select count(*) from x where rank = 1 and nfirst >= 2),
    'near_miss', (select count(*) from x where rank = 1 and not exact and ans <> 0 and gap < abs(ans) * 0.01),
    'scored_all', case when (select count(*) from x) >= 8 and not exists (select 1 from x where pts = 0) then 1 else 0 end,
    'closest_run', coalesce((select max(c) from (select count(*) as c from g2 where rank = 1 group by grp) z), 0))
$$;

create or replace function public._lpp_finish(p_state jsonb, p_server jsonb)
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
           'stats', jsonb_build_object('exacts', coalesce((p_state->'exacts'->>t.key)::integer, 0))
                    || public._lpp_tstats(p_state, t.key))
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

create or replace function public.game_le_plus_proche_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_type     text := p_action->>'type';
  v_phase    text := p_state->>'phase';
  v_round    integer := (p_state->>'round')::integer;
  v_total    integer := (p_state->>'total_rounds')::integer;
  v_deadline timestamptz := (p_state->>'deadline')::timestamptz;
  v_me       text := p_actor::text;
  v_same     jsonb := jsonb_build_object('state', p_state, 'server', p_server);
  v_val      numeric;
  v_res      jsonb;
begin
  if v_type is null or v_type not in ('answer', 'reveal', 'next', 'tick') then
    raise exception 'unknown_action';
  end if;
  if v_phase not in ('question', 'reveal') then return v_same; end if;
  if p_action ? 'round' and (p_action->>'round') is distinct from (p_state->>'round') then
    return v_same;
  end if;

  if v_type = 'tick' then
    if v_phase <> 'question' or v_deadline is null or now() < v_deadline then return v_same; end if;
    return public._lpp_reveal(p_state, p_server);

  elsif v_type = 'reveal' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase <> 'question' then return v_same; end if;
    return public._lpp_reveal(p_state, p_server);

  elsif v_type = 'next' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase <> 'reveal' then return v_same; end if;
    if v_round >= v_total then return public._lpp_finish(p_state, p_server); end if;
    return public._lpp_open(p_state, p_server, v_round);
  end if;

  -- answer : {"value": number|null, "round"} ; null = « je ne sais pas ».
  if not (p_state->'players' ? v_me) then raise exception 'not_a_player'; end if;
  if v_phase <> 'question' then return v_same; end if;
  if not (p_action ? 'value') then raise exception 'invalid_number'; end if;
  if jsonb_typeof(p_action->'value') = 'null' then
    v_val := null;
  elsif jsonb_typeof(p_action->'value') = 'number' then
    v_val := public._lpp_num(p_action->'value');
    if v_val is null then raise exception 'number_out_of_range'; end if;
  else
    raise exception 'invalid_number';
  end if;
  -- Échéance dépassée : la saisie tardive n'est pas prise, on révèle.
  if v_deadline is not null and now() >= v_deadline then
    return public._lpp_reveal(p_state, p_server);
  end if;

  p_server := jsonb_set(p_server, array['answers', v_me], coalesce(to_jsonb(v_val), 'null'::jsonb), true);
  if not (p_state->'answered' ? v_me) then
    p_state := jsonb_set(p_state, '{answered}', (p_state->'answered') || to_jsonb(v_me));
  end if;

  if not exists (select 1 from jsonb_array_elements_text(p_state->'players') pl
                  where not (p_state->'answered' ? pl)) then
    v_res := public._lpp_reveal(p_state, p_server);
  else
    v_res := jsonb_build_object('state', p_state, 'server', p_server);
  end if;
  return v_res || jsonb_build_object('secrets', jsonb_build_object(v_me, jsonb_build_object(
    'round', v_round, 'value', v_val, 'answered', true)));
end $$;

revoke all on function public._lpp_num(jsonb) from public, anon, authenticated;
revoke all on function public._lpp_open(jsonb, jsonb, integer) from public, anon, authenticated;
revoke all on function public._lpp_reveal(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._lpp_finish(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._lpp_tstats(jsonb, text) from public, anon, authenticated;
revoke all on function public.game_le_plus_proche_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_le_plus_proche_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;
