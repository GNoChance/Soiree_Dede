-- =============================================================================
-- JEU « dede-kart » (Dédé Kart, course de karts 3D, tout le monde en même temps) — idempotent.
-- Dépend de schema.sql (game_action, start_match, finish_match).
--
-- Chaque téléphone simule SON kart (l'hôte simule aussi les bots) et diffuse sa
-- position en broadcast `kart:<matchId>` (jamais en base). Le serveur ne reçoit
-- qu'une action par TOUR BOUCLÉ : {"type":"lap","lap":n} (+ "bot":"botK" envoyé
-- par l'hôte pour ses bots). Il vérifie l'ordre des tours et un temps minimum par
-- tour (anti-triche minimal, jeu entre amis), puis classe et compte les points.
--
-- Phases : racing (go_at = feu vert) -> results (classement de la course, 15 s)
--          -> racing (course suivante) ... -> finished.
-- Course terminée : tous arrivés, 30 s après le 1er arrivé, ou échéance de sécurité.
-- =============================================================================

-- Temps minimum d'un tour (ms) par circuit.
create or replace function public._dk_min_lap_ms(p_track integer)
returns integer language sql immutable
set search_path = public, extensions
as $$ select 12000 $$;

-- Tous les karts : joueurs puis bots.
create or replace function public._dk_racers(p_state jsonb)
returns jsonb language sql immutable
set search_path = public, extensions
as $$ select coalesce(p_state->'players', '[]'::jsonb) || coalesce(p_state->'bots', '[]'::jsonb) $$;

-- Lance la course n° p_race (feu vert dans p_delay secondes).
create or replace function public._dk_new_race(p_state jsonb, p_race integer, p_delay integer)
returns jsonb language plpgsql
set search_path = public, extensions
as $$
declare
  v_go timestamptz := now() + make_interval(secs => p_delay);
begin
  return p_state || jsonb_build_object(
    'phase', 'racing',
    'race', p_race,
    'round', p_race,
    'track', (p_race - 1) % 3,
    'go_at', v_go,
    'deadline', v_go + make_interval(secs => 60 + 75 * (p_state->>'laps')::integer),
    'laps_done', '{}'::jsonb,
    'lap_at', '{}'::jsonb,
    'finish', '{}'::jsonb,
    'arrival', '[]'::jsonb,
    'hazards', '[]'::jsonb,
    'fx', '[]'::jsonb);
end $$;

-- Auteur d'une action : le joueur, ou un bot (champ "bot"). Les bots sont conduits par
-- le premier joueur présent (cf. Play.tsx) : n'importe quel joueur (ou l'hôte) peut agir pour eux.
create or replace function public._dk_actor(p_state jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns text language plpgsql stable
set search_path = public, extensions
as $$
begin
  if p_action ? 'bot' then
    if not (p_is_host or (p_state->'players') ? p_actor::text) then raise exception 'not_a_player'; end if;
    if not ((p_state->'bots') ? (p_action->>'bot')) then raise exception 'invalid_action'; end if;
    return p_action->>'bot';
  end if;
  if not ((p_state->'players') ? p_actor::text) then raise exception 'not_a_player'; end if;
  return p_actor::text;
end $$;

-- Retire boules (> 6 s), flaques (> 30 s) et effets expirés.
create or replace function public._dk_prune(p_state jsonb)
returns jsonb language sql stable
set search_path = public, extensions
as $$
  select p_state || jsonb_build_object(
    'hazards', coalesce((select jsonb_agg(h) from jsonb_array_elements(p_state->'hazards') h
                          where (h->>'at')::timestamptz > now() - case when h->>'type' = 'ball'
                                                                       then interval '6 seconds' else interval '30 seconds' end),
                        '[]'::jsonb),
    'fx', coalesce((select jsonb_agg(f) from jsonb_array_elements(p_state->'fx') f
                     where (f->>'until')::timestamptz > now()), '[]'::jsonb))
$$;

-- Coordonnée envoyée par le client : nombre raisonnable, sinon erreur.
create or replace function public._dk_num(p_v jsonb)
returns numeric language plpgsql immutable
set search_path = public, extensions
as $$
begin
  if p_v is null or jsonb_typeof(p_v) <> 'number' or abs(p_v::text::numeric) > 5000 then
    raise exception 'invalid_action';
  end if;
  return round(p_v::text::numeric, 2);
end $$;

-- Stats de fin de coupe pour les trophées (features/trophees.sql), lues dans standings[] et hits.
-- « karts » = joueurs + bots présents dans la course.
create or replace function public._dk_tstats(p_state jsonb, p_pl text)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  with s as (
    select e.o, (e.v->>'track')::integer as track, e.v->'places' as pl, jsonb_array_length(e.v->'places') as nk,
           (select x from jsonb_array_elements(e.v->'places') x where x->>'id' = p_pl limit 1) as me
      from jsonb_array_elements(coalesce(p_state->'standings', '[]'::jsonb)) with ordinality as e(v, o)
  ), x as (
    select s.o, s.track, s.nk, s.me, (s.me->>'place')::integer as place, (s.me->>'time')::integer as t,
           (select (y->>'time')::integer from jsonb_array_elements(s.pl) y where (y->>'place')::integer = 2 limit 1) as t2
      from s where s.me is not null
  )
  select jsonb_build_object(
    'last_races', count(*) filter (where nk >= 4 and place = nk),
    'dnf', count(*) filter (where me->>'time' is null),
    'podiums', count(*) filter (where nk >= 4 and place <= 3),
    'hits', coalesce((p_state->'hits'->>p_pl)::integer, 0),
    'win_track_1', count(*) filter (where place = 1 and track = 1),
    'win_track_2', count(*) filter (where place = 1 and track = 2),
    'win_track_3', count(*) filter (where place = 1 and track = 3),
    'comeback', (select count(*) from x a join x b on b.o = a.o - 1 where a.place = 1 and b.place > 3),
    'big_lead', count(*) filter (where place = 1 and t is not null and (t2 is null or t2 - t >= 5000)),
    'grand_slam', case when count(*) >= 3 and count(*) filter (where place = 1) = count(*) and max(nk) >= 4 then 1 else 0 end)
  from x
$$;

-- Fin de la coupe : points finaux = total / nombre de courses (arrondi), classement des joueurs.
create or replace function public._dk_finish(p_state jsonb, p_server jsonb, p_forced boolean)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_runs    integer := greatest(1, jsonb_array_length(coalesce(p_state->'standings', '[]'::jsonb)));
  v_last    jsonb := coalesce(p_state->'standings'->-1->'places', '[]'::jsonb);
  v_results jsonb;
  v_winners jsonb;
begin
  select jsonb_agg(jsonb_build_object(
           'profile_id', t.pid,
           'points', round(t.tot::numeric / v_runs)::integer,
           'won', t.rk = 1 and t.tot > 0,
           'placement', t.rk,
           'stats', public._dk_tstats(p_state, t.pid))
         order by t.rk, t.pid)
    into v_results
    from (select x.pid, x.tot,
                 rank() over (order by x.tot desc, x.lastp asc) as rk
            from (select pl as pid,
                         coalesce((p_state->'points'->>pl)::integer, 0) as tot,
                         coalesce((select (e->>'place')::integer from jsonb_array_elements(v_last) e
                                    where e->>'id' = pl), 99) as lastp
                    from jsonb_array_elements_text(p_state->'players') pl) x) t;

  select coalesce(jsonb_agg(r->>'profile_id'), '[]'::jsonb) into v_winners
    from jsonb_array_elements(v_results) r where (r->>'won')::boolean;

  p_state := p_state || jsonb_build_object('phase', 'finished', 'deadline', null, 'forced', p_forced,
                                           'winners', v_winners, 'results', v_results);
  return jsonb_build_object('state', p_state, 'server', p_server, 'results', v_results);
end $$;

-- Fin d'une course : classement (arrivés au temps, puis tours bouclés), points, suite ou fin.
create or replace function public._dk_end_race(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_pts    integer[] := array[15, 12, 10, 8, 7, 6, 5, 4, 3, 2, 1, 0];
  v_places jsonb;
  v_points jsonb := coalesce(p_state->'points', '{}'::jsonb);
  e        jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id', t.rid, 'place', t.rk, 'pts', coalesce(v_pts[t.rk], 0),
                                               'time', t.fin, 'laps', t.done) order by t.rk), '[]'::jsonb)
    into v_places
    from (select r.rid, r.fin, r.done,
                 row_number() over (order by r.fin asc nulls last, r.done desc, r.lat asc nulls last, r.rid) as rk
            from (select x as rid,
                         (p_state->'finish'->>x)::integer as fin,
                         coalesce((p_state->'laps_done'->>x)::integer, 0) as done,
                         (p_state->'lap_at'->>x)::timestamptz as lat
                    from jsonb_array_elements_text(public._dk_racers(p_state)) x) r) t;

  for e in select value from jsonb_array_elements(v_places) loop
    v_points := v_points || jsonb_build_object(e->>'id',
                  coalesce((v_points->>(e->>'id'))::integer, 0) + (e->>'pts')::integer);
  end loop;

  p_state := p_state || jsonb_build_object(
    'points', v_points,
    'standings', coalesce(p_state->'standings', '[]'::jsonb)
                 || jsonb_build_array(jsonb_build_object('race', p_state->'race', 'track', p_state->'track', 'places', v_places)));

  if (p_state->>'race')::integer >= (p_state->>'races')::integer then
    return public._dk_finish(p_state, p_server, false);
  end if;
  p_state := p_state || jsonb_build_object('phase', 'results', 'deadline', now() + interval '15 seconds');
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Options : {"races": 1|3 (défaut 3), "laps": 2|3 (défaut 3), "fill": 0|6|8|12 (bots pour compléter la grille)}
create or replace function public.game_dede_kart_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_n     integer := coalesce(cardinality(p_players), 0);
  v_races integer := case when p_options->>'races' = '1' then 1 else 3 end;
  v_laps  integer := case when p_options->>'laps' = '2' then 2 else 3 end;
  v_fill  integer := case when coalesce(p_options->>'fill', '') ~ '^\d{1,2}$' then (p_options->>'fill')::integer else 0 end;
  v_bots  jsonb;
  v_state jsonb;
