# Saisons de boutique — spec de conception

Date : 2026-11-22 · Statut : conception validée sur le principe, prête à planifier · Aucune ligne de code dans ce document (les blocs « données » sont des entrées de catalogue prêtes à copier).

## 0. Résumé

- L'année est découpée en **4 saisons** calendaires. Chaque saison a un thème, un décor d'onglet Boutique, une **collection limitée de 9 articles** achetables en pièces 🪙 uniquement pendant la saison, et un **passe de saison gratuit de 20 paliers**.
- La **vitrine hebdo actuelle ne change pas** (6 articles permanents tirés chaque lundi). La collection de saison s'affiche **au-dessus**, en entier, pendant toute la saison.
- Le passe se remplit tout seul en jouant (points dérivés de l'historique, comme les pièces). Les récompenses sont **données automatiquement**, sans bouton à ne pas oublier.
- Rien n'est jamais perdu définitivement : les collections et les passes **reviennent chaque année** à l'identique.
- Première saison : **Hiver, le 1er décembre 2026**. Avant cette date, la boutique reste telle qu'elle est aujourd'hui.

Contraintes respectées : aucun nouveau champ visuel. Tous les articles utilisent uniquement `frame` (ring / emojis / dots / count / dotScale / top / spin), `cardBack` (bg / emoji), `dice` (face / edge / pip), `marks` (outline / glow / dash), `kart.body`, `golf.color` + `golf.stripe`, `bowling.color` + `bowling.band`. Pas d'article `chess`, pas de nouveau `style` de balle / boule, pas de nouveau `variant` de kart (ils demanderaient du code de rendu).

---

## 1. Calendrier des saisons

Toutes les dates sont en heure de Paris (`Europe/Paris`). Une saison commence le premier jour à 00:00 et se termine la veille de la suivante à 23:59:59.

| id | Nom affiché | Début | Fin | Emoji |
|---|---|---|---|---|
| `hiver` | Tous au chalet | 1er décembre | 28 février (29 les années bissextiles) | ⛷️ |
| `printemps` | Le Grand Réveil | 1er mars | 31 mai | 🌷 |
| `ete` | Camping des Flots Dédé | 1er juin | 31 août | 🏖️ |
| `automne` | La Rentrée des Frissons | 1er septembre | 30 novembre | 🎃 |

- **Clé d'édition** (`season_key`) : `<id>-<année du jour de début>`. Janvier 2027 appartient à `hiver-2026`.
- **Date de lancement** : `2026-12-01`. Aucune saison n'existe avant (pas de passe rétroactif pour l'automne 2026).
- Premières éditions : `hiver-2026` (1er déc. 2026 → 28 fév. 2027), `printemps-2027` (1er mars → 31 mai 2027), `ete-2027` (1er juin → 31 août 2027), `automne-2027` (1er sept. → 30 nov. 2027).
- L'hiver cohabite avec le calendrier de l'Avent : les deux sont indépendants. Le thème d'hiver évite volontairement Noël (déjà couvert par l'Avent) : ski, raclette, galette.

### Décor de l'onglet Boutique

Le décor s'applique à l'en-tête de l'onglet Boutique (bandeau de saison) et à la section « Collection » + « Passe ». Le reste de l'onglet (vitrine de la semaine) garde le style actuel. Chaque couleur est donnée pour le thème clair ; en thème sombre, utiliser le fond sombre indiqué et garder les mêmes accents.

| Saison | Fond du bandeau (clair) | Fond du bandeau (sombre) | Accent principal | Accent secondaire | Emojis flottants du bandeau |
|---|---|---|---|---|---|
| Hiver | `linear-gradient(135deg, #DDF4FF, #FFFFFF)` | `linear-gradient(135deg, #14213D, #1D3557)` | `#1D6FA3` | `#E63946` | ⛷️ 🧀 ❄️ 🏔️ |
| Printemps | `linear-gradient(135deg, #EAFBE7, #FFF0F6)` | `linear-gradient(135deg, #1B4332, #40263A)` | `#2DC653` | `#FF8FAB` | 🌷 🐣 🐝 🌦️ |
| Été | `linear-gradient(135deg, #FFF3B0, #BDEBFF)` | `linear-gradient(135deg, #5A3E00, #023E58)` | `#FF7B00` | `#00A6D6` | 🏖️ ⛱️ 🍦 🩴 |
| Automne | `linear-gradient(135deg, #FFE8CC, #E9D5FF)` | `linear-gradient(135deg, #3D1F00, #2B1B3D)` | `#F77F00` | `#7B2CBF` | 🎃 🍂 👻 🍄 |

Style « sticker book » habituel : contour épais couleur encre, ombre décalée `box-shadow: 4px 4px 0 <ink>`. L'accent principal colore la barre de progression du passe et le bouton « Acheter » des articles de saison ; l'accent secondaire colore la pastille « Limité » et le compte à rebours. Les 4 emojis flottent doucement dans le bandeau (framer-motion, léger va-et-vient vertical, décalés entre eux).

Bandeaux d'accroche (titre + sous-titre) :

