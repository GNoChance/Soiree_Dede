# Échecs — conception

Jeu n°22 des Soirées de Dédé, id `echecs`. Jeu en **duel** sur le socle existant (`supabase/features/duel.sql`, `src/features/duel/`).
Spec à valider par l'utilisateur avant le code (2026-11-19).

## 1. Intention

Les vraies échecs, complètes et sans triche possible (tout est vérifié par le serveur), mais jouables par quelqu'un qui connaît à peine les règles :
on touche une pièce, les cases possibles s'allument, on touche la case. Les autres regardent (téléphone ou télé) et parient.
Réussi si : aucun coup illégal ne passe, une partie a une **durée bornée** (pendule), et un débutant n'est jamais bloqué
(« pourquoi je ne peux pas jouer ça ? » → seules les cases légales sont proposées, l'échec est signalé en rouge).

## 2. Règles

### Règles officielles, toutes appliquées par le serveur
- Déplacements des 6 pièces, prise, **roque** petit et grand (roi et tour jamais déplacés, cases libres, roi ni en échec, ni traversant, ni arrivant sur une case attaquée),
  **prise en passant** (uniquement au coup qui suit la poussée de deux cases), **promotion** (dame, tour, fou ou cavalier au choix).
- Un coup qui laisse son propre roi en échec est illégal.
- **Échec et mat** : victoire. **Pat** : nul.
- **Nuls automatiques** (pas de réclamation à faire, trop technique pour le public visé) :
  - **répétition** : la même position (pièces, trait, droits de roque, prise en passant possible) apparaît pour la 3e fois ;
  - **50 coups** : 50 coups de chaque joueur sans prise ni coup de pion (compteur de demi-coups à 100) ;
  - **matériel insuffisant** : roi contre roi, roi + fou contre roi, roi + cavalier contre roi, roi + fou contre roi + fou sur cases de même couleur.
  Le mat est prioritaire sur les nuls (un coup qui mate gagne même au 100e demi-coup).
- **Abandon** : bouton « 🏳️ Abandonner » (à son tour, avec confirmation) → l'adversaire gagne.
- **Nul d'un commun accord** : case « Proposer nul » cochée en jouant son coup ; l'adversaire voit « 🤝 Nul proposé » et peut accepter à son tour, ou simplement jouer (la proposition tombe).
- **Blancs** = le joueur qui commence la manche (`starter` du socle, alternance entre manches déjà gérée).

### Cadence (option hôte, propre au jeu)

Problème : le socle ne connaît qu'un minuteur **par coup** (30 s par défaut, coup au hasard à l'échéance). Aux échecs cela ne borne pas la durée
(80 coups × 30 s = 40 min) et un coup au hasard ruine une partie. Choix : une **vraie pendule** par joueur, plus un mode sans pendule pour les débutants.

| Cadence | Temps | À l'échéance | Durée max d'une manche |
|---|---|---|---|
| ⚡ Éclair | pendule 3 min par joueur | perd au temps | 6 min |
| **⏱️ Rapide (défaut)** | pendule 5 min par joueur | perd au temps | 10 min |
| 🐢 Tranquille | pendule 10 min par joueur | perd au temps | 20 min |
| 🧸 Sans pendule | 60 s par coup (minuteur du socle) | **coup légal au hasard** (« Dédé joue pour toi ») | non bornée |

- Pendule : le temps du joueur au trait descend, pas d'incrément. Temps écoulé = **défaite**, sauf si l'adversaire n'a plus de quoi mater
  (roi seul, roi + fou, roi + cavalier) : **nul**.
- Le temps est mesuré par le serveur entre deux coups (la latence réseau est décomptée au joueur : accepté).
- Sans pendule : le coup au hasard du socle (`board_auto`) est toujours **légal** ; une promotion automatique donne une dame.

### Modes de session
Les 3 modes du socle restent disponibles (Roi de la table, Tournoi, Duel), paris des spectateurs inchangés.
**Mode par défaut : ⚔️ Duel** (au lieu de Roi de la table) : une session « roi » à 5 joueurs ferait plus d'une heure d'échecs.
L'écran d'options affiche une durée estimée (« environ 30 min ») pour Roi de la table et Tournoi.

### Aides aux débutants
- Toujours actives : cases possibles en surbrillance (point = case libre, anneau = prise), dernier coup surligné, roi en échec en rouge,
  bandeau « Échec ! », pièces prises et avance de matériel (+3) sous chaque joueur.
- Bouton « ❓ Les pièces » : fiche repliable (comment se déplace chaque pièce, roque, promotion, prise en passant en une image chacun).
- **Pas de bouton « Annuler » en V1** : il casserait la pendule, les paris et l'arbitrage serveur (question ouverte n°2).
  En contrepartie le coup se joue en **deux touches** (pièce puis case), et toucher une autre de ses pièces change simplement la sélection.

