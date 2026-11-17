# Vidéos « Comment on joue ? » — scripts par jeu

Vidéos d'explication de 30 à 45 s, une par jeu, affichées dans l'appli par le bouton **« ❓ Comment on joue ? »**.

- **Format** : mp4 portrait 720 × 1280, 30 FPS, h264 CRF 28, < 3 Mo. Pas de voix off : textes courts à l'écran + bruitages légers.
- **Ton** : « sticker book » (contours épais, ombres décalées, couleurs vives, gros rebonds), chibis de la bande, maquettes simplifiées des écrans (jamais de captures).
- **Structure commune** : Titre (3 s) → Le but (3,6 s) → 4 étapes illustrées (≈ 5-6 s chacune) → Pour gagner (4,2 s) → « À vous de jouer ! » (3 s).

## Fabrication

| Quoi | Où |
| --- | --- |
| Gabarit Remotion (scènes génériques, boîte à outils) | `promo-video/src/tuto/` (`Tuto.tsx`, `scenes.tsx`, `kit.tsx`, `types.ts`) |
| Script d'un jeu (textes + maquettes animées) | `promo-video/src/tuto/games/<id>.tsx` → exporte un `TutoSpec` |
| Liste des tutos → compositions `Tuto-<id>` | `promo-video/src/tuto/registry.ts` |
| Rendu de tous les tutos + copie dans l'appli | `cd promo-video && npm run render:tutos` (ou `npm run render:tutos -- morpion`) |
| Vidéos servies par l'appli | `public/tutos/<id>.mp4` |
| Jeux qui affichent le bouton | `src/data/tutos.ts` (`TUTO_GAME_IDS`) |

**Ajouter un jeu** : 1) écrire `games/<id>.tsx` (copier `morpion.tsx`) : `goal`, 4 `steps` (texte ≤ ~60 caractères + maquette `Mock` dessinée dans 720 × 880 px), `win` ; 2) l'ajouter à `registry.ts` ; 3) contrôler quelques images (`npx remotion still src/index.ts Tuto-<id> out/x.png --frame=300`) ; 4) `npm run render:tutos -- <id>` ; 5) ajouter l'id à `TUTO_GAME_IDS`.

État : ✅ réalisé — ⏳ script prêt, vidéo à faire.

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

## ⏳ Qui de nous ? 🫵 — 3 à 9 joueurs — ≈ 32 s
**But** : « Vote comme la majorité pour marquer ! »

| # | Durée | Texte à l'écran | Image |
| --- | --- | --- | --- |
| 1 | 5 s | Une question s'affiche pour tout le monde | Carte « Qui finirait les restes du frigo à 3 h du mat' ? » |
| 2 | 5,5 s | En secret, touche le joueur qui correspond le mieux | Grille d'avatars, le doigt en choisit un ; cadenas 🤫 |
| 3 | 5,5 s | Les votes sont révélés ! | Les jetons de vote tombent sur les avatars, l'élu fait la tête |
| 4 | 5 s | Tu as voté comme la majorité ? +1 point | « +1 » sur ceux qui ont suivi la majorité |
| 🏆 | 4,2 s | Le plus de points à la fin des questions gagne ! | |

## ⏳ Pas de bol ! 🃏 — 2 à 9 joueurs — ≈ 38 s
**But** : « Vide ta main avant les autres ! »

| # | Durée | Texte à l'écran | Image |
| --- | --- | --- | --- |
| 1 | 5,5 s | Pose une carte de la même couleur ou du même symbole | Main en éventail, une carte verte vole sur la pile verte |
| 2 | 5 s | Rien à poser ? Pioche ! | Une carte vole de la pioche vers la main |
| 3 | 6 s | Les +2 et +4 se cumulent… aïe ! | +2, +2, +4 s'empilent : « +8 » pour le suivant qui pleure |
| 4 | 6 s | Plus qu'une carte ? Crie « Dernière carte ! » | Gros bouton « Dernière carte ! » ; sinon un autre te dénonce |
| 🏆 | 4,2 s | Vide ta main pour être sauvé. Le dernier avec des cartes… a pas de bol ! | Le perdant boude, les autres rient |

## ⏳ Cerveau en fête 🧠 — 2 à 9 joueurs — ≈ 33 s
**But** : « Réponds juste… et plus vite que les autres ! »

