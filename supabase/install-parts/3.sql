-- MORCEAU 3 / 6 — -- GÉNÉRÉ par scripts/build-sql.mjs — ne pas éditer. Idempotent. À exécuter dans l'ordre (1, puis 2…) dans Supabase > SQL Editor > Run.

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
        -- tenues gagnées aux victoires : la tenue secrète offerte par un trophée (Madame Irma) ne compte pas
        select count(*) into v from public.tenue_unlocks u join public.tenues x on x.id = u.tenue_id
         where u.profile_id = p_profile and x.condition_type <> 'trophy';
      when 'full_board' then
        select coalesce(max(c), 0) into v from (
          select count(*) as c from public.trophy_unlocks u join public.trophies t on t.id = u.trophy_id
           where u.profile_id = p_profile and t.tenue_id is not null group by t.tenue_id) x;
      when 'advent' then
        select count(*) into v from public.advent_opens where profile_id = p_profile;
      when 'prono_streak' then
        select coalesce(max(len), 0) into v from (
          select count(*) as len from (
            select r.ok,
                   row_number() over (order by r.at, r.match_id)
                   - row_number() over (partition by r.ok order by r.at, r.match_id) as grp
              from public._prono_resolved() r where r.profile_id = p_profile) t
           where t.ok group by t.grp) z;
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
  -- Invités : jamais de trophée (ni tenue de récompense), quelle que soit la voie (pronos, stickers…).
  if exists (select 1 from public.profiles where id = p_profile_id and is_guest) then return v_new; end if;
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
  if exists (select 1 from public.profiles where id = p_profile_id and is_guest) then return false; end if;
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
  v_ids  uuid[];
begin
  select game_id into v_game from public.matches where id = p_match_id;
  -- joueurs de la partie + parieurs de la manche de pronostics (même absents de la partie)
  v_ids := array(select distinct x from unnest(coalesce(p_profile_ids, '{}')
                  || array(select profile_id from public.soiree_pronos where match_id = p_match_id)) x);
  foreach v_id in array v_ids loop
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
-- Tenue débloquée ET (slot 1 | slot > 12 (bonus) | tenue secrète (condition 'trophy' : tous ses stickers
-- sont offerts, la tenue étant déjà la récompense) | trophée (tenue, slot) obtenu).
create or replace function public._tenue_slot_ok(p_profile uuid, p_tenue text, p_slot integer)
returns boolean language sql stable security definer
set search_path = public, extensions
as $$
  select p_slot >= 1
     and exists (select 1 from public.tenue_unlocks u where u.profile_id = p_profile and u.tenue_id = p_tenue)
     and (p_slot = 1 or p_slot > 12
          or exists (select 1 from public.tenues x where x.id = p_tenue and x.condition_type = 'trophy')
          or exists (
           select 1 from public.trophies t join public.trophy_unlocks tu on tu.trophy_id = t.id
            where t.tenue_id = p_tenue and t.slot = p_slot and tu.profile_id = p_profile))
$$;

-- ---- Trophée -> tenue secrète ---------------------------------------------------
-- Obtenir un trophée qui est la clé d'une tenue secrète (tenues.trophy_id, ex. gen_madame_irma -> irma)
-- débloque cette tenue. Un trigger couvre tous les chemins d'attribution (fin de partie, evaluate_trophy…).
create or replace function public._trophy_reward_tenue()
returns trigger language plpgsql security definer
set search_path = public, extensions
as $$
begin
  insert into public.tenue_unlocks(profile_id, tenue_id)
  select new.profile_id, x.id from public.tenues x where x.trophy_id = new.trophy_id
  on conflict do nothing;
  return null;
end $$;

drop trigger if exists trophy_unlocks_reward_tenue on public.trophy_unlocks;
create trigger trophy_unlocks_reward_tenue after insert on public.trophy_unlocks
  for each row execute function public._trophy_reward_tenue();

