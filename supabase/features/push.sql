-- =============================================================================
-- NOTIFICATIONS PUSH : rappel du defi du jour a 18 h (Europe/Paris) — idempotent,
-- execute APRES daily.sql (ordre alphabetique de features/).
--
-- Circuit : pg_cron (toutes les heures a :00) -> _push_daily_tick() -> si heure de
-- Paris = 18 : pg_net POST https://<app>/api/daily-reminder (Bearer <secret>) ->
-- fonction Vercel -> push_daily_reminder_targets() (cle service role) -> web-push ->
-- push_report() (purge des abonnements morts 404/410).
--
-- Configuration (UNE FOIS, dans le SQL Editor, avec TES valeurs ; jamais dans le depot) :
--   insert into public.push_config (id, reminder_url, secret)
--   values (true, 'https://TON-APP.vercel.app/api/daily-reminder', 'LE_MEME_SECRET_QUE_PUSH_CRON_SECRET')
--   on conflict (id) do update set reminder_url = excluded.reminder_url, secret = excluded.secret, updated_at = now();
-- Test immediat (ignore l'heure, envoie a tous ceux qui n'ont pas joue aujourd'hui) :
--   select public._push_daily_tick(true);
-- =============================================================================

create table if not exists public.push_subscriptions (
  id                bigint generated always as identity primary key,
  profile_id        uuid not null references public.profiles(id) on delete cascade,
  endpoint          text not null unique,
  p256dh            text not null,
  auth              text not null,
  user_agent        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  last_ok_at        timestamptz,
  -- Jour (Paris) du dernier rappel envoye : evite les doublons si l'URL est rappelee.
  last_reminded_day date
);
create index if not exists push_subscriptions_profile_idx on public.push_subscriptions(profile_id);
alter table public.push_subscriptions enable row level security;
-- Aucune policy : acces uniquement via les RPC security definer.
revoke all on table public.push_subscriptions from anon, authenticated;

-- Config privee du declencheur (une seule ligne). Lue par _push_daily_tick().
create table if not exists public.push_config (
  id           boolean primary key default true check (id),
  reminder_url text,
  secret       text,
  updated_at   timestamptz not null default now()
);
alter table public.push_config enable row level security;
revoke all on table public.push_config from anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC joueurs
-- ---------------------------------------------------------------------------

-- Enregistre (ou rattache au joueur courant) l'abonnement push de CET appareil.
-- Plusieurs appareils par joueur (10 max : les plus anciens sont oublies).
-- Erreur : invalid_subscription.
create or replace function public.save_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
declare v_me uuid := public._require_profile();
begin
  if p_endpoint is null or p_endpoint !~ '^https://' or char_length(p_endpoint) > 1024
     or coalesce(char_length(p_p256dh), 0) not between 20 and 200
     or coalesce(char_length(p_auth), 0) not between 8 and 100 then
    raise exception 'invalid_subscription';
  end if;
  insert into public.push_subscriptions as s (profile_id, endpoint, p256dh, auth, user_agent)
  values (v_me, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent,
        updated_at = now(),
        last_reminded_day = case when s.profile_id = excluded.profile_id then s.last_reminded_day end,
        profile_id = excluded.profile_id;
  delete from public.push_subscriptions
   where profile_id = v_me
     and id not in (select id from public.push_subscriptions where profile_id = v_me
                     order by updated_at desc limit 10);
end $$;

-- Desabonne CET appareil (sans erreur s'il n'etait pas enregistre).
create or replace function public.delete_push_subscription(p_endpoint text)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
declare v_me uuid := public._require_profile();
begin
  delete from public.push_subscriptions where endpoint = p_endpoint and profile_id = v_me;
end $$;

-- ---------------------------------------------------------------------------
-- RPC service role (fonction Vercel api/daily-reminder.ts)
-- ---------------------------------------------------------------------------

-- Abonnements des joueurs SANS tentative aujourd'hui (une tentative commencee mais
-- non terminee ne peut plus etre rejouee : inutile de rappeler) et pas encore rappeles
-- aujourd'hui. p_claim = true : marque last_reminded_day (anti-doublon, atomique).
-- -> [{endpoint, p256dh, auth, profile_id, nickname, streak}]
create or replace function public.push_daily_reminder_targets(p_claim boolean default true)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_day date := public._daily_day();
  v_ids bigint[];
begin
  select coalesce(array_agg(s.id), '{}') into v_ids
    from public.push_subscriptions s
   where s.last_reminded_day is distinct from v_day
     and not exists (select 1 from public.daily_runs r where r.profile_id = s.profile_id and r.day = v_day);
  if p_claim then
    update public.push_subscriptions set last_reminded_day = v_day where id = any(v_ids);
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth, 'profile_id', s.profile_id,
             'nickname', p.nickname, 'streak', public._daily_streak(s.profile_id)))
      from public.push_subscriptions s join public.profiles p on p.id = s.profile_id
     where s.id = any(v_ids)), '[]'::jsonb);
