-- GÉNÉRÉ par scripts/build-sql.mjs — ne pas éditer. Idempotent : à coller en entier dans Supabase > SQL Editor > Run.

-- ===== schema.sql =====
-- =============================================================================
-- Soirées de Dédé — schéma Supabase (fichier unique, idempotent)
-- À coller tel quel dans Supabase > SQL Editor > Run. Re-exécutable sans erreur.
-- Contrat : docs/ARCHITECTURE.md. Écarts documentés dans supabase/README.md.
-- Toute la logique serveur est ici (RPC security definer). Aucune écriture
-- directe sur les tables n'est autorisée aux clients : tout passe par RPC.
-- =============================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- =============================================================================
-- 1. TABLES
-- =============================================================================

create table if not exists public.profiles (
  id                  uuid primary key default gen_random_uuid(),
  slug                text not null unique,
  first_name          text not null,
  nickname            text not null,
  is_admin            boolean not null default false,
  equipped_expression text not null default 'joie',
  expressions         text[] not null default '{}',
  xp                  integer not null default 0,
  sort_order          integer not null default 100,
  created_at          timestamptz not null default now()
);
alter table public.profiles add column if not exists sort_order integer not null default 100;

-- Hash du PIN : table séparée, jamais lisible par les clients (écart au contrat,
-- voir README : évite qu'un `select('*')` sur profiles n'expose le hash).
create table if not exists public.profile_credentials (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  pin_hash   text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.device_sessions (
  auth_uid   uuid primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists device_sessions_profile_idx on public.device_sessions(profile_id);

create table if not exists public.login_attempts (
  slug           text primary key,
  failed_count   integer not null default 0,
  locked_until   timestamptz,
  last_failed_at timestamptz
);

create table if not exists public.friendships (
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  primary key (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);
create unique index if not exists friendships_pair_uq
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index if not exists friendships_addressee_idx on public.friendships(addressee_id);

create table if not exists public.soirees (
  id         uuid primary key default gen_random_uuid(),
  code       char(4) not null,
  host_id    uuid not null references public.profiles(id),
  status     text not null default 'lobby' check (status in ('lobby', 'active', 'ended')),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at   timestamptz
);
create unique index if not exists soirees_active_code_uq on public.soirees(code) where status <> 'ended';
create index if not exists soirees_status_idx on public.soirees(status);

create table if not exists public.soiree_players (
  soiree_id  uuid not null references public.soirees(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (soiree_id, profile_id)
);
create index if not exists soiree_players_profile_idx on public.soiree_players(profile_id);

create table if not exists public.matches (
  id          uuid primary key default gen_random_uuid(),
  soiree_id   uuid not null references public.soirees(id) on delete cascade,
  game_id     text not null,
  status      text not null default 'lobby' check (status in ('lobby', 'playing', 'finished')),
  state       jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists matches_soiree_idx on public.matches(soiree_id, status);

create table if not exists public.match_players (
  match_id   uuid not null references public.matches(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  game_id    text not null,          -- dénormalisé pour les classements par jeu
  placement  integer not null,
  points     integer not null default 0,
  won        boolean not null default false,
  primary key (match_id, profile_id)
);
create index if not exists match_players_profile_idx on public.match_players(profile_id);
create index if not exists match_players_game_idx on public.match_players(game_id);

create table if not exists public.match_secrets (
  match_id   uuid not null references public.matches(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  secret     jsonb not null,
  primary key (match_id, profile_id)
);
create index if not exists match_secrets_profile_idx on public.match_secrets(profile_id);

-- État serveur privé (votes en cours, mots, rôles) : jamais lisible par les clients.
create table if not exists public.match_server_state (
  match_id uuid primary key references public.matches(id) on delete cascade,
  data     jsonb not null default '{}'::jsonb
);

create table if not exists public.unlocks (
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  expression  text not null,
  unlocked_at timestamptz not null default now(),
  primary key (profile_id, expression)
);

create table if not exists public.player_stats (
  profile_id                   uuid primary key references public.profiles(id) on delete cascade,
  games_played                 integer not null default 0,
  wins                         integer not null default 0,
  losses                       integer not null default 0,
  loss_streak                  integer not null default 0,
  max_loss_streak              integer not null default 0,
  last_place_count             integer not null default 0,
  qui_de_nous_played           integer not null default 0,
  undercover_played            integer not null default 0,
  undercover_won_as_undercover integer not null default 0,
  undercover_first_out         integer not null default 0,
  designated_total             integer not null default 0,
  soirees_count                integer not null default 0,
  late_soirees_count           integer not null default 0,
  updated_at                   timestamptz not null default now()
);

-- =============================================================================
-- 2. HELPERS
-- =============================================================================

create or replace function public.level_for_xp(p_xp integer)
returns integer language sql immutable
set search_path = public, extensions
as $$ select floor(sqrt(greatest(coalesce(p_xp, 0), 0) / 100.0))::integer + 1 $$;

-- Normalise un mot pour comparaison (casse, accents, espaces, ponctuation).
create or replace function public._normalize_word(p text)
returns text language sql immutable
set search_path = public, extensions
as $$
  select regexp_replace(
    lower(translate(
      replace(replace(replace(replace(coalesce(p, ''), 'œ', 'oe'), 'Œ', 'OE'), 'æ', 'ae'), 'Æ', 'AE'),
      'àâäáãåçéèêëíìîïñóòôöõúùûüýÿÀÂÄÁÃÅÇÉÈÊËÍÌÎÏÑÓÒÔÖÕÚÙÛÜÝŸ',
      'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUYY'
    )),
    '[^a-z0-9]', '', 'g')
$$;

create or replace function public.current_profile_id()
returns uuid language sql stable security definer
set search_path = public, extensions
as $$ select profile_id from public.device_sessions where auth_uid = auth.uid() $$;

create or replace function public._require_profile()
returns uuid language plpgsql stable security definer
set search_path = public, extensions
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  v_id := public.current_profile_id();
  if v_id is null then raise exception 'not_logged_in'; end if;
  return v_id;
end $$;

create or replace function public._profile_json(p_id uuid)
returns jsonb language sql stable security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'id', p.id, 'slug', p.slug, 'first_name', p.first_name, 'nickname', p.nickname,
    'is_admin', p.is_admin, 'equipped_expression', p.equipped_expression,
    'expressions', to_jsonb(p.expressions), 'xp', p.xp, 'level', public.level_for_xp(p.xp),
    'sort_order', p.sort_order, 'created_at', p.created_at)
  from public.profiles p where p.id = p_id
$$;

-- Utilisée par les RLS (security definer = pas de récursion RLS).
create or replace function public.is_soiree_member(p_soiree_id uuid)
returns boolean language sql stable security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from public.soiree_players sp
    where sp.soiree_id = p_soiree_id and sp.profile_id = public.current_profile_id()
  ) or exists (
    select 1 from public.soirees s
    where s.id = p_soiree_id and s.host_id = public.current_profile_id()
  )
$$;

create or replace function public._active_soiree_of(p_profile_id uuid)
returns uuid language sql stable security definer
set search_path = public, extensions
as $$
  select sp.soiree_id from public.soiree_players sp
  join public.soirees s on s.id = sp.soiree_id
  where sp.profile_id = p_profile_id and s.status <> 'ended'
  order by sp.joined_at desc limit 1
$$;

create or replace function public._soiree_json(p_soiree_id uuid)
returns jsonb language sql stable security definer
set search_path = public, extensions
as $$
  select to_jsonb(s) || jsonb_build_object('player_ids', coalesce((
      select jsonb_agg(sp.profile_id order by sp.joined_at, sp.profile_id)
      from public.soiree_players sp where sp.soiree_id = s.id), '[]'::jsonb))
  from public.soirees s where s.id = p_soiree_id
$$;

-- =============================================================================
-- 3. DÉBLOCAGES
-- =============================================================================

-- Évalue toutes les conditions pour un profil ; renvoie les expressions
-- nouvellement débloquées. Seules les expressions de profiles.expressions comptent.
create or replace function public.evaluate_unlocks(p_profile_id uuid)
returns text[] language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_p        public.profiles%rowtype;
  v_s        public.player_stats%rowtype;
  v_friends  integer;
  v_others   integer;
  v_maxwins  integer;
  v_c        text[] := array['joie'];
  v_new      text[];
begin
  select * into v_p from public.profiles where id = p_profile_id;
  if not found then return '{}'; end if;
  insert into public.player_stats(profile_id) values (p_profile_id) on conflict do nothing;
  select * into v_s from public.player_stats where profile_id = p_profile_id;

  select count(*) into v_friends from public.friendships f
   where f.status = 'accepted' and (f.requester_id = p_profile_id or f.addressee_id = p_profile_id);
  select count(*) - 1 into v_others from public.profiles;
  select coalesce(max(wins), 0) into v_maxwins from public.player_stats;

  if v_s.wins >= 5  then v_c := v_c || 'pouces'::text; end if;
  if v_s.wins >= 25 then v_c := v_c || 'gamer'::text; end if;
  if v_s.wins > 0 and v_s.wins >= v_maxwins then v_c := v_c || 'cool'::text; end if;
  if v_s.undercover_won_as_undercover >= 1 then v_c := v_c || 'clin_oeil'::text; end if;
  if v_s.undercover_played >= 10 then v_c := v_c || 'reflexion'::text; end if;
  if v_s.undercover_first_out >= 3 then v_c := v_c || 'boude'::text; end if;
  if v_s.designated_total >= 10 then v_c := v_c || 'bisou'::text; end if;
  if v_s.designated_total >= 25 then v_c := v_c || 'timide'::text; end if;
  if v_friends >= 5 then v_c := v_c || 'amoureux'::text; end if;
  if v_others > 0 and v_friends >= v_others then v_c := v_c || 'charmee'::text; end if;
  if greatest(v_s.loss_streak, v_s.max_loss_streak) >= 3 then v_c := v_c || 'colere'::text; end if;
  if v_s.last_place_count >= 5 then v_c := v_c || 'pleurs'::text; end if;
  if v_s.late_soirees_count >= 1 then v_c := v_c || 'dodo'::text; end if;
  if v_s.soirees_count >= 10 then v_c := v_c || 'surprise'::text; end if;

  with ins as (
    insert into public.unlocks(profile_id, expression)
    select p_profile_id, e from unnest(v_c) e where e = any(v_p.expressions)
    on conflict do nothing
    returning expression
  )
  select coalesce(array_agg(expression), '{}') into v_new from ins;
  return v_new;
end $$;

-- Évalue plusieurs profils ; renvoie {"<profile_id>": ["expr", ...]} (entrées non vides seulement).
create or replace function public._unlocks_map(p_ids uuid[])
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_id  uuid;
  v_new text[];
  v_map jsonb := '{}'::jsonb;
begin
  for v_id in select distinct x from unnest(coalesce(p_ids, '{}')) x where x is not null loop
    v_new := public.evaluate_unlocks(v_id);
    if cardinality(v_new) > 0 then
      v_map := v_map || jsonb_build_object(v_id::text, to_jsonb(v_new));
    end if;
  end loop;
  return v_map;
end $$;

-- =============================================================================
-- 4. AUTH / PROFIL
-- =============================================================================

-- drop : tenues.sql en change les colonnes de retour (equipped_tenue) ; sans lui,
-- ré-exécuter ce fichier sur une base déjà équipée échouerait (42P13).
drop function if exists public.list_profiles_public();
create function public.list_profiles_public()
returns table (id uuid, slug text, first_name text, nickname text,
               equipped_expression text, expressions text[], has_pin boolean)
language sql stable security definer
set search_path = public, extensions
as $$
  select p.id, p.slug, p.first_name, p.nickname, p.equipped_expression, p.expressions,
         exists (select 1 from public.profile_credentials c where c.profile_id = p.id)
  from public.profiles p
  order by p.sort_order, p.slug
$$;

create or replace function public.login_profile(p_slug text, p_pin text)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_uid   uuid := auth.uid();
  v_prof  public.profiles%rowtype;
  v_att   public.login_attempts%rowtype;
  v_hash  text;
  v_first boolean := false;
  v_fails integer;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_pin_format');
  end if;

  select * into v_prof from public.profiles where slug = lower(btrim(p_slug)) for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'unknown_profile');
  end if;

  insert into public.login_attempts(slug) values (v_prof.slug) on conflict (slug) do nothing;
  select * into v_att from public.login_attempts where slug = v_prof.slug for update;
  if v_att.locked_until is not null and v_att.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'locked', 'locked_until', v_att.locked_until);
  end if;

  select pin_hash into v_hash from public.profile_credentials where profile_id = v_prof.id;
  if v_hash is null then
    -- Première connexion : le PIN saisi devient le PIN du profil.
    insert into public.profile_credentials(profile_id, pin_hash, updated_at)
    values (v_prof.id, extensions.crypt(p_pin, extensions.gen_salt('bf', 8)), now())
    on conflict (profile_id) do update set pin_hash = excluded.pin_hash, updated_at = now();
    v_first := true;
  elsif extensions.crypt(p_pin, v_hash) <> v_hash then
    -- Échec : on NE lève PAS d'exception (sinon le compteur serait annulé).
    v_fails := v_att.failed_count + 1;
    if v_fails >= 5 then
      update public.login_attempts
         set failed_count = 0, locked_until = now() + interval '15 minutes', last_failed_at = now()
       where slug = v_prof.slug;
      return jsonb_build_object('ok', false, 'error', 'locked',
                                'locked_until', now() + interval '15 minutes');
    end if;
    update public.login_attempts
       set failed_count = v_fails, last_failed_at = now()
     where slug = v_prof.slug;
    return jsonb_build_object('ok', false, 'error', 'wrong_pin', 'attempts_left', 5 - v_fails);
  end if;

  delete from public.login_attempts where slug = v_prof.slug;
  insert into public.device_sessions(auth_uid, profile_id) values (v_uid, v_prof.id)
  on conflict (auth_uid) do update set profile_id = excluded.profile_id, created_at = now();
  perform public.evaluate_unlocks(v_prof.id);

  return jsonb_build_object('ok', true, 'first_login', v_first, 'profile', public._profile_json(v_prof.id));
end $$;

create or replace function public.logout_device()
returns void language sql security definer
set search_path = public, extensions
as $$ delete from public.device_sessions where auth_uid = auth.uid() $$;

create or replace function public.admin_reset_pin(p_slug text)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me     uuid := public._require_profile();
  v_target public.profiles%rowtype;
begin
  if not exists (select 1 from public.profiles where id = v_me and is_admin) then
    raise exception 'forbidden';
  end if;
  select * into v_target from public.profiles where slug = lower(btrim(p_slug));
  if not found then raise exception 'unknown_profile'; end if;
  delete from public.profile_credentials where profile_id = v_target.id;
  delete from public.login_attempts where slug = v_target.slug;
  delete from public.device_sessions where profile_id = v_target.id and auth_uid <> auth.uid();
end $$;

create or replace function public.update_nickname(p_nickname text)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me   uuid := public._require_profile();
  v_nick text := btrim(regexp_replace(coalesce(p_nickname, ''), '\s+', ' ', 'g'));
begin
  if char_length(v_nick) < 1 or char_length(v_nick) > 20 then
    raise exception 'invalid_nickname';
  end if;
  update public.profiles set nickname = v_nick where id = v_me;
  return public._profile_json(v_me);
end $$;

create or replace function public.equip_expression(p_expression text)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := public._require_profile();
begin
  if not exists (select 1 from public.profiles where id = v_me and p_expression = any(expressions)) then
    raise exception 'unknown_expression';
  end if;
  if p_expression <> 'joie' and not exists (
    select 1 from public.unlocks where profile_id = v_me and expression = p_expression
  ) then
    raise exception 'expression_locked';
  end if;
  update public.profiles set equipped_expression = p_expression where id = v_me;
  return public._profile_json(v_me);
end $$;

-- =============================================================================
-- 5. AMIS
-- =============================================================================

create or replace function public.send_friend_request(p_profile_id uuid)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me  uuid := public._require_profile();
  v_row public.friendships%rowtype;
begin
  if p_profile_id is null or p_profile_id = v_me then raise exception 'invalid_friend'; end if;
  if not exists (select 1 from public.profiles where id = p_profile_id) then
    raise exception 'unknown_profile';
  end if;
  perform pg_advisory_xact_lock(hashtext('friend:' || least(v_me, p_profile_id)::text
                                          || greatest(v_me, p_profile_id)::text));
  select * into v_row from public.friendships
   where (requester_id = v_me and addressee_id = p_profile_id)
      or (requester_id = p_profile_id and addressee_id = v_me);
  if found then
    if v_row.status = 'accepted' then
      return jsonb_build_object('status', 'accepted', 'new_unlocks', '{}'::jsonb);
    elsif v_row.requester_id = v_me then
      return jsonb_build_object('status', 'pending', 'new_unlocks', '{}'::jsonb);
    end if;
    -- L'autre m'avait déjà demandé : acceptation réciproque automatique.
    update public.friendships set status = 'accepted', accepted_at = now()
     where requester_id = p_profile_id and addressee_id = v_me;
    return jsonb_build_object('status', 'accepted',
                              'new_unlocks', public._unlocks_map(array[v_me, p_profile_id]));
  end if;
  insert into public.friendships(requester_id, addressee_id) values (v_me, p_profile_id);
  return jsonb_build_object('status', 'pending', 'new_unlocks', '{}'::jsonb);
end $$;

create or replace function public.respond_friend_request(p_requester_id uuid, p_accept boolean)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := public._require_profile();
begin
  perform 1 from public.friendships
   where requester_id = p_requester_id and addressee_id = v_me and status = 'pending'
   for update;
  if not found then raise exception 'no_pending_request'; end if;
  if coalesce(p_accept, false) then
    update public.friendships set status = 'accepted', accepted_at = now()
     where requester_id = p_requester_id and addressee_id = v_me;
    return jsonb_build_object('status', 'accepted',
                              'new_unlocks', public._unlocks_map(array[v_me, p_requester_id]));
  end if;
  delete from public.friendships where requester_id = p_requester_id and addressee_id = v_me;
  return jsonb_build_object('status', 'rejected', 'new_unlocks', '{}'::jsonb);
end $$;

-- Supprime une amitié, ou annule une demande envoyée/reçue.
create or replace function public.remove_friend(p_profile_id uuid)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := public._require_profile();
begin
  delete from public.friendships
   where (requester_id = v_me and addressee_id = p_profile_id)
      or (requester_id = p_profile_id and addressee_id = v_me);
end $$;

-- =============================================================================
-- 6. SOIRÉES
-- =============================================================================

create or replace function public._gen_soiree_code()
returns text language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  v_alpha constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ';  -- sans I, L, O
  v_code  text;
  i       integer := 0;
begin
  loop
    select string_agg(substr(v_alpha, 1 + floor(random() * length(v_alpha))::integer, 1), '')
      into v_code from generate_series(1, 4);
    exit when not exists (select 1 from public.soirees where code = v_code and status <> 'ended');
    i := i + 1;
    if i > 200 then raise exception 'code_generation_failed'; end if;
  end loop;
  return v_code;
end $$;

-- Termine une soirée (interne). p_natural = false pour le nettoyage automatique.
-- Compte une soirée (stat surprise) pour chaque joueur ayant fini au moins une
-- partie dedans ; « dodo » pour les joueurs présents à la fin si fin entre 2h et 8h (Paris).
create or replace function public._end_soiree(p_soiree_id uuid, p_natural boolean)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_players uuid[];
  v_hour    integer;
begin
  update public.soirees set status = 'ended', ended_at = now()
   where id = p_soiree_id and status <> 'ended';
  if not found then return '{}'::jsonb; end if;

  update public.matches
     set status = 'finished', finished_at = now(),
         state = state || jsonb_build_object('phase', 'aborted', 'aborted', true,
                                             'seq', coalesce((state->>'seq')::integer, 0) + 1)
   where soiree_id = p_soiree_id and status <> 'finished';

  v_players := array(
    select distinct mp.profile_id from public.match_players mp
    join public.matches m on m.id = mp.match_id
    where m.soiree_id = p_soiree_id);
  if cardinality(v_players) = 0 then return '{}'::jsonb; end if;

  insert into public.player_stats(profile_id, soirees_count)
  select x, 1 from unnest(v_players) x
  on conflict (profile_id) do update
    set soirees_count = public.player_stats.soirees_count + 1, updated_at = now();

  v_hour := extract(hour from (now() at time zone 'Europe/Paris'))::integer;
  if p_natural and v_hour >= 2 and v_hour < 8 then
    update public.player_stats ps
       set late_soirees_count = ps.late_soirees_count + 1, updated_at = now()
     where ps.profile_id = any(v_players)
       and exists (select 1 from public.soiree_players sp
                    where sp.soiree_id = p_soiree_id and sp.profile_id = ps.profile_id);
  end if;

  return public._unlocks_map(v_players);
end $$;

-- Termine automatiquement les soirées oubliées (aucune activité depuis 12 h).
create or replace function public._cleanup_stale_soirees()
returns void language plpgsql security definer
set search_path = public, extensions
as $$
declare v_id uuid;
begin
  for v_id in
    select s.id from public.soirees s
     where s.status <> 'ended'
       and greatest(s.created_at,
                    coalesce((select max(m.created_at) from public.matches m where m.soiree_id = s.id), s.created_at),
                    coalesce((select max(m.finished_at) from public.matches m where m.soiree_id = s.id), s.created_at))
           < now() - interval '12 hours'
  loop
    perform public._end_soiree(v_id, false);
  end loop;
end $$;

create or replace function public.my_active_soiree()
returns jsonb language sql stable security definer
set search_path = public, extensions
as $$ select public._soiree_json(public._active_soiree_of(public.current_profile_id())) $$;

create or replace function public.create_soiree(p_player_ids uuid[])
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me   uuid := public._require_profile();
  v_ids  uuid[];
  v_busy text;
  v_id   uuid;
  v_code text;
begin
  perform pg_advisory_xact_lock(hashtext('soiree_membership'));
  perform public._cleanup_stale_soirees();

  if public._active_soiree_of(v_me) is not null then raise exception 'already_in_soiree'; end if;

  v_ids := array(select distinct x from unnest(coalesce(p_player_ids, '{}') || v_me) x where x is not null);
  if exists (select 1 from unnest(v_ids) x where not exists (select 1 from public.profiles p where p.id = x)) then
    raise exception 'unknown_profile';
  end if;
  select string_agg(p.nickname, ', ' order by p.sort_order) into v_busy
    from public.profiles p
   where p.id = any(v_ids) and public._active_soiree_of(p.id) is not null;
  if v_busy is not null then
    raise exception 'player_busy' using detail = v_busy;
  end if;

  loop
    v_code := public._gen_soiree_code();
    begin
      insert into public.soirees(code, host_id, status) values (v_code, v_me, 'lobby') returning id into v_id;
      exit;
    exception when unique_violation then
      -- collision concurrente improbable : on retente
    end;
  end loop;

  insert into public.soiree_players(soiree_id, profile_id, joined_at) values (v_id, v_me, now());
  insert into public.soiree_players(soiree_id, profile_id, joined_at)
  select v_id, x, now() + interval '1 millisecond' from unnest(v_ids) x where x <> v_me;

  return public._soiree_json(v_id);
end $$;

create or replace function public.join_soiree_by_code(p_code text)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me  uuid := public._require_profile();
  v_sid uuid;
begin
  perform pg_advisory_xact_lock(hashtext('soiree_membership'));
  perform public._cleanup_stale_soirees();

  select id into v_sid from public.soirees
   where code = upper(btrim(coalesce(p_code, ''))) and status <> 'ended';
  if v_sid is null then raise exception 'soiree_not_found'; end if;

  if exists (select 1 from public.soiree_players where soiree_id = v_sid and profile_id = v_me) then
    return public._soiree_json(v_sid);
  end if;
  if public._active_soiree_of(v_me) is not null then raise exception 'already_in_soiree'; end if;

  insert into public.soiree_players(soiree_id, profile_id) values (v_sid, v_me);
  return public._soiree_json(v_sid);
end $$;

-- Quitte la soirée non terminée en cours. Si l'hôte part, l'hôte passe au plus
-- ancien joueur restant ; si plus personne, la soirée est terminée.
create or replace function public.leave_soiree()
returns void language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me   uuid := public._require_profile();
  v_sid  uuid;
  v_host uuid;
  v_new  uuid;
begin
  perform pg_advisory_xact_lock(hashtext('soiree_membership'));
  v_sid := public._active_soiree_of(v_me);
  if v_sid is null then return; end if;

  select host_id into v_host from public.soirees where id = v_sid for update;
  delete from public.soiree_players where soiree_id = v_sid and profile_id = v_me;

  if v_host = v_me then
    select profile_id into v_new from public.soiree_players
     where soiree_id = v_sid order by joined_at, profile_id limit 1;
    if v_new is null then
      perform public._end_soiree(v_sid, true);
    else
      update public.soirees set host_id = v_new where id = v_sid;
    end if;
  end if;
end $$;

create or replace function public.end_soiree(p_soiree_id uuid)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := public._require_profile();
  v_s  public.soirees%rowtype;
begin
  select * into v_s from public.soirees where id = p_soiree_id for update;
  if not found then raise exception 'soiree_not_found'; end if;
  if v_s.host_id <> v_me then raise exception 'not_host'; end if;
  if v_s.status = 'ended' then raise exception 'soiree_ended'; end if;
  return jsonb_build_object('new_unlocks', public._end_soiree(p_soiree_id, true));
end $$;

-- =============================================================================
-- 7. MOTEUR : fin de partie
-- =============================================================================

-- Hook de fin de partie : no-op ici, redéfini par supabase/features/tenues.sql
-- (évaluation des tenues). Renvoie {profile_id: [ids]} fusionné sous `new_tenues`.
create or replace function public._after_finish_match(p_match_id uuid, p_profile_ids uuid[])
returns jsonb language sql
set search_path = public, extensions
as $$ select '{}'::jsonb $$;

-- p_results : [{profile_id, points, won, placement, stats?: {designated?, undercover_won_as_undercover?, undercover_first_out?}}]
-- Écrit match_players, XP, player_stats, passe le match en 'finished',
-- puis évalue les déblocages de tous les joueurs. Renvoie {new_unlocks, xp_gained}.
create or replace function public.finish_match(p_match_id uuid, p_results jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_m     public.matches%rowtype;
  v_maxp  integer;
  v_minp  integer;
  r       record;
  v_xp    integer;
  v_xpmap jsonb := '{}'::jsonb;
  v_ids   uuid[] := '{}';
begin
  select * into v_m from public.matches where id = p_match_id for update;
  if not found then raise exception 'match_not_found'; end if;
  if v_m.status = 'finished' then raise exception 'match_already_finished'; end if;

  select max(x.placement), min(x.placement) into v_maxp, v_minp
    from jsonb_to_recordset(p_results) as x(placement integer);

  for r in
    select * from jsonb_to_recordset(p_results)
      as x(profile_id uuid, points integer, won boolean, placement integer, stats jsonb)
  loop
    insert into public.match_players(match_id, profile_id, game_id, placement, points, won)
    values (p_match_id, r.profile_id, v_m.game_id, coalesce(r.placement, 1),
            coalesce(r.points, 0), coalesce(r.won, false));

    v_xp := greatest(coalesce(r.points, 0), 0) * 10 + case when coalesce(r.won, false) then 50 else 0 end;
    update public.profiles set xp = xp + v_xp where id = r.profile_id;

    insert into public.player_stats(profile_id) values (r.profile_id) on conflict do nothing;
    update public.player_stats set
      games_played       = games_played + 1,
      wins               = wins + case when coalesce(r.won, false) then 1 else 0 end,
      losses             = losses + case when coalesce(r.won, false) then 0 else 1 end,
      loss_streak        = case when coalesce(r.won, false) then 0 else loss_streak + 1 end,
      max_loss_streak    = greatest(max_loss_streak, case when coalesce(r.won, false) then 0 else loss_streak + 1 end),
      last_place_count   = last_place_count
                           + case when v_maxp > v_minp and r.placement = v_maxp then 1 else 0 end,
      qui_de_nous_played = qui_de_nous_played + case when v_m.game_id = 'qui-de-nous' then 1 else 0 end,
      undercover_played  = undercover_played + case when v_m.game_id = 'undercover' then 1 else 0 end,
      designated_total   = designated_total + coalesce((r.stats->>'designated')::integer, 0),
      undercover_won_as_undercover = undercover_won_as_undercover
                           + coalesce((r.stats->>'undercover_won_as_undercover')::integer, 0),
      undercover_first_out = undercover_first_out + coalesce((r.stats->>'undercover_first_out')::integer, 0),
      updated_at         = now()
    where profile_id = r.profile_id;

    v_xpmap := v_xpmap || jsonb_build_object(r.profile_id::text, v_xp);
    v_ids := v_ids || r.profile_id;
  end loop;

  update public.matches set status = 'finished', finished_at = now() where id = p_match_id;

  return jsonb_build_object('new_unlocks', public._unlocks_map(v_ids), 'xp_gained', v_xpmap,
                            'new_tenues', coalesce(public._after_finish_match(p_match_id, v_ids), '{}'::jsonb));
end $$;

-- =============================================================================
-- 8. JEU « qui-de-nous »
-- =============================================================================

create or replace function public.game_qui_de_nous_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_q      jsonb := p_options->'questions';
  v_rounds integer;
  v_zero   jsonb;
begin
  if cardinality(p_players) < 2 then raise exception 'not_enough_players'; end if;
  if v_q is null or jsonb_typeof(v_q) <> 'array' or jsonb_array_length(v_q) = 0 then
    raise exception 'missing_questions';
  end if;
  if exists (select 1 from jsonb_array_elements(v_q) e
              where jsonb_typeof(e) <> 'string' or char_length(btrim(e #>> '{}')) = 0
                 or char_length(e #>> '{}') > 300) then
    raise exception 'invalid_questions';
  end if;

  v_rounds := coalesce(nullif(p_options->>'rounds', '')::integer, 10);
  v_rounds := least(greatest(v_rounds, 1), 50, jsonb_array_length(v_q));

  select jsonb_agg(q order by o) into v_q
    from jsonb_array_elements_text(v_q) with ordinality as t(q, o) where o <= v_rounds;
  select jsonb_object_agg(p::text, 0) into v_zero from unnest(p_players) p;

  return jsonb_build_object(
    'state', jsonb_build_object(
      'game', 'qui-de-nous',
      'phase', 'voting',
      'round', 1,
      'total_rounds', v_rounds,
      'question', v_q->>0,
      'players', to_jsonb(p_players),
      'voters', '[]'::jsonb,
      'scores', v_zero,
      'designated', v_zero,
      'last_reveal', null,
      'history', '[]'::jsonb,
      'winners', null,
      'results', null),
    'server', jsonb_build_object('questions', v_q, 'votes', '{}'::jsonb),
    'secrets', '{}'::jsonb);
end $$;

create or replace function public._qdn_reveal(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_votes   jsonb := coalesce(p_server->'votes', '{}'::jsonb);
  v_counts  jsonb;
  v_max     integer;
  v_maj     text[];
  v_scorers text[];
begin
  select coalesce(jsonb_object_agg(t.target, t.c), '{}'::jsonb), coalesce(max(t.c), 0)
    into v_counts, v_max
    from (select value as target, count(*)::integer as c
            from jsonb_each_text(v_votes) group by value) t;

  v_maj := array(select key from jsonb_each_text(v_counts)
                  where v_max > 0 and value::integer = v_max order by key);
  v_scorers := array(select key from jsonb_each_text(v_votes) where value = any(v_maj) order by key);

  p_state := p_state || jsonb_build_object(
    'phase', 'reveal',
    'scores', (select jsonb_object_agg(key, value::integer + case when key = any(v_scorers) then 1 else 0 end)
                 from jsonb_each_text(p_state->'scores')),
    'designated', (select jsonb_object_agg(key, value::integer + coalesce((v_counts->>key)::integer, 0))
                     from jsonb_each_text(p_state->'designated')),
    'last_reveal', jsonb_build_object(
        'round', p_state->'round', 'question', p_state->'question',
        'votes', v_votes, 'counts', v_counts,
        'majority', to_jsonb(v_maj), 'scorers', to_jsonb(v_scorers)),
    'history', coalesce(p_state->'history', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'round', p_state->'round', 'question', p_state->'question',
        'counts', v_counts, 'majority', to_jsonb(v_maj))));

  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

create or replace function public._qdn_finish(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_max     integer;
  v_results jsonb;
  v_winners jsonb;
begin
  select coalesce(max(value::integer), 0) into v_max from jsonb_each_text(p_state->'scores');

  select jsonb_agg(jsonb_build_object(
           'profile_id', t.key,
           'points', t.value::integer,
           'won', v_max > 0 and t.value::integer = v_max,
           'placement', t.r,
           'stats', jsonb_build_object('designated', coalesce((p_state->'designated'->>t.key)::integer, 0)))
         order by t.r, t.key)
    into v_results
    from (select key, value, rank() over (order by value::integer desc) as r
            from jsonb_each_text(p_state->'scores')) t;

  select coalesce(jsonb_agg(key order by key), '[]'::jsonb) into v_winners
    from jsonb_each_text(p_state->'scores') where v_max > 0 and value::integer = v_max;

  p_state := p_state || jsonb_build_object('phase', 'finished', 'winners', v_winners, 'results', v_results);
  return jsonb_build_object('state', p_state, 'server', p_server, 'results', v_results);
end $$;

create or replace function public.game_qui_de_nous_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_type   text := p_action->>'type';
  v_phase  text := p_state->>'phase';
  v_round  integer := (p_state->>'round')::integer;
  v_total  integer := (p_state->>'total_rounds')::integer;
  v_target text;
  v_voters jsonb;
begin
  if v_type = 'vote' then
    if v_phase <> 'voting' then raise exception 'wrong_phase'; end if;
    if not (p_state->'players' ? p_actor::text) then raise exception 'not_a_player'; end if;
    begin
      v_target := (p_action->>'target')::uuid::text;
    exception when others then
      raise exception 'invalid_target';
    end;
    if v_target is null or not (p_state->'players' ? v_target) then raise exception 'invalid_target'; end if;
    if v_target = p_actor::text then raise exception 'cannot_vote_self'; end if;

    p_server := jsonb_set(p_server, array['votes', p_actor::text], to_jsonb(v_target), true);
    select coalesce(jsonb_agg(pl order by o), '[]'::jsonb) into v_voters
      from jsonb_array_elements_text(p_state->'players') with ordinality as t(pl, o)
     where (p_server->'votes') ? pl;
    p_state := jsonb_set(p_state, '{voters}', v_voters);

    if jsonb_array_length(v_voters) >= jsonb_array_length(p_state->'players') then
      return public._qdn_reveal(p_state, p_server);
    end if;
    return jsonb_build_object('state', p_state, 'server', p_server);

  elsif v_type = 'reveal' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase <> 'voting' then raise exception 'wrong_phase'; end if;
    return public._qdn_reveal(p_state, p_server);

  elsif v_type = 'next' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase <> 'reveal' then raise exception 'wrong_phase'; end if;
    if v_round >= v_total then
      return public._qdn_finish(p_state, p_server);
    end if;
    p_state := p_state || jsonb_build_object(
      'phase', 'voting', 'round', v_round + 1,
      'question', p_server->'questions'->>v_round,   -- index 0-based = manche suivante
      'voters', '[]'::jsonb);
    p_server := jsonb_set(p_server, '{votes}', '{}'::jsonb);
    return jsonb_build_object('state', p_state, 'server', p_server);

  else
    raise exception 'unknown_action';
  end if;
end $$;

-- =============================================================================
-- 9. JEU « undercover »
-- =============================================================================

create or replace function public.game_undercover_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_n       integer := cardinality(p_players);
  v_pair    jsonb := p_options->'pair';
  v_civil   text;
  v_uc      text;
  v_n_uc    integer;
  v_mw      boolean;
  v_shuf    uuid[];
  v_order   uuid[];
  v_roles   jsonb := '{}'::jsonb;
  v_secrets jsonb := '{}'::jsonb;
  v_mw_id   uuid;
  v_role    text;
  i         integer;
begin
  if v_n < 3 then raise exception 'not_enough_players'; end if;
  if v_pair is null or jsonb_typeof(v_pair) <> 'array' or jsonb_array_length(v_pair) <> 2
     or jsonb_typeof(v_pair->0) <> 'string' or jsonb_typeof(v_pair->1) <> 'string' then
    raise exception 'invalid_pair';
  end if;
  v_civil := btrim(v_pair->>0);
  v_uc    := btrim(v_pair->>1);
  if public._normalize_word(v_civil) = '' or public._normalize_word(v_uc) = ''
     or public._normalize_word(v_civil) = public._normalize_word(v_uc) then
    raise exception 'invalid_pair';
  end if;
  -- Tirage au sort du mot civil / undercover.
  if random() < 0.5 then
    select v_uc, v_civil into v_civil, v_uc;
  end if;

  v_n_uc := case when v_n >= 7 then 2 else 1 end;
  -- Mister White seulement si les civils restent majoritaires (>= 5 joueurs).
  v_mw := coalesce(nullif(p_options->>'misterWhite', '')::boolean, false) and v_n >= 5;

  v_shuf := array(select p from unnest(p_players) p order by random());
  for i in 1 .. v_n loop
    if i <= v_n_uc then v_role := 'undercover';
    elsif v_mw and i = v_n_uc + 1 then v_role := 'mrwhite'; v_mw_id := v_shuf[i];
    else v_role := 'civil';
    end if;
    v_roles := v_roles || jsonb_build_object(v_shuf[i]::text, v_role);
    -- Le rôle n'est PAS exposé aux civils/undercovers (ils ne doivent pas savoir
    -- lequel ils sont) ; seul Mister White sait qu'il est Mister White.
    v_secrets := v_secrets || jsonb_build_object(v_shuf[i]::text,
      case v_role when 'mrwhite' then jsonb_build_object('role', 'mrwhite', 'word', null)
                  else jsonb_build_object('word', case v_role when 'civil' then v_civil else v_uc end) end);
  end loop;

  -- Ordre de parole aléatoire ; Mister White jamais premier.
  v_order := array(select p from unnest(p_players) p order by random());
  if v_mw_id is not null and v_order[1] = v_mw_id then
    v_order := v_order[2:v_n] || v_order[1];
  end if;

  return jsonb_build_object(
    'state', jsonb_build_object(
      'game', 'undercover',
      'phase', 'describe',
      'round', 1,
      'players', to_jsonb(p_players),
      'order', to_jsonb(v_order),
      'alive', to_jsonb(v_order),
      'starter', v_order[1],
      'setup', jsonb_build_object('civils', v_n - v_n_uc - (case when v_mw then 1 else 0 end),
                                  'undercovers', v_n_uc, 'mister_white', v_mw),
      'voters', '[]'::jsonb,
      'candidates', '[]'::jsonb,
      'revote', false,
      'last_vote', null,
      'eliminated', '[]'::jsonb,
      'current_elimination', null,
      'mrwhite_guess', null,
      'winner', null,
      'words', null,
      'roles', null,
      'results', null),
    'server', jsonb_build_object('civil_word', v_civil, 'undercover_word', v_uc,
                                 'roles', v_roles, 'votes', '{}'::jsonb),
    'secrets', v_secrets);
end $$;

create or replace function public._uc_finish(p_state jsonb, p_server jsonb, p_winner text)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_roles   jsonb := p_server->'roles';
  v_results jsonb;
begin
  with base as (
    select t.pl,
           v_roles->>t.pl as role,
           (p_state->'alive') ? t.pl as alive,
           (select e.o from jsonb_array_elements(p_state->'eliminated') with ordinality as e(v, o)
             where e.v->>'profile_id' = t.pl limit 1) as elim_idx
      from jsonb_array_elements_text(p_state->'players') as t(pl)
  ), w as (
    select b.*,
           case p_winner
             when 'civils'    then b.role = 'civil'
             when 'infiltres' then b.role in ('undercover', 'mrwhite')
             else b.role = 'mrwhite'
           end as won
      from base b
  ), s as (
    select w.*,
           case when w.won and (w.alive or p_winner = 'mrwhite') then 3
                when w.won then 2 else 0 end as points,
           case when w.alive then 1000 else coalesce(w.elim_idx, 0) end as survival
      from w
  ), ranked as (
    select s.*, rank() over (order by s.won desc, s.survival desc) as placement from s
  )
  select jsonb_agg(jsonb_build_object(
           'profile_id', pl, 'points', points, 'won', won, 'placement', placement, 'role', role,
           'stats', jsonb_build_object(
             'undercover_won_as_undercover',
               case when won and role = 'undercover' and alive and p_winner = 'infiltres' then 1 else 0 end,
             'undercover_first_out', case when elim_idx = 1 then 1 else 0 end))
         order by placement, pl)
    into v_results
    from ranked;

  p_state := p_state || jsonb_build_object(
    'phase', 'finished',
    'winner', p_winner,
    'words', jsonb_build_object('civil', p_server->>'civil_word', 'undercover', p_server->>'undercover_word'),
    'roles', v_roles,
    'results', v_results);
  return jsonb_build_object('state', p_state, 'server', p_server, 'results', v_results);
end $$;

create or replace function public._uc_tally(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_cands   text[] := array(select jsonb_array_elements_text(p_state->'candidates'));
  v_votes   jsonb := coalesce(p_server->'votes', '{}'::jsonb);
  v_counts  jsonb;
  v_max     integer;
  v_tied    text[];
  v_elim    text;
  v_outcome text;
  v_role    text;
  v_rec     jsonb;
begin
  select jsonb_object_agg(c, (select count(*)::integer from jsonb_each_text(v_votes) v where v.value = c))
    into v_counts from unnest(v_cands) c;
  select max(value::integer) into v_max from jsonb_each_text(v_counts);
  v_tied := array(select key from jsonb_each_text(v_counts) where value::integer = v_max order by key);

  if cardinality(v_tied) > 1 and not coalesce((p_state->>'revote')::boolean, false) then
    -- Égalité : un seul revote entre ex-aequo.
    p_state := p_state || jsonb_build_object(
      'phase', 'vote', 'revote', true, 'candidates', to_jsonb(v_tied), 'voters', '[]'::jsonb,
      'last_vote', jsonb_build_object('round', p_state->'round', 'votes', v_votes, 'counts', v_counts,
                                      'outcome', 'revote', 'tied', to_jsonb(v_tied)));
    p_server := jsonb_set(p_server, '{votes}', '{}'::jsonb);
    return jsonb_build_object('state', p_state, 'server', p_server);
  end if;

  if cardinality(v_tied) > 1 then
    v_elim := v_tied[1 + floor(random() * cardinality(v_tied))::integer];
    v_outcome := 'random';
  else
    v_elim := v_tied[1];
    v_outcome := 'majority';
  end if;

  v_role := p_server->'roles'->>v_elim;
  v_rec := jsonb_build_object('profile_id', v_elim, 'role', v_role, 'round', p_state->'round');

  p_state := p_state || jsonb_build_object(
    'phase', case when v_role = 'mrwhite' then 'mrwhite_guess' else 'elimination' end,
    'alive', (select coalesce(jsonb_agg(a order by o), '[]'::jsonb)
                from jsonb_array_elements_text(p_state->'alive') with ordinality as t(a, o)
               where a <> v_elim),
    'eliminated', coalesce(p_state->'eliminated', '[]'::jsonb) || jsonb_build_array(v_rec),
    'current_elimination', v_rec,
    'voters', '[]'::jsonb,
    'candidates', '[]'::jsonb,
    'last_vote', jsonb_build_object('round', p_state->'round', 'votes', v_votes, 'counts', v_counts,
                                    'outcome', v_outcome, 'tied', to_jsonb(v_tied)));
  p_server := jsonb_set(p_server, '{votes}', '{}'::jsonb);
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

create or replace function public.game_undercover_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_type    text := p_action->>'type';
  v_phase   text := p_state->>'phase';
  v_actor   text := p_actor::text;
  v_target  text;
  v_voters  jsonb;
  v_guess   text;
  v_correct boolean;
  v_civ     integer;
  v_inf     integer;
  v_order   text[];
  v_n       integer;
  v_idx     integer;
  v_starter text;
  j         integer;
begin
  if v_type = 'start_vote' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase <> 'describe' then raise exception 'wrong_phase'; end if;
    p_state := p_state || jsonb_build_object(
      'phase', 'vote', 'revote', false, 'candidates', p_state->'alive', 'voters', '[]'::jsonb);
    p_server := jsonb_set(p_server, '{votes}', '{}'::jsonb);
    return jsonb_build_object('state', p_state, 'server', p_server);

  elsif v_type = 'vote' then
    if v_phase <> 'vote' then raise exception 'wrong_phase'; end if;
    if not ((p_state->'alive') ? v_actor) then raise exception 'not_alive'; end if;
    begin
      v_target := (p_action->>'target')::uuid::text;
    exception when others then
      raise exception 'invalid_target';
    end;
    if v_target is null or not ((p_state->'candidates') ? v_target) then raise exception 'invalid_target'; end if;
    if v_target = v_actor then raise exception 'cannot_vote_self'; end if;

    p_server := jsonb_set(p_server, array['votes', v_actor], to_jsonb(v_target), true);
    select coalesce(jsonb_agg(a order by o), '[]'::jsonb) into v_voters
      from jsonb_array_elements_text(p_state->'alive') with ordinality as t(a, o)
     where (p_server->'votes') ? a;
    p_state := jsonb_set(p_state, '{voters}', v_voters);

    if jsonb_array_length(v_voters) >= jsonb_array_length(p_state->'alive') then
      return public._uc_tally(p_state, p_server);
    end if;
    return jsonb_build_object('state', p_state, 'server', p_server);

  elsif v_type = 'close_vote' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase <> 'vote' then raise exception 'wrong_phase'; end if;
    return public._uc_tally(p_state, p_server);

  elsif v_type = 'guess' then
    if v_phase <> 'mrwhite_guess' then raise exception 'wrong_phase'; end if;
    if v_actor <> (p_state->'current_elimination'->>'profile_id') then raise exception 'not_your_guess'; end if;
    v_guess := left(btrim(coalesce(p_action->>'word', '')), 60);
    if v_guess = '' then raise exception 'invalid_guess'; end if;
    v_correct := public._normalize_word(v_guess) <> ''
                 and public._normalize_word(v_guess) = public._normalize_word(p_server->>'civil_word');
    p_state := p_state || jsonb_build_object('mrwhite_guess',
      jsonb_build_object('profile_id', v_actor, 'word', v_guess, 'correct', v_correct));
    if v_correct then
      return public._uc_finish(p_state, p_server, 'mrwhite');
    end if;
    p_state := p_state || jsonb_build_object('phase', 'elimination');
    return jsonb_build_object('state', p_state, 'server', p_server);

  elsif v_type = 'skip_guess' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase <> 'mrwhite_guess' then raise exception 'wrong_phase'; end if;
    p_state := p_state || jsonb_build_object(
      'phase', 'elimination',
      'mrwhite_guess', jsonb_build_object('profile_id', p_state->'current_elimination'->>'profile_id',
                                          'word', null, 'correct', false));
    return jsonb_build_object('state', p_state, 'server', p_server);

  elsif v_type = 'next' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase <> 'elimination' then raise exception 'wrong_phase'; end if;

    select count(*) filter (where p_server->'roles'->>a = 'civil'),
           count(*) filter (where p_server->'roles'->>a <> 'civil')
      into v_civ, v_inf
      from jsonb_array_elements_text(p_state->'alive') as t(a);

    if v_inf = 0 then
      return public._uc_finish(p_state, p_server, 'civils');
    elsif v_civ <= v_inf then
      return public._uc_finish(p_state, p_server, 'infiltres');
    end if;

    -- Manche suivante : le premier orateur tourne au joueur vivant suivant.
    v_order := array(select jsonb_array_elements_text(p_state->'order'));
    v_n := cardinality(v_order);
    v_idx := coalesce(array_position(v_order, p_state->>'starter'), 1);
    for j in 1 .. v_n loop
      if (p_state->'alive') ? v_order[((v_idx - 1 + j) % v_n) + 1] then
        v_starter := v_order[((v_idx - 1 + j) % v_n) + 1];
        exit;
      end if;
    end loop;

    p_state := p_state || jsonb_build_object(
      'phase', 'describe',
      'round', (p_state->>'round')::integer + 1,
      'starter', v_starter,
      'current_elimination', null,
      'mrwhite_guess', null,
      'voters', '[]'::jsonb,
      'candidates', '[]'::jsonb,
      'revote', false);
    p_server := jsonb_set(p_server, '{votes}', '{}'::jsonb);
    return jsonb_build_object('state', p_state, 'server', p_server);

  else
    raise exception 'unknown_action';
  end if;
end $$;

-- =============================================================================
-- 10. MOTEUR : démarrage + action générique
-- =============================================================================

-- Résout le nom de la fonction d'un jeu et vérifie qu'elle existe.
-- p_game_id 'petit-bac' + 'action' -> 'game_petit_bac_action'.
create or replace function public._game_fn(p_game_id text, p_suffix text, p_args text)
returns text language plpgsql stable security definer
set search_path = public, extensions
as $$
declare v_fn text;
begin
  if p_game_id is null or p_game_id !~ '^[a-z0-9-]{1,40}$' then raise exception 'unknown_game'; end if;
  v_fn := 'game_' || replace(p_game_id, '-', '_') || '_' || p_suffix;
  if to_regprocedure(format('public.%I(%s)', v_fn, p_args)) is null then
    raise exception 'unknown_game';
  end if;
  return v_fn;
end $$;

-- p_options peut contenir "player_ids": [uuid] pour ne faire jouer qu'une partie
-- des joueurs de la soirée (par défaut : tous les joueurs de la soirée).
create or replace function public.start_match(p_soiree_id uuid, p_game_id text, p_options jsonb)
returns uuid language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me      uuid := public._require_profile();
  v_s       public.soirees%rowtype;
  v_players uuid[];
  v_opts    jsonb := coalesce(p_options, '{}'::jsonb);
  v_start   jsonb;
  v_id      uuid := gen_random_uuid();
begin
  select * into v_s from public.soirees where id = p_soiree_id for update;
  if not found then raise exception 'soiree_not_found'; end if;
  if v_s.host_id <> v_me then raise exception 'not_host'; end if;
  if v_s.status = 'ended' then raise exception 'soiree_ended'; end if;
  if exists (select 1 from public.matches where soiree_id = p_soiree_id and status <> 'finished') then
    raise exception 'match_in_progress';
  end if;

  v_players := array(select profile_id from public.soiree_players
                      where soiree_id = p_soiree_id order by joined_at, profile_id);
  if jsonb_typeof(v_opts->'player_ids') = 'array' then
    if exists (select 1 from jsonb_array_elements_text(v_opts->'player_ids') x
                where not (x::uuid = any(v_players))) then
      raise exception 'player_not_in_soiree';
    end if;
    v_players := array(select p from unnest(v_players) with ordinality as t(p, o)
                        where p::text in (select x::uuid::text from jsonb_array_elements_text(v_opts->'player_ids') x)
                        order by o);
  end if;

  -- Dispatch dynamique : game_<id>_start(uuid[], jsonb) (tirets -> underscores).
  execute format('select public.%I($1, $2)', public._game_fn(p_game_id, 'start', 'uuid[], jsonb'))
     into v_start using v_players, v_opts;

  insert into public.matches(id, soiree_id, game_id, status, state)
  values (v_id, p_soiree_id, p_game_id, 'playing', v_start->'state');
  insert into public.match_server_state(match_id, data)
  values (v_id, coalesce(v_start->'server', '{}'::jsonb));
  insert into public.match_secrets(match_id, profile_id, secret)
  select v_id, key::uuid, value from jsonb_each(coalesce(v_start->'secrets', '{}'::jsonb));

  update public.soirees set status = 'active', started_at = coalesce(started_at, now())
   where id = p_soiree_id;
  return v_id;
end $$;

-- Action générique. Actions communes : {"type":"abort"} (hôte : annule la partie
-- sans résultats). Le reste est dispatché vers game_<id>_action. Renvoie le state public.
create or replace function public.game_action(p_match_id uuid, p_action jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me      uuid := public._require_profile();
  v_m       public.matches%rowtype;
  v_host    uuid;
  v_is_host boolean;
  v_server  jsonb;
  v_res     jsonb;
  v_state   jsonb;
  v_fin     jsonb;
begin
  if p_action is null or jsonb_typeof(p_action) <> 'object' or p_action->>'type' is null then
    raise exception 'invalid_action';
  end if;

  select * into v_m from public.matches where id = p_match_id for update;
  if not found then raise exception 'match_not_found'; end if;
  select host_id into v_host from public.soirees where id = v_m.soiree_id;
  v_is_host := (v_host = v_me);
  if not (v_is_host or (v_m.state->'players') ? v_me::text) then raise exception 'not_in_match'; end if;
  if v_m.status <> 'playing' then raise exception 'match_not_playing'; end if;

  if p_action->>'type' = 'abort' then
    if not v_is_host then raise exception 'not_host'; end if;
    v_state := v_m.state || jsonb_build_object('phase', 'aborted', 'aborted', true,
                                               'seq', coalesce((v_m.state->>'seq')::integer, 0) + 1);
    update public.matches set state = v_state, status = 'finished', finished_at = now() where id = p_match_id;
    return v_state;
  end if;

  select data into v_server from public.match_server_state where match_id = p_match_id for update;
  v_server := coalesce(v_server, '{}'::jsonb);

  -- Dispatch dynamique : game_<id>_action(jsonb, jsonb, uuid, boolean, jsonb).
  execute format('select public.%I($1, $2, $3, $4, $5)',
                 public._game_fn(v_m.game_id, 'action', 'jsonb, jsonb, uuid, boolean, jsonb'))
     into v_res using v_m.state, v_server, v_me, v_is_host, p_action;

  update public.match_server_state set data = v_res->'server' where match_id = p_match_id;
  -- Un jeu peut mettre à jour des secrets en cours de partie (mains de cartes,
  -- mot du dessinateur…) : clé "secrets" = {"<profile_id>": <secret>} (upsert).
  if jsonb_typeof(v_res->'secrets') = 'object' then
    insert into public.match_secrets(match_id, profile_id, secret)
    select p_match_id, key::uuid, value from jsonb_each(v_res->'secrets')
    on conflict (match_id, profile_id) do update set secret = excluded.secret;
  end if;
  -- seq : compteur monotone de versions du state public. Le front s'en sert pour
  -- ignorer un state plus ancien reçu en retard (réponse RPC vs évènement Realtime).
  v_state := (v_res->'state') || jsonb_build_object('seq', coalesce((v_m.state->>'seq')::integer, 0) + 1);

  if jsonb_typeof(v_res->'results') = 'array' then
    v_fin := public.finish_match(p_match_id, v_res->'results');
    v_state := v_state || jsonb_build_object('new_unlocks', v_fin->'new_unlocks',
                                             'xp_gained', v_fin->'xp_gained',
                                             'new_tenues', coalesce(v_fin->'new_tenues', '{}'::jsonb));
    update public.matches set state = v_state, status = 'finished', finished_at = now() where id = p_match_id;
  else
    update public.matches set state = v_state where id = p_match_id;
  end if;
  return v_state;
end $$;

-- =============================================================================
-- 11. VUES DE CLASSEMENT (security_invoker : respectent les RLS de l'appelant)
-- =============================================================================

drop view if exists public.leaderboard_general;
create view public.leaderboard_general with (security_invoker = true) as
select p.id as profile_id, p.slug, p.first_name, p.nickname, p.equipped_expression,
       p.xp, public.level_for_xp(p.xp) as level,
       coalesce(s.wins, 0) as wins,
       coalesce(s.games_played, 0) as games_played,
       rank() over (order by coalesce(s.wins, 0) desc) as rank
from public.profiles p
left join public.player_stats s on s.profile_id = p.id;

drop view if exists public.leaderboard_by_game;
create view public.leaderboard_by_game with (security_invoker = true) as
select mp.game_id, p.id as profile_id, p.slug, p.first_name, p.nickname, p.equipped_expression,
       count(*)::integer as games_played,
       (count(*) filter (where mp.won))::integer as wins,
       coalesce(sum(mp.points), 0)::integer as points_total,
       rank() over (partition by mp.game_id
                    order by count(*) filter (where mp.won) desc, coalesce(sum(mp.points), 0) desc) as rank
from public.match_players mp
join public.profiles p on p.id = mp.profile_id
group by mp.game_id, p.id;

-- =============================================================================
-- 12. RLS (lecture seule ; aucune policy insert/update/delete)
-- =============================================================================

alter table public.profiles            enable row level security;
alter table public.profile_credentials enable row level security;
alter table public.device_sessions     enable row level security;
alter table public.login_attempts      enable row level security;
alter table public.friendships         enable row level security;
alter table public.soirees             enable row level security;
alter table public.soiree_players      enable row level security;
alter table public.matches             enable row level security;
alter table public.match_players       enable row level security;
alter table public.match_secrets       enable row level security;
alter table public.match_server_state  enable row level security;
alter table public.unlocks             enable row level security;
alter table public.player_stats        enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (true);

drop policy if exists device_sessions_select on public.device_sessions;
create policy device_sessions_select on public.device_sessions for select to authenticated
  using (auth_uid = auth.uid());

drop policy if exists friendships_select on public.friendships;
create policy friendships_select on public.friendships for select to authenticated
  using (status = 'accepted'
         or requester_id = (select public.current_profile_id())
         or addressee_id = (select public.current_profile_id()));

drop policy if exists soirees_select on public.soirees;
create policy soirees_select on public.soirees for select to authenticated
  using (public.is_soiree_member(id));

drop policy if exists soiree_players_select on public.soiree_players;
create policy soiree_players_select on public.soiree_players for select to authenticated
  using (public.is_soiree_member(soiree_id));

drop policy if exists matches_select on public.matches;
create policy matches_select on public.matches for select to authenticated
  using (public.is_soiree_member(soiree_id));

drop policy if exists match_players_select on public.match_players;
create policy match_players_select on public.match_players for select to authenticated using (true);

drop policy if exists match_secrets_select on public.match_secrets;
create policy match_secrets_select on public.match_secrets for select to authenticated
  using (profile_id = (select public.current_profile_id()));

drop policy if exists unlocks_select on public.unlocks;
create policy unlocks_select on public.unlocks for select to authenticated using (true);

drop policy if exists player_stats_select on public.player_stats;
create policy player_stats_select on public.player_stats for select to authenticated using (true);
-- profile_credentials, login_attempts, match_server_state : aucune policy = inaccessibles.

-- =============================================================================
-- 13. GRANTS
-- =============================================================================

revoke all on table
  public.profiles, public.profile_credentials, public.device_sessions, public.login_attempts,
  public.friendships, public.soirees, public.soiree_players, public.matches, public.match_players,
  public.match_secrets, public.match_server_state, public.unlocks, public.player_stats,
  public.leaderboard_general, public.leaderboard_by_game
from anon, authenticated;

grant select on table
  public.profiles, public.device_sessions, public.friendships, public.soirees, public.soiree_players,
  public.matches, public.match_players, public.match_secrets, public.unlocks, public.player_stats,
  public.leaderboard_general, public.leaderboard_by_game
to authenticated;

-- Fonctions internes : personne d'autre que le propriétaire.
revoke all on function public._require_profile() from public, anon, authenticated;
revoke all on function public._profile_json(uuid) from public, anon, authenticated;
revoke all on function public._active_soiree_of(uuid) from public, anon, authenticated;
revoke all on function public._soiree_json(uuid) from public, anon, authenticated;
revoke all on function public._normalize_word(text) from public, anon, authenticated;
revoke all on function public.evaluate_unlocks(uuid) from public, anon, authenticated;
revoke all on function public._unlocks_map(uuid[]) from public, anon, authenticated;
revoke all on function public._gen_soiree_code() from public, anon, authenticated;
revoke all on function public._end_soiree(uuid, boolean) from public, anon, authenticated;
revoke all on function public._cleanup_stale_soirees() from public, anon, authenticated;
revoke all on function public.finish_match(uuid, jsonb) from public, anon, authenticated;
revoke all on function public._after_finish_match(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.game_qui_de_nous_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public._qdn_reveal(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._qdn_finish(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.game_qui_de_nous_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;
revoke all on function public.game_undercover_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public._uc_finish(jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public._uc_tally(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.game_undercover_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;
revoke all on function public._game_fn(text, text, text) from public, anon, authenticated;

-- RPC publiques.
revoke all on function public.list_profiles_public() from public;
grant execute on function public.list_profiles_public() to anon, authenticated;

revoke all on function public.level_for_xp(integer) from public, anon;
revoke all on function public.current_profile_id() from public, anon;
revoke all on function public.is_soiree_member(uuid) from public, anon;
revoke all on function public.login_profile(text, text) from public, anon;
revoke all on function public.logout_device() from public, anon;
revoke all on function public.admin_reset_pin(text) from public, anon;
revoke all on function public.update_nickname(text) from public, anon;
revoke all on function public.equip_expression(text) from public, anon;
revoke all on function public.send_friend_request(uuid) from public, anon;
revoke all on function public.respond_friend_request(uuid, boolean) from public, anon;
revoke all on function public.remove_friend(uuid) from public, anon;
revoke all on function public.my_active_soiree() from public, anon;
revoke all on function public.create_soiree(uuid[]) from public, anon;
revoke all on function public.join_soiree_by_code(text) from public, anon;
revoke all on function public.leave_soiree() from public, anon;
revoke all on function public.end_soiree(uuid) from public, anon;
revoke all on function public.start_match(uuid, text, jsonb) from public, anon;
revoke all on function public.game_action(uuid, jsonb) from public, anon;

grant execute on function
  public.level_for_xp(integer),
  public.current_profile_id(),
  public.is_soiree_member(uuid),
  public.login_profile(text, text),
  public.logout_device(),
  public.admin_reset_pin(text),
  public.update_nickname(text),
  public.equip_expression(text),
  public.send_friend_request(uuid),
  public.respond_friend_request(uuid, boolean),
  public.remove_friend(uuid),
  public.my_active_soiree(),
  public.create_soiree(uuid[]),
  public.join_soiree_by_code(text),
  public.leave_soiree(),
  public.end_soiree(uuid),
  public.start_match(uuid, text, jsonb),
  public.game_action(uuid, jsonb)
to authenticated;

-- =============================================================================
-- 14. REALTIME (idempotent)
-- =============================================================================

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['soirees', 'soiree_players', 'matches', 'match_players', 'friendships', 'match_secrets'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- =============================================================================
-- 15. HORLOGE SERVEUR (minuteurs des jeux)
-- =============================================================================
-- Les jeux à minuteur stockent des échéances ISO dans leur state (ex. "deadline").
-- Le front calcule son décalage d'horloge avec server_now() (hook useServerClock).
-- Convention : n'importe quel joueur peut envoyer {"type":"tick"} ; le jeu vérifie
-- côté serveur que l'échéance est dépassée (idempotent) et fait avancer la phase.
create or replace function public.server_now()
returns timestamptz language sql stable
set search_path = public, extensions
as $$ select now() $$;
revoke all on function public.server_now() from public, anon;
grant execute on function public.server_now() to authenticated;


-- ===== features\tenues.sql =====
-- =============================================================================
-- Tenues (skins vestimentaires) — idempotent, exécuté APRÈS schema.sql.
-- Une tenue = une variante du chibi (public/chibis/<slug>/<tenue>/<expr>.webp),
-- débloquée par une condition du catalogue (aujourd'hui : N victoires dans un jeu).
-- =============================================================================

-- ---- Tables -----------------------------------------------------------------

create table if not exists public.tenues (
  id             text primary key,
  label          text not null,
  emoji          text not null,
  game_id        text,                                  -- null = tous jeux confondus
  condition_type text not null default 'game_wins',     -- 'default' | 'game_wins' (extensible)
  threshold      integer not null default 10,
  sort_order     integer not null default 100,
  has_art        boolean not null default false         -- informatif ; le front lit tenues-art.generated.ts
);

create table if not exists public.tenue_unlocks (
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  tenue_id    text not null references public.tenues(id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  primary key (profile_id, tenue_id)
);
create index if not exists tenue_unlocks_profile_idx on public.tenue_unlocks(profile_id);

alter table public.profiles add column if not exists equipped_tenue text not null default 'default';

-- ---- Catalogue (has_art jamais écrasé) ----------------------------------------

insert into public.tenues (id, label, emoji, game_id, condition_type, threshold, sort_order) values
  ('default',  'Tenue de soirée', '🎉', null,             'default',   0,  0),
  ('star',     'Star',            '🌟', 'qui-de-nous',    'game_wins', 10, 10),
  ('espion',   'Espion',          '🕵️', 'undercover',     'game_wins', 10, 20),
  ('croupier', 'Croupier',        '🃏', 'pas-de-bol',     'game_wins', 10, 30),
  ('prof',     'Prof',            '🎓', 'cerveau-en-fete','game_wins', 10, 40),
  ('ecolier',  'Écolier',         '🎒', 'petit-bac',      'game_wins', 10, 50),
  ('artiste',  'Artiste',         '🎨', 'dessine-devine', 'game_wins', 10, 60)
on conflict (id) do update
  set label          = excluded.label,
      emoji          = excluded.emoji,
      game_id        = excluded.game_id,
      condition_type = excluded.condition_type,
      threshold      = excluded.threshold,
      sort_order     = excluded.sort_order;

-- Tenue équipée invalide -> retour à 'default'
update public.profiles set equipped_tenue = 'default'
 where equipped_tenue not in (select id from public.tenues);

-- ---- Profil : ajoute equipped_tenue -------------------------------------------

create or replace function public._profile_json(p_id uuid)
returns jsonb language sql stable security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'id', p.id, 'slug', p.slug, 'first_name', p.first_name, 'nickname', p.nickname,
    'is_admin', p.is_admin, 'equipped_expression', p.equipped_expression,
    'equipped_tenue', p.equipped_tenue,
    'expressions', to_jsonb(p.expressions), 'xp', p.xp, 'level', public.level_for_xp(p.xp),
    'sort_order', p.sort_order, 'created_at', p.created_at)
  from public.profiles p where p.id = p_id
$$;

-- Changement des colonnes de retour : drop obligatoire.
drop function if exists public.list_profiles_public();
create function public.list_profiles_public()
returns table (id uuid, slug text, first_name text, nickname text,
               equipped_expression text, equipped_tenue text, expressions text[], has_pin boolean)
language sql stable security definer
set search_path = public, extensions
as $$
  select p.id, p.slug, p.first_name, p.nickname, p.equipped_expression, p.equipped_tenue, p.expressions,
         exists (select 1 from public.profile_credentials c where c.profile_id = p.id)
  from public.profiles p
  order by p.sort_order, p.slug
$$;
revoke all on function public.list_profiles_public() from public;
grant execute on function public.list_profiles_public() to anon, authenticated;

-- ---- Vues de classement : ajoutent equipped_tenue -----------------------------

drop view if exists public.leaderboard_general;
create view public.leaderboard_general with (security_invoker = true) as
select p.id as profile_id, p.slug, p.first_name, p.nickname, p.equipped_expression, p.equipped_tenue,
       p.xp, public.level_for_xp(p.xp) as level,
       coalesce(s.wins, 0) as wins,
       coalesce(s.games_played, 0) as games_played,
       rank() over (order by coalesce(s.wins, 0) desc) as rank
from public.profiles p
left join public.player_stats s on s.profile_id = p.id;

drop view if exists public.leaderboard_by_game;
create view public.leaderboard_by_game with (security_invoker = true) as
select mp.game_id, p.id as profile_id, p.slug, p.first_name, p.nickname, p.equipped_expression, p.equipped_tenue,
       count(*)::integer as games_played,
       (count(*) filter (where mp.won))::integer as wins,
       coalesce(sum(mp.points), 0)::integer as points_total,
       rank() over (partition by mp.game_id
                    order by count(*) filter (where mp.won) desc, coalesce(sum(mp.points), 0) desc) as rank
from public.match_players mp
join public.profiles p on p.id = mp.profile_id
group by mp.game_id, p.id;

revoke all on table public.leaderboard_general, public.leaderboard_by_game from anon, authenticated;
grant select on table public.leaderboard_general, public.leaderboard_by_game to authenticated;

-- ---- RLS ----------------------------------------------------------------------

alter table public.tenues enable row level security;
alter table public.tenue_unlocks enable row level security;

drop policy if exists tenues_select on public.tenues;
create policy tenues_select on public.tenues for select to authenticated using (true);

drop policy if exists tenue_unlocks_select on public.tenue_unlocks;
create policy tenue_unlocks_select on public.tenue_unlocks for select to authenticated using (true);

revoke all on table public.tenues, public.tenue_unlocks from anon, authenticated;
grant select on table public.tenues, public.tenue_unlocks to authenticated;

-- ---- Évaluation ---------------------------------------------------------------

-- Débloque les tenues dont la condition est remplie ; renvoie les ids NOUVELLEMENT débloqués.
-- condition_type : 'game_wins' = au moins `threshold` victoires (match_players.won) dans `game_id`
-- (tous jeux si game_id est null). Ajouter un type = ajouter un `when` ci-dessous.
create or replace function public.evaluate_tenues(p_profile_id uuid)
returns text[] language plpgsql security definer
set search_path = public, extensions
as $$
declare
  t      record;
  v_ok   boolean;
  v_new  text[] := '{}';
  v_rows integer;
begin
  for t in
    select * from public.tenues x
     where x.condition_type <> 'default'
       and not exists (select 1 from public.tenue_unlocks u
                        where u.profile_id = p_profile_id and u.tenue_id = x.id)
     order by x.sort_order
  loop
    v_ok := case t.condition_type
      when 'game_wins' then
        (select count(*) from public.match_players mp
          where mp.profile_id = p_profile_id and mp.won
            and (t.game_id is null or mp.game_id = t.game_id)) >= t.threshold
      else false
    end;
    if v_ok then
      insert into public.tenue_unlocks(profile_id, tenue_id) values (p_profile_id, t.id)
      on conflict do nothing;
      get diagnostics v_rows = row_count;
      if v_rows > 0 then v_new := v_new || t.id; end if;
    end if;
  end loop;
  return v_new;
end $$;

-- Hook de fin de partie (cf. schema.sql) : {profile_id: [tenue_ids]} (non vides seulement).
create or replace function public._after_finish_match(p_match_id uuid, p_profile_ids uuid[])
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_id  uuid;
  v_new text[];
  v_map jsonb := '{}'::jsonb;
begin
  foreach v_id in array coalesce(p_profile_ids, '{}') loop
    v_new := public.evaluate_tenues(v_id);
    if coalesce(array_length(v_new, 1), 0) > 0 then
      v_map := v_map || jsonb_build_object(v_id::text, to_jsonb(v_new));
    end if;
  end loop;
  return v_map;
end $$;

-- ---- Équiper -------------------------------------------------------------------

create or replace function public.equip_tenue(p_tenue text)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := public._require_profile();
begin
  if not exists (select 1 from public.tenues where id = p_tenue) then
    raise exception 'unknown_tenue';
  end if;
  if p_tenue <> 'default' and not exists (
    select 1 from public.tenue_unlocks where profile_id = v_me and tenue_id = p_tenue
  ) then
    raise exception 'tenue_locked';
  end if;
  update public.profiles set equipped_tenue = p_tenue where id = v_me;
  return public._profile_json(v_me);
end $$;

-- ---- Grants --------------------------------------------------------------------

revoke all on function public._profile_json(uuid) from public, anon, authenticated;
revoke all on function public.evaluate_tenues(uuid) from public, anon, authenticated;
revoke all on function public._after_finish_match(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.equip_tenue(text) from public, anon;
grant execute on function public.equip_tenue(text) to authenticated;

-- Rattrapage (idempotent) : victoires déjà acquises avant l'installation des tenues.
select public.evaluate_tenues(id) from public.profiles;


-- ===== games\cerveau-en-fete.sql =====
-- =============================================================================
-- JEU « cerveau-en-fete » : quiz de culture générale multi-écrans
-- =============================================================================
-- Idempotent (create or replace). Contrat : src/games/cerveau-en-fete/types.ts.
--
-- p_options : {"duration": 20, "questions": [{id, theme, difficulty, prompt, image?,
--              answer, aliases?, distractors?, mode: "typed"|"mcq"}]}
-- Le serveur garde les réponses dans match_server_state ; le state public ne contient
-- jamais la réponse avant la phase "reveal".
--
-- Phases : question -> reveal -> question ... -> finished.
-- Échéances : state.deadline (fin du temps de réponse, puis fin de la révélation
-- automatique, CEF_REVEAL_SECONDS = 8 s). N'importe quel joueur envoie {"type":"tick"}.
-- Toute action portant un "round" différent de la manche courante est ignorée
-- sans erreur (state inchangé) : clics en retard, ticks concurrents.

-- Normalisation tolérante : casse, accents, ligatures, ponctuation/espaces,
-- article en tête (le, la, les, l', un, une, des).
create or replace function public._cef_norm(p text)
returns text language sql immutable
set search_path = public, extensions
as $$
  select replace(
    regexp_replace(
      btrim(regexp_replace(
        lower(translate(
          replace(replace(replace(replace(left(coalesce(p, ''), 120), 'œ', 'oe'), 'Œ', 'OE'), 'æ', 'ae'), 'Æ', 'AE'),
          'àâäáãåçéèêëíìîïñóòôöõúùûüýÿÀÂÄÁÃÅÇÉÈÊËÍÌÎÏÑÓÒÔÖÕÚÙÛÜÝŸ',
          'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUYY')),
        '[^a-z0-9]+', ' ', 'g')),
      '^(les|le|la|l|une|un|des) ', ''),
    ' ', '')
$$;

-- Distance de Levenshtein (implémentation maison : pas besoin de fuzzystrmatch).
create or replace function public._cef_lev(a text, b text)
returns integer language plpgsql immutable
set search_path = public, extensions
as $$
declare
  la   integer := char_length(a);
  lb   integer := char_length(b);
  prev integer[];
  cur  integer[];
  i    integer;
  j    integer;
begin
  if la = 0 then return lb; end if;
  if lb = 0 then return la; end if;
  prev := array(select generate_series(0, lb));
  for i in 1..la loop
    cur := array[i];
    for j in 1..lb loop
      cur := cur || least(prev[j + 1] + 1, cur[j] + 1,
                          prev[j] + case when substr(a, i, 1) = substr(b, j, 1) then 0 else 1 end);
    end loop;
    prev := cur;
  end loop;
  return prev[lb + 1];
end $$;

-- La proposition correspond-elle à l'une des formes acceptées (déjà normalisées) ?
-- Fautes de frappe : distance <= 1 jusqu'à 6 caractères, <= 2 au-delà ;
-- exact obligatoire si la réponse contient un chiffre (dates !) ou fait <= 3 caractères.
create or replace function public._cef_match(p_guess text, p_accept jsonb)
returns boolean language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_g   text := public._cef_norm(p_guess);
  v_a   text;
  v_tol integer;
begin
  if v_g = '' then return false; end if;
  for v_a in select value from jsonb_array_elements_text(coalesce(p_accept, '[]'::jsonb)) loop
    if v_g = v_a then return true; end if;
    if v_a ~ '[0-9]' or char_length(v_a) <= 3 then continue; end if;
    v_tol := case when char_length(v_a) <= 6 then 1 else 2 end;
    if abs(char_length(v_g) - char_length(v_a)) <= v_tol and public._cef_lev(v_g, v_a) <= v_tol then
      return true;
    end if;
  end loop;
  return false;
end $$;

-- Ouvre la question d'index p_idx (0-based).
create or replace function public._cef_open(p_state jsonb, p_server jsonb, p_idx integer)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_q   jsonb := p_server->'questions'->p_idx;
  v_now timestamptz := now();
begin
  p_state := p_state || jsonb_build_object(
    'phase', 'question',
    'round', p_idx + 1,
    'started_at', to_jsonb(v_now),
    'deadline', to_jsonb(v_now + make_interval(secs => (p_state->>'duration')::integer)),
    'question', v_q - 'answer' - 'accept' - 'correct',
    'found', '[]'::jsonb, 'passed', '[]'::jsonb, 'missed', '[]'::jsonb);
  p_server := p_server || jsonb_build_object('picks', '{}'::jsonb, 'tries', '{}'::jsonb);
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

create or replace function public.game_cerveau_en_fete_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_in      jsonb := p_options->'questions';
  v_dur     integer;
  v_qs      jsonb := '[]'::jsonb;
  e         jsonb;
  v_mode    text;
  v_acc     jsonb;
  v_dis     jsonb;
  v_choices jsonb;
  v_correct integer;
  v_img     jsonb;
  v_zero    jsonb;
  v_st      jsonb;
begin
  if cardinality(p_players) < 2 then raise exception 'not_enough_players'; end if;
  if v_in is null or jsonb_typeof(v_in) <> 'array' or jsonb_array_length(v_in) = 0 then
    raise exception 'missing_questions';
  end if;
  begin
    v_dur := coalesce(nullif(p_options->>'duration', '')::integer, 20);
  exception when others then v_dur := 20;
  end;
  v_dur := least(greatest(v_dur, 5), 120);

  for e in select value from jsonb_array_elements(v_in) with ordinality t(value, o) order by o limit 50 loop
    if jsonb_typeof(e) <> 'object' or jsonb_typeof(e->'prompt') <> 'string' or jsonb_typeof(e->'answer') <> 'string'
       or char_length(btrim(e->>'prompt')) = 0 or char_length(e->>'prompt') > 500
       or char_length(btrim(e->>'answer')) = 0 or char_length(e->>'answer') > 120 then
      raise exception 'invalid_questions';
    end if;

    -- 3 premiers distracteurs valides, distincts de la réponse.
    select coalesce(jsonb_agg(d order by o), '[]'::jsonb) into v_dis
      from (select d, o from jsonb_array_elements_text(
                     case when jsonb_typeof(e->'distractors') = 'array' then e->'distractors' else '[]'::jsonb end)
                     with ordinality t(d, o)
             where char_length(btrim(d)) between 1 and 120 and d <> e->>'answer'
             order by o limit 3) z;

    -- Formes acceptées (normalisées) : réponse + alias.
    select coalesce(jsonb_agg(distinct x), '[]'::jsonb) into v_acc
      from (select public._cef_norm(e->>'answer') as x
            union
            select public._cef_norm(a) from jsonb_array_elements_text(
                     case when jsonb_typeof(e->'aliases') = 'array' then e->'aliases' else '[]'::jsonb end) a) t
     where x <> '';

    v_mode := case when e->>'mode' = 'mcq' then 'mcq' else 'typed' end;
    if v_mode = 'mcq' and jsonb_array_length(v_dis) < 3 then v_mode := 'typed'; end if;
    if v_mode = 'typed' and jsonb_array_length(v_acc) = 0 then
      if jsonb_array_length(v_dis) >= 3 then v_mode := 'mcq'; else raise exception 'invalid_questions'; end if;
    end if;

    v_choices := null;
    v_correct := null;
    if v_mode = 'mcq' then
      select jsonb_agg(c order by random()) into v_choices
        from (select e->>'answer' as c union all select value from jsonb_array_elements_text(v_dis)) y;
      select (o - 1)::integer into v_correct
        from jsonb_array_elements_text(v_choices) with ordinality t(c, o) where c = e->>'answer' limit 1;
    end if;

    v_img := null;
    if jsonb_typeof(e->'image') = 'object' and coalesce(e->'image'->>'url', '') ~ '^https://' then
      v_img := jsonb_build_object('url', left(e->'image'->>'url', 500),
                                  'credit', left(coalesce(e->'image'->>'credit', ''), 200),
                                  'license', left(coalesce(e->'image'->>'license', ''), 60));
    end if;

    v_qs := v_qs || jsonb_build_array(jsonb_build_object(
      'id', left(coalesce(e->>'id', ''), 40),
      'theme', left(coalesce(e->>'theme', ''), 40),
      'difficulty', case when e->>'difficulty' in ('1', '2', '3') then (e->>'difficulty')::integer end,
      'prompt', e->>'prompt',
      'image', v_img,
      'mode', v_mode,
      'choices', v_choices,
      'answer', e->>'answer',
      'accept', v_acc,
      'correct', v_correct));
  end loop;

  select jsonb_object_agg(p::text, 0) into v_zero from unnest(p_players) p;

  v_st := public._cef_open(
    jsonb_build_object(
      'game', 'cerveau-en-fete',
      'round', 1,
      'total_rounds', jsonb_array_length(v_qs),
      'duration', v_dur,
      'reveal_seconds', 8,
      'players', to_jsonb(p_players),
      'scores', v_zero,
      'last_reveal', null,
      'history', '[]'::jsonb,
      'winners', null,
      'results', null),
    jsonb_build_object('questions', v_qs),
    0);
  return v_st || jsonb_build_object('secrets', '{}'::jsonb);
end $$;

-- Passe en révélation : réponse publiée, points ajoutés aux scores.
create or replace function public._cef_reveal(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_round  integer := (p_state->>'round')::integer;
  v_q      jsonb := p_server->'questions'->(v_round - 1);
  v_points jsonb;
begin
  select coalesce(jsonb_object_agg(f->>'profile_id', (f->>'points')::integer), '{}'::jsonb) into v_points
    from jsonb_array_elements(p_state->'found') f;

  p_state := p_state || jsonb_build_object(
    'phase', 'reveal',
    'deadline', to_jsonb(now() + make_interval(secs => coalesce((p_state->>'reveal_seconds')::integer, 8))),
    'scores', (select jsonb_object_agg(key, value::integer + coalesce((v_points->>key)::integer, 0))
                 from jsonb_each_text(p_state->'scores')),
    'last_reveal', jsonb_build_object(
      'round', v_round,
      'question', p_state->'question',
      'answer', v_q->'answer',
      'mode', v_q->'mode',
      'choices', v_q->'choices',
      'correct', v_q->'correct',
      'found', p_state->'found',
      'passed', p_state->'passed',
      'missed', p_state->'missed',
      'picks', coalesce(p_server->'picks', '{}'::jsonb),
      'tries', coalesce(p_server->'tries', '{}'::jsonb),
      'points', v_points),
    'history', coalesce(p_state->'history', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'round', v_round,
      'id', v_q->'id',
      'theme', v_q->'theme',
      'prompt', v_q->'prompt',
      'answer', v_q->'answer',
      'mode', v_q->'mode',
      'found', p_state->'found')));
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

create or replace function public._cef_finish(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_max     integer;
  v_results jsonb;
  v_winners jsonb;
begin
  select coalesce(max(value::integer), 0) into v_max from jsonb_each_text(p_state->'scores');

  -- points (XP = points x 10) : score du quiz / 100 arrondi, pour rester à l'échelle des autres jeux.
  select jsonb_agg(jsonb_build_object(
           'profile_id', t.key,
           'points', round(t.value::integer / 100.0)::integer,
           'won', v_max > 0 and t.value::integer = v_max,
           'placement', t.r,
           'stats', '{}'::jsonb)
         order by t.r, t.key)
    into v_results
    from (select key, value, rank() over (order by value::integer desc) as r
            from jsonb_each_text(p_state->'scores')) t;

  select coalesce(jsonb_agg(key order by key), '[]'::jsonb) into v_winners
    from jsonb_each_text(p_state->'scores') where v_max > 0 and value::integer = v_max;

  p_state := p_state || jsonb_build_object('phase', 'finished', 'deadline', null,
                                           'winners', v_winners, 'results', v_results);
  return jsonb_build_object('state', p_state, 'server', p_server, 'results', v_results);
end $$;

-- Révélation si tous les joueurs ont trouvé, passé ou raté (QCM).
create or replace function public._cef_check_done(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if not exists (
    select 1 from jsonb_array_elements_text(p_state->'players') pl
     where not (p_state->'passed' ? pl) and not (p_state->'missed' ? pl)
       and not exists (select 1 from jsonb_array_elements(p_state->'found') f where f->>'profile_id' = pl))
  then
    return public._cef_reveal(p_state, p_server);
  end if;
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

create or replace function public.game_cerveau_en_fete_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_type     text := p_action->>'type';
  v_phase    text := p_state->>'phase';
  v_round    integer := (p_state->>'round')::integer;
  v_total    integer := (p_state->>'total_rounds')::integer;
  v_deadline timestamptz := (p_state->>'deadline')::timestamptz;
  v_me       text := p_actor::text;
  v_q        jsonb;
  v_same     jsonb := jsonb_build_object('state', p_state, 'server', p_server);
  v_ok       boolean;
  v_idx      integer;
  v_frac     numeric;
  v_rank     integer;
  v_pts      integer;
  v_ms       integer;
begin
  if v_type not in ('answer', 'choose', 'pass', 'skip', 'next', 'tick') then
    raise exception 'unknown_action';
  end if;
  -- Action d'une manche passée (ou partie finie) : ignorée sans erreur.
  if v_phase not in ('question', 'reveal') then return v_same; end if;
  if p_action ? 'round' and (p_action->>'round') is distinct from (p_state->>'round') then
    return v_same;
  end if;

  if v_type = 'tick' then
    if v_deadline is null or now() < v_deadline then return v_same; end if;
    if v_phase = 'question' then return public._cef_reveal(p_state, p_server); end if;
    if v_round >= v_total then return public._cef_finish(p_state, p_server); end if;
    return public._cef_open(p_state, p_server, v_round);

  elsif v_type = 'skip' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase <> 'question' then return v_same; end if;
    return public._cef_reveal(p_state, p_server);

  elsif v_type = 'next' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase <> 'reveal' then return v_same; end if;
    if v_round >= v_total then return public._cef_finish(p_state, p_server); end if;
    return public._cef_open(p_state, p_server, v_round);
  end if;

  -- answer / choose / pass : joueurs uniquement, pendant la question.
  if not (p_state->'players' ? v_me) then raise exception 'not_a_player'; end if;
  if v_phase <> 'question' then return v_same; end if;
  if now() >= v_deadline then return public._cef_reveal(p_state, p_server); end if;
  if (p_state->'passed' ? v_me) or (p_state->'missed' ? v_me)
     or exists (select 1 from jsonb_array_elements(p_state->'found') f where f->>'profile_id' = v_me) then
    return v_same;   -- déjà fini pour cette question
  end if;

  if v_type = 'pass' then
    p_state := jsonb_set(p_state, '{passed}', (p_state->'passed') || to_jsonb(v_me));
    return public._cef_check_done(p_state, p_server);
  end if;

  v_q := p_server->'questions'->(v_round - 1);
  if v_type = 'answer' then
    if v_q->>'mode' <> 'typed' then raise exception 'wrong_mode'; end if;
    if char_length(btrim(coalesce(p_action->>'text', ''))) = 0 then return v_same; end if;
    p_server := jsonb_set(p_server, array['tries', v_me],
                          to_jsonb(coalesce((p_server->'tries'->>v_me)::integer, 0) + 1), true);
    v_ok := public._cef_match(p_action->>'text', v_q->'accept');
    if not v_ok then
      return jsonb_build_object('state', p_state, 'server', p_server);
    end if;
  else -- choose
    if v_q->>'mode' <> 'mcq' then raise exception 'wrong_mode'; end if;
    begin
      v_idx := (p_action->>'index')::integer;
    exception when others then raise exception 'invalid_choice';
    end;
    if v_idx is null or v_idx < 0 or v_idx >= jsonb_array_length(v_q->'choices') then
      raise exception 'invalid_choice';
    end if;
    p_server := jsonb_set(p_server, array['picks', v_me], to_jsonb(v_idx), true);
    v_ok := v_idx = (v_q->>'correct')::integer;
    if not v_ok then
      p_state := jsonb_set(p_state, '{missed}', (p_state->'missed') || to_jsonb(v_me));
      return public._cef_check_done(p_state, p_server);
    end if;
  end if;

  -- Bonne réponse : base + bonus vitesse (proportionnel au temps restant) + premier.
  v_frac := greatest(0, least(1, extract(epoch from (v_deadline - now())) / (p_state->>'duration')::numeric));
  v_rank := jsonb_array_length(p_state->'found') + 1;
  v_pts := case when v_q->>'mode' = 'typed' then 100 + round(100 * v_frac) else 60 + round(60 * v_frac) end
           + case when v_rank = 1 then 20 else 0 end;
  v_ms := greatest(0, round(extract(epoch from (now() - (p_state->>'started_at')::timestamptz)) * 1000));
  p_state := jsonb_set(p_state, '{found}', (p_state->'found') || jsonb_build_array(jsonb_build_object(
    'profile_id', v_me, 'rank', v_rank, 'ms', v_ms, 'points', v_pts)));
  return public._cef_check_done(p_state, p_server);
end $$;

revoke all on function public._cef_norm(text) from public, anon, authenticated;
revoke all on function public._cef_lev(text, text) from public, anon, authenticated;
revoke all on function public._cef_match(text, jsonb) from public, anon, authenticated;
revoke all on function public._cef_open(jsonb, jsonb, integer) from public, anon, authenticated;
revoke all on function public._cef_reveal(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._cef_finish(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._cef_check_done(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.game_cerveau_en_fete_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_cerveau_en_fete_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;


-- ===== games\dessine-devine.sql =====
-- =============================================================================
-- JEU « dessine-devine » (Dessine & devine) — idempotent, à recoller sans risque.
-- Contrat complet : src/games/dessine-devine/types.ts (en-tête).
--
-- Options (p_options de start_match), préparées par le front de l'hôte :
--   {"rounds": 1|2|3, "draw_seconds": 60|80|100, "difficulty": "facile|mixte|difficile",
--    "choices": [[{"word":"chat","aliases":["minou"],"difficulty":1}, x3], ...]}
--   `choices` = au moins rounds × nb_joueurs triplets (un par tour).
-- Le mot à dessiner n'est JAMAIS dans le state public avant la révélation du tour :
-- il vit dans `server` et dans le secret du dessinateur.
-- =============================================================================

-- Horodatage ISO-8601 UTC millisecondes (parsable partout, Safari compris).
create or replace function public._dd_iso(p timestamptz)
returns text language sql immutable
set search_path = public, extensions
as $$ select to_char(p at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;

-- Normalisation d'une proposition / d'un mot : casse, accents, ligatures,
-- ponctuation, articles en tête (le, la, les, l', un, une, des, du, de, d', au, aux).
create or replace function public._dd_norm(p text)
returns text language plpgsql immutable
set search_path = public, extensions
as $$
declare
  s    text;
  prev text;
  base text;
  i    integer := 0;
begin
  s := lower(translate(
    replace(replace(replace(replace(coalesce(p, ''), 'œ', 'oe'), 'Œ', 'OE'), 'æ', 'ae'), 'Æ', 'AE'),
    'àâäáãåçéèêëíìîïñóòôöõúùûüýÿÀÂÄÁÃÅÇÉÈÊËÍÌÎÏÑÓÒÔÖÕÚÙÛÜÝŸ',
    'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUYY'));
  s := btrim(regexp_replace(s, '[^a-z0-9]+', ' ', 'g'));
  base := replace(s, ' ', '');
  loop
    prev := s;
    s := regexp_replace(s, '^(l|d|le|la|les|un|une|des|du|de|au|aux) ', '');
    i := i + 1;
    exit when s = prev or i >= 3;
  end loop;
  s := replace(s, ' ', '');
  if s = '' then return base; end if;
  return s;
end $$;

-- Distance de Levenshtein (implémentation maison : pas de dépendance à fuzzystrmatch).
create or replace function public._dd_levenshtein(a text, b text)
returns integer language plpgsql immutable
set search_path = public, extensions
as $$
declare
  la   integer := char_length(coalesce(a, ''));
  lb   integer := char_length(coalesce(b, ''));
  prev integer[];
  cur  integer[];
  i    integer;
  j    integer;
  cost integer;
begin
  if la = 0 then return lb; end if;
  if lb = 0 then return la; end if;
  if abs(la - lb) > 4 then return abs(la - lb); end if;
  prev := array(select generate_series(0, lb));
  for i in 1..la loop
    cur := array[i];
    for j in 1..lb loop
      cost := case when substr(a, i, 1) = substr(b, j, 1) then 0 else 1 end;
      cur := cur || least(prev[j + 1] + 1, cur[j] + 1, prev[j] + cost);
    end loop;
    prev := cur;
  end loop;
  return prev[lb + 1];
end $$;

-- Compare une proposition au mot (+ alias). Renvoie 'found' | 'close' | 'wrong'.
-- Tolérance (sur le mot normalisé) : ≤ 3 car. = exact ; ≤ 6 car. = 1 faute ; au-delà = 2.
-- 'close' = une faute de plus que la tolérance, ou proposition qui contient le mot
-- (ex. « un gros chat ») : jamais affichée publiquement (elle trahirait le mot).
create or replace function public._dd_match(p_guess text, p_word jsonb)
returns text language plpgsql immutable
set search_path = public, extensions
as $$
declare
  g      text := public._dd_norm(p_guess);
  c      text;
  t      text;
  tol    integer;
  d      integer;
  v_close boolean := false;
begin
  if g = '' then return 'wrong'; end if;
  for c in
    select p_word->>'word'
    union all
    select x from jsonb_array_elements_text(coalesce(p_word->'aliases', '[]'::jsonb)) x
  loop
    t := public._dd_norm(c);
    continue when t = '';
    tol := case when char_length(t) <= 3 then 0 when char_length(t) <= 6 then 1 else 2 end;
    d := public._dd_levenshtein(g, t);
    if d <= tol then return 'found'; end if;
    if d = tol + 1 or (char_length(t) >= 3 and position(t in g) > 0) then v_close := true; end if;
  end loop;
  return case when v_close then 'close' else 'wrong' end;
end $$;

-- Caractère « séparateur » (affiché tel quel dans l'indice).
create or replace function public._dd_is_sep(p_ch text)
returns boolean language sql immutable
set search_path = public, extensions
as $$ select p_ch in (' ', '-', '''', '’', '.', ',', '&') $$;

-- Indice public : lettres masquées par '_' sauf indices révélés (1-based).
create or replace function public._dd_mask(p_word text, p_revealed jsonb)
returns text language plpgsql immutable
set search_path = public, extensions
as $$
declare
  r  text := '';
  ch text;
  i  integer;
begin
  for i in 1..char_length(p_word) loop
    ch := substr(p_word, i, 1);
    if public._dd_is_sep(ch) or coalesce(p_revealed, '[]'::jsonb) @> to_jsonb(i) then
      r := r || ch;
    else
      r := r || '_';
    end if;
  end loop;
  return r;
end $$;

create or replace function public._dd_letter_count(p_word text)
returns integer language sql immutable
set search_path = public, extensions
as $$
  select count(*)::integer from generate_series(1, char_length(p_word)) i
   where not public._dd_is_sep(substr(p_word, i, 1))
$$;

-- Démarre le tour p_turn : choix du mot par le dessinateur (15 s).
create or replace function public._dd_start_turn(p_state jsonb, p_server jsonb, p_turn integer)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_n      integer := jsonb_array_length(p_state->'order');
  v_drawer text := p_state->'order'->>((p_turn - 1) % v_n);
  v_ch     jsonb := p_server->'choices'->(p_turn - 1);
begin
  p_state := p_state || jsonb_build_object(
    'phase', 'choosing',
    'turn', p_turn,
    'round', ((p_turn - 1) / v_n) + 1,
    'drawer', v_drawer,
    'deadline', public._dd_iso(now() + make_interval(secs => (p_state->>'choose_seconds')::integer)),
    'started_at', null,
    'next_hint_at', null,
    'hint', null,
    'word_length', null,
    'found', '[]'::jsonb,
    'turn_points', '{}'::jsonb,
    'feed', '[]'::jsonb,
    'last_turn', null);
  p_server := p_server || jsonb_build_object('word', null, 'revealed', '[]'::jsonb, 'hints_left', '[]'::jsonb);
  return jsonb_build_object(
    'state', p_state,
    'server', p_server,
    'secrets', jsonb_build_object(v_drawer, jsonb_build_object(
      'turn', p_turn, 'role', 'drawer', 'choices', v_ch, 'word', null)));
end $$;

-- Le dessinateur a choisi (ou choix auto) : phase de dessin.
create or replace function public._dd_begin_drawing(p_state jsonb, p_server jsonb, p_index integer)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_turn    integer := (p_state->>'turn')::integer;
  v_word    jsonb := p_server->'choices'->(v_turn - 1)->p_index;
  v_text    text := v_word->>'word';
  v_secs    integer := (p_state->>'draw_seconds')::integer;
  v_letters integer := public._dd_letter_count(v_text);
  v_max     integer := v_letters / 3;            -- jamais plus d'1/3 des lettres
  v_first   integer := (v_max + 1) / 2;          -- révélées à 50 %
  v_start   timestamptz := now();
begin
  p_server := p_server || jsonb_build_object(
    'word', v_word,
    'revealed', '[]'::jsonb,
    -- plan des indices : [{at, count}] (count = nb de lettres révélées au total à cette échéance)
    'hints_left', case
      when v_max <= 0 then '[]'::jsonb
      when v_max = v_first then jsonb_build_array(
        jsonb_build_object('at', public._dd_iso(v_start + make_interval(secs => v_secs * 0.5)), 'count', v_first))
      else jsonb_build_array(
        jsonb_build_object('at', public._dd_iso(v_start + make_interval(secs => v_secs * 0.5)), 'count', v_first),
        jsonb_build_object('at', public._dd_iso(v_start + make_interval(secs => v_secs * 0.75)), 'count', v_max))
    end);
  p_state := p_state || jsonb_build_object(
    'phase', 'drawing',
    'started_at', public._dd_iso(v_start),
    'deadline', public._dd_iso(v_start + make_interval(secs => v_secs)),
    'next_hint_at', p_server->'hints_left'->0->'at',
    'hint', public._dd_mask(v_text, '[]'::jsonb),
    'word_length', v_letters);
  return jsonb_build_object(
    'state', p_state,
    'server', p_server,
    'secrets', jsonb_build_object(p_state->>'drawer', jsonb_build_object(
      'turn', v_turn, 'role', 'drawer', 'choices', p_server->'choices'->(v_turn - 1),
      'word', v_text, 'aliases', coalesce(v_word->'aliases', '[]'::jsonb))));
end $$;

-- Révèle les indices dus (now() >= at).
create or replace function public._dd_apply_hints(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_text   text := p_server->'word'->>'word';
  v_target integer;
  v_pick   integer;
begin
  while jsonb_array_length(coalesce(p_server->'hints_left', '[]'::jsonb)) > 0
        and (p_server->'hints_left'->0->>'at')::timestamptz <= now() loop
    v_target := (p_server->'hints_left'->0->>'count')::integer;
    while jsonb_array_length(p_server->'revealed') < v_target loop
      select i into v_pick from generate_series(1, char_length(v_text)) i
       where not public._dd_is_sep(substr(v_text, i, 1))
         and not (p_server->'revealed' @> to_jsonb(i))
       order by random() limit 1;
      exit when v_pick is null;
      p_server := jsonb_set(p_server, '{revealed}', (p_server->'revealed') || to_jsonb(v_pick));
    end loop;
    p_server := jsonb_set(p_server, '{hints_left}', (p_server->'hints_left') - 0);
  end loop;
  p_state := p_state || jsonb_build_object(
    'hint', public._dd_mask(v_text, p_server->'revealed'),
    'next_hint_at', p_server->'hints_left'->0->'at');
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Fin du tour : révélation du mot (4 s).
create or replace function public._dd_end_turn(p_state jsonb, p_server jsonb, p_skipped boolean)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_word jsonb := p_server->'word';
begin
  p_state := p_state || jsonb_build_object(
    'phase', 'reveal',
    'deadline', public._dd_iso(now() + make_interval(secs => (p_state->>'reveal_seconds')::integer)),
    'next_hint_at', null,
    'hint', case when v_word is null then null else to_jsonb(v_word->>'word') end,
    'last_turn', jsonb_build_object(
      'turn', p_state->'turn', 'drawer', p_state->'drawer',
      'word', v_word->>'word', 'found', p_state->'found',
      'points', p_state->'turn_points', 'skipped', p_skipped),
    'history', coalesce(p_state->'history', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'turn', p_state->'turn', 'drawer', p_state->'drawer',
      'word', v_word->>'word', 'found', p_state->'found', 'skipped', p_skipped)));
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

create or replace function public._dd_finish(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_max     integer;
  v_results jsonb;
  v_winners jsonb;
begin
  select coalesce(max(value::integer), 0) into v_max from jsonb_each_text(p_state->'scores');
  -- points (XP) = score / 100 arrondi : un mot trouvé ≈ 1-2 points, comme les autres jeux.
  select jsonb_agg(jsonb_build_object(
           'profile_id', t.key,
           'points', round(t.value::integer / 100.0)::integer,
           'won', v_max > 0 and t.value::integer = v_max,
           'placement', t.r,
           'stats', jsonb_build_object('score', t.value::integer))
         order by t.r, t.key)
    into v_results
    from (select key, value, rank() over (order by value::integer desc) as r
            from jsonb_each_text(p_state->'scores')) t;
  select coalesce(jsonb_agg(key order by key), '[]'::jsonb) into v_winners
    from jsonb_each_text(p_state->'scores') where v_max > 0 and value::integer = v_max;
  p_state := p_state || jsonb_build_object(
    'phase', 'finished', 'deadline', null, 'next_hint_at', null,
    'winners', v_winners, 'results', v_results);
  return jsonb_build_object('state', p_state, 'server', p_server, 'results', v_results);
end $$;

-- -----------------------------------------------------------------------------
-- Démarrage
-- -----------------------------------------------------------------------------
create or replace function public.game_dessine_devine_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_n      integer := cardinality(p_players);
  v_rounds integer;
  v_secs   integer;
  v_diff   text;
  v_ch     jsonb := p_options->'choices';
  v_turns  integer;
  v_order  jsonb;
  v_zero   jsonb;
  v_clean  jsonb;
  v_state  jsonb;
begin
  if v_n < 3 then raise exception 'not_enough_players'; end if;
  v_rounds := least(greatest(coalesce(nullif(p_options->>'rounds', '')::integer, 1), 1), 3);
  v_secs := coalesce(nullif(p_options->>'draw_seconds', '')::integer, 80);
  if v_secs not in (60, 80, 100) then v_secs := 80; end if;
  v_diff := coalesce(p_options->>'difficulty', 'mixte');
  if v_diff not in ('facile', 'mixte', 'difficile') then v_diff := 'mixte'; end if;
  v_turns := v_rounds * v_n;

  if v_ch is null or jsonb_typeof(v_ch) <> 'array' then raise exception 'missing_words'; end if;
  if jsonb_array_length(v_ch) < v_turns then raise exception 'not_enough_words'; end if;
  -- Validation + nettoyage : triplets de {word, aliases[], difficulty}.
  if exists (
    select 1 from jsonb_array_elements(v_ch) with ordinality as t(trip, o)
     where o <= v_turns and (jsonb_typeof(trip) <> 'array' or jsonb_array_length(trip) <> 3
        or exists (select 1 from jsonb_array_elements(trip) w
                    where jsonb_typeof(w) <> 'object' or jsonb_typeof(w->'word') <> 'string'
                       or char_length(btrim(w->>'word')) not between 1 and 40
                       or public._dd_norm(w->>'word') = ''
                       or (w ? 'aliases' and jsonb_typeof(w->'aliases') not in ('array', 'null')))))
  then
    raise exception 'invalid_words';
  end if;
  select jsonb_agg(
           (select jsonb_agg(jsonb_build_object(
                     'word', btrim(regexp_replace(w->>'word', '\s+', ' ', 'g')),
                     'aliases', coalesce((select jsonb_agg(left(btrim(a), 40))
                                            from (select a from jsonb_array_elements_text(
                                                    case when jsonb_typeof(w->'aliases') = 'array' then w->'aliases' else '[]'::jsonb end) a
                                                  where jsonb_typeof(to_jsonb(a)) = 'string' and btrim(a) <> '' limit 8) s), '[]'::jsonb),
                     'difficulty', least(greatest(coalesce(nullif(w->>'difficulty', '')::integer, 2), 1), 3))
                     order by wo)
              from jsonb_array_elements(trip) with ordinality as x(w, wo))
           order by o)
    into v_clean
    from jsonb_array_elements(v_ch) with ordinality as t(trip, o)
   where o <= v_turns;

  select jsonb_agg(p order by random()) into v_order from unnest(p_players) p;
  select jsonb_object_agg(p::text, 0) into v_zero from unnest(p_players) p;

  v_state := jsonb_build_object(
    'game', 'dessine-devine',
    'phase', 'choosing',
    'players', to_jsonb(p_players),
    'order', v_order,
    'round', 1,
    'total_rounds', v_rounds,
    'turn', 1,
    'total_turns', v_turns,
    'difficulty', v_diff,
    'draw_seconds', v_secs,
    'choose_seconds', 15,
    'reveal_seconds', 4,
    'scores', v_zero,
    'feed_seq', 0,
    'history', '[]'::jsonb,
    'winners', null,
    'results', null);

  return public._dd_start_turn(v_state, jsonb_build_object('choices', v_clean), 1);
end $$;

-- -----------------------------------------------------------------------------
-- Actions
-- -----------------------------------------------------------------------------
create or replace function public.game_dessine_devine_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_type    text := p_action->>'type';
  v_phase   text := p_state->>'phase';
  v_me      text := p_actor::text;
  v_turn    integer := (p_state->>'turn')::integer;
  v_idx     integer;
  v_text    text;
  v_res     text;
  v_seq     integer;
  v_feed    jsonb;
  v_frac    double precision;
  v_pts     integer;
  v_rank    integer;
  v_nguess  integer;
  v_start   timestamptz;
  v_end     timestamptz;
  v_out     jsonb;
  v_secrets jsonb := '{}'::jsonb;
begin
  -- ---------------------------------------------------------------- choose_word
  if v_type = 'choose_word' then
    if v_phase <> 'choosing' then raise exception 'wrong_phase'; end if;
    if v_me <> p_state->>'drawer' then raise exception 'not_drawer'; end if;
    begin
      v_idx := (p_action->>'index')::integer;
    exception when others then
      raise exception 'invalid_choice';
    end;
    if v_idx is null or v_idx not between 0 and 2 then raise exception 'invalid_choice'; end if;
    return public._dd_begin_drawing(p_state, p_server, v_idx);

  -- ---------------------------------------------------------------------- guess
  elsif v_type = 'guess' then
    if v_phase <> 'drawing' then raise exception 'wrong_phase'; end if;
    if not (p_state->'players' ? v_me) then raise exception 'not_a_player'; end if;
    if v_me = p_state->>'drawer' then raise exception 'drawer_cannot_guess'; end if;
    if p_state->'found' ? v_me then raise exception 'already_found'; end if;
    v_text := btrim(regexp_replace(coalesce(p_action->>'text', ''), '\s+', ' ', 'g'));
    if v_text = '' then raise exception 'invalid_guess'; end if;
    v_text := left(v_text, 40);
    -- Échéance dépassée (tick pas encore reçu) : on ne compte plus.
    if now() >= (p_state->>'deadline')::timestamptz then raise exception 'wrong_phase'; end if;

    v_res := public._dd_match(v_text, p_server->'word');
    v_seq := coalesce((p_state->>'feed_seq')::integer, 0) + 1;
    v_feed := coalesce(p_state->'feed', '[]'::jsonb);

    if v_res = 'found' then
      v_start := (p_state->>'started_at')::timestamptz;
      v_end := (p_state->>'deadline')::timestamptz;
      v_frac := greatest(0, least(1, extract(epoch from (v_end - now())) / greatest(extract(epoch from (v_end - v_start)), 1)));
      v_rank := jsonb_array_length(p_state->'found') + 1;
      v_pts := 100 + round(100 * v_frac)::integer
             + case v_rank when 1 then 30 when 2 then 20 when 3 then 10 else 0 end;
      p_state := p_state || jsonb_build_object(
        'found', (p_state->'found') || to_jsonb(v_me),
        'scores', (p_state->'scores')
                  || jsonb_build_object(v_me, coalesce((p_state->'scores'->>v_me)::integer, 0) + v_pts)
                  || jsonb_build_object(p_state->>'drawer', coalesce((p_state->'scores'->>(p_state->>'drawer'))::integer, 0) + 40),
        'turn_points', coalesce(p_state->'turn_points', '{}'::jsonb)
                  || jsonb_build_object(v_me, v_pts)
                  || jsonb_build_object(p_state->>'drawer', coalesce((p_state->'turn_points'->>(p_state->>'drawer'))::integer, 0) + 40),
        'feed_seq', v_seq,
        'feed', v_feed || jsonb_build_array(jsonb_build_object('n', v_seq, 'p', v_me, 'k', 'found', 'pts', v_pts)));
      v_secrets := jsonb_build_object(v_me, jsonb_build_object(
        'turn', v_turn, 'role', 'guesser', 'found', true, 'word', p_server->'word'->>'word'));
      -- Tout le monde a trouvé -> fin de tour anticipée.
      v_nguess := jsonb_array_length(p_state->'players') - 1;
      if jsonb_array_length(p_state->'found') >= v_nguess then
        v_out := public._dd_end_turn(p_state, p_server, false);
        return v_out || jsonb_build_object('secrets', v_secrets);
      end if;
      return jsonb_build_object('state', p_state, 'server', p_server, 'secrets', v_secrets);

    elsif v_res = 'close' then
      -- « Presque ! » privé : rien dans le state public, secret du joueur mis à jour.
      v_secrets := jsonb_build_object(v_me, jsonb_build_object(
        'turn', v_turn, 'role', 'guesser', 'found', false,
        'close', jsonb_build_object('text', v_text, 'n', v_seq)));
      p_state := p_state || jsonb_build_object('feed_seq', v_seq);
      return jsonb_build_object('state', p_state, 'server', p_server, 'secrets', v_secrets);

    else
      v_feed := v_feed || jsonb_build_array(jsonb_build_object('n', v_seq, 'p', v_me, 'k', 'guess', 't', v_text));
      if jsonb_array_length(v_feed) > 60 then
        v_feed := (select jsonb_agg(e order by o) from jsonb_array_elements(v_feed) with ordinality as x(e, o)
                    where o > jsonb_array_length(v_feed) - 60);
      end if;
      p_state := p_state || jsonb_build_object('feed_seq', v_seq, 'feed', v_feed);
      return jsonb_build_object('state', p_state, 'server', p_server);
    end if;

  -- ----------------------------------------------------------------------- tick
  elsif v_type = 'tick' then
    if v_phase = 'choosing' then
      if now() < (p_state->>'deadline')::timestamptz then
        return jsonb_build_object('state', p_state, 'server', p_server);
      end if;
      return public._dd_begin_drawing(p_state, p_server, floor(random() * 3)::integer);
    elsif v_phase = 'drawing' then
      if now() >= (p_state->>'deadline')::timestamptz then
        return public._dd_end_turn(p_state, p_server, false);
      end if;
      if p_state->>'next_hint_at' is not null and now() >= (p_state->>'next_hint_at')::timestamptz then
        return public._dd_apply_hints(p_state, p_server);
      end if;
      return jsonb_build_object('state', p_state, 'server', p_server);
    elsif v_phase = 'reveal' then
      if now() < (p_state->>'deadline')::timestamptz then
        return jsonb_build_object('state', p_state, 'server', p_server);
      end if;
      if v_turn >= (p_state->>'total_turns')::integer then
        return public._dd_finish(p_state, p_server);
      end if;
      return public._dd_start_turn(p_state, p_server, v_turn + 1);
    end if;
    return jsonb_build_object('state', p_state, 'server', p_server);

  -- ------------------------------------------------------------------ skip_turn
  elsif v_type = 'skip_turn' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase not in ('choosing', 'drawing') then raise exception 'wrong_phase'; end if;
    return public._dd_end_turn(p_state, p_server, true);

  else
    raise exception 'unknown_action';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Droits : fonctions internes, appelées uniquement via start_match / game_action.
-- -----------------------------------------------------------------------------
revoke all on function public._dd_iso(timestamptz) from public, anon, authenticated;
revoke all on function public._dd_norm(text) from public, anon, authenticated;
revoke all on function public._dd_levenshtein(text, text) from public, anon, authenticated;
revoke all on function public._dd_match(text, jsonb) from public, anon, authenticated;
revoke all on function public._dd_is_sep(text) from public, anon, authenticated;
revoke all on function public._dd_mask(text, jsonb) from public, anon, authenticated;
revoke all on function public._dd_letter_count(text) from public, anon, authenticated;
revoke all on function public._dd_start_turn(jsonb, jsonb, integer) from public, anon, authenticated;
revoke all on function public._dd_begin_drawing(jsonb, jsonb, integer) from public, anon, authenticated;
revoke all on function public._dd_apply_hints(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._dd_end_turn(jsonb, jsonb, boolean) from public, anon, authenticated;
revoke all on function public._dd_finish(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.game_dessine_devine_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_dessine_devine_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;


-- ===== games\pas-de-bol.sql =====
-- =============================================================================
-- JEU « Pas de bol ! » (id pas-de-bol) — jeu de défausse inspiré du 8 américain
-- Idempotent (create or replace). Dispatché par start_match / game_action.
--
-- Cartes (jsonb) : {"id":"tomate-5-1","color":"tomate","kind":"num","value":5}
--   kind : num | plus2 | reverse | skip | wild | wild4 | perso ("perso":"<slug>")
--   color : tomate | soleil | menthe | ciel (absent pour wild / wild4 / perso)
-- server : {deck:[cartes], discard:[cartes sous la carte du dessus],
--           hands:{uid:[cartes]}, drawn:{player,id}|null}
-- secret d'un joueur : {hand:[cartes], drawn:id|null, v:int, peek?:{...}}
-- Contrat complet (state public, secrets, actions) : src/games/pas-de-bol/types.ts.
-- =============================================================================

create or replace function public._pdb_card(p_id text, p_color text, p_kind text,
                                            p_value integer default null, p_perso text default null)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select jsonb_strip_nulls(jsonb_build_object('id', p_id, 'color', p_color, 'kind', p_kind,
                                              'value', p_value, 'perso', p_perso));
$$;

-- Paquet complet (non mélangé). 108 cartes classiques + 9 cartes perso en mode « persos ».
create or replace function public._pdb_deck(p_persos boolean)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v  jsonb := '[]'::jsonb;
  c  text;
  s  text;
  n  integer;
  k  integer;
begin
  foreach c in array array['tomate', 'soleil', 'menthe', 'ciel'] loop
    v := v || jsonb_build_array(public._pdb_card(c || '-0', c, 'num', 0));
    for n in 1 .. 9 loop
      for k in 1 .. 2 loop
        v := v || jsonb_build_array(public._pdb_card(format('%s-%s-%s', c, n, k), c, 'num', n));
      end loop;
    end loop;
    for k in 1 .. 2 loop
      v := v || jsonb_build_array(
        public._pdb_card(format('%s-plus2-%s', c, k), c, 'plus2'),
        public._pdb_card(format('%s-reverse-%s', c, k), c, 'reverse'),
        public._pdb_card(format('%s-skip-%s', c, k), c, 'skip'));
    end loop;
  end loop;
  for k in 1 .. 4 loop
    v := v || jsonb_build_array(public._pdb_card('wild-' || k, null, 'wild'),
                                public._pdb_card('wild4-' || k, null, 'wild4'));
  end loop;
  if p_persos then
    foreach s in array array['kevin', 'cycy', 'dede', 'manon', 'mika', 'cecile', 'carole', 'marius', 'nini'] loop
      v := v || jsonb_build_array(public._pdb_card('perso-' || s, null, 'perso', null, s));
    end loop;
  end if;
  return v;
end $$;

create or replace function public._pdb_shuffle(p jsonb)
returns jsonb language sql volatile
set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(e order by random()), '[]'::jsonb) from jsonb_array_elements(p) as t(e);
$$;

create or replace function public._pdb_iso(p_ts timestamptz)
returns text language sql stable
set search_path = public, extensions
as $$
  select to_char(p_ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$$;

-- Joueur actif situé p_steps crans après p_from dans le sens du jeu (les joueurs
-- sortis sont sautés ; p_from peut lui-même être sorti).
create or replace function public._pdb_next(p_state jsonb, p_from text, p_steps integer)
returns text language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_order text[] := array(select jsonb_array_elements_text(p_state->'order'));
  v_n     integer := cardinality(v_order);
  v_dir   integer := coalesce((p_state->>'direction')::integer, 1);
  v_cur   integer := coalesce(array_position(v_order, p_from), 1);
  v_done  integer := 0;
  v_guard integer := 0;
begin
  if jsonb_array_length(coalesce(p_state->'active', '[]'::jsonb)) = 0 then return null; end if;
  loop
    v_cur := ((v_cur - 1 + v_dir) % v_n + v_n) % v_n + 1;
    if (p_state->'active') ? v_order[v_cur] then
      v_done := v_done + 1;
      if v_done >= greatest(p_steps, 1) then return v_order[v_cur]; end if;
    end if;
    v_guard := v_guard + 1;
    if v_guard > v_n * 4 then return null; end if;
  end loop;
end $$;

-- Début de tour. p_clear_open : le « Dernière carte ! » non annoncé de ce joueur
-- n'est plus dénonçable (son tour est revenu). Faux pour « Pause manette » (rejoue).
create or replace function public._pdb_start_turn(p_state jsonb, p_player text, p_clear_open boolean)
returns jsonb language plpgsql stable
set search_path = public, extensions
as $$
begin
  p_state := p_state || jsonb_build_object(
    'turn', p_player,
    'turn_phase', 'play',
    'turn_seq', coalesce((p_state->>'turn_seq')::integer, 0) + 1,
    'deadline', public._pdb_iso(now() + make_interval(secs => coalesce((p_state->>'turn_seconds')::integer, 30))));
  if p_clear_open and p_state->'last_card'->>p_player = 'open' then
    p_state := p_state #- array['last_card', p_player];
  end if;
  return p_state;
end $$;

create or replace function public._pdb_log(p_state jsonb, p_entry jsonb)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_n   integer := coalesce((p_state->>'log_seq')::integer, 0) + 1;
  v_log jsonb := coalesce(p_state->'log', '[]'::jsonb);
  v_len integer := jsonb_array_length(v_log);
begin
  select coalesce(jsonb_agg(e order by o), '[]'::jsonb) into v_log
    from jsonb_array_elements(v_log) with ordinality as t(e, o)
   where o > v_len - 11;
  return p_state || jsonb_build_object('log', v_log || jsonb_build_array(p_entry || jsonb_build_object('n', v_n)),
                                       'log_seq', v_n);
end $$;

-- Fait piocher p_n cartes à p_player (pioche reconstituée avec la défausse si vide).
-- Renvoie {state, server, drawn:[cartes]}.
create or replace function public._pdb_draw(p_state jsonb, p_server jsonb, p_player text, p_n integer)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_hand  jsonb := coalesce(p_server->'hands'->p_player, '[]'::jsonb);
  v_drawn jsonb := '[]'::jsonb;
  v_card  jsonb;
  i       integer;
begin
  for i in 1 .. greatest(p_n, 0) loop
    if jsonb_array_length(p_server->'deck') = 0 then
      if jsonb_array_length(coalesce(p_server->'discard', '[]'::jsonb)) = 0 then exit; end if;
      p_server := p_server || jsonb_build_object('deck', public._pdb_shuffle(p_server->'discard'),
                                                 'discard', '[]'::jsonb);
      p_state := p_state || jsonb_build_object('reshuffles', coalesce((p_state->>'reshuffles')::integer, 0) + 1);
      p_state := public._pdb_log(p_state, jsonb_build_object('t', 'reshuffle'));
    end if;
    v_card := p_server->'deck'->0;
    p_server := jsonb_set(p_server, '{deck}', (p_server->'deck') - 0);
    v_hand := v_hand || jsonb_build_array(v_card);
    v_drawn := v_drawn || jsonb_build_array(v_card);
  end loop;
  p_server := jsonb_set(p_server, array['hands', p_player], v_hand, true);
  p_state := jsonb_set(p_state, array['counts', p_player], to_jsonb(jsonb_array_length(v_hand)), true);
  p_state := p_state || jsonb_build_object('draw_count', jsonb_array_length(p_server->'deck'));
  return jsonb_build_object('state', p_state, 'server', p_server, 'drawn', v_drawn);
end $$;

-- La carte peut-elle être posée sur la défausse (hors contrainte « carte piochée ») ?
create or replace function public._pdb_playable(p_state jsonb, p_card jsonb)
returns boolean language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_kind    text := p_card->>'kind';
  v_pending integer := coalesce((p_state->>'pending_draw')::integer, 0);
  v_top     jsonb := p_state->'top';
begin
  if v_pending > 0 then
    -- Cumul en attente : seulement surenchérir (+2 sur +2, +4 sur tout) ou la Capuche de Marius.
    return v_kind = 'wild4'
        or (v_kind = 'plus2' and p_state->>'pending_kind' = 'plus2')
        or (v_kind = 'perso' and p_card->>'perso' = 'marius');
  end if;
  if v_kind in ('wild', 'wild4', 'perso') then return true; end if;
  if p_card->>'color' = p_state->>'color' then return true; end if;
  if v_kind = 'num' then
    return v_top->>'kind' = 'num' and v_top->>'value' = p_card->>'value';
  end if;
  return v_top->>'kind' = v_kind;
end $$;

-- Fin de partie : ordre de sortie = classement, le dernier joueur avec des cartes perd.
-- won : les 3 premiers sortis s'il y a >= 5 joueurs, sinon seulement le 1er.
create or replace function public._pdb_finish(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql stable
set search_path = public, extensions
as $$
declare
  v_n       integer := jsonb_array_length(p_state->'players');
  v_ranked  text[] := array(select jsonb_array_elements_text(p_state->'out'))
                      || array(select jsonb_array_elements_text(p_state->'active'));
  v_results jsonb := '[]'::jsonb;
  v_hands   jsonb := '{}'::jsonb;
  i         integer;
begin
  for i in 1 .. cardinality(v_ranked) loop
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'profile_id', v_ranked[i],
      'placement', i,
      'points', v_n - i,
      'won', (i = 1) or (v_n >= 5 and i <= 3),
      'stats', '{}'::jsonb));
  end loop;
  -- Main du (des) perdant(s) révélée.
  select coalesce(jsonb_object_agg(a, coalesce(p_server->'hands'->a, '[]'::jsonb)), '{}'::jsonb) into v_hands
    from jsonb_array_elements_text(p_state->'active') as t(a);

  p_state := p_state || jsonb_build_object(
    'phase', 'finished',
    'deadline', null,
    'turn', null,
    'loser', p_state->'active'->>0,
    'final_hands', v_hands,
    'results', v_results);
  return jsonb_build_object('state', p_state, 'server', p_server, 'results', v_results);
end $$;

-- -----------------------------------------------------------------------------
-- Démarrage. Options : {"mode":"classique"|"persos"}
-- -----------------------------------------------------------------------------
create or replace function public.game_pas_de_bol_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_n       integer := cardinality(p_players);
  v_mode    text := case when coalesce(p_options->>'mode', '') = 'persos' then 'persos' else 'classique' end;
  v_deck    jsonb;
  v_order   text[];
  v_hands   jsonb := '{}'::jsonb;
  v_counts  jsonb := '{}'::jsonb;
  v_secrets jsonb := '{}'::jsonb;
  v_ver     jsonb := '{}'::jsonb;
  v_hand    jsonb;
  v_top     jsonb;
  v_idx     integer;
  v_state   jsonb;
  p         text;
begin
  if v_n < 2 then raise exception 'not_enough_players'; end if;
  if v_n > 9 then raise exception 'too_many_players'; end if;

  v_deck := public._pdb_shuffle(public._pdb_deck(v_mode = 'persos'));
  v_order := array(select x::text from unnest(p_players) as t(x) order by random());

  foreach p in array v_order loop
    select coalesce(jsonb_agg(e order by o), '[]'::jsonb) into v_hand
      from jsonb_array_elements(v_deck) with ordinality as t(e, o) where o <= 7;
    select coalesce(jsonb_agg(e order by o), '[]'::jsonb) into v_deck
      from jsonb_array_elements(v_deck) with ordinality as t(e, o) where o > 7;
    v_hands := v_hands || jsonb_build_object(p, v_hand);
    v_counts := v_counts || jsonb_build_object(p, 7);
    v_ver := v_ver || jsonb_build_object(p, 1);
    v_secrets := v_secrets || jsonb_build_object(p, jsonb_build_object('hand', v_hand, 'drawn', null, 'v', 1));
  end loop;

  -- Première carte de la défausse : le premier chiffre du paquet.
  select o - 1 into v_idx from jsonb_array_elements(v_deck) with ordinality as t(e, o)
   where e->>'kind' = 'num' order by o limit 1;
  v_top := v_deck->v_idx;
  v_deck := v_deck - v_idx;

  v_state := jsonb_build_object(
    'game', 'pas-de-bol',
    'phase', 'playing',
    'mode', v_mode,
    'players', to_jsonb(p_players),
    'order', to_jsonb(v_order),
    'active', to_jsonb(v_order),
    'out', '[]'::jsonb,
    'direction', 1,
    'color', v_top->>'color',
    'top', v_top,
    'pile', jsonb_build_array(v_top),
    'counts', v_counts,
    'hand_ver', v_ver,
    'draw_count', jsonb_array_length(v_deck),
    'pending_draw', 0,
    'pending_kind', null,
    'last_card', '{}'::jsonb,
    'turn_seconds', 30,
    'turn_seq', 0,
    'log', '[]'::jsonb,
    'log_seq', 0,
    'reshuffles', 0,
    'loser', null,
    'final_hands', null,
    'results', null);
  v_state := public._pdb_start_turn(v_state, v_order[1], true);
  -- 10 s de grâce pour le premier tour (le temps que tout le monde arrive).
  v_state := v_state || jsonb_build_object('deadline', public._pdb_iso(now() + interval '40 seconds'));

  return jsonb_build_object(
    'state', v_state,
    'server', jsonb_build_object('deck', v_deck, 'discard', '[]'::jsonb, 'hands', v_hands, 'drawn', null),
    'secrets', v_secrets);
end $$;

-- -----------------------------------------------------------------------------
-- Actions :
--   {"type":"play","card":"<id>","color"?:"tomate|soleil|menthe|ciel","target"?:"<uuid>","announce"?:bool}
--   {"type":"draw"}  {"type":"pass"}  {"type":"last_card"}  {"type":"denounce","target":"<uuid>"}
--   {"type":"tick"}
-- -----------------------------------------------------------------------------
create or replace function public.game_pas_de_bol_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_type     text := p_action->>'type';
  v_me       text := p_actor::text;
  v_old      jsonb := p_server;
  v_turn     text := p_state->>'turn';
  v_pending  integer := coalesce((p_state->>'pending_draw')::integer, 0);
  v_hand     jsonb;
  v_card     jsonb;
  v_idx      integer;
  v_kind     text;
  v_perso    text;
  v_color    text;
  v_target   text;
  v_r        jsonb;
  v_n        integer;
  v_skip     integer := 1;
  v_replay   boolean := false;
  v_reverse  boolean := false;
  v_peek     jsonb := null;
  v_entry    jsonb;
  v_act      text[];
  v_newh     jsonb;
  v_disc     jsonb;
  v_next     text;
  v_secrets  jsonb := '{}'::jsonb;
  v_sec      jsonb;
  v_od       text;
  v_nd       text;
  p          text;
  i          integer;
begin
  if p_state->>'phase' <> 'playing' then raise exception 'wrong_phase'; end if;

  -- ---------------------------------------------------------------- tick
  if v_type = 'tick' then
    if p_state->>'deadline' is null or now() < (p_state->>'deadline')::timestamptz then
      return jsonb_build_object('state', p_state, 'server', p_server);  -- trop tôt / déjà traité
    end if;
    if p_state->>'turn_phase' = 'drawn' then
      p_server := p_server || jsonb_build_object('drawn', null);
      p_state := public._pdb_log(p_state, jsonb_build_object('t', 'pass', 'p', v_turn, 'auto', true));
    else
      v_r := public._pdb_draw(p_state, p_server, v_turn, greatest(v_pending, 1));
      p_state := v_r->'state'; p_server := v_r->'server';
      p_state := public._pdb_log(p_state, jsonb_build_object(
        't', 'draw', 'p', v_turn, 'count', jsonb_array_length(v_r->'drawn'), 'auto', true, 'cumul', v_pending > 0));
      p_state := p_state || jsonb_build_object('pending_draw', 0, 'pending_kind', null);
    end if;
    p_state := public._pdb_start_turn(p_state, public._pdb_next(p_state, v_turn, 1), true);

  -- ---------------------------------------------------------------- dernière carte !
  elsif v_type = 'last_card' then
    if p_state->'last_card'->>v_me is distinct from 'open' then raise exception 'wrong_phase'; end if;
    p_state := jsonb_set(p_state, array['last_card', v_me], '"safe"');
    p_state := public._pdb_log(p_state, jsonb_build_object('t', 'announce', 'p', v_me));

  -- ---------------------------------------------------------------- dénoncer
  elsif v_type = 'denounce' then
    v_target := p_action->>'target';
    if not ((p_state->'players') ? v_me) then raise exception 'not_a_player'; end if;
    if v_target is null or v_target = v_me then raise exception 'invalid_target'; end if;
    if p_state->'last_card'->>v_target is distinct from 'open' then raise exception 'wrong_phase'; end if;
    v_r := public._pdb_draw(p_state, p_server, v_target, 2);
    p_state := v_r->'state'; p_server := v_r->'server';
    p_state := p_state #- array['last_card', v_target];
    p_state := public._pdb_log(p_state, jsonb_build_object(
      't', 'denounce', 'p', v_me, 'target', v_target, 'count', jsonb_array_length(v_r->'drawn')));

  -- ---------------------------------------------------------------- piocher
  elsif v_type = 'draw' then
    if v_turn is distinct from v_me then raise exception 'not_your_turn'; end if;
    if p_state->>'turn_phase' <> 'play' then raise exception 'wrong_phase'; end if;
    if v_pending > 0 then
      v_r := public._pdb_draw(p_state, p_server, v_me, v_pending);
      p_state := v_r->'state'; p_server := v_r->'server';
      p_state := public._pdb_log(p_state, jsonb_build_object(
        't', 'draw', 'p', v_me, 'count', jsonb_array_length(v_r->'drawn'), 'cumul', true));
      p_state := p_state || jsonb_build_object('pending_draw', 0, 'pending_kind', null);
      p_state := public._pdb_start_turn(p_state, public._pdb_next(p_state, v_me, 1), true);
    else
      v_r := public._pdb_draw(p_state, p_server, v_me, 1);
      p_state := v_r->'state'; p_server := v_r->'server';
      v_card := v_r->'drawn'->0;
      p_state := public._pdb_log(p_state, jsonb_build_object(
        't', 'draw', 'p', v_me, 'count', jsonb_array_length(v_r->'drawn')));
      if v_card is not null and public._pdb_playable(p_state, v_card) then
        -- La carte piochée est jouable : le joueur peut la poser (ou passer).
        p_server := p_server || jsonb_build_object('drawn', jsonb_build_object('player', v_me, 'id', v_card->>'id'));
        p_state := p_state || jsonb_build_object(
          'turn_phase', 'drawn',
          'deadline', public._pdb_iso(greatest((p_state->>'deadline')::timestamptz, now() + interval '10 seconds')));
      else
        p_state := public._pdb_start_turn(p_state, public._pdb_next(p_state, v_me, 1), true);
      end if;
    end if;

  -- ---------------------------------------------------------------- passer (après pioche)
  elsif v_type = 'pass' then
    if v_turn is distinct from v_me then raise exception 'not_your_turn'; end if;
    if p_state->>'turn_phase' <> 'drawn' then raise exception 'wrong_phase'; end if;
    p_server := p_server || jsonb_build_object('drawn', null);
    p_state := public._pdb_log(p_state, jsonb_build_object('t', 'pass', 'p', v_me));
    p_state := public._pdb_start_turn(p_state, public._pdb_next(p_state, v_me, 1), true);

  -- ---------------------------------------------------------------- jouer une carte
  elsif v_type = 'play' then
    if v_turn is distinct from v_me then raise exception 'not_your_turn'; end if;
    v_hand := coalesce(p_server->'hands'->v_me, '[]'::jsonb);
    select o - 1, e into v_idx, v_card
      from jsonb_array_elements(v_hand) with ordinality as t(e, o)
     where e->>'id' = p_action->>'card' limit 1;
    if v_idx is null then raise exception 'card_not_in_hand'; end if;
    if p_state->>'turn_phase' = 'drawn' and (v_card->>'id') is distinct from (p_server->'drawn'->>'id') then
      raise exception 'card_not_playable';
    end if;
    if not public._pdb_playable(p_state, v_card) then raise exception 'card_not_playable'; end if;

    v_kind := v_card->>'kind';
    v_perso := v_card->>'perso';
    if v_kind in ('wild', 'wild4') or v_perso in ('mika', 'cecile') then
      v_color := p_action->>'color';
      if v_color is null or v_color not in ('tomate', 'soleil', 'menthe', 'ciel') then
        raise exception 'invalid_color';
      end if;
    end if;
    if v_perso in ('cycy', 'manon', 'carole') then
      v_target := p_action->>'target';
      if v_target is null or v_target = v_me or not ((p_state->'active') ? v_target) then
        raise exception 'invalid_target';
      end if;
    end if;

    -- La carte quitte la main et passe sur la défausse.
    v_hand := v_hand - v_idx;
    p_server := jsonb_set(p_server, array['hands', v_me], v_hand);
    p_server := p_server || jsonb_build_object('drawn', null);
    if p_state->'top' is not null and jsonb_typeof(p_state->'top') = 'object' then
      p_server := jsonb_set(p_server, '{discard}', coalesce(p_server->'discard', '[]'::jsonb) || jsonb_build_array(p_state->'top'));
    end if;
    select coalesce(jsonb_agg(e order by o), '[]'::jsonb) into v_disc
      from jsonb_array_elements(coalesce(p_state->'pile', '[]'::jsonb)) with ordinality as t(e, o)
     where o > jsonb_array_length(coalesce(p_state->'pile', '[]'::jsonb)) - 3;
    p_state := p_state || jsonb_build_object('top', v_card, 'pile', v_disc || jsonb_build_array(v_card));
    p_state := jsonb_set(p_state, array['counts', v_me], to_jsonb(jsonb_array_length(v_hand)));
    if v_card ? 'color' then
      p_state := p_state || jsonb_build_object('color', v_card->>'color');
    elsif v_kind in ('wild', 'wild4') or v_perso = 'mika' then
      p_state := p_state || jsonb_build_object('color', v_color);
    end if;

    v_entry := jsonb_build_object('t', 'play', 'p', v_me, 'card', v_card, 'color', p_state->>'color');
    if v_target is not null then v_entry := v_entry || jsonb_build_object('target', v_target); end if;

    if v_kind = 'skip' then
      v_skip := 2;
    elsif v_kind = 'reverse' then
      v_reverse := true;
      p_state := p_state || jsonb_build_object('direction', -coalesce((p_state->>'direction')::integer, 1));
    elsif v_kind = 'plus2' then
      p_state := p_state || jsonb_build_object('pending_draw', v_pending + 2, 'pending_kind', 'plus2');
    elsif v_kind = 'wild4' then
      p_state := p_state || jsonb_build_object('pending_draw', v_pending + 4, 'pending_kind', 'wild4');
    elsif v_kind = 'perso' then
      if v_perso = 'kevin' then
        -- Pause manette : tu rejoues immédiatement.
        v_replay := true;
      elsif v_perso = 'cycy' then
        -- Câlin d'ours : échange de mains (sans effet si tu viens de poser ta dernière carte).
        if jsonb_array_length(v_hand) > 0 then
          v_newh := p_server->'hands'->v_target;
          p_server := jsonb_set(p_server, array['hands', v_target], v_hand);
          p_server := jsonb_set(p_server, array['hands', v_me], v_newh);
          p_state := jsonb_set(p_state, array['counts', v_me], to_jsonb(jsonb_array_length(v_newh)));
          p_state := jsonb_set(p_state, array['counts', v_target], to_jsonb(jsonb_array_length(v_hand)));
          v_hand := v_newh;
        end if;
      elsif v_perso = 'dede' then
        -- Reine de la soirée : tous les autres joueurs encore en jeu piochent 1.
        for p in select jsonb_array_elements_text(p_state->'active') loop
          if p <> v_me then
            v_r := public._pdb_draw(p_state, p_server, p, 1);
            p_state := v_r->'state'; p_server := v_r->'server';
          end if;
        end loop;
      elsif v_perso = 'manon' then
        -- Petit carnet : la main de la cible est montrée en secret à Manon (secret.peek).
        v_peek := jsonb_build_object('target', v_target, 'hand', p_server->'hands'->v_target,
                                     'until', public._pdb_iso(now() + interval '8 seconds'),
                                     'n', coalesce((p_state->>'log_seq')::integer, 0) + 1);
      elsif v_perso = 'mika' then
        -- Casquette à l'envers : inverse le sens (+ couleur choisie, déjà appliquée).
        p_state := p_state || jsonb_build_object('direction', -coalesce((p_state->>'direction')::integer, 1));
      elsif v_perso = 'cecile' then
        -- Grand ménage : défausse en plus toutes tes cartes de la couleur choisie.
        select coalesce(jsonb_agg(e order by o), '[]'::jsonb) into v_disc
          from jsonb_array_elements(v_hand) with ordinality as t(e, o) where e->>'color' = v_color;
        select coalesce(jsonb_agg(e order by o), '[]'::jsonb) into v_hand
          from jsonb_array_elements(v_hand) with ordinality as t(e, o) where (e->>'color') is distinct from v_color;
        p_server := jsonb_set(p_server, array['hands', v_me], v_hand);
        p_server := jsonb_set(p_server, '{discard}', (p_server->'discard') || v_disc);
        p_state := jsonb_set(p_state, array['counts', v_me], to_jsonb(jsonb_array_length(v_hand)));
        v_entry := v_entry || jsonb_build_object('discarded', v_disc, 'chosen', v_color);
      elsif v_perso = 'carole' then
        -- Coup de griffe : la cible pioche 3.
        v_r := public._pdb_draw(p_state, p_server, v_target, 3);
        p_state := v_r->'state'; p_server := v_r->'server';
      elsif v_perso = 'marius' then
        -- Capuche : annule tout le cumul en attente.
        if v_pending > 0 then v_entry := v_entry || jsonb_build_object('blocked', v_pending); end if;
        p_state := p_state || jsonb_build_object('pending_draw', 0, 'pending_kind', null);
      elsif v_perso = 'nini' then
        -- Glissade : chaque joueur (qui a encore des cartes) passe sa main au voisin, dans le sens du jeu.
        v_act := array(select a from jsonb_array_elements_text(p_state->'active') as t(a)
                        where jsonb_array_length(coalesce(p_server->'hands'->a, '[]'::jsonb)) > 0);
        v_n := cardinality(v_act);
        if v_n >= 2 then
          v_newh := '{}'::jsonb;
          for i in 1 .. v_n loop
            v_newh := v_newh || jsonb_build_object(
              v_act[(((i - 1 + coalesce((p_state->>'direction')::integer, 1)) % v_n) + v_n) % v_n + 1],
              p_server->'hands'->v_act[i]);
          end loop;
          for i in 1 .. v_n loop
            p_server := jsonb_set(p_server, array['hands', v_act[i]], v_newh->v_act[i]);
            p_state := jsonb_set(p_state, array['counts', v_act[i]], to_jsonb(jsonb_array_length(v_newh->v_act[i])));
          end loop;
        end if;
      end if;
    end if;

    p_state := public._pdb_log(p_state, v_entry);
    v_n := (p_state->'counts'->>v_me)::integer;

    if v_n = 0 then
      -- Plus de cartes : le joueur sort (ordre de sortie = classement).
      p_state := p_state || jsonb_build_object('out', (p_state->'out') || to_jsonb(v_me),
                                               'active', (p_state->'active') - v_me);
      p_state := p_state #- array['last_card', v_me];
      p_state := public._pdb_log(p_state, jsonb_build_object('t', 'out', 'p', v_me,
                                                             'place', jsonb_array_length(p_state->'out')));
      if jsonb_array_length(p_state->'active') <= 1 then
        p_server := p_server || jsonb_build_object('drawn', null);
        v_r := public._pdb_finish(p_state, p_server);
        p_state := v_r->'state';
      end if;
    elsif v_n = 1 then
      p_state := jsonb_set(p_state, array['last_card', v_me],
                           to_jsonb(case when coalesce((p_action->>'announce')::boolean, false) then 'safe' else 'open' end),
                           true);
      if coalesce((p_action->>'announce')::boolean, false) then
        p_state := public._pdb_log(p_state, jsonb_build_object('t', 'announce', 'p', v_me));
      end if;
    end if;

    if p_state->>'phase' = 'playing' then
      if v_replay and (p_state->'active') ? v_me then
        p_state := public._pdb_start_turn(p_state, v_me, false);
      else
        -- Inversion à 2 joueurs = passe ton tour (tu rejoues).
        if v_reverse and jsonb_array_length(p_state->'active') = 2 and (p_state->'active') ? v_me then
          v_skip := 2;
        end if;
        v_next := public._pdb_next(p_state, v_me, v_skip);
        p_state := public._pdb_start_turn(p_state, v_next, v_next <> v_me);
      end if;
    end if;

  else
    raise exception 'unknown_action';
  end if;

  -- ---------------------------------------------------------------- nettoyage + secrets
  -- « Dernière carte » : seulement pour les joueurs qui ont exactement 1 carte.
  for p in select jsonb_object_keys(coalesce(p_state->'last_card', '{}'::jsonb)) loop
    if coalesce((p_state->'counts'->>p)::integer, 0) <> 1 then
      p_state := p_state #- array['last_card', p];
    end if;
  end loop;

  -- Secrets renvoyés uniquement pour les joueurs dont la main (ou la carte piochée) a changé.
  for p in select jsonb_array_elements_text(p_state->'players') loop
    v_od := case when v_old->'drawn'->>'player' = p then v_old->'drawn'->>'id' end;
    v_nd := case when p_server->'drawn'->>'player' = p then p_server->'drawn'->>'id' end;
    if (v_old->'hands'->p) is distinct from (p_server->'hands'->p)
       or v_od is distinct from v_nd
       or (p = v_me and v_peek is not null) then
      p_state := jsonb_set(p_state, array['hand_ver', p],
                           to_jsonb(coalesce((p_state->'hand_ver'->>p)::integer, 0) + 1), true);
      v_sec := jsonb_build_object('hand', coalesce(p_server->'hands'->p, '[]'::jsonb),
                                  'drawn', v_nd,
                                  'v', (p_state->'hand_ver'->>p)::integer);
      if p = v_me and v_peek is not null then v_sec := v_sec || jsonb_build_object('peek', v_peek); end if;
      v_secrets := v_secrets || jsonb_build_object(p, v_sec);
    end if;
  end loop;

  if p_state->>'phase' = 'finished' then
    return jsonb_build_object('state', p_state, 'server', p_server, 'secrets', v_secrets,
                              'results', p_state->'results');
  end if;
  return jsonb_build_object('state', p_state, 'server', p_server, 'secrets', v_secrets);
end $$;

revoke all on function public._pdb_card(text, text, text, integer, text) from public, anon, authenticated;
revoke all on function public._pdb_deck(boolean) from public, anon, authenticated;
revoke all on function public._pdb_shuffle(jsonb) from public, anon, authenticated;
revoke all on function public._pdb_iso(timestamptz) from public, anon, authenticated;
revoke all on function public._pdb_next(jsonb, text, integer) from public, anon, authenticated;
revoke all on function public._pdb_start_turn(jsonb, text, boolean) from public, anon, authenticated;
revoke all on function public._pdb_log(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._pdb_draw(jsonb, jsonb, text, integer) from public, anon, authenticated;
revoke all on function public._pdb_playable(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._pdb_finish(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.game_pas_de_bol_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_pas_de_bol_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;


-- ===== games\petit-bac.sql =====
-- =============================================================================
-- JEU « petit-bac » (Petit bac multi-écrans) — idempotent (create or replace).
-- Dépend de schema.sql (_normalize_word, game_action, start_match, finish_match).
--
-- Phases : writing -> validation -> round_score -> (writing … ) -> finished.
-- Les réponses en cours d'écriture restent dans `server.answers` (privé) ;
-- le state public n'expose que `progress` (nb de cases remplies par joueur).
-- Chaque joueur récupère SES réponses dans match_secrets ({round, answers}).
-- =============================================================================

-- Normalisation d'une réponse : minuscules, sans article de tête
-- (le/la/les/l'/un/une), sans accents, espaces ni ponctuation.
create or replace function public._pb_norm(p text)
returns text language sql immutable
set search_path = public, extensions
as $$
  select public._normalize_word(
    regexp_replace(lower(btrim(coalesce(p, ''))), '^(l\s*[''’`]\s*|(le|la|les|un|une)\s+)', ''))
$$;

-- Nettoyage d'une saisie : espaces normalisés, 60 caractères max.
create or replace function public._pb_clean(p text)
returns text language sql immutable
set search_path = public, extensions
as $$ select left(btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g')), 60) $$;

-- Démarre la manche p_round (lettre déjà tirée dans server.letters).
create or replace function public._pb_start_round(p_state jsonb, p_server jsonb, p_round integer)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_letter text := p_server->'letters'->>(p_round - 1);
  v_start  timestamptz := now() + interval '4 seconds';  -- temps de l'animation de tirage
  v_zero   jsonb;
begin
  select jsonb_object_agg(x, 0) into v_zero from jsonb_array_elements_text(p_state->'players') x;
  p_state := p_state || jsonb_build_object(
    'phase', 'writing',
    'round', p_round,
    'letter', v_letter,
    'letters_used', coalesce(p_state->'letters_used', '[]'::jsonb) || to_jsonb(v_letter),
    'starts_at', v_start,
    'deadline', v_start + make_interval(secs => (p_state->>'duration')::integer),
    'progress', v_zero,
    'validation', null);
  p_server := p_server || jsonb_build_object('answers', '{}'::jsonb);
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- (Re)construit validation.answers à partir des réponses privées :
-- {catId: {uid: {text, norm, auto: null|'empty'|'letter'}}}.
create or replace function public._pb_build_answers(p_state jsonb, p_server jsonb)
returns jsonb language sql stable security definer
set search_path = public, extensions
as $$
  select coalesce(jsonb_object_agg(c->>'id', (
    select jsonb_object_agg(x.pl, jsonb_build_object(
             'text', x.t,
             'norm', public._pb_norm(x.t),
             'auto', case when public._pb_norm(x.t) = '' then 'empty'
                          when left(public._pb_norm(x.t), 1) <> lower(p_state->>'letter') then 'letter'
                          else null end))
      from (select pl, coalesce(p_server->'answers'->pl->>(c->>'id'), '') as t
              from jsonb_array_elements_text(p_state->'players') pl) x)), '{}'::jsonb)
  from jsonb_array_elements(p_state->'categories') c
$$;

create or replace function public._pb_to_validation(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
begin
  p_state := p_state || jsonb_build_object(
    'phase', 'validation',
    'validation', jsonb_build_object(
      'cat_index', 0,
      'answers', public._pb_build_answers(p_state, p_server),
      'contests', '{}'::jsonb));
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Barème de la manche : unique valide 2, valide partagée 1, refusée/vide 0.
-- Refusée si contestée par la majorité stricte des AUTRES joueurs.
create or replace function public._pb_score(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_n       integer := jsonb_array_length(p_state->'players');
  v_cat     text;
  pl        text;
  a         jsonb;
  v_cnt     integer;
  v_status  text;
  v_pts     integer;
  v_valid   jsonb;
  v_cd      jsonb;
  v_detail  jsonb := '{}'::jsonb;
  v_points  jsonb;
  v_uniq    jsonb;
begin
  select jsonb_object_agg(x, 0) into v_points from jsonb_array_elements_text(p_state->'players') x;
  v_uniq := v_points;

  for v_cat in select c->>'id' from jsonb_array_elements(p_state->'categories') c loop
    v_valid := '{}'::jsonb;
    v_cd := '{}'::jsonb;
    for pl in select x from jsonb_array_elements_text(p_state->'players') x loop
      a := p_state#>array['validation', 'answers', v_cat, pl];
      v_cnt := coalesce(jsonb_array_length(p_state#>array['validation', 'contests', v_cat, pl]), 0);
      if a is null or a->>'auto' is not null then
        v_status := coalesce(a->>'auto', 'empty');
      elsif v_cnt * 2 > v_n - 1 then
        v_status := 'refused';
      else
        v_status := 'valid';
        v_valid := v_valid || jsonb_build_object(pl, a->>'norm');
      end if;
      v_cd := v_cd || jsonb_build_object(pl, jsonb_build_object(
                'text', coalesce(a->>'text', ''), 'status', v_status, 'pts', 0, 'contests', v_cnt));
    end loop;

    for pl in select key from jsonb_each_text(v_valid) loop
      select count(*) into v_cnt from jsonb_each_text(v_valid) where value = v_valid->>pl;
      v_pts := case when v_cnt > 1 then 1 else 2 end;
      v_cd := jsonb_set(v_cd, array[pl], (v_cd->pl) || jsonb_build_object(
                'status', case when v_cnt > 1 then 'shared' else 'unique' end, 'pts', v_pts));
      v_points := jsonb_set(v_points, array[pl], to_jsonb((v_points->>pl)::integer + v_pts));
      if v_pts = 2 then
        v_uniq := jsonb_set(v_uniq, array[pl], to_jsonb((v_uniq->>pl)::integer + 1));
      end if;
    end loop;
    v_detail := v_detail || jsonb_build_object(v_cat, v_cd);
  end loop;

  p_state := p_state || jsonb_build_object(
    'phase', 'round_score',
    'validation', null,
    'scores', (select jsonb_object_agg(key, value::integer + coalesce((v_points->>key)::integer, 0))
                 from jsonb_each_text(p_state->'scores')),
    'uniques', (select jsonb_object_agg(key, value::integer + coalesce((v_uniq->>key)::integer, 0))
                  from jsonb_each_text(coalesce(p_state->'uniques', v_points))),
    'last_round', jsonb_build_object(
        'round', p_state->'round', 'letter', p_state->'letter',
        'points', v_points, 'uniques', v_uniq, 'detail', v_detail),
    'history', coalesce(p_state->'history', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'round', p_state->'round', 'letter', p_state->'letter', 'points', v_points)));
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

create or replace function public._pb_finish(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_max     integer;
  v_results jsonb;
  v_winners jsonb;
begin
  select coalesce(max(value::integer), 0) into v_max from jsonb_each_text(p_state->'scores');

  select jsonb_agg(jsonb_build_object(
           'profile_id', t.key,
           'points', t.value::integer,
           'won', v_max > 0 and t.value::integer = v_max,
           'placement', t.r,
           'stats', '{}'::jsonb)
         order by t.r, t.key)
    into v_results
    from (select key, value, rank() over (order by value::integer desc) as r
            from jsonb_each_text(p_state->'scores')) t;

  select coalesce(jsonb_agg(key order by key), '[]'::jsonb) into v_winners
    from jsonb_each_text(p_state->'scores') where v_max > 0 and value::integer = v_max;

  p_state := p_state || jsonb_build_object('phase', 'finished', 'winners', v_winners, 'results', v_results);
  return jsonb_build_object('state', p_state, 'server', p_server, 'results', v_results);
end $$;

-- Options : {"categories":[{"id","label","emoji"}] (1-12), "duration":90|120|180|300,
--            "rounds":1-15, "letters":["A",…] (lettres tirables, défaut A-V sans K/Q)}
create or replace function public.game_petit_bac_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_cats    jsonb := p_options->'categories';
  v_letters text[];
  v_dur     integer;
  v_rounds  integer;
  v_seq     jsonb;
  v_zero    jsonb;
  v_state   jsonb;
begin
  if cardinality(p_players) < 2 then raise exception 'not_enough_players'; end if;

  if v_cats is null or jsonb_typeof(v_cats) <> 'array'
     or jsonb_array_length(v_cats) not between 1 and 12 then
    raise exception 'invalid_categories';
  end if;
  if exists (select 1 from jsonb_array_elements(v_cats) c
              where jsonb_typeof(c) <> 'object'
                 or coalesce(c->>'id', '') !~ '^[a-z0-9_-]{1,40}$'
                 or char_length(btrim(coalesce(c->>'label', ''))) not between 1 and 40
                 or char_length(coalesce(c->>'emoji', '')) > 16)
     or (select count(distinct c->>'id') from jsonb_array_elements(v_cats) c) <> jsonb_array_length(v_cats) then
    raise exception 'invalid_categories';
  end if;
  select jsonb_agg(jsonb_build_object('id', c->>'id', 'label', btrim(c->>'label'),
                                      'emoji', coalesce(c->>'emoji', '')) order by o)
    into v_cats from jsonb_array_elements(v_cats) with ordinality as t(c, o);

  if jsonb_typeof(p_options->'letters') = 'array' then
    v_letters := array(select distinct upper(x) from jsonb_array_elements_text(p_options->'letters') x
                        where upper(x) ~ '^[A-Z]$');
  end if;
  if coalesce(cardinality(v_letters), 0) = 0 then
    v_letters := string_to_array('A,B,C,D,E,F,G,H,I,J,L,M,N,O,P,R,S,T,U,V', ',');
  end if;

  v_dur := coalesce(nullif(p_options->>'duration', '')::integer, 120);
  if v_dur not in (90, 120, 180, 300) then v_dur := 120; end if;
  v_rounds := coalesce(nullif(p_options->>'rounds', '')::integer, 5);
  v_rounds := least(greatest(v_rounds, 1), 15, cardinality(v_letters));

  -- Lettres de toute la partie tirées d'avance, sans répétition (secret serveur).
  select jsonb_agg(l) into v_seq
    from (select l from unnest(v_letters) l order by random() limit v_rounds) t;
  select jsonb_object_agg(p::text, 0) into v_zero from unnest(p_players) p;

  v_state := jsonb_build_object(
    'game', 'petit-bac',
    'phase', 'writing',
    'round', 1,
    'total_rounds', v_rounds,
    'players', to_jsonb(p_players),
    'categories', v_cats,
    'duration', v_dur,
    'letter', null,
    'letters_used', '[]'::jsonb,
    'starts_at', null,
    'deadline', null,
    'progress', v_zero,
    'validation', null,
    'scores', v_zero,
    'uniques', v_zero,
    'last_round', null,
    'history', '[]'::jsonb,
    'winners', null,
    'results', null);

  return public._pb_start_round(v_state, jsonb_build_object('letters', v_seq, 'answers', '{}'::jsonb), 1)
         || jsonb_build_object('secrets', '{}'::jsonb);
end $$;

create or replace function public.game_petit_bac_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_type     text := p_action->>'type';
  v_phase    text := p_state->>'phase';
  v_me       text := p_actor::text;
  v_player   boolean := (p_state->'players') ? p_actor::text;
  v_round    integer := (p_state->>'round')::integer;
  v_ans      jsonb;
  v_mine     jsonb;
  v_filled   integer;
  v_cat      text;
  v_idx      integer;
  v_cur      integer;
  v_ncat     integer := jsonb_array_length(p_state->'categories');
  v_target   text;
  v_value    boolean;
  v_list     jsonb;
  v_contests jsonb;
begin
  -- ---------------------------------------------------------------- save
  if v_type = 'save' then
    if not v_player then raise exception 'not_a_player'; end if;
    v_ans := p_action->'answers';
    if v_ans is null or jsonb_typeof(v_ans) <> 'object' then raise exception 'invalid_action'; end if;
    -- Sauvegarde hors délai / d'une autre manche : ignorée sans erreur
    -- (tolérance réseau : acceptée jusqu'à 2 s après l'échéance, même si la
    -- validation a déjà commencé — les réponses affichées sont alors recalculées).
    if (p_action ? 'round' and (p_action->>'round') is distinct from (p_state->>'round'))
       or v_phase not in ('writing', 'validation')
       or now() > (p_state->>'deadline')::timestamptz + interval '2 seconds' then
      return jsonb_build_object('state', p_state, 'server', p_server);
    end if;

    v_mine := coalesce(p_server->'answers'->v_me, '{}'::jsonb);
    select v_mine || coalesce(jsonb_object_agg(c->>'id', public._pb_clean(v_ans->>(c->>'id'))), '{}'::jsonb)
      into v_mine
      from jsonb_array_elements(p_state->'categories') c
     where jsonb_typeof(v_ans->(c->>'id')) = 'string';
    select count(*) into v_filled from jsonb_each_text(v_mine) where value <> '';

    p_server := jsonb_set(p_server, array['answers', v_me], v_mine, true);
    p_state := jsonb_set(p_state, array['progress', v_me], to_jsonb(v_filled), true);
    if v_phase = 'validation' then
      p_state := jsonb_set(p_state, '{validation,answers}', public._pb_build_answers(p_state, p_server));
    end if;
    return jsonb_build_object('state', p_state, 'server', p_server,
      'secrets', jsonb_build_object(v_me, jsonb_build_object('round', v_round, 'answers', v_mine)));

  -- ---------------------------------------------------------------- tick
  elsif v_type = 'tick' then
    if v_phase = 'writing' and now() >= (p_state->>'deadline')::timestamptz then
      return public._pb_to_validation(p_state, p_server);
    end if;
    return jsonb_build_object('state', p_state, 'server', p_server);

  -- ---------------------------------------------------------------- end_round
  elsif v_type = 'end_round' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase <> 'writing' then raise exception 'wrong_phase'; end if;
    -- L'échéance devient « maintenant » : la tolérance de 2 s s'applique aussi.
    p_state := p_state || jsonb_build_object('deadline', least(now(), (p_state->>'deadline')::timestamptz),
                                             'forced', true);
    return public._pb_to_validation(p_state, p_server);

  -- ---------------------------------------------------------------- contest
  elsif v_type = 'contest' then
    if v_phase <> 'validation' then raise exception 'wrong_phase'; end if;
    if not v_player then raise exception 'not_a_player'; end if;
    v_cat := p_action->>'category';
    select o - 1 into v_idx
      from jsonb_array_elements(p_state->'categories') with ordinality as t(c, o)
     where c->>'id' = v_cat;
    if v_idx is null then raise exception 'invalid_action'; end if;
    v_cur := (p_state#>>'{validation,cat_index}')::integer;
    if v_idx > v_cur then raise exception 'wrong_phase'; end if;
    v_target := p_action->>'target';
    if v_target is null or not ((p_state->'players') ? v_target) then raise exception 'invalid_target'; end if;
    if v_target = v_me then raise exception 'cannot_vote_self'; end if;
    if p_state#>>array['validation', 'answers', v_cat, v_target, 'auto'] is not null then
      raise exception 'invalid_target';  -- déjà refusée automatiquement
    end if;
    v_value := coalesce((p_action->>'value')::boolean, true);

    v_contests := coalesce(p_state#>'{validation,contests}', '{}'::jsonb);
    select coalesce(jsonb_agg(x order by x), '[]'::jsonb) into v_list
      from (select x from jsonb_array_elements_text(coalesce(v_contests#>array[v_cat, v_target], '[]'::jsonb)) x
             where x <> v_me
            union
            select v_me where v_value) t;
    v_contests := v_contests || jsonb_build_object(v_cat,
                    coalesce(v_contests->v_cat, '{}'::jsonb) || jsonb_build_object(v_target, v_list));
    p_state := jsonb_set(p_state, '{validation,contests}', v_contests);
    return jsonb_build_object('state', p_state, 'server', p_server);

  -- ---------------------------------------------------------------- next_category
  elsif v_type = 'next_category' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase <> 'validation' then raise exception 'wrong_phase'; end if;
    v_cur := (p_state#>>'{validation,cat_index}')::integer;
    if v_cur + 1 >= v_ncat then
      return public._pb_score(p_state, p_server);
    end if;
    p_state := jsonb_set(p_state, '{validation,cat_index}', to_jsonb(v_cur + 1));
    return jsonb_build_object('state', p_state, 'server', p_server);

  -- ---------------------------------------------------------------- close_validation
  elsif v_type = 'close_validation' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase <> 'validation' then raise exception 'wrong_phase'; end if;
    return public._pb_score(p_state, p_server);

  -- ---------------------------------------------------------------- next_round
  elsif v_type = 'next_round' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase <> 'round_score' then raise exception 'wrong_phase'; end if;
    if v_round >= (p_state->>'total_rounds')::integer then
      return public._pb_finish(p_state, p_server);
    end if;
    return public._pb_start_round(p_state - 'forced', p_server, v_round + 1);

  else
    raise exception 'unknown_action';
  end if;
end $$;

revoke all on function public._pb_norm(text) from public, anon, authenticated;
revoke all on function public._pb_clean(text) from public, anon, authenticated;
revoke all on function public._pb_start_round(jsonb, jsonb, integer) from public, anon, authenticated;
revoke all on function public._pb_build_answers(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._pb_to_validation(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._pb_score(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._pb_finish(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.game_petit_bac_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_petit_bac_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;


-- ===== seed.sql =====
-- =============================================================================
-- Soirées de Dédé — seed des 9 profils (idempotent)
-- À exécuter APRÈS schema.sql. Ne touche jamais au PIN, à l'XP ni au pseudo
-- d'un profil existant (on conflict : prénom, expressions et ordre seulement).
-- =============================================================================

insert into public.profiles (slug, first_name, nickname, expressions, sort_order) values
  ('kevin',  'Kevin',    'Keke',   array['joie','colere','pleurs','boude','reflexion','dodo','bisou','clin_oeil','surprise','amoureux','cool','gamer'], 1),
  ('cycy',   'Cyrielle', 'Cycy',   array['joie','colere','pleurs','boude','reflexion','dodo','bisou','clin_oeil','surprise','amoureux','cool','gamer'], 2),
  ('dede',   'Delphine', 'Dédé',   array['joie','colere','pleurs','boude','reflexion','dodo','bisou','clin_oeil','surprise','amoureux','cool','gamer'], 3),
  ('manon',  'Manon',    'Manon',  array['joie','colere','pleurs','boude','reflexion','dodo','bisou','clin_oeil','surprise','amoureux','cool','gamer'], 4),
  ('mika',   'Michael',  'Mika',   array['joie','colere','pleurs','boude','reflexion','dodo','bisou','clin_oeil','surprise','amoureux','cool','gamer'], 5),
  ('cecile', 'Cécile',   'Cécile', array['joie','colere','pleurs','boude','reflexion','dodo','bisou','clin_oeil','surprise','amoureux','cool','gamer'], 6),
  ('carole', 'Carole',   'Karo',   array['joie','colere','pleurs','boude','reflexion','dodo','bisou','clin_oeil','surprise','pouces','timide','charmee'], 7),
  ('marius', 'Marius',   'Marius', array['joie','colere','pleurs','boude','reflexion','dodo','bisou','clin_oeil','surprise','amoureux','cool','gamer'], 8),
  ('nini',   'Nicolas',  'Nini',   array['joie','colere','pleurs','boude','reflexion','dodo','bisou','clin_oeil','surprise','pouces','timide','gamer'], 9)
on conflict (slug) do update
  set first_name  = excluded.first_name,
      expressions = excluded.expressions,
      sort_order  = excluded.sort_order;

-- Admin
update public.profiles set is_admin = (slug = 'kevin') where is_admin is distinct from (slug = 'kevin');

-- Expression équipée invalide (ex. expressions modifiées) -> retour à 'joie'
update public.profiles set equipped_expression = 'joie'
 where not (equipped_expression = any(expressions));

-- Lignes de stats + déblocage par défaut
insert into public.player_stats (profile_id)
select id from public.profiles
on conflict (profile_id) do nothing;

insert into public.unlocks (profile_id, expression)
select id, 'joie' from public.profiles
on conflict (profile_id, expression) do nothing;