| # | Durée | Texte à l'écran | Image |
| --- | --- | --- | --- |
| 1 | 5 s | Une question, un chrono | Carte question + barre de temps |
| 2 | 6 s | Tape ta réponse : essais illimités, petites fautes acceptées | Champ de saisie « pariss » → ✅ |
| 3 | 5,5 s | Ou choisis le QCM : un seul essai ! | 4 gros boutons, le doigt en choisit un |
| 4 | 5,5 s | Plus tu es rapide, plus tu marques : +20 pour le premier ! | Scores qui montent, médaille au plus rapide |
| 🏆 | 4,2 s | Le meilleur score à la fin du quiz gagne ! | |

## ⏳ Petit bac 🔤 — 2 à 9 joueurs — ≈ 35 s
**But** : « Un mot par catégorie, avec la bonne lettre ! »

| # | Durée | Texte à l'écran | Image |
| --- | --- | --- | --- |
| 1 | 4,5 s | Une lettre est tirée au sort | Roulette de lettres → gros « B » |
| 2 | 6,5 s | Remplis un mot par catégorie avant la fin du chrono | Lignes Pays / Animal / Métier qui se remplissent : Belgique, Baleine… |
| 3 | 6 s | On valide ensemble : 👎 pour contester | Réponses de chacun, un 👎 sur « Banane (métier) » |
| 4 | 5,5 s | Réponse unique : 2 points. Réponse partagée : 1 point | Deux « Belgique » = 1 pt chacun, « Bolivie » = 2 pts |
| 🏆 | 4,2 s | Le plus de points après toutes les manches gagne ! | |

## ⏳ Loup-garou 🐺 — ≈ 42 s
**But** : « Village contre loups : qui ment autour de la table ? »

| # | Durée | Texte à l'écran | Image |
| --- | --- | --- | --- |
| 1 | 5 s | Chacun reçoit un rôle secret | Cartes Villageois, Loup 🐺, Voyante… |
| 2 | 7 s | La nuit : tout le monde ferme les yeux et touche son écran | Fond nuit, chibis qui dorment, les loups choisissent une victime |
| 3 | 5,5 s | Les rôles spéciaux agissent en douce | Voyante qui regarde une carte, etc. |
| 4 | 7 s | Le jour : débattez, puis votez pour éliminer un suspect | Soleil, bulles, votes |
| 🏆 | 5 s | Le village gagne s'il élimine tous les loups. Les loups gagnent s'ils sont aussi nombreux que les villageois. | |

(Fond sombre sur-mesure pour la nuit : utiliser `extra` ou une maquette plein cadre.)

## ⏳ Bombe à mots 💣 — 2 à 9 joueurs — ≈ 35 s
**But** : « Trouve un mot avant que ça fasse BOUM ! »

| # | Durée | Texte à l'écran | Image |
| --- | --- | --- | --- |
| 1 | 5 s | La bombe tourne autour de la table | Cercle de chibis, bombe qui passe de l'un à l'autre |
| 2 | 6 s | À ton tour : tape un mot qui contient la syllabe | Syllabe « TRA » → « TRACTEUR » ✅, la bombe passe |
| 3 | 5,5 s | Personne ne sait quand elle explose… | Mèche, sueur, BOUM : −1 vie ❤️ |
| 4 | 6 s | Utilise toutes les lettres de ton alphabet bonus : +1 vie | Alphabet qui se coche, cœur qui revient |
| 🏆 | 4,2 s | Le dernier debout gagne ! | |

## ⏳ Menteur 🎲 — 2 à 9 joueurs — ≈ 40 s
**But** : « Bluffe sur les dés… sans te faire prendre ! »

| # | Durée | Texte à l'écran | Image |
| --- | --- | --- | --- |
| 1 | 5 s | Chacun cache 5 dés sous son gobelet | Gobelets secoués, toi seul vois tes dés |
| 2 | 7 s | À ton tour, monte l'enchère : « 4 dés de 5 » sur toute la table | Bulle d'enchère qui grimpe ; « Les 1 sont des jokers » |
| 3 | 6 s | Tu n'y crois pas ? Crie « Menteur ! » | Gros bouton rouge, on soulève tous les gobelets |
| 4 | 6 s | Celui qui s'est trompé perd un dé | Comptage des dés, un dé s'envole |
| 🏆 | 4,2 s | Le dernier à avoir des dés gagne ! | |

