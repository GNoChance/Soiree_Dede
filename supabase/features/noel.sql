-- =============================================================================
-- ÉVÉNEMENT DE NOËL « Noël chez Dédé » — idempotent, chargé APRÈS hotte.sql (ordre alphabétique).
-- Spec : docs/superpowers/specs/2026-11-24-noel-event-design.md
-- Édition 'noel-<année>' : du 1er décembre au 6 janvier suivant (dates de Paris).
-- Flocons ❄️ DÉRIVÉS de l'historique (rien à saisir, recalculables) :
--   3 missions du jour (30 chacune, tirage identique pour toute la bande), bonus soirée (30),
--   Hotte du jour (6 par bonne réponse), séries de 3/7/14/21 jours (+30/+70/+140/+210, une fois).
-- Date courante : _season_now() (surchargée par les tests).
-- =============================================================================

-- Date de Paris « maintenant ».
create or replace function public._noel_day()
returns date language sql stable security definer
set search_path = public, extensions
as $$ select (public._season_now() at time zone 'Europe/Paris')::date $$;

-- Édition qui contient ce jour ('noel-2026' du 2026-12-01 au 2027-01-06), sinon null.
create or replace function public._noel_key_for(p_day date)
returns text language sql immutable
as $$
  select case
    when extract(month from p_day) = 12 then 'noel-' || extract(year from p_day)::int
    when extract(month from p_day) = 1 and extract(day from p_day) <= 6 then 'noel-' || (extract(year from p_day)::int - 1)
  end
$$;

create or replace function public._noel_bounds(p_key text, out starts_on date, out ends_on date)
language plpgsql immutable
as $$
declare y integer;
begin
  if p_key is null or p_key !~ '^noel-[0-9]{4}$' then return; end if;
  y := substring(p_key from 6)::int;
  starts_on := make_date(y, 12, 1);
  ends_on := make_date(y + 1, 1, 6);
end $$;

-- Candidats d'un slot, du plus au moins prioritaire : chaque id est répété selon son poids et
-- trié par md5 ; on garde sa 1re occurrence (un poids plus fort sort plus souvent en tête).
create or replace function public._noel_order(p_key text, p_day date, p_slot integer, p_ids text[], p_w integer[])
returns text[] language sql immutable
as $$
  select array_agg(id order by h, id) from (
    select u.id, min(md5(p_key || p_day::text || p_slot::text || u.id || k::text)) h
      from unnest(p_ids, p_w) u(id, w), generate_series(1, u.w) k
     group by u.id) x
$$;

-- Mission « surprise » (slot 3) de chaque jour de l'édition, dans l'ordre des jours. Contraintes :
-- s_advent jusqu'au 24 décembre ; s_challenge et s_shop au plus 1 par semaine ISO, s_card au plus 2 ;
-- jamais la même que la veille.
create or replace function public._noel_surprises(p_key text)
returns text[] language plpgsql stable
as $$
declare
  b      record;
  d      date;
  v_out  text[] := '{}';
  v_days date[] := '{}';
  v_prev text;
  v_pick text;
  c      text;
  v_wk   integer;
begin
  select * into b from public._noel_bounds(p_key);
  if b.starts_on is null then return v_out; end if;
  d := b.starts_on;
  while d <= b.ends_on loop
    v_pick := null;
    foreach c in array public._noel_order(p_key, d, 3,
        array['s_advent', 's_combo', 's_d550', 's_card', 's_challenge', 's_shop'], array[4, 2, 1, 1, 1, 1]) loop
      continue when c = v_prev;
      continue when c = 's_advent' and not (extract(month from d) = 12 and extract(day from d) <= 24);
      select count(*) into v_wk from unnest(v_out, v_days) u(m, dd)
       where u.m = c and date_trunc('week', u.dd) = date_trunc('week', d);
      continue when c in ('s_challenge', 's_shop') and v_wk >= 1;
      continue when c = 's_card' and v_wk >= 2;
      v_pick := c;
      exit;
    end loop;
    v_pick := coalesce(v_pick, case when v_prev = 's_combo' then 's_d550' else 's_combo' end);
    v_out := v_out || v_pick;
    v_days := v_days || d;
    v_prev := v_pick;
    d := d + 1;
  end loop;
  return v_out;
