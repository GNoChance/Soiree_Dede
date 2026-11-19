# Kems — conception

Jeu n°23 des Soirées de Dédé, id `kems`. Jeu de cartes par **équipes de 2** avec signe secret entre coéquipiers.
Spec à valider par l'utilisateur avant le code (2026-11-19).

## 1. Intention

Le Kems de la cour de récré, autour de la table : on échange ses cartes le plus vite possible, on fait son signe en douce, on guette celui des autres.
Le téléphone remplace le paquet de cartes (main privée, centre commun, arbitrage) ; **le signe, lui, reste dans la vraie vie**.
Réussi si : personne ne peut tricher sur ses cartes, deux joueurs qui visent la même carte ne cassent rien (le serveur tranche),
une manche dure 1 à 3 min, et on entend crier « Kems ! » dans le salon.

## 2. Règles

### Rappel du vrai Kems
Équipes de 2, coéquipiers face à face, chaque équipe convient en secret d'un **signe** discret. Chacun a 4 cartes en main, 4 cartes sont face visible au centre.
Tout le monde joue **en même temps** : on échange une carte de sa main contre une carte du centre, autant de fois qu'on veut. Quand plus personne ne veut des cartes du centre,
on les jette et on en retourne 4 nouvelles. Dès qu'un joueur a **4 cartes de même valeur** (un carré), il fait le signe ; son partenaire crie **« Kems ! »** et l'équipe marque.
Un adversaire qui repère le signe peut crier **« Contre-Kems ! »** avant : si un joueur de l'équipe visée a bien un carré, c'est lui qui marque ; sinon il est pénalisé.

