-- =============================================================================
-- DEFI DU JOUR (lot E) — idempotent, execute APRES schema.sql (features/*).
-- Un defi solo identique pour tous (tirage deterministe cote client a partir de
-- la date `day`, fuseau Europe/Paris), une seule tentative par joueur et par jour.
--
-- Le contenu (questions) vit dans les banques du front : le serveur NE recalcule PAS
-- le score (jeu entre amis) mais garantit : 1 seule tentative (start_daily), 1 seule
-- soumission, fenetre de 10 min entre start et submit, 6 manches, points de chaque
-- manche bornes (_daily_round_max), XP plafonnee.
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
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_me  uuid := public._require_profile();
  v_day date := public._daily_day();
  r     public.daily_runs%rowtype;
  v_status text := 'todo';
  v_rank integer; v_n integer;
begin
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
    update public.daily_runs set finished_at = now(), score = 0 where profile_id = v_me and day = v_day;
    return jsonb_build_object('score', 0, 'xp', 0, 'expired', true);
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

-- Classement d'un jour (defaut : aujourd'hui)
-- -> {day, rows:[{profile_id, slug, nickname, equipped_tenue, score, rank, streak}]}
create or replace function public.daily_board(p_day date default null)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare v_day date := coalesce(p_day, public._daily_day());
begin
  perform public._require_profile();
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
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare v_start date := date_trunc('week', public._daily_day()::timestamp)::date;
begin
  perform public._require_profile();
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
revoke all on function public.daily_board(date) from public, anon;
revoke all on function public.daily_week_board() from public, anon;
grant execute on function public.daily_today() to authenticated;
grant execute on function public.start_daily() to authenticated;
grant execute on function public.submit_daily(jsonb) to authenticated;
grant execute on function public.daily_board(date) to authenticated;
grant execute on function public.daily_week_board() to authenticated;
