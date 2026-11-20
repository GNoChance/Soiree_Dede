# Mini-golf — conception

Jeu n°24 des Soirées de Dédé, id `mini-golf`. Mini-golf 3D tactile, jeu **original** (aucun nom, parcours ou visuel d'un jeu existant).
**Statut : proposition à valider** (les choix à trancher par l'utilisateur sont en §9).
Troisième des 4 nouveaux jeux (ordre : Nom de Code → Échecs → Mini-golf → Dédé Party).

## 1. Intention

Le pendant « calme et rigolo » du bowling : chacun sur son téléphone, un geste unique (tirer en arrière, lâcher), des obstacles qui font rire
(le moulin qui renvoie la balle, le plouf dans le lavoir). Réussi si : on comprend le geste sans explication, une partie de 9 trous
dure **10-12 min quel que soit le nombre de joueurs**, on voit les balles des autres rouler à côté de la sienne, et ça tourne sur un téléphone moyen.

## 2. Règles

### Joueurs et déroulé — **simultané, synchronisé par trou** (choix tranché)
- 2 à 9 joueurs. **Tout le monde joue le même trou en même temps**, chacun avec sa balle, sur son téléphone.
- Le trou se termine quand **tous ont fini** ou à la fin du **chrono du trou** ; classement provisoire 6 s, puis trou suivant pour tout le monde.
- Pourquoi pas le tour par tour : 9 joueurs × 9 trous × ~3 coups × ~15 s = plus d'une heure, dont 8/9 du temps à attendre.
  En simultané la durée ne dépend pas du nombre de joueurs (≈ 75 s par trou).
- Pourquoi pas « chacun à son rythme » comme le bowling : synchronisé, tout le monde est sur le même trou, donc les **balles fantômes**
  ont un sens, on commente le même obstacle, et le classement entre deux trous crée le suspense. Celui qui a fini regarde les autres jouer (vue du trou, fantômes).
- Les balles ne se touchent pas (fantômes) : pas de physique partagée à synchroniser, personne ne gêne personne.

### Le coup
- **Glisser n'importe où sur l'écran** : on tire en arrière comme un lance-pierre ; une flèche part de la balle (direction opposée au doigt),
  sa longueur et sa couleur (vert → rouge) donnent la force. Lâcher = frapper. Ramener le doigt au point de départ = annuler.
- On ne rejoue que **balle arrêtée**. Vue fixe en plongée : le trou tient en entier dans l'écran portrait (pas de caméra à manipuler).
- **Balle à l'eau / hors piste** : la balle revient d'où elle a été frappée ; le coup compte, sans pénalité supplémentaire.

### Par, limite, score
- Chaque trou a un **par** (2 à 4). **6 coups maximum** par trou : si la balle n'est pas rentrée au 6e coup, ou à la fin du chrono, elle est
  « ramassée » → score du trou = **7**.
- Score de la partie = total des coups ; **le plus petit total gagne**. Égalité : victoire partagée.
- Affichage familial : « 3 coups (par 3) », pastille 🟢 sous le par / ⚪ dans le par / 🔴 au-dessus. Le mot « birdie » n'apparaît que dans les trophées.
- `finish_match` : `placement` = rang, `points = n − rang + 1`, `won` = rang 1 (ex aequo partagés).

### Parcours « La Kermesse du village » (9 trous, par 26)

| N° | Nom | Obstacle | Par |
|---|---|---|---|
| 1 | L'Échauffement | ligne droite, pour apprendre le geste | 2 |
| 2 | Le Virage du Boulanger | coude à 90°, on joue la bande | 2 |
| 3 | Les Quilles de Dédé | 5 plots fixes en quinconce (clin d'œil au bowling) | 3 |
| 4 | Le Pont du Lavoir | passerelle étroite au-dessus de l'eau | 3 |
| 5 | Le Moulin | pales qui tournent devant un tunnel | 3 |
| 6 | La Bosse des Vignes | deux bosses puis une cuvette (trop fort = ça ressort) | 3 |
| 7 | Le Flipper de la Kermesse | 3 bumpers qui renvoient la balle plus fort | 3 |
| 8 | Le Grand Huit | looping : assez d'élan sinon la balle redescend | 3 |
| 9 | Le Clocher | rampe vers un green surélevé ; la cloche sonne quand ça rentre | 4 |

Parcours **express** (option) : trous 1, 3, 5, 8, 9 (par 15, ≈ 6 min). *Remplacé le 2026-11-20 : voir « Trous 10 à 20 et parcours aléatoires » à la fin.*

### Options (hôte)
`{ "holes": 9 | 5, "timer": 60 | 90 | 0 }` — défaut 9 trous, 90 s par trou ; `0` = sans chrono (l'hôte a alors un bouton « Trou suivant »).

## 3. Architecture

Même principe que `bowling` et `dede-kart` : **le téléphone simule, le serveur valide et calcule le score**. Aucun nouveau mécanisme transverse.

### Physique et 3D (client) — `src/games/mini-golf/scene/`
- `three` + `cannon-es`, même découpage que `src/games/bowling/scene/` (`GolfScene.ts`, `Course.ts`, `physics.ts`, `input.ts`, `camera.ts`, `audio.ts`),
  **copié puis adapté** : on ne refactore pas le bowling. Chargé en différé par `Play` (lazy), pas de R3F.
- **Pas de maillage triangulé** (collisions sphère/trimesh peu fiables dans cannon-es) : un trou = assemblage de **primitives**
  (dalles et bordures en boîtes, rampes = boîtes inclinées, plots/bumpers = cylindres). Pas fixe 1/120 s, amortissement de roulement, vitesse max bornée (anti-tunnel).
- **Le trou n'est pas creusé** : la balle est « avalée » si elle passe à moins de R du centre sous une vitesse seuil (sinon elle saute par-dessus, avec une petite déviation). Animation de chute + son.
- **Moulin** : pales en corps cinématiques, angle = fonction de l'horloge serveur (`useServerClock`) → tout le monde voit le même moulin.
- **Bumpers** : impulsion ajoutée au contact. **Eau / hors piste** : zones rectangulaires déclaratives.
- **Looping** : segment **scripté** (pas de vraie physique dans la boucle) : à l'entrée, si la vitesse ≥ seuil, la balle suit une courbe et ressort avec
  une vitesse proportionnelle ; sinon elle monte un peu et redescend. C'est le seul obstacle « truqué », pour rester fiable.
- Trous décrits en données dans `holes.ts` (`{par, tee, cup, pieces[], water[], camera}`) : ajouter un trou = ajouter un objet.

### Fantômes (broadcast)
- Canal Realtime **broadcast** `golf:<matchId>` (comme `kart:<matchId>`), jamais en base : `{id, hole, x, y, z, n}` à ~8 Hz **pendant que la balle roule**,
  plus un message à l'arrêt et à l'entrée dans le trou.
- Les balles des autres : semi-transparentes, couleur du perso, mini-tête chibi au-dessus, interpolées, sans collision.

### Serveur — `supabase/games/mini-golf.sql` (préfixe `_mg_`)
- `game_mini_golf_start(p_players, p_options)` / `game_mini_golf_action(p_state, p_server, p_actor, p_is_host, p_action)`, idempotent, terminé par les `revoke`.
- Le serveur ne connaît que `_mg_course()` : par de chaque trou et liste des trous du parcours (dupliqué avec `holes.ts`, synchro vérifiée par le test).
- **Une seule écriture par joueur et par trou** (comme le `lap` de Dédé Kart) : `{"type":"hole","hole":h,"strokes":n,"holed":true|false,"stats":{…}}`
  → 81 écritures pour 9 joueurs × 9 trous. Le nombre de coups en cours est visible des autres via le broadcast.
- **State public** (miroir `types.ts`) : `phase` (`playing` | `hole_end` | `finished`), `hole` (index courant), `holes[]` (ids du parcours), `pars[]`, `timer`,
  `hole_started_at`, `deadline`, `players`, `cards{id: number[]}` (coups par trou), `totals{id}`, `done[]` (ont fini le trou courant), `last_hole{id, strokes}`, `winners`, `results`.
- **Actions** : `hole` (joueur) ; `tick` (échéance du trou → les absents prennent 7 ; échéance de `hole_end` → trou suivant) ; `next` (hôte, sans chrono ou pour couper) ; `end_game` (hôte : trous restants = 7).
- **Anti-triche minimal** (jeu entre amis, comme le bowling : le serveur ne peut pas vérifier la physique) : trou = trou courant, un seul envoi par trou
  (doublon ignoré sans erreur), `1 ≤ strokes ≤ 6`, `holed=false` → 7, et **temps minimum** `strokes × 1,5 s` écoulé depuis `hole_started_at` (sinon `too_fast`).
  Les compteurs de trophées (`stats`) sont déclarés par le client et bornés par le serveur.
- **Rechargement de page** : le téléphone garde `{match, hole, strokes, position}` en `sessionStorage` et reprend son trou ; à défaut il repart du tee avec son compteur.
- Nouveaux codes d'erreur (→ `errors.ts`) : `wrong_hole`, `invalid_strokes`, `too_fast`.

### Front — `src/games/mini-golf/`
`index.ts` (definition : `minPlayers: 2`, `maxPlayers: 9`, `order: 230`, emoji ⛳), `Play.tsx` (lazy), `Summary.tsx` (lazy), `Options.tsx`,
`types.ts`, `holes.ts`, `ScoreCard.tsx` (carte de score), `scene/`.

## 4. Écrans

1. **Options (hôte)** : 9 trous / Express 5 trous ; chrono 60 s / 90 s / sans.
2. **Annonce du trou (2 s)** : « Trou 5 — Le Moulin · par 3 », survol rapide du trou.
3. **Jeu** : vue 3D plein écran ; en haut : n° du trou, par, chrono ; en bas : « Coup 2 / 6 » en gros. Premier trou : main animée qui montre le geste.
   Balles fantômes des autres. Bouton discret « Carte » (scores de tous).
4. **Balle rentrée** : confettis, « Rentré en 2 ! 🟢 », puis vue spectateur du trou (les autres jouent) + « 4 / 6 ont fini ».
5. **Fin de trou (6 s)** : classement provisoire, coups de chacun sur ce trou, flèches de montée/descente.
6. **Résumé** : carte de score complète (un joueur par ligne, un trou par colonne, pastilles de couleur), vainqueur, meilleur trou de chacun.
7. **Télé** (étape 3) : `tv: true` — le trou vu de haut avec toutes les balles (fantômes) + classement en direct ; lecture seule.

Style « sticker book » : couleurs franches, bordures épaisses, décor de kermesse (fanions, stands), thème clair + sombre pour l'interface.

## 5. Tenue Golfeur ⛳ et trophées

- Tenue `golfer` (dossier d'art `golfer`), débloquée par **10 victoires à Mini-golf**, ajoutée à `src/data/tenues.ts` **et** `supabase/features/tenues.sql`.
- Art : 9 planches + 9 portraits V3 (prompts déjà écrits : `docs/PROMPTS-TENUES-V3.md`) ; d'ici là repli habituel (chibi de base + ⛳).
- 11 trophées (slots 2-12), actifs dès la sortie ; compteurs dans `results[].stats` (`_mg_tstats`) :

| Slot | id | Nom | Condition | Compteur (stats) |
|---|---|---|---|---|
| 2 | `mg_plouf` | Plouf ! | 3 balles à l'eau en une partie | `water` (max) ≥ 3 |
| 3 | `mg_don_quichotte` | Don Quichotte | Se faire renvoyer la balle par le moulin 5 fois (cumul) | `mill_hits` (somme) ≥ 5 |
| 4 | `mg_ramassee` | Balle ramassée | Ne pas rentrer la balle en 6 coups sur un trou | `picked_up` (somme) ≥ 1 |
| 5 | `mg_habitue` | Habitué du parcours | Jouer 10 parties (cumul) | parties jouées ≥ 10 |
| 6 | `mg_regulier` | Régulier | 50 trous finis dans le par ou mieux (cumul) | `pars` (somme) ≥ 50 |
| 7 | `mg_petit_oiseau` | Petit oiseau | 10 trous finis en un coup de moins que le par (cumul) | `birdies` (somme) ≥ 10 |
| 8 | `mg_par_la_bande` | Par la bande | Rentrer la balle après 3 rebonds ou plus dans le même coup | `bank_shot` (max) ≥ 1 |
| 9 | `mg_trou_en_un` | Trou en un ! | Rentrer la balle du premier coup | `aces` (max) ≥ 1 |
| 10 | `mg_sous_le_par` | Sous le par | Finir un parcours de 9 trous sous le par | `under_par` (max) ≥ 1 |
| 11 | `mg_sans_bavure` | Sans bavure | 9 trous sans jamais dépasser le par | `clean_card` (max) ≥ 1 |
| 12 | `mg_legende` | Légende du green | Gagner 15 parties (cumul) | victoires ≥ 15 |

`pars`, `birdies`, `aces`, `picked_up`, `under_par`, `clean_card` sont calculés par le serveur depuis `cards` ; `water`, `mill_hits`, `bank_shot` viennent du client (bornés).
Les slots 10 et 11 exigent le parcours de 9 trous. Seuils à ajuster après deux ou trois soirées. Catalogue ajouté à `docs/TROPHEES.md` et au seed de `trophees.sql`.

## 6. Vidéo tuto

« Comment on joue ? » (30 s, format de `docs/VIDEOS-JEUX.md`) : `promo-video/src/tuto/games/mini-golf.tsx` — but « Rentre la balle en un minimum de coups ! » ;
étapes : (1) tire en arrière et lâche, (2) attention au moulin et à l'eau, (3) 6 coups maximum, (4) le plus petit total gagne. Ajout à `TUTO_GAME_IDS`.

## 7. Tests

- **SQL (PGlite)** `tools/sql-tests/mini-golf.mjs` : parcours 9 et 5 trous ; synchro des pars avec `holes.ts` ; envoi sur le mauvais trou, doublon ignoré,
  coups hors bornes, `too_fast` ; fin de trou quand tous ont fini ; tick d'échéance (absents = 7) idempotent ; `next` / `end_game` réservés à l'hôte ;
  classement, ex aequo, points ; compteurs des 11 trophées.
- **Physique** : page de test locale (non commitée) qui tire 200 coups aléatoires par trou et vérifie qu'aucune balle ne traverse un mur ni ne reste coincée ;
  chaque trou doit être faisable dans le par par un coup « évident ».
- **Front** : `tsc`, `eslint`, `npm run build` ; essai réel à plusieurs téléphones (fluidité, fantômes).

## 8. Livraison

1. **Étape 1 — un trou jouable en solo** : scène, geste, physique, capture du trou, trous 1 à 3 (valide le ressenti avant d'aller plus loin).
2. **Étape 2 — le jeu complet** : 9 trous et leurs obstacles, SQL + tests, synchronisation par trou, fantômes, carte de score, résumé, tenue au catalogue, trophées, docs.
3. **Étape 3 — mode télé** et **vidéo tuto**.
4. Intégration des planches/portraits Golfeur dès réception (circuit habituel).

## 9. Questions ouvertes

1. **Synchronisé par trou** (proposé) ou chacun à son rythme comme le bowling (plus simple, mais fantômes sans intérêt et pas de classement entre les trous) ?
2. **Chrono par défaut** : 90 s par trou (proposé) ou sans chrono ? Et limite à 6 coups (score 7) : assez indulgent pour les débutants ?
3. **Thème « Kermesse du village »** et noms des trous : OK, ou préfères-tu des lieux réels de la bande (comme le Tour des Potes) ?
4. **Looping scripté** (fiable) : acceptable, ou tu veux une vraie boucle physique quitte à y passer du temps ?
5. **Balle à l'eau** : retour au point de frappe sans pénalité (proposé) ou +1 coup ?

## 10. Hors périmètre

Collisions entre balles, tour par tour, éditeur de trous, effets (lift, rétro), vent, bonus à ramasser,
mode solo / défi du jour, équipes, caméra libre, vérification serveur de la physique (rejeu des coups).

## Décisions (2026-11-19, validées par l'utilisateur : « j'accepte tout »)

- Synchronisé par trou (tous sur le même trou), chrono 90 s par trou par défaut.
- 6 coups max par trou (au-delà : 7 inscrits).
- Thème « La Kermesse du village » (pas de lieux réels en V1).
- Looping scripté (trajectoire guidée), pas physique.
- Balle à l'eau : +1 coup de pénalité, balle replacée au dernier point de frappe.

## Trous 10 à 20 et parcours aléatoires (2026-11-20)

20 trous en tout dans `holes.ts` (ids 1..20). Options `{ "course": "random" | "kermesse" | "express", "timer": … }` :
**aléatoire** (défaut) = 9 trous tirés au sort parmi 20 ; **La Kermesse** = trous 1 à 9 dans l'ordre (par 26) ; **express** = 5 trous tirés au sort.
Anciennes options acceptées : `{holes: 9}` = La Kermesse, `{holes: 5}` = express. Tirage **côté serveur** (`game_mini_golf_start`), sans remise,
puis **trié par par croissant** (hasard entre pars égaux) : on s'échauffe sur les par 2, on finit sur un par 4 s'il y en a un.
`state.course` mémorise le parcours. La carte de score numérote les trous 1..n (nom du trou au survol). Trophées `under_par` / `clean_card` :
tout parcours de 9 trous (aléatoire ou Kermesse), jamais l'express.

| N° | Nom | Obstacle | Par |
|---|---|---|---|
| 10 | L'Entonnoir du Pressoir | murs en biais qui mènent à un goulot | 3 |
| 11 | Le Tremplin des Canards | tremplin au-dessus de la mare (trop mou : plouf) | 3 |
| 12 | Le Dévers de la Fanfare | tout le trou penche (nouvelle rampe `axis: 'x'`), 2 tonneaux | 3 |
| 13 | Le Passage à Niveau | barrière qui va et vient (nouvelle pièce `slider`, horloge serveur) | 2 |
| 14 | La Chatière de Mémé | haie avec une chatière (raccourci) ou le tour par la droite | 3 |
| 15 | Le Serpent de la Brocante | trois allées en zigzag | 4 |
| 16 | Le Grand Flipper | 5 bumpers + 2 rampes de lancement | 3 |
| 17 | La Rivière aux Deux Ponts | grand pont ou planche étroite droit sur le trou | 3 |
| 18 | Le Toboggan de la Mairie | départ en hauteur, descente, remontée derrière le trou | 3 |
| 19 | Le Moulin de la Meunière | mare à longer puis moulin décentré | 3 |
| 20 | Le Bouquet Final | looping + 2 bumpers, la cloche sonne | 3 |

Nouveautés techniques : `ramp.axis = 'x'` (dévers), `slider` (bloc cinématique ; une balle ne s'arrête jamais sous sa course,
elle est poussée juste devant / derrière), `wall.skin = 'hedge'`, `post.style = 'barrel'` (tonneau), décors `balloons`, `hay`, `drum`.
La cloche sonne sur tout trou qui a un décor `bell` (9 et 20).

## Parcours « Défi » (trous 21 à 29, 2026-11-20)

Option `course: "defi"` : 9 longs trous dans l'ordre, jamais tirés au sort (l'aléatoire et l'express restent sur 1..20).
Inspiré des mécaniques de genre des mini-golfs multijoueurs déjantés, sans reprendre de nom, carte ni visuel d'un jeu existant.
Coups max : `max(6, par + 2)` (6 jusqu'au par 4, 7 au par 5, 8 au par 6) ; balle ramassée = coups max + 1 (7 / 8 / 9),
côté serveur (`_mg_cap`, `_mg_picked`) et front (`maxStrokes`, `pickedUp`). Trophées inchangés : tout parcours de 9 trous
compte pour « sous le par » / « sans bavure » (Défi compris).

Nouvelles mécaniques (toutes déterministes côté client) : glace (`skin: 'ice'`, la balle glisse), sable / neige (freinent fort),
vide (`void: true` : la chute coûte +1 coup, retour au point de frappe), herses (`gate`, montent / descendent sur l'horloge
serveur), tubes (`tube`, trajectoire scriptée comme le looping), étages (rampes + bordures `wallAt`), tremplins au-dessus du vide.
Thèmes `castle`, `desert`, `snow` : couleurs (clair / sombre) et décors (`ghost`, `pumpkin`, `tower`, `cactus`, `saloon`,
`rock`, `snowman`, `pine`, `chalet`).

Les 9 trous (définition complète dans `holes.ts`), par total **39** :

| Id | Thème | Nom | Par | Mécanique |
|---:|---|---|---:|---|
| 21 | Château | Les Douves du Château | 4 | pont-levis en bois sur des douves (eau : +1 coup), herse qui monte et descend, cour à contourner (mur, 2 bumpers) |
| 22 | Château (vide) | L’Escalier du Fantôme | 4 | trois étages (rampes, balcon, sommet) au-dessus du vide, bumper, passage secret en tube du balcon au sommet |
| 23 | Château | La Galerie des Herses | 6 | trois herses décalées dans le temps à passer l’une après l’autre, 2 bumpers |
| 24 | Far-West (vide) | Le Canyon du Coyote | 4 | longer le ravin (bande de sable) ou franchir le vide par le tremplin, rochers |
| 25 | Far-West | La Mine d’Or de Dédé | 4 | paroi percée de trois galeries (tubes) : une seule mène au trou, sable, rocher, tonneaux |
| 26 | Far-West | La Grand-Rue du Saloon | 4 | sable, deux diligences (barrières mobiles), tonneaux, perron du saloon surélevé (rampe) |
| 27 | Neige | La Patinoire de Dédé | 4 | sol en glace (la balle glisse), enclos central, 3 bumpers |
| 28 | Neige (vide) | Le Grand Tremplin | 4 | descente en rampe, saut du ravin par le tremplin ou chemin des piétons, bande de glace, piquets |
| 29 | Neige (vide) | Le Sommet de Dédé | 5 | patinoire, balcon puis sommet par deux rampes, télécabine (tube) en raccourci gardée par trois piquets, neige |

Calage des pars : « joueur moyen » simulé (`check-holes.mjs --quick --human 24`, visée ±2,5°, puissance ±8 %) ; il fait environ
1 coup de plus que le par sur les trous d'origine, donc par ≈ moyenne − 1, borné à 4..6. Les moyennes simulées (≈ 2 à 4 coups) donnent
presque partout le plancher de 4 ; le 29 (le plus dur après le 23) passe à 5 et le 23 (jamais rentré par le joueur simulé, qui ne
choisit pas son instant de frappe devant les herses) à 6, pour avoir un par 4, un par 5 et un par 6 (exigé par le test SQL).
Vérification : `tools/mini-golf/check-holes.mjs` (solveur + tirs au hasard avec la vraie physique) ; `--human N` = « joueur moyen »
bruité pour régler les pars (trous `void` : une portion de route séparée de la balle par une bordure n'est pas un raccourci).
