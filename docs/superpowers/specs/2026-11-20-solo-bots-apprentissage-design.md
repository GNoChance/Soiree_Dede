# Bot qui apprend et qui explique — addendum au mode solo

Statut : **à valider par l'utilisateur**. Addendum à [2026-11-20-solo-bots-design.md](2026-11-20-solo-bots-design.md) (étape 1 en cours de code).
Demande du 2026-11-20 : « Fais un bot qui apprend au fur et à mesure des parties, puis quand il te bat il t'explique pourquoi tu as perdu. »

## 1. Intention
Deux nouveautés sur les 4 duels solo (Morpion, 4 à la suite, Bataille navale, Échecs) :
- **Il t'explique** (étape 2a) : à la fin, le bot montre LE moment où la partie a basculé, sur un petit plateau, en 1 à 3 phrases dans la voix du perso, avec un conseil. Quand le joueur gagne : un compliment précis.
- **Il apprend** (étape 2b) : le bot retient tes habitudes sur le téléphone, s'en sert de façon visible, et le dit (Mika : « J'ai capté un truc : tu commences toujours au centre. »).

Contraintes déjà tranchées : tout sur le téléphone, marche hors ligne, **aucune IA en ligne**, explications **à base de règles**, ≤ 100 Ko de mémoire par jeu. Comme le reste du solo : **rien ne compte**, aucun serveur, **aucun SQL** (rien à régénérer ni à coller dans Supabase).

Base de code lue (étape 1, non commitée) : `useSoloMatch.commit`, `SoloGameModule` (`games.ts`), `BotJob` (`bot.worker.ts`), `SoloPick` / `SoloGame` / `SoloEnd` (`SoloPage.tsx`), `chooseMove(board, me, level, rng…)` des 4 bots. Si ces noms bougent, adapter.

## 2. Socle commun

### 2.1 Journal de partie (2a)
Tout repose sur l'historique des coups, enregistré dans `useSoloMatch.commit` (seul point de passage des actions du joueur ET du bot).

```ts
// src/features/solo/log.ts
export interface SoloLogEntry {
  by: 'me' | 'bot'
  action: SoloAction      // { type: 'move', move } (phase playing uniquement)
  learned?: string        // 2b : id de l'habitude utilisée par le bot pour ce coup
}
export interface SoloLog {
  id: string              // unique par partie (évite d'apprendre deux fois la même)
  game: SoloGameId
  me: string; bot: string; first: string
  perso: CharacterSlug; level: number
  secret0: unknown        // secret du joueur au tout début (Bataille navale : sa flotte tirée au sort)
  setup: Array<{ by: 'me' | 'bot'; action: SoloAction }>  // préparation (Bataille navale)
  x0: SoloX               // état au DÉBUT de la phase playing (flottes définitives comprises)
  entries: SoloLogEntry[]
  outcome: SoloOutcome | null
}
/** Position après les n premières entrées : rejoue soloAct depuis x0. */
export function replayTo(local: LocalDuelGame, log: SoloLog, n: number): SoloX
```
- Gardé en mémoire vive (`useRef`), exposé par le hook (`log`). Jamais écrit sur le téléphone ni envoyé. Poids : < 20 Ko pour une longue partie d'échecs.
- `x0` est pris au passage en `playing` et non au `soloStart` : à la Bataille navale, « Mélanger 🎲 » tire une flotte au hasard, la préparation n'est donc pas rejouable.
- Une partie quittée avant la fin : pas d'explication, pas d'apprentissage.

### 2.2 Repères communs
- **Case = un entier**, par jeu : Morpion `0..8` ; 4 à la suite `colonne × 6 + ligne` (comme `bot.ts`) ; Bataille navale `y × 10 + x` (`cellIndex`) ; Échecs `0..63` (0 = a8).
- **Numéro de coup dit au joueur** : `{coup}` = « 3e coup » = son 3e coup à lui (Morpion, 4 à la suite) ; « 12e tir » (Bataille navale) ; « coup 14 » = `board.full` (Échecs).
- **Noms de cases** : Morpion → « le centre », « le coin en haut à gauche », « le bord du bas »… (9 noms) ; 4 à la suite → « la colonne tout à gauche », « la 2e colonne », « la 3e colonne », « la colonne du milieu », « la 5e colonne », « la 6e colonne », « la colonne tout à droite » ; Bataille navale → `cellName` (« C7 ») ; Échecs → `squareName` (« e4 ») et pièces « ta dame / ma dame », « ton fou / mon fou »…

### 2.3 Mémoire du bot (2b)
- **`localStorage`**, clé `solo:mem:<jeu>:<id du profil>` (`profile.id` ; `local` si absent). Une mémoire **par jeu et par joueur**, **commune aux 9 persos** (« les potes se racontent tout »), comme le niveau ne dépend pas du perso.
- En-tête commun :
```ts
interface MemBase {
  v: 1
  n: number          // parties « récentes » (somme des poids, tend vers 10)
  at: number         // Date.now() de la dernière partie
  streak: number     // défaites d'affilée du joueur
  lastId: string     // dernier SoloLog.id appris
  lastWhy: string[]  // 2 derniers types d'explication montrés (anti-rabâchage)
  seen: string[]     // habitudes déjà annoncées (« Nouveau »)
}
```
- **Mise à jour : une fois, à la fin de chaque partie terminée** (fonction pure `learn(mem, log) → mem`), si `log.id !== mem.lastId` :
  1. si `at` date de plus de **90 jours** → mémoire remise à zéro ;
  2. **oubli progressif** : tous les compteurs × **0,9**, puis `n = n × 0,9 + 1` ;
  3. ajout des observations de la partie (+1 chacune) ;
  4. purge : entrées de tables < 0,1 supprimées, plafonds par jeu (ci-dessous), nombres arrondis à 2 décimales ;
  5. écriture ; si le JSON dépasse **100 000 caractères** (ne doit pas arriver), on retire la moitié la plus faible des tables jusqu'à repasser dessous.
