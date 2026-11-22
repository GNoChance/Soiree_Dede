-- MORCEAU 1 / 5 — -- GÉNÉRÉ par scripts/build-sql.mjs — ne pas éditer. Idempotent. À exécuter dans l'ordre (1, puis 2…) dans Supabase > SQL Editor > Run.

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
-- Mode invité (features/guest.sql) : profil temporaire sans PIN, lié à une seule soirée,
-- exclu des classements / XP / stats / trophées, purgé après guest_expires_at.
alter table public.profiles add column if not exists is_guest boolean not null default false;
alter table public.profiles add column if not exists guest_expires_at timestamptz;

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

-- Comme _require_profile, mais refuse les invités (profiles.is_guest) : RPC réservées à la bande.
create or replace function public._require_member()
returns uuid language plpgsql security definer
set search_path = public, extensions
as $$
declare v_id uuid := public._require_profile();
begin
  if exists (select 1 from public.profiles where id = v_id and is_guest) then
    raise exception 'guest_forbidden';
  end if;
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
  select count(*) - 1 into v_others from public.profiles where not is_guest;
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
  where not p.is_guest  -- écran de connexion : la bande seulement
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
  if exists (select 1 from public.profiles where id in (v_me, p_profile_id) and is_guest) then
    raise exception 'guest_forbidden';
  end if;
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
    join public.profiles p on p.id = mp.profile_id and not p.is_guest  -- invités : pas de stats
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
  v_me   uuid := public._require_member();
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
  if exists (select 1 from unnest(v_ids) x where not exists (select 1 from public.profiles p where p.id = x and not p.is_guest)) then
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
  v_me  uuid := public._require_member();  -- invités : join_as_guest (features/guest.sql)
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
    -- Un invité ne devient jamais hôte : s'il ne reste que des invités, la soirée se termine.
    select sp.profile_id into v_new from public.soiree_players sp
      join public.profiles p on p.id = sp.profile_id and not p.is_guest
     where sp.soiree_id = v_sid order by sp.joined_at, sp.profile_id limit 1;
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

    -- Invité (features/guest.sql) : ligne match_players gardée (salon, récap, pronos) mais ni XP,
    -- ni player_stats, ni déblocages/tenues/trophées.
    if exists (select 1 from public.profiles where id = r.profile_id and is_guest) then
      v_xpmap := v_xpmap || jsonb_build_object(r.profile_id::text, 0);
      continue;
    end if;
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
left join public.player_stats s on s.profile_id = p.id
where not p.is_guest;  -- invités hors classements (features/guest.sql)

drop view if exists public.leaderboard_by_game;
create view public.leaderboard_by_game with (security_invoker = true) as
select mp.game_id, p.id as profile_id, p.slug, p.first_name, p.nickname, p.equipped_expression,
       count(*)::integer as games_played,
       (count(*) filter (where mp.won))::integer as wins,
       coalesce(sum(mp.points), 0)::integer as points_total,
       rank() over (partition by mp.game_id
                    order by count(*) filter (where mp.won) desc, coalesce(sum(mp.points), 0) desc) as rank
from public.match_players mp
join public.profiles p on p.id = mp.profile_id and not p.is_guest
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


-- ===== features\cadeaux.sql =====
-- =============================================================================
-- CADEAUX (deco in game) : cadres d'avatar, titres sous le pseudo, objets de jeu (purement decoratifs).
-- Catalogue `items` (miroir de src/data/cadeaux.ts), possession `profile_items`, equipement
-- `profiles.equipped_items` = {slot: item_id}. Source actuelle : calendrier de l'Avent
-- (advent_day = cadeau de la case de ce jour ; advent_count = palier en nombre de cases ouvertes),
-- distribue par advent_open (features/daily.sql) via _advent_gifts.
-- Autres sources : items.rule, verifiee par _sync_items (RPC sync_my_items, appelee par le front) :
--   {"trophy": id} trophee obtenu | {"level": n} niveau >= n | {"weekly": n} champion de la semaine n fois
--   | {"wins": {"game": id, "n": n}} n victoires dans ce jeu. Retroactif.
-- BOUTIQUE : items.price non null = article achetable (jamais un cadeau gagne). Pieces = calculees depuis
--   l'historique (_coins : 5 / partie, 15 / victoire, 10 / defi du jour termine, 20 / trophee) moins les achats
--   (item_purchases). Vitrine de la semaine (shop_state) : 6 articles, ordre md5(semaine || id), hors articles
--   possedes avant le lundi ; achat : buy_item.
-- Slots : frame, title, kart, golf_ball, bowling_ball, chess, card_back, dice, marks.
-- Charge avant daily.sql (ordre alphabetique).
-- =============================================================================

create table if not exists public.items (
  id           text primary key,
  slot         text not null,
  label        text not null,
  advent_day   integer,
  advent_count integer
);
alter table public.items add column if not exists rule jsonb;
alter table public.items add column if not exists price integer;
alter table public.items drop constraint if exists items_slot_check;
alter table public.items add constraint items_slot_check check (slot in ('frame', 'title', 'kart', 'golf_ball', 'bowling_ball', 'chess', 'card_back', 'dice', 'marks'));
alter table public.items enable row level security;
drop policy if exists items_select on public.items;
create policy items_select on public.items for select to authenticated using (true);