| Saison | Titre du bandeau | Sous-titre |
|---|---|---|
| Hiver | ⛷️ Tous au chalet ! | Raclette à volonté, gamelles à ski offertes. |
| Printemps | 🌷 Le Grand Réveil | Les oiseaux chantent, les allergiques éternuent, tout le monde triche. |
| Été | 🏖️ Camping des Flots Dédé | Emplacement ombragé, mauvaise foi en plein soleil. |
| Automne | 🎃 La Rentrée des Frissons | Ça sent la citrouille, le cartable neuf et la tricherie. |

---

## 2. Collections limitées

Chaque collection compte **9 articles** : 3 à 100 🪙, 4 à 250 🪙, 2 à 500 🪙 (collection complète = 2 300 🪙). C'est volontairement plus qu'un joueur régulier ne gagne en une saison (voir 3.4) : on choisit ses préférés, le reste revient l'an prochain.

Les blocs ci-dessous sont au format de `ITEMS` (`src/data/cadeaux.ts`), avec deux champs nouveaux décrits en section 6 : `season` (saison de l'article) et `passTier` (palier du passe, section 3). Les ids ne collisionnent avec aucun article existant.

### 2.1 Hiver — « Tous au chalet »

```ts
{ id: 't_tout_schuss', slot: 'title', label: 'Tout schuss', emoji: '⛷️', price: 100, season: 'hiver' },
{ id: 't_raclette', slot: 'title', label: 'Team raclette', emoji: '🧀', price: 100, season: 'hiver' },
{ id: 'k_glacier', slot: 'kart', label: 'Bleu glacier', emoji: '🧊', price: 100, season: 'hiver', kart: { body: '#7FD6F2' } },
{ id: 'f_bonnet', slot: 'frame', label: 'Bonnet à pompon', emoji: '🧶', price: 250, season: 'hiver', frame: { ring: '#E63946', dots: ['#FFFFFF'], count: 12, dotScale: 0.6, top: '🧶' } },
{ id: 'cb_pull_moche', slot: 'card_back', label: 'Pull moche', emoji: '🦌', price: 250, season: 'hiver', cardBack: { bg: 'repeating-linear-gradient(0deg, #C1121F 0 10px, #FFFFFF 10px 12px, #2D6A4F 12px 22px, #FFFFFF 22px 24px)', emoji: '🦌' } },
{ id: 'd_chocolat_chaud', slot: 'dice', label: 'Dés chocolat chaud', emoji: '☕', price: 250, season: 'hiver', dice: { face: '#6B3E26', edge: '#3E2214', pip: '#FFF3E0' } },
{ id: 'gb_boule_neige', slot: 'golf_ball', label: 'Balle boule de neige', emoji: '❄️', price: 250, season: 'hiver', golf: { color: '#F4FBFF', stripe: '#8ECAE6' } },
{ id: 'm_givre', slot: 'marks', label: 'Givre', emoji: '🧊', price: 500, season: 'hiver', marks: { outline: '#BDE8FF', glow: '#4CC9F0' } },
{ id: 'f_blizzard', slot: 'frame', label: 'Blizzard', emoji: '🏔️', price: 500, season: 'hiver', frame: { ring: 'conic-gradient(#FFFFFF, #8ECAE6, #1D6FA3, #8ECAE6, #FFFFFF)', spin: true, emojis: ['❄️'], count: 4, top: '🏔️' } },
```

### 2.2 Printemps — « Le Grand Réveil »

```ts
{ id: 't_poisson_avril', slot: 'title', label: 'Poisson d’avril permanent', emoji: '🐟', price: 100, season: 'printemps' },
{ id: 't_allergique', slot: 'title', label: 'Allergique à la défaite', emoji: '🤧', price: 100, season: 'printemps' },
{ id: 'gb_oeuf', slot: 'golf_ball', label: 'Balle œuf en chocolat', emoji: '🥚', price: 100, season: 'printemps', golf: { color: '#6B3E26', stripe: '#FFD166' } },
{ id: 'f_potager', slot: 'frame', label: 'Potager du dimanche', emoji: '🪴', price: 250, season: 'printemps', frame: { ring: '#8D5A2B', emojis: ['🌱', '🥕', '🐛'], count: 6, top: '🪴' } },
{ id: 'cb_pique_nique', slot: 'card_back', label: 'Nappe de pique-nique', emoji: '🧺', price: 250, season: 'printemps', cardBack: { bg: 'linear-gradient(90deg, rgba(230,57,70,0.5) 50%, transparent 50%) 0 0 / 16px 16px, linear-gradient(rgba(230,57,70,0.5) 50%, transparent 50%) 0 0 / 16px 16px, #FFFFFF', emoji: '🧺' } },
{ id: 'd_poussin', slot: 'dice', label: 'Dés poussin', emoji: '🐥', price: 250, season: 'printemps', dice: { face: '#FFE066', edge: '#F4B400', pip: '#FF7B00' } },
{ id: 'k_coccinelle', slot: 'kart', label: 'Rouge coccinelle', emoji: '🐞', price: 250, season: 'printemps', kart: { body: '#E01E37' } },
{ id: 'm_herbe', slot: 'marks', label: 'Herbe fraîche', emoji: '🌱', price: 500, season: 'printemps', marks: { outline: '#2DC653', glow: '#B5E48C' } },
{ id: 'f_giboulees', slot: 'frame', label: 'Giboulées', emoji: '🌦️', price: 500, season: 'printemps', frame: { ring: 'conic-gradient(#8ECAE6, #FFE066, #B5E48C, #FF8FAB, #8ECAE6)', spin: true, emojis: ['💧', '🌸'], count: 6, top: '🌦️' } },
```

### 2.3 Été — « Camping des Flots Dédé »

```ts
{ id: 't_coup_soleil', slot: 'title', label: 'Coup de soleil intégral', emoji: '🥵', price: 100, season: 'ete' },
{ id: 't_tong', slot: 'title', label: 'Tong gauche perdue', emoji: '🩴', price: 100, season: 'ete' },
{ id: 'bb_petanque', slot: 'bowling_ball', label: 'Boule de pétanque', emoji: '⚪', price: 100, season: 'ete', bowling: { color: '#9AA3AD', band: '#5C6670' } },
{ id: 'cb_transat', slot: 'card_back', label: 'Transat', emoji: '⛱️', price: 250, season: 'ete', cardBack: { bg: 'repeating-linear-gradient(90deg, #00A6D6 0 12px, #FFFFFF 12px 24px)', emoji: '⛱️' } },
{ id: 'd_piscine', slot: 'dice', label: 'Dés piscine', emoji: '💦', price: 250, season: 'ete', dice: { face: '#48CAE4', edge: '#0096C7', pip: '#FFFFFF' } },
{ id: 'k_canard', slot: 'kart', label: 'Jaune bouée canard', emoji: '🦆', price: 250, season: 'ete', kart: { body: '#FFD60A' } },
{ id: 'f_bouee', slot: 'frame', label: 'Bouée de sauvetage', emoji: '🛟', price: 250, season: 'ete', frame: { ring: 'repeating-conic-gradient(#E63946 0 45deg, #FFFFFF 45deg 90deg)', top: '🛟' } },
{ id: 'm_fluo', slot: 'marks', label: 'Bracelet fluo', emoji: '🟢', price: 500, season: 'ete', marks: { outline: '#39FF14', glow: '#CCFF00' } },
{ id: 'f_coucher_soleil', slot: 'frame', label: 'Coucher de soleil', emoji: '🌅', price: 500, season: 'ete', frame: { ring: 'conic-gradient(#FF7B00, #FF4D6D, #7B2CBF, #FFD166, #FF7B00)', spin: true, top: '🌅' } },
```

### 2.4 Automne — « La Rentrée des Frissons »

```ts
{ id: 't_cartable', slot: 'title', label: 'Cartable trop lourd', emoji: '🎒', price: 100, season: 'automne' },
{ id: 't_bonbon_ou_gage', slot: 'title', label: 'Un bonbon ou un gage', emoji: '🍬', price: 100, season: 'automne' },
{ id: 'gb_citrouille', slot: 'golf_ball', label: 'Balle citrouille', emoji: '🎃', price: 100, season: 'automne', golf: { color: '#F77F00', stripe: '#2D6A4F' } },
{ id: 'f_feuilles', slot: 'frame', label: 'Feuilles mortes', emoji: '🍂', price: 250, season: 'automne', frame: { ring: '#8C4A1F', emojis: ['🍂', '🍁'], count: 6 } },
{ id: 'cb_toile', slot: 'card_back', label: 'Toile d’araignée', emoji: '🕸️', price: 250, season: 'automne', cardBack: { bg: 'repeating-radial-gradient(circle at 50% 50%, transparent 0 9px, rgba(255,255,255,0.35) 9px 10px), repeating-conic-gradient(from 0deg at 50% 50%, rgba(255,255,255,0.35) 0 2deg, transparent 2deg 45deg), #2B1B3D', emoji: '🕷️' } },
{ id: 'd_potion', slot: 'dice', label: 'Dés potion', emoji: '🧪', price: 250, season: 'automne', dice: { face: '#7B2CBF', edge: '#3C096C', pip: '#B5FF3D' } },
{ id: 'k_sorciere', slot: 'kart', label: 'Violet balai volant', emoji: '🧹', price: 250, season: 'automne', kart: { body: '#6A0DAD' } },
{ id: 'm_fantome', slot: 'marks', label: 'Fantôme', emoji: '👻', price: 500, season: 'automne', marks: { outline: '#F4F1EA', glow: '#B388FF', dash: true } },
{ id: 'f_pleine_lune', slot: 'frame', label: 'Pleine lune', emoji: '🌕', price: 500, season: 'automne', frame: { ring: 'conic-gradient(#2B1B3D, #7B2CBF, #F77F00, #7B2CBF, #2B1B3D)', spin: true, emojis: ['🦇'], count: 4, top: '🌕' } },
```

---

## 3. Le passe de saison

Gratuit, automatique, identique dans sa structure pour les 4 saisons. Nom affiché : **« Passe d'hiver »**, **« Passe de printemps »**, **« Passe d'été »**, **« Passe d'automne »**.

### 3.1 Gagner des points de passe (⭐)

Les points sont **dérivés de l'historique** de la saison (même principe que les pièces : rien à stocker, rétroactif, impossible à perdre). Seuls comptent les événements dont l'horodatage tombe dans la saison.

| Action | Points ⭐ | Source |
|---|---|---|
| Partie terminée | +10 | mêmes lignes `match_players` que celles qui rapportent des pièces |
| Victoire | +10 de plus (soit 20 la partie gagnée) | `match_players.won` |
| Défi du jour terminé | +15 | `daily_runs.finished_at` non nul |
| Soirée entre amis | +25, une seule fois par soirée | soirée où le joueur a terminé au moins 1 partie avec au moins 2 joueurs humains ; même définition de « soirée » que le trophée « Pilier de soirée » (`special: soirees` dans `trophees.sql`) |

Précisions :
- Les parties en solo contre les bots comptent pour « partie » et « victoire » si (et seulement si) elles rapportent déjà des pièces aujourd'hui. Elles ne donnent jamais le bonus « soirée ».
- Les trophées ne donnent pas de points de passe (ils donnent déjà 20 🪙).
- Pas de plafond quotidien : la bande compte 9 personnes, personne ne va farmer.
- Le texte d'aide affiché au joueur ne parle que de 4 lignes (voir section 5).

### 3.2 Paliers

- **20 paliers**, **40 ⭐ par palier**, soit **800 ⭐** pour finir le passe.
- Palier atteint = `min(20, floor(points / 40))`.
- Une fois le palier 20 atteint, le passe est terminé : la barre affiche « Passe terminé » et les points ne servent plus à rien pour cette saison (pas de paliers bonus).

### 3.3 Récompenses par palier

Grille de pièces commune aux 4 saisons ; seuls les 4 paliers à cosmétique (5, 10, 15, 20) changent de contenu.

| Palier | ⭐ cumulés | Récompense |
|---|---|---|
| 1 | 40 | 20 🪙 |
| 2 | 80 | 20 🪙 |
| 3 | 120 | 20 🪙 |
| 4 | 160 | 30 🪙 |
| **5** | 200 | **Cosmétique exclusif A** (objet de jeu) |
| 6 | 240 | 20 🪙 |
| 7 | 280 | 30 🪙 |
| 8 | 320 | 30 🪙 |
| 9 | 360 | 30 🪙 |
| **10** | 400 | **Cosmétique exclusif B** (cadre d'avatar) |
| 11 | 440 | 30 🪙 |
| 12 | 480 | 30 🪙 |
| 13 | 520 | 40 🪙 |
| 14 | 560 | 40 🪙 |
| **15** | 600 | **Cosmétique exclusif C** (objet de jeu) |
| 16 | 640 | 40 🪙 |
| 17 | 680 | 40 🪙 |
| 18 | 720 | 50 🪙 |
| 19 | 760 | 50 🪙 |
| **20** | 800 | **Titre de fin de passe** + 100 🪙 |

Total d'un passe terminé : **620 🪙** + 3 cosmétiques exclusifs + 1 titre exclusif. Première moitié (paliers 1 à 10) : 200 🪙 + 2 cosmétiques.

Les articles exclusifs du passe n'ont **pas de prix** : ils ne sont jamais vendus, ni en collection ni en vitrine.

#### Hiver

| Palier | Récompense |
|---|---|
| 5 | 🎳 Boule bûcheron |
| 10 | 🖼️ Cadre « Forfait saison » |
| 15 | 🃏 Dos de cartes « Nuit au chalet » |
| 20 | 🏷️ Titre « Yéti de salon » + 100 🪙 |

```ts
{ id: 'bb_bucheron', slot: 'bowling_ball', label: 'Boule bûcheron', emoji: '🪓', season: 'hiver', passTier: 5, bowling: { color: '#C1121F', band: '#1B4332' } },
{ id: 'f_forfait', slot: 'frame', label: 'Forfait saison', emoji: '🎿', season: 'hiver', passTier: 10, frame: { ring: 'repeating-linear-gradient(45deg, #1D6FA3 0 6px, #FFFFFF 6px 10px, #E63946 10px 16px, #FFFFFF 16px 20px)', top: '🎿' } },
{ id: 'cb_chalet', slot: 'card_back', label: 'Nuit au chalet', emoji: '🏔️', season: 'hiver', passTier: 15, cardBack: { bg: 'radial-gradient(#FFFFFF 1.5px, transparent 2px) 0 0 / 14px 14px, linear-gradient(180deg, #14213D, #3A5A8C)', emoji: '🏔️' } },
{ id: 't_yeti', slot: 'title', label: 'Yéti de salon', emoji: '🥶', season: 'hiver', passTier: 20 },
```

#### Printemps

| Palier | Récompense |
|---|---|
| 5 | 🎲 Dés menthe à l'eau |
| 10 | 🖼️ Cadre « Nid douillet » |
| 15 | 🎳 Boule tulipe |
| 20 | 🏷️ Titre « Jeune pousse pleine d'avenir » + 100 🪙 |

```ts
{ id: 'd_menthe_eau', slot: 'dice', label: 'Dés menthe à l’eau', emoji: '🥤', season: 'printemps', passTier: 5, dice: { face: '#B8F2D0', edge: '#52B788', pip: '#1B4332' } },
{ id: 'f_nid', slot: 'frame', label: 'Nid douillet', emoji: '🐣', season: 'printemps', passTier: 10, frame: { ring: 'repeating-conic-gradient(#A0703C 0 8deg, #C89B5E 8deg 16deg)', emojis: ['🥚'], count: 5, top: '🐣' } },
{ id: 'bb_tulipe', slot: 'bowling_ball', label: 'Boule tulipe', emoji: '🌷', season: 'printemps', passTier: 15, bowling: { color: '#FF5D8F', band: '#2DC653' } },
{ id: 't_jeune_pousse', slot: 'title', label: 'Jeune pousse pleine d’avenir', emoji: '🌱', season: 'printemps', passTier: 20 },
```

#### Été

| Palier | Récompense |
|---|---|
| 5 | ⛳ Balle ballon de plage |
| 10 | 🖼️ Cadre « Marchand de glaces » |
| 15 | 🃏 Dos de cartes « Barbecue » |
| 20 | 🏷️ Titre « Légende du camping » + 100 🪙 |

```ts
{ id: 'gb_ballon_plage', slot: 'golf_ball', label: 'Balle ballon de plage', emoji: '🏐', season: 'ete', passTier: 5, golf: { color: '#FFD60A', stripe: '#00A6D6' } },
{ id: 'f_glaces', slot: 'frame', label: 'Marchand de glaces', emoji: '🍦', season: 'ete', passTier: 10, frame: { ring: 'linear-gradient(135deg, #FFC2D4, #FFF6E5 50%, #B8F2D0)', emojis: ['🍦', '🍧', '🍉'], count: 6, top: '🍨' } },
{ id: 'cb_barbecue', slot: 'card_back', label: 'Barbecue', emoji: '🌭', season: 'ete', passTier: 15, cardBack: { bg: 'repeating-linear-gradient(0deg, #1F1B2E 0 4px, transparent 4px 14px), linear-gradient(180deg, #FF5A1F, #FFB703)', emoji: '🌭' } },
{ id: 't_legende_camping', slot: 'title', label: 'Légende du camping', emoji: '🏕️', season: 'ete', passTier: 20 },
```

#### Automne

| Palier | Récompense |
|---|---|
| 5 | 🎳 Boule châtaigne |
| 10 | 🖼️ Cadre « Champ de citrouilles » |
| 15 | 🎲 Dés champignon |
| 20 | 🏷️ Titre « Terreur des soirées » + 100 🪙 |

```ts
{ id: 'bb_chataigne', slot: 'bowling_ball', label: 'Boule châtaigne', emoji: '🌰', season: 'automne', passTier: 5, bowling: { color: '#5C3317', band: '#C89B5E' } },
{ id: 'f_citrouilles', slot: 'frame', label: 'Champ de citrouilles', emoji: '🎃', season: 'automne', passTier: 10, frame: { ring: 'linear-gradient(135deg, #F77F00, #FFB703 50%, #D65A00)', emojis: ['🎃', '👻'], count: 6, top: '🕯️' } },
{ id: 'd_champignon', slot: 'dice', label: 'Dés champignon', emoji: '🍄', season: 'automne', passTier: 15, dice: { face: '#E63946', edge: '#9D0208', pip: '#FFFFFF' } },
{ id: 't_terreur_soirees', slot: 'title', label: 'Terreur des soirées', emoji: '🧛', season: 'automne', passTier: 20 },
```

### 3.4 Équilibrage (hypothèses chiffrées)

Une saison dure environ 13 semaines.

| Profil | Hypothèse | Points ⭐ | Palier atteint |
|---|---|---|---|
| Régulier | 6 soirées (2 par mois) de 6 parties dont 2 victoires = 6 × (60 + 20 + 25) = 630 ; 2 défis du jour par semaine = 26 × 15 = 390 | 1 020 | 20 (terminé vers la 10e semaine) |
| Régulier « petit » | mêmes soirées, 1 défi par semaine = 13 × 15 = 195 | 825 | 20 (de justesse) |
| Occasionnel | 3 soirées de 4 parties dont 1 victoire = 3 × (40 + 10 + 25) = 225 ; 10 défis = 150 | 375 | 9 (presque la moitié, le cadre du palier 10 à portée d'une soirée) |
| Accro aux défis seuls | 1 défi par jour, aucune soirée = 90 × 15 | 1 350 | 20 |

Pièces gagnées par le joueur régulier sur la saison : 6 × (30 + 30) = 360 (parties et victoires) + 260 (défis) + 620 (passe) ≈ **1 240 🪙**, soit à peu près la moitié de la collection (2 300 🪙) : il choisit, et complète l'an prochain.

Si le ressenti en jeu réel est trop dur ou trop facile, le seul réglage à toucher est « points par palier » (40).

### 3.5 Attribution des récompenses

- **Automatique.** À l'ouverture de l'appli, à l'ouverture de l'onglet Boutique et à la fin de chaque partie / défi, le front appelle la synchronisation du passe. Le serveur attribue tous les paliers atteints et pas encore enregistrés, et renvoie la liste des nouveaux paliers pour afficher les toasts.
- Palier « pièces » : un toast.
- Palier « cosmétique » ou « titre » (5, 10, 15, 20) : la même modale de célébration que pour un achat en boutique (confettis, aperçu, bouton « L'équiper »).
- Si plusieurs paliers tombent d'un coup : un seul toast récapitulatif pour les pièces, puis les modales de cosmétiques une par une.

---

## 4. Règles produit

### 4.1 Organisation de l'onglet Boutique (de haut en bas)

1. **Solde de pièces** (inchangé).
2. **Bandeau de saison** : titre, sous-titre, compte à rebours « Encore X j ».
3. **Passe de saison** : barre de progression vers le prochain palier, numéro du palier courant, aperçu de la prochaine récompense, bouton « Voir les 20 paliers » qui déplie la piste complète (liste verticale, paliers atteints cochés, cosmétiques en aperçu).
4. **Collection de la saison** : les 9 articles, tous visibles et achetables pendant toute la saison, triés par prix croissant puis par ordre du catalogue. Pastille « Limité » sur chaque carte. Les articles déjà possédés restent affichés, cochés.
5. **Vitrine de la semaine** : les 6 articles permanents, comme aujourd'hui.

### 4.2 Cumul avec la vitrine hebdo — décision

**La vitrine reste à 6 articles permanents ; la collection de saison s'affiche à part et en entier.** Les articles de saison (collection et passe) sont exclus du tirage de la vitrine.

Pourquoi ne pas faire « 4 permanents + 2 de saison » : avec 9 articles sur 13 semaines et un tirage au sort, un joueur peut ne jamais voir passer l'article qu'il veut pendant qu'il a les pièces, ce qui est frustrant et difficile à expliquer à des joueurs peu technophiles. « Tout est là jusqu'au 28 février » se comprend d'un coup d'œil, et la rareté vient de la saison, pas du hasard. La vitrine hebdo garde son rôle de petite surprise du lundi, sans être réduite.

### 4.3 Fin de saison

- **Articles de collection non achetés** : ils quittent la boutique à minuit et reviennent **à l'identique, au même prix, à la même saison de l'année suivante**. Aucune solde, aucun rachat hors saison.
- **Articles possédés** (achetés ou gagnés au passe) : gardés pour toujours, équipables toute l'année.
- **Pièces** : jamais remises à zéro. On peut économiser pour la saison suivante.
- **Passe** : les points de la saison sont figés. Tous les paliers atteints et pas encore attribués le sont à la prochaine synchronisation, même après la fin (rien n'est perdu parce qu'on n'a pas rouvert l'appli à temps). Les paliers non atteints sont perdus **pour cette édition**. Le passe de la nouvelle saison repart de 0 ⭐.
- **Retour l'année suivante** : le même passe revient avec les mêmes récompenses. Si un joueur possède déjà la récompense d'un palier à cosmétique, il reçoit à la place **100 🪙** (palier 5, 10 ou 15) ou **50 🪙 en plus des 100** (titre du palier 20).
- **Dernière semaine** (7 derniers jours) : le compte à rebours du bandeau passe en couleur d'accent secondaire avec le texte « dernière chance » (section 5), et une pastille rouge apparaît sur l'onglet Boutique.
- **Écran de fin de saison** : à la première ouverture de l'appli dans une nouvelle saison, une modale résume la saison écoulée (palier atteint, pièces gagnées par le passe, nombre d'articles de la collection obtenus sur 9) puis annonce la nouvelle. Affichée une seule fois par joueur et par édition, et seulement si le joueur a gagné au moins 1 ⭐ pendant la saison écoulée.

### 4.4 Joueur qui revient après une absence

- **Absent une partie de la saison** : rien de spécial, son passe est là où il l'avait laissé, la collection est toujours en boutique.
- **Absent pendant une saison entière ou plus** : pas de modale de fin de saison pour les saisons où il n'a rien joué. Il voit simplement le bandeau de la saison en cours et un passe à 0 ⭐. Pas de message culpabilisant.
- **A joué en fin de saison puis n'a pas rouvert l'appli avant la suivante** : à son retour, la synchronisation rattrape les paliers de la saison précédente (pièces et cosmétiques), puis affiche la modale de fin de saison. Le rattrapage couvre la saison en cours et la saison précédente uniquement.
- **Revient un an plus tard à la même saison** : il retrouve la collection et le passe de l'an dernier, peut acheter ce qui lui manquait et retenter les paliers manqués.
- **Nouveau joueur en cours de saison** : passe à 0 ⭐, mêmes règles. Pas de rattrapage accéléré (le défi du jour suffit à avancer vite).

### 4.5 Onglet Déco

- Les articles de saison possédés apparaissent dans leur catégorie comme n'importe quel article.
- Les articles de saison non possédés suivent le même traitement que les articles de boutique permanents non possédés, avec la mention « Collection d'hiver » / « Passe d'hiver, palier 10 » à la place du prix quand la saison n'est pas en cours.

---

## 5. Textes d'interface

Variables entre accolades. Noms de saison : `{saison}` = « d'hiver », « de printemps », « d'été », « d'automne ».

### Onglet Boutique

| Emplacement | Texte |
|---|---|
| Titre de section collection | Collection {saison} |
| Sous-titre de section collection | Dispo jusqu'au {date de fin}. Après, rendez-vous l'an prochain ! |
| Pastille d'article | Limité |
| Compte à rebours (normal) | Encore {n} j |
| Compte à rebours (7 derniers jours) | ⏰ Dernière chance : plus que {n} j ! |
| Compte à rebours (dernier jour) | ⏰ Ça ferme ce soir à minuit ! |
| Collection complète | 🎉 Collection complète ! Il ne reste plus rien à te vendre. |
| Titre de section vitrine (inchangé) | Vitrine de la semaine |
| Erreur achat hors saison (code `shop_not_available`, texte existant complété) | Cet article n'est plus en rayon. Il reviendra ! |

### Passe

| Emplacement | Texte |
|---|---|
| Titre | Passe {saison} |
| Sous-titre | Gratuit. Tu joues, tu gagnes des ⭐, les cadeaux tombent tout seuls. |
| Barre de progression | Palier {n} sur 20 · encore {x} ⭐ avant le prochain cadeau |
| Passe à 0 | Palier 0 sur 20 · une partie et c'est parti ! |
| Prochaine récompense | Prochain cadeau : {récompense} |
| Bouton dépliant | Voir les 20 paliers |
| Passe terminé | 🏆 Passe terminé ! Tu peux te reposer (ou pas). |
| Bouton d'aide | Comment gagner des ⭐ ? |
| Aide, titre | Comment gagner des ⭐ |
| Aide, ligne 1 | 🎮 Une partie terminée : +10 ⭐ |
| Aide, ligne 2 | 🏆 Une victoire : +10 ⭐ de plus |
| Aide, ligne 3 | 📅 Le défi du jour : +15 ⭐ |
| Aide, ligne 4 | 🎉 Une soirée entre amis : +25 ⭐ |
| Aide, pied | Un palier tous les 40 ⭐. Rien à réclamer, tout arrive tout seul. |
| Mention sur un article du passe non possédé | Passe {saison}, palier {n} |

### Toasts et modales de palier

| Cas | Texte |
|---|---|
| Palier à pièces | ⭐ Palier {n} ! +{x} 🪙 dans la tirelire |
| Plusieurs paliers à pièces d'un coup | ⭐ {k} paliers d'un coup ! +{x} 🪙 dans la tirelire |
| Modale palier 5, 10, 15 (titre) | ⭐ Palier {n} : cadeau ! |
| Modale palier 5, 10, 15 (texte) | {libellé de l'article} rejoint ta collection. Exclu du passe, introuvable en boutique ! |
| Modale palier 20 (titre) | 🏆 Passe {saison} terminé ! |
| Modale palier 20 (texte) | Tu décroches le titre « {titre} » et 100 🪙. La classe. |
| Récompense déjà possédée (année suivante) | ⭐ Palier {n} ! Tu l'avais déjà : +100 🪙 à la place |
| Bouton des modales | L'équiper |
| Bouton secondaire des modales | Plus tard |

### Début et fin de saison

| Cas | Texte |
|---|---|
| Modale de fin, titre | {emoji} La saison {saison} est finie ! |
| Modale de fin, ligne passe | Passe : palier {n} sur 20 |
| Modale de fin, ligne pièces | Pièces gagnées avec le passe : {x} 🪙 |
| Modale de fin, ligne collection | Collection : {k} articles sur 9 |
| Modale de fin, commentaire (palier 20) | Passe terminé. Respect éternel. |
| Modale de fin, commentaire (paliers 10 à 19) | Pas mal du tout ! La suite l'an prochain. |
| Modale de fin, commentaire (paliers 1 à 9) | Petit échauffement. On se rattrape cette saison ? |
| Modale de fin, pied | Les articles ratés reviendront l'an prochain. Promis. |
| Modale de fin, bouton | Voir la nouvelle saison |
| Toast de nouvelle saison (joueur sans modale de fin) | {emoji} Nouvelle saison : {nom de la saison} ! Va voir la boutique. |
| Annonce avant lancement (du jour de la mise en ligne au 30 nov. 2026, sous le solde) | ⛷️ Le 1er décembre, la boutique part au chalet. Garde quelques pièces ! |

---

## 6. Notes pour l'implémentation

Aucune de ces notes n'est une décision de produit ; elles indiquent où brancher la fonctionnalité dans l'existant (`supabase/features/cadeaux.sql`, `src/data/cadeaux.ts`, `src/features/cadeaux/ShopTab.tsx`).

### 6.1 Catalogue

- Table `items` : deux colonnes nullables en plus.
  - `season text` avec contrainte `in ('hiver', 'printemps', 'ete', 'automne')`.
  - `pass_tier integer` (5, 10, 15 ou 20).
- Trois familles d'articles, sans ambiguïté :
  - permanent : `price` non nul, `season` nul (existant, vitrine hebdo) ;
  - collection de saison : `price` non nul, `season` non nul, `pass_tier` nul ;
  - exclusif du passe : `price` nul, `season` non nul, `pass_tier` non nul, `rule` nul (ne passe pas par `_sync_items`).
- `ItemDef` (front) : ajouter `season?: 'hiver' | 'printemps' | 'ete' | 'automne'` et `passTier?: number`. Les 52 entrées des sections 2 et 3.3 se copient telles quelles dans `ITEMS` et se reportent dans les `insert` de `cadeaux.sql` (id, slot, label, price, season, pass_tier).
- Nouveau fichier de données front suggéré `src/data/saisons.ts` : pour chaque saison, id, nom, emoji, mois de début, couleurs et textes du bandeau (section 1), libellé « d'hiver / de printemps… », et la grille de pièces par palier (section 3.3). La grille de pièces doit exister aussi côté SQL (source de vérité pour l'attribution) ; le front ne s'en sert que pour l'affichage.

### 6.2 Saison courante

- Fonction SQL interne suggérée `_season_at(date)` → `(season_id, season_key, starts_on, ends_on)` : mois 12, 1, 2 → `hiver` ; 3 à 5 → `printemps` ; 6 à 8 → `ete` ; 9 à 11 → `automne`. Renvoie nul avant le `2026-12-01`. Bornes converties en `timestamptz` avec `at time zone 'Europe/Paris'`, comme `_week_start_now()`.
- Pas de table `seasons` : le calendrier est fixe et calculable.

### 6.3 Points et passe

- Fonction interne suggérée `_season_points(profile, season_key)` : somme dérivée, sur la fenêtre de la saison, de `match_players` (10 par ligne + 10 si `won`), `daily_runs` terminés (15, daté par `finished_at`) et soirées distinctes (25, même comptage que l'agrégat spécial `soirees` des trophées, restreint aux soirées à 2 humains ou plus). Garder exactement le même filtre de lignes `match_players` que `_coins` pour ne pas diverger.
- Table suggérée `season_pass_claims` : `profile_id`, `season_key`, `tier` (1 à 20), `coins` (pièces accordées, 0 possible), `item_id` (nul si palier à pièces ou compensation), `claimed_at` ; clé primaire `(profile_id, season_key, tier)` ; RLS en lecture seule pour `authenticated`, aucune policy d'écriture.
- RPC suggérée `season_sync()` (security definer, verrou sur la ligne `profiles` comme `buy_item`) : pour la saison en cours **et la précédente**, calcule le palier atteint, insère les lignes manquantes dans `season_pass_claims`, accorde les articles via `_grant_item` (ou la compensation en pièces si déjà possédé), et renvoie `{season, season_key, starts_at, ends_at, points, tier, new_claims:[{season_key, tier, coins, item_id}], ended:{season_key, tier, coins_total, collection_owned} | null}`. Idempotente : un second appel renvoie `new_claims` vide.
- `_coins` : ajouter `+ sum(season_pass_claims.coins)` du joueur. Le solde reste entièrement dérivé.
- Modale de fin de saison : le serveur renvoie `ended` tant que la saison précédente a des points ; le front mémorise « déjà vue » en `localStorage` par `season_key` (convenance par appareil, sans enjeu si elle réapparaît une fois sur un autre téléphone).

### 6.4 Boutique

- `_shop_items` (vitrine hebdo) : ajouter le filtre `season is null`. Rien d'autre ne change, le tirage `md5(semaine || id)` reste identique ; les vitrines des semaines déjà passées ne sont pas affectées puisque aucun article de saison n'existait.
- `shop_state()` : ajouter au JSON renvoyé `season` (id ou nul), `season_ends_at`, `season_items` (ids de la collection en cours, triés par prix puis id) et `season_owned`. Le reste du contrat est conservé, donc `ShopTab` continue de fonctionner avant d'être enrichi.
- `buy_item` : accepter un article si il est dans la vitrine de la semaine **ou** si `season` = saison en cours, `price` non nul et `pass_tier` nul. Sinon `shop_not_available` (code existant). Les codes `item_already_owned` et `shop_not_enough_coins` sont inchangés. Aucun nouveau code d'erreur n'est nécessaire.
- `item_purchases` : inchangé.

### 6.5 Front

- `ShopTab` : insérer bandeau, bloc passe et section collection au-dessus de la vitrine (ordre de la section 4.1). Réutiliser `ItemPreview`, la modale d'achat et la modale « acheté » existantes ; la modale de palier à cosmétique est la modale « acheté » avec d'autres textes.
- Appeler `season_sync()` aux mêmes endroits que `sync_my_items()` (ouverture de l'appli, fin de partie, fin de défi du jour) et à l'ouverture de l'onglet Boutique ; afficher toasts et modales à partir de `new_claims`.
- Pastille rouge sur l'onglet Boutique pendant les 7 derniers jours d'une saison.
- Après toute modification SQL : `npm run sql`, puis recoller les morceaux `supabase/install-parts/*.sql` dans l'ordre dans le SQL Editor Supabase.

### 6.6 Tests à prévoir (PGlite)

- `_season_at` : 30 nov. 2026 (nul), 1er déc. 2026, 31 déc., 1er janv. 2027 (`hiver-2026`), 28 fév. 2027 23:59 Paris, 1er mars 2027 00:00 Paris, 29 fév. 2028.
- `_season_points` : un événement la veille du début et un le lendemain de la fin ne comptent pas ; une soirée ne donne 25 qu'une fois.
- `season_sync` : idempotence ; saut de plusieurs paliers d'un coup ; rattrapage de la saison précédente ; compensation en pièces si l'article est déjà possédé ; `_coins` augmente du bon montant.
- `buy_item` : article de saison achetable en saison, refusé hors saison, article du passe jamais achetable ; `_shop_items` ne renvoie aucun article de saison.

### 6.7 Hors périmètre

- Articles `chess`, nouveaux styles de balle / boule, nouvelles formes de kart (demandent du rendu).
- Passe payant, paliers bonus au-delà de 20, missions de saison, classement de saison.
- Notifications push de fin de saison (possible plus tard avec `push.sql`).
