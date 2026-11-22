-- =============================================================================
-- BOÎTE À IDÉES — idempotent. Chaque membre de la bande glisse une idée (nouveau jeu, amélioration, bug…)
-- dans la boîte ; seul l'admin peut lire. Table sans policy RLS : accès uniquement via les RPC.
-- Erreurs : guest_forbidden, forbidden, invalid_idea, too_many_ideas, unknown_idea, invalid_status.
-- =============================================================================

create table if not exists public.ideas (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 500),
  anonymous  boolean not null default false,
  status     text not null default 'new' check (status in ('new', 'done')),
  created_at timestamptz not null default now()
);
create index if not exists ideas_created_idx on public.ideas (created_at desc);
create index if not exists ideas_profile_idx on public.ideas (profile_id, created_at desc);
alter table public.ideas enable row level security;

create or replace function public.idea_box_state()
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me    uuid := public._require_member();
  v_admin boolean := exists (select 1 from public.profiles where id = v_me and is_admin);
begin
  return jsonb_build_object(
    'total',    (select count(*)::int from public.ideas),
    'mine',     (select count(*)::int from public.ideas where profile_id = v_me),
    'is_admin', v_admin,
    'unread',   case when v_admin then (select count(*)::int from public.ideas where status = 'new') else 0 end
  );
end $$;

create or replace function public.submit_idea(p_body text, p_anonymous boolean default false)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me   uuid := public._require_member();
  v_body text := btrim(coalesce(p_body, ''));
begin
  if char_length(v_body) < 1 or char_length(v_body) > 500 then raise exception 'invalid_idea'; end if;
  if (select count(*) from public.ideas where profile_id = v_me and created_at > now() - interval '24 hours') >= 20 then
    raise exception 'too_many_ideas';
  end if;
  insert into public.ideas(profile_id, body, anonymous) values (v_me, v_body, coalesce(p_anonymous, false));
  return public.idea_box_state();
end $$;

-- Admin : idées récentes d'abord ; auteur masqué si anonyme (même pour l'admin).
create or replace function public.admin_list_ideas()
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
begin
  perform public._require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', i.id, 'body', i.body, 'status', i.status, 'created_at', i.created_at, 'anonymous', i.anonymous,
      'author_id',       case when i.anonymous then null else p.id end,
      'author_slug',     case when i.anonymous then null else p.slug end,
      'author_nickname', case when i.anonymous then null else p.nickname end
    ) order by i.created_at desc)
    from public.ideas i join public.profiles p on p.id = i.profile_id
  ), '[]'::jsonb);
end $$;

create or replace function public.admin_set_idea_status(p_id uuid, p_status text)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
begin
  perform public._require_admin();
  if p_status not in ('new', 'done') then raise exception 'invalid_status'; end if;
  update public.ideas set status = p_status where id = p_id;
  if not found then raise exception 'unknown_idea'; end if;
end $$;

create or replace function public.admin_delete_idea(p_id uuid)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
begin
  perform public._require_admin();
  delete from public.ideas where id = p_id;
  if not found then raise exception 'unknown_idea'; end if;
end $$;

revoke all on function public.idea_box_state() from public, anon;
revoke all on function public.submit_idea(text, boolean) from public, anon;
revoke all on function public.admin_list_ideas() from public, anon;
revoke all on function public.admin_set_idea_status(uuid, text) from public, anon;
revoke all on function public.admin_delete_idea(uuid) from public, anon;
grant execute on function public.idea_box_state() to authenticated;
grant execute on function public.submit_idea(text, boolean) to authenticated;
grant execute on function public.admin_list_ideas() to authenticated;
grant execute on function public.admin_set_idea_status(uuid, text) to authenticated;
grant execute on function public.admin_delete_idea(uuid) to authenticated;