insert into public.items(id, slot, label, advent_day, advent_count, rule, price) values
  -- titres (jours impairs)
  ('t_lutin_stagiaire', 'title', 'Lutin stagiaire', 1, null, null, null),
  ('t_chocolat_chaud', 'title', 'Accro au chocolat chaud', 3, null, null, null),
  ('t_pote_rennes', 'title', 'Pote des rennes', 5, null, null, null),
  ('t_artiste_neiges', 'title', 'Artiste des neiges', 7, null, null, null),
  ('t_papier_cadeau', 'title', 'As du papier cadeau', 9, null, null, null),
  ('t_chorale', 'title', 'Chorale à soi tout seul', 11, null, null, null),
  ('t_mange_biscuits', 'title', 'Mange-biscuits', 13, null, null, null),
  ('t_pilote_luge', 'title', 'Pilote de luge', 15, null, null, null),
  ('t_pro_guirlandes', 'title', 'Pro des guirlandes', 17, null, null, null),
  ('t_garde_sapin', 'title', 'Garde du sapin', 19, null, null, null),
  ('t_grelot_officiel', 'title', 'Grelot officiel', 21, null, null, null),
  ('t_etoile_soiree', 'title', 'Étoile de la soirée', 23, null, null, null),
  -- cadres (jours pairs)
  ('f_guirlande', 'frame', 'Guirlande lumineuse', 2, null, null, null),
  ('f_flocons', 'frame', 'Flocons', 4, null, null, null),
  ('f_sucre_orge', 'frame', 'Sucre d''orge', 6, null, null, null),
  ('f_houx', 'frame', 'Houx', 8, null, null, null),
  ('f_pain_epice', 'frame', 'Pain d''épice', 10, null, null, null),
  ('f_boules', 'frame', 'Boules de Noël', 12, null, null, null),
  ('f_cadeau', 'frame', 'Paquet cadeau', 14, null, null, null),
  ('f_etoiles', 'frame', 'Étoiles', 16, null, null, null),
  ('f_neige', 'frame', 'Tempête de neige', 18, null, null, null),
  ('f_sapin', 'frame', 'Sapin', 20, null, null, null),
  ('f_aurore', 'frame', 'Aurore boréale', 22, null, null, null),
  ('f_etoile_doree', 'frame', 'Étoile dorée', 24, null, null, null),
  -- paliers (nombre de cases ouvertes)
  ('bb_noel', 'bowling_ball', 'Boule de Noël', null, 6, null, null),
  ('gb_bonhomme', 'golf_ball', 'Balle bonhomme de neige', null, 12, null, null),
  ('k_traineau', 'kart', 'Traîneau', null, 18, null, null),
  ('c_pain_epice', 'chess', 'Échecs en pain d''épice', null, 24, null, null),
  ('t_esprit_noel', 'title', 'Esprit de Noël incarné', null, 24, null, null),
  ('f_arc_en_ciel', 'frame', 'Arc-en-ciel', null, null, '{"trophy":"gen_touche_a_tout"}'::jsonb, null),
  ('t_couteau_suisse', 'title', 'Couteau suisse', null, null, '{"trophy":"gen_polyvalent"}'::jsonb, null),
  ('t_pilier', 'title', 'Pilier de soirée', null, null, '{"trophy":"gen_pilier"}'::jsonb, null),
  ('f_nuit_blanche', 'frame', 'Nuit blanche', null, null, '{"trophy":"gen_noctambule"}'::jsonb, null),
  ('t_increvable', 'title', 'Increvable', null, null, '{"trophy":"gen_marathon"}'::jsonb, null),
  ('f_tapis_rouge', 'frame', 'Tapis rouge', null, null, '{"trophy":"gen_hote"}'::jsonb, null),
  ('t_grande_tablee', 'title', 'Grande tablée', null, null, '{"trophy":"gen_grande_tablee"}'::jsonb, null),
  ('f_bulles', 'frame', 'Bulles de BD', null, null, '{"trophy":"gen_pipelette"}'::jsonb, null),
  ('t_fashion_week', 'title', 'Fashion week', null, null, '{"trophy":"gen_garde_robe"}'::jsonb, null),
  ('f_medaillon', 'frame', 'Médaillon', null, null, '{"trophy":"gen_collectionneur"}'::jsonb, null),
  ('t_boule_cristal', 'title', 'Boule de cristal', null, null, '{"trophy":"gen_madame_irma"}'::jsonb, null),
  ('f_bronze', 'frame', 'Bronze', null, null, '{"level":5}'::jsonb, null),
  ('f_argent', 'frame', 'Argent', null, null, '{"level":10}'::jsonb, null),
  ('f_or', 'frame', 'Or', null, null, '{"level":15}'::jsonb, null),
  ('f_diamant', 'frame', 'Diamant', null, null, '{"level":20}'::jsonb, null),
  ('t_patron_semaine', 'title', 'Patron de la semaine', null, null, '{"weekly":1}'::jsonb, null),
  ('f_couronne', 'frame', 'Couronne', null, null, '{"weekly":3}'::jsonb, null),
  ('k_dore', 'kart', 'Bolide doré', null, null, '{"wins":{"game":"dede-kart","n":10}}'::jsonb, null),
  ('gb_disco', 'golf_ball', 'Balle disco', null, null, '{"wins":{"game":"mini-golf","n":10}}'::jsonb, null),
  ('bb_galaxie', 'bowling_ball', 'Boule galaxie', null, null, '{"wins":{"game":"bowling","n":10}}'::jsonb, null),
  ('c_marbre', 'chess', 'Pièces en marbre', null, null, '{"wins":{"game":"echecs","n":10}}'::jsonb, null),
  -- boutique
  ('cb_bonbon', 'card_back', 'Bonbon', null, null, null, 100),
  ('cb_pois', 'card_back', 'Pois', null, null, null, 100),
  ('cb_damier', 'card_back', 'Damier', null, null, null, 250),
  ('cb_etoiles', 'card_back', 'Nuit étoilée', null, null, null, 250),
  ('cb_vagues', 'card_back', 'Vagues', null, null, null, 250),
  ('cb_confettis', 'card_back', 'Confettis', null, null, null, 500),
  ('d_bonbon', 'dice', 'Dés rose bonbon', null, null, null, 100),
  ('d_glacon', 'dice', 'Dés glaçon', null, null, null, 250),
  ('d_nuit', 'dice', 'Dés nuit étoilée', null, null, null, 250),
  ('d_or', 'dice', 'Dés en or', null, null, null, 500),
  ('m_craie', 'marks', 'Craie', null, null, null, 100),
  ('m_neon', 'marks', 'Néon', null, null, null, 250),
  ('m_paillettes', 'marks', 'Paillettes', null, null, null, 500),
  ('k_menthe', 'kart', 'Peinture menthe', null, null, null, 100),
  ('k_flamant', 'kart', 'Rose flamant', null, null, null, 250),
  ('k_noir', 'kart', 'Noir mat', null, null, null, 250),
  ('k_lave', 'kart', 'Lave', null, null, null, 500),
  ('gb_pasteque', 'golf_ball', 'Balle pastèque', null, null, null, 100),
  ('gb_lune', 'golf_ball', 'Balle lune', null, null, null, 250),
  ('bb_bille', 'bowling_ball', 'Boule bille', null, null, null, 100),
  ('bb_volcan', 'bowling_ball', 'Boule volcan', null, null, null, 250),
  ('f_pois', 'frame', 'Pois', null, null, null, 100),
  ('f_damier', 'frame', 'Damier', null, null, null, 100),
  ('f_zebre', 'frame', 'Zèbre', null, null, null, 250),
  ('f_coeurs', 'frame', 'Cœurs', null, null, null, 250),
  ('f_fleurs', 'frame', 'Fleurs', null, null, null, 250),
  ('f_neon', 'frame', 'Néon', null, null, null, 500),
  ('t_mauvaise_foi', 'title', 'Mauvaise foi', null, null, null, 100),
  ('t_coup_de_bluff', 'title', 'Coup de bluff', null, null, null, 100),
  ('t_pro_chambrage', 'title', 'Pro du chambrage', null, null, null, 100),
  ('t_tout_ou_rien', 'title', 'Tout ou rien', null, null, null, 250),
  ('t_chance_insolente', 'title', 'Chance insolente', null, null, null, 250),
  ('t_legende_vivante', 'title', 'Légende vivante', null, null, null, 500),
  ('f_ubb', 'frame', 'Supporter UBB', null, null, null, 250),
  ('t_ubb', 'title', 'Supporter UBB', null, null, null, 100),
  ('cb_ubb', 'card_back', 'Rugby bordelais', null, null, null, 250),
  ('k_ubb', 'kart', 'Peinture UBB', null, null, null, 250),
  ('bb_ubb', 'bowling_ball', 'Boule ovale', null, null, null, 250)