end $$;

-- Slots 1 (Défi) et 2 (Hotte) d'un jour.
create or replace function public._noel_slot12(p_key text, p_day date)
returns text[] language sql immutable
as $$
  select array[
    (public._noel_order(p_key, p_day, 1, array['d_finish', 'd_400', 'd_beat', 'd_morning'], array[2, 2, 1, 1]))[1],
    (public._noel_order(p_key, p_day, 2, array['h_play', 'h_3', 'h_4', 'h_fast'], array[1, 3, 2, 1]))[1]]
$$;

-- Les 3 missions du jour (identiques pour toute la bande). Hors édition : tableau vide.
create or replace function public._noel_missions(p_key text, p_day date)
returns text[] language plpgsql stable
as $$
declare b record;
begin
  select * into b from public._noel_bounds(p_key);
  if b.starts_on is null or p_day < b.starts_on or p_day > b.ends_on then return '{}'; end if;
  return public._noel_slot12(p_key, p_day) || (public._noel_surprises(p_key))[p_day - b.starts_on + 1];
end $$;

-- Mission réussie par ce joueur ce jour-là (date de Paris) ? Sources figées une fois écrites.
create or replace function public._noel_mission_done(p_profile uuid, p_mission text, p_day date)
returns boolean language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  d public.daily_runs%rowtype;
  h public.hotte_runs%rowtype;
begin
  if p_mission like 'd\_%' escape '\' or p_mission in ('s_d550', 's_combo') then
    select * into d from public.daily_runs where profile_id = p_profile and day = p_day and finished_at is not null;
  end if;
  if p_mission like 'h\_%' escape '\' or p_mission = 's_combo' then
    select * into h from public.hotte_runs where profile_id = p_profile and day = p_day and finished_at is not null;
  end if;
  return case p_mission
    when 'd_finish' then d.profile_id is not null
    when 'd_400' then d.profile_id is not null and d.score >= 400
    when 's_d550' then d.profile_id is not null and d.score >= 550
    when 'd_beat' then d.profile_id is not null and d.score > coalesce(
      (select y.score from public.daily_runs y where y.profile_id = p_profile and y.day = p_day - 1 and y.finished_at is not null), -1)
    when 'd_morning' then d.profile_id is not null and (d.finished_at at time zone 'Europe/Paris')::time < time '12:00'
    when 'h_play' then h.profile_id is not null
    when 'h_3' then h.profile_id is not null and h.score >= 3
    when 'h_4' then h.profile_id is not null and h.score >= 4
    when 'h_fast' then h.profile_id is not null and jsonb_array_length(h.answers) = 5
                       and h.last_answer_at - h.started_at < interval '60 seconds'
    when 's_combo' then d.profile_id is not null and h.profile_id is not null
    when 's_advent' then exists (select 1 from public.advent_opens a where a.profile_id = p_profile and a.day = p_day)
    when 's_card' then exists (select 1 from public.custom_cards c where c.author_id = p_profile
                                  and (c.created_at at time zone 'Europe/Paris')::date = p_day)
    when 's_challenge' then exists (select 1 from public.coin_challenges c where c.challenger_id = p_profile
                                       and (c.created_at at time zone 'Europe/Paris')::date = p_day)
    when 's_shop' then exists (select 1 from public.item_purchases i where i.profile_id = p_profile
                                  and (i.bought_at at time zone 'Europe/Paris')::date = p_day)
    else false
  end;
end $$;

