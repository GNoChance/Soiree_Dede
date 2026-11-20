# Dédé Party — les 5 plateaux — conception

Suite de `2026-11-19-dede-party-design.md`. Demande : « Pour la Dédé Party fais plusieurs maps, inspire-toi des vrais Mario Party. Je veux 5 maps différentes. »
« Le Grand Plateau de Dédé » reste le plateau n°1 ; ce document conçoit les **4 nouveaux**.
**Statut : conception tranchée (carte blanche), prête à implémenter.** Aucun code modifié par ce document.

Tout est **original** : on reprend des mécaniques de genre des party games de plateau (banque à péage, personnage voleur, plateau qui se transforme, cases qui téléportent), jamais un nom, un personnage, un plateau, une case ou un visuel d'un jeu existant.
Contrainte du moteur respectée partout : **aucune décision pendant les déplacements** (tout le monde lance en même temps, le serveur résout le tour d'un coup, les écrans animent). Chaque mécanique est automatique, visible avant de lancer, et se raconte en une phrase.

## 0. Vue d'ensemble

| N° | id | Plateau | Silhouette | Cases (tour) | Mécanique signature | Se déclenche | Ce que la table surveille |
|---|---|---|---|---|---|---|---|
| 1 | `grand` | 🎤 Le Grand Plateau de Dédé | anneau + 2 poches | 47 (36 à 44) | Aiguillages qui basculent | au passage | « il vient de tourner ! » |
| 2 | `mer` | 🏖️ Dédé-sur-Mer | anneau + langue de sable | 45 (36 ou 44) | 🌊 La Grande Marée : le Banc de sable s'ouvre et se referme, la vague emporte les traînards | tous les 3 tours (fin de tour) | l'horloge de la marée |
| 3 | `kermesse` | 🎪 La Kermesse de Dédé | nœud papillon (11 × 7) | 40 (40) | 🎟️ La Tombola : 3 pièces au passage, gros lot à qui s'arrête pile dessus | au passage / à l'arrêt | la cagnotte qui grossit |
| 4 | `camping` | 🏕️ Le Camping des Pins Penchés | croix à 4 branches | 36 (36) | 🦝 Riton le raton rôde à contresens : sac vide il vole, sac plein il lâche tout | fin de chaque tour + croisement | où est Riton, sac vide ou plein |
| 5 | `ski` | ⛷️ Dédé 2000 | escargot (montagne) | 49 (49) | 🚡 Télésièges et 🧊 plaques de verglas, 🛷 Grande Luge du Sommet au Départ | à l'arrêt (pile dessus) | « pile sur le télésiège ! » |

Cinq façons de jouer : le n°1 répartit (un pion sur deux par chaque voie), le n°2 impose un **rythme** (marée), le n°3 change l'**économie** (cagnotte commune), le n°4 ajoute un **rôdeur** sur le plateau, le n°5 change le **déplacement** (grands sauts en avant et en arrière).
La seule décision du jeu reste le Triple dé, et son bon moment change selon le plateau : filer hors du Banc de sable avant la marée, tenter le gros lot, sauter sur Riton quand son sac est plein, viser un télésiège.

## 1. Principe commun

### 1.1 Choix du plateau

- Nouvelle option de partie `map` : `grand` · `mer` · `kermesse` · `camping` · `ski` · `random`. **Défaut : `random` (« Au hasard 🎲 »)**.
- Écran Options (hôte), au-dessus de « Durée » : titre « Plateau », grille de 6 grosses cartes sur 2 colonnes (≥ 72 px de haut) : émoji + nom + une ligne (`pitch`) + mini-silhouette du tracé (SVG tiré de `xy`, une pastille par case). Carte choisie : contour épais + ombre décalée (style sticker).
- « Au hasard » est résolu par `prepareDedePartyStart` (front) : tirage uniforme parmi les 5 **sauf le dernier plateau joué sur cet appareil** (`localStorage`, clé `dp:last-map`, lecture/écriture sous `try/catch`) ; le serveur reçoit toujours un id concret. Filet de sécurité serveur : `map` absent ou inconnu → tirage uniforme parmi les 5.
- Tout le monde découvre le plateau au **générique** : carte « Ce soir : 🏖️ Dédé-sur-Mer » + la mécanique en une phrase (`rule`) + réplique d'accueil de Dédé. `intro_s` passe de 5 à **8 s** (le temps de lire).
- L'aide « Les cases » (téléphone) et la légende (télé) affichent le plan 2D du plateau en cours, ses cases, et un encart « La particularité du plateau ».

### 1.2 Ce qui ne change pas (commun aux 5 plateaux)

2 dés (Triple dé une fois), lancer simultané, ordre de passage tournant, 10 pièces au départ, Départ +5 à chaque passage en avant, Applaudissements +3, Page de pub −3, 12 cartes Enveloppe, 1 à 3 étoiles en jeu sur des Loges (30 pièces, la première de chacun à 15, achat automatique au passage ou à l'arrêt, déménagement dans une Loge libre), mini-jeu à chaque tour (10/6/4/2, Finale doublée), cérémonie (Roi des mini-jeux, Prix de la poisse), durées 6/9/12 tours, phases et minuteurs, mode télé, Dédé animatrice en tenue `host`.
Les 5 types de cases existants (`start`, `clap`, `pub`, `env`, `loge`) gardent nom, émoji, couleur et effet sur tous les plateaux.

Règles transversales (valables pour toutes les mécaniques) :

1. **Ordre des effets sur une case franchie** : aiguillage → Départ → mécanique du plateau (péage, Riton) → étoile.
2. **Pas de chaînes.** Un déplacement à pied dû à une carte (avance, recule, relance) applique les effets de passage (Départ et péage en avant, croisement de Riton, étoile) mais **jamais l'effet de la case d'arrivée**. Un **saut** (télésiège, verglas, vague, carte « échange de place ») ne franchit aucune case : pas d'effet de la case d'arrivée non plus ; seuls le télésiège et le verglas achètent l'étoile si elle se trouve à l'arrivée.
3. Les pièces ne passent jamais sous 0 ; on paie ce qu'on a.
4. Un pion fait au plus **24 pas** par tour (animation de 5 s) : vrai sur les 5 plateaux (un télésiège ou une glissade compte pour 1 pas).

### 1.3 Modèle de données d'un plateau

Un plateau = des tableaux parallèles indexés par numéro de case (0 = Départ), comme aujourd'hui, plus une petite fiche pour la mécanique.

**Front** — `src/games/dede-party/boards/<id>.ts` (un fichier par plateau), `board.ts` devient le registre :

```ts
export type MapId = 'grand' | 'mer' | 'kermesse' | 'camping' | 'ski'
export type CellType = 'start' | 'clap' | 'pub' | 'env' | 'loge' | 'tombola' | 'lift' | 'ice'

export interface ForkInfo { cell: number; ways: [number, number]; names: [string, string]; emojis: [string, string]; mode: 'toggle' | 'tide' }
export interface Zone { id: string; name: string; emoji: string; cells: number[]; road?: string /* teinte du ruban */ }

export interface BoardDef {
  id: MapId
  no: number                 // 1..5 (stat `map_no`)
  name: string; emoji: string
  pitch: string              // une ligne pour les options
  rule: string               // la mécanique en une phrase (générique, aide)
  cols: number; rows: number // grille paysage ; portrait = transposée
  cells: CellType[]
  next: Array<number | [number, number]>  // [tout droit, détour] = embranchement
  prev: number[]             // carte « recule » : par la grande boucle aux retours
  xy: Array<[number, number]>             // (col, row) de chaque case
  forks: ForkInfo[]          // dans l'ordre de state.sw
  jumps: Array<[number, number]>          // liaisons sans ruban, franchies en grande cloche (luge)
  extra: Record<string, unknown>          // miroir exact de _dp_map(id) (données de la mécanique)
  zones: Zone[]
  dede: { col: number; row: number; scale: number }  // estrade de Dédé (coordonnées de grille, décimales permises)
}
```

- Chaque fichier exporte, **sur une seule ligne chacun** (le test les relit par expression régulière, comme aujourd'hui) : `export const CELLS`, `export const NEXT`, `export const PREV`, `export const XY`, `export const EXTRA`, puis `export const board: BoardDef`.
- `board.ts` : `MAP_IDS`, `BOARDS: Record<MapId, BoardDef>`, `boardOf(id?: string)` (id absent ou inconnu → `grand` : parties en cours au moment du déploiement), `cellXY(board, i, portrait)`, `linksOf(board)`, `CELL_INFO` (8 types), `starCount`. Les constantes globales `CELLS / NEXT / PREV / COLS / ROWS / FORKS / LINKS / SCENE_CELLS / TUNNEL_CELLS` disparaissent : `anim.ts`, `GameBoard.tsx`, `Stage.tsx`, `PartyScene.ts` reçoivent le `BoardDef` de `boardOf(state.map)`.
- Règle de tracé (vérifiée par le test) : deux cases reliées sont **voisines** (haut/bas/gauche/droite) sauf les `jumps` ; aucune case superposée ; deux cases voisines sont toujours reliées (pas d'ambiguïté à l'œil).

**SQL** — `supabase/games/dede-party.sql` : les fonctions de plateau prennent le plateau en paramètre.

| Fonction | Rôle |
|---|---|
| `_dp_maps()` | `["grand","mer","kermesse","camping","ski"]` |
| `_dp_board(p_map text)` | types des cases (`case p_map when … else` le Grand Plateau) |
| `_dp_next(p_map text)` · `_dp_prev(p_map text)` | tracé |
| `_dp_map(p_map text)` | fiche de la mécanique (miroir de `EXTRA`) |

`drop function if exists public._dp_board(); … _dp_next(); … _dp_prev();` en tête (les versions sans argument disparaissent ; le fichier reste idempotent).

```
_dp_map('grand')    = {"no":1,"mech":"forks","forks":["toggle","toggle"]}
_dp_map('mer')      = {"no":2,"mech":"tide","forks":["tide"],"bank":[36,37,38,39,40,41,42,43,44],"wash_to":14}
_dp_map('kermesse') = {"no":3,"mech":"tombola","forks":[]}
_dp_map('camping')  = {"no":4,"mech":"riton","forks":[],"riton_start":18}
_dp_map('ski')      = {"no":5,"mech":"tp","forks":[],"tp":{"3":37,"6":40,"12":42,"15":45,"21":47,"36":2,"43":13,"46":20}}
```

**Synchro testée** (`tools/sql-tests/dede-party.mjs`) : pour chaque id de `_dp_maps()`, `CELLS / NEXT / PREV / EXTRA` du fichier `boards/<id>.ts` = `_dp_board / _dp_next / _dp_prev / _dp_map` ; plus les contrôles de tracé du §8.

### 1.4 Extensions communes du moteur

**Constantes de `_dp_const()`** : `intro_s` passe à 8 ; ajouts : `"epi_s":4,"tide_low":2,"tide_high":1,"wash":5,"toll":3,"pot_seed":5,"riton_steal":5`.

**State public** (miroir `types.ts`) :

| Clé | Contenu |
|---|---|
| `map` | id du plateau |
| `mech` | état de la mécanique : `{}` (`grand`, `ski`) · `{tide: 0\|1, tide_in: 1\|2}` (`mer`, 0 = basse) · `{pot: n}` (`kermesse`) · `{riton: case, sack: n}` (`camping`) |
| `sw` | un élément par embranchement du plateau (`[]` s'il n'y en a pas) ; sur `mer`, `sw[0] = 1 − tide` (tenu par le serveur, jamais basculé par un pion) |
| `epi` | **épilogue du tour** (voir plus bas) ou `null` |

`_dp_snap()` ajoute `mech` (les instantanés `before` / `after` le portent, l'animation affiche donc cagnotte, sac, marée et position de Riton « en direct »).

**Épilogue du tour** : évènement du plateau joué **après le dernier pion**, calculé dans `_dp_resolve` (nouvelle fonction `_dp_epilogue(p_state, p_server)`), publié dans `state.epi = {t, …, after: snap}`. S'il existe, l'échéance de la phase `move` gagne `epi_s` (4 s) : `2 + 5 × joueurs + 4`. Remis à `null` par `_dp_open_roll`. Utilisé par `mer` (les tours où la marée change) et `camping` (tous les tours).
Front : `anim.ts` ajoute un segment `EPI_MS = 4000` après les pions ; `boardViewAt` renvoie `epi: {data, t}` pendant ce segment (instantané = `after` du dernier pion), puis `epi.after`.

**Nouveaux évènements** (`DpEvent.t`), toujours avec la valeur d'arrivée pour rejouer l'état en direct :

| `t` | Champs | Où |
|---|---|---|
| `fork` (existant) | + `tide: true` sur `mer` | étape |
| `toll` | `d` (−3 ou moins), `pot` (après) | étape (case Tombola franchie) |
| `jackpot` | `d` (gain), `pot` (après = 5) | arrêt |
| `riton` | `k: 'steal' \| 'drop' \| 'none'`, `d`, `sack` (après) | étape, ou `hits[]` de l'épilogue |
| `tp` | `k: 'lift' \| 'ice'`, `from`, `to` | sur l'étape ajoutée (`step.tp = k`, `cell = to`) |

Épilogues : `{t:'tide', tide, washed:[{id, from, d}], stars?: number[], after}` et `{t:'riton', die, from, path: number[], hits:[{id, cell, k, d, sack}], after}`.

**Fonctions modifiées** :

- `_dp_walk` : lit `map` ; embranchement en mode `tide` = voie `1 − tide` sans bascule ; péage (`kermesse`) ; croisement de Riton (`camping`) ; puis étoile (inchangé).
- `_dp_land` : `tombola` (gros lot), `lift` / `ice` (ajoute une étape `tp`).
- `_dp_move_star` : `_dp_board(map)` ; sur `mer` à marée haute, jamais une Loge de `bank`.
- `_dp_resolve` : épilogue + échéance. `_dp_snap` : `mech`. `_dp_tstats` : nouveaux compteurs (§7).
- `game_dede_party_start` : option `map`, `mech` initial, `sw` à la bonne taille, étoiles posées avec `_dp_board(map)`.
- Le dé de Riton passe par `_dp_die` (donc par `server.forced_dice` dans les tests), **après** tous les dés du tour (lancers puis cartes « Bis »).

**Stats par joueur ajoutées** (dans `state.stats`, recopiées par `_dp_tstats`) : `washed`, `toll_paid`, `jackpots`, `jackpot_best`, `robbed`, `loot`, `lifts`, `slides`, et `map_no` (1 à 5) dans les stats de fin. Toutes à 0 si le plateau ne les utilise pas.
`stats.best_card` (« meilleur moment » du résumé) accepte aussi le gros lot (`{card:'jackpot', text:'Gros lot de la Tombola', gain}`) et le sac de Riton (`{card:'riton', text:'Le sac de Riton', gain}`).

### 1.5 Rendu commun

- **`PartyScene`** reçoit le `BoardDef` : `cellPos`, `HALF_X / HALF_Z`, cadrage caméra (`fitDistance`), tapis et guirlande calculés depuis `cols × rows`. Ce qui reste identique partout : cases en relief, ruban du chemin, pions, étoiles, dés, pièces, confettis, étiquettes, caméra, poursuite lumineuse, gradins et public (c'est toujours une émission, « en direct de… »), estrade de Dédé (recolorée et placée par `board.dede`).
- **Thèmes** : `scene3d/themes/<id>.ts` exporte `palette: {light, dark}` (mêmes clés que `Palette` aujourd'hui), `build(ctx)` (décor fixe) et `update(ctx, view, dt)` (éléments animés, mécanique). `themes/grand.ts` reprend tel quel `buildZones` + rideaux + néons actuels. Les rideaux deviennent une **toile de fond** par thème (mêmes plans ondulés, couleur de la palette).
- **Cases des nouveaux types** : `makeCellTop` les gère via `CELL_INFO` (couleur + émoji), sans code spécifique.
- **Sauts (`jumps`)** : pas de ruban ; le pion franchit la liaison en grande cloche (même durée de pas, hauteur ×3, traînée de particules). Les étapes `tp` s'animent pareil.
- **Chevrons de sens** (nouveau, sur les 5 plateaux) : un petit triangle encre posé sur le ruban toutes les 3 liaisons, pointant dans le sens de marche (`InstancedMesh`). Indispensable sur les tracés à voies parallèles (croix, escargot, nœud papillon).
- **Puce de mécanique** (téléphone et télé, à côté du tour en cours) : un seul bandeau court, mis à jour en direct — textes donnés par plateau ci-dessous.
- **Plateau 2D** (`GameBoard.tsx`, repli sans WebGL et aide) : même `BoardDef` ; `jumps` et téléporteurs en pointillés fléchés ; Riton = pastille 🦝 sur sa case ; cases du Banc de sable voilées de bleu à marée haute ; cagnotte affichée à l'emplacement du stand.
- **Lisibilité** : toutes les grilles tiennent en 11 × 9 (ou 11 × 7) ; au téléphone la grille est transposée (9 × 11 ou 7 × 11), aucune case n'est plus petite qu'aujourd'hui. Les mécaniques se lisent sans texte : eau qui monte, compteur de cagnotte, sac de Riton qui gonfle, câbles des télésièges.
- **Répliques** : `dede-lines.ts` gagne les familles listées par plateau et un second paramètre facultatif `{n}` (nombre de pièces). Priorité dans `moverLine` : gros lot > étoile > Riton > télésiège / verglas > aiguillage > le reste (ordre actuel).

---

## 2. Plateau 2 — 🏖️ Dédé-sur-Mer

« L'émission spéciale vacances, en direct de la plage. » Une route fait le tour de la baie ; à marée basse, on coupe par le **Banc de sable** jusqu'au Phare.

- `pitch` : « La marée monte et descend : gare au Banc de sable ! »
- `rule` : « À marée basse, tout le monde coupe par le Banc de sable. Quand la mer monte, ceux qui y traînent sont emportés : −5 pièces. »

### 2.1 Ambiance, palette, décor

| Élément | Clair | Sombre (soirée d'été) |
|---|---|---|
| Fond / ciel (`bg`) | `#CFF4FF` | `#1B1740` |
| Sol hors plateau, sable (`floorA` / `floorB`) | `#FFE8A3` / `#FFD97A` | `#3A2E6B` / `#473A80` |
| Tapis = le rivage (`carpet` / `carpetDot`) | `#FFF1C9` / `#FFE29A` | `#4A3F8A` / `#5A4EA0` |
| Eau de la baie | `#2EC4F1` | `#1F4E8C` |
| Ruban du chemin (`road`) | `#FFF6E5` | `#FFE9B0` |
| Langue du Banc de sable | `#FFD166` | `#E0B04A` |
| Toile de fond | `#7FDBFF` | `#2B2160` |
| Accents | bouée et phare `#EF476F` + `#FFFFFF` ; parasols `#FF8FA3` `#06D6A0` `#FFD166` `#8B5CF6` | idem |

Décor en primitives (coordonnées de grille `(col, row)`, décimales permises) :

- **La baie** : un plan bleu semi-transparent (opacité 0,8) à l'intérieur de l'anneau (col 0,6 à 9,4 ; row 0,6 à 7,4), bordé d'un liseré blanc (écume). Sa hauteur est **la marée** : basse = 0,02 (sous les cases), haute = 0,42 (au-dessus du dessus des cases du Banc, qu'on devine sous l'eau). Montée / descente en 2 s.
- **Le Banc de sable** : boîte plate couleur sable sous les cases 36-44.
- **Le Phare** (5 ; 2,2), dans le creux du Banc : îlot (cylindre plat sable), tour (cylindre blanc, 3 anneaux rouges), lanterne (sphère jaune émissive) et toit (cône rouge). La lanterne tourne.
- **L'estrade de Dédé** = une grosse bouée (tore rayé rouge / blanc + cylindre) en (5 ; 6,3), `scale` 0,85 ; elle flotte avec la marée et tangue doucement.
- Baie gauche : voilier (boîte + cône blanc) en (2 ; 3,2), pédalo jaune en (2,2 ; 6). Baie droite : rocher (3 sphères grises) en (8,3 ; 3), bouées jaunes (sphères) en (8 ; 6).
- Autour : 6 parasols (cône coloré sur cylindre fin) le long de la Plage (sous la rangée 8), 4 cabines de plage rayées (boîtes + toit en cône à 4 faces) à gauche du Port, 4 palmiers (cylindre + 5 cônes verts aplatis) aux coins.
- **Échelle de marée** près de l'embranchement (3,4 ; 0,9) : poteau gradué (cylindre) avec un flotteur rouge (tore) qui monte et descend ; le panneau fléché existant de l'embranchement montre la voie ouverte.

Zones (plaques `makePlate`) : 🏝️ **Le Banc de sable** (36-44, fonctionnelle) ; décoratives : ⚓ Le Port (1-8), 🌊 La Digue (9-18), 🪨 La Corniche (19-26), ⛱️ La Plage (27-35). Case 13 (Pub) : 🍟 « La Baraque à frites ». Case 40 : ✨ « La Loge du Phare ».

### 2.2 Tracé exact — 45 cases, grille 11 × 9

Boucle de 36 cases (0-35) dans le sens horaire depuis le coin bas-gauche, plus le Banc de sable (36-44), détour en U de 9 cases accroché à la Digue. Tour : **36** par la Digue (marée haute), **44** par le Banc (marée basse).
Embranchement : case **12** → `[13, 36]` ; retour en **14** (depuis 13 ou depuis 44). `PREV[14] = 13`, `PREV[36] = 12`.

Lecture : numéro + type (D Départ, A Applaudissements, P Pub, E Enveloppe, L Loge).

```
     c0   c1   c2   c3   c4   c5   c6   c7   c8   c9   c10
r0   8P   9A  10E  11L  12A  13P  14A  15L  16E  17A  18P
r1   7L   ·    ·    ·   36A   ·   44A   ·    ·    ·   19L
r2   6A   ·    ·    ·   37A   ·   43A   ·    ·    ·   20A
r3   5E   ·    ·    ·   38E   ·   42E   ·    ·    ·   21P
r4   4A   ·    ·    ·   39A  40L  41A   ·    ·    ·   22E
r5   3L   ·    ·    ·    ·    ·    ·    ·    ·    ·   23A
r6   2P   ·    ·    ·    ·    ·    ·    ·    ·    ·   24L
r7   1A   ·    ·    ·    ·    ·    ·    ·    ·    ·   25P
r8   0D  35A  34P  33L  32E  31A  30P  29A  28L  27E  26A
```

```ts
CELLS = ['start','clap','pub','loge','clap','env','clap','loge','pub','clap','env','loge','clap','pub','clap','loge','env','clap','pub','loge','clap','pub','env','clap','loge','pub','clap','env','loge','clap','pub','clap','env','loge','pub','clap','clap','clap','env','clap','loge','clap','env','clap','clap']
NEXT  = [1,2,3,4,5,6,7,8,9,10,11,12,[13,36],14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,0,37,38,39,40,41,42,43,44,14]
PREV  = [35,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,12,36,37,38,39,40,41,42,43]
XY    = [[0,8],[0,7],[0,6],[0,5],[0,4],[0,3],[0,2],[0,1],[0,0],[1,0],[2,0],[3,0],[4,0],[5,0],[6,0],[7,0],[8,0],[9,0],[10,0],[10,1],[10,2],[10,3],[10,4],[10,5],[10,6],[10,7],[10,8],[9,8],[8,8],[7,8],[6,8],[5,8],[4,8],[3,8],[2,8],[1,8],[4,1],[4,2],[4,3],[4,4],[5,4],[6,4],[6,3],[6,2],[6,1]]
EXTRA = {"no":2,"mech":"tide","forks":["tide"],"bank":[36,37,38,39,40,41,42,43,44],"wash_to":14}
```

Répartition : 1 Départ, 19 Applaudissements (42 %), 8 Pubs (18 %), 8 Enveloppes (18 %), **9 Loges** (3, 7, 11, 15, 19, 24, 28, 33 sur la boucle ; 40 au Phare).
Le Banc est généreux (6 Applaudissements, 2 Enveloppes, 1 Loge, aucune Pub) ; « tout droit » ne fait qu'une case, une Pub.
`forks = [{cell: 12, ways: [13, 36], names: ['La Digue', 'Le Banc de sable'], emojis: ['🌊', '🏝️'], mode: 'tide'}]`, `jumps = []`, `dede = {col: 5, row: 6.3, scale: 0.85}`.

### 2.3 Mécanique signature — 🌊 La Grande Marée

**Règle.**

- La marée suit un cycle fixe de 3 tours : **2 tours basse, 1 tour haute**. Elle change à la **fin d'un tour** (épilogue), jamais pendant les déplacements.
- **Marée basse** : à l'embranchement (case 12), tous les pions prennent le **Banc de sable**. **Marée haute** : le Banc est sous l'eau, tous passent par la Digue (case 13). L'aiguillage ne bascule pas : il suit la mer.
- **Quand la mer monte**, chaque pion posé sur le Banc (cases 36-44) est **emporté par la vague** : il est déposé sur la case 14 (sur la Digue, au bout du Banc) et **perd 5 pièces** (ce qu'il a s'il en a moins). Aucun effet de la case 14.
- Si une étoile est sur la Loge du Phare (40) quand la mer monte, elle déménage ; tant que la mer est haute, aucune étoile ne s'y installe.
- Quand la mer redescend : le Banc rouvre, rien d'autre.

**Déroulé exact.** `mech = {tide, tide_in}` ; `tide_in` = nombre de fins de tour avant le prochain changement.

- Départ : phase tirée au sort parmi 3, visible dès le générique : `{tide:0, tide_in:2}`, `{tide:0, tide_in:1}` ou `{tide:1, tide_in:1}`. `sw = [1 − tide]`. Étoiles : jamais sur 40 si la mer est haute.
- Épilogue de chaque tour : `tide_in −= 1`. S'il reste > 0 : pas d'épilogue à l'écran (`epi = null`).
  - S'il tombe à 0 et que la mer était basse → **elle monte** : `tide = 1`, `tide_in = 1`, `sw[0] = 0` ; pour chaque pion sur `bank`, dans l'ordre de passage : `d = −min(5, pièces)`, `pos = 14`, `dist += 45 − case` (le chemin qu'il restait), stat `washed + 1` ; étoile sur 40 → `_dp_move_star` ; `epi = {t:'tide', tide:1, washed:[…], stars?, after}`.
  - S'il tombe à 0 et que la mer était haute → **elle descend** : `tide = 0`, `tide_in = 2`, `sw[0] = 1` ; `epi = {t:'tide', tide:0, washed:[], after}`.
- Le dernier tour applique la règle comme les autres.

**Cas limites.** La vague n'est pas un déplacement à pied : ni Départ, ni étoile, ni carte. La perte passe par `_dp_coins(…, 'wash')` (peut déclencher « Fauché »). Carte « recule » depuis la case 14 : par la Digue (13). Aucun pion ne peut se trouver sur le Banc pendant un tour de marée haute (tous emportés à la montée, personne n'y entre). Carte « échange de place » : sans risque pour la même raison.

**À l'écran.**

- Puce : « 🌊 Marée basse · elle monte dans 2 tours » · « ⚠️ La mer monte à la fin de ce tour ! » (pastille rouge qui pulse) · « 🌊 Marée haute · elle redescend à la fin de ce tour ».
- Passage de l'embranchement : étiquette « 🏝️ Banc de sable ! » ou « 🌊 Marée haute : par la Digue ».
- Épilogue (4 s) : caméra en vue d'ensemble, le plan d'eau monte (ou descend) en 2 s, écume ; les pions emportés glissent en cloche jusqu'à la case 14 à 1,2 s, pièces qui tombent à l'eau, étiquette « 🌊 −5 🪙 » ; le public fait la ola.

**Répliques de Dédé.**

| Famille | Répliques |
|---|---|
| `map_mer` (générique) | « Ce soir, on tourne à Dédé-sur-Mer ! Crème solaire pour tout le monde, et surveillez la marée. » · « Bienvenue à Dédé-sur-Mer : du sable, des mouettes… et une marée qui ne prévient pas. Enfin si, moi je préviens. » |
| `tide_warn` (lancer, la mer monte à la fin du tour) | « Attention, la mer monte à la fin de ce tour ! Ceux qui traînent sur le Banc de sable, je ne vous connais pas. » · « La marée arrive ! Dernier tour pour traverser les pieds au sec. » · « Ça clapote, ça clapote… À la fin du tour, le Banc de sable disparaît ! » |
| `fork_banc` | « {name} file sur le Banc de sable ! Regarde l'heure de la marée, quand même. » · « Direction le Phare pour {name}, les pieds dans le sable ! » · « {name} coupe par le Banc de sable. Pourvu que la mer soit patiente… » |
| `fork_banc_no` | « Marée haute : {name} reste sur la Digue. Au sec, mais devant la Baraque à frites. » · « Pas de Banc de sable pour {name}, la mer a dit non. » |
| `tide_wash` | « {name} n'a pas vu monter la mer… Plouf ! 5 pièces au fond de l'eau. » · « La vague dépose {name} sur la Digue, trempé jusqu'aux oreilles. −5 pièces ! » · « {name} boit la tasse ! Le porte-monnaie aussi. » · « Un maître-nageur pour {name} ! Et 5 pièces pour les poissons. » |
| `tide_up` (personne d'emporté) | « Marée haute ! Le Banc de sable est sous l'eau, tout le monde passe par la Digue. » · « Et voilà, la mer a tout recouvert. Personne à la baille ? Dommage pour l'audience. » · « Marée haute ! On range les serviettes. » |
| `tide_down` | « Marée basse ! Le Banc de sable est de retour : par ici le chemin du Phare. » · « La mer se retire… Qui veut aller ramasser des coquillages ? » · « Marée basse ! Le Phare est accessible à pied, profitez-en. » |

**Équilibre** (simulation, §6). 3 montées par partie de 9 tours ; **0,77 pion emporté par joueur et par partie** (≈ 3 à 4 joueurs, ≈ 6 à 8 joueurs : en moyenne un à deux pions par montée). Coût moyen ≈ 4 pièces par joueur et par partie, compensé par les cases du Banc. Étoiles par joueur : −2 à −4 % par rapport au Grand Plateau (identique à 2 joueurs) ; « Fauché » un peu plus fréquent (8 % contre 4 % à 4 joueurs).
Le Triple dé sert à sortir du Banc (ou à le sauter) le tour où la mer monte.

**Stats** : `washed` (fois emporté).

**Trophée** : aucun.

---

## 3. Plateau 3 — 🎪 La Kermesse de Dédé

« Pêche aux canards, barbe à papa, et une Tombola qui se remplit toute seule. » Un circuit en nœud papillon, deux lobes reliés par une allée : on passe **deux fois par tour** devant le stand de la Tombola.

- `pitch` : « Une Tombola à péage : la cagnotte grossit, qui la décroche ? »
- `rule` : « Passer devant la Tombola coûte 3 pièces, versées dans la cagnotte. S'arrêter pile dessus : le gros lot est à toi ! »

### 3.1 Ambiance, palette, décor

| Élément | Clair | Sombre (nocturne aux lampions) |
|---|---|---|
| Fond (`bg`) | `#FFF1E0` | `#161236` |
| Sol, pelouse (`floorA` / `floorB`) | `#B7E4A0` / `#A2D98A` | `#1F3B2D` / `#27493A` |
| Tapis (`carpet` / `carpetDot`, pois = confettis) | `#FFF8EC` / `#FFD6E0` | `#2A2460` / `#3A3380` |
| Ruban (`road`) | `#FFF6E5` | `#FFF6E5` |
| Toile de fond | `#FFD9A8` | `#2B2160` |
| Stand et cases Tombola | `#FF8C42` + blanc | idem |
| Accents | chapiteau `#EF476F` + blanc ; grande roue `#8B5CF6` ; manège `#4CC9F0` + `#FFD166` | idem, ampoules plus vives |

Décor en primitives :

- **Le stand de la Tombola** en (5 ; 3), entre les deux cases Tombola : boîte rayée orange / blanc, auvent (boîte inclinée), boulier (sphère dorée qui tourne) et, au-dessus, la **plaque de la cagnotte** « 🎟️ 14 » (`makePlate`, redessinée à chaque changement, `depthTest: false`).
- **Lobe gauche** (intérieur col 1-3, row 1-5) : chapiteau rayé (cylindre + cône + fanion) en (2 ; 1,7) ; estrade de Dédé en (2 ; 3,9), `scale` 0,85.
- **Lobe droit** (col 7-9, row 1-5) : grande roue (tore vertical, 8 sphères-nacelles de couleurs, 2 cylindres de pied) en (8 ; 2,1), qui tourne lentement ; manège (cylindre plat, toit en cône, 4 mâts) en (8 ; 4,2), qui tourne.
- Arche d'entrée (2 cylindres + boîte « KERMESSE ») dans l'encoche du bas (5 ; 5,8) ; barbes à papa (sphères roses sur bâtons) et ballons (sphères + fil) autour ; fanions triangulaires sur la toile de fond ; la guirlande d'ampoules existante en multicolore.

Zones : 🎟️ **L'Allée de la Tombola** (12-14 et 32-34) ; décoratives : 🎪 Le Chapiteau (0-11 et 35-39), 🎡 La Grande Roue (15-31).
Nouvelle case : **Tombola** 🎟️, type `tombola`, couleur `#FF8C42`, effet « 3 pièces au passage · gros lot si tu t'arrêtes pile dessus ».

### 3.2 Tracé exact — 40 cases, grille 11 × 7

Une seule boucle, sens horaire depuis le coin bas-gauche, pincée au milieu : la voie du haut traverse l'allée vers la droite (case 13), la voie du bas revient vers la gauche (case 33). Tour : **40**. Aucun embranchement (`sw = []`). Les deux cases Tombola sont à 20 cases l'une de l'autre.

Lecture : T = Tombola.

```
     c0   c1   c2   c3   c4   c5   c6   c7   c8   c9   c10
r0   6L   7A   8P   9A  10L   ·   16A  17P  18E  19A  20L
r1   5E   ·    ·    ·   11A   ·   15L   ·    ·    ·   21A
r2   4P   ·    ·    ·   12E  13T  14A   ·    ·    ·   22P
r3   3A   ·    ·    ·    ·  stand  ·    ·    ·    ·   23A
r4   2L   ·    ·    ·   34A  33T  32P   ·    ·    ·   24E
r5   1A   ·    ·    ·   35E   ·   31A   ·    ·    ·   25L
r6   0D  39A  38P  37A  36L   ·   30L  29E  28A  27P  26A
```

```ts
CELLS = ['start','clap','loge','clap','pub','env','loge','clap','pub','clap','loge','clap','env','tombola','clap','loge','clap','pub','env','clap','loge','clap','pub','clap','env','loge','clap','pub','clap','env','loge','clap','pub','tombola','clap','env','loge','clap','pub','clap']
NEXT  = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,0]
PREV  = [39,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38]
XY    = [[0,6],[0,5],[0,4],[0,3],[0,2],[0,1],[0,0],[1,0],[2,0],[3,0],[4,0],[4,1],[4,2],[5,2],[6,2],[6,1],[6,0],[7,0],[8,0],[9,0],[10,0],[10,1],[10,2],[10,3],[10,4],[10,5],[10,6],[9,6],[8,6],[7,6],[6,6],[6,5],[6,4],[5,4],[4,4],[4,5],[4,6],[3,6],[2,6],[1,6]]
EXTRA = {"no":3,"mech":"tombola","forks":[]}
```

Répartition : 1 Départ, 16 Applaudissements (40 %), 7 Pubs (17,5 %), 6 Enveloppes (15 %), **8 Loges** (2, 6, 10, 15, 20, 25, 30, 36), 2 Tombola (13, 33).
`forks = []`, `jumps = []`, `dede = {col: 2, row: 3.9, scale: 0.85}`.
(Une première version à 48 cases en 11 × 9 donnait 13 % d'étoiles en moins : les étoiles se croisent trop rarement sur un tour aussi long. La version 40 cases est au niveau du Grand Plateau.)

### 3.3 Mécanique signature — 🎟️ La Tombola

**Règle.**

- Il y a **une cagnotte**, commune aux deux cases Tombola. Elle démarre à **5 pièces** (la mise de la production).
- **Passer** sur une case Tombola sans s'y arrêter (déplacement en avant) : le pion verse **3 pièces** dans la cagnotte (ce qu'il a s'il en a moins ; 0 pièce → il passe gratuitement).
- **S'arrêter pile** sur une case Tombola avec ses dés : le pion empoche **toute la cagnotte**, qui repart à 5 pièces.

**Cas limites.** Repartir d'une case Tombola ne coûte rien. Un déplacement de carte qui franchit la Tombola en avant paie le péage ; s'il s'y termine, ni péage ni gros lot (règle transversale 2) ; en reculant, rien. La cagnotte qui reste à la fin de la partie n'est à personne (« c'est pour la buvette »). Pas de plafond.

**Déroulé exact.** `mech = {pot}`.

- `_dp_walk`, pas `k` sur `p_n`, en avant, case de type `tombola`, `k < p_n` : `n = min(toll, pièces)` ; si `n > 0` : `_dp_coins(−n, 'toll')`, `pot += n`, stat `toll_paid += n` ; évènement `{t:'toll', d:−n, pot}` (émis aussi avec `d: 0`).
- `_dp_land`, type `tombola` : `_dp_coins(+pot, 'jackpot')`, stats `jackpots + 1`, `jackpot_best = max(…)`, `best_card` si record ; `pot = pot_seed` ; évènement `{t:'jackpot', d, pot}`.

**À l'écran.**

- Puce : « 🎟️ Cagnotte : 14 🪙 ». La plaque du stand affiche le même nombre et grossit par à-coups à chaque péage.
- Péage : 3 pièces volent du pion vers le stand, étiquette « 🎟️ −3 🪙 », le compteur tourne. Sans pièces : « 🎟️ Offert ! ».
- Gros lot : la caméra serre sur le stand, pluie de pièces du stand vers le pion (jusqu'à 20 particules), confettis ×70, secousse, guirlande en chenillard, étiquette « 🎟️ GROS LOT +14 🪙 », public debout.

**Répliques de Dédé.**

| Famille | Répliques |
|---|---|
| `map_kermesse` | « Bienvenue à la Kermesse de Dédé ! Pêche aux canards, barbe à papa… et une Tombola qui se remplit toute seule. » · « Ce soir c'est la kermesse ! Chacun met 3 pièces dans la Tombola en passant. Le gros lot ? Pour celui qui s'arrête pile dessus. » |
| `toll` | « {name} passe devant la Tombola : 3 pièces dans la cagnotte, merci pour les œuvres ! » · « Par ici la monnaie, {name} ! La cagnotte grossit, grossit… » · « {name} glisse 3 pièces dans l'urne. C'est pour la bonne cause : le prochain gagnant. » · « Un ticket pour {name} ! Enfin… {name} paie, le ticket gagnant, on verra plus tard. » |
| `toll_poor` | « {name} a les poches vides : la Tombola fait cadeau. Exceptionnellement ! » · « Rien à donner, {name} ? Allez, passe, je n'ai rien vu. » |
| `jackpot` | « PILE SUR LA TOMBOLA ! {name} rafle le gros lot : {n} pièces ! » · « Le numéro gagnant est… celui de {name} ! {n} pièces, mesdames et messieurs ! » · « {name} décroche la cagnotte ! {n} pièces d'un coup, ça change une soirée. » · « Incroyable ! {name} vide la Tombola : {n} pièces. Merci à tous les généreux donateurs ! » |

**Équilibre** (simulation, §6). Chaque joueur passe ≈ 2,8 fois devant la Tombola et y laisse ≈ 8 pièces par partie. Gros lots par partie : 0,9 à 2 joueurs, 1,7 à 4, 2,6 à 6, 3,5 à 8 ; **gros lot moyen 11 à 19 pièces** (15 à 4 joueurs = une demi-étoile), records observés 47 (4 joueurs) à 86 (8 joueurs). C'est une redistribution (seules les mises de 5 pièces sont créées, le reliquat final est perdu) : étoiles par joueur −1 à −4 % par rapport au Grand Plateau, mais plus de variance, et « Fauché » plus fréquent (10 % contre 4 % à 4 joueurs).
Le Triple dé ne garantit rien, mais chacun calcule : « il me faut un 9 pour le gros lot ».

**Stats** : `toll_paid` (pièces versées), `jackpots`, `jackpot_best`.

**Trophée** : aucun.

---

## 4. Plateau 4 — 🏕️ Le Camping des Pins Penchés

« Émission en plein air. Plantez vos sardines et surveillez vos poches. » Quatre sentiers en croix autour du feu de camp, et **Riton le raton laveur** qui fait sa ronde à l'envers.

- `pitch` : « Riton le raton rôde : il chipe… puis il lâche tout ! »
- `rule` : « Riton remonte le sentier à contresens. Sac vide : il te pique 5 pièces. Sac plein : il lâche tout au pion qu'il croise. »

### 4.1 Ambiance, palette, décor

| Élément | Clair (matin en forêt) | Sombre (veillée) |
|---|---|---|
| Fond (`bg`) | `#DDF5E4` | `#101A2E` |
| Sol, herbe (`floorA` / `floorB`) | `#9BD77E` / `#86C96B` | `#1E3A2B` / `#254634` |
| Tapis, clairière (`carpet` / `carpetDot`) | `#E9D8A6` / `#DCC68A` | `#3B3A2A` / `#4A4936` |
| Ruban, sentier (`road`) | `#F5E6C8` | `#EAD9B5` |
| Toile de fond | `#BFE8C8` | `#16243F` |
| Accents | lac `#4CC9F0` ; feu `#FF8C42` / `#FFD166` ; tentes `#EF476F` `#FFD166` `#4CC9F0` ; pins `#2D6A4F`, troncs `#8D5A3B` ; caravane blanche à bande `#06D6A0` | idem + lueur du feu, lucioles |
| Riton | pelage `#8D99AE`, masque `#2B2D42`, sac `#E9C46A` | idem |

Décor en primitives (la croix laisse 4 coins libres de 4 × 3 cases) :

- **Le feu de camp** au centre (5 ; 4) : 3 bûches (cylindres couchés), 2 cônes orange et jaune dont l'échelle vacille, halo additif (plus fort en thème sombre).
- Coin haut-gauche (col 0-3, row 0-2) : **le lac** (cylindre plat bleu, rayon 1,5 case), ponton (2 boîtes), canard (2 sphères jaunes).
- Coin haut-droit (col 7-10, row 0-2) : **l'estrade de Dédé** en (8,6 ; 0,9), `scale` 0,85, recolorée bois (`#A47148` / `#C68B59` / `#FFD166`).
- Coin bas-droit (col 7-10, row 6-8) : 3 tentes (cônes à 4 faces), table de pique-nique (boîtes).
- Coin bas-gauche (col 0-3, row 6-8) : caravane (boîte arrondie, 2 roues cylindres), fil à linge (2 poteaux + plans colorés).
- **Pins penchés** (une quinzaine, `InstancedMesh`) autour du plateau et dans les coins : tronc incliné de 10 à 20°, 2 cônes verts empilés.
- **Riton** : pion non joueur. Socle gris foncé (mêmes géométries que les pions) + sprite émoji 🦝 (texture canvas, comme les plaques) ; à côté, son **sac** (sphère `#E9C46A`) : petit et affaissé s'il est vide, gonflé avec une étiquette « 5 🪙 » s'il est plein. Il se dandine sur place et saute de case en case pendant sa ronde. (Une illustration dédiée pourra remplacer l'émoji plus tard, sans toucher aux règles.)

Zones (décoratives, une par branche) : 🏠 L'Accueil (branche sud : 0-3 et 31-35), 🛶 Le Lac (ouest : 4-12), 🌲 Les Pins (nord : 13-21), ⛺ Les Tentes (est : 22-30) ; 🔥 Le Feu de camp au centre.

### 4.2 Tracé exact — 36 cases, grille 11 × 9

Le contour d'une croix, parcouru dans le sens horaire depuis le bas de la branche sud. Chaque branche a une voie aller et une voie retour séparées par une case vide. Tour : **36**. Aucun embranchement (`sw = []`).

```
     c0   c1   c2   c3   c4   c5   c6   c7   c8   c9   c10
r0   ·    ·    ·    ·   16A  17P  18L   ·    ·    ·    ·
r1   ·    ·    ·    ·   15E   ·   19A   ·    ·    ·    ·
r2   ·    ·    ·    ·   14A   ·   20A   ·    ·    ·    ·
r3   9A  10A  11E  12P  13L   ·   21E  22P  23L  24A  25A
r4   8L   ·    ·    ·    ·   feu   ·    ·    ·    ·   26E
r5   7P   6A   5E   4A   3L   ·   31E  30A  29A  28L  27P
r6   ·    ·    ·    ·    2P   ·   32P   ·    ·    ·    ·
r7   ·    ·    ·    ·    1A   ·   33L   ·    ·    ·    ·
r8   ·    ·    ·    ·    0D  35A  34A   ·    ·    ·    ·
```

```ts
CELLS = ['start','clap','pub','loge','clap','env','clap','pub','loge','clap','clap','env','pub','loge','clap','env','clap','pub','loge','clap','clap','env','pub','loge','clap','clap','env','pub','loge','clap','clap','env','pub','loge','clap','clap']
NEXT  = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,0]
PREV  = [35,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34]
XY    = [[4,8],[4,7],[4,6],[4,5],[3,5],[2,5],[1,5],[0,5],[0,4],[0,3],[1,3],[2,3],[3,3],[4,3],[4,2],[4,1],[4,0],[5,0],[6,0],[6,1],[6,2],[6,3],[7,3],[8,3],[9,3],[10,3],[10,4],[10,5],[9,5],[8,5],[7,5],[6,5],[6,6],[6,7],[6,8],[5,8]]
EXTRA = {"no":4,"mech":"riton","forks":[],"riton_start":18}
```

Répartition : 1 Départ, 15 Applaudissements (42 %), 7 Pubs (19 %), 6 Enveloppes (17 %), **7 Loges** (3, 8, 13, 18, 23, 28, 33 : une tous les 5 cases).
`forks = []`, `jumps = []`, `dede = {col: 8.6, row: 0.9, scale: 0.85}`. Riton démarre sur la case 18, à l'opposé du Départ.

### 4.3 Mécanique signature — 🦝 Riton le raton

**Règle.**

- Riton est un personnage du plateau, posé sur une case. À la **fin de chaque tour** (épilogue), il lance **1 dé** et marche d'autant de cases **à contresens** (vers le Départ par l'arrière : il vient à la rencontre des pions).
- **Croiser Riton** = marcher sur sa case (en passant ou en s'y arrêtant), ou être sur une case où il arrive ou passe pendant sa ronde.
- Riton a un **sac** :
  - **sac vide** → il **pique 5 pièces** au pion croisé (ce qu'il a s'il en a moins) et les met dans son sac ; un pion sans pièce ne perd rien et le sac reste vide ;
  - **sac plein** → il sursaute et **lâche tout** : le pion croisé empoche le contenu du sac, qui redevient vide.
- Donc : un coup il vole, un coup il rend (à quelqu'un d'autre). Tout le monde voit le sac avant de lancer.

**Cas limites.** Compte tout déplacement **à pied** (dés ou carte, en avant ou en arrière) ; pas la carte « échange de place ». Si Riton croise plusieurs pions pendant sa ronde, il les traite dans l'ordre des cases rencontrées, puis dans l'ordre de passage pour les pions d'une même case (vol, lâcher, vol…). Un pion déjà sur la case d'où Riton part n'est pas recroisé. Quitter la case de Riton n'est pas un croisement. Sur une Loge étoilée : Riton d'abord, l'étoile ensuite (règle transversale 1) — il peut donc faire rater une étoile de justesse… ou la payer. Riton ignore le Départ, les étoiles et les cases.

**Déroulé exact.** `mech = {riton, sack}`.

- `_dp_riton_hit(p_state, p_pid)` → `{state, ev}` :
  - `sack > 0` : `_dp_coins(+sack, 'riton')`, stat `loot += sack`, `best_card` si record, `ev = {t:'riton', k:'drop', d:+sack, sack:0}`, `sack = 0` ;
  - `sack = 0` et pièces > 0 : `n = min(riton_steal, pièces)`, `_dp_coins(−n, 'riton')`, `sack = n`, stat `robbed + 1`, `ev = {t:'riton', k:'steal', d:−n, sack:n}` ;
  - sinon : `ev = {t:'riton', k:'none', d:0, sack:0}`.
- `_dp_walk` : après chaque pas (avant comme arrière), si la case du pion = `mech.riton` → `_dp_riton_hit`, évènement ajouté à l'étape.
- Épilogue (tous les tours) : `die = _dp_die(server)` ; pour chaque pas : `riton = PREV[riton]`, ajouté à `path` ; pour chaque pion (ordre de passage) posé sur cette case → `_dp_riton_hit`, ajouté à `hits` avec `cell` ; `epi = {t:'riton', die, from, path, hits, after}`.

**À l'écran.**

- Puce : « 🦝 Riton : sac vide — gare à tes pièces ! » · « 🦝 Riton : sac plein (5 🪙) — le prochain qui le croise ramasse tout ! ».
- Croisement pendant la marche d'un pion : Riton sursaute (petit saut) ; vol = 5 pièces volent du pion vers le sac, qui gonfle, étiquette « 🦝 −5 🪙 » ; lâcher = le sac éclate en pièces vers le pion, étiquette « 🦝 +5 🪙 », confettis ; rien = « 🦝 Rien à piquer… ».
- Épilogue (4 s) : le dé de Riton roule (0,6 s) au-dessus de lui, puis il trottine case par case (≈ 350 ms par case) suivi par la caméra ; chaque croisement joue l'effet ci-dessus.

**Répliques de Dédé.**

| Famille | Répliques |
|---|---|
| `map_camping` | « Bienvenue au Camping des Pins Penchés ! Plantez vos sardines et surveillez vos poches : Riton le raton rôde. » · « Ce soir, émission en plein air ! Un conseil : ne laissez rien traîner, Riton fait sa ronde à l'envers. » |
| `riton_move` (épilogue sans croisement) | « Riton fait sa ronde… Cachez vos pièces ! » · « Et pendant ce temps, Riton remonte le sentier. Tout doux, Riton. » · « Qui a laissé la glacière ouverte ? Riton arrive ! » |
| `riton_steal` | « Riton croise {name}… et repart avec ses pièces dans son sac ! Petit chenapan. » · « Oh ! {name} s'est fait faire les poches par un raton laveur. Ça ne s'invente pas. » · « Riton chipe les pièces de {name} ! Le prochain qui le croise ramasse le sac. » · « {name}, ton porte-monnaie ! Trop tard… Riton a déjà filé. » |
| `riton_drop` | « {name} fait « BOUH ! » : Riton sursaute et lâche son sac. Tout est pour {name} ! » · « Riton trébuche devant {name} et son butin s'envole. Ramasse, {name}, ramasse ! » · « Le sac de Riton change de mains : merci qui ? Merci {name} ! » · « {name} récupère le magot de Riton. Les bons comptes font les bons campeurs. » |
| `riton_none` | « Riton fouille les poches de {name}… vides ! Il repart vexé. » · « Rien à voler chez {name}. Même Riton a de la peine. » |

**Équilibre** (simulation, §6). Pions et Riton se rapprochent de ≈ 10,5 cases par tour sur un tour de 36 : **≈ 2,8 croisements par joueur et par partie**. Par partie : 3 vols à 2 joueurs, 6 à 4, 9 à 6, 11,5 à 8, presque autant de sacs lâchés (4,9 pièces par vol en moyenne). Jeu à somme nulle (seul le dernier sac non lâché disparaît) : c'est un transfert de 5 pièces entre deux joueurs qui se suivent. Le plateau est le plus court et le plus dense en Loges : étoiles par joueur **+4 à +6 %** par rapport au Grand Plateau, moins de joueurs sans étoile ; « Fauché » plus fréquent (11 % contre 4 % à 4 joueurs), 3 Pubs en une partie aussi (25 % contre 18 %).
Le Triple dé sert à foncer sur Riton quand son sac est plein.

**Stats** : `robbed` (fois volé), `loot` (pièces reçues de Riton).

**Trophée** : aucun.

---

## 5. Plateau 5 — ⛷️ Dédé 2000

« La station où l'on monte vite… et où l'on redescend encore plus vite. » La piste s'enroule en escargot autour de la montagne, de la Station (Départ) jusqu'au Sommet ; du Sommet, la **Grande Luge** ramène au Départ.

- `pitch` : « Télésièges, verglas et Grande Luge : ça monte et ça glisse ! »
- `rule` : « Arrête-toi pile sur un télésiège : tu montes d'un étage. Pile sur une plaque de verglas : tu redescends. Au Sommet, la Grande Luge ramène au Départ. »

### 5.1 Ambiance, palette, décor

| Élément | Clair | Sombre (ski nocturne) |
|---|---|---|
| Fond (`bg`) | `#E6F4FF` | `#0E1B3D` |
| Sol, neige (`floorA` / `floorB`) | `#FFFFFF` / `#EAF4FB` | `#27406B` / `#2F4C7D` |
| Tapis (`carpet` / `carpetDot`) | `#F4FAFF` / `#DCEBF7` | `#34558C` / `#4168A6` |
| Ruban par zone | Vallée `#CDE7BE`, Pistes `#BFE3FF`, Sommet `#FFFFFF` | mêmes teintes |
| Toile de fond | `#BFD9F2` | `#182B57` |
| Cases | Télésiège `#B5E61D`, Verglas `#DFF3FF` | idem |
| Accents | pylônes `#6C757D`, nacelles `#EF476F`, chalet `#8D5A3B` à toit blanc, sapins `#2D6A4F` coiffés de blanc, montagnes `#8FA8C8` | idem |

Décor en primitives :

- **Le piton de Dédé** : l'estrade (3 cylindres empilés) recolorée en neige (`#FFFFFF` / `#DFF3FF` / `#BFE3FF`) en (5,2 ; 5,4), `scale` 1 : Dédé commente depuis le sommet de la montagne, au milieu de l'escargot.
- **Télésièges** (5) : un pylône (cylindre gris) à côté de la case de départ et un à côté de la case d'arrivée, un câble (boîte fine) entre les deux à 1,6 de haut, une nacelle rouge (petite boîte) qui fait la navette en continu.
- **Plaques de verglas** (3) : une traînée bleu clair translucide (plan) de la case jusqu'à la case d'arrivée, à l'étage du dessous.
- **La Grande Luge** : un tremplin (boîte inclinée) et un panneau « 🛷 » près de la case 48 ; pas de ruban entre 48 et 0 (liaison `jumps`), le pion file en grande cloche avec une traînée de neige.
- Chalet de la Station (boîte brune + toit en cône à 4 faces blanc) hors plateau près du Départ ; une quinzaine de sapins enneigés (`InstancedMesh`) dans les couloirs entre les spires et autour ; bonhomme de neige (3 sphères + cône orange) en (3,6 ; 6,8) ; 3 grandes montagnes (cônes gris-bleu à cime blanche) sur la toile de fond ; flocons lents (réemploi du pool de particules).

Zones : 🌲 **La Vallée** (0-34), ⛷️ **Les Pistes** (35-46), 🏔️ **Le Sommet** (47-48) ; 🛷 La Grande Luge (48 → 0). Le Départ s'appelle toujours Départ (sous-titre « La Station »).
Nouvelles cases : **Télésiège** 🚡 (`lift`, `#B5E61D`, « Pile dessus : tu montes à l'étage du dessus ») et **Plaque de verglas** 🧊 (`ice`, `#DFF3FF`, « Pile dessus : tu glisses à l'étage du dessous »).

### 5.2 Tracé exact — 49 cases, grille 11 × 9

Un escargot d'un tour et demi, sens horaire depuis le coin bas-gauche : le grand tour extérieur (0-34, la Vallée), puis la spire intérieure (35-48) jusqu'au Sommet. `NEXT[48] = 0` : la Grande Luge (seule liaison entre cases non voisines). Tour : **49**. Aucun embranchement (`sw = []`).
Deux spires voisines sont séparées par un couloir d'une case : chaque télésiège / plaque relie deux cases alignées à 2 cases d'écart.

Lecture : M = télésiège (monte), G = verglas (glisse).

```
     c0   c1   c2   c3   c4   c5   c6   c7   c8   c9   c10
r0   8A   9L  10P  11A  12M  13A  14E  15M  16L  17P  18A
r1   7E   ·    ·    ·    ·    ·    ·    ·    ·    ·   19E
r2   6M   ·   40A  41E  42A  43G  44P  45A  46G   ·   20A
r3   5P   ·   39L   ·    ·    ·    ·    ·   47A   ·   21M
r4   4L   ·   38P   ·    ·    ·    ·    ·   48L   ·   22L
r5   3M   ·   37A   ·    ·  Dédé   ·    ·    ·    ·   23P
r6   2A   ·   36G   ·    ·    ·    ·    ·    ·    ·   24A
r7   1A   ·   35E   ·    ·    ·    ·    ·    ·    ·   25E
r8   0D   ·   34A  33L  32P  31A  30E  29A  28L  27P  26A
```

```ts
CELLS = ['start','clap','clap','lift','loge','pub','lift','env','clap','loge','pub','clap','lift','clap','env','lift','loge','pub','clap','env','clap','lift','loge','pub','clap','env','clap','pub','loge','clap','env','clap','pub','loge','clap','env','ice','clap','pub','loge','clap','env','clap','ice','pub','clap','ice','clap','loge']
NEXT  = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,0]
PREV  = [48,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47]
XY    = [[0,8],[0,7],[0,6],[0,5],[0,4],[0,3],[0,2],[0,1],[0,0],[1,0],[2,0],[3,0],[4,0],[5,0],[6,0],[7,0],[8,0],[9,0],[10,0],[10,1],[10,2],[10,3],[10,4],[10,5],[10,6],[10,7],[10,8],[9,8],[8,8],[7,8],[6,8],[5,8],[4,8],[3,8],[2,8],[2,7],[2,6],[2,5],[2,4],[2,3],[2,2],[3,2],[4,2],[5,2],[6,2],[7,2],[8,2],[8,3],[8,4]]
EXTRA = {"no":5,"mech":"tp","forks":[],"tp":{"3":37,"6":40,"12":42,"15":45,"21":47,"36":2,"43":13,"46":20}}
```

| Téléporteur | De | Vers | Écart |
|---|---|---|---|
| 🚡 Télésiège de la Vallée | 3 (0,5) | 37 (2,5) | +34 |
| 🚡 Télésiège des Sapins | 6 (0,2) | 40 (2,2) | +34 |
| 🚡 Télésiège du Chalet | 12 (4,0) | 42 (4,2) | +30 |
| 🚡 Télésiège des Crêtes | 15 (7,0) | 45 (7,2) | +30 |
| 🚡 Télésiège du Sommet | 21 (10,3) | 47 (8,3) | +26 |
| 🧊 Verglas du Virage | 36 (2,6) | 2 (0,6) | −34 |
| 🧊 Verglas de la Corniche | 43 (5,2) | 13 (5,0) | −30 |
| 🧊 Verglas du Sommet | 46 (8,2) | 20 (10,2) | −26 |

Répartition : 1 Départ, 17 Applaudissements (35 %), 8 Pubs (16 %), 7 Enveloppes (14 %), **8 Loges** (4, 9, 16, 22, 28, 33, 39 et 48 = « La Loge du Sommet »), 5 Télésièges, 3 Verglas.
Aucune case d'arrivée n'est elle-même un téléporteur. `forks = []`, `jumps = [[48, 0]]`, `dede = {col: 5.2, row: 5.4, scale: 1}`.

### 5.3 Mécanique signature — 🚡 Télésièges et 🧊 verglas

**Règle.**

- **S'arrêter pile** (avec ses dés) sur un **Télésiège** : le pion monte aussitôt sur la case d'arrivée, à l'étage du dessus (26 à 34 cases gagnées).
- **S'arrêter pile** sur une **Plaque de verglas** : le pion glisse aussitôt sur la case d'arrivée, à l'étage du dessous (26 à 34 cases perdues).
- **Passer** dessus ne fait rien.
- Au bout de la piste, **la Grande Luge** : de la case 48 (le Sommet), le pas suivant ramène à la case 0 et le pion continue sa route. Passer par le Départ rapporte +5 comme d'habitude.

**Cas limites.** Seul l'arrêt d'un lancer de dés déclenche un téléporteur (jamais une carte, jamais un autre téléporteur : règle transversale 2). À l'arrivée : pas d'effet de case, mais achat de l'étoile si elle est là (`star_exact` compte : « Pile dessus »), ou `star_poor`. `dist` suit le saut (`dist += arrivée − départ`, négatif pour le verglas) : la carte « échange avec le plus loin devant » reste juste. Carte « recule » depuis les cases 0, 1 ou 2 : on remonte la Grande Luge à l'envers (0 → 48 → 47), sans bonus de Départ.

**Déroulé exact.** Pas d'état (`mech = {}`), pas d'épilogue.

- `_dp_land`, type `lift` ou `ice` : `to = _dp_map('ski')->'tp'->>case` ; `pos = to` ; `dist += to − case` ; stat `lifts + 1` ou `slides + 1` ; contrôle d'étoile sur `to` (même bloc que `_dp_walk`, `exact = true`) ; renvoie une étape supplémentaire `{cell: to, tp: 'lift' | 'ice', ev: [{t:'tp', k, from, to}, …évènement d'étoile]}`.
- La Grande Luge n'a pas d'évènement serveur : c'est le pas 48 → 0 (le front reconnaît la liaison `jumps`).

**À l'écran.**

- Pas de puce : la légende et les câbles suffisent.
- Télésiège : le pion grimpe dans la nacelle et traverse en cloche jusqu'à l'arrivée, étiquette « 🚡 Télésiège ! », acclamations. Verglas : le pion tourne sur lui-même et glisse le long de la traînée, étiquette « 🧊 Glissade ! », poussière de neige.
- Grande Luge : saut en très grande cloche du Sommet au Départ, traînée de neige, étiquette « 🛷 Grande Luge ! », puis le « +5 » habituel.

**Répliques de Dédé.**

| Famille | Répliques |
|---|---|
| `map_ski` | « Bienvenue à Dédé 2000, la station où l'on monte vite… et où l'on redescend encore plus vite ! » · « Chaussez vos skis ! Les télésièges montent, le verglas descend, et la Grande Luge ramène tout le monde à la Station. » |
| `lift` | « {name} attrape le télésiège ! Attachez vos ceintures, on grimpe. » · « Pile sur le télésiège : {name} double tout le monde par les airs ! » · « Et hop, {name} s'envole vers les sommets. Coucou, en bas ! » · « Forfait gagnant pour {name} : direction le haut des pistes ! » |
| `ice` | « Plaque de verglas ! {name} repart en bas sur les fesses. » · « Oh la belle glissade de {name} ! Note artistique : 9 sur 10. » · « {name} dérape… et dévale toute la piste. On remonte, courage ! » · « Ça glisse pour {name} ! Retour dans la vallée, sans passer par le chalet. » |
| `luge` | « {name} atteint le Sommet et saute dans la Grande Luge : retour à la Station, 5 pièces à l'arrivée ! » · « Youhou ! {name} dévale la Grande Luge jusqu'au Départ. » · « La Grande Luge pour {name} ! Tenez bien vos bonnets. » |

**Équilibre** (simulation, §6). Par partie : 2,2 télésièges et 0,9 glissade à 2 joueurs, 4,5 et 1,8 à 4, 6,8 et 2,6 à 6, 8,9 et 3,5 à 8 (≈ 1,1 télésiège et 0,45 glissade par joueur). Les sauts ne créent ni ne détruisent de pièces : ils déplacent. Un télésiège raccourcit le tour (Départ +5 plus tôt, 1,30 passage par joueur contre 1,08) mais fait sauter des Loges ; une glissade fait repasser devant. Étoiles par joueur : **−3 à −6 %** par rapport au Grand Plateau de 4 à 8 joueurs (−11 % à 2 joueurs : une seule étoile en jeu sur un tour de 49). Levier si la simulation SQL le confirme : passer la case 44 (Pub) en Loge.

**Stats** : `lifts`, `slides`.

**Trophée** : aucun.

---

## 6. Équilibre comparé

Chiffres issus d'un **modèle JS simplifié** des règles (script jetable, non versionné : mêmes constantes, 12 cartes, étoiles, cérémonie ; classement des mini-jeux tiré au sort, Triple dé joué au hasard, personne d'absent), 5 000 parties par configuration, 9 tours. Ils servent à comparer les plateaux entre eux ; les valeurs définitives sont à mesurer avec la simulation SQL (§8).

| Étoiles par joueur (bonus de cérémonie compris) | 2 joueurs | 4 | 6 | 8 | 6 « niveaux » : meilleur / pire |
|---|---|---|---|---|---|
| 🎤 Le Grand Plateau (référence) | 2,61 | 2,37 | 1,92 | 1,97 | 3,21 / 1,31 |
| 🏖️ Dédé-sur-Mer | 2,62 | 2,32 | 1,87 | 1,89 | 3,19 / 1,23 |
| 🎪 La Kermesse | 2,58 | 2,31 | 1,85 | 1,89 | 3,15 / 1,26 |
| 🏕️ Le Camping | 2,76 | 2,47 | 2,02 | 2,04 | 3,40 / 1,39 |
| ⛷️ Dédé 2000 | 2,32 | 2,22 | 1,86 | 1,89 | 3,12 / 1,27 |

| À 4 joueurs, 9 tours | Sans étoile | « Fauché » | 3 Pubs ou plus | Passages au Départ par joueur | Évènements signature par partie |
|---|---|---|---|---|---|
| Le Grand Plateau | 3 % | 4 % | 18 % | 1,08 | — |
| Dédé-sur-Mer | 3 % | 8 % | 19 % | 1,08 | 3 montées, 3,1 pions emportés |
| La Kermesse | 3 % | 10 % | 20 % | 1,05 | 11 péages, 1,7 gros lot (15 pièces en moyenne) |
| Le Camping | 2 % | 11 % | 25 % | 1,27 | 5,9 vols, 5,5 sacs lâchés |
| Dédé 2000 | 3 % | 4 % | 18 % | 1,30 | 4,5 télésièges, 1,8 glissade |

Lecture : les 4 nouveaux plateaux restent à **−6 % / +6 %** d'étoiles par joueur autour du Grand Plateau (hors Dédé 2000 à 2 joueurs), la part de joueurs sans étoile ne bouge pas (1 à 6 % selon le nombre de joueurs, comme le Grand Plateau), l'écart entre le meilleur et le moins bon joueur est conservé (rapport ≈ 2,5), et aucun pion ne dépasse 24 pas en un tour.
Objectifs de la simulation SQL, par plateau : moins de 10 % de joueurs sans étoile ; étoiles par joueur à ± 10 % du Grand Plateau ; vainqueur à 3-4 étoiles.
Leviers, tous dans `_dp_const()` ou dans un type de case : `wash` (5), cycle `tide_low` / `tide_high` (2 / 1), `toll` (3), `pot_seed` (5), `riton_steal` (5), une Pub ↔ une Loge sur Dédé 2000 (case 44) ou le Camping.

## 7. Trophées

Les 11 trophées `party_*` (tenue `host`, emplacements 2 à 12) ne changent pas : leurs compteurs (`pubs`, `broke`, `no_star`, `coins_earned`, `envelopes`, `star_exact`, `mg_streak`, `stars`, `win_mvp`, parties, victoires) sont calculés de la même façon sur les 5 plateaux. Les 11 emplacements de la tenue sont pris.

| Plateau | Trophée proposé |
|---|---|
| Dédé-sur-Mer | aucun |
| La Kermesse de Dédé | aucun |
| Le Camping des Pins Penchés | aucun |
| Dédé 2000 | aucun |

Effets de bord acceptés : « Fauché » (trophée de consolation) tombe un peu plus souvent sur la mer, la kermesse et le camping ; « Coupure pub » un peu plus souvent au camping ; « Pile dessus » peut se gagner en arrivant en télésiège sur une étoile.
Les nouveaux compteurs (`washed`, `toll_paid`, `jackpots`, `jackpot_best`, `robbed`, `loot`, `lifts`, `slides`, `map_no`) sont enregistrés dès maintenant dans `results[].stats` : un futur lot pourra s'en servir sans rejouer les parties.
Idée en réserve, hors de ce lot : un trophée **général** (sans tenue ni emplacement) « Dédé en tournée » — jouer sur les 5 plateaux — exprimable avec le moteur de règles actuel (`agg: all` de 5 règles `count` filtrées par `map_no`) ; à étudier seulement si l'on rouvre le catalogue des trophées généraux.

## 8. Tests

**SQL (PGlite)**, `tools/sql-tests/dede-party.mjs` (les états de mécanique sont imposés par `patch`, comme `sw` et `star_cells` aujourd'hui) :

- Pour chacun des 5 plateaux : synchro `boards/<id>.ts` ↔ `_dp_board / _dp_next / _dp_prev / _dp_map` ; tableaux de même taille ; `PREV` inverse de `NEXT` ; tout est atteignable depuis le Départ ; longueur du tour (36/44, 36/44, 40, 36, 49) ; cases dans la grille et jamais superposées ; liaisons entre cases voisines sauf `jumps` ; aucune paire de cases voisines non reliées ; Loges ≥ 6 ; compte de chaque type.
- Démarrage : option `map` (5 ids, inconnu → un des 5), `mech` initial, taille de `sw`, étoiles sur des Loges du bon plateau.
- `grand` : tous les tests actuels passent sans changement de comportement.
- `mer` : voie selon la marée sans bascule ; cycle 2 / 1 sur 9 tours pour les 3 phases de départ ; pion emporté (case, −5, moins s'il est pauvre, `dist`, `washed`) ; ordre de passage ; étoile du Phare qui déménage, jamais posée à marée haute ; `epi` présent seulement les tours de changement ; échéance +4 s.
- `kermesse` : péage au passage (3, partiel, 0) ; pas de péage au départ d'une Tombola ni en reculant ; gros lot à l'arrêt, cagnotte remise à 5 ; carte qui franchit / s'arrête ; `best_card`.
- `camping` : vol, lâcher, bredouille ; croisement à l'arrêt, au passage, en reculant, pendant la ronde ; plusieurs pions sur le trajet et sur une même case ; Riton avant l'étoile ; dé de Riton après les dés du tour (`forced_dice`) ; `epi` à chaque tour.
- `ski` : chaque téléporteur (8) ; rien au passage ; rien sur carte ; étoile achetée à l'arrivée (`star_exact`) ; `dist` ; Grande Luge (+5) ; carte « recule » à travers la luge.
- Simulation : par plateau (`map` en paramètre des configurations existantes), mêmes sorties qu'aujourd'hui plus la fréquence des évènements signature ; assertion « jamais plus de 24 pas ».

**Autres** : `tools/sql-tests/game-states.mjs` (state `dede-party` : ajouter `map`, `mech`, `epi`) ; `tsc`, `eslint`, `npm run build` ; page de test locale : une partie par plateau, téléphone portrait + onglet télé, thèmes clair et sombre, repli 2D.
Après toute modification SQL : `npm run sql`, puis coller `supabase/install.sql` dans le SQL Editor Supabase.

## 9. Livraison (chaque étape est jouable seule)

1. **Socle multi-plateaux** : `boards/grand.ts` + registre, fonctions SQL paramétrées, `state.map` / `mech` / `epi`, option « Plateau » (une seule carte au début), carte du générique, chevrons de sens, thème `grand` extrait. Aucun changement de règle : les tests actuels passent.
2. **La Kermesse** (la mécanique la plus simple : valide un nouveau type de case, la puce, une grille 11 × 7).
3. **Dédé 2000** (valide `jumps`, les étapes `tp`, le ruban teinté par zone).
4. **Le Camping** (valide l'épilogue et le personnage non joueur).
5. **Dédé-sur-Mer** (épilogue conditionnel, embranchement commandé, plan d'eau).
6. Décors 3D soignés, simulation SQL par plateau et réglages, « Au hasard » par défaut une fois les 5 prêts, `docs/ARCHITECTURE.md`, texte `rules` de `index.ts` (générique : « sur l'un des 5 plateaux de Dédé »).

Un plateau n'apparaît dans les options (et dans le tirage au hasard) que lorsqu'il est livré.

## 10. Choix tranchés

- **5 plateaux, 4 nouveaux** : Dédé-sur-Mer (marée), La Kermesse de Dédé (tombola), Le Camping des Pins Penchés (Riton), Dédé 2000 (télésièges / verglas). Une seule mécanique signature par plateau ; les aiguillages qui basculent restent la signature du Grand Plateau (les 3 plateaux sans embranchement ont `sw = []`).
- **Défaut « Au hasard »**, sans redite du dernier plateau joué sur l'appareil de l'hôte ; l'hôte peut choisir un plateau précis. Le Grand Plateau reste dans le tirage.
- **Zéro décision ajoutée** : ni boutique, ni objets, ni carrefour à choix. Écartés : boutique d'objets (décision), vol d'étoile et « coup de théâtre » qui échange les étoiles (trop durs pour un jeu de famille), patate chaude et étoile filante (gardées pour un éventuel 6e plateau).
- **Marée** : cycle fixe 2 tours basse / 1 tour haute, phase de départ tirée au sort (sinon tout le monde se fait rincer au même tour à chaque partie) ; à marée basse tout le monde passe par le Banc (pas d'alternance : elle diviserait par deux les passages sur le Banc, donc les pions emportés) ; la vague dépose **en avant** (case 14) et coûte 5 pièces — on perd des pièces, pas du terrain.
- **Tombola** : péage 3, mise de départ 5, gros lot à l'arrêt exact seulement, pas de plafond, reliquat perdu en fin de partie ; plateau ramené à 40 cases (11 × 7) pour garder le rythme des étoiles.
- **Riton** : 1 dé à contresens à chaque fin de tour ; alternance vol / lâcher plutôt qu'un magot à attraper pile dessus (se lit d'un coup d'œil, et ne double pas la Tombola) ; 5 pièces fixes plutôt qu'un pourcentage ; Riton passe avant l'étoile.
- **Dédé 2000** : escargot d'un tour et demi (la version à deux tours et demi faisait 59 cases) ; 5 télésièges pour 3 verglas (plus de bonnes surprises que de mauvaises) ; déclenchement à l'arrêt exact seulement ; l'arrivée n'applique pas l'effet de la case mais achète l'étoile.
- **Règles communes inchangées** (dés, prix, cartes, mini-jeux, cérémonie, durées) ; seule `intro_s` passe à 8 s. Mêmes constantes sur les 5 plateaux.
- **Épilogue du tour** : +4 s seulement quand il y a quelque chose à montrer.
- **Dédé reste en tenue Animateur** sur tous les plateaux ; le public et les gradins aussi (« en direct de… »). Riton est un sprite émoji dans ce lot.
- **Trophées** : aucun nouveau ; compteurs enregistrés pour plus tard.

## 11. Points à trancher

Aucun.

## 12. Hors périmètre

Nouveaux mini-jeux, nouvelles cartes Enveloppe propres à un plateau, tenues de Dédé par plateau (maillot, doudoune…), illustration dédiée de Riton, relief réel de la montagne (cases en hauteur), musique ou voix par plateau, vote des joueurs pour le plateau, éditeur de plateaux, 6e plateau, mise à jour de la vidéo tuto.
