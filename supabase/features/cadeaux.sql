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