-- Rattrapage (idempotent) : trophées déjà obtenus avant la mise en place de la tenue secrète.
insert into public.tenue_unlocks(profile_id, tenue_id)
select u.profile_id, x.id from public.trophy_unlocks u join public.tenues x on x.trophy_id = u.trophy_id
on conflict do nothing;

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
  ('dk_touriste', 'pilote', 7, 'Tour du monde', 'Gagner une course sur chacun des 6 circuits (cumul)', 'dede-kart', '{"agg":"all","rules":[{"agg":"sum","stat":"win_track_1","threshold":1},{"agg":"sum","stat":"win_track_2","threshold":1},{"agg":"sum","stat":"win_track_3","threshold":1},{"agg":"sum","stat":"win_track_4","threshold":1},{"agg":"sum","stat":"win_track_5","threshold":1},{"agg":"sum","stat":"win_track_6","threshold":1}]}'::jsonb, true, 215),
  ('dk_coup_bas', 'pilote', 8, 'Coups bas', 'Utiliser au moins une fois le nuage, les confettis et le demi-tour (cumul)', 'dede-kart', '{"agg":"all","rules":[{"agg":"sum","stat":"used_cloud","threshold":1},{"agg":"sum","stat":"used_confetti","threshold":1},{"agg":"sum","stat":"used_reverse","threshold":1}]}'::jsonb, true, 216),
  ('dk_remontada', 'pilote', 9, 'Remontada', 'En coupe, gagner une course après avoir fini hors du podium à la précédente', 'dede-kart', '{"agg":"sum","stat":"comeback","threshold":1}'::jsonb, true, 217),
  ('dk_sniper', 'pilote', 10, 'Sniper', '5 touches réussies en une coupe', 'dede-kart', '{"agg":"max","stat":"hits","threshold":5}'::jsonb, true, 218),
  ('dk_echappee', 'pilote', 11, 'L''échappée', 'Gagner une course avec 5 s d''avance ou plus sur le 2e', 'dede-kart', '{"agg":"sum","stat":"big_lead","threshold":1}'::jsonb, true, 219),
  ('dk_grand_chelem', 'pilote', 12, 'Grand chelem', 'Gagner les 3 courses d''une coupe (4 karts min.)', 'dede-kart', '{"agg":"sum","stat":"grand_slam","threshold":1}'::jsonb, true, 220),
  ('ndc_kaboum', 'hacker', 2, 'Kaboum !', 'Avoir voté pour la bombe', 'nom-de-code', '{"agg":"sum","stat":"bomb_votes","threshold":1}'::jsonb, true, 2100),
  ('ndc_page_blanche', 'hacker', 3, 'Page blanche', 'En espion, laisser filer le chrono sans donner d''indice', 'nom-de-code', '{"agg":"sum","stat":"idle_clue","threshold":1}'::jsonb, true, 2101),
  ('ndc_taupe', 'hacker', 4, 'Taupe malgré toi', 'Faire dévoiler 3 mots d''une autre équipe (cumul)', 'nom-de-code', '{"agg":"sum","stat":"enemy_reveals","threshold":3}'::jsonb, true, 2102),
  ('ndc_bon_flair', 'hacker', 5, 'Bon flair', 'Être le premier à poser sa tête sur 10 mots de son équipe (cumul)', 'nom-de-code', '{"agg":"sum","stat":"first_good","threshold":10}'::jsonb, true, 2103),
  ('ndc_agent_terrain', 'hacker', 6, 'Agent de terrain', 'Jouer 10 parties (cumul)', 'nom-de-code', '{"agg":"count","threshold":10}'::jsonb, true, 2104),
  ('ndc_coup_double', 'hacker', 7, 'Coup double', 'En espion, faire trouver 3 mots avec un seul indice', 'nom-de-code', '{"agg":"max","stat":"best_clue","threshold":3}'::jsonb, true, 2105),
  ('ndc_maitre_espion', 'hacker', 8, 'Maître espion', 'Gagner 3 manches en espion (cumul)', 'nom-de-code', '{"agg":"sum","stat":"spy_wins","threshold":3}'::jsonb, true, 2106),
  ('ndc_sans_faute', 'hacker', 9, 'Sans faute', 'Gagner une manche sans aucune erreur de son équipe', 'nom-de-code', '{"agg":"sum","stat":"flawless","threshold":1}'::jsonb, true, 2107),
  ('ndc_remontada', 'hacker', 10, 'Remontada', 'Gagner une manche après avoir eu 3 mots de retard ou plus', 'nom-de-code', '{"agg":"sum","stat":"comeback","threshold":1}'::jsonb, true, 2108),
  ('ndc_telepathie', 'hacker', 11, 'Télépathie', 'En espion, faire trouver 4 mots ou plus avec un seul indice', 'nom-de-code', '{"agg":"max","stat":"best_clue","threshold":4}'::jsonb, true, 2109),
  ('ndc_legende', 'hacker', 12, 'Légende du code', 'Gagner 15 parties (cumul)', 'nom-de-code', '{"agg":"sum","stat":"won","threshold":15}'::jsonb, true, 2110),
  ('ech_berger', 'grandmaitre', 2, 'Le coup du berger', 'Se faire mater en 10 coups ou moins', 'echecs', '{"agg":"sum","stat":"fast_mated","threshold":1}'::jsonb, true, 2200),
  ('ech_adieu_ma_dame', 'grandmaitre', 3, 'Adieu ma dame', 'Se faire prendre sa dame 5 fois (cumul)', 'echecs', '{"agg":"sum","stat":"queens_lost","threshold":5}'::jsonb, true, 2201),
  ('ech_pat_zut', 'grandmaitre', 4, 'Pat… zut !', 'Mettre l''adversaire pat alors qu''on avait 5 points de matériel d''avance ou plus', 'echecs', '{"agg":"sum","stat":"stalemate_blunders","threshold":1}'::jsonb, true, 2202),
  ('ech_gourmand', 'grandmaitre', 5, 'Le gourmand', 'Prendre 50 pièces (cumul)', 'echecs', '{"agg":"sum","stat":"captures","threshold":50}'::jsonb, true, 2203),
  ('ech_partie_fleuve', 'grandmaitre', 6, 'Partie fleuve', 'Finir une manche de 40 coups ou plus', 'echecs', '{"agg":"max","stat":"max_moves","threshold":40}'::jsonb, true, 2204),
  ('ech_au_chaud', 'grandmaitre', 7, 'Bien au chaud', 'Roquer 10 fois (cumul)', 'echecs', '{"agg":"sum","stat":"castles","threshold":10}'::jsonb, true, 2205),
  ('ech_en_passant', 'grandmaitre', 8, 'En passant', 'Réussir une prise en passant', 'echecs', '{"agg":"sum","stat":"en_passants","threshold":1}'::jsonb, true, 2206),
  ('ech_nouvelle_reine', 'grandmaitre', 9, 'Nouvelle reine', 'Promouvoir 3 pions (cumul)', 'echecs', '{"agg":"sum","stat":"promotions","threshold":3}'::jsonb, true, 2207),
  ('ech_et_mat', 'grandmaitre', 10, 'Échec et mat !', 'Gagner 5 manches par échec et mat (cumul)', 'echecs', '{"agg":"sum","stat":"mates","threshold":5}'::jsonb, true, 2208),
  ('ech_mat_eclair', 'grandmaitre', 11, 'Mat éclair', 'Mater en 15 coups ou moins', 'echecs', '{"agg":"sum","stat":"fast_mates","threshold":1}'::jsonb, true, 2209),
  ('ech_grand_maitre', 'grandmaitre', 12, 'Grand Maître', 'Gagner 25 duels (cumul)', 'echecs', '{"agg":"sum","stat":"duel_wins","threshold":25}'::jsonb, true, 2210),
  ('kems_faux_kems', 'cowboy', 2, 'Faux Kems !', 'Crier « Kems ! » alors que ton partenaire n''a pas de carré', 'kems', '{"agg":"sum","stat":"false_kems","threshold":1}'::jsonb, true, 2300),
  ('kems_grille', 'cowboy', 3, 'Grillé !', 'Ton équipe subit 3 Contre-Kems réussis (cumul)', 'kems', '{"agg":"sum","stat":"countered","threshold":3}'::jsonb, true, 2301),
  ('kems_parano', 'cowboy', 4, 'Parano', 'Crier « Contre-Kems ! » à tort 3 fois (cumul)', 'kems', '{"agg":"sum","stat":"false_counters","threshold":3}'::jsonb, true, 2302),
  ('kems_collectionneur', 'cowboy', 5, 'Collectionneur', 'Réunir 10 carrés (cumul, un par manche au plus)', 'kems', '{"agg":"sum","stat":"squares","threshold":10}'::jsonb, true, 2303),
  ('kems_pilier_de_saloon', 'cowboy', 6, 'Pilier de saloon', 'Jouer 10 parties (cumul)', 'kems', '{"agg":"count","threshold":10}'::jsonb, true, 2304),
  ('kems_complices', 'cowboy', 7, 'Complices', 'Réussir 10 Kems avec son équipe (cumul)', 'kems', '{"agg":"sum","stat":"team_kems","threshold":10}'::jsonb, true, 2305),
  ('kems_oeil_de_lynx', 'cowboy', 8, 'Œil de lynx', 'Réussir 3 Contre-Kems en étant celui qui crie (cumul)', 'kems', '{"agg":"sum","stat":"counters_ok","threshold":3}'::jsonb, true, 2306),
  ('kems_eclair', 'cowboy', 9, 'Kems éclair', 'Réussir un Kems moins de 20 s après le début de la manche', 'kems', '{"agg":"sum","stat":"fast_kems","threshold":1}'::jsonb, true, 2307),
  ('kems_poker_face', 'cowboy', 10, 'Poker face', 'Gagner une partie sans erreur de son équipe et sans se faire contrer', 'kems', '{"agg":"sum","stat":"clean_win","threshold":1}'::jsonb, true, 2308),
  ('kems_double', 'cowboy', 11, 'Double Kems', 'Réussir un Double Kems (les deux coéquipiers ont un carré)', 'kems', '{"agg":"sum","stat":"double_kems","threshold":1}'::jsonb, true, 2309),
  ('kems_legende', 'cowboy', 12, 'Légende du saloon', 'Gagner 15 parties (cumul)', 'kems', '{"agg":"sum","stat":"won","threshold":15}'::jsonb, true, 2310),
  ('mg_plouf', 'golfer', 2, 'Plouf !', '3 balles à l''eau en une partie', 'mini-golf', '{"agg":"max","stat":"water","threshold":3}'::jsonb, true, 2400),
  ('mg_don_quichotte', 'golfer', 3, 'Don Quichotte', 'Se faire renvoyer la balle par le moulin 5 fois (cumul)', 'mini-golf', '{"agg":"sum","stat":"mill_hits","threshold":5}'::jsonb, true, 2401),
  ('mg_ramassee', 'golfer', 4, 'Balle ramassée', 'Ne pas rentrer la balle en 6 coups sur un trou', 'mini-golf', '{"agg":"sum","stat":"picked_up","threshold":1}'::jsonb, true, 2402),
  ('mg_habitue', 'golfer', 5, 'Habitué du parcours', 'Jouer 10 parties (cumul)', 'mini-golf', '{"agg":"count","threshold":10}'::jsonb, true, 2403),
  ('mg_regulier', 'golfer', 6, 'Régulier', '50 trous finis dans le par ou mieux (cumul)', 'mini-golf', '{"agg":"sum","stat":"pars","threshold":50}'::jsonb, true, 2404),
  ('mg_petit_oiseau', 'golfer', 7, 'Petit oiseau', '10 trous finis en un coup de moins que le par (cumul)', 'mini-golf', '{"agg":"sum","stat":"birdies","threshold":10}'::jsonb, true, 2405),
  ('mg_par_la_bande', 'golfer', 8, 'Par la bande', 'Rentrer la balle après 3 rebonds ou plus dans le même coup', 'mini-golf', '{"agg":"max","stat":"bank_shot","threshold":1}'::jsonb, true, 2406),
  ('mg_trou_en_un', 'golfer', 9, 'Trou en un !', 'Rentrer la balle du premier coup', 'mini-golf', '{"agg":"max","stat":"aces","threshold":1}'::jsonb, true, 2407),
  ('mg_sous_le_par', 'golfer', 10, 'Sous le par', 'Finir un parcours de 9 trous sous le par', 'mini-golf', '{"agg":"max","stat":"under_par","threshold":1}'::jsonb, true, 2408),
  ('mg_sans_bavure', 'golfer', 11, 'Sans bavure', '9 trous sans jamais dépasser le par', 'mini-golf', '{"agg":"max","stat":"clean_card","threshold":1}'::jsonb, true, 2409),
  ('mg_legende', 'golfer', 12, 'Légende du green', 'Gagner 15 parties (cumul)', 'mini-golf', '{"agg":"sum","stat":"won","threshold":15}'::jsonb, true, 2410),
  ('party_coupure_pub', 'host', 2, 'Coupure pub', 'S''arrêter sur 3 Pages de pub en une partie', 'dede-party', '{"agg":"max","stat":"pubs","threshold":3}'::jsonb, true, 2500),
  ('party_fauche', 'host', 3, 'Fauché', 'Tomber à 0 pièce', 'dede-party', '{"agg":"sum","stat":"broke","threshold":1}'::jsonb, true, 2501),
  ('party_ciel_couvert', 'host', 4, 'Ciel couvert', 'Finir une partie sans aucune étoile', 'dede-party', '{"agg":"sum","stat":"no_star","threshold":1}'::jsonb, true, 2502),
  ('party_fidele', 'host', 5, 'Fidèle au poste', 'Jouer 5 parties (cumul)', 'dede-party', '{"agg":"count","threshold":5}'::jsonb, true, 2503),
  ('party_tirelire', 'host', 6, 'Tirelire', 'Gagner 300 pièces (cumul)', 'dede-party', '{"agg":"sum","stat":"coins_earned","threshold":300}'::jsonb, true, 2504),
  ('party_chouchou', 'host', 7, 'Chouchou de Dédé', 'Ouvrir 10 enveloppes surprise (cumul)', 'dede-party', '{"agg":"sum","stat":"envelopes","threshold":10}'::jsonb, true, 2505),
  ('party_pile_dessus', 'host', 8, 'Pile dessus', 'Acheter une étoile en s''arrêtant exactement sur sa case', 'dede-party', '{"agg":"sum","stat":"star_exact","threshold":1}'::jsonb, true, 2506),
  ('party_triple', 'host', 9, 'Le triplé', 'Gagner 3 mini-jeux d''affilée', 'dede-party', '{"agg":"max","stat":"mg_streak","threshold":3}'::jsonb, true, 2507),
  ('party_constellation', 'host', 10, 'Constellation', 'Finir avec plein d''étoiles : 3 ★ en 6 tours, 4 ★ en 9, 5 ★ en 12 (à 5 joueurs et plus : 3, 3 et 4 ★)', 'dede-party', '{"agg":"max","stat":"constellation","threshold":1}'::jsonb, true, 2508),
  ('party_carton_plein', 'host', 11, 'Carton plein', 'Gagner la partie en étant aussi Roi des mini-jeux', 'dede-party', '{"agg":"sum","stat":"win_mvp","threshold":1}'::jsonb, true, 2509),
  ('party_star_ecran', 'host', 12, 'Star du petit écran', 'Gagner 10 parties (cumul)', 'dede-party', '{"agg":"sum","stat":"won","threshold":10}'::jsonb, true, 2510),
  ('gen_touche_a_tout', null, null, 'Touche-à-tout', 'Jouer à 10 jeux différents', null, '{"agg":"special","name":"distinct_games","threshold":10}'::jsonb, true, 221),
  ('gen_polyvalent', null, null, 'Polyvalent', 'Gagner dans 5 jeux différents', null, '{"agg":"special","name":"distinct_win_games","threshold":5}'::jsonb, true, 222),
  ('gen_pilier', null, null, 'Pilier de soirée', 'Participer à 20 soirées', null, '{"agg":"special","name":"soirees","threshold":20}'::jsonb, true, 223),
  ('gen_noctambule', null, null, 'Noctambule', 'Finir 3 soirées après 2 h du matin', null, '{"agg":"special","name":"late_soirees","threshold":3}'::jsonb, true, 224),
  ('gen_marathon', null, null, 'Marathonien', 'Jouer 8 parties dans une même soirée', null, '{"agg":"special","name":"games_in_soiree","threshold":8}'::jsonb, true, 225),
  ('gen_hote', null, null, 'Hôte de la maison', 'Organiser 5 soirées menées à leur terme', null, '{"agg":"special","name":"hosted","threshold":5}'::jsonb, true, 226),
  ('gen_grande_tablee', null, null, 'Grande tablée', 'Participer à une soirée de 6 joueurs ou plus', null, '{"agg":"special","name":"biggest_table","threshold":6}'::jsonb, true, 227),
  ('gen_pipelette', null, null, 'Pipelette', 'Envoyer 50 stickers dans le chat', null, '{"agg":"special","name":"stickers","threshold":50}'::jsonb, true, 228),
  ('gen_garde_robe', null, null, 'Garde-robe', 'Débloquer 5 tenues', null, '{"agg":"special","name":"tenues","threshold":5}'::jsonb, true, 229),
  ('gen_collectionneur', null, null, 'Collectionneur', 'Compléter une planche de tenue (les 11 trophées)', null, '{"agg":"special","name":"full_board","threshold":11}'::jsonb, true, 230),
  ('gen_madame_irma', null, null, 'Madame Irma', '3 bons pronostics d''affilée', null, '{"agg":"special","name":"prono_streak","threshold":3}'::jsonb, true, 231),
  ('gen_esprit_noel', null, null, 'Esprit de Noël', 'Ouvrir 12 cases du calendrier de l''Avent', null, '{"agg":"special","name":"advent","threshold":12}'::jsonb, true, 232)
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
revoke all on function public._trophy_reward_tenue() from public, anon, authenticated;
revoke all on function public.my_trophy_progress(text) from public, anon;
grant execute on function public.my_trophy_progress(text) to authenticated;


