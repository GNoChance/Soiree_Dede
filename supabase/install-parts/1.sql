-- MORCEAU 1 / 6 — -- GÉNÉRÉ par scripts/build-sql.mjs — ne pas éditer. Idempotent. À exécuter dans l'ordre (1, puis 2…) dans Supabase > SQL Editor > Run.

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
  -- Profil invité : lié à son seul téléphone (pas de PIN), jamais accessible par connexion.
  if not found or v_prof.is_guest then
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
  perform set_config('app.aborted_by', v_me::text, true);  -- parties en cours coupées par l'hôte (cf. mises)
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
  v_by     jsonb := p_options->'authors';   -- optionnel : id du profil auteur par question (cartes maison), null = carte de base
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
  -- Auteurs alignés sur les questions (uuid valide ou null).
  select jsonb_agg(case when jsonb_typeof(case when jsonb_typeof(v_by) = 'array' then v_by->(o - 1) end) = 'string'
                         and (v_by->>(o - 1)) ~ '^[0-9a-f-]{36}$' then v_by->(o - 1) else 'null'::jsonb end order by o)
    into v_by
    from generate_series(1, v_rounds) o;
  select jsonb_object_agg(p::text, 0) into v_zero from unnest(p_players) p;

  return jsonb_build_object(
    'state', jsonb_build_object(
      'game', 'qui-de-nous',
      'phase', 'voting',
      'round', 1,
      'total_rounds', v_rounds,
      'question', v_q->>0,
      'question_by', v_by->0,
      'players', to_jsonb(p_players),
      'voters', '[]'::jsonb,
      'deadline', to_jsonb(now() + interval '45 seconds'),   -- fin du vote : révélation auto (tick)
      'scores', v_zero,
      'designated', v_zero,
      'last_reveal', null,
      'history', '[]'::jsonb,
      'winners', null,
      'results', null),
    'server', jsonb_build_object('questions', v_q, 'authors', v_by, 'votes', '{}'::jsonb),
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
  v_nvotes  integer;
begin
  select coalesce(jsonb_object_agg(t.target, t.c), '{}'::jsonb), coalesce(max(t.c), 0)
    into v_counts, v_max
    from (select value as target, count(*)::integer as c
            from jsonb_each_text(v_votes) group by value) t;

  v_maj := array(select key from jsonb_each_text(v_counts)
                  where v_max > 0 and value::integer = v_max order by key);
  -- « Triangle » : chacun désigné une seule fois (max = 1) avec >= 3 ex-aequo -> pas de majorité.
  if v_max = 1 and cardinality(v_maj) >= 3 then v_maj := '{}'; end if;
  v_scorers := array(select key from jsonb_each_text(v_votes) where value = any(v_maj) order by key);
  v_nvotes := (select count(*)::integer from jsonb_each_text(v_votes));

  p_state := p_state || jsonb_build_object(
    'phase', 'reveal',
    -- suite auto : le temps du dépouillement animé (~1 s par vote) + ~15 s de lecture
    'deadline', to_jsonb(now() + make_interval(secs => 16 + v_nvotes)),
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

  p_state := p_state || jsonb_build_object('phase', 'finished', 'deadline', null, 'winners', v_winners, 'results', v_results);
  return jsonb_build_object('state', p_state, 'server', p_server, 'results', v_results);
end $$;

-- Manche suivante (ou fin de partie) depuis la phase reveal : « next » de l'hôte ou tick.
create or replace function public._qdn_advance(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_round integer := (p_state->>'round')::integer;
begin
  if v_round >= (p_state->>'total_rounds')::integer then
    return public._qdn_finish(p_state, p_server);
  end if;
  p_state := p_state || jsonb_build_object(
    'phase', 'voting', 'round', v_round + 1,
    'question', p_server->'questions'->>v_round,   -- index 0-based = manche suivante
    'question_by', coalesce(p_server->'authors'->v_round, 'null'::jsonb),
    'voters', '[]'::jsonb,
    'deadline', to_jsonb(now() + interval '45 seconds'));
  p_server := jsonb_set(p_server, '{votes}', '{}'::jsonb);
  return jsonb_build_object('state', p_state, 'server', p_server);
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
  v_actor  text := p_actor::text;
  v_res    jsonb;
  v_dl     timestamptz := nullif(p_state->>'deadline', '')::timestamptz;
begin
  if v_type = 'tick' then
    -- Idempotent : ignoré si trop tôt, sans échéance (vieille partie) ou hors phase.
    if v_dl is null or now() < v_dl or v_phase not in ('voting', 'reveal') then
      return jsonb_build_object('state', p_state, 'server', p_server);
    end if;
    if v_phase = 'voting' then return public._qdn_reveal(p_state, p_server); end if;
    return public._qdn_advance(p_state, p_server);

  elsif v_type = 'vote' then
    if v_phase <> 'voting' then raise exception 'wrong_phase'; end if;
    if not (p_state->'players' ? p_actor::text) then raise exception 'not_a_player'; end if;
    begin
      v_target := (p_action->>'target')::uuid::text;
    exception when others then
      raise exception 'invalid_target';
    end;
    if v_target is null or not (p_state->'players' ? v_target) then raise exception 'invalid_target'; end if;
    if v_target = p_actor::text then raise exception 'cannot_vote_self'; end if;

    p_server := jsonb_set(p_server, array['votes', v_actor], to_jsonb(v_target), true);
    select coalesce(jsonb_agg(pl order by o), '[]'::jsonb) into v_voters
      from jsonb_array_elements_text(p_state->'players') with ordinality as t(pl, o)
     where (p_server->'votes') ? pl;
    p_state := jsonb_set(p_state, '{voters}', v_voters);

    if jsonb_array_length(v_voters) >= jsonb_array_length(p_state->'players') then
      v_res := public._qdn_reveal(p_state, p_server);
    else
      v_res := jsonb_build_object('state', p_state, 'server', p_server);
    end if;
    -- Mon vote, relisible après rechargement (match_secrets).
    return v_res || jsonb_build_object('secrets', jsonb_build_object(
      v_actor, jsonb_build_object('round', v_round, 'target', v_target)));

  elsif v_type = 'reveal' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase <> 'voting' then raise exception 'wrong_phase'; end if;
    return public._qdn_reveal(p_state, p_server);

  elsif v_type = 'next' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase <> 'reveal' then raise exception 'wrong_phase'; end if;
    return public._qdn_advance(p_state, p_server);

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
      'spoken', '[]'::jsonb,
      'setup', jsonb_build_object('civils', v_n - v_n_uc - (case when v_mw then 1 else 0 end),
                                  'undercovers', v_n_uc, 'mister_white', v_mw),
      'voters', '[]'::jsonb,
      'candidates', '[]'::jsonb,
      'revote', false,
      'deadline', null,
      'vote_unlock', to_jsonb(now() + interval '90 seconds'),   -- après : tout joueur vivant peut lancer le vote
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
    'deadline', null,
    'winner', p_winner,
    'words', jsonb_build_object('civil', p_server->>'civil_word', 'undercover', p_server->>'undercover_word'),
    'roles', v_roles,
    -- révélé seulement en fin de partie : qui a voté pour qui, un tableau {votant: cible} par dépouillement
    'vote_log', coalesce(p_server->'vote_log', '[]'::jsonb),
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
      'deadline', to_jsonb(now() + interval '60 seconds'),
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
    -- devinette de Mister White : 45 s ; écran d'élimination : suite auto après 20 s
    'deadline', to_jsonb(now() + case when v_role = 'mrwhite' then interval '45 seconds' else interval '20 seconds' end),
    'last_vote', jsonb_build_object('round', p_state->'round', 'votes', v_votes, 'counts', v_counts,
                                    'outcome', v_outcome, 'tied', to_jsonb(v_tied)));
  p_server := jsonb_set(p_server, '{votes}', '{}'::jsonb);
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Fin de l'écran d'élimination : victoire, ou manche de description suivante.
create or replace function public._uc_next(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_civ     integer;
  v_inf     integer;
  v_order   text[];
  v_n       integer;
  v_idx     integer;
  v_starter text;
  j         integer;
begin
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
    'spoken', '[]'::jsonb,
    'current_elimination', null,
    'mrwhite_guess', null,
    'voters', '[]'::jsonb,
    'candidates', '[]'::jsonb,
    'revote', false,
    'deadline', null,
    'vote_unlock', to_jsonb(now() + interval '90 seconds'));
  p_server := jsonb_set(p_server, '{votes}', '{}'::jsonb);
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Orateur courant : premier joueur vivant, dans l'ordre de parole (à partir du starter), absent de 'spoken'.
create or replace function public._uc_speaker(p_state jsonb)
returns text language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_order text[] := array(select jsonb_array_elements_text(p_state->'order'));
  v_n     integer := cardinality(v_order);
  v_idx   integer := coalesce(array_position(v_order, p_state->>'starter'), 1);
  v_id    text;
  j       integer;
begin
  for j in 0 .. v_n - 1 loop
    v_id := v_order[((v_idx - 1 + j) % v_n) + 1];
    if (p_state->'alive') ? v_id and not (coalesce(p_state->'spoken', '[]'::jsonb) ? v_id) then
      return v_id;
    end if;
  end loop;
  return null;
end $$;

-- Ouvre le vote (host, ou joueur vivant après le délai de description).
create or replace function public._uc_open_vote(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
begin
  p_state := p_state || jsonb_build_object(
    'phase', 'vote', 'revote', false, 'candidates', p_state->'alive', 'voters', '[]'::jsonb,
    'deadline', to_jsonb(now() + interval '60 seconds'));
  p_server := jsonb_set(p_server, '{votes}', '{}'::jsonb);
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Mister White n'a pas trouvé (refus, ou délai écoulé) : écran d'élimination, suite auto après 20 s.
create or replace function public._uc_guess_failed(p_state jsonb, p_server jsonb, p_word text)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
begin
  p_state := p_state || jsonb_build_object(
    'phase', 'elimination',
    'deadline', to_jsonb(now() + interval '20 seconds'),
    'mrwhite_guess', jsonb_build_object('profile_id', p_state->'current_elimination'->>'profile_id',
                                        'word', p_word, 'correct', false));
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
  v_dl      timestamptz := nullif(p_state->>'deadline', '')::timestamptz;
  v_unlock  timestamptz := nullif(p_state->>'vote_unlock', '')::timestamptz;
begin
  if v_type = 'tick' then
    -- Idempotent : ignoré si trop tôt, sans échéance (vieille partie) ou hors phase.
    if v_dl is null or now() < v_dl then
      return jsonb_build_object('state', p_state, 'server', p_server);
    end if;
    if v_phase = 'vote' then return public._uc_tally(p_state, p_server); end if;
    if v_phase = 'mrwhite_guess' then return public._uc_guess_failed(p_state, p_server, null); end if;
    if v_phase = 'elimination' then return public._uc_next(p_state, p_server); end if;
    return jsonb_build_object('state', p_state, 'server', p_server);

  elsif v_type = 'start_vote' then
    if v_phase <> 'describe' then raise exception 'wrong_phase'; end if;
    -- L'hôte à tout moment ; un joueur vivant seulement une fois le délai de description écoulé.
    if not p_is_host then
      if not ((p_state->'alive') ? v_actor) then raise exception 'not_host'; end if;
      -- Tout le monde a parlé (ordre de parole terminé) : plus besoin d'attendre.
      if not (p_state ? 'spoken' and public._uc_speaker(p_state) is null)
         and v_unlock is not null and now() < v_unlock then raise exception 'not_host'; end if;
    end if;
    return public._uc_open_vote(p_state, p_server);

  elsif v_type = 'spoke' then
    -- « J'ai parlé » : l'orateur courant (ou l'hôte à sa place) passe au suivant. Idempotent.
    if v_phase <> 'describe' then raise exception 'wrong_phase'; end if;
    v_target := coalesce(nullif(p_action->>'player', ''), public._uc_speaker(p_state));
    if v_target is null or not ((p_state->'alive') ? v_target)
       or (coalesce(p_state->'spoken', '[]'::jsonb) ? v_target) then
      return jsonb_build_object('state', p_state, 'server', p_server);
    end if;
    if v_target <> v_actor and not p_is_host then raise exception 'not_host'; end if;
    p_state := jsonb_set(p_state, '{spoken}', coalesce(p_state->'spoken', '[]'::jsonb) || to_jsonb(v_target), true);
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
    return public._uc_guess_failed(p_state, p_server, v_guess);

  elsif v_type = 'skip_guess' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase <> 'mrwhite_guess' then raise exception 'wrong_phase'; end if;
    return public._uc_guess_failed(p_state, p_server, null);

  elsif v_type = 'next' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase <> 'elimination' then raise exception 'wrong_phase'; end if;
    return public._uc_next(p_state, p_server);

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
    -- Qui annule (lu par le règlement des mises : pari de l'hôte perdu, défi = abandon).
    perform set_config('app.aborted_by', v_me::text, true);
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
revoke all on function public._qdn_advance(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.game_qui_de_nous_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;
revoke all on function public.game_undercover_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public._uc_finish(jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public._uc_tally(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._uc_next(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._uc_open_vote(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._uc_speaker(jsonb) from public, anon, authenticated;
revoke all on function public._uc_guess_failed(jsonb, jsonb, text) from public, anon, authenticated;
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


-- ===== features\album.sql =====
-- =============================================================================
-- ALBUM SOUVENIR — idempotent, exécuté en features/* (les fonctions référencent recap / stats / trophées
-- à l'exécution seulement, l'ordre alphabétique de chargement n'a donc pas d'importance).
-- Une soirée terminée = une page d'album. `album_year(p_year)` renvoie, en un appel, toutes les soirées
-- TERMINÉES de l'année (Europe/Paris) auxquelles l'appelant a participé (hôte, membre ou joueur d'une partie),
-- de la plus ancienne à la plus récente (max 150) :
--   { year, soirees:[ { soiree_id, started_at, ended_at, duration_min, host:{...}|null,
--       games_played, distinct_games, players:[...], games:[{game_id,played}],
--       matches:[{game_id, finished_at, winners:[{profile_id,slug,nickname,equipped_tenue}]}],
--       standings:[...], winner_ids:[...], awards:[...],
--       highlights:{
--         margin: {profile_id, points, lead} | null     -- plus grosse victoire (écart sur le 2e)
--         trophies: [{profile_id, name}]                -- trophées débloqués pendant la soirée (6 max)
--         words: [{profile_id, text, category, letter}] -- mots uniques du Petit Bac (dernière manche, 3 max)
--         dilemma: {a, b, count_a, count_b} | null      -- dilemme « Tu préfères » le plus partagé (>= 3 votes)
--       } } ] }
-- Aucune table : tout est lu dans soiree_recaps / matches.state / trophy_unlocks.
-- Erreur : album_invalid_year.
-- =============================================================================

create or replace function public._album_soiree(p_soiree_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  s          public.soirees%rowtype;
  v_rec      jsonb;
  v_st       jsonb;
  v_matches  jsonb;
  v_margin   jsonb;
  v_trophies jsonb;
  v_words    jsonb;
  v_dil      jsonb;
begin
  select * into s from public.soirees where id = p_soiree_id;
  if not found then return null; end if;
  select data into v_rec from public.soiree_recaps where soiree_id = s.id;
  if v_rec is null then v_rec := public._soiree_recap_compute(s.id); end if;
  v_st := public._soiree_standings(s.id);

  select coalesce(jsonb_agg(jsonb_build_object('game_id', m.game_id, 'finished_at', m.finished_at,
           'winners', coalesce((select jsonb_agg(jsonb_build_object('profile_id', p.id, 'slug', p.slug, 'nickname', p.nickname,
                                   'equipped_tenue', p.equipped_tenue) order by p.sort_order)
                                  from public.match_players x join public.profiles p on p.id = x.profile_id
                                 where x.match_id = m.id and x.won), '[]'::jsonb))
         order by m.finished_at, m.id), '[]'::jsonb)
    into v_matches
    from public.matches m
   where m.soiree_id = s.id and m.status = 'finished'
     and exists (select 1 from public.match_players x where x.match_id = m.id);

  -- plus grosse victoire : écart de points entre le 1er et le 2e (>= 1 point d'avance)
  select jsonb_build_object('profile_id', a->>'profile_id', 'points', (a->>'points')::int,
                            'lead', (a->>'points')::int - coalesce((b->>'points')::int, 0))
    into v_margin
    from (select v_st->0 as a, v_st->1 as b) t
   where jsonb_array_length(v_st) >= 2 and (a->>'points')::int > 0 and (a->>'rank')::int = 1
     and (a->>'points')::int - coalesce((b->>'points')::int, 0) >= 1;

  select coalesce(jsonb_agg(jsonb_build_object('profile_id', t.profile_id, 'name', t.name) order by t.at), '[]'::jsonb)
    into v_trophies
    from (select u.profile_id, tr.name, u.unlocked_at as at
            from public.trophy_unlocks u join public.trophies tr on tr.id = u.trophy_id
           where u.unlocked_at >= coalesce(s.started_at, s.created_at)
             and u.unlocked_at <= coalesce(s.ended_at, now()) + interval '5 minutes'
             and u.profile_id in (select profile_id from public.soiree_players where soiree_id = s.id
                                  union select x.profile_id from public.match_players x join public.matches m on m.id = x.match_id
                                         where m.soiree_id = s.id)
           order by u.unlocked_at limit 6) t;

  -- Petit Bac : mots uniques (2 pts) de la dernière manche de chaque partie, les plus longs d'abord
  select coalesce(jsonb_agg(jsonb_build_object('profile_id', w.pl, 'text', w.txt, 'category', w.cat, 'letter', w.letter)
                            order by w.len desc, w.txt), '[]'::jsonb)
    into v_words
    from (select pl.key as pl, pl.value->>'text' as txt, length(pl.value->>'text') as len,
                 coalesce((select c->>'label' from jsonb_array_elements(m.state->'categories') c where c->>'id' = cat.key), cat.key) as cat,
                 m.state#>>'{last_round,letter}' as letter
            from public.matches m,
                 jsonb_each(coalesce(m.state#>'{last_round,detail}', '{}'::jsonb)) cat,
                 jsonb_each(cat.value) pl
           where m.soiree_id = s.id and m.game_id = 'petit-bac' and m.status = 'finished'
             and pl.value->>'status' = 'unique' and length(coalesce(pl.value->>'text', '')) >= 3
           order by length(pl.value->>'text') desc, pl.value->>'text' limit 3) w;

  -- Tu préfères : le dilemme qui a le plus divisé le groupe
  select jsonb_build_object('a', h.e#>>'{dilemma,a}', 'b', h.e#>>'{dilemma,b}',
                            'count_a', (h.e#>>'{counts,a}')::int, 'count_b', (h.e#>>'{counts,b}')::int)
    into v_dil
    from (select e from public.matches m, jsonb_array_elements(coalesce(m.state->'history', '[]'::jsonb)) e
           where m.soiree_id = s.id and m.game_id = 'tu-preferes' and m.status = 'finished'
             and coalesce((e#>>'{counts,a}')::int, 0) + coalesce((e#>>'{counts,b}')::int, 0) >= 3
             and e#>>'{dilemma,a}' is not null
           order by abs(coalesce((e#>>'{counts,a}')::int, 0) - coalesce((e#>>'{counts,b}')::int, 0)),
                    e#>>'{dilemma,a}'
           limit 1) h;

  return jsonb_build_object(
    'soiree_id', s.id, 'started_at', coalesce(s.started_at, s.created_at), 'ended_at', s.ended_at,
    'duration_min', v_rec->'duration_min',
    'host', (select jsonb_build_object('id', p.id, 'slug', p.slug, 'nickname', p.nickname, 'equipped_tenue', p.equipped_tenue)
               from public.profiles p where p.id = s.host_id),
    'games_played', v_rec->'games_played', 'distinct_games', v_rec->'distinct_games',
    'players', v_rec->'players', 'games', v_rec->'games', 'awards', v_rec->'awards',
    'matches', v_matches, 'standings', v_st,
    'winner_ids', coalesce((select jsonb_agg(e->'profile_id') from jsonb_array_elements(v_st) e
                             where (e->>'rank')::int = 1 and (e->>'points')::int > 0), '[]'::jsonb),
    'highlights', jsonb_build_object('margin', v_margin, 'trophies', v_trophies, 'words', v_words, 'dilemma', v_dil));
end $$;

create or replace function public.album_year(p_year integer)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_me   uuid := public._require_profile();
  v_from timestamptz;
  v_to   timestamptz;
begin
  if p_year is null or p_year < 2024 or p_year > 2100 then raise exception 'album_invalid_year'; end if;
  v_from := make_timestamptz(p_year, 1, 1, 0, 0, 0, 'Europe/Paris');
  v_to   := make_timestamptz(p_year + 1, 1, 1, 0, 0, 0, 'Europe/Paris');
  return jsonb_build_object('year', p_year, 'soirees', coalesce((
    select jsonb_agg(public._album_soiree(z.id) order by z.at, z.id)
      from (select s.id, coalesce(s.started_at, s.created_at) as at
              from public.soirees s
             where s.status = 'ended'
               and coalesce(s.started_at, s.created_at) >= v_from and coalesce(s.started_at, s.created_at) < v_to
               and (s.host_id = v_me
                    or exists (select 1 from public.soiree_players sp where sp.soiree_id = s.id and sp.profile_id = v_me)
                    or exists (select 1 from public.match_players x join public.matches m on m.id = x.match_id
                                where m.soiree_id = s.id and x.profile_id = v_me))
             order by 2, 1 limit 150) z), '[]'::jsonb));
end $$;

revoke all on function public._album_soiree(uuid) from public, anon, authenticated;
revoke all on function public.album_year(integer) from public, anon;
grant execute on function public.album_year(integer) to authenticated;


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
-- Saisons de boutique (features/saisons.sql) : season = saison de l'article ; pass_tier non null = exclusif du
-- passe de saison (palier 5/10/15/20, jamais vendu, price null) ; sinon article de la collection limitee (price non null).
alter table public.items add column if not exists season text;
alter table public.items add column if not exists pass_tier integer;
alter table public.items drop constraint if exists items_season_check;
alter table public.items add constraint items_season_check check (season is null or season in ('hiver', 'printemps', 'ete', 'automne'));
alter table public.items drop constraint if exists items_slot_check;
alter table public.items add constraint items_slot_check check (slot in ('frame', 'title', 'kart', 'golf_ball', 'bowling_ball', 'chess', 'card_back', 'dice', 'marks', 'fx_avatar', 'fx_entree', 'fx_victoire', 'fx_salon'));
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
  ('bb_ubb', 'bowling_ball', 'Boule ovale', null, null, null, 250),
  -- echecs et effets en boutique (2026-11-27)
  ('c_bois', 'chess', 'Pièces en bois', null, null, null, 100),
  ('c_bonbon', 'chess', 'Pièces bonbon', null, null, null, 250),
  ('c_neon', 'chess', 'Pièces néon', null, null, null, 250),
  ('c_or', 'chess', 'Or et onyx', null, null, null, 500),
  ('fx_coeurs', 'fx_avatar', 'Cœurs qui s’envolent', null, null, null, 250),
  ('fx_etincelles', 'fx_avatar', 'Étincelles', null, null, null, 250),
  ('fx_billets', 'fx_avatar', 'Pluie de billets', null, null, null, 500),
  ('fx_skate', 'fx_entree', 'Entrée en skate', null, null, null, 250),
  ('fx_fusee', 'fx_entree', 'Entrée en fusée', null, null, null, 500),
  ('fx_licorne', 'fx_entree', 'Entrée à dos de licorne', null, null, null, 500),
  ('fx_v_ballons', 'fx_victoire', 'Lâcher de ballons', null, null, null, 250),
  ('fx_v_pizzas', 'fx_victoire', 'Pluie de pizzas', null, null, null, 250),
  ('fx_v_billets', 'fx_victoire', 'Jackpot', null, null, null, 500),
  ('fx_salon_bulles', 'fx_salon', 'Salon à bulles', null, null, null, 250),
  ('fx_salon_confettis', 'fx_salon', 'Salon en fête', null, null, null, 250),
  ('fx_salon_disco', 'fx_salon', 'Salon disco', null, null, null, 500)
on conflict (id) do update set slot = excluded.slot, label = excluded.label,
  advent_day = excluded.advent_day, advent_count = excluded.advent_count, rule = excluded.rule, price = excluded.price;

-- Saisons : collections limitees (price + season) et exclusifs du passe (season + pass_tier, sans prix).
insert into public.items(id, slot, label, price, season, pass_tier) values
  ('t_tout_schuss', 'title', 'Tout schuss', 100, 'hiver', null),
  ('t_raclette', 'title', 'Team raclette', 100, 'hiver', null),
  ('k_glacier', 'kart', 'Bleu glacier', 100, 'hiver', null),
  ('f_bonnet', 'frame', 'Bonnet à pompon', 250, 'hiver', null),
  ('cb_pull_moche', 'card_back', 'Pull moche', 250, 'hiver', null),
  ('d_chocolat_chaud', 'dice', 'Dés chocolat chaud', 250, 'hiver', null),
  ('gb_boule_neige', 'golf_ball', 'Balle boule de neige', 250, 'hiver', null),
  ('m_givre', 'marks', 'Givre', 500, 'hiver', null),
  ('f_blizzard', 'frame', 'Blizzard', 500, 'hiver', null),
  ('t_poisson_avril', 'title', 'Poisson d’avril permanent', 100, 'printemps', null),
  ('t_allergique', 'title', 'Allergique à la défaite', 100, 'printemps', null),
  ('gb_oeuf', 'golf_ball', 'Balle œuf en chocolat', 100, 'printemps', null),
  ('f_potager', 'frame', 'Potager du dimanche', 250, 'printemps', null),
  ('cb_pique_nique', 'card_back', 'Nappe de pique-nique', 250, 'printemps', null),
  ('d_poussin', 'dice', 'Dés poussin', 250, 'printemps', null),
  ('k_coccinelle', 'kart', 'Rouge coccinelle', 250, 'printemps', null),
  ('m_herbe', 'marks', 'Herbe fraîche', 500, 'printemps', null),
  ('f_giboulees', 'frame', 'Giboulées', 500, 'printemps', null),
  ('t_coup_soleil', 'title', 'Coup de soleil intégral', 100, 'ete', null),
  ('t_tong', 'title', 'Tong gauche perdue', 100, 'ete', null),
  ('bb_petanque', 'bowling_ball', 'Boule de pétanque', 100, 'ete', null),
  ('cb_transat', 'card_back', 'Transat', 250, 'ete', null),
  ('d_piscine', 'dice', 'Dés piscine', 250, 'ete', null),
  ('k_canard', 'kart', 'Jaune bouée canard', 250, 'ete', null),
  ('f_bouee', 'frame', 'Bouée de sauvetage', 250, 'ete', null),
  ('m_fluo', 'marks', 'Bracelet fluo', 500, 'ete', null),
  ('f_coucher_soleil', 'frame', 'Coucher de soleil', 500, 'ete', null),
  ('t_cartable', 'title', 'Cartable trop lourd', 100, 'automne', null),
  ('t_bonbon_ou_gage', 'title', 'Un bonbon ou un gage', 100, 'automne', null),
  ('gb_citrouille', 'golf_ball', 'Balle citrouille', 100, 'automne', null),
  ('f_feuilles', 'frame', 'Feuilles mortes', 250, 'automne', null),
  ('cb_toile', 'card_back', 'Toile d’araignée', 250, 'automne', null),
  ('d_potion', 'dice', 'Dés potion', 250, 'automne', null),
  ('k_sorciere', 'kart', 'Violet balai volant', 250, 'automne', null),
  ('m_fantome', 'marks', 'Fantôme', 500, 'automne', null),
  ('f_pleine_lune', 'frame', 'Pleine lune', 500, 'automne', null),
  ('bb_bucheron', 'bowling_ball', 'Boule bûcheron', null, 'hiver', 5),
  ('f_forfait', 'frame', 'Forfait saison', null, 'hiver', 10),
  ('cb_chalet', 'card_back', 'Nuit au chalet', null, 'hiver', 15),
  ('t_yeti', 'title', 'Yéti de salon', null, 'hiver', 20),
  ('d_menthe_eau', 'dice', 'Dés menthe à l’eau', null, 'printemps', 5),
  ('f_nid', 'frame', 'Nid douillet', null, 'printemps', 10),
  ('bb_tulipe', 'bowling_ball', 'Boule tulipe', null, 'printemps', 15),
  ('t_jeune_pousse', 'title', 'Jeune pousse pleine d’avenir', null, 'printemps', 20),
  ('gb_ballon_plage', 'golf_ball', 'Balle ballon de plage', null, 'ete', 5),
  ('f_glaces', 'frame', 'Marchand de glaces', null, 'ete', 10),
  ('cb_barbecue', 'card_back', 'Barbecue', null, 'ete', 15),
  ('t_legende_camping', 'title', 'Légende du camping', null, 'ete', 20),
  ('bb_chataigne', 'bowling_ball', 'Boule châtaigne', null, 'automne', 5),
  ('f_citrouilles', 'frame', 'Champ de citrouilles', null, 'automne', 10),
  ('d_champignon', 'dice', 'Dés champignon', null, 'automne', 15),
  ('t_terreur_soirees', 'title', 'Terreur des soirées', null, 'automne', 20)
on conflict (id) do update set slot = excluded.slot, label = excluded.label, price = excluded.price,
  season = excluded.season, pass_tier = excluded.pass_tier;

-- Événement de Noël (noel.sql) : exclusifs du Pass de Noël (event_tier) et de la Grande Hotte (band_tier),
-- jamais vendus. Miroir de src/data/cadeaux.ts.
alter table public.items add column if not exists event text;
alter table public.items add column if not exists event_tier integer;
alter table public.items add column if not exists band_tier integer;
insert into public.items(id, slot, label, event, event_tier, band_tier) values
  ('t_lutin_chef', 'title', 'Lutin en chef', 'noel', 3, null),
  ('cb_papier_cadeau', 'card_back', 'Papier cadeau', 'noel', 6, null),
  ('d_sucre_orge', 'dice', 'Dés sucre d’orge', 'noel', 9, null),
  ('k_noel_traineau', 'kart', 'Traîneau rouge', 'noel', 12, null),
  ('gb_boule_noel', 'golf_ball', 'Boule de Noël', 'noel', 15, null),
  ('bb_buche', 'bowling_ball', 'Bûche de Noël', 'noel', 20, null),
  ('m_guirlande', 'marks', 'Guirlande lumineuse', 'noel', 22, null),
  ('f_noel_houx', 'frame', 'Couronne de houx', 'noel', 27, null),
  ('t_acharne_noel', 'title', 'Acharné de Noël', 'noel', 30, null),
  ('f_noel_aurore', 'frame', 'Aurore de la bande', 'noel', null, 3),
  ('t_bande_noel', 'title', 'La Bande de Noël', 'noel', null, 4),
  -- Effets spéciaux (un slot chacun, cumulables) : Pass de Noël 10, 18, 25 et Grande Hotte palier 2.
  ('fx_neige', 'fx_avatar', 'Neige sur l’avatar', 'noel', 10, null),
  ('fx_traineau', 'fx_entree', 'Entrée en traîneau', 'noel', 18, null),
  ('fx_sapins', 'fx_victoire', 'Pluie de sapins', 'noel', 25, null),
  ('fx_salon_neige', 'fx_salon', 'Salon enneigé', 'noel', null, 2)
on conflict (id) do update set slot = excluded.slot, label = excluded.label, event = excluded.event,
  event_tier = excluded.event_tier, band_tier = excluded.band_tier;

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
  if p_slot is null or p_slot not in ('frame', 'title', 'kart', 'golf_ball', 'bowling_ball', 'chess', 'card_back', 'dice', 'marks', 'fx_avatar', 'fx_entree', 'fx_victoire', 'fx_salon') then
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

-- Solde de pieces (derive de l'historique, retroactif) + mouvements du registre coin_ledger (mises :
-- paris entre potes et defis, features/mises.sql). plpgsql (et non sql) : coin_ledger est cree plus loin
-- (mises.sql), le corps n'est donc pas verifie a la creation.
create or replace function public._coins(p_profile uuid)
returns integer language plpgsql stable security definer
set search_path = public, extensions
as $$
begin
  -- Invite de passage (features/guest.sql) : jamais de pieces (pas d'achat, de pari ni de defi).
  if exists (select 1 from public.profiles where id = p_profile and is_guest) then return 0; end if;
  return (select coalesce(5 * count(*) + 15 * count(*) filter (where won), 0) from public.match_players where profile_id = p_profile)::int
       + (select 10 * count(*) from public.daily_runs where profile_id = p_profile and finished_at is not null)::int
       + (select 20 * count(*) from public.trophy_unlocks where profile_id = p_profile)::int
       - (select coalesce(sum(price), 0) from public.item_purchases where profile_id = p_profile)::int
       + (select coalesce(sum(delta), 0) from public.coin_ledger where profile_id = p_profile)::int;
end $$;

-- Vitrine de la semaine : 6 articles permanents (hors articles de saison, qui ont leur propre rayon), ordre
-- md5(semaine || id), hors articles possedes avant le lundi.
create or replace function public._shop_items(p_profile uuid, p_week date)
returns text[] language sql stable security definer
set search_path = public, extensions
as $$
  select coalesce(array_agg(id order by k), '{}') from (
    select i.id, md5(p_week::text || i.id) as k from public.items i
     where i.price is not null and i.season is null
       and not exists (select 1 from public.profile_items pi where pi.profile_id = p_profile and pi.item_id = i.id
                         and pi.obtained_at < (p_week::timestamp at time zone 'Europe/Paris'))
     order by k limit 6) t
$$;

-- {coins, week_start, ends_at, items:[ids], owned:[ids de la vitrine deja possedes],
--  season (id ou null), season_key, season_ends_at, season_items:[ids de la collection en cours, par prix],
--  season_owned:[ids de la collection deja possedes]}   (_season_at : features/saisons.sql)
create or replace function public.shop_state()
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := public._require_profile();
  v_week date := public._week_start_now();
  v_items text[] := public._shop_items(v_me, v_week);
  v_s record;
  v_sitems text[] := '{}';
begin
  select * into v_s from public._season_at(public._season_now());
  if v_s.season_id is not null then
    select coalesce(array_agg(i.id order by i.price, i.id), '{}') into v_sitems
      from public.items i where i.season = v_s.season_id and i.price is not null and i.pass_tier is null;
  end if;
  return jsonb_build_object(
    'coins', public._coins(v_me),
    'week_start', v_week,
    'ends_at', ((v_week + 7)::timestamp at time zone 'Europe/Paris'),
    'items', to_jsonb(v_items),
    'owned', coalesce((select jsonb_agg(item_id) from public.profile_items
                        where profile_id = v_me and item_id = any(v_items)), '[]'::jsonb),
    'season', v_s.season_id,
    'season_key', v_s.season_key,
    'season_ends_at', case when v_s.season_id is null then null else ((v_s.ends_on + 1)::timestamp at time zone 'Europe/Paris') end,
    'season_items', to_jsonb(v_sitems),
    'season_owned', coalesce((select jsonb_agg(item_id) from public.profile_items
                               where profile_id = v_me and item_id = any(v_sitems)), '[]'::jsonb));
end $$;

-- Achete un article de la vitrine ou de la collection de la saison en cours. Renvoie {item, coins}.
-- Erreurs : shop_not_available (ni en vitrine ni dans la collection de saison en cours), item_already_owned, shop_not_enough_coins.
create or replace function public.buy_item(p_item text)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := public._require_profile();
  v_price integer;
  v_season text;
begin
  perform 1 from public.profiles where id = v_me for update;  -- serialise les achats d'un joueur
  select season_id into v_season from public._season_at(public._season_now());
  if p_item is null or not (p_item = any(public._shop_items(v_me, public._week_start_now()))
       or exists (select 1 from public.items i where i.id = p_item and i.season = v_season
                    and i.price is not null and i.pass_tier is null)) then
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


-- ===== features\cartes-maison.sql =====
-- =============================================================================
-- CARTES MAISON : chacun écrit ses cartes (blagues internes) qui entrent dans les paquets de
-- « Tu préfères » (kind dilemma : {a, b}), « Action ou vérité » (kind action | verite : {text, level 1..3})
-- et « Qui de nous » (kind question : {text}). Lecture : tous les authentifiés (les cartes masquées ne
-- sont vues que par leur auteur et l'admin). Écriture : uniquement via les RPC ci-dessous.
-- Les moteurs de jeu reçoivent les cartes dans p_options (le front les lit ici) avec `by` = id du profil auteur.
-- =============================================================================

create table if not exists public.custom_cards (
  id         uuid primary key default gen_random_uuid(),
  author_id  uuid not null references public.profiles(id) on delete cascade,
  game_id    text not null check (game_id in ('tu-preferes', 'action-ou-verite', 'qui-de-nous')),
  kind       text not null check (kind in ('dilemma', 'action', 'verite', 'question')),
  payload    jsonb not null,
  created_at timestamptz not null default now(),
  hidden     boolean not null default false,
  constraint custom_cards_kind_game check (
    (game_id = 'tu-preferes' and kind = 'dilemma')
    or (game_id = 'action-ou-verite' and kind in ('action', 'verite'))
    or (game_id = 'qui-de-nous' and kind = 'question'))
);
create index if not exists custom_cards_game_idx on public.custom_cards (game_id, created_at desc);
create index if not exists custom_cards_author_idx on public.custom_cards (author_id);
alter table public.custom_cards enable row level security;
drop policy if exists custom_cards_select on public.custom_cards;
create policy custom_cards_select on public.custom_cards for select to authenticated
  using (not hidden or author_id = public.current_profile_id()
         or exists (select 1 from public.profiles p where p.id = public.current_profile_id() and p.is_admin));
-- Aucune policy d'écriture : tout passe par les RPC.

-- Valide et normalise un payload ; lève invalid_card si KO. Renvoie le payload propre.
create or replace function public._custom_card_clean(p_kind text, p_payload jsonb)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_a text; v_b text; v_t text; v_l integer;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'invalid_custom_card'; end if;
  if p_kind = 'dilemma' then
    v_a := btrim(regexp_replace(coalesce(p_payload->>'a', ''), '\s+', ' ', 'g'));
    v_b := btrim(regexp_replace(coalesce(p_payload->>'b', ''), '\s+', ' ', 'g'));
    if char_length(v_a) < 2 or char_length(v_b) < 2 or char_length(v_a) > 120 or char_length(v_b) > 120 then
      raise exception 'invalid_custom_card';
    end if;
    return jsonb_build_object('a', v_a, 'b', v_b);
  elsif p_kind in ('action', 'verite') then
    v_t := btrim(regexp_replace(coalesce(p_payload->>'text', ''), '\s+', ' ', 'g'));
    if char_length(v_t) < 5 or char_length(v_t) > 300 then raise exception 'invalid_custom_card'; end if;
    begin
      v_l := coalesce(nullif(p_payload->>'level', '')::integer, 1);
    exception when others then raise exception 'invalid_custom_card';
    end;
    if v_l not in (1, 2, 3) then raise exception 'invalid_custom_card'; end if;
    return jsonb_build_object('text', v_t, 'level', v_l);
  elsif p_kind = 'question' then
    v_t := btrim(regexp_replace(coalesce(p_payload->>'text', ''), '\s+', ' ', 'g'));
    if char_length(v_t) < 8 or char_length(v_t) > 200 then raise exception 'invalid_custom_card'; end if;
    return jsonb_build_object('text', v_t);
  end if;
  raise exception 'invalid_custom_card';
end $$;

-- Clé anti-doublon d'une carte (texte en minuscules).
create or replace function public._custom_card_key(p_kind text, p_payload jsonb)
returns text language sql immutable
as $$ select lower(case when p_kind = 'dilemma' then (p_payload->>'a') || '|' || (p_payload->>'b') else p_payload->>'text' end) $$;

create or replace function public.create_custom_card(p_game text, p_kind text, p_payload jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := public._require_member();  -- invités : pas de cartes permanentes pour la bande
  v_clean jsonb;
  v_row public.custom_cards;
begin
  if not ((p_game = 'tu-preferes' and p_kind = 'dilemma')
       or (p_game = 'action-ou-verite' and p_kind in ('action', 'verite'))
       or (p_game = 'qui-de-nous' and p_kind = 'question')) then
    raise exception 'invalid_custom_card';
  end if;
  v_clean := public._custom_card_clean(p_kind, p_payload);
  if (select count(*) from public.custom_cards where author_id = v_me) >= 200 then raise exception 'too_many_cards'; end if;
  if exists (select 1 from public.custom_cards
              where author_id = v_me and game_id = p_game and kind = p_kind
                and public._custom_card_key(kind, payload) = public._custom_card_key(p_kind, v_clean)) then
    raise exception 'duplicate_card';
  end if;
  insert into public.custom_cards(author_id, game_id, kind, payload) values (v_me, p_game, p_kind, v_clean)
    returning * into v_row;
  return to_jsonb(v_row);
end $$;

create or replace function public.update_custom_card(p_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := public._require_profile();
  v_row public.custom_cards;
  v_clean jsonb;
begin
  select * into v_row from public.custom_cards where id = p_id;
  if not found then raise exception 'card_not_found'; end if;
  if v_row.author_id <> v_me then raise exception 'not_card_author'; end if;
  v_clean := public._custom_card_clean(v_row.kind, p_payload);
  if exists (select 1 from public.custom_cards
              where author_id = v_me and game_id = v_row.game_id and kind = v_row.kind and id <> p_id
                and public._custom_card_key(kind, payload) = public._custom_card_key(v_row.kind, v_clean)) then
    raise exception 'duplicate_card';
  end if;
  update public.custom_cards set payload = v_clean where id = p_id returning * into v_row;
  return to_jsonb(v_row);
end $$;

create or replace function public.delete_custom_card(p_id uuid)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := public._require_profile();
  v_author uuid;
begin
  select author_id into v_author from public.custom_cards where id = p_id;
  if not found then raise exception 'card_not_found'; end if;
  if v_author <> v_me and not exists (select 1 from public.profiles where id = v_me and is_admin) then
    raise exception 'not_card_author';
  end if;
  delete from public.custom_cards where id = p_id;
end $$;

-- Admin : masque / ré-affiche une carte (pas de modération automatique).
create or replace function public.hide_custom_card(p_id uuid, p_hidden boolean)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
declare v_me uuid := public._require_profile();
begin
  if not exists (select 1 from public.profiles where id = v_me and is_admin) then raise exception 'not_admin'; end if;
  update public.custom_cards set hidden = coalesce(p_hidden, true) where id = p_id;
  if not found then raise exception 'card_not_found'; end if;
end $$;

revoke all on function public._custom_card_clean(text, jsonb) from public, anon, authenticated;
revoke all on function public._custom_card_key(text, jsonb) from public, anon, authenticated;
revoke all on function public.create_custom_card(text, text, jsonb) from public, anon;
revoke all on function public.update_custom_card(uuid, jsonb) from public, anon;
revoke all on function public.delete_custom_card(uuid) from public, anon;
revoke all on function public.hide_custom_card(uuid, boolean) from public, anon;
grant execute on function public.create_custom_card(text, text, jsonb) to authenticated;
grant execute on function public.update_custom_card(uuid, jsonb) to authenticated;
grant execute on function public.delete_custom_card(uuid) to authenticated;
grant execute on function public.hide_custom_card(uuid, boolean) to authenticated;
grant select on public.custom_cards to authenticated;


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

-- Etat du joueur : {day, status: todo|running|done|missed, score, rank, players, streak, secs_left, answers (running)}
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
    -- manches deja jouees : le front reprend le defi a la suivante apres un rechargement
    'answers', case when v_status = 'running' then r.answers end,
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
    'outcome', null, 'winner', null, 'forfeit', null, 'ready', '[]'::jsonb,
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
  v_n      integer;
begin
  v_r := public._duel_board_move(p_game, v_state->'board', coalesce(v_server->'board', 'null'::jsonb), p_actor, p_move);
  v_out := v_r->>'outcome';
  if v_out is not null and v_out not in ('win', 'draw') then raise exception 'invalid_board'; end if;
  if v_r ? 'server' then v_server := v_server || jsonb_build_object('board', v_r->'server'); end if;
  -- Coups automatiques CONSÉCUTIFS par joueur (remis à 0 dès qu'il joue lui-même) ; le 3e = forfait.
  v_n := case when p_auto then coalesce((v_d->'auto_streak'->>p_actor)::integer, 0) + 1 else 0 end;
  v_d := v_d || jsonb_build_object(
    'moves', coalesce((v_d->>'moves')::integer, 0) + 1,
    'last_move', jsonb_build_object('by', p_actor, 'move', p_move, 'auto', p_auto),
    'auto_streak', coalesce(v_d->'auto_streak', '{}'::jsonb) || jsonb_build_object(p_actor, v_n));
  v_state := v_state || jsonb_build_object('board', v_r->'board', 'duel', v_d);
  if v_out is null and v_n >= 3 then
    -- Duelliste absent : il perd la manche par forfait.
    v_state := public._duel_end_game(v_state, 'win', public._duel_other(v_d, p_actor),
                 jsonb_build_object('forfeit', p_actor));
  elsif v_out is not null then
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
  if v_phase not in ('transition', 'setup', 'playing', 'result') then
    -- Un tick tardif (partie déjà finie) est une relance automatique : sans effet, sans erreur.
    if v_type = 'tick' then return jsonb_build_object('state', p_state, 'server', p_server); end if;
    raise exception 'wrong_phase';
  end if;

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
