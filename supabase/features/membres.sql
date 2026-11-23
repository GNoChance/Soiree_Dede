-- =============================================================================
-- NOUVEAUX MEMBRES DE LA BANDE — idempotent, exécuté APRÈS guest.sql (ordre alphabétique : _guest_avatars).
-- L'admin ajoute une vraie personne à la bande (pas un invité : is_guest = false, donc classements,
-- stats, trophées, boutique… comme les 9 autres). Pas encore de chibi : avatar emoji (mêmes ids que
-- les invités, cf. src/data/guests.ts), slug « m-<avatar>-<6 car.> ».
-- Code à 4 chiffres tiré au hasard, renvoyé à l'admin ({..., pin}) qui le lui donne. Pour en
-- choisir un autre : l'admin réinitialise le code (admin_reset_pin) devant la personne.
-- Passer en chibi plus tard : voir docs/ARCHITECTURE.md (renommer le slug + catalogue des persos).
-- Erreurs : forbidden, invalid_first_name, invalid_nickname, invalid_avatar, nickname_taken, unknown_profile.
-- =============================================================================

create or replace function public.admin_create_member(p_first_name text, p_nickname text, p_avatar text)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_first text := btrim(regexp_replace(coalesce(p_first_name, ''), '\s+', ' ', 'g'));
  v_nick  text := btrim(regexp_replace(coalesce(p_nickname, ''), '\s+', ' ', 'g'));
  v_av    text := lower(btrim(coalesce(p_avatar, '')));
  v_alpha constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  v_slug  text;
  v_id    uuid;
  v_pin   text;
begin
  perform public._require_admin();
  if char_length(v_first) < 1 or char_length(v_first) > 30 then raise exception 'invalid_first_name'; end if;
  if char_length(v_nick) < 1 or char_length(v_nick) > 20 then raise exception 'invalid_nickname'; end if;
  if not (v_av = any(public._guest_avatars())) then raise exception 'invalid_avatar'; end if;

  perform pg_advisory_xact_lock(hashtext('admin_create_member'));
  if exists (select 1 from public.profiles where not is_guest and lower(nickname) = lower(v_nick)) then
    raise exception 'nickname_taken';
  end if;

  loop
    select 'm-' || v_av || '-' || string_agg(substr(v_alpha, 1 + floor(random() * length(v_alpha))::integer, 1), '')
      into v_slug from generate_series(1, 6);
    exit when not exists (select 1 from public.profiles where slug = v_slug);
  end loop;

  insert into public.profiles(slug, first_name, nickname, expressions, sort_order)
  values (v_slug, v_first, v_nick,
          array['joie','colere','pleurs','boude','reflexion','dodo','bisou','clin_oeil','surprise','amoureux','cool','gamer'],
          coalesce((select max(sort_order) from public.profiles where not is_guest), 0) + 1)
  returning id into v_id;
  -- Code tiré au hasard et renvoyé à l'admin (une seule fois) : un profil sans code pourrait être
  -- pris par n'importe qui (première connexion = le code saisi devient le code).
  v_pin := lpad(floor(random() * 10000)::integer::text, 4, '0');
  insert into public.profile_credentials(profile_id, pin_hash, updated_at)
  values (v_id, extensions.crypt(v_pin, extensions.gen_salt('bf', 8)), now());
  return public._profile_json(v_id) || jsonb_build_object('pin', v_pin);
end $$;

-- Change l'emoji d'un membre « m-… » (le slug porte l'avatar ; le suffixe aléatoire est conservé).
create or replace function public.admin_update_member_avatar(p_profile uuid, p_avatar text)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_av   text := lower(btrim(coalesce(p_avatar, '')));
  v_p    public.profiles%rowtype;
  v_slug text;
begin
  perform public._require_admin();
  if not (v_av = any(public._guest_avatars())) then raise exception 'invalid_avatar'; end if;
  select * into v_p from public.profiles where id = p_profile and slug like 'm-%' and not is_guest;
  if not found then raise exception 'unknown_profile'; end if;
  v_slug := 'm-' || v_av || '-' || split_part(v_p.slug, '-', 3);
  if v_slug <> v_p.slug then
    update public.profiles set slug = v_slug where id = v_p.id;
    update public.login_attempts set slug = v_slug where slug = v_p.slug;
  end if;
  return public._profile_json(v_p.id);
end $$;

revoke all on function public.admin_create_member(text, text, text) from public, anon;
revoke all on function public.admin_update_member_avatar(uuid, text) from public, anon;
grant execute on function public.admin_create_member(text, text, text) to authenticated;
grant execute on function public.admin_update_member_avatar(uuid, text) to authenticated;
