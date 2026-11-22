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