-- Bonus soirée : une partie terminée ce jour-là (date de Paris) avec au moins 2 joueurs.
create or replace function public._noel_soiree_bonus(p_profile uuid, p_day date)
returns boolean language sql stable security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from public.match_players mp join public.matches m on m.id = mp.match_id
     where mp.profile_id = p_profile and m.status = 'finished' and m.finished_at is not null
       and (m.finished_at at time zone 'Europe/Paris')::date = p_day
       and (select count(*) from public.match_players x where x.match_id = m.id) >= 2)
$$;

-- Flocons d'un joueur sur une édition (jours jusqu'à aujourd'hui ou la fin de l'édition).
-- -> {total, by_day:{"AAAA-MM-JJ": n}, streak:{current, best}, streak_bonus}
create or replace function public._noel_flakes(p_profile uuid, p_key text)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  b        record;
  v_today  date := public._noel_day();
  v_last   date;
  v_sur    text[];
  d        date;
  m        text;
  v_n      integer;
  v_bonus  boolean;
  v_day    integer;
  v_by     jsonb := '{}'::jsonb;
  v_sum    integer := 0;
  v_run    integer := 0;
  v_prev   integer := 0;
  v_best   integer := 0;
  v_cur    integer := 0;
  v_sb     integer := 0;
  v_isday  boolean := false;
begin
  select * into b from public._noel_bounds(p_key);
  if b.starts_on is null or exists (select 1 from public.profiles where id = p_profile and is_guest) then
    return jsonb_build_object('total', 0, 'by_day', v_by, 'streak', jsonb_build_object('current', 0, 'best', 0), 'streak_bonus', 0);
  end if;
  v_last := least(v_today, b.ends_on);
  v_sur := public._noel_surprises(p_key);
  d := b.starts_on;
  while d <= v_last loop
    v_n := 0;
    foreach m in array (public._noel_slot12(p_key, d) || v_sur[d - b.starts_on + 1]) loop
      if public._noel_mission_done(p_profile, m, d) then v_n := v_n + 1; end if;
    end loop;
    v_bonus := public._noel_soiree_bonus(p_profile, d);
    v_day := 30 * v_n + case when v_bonus then 30 else 0 end
           + 6 * coalesce((select h.score from public.hotte_runs h where h.profile_id = p_profile and h.day = d and h.finished_at is not null), 0);
    if v_day > 0 then v_by := v_by || jsonb_build_object(d::text, v_day); end if;
    v_sum := v_sum + v_day;
    v_isday := v_n > 0 or v_bonus;
    v_prev := v_run;
    v_run := case when v_isday then v_run + 1 else 0 end;
    v_best := greatest(v_best, v_run);
    d := d + 1;
  end loop;
  -- Série en cours : le jour d'aujourd'hui pas encore joué ne la casse pas.
  v_cur := case when v_isday then v_run when v_last = v_today then v_prev else 0 end;
  v_sb := case when v_best >= 3 then 30 else 0 end + case when v_best >= 7 then 70 else 0 end
        + case when v_best >= 14 then 140 else 0 end + case when v_best >= 21 then 210 else 0 end;
  return jsonb_build_object('total', v_sum + v_sb, 'by_day', v_by,
                            'streak', jsonb_build_object('current', v_cur, 'best', v_best), 'streak_bonus', v_sb);
end $$;

revoke all on function public._noel_day() from public, anon, authenticated;
revoke all on function public._noel_key_for(date) from public, anon, authenticated;
revoke all on function public._noel_bounds(text) from public, anon, authenticated;
revoke all on function public._noel_order(text, date, integer, text[], integer[]) from public, anon, authenticated;
revoke all on function public._noel_surprises(text) from public, anon, authenticated;
revoke all on function public._noel_slot12(text, date) from public, anon, authenticated;
revoke all on function public._noel_missions(text, date) from public, anon, authenticated;
revoke all on function public._noel_mission_done(uuid, text, date) from public, anon, authenticated;
revoke all on function public._noel_soiree_bonus(uuid, date) from public, anon, authenticated;
revoke all on function public._noel_flakes(uuid, text) from public, anon, authenticated;
