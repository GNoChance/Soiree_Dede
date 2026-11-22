-- =============================================================================
-- DEFI DU JOUR (lot E) — idempotent, execute APRES schema.sql (features/*).
-- Un defi solo identique pour tous (tirage deterministe cote client a partir de
-- la date `day`, fuseau Europe/Paris), une seule tentative par joueur et par jour.
--
-- Le contenu (questions) vit dans les banques du front : le serveur NE recalcule PAS
-- le score (jeu entre amis) mais garantit : 1 seule tentative (start_daily), 1 seule
-- soumission, fenetre de 10 min entre start et submit, 6 manches, points de chaque
-- manche bornes (_daily_round_max), XP plafonnee.
-- Tolerance aux interruptions : chaque manche jouee est enregistree au fil de l'eau (save_daily_round).
-- Une tentative interrompue (appli rechargee, reseau coupe...) n'est pas perdue : au bout de 10 min
-- (_daily_close_expired, appelee par daily_today / daily_board / daily_week_board) ou tout de suite
-- (finish_daily), elle est cloturee avec les manches deja jouees.
-- Bareme (miroir de src/features/daily/scoring.ts) : manches 1-4 QCM max 100, manche 5
-- estimation max 100, manche 6 bonus max 200 -> total max 700. XP = min(score/10, 50).
-- =============================================================================

create table if not exists public.daily_runs (
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  day         date not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  score       integer not null default 0,
  answers     jsonb not null default '[]'::jsonb,
  primary key (profile_id, day)
);
create index if not exists daily_runs_day_idx on public.daily_runs(day, score desc) where finished_at is not null;

alter table public.daily_runs enable row level security;
drop policy if exists daily_runs_select on public.daily_runs;
create policy daily_runs_select on public.daily_runs for select to authenticated using (true);
-- Aucune policy d'ecriture : tout passe par les RPC security definer.

create or replace function public._daily_day()
returns date language sql stable
as $$ select (now() at time zone 'Europe/Paris')::date $$;

-- Plafond de points par manche (anti-triche grossiere).
create or replace function public._daily_round_max(p_idx integer)
returns integer language sql immutable
as $$ select case when p_idx = 5 then 200 else 100 end $$;

-- Score d'une liste de manches [{points, ms}] : chaque manche bornee par _daily_round_max.
create or replace function public._daily_score(p_answers jsonb)
returns integer language sql immutable
as $$
  select coalesce(sum(least(greatest(coalesce((e.v->>'points')::integer, 0), 0), public._daily_round_max((e.i - 1)::integer))), 0)::integer
    from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb)) with ordinality as e(v, i)
   where e.i <= 6
$$;

-- Cloture les tentatives commencees depuis plus de 10 min et jamais soumises : score = manches
-- deja enregistrees (0 si aucune), XP creditee une seule fois (le UPDATE ne voit que les non terminees).
create or replace function public._daily_close_expired()
returns void language plpgsql security definer
set search_path = public, extensions
as $$
declare r record;
begin
  for r in
    update public.daily_runs d
       set finished_at = now(), score = public._daily_score(d.answers)
     where d.finished_at is null and d.started_at < now() - interval '10 minutes'
    returning d.profile_id, d.score
  loop
    update public.profiles set xp = xp + least(r.score / 10, 50) where id = r.profile_id;
  end loop;
end $$;

-- Serie de jours consecutifs termines, finissant aujourd'hui ou hier.
create or replace function public._daily_streak(p_profile uuid)
returns integer language sql stable security definer
set search_path = public, extensions
as $$
  with d as (
    select day from public.daily_runs where profile_id = p_profile and finished_at is not null
  ), st as (
    select case when exists (select 1 from d where day = public._daily_day()) then public._daily_day()
                when exists (select 1 from d where day = public._daily_day() - 1) then public._daily_day() - 1
           end as s
  )
  select coalesce((
    select count(*)::int from d, st
     where st.s is not null and d.day <= st.s
       and d.day > coalesce((
             select max(g.day) from (
               select generate_series(st.s - 400, st.s, interval '1 day')::date as day
             ) g where not exists (select 1 from d d2 where d2.day = g.day)), st.s - 400)
  ), 0)
$$;

-- Etat du joueur : {day, status: todo|running|done|missed, score, rank, players, streak, secs_left}
create or replace function public.daily_today()
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me  uuid := public._require_profile();
  v_day date := public._daily_day();
  r     public.daily_runs%rowtype;
  v_status text := 'todo';
  v_rank integer; v_n integer;
begin
  perform public._daily_close_expired();
  select * into r from public.daily_runs where profile_id = v_me and day = v_day;
  if found then
    if r.finished_at is not null then v_status := 'done';
    elsif now() < r.started_at + interval '10 minutes' then v_status := 'running';
    else v_status := 'missed'; end if;
  end if;
  select count(*)::int into v_n from public.daily_runs where day = v_day and finished_at is not null;
  if v_status = 'done' then
    select 1 + count(*)::int into v_rank from public.daily_runs
     where day = v_day and finished_at is not null and score > r.score;
  end if;
  return jsonb_build_object(
    'day', v_day, 'status', v_status, 'score', case when v_status = 'done' then r.score end,
    'rank', v_rank, 'players', v_n, 'streak', public._daily_streak(v_me),
    'secs_left', case when v_status = 'running'
                      then greatest(0, extract(epoch from (r.started_at + interval '10 minutes' - now()))::int) end);
end $$;

-- Demarre la tentative du jour. Erreurs : daily_already_started.
create or replace function public.start_daily()
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me  uuid := public._require_profile();
  v_day date := public._daily_day();
begin
  insert into public.daily_runs(profile_id, day) values (v_me, v_day)
  on conflict (profile_id, day) do nothing;
  if not found then raise exception 'daily_already_started'; end if;
  return jsonb_build_object('day', v_day);
end $$;

-- Soumet les reponses : p_answers = [{points:int, ms:int, ...} x6]. Renvoie
-- {score, xp, rank, players, streak}. Erreurs : daily_not_started, daily_already_done,
-- daily_expired (> 10 min apres start : score 0 enregistre), invalid_answers.
create or replace function public.submit_daily(p_answers jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me  uuid := public._require_profile();
  v_day date := public._daily_day();
  r     public.daily_runs%rowtype;
  v_score integer := 0; v_pts integer; v_xp integer; v_rank integer; v_n integer; i integer;
begin
  select * into r from public.daily_runs where profile_id = v_me and day = v_day for update;
  if not found then raise exception 'daily_not_started'; end if;
  if r.finished_at is not null then raise exception 'daily_already_done'; end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'array' or jsonb_array_length(p_answers) <> 6 then
    raise exception 'invalid_answers';
  end if;
  if now() > r.started_at + interval '10 minutes' then
    -- trop tard : la tentative est cloturee avec les manches deja enregistrees
    perform public._daily_close_expired();
    select * into r from public.daily_runs where profile_id = v_me and day = v_day;
    select 1 + count(*)::int into v_rank from public.daily_runs
     where day = v_day and finished_at is not null and score > r.score;
    select count(*)::int into v_n from public.daily_runs where day = v_day and finished_at is not null;
    return jsonb_build_object('score', r.score, 'xp', least(r.score / 10, 50), 'expired', true,
                              'rank', v_rank, 'players', v_n, 'streak', public._daily_streak(v_me));
  end if;
  for i in 0..5 loop
    begin
      v_pts := (p_answers->i->>'points')::integer;
    exception when others then raise exception 'invalid_answers';
    end;
    if v_pts is null then raise exception 'invalid_answers'; end if;
    v_score := v_score + least(greatest(v_pts, 0), public._daily_round_max(i));
  end loop;
  v_xp := least(v_score / 10, 50);
  update public.daily_runs set finished_at = now(), score = v_score, answers = p_answers
   where profile_id = v_me and day = v_day;
  update public.profiles set xp = xp + v_xp where id = v_me;
  select 1 + count(*)::int into v_rank from public.daily_runs
   where day = v_day and finished_at is not null and score > v_score;
  select count(*)::int into v_n from public.daily_runs where day = v_day and finished_at is not null;
  return jsonb_build_object('score', v_score, 'xp', v_xp, 'rank', v_rank, 'players', v_n,
                            'streak', public._daily_streak(v_me));
end $$;

-- Enregistre la manche p_idx (0..5) au fil de l'eau. Dans l'ordre, sans trou ; une manche deja
-- enregistree est ignoree (nouvel essai apres une coupure reseau) ; points bornes par manche.
-- Erreurs : daily_not_started, daily_already_done (terminee ou expiree), invalid_answers.
create or replace function public.save_daily_round(p_idx integer, p_points integer, p_ms integer)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me  uuid := public._require_profile();
  v_day date := public._daily_day();
  r     public.daily_runs%rowtype;
  v_len integer;
begin
  perform public._daily_close_expired();
  select * into r from public.daily_runs where profile_id = v_me and day = v_day for update;
  if not found then raise exception 'daily_not_started'; end if;
  if r.finished_at is not null then raise exception 'daily_already_done'; end if;
  v_len := jsonb_array_length(r.answers);
  if p_idx is null or p_idx < 0 or p_idx > 5 or p_idx > v_len or p_points is null then
    raise exception 'invalid_answers';
  end if;
  if p_idx < v_len then return; end if;
  update public.daily_runs
     set answers = answers || jsonb_build_array(jsonb_build_object(
           'points', least(greatest(p_points, 0), public._daily_round_max(p_idx)),
           'ms', greatest(coalesce(p_ms, 0), 0)))
   where profile_id = v_me and day = v_day;
end $$;

-- Termine la tentative du jour MAINTENANT avec les manches deja enregistrees (appli rechargee
-- en cours de defi). Renvoie {score, xp, rank, players, streak, partial}.
-- Erreurs : daily_not_started, daily_already_done.
create or replace function public.finish_daily()
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me  uuid := public._require_profile();
  v_day date := public._daily_day();
  r     public.daily_runs%rowtype;
  v_score integer; v_xp integer; v_rank integer; v_n integer;
begin
  perform public._daily_close_expired();
  select * into r from public.daily_runs where profile_id = v_me and day = v_day for update;
  if not found then raise exception 'daily_not_started'; end if;
  if r.finished_at is not null then raise exception 'daily_already_done'; end if;
  v_score := public._daily_score(r.answers);
  v_xp := least(v_score / 10, 50);
  update public.daily_runs set finished_at = now(), score = v_score where profile_id = v_me and day = v_day;
  update public.profiles set xp = xp + v_xp where id = v_me;
  select 1 + count(*)::int into v_rank from public.daily_runs
   where day = v_day and finished_at is not null and score > v_score;
  select count(*)::int into v_n from public.daily_runs where day = v_day and finished_at is not null;
  return jsonb_build_object('score', v_score, 'xp', v_xp, 'rank', v_rank, 'players', v_n,
                            'streak', public._daily_streak(v_me), 'partial', true);
end $$;

-- Classement d'un jour (defaut : aujourd'hui)
-- -> {day, rows:[{profile_id, slug, nickname, equipped_tenue, score, rank, streak}]}
create or replace function public.daily_board(p_day date default null)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare v_day date := coalesce(p_day, public._daily_day());
begin
  perform public._require_profile();
  perform public._daily_close_expired();
  return jsonb_build_object('day', v_day, 'rows', coalesce((
    select jsonb_agg(jsonb_build_object(
             'profile_id', x.profile_id, 'slug', p.slug, 'nickname', p.nickname,
             'equipped_tenue', p.equipped_tenue, 'score', x.score, 'rank', x.rk,
             'streak', public._daily_streak(x.profile_id)) order by x.rk, x.finished_at)
      from (select r.*, rank() over (order by r.score desc) as rk
              from public.daily_runs r where r.day = v_day and r.finished_at is not null) x
      join public.profiles p on p.id = x.profile_id), '[]'::jsonb));
end $$;

-- Classement de la semaine en cours (lundi -> dimanche, somme des scores)
-- -> {week_start, rows:[{..., score, days, rank, streak}]}
create or replace function public.daily_week_board()
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare v_start date := date_trunc('week', public._daily_day()::timestamp)::date;
begin
  perform public._require_profile();
  perform public._daily_close_expired();
  return jsonb_build_object('week_start', v_start, 'rows', coalesce((
    select jsonb_agg(jsonb_build_object(
             'profile_id', x.profile_id, 'slug', p.slug, 'nickname', p.nickname,
             'equipped_tenue', p.equipped_tenue, 'score', x.total, 'days', x.days, 'rank', x.rk,
             'streak', public._daily_streak(x.profile_id)) order by x.rk, p.sort_order)
      from (select s.*, rank() over (order by s.total desc) as rk
              from (select r.profile_id, sum(r.score)::int as total, count(*)::int as days
                      from public.daily_runs r
                     where r.day >= v_start and r.day < v_start + 7 and r.finished_at is not null
                     group by r.profile_id) s) x
      join public.profiles p on p.id = x.profile_id), '[]'::jsonb));
end $$;

revoke all on function public._daily_day() from public, anon, authenticated;
revoke all on function public._daily_round_max(integer) from public, anon, authenticated;
revoke all on function public._daily_streak(uuid) from public, anon, authenticated;
revoke all on function public.daily_today() from public, anon;
revoke all on function public.start_daily() from public, anon;
revoke all on function public.submit_daily(jsonb) from public, anon;
revoke all on function public._daily_score(jsonb) from public, anon, authenticated;
revoke all on function public._daily_close_expired() from public, anon, authenticated;
revoke all on function public.save_daily_round(integer, integer, integer) from public, anon;
revoke all on function public.finish_daily() from public, anon;
revoke all on function public.daily_board(date) from public, anon;
revoke all on function public.daily_week_board() from public, anon;
grant execute on function public.daily_today() to authenticated;
grant execute on function public.start_daily() to authenticated;
grant execute on function public.submit_daily(jsonb) to authenticated;
grant execute on function public.save_daily_round(integer, integer, integer) to authenticated;
grant execute on function public.finish_daily() to authenticated;
grant execute on function public.daily_board(date) to authenticated;
grant execute on function public.daily_week_board() to authenticated;

-- =============================================================================
-- CALENDRIER DE L'AVENT (Noel) : du 1er au 24 decembre, terminer le defi du jour (daily_runs.finished_at)
-- rend la case du jour OUVRABLE ; l'ouvrir (advent_open) donne +25 XP, une seule fois. Une case dont le defi
-- n'a pas ete termine reste fermee (pas de rattrapage). Les textes surprise vivent dans le front.
-- advent_opens : une ligne = une case ouverte. Trophee « Esprit de Noel » (gen_esprit_noel) = 12 cases ouvertes.
-- =============================================================================
create table if not exists public.advent_opens (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  day        date not null,
  opened_at  timestamptz not null default now(),
  primary key (profile_id, day)
);
alter table public.advent_opens enable row level security;
drop policy if exists advent_opens_select on public.advent_opens;
create policy advent_opens_select on public.advent_opens for select to authenticated using (true);
-- Aucune policy d'ecriture : tout passe par advent_open.

-- Etat du calendrier : {today, year, opened:[dates], done:[dates de defis termines du 1er au 24 dec]}
create or replace function public.advent_state()
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me  uuid := public._require_profile();
  v_today date := public._daily_day();
  v_year integer := extract(year from v_today)::int - case when extract(month from v_today) = 12 then 0 else 1 end;
  v_from date := make_date(v_year, 12, 1);
begin
  perform public._daily_close_expired();
  return jsonb_build_object(
    'today', v_today, 'year', v_year,
    'opened', coalesce((select jsonb_agg(a.day order by a.day) from public.advent_opens a
                         where a.profile_id = v_me and a.day >= v_from and a.day <= v_from + 23), '[]'::jsonb),
    'done', coalesce((select jsonb_agg(r.day order by r.day) from public.daily_runs r
                       where r.profile_id = v_me and r.finished_at is not null
                         and r.day >= v_from and r.day <= v_from + 23), '[]'::jsonb));
end $$;

-- Ouvre la case p_day. Renvoie {day, xp, new, count, trophy, gifts} (xp = 0 si deja ouverte ; count = cases
-- ouvertes cette annee ; gifts = objets nouvellement obtenus, cf. features/cadeaux.sql).
-- Erreurs : advent_invalid_day (hors 1-24 dec), advent_not_yet (jour futur), advent_closed (apres le 6 janvier),
-- advent_missed (defi de ce jour non termine).
create or replace function public.advent_open(p_day date)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me  uuid := public._require_profile();
  v_today date := public._daily_day();
  v_new boolean := false; v_n integer; v_trophy boolean := false; v_gifts jsonb := '[]'::jsonb;
  v_from date := make_date(extract(year from p_day)::int, 12, 1);
begin
  if p_day is null or extract(month from p_day) <> 12 or extract(day from p_day) > 24 then
    raise exception 'advent_invalid_day';
  end if;
  if p_day > v_today then raise exception 'advent_not_yet'; end if;
  if v_today > make_date(extract(year from p_day)::int, 12, 31) + 6 then raise exception 'advent_closed'; end if;
  perform public._daily_close_expired();
  if not exists (select 1 from public.daily_runs where profile_id = v_me and day = p_day and finished_at is not null)
     and not exists (select 1 from public.advent_opens where profile_id = v_me and day = p_day) then
    raise exception 'advent_missed';
  end if;
  insert into public.advent_opens(profile_id, day) values (v_me, p_day) on conflict do nothing;
  v_new := found;
  if v_new then
    update public.profiles set xp = xp + 25 where id = v_me;
    v_trophy := public.evaluate_trophy(v_me, 'gen_esprit_noel');
  end if;
  select count(*)::int into v_n from public.advent_opens where profile_id = v_me and day between v_from and v_from + 23;
  v_gifts := public._advent_gifts(v_me, p_day, v_n);
  return jsonb_build_object('day', p_day, 'xp', case when v_new then 25 else 0 end, 'new', v_new,
                            'count', v_n, 'trophy', v_trophy, 'gifts', v_gifts);
end $$;

-- Rattrapage idempotent : cadeaux des cases deja ouvertes (cases ouvertes avant l'arrivee des cadeaux).
do $$
declare r record;
begin
  for r in select a.profile_id, a.day,
                  (select count(*)::int from public.advent_opens b where b.profile_id = a.profile_id
                     and b.day between make_date(extract(year from a.day)::int, 12, 1) and a.day) as n
             from public.advent_opens a
  loop
    perform public._advent_gifts(r.profile_id, r.day, r.n);
  end loop;
end $$;

revoke all on function public.advent_state() from public, anon;
revoke all on function public.advent_open(date) from public, anon;
grant execute on function public.advent_state() to authenticated;
grant execute on function public.advent_open(date) to authenticated;