## 3. Architecture

Modèle copié sur `quatre-a-la-suite` / `morpion` : le jeu ne fournit que le plateau. Deux **petites évolutions du socle** (rétrocompatibles) :

1. `board_new`, `board_setup` (`begin`) et `board_move` peuvent renvoyer **`turn_seconds`** (entier) : durée du prochain coup à la place de `session.turn_seconds`
   (3 endroits dans `duel.sql` où `deadline` est posée). Les échecs y mettent le temps restant à la pendule du joueur au trait ;
   `DuelStage` affiche donc déjà le bon chrono sans modification.
2. `makeDuelGame` accepte **`defaultMode`** (`'duel'` pour les échecs).

### Serveur — `supabase/games/echecs.sql`
- Hooks du contrat duel : `game_echecs_board_new`, `game_echecs_board_move`, `game_echecs_board_auto`, délégation `game_echecs_start` / `game_echecs_action`,
  hook trophées `game_echecs_trophy_stats`, idempotent, terminé par les `revoke`.
- **Moteur en PL/pgSQL**, fonctions internes pures (`immutable`) :
  `_echecs_attacked(pos, case, camp)`, `_echecs_pseudo_moves(pos)`, `_echecs_legal_moves(pos)` (pseudo-coups filtrés par « mon roi est-il attaqué après ? »),
  `_echecs_apply(pos, coup)`, `_echecs_insufficient(pos)`, `_echecs_key(pos)` (clé de répétition).
  Position = chaîne de 64 caractères (a8 → h1, `.` = vide, majuscules = Blancs, lettres anglaises `KQRBNP`) + trait + droits de roque + case de prise en passant + compteurs.
- **Source de vérité unique des coups légaux** : après chaque coup, le serveur calcule de toute façon tous les coups de l'adversaire (détection mat / pat)
  et les **publie dans le plateau** (`board.moves`). Le front n'a donc **aucun moteur d'échecs** : il affiche ce que le serveur autorise. Pas de double implémentation SQL / TS à maintenir.
- **Plateau public** (`board`, miroir TS dans `src/games/echecs/types.ts`) :
  `sq` (64 caractères), `white`, `black` (uid), `side` (`w`|`b`), `castle` (`KQkq`), `ep` (index ou null), `half`, `full`,
  `moves` (`{"<from>": [to, …]}` pour le camp au trait), `check` (bool), `last` (`{from, to}`), `captured` (`{w: "…", b: "…"}`),
  `cadence` (`blitz3`|`rapid5`|`slow10`|`none`), `clock` (`{uid: ms}`), `turn_started_at` (ISO), `draw_offer` (uid ou null),
  `end` (`{reason: mate|stalemate|repetition|fifty|material|time|resign|agreement}`).
- **Privé** (`server`, rien de secret mais volumineux) : `positions` (`{clé: nombre}` pour la répétition), `tstats` (compteurs des trophées par joueur).
- **Coups** (`{"type":"move","move":{…}}` du socle) :
  - `{from, to, promo?, offer_draw?}` — `from`/`to` = 0..63, `promo` ∈ `q r b n` obligatoire quand un pion arrive au bout ;
  - `{type:"resign"}` ; `{type:"accept_draw"}` (seulement si `draw_offer` = adversaire) ;
  - `{type:"flag"}` : chute du drapeau, renvoyé par `board_auto` quand la pendule du joueur est à zéro ; `board_move` le **revérifie** avec l'heure serveur (sinon `invalid_move`).