-- ===== features\weekly.sql =====
-- =============================================================================
-- CLASSEMENT DE LA SEMAINE + « VICTORIEUX DE LA SEMAINE » — idempotent, après schema.sql.
-- Aucune table : tout est dérivé de match_players / matches (parties terminées).
--
-- Semaine = lundi 00:00 -> dimanche 23:59:59 (fuseau Europe/Paris), comme daily_week_board.
-- Date d'une victoire = matches.finished_at. Une semaine appartient au lundi qui l'ouvre.
-- Classement : victoires desc, puis points desc, puis moins de parties jouées ; rang « compétition ».
-- Champion d'une semaine TERMINÉE : le(s) joueur(s) ayant le plus de victoires (tous jeux),
-- au moins 1 victoire ; ex-aequo = tous champions. La semaine en cours n'en désigne jamais.
-- =============================================================================

create index if not exists matches_finished_at_idx on public.matches(finished_at) where status = 'finished';

-- Lundi (date Paris) de la semaine en cours.
create or replace function public._week_start_now()
returns date language sql stable
as $$ select date_trunc('week', now() at time zone 'Europe/Paris')::date $$;

-- Champions de chaque semaine terminée (jeux confondus, ex-aequo inclus).
-- Ne renvoie que les champions des semaines terminées : (week_start lundi, profile_id, wins).
create or replace function public._weekly_champions_all()
returns table (week_start date, profile_id uuid, wins integer)
language sql stable security definer
set search_path = public, extensions
as $$
  with w as (
    select date_trunc('week', m.finished_at at time zone 'Europe/Paris')::date as ws,
           x.profile_id, count(*)::int as wins
      from public.match_players x
      join public.matches m on m.id = x.match_id and m.status = 'finished' and m.finished_at is not null
      join public.profiles gp on gp.id = x.profile_id and not gp.is_guest  -- invités exclus (guest.sql)
     where x.won
     group by 1, 2
  ), top as (
    select w.*, max(w.wins) over (partition by w.ws) as best from w
  )
  select t.ws, t.profile_id, t.wins
    from top t
   where t.wins = t.best and t.wins >= 1 and t.ws < public._week_start_now()
