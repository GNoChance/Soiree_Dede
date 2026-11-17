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

-- Joueurs exclus d'une soirée par l'hôte : ils ne peuvent plus la rejoindre par code
-- (soiree_banned) tant que l'hôte ne les a pas ré-invités (invite_to_soiree).
create table if not exists public.soiree_bans (
  soiree_id  uuid not null references public.soirees(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  banned_at  timestamptz not null default now(),
  primary key (soiree_id, profile_id)
);

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

-- Multi-soirées + fin automatique (cf. section 6) :
--  * soirees.end_reason : 'host' (end_soiree) | 'empty' (dernier joueur parti) |
--    'idle' (20 min sans jeu) | 'abandoned' (partie figée depuis 3 h) |
--    'admin' (supprimée par un admin, admin_end_soiree).
--    Null pour les soirées terminées avant cette colonne.
--  * matches.updated_at : dernière écriture de la ligne (trigger matches_touch),
--    sert au filet « partie abandonnée depuis 3 h ». Rattrapage des lignes
--    existantes : fin de partie pour une partie terminée ; heure de la
--    MIGRATION pour une partie non terminée (sa dernière action est inconnue :
--    la dater à sa création tuerait une longue session — Roi de la table,
--    tournoi — jouée au moment où install.sql est recollé ; au pire, une partie
--    réellement abandonnée vit 3 h de plus).
alter table public.soirees add column if not exists end_reason text;
alter table public.soirees drop constraint if exists soirees_end_reason_chk;
alter table public.soirees add constraint soirees_end_reason_chk
  check (end_reason is null or end_reason in ('host', 'empty', 'idle', 'abandoned', 'admin'));
alter table public.matches add column if not exists updated_at timestamptz;
update public.matches
   set updated_at = case when status <> 'finished' then now() else coalesce(finished_at, created_at) end
 where updated_at is null;
alter table public.matches alter column updated_at set default now();
alter table public.matches alter column updated_at set not null;
-- Parties non terminées (filet 3 h, exécuté chaque minute par pg_cron).
create index if not exists matches_unfinished_idx on public.matches(updated_at) where status <> 'finished';

create table if not exists public.match_players (
  match_id   uuid not null references public.matches(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  game_id    text not null,          -- dénormalisé pour les classements par jeu
  placement  integer not null,
  points     integer not null default 0,
  won        boolean not null default false,
  primary key (match_id, profile_id)
);
-- Stats propres au jeu (ex. jeux en duel : {"duel_wins": n}) ; sert aux tenues.
alter table public.match_players add column if not exists stats jsonb not null default '{}'::jsonb;
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
returns uuid language plpgsql security definer
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

-- Constantes des soirées (une seule source de vérité côté SQL).
create or replace function public._soiree_max_open()      -- soirées non terminées par profil
returns integer language sql immutable as $$ select 5 $$;
create or replace function public._soiree_idle_timeout()  -- fin auto sans partie en cours
returns interval language sql immutable as $$ select interval '20 minutes' $$;
create or replace function public._match_stale_timeout()  -- partie 'playing' figée = abandonnée
returns interval language sql immutable as $$ select interval '3 hours' $$;

-- Soirée non terminée la plus récemment rejointe (compat : un profil peut
-- désormais être dans plusieurs soirées, cf. my_active_soirees()).
create or replace function public._active_soiree_of(p_profile_id uuid)
returns uuid language sql stable security definer
set search_path = public, extensions
as $$
  select sp.soiree_id from public.soiree_players sp
  join public.soirees s on s.id = sp.soiree_id
  where sp.profile_id = p_profile_id and s.status <> 'ended'
  order by sp.joined_at desc, s.created_at desc limit 1
$$;

-- Nombre de soirées non terminées dont le profil est membre.
create or replace function public._open_soirees_count(p_profile_id uuid)
returns integer language sql stable security definer
set search_path = public, extensions
as $$
  select count(*)::integer from public.soiree_players sp
  join public.soirees s on s.id = sp.soiree_id
  where sp.profile_id = p_profile_id and s.status <> 'ended'
$$;

-- Dernière activité d'une soirée = création, démarrage ou fin/annulation de sa
-- dernière partie (calculée : pas de colonne à maintenir).
create or replace function public._soiree_last_activity(p_soiree_id uuid)
returns timestamptz language sql stable security definer
set search_path = public, extensions
as $$
  select greatest(s.created_at,
                  (select max(m.created_at) from public.matches m where m.soiree_id = s.id),
                  (select max(m.finished_at) from public.matches m where m.soiree_id = s.id))
  from public.soirees s where s.id = p_soiree_id
$$;

-- SoireeJson : la ligne soirees + player_ids + last_activity_at + current_match
-- (partie non terminée la plus récente : {id, game_id, status, created_at, player_ids})
-- + idle_deadline (fin automatique prévue ; null si partie en cours ou soirée terminée).
create or replace function public._soiree_json(p_soiree_id uuid)
returns jsonb language sql stable security definer
set search_path = public, extensions
as $$
  select to_jsonb(s) || jsonb_build_object(
      'player_ids', coalesce((
        select jsonb_agg(sp.profile_id order by sp.joined_at, sp.profile_id)
        from public.soiree_players sp where sp.soiree_id = s.id), '[]'::jsonb),
      'last_activity_at', la.t,
      'current_match', cm.j,
      'idle_deadline', case when s.status <> 'ended' and cm.j is null
                            then la.t + public._soiree_idle_timeout() end)
  from public.soirees s
  cross join lateral (select public._soiree_last_activity(s.id) as t) la
  left join lateral (
    select jsonb_build_object('id', m.id, 'game_id', m.game_id, 'status', m.status,
                              'created_at', m.created_at,
                              'player_ids', case when jsonb_typeof(m.state->'players') = 'array'
                                                 then m.state->'players' else '[]'::jsonb end) as j
      from public.matches m
     where m.soiree_id = s.id and m.status <> 'finished'
     order by m.created_at desc limit 1) cm on true
  where s.id = p_soiree_id
$$;

-- =============================================================================
-- 3. DÉBLOCAGES
-- =============================================================================

-- Palette commune des tenues (planches costumes) : ouverte à tous les persos,
-- en plus de leur planche de base (profiles.expressions).
create or replace function public._costume_expressions()
returns text[] language sql immutable
as $$ select array['joie','colere','pleurs','boude','reflexion','dodo',
                   'bisou','clin_oeil','surprise','pouces','timide','determine'] $$;

-- Évalue toutes les conditions pour un profil ; renvoie les expressions
-- nouvellement débloquées. Comptent : profiles.expressions + la palette des tenues.
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
  -- Déterminé (palette des tenues) : condition de Cool OU de Gamer, remplie maintenant ou déjà acquise.
  if 'cool' = any(v_c) or 'gamer' = any(v_c) or exists (
    select 1 from public.unlocks u where u.profile_id = p_profile_id and u.expression in ('cool', 'gamer')
  ) then v_c := v_c || 'determine'::text; end if;

  with ins as (
    insert into public.unlocks(profile_id, expression)
    select p_profile_id, e from unnest(v_c) e
     where e = any(v_p.expressions) or e = any(public._costume_expressions())
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

-- Ancienne signature (text) : remplacée par (text, integer) — drop pour éviter l'ambiguïté PostgREST.
drop function if exists public.equip_expression(text);

-- p_slot : rang (1..12, ou 12+N pour extraN) du sticker dans la planche de la TENUE équipée ;
-- envoyé par le front seulement quand il affiche la planche d'une tenue (pas la planche de base).
-- Slot 1 (joie) et stickers bonus (slot > 12) : offerts avec la tenue ; slots 2..12 : trophée de la
-- tenue (cf. features/trophees.sql, _tenue_slot_ok). Sans p_slot : conditions d'expression habituelles.
create or replace function public.equip_expression(p_expression text, p_slot integer default null)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me    uuid := public._require_profile();
  v_tenue text;
begin
  select equipped_tenue into v_tenue from public.profiles where id = v_me;
  if p_slot is not null and coalesce(v_tenue, 'default') <> 'default' then
    if p_expression !~ '^[a-z0-9_]{1,24}$' then raise exception 'unknown_expression'; end if;
    if not public._tenue_slot_ok(v_me, v_tenue, p_slot) then
      raise exception 'expression_locked';
    end if;
  elsif p_expression ~ '^extra[1-9]$' then
    -- Sticker bonus d'une planche de tenue : dispo dès qu'une tenue (déjà débloquée, cf. equip_tenue) est portée.
    if not exists (select 1 from public.profiles where id = v_me and equipped_tenue is not null and equipped_tenue <> 'default') then
      raise exception 'expression_locked';
    end if;
  else
    if not exists (select 1 from public.profiles where id = v_me and p_expression = any(expressions))
       and not (p_expression = any(public._costume_expressions())) then
      raise exception 'unknown_expression';
    end if;
    if p_expression <> 'joie' and not exists (
      select 1 from public.unlocks where profile_id = v_me and expression = p_expression
    ) then
      raise exception 'expression_locked';
    end if;
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

-- Termine une soirée (interne).
--  * p_reason -> soirees.end_reason ('host' | 'empty' | 'idle' | 'abandoned' ;
--    null = inchangée), posée dans le MÊME update que status = 'ended' : l'évènement
--    Realtime de fin porte déjà la raison (le front affiche « faute de jeu »).
--  * p_at = heure de fin retenue (ended_at + « dodo »), jamais dans le futur :
--    now() en général ; pour la fin auto 'idle', l'échéance d'inactivité (dernière
--    activité + 20 min) : même résultat que le nettoyage passe tout de suite (pg_cron)
--    ou plus tard (RPC paresseuse).
--  * p_natural = false : fin « non naturelle » (filet partie abandonnée), pas de dodo.
-- Compte une soirée (stat surprise) pour chaque joueur ayant fini au moins une
-- partie dedans ; « dodo » pour les joueurs présents à la fin si fin entre 2h et 8h (Paris).
create or replace function public._close_soiree(p_soiree_id uuid, p_reason text, p_natural boolean, p_at timestamptz)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_at      timestamptz := least(coalesce(p_at, now()), now());
  v_players uuid[];
  v_hour    integer;
begin
  update public.soirees
     set status = 'ended', ended_at = v_at, end_reason = coalesce(p_reason, end_reason)
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

  v_hour := extract(hour from (v_at at time zone 'Europe/Paris'))::integer;
  if p_natural and v_hour >= 2 and v_hour < 8 then
    update public.player_stats ps
       set late_soirees_count = ps.late_soirees_count + 1, updated_at = now()
     where ps.profile_id = any(v_players)
       and exists (select 1 from public.soiree_players sp
                    where sp.soiree_id = p_soiree_id and sp.profile_id = ps.profile_id);
  end if;

  return public._unlocks_map(v_players);
end $$;

-- Compat (ancienne signature) : fin « maintenant », raison inchangée.
create or replace function public._end_soiree(p_soiree_id uuid, p_natural boolean)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
begin
  return public._close_soiree(p_soiree_id, null, p_natural, now());
end $$;

-- Trigger : matches.updated_at = horodatage de la dernière écriture (sauf si
-- l'UPDATE le fixe explicitement). Sert au filet « partie figée depuis 3 h ».
create or replace function public._matches_touch()
returns trigger language plpgsql
set search_path = public, extensions
as $$
begin
  if new.updated_at is not distinct from old.updated_at then
    new.updated_at := now();
  end if;
  return new;
end $$;
drop trigger if exists matches_touch on public.matches;
create trigger matches_touch before update on public.matches
  for each row execute function public._matches_touch();

-- Fin automatique des soirées (paresseuse dans les RPC soirée + job pg_cron
-- « soirees-idle-cleanup » chaque minute, cf. section 16) :
--  1. filet : une partie non terminée sans aucune écriture depuis 3 h est
--     annulée (phase 'aborted') et sa soirée close (end_reason 'abandoned',
--     fin « non naturelle » : pas de dodo) ;
--  2. une soirée SANS partie en cours dont la dernière activité (création,
--     démarrage ou fin/annulation d'une partie) date de plus de 20 min est close
--     (end_reason 'idle', fin naturelle datée à l'échéance : stats soirées + dodo
--     si l'échéance tombe entre 2h et 8h, heure de Paris).
-- Une partie en cours (non terminée, écrite depuis moins de 3 h) ne déclenche
-- jamais la fin. Candidats choisis sans verrou, puis verrou de la soirée (même ordre
-- que end_soiree / start_match : soirée puis partie) et RE-VÉRIFICATION : une partie
-- lancée ou jouée entre-temps (transaction concurrente validée) annule la clôture.
create or replace function public._cleanup_stale_soirees()
returns void language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_sid  uuid;
  v_mid  uuid;
  v_last timestamptz;
begin
  -- 1. Filet : partie figée depuis 3 h.
  for v_sid in
    select distinct m.soiree_id from public.matches m
      join public.soirees s on s.id = m.soiree_id
     where m.status <> 'finished' and s.status <> 'ended'
       and m.updated_at < now() - public._match_stale_timeout()
     order by m.soiree_id
  loop
    perform 1 from public.soirees where id = v_sid and status <> 'ended' for update;
    continue when not found;
    select m.id into v_mid from public.matches m
     where m.soiree_id = v_sid and m.status <> 'finished'
       and m.updated_at < now() - public._match_stale_timeout()
     order by m.created_at limit 1
       for update;
    continue when v_mid is null;
    -- _close_soiree annule toutes les parties non terminées de la soirée (phase 'aborted').
    perform public._close_soiree(v_sid, 'abandoned', false, now());
  end loop;

  -- 2. Fin auto : 20 min sans jeu.
  for v_sid in
    select s.id from public.soirees s
     where s.status <> 'ended'
       and not exists (select 1 from public.matches m where m.soiree_id = s.id and m.status <> 'finished')
       and public._soiree_last_activity(s.id) < now() - public._soiree_idle_timeout()
     order by s.id
  loop
    perform 1 from public.soirees where id = v_sid and status <> 'ended' for update;
    continue when not found;
    continue when exists (select 1 from public.matches m
                           where m.soiree_id = v_sid and m.status <> 'finished');
    v_last := public._soiree_last_activity(v_sid);
    continue when v_last >= now() - public._soiree_idle_timeout();
    perform public._close_soiree(v_sid, 'idle', true, v_last + public._soiree_idle_timeout());
  end loop;
end $$;

-- Compat : la soirée non terminée la plus récemment rejointe (ou null).
create or replace function public.my_active_soiree()
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
begin
  perform public._cleanup_stale_soirees();
  return public._soiree_json(public._active_soiree_of(public.current_profile_id()));
end $$;

-- Toutes mes soirées non terminées (≤ 5), la plus récente d'abord :
-- [SoireeJson + host (profil) + joined_at (mon arrivée)].
create or replace function public.my_active_soirees()
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare v_me uuid := public._require_profile();
begin
  perform public._cleanup_stale_soirees();
  return coalesce((
    select jsonb_agg(public._soiree_json(s.id)
                     || jsonb_build_object('host', public._profile_json(s.host_id),
                                           'joined_at', sp.joined_at)
                     order by s.created_at desc, s.id)
      from public.soiree_players sp
      join public.soirees s on s.id = sp.soiree_id
     where sp.profile_id = v_me and s.status <> 'ended'), '[]'::jsonb);
end $$;

-- Crée une soirée (l'appelant en est l'hôte). Un profil peut être dans au plus
-- 5 soirées non terminées : too_many_soirees (moi), player_busy (invités déjà
-- dans 5 soirées, pseudos dans `detail`).
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

  if public._open_soirees_count(v_me) >= public._soiree_max_open() then
    raise exception 'too_many_soirees';
  end if;

  v_ids := array(select distinct x from unnest(coalesce(p_player_ids, '{}') || v_me) x where x is not null);
  if exists (select 1 from unnest(v_ids) x where not exists (select 1 from public.profiles p where p.id = x)) then
    raise exception 'unknown_profile';
  end if;
  select string_agg(p.nickname, ', ' order by p.sort_order) into v_busy
    from public.profiles p
   where p.id = any(v_ids) and p.id <> v_me
     and public._open_soirees_count(p.id) >= public._soiree_max_open();
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
  if exists (select 1 from public.soiree_bans where soiree_id = v_sid and profile_id = v_me) then
    raise exception 'soiree_banned';
  end if;
  if public._open_soirees_count(v_me) >= public._soiree_max_open() then
    raise exception 'too_many_soirees';
  end if;

  insert into public.soiree_players(soiree_id, profile_id) values (v_sid, v_me);
  return public._soiree_json(v_sid);
end $$;

-- Quitte une soirée non terminée (p_soiree_id ; null/absent = la plus récemment
-- rejointe, compat avec l'ancien leave_soiree() sans paramètre). Sans effet si je
-- n'en suis pas membre ou si elle est terminée. Si l'hôte part, l'hôte passe au
-- plus ancien joueur restant ; si plus personne, la soirée est terminée.
drop function if exists public.leave_soiree();
create or replace function public.leave_soiree(p_soiree_id uuid default null)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me     uuid := public._require_profile();
  v_sid    uuid;
  v_host   uuid;
  v_status text;
  v_new    uuid;
begin
  perform pg_advisory_xact_lock(hashtext('soiree_membership'));
  v_sid := coalesce(p_soiree_id, public._active_soiree_of(v_me));
  if v_sid is null then return; end if;

  select host_id, status into v_host, v_status from public.soirees where id = v_sid for update;
  if not found or v_status = 'ended' then return; end if;
  delete from public.soiree_players where soiree_id = v_sid and profile_id = v_me;
  if not found then return; end if;

  if v_host = v_me then
    select profile_id into v_new from public.soiree_players
     where soiree_id = v_sid order by joined_at, profile_id limit 1;
    if v_new is null then
      perform public._close_soiree(v_sid, 'empty', true, now());
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
  return jsonb_build_object('new_unlocks', public._close_soiree(p_soiree_id, 'host', true, now()));
end $$;

-- ---- Admin : soirées en cours ------------------------------------------------
-- Pour débloquer une soirée buguée : l'admin voit toutes les soirées non terminées
-- et peut les clore de force (partie en cours annulée, sans XP ; parties déjà
-- terminées conservées dans l'historique ; tous les joueurs sortent de la soirée).

create or replace function public._require_admin()
returns uuid language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := public._require_profile();
begin
  if not exists (select 1 from public.profiles where id = v_me and is_admin) then
    raise exception 'forbidden';
  end if;
  return v_me;
end $$;

create or replace function public.admin_list_soirees()
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
begin
  perform public._require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', s.id, 'code', s.code, 'status', s.status, 'created_at', s.created_at,
             'host_id', s.host_id,
             'player_ids', coalesce((select jsonb_agg(sp.profile_id order by sp.joined_at)
                                       from public.soiree_players sp where sp.soiree_id = s.id), '[]'::jsonb),
             'match', (select jsonb_build_object('id', m.id, 'game_id', m.game_id, 'status', m.status,
                                                 'created_at', m.created_at, 'updated_at', m.updated_at)
                         from public.matches m
                        where m.soiree_id = s.id and m.status <> 'finished'
                        order by m.created_at desc limit 1))
           order by s.created_at desc)
      from public.soirees s
     where s.status <> 'ended'), '[]'::jsonb);
end $$;

create or replace function public.admin_end_soiree(p_soiree_id uuid)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_s public.soirees%rowtype;
begin
  perform public._require_admin();
  select * into v_s from public.soirees where id = p_soiree_id for update;
  if not found then raise exception 'soiree_not_found'; end if;
  if v_s.status = 'ended' then raise exception 'soiree_ended'; end if;
  -- Fin « non naturelle » : pas de dodo.
  return jsonb_build_object('new_unlocks', public._close_soiree(p_soiree_id, 'admin', false, now()));
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

-- Hook trophées : no-op ici, redéfini par supabase/features/trophees.sql.
-- Renvoie {profile_id: [trophy_ids]} fusionné sous `new_trophies`.
create or replace function public._after_finish_trophies(p_match_id uuid, p_profile_ids uuid[])
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
  v_np    integer;
  v_nt    jsonb;
  v_ntr   jsonb;
begin
  select * into v_m from public.matches where id = p_match_id for update;
  if not found then raise exception 'match_not_found'; end if;
  if v_m.status = 'finished' then raise exception 'match_already_finished'; end if;

  select max(x.placement), min(x.placement), count(*) into v_maxp, v_minp, v_np
    from jsonb_to_recordset(p_results) as x(placement integer);

  for r in
    select * from jsonb_to_recordset(p_results)
      as x(profile_id uuid, points integer, won boolean, placement integer, stats jsonb)
  loop
    insert into public.match_players(match_id, profile_id, game_id, placement, points, won, stats)
    values (p_match_id, r.profile_id, v_m.game_id, coalesce(r.placement, 1),
            coalesce(r.points, 0), coalesce(r.won, false),
            -- 'last' (1 = dernier d'une partie non nulle) et 'nplayers' : stats génériques lues par les trophées.
            (case when jsonb_typeof(r.stats) = 'object' then r.stats else '{}'::jsonb end)
              || jsonb_build_object('last', case when v_maxp > v_minp and r.placement = v_maxp then 1 else 0 end,
                                    'nplayers', v_np));

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

  -- Dans l'ordre : tenues d'abord (le trophée « Garde-robe » compte les tenues), puis trophées.
  v_nt  := coalesce(public._after_finish_match(p_match_id, v_ids), '{}'::jsonb);
  v_ntr := coalesce(public._after_finish_trophies(p_match_id, v_ids), '{}'::jsonb);
  return jsonb_build_object('new_unlocks', public._unlocks_map(v_ids), 'xp_gained', v_xpmap,
                            'new_tenues', v_nt, 'new_trophies', v_ntr);
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
        'counts', v_counts, 'majority', to_jsonb(v_maj), 'scorers', to_jsonb(v_scorers))));

  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Stats de fin de partie pour les trophées (cf. features/trophees.sql), recopiées depuis le state final.
create or replace function public._qdn_tstats(p_state jsonb, p_pl text)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  with h as (
    select e.o, coalesce((e.v->'counts'->>p_pl)::integer, 0) as mine,
           coalesce((select max(value::integer) from jsonb_each_text(e.v->'counts')), 0) as mx,
           coalesce(e.v->'scorers', '[]'::jsonb) ? p_pl as maj
      from jsonb_array_elements(coalesce(p_state->'history', '[]'::jsonb)) with ordinality as e(v, o)
  )
  select jsonb_build_object(
    -- plus longue série de manches où le joueur a voté avec la majorité (Le flair)
    'maj_streak', (select coalesce(max(c), 0) from (
        select count(*) as c from (
          select maj, o - row_number() over (partition by maj order by o) as grp from h) x
         where maj group by grp) y),
    'rounds', (p_state->>'total_rounds')::integer,
    -- manches sans point (hors majorité ; une manche sans vote compte aussi)
    'off_majority', greatest(0, (p_state->>'total_rounds')::integer - coalesce((p_state->'scores'->>p_pl)::integer, 0)),
    'pointed_by_all', (select count(*) from h where mine > 0 and mine = jsonb_array_length(p_state->'players') - 1
                         and jsonb_array_length(p_state->'players') >= 3),
    'top_rounds', (select count(*) from h where mine > 0 and mine = mx),
    'top_designated', case when coalesce((p_state->'designated'->>p_pl)::integer, 0) > 0
        and coalesce((p_state->'designated'->>p_pl)::integer, 0) >=
            (select max(value::integer) from jsonb_each_text(p_state->'designated')) then 1 else 0 end,
    'perfect', case when (p_state->>'total_rounds')::integer >= 10
        and coalesce((p_state->'scores'->>p_pl)::integer, 0) = (p_state->>'total_rounds')::integer then 1 else 0 end)
$$;

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
           'stats', jsonb_build_object('designated', coalesce((p_state->'designated'->>t.key)::integer, 0))
                    || public._qdn_tstats(p_state, t.key))
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
             'undercover_first_out', case when elim_idx = 1 then 1 else 0 end,
             -- trophées (features/trophees.sql)
             'wrongly_out', case when role = 'civil' and elim_idx is not null then 1 else 0 end,
             'survived', case when alive then 1 else 0 end,
             'won_civil', case when won and role = 'civil' then 1 else 0 end,
             'won_mrwhite', case when won and role = 'mrwhite' then 1 else 0 end,
             'won_infiltre', case when won and role in ('undercover', 'mrwhite') then 1 else 0 end,
             -- votes (server.vote_log) : civil -> civil, tout vote contre un infiltré, tous les votes sur des infiltrés
             'civil_vs_civil', (select count(*) from jsonb_array_elements(coalesce(p_server->'vote_log', '[]'::jsonb)) l,
                                 jsonb_each_text(l.value) v
                                where v.key = pl and role = 'civil' and v_roles->>v.value = 'civil'),
             'infiltre_votes', (select count(*) from jsonb_array_elements(coalesce(p_server->'vote_log', '[]'::jsonb)) l,
                                 jsonb_each_text(l.value) v
                                where v.key = pl and v_roles->>v.value in ('undercover', 'mrwhite')),
             -- Sherlock : au moins 2 votes et tous contre un infiltré
             'sherlock', (select case when count(*) >= 2 and bool_and(v_roles->>v.value in ('undercover', 'mrwhite'))
                                      then 1 else 0 end
                            from jsonb_array_elements(coalesce(p_server->'vote_log', '[]'::jsonb)) l,
                                 jsonb_each_text(l.value) v where v.key = pl),
             -- Insoupçonnable : victoire en undercover sans aucun vote reçu pendant toute la partie
             'insoupconnable', case when won and role = 'undercover'
                                     and not exists (select 1 from jsonb_array_elements(coalesce(p_server->'vote_log', '[]'::jsonb)) l,
                                                          jsonb_each_text(l.value) v where v.value = pl)
                                    then 1 else 0 end))
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
  -- Journal des votes (trophées) : reste dans server, croisé avec les rôles seulement en fin de partie.
  p_server := p_server || jsonb_build_object('vote_log',
    coalesce(p_server->'vote_log', '[]'::jsonb) || jsonb_build_array(v_votes));
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
-- Multi-soirées : un joueur peut être dans des parties de soirées différentes en
-- même temps ; seule contrainte = une partie non terminée par soirée.
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
  -- Fin auto paresseuse : une soirée inactive depuis 20 min est close (-> soiree_ended).
  perform public._cleanup_stale_soirees();
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
  -- Garde-fou : une action n'a jamais besoin de plus de 8 Ko (certains jeux recopient
  -- le coup dans le state public ; un client malveillant ne doit pas pouvoir le gonfler).
  if octet_length(p_action::text) > 8192 then raise exception 'invalid_action'; end if;

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
                                             'new_tenues', coalesce(v_fin->'new_tenues', '{}'::jsonb),
                                             'new_trophies', coalesce(v_fin->'new_trophies', '{}'::jsonb));
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
alter table public.soiree_bans         enable row level security;
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

-- Liste des exclus : visible par l'hôte seulement.
drop policy if exists soiree_bans_select on public.soiree_bans;
create policy soiree_bans_select on public.soiree_bans for select to authenticated
  using (exists (select 1 from public.soirees s
                  where s.id = soiree_id and s.host_id = (select public.current_profile_id())));

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
  public.friendships, public.soirees, public.soiree_players, public.soiree_bans, public.matches, public.match_players,
  public.match_secrets, public.match_server_state, public.unlocks, public.player_stats,
  public.leaderboard_general, public.leaderboard_by_game
from anon, authenticated;

grant select on table
  public.profiles, public.device_sessions, public.friendships, public.soirees, public.soiree_players,
  public.soiree_bans, public.matches, public.match_players, public.match_secrets, public.unlocks, public.player_stats,
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
revoke all on function public._close_soiree(uuid, text, boolean, timestamptz) from public, anon, authenticated;
revoke all on function public._cleanup_stale_soirees() from public, anon, authenticated;
revoke all on function public._open_soirees_count(uuid) from public, anon, authenticated;
revoke all on function public._soiree_last_activity(uuid) from public, anon, authenticated;
revoke all on function public._soiree_max_open() from public, anon, authenticated;
revoke all on function public._soiree_idle_timeout() from public, anon, authenticated;
revoke all on function public._match_stale_timeout() from public, anon, authenticated;
revoke all on function public._matches_touch() from public, anon, authenticated;
revoke all on function public.finish_match(uuid, jsonb) from public, anon, authenticated;
revoke all on function public._after_finish_match(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public._after_finish_trophies(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public._qdn_tstats(jsonb, text) from public, anon, authenticated;
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
revoke all on function public._require_admin() from public, anon, authenticated;
revoke all on function public.admin_list_soirees() from public, anon;
revoke all on function public.admin_end_soiree(uuid) from public, anon;
revoke all on function public.update_nickname(text) from public, anon;
revoke all on function public.equip_expression(text, integer) from public, anon;
revoke all on function public.send_friend_request(uuid) from public, anon;
revoke all on function public.respond_friend_request(uuid, boolean) from public, anon;
revoke all on function public.remove_friend(uuid) from public, anon;
revoke all on function public.my_active_soiree() from public, anon;
revoke all on function public.create_soiree(uuid[]) from public, anon;
revoke all on function public.join_soiree_by_code(text) from public, anon;
revoke all on function public.leave_soiree(uuid) from public, anon;
revoke all on function public.my_active_soirees() from public, anon;
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
  public.admin_list_soirees(),
  public.admin_end_soiree(uuid),
  public.update_nickname(text),
  public.equip_expression(text, integer),
  public.send_friend_request(uuid),
  public.respond_friend_request(uuid, boolean),
  public.remove_friend(uuid),
  public.my_active_soiree(),
  public.create_soiree(uuid[]),
  public.join_soiree_by_code(text),
  public.leave_soiree(uuid),
  public.my_active_soirees(),
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

-- =============================================================================
-- 16. FIN AUTOMATIQUE DES SOIRÉES (pg_cron, idempotent et tolérant)
-- =============================================================================
-- Job « soirees-idle-cleanup » chaque minute -> _cleanup_stale_soirees(), et
-- « soirees-idle-cleanup-purge » chaque nuit : efface l'historique de CE job de plus
-- de 2 jours (cron.job_run_details n'est jamais vidé et le job tourne 1 440 fois/jour).
-- Si pg_cron est indisponible (autre hébergeur, PGlite…) : simple NOTICE, le
-- script continue ; la fin auto reste assurée paresseusement par les RPC soirée
-- (my_active_soirees, create_soiree, join_soiree_by_code, start_match…), que le
-- front rappelle lui-même quand un compte à rebours d'inactivité arrive à zéro.
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron indisponible (%) : fin auto des soirées uniquement paresseuse', sqlerrm;
    return;
  end;
  begin
    -- Remplace les jobs s'ils existent déjà (noms fixes).
    perform cron.unschedule(j.jobid) from cron.job j
      where j.jobname in ('soirees-idle-cleanup', 'soirees-idle-cleanup-purge');
    perform cron.schedule('soirees-idle-cleanup', '* * * * *', 'select public._cleanup_stale_soirees()');
    perform cron.schedule('soirees-idle-cleanup-purge', '17 4 * * *',
      $job$delete from cron.job_run_details
            where end_time < now() - interval '2 days'
              and jobid in (select jobid from cron.job where jobname = 'soirees-idle-cleanup')$job$);
  exception when others then
    raise notice 'planification pg_cron impossible (%) : fin auto des soirées uniquement paresseuse', sqlerrm;
  end;
end $$;


-- ===== features\chat.sql =====
-- =============================================================================
-- CHAT DE SOIRÉE — idempotent, exécuté APRÈS schema.sql (features/*).
-- Un fil de discussion par soirée (salon + pendant les jeux) : textes courts et
-- stickers chibi. Conservé le temps de la soirée, purgé quand elle se termine.
--   kind = 'text'    : body = message (1..200 caractères)
--   kind = 'sticker' : body = id d'expression (joie, colere, extra1…) ; tenue =
--                      tenue portée par l'auteur AU MOMENT de l'envoi (le sticker
--                      garde son look même si l'auteur se change ensuite).
-- Lecture : membres de la soirée (RLS + Realtime). Écriture : RPC uniquement.
-- =============================================================================

create table if not exists public.soiree_messages (
  id         bigint generated always as identity primary key,
  soiree_id  uuid not null references public.soirees(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind       text not null check (kind in ('text', 'sticker')),
  body       text not null,
  tenue      text not null default 'default',
  created_at timestamptz not null default now()
);
create index if not exists soiree_messages_soiree_idx on public.soiree_messages(soiree_id, id);

alter table public.soiree_messages enable row level security;
drop policy if exists soiree_messages_select on public.soiree_messages;
create policy soiree_messages_select on public.soiree_messages for select to authenticated
  using (public.is_soiree_member(soiree_id));

revoke all on table public.soiree_messages from anon, authenticated;
grant select on table public.soiree_messages to authenticated;

-- Envoi d'un message. Erreurs : not_in_soiree, soiree_ended, invalid_message, chat_too_fast,
-- expression_locked (sticker de tenue sans le trophée du slot).
-- p_slot : rang du sticker dans la planche de la tenue portée (cf. equip_expression) ; envoyé par le
-- front seulement pour un sticker de tenue. Vérifié par _tenue_slot_ok (features/trophees.sql).
drop function if exists public.send_soiree_message(uuid, text, text);
-- Compteur persistant des stickers envoyés (trophée Pipelette) : les messages sont purgés en fin de soirée.
alter table public.player_stats add column if not exists stickers_sent integer not null default 0;

create or replace function public.send_soiree_message(p_soiree_id uuid, p_kind text, p_body text, p_slot integer default null)
returns bigint language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me    uuid := public._require_profile();
  v_body  text;
  v_tenue text;
  v_id    bigint;
begin
  if not exists (select 1 from public.soiree_players where soiree_id = p_soiree_id and profile_id = v_me)
     and not exists (select 1 from public.soirees where id = p_soiree_id and host_id = v_me) then
    raise exception 'not_in_soiree';
  end if;
  if not exists (select 1 from public.soirees where id = p_soiree_id and status <> 'ended') then
    raise exception 'soiree_ended';
  end if;

  if p_kind = 'text' then
    v_body := btrim(regexp_replace(coalesce(p_body, ''), '\s+', ' ', 'g'));
    if char_length(v_body) < 1 or char_length(v_body) > 200 then raise exception 'invalid_message'; end if;
  elsif p_kind = 'sticker' then
    v_body := coalesce(p_body, '');
    if v_body !~ '^[a-z0-9_]{1,24}$' then raise exception 'invalid_message'; end if;
  else
    raise exception 'invalid_message';
  end if;

  -- anti-spam : 6 messages au plus par tranche de 10 s
  if (select count(*) from public.soiree_messages
       where soiree_id = p_soiree_id and profile_id = v_me
         and created_at > now() - interval '10 seconds') >= 6 then
    raise exception 'chat_too_fast';
  end if;

  select equipped_tenue into v_tenue from public.profiles where id = v_me;
  if p_kind = 'sticker' and p_slot is not null and coalesce(v_tenue, 'default') <> 'default'
     and not public._tenue_slot_ok(v_me, v_tenue, p_slot) then
    raise exception 'expression_locked';
  end if;
  insert into public.soiree_messages(soiree_id, profile_id, kind, body, tenue)
  values (p_soiree_id, v_me, p_kind, v_body, coalesce(v_tenue, 'default'))
  returning id into v_id;

  -- Pipelette : compte le sticker puis évalue ce seul trophée (évaluation légère, sans repasser tout le catalogue).
  if p_kind = 'sticker' then
    insert into public.player_stats(profile_id) values (v_me) on conflict do nothing;
    update public.player_stats set stickers_sent = stickers_sent + 1 where profile_id = v_me;
    perform public.evaluate_trophy(v_me, 'gen_pipelette');
  end if;

  -- on ne garde que les 200 derniers messages de la soirée
  delete from public.soiree_messages m
   where m.soiree_id = p_soiree_id
     and m.id < (select x.id from public.soiree_messages x
                  where x.soiree_id = p_soiree_id order by x.id desc offset 199 limit 1);
  return v_id;
end $$;

revoke all on function public.send_soiree_message(uuid, text, text, integer) from public, anon;
grant execute on function public.send_soiree_message(uuid, text, text, integer) to authenticated;

-- Fin de soirée : la discussion est effacée.
create or replace function public._chat_purge()
returns trigger language plpgsql security definer
set search_path = public, extensions
as $$
begin
  delete from public.soiree_messages where soiree_id = new.id;
  return new;
end $$;
revoke all on function public._chat_purge() from public, anon, authenticated;

drop trigger if exists soirees_chat_purge on public.soirees;
create trigger soirees_chat_purge after update of status on public.soirees
  for each row when (new.status = 'ended' and old.status is distinct from 'ended')
  execute function public._chat_purge();

-- Rattrapage : discussions de soirées déjà terminées.
delete from public.soiree_messages m
 using public.soirees s where s.id = m.soiree_id and s.status = 'ended';

-- Realtime (idempotent)
do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'soiree_messages') then
    alter publication supabase_realtime add table public.soiree_messages;
  end if;
end $$;


-- ===== features\daily.sql =====
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


-- ===== features\duel.sql =====
-- =============================================================================
-- SOCLE « Jeux en duel » (2 joueurs à la fois, le reste de la table regarde
-- et parie). Idempotent (create or replace). Chargé APRÈS schema.sql et AVANT
-- games/*.sql (ordre de scripts/build-sql.mjs : features puis games).
--
-- Un jeu en duel (4 à la suite, morpion, bataille navale…) ne fournit QUE son
-- plateau ; le socle gère la session (modes Roi de la table / Tournoi / Duel),
-- les tours, le minuteur (deadline + tick, coup auto), les paris des
-- spectateurs, les points de session et finish_match.
--
-- Contrat complet (state public, actions, hooks) : docs/ARCHITECTURE.md,
-- section « Jeux en duel », et src/features/duel/types.ts (miroir TS).
--
-- ---------------------------------------------------------------- BRANCHEMENT
--   game_<id>_start(p_players uuid[], p_options jsonb)
--       = select public._duel_start('<id>', p_players, p_options);
--   game_<id>_action(p_state, p_server, p_actor, p_is_host, p_action)
--       = select public._duel_action('<id>', p_state, p_server, p_actor, p_is_host, p_action);
--
-- ---------------------------------------------------------------- HOOKS DU JEU
-- (id '4-a-b' -> préfixe game_4_a_b_ ; joueurs = uuid en TEXTE)
--  * game_<id>_board_new(p_ctx jsonb, p_a text, p_b text) returns jsonb   [obligatoire]
--      p_ctx = {duel_no, game_no, a, b, starter, options}  (options = p_options.board)
--      -> {board: {...public}, server?: any, secrets?: {"<uid>": any}, setup_seconds?: int}
--  * game_<id>_board_move(p_board jsonb, p_server jsonb, p_actor text, p_move jsonb) returns jsonb [obligatoire]
--      lève une erreur métier si le coup est illégal (invalid_move, column_full…)
--      -> {board, server?, secrets?, outcome: null|'win'|'draw', winner?: uid, turn?: uid}
--      (turn absent = alternance ; server absent = inchangé)
--  * game_<id>_board_auto(p_board jsonb, p_server jsonb, p_actor text) returns jsonb [obligatoire]
--      -> un coup LÉGAL tiré au hasard (même format que p_move), rejoué via board_move.
--  * game_<id>_board_setup(p_board jsonb, p_server jsonb, p_actor text, p_move jsonb) returns jsonb [optionnel]
--      Phase de préparation SIMULTANÉE (ex. placer sa flotte) si board_new renvoie setup_seconds > 0.
--      Appelé avec : un coup de préparation du jeu ({type:'setup', move} côté client) ;
--      {"type":"ready"} (valider, lever setup_incomplete si besoin) ; {"type":"auto"}
--      (compléter AU HASARD la préparation de p_actor, à l'échéance) ; {"type":"begin"}
--      avec p_actor NULL (les deux sont prêts : passer au jeu). -> {board, server?, secrets?}
--
-- server (match_server_state) : {"board": <server du jeu>} — le jeu ne voit que sa part.
-- Secrets : upsert par game_action ; inclure duel_no/game_no dans le secret pour que
-- le front ignore celui d'un duel précédent (le socle ne supprime jamais un secret).
-- =============================================================================

create or replace function public._duel_iso(p_ts timestamptz)
returns text language sql stable
set search_path = public, extensions
as $$
  select to_char(p_ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$$;

-- Échéance ISO dans p_secs secondes.
create or replace function public._duel_in(p_secs numeric)
returns text language sql stable
set search_path = public, extensions
as $$
  select public._duel_iso(now() + make_interval(secs => p_secs::double precision));
$$;

create or replace function public._duel_shuffle(p text[])
returns text[] language sql volatile
set search_path = public, extensions
as $$
  select coalesce(array(select x from unnest(p) as t(x) order by random()), '{}'::text[]);
$$;

-- Nom de la fonction game_<id>_<suffix>(<args>) si elle existe, sinon null.
create or replace function public._duel_hook(p_game text, p_suffix text, p_args text)
returns text language plpgsql stable
set search_path = public, extensions
as $$
declare v_fn text;
begin
  if p_game is null or p_game !~ '^[a-z0-9-]{1,40}$' then raise exception 'unknown_game'; end if;
  v_fn := 'game_' || replace(p_game, '-', '_') || '_' || p_suffix;
  if to_regprocedure(format('public.%I(%s)', v_fn, p_args)) is null then return null; end if;
  return v_fn;
end $$;

create or replace function public._duel_fn(p_game text, p_suffix text, p_args text)
returns text language plpgsql stable
set search_path = public, extensions
as $$
declare v_fn text := public._duel_hook(p_game, p_suffix, p_args);
begin
  if v_fn is null then raise exception 'unknown_game'; end if;
  return v_fn;
end $$;

-- ---------------------------------------------------------------- appels des hooks

create or replace function public._duel_board_new(p_game text, p_ctx jsonb, p_a text, p_b text)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare v jsonb;
begin
  execute format('select public.%I($1, $2, $3)', public._duel_fn(p_game, 'board_new', 'jsonb, text, text'))
     into v using p_ctx, p_a, p_b;
  if v is null or jsonb_typeof(v->'board') is distinct from 'object' then raise exception 'invalid_board'; end if;
  return v;
end $$;

create or replace function public._duel_board_move(p_game text, p_board jsonb, p_server jsonb, p_actor text, p_move jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare v jsonb;
begin
  execute format('select public.%I($1, $2, $3, $4)', public._duel_fn(p_game, 'board_move', 'jsonb, jsonb, text, jsonb'))
     into v using p_board, p_server, p_actor, p_move;
  if v is null or jsonb_typeof(v->'board') is distinct from 'object' then raise exception 'invalid_board'; end if;
  return v;
end $$;

create or replace function public._duel_board_auto(p_game text, p_board jsonb, p_server jsonb, p_actor text)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare v jsonb;
begin
  execute format('select public.%I($1, $2, $3)', public._duel_fn(p_game, 'board_auto', 'jsonb, jsonb, text'))
     into v using p_board, p_server, p_actor;
  if v is null or jsonb_typeof(v) <> 'object' then raise exception 'invalid_move'; end if;
  return v;
end $$;

create or replace function public._duel_board_setup(p_game text, p_board jsonb, p_server jsonb, p_actor text, p_move jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_fn text := public._duel_hook(p_game, 'board_setup', 'jsonb, jsonb, text, jsonb');
  v    jsonb;
begin
  if v_fn is null then
    -- Pas de hook : préparation sans effet (le jeu n'a rien à préparer).
    return jsonb_build_object('board', p_board, 'server', p_server);
  end if;
  execute format('select public.%I($1, $2, $3, $4)', v_fn) into v using p_board, p_server, p_actor, p_move;
  if v is null or jsonb_typeof(v->'board') is distinct from 'object' then raise exception 'invalid_board'; end if;
  return v;
end $$;

-- ---------------------------------------------------------------- utilitaires

create or replace function public._duel_other(p_duel jsonb, p text)
returns text language sql immutable
set search_path = public, extensions
as $$
  select case when p = p_duel->>'a' then p_duel->>'b' else p_duel->>'a' end;
$$;

-- session.stats[p][key] += n
create or replace function public._duel_stat(p_session jsonb, p text, p_key text, p_n integer)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select jsonb_set(p_session, array['stats', p, p_key],
                   to_jsonb(coalesce((p_session->'stats'->p->>p_key)::integer, 0) + p_n));
$$;

-- session.scores[p] += n
create or replace function public._duel_score(p_session jsonb, p text, p_n integer)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select jsonb_set(p_session, array['scores', p],
                   to_jsonb(coalesce((p_session->'scores'->>p)::integer, 0) + p_n));
$$;

-- x = {state, server, secrets} : fusionne des secrets renvoyés par un hook.
create or replace function public._duel_add_secrets(p_x jsonb, p_secrets jsonb)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select case when jsonb_typeof(p_secrets) = 'object'
              then p_x || jsonb_build_object('secrets', coalesce(p_x->'secrets', '{}'::jsonb) || p_secrets)
              else p_x end;
$$;

-- ---------------------------------------------------------------- tournoi

-- Tableau à élimination directe. Taille = puissance de 2 >= n ; les exempts
-- (taille - n, toujours < taille/2) passent directement au tour 2. L'ordre des
-- matchs du 1er tour est tiré au sort (exempts répartis au hasard).
-- match = {a, b, winner, status: 'pending'|'done'|'bye', draws, random}
create or replace function public._duel_bracket_new(p_players text[])
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_n      integer := cardinality(p_players);
  v_size   integer := 2;
  v_byes   integer;
  v_r0     jsonb := '[]'::jsonb;
  v_rounds jsonb;
  v_k      integer := 1;
  v_m      integer;
  i        integer;
  r        integer;
begin
  while v_size < v_n loop v_size := v_size * 2; end loop;
  v_byes := v_size - v_n;
  for i in 1 .. v_size / 2 loop
    if i <= v_byes then
      v_r0 := v_r0 || jsonb_build_array(jsonb_build_object('a', p_players[v_k], 'b', null, 'winner', p_players[v_k],
                                                           'status', 'bye', 'draws', 0, 'random', false));
      v_k := v_k + 1;
    else
      v_r0 := v_r0 || jsonb_build_array(jsonb_build_object('a', p_players[v_k], 'b', p_players[v_k + 1], 'winner', null,
                                                           'status', 'pending', 'draws', 0, 'random', false));
      v_k := v_k + 2;
    end if;
  end loop;
  select jsonb_agg(e order by random()) into v_r0 from jsonb_array_elements(v_r0) as t(e);
  v_rounds := jsonb_build_array(v_r0);
  v_m := v_size / 4;
  while v_m >= 1 loop
    v_rounds := v_rounds || jsonb_build_array(
      (select jsonb_agg(jsonb_build_object('a', null, 'b', null, 'winner', null, 'status', 'pending', 'draws', 0, 'random', false))
         from generate_series(1, v_m)));
    v_m := v_m / 2;
  end loop;
  -- Propagation des exempts au tour 2.
  if jsonb_array_length(v_rounds) > 1 then
    for i in 0 .. jsonb_array_length(v_r0) - 1 loop
      if v_r0->i->>'status' = 'bye' then
        v_rounds := jsonb_set(v_rounds, array['1', (i / 2)::text, case when i % 2 = 0 then 'a' else 'b' end],
                              v_r0->i->'winner');
      end if;
    end loop;
  end if;
  return jsonb_build_object('size', v_size, 'byes', v_byes, 'rounds', v_rounds);
end $$;

-- Vainqueur du match (r, i) (0-based) -> qualifié au tour suivant.
create or replace function public._duel_bracket_win(p_bracket jsonb, p_r integer, p_i integer, p_w text, p_random boolean)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare v_b jsonb := p_bracket;
begin
  v_b := jsonb_set(v_b, array['rounds', p_r::text, p_i::text],
                   (v_b->'rounds'->p_r->p_i) || jsonb_build_object('winner', p_w, 'status', 'done', 'random', p_random));
  if p_r + 1 < jsonb_array_length(v_b->'rounds') then
    v_b := jsonb_set(v_b, array['rounds', (p_r + 1)::text, (p_i / 2)::text, case when p_i % 2 = 0 then 'a' else 'b' end],
                     to_jsonb(p_w));
  end if;
  return v_b;
end $$;

-- ---------------------------------------------------------------- appariement

-- Prochain duel de la session : {a, b, round?, match?, replay} ou null.
create or replace function public._duel_pair_next(p_state jsonb)
returns jsonb language plpgsql stable
set search_path = public, extensions
as $$
declare
  v_s   jsonb := p_state->'session';
  v_rds jsonb;
  v_m   jsonb;
  r     integer;
  i     integer;
begin
  if v_s->>'mode' = 'king' then
    if jsonb_array_length(v_s->'queue') < 2 then return null; end if;
    return jsonb_build_object('a', v_s->'queue'->>0, 'b', v_s->'queue'->>1, 'round', null, 'match', null, 'replay', false);
  elsif v_s->>'mode' = 'tournament' then
    v_rds := v_s->'bracket'->'rounds';
    for r in 0 .. jsonb_array_length(v_rds) - 1 loop
      for i in 0 .. jsonb_array_length(v_rds->r) - 1 loop
        v_m := v_rds->r->i;
        if v_m->>'status' = 'pending' and v_m->>'a' is not null and v_m->>'b' is not null then
          return jsonb_build_object('a', v_m->>'a', 'b', v_m->>'b', 'round', r, 'match', i,
                                    'replay', coalesce((v_m->>'draws')::integer, 0) > 0);
        end if;
      end loop;
    end loop;
    return null;
  else
    if coalesce((v_s->>'duel_count')::integer, 0) > 0 then return null; end if;
    return jsonb_build_object('a', v_s->'pair'->>0, 'b', v_s->'pair'->>1, 'round', null, 'match', null, 'replay', false);
  end if;
end $$;

-- Annonce le prochain duel : phase 'transition' (paris ouverts) pendant p_secs.
-- Premier joueur du duel : celui des deux qui a commencé le moins de manches
-- dans la session (égalité : au hasard) ; il alterne ensuite à chaque manche.
create or replace function public._duel_announce(p_state jsonb, p_secs numeric)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_s     jsonb := p_state->'session';
  v_next  jsonb := public._duel_pair_next(p_state);
  v_a     text;
  v_b     text;
  v_sa    integer;
  v_sb    integer;
  v_first text;
begin
  if v_next is null then raise exception 'no_next_duel'; end if;
  v_a := v_next->>'a';
  v_b := v_next->>'b';
  v_sa := coalesce((v_s->'stats'->v_a->>'starts')::integer, 0);
  v_sb := coalesce((v_s->'stats'->v_b->>'starts')::integer, 0);
  v_first := case when v_sa < v_sb then v_a when v_sb < v_sa then v_b
                  when random() < 0.5 then v_a else v_b end;
  return p_state || jsonb_build_object(
    'phase', 'transition',
    'board', null,
    'deadline', public._duel_in(p_secs),
    'duel', jsonb_build_object(
      'no', coalesce((v_s->>'duel_count')::integer, 0) + 1,
      'a', v_a, 'b', v_b,
      'first', v_first, 'starter', v_first, 'turn', null,
      'game_no', 0,
      'wins', jsonb_build_object(v_a, 0, v_b, 0),
      'games', '[]'::jsonb,
      'bets', '{}'::jsonb,
      'bets_until', null,
      'moves', 0, 'last_move', null,
      'outcome', null, 'winner', null,
      'ready', '[]'::jsonb,
      'result', null,
      'round', v_next->'round', 'match', v_next->'match',
      'replay', coalesce(v_next->'replay', 'false'::jsonb)));
end $$;

-- ---------------------------------------------------------------- manches

-- Nouvelle manche du duel courant : board_new, puis 'setup' ou 'playing'.
-- p_x = {state, server, secrets?} -> idem.
create or replace function public._duel_begin_game(p_game text, p_x jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_state   jsonb := p_x->'state';
  v_s       jsonb := v_state->'session';
  v_d       jsonb := v_state->'duel';
  v_g       integer := coalesce((v_d->>'game_no')::integer, 0) + 1;
  v_starter text;
  v_r       jsonb;
  v_setup   integer;
  v_secs    integer := coalesce((v_s->>'turn_seconds')::integer, 30);
begin
  v_starter := case when v_g % 2 = 1 then v_d->>'first' else public._duel_other(v_d, v_d->>'first') end;
  v_r := public._duel_board_new(p_game,
           jsonb_build_object('duel_no', v_d->'no', 'game_no', v_g, 'a', v_d->'a', 'b', v_d->'b',
                              'starter', v_starter, 'options', coalesce(v_s->'board_options', '{}'::jsonb)),
           v_d->>'a', v_d->>'b');
  v_setup := case when jsonb_typeof(v_r->'setup_seconds') = 'number' then (v_r->>'setup_seconds')::integer else 0 end;
  v_s := public._duel_stat(v_s, v_starter, 'starts', 1);
  v_d := v_d || jsonb_build_object(
    'game_no', v_g, 'starter', v_starter, 'moves', 0, 'last_move', null,
    'outcome', null, 'winner', null, 'ready', '[]'::jsonb,
    'bets_until', case when v_g = 1 then to_jsonb(public._duel_in(15)) else v_d->'bets_until' end);
  if v_setup > 0 then
    v_d := v_d || jsonb_build_object('turn', null);
    v_state := v_state || jsonb_build_object('phase', 'setup', 'deadline', public._duel_in(v_setup));
  else
    v_d := v_d || jsonb_build_object('turn', v_starter);
    v_state := v_state || jsonb_build_object('phase', 'playing', 'deadline', public._duel_in(v_secs));
  end if;
  v_state := v_state || jsonb_build_object('session', v_s, 'duel', v_d, 'board', v_r->'board');
  return public._duel_add_secrets(
    jsonb_build_object('state', v_state, 'server', jsonb_build_object('board', coalesce(v_r->'server', 'null'::jsonb)),
                       'secrets', coalesce(p_x->'secrets', '{}'::jsonb)),
    v_r->'secrets');
end $$;

-- Fin du duel : points, paris, série, file / tableau, historique, fin de session ?
create or replace function public._duel_end_duel(p_state jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_s      jsonb := p_state->'session';
  v_d      jsonb := p_state->'duel';
  v_a      text := v_d->>'a';
  v_b      text := v_d->>'b';
  v_wa     integer := coalesce((v_d->'wins'->>(v_d->>'a'))::integer, 0);
  v_wb     integer := coalesce((v_d->'wins'->>(v_d->>'b'))::integer, 0);
  v_w      text := null;
  v_l      text := null;
  v_adv    text := null;   -- qualifié au tirage (tournoi, 2e nul)
  v_right  jsonb := '[]'::jsonb;
  v_mode   text := v_s->>'mode';
  v_q      text[];
  v_m      jsonb;
  v_r      integer;
  v_i      integer;
  v_draws  integer;
  v_over   boolean := false;
  v_reason text := null;
  v_champ  text := null;
  v_minp   integer;
  v_nrds   integer;
  k        text;
  t        text;
begin
  if v_wa > v_wb then v_w := v_a; v_l := v_b;
  elsif v_wb > v_wa then v_w := v_b; v_l := v_a;
  end if;

  -- Points : victoire +3, nul +1 chacun. Stats.
  v_s := public._duel_stat(public._duel_stat(v_s, v_a, 'played', 1), v_b, 'played', 1);
  if v_w is not null then
    v_s := public._duel_score(v_s, v_w, 3);
    v_s := public._duel_stat(v_s, v_w, 'wins', 1);
    v_s := public._duel_stat(v_s, v_l, 'losses', 1);
  else
    v_s := public._duel_score(public._duel_score(v_s, v_a, 1), v_b, 1);
    v_s := public._duel_stat(public._duel_stat(v_s, v_a, 'draws', 1), v_b, 'draws', 1);
  end if;

  -- Paris : +1 si le pronostic est le vainqueur (un nul ne rapporte rien).
  for k, t in select key, value #>> '{}' from jsonb_each(coalesce(v_d->'bets', '{}'::jsonb)) loop
    v_s := public._duel_stat(v_s, k, 'bets', 1);
    if v_w is not null and t = v_w then
      v_s := public._duel_score(v_s, k, 1);
      v_s := public._duel_stat(v_s, k, 'bets_won', 1);
      v_right := v_right || to_jsonb(k);
    end if;
  end loop;

  -- Série de victoires consécutives.
  if v_w is null then
    v_s := v_s || jsonb_build_object('streak', jsonb_build_object('player', null, 'count', 0));
  elsif v_s->'streak'->>'player' = v_w then
    v_s := jsonb_set(v_s, '{streak,count}', to_jsonb(coalesce((v_s->'streak'->>'count')::integer, 0) + 1));
  else
    v_s := v_s || jsonb_build_object('streak', jsonb_build_object('player', v_w, 'count', 1));
  end if;

  -- Progression selon le mode.
  if v_mode = 'king' then
    v_q := array(select jsonb_array_elements_text(v_s->'queue'));
    -- duel = queue[1] (roi) vs queue[2] (challenger)
    if v_w is not null then
      v_q := array[v_w] || coalesce(v_q[3:], '{}'::text[]) || array[v_l];
    else
      v_q := coalesce(v_q[3:], '{}'::text[]) || array[v_a, v_b];
    end if;
    v_s := v_s || jsonb_build_object('queue', to_jsonb(v_q));
  elsif v_mode = 'tournament' then
    v_r := (v_d->>'round')::integer;
    v_i := (v_d->>'match')::integer;
    v_m := v_s->'bracket'->'rounds'->v_r->v_i;
    if v_w is not null then
      v_s := jsonb_set(v_s, '{bracket}', public._duel_bracket_win(v_s->'bracket', v_r, v_i, v_w, false));
    else
      v_draws := coalesce((v_m->>'draws')::integer, 0) + 1;
      v_s := jsonb_set(v_s, array['bracket', 'rounds', v_r::text, v_i::text, 'draws'], to_jsonb(v_draws));
      if v_draws >= 2 then
        -- Deuxième nul : qualification au tirage au sort.
        v_adv := case when random() < 0.5 then v_a else v_b end;
        v_s := jsonb_set(v_s, '{bracket}', public._duel_bracket_win(v_s->'bracket', v_r, v_i, v_adv, true));
      end if;
    end if;
  end if;

  v_s := v_s || jsonb_build_object(
    'duel_count', coalesce((v_s->>'duel_count')::integer, 0) + 1,
    'history', coalesce(v_s->'history', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'no', v_d->'no', 'a', v_a, 'b', v_b, 'winner', v_w, 'draw', v_w is null, 'advanced', v_adv,
      'wins', v_d->'wins', 'games', v_d->'games', 'bets', coalesce(v_d->'bets', '{}'::jsonb), 'bets_right', v_right,
      'round', v_d->'round', 'match', v_d->'match', 'replay', v_d->'replay')));

  -- Fin de session ?
  if v_mode = 'king' then
    select min(coalesce((value->>'played')::integer, 0)) into v_minp from jsonb_each(v_s->'stats');
    if v_minp >= 1 and coalesce((v_s->'streak'->>'count')::integer, 0) >= coalesce((v_s->>'streak_target')::integer, 3) then
      v_over := true; v_reason := 'streak';
    elsif v_minp >= coalesce((v_s->>'min_played')::integer, 2) then
      v_over := true; v_reason := 'rotation';
    elsif (v_s->>'duel_count')::integer >= 4 * jsonb_array_length(p_state->'players') + 10 then
      v_over := true; v_reason := 'limit';
    end if;
  elsif v_mode = 'tournament' then
    v_nrds := jsonb_array_length(v_s->'bracket'->'rounds');
    v_champ := v_s->'bracket'->'rounds'->(v_nrds - 1)->0->>'winner';
    if v_champ is not null then v_over := true; v_reason := 'bracket'; end if;
  else
    v_over := true; v_reason := 'duel'; v_champ := v_w;
  end if;
  v_s := v_s || jsonb_build_object('over', v_over, 'end_reason', v_reason, 'champion', v_champ);

  v_d := v_d || jsonb_build_object('result', jsonb_build_object(
    'winner', v_w, 'draw', v_w is null, 'advanced', v_adv, 'bets_right', v_right));
  return p_state || jsonb_build_object('session', v_s, 'duel', v_d);
end $$;

-- Fin d'une manche (coup gagnant ou grille pleine) -> phase 'result'.
create or replace function public._duel_end_game(p_state jsonb, p_outcome text, p_winner text, p_extra jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_s    jsonb := p_state->'session';
  v_d    jsonb := p_state->'duel';
  v_bo   integer := coalesce((v_s->>'best_of')::integer, 1);
  v_need integer := (coalesce((v_s->>'best_of')::integer, 1) + 1) / 2;
  v_done boolean;
begin
  if p_outcome = 'win' and (p_winner is null or p_winner not in (v_d->>'a', v_d->>'b')) then
    raise exception 'invalid_board';
  end if;
  if p_outcome = 'win' then
    v_d := jsonb_set(v_d, array['wins', p_winner], to_jsonb(coalesce((v_d->'wins'->>p_winner)::integer, 0) + 1));
  end if;
  v_d := v_d || jsonb_build_object(
    'outcome', p_outcome,
    'winner', case when p_outcome = 'win' then p_winner end,
    'turn', null,
    'games', coalesce(v_d->'games', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'no', v_d->'game_no', 'starter', v_d->'starter',
      'winner', case when p_outcome = 'win' then p_winner end, 'moves', v_d->'moves')
      -- p_extra->'game' : compteurs de fin de manche propres au jeu (trophées), lus par les hooks trophy_stats
      || case when p_extra ? 'game' then jsonb_build_object('x', p_extra->'game') else '{}'::jsonb end))
    || coalesce(p_extra - 'game', '{}'::jsonb);
  v_done := (p_outcome = 'win' and (v_d->'wins'->>p_winner)::integer >= v_need)
            or (v_d->>'game_no')::integer >= v_bo;
  p_state := p_state || jsonb_build_object('duel', v_d);
  if v_done then p_state := public._duel_end_duel(p_state); end if;
  return p_state || jsonb_build_object('phase', 'result', 'deadline', public._duel_in(case when v_done then 5 else 4 end));
end $$;

-- Applique un coup de la phase 'playing'.
create or replace function public._duel_apply_move(p_game text, p_x jsonb, p_actor text, p_move jsonb, p_auto boolean)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_state  jsonb := p_x->'state';
  v_server jsonb := coalesce(p_x->'server', '{}'::jsonb);
  v_d      jsonb := v_state->'duel';
  v_r      jsonb;
  v_out    text;
  v_turn   text;
begin
  v_r := public._duel_board_move(p_game, v_state->'board', coalesce(v_server->'board', 'null'::jsonb), p_actor, p_move);
  v_out := v_r->>'outcome';
  if v_out is not null and v_out not in ('win', 'draw') then raise exception 'invalid_board'; end if;
  if v_r ? 'server' then v_server := v_server || jsonb_build_object('board', v_r->'server'); end if;
  v_d := v_d || jsonb_build_object(
    'moves', coalesce((v_d->>'moves')::integer, 0) + 1,
    'last_move', jsonb_build_object('by', p_actor, 'move', p_move, 'auto', p_auto));
  v_state := v_state || jsonb_build_object('board', v_r->'board', 'duel', v_d);
  if v_out is not null then
    -- board_move peut renvoyer 'game' : compteurs de fin de manche pour les trophées (rangés dans games[].x)
    v_state := public._duel_end_game(v_state, v_out, v_r->>'winner',
                 case when v_r ? 'game' then jsonb_build_object('game', v_r->'game') end);
  else
    v_turn := coalesce(v_r->>'turn', public._duel_other(v_d, p_actor));
    if v_turn not in (v_d->>'a', v_d->>'b') then raise exception 'invalid_board'; end if;
    v_state := v_state || jsonb_build_object(
      'duel', v_d || jsonb_build_object('turn', v_turn),
      'deadline', public._duel_in(coalesce((v_state->'session'->>'turn_seconds')::integer, 30)));
  end if;
  return public._duel_add_secrets(p_x || jsonb_build_object('state', v_state, 'server', v_server), v_r->'secrets');
end $$;

-- Préparation simultanée : les deux sont prêts -> board_setup 'begin' -> 'playing'.
create or replace function public._duel_setup_begin(p_game text, p_x jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_state  jsonb := p_x->'state';
  v_server jsonb := coalesce(p_x->'server', '{}'::jsonb);
  v_d      jsonb := v_state->'duel';
  v_r      jsonb;
begin
  v_r := public._duel_board_setup(p_game, v_state->'board', coalesce(v_server->'board', 'null'::jsonb), null,
                                  '{"type":"begin"}'::jsonb);
  if v_r ? 'server' then v_server := v_server || jsonb_build_object('board', v_r->'server'); end if;
  v_state := v_state || jsonb_build_object(
    'phase', 'playing',
    'board', v_r->'board',
    'duel', v_d || jsonb_build_object('turn', v_d->>'starter'),
    'deadline', public._duel_in(coalesce((v_state->'session'->>'turn_seconds')::integer, 30)));
  return public._duel_add_secrets(p_x || jsonb_build_object('state', v_state, 'server', v_server), v_r->'secrets');
end $$;

-- Un coup de préparation (ou 'ready' / 'auto') pour p_actor.
create or replace function public._duel_setup_call(p_game text, p_x jsonb, p_actor text, p_move jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_state  jsonb := p_x->'state';
  v_server jsonb := coalesce(p_x->'server', '{}'::jsonb);
  v_r      jsonb;
begin
  v_r := public._duel_board_setup(p_game, v_state->'board', coalesce(v_server->'board', 'null'::jsonb), p_actor, p_move);
  if v_r ? 'server' then v_server := v_server || jsonb_build_object('board', v_r->'server'); end if;
  v_state := v_state || jsonb_build_object('board', v_r->'board');
  return public._duel_add_secrets(p_x || jsonb_build_object('state', v_state, 'server', v_server), v_r->'secrets');
end $$;

-- ---------------------------------------------------------------- fin de session

-- Manches jouées par p_pl dans la session (history[].games[] des duels où il figure) :
-- (won, lost, moves = coups des deux joueurs, i_started). Utilisé par les hooks de trophées des jeux.
create or replace function public._duel_games(p_state jsonb, p_pl text)
returns table (won boolean, lost boolean, moves integer, i_started boolean)
language sql immutable
set search_path = public, extensions
as $$
  select coalesce(g->>'winner' = p_pl, false),
         g->>'winner' is not null and g->>'winner' <> p_pl,
         coalesce((g->>'moves')::integer, 0),
         coalesce(g->>'starter' = p_pl, false)
    from jsonb_array_elements(coalesce(p_state->'session'->'history', '[]'::jsonb)) d,
         jsonb_array_elements(coalesce(d->'games', '[]'::jsonb)) g
   where d->>'a' = p_pl or d->>'b' = p_pl
$$;

-- Variante de _duel_games avec g = games[].x (compteurs de fin de manche renvoyés par board_move
-- dans 'game' ; null pour les manches sans ces compteurs, ex. anciennes parties).
create or replace function public._duel_games_x(p_state jsonb, p_pl text)
returns table (won boolean, lost boolean, moves integer, i_started boolean, g jsonb)
language sql immutable
set search_path = public, extensions
as $$
  select coalesce(g->>'winner' = p_pl, false),
         g->>'winner' is not null and g->>'winner' <> p_pl,
         coalesce((g->>'moves')::integer, 0),
         coalesce(g->>'starter' = p_pl, false),
         g->'x'
    from jsonb_array_elements(coalesce(p_state->'session'->'history', '[]'::jsonb)) d,
         jsonb_array_elements(coalesce(d->'games', '[]'::jsonb)) g
   where d->>'a' = p_pl or d->>'b' = p_pl
$$;

-- Stats de session d'un joueur pour les trophées (features/trophees.sql) : compteurs de session.stats,
-- meilleures séries de duels gagnés / perdus, + hook optionnel du jeu game_<id>_trophy_stats(state, joueur).
create or replace function public._duel_tstats(p_state jsonb, p_pl text)
returns jsonb language plpgsql stable
set search_path = public, extensions
as $$
declare
  v_st    jsonb := coalesce(p_state->'session'->'stats'->p_pl, '{}'::jsonb);
  v_fn    text;
  v_extra jsonb := '{}'::jsonb;
  v_w     integer := 0;
  v_l     integer := 0;
  v_bw    integer := 0;
  v_bl    integer := 0;
  e       jsonb;
begin
  for e in select value from jsonb_array_elements(coalesce(p_state->'session'->'history', '[]'::jsonb)) loop
    if e->>'a' = p_pl or e->>'b' = p_pl then
      if e->>'winner' = p_pl then v_w := v_w + 1; v_l := 0;
      elsif e->>'winner' is not null then v_l := v_l + 1; v_w := 0;
      else v_w := 0; v_l := 0;
      end if;
      v_bw := greatest(v_bw, v_w);
      v_bl := greatest(v_bl, v_l);
    end if;
  end loop;
  v_fn := public._duel_hook(p_state->>'game', 'trophy_stats', 'jsonb, text');
  if v_fn is not null then
    execute format('select public.%I($1, $2)', v_fn) into v_extra using p_state, p_pl;
  end if;
  return jsonb_build_object(
    'played', coalesce((v_st->>'played')::integer, 0), 'draws', coalesce((v_st->>'draws')::integer, 0),
    'losses', coalesce((v_st->>'losses')::integer, 0), 'bets', coalesce((v_st->>'bets')::integer, 0),
    'bets_won', coalesce((v_st->>'bets_won')::integer, 0), 'win_streak', v_bw, 'loss_streak', v_bl)
    || coalesce(v_extra, '{}'::jsonb);
end $$;

-- Classement par points de session. won : champion du tournoi / vainqueur du
-- duel / meilleur(s) score(s) (roi, ou session arrêtée sans champion ; max > 0).
-- Le champion (s'il existe) est classé 1er quels que soient les points.
create or replace function public._duel_finish(p_state jsonb, p_reason text)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_s       jsonb := p_state->'session';
  v_champ   text := v_s->>'champion';
  v_reason  text := coalesce(p_reason, v_s->>'end_reason');
  v_max     integer;
  v_winners jsonb;
  v_results jsonb;
begin
  if v_reason = 'stopped' and v_s->>'mode' = 'duel' then v_champ := null; end if;
  select max(value::integer) into v_max from jsonb_each_text(v_s->'scores');
  if v_champ is not null then
    v_winners := jsonb_build_array(v_champ);
  elsif v_s->>'mode' = 'duel' and v_reason = 'duel' then
    v_winners := '[]'::jsonb;  -- duel nul : personne ne gagne
  elsif coalesce(v_max, 0) > 0 then
    select jsonb_agg(key order by key) into v_winners from jsonb_each_text(v_s->'scores') where value::integer = v_max;
  else
    v_winners := '[]'::jsonb;
  end if;

  -- stats.duel_wins = duels remportés dans la session (tenues : chaque duel gagné compte).
  select jsonb_agg(jsonb_build_object('profile_id', p, 'points', pts, 'won', w, 'placement', pl,
                                      'stats', jsonb_build_object('duel_wins',
                                        coalesce((v_s->'stats'->p->>'wins')::integer, 0))
                                        || public._duel_tstats(p_state, p))
                   order by pl, p)
    into v_results
    from (select p, pts, w, (rank() over (order by w desc, pts desc))::integer as pl
            from (select x.p, coalesce((v_s->'scores'->>x.p)::integer, 0) as pts, v_winners ? x.p as w
                    from jsonb_array_elements_text(p_state->'players') as x(p)) t) u;

  return p_state || jsonb_build_object(
    'phase', 'finished',
    'deadline', null,
    'winners', v_winners,
    'results', v_results,
    'session', v_s || jsonb_build_object('over', true, 'end_reason', v_reason, 'champion', v_champ));
end $$;

-- Après la phase 'result' : manche suivante, duel suivant ou fin de session.
create or replace function public._duel_advance(p_game text, p_x jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_state jsonb := p_x->'state';
begin
  if v_state->'duel'->'result' is null or jsonb_typeof(v_state->'duel'->'result') = 'null' then
    return public._duel_begin_game(p_game, p_x);             -- manche suivante (meilleur de 3)
  end if;
  if coalesce((v_state->'session'->>'over')::boolean, false) then
    return p_x || jsonb_build_object('state', public._duel_finish(v_state, null));
  end if;
  return p_x || jsonb_build_object('state', public._duel_announce(v_state, 5));
end $$;

-- ---------------------------------------------------------------- démarrage

-- Options : {mode: 'king'|'tournament'|'duel' (défaut king), best_of: 1|3 (mode
-- duel uniquement), duel_players: [uuid, uuid] (mode duel ; absent = au hasard),
-- turn_seconds: 10..120 (défaut 30), board: {...options propres au jeu}}
create or replace function public._duel_start(p_game text, p_players uuid[], p_options jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_n      integer := cardinality(p_players);
  v_opts   jsonb := coalesce(p_options, '{}'::jsonb);
  v_mode   text := coalesce(nullif(v_opts->>'mode', ''), 'king');
  v_ids    text[] := array(select x::text from unnest(p_players) as t(x));
  v_shuf   text[];
  v_bo     integer;
  v_secs   integer;
  v_scores jsonb := '{}'::jsonb;
  v_stats  jsonb := '{}'::jsonb;
  v_pair   text[];
  v_s      jsonb;
  v_state  jsonb;
  p        text;
begin
  perform public._duel_fn(p_game, 'board_new', 'jsonb, text, text');
  perform public._duel_fn(p_game, 'board_move', 'jsonb, jsonb, text, jsonb');
  perform public._duel_fn(p_game, 'board_auto', 'jsonb, jsonb, text');
  if v_n < 2 then raise exception 'not_enough_players'; end if;
  if v_n > 16 then raise exception 'too_many_players'; end if;
  if v_mode not in ('king', 'tournament', 'duel') then raise exception 'invalid_mode'; end if;
  v_bo := case when v_mode = 'duel' and v_opts->>'best_of' = '3' then 3 else 1 end;
  v_secs := case when coalesce(v_opts->>'turn_seconds', '') ~ '^\d{1,3}$'
                 then least(120, greatest(10, (v_opts->>'turn_seconds')::integer)) else 30 end;
  v_shuf := public._duel_shuffle(v_ids);

  foreach p in array v_ids loop
    v_scores := v_scores || jsonb_build_object(p, 0);
    v_stats := v_stats || jsonb_build_object(p, jsonb_build_object(
      'played', 0, 'wins', 0, 'draws', 0, 'losses', 0, 'bets', 0, 'bets_won', 0, 'starts', 0));
  end loop;

  if v_mode = 'duel' then
    if jsonb_typeof(v_opts->'duel_players') = 'array' and jsonb_array_length(v_opts->'duel_players') > 0 then
      v_pair := array(select jsonb_array_elements_text(v_opts->'duel_players'));
      if cardinality(v_pair) <> 2 or v_pair[1] = v_pair[2]
         or not (v_pair[1] = any(v_ids)) or not (v_pair[2] = any(v_ids)) then
        raise exception 'invalid_duel_players';
      end if;
    else
      v_pair := v_shuf[1:2];
    end if;
  end if;

  v_s := jsonb_build_object(
    'mode', v_mode,
    'best_of', v_bo,
    'turn_seconds', v_secs,
    'board_options', case when jsonb_typeof(v_opts->'board') = 'object' then v_opts->'board' else '{}'::jsonb end,
    'scores', v_scores,
    'stats', v_stats,
    'streak', jsonb_build_object('player', null, 'count', 0),
    'streak_target', 3,
    'min_played', 2,
    'duel_count', 0,
    'history', '[]'::jsonb,
    'queue', case when v_mode = 'king' then to_jsonb(v_shuf) end,
    'bracket', case when v_mode = 'tournament' then public._duel_bracket_new(v_shuf) end,
    'pair', case when v_mode = 'duel' then to_jsonb(v_pair) end,
    'over', false,
    'end_reason', null,
    'champion', null);

  v_state := jsonb_build_object(
    'game', p_game,
    'phase', 'transition',
    'players', to_jsonb(p_players),
    'session', v_s,
    'duel', null,
    'board', null,
    'deadline', null,
    'winners', null,
    'results', null);
  -- 8 s au premier duel : le temps que tout le monde arrive (et parie).
  v_state := public._duel_announce(v_state, 8);
  return jsonb_build_object('state', v_state, 'server', jsonb_build_object('board', null));
end $$;

-- ---------------------------------------------------------------- actions
--   {"type":"move","move":{...}}   duelliste dont c'est le tour (playing) ;
--                                  en 'setup' : coup de préparation (l'un ou l'autre)
--   {"type":"ready"}               duelliste, phase 'setup'
--   {"type":"bet","winner":uuid}   spectateur, paris ouverts (modifiable)
--   {"type":"tick"}                n'importe qui, à l'échéance (sinon sans effet)
--   {"type":"next"}                hôte : passe la transition / le résultat
--   {"type":"stop"}                hôte : termine la session maintenant (duel en cours ignoré)
create or replace function public._duel_action(
  p_game text, p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_type   text := p_action->>'type';
  v_me     text := p_actor::text;
  v_phase  text := p_state->>'phase';
  v_d      jsonb := p_state->'duel';
  v_x      jsonb := jsonb_build_object('state', p_state, 'server', coalesce(p_server, '{}'::jsonb), 'secrets', '{}'::jsonb);
  v_target text;
  v_open   boolean;
  v_ready  jsonb;
  v_move   jsonb;
  p        text;
begin
  if v_phase not in ('transition', 'setup', 'playing', 'result') then raise exception 'wrong_phase'; end if;

  if v_type = 'tick' then
    if p_state->>'deadline' is null or now() < (p_state->>'deadline')::timestamptz then
      return jsonb_build_object('state', p_state, 'server', p_server);  -- trop tôt / déjà traité
    end if;
    if v_phase = 'transition' then
      v_x := public._duel_begin_game(p_game, v_x);
    elsif v_phase = 'setup' then
      -- Échéance de la préparation : on complète au hasard pour les retardataires.
      foreach p in array array[v_d->>'a', v_d->>'b'] loop
        if not ((v_d->'ready') ? p) then
          v_x := public._duel_setup_call(p_game, v_x, p, '{"type":"auto"}'::jsonb);
        end if;
      end loop;
      v_x := jsonb_set(v_x, '{state,duel,ready}', jsonb_build_array(v_d->>'a', v_d->>'b'));
      v_x := public._duel_setup_begin(p_game, v_x);
    elsif v_phase = 'playing' then
      v_move := public._duel_board_auto(p_game, p_state->'board', coalesce(p_server->'board', 'null'::jsonb), v_d->>'turn');
      v_x := public._duel_apply_move(p_game, v_x, v_d->>'turn', v_move, true);
    else
      v_x := public._duel_advance(p_game, v_x);
    end if;

  elsif v_type = 'next' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase = 'transition' then
      v_x := public._duel_begin_game(p_game, v_x);
    elsif v_phase = 'result' then
      v_x := public._duel_advance(p_game, v_x);
    else
      raise exception 'wrong_phase';
    end if;

  elsif v_type = 'stop' then
    if not p_is_host then raise exception 'not_host'; end if;
    v_x := v_x || jsonb_build_object('state', public._duel_finish(p_state, 'stopped'));

  elsif v_type = 'bet' then
    if not ((p_state->'players') ? v_me) then raise exception 'not_a_player'; end if;
    if v_me in (v_d->>'a', v_d->>'b') then raise exception 'duelist_cannot_bet'; end if;
    v_target := p_action->>'winner';
    if v_target is null or v_target not in (v_d->>'a', v_d->>'b') then raise exception 'invalid_bet'; end if;
    v_open := v_phase = 'transition'
              or (v_phase in ('setup', 'playing') and (v_d->>'game_no')::integer = 1
                  and (coalesce((v_d->>'moves')::integer, 0) = 0
                       or now() < (v_d->>'bets_until')::timestamptz));
    if not v_open then raise exception 'bets_closed'; end if;
    v_x := jsonb_set(v_x, array['state', 'duel', 'bets', v_me], to_jsonb(v_target));

  elsif v_type = 'move' then
    if v_me not in (v_d->>'a', v_d->>'b') then raise exception 'not_duelist'; end if;
    v_move := p_action->'move';
    if v_move is null or jsonb_typeof(v_move) <> 'object' then raise exception 'invalid_move'; end if;
    if v_phase = 'playing' then
      if v_d->>'turn' is distinct from v_me then raise exception 'not_your_turn'; end if;
      v_x := public._duel_apply_move(p_game, v_x, v_me, v_move, false);
    elsif v_phase = 'setup' then
      if (v_d->'ready') ? v_me then raise exception 'already_ready'; end if;
      if v_move->>'type' in ('ready', 'auto', 'begin') then raise exception 'invalid_move'; end if;
      v_x := public._duel_setup_call(p_game, v_x, v_me, v_move);
    else
      raise exception 'wrong_phase';
    end if;

  elsif v_type = 'ready' then
    if v_me not in (v_d->>'a', v_d->>'b') then raise exception 'not_duelist'; end if;
    if v_phase <> 'setup' then raise exception 'wrong_phase'; end if;
    if (v_d->'ready') ? v_me then raise exception 'already_ready'; end if;
    v_x := public._duel_setup_call(p_game, v_x, v_me, '{"type":"ready"}'::jsonb);
    v_ready := (v_d->'ready') || to_jsonb(v_me);
    v_x := jsonb_set(v_x, '{state,duel,ready}', v_ready);
    if jsonb_array_length(v_ready) >= 2 then
      v_x := public._duel_setup_begin(p_game, v_x);
    end if;

  else
    raise exception 'unknown_action';
  end if;

  if v_x->'state'->>'phase' = 'finished' then
    return jsonb_build_object('state', v_x->'state', 'server', v_x->'server', 'results', v_x->'state'->'results');
  end if;
  if v_x->'secrets' <> '{}'::jsonb then
    return jsonb_build_object('state', v_x->'state', 'server', v_x->'server', 'secrets', v_x->'secrets');
  end if;
  return jsonb_build_object('state', v_x->'state', 'server', v_x->'server');
end $$;

-- ---------------------------------------------------------------- droits

revoke all on function public._duel_iso(timestamptz) from public, anon, authenticated;
revoke all on function public._duel_in(numeric) from public, anon, authenticated;
revoke all on function public._duel_shuffle(text[]) from public, anon, authenticated;
revoke all on function public._duel_hook(text, text, text) from public, anon, authenticated;
revoke all on function public._duel_fn(text, text, text) from public, anon, authenticated;
revoke all on function public._duel_board_new(text, jsonb, text, text) from public, anon, authenticated;
revoke all on function public._duel_board_move(text, jsonb, jsonb, text, jsonb) from public, anon, authenticated;
revoke all on function public._duel_board_auto(text, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public._duel_board_setup(text, jsonb, jsonb, text, jsonb) from public, anon, authenticated;
revoke all on function public._duel_other(jsonb, text) from public, anon, authenticated;
revoke all on function public._duel_stat(jsonb, text, text, integer) from public, anon, authenticated;
revoke all on function public._duel_score(jsonb, text, integer) from public, anon, authenticated;
revoke all on function public._duel_add_secrets(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._duel_bracket_new(text[]) from public, anon, authenticated;
revoke all on function public._duel_bracket_win(jsonb, integer, integer, text, boolean) from public, anon, authenticated;
revoke all on function public._duel_pair_next(jsonb) from public, anon, authenticated;
revoke all on function public._duel_announce(jsonb, numeric) from public, anon, authenticated;
revoke all on function public._duel_begin_game(text, jsonb) from public, anon, authenticated;
revoke all on function public._duel_end_duel(jsonb) from public, anon, authenticated;
revoke all on function public._duel_end_game(jsonb, text, text, jsonb) from public, anon, authenticated;
revoke all on function public._duel_apply_move(text, jsonb, text, jsonb, boolean) from public, anon, authenticated;
revoke all on function public._duel_setup_begin(text, jsonb) from public, anon, authenticated;
revoke all on function public._duel_setup_call(text, jsonb, text, jsonb) from public, anon, authenticated;
revoke all on function public._duel_finish(jsonb, text) from public, anon, authenticated;
revoke all on function public._duel_games(jsonb, text) from public, anon, authenticated;
revoke all on function public._duel_games_x(jsonb, text) from public, anon, authenticated;
revoke all on function public._duel_tstats(jsonb, text) from public, anon, authenticated;
revoke all on function public._duel_advance(text, jsonb) from public, anon, authenticated;
revoke all on function public._duel_start(text, uuid[], jsonb) from public, anon, authenticated;
revoke all on function public._duel_action(text, jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;


-- ===== features\recap.sql =====
-- =============================================================================
-- RÉCAP DE SOIRÉE (lot C, « façon Wrapped ») — idempotent, exécuté en features/*
-- (après chat.sql : soiree_messages ; _soiree_standings de stats.sql est résolu à l'exécution).
--
-- Le chat est PURGÉ quand la soirée passe à 'ended' (trigger soirees_chat_purge).
-- Les stats de chat / stickers sont donc figées dans `soiree_recaps` par un trigger
-- AFTER UPDATE OF status nommé `soirees_a_recap` : les triggers AFTER d'une même table
-- s'exécutent par ordre alphabétique, « soirees_a_recap » passe avant « soirees_chat_purge ».
--
-- jsonb du récap (version 1) :
--   { version, soiree_id, has_chat (bool : stats de chat disponibles),
--     started_at, ended_at, duration_min, games_played, distinct_games, players_count,
--     players:[{profile_id,slug,nickname,equipped_tenue}],
--     games:[{game_id,played}]  (le plus joué d'abord, ex-aequo par id),
--     top_game:{game_id,played}|null,
--     awards:[{id, profile_id, value, extra}] }
--   RPC soiree_recap ajoute à la volée : standings:[...], winner_ids:[...] (cf. stats.sql).
-- Awards (au plus un lauréat par award, ex-aequo départagés par sort_order du profil) :
--   serie    : plus longue série de victoires consécutives (ses propres parties), >= 2
--   deuxieme : parties terminées 2e (non gagnant, >= 3 joueurs), >= 2
--   bluff    : victoires « en tant qu'infiltré » à Undercover (stats.undercover_won_as_undercover)
--              + victoires côté loup à Loup-garou (state.roles[pid] = 'loup' et won), >= 1
--              extra {as_undercover, as_wolf}
--   pasdebol : parties finies à la dernière place (>= 3 joueurs, >= 3 placements différents,
--              pas gagnant), >= 2
--   bavard   : messages texte envoyés, >= 5            (chat requis)
--   sticker  : sticker le plus envoyé de la soirée (>= 2 envois) ; profile_id = qui l'a le plus
--              envoyé, value = ses envois, extra {expression, total, tenue}   (chat requis)
-- La « Star de la soirée » est le 1er du classement (standings), pas stockée ici.
-- =============================================================================

create table if not exists public.soiree_recaps (
  soiree_id  uuid primary key references public.soirees(id) on delete cascade,
  data       jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.soiree_recaps enable row level security;
revoke all on table public.soiree_recaps from anon, authenticated;

create or replace function public._soiree_recap_compute(p_soiree_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  s        public.soirees%rowtype;
  v_chat   boolean;
  v_games  jsonb;
  v_pl     jsonb;
  v_awards jsonb;
  v_end    timestamptz;
begin
  select * into s from public.soirees where id = p_soiree_id;
  if not found then return null; end if;
  v_end := coalesce(s.ended_at, now());
  v_chat := exists (select 1 from public.soiree_messages where soiree_id = p_soiree_id);

  select coalesce(jsonb_agg(jsonb_build_object('game_id', g.game_id, 'played', g.n) order by g.n desc, g.game_id), '[]'::jsonb)
    into v_games
    from (select m.game_id, count(*)::int as n
            from public.matches m
           where m.soiree_id = p_soiree_id and m.status = 'finished'
             and exists (select 1 from public.match_players x where x.match_id = m.id)
           group by m.game_id) g;

  select coalesce(jsonb_agg(jsonb_build_object('profile_id', p.id, 'slug', p.slug, 'nickname', p.nickname,
                                               'equipped_tenue', p.equipped_tenue) order by p.sort_order), '[]'::jsonb)
    into v_pl
    from public.profiles p
   where p.id in (select profile_id from public.soiree_players where soiree_id = p_soiree_id
                  union select x.profile_id from public.match_players x join public.matches m on m.id = x.match_id
                         where m.soiree_id = p_soiree_id
                  union select profile_id from public.soiree_messages where soiree_id = p_soiree_id);

  with mp as (
    select x.profile_id, x.match_id, m.game_id, m.finished_at, x.won, x.placement, x.stats, m.state,
           count(*) over (partition by x.match_id) as n,
           max(x.placement) over (partition by x.match_id) as maxp,
           count(distinct x.placement) over (partition by x.match_id) as np
      from public.match_players x join public.matches m on m.id = x.match_id
     where m.soiree_id = p_soiree_id and m.status = 'finished'
  ), t as (
    select profile_id, won,
           row_number() over (partition by profile_id order by finished_at, match_id) as rn,
           row_number() over (partition by profile_id, won order by finished_at, match_id) as rw
      from mp
  ), streaks as (
    select profile_id, count(*)::int as len from t where won group by profile_id, rn - rw
  ), cand as (
    select 'serie'::text as id, profile_id, max(len) as value, '{}'::jsonb as extra
      from streaks group by profile_id having max(len) >= 2
    union all
    select 'deuxieme', profile_id, count(*)::int, '{}'::jsonb
      from mp where placement = 2 and not won and n >= 3 group by profile_id having count(*) >= 2
    union all
    select 'pasdebol', profile_id, count(*)::int, '{}'::jsonb
      from mp where placement = maxp and placement > 1 and not won and n >= 3 and np >= 3
     group by profile_id having count(*) >= 2
    union all
    select 'bluff', b.profile_id, b.u + b.w, jsonb_build_object('as_undercover', b.u, 'as_wolf', b.w)
      from (select profile_id,
                   coalesce(sum(case when game_id = 'undercover' then coalesce((stats->>'undercover_won_as_undercover')::int, 0) else 0 end), 0)::int as u,
                   count(*) filter (where game_id = 'loup-garou' and won and state->'roles'->>(profile_id::text) = 'loup')::int as w
              from mp group by profile_id) b
     where b.u + b.w >= 1
    union all
    select 'bavard', profile_id, count(*)::int, '{}'::jsonb
      from public.soiree_messages where soiree_id = p_soiree_id and kind = 'text'
     group by profile_id having count(*) >= 5
    union all
    select 'sticker', z.profile_id, z.c, jsonb_build_object('expression', top.body, 'total', top.total,
             'tenue', (select q.tenue from public.soiree_messages q
                        where q.soiree_id = p_soiree_id and q.kind = 'sticker' and q.body = top.body and q.profile_id = z.profile_id
                        order by q.id desc limit 1))
      from (select body, count(*)::int as total from public.soiree_messages
             where soiree_id = p_soiree_id and kind = 'sticker'
             group by body having count(*) >= 2 order by count(*) desc, body limit 1) top
      cross join lateral (select q.profile_id, count(*)::int as c from public.soiree_messages q
                           where q.soiree_id = p_soiree_id and q.kind = 'sticker' and q.body = top.body
                           group by q.profile_id order by count(*) desc, q.profile_id limit 1) z
  ), best as (
    select distinct on (c.id) c.id, c.profile_id, c.value, c.extra
      from cand c join public.profiles p on p.id = c.profile_id
     order by c.id, c.value desc, p.sort_order
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'profile_id', profile_id, 'value', value, 'extra', extra)
                            order by array_position(array['serie','bluff','deuxieme','pasdebol','bavard','sticker'], id)), '[]'::jsonb)
    into v_awards from best;

  return jsonb_build_object(
    'version', 1, 'soiree_id', p_soiree_id, 'has_chat', v_chat,
    'started_at', coalesce(s.started_at, s.created_at), 'ended_at', s.ended_at,
    'duration_min', greatest(0, round(extract(epoch from (v_end - coalesce(s.started_at, s.created_at))) / 60))::int,
    'games_played', (select coalesce(sum((e->>'played')::int), 0) from jsonb_array_elements(v_games) e),
    'distinct_games', jsonb_array_length(v_games),
    'players_count', jsonb_array_length(v_pl),
    'players', v_pl,
    'games', v_games,
    'top_game', v_games->0,
    'awards', v_awards);
end $$;

-- Trigger : fige le récap à la fin de la soirée (avant la purge du chat).
-- Ne doit JAMAIS empêcher la fin de la soirée : toute erreur est avalée.
create or replace function public._soiree_recap_store()
returns trigger language plpgsql security definer
set search_path = public, extensions
as $$
begin
  begin
    insert into public.soiree_recaps(soiree_id, data)
    values (new.id, public._soiree_recap_compute(new.id))
    on conflict (soiree_id) do nothing;
  exception when others then
    null;
  end;
  return new;
end $$;

drop trigger if exists soirees_a_recap on public.soirees;
create trigger soirees_a_recap after update of status on public.soirees
  for each row when (new.status = 'ended' and old.status is distinct from 'ended')
  execute function public._soiree_recap_store();

-- Récap d'une soirée TERMINÉE (mêmes règles d'accès que soiree_history_detail).
-- Sans récap stocké (soirée terminée avant ce lot) : calcul à la volée, sans stats de chat (has_chat=false).
-- → jsonb décrit ci-dessus + standings + winner_ids.
-- Erreurs : soiree_not_found, not_in_soiree, soiree_not_ended.
create or replace function public.soiree_recap(p_soiree_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := public._require_profile();
  s    public.soirees%rowtype;
  v_d  jsonb;
  v_st jsonb;
begin
  select * into s from public.soirees where id = p_soiree_id;
  if not found then raise exception 'soiree_not_found'; end if;
  if not (s.host_id = v_me
          or exists (select 1 from public.soiree_players sp where sp.soiree_id = s.id and sp.profile_id = v_me)
          or exists (select 1 from public.match_players x join public.matches m on m.id = x.match_id
                      where m.soiree_id = s.id and x.profile_id = v_me)) then
    raise exception 'not_in_soiree';
  end if;
  if s.status <> 'ended' then raise exception 'soiree_not_ended'; end if;

  select data into v_d from public.soiree_recaps where soiree_id = s.id;
  if v_d is null then v_d := public._soiree_recap_compute(s.id); end if;
  v_st := public._soiree_standings(s.id);
  return v_d || jsonb_build_object(
    'standings', v_st,
    'winner_ids', coalesce((select jsonb_agg(e->'profile_id') from jsonb_array_elements(v_st) e
                             where (e->>'rank')::int = 1 and (e->>'points')::int > 0), '[]'::jsonb));
end $$;

revoke all on function public._soiree_recap_compute(uuid) from public, anon, authenticated;
revoke all on function public._soiree_recap_store() from public, anon, authenticated;
revoke all on function public.soiree_recap(uuid) from public, anon;
grant execute on function public.soiree_recap(uuid) to authenticated;


-- ===== features\soiree-hote.sql =====
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


-- ===== features\stats.sql =====
-- =============================================================================
-- STATS (lot B) — idempotent, exécuté APRÈS schema.sql (features/*).
-- Classement de soirée, historique des soirées, profil / statistiques.
-- Tout est DÉRIVÉ de soirees / soiree_players / matches / match_players :
-- aucune table nouvelle, juste des RPC security definer renvoyant du jsonb.
--
-- BARÈME DE SOIRÉE (par partie terminée, par joueur) — _soiree_points :
--   gagnant (won)                              = 3 pts (équipes : toute l'équipe gagnante)
--   perdant d'un duel (partie à 2 joueurs)     = 1 pt  (participation)
--   2e place (placement 2)                     = 2 pts
--   3e place (placement 3)                     = 1 pt
--   non gagnant avec placement 1 (égalité)     = 1 pt
--   autres                                     = 0 pt
-- Classement : points décroissants, puis victoires, puis moins de parties jouées ;
-- ex-aequo = même rang (rang « compétition » : 1, 1, 3).
-- Seules les parties terminées comptent (match_players n'existe qu'à la fin).
-- =============================================================================

create index if not exists matches_soiree_finished_idx on public.matches(soiree_id) where status = 'finished';

create or replace function public._soiree_points(p_won boolean, p_placement integer, p_n integer)
returns integer language sql immutable
as $$
  select case
    when p_won then 3
    when p_n = 2 then 1
    when p_placement = 2 then 2
    when p_placement = 3 then 1
    when p_placement = 1 then 1
    else 0
  end
$$;

-- Classement brut : jsonb [{profile_id, slug, nickname, equipped_tenue, points, wins, games, rank}].
-- Inclut les membres actuels (même à 0 partie) et ceux qui ont joué puis sont partis.
create or replace function public._soiree_standings(p_soiree_id uuid)
returns jsonb language sql stable security definer
set search_path = public, extensions
as $$
  with mp as (
    select x.profile_id, x.won,
           public._soiree_points(x.won, x.placement, count(*) over (partition by x.match_id)::int) as pts
      from public.match_players x
      join public.matches mt on mt.id = x.match_id
     where mt.soiree_id = p_soiree_id and mt.status = 'finished'
  ), members as (
    select sp.profile_id from public.soiree_players sp where sp.soiree_id = p_soiree_id
    union
    select profile_id from mp
  ), agg as (
    select mb.profile_id,
           coalesce(sum(mp.pts), 0)::int as points,
           count(*) filter (where mp.won)::int as wins,
           count(mp.profile_id)::int as games
      from members mb left join mp on mp.profile_id = mb.profile_id
     group by mb.profile_id
  ), ranked as (
    select a.*, rank() over (order by a.points desc, a.wins desc, a.games asc) as rk
      from agg a
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'profile_id', r.profile_id, 'slug', p.slug, 'nickname', p.nickname,
           'equipped_tenue', p.equipped_tenue,
           'points', r.points, 'wins', r.wins, 'games', r.games, 'rank', r.rk)
         order by r.rk, p.sort_order), '[]'::jsonb)
    from ranked r join public.profiles p on p.id = r.profile_id
$$;

-- Classement de la soirée (membres, ou anciens joueurs d'une de ses parties).
-- → {soiree_id, status, games_played, standings:[...], winner_ids:[uuid]}
--   (winner_ids vide tant que personne n'a de point). Erreurs : soiree_not_found, not_in_soiree.
create or replace function public.soiree_standings(p_soiree_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_me     uuid := public._require_profile();
  v_st     jsonb;
  v_status text;
begin
  select status into v_status from public.soirees where id = p_soiree_id;
  if v_status is null then raise exception 'soiree_not_found'; end if;
  if not (public.is_soiree_member(p_soiree_id)
          or exists (select 1 from public.match_players x join public.matches m on m.id = x.match_id
                      where m.soiree_id = p_soiree_id and x.profile_id = v_me)) then
    raise exception 'not_in_soiree';
  end if;
  v_st := public._soiree_standings(p_soiree_id);
  return jsonb_build_object(
    'soiree_id', p_soiree_id, 'status', v_status,
    'games_played', (select count(*) from public.matches where soiree_id = p_soiree_id and status = 'finished'),
    'standings', v_st,
    'winner_ids', coalesce((select jsonb_agg(e->'profile_id') from jsonb_array_elements(v_st) e
                             where (e->>'rank')::int = 1 and (e->>'points')::int > 0), '[]'::jsonb));
end $$;

-- Mes soirées terminées, la plus récente d'abord (50 au plus).
-- → [{id, host:{id,slug,nickname,equipped_tenue}, started_at, ended_at, duration_min, games_played,
--     players:[{profile_id,slug,nickname,equipped_tenue}], winner:{profile_id,slug,nickname,equipped_tenue,points}|null}]
create or replace function public.my_soirees_history()
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_me  uuid := public._require_profile();
  v_out jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id,
      'host', (select jsonb_build_object('id', h.id, 'slug', h.slug, 'nickname', h.nickname, 'equipped_tenue', h.equipped_tenue)
                 from public.profiles h where h.id = s.host_id),
      'started_at', coalesce(s.started_at, s.created_at),
      'ended_at', s.ended_at,
      'duration_min', greatest(0, round(extract(epoch from (s.ended_at - coalesce(s.started_at, s.created_at))) / 60))::int,
      'games_played', (select count(*) from public.matches m where m.soiree_id = s.id and m.status = 'finished'),
      'players', (select coalesce(jsonb_agg(e - 'points' - 'wins' - 'games' - 'rank'), '[]'::jsonb)
                    from jsonb_array_elements(st.j) e),
      'winner', (select e - 'wins' - 'games' - 'rank' from jsonb_array_elements(st.j) e
                  where (e->>'rank')::int = 1 and (e->>'points')::int > 0 limit 1)
    ) order by s.sort_end desc), '[]'::jsonb)
    into v_out
    from (
      select so.*, coalesce(so.ended_at, so.created_at) as sort_end
        from public.soirees so
       where so.status = 'ended'
         and (so.host_id = v_me
              or exists (select 1 from public.soiree_players sp where sp.soiree_id = so.id and sp.profile_id = v_me)
              or exists (select 1 from public.match_players x join public.matches m on m.id = x.match_id
                          where m.soiree_id = so.id and x.profile_id = v_me))
       order by coalesce(so.ended_at, so.created_at) desc
       limit 50
    ) s
    cross join lateral (select public._soiree_standings(s.id) as j) st;
  return v_out;
end $$;

-- Détail d'une soirée où j'étais.
-- → {soiree_id, status, host, started_at, ended_at, duration_min,
--    matches:[{id, game_id, finished_at, players:int, winners:[{profile_id,slug,nickname,equipped_tenue}]}] (ordre chronologique),
--    standings:[...], winner_ids:[...]}. Erreurs : soiree_not_found, not_in_soiree.
create or replace function public.soiree_history_detail(p_soiree_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := public._require_profile();
  s    public.soirees%rowtype;
  v_st jsonb;
begin
  select * into s from public.soirees where id = p_soiree_id;
  if not found then raise exception 'soiree_not_found'; end if;
  if not (s.host_id = v_me
          or exists (select 1 from public.soiree_players sp where sp.soiree_id = s.id and sp.profile_id = v_me)
          or exists (select 1 from public.match_players x join public.matches m on m.id = x.match_id
                      where m.soiree_id = s.id and x.profile_id = v_me)) then
    raise exception 'not_in_soiree';
  end if;
  v_st := public._soiree_standings(s.id);
  return jsonb_build_object(
    'soiree_id', s.id, 'status', s.status,
    'host', (select jsonb_build_object('id', h.id, 'slug', h.slug, 'nickname', h.nickname, 'equipped_tenue', h.equipped_tenue)
               from public.profiles h where h.id = s.host_id),
    'started_at', coalesce(s.started_at, s.created_at), 'ended_at', s.ended_at,
    'duration_min', greatest(0, round(extract(epoch from (coalesce(s.ended_at, now()) - coalesce(s.started_at, s.created_at))) / 60))::int,
    'matches', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', m.id, 'game_id', m.game_id, 'finished_at', m.finished_at,
               'players', (select count(*) from public.match_players x where x.match_id = m.id),
               'winners', (select coalesce(jsonb_agg(jsonb_build_object(
                                    'profile_id', p.id, 'slug', p.slug, 'nickname', p.nickname, 'equipped_tenue', p.equipped_tenue)
                                  order by p.sort_order), '[]'::jsonb)
                             from public.match_players x join public.profiles p on p.id = x.profile_id
                            where x.match_id = m.id and x.won)
             ) order by m.finished_at), '[]'::jsonb)
        from public.matches m where m.soiree_id = s.id and m.status = 'finished'),
    'standings', v_st,
    'winner_ids', coalesce((select jsonb_agg(e->'profile_id') from jsonb_array_elements(v_st) e
                             where (e->>'rank')::int = 1 and (e->>'points')::int > 0), '[]'::jsonb));
end $$;

-- Profil / statistiques d'un joueur (lisible par tout joueur connecté, comme les classements).
-- → {profile:{id,slug,nickname,equipped_tenue,xp,level}, games_played, wins, win_rate (0..100), soirees,
--    favorite_game:{game_id,played}|null, best_game:{game_id,played,wins,win_rate}|null,
--    rival:{profile_id,slug,nickname,equipped_tenue,losses}|null, per_game:[{game_id,played,wins}]}
-- Jeu préféré = le plus joué. Meilleur jeu = meilleur taux de victoire parmi les jeux joués >= 3 fois,
-- sinon celui qui a le plus de victoires (>= 1 victoire exigée). Rival = adversaire qui a gagné le plus
-- de parties où je n'ai pas gagné (minimum 2). Erreur : profile_not_found.
create or replace function public.profile_stats(p_profile_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_me     uuid := public._require_profile();
  p        public.profiles%rowtype;
  v_pg     jsonb;
  v_played int;
  v_wins   int;
begin
  select * into p from public.profiles where id = p_profile_id;
  if not found then raise exception 'profile_not_found'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('game_id', g.game_id, 'played', g.played, 'wins', g.wins)
                            order by g.played desc, g.wins desc, g.game_id), '[]'::jsonb),
         coalesce(sum(g.played), 0)::int, coalesce(sum(g.wins), 0)::int
    into v_pg, v_played, v_wins
    from (select x.game_id, count(*)::int as played, count(*) filter (where x.won)::int as wins
            from public.match_players x join public.matches m on m.id = x.match_id and m.status = 'finished'
           where x.profile_id = p_profile_id
           group by x.game_id) g;

  return jsonb_build_object(
    'profile', jsonb_build_object('id', p.id, 'slug', p.slug, 'nickname', p.nickname,
                                   'equipped_tenue', p.equipped_tenue, 'xp', p.xp, 'level', public.level_for_xp(p.xp)),
    'games_played', v_played,
    'wins', v_wins,
    'win_rate', case when v_played > 0 then round(v_wins * 100.0 / v_played)::int else 0 end,
    'soirees', (select count(*) from (
                  select soiree_id from public.soiree_players where profile_id = p_profile_id
                  union
                  select m.soiree_id from public.match_players x join public.matches m on m.id = x.match_id
                   where x.profile_id = p_profile_id) u),
    'favorite_game', (select jsonb_build_object('game_id', e->>'game_id', 'played', (e->>'played')::int)
                        from jsonb_array_elements(v_pg) e limit 1),
    'best_game', (
      select jsonb_build_object('game_id', e->>'game_id', 'played', (e->>'played')::int, 'wins', (e->>'wins')::int,
                                'win_rate', round((e->>'wins')::numeric * 100 / (e->>'played')::numeric)::int)
        from jsonb_array_elements(v_pg) e
       where (e->>'wins')::int > 0
       order by ((e->>'played')::int >= 3) desc,
                case when (e->>'played')::int >= 3 then (e->>'wins')::numeric / (e->>'played')::numeric else 0 end desc,
                (e->>'wins')::int desc, (e->>'played')::int desc
       limit 1),
    'rival', (
      select jsonb_build_object('profile_id', r.pid, 'slug', pr.slug, 'nickname', pr.nickname,
                                'equipped_tenue', pr.equipped_tenue, 'losses', r.n)
        from (select w.profile_id as pid, count(*)::int as n
                from public.match_players me
                join public.matches m on m.id = me.match_id and m.status = 'finished'
                join public.match_players w on w.match_id = me.match_id and w.won and w.profile_id <> me.profile_id
               where me.profile_id = p_profile_id and not me.won
               group by w.profile_id
              having count(*) >= 2
               order by count(*) desc, w.profile_id limit 1) r
        join public.profiles pr on pr.id = r.pid),
    'per_game', v_pg);
end $$;

revoke all on function public._soiree_points(boolean, integer, integer) from public, anon, authenticated;
revoke all on function public._soiree_standings(uuid) from public, anon, authenticated;
revoke all on function public.soiree_standings(uuid) from public, anon;
revoke all on function public.my_soirees_history() from public, anon;
revoke all on function public.soiree_history_detail(uuid) from public, anon;
revoke all on function public.profile_stats(uuid) from public, anon;
grant execute on function public.soiree_standings(uuid) to authenticated;
grant execute on function public.my_soirees_history() to authenticated;
grant execute on function public.soiree_history_detail(uuid) to authenticated;
grant execute on function public.profile_stats(uuid) to authenticated;


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
  condition_type text not null default 'game_wins',     -- 'default' | 'game_wins' | 'duel_wins'
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
  ('artiste',  'Artiste',         '🎨', 'dessine-devine', 'game_wins', 10, 60),
  ('loup',       'Loup',          '🐺', 'loup-garou',     'game_wins', 10, 70),
  ('artificier', 'Artificier',    '💣', 'bombe-a-mots',   'game_wins', 10, 80),
  ('pirate',     'Pirate',        '🏴‍☠️', 'menteur',        'game_wins', 10, 90),
  ('bowler',     'Bowler',        '🎳', 'bowling',        'game_wins', 10, 100),
  ('philosophe', 'Philosophe',    '🤔', 'tu-preferes',    'game_wins', 10, 110),
  ('vedette',    'Star de cinéma','🎬', 'qui-suis-je',    'game_wins', 10, 120),
  ('archer',     'Archer',        '🏹', 'le-plus-proche', 'game_wins', 10, 130),
  ('comedien',   'Comédien',      '🎭', 'action-ou-verite','game_wins', 10, 140),
  ('coach',      'Coach',         '📣', 'devine-en-equipe','game_wins', 10, 150),
  ('stratege',   'Stratège',      '🧠', 'quatre-a-la-suite','duel_wins', 10, 160),
  ('ninja',      'Ninja',         '🥷', 'morpion',        'duel_wins', 10, 170),
  ('amiral',     'Amiral',        '⚓', 'bataille-navale','duel_wins', 10, 180),
  ('magnat',     'Magnat',        '🎩', 'tour-des-potes', 'game_wins', 10, 190),
  ('pilote',     'Pilote',        '🏎️', 'dede-kart',      'game_wins', 10, 200)
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
-- condition_type : 'game_wins' = au moins `threshold` victoires (match_players.won) dans `game_id` ;
-- 'duel_wins' = au moins `threshold` duels remportés (somme de match_players.stats.duel_wins)
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
      -- Jeux en duel : chaque DUEL remporté compte (stats.duel_wins de chaque session).
      when 'duel_wins' then
        (select coalesce(sum(case when mp.stats->>'duel_wins' ~ '^\d{1,6}$'
                                  then (mp.stats->>'duel_wins')::integer else 0 end), 0)
           from public.match_players mp
          where mp.profile_id = p_profile_id
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
  -- Trophées : le sticker porté ne vaut que pour la planche d'une tenue précise (cf. trophees.sql,
  -- _tenue_slot_ok) ; en changeant de tenue il repasse sur `joie` (le front peut le rééquiper).
  update public.profiles set equipped_tenue = p_tenue,
         equipped_expression = case
           when p_tenue is distinct from equipped_tenue and (p_tenue <> 'default' or equipped_expression ~ '^extra[0-9]+$')
           then 'joie' else equipped_expression end
   where id = v_me;
  return public._profile_json(v_me);
end $$;

-- ---- Grants --------------------------------------------------------------------

revoke all on function public._profile_json(uuid) from public, anon, authenticated;
revoke all on function public.evaluate_tenues(uuid) from public, anon, authenticated;
revoke all on function public._after_finish_match(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.equip_tenue(text) from public, anon;
grant execute on function public.equip_tenue(text) to authenticated;

-- Rattrapage (idempotent) : victoires déjà acquises avant l'installation des tenues,
-- et expressions de la palette des tenues (pouces, timide, déterminé) pour tous les persos.
select public.evaluate_tenues(id) from public.profiles;
select public.evaluate_unlocks(id) from public.profiles;


-- ===== features\trophees.sql =====
-- =============================================================================
-- Trophées — idempotent, exécuté APRÈS tenues.sql (tables tenues / tenue_unlocks).
-- Conception : docs/TROPHEES.md. Résumé :
--   * Une tenue débloquée n'offre que le sticker n°1 (joie) de sa planche ; les stickers 2..12
--     se gagnent chacun avec le trophée (tenue, slot) correspondant (stickers > 12 : offerts).
--   * Catalogue `trophies` (230 lignes : 220 de tenue + 10 généraux), règle d'évaluation
--     GÉNÉRIQUE en jsonb (cf. _tr_progress), évaluée en fin de partie sur match_players.
--   * La progression compte dès la première partie, même sans la tenue (le sticker devient
--     utilisable quand la tenue est débloquée). Pas de rattrapage rétroactif à l'installation.
--   * `active = false` : trophée au catalogue mais pas encore branché (compteur manquant, phase 2).
--
-- Règle (colonne `rule`) : {"agg": "sum|max|count|streak|all|special", ...}
--   sum    : somme de `stat` sur les parties du jeu            >= threshold
--   max    : maximum de `stat` sur une partie                  >= threshold
--   count  : nombre de parties satisfaisant `and`              >= threshold
--   streak : plus longue série de parties consécutives (par date) satisfaisant `and` >= threshold
--   all    : toutes les sous-règles de `rules` sont satisfaites
--   special: règle nommée (`name`), trophées généraux (cf. _tr_progress ; ex. 'stickers' = player_stats.stickers_sent)
--   `and`  : [{"stat","op" (>= <= = > <),"value"}] filtre par partie (stat absente = 0)
--   `stat` : clé de match_players.stats, ou colonne virtuelle points / placement / won (0|1) ;
--            `last` (1 = dernier) et `nplayers` sont posées par finish_match dans stats.
-- =============================================================================

-- ---- Tables -----------------------------------------------------------------

-- Migration douce (une seule fois, tant que la table n'existe pas) : les stickers de tenue
-- passent à « un trophée par sticker » ; un joueur qui portait une tenue avec un sticker
-- autre que `joie` repasse sur `joie` (il le rééquipera quand il aura le trophée).
do $$
begin
  if to_regclass('public.trophies') is null then
    update public.profiles set equipped_expression = 'joie'
     where equipped_tenue <> 'default' and equipped_expression <> 'joie';
  end if;
end $$;

create table if not exists public.trophies (
  id          text primary key,
  tenue_id    text references public.tenues(id) on delete cascade,   -- null = trophée général
  slot        integer check (slot between 2 and 12),                  -- rang du sticker (null = général)
  name        text not null,
  description text not null,
  game_id     text,                                                   -- null = tous jeux
  rule        jsonb,
  active      boolean not null default false,
  sort_order  integer not null default 0,
  check ((tenue_id is null) = (slot is null))
);
create unique index if not exists trophies_tenue_slot_idx on public.trophies(tenue_id, slot) where tenue_id is not null;
create index if not exists trophies_game_idx on public.trophies(game_id) where active;

create table if not exists public.trophy_unlocks (
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  trophy_id   text not null references public.trophies(id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  primary key (profile_id, trophy_id)
);
create index if not exists trophy_unlocks_profile_idx on public.trophy_unlocks(profile_id);

alter table public.trophies enable row level security;
alter table public.trophy_unlocks enable row level security;
drop policy if exists trophies_select on public.trophies;
create policy trophies_select on public.trophies for select to authenticated using (true);
drop policy if exists trophy_unlocks_select on public.trophy_unlocks;
create policy trophy_unlocks_select on public.trophy_unlocks for select to authenticated using (true);
revoke all on table public.trophies, public.trophy_unlocks from anon, authenticated;
grant select on table public.trophies, public.trophy_unlocks to authenticated;

-- ---- Évaluation générique ---------------------------------------------------

-- Valeur d'une stat pour une partie : colonnes virtuelles ou clé numérique de stats (absente = 0).
create or replace function public._tr_val(p_mp public.match_players, p_stat text)
returns numeric language sql immutable
set search_path = public, extensions
as $$
  select case p_stat
    when 'points'    then p_mp.points::numeric
    when 'placement' then p_mp.placement::numeric
    when 'won'       then case when p_mp.won then 1 else 0 end
    else case when jsonb_typeof(p_mp.stats->p_stat) = 'number' then (p_mp.stats->>p_stat)::numeric else 0 end
  end
$$;

-- Toutes les conditions `and` sont-elles vraies pour cette partie ?
create or replace function public._tr_ok(p_mp public.match_players, p_and jsonb)
returns boolean language sql immutable
set search_path = public, extensions
as $$
  select coalesce(bool_and(
    case c->>'op'
      when '>=' then public._tr_val(p_mp, c->>'stat') >= (c->>'value')::numeric
      when '<=' then public._tr_val(p_mp, c->>'stat') <= (c->>'value')::numeric
      when '='  then public._tr_val(p_mp, c->>'stat') =  (c->>'value')::numeric
      when '>'  then public._tr_val(p_mp, c->>'stat') >  (c->>'value')::numeric
      when '<'  then public._tr_val(p_mp, c->>'stat') <  (c->>'value')::numeric
      else false
    end), true)
    from jsonb_array_elements(coalesce(p_and, '[]'::jsonb)) c
$$;

-- Objectif chiffré d'une règle (all = nombre de sous-règles).
create or replace function public._tr_target(p_rule jsonb)
returns numeric language sql immutable
set search_path = public, extensions
as $$
  select case when p_rule->>'agg' = 'all' then jsonb_array_length(p_rule->'rules')::numeric
              else coalesce((p_rule->>'threshold')::numeric, 1) end
$$;

-- Progression actuelle d'un joueur pour une règle (comparée à _tr_target).
create or replace function public._tr_progress(p_profile uuid, p_game text, p_rule jsonb)
returns numeric language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_agg  text := p_rule->>'agg';
  v_stat text := p_rule->>'stat';
  v_and  jsonb := p_rule->'and';
  v      numeric := 0;
begin
  if p_rule is null then return 0; end if;
  if v_agg = 'sum' then
    select coalesce(sum(public._tr_val(mp, v_stat)), 0) into v
      from public.match_players mp
     where mp.profile_id = p_profile and mp.game_id = p_game and public._tr_ok(mp, v_and);
  elsif v_agg = 'max' then
    select coalesce(max(public._tr_val(mp, v_stat)), 0) into v
      from public.match_players mp
     where mp.profile_id = p_profile and mp.game_id = p_game and public._tr_ok(mp, v_and);
  elsif v_agg = 'count' then
    select count(*) into v
      from public.match_players mp
     where mp.profile_id = p_profile and mp.game_id = p_game and public._tr_ok(mp, v_and);
  elsif v_agg = 'streak' then
    -- séries de parties consécutives (ordre de fin de partie) satisfaisant `and`
    select coalesce(max(c), 0) into v from (
      select count(*) as c from (
        select t.ok,
               row_number() over (order by t.at, t.mid)
               - row_number() over (partition by t.ok order by t.at, t.mid) as grp
          from (select public._tr_ok(mp, v_and) as ok, coalesce(m.finished_at, m.created_at) as at, mp.match_id as mid
                  from public.match_players mp join public.matches m on m.id = mp.match_id
                 where mp.profile_id = p_profile and mp.game_id = p_game) t
      ) u where u.ok group by u.grp
    ) z;
  elsif v_agg = 'all' then
    select count(*) into v from jsonb_array_elements(p_rule->'rules') r
     where public._tr_progress(p_profile, p_game, r) >= public._tr_target(r);
  elsif v_agg = 'special' then
    case p_rule->>'name'
      when 'distinct_games' then
        select count(distinct game_id) into v from public.match_players where profile_id = p_profile;
      when 'distinct_win_games' then
        select count(distinct game_id) into v from public.match_players where profile_id = p_profile and won;
      when 'soirees' then
        select coalesce(max(soirees_count), 0) into v from public.player_stats where profile_id = p_profile;
      when 'late_soirees' then
        select coalesce(max(late_soirees_count), 0) into v from public.player_stats where profile_id = p_profile;
      when 'games_in_soiree' then
        select coalesce(max(c), 0) into v from (
          select count(*) as c from public.match_players mp join public.matches m on m.id = mp.match_id
           where mp.profile_id = p_profile and m.soiree_id is not null group by m.soiree_id) x;
      when 'hosted' then
        select count(*) into v from public.soirees s
         where s.host_id = p_profile and s.status = 'ended'
           and coalesce(s.end_reason, 'host') not in ('abandoned', 'admin')
           and exists (select 1 from public.matches m where m.soiree_id = s.id and m.status = 'finished');
      when 'biggest_table' then
        select coalesce(max(c), 0) into v from (
          select count(*) as c from public.soiree_players sp
           where sp.soiree_id in (select soiree_id from public.soiree_players where profile_id = p_profile)
           group by sp.soiree_id) x;
      when 'stickers' then
        -- compteur persistant (le chat est purgé en fin de soirée), incrémenté par send_soiree_message
        select coalesce(max(stickers_sent), 0) into v from public.player_stats where profile_id = p_profile;
      when 'tenues' then
        select count(*) into v from public.tenue_unlocks where profile_id = p_profile;
      when 'full_board' then
        select coalesce(max(c), 0) into v from (
          select count(*) as c from public.trophy_unlocks u join public.trophies t on t.id = u.trophy_id
           where u.profile_id = p_profile and t.tenue_id is not null group by t.tenue_id) x;
      else v := 0;
    end case;
  end if;
  return v;
end $$;

-- Débloque les trophées actifs dont la règle est remplie. p_game : ne regarde que les trophées de ce
-- jeu (+ les généraux) ; null = tous. Renvoie les ids NOUVELLEMENT débloqués.
create or replace function public.evaluate_trophies(p_profile_id uuid, p_game text default null)
returns text[] language plpgsql security definer
set search_path = public, extensions
as $$
declare
  t      record;
  v_new  text[] := '{}';
  v_rows integer;
begin
  for t in
    select x.* from public.trophies x
     where x.active and x.rule is not null
       and (x.game_id is null or p_game is null or x.game_id = p_game)
       and not exists (select 1 from public.trophy_unlocks u where u.profile_id = p_profile_id and u.trophy_id = x.id)
     order by (x.game_id is null), x.sort_order
  loop
    if public._tr_progress(p_profile_id, t.game_id, t.rule) >= public._tr_target(t.rule) then
      insert into public.trophy_unlocks(profile_id, trophy_id) values (p_profile_id, t.id) on conflict do nothing;
      get diagnostics v_rows = row_count;
      if v_rows > 0 then v_new := v_new || t.id; end if;
    end if;
  end loop;
  return v_new;
end $$;

-- Évalue UN seul trophée (hors fin de partie : ex. Pipelette, au moment où un sticker est envoyé).
-- Renvoie true s'il vient d'être débloqué.
create or replace function public.evaluate_trophy(p_profile_id uuid, p_trophy_id text)
returns boolean language plpgsql security definer
set search_path = public, extensions
as $$
declare
  t      record;
  v_rows integer;
begin
  select * into t from public.trophies where id = p_trophy_id and active and rule is not null;
  if not found then return false; end if;
  if exists (select 1 from public.trophy_unlocks u where u.profile_id = p_profile_id and u.trophy_id = t.id) then
    return false;
  end if;
  if public._tr_progress(p_profile_id, t.game_id, t.rule) >= public._tr_target(t.rule) then
    insert into public.trophy_unlocks(profile_id, trophy_id) values (p_profile_id, t.id) on conflict do nothing;
    get diagnostics v_rows = row_count;
    return v_rows > 0;
  end if;
  return false;
end $$;

-- Hook de fin de partie (cf. schema.sql) : {profile_id: [trophy_ids]} (non vides seulement).
create or replace function public._after_finish_trophies(p_match_id uuid, p_profile_ids uuid[])
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_game text;
  v_id   uuid;
  v_new  text[];
  v_map  jsonb := '{}'::jsonb;
begin
  select game_id into v_game from public.matches where id = p_match_id;
  foreach v_id in array coalesce(p_profile_ids, '{}') loop
    v_new := public.evaluate_trophies(v_id, v_game);
    if coalesce(array_length(v_new, 1), 0) > 0 then
      v_map := v_map || jsonb_build_object(v_id::text, to_jsonb(v_new));
    end if;
  end loop;
  return v_map;
end $$;

-- Progression du joueur courant : {trophy_id: {value, target}} pour les trophées actifs
-- (p_tenue : seulement ceux de cette tenue ; null = tous). Calculée à la demande.
create or replace function public.my_trophy_progress(p_tenue text default null)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_me  uuid := public._require_profile();
  v_res jsonb := '{}'::jsonb;
  t     record;
begin
  for t in select x.id, x.game_id, x.rule from public.trophies x
            where x.active and x.rule is not null
              and (p_tenue is null or x.tenue_id = p_tenue)
  loop
    v_res := v_res || jsonb_build_object(t.id, jsonb_build_object(
      'value', public._tr_progress(v_me, t.game_id, t.rule), 'target', public._tr_target(t.rule)));
  end loop;
  return v_res;
end $$;

-- ---- Stickers de tenue : droit d'usage -----------------------------------------

-- Le joueur peut-il utiliser le sticker de rang p_slot de la planche de la tenue p_tenue ?
-- Tenue débloquée ET (slot 1 | slot > 12 (bonus) | trophée (tenue, slot) obtenu).
create or replace function public._tenue_slot_ok(p_profile uuid, p_tenue text, p_slot integer)
returns boolean language sql stable security definer
set search_path = public, extensions
as $$
  select p_slot >= 1
     and exists (select 1 from public.tenue_unlocks u where u.profile_id = p_profile and u.tenue_id = p_tenue)
     and (p_slot = 1 or p_slot > 12 or exists (
           select 1 from public.trophies t join public.trophy_unlocks tu on tu.trophy_id = t.id
            where t.tenue_id = p_tenue and t.slot = p_slot and tu.profile_id = p_profile))
$$;

-- ---- Catalogue (généré depuis docs/TROPHEES.md) ----------------------------------

insert into public.trophies (id, tenue_id, slot, name, description, game_id, rule, active, sort_order) values
  ('qdn_incompris', 'star', 2, 'L''incompris', 'Voter 5 fois hors de la majorité en une partie', 'qui-de-nous', '{"agg":"max","stat":"off_majority","threshold":5}'::jsonb, true, 1),
  ('qdn_tete_de_turc', 'star', 3, 'Tête de Turc', 'Être désigné par tous les autres joueurs sur une manche', 'qui-de-nous', '{"agg":"sum","stat":"pointed_by_all","threshold":1}'::jsonb, true, 2),
  ('qdn_a_cote_de_la_plaque', 'star', 4, 'À côté de la plaque', 'Finir dernier d''une partie', 'qui-de-nous', '{"agg":"sum","stat":"last","threshold":1}'::jsonb, true, 3),
  ('qdn_bon_public', 'star', 5, 'Bon public', '60 points en cumul', 'qui-de-nous', '{"agg":"sum","stat":"points","threshold":60}'::jsonb, true, 4),
  ('qdn_invisible', 'star', 6, 'L''invisible', 'Finir une partie (8 manches min.) sans recevoir un seul vote', 'qui-de-nous', '{"agg":"count","threshold":1,"and":[{"stat":"designated","op":"=","value":0},{"stat":"rounds","op":">=","value":8}]}'::jsonb, true, 5),
  ('qdn_chouchou', 'star', 7, 'Le chouchou', 'Recevoir 30 votes en cumul', 'qui-de-nous', '{"agg":"sum","stat":"designated","threshold":30}'::jsonb, true, 6),
  ('qdn_flair', 'star', 8, 'Le flair', 'Voter avec la majorité 5 manches d''affilée', 'qui-de-nous', '{"agg":"max","stat":"maj_streak","threshold":5}'::jsonb, true, 7),
  ('qdn_plebiscite', 'star', 9, 'Plébiscite', 'Être le plus désigné sur 5 manches d''une même partie', 'qui-de-nous', '{"agg":"max","stat":"top_rounds","threshold":5}'::jsonb, true, 8),
  ('qdn_star_de_la_soiree', 'star', 10, 'Star de la soirée', 'Être le joueur le plus désigné de la partie, 3 fois (cumul)', 'qui-de-nous', '{"agg":"sum","stat":"top_designated","threshold":3}'::jsonb, true, 9),
  ('qdn_telepathe', 'star', 11, 'Télépathe', '8 points ou plus sur une partie de 10 manches', 'qui-de-nous', '{"agg":"count","threshold":1,"and":[{"stat":"points","op":">=","value":8},{"stat":"rounds","op":">=","value":10}]}'::jsonb, true, 10),
  ('qdn_voix_du_peuple', 'star', 12, 'La voix du peuple', 'Voter avec la majorité à toutes les manches d''une partie (10 manches min.)', 'qui-de-nous', '{"agg":"sum","stat":"perfect","threshold":1}'::jsonb, true, 11),
  ('uc_grille', 'espion', 2, 'Grillé !', 'Être éliminé en premier', 'undercover', '{"agg":"sum","stat":"undercover_first_out","threshold":1}'::jsonb, true, 12),
  ('uc_erreur_judiciaire', 'espion', 3, 'Erreur judiciaire', 'Être éliminé en étant civil, 3 fois (cumul)', 'undercover', '{"agg":"sum","stat":"wrongly_out","threshold":3}'::jsonb, true, 13),
  ('uc_bavure', 'espion', 4, 'La bavure', 'En civil, voter contre un autre civil 5 fois (cumul)', 'undercover', '{"agg":"sum","stat":"civil_vs_civil","threshold":5}'::jsonb, true, 14),
  ('uc_fin_limier', 'espion', 5, 'Fin limier', 'Voter contre un infiltré 5 fois (cumul)', 'undercover', '{"agg":"sum","stat":"infiltre_votes","threshold":5}'::jsonb, true, 15),
  ('uc_planque', 'espion', 6, 'La planque', 'Être encore en vie à la fin de 5 parties (cumul)', 'undercover', '{"agg":"sum","stat":"survived","threshold":5}'::jsonb, true, 16),
  ('uc_bon_citoyen', 'espion', 7, 'Bon citoyen', 'Gagner 5 parties en civil (cumul)', 'undercover', '{"agg":"sum","stat":"won_civil","threshold":5}'::jsonb, true, 17),
  ('uc_taupe', 'espion', 8, 'La taupe', 'Gagner 2 parties en undercover (cumul)', 'undercover', '{"agg":"sum","stat":"undercover_won_as_undercover","threshold":2}'::jsonb, true, 18),
  ('uc_page_blanche', 'espion', 9, 'Page blanche', 'Gagner une partie en Mister White', 'undercover', '{"agg":"sum","stat":"won_mrwhite","threshold":1}'::jsonb, true, 19),
  ('uc_sherlock', 'espion', 10, 'Sherlock', 'En une partie, voter contre un infiltré à chaque vote (2 votes min.)', 'undercover', '{"agg":"sum","stat":"sherlock","threshold":1}'::jsonb, true, 20),
  ('uc_insoupconnable', 'espion', 11, 'Insoupçonnable', 'Gagner en undercover sans recevoir un seul vote de la partie', 'undercover', '{"agg":"sum","stat":"insoupconnable","threshold":1}'::jsonb, true, 21),
  ('uc_agent_double', 'espion', 12, 'Agent double', 'Gagner 5 parties en infiltré, undercover ou Mister White (cumul)', 'undercover', '{"agg":"sum","stat":"won_infiltre","threshold":5}'::jsonb, true, 22),
  ('pdb_pas_de_bol', 'croupier', 2, 'Vraiment pas de bol', 'Finir dernier (le dernier avec des cartes)', 'pas-de-bol', '{"agg":"sum","stat":"last","threshold":1}'::jsonb, true, 23),
  ('pdb_addition_salee', 'croupier', 3, 'L''addition salée', 'Piocher 6 cartes ou plus d''un coup (cumul de +2 / +4)', 'pas-de-bol', '{"agg":"max","stat":"big_draw","threshold":6}'::jsonb, true, 24),
  ('pdb_etourdi', 'croupier', 4, 'L''étourdi', 'Se faire dénoncer pour un « Dernière carte ! » oublié', 'pas-de-bol', '{"agg":"sum","stat":"denounced","threshold":1}'::jsonb, true, 25),
  ('pdb_beau_jeu', 'croupier', 5, 'Beau jeu', 'Poser 5 cartes spéciales en une partie (+2, +4, joker, sens, passe, perso)', 'pas-de-bol', '{"agg":"max","stat":"special_cards","threshold":5}'::jsonb, true, 26),
  ('pdb_main_pleine', 'croupier', 6, 'Les mains pleines', 'Avoir 12 cartes ou plus en main', 'pas-de-bol', '{"agg":"max","stat":"max_hand","threshold":12}'::jsonb, true, 27),
  ('pdb_genereux', 'croupier', 7, 'Trop généreux', 'Faire piocher 20 cartes aux autres (cumul)', 'pas-de-bol', '{"agg":"sum","stat":"inflicted","threshold":20}'::jsonb, true, 28),
  ('pdb_balance', 'croupier', 8, 'La balance', 'Dénoncer 3 oublis de « Dernière carte ! » (cumul)', 'pas-de-bol', '{"agg":"sum","stat":"denounces","threshold":3}'::jsonb, true, 29),
  ('pdb_retour_envoyeur', 'croupier', 9, 'Retour à l''envoyeur', 'Renvoyer un +2 / +4 en cumulant dessus, 5 fois (cumul)', 'pas-de-bol', '{"agg":"sum","stat":"stacks","threshold":5}'::jsonb, true, 30),
  ('pdb_main_propre', 'croupier', 10, 'Main propre', 'Sortir premier en ayant pioché 2 cartes au plus de toute la partie', 'pas-de-bol', '{"agg":"sum","stat":"clean_win","threshold":1}'::jsonb, true, 31),
  ('pdb_remontada', 'croupier', 11, 'Remontada', 'Sortir premier après avoir eu 10 cartes ou plus en main', 'pas-de-bol', '{"agg":"sum","stat":"comeback","threshold":1}'::jsonb, true, 32),
  ('pdb_main_chaude', 'croupier', 12, 'Main chaude', 'Sortir premier 3 parties de suite', 'pas-de-bol', '{"agg":"streak","threshold":3,"and":[{"stat":"placement","op":"=","value":1}]}'::jsonb, true, 33),
  ('cef_bonnet_d_ane', 'prof', 2, 'Bonnet d''âne', 'Finir dernier d''une partie', 'cerveau-en-fete', '{"agg":"sum","stat":"last","threshold":1}'::jsonb, true, 34),
  ('cef_copie_blanche', 'prof', 3, 'Copie blanche', 'Rater 3 questions de suite', 'cerveau-en-fete', '{"agg":"max","stat":"miss_streak","threshold":3}'::jsonb, true, 35),
  ('cef_a_la_bourre', 'prof', 4, 'À la bourre', 'Trouver la bonne réponse en dernier (3 trouveurs min.), 5 fois (cumul)', 'cerveau-en-fete', '{"agg":"sum","stat":"last_finder","threshold":5}'::jsonb, true, 36),
  ('cef_bon_eleve', 'prof', 5, 'Bon élève', '50 bonnes réponses (cumul)', 'cerveau-en-fete', '{"agg":"sum","stat":"correct","threshold":50}'::jsonb, true, 37),
  ('cef_sur_le_fil', 'prof', 6, 'Sur le fil', 'Trouver dans les 3 dernières secondes, 3 fois (cumul)', 'cerveau-en-fete', '{"agg":"sum","stat":"close_finds","threshold":3}'::jsonb, true, 38),
  ('cef_doigt_leve', 'prof', 7, 'Le doigt levé', 'Être le premier à trouver 20 fois (cumul)', 'cerveau-en-fete', '{"agg":"sum","stat":"firsts","threshold":20}'::jsonb, true, 39),
  ('cef_eclair', 'prof', 8, 'Éclair de génie', 'Trouver une réponse tapée en moins de 3 s', 'cerveau-en-fete', '{"agg":"sum","stat":"fast_typed","threshold":1}'::jsonb, true, 40),
  ('cef_as_du_qcm', 'prof', 9, 'As du QCM', 'Réussir tous les QCM d''une partie (5 QCM min.)', 'cerveau-en-fete', '{"agg":"sum","stat":"qcm_perfect","threshold":1}'::jsonb, true, 41),
  ('cef_serie', 'prof', 10, 'En série', '5 bonnes réponses d''affilée', 'cerveau-en-fete', '{"agg":"max","stat":"best_streak","threshold":5}'::jsonb, true, 42),
  ('cef_tete_de_classe', 'prof', 11, 'Tête de classe', 'Être le premier à trouver sur 5 questions d''une même partie', 'cerveau-en-fete', '{"agg":"max","stat":"firsts","threshold":5}'::jsonb, true, 43),
  ('cef_sans_faute', 'prof', 12, '20 sur 20', 'Trouver toutes les questions d''une partie (10 questions min.)', 'cerveau-en-fete', '{"agg":"sum","stat":"perfect","threshold":1}'::jsonb, true, 44),
  ('pb_recale', 'ecolier', 2, 'Recalé !', 'Se faire refuser 3 réponses par le vote des autres (cumul)', 'petit-bac', '{"agg":"sum","stat":"refused","threshold":3}'::jsonb, true, 45),
  ('pb_page_blanche', 'ecolier', 3, 'Page blanche', 'Marquer 0 point sur une manche', 'petit-bac', '{"agg":"sum","stat":"zero_rounds","threshold":1}'::jsonb, true, 46),
  ('pb_copieur', 'ecolier', 4, 'Le copieur', '10 réponses partagées avec un autre joueur (cumul)', 'petit-bac', '{"agg":"sum","stat":"shared","threshold":10}'::jsonb, true, 47),
  ('pb_original', 'ecolier', 5, 'L''original', '20 réponses uniques (cumul)', 'petit-bac', '{"agg":"sum","stat":"uniques","threshold":20}'::jsonb, true, 48),
  ('pb_panne_seche', 'ecolier', 6, 'Panne sèche', 'Laisser 3 cases vides sur une même manche', 'petit-bac', '{"agg":"max","stat":"max_empty","threshold":3}'::jsonb, true, 49),
  ('pb_grille_pleine', 'ecolier', 7, 'Grille pleine', 'Remplir toutes les cases d''une manche avec des réponses acceptées', 'petit-bac', '{"agg":"sum","stat":"full_grids","threshold":1}'::jsonb, true, 50),
  ('pb_avocat', 'ecolier', 8, 'L''avocat', 'Contester 5 réponses qui finissent refusées (cumul)', 'petit-bac', '{"agg":"sum","stat":"lawyer","threshold":5}'::jsonb, true, 51),
  ('pb_carton_plein', 'ecolier', 9, 'Carton plein', 'Une manche avec uniquement des réponses uniques (2 pts partout)', 'petit-bac', '{"agg":"sum","stat":"perfect_rounds","threshold":1}'::jsonb, true, 52),
  ('pb_meilleure_copie', 'ecolier', 10, 'Meilleure copie', 'Avoir le meilleur score de la manche 10 fois (cumul)', 'petit-bac', '{"agg":"sum","stat":"best_rounds","threshold":10}'::jsonb, true, 53),
  ('pb_regulier', 'ecolier', 11, 'Élève régulier', 'Marquer au moins 8 points à chaque manche d''une partie (3 manches min.)', 'petit-bac', '{"agg":"sum","stat":"regular","threshold":1}'::jsonb, true, 54),
  ('pb_grand_chelem', 'ecolier', 12, 'Major de promo', 'Avoir le meilleur score à toutes les manches d''une partie (4 manches min., ex æquo acceptés)', 'petit-bac', '{"agg":"sum","stat":"grand_slam","threshold":1}'::jsonb, true, 55),
  ('dd_gribouillis', 'artiste', 2, 'Gribouillis', 'Dessiner un mot que personne ne trouve', 'dessine-devine', '{"agg":"sum","stat":"unfound","threshold":1}'::jsonb, true, 56),
  ('dd_dans_le_flou', 'artiste', 3, 'Dans le flou', 'Ne pas trouver 3 dessins de suite', 'dessine-devine', '{"agg":"max","stat":"miss_streak","threshold":3}'::jsonb, true, 57),
  ('dd_presque', 'artiste', 4, 'Presque !', 'Recevoir 5 « Presque ! » (cumul)', 'dessine-devine', '{"agg":"sum","stat":"close_count","threshold":5}'::jsonb, true, 58),
  ('dd_oeil_de_lynx', 'artiste', 5, 'Œil de lynx', 'Trouver 25 mots (cumul)', 'dessine-devine', '{"agg":"sum","stat":"found_count","threshold":25}'::jsonb, true, 59),
  ('dd_in_extremis', 'artiste', 6, 'In extremis', 'Trouver un mot dans les 5 dernières secondes', 'dessine-devine', '{"agg":"sum","stat":"late_finds","threshold":1}'::jsonb, true, 60),
  ('dd_limpide', 'artiste', 7, 'Limpide', 'Tout le monde trouve ton dessin, 3 fois (cumul)', 'dessine-devine', '{"agg":"sum","stat":"perfect_drawings","threshold":3}'::jsonb, true, 61),
  ('dd_premier_servi', 'artiste', 8, 'Premier servi', 'Être le premier à trouver 10 fois (cumul)', 'dessine-devine', '{"agg":"sum","stat":"first_finds","threshold":10}'::jsonb, true, 62),
  ('dd_eclair', 'artiste', 9, 'Coup d''œil', 'Trouver un mot en moins de 10 s', 'dessine-devine', '{"agg":"sum","stat":"fast_finds","threshold":1}'::jsonb, true, 63),
  ('dd_sans_indice', 'artiste', 10, 'Sans indice', 'Trouver avant la première lettre révélée, 5 fois (cumul)', 'dessine-devine', '{"agg":"sum","stat":"no_hint_finds","threshold":5}'::jsonb, true, 64),
  ('dd_defi_releve', 'artiste', 11, 'Défi relevé', 'Faire deviner un mot difficile (niveau 3) à tous les joueurs', 'dessine-devine', '{"agg":"sum","stat":"hard_perfect","threshold":1}'::jsonb, true, 65),
  ('dd_chef_d_oeuvre', 'artiste', 12, 'Chef-d''œuvre', 'En une partie (4 joueurs min.) : tout le monde trouve tous tes dessins et tu trouves tous ceux des autres', 'dessine-devine', '{"agg":"sum","stat":"masterpiece","threshold":1}'::jsonb, true, 66),
  ('lg_petit_dejeuner', 'loup', 2, 'Petit déjeuner', 'Être dévoré dès la première nuit', 'loup-garou', '{"agg":"sum","stat":"first_night_death","threshold":1}'::jsonb, true, 67),
  ('lg_bucher', 'loup', 3, 'Au bûcher !', 'Être éliminé par le vote sans être loup, 3 fois (cumul)', 'loup-garou', '{"agg":"sum","stat":"lynched_innocent","threshold":3}'::jsonb, true, 68),
  ('lg_cimetiere', 'loup', 4, 'Abonné au cimetière', 'Mourir avant la fin dans 5 parties (cumul)', 'loup-garou', '{"agg":"sum","stat":"died","threshold":5}'::jsonb, true, 69),
  ('lg_flair', 'loup', 5, 'Flair de chasseur', 'Voter contre un loup au vote du jour, 5 fois (cumul)', 'loup-garou', '{"agg":"sum","stat":"wolf_votes","threshold":5}'::jsonb, true, 70),
  ('lg_marmotte', 'loup', 6, 'La marmotte', 'Être encore en vie à la fin de 5 parties (cumul)', 'loup-garou', '{"agg":"sum","stat":"survived","threshold":5}'::jsonb, true, 71),
  ('lg_bon_voisin', 'loup', 7, 'Bon voisin', 'Gagner 5 parties dans le camp du village (cumul)', 'loup-garou', '{"agg":"sum","stat":"won_village","threshold":5}'::jsonb, true, 72),
  ('lg_meute', 'loup', 8, 'La meute', 'Gagner 3 parties en loup (cumul)', 'loup-garou', '{"agg":"sum","stat":"won_wolf","threshold":3}'::jsonb, true, 73),
  ('lg_coup_de_maitre', 'loup', 9, 'Coup de maître', 'Réussir un pouvoir 3 fois (cumul) : voyante qui voit un loup, sorcière qui sauve, protecteur qui protège la cible des loups, chasseur qui abat un loup', 'loup-garou', '{"agg":"sum","stat":"powers","threshold":3}'::jsonb, true, 74),
  ('lg_simple_villageois', 'loup', 10, 'Simple villageois', 'Gagner en simple villageois en étant encore en vie', 'loup-garou', '{"agg":"sum","stat":"simple_win","threshold":1}'::jsonb, true, 75),
  ('lg_agneau', 'loup', 11, 'Doux comme un agneau', 'Gagner en loup sans recevoir un seul vote du village de toute la partie', 'loup-garou', '{"agg":"sum","stat":"lamb","threshold":1}'::jsonb, true, 76),
  ('lg_loup_solitaire', 'loup', 12, 'Loup solitaire', 'Gagner en étant le dernier loup en vie (2 loups min. au départ)', 'loup-garou', '{"agg":"sum","stat":"lone_wolf","threshold":1}'::jsonb, true, 77),
  ('bam_boum', 'artificier', 2, 'BOUM !', 'Exploser 10 fois (cumul)', 'bombe-a-mots', '{"agg":"sum","stat":"explosions","threshold":10}'::jsonb, true, 78),
  ('bam_coup_double', 'artificier', 3, 'Coup double', 'Subir 2 explosions de suite', 'bombe-a-mots', '{"agg":"sum","stat":"double_boom","threshold":1}'::jsonb, true, 79),
  ('bam_premier_saute', 'artificier', 4, 'Premier sauté', 'Être éliminé en premier, 3 fois (cumul)', 'bombe-a-mots', '{"agg":"sum","stat":"first_out","threshold":3}'::jsonb, true, 80),
  ('bam_dico', 'artificier', 5, 'Le dico', '100 mots validés (cumul)', 'bombe-a-mots', '{"agg":"sum","stat":"words","threshold":100}'::jsonb, true, 81),
  ('bam_mot_a_rallonge', 'artificier', 6, 'Mot à rallonge', 'Valider un mot de 12 lettres ou plus', 'bombe-a-mots', '{"agg":"max","stat":"longest_word","threshold":12}'::jsonb, true, 82),
  ('bam_abecedaire', 'artificier', 7, 'L''abécédaire', 'Compléter l''alphabet bonus', 'bombe-a-mots', '{"agg":"sum","stat":"alphabets","threshold":1}'::jsonb, true, 83),
  ('bam_patate_chaude', 'artificier', 8, 'Patate chaude', 'Valider un mot en moins de 2 s, 10 fois (cumul)', 'bombe-a-mots', '{"agg":"sum","stat":"fast_words","threshold":10}'::jsonb, true, 84),
  ('bam_sueurs_froides', 'artificier', 9, 'Sueurs froides', 'Valider un mot à moins d''1 s de l''explosion', 'bombe-a-mots', '{"agg":"sum","stat":"close_calls","threshold":1}'::jsonb, true, 85),
  ('bam_survivant', 'artificier', 10, 'Sur un fil', 'Gagner avec une seule vie restante', 'bombe-a-mots', '{"agg":"sum","stat":"last_life_win","threshold":1}'::jsonb, true, 86),
  ('bam_intouchable', 'artificier', 11, 'Intouchable', 'Gagner sans perdre une seule vie (3 joueurs min.)', 'bombe-a-mots', '{"agg":"sum","stat":"untouched","threshold":1}'::jsonb, true, 87),
  ('bam_marathon', 'artificier', 12, 'Moulin à paroles', '20 mots validés en une partie', 'bombe-a-mots', '{"agg":"max","stat":"words","threshold":20}'::jsonb, true, 88),
  ('mtr_a_la_planche', 'pirate', 2, 'À la planche', 'Être le premier éliminé', 'menteur', '{"agg":"sum","stat":"first_out","threshold":1}'::jsonb, true, 89),
  ('mtr_mauvaise_langue', 'pirate', 3, 'Mauvaise langue', 'Crier « Menteur ! » à tort 5 fois (cumul)', 'menteur', '{"agg":"sum","stat":"false_liar","threshold":5}'::jsonb, true, 90),
  ('mtr_pris_la_main_dans_le_sac', 'pirate', 4, 'La main dans le sac', 'Se faire démasquer 5 fois (cumul)', 'menteur', '{"agg":"sum","stat":"caught","threshold":5}'::jsonb, true, 91),
  ('mtr_detecteur', 'pirate', 5, 'Détecteur de mensonges', 'Crier « Menteur ! » à raison 10 fois (cumul)', 'menteur', '{"agg":"sum","stat":"good_liar","threshold":10}'::jsonb, true, 92),
  ('mtr_dernier_de', 'pirate', 6, 'Le dernier dé', 'Gagner la partie avec un seul dé restant', 'menteur', '{"agg":"sum","stat":"last_die_win","threshold":1}'::jsonb, true, 93),
  ('mtr_pile', 'pirate', 7, 'Pile !', 'Réussir un « Pile ! » exact (option activée)', 'menteur', '{"agg":"sum","stat":"pile_ok","threshold":1}'::jsonb, true, 94),
  ('mtr_bluff', 'pirate', 8, 'Coup de bluff', 'Ton enchère est contestée, elle est vraie, et tu n''avais aucun dé de cette valeur ni joker', 'menteur', '{"agg":"sum","stat":"pure_bluffs","threshold":1}'::jsonb, true, 95),
  ('mtr_pile_poil', 'pirate', 9, 'Pile-poil', 'Ton enchère contestée tombe exactement juste, 3 fois (cumul)', 'menteur', '{"agg":"sum","stat":"exact_bids","threshold":3}'::jsonb, true, 96),
  ('mtr_grosse_voix', 'pirate', 10, 'Grosse voix', 'Une enchère de 8 dés ou plus, contestée, qui s''avère vraie', 'menteur', '{"agg":"sum","stat":"big_bid","threshold":1}'::jsonb, true, 97),
  ('mtr_revenant', 'pirate', 11, 'Le revenant', 'Gagner après être tombé à un seul dé alors qu''il restait 3 joueurs ou plus', 'menteur', '{"agg":"sum","stat":"comeback","threshold":1}'::jsonb, true, 98),
  ('mtr_capitaine', 'pirate', 12, 'Capitaine', 'Gagner sans perdre un seul dé (3 joueurs min.)', 'menteur', '{"agg":"sum","stat":"captain","threshold":1}'::jsonb, true, 99),
  ('bwl_rigole', 'bowler', 2, 'Abonné à la rigole', '3 gouttières (lancer à 0 quille) en une partie', 'bowling', '{"agg":"max","stat":"gutters","threshold":3}'::jsonb, true, 100),
  ('bwl_quille_tetue', 'bowler', 3, 'La quille têtue', 'Finir une frame avec une seule quille debout, 5 fois (cumul)', 'bowling', '{"agg":"sum","stat":"one_left","threshold":5}'::jsonb, true, 101),
  ('bwl_lanterne_rouge', 'bowler', 4, 'Lanterne rouge', 'Finir dernier d''une partie', 'bowling', '{"agg":"sum","stat":"last","threshold":1}'::jsonb, true, 102),
  ('bwl_strikes', 'bowler', 5, 'Ça tombe !', '10 strikes (cumul)', 'bowling', '{"agg":"sum","stat":"strikes","threshold":10}'::jsonb, true, 103),
  ('bwl_spares', 'bowler', 6, 'Le rattrapeur', '10 spares (cumul)', 'bowling', '{"agg":"sum","stat":"spares","threshold":10}'::jsonb, true, 104),
  ('bwl_double', 'bowler', 7, 'Le doublé', '2 strikes d''affilée', 'bowling', '{"agg":"max","stat":"strike_run","threshold":2}'::jsonb, true, 105),
  ('bwl_sauvetage', 'bowler', 8, 'Sauvetage', 'Faire un spare après une gouttière au premier lancer', 'bowling', '{"agg":"sum","stat":"rescues","threshold":1}'::jsonb, true, 106),
  ('bwl_dinde', 'bowler', 9, 'La dinde', '3 strikes d''affilée', 'bowling', '{"agg":"max","stat":"strike_run","threshold":3}'::jsonb, true, 107),
  ('bwl_cent_cinquante', 'bowler', 10, '150 au compteur', '150 points ou plus sur 10 frames', 'bowling', '{"agg":"count","threshold":1,"and":[{"stat":"score","op":">=","value":150},{"stat":"frames","op":">=","value":10}]}'::jsonb, true, 108),
  ('bwl_partie_propre', 'bowler', 11, 'Partie propre', 'Strike ou spare à chaque frame (5 frames min.)', 'bowling', '{"agg":"sum","stat":"clean","threshold":1}'::jsonb, true, 109),
  ('bwl_deux_cents', 'bowler', 12, 'Le club des 200', '200 points ou plus sur 10 frames', 'bowling', '{"agg":"count","threshold":1,"and":[{"stat":"score","op":">=","value":200},{"stat":"frames","op":">=","value":10}]}'::jsonb, true, 110),
  ('tp_a_contre_courant', 'philosophe', 2, 'À contre-courant', 'Perdre 5 paris en une partie', 'tu-preferes', '{"agg":"max","stat":"bets_lost","threshold":5}'::jsonb, true, 111),
  ('tp_seul_au_monde', 'philosophe', 3, 'Seul au monde', 'Être le seul de son avis une fois', 'tu-preferes', '{"agg":"sum","stat":"rebel","threshold":1}'::jsonb, true, 112),
  ('tp_dernier_de_la_classe', 'philosophe', 4, 'Perdu dans ses pensées', 'Finir dernier d''une partie', 'tu-preferes', '{"agg":"sum","stat":"last","threshold":1}'::jsonb, true, 113),
  ('tp_sondeur', 'philosophe', 5, 'Le sondeur', '30 paris justes (cumul)', 'tu-preferes', '{"agg":"sum","stat":"bets_ok","threshold":30}'::jsonb, true, 114),
  ('tp_mouton', 'philosophe', 6, 'Le mouton', 'Choisir comme la majorité 30 fois (cumul)', 'tu-preferes', '{"agg":"sum","stat":"norm","threshold":30}'::jsonb, true, 115),
  ('tp_tous_d_accord', 'philosophe', 7, 'Tous d''accord', 'Une manche à l''unanimité (3 joueurs min.), 3 fois (cumul)', 'tu-preferes', '{"agg":"sum","stat":"unanimous_rounds","threshold":3}'::jsonb, true, 116),
  ('tp_rebelle_lucide', 'philosophe', 8, 'Rebelle lucide', 'Être seul de son avis et gagner son pari sur la même manche', 'tu-preferes', '{"agg":"sum","stat":"rebel_right","threshold":1}'::jsonb, true, 117),
  ('tp_rebelle_en_serie', 'philosophe', 9, 'Rebelle en série', 'Être seul de son avis 3 fois en une partie', 'tu-preferes', '{"agg":"max","stat":"rebel","threshold":3}'::jsonb, true, 118),
  ('tp_devin', 'philosophe', 10, 'Le devin', '8 paris justes en une partie (10 manches min.)', 'tu-preferes', '{"agg":"count","threshold":1,"and":[{"stat":"bets_ok","op":">=","value":8},{"stat":"rounds","op":">=","value":10}]}'::jsonb, true, 119),
  ('tp_anticonformiste', 'philosophe', 11, 'Anticonformiste', 'Gagner une partie en ayant été minoritaire plus d''une manche sur deux', 'tu-preferes', '{"agg":"count","threshold":1,"and":[{"stat":"minority","op":"=","value":1},{"stat":"won","op":"=","value":1}]}'::jsonb, true, 120),
  ('tp_oracle', 'philosophe', 12, 'L''oracle', 'Tous les paris justes sur une partie de 10 manches min.', 'tu-preferes', '{"agg":"sum","stat":"perfect_bets","threshold":1}'::jsonb, true, 121),
  ('qsj_trou_de_memoire', 'vedette', 2, 'Trou de mémoire', 'Finir un tour sans trouver une seule carte', 'qui-suis-je', '{"agg":"sum","stat":"empty_turns","threshold":1}'::jsonb, true, 122),
  ('qsj_je_passe', 'vedette', 3, 'Je passe !', 'Passer 5 cartes dans un même tour', 'qui-suis-je', '{"agg":"max","stat":"max_passed","threshold":5}'::jsonb, true, 123),
  ('qsj_figurant', 'vedette', 4, 'Le figurant', 'Finir dernier d''une partie', 'qui-suis-je', '{"agg":"sum","stat":"last","threshold":1}'::jsonb, true, 124),
  ('qsj_culture', 'vedette', 5, 'Culture générale', '50 cartes trouvées (cumul)', 'qui-suis-je', '{"agg":"sum","stat":"found","threshold":50}'::jsonb, true, 125),
  ('qsj_sans_joker', 'vedette', 6, 'Sans joker', 'Un tour sans passer, avec 3 cartes trouvées ou plus', 'qui-suis-je', '{"agg":"sum","stat":"clean_turns","threshold":1}'::jsonb, true, 126),
  ('qsj_tete_connue', 'vedette', 7, 'Une tête connue', 'Deviner 3 persos de la bande (thème « Les Soirées de Dédé », cumul)', 'qui-suis-je', '{"agg":"sum","stat":"crew_found","threshold":3}'::jsonb, true, 127),
  ('qsj_tac_tac', 'vedette', 8, 'Tac tac tac', '5 cartes trouvées d''affilée sans passer', 'qui-suis-je', '{"agg":"max","stat":"best_run","threshold":5}'::jsonb, true, 128),
  ('qsj_rafale', 'vedette', 9, 'En rafale', '8 cartes trouvées en un seul tour', 'qui-suis-je', '{"agg":"max","stat":"best_turn","threshold":8}'::jsonb, true, 129),
  ('qsj_valeur_sure', 'vedette', 10, 'Valeur sûre', 'Au moins 5 cartes à chacun de ses tours (2 tours min.)', 'qui-suis-je', '{"agg":"sum","stat":"steady","threshold":1}'::jsonb, true, 130),
  ('qsj_cinephile', 'vedette', 11, 'Le cinéphile', 'Trouver 10 cartes difficiles (niveau 3, cumul)', 'qui-suis-je', '{"agg":"sum","stat":"hard_found","threshold":10}'::jsonb, true, 131),
  ('qsj_tapis_rouge', 'vedette', 12, 'Tapis rouge', '12 cartes trouvées en un seul tour', 'qui-suis-je', '{"agg":"max","stat":"best_turn","threshold":12}'::jsonb, true, 132),
  ('lpp_a_cote', 'archer', 2, 'À côté de la cible', 'Être le plus loin de la réponse 5 fois (3 joueurs min., cumul)', 'le-plus-proche', '{"agg":"sum","stat":"farthest","threshold":5}'::jsonb, true, 133),
  ('lpp_hors_cible', 'archer', 3, 'Dans le décor', 'Se tromper d''un facteur 10 ou plus', 'le-plus-proche', '{"agg":"sum","stat":"way_off","threshold":1}'::jsonb, true, 134),
  ('lpp_bredouille', 'archer', 4, 'Bredouille', '3 manches de suite sans marquer', 'le-plus-proche', '{"agg":"max","stat":"scoreless_run","threshold":3}'::jsonb, true, 135),
  ('lpp_dans_le_jaune', 'archer', 5, 'Dans le jaune', 'Être le plus proche 15 fois (cumul)', 'le-plus-proche', '{"agg":"sum","stat":"closest","threshold":15}'::jsonb, true, 136),
  ('lpp_poulidor', 'archer', 6, 'Éternel second', 'Finir 2e d''une manche 10 fois (cumul)', 'le-plus-proche', '{"agg":"sum","stat":"seconds","threshold":10}'::jsonb, true, 137),
  ('lpp_ames_soeurs', 'archer', 7, 'Âmes sœurs', 'Être le plus proche à égalité avec un autre joueur', 'le-plus-proche', '{"agg":"sum","stat":"tied_closest","threshold":1}'::jsonb, true, 138),
  ('lpp_a_un_cheveu', 'archer', 8, 'À un cheveu', 'Être le plus proche à moins de 1 % de la réponse, sans être exact', 'le-plus-proche', '{"agg":"sum","stat":"near_miss","threshold":1}'::jsonb, true, 139),
  ('lpp_dans_le_mille', 'archer', 9, 'Dans le mille', 'Donner une réponse exacte', 'le-plus-proche', '{"agg":"sum","stat":"exacts","threshold":1}'::jsonb, true, 140),
  ('lpp_regulier', 'archer', 10, 'Tir groupé', 'Marquer des points à toutes les manches d''une partie (8 manches min.)', 'le-plus-proche', '{"agg":"sum","stat":"scored_all","threshold":1}'::jsonb, true, 141),
  ('lpp_triple', 'archer', 11, 'Trois flèches', 'Être le plus proche 3 manches d''affilée', 'le-plus-proche', '{"agg":"max","stat":"closest_run","threshold":3}'::jsonb, true, 142),
  ('lpp_robin_des_bois', 'archer', 12, 'Robin des Bois', '2 réponses exactes en une partie', 'le-plus-proche', '{"agg":"max","stat":"exacts","threshold":2}'::jsonb, true, 143),
  ('aov_four', 'comedien', 2, 'Le four', 'Rater un défi (majorité de 👎)', 'action-ou-verite', '{"agg":"sum","stat":"fails","threshold":1}'::jsonb, true, 144),
  ('aov_gage', 'comedien', 3, 'Gage !', 'Recevoir 3 gages (refus, cumul)', 'action-ou-verite', '{"agg":"sum","stat":"refusals","threshold":3}'::jsonb, true, 145),
  ('aov_siffle', 'comedien', 4, 'Sifflé', 'Recevoir 10 👎 (cumul)', 'action-ou-verite', '{"agg":"sum","stat":"thumbs_down","threshold":10}'::jsonb, true, 146),
  ('aov_franc_jeu', 'comedien', 5, 'Franc-jeu', 'Choisir « Vérité » 10 fois (cumul)', 'action-ou-verite', '{"agg":"sum","stat":"verites","threshold":10}'::jsonb, true, 147),
  ('aov_chouchou_de_la_roue', 'comedien', 6, 'Chouchou de la roue', 'Être désigné 5 fois par la roue en une partie', 'action-ou-verite', '{"agg":"max","stat":"turns","threshold":5}'::jsonb, true, 148),
  ('aov_ovation', 'comedien', 7, 'Ovation', 'Réussir un défi à l''unanimité (3 votants min.)', 'action-ou-verite', '{"agg":"sum","stat":"unanimous","threshold":1}'::jsonb, true, 149),
  ('aov_casse_cou', 'comedien', 8, 'Casse-cou', 'Choisir « Action » 15 fois (cumul)', 'action-ou-verite', '{"agg":"sum","stat":"actions","threshold":15}'::jsonb, true, 150),
  ('aov_niveau_3', 'comedien', 9, 'Même pas peur', 'Réussir une carte de niveau 3', 'action-ou-verite', '{"agg":"sum","stat":"hard_success","threshold":1}'::jsonb, true, 151),
  ('aov_applaudi', 'comedien', 10, 'Applaudimètre', 'Recevoir 50 👍 (cumul)', 'action-ou-verite', '{"agg":"sum","stat":"thumbs_up","threshold":50}'::jsonb, true, 152),
  ('aov_jamais_degonfle', 'comedien', 11, 'Jamais dégonflé', '3 parties sans aucun refus (2 tours min. par partie, cumul)', 'action-ou-verite', '{"agg":"count","threshold":3,"and":[{"stat":"refusals","op":"=","value":0},{"stat":"turns","op":">=","value":2}]}'::jsonb, true, 153),
  ('aov_standing_ovation', 'comedien', 12, 'Standing ovation', 'En une partie : 5 tours ou plus, tous réussis', 'action-ou-verite', '{"agg":"sum","stat":"perfect","threshold":1}'::jsonb, true, 154),
  ('dee_sur_le_banc', 'coach', 2, 'Sur le banc', 'Perdre 3 parties avec son équipe (cumul)', 'devine-en-equipe', '{"agg":"count","threshold":3,"and":[{"stat":"won","op":"=","value":0}]}'::jsonb, true, 155),
  ('dee_bredouille', 'coach', 3, 'Bredouille', 'Finir un passage d''orateur sans aucun mot trouvé', 'devine-en-equipe', '{"agg":"sum","stat":"empty_turns","threshold":1}'::jsonb, true, 156),
  ('dee_suivant', 'coach', 4, 'Suivant !', 'Passer 3 mots dans un même passage', 'devine-en-equipe', '{"agg":"max","stat":"max_passed","threshold":3}'::jsonb, true, 157),
  ('dee_orateur', 'coach', 5, 'Belle éloquence', 'Faire deviner 30 mots (cumul)', 'devine-en-equipe', '{"agg":"sum","stat":"found","threshold":30}'::jsonb, true, 158),
  ('dee_mime', 'coach', 6, 'Roi du mime', 'Faire deviner 5 mots en manche Mime (cumul)', 'devine-en-equipe', '{"agg":"sum","stat":"found_r3","threshold":5}'::jsonb, true, 159),
  ('dee_pilier', 'coach', 7, 'Pilier de l''équipe', 'Être le meilleur orateur de son équipe 3 fois (cumul)', 'devine-en-equipe', '{"agg":"sum","stat":"best_in_team","threshold":3}'::jsonb, true, 160),
  ('dee_un_seul_mot', 'coach', 8, 'En un mot', '4 mots trouvés dans un passage de la manche « Un seul mot »', 'devine-en-equipe', '{"agg":"max","stat":"best_r2","threshold":4}'::jsonb, true, 161),
  ('dee_du_rab', 'coach', 9, 'Du rab', 'Vider la pioche et garder du temps pour la manche suivante', 'devine-en-equipe', '{"agg":"sum","stat":"carries","threshold":1}'::jsonb, true, 162),
  ('dee_rafale', 'coach', 10, 'La rafale', '6 mots trouvés en un seul passage', 'devine-en-equipe', '{"agg":"max","stat":"best_turn","threshold":6}'::jsonb, true, 163),
  ('dee_trois_manches', 'coach', 11, 'Carton plein', 'Son équipe gagne les 3 manches d''une partie', 'devine-en-equipe', '{"agg":"sum","stat":"sweep","threshold":1}'::jsonb, true, 164),
  ('dee_mvp', 'coach', 12, 'MVP', 'Gagner en étant le meilleur orateur des deux équipes avec 10 mots ou plus', 'devine-en-equipe', '{"agg":"sum","stat":"mvp","threshold":1}'::jsonb, true, 165),
  ('q4_tete_en_l_air', 'stratege', 2, 'Tête en l''air', 'Perdre une manche en 10 jetons ou moins (au total)', 'quatre-a-la-suite', '{"agg":"sum","stat":"fast_loss","threshold":1}'::jsonb, true, 166),
  ('q4_serie_noire', 'stratege', 3, 'Série noire', 'Perdre 3 duels d''affilée dans une session', 'quatre-a-la-suite', '{"agg":"max","stat":"loss_streak","threshold":3}'::jsonb, true, 167),
  ('q4_grille_pleine', 'stratege', 4, 'Grille pleine', 'Faire match nul (grille pleine)', 'quatre-a-la-suite', '{"agg":"sum","stat":"draws","threshold":1}'::jsonb, true, 168),
  ('q4_parieur', 'stratege', 5, 'Le parieur', 'Gagner 10 paris en spectateur (cumul)', 'quatre-a-la-suite', '{"agg":"sum","stat":"bets_won","threshold":10}'::jsonb, true, 169),
  ('q4_marathon', 'stratege', 6, 'Guerre des nerfs', 'Gagner une manche de 36 jetons ou plus', 'quatre-a-la-suite', '{"agg":"sum","stat":"long_win","threshold":1}'::jsonb, true, 170),
  ('q4_diagonale', 'stratege', 7, 'En diagonale', 'Gagner 3 manches par une diagonale (cumul)', 'quatre-a-la-suite', '{"agg":"sum","stat":"diag_wins","threshold":3}'::jsonb, true, 171),
  ('q4_double_menace', 'stratege', 8, 'Double menace', 'Gagner avec deux alignements à la fois, ou 5 jetons alignés', 'quatre-a-la-suite', '{"agg":"sum","stat":"double_wins","threshold":1}'::jsonb, true, 172),
  ('q4_express', 'stratege', 9, 'Express', 'Gagner une manche en 12 jetons ou moins (au total)', 'quatre-a-la-suite', '{"agg":"sum","stat":"fast_win","threshold":1}'::jsonb, true, 173),
  ('q4_trois_a_la_suite', 'stratege', 10, '3 à la suite', 'Gagner 3 duels d''affilée dans une session', 'quatre-a-la-suite', '{"agg":"max","stat":"win_streak","threshold":3}'::jsonb, true, 174),
  ('q4_champion', 'stratege', 11, 'Champion de la table', 'Finir premier d''une session de 4 joueurs ou plus, 2 fois (cumul)', 'quatre-a-la-suite', '{"agg":"count","threshold":2,"and":[{"stat":"won","op":"=","value":1},{"stat":"nplayers","op":">=","value":4}]}'::jsonb, true, 175),
  ('q4_invaincu', 'stratege', 12, 'Invaincu', 'Une session de 4 duels joués ou plus, sans défaite ni nul', 'quatre-a-la-suite', '{"agg":"count","threshold":1,"and":[{"stat":"played","op":">=","value":4},{"stat":"losses","op":"=","value":0},{"stat":"draws","op":"=","value":0}]}'::jsonb, true, 176),
  ('mor_etourdi', 'ninja', 2, 'L''étourdi', 'Perdre une manche en classique en 7 coups ou moins', 'morpion', '{"agg":"sum","stat":"classic_fast_loss","threshold":1}'::jsonb, true, 177),
  ('mor_serie_noire', 'ninja', 3, 'Série noire', 'Perdre 3 duels d''affilée dans une session', 'morpion', '{"agg":"max","stat":"loss_streak","threshold":3}'::jsonb, true, 178),
  ('mor_match_nul', 'ninja', 4, 'Match nul', '5 nuls (cumul)', 'morpion', '{"agg":"sum","stat":"draws","threshold":5}'::jsonb, true, 179),
  ('mor_parieur', 'ninja', 5, 'Le parieur', 'Gagner 10 paris en spectateur (cumul)', 'morpion', '{"agg":"sum","stat":"bets_won","threshold":10}'::jsonb, true, 180),
  ('mor_geant', 'ninja', 6, 'Vu en grand', 'Gagner 3 manches en Géant (cumul)', 'morpion', '{"agg":"sum","stat":"giant_wins","threshold":3}'::jsonb, true, 181),
  ('mor_touche_a_tout', 'ninja', 7, 'Touche-à-tout', 'Gagner un duel dans chacune des 3 variantes (cumul)', 'morpion', '{"agg":"all","rules":[{"agg":"sum","stat":"win_classic","threshold":1},{"agg":"sum","stat":"win_giant","threshold":1},{"agg":"sum","stat":"win_ultimate","threshold":1}]}'::jsonb, true, 182),
  ('mor_contre_attaque', 'ninja', 8, 'Contre-attaque', 'Gagner une manche en classique en jouant ⭕ (en second)', 'morpion', '{"agg":"sum","stat":"classic_second_win","threshold":1}'::jsonb, true, 183),
  ('mor_eclair', 'ninja', 9, 'L''éclair', 'Gagner une manche en Géant en 13 coups ou moins (au total)', 'morpion', '{"agg":"sum","stat":"giant_fast_win","threshold":1}'::jsonb, true, 184),
  ('mor_ultime', 'ninja', 10, 'Maître de l''Ultime', 'Gagner 3 duels en Ultime (cumul)', 'morpion', '{"agg":"sum","stat":"ultimate_duel_wins","threshold":3}'::jsonb, true, 185),
  ('mor_ombre', 'ninja', 11, 'L''ombre', 'Gagner une manche en Ultime sans perdre un seul petit morpion', 'morpion', '{"agg":"sum","stat":"clean_ultimate","threshold":1}'::jsonb, true, 186),
  ('mor_ninja', 'ninja', 12, 'Insaisissable', 'Gagner 4 duels d''affilée dans une session', 'morpion', '{"agg":"max","stat":"win_streak","threshold":4}'::jsonb, true, 187),
  ('bn_plouf', 'amiral', 2, 'Plouf plouf', '10 tirs à l''eau d''affilée', 'bataille-navale', '{"agg":"max","stat":"miss_streak","threshold":10}'::jsonb, true, 188),
  ('bn_naufrage', 'amiral', 3, 'Naufrage total', 'Perdre une manche sans couler un seul bateau adverse', 'bataille-navale', '{"agg":"sum","stat":"lost_no_sink","threshold":1}'::jsonb, true, 189),
  ('bn_si_pres', 'amiral', 4, 'Si près du but', 'Perdre alors qu''il ne restait qu''un bateau adverse', 'bataille-navale', '{"agg":"sum","stat":"lost_close","threshold":1}'::jsonb, true, 190),
  ('bn_canonnier', 'amiral', 5, 'Le canonnier', '100 tirs touchés (cumul)', 'bataille-navale', '{"agg":"sum","stat":"hits","threshold":100}'::jsonb, true, 191),
  ('bn_guerre_d_usure', 'amiral', 6, 'Guerre d''usure', 'Gagner une manche de 120 tirs ou plus (au total)', 'bataille-navale', '{"agg":"sum","stat":"long_win","threshold":1}'::jsonb, true, 192),
  ('bn_parieur', 'amiral', 7, 'Le parieur', 'Gagner 10 paris en spectateur (cumul)', 'bataille-navale', '{"agg":"sum","stat":"bets_won","threshold":10}'::jsonb, true, 193),
  ('bn_premier_tir', 'amiral', 8, 'Du premier coup', 'Toucher dès son premier tir d''une manche, 3 fois (cumul)', 'bataille-navale', '{"agg":"sum","stat":"first_shot_hits","threshold":3}'::jsonb, true, 194),
  ('bn_rafale', 'amiral', 9, 'En rafale', '5 touchés d''affilée', 'bataille-navale', '{"agg":"max","stat":"best_hit_streak","threshold":5}'::jsonb, true, 195),
  ('bn_precision', 'amiral', 10, 'Tireur d''élite', 'Gagner une manche avec 40 % de tirs touchés ou plus', 'bataille-navale', '{"agg":"sum","stat":"precise_win","threshold":1}'::jsonb, true, 196),
  ('bn_eclair', 'amiral', 11, 'Guerre éclair', 'Gagner une manche en 40 tirs ou moins', 'bataille-navale', '{"agg":"sum","stat":"fast_win","threshold":1}'::jsonb, true, 197),
  ('bn_flotte_intacte', 'amiral', 12, 'Flotte intacte', 'Gagner une manche sans perdre un seul bateau', 'bataille-navale', '{"agg":"sum","stat":"intact_win","threshold":1}'::jsonb, true, 198),
  ('tdp_au_violon', 'magnat', 2, 'Habitué du violon', 'Aller 3 fois au violon en une partie', 'tour-des-potes', '{"agg":"max","stat":"jail","threshold":3}'::jsonb, true, 199),
  ('tdp_faillite', 'magnat', 3, 'Sur la paille', 'Faire faillite', 'tour-des-potes', '{"agg":"sum","stat":"bankrupt","threshold":1}'::jsonb, true, 200),
  ('tdp_pigeon', 'magnat', 4, 'Le pigeon', 'Payer 1 000 de loyers en une partie', 'tour-des-potes', '{"agg":"max","stat":"rent_paid","threshold":1000}'::jsonb, true, 201),
  ('tdp_acheteur', 'magnat', 5, 'Fièvre acheteuse', 'Acheter 30 lieux (cumul)', 'tour-des-potes', '{"agg":"sum","stat":"bought","threshold":30}'::jsonb, true, 202),
  ('tdp_globe_trotteur', 'magnat', 6, 'Globe-trotteur', 'Passer 30 fois par le Départ (cumul)', 'tour-des-potes', '{"agg":"sum","stat":"laps","threshold":30}'::jsonb, true, 203),
  ('tdp_tournee', 'magnat', 7, 'Ma tournée !', 'Ramasser 500 de cagnotte à la Pause apéro (cumul)', 'tour-des-potes', '{"agg":"sum","stat":"pot","threshold":500}'::jsonb, true, 204),
  ('tdp_rentier', 'magnat', 8, 'Le rentier', 'Encaisser 2 000 de loyers en une partie', 'tour-des-potes', '{"agg":"max","stat":"rent_received","threshold":2000}'::jsonb, true, 205),
  ('tdp_pioche', 'magnat', 9, 'Carte sur table', 'Piocher 5 cartes en une partie', 'tour-des-potes', '{"agg":"max","stat":"cards","threshold":5}'::jsonb, true, 206),
  ('tdp_hotelier', 'magnat', 10, 'L''hôtelier', 'Posséder un hôtel à la fin d''une partie', 'tour-des-potes', '{"agg":"sum","stat":"hotel","threshold":1}'::jsonb, true, 207),
  ('tdp_monopole', 'magnat', 11, 'Chasse gardée', 'Posséder 2 quartiers complets à la fin d''une partie', 'tour-des-potes', '{"agg":"sum","stat":"monopoly","threshold":1}'::jsonb, true, 208),
  ('tdp_tycoon', 'magnat', 12, 'Le tycoon', 'Gagner avec une fortune au moins 2 fois supérieure à celle du 2e (3 joueurs min.)', 'tour-des-potes', '{"agg":"sum","stat":"tycoon","threshold":1}'::jsonb, true, 209),
  ('dk_tete_a_queue', 'pilote', 2, 'Tête-à-queue', 'Se faire toucher 5 fois par une boule ou une glue (cumul)', 'dede-kart', '{"agg":"sum","stat":"hits_taken","threshold":5}'::jsonb, true, 210),
  ('dk_lanterne_rouge', 'pilote', 3, 'Lanterne rouge', 'Finir dernier d''une course (4 karts min.)', 'dede-kart', '{"agg":"sum","stat":"last_races","threshold":1}'::jsonb, true, 211),
  ('dk_panne', 'pilote', 4, 'En panne', 'Ne pas franchir la ligne avant la fin d''une course', 'dede-kart', '{"agg":"sum","stat":"dnf","threshold":1}'::jsonb, true, 212),
  ('dk_podium', 'pilote', 5, 'Sur le podium', '10 podiums (4 karts min., cumul)', 'dede-kart', '{"agg":"sum","stat":"podiums","threshold":10}'::jsonb, true, 213),
  ('dk_tireur', 'pilote', 6, 'Fine gâchette', 'Toucher 10 karts avec une boule ou une glue (cumul)', 'dede-kart', '{"agg":"sum","stat":"hits","threshold":10}'::jsonb, true, 214),
  ('dk_touriste', 'pilote', 7, 'Tour du monde', 'Gagner une course sur chacun des 3 circuits (cumul)', 'dede-kart', '{"agg":"all","rules":[{"agg":"sum","stat":"win_track_1","threshold":1},{"agg":"sum","stat":"win_track_2","threshold":1},{"agg":"sum","stat":"win_track_3","threshold":1}]}'::jsonb, true, 215),
  ('dk_coup_bas', 'pilote', 8, 'Coups bas', 'Utiliser au moins une fois le nuage, les confettis et le demi-tour (cumul)', 'dede-kart', '{"agg":"all","rules":[{"agg":"sum","stat":"used_cloud","threshold":1},{"agg":"sum","stat":"used_confetti","threshold":1},{"agg":"sum","stat":"used_reverse","threshold":1}]}'::jsonb, true, 216),
  ('dk_remontada', 'pilote', 9, 'Remontada', 'En coupe, gagner une course après avoir fini hors du podium à la précédente', 'dede-kart', '{"agg":"sum","stat":"comeback","threshold":1}'::jsonb, true, 217),
  ('dk_sniper', 'pilote', 10, 'Sniper', '5 touches réussies en une coupe', 'dede-kart', '{"agg":"max","stat":"hits","threshold":5}'::jsonb, true, 218),
  ('dk_echappee', 'pilote', 11, 'L''échappée', 'Gagner une course avec 5 s d''avance ou plus sur le 2e', 'dede-kart', '{"agg":"sum","stat":"big_lead","threshold":1}'::jsonb, true, 219),
  ('dk_grand_chelem', 'pilote', 12, 'Grand chelem', 'Gagner les 3 courses d''une coupe (4 karts min.)', 'dede-kart', '{"agg":"sum","stat":"grand_slam","threshold":1}'::jsonb, true, 220),
  ('gen_touche_a_tout', null, null, 'Touche-à-tout', 'Jouer à 10 jeux différents', null, '{"agg":"special","name":"distinct_games","threshold":10}'::jsonb, true, 221),
  ('gen_polyvalent', null, null, 'Polyvalent', 'Gagner dans 5 jeux différents', null, '{"agg":"special","name":"distinct_win_games","threshold":5}'::jsonb, true, 222),
  ('gen_pilier', null, null, 'Pilier de soirée', 'Participer à 20 soirées', null, '{"agg":"special","name":"soirees","threshold":20}'::jsonb, true, 223),
  ('gen_noctambule', null, null, 'Noctambule', 'Finir 3 soirées après 2 h du matin', null, '{"agg":"special","name":"late_soirees","threshold":3}'::jsonb, true, 224),
  ('gen_marathon', null, null, 'Marathonien', 'Jouer 8 parties dans une même soirée', null, '{"agg":"special","name":"games_in_soiree","threshold":8}'::jsonb, true, 225),
  ('gen_hote', null, null, 'Hôte de la maison', 'Organiser 5 soirées menées à leur terme', null, '{"agg":"special","name":"hosted","threshold":5}'::jsonb, true, 226),
  ('gen_grande_tablee', null, null, 'Grande tablée', 'Participer à une soirée de 6 joueurs ou plus', null, '{"agg":"special","name":"biggest_table","threshold":6}'::jsonb, true, 227),
  ('gen_pipelette', null, null, 'Pipelette', 'Envoyer 50 stickers dans le chat', null, '{"agg":"special","name":"stickers","threshold":50}'::jsonb, true, 228),
  ('gen_garde_robe', null, null, 'Garde-robe', 'Débloquer 5 tenues', null, '{"agg":"special","name":"tenues","threshold":5}'::jsonb, true, 229),
  ('gen_collectionneur', null, null, 'Collectionneur', 'Compléter une planche de tenue (les 11 trophées)', null, '{"agg":"special","name":"full_board","threshold":11}'::jsonb, true, 230)
on conflict (id) do update
  set tenue_id = excluded.tenue_id, slot = excluded.slot, name = excluded.name, description = excluded.description,
      game_id = excluded.game_id, rule = excluded.rule, active = excluded.active, sort_order = excluded.sort_order;

-- ---- Grants ----------------------------------------------------------------------

revoke all on function public._tr_val(public.match_players, text) from public, anon, authenticated;
revoke all on function public._tr_ok(public.match_players, jsonb) from public, anon, authenticated;
revoke all on function public._tr_target(jsonb) from public, anon, authenticated;
revoke all on function public.evaluate_trophy(uuid, text) from public, anon, authenticated;
revoke all on function public._tr_progress(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.evaluate_trophies(uuid, text) from public, anon, authenticated;
revoke all on function public._after_finish_trophies(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public._tenue_slot_ok(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.my_trophy_progress(text) from public, anon;
grant execute on function public.my_trophy_progress(text) to authenticated;


-- ===== games\action-ou-verite.sql =====
-- =============================================================================
-- JEU « action-ou-verite » (Action ou vérité multi-écrans) — idempotent.
-- Dépend de schema.sql (game_action, start_match, finish_match).
--
-- Un tour :
--   1. choose  : la ROUE (animation front, tirage serveur) désigne `target` ;
--                il choisit {"type":"choose","kind":"action"|"verite"}.
--                Échéance (`deadline` = fin de roue + 15 s) → choix aléatoire.
--   2. vote    : les AUTRES joueurs reçoivent 3 `proposals` du type choisi (tirées
--                dans le lot passé à start_match, sans répétition dans la partie)
--                et votent {"type":"vote_card","index":0..2}. Votes secrets
--                (`server.card_votes`) ; public : `voted`. Dépouillement quand tous
--                ont voté ou à l'échéance (30 s). Égalité → tirage parmi les
--                ex-aequo ; aucun vote → tirage parmi les 3.
--   3. perform : `card` (gagnante) publique, `card_vote` = détail du dépouillement.
--                Le désigné la réalise (`timer_until` = minuteur doux de 60 s pour
--                une action si soft_timer, jamais imposé). Les autres jugent
--                {"type":"vote_result","success":true|false} (secret jusqu'au
--                dépouillement, public : `validated`). Majorité stricte de 👍
--                (up > down) → +1 point. Le désigné peut {"type":"refuse"} →
--                gage tiré au sort, 0 point. Échéance dure 150 s.
--   4. result  : `last_result`. {"type":"next"} (hôte) → tour suivant ou fin ;
--                si `auto`, échéance 12 s puis tick.
-- {"type":"next"} (hôte) fait aussi avancer les autres phases (choose → type
-- aléatoire, vote/perform → dépouillement avec les votes reçus).
-- {"type":"stop"} (hôte, toute phase) → fin de partie avec les scores actuels
-- (le tour en cours est abandonné). Indispensable si total_rounds = 0 (illimité).
-- {"type":"tick"} : n'importe qui, ignoré sans erreur avant l'échéance.
--
-- Roue : on ne désigne jamais le même joueur 2 fois de suite, et on tire parmi
-- les joueurs qui ont eu le MOINS de passages (`turns`).
-- Gagnant(s) = max de points (ex-aequo), personne si tout le monde a 0.
-- =============================================================================

-- Constantes (secondes).
create or replace function public._aov_const(p_key text)
returns integer language sql immutable
set search_path = public, extensions
as $$
  select case p_key
    when 'spin' then 6        -- durée de l'animation de roue
    when 'choose' then 15     -- temps pour choisir action/vérité (après la roue)
    when 'vote' then 30       -- vote des propositions
    when 'perform' then 150   -- réalisation + jugement (échéance dure)
    when 'soft' then 60       -- minuteur doux d'une action
    when 'reveal' then 4      -- animation de révélation de la carte (avant le minuteur doux)
    when 'auto' then 12       -- passage automatique au tour suivant
  end
$$;

-- Incrémente stats[pl][key].
create or replace function public._aov_bump(p_stats jsonb, p_pl text, p_key text, p_n integer default 1)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select jsonb_set(p_stats, array[p_pl, p_key],
                   to_jsonb(coalesce((p_stats->p_pl->>p_key)::integer, 0) + p_n), true)
$$;

-- Joueurs votants du tour (tous sauf le désigné), dans l'ordre des joueurs.
create or replace function public._aov_voters(p_state jsonb)
returns text[] language sql immutable
set search_path = public, extensions
as $$
  select coalesce(array_agg(pl order by o), '{}')
    from jsonb_array_elements_text(p_state->'players') with ordinality as t(pl, o)
   where pl is distinct from p_state->>'target'
$$;

-- Ouvre le tour p_round : tirage du désigné (roue), phase choose.
create or replace function public._aov_open_round(p_state jsonb, p_server jsonb, p_round integer)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_last   text := p_server->>'last_target';
  v_n      integer := jsonb_array_length(p_state->'players');
  v_target text;
  v_until  timestamptz := now() + make_interval(secs => public._aov_const('spin'));
begin
  with t as (
    select pl, coalesce((p_state->'turns'->>pl)::integer, 0) as n
      from jsonb_array_elements_text(p_state->'players') pl
     where v_n < 2 or pl is distinct from v_last
  )
  select pl into v_target from t where n = (select min(n) from t) order by random() limit 1;

  p_state := p_state || jsonb_build_object(
    'phase', 'choose',
    'round', p_round,
    'target', v_target,
    'kind', null,
    'kind_random', false,
    'spin', jsonb_build_object(
        'round', p_round,
        'target', v_target,
        'turns', 4 + floor(random() * 3)::integer,       -- tours complets (4 à 6)
        'offset', round((0.18 + random() * 0.64)::numeric, 3), -- position dans la part (0..1)
        'until', v_until),
    'deadline', v_until + make_interval(secs => public._aov_const('choose')),
    'timer_until', null,
    'proposals', '[]'::jsonb,
    'voted', '[]'::jsonb,
    'card', null,
    'card_vote', null,
    'validated', '[]'::jsonb,
    'turns', jsonb_set(p_state->'turns', array[v_target],
                       to_jsonb(coalesce((p_state->'turns'->>v_target)::integer, 0) + 1), true),
    'stats', public._aov_bump(p_state->'stats', v_target, 'turns'));
  p_server := p_server || jsonb_build_object('last_target', v_target,
                                             'card_votes', '{}'::jsonb, 'result_votes', '{}'::jsonb);
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Type choisi (ou tiré au sort) : 3 propositions, phase vote.
create or replace function public._aov_set_kind(p_state jsonb, p_server jsonb, p_kind text, p_random boolean)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_used  jsonb := coalesce(p_server->'used', '[]'::jsonb);
  v_props jsonb;
  v_t     text := p_state->>'target';
begin
  -- Priorité aux cartes jamais proposées dans la partie ; on recycle si le lot est épuisé.
  select coalesce(jsonb_agg(c), '[]'::jsonb) into v_props
    from (select c from jsonb_array_elements(p_server->'pool') c
           where c->>'kind' = p_kind
           order by (v_used ? (c->>'id')), random()
           limit 3) x;

  select coalesce(jsonb_agg(distinct u), '[]'::jsonb) into v_used
    from (select jsonb_array_elements_text(v_used) u
          union select e->>'id' from jsonb_array_elements(v_props) e) z;

  p_state := p_state || jsonb_build_object(
    'phase', 'vote',
    'kind', p_kind,
    'kind_random', p_random,
    'proposals', v_props,
    'voted', '[]'::jsonb,
    'deadline', now() + make_interval(secs => public._aov_const('vote')),
    'stats', public._aov_bump(p_state->'stats', v_t,
                              case p_kind when 'action' then 'actions' else 'verites' end));
  p_server := p_server || jsonb_build_object('used', v_used, 'card_votes', '{}'::jsonb);
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Dépouillement des votes de cartes : carte gagnante, phase perform.
create or replace function public._aov_tally_cards(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_votes  jsonb := coalesce(p_server->'card_votes', '{}'::jsonb);
  v_n      integer := jsonb_array_length(p_state->'proposals');
  v_counts jsonb;
  v_max    integer;
  v_tied   jsonb;
  v_win    integer;
  v_soft   boolean := coalesce((p_state->>'soft_timer')::boolean, true);
begin
  select jsonb_agg((select count(*) from jsonb_each_text(v_votes) where value::integer = i)::integer order by i)
    into v_counts from generate_series(0, v_n - 1) i;
  v_counts := coalesce(v_counts, '[]'::jsonb);
  select max(value::integer) into v_max from jsonb_array_elements_text(v_counts);
  select jsonb_agg((o - 1)::integer order by o) into v_tied
    from jsonb_array_elements_text(v_counts) with ordinality t(value, o) where value::integer = v_max;
  select value::integer into v_win from jsonb_array_elements_text(v_tied) order by random() limit 1;

  p_state := p_state || jsonb_build_object(
    'phase', 'perform',
    'card', (p_state->'proposals'->v_win) || jsonb_build_object('kind', p_state->>'kind'),
    'card_vote', jsonb_build_object(
        'votes', v_votes,
        'counts', v_counts,
        'winner', v_win,
        'tied', case when jsonb_array_length(v_tied) > 1 then v_tied else '[]'::jsonb end,
        'random', jsonb_array_length(v_tied) > 1),
    'validated', '[]'::jsonb,
    'deadline', now() + make_interval(secs => public._aov_const('perform')),
    'timer_until', case when v_soft and p_state->>'kind' = 'action'
                        then to_jsonb(now() + make_interval(secs => public._aov_const('reveal') + public._aov_const('soft')))
                        else 'null'::jsonb end);
  p_server := p_server || jsonb_build_object('result_votes', '{}'::jsonb);
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Fin du tour : outcome 'success' | 'fail' | 'refused', phase result.
create or replace function public._aov_close_round(p_state jsonb, p_server jsonb, p_refused boolean)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_votes   jsonb := case when p_refused then '{}'::jsonb else coalesce(p_server->'result_votes', '{}'::jsonb) end;
  v_t       text := p_state->>'target';
  v_up      integer;
  v_down    integer;
  v_outcome text;
  v_points  integer := 0;
  v_gage    text;
  v_stats   jsonb := p_state->'stats';
  v_auto    boolean := coalesce((p_state->>'auto')::boolean, false);
  r         record;
begin
  select count(*) filter (where value = 'true'), count(*) filter (where value = 'false')
    into v_up, v_down from jsonb_each_text(v_votes);

  if p_refused then
    v_outcome := 'refused';
    select g into v_gage from jsonb_array_elements_text(coalesce(p_server->'gages', '[]'::jsonb)) g
     order by random() limit 1;
    v_gage := coalesce(v_gage, 'Fais ta plus belle révérence en disant « Pardon, ô grand public ! »');
    v_stats := public._aov_bump(v_stats, v_t, 'refusals');
  elsif v_up > v_down then
    v_outcome := 'success';
    v_points := 1;
    v_stats := public._aov_bump(v_stats, v_t, 'success');
    -- Ovation : défi réussi à l'unanimité (3 votants min.) ; Même pas peur : carte de niveau 3 réussie
    if v_down = 0 and v_up >= 3 then v_stats := public._aov_bump(v_stats, v_t, 'unanimous'); end if;
    if p_state->'card'->>'level' = '3' then v_stats := public._aov_bump(v_stats, v_t, 'hard_success'); end if;
  else
    v_outcome := 'fail';
    v_stats := public._aov_bump(v_stats, v_t, 'fails');
  end if;

  for r in select key, value from jsonb_each_text(v_votes) loop
    v_stats := public._aov_bump(v_stats, r.key, case when r.value = 'true' then 'thumbs_up' else 'thumbs_down' end);
  end loop;

  p_state := p_state || jsonb_build_object(
    'phase', 'result',
    'deadline', case when v_auto then to_jsonb(now() + make_interval(secs => public._aov_const('auto'))) else 'null'::jsonb end,
    'timer_until', null,
    'scores', jsonb_set(p_state->'scores', array[v_t],
                        to_jsonb(coalesce((p_state->'scores'->>v_t)::integer, 0) + v_points), true),
    'stats', v_stats,
    'last_result', jsonb_build_object(
        'round', p_state->'round',
        'target', v_t,
        'kind', p_state->'kind',
        'card', p_state->'card',
        'outcome', v_outcome,
        'up', v_up, 'down', v_down,
        'votes', v_votes,
        'gage', v_gage,
        'points', v_points),
    'history', coalesce(p_state->'history', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'round', p_state->'round', 'target', v_t, 'kind', p_state->'kind',
        'text', p_state->'card'->>'text', 'outcome', v_outcome, 'gage', v_gage)));
  p_server := p_server || jsonb_build_object('result_votes', '{}'::jsonb, 'card_votes', '{}'::jsonb);
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Stats de fin de partie pour les trophées (features/trophees.sql) : s'ajoutent à state.stats[pl].
create or replace function public._aov_tstats(p_stats jsonb)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select jsonb_build_object('perfect',
    case when coalesce((p_stats->>'turns')::integer, 0) >= 5
          and coalesce((p_stats->>'success')::integer, 0) = coalesce((p_stats->>'turns')::integer, 0) then 1 else 0 end)
$$;

create or replace function public._aov_finish(p_state jsonb, p_server jsonb)
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
           'stats', coalesce(p_state->'stats'->t.key, '{}'::jsonb) || public._aov_tstats(p_state->'stats'->t.key))
         order by t.r, t.key)
    into v_results
    from (select key, value, rank() over (order by value::integer desc) as r
            from jsonb_each_text(p_state->'scores')) t;

  select coalesce(jsonb_agg(key order by key), '[]'::jsonb) into v_winners
    from jsonb_each_text(p_state->'scores') where v_max > 0 and value::integer = v_max;

  p_state := p_state || jsonb_build_object('phase', 'finished', 'deadline', null, 'timer_until', null,
                                           'winners', v_winners, 'results', v_results);
  return jsonb_build_object('state', p_state, 'server', p_server, 'results', v_results);
end $$;

create or replace function public.game_action_ou_verite_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_cards  jsonb := p_options->'cards';
  v_levels jsonb;
  v_rounds integer;
  v_gages  jsonb;
  v_zero   jsonb;
  v_stats  jsonb;
  v_state  jsonb;
  v_server jsonb;
begin
  if cardinality(p_players) < 3 then raise exception 'not_enough_players'; end if;
  if cardinality(p_players) > 9 then raise exception 'too_many_players'; end if;
  if v_cards is null or jsonb_typeof(v_cards) <> 'array' or jsonb_array_length(v_cards) = 0 then
    raise exception 'not_enough_cards';
  end if;
  if jsonb_array_length(v_cards) > 1000 or exists (
       select 1 from jsonb_array_elements(v_cards) e
        where jsonb_typeof(e) <> 'object'
           or (e->>'kind') is null or (e->>'kind') not in ('action', 'verite')
           or jsonb_typeof(e->'text') is distinct from 'string'
           or char_length(btrim(e->>'text')) = 0 or char_length(e->>'text') > 400
           or (e ? 'level' and (jsonb_typeof(e->'level') <> 'number' or (e->>'level') not in ('1', '2', '3')))) then
    raise exception 'invalid_cards';
  end if;

  -- Niveaux (1 soft, 2 fun, 3 osé tout public) ; vide / invalide = tous.
  select coalesce(jsonb_agg(distinct (x::integer) order by (x::integer)), '[]'::jsonb) into v_levels
    from jsonb_array_elements_text(case when jsonb_typeof(p_options->'levels') = 'array'
                                        then p_options->'levels' else '[]'::jsonb end) x
   where x in ('1', '2', '3');
  if jsonb_array_length(v_levels) = 0 then v_levels := '[1,2,3]'::jsonb; end if;

  -- Lot normalisé, filtré sur les niveaux.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', left(coalesce(nullif(e->>'id', ''), 'c' || o), 40),
           'kind', e->>'kind',
           'level', coalesce((e->>'level')::integer, 1),
           'text', btrim(e->>'text')) order by o), '[]'::jsonb)
    into v_cards
    from jsonb_array_elements(v_cards) with ordinality as t(e, o)
   where v_levels @> to_jsonb(coalesce((e->>'level')::integer, 1));
  if (select count(*) from jsonb_array_elements(v_cards) c where c->>'kind' = 'action') < 3
     or (select count(*) from jsonb_array_elements(v_cards) c where c->>'kind' = 'verite') < 3 then
    raise exception 'not_enough_cards';
  end if;

  -- Tours : 0 = illimité (jusqu'à ce que l'hôte arrête).
  begin
    v_rounds := coalesce(nullif(p_options->>'rounds', '')::integer, 10);
  exception when others then v_rounds := 10;
  end;
  v_rounds := least(greatest(v_rounds, 0), 100);

  select coalesce(jsonb_agg(left(btrim(g), 200)), '[]'::jsonb) into v_gages
    from jsonb_array_elements_text(case when jsonb_typeof(p_options->'gages') = 'array'
                                        then p_options->'gages' else '[]'::jsonb end) g
   where char_length(btrim(g)) > 0;

  select jsonb_object_agg(p::text, 0),
         jsonb_object_agg(p::text, jsonb_build_object('turns', 0, 'actions', 0, 'verites', 0, 'success', 0,
                                                      'fails', 0, 'refusals', 0, 'thumbs_up', 0, 'thumbs_down', 0))
    into v_zero, v_stats
    from unnest(p_players) p;

  v_state := jsonb_build_object(
    'game', 'action-ou-verite',
    'phase', 'choose',
    'round', 1,
    'total_rounds', v_rounds,
    'levels', v_levels,
    'soft_timer', coalesce(p_options->'soft_timer', 'true'::jsonb) <> 'false'::jsonb,
    'auto', coalesce(p_options->'auto', 'false'::jsonb) = 'true'::jsonb,
    'players', to_jsonb(p_players),
    'turns', v_zero,
    'scores', v_zero,
    'stats', v_stats,
    'last_result', null,
    'history', '[]'::jsonb,
    'winners', null,
    'results', null);
  v_server := jsonb_build_object('pool', v_cards, 'used', '[]'::jsonb, 'gages', v_gages,
                                 'last_target', null, 'card_votes', '{}'::jsonb, 'result_votes', '{}'::jsonb);

  return public._aov_open_round(v_state, v_server, 1) || jsonb_build_object('secrets', '{}'::jsonb);
end $$;

-- Fait avancer la phase en cours (échéance atteinte ou hôte).
create or replace function public._aov_advance(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_phase text := p_state->>'phase';
  v_round integer := (p_state->>'round')::integer;
  v_total integer := coalesce((p_state->>'total_rounds')::integer, 0);
begin
  if v_phase = 'choose' then
    return public._aov_set_kind(p_state, p_server, case when random() < 0.5 then 'action' else 'verite' end, true);
  elsif v_phase = 'vote' then
    return public._aov_tally_cards(p_state, p_server);
  elsif v_phase = 'perform' then
    return public._aov_close_round(p_state, p_server, false);
  elsif v_phase = 'result' then
    if v_total > 0 and v_round >= v_total then
      return public._aov_finish(p_state, p_server);
    end if;
    return public._aov_open_round(p_state, p_server, v_round + 1);
  end if;
  raise exception 'wrong_phase';
end $$;

create or replace function public.game_action_ou_verite_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_type     text := p_action->>'type';
  v_phase    text := p_state->>'phase';
  v_me       text := p_actor::text;
  v_target   text := p_state->>'target';
  v_deadline timestamptz := nullif(p_state->>'deadline', '')::timestamptz;
  v_voters   text[] := public._aov_voters(p_state);
  v_idx      integer;
  v_done     jsonb;
begin
  if v_type = 'tick' then
    if v_phase not in ('choose', 'vote', 'perform', 'result') or v_deadline is null or now() < v_deadline then
      return jsonb_build_object('state', p_state, 'server', p_server);
    end if;
    return public._aov_advance(p_state, p_server);

  elsif v_type = 'choose' then
    if v_phase <> 'choose' then raise exception 'wrong_phase'; end if;
    if v_me is distinct from v_target then raise exception 'not_your_turn'; end if;
    if jsonb_typeof(p_action->'kind') is distinct from 'string' or (p_action->>'kind') not in ('action', 'verite') then
      raise exception 'invalid_choice';
    end if;
    return public._aov_set_kind(p_state, p_server, p_action->>'kind', false);

  elsif v_type = 'vote_card' then
    if v_phase <> 'vote' then raise exception 'wrong_phase'; end if;
    if not (p_state->'players' ? v_me) then raise exception 'not_a_player'; end if;
    if v_me = v_target then raise exception 'target_cannot_vote'; end if;
    if jsonb_typeof(p_action->'index') is distinct from 'number' then raise exception 'invalid_choice'; end if;
    begin
      v_idx := (p_action->>'index')::integer;
    exception when others then raise exception 'invalid_choice';
    end;
    if v_idx < 0 or v_idx >= jsonb_array_length(p_state->'proposals') then raise exception 'invalid_choice'; end if;

    p_server := jsonb_set(p_server, array['card_votes', v_me], to_jsonb(v_idx), true);
    select coalesce(jsonb_agg(v order by array_position(v_voters, v)), '[]'::jsonb) into v_done
      from unnest(v_voters) v where (p_server->'card_votes') ? v;
    p_state := jsonb_set(p_state, '{voted}', v_done);
    if jsonb_array_length(v_done) >= cardinality(v_voters)
       or (v_deadline is not null and now() >= v_deadline) then
      return public._aov_tally_cards(p_state, p_server);
    end if;
    return jsonb_build_object('state', p_state, 'server', p_server);

  elsif v_type = 'vote_result' then
    if v_phase <> 'perform' then raise exception 'wrong_phase'; end if;
    if not (p_state->'players' ? v_me) then raise exception 'not_a_player'; end if;
    if v_me = v_target then raise exception 'target_cannot_vote'; end if;
    if jsonb_typeof(p_action->'success') is distinct from 'boolean' then raise exception 'invalid_choice'; end if;

    p_server := jsonb_set(p_server, array['result_votes', v_me], p_action->'success', true);
    select coalesce(jsonb_agg(v order by array_position(v_voters, v)), '[]'::jsonb) into v_done
      from unnest(v_voters) v where (p_server->'result_votes') ? v;
    p_state := jsonb_set(p_state, '{validated}', v_done);
    if jsonb_array_length(v_done) >= cardinality(v_voters)
       or (v_deadline is not null and now() >= v_deadline) then
      return public._aov_close_round(p_state, p_server, false);
    end if;
    return jsonb_build_object('state', p_state, 'server', p_server);

  elsif v_type = 'refuse' then
    if v_phase <> 'perform' then raise exception 'wrong_phase'; end if;
    if v_me is distinct from v_target then raise exception 'not_your_turn'; end if;
    return public._aov_close_round(p_state, p_server, true);

  elsif v_type = 'next' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase not in ('choose', 'vote', 'perform', 'result') then raise exception 'wrong_phase'; end if;
    -- Garde-fou double clic : next depuis result exige le bon numéro de tour s'il est fourni.
    if p_action ? 'round' and (p_action->>'round') is distinct from (p_state->>'round') then
      raise exception 'wrong_phase';
    end if;
    return public._aov_advance(p_state, p_server);

  elsif v_type = 'stop' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase not in ('choose', 'vote', 'perform', 'result') then raise exception 'wrong_phase'; end if;
    return public._aov_finish(p_state, p_server);

  else
    raise exception 'unknown_action';
  end if;
end $$;

revoke all on function public._aov_const(text) from public, anon, authenticated;
revoke all on function public._aov_bump(jsonb, text, text, integer) from public, anon, authenticated;
revoke all on function public._aov_voters(jsonb) from public, anon, authenticated;
revoke all on function public._aov_open_round(jsonb, jsonb, integer) from public, anon, authenticated;
revoke all on function public._aov_set_kind(jsonb, jsonb, text, boolean) from public, anon, authenticated;
revoke all on function public._aov_tally_cards(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._aov_close_round(jsonb, jsonb, boolean) from public, anon, authenticated;
revoke all on function public._aov_finish(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._aov_tstats(jsonb) from public, anon, authenticated;
revoke all on function public._aov_advance(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.game_action_ou_verite_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_action_ou_verite_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;


-- ===== games\bataille-navale.sql =====
-- =============================================================================
-- JEU « Bataille navale » (id bataille-navale) — jeu en DUEL (socle
-- supabase/features/duel.sql) avec PRÉPARATION SIMULTANÉE (hook board_setup).
-- Règles traditionnelles :
--  * grille 10 × 10 : colonnes A–J (x = 0..9), lignes 1–10 (y = 0..9) ;
--  * flotte classique : porte-avions 5, cuirassé 4, croiseur 3, sous-marin 3,
--    torpilleur 2 (17 cases) ;
--  * préparation 60 s, en même temps pour les deux duellistes : une flotte
--    tirée au hasard est proposée d'office (bateaux SANS CONTACT, même en
--    diagonale) ; chacun peut mélanger ou placer à la main (contact AUTORISÉ,
--    chevauchement interdit), puis « Prêt ! ». À l'échéance, la flotte
--    courante est validée (au hasard si elle manque) ;
--  * un tir par tour : « touché » ou « coulé » -> le tireur rejoue ; « à
--    l'eau » -> tour adverse. Toute la flotte adverse coulée = manche gagnée
--    (pas de nul possible). 30 s par tir (socle) ; à l'échéance, tir auto au
--    hasard, en mode « chasse » autour des touchés non coulés.
--
-- Bateau : {"id": "porte-avions"|"cuirasse"|"croiseur"|"sous-marin"|"torpilleur",
--           "x": 0..9, "y": 0..9, "dir": "h"|"v"}
--   (x, y) = première case (gauche / haut) ; h = vers la droite, v = vers le bas.
-- Flotte = tableau des 5 bateaux, chacun une fois (ordre libre en entrée,
-- normalisé dans l'ordre de la composition).
--
-- Plateau PUBLIC (state.board) — jamais aucune case de bateau non coulé :
--   {"size": 10, "a": uid, "b": uid, "duel_no": n, "game_no": n,
--    "ships":  [{"id", "name", "size"}],                 -- composition (ordre d'affichage)
--    "waters": {"<uid>": {"shots": [{"x", "y", "r": "miss|hit|sunk"}],  -- tirs REÇUS par uid, dans l'ordre
--                         "sunk":  [bateau],             -- bateaux de uid coulés (révélés)
--                         "left":  5}},                  -- bateaux de uid encore à flot
--    "stats":  {"<uid>": {"shots", "hits", "streak", "best"}},  -- tirs TIRÉS par uid ; série de touchés
--    "count":  n,                                        -- tirs de la manche
--    "last":   {"by", "x", "y", "r", "ship": id|null} | null,   -- ship renseigné seulement si coulé
--    "reveal": {"<uid>": flotte} | null}                 -- fin de manche : les deux flottes révélées
--   r = "sunk" pour toutes les cases d'un bateau coulé (les tirs « hit » passent à « sunk »).
-- Server (match_server_state, privé) : {"fleets": {"<uid>": flotte}}.
-- Secret de chaque duelliste (match_secrets, upsert à chaque changement) :
--   {"duel_no", "game_no", "me", "fleet": flotte, "received": [tirs reçus = waters[me].shots]}.
-- Coups : préparation {"type":"place","ships":[bateau x5]} | {"type":"shuffle"} ;
--         bataille {"x": 0..9, "y": 0..9} (exactement ces deux clés, sinon invalid_move :
--         le socle recopie le coup dans duel.last_move, public).
-- Erreurs : invalid_fleet, fleet_overlap, setup_incomplete, already_shot, invalid_move.
-- =============================================================================

-- Composition de la flotte (ordre d'affichage et de placement).
create or replace function public._bn_ships()
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select '[{"id": "porte-avions", "name": "Porte-avions", "size": 5},
           {"id": "cuirasse",     "name": "Cuirassé",     "size": 4},
           {"id": "croiseur",     "name": "Croiseur",     "size": 3},
           {"id": "sous-marin",   "name": "Sous-marin",   "size": 3},
           {"id": "torpilleur",   "name": "Torpilleur",   "size": 2}]'::jsonb;
$$;

-- Cases (indices y * 10 + x) d'un bateau ; null si malformé ou hors de la grille.
create or replace function public._bn_cells(p_ship jsonb)
returns integer[] language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_size integer;
  v_x    integer;
  v_y    integer;
begin
  if jsonb_typeof(p_ship) is distinct from 'object' then return null; end if;
  select (e->>'size')::integer into v_size
    from jsonb_array_elements(public._bn_ships()) as e where e->>'id' = p_ship->>'id';
  if v_size is null
     or jsonb_typeof(p_ship->'x') is distinct from 'number' or jsonb_typeof(p_ship->'y') is distinct from 'number'
     or p_ship->>'x' !~ '^[0-9]$' or p_ship->>'y' !~ '^[0-9]$' then
    return null;
  end if;
  v_x := (p_ship->>'x')::integer;
  v_y := (p_ship->>'y')::integer;
  if p_ship->>'dir' = 'h' and v_x + v_size <= 10 then
    return array(select v_y * 10 + v_x + k from generate_series(0, v_size - 1) as k order by k);
  elsif p_ship->>'dir' = 'v' and v_y + v_size <= 10 then
    return array(select (v_y + k) * 10 + v_x from generate_series(0, v_size - 1) as k order by k);
  end if;
  return null;
end $$;

-- Erreur d'une flotte (null si valide) : 5 bateaux, chacun une fois, dans la
-- grille ('invalid_fleet'), sans chevauchement ('fleet_overlap'). Le contact
-- (même en diagonale) est autorisé en placement manuel.
create or replace function public._bn_fleet_error(p_fleet jsonb)
returns text language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_def  jsonb;
  v_ship jsonb;
  v_n    integer;
  v_c    integer[];
  v_all  integer[] := '{}'::integer[];
  v_over boolean := false;
begin
  if jsonb_typeof(p_fleet) is distinct from 'array'
     or jsonb_array_length(p_fleet) <> jsonb_array_length(public._bn_ships()) then
    return 'invalid_fleet';
  end if;
  for v_def in select e from jsonb_array_elements(public._bn_ships()) as e loop
    select count(*)::integer, min(s::text)::jsonb into v_n, v_ship
      from jsonb_array_elements(p_fleet) as s
     where jsonb_typeof(s) = 'object' and s->>'id' = v_def->>'id';
    if v_n <> 1 then return 'invalid_fleet'; end if;
    v_c := public._bn_cells(v_ship);
    if v_c is null then return 'invalid_fleet'; end if;
    if v_all && v_c then v_over := true; end if;
    v_all := v_all || v_c;
  end loop;
  return case when v_over then 'fleet_overlap' end;
end $$;

-- Flotte (supposée valide) normalisée : ordre de la composition, {id, x, y, dir} seuls.
create or replace function public._bn_fleet_norm(p_fleet jsonb)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', d.e->>'id', 'x', (f.s->>'x')::integer,
                                               'y', (f.s->>'y')::integer, 'dir', f.s->>'dir') order by d.o),
                  '[]'::jsonb)
    from jsonb_array_elements(public._bn_ships()) with ordinality as d(e, o)
    cross join lateral (select x.s from jsonb_array_elements(p_fleet) as x(s)
                         where jsonb_typeof(x.s) = 'object' and x.s->>'id' = d.e->>'id' limit 1) as f;
$$;

-- Valide (lève invalid_fleet / fleet_overlap) et normalise une flotte.
create or replace function public._bn_fleet_check(p_fleet jsonb)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare v_err text := public._bn_fleet_error(p_fleet);
begin
  if v_err is not null then raise exception '%', v_err; end if;
  return public._bn_fleet_norm(p_fleet);
end $$;

-- Flotte tirée au hasard, bateaux SANS CONTACT (ni bord, ni coin) : du plus
-- grand au plus petit, chaque bateau prend une position libre au hasard parmi
-- toutes les positions possibles (cases du bateau + voisines bloquées ensuite).
create or replace function public._bn_fleet_random()
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_def   jsonb;
  v_size  integer;
  v_block boolean[];
  v_fleet jsonb;
  v_ship  jsonb;
  v_x     integer;
  v_y     integer;
  v_d     text;
  v_ok    boolean;
  v_try   integer;
  c       integer;
  dx      integer;
  dy      integer;
begin
  for v_try in 1 .. 100 loop
    v_block := array_fill(false, array[100]);
    v_fleet := '[]'::jsonb;
    v_ok := true;
    for v_def in select e from jsonb_array_elements(public._bn_ships()) as e loop
      v_size := (v_def->>'size')::integer;
      select g.gx, g.gy, g.gd into v_x, v_y, v_d
        from (select gx, gy, gd
                from generate_series(0, 9) as gx, generate_series(0, 9) as gy, unnest(array['h', 'v']) as gd) as g
       where (case when g.gd = 'h' then g.gx + v_size <= 10 else g.gy + v_size <= 10 end)
         and not exists (
           select 1 from generate_series(0, v_size - 1) as k
            where v_block[(g.gy + case when g.gd = 'v' then k else 0 end) * 10
                          + g.gx + case when g.gd = 'h' then k else 0 end + 1])
       order by random() limit 1;
      if not found then v_ok := false; exit; end if;
      v_ship := jsonb_build_object('id', v_def->>'id', 'x', v_x, 'y', v_y, 'dir', v_d);
      v_fleet := v_fleet || jsonb_build_array(v_ship);
      foreach c in array public._bn_cells(v_ship) loop
        for dx in -1 .. 1 loop
          for dy in -1 .. 1 loop
            if c % 10 + dx between 0 and 9 and c / 10 + dy between 0 and 9 then
              v_block[(c / 10 + dy) * 10 + c % 10 + dx + 1] := true;
            end if;
          end loop;
        end loop;
      end loop;
    end loop;
    if v_ok then return v_fleet; end if;
  end loop;
  raise exception 'invalid_board';  -- jamais en pratique (17 cases sur 100)
end $$;

-- Bateau de la flotte occupant la case p_cell (y * 10 + x), ou null.
create or replace function public._bn_ship_at(p_fleet jsonb, p_cell integer)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select s from jsonb_array_elements(case when jsonb_typeof(p_fleet) = 'array' then p_fleet else '[]'::jsonb end) as s
   where p_cell = any(public._bn_cells(s)) limit 1;
$$;

-- Secret d'un duelliste : sa flotte + les tirs reçus (copie de waters[me].shots).
create or replace function public._bn_secret(p_board jsonb, p_me text, p_fleet jsonb)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'duel_no', p_board->'duel_no', 'game_no', p_board->'game_no', 'me', p_me,
    'fleet', p_fleet,
    'received', coalesce(p_board->'waters'->p_me->'shots', '[]'::jsonb));
$$;

-- ---------------------------------------------------------------- hooks du socle

-- Nouvelle manche : flottes tirées au hasard (proposées d'office), préparation 60 s.
create or replace function public.game_bataille_navale_board_new(p_ctx jsonb, p_a text, p_b text)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_fa    jsonb := public._bn_fleet_random();
  v_fb    jsonb := public._bn_fleet_random();
  v_n     integer := jsonb_array_length(public._bn_ships());
  v_board jsonb;
begin
  v_board := jsonb_build_object(
    'size', 10, 'a', p_a, 'b', p_b,
    'duel_no', p_ctx->'duel_no', 'game_no', p_ctx->'game_no',
    'ships', public._bn_ships(),
    'waters', jsonb_build_object(
      p_a, jsonb_build_object('shots', '[]'::jsonb, 'sunk', '[]'::jsonb, 'left', v_n),
      p_b, jsonb_build_object('shots', '[]'::jsonb, 'sunk', '[]'::jsonb, 'left', v_n)),
    'stats', jsonb_build_object(
      p_a, jsonb_build_object('shots', 0, 'hits', 0, 'streak', 0, 'best', 0),
      p_b, jsonb_build_object('shots', 0, 'hits', 0, 'streak', 0, 'best', 0)),
    'count', 0, 'last', null, 'reveal', null);
  return jsonb_build_object(
    'board', v_board,
    'server', jsonb_build_object('fleets', jsonb_build_object(p_a, v_fa, p_b, v_fb)),
    'secrets', jsonb_build_object(p_a, public._bn_secret(v_board, p_a, v_fa),
                                  p_b, public._bn_secret(v_board, p_b, v_fb)),
    'setup_seconds', 60);
end $$;

-- Préparation simultanée. Coups clients : place (flotte complète, validée
-- strictement), shuffle (nouvelle flotte au hasard). Réservés au socle : ready
-- (valider), auto (échéance : la flotte courante est gardée, au hasard si
-- absente), begin (p_actor null : on fige les deux flottes et on renvoie les secrets).
create or replace function public.game_bataille_navale_board_setup(p_board jsonb, p_server jsonb, p_actor text, p_move jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_type    text := p_move->>'type';
  v_srv     jsonb := case when jsonb_typeof(p_server) = 'object' then p_server else '{}'::jsonb end;
  v_fleets  jsonb;
  v_fleet   jsonb;
  v_secrets jsonb := '{}'::jsonb;
  p         text;
begin
  v_fleets := case when jsonb_typeof(v_srv->'fleets') = 'object' then v_srv->'fleets' else '{}'::jsonb end;

  if v_type = 'begin' then
    if p_actor is not null then raise exception 'invalid_move'; end if;
    foreach p in array array[p_board->>'a', p_board->>'b'] loop
      v_fleet := v_fleets->p;
      if public._bn_fleet_error(v_fleet) is not null then v_fleet := public._bn_fleet_random(); end if;
      v_fleets := v_fleets || jsonb_build_object(p, v_fleet);
      v_secrets := v_secrets || jsonb_build_object(p, public._bn_secret(p_board, p, v_fleet));
    end loop;
    return jsonb_build_object('board', p_board, 'server', v_srv || jsonb_build_object('fleets', v_fleets),
                              'secrets', v_secrets);
  end if;

  if p_actor is null or p_actor not in (p_board->>'a', p_board->>'b') then raise exception 'not_duelist'; end if;
  v_fleet := v_fleets->p_actor;
  if v_type = 'place' then
    v_fleet := public._bn_fleet_check(p_move->'ships');
  elsif v_type = 'shuffle' then
    v_fleet := public._bn_fleet_random();
  elsif v_type = 'ready' then
    if public._bn_fleet_error(v_fleet) is not null then raise exception 'setup_incomplete'; end if;
    return jsonb_build_object('board', p_board);
  elsif v_type = 'auto' then
    if public._bn_fleet_error(v_fleet) is null then
      return jsonb_build_object('board', p_board);          -- flotte courante validée telle quelle
    end if;
    v_fleet := public._bn_fleet_random();
  else
    raise exception 'invalid_move';
  end if;
  return jsonb_build_object(
    'board', p_board,
    'server', v_srv || jsonb_build_object('fleets', v_fleets || jsonb_build_object(p_actor, v_fleet)),
    'secrets', jsonb_build_object(p_actor, public._bn_secret(p_board, p_actor, v_fleet)));
end $$;

-- Un tir {x, y} de p_actor sur la flotte adverse.
create or replace function public.game_bataille_navale_board_move(p_board jsonb, p_server jsonb, p_actor text, p_move jsonb)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_a      text := p_board->>'a';
  v_b      text := p_board->>'b';
  v_target text;
  v_x      integer;
  v_y      integer;
  v_cell   integer;
  v_w      jsonb;
  v_shots  jsonb;
  v_fleet  jsonb;
  v_ship   jsonb;
  v_cells  integer[];
  v_hits   integer;
  v_r      text;
  v_left   integer;
  v_st     jsonb;
  v_streak integer;
  v_sec    jsonb;
begin
  if p_actor is null or p_actor not in (v_a, v_b) then raise exception 'not_duelist'; end if;
  if jsonb_typeof(p_move) is distinct from 'object'
     or jsonb_typeof(p_move->'x') is distinct from 'number' or jsonb_typeof(p_move->'y') is distinct from 'number'
     or p_move->>'x' !~ '^[0-9]$' or p_move->>'y' !~ '^[0-9]$' then
    raise exception 'invalid_move';
  end if;
  -- Exactement {x, y} : le socle recopie le coup brut dans le state public
  -- (duel.last_move.move) ; aucune clé en plus ne doit pouvoir y entrer.
  if (select count(*) from jsonb_object_keys(p_move)) <> 2 then
    raise exception 'invalid_move';
  end if;
  v_x := (p_move->>'x')::integer;
  v_y := (p_move->>'y')::integer;
  v_cell := v_y * 10 + v_x;
  v_target := case when p_actor = v_a then v_b else v_a end;
  v_w := coalesce(p_board->'waters'->v_target, '{}'::jsonb);
  v_shots := coalesce(v_w->'shots', '[]'::jsonb);
  if exists (select 1 from jsonb_array_elements(v_shots) as e
              where (e->>'y')::integer * 10 + (e->>'x')::integer = v_cell) then
    raise exception 'already_shot';
  end if;
  v_fleet := p_server->'fleets'->v_target;
  if public._bn_fleet_error(v_fleet) is not null then raise exception 'invalid_board'; end if;

  v_ship := public._bn_ship_at(v_fleet, v_cell);
  if v_ship is null then
    v_r := 'miss';
    v_shots := v_shots || jsonb_build_array(jsonb_build_object('x', v_x, 'y', v_y, 'r', 'miss'));
  else
    v_cells := public._bn_cells(v_ship);
    select count(*)::integer + 1 into v_hits from jsonb_array_elements(v_shots) as e
     where (e->>'y')::integer * 10 + (e->>'x')::integer = any(v_cells);
    v_shots := v_shots || jsonb_build_array(jsonb_build_object('x', v_x, 'y', v_y, 'r', 'hit'));
    if v_hits >= cardinality(v_cells) then
      v_r := 'sunk';
      select jsonb_agg(case when (t.e->>'y')::integer * 10 + (t.e->>'x')::integer = any(v_cells)
                            then t.e || jsonb_build_object('r', 'sunk') else t.e end order by t.o)
        into v_shots from jsonb_array_elements(v_shots) with ordinality as t(e, o);
      v_w := v_w || jsonb_build_object('sunk', coalesce(v_w->'sunk', '[]'::jsonb) || jsonb_build_array(v_ship));
    else
      v_r := 'hit';
    end if;
  end if;
  v_left := jsonb_array_length(v_fleet) - jsonb_array_length(coalesce(v_w->'sunk', '[]'::jsonb));
  v_w := v_w || jsonb_build_object('shots', v_shots, 'left', v_left);

  -- Statistiques du tireur : tirs, touchés, série de touchés en cours / record.
  v_st := coalesce(p_board->'stats'->p_actor, '{}'::jsonb);
  v_streak := case when v_r = 'miss' then 0 else coalesce((v_st->>'streak')::integer, 0) + 1 end;
  v_st := v_st || jsonb_build_object(
    'shots', coalesce((v_st->>'shots')::integer, 0) + 1,
    'hits', coalesce((v_st->>'hits')::integer, 0) + case when v_r = 'miss' then 0 else 1 end,
    'streak', v_streak,
    'best', greatest(coalesce((v_st->>'best')::integer, 0), v_streak),
    -- trophées : série de tirs à l'eau (en cours / record) et 1er tir de la manche touché ?
    'mstreak', case when v_r = 'miss' then coalesce((v_st->>'mstreak')::integer, 0) + 1 else 0 end,
    'mbest', greatest(coalesce((v_st->>'mbest')::integer, 0),
                      case when v_r = 'miss' then coalesce((v_st->>'mstreak')::integer, 0) + 1 else 0 end),
    'fh', case when coalesce((v_st->>'shots')::integer, 0) = 0 then (v_r <> 'miss')::integer
               else coalesce((v_st->>'fh')::integer, 0) end);

  p_board := p_board || jsonb_build_object(
    'waters', coalesce(p_board->'waters', '{}'::jsonb) || jsonb_build_object(v_target, v_w),
    'stats', coalesce(p_board->'stats', '{}'::jsonb) || jsonb_build_object(p_actor, v_st),
    'count', coalesce((p_board->>'count')::integer, 0) + 1,
    'last', jsonb_build_object('by', p_actor, 'x', v_x, 'y', v_y, 'r', v_r,
                               'ship', case when v_r = 'sunk' then v_ship->'id' end));
  v_sec := jsonb_build_object(v_target, public._bn_secret(p_board, v_target, v_fleet));

  if v_left <= 0 then
    -- Toute la flotte adverse est coulée : manche gagnée, flottes révélées.
    p_board := p_board || jsonb_build_object('reveal', jsonb_build_object(
      v_a, p_server->'fleets'->v_a, v_b, p_server->'fleets'->v_b));
    -- 'game' : bilan de la manche pour les trophées, par joueur (socle duel : games[].x). Les stats de
    -- board sont remplacées à chaque manche, on les recopie donc ici dans l'historique de la session.
    return jsonb_build_object('board', p_board, 'secrets', v_sec, 'outcome', 'win', 'winner', p_actor,
      'game', jsonb_build_object('total', (p_board->>'count')::integer, 'p', jsonb_build_object(
        v_a, jsonb_build_object(
          'shots', coalesce((p_board->'stats'->v_a->>'shots')::integer, 0),
          'hits', coalesce((p_board->'stats'->v_a->>'hits')::integer, 0),
          'best', coalesce((p_board->'stats'->v_a->>'best')::integer, 0),
          'mbest', coalesce((p_board->'stats'->v_a->>'mbest')::integer, 0),
          'fh', coalesce((p_board->'stats'->v_a->>'fh')::integer, 0),
          'left', coalesce((p_board->'waters'->v_a->>'left')::integer, 5),
          'enemy_left', coalesce((p_board->'waters'->v_b->>'left')::integer, 5)),
        v_b, jsonb_build_object(
          'shots', coalesce((p_board->'stats'->v_b->>'shots')::integer, 0),
          'hits', coalesce((p_board->'stats'->v_b->>'hits')::integer, 0),
          'best', coalesce((p_board->'stats'->v_b->>'best')::integer, 0),
          'mbest', coalesce((p_board->'stats'->v_b->>'mbest')::integer, 0),
          'fh', coalesce((p_board->'stats'->v_b->>'fh')::integer, 0),
          'left', coalesce((p_board->'waters'->v_b->>'left')::integer, 5),
          'enemy_left', coalesce((p_board->'waters'->v_a->>'left')::integer, 5)))));
  elsif v_r = 'miss' then
    return jsonb_build_object('board', p_board, 'secrets', v_sec, 'outcome', null);   -- à l'eau : tour adverse
  end if;
  return jsonb_build_object('board', p_board, 'secrets', v_sec, 'outcome', null, 'turn', p_actor);  -- touché : rejoue
end $$;

-- Tir automatique (minuteur), d'après les seules informations PUBLIQUES :
-- 1. prolonger un alignement de touchés non coulés ; 2. sinon une case voisine
-- d'un touché non coulé (« chasse ») ; 3. sinon une case non visée au hasard.
create or replace function public.game_bataille_navale_board_auto(p_board jsonb, p_server jsonb, p_actor text)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_target text := case when p_actor = p_board->>'a' then p_board->>'b' else p_board->>'a' end;
  v_shot   boolean[] := array_fill(false, array[100]);
  v_hit    boolean[] := array_fill(false, array[100]);
  v_pick   integer;
  e        jsonb;
  i        integer;
begin
  for e in select s from jsonb_array_elements(coalesce(p_board->'waters'->v_target->'shots', '[]'::jsonb)) as s loop
    i := (e->>'y')::integer * 10 + (e->>'x')::integer;
    v_shot[i + 1] := true;
    if e->>'r' = 'hit' then v_hit[i + 1] := true; end if;
  end loop;

  select n.c into v_pick
    from (select (h / 10 + d.dy) * 10 + h % 10 + d.dx as c
            from generate_series(0, 99) as h, (values (1, 0), (-1, 0), (0, 1), (0, -1)) as d(dx, dy)
           where v_hit[h + 1]
             and h % 10 + d.dx between 0 and 9 and h / 10 + d.dy between 0 and 9
             and h % 10 - d.dx between 0 and 9 and h / 10 - d.dy between 0 and 9
             and v_hit[(h / 10 - d.dy) * 10 + h % 10 - d.dx + 1]) as n
   where not v_shot[n.c + 1]
   order by random() limit 1;

  if v_pick is null then
    select n.c into v_pick
      from (select (h / 10 + d.dy) * 10 + h % 10 + d.dx as c
              from generate_series(0, 99) as h, (values (1, 0), (-1, 0), (0, 1), (0, -1)) as d(dx, dy)
             where v_hit[h + 1]
               and h % 10 + d.dx between 0 and 9 and h / 10 + d.dy between 0 and 9) as n
     where not v_shot[n.c + 1]
     order by random() limit 1;
  end if;

  if v_pick is null then
    select c into v_pick from generate_series(0, 99) as c where not v_shot[c + 1] order by random() limit 1;
  end if;

  if v_pick is null then return null; end if;   -- impossible : la manche serait finie
  return jsonb_build_object('x', v_pick % 10, 'y', v_pick / 10);
end $$;

-- ---------------------------------------------------------------- moteur (délégation au socle)

-- Hook de trophées du socle duel (features/duel.sql, _duel_tstats) : tout vient des bilans de manche
-- (games[].x.p[joueur]) enregistrés à la fin de chaque manche. left = mes bateaux à flot,
-- enemy_left = bateaux adverses à flot. Seuils : tirs 40 / 120, précision 40 %.
create or replace function public.game_bataille_navale_trophy_stats(p_state jsonb, p_pl text)
returns jsonb language sql stable
set search_path = public, extensions
as $$
  with m as (
    select won, lost, g->'total' as total, g->'p'->p_pl as me
      from public._duel_games_x(p_state, p_pl)
     where g->'p'->p_pl is not null
  )
  select jsonb_build_object(
    'miss_streak', coalesce(max((me->>'mbest')::integer), 0),
    'hits', coalesce(sum((me->>'hits')::integer), 0),
    'best_hit_streak', coalesce(max((me->>'best')::integer), 0),
    'first_shot_hits', coalesce(sum((me->>'fh')::integer), 0),
    'lost_no_sink', count(*) filter (where lost and (me->>'enemy_left')::integer >= 5),
    'lost_close', count(*) filter (where lost and (me->>'enemy_left')::integer = 1),
    'long_win', count(*) filter (where won and (total)::text::integer >= 120),
    'precise_win', count(*) filter (where won and (me->>'shots')::integer > 0
                                      and (me->>'hits')::integer * 100 >= (me->>'shots')::integer * 40),
    'fast_win', count(*) filter (where won and (me->>'shots')::integer <= 40),
    'intact_win', count(*) filter (where won and (me->>'left')::integer >= 5))
  from m
$$;
revoke all on function public.game_bataille_navale_trophy_stats(jsonb, text) from public, anon, authenticated;

create or replace function public.game_bataille_navale_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if cardinality(p_players) > 9 then raise exception 'too_many_players'; end if;
  return public._duel_start('bataille-navale', p_players, p_options);
end $$;

create or replace function public.game_bataille_navale_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
begin
  return public._duel_action('bataille-navale', p_state, p_server, p_actor, p_is_host, p_action);
end $$;

revoke all on function public._bn_ships() from public, anon, authenticated;
revoke all on function public._bn_cells(jsonb) from public, anon, authenticated;
revoke all on function public._bn_fleet_error(jsonb) from public, anon, authenticated;
revoke all on function public._bn_fleet_norm(jsonb) from public, anon, authenticated;
revoke all on function public._bn_fleet_check(jsonb) from public, anon, authenticated;
revoke all on function public._bn_fleet_random() from public, anon, authenticated;
revoke all on function public._bn_ship_at(jsonb, integer) from public, anon, authenticated;
revoke all on function public._bn_secret(jsonb, text, jsonb) from public, anon, authenticated;
revoke all on function public.game_bataille_navale_board_new(jsonb, text, text) from public, anon, authenticated;
revoke all on function public.game_bataille_navale_board_setup(jsonb, jsonb, text, jsonb) from public, anon, authenticated;
revoke all on function public.game_bataille_navale_board_move(jsonb, jsonb, text, jsonb) from public, anon, authenticated;
revoke all on function public.game_bataille_navale_board_auto(jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.game_bataille_navale_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_bataille_navale_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;


-- ===== games\bombe-a-mots.sql =====
-- =============================================================================
-- JEU « Bombe à mots » (id bombe-a-mots) : syllabe imposée + bombe qui tourne
-- Idempotent (create or replace). Dispatché par start_match / game_action.
-- Contrat complet (state public, actions, options) : src/games/bombe-a-mots/types.ts.
--
-- p_options : {"lives": 3, "start_level": 1,
--              "syllables": [{"s":"ou","level":1}, ...]}   -- tirées par l'hôte (front),
--              triées par difficulté croissante, mélangées à niveau égal (10..400 entrées).
--
-- MÈCHE GLOBALE (variante retenue) : une mèche de 5 à 12 s (tirée au hasard par le
-- serveur, JAMAIS publiée : server.explode_at) brûle en continu pendant que la bombe
-- passe de joueur en joueur ; elle n'est retirée qu'après une explosion. Pour éviter
-- une explosion « injuste » juste après une passe, le joueur qui reçoit la bombe a
-- toujours au moins BAM_GRACE_MS (1,5 s) devant lui (explode_at repoussé si besoin).
-- Après une explosion (et au lancement) : pause de BAM_PAUSE_S (3 s, state.resume_at),
-- puis nouvelle mèche à partir de resume_at (state.fuse_started_at).
--
-- Échéance cachée => le front ne sait pas quand envoyer le tick. Il « sonde » :
-- {"type":"tick","quiet":true} à partir de fuse_started_at + 5 s ; si la bombe n'a pas
-- encore explosé, le serveur LÈVE 'bomb_not_ready' (transaction annulée : aucune
-- écriture, aucun évènement Realtime, aucun seq consommé). {"type":"tick"} sans quiet
-- respecte la convention commune (state renvoyé inchangé, sans erreur).
--
-- Dictionnaire : vérifié CÔTÉ CLIENT uniquement (~300 000 formes, impossible à charger
-- dans une fonction SQL à chaque coup). Le serveur vérifie tout le reste.
-- =============================================================================

-- Normalisation d'un mot joué : minuscules, sans accents ni ligatures. Le tiret est
-- conservé (mots composés). Le résultat doit ensuite matcher ^[a-z]+(-[a-z]+)*$.
create or replace function public._bam_norm(p text)
returns text language sql immutable
set search_path = public, extensions
as $$
  select lower(translate(
    replace(replace(replace(replace(btrim(left(coalesce(p, ''), 60)), 'œ', 'oe'), 'Œ', 'OE'), 'æ', 'ae'), 'Æ', 'AE'),
    'àâäáãåçéèêëíìîïñóòôöõúùûüýÿÀÂÄÁÃÅÇÉÈÊËÍÌÎÏÑÓÒÔÖÕÚÙÛÜÝŸ',
    'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUYY'))
$$;

-- Nouvelle mèche aléatoire (5 000 à 12 000 ms) à partir de p_from.
create or replace function public._bam_fuse(p_from timestamptz)
returns timestamptz language sql volatile
set search_path = public, extensions
as $$ select p_from + make_interval(secs => (5000 + floor(random() * 7001)) / 1000.0) $$;

-- Joueur vivant suivant p_from dans l'ordre de table (p_from peut être éliminé).
create or replace function public._bam_next(p_state jsonb, p_from text)
returns text language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_order text[] := array(select jsonb_array_elements_text(p_state->'players'));
  v_n     integer := cardinality(v_order);
  v_i     integer := coalesce(array_position(v_order, p_from), 0);
  k       integer;
  v_c     text;
begin
  for k in 1 .. v_n loop
    v_c := v_order[((v_i - 1 + k) % v_n) + 1];
    if (p_state->'alive') ? v_c then return v_c; end if;
  end loop;
  return null;
end $$;

-- Tire la syllabe suivante (niveau visé = start_level + mots validés / level_every, plafonné à 5).
-- Préfère une syllabe inutilisée du niveau visé (dans l'ordre fourni), sinon le niveau le
-- plus proche (plus facile d'abord) ; liste épuisée => on recycle (sauf la syllabe courante).
create or replace function public._bam_pick(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_target integer := least(5, (p_state->>'start_level')::integer
                              + (p_state->>'words_count')::integer / greatest(1, (p_state->>'level_every')::integer));
  v_cur    text := p_state->>'syllable';
  v_used   jsonb := coalesce(p_server->'used', '[]'::jsonb);
  v_idx    integer;
  v_s      text;
  v_lvl    integer;
begin
  for k in 1 .. 2 loop
    select (o - 1)::integer, e->>'s', (e->>'level')::integer into v_idx, v_s, v_lvl
      from jsonb_array_elements(p_server->'syllables') with ordinality t(e, o)
     where not (v_used @> to_jsonb((o - 1)::integer))
       and (v_cur is null or e->>'s' <> v_cur)
     order by abs((e->>'level')::integer - v_target), (e->>'level')::integer, o
     limit 1;
    exit when v_idx is not null;
    v_used := '[]'::jsonb;  -- tout a servi : on recycle
  end loop;
  if v_idx is null then  -- liste d'une seule syllabe (impossible via start) : on garde la courante
    v_s := v_cur; v_lvl := coalesce((p_state->>'level')::integer, 1);
  else
    v_used := v_used || to_jsonb(v_idx);
  end if;
  p_state := p_state || jsonb_build_object('syllable', v_s, 'level', v_lvl, 'target_level', v_target);
  p_server := p_server || jsonb_build_object('used', v_used);
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Stats de fin de partie pour les trophées (features/trophees.sql), lues dans explosions / words / bonuses.
create or replace function public._bam_tstats(p_state jsonb, p_pl text, p_winner text)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  with ev as (   -- événements de MES tours, dans l'ordre : x = explosion, w = mot validé
    select (x->>'n')::integer as n, 'x' as k from jsonb_array_elements(coalesce(p_state->'explosions', '[]'::jsonb)) x where x->>'p' = p_pl
    union all
    select (w->>'n')::integer, 'w' from jsonb_array_elements(coalesce(p_state->'words', '[]'::jsonb)) w where w->>'p' = p_pl
  ), r as (
    select n, k, row_number() over (order by n) - row_number() over (partition by k order by n) as grp from ev
  ), me as (
    select (select count(*) from ev where k = 'x') as booms
  )
  select jsonb_build_object(
    'explosions', (select booms from me),
    'double_boom', (select count(*) from (select count(*) as c from r where k = 'x' group by grp) z where c >= 2),
    'first_out', case when p_state->'eliminated'->>0 = p_pl then 1 else 0 end,
    'words', coalesce((p_state->'word_counts'->>p_pl)::integer, 0),
    'longest_word', coalesce((select max(char_length(replace(w->>'w', '-', '')))
                                from jsonb_array_elements(coalesce(p_state->'words', '[]'::jsonb)) w where w->>'p' = p_pl), 0),
    'alphabets', (select count(*) from jsonb_array_elements(coalesce(p_state->'bonuses', '[]'::jsonb)) b where b->>'p' = p_pl),
    'last_life_win', case when p_winner = p_pl and (p_state->'lives'->>p_pl)::integer = 1 then 1 else 0 end,
    'untouched', case when p_winner = p_pl and (select booms from me) = 0
                       and jsonb_array_length(p_state->'players') >= 3 then 1 else 0 end)
$$;

-- Fin de partie : survivant 1er, puis ordre d'élimination inverse.
-- points = mots validés (plafonnés à 25 => XP max 250 + 50 de victoire).
create or replace function public._bam_finish(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_winner  text := p_state->'alive'->>0;
  v_ranked  jsonb;
  v_results jsonb;
begin
  -- Ordre de classement : vivant(s) puis éliminés du dernier au premier.
  select jsonb_agg(x order by r) into v_ranked from (
    select value as x, 0 as r from jsonb_array_elements_text(p_state->'alive')
    union all
    select value, (100000 - o)::integer from jsonb_array_elements_text(p_state->'eliminated') with ordinality t(value, o)
  ) z;

  select jsonb_agg(jsonb_build_object(
           'profile_id', pid,
           'points', least(25, coalesce((p_state->'word_counts'->>pid)::integer, 0)),
           'won', pid = v_winner,
           'placement', o::integer,
           -- fast_words / close_calls : comptés dans server (l'heure d'explosion est secrète)
           'stats', public._bam_tstats(p_state, pid, v_winner) || jsonb_build_object(
             'fast_words', coalesce((p_server->'fast_words'->>pid)::integer, 0),
             'close_calls', coalesce((p_server->'close_calls'->>pid)::integer, 0))) order by o)
    into v_results
    from jsonb_array_elements_text(v_ranked) with ordinality t(pid, o);

  p_state := p_state || jsonb_build_object('phase', 'finished', 'winner', v_winner, 'turn', null,
                                           'resume_at', null, 'results', v_results,
                                           'ranking', v_ranked);
  return jsonb_build_object('state', p_state, 'server', p_server - 'explode_at', 'results', v_results);
end $$;

-- Démarre une nouvelle mèche après une pause de 3 s (lancement / après explosion).
create or replace function public._bam_rearm(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_resume timestamptz := now() + interval '3 seconds';
begin
  p_state := p_state || jsonb_build_object('resume_at', to_jsonb(v_resume), 'fuse_started_at', to_jsonb(v_resume));
  p_server := p_server || jsonb_build_object('explode_at', to_jsonb(public._bam_fuse(v_resume)));
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- BOUM : le joueur actif perd une vie (éliminé à 0), la bombe passe au suivant.
create or replace function public._bam_explode(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_victim text := p_state->>'turn';
  v_lives  integer := greatest(0, coalesce((p_state->'lives'->>v_victim)::integer, 1) - 1);
  v_out    boolean := v_lives = 0;
  v_n      integer := (p_state->>'turn_n')::integer + 1;
  v_r      jsonb;
begin
  p_state := jsonb_set(p_state, array['lives', v_victim], to_jsonb(v_lives));
  if v_out then
    p_state := p_state || jsonb_build_object(
      'alive', (p_state->'alive') - v_victim,
      'eliminated', coalesce(p_state->'eliminated', '[]'::jsonb) || to_jsonb(v_victim));
  end if;
  p_state := p_state || jsonb_build_object(
    'explosions', coalesce(p_state->'explosions', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'p', v_victim, 's', p_state->>'syllable', 'n', p_state->'turn_n', 'eliminated', v_out)),
    'last_event', jsonb_build_object('kind', 'explosion', 'n', p_state->'turn_n', 'p', v_victim,
                                     's', p_state->>'syllable', 'lives', v_lives, 'eliminated', v_out,
                                     'at', to_jsonb(now())));

  if jsonb_array_length(p_state->'alive') <= 1 then
    return public._bam_finish(p_state, p_server);
  end if;

  p_state := p_state || jsonb_build_object('turn', public._bam_next(p_state, v_victim), 'turn_n', v_n,
                                           'turn_started_at', to_jsonb(now() + interval '3 seconds'));
  v_r := public._bam_pick(p_state, p_server);
  return public._bam_rearm(v_r->'state', v_r->'server');
end $$;

create or replace function public.game_bombe_a_mots_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_in     jsonb := p_options->'syllables';
  v_syl    jsonb;
  v_lives  integer;
  v_level  integer;
  v_order  jsonb;
  v_st     jsonb;
  v_r      jsonb;
begin
  if cardinality(p_players) < 2 then raise exception 'not_enough_players'; end if;
  if cardinality(p_players) > 9 then raise exception 'too_many_players'; end if;
  if v_in is null or jsonb_typeof(v_in) <> 'array' or jsonb_array_length(v_in) < 10
     or jsonb_array_length(v_in) > 400 then
    raise exception 'invalid_syllables';
  end if;
  if exists (select 1 from jsonb_array_elements(v_in) e
              where jsonb_typeof(e) <> 'object' or coalesce(e->>'s', '') !~ '^[a-z]{2,3}$'
                 or coalesce(e->>'level', '') !~ '^[1-5]$') then
    raise exception 'invalid_syllables';
  end if;
  select jsonb_agg(jsonb_build_object('s', e->>'s', 'level', (e->>'level')::integer) order by o)
    into v_syl from jsonb_array_elements(v_in) with ordinality t(e, o);

  begin
    v_lives := coalesce(nullif(p_options->>'lives', '')::integer, 3);
    v_level := coalesce(nullif(p_options->>'start_level', '')::integer, 1);
  exception when others then
    v_lives := 3; v_level := 1;
  end;
  v_lives := least(greatest(v_lives, 1), 5);
  v_level := least(greatest(v_level, 1), 5);

  -- Ordre de table aléatoire.
  select jsonb_agg(p::text order by random()) into v_order from unnest(p_players) p;

  v_st := jsonb_build_object(
    'game', 'bombe-a-mots',
    'phase', 'playing',
    'players', v_order,
    'alive', v_order,
    'eliminated', '[]'::jsonb,
    'turn', v_order->>0,
    'turn_n', 1,
    'turn_started_at', to_jsonb(now() + interval '3 seconds'),
    'syllable', null,
    'level', v_level,
    'target_level', v_level,
    'start_level', v_level,
    'level_every', 8,
    'max_lives', v_lives,
    'lives', (select jsonb_object_agg(value, v_lives) from jsonb_array_elements_text(v_order)),
    'letters', (select jsonb_object_agg(value, '') from jsonb_array_elements_text(v_order)),
    'bonus_alphabet', 'abcdefghijlmnopqrstuv',
    'word_counts', (select jsonb_object_agg(value, 0) from jsonb_array_elements_text(v_order)),
    'words_count', 0,
    'words', '[]'::jsonb,
    'explosions', '[]'::jsonb,
    'bonuses', '[]'::jsonb,
    'last_event', null,
    'min_fuse_ms', 5000,
    'max_fuse_ms', 12000,
    'grace_ms', 1500,
    'winner', null,
    'results', null);
  v_r := public._bam_pick(v_st, jsonb_build_object('syllables', v_syl, 'used', '[]'::jsonb));
  v_r := public._bam_rearm(v_r->'state', v_r->'server');
  return v_r || jsonb_build_object('secrets', '{}'::jsonb);
end $$;

create or replace function public.game_bombe_a_mots_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_type    text := p_action->>'type';
  v_me      text := p_actor::text;
  v_same    jsonb := jsonb_build_object('state', p_state, 'server', p_server);
  v_explode timestamptz := (p_server->>'explode_at')::timestamptz;
  v_resume  timestamptz := (p_state->>'resume_at')::timestamptz;
  v_syl     text := p_state->>'syllable';
  v_w       text;
  v_letters text;
  v_alpha   text := p_state->>'bonus_alphabet';
  v_lives   integer;
  v_bonus   boolean := false;
  v_full    boolean := false;
  v_next    text;
  v_n       integer := (p_state->>'turn_n')::integer;
  v_r       jsonb;
begin
  if v_type not in ('word', 'tick') then raise exception 'unknown_action'; end if;

  if v_type = 'tick' then
    -- Tick d'un tour passé ou partie finie : ignoré.
    if p_state->>'phase' <> 'playing'
       or (p_action ? 'n' and (p_action->>'n') is distinct from (p_state->>'turn_n')) then
      if coalesce((p_action->>'quiet')::boolean, false) then raise exception 'bomb_not_ready'; end if;
      return v_same;
    end if;
    if v_explode is null or now() < v_explode then
      if coalesce((p_action->>'quiet')::boolean, false) then raise exception 'bomb_not_ready'; end if;
      return v_same;
    end if;
    return public._bam_explode(p_state, p_server);
  end if;

  -- word
  if p_state->>'phase' <> 'playing' then raise exception 'wrong_phase'; end if;
  if not (p_state->'players' ? v_me) then raise exception 'not_a_player'; end if;
  if not (p_state->'alive' ? v_me) then raise exception 'not_alive'; end if;
  if p_state->>'turn' <> v_me then raise exception 'not_your_turn'; end if;
  if p_action ? 'n' and (p_action->>'n') is distinct from (p_state->>'turn_n') then
    raise exception 'too_late';
  end if;
  if v_resume is not null and now() < v_resume then raise exception 'bomb_paused'; end if;
  -- Trop tard : la bombe a explosé avant le mot (même si personne n'a encore « tické »).
  if v_explode is not null and now() >= v_explode then
    return public._bam_explode(p_state, p_server);
  end if;

  v_w := public._bam_norm(p_action->>'word');
  if v_w !~ '^[a-z]+(-[a-z]+)*$' or char_length(v_w) > 40 then raise exception 'invalid_word'; end if;
  if strpos(v_w, v_syl) = 0 then raise exception 'word_missing_syllable'; end if;
  if char_length(replace(v_w, '-', '')) <= char_length(v_syl) then raise exception 'word_too_short'; end if;
  if exists (select 1 from jsonb_array_elements(p_state->'words') x where x->>'w' = v_w) then
    raise exception 'word_already_played';
  end if;

  -- Alphabet bonus : lettres (hors k w x y z) déjà utilisées dans les mots validés du joueur.
  select string_agg(c, '' order by c) into v_letters
    from (select distinct c from regexp_split_to_table(coalesce(p_state->'letters'->>v_me, '') || v_w, '') c
           where strpos(v_alpha, c) > 0) z;
  v_letters := coalesce(v_letters, '');
  v_lives := (p_state->'lives'->>v_me)::integer;
  if char_length(v_letters) >= char_length(v_alpha) then
    v_full := true;
    v_letters := '';
    if v_lives < (p_state->>'max_lives')::integer then
      v_lives := v_lives + 1;
      v_bonus := true;
    end if;
    p_state := p_state || jsonb_build_object('bonuses', coalesce(p_state->'bonuses', '[]'::jsonb)
      || jsonb_build_array(jsonb_build_object('p', v_me, 'n', v_n, 'life', v_bonus)));
  end if;

  -- Trophées : mot validé en moins de 2 s (Patate chaude) / à moins d'1 s de l'explosion (Sueurs froides).
  if p_state->>'turn_started_at' is not null
     and now() - (p_state->>'turn_started_at')::timestamptz < interval '2 seconds' then
    p_server := p_server || jsonb_build_object('fast_words', coalesce(p_server->'fast_words', '{}'::jsonb)
      || jsonb_build_object(v_me, coalesce((p_server->'fast_words'->>v_me)::integer, 0) + 1));
  end if;
  if v_explode is not null and v_explode - now() < interval '1 second' then
    p_server := p_server || jsonb_build_object('close_calls', coalesce(p_server->'close_calls', '{}'::jsonb)
      || jsonb_build_object(v_me, coalesce((p_server->'close_calls'->>v_me)::integer, 0) + 1));
  end if;

  v_next := public._bam_next(p_state, v_me);
  p_state := jsonb_set(p_state, array['letters', v_me], to_jsonb(v_letters));
  p_state := jsonb_set(p_state, array['lives', v_me], to_jsonb(v_lives));
  p_state := jsonb_set(p_state, array['word_counts', v_me],
                       to_jsonb(coalesce((p_state->'word_counts'->>v_me)::integer, 0) + 1));
  p_state := p_state || jsonb_build_object(
    'words', (p_state->'words') || jsonb_build_array(jsonb_build_object('p', v_me, 'w', v_w, 's', v_syl, 'n', v_n)),
    'words_count', (p_state->>'words_count')::integer + 1,
    'last_event', jsonb_build_object('kind', 'word', 'n', v_n, 'p', v_me, 'w', v_w, 's', v_syl,
                                     'to', v_next, 'alphabet_full', v_full, 'bonus_life', v_bonus,
                                     'at', to_jsonb(now())),
    'turn', v_next,
    'turn_n', v_n + 1,
    'turn_started_at', to_jsonb(now()));

  -- Mèche globale : elle continue ; délai minimal de grâce pour le receveur.
  if v_explode < now() + make_interval(secs => coalesce((p_state->>'grace_ms')::integer, 1500) / 1000.0) then
    p_server := p_server || jsonb_build_object('explode_at',
      to_jsonb(now() + make_interval(secs => coalesce((p_state->>'grace_ms')::integer, 1500) / 1000.0)));
  end if;

  v_r := public._bam_pick(p_state, p_server);
  return v_r;
end $$;

revoke all on function public._bam_norm(text) from public, anon, authenticated;
revoke all on function public._bam_fuse(timestamptz) from public, anon, authenticated;
revoke all on function public._bam_next(jsonb, text) from public, anon, authenticated;
revoke all on function public._bam_pick(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._bam_finish(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._bam_tstats(jsonb, text, text) from public, anon, authenticated;
revoke all on function public._bam_rearm(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._bam_explode(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.game_bombe_a_mots_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_bombe_a_mots_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;


-- ===== games\bowling.sql =====
-- =============================================================================
-- JEU « bowling » (Bowling 3D, tout le monde joue en même temps) — idempotent.
-- Dépend de schema.sql (game_action, start_match, finish_match).
--
-- Chaque joueur joue SA partie sur son téléphone (physique 3D côté client),
-- puis envoie le résultat de chaque lancer : {"type":"roll","frame":f,"roll":r,
-- "pins_down_mask":m}. Le masque m (0..1023, bit i = quille n° i+1) liste les
-- quilles tombées PENDANT ce lancer. Le serveur vérifie la cohérence (ordre des
-- lancers, m ⊆ quilles debout, 10 max) et calcule LUI-MÊME le score officiel
-- (même logique que src/games/bowling/scoring.ts).
--
-- Anti-triche : minimal (jeu entre amis). Le serveur ne peut pas vérifier la
-- physique : un client modifié peut envoyer des strikes à volonté. Il garantit
-- seulement une feuille de score légale et un score correctement calculé.
--
-- Phases : playing -> finished (tous ont fini, échéance globale atteinte, ou
-- l'hôte termine : lancers manquants = 0).
-- =============================================================================

-- Nombre de quilles d'un masque (bits 0..9).
create or replace function public._bw_count(p_mask integer)
returns integer language sql immutable
set search_path = public, extensions
as $$ select count(*)::integer from generate_series(0, 9) b where (coalesce(p_mask, 0) >> b) & 1 = 1 $$;

-- Frame terminée ? (p_last : dernière frame = règles de la 10e)
create or replace function public._bw_frame_complete(p_frame jsonb, p_last boolean)
returns boolean language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_len integer := coalesce(jsonb_array_length(p_frame), 0);
  c1 integer;
  c2 integer;
begin
  if v_len = 0 then return false; end if;
  c1 := public._bw_count((p_frame->>0)::integer);
  if not p_last then return v_len >= 2 or c1 = 10; end if;
  if v_len < 2 then return false; end if;
  if v_len >= 3 then return true; end if;
  c2 := public._bw_count((p_frame->>1)::integer);
  return c1 + c2 < 10;
end $$;

-- Quilles debout avant le prochain lancer d'une frame non terminée.
create or replace function public._bw_standing(p_frame jsonb, p_last boolean)
returns integer language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_len integer := coalesce(jsonb_array_length(p_frame), 0);
  m1 integer;
  m2 integer;
begin
  if v_len = 0 then return 1023; end if;
  m1 := (p_frame->>0)::integer;
  if not p_last then return 1023 & ~m1; end if;
  if v_len = 1 then
    return case when public._bw_count(m1) = 10 then 1023 else 1023 & ~m1 end;
  end if;
  m2 := (p_frame->>1)::integer;
  if public._bw_count(m1) = 10 then
    return case when public._bw_count(m2) = 10 then 1023 else 1023 & ~m2 end;
  end if;
  return 1023;  -- spare : quilles relevées
end $$;

-- Prochain lancer attendu {frame, roll, standing} (1-based) ou null si fini.
create or replace function public._bw_next(p_sheet jsonb, p_n integer)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  f integer;
  v_frame jsonb;
begin
  for f in 0 .. p_n - 1 loop
    v_frame := coalesce(p_sheet->f, '[]'::jsonb);
    if not public._bw_frame_complete(v_frame, f = p_n - 1) then
      return jsonb_build_object('frame', f + 1, 'roll', jsonb_array_length(v_frame) + 1,
                                'standing', public._bw_standing(v_frame, f = p_n - 1));
    end if;
  end loop;
  return null;
end $$;

-- Ajoute le masque p_mask à la frame p_frame (1-based).
create or replace function public._bw_add(p_sheet jsonb, p_frame integer, p_mask integer)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_sheet jsonb := coalesce(p_sheet, '[]'::jsonb);
begin
  while jsonb_array_length(v_sheet) < p_frame loop
    v_sheet := v_sheet || '[[]]'::jsonb;
  end loop;
  return jsonb_set(v_sheet, array[(p_frame - 1)::text],
                   (v_sheet->(p_frame - 1)) || to_jsonb(p_mask));
end $$;

-- Complète une feuille avec des lancers à 0 (fin forcée).
create or replace function public._bw_fill(p_sheet jsonb, p_n integer)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_sheet jsonb := coalesce(p_sheet, '[]'::jsonb);
  v_next jsonb;
begin
  loop
    v_next := public._bw_next(v_sheet, p_n);
    exit when v_next is null;
    v_sheet := public._bw_add(v_sheet, (v_next->>'frame')::integer, 0);
  end loop;
  return v_sheet;
end $$;

-- Score officiel : {total (bonus non joués = 0), cum: [cumul | null par frame]}.
create or replace function public._bw_score(p_sheet jsonb, p_n integer)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_flat    integer[] := '{}';
  v_start   integer[] := '{}';
  v_counts  integer[];
  v_frame   jsonb;
  f         integer;
  i         integer;
  v_len     integer;
  v_score   integer;
  v_partial integer;
  v_running integer := 0;
  v_total   integer := 0;
  v_broken  boolean := false;
  v_cum     jsonb := '[]'::jsonb;
  m         jsonb;
begin
  for f in 0 .. p_n - 1 loop
    v_start := v_start || (cardinality(v_flat) + 1);  -- index 1-based dans v_flat
    for m in select value from jsonb_array_elements(coalesce(p_sheet->f, '[]'::jsonb)) loop
      v_flat := v_flat || public._bw_count((m #>> '{}')::integer);
    end loop;
  end loop;

  for f in 0 .. p_n - 1 loop
    v_frame := coalesce(p_sheet->f, '[]'::jsonb);
    v_len := jsonb_array_length(v_frame);
    i := v_start[f + 1];
    v_counts := v_flat[i : i + v_len - 1];
    v_partial := coalesce((select sum(x) from unnest(v_counts) x), 0);
    v_score := null;
    if f < p_n - 1 then
      if v_len >= 1 and v_counts[1] = 10 then
        v_partial := 10 + coalesce(v_flat[i + 1], 0) + coalesce(v_flat[i + 2], 0);
        if v_flat[i + 1] is not null and v_flat[i + 2] is not null then v_score := v_partial; end if;
      elsif v_len >= 2 and v_counts[1] + v_counts[2] = 10 then
        v_partial := 10 + coalesce(v_flat[i + 2], 0);
        if v_flat[i + 2] is not null then v_score := v_partial; end if;
      elsif v_len >= 2 then
        v_score := v_partial;
      end if;
    elsif public._bw_frame_complete(v_frame, true) then
      v_score := v_partial;
    end if;
    v_total := v_total + v_partial;
    if v_score is null then v_broken := true; end if;
    if not v_broken then
      v_running := v_running + v_score;
      v_cum := v_cum || to_jsonb(v_running);
    else
      v_cum := v_cum || 'null'::jsonb;
    end if;
  end loop;
  return jsonb_build_object('total', v_total, 'cum', v_cum);
end $$;

-- Recalcule scores / cumuls / prochain lancer / joueurs finis.
create or replace function public._bw_refresh(p_state jsonb)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_n      integer := (p_state->>'frames')::integer;
  pl       text;
  v_sheet  jsonb;
  v_sc     jsonb;
  v_next   jsonb;
  v_scores jsonb := '{}'::jsonb;
  v_cum    jsonb := '{}'::jsonb;
  v_nexts  jsonb := '{}'::jsonb;
  v_done   jsonb := '[]'::jsonb;
begin
  for pl in select x from jsonb_array_elements_text(p_state->'players') x loop
    v_sheet := coalesce(p_state->'sheets'->pl, '[]'::jsonb);
    v_sc := public._bw_score(v_sheet, v_n);
    v_next := public._bw_next(v_sheet, v_n);
    v_scores := v_scores || jsonb_build_object(pl, v_sc->'total');
    v_cum := v_cum || jsonb_build_object(pl, v_sc->'cum');
    v_nexts := v_nexts || jsonb_build_object(pl, coalesce(v_next, 'null'::jsonb));
    if v_next is null then v_done := v_done || to_jsonb(pl); end if;
  end loop;
  return p_state || jsonb_build_object('scores', v_scores, 'cum', v_cum, 'next', v_nexts, 'done', v_done);
end $$;

-- Stats de fin de partie pour les trophées (features/trophees.sql). p_sheet = feuille COMPLÉTÉE,
-- p_raw = feuille brute (gouttières : seuls les vrais lancers comptent, pas les 0 de remplissage).
create or replace function public._bw_tstats(p_sheet jsonb, p_n integer, p_raw jsonb)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  f int; fr jsonb; c1 int; c2 int; c3 int; len int; l boolean;
  v_strikes int := 0; v_spares int := 0; v_one int := 0; v_resc int := 0; v_gut int := 0;
  v_clean boolean := true; v_run int := 0; v_best int := 0; v_ev int[] := '{}'; e int;
begin
  for f in 0 .. p_n - 1 loop
    fr := coalesce(p_sheet->f, '[]'::jsonb);
    len := jsonb_array_length(fr);
    c1 := case when len >= 1 then public._bw_count((fr->>0)::integer) end;
    c2 := case when len >= 2 then public._bw_count((fr->>1)::integer) end;
    c3 := case when len >= 3 then public._bw_count((fr->>2)::integer) end;
    l := f = p_n - 1;
    if c1 is null then v_clean := false; v_ev := v_ev || 0; continue; end if;
    if not l then
      if c1 = 10 then v_strikes := v_strikes + 1; v_ev := v_ev || 1;
      else
        v_ev := v_ev || 0;
        if coalesce(c1 + c2, 0) = 10 then v_spares := v_spares + 1; if c1 = 0 then v_resc := v_resc + 1; end if;
        else v_clean := false; if coalesce(c1 + c2, 0) = 9 then v_one := v_one + 1; end if;
        end if;
      end if;
    else
      if c1 = 10 then
        v_strikes := v_strikes + 1; v_ev := v_ev || 1;
        if c2 = 10 then
          v_strikes := v_strikes + 1; v_ev := v_ev || 1;
          if c3 = 10 then v_strikes := v_strikes + 1; v_ev := v_ev || 1; else v_ev := v_ev || 0; end if;
        else
          v_ev := v_ev || 0;
          if coalesce(c2 + c3, 0) = 10 then v_spares := v_spares + 1; end if;
        end if;
      else
        v_ev := v_ev || 0;
        if coalesce(c1 + c2, 0) = 10 then
          v_spares := v_spares + 1; if c1 = 0 then v_resc := v_resc + 1; end if;
          if c3 = 10 then v_strikes := v_strikes + 1; v_ev := v_ev || 1; else v_ev := v_ev || 0; end if;
        else
          v_clean := false; if coalesce(c1 + c2, 0) = 9 then v_one := v_one + 1; end if;
        end if;
      end if;
    end if;
  end loop;
  foreach e in array v_ev loop
    v_run := case when e = 1 then v_run + 1 else 0 end;
    v_best := greatest(v_best, v_run);
  end loop;
  -- gouttières : lancers réellement joués à 0 quille
  select count(*) into v_gut
    from jsonb_array_elements(coalesce(p_raw, '[]'::jsonb)) fx, jsonb_array_elements(fx) m
   where public._bw_count((m #>> '{}')::integer) = 0;
  return jsonb_build_object('strikes', v_strikes, 'spares', v_spares, 'one_left', v_one, 'rescues', v_resc,
                            'gutters', v_gut, 'strike_run', v_best,
                            'clean', case when v_clean and p_n >= 5 then 1 else 0 end);
end $$;

-- Fin de partie : feuilles complétées par des 0, classement, résultats.
-- points = round(score / 30) (300 -> 10 pts -> 100 XP) ; gagnant(s) = meilleur
-- score (ex-aequo inclus), à condition d'avoir marqué au moins 1 quille.
create or replace function public._bw_finish(p_state jsonb, p_server jsonb, p_forced boolean)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_n       integer := (p_state->>'frames')::integer;
  v_sheets  jsonb := '{}'::jsonb;
  pl        text;
  v_max     integer;
  v_results jsonb;
  v_winners jsonb;
  v_raw     jsonb := coalesce(p_state->'sheets', '{}'::jsonb);
begin
  for pl in select x from jsonb_array_elements_text(p_state->'players') x loop
    v_sheets := v_sheets || jsonb_build_object(pl, public._bw_fill(p_state->'sheets'->pl, v_n));
  end loop;
  p_state := public._bw_refresh(p_state || jsonb_build_object('sheets', v_sheets));

  select coalesce(max(value::integer), 0) into v_max from jsonb_each_text(p_state->'scores');

  select jsonb_agg(jsonb_build_object(
           'profile_id', t.key,
           'points', round(t.value::integer / 30.0)::integer,
           'won', v_max > 0 and t.value::integer = v_max,
           'placement', t.r,
           'stats', jsonb_build_object('score', t.value::integer, 'frames', v_n)
                    || public._bw_tstats(p_state->'sheets'->t.key, v_n, v_raw->t.key))
         order by t.r, t.key)
    into v_results
    from (select key, value, rank() over (order by value::integer desc) as r
            from jsonb_each_text(p_state->'scores')) t;

  select coalesce(jsonb_agg(key order by key), '[]'::jsonb) into v_winners
    from jsonb_each_text(p_state->'scores') where v_max > 0 and value::integer = v_max;

  p_state := p_state || jsonb_build_object('phase', 'finished', 'forced', p_forced,
                                           'winners', v_winners, 'results', v_results);
  return jsonb_build_object('state', p_state, 'server', p_server, 'results', v_results);
end $$;

-- Options : {"frames": 3|5|10 (défaut 5), "time_limit": 0|5|10|15|20 minutes (0 = sans limite)}
create or replace function public.game_bowling_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_frames integer;
  v_limit  integer;
  v_empty  jsonb;
  v_state  jsonb;
begin
  -- 2 joueurs minimum : en solo, la victoire serait automatique (tenue Bowler « farmable »).
  if coalesce(cardinality(p_players), 0) < 2 then raise exception 'not_enough_players'; end if;
  if cardinality(p_players) > 9 then raise exception 'too_many_players'; end if;

  v_frames := case when coalesce(p_options->>'frames', '') ~ '^\d{1,2}$'
                   then (p_options->>'frames')::integer else 5 end;
  if v_frames not in (3, 5, 10) then v_frames := 5; end if;
  v_limit := case when coalesce(p_options->>'time_limit', '') ~ '^\d{1,2}$'
                  then (p_options->>'time_limit')::integer else 0 end;
  if v_limit not in (0, 5, 10, 15, 20) then v_limit := 0; end if;

  select jsonb_object_agg(p::text, '[]'::jsonb) into v_empty from unnest(p_players) p;

  v_state := jsonb_build_object(
    'game', 'bowling',
    'phase', 'playing',
    'players', to_jsonb(p_players),
    'frames', v_frames,
    'time_limit', v_limit,
    'started_at', now(),
    'deadline', case when v_limit > 0 then to_jsonb(now() + make_interval(mins => v_limit)) else 'null'::jsonb end,
    'sheets', v_empty,
    'last_roll', null,
    'forced', false,
    'winners', null,
    'results', null);

  return jsonb_build_object('state', public._bw_refresh(v_state), 'server', '{}'::jsonb, 'secrets', '{}'::jsonb);
end $$;

create or replace function public.game_bowling_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_type    text := p_action->>'type';
  v_phase   text := p_state->>'phase';
  v_me      text := p_actor::text;
  v_n       integer := (p_state->>'frames')::integer;
  v_frame   integer;
  v_roll    integer;
  v_mask    integer;
  v_sheet   jsonb;
  v_prev    jsonb;
  v_next    jsonb;
  v_stand   integer;
  v_cnt     integer;
  v_kind    text;
  v_late    boolean := p_state->>'deadline' is not null
                       and now() >= (p_state->>'deadline')::timestamptz;
begin
  -- ---------------------------------------------------------------- roll
  if v_type = 'roll' then
    if v_phase <> 'playing' then raise exception 'wrong_phase'; end if;
    if not ((p_state->'players') ? v_me) then raise exception 'not_a_player'; end if;
    if jsonb_typeof(p_action->'frame') is distinct from 'number'
       or jsonb_typeof(p_action->'roll') is distinct from 'number'
       or jsonb_typeof(p_action->'pins_down_mask') is distinct from 'number'
       or (p_action->>'frame') !~ '^\d{1,2}$' or (p_action->>'roll') !~ '^\d$' then
      raise exception 'invalid_action';
    end if;
    if (p_action->>'pins_down_mask') !~ '^\d{1,4}$' then raise exception 'invalid_roll'; end if;
    v_frame := (p_action->>'frame')::integer;
    v_roll  := (p_action->>'roll')::integer;
    v_mask  := (p_action->>'pins_down_mask')::integer;
    if v_mask > 1023 then raise exception 'invalid_roll'; end if;

    -- Échéance globale dépassée (tolérance réseau 3 s) : fin de partie, lancer ignoré.
    if v_late and now() > (p_state->>'deadline')::timestamptz + interval '3 seconds' then
      return public._bw_finish(p_state, p_server, true);
    end if;

    v_sheet := coalesce(p_state->'sheets'->v_me, '[]'::jsonb);
    v_prev := v_sheet->(v_frame - 1)->(v_roll - 1);
    if v_frame >= 1 and v_roll >= 1 and v_prev is not null then
      -- Renvoi du même lancer (réseau) : idempotent ; sinon réécriture interdite.
      if (v_prev #>> '{}')::integer = v_mask then
        return jsonb_build_object('state', p_state, 'server', p_server);
      end if;
      raise exception 'wrong_roll';
    end if;
    v_next := public._bw_next(v_sheet, v_n);
    if v_next is null then raise exception 'already_done'; end if;
    if (v_next->>'frame')::integer <> v_frame or (v_next->>'roll')::integer <> v_roll then
      raise exception 'wrong_roll';
    end if;
    v_stand := (v_next->>'standing')::integer;
    if (v_mask & ~v_stand & 1023) <> 0 then raise exception 'invalid_roll'; end if;

    v_cnt := public._bw_count(v_mask);
    v_kind := case when v_cnt = 0 then 'zero'
                   when v_stand = 1023 and v_cnt = 10 then 'strike'
                   when v_stand <> 1023 and v_mask = v_stand then 'spare'
                   else 'normal' end;

    p_state := jsonb_set(p_state, array['sheets', v_me], public._bw_add(v_sheet, v_frame, v_mask), true);
    p_state := public._bw_refresh(p_state) || jsonb_build_object('last_roll', jsonb_build_object(
      'player', v_me, 'frame', v_frame, 'roll', v_roll, 'mask', v_mask, 'pins', v_cnt,
      'kind', v_kind, 'at', now()));

    if jsonb_array_length(p_state->'done') >= jsonb_array_length(p_state->'players') then
      return public._bw_finish(p_state, p_server, false);
    end if;
    return jsonb_build_object('state', p_state, 'server', p_server);

  -- ---------------------------------------------------------------- tick
  elsif v_type = 'tick' then
    if v_phase = 'playing' and v_late then
      return public._bw_finish(p_state, p_server, true);
    end if;
    return jsonb_build_object('state', p_state, 'server', p_server);

  -- ---------------------------------------------------------------- end_game
  elsif v_type = 'end_game' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase <> 'playing' then raise exception 'wrong_phase'; end if;
    return public._bw_finish(p_state, p_server, true);

  else
    raise exception 'unknown_action';
  end if;
end $$;

revoke all on function public._bw_count(integer) from public, anon, authenticated;
revoke all on function public._bw_frame_complete(jsonb, boolean) from public, anon, authenticated;
revoke all on function public._bw_standing(jsonb, boolean) from public, anon, authenticated;
revoke all on function public._bw_next(jsonb, integer) from public, anon, authenticated;
revoke all on function public._bw_add(jsonb, integer, integer) from public, anon, authenticated;
revoke all on function public._bw_fill(jsonb, integer) from public, anon, authenticated;
revoke all on function public._bw_score(jsonb, integer) from public, anon, authenticated;
revoke all on function public._bw_refresh(jsonb) from public, anon, authenticated;
revoke all on function public._bw_finish(jsonb, jsonb, boolean) from public, anon, authenticated;
revoke all on function public._bw_tstats(jsonb, integer, jsonb) from public, anon, authenticated;
revoke all on function public.game_bowling_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_bowling_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;


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

-- Stats de fin de partie pour les trophées (features/trophees.sql) : tout se lit dans history[].found.
create or replace function public._cef_tstats(p_state jsonb, p_pl text)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  with q as (
    select e.o, e.v->>'mode' as mode,
           (select f from jsonb_array_elements(e.v->'found') f where f->>'profile_id' = p_pl limit 1) as me,
           jsonb_array_length(e.v->'found') as nfound
      from jsonb_array_elements(coalesce(p_state->'history', '[]'::jsonb)) with ordinality as e(v, o)
  ), r as (
    select q.*, (q.me is not null) as ok from q
  ), g as (
    select r.*, r.o - row_number() over (partition by r.ok order by r.o) as grp from r
  )
  select jsonb_build_object(
    'correct', (select count(*) from g where ok),
    'firsts', (select count(*) from g where ok and (me->>'rank')::integer = 1),
    'last_finder', (select count(*) from g where ok and nfound >= 3 and (me->>'rank')::integer = nfound),
    'close_finds', (select count(*) from g where ok
                      and (me->>'ms')::integer >= (p_state->>'duration')::integer * 1000 - 3000),
    'fast_typed', (select count(*) from g where ok and mode = 'typed' and (me->>'ms')::integer < 3000),
    'best_streak', coalesce((select max(c) from (select count(*) as c from g where ok group by grp) x), 0),
    'miss_streak', coalesce((select max(c) from (select count(*) as c from g where not ok group by grp) x), 0),
    'qcm_perfect', case when (select count(*) from g where mode = 'mcq') >= 5
                         and not exists (select 1 from g where mode = 'mcq' and not ok) then 1 else 0 end,
    'perfect', case when (select count(*) from g) >= 10 and not exists (select 1 from g where not ok) then 1 else 0 end)
$$;

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
           'stats', public._cef_tstats(p_state, t.key))
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
revoke all on function public._cef_tstats(jsonb, text) from public, anon, authenticated;
revoke all on function public._cef_check_done(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.game_cerveau_en_fete_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_cerveau_en_fete_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;


-- ===== games\dede-kart.sql =====
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
    'hits_taken', coalesce((p_state->'taken'->>p_pl)::integer, 0),
    'used_cloud', coalesce((p_state->'used'->p_pl->>'cloud')::integer, 0),
    'used_confetti', coalesce((p_state->'used'->p_pl->>'confetti')::integer, 0),
    'used_reverse', coalesce((p_state->'used'->p_pl->>'reverse')::integer, 0),
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
      -- Trophées (Coups bas) : objets nuage / confettis / demi-tour utilisés
      p_state := p_state || jsonb_build_object('used', coalesce(p_state->'used', '{}'::jsonb) || jsonb_build_object(v_id,
        coalesce(p_state->'used'->v_id, '{}'::jsonb) || jsonb_build_object(v_item,
          coalesce((p_state->'used'->v_id->>v_item)::integer, 0) + 1)));
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
    -- Trophées (Tête-à-queue) : touches subies par la victime
    p_state := p_state || jsonb_build_object('taken', coalesce(p_state->'taken', '{}'::jsonb)
                 || jsonb_build_object(v_id, coalesce((p_state->'taken'->>v_id)::integer, 0) + 1));
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
  p_server := p_server || jsonb_build_object('word', null, 'revealed', '[]'::jsonb, 'hints_left', '[]'::jsonb,
                                             'fm', '{}'::jsonb, 'close_turn', '[]'::jsonb);
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
      'word', v_word->>'word', 'found', p_state->'found', 'skipped', p_skipped,
      -- trophées : difficulté du mot, « Presque ! » reçus (1 par joueur et par tour), chrono de chaque trouvaille
      'diff', coalesce((v_word->>'difficulty')::integer, 2),
      'close', coalesce(p_server->'close_turn', '[]'::jsonb),
      'fm', coalesce(p_server->'fm', '{}'::jsonb))));
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Stats de fin de partie pour les trophées (features/trophees.sql) : tout se lit dans history[].
create or replace function public._dd_tstats(p_state jsonb, p_pl text)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  with h as (
    select e.o, e.v->>'drawer' as drawer, coalesce((e.v->>'skipped')::boolean, false) as skipped,
           jsonb_array_length(e.v->'found') as nf,
           coalesce((e.v->'found') ? p_pl, false) as me_found,
           coalesce((e.v->'found'->>0) = p_pl, false) as first,
           coalesce((e.v->'close') ? p_pl, false) as closed,
           coalesce((e.v->>'diff')::integer, 0) as diff,
           (e.v->'fm'->p_pl->>'r')::numeric as rem,
           (e.v->'fm'->p_pl->>'e')::numeric as el,
           coalesce((e.v->'fm'->p_pl->>'nh')::boolean, false) as nohint
      from jsonb_array_elements(coalesce(p_state->'history', '[]'::jsonb)) with ordinality as e(v, o)
  ), n as (
    select jsonb_array_length(p_state->'players') as np
  ), g as (
    select h.*, h.o - row_number() over (partition by h.me_found order by h.o) as grp
      from h where drawer <> p_pl and not skipped
  )
  select jsonb_build_object(
    'unfound', (select count(*) from h where drawer = p_pl and not skipped and nf = 0),
    'found_count', (select count(*) from h where drawer <> p_pl and me_found),
    'first_finds', (select count(*) from h where first),
    'close_count', (select count(*) from h where drawer <> p_pl and closed),
    'late_finds', (select count(*) from h where me_found and rem <= 5),
    'fast_finds', (select count(*) from h where me_found and el < 10),
    'no_hint_finds', (select count(*) from h where me_found and nohint),
    'hard_perfect', (select count(*) from h, n where drawer = p_pl and not skipped and diff = 3 and np > 1 and nf = np - 1),
    'perfect_drawings', (select count(*) from h, n where drawer = p_pl and not skipped and np > 1 and nf = np - 1),
    'miss_streak', coalesce((select max(c) from (select count(*) as c from g where not me_found group by grp) x), 0),
    'masterpiece', case when (select np from n) >= 4 and exists (select 1 from h where drawer = p_pl)
        and not exists (select 1 from h, n where skipped
                          or (drawer = p_pl and nf < np - 1) or (drawer <> p_pl and not me_found)) then 1 else 0 end)
$$;

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
           'stats', jsonb_build_object('score', t.value::integer) || public._dd_tstats(p_state, t.key))
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
      p_server := p_server || jsonb_build_object('fm', coalesce(p_server->'fm', '{}'::jsonb) || jsonb_build_object(v_me,
        jsonb_build_object('e', round(extract(epoch from (now() - v_start))::numeric, 1),
                           'r', round(extract(epoch from (v_end - now()))::numeric, 1),
                           'nh', (p_state->>'next_hint_at') is not null
                                 and now() < (p_state->>'next_hint_at')::timestamptz)));
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
      if not (coalesce(p_server->'close_turn', '[]'::jsonb) ? v_me) then
        p_server := p_server || jsonb_build_object('close_turn', coalesce(p_server->'close_turn', '[]'::jsonb) || to_jsonb(v_me));
      end if;
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
revoke all on function public._dd_tstats(jsonb, text) from public, anon, authenticated;
revoke all on function public.game_dessine_devine_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_dessine_devine_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;


-- ===== games\devine-en-equipe.sql =====
-- =============================================================================
-- JEU « devine-en-equipe » (Devine en équipe) — idempotent, à recoller sans risque.
-- Contrat complet : src/games/devine-en-equipe/types.ts (en-tête).
--
-- 2 équipes (red / blue), 3 manches avec LES MÊMES mots :
--   1 « Décris » (tout sauf le mot) · 2 « Un seul mot » · 3 « Mime ».
-- Passages chronométrés : l'orateur fait deviner son équipe ; « found » = +1 point
-- d'équipe (et +1 point individuel pour l'orateur), « pass » = la carte retourne
-- en FIN de pioche (autorisé dans les 3 manches). Pioche vide = fin de manche ; le
-- temps restant (≥ 5 s) est conservé par le même orateur au début de la manche
-- suivante (règle classique). À l'échéance, la carte en cours retourne en fin de pioche.
--
-- Options (p_options de start_match), préparées par le front de l'hôte :
--   {"words": [{"word":"Astérix","kind":"perso"}, {"word":"parapluie","kind":"objet"}, …] (10-60),
--    "turn_seconds": 30|45|60,
--    "teams": {"red":[uuid…], "blue":[uuid…]}   (facultatif : sinon tirage au sort)}
--
-- Le mot courant n'est JAMAIS dans le state public : il vit dans `server` et dans
-- les secrets de l'orateur et de l'équipe adverse (qui surveille la triche). Les
-- coéquipiers de l'orateur reçoivent un secret {role:'teammate', word:null}.
-- =============================================================================

-- Horodatage ISO-8601 UTC millisecondes (parsable partout, Safari compris).
create or replace function public._dee_iso(p timestamptz)
returns text language sql immutable
set search_path = public, extensions
as $$ select to_char(p at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;

create or replace function public._dee_other(p_team text)
returns text language sql immutable
set search_path = public, extensions
as $$ select case when p_team = 'red' then 'blue' else 'red' end $$;

-- Membre d'une équipe à l'indice p_idx (rotation modulo la taille de l'équipe).
create or replace function public._dee_member(p_state jsonb, p_team text, p_idx integer)
returns text language sql immutable
set search_path = public, extensions
as $$
  select p_state->'teams'->p_team->>(p_idx % jsonb_array_length(p_state->'teams'->p_team))
$$;

-- Pioche mélangée : indices 0..n-1 du deck.
create or replace function public._dee_shuffled(p_n integer)
returns jsonb language sql volatile
set search_path = public, extensions
as $$ select coalesce(jsonb_agg(i order by random()), '[]'::jsonb) from generate_series(0, p_n - 1) i $$;

-- Secrets de la carte courante (pile[0]) : orateur (+ carte suivante pour un
-- affichage instantané) et équipe adverse ; coéquipiers (mot masqué) si demandé.
create or replace function public._dee_card_secrets(p_state jsonb, p_server jsonb, p_with_teammates boolean)
returns jsonb language plpgsql stable
set search_path = public, extensions
as $$
declare
  v_team    text := p_state->>'team';
  v_speaker text := p_state->>'speaker';
  v_pile    jsonb := p_server->'pile';
  v_cur     jsonb := p_server->'deck'->((v_pile->>0)::integer);
  v_next    jsonb := case when jsonb_array_length(v_pile) > 1
                          then p_server->'deck'->((v_pile->>1)::integer) else null end;
  v_base    jsonb := jsonb_build_object(
                       'turn_no', p_state->'turn_no', 'card_no', p_state->'card_no', 'round', p_state->'round');
  v_out     jsonb;
  p         text;
begin
  v_out := jsonb_build_object(v_speaker, v_base || jsonb_build_object(
    'role', 'speaker', 'word', v_cur->>'word', 'kind', v_cur->>'kind',
    'next_word', v_next->>'word', 'next_kind', v_next->>'kind'));
  for p in select jsonb_array_elements_text(p_state->'teams'->public._dee_other(v_team)) loop
    v_out := v_out || jsonb_build_object(p, v_base || jsonb_build_object(
      'role', 'watcher', 'word', v_cur->>'word', 'kind', v_cur->>'kind'));
  end loop;
  if p_with_teammates then
    for p in select jsonb_array_elements_text(p_state->'teams'->v_team) loop
      continue when p = v_speaker;
      v_out := v_out || jsonb_build_object(p, v_base || jsonb_build_object('role', 'teammate', 'word', null));
    end loop;
  end if;
  return v_out;
end $$;

-- Écran « Au tour de X — prêt ? » pour l'équipe/orateur courants.
create or replace function public._dee_ready(p_state jsonb, p_budget integer, p_carried boolean)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select p_state || jsonb_build_object(
    'phase', 'ready',
    'turn_no', coalesce((p_state->>'turn_no')::integer, 0) + 1,
    'budget', p_budget,
    'carried', p_carried,
    'deadline', null,
    'started_at', null,
    'turn_found', 0,
    'turn_passed', 0,
    'turn_words', '[]'::jsonb)
$$;

-- Rotation : l'équipe courante avance d'un orateur, puis la main passe à l'autre équipe.
create or replace function public._dee_rotate(p_state jsonb)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_team text := p_state->>'team';
  v_next text := public._dee_other(v_team);
  v_idx  jsonb := p_state->'next_idx';
begin
  v_idx := v_idx || jsonb_build_object(v_team, (v_idx->>v_team)::integer + 1);
  return p_state || jsonb_build_object(
    'next_idx', v_idx,
    'team', v_next,
    'speaker', public._dee_member(p_state, v_next, (v_idx->>v_next)::integer));
end $$;

create or replace function public._dee_recap(p_state jsonb, p_reason text)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'turn_no', p_state->'turn_no', 'round', p_state->'round',
    'team', p_state->'team', 'speaker', p_state->'speaker',
    'found', coalesce(p_state->'turn_words', '[]'::jsonb),
    'passed', coalesce((p_state->>'turn_passed')::integer, 0),
    'reason', p_reason)
$$;

-- Compteurs de trophées par orateur (state.tstat[pid]) : appelé à la fin d'un passage joué.
-- Cumul : empty_turns, found_r3 (mots en manche Mime), carries ; record : max_passed, best_r2, best_turn.
create or replace function public._dee_note(p_state jsonb, p_carry boolean)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_pid   text := p_state->>'speaker';
  v_st    jsonb := coalesce(p_state->'tstat'->v_pid, '{}'::jsonb);
  v_found integer := coalesce((p_state->>'turn_found')::integer, 0);
  v_pass  integer := coalesce((p_state->>'turn_passed')::integer, 0);
  v_round integer := coalesce((p_state->>'round')::integer, 0);
begin
  if v_pid is null or p_state->>'phase' <> 'playing' or p_state->>'started_at' is null then return p_state; end if;
  v_st := v_st || jsonb_build_object(
    'empty_turns', coalesce((v_st->>'empty_turns')::integer, 0) + case when v_found = 0 then 1 else 0 end,
    'max_passed', greatest(coalesce((v_st->>'max_passed')::integer, 0), v_pass),
    'best_turn', greatest(coalesce((v_st->>'best_turn')::integer, 0), v_found),
    'found_r3', coalesce((v_st->>'found_r3')::integer, 0) + case when v_round = 3 then v_found else 0 end,
    'best_r2', greatest(coalesce((v_st->>'best_r2')::integer, 0), case when v_round = 2 then v_found else 0 end),
    'carries', coalesce((v_st->>'carries')::integer, 0) + case when p_carry then 1 else 0 end);
  return p_state || jsonb_build_object('tstat',
    coalesce(p_state->'tstat', '{}'::jsonb) || jsonb_build_object(v_pid, v_st));
end $$;

-- Fin d'un passage (échéance, saut par l'hôte) : la carte en cours retourne en
-- fin de pioche, rotation, écran « prêt ? » suivant.
create or replace function public._dee_end_passage(p_state jsonb, p_server jsonb, p_reason text)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_pile jsonb := p_server->'pile';
begin
  if p_state->>'phase' = 'playing' and jsonb_array_length(v_pile) > 1 then
    p_server := p_server || jsonb_build_object('pile', (v_pile - 0) || jsonb_build_array(v_pile->0));
  end if;
  p_state := public._dee_note(p_state, false);
  p_state := p_state || jsonb_build_object('last_turn', public._dee_recap(p_state, p_reason), 'carry_seconds', null);
  p_state := public._dee_rotate(p_state);
  p_state := public._dee_ready(p_state, (p_state->>'turn_seconds')::integer, false);
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Stats de fin de partie pour les trophées (features/trophees.sql).
create or replace function public._dee_tstats(p_state jsonb, p_pid text, p_team text, p_won boolean)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  with s as (
    select coalesce((p_state->'speaker_points'->>p_pid)::integer, 0) as mine,
           (select coalesce(max(coalesce((p_state->'speaker_points'->>m)::integer, 0)), 0)
              from jsonb_array_elements_text(p_state->'teams'->p_team) m) as team_max,
           (select coalesce(max(value::integer), 0) from jsonb_each_text(coalesce(p_state->'speaker_points', '{}'::jsonb))) as all_max
  )
  select jsonb_build_object(
    'empty_turns', coalesce((p_state->'tstat'->p_pid->>'empty_turns')::integer, 0),
    'max_passed', coalesce((p_state->'tstat'->p_pid->>'max_passed')::integer, 0),
    'best_turn', coalesce((p_state->'tstat'->p_pid->>'best_turn')::integer, 0),
    'found_r3', coalesce((p_state->'tstat'->p_pid->>'found_r3')::integer, 0),
    'best_r2', coalesce((p_state->'tstat'->p_pid->>'best_r2')::integer, 0),
    'carries', coalesce((p_state->'tstat'->p_pid->>'carries')::integer, 0),
    'best_in_team', case when mine > 0 and mine >= team_max then 1 else 0 end,
    'sweep', case when jsonb_array_length(coalesce(p_state->'round_scores', '[]'::jsonb)) >= 3
        and not exists (select 1 from jsonb_array_elements(p_state->'round_scores') r
                         where (r->>p_team)::integer <= (r->>(case when p_team = 'red' then 'blue' else 'red' end))::integer)
        then 1 else 0 end,
    'mvp', case when p_won and mine >= 10 and mine >= all_max then 1 else 0 end)
  from s
$$;

create or replace function public._dee_finish(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql stable
set search_path = public, extensions
as $$
declare
  v_red     integer := (p_state->'scores'->>'red')::integer;
  v_blue    integer := (p_state->'scores'->>'blue')::integer;
  v_winners jsonb;
  v_results jsonb;
begin
  v_winners := case when v_red > v_blue then '["red"]'::jsonb
                    when v_blue > v_red then '["blue"]'::jsonb
                    else '["red","blue"]'::jsonb end;
  select jsonb_agg(jsonb_build_object(
           'profile_id', t.pid,
           -- XP raisonnable : 1 point pour 3 mots trouvés comme orateur (le détail reste dans stats.found).
           'points', ceil(coalesce((p_state->'speaker_points'->>t.pid)::integer, 0) / 3.0)::integer,
           'won', v_winners ? t.team,
           'placement', case when v_winners ? t.team then 1 else 2 end,
           'stats', jsonb_build_object('found', coalesce((p_state->'speaker_points'->>t.pid)::integer, 0), 'team', t.team)
                    || public._dee_tstats(p_state, t.pid, t.team, v_winners ? t.team))
         order by case when v_winners ? t.team then 1 else 2 end, t.team, t.pid)
    into v_results
    from (select x as pid, 'red' as team from jsonb_array_elements_text(p_state->'teams'->'red') x
          union all
          select x, 'blue' from jsonb_array_elements_text(p_state->'teams'->'blue') x) t;
  p_state := p_state || jsonb_build_object(
    'phase', 'finished', 'deadline', null, 'started_at', null, 'carry_seconds', null,
    'winners', v_winners, 'results', v_results);
  return jsonb_build_object('state', p_state, 'server', p_server, 'results', v_results);
end $$;

-- Pioche vide pendant un passage : fin de manche (ou de partie après la 3e).
create or replace function public._dee_round_complete(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_left integer;
begin
  v_left := greatest(0, floor(extract(epoch from ((p_state->>'deadline')::timestamptz - now())))::integer);
  -- Du rab : pioche vidée avec au moins 5 s gardées pour la manche suivante.
  p_state := public._dee_note(p_state, v_left >= 5
                                       and (p_state->>'round')::integer < (p_state->>'total_rounds')::integer);
  p_state := p_state || jsonb_build_object('last_turn', public._dee_recap(p_state, 'empty'));
  if (p_state->>'round')::integer >= (p_state->>'total_rounds')::integer then
    return public._dee_finish(p_state, p_server);
  end if;
  if v_left >= 5 then
    -- Même équipe, même orateur au début de la manche suivante, avec le temps restant.
    p_state := p_state || jsonb_build_object('carry_seconds', least(v_left, (p_state->>'turn_seconds')::integer));
  else
    p_state := public._dee_rotate(p_state) || jsonb_build_object('carry_seconds', null);
  end if;
  p_state := p_state || jsonb_build_object('phase', 'round_end', 'deadline', null, 'started_at', null, 'pile_left', 0);
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- -----------------------------------------------------------------------------
-- Démarrage
-- -----------------------------------------------------------------------------
create or replace function public.game_devine_en_equipe_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_n      integer := cardinality(p_players);
  v_words  jsonb := p_options->'words';
  v_secs   integer;
  v_deck   jsonb;
  v_teams  jsonb := p_options->'teams';
  v_red    jsonb;
  v_blue   jsonb;
  v_all    text[];
  v_shuf   text[];
  v_first  text;
  v_state  jsonb;
begin
  if v_n < 4 then raise exception 'not_enough_players'; end if;
  if v_n > 9 then raise exception 'too_many_players'; end if;

  v_secs := coalesce(nullif(p_options->>'turn_seconds', '')::integer, 30);
  if v_secs not in (30, 45, 60) then v_secs := 30; end if;

  -- Mots : chaînes ou {word, kind}. 10 à 60 cartes.
  if v_words is null or jsonb_typeof(v_words) <> 'array' then raise exception 'missing_words'; end if;
  if jsonb_array_length(v_words) < 10 then raise exception 'not_enough_words'; end if;
  if jsonb_array_length(v_words) > 60 then raise exception 'invalid_words'; end if;
  if exists (
    select 1 from jsonb_array_elements(v_words) w
     where not (
       (jsonb_typeof(w) = 'string' and char_length(btrim(w #>> '{}')) between 1 and 60)
       or (jsonb_typeof(w) = 'object' and jsonb_typeof(w->'word') = 'string'
           and char_length(btrim(w->>'word')) between 1 and 60)))
  then
    raise exception 'invalid_words';
  end if;
  select jsonb_agg(jsonb_build_object(
           'word', btrim(regexp_replace(case when jsonb_typeof(w) = 'string' then w #>> '{}' else w->>'word' end, '\s+', ' ', 'g')),
           'kind', case when jsonb_typeof(w) = 'object' and w->>'kind' = 'perso' then 'perso' else 'objet' end)
         order by o)
    into v_deck
    from jsonb_array_elements(v_words) with ordinality as t(w, o);

  -- Équipes : composées par l'hôte (partition exacte des joueurs, ≥ 2 chacune) ou au hasard.
  v_all := array(select p::text from unnest(p_players) p);
  if v_teams is not null and jsonb_typeof(v_teams) = 'object' then
    if jsonb_typeof(v_teams->'red') <> 'array' or jsonb_typeof(v_teams->'blue') <> 'array' then
      raise exception 'invalid_teams';
    end if;
    begin
      select coalesce(jsonb_agg(x::uuid::text order by random()), '[]'::jsonb) into v_red
        from jsonb_array_elements_text(v_teams->'red') x;
      select coalesce(jsonb_agg(x::uuid::text order by random()), '[]'::jsonb) into v_blue
        from jsonb_array_elements_text(v_teams->'blue') x;
    exception when others then
      raise exception 'invalid_teams';
    end;
    if jsonb_array_length(v_red) < 2 or jsonb_array_length(v_blue) < 2
       or jsonb_array_length(v_red) + jsonb_array_length(v_blue) <> v_n
       or exists (select 1 from jsonb_array_elements_text(v_red || v_blue) x where not (x = any(v_all)))
       or (select count(distinct x) from jsonb_array_elements_text(v_red || v_blue) x) <> v_n
    then
      raise exception 'invalid_teams';
    end if;
  else
    v_shuf := array(select x from unnest(v_all) x order by random());
    select jsonb_agg(v_shuf[i] order by i) into v_red from generate_series(1, v_n) i where i % 2 = 1;
    select jsonb_agg(v_shuf[i] order by i) into v_blue from generate_series(1, v_n) i where i % 2 = 0;
  end if;

  v_first := case when random() < 0.5 then 'red' else 'blue' end;

  v_state := jsonb_build_object(
    'game', 'devine-en-equipe',
    'phase', 'ready',
    'players', to_jsonb(p_players),
    'teams', jsonb_build_object('red', v_red, 'blue', v_blue),
    'round', 1,
    'total_rounds', 3,
    'total_words', jsonb_array_length(v_deck),
    'turn_seconds', v_secs,
    'team', v_first,
    'next_idx', jsonb_build_object('red', 0, 'blue', 0),
    'speaker', case when v_first = 'red' then v_red->>0 else v_blue->>0 end,
    'turn_no', 0,
    'card_no', 0,
    'pile_left', jsonb_array_length(v_deck),
    'carry_seconds', null,
    'scores', jsonb_build_object('red', 0, 'blue', 0),
    'round_scores', jsonb_build_array(
      jsonb_build_object('red', 0, 'blue', 0), jsonb_build_object('red', 0, 'blue', 0), jsonb_build_object('red', 0, 'blue', 0)),
    'speaker_points', (select jsonb_object_agg(p::text, 0) from unnest(p_players) p),
    'last_turn', null,
    'winners', null,
    'results', null);
  v_state := public._dee_ready(v_state, v_secs, false);

  return jsonb_build_object(
    'state', v_state,
    'server', jsonb_build_object('deck', v_deck, 'pile', public._dee_shuffled(jsonb_array_length(v_deck))),
    'secrets', '{}'::jsonb);
end $$;

-- -----------------------------------------------------------------------------
-- Actions
-- -----------------------------------------------------------------------------
create or replace function public.game_devine_en_equipe_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_type  text := p_action->>'type';
  v_phase text := p_state->>'phase';
  v_me    text := p_actor::text;
  v_team  text := p_state->>'team';
  v_round integer := (p_state->>'round')::integer;
  v_idx   integer;
  v_pile  jsonb := p_server->'pile';
  v_card  jsonb;
  v_carry integer;
  v_n     integer;
begin
  -- ---------------------------------------------------------------------- ready
  if v_type = 'ready' then
    if v_phase <> 'ready' then raise exception 'wrong_phase'; end if;
    if v_me <> p_state->>'speaker' then raise exception 'not_speaker'; end if;
    p_state := p_state || jsonb_build_object(
      'phase', 'playing',
      'card_no', (p_state->>'card_no')::integer + 1,
      'started_at', public._dee_iso(now()),
      'deadline', public._dee_iso(now() + make_interval(secs => (p_state->>'budget')::integer)),
      'pile_left', jsonb_array_length(v_pile));
    return jsonb_build_object('state', p_state, 'server', p_server,
                              'secrets', public._dee_card_secrets(p_state, p_server, true));

  -- --------------------------------------------------------------- found / pass
  elsif v_type in ('found', 'pass') then
    if v_phase <> 'playing' then raise exception 'wrong_phase'; end if;
    if v_me <> p_state->>'speaker' then raise exception 'not_speaker'; end if;
    begin
      v_idx := (p_action->>'index')::integer;
    exception when others then
      raise exception 'invalid_action';
    end;
    -- Double appui / carte périmée : ignoré sans erreur.
    if v_idx is null or v_idx <> (p_state->>'card_no')::integer then
      return jsonb_build_object('state', p_state, 'server', p_server);
    end if;
    -- Échéance dépassée (+ 1,5 s de tolérance réseau) : le passage se termine, rien ne compte.
    if now() >= (p_state->>'deadline')::timestamptz + interval '1.5 seconds' then
      return public._dee_end_passage(p_state, p_server, 'time');
    end if;
    v_card := p_server->'deck'->((v_pile->>0)::integer);

    if v_type = 'found' then
      v_pile := v_pile - 0;
      p_server := p_server || jsonb_build_object('pile', v_pile);
      p_state := jsonb_set(p_state, array['round_scores', (v_round - 1)::text, v_team],
                           to_jsonb((p_state->'round_scores'->(v_round - 1)->>v_team)::integer + 1));
      p_state := p_state || jsonb_build_object(
        'scores', (p_state->'scores') || jsonb_build_object(v_team, (p_state->'scores'->>v_team)::integer + 1),
        'speaker_points', (p_state->'speaker_points')
                          || jsonb_build_object(v_me, coalesce((p_state->'speaker_points'->>v_me)::integer, 0) + 1),
        'turn_found', (p_state->>'turn_found')::integer + 1,
        'turn_words', coalesce(p_state->'turn_words', '[]'::jsonb) || jsonb_build_array(v_card->>'word'),
        'pile_left', jsonb_array_length(v_pile));
      if jsonb_array_length(v_pile) = 0 then
        return public._dee_round_complete(p_state, p_server);
      end if;
    else
      -- Passer : la carte retourne en fin de pioche.
      p_server := p_server || jsonb_build_object('pile', (v_pile - 0) || jsonb_build_array(v_pile->0));
      p_state := p_state || jsonb_build_object('turn_passed', (p_state->>'turn_passed')::integer + 1);
    end if;
    p_state := p_state || jsonb_build_object('card_no', (p_state->>'card_no')::integer + 1);
    return jsonb_build_object('state', p_state, 'server', p_server,
                              'secrets', public._dee_card_secrets(p_state, p_server, false));

  -- ----------------------------------------------------------------------- tick
  elsif v_type = 'tick' then
    if v_phase = 'playing' and now() >= (p_state->>'deadline')::timestamptz then
      return public._dee_end_passage(p_state, p_server, 'time');
    end if;
    return jsonb_build_object('state', p_state, 'server', p_server);

  -- ------------------------------------------------------------------ skip_turn
  elsif v_type = 'skip_turn' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase not in ('ready', 'playing') then raise exception 'wrong_phase'; end if;
    return public._dee_end_passage(p_state, p_server, 'skip');

  -- ----------------------------------------------------------------- next_round
  elsif v_type = 'next_round' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase <> 'round_end' then raise exception 'wrong_phase'; end if;
    v_n := jsonb_array_length(p_server->'deck');
    v_carry := nullif(p_state->>'carry_seconds', '')::integer;
    p_server := p_server || jsonb_build_object('pile', public._dee_shuffled(v_n));
    p_state := p_state || jsonb_build_object('round', v_round + 1, 'pile_left', v_n, 'carry_seconds', null);
    p_state := public._dee_ready(p_state, coalesce(v_carry, (p_state->>'turn_seconds')::integer), v_carry is not null);
    return jsonb_build_object('state', p_state, 'server', p_server);

  else
    raise exception 'unknown_action';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Droits : fonctions internes, appelées uniquement via start_match / game_action.
-- -----------------------------------------------------------------------------
revoke all on function public._dee_iso(timestamptz) from public, anon, authenticated;
revoke all on function public._dee_other(text) from public, anon, authenticated;
revoke all on function public._dee_member(jsonb, text, integer) from public, anon, authenticated;
revoke all on function public._dee_shuffled(integer) from public, anon, authenticated;
revoke all on function public._dee_card_secrets(jsonb, jsonb, boolean) from public, anon, authenticated;
revoke all on function public._dee_ready(jsonb, integer, boolean) from public, anon, authenticated;
revoke all on function public._dee_rotate(jsonb) from public, anon, authenticated;
revoke all on function public._dee_recap(jsonb, text) from public, anon, authenticated;
revoke all on function public._dee_note(jsonb, boolean) from public, anon, authenticated;
revoke all on function public._dee_end_passage(jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public._dee_finish(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._dee_tstats(jsonb, text, text, boolean) from public, anon, authenticated;
revoke all on function public._dee_round_complete(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.game_devine_en_equipe_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_devine_en_equipe_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;


-- ===== games\le-plus-proche.sql =====
-- =============================================================================
-- JEU « le-plus-proche » : estimations chiffrées multi-écrans
-- =============================================================================
-- Idempotent (create or replace). Contrat : src/games/le-plus-proche/types.ts.
--
-- p_options : {"duration": 30, "questions": [{id, theme, difficulty, prompt, unit?, answer:number, note?}]}
-- Les réponses de référence (answer, note) et les estimations des joueurs restent dans
-- match_server_state jusqu'à la révélation. Chaque joueur retrouve SA saisie dans son
-- secret {"round", "value", "answered": true} (rechargement de page).
--
-- Phases : question -> reveal -> question ... -> finished.
--   question : fin quand tous ont répondu (valeur ou « je ne sais pas »), à l'échéance
--              (tick) ou par l'hôte (reveal).
--   reveal   : pas d'échéance, l'hôte enchaîne (next).
-- Toute action portant un "round" différent de la manche courante est ignorée sans erreur.
--
-- Points d'une manche : classement par écart absolu |estimation - réponse| (ex-aequo =
-- même rang, rang « sportif » : 1, 1, 3…) : rang 1 = 3 pts, rang 2 = 2 pts, rang 3 = 1 pt.
-- Bonus +5 si l'estimation est EXACTE : arrondie au nombre de décimales de la réponse de
-- référence, elle lui est égale (réponse entière 1665 : 1665 ou 1665,4 sont exactes,
-- 1666 non ; réponse 3,14 : 3,141 est exacte). Une estimation exacte compte comme
-- un écart nul pour le classement.

-- Valeur absolue maximale acceptée (questions et estimations) : 1e15
-- (au-delà, les nombres JS perdent leur précision entière).
create or replace function public._lpp_num(p jsonb)
returns numeric language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v numeric;
begin
  if p is null or jsonb_typeof(p) <> 'number' then return null; end if;
  v := (p #>> '{}')::numeric;
  if abs(v) > 1e15 then return null; end if;
  return trim_scale(round(v, 6));
end $$;

-- Ouvre la manche d'index p_idx (0-based).
create or replace function public._lpp_open(p_state jsonb, p_server jsonb, p_idx integer)
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
    'question', v_q - 'answer' - 'note' - 'decimals',
    'answered', '[]'::jsonb);
  p_server := p_server || jsonb_build_object('answers', '{}'::jsonb);
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

create or replace function public.game_le_plus_proche_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_in   jsonb := p_options->'questions';
  v_dur  integer;
  v_qs   jsonb := '[]'::jsonb;
  e      jsonb;
  v_ans  numeric;
  v_zero jsonb;
begin
  if cardinality(p_players) < 2 then raise exception 'not_enough_players'; end if;
  if cardinality(p_players) > 9 then raise exception 'too_many_players'; end if;
  if v_in is null or jsonb_typeof(v_in) <> 'array' or jsonb_array_length(v_in) = 0 then
    raise exception 'missing_questions';
  end if;
  begin
    v_dur := coalesce(nullif(p_options->>'duration', '')::integer, 30);
  exception when others then v_dur := 30;
  end;
  v_dur := least(greatest(v_dur, 10), 120);

  for e in select value from jsonb_array_elements(v_in) with ordinality t(value, o) order by o limit 30 loop
    v_ans := public._lpp_num(e->'answer');
    if jsonb_typeof(e) <> 'object' or jsonb_typeof(e->'prompt') <> 'string'
       or char_length(btrim(e->>'prompt')) = 0 or char_length(e->>'prompt') > 500
       or v_ans is null then
      raise exception 'invalid_questions';
    end if;
    v_qs := v_qs || jsonb_build_array(jsonb_build_object(
      'id', left(coalesce(e->>'id', ''), 40),
      'theme', left(coalesce(e->>'theme', ''), 40),
      'difficulty', case when e->>'difficulty' in ('1', '2', '3') then (e->>'difficulty')::integer end,
      'prompt', e->>'prompt',
      'unit', case when jsonb_typeof(e->'unit') = 'string' and btrim(e->>'unit') <> ''
                   then left(btrim(e->>'unit'), 30) end,
      'answer', v_ans,
      'decimals', least(scale(v_ans), 6),
      'note', case when jsonb_typeof(e->'note') = 'string' and btrim(e->>'note') <> ''
                   then left(btrim(e->>'note'), 400) end));
  end loop;

  select jsonb_object_agg(p::text, 0) into v_zero from unnest(p_players) p;

  return public._lpp_open(
    jsonb_build_object(
      'game', 'le-plus-proche',
      'round', 1,
      'total_rounds', jsonb_array_length(v_qs),
      'duration', v_dur,
      'players', to_jsonb(p_players),
      'scores', v_zero,
      'exacts', v_zero,
      'last_reveal', null,
      'history', '[]'::jsonb,
      'winners', null,
      'results', null),
    jsonb_build_object('questions', v_qs),
    0) || jsonb_build_object('secrets', '{}'::jsonb);
end $$;

-- Révélation : classement de la manche, points, publication des estimations.
create or replace function public._lpp_reveal(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_round   integer := (p_state->>'round')::integer;
  v_q       jsonb := p_server->'questions'->(v_round - 1);
  v_ans     numeric := (v_q->>'answer')::numeric;
  v_dec     integer := coalesce((v_q->>'decimals')::integer, 0);
  v_answers jsonb := coalesce(p_server->'answers', '{}'::jsonb);
  v_ranking jsonb;
  v_points  jsonb;
  v_exact   jsonb;
  v_reveal  jsonb;
begin
  with a as (
    select key as pid, (value #>> '{}')::numeric as v
      from jsonb_each(v_answers) where jsonb_typeof(value) = 'number'
  ), d as (
    select pid, v, round(v, v_dec) = v_ans as exact, abs(v - v_ans) as gap from a
  ), r as (
    select pid, v, exact, gap,
           rank() over (order by case when exact then 0 else gap end) as rk
      from d
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'profile_id', pid, 'value', v, 'gap', gap, 'rank', rk, 'exact', exact,
           'points', case rk when 1 then 3 when 2 then 2 when 3 then 1 else 0 end
                     + case when exact then 5 else 0 end)
         order by rk, gap, pid), '[]'::jsonb)
    into v_ranking from r;

  select coalesce(jsonb_object_agg(x->>'profile_id', (x->>'points')::integer), '{}'::jsonb)
    into v_points from jsonb_array_elements(v_ranking) x where (x->>'points')::integer > 0;
  select coalesce(jsonb_object_agg(x->>'profile_id', 1), '{}'::jsonb)
    into v_exact from jsonb_array_elements(v_ranking) x where (x->>'exact')::boolean;

  v_reveal := jsonb_build_object(
    'round', v_round,
    'question', p_state->'question',
    'answer', v_ans,
    'note', v_q->'note',
    'answers', v_answers,
    'ranking', v_ranking,
    'points', v_points);

  p_state := p_state || jsonb_build_object(
    'phase', 'reveal',
    'deadline', null,
    'scores', (select jsonb_object_agg(key, value::integer + coalesce((v_points->>key)::integer, 0))
                 from jsonb_each_text(p_state->'scores')),
    'exacts', (select jsonb_object_agg(key, value::integer + coalesce((v_exact->>key)::integer, 0))
                 from jsonb_each_text(p_state->'exacts')),
    'last_reveal', v_reveal,
    'history', coalesce(p_state->'history', '[]'::jsonb) || jsonb_build_array(
      v_reveal - 'points' - 'question' || jsonb_build_object(
        'id', v_q->'id', 'theme', v_q->'theme', 'prompt', v_q->'prompt', 'unit', v_q->'unit')));
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Stats de fin de partie pour les trophées (features/trophees.sql) : tout se lit dans history[].ranking.
create or replace function public._lpp_tstats(p_state jsonb, p_pl text)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  with h as (
    select e.o, (e.v->>'answer')::numeric as ans, e.v->'ranking' as rk
      from jsonb_array_elements(coalesce(p_state->'history', '[]'::jsonb)) with ordinality as e(v, o)
  ), m as (
    select h.o, h.ans,
           (select r from jsonb_array_elements(h.rk) r where r->>'profile_id' = p_pl limit 1) as me,
           jsonb_array_length(h.rk) as n,
           (select max((r->>'rank')::integer) from jsonb_array_elements(h.rk) r) as maxrank,
           (select count(*) from jsonb_array_elements(h.rk) r where (r->>'rank')::integer = 1) as nfirst
      from h
  ), x as (
    select m.o, m.ans, m.n, m.maxrank, m.nfirst, (m.me is not null) as ans_ok,
           coalesce((m.me->>'rank')::integer, 0) as rank, coalesce((m.me->>'points')::integer, 0) as pts,
           coalesce((m.me->>'exact')::boolean, false) as exact,
           (m.me->>'value')::numeric as val, (m.me->>'gap')::numeric as gap
      from m
  ), g1 as (
    select x.*, x.o - row_number() over (partition by (x.pts = 0) order by x.o) as grp from x
  ), g2 as (
    select x.*, x.o - row_number() over (partition by (x.rank = 1) order by x.o) as grp from x
  )
  select jsonb_build_object(
    'farthest', (select count(*) from x where ans_ok and n >= 3 and rank = maxrank and rank > 1),
    'way_off', (select count(*) from x where ans_ok and ans <> 0 and (abs(val) >= 10 * abs(ans) or abs(val) <= abs(ans) / 10)),
    'scoreless_run', coalesce((select max(c) from (select count(*) as c from g1 where pts = 0 group by grp) z), 0),
    'closest', (select count(*) from x where rank = 1),
    'seconds', (select count(*) from x where rank = 2),
    'tied_closest', (select count(*) from x where rank = 1 and nfirst >= 2),
    'near_miss', (select count(*) from x where rank = 1 and not exact and ans <> 0 and gap < abs(ans) * 0.01),
    'scored_all', case when (select count(*) from x) >= 8 and not exists (select 1 from x where pts = 0) then 1 else 0 end,
    'closest_run', coalesce((select max(c) from (select count(*) as c from g2 where rank = 1 group by grp) z), 0))
$$;

create or replace function public._lpp_finish(p_state jsonb, p_server jsonb)
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
           'stats', jsonb_build_object('exacts', coalesce((p_state->'exacts'->>t.key)::integer, 0))
                    || public._lpp_tstats(p_state, t.key))
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

create or replace function public.game_le_plus_proche_action(
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
  v_same     jsonb := jsonb_build_object('state', p_state, 'server', p_server);
  v_val      numeric;
  v_res      jsonb;
begin
  if v_type is null or v_type not in ('answer', 'reveal', 'next', 'tick') then
    raise exception 'unknown_action';
  end if;
  if v_phase not in ('question', 'reveal') then return v_same; end if;
  if p_action ? 'round' and (p_action->>'round') is distinct from (p_state->>'round') then
    return v_same;
  end if;

  if v_type = 'tick' then
    if v_phase <> 'question' or v_deadline is null or now() < v_deadline then return v_same; end if;
    return public._lpp_reveal(p_state, p_server);

  elsif v_type = 'reveal' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase <> 'question' then return v_same; end if;
    return public._lpp_reveal(p_state, p_server);

  elsif v_type = 'next' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase <> 'reveal' then return v_same; end if;
    if v_round >= v_total then return public._lpp_finish(p_state, p_server); end if;
    return public._lpp_open(p_state, p_server, v_round);
  end if;

  -- answer : {"value": number|null, "round"} ; null = « je ne sais pas ».
  if not (p_state->'players' ? v_me) then raise exception 'not_a_player'; end if;
  if v_phase <> 'question' then return v_same; end if;
  if not (p_action ? 'value') then raise exception 'invalid_number'; end if;
  if jsonb_typeof(p_action->'value') = 'null' then
    v_val := null;
  elsif jsonb_typeof(p_action->'value') = 'number' then
    v_val := public._lpp_num(p_action->'value');
    if v_val is null then raise exception 'number_out_of_range'; end if;
  else
    raise exception 'invalid_number';
  end if;
  -- Échéance dépassée : la saisie tardive n'est pas prise, on révèle.
  if v_deadline is not null and now() >= v_deadline then
    return public._lpp_reveal(p_state, p_server);
  end if;

  p_server := jsonb_set(p_server, array['answers', v_me], coalesce(to_jsonb(v_val), 'null'::jsonb), true);
  if not (p_state->'answered' ? v_me) then
    p_state := jsonb_set(p_state, '{answered}', (p_state->'answered') || to_jsonb(v_me));
  end if;

  if not exists (select 1 from jsonb_array_elements_text(p_state->'players') pl
                  where not (p_state->'answered' ? pl)) then
    v_res := public._lpp_reveal(p_state, p_server);
  else
    v_res := jsonb_build_object('state', p_state, 'server', p_server);
  end if;
  return v_res || jsonb_build_object('secrets', jsonb_build_object(v_me, jsonb_build_object(
    'round', v_round, 'value', v_val, 'answered', true)));
end $$;

revoke all on function public._lpp_num(jsonb) from public, anon, authenticated;
revoke all on function public._lpp_open(jsonb, jsonb, integer) from public, anon, authenticated;
revoke all on function public._lpp_reveal(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._lpp_finish(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._lpp_tstats(jsonb, text) from public, anon, authenticated;
revoke all on function public.game_le_plus_proche_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_le_plus_proche_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;


-- ===== games\loup-garou.sql =====
-- =============================================================================
-- JEU « Loup-garou » (id loup-garou) — jeu de rôles caché multi-écrans
-- Idempotent (create or replace). Dispatché par start_match / game_action.
-- Contrat complet (state public, secrets, actions, choix de règles) :
--   src/games/loup-garou/types.ts
--
-- Rôles : loup, villageois, voyante, sorciere, cupidon, chasseur, protecteur.
-- Phases : roles -> night(step) -> reveal(dawn) -> [hunter -> reveal(hunter)]
--          -> day -> vote -> reveal(vote) -> [hunter…] -> night … -> finished
-- Étapes de nuit (ordre) : cupidon, amoureux (nuit 1 seulement) -> voyante ->
--   protecteur -> loups -> sorciere. Une étape existe si le rôle est dans la
--   composition (publique), qu'il soit vivant ou non : durée minimale + aléa
--   pour ne pas trahir qui est mort.
-- Rien de secret dans le state public : rôles, votes des loups, résultats de la
-- voyante, potions, amoureux et cible des loups vivent dans `server` + secrets.
-- =============================================================================

create or replace function public._lg_iso(p_ts timestamptz)
returns text language sql stable
set search_path = public, extensions
as $$
  select to_char(p_ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$$;

-- Composition suggérée selon le nombre de joueurs (miroir de suggestComposition
-- dans src/games/loup-garou/types.ts). Les villageois complètent.
create or replace function public._lg_suggest(p_n integer)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select (case
    when p_n <= 5 then '{"loup":1,"voyante":1,"sorciere":1,"chasseur":0,"cupidon":0,"protecteur":0}'
    when p_n = 6  then '{"loup":2,"voyante":1,"sorciere":1,"chasseur":1,"cupidon":0,"protecteur":0}'
    when p_n = 7  then '{"loup":2,"voyante":1,"sorciere":1,"chasseur":1,"cupidon":1,"protecteur":0}'
    when p_n = 8  then '{"loup":2,"voyante":1,"sorciere":1,"chasseur":1,"cupidon":1,"protecteur":1}'
    else               '{"loup":2,"voyante":1,"sorciere":1,"chasseur":1,"cupidon":1,"protecteur":1}'
  end)::jsonb;
$$;

-- Durées des étapes de nuit (secondes) : minimum (même si le rôle est mort) et maximum.
create or replace function public._lg_step_min(p_step text)
returns integer language sql immutable
set search_path = public, extensions
as $$
  select case p_step when 'cupidon' then 15 when 'amoureux' then 10 when 'voyante' then 12
                     when 'protecteur' then 10 when 'loups' then 18 when 'sorciere' then 12 else 10 end;
$$;

create or replace function public._lg_step_max(p_step text)
returns integer language sql immutable
set search_path = public, extensions
as $$
  select case p_step when 'cupidon' then 45 when 'amoureux' then 10 when 'voyante' then 40
                     when 'protecteur' then 35 when 'loups' then 75 when 'sorciere' then 45 else 30 end;
$$;

-- Joueurs vivants ayant le rôle p_role (ordre de `alive`).
create or replace function public._lg_alive_role(p_state jsonb, p_server jsonb, p_role text)
returns text[] language sql immutable
set search_path = public, extensions
as $$
  select coalesce(array_agg(a order by o), '{}'::text[])
    from jsonb_array_elements_text(p_state->'alive') with ordinality as t(a, o)
   where p_server->'roles'->>a = p_role;
$$;

-- Étapes de la nuit courante (state.night), selon la composition publique.
create or replace function public._lg_steps(p_state jsonb)
returns text[] language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v text[] := '{}';
  c jsonb  := p_state->'composition';
begin
  if coalesce((p_state->>'night')::integer, 1) = 1 and coalesce((c->>'cupidon')::integer, 0) > 0 then
    v := array_append(v, 'cupidon');
    v := array_append(v, 'amoureux');
  end if;
  if coalesce((c->>'voyante')::integer, 0) > 0 then v := array_append(v, 'voyante'); end if;
  if coalesce((c->>'protecteur')::integer, 0) > 0 then v := array_append(v, 'protecteur'); end if;
  v := array_append(v, 'loups');
  if coalesce((c->>'sorciere')::integer, 0) > 0 then v := array_append(v, 'sorciere'); end if;
  return v;
end $$;

-- Joueurs qui doivent agir pendant l'étape (vivants avec le rôle).
create or replace function public._lg_actors(p_state jsonb, p_server jsonb, p_step text)
returns text[] language plpgsql immutable
set search_path = public, extensions
as $$
begin
  return case p_step
    when 'cupidon'    then public._lg_alive_role(p_state, p_server, 'cupidon')
    when 'voyante'    then public._lg_alive_role(p_state, p_server, 'voyante')
    when 'protecteur' then public._lg_alive_role(p_state, p_server, 'protecteur')
    when 'loups'      then public._lg_alive_role(p_state, p_server, 'loup')
    when 'sorciere'   then case
      when coalesce((p_server->'potions'->>'life')::boolean, false)
        or coalesce((p_server->'potions'->>'death')::boolean, false)
      then public._lg_alive_role(p_state, p_server, 'sorciere') else '{}'::text[] end
    else '{}'::text[] end;
end $$;

create or replace function public._lg_pair(p_state jsonb, p_server jsonb)
returns jsonb language sql immutable
set search_path = public, extensions
as $$ select jsonb_build_object('state', p_state, 'server', p_server); $$;

-- Début d'une étape de nuit. Échéance : max si un acteur vivant doit agir,
-- sinon min + aléa (0-6 s) pour simuler une hésitation.
create or replace function public._lg_begin_step(p_state jsonb, p_server jsonb, p_step text)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_min    integer := public._lg_step_min(p_step);
  v_max    integer := public._lg_step_max(p_step);
  v_actors text[];
  v_secs   double precision;
begin
  p_server := p_server || jsonb_build_object('done', false);
  if p_step = 'loups' then p_server := p_server || jsonb_build_object('wolf_votes', '{}'::jsonb); end if;
  if p_step = 'amoureux' then p_server := p_server || jsonb_build_object('lovers_known', true); end if;
  v_actors := public._lg_actors(p_state, p_server, p_step);
  v_secs := case when p_step = 'amoureux' then v_max
                 when cardinality(v_actors) = 0 then v_min + random() * 6
                 else v_max end;
  p_state := p_state || jsonb_build_object(
    'phase', 'night', 'step', p_step,
    'step_started', public._lg_iso(now()), 'step_max', v_max,
    'deadline', public._lg_iso(now() + make_interval(secs => v_secs)));
  return public._lg_pair(p_state, p_server);
end $$;

-- L'acteur a fini : l'étape se termine au plus tôt à début + min (+ aléa 0-3 s).
create or replace function public._lg_mark_done(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_min_end timestamptz := (p_state->>'step_started')::timestamptz
                           + make_interval(secs => public._lg_step_min(p_state->>'step'));
begin
  p_server := p_server || jsonb_build_object('done', true);
  p_state := p_state || jsonb_build_object('deadline',
    public._lg_iso(greatest(now(), v_min_end) + make_interval(secs => random() * 3)));
  return public._lg_pair(p_state, p_server);
end $$;

create or replace function public._lg_cur(p_server jsonb, p_key text, p_val jsonb)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select p_server || jsonb_build_object('cur', coalesce(p_server->'cur', '{}'::jsonb) || jsonb_build_object(p_key, p_val));
$$;

-- Tue un joueur (si vivant) : rôle révélé, chasseur en attente, chagrin de l'amoureux.
create or replace function public._lg_kill(p_state jsonb, p_server jsonb, p_id text, p_cause text)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_role  text := p_server->'roles'->>p_id;
  v_entry jsonb;
  v_other text;
begin
  if p_id is null or not coalesce((p_state->'alive') ? p_id, false) then
    return public._lg_pair(p_state, p_server);
  end if;
  p_state := p_state || jsonb_build_object('alive',
    (select coalesce(jsonb_agg(a order by o), '[]'::jsonb)
       from jsonb_array_elements_text(p_state->'alive') with ordinality as t(a, o) where a <> p_id));
  v_entry := jsonb_build_object('id', p_id, 'role', v_role, 'cause', p_cause,
                                'night', coalesce((p_state->>'night')::integer, 0),
                                'when', coalesce(p_state->'reveal'->>'kind', 'dawn'));
  p_state := p_state || jsonb_build_object('dead', coalesce(p_state->'dead', '[]'::jsonb) || jsonb_build_array(v_entry));
  if jsonb_typeof(p_state->'reveal') = 'object' then
    p_state := jsonb_set(p_state, '{reveal,deaths}',
                         coalesce(p_state->'reveal'->'deaths', '[]'::jsonb) || jsonb_build_array(v_entry));
  end if;
  if v_role = 'chasseur' then
    p_state := p_state || jsonb_build_object('hunter_pending', p_id);
  end if;
  if coalesce(p_server->'lovers', '[]'::jsonb) ? p_id then
    select x into v_other from jsonb_array_elements_text(p_server->'lovers') x where x <> p_id limit 1;
    return public._lg_kill(p_state, p_server, v_other, 'chagrin');
  end if;
  return public._lg_pair(p_state, p_server);
end $$;

-- Camp d'un joueur : 'amoureux' (couple mixte loup + non-loup), 'loups' ou 'village'.
create or replace function public._lg_camp(p_server jsonb, p_id text)
returns text language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_l jsonb := coalesce(p_server->'lovers', '[]'::jsonb);
begin
  if jsonb_array_length(v_l) = 2 and v_l ? p_id
     and ((p_server->'roles'->>(v_l->>0)) = 'loup') <> ((p_server->'roles'->>(v_l->>1)) = 'loup') then
    return 'amoureux';
  end if;
  return case when p_server->'roles'->>p_id = 'loup' then 'loups' else 'village' end;
end $$;

-- Vainqueur ou null.
--  * amoureux mixtes vivants : gagnent s'ils sont les 2 derniers ; les loups
--    « purs » gagnent s'ils sont au moins aussi nombreux que les autres vivants.
--  * sinon : village si plus aucun loup vivant ; loups si loups >= autres vivants.
create or replace function public._lg_winner(p_state jsonb, p_server jsonb)
returns text language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_alive  text[] := array(select jsonb_array_elements_text(p_state->'alive'));
  v_n      integer := cardinality(v_alive);
  v_wolves integer := cardinality(public._lg_alive_role(p_state, p_server, 'loup'));
  v_l      jsonb := coalesce(p_server->'lovers', '[]'::jsonb);
  v_pure   integer;
begin
  if jsonb_array_length(v_l) = 2 and public._lg_camp(p_server, v_l->>0) = 'amoureux'
     and (v_l->>0) = any(v_alive) and (v_l->>1) = any(v_alive) then
    if v_n = 2 then return 'amoureux'; end if;
    v_pure := v_wolves - 1;
    if v_pure > 0 and v_pure >= v_n - v_pure then return 'loups'; end if;
    return null;
  end if;
  if v_wolves = 0 then return 'village'; end if;
  if v_wolves >= v_n - v_wolves then return 'loups'; end if;
  return null;
end $$;

-- Stats de fin de partie pour les trophées (features/trophees.sql), lues dans dead / history / nights.
create or replace function public._lg_tstats(p_state jsonb, p_server jsonb, p_pl text, p_winner text)
returns jsonb language plpgsql stable
set search_path = public, extensions
as $$
declare
  v_roles   jsonb := coalesce(p_server->'roles', '{}'::jsonb);
  v_role    text := v_roles->>p_pl;
  v_won     boolean := public._lg_camp(p_server, p_pl) = p_winner;
  v_alive   boolean := coalesce((p_state->'alive') ? p_pl, false);
  v_hist    jsonb := coalesce(p_state->'history', '[]'::jsonb);
  v_recv    integer;
  v_wvotes  integer;
  v_powers  integer := 0;
  v_wolves_alive integer;
  v_wolves_start integer;
begin
  -- votes du village contre moi / votes que j'ai donnés à un loup (révélations de vote)
  select count(*) filter (where v.value = p_pl),
         count(*) filter (where v.key = p_pl and v_roles->>v.value = 'loup')
    into v_recv, v_wvotes
    from jsonb_array_elements(v_hist) h, jsonb_each_text(coalesce(h->'votes', '{}'::jsonb)) v
   where h->>'kind' = 'vote';

  -- pouvoirs réussis
  if v_role = 'voyante' then
    select count(*) into v_powers from jsonb_array_elements(coalesce(p_server->'nights', '[]'::jsonb)) n
     where n->>'seer' is not null and v_roles->>(n->>'seer') = 'loup';
  elsif v_role = 'sorciere' then
    select count(*) into v_powers from jsonb_array_elements(coalesce(p_server->'nights', '[]'::jsonb)) n
     where n->>'saved' is not null;
  elsif v_role = 'protecteur' then
    select count(*) into v_powers from jsonb_array_elements(coalesce(p_server->'nights', '[]'::jsonb)) n
     where n->>'protect' is not null and n->>'protect' = n->>'wolves';
  elsif v_role = 'chasseur' then
    select count(*) into v_powers from jsonb_array_elements(v_hist) h
     where h->>'kind' = 'hunter' and h->>'hunter' = p_pl and h->>'target' is not null
       and v_roles->>(h->>'target') = 'loup';
  end if;

  select count(*) filter (where v.value = 'loup' and (p_state->'alive') ? v.key),
         count(*) filter (where v.value = 'loup')
    into v_wolves_alive, v_wolves_start
    from jsonb_each_text(v_roles) v;

  return jsonb_build_object(
    'first_night_death', case when exists (select 1 from jsonb_array_elements(coalesce(p_state->'dead', '[]'::jsonb)) d
        where d->>'id' = p_pl and d->>'cause' = 'night' and (d->>'night')::integer = 1) then 1 else 0 end,
    'lynched_innocent', case when v_role <> 'loup' and exists (select 1 from jsonb_array_elements(coalesce(p_state->'dead', '[]'::jsonb)) d
        where d->>'id' = p_pl and d->>'cause' = 'vote') then 1 else 0 end,
    'died', case when v_alive then 0 else 1 end,
    'survived', case when v_alive then 1 else 0 end,
    'wolf_votes', v_wvotes,
    'won_village', case when v_won and public._lg_camp(p_server, p_pl) = 'village' then 1 else 0 end,
    'won_wolf', case when v_won and v_role = 'loup' then 1 else 0 end,
    'powers', v_powers,
    'simple_win', case when v_won and v_role = 'villageois' and v_alive then 1 else 0 end,
    'lamb', case when v_won and v_role = 'loup' and v_recv = 0 then 1 else 0 end,
    'lone_wolf', case when v_won and v_role = 'loup' and v_alive and v_wolves_alive = 1 and v_wolves_start >= 2 then 1 else 0 end);
end $$;

-- Fin de partie : rôles, amoureux et chronique des nuits rendus publics.
create or replace function public._lg_finish(p_state jsonb, p_server jsonb, p_winner text)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_results jsonb := '[]'::jsonb;
  p         text;
  v_won     boolean;
  v_alive   boolean;
begin
  for p in select jsonb_array_elements_text(p_state->'players') loop
    v_won := public._lg_camp(p_server, p) = p_winner;
    v_alive := (p_state->'alive') ? p;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'profile_id', p, 'won', v_won,
      'points', case when v_won and v_alive then 3 when v_won then 2 else 0 end,
      'placement', case when v_won then 1 else 2 end,
      'stats', public._lg_tstats(p_state, p_server, p, p_winner)));
  end loop;
  p_state := p_state || jsonb_build_object(
    'phase', 'finished', 'winner', p_winner, 'step', null, 'deadline', null, 'hunter', null,
    'roles', p_server->'roles', 'lovers', coalesce(p_server->'lovers', '[]'::jsonb),
    'chronicle', coalesce(p_server->'nights', '[]'::jsonb), 'results', v_results);
  return public._lg_pair(p_state, p_server);
end $$;

create or replace function public._lg_begin_night(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
begin
  p_state := p_state || jsonb_build_object(
    'night', coalesce((p_state->>'night')::integer, 0) + 1,
    'reveal', null, 'votes', '{}'::jsonb, 'candidates', '[]'::jsonb, 'revote', false, 'first_vote', null);
  p_server := p_server || jsonb_build_object(
    'cur', jsonb_build_object('night', (p_state->>'night')::integer),
    'victim', null, 'protected', null, 'saved', false, 'poison', null);
  return public._lg_begin_step(p_state, p_server, (public._lg_steps(p_state))[1]);
end $$;

-- Fin de la nuit : morts (victime des loups sauf protégée/sauvée, empoisonné).
create or replace function public._lg_resolve_night(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_victim text := p_server->>'victim';
  v_r      jsonb;
  v_n      integer;
  v_cur    jsonb;
begin
  p_state := p_state || jsonb_build_object(
    'phase', 'reveal', 'step', null, 'after', 'day',
    'reveal', jsonb_build_object('kind', 'dawn', 'night', (p_state->>'night')::integer, 'deaths', '[]'::jsonb));
  if v_victim is not null and v_victim is distinct from p_server->>'protected'
     and not coalesce((p_server->>'saved')::boolean, false) then
    v_r := public._lg_kill(p_state, p_server, v_victim, 'night');
    p_state := v_r->'state'; p_server := v_r->'server';
  end if;
  if p_server->>'poison' is not null then
    v_r := public._lg_kill(p_state, p_server, p_server->>'poison', 'night');
    p_state := v_r->'state'; p_server := v_r->'server';
  end if;
  v_cur := coalesce(p_server->'cur', '{}'::jsonb) || jsonb_build_object(
    'night', (p_state->>'night')::integer,
    'deaths', (select coalesce(jsonb_agg(d->'id'), '[]'::jsonb) from jsonb_array_elements(p_state->'reveal'->'deaths') d));
  p_server := p_server || jsonb_build_object(
    'nights', coalesce(p_server->'nights', '[]'::jsonb) || jsonb_build_array(v_cur),
    'cur', null, 'last_protected', p_server->'protected', 'protected', null,
    'victim', null, 'saved', false, 'poison', null, 'wolf_votes', '{}'::jsonb, 'done', false);
  v_n := jsonb_array_length(p_state->'reveal'->'deaths');
  p_state := p_state || jsonb_build_object('deadline', public._lg_iso(now() + make_interval(secs => 10 + 4 * v_n)));
  return public._lg_pair(p_state, p_server);
end $$;

-- Fin d'une étape de nuit (échéance) : choix par défaut puis étape suivante.
create or replace function public._lg_end_step(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_step   text := p_state->>'step';
  v_steps  text[] := public._lg_steps(p_state);
  v_idx    integer;
  v_wolves text[];
  v_target text;
begin
  if v_step = 'loups' then
    v_wolves := public._lg_alive_role(p_state, p_server, 'loup');
    -- Majorité des loups vivants ; égalité -> tirage parmi les ex-aequo ; aucun vote -> personne.
    select t into v_target from (
      select value as t, count(*) as c
        from jsonb_each_text(coalesce(p_server->'wolf_votes', '{}'::jsonb))
       where key = any(v_wolves) and (p_state->'alive') ? value
       group by value) x
     order by c desc, random() limit 1;
    p_server := p_server || jsonb_build_object('victim', v_target);
    p_server := public._lg_cur(p_server, 'wolves', to_jsonb(v_target));
  end if;
  v_idx := array_position(v_steps, v_step);
  if v_idx is not null and v_idx < cardinality(v_steps) then
    return public._lg_begin_step(p_state, p_server, v_steps[v_idx + 1]);
  end if;
  return public._lg_resolve_night(p_state, p_server);
end $$;

create or replace function public._lg_begin_vote(p_state jsonb, p_server jsonb, p_candidates jsonb, p_revote boolean)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
begin
  p_state := p_state || jsonb_build_object(
    'phase', 'vote', 'votes', '{}'::jsonb, 'candidates', p_candidates, 'revote', p_revote,
    'deadline', public._lg_iso(now() + interval '75 seconds'));
  return public._lg_pair(p_state, p_server);
end $$;

-- Dépouillement : majorité relative ; 1re égalité -> revote entre ex-aequo ;
-- 2e égalité -> personne n'est éliminé ; aucun vote -> personne.
create or replace function public._lg_tally(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_counts  jsonb;
  v_max     integer;
  v_tied    jsonb;
  v_elim    text;
  v_outcome text;
  v_r       jsonb;
begin
  select coalesce(jsonb_object_agg(t, c), '{}'::jsonb), max(c) into v_counts, v_max from (
    select value as t, count(*)::integer as c
      from jsonb_each_text(coalesce(p_state->'votes', '{}'::jsonb))
     where (p_state->'alive') ? key and (p_state->'alive') ? value
     group by value) x;
  select coalesce(jsonb_agg(key order by key), '[]'::jsonb) into v_tied
    from jsonb_each_text(v_counts) where value::integer = v_max;

  if v_max is null then
    v_outcome := 'none';
  elsif jsonb_array_length(v_tied) = 1 then
    v_outcome := 'majority';
    v_elim := v_tied->>0;
  elsif not coalesce((p_state->>'revote')::boolean, false) then
    p_state := p_state || jsonb_build_object('first_vote',
      jsonb_build_object('votes', p_state->'votes', 'counts', v_counts, 'tied', v_tied));
    return public._lg_begin_vote(p_state, p_server, v_tied, true);
  else
    v_outcome := 'tie';
  end if;

  p_state := p_state || jsonb_build_object(
    'phase', 'reveal', 'after', 'night',
    'reveal', jsonb_build_object('kind', 'vote', 'night', (p_state->>'night')::integer,
                                 'votes', p_state->'votes', 'counts', v_counts, 'tied', v_tied,
                                 'outcome', v_outcome, 'eliminated', v_elim,
                                 'revote', coalesce((p_state->>'revote')::boolean, false),
                                 'deaths', '[]'::jsonb));
  if v_elim is not null then
    v_r := public._lg_kill(p_state, p_server, v_elim, 'vote');
    p_state := v_r->'state'; p_server := v_r->'server';
  end if;
  p_state := p_state || jsonb_build_object('deadline', public._lg_iso(now() + make_interval(
    secs => 10 + 4 * jsonb_array_length(p_state->'reveal'->'deaths'))));
  return public._lg_pair(p_state, p_server);
end $$;

-- Tir du chasseur (p_target null = pas de tir).
create or replace function public._lg_hunter_done(p_state jsonb, p_server jsonb, p_target text)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_r jsonb;
begin
  p_state := p_state || jsonb_build_object(
    'phase', 'reveal',
    'reveal', jsonb_build_object('kind', 'hunter', 'night', (p_state->>'night')::integer,
                                 'hunter', p_state->'hunter', 'target', p_target, 'deaths', '[]'::jsonb),
    'hunter', null);
  if p_target is not null then
    v_r := public._lg_kill(p_state, p_server, p_target, 'chasseur');
    p_state := v_r->'state'; p_server := v_r->'server';
  end if;
  p_state := p_state || jsonb_build_object('deadline', public._lg_iso(now() + make_interval(
    secs => 8 + 4 * jsonb_array_length(p_state->'reveal'->'deaths'))));
  return public._lg_pair(p_state, p_server);
end $$;

-- Après une révélation : chasseur en attente, sinon victoire, sinon jour / nuit.
create or replace function public._lg_after_reveal(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_w text;
begin
  if jsonb_typeof(p_state->'reveal') = 'object' then
    p_state := p_state || jsonb_build_object('history',
      coalesce(p_state->'history', '[]'::jsonb) || jsonb_build_array(p_state->'reveal'));
  end if;
  if p_state->>'hunter_pending' is not null then
    p_state := p_state || jsonb_build_object(
      'phase', 'hunter', 'hunter', p_state->'hunter_pending', 'hunter_pending', null,
      'deadline', public._lg_iso(now() + interval '40 seconds'));
    return public._lg_pair(p_state, p_server);
  end if;
  v_w := public._lg_winner(p_state, p_server);
  if v_w is not null then
    return public._lg_finish(p_state, p_server, v_w);
  end if;
  if p_state->>'after' = 'day' then
    p_state := p_state || jsonb_build_object(
      'phase', 'day', 'reveal', null, 'votes', '{}'::jsonb, 'candidates', '[]'::jsonb, 'revote', false,
      'first_vote', null,
      'deadline', public._lg_iso(now() + make_interval(secs => coalesce((p_state->>'debate_seconds')::integer, 180))));
    return public._lg_pair(p_state, p_server);
  end if;
  return public._lg_begin_night(p_state, p_server);
end $$;

-- Secrets de tous les joueurs (+ meneur non joueur), recalculés à chaque action.
create or replace function public._lg_secrets(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_out    jsonb := '{}'::jsonb;
  p        text;
  r        text;
  s        jsonb;
  v_step   text := case when p_state->>'phase' = 'night' then p_state->>'step' end;
  v_actors text[] := case when p_state->>'phase' = 'night'
                          then public._lg_actors(p_state, p_server, p_state->>'step') else '{}'::text[] end;
  v_known  boolean := coalesce((p_server->>'lovers_known')::boolean, false);
  v_lovers jsonb := coalesce(p_server->'lovers', '[]'::jsonb);
  v_wolves jsonb;
  v_other  text;
begin
  select coalesce(jsonb_agg(a order by o), '[]'::jsonb) into v_wolves
    from jsonb_array_elements_text(p_state->'players') with ordinality as t(a, o)
   where p_server->'roles'->>a = 'loup';
  for p in select jsonb_array_elements_text(p_state->'players') loop
    r := p_server->'roles'->>p;
    s := jsonb_build_object('role', r, 'night', coalesce((p_state->>'night')::integer, 0),
                            'step', v_step, 'acting', p = any(v_actors),
                            'done', p = any(v_actors) and coalesce((p_server->>'done')::boolean, false));
    if r = 'loup' then
      s := s || jsonb_build_object('wolves', v_wolves,
        'wolf_votes', case when v_step = 'loups' then coalesce(p_server->'wolf_votes', '{}'::jsonb) else '{}'::jsonb end);
    elsif r = 'voyante' then
      s := s || jsonb_build_object('seer', coalesce(p_server->'seer', '[]'::jsonb));
    elsif r = 'sorciere' then
      s := s || jsonb_build_object('potions', p_server->'potions',
        'victim', case when v_step = 'sorciere' then p_server->'victim' else 'null'::jsonb end);
    elsif r = 'protecteur' then
      s := s || jsonb_build_object('last_protected', coalesce(p_server->'last_protected', 'null'::jsonb));
    end if;
    if v_known and v_lovers ? p then
      select x into v_other from jsonb_array_elements_text(v_lovers) x where x <> p limit 1;
      s := s || jsonb_build_object('lover', jsonb_build_object(
        'id', v_other, 'role', p_server->'roles'->>v_other,
        'mixed', public._lg_camp(p_server, p) = 'amoureux'));
    end if;
    v_out := v_out || jsonb_build_object(p, s);
  end loop;
  if p_state->>'narrator' is not null then
    v_out := v_out || jsonb_build_object(p_state->>'narrator', jsonb_build_object(
      'narrator', true, 'roles', p_server->'roles', 'step', v_step,
      'lovers', case when v_known then v_lovers else '[]'::jsonb end));
  end if;
  return v_out;
end $$;

create or replace function public._lg_out(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
begin
  if p_state->>'phase' = 'finished' then
    return jsonb_build_object('state', p_state, 'server', p_server,
                              'secrets', public._lg_secrets(p_state, p_server), 'results', p_state->'results');
  end if;
  return jsonb_build_object('state', p_state, 'server', p_server, 'secrets', public._lg_secrets(p_state, p_server));
end $$;

-- -----------------------------------------------------------------------------
-- Démarrage
-- Options : {"composition": {"loup":2,"voyante":1,"sorciere":1,"chasseur":1,
--            "cupidon":1,"protecteur":1}, "debate_seconds": 180, "host_plays": true}
-- Composition absente -> suggestion automatique. host_plays=false : l'hôte (appelant
-- de start_match) est retiré des joueurs et devient meneur (secret : tous les rôles).
-- -----------------------------------------------------------------------------
create or replace function public.game_loup_garou_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  v_opts    jsonb := coalesce(p_options, '{}'::jsonb);
  v_host    text := public.current_profile_id()::text;
  v_players text[] := array(select x::text from unnest(p_players) x);
  v_narr    text;
  v_n       integer;
  v_comp    jsonb;
  v_l       integer;
  v_sum     integer;
  v_k       text;
  v_v       integer;
  v_deck    text[] := '{}';
  v_roles   jsonb := '{}'::jsonb;
  v_debate  integer := coalesce((v_opts->>'debate_seconds')::integer, 180);
  v_state   jsonb;
  v_server  jsonb;
  i         integer;
begin
  if v_host is not null and coalesce((v_opts->>'host_plays')::boolean, true) = false then
    v_players := array_remove(v_players, v_host);
  end if;
  if v_host is not null and not (v_host = any(v_players)) then v_narr := v_host; end if;
  v_n := cardinality(v_players);
  if v_n < 5 then raise exception 'not_enough_players'; end if;
  if v_n > 9 then raise exception 'too_many_players'; end if;

  v_comp := case when jsonb_typeof(v_opts->'composition') = 'object' then v_opts->'composition'
                 else public._lg_suggest(v_n) end;
  begin
    v_l := coalesce((v_comp->>'loup')::integer, 0);
    v_sum := v_l;
    foreach v_k in array array['voyante', 'sorciere', 'chasseur', 'cupidon', 'protecteur'] loop
      v_v := coalesce((v_comp->>v_k)::integer, 0);
      if v_v not in (0, 1) then raise exception 'invalid_composition'; end if;
      v_sum := v_sum + v_v;
      if v_v = 1 then v_deck := array_append(v_deck, v_k); end if;
    end loop;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'invalid_composition';
  end;
  if v_l < 1 or v_l * 2 >= v_n or v_sum > v_n then raise exception 'invalid_composition'; end if;
  for i in 1 .. v_l loop v_deck := array_append(v_deck, 'loup'); end loop;
  for i in 1 .. v_n - v_sum loop v_deck := array_append(v_deck, 'villageois'); end loop;

  select jsonb_object_agg(p, r) into v_roles
    from (select p, row_number() over () as k from unnest(v_players) as p) a
    join (select r, row_number() over () as k from (select r from unnest(v_deck) as r order by random()) z) b
      using (k);

  if v_debate < 30 or v_debate > 900 then v_debate := 180; end if;

  v_state := jsonb_build_object(
    'game', 'loup-garou', 'phase', 'roles',
    'players', to_jsonb(v_players), 'alive', to_jsonb(v_players), 'narrator', v_narr,
    'composition', jsonb_build_object(
      'loup', v_l, 'villageois', v_n - v_sum,
      'voyante', coalesce((v_comp->>'voyante')::integer, 0),
      'sorciere', coalesce((v_comp->>'sorciere')::integer, 0),
      'chasseur', coalesce((v_comp->>'chasseur')::integer, 0),
      'cupidon', coalesce((v_comp->>'cupidon')::integer, 0),
      'protecteur', coalesce((v_comp->>'protecteur')::integer, 0)),
    'debate_seconds', v_debate,
    'night', 0, 'step', null, 'step_started', null, 'step_max', null,
    'deadline', public._lg_iso(now() + interval '120 seconds'),
    'votes', '{}'::jsonb, 'candidates', '[]'::jsonb, 'revote', false, 'first_vote', null,
    'reveal', null, 'after', null, 'hunter', null, 'hunter_pending', null,
    'dead', '[]'::jsonb, 'history', '[]'::jsonb,
    'winner', null, 'roles', null, 'lovers', null, 'chronicle', null, 'results', null);
  v_server := jsonb_build_object(
    'roles', v_roles, 'lovers', '[]'::jsonb, 'lovers_known', false,
    'potions', jsonb_build_object('life', true, 'death', true),
    'seer', '[]'::jsonb, 'wolf_votes', '{}'::jsonb, 'done', false,
    'victim', null, 'protected', null, 'last_protected', null, 'saved', false, 'poison', null,
    'cur', null, 'nights', '[]'::jsonb);
  return jsonb_build_object('state', v_state, 'server', v_server,
                            'secrets', public._lg_secrets(v_state, v_server));
end $$;

-- -----------------------------------------------------------------------------
-- Actions
--   {"type":"tick"}                       tous : échéance dépassée -> suite (sinon inchangé)
--   {"type":"next"}                       hôte : roles -> nuit 1 ; reveal -> suite
--   {"type":"night_action", ...}          acteur de l'étape de nuit :
--       cupidon    {"targets":[a,b]}
--       voyante    {"target":x}
--       protecteur {"target":x}             (pas le même que la nuit précédente)
--       loups      {"target":x|null}        (vote modifiable, visible des autres loups)
--       sorciere   {"save":bool,"target":x|null}  (ou "potion":"life"|"death"|"none")
--   {"type":"end_debate"}                 hôte : jour -> vote
--   {"type":"day_vote","target":x}        vivant : vote public, modifiable
--   {"type":"close_vote"}                 hôte : dépouille maintenant
--   {"type":"hunter_shot","target":x|null}  chasseur mort
-- -----------------------------------------------------------------------------
create or replace function public.game_loup_garou_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  v_type   text := p_action->>'type';
  v_me     text := p_actor::text;
  v_phase  text := p_state->>'phase';
  v_step   text := p_state->>'step';
  v_target text := nullif(p_action->>'target', '');
  v_alive  boolean := coalesce((p_state->'alive') ? v_me, false);
  v_player boolean := coalesce((p_state->'players') ? v_me, false);
  v_r      jsonb;
  v_a      text;
  v_b      text;
  v_save   boolean;
  v_wolves text[];
  v_n      integer;
  v_pot    text;
begin
  if v_phase not in ('roles', 'night', 'reveal', 'hunter', 'day', 'vote') then
    raise exception 'wrong_phase';
  end if;

  -- ------------------------------------------------------------------ tick
  if v_type = 'tick' then
    if p_state->>'deadline' is null or now() < (p_state->>'deadline')::timestamptz then
      return jsonb_build_object('state', p_state, 'server', p_server);
    end if;
    v_r := case v_phase
      when 'roles'  then public._lg_begin_night(p_state, p_server)
      when 'night'  then public._lg_end_step(p_state, p_server)
      when 'reveal' then public._lg_after_reveal(p_state, p_server)
      when 'hunter' then public._lg_hunter_done(p_state, p_server, null)
      when 'day'    then public._lg_begin_vote(p_state, p_server, p_state->'alive', false)
      when 'vote'   then public._lg_tally(p_state, p_server)
    end;
    return public._lg_out(v_r->'state', v_r->'server');
  end if;

  -- ------------------------------------------------------------------ hôte
  if v_type in ('next', 'end_debate', 'close_vote') then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_type = 'next' and v_phase = 'roles' then
      v_r := public._lg_begin_night(p_state, p_server);
    elsif v_type = 'next' and v_phase = 'reveal' then
      v_r := public._lg_after_reveal(p_state, p_server);
    elsif v_type = 'end_debate' and v_phase = 'day' then
      v_r := public._lg_begin_vote(p_state, p_server, p_state->'alive', false);
    elsif v_type = 'close_vote' and v_phase = 'vote' then
      v_r := public._lg_tally(p_state, p_server);
    else
      raise exception 'wrong_phase';
    end if;
    return public._lg_out(v_r->'state', v_r->'server');
  end if;

  if v_type not in ('night_action', 'day_vote', 'hunter_shot') then raise exception 'unknown_action'; end if;
  if not v_player then raise exception 'not_a_player'; end if;

  -- ------------------------------------------------------------------ chasseur
  if v_type = 'hunter_shot' then
    if v_phase <> 'hunter' then raise exception 'wrong_phase'; end if;
    if p_state->>'hunter' is distinct from v_me then raise exception 'not_your_turn'; end if;
    if v_target is not null and (v_target = v_me or not ((p_state->'alive') ? v_target)) then
      raise exception 'invalid_target';
    end if;
    v_r := public._lg_hunter_done(p_state, p_server, v_target);
    return public._lg_out(v_r->'state', v_r->'server');
  end if;

  if not v_alive then raise exception 'not_alive'; end if;

  -- ------------------------------------------------------------------ vote du jour
  if v_type = 'day_vote' then
    if v_phase <> 'vote' then raise exception 'wrong_phase'; end if;
    if v_target is null or not ((p_state->'candidates') ? v_target) or not ((p_state->'alive') ? v_target) then
      raise exception 'invalid_target';
    end if;
    if v_target = v_me then raise exception 'cannot_vote_self'; end if;
    p_state := jsonb_set(p_state, array['votes', v_me], to_jsonb(v_target), true);
    select count(*) into v_n from jsonb_object_keys(p_state->'votes') k where (p_state->'alive') ? k;
    if v_n >= jsonb_array_length(p_state->'alive') then
      v_r := public._lg_tally(p_state, p_server);
      return public._lg_out(v_r->'state', v_r->'server');
    end if;
    return public._lg_out(p_state, p_server);
  end if;

  -- ------------------------------------------------------------------ actions de nuit
  if v_phase <> 'night' then raise exception 'wrong_phase'; end if;
  if not (v_me = any(public._lg_actors(p_state, p_server, v_step))) then raise exception 'not_your_turn'; end if;
  if v_step <> 'loups' and coalesce((p_server->>'done')::boolean, false) then raise exception 'already_acted'; end if;

  if v_step = 'cupidon' then
    v_a := p_action->'targets'->>0;
    v_b := p_action->'targets'->>1;
    if jsonb_typeof(p_action->'targets') <> 'array' or jsonb_array_length(p_action->'targets') <> 2
       or v_a is null or v_b is null or v_a = v_b
       or not ((p_state->'alive') ? v_a) or not ((p_state->'alive') ? v_b) then
      raise exception 'invalid_target';
    end if;
    p_server := p_server || jsonb_build_object('lovers', jsonb_build_array(v_a, v_b));
    p_server := public._lg_cur(p_server, 'lovers', jsonb_build_array(v_a, v_b));
    v_r := public._lg_mark_done(p_state, p_server);

  elsif v_step = 'voyante' then
    if v_target is null or v_target = v_me or not ((p_state->'alive') ? v_target) then
      raise exception 'invalid_target';
    end if;
    p_server := p_server || jsonb_build_object('seer', coalesce(p_server->'seer', '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object('night', (p_state->>'night')::integer, 'target', v_target,
                         'role', p_server->'roles'->>v_target)));
    p_server := public._lg_cur(p_server, 'seer', to_jsonb(v_target));
    v_r := public._lg_mark_done(p_state, p_server);

  elsif v_step = 'protecteur' then
    if v_target is null or not ((p_state->'alive') ? v_target)
       or v_target is not distinct from p_server->>'last_protected' then
      raise exception 'invalid_target';
    end if;
    p_server := p_server || jsonb_build_object('protected', v_target);
    p_server := public._lg_cur(p_server, 'protect', to_jsonb(v_target));
    v_r := public._lg_mark_done(p_state, p_server);

  elsif v_step = 'loups' then
    if v_target is not null and (not ((p_state->'alive') ? v_target) or p_server->'roles'->>v_target = 'loup') then
      raise exception 'invalid_target';
    end if;
    if v_target is null then
      p_server := p_server || jsonb_build_object('wolf_votes', coalesce(p_server->'wolf_votes', '{}'::jsonb) - v_me);
    else
      p_server := p_server || jsonb_build_object('wolf_votes',
        coalesce(p_server->'wolf_votes', '{}'::jsonb) || jsonb_build_object(v_me, v_target));
    end if;
    v_wolves := public._lg_alive_role(p_state, p_server, 'loup');
    if (select count(*) from unnest(v_wolves) w where p_server->'wolf_votes' ? w) = cardinality(v_wolves)
       and (select count(distinct p_server->'wolf_votes'->>w) from unnest(v_wolves) w) = 1 then
      -- Unanimité : l'étape se termine (après le minimum).
      v_r := public._lg_mark_done(p_state, p_server);
    elsif coalesce((p_server->>'done')::boolean, false) then
      -- Un loup change d'avis : l'unanimité est rompue, retour à l'échéance max.
      p_server := p_server || jsonb_build_object('done', false);
      p_state := p_state || jsonb_build_object('deadline', public._lg_iso(greatest(
        (p_state->>'step_started')::timestamptz + make_interval(secs => public._lg_step_max('loups')),
        now() + interval '5 seconds')));
      v_r := public._lg_pair(p_state, p_server);
    else
      v_r := public._lg_pair(p_state, p_server);
    end if;

  elsif v_step = 'sorciere' then
    v_pot := p_action->>'potion';
    v_save := coalesce((p_action->>'save')::boolean, false) or v_pot in ('life', 'both');
    if v_pot = 'none' or v_pot = 'life' then v_target := null; end if;
    if v_save then
      if not coalesce((p_server->'potions'->>'life')::boolean, false) then raise exception 'no_potion'; end if;
      if p_server->>'victim' is null then raise exception 'invalid_target'; end if;
    end if;
    if v_target is not null then
      if not coalesce((p_server->'potions'->>'death')::boolean, false) then raise exception 'no_potion'; end if;
      if v_target = v_me or not ((p_state->'alive') ? v_target) then raise exception 'invalid_target'; end if;
    end if;
    if v_save then
      p_server := p_server || jsonb_build_object('saved', true,
        'potions', p_server->'potions' || '{"life":false}'::jsonb);
      p_server := public._lg_cur(p_server, 'saved', to_jsonb(p_server->>'victim'));
    end if;
    if v_target is not null then
      p_server := p_server || jsonb_build_object('poison', v_target,
        'potions', p_server->'potions' || '{"death":false}'::jsonb);
      p_server := public._lg_cur(p_server, 'poison', to_jsonb(v_target));
    end if;
    v_r := public._lg_mark_done(p_state, p_server);

  else
    raise exception 'wrong_phase';
  end if;

  return public._lg_out(v_r->'state', v_r->'server');
end $$;

revoke all on function public._lg_iso(timestamptz) from public, anon, authenticated;
revoke all on function public._lg_suggest(integer) from public, anon, authenticated;
revoke all on function public._lg_step_min(text) from public, anon, authenticated;
revoke all on function public._lg_step_max(text) from public, anon, authenticated;
revoke all on function public._lg_alive_role(jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public._lg_steps(jsonb) from public, anon, authenticated;
revoke all on function public._lg_actors(jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public._lg_pair(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._lg_begin_step(jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public._lg_mark_done(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._lg_cur(jsonb, text, jsonb) from public, anon, authenticated;
revoke all on function public._lg_kill(jsonb, jsonb, text, text) from public, anon, authenticated;
revoke all on function public._lg_camp(jsonb, text) from public, anon, authenticated;
revoke all on function public._lg_winner(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._lg_finish(jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public._lg_tstats(jsonb, jsonb, text, text) from public, anon, authenticated;
revoke all on function public._lg_begin_night(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._lg_resolve_night(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._lg_end_step(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._lg_begin_vote(jsonb, jsonb, jsonb, boolean) from public, anon, authenticated;
revoke all on function public._lg_tally(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._lg_hunter_done(jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public._lg_after_reveal(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._lg_secrets(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._lg_out(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.game_loup_garou_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_loup_garou_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;


-- ===== games\menteur.sql =====
-- =============================================================================
-- JEU « Menteur » (id menteur) — dés de bluff (famille des « dés menteurs »)
-- Idempotent (create or replace). Dispatché par start_match / game_action.
--
-- Chaque joueur a 5 dés cachés (match_secrets). À chaque manche tout le monde
-- relance (tirage serveur random()). À tour de rôle : monter l'enchère
-- « N dés de valeur V » sur l'ensemble des dés de la table, ou crier « Menteur ! »
-- (ou « Pile ! » si la variante est active). Le perdant de la vérification perd
-- un dé ; à 0 dé on est éliminé ; le dernier joueur avec des dés gagne.
--
-- RÈGLES DES 1 (« Paco ») — les 1 sont JOKERS : ils comptent pour toutes les
-- valeurs, sauf quand l'enchère porte justement sur les 1.
--   * enchère normale -> normale : quantité supérieure, ou même quantité et
--     valeur supérieure ;
--   * normale (q, v) -> Paco : quantité >= ceil(q / 2) ;
--   * Paco (q) -> Paco : quantité > q ;
--   * Paco (q) -> normale : quantité >= 2q + 1 ;
--   * l'enchère d'OUVERTURE d'une manche ne peut pas porter sur les 1 ;
--   * une quantité ne peut jamais dépasser le nombre total de dés en jeu.
--   (Pas de manche « palifico » : variante non retenue.)
--
-- « Menteur ! » (joueur dont c'est le tour, une enchère existe) : on compte les
-- dés de la valeur annoncée + les 1 (sauf enchère Paco). Total >= quantité ->
-- celui qui a crié perd un dé ; sinon l'enchérisseur perd un dé. Le perdant
-- commence la manche suivante (s'il est éliminé : le joueur vivant suivant).
-- « Pile ! » (option, défaut off ; joueur dont c'est le tour) : total exactement
-- égal -> le crieur regagne un dé (plafonné à 5, sinon rien) ; sinon il en perd
-- un. Le crieur commence la manche suivante (ou le vivant suivant s'il est sorti).
--
-- MINUTEUR (deadline + {"type":"tick"}) :
--   * phase bidding : à l'échéance, enchère minimale automatique pour le joueur
--     dont c'est le tour = même valeur, quantité + 1 ; en ouverture : 1 dé de la
--     valeur (hors 1) la plus fréquente dans SES dés (égalité -> la plus haute).
--     Si cette enchère dépasse le nombre de dés en jeu -> « Menteur ! » automatique.
--   * phase reveal : à l'échéance, manche suivante (ou fin de partie si c'était
--     la dernière vérification). L'hôte peut accélérer avec {"type":"next"}.
--
-- server : {"dice": {"<uid>": [1..6, ...]}}  (dés de la manche en cours)
-- secret d'un joueur : {"round": n, "dice": [..]}  ([] une fois éliminé)
-- Contrat complet (state public, actions) : src/games/menteur/types.ts.
-- =============================================================================

create or replace function public._mtr_iso(p_ts timestamptz)
returns text language sql stable
set search_path = public, extensions
as $$
  select to_char(p_ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$$;

-- p_n dés tirés au sort.
create or replace function public._mtr_roll(p_n integer)
returns jsonb language sql volatile
set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(1 + floor(random() * 6)::integer), '[]'::jsonb)
    from generate_series(1, greatest(p_n, 0));
$$;

-- Joueur vivant suivant p_from dans l'ordre de la table (p_from peut être éliminé).
create or replace function public._mtr_next(p_state jsonb, p_from text)
returns text language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_order text[] := array(select jsonb_array_elements_text(p_state->'order'));
  v_n     integer := cardinality(v_order);
  v_cur   integer := coalesce(array_position(v_order, p_from), 1);
  i       integer;
begin
  for i in 1 .. v_n loop
    v_cur := v_cur % v_n + 1;
    if (p_state->'alive') ? v_order[v_cur] then return v_order[v_cur]; end if;
  end loop;
  return null;
end $$;

-- L'enchère (p_q, p_f) est-elle valide après p_bid (null = ouverture) ?
create or replace function public._mtr_valid(p_q integer, p_f integer, p_bid jsonb, p_total integer)
returns boolean language plpgsql immutable
set search_path = public, extensions
as $$
declare
  cq integer;
  cf integer;
begin
  if p_q is null or p_f is null or p_f < 1 or p_f > 6 or p_q < 1 or p_q > p_total then return false; end if;
  if p_bid is null or jsonb_typeof(p_bid) <> 'object' then
    return p_f <> 1;  -- ouverture : pas sur les Paco
  end if;
  cq := (p_bid->>'qty')::integer;
  cf := (p_bid->>'face')::integer;
  if cf = 1 then
    if p_f = 1 then return p_q > cq; end if;
    return p_q >= 2 * cq + 1;
  end if;
  if p_f = 1 then return p_q >= ceil(cq / 2.0)::integer; end if;
  return p_q > cq or (p_q = cq and p_f > cf);
end $$;

-- Nouvelle manche : tout le monde relance. Renvoie {state, server, secrets}.
create or replace function public._mtr_new_round(p_state jsonb, p_server jsonb, p_starter text, p_grace integer)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_round   integer := coalesce((p_state->>'round')::integer, 0) + 1;
  v_dice    jsonb := '{}'::jsonb;
  v_secrets jsonb := '{}'::jsonb;
  v_total   integer := 0;
  v_d       jsonb;
  p         text;
begin
  for p in select jsonb_array_elements_text(p_state->'players') loop
    if (p_state->'alive') ? p then
      v_d := public._mtr_roll((p_state->'dice_count'->>p)::integer);
      v_dice := v_dice || jsonb_build_object(p, v_d);
      v_total := v_total + jsonb_array_length(v_d);
    else
      v_d := '[]'::jsonb;
    end if;
    v_secrets := v_secrets || jsonb_build_object(p, jsonb_build_object('round', v_round, 'dice', v_d));
  end loop;
  p_server := p_server || jsonb_build_object('dice', v_dice);
  p_state := p_state || jsonb_build_object(
    'phase', 'bidding',
    'round', v_round,
    'starter', p_starter,
    'turn', p_starter,
    'turn_seq', coalesce((p_state->>'turn_seq')::integer, 0) + 1,
    'bid', null,
    'bids', '[]'::jsonb,
    'total_dice', v_total,
    'reveal', null,
    'deadline', public._mtr_iso(now() + make_interval(secs => (p_state->>'turn_seconds')::integer + p_grace)));
  return jsonb_build_object('state', p_state, 'server', p_server, 'secrets', v_secrets);
end $$;

-- Stats de fin de partie pour les trophées (features/trophees.sql) : rejoue history[] (qui perd / gagne un dé).
create or replace function public._mtr_tstats(p_state jsonb, p_pl text, p_winner text)
returns jsonb language plpgsql stable
set search_path = public, extensions
as $$
declare
  v_n       integer := jsonb_array_length(p_state->'players');
  v_dice    jsonb := (select jsonb_object_agg(x, 5) from jsonb_array_elements_text(p_state->'players') x);
  v_alive   integer := v_n;
  v_comeback boolean := false;
  v_lost    boolean := false;
  v_false_liar integer := 0; v_caught integer := 0; v_good_liar integer := 0;
  v_exact integer := 0; v_big integer := 0; v_pile integer := 0; v_pure integer := 0;
  h         jsonb;
begin
  for h in select value from jsonb_array_elements(coalesce(p_state->'history', '[]'::jsonb)) loop
    if h->>'kind' = 'liar' then
      if h->>'caller' = p_pl and h->>'loser' = p_pl then v_false_liar := v_false_liar + 1; end if;
      if h->'bid'->>'by' = p_pl and h->>'loser' = p_pl then v_caught := v_caught + 1; end if;
      if h->>'caller' = p_pl and h->>'loser' is not null and h->>'loser' <> p_pl then v_good_liar := v_good_liar + 1; end if;
      if h->'bid'->>'by' = p_pl and (h->>'count')::integer = (h->'bid'->>'qty')::integer then v_exact := v_exact + 1; end if;
      if h->'bid'->>'by' = p_pl and coalesce((h->>'pure')::boolean, false) then v_pure := v_pure + 1; end if;
      if h->'bid'->>'by' = p_pl and (h->'bid'->>'qty')::integer >= 8
         and (h->>'count')::integer >= (h->'bid'->>'qty')::integer then v_big := v_big + 1; end if;
    elsif h->>'kind' = 'pile' and h->>'caller' = p_pl and h->>'loser' is null then
      v_pile := v_pile + 1;
    end if;
    if h->>'loser' is not null then
      v_dice := jsonb_set(v_dice, array[h->>'loser'], to_jsonb((v_dice->>(h->>'loser'))::integer - 1));
      if h->>'loser' = p_pl then v_lost := true; end if;
      if h->>'eliminated' is not null then v_alive := v_alive - 1; end if;
      -- tombé à un seul dé alors qu'il restait 3 joueurs ou plus
      if h->>'loser' = p_pl and (v_dice->>p_pl)::integer = 1 and v_alive >= 3 then v_comeback := true; end if;
    end if;
    if h->>'gainer' is not null then
      v_dice := jsonb_set(v_dice, array[h->>'gainer'], to_jsonb((v_dice->>(h->>'gainer'))::integer + 1));
    end if;
  end loop;
  return jsonb_build_object(
    'first_out', case when p_state->'eliminated'->>0 = p_pl then 1 else 0 end,
    'false_liar', v_false_liar, 'caught', v_caught, 'good_liar', v_good_liar,
    'last_die_win', case when p_winner = p_pl and (p_state->'dice_count'->>p_pl)::integer = 1 then 1 else 0 end,
    'pile_ok', v_pile, 'exact_bids', v_exact, 'pure_bluffs', v_pure, 'big_bid', v_big,
    'comeback', case when p_winner = p_pl and v_comeback then 1 else 0 end,
    'captain', case when p_winner = p_pl and not v_lost and v_n >= 3 then 1 else 0 end);
end $$;

-- Fin de partie : vainqueur = dernier vivant, puis ordre d'élimination inverse.
create or replace function public._mtr_finish(p_state jsonb)
returns jsonb language plpgsql stable
set search_path = public, extensions
as $$
declare
  v_n       integer := jsonb_array_length(p_state->'players');
  v_ranked  text[] := array(select jsonb_array_elements_text(p_state->'alive'))
                      || array(select e from jsonb_array_elements_text(p_state->'eliminated') with ordinality as t(e, o)
                                order by o desc);
  v_results jsonb := '[]'::jsonb;
  i         integer;
begin
  for i in 1 .. cardinality(v_ranked) loop
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'profile_id', v_ranked[i],
      'placement', i,
      'points', v_n - i,
      'won', i = 1,
      'stats', public._mtr_tstats(p_state, v_ranked[i], v_ranked[1])));
  end loop;
  return p_state || jsonb_build_object(
    'phase', 'finished',
    'deadline', null,
    'turn', null,
    'winner', v_ranked[1],
    'results', v_results);
end $$;

-- Vérification (« Menteur ! » ou « Pile ! ») -> phase reveal.
create or replace function public._mtr_resolve(p_state jsonb, p_server jsonb, p_caller text, p_kind text, p_auto boolean)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_bid     jsonb := p_state->'bid';
  v_q       integer := (v_bid->>'qty')::integer;
  v_f       integer := (v_bid->>'face')::integer;
  v_by      text := v_bid->>'by';
  v_count   integer;
  v_loser   text := null;
  v_gainer  text := null;
  v_elim    text := null;
  v_next    text;
  v_n       integer;
  v_secs    numeric;
  v_entry   jsonb;
  v_pure    boolean;
begin
  select count(*)::integer into v_count
    from jsonb_each(coalesce(p_server->'dice', '{}'::jsonb)) as t(k, v),
         jsonb_array_elements_text(v) as d(x)
   where x::integer = v_f or (v_f <> 1 and x::integer = 1);

  if p_kind = 'liar' then
    v_loser := case when v_count >= v_q then p_caller else v_by end;
  elsif v_count = v_q then
    if (p_state->'dice_count'->>p_caller)::integer < 5 then v_gainer := p_caller; end if;
  else
    v_loser := p_caller;
  end if;

  -- Coup de bluff : enchère contestée (« Menteur ! »), vraie, alors que l'enchérisseur n'avait aucun dé de
  -- cette valeur ni joker. Calculé ici et stocké dans l'historique (les dés sont révélés de toute façon).
  v_pure := p_kind = 'liar' and v_count >= v_q
            and not exists (select 1 from jsonb_array_elements_text(coalesce(p_server->'dice'->v_by, '[]'::jsonb)) d(x)
                             where x::integer = v_f or (v_f <> 1 and x::integer = 1));

  if v_loser is not null then
    v_n := (p_state->'dice_count'->>v_loser)::integer - 1;
    p_state := jsonb_set(p_state, array['dice_count', v_loser], to_jsonb(v_n));
    if v_n <= 0 then
      v_elim := v_loser;
      p_state := p_state || jsonb_build_object('alive', (p_state->'alive') - v_loser,
                                               'eliminated', (p_state->'eliminated') || to_jsonb(v_loser));
    end if;
  end if;
  if v_gainer is not null then
    p_state := jsonb_set(p_state, array['dice_count', v_gainer],
                         to_jsonb((p_state->'dice_count'->>v_gainer)::integer + 1));
  end if;

  -- Qui commence la manche suivante : le perdant (Menteur) / le crieur (Pile).
  v_next := case when p_kind = 'liar' then v_loser else p_caller end;
  if not ((p_state->'alive') ? v_next) then v_next := public._mtr_next(p_state, v_next); end if;

  -- Durée de la révélation (le front illumine les dés comptés un par un, 0,4 s chacun).
  v_secs := least(20, 7 + 0.4 * v_count);
  v_entry := jsonb_build_object(
    'round', p_state->'round',
    'kind', p_kind,
    'caller', p_caller,
    'auto', p_auto,
    'bid', v_bid,
    'dice', coalesce(p_server->'dice', '{}'::jsonb),
    'count', v_count,
    'exact', v_count = v_q,
    'loser', v_loser,
    'gainer', v_gainer,
    'eliminated', v_elim,
    'next_starter', v_next,
    'final', jsonb_array_length(p_state->'alive') <= 1);

  return p_state || jsonb_build_object(
    'phase', 'reveal',
    'turn', null,
    'reveal', v_entry,
    'history', coalesce(p_state->'history', '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object('round', p_state->'round', 'kind', p_kind, 'caller', p_caller, 'bid', v_bid,
                         'count', v_count, 'loser', v_loser, 'gainer', v_gainer, 'eliminated', v_elim,
                         'pure', v_pure)),
    'deadline', public._mtr_iso(now() + make_interval(secs => v_secs::double precision)));
end $$;

-- -----------------------------------------------------------------------------
-- Démarrage. Options : {"turn_seconds": 30|45|60 (défaut 45), "pile": bool (défaut false)}
-- -----------------------------------------------------------------------------
create or replace function public.game_menteur_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_n      integer := cardinality(p_players);
  v_secs   integer := case when coalesce(p_options->>'turn_seconds', '') in ('30', '45', '60')
                           then (p_options->>'turn_seconds')::integer else 45 end;
  v_pile   boolean := coalesce(p_options->>'pile', 'false') = 'true';
  v_order  text[];
  v_counts jsonb := '{}'::jsonb;
  v_state  jsonb;
  v_r      jsonb;
  p        text;
begin
  if v_n < 2 then raise exception 'not_enough_players'; end if;
  if v_n > 9 then raise exception 'too_many_players'; end if;
  v_order := array(select x::text from unnest(p_players) as t(x) order by random());
  foreach p in array v_order loop
    v_counts := v_counts || jsonb_build_object(p, 5);
  end loop;

  v_state := jsonb_build_object(
    'game', 'menteur',
    'phase', 'bidding',
    'players', to_jsonb(p_players),
    'order', to_jsonb(v_order),
    'alive', to_jsonb(v_order),
    'eliminated', '[]'::jsonb,
    'dice_count', v_counts,
    'total_dice', 5 * v_n,
    'round', 0,
    'starter', null,
    'turn', null,
    'turn_seq', 0,
    'turn_seconds', v_secs,
    'pile_enabled', v_pile,
    'bid', null,
    'bids', '[]'::jsonb,
    'reveal', null,
    'history', '[]'::jsonb,
    'deadline', null,
    'winner', null,
    'results', null);
  -- 10 s de grâce au premier tour (le temps que tout le monde arrive et secoue).
  v_r := public._mtr_new_round(v_state, '{}'::jsonb, v_order[1], 10);
  return v_r;
end $$;

-- -----------------------------------------------------------------------------
-- Actions :
--   {"type":"bid","qty":n,"face":1..6}   {"type":"liar"}   {"type":"pile"}
--   {"type":"next"} (hôte, phase reveal)   {"type":"tick"}
-- -----------------------------------------------------------------------------
create or replace function public.game_menteur_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_type    text := p_action->>'type';
  v_me      text := p_actor::text;
  v_turn    text := p_state->>'turn';
  v_phase   text := p_state->>'phase';
  v_total   integer := coalesce((p_state->>'total_dice')::integer, 0);
  v_bid     jsonb := p_state->'bid';
  v_q       integer;
  v_f       integer;
  v_auto    boolean := false;
  v_kind    text;
  v_r       jsonb;
  v_secrets jsonb := null;
  v_bids    jsonb;
begin
  if v_phase not in ('bidding', 'reveal') then raise exception 'wrong_phase'; end if;
  if jsonb_typeof(v_bid) <> 'object' then v_bid := null; end if;

  -- ---------------------------------------------------------------- tick
  if v_type = 'tick' then
    if p_state->>'deadline' is null or now() < (p_state->>'deadline')::timestamptz then
      return jsonb_build_object('state', p_state, 'server', p_server);  -- trop tôt / déjà traité
    end if;
    if v_phase = 'reveal' then
      v_type := 'advance';
    else
      v_auto := true;
      v_me := v_turn;
      if v_bid is null then
        -- Ouverture : 1 dé de la valeur (hors 1) la plus fréquente dans mes dés.
        select x::integer into v_f
          from jsonb_array_elements_text(coalesce(p_server->'dice'->v_turn, '[]'::jsonb)) as d(x)
         where x::integer <> 1
         group by x order by count(*) desc, x::integer desc limit 1;
        v_q := 1;
        v_f := coalesce(v_f, 6);
        v_type := 'bid';
      else
        v_q := (v_bid->>'qty')::integer + 1;
        v_f := (v_bid->>'face')::integer;
        v_type := case when v_q <= v_total then 'bid' else 'liar' end;
      end if;
    end if;
  elsif v_type = 'next' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase <> 'reveal' then raise exception 'wrong_phase'; end if;
    v_type := 'advance';
  elsif v_type in ('bid', 'liar', 'pile') then
    if not ((p_state->'players') ? v_me) then raise exception 'not_a_player'; end if;
    if not ((p_state->'alive') ? v_me) then raise exception 'not_alive'; end if;
    if v_phase <> 'bidding' then raise exception 'wrong_phase'; end if;
    if v_turn is distinct from v_me then raise exception 'not_your_turn'; end if;
    if v_type = 'bid' then
      if jsonb_typeof(p_action->'qty') <> 'number' or jsonb_typeof(p_action->'face') <> 'number' then
        raise exception 'invalid_bid';
      end if;
      v_q := floor((p_action->>'qty')::numeric)::integer;
      v_f := floor((p_action->>'face')::numeric)::integer;
      if v_q::numeric <> (p_action->>'qty')::numeric or v_f::numeric <> (p_action->>'face')::numeric
         or v_f < 1 or v_f > 6 or v_q < 1 or v_q > v_total then
        raise exception 'invalid_bid';
      end if;
      if v_bid is null and v_f = 1 then raise exception 'paco_opening'; end if;
    else
      if v_bid is null then raise exception 'no_bid_yet'; end if;
      if v_type = 'pile' and not coalesce((p_state->>'pile_enabled')::boolean, false) then
        raise exception 'pile_disabled';
      end if;
    end if;
  else
    raise exception 'unknown_action';
  end if;

  -- ---------------------------------------------------------------- application
  if v_type = 'bid' then
    if not public._mtr_valid(v_q, v_f, v_bid, v_total) then raise exception 'bid_too_low'; end if;
    v_bids := coalesce(p_state->'bids', '[]'::jsonb);
    select coalesce(jsonb_agg(e order by o), '[]'::jsonb) into v_bids
      from jsonb_array_elements(v_bids) with ordinality as t(e, o)
     where o > jsonb_array_length(v_bids) - 29;
    v_bid := jsonb_build_object('qty', v_q, 'face', v_f, 'by', v_me, 'auto', v_auto);
    p_state := p_state || jsonb_build_object(
      'bid', v_bid,
      'bids', v_bids || jsonb_build_array(v_bid),
      'turn', public._mtr_next(p_state, v_me),
      'turn_seq', coalesce((p_state->>'turn_seq')::integer, 0) + 1,
      'deadline', public._mtr_iso(now() + make_interval(secs => (p_state->>'turn_seconds')::integer)));

  elsif v_type in ('liar', 'pile') then
    p_state := public._mtr_resolve(p_state, p_server, v_me, v_type, v_auto);

  elsif v_type = 'advance' then
    if coalesce((p_state->'reveal'->>'final')::boolean, false) then
      p_state := public._mtr_finish(p_state);
    else
      v_r := public._mtr_new_round(p_state, p_server, p_state->'reveal'->>'next_starter', 6);
      p_state := v_r->'state';
      p_server := v_r->'server';
      v_secrets := v_r->'secrets';
    end if;
  end if;

  if p_state->>'phase' = 'finished' then
    return jsonb_build_object('state', p_state, 'server', p_server, 'results', p_state->'results');
  end if;
  if v_secrets is not null then
    return jsonb_build_object('state', p_state, 'server', p_server, 'secrets', v_secrets);
  end if;
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

revoke all on function public._mtr_iso(timestamptz) from public, anon, authenticated;
revoke all on function public._mtr_roll(integer) from public, anon, authenticated;
revoke all on function public._mtr_next(jsonb, text) from public, anon, authenticated;
revoke all on function public._mtr_valid(integer, integer, jsonb, integer) from public, anon, authenticated;
revoke all on function public._mtr_new_round(jsonb, jsonb, text, integer) from public, anon, authenticated;
revoke all on function public._mtr_finish(jsonb) from public, anon, authenticated;
revoke all on function public._mtr_tstats(jsonb, text, text) from public, anon, authenticated;
revoke all on function public._mtr_resolve(jsonb, jsonb, text, text, boolean) from public, anon, authenticated;
revoke all on function public.game_menteur_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_menteur_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;


-- ===== games\morpion.sql =====
-- =============================================================================
-- JEU « Morpion » (id morpion) — jeu en DUEL (socle supabase/features/duel.sql ;
-- modèle : games/quatre-a-la-suite.sql). 3 variantes au choix de l'hôte
-- (p_options.board.variant, défaut classic) :
--   classic  : grille 3×3, aligner 3 ; grille pleine = nul.
--   giant    : grille 10×10, aligner 5 OU PLUS ; grille pleine = nul.
--   ultimate : 9 petits morpions 3×3 dans un grand. La case jouée dans un petit
--              morpion désigne le petit morpion où l'adversaire doit jouer ; s'il
--              est gagné ou plein, l'adversaire joue n'importe où. Un petit morpion
--              gagné devient un grand X/O (plus aucun coup dedans) ; gagner =
--              aligner 3 petits morpions ; les petits nuls ne comptent pour
--              personne ; nul quand il n'y a plus aucun coup possible.
-- ❌ (x) = le joueur qui commence la manche (duel.starter, alterné par le socle) ;
-- ⭕ (o) = l'autre.
--
-- Plateau public (state.board) :
--   {"variant": "classic"|"giant"|"ultimate",
--    "size": 3|10|9,                    -- côté de la grille de cases
--    "align": 3|5|3,                    -- alignement gagnant (ultime : 3 petits morpions)
--    "a": "<uid>", "b": "<uid>",        -- duellistes (couleurs du socle)
--    "x": "<uid>", "o": "<uid>",        -- ❌ / ⭕
--    "cells": [null|"x"|"o", …],        -- size² cases. classic/giant : i = ligne*size + colonne ;
--                                       -- ultimate : i = 9*petit + case (petit, case : 0..8, sens de lecture)
--    "count": n,                        -- coups joués
--    "last": {"cell": i, "by": "<uid>"} | null,
--    "lines": [[i, …], …] | null,       -- segments gagnants, chacun ordonné d'un bout à l'autre
--                                       -- (classic/giant : cases ; ultimate : petits morpions 0..8)
--    "boards": [null|"x"|"o"|"draw" ×9] | null,   -- ultimate : état des petits morpions (sinon null)
--    "next": 0..8 | null}               -- ultimate : petit morpion imposé (null = libre)
-- Coup : {"cell": i} (aucune autre clé, sinon invalid_move). Pas de secret, pas de server, pas de préparation.
-- Erreurs : invalid_move (format, hors grille), cell_taken, wrong_board (ultime :
-- hors du petit morpion imposé), board_closed (ultime : petit morpion terminé),
-- invalid_variant (démarrage). Miroir TS : src/games/morpion/logic.ts.
-- =============================================================================

-- Variante normalisée (absente / inconnue -> classic).
create or replace function public._morpion_variant(p_opts jsonb)
returns text language sql immutable
set search_path = public, extensions
as $$
  select case when jsonb_typeof(p_opts) = 'object' and p_opts->>'variant' in ('classic', 'giant', 'ultimate')
              then p_opts->>'variant' else 'classic' end;
$$;

-- Contenu de la case (r, c) d'une grille carrée p_n × p_n stockée à plat ; null si vide / hors grille.
create or replace function public._morpion_at(p_grid jsonb, p_n integer, p_r integer, p_c integer)
returns text language sql immutable
set search_path = public, extensions
as $$
  select case when p_r between 0 and p_n - 1 and p_c between 0 and p_n - 1 then p_grid->>(p_r * p_n + p_c) end;
$$;

-- Segments de p_sym alignés (>= p_align) passant par la case p_idx d'une grille
-- p_n × p_n, dans l'ordre : ligne, colonne, diagonale \, diagonale /. Chaque
-- segment est ordonné d'un bout à l'autre (sens de lecture). Null s'il n'y en a pas.
create or replace function public._morpion_runs(p_grid jsonb, p_n integer, p_idx integer, p_align integer, p_sym text)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_dirs integer[] := array[0,1, 1,0, 1,1, 1,-1];   -- (dr, dc)
  v_r    integer := p_idx / p_n;
  v_c    integer := p_idx % p_n;
  v_out  jsonb := '[]'::jsonb;
  v_seg  jsonb;
  dr     integer;
  dc     integer;
  k      integer;
  i      integer;
begin
  if p_sym is null or public._morpion_at(p_grid, p_n, v_r, v_c) is distinct from p_sym then return null; end if;
  for i in 0 .. 3 loop
    dr := v_dirs[i * 2 + 1];
    dc := v_dirs[i * 2 + 2];
    -- Recule jusqu'au début du segment…
    k := 0;
    while public._morpion_at(p_grid, p_n, v_r - (k + 1) * dr, v_c - (k + 1) * dc) = p_sym loop
      k := k + 1;
    end loop;
    -- … puis avance jusqu'à sa fin.
    v_seg := '[]'::jsonb;
    while public._morpion_at(p_grid, p_n, v_r - k * dr, v_c - k * dc) = p_sym loop
      v_seg := v_seg || to_jsonb((v_r - k * dr) * p_n + (v_c - k * dc));
      k := k - 1;
    end loop;
    if jsonb_array_length(v_seg) >= p_align then
      v_out := v_out || jsonb_build_array(v_seg);
    end if;
  end loop;
  return case when jsonb_array_length(v_out) > 0 then v_out end;
end $$;

-- Les 9 cases du petit morpion p_b (ultime), dans l'ordre de lecture.
create or replace function public._morpion_sub(p_cells jsonb, p_b integer)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select jsonb_agg(coalesce(p_cells->(9 * p_b + k), 'null'::jsonb) order by k) from generate_series(0, 8) as k;
$$;

-- Plus aucune case vide (null) ?
create or replace function public._morpion_full(p_grid jsonb)
returns boolean language sql immutable
set search_path = public, extensions
as $$
  select not exists (select 1 from jsonb_array_elements(p_grid) as e where jsonb_typeof(e) = 'null');
$$;

-- ---------------------------------------------------------------- hooks du socle

create or replace function public.game_morpion_board_new(p_ctx jsonb, p_a text, p_b text)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_var text := public._morpion_variant(p_ctx->'options');
  v_n   integer := case v_var when 'giant' then 10 when 'ultimate' then 9 else 3 end;
  v_x   text := case when p_ctx->>'starter' = p_b then p_b else p_a end;
begin
  return jsonb_build_object('board', jsonb_build_object(
    'variant', v_var,
    'size', v_n,
    'align', case when v_var = 'giant' then 5 else 3 end,
    'a', p_a, 'b', p_b,
    'x', v_x, 'o', case when v_x = p_a then p_b else p_a end,
    'cells', (select jsonb_agg('null'::jsonb) from generate_series(1, v_n * v_n)),
    'count', 0,
    'last', null,
    'lines', null,
    'boards', case when v_var = 'ultimate' then (select jsonb_agg('null'::jsonb) from generate_series(1, 9)) end,
    'next', null));
end $$;

create or replace function public.game_morpion_board_move(p_board jsonb, p_server jsonb, p_actor text, p_move jsonb)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_ult    boolean := p_board->>'variant' = 'ultimate';
  v_n      integer := (p_board->>'size')::integer;
  v_cells  jsonb := p_board->'cells';
  v_boards jsonb := p_board->'boards';
  v_next   integer := (p_board->>'next')::integer;
  v_sym    text;
  v_i      integer;
  v_b      integer;
  v_k      integer;
  v_lines  jsonb := null;
  v_out    text := null;
begin
  v_sym := case p_actor when p_board->>'x' then 'x' when p_board->>'o' then 'o' end;
  if v_sym is null then raise exception 'invalid_move'; end if;
  -- Format : EXACTEMENT {"cell": entier >= 0} dans la grille. Aucune autre clé :
  -- le socle recopie le coup tel quel dans le state public (duel.last_move) ; un
  -- champ parasite le gonflerait sur tous les téléphones.
  if jsonb_typeof(p_move) is distinct from 'object' then raise exception 'invalid_move'; end if;
  if (p_move - 'cell') <> '{}'::jsonb then raise exception 'invalid_move'; end if;
  if jsonb_typeof(p_move->'cell') is distinct from 'number' or coalesce(p_move->>'cell', '') !~ '^\d{1,3}$' then
    raise exception 'invalid_move';
  end if;
  v_i := (p_move->>'cell')::integer;
  if v_i >= v_n * v_n then raise exception 'invalid_move'; end if;

  if v_ult then
    v_b := v_i / 9;
    v_k := v_i % 9;
    if v_next is not null and v_b <> v_next then raise exception 'wrong_board'; end if;
    if jsonb_typeof(v_boards->v_b) is distinct from 'null' then raise exception 'board_closed'; end if;
  end if;
  if jsonb_typeof(v_cells->v_i) is distinct from 'null' then raise exception 'cell_taken'; end if;

  v_cells := jsonb_set(v_cells, array[v_i::text], to_jsonb(v_sym));

  if v_ult then
    -- Petit morpion : gagné (grand X/O) ou plein (nul, à personne) ?
    if public._morpion_runs(public._morpion_sub(v_cells, v_b), 3, v_k, 3, v_sym) is not null then
      v_boards := jsonb_set(v_boards, array[v_b::text], to_jsonb(v_sym));
      v_lines := public._morpion_runs(v_boards, 3, v_b, 3, v_sym);
    elsif public._morpion_full(public._morpion_sub(v_cells, v_b)) then
      v_boards := jsonb_set(v_boards, array[v_b::text], '"draw"'::jsonb);
    end if;
    -- La case jouée désigne le prochain petit morpion (libre s'il est terminé).
    v_next := case when jsonb_typeof(v_boards->v_k) = 'null' then v_k end;
    if v_lines is not null then v_out := 'win';
    elsif public._morpion_full(v_boards) then v_out := 'draw';   -- plus aucun coup possible
    end if;
  else
    v_lines := public._morpion_runs(v_cells, v_n, v_i, (p_board->>'align')::integer, v_sym);
    if v_lines is not null then v_out := 'win';
    elsif public._morpion_full(v_cells) then v_out := 'draw';
    end if;
  end if;

  p_board := p_board || jsonb_build_object(
    'cells', v_cells,
    'count', coalesce((p_board->>'count')::integer, 0) + 1,
    'last', jsonb_build_object('cell', v_i, 'by', p_actor),
    'lines', v_lines,
    'boards', v_boards,
    'next', case when v_ult and v_out is null then v_next end);
  if v_out = 'win' then
    -- 'game' : compteurs de fin de manche pour les trophées (L'ombre : Ultime gagné sans perdre un petit morpion)
    return jsonb_build_object('board', p_board, 'outcome', 'win', 'winner', p_actor,
      'game', jsonb_build_object('clean_ultimate',
        v_ult and not exists (select 1 from jsonb_array_elements_text(v_boards) b where b = case v_sym when 'x' then 'o' else 'x' end)));
  end if;
  return jsonb_build_object('board', p_board, 'outcome', v_out);
end $$;

-- Coup automatique (minuteur) : une case libre au hasard, en respectant la
-- contrainte de l'ultime (petit morpion imposé, sinon un petit morpion non terminé).
create or replace function public.game_morpion_board_auto(p_board jsonb, p_server jsonb, p_actor text)
returns jsonb language sql volatile
set search_path = public, extensions
as $$
  select jsonb_build_object('cell', i)
    from generate_series(0, (p_board->>'size')::integer * (p_board->>'size')::integer - 1) as i
   where jsonb_typeof(p_board->'cells'->i) = 'null'
     and (p_board->>'variant' is distinct from 'ultimate'
          or (jsonb_typeof(p_board->'boards'->(i / 9)) = 'null'
              and (p_board->>'next' is null or i / 9 = (p_board->>'next')::integer)))
   order by random() limit 1;
$$;

-- ---------------------------------------------------------------- moteur (délégation au socle)

-- Hook de trophées du socle duel (features/duel.sql, _duel_tstats) : stats propres au jeu.
-- La variante est celle de la session (session.board_options.variant).
create or replace function public.game_morpion_trophy_stats(p_state jsonb, p_pl text)
returns jsonb language sql stable
set search_path = public, extensions
as $$
  with v as (
    select public._morpion_variant(p_state->'session'->'board_options') as variant,
           coalesce((p_state->'session'->'stats'->p_pl->>'wins')::integer, 0) as wins
  ), g as (select * from public._duel_games(p_state, p_pl))
  select jsonb_build_object(
    'classic_fast_loss', case when v.variant = 'classic' then (select count(*) from g where lost and moves <= 7) else 0 end,
    'giant_wins', case when v.variant = 'giant' then (select count(*) from g where won) else 0 end,
    'win_classic', case when v.variant = 'classic' and v.wins >= 1 then 1 else 0 end,
    'win_giant', case when v.variant = 'giant' and v.wins >= 1 then 1 else 0 end,
    'win_ultimate', case when v.variant = 'ultimate' and v.wins >= 1 then 1 else 0 end,
    'classic_second_win', case when v.variant = 'classic' then (select count(*) from g where won and not i_started) else 0 end,
    'giant_fast_win', case when v.variant = 'giant' then (select count(*) from g where won and moves <= 13) else 0 end,
    'ultimate_duel_wins', case when v.variant = 'ultimate' then v.wins else 0 end,
    'clean_ultimate', case when v.variant = 'ultimate'
        then (select count(*) from public._duel_games_x(p_state, p_pl) x
               where x.won and coalesce((x.g->>'clean_ultimate')::boolean, false)) else 0 end)
  from v
$$;
revoke all on function public.game_morpion_trophy_stats(jsonb, text) from public, anon, authenticated;

create or replace function public.game_morpion_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare v_var jsonb := p_options->'board'->'variant';
begin
  if cardinality(p_players) > 9 then raise exception 'too_many_players'; end if;
  if v_var is not null and (jsonb_typeof(v_var) <> 'string' or v_var #>> '{}' not in ('classic', 'giant', 'ultimate')) then
    raise exception 'invalid_variant';
  end if;
  return public._duel_start('morpion', p_players, p_options);
end $$;

create or replace function public.game_morpion_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
begin
  return public._duel_action('morpion', p_state, p_server, p_actor, p_is_host, p_action);
end $$;

revoke all on function public._morpion_variant(jsonb) from public, anon, authenticated;
revoke all on function public._morpion_at(jsonb, integer, integer, integer) from public, anon, authenticated;
revoke all on function public._morpion_runs(jsonb, integer, integer, integer, text) from public, anon, authenticated;
revoke all on function public._morpion_sub(jsonb, integer) from public, anon, authenticated;
revoke all on function public._morpion_full(jsonb) from public, anon, authenticated;
revoke all on function public.game_morpion_board_new(jsonb, text, text) from public, anon, authenticated;
revoke all on function public.game_morpion_board_move(jsonb, jsonb, text, jsonb) from public, anon, authenticated;
revoke all on function public.game_morpion_board_auto(jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.game_morpion_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_morpion_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;


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

-- Compteurs de trophées par joueur dans server.pstats (jamais dans le state public) :
-- ajoute p_n à p_key (ou prend le max si p_max).
create or replace function public._pdb_pst(p_server jsonb, p_pl text, p_key text, p_n numeric, p_max boolean default false)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_cur numeric := coalesce((p_server->'pstats'->p_pl->>p_key)::numeric, 0);
  v_new numeric := case when p_max then greatest(v_cur, p_n) else v_cur + p_n end;
begin
  return p_server || jsonb_build_object('pstats',
    coalesce(p_server->'pstats', '{}'::jsonb) || jsonb_build_object(p_pl,
      coalesce(p_server->'pstats'->p_pl, '{}'::jsonb) || jsonb_build_object(p_key, v_new)));
end $$;

-- Un cumul +2/+4 vient d'être pioché par p_player (p_count cartes) : plus gros tas, et les cartes
-- sont créditées (« infligées ») à ceux qui ont empilé (server.pend_src).
create or replace function public._pdb_cumul(p_server jsonb, p_player text, p_count integer)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  r record;
begin
  p_server := public._pdb_pst(p_server, p_player, 'big_draw', p_count, true);
  for r in select key, value::integer as n from jsonb_each_text(coalesce(p_server->'pend_src', '{}'::jsonb)) loop
    p_server := public._pdb_pst(p_server, r.key, 'inflicted', r.n);
  end loop;
  return p_server - 'pend_src';
end $$;

-- Met à jour le record de cartes en main de chaque joueur (appelé après chaque action et à la fin).
create or replace function public._pdb_track_hands(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  p text;
begin
  for p in select jsonb_array_elements_text(p_state->'players') loop
    p_server := public._pdb_pst(p_server, p, 'max_hand', coalesce((p_state->'counts'->>p)::integer, 0), true);
  end loop;
  return p_server;
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
  p_server := public._pdb_pst(p_server, p_player, 'drawn', jsonb_array_length(v_drawn));
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
  v_ps      jsonb;
  i         integer;
begin
  p_server := public._pdb_track_hands(p_state, p_server);
  for i in 1 .. cardinality(v_ranked) loop
    v_ps := coalesce(p_server->'pstats'->v_ranked[i], '{}'::jsonb);
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'profile_id', v_ranked[i],
      'placement', i,
      'points', v_n - i,
      'won', (i = 1) or (v_n >= 5 and i <= 3),
      -- trophées (features/trophees.sql), cumulés dans server.pstats
      'stats', jsonb_build_object(
        'big_draw', coalesce((v_ps->>'big_draw')::integer, 0),
        'denounced', coalesce((v_ps->>'denounced')::integer, 0),
        'denounces', coalesce((v_ps->>'denounces')::integer, 0),
        'special_cards', coalesce((v_ps->>'specials')::integer, 0),
        'max_hand', coalesce((v_ps->>'max_hand')::integer, 0),
        'inflicted', coalesce((v_ps->>'inflicted')::integer, 0),
        'stacks', coalesce((v_ps->>'stacks')::integer, 0),
        -- Main propre : 1er sorti ayant pioché 2 cartes au plus ; Remontada : 1er sorti après 10+ cartes en main
        'clean_win', case when i = 1 and p_server->'pstats' is not null
                           and coalesce((v_ps->>'drawn')::integer, 0) <= 2 then 1 else 0 end,
        'comeback', case when i = 1 and coalesce((v_ps->>'max_hand')::integer, 0) >= 10 then 1 else 0 end)));
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
  v_sidx     integer;
  v_stolen   jsonb;
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
      if v_pending > 0 then p_server := public._pdb_cumul(p_server, v_turn, jsonb_array_length(v_r->'drawn')); end if;
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
    p_server := public._pdb_pst(public._pdb_pst(p_server, v_target, 'denounced', 1), v_me, 'denounces', 1);
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
      p_server := public._pdb_cumul(p_server, v_me, jsonb_array_length(v_r->'drawn'));
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

    -- Compteurs de trophées (server.pstats)
    if v_kind <> 'num' then p_server := public._pdb_pst(p_server, v_me, 'specials', 1); end if;
    if v_kind in ('plus2', 'wild4') then
      if v_pending > 0 then p_server := public._pdb_pst(p_server, v_me, 'stacks', 1); end if;
      p_server := p_server || jsonb_build_object('pend_src', coalesce(p_server->'pend_src', '{}'::jsonb)
        || jsonb_build_object(v_me, coalesce((p_server->'pend_src'->>v_me)::integer, 0)
                                    + case when v_kind = 'plus2' then 2 else 4 end));
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
            p_server := public._pdb_pst(p_server, v_me, 'inflicted', jsonb_array_length(v_r->'drawn'));
          end if;
        end loop;
      elsif v_perso = 'manon' then
        -- Petit carnet : la main de la cible est montrée en secret à Manon (secret.peek),
        -- puis elle lui prend 1 carte au hasard (sauf si la cible n'en a qu'une, ou si Manon
        -- vient de poser sa dernière carte).
        v_peek := jsonb_build_object('target', v_target, 'hand', p_server->'hands'->v_target,
                                     'until', public._pdb_iso(now() + interval '8 seconds'),
                                     'n', coalesce((p_state->>'log_seq')::integer, 0) + 1);
        v_newh := p_server->'hands'->v_target;
        if jsonb_array_length(v_newh) >= 2 and jsonb_array_length(v_hand) > 0 then
          select (o - 1)::integer, e into v_sidx, v_stolen
            from jsonb_array_elements(v_newh) with ordinality as t(e, o) order by random() limit 1;
          v_hand := v_hand || jsonb_build_array(v_stolen);
          p_server := jsonb_set(p_server, array['hands', v_target], v_newh - v_sidx);
          p_server := jsonb_set(p_server, array['hands', v_me], v_hand);
          p_state := jsonb_set(p_state, array['counts', v_target], to_jsonb(jsonb_array_length(v_newh) - 1));
          p_state := jsonb_set(p_state, array['counts', v_me], to_jsonb(jsonb_array_length(v_hand)));
          v_peek := v_peek || jsonb_build_object('stolen', v_stolen->>'id');
          v_entry := v_entry || jsonb_build_object('stolen', true);
        end if;
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
        p_server := public._pdb_pst(p_server, v_me, 'inflicted', jsonb_array_length(v_r->'drawn'));
      elsif v_perso = 'marius' then
        -- Capuche : annule tout le cumul en attente ; sans cumul, le joueur suivant passe son tour.
        if v_pending > 0 then
          v_entry := v_entry || jsonb_build_object('blocked', v_pending);
        else
          v_skip := 2;
          v_entry := v_entry || jsonb_build_object('skipped', true);
        end if;
        p_state := p_state || jsonb_build_object('pending_draw', 0, 'pending_kind', null);
        p_server := p_server - 'pend_src';
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

  p_server := public._pdb_track_hands(p_state, p_server);

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
revoke all on function public._pdb_pst(jsonb, text, text, numeric, boolean) from public, anon, authenticated;
revoke all on function public._pdb_cumul(jsonb, text, integer) from public, anon, authenticated;
revoke all on function public._pdb_track_hands(jsonb, jsonb) from public, anon, authenticated;
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

-- Compteur de trophées de la manche : det[pl][key] += 1.
create or replace function public._pb_bump(p_det jsonb, p_pl text, p_key text)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select p_det || jsonb_build_object(p_pl,
    coalesce(p_det->p_pl, '{}'::jsonb) || jsonb_build_object(p_key, coalesce((p_det->p_pl->>p_key)::integer, 0) + 1))
$$;

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
  v_det     jsonb := '{}'::jsonb;
  v_c       text;
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

    -- Compteurs de trophées : refusées, partagées, vides, grille pleine, contestations abouties
    for pl in select x from jsonb_array_elements_text(p_state->'players') x loop
      v_status := v_cd->pl->>'status';
      if v_status = 'refused' then
        v_det := public._pb_bump(v_det, pl, 'refused');
        for v_c in select x from jsonb_array_elements_text(
                     coalesce(p_state#>array['validation', 'contests', v_cat, pl], '[]'::jsonb)) x loop
          v_det := public._pb_bump(v_det, v_c, 'lawyer');
        end loop;
      elsif v_status = 'shared' then
        v_det := public._pb_bump(v_det, pl, 'shared');
      elsif v_status = 'empty' then
        v_det := public._pb_bump(v_det, pl, 'empty');
      end if;
      if v_status in ('unique', 'shared') then v_det := public._pb_bump(v_det, pl, 'valid'); end if;
    end loop;
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
        'round', p_state->'round', 'letter', p_state->'letter', 'points', v_points, 'det', v_det)));
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Stats de fin de partie pour les trophées (features/trophees.sql) : tout se lit dans history[].points.
create or replace function public._pb_tstats(p_state jsonb, p_pl text)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  with h as (
    select coalesce((e.v->'points'->>p_pl)::integer, 0) as mine,
           coalesce((select max(value::integer) from jsonb_each_text(e.v->'points')), 0) as mx,
           coalesce((e.v->'det'->p_pl->>'refused')::integer, 0) as refused,
           coalesce((e.v->'det'->p_pl->>'shared')::integer, 0) as shared,
           coalesce((e.v->'det'->p_pl->>'empty')::integer, 0) as empty,
           coalesce((e.v->'det'->p_pl->>'valid')::integer, 0) as valid,
           coalesce((e.v->'det'->p_pl->>'lawyer')::integer, 0) as lawyer
      from jsonb_array_elements(coalesce(p_state->'history', '[]'::jsonb)) as e(v)
  )
  select jsonb_build_object(
    'uniques', coalesce((p_state->'uniques'->>p_pl)::integer, 0),
    'refused', coalesce(sum(refused), 0),
    'shared', coalesce(sum(shared), 0),
    'max_empty', coalesce(max(empty), 0),
    'full_grids', count(*) filter (where valid >= jsonb_array_length(p_state->'categories')),
    'lawyer', coalesce(sum(lawyer), 0),
    'zero_rounds', count(*) filter (where mine = 0),
    'perfect_rounds', count(*) filter (where mine = 2 * jsonb_array_length(p_state->'categories')),
    'best_rounds', count(*) filter (where mine > 0 and mine = mx),
    'regular', case when count(*) >= 3 and min(mine) >= 8 then 1 else 0 end,
    'grand_slam', case when count(*) >= 4 and bool_and(mine = mx and mx > 0) then 1 else 0 end)
  from h
$$;

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
           'stats', public._pb_tstats(p_state, t.key))
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
revoke all on function public._pb_bump(jsonb, text, text) from public, anon, authenticated;
revoke all on function public._pb_to_validation(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._pb_score(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._pb_finish(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._pb_tstats(jsonb, text) from public, anon, authenticated;
revoke all on function public.game_petit_bac_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_petit_bac_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;


-- ===== games\quatre-a-la-suite.sql =====
-- =============================================================================
-- JEU « 4 à la suite » (id quatre-a-la-suite) — jeu en DUEL (socle
-- supabase/features/duel.sql). Règles traditionnelles « aligner 4 jetons » :
-- grille de 7 colonnes × 6 lignes, on lâche un jeton dans une colonne, il tombe
-- sur la plus basse case libre. 4 jetons alignés (horizontale, verticale ou
-- diagonale) = manche gagnée ; grille pleine = nul.
--
-- Plateau public (state.board) :
--   {"width":7, "height":6,
--    "cols": [["<uid>", ...] x7],      -- chaque colonne, du BAS vers le haut
--    "a": "<uid>", "b": "<uid>",       -- duellistes (a = couleur 1, b = couleur 2)
--    "count": n,                       -- jetons posés
--    "last": {"col":c, "row":r, "by":"<uid>"} | null,   -- row 0 = en bas
--    "line": [[c, r], ...] | null}     -- jetons gagnants (4 ou plus, plusieurs lignes possibles)
-- Coup : {"col": 0..6}. Pas de secret, pas de server, pas de préparation.
-- =============================================================================

-- Propriétaire de la case (c, r) ou null (hors grille / vide).
create or replace function public._q4s_cell(p_cols jsonb, p_c integer, p_r integer)
returns text language sql immutable
set search_path = public, extensions
as $$
  select case when p_c between 0 and 6 and p_r between 0 and 5 then p_cols->p_c->>p_r end;
$$;

-- Cases alignées (>= 4) passant par (c, r) pour p_who, toutes directions ; null sinon.
create or replace function public._q4s_line(p_cols jsonb, p_c integer, p_r integer, p_who text)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_dirs  integer[] := array[1,0, 0,1, 1,1, 1,-1];
  v_line  jsonb := '[]'::jsonb;
  v_seg   jsonb;
  dc      integer;
  dr      integer;
  k       integer;
  i       integer;
begin
  for i in 0 .. 3 loop
    dc := v_dirs[i * 2 + 1];
    dr := v_dirs[i * 2 + 2];
    v_seg := jsonb_build_array(jsonb_build_array(p_c, p_r));
    k := 1;
    while public._q4s_cell(p_cols, p_c + k * dc, p_r + k * dr) = p_who loop
      v_seg := v_seg || jsonb_build_array(jsonb_build_array(p_c + k * dc, p_r + k * dr));
      k := k + 1;
    end loop;
    k := 1;
    while public._q4s_cell(p_cols, p_c - k * dc, p_r - k * dr) = p_who loop
      v_seg := v_seg || jsonb_build_array(jsonb_build_array(p_c - k * dc, p_r - k * dr));
      k := k + 1;
    end loop;
    if jsonb_array_length(v_seg) >= 4 then
      v_line := v_line || (select coalesce(jsonb_agg(e), '[]'::jsonb) from jsonb_array_elements(v_seg) e
                            where not (v_line @> jsonb_build_array(e)));
    end if;
  end loop;
  return case when jsonb_array_length(v_line) > 0 then v_line end;
end $$;

-- Trophées : directions gagnantes du dernier jeton posé en (c, r) : {"n": nb de directions alignant >= 4,
-- "diag": une diagonale gagne, "five": un alignement de 5+ jetons}.
create or replace function public._q4s_kinds(p_cols jsonb, p_c integer, p_r integer, p_who text)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_dirs integer[] := array[1,0, 0,1, 1,1, 1,-1];
  v_n    integer := 0;
  v_diag boolean := false;
  v_five boolean := false;
  v_len  integer;
  dc     integer;
  dr     integer;
  k      integer;
  i      integer;
begin
  for i in 0 .. 3 loop
    dc := v_dirs[i * 2 + 1];
    dr := v_dirs[i * 2 + 2];
    v_len := 1;
    k := 1;
    while public._q4s_cell(p_cols, p_c + k * dc, p_r + k * dr) = p_who loop v_len := v_len + 1; k := k + 1; end loop;
    k := 1;
    while public._q4s_cell(p_cols, p_c - k * dc, p_r - k * dr) = p_who loop v_len := v_len + 1; k := k + 1; end loop;
    if v_len >= 4 then
      v_n := v_n + 1;
      if i >= 2 then v_diag := true; end if;
      if v_len >= 5 then v_five := true; end if;
    end if;
  end loop;
  return jsonb_build_object('n', v_n, 'diag', v_diag, 'five', v_five);
end $$;

-- ---------------------------------------------------------------- hooks du socle

create or replace function public.game_quatre_a_la_suite_board_new(p_ctx jsonb, p_a text, p_b text)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select jsonb_build_object('board', jsonb_build_object(
    'width', 7, 'height', 6,
    'cols', '[[],[],[],[],[],[],[]]'::jsonb,
    'a', p_a, 'b', p_b,
    'count', 0, 'last', null, 'line', null));
$$;

create or replace function public.game_quatre_a_la_suite_board_move(p_board jsonb, p_server jsonb, p_actor text, p_move jsonb)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_c     integer;
  v_r     integer;
  v_cols  jsonb := p_board->'cols';
  v_line  jsonb;
  v_count integer := coalesce((p_board->>'count')::integer, 0) + 1;
begin
  if jsonb_typeof(p_move->'col') is distinct from 'number' or coalesce(p_move->>'col', '') !~ '^[0-6]$' then
    raise exception 'invalid_move';
  end if;
  v_c := (p_move->>'col')::integer;
  v_r := jsonb_array_length(v_cols->v_c);
  if v_r >= 6 then raise exception 'column_full'; end if;
  v_cols := jsonb_set(v_cols, array[v_c::text], (v_cols->v_c) || to_jsonb(p_actor));
  v_line := public._q4s_line(v_cols, v_c, v_r, p_actor);
  p_board := p_board || jsonb_build_object(
    'cols', v_cols, 'count', v_count,
    'last', jsonb_build_object('col', v_c, 'row', v_r, 'by', p_actor),
    'line', v_line);
  if v_line is not null then
    -- 'game' : compteurs de fin de manche pour les trophées (socle duel : games[].x)
    return jsonb_build_object('board', p_board, 'outcome', 'win', 'winner', p_actor,
      'game', jsonb_build_object(
        'diag', (public._q4s_kinds(v_cols, v_c, v_r, p_actor)->>'diag')::boolean,
        'double', (public._q4s_kinds(v_cols, v_c, v_r, p_actor)->>'n')::integer >= 2
                  or (public._q4s_kinds(v_cols, v_c, v_r, p_actor)->>'five')::boolean));
  elsif v_count >= 42 then
    return jsonb_build_object('board', p_board, 'outcome', 'draw');
  end if;
  return jsonb_build_object('board', p_board, 'outcome', null);
end $$;

-- Coup automatique (minuteur) : une colonne non pleine au hasard.
create or replace function public.game_quatre_a_la_suite_board_auto(p_board jsonb, p_server jsonb, p_actor text)
returns jsonb language sql volatile
set search_path = public, extensions
as $$
  select jsonb_build_object('col', c)
    from generate_series(0, 6) as c
   where jsonb_array_length(p_board->'cols'->c) < 6
   order by random() limit 1;
$$;

-- ---------------------------------------------------------------- moteur (délégation au socle)

-- Hook de trophées du socle duel (features/duel.sql, _duel_tstats) : stats propres au jeu.
-- « jetons » = coups des deux joueurs au total.
create or replace function public.game_quatre_a_la_suite_trophy_stats(p_state jsonb, p_pl text)
returns jsonb language sql stable
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'fast_loss', count(*) filter (where lost and moves <= 10),
    'long_win', count(*) filter (where won and moves >= 36),
    'fast_win', count(*) filter (where won and moves <= 12),
    'diag_wins', count(*) filter (where won and coalesce((g->>'diag')::boolean, false)),
    'double_wins', count(*) filter (where won and coalesce((g->>'double')::boolean, false)))
  from public._duel_games_x(p_state, p_pl)
$$;
revoke all on function public.game_quatre_a_la_suite_trophy_stats(jsonb, text) from public, anon, authenticated;

create or replace function public.game_quatre_a_la_suite_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if cardinality(p_players) > 9 then raise exception 'too_many_players'; end if;
  return public._duel_start('quatre-a-la-suite', p_players, p_options);
end $$;

create or replace function public.game_quatre_a_la_suite_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
begin
  return public._duel_action('quatre-a-la-suite', p_state, p_server, p_actor, p_is_host, p_action);
end $$;

revoke all on function public._q4s_cell(jsonb, integer, integer) from public, anon, authenticated;
revoke all on function public._q4s_line(jsonb, integer, integer, text) from public, anon, authenticated;
revoke all on function public._q4s_kinds(jsonb, integer, integer, text) from public, anon, authenticated;
revoke all on function public.game_quatre_a_la_suite_board_new(jsonb, text, text) from public, anon, authenticated;
revoke all on function public.game_quatre_a_la_suite_board_move(jsonb, jsonb, text, jsonb) from public, anon, authenticated;
revoke all on function public.game_quatre_a_la_suite_board_auto(jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.game_quatre_a_la_suite_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_quatre_a_la_suite_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;


-- ===== games\qui-suis-je.sql =====
-- =============================================================================
-- JEU « qui-suis-je » (Qui suis-je ? — téléphone sur le front) — idempotent.
-- Contrat complet : src/games/qui-suis-je/types.ts (en-tête).
--
-- Options (p_options de start_match), préparées par le front de l'hôte :
--   {"rounds": 1|2, "turn_seconds": 45|60|90, "difficulty": "facile|mixte|difficile",
--    "themes": ["celebrites", ...],
--    "cards": [{"id":"qs0001","name":"Astérix","theme":"dessins-animes","difficulty":1,
--               "slug":"dede"?, "sub":"Delphine"?}, ...]}
--   `cards` = file unique consommée dans l'ordre par tous les tours (les cartes
--   non montrées d'un tour servent au suivant ; on reboucle si elle est épuisée).
-- Les cartes ne sont pas secrètes (tout le monde sauf le devineur doit les voir),
-- mais seule la carte courante est publiée dans le state ; la file vit dans `server`.
-- =============================================================================

-- Horodatage ISO-8601 UTC millisecondes (parsable partout, Safari compris).
create or replace function public._qsj_iso(p timestamptz)
returns text language sql immutable
set search_path = public, extensions
as $$ select to_char(p at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;

-- Tour p_turn : le devineur se prépare (pose le téléphone sur son front).
-- Pas d'échéance : le devineur envoie `ready` (l'hôte peut passer le tour).
create or replace function public._qsj_start_turn(p_state jsonb, p_server jsonb, p_turn integer)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_n integer := jsonb_array_length(p_state->'order');
begin
  p_state := p_state || jsonb_build_object(
    'phase', 'placing',
    'turn', p_turn,
    'round', ((p_turn - 1) / v_n) + 1,
    'guesser', p_state->'order'->((p_turn - 1) % v_n),
    'card', null,
    'card_index', 0,
    'starts_at', null,
    'deadline', null,
    'turn_found', 0,
    'turn_passed', 0,
    'turn_log', '[]'::jsonb);
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Carte suivante de la file (rebouclage en fin de file).
create or replace function public._qsj_next_card(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_len integer := jsonb_array_length(p_server->'cards');
  v_pos integer := coalesce((p_server->>'pos')::integer, 0);
begin
  if v_pos >= v_len then v_pos := 0; end if;
  p_state := p_state || jsonb_build_object('card', p_server->'cards'->v_pos);
  p_server := p_server || jsonb_build_object('pos', v_pos + 1);
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Fin du tour : récap 4 s.
create or replace function public._qsj_end_turn(p_state jsonb, p_server jsonb, p_skipped boolean)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_summary jsonb;
begin
  v_summary := jsonb_build_object(
    'turn', p_state->'turn',
    'guesser', p_state->'guesser',
    'found', coalesce((p_state->>'turn_found')::integer, 0),
    'passed', coalesce((p_state->>'turn_passed')::integer, 0),
    'skipped', p_skipped,
    -- log compact : [{n: nom, r: 'found'|'pass', s?: slug}]
    'log', coalesce((select jsonb_agg(
                       jsonb_strip_nulls(jsonb_build_object('n', e->'card'->>'name', 'r', e->>'r', 's', e->'card'->>'slug',
                                          'd', e->'card'->>'difficulty'))
                       order by o)
                       from jsonb_array_elements(coalesce(p_state->'turn_log', '[]'::jsonb)) with ordinality as x(e, o)),
                    '[]'::jsonb));
  p_state := p_state || jsonb_build_object(
    'phase', 'recap',
    'card', null,
    'starts_at', null,
    'deadline', public._qsj_iso(now() + make_interval(secs => (p_state->>'recap_seconds')::integer)),
    'last_turn', v_summary,
    'history', coalesce(p_state->'history', '[]'::jsonb) || jsonb_build_array(v_summary));
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Stats de fin de partie pour les trophées (features/trophees.sql) : tours du joueur dans history[].
create or replace function public._qsj_tstats(p_state jsonb, p_pl text)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  with t as (
    select e.o, (e.v->>'found')::integer as found, (e.v->>'passed')::integer as passed, e.v->'log' as log
      from jsonb_array_elements(coalesce(p_state->'history', '[]'::jsonb)) with ordinality as e(v, o)
     where e.v->>'guesser' = p_pl and not coalesce((e.v->>'skipped')::boolean, false)
  ), l as (
    select t.o as turn_o, x.o as i, x.e->>'r' as r, x.e->>'s' as s, x.e->>'d' as d
      from t, jsonb_array_elements(coalesce(t.log, '[]'::jsonb)) with ordinality as x(e, o)
  ), runs as (
    select turn_o, r, i - row_number() over (partition by turn_o, r order by i) as grp from l
  )
  select jsonb_build_object(
    'empty_turns', count(*) filter (where found = 0),
    'max_passed', coalesce(max(passed), 0),
    'clean_turns', count(*) filter (where passed = 0 and found >= 3),
    'best_turn', coalesce(max(found), 0),
    'steady', case when count(*) >= 2 and min(found) >= 5 then 1 else 0 end,
    'crew_found', (select count(*) from l where r = 'found' and s is not null),
    'hard_found', (select count(*) from l where r = 'found' and d = '3'),
    'best_run', coalesce((select max(c) from (select count(*) as c from runs where r = 'found' group by turn_o, grp) z), 0))
  from t
$$;

-- Fin de partie : classement par cartes trouvées.
create or replace function public._qsj_finish(p_state jsonb, p_server jsonb)
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
           'stats', jsonb_build_object('found', t.value::integer) || public._qsj_tstats(p_state, t.key))
         order by t.r, t.key)
    into v_results
    from (select key, value, rank() over (order by value::integer desc) as r
            from jsonb_each_text(p_state->'scores')) t;
  select coalesce(jsonb_agg(key order by key), '[]'::jsonb) into v_winners
    from jsonb_each_text(p_state->'scores') where v_max > 0 and value::integer = v_max;
  p_state := p_state || jsonb_build_object(
    'phase', 'finished', 'deadline', null, 'starts_at', null, 'card', null,
    'winners', v_winners, 'results', v_results);
  return jsonb_build_object('state', p_state, 'server', p_server, 'results', v_results);
end $$;

-- -----------------------------------------------------------------------------
-- Démarrage
-- -----------------------------------------------------------------------------
create or replace function public.game_qui_suis_je_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_n      integer := cardinality(p_players);
  v_rounds integer;
  v_secs   integer;
  v_diff   text;
  v_cards  jsonb := p_options->'cards';
  v_clean  jsonb;
  v_themes jsonb;
  v_order  jsonb;
  v_zero   jsonb;
  v_state  jsonb;
begin
  if v_n < 2 then raise exception 'not_enough_players'; end if;
  if v_n > 9 then raise exception 'too_many_players'; end if;
  v_rounds := coalesce(nullif(p_options->>'rounds', '')::integer, 1);
  if v_rounds not in (1, 2) then v_rounds := 1; end if;
  v_secs := coalesce(nullif(p_options->>'turn_seconds', '')::integer, 60);
  if v_secs not in (45, 60, 90) then v_secs := 60; end if;
  v_diff := coalesce(p_options->>'difficulty', 'mixte');
  if v_diff not in ('facile', 'mixte', 'difficile') then v_diff := 'mixte'; end if;

  if v_cards is null or jsonb_typeof(v_cards) <> 'array' then raise exception 'missing_cards'; end if;
  if jsonb_array_length(v_cards) < 5 then raise exception 'not_enough_cards'; end if;
  if jsonb_array_length(v_cards) > 800 then raise exception 'invalid_cards'; end if;
  if exists (
    select 1 from jsonb_array_elements(v_cards) c
     where jsonb_typeof(c) <> 'object'
        or jsonb_typeof(c->'name') is distinct from 'string'
        or char_length(btrim(c->>'name')) not between 1 and 60
        or (c ? 'slug' and jsonb_typeof(c->'slug') <> 'null'
            and (jsonb_typeof(c->'slug') <> 'string' or (c->>'slug') !~ '^[a-z0-9-]{2,24}$')))
  then
    raise exception 'invalid_cards';
  end if;
  select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'id', left(coalesce(nullif(btrim(c->>'id'), ''), 'c' || o), 40),
           'name', btrim(regexp_replace(c->>'name', '\s+', ' ', 'g')),
           'theme', left(coalesce(nullif(btrim(c->>'theme'), ''), 'divers'), 30),
           'difficulty', least(greatest(coalesce(
                           case when jsonb_typeof(c->'difficulty') = 'number' then (c->>'difficulty')::numeric::integer end, 2), 1), 3),
           'slug', case when jsonb_typeof(c->'slug') = 'string' then c->>'slug' end,
           'sub', case when jsonb_typeof(c->'sub') = 'string' and btrim(c->>'sub') <> '' then left(btrim(c->>'sub'), 40) end))
           order by o)
    into v_clean
    from jsonb_array_elements(v_cards) with ordinality as t(c, o);

  select coalesce(jsonb_agg(left(t, 30)), '[]'::jsonb) into v_themes
    from (select t from jsonb_array_elements_text(
            case when jsonb_typeof(p_options->'themes') = 'array' then p_options->'themes' else '[]'::jsonb end) t
           where btrim(t) <> '' limit 12) s;

  select jsonb_agg(p order by random()) into v_order from unnest(p_players) p;
  select jsonb_object_agg(p::text, 0) into v_zero from unnest(p_players) p;

  v_state := jsonb_build_object(
    'game', 'qui-suis-je',
    'phase', 'placing',
    'players', to_jsonb(p_players),
    'order', v_order,
    'round', 1,
    'total_rounds', v_rounds,
    'turn', 1,
    'total_turns', v_rounds * v_n,
    'difficulty', v_diff,
    'themes', v_themes,
    'turn_seconds', v_secs,
    'countdown_seconds', 4,
    'recap_seconds', 4,
    'scores', v_zero,
    'last_turn', null,
    'history', '[]'::jsonb,
    'winners', null,
    'results', null);

  return public._qsj_start_turn(v_state, jsonb_build_object('cards', v_clean, 'pos', 0), 1);
end $$;

-- -----------------------------------------------------------------------------
-- Actions
-- -----------------------------------------------------------------------------
create or replace function public.game_qui_suis_je_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_type  text := p_action->>'type';
  v_phase text := p_state->>'phase';
  v_me    text := p_actor::text;
  v_turn  integer := (p_state->>'turn')::integer;
  v_idx   integer;
  v_start timestamptz;
  v_r     text;
begin
  -- ---------------------------------------------------------------------- ready
  if v_type = 'ready' then
    if v_phase <> 'placing' then raise exception 'wrong_phase'; end if;
    if v_me <> p_state->>'guesser' then raise exception 'not_your_turn'; end if;
    v_start := now() + make_interval(secs => (p_state->>'countdown_seconds')::integer);
    p_state := p_state || jsonb_build_object(
      'phase', 'playing',
      'starts_at', public._qsj_iso(v_start),
      'deadline', public._qsj_iso(v_start + make_interval(secs => (p_state->>'turn_seconds')::integer)));
    return public._qsj_next_card(p_state, p_server);

  -- -------------------------------------------------------------- found / pass
  elsif v_type in ('found', 'pass') then
    if v_phase <> 'playing' then raise exception 'wrong_phase'; end if;
    if v_me <> p_state->>'guesser' then raise exception 'not_your_turn'; end if;
    -- Pendant le 3-2-1 : trop tôt. Après l'échéance : 1 s de grâce (latence réseau)
    -- tant que personne n'a envoyé le tick de fin.
    if now() < (p_state->>'starts_at')::timestamptz
       or now() >= (p_state->>'deadline')::timestamptz + interval '1 second' then
      raise exception 'wrong_phase';
    end if;
    begin
      v_idx := (p_action->>'index')::integer;
    exception when others then
      raise exception 'invalid_card';
    end;
    if v_idx is null then raise exception 'invalid_card'; end if;
    if v_idx <> (p_state->>'card_index')::integer then raise exception 'wrong_card'; end if;
    v_r := v_type;
    p_state := p_state || jsonb_build_object(
      'card_index', v_idx + 1,
      'turn_log', coalesce(p_state->'turn_log', '[]'::jsonb)
                  || jsonb_build_array(jsonb_build_object('i', v_idx, 'r', v_r, 'card', p_state->'card')),
      'turn_found', coalesce((p_state->>'turn_found')::integer, 0) + case when v_r = 'found' then 1 else 0 end,
      'turn_passed', coalesce((p_state->>'turn_passed')::integer, 0) + case when v_r = 'pass' then 1 else 0 end);
    if v_r = 'found' then
      p_state := p_state || jsonb_build_object('scores', (p_state->'scores')
                   || jsonb_build_object(v_me, coalesce((p_state->'scores'->>v_me)::integer, 0) + 1));
    end if;
    return public._qsj_next_card(p_state, p_server);

  -- ----------------------------------------------------------------------- tick
  elsif v_type = 'tick' then
    if v_phase = 'playing' then
      if now() < (p_state->>'deadline')::timestamptz then
        return jsonb_build_object('state', p_state, 'server', p_server);
      end if;
      return public._qsj_end_turn(p_state, p_server, false);
    elsif v_phase = 'recap' then
      if now() < (p_state->>'deadline')::timestamptz then
        return jsonb_build_object('state', p_state, 'server', p_server);
      end if;
      if v_turn >= (p_state->>'total_turns')::integer then
        return public._qsj_finish(p_state, p_server);
      end if;
      return public._qsj_start_turn(p_state, p_server, v_turn + 1);
    end if;
    -- placing (pas d'échéance) ou autre : ignoré sans erreur.
    return jsonb_build_object('state', p_state, 'server', p_server);

  -- ------------------------------------------------------------------ skip_turn
  elsif v_type = 'skip_turn' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase not in ('placing', 'playing') then raise exception 'wrong_phase'; end if;
    return public._qsj_end_turn(p_state, p_server, true);

  else
    raise exception 'unknown_action';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Droits : fonctions internes, appelées uniquement via start_match / game_action.
-- -----------------------------------------------------------------------------
revoke all on function public._qsj_iso(timestamptz) from public, anon, authenticated;
revoke all on function public._qsj_start_turn(jsonb, jsonb, integer) from public, anon, authenticated;
revoke all on function public._qsj_next_card(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._qsj_end_turn(jsonb, jsonb, boolean) from public, anon, authenticated;
revoke all on function public._qsj_tstats(jsonb, text) from public, anon, authenticated;
revoke all on function public._qsj_finish(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.game_qui_suis_je_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_qui_suis_je_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;


-- ===== games\tour-des-potes.sql =====
-- =============================================================================
-- JEU « Le Tour des Potes » (id tour-des-potes) — plateau d'achat / location
-- dans les villes des amis (Bayon-sur-Gironde, Pugnac, Berson, Bordeaux).
-- Idempotent (create or replace). Dispatché par start_match / game_action.
-- Contrat complet (state public, actions, options) : src/games/tour-des-potes/types.ts.
-- Noms / anecdotes des lieux : src/games/tour-des-potes/board.ts (front). Ici
-- seulement l'économie (prix, loyers, prix des maisons) : _tdp_board(), qui
-- DOIT rester identique à board.ts (vérifié par le test PGlite).
--
-- PLATEAU (40 cases, sens horaire) : 0 Départ (+200 en passant / s'arrêtant),
-- 10 « En visite / Au violon », 20 « Pause apéro », 30 « Direction le violon ».
-- 22 lieux (8 quartiers), 4 maisons des potes (5/15/25/35 : loyer 25/50/100/200
-- selon le nombre possédé), 2 services (12/28 : dés ×4, ×10 avec les deux),
-- 2 taxes (4 : 200, 38 : 100), cartes Hasard (7/22/36) et Entre potes (2/17/33).
--
-- TOUR : phase roll (dés serveur ; double = rejoue ; 3e double = violon)
--   -> déplacement -> résolution (loyer / taxe automatiques ; lieu libre
--   -> phase buy ; case Hasard / Entre potes -> phase card) -> phase manage
--   (construire / vendre, puis end_turn) ou de nouveau roll après un double.
--   Construire / vendre aussi en roll et jail (pas en buy / card).
-- CARTES : arrivé sur une case carte DIRECTEMENT par les dés (lancer normal ou
--   sortie du violon en lançant), le joueur passe en phase card
--   (pending = {cell, deck}) et pioche lui-même avec {"type":"draw"} ; la
--   carte est alors appliquée (déplacement, achat -> buy, loyer, violon…).
--   Une carte qui renvoie sur une autre case carte est appliquée aussitôt
--   (chaîne limitée à 4 cartes, pas de nouvelle phase card).
-- VIOLON : phase jail en début de tour : pay_jail (50), use_card, ou roll (tenter
--   un double ; au 3e échec on paie 50 et on avance du total des dés).
-- DETTE : argent négatif du joueur au trait -> phase debt (vendre des bâtiments
--   à moitié prix ; retour automatique dès que l'argent est >= 0). Si même en
--   vendant tout il ne peut pas payer -> faillite immédiate. Un autre joueur
--   endetté (carte « chacun te donne ») vend automatiquement, sinon faillite.
--   Le créancier est toujours payé en entier (la banque éponge la dette).
--   Faillite : biens rendus à la banque (libres, sans bâtiments), cartes
--   « Sortie du violon » remises dans leur paquet, joueur spectateur.
-- FIN : format chrono (à l'échéance, fin du tour du joueur en cours), tours
--   (N tours de table), classique (dernier en lice ; filet 3 h). Classement par
--   fortune = argent + prix des lieux + prix des bâtiments.
-- MINUTEUR : deadline + {"type":"tick"} (action automatique : lancer, tenter le
--   double, piocher, passer l'achat, finir le tour, vendre / faillite). turn_seconds = 0
--   -> pas de minuteur. L'hôte : {"type":"skip"} = joueur absent (marqué away,
--   ses tours sont joués automatiquement jusqu'à ce qu'il agisse / {"type":"back"}).
-- PRÉVU PLUS TARD (non implémenté) : hypothèques, enchères, échanges. Points
--   d'extension : nouvelles actions dans game_tour_des_potes_action, la valeur
--   récupérable d'un joueur est centralisée dans _tdp_sale_value, la fortune
--   dans _tdp_fortune.
-- CAGNOTTE : tax_pot = taxes payées sur les cases 4 / 38 depuis le dernier
--   ramassage (hors fortune) ; le joueur qui s'arrête sur « Pause apéro » (20)
--   la ramasse en entier (évènement 'pot', last_event.pot = montant, stat pot) ; round_rents = {round, payments: [{no,
--   payer, owner, cell, amount}]} = loyers payés pendant le tour de table en
--   cours (no = event_no du log rent ; 60 au plus ; vidé quand round change).
--   States antérieurs sans ces champs : lus avec coalesce.
--
-- server : {"decks": {"hasard": [ids], "potes": [ids]}} (ordre de pioche) ;
--   TEST UNIQUEMENT : "forced_dice": [[a,b], ...] (file de dés imposés, lue par
--   _tdp_roll ; aucun client ne peut écrire match_server_state).
-- =============================================================================

create or replace function public._tdp_iso(p_ts timestamptz)
returns text language sql stable
set search_path = public, extensions
as $$
  select to_char(p_ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$$;

-- Économie du plateau (miroir de src/games/tour-des-potes/board.ts).
-- rents (quartier) = [nu, 1 maison, 2, 3, 4, hôtel] ; house = prix d'une maison.
create or replace function public._tdp_board()
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select '[
    {"i":0,"type":"depart"},
    {"i":1,"type":"quartier","group":"bayon-1","price":60,"house":50,"rents":[2,10,30,90,160,250]},
    {"i":2,"type":"entre_potes"},
    {"i":3,"type":"quartier","group":"bayon-1","price":60,"house":50,"rents":[4,20,60,180,320,450]},
    {"i":4,"type":"taxe","amount":200},
    {"i":5,"type":"potes","group":"potes","price":200},
    {"i":6,"type":"quartier","group":"bayon-2","price":100,"house":50,"rents":[6,30,90,270,400,550]},
    {"i":7,"type":"hasard"},
    {"i":8,"type":"quartier","group":"bayon-2","price":100,"house":50,"rents":[6,30,90,270,400,550]},
    {"i":9,"type":"quartier","group":"bayon-2","price":120,"house":50,"rents":[8,40,100,300,450,600]},
    {"i":10,"type":"violon"},
    {"i":11,"type":"quartier","group":"pugnac-1","price":140,"house":100,"rents":[10,50,150,450,625,750]},
    {"i":12,"type":"service","group":"service","price":150},
    {"i":13,"type":"quartier","group":"pugnac-1","price":140,"house":100,"rents":[10,50,150,450,625,750]},
    {"i":14,"type":"quartier","group":"pugnac-1","price":160,"house":100,"rents":[12,60,180,500,700,900]},
    {"i":15,"type":"potes","group":"potes","price":200},
    {"i":16,"type":"quartier","group":"pugnac-2","price":180,"house":100,"rents":[14,70,200,550,750,950]},
    {"i":17,"type":"entre_potes"},
    {"i":18,"type":"quartier","group":"pugnac-2","price":180,"house":100,"rents":[14,70,200,550,750,950]},
    {"i":19,"type":"quartier","group":"pugnac-2","price":200,"house":100,"rents":[16,80,220,600,800,1000]},
    {"i":20,"type":"apero"},
    {"i":21,"type":"quartier","group":"berson-1","price":220,"house":150,"rents":[18,90,250,700,875,1050]},
    {"i":22,"type":"hasard"},
    {"i":23,"type":"quartier","group":"berson-1","price":220,"house":150,"rents":[18,90,250,700,875,1050]},
    {"i":24,"type":"quartier","group":"berson-1","price":240,"house":150,"rents":[20,100,300,750,925,1100]},
    {"i":25,"type":"potes","group":"potes","price":200},
    {"i":26,"type":"quartier","group":"berson-2","price":260,"house":150,"rents":[22,110,330,800,975,1150]},
    {"i":27,"type":"quartier","group":"berson-2","price":260,"house":150,"rents":[22,110,330,800,975,1150]},
    {"i":28,"type":"service","group":"service","price":150},
    {"i":29,"type":"quartier","group":"berson-2","price":280,"house":150,"rents":[24,120,360,850,1025,1200]},
    {"i":30,"type":"direction_violon"},
    {"i":31,"type":"quartier","group":"bordeaux-1","price":300,"house":200,"rents":[26,130,390,900,1100,1275]},
    {"i":32,"type":"quartier","group":"bordeaux-1","price":300,"house":200,"rents":[26,130,390,900,1100,1275]},
    {"i":33,"type":"entre_potes"},
    {"i":34,"type":"quartier","group":"bordeaux-1","price":320,"house":200,"rents":[28,150,450,1000,1200,1400]},
    {"i":35,"type":"potes","group":"potes","price":200},
    {"i":36,"type":"hasard"},
    {"i":37,"type":"quartier","group":"bordeaux-2","price":350,"house":200,"rents":[35,175,500,1100,1300,1500]},
    {"i":38,"type":"taxe","amount":100},
    {"i":39,"type":"quartier","group":"bordeaux-2","price":400,"house":200,"rents":[50,200,600,1400,1700,2000]}
  ]'::jsonb;
$$;

-- Cartes (textes originaux). kind : move_to {cell} | move_by {steps} |
-- nearest {target: potes|service} | jail | jail_card | gain {amount} |
-- pay {amount} | collect_each {amount} | pay_each {amount} | repairs {house, hotel} |
-- friend_gain / friend_pay {slug, amount} : le pote `slug` te donne / tu donnes au pote
-- (la banque s'il ne joue pas ou si c'est lui qui pioche).
-- Ids : hNN (paquet « hasard »), pNN (paquet « potes » = Entre potes) ; les paquets
-- sont construits dynamiquement (préfixe h/p) : ajouter une carte = ajouter une ligne.
-- h17+/p17+ : cartes « persos » (foot de Marius, muscu de Keke, travaux de Dédé…).
create or replace function public._tdp_cards()
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select '{
    "h01":{"deck":"hasard","kind":"move_to","cell":0,"text":"Le dernier bac part sans toi si tu traînes : file au Départ et empoche 200 €."},
    "h02":{"deck":"hasard","kind":"move_to","cell":39,"text":"Grand dîner chez des amis bordelais : avance jusqu’au dernier lieu de Bordeaux. Si tu passes par le Départ, touche 200 €."},
    "h03":{"deck":"hasard","kind":"move_to","cell":11,"text":"Rendez-vous à la fête des vendanges : avance jusqu’au premier lieu de Pugnac. Si tu passes par le Départ, touche 200 €."},
    "h04":{"deck":"hasard","kind":"move_to","cell":21,"text":"Pique-nique improvisé : avance jusqu’au premier lieu de Berson. Si tu passes par le Départ, touche 200 €."},
    "h05":{"deck":"hasard","kind":"move_to","cell":5,"text":"Apéro surprise chez Dédé & Nini : avance jusqu’à leur maison. Si tu passes par le Départ, touche 200 €."},
    "h06":{"deck":"hasard","kind":"nearest","target":"potes","text":"Covoiturage de dernière minute : avance jusqu’à la maison des potes la plus proche. Si elle a déjà un proprio, paie-lui le double du loyer."},
    "h07":{"deck":"hasard","kind":"nearest","target":"service","text":"Ta voiture fait un drôle de bruit : avance jusqu’au service le plus proche. S’il a un proprio, paie-lui 10 fois les dés."},
    "h08":{"deck":"hasard","kind":"move_by","steps":-3,"text":"Ton GPS t’a perdu au milieu des vignes : recule de 3 cases."},
    "h09":{"deck":"hasard","kind":"jail","text":"Les voisins se plaignent de la musique : direction le violon, sans passer par le Départ ni toucher 200 €."},
    "h10":{"deck":"hasard","kind":"jail_card","text":"Un copain gendarme te doit un service. Carte « Sortie du violon » : garde-la pour plus tard."},
    "h11":{"deck":"hasard","kind":"gain","amount":50,"text":"Tu remportes le concours de pétanque du village : la banque te verse 50 €."},
    "h12":{"deck":"hasard","kind":"gain","amount":150,"text":"Ta cave à vin a pris de la valeur : encaisse 150 €."},
    "h13":{"deck":"hasard","kind":"pay","amount":15,"text":"Flashé·e à 3 km/h au-dessus sur la rocade : paie 15 €."},
    "h14":{"deck":"hasard","kind":"repairs","house":25,"hotel":100,"text":"Gros orage sur l’estuaire : paie 25 € par maison et 100 € par hôtel pour les réparations."},
    "h15":{"deck":"hasard","kind":"pay_each","amount":50,"text":"Tu es désigné·e capitaine de soirée : offre 50 € d’essence à chaque joueur."},
    "h16":{"deck":"hasard","kind":"gain","amount":100,"text":"Ton ticket de tombola de la fête du village est gagnant : touche 100 €."},
    "h17":{"deck":"hasard","kind":"move_to","cell":39,"text":"Marius a match au Stade Chaban-Delmas : file l’encourager ! Si tu passes par le Départ, touche 200 €."},
    "h18":{"deck":"hasard","kind":"pay","amount":30,"text":"Keke t’a traîné·e à la salle de muscu : paie 30 € de séance d’essai. Les courbatures sont offertes."},
    "h20":{"deck":"hasard","kind":"friend_gain","slug":"cycy","amount":100,"text":"Cycy veut absolument aller aux Voûtes et t’invite ! Cycy te donne 100 €."},
    "h21":{"deck":"hasard","kind":"move_to","cell":25,"text":"Manon a perdu sa Switch et ne peut plus jouer à Animal Crossing : file chez Karo, Manon & Marius pour aider à la chercher ! Si tu passes par le Départ, touche 200 €."},
    "h22":{"deck":"hasard","kind":"friend_gain","slug":"mika","amount":50,"text":"Grâce à ton coup de main, Mika a fini son chantier en avance : Mika te donne 50 €."},
    "h23":{"deck":"hasard","kind":"move_by","steps":-3,"text":"Promenade avec Cécile et Kaya : Kaya a flairé une piste et fait demi-tour. Recule de 3 cases."},
    "h24":{"deck":"hasard","kind":"friend_pay","slug":"carole","amount":50,"text":"Journée plage avec Karo : c’est toi qui offres les glaces. Donne 50 € à Karo."},
    "h19":{"deck":"hasard","kind":"repairs","house":20,"hotel":80,"text":"Dédé débarque avec la caisse à outils pour « juste un petit coup de peinture » : paie 20 € par maison et 80 € par hôtel."},
    "p01":{"deck":"potes","kind":"move_to","cell":0,"text":"On t’a confié les clés de la salle des fêtes : retourne au Départ et touche 200 €."},
    "p02":{"deck":"potes","kind":"collect_each","amount":10,"text":"C’est ta crémaillère ! Chaque joueur te donne 10 € pour la déco."},
    "p03":{"deck":"potes","kind":"collect_each","amount":20,"text":"Ta playlist a fait danser tout le monde jusqu’à l’aube : chaque joueur te donne 20 €."},
    "p04":{"deck":"potes","kind":"pay","amount":50,"text":"Tu as oublié le dessert : file à la boulangerie, paie 50 €."},
    "p05":{"deck":"potes","kind":"gain","amount":100,"text":"La cagnotte du week-end entre potes te rembourse : touche 100 €."},
    "p06":{"deck":"potes","kind":"jail_card","text":"Tu connais le patron du bar d’en face. Carte « Sortie du violon » : garde-la pour plus tard."},
    "p07":{"deck":"potes","kind":"jail","text":"Le karaoké a un peu trop dérapé : direction le violon, sans passer par le Départ ni toucher 200 €."},
    "p08":{"deck":"potes","kind":"pay","amount":100,"text":"Facture du traiteur pour la soirée déguisée : paie 100 €."},
    "p09":{"deck":"potes","kind":"gain","amount":25,"text":"Deuxième au quiz du bar : touche 25 €."},
    "p10":{"deck":"potes","kind":"gain","amount":50,"text":"Tu retrouves un billet dans la poche de ta veste de l’hiver dernier : touche 50 €."},
    "p11":{"deck":"potes","kind":"repairs","house":40,"hotel":115,"text":"Ravalement de façade obligatoire : paie 40 € par maison et 115 € par hôtel."},
    "p12":{"deck":"potes","kind":"gain","amount":75,"text":"Vide-grenier réussi : tu as enfin vendu le vieux canapé. Touche 75 €."},
    "p13":{"deck":"potes","kind":"pay_each","amount":20,"text":"Tournée de chocolatines pour toute la bande : paie 20 € à chaque joueur."},
    "p14":{"deck":"potes","kind":"pay","amount":30,"text":"Tu as perdu ton pari sur le match de foot : paie 30 €."},
    "p15":{"deck":"potes","kind":"gain","amount":20,"text":"Remboursement de covoiturage : touche 20 €."},
    "p16":{"deck":"potes","kind":"gain","amount":10,"text":"Ta tarte aux fraises remporte le concours de la kermesse : touche 10 €."},
    "p17":{"deck":"potes","kind":"pay","amount":50,"text":"Tu pars voir le match de foot de Marius : tu paies ton coup à boire à la buvette. Paie 50 €."},
    "p18":{"deck":"potes","kind":"move_by","steps":-3,"text":"Séance jambes avec Keke : tu ne sens plus tes cuisses. Recule de 3 cases."},
    "p20":{"deck":"potes","kind":"friend_pay","slug":"cycy","amount":100,"text":"Cycy veut absolument aller aux Voûtes… et c’est toi qui invites ! Donne 100 € à Cycy."},
    "p21":{"deck":"potes","kind":"friend_pay","slug":"mika","amount":50,"text":"Mika a besoin d’aide pour son chantier : donne 50 € à Mika pour le matériel."},
    "p22":{"deck":"potes","kind":"move_by","steps":3,"text":"Promenade avec Cécile et Kaya : Kaya tire sur la laisse ! Avance de 3 cases."},
    "p23":{"deck":"potes","kind":"friend_gain","slug":"carole","amount":50,"text":"Journée plage avec Karo ! Karo t’offre les glaces : Karo te donne 50 €."},
    "p24":{"deck":"potes","kind":"pay","amount":30,"text":"Rendez-vous chez le toiletteur pour Irubie avec Nini : paie 30 €."},
    "p19":{"deck":"potes","kind":"gain","amount":50,"text":"Tu as donné un coup de main à Dédé sur le chantier tout le week-end : touche 50 € (et un apéro bien mérité)."}
  }'::jsonb;
$$;

create or replace function public._tdp_cell(p_i integer)
returns jsonb language sql immutable
set search_path = public, extensions
as $$ select public._tdp_board()->p_i; $$;

create or replace function public._tdp_group_cells(p_group text)
returns integer[] language sql immutable
set search_path = public, extensions
as $$
  select coalesce(array_agg((c->>'i')::integer order by (c->>'i')::integer), '{}')
    from jsonb_array_elements(public._tdp_board()) as c
   where c->>'group' = p_group;
$$;

create or replace function public._tdp_level(p_s jsonb, p_cell integer)
returns integer language sql immutable
set search_path = public, extensions
as $$ select coalesce((p_s->'buildings'->>p_cell::text)::integer, 0); $$;

create or replace function public._tdp_owns_group(p_s jsonb, p_p text, p_group text)
returns boolean language sql immutable
set search_path = public, extensions
as $$
  select not exists (select 1 from unnest(public._tdp_group_cells(p_group)) as x
                      where p_s->'owners'->>x::text is distinct from p_p);
$$;

-- Loyer de la case p_cell (0 si libre). p_mode 'card' : maison des potes ×2,
-- service = dés ×10 (cartes « la plus proche »).
create or replace function public._tdp_rent(p_s jsonb, p_cell integer, p_dice integer, p_mode text)
returns integer language plpgsql immutable
set search_path = public, extensions
as $$
declare
  c   jsonb := public._tdp_cell(p_cell);
  o   text := p_s->'owners'->>p_cell::text;
  n   integer;
  lvl integer;
  r   integer;
begin
  if o is null then return 0; end if;
  if c->>'type' = 'quartier' then
    lvl := public._tdp_level(p_s, p_cell);
    if lvl > 0 then return (c->'rents'->>lvl)::integer; end if;
    r := (c->'rents'->>0)::integer;
    if public._tdp_owns_group(p_s, o, c->>'group') then r := r * 2; end if;
    return r;
  end if;
  select count(*)::integer into n
    from jsonb_each_text(p_s->'owners') as e(k, val)
   where val = o and public._tdp_cell(k::integer)->>'type' = c->>'type';
  if c->>'type' = 'potes' then
    r := 25 * (2 ^ (n - 1))::integer;
    if p_mode = 'card' then r := r * 2; end if;
    return r;
  end if;
  if c->>'type' = 'service' then
    if p_mode = 'card' or n >= 2 then return p_dice * 10; end if;
    return p_dice * 4;
  end if;
  return 0;
end $$;

create or replace function public._tdp_props_value(p_s jsonb, p_p text)
returns integer language sql immutable
set search_path = public, extensions
as $$
  select coalesce(sum((public._tdp_cell(k::integer)->>'price')::integer), 0)::integer
    from jsonb_each_text(p_s->'owners') as e(k, val) where val = p_p;
$$;

create or replace function public._tdp_build_value(p_s jsonb, p_p text)
returns integer language sql immutable
set search_path = public, extensions
as $$
  select coalesce(sum(public._tdp_level(p_s, k::integer)
                      * coalesce((public._tdp_cell(k::integer)->>'house')::integer, 0)), 0)::integer
    from jsonb_each_text(p_s->'owners') as e(k, val) where val = p_p;
$$;

-- Ce qu'un joueur peut récupérer en liquidant (bâtiments à moitié prix).
-- Point d'extension (hypothèques plus tard).
create or replace function public._tdp_sale_value(p_s jsonb, p_p text)
returns integer language sql immutable
set search_path = public, extensions
as $$
  select coalesce(sum(public._tdp_level(p_s, k::integer)
                      * (coalesce((public._tdp_cell(k::integer)->>'house')::integer, 0) / 2)), 0)::integer
    from jsonb_each_text(p_s->'owners') as e(k, val) where val = p_p;
$$;

create or replace function public._tdp_fortune(p_s jsonb, p_p text)
returns integer language sql immutable
set search_path = public, extensions
as $$
  select coalesce((p_s->'cash'->>p_p)::integer, 0)
         + public._tdp_props_value(p_s, p_p) + public._tdp_build_value(p_s, p_p);
$$;

-- Journal : ajoute l'évènement (numéroté) à log (40 derniers) et à events
-- (évènements produits par l'action en cours, 80 au plus).
create or replace function public._tdp_log(p_s jsonb, p_e jsonb)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  n  integer := coalesce((p_s->>'event_no')::integer, 0) + 1;
  e  jsonb := p_e || jsonb_build_object('no', n);
  lg jsonb := coalesce(p_s->'log', '[]'::jsonb) || jsonb_build_array(e);
  ev jsonb := coalesce(p_s->'events', '[]'::jsonb) || jsonb_build_array(e);
begin
  while jsonb_array_length(lg) > 40 loop lg := lg - 0; end loop;
  while jsonb_array_length(ev) > 80 loop ev := ev - 0; end loop;
  return p_s || jsonb_build_object('event_no', n, 'log', lg, 'events', ev);
end $$;

-- Complète last_event (évènement « case atteinte » affiché sur tous les écrans).
create or replace function public._tdp_le(p_s jsonb, p_patch jsonb)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select p_s || jsonb_build_object('last_event', coalesce(p_s->'last_event', '{}'::jsonb) || p_patch);
$$;

create or replace function public._tdp_stat(p_s jsonb, p_p text, p_key text, p_delta integer)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select jsonb_set(p_s, array['stats', p_p, p_key],
                   to_jsonb(coalesce((p_s->'stats'->p_p->>p_key)::integer, 0) + p_delta));
$$;

-- Mouvement d'argent (null = banque).
create or replace function public._tdp_transfer(p_s jsonb, p_from text, p_to text, p_amount integer)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
begin
  if coalesce(p_amount, 0) = 0 then return p_s; end if;
  if p_from is not null then
    p_s := jsonb_set(p_s, array['cash', p_from], to_jsonb((p_s->'cash'->>p_from)::integer - p_amount));
  end if;
  if p_to is not null then
    p_s := jsonb_set(p_s, array['cash', p_to], to_jsonb((p_s->'cash'->>p_to)::integer + p_amount));
  end if;
  return p_s;
end $$;

create or replace function public._tdp_deadline(p_s jsonb, p_grace integer)
returns jsonb language sql stable
set search_path = public, extensions
as $$
  select p_s || jsonb_build_object('deadline',
    case when coalesce((p_s->>'turn_seconds')::integer, 0) > 0
         then to_jsonb(public._tdp_iso(now() + make_interval(secs => (p_s->>'turn_seconds')::integer + p_grace)))
         else 'null'::jsonb end);
$$;

-- Deux dés (file forced_dice du server en test).
create or replace function public._tdp_roll(g jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v jsonb := g->'v';
  f jsonb := g->'v'->'forced_dice';
  a integer;
  b integer;
begin
  if jsonb_typeof(f) = 'array' and jsonb_array_length(f) > 0 then
    a := (f->0->>0)::integer;
    b := (f->0->>1)::integer;
    v := jsonb_set(v, '{forced_dice}', f - 0);
  else
    a := 1 + floor(random() * 6)::integer;
    b := 1 + floor(random() * 6)::integer;
  end if;
  return jsonb_build_object('s', jsonb_set(g->'s', '{dice}', jsonb_build_array(a, b)), 'v', v);
end $$;

-- Avance de p_steps (> 0) : +200 en passant / s'arrêtant sur le Départ.
create or replace function public._tdp_advance(p_s jsonb, p_p text, p_steps integer)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  a integer := (p_s->'pos'->>p_p)::integer;
begin
  p_s := jsonb_set(p_s, array['pos', p_p], to_jsonb((a + p_steps) % 40));
  if a + p_steps >= 40 then
    p_s := public._tdp_transfer(p_s, null, p_p, 200);
    p_s := public._tdp_log(p_s, jsonb_build_object('player', p_p, 'kind', 'pass_go', 'amount', 200));
    p_s := public._tdp_stat(p_s, p_p, 'laps', 1);
    if p_s->'last_event'->>'player' = p_p then
      p_s := public._tdp_le(p_s, jsonb_build_object('passed_go', true));
    end if;
  end if;
  return p_s;
end $$;

create or replace function public._tdp_to_jail(p_s jsonb, p_p text, p_reason text)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
begin
  p_s := jsonb_set(p_s, array['pos', p_p], '10'::jsonb);
  p_s := jsonb_set(p_s, array['jail', p_p], '0'::jsonb);
  if p_s->>'turn' = p_p then p_s := p_s || jsonb_build_object('doubles', 0); end if;
  p_s := public._tdp_log(p_s, jsonb_build_object('player', p_p, 'kind', 'jail', 'reason', p_reason, 'cell', 10));
  p_s := public._tdp_stat(p_s, p_p, 'jail', 1);
  return public._tdp_le(p_s, jsonb_build_object('jail', p_reason, 'cell', 10));
end $$;

-- Loyer payé : ajouté à round_rents (tour de table en cours ; no = dernier
-- event_no, celui du log rent qui vient d'être écrit ; 60 entrées au plus).
create or replace function public._tdp_add_rent(p_s jsonb, p_payer text, p_owner text, p_cell integer, p_amount integer)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  rnd integer := coalesce((p_s->>'round')::integer, 1);
  pay jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_s->'round_rents') = 'object'
     and (p_s->'round_rents'->>'round')::integer = rnd
     and jsonb_typeof(p_s->'round_rents'->'payments') = 'array' then
    pay := p_s->'round_rents'->'payments';
  end if;
  pay := pay || jsonb_build_array(jsonb_build_object(
    'no', (p_s->>'event_no')::integer, 'payer', p_payer, 'owner', p_owner,
    'cell', p_cell, 'amount', p_amount));
  while jsonb_array_length(pay) > 60 loop pay := pay - 0; end loop;
  return p_s || jsonb_build_object('round_rents', jsonb_build_object('round', rnd, 'payments', pay));
end $$;

-- Résolution de la case où se trouve p_p. g = {s: state, v: server}.
-- p_depth = 0 : case atteinte par les dés (case carte -> phase card) ;
-- > 0 : déplacement par carte (case carte -> pioche immédiate, jusqu'à 4).
create or replace function public._tdp_land(g jsonb, p_p text, p_depth integer, p_mode text)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  s   jsonb := g->'s';
  v   jsonb := g->'v';
  i   integer := (g->'s'->'pos'->>p_p)::integer;
  c   jsonb := public._tdp_cell((g->'s'->'pos'->>p_p)::integer);
  t   text;
  o   text;
  amt integer;
  ds  integer;
begin
  t := c->>'type';
  s := public._tdp_le(s, jsonb_build_object('cell', i));
  if t in ('quartier', 'potes', 'service') then
    o := s->'owners'->>i::text;
    if o is null then
      s := s || jsonb_build_object('phase', 'buy',
                                   'pending', jsonb_build_object('cell', i, 'price', (c->>'price')::integer));
    elsif o <> p_p then
      ds := coalesce((s->'dice'->>0)::integer + (s->'dice'->>1)::integer, 7);
      amt := public._tdp_rent(s, i, ds, p_mode);
      s := public._tdp_transfer(s, p_p, o, amt);
      s := public._tdp_log(s, jsonb_build_object('player', p_p, 'kind', 'rent', 'cell', i, 'amount', amt, 'to', o));
      s := public._tdp_add_rent(s, p_p, o, i, amt);
      s := public._tdp_stat(s, p_p, 'rent_paid', amt);
      s := public._tdp_stat(s, o, 'rent_received', amt);
      s := public._tdp_le(s, jsonb_build_object('rent', jsonb_build_object('to', o, 'amount', amt)));
    end if;
  elsif t = 'taxe' then
    amt := (c->>'amount')::integer;
    s := public._tdp_transfer(s, p_p, null, amt);
    s := public._tdp_log(s, jsonb_build_object('player', p_p, 'kind', 'tax', 'cell', i, 'amount', amt));
    s := s || jsonb_build_object('tax_pot', coalesce((s->>'tax_pot')::integer, 0) + amt);
    s := public._tdp_le(s, jsonb_build_object('tax', amt));
  elsif t in ('hasard', 'entre_potes') then
    if p_depth = 0 then
      -- Atteinte directement par les dés : le joueur piochera lui-même (draw).
      s := s || jsonb_build_object('phase', 'card',
                                   'pending', jsonb_build_object('cell', i,
                                     'deck', case t when 'hasard' then 'hasard' else 'potes' end));
    elsif p_depth < 4 then
      return public._tdp_card(jsonb_build_object('s', s, 'v', v), p_p,
                              case t when 'hasard' then 'hasard' else 'potes' end, p_depth);
    end if;
  elsif t = 'apero' then
    -- Pause apéro : le joueur ramasse toute la cagnotte des taxes.
    amt := coalesce((s->>'tax_pot')::integer, 0);
    if amt > 0 then
      s := public._tdp_transfer(s, null, p_p, amt);
      s := public._tdp_log(s, jsonb_build_object('player', p_p, 'kind', 'pot', 'cell', i, 'amount', amt));
      s := public._tdp_stat(s, p_p, 'pot', amt);
      s := s || jsonb_build_object('tax_pot', 0);
      s := public._tdp_le(s, jsonb_build_object('pot', amt));
    end if;
  elsif t = 'direction_violon' then
    s := public._tdp_to_jail(s, p_p, 'case');
  end if;
  return jsonb_build_object('s', s, 'v', v);
end $$;

-- Pioche et applique une carte.
create or replace function public._tdp_card(g jsonb, p_p text, p_deck text, p_depth integer)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  s        jsonb := g->'s';
  v        jsonb := g->'v';
  deck     jsonb := coalesce(g->'v'->'decks'->p_deck, '[]'::jsonb);
  id       text;
  c        jsonb;
  k        text;
  pos      integer := (g->'s'->'pos'->>p_p)::integer;
  target   integer;
  q        text;
  amt      integer := null;
  n_house  integer;
  n_hotel  integer;
  cnt      integer;
begin
  if jsonb_array_length(deck) = 0 then return g; end if;
  id := deck->>0;
  deck := deck - 0;
  c := public._tdp_cards()->id;
  k := c->>'kind';
  if k = 'jail_card' then
    s := jsonb_set(s, array['jail_cards', p_p], coalesce(s->'jail_cards'->p_p, '[]'::jsonb) || to_jsonb(id));
  else
    deck := deck || to_jsonb(id);
  end if;
  v := jsonb_set(v, array['decks', p_deck], deck);

  -- Montant calculé (pour l'affichage).
  if k in ('gain', 'pay', 'friend_gain', 'friend_pay') then
    amt := (c->>'amount')::integer;
  elsif k in ('collect_each', 'pay_each') then
    select count(*)::integer into cnt from jsonb_array_elements_text(s->'alive') as x where x <> p_p;
    amt := (c->>'amount')::integer * cnt;
  elsif k = 'repairs' then
    select coalesce(sum(case when public._tdp_level(s, key::integer) between 1 and 4
                             then public._tdp_level(s, key::integer) else 0 end), 0)::integer,
           (count(*) filter (where public._tdp_level(s, key::integer) = 5))::integer
      into n_house, n_hotel
      from jsonb_each_text(s->'owners') where value = p_p;
    amt := n_house * (c->>'house')::integer + n_hotel * (c->>'hotel')::integer;
  end if;

  s := public._tdp_log(s, jsonb_build_object('player', p_p, 'kind', 'card', 'deck', p_deck, 'card', id,
                                             'text', c->>'text', 'card_kind', k, 'amount', amt));
  s := public._tdp_stat(s, p_p, 'cards', 1);
  s := public._tdp_le(s, jsonb_build_object('card', jsonb_build_object('deck', p_deck, 'id', id, 'text', c->>'text',
                                                                      'kind', k, 'amount', amt)));

  if k = 'move_to' then
    target := (c->>'cell')::integer;
    s := public._tdp_log(s, jsonb_build_object('player', p_p, 'kind', 'move', 'from', pos, 'cell', target));
    s := public._tdp_advance(s, p_p, (target - pos + 40) % 40);
    return public._tdp_land(jsonb_build_object('s', s, 'v', v), p_p, p_depth + 1, 'normal');
  elsif k = 'move_by' then
    target := (pos + (c->>'steps')::integer + 40) % 40;
    if (c->>'steps')::integer > 0 then
      s := public._tdp_advance(s, p_p, (c->>'steps')::integer); -- en avant : +200 si on passe le Départ
    else
      s := jsonb_set(s, array['pos', p_p], to_jsonb(target));
    end if;
    s := public._tdp_log(s, jsonb_build_object('player', p_p, 'kind', 'move', 'from', pos, 'cell', target));
    return public._tdp_land(jsonb_build_object('s', s, 'v', v), p_p, p_depth + 1, 'normal');
  elsif k = 'nearest' then
    select coalesce(
             (select (x->>'i')::integer from jsonb_array_elements(public._tdp_board()) as x
               where x->>'type' = c->>'target' and (x->>'i')::integer > pos order by (x->>'i')::integer limit 1),
             (select (x->>'i')::integer from jsonb_array_elements(public._tdp_board()) as x
               where x->>'type' = c->>'target' order by (x->>'i')::integer limit 1))
      into target;
    s := public._tdp_log(s, jsonb_build_object('player', p_p, 'kind', 'move', 'from', pos, 'cell', target));
    s := public._tdp_advance(s, p_p, (target - pos + 40) % 40);
    return public._tdp_land(jsonb_build_object('s', s, 'v', v), p_p, p_depth + 1, 'card');
  elsif k = 'jail' then
    s := public._tdp_to_jail(s, p_p, 'card');
  elsif k = 'gain' then
    s := public._tdp_transfer(s, null, p_p, amt);
  elsif k in ('pay', 'repairs') then
    s := public._tdp_transfer(s, p_p, null, amt);
  elsif k = 'collect_each' then
    for q in select jsonb_array_elements_text(s->'alive') loop
      if q <> p_p then s := public._tdp_transfer(s, q, p_p, (c->>'amount')::integer); end if;
    end loop;
  elsif k = 'pay_each' then
    for q in select jsonb_array_elements_text(s->'alive') loop
      if q <> p_p then s := public._tdp_transfer(s, p_p, q, (c->>'amount')::integer); end if;
    end loop;
  elsif k in ('friend_gain', 'friend_pay') then
    -- Carte perso : l'argent passe par le pote nommé s'il joue encore (et n'est pas
    -- celui qui pioche) ; sinon c'est la banque qui paie / encaisse.
    select a into q
      from jsonb_array_elements_text(s->'alive') as a
      join public.profiles pr on pr.id::text = a
     where pr.slug = c->>'slug' and a <> p_p
     limit 1;
    if k = 'friend_gain' then
      s := public._tdp_transfer(s, q, p_p, amt);
    else
      s := public._tdp_transfer(s, p_p, q, amt);
    end if;
  end if;
  return jsonb_build_object('s', s, 'v', v);
end $$;

-- Vente automatique de bâtiments (du plus haut niveau, puis du plus cher)
-- jusqu'à ce que l'argent soit >= 0 ou qu'il n'y ait plus rien à vendre.
create or replace function public._tdp_liquidate(p_s jsonb, p_p text)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  cell integer;
  lvl  integer;
  half integer;
  i    integer;
begin
  for i in 1 .. 200 loop
    exit when (p_s->'cash'->>p_p)::integer >= 0;
    select key::integer into cell
      from jsonb_each_text(p_s->'owners')
     where value = p_p and public._tdp_level(p_s, key::integer) > 0
     order by public._tdp_level(p_s, key::integer) desc,
              (public._tdp_cell(key::integer)->>'house')::integer desc, key::integer desc
     limit 1;
    exit when cell is null;
    lvl := public._tdp_level(p_s, cell) - 1;
    half := (public._tdp_cell(cell)->>'house')::integer / 2;
    if lvl = 0 then
      p_s := jsonb_set(p_s, '{buildings}', (p_s->'buildings') - cell::text);
    else
      p_s := jsonb_set(p_s, array['buildings', cell::text], to_jsonb(lvl));
    end if;
    p_s := public._tdp_transfer(p_s, null, p_p, half);
    p_s := public._tdp_log(p_s, jsonb_build_object('player', p_p, 'kind', 'sell', 'cell', cell, 'level', lvl,
                                                   'amount', half, 'auto', true));
  end loop;
  return p_s;
end $$;

-- Stats de fin de partie pour les trophées (features/trophees.sql), lues dans state.stats / owners / buildings.
-- p_other_max = fortune du meilleur autre joueur (0 pour un failli) ; p_n = nombre de joueurs.
create or replace function public._tdp_tstats(s jsonb, p_p text, p_bk boolean, p_rk integer, p_f integer, p_other_max integer, p_n integer)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'jail', coalesce((s->'stats'->p_p->>'jail')::integer, 0),
    'bankrupt', case when p_bk then 1 else 0 end,
    'rent_paid', coalesce((s->'stats'->p_p->>'rent_paid')::integer, 0),
    'rent_received', coalesce((s->'stats'->p_p->>'rent_received')::integer, 0),
    'bought', coalesce((s->'stats'->p_p->>'bought')::integer, 0),
    'laps', coalesce((s->'stats'->p_p->>'laps')::integer, 0),
    'pot', coalesce((s->'stats'->p_p->>'pot')::integer, 0),
    'cards', coalesce((s->'stats'->p_p->>'cards')::integer, 0),
    'hotel', case when not p_bk and exists (select 1 from jsonb_each_text(coalesce(s->'owners', '{}'::jsonb)) e
                       where e.value = p_p and public._tdp_level(s, e.key::integer) >= 5) then 1 else 0 end,
    'monopoly', case when not p_bk and (select count(distinct c->>'group') from jsonb_array_elements(public._tdp_board()) c
                       where c->>'type' = 'quartier' and public._tdp_owns_group(s, p_p, c->>'group')) >= 2 then 1 else 0 end,
    'tycoon', case when p_rk = 1 and p_n >= 3 and p_f > 0 and p_f >= 2 * greatest(coalesce(p_other_max, 0), 0) then 1 else 0 end)
$$;

-- Fin de partie : classement par fortune (en lice), puis faillis (le dernier
-- failli d'abord). Égalité de fortune = même rang (partagé).
create or replace function public._tdp_finish(g jsonb, p_reason text)
returns jsonb language plpgsql stable
set search_path = public, extensions
as $$
declare
  s       jsonb := g->'s';
  n       integer := jsonb_array_length(g->'s'->'players');
  nalive  integer := jsonb_array_length(g->'s'->'alive');
  nbk     integer := jsonb_array_length(coalesce(g->'s'->'bankrupt', '[]'::jsonb));
  ranking jsonb;
  results jsonb;
  winners jsonb;
begin
  with a as (
    select x as p, public._tdp_fortune(s, x) as f, o::integer as o
      from jsonb_array_elements_text(s->'alive') with ordinality as t(x, o)
  ), r as (
    select a.p, a.f, a.o, 1 + (select count(*) from a a2 where a2.f > a.f)::integer as rk, false as bk from a
    union all
    select x, 0, 1000 + o::integer, nalive + (nbk - o::integer + 1), true
      from jsonb_array_elements_text(coalesce(s->'bankrupt', '[]'::jsonb)) with ordinality as t(x, o)
  )
  select jsonb_agg(jsonb_build_object(
           'player', r.p, 'rank', r.rk, 'fortune', r.f,
           'cash', case when r.bk then 0 else (s->'cash'->>r.p)::integer end,
           'properties', public._tdp_props_value(s, r.p), 'buildings', public._tdp_build_value(s, r.p),
           'owned', (select count(*) from jsonb_each_text(s->'owners') e where e.value = r.p),
           'bankrupt', r.bk) order by r.rk, r.o),
         jsonb_agg(jsonb_build_object('profile_id', r.p, 'placement', r.rk, 'points', n - r.rk + 1,
                                      'won', r.rk = 1,
                                      'stats', public._tdp_tstats(s, r.p, r.bk, r.rk, r.f,
                                                 (select max(r2.f) from r r2 where r2.p <> r.p), n)) order by r.rk, r.o),
         coalesce(jsonb_agg(r.p order by r.o) filter (where r.rk = 1), '[]'::jsonb)
    into ranking, results, winners
    from r;
  s := public._tdp_log(s, jsonb_build_object('player', null, 'kind', 'finish', 'reason', p_reason));
  s := s || jsonb_build_object(
    'phase', 'finished',
    'deadline', null,
    'pending', null,
    'end_reason', p_reason,
    'winners', winners,
    'ranking', ranking,
    'results', results);
  return jsonb_build_object('s', s, 'v', g->'v');
end $$;

-- Faillite de p_p : biens à la banque, cartes rendues, spectateur.
create or replace function public._tdp_bankrupt(g jsonb, p_p text)
returns jsonb language plpgsql stable
set search_path = public, extensions
as $$
declare
  s  jsonb := g->'s';
  v  jsonb := g->'v';
  ow jsonb;
  bd jsonb;
  id text;
  dk text;
begin
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into bd
    from jsonb_each(coalesce(s->'buildings', '{}'::jsonb))
   where s->'owners'->>key is distinct from p_p;
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into ow
    from jsonb_each(coalesce(s->'owners', '{}'::jsonb))
   where value #>> '{}' <> p_p;
  for id in select jsonb_array_elements_text(coalesce(s->'jail_cards'->p_p, '[]'::jsonb)) loop
    dk := case when id like 'h%' then 'hasard' else 'potes' end;
    v := jsonb_set(v, array['decks', dk], coalesce(v->'decks'->dk, '[]'::jsonb) || to_jsonb(id));
  end loop;
  s := public._tdp_log(s, jsonb_build_object('player', p_p, 'kind', 'bankrupt',
                                             'amount', (s->'cash'->>p_p)::integer));
  s := s || jsonb_build_object(
    'owners', ow,
    'buildings', bd,
    'alive', (s->'alive') - p_p,
    'bankrupt', coalesce(s->'bankrupt', '[]'::jsonb) || to_jsonb(p_p),
    'jail', coalesce(s->'jail', '{}'::jsonb) - p_p,
    'jail_cards', coalesce(s->'jail_cards', '{}'::jsonb) - p_p,
    'away', coalesce(s->'away', '[]'::jsonb) - p_p);
  s := jsonb_set(s, array['cash', p_p], '0'::jsonb);
  g := jsonb_build_object('s', s, 'v', v);
  if jsonb_array_length(s->'alive') <= 1 then
    g := public._tdp_finish(g, 'last_standing');
  end if;
  return g;
end $$;

-- Tour suivant (ou fin de partie : tours atteints / échéance chrono / filet 3 h).
create or replace function public._tdp_next_turn(g jsonb)
returns jsonb language plpgsql stable
set search_path = public, extensions
as $$
declare
  s    jsonb := g->'s';
  ord  text[] := array(select jsonb_array_elements_text(g->'s'->'order'));
  n    integer;
  cur  integer;
  idx  integer;
  nxt  text := null;
  rnd  integer := coalesce((g->'s'->>'round')::integer, 1);
  i    integer;
begin
  if s->>'phase' = 'finished' then return g; end if;
  n := cardinality(ord);
  cur := coalesce(array_position(ord, s->>'turn'), 1);
  idx := cur;
  for i in 1 .. n loop
    idx := idx % n + 1;
    if (s->'alive') ? ord[idx] then nxt := ord[idx]; exit; end if;
  end loop;
  if nxt is null then return public._tdp_finish(g, 'last_standing'); end if;
  if idx <= cur then rnd := rnd + 1; end if;

  if s->>'format' = 'tours' and rnd > (s->>'total_rounds')::integer then
    return public._tdp_finish(g, 'rounds');
  end if;
  if s->>'ends_at' is not null and now() >= (s->>'ends_at')::timestamptz then
    return public._tdp_finish(g, case when s->>'format' = 'chrono' then 'time' else 'safety' end);
  end if;

  s := s || jsonb_build_object(
    'round', rnd,
    'round_rents', case when coalesce((s->'round_rents'->>'round')::integer, -1) = rnd
                       and jsonb_typeof(s->'round_rents'->'payments') = 'array'
                       then s->'round_rents'
                       else jsonb_build_object('round', rnd, 'payments', '[]'::jsonb) end,
    'turn', nxt,
    'turn_no', coalesce((s->>'turn_no')::integer, 0) + 1,
    'doubles', 0,
    'pending', null,
    'phase', case when coalesce(s->'jail', '{}'::jsonb) ? nxt then 'jail' else 'roll' end);
  s := public._tdp_log(s, jsonb_build_object('player', nxt, 'kind', 'turn', 'round', rnd,
                                             'turn_no', (s->>'turn_no')::integer));
  s := public._tdp_deadline(s, 0);
  return jsonb_build_object('s', s, 'v', g->'v');
end $$;

-- Après une résolution (lancer, pioche, achat, vente en dette…) : dettes des
-- autres joueurs (vente auto / faillite), puis phase du joueur au trait
-- (buy / card conservées, sinon roll après un double, sinon manage).
create or replace function public._tdp_settle(g jsonb)
returns jsonb language plpgsql stable
set search_path = public, extensions
as $$
declare
  s jsonb;
  t text;
  q text;
begin
  for q in select jsonb_array_elements_text(g->'s'->'alive') loop
    exit when g->'s'->>'phase' = 'finished';
    if q is distinct from g->'s'->>'turn' and (g->'s'->'cash'->>q)::integer < 0 then
      g := jsonb_set(g, '{s}', public._tdp_liquidate(g->'s', q));
      if (g->'s'->'cash'->>q)::integer < 0 then g := public._tdp_bankrupt(g, q); end if;
    end if;
  end loop;
  s := g->'s';
  if s->>'phase' = 'finished' then return g; end if;
  t := s->>'turn';

  if (s->'cash'->>t)::integer < 0 then
    if s->>'phase' = 'buy' then
      s := public._tdp_log(s, jsonb_build_object('player', t, 'kind', 'pass_buy',
                                                 'cell', (s->'pending'->>'cell')::integer));
      s := s || jsonb_build_object('pending', null);
    elsif s->>'phase' = 'card' then
      s := s || jsonb_build_object('pending', null);  -- (ne devrait pas arriver) pas de pioche endetté
    end if;
    if (s->'cash'->>t)::integer + public._tdp_sale_value(s, t) < 0 then
      g := public._tdp_bankrupt(jsonb_build_object('s', s, 'v', g->'v'), t);
      return public._tdp_next_turn(g);
    end if;
    s := s || jsonb_build_object('phase', 'debt');
    s := public._tdp_log(s, jsonb_build_object('player', t, 'kind', 'debt',
                                               'amount', -(s->'cash'->>t)::integer));
  elsif s->>'phase' not in ('buy', 'card') then
    s := s || jsonb_build_object('phase',
      case when coalesce((s->>'doubles')::integer, 0) > 0 and not (coalesce(s->'jail', '{}'::jsonb) ? t)
           then 'roll' else 'manage' end);
  end if;
  s := public._tdp_deadline(s, 0);
  return jsonb_build_object('s', s, 'v', g->'v');
end $$;

-- Nouveau last_event (lancer de dés du joueur au trait).
create or replace function public._tdp_new_event(p_s jsonb, p_t text, p_from integer)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select p_s || jsonb_build_object('last_event', jsonb_build_object(
    'no', (p_s->>'event_no')::integer, 'turn_no', (p_s->>'turn_no')::integer, 'player', p_t,
    'dice', p_s->'dice', 'double', (p_s->'dice'->>0) = (p_s->'dice'->>1),
    'from', p_from, 'cell', p_from, 'passed_go', false, 'rent', null, 'tax', null, 'card', null,
    'bought', false, 'jail', null));
$$;

-- Lancer normal (phase roll).
create or replace function public._tdp_do_roll(g jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  t     text := g->'s'->>'turn';
  s     jsonb;
  a     integer;
  b     integer;
  v_from integer;
  dbl   integer;
begin
  g := public._tdp_roll(g);
  s := g->'s';
  a := (s->'dice'->>0)::integer;
  b := (s->'dice'->>1)::integer;
  v_from := (s->'pos'->>t)::integer;
  dbl := case when a = b then coalesce((s->>'doubles')::integer, 0) + 1 else 0 end;
  s := s || jsonb_build_object('doubles', dbl);
  s := public._tdp_log(s, jsonb_build_object('player', t, 'kind', 'roll', 'dice', s->'dice', 'from', v_from,
                                             'cell', case when dbl >= 3 then 10 else (v_from + a + b) % 40 end,
                                             'double', a = b, 'doubles', dbl));
  s := public._tdp_new_event(s, t, v_from);
  if dbl >= 3 then
    s := public._tdp_to_jail(s, t, 'triple');
    return public._tdp_settle(jsonb_build_object('s', s, 'v', g->'v'));
  end if;
  s := public._tdp_advance(s, t, a + b);
  g := public._tdp_land(jsonb_build_object('s', s, 'v', g->'v'), t, 0, 'normal');
  return public._tdp_settle(g);
end $$;

-- Lancer au violon (phase jail) : tenter un double.
create or replace function public._tdp_jail_roll(g jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  t   text := g->'s'->>'turn';
  s   jsonb;
  a   integer;
  b   integer;
  att integer;
begin
  g := public._tdp_roll(g);
  s := g->'s';
  a := (s->'dice'->>0)::integer;
  b := (s->'dice'->>1)::integer;
  att := coalesce((s->'jail'->>t)::integer, 0) + 1;
  s := s || jsonb_build_object('doubles', 0);
  s := public._tdp_log(s, jsonb_build_object('player', t, 'kind', 'roll', 'dice', s->'dice', 'from', 10,
                                             'cell', case when a = b or att >= 3 then (10 + a + b) % 40 else 10 end,
                                             'double', a = b, 'jail_attempt', att));
  s := public._tdp_new_event(s, t, 10);
  if a = b or att >= 3 then
    if a <> b then
      s := public._tdp_transfer(s, t, null, 50);
      s := public._tdp_log(s, jsonb_build_object('player', t, 'kind', 'jail_out', 'how', 'forced', 'amount', 50));
      s := public._tdp_le(s, jsonb_build_object('jail', 'out_forced'));
    else
      s := public._tdp_log(s, jsonb_build_object('player', t, 'kind', 'jail_out', 'how', 'double'));
      s := public._tdp_le(s, jsonb_build_object('jail', 'out_double'));
    end if;
    s := s || jsonb_build_object('jail', (s->'jail') - t);
    s := public._tdp_advance(s, t, a + b);
    g := public._tdp_land(jsonb_build_object('s', s, 'v', g->'v'), t, 0, 'normal');
    return public._tdp_settle(g);
  end if;
  s := jsonb_set(s, array['jail', t], to_jsonb(att));
  s := public._tdp_log(s, jsonb_build_object('player', t, 'kind', 'jail_stay', 'jail_attempt', att));
  s := public._tdp_le(s, jsonb_build_object('jail', 'stay'));
  return public._tdp_settle(jsonb_build_object('s', s, 'v', g->'v'));
end $$;

-- Achat (ou refus) de la case proposée (phase buy).
create or replace function public._tdp_decide_buy(g jsonb, p_buy boolean)
returns jsonb language plpgsql stable
set search_path = public, extensions
as $$
declare
  s     jsonb := g->'s';
  t     text := g->'s'->>'turn';
  cell  integer := (g->'s'->'pending'->>'cell')::integer;
  price integer := (g->'s'->'pending'->>'price')::integer;
begin
  if p_buy then
    if (s->'cash'->>t)::integer < price then raise exception 'not_enough_cash'; end if;
    s := public._tdp_transfer(s, t, null, price);
    s := jsonb_set(s, array['owners', cell::text], to_jsonb(t));
    s := public._tdp_log(s, jsonb_build_object('player', t, 'kind', 'buy', 'cell', cell, 'amount', price));
    s := public._tdp_stat(s, t, 'bought', 1);
    if (s->'last_event'->>'player') = t and (s->'last_event'->>'cell')::integer = cell then
      s := public._tdp_le(s, jsonb_build_object('bought', true));
    end if;
  else
    s := public._tdp_log(s, jsonb_build_object('player', t, 'kind', 'pass_buy', 'cell', cell));
  end if;
  s := s || jsonb_build_object('phase', 'resolved', 'pending', null);
  return public._tdp_settle(jsonb_build_object('s', s, 'v', g->'v'));
end $$;

-- Pioche de la carte en attente (phase card) puis suite du tour.
create or replace function public._tdp_draw(g jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  t    text := g->'s'->>'turn';
  deck text := g->'s'->'pending'->>'deck';
begin
  g := jsonb_set(g, '{s}', (g->'s') || jsonb_build_object('phase', 'resolved', 'pending', null));
  if deck in ('hasard', 'potes') then
    g := public._tdp_card(g, t, deck, 0);
  end if;
  return public._tdp_settle(g);
end $$;

-- Une décision automatique pour le joueur au trait (minuteur / absent).
create or replace function public._tdp_auto_step(g jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  ph text := g->'s'->>'phase';
  t  text := g->'s'->>'turn';
begin
  g := jsonb_set(g, '{s}', public._tdp_log(g->'s', jsonb_build_object('player', t, 'kind', 'auto', 'phase', ph)));
  if ph = 'roll' then
    return public._tdp_do_roll(g);
  elsif ph = 'jail' then
    return public._tdp_jail_roll(g);
  elsif ph = 'card' then
    return public._tdp_draw(g);
  elsif ph = 'buy' then
    return public._tdp_decide_buy(g, false);
  elsif ph = 'manage' then
    return public._tdp_next_turn(g);
  elsif ph = 'debt' then
    g := jsonb_set(g, '{s}', public._tdp_liquidate(g->'s', t));
    return public._tdp_settle(g);
  end if;
  return g;
end $$;

-- Joue automatiquement tout le tour du joueur au trait.
create or replace function public._tdp_auto_turn(g jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  tn integer := (g->'s'->>'turn_no')::integer;
  i  integer;
begin
  for i in 1 .. 40 loop
    exit when g->'s'->>'phase' = 'finished' or (g->'s'->>'turn_no')::integer <> tn;
    g := public._tdp_auto_step(g);
  end loop;
  return g;
end $$;

-- Joueurs absents (away) : leurs tours sont joués d'office (au plus un tour de table par appel).
create or replace function public._tdp_run_away(g jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  i integer;
  n integer := jsonb_array_length(g->'s'->'players');
begin
  for i in 1 .. n loop
    exit when g->'s'->>'phase' = 'finished'
           or not (coalesce(g->'s'->'away', '[]'::jsonb) ? (g->'s'->>'turn'));
    g := public._tdp_auto_turn(g);
  end loop;
  return g;
end $$;

-- -----------------------------------------------------------------------------
-- Démarrage. Options : {"format": "chrono"|"tours"|"classique" (défaut chrono),
--   "minutes": 30|45|60 (chrono, défaut 45), "rounds": 10|15|20 (tours, défaut 15),
--   "turn_seconds": 0|30|45|60|90 (défaut 45 ; 0 = sans minuteur)}
-- -----------------------------------------------------------------------------
create or replace function public.game_tour_des_potes_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_n      integer := cardinality(p_players);
  v_opts   jsonb := coalesce(p_options, '{}'::jsonb);
  v_format text;
  v_min    integer;
  v_rounds integer;
  v_secs   integer;
  v_order  text[];
  v_cash   jsonb := '{}'::jsonb;
  v_pos    jsonb := '{}'::jsonb;
  v_stats  jsonb := '{}'::jsonb;
  v_state  jsonb;
  v_server jsonb;
  p        text;
begin
  if v_n < 2 then raise exception 'not_enough_players'; end if;
  if v_n > 9 then raise exception 'too_many_players'; end if;
  v_format := case when v_opts->>'format' in ('chrono', 'tours', 'classique') then v_opts->>'format' else 'chrono' end;
  v_min := case when coalesce(v_opts->>'minutes', '') in ('30', '45', '60') then (v_opts->>'minutes')::integer else 45 end;
  v_rounds := case when coalesce(v_opts->>'rounds', '') in ('10', '15', '20') then (v_opts->>'rounds')::integer else 15 end;
  v_secs := case when coalesce(v_opts->>'turn_seconds', '') in ('0', '30', '45', '60', '90')
                 then (v_opts->>'turn_seconds')::integer else 45 end;
  v_order := array(select x::text from unnest(p_players) as t(x) order by random());
  foreach p in array v_order loop
    v_cash := v_cash || jsonb_build_object(p, 1500);
    v_pos := v_pos || jsonb_build_object(p, 0);
    v_stats := v_stats || jsonb_build_object(p, jsonb_build_object(
      'laps', 0, 'rent_paid', 0, 'rent_received', 0, 'bought', 0, 'built', 0, 'jail', 0, 'cards', 0));
  end loop;

  v_server := jsonb_build_object('decks', jsonb_build_object(
    'hasard', (select jsonb_agg(k order by random()) from jsonb_object_keys(public._tdp_cards()) as k where k like 'h%'),
    'potes',  (select jsonb_agg(k order by random()) from jsonb_object_keys(public._tdp_cards()) as k where k like 'p%')));

  v_state := jsonb_build_object(
    'game', 'tour-des-potes',
    'phase', 'roll',
    'players', to_jsonb(p_players),
    'order', to_jsonb(v_order),
    'alive', to_jsonb(v_order),
    'bankrupt', '[]'::jsonb,
    'format', v_format,
    'minutes', case when v_format = 'chrono' then v_min end,
    'total_rounds', case when v_format = 'tours' then v_rounds end,
    'started_at', public._tdp_iso(now()),
    'ends_at', case v_format when 'chrono' then public._tdp_iso(now() + make_interval(mins => v_min))
                             when 'classique' then public._tdp_iso(now() + interval '3 hours') end,
    'last_turn', false,
    'turn_seconds', v_secs,
    'round', 1,
    'turn_no', 1,
    'turn', v_order[1],
    'doubles', 0,
    'dice', null,
    'cash', v_cash,
    'pos', v_pos,
    'owners', '{}'::jsonb,
    'buildings', '{}'::jsonb,
    'jail', '{}'::jsonb,
    'jail_cards', '{}'::jsonb,
    'away', '[]'::jsonb,
    'pending', null,
    'last_event', null,
    'events', '[]'::jsonb,
    'log', '[]'::jsonb,
    'event_no', 0,
    'stats', v_stats,
    'tax_pot', 0,
    'round_rents', jsonb_build_object('round', 1, 'payments', '[]'::jsonb),
    'deadline', null,
    'end_reason', null,
    'winners', null,
    'ranking', null,
    'results', null);
  v_state := public._tdp_log(v_state, jsonb_build_object('player', v_order[1], 'kind', 'turn', 'round', 1, 'turn_no', 1));
  -- 10 s de grâce au premier tour (le temps que tout le monde arrive).
  v_state := public._tdp_deadline(v_state, 10);
  return jsonb_build_object('state', v_state, 'server', v_server);
end $$;

-- -----------------------------------------------------------------------------
-- Actions (joueur au trait) : roll | pay_jail | use_card | draw | buy | pass |
--   build {cell} | sell {cell} | end_turn.  Tous : tick.  Hôte : skip.
--   Joueur absent : back.  (abort : moteur.)
-- -----------------------------------------------------------------------------
create or replace function public.game_tour_des_potes_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_type  text := p_action->>'type';
  v_me    text := p_actor::text;
  v_phase text := p_state->>'phase';
  s       jsonb;
  g       jsonb;
  t       text := p_state->>'turn';
  v_cell  integer;
  v_card  text;
  v_deck  text;
  c       jsonb;
  v_grp   integer[];
  lvl     integer;
  x       integer;
begin
  if v_phase is null or v_phase not in ('roll', 'jail', 'card', 'buy', 'manage', 'debt') then raise exception 'wrong_phase'; end if;

  if v_type = 'tick' then
    if p_state->>'deadline' is null or now() < (p_state->>'deadline')::timestamptz then
      return jsonb_build_object('state', p_state, 'server', p_server);  -- trop tôt / déjà traité
    end if;
  elsif v_type = 'skip' then
    if not p_is_host then raise exception 'not_host'; end if;
  elsif v_type = 'back' then
    if not ((p_state->'players') ? v_me) then raise exception 'not_a_player'; end if;
  elsif v_type in ('roll', 'pay_jail', 'use_card', 'draw', 'buy', 'pass', 'build', 'sell', 'end_turn') then
    if not ((p_state->'players') ? v_me) then raise exception 'not_a_player'; end if;
    if not ((p_state->'alive') ? v_me) then raise exception 'not_alive'; end if;
    if t is distinct from v_me then raise exception 'not_your_turn'; end if;
  else
    raise exception 'unknown_action';
  end if;

  s := p_state || jsonb_build_object('events', '[]'::jsonb);
  if s->>'ends_at' is not null and now() >= (s->>'ends_at')::timestamptz then
    s := s || jsonb_build_object('last_turn', true);
  end if;
  -- Un joueur qui agit lui-même n'est plus absent.
  if v_type not in ('tick', 'skip') and coalesce(s->'away', '[]'::jsonb) ? v_me then
    s := s || jsonb_build_object('away', (s->'away') - v_me);
    s := public._tdp_log(s, jsonb_build_object('player', v_me, 'kind', 'back'));
  end if;
  g := jsonb_build_object('s', s, 'v', coalesce(p_server, '{}'::jsonb));

  if v_type = 'tick' then
    g := public._tdp_auto_step(g);

  elsif v_type = 'skip' then
    if not (coalesce(s->'away', '[]'::jsonb) ? t) then
      s := s || jsonb_build_object('away', coalesce(s->'away', '[]'::jsonb) || to_jsonb(t));
      s := public._tdp_log(s, jsonb_build_object('player', t, 'kind', 'away'));
      g := jsonb_set(g, '{s}', s);
    end if;
    g := public._tdp_auto_turn(g);

  elsif v_type = 'back' then
    null;  -- traité ci-dessus (sans effet si le joueur n'était pas absent)

  elsif v_type = 'roll' then
    if v_phase = 'roll' then g := public._tdp_do_roll(g);
    elsif v_phase = 'jail' then g := public._tdp_jail_roll(g);
    else raise exception 'wrong_phase'; end if;

  elsif v_type in ('pay_jail', 'use_card') then
    if v_phase <> 'jail' then raise exception 'wrong_phase'; end if;
    if v_type = 'pay_jail' then
      if (s->'cash'->>t)::integer < 50 then raise exception 'not_enough_cash'; end if;
      s := public._tdp_transfer(s, t, null, 50);
      s := public._tdp_log(s, jsonb_build_object('player', t, 'kind', 'jail_out', 'how', 'pay', 'amount', 50));
    else
      v_card := s->'jail_cards'->t->>0;
      if v_card is null then raise exception 'no_jail_card'; end if;
      v_deck := case when v_card like 'h%' then 'hasard' else 'potes' end;
      g := jsonb_set(g, array['v', 'decks', v_deck],
                     coalesce(g->'v'->'decks'->v_deck, '[]'::jsonb) || to_jsonb(v_card));
      s := public._tdp_log(s, jsonb_build_object('player', t, 'kind', 'jail_out', 'how', 'card', 'card', v_card));
      if jsonb_array_length(s->'jail_cards'->t) <= 1 then
        s := s || jsonb_build_object('jail_cards', (s->'jail_cards') - t);
      else
        s := jsonb_set(s, array['jail_cards', t], (s->'jail_cards'->t) - 0);
      end if;
    end if;
    s := s || jsonb_build_object('jail', (s->'jail') - t, 'phase', 'roll');
    s := public._tdp_deadline(s, 0);
    g := jsonb_set(g, '{s}', s);

  elsif v_type = 'draw' then
    if v_phase <> 'card' then raise exception 'wrong_phase'; end if;
    g := public._tdp_draw(g);

  elsif v_type in ('buy', 'pass') then
    if v_phase <> 'buy' then raise exception 'wrong_phase'; end if;
    g := public._tdp_decide_buy(g, v_type = 'buy');

  elsif v_type in ('build', 'sell') then
    if v_type = 'build' and v_phase not in ('roll', 'jail', 'manage') then raise exception 'wrong_phase'; end if;
    if v_type = 'sell' and v_phase not in ('roll', 'jail', 'manage', 'debt') then raise exception 'wrong_phase'; end if;
    if jsonb_typeof(p_action->'cell') is distinct from 'number' then raise exception 'invalid_cell'; end if;
    if (p_action->>'cell')::numeric <> floor((p_action->>'cell')::numeric)
       or (p_action->>'cell')::numeric < 0 or (p_action->>'cell')::numeric > 39 then
      raise exception 'invalid_cell';
    end if;
    v_cell := (p_action->>'cell')::numeric::integer;
    c := public._tdp_cell(v_cell);
    if c->>'type' <> 'quartier' then raise exception 'not_buildable'; end if;
    if s->'owners'->>v_cell::text is distinct from t then raise exception 'not_owner'; end if;
    if not public._tdp_owns_group(s, t, c->>'group') then raise exception 'group_incomplete'; end if;
    v_grp := public._tdp_group_cells(c->>'group');
    lvl := public._tdp_level(s, v_cell);
    if v_type = 'build' then
      if lvl >= 5 then raise exception 'max_buildings'; end if;
      select min(public._tdp_level(s, y)) into x from unnest(v_grp) as y;
      if lvl > x then raise exception 'build_uneven'; end if;
      if (s->'cash'->>t)::integer < (c->>'house')::integer then raise exception 'not_enough_cash'; end if;
      s := public._tdp_transfer(s, t, null, (c->>'house')::integer);
      s := jsonb_set(s, array['buildings', v_cell::text], to_jsonb(lvl + 1));
      s := public._tdp_log(s, jsonb_build_object('player', t, 'kind', 'build', 'cell', v_cell, 'level', lvl + 1,
                                                 'amount', (c->>'house')::integer));
      s := public._tdp_stat(s, t, 'built', 1);
    else
      if lvl <= 0 then raise exception 'no_buildings'; end if;
      select max(public._tdp_level(s, y)) into x from unnest(v_grp) as y;
      if lvl < x then raise exception 'sell_uneven'; end if;
      s := public._tdp_transfer(s, null, t, (c->>'house')::integer / 2);
      if lvl - 1 = 0 then
        s := jsonb_set(s, '{buildings}', (s->'buildings') - v_cell::text);
      else
        s := jsonb_set(s, array['buildings', v_cell::text], to_jsonb(lvl - 1));
      end if;
      s := public._tdp_log(s, jsonb_build_object('player', t, 'kind', 'sell', 'cell', v_cell, 'level', lvl - 1,
                                                 'amount', (c->>'house')::integer / 2));
    end if;
    g := jsonb_set(g, '{s}', s);
    if v_phase = 'debt' then
      g := public._tdp_settle(g);
    else
      g := jsonb_set(g, '{s}', public._tdp_deadline(g->'s', 0));
    end if;

  elsif v_type = 'end_turn' then
    if v_phase <> 'manage' then raise exception 'wrong_phase'; end if;
    g := public._tdp_next_turn(g);
  end if;

  g := public._tdp_run_away(g);
  s := g->'s';
  if s->>'phase' = 'finished' then
    return jsonb_build_object('state', s, 'server', g->'v', 'results', s->'results');
  end if;
  return jsonb_build_object('state', s, 'server', g->'v');
end $$;

revoke all on function public._tdp_iso(timestamptz) from public, anon, authenticated;
revoke all on function public._tdp_board() from public, anon, authenticated;
revoke all on function public._tdp_cards() from public, anon, authenticated;
revoke all on function public._tdp_cell(integer) from public, anon, authenticated;
revoke all on function public._tdp_group_cells(text) from public, anon, authenticated;
revoke all on function public._tdp_level(jsonb, integer) from public, anon, authenticated;
revoke all on function public._tdp_owns_group(jsonb, text, text) from public, anon, authenticated;
revoke all on function public._tdp_rent(jsonb, integer, integer, text) from public, anon, authenticated;
revoke all on function public._tdp_props_value(jsonb, text) from public, anon, authenticated;
revoke all on function public._tdp_build_value(jsonb, text) from public, anon, authenticated;
revoke all on function public._tdp_sale_value(jsonb, text) from public, anon, authenticated;
revoke all on function public._tdp_fortune(jsonb, text) from public, anon, authenticated;
revoke all on function public._tdp_log(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._tdp_add_rent(jsonb, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public._tdp_le(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._tdp_stat(jsonb, text, text, integer) from public, anon, authenticated;
revoke all on function public._tdp_transfer(jsonb, text, text, integer) from public, anon, authenticated;
revoke all on function public._tdp_deadline(jsonb, integer) from public, anon, authenticated;
revoke all on function public._tdp_roll(jsonb) from public, anon, authenticated;
revoke all on function public._tdp_advance(jsonb, text, integer) from public, anon, authenticated;
revoke all on function public._tdp_to_jail(jsonb, text, text) from public, anon, authenticated;
revoke all on function public._tdp_land(jsonb, text, integer, text) from public, anon, authenticated;
revoke all on function public._tdp_card(jsonb, text, text, integer) from public, anon, authenticated;
revoke all on function public._tdp_liquidate(jsonb, text) from public, anon, authenticated;
revoke all on function public._tdp_finish(jsonb, text) from public, anon, authenticated;
revoke all on function public._tdp_tstats(jsonb, text, boolean, integer, integer, integer, integer) from public, anon, authenticated;
revoke all on function public._tdp_bankrupt(jsonb, text) from public, anon, authenticated;
revoke all on function public._tdp_next_turn(jsonb) from public, anon, authenticated;
revoke all on function public._tdp_settle(jsonb) from public, anon, authenticated;
revoke all on function public._tdp_new_event(jsonb, text, integer) from public, anon, authenticated;
revoke all on function public._tdp_do_roll(jsonb) from public, anon, authenticated;
revoke all on function public._tdp_jail_roll(jsonb) from public, anon, authenticated;
revoke all on function public._tdp_decide_buy(jsonb, boolean) from public, anon, authenticated;
revoke all on function public._tdp_draw(jsonb) from public, anon, authenticated;
revoke all on function public._tdp_auto_step(jsonb) from public, anon, authenticated;
revoke all on function public._tdp_auto_turn(jsonb) from public, anon, authenticated;
revoke all on function public._tdp_run_away(jsonb) from public, anon, authenticated;
revoke all on function public.game_tour_des_potes_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_tour_des_potes_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;


-- ===== games\tu-preferes.sql =====
-- =============================================================================
-- JEU « tu-preferes » (Tu préfères ? multi-écrans) — idempotent (create or replace).
-- Dépend de schema.sql (game_action, start_match, finish_match).
--
-- Chaque manche : un dilemme « A ou B ? ». Chaque joueur envoie DEUX choix secrets :
-- son propre choix (`choice`) et son pari sur le choix de la majorité (`bet`).
-- Les réponses restent dans `server.answers` (privé) jusqu'à la révélation ; le state
-- public n'expose que `answered` (qui a répondu). Le joueur retrouve SA réponse dans
-- match_secrets ({round, choice, bet}) après un rechargement.
--
-- Phases : answering -> reveal -> (answering …) -> finished.
-- Révélation : quand tous ont répondu, à l'échéance (`deadline` + {"type":"tick"}),
-- ou forcée par l'hôte ({"type":"reveal"}).
--
-- Points (calculés sur les joueurs ayant répondu) :
--   * +1 si le pari = le choix majoritaire. Égalité parfaite (ou personne n'a
--     répondu) : PAS de majorité, personne ne marque le point de pari.
--   * Rebelle (+1 si p_options.rebel, défaut true) : le SEUL joueur de son camp
--     alors que l'autre camp compte au moins 2 joueurs (donc ≥ 3 réponses ; une
--     égalité 1 contre 1 ne fait pas de rebelle). Le statut est toujours compté
--     dans les stats, le point seulement si l'option est active.
-- Gagnant(s) = max de points (ex-aequo inclus), personne si tout le monde a 0.
-- =============================================================================

-- Ouvre la manche p_round (1-based) : dilemme public, réponses vidées, échéance.
create or replace function public._tp_open_round(p_state jsonb, p_server jsonb, p_round integer)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
begin
  p_state := p_state || jsonb_build_object(
    'phase', 'answering',
    'round', p_round,
    'dilemma', p_server->'dilemmas'->(p_round - 1),
    'answered', '[]'::jsonb,
    'deadline', to_jsonb(now() + make_interval(secs => (p_state->>'timer')::integer)));
  p_server := jsonb_set(p_server, '{answers}', '{}'::jsonb);
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

create or replace function public.game_tu_preferes_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_d      jsonb := p_options->'dilemmas';
  v_rounds integer;
  v_timer  integer;
  v_rebel  boolean;
  v_zero   jsonb;
  v_stats  jsonb;
  v_state  jsonb;
  v_server jsonb;
begin
  if cardinality(p_players) < 2 then raise exception 'not_enough_players'; end if;
  if cardinality(p_players) > 9 then raise exception 'too_many_players'; end if;
  if v_d is null or jsonb_typeof(v_d) <> 'array' or jsonb_array_length(v_d) = 0 then
    raise exception 'missing_dilemmas';
  end if;
  if exists (select 1 from jsonb_array_elements(v_d) e
              where jsonb_typeof(e) <> 'object'
                 or jsonb_typeof(e->'a') is distinct from 'string'
                 or jsonb_typeof(e->'b') is distinct from 'string'
                 or char_length(btrim(e->>'a')) = 0 or char_length(btrim(e->>'b')) = 0
                 or char_length(e->>'a') > 200 or char_length(e->>'b') > 200) then
    raise exception 'invalid_dilemmas';
  end if;

  begin
    v_rounds := coalesce(nullif(p_options->>'rounds', '')::integer, 15);
  exception when others then v_rounds := 15;
  end;
  v_rounds := least(greatest(v_rounds, 1), 50, jsonb_array_length(v_d));

  begin
    v_timer := coalesce(nullif(p_options->>'timer', '')::integer, 30);
  exception when others then v_timer := 30;
  end;
  v_timer := least(greatest(v_timer, 10), 120);

  v_rebel := coalesce(p_options->'rebel', 'true'::jsonb) <> 'false'::jsonb;

  select jsonb_agg(jsonb_build_object(
           'id', left(coalesce(nullif(e->>'id', ''), 'd' || o), 40),
           'a', btrim(e->>'a'),
           'b', btrim(e->>'b'),
           'theme', case when jsonb_typeof(e->'theme') = 'string' then left(e->>'theme', 30) end)
         order by o)
    into v_d
    from jsonb_array_elements(v_d) with ordinality as t(e, o) where o <= v_rounds;

  select jsonb_object_agg(p::text, 0),
         jsonb_object_agg(p::text, jsonb_build_object('bets_ok', 0, 'rebel', 0, 'norm', 0, 'answered', 0))
    into v_zero, v_stats
    from unnest(p_players) p;

  v_state := jsonb_build_object(
    'game', 'tu-preferes',
    'phase', 'answering',
    'round', 1,
    'total_rounds', v_rounds,
    'timer', v_timer,
    'rebel_bonus', v_rebel,
    'deadline', null,
    'dilemma', null,
    'players', to_jsonb(p_players),
    'answered', '[]'::jsonb,
    'scores', v_zero,
    'stats', v_stats,
    'last_reveal', null,
    'history', '[]'::jsonb,
    'winners', null,
    'results', null);
  v_server := jsonb_build_object('dilemmas', v_d, 'answers', '{}'::jsonb);

  return public._tp_open_round(v_state, v_server, 1) || jsonb_build_object('secrets', '{}'::jsonb);
end $$;

-- Révélation de la manche en cours : choix publics, majorité, points.
create or replace function public._tp_reveal(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_ans     jsonb := coalesce(p_server->'answers', '{}'::jsonb);
  v_choices jsonb := '{}'::jsonb;
  v_bets    jsonb := '{}'::jsonb;
  v_ca      integer := 0;
  v_cb      integer := 0;
  v_maj     text;
  v_min     text;
  v_rebel   text;
  v_ok      text[] := '{}';
  v_rebels  text[] := '{}';
  v_gains   jsonb := '{}'::jsonb;
  v_scores  jsonb := p_state->'scores';
  v_stats   jsonb := p_state->'stats';
  v_bonus   boolean := coalesce((p_state->>'rebel_bonus')::boolean, true);
  v_pl      text;
  v_choice  text;
  v_bet     text;
  v_g       integer;
  v_st      jsonb;
begin
  -- Ordre stable = ordre des joueurs.
  for v_pl in select pl from jsonb_array_elements_text(p_state->'players') with ordinality as t(pl, o) order by o loop
    if v_ans ? v_pl then
      v_choices := v_choices || jsonb_build_object(v_pl, v_ans->v_pl->>'choice');
      v_bets    := v_bets    || jsonb_build_object(v_pl, v_ans->v_pl->>'bet');
      if v_ans->v_pl->>'choice' = 'a' then v_ca := v_ca + 1; else v_cb := v_cb + 1; end if;
    end if;
  end loop;

  v_maj := case when v_ca > v_cb then 'a' when v_cb > v_ca then 'b' end;
  v_min := case v_maj when 'a' then 'b' when 'b' then 'a' end;
  -- Rebelle : seul de son camp face à au moins 2 joueurs.
  if v_maj is not null and least(v_ca, v_cb) = 1 and greatest(v_ca, v_cb) >= 2 then
    select key into v_rebel from jsonb_each_text(v_choices) where value = v_min;
    v_rebels := array[v_rebel];
  end if;

  for v_pl in select pl from jsonb_array_elements_text(p_state->'players') with ordinality as t(pl, o) order by o loop
    v_g := 0;
    v_st := coalesce(v_stats->v_pl, jsonb_build_object('bets_ok', 0, 'rebel', 0, 'norm', 0, 'answered', 0));
    if v_choices ? v_pl then
      v_choice := v_choices->>v_pl;
      v_bet    := v_bets->>v_pl;
      v_st := jsonb_set(v_st, '{answered}', to_jsonb((v_st->>'answered')::integer + 1));
      if v_maj is not null and v_bet = v_maj then
        v_g := v_g + 1;
        v_ok := v_ok || v_pl;
        v_st := jsonb_set(v_st, '{bets_ok}', to_jsonb((v_st->>'bets_ok')::integer + 1));
      end if;
      if v_maj is not null and v_choice = v_maj then
        v_st := jsonb_set(v_st, '{norm}', to_jsonb((v_st->>'norm')::integer + 1));
      end if;
      if v_pl = any(v_rebels) then
        if v_bonus then v_g := v_g + 1; end if;
        v_st := jsonb_set(v_st, '{rebel}', to_jsonb((v_st->>'rebel')::integer + 1));
        -- Rebelle lucide : seul de son avis ET pari gagné sur la même manche
        if v_bet = v_maj then
          v_st := jsonb_set(v_st, '{rebel_right}', to_jsonb(coalesce((v_st->>'rebel_right')::integer, 0) + 1), true);
        end if;
      end if;
    end if;
    v_gains  := v_gains || jsonb_build_object(v_pl, v_g);
    v_scores := jsonb_set(v_scores, array[v_pl], to_jsonb(coalesce((v_scores->>v_pl)::integer, 0) + v_g), true);
    v_stats  := jsonb_set(v_stats, array[v_pl], v_st, true);
  end loop;

  p_state := p_state || jsonb_build_object(
    'phase', 'reveal',
    'deadline', null,
    'scores', v_scores,
    'stats', v_stats,
    'last_reveal', jsonb_build_object(
        'round', p_state->'round', 'dilemma', p_state->'dilemma',
        'choices', v_choices, 'bets', v_bets,
        'counts', jsonb_build_object('a', v_ca, 'b', v_cb),
        'majority', v_maj,
        'bettors_ok', to_jsonb(v_ok), 'rebels', to_jsonb(v_rebels),
        'gains', v_gains),
    'history', coalesce(p_state->'history', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'round', p_state->'round', 'dilemma', p_state->'dilemma',
        'counts', jsonb_build_object('a', v_ca, 'b', v_cb),
        'majority', v_maj, 'rebels', to_jsonb(v_rebels))));

  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Stats de fin de partie pour les trophées (features/trophees.sql) : s'ajoutent à state.stats[pl]
-- (bets_ok, rebel, norm, answered).
create or replace function public._tp_tstats(p_state jsonb, p_pl text)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  with s as (
    select coalesce((p_state->'stats'->p_pl->>'answered')::integer, 0) as answered,
           coalesce((p_state->'stats'->p_pl->>'bets_ok')::integer, 0) as bets_ok,
           coalesce((p_state->'stats'->p_pl->>'norm')::integer, 0) as norm,
           (p_state->>'total_rounds')::integer as rounds
  )
  select jsonb_build_object(
    'rounds', rounds,
    'bets_lost', greatest(0, answered - bets_ok),
    'unanimous_rounds', (select count(*) from jsonb_array_elements(coalesce(p_state->'history', '[]'::jsonb)) e
                          where (coalesce((e->'counts'->>'a')::integer, 0) = 0 or coalesce((e->'counts'->>'b')::integer, 0) = 0)
                            and coalesce((e->'counts'->>'a')::integer, 0) + coalesce((e->'counts'->>'b')::integer, 0) >= 3),
    'minority', case when answered > 0 and (answered - norm) * 2 > answered then 1 else 0 end,
    'perfect_bets', case when rounds >= 10 and bets_ok = rounds then 1 else 0 end)
  from s
$$;

create or replace function public._tp_finish(p_state jsonb, p_server jsonb)
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
           'stats', coalesce(p_state->'stats'->t.key, '{}'::jsonb) || public._tp_tstats(p_state, t.key))
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

create or replace function public.game_tu_preferes_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_type     text := p_action->>'type';
  v_phase    text := p_state->>'phase';
  v_round    integer := (p_state->>'round')::integer;
  v_total    integer := (p_state->>'total_rounds')::integer;
  v_deadline timestamptz := nullif(p_state->>'deadline', '')::timestamptz;
  v_choice   text;
  v_bet      text;
  v_answered jsonb;
  v_res      jsonb;
begin
  if v_type = 'tick' then
    -- Idempotent : ignoré sans erreur si trop tôt ou hors phase de réponse.
    if v_phase <> 'answering' or v_deadline is null or now() < v_deadline then
      return jsonb_build_object('state', p_state, 'server', p_server);
    end if;
    return public._tp_reveal(p_state, p_server);

  elsif v_type = 'answer' then
    if v_phase <> 'answering' then raise exception 'wrong_phase'; end if;
    if p_action ? 'round' and (p_action->>'round') is distinct from v_round::text then
      raise exception 'wrong_phase';
    end if;
    if not (p_state->'players' ? p_actor::text) then raise exception 'not_a_player'; end if;
    v_choice := p_action->>'choice';
    v_bet    := p_action->>'bet';
    if jsonb_typeof(p_action->'choice') is distinct from 'string' or v_choice not in ('a', 'b')
       or jsonb_typeof(p_action->'bet') is distinct from 'string' or v_bet not in ('a', 'b') then
      raise exception 'invalid_choice';
    end if;

    p_server := jsonb_set(p_server, array['answers', p_actor::text],
                          jsonb_build_object('choice', v_choice, 'bet', v_bet), true);
    select coalesce(jsonb_agg(pl order by o), '[]'::jsonb) into v_answered
      from jsonb_array_elements_text(p_state->'players') with ordinality as t(pl, o)
     where (p_server->'answers') ? pl;
    p_state := jsonb_set(p_state, '{answered}', v_answered);

    -- Tout le monde a répondu, ou réponse arrivée après l'échéance : on révèle.
    if jsonb_array_length(v_answered) >= jsonb_array_length(p_state->'players')
       or (v_deadline is not null and now() >= v_deadline) then
      v_res := public._tp_reveal(p_state, p_server);
    else
      v_res := jsonb_build_object('state', p_state, 'server', p_server);
    end if;
    return v_res || jsonb_build_object('secrets', jsonb_build_object(
      p_actor::text, jsonb_build_object('round', v_round, 'choice', v_choice, 'bet', v_bet)));

  elsif v_type = 'reveal' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase <> 'answering' then raise exception 'wrong_phase'; end if;
    return public._tp_reveal(p_state, p_server);

  elsif v_type = 'next' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase <> 'reveal' then raise exception 'wrong_phase'; end if;
    if v_round >= v_total then
      return public._tp_finish(p_state, p_server);
    end if;
    return public._tp_open_round(p_state, p_server, v_round + 1);

  else
    raise exception 'unknown_action';
  end if;
end $$;

revoke all on function public._tp_open_round(jsonb, jsonb, integer) from public, anon, authenticated;
revoke all on function public._tp_reveal(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._tp_finish(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._tp_tstats(jsonb, text) from public, anon, authenticated;
revoke all on function public.game_tu_preferes_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_tu_preferes_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;


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
 where not (equipped_expression = any(expressions))
   and not (equipped_expression = any(public._costume_expressions()));  -- palette des tenues (pouces, timide, déterminé…)

-- Lignes de stats + déblocage par défaut
insert into public.player_stats (profile_id)
select id from public.profiles
on conflict (profile_id) do nothing;

insert into public.unlocks (profile_id, expression)
select id, 'joie' from public.profiles
on conflict (profile_id, expression) do nothing;