- Effet de l'oubli à 0,9 : la mémoire « pèse » les ~10 dernières parties (moitié du poids sur les 7 dernières). Une habitude se détecte dès **3 parties d'affilée** (`n ≥ 2,7`) et s'oublie en **5 parties** si le joueur change.
- Mots : « toujours » si part ≥ 85 %, « souvent » si ≥ 60 %.
- Au plus **4 profils** gardés par téléphone (on supprime les mémoires du profil le plus ancien). Stockage vide, bloqué, illisible ou `v` inconnue : on repart de zéro sans message (la mémoire vit alors le temps de la session).
- Tailles réelles attendues : Morpion ~0,6 Ko, 4 à la suite ≤ 5 Ko, Bataille navale ~1,5 Ko, Échecs ≤ 20 Ko.

### 2.4 Apprentissage et niveau : il module, il ne remplace pas
Le **niveau** règle la force brute (profondeur, bruit). L'**apprentissage** règle *où le bot regarde*. Règles fermes :
- L'apprentissage ne change **jamais** la profondeur de recherche ni le taux de coups au hasard, et ne lit **jamais** une information cachée de la partie en cours.
- Il n'agit que de 3 façons : **départage** entre des coups que le niveau juge déjà équivalents ; **a priori sur l'inconnu** (où tirer, où cacher ses bateaux) ; et, au Morpion seulement, **un coup « appris » par partie** qui échappe au bruit.
- **Dose** selon le niveau : `learnRate = [0, 0, 0.3, 0.45, 0.6, 0.75, 0.9, 1, 1, 1][niveau − 1]`. Aux niveaux 1 et 2 le bot **sait mais ne s'en sert pas** (un enfant garde un adversaire qui fait des bêtises).
- **Frein** : après **3 défaites d'affilée** (`streak ≥ 3`), `learnRate = 0` jusqu'à la prochaine victoire ou égalité du joueur.
- Le niveau continue de bouger uniquement sur le résultat (+1 / −1 / 0). Si l'apprentissage fait gagner le bot, le niveau baisse : l'équilibre se refait tout seul.
- Technique : `chooseMove` reçoit un dernier argument optionnel `hints` (petit objet calculé sur le fil principal par `hintsFor(mem, level, board, log)`, transmis tel quel au Web Worker via `BotJob.hints`). **Sans `hints`, le bot joue exactement comme à l'étape 1.** Le bot renvoie en plus `learned?: string` quand une règle apprise a décidé du coup.

## 3. Ce que le bot apprend, par jeu

Dans les tableaux « Il a appris » : 🎯 = il s'en sert, 👀 = il le sait seulement.