end $$;

-- Abonnements d'un joueur (par slug), pour tester l'envoi sans condition.
create or replace function public.push_test_targets(p_slug text)
returns jsonb language sql stable security definer
set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth, 'profile_id', s.profile_id,
           'nickname', p.nickname, 'streak', public._daily_streak(s.profile_id))), '[]'::jsonb)
    from public.push_subscriptions s join public.profiles p on p.id = s.profile_id
   where p.slug = lower(btrim(p_slug))
$$;

-- Compte rendu d'envoi : p_ok -> last_ok_at ; p_dead (404/410) -> supprimes.
create or replace function public.push_report(p_ok text[], p_dead text[])
returns void language plpgsql security definer
set search_path = public, extensions
as $$
begin
  update public.push_subscriptions set last_ok_at = now() where endpoint = any(coalesce(p_ok, '{}'));
  delete from public.push_subscriptions where endpoint = any(coalesce(p_dead, '{}'));
end $$;

-- ---------------------------------------------------------------------------
-- Declencheur horaire (pg_cron + pg_net)
-- ---------------------------------------------------------------------------

-- Appele toutes les heures a :00 ; n'agit qu'a 18 h heure de Paris (ete comme hiver).
-- p_force = true : ignore l'heure (test manuel depuis le SQL Editor).
create or replace function public._push_daily_tick(p_force boolean default false)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
declare c public.push_config%rowtype;
begin
  if not p_force and extract(hour from (now() at time zone 'Europe/Paris')) <> 18 then return; end if;
  select * into c from public.push_config where id;
  if not found or coalesce(c.reminder_url, '') = '' or coalesce(c.secret, '') = '' then
    raise notice 'push_config incomplete : rappel du defi non envoye';
    return;
  end if;
  begin
    perform net.http_post(
      url := c.reminder_url,
      body := '{}'::jsonb,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || c.secret),
      timeout_milliseconds := 60000);
  exception when others then
    raise notice 'pg_net indisponible (%) : rappel du defi non envoye', sqlerrm;
  end;
end $$;

revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
revoke all on function public.delete_push_subscription(text) from public, anon;
revoke all on function public.push_daily_reminder_targets(boolean) from public, anon, authenticated;
revoke all on function public.push_test_targets(text) from public, anon, authenticated;
revoke all on function public.push_report(text[], text[]) from public, anon, authenticated;
revoke all on function public._push_daily_tick(boolean) from public, anon, authenticated;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.delete_push_subscription(text) to authenticated;
grant execute on function public.push_daily_reminder_targets(boolean) to service_role;
grant execute on function public.push_test_targets(text) to service_role;
grant execute on function public.push_report(text[], text[]) to service_role;

-- Jobs « push-daily-reminder » (toutes les heures a :00) et sa purge d'historique.
-- Tolerant : sans pg_net / pg_cron, simple NOTICE (le rappel peut alors etre declenche
-- par n'importe quel planificateur externe appelant l'URL avec le secret).
do $$
begin
  begin
    create extension if not exists pg_net;
  exception when others then
    raise notice 'pg_net indisponible (%) : rappel push a declencher depuis l''exterieur', sqlerrm;
  end;
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron indisponible (%) : rappel push a declencher depuis l''exterieur', sqlerrm;
    return;
  end;
  begin
    perform cron.unschedule(j.jobid) from cron.job j
      where j.jobname in ('push-daily-reminder', 'push-daily-reminder-purge');
    perform cron.schedule('push-daily-reminder', '0 * * * *', 'select public._push_daily_tick()');
    perform cron.schedule('push-daily-reminder-purge', '23 4 * * *',
      $job$delete from cron.job_run_details
            where end_time < now() - interval '7 days'
              and jobid in (select jobid from cron.job where jobname = 'push-daily-reminder')$job$);
  exception when others then
    raise notice 'planification pg_cron impossible (%) : rappel push non planifie', sqlerrm;
  end;
end $$;
