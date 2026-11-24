# Événement de Noël « Noël chez Dédé » — spec de conception

Date : 2026-11-24 · Statut : conception validée en discussion, à relire · Aucune ligne de code dans ce document.

## 0. Résumé

- Du **1er décembre 00:00 au 6 janvier 23:59** (heure de Paris), soit 37 jours, l'app vit un **événement de Noël** dont le but est de **faire revenir chaque membre de la bande tous les jours**.
- Chaque jour : **3 missions** faisables seul en 2-5 minutes, une **mission bonus « soirée »**, et **la Hotte du jour** (mini-activité solo de Noël en 5 manches, la même pour toute la bande). Elles rapportent des **flocons ❄️** (150 ❄️ par jour au maximum, plus des bonus de série).
- Les ❄️ font avancer le **Pass de Noël** (30 paliers, réservé aux acharnés) : pièces, 8 objets déco de Noël, 3 effets spéciaux, et une **tenue chibi de Noël** au palier 30.
- Les ❄️ de tous les membres remplissent aussi **la Grande Hotte de la bande** (objectif collectif à 5 paliers, façon « Jeux de clan ») : récompenses pour tous ceux qui ont apporté au moins 400 ❄️, jusqu'au **Gros Lot** (tenue Pyjama de Noël, soirée secrète, trophée daté, 500 🪙, plaque souvenir).
- Le Pass de Noël est **séparé** du passe de saison d'hiver « Tous au chalet » (spec `2026-11-22-saisons-boutique-design.md`), qui continue à l'identique jusqu'à fin février. Les deux ne partagent rien : les ⭐ d'hiver viennent des parties, les ❄️ de Noël viennent des missions.
- Les invités (`profiles.is_guest`) ne voient rien et ne comptent pas.

Décisions de l'utilisateur (2026-11-24) : objectif n° 1 = retour quotidien ; missions faisables seul ; pass séparé et court ; récompenses = pièces + déco + effets + tenue ; pass réservé aux acharnés (pas de rattrapage) ; 150 ❄️ / jour max ; objectif collectif avec un Gros Lot très fourni.

---

## 1. Calendrier et identité

| Élément | Valeur |
|---|---|
| Clé d'édition | `noel-2026` (`noel-<année du 1er décembre>`) |
| Début | 1er décembre 2026, 00:00 Paris |
| Fin | 6 janvier 2027, 23:59:59 Paris |
| Jours de l'événement | 37 (« jour » = date de Paris) |
| Nom affiché | 🎄 Noël chez Dédé |
| Monnaie | Flocons ❄️ |
| Après la fin | page en lecture seule « C'est fini ! » jusqu'au 13 janvier inclus, puis carte et page masquées. Les récompenses atteintes avant la fin restent attribuables (synchro idempotente). |

Le moteur est générique (« événement » à dates fixes, clé d'édition) pour être réutilisé l'an prochain ; cette spec ne décrit que l'édition 2026. Dates de test : la date courante passe par la même fonction surchargeable que les saisons (`_season_now()`), pour simuler décembre dans les tests PGlite.

---

## 2. Gagner des flocons ❄️

Les ❄️ sont **dérivés de l'historique** (comme les ⭐ du passe d'hiver et les pièces) : rien n'est saisi à la main, rien ne peut être perdu, tout est recalculable. Seuls comptent les événements datés d'un jour de l'événement (date de Paris).

| Source | ❄️ | Limite |
|---|---|---|
| Mission du jour n° 1, 2, 3 | 30 chacune | 3 par jour |
| Mission bonus « soirée » | 30 | 1 par jour |
| La Hotte du jour | 6 par bonne réponse (0 à 30) | 1 essai par jour |
| **Total quotidien** | **150 max** | |
| Série de 3 jours | +30 | une fois par édition |
| Série de 7 jours | +70 | une fois |
| Série de 14 jours | +140 | une fois |
| Série de 21 jours | +210 | une fois |

**Série 🔥** : nombre de jours consécutifs (dates de Paris) où au moins une des 3 missions du jour OU la mission bonus a été réussie. La série en cours s'affiche ; un jour sans mission la remet à 0 (le jour en cours ne casse pas la série tant qu'il n'est pas fini). Chaque bonus de série est acquis une seule fois par édition, dès que la série atteint le seuil.