### 3.1 Morpion (classique 3 × 3, seule variante du solo)
```ts
interface MorpionMem extends MemBase {
  open: number[]                 // [9] 1er coup du joueur quand il commence
  botOpen: number[][]            // [3] ouverture du bot (centre, coin, bord) × [victoires, nuls, défaites] du bot
  block: [number, number]        // blocages oubliés / occasions
  win: [number, number]          // victoires immédiates manquées / occasions
  traps: Record<string, number>  // positions où le joueur a commis l'erreur perdante (30 max)
}
```
- Clé de `traps` : la grille en 9 caractères (`m` joueur, `b` bot, `.` vide), **la plus petite des 8 symétries** : un piège appris dans un coin vaut pour les 4.
- `block` / `win` / `traps` sont alimentés par les détecteurs de l'explication (§ 4), passés sur tous les coups du joueur.
- Ce que ça change :
  - **M1 — il contre ton ouverture favorite** : le joueur commence, sa 1re case est sa favorite (part ≥ 60 %, `n ≥ 2,7`) → avec probabilité `learnRate`, la réponse du bot **saute le bruit** et joue la bonne réponse (minimax). C'est le seul « coup appris » de la partie.
  - **M2 — il choisit son ouverture** : le bot commence et joue son coup fort (les 9 cases se valent au minimax) → avec probabilité `learnRate`, il prend le type d'ouverture au meilleur bilan contre ce joueur, `(V − D) / (V + N + D + 1)`.
  - **M3 — il refait le piège qui marche** : entre coups de même valeur minimax, avec probabilité `learnRate`, il préfère celui qui mène à une position de `traps` (plus gros poids d'abord).

| Il a appris | Condition | |
|---|---|---|
| « Tu commences {toujours/souvent} par {case}. » | part d'une case ≥ 60 % | 🎯 M1 |
| « Tu commences souvent dans un coin / sur un bord. » | sinon, part d'un type ≥ 70 % | 🎯 M1 |
| « Tu es moins à l'aise quand je commence {au centre / dans un coin / sur un bord}. » | meilleur bilan de `botOpen`, ≥ 2 essais | 🎯 M2 |
| « Le coup des deux menaces marche bien sur toi. » | un piège de poids ≥ 2 | 🎯 M3 |
| « Tu oublies parfois de me bloquer. » | oubliés / occasions ≥ 40 %, occasions ≥ 4 | 👀 |

### 3.2 4 à la suite
```ts
interface Q4Mem extends MemBase {
  cols: number[]    // [7] part de chaque colonne dans les coups du joueur (somme = 1 par partie)
  first: number[]   // [7] son 1er coup quand il commence
  miss: { h: [number, number]; v: [number, number]; d: [number, number] } // blocages oubliés / occasions, par direction
  win: [number, number]
  gift: number      // jetons posés juste sous la case gagnante du bot
  book: Record<string, [number, number, number]>  // débuts de partie → [V, N, D] du bot (200 max)
}
```
- Clé de `book` : `m` (le joueur commence) ou `b`, puis les colonnes `0..6` des 1 à 8 premiers jetons ; on garde la plus petite entre la suite et son **miroir** (colonne → 6 − colonne). Chaque partie écrit jusqu'à 8 clés.
- Ce que ça change :
  - **Q1 — il te prend ta colonne** : entre colonnes de même score, avec probabilité `learnRate`, il joue celle que le joueur préfère (au lieu du centre ou du hasard).
  - **Q2 — il attaque là où tu ne regardes pas** : dans l'évaluation, les alignements de 2 et de 3 **du bot** valent × `(1 + 0,5 × learnRate × taux d'oubli)` dans la direction concernée (si occasions ≥ 3). Les fenêtres doivent donc porter leur direction.
  - **Q3 — tu ne l'auras pas deux fois avec la même partie** : pendant les 8 premiers jetons, parmi les colonnes à 12 points ou moins du meilleur score (hors coups gagnants ou perdants trouvés), avec probabilité `learnRate`, il prend le meilleur bilan de `book` et évite une suite où il a déjà perdu. Q3 passe avant Q1.

| Il a appris | Condition | |
|---|---|---|
| « Tu adores {col}. » | part d'une colonne ≥ 30 % | 🎯 Q1 |
| « Tu commences {toujours/souvent} par {col}. » | part ≥ 60 % | 🎯 Q3 |
| « Tu ne vois pas toujours mes alignements {en diagonale / à l'horizontale / à la verticale}. » | taux d'oubli ≥ 40 %, occasions ≥ 3 | 🎯 Q2 |
| « Tu m'as déjà battu{e} avec ce début de partie : je m'en souviens ! » | une suite de `book` avec défaite ≥ 1 | 🎯 Q3 |
| « Tu poses parfois ton jeton juste sous ma case gagnante. » | `gift ≥ 2` | 👀 |

### 3.3 Bataille navale
```ts
interface BnMem extends MemBase {
  place: number[]          // [100] cases de ses bateaux PLACÉS À LA MAIN
  hand: number             // poids des bateaux placés à la main (÷ 5 par partie)
  auto: number             // poids des parties laissées au hasard
  orient: [number, number] // bateaux couchés / debout (placés à la main)
  touch: [number, number]  // parties avec bateaux qui se touchent / parties placées à la main
  aim: number[]            // [100] ses 15 premiers tirs de chaque partie
}
```
- **Loyauté** : le bot n'apprend qu'à partir des flottes **révélées en fin de partie** (`board.reveal`), jamais de la flotte en cours. `chooseMove` ne reçoit que le plateau public et `hints`.
- **Placé à la main ou au hasard ?** Le plateau envoie toujours `place` (même pour « Mélanger »). On compare donc les `place` successifs de `log.setup`, en partant de la flotte de départ (`log.secret0`) ; aucun `place` = tout au hasard. Règle : **4 bateaux ou plus changés d'un coup = mélange** (tous les bateaux redeviennent « hasard ») ; 3 ou moins = déplacés à la main. Seuls les bateaux « à la main » nourrissent `place` et `orient` : rien à apprendre du hasard.
- Ce que ça change :
  - **B1 — il tire d'abord là où tu ranges tes bateaux** : en phase de recherche (aucun touché en cours), chaque case pèse × `(1 + 3 × learnRate × p)` avec `p = place[i] / hand` (0 à 1, si `hand ≥ 2,7`). Niveaux 5 et + : sur la carte de probabilités ; niveaux 3 et 4 : sur le tirage au hasard.
  - **B2 — il cache ses bateaux loin de tes premiers tirs** : à la préparation, le bot tire `1 + round(7 × learnRate)` flottes au hasard et garde celle qui recouvre le moins `aim` ; il l'envoie par `place` avant `ready`.
  - **B3 — il devine le sens de tes bateaux** : les placements couchés (ou debout) pèsent × `(1 + learnRate × (2 × part − 1))`, plancher 0,25.
  - **B4 — bateaux collés ou espacés** : si le joueur colle ses bateaux (≥ 60 %), les cases voisines d'un bateau coulé pèsent × `(1 + learnRate)` ; s'il laisse toujours de l'eau autour (≤ 15 %), elles pèsent × `(1 − 0,7 × learnRate)`.

| Il a appris | Condition | |
|---|---|---|
| « Tu caches souvent tes bateaux {en haut à gauche / … / le long des bords / au milieu}. » | part d'une zone ≥ 45 % | 🎯 B1 |
| « Tes bateaux sont presque toujours au même endroit. » | 8 cases ou plus avec `p ≥ 0,8` | 🎯 B1 |
| « Tu poses presque toujours tes bateaux {couchés / debout}. » | part ≥ 75 % | 🎯 B3 |
| « Tu colles tes bateaux les uns aux autres. » / « Tu laisses toujours de l'eau autour de tes bateaux. » | ≥ 60 % / ≤ 15 % | 🎯 B4 |
| « Tu tires d'abord {zone}. » | part d'une zone de `aim` ≥ 45 % | 🎯 B2 |
| « Tu laisses le hasard ranger tes bateaux : rien à deviner, malin ! » | `auto` ≥ 60 % des parties | 👀 |

### 3.4 Échecs
```ts
interface ChessMem extends MemBase {
  book: Record<string, [number, number, number]>  // débuts de partie → [V, N, D] du bot (400 max)
  hang: Record<'p' | 'n' | 'b' | 'r' | 'q', number> // pièces données ou laissées sans protection
  castle: number       // parties où le joueur a roqué
  queenEarly: number   // parties où sa dame bouge avant son 6e coup
  mates: { couloir: number; berger: number; autre: number } // façons dont il s'est fait mater
}
```
- **Livre d'ouvertures appris de tes parties** — clé de `book` : `w` ou `b` (couleur du bot) puis 2 caractères par demi-coup (case de départ, case d'arrivée, alphabet de 64 signes), pour les 1 à **12 premiers demi-coups** ; la suite s'arrête à la première promotion. Chaque partie écrit jusqu'à 12 clés. ~19 Ko au plafond.
- `hang`, `mates` : alimentés par les détecteurs du § 4 (`piece_donnee`, `menace_ignoree`, `defense_retiree`, mats).
- Ce que ça change :
  - **E1 — il connaît tes débuts de partie** : pendant les 12 premiers demi-coups, parmi les coups à `max(marge du niveau, 25)` centipions du meilleur, avec probabilité `learnRate`, il prend le meilleur bilan du livre et **évite un coup après lequel il a déjà perdu** (même au niveau 10, on ne le bat pas deux fois avec la même partie).
  - **E2 — il vise tes pièces mal gardées** : à la racine, un coup qui crée une nouvelle attaque sur un type de pièce que le joueur laisse souvent sans protection (`hang ≥ 2` ; ou la dame, si elle sort tôt dans ≥ 60 % des parties) reçoit `+ 20 × learnRate` centipions avant le choix.
- Le premier coup préféré du joueur se lit dans `book` (clés d'un seul demi-coup) : pas de champ en plus.

| Il a appris | Condition | |
|---|---|---|
| « Tu commences {toujours/souvent} par {pièce} en {case}. » | part ≥ 60 % avec les Blancs | 🎯 E1 |
| « Tu m'as déjà battu{e} avec ce début de partie : je m'en souviens ! » | une suite du livre avec défaite ≥ 1 | 🎯 E1 |
| « Tu laisses parfois {ta dame / ta tour / …} sans protection. » | `hang` de la pièce ≥ 2 | 🎯 E2 |
| « Tu sors ta dame très tôt. » | ≥ 60 % des parties | 🎯 E2 |
| « Tu oublies souvent de roquer. » | ≤ 25 % des parties, `n ≥ 4` | 👀 |
| « Le mat du couloir marche bien sur toi. » | `mates.couloir ≥ 2` | 👀 |

### 3.5 Affichage « Il a appris »
- Les phrases d'habitude sont **dites par le perso** (« je », « mes »), dans une bulle.
- **Écran de choix (`SoloPick`)**, sous la jauge : carte **« 🧠 Ce que {Perso} sait de toi »**, au plus **3 lignes** (les habitudes les plus nettes), chacune avec 🎯 ou 👀. Aux niveaux 1-2 et pendant le frein, tout passe en 👀 avec la mention « Il le sait… mais il fait semblant de rien 😇 ». Mémoire vide : « On ne se connaît pas encore ! ». Petit bouton **« Oublier 🧽 »** → « Effacer ce que {Perso} sait de toi à ce jeu ? » (Oui, on repart de zéro / Non).
- **Fin de partie (`SoloEnd`)** : si une habitude vient d'être repérée (absente de `seen`), **une** ligne, bulle du perso : « 🧠 {accroche du perso} tu commences toujours au centre. » (accroches au § 5.3 ; minuscule après les deux-points).
- **En partie** : quand le bot joue un coup `learned`, bulle « Je te connais ! 💡 » (nouvelle humeur `appris` de `BotMood`, 1 fois par partie au plus).
- Tout ce qui est affiché vient **des mêmes chiffres** que ceux dont le bot se sert : pas d'habitude inventée.

## 4. L'explication de défaite (2a)

### 4.1 Ce que voit le joueur
1. **Dans `SoloEnd`**, entre la jauge et les boutons : carte « {Perso} t'explique » avec son sticker (`reflexion`), **une phrase** (≤ 110 caractères) et un gros bouton **« Montre-moi 👀 »**. Pendant l'analyse des Échecs : « 💭 {Perso} repasse la partie… ».
2. **Écran « Pourquoi tu as perdu »** (plein écran, gros texte) :
   - un **petit plateau figé** sur la position du moment clé ;
   - 2 étapes qui s'enchaînent toutes seules puis restent affichées : **① « Ce qui s'est passé »** (ton coup en rouge, ma menace en jaune) → **② « Le bon coup »** (en vert, qui clignote, avec une flèche) ; bouton « Revoir ▶ » ;
   - la bulle du perso : **1 à 3 phrases courtes** (≤ 20 mots chacune, zéro jargon) ;
   - un encadré **« 💡 Pour la prochaine fois »** : un seul conseil ;
   - bouton **« J'ai compris 👍 »** → retour à la fin de partie.
3. Couleurs **et formes** (daltoniens) : rouge + croix = ton coup ; vert + anneau + flèche = le bon coup ; jaune + pointillés = ma menace. Thème clair et sombre, `prefers-reduced-motion` : pas d'enchaînement automatique, les 2 étapes en onglets.
4. Égalité : phrase neutre ; si le joueur a manqué une victoire, on la lui montre de la même façon.

### 4.2 Détection : un seul moment, le plus parlant
```ts
// src/features/solo/why/types.ts
export interface Mark { kind: 'played' | 'better' | 'threat' | 'line' | 'zone'; cells: number[]; arrow?: [number, number] }
export interface Step { ply: number; marks: Mark[] }   // ply = nombre d'entrées à rejouer (replayTo)
export interface Moment {
  type: string                    // ex. 'blocage_oublie'
  weight: number                  // 0 à 100, cf. tableaux
  steps: Step[]                   // 1 ou 2 étapes (① ce qui s'est passé, ② le bon coup)
  vars: Record<string, string | number>
  learned?: string                // 2b : le coup décisif du bot était un coup appris
}
export interface GameWhy { findMoments(log: SoloLog, loser: 'me' | 'bot'): Moment[] }
```
- Chaque jeu fournit `findMoments` (`src/games/<id>/why.ts`), qui renvoie toujours au moins le **repli** du jeu.
- **Choix** (`pickMoment`) : plus gros `weight`, puis le plus proche de la fin. **Anti-rabâchage** : si ce type a déjà été montré aux 2 dernières défaites (`lastWhy`) et qu'un autre moment est à 20 points ou moins, on prend l'autre.
- **Les mêmes détecteurs servent trois fois** : explication (`loser = 'me'`), compliment (`loser = 'bot'`, § 4.4), et compteurs de l'apprentissage (`block`, `miss`, `hang`…).
- **Où ça tourne** : Morpion et Bataille navale sur le fil principal (quelques millisecondes) ; 4 à la suite (≤ 400 ms) et Échecs (≤ 1,5 s) dans le Web Worker du solo (nouveau type de tâche `why`). Dépassement de temps → repli.

### 4.3 Moments clés par jeu

**Morpion** (exact, grâce au minimax). On cherche **le dernier coup du joueur avant lequel il pouvait encore éviter la défaite** (valeur ≥ 0 avant, < 0 après), puis on le classe :

| Type | Poids | Règle | Plateau |
|---|---|---|---|
| `victoire_manquee` | 100 | le joueur avait un coup gagnant immédiat et a joué ailleurs (à n'importe quel moment) | ① sa case en rouge ② la case gagnante + sa ligne |
| `blocage_oublie` | 90 | le bot menaçait d'aligner, le joueur n'a pas pris la case | ① ligne du bot en jaune ② la case à bloquer |
| `fourchette` | 70 | sinon : son coup a permis au bot de créer deux menaces | ① son coup + les 2 menaces ② le coup qui tenait (minimax) |
| `alignement` (repli) | 10 | cas imprévu (ne doit pas arriver en classique) | ① la ligne gagnante du bot |

**4 à la suite**. On remonte depuis la fin, tant que tous les coups du joueur perdaient ; on s'arrête au premier coup où **une autre colonne ne perdait pas** (recherche du bot, profondeur ≤ 8, 6 coups du joueur au plus). Puis on classe, dans cet ordre :

| Type | Poids | Règle | Plateau |
|---|---|---|---|
| `victoire_manquee` | 100 | une colonne gagnait tout de suite (à n'importe quel moment) | ② jeton fantôme vert + les 4 alignés |
| `blocage_oublie` | 90 | le bot avait une colonne gagnante, non bloquée ; `{dir}` = direction de son alignement | ① ses 3 jetons en jaune ② la colonne à bloquer |
| `cadeau_dessous` | 80 | le bot gagne dans la colonne que le joueur vient de jouer, et ne le pouvait pas avant | ① son jeton + celui du bot au-dessus ② une colonne sûre |
| `double_menace` | 70 | après la réponse du bot, il a 2 cases gagnantes | ① les 2 cases en jaune ② la colonne qui l'empêchait |
| `mauvais_plan` | 50 | autre défaite forcée trouvée | ② la colonne qui tenait |
| `alignement` (repli) | 10 | rien trouvé dans les limites | ① la ligne gagnante du bot |

**Bataille navale** (une course : on montre le plus gros gaspillage). Pour chaque tir du joueur, on regarde ce qu'il savait à ce moment-là (tirs déjà faits, bateaux coulés), avec les aides existantes `autoShotCandidates` et `heatMap` :

| Type | Poids | Règle | Plateau (ses tirs sur mes eaux) |
|---|---|---|---|
| `flotte_previsible` (2b) | 85 | B1 actif, flotte du jour à ≥ 50 % sur ses cases habituelles, et ≥ 4 touchés dans les 10 premiers tirs du bot | sa flotte + ses cases habituelles en jaune |
| `ligne_pas_suivie` | 80 | deux touchés alignés non coulés (`line` non vide) et tir ailleurs | ① les 2 touchés + son tir ② les cases dans l'alignement |
| `chasse_abandonnee` | 75 | un touché non coulé (`adjacent` non vide) et tir ailleurs | ① le touché + son tir ② les cases autour |
| `tir_gaspille` | 70 | en recherche, tir sur une case où aucun bateau restant ne peut tenir (`heatMap = 0`), au moins 2 fois | ① son tir + le « trou » en jaune |
| `bateaux_colles` | 50 | ses bateaux se touchent et le bot a enchaîné ≥ 6 touchés | sa flotte, bateaux collés en jaune |
| `course` (repli) | 10 | rien de net : on compare les précisions | — |

Variables utiles : `{nb}` = nombre de tirs du même type (on montre le premier), `{manque}` = touchés qu'il lui restait à faire. Si `{nb} ≥ {manque}`, on ajoute « sans ça, c'était jouable ! ».

**Échecs** (règles sur le journal, sans chercher « la position perdue ») :

| Type | Poids | Règle | Plateau |
|---|---|---|---|
| `mat_en_1_rate` | 100 | à son tour, un coup légal donnait échec et mat | ② flèche verte du mat |
| `mat_evitable` | 90 | son dernier coup laisse un mat en 1 alors qu'un autre coup l'évitait | ① son coup + flèche jaune du mat ② le coup qui évitait |
| `piece_donnee` | 80 | il pose une pièce (cavalier, fou, tour, dame) sur une case attaquée, le bot la prend, perte nette ≥ 2 | ① sa pièce + flèche de l'attaquant |
| `menace_ignoree` | 78 | la pièce était déjà attaquée avant son coup, il joue autre chose, le bot la prend | ① flèche de l'attaquant ② le coup qui sauvait |
| `defense_retiree` | 76 | son coup retire la protection d'une pièce que le bot prend ensuite | ① la pièce bougée + la pièce abandonnée |
| `fourchette` | 72 | une pièce du bot attaque 2 pièces (ou le roi et une pièce) et en prend une au coup suivant | ① position après le coup du bot, 2 flèches jaunes |
| `mauvais_echange` | 65 | il prend avec une pièce plus chère, le bot reprend, perte nette ≥ 2 | ① sa prise + la reprise |
| `roi_au_centre` | 40 | maté sans avoir roqué, roi encore sur sa colonne de départ | position du mat |
| `materiel` (repli) | 10 | rien de net : écart de pièces à la fin | position finale |

- Perte nette = valeur prise (pion 1, cavalier/fou 3, tour 5, dame 9) moins la valeur de la pièce du bot reprise au coup suivant sur la même case. Entre plusieurs pertes : la plus grosse, puis la plus récente.
- **« Le bon coup » aux Échecs** : une recherche du bot (profondeur 2, ≤ 300 ms) sur la position du moment ; on n'affiche la flèche verte **que si** ce coup fait au moins 1,5 pion de mieux que le coup joué. Sinon l'étape ① suffit (attaquant → victime, c'est le plus clair pour un débutant).
- Attaques et mats : `isAttacked`, `attackers`, `isCheckmate` de chess.js 1.4.0 (présents dans la version épinglée).
- Abandon du joueur : même analyse ; sans moment net, repli `materiel`.

### 4.4 Quand le joueur gagne, ou fait nul
- Mêmes détecteurs avec `loser = 'bot'`. On en tire **un compliment précis** dans la carte de fin (sticker `surprise`) et le même écran, titré **« Ton meilleur coup »**, sans conseil.
- Honnêteté : si le bot a perdu sur une de ses bêtises (bruit du niveau), il le dit (« J'ai oublié de te bloquer… et tu n'as pas raté ça ! »).
- Bataille navale : précision, meilleure série de touchés, aucun tir gaspillé.
- Nul : « Égalité ! Personne n'a craqué. » ; avec `victoire_manquee` côté joueur : « Égalité… mais à ton {coup}, tu pouvais gagner ! » + « Montre-moi 👀 ».

### 4.5 Le petit plateau
- Un **diagramme figé par jeu** (`src/games/<id>/Diagram.tsx`), qui reçoit la position (`replayTo`) et les `marks`. On ne modifie pas les vrais plateaux (animés, tactiles, sonores).
- Réutiliser les dessins existants : `Mark` (Morpion), `Token` (4 à la suite), `Sea` en `size="sm"` (Bataille navale, accepte déjà tirs, bateaux et réticule), `Piece` (Échecs). Style sticker book : contours épais, ombre décalée.
- Stickers du bot : via `pickExpression`, parmi `reflexion`, `surprise`, `joie`, `boude`, `pleurs` (les 5 prévus pour le hors-ligne), avec le repli habituel.

## 5. Répliques

### 5.1 Composition (pas de travail × 9)
`texte = [intro du perso] + phrase du moment + [2e phrase, sur l'écran seulement] + [chute du perso, 1 fois sur 2]`
- Les **phrases de moment** sont communes aux 9 persos ; la personnalité tient en une **intro**, une **chute**, un **bravo** et une **accroche « j'ai appris »** par perso (§ 5.3).
- 3 phrases au plus, intro comprise ; le conseil est à part.
- **Accords** : `{e}` vaut « e » pour Cycy, Dédé, Manon, Cécile, Karo, rien sinon (« je me suis servi{e} »). On ne connaît pas le genre du joueur : **aucun accord sur « tu »** (écrire « tu as joué », jamais « tu es allé »).
- Ne pas resservir la même phrase deux fois de suite pour un même type.
- **Ton** : jamais « nul », « facile », « raté » ; le bot se moque de lui-même, pas du joueur ; on finit toujours par un conseil ou un encouragement. Vocabulaire : « deux menaces d'un coup » (pas « fourchette »), « sans protection » (pas « en prise »).

### 5.2 Phrases modèles par moment

**Morpion**
| Type | Phrases | 💡 Conseil |
|---|---|---|
| `victoire_manquee` | « À ton {coup}, tu pouvais gagner tout de suite en jouant {case}. » · « Tu avais deux {signe} alignés : il ne manquait que {case} ! » | « Avant de jouer, cherche d'abord si tu peux aligner trois. » |
| `blocage_oublie` | « J'avais deux {signe_bot} alignés et {case} était libre : il fallait me bloquer. » · « À ton {coup}, tu as joué {case_jouee}. Du coup, j'ai fini ma ligne avec {case}. » | « Si tu ne peux pas gagner, regarde où je peux gagner et prends la case. » |
| `fourchette` | « À ton {coup}, tu as joué {case_jouee} : ça m'a permis de faire deux menaces d'un coup. » · « Tu ne pouvais plus tout bloquer. Avec {case} à la place, pas de double menace. » | « Quand j'ai deux {signe_bot} qui ne se touchent pas, méfie-toi : je prépare deux menaces. » |

**4 à la suite**
| Type | Phrases | 💡 Conseil |
|---|---|---|
| `victoire_manquee` | « À ton {coup}, un jeton dans {col} et tu alignais quatre ! » · « Tu avais trois jetons alignés et la place était libre dans {col}. » | « Avant de lâcher ton jeton, cherche tes alignements de trois. » |
| `blocage_oublie` | « J'avais trois jetons alignés {dir} : il fallait jouer {col} pour me bloquer. » · « À ton {coup}, tu as joué {col_jouee}, et j'ai fini ma ligne. » | diagonale : « Les diagonales sont les plus dures à voir : suis-les du doigt avant de jouer. » · sinon : « Compte mes jetons alignés : à trois, il faut bloquer. » |
| `cadeau_dessous` | « Ton jeton dans {col_jouee} m'a fait la courte échelle : j'ai posé le mien juste au-dessus. » · « La case du dessus me faisait gagner : il valait mieux jouer {col}. » | « Avant de jouer une colonne, regarde ce que la case du dessus m'offrirait. » |
| `double_menace` | « À ton {coup}, tu as joué {col_jouee}. Après ma réponse, j'avais deux façons de gagner. » · « Tu ne pouvais en bloquer qu'une. Avec {col}, je n'avais pas ma double menace. » | « Deux de mes jetons côte à côte avec de la place des deux côtés ? Bloque tout de suite. » |
| `mauvais_plan` | « À ton {coup}, {col} tenait encore. Après {col_jouee}, je gagnais quoi que tu fasses. » | « Garde le milieu du plateau : c'est de là que partent le plus d'alignements. » |
| `alignement` | « J'ai construit mon alignement {dir}, petit à petit. » | « Regarde mes jetons après chacun de mes coups : où est-ce que j'en ai deux ou trois ? » |

**Bataille navale**
| Type | Phrases | 💡 Conseil |
|---|---|---|
| `ligne_pas_suivie` | « Tu avais deux touchés alignés, {case_a} et {case_b}, et tu as tiré en {case_jouee}. » · « Mon bateau continuait dans la même ligne : {case} était le bon tir. » | « Deux touchés alignés ? Continue tout droit jusqu'à "coulé". » |
| `chasse_abandonnee` | « Tu m'as touché{e} en {case_a}, puis tu as tiré ailleurs. Mon bateau a eu le temps de souffler ! » · « Le reste du bateau était forcément juste à côté. Ça t'est arrivé {nb} fois. » | « Touché ? Tire autour (haut, bas, gauche, droite) jusqu'à "coulé". » |
| `tir_gaspille` | « Ton tir en {case_jouee} ne pouvait rien toucher : mon plus petit bateau restant fait {taille} cases. » · « {nb} de tes tirs sont tombés dans des trous trop petits pour mes bateaux. » | « Regarde quels bateaux il me reste : inutile de tirer dans un trou plus petit qu'eux. » |
| `flotte_previsible` | « Tes bateaux étaient presque au même endroit que les dernières fois : je suis allé{e} droit dessus ! » · « {nb} de mes 10 premiers tirs ont touché. Je connais tes cachettes ! » | « Change de cachettes à chaque partie… ou appuie sur Mélanger 🎲. » |
| `bateaux_colles` | « Tes bateaux se touchaient : en coulant l'un, je suis tombé{e} sur son voisin. » | « Laisse au moins une case d'eau entre tes bateaux. » |
| `course` | « C'était serré : il te manquait {manque} touché(s). » · « J'ai réussi {precision_bot} % de mes tirs, toi {precision_moi} %. » | « Pour chercher, tire en damier (une case sur deux) : aucun bateau ne passe entre. » |

**Échecs**
| Type | Phrases | 💡 Conseil |
|---|---|---|
| `mat_en_1_rate` | « Au coup {coup}, tu pouvais me faire échec et mat : {piece} en {case} ! » · « Mon roi n'avait plus aucune sortie. » | « Quand tu peux donner échec, regarde si mon roi a encore une case où fuir. » |
| `mat_evitable` | « Au coup {coup}, tu as joué {piece_jouee} en {case_jouee} : ça m'a laissé le mat avec {piece_bot}. » · « Avec {piece} en {case}, ton roi s'en sortait. » | « Avant de jouer : est-ce que mon roi peut être mis en échec au prochain coup ? » · mat du couloir : « Ouvre une petite fenêtre à ton roi : avance d'une case un pion devant lui. » |
| `piece_donnee` | « Au coup {coup}, tu as posé {piece} en {case_jouee}, pile sur une case que {piece_bot} attaquait. » · « Personne ne protégeait {piece} : je me suis servi{e}. » | « Avant de lâcher une pièce, regarde qui attaque la case d'arrivée. » |
| `menace_ignoree` | « {piece_bot} attaquait {piece} et tu as joué autre chose. Je l'ai prise ! » · « Au coup {coup}, il fallait la bouger ou la protéger. » | « Après chacun de mes coups, demande-toi : qu'est-ce qu'il attaque ? » |
| `defense_retiree` | « En bougeant {piece_jouee}, tu as laissé {piece} sans protection. » | « Avant de bouger une pièce, regarde ce qu'elle protégeait. » |
| `fourchette` | « {piece_bot} attaquait {piece_a} et {piece_b} en même temps : tu ne pouvais en sauver qu'une. » · « Deux menaces d'un coup, arrivées juste après ton coup {coup}. » | « Méfie-toi de mes cavaliers et de ma dame : ils adorent attaquer deux pièces à la fois. » |
| `mauvais_echange` | « Au coup {coup}, tu as pris {piece_prise} avec {piece}… mais la case était protégée, et j'ai repris {piece}. » | « Avant de prendre, compte : qu'est-ce que je gagne, qu'est-ce que je risque de perdre ? » |
| `roi_au_centre` | « Ton roi est resté au milieu toute la partie : c'est là que mes pièces l'ont attrapé. » | « Roque dans les 10 premiers coups : ton roi sera à l'abri derrière ses pions. » |
| `materiel` | « Pas de grosse bêtise : j'ai grignoté petit à petit. À la fin, j'avais {ecart} points de pièces en plus. » | « Avant chaque coup : est-ce qu'une de mes pièces est attaquée ? » |

**Compliments (le joueur gagne)**
| Moment (côté bot) | Phrases |
|---|---|
| deux menaces du joueur | « Ton {coup} m'a eu{e} : deux menaces d'un coup, je ne pouvais plus tout bloquer ! » |
| le bot a oublié de bloquer | « J'ai oublié de te bloquer… et tu n'as pas raté ça. Bien vu ! » |
| le bot a manqué sa victoire | « Entre nous : je pouvais gagner juste avant et je ne l'ai pas vu. Bravo d'en avoir profité ! » |
| Bataille navale | « {precision_moi} % de tirs réussis, dont {serie} touchés d'affilée : un vrai radar ! » · « Aucun tir perdu : tu as suivi chaque bateau jusqu'au bout. » |
| Échecs, mat | « Échec et mat au coup {coup} avec {piece} en {case} : je ne l'ai pas vu venir ! » |
| Échecs, pièce gagnée | « Ton coup {coup} m'a pris {piece_bot} : c'est là que la partie a tourné. » |
| repli | « Bien joué : tu as été plus solide que moi du début à la fin. » |

**Quand le coup décisif du bot était un coup appris (2b)** : on ajoute « Et je me doutais que tu jouerais là : tu le fais souvent ! ».

### 5.3 La voix des 9 persos
Un trait par perso, repris des cartes de Pas de bol (déjà dans le jeu). À ajuster librement par l'utilisateur.

| Perso | Trait | Intros | Chutes | Bravo (victoire du joueur) | Accroche « j'ai appris » |
|---|---|---|---|---|---|
| Keke (kevin) 🎮 | gamer | « Replay ! » · « Analyse du match : » | « GG quand même. » · « On relance ? » | « GG, joli combo ! » | « J'ai repéré ta technique : » |
| Cycy 🐻 | câline | « T'en fais pas, regarde : » · « Viens voir, c'est tout bête : » | « Tu y étais presque ! » · « Un câlin et on rejoue ? » | « Oh, bravo ! Je suis trop fière de toi ! » | « J'ai bien vu, tu sais : » |
| Dédé 👑 | reine de la soirée | « La reine t'explique : » · « Approche, je te montre : » | « La couronne reste chez moi… pour l'instant. » · « La revanche quand tu veux ! » | « Chapeau ! La reine s'incline. » | « Rien n'échappe à la reine : » |
| Manon ✏️ | note tout | « J'ai tout noté : » · « D'après mon carnet : » | « C'est noté pour la prochaine fois ! » · « Tu progresses, je l'écris. » | « Je le note en gros : bien joué ! » | « C'est dans mon carnet : » |
| Mika 🧢 | cool, taquin | « Tranquille, regarde : » · « Hé hé, celle-là tu l'as pas vue : » | « Sans rancune ! » · « La prochaine, elle est pour toi. » | « Respect, bien vu ! » | « J'ai capté un truc : » |
| Cécile 🧶 | ordonnée, rassurante | « On reprend tranquillement : » · « Voyons ça ensemble : » | « Un coup après l'autre, et ça ira. » · « Allez, on range et on rejoue ! » | « Du beau travail, bravo ! » | « J'ai remarqué quelque chose : » |
| Karo (carole) 🐱 | féline, taquine | « Petit coup de griffe ! » · « Miaou, regarde là : » | « Je rentre les griffes si tu rejoues. » · « Ronron… à la prochaine ! » | « Tu m'as bien eue, bravo ! » | « J'ai flairé quelque chose : » |
| Marius 🧥 | peu bavard | « Bon. Regarde. » · « Bah, c'est simple : » | « Voilà. » · « T'inquiète, ça arrive. » | « Pas mal. Vraiment. » | « J'ai vu un truc : » |
| Nini 🐧 | gaffeur | « Oups, ça a glissé là : » · « Attends, je te montre (sans tomber) : » | « Moi aussi je glisse souvent ! » · « On se relève et on y retourne ! » | « Waouh, j'ai rien vu venir ! » | « J'ai fini par comprendre : » |

Exemple complet (Karo, Morpion, `blocage_oublie`) : « Petit coup de griffe ! J'avais deux ❌ alignés et le coin en bas à droite était libre : il fallait me bloquer. Je rentre les griffes si tu rejoues. » + 💡 « Si tu ne peux pas gagner, regarde où je peux gagner et prends la case. »

## 6. Fichiers
```
src/features/solo/
  log.ts                 2a  SoloLog, replayTo
  why/types.ts           2a  Moment, Mark, Step
  why/pick.ts            2a  choix du moment, anti-rabâchage
  why/voice.ts           2a  les 9 voix, composition des phrases
  why/WhyPanel.tsx       2a  écran « Pourquoi tu as perdu » / « Ton meilleur coup »
  memory.ts              2b  lecture, écriture, oubli, purge, learnRate
  LearnedCard.tsx        2b  « Ce que {Perso} sait de toi »
src/games/<id>/
  why.ts                 2a  findMoments + phrases + conseils du jeu
  Diagram.tsx            2a  petit plateau figé + marques
  learn.ts               2b  learn(mem, log), insights(mem), hintsFor(mem, level, board, log)
tools/sql-tests/
  solo-why.mjs  solo-learn.mjs   (sans base, comme solo-bots.mjs)
```
Retouches de l'étape 1 : `useSoloMatch` (journal), `SoloEnd` (carte d'explication, ligne « Nouveau »), `SoloPick` (carte « sait de toi »), `BotMood` (+ `appris`), `SoloGameModule.chooseMove` et `BotJob` (+ `hints`, tâche `why`), les 4 `bot.ts` (lecture de `hints`, export de la recherche pour l'analyse). Tout le nouveau code est chargé à la demande (rien de plus à l'accueil).

