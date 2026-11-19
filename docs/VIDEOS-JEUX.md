# Vidéos « Comment on joue ? » — scripts par jeu

Vidéos d'explication de 34 à 37 s, une par jeu (les 22 jeux sont faits), affichées dans l'appli par le bouton **« ❓ Comment on joue ? »**.

- **Format** : mp4 portrait 720 × 1280, 30 FPS, h264 CRF 30 (préréglage veryslow ; CRF 33 si > 3 Mo, comme Nom de Code), < 3 Mo (2,3 à 2,7 Mo en pratique : rester sous ~37 s). Pas de voix off : textes courts à l'écran + bruitages légers.
- **Ton** : « sticker book » (contours épais, ombres décalées, couleurs vives, gros rebonds), chibis de la bande, maquettes simplifiées des écrans (jamais de captures).
- **Structure commune** : Titre (3 s) → Le but (3,6 s) → 4 étapes illustrées (≈ 5-6 s chacune) → Pour gagner (4,2 s) → « À vous de jouer ! » (3 s).

## Fabrication

| Quoi | Où |
| --- | --- |
| Gabarit Remotion (scènes génériques, boîte à outils) | `promo-video/src/tuto/` (`Tuto.tsx`, `scenes.tsx`, `kit.tsx`, `types.ts`) |
| Script d'un jeu (textes + maquettes animées) | `promo-video/src/tuto/games/<id>.tsx` → exporte un `TutoSpec` |
| Morceaux partagés : chrono, tableau de points (`ScoreRows`), téléphone, bouton, objet volant (`Fly`), scènes de duel `makeVersus` / `makeBetting` | `promo-video/src/tuto/parts.tsx` |
| Liste des tutos → compositions `Tuto-<id>` | `promo-video/src/tuto/registry.ts` |
| Rendu de tous les tutos + copie dans l'appli | `cd promo-video && npm run render:tutos` (ou `npm run render:tutos -- morpion`) |
| Planche de contrôle : les 4 étapes côte à côte, figées à N % de leur durée (compositions `Sheet-<id>`) | `cd promo-video && sh scripts/sheet.sh <id> 50 92` → `out/tutos-check/sheet-<id>-<N>.png` |
| Vidéos servies par l'appli | `public/tutos/<id>.mp4` |
| Jeux qui affichent le bouton | `src/data/tutos.ts` (`TUTO_GAME_IDS`) |

**Ajouter un jeu** : 1) écrire `games/<id>.tsx` (copier `morpion.tsx`) : `goal`, 4 `steps` (texte ≤ ~60 caractères + maquette `Mock` dessinée dans 720 × 880 px), `win` ; 2) l'ajouter à `registry.ts` ; 3) contrôler les planches (`sh scripts/sheet.sh <id> 50 92`) et, au besoin, une image précise (`npx remotion still src/index.ts Tuto-<id> out/x.png --frame=300`) ; 4) `npm run render:tutos -- <id>` ; 5) ajouter l'id à `TUTO_GAME_IDS`.

**Pièges** : la maquette reçoit `f` décalé de 8 frames, donc **négatif au tout début** de l'étape (ne jamais indexer un tableau avec `f` sans `Math.max(0, f)`) ; les planches ne montrent pas ces frames, seul le rendu complet les traverse. Carole et Nini n'ont pas les expressions `cool` / `amoureux` (ne pas les mettre dans les scènes de duel). Les textes des pastilles débordent vite : ≤ ~30 caractères à 36 px.

**Tenues** : `Chibi` accepte `outfit` (défaut `default`) et `TutoSpec.outfits` l’applique aux scènes titre/finale ; la tenue doit exister dans `promo-video/public/chibis/<slug>/<tenue>/` (copie de `public/chibis`).

État : ✅ réalisé — ⏳ script prêt, vidéo à faire. Les tableaux ci-dessous décrivent les vidéos telles qu'elles sont rendues.

---

## ✅ Morpion ❌ — 2 à 9 joueurs (duel) — 34,6 s
**But** : « Aligne 3 symboles avant ton adversaire ! » · Chibis : Keke (❌), Cycy (⭕), Dédé, Mika, Manon.

| # | Durée | Texte à l'écran | Image |
| --- | --- | --- | --- |
| 1 | 4,6 s | Un duel : deux joueurs s'affrontent | Keke et Cycy face à face, gros « VS », pastille « ❌ commence ! » |
| 2 | 5,6 s | Chacun son tour, touche une case pour poser ton symbole | Grille 3×3, le doigt pose ❌, ⭕, ❌ ; « ⏱️ 30 s pour jouer » |
| 3 | 5,4 s | Aligne 3 symboles : en ligne, en colonne ou en diagonale | Fin de partie, la ligne gagnante passe au vert, « 3 alignés ! », confettis |
| 4 | 5,2 s | Les autres regardent… et parient sur le vainqueur ! | Les spectateurs lancent leurs jetons 🪙 sur Keke ou Cycy |
| 🏆 | 4,2 s | Le premier qui aligne ses symboles gagne le duel ! — *Existe aussi en Géant (aligne-en 5) et en Ultime (9 petits morpions).* | Keke saute de joie |