**Mission bonus « soirée »** : le joueur a terminé ce jour-là au moins une partie avec au moins 2 joueurs humains (même définition de « soirée » que le passe d'hiver, date = `matches.finished_at` en heure de Paris).

Ordres de grandeur : un joueur parfait seul (3 missions + Hotte 5/5 tous les jours) fait 120 ❄️/jour × 37 + 450 = **4 890 ❄️** ; avec des soirées, jusqu'à 150/jour.

---

## 3. Les missions du jour

### 3.1 Tirage

- Chaque jour, 3 missions **identiques pour toute la bande**, tirées de façon déterministe à partir de `md5('noel-2026' || jour)` (pas de table de tirage : même résultat pour tout le monde, recalculable).
- Slot 1 = famille **Défi du jour**, slot 2 = famille **Hotte**, slot 3 = famille **Surprise**.
- Contraintes du slot 3 : `s_advent` seulement du 1er au 24 décembre ; `s_challenge` au plus 1 fois par semaine ISO ; `s_shop` au plus 1 fois par semaine ISO ; `s_card` au plus 2 fois par semaine ISO ; jamais deux jours de suite la même mission surprise. Le tirage parcourt les candidats dans l'ordre du hash et prend le premier qui respecte les contraintes (les jours précédents sont recalculés, le tirage reste déterministe).

### 3.2 Catalogue

Toutes les missions sont vérifiées par le serveur à partir de données déjà enregistrées ; une mission réussie ne peut plus « se défaire » (chaque source ne change plus une fois écrite).

| id | Famille | Texte affiché | Réussie si (jour J, date de Paris) |
|---|---|---|---|
| `d_finish` | Défi | Termine le défi du jour | `daily_runs` du jour J avec `finished_at` non nul |
| `d_400` | Défi | Fais au moins 400 points au défi du jour | idem et `score >= 400` |
| `d_beat` | Défi | Fais mieux qu'hier au défi du jour | idem et `score >` score de J−1 (pas de défi fini à J−1 : un défi fini suffit) |
| `d_morning` | Défi | Termine le défi du jour avant midi | idem et `finished_at` avant 12:00 Paris |
| `h_play` | Hotte | Ouvre la Hotte du jour | Hotte du jour terminée |
| `h_3` | Hotte | Au moins 3/5 à la Hotte du jour | Hotte terminée, score ≥ 3 |
| `h_4` | Hotte | Au moins 4/5 à la Hotte du jour | score ≥ 4 |
| `h_fast` | Hotte | Finis la Hotte en moins d'une minute | Hotte terminée en moins de 60 s (entre le début et la dernière réponse) |
| `s_advent` | Surprise | Ouvre la case du jour du calendrier de l'Avent | `advent_opens` (profil, jour J) |
| `s_card` | Surprise | Crée une carte maison | `custom_cards` dont `author_id` = joueur, créée le jour J |
| `s_challenge` | Surprise | Lance un défi à un pote | `coin_challenges` dont `challenger_id` = joueur, créé le jour J |
| `s_shop` | Surprise | Achète un article en boutique | `item_purchases` du joueur, `bought_at` le jour J |
| `s_combo` | Surprise | Fais le défi du jour ET la Hotte | les deux terminés le jour J |
| `s_d550` | Surprise | Fais au moins 550 points au défi du jour | défi du jour J avec `score >= 550` |

Poids du tirage : famille Défi = `d_finish` 2, `d_400` 2, `d_beat` 1, `d_morning` 1 ; famille Hotte = `h_play` 1, `h_3` 3, `h_4` 2, `h_fast` 1 ; famille Surprise = `s_advent` 4 (jusqu'au 24), `s_combo` 2, `s_d550` 1, `s_card` 1, `s_challenge` 1, `s_shop` 1. Une mission Surprise peut recouper les slots 1-2 (ex. `s_combo`) : c'est voulu (une journée « facile » de temps en temps).

---

## 4. La Hotte du jour 🎁

Mini-activité solo de Noël, **5 manches**, environ 2 minutes, **la même pour toute la bande** le jour J, **un seul essai**.

### 4.1 Types de manches (emojis uniquement, aucune image)

| Type | Déroulé | Bonne réponse |
|---|---|---|
| `quiz` | Question de Noël (traditions, films, chants, Dédé) + 4 réponses | la bonne réponse |
| `memoire` | 6 emojis de Noël affichés 3 s, puis 5 restent (mélangés) : lequel a disparu ? 4 propositions | l'emoji disparu |
| `intrus` | Grille de 9 emojis, un seul n'a rien à voir avec Noël | l'intrus |
| `proche` | « Combien de … ? » + saisie d'un nombre | à ±15 % de la valeur (au moins ±1) |
| `chanson` | Paroles d'un chant de Noël avec un mot manquant + 4 propositions | le bon mot |

Composition d'une Hotte : toujours 1 `quiz` ; les 4 autres manches tirées parmi les 5 types (au plus 2 du même type), ordre mélangé ; tirage déterministe `md5('hotte' || jour)`.

### 4.2 Contenu

- Banques côté serveur (les réponses ne quittent jamais le serveur avant d'avoir répondu) : **40 questions `quiz`**, **20 extraits `chanson`**, **20 questions `proche`** (valeur + unité), écrites pour l'occasion (ton de l'app, tout public, français). Listes d'emojis de Noël et d'intrus pour `memoire` / `intrus`, tirées au hasard du jour.
- Un même élément de banque n'est pas réutilisé avant d'avoir épuisé la banque (cycle déterministe sur les 37 jours).

### 4.3 Règles

- `hotte_start` crée l'essai du jour (refusé s'il existe déjà) et renvoie les 5 manches **sans les réponses**. Délai : 5 minutes pour finir, ensuite l'essai est clos avec les réponses déjà données.
- Chaque réponse est enregistrée au fil de l'eau (une réponse par manche, définitive) ; le serveur répond juste/faux (et la bonne réponse) après chaque manche.
- Score = nombre de bonnes réponses (0-5) ; ❄️ = 6 × score ; durée = de `started_at` à la dernière réponse.
- `memoire` et `intrus` : la réponse est déductible en lisant les données envoyées (limite assumée, jeu entre amis).
- **Classement du jour de la bande** : score décroissant puis durée croissante, visible après avoir fait sa Hotte (pas avant, pour ne rien révéler).

---

## 5. Le Pass de Noël (30 paliers)

- **150 ❄️ par palier**, palier atteint = `min(30, floor(❄️ / 150))`, **4 500 ❄️** pour finir. Pas de palier bonus après 30.
- Récompenses **attribuées automatiquement** par la synchro (idempotente). Objet déjà possédé : remplacé par 100 🪙.

| Palier | Récompense | | Palier | Récompense |
|---|---|---|---|---|
| 1 | 30 🪙 | | 16 | 70 🪙 |
| 2 | 30 🪙 | | 17 | 80 🪙 |
| 3 | 🎀 titre « Lutin en chef » | | 18 | ✨ effet **Entrée en traîneau** |
| 4 | 40 🪙 | | 19 | 80 🪙 |
| 5 | 40 🪙 | | 20 | 🎀 boule de bowling « Bûche de Noël » |
| 6 | 🎀 dos de cartes « Papier cadeau » | | 21 | 90 🪙 |
| 7 | 50 🪙 | | 22 | 🎀 marques « Guirlande lumineuse » |
| 8 | 50 🪙 | | 23 | 90 🪙 |
| 9 | 🎀 dés « Sucre d'orge » | | 24 | 100 🪙 |
| 10 | ✨ effet **Neige sur l'avatar** | | 25 | ✨ effet **Pluie de sapins** |
| 11 | 60 🪙 | | 26 | 100 🪙 |
| 12 | 🎀 kart « Traîneau rouge » | | 27 | 🎀 cadre « Couronne de houx » |
| 13 | 60 🪙 | | 28 | 100 🪙 |
| 14 | 70 🪙 | | 29 | 100 🪙 |
| 15 | 🎀 balle de golf « Boule de Noël » | | 30 | 🎅 **tenue de Noël** + titre « Acharné de Noël » + 200 🪙 |

Total pièces du pass : 1 440 🪙.

### 5.1 Objets déco de Noël (catalogue, format `ITEMS` de `src/data/cadeaux.ts`)

Champ nouveau : `event: 'noel'` + `eventTier` (palier), comme `season` / `passTier` du passe d'hiver. Jamais vendus.

```ts
{ id: 't_lutin_chef', slot: 'title', label: 'Lutin en chef', emoji: '🧝', event: 'noel', eventTier: 3 },
{ id: 'cb_papier_cadeau', slot: 'card_back', label: 'Papier cadeau', emoji: '🎁', event: 'noel', eventTier: 6, cardBack: { bg: 'repeating-linear-gradient(45deg, #C1121F 0 14px, #2D6A4F 14px 28px)', emoji: '🎁' } },
{ id: 'd_sucre_orge', slot: 'dice', label: 'Dés sucre d’orge', emoji: '🍭', event: 'noel', eventTier: 9, dice: { face: '#FFFFFF', edge: '#E63946', pip: '#C1121F' } },
{ id: 'k_traineau', slot: 'kart', label: 'Traîneau rouge', emoji: '🛷', event: 'noel', eventTier: 12, kart: { body: '#C1121F' } },
{ id: 'gb_boule_noel', slot: 'golf_ball', label: 'Boule de Noël', emoji: '🔴', event: 'noel', eventTier: 15, golf: { color: '#D4AF37', stripe: '#C1121F' } },
{ id: 'bb_buche', slot: 'bowling_ball', label: 'Bûche de Noël', emoji: '🪵', event: 'noel', eventTier: 20, bowling: { color: '#6B3E26', band: '#FFF3E0' } },
{ id: 'm_guirlande', slot: 'marks', label: 'Guirlande lumineuse', emoji: '💡', event: 'noel', eventTier: 22, marks: { outline: '#FFD166', glow: '#FF4D6D', dash: true } },
{ id: 'f_houx', slot: 'frame', label: 'Couronne de houx', emoji: '🌿', event: 'noel', eventTier: 27, frame: { ring: '#2D6A4F', emojis: ['🍒', '🌿'], count: 8, top: '🎀' } },
{ id: 't_acharne_noel', slot: 'title', label: 'Acharné de Noël', emoji: '🎅', event: 'noel', eventTier: 30 },
```

### 5.2 Effets spéciaux (nouveaux slots d'objets)

Chaque effet a **son propre slot** (on peut tous les équiper en même temps) ; ils s'équipent dans l'onglet Déco comme un cadre. Tous respectent « réduire les animations » (version statique ou désactivée).

| id | Slot | Nom | Rendu |
|---|---|---|---|
| `fx_neige` | `fx_avatar` | Neige sur l'avatar | petits flocons qui tombent doucement devant l'avatar, partout où il est affiché en taille ≥ 48 px |
| `fx_traineau` | `fx_entree` | Entrée en traîneau | dans la grille des joueurs du salon, l'avatar arrive en glissant sur un traîneau 🛷 (1 s) quand le joueur rejoint |
| `fx_sapins` | `fx_victoire` | Pluie de sapins | à l'écran de résultats, quand le joueur gagne : la pluie de confettis est remplacée par des 🎄🎁⭐ |
| `fx_salon_neige` | `fx_salon` | Salon enneigé | quand le joueur est hôte : neige légère en fond du salon et du mode télé (récompense collective, §6) |

---

## 6. La Grande Hotte de la bande 🛷

- Jauge commune = **somme des ❄️ de tous les membres** (hors invités) sur l'édition.
- Pour recevoir les récompenses collectives, un membre doit avoir **apporté au moins 400 ❄️** lui-même. Un membre qui franchit 400 ❄️ plus tard reçoit rétroactivement les paliers déjà atteints (tant que l'édition n'est pas finie).

| Palier | Total de la bande | Récompense pour chaque membre éligible |
|---|---|---|
| 1 | 6 000 ❄️ | 100 🪙 |
| 2 | 14 000 ❄️ | ✨ effet **Salon enneigé** (`fx_salon_neige`) |
| 3 | 22 000 ❄️ | 🌌 cadre animé **Aurore boréale** (exclusif, jamais vendu) |
| 4 | 30 000 ❄️ | 250 🪙 + titre **« La Bande de Noël »** |
| 5 | 38 000 ❄️ | 🎁 **Gros Lot** (ci-dessous) |

```ts
{ id: 'f_aurore', slot: 'frame', label: 'Aurore boréale', emoji: '🌌', event: 'noel', bandTier: 3, frame: { ring: 'conic-gradient(#06D6A0, #118AB2, #7B2CBF, #EF476F, #06D6A0)', spin: true, emojis: ['✨'], count: 6, top: '🌌' } },
{ id: 't_bande_noel', slot: 'title', label: 'La Bande de Noël', emoji: '🎄', event: 'noel', bandTier: 4 },
```

**Gros Lot (palier 5)** :
1. 🛌 tenue **Pyjama de Noël** (les 12 expressions) ;
2. 🎉 thème secret **« Le Réveillon de la Bande »** du mode Réveillon, lançable par un hôte éligible (au moins 12 défis surprises inédits, décor et classement propres) ;
3. 🏆 trophée **« Esprit d'équipe 2026 »** (unique, daté, plus jamais obtenable) ;
4. 🪙 500 pièces ;
5. 🌟 **plaque souvenir** dans l'album de la bande : les chibis en pyjama autour d'un sapin + classement des contributeurs (composée par l'app avec les visuels existants).

Affichage : grande jauge animée, les 5 paliers dessus, le classement des contributeurs (pseudo, avatar, ❄️ apportés, du plus grand au plus petit), et pour soi « Tu as apporté X ❄️ (il en faut 400 pour les récompenses) ».

Ordre de grandeur : 38 000 ❄️ ≈ 4 200 ❄️ par personne pour 9 membres : toute la bande doit s'y mettre.

---

## 7. Tenues

| Tenue | Obtention | Expressions | Art |
|---|---|---|---|
| **Noël** (Père Noël / Mère Noël selon le perso, à décider avec les planches) | palier 30 du Pass de Noël | les 12 d'office (exception à la règle « une expression par trophée de jeu » : pas de jeu associé) | 9 planches V3 + 9 portraits, fournies par l'utilisateur **vers le 20 décembre** |
| **Pyjama de Noël** | palier 5 de la Grande Hotte | les 12 d'office | 9 planches V3 + 9 portraits **vers le 28 décembre** |

- Ajout au catalogue `src/data/tenues.ts` **et** `supabase/features/tenues.sql` (règle de déblocage = palier d'événement), puis le circuit habituel des planches (CLAUDE.md).
- Si une tenue est débloquée avant que son art soit intégré : elle apparaît comme « 🎨 En préparation, arrive très vite ! » (non équipable) ; dès l'art intégré, elle devient équipable, sans autre action.

---

## 8. Interface

### 8.1 Accueil

Pendant l'événement (et jusqu'au 13 janvier en mode « C'est fini »), une grande carte **« 🎄 Noël chez Dédé »** en haut de l'accueil :
- les 3 missions du jour (case cochée quand réussie, « +30 ❄️ ») et la mission bonus soirée ;
- bouton principal **« Ouvrir la Hotte du jour »** (devient « Hotte faite : 4/5 ✅ ») ;
- série « 🔥 12 jours » ; barre du pass « Palier 14 · 2 130 ❄️ » ; mini-jauge de la Grande Hotte ;
- toucher la carte ouvre la page Noël.

### 8.2 Page « Noël » (`/noel`)

Bandeau festif (style sticker book, rouge/vert/or, flocons qui flottent, compte à rebours « Encore 12 jours »), puis 3 onglets :
1. **Missions** : missions du jour détaillées, la Hotte, la série et ses paliers bonus, le classement du jour de la Hotte (après l'avoir faite).
2. **Pass** : piste horizontale des 30 paliers (acquis cochés, palier suivant mis en avant, tenue visible au bout), total ❄️, ❄️ manquants pour le prochain palier.
3. **La Grande Hotte** : jauge, paliers, contributeurs, statut d'éligibilité.

### 8.3 Célébrations et rappel

- Palier atteint (pass ou Grande Hotte) : modale de récompense avec confettis, comme le passe d'hiver ; plusieurs paliers d'un coup = une seule modale qui les liste.
- Notification de 18 h : pendant l'événement, le rappel du défi du jour devient « 🎄 Tes missions de Noël t'attendent ! (série 🔥 N) » ; pas de notification en plus.

### 8.4 Textes principaux

| Endroit | Texte |
|---|---|
| Titre carte / page | 🎄 Noël chez Dédé |
| Sous-titre page | Chaque jour, des missions et la Hotte : remplis ton pass et la Grande Hotte de la bande ! |
| Mission réussie | ✅ +30 ❄️ |
| Hotte à faire | 🎁 Ouvrir la Hotte du jour |
| Hotte faite | 🎁 Hotte faite : {score}/5 · +{❄️} ❄️ |
| Série | 🔥 {n} jour(s) d'affilée |
| Pass | Palier {n}/30 · encore {x} ❄️ pour le suivant |
| Pass fini | 🎅 Pass terminé : tu es un Acharné de Noël ! |
| Grande Hotte, non éligible | Apporte encore {x} ❄️ pour toucher les récompenses de la bande |
| Fin | 🎄 C'est fini ! Merci la bande, rendez-vous l'an prochain. |

---

## 9. Notes pour l'implémentation

- **SQL** : un fichier `supabase/features/evenements.sql` (moteur : dates d'édition, tirage des missions, vérification, ❄️, série, synchro des récompenses pass + Grande Hotte) et la Hotte du jour (essais + banques). Tables nouvelles : essais de Hotte (profil, jour, début, réponses, score, fin) ; récompenses attribuées (profil, édition, type pass|bande, palier). Pas de policy RLS ouverte : tout passe par des RPC `_require_member()`.
- **RPC** (noms indicatifs) : `noel_state()` → missions du jour et leur état, Hotte du jour, ❄️, palier, série, Grande Hotte (total, palier, contributeurs, mes ❄️, éligible), nouvelles récompenses attribuées ; `hotte_start()`, `hotte_answer(manche, réponse)`, `hotte_board()` (classement du jour).
- **Récompenses** : pièces via `coin_ledger` (raison `event_pass` / `event_band`, ref `noel-2026:<type>:<palier>`) ; objets via `profile_items` ; tenues via le système de tenues ; trophée via `trophy_unlocks`. Synchro idempotente, appelée par `noel_state()`.
- **Front** : `src/features/noel/` (carte d'accueil, page, Hotte, célébrations) ; nouveaux slots `fx_*` dans `src/data/cadeaux.ts` + rendu (avatar, grille du salon, écran de résultats, salon/télé) ; tenues dans `src/data/tenues.ts` ; thème « bande » dans `src/features/reveillon/themes.ts` (visible seulement pour un hôte éligible, info venue de `noel_state()`).
- **Contenu** : banques de la Hotte (40 quiz, 20 chansons, 20 « combien ») et 12 défis du thème « Réveillon de la Bande », rédigés par Fable.
- **Push** : texte du rappel de 18 h (fonction Vercel `api/daily-reminder`) conditionné à la période de l'événement.
- **Tests PGlite** (`tools/sql-tests/noel.mjs`) : tirage identique pour tous et déterministe, contraintes du slot 3 ; chaque mission du catalogue (réussie / non réussie) ; soirée bonus ; ❄️ et plafond 150/jour ; série et bonus une seule fois ; paliers du pass ; Grande Hotte (somme hors invités, seuil 400, rattrapage tardif, rien après la fin) ; récompenses jamais données deux fois, objet déjà possédé → 100 🪙 ; Hotte (un seul essai, réponses cachées, une réponse par manche, délai de 5 min, score et durée) ; invités refusés ; dates simulées (avant, pendant, dernier jour, après).

### 9.1 Livraison en 3 lots

1. **Avant le 1er décembre** : moteur, missions, Hotte et ses banques, pass (pièces + déco), Grande Hotte (paliers 1, 3, 4 : pièces, cadre, titre), carte d'accueil, page Noël, célébrations, texte du rappel.
2. **Avant le 10 décembre** : les 4 effets spéciaux (slots `fx_*` et leurs rendus).
3. **À l'arrivée des planches** : tenue Noël (~20 déc.), tenue Pyjama (~28 déc.), thème « Réveillon de la Bande », trophée « Esprit d'équipe 2026 », plaque souvenir de l'album.

Les paliers dont la récompense n'est pas encore livrée sont attribués dès qu'elle l'est (la synchro rattrape).

## 10. Hors périmètre

Pass payant, achat de ❄️, rattrapage de jours ratés, missions vérifiées en solo contre les bots (le solo ne compte jamais), invités, autres événements (Pâques…) — le moteur le permettra plus tard.