### Le signe : physique, pas à l'écran (choix tranché)
- Les signes se font **autour de la table** (se gratter le nez, tirer la langue, clin d'œil…). Le téléphone ne sert qu'aux cartes et aux boutons **« KEMS ! »** / **« CONTRE-KEMS ! »**.
- Pourquoi : (1) c'est tout le sel du jeu et ce qui fait rire ; (2) l'appli est conçue pour des soirées en présence ; (3) un signe à l'écran obligerait
  à fixer son téléphone et serait soit invisible, soit évident ; (4) zéro développement. Le mode télé affiche le centre en grand pour que les joueurs **lèvent les yeux**.
- Conséquence assumée : le jeu ne se joue pas à distance (alternatives en questions ouvertes).

### Joueurs et équipes
- **4, 6 ou 8 joueurs**, soit **2 à 4 équipes de exactement 2** (🔴 🔵 🟢 🟡). Les autres membres de la soirée vont sur le **banc 👀** (non joueurs, comme à Nom de Code).
- L'écran de départ rappelle : « Assieds-toi en face de ton coéquipier ».

### Cartes
- **4 joueurs : 32 cartes** (7 → As), **6 ou 8 joueurs : 52 cartes** — pour qu'un carré arrive vite (réglage à calibrer en jeu).
- Chacun 4 cartes (secrètes), 4 cartes au centre (publiques), le reste en pioche. Les cartes balayées vont à la défausse ; pioche vide → la défausse est remélangée.

### Déroulé d'une manche
1. **Signes** (au début de la partie, puis sur demande) : « Mettez-vous d'accord en secret sur votre signe » ; chaque équipe reçoit en privé 3 idées de signes ;
   tout le monde touche « Prêt » (ou 45 s).
2. **Échanges, tous en même temps** : toucher une carte de sa main puis une carte du centre → elles s'échangent. Pas de tour, pas de limite.
   **Conflit** : si deux joueurs visent la même carte du centre, le premier arrivé au serveur l'a ; l'autre voit « Trop tard ! » et garde sa carte.
   Chaque échange est **public** (« Manon prend le 7♥, pose le R♠ »), comme à la vraie table.
3. **Balayer le centre** : bouton « 🧹 Suivantes » (vote). Les 4 cartes sont remplacées quand **tous** les joueurs ont voté, ou après **10 s sans aucun échange**.
   Un échange annule les votes.
4. **« KEMS ! »** : valide si **le partenaire** de celui qui appuie a un carré. On ne peut pas l'annoncer pour soi-même : sans signe, pas de Kems.
   - réussi : l'équipe marque **+1** ; **Double Kems** (les deux coéquipiers ont un carré) : **+2** ;
   - raté (le partenaire n'a pas de carré) : **+1 pour chaque autre équipe**.
5. **« CONTRE-KEMS ! »** : on vise une équipe adverse (à 2 équipes : directe ; à 3-4 équipes : on touche la couleur visée).
   - réussi (au moins un joueur de l'équipe visée a un carré) : l'équipe qui contre marque **+1** ;
   - raté : **+1 pour chaque autre équipe**.
6. Le premier appel reçu par le serveur **termine la manche** ; les appels suivants sont ignorés sans erreur. Toutes les mains sont **révélées** (6 s, l'hôte peut passer),
   puis on redistribue tout.
7. **Manche blanche** : après 3 min sans appel, on redistribue sans point.

Le téléphone du joueur qui a un carré le lui dit discrètement (« Carré ! Fais ton signe 🤫 », visible de lui seul) : pas de carré oublié par distraction.

### Fin de partie
- Première équipe à **5 points** (option hôte : 3 / **5** / 7). Si plusieurs équipes atteignent le but sur la même manche (erreur d'une autre équipe) : co-vainqueurs.
- `finish_match` : membres de l'équipe gagnante = vainqueurs, `points` = score de l'équipe.

## 3. Architecture

Jeu « classique » (pas le socle duel), conventions de `ARCHITECTURE.md` ; proche de `pas-de-bol` (mains dans `match_secrets`) et de `nom-de-code` (équipes, banc, télé).
Aucun nouveau mécanisme transverse : `game_action` verrouille déjà la ligne du match (`select … for update`), les actions simultanées sont donc **sérialisées par le serveur**.

### Serveur — `supabase/games/kems.sql`
- `game_kems_start(p_players uuid[], p_options jsonb)` et `game_kems_action(p_state, p_server, p_actor, p_is_host, p_action)`, idempotent, terminé par les `revoke`.
- **Secrets** : `secrets[joueur] = {round, hand: [4 cartes], square: bool, sign_ideas: […]}` ; `server` = `deck`, `discard`, `hands`, `round_started_at`, `pstats`.
  Une main n'est jamais dans le state public avant la révélation.
- **State public** (forme indicative, miroir TS dans `src/games/kems/types.ts`) :
  `phase` (`signs` | `playing` | `reveal` | `finished`), `round`, `target`, `teams[{id, players[2], score}]`, `ready[]`,
  `center[4]` (ex. `"7H"`, `null` pendant un remplacement), `deck_count`, `sweep{votes[], deadline}`, `round_deadline`, `deadline` (prochaine échéance pour le `tick`),
  `feed[]` (6 derniers échanges : `{by, took, gave}`), `seq` (compteur d'actions, pour les animations),
  `call` (à la révélation : `{type: kems|counter|timeout, by, team, target, ok, double, deltas{équipe: n}, hands{joueur: [4]}}`).
- **Actions** :
  - `ready` (phase `signs`) ;
  - `swap {give, take}` — **identifiants de cartes**, pas des positions : une requête périmée échoue proprement (`card_taken`) au lieu d'échanger la mauvaise carte ;
  - `sweep` (bascule de vote) ; `kems` ; `counter {team}` ; `tick` (signes, balayage, manche blanche, fin de révélation ; idempotent) ; `next` (hôte, `reveal`).
  - `kems` / `counter` / `swap` / `sweep` reçus hors phase `playing` : ignorés sans erreur (state inchangé), comme les votes tardifs de Nom de Code.
- **Démarrage** : options `{ teams: {red:[a,b], blue:[c,d], green?, yellow?}, target: 3|5|7 }` ; erreurs `invalid_teams` si une équipe n'a pas exactement 2 joueurs.
- **Nouveaux codes d'erreur** (→ `src/features/soiree/errors.ts`) : `card_taken` (« Trop tard ! »), `not_in_hand`, `invalid_teams`.
- **Charge** : un échange = une RPC + une mise à jour Realtime du state (petit, < 2 Ko). À 8 joueurs, quelques actions par seconde au pire : acceptable ;
  garde-fou : un `swap` du même joueur moins de 250 ms après le précédent est ignoré (double appui).
- Tenue et trophées : `supabase/features/tenues.sql`, `trophees.sql`, compteurs dans `results[].stats` (§5), puis `npm run sql` (l'utilisateur recolle `install.sql`).

### Front — `src/games/kems/`
- `index.ts` (definition : `minPlayers: 4`, `maxPlayers: 9` dont banc, `order: 230`, `tv: true`), `Play.tsx` (lazy), `Summary.tsx` (lazy), `Options.tsx`,
  `Card.tsx` (carte classique : valeur + couleur en gros, contour épais), `setup.ts` (actions, `prepareStart`), `logic.ts` (carré, tri de la main, libellés), `signs.ts` (≈ 40 idées de signes), `sound.ts`, `types.ts`.
- **Sélecteur d'équipes** : `TeamsPicker` existant, avec une petite évolution — prop `teamSize` (ici 2 : une équipe pleine refuse un 3e joueur, répartition automatique par paires).
- **Échange optimiste** : la carte part visuellement dès la 2e touche ; si le serveur répond `card_taken`, elle revient avec « Trop tard ! ». La main affichée suit toujours le secret reçu du serveur.

## 4. Écrans

1. **Options (hôte)** : équipes de 2 (2 à 4 équipes + banc), points pour gagner (3 / 5 / 7). Bouton « Lancer » grisé avec la raison (« Il faut 2 joueurs par équipe »).
2. **Signes** : « 🤫 Choisis un signe secret avec Cécile » + 3 idées + « Assieds-toi en face d'elle » ; gros bouton « Prêt » ; têtes des joueurs prêts.
3. **Jeu (joueur)**, une seule page sans défilement :
   - en haut : scores par équipe (pastilles), pioche, fil des 3 derniers échanges (mini-chibi + cartes) ;
   - au milieu : les **4 cartes du centre**, grandes ; bouton « 🧹 Suivantes » avec compteur « 3 sur 4 » et barre des 10 s ;
   - en bas : **sa main** (4 grandes cartes, triées par valeur, les cartes de même valeur se regroupent) ; carré → halo discret + « Fais ton signe 🤫 » ;
   - tout en bas, loin des cartes : deux très gros boutons **« KEMS ! »** (couleur de son équipe) et **« CONTRE-KEMS ! »** (à 3-4 équipes : ouvre le choix de l'équipe visée).
4. **Révélation** : plein écran « KEMS ! 🔴 » / « CONTRE-KEMS réussi ! » / « Raté… » avec le chibi de celui qui a crié, les mains de tous retournées (carrés en valeur), points gagnés qui volent vers les scores, confettis ou écran qui tremble.
5. **Banc et spectateurs** : centre, fil des échanges, scores ; jamais les mains avant la révélation. Bouton « 📺 Mode télé ».
6. **Télé** : centre en très grand, scores, fil des échanges avec grosses têtes, révélation en grand — donne aux joueurs une raison de lever la tête.
7. **Fin de partie** : écran de résultats habituel (équipe gagnante, confettis), résumé : Kems réussis, contres, erreurs par équipe.

Style « sticker book », thème clair + sombre, cartes lisibles (valeur ≥ 28 px, ♥♦ rouges, ♠♣ encre, contour épais sur le blanc des cartes).

## 5. Tenue Cow-boy 🤠 et trophées

- Tenue **originale** `cowboy` (« Cow-boy », dossier d'art `cowboy`) : le joueur de cartes du saloon — chapeau, bandana, gilet, as glissé dans le ruban du chapeau.
  Distincte du Croupier 🃏 (Pas de bol !) et du Pirate. Débloquée par **10 victoires à Kems** (`wins(...)` dans `src/data/tenues.ts` + `tenues.sql`).
- Art : 9 planches + 9 portraits V3 (prompts ajoutés à `docs/PROMPTS-TENUES-V3.md`) ; d'ici là repli habituel (chibi de base + 🤠).
- 11 trophées (slots 2-12), actifs dès la sortie ; compteurs par joueur posés par le moteur (`server.pstats` → `results[].stats`) :

| Slot | id | Nom | Condition | Compteur (stats) |
|---|---|---|---|---|
| 2 | `kems_faux_kems` | Faux Kems ! | Crier « Kems ! » alors que ton partenaire n'a pas de carré | `false_kems` (somme) ≥ 1 |
| 3 | `kems_grille` | Grillé ! | Ton équipe subit 3 Contre-Kems réussis (cumul) | `countered` (somme) ≥ 3 |
| 4 | `kems_parano` | Parano | Crier « Contre-Kems ! » à tort 3 fois (cumul) | `false_counters` (somme) ≥ 3 |
| 5 | `kems_collectionneur` | Collectionneur | Réunir 10 carrés (cumul, un par manche au plus) | `squares` (somme) ≥ 10 |
| 6 | `kems_pilier_de_saloon` | Pilier de saloon | Jouer 10 parties (cumul) | parties jouées ≥ 10 |
| 7 | `kems_complices` | Complices | Réussir 10 Kems avec son équipe (cumul) | `team_kems` (somme) ≥ 10 |
| 8 | `kems_oeil_de_lynx` | Œil de lynx | Réussir 3 Contre-Kems en étant celui qui crie (cumul) | `counters_ok` (somme) ≥ 3 |
| 9 | `kems_eclair` | Kems éclair | Réussir un Kems moins de 20 s après le début de la manche | `fast_kems` (somme) ≥ 1 |
| 10 | `kems_poker_face` | Poker face | Gagner une partie sans erreur de son équipe et sans se faire contrer | `clean_win` (somme) ≥ 1 |
| 11 | `kems_double` | Double Kems | Réussir un Double Kems (les deux coéquipiers ont un carré) | `double_kems` (somme) ≥ 1 |
| 12 | `kems_legende` | Légende du saloon | Gagner 15 parties (cumul) | `won` (somme) ≥ 15 |

Catalogue ajouté à `docs/TROPHEES.md`, `src/data/trophees.ts` et au seed de `trophees.sql`.

## 6. Tests

- **SQL (PGlite)** `tools/sql-tests/kems.mjs` : distribution 4 / 6 / 8 joueurs (32 ou 52 cartes, aucune carte en double, total conservé à chaque action) ;
  mains visibles du seul propriétaire (banc, spectateurs, télé : rien) ; `swap` nominal, carte absente de la main, **deux `swap` sur la même carte du centre** (2e → `card_taken`, mains intactes) ;
  balayage (unanimité, annulation par un échange, échéance 10 s, pioche vide → défausse remélangée) ;
  Kems réussi / double / raté / annoncé pour soi-même ; Contre-Kems réussi / raté, à 2 et à 4 équipes ; appel tardif ignoré ; manche blanche ;
  ticks idempotents ; fin de partie, co-vainqueurs ; `invalid_teams` ; compteurs des 11 trophées.
- **Front** : `tsc`, `eslint`, `npm run build` ; page de test locale (non commitée) à 4 onglets ; **essai réel à 4 téléphones** par l'utilisateur
  (c'est là qu'on règle : 32 / 52 cartes, délai de balayage, taille des boutons).

## 7. Livraison

1. **Étape 1 — jeu sur téléphones** : SQL + tests, front (options, signes, jeu, révélation, résumé), évolution `teamSize` de `TeamsPicker`, tenue au catalogue, trophées, docs (ARCHITECTURE.md, TROPHEES.md).
2. **Étape 2 — mode télé**.
3. **Étape 3 — vidéo tuto** (35 s : équipes et signe, échanges, « Kems ! », « Contre-Kems ! »).
4. Intégration des planches / portraits Cow-boy dès réception (circuit habituel, dossier `cowboy`).

## 8. Questions ouvertes

1. **Signe** : physique autour de la table (proposé). Alternatives : (a) bouton « signe » discret qui fait bouger son chibi sur tous les écrans — jouable à distance mais tout le monde fixe son téléphone ;
   (b) signe choisi dans une liste d'emojis et affiché une demi-seconde ; (c) vibration du téléphone du partenaire — plus aucun risque d'être repéré, donc plus de Contre-Kems.
2. **Qui appuie sur « KEMS ! »** : le partenaire seulement (proposé, fidèle au jeu) ; ou autoriser celui qui a le carré (plus simple, mais le signe devient inutile) ?
3. **Pénalité d'un appel raté** : +1 aux autres équipes (proposé) ou −1 à l'équipe fautive ?
4. **Score** : premier à 5 points (proposé) ou les lettres K-E-M-S (l'équipe qui les reçoit toutes a perdu, plus « cour de récré ») ?
5. **Balayage du centre** : unanimité ou 10 s d'inactivité (proposé) ; majorité plutôt qu'unanimité ?
6. **Fausse manip** : boutons KEMS / CONTRE-KEMS sans confirmation (proposé, c'est un jeu de vitesse) ou appui long d'une demi-seconde ?
7. **Tenue** : Cow-boy 🤠 `cowboy` (proposé) ; autres pistes : Magicien 🪄 `magician`, Complice 🤫 `accomplice`.

## 9. Hors périmètre

Jeu à distance, équipes de 3, nombre impair de joueurs (un joueur seul), signes gérés par l'appli, variantes « Kems coupé » / « Double contre »,
manche à thème, choix du jeu de cartes par l'hôte, chat dédié aux équipes.

## 10. Décisions (2026-11-19, validées par l'utilisateur : « j'accepte tout »)

- Signe physique autour de la table (le téléphone ne gère que cartes + boutons).
- « KEMS ! » : seul le partenaire de celui qui a le carré peut l'appeler (n'importe quel joueur pour « CONTRE-KEMS ! » contre l'équipe adverse).
- Appel raté : +1 à chaque autre équipe. Score en points, premier à 5 (options 3 / 5 / 7).
- Balayage du centre à l'unanimité, ou automatiquement après 10 s sans échange.
- Boutons KEMS / CONTRE-KEMS : appui long (≈ 0,6 s) pour éviter les appuis accidentels.
- Tenue : Cow-boy 🤠 (`cowboy`), 10 victoires.