## ✅ Undercover 🕵️ — 3 à 9 joueurs — 35,6 s
**But** : « Démasquez l'infiltré… sans vous trahir ! » · Chibis : Dédé, Keke, Cycy (mot « Chat »), Mika (infiltré, « Chien »).

| # | Durée | Texte à l'écran | Image |
| --- | --- | --- | --- |
| 1 | 5,8 s | Chacun reçoit un mot secret sur son téléphone | 4 cartes se retournent : Chat, Chat, Chat… Chien. « 🕵️ L'infiltré a un mot voisin… et il ne le sait pas ! » |
| 2 | 6 s | À tour de rôle, décris ton mot à voix haute… en UN seul mot | Bulles « Moustaches », « Ronron », « Griffes », « Aboie » → « Hein ?! » |
| 3 | 5 s | Débattez, puis votez pour éliminer le suspect | Les votes 👉 volent vers Mika (3) ; « 🤫 Vote secret sur ton téléphone » |
| 4 | 5 s | Le plus voté est éliminé : son rôle est révélé ! | Carte « Éliminé ! Mika », tampon « 🕵️ UNDERCOVER », les civils fêtent ça |
| 🏆 | 4,2 s | Les civils gagnent en éliminant tous les infiltrés. — *Les infiltrés gagnent s'ils tiennent jusqu'à être aussi nombreux que les civils !* | Les 3 civils sautent |