- **`board_auto`** : pendule écoulée → `{type:"flag"}` ; sinon un coup tiré au hasard dans `board.moves` (promotion : dame).
- **Fin de manche** : `outcome` `win` / `draw` + `winner`, et `game` = bilan de la manche par joueur (rangé par le socle dans `duel.games[].x`, lu par `game_echecs_trophy_stats`).
- **Nouveaux codes d'erreur** (→ `src/features/soiree/errors.ts`) : `promotion_required`, `no_draw_offer` ; le reste = `invalid_move` du socle.
- Tenue `grandmaitre` dans `supabase/features/tenues.sql`, 11 trophées dans `supabase/features/trophees.sql`, puis `npm run sql` (l'utilisateur recolle `install.sql`).
- Performance visée : moins de 50 ms par coup (≈ 35 coups × test d'attaque) ; à mesurer sur Supabase dès l'étape 1.

### Front — `src/games/echecs/`
- `index.ts` (`makeDuelGame` : `order: 220`, `defaultMode: 'duel'`, `BoardOptions`, `defaultBoardOptions: {cadence: 'rapid5'}`), `Play.tsx` (lazy, `DuelPlay` + `Board`),
  `Board.tsx`, `Piece.tsx` (12 pièces en SVG maison, style sticker : contour épais, lisibles en clair et sombre), `BoardOptions.tsx` (cadence),
  `PromotionPicker.tsx`, `Aide.tsx` (fiche des pièces), `Summary.tsx` (`DuelSummary` + stats), `logic.ts` (index ↔ case, orientation, valeur du matériel — pas de règles), `sound.ts`, `types.ts`.
- **Orientation** : chaque duelliste voit ses pièces en bas ; spectateurs et télé : Blancs en bas.
- **Pendules** : celle du joueur au trait = chrono du socle (`deadline`) ; l'autre, figée, est affichée par le plateau (`board.clock`).
- **Télé** : rien à faire de plus que les autres duels (`DuelTv` met le plateau à l'échelle) ; le plateau doit rester lisible avec `spectator` et un `me` étranger.

## 4. Écrans

1. **Options (hôte)** : options duel habituelles (mode, duellistes) + « Cadence » en 4 gros boutons, durée estimée affichée.
2. **Transition** : affiche du duel du socle, « ⚪ Manon a les Blancs », paris ouverts.
3. **Jeu — duelliste au trait** : échiquier pleine largeur (cases ≥ 40 px sur un téléphone de 360 px), toucher une de ses pièces → elle se soulève,
   ses cases possibles s'allument ; toucher une case allumée → le coup part (animation de glissement, son). Toucher ailleurs = désélection.
   Une pièce sans coup possible tremble (« bloquée »). Glisser-déposer : hors périmètre.
4. **Promotion** : en touchant la dernière rangée, 4 gros boutons (👑 dame en premier, tour, fou, cavalier) ; fermer = annuler la sélection.
5. **Sous le plateau** : pièces prises + avance de matériel, « 🤝 Proposer nul » (bascule, part avec le prochain coup), « 🏳️ Abandonner », « ❓ Les pièces ».
6. **Duelliste qui attend** : même plateau, inerte, « Au tour de Kevin… » ; si nul proposé : rien à faire avant son tour.
7. **Spectateurs** : plateau en direct, pendules, pièces prises, panneau de paris du socle, bouton « 📺 Mode télé ».
8. **Fin de manche** : bandeau du socle + raison en clair (« Échec et mat ! », « Pat : match nul », « Temps écoulé », « 3 fois la même position : nul »,
   « 50 coups sans prise : nul », « Plus assez de pièces pour mater : nul », « Abandon », « Nul d'un commun accord »), roi maté couché, case du mat surlignée.
9. **Télé** : grand échiquier, deux grosses têtes dont l'humeur suit la partie (échec = surprise, avance de matériel = cool), pendules géantes, paris.

Style « sticker book », thème clair + sombre (cases crème / couleur du jeu, jamais blanc pur / noir pur pour que les pièces ressortent).

## 5. Tenue Grand Maître ♟️ et trophées

- Tenue `grandmaitre` (« Grand Maître », dossier d'art `chess`), débloquée par **10 duels gagnés aux Échecs** (`duels(...)` dans `src/data/tenues.ts` + `tenues.sql`).
- Art : 9 planches + 9 portraits V3 (prompts déjà écrits dans `docs/PROMPTS-TENUES-V3.md`) ; d'ici là repli habituel (chibi de base + ♟️).
- 11 trophées (slots 2-12), actifs dès la sortie. « Coup » = coup d'un joueur (pas un demi-coup). Compteurs de manche renvoyés par `board_move` (`game`), agrégés par `game_echecs_trophy_stats` :

| Slot | id | Nom | Condition | Compteur (stats) |
|---|---|---|---|---|
| 2 | `ech_berger` | Le coup du berger | Se faire mater en 10 coups ou moins | `fast_mated` (somme) ≥ 1 |
| 3 | `ech_adieu_ma_dame` | Adieu ma dame | Se faire prendre sa dame 5 fois (cumul) | `queens_lost` (somme) ≥ 5 |
| 4 | `ech_pat_zut` | Pat… zut ! | Mettre l'adversaire pat alors qu'on avait 5 points de matériel d'avance ou plus | `stalemate_blunders` (somme) ≥ 1 |
| 5 | `ech_gourmand` | Le gourmand | Prendre 50 pièces (cumul) | `captures` (somme) ≥ 50 |
| 6 | `ech_partie_fleuve` | Partie fleuve | Finir une manche de 40 coups ou plus | `max_moves` (max) ≥ 40 |
| 7 | `ech_au_chaud` | Bien au chaud | Roquer 10 fois (cumul) | `castles` (somme) ≥ 10 |
| 8 | `ech_en_passant` | En passant | Réussir une prise en passant | `en_passants` (somme) ≥ 1 |
| 9 | `ech_nouvelle_reine` | Nouvelle reine | Promouvoir 3 pions (cumul) | `promotions` (somme) ≥ 3 |
| 10 | `ech_et_mat` | Échec et mat ! | Gagner 5 manches par échec et mat (cumul) | `mates` (somme) ≥ 5 |
| 11 | `ech_mat_eclair` | Mat éclair | Mater en 15 coups ou moins | `fast_mates` (somme) ≥ 1 |
| 12 | `ech_grand_maitre` | Grand Maître | Gagner 25 duels (cumul) | `duel_wins` (somme) ≥ 25 |

Matériel : pion 1, cavalier 3, fou 3, tour 5, dame 9. Seuils à calibrer après deux ou trois soirées.
Catalogue ajouté à `docs/TROPHEES.md`, `src/data/trophees.ts` et au seed de `trophees.sql`.

## 6. Tests

- **SQL (PGlite)** `tools/sql-tests/echecs.mjs` :
  - **perft** (nombre de positions atteignables, valeurs de référence connues) : position initiale 20 / 400 / 8 902 (profondeurs 1-3) ;
    position « Kiwipete » 48 / 2 039 ; finale `8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w` 14 / 191 / 2 812 — valide d'un coup roques, prises en passant, promotions et clouages ;
  - parties scriptées : mat du berger, pat, répétition triple, 50 coups, chaque cas de matériel insuffisant, roque refusé (roi en échec, case traversée attaquée, tour déjà bougée),
    prise en passant refusée un coup trop tard, promotion sans `promo` → `promotion_required`, sous-promotion ;
  - pendule : décompte, `flag` refusé avant l'heure, chute du drapeau = défaite / nul si roi seul en face ; `board_auto` toujours légal (1 000 tirages) ;
  - abandon, nul proposé / accepté / ignoré ; compteurs des 11 trophées ; session complète via `_duel_action` (duel en 3 manches, alternance des couleurs).
- **Socle** : non-régression des 3 jeux en duel existants après l'ajout de `turn_seconds` (tests `game-states.mjs`).
- **Front** : `tsc`, `eslint`, `npm run build` ; page de test locale (non commitée) à deux onglets ; essai réel sur téléphones par l'utilisateur.

## 7. Livraison

1. **Étape 1 — moteur SQL + tests** (le gros du risque) : règles complètes, perft, pendule, évolution `turn_seconds` du socle.
2. **Étape 2 — front** : plateau tactile, promotion, options, fin de manche, résumé, tenue au catalogue, trophées, docs (ARCHITECTURE.md, TROPHEES.md).
3. **Étape 3 — finitions** : fiche « Les pièces », vérification du mode télé, vidéo tuto de 35 s (montre l'interface, pas les règles des échecs).
4. Intégration des planches / portraits Grand Maître dès réception (circuit habituel, dossier `chess`).

## 8. Questions ouvertes

1. **Cadence par défaut** : pendule 5 min par joueur (proposé) ou « Sans pendule, 60 s par coup » plus doux pour des débutants mais sans durée bornée ?
2. **Annuler un coup** : rien en V1 (proposé), ou « ↩️ Reprendre » accepté par l'adversaire, réservé au mode Sans pendule ?
3. **Confirmation du coup** : coup joué dès la 2e touche (proposé), ou bouton « Jouer » pour éviter les fausses manips (plus lent) ?
4. **Abandon / nul hors de son tour** : à son tour seulement en V1 (zéro évolution du socle) ; suffisant ?
5. **Mode de session par défaut** : Duel (proposé) ; faut-il carrément masquer Roi de la table pour ce jeu ?
6. **Pièces** : SVG maison style sticker (proposé) ou pièces à l'effigie des persos (roi = Dédé…) — joli mais moins lisible et plus long.

## 9. Hors périmètre

Jouer contre l'ordinateur, analyse / conseil de coup, notation et relecture de la partie, incrément à la pendule, pré-coups, glisser-déposer,
variantes (mini-échecs 5×6, Chess960), parties par correspondance sur plusieurs jours, classement Elo.

## 10. Décisions (2026-11-19, validées par l'utilisateur : « j'accepte tout »)

- Cadence par défaut : pendule 5 min par joueur ; options 3 / 10 min et « Sans pendule » (60 s par coup).
- Pas d'« Annuler » en V1 ; pas de confirmation du coup (deux touches suffisent).
- Abandon possible à tout moment (pas seulement à son tour) ; proposition de nul à son tour.
- Mode Duel par défaut (`defaultMode`), Roi de la table et Tournoi restent disponibles.
- Pièces : SVG maison au style sticker book (pièces à l'effigie des persos : V2).
