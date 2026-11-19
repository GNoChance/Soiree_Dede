# Dédé Party — conception

Jeu n°25 des Soirées de Dédé, id `dede-party`. Party game de plateau **original** (aucun nom, personnage, plateau, case ou visuel d'un jeu existant) :
un plateau à cases, des dés, des étoiles à acheter et un mini-jeu à chaque tour, dans le décor d'un **jeu télé animé par Dédé**.
**Statut : proposition à valider** (choix à trancher en §10). Dernier et plus gros des 4 nouveaux jeux (Nom de Code → Échecs → Mini-golf → Dédé Party).

## 1. Intention

Le « jeu du samedi soir » : toute la tablée devant la télé, le plateau en grand, chacun son téléphone comme manette, Dédé qui commente.
Réussi si : personne n'attend plus de 30 s sans rien faire, une partie normale tient en **35 min**, un enfant ou une grand-mère peut gagner
(chance du plateau + mini-jeux très simples), et la V1 reste faisable par un seul développeur (plateau 2D, mini-jeux courts bâtis sur un cadre commun).

## 2. Règles

### Joueurs, durée
- 2 à 8 joueurs, chacun pour soi. Option **durée** : Courte 6 tours (~25 min) · **Normale 9 tours (~35 min, défaut)** · Longue 12 tours (~45 min).
- Un tour de table ≈ 3 min 30 à 4 min : lancer (15 s) + déplacements (≈ 5 s par joueur) + mini-jeu (≈ 1 min 30, annonce et résultats compris).

### But
Avoir le plus d'**étoiles ⭐** à la fin ; égalité → le plus de **pièces 🪙** ; encore égalité → victoire partagée.

### Plateau « Le Grand Plateau de Dédé » — boucle de 24 cases

| Case | Nombre | Effet quand on s'y **arrête** |
|---|---|---|
| 🎬 Départ | 1 | +5 pièces à chaque passage (même sans s'arrêter) |
| 👏 Applaudissements | 9 | +3 pièces |
| 📺 Page de pub | 4 | −3 pièces (jamais sous 0) |
| ✉️ Enveloppe surprise | 4 | Dédé tire une carte (voir plus bas) |
| ✨ Loge | 6 | rien… sauf si l'étoile y est |

- **L'étoile** est posée sur une des 6 Loges. Dès qu'un joueur **passe ou s'arrête** dessus avec **20 pièces**, il l'achète automatiquement
  (toujours avantageux : pas de question à poser), puis l'étoile déménage dans une autre Loge tirée au sort.
- Chacun démarre sur Départ avec **10 pièces**.

### Un tour de table — **tout le monde lance en même temps** (choix tranché)
1. **Lancer (15 s)** : chacun tape son gros dé sur son téléphone (dé serveur 1-6). Pas tapé à temps → lancé d'office.
   Une fois par partie : bouton **« Double dé 🎲🎲 »** (deux dés additionnés).
2. **Déplacements** : la télé joue les pions **un par un** (ordre de passage qui tourne d'un cran à chaque tour), case par case, avec l'effet de la case et le commentaire de Dédé.
   Aucune décision à prendre : le serveur résout tout le tour en une fois, les écrans ne font que l'animer.
3. **Mini-jeu** : tiré au sort, tous les joueurs en même temps, sur leur téléphone.
4. **Gains du mini-jeu** : 1er 10 pièces · 2e 6 · 3e 4 · les autres 2 · pas joué 0 (ex aequo : même gain, celui du meilleur rang).
   **Dernier tour : gains doublés** (« La Finale »).

Pourquoi simultané plutôt que chacun son tour : à 8 joueurs le tour par tour fait attendre 2-3 min entre deux lancers et la partie dépasse l'heure ;
un joueur distrait ne bloque plus personne ; côté serveur, un tour = une seule résolution. On garde le plaisir du « c'est à moi » : la télé met chaque pion en vedette à son tour.

### Enveloppes surprise (12 cartes, effet immédiat, sans choix)
+8 pièces · −5 pièces · avance de 3 cases · recule de 3 cases · échange de place avec le joueur le plus loin devant · prends 3 pièces au joueur le plus riche ·
tout le monde donne 2 pièces au dernier du classement · tout le monde gagne 3 pièces · l'étoile déménage · rejoue un dé tout de suite ·
prochaine étoile à moitié prix (10 pièces) · cadeau de Dédé : +1 « Double dé ».
Un déplacement dû à une carte applique passage par Départ et achat d'étoile, mais **pas** l'effet de la case d'arrivée (pas de chaînes).

### Mini-jeux V1 (6) — 30 à 45 s, une phrase de règle, tous en même temps

| id | Nom | Principe | Brique réutilisée | Classement |
|---|---|---|---|---|
| `quiz` | Questions pour un Dédé | 3 QCM éclair (8 s chacun) | banque `cerveau-en-fete` (mode QCM) | bonnes réponses, puis temps |
| `pif` | Au pif | 1 question chiffrée, 20 s | banque + clavier de `le-plus-proche` | plus petit écart |
| `majorite` | Comme tout le monde | 1 « Qui de nous… ? », on vote pour un joueur | banque + vote de `qui-de-nous` | ceux qui ont voté comme la majorité sont 1ers, les autres derniers |
| `buzzer` | Le Buzzer | l'écran passe au vert à un moment surprise : tape le plus vite (faux départ = dernier) | horloge serveur | temps de réaction |
| `etoiles` | Pluie d'étoiles | 15 s : tape les étoiles qui tombent, évite les tomates | — | score |
| `chrono` | Top chrono | arrête le chrono à 7,00 s… il disparaît après 3 s | horloge serveur | plus petit écart |

Tirage « dans un sac » : les 6 passent avant qu'un mini-jeu revienne, jamais deux fois le même d'affilée ; le contenu (questions) change à chaque fois.
Un seul envoi par joueur et par mini-jeu ; le mini-jeu s'arrête quand tous ont envoyé ou à l'échéance.

### Fin de partie — la cérémonie
Après le dernier tour, Dédé remet **2 étoiles bonus** (suspense, rattrapage) : ⭐ **Roi des mini-jeux** (le plus de mini-jeux gagnés) et
⭐ **Prix de la poisse** (le plus de Pages de pub). Ex aequo : chacun la reçoit. Puis classement final : étoiles, puis pièces.
`finish_match` : `placement` = rang, `points = n − rang + 1`, `won` = rang 1.

## 3. Architecture

Plateau **2D** (DOM/SVG + framer-motion, style sticker book) : pas de 3D. Conventions habituelles (state public, `deadline` + `tick`), mode télé générique (`tv: true`).

### Serveur — `supabase/games/dede-party.sql` (préfixe `_dp_`)
- `game_dede_party_start(p_players, p_options)` / `game_dede_party_action(p_state, p_server, p_actor, p_is_host, p_action)`, idempotent, terminé par les `revoke`.
- **Plateau** : `_dp_board()` (type de chaque case) dupliqué avec `board.ts` (noms, positions à l'écran côté front seulement) ; synchro vérifiée par le test, comme le Tour des Potes.
  Textes des 12 cartes dans le SQL (`_dp_cards()`), le state porte le texte tiré.
- **Phases** : `roll` (15 s) → `move` (durée = 5 s × joueurs, calculée par le serveur) → `mg_intro` (8 s) → `mg_play` (échéance du mini-jeu) → `mg_result` (8 s) → `roll` … → `awards` (12 s) → `finished`.
  Toutes enchaînées par `deadline` + `{"type":"tick"}` idempotent : **l'hôte n'a rien à cliquer**.
- **State public** (miroir `types.ts`) : `phase`, `round`, `rounds`, `deadline`, `players`, `order[]`, `pos{}`, `coins{}`, `stars{}`, `star_cell`, `half_price{}`,
  `double_left{}`, `rolls{id: {dice[], double} | null}`, `moves[{id, dice, from, to, steps[{cell, events[]}]}]` (scénario du tour, à animer),
  `mg{kind, no, data, submitted[], results[{id, score, rank, coins}]}`, `awards`, `ranking`, `winners`, `stats`.
- **`server`** (jamais exposé) : sac de mini-jeux, pioche de cartes, réponses des questions, instant du buzzer, envois des joueurs avant résultat ; `forced_dice` pour les tests.
  `match_secrets` : inutilisé (aucun secret individuel).
- **Actions** : `roll {double?}` · `mg_submit {no, payload}` (un par joueur, doublon ignoré ; `no` ≠ mini-jeu courant → ignoré sans erreur) · `tick` ·
  `skip` (hôte : passer la phase en cours) · `end_game` (hôte : cérémonie tout de suite).
- **Questions** : tirées par le front (`prepareStart`) dans les banques existantes et passées dans les options (comme `cerveau-en-fete`) :
  18 QCM, 6 estimations, 6 « Qui de nous » pour une partie longue. Les réponses restent dans `server` jusqu'à `mg_result`.
- **Mini-jeux côté SQL** : un cadre commun `_dp_mg_start(kind)` (prépare `mg.data` + secrets), `_dp_mg_score(kind, envois)` (score → rang → pièces).
  `quiz`, `pif`, `majorite` sont entièrement vérifiés par le serveur. `buzzer`, `etoiles`, `chrono` sont mesurés par le téléphone :
  anti-triche minimal (réaction ≥ 120 ms, score plafonné, valeurs bornées), comme le bowling.
- Joueur absent : dé lancé d'office, mini-jeu non joué = 0 pièce ; il reprend dès qu'il revient (pas d'état `away`).
- Nouveaux codes d'erreur (→ `errors.ts`) : `already_rolled`, `no_double_left`, `invalid_submit`.

### Front — `src/games/dede-party/`
- `index.ts` (definition : `minPlayers: 2`, `maxPlayers: 8`, `order: 240`, emoji 🎤, `tv: true`), `Play.tsx` (lazy), `TvView.tsx`, `Summary.tsx`, `Options.tsx`,
  `setup.ts` (`prepareStart`), `types.ts`, `board.ts`, `Board.tsx` (plateau partagé téléphone/télé), `dede-lines.ts` (répliques de Dédé).
- **Cadre des mini-jeux** : `minigames/<kind>.tsx`, chacun exporte `{ rule, Play, Tv }` avec la même interface
  (`data`, `deadline`, `submit(payload)`, `submitted`). Ajouter un mini-jeu = un fichier front + une branche dans `_dp_mg_start` / `_dp_mg_score`.
- Les mini-jeux **importent** les banques et petits composants existants (`cerveau-en-fete/questions`, `le-plus-proche`, `qui-de-nous/questions`) sans modifier ces jeux.
- **Dédé animatrice** : chibi de Dédé en tenue `host` (repli : chibi de base + 🎤 tant que l'art n'est pas là), bulle de texte choisie côté front selon l'évènement
  (~60 répliques : étoile achetée, page de pub, faux départ, égalité…). Si Dédé joue aussi, c'est son émission : elle se commente elle-même.

### Mode télé (prioritaire, livré avec le jeu)
- La télé affiche : le plateau en grand, les pions (têtes chibi dans la tenue équipée), le bandeau des scores (⭐ / 🪙), Dédé et sa bulle, le dé de chacun pendant le lancer,
  et pendant un mini-jeu : la règle, qui a déjà répondu, puis le podium. Lecture seule, envoie seulement le `tick` d'échéance.
- **Sans télé, le jeu reste jouable** : le téléphone affiche le même `Board` en version compacte (centré sur le pion animé). Avec télé, le téléphone devient une manette (dé, mini-jeu, mes pièces).

## 4. Écrans

1. **Options (hôte)** : durée (Courte / Normale / Longue), rappel « Mets la télé pour le plateau en grand 📺 » avec le bouton télé existant.
2. **Générique (4 s)** : « Bienvenue dans Dédé Party ! », présentation des candidats.
3. **Lancer** : un énorme dé à taper ; dessous, bouton « Double dé 🎲🎲 » (grisé une fois utilisé) ; mes ⭐ et 🪙 en haut. Après le lancer : « Regarde la télé ! » (ou le mini-plateau).
4. **Déplacements** : plateau animé, pion par pion ; pièces qui volent, étoile qui tourne, enveloppe qui s'ouvre avec le texte de la carte.
5. **Annonce du mini-jeu (8 s)** : roulette, nom, **une phrase de règle**, décompte 3-2-1.
6. **Mini-jeu** : plein écran, gros boutons ; puis « Envoyé ✔ En attente des autres… ».
7. **Résultats du mini-jeu (8 s)** : podium, pièces gagnées.
8. **Cérémonie** : les 2 étoiles bonus une par une (roulement de tambour), puis le classement final et les confettis.
9. **Résumé** : classement, étoiles, pièces, mini-jeux gagnés par joueur, meilleur moment (plus gros gain en une carte).

## 5. Tenue Animateur Télé 🎤 et trophées

- Tenue `host` (dossier d'art `host`), ajoutée à `src/data/tenues.ts` **et** `supabase/features/tenues.sql`. Déblocage proposé : **5 victoires** (au lieu de 10 : partie 3 fois plus longue, voir §10).
- Art : 9 planches + 9 portraits V3 (prompts déjà écrits : `docs/PROMPTS-TENUES-V3.md`) ; la planche de **Dédé** est à faire en premier (elle anime).
- 11 trophées (slots 2-12), actifs dès la sortie ; compteurs dans `results[].stats` (`_dp_tstats`) :

| Slot | id | Nom | Condition | Compteur (stats) |
|---|---|---|---|---|
| 2 | `dp_coupure_pub` | Coupure pub | S'arrêter sur 3 Pages de pub en une partie | `pubs` (max) ≥ 3 |
| 3 | `dp_fauche` | Fauché | Tomber à 0 pièce | `broke` (somme) ≥ 1 |
| 4 | `dp_ciel_couvert` | Ciel couvert | Finir une partie sans aucune étoile | `no_star` (somme) ≥ 1 |
| 5 | `dp_fidele` | Fidèle au poste | Jouer 5 parties (cumul) | parties jouées ≥ 5 |
| 6 | `dp_tirelire` | Tirelire | Gagner 300 pièces (cumul) | `coins_earned` (somme) ≥ 300 |
| 7 | `dp_chouchou` | Chouchou de Dédé | Ouvrir 10 enveloppes surprise (cumul) | `envelopes` (somme) ≥ 10 |
| 8 | `dp_pile_dessus` | Pile dessus | Acheter une étoile en s'arrêtant exactement sur sa case | `star_exact` (somme) ≥ 1 |
| 9 | `dp_triple` | Le triplé | Gagner 3 mini-jeux d'affilée | `mg_streak` (max) ≥ 3 |
| 10 | `dp_constellation` | Constellation | Finir une partie avec 3 étoiles ou plus | `stars` (max) ≥ 3 |
| 11 | `dp_carton_plein` | Carton plein | Gagner la partie en étant aussi Roi des mini-jeux | `win_mvp` (somme) ≥ 1 |
| 12 | `dp_star_ecran` | Star du petit écran | Gagner 10 parties (cumul) | victoires ≥ 10 |

Tous les compteurs sont calculés par le serveur. Seuils (surtout slots 2, 9, 10) à caler avec la simulation (§7). Catalogue ajouté à `docs/TROPHEES.md` et au seed de `trophees.sql`.

## 6. Équilibrage, vidéo tuto

- Valeurs de départ : 24 cases, étoile 20 pièces, 10 pièces au départ, gains 10/6/4/2, cases ±3, Départ +5. Cible : **le vainqueur finit avec 2-3 étoiles**, presque tout le monde en a au moins une sur une partie normale.
  Ces nombres sont des constantes en tête du SQL, ajustées par simulation avant le front.
- Vidéo « Comment on joue ? » (35 s) : `promo-video/src/tuto/games/dede-party.tsx`, présentée par Dédé en tenue Animateur — but « Ramasse le plus d'étoiles ! » ;
  étapes : (1) tape ton dé, (2) ton pion avance sur le plateau, (3) un mini-jeu à chaque tour pour gagner des pièces, (4) 20 pièces = une étoile. Ajout à `TUTO_GAME_IDS`.

## 7. Tests

- **SQL (PGlite)** `tools/sql-tests/dede-party.mjs` (dés imposés via `forced_dice`) : synchro `_dp_board()` / `board.ts` ; chaque type de case ; passage par Départ ;
  achat d'étoile au passage et à l'arrêt, pas d'achat sous 20 pièces, déménagement, demi-tarif ; les 12 cartes ; Double dé (une fois, carte cadeau) ;
  lancer d'office à l'échéance ; ordre de passage tournant ; enchaînement complet des phases par `tick` (idempotent) ; sac de mini-jeux (pas de répétition) ;
  score et gains des 6 mini-jeux, ex aequo, non-joueur, finale doublée ; bornes anti-triche ; étoiles bonus et ex aequo ; classement final ; `skip` / `end_game` réservés à l'hôte ; compteurs des 11 trophées.
- **Simulation** (même fichier ou script voisin) : 1 000 parties de joueurs au hasard par durée et par nombre de joueurs → distribution des étoiles du vainqueur, part de joueurs sans étoile, fréquence de chaque trophée.
- **Front** : `tsc`, `eslint`, `npm run build` ; page de test locale multi-onglets + onglet télé ; soirée d'essai réelle (durée chronométrée).

## 8. Livraison

1. **Étape 1 — moteur du plateau** : SQL (lancer, déplacements, cases, cartes, étoile, phases) avec un mini-jeu factice (gains au hasard), tests, simulation et équilibrage.
2. **Étape 2 — plateau à l'écran** : `Board`, téléphone + **télé**, animations du tour, options. Partie complète jouable (mini-jeu factice).
3. **Étape 3 — cadre des mini-jeux + 2 premiers** (`quiz`, `buzzer`) : valide le cadre sur un mini-jeu vérifié par le serveur et un mini-jeu mesuré par le téléphone.
4. **Étape 4 — les 4 autres mini-jeux** (`pif`, `majorite`, `etoiles`, `chrono`).
5. **Étape 5 — l'émission** : Dédé et ses répliques, générique, cérémonie, résumé, tenue au catalogue, trophées, docs (ARCHITECTURE.md, TROPHEES.md).
6. **Étape 6 — vidéo tuto** ; intégration des planches/portraits Animateur dès réception.

Chaque étape est livrable et testable seule ; on peut s'arrêter après l'étape 4 avec un jeu complet.

## 9. V2 (après quelques soirées)

- **Mini-jeux 3D** bâtis sur les jeux existants : un lancer de bowling (quilles tombées), un sprint de Dédé Kart, un trou de mini-golf.
- Autres mini-jeux : mémoire (répéter une suite), dessin éclair, mot le plus long (Bombe à mots), mini-jeux en équipes 2 contre 2 ou 1 contre tous.
- **Boutique et objets** (dé truqué, voleur de pièces, téléporteur), carrefours et raccourcis payants, cases duel.
- Deuxième plateau, étoile volée, répliques de Dédé enregistrées en audio, mini-jeux joués par les spectateurs.

## 10. Questions ouvertes

1. **Lancer simultané** (proposé : rapide, personne n'attend) ou chacun son tour (plus « jeu de plateau », mais partie nettement plus longue à 6-8) ?
2. **Achat d'étoile automatique** et plateau sans aucun choix (proposé pour le public non-joueur) : OK, ou veux-tu au moins un carrefour dès la V1 ?
3. **Durée par défaut** : 9 tours (~35 min) ? Et **déblocage de la tenue à 5 victoires** au lieu de 10 ?
4. **Les 6 mini-jeux V1** : la liste te va ? En remplacer un par « un lancer de bowling » dès la V1 (plus spectaculaire, plus risqué) ?
5. **Étoiles bonus de fin** (Roi des mini-jeux, Prix de la poisse) : on garde ce rattrapage qui peut renverser le classement ?
6. **Télé** : recommandée mais facultative (proposé), ou obligatoire pour simplifier l'écran du téléphone ?
7. Noms : « Le Grand Plateau de Dédé », cases (Applaudissements, Page de pub, Loge), mini-jeux — à ton goût ?

## 11. Hors périmètre (V1)

Plateau 3D, objets et boutique, carrefours, équipes, bots, plusieurs plateaux, sauvegarde et reprise d'une partie un autre jour,
mini-jeux 3D, voix de Dédé, choix du mini-jeu par les joueurs, partie à plus de 8 joueurs, vérification serveur des mini-jeux d'adresse.

## Décisions (2026-11-19, validées par l'utilisateur : « j'accepte tout »)

- Lancer de dé simultané ; plateau sans choix en V1 (carrefours : V2).
- 9 tours par défaut (options 6 / 12).
- Tenue Animateur Télé à 5 victoires (partie longue).
- Les 6 mini-jeux proposés (quiz, estimation, vote, buzzer, pluie d'étoiles, top chrono) ; mini-jeux 3D : V2.
- Étoiles bonus de fin conservées (Roi des mini-jeux, Prix de la poisse).
- Télé facultative (mini-plateau sur téléphone), mais recommandée.