on conflict (id) do update set slot = excluded.slot, label = excluded.label,
  advent_day = excluded.advent_day, advent_count = excluded.advent_count, rule = excluded.rule, price = excluded.price;

create table if not exists public.profile_items (
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  item_id     text not null references public.items(id) on delete cascade,
  obtained_at timestamptz not null default now(),
  primary key (profile_id, item_id)
);
alter table public.profile_items enable row level security;
drop policy if exists profile_items_select on public.profile_items;
create policy profile_items_select on public.profile_items for select to authenticated using (true);
-- Aucune policy d'ecriture : tout passe par les RPC.

alter table public.profiles add column if not exists equipped_items jsonb not null default '{}'::jsonb;

-- Donne un objet (idempotent). Renvoie true si nouveau.
create or replace function public._grant_item(p_profile uuid, p_item text)
returns boolean language plpgsql security definer
set search_path = public, extensions
as $$
begin
  insert into public.profile_items(profile_id, item_id) values (p_profile, p_item) on conflict do nothing;
  return found;
end $$;

-- Cadeaux de l'Avent dus pour la case p_day et p_count cases ouvertes cette annee (idempotent).
-- Renvoie les ids nouvellement obtenus.
create or replace function public._advent_gifts(p_profile uuid, p_day date, p_count integer)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_new jsonb := '[]'::jsonb;
  r record;
begin
  for r in select i.id from public.items i
            where i.advent_day = extract(day from p_day)::int
               or (i.advent_count is not null and i.advent_count <= p_count)
            order by coalesce(i.advent_count, 0), i.id
  loop
    if public._grant_item(p_profile, r.id) then v_new := v_new || to_jsonb(r.id); end if;
  end loop;
  return v_new;
end $$;

-- Equipe un objet possede dans son slot (p_item null = retire). Renvoie equipped_items.
-- Erreurs : item_invalid_slot, item_not_owned.
create or replace function public.equip_item(p_slot text, p_item text)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := public._require_profile();
  v_out jsonb;
begin
  if p_slot is null or p_slot not in ('frame', 'title', 'kart', 'golf_ball', 'bowling_ball', 'chess', 'card_back', 'dice', 'marks') then
    raise exception 'item_invalid_slot';
  end if;
  if p_item is not null then
    if not exists (select 1 from public.items where id = p_item and slot = p_slot) then raise exception 'item_invalid_slot'; end if;
    if not exists (select 1 from public.profile_items where profile_id = v_me and item_id = p_item) then raise exception 'item_not_owned'; end if;
    update public.profiles set equipped_items = equipped_items || jsonb_build_object(p_slot, p_item)
     where id = v_me returning equipped_items into v_out;
  else
    update public.profiles set equipped_items = equipped_items - p_slot where id = v_me returning equipped_items into v_out;
  end if;
  return v_out;
end $$;

-- Donne a p_profile les objets a regle (items.rule) dont la condition est remplie. Renvoie les ids nouveaux.
create or replace function public._sync_items(p_profile uuid)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_new jsonb := '[]'::jsonb;
  v_level integer;
  v_weekly integer;
  r record;
  v_ok boolean;
begin
  select public.level_for_xp(xp) into v_level from public.profiles where id = p_profile;
  if v_level is null then return v_new; end if;
  v_weekly := -1; -- calcule a la demande (requete plus lourde)
  for r in select i.id, i.rule from public.items i
            where i.rule is not null
              and not exists (select 1 from public.profile_items pi where pi.profile_id = p_profile and pi.item_id = i.id)
            order by i.id
  loop
    v_ok := false;
    if r.rule ? 'trophy' then
      v_ok := exists (select 1 from public.trophy_unlocks u where u.profile_id = p_profile and u.trophy_id = r.rule->>'trophy');
    elsif r.rule ? 'level' then
      v_ok := v_level >= (r.rule->>'level')::int;
    elsif r.rule ? 'weekly' then
      if v_weekly < 0 then
        select count(*)::int into v_weekly from public._weekly_champions_all() c where c.profile_id = p_profile;
      end if;
      v_ok := v_weekly >= (r.rule->>'weekly')::int;
    elsif r.rule ? 'wins' then
      v_ok := (select count(*) from public.match_players mp
                where mp.profile_id = p_profile and mp.game_id = r.rule->'wins'->>'game' and mp.won)
              >= (r.rule->'wins'->>'n')::int;
    end if;
    if v_ok and public._grant_item(p_profile, r.id) then v_new := v_new || to_jsonb(r.id); end if;
  end loop;
  return v_new;
end $$;

-- Verifie et donne les cadeaux meritees (trophees, niveau, semaine, victoires). Renvoie les ids nouveaux.
create or replace function public.sync_my_items()
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
begin
  return public._sync_items(public._require_profile());
end $$;

-- ---- BOUTIQUE -------------------------------------------------------------------
create table if not exists public.item_purchases (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  item_id    text not null references public.items(id) on delete cascade,
  price      integer not null,
  bought_at  timestamptz not null default now(),
  primary key (profile_id, item_id)
);
alter table public.item_purchases enable row level security;
drop policy if exists item_purchases_select on public.item_purchases;
create policy item_purchases_select on public.item_purchases for select to authenticated using (true);
-- Aucune policy d'ecriture : tout passe par buy_item.

