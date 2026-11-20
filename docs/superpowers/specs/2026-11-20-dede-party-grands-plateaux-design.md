# Dédé Party — les grands plateaux (tailles selon le nombre de joueurs) — conception

Suite de `2026-11-20-dede-party-plateaux-design.md` (les 5 plateaux, désormais codés). Demande : des plateaux qui **grandissent avec le nombre de joueurs**, sur le principe « des quartiers qui s'ouvrent » : le plateau de base reste, des zones s'ajoutent ; fermées, on les devine derrière un rideau, une brume, une palissade.
**Statut : conception tranchée (carte blanche), prête à implémenter.** Aucun code de jeu modifié par ce document. Un outil l'accompagne : `tools/dede-party/grands-plateaux-sim.mjs` (générateur des tracés, contrôles, simulation d'équilibre).

Tout reste **original** (aucun nom, plateau, case ou visuel d'un jeu existant) et la contrainte du moteur est intacte : **aucune décision pendant les déplacements**. Tout ce qui est ajouté ici (portes de quartier, bacs, télécabines, pistes) est automatique, visible avant de lancer, et se raconte en une phrase.

## 0. Vue d'ensemble

| Plateau | 2 à 4 joueurs — taille **S** | 5 et 6 joueurs — taille **M** | 7 et 8 joueurs — taille **L** |
|---|---|---|---|
| 🎤 Le Grand Plateau | 47 cases (11 × 9) | **100 cases** (19 × 15) : + 👗 Les Coulisses (26) + 🎛️ La Régie (27) | = M (plafond) |
| 🏖️ Dédé-sur-Mer | 45 cases (11 × 9) | **100 cases** (20 × 15) : + 🐦 L'Île aux Mouettes (28) + 🥥 L'Île Coco (27) | **201 cases** (31 × 20), l'archipel : + 🌋 Le Piton Fumant (31) + 🏴‍☠️ La Crique des Pirates (36) + 🦀 L'Îlot des Crabes (34) |
| 🎪 La Kermesse | 40 cases (11 × 7) | **100 cases** (23 × 14) : + 👻 Le Train Fantôme (31) + 🎢 Le Grand Huit (29) | = M (plafond) |
| 🏕️ Le Camping | 36 cases (11 × 9) | **100 cases** (20 × 17) : + 🍄 Le Sous-bois aux Champignons (31) + 🦫 La Rivière aux Castors (33) | = M (plafond) |
| ⛷️ Dédé 2000 | 49 cases (11 × 9) | **105 cases** (29 × 13), « Dédé 2500 » : + 🐐 La Combe aux Chamois (28) + 🐄 Les Alpages (28) | **204 cases** (29 × 21), « Dédé 3000 » : + 🧊 Le Glacier (50) + 🦅 La Crête des Aigles (49), jusqu'au Pic |

Les tailles S sont **les plateaux actuels, inchangés** (mêmes cases, mêmes numéros, mêmes règles). Une taille plus grande contient toujours la précédente : M = S + 2 quartiers, L = M + 2 ou 3 quartiers.

**Le Grand Plateau** (non précisé dans la demande) : **il a une taille M de 100 cases et plafonne là**, comme la Kermesse et le Camping. Raisons : (1) avec « Au hasard » par défaut, un tirage à 5-8 joueurs ne doit pas tomber sur un plateau deux fois plus petit que les quatre autres ; (2) sa signature — les aiguillages qui basculent — est exactement le mécanisme des portes de quartier : l'agrandir ne coûte aucune règle nouvelle, seulement deux aiguillages de plus ; (3) c'est le plateau de référence : sa taille M sert de banc d'essai au modèle (étape 1 de la livraison) ; (4) pas de taille L : un studio est un lieu clos, et à 200 cases il lui faudrait une seconde mécanique pour rester lisible.

Ce qu'un joueur vit sur un grand plateau, en une phrase : *« on part comme d'habitude, puis une fois sur deux le bac (la télécabine, le tourniquet…) m'emmène dans un quartier que je traverse en 4 ou 5 tours, avec son étoile à lui, avant de retrouver tout le monde sur le plateau central »*.

---

## 1. Le modèle

### 1.1 Trois tailles, choisies au départ et figées

- `size` : `'s'` (plateau classique) · `'m'` (grand plateau) · `'l'` (plateau géant).
- Règle unique, côté serveur, au lancement : `l` si **7 ou 8 joueurs** et plateau ∈ {`mer`, `ski`} ; sinon `m` si **5 joueurs ou plus** ; sinon `s`. « Joueurs » = `cardinality(p_players)` au départ. La taille est écrite dans `state.size` et **ne change plus** (un joueur qui part en cours de partie n'y touche pas).
- Pas d'option pour l'hôte : la taille découle du nombre de joueurs. La carte du plateau, dans les options, affiche une pastille calculée par le front avec la même règle (`sizeFor(map, joueurs du salon)`) : « Grand format · 100 cases · 2 quartiers en plus » / « Format géant · 201 cases · l'archipel au complet ». Avec « Au hasard », la pastille dit seulement « Grand format » / « Format géant ».
- Pour les tests et la page de démo (`PartyTestPage`) : `p_options.size` (`'s' | 'm' | 'l'`) force la taille si le plateau la possède ; valeur absente, inconnue ou trop grande pour le plateau → règle automatique. Rien dans l'interface de jeu ne l'envoie.
- **Parties en cours au déploiement** : `state.size` absent → `'s'`. Toutes les fonctions lisent `coalesce(state->>'size', 's')`.
- Au générique, la carte « Ce soir : 🏖️ Dédé-sur-Mer » gagne une ligne : « Grand format : l'Île aux Mouettes et l'Île Coco sont ouvertes ! » (§5).

### 1.2 Un quartier = un détour, avec une porte automatique

Le plateau de base devient le **carrefour** ; chaque quartier est une **excursion** de 26 à 50 cases qui part d'une case du plateau de base (la *porte*) et y revient quelques cases plus loin (le *retour*). Aucun quartier n'allonge le tour pour tout le monde : c'est ce qui permet d'avoir 100 ou 200 cases alors qu'un pion n'en parcourt que 65 par partie (9 tours × 7 cases).

**Les portes** (toutes existent déjà dans le moteur) :

| Porte | Moteur | Ce que voit le joueur |
|---|---|---|
| Porte « un pion sur deux » | embranchement `toggle` (celui du Grand Plateau) : `NEXT[porte] = [tout droit, quartier]`, `state.sw` choisit puis bascule | le véhicule ou la barrière est là, ou n'y est pas : 🎤 l'aiguillage · 🏖️ **le bac est à quai / en mer** · 🎪 **le tourniquet** · 🏕️ **la barrière du sentier** · ⛷️ **une cabine sur deux** |
| Porte de la marée | embranchement `tide` (celui du Banc de sable) | les bancs de sable des îles s'ouvrent et se ferment avec la mer |
| Passage obligé | simple liaison `NEXT[a] = b` | un seul cas : la télécabine des Alpages (§3.5) |

**Les transports** : une liaison entre deux cases non voisines est un *transport* (bac, navette, télécabine, piste, luge). C'est la liaison `jumps` déjà utilisée par la Grande Luge : pas de ruban, le pion voyage dans le véhicule, **un transport compte pour 1 pas**. Les transports n'ont aucune règle propre : à l'arrivée on applique les effets de passage comme pour n'importe quelle case franchie (Halte ou Départ +5, étoile, raton…), et l'effet d'arrêt si le pion s'y arrête.

**Quatre règles communes aux grandes tailles** (les seules nouveautés du moteur) :

1. **Étoiles par zone.** Le plateau de base garde ses étoiles d'aujourd'hui (2 à 5-6 joueurs, 3 à 7-8 joueurs : `star_count`), et **chaque quartier a la sienne** (2 pour les deux grands secteurs de Dédé 3000). Une étoile achetée déménage dans une autre Loge libre **de sa zone**. La carte « Changement de décor » déplace chaque étoile dans sa zone. Résultat : où qu'on soit, une étoile est à portée (une pour 20 à 26 cases ; aujourd'hui : une pour 15 à 25).
2. **Case Halte** 🏁 (nouveau type `halt`, uniquement sur `mer` et `ski`) : la première case d'une île ou d'un secteur de montagne. **+5 pièces quand on y arrive en avant** (par le bac, la télécabine), exactement comme un passage au Départ. Rien au placement de départ ni en reculant.
3. **Départs répartis (taille L seulement).** À 7-8 joueurs, les pions ne partent pas tous du Départ : ils sont déposés **par deux** sur des Haltes (4 îles tirées au sort parmi les 5 ; les 4 gares de la montagne). Personne ne touche le bonus de la Halte où il démarre. À 7 joueurs : 2 + 2 + 2 + 1.
4. **Mécaniques démultipliées** : la marée commande plusieurs bancs ; la Tombola a 4 guichets pour une seule cagnotte ; Riton a de la famille ; la montagne a plus de télésièges et de verglas (§3).

**Ce qui ne change pas**, quelle que soit la taille : 2 dés (Triple dé une fois), lancer simultané, 9 tours par défaut (6 / 9 / 12), 10 pièces au départ, prix des étoiles, cartes Enveloppe, mini-jeux, cérémonie, minuteurs de phase, **24 pas au plus par pion et par tour**, 5 s d'animation par pion. Ni dé en plus, ni tour en plus : une partie à 8 sur 204 cases dure autant qu'une partie à 8 aujourd'hui (seul le générique gagne 2 à 4 s).

### 1.3 Données d'un plateau (front)

**Coordonnées.** Le plateau de base garde ses coordonnées actuelles (colonnes 0-10, lignes 0-8). Les quartiers utilisent **le même repère, prolongé** : colonnes et lignes négatives ou supérieures à 10 (ex. l'Île aux Mouettes : colonnes −9 à −3). Conséquence : `XY` d'une taille est un préfixe de `XY` de la taille au-dessus, et tout le décor existant (coordonnées de grille des thèmes) reste juste à toutes les tailles.

**Fichiers** — toujours un fichier par plateau, `boards/<id>.ts`. Les constantes actuelles (`CELLS`, `NEXT`, `PREV`, `XY`, `EXTRA`) restent **en tête de fichier, inchangées** : c'est la taille S. S'ajoutent, une ligne chacune (le test les relit par expression régulière) :

```ts
export const CELLS_M … NEXT_M … PREV_M … XY_M … JUMPS_M … EXTRA_M   // tous les plateaux
export const CELLS_L … NEXT_L … PREV_L … XY_L … JUMPS_L … EXTRA_L   // mer et ski
```

Valeurs exactes : **annexe A** (produites par `node tools/dede-party/grands-plateaux-sim.mjs --dump <plateau> <taille>`). `CELLS_M` et `XY_M` sont écrits en entier (préfixes de `CELLS_L` / `XY_L`) ; `NEXT` et `PREV` diffèrent d'une taille à l'autre aux portes.

**Types** (`boards/types.ts`) :

```ts
export type SizeId = 's' | 'm' | 'l'
export type CellType = … | 'halt'
export type TransportKind = 'boat' | 'cabin' | 'slide' | 'luge'

export interface ForkInfo { …; mode: 'toggle' | 'tide'
  look?: 'switch' | 'boat' | 'cabin' | 'gate' | 'turnstile' | 'piste' }   // habillage de la porte (défaut : switch)
export interface Quarter { id: string; name: string; emoji: string
  opens: 'm' | 'l'            // taille qui l'ouvre
  cells: number[]             // ses cases (bancs compris)
  gate: number                // case du plateau de base (ou du quartier du dessous) qui y mène
  box: { c0: number; r0: number; c1: number; r1: number }   // emprise en grille (décor, voile de fermeture, caméra)
  road?: string }
export interface BoardDef { …
  size: SizeId
  col0: number; row0: number  // coin haut-gauche de l'emprise des cases ouvertes (≤ 0) ; cols / rows = sa largeur / hauteur
  quarters: Quarter[]         // ouverts à cette taille
  closed: Quarter[]           // fermés à cette taille (aperçu derrière le voile)
  transports: Record<string, { kind: TransportKind; name: string }>   // clé « de-vers », une entrée par liaison de `jumps`
  starts?: number[]           // haltes de départ (taille L)
  alt?: number[] }            // altitude de chaque case, en unités de scène (ski, rendu seulement)
```

- `boardOf(map, size)` renvoie le `BoardDef` de la taille (mémoïsé) ; `boardOf(map)` = taille S. Partout où le code fait `boardOf(s.map)` : `boardOf(s.map, s.size)`.
- `cellXY`, `PartyScene.grid`, `GameBoard`, `BoardThumb` : remplacer `col − (cols − 1) / 2` par `col − col0 − (cols − 1) / 2` (idem lignes). En taille S, `col0 = row0 = 0` : rien ne bouge.
- `CELL_INFO.halt = { label: 'Halte', emoji: '🏁', color: '#FFB703', effect: '+5 pièces quand tu y débarques' }` ; `cellNames` donne le nom propre (« Ponton des Mouettes », « Gare des Chamois »).
- `zones` : chaque quartier est aussi une `Zone` décorative (plaque, teinte du ruban) ; les bancs de sable restent des zones fonctionnelles.
- `starCount(players)` devient `starsInPlay(board, players)` = somme des zones (affichage de l'aide).

### 1.4 SQL (`supabase/games/dede-party.sql`)

Les fonctions de plateau prennent la taille en second paramètre ; `drop function if exists public._dp_board(text); … _dp_next(text); … _dp_prev(text); … _dp_map(text);` en tête (le fichier reste idempotent).

| Fonction | Rôle |
|---|---|
| `_dp_size(p_map text, p_players integer, p_wanted text)` | la règle du §1.1 (`p_wanted` = option de test) |
| `_dp_board(p_map text, p_size text)` · `_dp_next(…)` · `_dp_prev(…)` · `_dp_map(…)` | tracé et fiche de la taille ; taille absente, inconnue ou que le plateau n'a pas → `'s'` ; plateau inconnu → Grand Plateau (inchangé) |

**Fiche** `_dp_map(map, size)` = `EXTRA` / `EXTRA_M` / `EXTRA_L`. Les fiches S ne changent pas. Clés des grandes tailles :

```
"size":   "m" | "l"
"forks":  mode de chaque embranchement, dans l'ordre des cases (toggle | tide)
"stars":  [{"n": 0, "loges": [...]}, {"n": 1, "loges": [...]}, …]   zones d'étoiles ; n = 0 : la base, autant d'étoiles que
          greatest(2, star_count[joueurs − 2]) ; sinon n étoiles
"starts": [haltes de départ]                                          (taille L)
"banks":  [{"cells": [...], "wash_to": case, "end": n}, …]           (mer M / L ; end = n° de la dernière case du banc + 1 ; la fiche S garde
          bank / wash_to : le code lit banks et, à défaut, fabrique un banc unique {cells: bank, wash_to, end: 45})
"pack":   [{"name": "Rita", "start": 51, "path": [...]}, …]           (camping : les ratons en plus de Riton, ronde fermée)
"tp":     tous les téléporteurs de la taille                          (ski)
```

**State public** (miroir `types.ts`) : `size` ; `mech.pack = [{c, sack}, …]` au camping M (en plus de `riton` / `sack`, inchangés) ; le reste garde sa forme (`mech.tide`, `mech.pot`, `sw` avec un élément par embranchement).

**Fonctions modifiées** :

- `game_dede_party_start` : `v_size := _dp_size(…)` ; `state.size` ; `sw` : 0 ou 1 au hasard pour chaque embranchement `toggle`, `1 − tide` pour chaque `tide` ; **étoiles** : pour chaque zone de `stars`, `n` Loges tirées au sort hors bancs noyés (sans `stars` : règle actuelle) ; **positions** : sans `starts`, tout le monde en 0 ; avec `starts`, on mélange la liste, on garde `ceil(joueurs / 2)` haltes, le joueur de rang `k` dans `order` part de la halte `k mod nb` ; `dist` démarre à 0 pour tous ; `mech.pack` initial ; échéance du générique selon la taille (`intro_s` 8 · `intro_m` 10 · `intro_l` 12, nouvelles constantes).
- `_dp_walk` : le plateau et la fiche de `(map, size)` ; bonus de passage si la case atteinte en avant est de type `halt` (évènement `{t:'start', d, halt:true}`, même `_dp_coins(…, 'start')`) ; au camping, croisement testé pour Riton **et** chaque raton de `mech.pack`.
- `_dp_move_star(state, from)` : s'il y a des zones, tire la nouvelle Loge **dans la zone de `from`** ; Loges noyées = union des `cells` de `banks` à marée haute. S'il n'y a plus de Loge libre dans la zone : l'étoile reste où elle est (comportement actuel).
- `_dp_epilogue` : `mer` — met `sw` à `1 − tide` pour **chaque** embranchement `tide` (plus de `'[0]'` / `'[1]'` en dur), emporte les pions de **chaque** banc vers le `wash_to` de son banc (`dist += end − case`), fait déménager les étoiles des bancs ; les entrées de `washed` gagnent `to`. `camping` — après le dé de Riton, un dé par raton de `pack` (dans l'ordre : `forced_dice` des tests) ; chacun avance d'autant de cases sur son `path` (cyclique) ; `epi.pack = [{who, die, from, path, hits}, …]` en plus des champs actuels de Riton. Les ratons trottent **en même temps** : l'épilogue reste à 4 s.
- `_dp_riton_hit(state, pid, who integer)` : `who = 0` Riton (`mech.riton` / `mech.sack`), `who ≥ 1` le raton `pack[who − 1]` ; l'évènement porte `who`.
- `_dp_land`, `_dp_star_check`, `_dp_resolve` : seulement le passage de `(map, size)`.
- `_dp_tstats` : `size_no` (1, 2, 3) dans les stats de fin, à côté de `map_no`.

Aucune autre règle ne bouge : la Kermesse, Dédé 2000 et le Grand Plateau en grande taille ne demandent **que des données** (plus de cases `tombola`, plus d'entrées `tp`, plus d'embranchements).

### 1.5 Compatibilité et synchro

- Taille S : tableaux, fiches, règles et tests actuels **inchangés**.
- Synchro testée pour chaque couple (plateau, taille) : `CELLS_x / NEXT_x / PREV_x / EXTRA_x` de `boards/<id>.ts` = `_dp_board / _dp_next / _dp_prev / _dp_map(id, x)` (§7).
- Les contrôles de tracé deviennent : aucune case superposée ; toute liaison relie deux cases voisines **sauf les transports** (`JUMPS_x`) ; aucun transport entre cases voisines ; deux cases voisines sont toujours reliées (exceptions : les 2 du Grand Plateau d'origine, et les cases 13-14 de Dédé 2000 en M / L, §3.5) ; `PREV` inverse de `NEXT` ; tout est atteignable depuis le Départ et **toute case ramène au Départ** ; la taille du dessous est un préfixe.

---

## 2. Rythme et équilibre

### 2.1 Le problème, et les leviers retenus

Un pion fait 9 lancers d'environ 7 cases : **65 cases par partie**. Sur un anneau de 100 ou 200 cases, il ne verrait qu'un bout du plateau, ne repasserait jamais au Départ et croiserait une étoile par hasard.

| Levier | Retenu ? | Pourquoi |
|---|---|---|
| **Carrefour + détours** : le plateau de base est la place centrale, chaque quartier une boucle de 4 à 5 tours | oui | le tour reste court (36 à 75 cases par la base), tout le monde se recroise sur la base entre deux excursions |
| **Portes « un pion sur deux »**, habillées par plateau | oui | mécanique déjà connue (aiguillages), répartit les pions sans décision ; l'état de la porte se voit avant de lancer |
| **Une étoile par quartier**, qui reste dans son quartier | oui | +4 à +9 % d'étoiles et, en L, deux fois moins de joueurs sans étoile qu'avec des étoiles libres sur tout le plateau (§2.3) |
| **Départs répartis par deux** (L) | oui | sans eux, à 8 sur l'archipel, les îles du bout du tour reçoivent 1 à 2 visiteurs contre 4,4 pour la première, et le Pic n'est presque jamais atteint (0,2 fois par partie) |
| **Haltes à +5** (mer, ski) | oui | remplace le passage au Départ, devenu rare, et rend les départs répartis équitables (personne ne démarre « juste avant le Départ ») |
| Transports automatiques (bacs, navettes, télécabines, pistes, Grande Descente) | oui | ce sont les portes et les retours des quartiers ; ils brassent les pions |
| Dé supplémentaire, tours supplémentaires | **non** | 3 dés + Triple dé + carte « Bis » dépasseraient 24 pas (animation de 5 s) ; la soirée ne doit pas s'allonger parce qu'on est nombreux |
| Vitesse d'animation, durée de la phase de déplacement | inchangées | 2 + 5 s × joueurs (+ 4 s d'épilogue) |
| Choix de l'hôte « grand / petit » | non | une règle simple : la taille suit le nombre de joueurs |

### 2.2 Chiffres de simulation

`node tools/dede-party/grands-plateaux-sim.mjs 4000` — modèle JS simplifié des règles (mêmes constantes, 12 cartes, étoiles, cérémonie ; classement des mini-jeux tiré au sort, Triple dé joué au hasard, personne d'absent), 4 000 parties par ligne, 9 tours. La référence est **le plateau actuel au même nombre de joueurs** (ce qu'on jouerait sans ce lot). Valeurs définitives à mesurer avec la simulation SQL (§7).

**Étoiles par joueur** (bonus de cérémonie compris) :

| Plateau | 5 joueurs | 6 joueurs | 7 joueurs | 8 joueurs |
|---|---|---|---|---|
| Grand Plateau S (réf.) → **M** | 2,10 → **2,17** | 1,93 → **2,02** | 2,07 → **2,04** | 1,97 → **1,94** |
| Dédé-sur-Mer S → **M / L** | 2,05 → **2,26** (M) | 1,86 → **2,08** (M) | 1,99 → **1,98** (L) | 1,87 → **1,89** (L) |
| Kermesse S → **M** | 2,03 → **2,07** | 1,84 → **1,92** | 1,99 → **1,94** | 1,88 → **1,85** |
| Camping S → **M** | 2,21 → **2,10** | 2,03 → **1,95** | 2,15 → **1,95** | 2,04 → **1,85** |
| Dédé 2000 S → **M / L** | 2,00 → **2,15** (M) | 1,87 → **1,99** (M) | 1,99 → **2,01** (L) | 1,91 → **1,91** (L) |

Lecture : toutes les grandes tailles sont à **−9 % / +12 %** de leur propre plateau S, et à **−6 % / +8 %** du Grand Plateau S au même nombre de joueurs (l'objectif du lot précédent était ±10 % autour du Grand Plateau). Le plus généreux est Dédé-sur-Mer M (+10 à +12 % par rapport à sa taille S), le plus serré le Camping M à 7-8 joueurs (−9 %, mais son plateau S est le plus généreux des cinq).

**Vivre une vraie partie** :

| | Sans étoile en fin de partie | Vainqueur (étoiles) | Quartiers visités par joueur | Joueurs n'ayant vu aucun quartier | Visiteurs de chaque quartier, par partie | Pas max en un tour |
|---|---|---|---|---|---|---|
| Plateaux S à 5-6 joueurs (réf.) | 3 à 6 % | 3,1 à 3,4 | — | — | — | 24 |
| Plateaux S à 7-8 joueurs (réf.) | 1 à 3 % | 3,2 à 3,4 | — | — | — | 24 |
| Grand Plateau M (5 / 6 / 7 / 8 j.) | 2 / 3 / 2 / 2 % | 3,3 / 3,3 / 3,3 / 3,2 | 1,20 | 10 à 11 % | à 6 : 👗 4,2 · 🎛️ 3,0 | 23 |
| Dédé-sur-Mer M (5 / 6 j.) | 1 / 2 % | 3,4 / 3,3 | 1,30 | 5 à 7 % | à 6 : 🐦 4,1 · 🥥 3,7 | 24 |
| Dédé-sur-Mer L (7 / 8 j.) | 2 / 2 % | 3,3 / 3,2 | 2,12 | 0 % | à 8 : 🐦 3,3 · 🥥 3,6 · 🌋 3,4 · 🏴‍☠️ 3,3 · 🦀 3,4 | 22 |
| Kermesse M (5 / 6 / 7 / 8 j.) | 3 / 3 / 2 / 2 % | 3,3 / 3,2 / 3,3 / 3,2 | 1,20 | 8 à 10 % | à 6 : 👻 4,1 · 🎢 3,1 | 24 |
| Camping M (5 / 6 / 7 / 8 j.) | 3 / 4 / 4 / 4 % | 3,3 / 3,2 / 3,3 / 3,2 | 1,24 | 6 à 7 % | à 6 : 🍄 4,0 · 🦫 3,4 | 24 |
| Dédé 2000 M (5 / 6 j.) | 4 / 5 % | 3,4 / 3,2 | 1,10 | 2 % | à 6 : 🐐 3,3 · 🐄 3,2 | 22 |
| Dédé 2000 L (7 / 8 j.) | 2 / 3 % | 3,3 / 3,2 | 1,81 | 0 % | à 8 : 🐐 3,4 · 🐄 3,6 · 🧊 4,3 · 🦅 3,2 | 22 |

**Se croiser.** « Accompagné » = part des fins de tour où au moins un autre pion est dans la même zone que moi (la base, ou mon quartier), donc en concurrence pour la même étoile ; « rivaux » = nombre de joueurs différents avec qui j'ai partagé une zone pendant la partie. Sur un plateau S : 100 % et tous les autres. Tailles M : **accompagné 79 à 94 % des tours, 3,7 à 6,8 rivaux** (sur 4 à 7 possibles) : on croise presque tout le monde. Dédé-sur-Mer L : accompagné **65 % (7 j.) à 74 % (8 j.)**, 4,3 à 5,0 rivaux sur 6-7. Dédé 2000 L : **76 à 82 %**, 4,6 à 5,4 rivaux.

**Bonus de passage** (Départ + Haltes, par joueur et par partie ; S : 1,05 à 1,31) : Grand M 0,59 · Mer M 0,60 + 1,36 · Mer L 0,45 + 1,07 · Kermesse M 0,46 · Camping M 0,53 · Ski M 0,61 + 1,16 · Ski L 0,73 + 0,70. Les trois plateaux sans Haltes compensent par des quartiers plus doux (plus d'Applaudissements, moins de Pubs) ; « Fauché » ne bouge pas (3 à 13 % contre 4 à 15 %).

**Mécaniques signatures** (par joueur et par partie, sauf mention) :

| | Plateau S | Grande taille |
|---|---|---|
| 🌊 Pions emportés par la marée | 0,77 | M 0,55 · L 0,50 (2,8 à 4,0 pions emportés par partie, sur 2 puis 4 bancs) |
| 🎟️ Péages de Tombola | 2,78 | M 2,35 ; 1,9 à 3,1 gros lots par partie, 15 à 17 pièces en moyenne, records 50 à 77 |
| 🦝 Croisements d'un raton | 2,86 | M **2,91** (trois ratons ; avec deux : 1,95) |
| 🚡 Télésièges · 🧊 glissades | 1,11 · 0,45 | M 0,87 · 0,37 — L 0,81 · 0,38 ; **Grande Descente du Pic : 2,1 à 2,4 fois par partie** |

**Autres durées** (6 joueurs en M, 8 en L ; S → grande taille) : 6 tours 1,31-1,44 → 1,34-1,49 étoile par joueur (sans étoile 8-17 % → 9-14 %) ; 12 tours 2,38-2,64 → 2,44-2,67. **Écart de niveau** (le meilleur joueur aux mini-jeux / le moins bon) : 3,1-3,4 / 1,25-1,38 en S → 3,2-3,45 / 1,33-1,45 en grande taille : inchangé.

### 2.3 Ce que les leviers apportent (variantes simulées)

| Variante (8 joueurs en L, 6 en M) | Effet |
|---|---|
| Mer L, **départ commun** au Départ | visiteurs par île : 4,4 · 4,3 · 3,5 · 2,0 · **1,0** (contre 3,3 à 3,6 partout) |
| Ski L, **départ commun** | Glacier 2,1 et Crête des Aigles 1,8 visiteurs ; Grande Descente du Pic **0,2** fois par partie (contre 2,4) ; 2 % des joueurs ne voient jamais la montagne |
| **Étoiles libres** (pas de zones), même nombre d'étoiles | Mer M 2,08 → 1,98 ; Mer L 1,89 → 1,79 (sans étoile 2 % → 5 %) ; Ski M 1,99 → 1,90 ; Ski L 1,91 → 1,76 (sans étoile 3 % → 6 %) ; Camping M 1,95 → 1,87 |
| Camping M, **deux ratons** au lieu de trois | croisements par joueur 2,91 → 1,95 |

**Leviers de réglage** si la simulation SQL s'écarte : `n` d'une zone d'étoiles (fiche) ; type d'une case de quartier (une Pub ↔ un Applaudissement : motifs `MIX_ILE` / `MIX_CAMP` du simulateur) ; longueur d'un banc ; aucune constante de `_dp_const()` à toucher.

---

## 3. Les plateaux

Lecture des plans (annexe A) : D Départ · A Applaudissements · P Pub · E Enveloppe · L Loge · T Tombola · M télésiège (monte) · G verglas (glisse) · H Halte. Coordonnées = (colonne ; ligne) du repère commun. « Fermé » = ce qu'on voit du quartier quand la taille ne l'ouvre pas.

### 3.1 🎤 Le Grand Plateau — M : « Les Studios Dédé » (100 cases, 19 × 15)

Le plateau de l'émission s'étend côté jardin et devant la scène. Deux aiguillages de plus : 4 en tout, **tous `toggle`**.

| Quartier | Cases | Porte → retour | Ambiance et décor | Composition |
|---|---|---|---|---|
| 👗 **Les Coulisses** (à gauche ; anneau col −7 à −2, lig 0 à 8) | 47-72 (26) | aiguillage en **4** (0 ; 5) → 47 (−1 ; 5) … 72 (−1 ; 2) → retour en **7** (0 ; 2) ; saute 5-6 | L'envers du décor, lumière chaude, parquet `#C9A27A`. Trois portes de loge à étoile dorée en (−4,5 ; 1,5) (−4,5 ; 4) (−4,5 ; 6,5), portant à costumes (2 poteaux, 6 plans colorés) en (−5,5 ; 3), miroir à ampoules en (−3,5 ; 5,2), flight-cases empilés en (−5,8 ; 6,8). Quand un pion entre : les ampoules du miroir courent en chenillard, étiquette « 🤫 Silence, on tourne ! ». | 16 A · 4 L · 4 E · 2 P : le quartier doux |
| 🎛️ **La Régie** (devant ; anneau col 1 à 11, lig 10 à 14) | 73-99 (27) | aiguillage en **28** (9 ; 8) → 73 (9 ; 9) … 99 (5 ; 9) → retour en **32** (5 ; 8) ; saute 29-31 | Salle de contrôle, sol bleu nuit `#1F2A5C`. Mur de 12 écrans (plans émissifs) en (6 ; 12) qui affichent l'émoji du dernier évènement (⭐ 📺 ✉️), console de mixage à boutons (instanciés) en (6 ; 13), deux caméras sur pied en (2,5 ; 11,5) et (9,5 ; 11,5), câbles au sol. | 10 A · 7 E · 6 P · 4 L : « ça zappe » |

- `forks` (ordre de `sw`) : 4 `['Tout droit', 'Les Coulisses']` 👗 · 13 La Scène · 22 Le Tunnel de la pub · 28 `['Tout droit', 'La Régie']` 🎛️. Le Départ → case 4 en un lancer : la moitié des pions part en coulisses dès le premier tour.
- Étoiles : base (Loges 3, 7, 11, 17, 20, 27, 30, 33, 38) 2 ou 3 ; Coulisses (49, 55, 61, 67) 1 ; Régie (77, 83, 89, 95) 1.
- Gradins et rideaux : inchangés (fond et droite du plateau de base) ; les quartiers occupent la gauche et le devant.
- **Fermé** (2-4 joueurs) : un rideau latéral tiré le long de la colonne −1, un rai de lumière chaude dessous, plaque « 🔒 Les Coulisses · à 5 joueurs » ; devant la scène, une baie vitrée sombre derrière laquelle clignotent les écrans de la Régie, plaque « 🔒 La Régie · à 5 joueurs ».
- Tour : 36 cases sans détour, 92 par les quatre détours.

### 3.2 🏖️ Dédé-sur-Mer — M : « Les Îles » (100 cases, 20 × 15) · L : « L'Archipel » (201 cases, 31 × 20)

Le plateau actuel devient **la Grande Île** (la baie, le Banc de sable, le Phare) ; la mer l'entoure, et des îles sortent de la brume. On y va en **bac**, on en revient en **navette**.

| Île | Taille | Cases | Bac (porte) → ponton → retour | Banc de sable (marée) |
|---|---|---|---|---|
| 🐦 **L'Île aux Mouettes** (ouest ; anneau col −9 à −3, lig −4 à 2) | M | 45-67 + banc 68-72 (28) | bac en **4** (0 ; 4) → Halte 45 (−3 ; 0) … 67 (−3 ; −2) → navette vers **8** (0 ; 0) | **La Langue des Mouettes** : embranchement 49 (−5 ; 2) → `[50, 68]`, banc 68-72, retour en 51 |
| 🥥 **L'Île Coco** (nord ; anneau col 0 à 10, lig −6 à −2) | M | 73-99 (27) | bac en **9** (1 ; 0) → Halte 73 (2 ; −2) … 99 (4 ; −2) → navette vers **11** (3 ; 0) | — |
| 🌋 **Le Piton Fumant** (est, en haut ; anneau col 12 à 20, lig −6 à 2) | L | 100-130 (31) | bac en **20** (10 ; 2) → Halte 100 (12 ; 1) … 130 (12 ; −1) → navette vers **22** (10 ; 4) | — |
| 🏴‍☠️ **La Crique des Pirates** (est, en bas ; anneau col 12 à 20, lig 6 à 13) | L | 131-159 + banc 160-166 (36) | bac en **26** (10 ; 8) → Halte 131 (12 ; 8) … 159 (12 ; 10) → navette vers **28** (8 ; 8) | **Le Gué du Trésor** : embranchement 143 (20 ; 8) → `[144, 160]`, banc 160-166 dans la crique, retour en 145 |
| 🦀 **L'Îlot des Crabes** (ouest, en bas ; anneau col −10 à −3, lig 6 à 13) | L | 167-193 + banc 194-200 (34) | bac en **31** (5 ; 8) → Halte 167 (−3 ; 8) … 193 (−3 ; 10) → navette vers **33** (3 ; 8) | **Le Gué des Crabes** : embranchement 178 (−10 ; 8) → `[179, 194]`, banc 194-200 dans le lagon, retour en 180 |

Chaque île est un anneau ouvert (un « C ») : on débarque à un bout, on fait le tour de l'île, on rembarque à l'autre bout, une case d'eau plus loin.

**Le bac** (embranchement `toggle`, `look: 'boat'`). Chaque île a un bac qui fait la navette entre l'embarcadère et le ponton de l'île. `sw = 1` : **le bac est à quai** → le prochain pion qui passe l'embarcadère monte à bord, traverse (1 pas), débarque sur la Halte (+5) et continue sa marche sur l'île ; le bac reste à l'île (`sw = 0`). `sw = 0` : **le bac est en mer** → le pion suivant continue sur la Grande Île, et le bac revient à quai. C'est l'aiguillage du Grand Plateau, en bateau. **La navette du retour**, elle, est toujours là : au bout de l'île, tout pion embarque et revient sur la Grande Île, quelques cases après son embarcadère.

**La Grande Marée sur plusieurs bancs.** Une seule marée, une seule horloge (cycle inchangé : 2 tours basse, 1 tour haute, phase de départ tirée au sort) : elle commande **tous les bancs à la fois** — le Banc de sable du Phare, plus 1 banc en M, 3 en L. À marée basse, tout pion qui arrive à l'embranchement d'un banc le prend ; quand la mer monte, **chaque banc** dépose ses traînards au bout de son banc (−5 pièces) et l'étoile d'une Loge de banc déménage (Loges de banc : 40 du Phare, 70 « des Mouettes », 163 « du Trésor », 199 « des Crabes »). Aucun banc n'a de Pub ; « tout droit » ne fait qu'une case. Puce : « 🌊 Marée basse · elle monte dans 2 tours · 4 bancs ouverts ».

**Départs répartis (L).** Au générique, « le Grand Embarquement » : les joueurs sont déposés par deux sur les pontons de **4 îles tirées au sort parmi les 5** (`starts = [45, 73, 100, 131, 167]`). La partie se joue en trois actes : son île (avec son voisin de ponton), la Grande Île où tout le monde se retrouve vers les tours 4 à 6, puis une seconde île ou la course autour de la baie.

**Ambiance et décor des îles** (primitives ; chaque île repose sur un socle de sable arrondi, `InstancedMesh` pour tout ce qui se répète) :

- 🐦 **L'Île aux Mouettes** — village de pêcheurs : 4 maisons blanches à toits colorés en (−7 ; −2,5) (−5,5 ; −2,5) (−7 ; −0,5) (−5 ; 0), casiers et filets, 8 mouettes (deux triangles) qui tournent à 3 de haut au-dessus de (−6 ; −1) et plongent quand un pion débarque. Ruban `#FFF6E5`.
- 🥥 **L'Île Coco** — îlot tout en longueur : 7 cocotiers le long de la ligne −4, une paillote (cylindre + cône de chaume) en (5 ; −4), deux hamacs en (2,5 ; −4) et (7,5 ; −4). Une noix de coco tombe (« toc ! ») quand un pion s'arrête sur l'île. Ruban `#FFE9B0`.
- 🌋 **Le Piton Fumant** — sable noir `#6B5B53`, cône `#5B4B49` (rayon 2,6 cases, hauteur 3,2) en (16 ; −2), cratère orange émissif, un rond de fumée par seconde ; il « tousse » (gros rond de fumée, petite secousse) à chaque changement de marée. La nuit, la lave pulse.
- 🏴‍☠️ **La Crique des Pirates** — l'île entoure une crique (eau col 13 à 19, lig 7 à 12) : épave penchée (coque, mât, voile déchirée, pavillon 🏴‍☠️) en (15 ; 11), coffre ouvert qui scintille en (14 ; 8,5). Le Gué du Trésor traverse la crique.
- 🦀 **L'Îlot des Crabes** — rochers gris, lagon intérieur, 6 crabes (sphère rouge aplatie, deux pinces) qui marchent de côté le long du lagon et se cachent quand la mer monte.
- **Bacs et navettes** : coque + cabine + cheminée rayée rouge et blanc, un bac et une navette par île (10 bateaux en L, 2 `InstancedMesh`) ; lignes de bouées pointillées entre embarcadère et ponton.
- **Fermé** : l'île est là, pâle et sans cases, sous une **brume de mer** (3 sprites de nuage qui dérivent, socle et repère à 35 % d'opacité) ; une bouée porte « 🔒 À 5 joueurs » ou « 🔒 À 7 joueurs » ; le bac est amarré, bâché.
- Autour de la Grande Île, le sol devient la mer (plan d'eau étendu à toute l'emprise, il suit la marée) ; le tapis actuel = le sable de la Grande Île.

`forks` en L, dans l'ordre : 4 bac des Mouettes · 9 bac Coco · 12 Banc de sable (`tide`) · 20 bac du Piton · 26 bac des Pirates · 31 bac des Crabes · 49 Langue des Mouettes (`tide`) · 143 Gué du Trésor (`tide`) · 178 Gué des Crabes (`tide`). En M : 4, 9, 12, 49.
Étoiles : Grande Île 2 ou 3 ; **une par île** (7 ou 8 Loges par île). Total : 4 en M, **8 en L**.
`cellNames` : 45 Ponton des Mouettes · 73 Ponton Coco · 100 Ponton du Piton · 131 Ponton des Pirates · 167 Ponton des Crabes · 70 La Loge des Mouettes · 163 La Loge du Trésor · 199 La Loge des Crabes.
Tour : 36 cases sans île (marée haute), 94 (M) ou 190 (L) en les prenant toutes.

### 3.3 🎪 La Kermesse — M : « La Grande Kermesse » (100 cases, 23 × 14)

La fête foraine s'agrandit de deux attractions. On y entre par un **tourniquet** (`toggle`, `look: 'turnstile'`) : il laisse passer un pion, se bloque pour le suivant, et ainsi de suite.

| Quartier | Cases | Porte → retour | Ambiance et décor | Guichet |
|---|---|---|---|---|
| 👻 **Le Train Fantôme** (à gauche ; anneau col −9 à −2, lig −1 à 7) | 40-70 (31) | tourniquet en **3** (0 ; 3) → 40 (−1 ; 3) … 70 (−1 ; 1) → retour en **5** (0 ; 1) ; saute 4 | Manoir violet de guingois (boîte 3 × 2,5 cases, toit tordu) en (−5,5 ; 2,5) avec une entrée en forme de bouche ; rails ovales et petit train de 3 wagons qui tourne ; 5 fantômes-draps (cône blanc, deux points noirs) qui montent et descendent derrière des panneaux ; toiles d'araignée, lampions orange. Effrayant pour rire : le fantôme le plus proche fait « Bouh ! » quand un pion s'arrête dans le quartier. | case **55** (−9 ; 4) |
| 🎢 **Le Grand Huit** (devant, à droite ; anneau col 3 à 13, lig 8 à 12) | 71-99 (29) | tourniquet en **26** (10 ; 6) → 71 (10 ; 7) … 99 (8 ; 7) → retour en **28** (8 ; 6) ; saute 27 | Un rail sur pylônes qui ondule (3 bosses, 1 looping) au-dessus de l'intérieur de l'anneau ; un train de 4 wagons le parcourt en continu (il ralentit en haut des bosses), petits passagers bras levés ; guérite à tickets. Sur la télé : « Aaaah ! » au looping. | case **85** (7 ; 12) |

**La Tombola à 4 guichets.** Toujours **une seule cagnotte** (mise de départ 5, péage 3, gros lot à l'arrêt pile, mêmes règles) : les deux cases du stand central (13, 33) et un **guichet** dans chaque attraction (55, 85). Chaque guichet affiche la même plaque « 🎟️ 14 ». Aucune modification du moteur (4 cases `tombola`). Puce : « 🎟️ Cagnotte : 14 🪙 · 4 guichets ».
Étoiles : base 2 ou 3 ; Train Fantôme (Loges 42, 47, 54, 59, 66) 1 ; Grand Huit (73, 78, 90, 97) 1.
`forks` : 3 `['Tout droit', 'Le Train Fantôme']` 👻 · 26 `['Tout droit', 'Le Grand Huit']` 🎢.
**Fermé** : une palissade de chantier rayée orange et blanc le long du plateau, pancarte « 🔒 Ouverture à 5 joueurs », le manoir et le rail sous des bâches gris-bleu, ampoules éteintes ; le tourniquet est cadenassé.
Tour : 40 cases sans détour, 98 par les deux.

### 3.4 🏕️ Le Camping — M : « Le Grand Camping » (100 cases, 20 × 17)

Deux sentiers de randonnée partent du bout des branches ouest et nord de la croix. On y entre par une **barrière levante** (`toggle`, `look: 'gate'`) : levée, elle laisse passer un campeur et retombe ; baissée, le suivant continue et elle se relève.

| Quartier | Cases | Porte → retour | Ambiance et décor | Composition |
|---|---|---|---|---|
| 🍄 **Le Sous-bois aux Champignons** (ouest ; anneau col −9 à −2, lig 0 à 8) | 36-66 (31) | barrière en **7** (0 ; 5) → 36 (−1 ; 5) … 66 (−1 ; 3) → retour en **9** (0 ; 3) ; saute 8 | Forêt serrée (20 pins penchés instanciés, plus sombres), 6 champignons géants à chapeau rouge à pois (le plus grand, 1,8 de haut, en (−5,5 ; 4)), tronc creux, lucioles la nuit. La souche-terrier de Rita en (−6 ; 2). | 18 A · 5 L · 5 E · 3 P |
| 🦫 **La Rivière aux Castors** (nord ; anneau col 0 à 10, lig −8 à −2) | 67-99 (33) | barrière en **16** (4 ; 0) → 67 (4 ; −1) … 99 (6 ; −1) → retour en **18** (6 ; 0) ; saute 17 | Une rivière (plan bleu sinueux) de (1 ; −6) à (9 ; −4), barrage de rondins en (5 ; −5), un castor qui tape de la queue, roseaux, canoë. La cabane de Ritou près du barrage. | 19 A · 6 L · 5 E · 3 P |

**La famille Raton.** Riton garde son camp ; chaque sentier a **son propre raton** : **Rita** dans le Sous-bois, **Ritou** (le petit) à la Rivière. Mêmes règles pour les trois, chacun **son sac** : sac vide, il pique 5 pièces au pion croisé ; sac plein, il lâche tout. À la fin de chaque tour, chacun lance 1 dé et fait sa ronde **en même temps** (épilogue toujours de 4 s) :

- Riton : comme aujourd'hui, à contresens sur la croix (il ne quitte jamais le camp : `PREV` reste sur la base).
- Rita : ronde fermée dans le Sous-bois, à contresens — `path` = cases 66, 65, … 36 puis de nouveau 66 (elle saute la barrière entre 36 et 66) ; départ en 51 (−9 ; 4).
- Ritou : ronde fermée à la Rivière — `path` = 99, 98, … 67 puis 99 ; départ en 83 (5 ; −8).

Les trois rondes ne se touchent pas : un pion ne peut être croisé que par le raton de la zone où il se trouve. Puce : le raton **de ma zone** d'abord (« 🦝 Rita : sac plein, 5 🪙 ! »), les deux autres en petit. Rita porte un foulard rose, Ritou est un demi-format (échelle 0,7) : mêmes sprite et sac que Riton, teintés.
Étoiles : base 2 ou 3 ; Sous-bois (Loges 38, 43, 50, 55, 62) 1 ; Rivière (69, 74, 81, 86, 93, 98) 1.
`forks` : 7 `['Le camp', 'Le Sous-bois']` 🍄 · 16 `['Le camp', 'La Rivière']` 🦫.
**Fermé** : barrière baissée, panneau de bois « Sentier fermé · à 5 joueurs », la forêt dans une brume sombre ; deux yeux de chouette clignent dans le noir.
Tour : 36 cases sans détour, 98 par les deux.

### 3.5 ⛷️ Dédé 2000 — M : « Dédé 2500 » (105 cases, 29 × 13) · L : « Dédé 3000 » (204 cases, 29 × 21)

Derrière la Station (le plateau actuel, inchangé, avec son escargot et sa Grande Luge) se dresse **la grande montagne**. Les lignes de cases y sont des **lacets** horizontaux, un toutes les deux lignes de grille, de plus en plus haut : ligne −2, −4 (Dédé 2500), puis −6, −8, −10, −12 (Dédé 3000). **On monte à pied, on redescend en glissant** — comme sur l'escargot.

| Secteur | Taille | Cases | Entrée | Sortie |
|---|---|---|---|---|
| 🐐 **La Combe aux Chamois** (bas, ouest) : lacet −2 de (4 ; −2) à (−9 ; −2), lacet −4 de (−9 ; −4) à (3 ; −4) | M | 49-76 (28) | **télécabine des Chamois** en **11** (3 ; 0), une cabine sur deux → Halte 49 | M : au bout (76), **la piste des Chamois** ramène en **14** (6 ; 0). L : une fois sur deux la piste, une fois sur deux la **télécabine du Glacier** → 105 |
| 🐄 **Les Alpages** (bas, est) : lacet −2 de (6 ; −2) à (19 ; −2), lacet −4 de (19 ; −4) à (7 ; −4) | M | 77-104 (28) | **télécabine des Alpages** en **13** (5 ; 0) : passage obligé → Halte 77 | M : au bout (104), **la piste des Alpages** ramène en **18** (10 ; 0). L : piste, ou **télécabine des Aigles** → 155 |
| 🧊 **Le Glacier** (haut, ouest) : lacets −6, −8, −10, puis l'arête ouest (ligne −12) jusqu'au Pic | L | 105-154 (50) | télécabine du Glacier → Halte 105 (4 ; −6) | au bout du 2e lacet (130), une fois sur deux **la piste rouge du Glacier** ramène en **20** (10 ; 2) ; sinon l'arête, jusqu'à **154, la Loge du Pic** (5 ; −12) |
| 🦅 **La Crête des Aigles** (haut, est) : symétrique ; l'arête est rejoint le Pic | L | 155-203 (49) | télécabine des Aigles → Halte 155 (6 ; −6) | en 180, une fois sur deux **la piste rouge des Aigles** ramène en **24** (10 ; 6) ; sinon l'arête : 203 → **154** |
| 🚩 **Le Pic du Dédé** (5 ; −12), case 154 | L | — | les deux arêtes y mènent | **La Grande Descente** : 154 → **Départ** (0), +5 pièces |

**Dédé 2500 se partage en deux** (M et L). En 11, la télécabine des Chamois emmène **un pion sur deux** ; celui qui reste marche jusqu'en 13 où la télécabine des Alpages emmène **tout le monde**. Chacun traverse donc **exactement un** des deux secteurs à chaque tour de piste, et les deux sont aussi fréquentés l'un que l'autre. Conséquences sur le plateau de base en M / L : `NEXT[13] = 77` (au lieu de 14) ; la case 14 ne se rejoint plus que par la piste des Chamois (`PREV[14] = 76`) ; **pas de ruban entre 13 et 14** : la gare des Alpages est posée entre les deux cases. Les cases 12-13 sont sur la voie des Alpages, 14-17 sur celle des Chamois ; les deux voies font 73 et 75 cases de tour.

**Télésièges et verglas** (inchangés : s'arrêter pile ; un lacet plus haut ou plus bas, case juste au-dessus ou au-dessous) :

| Secteur | 🚡 Télésièges (case → arrivée, cases gagnées) | 🧊 Verglas (case → arrivée, cases perdues) |
|---|---|---|
| Station (inchangé) | 3 → 37 · 6 → 40 · 12 → 42 · 15 → 45 · 21 → 47 | 36 → 2 · 43 → 13 · 46 → 20 |
| Combe aux Chamois | **55 → 71** des Chamois (+16) · **60 → 66** téléski du Virage (+6) | **68 → 58** de la Combe (−10) |
| Alpages | **83 → 99** des Alpages (+16) · **88 → 94** téléski de la Bergerie (+6) | **96 → 86** des Alpages (−10) |
| Glacier | **109 → 127** du Glacier (+18) · **114 → 122** téléski des Séracs (+8) · **125 → 137** des Crevasses (+12) · **133 → 151** de l'Arête Ouest (+18) | **139 → 123** du Glacier (−16) · **149 → 135** de l'Arête (−14, si près du but !) |
| Crête des Aigles | **159 → 177** des Aigles (+18) · **164 → 172** téléski du Nid (+8) · **175 → 187** des Corniches (+12) · **183 → 201** de l'Arête Est (+18) | **189 → 173** des Aigles (−16) · **199 → 185** du Vertige (−14) |

Total : 8 téléporteurs en S, **14 en M, 26 en L**. Toutes les arrivées sont des Applaudissements.

**Embranchements** (`sw`, tous `toggle`) — M : 11 `['La Vallée', 'Télécabine des Chamois']` (`look: 'cabin'`). L : 11 · 76 `['Piste des Chamois', 'Télécabine du Glacier']` · 104 `['Piste des Alpages', 'Télécabine des Aigles']` · 130 `['L’arête', 'Piste rouge du Glacier']` (`look: 'piste'`) · 180 `['L’arête', 'Piste rouge des Aigles']`.
**Transports** : Grande Luge 48 → 0 (inchangée) ; télécabines 11 → 49, 13 → 77, 76 → 105, 104 → 155 (`cabin`) ; pistes 76 → 14, 104 → 18, 130 → 20, 180 → 24 (`slide`) ; Grande Descente 154 → 0 (`luge`).
**Départs répartis (L)** : par deux dans les 4 gares, `starts = [49, 77, 105, 155]` (« Gare des Chamois », « des Alpages », « du Glacier », « des Aigles »). Personne ne part de la Station : elle se remplit à mesure que les pistes y ramènent du monde (dès le tour 4), puis la Grande Descente y précipite ceux du Pic vers les tours 7 à 9 — le final de la partie.
**Étoiles** : Station 2 ou 3 ; Combe 1 (Loges 51, 56, 63, 75) ; Alpages 1 (79, 84, 91, 103) ; Glacier **2** (107, 112, 119, 124, 131, 136, 143, 148, 154) ; Crête des Aigles **2** (157, 162, 169, 174, 181, 186, 193, 198). Total : 4 en M, **9 en L**. La Loge du Pic (154) fait partie de la zone du Glacier.
Zones : la Vallée, les Pistes et le Sommet de la Station gardent leur nom (le Sommet reste « le sommet de la Station ») ; le vrai toit du domaine est le Pic.

**La montagne (décor).**

- **Relief** (rendu seulement, `alt`) : la Station reste à plat (0). Chaque lacet est posé sur une terrasse de neige : ligne −2 à +0,6 unité · −4 à +1,2 · −6 à +1,9 · −8 à +2,6 · −10 à +3,3 · −12 à +4,0 ; les cases de raccord (lignes impaires) à mi-hauteur. Une seule surface de neige (plan subdivisé 60 × 30, hauteurs lissées, pente concentrée dans les couloirs entre lacets, bruit doux sur les flancs) va de la ligne −1 à la ligne −13 ; derrière la case 154, le **Pic** (cône blanc à arêtes bleutées, +3 unités, drapeau rouge 🚩). Avec la caméra actuelle (53° d'élévation) et 2,6 unités entre deux lacets, une marche de 0,7 ne cache rien du lacet de derrière.
- **Palette** : ruban `#CDE7BE` (Vallée, inchangé), `#BFE3FF` (Dédé 2500), `#FFFFFF` (Dédé 3000) ; le Glacier a des plaques de glace bleue translucide et des crevasses (boîtes sombres étroites), la Crête des Aigles des rochers sombres et 3 aigles qui planent en cercle ; la Combe : 4 chamois (boîtes + cornes) sur un rocher ; les Alpages : chalet d'alpage, 5 vaches à cloche, barrières.
- **Télécabines** : deux gares (boîte + toit), câble sur 3 pylônes, une cabine (boîte arrondie rouge). `sw = 1` : la cabine attend en bas ; `sw = 0` : elle est en haut et redescend au passage du pion suivant. Pistes rouges : un portique à panneau vert « ouverte » / rouge « fermée ».
- **Les skieurs** (décor permanent, aucun effet de jeu) — demandés « pendant toute la partie » :
  - **Pistes** (polylignes en coordonnées de grille, du haut vers le bas) : **le Grand Couloir**, tout droit au milieu, de (5 ; −11) à (5 ; −1) — la colonne 5 est libre de cases de la ligne −11 à la ligne −1 ; **la piste du flanc ouest** de (−9,5 ; −9) à (−10,5 ; −5) puis (−10,5 ; −1) ; **la piste du flanc est** de (19,5 ; −9) à (20,5 ; −5) puis (20,5 ; −1), toutes deux à l'extérieur des lacets ; deux **pistes à bosses**, à l'aplomb des colonnes −3,5 et 13,5, de la ligne −11 à la ligne −1 : elles franchissent chaque lacet **d'un saut** par-dessus le ruban, entre deux cases (cloche de 0,8 de haut, 0,5 s, petit nuage de neige à la réception). En M, les pistes partent de la ligne −5. En S, la montagne est fermée mais **8 skieurs descendent quand même** le Grand Couloir et le flanc ouest : c'est l'aperçu.
  - **Nombre** : 8 en S · 16 en M · 32 en L sur la télé ; 8 · 12 · 16 au téléphone. La moitié sur le Grand Couloir.
  - **Comportement** : chaque skieur suit sa piste à 2,2 à 3,4 unités/s, en slalom (écart latéral `0,35 × sin`), penché dans les virages ; en bas il freine dans une gerbe de neige, rétrécit et disparaît derrière le chalet, puis repart d'en haut après 0,5 à 3 s — les départs sont décalés pour qu'il y en ait toujours au moins 60 % à l'écran. Un sur 12 est un snowboardeur (slalom plus large) ; sur la télé, un sur 30 tombe, roule en boule une seconde et repart. Ils ne s'arrêtent jamais sur une case et ne gênent aucun pion.
  - **Maillage** : corps (capsule), tête + bonnet (sphère, cône), skis (2 boîtes fines) : 3 `InstancedMesh`, couleurs de veste par instance (palette des confettis) ; échelle 0,55 d'un pion. 3 appels de dessin pour tous les skieurs.
- **Gradins** : en M / L, le gradin du fond disparaît (la montagne le remplace) ; le public reste à droite.
- **Fermé** : en S, la pente est là, nue (ni cases ni ruban), sa partie haute dans les nuages ; panneaux « 🔒 Dédé 2500 · à 5 joueurs » au pied et « 🔒 Dédé 3000 · à 7 joueurs » plus haut, cabines à l'arrêt en gare. En M, les nuages descendent jusqu'à la ligne −5 et cachent Dédé 3000.

---

## 4. Rendu et lisibilité

### 4.1 Emprise et échelle

| Taille | Emprise (cases) | Largeur d'une case en vue d'ensemble, télé 1080p | Idem, téléphone (zone 3D ≈ 390 × 488 px) |
|---|---|---|---|
| S | 11 × 9 | ≈ 100 px | ≈ 43 px |
| M | 19 × 15 à 29 × 13 | 63 à 77 px | 17 à 26 px |
| L | 31 × 20 · 29 × 21 | 51 à 54 px | 16 à 17 px |

Sur la télé, la vue d'ensemble reste lisible à toutes les tailles (couleur et émoji des cases). Au téléphone, en M et surtout en L, la vue d'ensemble est une **carte postale** : la lecture se fait par la caméra qui suit, la vue perso et la mini-carte. Le pas de grille de la scène (`S = 1,3`) et la taille des pions ne changent pas : les pions ne rapetissent jamais, c'est la caméra qui recule.
En portrait, la scène pivote d'un quart de tour quand l'emprise est plus large que haute (comme aujourd'hui) : c'est le cas des 7 grandes emprises. Sur Dédé 2000, la montagne se présente alors de profil (le Pic à gauche, la Station à droite).

### 4.2 Caméra

- **Vue d'ensemble** : `fitDistance` cadre l'emprise des cases **ouvertes** (+ 1,25 de marge) ; borne haute de la recherche portée de 90 à 200, plan lointain de la caméra de 140 à 320, sol étendu à `max(60, 1,6 × demi-diagonale)`, brouillard recalé sur la nouvelle distance. Les quartiers fermés sont hors cadre ou en bord de cadre, dans leur voile.
- **Suivi d'un pion** : distance bornée comme aujourd'hui (`clamp(…, 11, 26)`) → sur un grand plateau on voit une fenêtre d'environ 12 × 9 cases autour du pion, **comme si l'on jouait sur un plateau de base**. La cible n'est plus tirée vers le centre du plateau mais vers **le centre de la zone du pion** (25 %) : l'île entière reste dans le champ.
- **Plan de traversée** : quand le pion prend un transport, la caméra recule pour cadrer le départ et l'arrivée (`clamp(1,1 × distance, 26, vue d'ensemble)`), vise le milieu, puis resserre à l'arrivée. Durée d'un transport = **3 pas** : `unité = clamp(3300 / (pas + 2 × transports), 115, 300)` ms (remplace `stepMs`) ; au pire (24 pas dont 2 transports) la marche tient toujours dans 3,3 s.
- **Vue perso (téléphone, tailles M et L, phase de lancer)** : au lieu de la vue d'ensemble, la caméra cadre **mon pion** (distance 20, cible 3 cases devant lui sur sa route) ; les 12 prochaines cases de mon trajet probable (selon l'état actuel des portes) portent un liseré clair. Un bouton « 🗺️ » en haut à droite de la scène bascule vers la vue d'ensemble / la mini-carte et revient. Spectateur ou télé : vue d'ensemble. `SceneOptions` gagne `focusId?: string`.
- **Générique** (M 10 s, L 12 s) : vue d'ensemble, puis survol de chaque quartier ouvert (0,9 à 1,2 s chacun) pendant que son voile se lève et que sa plaque s'affiche (« 🥥 L'Île Coco ») ; en L, les pions sont déposés par deux sur leurs Haltes.
- **Épilogues** : marée — télé en vue d'ensemble (tous les bancs montent ensemble) ; téléphone sur mon pion s'il est emporté, sinon sur le banc le plus proche de moi. Ratons — télé en vue d'ensemble, trois dés au-dessus des trois ratons ; téléphone sur le raton de ma zone.

### 4.3 Mini-carte

Composant `MiniMap` (SVG, dérivé de `BoardThumb`) : une pastille par case (couleur du type), transports en pointillés, nom et émoji de chaque zone, têtes des pions, ⭐ sur les Loges étoilées, marqueurs de mécanique (bancs voilés de bleu à marée haute, 🦝 de chaque raton, 🎟️ aux guichets), quartiers fermés en gris hachuré avec 🔒.

- Télé, taille L : en permanence dans le coin bas-gauche (≈ 300 × 190 px), un cadre blanc montre ce que filme la caméra. Taille M : seulement pendant les déplacements.
- Téléphone, tailles M et L : derrière le bouton « 🗺️ » (plein cadre de la scène) et dans l'aide « Les cases ». Taille S : pas de mini-carte.

### 4.4 Portes, transports et quartiers fermés

- Chaque embranchement garde son panneau fléché (voie ouverte allumée) ; `look` lui ajoute son véhicule : bac amarré d'un côté ou de l'autre, cabine en bas ou en haut, bras de tourniquet, barrière levée ou baissée, portique vert ou rouge.
- Transport d'un pion : il monte dans le véhicule, qui fait le trajet avec lui (bac sur l'eau avec sillage, cabine le long du câble, glissade sur la piste avec traînée de neige) ; étiquette « ⛴️ En bac ! », « 🚠 Télécabine ! », « ⛷️ Piste ! », « 🚩 Grande Descente ! ».
- Quartier fermé = un groupe « silhouette » (6 maillages au plus, pas de cases ni de ruban), son voile (brume, rideau, palissade, nuages) et une plaque « 🔒 … ». Aucun élément animé coûteux derrière le voile.

### 4.5 Repli 2D (`GameBoard`)

- Taille S : inchangé.
- Tailles M et L au téléphone : **une fenêtre et une mini-carte**. La fenêtre a le format d'aujourd'hui (9 colonnes × 11 lignes en portrait, cases de ≈ 43 px) ; elle glisse (transformation CSS, 300 ms) pour centrer le pion en vedette pendant les déplacements, mon pion pendant le lancer, le banc ou le raton concerné pendant l'épilogue, sans sortir de l'emprise. Dessous, la mini-carte (≈ 100 px de haut) avec le cadre de la fenêtre ; toucher la mini-carte déplace la fenêtre ; « Tout voir » affiche le plateau entier à l'échelle.
- Télé : le plateau entier, à l'échelle (cases ≥ 51 px en L).
- Transports : pointillés fléchés colorés (comme les téléporteurs aujourd'hui) avec l'émoji du véhicule au milieu ; portes : flèche vers la voie ouverte ; Haltes : case dorée 🏁 ; ratons : une pastille 🦝 par raton ; quartiers fermés : absents de la fenêtre, grisés sur la mini-carte.
- 201 cases = 201 éléments DOM + pions : sans difficulté.

### 4.6 Budget de performance

Aujourd'hui chaque case = 2 maillages non instanciés (corps + dessus) : à 204 cases, cela ferait plus de 400 appels de dessin rien que pour les cases. **Préalable (étape 1) : instancier les cases.**

| Poste | Cible téléphone (4 cœurs, 2020) | Cible télé |
|---|---|---|
| Images par seconde | ≥ 30 en L, ≥ 45 en M | 60 |
| Appels de dessin | **≤ 120** en L, ≤ 100 en M | ≤ 250 |
| Triangles à l'écran | **≤ 120 000** | ≤ 300 000 |
| Cases | corps et dessus en `InstancedMesh` **par type** (≤ 18 appels pour tout le plateau, socles déjà instanciés) ; géométrie allégée en M / L : ≤ 150 triangles par case (corps arrondi à 1 segment, socle = boîte) | idem, géométrie actuelle jusqu'en M |
| Ruban, chevrons | déjà instanciés (≤ 215 liaisons) | idem |
| Textures | 9 dessus de case (256 px), ≤ 12 plaques de zone, vignettes des pions ; ≤ 24 Mo en mémoire graphique | dessus en 512 px |
| Ombres | une seule carte 1024, **cadrée sur la cible de la caméra** (± 14 unités), mise à jour quand la cible bouge de plus de 2 unités ou qu'un pion se déplace | carte 2048, ± 24 unités en L, toute l'emprise en M |
| Résolution | `min(dpr, 1,5)` ; si la moyenne dépasse 33 ms par image pendant 2 s : 1,25, puis 1,0, puis ombres coupées (jamais de remontée en cours de partie) | `min(dpr, 2)` |
| Décor animé | skieurs ≤ 16 · mouettes 8 · crabes 6 · bateaux 10 · public ≤ 120 · particules : réserve actuelle | skieurs 32 · public ≤ 200 |
| Décor au loin | chaque quartier a un groupe « repère » (socle, volcan, manoir, rail : toujours visible, ≤ 8 appels) et un groupe « détail » (petits objets) **masqué au-delà de 22 unités de la cible** et en vue d'ensemble au téléphone | détail toujours visible |
| Bump d'une case (pion qui se pose) | mise à jour de la matrice d'une seule instance | idem |
| Construction de la scène | ≤ 400 ms en L (aucune texture par case) | — |

`PartyScene.stats` (appels, triangles) existe : la page de démo affiche ces deux nombres et le temps d'image moyen ; ce sont les critères de recette.

---

## 5. Répliques de Dédé

`dede-lines.ts` : nouvelles familles, paramètres `{name}`, `{n}` et un nouveau `{zone}` (nom du quartier). Priorité dans `moverLine` : gros lot > étoile > raton > Grande Descente > télésiège / verglas > transport > Halte > porte > le reste.

| Famille | Quand | Répliques |
|---|---|---|
| `open_grand_m` | générique M | « On est nombreux ce soir : j'ouvre les Coulisses et la Régie. Ne touchez à aucun bouton ! » · « Grand format ! Les Coulisses à gauche, la Régie devant. Un aiguillage sur deux vous y envoie. » |
| `open_mer_m` | générique M | « Vous êtes tant que ça ? Alors on prend le large : l'Île aux Mouettes et l'Île Coco sont ouvertes ! » · « Grand format : deux îles de plus. Le bac est à quai une fois sur deux, à vous de tomber dessus. » |
| `open_mer_l` | générique L | « Sept, huit… il me faut tout l'archipel ! Cinq îles, cinq bacs, et une marée pour tout le monde. » · « Format géant ! Mouettes, Coco, Piton, Pirates, Crabes : chacun son île pour commencer. » |
| `open_kermesse_m` | générique M | « Ce soir la kermesse voit grand : le Train Fantôme et le Grand Huit sont ouverts. Et la Tombola a quatre guichets ! » · « Grand format ! Passez le tourniquet… s'il veut bien tourner. » |
| `open_camping_m` | générique M | « Le camping affiche complet : j'ouvre les sentiers. Riton a prévenu sa famille, méfiez-vous de Rita et du petit Ritou. » · « Grand format ! Le Sous-bois d'un côté, la Rivière de l'autre, et un raton dans chaque coin. » |
| `open_ski_m` | générique M | « Vous êtes nombreux : j'ouvre Dédé 2500 ! Une cabine sur deux part vers la Combe aux Chamois, les autres vont aux Alpages. » · « Grand format ! On monte en télécabine, on redescend par la piste. » |
| `open_ski_l` | générique L | « Format géant : tout le domaine est ouvert, jusqu'au Pic du Dédé. Là-haut, la Grande Descente vous attend ! » · « Dédé 3000 est ouvert ! Le Glacier à gauche, la Crête des Aigles à droite, et le Pic au bout des deux. » |
| `spread` | générique L, après `open_*` | « Chacun son ponton pour commencer ! On se retrouve tous sur la Grande Île. » · « Tout le monde descend à sa gare ! Rendez-vous à la Station… ou au Pic. » |
| `teaser` | générique S, une partie sur deux, plateaux qui ont un quartier fermé | « Derrière le rideau ? Les Coulisses. Je les ouvre à partir de 5 joueurs ! » · « Vous voyez ces îles dans la brume ? Revenez à 5, je mets le bac en service. » · « La montagne derrière moi, c'est Dédé 2500. Il faut être 5 pour y monter ! » · « La palissade ? Chut… c'est le Train Fantôme. Ouverture à 5 joueurs. » · « Le sentier est fermé ce soir. À 5, je lève la barrière. » |
| `gate_in` | porte prise (Grand, Kermesse, Camping) | « {name} file vers {zone} ! » · « Par ici, {name} : {zone}, c'est par là. » · « La porte est ouverte : {name} disparaît vers {zone}. » |
| `gate_miss` | porte passée sans la prendre | « Fermé pour {name} ! Le prochain passera. » · « {name} continue tout droit. Ce sera pour le suivant ! » |
| `ferry` | bac pris | « Le bac est à quai : {name} embarque pour {zone} ! » · « Larguez les amarres ! {name} met le cap sur {zone}. » · « {name} monte à bord. Gilet de sauvetage obligatoire ! » |
| `ferry_miss` | bac en mer | « Le bac vient de partir… {name} reste sur la Grande Île. » · « Trop tard, {name} : le bac est au large. Il revient ! » |
| `ferry_back` | navette du retour | « Fin de l'escale : la navette ramène {name} sur la Grande Île. » · « {name} rentre au port, des coquillages plein les poches. » |
| `halt` | Halte (+5) | « Bienvenue sur {zone}, {name} : 5 pièces de bienvenue ! » · « {name} débarque : 5 pièces, cadeau de la maison. » |
| `cabin` | télécabine prise | « Une cabine pour {name} ! Direction {zone}. » · « {name} grimpe en télécabine. Ne vous penchez pas au-dehors ! » · « Ça monte pour {name} : {zone}, tout le monde descend. » |
| `cabin_miss` | cabine manquée (11, 76, 104) | « La cabine vient de partir : {name} continue à pied. » · « Pas de cabine pour {name}, la suivante est pour le prochain. » |
| `piste` | piste (retour à la Station) | « La piste est ouverte : {name} redescend à la Station tout schuss ! » · « {name} dévale la piste. Poussez-vous, les skieurs ! » · « Retour à la Station pour {name}, les cheveux au vent. » |
| `pic` | arrivée sur la Loge du Pic | « {name} est au Pic du Dédé ! Quelle vue… et quelle descente en perspective. » · « Le sommet pour {name} ! On plante le drapeau. » |
| `descent` | Grande Descente | « LA GRANDE DESCENTE ! {name} dévale toute la montagne jusqu'au Départ : 5 pièces à l'arrivée ! » · « {name} s'élance du Pic… Rendez-vous en bas ! » · « Du Pic à la Station d'une seule traite : chapeau, {name} ! » |
| `pack_steal` · `pack_drop` · `pack_none` | Rita ou Ritou (`{zone}` = nom du raton) | « {zone} fait les poches de {name} ! C'est de famille. » · « Tel père, telle fille : {zone} repart avec les pièces de {name}. » — « {zone} sursaute et lâche son sac : tout est pour {name} ! » · « Merci {zone} ! {name} ramasse le butin. » — « {zone} fouille {name}… rien. La relève n'est pas encore au point. » |
| `pack_move` | épilogue sans croisement, M | « Toute la famille Raton fait sa ronde… Cachez vos pièces ! » · « Riton au camp, Rita au sous-bois, Ritou à la rivière : la tournée du soir. » |
| `tide_up_many` | la mer monte, 2 pions emportés ou plus | « Marée haute sur tout l'archipel ! {n} à la baille, je note. » · « La mer monte partout à la fois : {n} baigneurs surpris ! » |
| `tide_wash` (ajouts) | pion emporté sur un banc d'île | « Le gué disparaît sous {name} ! 5 pièces pour les crabes. » · « {name} cherchait le trésor… c'est la mer qui l'a trouvé. » |

Les familles existantes (`toll`, `jackpot`, `lift`, `ice`, `luge`, `riton_*`, `fork_banc`…) servent telles quelles dans les quartiers.

---

## 6. Trophées et stats

Aucun trophée nouveau, aucun compteur existant modifié. `size_no` (1, 2, 3) est enregistré dans `results[].stats` à côté de `map_no` : un futur lot pourra s'en servir (« jouer sur un plateau géant »). Effets de bord acceptés : « Pile dessus » un peu plus fréquent à Dédé 3000 (plus de télésièges qui arrivent près d'une Loge) ; « Coupure pub » un peu plus rare sur les grands plateaux (moins de Pubs dans les quartiers).

## 7. Tests

**SQL (PGlite)**, `tools/sql-tests/dede-party.mjs` :

- Pour chaque couple (plateau, taille) — 5 en S (inchangés), 5 en M, 2 en L : synchro `boards/<id>.ts` ↔ SQL (`CELLS_x`, `NEXT_x`, `PREV_x`, `EXTRA_x`) ; contrôles de tracé du §1.5 ; nombre de cases (100, 100, 201, 100, 100, 105, 204) ; compte de chaque type (première ligne de chaque section de l'annexe A) ; tours `voie 0 / voie 1` : Grand M 36 / 92 · Mer M 36 / 94 · Mer L 36 / 190 · Kermesse M 40 / 98 · Camping M 36 / 98 · Ski M 73 / 75 · Ski L 73 / 95 ; un mode par embranchement ; chaque zone d'étoiles a au moins `n + 2` Loges ; aucun banc n'a de Pub ; téléporteurs : 2 cases d'écart en ligne droite, arrivée = Applaudissements, jamais sur un embranchement.
- `_dp_size` : 2-4 → s ; 5-6 → m ; 7-8 → l sur `mer` et `ski`, m ailleurs ; option `size` de test (valide, inconnue, trop grande).
- Démarrage : `state.size` ; taille de `sw` et valeurs des embranchements `tide` ; étoiles : le bon nombre **dans chaque zone**, jamais sur un banc noyé ; M : tout le monde en 0 ; L : `ceil(n / 2)` haltes distinctes prises dans `starts`, 2 joueurs par halte (1 pour le dernier à 7), aucune pièce de bonus au placement ; `mech.pack` au camping M ; échéance du générique 10 s / 12 s.
- Partie sans `size` dans le state (lancée avant ce lot) : se joue en S, tous les tests actuels passent sans modification.
- Portes : `toggle` vers un transport (le pion arrive sur la Halte, +5, `sw` bascule, évènement `fork` puis `start` avec `halt: true`) ; porte manquée ; carte « avance » à travers une porte ; carte « recule » depuis une Halte (retour à l'embarcadère, sans bonus) ; passage obligé 13 → 77 ; retour par transport (67 → 8, 76 → 14, 154 → 0 avec le +5 du Départ).
- Étoiles par zone : l'étoile achetée dans un quartier y reste ; « Changement de décor » ; zone dont toutes les autres Loges sont noyées.
- `mer` M / L : les embranchements `tide` suivent tous la marée ; pions emportés sur deux bancs le même tour (case d'arrivée propre à chaque banc, `dist`, ordre de passage) ; étoile d'une Loge de banc d'île.
- `kermesse` M : péage aux 4 guichets, gros lot sur un guichet de quartier (une seule cagnotte).
- `camping` M : chaque raton croise seulement dans sa zone ; trois sacs indépendants ; ronde cyclique de Rita (66 → … → 36 → 66) ; ordre des dés (lancers, cartes « Bis », Riton, Rita, Ritou) ; `epi.pack`.
- `ski` M / L : les 14 / 26 téléporteurs ; étoile achetée à l'arrivée ; aiguillages 76, 104, 130, 180 ; les deux arêtes arrivent en 154 ; Grande Descente.
- Simulation par (plateau, taille, joueurs) : mêmes sorties qu'aujourd'hui + quartiers visités, visiteurs par quartier ; assertions : jamais plus de 24 pas ; moins de 10 % de joueurs sans étoile ; étoiles par joueur à ±12 % du plateau S au même nombre de joueurs ; aucun quartier à moins de 2 visiteurs par partie.

**Outil de conception** : `node tools/dede-party/grands-plateaux-sim.mjs` rejoue les contrôles de tracé (160 contrôles) et la simulation JS ; `--dump` réimprime l'annexe A.

**Autres** : `tools/sql-tests/game-states.mjs` (`size`, `mech.pack`) ; `tsc`, `eslint`, `npm run build` ; page de démo : sélecteur de taille, une partie par (plateau, taille), téléphone portrait + télé, clair et sombre, repli 2D, relevé des appels de dessin et du temps d'image (§4.6).
Après toute modification SQL : `npm run sql`, puis coller `supabase/install.sql` dans le SQL Editor Supabase.

## 8. Livraison (chaque étape est jouable seule)

1. **Socle des tailles** : `size` de bout en bout (SQL à deux paramètres, `boardOf(map, size)`, repère prolongé `col0` / `row0`), **cases instanciées**, étoiles par zone, **Grand Plateau M** (données seules : valide les portes, les zones, la caméra à 100 cases, la mini-carte au téléphone, le repli 2D à fenêtre). Aucun changement en taille S.
2. **Kermesse M** (données + 4 guichets) et **Camping M** (la famille Raton : `pack`).
3. **Dédé-sur-Mer M** : transports dans un embranchement, case Halte, bancs multiples, plan d'eau étendu, bacs.
4. **Dédé 2000 M** : télécabines, passage obligé, pistes, skieurs (à plat).
5. **Tailles L** de la mer puis du ski : départs répartis, plan de traversée, mini-carte de la télé, budget de performance au téléphone.
6. **Relief de la montagne** (`alt`), quartiers fermés (voiles et aperçus) sur les 5 plateaux, répliques, simulation SQL par taille et réglages, `docs/ARCHITECTURE.md`, texte `rules` de `index.ts`.

Une taille n'est servie par `_dp_size` que lorsqu'elle est livrée (liste des tailles disponibles par plateau dans `_dp_size`) : en attendant, le plateau se joue en taille inférieure.

## 9. Choix tranchés

- **Trois tailles, automatiques** : S ≤ 4 joueurs, M à 5-6, L à 7-8 pour la mer et le ski seulement ; Kermesse, Camping **et Grand Plateau** plafonnent à 100 cases. Pas de réglage pour l'hôte.
- **Tailles S intouchées** : mêmes cases, mêmes numéros, mêmes fiches, mêmes tests.
- **Carrefour + détours** plutôt qu'un long anneau : un anneau de 200 cases ne se parcourt pas en 9 tours, même avec des départs répartis (chacun n'en verrait qu'un tiers, sans jamais croiser les autres).
- **Portes « un pion sur deux »** partout, habillées par thème (bac, tourniquet, barrière, cabine). Les aiguillages ne sont donc plus réservés au Grand Plateau en grande taille ; en taille S, les trois plateaux sans embranchement le restent.
- **Une seule exception au « un sur deux »** : la télécabine des Alpages est obligatoire, pour que Dédé 2500 se partage en deux moitiés égales et que tout le monde monte (sinon 14 % des joueurs ne voyaient jamais la montagne en M).
- **Étoiles par zone** (base 2 ou 3, +1 par quartier, +2 pour les secteurs de 50 cases) plutôt que « plus d'étoiles partout ».
- **Halte à +5** sur les îles et dans les gares seulement ; pas sur les trois plateaux plafonnés, dont les quartiers sont de simples détours à pied.
- **Départs répartis seulement en L**, par deux, sur des Haltes tirées au sort ; en M tout le monde part du Départ, comme toujours.
- **Ni dé ni tour supplémentaire** ; 24 pas au plus ; un transport = 1 pas (3 pas à l'écran).
- **Marée** : une horloge, tous les bancs (1 / 2 / 4) ; les bacs ne dépendent pas de la marée (deux règles simples plutôt qu'une règle double).
- **Tombola** : 4 guichets, une cagnotte.
- **Ratons** : trois (un par zone, rondes disjointes, épilogue simultané) — deux ne suffisaient pas (1,95 croisement par joueur au lieu de 2,9).
- **Ski** : la Station reste telle quelle ; la montagne est derrière, en lacets ; marcher = monter partout ; les skieurs sont un décor, y compris sur la montagne fermée ; relief réel en dernière étape, sans effet sur les règles.
- **Archipel** : 5 îles autour de la Grande Île, emprise 31 × 20 pensée pour la télé ; îles en « C » (ponton d'arrivée et ponton de retour côte à côte).
- **Quartiers fermés visibles** à toutes les tailles inférieures, avec une plaque qui dit à combien de joueurs ils ouvrent.

## 10. Points à trancher

Aucun.

## 11. Hors périmètre

Taille L pour le Grand Plateau, la Kermesse et le Camping ; choix de la taille par l'hôte ; plateaux à plus de 8 joueurs ; nouvelles cartes Enveloppe, nouveaux mini-jeux, objets ; interaction entre skieurs et pions ; illustrations dédiées (Rita, Ritou, bacs) à la place des primitives ; musiques par quartier ; trophées liés à la taille ; mise à jour de la vidéo tuto.

---

## Annexe A — Tracés exacts

Sortie de `node tools/dede-party/grands-plateaux-sim.mjs --dump`. Pour chaque taille : le compte des types, le plan des types, le plan des numéros de case (colonnes et lignes = coordonnées `XY`), puis les constantes à copier dans `boards/<id>.ts` (`NEXT` : un tableau `[tout droit, détour]` = embranchement ; `JUMPS` : liaisons qui sont des transports) et dans le SQL (`EXTRA_x` = `_dp_map(id, x)`). Les cases 0 à 35-48 sont celles du plateau actuel.

### A.1 Le Grand Plateau — taille M (100 cases)

1 Départ · 46 Applaudissements · 17 Pub · 19 Enveloppe · 17 Loge.

```
     -7-6-5-4-3-2-1 0 1 2 3 4 5 6 7 8 91011
   0  A P A L A E · · E L A A P A E L A · ·
   1  E · · · · A · P A · · A · A · · P L ·
   2  A · · · · A A L · · · E L A · · · A ·
   3  L · · · · · · A · · · · · · · A P E ·
   4  A · · · · · · E · · · · · · · P · A ·
   5  A · · · · A A A · · · · · · · E · A ·
   6  A · · · · L · L · · · · · · · P A A ·
   7  E · · · · A · P A · · · · · · · · E ·
   8  A L A P A E · · D A P L E A L P A L ·
   9  · · · · · · · · · · · · A · · · A · ·
  10  · · · · · · · · E L P A E · · · E P A
  11  · · · · · · · · A · · · · · · · · · L
  12  · · · · · · · · P · · · · · · · · · A
  13  · · · · · · · · E · · · · · · · · · E
  14  · · · · · · · · A L A P E A P L E A P
```

```
       -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
   0   64  65  66  67  68  69   ·   ·  10  11  12  13  14  15  16  17  18   ·   ·
   1   63   ·   ·   ·   ·  70   ·   8   9   ·   ·  36   ·  40   ·   ·  19  20   ·
   2   62   ·   ·   ·   ·  71  72   7   ·   ·   ·  37  38  39   ·   ·   ·  21   ·
   3   61   ·   ·   ·   ·   ·   ·   6   ·   ·   ·   ·   ·   ·   ·  42  41  22   ·
   4   60   ·   ·   ·   ·   ·   ·   5   ·   ·   ·   ·   ·   ·   ·  43   ·  23   ·
   5   59   ·   ·   ·   ·  48  47   4   ·   ·   ·   ·   ·   ·   ·  44   ·  24   ·
   6   58   ·   ·   ·   ·  49   ·   3   ·   ·   ·   ·   ·   ·   ·  45  46  25   ·
   7   57   ·   ·   ·   ·  50   ·   2   1   ·   ·   ·   ·   ·   ·   ·   ·  26   ·
   8   56  55  54  53  52  51   ·   ·   0  35  34  33  32  31  30  29  28  27   ·
   9    ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·  99   ·   ·   ·  73   ·   ·
  10    ·   ·   ·   ·   ·   ·   ·   ·  94  95  96  97  98   ·   ·   ·  74  75  76
  11    ·   ·   ·   ·   ·   ·   ·   ·  93   ·   ·   ·   ·   ·   ·   ·   ·   ·  77
  12    ·   ·   ·   ·   ·   ·   ·   ·  92   ·   ·   ·   ·   ·   ·   ·   ·   ·  78
  13    ·   ·   ·   ·   ·   ·   ·   ·  91   ·   ·   ·   ·   ·   ·   ·   ·   ·  79
  14    ·   ·   ·   ·   ·   ·   ·   ·  90  89  88  87  86  85  84  83  82  81  80
```

```ts
CELLS_M = ['start','clap','pub','loge','clap','env','clap','loge','pub','clap','env','loge','clap','clap','pub','clap','env','loge','clap','pub','loge','clap','env','clap','clap','clap','env','loge','clap','pub','loge','clap','env','loge','pub','clap','clap','env','loge','clap','clap','pub','clap','pub','env','pub','clap','clap','clap','loge','clap','env','clap','pub','clap','loge','clap','env','clap','clap','clap','loge','clap','env','clap','pub','clap','loge','clap','env','clap','clap','clap','clap','env','pub','clap','loge','clap','env','pub','clap','env','loge','pub','clap','env','pub','clap','loge','clap','env','pub','clap','env','loge','pub','clap','env','clap']
NEXT_M = [1,2,3,4,[5,47],6,7,8,9,10,11,12,13,[14,36],15,16,17,18,19,20,21,22,[23,41],24,25,26,27,28,[29,73],30,31,32,33,34,35,0,37,38,39,40,15,42,43,44,45,46,25,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,7,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,32]
PREV_M = [35,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,13,36,37,38,39,22,41,42,43,44,45,4,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,28,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98]
XY_M = [[1,8],[1,7],[0,7],[0,6],[0,5],[0,4],[0,3],[0,2],[0,1],[1,1],[1,0],[2,0],[3,0],[4,0],[5,0],[6,0],[7,0],[8,0],[9,0],[9,1],[10,1],[10,2],[10,3],[10,4],[10,5],[10,6],[10,7],[10,8],[9,8],[8,8],[7,8],[6,8],[5,8],[4,8],[3,8],[2,8],[4,1],[4,2],[5,2],[6,2],[6,1],[9,3],[8,3],[8,4],[8,5],[8,6],[9,6],[-1,5],[-2,5],[-2,6],[-2,7],[-2,8],[-3,8],[-4,8],[-5,8],[-6,8],[-7,8],[-7,7],[-7,6],[-7,5],[-7,4],[-7,3],[-7,2],[-7,1],[-7,0],[-6,0],[-5,0],[-4,0],[-3,0],[-2,0],[-2,1],[-2,2],[-1,2],[9,9],[9,10],[10,10],[11,10],[11,11],[11,12],[11,13],[11,14],[10,14],[9,14],[8,14],[7,14],[6,14],[5,14],[4,14],[3,14],[2,14],[1,14],[1,13],[1,12],[1,11],[1,10],[2,10],[3,10],[4,10],[5,10],[5,9]]
JUMPS_M = []
EXTRA_M = {"no":1,"mech":"forks","forks":["toggle","toggle","toggle","toggle"],"size":"m","stars":[{"n":0,"loges":[3,7,11,17,20,27,30,33,38]},{"n":1,"loges":[49,55,61,67]},{"n":1,"loges":[77,83,89,95]}]}
```

### A.2 Dédé-sur-Mer — taille M (100 cases)

1 Départ · 42 Applaudissements · 16 Pub · 16 Enveloppe · 23 Loge · 2 Halte.

```
     -9-8-7-6-5-4-3-2-1 0 1 2 3 4 5 6 7 8 910
  -6  · · · · · · · · · A E A P L A A L A P E
  -5  · · · · · · · · · L · · · · · · · · · L
  -4  A P E L A E A · · E · · · · · · · · · A
  -3  L · · · · · P · · P · · · · · · · · · E
  -2  A · · · · · L · · A L H · A L A A L P A
  -1  A · · · · · · · · · · · · · · · · · · ·
   0  L · · · · · H · · P A E L A P A L E A P
   1  P · · · · · L · · L · · · A · A · · · L
   2  A E A L A P A · · A · · · A · A · · · A
   3  · · A · A · · · · E · · · E · E · · · P
   4  · · E L A · · · · A · · · A L A · · · E
   5  · · · · · · · · · L · · · · · · · · · A
   6  · · · · · · · · · P · · · · · · · · · L
   7  · · · · · · · · · A · · · · · · · · · P
   8  · · · · · · · · · D A P L E A P A L E A
```

```
       -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10
  -6    ·   ·   ·   ·   ·   ·   ·   ·   ·  79  80  81  82  83  84  85  86  87  88  89
  -5    ·   ·   ·   ·   ·   ·   ·   ·   ·  78   ·   ·   ·   ·   ·   ·   ·   ·   ·  90
  -4   59  60  61  62  63  64  65   ·   ·  77   ·   ·   ·   ·   ·   ·   ·   ·   ·  91
  -3   58   ·   ·   ·   ·   ·  66   ·   ·  76   ·   ·   ·   ·   ·   ·   ·   ·   ·  92
  -2   57   ·   ·   ·   ·   ·  67   ·   ·  75  74  73   ·  99  98  97  96  95  94  93
  -1   56   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·
   0   55   ·   ·   ·   ·   ·  45   ·   ·   8   9  10  11  12  13  14  15  16  17  18
   1   54   ·   ·   ·   ·   ·  46   ·   ·   7   ·   ·   ·  36   ·  44   ·   ·   ·  19
   2   53  52  51  50  49  48  47   ·   ·   6   ·   ·   ·  37   ·  43   ·   ·   ·  20
   3    ·   ·  72   ·  68   ·   ·   ·   ·   5   ·   ·   ·  38   ·  42   ·   ·   ·  21
   4    ·   ·  71  70  69   ·   ·   ·   ·   4   ·   ·   ·  39  40  41   ·   ·   ·  22
   5    ·   ·   ·   ·   ·   ·   ·   ·   ·   3   ·   ·   ·   ·   ·   ·   ·   ·   ·  23
   6    ·   ·   ·   ·   ·   ·   ·   ·   ·   2   ·   ·   ·   ·   ·   ·   ·   ·   ·  24
   7    ·   ·   ·   ·   ·   ·   ·   ·   ·   1   ·   ·   ·   ·   ·   ·   ·   ·   ·  25
   8    ·   ·   ·   ·   ·   ·   ·   ·   ·   0  35  34  33  32  31  30  29  28  27  26
```

`CELLS_M` et `XY_M` = les 100 premières entrées de `CELLS_L` et `XY_L` (A.3), à écrire en entier dans le fichier.

```ts
NEXT_M = [1,2,3,4,[5,45],6,7,8,9,[10,73],11,12,[13,36],14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,0,37,38,39,40,41,42,43,44,14,46,47,48,49,[50,68],51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,8,69,70,71,72,51,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,11]
PREV_M = [35,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,12,36,37,38,39,40,41,42,43,4,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,49,68,69,70,71,9,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98]
JUMPS_M = [[4,45],[67,8],[9,73],[99,11]]
EXTRA_M = {"no":2,"mech":"tide","forks":["toggle","toggle","tide","tide"],"size":"m","stars":[{"n":0,"loges":[3,7,11,15,19,24,28,33,40]},{"n":1,"loges":[46,50,55,58,62,67,70]},{"n":1,"loges":[74,78,83,86,90,95,98]}],"banks":[{"cells":[36,37,38,39,40,41,42,43,44],"wash_to":14,"end":45},{"cells":[68,69,70,71,72],"wash_to":51,"end":73}]}
```

### A.3 Dédé-sur-Mer — taille L (201 cases)

1 Départ · 87 Applaudissements · 30 Pub · 32 Enveloppe · 46 Loge · 5 Halte.

```
     -10-9-8-7-6-5-4-3-2-1 0 1 2 3 4 5 6 7 8 91011121314151617181920
  -6  · · · · · · · · · · A E A P L A A L A P E · L A A L P A E A L
  -5  · · · · · · · · · · L · · · · · · · · · L · A · · · · · · · E
  -4  · A P E L A E A · · E · · · · · · · · · A · P · · · · · · · P
  -3  · L · · · · · P · · P · · · · · · · · · E · E · · · · · · · A
  -2  · A · · · · · L · · A L H · A L A A L P A · L · · · · · · · L
  -1  · A · · · · · · · · · · · · · · · · · · · · A · · · · · · · A
   0  · L · · · · · H · · P A E L A P A L E A P · · · · · · · · · A
   1  · P · · · · · L · · L · · · A · A · · · L · H · · · · · · · L
   2  · A E A L A P A · · A · · · A · A · · · A · L A P E L A E A P
   3  · · · A · A · · · · E · · · E · E · · · P · · · · · · · · · ·
   4  · · · E L A · · · · A · · · A L A · · · E · · · · · · · · · ·
   5  · · · · · · · · · · L · · · · · · · · · A · · · · · · · · · ·
   6  P A E A L E P A · · P · · · · · · · · · L · A P E L A E A P L
   7  L · · · · · · L · · A · · · · · · · · · P · L · · · · · · · A
   8  A A A A · · · H · · D A P L E A P A L E A · H · · · · E A A A
   9  A · · E · · · · · · · · · · · · · · · · · · · · · · · L · · L
  10  A A L A · · · A · · · · · · · · · · · · · · E · · · · A A A A
  11  A · · · · · · L · · · · · · · · · · · · · · P · · · · · · · P
  12  P · · · · · · A · · · · · · · · · · · · · · A · · · · · · · E
  13  E L A E A P L A · · · · · · · · · · · · · · L A A L P A E A L
```

```
      -10  -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11  12  13  14  15  16  17  18  19  20
  -6    ·   ·   ·   ·   ·   ·   ·   ·   ·   ·  79  80  81  82  83  84  85  86  87  88  89   · 125 124 123 122 121 120 119 118 117
  -5    ·   ·   ·   ·   ·   ·   ·   ·   ·   ·  78   ·   ·   ·   ·   ·   ·   ·   ·   ·  90   · 126   ·   ·   ·   ·   ·   ·   · 116
  -4    ·  59  60  61  62  63  64  65   ·   ·  77   ·   ·   ·   ·   ·   ·   ·   ·   ·  91   · 127   ·   ·   ·   ·   ·   ·   · 115
  -3    ·  58   ·   ·   ·   ·   ·  66   ·   ·  76   ·   ·   ·   ·   ·   ·   ·   ·   ·  92   · 128   ·   ·   ·   ·   ·   ·   · 114
  -2    ·  57   ·   ·   ·   ·   ·  67   ·   ·  75  74  73   ·  99  98  97  96  95  94  93   · 129   ·   ·   ·   ·   ·   ·   · 113
  -1    ·  56   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   · 130   ·   ·   ·   ·   ·   ·   · 112
   0    ·  55   ·   ·   ·   ·   ·  45   ·   ·   8   9  10  11  12  13  14  15  16  17  18   ·   ·   ·   ·   ·   ·   ·   ·   · 111
   1    ·  54   ·   ·   ·   ·   ·  46   ·   ·   7   ·   ·   ·  36   ·  44   ·   ·   ·  19   · 100   ·   ·   ·   ·   ·   ·   · 110
   2    ·  53  52  51  50  49  48  47   ·   ·   6   ·   ·   ·  37   ·  43   ·   ·   ·  20   · 101 102 103 104 105 106 107 108 109
   3    ·   ·   ·  72   ·  68   ·   ·   ·   ·   5   ·   ·   ·  38   ·  42   ·   ·   ·  21   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·
   4    ·   ·   ·  71  70  69   ·   ·   ·   ·   4   ·   ·   ·  39  40  41   ·   ·   ·  22   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·
   5    ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   3   ·   ·   ·   ·   ·   ·   ·   ·   ·  23   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·
   6  176 175 174 173 172 171 170 169   ·   ·   2   ·   ·   ·   ·   ·   ·   ·   ·   ·  24   · 133 134 135 136 137 138 139 140 141
   7  177   ·   ·   ·   ·   ·   · 168   ·   ·   1   ·   ·   ·   ·   ·   ·   ·   ·   ·  25   · 132   ·   ·   ·   ·   ·   ·   · 142
   8  178 194 195 196   ·   ·   · 167   ·   ·   0  35  34  33  32  31  30  29  28  27  26   · 131   ·   ·   ·   · 162 161 160 143
   9  179   ·   · 197   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   · 163   ·   · 144
  10  180 200 199 198   ·   ·   · 193   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   · 159   ·   ·   ·   · 164 165 166 145
  11  181   ·   ·   ·   ·   ·   · 192   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   · 158   ·   ·   ·   ·   ·   ·   · 146
  12  182   ·   ·   ·   ·   ·   · 191   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   · 157   ·   ·   ·   ·   ·   ·   · 147
  13  183 184 185 186 187 188 189 190   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   · 156 155 154 153 152 151 150 149 148
```

```ts
CELLS_L = ['start','clap','pub','loge','clap','env','clap','loge','pub','clap','env','loge','clap','pub','clap','loge','env','clap','pub','loge','clap','pub','env','clap','loge','pub','clap','env','loge','clap','pub','clap','env','loge','pub','clap','clap','clap','env','clap','loge','clap','env','clap','clap','halt','loge','clap','pub','clap','loge','clap','env','clap','pub','loge','clap','clap','loge','clap','pub','env','loge','clap','env','clap','pub','loge','clap','clap','loge','env','clap','halt','loge','clap','pub','env','loge','clap','env','clap','pub','loge','clap','clap','loge','clap','pub','env','loge','clap','env','clap','pub','loge','clap','clap','loge','clap','halt','loge','clap','pub','env','loge','clap','env','clap','pub','loge','clap','clap','loge','clap','pub','env','loge','clap','env','clap','pub','loge','clap','clap','loge','clap','pub','env','loge','clap','halt','loge','clap','pub','env','loge','clap','env','clap','pub','loge','clap','clap','loge','clap','pub','env','loge','clap','env','clap','pub','loge','clap','clap','loge','clap','pub','env','clap','clap','env','loge','clap','clap','clap','halt','loge','clap','pub','env','loge','clap','env','clap','pub','loge','clap','clap','clap','clap','pub','env','loge','clap','env','clap','pub','loge','clap','clap','loge','clap','clap','clap','clap','env','clap','loge','clap']
NEXT_L = [1,2,3,4,[5,45],6,7,8,9,[10,73],11,12,[13,36],14,15,16,17,18,19,20,[21,100],22,23,24,25,26,[27,131],28,29,30,31,[32,167],33,34,35,0,37,38,39,40,41,42,43,44,14,46,47,48,49,[50,68],51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,8,69,70,71,72,51,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,11,101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,116,117,118,119,120,121,122,123,124,125,126,127,128,129,130,22,132,133,134,135,136,137,138,139,140,141,142,143,[144,160],145,146,147,148,149,150,151,152,153,154,155,156,157,158,159,28,161,162,163,164,165,166,145,168,169,170,171,172,173,174,175,176,177,178,[179,194],180,181,182,183,184,185,186,187,188,189,190,191,192,193,33,195,196,197,198,199,200,180]
PREV_L = [35,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,12,36,37,38,39,40,41,42,43,4,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,49,68,69,70,71,9,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,20,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,116,117,118,119,120,121,122,123,124,125,126,127,128,129,26,131,132,133,134,135,136,137,138,139,140,141,142,143,144,145,146,147,148,149,150,151,152,153,154,155,156,157,158,143,160,161,162,163,164,165,31,167,168,169,170,171,172,173,174,175,176,177,178,179,180,181,182,183,184,185,186,187,188,189,190,191,192,178,194,195,196,197,198,199]
XY_L = [[0,8],[0,7],[0,6],[0,5],[0,4],[0,3],[0,2],[0,1],[0,0],[1,0],[2,0],[3,0],[4,0],[5,0],[6,0],[7,0],[8,0],[9,0],[10,0],[10,1],[10,2],[10,3],[10,4],[10,5],[10,6],[10,7],[10,8],[9,8],[8,8],[7,8],[6,8],[5,8],[4,8],[3,8],[2,8],[1,8],[4,1],[4,2],[4,3],[4,4],[5,4],[6,4],[6,3],[6,2],[6,1],[-3,0],[-3,1],[-3,2],[-4,2],[-5,2],[-6,2],[-7,2],[-8,2],[-9,2],[-9,1],[-9,0],[-9,-1],[-9,-2],[-9,-3],[-9,-4],[-8,-4],[-7,-4],[-6,-4],[-5,-4],[-4,-4],[-3,-4],[-3,-3],[-3,-2],[-5,3],[-5,4],[-6,4],[-7,4],[-7,3],[2,-2],[1,-2],[0,-2],[0,-3],[0,-4],[0,-5],[0,-6],[1,-6],[2,-6],[3,-6],[4,-6],[5,-6],[6,-6],[7,-6],[8,-6],[9,-6],[10,-6],[10,-5],[10,-4],[10,-3],[10,-2],[9,-2],[8,-2],[7,-2],[6,-2],[5,-2],[4,-2],[12,1],[12,2],[13,2],[14,2],[15,2],[16,2],[17,2],[18,2],[19,2],[20,2],[20,1],[20,0],[20,-1],[20,-2],[20,-3],[20,-4],[20,-5],[20,-6],[19,-6],[18,-6],[17,-6],[16,-6],[15,-6],[14,-6],[13,-6],[12,-6],[12,-5],[12,-4],[12,-3],[12,-2],[12,-1],[12,8],[12,7],[12,6],[13,6],[14,6],[15,6],[16,6],[17,6],[18,6],[19,6],[20,6],[20,7],[20,8],[20,9],[20,10],[20,11],[20,12],[20,13],[19,13],[18,13],[17,13],[16,13],[15,13],[14,13],[13,13],[12,13],[12,12],[12,11],[12,10],[19,8],[18,8],[17,8],[17,9],[17,10],[18,10],[19,10],[-3,8],[-3,7],[-3,6],[-4,6],[-5,6],[-6,6],[-7,6],[-8,6],[-9,6],[-10,6],[-10,7],[-10,8],[-10,9],[-10,10],[-10,11],[-10,12],[-10,13],[-9,13],[-8,13],[-7,13],[-6,13],[-5,13],[-4,13],[-3,13],[-3,12],[-3,11],[-3,10],[-9,8],[-8,8],[-7,8],[-7,9],[-7,10],[-8,10],[-9,10]]
JUMPS_L = [[4,45],[67,8],[9,73],[99,11],[20,100],[130,22],[26,131],[159,28],[31,167],[193,33]]
EXTRA_L = {"no":2,"mech":"tide","forks":["toggle","toggle","tide","toggle","toggle","toggle","tide","tide","tide"],"size":"l","stars":[{"n":0,"loges":[3,7,11,15,19,24,28,33,40]},{"n":1,"loges":[46,50,55,58,62,67,70]},{"n":1,"loges":[74,78,83,86,90,95,98]},{"n":1,"loges":[101,105,110,113,117,122,125,129]},{"n":1,"loges":[132,136,141,144,148,153,156,163]},{"n":1,"loges":[168,172,177,184,189,192,199]}],"starts":[45,73,100,131,167],"banks":[{"cells":[36,37,38,39,40,41,42,43,44],"wash_to":14,"end":45},{"cells":[68,69,70,71,72],"wash_to":51,"end":73},{"cells":[160,161,162,163,164,165,166],"wash_to":145,"end":167},{"cells":[194,195,196,197,198,199,200],"wash_to":180,"end":201}]}
```

### A.4 La Kermesse — taille M (100 cases)

1 Départ · 47 Applaudissements · 16 Pub · 15 Enveloppe · 17 Loge · 4 Tombola.

```
     -9-8-7-6-5-4-3-2-1 0 1 2 3 4 5 6 7 8 910111213
  -1  A E A P A A L A · · · · · · · · · · · · · · ·
   0  L · · · · · · E · L A P A L · A P E A L · · ·
   1  A · · · · · · P A E · · · A · L · · · A · · ·
   2  P · · · · · · · · P · · · E T A · · · P · · ·
   3  E · · · · · · A A A · · · · · · · · · A · · ·
   4  T · · · · · · L · L · · · A T P · · · E · · ·
   5  L · · · · · · A · A · · · E · A · · · L · · ·
   6  A · · · · · · E · D A P A L · L E A P A · · ·
   7  A P A E A L A P · · · · · · · · · A · A · · ·
   8  · · · · · · · · · · · · A P A A L A · A L A E
   9  · · · · · · · · · · · · E · · · · · · · · · P
  10  · · · · · · · · · · · · A · · · · · · · · · A
  11  · · · · · · · · · · · · L · · · · · · · · · L
  12  · · · · · · · · · · · · A P E A T A A P A E A
```

```
       -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11  12  13
  -1   60  61  62  63  64  65  66  67   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·
   0   59   ·   ·   ·   ·   ·   ·  68   ·   6   7   8   9  10   ·  16  17  18  19  20   ·   ·   ·
   1   58   ·   ·   ·   ·   ·   ·  69  70   5   ·   ·   ·  11   ·  15   ·   ·   ·  21   ·   ·   ·
   2   57   ·   ·   ·   ·   ·   ·   ·   ·   4   ·   ·   ·  12  13  14   ·   ·   ·  22   ·   ·   ·
   3   56   ·   ·   ·   ·   ·   ·  41  40   3   ·   ·   ·   ·   ·   ·   ·   ·   ·  23   ·   ·   ·
   4   55   ·   ·   ·   ·   ·   ·  42   ·   2   ·   ·   ·  34  33  32   ·   ·   ·  24   ·   ·   ·
   5   54   ·   ·   ·   ·   ·   ·  43   ·   1   ·   ·   ·  35   ·  31   ·   ·   ·  25   ·   ·   ·
   6   53   ·   ·   ·   ·   ·   ·  44   ·   0  39  38  37  36   ·  30  29  28  27  26   ·   ·   ·
   7   52  51  50  49  48  47  46  45   ·   ·   ·   ·   ·   ·   ·   ·   ·  99   ·  71   ·   ·   ·
   8    ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·  93  94  95  96  97  98   ·  72  73  74  75
   9    ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·  92   ·   ·   ·   ·   ·   ·   ·   ·   ·  76
  10    ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·  91   ·   ·   ·   ·   ·   ·   ·   ·   ·  77
  11    ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·  90   ·   ·   ·   ·   ·   ·   ·   ·   ·  78
  12    ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·  89  88  87  86  85  84  83  82  81  80  79
```

```ts
CELLS_M = ['start','clap','loge','clap','pub','env','loge','clap','pub','clap','loge','clap','env','tombola','clap','loge','clap','pub','env','clap','loge','clap','pub','clap','env','loge','clap','pub','clap','env','loge','clap','pub','tombola','clap','env','loge','clap','pub','clap','clap','clap','loge','clap','env','pub','clap','loge','clap','env','clap','pub','clap','clap','loge','tombola','env','pub','clap','loge','clap','env','clap','pub','clap','clap','loge','clap','env','pub','clap','clap','clap','loge','clap','env','pub','clap','loge','clap','env','clap','pub','clap','clap','tombola','clap','env','pub','clap','loge','clap','env','clap','pub','clap','clap','loge','clap','clap']
NEXT_M = [1,2,3,[4,40],5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,[27,71],28,29,30,31,32,33,34,35,36,37,38,39,0,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,5,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,28]
PREV_M = [39,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,3,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,26,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98]
XY_M = [[0,6],[0,5],[0,4],[0,3],[0,2],[0,1],[0,0],[1,0],[2,0],[3,0],[4,0],[4,1],[4,2],[5,2],[6,2],[6,1],[6,0],[7,0],[8,0],[9,0],[10,0],[10,1],[10,2],[10,3],[10,4],[10,5],[10,6],[9,6],[8,6],[7,6],[6,6],[6,5],[6,4],[5,4],[4,4],[4,5],[4,6],[3,6],[2,6],[1,6],[-1,3],[-2,3],[-2,4],[-2,5],[-2,6],[-2,7],[-3,7],[-4,7],[-5,7],[-6,7],[-7,7],[-8,7],[-9,7],[-9,6],[-9,5],[-9,4],[-9,3],[-9,2],[-9,1],[-9,0],[-9,-1],[-8,-1],[-7,-1],[-6,-1],[-5,-1],[-4,-1],[-3,-1],[-2,-1],[-2,0],[-2,1],[-1,1],[10,7],[10,8],[11,8],[12,8],[13,8],[13,9],[13,10],[13,11],[13,12],[12,12],[11,12],[10,12],[9,12],[8,12],[7,12],[6,12],[5,12],[4,12],[3,12],[3,11],[3,10],[3,9],[3,8],[4,8],[5,8],[6,8],[7,8],[8,8],[8,7]]
JUMPS_M = []
EXTRA_M = {"no":3,"mech":"tombola","forks":["toggle","toggle"],"size":"m","stars":[{"n":0,"loges":[2,6,10,15,20,25,30,36]},{"n":1,"loges":[42,47,54,59,66]},{"n":1,"loges":[73,78,90,97]}]}
```

### A.5 Le Camping — taille M (100 cases)

1 Départ · 52 Applaudissements · 13 Pub · 16 Enveloppe · 18 Loge.

```
     -9-8-7-6-5-4-3-2-1 0 1 2 3 4 5 6 7 8 910
  -8  · · · · · · · · · A A A L A E P A L A E
  -7  · · · · · · · · · A · · · · · · · · · A
  -6  · · · · · · · · · E · · · · · · · · · A
  -5  · · · · · · · · · A · · · · · · · · · A
  -4  · · · · · · · · · L · · · · · · · · · A
  -3  · · · · · · · · · A · · · · · · · · · L
  -2  · · · · · · · · · P E A L A · L A P E A
  -1  · · · · · · · · · · · · · A · A · · · ·
   0  L A E A A A A L · · · · · A P L · · · ·
   1  A · · · · · · A · · · · · E · A · · · ·
   2  P · · · · · · E · · · · · A · A · · · ·
   3  E · · · · · · P A A A E P L · E P L A A
   4  A · · · · · · · · L · · · · · · · · · E
   5  L · · · · · · A A P A E A L · E A A L P
   6  A · · · · · · L · · · · · P · P · · · ·
   7  A · · · · · · A · · · · · A · L · · · ·
   8  A A E A L A P E · · · · · D A A · · · ·
```

```
       -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10
  -8    ·   ·   ·   ·   ·   ·   ·   ·   ·  78  79  80  81  82  83  84  85  86  87  88
  -7    ·   ·   ·   ·   ·   ·   ·   ·   ·  77   ·   ·   ·   ·   ·   ·   ·   ·   ·  89
  -6    ·   ·   ·   ·   ·   ·   ·   ·   ·  76   ·   ·   ·   ·   ·   ·   ·   ·   ·  90
  -5    ·   ·   ·   ·   ·   ·   ·   ·   ·  75   ·   ·   ·   ·   ·   ·   ·   ·   ·  91
  -4    ·   ·   ·   ·   ·   ·   ·   ·   ·  74   ·   ·   ·   ·   ·   ·   ·   ·   ·  92
  -3    ·   ·   ·   ·   ·   ·   ·   ·   ·  73   ·   ·   ·   ·   ·   ·   ·   ·   ·  93
  -2    ·   ·   ·   ·   ·   ·   ·   ·   ·  72  71  70  69  68   ·  98  97  96  95  94
  -1    ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·  67   ·  99   ·   ·   ·   ·
   0   55  56  57  58  59  60  61  62   ·   ·   ·   ·   ·  16  17  18   ·   ·   ·   ·
   1   54   ·   ·   ·   ·   ·   ·  63   ·   ·   ·   ·   ·  15   ·  19   ·   ·   ·   ·
   2   53   ·   ·   ·   ·   ·   ·  64   ·   ·   ·   ·   ·  14   ·  20   ·   ·   ·   ·
   3   52   ·   ·   ·   ·   ·   ·  65  66   9  10  11  12  13   ·  21  22  23  24  25
   4   51   ·   ·   ·   ·   ·   ·   ·   ·   8   ·   ·   ·   ·   ·   ·   ·   ·   ·  26
   5   50   ·   ·   ·   ·   ·   ·  37  36   7   6   5   4   3   ·  31  30  29  28  27
   6   49   ·   ·   ·   ·   ·   ·  38   ·   ·   ·   ·   ·   2   ·  32   ·   ·   ·   ·
   7   48   ·   ·   ·   ·   ·   ·  39   ·   ·   ·   ·   ·   1   ·  33   ·   ·   ·   ·
   8   47  46  45  44  43  42  41  40   ·   ·   ·   ·   ·   0  35  34   ·   ·   ·   ·
```

```ts
CELLS_M = ['start','clap','pub','loge','clap','env','clap','pub','loge','clap','clap','env','pub','loge','clap','env','clap','pub','loge','clap','clap','env','pub','loge','clap','clap','env','pub','loge','clap','clap','env','pub','loge','clap','clap','clap','clap','loge','clap','env','pub','clap','loge','clap','env','clap','clap','clap','clap','loge','clap','env','pub','clap','loge','clap','env','clap','clap','clap','clap','loge','clap','env','pub','clap','clap','clap','loge','clap','env','pub','clap','loge','clap','env','clap','clap','clap','clap','loge','clap','env','pub','clap','loge','clap','env','clap','clap','clap','clap','loge','clap','env','pub','clap','loge','clap']
NEXT_M = [1,2,3,4,5,6,7,[8,36],9,10,11,12,13,14,15,16,[17,67],18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,0,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,9,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,18]
PREV_M = [35,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,7,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,16,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98]
XY_M = [[4,8],[4,7],[4,6],[4,5],[3,5],[2,5],[1,5],[0,5],[0,4],[0,3],[1,3],[2,3],[3,3],[4,3],[4,2],[4,1],[4,0],[5,0],[6,0],[6,1],[6,2],[6,3],[7,3],[8,3],[9,3],[10,3],[10,4],[10,5],[9,5],[8,5],[7,5],[6,5],[6,6],[6,7],[6,8],[5,8],[-1,5],[-2,5],[-2,6],[-2,7],[-2,8],[-3,8],[-4,8],[-5,8],[-6,8],[-7,8],[-8,8],[-9,8],[-9,7],[-9,6],[-9,5],[-9,4],[-9,3],[-9,2],[-9,1],[-9,0],[-8,0],[-7,0],[-6,0],[-5,0],[-4,0],[-3,0],[-2,0],[-2,1],[-2,2],[-2,3],[-1,3],[4,-1],[4,-2],[3,-2],[2,-2],[1,-2],[0,-2],[0,-3],[0,-4],[0,-5],[0,-6],[0,-7],[0,-8],[1,-8],[2,-8],[3,-8],[4,-8],[5,-8],[6,-8],[7,-8],[8,-8],[9,-8],[10,-8],[10,-7],[10,-6],[10,-5],[10,-4],[10,-3],[10,-2],[9,-2],[8,-2],[7,-2],[6,-2],[6,-1]]
JUMPS_M = []
EXTRA_M = {"no":4,"mech":"riton","forks":["toggle","toggle"],"riton_start":18,"size":"m","stars":[{"n":0,"loges":[3,8,13,18,23,28,33]},{"n":1,"loges":[38,43,50,55,62]},{"n":1,"loges":[69,74,81,86,93,98]}],"pack":[{"name":"Rita","start":51,"path":[66,65,64,63,62,61,60,59,58,57,56,55,54,53,52,51,50,49,48,47,46,45,44,43,42,41,40,39,38,37,36]},{"name":"Ritou","start":83,"path":[99,98,97,96,95,94,93,92,91,90,89,88,87,86,85,84,83,82,81,80,79,78,77,76,75,74,73,72,71,70,69,68,67]}]}
```

### A.6 Dédé 2000 — taille M (105 cases)

1 Départ · 47 Applaudissements · 12 Pub · 13 Enveloppe · 16 Loge · 9 Télésiège · 5 Verglas · 2 Halte.

```
     -9-8-7-6-5-4-3-2-1 0 1 2 3 4 5 6 7 8 910111213141516171819
  -4  A E A A G A E A P A A L A · · · A L A A P A E A G A A E A
  -3  L · · · · · · · · · · · · · · · · · · · · · · · · · · · L
  -2  A A M A A A L M P E A L A H · H A L A E P M L A A A M A A
  -1  · · · · · · · · · · · · · · · · · · · · · · · · · · · · ·
   0  · · · · · · · · · A L P A M A E M L P A · · · · · · · · ·
   1  · · · · · · · · · E · · · · · · · · · E · · · · · · · · ·
   2  · · · · · · · · · M · A E A G P A G · A · · · · · · · · ·
   3  · · · · · · · · · P · L · · · · · A · M · · · · · · · · ·
   4  · · · · · · · · · L · P · · · · · L · L · · · · · · · · ·
   5  · · · · · · · · · M · A · · · · · · · P · · · · · · · · ·
   6  · · · · · · · · · A · G · · · · · · · A · · · · · · · · ·
   7  · · · · · · · · · A · E · · · · · · · E · · · · · · · · ·
   8  · · · · · · · · · D · A L P A E A L P A · · · · · · · · ·
```

```
       -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11  12  13  14  15  16  17  18  19
  -4   64  65  66  67  68  69  70  71  72  73  74  75  76   ·   ·   · 104 103 102 101 100  99  98  97  96  95  94  93  92
  -3   63   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·  91
  -2   62  61  60  59  58  57  56  55  54  53  52  51  50  49   ·  77  78  79  80  81  82  83  84  85  86  87  88  89  90
  -1    ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·
   0    ·   ·   ·   ·   ·   ·   ·   ·   ·   8   9  10  11  12  13  14  15  16  17  18   ·   ·   ·   ·   ·   ·   ·   ·   ·
   1    ·   ·   ·   ·   ·   ·   ·   ·   ·   7   ·   ·   ·   ·   ·   ·   ·   ·   ·  19   ·   ·   ·   ·   ·   ·   ·   ·   ·
   2    ·   ·   ·   ·   ·   ·   ·   ·   ·   6   ·  40  41  42  43  44  45  46   ·  20   ·   ·   ·   ·   ·   ·   ·   ·   ·
   3    ·   ·   ·   ·   ·   ·   ·   ·   ·   5   ·  39   ·   ·   ·   ·   ·  47   ·  21   ·   ·   ·   ·   ·   ·   ·   ·   ·
   4    ·   ·   ·   ·   ·   ·   ·   ·   ·   4   ·  38   ·   ·   ·   ·   ·  48   ·  22   ·   ·   ·   ·   ·   ·   ·   ·   ·
   5    ·   ·   ·   ·   ·   ·   ·   ·   ·   3   ·  37   ·   ·   ·   ·   ·   ·   ·  23   ·   ·   ·   ·   ·   ·   ·   ·   ·
   6    ·   ·   ·   ·   ·   ·   ·   ·   ·   2   ·  36   ·   ·   ·   ·   ·   ·   ·  24   ·   ·   ·   ·   ·   ·   ·   ·   ·
   7    ·   ·   ·   ·   ·   ·   ·   ·   ·   1   ·  35   ·   ·   ·   ·   ·   ·   ·  25   ·   ·   ·   ·   ·   ·   ·   ·   ·
   8    ·   ·   ·   ·   ·   ·   ·   ·   ·   0   ·  34  33  32  31  30  29  28  27  26   ·   ·   ·   ·   ·   ·   ·   ·   ·
```

`CELLS_M` et `XY_M` = les 105 premières entrées de `CELLS_L` et `XY_L` (A.7), à écrire en entier dans le fichier.

```ts
NEXT_M = [1,2,3,4,5,6,7,8,9,10,11,[12,49],13,77,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,0,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,14,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,18]
PREV_M = [48,0,1,2,3,4,5,6,7,8,9,10,11,12,76,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,11,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,13,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103]
JUMPS_M = [[48,0],[11,49],[76,14],[13,77],[104,18]]
EXTRA_M = {"no":5,"mech":"tp","forks":["toggle"],"tp":{"3":37,"6":40,"12":42,"15":45,"21":47,"36":2,"43":13,"46":20,"55":71,"60":66,"68":58,"83":99,"88":94,"96":86},"size":"m","stars":[{"n":0,"loges":[4,9,16,22,28,33,39,48]},{"n":1,"loges":[51,56,63,75]},{"n":1,"loges":[79,84,91,103]}]}
```

### A.7 Dédé 2000 — taille L (204 cases)

1 Départ · 91 Applaudissements · 26 Pub · 23 Enveloppe · 33 Loge · 17 Télésiège · 9 Verglas · 4 Halte.

```
     -9-8-7-6-5-4-3-2-1 0 1 2 3 4 5 6 7 8 910111213141516171819
 -12  · · · L A E P A L G E A P A L A P A E G L A P E A L · · ·
 -11  · · · A · · · · · · · · · · · · · · · · · · · · · A · · ·
 -10  · · · A P G E A L A P M A · · · A M P A L A E G P A · · ·
  -9  · · · · · · · · · · · · L · · · L · · · · · · · · · · · ·
  -8  · L A E A A L M E A P A A · · · A A P A E M L A A E A L ·
  -7  · A · · · · · · · · · · · · · · · · · · · · · · · · · A ·
  -6  · A P A M A L A P M A L A H · H A L A M P A L A M A P A ·
  -5  · · · · · · · · · · · · · · · · · · · · · · · · · · · · ·
  -4  A E A A G A E A P A A L A · · · A L A A P A E A G A A E A
  -3  L · · · · · · · · · · · · · · · · · · · · · · · · · · · L
  -2  A A M A A A L M P E A L A H · H A L A E P M L A A A M A A
  -1  · · · · · · · · · · · · · · · · · · · · · · · · · · · · ·
   0  · · · · · · · · · A L P A M A E M L P A · · · · · · · · ·
   1  · · · · · · · · · E · · · · · · · · · E · · · · · · · · ·
   2  · · · · · · · · · M · A E A G P A G · A · · · · · · · · ·
   3  · · · · · · · · · P · L · · · · · A · M · · · · · · · · ·
   4  · · · · · · · · · L · P · · · · · L · L · · · · · · · · ·
   5  · · · · · · · · · M · A · · · · · · · P · · · · · · · · ·
   6  · · · · · · · · · A · G · · · · · · · A · · · · · · · · ·
   7  · · · · · · · · · A · E · · · · · · · E · · · · · · · · ·
   8  · · · · · · · · · D · A L P A E A L P A · · · · · · · · ·
```

```
       -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11  12  13  14  15  16  17  18  19
 -12    ·   ·   · 143 144 145 146 147 148 149 150 151 152 153 154 203 202 201 200 199 198 197 196 195 194 193   ·   ·   ·
 -11    ·   ·   · 142   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   · 192   ·   ·   ·
 -10    ·   ·   · 141 140 139 138 137 136 135 134 133 132   ·   ·   · 182 183 184 185 186 187 188 189 190 191   ·   ·   ·
  -9    ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   · 131   ·   ·   · 181   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·
  -8    · 119 120 121 122 123 124 125 126 127 128 129 130   ·   ·   · 180 179 178 177 176 175 174 173 172 171 170 169   ·
  -7    · 118   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   · 168   ·
  -6    · 117 116 115 114 113 112 111 110 109 108 107 106 105   · 155 156 157 158 159 160 161 162 163 164 165 166 167   ·
  -5    ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·
  -4   64  65  66  67  68  69  70  71  72  73  74  75  76   ·   ·   · 104 103 102 101 100  99  98  97  96  95  94  93  92
  -3   63   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·  91
  -2   62  61  60  59  58  57  56  55  54  53  52  51  50  49   ·  77  78  79  80  81  82  83  84  85  86  87  88  89  90
  -1    ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·
   0    ·   ·   ·   ·   ·   ·   ·   ·   ·   8   9  10  11  12  13  14  15  16  17  18   ·   ·   ·   ·   ·   ·   ·   ·   ·
   1    ·   ·   ·   ·   ·   ·   ·   ·   ·   7   ·   ·   ·   ·   ·   ·   ·   ·   ·  19   ·   ·   ·   ·   ·   ·   ·   ·   ·
   2    ·   ·   ·   ·   ·   ·   ·   ·   ·   6   ·  40  41  42  43  44  45  46   ·  20   ·   ·   ·   ·   ·   ·   ·   ·   ·
   3    ·   ·   ·   ·   ·   ·   ·   ·   ·   5   ·  39   ·   ·   ·   ·   ·  47   ·  21   ·   ·   ·   ·   ·   ·   ·   ·   ·
   4    ·   ·   ·   ·   ·   ·   ·   ·   ·   4   ·  38   ·   ·   ·   ·   ·  48   ·  22   ·   ·   ·   ·   ·   ·   ·   ·   ·
   5    ·   ·   ·   ·   ·   ·   ·   ·   ·   3   ·  37   ·   ·   ·   ·   ·   ·   ·  23   ·   ·   ·   ·   ·   ·   ·   ·   ·
   6    ·   ·   ·   ·   ·   ·   ·   ·   ·   2   ·  36   ·   ·   ·   ·   ·   ·   ·  24   ·   ·   ·   ·   ·   ·   ·   ·   ·
   7    ·   ·   ·   ·   ·   ·   ·   ·   ·   1   ·  35   ·   ·   ·   ·   ·   ·   ·  25   ·   ·   ·   ·   ·   ·   ·   ·   ·
   8    ·   ·   ·   ·   ·   ·   ·   ·   ·   0   ·  34  33  32  31  30  29  28  27  26   ·   ·   ·   ·   ·   ·   ·   ·   ·
```

```ts
CELLS_L = ['start','clap','clap','lift','loge','pub','lift','env','clap','loge','pub','clap','lift','clap','env','lift','loge','pub','clap','env','clap','lift','loge','pub','clap','env','clap','pub','loge','clap','env','clap','pub','loge','clap','env','ice','clap','pub','loge','clap','env','clap','ice','pub','clap','ice','clap','loge','halt','clap','loge','clap','env','pub','lift','loge','clap','clap','clap','lift','clap','clap','loge','clap','env','clap','clap','ice','clap','env','clap','pub','clap','clap','loge','clap','halt','clap','loge','clap','env','pub','lift','loge','clap','clap','clap','lift','clap','clap','loge','clap','env','clap','clap','ice','clap','env','clap','pub','clap','clap','loge','clap','halt','clap','loge','clap','lift','pub','clap','loge','clap','lift','clap','pub','clap','clap','loge','clap','env','clap','clap','loge','lift','env','clap','pub','clap','clap','loge','clap','lift','pub','clap','loge','clap','env','ice','pub','clap','clap','loge','clap','env','pub','clap','loge','ice','env','clap','pub','clap','loge','halt','clap','loge','clap','lift','pub','clap','loge','clap','lift','clap','pub','clap','clap','loge','clap','env','clap','clap','loge','lift','env','clap','pub','clap','clap','loge','clap','lift','pub','clap','loge','clap','env','ice','pub','clap','clap','loge','clap','env','pub','clap','loge','ice','env','clap','pub','clap']
NEXT_L = [1,2,3,4,5,6,7,8,9,10,11,[12,49],13,77,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,0,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,[14,105],78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,[18,155],106,107,108,109,110,111,112,113,114,115,116,117,118,119,120,121,122,123,124,125,126,127,128,129,130,[131,20],132,133,134,135,136,137,138,139,140,141,142,143,144,145,146,147,148,149,150,151,152,153,154,0,156,157,158,159,160,161,162,163,164,165,166,167,168,169,170,171,172,173,174,175,176,177,178,179,180,[181,24],182,183,184,185,186,187,188,189,190,191,192,193,194,195,196,197,198,199,200,201,202,203,154]
PREV_L = [48,0,1,2,3,4,5,6,7,8,9,10,11,12,76,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,11,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,13,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,76,105,106,107,108,109,110,111,112,113,114,115,116,117,118,119,120,121,122,123,124,125,126,127,128,129,130,131,132,133,134,135,136,137,138,139,140,141,142,143,144,145,146,147,148,149,150,151,152,153,104,155,156,157,158,159,160,161,162,163,164,165,166,167,168,169,170,171,172,173,174,175,176,177,178,179,180,181,182,183,184,185,186,187,188,189,190,191,192,193,194,195,196,197,198,199,200,201,202]
XY_L = [[0,8],[0,7],[0,6],[0,5],[0,4],[0,3],[0,2],[0,1],[0,0],[1,0],[2,0],[3,0],[4,0],[5,0],[6,0],[7,0],[8,0],[9,0],[10,0],[10,1],[10,2],[10,3],[10,4],[10,5],[10,6],[10,7],[10,8],[9,8],[8,8],[7,8],[6,8],[5,8],[4,8],[3,8],[2,8],[2,7],[2,6],[2,5],[2,4],[2,3],[2,2],[3,2],[4,2],[5,2],[6,2],[7,2],[8,2],[8,3],[8,4],[4,-2],[3,-2],[2,-2],[1,-2],[0,-2],[-1,-2],[-2,-2],[-3,-2],[-4,-2],[-5,-2],[-6,-2],[-7,-2],[-8,-2],[-9,-2],[-9,-3],[-9,-4],[-8,-4],[-7,-4],[-6,-4],[-5,-4],[-4,-4],[-3,-4],[-2,-4],[-1,-4],[0,-4],[1,-4],[2,-4],[3,-4],[6,-2],[7,-2],[8,-2],[9,-2],[10,-2],[11,-2],[12,-2],[13,-2],[14,-2],[15,-2],[16,-2],[17,-2],[18,-2],[19,-2],[19,-3],[19,-4],[18,-4],[17,-4],[16,-4],[15,-4],[14,-4],[13,-4],[12,-4],[11,-4],[10,-4],[9,-4],[8,-4],[7,-4],[4,-6],[3,-6],[2,-6],[1,-6],[0,-6],[-1,-6],[-2,-6],[-3,-6],[-4,-6],[-5,-6],[-6,-6],[-7,-6],[-8,-6],[-8,-7],[-8,-8],[-7,-8],[-6,-8],[-5,-8],[-4,-8],[-3,-8],[-2,-8],[-1,-8],[0,-8],[1,-8],[2,-8],[3,-8],[3,-9],[3,-10],[2,-10],[1,-10],[0,-10],[-1,-10],[-2,-10],[-3,-10],[-4,-10],[-5,-10],[-6,-10],[-6,-11],[-6,-12],[-5,-12],[-4,-12],[-3,-12],[-2,-12],[-1,-12],[0,-12],[1,-12],[2,-12],[3,-12],[4,-12],[5,-12],[6,-6],[7,-6],[8,-6],[9,-6],[10,-6],[11,-6],[12,-6],[13,-6],[14,-6],[15,-6],[16,-6],[17,-6],[18,-6],[18,-7],[18,-8],[17,-8],[16,-8],[15,-8],[14,-8],[13,-8],[12,-8],[11,-8],[10,-8],[9,-8],[8,-8],[7,-8],[7,-9],[7,-10],[8,-10],[9,-10],[10,-10],[11,-10],[12,-10],[13,-10],[14,-10],[15,-10],[16,-10],[16,-11],[16,-12],[15,-12],[14,-12],[13,-12],[12,-12],[11,-12],[10,-12],[9,-12],[8,-12],[7,-12],[6,-12]]
JUMPS_L = [[48,0],[11,49],[76,14],[13,77],[104,18],[76,105],[154,0],[104,155],[130,20],[180,24]]
EXTRA_L = {"no":5,"mech":"tp","forks":["toggle","toggle","toggle","toggle","toggle"],"tp":{"3":37,"6":40,"12":42,"15":45,"21":47,"36":2,"43":13,"46":20,"55":71,"60":66,"68":58,"83":99,"88":94,"96":86,"109":127,"114":122,"125":137,"133":151,"139":123,"149":135,"159":177,"164":172,"175":187,"183":201,"189":173,"199":185},"size":"l","stars":[{"n":0,"loges":[4,9,16,22,28,33,39,48]},{"n":1,"loges":[51,56,63,75]},{"n":1,"loges":[79,84,91,103]},{"n":2,"loges":[107,112,119,124,131,136,143,148,154]},{"n":2,"loges":[157,162,169,174,181,186,193,198]}],"starts":[49,77,105,155]}
```