## ⏳ Bowling 🎳 — 2 à 9 joueurs — ≈ 33 s
**But** : « Fais tomber un max de quilles ! »

| # | Durée | Texte à l'écran | Image |
| --- | --- | --- | --- |
| 1 | 4,5 s | Chacun sa piste, tous en même temps | Plusieurs téléphones avec une piste |
| 2 | 5,5 s | Glisse la boule sur le côté pour te placer | Doigt qui déplace la boule latéralement |
| 3 | 6,5 s | Glisse vers le haut pour lancer : plus vite = plus fort, en courbe = de l'effet | Geste du doigt, trajectoire courbe |
| 4 | 5,5 s | Strike, spare… les vraies règles du bowling | Quilles qui volent, « STRIKE ! », feuille de score |
| 🏆 | 4,2 s | Le meilleur score total gagne ! | |

## ⏳ Tu préfères ? 🤔 — 2 à 9 joueurs — ≈ 34 s
**But** : « Devine ce que préfère la majorité ! »

| # | Durée | Texte à l'écran | Image |
| --- | --- | --- | --- |
| 1 | 5 s | Un dilemme, deux choix | Deux cartes : spaghettis à la place des mains / saucisses à la place des pieds |
| 2 | 5,5 s | En secret : ce que TU préfères… | Le doigt choisit une carte |
| 3 | 5,5 s | …puis ce que choisira la MAJORITÉ | Second choix « pari » |
| 4 | 6 s | Pari juste : +1 point. Seul de ton avis ? Bonus Rebelle +1 ! | Barres de résultat, badge « Rebelle » |
| 🏆 | 4,2 s | Le plus de points à la fin gagne ! (égalité parfaite : personne ne marque) | |

## ⏳ Qui suis-je ? 🙈 — 2 à 9 joueurs — ≈ 35 s
**But** : « Devine la carte collée sur ton front ! »

| # | Durée | Texte à l'écran | Image |
| --- | --- | --- | --- |
| 1 | 5,5 s | Pose ton téléphone sur ton front, écran vers les autres | Chibi avec téléphone sur le front affichant un mot |
| 2 | 6 s | Les autres te font deviner à l'oral | Bulles d'indices, mimes |
| 3 | 5,5 s | Trouvé ? Incline vers le bas ✅ | Téléphone qui bascule, écran vert |
| 4 | 5 s | Tu sèches ? Incline vers le haut pour passer | Téléphone qui bascule, écran orange |
| 🏆 | 4,2 s | Un maximum de cartes avant la fin du chrono ! | |

## ⏳ Le plus proche 🎯 — 2 à 9 joueurs — ≈ 33 s
**But** : « Estime le bon nombre… au plus près ! »

| # | Durée | Texte à l'écran | Image |
| --- | --- | --- | --- |
| 1 | 5 s | Une question dont la réponse est un nombre | « Combien de marches à la tour Eiffel ? » |
| 2 | 5,5 s | Chacun tape son estimation en secret | Pavé numérique, cadenas |
| 3 | 6 s | Révélation : qui est le plus proche ? | Réponses placées sur une règle graduée autour de la bonne valeur |
| 4 | 5,5 s | 3, 2, 1 points pour le podium… +5 si c'est pile exact ! | Podium + éclair « +5 » |
| 🏆 | 4,2 s | Le plus de points après toutes les manches gagne ! | |

## ⏳ Action ou vérité 🎭 — 3 à 9 joueurs — ≈ 38 s
**But** : « Relève le défi… ou gare au gage ! »

| # | Durée | Texte à l'écran | Image |
| --- | --- | --- | --- |
| 1 | 5 s | La roue désigne un joueur | Roue qui tourne, s'arrête sur un chibi |
| 2 | 5 s | Il choisit : ACTION ou VÉRITÉ | Deux gros boutons |
| 3 | 6,5 s | Les autres votent en secret parmi 3 cartes | 3 cartes, jetons de vote, la carte élue s'agrandit |
| 4 | 6,5 s | Réussi ? La bande vote 👍 : +1 point. Refusé : un gage ! | Pouces levés, « +1 » / carte gage |
| 🏆 | 4,2 s | Le plus de points à la fin des tours gagne ! | |

## ⏳ Devine en équipe 🗣️ — 4 à 9 joueurs — ≈ 42 s
**But** : « Fais deviner un max de mots à ton équipe ! »

