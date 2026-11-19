-- =============================================================================
-- JEU « mini-golf » (Mini-golf 3D, « La Kermesse du village ») — idempotent.
-- Dépend de schema.sql (game_action, start_match, finish_match).
-- Conception : docs/superpowers/specs/2026-11-19-mini-golf-design.md.
--
-- Tout le monde joue LE MÊME TROU en même temps, chacun sa balle sur son téléphone
-- (physique 3D côté client, positions diffusées en broadcast `golf:<matchId>`, jamais
-- en base). Le serveur ne reçoit qu'UNE écriture par joueur et par trou :
--   {"type":"hole","hole":h,"strokes":n,"holed":true|false,"stats":{water,mill_hits,bank_shot}}
-- h = index (0-based) du trou dans state.holes. Rentrée : 1 ≤ n ≤ 6 ; non rentrée (6 coups
-- joués) : score 7. Temps minimum (anti-triche minimal) : (n − balles à l'eau) × 1,5 s depuis
-- hole_started_at (fin de l'annonce du trou). Doublon : ignoré sans erreur.
--
-- Phases : playing (trou h, chrono `timer` s, 0 = sans chrono) -> hole_end (6 s, classement
-- provisoire) -> playing (trou h+1) ... ; au dernier trou : finished directement.
-- Trou terminé : tous ont fini, échéance du chrono (absents = 7), ou `next` de l'hôte.
-- =============================================================================

-- Parcours « La Kermesse du village » : par de chaque trou (ids 1..9) et parcours express.
-- Dupliqué avec src/games/mini-golf/holes.ts (synchro vérifiée par tools/sql-tests/mini-golf.mjs).
create or replace function public._mg_course()
returns jsonb language sql immutable
set search_path = public, extensions
as $$ select '{"pars":[2,2,3,3,3,3,3,3,4],"express":[1,3,5,8,9]}'::jsonb $$;

-- Score d'un trou non rentré (balle ramassée, chrono écoulé, fin forcée).
create or replace function public._mg_max_score()
returns integer language sql immutable
set search_path = public, extensions
as $$ select 7 $$;

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
    v_card := v_card || to_jsonb(public._mg_max_score());
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
      p_state := public._mg_record(p_state, pl, public._mg_max_score());
    end if;
  end loop;
  if (p_state->>'hole')::integer >= jsonb_array_length(p_state->'holes') - 1 then
    return public._mg_finish(p_state, p_server, false);
  end if;
  p_state := p_state || jsonb_build_object('phase', 'hole_end', 'deadline', now() + interval '6 seconds');
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Options : {"holes": 9|5 (5 = parcours express 1,3,5,8,9), "timer": 60|90|0 secondes par trou (0 = sans chrono)}
create or replace function public.game_mini_golf_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_course jsonb := public._mg_course();
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

  v_count := case when coalesce(p_options->>'holes', '') ~ '^\d{1,2}$' then (p_options->>'holes')::integer else 9 end;
  if v_count not in (5, 9) then v_count := 9; end if;
  v_timer := case when coalesce(p_options->>'timer', '') ~ '^\d{1,3}$' then (p_options->>'timer')::integer else 90 end;
  if v_timer not in (0, 60, 90) then v_timer := 90; end if;

  v_holes := case when v_count = 5 then v_course->'express'
                  else (select jsonb_agg(i) from generate_series(1, 9) i) end;
  select jsonb_agg(v_course->'pars'->((h::integer) - 1) order by o) into v_pars
    from jsonb_array_elements_text(v_holes) with ordinality t(h, o);
  select jsonb_object_agg(p::text, '[]'::jsonb), jsonb_object_agg(p::text, 0) into v_empty, v_zero from unnest(p_players) p;

  v_state := jsonb_build_object(
    'game', 'mini-golf',
    'players', to_jsonb(p_players),
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
    if v_strokes < 1 or v_strokes > (case when v_holed then 6 else 7 end) then raise exception 'invalid_strokes'; end if;

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

    v_score := case when v_holed then v_strokes else public._mg_max_score() end;
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
          p_state := public._mg_record(p_state, pl, public._mg_max_score());
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
revoke all on function public._mg_max_score() from public, anon, authenticated;
revoke all on function public._mg_open_hole(jsonb, integer) from public, anon, authenticated;
revoke all on function public._mg_bump(jsonb, text, text, integer) from public, anon, authenticated;
revoke all on function public._mg_record(jsonb, text, integer) from public, anon, authenticated;
revoke all on function public._mg_tstats(jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public._mg_finish(jsonb, jsonb, boolean) from public, anon, authenticated;
revoke all on function public._mg_close_hole(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.game_mini_golf_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_mini_golf_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;
