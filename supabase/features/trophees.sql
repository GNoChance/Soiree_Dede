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
