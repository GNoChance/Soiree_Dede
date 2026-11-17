-- =============================================================================
-- OUTILS DE L'HÔTE — idempotent, exécuté APRÈS schema.sql (features/*).
--  1. Exclusion d'un joueur (kick_soiree_player) + ré-invitation (invite_to_soiree).
--     Table soiree_bans (schema.sql) : un exclu ne peut pas revenir par le code
--     (join_soiree_by_code -> soiree_banned) tant que l'hôte ne l'a pas ré-invité.
--  2. Roue des jeux (spin_game_wheel) : le tirage est fait CÔTÉ SERVEUR et écrit
--     dans soiree_wheel_spins ; tous les téléphones le reçoivent en Realtime
--     (INSERT) et font tourner la roue sur le même jeu.
-- =============================================================================

-- Exclure un joueur. Erreurs : not_host, soiree_ended, cannot_kick_self,
-- match_in_progress (partie lobby/playing), soiree_not_found, player_not_in_soiree.
create or replace function public.kick_soiree_player(p_soiree_id uuid, p_profile_id uuid)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := public._require_profile();
  v_s  public.soirees%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('soiree_membership'));
  select * into v_s from public.soirees where id = p_soiree_id for update;
  if not found then raise exception 'soiree_not_found'; end if;
  if v_s.host_id <> v_me then raise exception 'not_host'; end if;
  if v_s.status = 'ended' then raise exception 'soiree_ended'; end if;
  if p_profile_id = v_me then raise exception 'cannot_kick_self'; end if;
  if exists (select 1 from public.matches m
              where m.soiree_id = p_soiree_id and m.status in ('lobby', 'playing')) then
    raise exception 'match_in_progress';
  end if;
  if not exists (select 1 from public.soiree_players
                  where soiree_id = p_soiree_id and profile_id = p_profile_id) then
    raise exception 'player_not_in_soiree';
  end if;
  insert into public.soiree_bans(soiree_id, profile_id) values (p_soiree_id, p_profile_id)
    on conflict do nothing;
  delete from public.soiree_players where soiree_id = p_soiree_id and profile_id = p_profile_id;
end $$;

-- Ré-inviter un joueur (lève l'exclusion et l'ajoute au salon).
-- Erreurs : not_host, soiree_ended, unknown_profile, player_busy (déjà dans 5 soirées).
create or replace function public.invite_to_soiree(p_soiree_id uuid, p_profile_id uuid)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := public._require_profile();
  v_s  public.soirees%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('soiree_membership'));
  select * into v_s from public.soirees where id = p_soiree_id for update;
  if not found then raise exception 'soiree_not_found'; end if;
  if v_s.host_id <> v_me then raise exception 'not_host'; end if;
  if v_s.status = 'ended' then raise exception 'soiree_ended'; end if;
  if not exists (select 1 from public.profiles where id = p_profile_id) then
    raise exception 'unknown_profile';
  end if;
  delete from public.soiree_bans where soiree_id = p_soiree_id and profile_id = p_profile_id;
  if exists (select 1 from public.soiree_players where soiree_id = p_soiree_id and profile_id = p_profile_id) then
    return;
  end if;
  if public._open_soirees_count(p_profile_id) >= public._soiree_max_open() then
    raise exception 'player_busy' using detail = (select nickname from public.profiles where id = p_profile_id);
  end if;
  insert into public.soiree_players(soiree_id, profile_id) values (p_soiree_id, p_profile_id);
end $$;

revoke all on function public.kick_soiree_player(uuid, uuid) from public, anon;
revoke all on function public.invite_to_soiree(uuid, uuid) from public, anon;
grant execute on function public.kick_soiree_player(uuid, uuid) to authenticated;
grant execute on function public.invite_to_soiree(uuid, uuid) to authenticated;

-- ------------------------------------------------------------------ Roue des jeux
create table if not exists public.soiree_wheel_spins (
  id         bigint generated always as identity primary key,
  soiree_id  uuid not null references public.soirees(id) on delete cascade,
  host_id    uuid not null references public.profiles(id) on delete cascade,
  game_ids   text[] not null,      -- les parts de la roue, dans l'ordre d'affichage
  result     text not null,        -- le jeu tiré (∈ game_ids)
  created_at timestamptz not null default now()
);
create index if not exists soiree_wheel_spins_soiree_idx on public.soiree_wheel_spins(soiree_id, id);

alter table public.soiree_wheel_spins enable row level security;
drop policy if exists soiree_wheel_spins_select on public.soiree_wheel_spins;
create policy soiree_wheel_spins_select on public.soiree_wheel_spins for select to authenticated
  using (public.is_soiree_member(soiree_id));
revoke all on table public.soiree_wheel_spins from anon, authenticated;
grant select on table public.soiree_wheel_spins to authenticated;

-- Tire au sort un jeu parmi p_game_ids (2 à 40 ids ; le front filtre selon le nombre de
-- joueurs). Hôte seulement, pas pendant une partie. Renvoie {id, game_ids, result}.
-- Erreurs : not_host, soiree_ended, match_in_progress, invalid_wheel, soiree_not_found.
create or replace function public.spin_game_wheel(p_soiree_id uuid, p_game_ids text[])
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me  uuid := public._require_profile();
  v_s   public.soirees%rowtype;
  v_ids text[];
  v_res text;
  v_id  bigint;
begin
  select * into v_s from public.soirees where id = p_soiree_id;
  if not found then raise exception 'soiree_not_found'; end if;
  if v_s.host_id <> v_me then raise exception 'not_host'; end if;
  if v_s.status = 'ended' then raise exception 'soiree_ended'; end if;
  if exists (select 1 from public.matches m
              where m.soiree_id = p_soiree_id and m.status in ('lobby', 'playing')) then
    raise exception 'match_in_progress';
  end if;
  v_ids := array(select distinct x from unnest(coalesce(p_game_ids, '{}')) x where x ~ '^[a-z0-9_-]{1,40}$');
  if coalesce(array_length(v_ids, 1), 0) < 2 or array_length(v_ids, 1) > 40 then
    raise exception 'invalid_wheel';
  end if;
  v_res := v_ids[1 + floor(random() * array_length(v_ids, 1))::int];
  insert into public.soiree_wheel_spins(soiree_id, host_id, game_ids, result)
    values (p_soiree_id, v_me, v_ids, v_res) returning id into v_id;
  delete from public.soiree_wheel_spins where soiree_id = p_soiree_id and id < v_id - 4;
  return jsonb_build_object('id', v_id, 'game_ids', to_jsonb(v_ids), 'result', v_res);
end $$;
revoke all on function public.spin_game_wheel(uuid, text[]) from public, anon;
grant execute on function public.spin_game_wheel(uuid, text[]) to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'soiree_wheel_spins') then
    alter publication supabase_realtime add table public.soiree_wheel_spins;
  end if;
end $$;
