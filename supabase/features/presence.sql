-- =============================================================================
-- PRÉSENCE (« en ligne » / « vu il y a… ») — idempotent. Tant que l'app est à l'écran, le
-- téléphone d'un membre appelle ping_presence() toutes les minutes ; band_presence() renvoie
-- la dernière activité de chaque membre de la bande (page Amis, profil). « En ligne » = vu il y
-- a moins de 2 min (calculé côté front avec l'horloge serveur).
-- Table à part (pas une colonne de profiles) : un ping par minute ne doit pas réveiller les
-- abonnements Realtime aux profils. Pas de policy RLS : accès uniquement via les RPC.
-- Invités : ni ping, ni lecture (_require_member), jamais dans la liste.
-- Erreurs : not_authenticated, not_logged_in, guest_forbidden.
-- =============================================================================

create table if not exists public.presence (
  profile_id   uuid primary key references public.profiles(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);
alter table public.presence enable row level security;

create or replace function public.ping_presence()
returns void language plpgsql security definer
set search_path = public, extensions
as $$
declare v_me uuid := public._require_member();
begin
  -- Pas plus d'une écriture toutes les 20 s par personne (plusieurs onglets / retours d'arrière-plan).
  insert into public.presence(profile_id, last_seen_at) values (v_me, now())
  on conflict (profile_id) do update set last_seen_at = excluded.last_seen_at
   where public.presence.last_seen_at < now() - interval '20 seconds';
end $$;

-- -> [{profile_id, last_seen_at}] des membres de la bande déjà vus (les invités jamais).
create or replace function public.band_presence()
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
begin
  perform public._require_member();
  return coalesce((
    select jsonb_agg(jsonb_build_object('profile_id', pr.profile_id, 'last_seen_at', pr.last_seen_at)
                     order by pr.last_seen_at desc)
      from public.presence pr join public.profiles p on p.id = pr.profile_id
     where not p.is_guest), '[]'::jsonb);
end $$;

revoke all on function public.ping_presence() from public, anon;
revoke all on function public.band_presence() from public, anon;
grant execute on function public.ping_presence() to authenticated;
grant execute on function public.band_presence() to authenticated;