Non montré (à garder pour une v2) : Mister White (dès 5 joueurs, aucun mot ; éliminé, il gagne s'il devine le mot des civils).

## ✅ Dessine & devine ✏️ — 3 à 9 joueurs — 35,8 s
**But** : « Fais deviner ton dessin… et devine ceux des autres ! » · Chibis : Cycy (dessine), Keke, Dédé, Marius.

| # | Durée | Texte à l'écran | Image |
| --- | --- | --- | --- |
| 1 | 5 s | Le dessinateur choisit 1 mot secret parmi 3 | Cartes « Fusée / Chat / Pizza », le doigt choisit « Chat » ; « 🤫 Les autres ne voient pas le mot » |
| 2 | 5,6 s | Il le dessine au doigt sur son téléphone | Un chat se dessine trait par trait, chrono qui descend, palette de couleurs |
| 3 | 6 s | Les autres tapent leurs propositions, vite ! | « un chien ? », « lapin ! », puis « ✅ Marius a trouvé ! » ; lettres en indice « C _ _ _ » |
| 4 | 5,4 s | Plus tu trouves vite, plus tu marques | Marius +190 (le plus rapide), Dédé +150, Keke +0, Cycy +80 (« +40 par joueur qui trouve ») |
| 🏆 | 4,2 s | Chacun dessine à son tour. Le plus gros score gagne ! | Marius et Cycy sautent |

---

## ✅ Qui de nous ? 🫵 — 3 à 9 joueurs — 34,4 s
**But** : « Vote comme la majorité pour marquer ! » · Chibis : Dédé, Keke, Cycy, Mika, Manon, Marius.

| # | Durée | Texte à l’écran | Image |
| --- | --- | --- | --- |
| 1 | 4,8 s | Une question s’affiche pour tout le monde | Carte « Qui finirait les restes du frigo à 3 h du mat’ ? », les chibis réfléchissent |
| 2 | 5 s | En secret, touche le joueur qui correspond le mieux | Grille des 6 joueurs, le doigt choisit Mika ; « 🤫 Personne ne voit ton vote » |
| 3 | 5,8 s | Les votes sont révélés ! | Les jetons 🫵 volent vers les avatars : Mika 4, Dédé 1, Keke 1 ; « C’est Mika ! 4 votes : c’est la majorité » |
| 4 | 5 s | Tu as voté comme la majorité ? +1 point | Dédé +1, Cycy +1 (ont voté Mika) ; Keke +0, Mika +0 |
| 🏆 | 4,2 s | Le plus de points à la fin des questions gagne ! | Dédé et Cycy sautent |

## ✅ Pas de bol ! 🃏 — 2 à 9 joueurs — 35,0 s
**But** : « Vide ta main avant les autres ! » · Chibis : Cycy, Dédé, Keke, Mika.

| # | Durée | Texte à l’écran | Image |
| --- | --- | --- | --- |
| 1 | 5,4 s | Pose une carte de la même couleur ou du même symbole | Pile « 5 vert », main en éventail : le 9 vert (« même couleur ») et le 5 bleu (« même chiffre ») se lèvent, le 9 vert vole sur la pile |
| 2 | 4,4 s | Rien à poser ? Pioche ! | Aucune carte jouable (« Aucune ne va… ») : le doigt touche la pioche, une carte rejoint la main |
| 3 | 5,8 s | Les +2 et +4 se cumulent… aïe ! | +2 (Dédé), +2 (Keke), +4 (Cycy) s’empilent : compteur +2 → +4 → +8, « Mika pioche 8 cartes ! » ; rappel « +2 sur +2, +4 sur tout » |
| 4 | 5,6 s | Plus qu’une carte ? Touche « Dernière carte ! » | Gros bouton « 📣 Dernière carte ! » ; encart « Oublié ? Un autre joueur te dénonce : tu pioches 2 cartes ! » |
| 🏆 | 4,2 s | Vide ta main pour être sauvé. Le dernier avec des cartes… a pas de bol ! | Les trois rescapés sautent |

## ✅ Cerveau en fête 🧠 — 2 à 9 joueurs — 34,4 s
**But** : « Réponds juste… et plus vite que les autres ! » · Chibis : Manon, Marius, Keke, Mika.

| # | Durée | Texte à l’écran | Image |
| --- | --- | --- | --- |
| 1 | 4,4 s | Une question, un chrono | Carte « Quelle est la capitale de l’Australie ? » + barre de temps |
| 2 | 6 s | Tape ta réponse : essais illimités, petites fautes acceptées | Saisie « sydney » ❌ (« Raté ? Réessaie tout de suite ! ») puis « canbera » ✅ (« Petite faute acceptée : Canberra ») |
| 3 | 5 s | Certaines questions sont en QCM : un seul essai ! | Badge « 🔘 QCM · 1 essai », 4 boutons (dinosaures), le doigt choisit « Tyrannosaure » ✅ |
| 4 | 5,2 s | Plus tu es rapide, plus tu marques : +20 pour le premier ! | Manon +200 (1re : bonus +20), Marius +150, Keke +110, Mika +0 |
| 🏆 | 4,2 s | Le meilleur score à la fin du quiz gagne ! | Manon saute |

Écart corrigé : le QCM n’est pas un choix du joueur. Chaque question est soit « à taper », soit en QCM (format choisi par l’hôte : tapé / QCM / mélange). Barème réel : tapé 100 + jusqu’à 100 de vitesse, QCM 60 + jusqu’à 60, +20 au premier.

## ✅ Petit bac 🔤 — 2 à 9 joueurs — 35,0 s
**But** : « Un mot par catégorie, avec la bonne lettre ! » · Chibis : Cycy, Dédé, Keke, Mika.

| # | Durée | Texte à l’écran | Image |
| --- | --- | --- | --- |
| 1 | 4,4 s | Une lettre est tirée au sort | Grosse tuile qui fait défiler les lettres puis s’arrête sur « B » ; « Nouvelle lettre à chaque manche » |
| 2 | 6 s | Remplis un mot par catégorie avant la fin du chrono | Feuille Pays / Animal / Métier / Fruit ou légume qui se remplit : Belgique, Baleine, Boulanger, Banane ; chrono |
| 3 | 5,6 s | On valide ensemble : 👎 pour contester | Métier en B : Boulanger ✅, Boucher ✅, « Bébé » reçoit 2 👎 → tampon « Refusé : 0 point » (la majorité a contesté) |
| 4 | 5,2 s | Réponse unique : 2 points. Réponse partagée : 1 point | Pays en B : Bolivie (unique) +2, Belgique ×2 (partagée) +1 chacun, case vide +0 |
| 🏆 | 4,2 s | Le plus de points après toutes les manches gagne ! | Cycy saute |

Précision : une réponse est refusée si la majorité stricte des AUTRES joueurs la conteste.

## ✅ Loup-garou 🐺 — 36,4 s
**But** : « Village contre loups : qui ment autour de la table ? » · Chibis : Dédé (sorcière), Mika et Manon (loups), Cycy (voyante), Keke, Marius.

| # | Durée | Texte à l’écran | Image |
| --- | --- | --- | --- |
| 1 | 4,8 s | Chacun reçoit un rôle secret sur son téléphone | 4 cartes se retournent : Villageois, Loup-garou, Voyante, Sorcière ; « 🤫 Ne montre ton écran à personne ! » |
| 2 | 6 s | La nuit, tout le monde ferme les yeux… sauf les loups ! | Fond nuit étoilé : les 6 chibis dorment, Mika et Manon se réveillent (🐺) et désignent Marius (🐾) |
| 3 | 5,6 s | Les rôles spéciaux agissent en douce | Fond nuit : la Voyante retourne une carte (« Mika : 🐺 »), la Sorcière « peut sauver… ou éliminer » ; « Cupidon · Chasseur · Protecteur… », « 📱 Chacun agit sur son téléphone » |
| 4 | 6,2 s | Le jour : débattez, puis votez pour éliminer un suspect | Soleil : « Au matin : Marius a été dévoré », bulles de débat, 3 votes 👉 sur Mika → « Mika éliminé : c’était un 🐺 ! », « 🌙 Puis la nuit retombe… » |
| 🏆 | 4,2 s | Le village gagne s’il élimine tous les loups. — *Les loups gagnent s’ils deviennent aussi nombreux que les autres joueurs !* | Les villageois sautent |

De 5 à 9 joueurs (le titre du script ne le disait pas). Fond nuit : composant `Night` (z-index négatif dans la scène, sous le bandeau). Non montré : les amoureux de Cupidon (gagnent s’ils sont les 2 derniers).

## ✅ Bombe à mots 💣 — 2 à 9 joueurs — 34,6 s
**But** : « Trouve un mot avant que ça fasse BOUM ! » · Chibis : Keke, Cycy, Mika, Dédé, Manon.

| # | Durée | Texte à l’écran | Image |
| --- | --- | --- | --- |
| 1 | 4,6 s | La bombe tourne autour de la table | 5 chibis en cercle (3 ❤️ chacun), la bombe saute de l’un à l’autre autour de la syllabe « TRA » |
| 2 | 5,6 s | À ton tour : tape un mot qui contient la syllabe | Syllabe « TRA », saisie « TRACTEUR » ✅, « 💣 La bombe passe au suivant ! » |
| 3 | 5,2 s | Personne ne sait quand elle explose… | Mika sèche (« trou… »), la bombe grossit et tremble, « ⏳ Mèche cachée… », BOUM ! −1 vie |
| 4 | 5,4 s | Utilise toutes les lettres de ton alphabet bonus : +1 vie | Alphabet bonus (21 lettres) presque complet : « TRAVAIL » coche le V → « +1 ❤️ », « Alphabet complet ! » |
| 🏆 | 4,2 s | Plus de vie ? Tu es éliminé. Le dernier debout gagne ! | Cycy saute |

Précision : l’alphabet bonus compte 21 lettres (a → v sans k) ; la vie n’est rendue que si on en a perdu.

## ✅ Menteur 🎲 — 2 à 9 joueurs — 35,2 s
**But** : « Bluffe sur les dés… sans te faire prendre ! » · Chibis : Dédé, Keke, Cycy, Mika.

| # | Durée | Texte à l’écran | Image |
| --- | --- | --- | --- |
| 1 | 4,8 s | Chacun cache 5 dés sous son gobelet | 3 gobelets secoués (« Leurs dés restent cachés »), puis « Tes 5 dés (toi seul les vois) » |
| 2 | 5,8 s | À ton tour, monte l’enchère : « 4 dés de 5 » sur toute la table | Bulles « 3 dés de ⚄ », « 4 dés de ⚄ », « 5 dés de ⚄ » ; « Toujours plus haut ! », « Tous les dés de la table comptent », « Les 1 sont des jokers » |
| 3 | 5 s | Tu n’y crois pas ? Crie « Menteur ! » : on soulève tout | Mika doute de Cycy : gros bouton « 🫵 Menteur ! », les 4 gobelets se soulèvent |
| 4 | 5,8 s | On compte : celui qui s’est trompé perd un dé | Les 20 dés à plat, les 5 et les 1 comptés un à un : 4 seulement. « Il en fallait 5 : Cycy mentait ! », son dé s’envole |
| 🏆 | 4,2 s | Plus de dé ? Éliminé ! Le dernier à avoir des dés gagne. — *Si l’enchère était vraie, c’est celui qui a crié « Menteur ! » qui perd un dé.* | Mika saute |

Non montré : variante « Pile ! » (option), règles d’enchère sur les 1 (« Paco »).

## ✅ Bowling 🎳 — 2 à 9 joueurs — 34,2 s
**But** : « Fais tomber un max de quilles ! » · Chibis : Keke, Dédé, Cycy, Manon.

| # | Durée | Texte à l’écran | Image |
| --- | --- | --- | --- |
| 1 | 4,6 s | Chacun sa piste sur son téléphone, tous en même temps | 3 téléphones (Dédé, Keke, Cycy), chacun sa piste et son lancer ; « 📱 Pas besoin d’attendre son tour ! » |
| 2 | 4,8 s | Glisse la boule sur le côté pour te placer | Grande piste en perspective, le doigt fait glisser la boule de gauche à droite ; « ⬅ ➡ » |
| 3 | 5,4 s | Glisse vers le haut pour lancer : vise les quilles ! | Geste vers le haut en courbe (trace jaune), la boule file avec de l’effet ; « ⚡ Vite = fort », « ↪️ Courbe = effet » ; les quilles volent : « Badaboum ! » |
| 4 | 5,6 s | Strike, spare… ce sont les vraies règles du bowling | « STRIKE ! » + feuille de score : X = 20, 7/ = 39, 9– = 48 ; « Strike : 10 + tes 2 prochains lancers », « Spare : 10 + ton prochain lancer » |
| 🏆 | 4,2 s | Le meilleur score total gagne ! — *Partie en 3, 5 ou 10 frames, avec lancers bonus à la dernière.* | Keke saute |

## ✅ Tu préfères ? 🤔 — 2 à 9 joueurs — 33,8 s
**But** : « Devine ce que préfère la majorité ! » · Chibis : Mika, Dédé, Keke, Cycy, Manon.

| # | Durée | Texte à l’écran | Image |
| --- | --- | --- | --- |
| 1 | 4,4 s | Un dilemme, deux choix | Deux cartes : 🍝 « Des spaghettis à la place des mains » OU 🌭 « Des saucisses à la place des pieds » |
| 2 | 4,6 s | En secret : ce que TU préfères… | Le doigt choisit 🍝 : étiquette « ❤️ Mon choix » ; « 🤫 Les autres ne voient rien » |
| 3 | 4,6 s | …puis ce que choisira la MAJORITÉ | Le doigt choisit 🌭 : étiquette « 🔮 Mon pari » ; « Que vont choisir les autres ? » |
| 4 | 6,4 s | Pari juste : +1 point. Seul de ton avis ? Bonus Rebelle +1 ! | Barres : 🍝 1 (Mika), 🌭 4 → « 👑 Majorité » ; « 🔮 Pari juste +1 », « 😎 Bonus Rebelle (seul de son avis) +1 » |
| 🏆 | 4,2 s | Le plus de points à la fin des dilemmes gagne ! — *Égalité parfaite entre les deux choix : personne ne marque.* | Mika saute |

## ✅ Qui suis-je ? 🙈 — 2 à 9 joueurs — 34,0 s
**But** : « Devine la carte collée sur ton front ! » · Chibis : Keke (devine), Cycy, Dédé, Mika.

| # | Durée | Texte à l’écran | Image |
| --- | --- | --- | --- |
| 1 | 5 s | Pose ton téléphone sur ton front, écran vers les autres | Keke, téléphone « ASTÉRIX » sur le front ; « Lui ne voit pas la carte… mais les autres, si ! » |
| 2 | 5,6 s | Les autres te font deviner à l’oral | Bulles « C’est un Gaulois ! », « Petit, avec une moustache », « Il adore la potion ! » → « Astérix ?! » |
| 3 | 4,8 s | Trouvé ? Incline le téléphone vers le bas | Gros téléphone qui bascule vers le bas (flèche ⬇) : écran vert « ✅ Trouvé ! », compteur de cartes +1 |
| 4 | 4,8 s | Tu sèches ? Incline vers le haut pour passer | Le téléphone bascule vers le haut (flèche ⬆) : écran orange « ⏭️ Passé », carte suivante, pas de point |
| 🏆 | 4,2 s | Chacun son tour : un maximum de cartes avant la fin du chrono ! — *Les boutons « Trouvé » et « Passer » marchent aussi.* | Keke saute |

## ✅ Le plus proche 🎯 — 2 à 9 joueurs — 34,6 s
**But** : « Estime le bon nombre… au plus près ! » · Chibis : Dédé, Cycy, Keke, Mika.

| # | Durée | Texte à l’écran | Image |
| --- | --- | --- | --- |
| 1 | 4,6 s | Une question dont la réponse est un nombre | Carte 🗼 « Combien de marches à la tour Eiffel ? » ; « Euh… 300 ? » |
| 2 | 5,2 s | Chacun tape son estimation en secret | Pavé numérique : 1, 7, 0, 0 puis OK → « 1 700 🔒 » ; « 🤫 Personne ne voit ta réponse » |
| 3 | 5,8 s | Révélation : qui est le plus proche ? | Règle graduée : Mika 300, Keke 1 200, Dédé 1 700, Cycy 2 000, puis le repère « ✅ 1 665 marches » ; « Dédé est la plus proche ! » |
| 4 | 5,2 s | 3, 2, 1 points pour le podium… +5 si c’est pile exact ! | Dédé +3, Cycy +2, Keke +1 ; encart « 🎯 Pile exact ? +5 (bonus en plus des points) » |
| 🏆 | 4,2 s | Le plus de points après toutes les manches gagne ! | Dédé saute |

## ✅ Action ou vérité 🎭 — 3 à 9 joueurs — 35,2 s
**But** : « Relève le défi… ou gare au gage ! » · Chibis : Marius (désigné), Dédé, Cycy, Keke, Manon.

| # | Durée | Texte à l’écran | Image |
| --- | --- | --- | --- |
| 1 | 4,8 s | La roue désigne un joueur | Roue des 5 joueurs qui tourne et s’arrête sur Marius ; « Jamais le même deux fois de suite » |
| 2 | 4,4 s | Il choisit : ACTION ou VÉRITÉ | Deux gros boutons 🎬 ACTION / 💬 VÉRITÉ, le doigt choisit ACTION ; « ⏱️ 15 s pour te décider ! » |
| 3 | 5,8 s | Les autres votent en secret parmi 3 cartes | 3 cartes d’action, les votes 🗳️ des 4 autres : « Danse la Macarena sans musique » l’emporte (3 voix) |
| 4 | 6,4 s | Réussi ? La bande vote 👍 : +1 point. Refusé : un gage ! | Marius danse, 👍 3 / 👎 1 → « +1 », « Majorité de 👍 : c’est réussi ! » ; encart « 🚩 Tu refuses la carte ? Un gage tiré au sort, 0 point ! » |
| 🏆 | 4,2 s | Le plus de points à la fin des tours gagne ! | Marius saute |

## ✅ Devine en équipe 🗣️ — 4 à 9 joueurs — 34,6 s
**But** : « Fais deviner un max de mots à ton équipe ! » · Chibis : Rouges : Dédé, Keke · Bleus : Cycy, Mika.

| # | Durée | Texte à l’écran | Image |
| --- | --- | --- | --- |
| 1 | 4,8 s | Rouges contre Bleus, une pioche de mots | Deux panneaux d’équipe « VS », pioche « 🃏 30 mots » ; « Les mêmes mots pendant 3 manches » |
| 2 | 5,6 s | Manche 1 : décris le mot… sans le dire ! | Dédé (carte « PARAPLUIE ») : « Ça s’ouvre quand il pleut… » → Keke : « Un parapluie ! ✅ », +1 aux Rouges, chrono |
| 3 | 5,2 s | Manche 2 : un seul mot d’indice ! | Cycy : « Pluie » → Mika : « Un parapluie ! ✅ », +1 aux Bleus |
| 4 | 5,2 s | Manche 3 : mime, sans parler | Keke mime (☂️, « 🤐 Chut ! ») → Dédé : « Un parapluie ! ✅ », +1 aux Rouges |
| 🏆 | 4,2 s | L’équipe qui trouve le plus de mots gagne ! — *À chaque passage, un orateur fait deviner son équipe contre le chrono. Les adversaires surveillent la triche !* | Dédé et Keke sautent |

## ✅ 4 à la suite 🔴 — 2 à 9 joueurs (duel) — 34,4 s
**But** : « Aligne 4 jetons avant ton adversaire ! » · Chibis : Keke, Cycy (jetons à leur effigie), Dédé, Mika, Manon.

| # | Durée | Texte à l’écran | Image |
| --- | --- | --- | --- |
| 1 | 4,4 s | Un duel : deux joueurs s’affrontent | Scène VS du Morpion (`makeVersus`), pastille « Chacun ses jetons ! » |
| 2 | 5,8 s | Chacun son tour, touche une colonne pour lâcher un jeton | Grille 7 × 6, le doigt touche le haut d’une colonne : 4 jetons chutent avec rebond ; « ⬇️ Le jeton tombe tout en bas » |
| 3 | 5,4 s | Aligne-en 4 : en ligne, en colonne ou en diagonale | Fin de partie : Keke complète une diagonale, les 4 jetons cerclés de jaune, « 4 à la suite ! », confettis |
| 4 | 5 s | Les autres regardent… et parient sur le vainqueur ! | Scène de paris du Morpion (`makeBetting`) |
| 🏆 | 4,2 s | Le premier qui aligne 4 jetons gagne le duel ! — *Grille pleine : match nul. Tu as 30 s par coup.* | Keke saute |

## ✅ Bataille navale 🚢 — 2 à 9 joueurs (duel) — 35,2 s
**But** : « Coule toute la flotte adverse ! » · Chibis : Marius, Cécile, Dédé, Mika, Manon.

| # | Durée | Texte à l’écran | Image |
| --- | --- | --- | --- |
| 1 | 6 s | Un duel ! En 60 s, place tes 5 bateaux en secret | Grille 10 × 10 avec les 5 bateaux (5, 4, 3, 3, 2 cases), chrono ; « 🎲 Mélanger » redistribue la flotte, « 👆 Touche un bateau : il pivote », « ✅ Prêt ! » |
| 2 | 4,8 s | Chacun son tour, tire sur une case de la grille adverse | Grille adverse, « 🎯 Marius tire » : tir dans l’eau → « 💦 À l’eau ! », bandeau « 🎯 À Cécile de tirer » |
| 3 | 5,6 s | Touché ou coulé ? Tu rejoues ! | 3 tirs enchaînés : « 💥 Touché ! », « Encore touché ! », « Coulé ! » (le bateau apparaît en rouge) ; « 🔁 Tu rejoues ! » |
| 4 | 5 s | Les autres regardent les deux grilles… et parient ! | Scène de paris du Morpion (`makeBetting`) |
| 🏆 | 4,2 s | Le premier qui coule toute la flotte adverse gagne ! — *Tu as 30 s par tir.* | Marius saute |

## ✅ Le Tour des Potes 🏙️ — 2 à 9 joueurs — 34,2 s
**But** : « Deviens le plus riche de la bande ! » · Chibis : Dédé, Keke, Cycy, Mika.

| # | Durée | Texte à l’écran | Image |
| --- | --- | --- | --- |
| 1 | 5 s | Lance les dés et avance sur le plateau | Plateau stylisé de 40 cases : les dés roulent (3 + 5), « 8 cases ! », le pion de Dédé saute jusqu’au Château Falfas ; « 🏁 Passe par le Départ : +200 € », « 🎲 Un double ? Tu rejoues ! » |
| 2 | 4,8 s | Tu t’arrêtes sur un lieu libre ? Achète-le ! | Titre de propriété « Château Falfas — 100 € » (loyer 6 €, avec hôtel 550 €), bouton « Acheter », billets vers la banque, 1 500 € → 1 400 €, tampon « 🔑 À Dédé ! » |
| 3 | 5,6 s | Réunis un quartier pour construire maisons puis hôtel | Les 3 titres du quartier bleu de Bayon : les maisons poussent (1 → 4) puis l’hôtel ; « 🏠 50 € la maison » |
| 4 | 5 s | Les autres tombent chez toi ? Ils paient le loyer ! | Keke s’arrête sur le Château Falfas (hôtel) : « Loyer : 550 € ! », billets de Keke vers Dédé (1 100 → 1 650 € ; 1 280 → 730 €) |
| 🏆 | 4,2 s | À la fin, la plus grosse fortune gagne ! — *Fortune = argent + lieux + bâtiments. Et gare au violon !* | Dédé saute |

Écart : l’ordre des étapes 3 et 4 du script initial a été inversé (construire, puis loyer) pour montrer un loyer d’hôtel réel plutôt que le loyer nu de 6 €. Prix et loyers = ceux de `board.ts` (case 8).

## ✅ Dédé Kart 🏎️ — 2 à 12 joueurs — 35,2 s
**But** : « Franchis la ligne d’arrivée avant les autres ! » · Chibis : Keke, Manon, Mika, Dédé.

| # | Durée | Texte à l’écran | Image |
| --- | --- | --- | --- |
| 1 | 5,6 s | Pose le doigt à gauche ou à droite pour tourner | Téléphone à l’horizontale, route en fausse 3D : zones ◀ / ▶ qui s’allument sous le doigt, le kart vire à gauche puis à droite ; « 🚀 Ça accélère tout seul ! » |
| 2 | 5,8 s | Dans un grand virage, redresse pour le mini-turbo ! | Le kart penche dans un grand virage (« ça dérape tout seul »), étincelles et jauge bleu → orange → violet, puis redressement : flammes, « Mini-turbo ! » |
| 3 | 5,4 s | Roule sur les boîtes « ? » et touche OBJET pour l’utiliser | Une boîte « ? » arrive sur la route, la case OBJET fait défiler les objets puis affiche 🚀 ; le doigt touche OBJET : coup de turbo |
| 4 | 4,6 s | Des points à chaque course | Arrivée de la course 1/3 : Manon +15, Keke +12, Mika +10, Dédé +8 |
| 🏆 | 4,2 s | Le meilleur total gagne la coupe ! — *En 1 course ou en coupe de 3 courses.* | Manon saute |

Barème réel : 15, 12, 10, 8, 7, 6, 5, 4, 3, 2, 1, 0 points. En 1 course ou en coupe de 3 courses.

## ✅ Nom de Code 🔐 — 4 à 9 joueurs — 35,4 s
**But** : « Fais deviner tous tes mots à ton équipe… sans toucher la bombe ! » · Chibis : Rouges : Dédé (espion), Keke, Manon, Mika · Bleus : Cycy (espionne), Marius, Cécile. **Tenues : les deux espions, Dédé et Cycy, portent la tenue Hacker 💻 dans toute la vidéo (titre et scène finale compris) ; tous les autres restent en tenue par défaut.**

| # | Durée | Texte à l’écran | Image |
| --- | --- | --- | --- |
| 1 | 5,2 s | En équipes : seul l’espion voit quels mots sont les vôtres | Panneaux 🔴 Rouges / 🔵 Bleus, Dédé et Cycy en tenue Hacker (pastille « 🕵️ Espion »), leurs équipiers en tenue par défaut ; puis le téléphone de Dédé : grille 5 × 5 aux cartes teintées (rouge, bleu, beige, 💣 sur « VOLCAN ») ; « 🤫 Les autres ne voient pas les couleurs » |
| 2 | 5,6 s | L’espion donne un indice : UN seul mot et un nombre | Téléphone de Dédé (tenue Hacker, réflexion) : « CHAT », « LION », « REQUIN » clignotent en rouge, il tape « ANIMAL », touche le gros bouton « 3 » puis « Envoyer » ; « 3 = trois mots à trouver » |
| 3 | 5,6 s | Pose ta tête sur un mot : la majorité de l’équipe dévoile | Grille sans couleurs, bandeau « 🔎 ANIMAL · 3 » : les têtes de Keke puis Manon (tenue par défaut) se posent sur « CHAT » (« 2 sur 3 »), la carte se retourne en rouge, Dédé (tenue Hacker) jubile dans un coin ; « ✅ Bon mot : vous continuez ! » |
| 4 | 5,2 s | Raté ? Le tour passe. La bombe 💣 ? Ton équipe est éliminée ! | Les Rouges tentent « HIBOU » : carte beige, « 😬 Neutre : aux Bleus ! » (Keke boude) ; puis les Bleus dévoilent « VOLCAN » : 💥 explosion, l’écran tremble, Marius et Cécile (tenue par défaut) surpris, Cycy (tenue Hacker) en pleurs, « 💣 Boum ! » |
| 🏆 | 4,2 s | La première équipe qui trouve tous ses mots gagne ! — *De 2 à 4 équipes. Sans chrono, ou avec, au choix de l’hôte.* | Dédé (tenue Hacker), Keke, Manon et Mika (tenue par défaut) sautent |

Grille d’exemple (mots réels de `words.ts`) : chat, pizza, lune, piano, pirate / fusée, lion, clé, volcan, tarte / robot, vélo, requin, roi, neige / plage, épée, citron, hibou, train / lampe, micro, gâteau, phare, golf. Rouges : chat, lion, requin (+ 6 autres) ; « hibou » neutre (le piège de l’indice « ANIMAL ») ; bombe : volcan. Majorité = plus de la moitié des devineurs (3 devineurs rouges → 2 têtes).

Non montré : essais = nombre de l’indice + 1 (le « HIBOU » de l’étape 4 est ce 4ᵉ essai) ; bouton « ✋ Stop, on passe » (à la majorité, après un mot dévoilé) ; un mot d’une autre équipe dévoilé compte pour elle et termine le tour ; l’indice ne peut pas être un mot de la grille ; à 3-4 équipes la partie continue sans l’équipe éliminée (la dernière en lice gagne), à 2 équipes la bombe fait gagner l’adversaire ; option « chacun son tour d’espion » (plusieurs manches) ; banc 👀 ; mode télé.

## ✅ Échecs ♟️ — 2 à 9 joueurs (duel) — 35,4 s
**But** : « Mets le roi adverse échec et mat ! » · Chibis : Nini (⚪ Blancs), Keke (⚫ Noirs), Dédé, Mika, Manon. **Tenues : Nini porte la tenue Grand Maître ♟️ (dossier d’art `chess`) dans toute la vidéo (titre et scène finale compris) ; Keke et les spectateurs restent en tenue par défaut (les autres planches Grand Maître ne sont pas encore livrées).**

| # | Durée | Texte à l’écran | Image |
| --- | --- | --- | --- |
| 1 | 4,6 s | Un duel ! Les Blancs commencent, chacun a sa pendule | Scène VS du Morpion (`makeVersus`) : Nini (tenue Grand Maître) contre Keke, une pendule « 5:00 » sous chacun ; celle de Nini se met à descendre ; pastille « ⚪ Nini a les Blancs » |
| 2 | 6 s | Touche une pièce, ses cases s’allument : touche la case ! | Échiquier 8 × 8 (cases crème / turquoise), position de départ : le doigt touche le pion e2, il se soulève, deux points s’allument (e3, e4), le doigt touche e4, le pion glisse ; puis le cavalier g1 : points en f3 et h3, il saute en f3. Sous le plateau, le bouton « ❓ Les pièces » rebondit ; pastille « ❓ Perdu ? La fiche des pièces » |
| 3 | 5,8 s | Roi attaqué : échec ! Sans issue : échec et mat ! | Mat du berger : le doigt touche la dame blanche h5, un anneau rouge entoure le pion f7 (« ⭕ = prise »), elle le prend ; la case du roi noir passe au rouge, bandeau « Échec ! », le roi se couche, « Échec et mat ! », confettis ; Nini (tenue Grand Maître, joie) dans un coin, Keke en pleurs |
| 4 | 5,2 s | Les autres regardent… et parient sur le vainqueur ! | Scène de paris du Morpion (`makeBetting`) : Dédé, Mika et Manon lancent leurs jetons 🪙 sur Nini (tenue Grand Maître) ou Keke |
| 🏆 | 4,2 s | Échec et mat : tu gagnes le duel ! — *Pendule à zéro : perdu ! 3, 5 ou 10 min, ou sans pendule.* | Nini (tenue Grand Maître, joie) saute |

Total : 3 + 3,6 + 21,6 + 4,2 + 3 = 35,4 s. La vidéo montre l’appli, pas les règles des échecs : la fiche « ❓ Les pièces » (`Aide.tsx`) s’en charge. Position de l’étape 3 (réelle, 1. e4 e5 2. Dh5 Cc6 3. Fc4 Cf6 4. Dxf7#) : la dame en f7 est protégée par le fou c4. Dans l’appli le bandeau « Échec ! » et la raison de fin « Échec et mat ! » sont deux affichages distincts : la vidéo les enchaîne pour expliquer les deux mots.

Expressions de Nini en tenue `chess` (`public/chibis/nini/chess/`) : joie, colere, pleurs, boude, reflexion, dodo, bisou, clin_oeil, surprise, cool, amoureux, gamer — pas de `pouces`, `timide` ni `determine`. `cool` existe dans cette tenue (Nini côté gauche de `makeVersus` et dans `makeBetting` : OK, à condition de leur passer la tenue ; Nini n’a pas `cool` en tenue par défaut). Copier `public/chibis/nini/chess/` dans `promo-video/public/chibis/nini/chess/`.

Non montré : promotion (4 gros boutons, dame en premier), roque, prise en passant ; nuls (pat, 3 fois la même position, 50 coups, plus assez de pièces, commun accord via « 🤝 Proposer nul ») ; « 🏳️ Abandonner » ; pièce bloquée qui tremble ; dernier coup surligné, pièces prises et avance de matériel ; sans pendule : 60 s par coup puis coup légal au hasard ; pendule à zéro face à un roi seul = nul ; formats Roi de la table / Tournoi (Duel par défaut) ; mode télé.