-- Solde de pieces (derive de l'historique, retroactif).
create or replace function public._coins(p_profile uuid)
returns integer language sql stable security definer
set search_path = public, extensions
as $$
  select (select coalesce(5 * count(*) + 15 * count(*) filter (where won), 0) from public.match_players where profile_id = p_profile)::int
       + (select 10 * count(*) from public.daily_runs where profile_id = p_profile and finished_at is not null)::int
       + (select 20 * count(*) from public.trophy_unlocks where profile_id = p_profile)::int
       - (select coalesce(sum(price), 0) from public.item_purchases where profile_id = p_profile)::int
$$;

-- Vitrine de la semaine : 6 articles (ordre md5(semaine || id)), hors articles possedes avant le lundi.
create or replace function public._shop_items(p_profile uuid, p_week date)
returns text[] language sql stable security definer
set search_path = public, extensions
as $$
  select coalesce(array_agg(id order by k), '{}') from (
    select i.id, md5(p_week::text || i.id) as k from public.items i
     where i.price is not null
       and not exists (select 1 from public.profile_items pi where pi.profile_id = p_profile and pi.item_id = i.id
                         and pi.obtained_at < (p_week::timestamp at time zone 'Europe/Paris'))
     order by k limit 6) t
$$;

-- {coins, week_start, ends_at, items:[ids], owned:[ids de la vitrine deja possedes]}
create or replace function public.shop_state()
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := public._require_profile();
  v_week date := public._week_start_now();
  v_items text[] := public._shop_items(v_me, v_week);
begin
  return jsonb_build_object(
    'coins', public._coins(v_me),
    'week_start', v_week,
    'ends_at', ((v_week + 7)::timestamp at time zone 'Europe/Paris'),
    'items', to_jsonb(v_items),
    'owned', coalesce((select jsonb_agg(item_id) from public.profile_items
                        where profile_id = v_me and item_id = any(v_items)), '[]'::jsonb));
end $$;

-- Achete un article de la vitrine. Renvoie {item, coins}.
-- Erreurs : shop_not_available (pas en vitrine), item_already_owned, shop_not_enough_coins.
create or replace function public.buy_item(p_item text)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := public._require_profile();
  v_price integer;
begin
  perform 1 from public.profiles where id = v_me for update;  -- serialise les achats d'un joueur
  if p_item is null or not (p_item = any(public._shop_items(v_me, public._week_start_now()))) then
    raise exception 'shop_not_available';
  end if;
  if exists (select 1 from public.profile_items where profile_id = v_me and item_id = p_item) then raise exception 'item_already_owned'; end if;
  select price into v_price from public.items where id = p_item;
  if public._coins(v_me) < v_price then raise exception 'shop_not_enough_coins'; end if;
  insert into public.item_purchases(profile_id, item_id, price) values (v_me, p_item, v_price);
  perform public._grant_item(v_me, p_item);
  return jsonb_build_object('item', p_item, 'coins', public._coins(v_me));
end $$;

revoke all on function public._coins(uuid) from public, anon, authenticated;
revoke all on function public._shop_items(uuid, date) from public, anon, authenticated;
revoke all on function public.shop_state() from public, anon;
revoke all on function public.buy_item(text) from public, anon;
grant execute on function public.shop_state() to authenticated;
grant execute on function public.buy_item(text) to authenticated;
revoke all on function public._sync_items(uuid) from public, anon, authenticated;
revoke all on function public.sync_my_items() from public, anon;
grant execute on function public.sync_my_items() to authenticated;
revoke all on function public._grant_item(uuid, text) from public, anon, authenticated;
revoke all on function public._advent_gifts(uuid, date, integer) from public, anon, authenticated;
revoke all on function public.equip_item(text, text) from public, anon;
grant execute on function public.equip_item(text, text) to authenticated;


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
  v_me  uuid := public._require_member();
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
  v_me  uuid := public._require_member();
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
  v_me  uuid := public._require_member();
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
  v_me  uuid := public._require_member();
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
  v_me  uuid := public._require_member();
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
--      -> {board: {...public}, server?: any, secrets?: {"<uid>": any}, setup_seconds?: int, turn_seconds?: number}
--  * game_<id>_board_move(p_board jsonb, p_server jsonb, p_actor text, p_move jsonb) returns jsonb [obligatoire]
--      lève une erreur métier si le coup est illégal (invalid_move, column_full…)
--      -> {board, server?, secrets?, outcome: null|'win'|'draw', winner?: uid, turn?: uid, turn_seconds?: number}
--      (turn absent = alternance ; server absent = inchangé ; turn_seconds = durée du prochain coup,
--       absent = session.turn_seconds — ex. échecs : temps restant à la pendule du joueur au trait)
--  * game_<id>_board_auto(p_board jsonb, p_server jsonb, p_actor text) returns jsonb [obligatoire]
--      -> un coup LÉGAL tiré au hasard (même format que p_move), rejoué via board_move.
--  * game_<id>_board_setup(p_board jsonb, p_server jsonb, p_actor text, p_move jsonb) returns jsonb [optionnel]
--      Phase de préparation SIMULTANÉE (ex. placer sa flotte) si board_new renvoie setup_seconds > 0.
--      Appelé avec : un coup de préparation du jeu ({type:'setup', move} côté client) ;
--      {"type":"ready"} (valider, lever setup_incomplete si besoin) ; {"type":"auto"}
--      (compléter AU HASARD la préparation de p_actor, à l'échéance) ; {"type":"begin"}
--      avec p_actor NULL (les deux sont prêts : passer au jeu). -> {board, server?, secrets?, turn_seconds?}
--  * game_<id>_board_offturn(p_board jsonb, p_server jsonb, p_actor text, p_move jsonb) returns jsonb [optionnel]
--      Coup d'un duelliste HORS de son tour (ex. abandon aux échecs). Même retour que board_move ;
--      lever not_your_turn pour refuser. outcome null = plateau mis à jour, tour et échéance inchangés.
--      Hook absent = not_your_turn (comportement historique).
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

-- Durée du prochain coup : turn_seconds renvoyé par un hook (nombre > 0), sinon session.turn_seconds (défaut 30).
create or replace function public._duel_turn_secs(p_r jsonb, p_state jsonb)
returns numeric language sql immutable
set search_path = public, extensions
as $$
  select case when jsonb_typeof(p_r->'turn_seconds') = 'number' and (p_r->>'turn_seconds')::numeric > 0
              then least((p_r->>'turn_seconds')::numeric, 86400)
              else coalesce((p_state->'session'->>'turn_seconds')::numeric, 30) end;
$$;

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
    v_state := v_state || jsonb_build_object('phase', 'playing',
                 'deadline', public._duel_in(public._duel_turn_secs(v_r, jsonb_build_object('session', jsonb_build_object('turn_seconds', v_secs)))));
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
      'deadline', public._duel_in(public._duel_turn_secs(v_r, v_state)));
  end if;
  return public._duel_add_secrets(p_x || jsonb_build_object('state', v_state, 'server', v_server), v_r->'secrets');
end $$;

-- Coup d'un duelliste hors de son tour (hook optionnel board_offturn, ex. abandon aux échecs).
-- Sans hook : not_your_turn. Ni le compteur de coups ni le tour ni l'échéance ne bougent (sauf fin de manche).
create or replace function public._duel_offturn_move(p_game text, p_x jsonb, p_actor text, p_move jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_fn     text := public._duel_hook(p_game, 'board_offturn', 'jsonb, jsonb, text, jsonb');
  v_state  jsonb := p_x->'state';
  v_server jsonb := coalesce(p_x->'server', '{}'::jsonb);
  v_r      jsonb;
  v_out    text;
begin
  if v_fn is null then raise exception 'not_your_turn'; end if;
  execute format('select public.%I($1, $2, $3, $4)', v_fn) into v_r
    using v_state->'board', coalesce(v_server->'board', 'null'::jsonb), p_actor, p_move;
  if v_r is null or jsonb_typeof(v_r->'board') is distinct from 'object' then raise exception 'invalid_board'; end if;
  v_out := v_r->>'outcome';
  if v_out is not null and v_out not in ('win', 'draw') then raise exception 'invalid_board'; end if;
  if v_r ? 'server' then v_server := v_server || jsonb_build_object('board', v_r->'server'); end if;
  v_state := v_state || jsonb_build_object('board', v_r->'board',
    'duel', (v_state->'duel') || jsonb_build_object('last_move', jsonb_build_object('by', p_actor, 'move', p_move, 'auto', false)));
  if v_out is not null then
    v_state := public._duel_end_game(v_state, v_out, v_r->>'winner',
                 case when v_r ? 'game' then jsonb_build_object('game', v_r->'game') end);
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
    'deadline', public._duel_in(public._duel_turn_secs(v_r, v_state)));
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
      if v_d->>'turn' is distinct from v_me then
        v_x := public._duel_offturn_move(p_game, v_x, v_me, v_move);   -- hook optionnel, sinon not_your_turn
      else
        v_x := public._duel_apply_move(p_game, v_x, v_me, v_move, false);
      end if;
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
revoke all on function public._duel_turn_secs(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._duel_offturn_move(text, jsonb, text, jsonb) from public, anon, authenticated;
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


-- ===== features\face-a-face.sql =====
-- =============================================================================
-- FACE-A-FACE : bilan entre le joueur connecte et un autre joueur — idempotent.
-- Parties jouees ensemble (match_players), victoires de chacun, duels directs
-- (parties a exactement 2 joueurs : eux deux), jeu ou chacun domine l'autre.
-- =============================================================================

create or replace function public.head_to_head(p_other uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_me  uuid := public._require_profile();
  v_res jsonb;
begin
  if p_other is null or p_other = v_me
     or not exists (select 1 from public.profiles where id = p_other) then
    raise exception 'unknown_profile';
  end if;
  with common as (
    select a.match_id, a.game_id, a.won as me_won, b.won as other_won,
           a.placement as me_pl, b.placement as other_pl, m.finished_at,
           (select count(*) from public.match_players x where x.match_id = a.match_id) as n
      from public.match_players a
      join public.match_players b on b.match_id = a.match_id and b.profile_id = p_other
      join public.matches m on m.id = a.match_id and m.status = 'finished'
     where a.profile_id = v_me
  ),
  per_game as (
    select game_id, count(*)::int as played,
           count(*) filter (where me_pl < other_pl)::int as me_ahead,
           count(*) filter (where other_pl < me_pl)::int as other_ahead
      from common group by game_id
  )
  select jsonb_build_object(
    'played',          (select count(*)::int from common),
    'me_wins',         (select count(*)::int from common where me_won),
    'other_wins',      (select count(*)::int from common where other_won),
    'duels',           (select count(*)::int from common where n = 2),
    'me_duel_wins',    (select count(*)::int from common where n = 2 and me_won),
    'other_duel_wins', (select count(*)::int from common where n = 2 and other_won),
    -- jeu ou chacun domine l'autre : meilleur ecart de classement (min. 2 parties communes)
    'me_best_game', (select jsonb_build_object('game_id', game_id, 'ahead', me_ahead, 'played', played)
                       from per_game where played >= 2 and me_ahead > other_ahead
                      order by me_ahead - other_ahead desc, played desc, game_id limit 1),
    'other_best_game', (select jsonb_build_object('game_id', game_id, 'ahead', other_ahead, 'played', played)
                          from per_game where played >= 2 and other_ahead > me_ahead
                         order by other_ahead - me_ahead desc, played desc, game_id limit 1),
    'last', (select jsonb_build_object('game_id', game_id, 'finished_at', finished_at,
                                       'winner', case when me_won and not other_won then 'me'
                                                      when other_won and not me_won then 'other' else null end)
               from common order by finished_at desc nulls last limit 1),
    'other', (select jsonb_build_object('id', p.id, 'slug', p.slug, 'nickname', p.nickname,
                                        'equipped_tenue', p.equipped_tenue)
                from public.profiles p where p.id = p_other)
  ) into v_res;
  return v_res;
end $$;

revoke all on function public.head_to_head(uuid) from public, anon;
grant execute on function public.head_to_head(uuid) to authenticated;


-- ===== features\guest.sql =====
-- =============================================================================
-- MODE INVITÉ — idempotent, exécuté APRÈS schema.sql (features/*, ordre alphabétique).
-- Un ami de passage rejoint UNE soirée depuis son téléphone, sans PIN ni compte :
--  * l'hôte ouvre les invitations (open_guest_invites) -> soirees.guest_token (10 car.)
--    affiché en QR code (/invite/<token>) ; le code à 4 caractères du salon marche aussi
--    tant que les invitations sont ouvertes (close_guest_invites les ferme) ;
--  * l'invité (session anonyme de son appareil) appelle join_as_guest(code|token, prénom,
--    avatar) -> profil temporaire profiles.is_guest (slug « g-<avatar>-<6 car.> »), lié à
--    l'appareil via device_sessions, membre de cette seule soirée ;
--  * il joue comme les autres (match_players écrit, classement/récap de la soirée, pronos)
--    mais NE COMPTE PAS pour la bande : ni XP, ni player_stats, ni déblocages / tenues /
--    trophées (finish_match), absent des classements général / par jeu / semaine, du défi
--    du jour, de l'Avent, des amis, de l'écran de connexion (cf. schema.sql, weekly.sql,
--    tenues.sql, daily.sql, soiree-hote.sql : filtres `is_guest` / _require_member()).
--    « Grande tablée » (trophée) compte les invités présents : c'est la taille de la tablée.
--  * il ne peut ni créer de soirée, ni rejoindre une autre soirée par code
--    (join_soiree_by_code -> guest_forbidden), ni devenir hôte (leave_soiree), ni être
--    invité ailleurs (create_soiree / invite_to_soiree) ; pas de PIN, jamais admin ;
--  * purge : guest_expires_at = dernière arrivée + 24 h ; un invité expiré qui n'est plus
--    dans aucune soirée en cours est supprimé (cascade : session, lignes de parties…) par
--    _purge_guests(), appelée par join_as_guest / open_guest_invites + pg_cron (horaire).
-- Erreurs : not_authenticated, invalid_nickname, invalid_avatar, soiree_not_found,
--   guests_closed, already_member, soiree_banned, too_many_guests, not_host, soiree_ended.
-- Pièces 🪙 (cadeaux.sql, non modifié) : _coins compterait les parties d'un invité ; le
-- front n'affiche jamais solde ni boutique à un invité (profil purgé sous 24 h).
-- =============================================================================

alter table public.soirees add column if not exists guest_token text;
create unique index if not exists soirees_guest_token_uq on public.soirees(guest_token)
  where guest_token is not null and status <> 'ended';
create index if not exists profiles_guest_exp_idx on public.profiles(guest_expires_at) where is_guest;

-- Avatars génériques des invités (ids stables, emojis côté front : src/data/guests.ts).
create or replace function public._guest_avatars()
returns text[] language sql immutable
as $$ select array['renard','chat','chien','panda','lapin','grenouille',
                   'licorne','pieuvre','poussin','koala','tigre','singe'] $$;
create or replace function public._guest_ttl()
returns interval language sql immutable as $$ select interval '24 hours' $$;
create or replace function public._guest_max_per_soiree()
returns integer language sql immutable as $$ select 8 $$;

-- Supprime les invités expirés qui ne sont plus dans aucune soirée en cours (jamais hôtes).
create or replace function public._purge_guests()
returns integer language plpgsql security definer
set search_path = public, extensions
as $$
declare v_n integer;
begin
  delete from public.profiles p
   where p.is_guest and p.guest_expires_at < now()
     and not exists (select 1 from public.soiree_players sp join public.soirees s on s.id = sp.soiree_id
                      where sp.profile_id = p.id and s.status <> 'ended')
     and not exists (select 1 from public.soirees s where s.host_id = p.id);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Soirée visée par un code (4 car.) ou un jeton d'invitation ; invitations ouvertes obligatoires.
create or replace function public._guest_soiree_of(p_code text)
returns uuid language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_sid  uuid;
  v_tok  text;
begin
  if char_length(v_code) = 4 then
    select id, guest_token into v_sid, v_tok from public.soirees where code = v_code and status <> 'ended';
  elsif char_length(v_code) between 6 and 32 then
    select id, guest_token into v_sid, v_tok from public.soirees where guest_token = v_code and status <> 'ended';
  end if;
  if v_sid is null then raise exception 'soiree_not_found'; end if;
  if v_tok is null then raise exception 'guests_closed'; end if;
  return v_sid;
end $$;

-- Hôte : ouvre les invitations (jeton stable tant qu'elles restent ouvertes).
-- -> {soiree_id, code, token, guests (nb d'invités présents), max_guests}
create or replace function public.open_guest_invites(p_soiree_id uuid)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me    uuid := public._require_member();
  v_s     public.soirees%rowtype;
  v_alpha constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_tok   text;
begin
  perform public._purge_guests();
  select * into v_s from public.soirees where id = p_soiree_id for update;
  if not found then raise exception 'soiree_not_found'; end if;
  if v_s.host_id <> v_me then raise exception 'not_host'; end if;
  if v_s.status = 'ended' then raise exception 'soiree_ended'; end if;
  v_tok := v_s.guest_token;
  while v_tok is null loop
    select string_agg(substr(v_alpha, 1 + floor(random() * length(v_alpha))::integer, 1), '')
      into v_tok from generate_series(1, 10);
    if exists (select 1 from public.soirees where guest_token = v_tok and status <> 'ended') then
      v_tok := null;
    end if;
  end loop;
  update public.soirees set guest_token = v_tok where id = p_soiree_id;
  return jsonb_build_object(
    'soiree_id', p_soiree_id, 'code', v_s.code, 'token', v_tok,
    'guests', (select count(*) from public.soiree_players sp join public.profiles p on p.id = sp.profile_id
                where sp.soiree_id = p_soiree_id and p.is_guest),
    'max_guests', public._guest_max_per_soiree());
end $$;

-- Hôte : ferme les invitations (les invités déjà présents restent).
create or replace function public.close_guest_invites(p_soiree_id uuid)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
declare v_me uuid := public._require_member();
begin
  update public.soirees set guest_token = null
   where id = p_soiree_id and host_id = v_me and status <> 'ended';
  if not found then raise exception 'not_host'; end if;
end $$;

-- Aperçu avant de rejoindre (écran « Je suis de passage »), session anonyme suffisante.
-- -> {soiree_id, code, host_nickname, host_slug, players, me: 'none'|'guest'|'member', joined}
create or replace function public.guest_invite_info(p_code text)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_sid uuid;
  v_me  uuid;
  v_g   boolean;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  v_sid := public._guest_soiree_of(p_code);
  select p.id, p.is_guest into v_me, v_g
    from public.device_sessions d join public.profiles p on p.id = d.profile_id
   where d.auth_uid = auth.uid();
  return (
    select jsonb_build_object(
      'soiree_id', s.id, 'code', s.code, 'host_nickname', h.nickname, 'host_slug', h.slug,
      'players', (select count(*) from public.soiree_players sp where sp.soiree_id = s.id),
      'me', case when v_me is null then 'none' when v_g then 'guest' else 'member' end,
      'joined', exists (select 1 from public.soiree_players sp where sp.soiree_id = s.id and sp.profile_id = v_me))
    from public.soirees s join public.profiles h on h.id = s.host_id
    where s.id = v_sid);
end $$;

-- Rejoindre en invité. Appareil sans profil -> nouveau profil invité ; appareil déjà invité
-- -> même profil (prénom / avatar mis à jour, expiration repoussée, quitte son ancienne
-- soirée) ; appareil d'un membre de la bande -> already_member (utiliser join_soiree_by_code).
-- -> {profile: ProfileJson, soiree: SoireeJson}
create or replace function public.join_as_guest(p_code text, p_name text, p_avatar text)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_uid   uuid := auth.uid();
  v_name  text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_av    text := lower(btrim(coalesce(p_avatar, '')));
  v_alpha constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  v_sid   uuid;
  v_me    uuid;
  v_g     boolean;
  v_slug  text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if char_length(v_name) < 1 or char_length(v_name) > 20 then raise exception 'invalid_nickname'; end if;
  if not (v_av = any(public._guest_avatars())) then raise exception 'invalid_avatar'; end if;

  perform pg_advisory_xact_lock(hashtext('soiree_membership'));
  perform public._cleanup_stale_soirees();
  perform public._purge_guests();
  v_sid := public._guest_soiree_of(p_code);

  select p.id, p.is_guest into v_me, v_g
    from public.device_sessions d join public.profiles p on p.id = d.profile_id
   where d.auth_uid = v_uid;
  if v_me is not null and not v_g then raise exception 'already_member'; end if;
  if v_me is not null and exists (select 1 from public.soiree_bans where soiree_id = v_sid and profile_id = v_me) then
    raise exception 'soiree_banned';
  end if;
  if (v_me is null or not exists (select 1 from public.soiree_players where soiree_id = v_sid and profile_id = v_me))
     and (select count(*) from public.soiree_players sp join public.profiles p on p.id = sp.profile_id
           where sp.soiree_id = v_sid and p.is_guest) >= public._guest_max_per_soiree() then
    raise exception 'too_many_guests';
  end if;

  loop
    select 'g-' || v_av || '-' || string_agg(substr(v_alpha, 1 + floor(random() * length(v_alpha))::integer, 1), '')
      into v_slug from generate_series(1, 6);
    exit when not exists (select 1 from public.profiles where slug = v_slug);
  end loop;

  if v_me is null then
    insert into public.profiles(slug, first_name, nickname, expressions, sort_order, is_guest, guest_expires_at)
    values (v_slug, v_name, v_name, array['joie'], 1000, true, now() + public._guest_ttl())
    returning id into v_me;
    insert into public.device_sessions(auth_uid, profile_id) values (v_uid, v_me)
    on conflict (auth_uid) do update set profile_id = excluded.profile_id, created_at = now();
  else
    update public.profiles
       set first_name = v_name, nickname = v_name,
           slug = case when slug like 'g-' || v_av || '-%' then slug else v_slug end,
           guest_expires_at = now() + public._guest_ttl()
     where id = v_me;
    -- Un invité n'est que dans une soirée à la fois.
    delete from public.soiree_players sp using public.soirees s
     where sp.profile_id = v_me and s.id = sp.soiree_id and s.id <> v_sid and s.status <> 'ended';
  end if;

  insert into public.soiree_players(soiree_id, profile_id) values (v_sid, v_me) on conflict do nothing;
  return jsonb_build_object('profile', public._profile_json(v_me), 'soiree', public._soiree_json(v_sid));
end $$;

-- Purge horaire (pg_cron si dispo ; sinon purge paresseuse dans les RPC ci-dessus).
do $$
begin
  begin
    perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'guests-purge';
    perform cron.schedule('guests-purge', '23 * * * *', 'select public._purge_guests()');
  exception when others then
    raise notice 'pg_cron indisponible (%) : purge des invités uniquement paresseuse', sqlerrm;
  end;
end $$;

revoke all on function public._require_member() from public, anon, authenticated;
revoke all on function public._guest_avatars() from public, anon, authenticated;
revoke all on function public._guest_ttl() from public, anon, authenticated;
revoke all on function public._guest_max_per_soiree() from public, anon, authenticated;
revoke all on function public._purge_guests() from public, anon, authenticated;
revoke all on function public._guest_soiree_of(text) from public, anon, authenticated;
revoke all on function public.open_guest_invites(uuid) from public, anon;
revoke all on function public.close_guest_invites(uuid) from public, anon;
revoke all on function public.guest_invite_info(text) from public, anon;
revoke all on function public.join_as_guest(text, text, text) from public, anon;
grant execute on function public.open_guest_invites(uuid) to authenticated;
grant execute on function public.close_guest_invites(uuid) to authenticated;
grant execute on function public.guest_invite_info(text) to authenticated;
grant execute on function public.join_as_guest(text, text, text) to authenticated;


-- ===== features\pronos.sql =====
-- =============================================================================
-- PRONOSTICS ENTRE POTES — idempotent, exécuté APRÈS schema.sql (features/*).
-- Avant de lancer un jeu, l'hôte ouvre une « manche de pronostics » (open_pronos) ; chaque joueur
-- de la soirée parie sur le gagnant (set_prono). Au lancement (start_match) le trigger
-- _pronos_attach rattache les paris à la partie. Le résultat n'est JAMAIS stocké : il se calcule
-- à la lecture en joignant match_players.won (aucun jeu ni finish_match n'est touché).
--
-- Règles : un pari par (soirée, joueur), le dernier gagne ; on peut parier sur soi ; égalité ou
-- équipe gagnante = parier sur n'importe quel gagnant est bon ; partie annulée / sans gagnant =
-- pronostics annulés (void) ; une manche non lancée expire au bout de 10 minutes.
--
-- RPC (toutes security definer, grant authenticated) — erreurs entre parenthèses :
--   open_pronos(p_soiree_id, p_game_id, p_player_ids) -> manche        (not_host, soiree_ended,
--       match_in_progress, soiree_not_found, invalid_pronos) ; remet les paris à zéro
--   close_pronos(p_soiree_id)                                          (not_host, soiree_not_found)
--   set_prono(p_soiree_id, p_pick)                                     (not_in_soiree, pronos_closed, invalid_pick)
--   get_pronos(p_soiree_id) -> {round|null, my_pick|null}              (not_in_soiree) ; jamais les paris des autres
--   match_pronos(p_match_id) -> null | {void, picks[{profile_id,pick,ok}]}   (match_not_found, not_in_soiree)
--   soiree_prono_board(p_soiree_id) -> [{profile_id, hits, bets}]      (not_in_soiree)
-- =============================================================================

create table if not exists public.soiree_prono_rounds (
  soiree_id  uuid primary key references public.soirees(id) on delete cascade,
  game_id    text not null,
  player_ids uuid[] not null,
  bets       integer not null default 0,
  opened_at  timestamptz not null default now()
);

create table if not exists public.soiree_pronos (
  id              bigint generated always as identity primary key,
  soiree_id       uuid not null references public.soirees(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  pick_profile_id uuid not null references public.profiles(id) on delete cascade,
  match_id        uuid references public.matches(id) on delete cascade,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists soiree_pronos_open_idx on public.soiree_pronos(soiree_id, profile_id) where match_id is null;
create unique index if not exists soiree_pronos_match_idx on public.soiree_pronos(match_id, profile_id) where match_id is not null;
create index if not exists soiree_pronos_profile_idx on public.soiree_pronos(profile_id);

alter table public.soiree_prono_rounds enable row level security;
alter table public.soiree_pronos enable row level security;
drop policy if exists soiree_prono_rounds_select on public.soiree_prono_rounds;
create policy soiree_prono_rounds_select on public.soiree_prono_rounds for select to authenticated
  using (public.is_soiree_member(soiree_id));
revoke all on table public.soiree_prono_rounds, public.soiree_pronos from anon, authenticated;
grant select on table public.soiree_prono_rounds to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'soiree_prono_rounds') then
    alter publication supabase_realtime add table public.soiree_prono_rounds;
  end if;
end $$;

-- Paris rattachés à une partie TERMINÉE qui a au moins un gagnant et dont le joueur choisi a joué : ok = il a gagné.
create or replace function public._prono_resolved()
returns table(soiree_id uuid, match_id uuid, profile_id uuid, pick uuid, ok boolean, at timestamptz)
language sql stable security definer
set search_path = public, extensions
as $$
  select p.soiree_id, p.match_id, p.profile_id, p.pick_profile_id,
         exists (select 1 from public.match_players w
                  where w.match_id = p.match_id and w.profile_id = p.pick_profile_id and w.won),
         coalesce(m.finished_at, m.created_at)
    from public.soiree_pronos p
    join public.matches m on m.id = p.match_id
   where m.status = 'finished'
     and exists (select 1 from public.match_players w where w.match_id = m.id and w.won)
     -- un pari sur un joueur qui n'a pas joué la partie est annulé (ni raté, ni compté)
     and exists (select 1 from public.match_players w where w.match_id = m.id and w.profile_id = p.pick_profile_id)
$$;

create or replace function public.open_pronos(p_soiree_id uuid, p_game_id text, p_player_ids uuid[])
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me  uuid := public._require_profile();
  v_s   public.soirees%rowtype;
  v_ids uuid[];
  v_r   public.soiree_prono_rounds%rowtype;
begin
  select * into v_s from public.soirees where id = p_soiree_id;
  if not found then raise exception 'soiree_not_found'; end if;
  if v_s.host_id <> v_me then raise exception 'not_host'; end if;
  if v_s.status = 'ended' then raise exception 'soiree_ended'; end if;
  if exists (select 1 from public.matches m where m.soiree_id = p_soiree_id and m.status in ('lobby', 'playing')) then
    raise exception 'match_in_progress';
  end if;
  v_ids := array(select distinct x from unnest(coalesce(p_player_ids, '{}')) x);
  if coalesce(p_game_id, '') !~ '^[a-z0-9_-]{1,40}$' or coalesce(array_length(v_ids, 1), 0) < 2
     or exists (select 1 from unnest(v_ids) x
                 where not exists (select 1 from public.soiree_players sp where sp.soiree_id = p_soiree_id and sp.profile_id = x)) then
    raise exception 'invalid_pronos';
  end if;
  delete from public.soiree_pronos where soiree_id = p_soiree_id and match_id is null;
  insert into public.soiree_prono_rounds(soiree_id, game_id, player_ids, bets, opened_at)
  values (p_soiree_id, p_game_id, v_ids, 0, now())
  on conflict (soiree_id) do update
    set game_id = excluded.game_id, player_ids = excluded.player_ids, bets = 0, opened_at = now()
  returning * into v_r;
  return to_jsonb(v_r);
end $$;

create or replace function public.close_pronos(p_soiree_id uuid)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := public._require_profile();
  v_h  uuid;
begin
  select host_id into v_h from public.soirees where id = p_soiree_id;
  if not found then raise exception 'soiree_not_found'; end if;
  if v_h <> v_me then raise exception 'not_host'; end if;
  delete from public.soiree_pronos where soiree_id = p_soiree_id and match_id is null;
  delete from public.soiree_prono_rounds where soiree_id = p_soiree_id;
end $$;

create or replace function public.set_prono(p_soiree_id uuid, p_pick uuid)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := public._require_profile();
  v_r  public.soiree_prono_rounds%rowtype;
begin
  if not public.is_soiree_member(p_soiree_id) then raise exception 'not_in_soiree'; end if;
  select * into v_r from public.soiree_prono_rounds where soiree_id = p_soiree_id for update;
  if not found or v_r.opened_at < now() - interval '10 minutes' then raise exception 'pronos_closed'; end if;
  if not (p_pick = any (v_r.player_ids)) then raise exception 'invalid_pick'; end if;
  insert into public.soiree_pronos(soiree_id, profile_id, pick_profile_id)
  values (p_soiree_id, v_me, p_pick)
  on conflict (soiree_id, profile_id) where match_id is null
  do update set pick_profile_id = excluded.pick_profile_id, updated_at = now();
  update public.soiree_prono_rounds
     set bets = (select count(*) from public.soiree_pronos where soiree_id = p_soiree_id and match_id is null)
   where soiree_id = p_soiree_id;
end $$;

create or replace function public.get_pronos(p_soiree_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := public._require_profile();
  v_r  public.soiree_prono_rounds%rowtype;
begin
  if not public.is_soiree_member(p_soiree_id) then raise exception 'not_in_soiree'; end if;
  select * into v_r from public.soiree_prono_rounds where soiree_id = p_soiree_id;
  if not found or v_r.opened_at < now() - interval '10 minutes' then
    return jsonb_build_object('round', null, 'my_pick', null);
  end if;
  return jsonb_build_object(
    'round', to_jsonb(v_r),
    'my_pick', (select pick_profile_id from public.soiree_pronos
                 where soiree_id = p_soiree_id and profile_id = v_me and match_id is null));
end $$;

-- Résultat d'une partie : void = pas terminée / annulée / sans gagnant (picks vide : rien n'est révélé).
create or replace function public.match_pronos(p_match_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_m    public.matches%rowtype;
  v_void boolean;
begin
  select * into v_m from public.matches where id = p_match_id;
  if not found then raise exception 'match_not_found'; end if;
  if v_m.soiree_id is null or not public.is_soiree_member(v_m.soiree_id) then raise exception 'not_in_soiree'; end if;
  if not exists (select 1 from public.soiree_pronos where match_id = p_match_id) then return null; end if;
  v_void := not (v_m.status = 'finished'
                 and exists (select 1 from public.match_players w where w.match_id = p_match_id and w.won));
  if v_void then return jsonb_build_object('void', true, 'picks', '[]'::jsonb); end if;
  return jsonb_build_object('void', false, 'picks', (
    select coalesce(jsonb_agg(jsonb_build_object('profile_id', r.profile_id, 'pick', r.pick, 'ok', r.ok)
                              order by pr.sort_order), '[]'::jsonb)
      from public._prono_resolved() r join public.profiles pr on pr.id = r.profile_id
     where r.match_id = p_match_id));
end $$;

create or replace function public.soiree_prono_board(p_soiree_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
begin
  if not public.is_soiree_member(p_soiree_id) then raise exception 'not_in_soiree'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('profile_id', b.profile_id, 'hits', b.hits, 'bets', b.bets)
                     order by b.hits desc, b.bets, b.sort_order)
      from (select r.profile_id, count(*) filter (where r.ok)::int as hits, count(*)::int as bets, pr.sort_order
              from public._prono_resolved() r join public.profiles pr on pr.id = r.profile_id
             where r.soiree_id = p_soiree_id
             group by r.profile_id, pr.sort_order) b), '[]'::jsonb);
end $$;

-- Une partie est créée : les paris ouverts de la soirée lui sont rattachés si le jeu est celui de la
-- manche ; sinon ils sont jetés. Dans tous les cas la manche est refermée.
create or replace function public._pronos_attach()
returns trigger language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_game text;
begin
  if new.soiree_id is null then return new; end if;
  select game_id into v_game from public.soiree_prono_rounds where soiree_id = new.soiree_id;
  if found and v_game = new.game_id then
    update public.soiree_pronos set match_id = new.id, updated_at = now()
     where soiree_id = new.soiree_id and match_id is null;
  end if;
  delete from public.soiree_pronos where soiree_id = new.soiree_id and match_id is null;
  delete from public.soiree_prono_rounds where soiree_id = new.soiree_id;
  return new;
end $$;
drop trigger if exists matches_pronos_attach on public.matches;
create trigger matches_pronos_attach after insert on public.matches
  for each row execute function public._pronos_attach();

revoke all on function public._prono_resolved() from public, anon, authenticated;
revoke all on function public._pronos_attach() from public, anon, authenticated;
revoke all on function public.open_pronos(uuid, text, uuid[]) from public, anon;
revoke all on function public.close_pronos(uuid) from public, anon;
revoke all on function public.set_prono(uuid, uuid) from public, anon;
revoke all on function public.get_pronos(uuid) from public, anon;
revoke all on function public.match_pronos(uuid) from public, anon;
revoke all on function public.soiree_prono_board(uuid) from public, anon;
grant execute on function public.open_pronos(uuid, text, uuid[]) to authenticated;
grant execute on function public.close_pronos(uuid) to authenticated;
grant execute on function public.set_prono(uuid, uuid) to authenticated;
grant execute on function public.get_pronos(uuid) to authenticated;
grant execute on function public.match_pronos(uuid) to authenticated;
grant execute on function public.soiree_prono_board(uuid) to authenticated;


-- ===== features\push.sql =====
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
-- Invitations « X t'invite a sa soiree » : voir supabase/features/push_invites.sql (URL deduite de reminder_url).
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


-- ===== features\push_invites.sql =====
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
