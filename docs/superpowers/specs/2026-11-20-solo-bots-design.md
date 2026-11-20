# Jouer seul contre un bot — conception

Statut : **à valider par l'utilisateur**. Choix faits avec lui le 2026-11-20.

## 1. Intention
S'entraîner seul, quand on n'a personne sous la main, sur les 4 duels de réflexion :
**Morpion, 4 à la suite, Bataille navale, Échecs**. Contre un bot qui a la tête d'un des 9 chibis.
**Rien ne compte** : ni succès/trophées, ni stats (XP, victoires, défaites, parties jouées), ni tenues, ni pronostics, ni historique.

## 2. Ce que voit le joueur
- Sur la fiche de ces 4 jeux (accueil → jeu), un gros bouton **« Jouer seul 🤖 »**.
- Écran de choix : **l'adversaire** parmi les 9 persos (gros avatars, tenue par défaut), et la **jauge de niveau** du bot pour ce jeu (★ sur 5, demi-étoiles).
- La partie utilise **le même plateau que le vrai jeu** (mêmes écrans, mêmes animations). Le bot joue après un petit temps de « réflexion » (0,6 à 1,5 s, avec bulle 💭) pour rester lisible.
- Le bot réagit avec ses stickers : `joie` quand il gagne/fait un beau coup, `boude`/`pleurs` quand il perd, `reflexion` pendant qu'il réfléchit, `surprise` sur un coup inattendu du joueur.
- Fin de partie : écran simple « Gagné ! / Perdu / Égalité », la jauge qui bouge (« Le bot passe à ★★★½ »), boutons **Rejouer** / **Changer d'adversaire** / **Retour**. Mention discrète : « Partie d'entraînement : rien n'est compté ».

## 3. Niveau qui s'adapte
- Niveau interne de 1 à 10 par jeu (affiché en ★ sur 5, demi-étoiles), départ à 3.
- Victoire du joueur : +1 ; défaite : −1 ; nul : 0 (bornes 1 et 10).
- Gardé **sur le téléphone uniquement** (`localStorage`, clé `solo:level:<jeu>`), jamais envoyé au serveur : ce n'est pas une stat. Si le stockage est vide ou bloqué : niveau 3.
- Le niveau ne dépend pas du perso choisi (le perso est cosmétique).

## 4. Bots (un par jeu, dans le front)
Principe commun : un coup « fort » calculé, puis du bruit qui diminue avec le niveau (probabilité de jouer un coup moins bon / au hasard).
- **Morpion** : minimax complet (parfait au niveau 10) ; niveaux bas = coup au hasard 60 % → 0 %.
- **4 à la suite** : alpha-bêta avec heuristique d'alignements, profondeur 1 → 7 selon le niveau ; bloque toujours une victoire immédiate dès le niveau 3.
- **Bataille navale** : placement aléatoire valide ; tir « chasse puis cible » (niveau bas : tirs au hasard avec un peu de suivi ; niveau haut : carte de probabilités).
- **Échecs** : règles via la bibliothèque **chess.js** (légère, ~40 Ko, éprouvée) ; bot alpha-bêta maison profondeur 1 → 3 avec évaluation matériel + position, bruit aux niveaux bas. Pas de Stockfish (trop lourd : plusieurs Mo).
- Calcul dans un **Web Worker** pour 4 à la suite et Échecs, pour ne jamais figer l'écran ; durée de calcul plafonnée (~1 s).

## 5. Architecture (option A validée : tout sur le téléphone)
- Aucune partie Supabase, aucune RPC : **rien ne peut compter côté serveur, par construction**.
- Pour chaque duel : un **moteur TS local** qui produit **exactement le même `state`** que le moteur SQL (`supabase/games/<id>.sql`) pour les mêmes actions → on réutilise le composant `Play` existant tel quel, en lui passant un `act` local au lieu de l'appel RPC.
  - Un adaptateur `src/features/solo/` : `useSoloMatch(gameId)` (state local, `act` local, tour du bot, fin de partie), écran de choix, écran de fin, jauge.
  - Moteurs : `src/games/<id>/local.ts` ; bots : `src/games/<id>/bot.ts`.
- **Synchro testée** : un test (tools/sql-tests, PGlite) joue des parties aléatoires sur le moteur SQL et sur le moteur TS et vérifie que les `state` sont identiques à chaque coup. Échecs : on compare les coups légaux et les fins de partie (mat, pat, nulle) plutôt que l'état brut si leur format diffère.
- Les minuteurs et la pendule (Échecs) : désactivés en solo (on joue sans chrono).

## 6. Hors ligne (étape 2) — léger sur le téléphone
- But : ouvrir l'appli sans réseau et jouer contre le bot ; le reste (soirées, profil, boutique…) est grisé avec « Hors ligne ».
- **Budget stockage : ≤ 3 Mo ajoutés** sur le téléphone. On ne garde en cache que :
  - la coquille de l'appli (HTML, CSS, JS de l'accueil) et les morceaux de code du mode solo et des 4 plateaux ;
  - pour les 9 bots : **uniquement les miniatures** (`@thumb`, ~5-15 Ko) de 5 expressions (joie, boude, pleurs, reflexion, surprise) en tenue par défaut, soit 45 petites images ;
  - **jamais** : vidéos tuto, autres jeux, planches de tenues, sons lourds, décors 3D.
- Les images du joueur lui-même : son avatar déjà en cache s'il l'a vu récemment, sinon un avatar par défaut.
- Démarrage hors ligne : si Supabase est injoignable au lancement, l'accueil s'ouvre en mode hors ligne (session locale gardée), sans bloquer.
- Vérifier la taille réelle du cache (DevTools → Application → Storage) et l'écrire dans le rapport.

## 7. Livraison
1. **Étape 1 — bots en ligne** : solo + 4 moteurs locaux + 4 bots + jauge + tests de synchro. Testable tout de suite sur téléphone.
2. **Étape 2 — hors ligne** : cache ciblé + démarrage hors ligne, dans le budget de 3 Mo.

## 8. Hors périmètre
Bots dans les soirées, autres jeux (adresse, quiz, Dédé Party), classement solo, défis entre amis.

## 9. Points tranchés
- 4 duels seulement ; niveau unique qui s'adapte, jauge visible ; adversaire = perso au choix ; accès depuis l'accueil ; tout sur le téléphone ; hors ligne en étape 2 avec ≤ 3 Mo.
- Pas de chrono en solo. chess.js accepté comme seule dépendance ajoutée.
