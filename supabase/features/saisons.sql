-- =============================================================================
-- SAISONS DE BOUTIQUE — idempotent, execute APRES cadeaux.sql et mises.sql (ordre alphabetique de features/).
-- Spec : docs/superpowers/specs/2026-11-22-saisons-boutique-design.md
--
-- 4 saisons calendaires (heure de Paris), lancees le 2026-12-01 (rien avant) :
--   hiver (1 dec -> fin fev) · printemps (1 mars -> 31 mai) · ete (1 juin -> 31 aout) · automne (1 sept -> 30 nov)
--   season_key = '<id>-<annee du jour de debut>' (janvier 2027 = 'hiver-2026'). Calendrier fixe, pas de table.
-- Catalogue (items.season / items.pass_tier, cadeaux.sql) : collection limitee de 9 articles par saison (price non
--   null, achetable pendant la saison via buy_item) + 4 exclusifs du passe (pas de prix, jamais vendus).
-- Passe gratuit de 20 paliers de 40 points : points DERIVES de l'historique de la saison (partie terminee 10,
--   victoire +10, defi du jour termine 15, soiree a >= 2 joueurs 25 une fois par soiree). Recompenses attribuees
--   par season_sync (idempotent, saison en cours + precedente) : pieces (via coin_ledger, raison 'season_pass',
--   ref '<season_key>:<palier>') + exclusifs aux paliers 5/10/15/20 (+ titre et 100 pieces au 20). Deja possede :
--   100 pieces a la place (150 au palier 20 : 100 + 50 pour le titre).
-- Les invites (profiles.is_guest) n'ont ni passe ni pieces : season_sync les ignore.
--
-- RPC : season_sync() -> {season, season_key, starts_at, ends_at, points, tier, new_claims:[{season_key, tier,
--   coins, item_id, compensated}], ended:{season, season_key, tier, coins_total, collection_owned}|null}
-- Fonctions de date : _season_now() (= now(), redefinie par les tests PGlite pour simuler une date).
-- =============================================================================

create table if not exists public.season_pass_claims (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  season_key text not null,
  tier       integer not null check (tier between 1 and 20),
  coins      integer not null default 0,
  item_id    text references public.items(id) on delete set null,
  claimed_at timestamptz not null default now(),
  primary key (profile_id, season_key, tier)
);
alter table public.season_pass_claims enable row level security;
-- Aucune policy : table lue / ecrite uniquement par season_sync (security definer).

-- « Maintenant » (surchargeable en test).
create or replace function public._season_now()
returns timestamptz language sql stable as $$ select now() $$;

-- Bornes d'une edition (season_key) : jour de debut et dernier jour inclus. Vide si cle invalide.
create or replace function public._season_bounds(p_key text)
returns table(season_id text, season_key text, starts_on date, ends_on date)
language sql immutable
as $$
  with k as (
    select split_part(p_key, '-', 1) as id, nullif(split_part(p_key, '-', 2), '')::int as yr
  ), s as (
    select id, yr, make_date(yr, case id when 'hiver' then 12 when 'printemps' then 3 when 'ete' then 6 else 9 end, 1) as d
      from k where id in ('hiver', 'printemps', 'ete', 'automne') and yr is not null
  )
  select id, p_key, d, (d + interval '3 months' - interval '1 day')::date from s
$$;

-- Saison en cours a l'instant p_at (heure de Paris). Aucune ligne avant le lancement (2026-12-01).
create or replace function public._season_at(p_at timestamptz)
returns table(season_id text, season_key text, starts_on date, ends_on date)
language plpgsql stable
as $$
declare
  v_d date := (p_at at time zone 'Europe/Paris')::date;
  v_m int := extract(month from v_d);
  v_y int := extract(year from v_d);
  v_id text;
begin
  if v_d < date '2026-12-01' then return; end if;
  if v_m in (12, 1, 2) then
    v_id := 'hiver';
    if v_m <> 12 then v_y := v_y - 1; end if;
  elsif v_m in (3, 4, 5) then v_id := 'printemps';
  elsif v_m in (6, 7, 8) then v_id := 'ete';
  else v_id := 'automne';
  end if;
  return query select b.season_id, b.season_key, b.starts_on, b.ends_on from public._season_bounds(v_id || '-' || v_y) b;
end $$;

-- Points de passe d'un joueur sur une edition (derives de l'historique, dans la fenetre de la saison).
create or replace function public._season_points(p_profile uuid, p_key text)
returns integer language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  b record;
  v_from timestamptz;
  v_to timestamptz;
  v_pts integer;
begin
  if exists (select 1 from public.profiles where id = p_profile and is_guest) then return 0; end if;
  select * into b from public._season_bounds(p_key);
  if b.starts_on is null then return 0; end if;
  v_from := b.starts_on::timestamp at time zone 'Europe/Paris';
  v_to := (b.ends_on + 1)::timestamp at time zone 'Europe/Paris';
  -- Parties : memes lignes match_players que _coins, datees par la fin de la partie.
  select coalesce(10 * count(*) + 10 * count(*) filter (where mp.won), 0) into v_pts
    from public.match_players mp join public.matches m on m.id = mp.match_id
   where mp.profile_id = p_profile and coalesce(m.finished_at, m.created_at) >= v_from and coalesce(m.finished_at, m.created_at) < v_to;
  -- Defis du jour termines.
  v_pts := v_pts + 15 * (select count(*) from public.daily_runs d
                          where d.profile_id = p_profile and d.finished_at >= v_from and d.finished_at < v_to)::int;
  -- Soirees entre amis : une seule fois par soiree (partie a >= 2 joueurs, dans la fenetre).
  v_pts := v_pts + 25 * (select count(distinct m.soiree_id) from public.match_players mp
                           join public.matches m on m.id = mp.match_id
                          where mp.profile_id = p_profile
                            and coalesce(m.finished_at, m.created_at) >= v_from and coalesce(m.finished_at, m.created_at) < v_to
                            and (select count(*) from public.match_players x where x.match_id = m.id) >= 2)::int;
  return v_pts;
