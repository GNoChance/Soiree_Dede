-- =============================================================================
-- NOTIFICATION « <hote> t'invite a sa soiree ! » — idempotent, execute APRES push.sql
-- (ordre alphabetique de features/).
--
-- Circuit : trigger sur soiree_players (joueur ajoute par l'hote) -> ligne dans
-- push_invites (une seule par joueur et par soiree = anti-spam, meme si l'hote le
-- retire puis le reinvite) -> pg_net POST <invite_url> (Bearer <secret>) -> fonction
-- Vercel api/soiree-invite.ts -> push_invite_claim() (cle service role) -> web-push
-- -> push_report(). Jamais bloquant : toute erreur (pg_net absent...) = simple NOTICE.
--
-- Configuration : RIEN de plus si push_config.reminder_url est deja rempli (l'URL
-- d'invitation en est deduite en remplacant « daily-reminder » par « soiree-invite »).
-- URL personnalisee : update public.push_config set invite_url = 'https://TON-APP.vercel.app/api/soiree-invite';
-- Cote Vercel : redeployer (la route api/soiree-invite.ts utilise les memes variables
-- d'environnement que le rappel du defi). Verifier : select * from public.push_invites;
-- =============================================================================

alter table public.push_config add column if not exists invite_url text;

-- Preferences push par joueur (defaut : on me previent quand on m'invite).
create table if not exists public.push_prefs (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  invites    boolean not null default true
);
alter table public.push_prefs enable row level security;
revoke all on table public.push_prefs from anon, authenticated;

-- File d'attente + memoire anti-doublon des invitations.
create table if not exists public.push_invites (
  soiree_id  uuid not null references public.soirees(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  host_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  sent_at    timestamptz,
  primary key (soiree_id, profile_id)
);
alter table public.push_invites enable row level security;
revoke all on table public.push_invites from anon, authenticated;

create or replace function public.get_push_prefs()
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare v_me uuid := public._require_profile();
begin
  return jsonb_build_object('invites',
    coalesce((select invites from public.push_prefs where profile_id = v_me), true));
end $$;

create or replace function public.set_push_invites(p_enabled boolean)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
declare v_me uuid := public._require_profile();
begin
  insert into public.push_prefs(profile_id, invites) values (v_me, coalesce(p_enabled, true))
  on conflict (profile_id) do update set invites = excluded.invites;
end $$;

-- Trigger : un joueur (autre que l'hote) rejoint une soiree.
create or replace function public._push_invite_trg()
returns trigger language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_host   uuid;
  v_status text;
  c        public.push_config%rowtype;
  v_url    text;
  v_rows   integer;
begin
  begin
    select host_id, status into v_host, v_status from public.soirees where id = new.soiree_id;
    if v_host is null or v_host = new.profile_id or v_status = 'ended' then return new; end if;
    insert into public.push_invites(soiree_id, profile_id, host_id) values (new.soiree_id, new.profile_id, v_host)
      on conflict do nothing;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then return new; end if;
    select * into c from public.push_config where id;
    v_url := coalesce(nullif(c.invite_url, ''), replace(nullif(c.reminder_url, ''), 'daily-reminder', 'soiree-invite'));
    if not found or v_url is null or coalesce(c.secret, '') = '' then
      raise notice 'push_config incomplete : invitation non notifiee';
      return new;
    end if;
    perform net.http_post(
      url := v_url,
      body := '{}'::jsonb,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || c.secret),
      timeout_milliseconds := 30000);
  exception when others then
    raise notice 'invitation push non envoyee (%)', sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists push_invite_trg on public.soiree_players;
create trigger push_invite_trg after insert on public.soiree_players
  for each row execute function public._push_invite_trg();

-- Fonction Vercel : reclame (atomiquement) les invitations en attente et renvoie les
-- appareils a notifier (preference activee, soiree ouverte, invitation de moins de 10 min).
-- -> [{endpoint, p256dh, auth, profile_id, host_nick, soiree_id}]
create or replace function public.push_invite_claim()
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare v_rows jsonb;
begin
  delete from public.push_invites where created_at < now() - interval '60 days';
  with claimed as (
    update public.push_invites i set sent_at = now()
     where i.sent_at is null
    returning i.soiree_id, i.profile_id, i.host_id, i.created_at
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth, 'profile_id', c.profile_id,
           'host_nick', h.nickname, 'soiree_id', c.soiree_id)), '[]'::jsonb)
    into v_rows
    from claimed c
    join public.soirees so on so.id = c.soiree_id and so.status <> 'ended'
    join public.profiles h on h.id = c.host_id
    join public.push_subscriptions s on s.profile_id = c.profile_id
   where c.created_at > now() - interval '10 minutes'
     and coalesce((select p.invites from public.push_prefs p where p.profile_id = c.profile_id), true);
  return v_rows;
end $$;

revoke all on function public.get_push_prefs() from public, anon;
revoke all on function public.set_push_invites(boolean) from public, anon;
revoke all on function public._push_invite_trg() from public, anon, authenticated;
revoke all on function public.push_invite_claim() from public, anon, authenticated;
grant execute on function public.get_push_prefs() to authenticated;
grant execute on function public.set_push_invites(boolean) to authenticated;
grant execute on function public.push_invite_claim() to service_role;