$$;

-- Classement de la semaine en cours (général si p_game est null, sinon pour ce jeu).
-- -> {week_start, week_end (dimanche), ends_at (timestamptz, fin de semaine),
--     rows:[{profile_id, slug, nickname, equipped_expression, equipped_tenue, level, wins, games_played, points, rank}],
--     last_week:{week_start, week_end, wins, champions:[{profile_id, slug, nickname, equipped_tenue}]}|null}
-- rows contient tous les joueurs (0 partie incluse), le front filtre.
create or replace function public.leaderboard_week(p_game text default null)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_start date := public._week_start_now();
  v_from  timestamptz := v_start::timestamp at time zone 'Europe/Paris';
  v_to    timestamptz := (v_start + 7)::timestamp at time zone 'Europe/Paris';
  v_last  date;
begin
  perform public._require_profile();
  select max(c.week_start) into v_last from public._weekly_champions_all() c;
  return jsonb_build_object(
    'week_start', v_start,
    'week_end', v_start + 6,
    'ends_at', v_to,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'profile_id', r.id, 'slug', r.slug, 'nickname', r.nickname,
               'equipped_expression', r.equipped_expression, 'equipped_tenue', r.equipped_tenue,
               'level', public.level_for_xp(r.xp), 'wins', r.wins, 'games_played', r.games,
               'points', r.pts, 'rank', r.rk) order by r.rk, r.sort_order)
        from (
          select a.*, rank() over (order by a.wins desc, a.pts desc, a.games asc) as rk
            from (
              select p.id, p.slug, p.nickname, p.equipped_expression, p.equipped_tenue, p.xp, p.sort_order,
                     count(mp.profile_id) filter (where mp.won)::int as wins,
                     count(mp.profile_id)::int as games,
                     coalesce(sum(mp.points), 0)::int as pts
                from public.profiles p
                left join (
                  select x.profile_id, x.won, x.points
                    from public.match_players x
                    join public.matches m on m.id = x.match_id
                   where m.status = 'finished' and m.finished_at >= v_from and m.finished_at < v_to
                     and (p_game is null or x.game_id = p_game)
                ) mp on mp.profile_id = p.id
               where not p.is_guest  -- invités exclus (guest.sql)
               group by p.id
            ) a
        ) r), '[]'::jsonb),
    'last_week', case when v_last is null then null else (
      select jsonb_build_object(
               'week_start', v_last, 'week_end', v_last + 6, 'wins', max(c.wins),
               'champions', jsonb_agg(jsonb_build_object(
                  'profile_id', p.id, 'slug', p.slug, 'nickname', p.nickname, 'equipped_tenue', p.equipped_tenue)
                  order by p.sort_order))
        from public._weekly_champions_all() c join public.profiles p on p.id = c.profile_id
       where c.week_start = v_last) end);