## 7. Tests
- **`solo-why.mjs`** : une partie écrite à la main par type de moment → bon type, bonne case ; 200 parties bot contre hasard par jeu → `findMoments` ne plante jamais, renvoie toujours un moment, et « le bon coup » est toujours un coup légal (Morpion : qui ne perd pas au minimax) ; temps d'analyse sous les plafonds.
- **`solo-learn.mjs`** : habitude détectée à la 3e partie identique, oubliée en 5 parties différentes ; 500 parties simulées → chaque mémoire < 100 Ko ; **sans `hints`, mêmes coups qu'à l'étape 1** (même graine) ; niveaux 1-2 et frein → `learnRate = 0` ; Bataille navale : contre une flotte toujours identique, le bot de niveau 7 finit en nettement moins de tirs avec mémoire que sans, et ne gagne rien contre des flottes au hasard ; mémoire illisible → remise à zéro sans erreur.
- À la main sur téléphone : lisibilité de l'écran d'explication (thème clair et sombre), bouton « Oublier ».

## 8. Livraison (après l'étape 1 en cours)
1. **Étape 2a — Il t'explique.** Journal, détecteurs, petit plateau, répliques, compliments. Aucun stockage, aucun changement dans le jeu des bots. Livrable jeu par jeu : Morpion → 4 à la suite → Bataille navale → Échecs. *(Modèle : Sonnet ; retouches de textes : Fable ou Haiku.)*
2. **Étape 2b — Il apprend.** Mémoire, `learn.ts` des 4 jeux, bots avec `hints`, carte « sait de toi », bulle « Je te connais ! », bouton « Oublier », moment `flotte_previsible`, phrase du coup appris. Vient après 2a car l'apprentissage réutilise ses détecteurs. *(Modèle : Sonnet.)*
3. **Étape 3 — Hors ligne** (l'ancienne « étape 2 » du doc de base, inchangée sur le fond). 2a et 2b sont déjà 100 % locales ; il reste seulement à :
   - ajouter les nouveaux morceaux de code (explications, apprentissage, petits plateaux) à la liste du cache ; **aucune image en plus** ;
   - vérifier que la mémoire par profil fonctionne avec la session locale gardée hors ligne ;
   - remesurer le cache (toujours ≤ 3 Mo ; la mémoire des bots, en `localStorage`, est à part : ≤ 100 Ko par jeu).
   Objectif de poids pour 2a + 2b : ≤ 40 Ko compressés, textes compris (à mesurer).

## 9. Hors périmètre
- IA en ligne, synchronisation de la mémoire entre téléphones, envoi de quoi que ce soit au serveur.
- « Retenter ce coup 🔁 » (rejouer depuis le moment clé) : bonne suite possible, le journal le permet déjà, mais pas dans cette livraison.
- Relecture complète de la partie coup par coup ; liste de toutes les erreurs.
- Morpion géant / ultime (non proposés en solo).
- Une personnalité de jeu différente par perso (le perso reste cosmétique : seule sa voix change).

## 10. Points tranchés (par le game designer, à confirmer)
1. **`localStorage`, pas IndexedDB** : données minuscules, lecture immédiate, même mécanique que le niveau.
2. **Mémoire par jeu et par profil**, commune aux 9 persos. *(Le niveau de l'étape 1 est par téléphone, clé `solo:level:<jeu>` : à aligner un jour sur le profil, sans urgence.)*
3. **Oubli à 0,9 par partie** (~10 parties de mémoire), remise à zéro après 90 jours sans jouer, plafonds par table, 4 profils au plus.
4. **Apprentissage coupé aux niveaux 1-2 et après 3 défaites d'affilée** : le bot sait, mais ne s'en sert pas. Le niveau reste la seule jauge.
5. **L'apprentissage ne touche ni à la profondeur ni au bruit**, sauf un seul coup par partie au Morpion (la réponse à l'ouverture favorite).
6. **Bataille navale** : le bot n'apprend que des flottes révélées en fin de partie ; les bateaux placés par « Mélanger » ne comptent pas.
7. **Un seul moment expliqué** (le plus parlant), pas une liste ; **une phrase tout de suite**, le plateau sur un appui (« Montre-moi 👀 »).
8. **Petit plateau figé dédié** plutôt que des surbrillances sur les vrais plateaux (plus simple, plus sûr, plus léger).
9. **Échecs : analyse en fin de partie**, dans le Web Worker, 1,5 s au plus ; flèche verte seulement si le coup est nettement meilleur.
10. **Mêmes détecteurs** pour l'explication, le compliment et les compteurs de l'apprentissage.
11. **Répliques** : phrases communes + intro, chute, bravo et accroche par perso ; pas de textes × 9.
12. **Pas de nouvelle image** : les 5 expressions prévues pour le hors-ligne suffisent.
13. **Partie quittée en cours** : ni explication, ni apprentissage.
14. **Ordre** : 2a, puis 2b, puis le hors-ligne (qui n'est pas bloqué : s'il doit passer avant, il suffira de revoir la liste du cache après 2a et 2b).
