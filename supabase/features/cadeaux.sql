-- =============================================================================
-- CADEAUX (deco in game) : cadres d'avatar, titres sous le pseudo, objets de jeu (purement decoratifs).
-- Catalogue `items` (miroir de src/data/cadeaux.ts), possession `profile_items`, equipement
-- `profiles.equipped_items` = {slot: item_id}. Source actuelle : calendrier de l'Avent
-- (advent_day = cadeau de la case de ce jour ; advent_count = palier en nombre de cases ouvertes),
-- distribue par advent_open (features/daily.sql) via _advent_gifts.
-- Autres sources : items.rule, verifiee par _sync_items (RPC sync_my_items, appelee par le front) :
--   {"trophy": id} trophee obtenu | {"level": n} niveau >= n | {"weekly": n} champion de la semaine n fois
--   | {"wins": {"game": id, "n": n}} n victoires dans ce jeu. Retroactif.
-- Slots : frame, title, kart, golf_ball, bowling_ball, chess. Charge avant daily.sql (ordre alphabetique).
-- =============================================================================

create table if not exists public.items (
  id           text primary key,
  slot         text not null check (slot in ('frame', 'title', 'kart', 'golf_ball', 'bowling_ball', 'chess')),
  label        text not null,
  advent_day   integer,
  advent_count integer
);
alter table public.items add column if not exists rule jsonb;
alter table public.items enable row level security;
drop policy if exists items_select on public.items;
create policy items_select on public.items for select to authenticated using (true);

insert into public.items(id, slot, label, advent_day, advent_count, rule) values
  -- titres (jours impairs)
  ('t_lutin_stagiaire', 'title', 'Lutin stagiaire', 1, null, null),
  ('t_chocolat_chaud', 'title', 'Accro au chocolat chaud', 3, null, null),
  ('t_pote_rennes', 'title', 'Pote des rennes', 5, null, null),
  ('t_artiste_neiges', 'title', 'Artiste des neiges', 7, null, null),
  ('t_papier_cadeau', 'title', 'As du papier cadeau', 9, null, null),
  ('t_chorale', 'title', 'Chorale à soi tout seul', 11, null, null),
  ('t_mange_biscuits', 'title', 'Mange-biscuits', 13, null, null),
  ('t_pilote_luge', 'title', 'Pilote de luge', 15, null, null),
  ('t_pro_guirlandes', 'title', 'Pro des guirlandes', 17, null, null),
  ('t_garde_sapin', 'title', 'Garde du sapin', 19, null, null),
  ('t_grelot_officiel', 'title', 'Grelot officiel', 21, null, null),
  ('t_etoile_soiree', 'title', 'Étoile de la soirée', 23, null, null),
  -- cadres (jours pairs)
  ('f_guirlande', 'frame', 'Guirlande lumineuse', 2, null, null),
  ('f_flocons', 'frame', 'Flocons', 4, null, null),
  ('f_sucre_orge', 'frame', 'Sucre d''orge', 6, null, null),
  ('f_houx', 'frame', 'Houx', 8, null, null),
  ('f_pain_epice', 'frame', 'Pain d''épice', 10, null, null),
  ('f_boules', 'frame', 'Boules de Noël', 12, null, null),
  ('f_cadeau', 'frame', 'Paquet cadeau', 14, null, null),
  ('f_etoiles', 'frame', 'Étoiles', 16, null, null),
  ('f_neige', 'frame', 'Tempête de neige', 18, null, null),
  ('f_sapin', 'frame', 'Sapin', 20, null, null),
  ('f_aurore', 'frame', 'Aurore boréale', 22, null, null),
  ('f_etoile_doree', 'frame', 'Étoile dorée', 24, null, null),
  -- paliers (nombre de cases ouvertes)
  ('bb_noel', 'bowling_ball', 'Boule de Noël', null, 6, null),
  ('gb_bonhomme', 'golf_ball', 'Balle bonhomme de neige', null, 12, null),
  ('k_traineau', 'kart', 'Traîneau', null, 18, null),
  ('c_pain_epice', 'chess', 'Échecs en pain d''épice', null, 24, null),
  ('t_esprit_noel', 'title', 'Esprit de Noël incarné', null, 24, null),
  ('f_arc_en_ciel', 'frame', 'Arc-en-ciel', null, null, '{"trophy":"gen_touche_a_tout"}'::jsonb),
  ('t_couteau_suisse', 'title', 'Couteau suisse', null, null, '{"trophy":"gen_polyvalent"}'::jsonb),
  ('t_pilier', 'title', 'Pilier de soirée', null, null, '{"trophy":"gen_pilier"}'::jsonb),
  ('f_nuit_blanche', 'frame', 'Nuit blanche', null, null, '{"trophy":"gen_noctambule"}'::jsonb),
  ('t_increvable', 'title', 'Increvable', null, null, '{"trophy":"gen_marathon"}'::jsonb),
  ('f_tapis_rouge', 'frame', 'Tapis rouge', null, null, '{"trophy":"gen_hote"}'::jsonb),
  ('t_grande_tablee', 'title', 'Grande tablée', null, null, '{"trophy":"gen_grande_tablee"}'::jsonb),
  ('f_bulles', 'frame', 'Bulles de BD', null, null, '{"trophy":"gen_pipelette"}'::jsonb),
  ('t_fashion_week', 'title', 'Fashion week', null, null, '{"trophy":"gen_garde_robe"}'::jsonb),
  ('f_medaillon', 'frame', 'Médaillon', null, null, '{"trophy":"gen_collectionneur"}'::jsonb),
  ('t_boule_cristal', 'title', 'Boule de cristal', null, null, '{"trophy":"gen_madame_irma"}'::jsonb),
  ('f_bronze', 'frame', 'Bronze', null, null, '{"level":5}'::jsonb),
  ('f_argent', 'frame', 'Argent', null, null, '{"level":10}'::jsonb),
  ('f_or', 'frame', 'Or', null, null, '{"level":15}'::jsonb),
  ('f_diamant', 'frame', 'Diamant', null, null, '{"level":20}'::jsonb),
  ('t_patron_semaine', 'title', 'Patron de la semaine', null, null, '{"weekly":1}'::jsonb),
  ('f_couronne', 'frame', 'Couronne', null, null, '{"weekly":3}'::jsonb),
  ('k_dore', 'kart', 'Bolide doré', null, null, '{"wins":{"game":"dede-kart","n":10}}'::jsonb),
  ('gb_disco', 'golf_ball', 'Balle disco', null, null, '{"wins":{"game":"mini-golf","n":10}}'::jsonb),
  ('bb_galaxie', 'bowling_ball', 'Boule galaxie', null, null, '{"wins":{"game":"bowling","n":10}}'::jsonb),
  ('c_marbre', 'chess', 'Pièces en marbre', null, null, '{"wins":{"game":"echecs","n":10}}'::jsonb)
on conflict (id) do update set slot = excluded.slot, label = excluded.label,
  advent_day = excluded.advent_day, advent_count = excluded.advent_count, rule = excluded.rule;

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
  if p_slot is null or p_slot not in ('frame', 'title', 'kart', 'golf_ball', 'bowling_ball', 'chess') then
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

revoke all on function public._sync_items(uuid) from public, anon, authenticated;
revoke all on function public.sync_my_items() from public, anon;
grant execute on function public.sync_my_items() to authenticated;
revoke all on function public._grant_item(uuid, text) from public, anon, authenticated;
revoke all on function public._advent_gifts(uuid, date, integer) from public, anon, authenticated;
revoke all on function public.equip_item(text, text) from public, anon;
grant execute on function public.equip_item(text, text) to authenticated;