end $$;

-- Semaines gagnées (« Victorieux de la semaine »), plus récentes d'abord.
-- p_profile = un joueur -> ses semaines ; null -> toutes les semaines gagnées par tous (hall of fame).
-- -> [{week_start, week_end, wins, profile_id, slug, nickname, equipped_tenue}]
create or replace function public.weekly_champions(p_profile uuid default null)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
begin
  perform public._require_profile();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'week_start', c.week_start, 'week_end', c.week_start + 6, 'wins', c.wins,
             'profile_id', p.id, 'slug', p.slug, 'nickname', p.nickname, 'equipped_tenue', p.equipped_tenue)
             order by c.week_start desc, p.sort_order)
      from public._weekly_champions_all() c
      join public.profiles p on p.id = c.profile_id
     where p_profile is null or c.profile_id = p_profile), '[]'::jsonb);
end $$;

revoke all on function public._week_start_now() from public, anon, authenticated;
revoke all on function public._weekly_champions_all() from public, anon, authenticated;
revoke all on function public.leaderboard_week(text) from public, anon;
revoke all on function public.weekly_champions(uuid) from public, anon;
grant execute on function public.leaderboard_week(text) to authenticated;
grant execute on function public.weekly_champions(uuid) to authenticated;


-- ===== features\wrapped.sql =====
-- =============================================================================
-- MON ANNEE (Wrapped annuel) - idempotent, execute en features/* (apres stats, trophees, tenues, daily).
-- year_wrapped(p_year) : stats du joueur CONNECTE pour l'annee civile (heure de Paris).
-- jsonb : { year, profile:{id,slug,nickname,equipped_tenue}, games_played, wins, win_rate, soirees,
--   distinct_games,
--   favorite_game:{game_id,played}|null, best_game:{game_id,played,wins,win_rate}|null,
--   longest_soiree:{soiree_id,minutes,started_at,games}|null,
--   latest_match:{at:'HH:MI', hour, game_id, day}|null  (parties jouees entre 18h et 5h59, la plus tardive),
--   night_games (parties finies entre 0h et 5h59),
--   rival:{profile_id,slug,nickname,equipped_tenue,losses}|null  (>= 2 defaites contre lui),
--   buddy:{profile_id,slug,nickname,equipped_tenue,together}|null, distinct_mates,
--   trophies:{count, recent:[{id,name}]}, tenues:{count, recent:[{id,label,emoji}]},
--   daily:{days, best_streak},
--   personality:{id} }
-- ids de personnalite : noctambule, champion, assidu, collectionneur, sociable, touche_a_tout, fidele,
--   bon_joueur, curieux
-- Volatile (table temporaire locale a la transaction) : appelee en POST par rpc().
-- =============================================================================

create or replace function public.year_wrapped(p_year integer)
returns jsonb language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  v_me     uuid := public._require_profile();
  p        public.profiles%rowtype;
  v_from   timestamp;
  v_to     timestamp;
  v_pg     jsonb;
  v_played int;
  v_wins   int;
  v_soir   int;
  v_long   jsonb;
  v_late   jsonb;
  v_night  int;
  v_rival  jsonb;
  v_buddy  jsonb;
  v_mates  int;
  v_trc    int;
  v_trl    jsonb;
  v_tnc    int;
  v_tnl    jsonb;
  v_dd     int;
  v_ds     int;
  v_dg     int;
  v_rate   int;
  v_pers   text;
begin
  if p_year is null or p_year < 2000 or p_year > 2200 then raise exception 'invalid_year'; end if;
  select * into p from public.profiles where id = v_me;
  v_from := make_timestamp(p_year, 1, 1, 0, 0, 0);
  v_to   := make_timestamp(p_year + 1, 1, 1, 0, 0, 0);

  create temp table if not exists _ywm (mid uuid, sid uuid, game_id text, at_p timestamp, won boolean) on commit drop;
  truncate _ywm;
  insert into _ywm
    select m.id, m.soiree_id, m.game_id, (m.finished_at at time zone 'Europe/Paris'), x.won
      from public.match_players x join public.matches m on m.id = x.match_id
     where x.profile_id = v_me and m.status = 'finished' and m.finished_at is not null
       and (m.finished_at at time zone 'Europe/Paris') >= v_from and (m.finished_at at time zone 'Europe/Paris') < v_to;

  select count(*)::int, count(*) filter (where won)::int into v_played, v_wins from _ywm;
  v_rate := case when v_played > 0 then round(v_wins * 100.0 / v_played)::int else 0 end;

  select coalesce(jsonb_agg(jsonb_build_object('game_id', g.game_id, 'played', g.played, 'wins', g.wins)
                            order by g.played desc, g.wins desc, g.game_id), '[]'::jsonb)
    into v_pg
    from (select game_id, count(*)::int as played, count(*) filter (where won)::int as wins from _ywm group by game_id) g;
  v_dg := jsonb_array_length(v_pg);

  select count(distinct sid)::int into v_soir from _ywm;

  select jsonb_build_object('soiree_id', s.id, 'minutes', round(extract(epoch from (s.ended_at - s.started_at)) / 60)::int,
                            'started_at', s.started_at,
                            'games', (select count(*)::int from _ywm y where y.sid = s.id))
    into v_long
    from public.soirees s
   where s.id in (select sid from _ywm) and s.started_at is not null and s.ended_at is not null
   order by (s.ended_at - s.started_at) desc, s.id
   limit 1;

  -- « le plus tard » : de 18h a 5h59, on mesure en heures decalees (0h = 24h, 5h = 29h)
  select jsonb_build_object('at', to_char(y.at_p, 'HH24:MI'), 'hour', extract(hour from y.at_p)::int,
                            'game_id', y.game_id, 'day', to_char(y.at_p, 'YYYY-MM-DD'))
    into v_late
    from _ywm y
   where extract(hour from y.at_p) >= 18 or extract(hour from y.at_p) < 6
   order by (extract(epoch from y.at_p::time) / 3600.0 + case when extract(hour from y.at_p) < 18 then 24 else 0 end) desc
   limit 1;
  select count(*)::int into v_night from _ywm y where extract(hour from y.at_p) < 6;

  select jsonb_build_object('profile_id', r.pid, 'slug', pr.slug, 'nickname', pr.nickname,
                            'equipped_tenue', pr.equipped_tenue, 'losses', r.n)
    into v_rival
    from (select w.profile_id as pid, count(*)::int as n
            from _ywm me
            join public.match_players w on w.match_id = me.mid and w.won and w.profile_id <> v_me
            join public.profiles gw on gw.id = w.profile_id and not gw.is_guest  -- invites exclus
           where not me.won
           group by w.profile_id
          having count(*) >= 2
           order by count(*) desc, w.profile_id limit 1) r
    join public.profiles pr on pr.id = r.pid and not pr.is_guest;

  select count(*)::int into v_mates
    from (select distinct o.profile_id from _ywm me join public.match_players o on o.match_id = me.mid and o.profile_id <> v_me
            join public.profiles go on go.id = o.profile_id and not go.is_guest) d;
  select jsonb_build_object('profile_id', r.pid, 'slug', pr.slug, 'nickname', pr.nickname,
                            'equipped_tenue', pr.equipped_tenue, 'together', r.n)
    into v_buddy
    from (select o.profile_id as pid, count(*)::int as n
            from _ywm me join public.match_players o on o.match_id = me.mid and o.profile_id <> v_me
            join public.profiles go on go.id = o.profile_id and not go.is_guest
           group by o.profile_id order by count(*) desc, o.profile_id limit 1) r
    join public.profiles pr on pr.id = r.pid and not pr.is_guest;

  select count(*)::int into v_trc from public.trophy_unlocks u
   where u.profile_id = v_me and (u.unlocked_at at time zone 'Europe/Paris') >= v_from and (u.unlocked_at at time zone 'Europe/Paris') < v_to;
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.at desc), '[]'::jsonb) into v_trl
    from (select tr.id, tr.name, u.unlocked_at as at from public.trophy_unlocks u join public.trophies tr on tr.id = u.trophy_id
           where u.profile_id = v_me and (u.unlocked_at at time zone 'Europe/Paris') >= v_from and (u.unlocked_at at time zone 'Europe/Paris') < v_to
           order by u.unlocked_at desc limit 3) t;

  select count(*)::int into v_tnc from public.tenue_unlocks u
   where u.profile_id = v_me and (u.unlocked_at at time zone 'Europe/Paris') >= v_from and (u.unlocked_at at time zone 'Europe/Paris') < v_to;
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'label', t.label, 'emoji', t.emoji) order by t.at desc), '[]'::jsonb) into v_tnl
    from (select te.id, te.label, te.emoji, u.unlocked_at as at from public.tenue_unlocks u join public.tenues te on te.id = u.tenue_id
           where u.profile_id = v_me and (u.unlocked_at at time zone 'Europe/Paris') >= v_from and (u.unlocked_at at time zone 'Europe/Paris') < v_to
           order by u.unlocked_at desc limit 3) t;

  -- defi du jour : jours termines et plus longue serie de jours consecutifs dans l'annee
  select coalesce(max(c), 0)::int into v_ds
    from (select count(*) over (partition by grp) as c
            from (select day, day - (row_number() over (order by day))::int as grp
                    from public.daily_runs
                   where profile_id = v_me and finished_at is not null and day >= v_from::date and day < v_to::date) a) b;
  select count(*)::int into v_dd from public.daily_runs
   where profile_id = v_me and finished_at is not null and day >= v_from::date and day < v_to::date;

  v_pers := case
    when v_played = 0 then 'curieux'
    when v_night >= 3 and v_night * 100 >= v_played * 15 then 'noctambule'
    when v_played >= 10 and v_rate >= 55 then 'champion'
    when v_ds >= 7 then 'assidu'
    when v_trc >= 8 then 'collectionneur'
    when v_mates >= 6 then 'sociable'
    when v_dg >= 8 then 'touche_a_tout'
    when v_soir >= 8 then 'fidele'
    else 'bon_joueur' end;

  return jsonb_build_object(
    'year', p_year,
    'profile', jsonb_build_object('id', p.id, 'slug', p.slug, 'nickname', p.nickname, 'equipped_tenue', p.equipped_tenue),
    'games_played', v_played, 'wins', v_wins, 'win_rate', v_rate, 'soirees', v_soir,
    'distinct_games', v_dg,
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
    'longest_soiree', v_long,
    'latest_match', v_late,
    'night_games', v_night,
    'rival', v_rival,
    'buddy', v_buddy,
    'distinct_mates', v_mates,
    'trophies', jsonb_build_object('count', v_trc, 'recent', v_trl),
    'tenues', jsonb_build_object('count', v_tnc, 'recent', v_tnl),
    'daily', jsonb_build_object('days', v_dd, 'best_streak', v_ds),
    'personality', jsonb_build_object('id', v_pers));
end $$;

revoke all on function public.year_wrapped(integer) from public, anon;
grant execute on function public.year_wrapped(integer) to authenticated;


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
--                (up >= down, égalité = réussi) → +1 point. Le désigné peut {"type":"refuse"} →
--                gage tiré au sort, 0 point. Échéance dure 150 s.
--   4. result  : `last_result`. {"type":"next"} (hôte) → tour suivant ou fin ;
--                échéance 12 s (option `auto`) ou 25 s sinon, puis tick.
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
    when 'auto' then 12       -- passage automatique au tour suivant (option « enchaînement auto »)
    when 'result' then 25     -- passage au tour suivant sans l'hôte (hors option auto)
    when 'grace' then 5       -- grâce avant fermeture anticipée du jugement (résultat acquis)
  end
$$;

-- Échéance ISO UTC millisecondes (Safari n'aime pas le format brut de timestamptz).
create or replace function public._aov_iso(p_ts timestamptz)
returns text language sql stable
set search_path = public, extensions
as $$
  select to_char(p_ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
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
        'until', public._aov_iso(v_until)),
    'deadline', public._aov_iso(v_until + make_interval(secs => public._aov_const('choose'))),
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
    'deadline', public._aov_iso(now() + make_interval(secs => public._aov_const('vote'))),
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
    'deadline', public._aov_iso(now() + make_interval(secs => public._aov_const('perform'))),
    'timer_until', case when v_soft and p_state->>'kind' = 'action'
                        then to_jsonb(public._aov_iso(now() + make_interval(secs => public._aov_const('reveal') + public._aov_const('soft'))))
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
  elsif v_up >= v_down then   -- égalité = réussi
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
    'deadline', public._aov_iso(now() + make_interval(secs => public._aov_const(case when v_auto then 'auto' else 'result' end))),
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
           'text', btrim(e->>'text'))
         -- `by` : id du profil auteur d'une carte maison (optionnel, voir features/cartes-maison.sql)
         || case when (e->>'by') ~ '^[0-9a-f-]{36}$' then jsonb_build_object('by', e->>'by') else '{}'::jsonb end
         order by o), '[]'::jsonb)
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
  v_up       integer;
  v_down     integer;
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
    -- Résultat acquis (majorité absolue des votants possibles, irréversible) :
    -- on raccourcit l'échéance à ~5 s de grâce, le tick ferme le tour.
    select count(*) filter (where value = 'true'), count(*) filter (where value = 'false')
      into v_up, v_down from jsonb_each_text(p_server->'result_votes');
    if (2 * v_up >= cardinality(v_voters) or 2 * v_down > cardinality(v_voters))
       and (v_deadline is null or v_deadline > now() + make_interval(secs => public._aov_const('grace'))) then
      p_state := p_state || jsonb_build_object('deadline',
                   public._aov_iso(now() + make_interval(secs => public._aov_const('grace'))));
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

revoke all on function public._aov_iso(timestamptz) from public, anon, authenticated;
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
    'idle_deadline', null,
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
    if p_state->>'idle_deadline' is not null
       and now() > (p_state->>'idle_deadline')::timestamptz + interval '3 seconds' then
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
    -- Il ne reste qu'un joueur : fin automatique 90 s apres son dernier lancer
    -- (veille, 3D plantee...). Chaque lancer du retardataire repousse l'echeance.
    if jsonb_array_length(p_state->'done') >= jsonb_array_length(p_state->'players') - 1 then
      p_state := p_state || jsonb_build_object('idle_deadline', to_jsonb(now() + interval '90 seconds'));
    end if;
    return jsonb_build_object('state', p_state, 'server', p_server);

  -- ---------------------------------------------------------------- tick
  elsif v_type = 'tick' then
    if v_phase = 'playing' and (v_late or (p_state->>'idle_deadline' is not null
                                           and now() >= (p_state->>'idle_deadline')::timestamptz)) then
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
  p_server := p_server || jsonb_build_object('picks', '{}'::jsonb, 'tries', '{}'::jsonb, 'wrong', '{}'::jsonb);
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
      -- mauvaises propositions tapées (2 dernières par joueur) : {profile_id: [texte, ...]}
      'wrong', coalesce(p_server->'wrong', '{}'::jsonb),
      'points', v_points),
    'history', coalesce(p_state->'history', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'round', v_round,
      'id', v_q->'id',
      'theme', v_q->'theme',
      'prompt', v_q->'prompt',
      'answer', v_q->'answer',
      'mode', v_q->'mode',
      'found', p_state->'found',
      'wrong', coalesce(p_server->'wrong', '{}'::jsonb))));
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
  -- Accélérateur : dès que la majorité a trouvé ou passé, il ne reste que 8 s (jamais allongé).
  if (select count(*) from jsonb_array_elements_text(p_state->'players') pl
       where p_state->'passed' ? pl
          or exists (select 1 from jsonb_array_elements(p_state->'found') f where f->>'profile_id' = pl))
     * 2 > jsonb_array_length(p_state->'players')
     and (p_state->>'deadline')::timestamptz > now() + interval '8 seconds' then
    p_state := p_state || jsonb_build_object('deadline', to_jsonb(now() + interval '8 seconds'));
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
      -- garde les 2 dernières mauvaises propositions (révélation / fin de partie)
      p_server := jsonb_set(p_server, array['wrong', v_me],
        (select coalesce(jsonb_agg(x order by o), '[]'::jsonb) from (
           select x, o from jsonb_array_elements(
             coalesce(p_server->'wrong'->v_me, '[]'::jsonb) || to_jsonb(left(btrim(p_action->>'text'), 30))
           ) with ordinality as t(x, o) order by o desc limit 2) z), true);
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
-- Course terminée : tous arrivés, 45 s après le 1er arrivé, ou échéance de sécurité.
--
-- 6 circuits (ordre de src/games/dede-kart/tracks.ts) : 0 Salon, 1 Plage, 2 Montagne,
-- 3 Potager, 4 Supermarché, 5 Château. La course n joue le circuit (track0 + n - 1) % 6,
-- track0 = option "track" (0..5) ou tiré au hasard.
-- =============================================================================

-- Temps minimum d'un tour (ms) par circuit : (longueur du tour - gain du raccourci) parcourue
-- à la vitesse d'un turbo permanent, moins 10 % (un très bon tour réel dure 45 à 55 s).
create or replace function public._dk_min_lap_ms(p_track integer)
returns integer language sql immutable
set search_path = public, extensions
as $$ select (array[31000, 34000, 34000, 31000, 33000, 32000])[coalesce(p_track, 0) % 6 + 1] $$;

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
    'track', (coalesce((p_state->>'track0')::integer, 0) + p_race - 1) % 6,
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

-- Retire boules (> 6 s), pièges posés (glue, beurre, poule : > 30 s) et effets expirés.
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
    'win_track_1', count(*) filter (where place = 1 and track = 0),
    'win_track_2', count(*) filter (where place = 1 and track = 1),
    'win_track_3', count(*) filter (where place = 1 and track = 2),
    'win_track_4', count(*) filter (where place = 1 and track = 3),
    'win_track_5', count(*) filter (where place = 1 and track = 4),
    'win_track_6', count(*) filter (where place = 1 and track = 5),
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

-- Options : {"races": 1|3 (défaut 3), "laps": 2|3 (défaut 3), "fill": 0|6|8|12 (bots pour compléter la grille),
--            "track": 0..5 (1er circuit ; absent ou autre valeur = tiré au hasard)}
create or replace function public.game_dede_kart_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_n     integer := coalesce(cardinality(p_players), 0);
  v_races integer := case when p_options->>'races' = '1' then 1 else 3 end;
  v_laps  integer := case when p_options->>'laps' = '2' then 2 else 3 end;
  v_fill  integer := case when coalesce(p_options->>'fill', '') ~ '^\d{1,2}$' then (p_options->>'fill')::integer else 0 end;
  v_track integer := case when coalesce(p_options->>'track', '') ~ '^[0-5]$' then (p_options->>'track')::integer
                          else floor(random() * 6)::integer end;
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
    'track0', v_track,
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
                     least((p_state->>'deadline')::timestamptz, now() + interval '45 seconds'));
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
    if v_item is null or v_item not in ('ball', 'glue', 'butter', 'hen', 'cloud', 'confetti', 'reverse', 'honk') then
      raise exception 'invalid_action';
    end if;
    if (p_state->'finish') ? v_id then return jsonb_build_object('state', p_state, 'server', p_server); end if;
    p_state := public._dk_prune(p_state);
    v_seq := coalesce((p_state->>'hz_seq')::integer, 0);
    if v_item in ('ball', 'glue', 'butter', 'hen') then
      v_seq := v_seq + 1;
      p_state := p_state || jsonb_build_object('hazards', p_state->'hazards' || jsonb_build_array(jsonb_build_object(
        'id', v_seq, 'type', v_item, 'owner', v_id,
        'x', public._dk_num(p_action->'x'), 'z', public._dk_num(p_action->'z'), 'h', public._dk_num(p_action->'h'),
        'at', now())));
    else
      if jsonb_typeof(p_action->'targets') <> 'array' then raise exception 'invalid_action'; end if;
      -- Trophées (Coups bas) : objets nuage / confettis / demi-tour (/ klaxon) utilisés
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

  -- ---------------------------------------------------------------- hit (un kart a percuté une boule / une glue / du beurre / une poule)
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
