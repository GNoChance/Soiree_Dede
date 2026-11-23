-- =============================================================================
-- JEU « bowling » (Bowling 3D, tout le monde joue en même temps) — idempotent.
-- Dépend de schema.sql (game_action, start_match, finish_match).
--
-- Chaque joueur joue SA partie sur son téléphone (physique 3D côté client),
-- puis envoie le résultat de chaque lancer : {"type":"roll","frame":f,"roll":r,
-- "pins_down_mask":m}. Le masque m (0..1023, bit i = quille n° i+1) liste les
-- quilles tombées PENDANT ce lancer. Le serveur vérifie la cohérence (ordre des
-- lancers, m ⊆ quilles debout, 10 max) et calcule LUI-MÊME le score officiel
-- (même logique que src/games/bowling/scoring.ts).
--
-- Anti-triche : minimal (jeu entre amis). Le serveur ne peut pas vérifier la
-- physique : un client modifié peut envoyer des strikes à volonté. Il garantit
-- seulement une feuille de score légale et un score correctement calculé.
--
-- Phases : playing -> finished (tous ont fini, échéance globale atteinte, ou
-- l'hôte termine : lancers manquants = 0).
-- =============================================================================

-- Nombre de quilles d'un masque (bits 0..9).
create or replace function public._bw_count(p_mask integer)
returns integer language sql immutable
set search_path = public, extensions
as $$ select count(*)::integer from generate_series(0, 9) b where (coalesce(p_mask, 0) >> b) & 1 = 1 $$;

-- Frame terminée ? (p_last : dernière frame = règles de la 10e)
create or replace function public._bw_frame_complete(p_frame jsonb, p_last boolean)
returns boolean language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_len integer := coalesce(jsonb_array_length(p_frame), 0);
  c1 integer;
  c2 integer;
begin
  if v_len = 0 then return false; end if;
  c1 := public._bw_count((p_frame->>0)::integer);
  if not p_last then return v_len >= 2 or c1 = 10; end if;
  if v_len < 2 then return false; end if;
  if v_len >= 3 then return true; end if;
  c2 := public._bw_count((p_frame->>1)::integer);
  return c1 + c2 < 10;
end $$;

-- Quilles debout avant le prochain lancer d'une frame non terminée.
create or replace function public._bw_standing(p_frame jsonb, p_last boolean)
returns integer language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_len integer := coalesce(jsonb_array_length(p_frame), 0);
  m1 integer;
  m2 integer;
begin
  if v_len = 0 then return 1023; end if;
  m1 := (p_frame->>0)::integer;
  if not p_last then return 1023 & ~m1; end if;
  if v_len = 1 then
    return case when public._bw_count(m1) = 10 then 1023 else 1023 & ~m1 end;
  end if;
  m2 := (p_frame->>1)::integer;
  if public._bw_count(m1) = 10 then
    return case when public._bw_count(m2) = 10 then 1023 else 1023 & ~m2 end;
  end if;
  return 1023;  -- spare : quilles relevées
end $$;

-- Prochain lancer attendu {frame, roll, standing} (1-based) ou null si fini.
create or replace function public._bw_next(p_sheet jsonb, p_n integer)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  f integer;
  v_frame jsonb;
begin
  for f in 0 .. p_n - 1 loop
    v_frame := coalesce(p_sheet->f, '[]'::jsonb);
    if not public._bw_frame_complete(v_frame, f = p_n - 1) then
      return jsonb_build_object('frame', f + 1, 'roll', jsonb_array_length(v_frame) + 1,
                                'standing', public._bw_standing(v_frame, f = p_n - 1));
    end if;
  end loop;
  return null;
end $$;

-- Ajoute le masque p_mask à la frame p_frame (1-based).
create or replace function public._bw_add(p_sheet jsonb, p_frame integer, p_mask integer)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_sheet jsonb := coalesce(p_sheet, '[]'::jsonb);
begin
  while jsonb_array_length(v_sheet) < p_frame loop
    v_sheet := v_sheet || '[[]]'::jsonb;
  end loop;
  return jsonb_set(v_sheet, array[(p_frame - 1)::text],
                   (v_sheet->(p_frame - 1)) || to_jsonb(p_mask));
end $$;

-- Complète une feuille avec des lancers à 0 (fin forcée).
create or replace function public._bw_fill(p_sheet jsonb, p_n integer)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_sheet jsonb := coalesce(p_sheet, '[]'::jsonb);
  v_next jsonb;
begin
  loop
    v_next := public._bw_next(v_sheet, p_n);
    exit when v_next is null;
    v_sheet := public._bw_add(v_sheet, (v_next->>'frame')::integer, 0);
  end loop;
  return v_sheet;
end $$;

-- Score officiel : {total (bonus non joués = 0), cum: [cumul | null par frame]}.
create or replace function public._bw_score(p_sheet jsonb, p_n integer)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_flat    integer[] := '{}';
  v_start   integer[] := '{}';
  v_counts  integer[];
  v_frame   jsonb;
  f         integer;
  i         integer;
  v_len     integer;
  v_score   integer;
  v_partial integer;
  v_running integer := 0;
  v_total   integer := 0;
  v_broken  boolean := false;
  v_cum     jsonb := '[]'::jsonb;
  m         jsonb;
begin
  for f in 0 .. p_n - 1 loop
    v_start := v_start || (cardinality(v_flat) + 1);  -- index 1-based dans v_flat
    for m in select value from jsonb_array_elements(coalesce(p_sheet->f, '[]'::jsonb)) loop
      v_flat := v_flat || public._bw_count((m #>> '{}')::integer);
    end loop;
  end loop;

  for f in 0 .. p_n - 1 loop
    v_frame := coalesce(p_sheet->f, '[]'::jsonb);
    v_len := jsonb_array_length(v_frame);
    i := v_start[f + 1];
    v_counts := v_flat[i : i + v_len - 1];
    v_partial := coalesce((select sum(x) from unnest(v_counts) x), 0);
    v_score := null;
    if f < p_n - 1 then
      if v_len >= 1 and v_counts[1] = 10 then
        v_partial := 10 + coalesce(v_flat[i + 1], 0) + coalesce(v_flat[i + 2], 0);
        if v_flat[i + 1] is not null and v_flat[i + 2] is not null then v_score := v_partial; end if;
      elsif v_len >= 2 and v_counts[1] + v_counts[2] = 10 then
        v_partial := 10 + coalesce(v_flat[i + 2], 0);
        if v_flat[i + 2] is not null then v_score := v_partial; end if;
      elsif v_len >= 2 then
        v_score := v_partial;
      end if;
    elsif public._bw_frame_complete(v_frame, true) then
      v_score := v_partial;
    end if;
    v_total := v_total + v_partial;
    if v_score is null then v_broken := true; end if;
    if not v_broken then
      v_running := v_running + v_score;
      v_cum := v_cum || to_jsonb(v_running);
    else
      v_cum := v_cum || 'null'::jsonb;
    end if;
  end loop;
  return jsonb_build_object('total', v_total, 'cum', v_cum);
end $$;

-- Recalcule scores / cumuls / prochain lancer / joueurs finis.
create or replace function public._bw_refresh(p_state jsonb)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_n      integer := (p_state->>'frames')::integer;
  pl       text;
  v_sheet  jsonb;
  v_sc     jsonb;
  v_next   jsonb;
  v_scores jsonb := '{}'::jsonb;
  v_cum    jsonb := '{}'::jsonb;
  v_nexts  jsonb := '{}'::jsonb;
  v_done   jsonb := '[]'::jsonb;
begin
  for pl in select x from jsonb_array_elements_text(p_state->'players') x loop
    v_sheet := coalesce(p_state->'sheets'->pl, '[]'::jsonb);
    v_sc := public._bw_score(v_sheet, v_n);
    v_next := public._bw_next(v_sheet, v_n);
    v_scores := v_scores || jsonb_build_object(pl, v_sc->'total');
    v_cum := v_cum || jsonb_build_object(pl, v_sc->'cum');
    v_nexts := v_nexts || jsonb_build_object(pl, coalesce(v_next, 'null'::jsonb));
    if v_next is null then v_done := v_done || to_jsonb(pl); end if;
  end loop;
  return p_state || jsonb_build_object('scores', v_scores, 'cum', v_cum, 'next', v_nexts, 'done', v_done);
end $$;

-- Stats de fin de partie pour les trophées (features/trophees.sql). p_sheet = feuille COMPLÉTÉE,
-- p_raw = feuille brute (gouttières : seuls les vrais lancers comptent, pas les 0 de remplissage).
create or replace function public._bw_tstats(p_sheet jsonb, p_n integer, p_raw jsonb)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  f int; fr jsonb; c1 int; c2 int; c3 int; len int; l boolean;
  v_strikes int := 0; v_spares int := 0; v_one int := 0; v_resc int := 0; v_gut int := 0;
  v_clean boolean := true; v_run int := 0; v_best int := 0; v_ev int[] := '{}'; e int;
begin
  for f in 0 .. p_n - 1 loop
    fr := coalesce(p_sheet->f, '[]'::jsonb);
    len := jsonb_array_length(fr);
    c1 := case when len >= 1 then public._bw_count((fr->>0)::integer) end;
    c2 := case when len >= 2 then public._bw_count((fr->>1)::integer) end;
    c3 := case when len >= 3 then public._bw_count((fr->>2)::integer) end;
    l := f = p_n - 1;
    if c1 is null then v_clean := false; v_ev := v_ev || 0; continue; end if;
    if not l then
      if c1 = 10 then v_strikes := v_strikes + 1; v_ev := v_ev || 1;
      else
        v_ev := v_ev || 0;
        if coalesce(c1 + c2, 0) = 10 then v_spares := v_spares + 1; if c1 = 0 then v_resc := v_resc + 1; end if;
        else v_clean := false; if coalesce(c1 + c2, 0) = 9 then v_one := v_one + 1; end if;
        end if;
      end if;
    else
      if c1 = 10 then
        v_strikes := v_strikes + 1; v_ev := v_ev || 1;
        if c2 = 10 then
          v_strikes := v_strikes + 1; v_ev := v_ev || 1;
          if c3 = 10 then v_strikes := v_strikes + 1; v_ev := v_ev || 1; else v_ev := v_ev || 0; end if;
        else
          v_ev := v_ev || 0;
          if coalesce(c2 + c3, 0) = 10 then v_spares := v_spares + 1; end if;
        end if;
      else
        v_ev := v_ev || 0;
        if coalesce(c1 + c2, 0) = 10 then
          v_spares := v_spares + 1; if c1 = 0 then v_resc := v_resc + 1; end if;
          if c3 = 10 then v_strikes := v_strikes + 1; v_ev := v_ev || 1; else v_ev := v_ev || 0; end if;
        else
          v_clean := false; if coalesce(c1 + c2, 0) = 9 then v_one := v_one + 1; end if;
        end if;
      end if;
    end if;
  end loop;
  foreach e in array v_ev loop
    v_run := case when e = 1 then v_run + 1 else 0 end;
    v_best := greatest(v_best, v_run);
  end loop;
  -- gouttières : lancers réellement joués à 0 quille
  select count(*) into v_gut
    from jsonb_array_elements(coalesce(p_raw, '[]'::jsonb)) fx, jsonb_array_elements(fx) m
   where public._bw_count((m #>> '{}')::integer) = 0;
  return jsonb_build_object('strikes', v_strikes, 'spares', v_spares, 'one_left', v_one, 'rescues', v_resc,
                            'gutters', v_gut, 'strike_run', v_best,
                            'clean', case when v_clean and p_n >= 5 then 1 else 0 end);
end $$;

-- Fin de partie : feuilles complétées par des 0, classement, résultats.
-- points = round(score / 30) (300 -> 10 pts -> 100 XP) ; gagnant(s) = meilleur
-- score (ex-aequo inclus), à condition d'avoir marqué au moins 1 quille.
create or replace function public._bw_finish(p_state jsonb, p_server jsonb, p_forced boolean)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_n       integer := (p_state->>'frames')::integer;
  v_sheets  jsonb := '{}'::jsonb;
  pl        text;
  v_max     integer;
  v_results jsonb;
  v_winners jsonb;
  v_raw     jsonb := coalesce(p_state->'sheets', '{}'::jsonb);
begin
  for pl in select x from jsonb_array_elements_text(p_state->'players') x loop
    v_sheets := v_sheets || jsonb_build_object(pl, public._bw_fill(p_state->'sheets'->pl, v_n));
  end loop;
  p_state := public._bw_refresh(p_state || jsonb_build_object('sheets', v_sheets));

  select coalesce(max(value::integer), 0) into v_max from jsonb_each_text(p_state->'scores');

  select jsonb_agg(jsonb_build_object(
           'profile_id', t.key,
           'points', round(t.value::integer / 30.0)::integer,
           'won', v_max > 0 and t.value::integer = v_max,
           'placement', t.r,
           'stats', jsonb_build_object('score', t.value::integer, 'frames', v_n)
                    || public._bw_tstats(p_state->'sheets'->t.key, v_n, v_raw->t.key))
         order by t.r, t.key)
    into v_results
    from (select key, value, rank() over (order by value::integer desc) as r
            from jsonb_each_text(p_state->'scores')) t;

  select coalesce(jsonb_agg(key order by key), '[]'::jsonb) into v_winners
    from jsonb_each_text(p_state->'scores') where v_max > 0 and value::integer = v_max;

  p_state := p_state || jsonb_build_object('phase', 'finished', 'forced', p_forced,
                                           'winners', v_winners, 'results', v_results);
  return jsonb_build_object('state', p_state, 'server', p_server, 'results', v_results);
end $$;

-- Options : {"frames": 3|5|10 (défaut 5), "time_limit": 0|5|10|15|20 minutes (0 = sans limite)}
create or replace function public.game_bowling_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_frames integer;
  v_limit  integer;
  v_empty  jsonb;
  v_state  jsonb;
begin
  -- 2 joueurs minimum : en solo, la victoire serait automatique (tenue Bowler « farmable »).
  if coalesce(cardinality(p_players), 0) < 2 then raise exception 'not_enough_players'; end if;
  if cardinality(p_players) > 9 then raise exception 'too_many_players'; end if;

  v_frames := case when coalesce(p_options->>'frames', '') ~ '^\d{1,2}$'
                   then (p_options->>'frames')::integer else 5 end;
  if v_frames not in (3, 5, 10) then v_frames := 5; end if;
  v_limit := case when coalesce(p_options->>'time_limit', '') ~ '^\d{1,2}$'
                  then (p_options->>'time_limit')::integer else 0 end;
  if v_limit not in (0, 5, 10, 15, 20) then v_limit := 0; end if;

  select jsonb_object_agg(p::text, '[]'::jsonb) into v_empty from unnest(p_players) p;

  v_state := jsonb_build_object(
    'game', 'bowling',
    'phase', 'playing',
    'players', to_jsonb(p_players),
    'frames', v_frames,
    'time_limit', v_limit,
    'started_at', now(),
    'deadline', case when v_limit > 0 then to_jsonb(now() + make_interval(mins => v_limit)) else 'null'::jsonb end,
    'idle_deadline', null,
    'sheets', v_empty,
    'last_roll', null,
    'forced', false,
    'winners', null,
    'results', null);

  return jsonb_build_object('state', public._bw_refresh(v_state), 'server', '{}'::jsonb, 'secrets', '{}'::jsonb);
end $$;

create or replace function public.game_bowling_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_type    text := p_action->>'type';
  v_phase   text := p_state->>'phase';
  v_me      text := p_actor::text;
  v_n       integer := (p_state->>'frames')::integer;
  v_frame   integer;
  v_roll    integer;
  v_mask    integer;
  v_sheet   jsonb;
  v_prev    jsonb;
  v_next    jsonb;
  v_stand   integer;
  v_cnt     integer;
  v_kind    text;
  v_late    boolean := p_state->>'deadline' is not null
                       and now() >= (p_state->>'deadline')::timestamptz;
begin
  -- ---------------------------------------------------------------- roll
  if v_type = 'roll' then
    if v_phase <> 'playing' then raise exception 'wrong_phase'; end if;
    if not ((p_state->'players') ? v_me) then raise exception 'not_a_player'; end if;
    if jsonb_typeof(p_action->'frame') is distinct from 'number'
       or jsonb_typeof(p_action->'roll') is distinct from 'number'
       or jsonb_typeof(p_action->'pins_down_mask') is distinct from 'number'
       or (p_action->>'frame') !~ '^\d{1,2}$' or (p_action->>'roll') !~ '^\d$' then
      raise exception 'invalid_action';
    end if;
    if (p_action->>'pins_down_mask') !~ '^\d{1,4}$' then raise exception 'invalid_roll'; end if;
    v_frame := (p_action->>'frame')::integer;
    v_roll  := (p_action->>'roll')::integer;
    v_mask  := (p_action->>'pins_down_mask')::integer;
    if v_mask > 1023 then raise exception 'invalid_roll'; end if;

    -- Échéance globale dépassée (tolérance réseau 3 s) : fin de partie, lancer ignoré.
    if v_late and now() > (p_state->>'deadline')::timestamptz + interval '3 seconds' then
      return public._bw_finish(p_state, p_server, true);
    end if;
    if p_state->>'idle_deadline' is not null
       and now() > (p_state->>'idle_deadline')::timestamptz + interval '3 seconds' then
      return public._bw_finish(p_state, p_server, true);
    end if;

    v_sheet := coalesce(p_state->'sheets'->v_me, '[]'::jsonb);
    v_prev := v_sheet->(v_frame - 1)->(v_roll - 1);
    if v_frame >= 1 and v_roll >= 1 and v_prev is not null then
      -- Renvoi du même lancer (réseau) : idempotent ; sinon réécriture interdite.
      if (v_prev #>> '{}')::integer = v_mask then
        return jsonb_build_object('state', p_state, 'server', p_server);
      end if;
      raise exception 'wrong_roll';
    end if;
    v_next := public._bw_next(v_sheet, v_n);
    if v_next is null then raise exception 'already_done'; end if;
    if (v_next->>'frame')::integer <> v_frame or (v_next->>'roll')::integer <> v_roll then
      raise exception 'wrong_roll';
    end if;
    v_stand := (v_next->>'standing')::integer;
    if (v_mask & ~v_stand & 1023) <> 0 then raise exception 'invalid_roll'; end if;

    v_cnt := public._bw_count(v_mask);
    v_kind := case when v_cnt = 0 then 'zero'
                   when v_stand = 1023 and v_cnt = 10 then 'strike'
                   when v_stand <> 1023 and v_mask = v_stand then 'spare'
                   else 'normal' end;

    p_state := jsonb_set(p_state, array['sheets', v_me], public._bw_add(v_sheet, v_frame, v_mask), true);
    p_state := public._bw_refresh(p_state) || jsonb_build_object('last_roll', jsonb_build_object(
      'player', v_me, 'frame', v_frame, 'roll', v_roll, 'mask', v_mask, 'pins', v_cnt,
      'kind', v_kind, 'at', now()));

    if jsonb_array_length(p_state->'done') >= jsonb_array_length(p_state->'players') then
      return public._bw_finish(p_state, p_server, false);
    end if;
    -- Il ne reste qu'un joueur : fin automatique 90 s apres son dernier lancer
    -- (veille, 3D plantee...). Chaque lancer du retardataire repousse l'echeance.
    if jsonb_array_length(p_state->'done') >= jsonb_array_length(p_state->'players') - 1 then
      p_state := p_state || jsonb_build_object('idle_deadline', to_jsonb(now() + interval '90 seconds'));
    end if;
    return jsonb_build_object('state', p_state, 'server', p_server);

  -- ---------------------------------------------------------------- tick
  elsif v_type = 'tick' then
    if v_phase = 'playing' and (v_late or (p_state->>'idle_deadline' is not null
                                           and now() >= (p_state->>'idle_deadline')::timestamptz)) then
      return public._bw_finish(p_state, p_server, true);
    end if;
    return jsonb_build_object('state', p_state, 'server', p_server);

  -- ---------------------------------------------------------------- end_game
  elsif v_type = 'end_game' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase <> 'playing' then raise exception 'wrong_phase'; end if;
    return public._bw_finish(p_state, p_server, true);

  else
    raise exception 'unknown_action';
  end if;
end $$;

revoke all on function public._bw_count(integer) from public, anon, authenticated;
revoke all on function public._bw_frame_complete(jsonb, boolean) from public, anon, authenticated;
revoke all on function public._bw_standing(jsonb, boolean) from public, anon, authenticated;
revoke all on function public._bw_next(jsonb, integer) from public, anon, authenticated;
revoke all on function public._bw_add(jsonb, integer, integer) from public, anon, authenticated;
revoke all on function public._bw_fill(jsonb, integer) from public, anon, authenticated;
revoke all on function public._bw_score(jsonb, integer) from public, anon, authenticated;
revoke all on function public._bw_refresh(jsonb) from public, anon, authenticated;
revoke all on function public._bw_finish(jsonb, jsonb, boolean) from public, anon, authenticated;
revoke all on function public._bw_tstats(jsonb, integer, jsonb) from public, anon, authenticated;
revoke all on function public.game_bowling_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_bowling_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;