| # | Durée | Texte à l'écran | Image |
| --- | --- | --- | --- |
| 1 | 5 s | Rouges contre Bleus, une pioche de mots | Deux équipes de chibis, paquet de cartes |
| 2 | 6,5 s | Manche 1 : décris le mot librement | Orateur + bulle, chrono, cartes qui s'empilent |
| 3 | 6 s | Manche 2 : un seul mot d'indice ! | Bulle minuscule |
| 4 | 6 s | Manche 3 : mime, sans parler | Chibi qui mime, 🤐 |
| 🏆 | 5 s | Les mêmes mots aux 3 manches : l'équipe qui en trouve le plus gagne ! (les adversaires surveillent la triche) | |

## ⏳ 4 à la suite 🔴 — 2 à 9 joueurs (duel) — ≈ 33 s
**But** : « Aligne 4 jetons avant ton adversaire ! »

| # | Durée | Texte à l'écran | Image |
| --- | --- | --- | --- |
| 1 | 4,5 s | Un duel : deux joueurs s'affrontent | VS (réutiliser la scène du Morpion) |
| 2 | 6 s | Chacun son tour, touche une colonne : le jeton tombe tout en bas | Grille 7 colonnes, jetons qui chutent avec rebond |
| 3 | 5,5 s | Aligne-en 4 : ligne, colonne ou diagonale | Alignement gagnant surligné |
| 4 | 5 s | Les autres regardent… et parient ! | Scène de paris du Morpion |
| 🏆 | 4,2 s | Le premier à en aligner 4 gagne. Grille pleine : match nul ! (30 s par coup) | |

## ⏳ Bataille navale 🚢 — 2 à 9 joueurs (duel) — ≈ 40 s
**But** : « Coule toute la flotte adverse ! »

| # | Durée | Texte à l'écran | Image |
| --- | --- | --- | --- |
| 1 | 7 s | En 60 s, place tes 5 bateaux en secret | Grille 10×10, bateaux glissés ; « 🎲 mélange » ; « touche pour pivoter » |
| 2 | 5,5 s | Chacun son tour, tire sur une case | Viseur, « À l'eau » 💦 : la main passe |
| 3 | 6 s | Touché ou coulé ? Tu rejoues ! | Explosion 💥, « Touché ! », puis « Coulé ! » |
| 4 | 5 s | Les autres regardent les deux grilles… et parient | Scène de paris |
| 🏆 | 4,2 s | Le premier qui coule toute la flotte adverse gagne ! (30 s par tir) | |

## ⏳ Le Tour des Potes 🏙️ — 2 à 9 joueurs — ≈ 42 s
**But** : « Deviens le plus riche de la bande ! »

| # | Durée | Texte à l'écran | Image |
| --- | --- | --- | --- |
| 1 | 5,5 s | Lance les dés et avance sur le plateau | Dés, pion chibi qui saute de case en case |
| 2 | 6 s | Achète les lieux libres | Carte de lieu, bouton « Acheter », billets qui partent |
| 3 | 6,5 s | Les autres tombent chez toi ? Ils paient le loyer ! | Billets qui volent d'un chibi à l'autre |
| 4 | 6,5 s | Réunis un quartier pour construire maisons puis hôtel | Maisons qui poussent ; clin d'œil « Gare au violon ! » |
| 🏆 | 4,2 s | À la fin, la plus grosse fortune gagne ! | |

## ⏳ Dédé Kart 🏎️ — 2 à 12 joueurs — ≈ 40 s
**But** : « Franchis la ligne d'arrivée avant les autres ! »

| # | Durée | Texte à l'écran | Image |
| --- | --- | --- | --- |
| 1 | 6 s | Le kart accélère tout seul : pose le doigt à gauche ou à droite pour tourner | Téléphone, deux zones tactiles, kart qui vire |
| 2 | 6,5 s | Grand virage = dérapage : redresse pour le mini-turbo ! | Étincelles bleu → orange → violet, puis boost |
| 3 | 6 s | Roule sur les boîtes « ? » et touche OBJET pour l'utiliser | Boîte « ? », bouton OBJET, projectile |
| 4 | 5 s | Des points à chaque course | Tableau d'arrivée 1er, 2e, 3e |
| 🏆 | 4,2 s | Le meilleur total gagne la coupe ! | |