begin
  if v_n < 2 then raise exception 'not_enough_players'; end if;
  if v_n > 12 then raise exception 'too_many_players'; end if;
  if v_fill not in (0, 6, 8, 12) then v_fill := 0; end if;

  select coalesce(jsonb_agg('bot' || g order by g), '[]'::jsonb) into v_bots
    from generate_series(1, greatest(0, v_fill - v_n)) g;

  v_state := jsonb_build_object(
    'game', 'dede-kart',
    'players', to_jsonb(p_players),
    'bots', v_bots,
    'laps', v_laps,
    'races', v_races,
    'total_rounds', v_races,
    'points', '{}'::jsonb,
    'standings', '[]'::jsonb,
    'hits', '{}'::jsonb,
    'hz_seq', 0,
    'forced', false,
    'winners', null,
    'results', null);
  -- 8 s : le temps que tous les téléphones chargent la 3D
  return jsonb_build_object('state', public._dk_new_race(v_state, 1, 8), 'server', '{}'::jsonb, 'secrets', '{}'::jsonb);
end $$;

create or replace function public.game_dede_kart_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_type  text := p_action->>'type';
  v_phase text := p_state->>'phase';
  v_id    text;
  v_lap   integer;
  v_done  integer;
  v_prev  timestamptz;
  v_item  text;
  v_seq   integer;
  v_target text;
  v_owner text;
  v_late  boolean := p_state->>'deadline' is not null and now() >= (p_state->>'deadline')::timestamptz;
