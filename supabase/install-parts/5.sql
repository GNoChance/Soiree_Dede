-- MORCEAU 5 / 5 — -- GÉNÉRÉ par scripts/build-sql.mjs — ne pas éditer. Idempotent. À exécuter dans l'ordre (1, puis 2…) dans Supabase > SQL Editor > Run.

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
         -- `by` : id du profil auteur d'une carte maison (optionnel, voir features/cartes-maison.sql)
         || case when (e->>'by') ~ '^[0-9a-f-]{36}$' then jsonb_build_object('by', e->>'by') else '{}'::jsonb end
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