end $$;

create or replace function public._season_tier(p_points integer)
returns integer language sql immutable as $$ select least(20, greatest(0, p_points / 40)) $$;

-- Pieces du palier (grille commune aux 4 saisons ; 0 aux paliers a cosmetique 5/10/15 ; 100 au 20).
create or replace function public._season_tier_coins(p_tier integer)
returns integer language sql immutable
as $$
  select case p_tier
    when 1 then 20 when 2 then 20 when 3 then 20 when 4 then 30
    when 6 then 20 when 7 then 30 when 8 then 30 when 9 then 30
    when 11 then 30 when 12 then 30 when 13 then 40 when 14 then 40
    when 16 then 40 when 17 then 40 when 18 then 50 when 19 then 50
    when 20 then 100 else 0 end
$$;

-- Attribue les paliers atteints et pas encore enregistres d'une edition. Renvoie les nouveaux paliers.
create or replace function public._season_claim(p_profile uuid, p_key text)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_new jsonb := '[]'::jsonb;
  v_id text;
  v_tier integer;
  t integer;
  v_item text;
  v_coins integer;
  v_comp boolean;
begin
  select season_id into v_id from public._season_bounds(p_key);
  if v_id is null then return v_new; end if;
  v_tier := public._season_tier(public._season_points(p_profile, p_key));
  for t in 1..v_tier loop
    if exists (select 1 from public.season_pass_claims where profile_id = p_profile and season_key = p_key and tier = t) then continue; end if;
    v_coins := public._season_tier_coins(t);
    v_item := null;
    v_comp := false;
    if t % 5 = 0 then
      select i.id into v_item from public.items i where i.season = v_id and i.pass_tier = t;
      if v_item is not null then
        if not public._grant_item(p_profile, v_item) then
          -- Deja possede : 100 pieces a la place (150 au palier 20 : 100 du palier + 50 pour le titre).
          v_item := null;
          v_comp := true;
          v_coins := v_coins + case when t = 20 then 50 else 100 end;
        end if;
      end if;
    end if;
    insert into public.season_pass_claims(profile_id, season_key, tier, coins, item_id)
    values (p_profile, p_key, t, v_coins, v_item);
    if v_coins > 0 then
      insert into public.coin_ledger(profile_id, delta, reason, ref)
      values (p_profile, v_coins, 'season_pass', p_key || ':' || t) on conflict do nothing;
    end if;
    v_new := v_new || jsonb_build_object('season_key', p_key, 'tier', t, 'coins', v_coins, 'item_id', v_item, 'compensated', v_comp);
  end loop;
  return v_new;
end $$;

-- Synchronise le passe : saison precedente (rattrapage) puis saison en cours. Idempotent.
create or replace function public.season_sync()
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := public._require_profile();
  v_now timestamptz := public._season_now();
  c record;
  p record;
  v_claims jsonb := '[]'::jsonb;
  v_ended jsonb := null;
  v_pts integer;
begin
  perform 1 from public.profiles where id = v_me for update;  -- serialise les synchronisations d'un joueur
  if exists (select 1 from public.profiles where id = v_me and is_guest) then
    return jsonb_build_object('season', null, 'new_claims', '[]'::jsonb, 'ended', null);
  end if;
  select * into c from public._season_at(v_now);
  if c.season_id is null then
    return jsonb_build_object('season', null, 'new_claims', '[]'::jsonb, 'ended', null);
  end if;
  select * into p from public._season_at((c.starts_on - 1)::timestamp at time zone 'Europe/Paris');
  if p.season_id is not null then
    v_claims := public._season_claim(v_me, p.season_key);
    v_pts := public._season_points(v_me, p.season_key);
    if v_pts > 0 then
      v_ended := jsonb_build_object('season', p.season_id, 'season_key', p.season_key,
        'tier', public._season_tier(v_pts),
        'coins_total', (select coalesce(sum(coins), 0) from public.season_pass_claims where profile_id = v_me and season_key = p.season_key),
        'collection_owned', (select count(*) from public.items i
                              where i.season = p.season_id and i.price is not null and i.pass_tier is null
                                and exists (select 1 from public.profile_items pi where pi.profile_id = v_me and pi.item_id = i.id)));
    end if;
  end if;
  v_claims := v_claims || public._season_claim(v_me, c.season_key);
  v_pts := public._season_points(v_me, c.season_key);
  return jsonb_build_object(
    'season', c.season_id,
    'season_key', c.season_key,
    'starts_at', (c.starts_on::timestamp at time zone 'Europe/Paris'),
    'ends_at', ((c.ends_on + 1)::timestamp at time zone 'Europe/Paris'),
    'points', v_pts,
    'tier', public._season_tier(v_pts),
    'new_claims', v_claims,
    'ended', v_ended);
end $$;

revoke all on function public._season_now() from public, anon, authenticated;
revoke all on function public._season_bounds(text) from public, anon, authenticated;
revoke all on function public._season_at(timestamptz) from public, anon, authenticated;
revoke all on function public._season_points(uuid, text) from public, anon, authenticated;
revoke all on function public._season_tier(integer) from public, anon, authenticated;
revoke all on function public._season_tier_coins(integer) from public, anon, authenticated;
revoke all on function public._season_claim(uuid, text) from public, anon, authenticated;
revoke all on function public.season_sync() from public, anon;
grant execute on function public.season_sync() to authenticated;