begin
  -- ---------------------------------------------------------------- lap
  if v_type = 'lap' then
    -- tour arrivé après la fin de la course : ignoré sans erreur
    if v_phase <> 'racing' then return jsonb_build_object('state', p_state, 'server', p_server); end if;
    if v_late then return public._dk_end_race(p_state, p_server); end if;
    if now() < (p_state->>'go_at')::timestamptz then raise exception 'too_early'; end if;
    v_id := public._dk_actor(p_state, p_actor, p_is_host, p_action);
    if coalesce(p_action->>'lap', '') !~ '^\d{1,2}$' then raise exception 'invalid_action'; end if;
    v_lap := (p_action->>'lap')::integer;
    v_done := coalesce((p_state->'laps_done'->>v_id)::integer, 0);
    -- doublon (réseau) ou déjà arrivé : ignoré
    if v_lap <= v_done or (p_state->'finish') ? v_id then
      return jsonb_build_object('state', p_state, 'server', p_server);
    end if;
    if v_lap <> v_done + 1 then
      -- bot repris par un autre téléphone : compteur décalé, ignoré sans erreur
      if p_action ? 'bot' then return jsonb_build_object('state', p_state, 'server', p_server); end if;
      raise exception 'wrong_lap';
    end if;
    v_prev := coalesce((p_state->'lap_at'->>v_id)::timestamptz, (p_state->>'go_at')::timestamptz);
    if now() - v_prev < make_interval(secs => public._dk_min_lap_ms((p_state->>'track')::integer) / 1000.0) then
      raise exception 'too_fast';
    end if;

    p_state := p_state || jsonb_build_object(
      'laps_done', p_state->'laps_done' || jsonb_build_object(v_id, v_lap),
      'lap_at', p_state->'lap_at' || jsonb_build_object(v_id, now()));
    if v_lap >= (p_state->>'laps')::integer then
      p_state := p_state || jsonb_build_object(
        'finish', p_state->'finish' || jsonb_build_object(v_id,
                    floor(extract(epoch from now() - (p_state->>'go_at')::timestamptz) * 1000)::integer),
        'arrival', p_state->'arrival' || to_jsonb(v_id));
      if jsonb_array_length(p_state->'arrival') = 1 then
        p_state := p_state || jsonb_build_object('deadline',
                     least((p_state->>'deadline')::timestamptz, now() + interval '30 seconds'));
      end if;
      if jsonb_array_length(p_state->'arrival') >= jsonb_array_length(public._dk_racers(p_state)) then
        return public._dk_end_race(p_state, p_server);
      end if;
    end if;
    return jsonb_build_object('state', p_state, 'server', p_server);

  -- ---------------------------------------------------------------- use (objet qui touche les autres)
  -- Le tirage se fait sur le téléphone (jeu entre amis) : le serveur pose le piège /
  -- le projectile, ou les effets sur les cibles, pour que tout le monde voie la même chose.
  elsif v_type = 'use' then
    if v_phase <> 'racing' or now() < (p_state->>'go_at')::timestamptz then
      return jsonb_build_object('state', p_state, 'server', p_server);
    end if;
    v_id := public._dk_actor(p_state, p_actor, p_is_host, p_action);
    v_item := p_action->>'item';
    if v_item is null or v_item not in ('ball', 'glue', 'cloud', 'confetti', 'reverse') then raise exception 'invalid_action'; end if;
    if (p_state->'finish') ? v_id then return jsonb_build_object('state', p_state, 'server', p_server); end if;
    p_state := public._dk_prune(p_state);
    v_seq := coalesce((p_state->>'hz_seq')::integer, 0);
    if v_item in ('ball', 'glue') then
      v_seq := v_seq + 1;
      p_state := p_state || jsonb_build_object('hazards', p_state->'hazards' || jsonb_build_array(jsonb_build_object(
        'id', v_seq, 'type', v_item, 'owner', v_id,
        'x', public._dk_num(p_action->'x'), 'z', public._dk_num(p_action->'z'), 'h', public._dk_num(p_action->'h'),
        'at', now())));
    else
      if jsonb_typeof(p_action->'targets') <> 'array' then raise exception 'invalid_action'; end if;
      for v_target in
        select distinct t from jsonb_array_elements_text(p_action->'targets') t
         where public._dk_racers(p_state) ? t and t <> v_id limit 11
      loop
        v_seq := v_seq + 1;
        p_state := p_state || jsonb_build_object('fx', p_state->'fx' || jsonb_build_array(jsonb_build_object(
          'id', v_seq, 'type', v_item, 'target', v_target, 'by', v_id, 'until', now() + interval '3 seconds')));
      end loop;
    end if;
    return jsonb_build_object('state', p_state || jsonb_build_object('hz_seq', v_seq), 'server', p_server);

  -- ---------------------------------------------------------------- hit (un kart a percuté une boule / une glue)
  elsif v_type = 'hit' then
    if v_phase <> 'racing' then return jsonb_build_object('state', p_state, 'server', p_server); end if;
    v_id := public._dk_actor(p_state, p_actor, p_is_host, p_action);
    if coalesce(p_action->>'hazard', '') !~ '^\d{1,6}$' then raise exception 'invalid_action'; end if;
    select h->>'owner' into v_owner from jsonb_array_elements(p_state->'hazards') h
     where (h->>'id')::integer = (p_action->>'hazard')::integer;
    -- déjà retiré (deux karts dans la même flaque) : ignoré
    if v_owner is null then return jsonb_build_object('state', p_state, 'server', p_server); end if;
    p_state := p_state || jsonb_build_object(
      'hazards', coalesce((select jsonb_agg(h) from jsonb_array_elements(p_state->'hazards') h
                            where (h->>'id')::integer <> (p_action->>'hazard')::integer), '[]'::jsonb));
    if v_owner <> v_id then
      p_state := p_state || jsonb_build_object('hits', coalesce(p_state->'hits', '{}'::jsonb)
                   || jsonb_build_object(v_owner, coalesce((p_state->'hits'->>v_owner)::integer, 0) + 1));
    end if;
    return jsonb_build_object('state', public._dk_prune(p_state), 'server', p_server);

  -- ---------------------------------------------------------------- tick
  elsif v_type = 'tick' then
    if v_late and v_phase = 'racing' then return public._dk_end_race(p_state, p_server); end if;
    if v_late and v_phase = 'results' then
      return jsonb_build_object('state', public._dk_new_race(p_state, (p_state->>'race')::integer + 1, 6), 'server', p_server);
    end if;
    return jsonb_build_object('state', p_state, 'server', p_server);

  -- ---------------------------------------------------------------- next (hôte, sans attendre)
  elsif v_type = 'next' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase <> 'results' then return jsonb_build_object('state', p_state, 'server', p_server); end if;
    return jsonb_build_object('state', public._dk_new_race(p_state, (p_state->>'race')::integer + 1, 6), 'server', p_server);

  -- ---------------------------------------------------------------- end_game (hôte)
  elsif v_type = 'end_game' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase not in ('racing', 'results') then raise exception 'wrong_phase'; end if;
    return public._dk_finish(p_state, p_server, true);

  else
    raise exception 'unknown_action';
  end if;
end $$;

revoke all on function public._dk_min_lap_ms(integer) from public, anon, authenticated;
revoke all on function public._dk_racers(jsonb) from public, anon, authenticated;
revoke all on function public._dk_actor(jsonb, uuid, boolean, jsonb) from public, anon, authenticated;
revoke all on function public._dk_prune(jsonb) from public, anon, authenticated;
revoke all on function public._dk_num(jsonb) from public, anon, authenticated;
revoke all on function public._dk_new_race(jsonb, integer, integer) from public, anon, authenticated;
revoke all on function public._dk_finish(jsonb, jsonb, boolean) from public, anon, authenticated;
revoke all on function public._dk_tstats(jsonb, text) from public, anon, authenticated;
revoke all on function public._dk_end_race(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.game_dede_kart_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_dede_kart_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;
