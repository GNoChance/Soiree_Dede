# Nom de Code — conception

Jeu n°21 des Soirées de Dédé, id `nom-de-code`. Jeu d'équipes inspiré de Codenames, validé avec l'utilisateur le 2026-11-19.
Premier des 4 nouveaux jeux (ordre : Nom de Code → Échecs → Mini-golf → Dédé Party).

## 1. Intention

Un vrai jeu de soirée en équipes, jouable par des non-joueurs : on discute, on se trompe, on rit (la bombe 💣).
Tout passe par les téléphones (indice tapé, propositions au doigt) ; un mode télé optionnel affiche la grande grille dans le salon.
Réussi si : une famille lance une partie sans explication (vidéo tuto), personne ne peut tricher (couleurs secrètes côté serveur),
et une manche dure 10-15 min.

## 2. Règles

### Joueurs et équipes
- 4 à 9 joueurs, **2 à 4 équipes** (🔴 rouge, 🔵 bleu, 🟢 vert, 🟡 jaune), **2 joueurs minimum par équipe**.
- **Banc 👀** : l'hôte peut laisser des membres de la soirée hors équipe ; ils ne sont pas joueurs (pas dans `player_ids`),
  regardent comme des spectateurs (sans couleurs secrètes) et ne gagnent ni ne perdent rien.
- Ordre de jeu : 🔴 → 🔵 → 🟢 → 🟡 (seulement les équipes présentes), l'équipe qui commence est tirée au sort et a un mot de plus.

### Grille (25 mots, 5×5)

| Équipes | Mots par équipe (1re équipe d'abord) | Neutres | Bombe |
|---|---|---|---|
| 2 | 9 / 8 | 7 | 1 |
| 3 | 7 / 6 / 6 | 5 | 1 |
| 4 | 6 / 5 / 5 / 5 | 3 | 1 |

### Espions
- Un espion par équipe, tiré au hasard parmi ses membres **en évitant l'espion de la partie précédente de Nom de Code dans la même soirée** (si possible).
- Mode « chacun son tour » : l'espion change à chaque manche (rotation dans l'ordre de l'équipe, sans repasser tant que d'autres n'y sont pas passés).

### Déroulé d'un tour (équipe active)
1. **Indice** : l'espion tape **un seul mot** + **un nombre de 1 à 9**. Refusé si : vide, plusieurs mots (espace), plus de 24 caractères,
   ou égal (après normalisation : minuscules, sans accents ni ponctuation) à un mot de la grille **non encore dévoilé**.
2. **Devinettes** : chaque devineur de l'équipe pose sa tête sur un mot (toucher à nouveau = retirer, toucher un autre = déplacer).
   Un mot est **dévoilé dès que plus de la moitié des devineurs de l'équipe** l'ont choisi (1 devineur → immédiat ; 2 → les 2 ; 3 → 2 ; 4 → 3).
   Après chaque dévoilement, toutes les têtes de l'équipe sont retirées.
3. Effet du mot dévoilé :
   - **mot de l'équipe** : +1, l'équipe continue tant qu'il reste des essais (essais = nombre de l'indice + 1) ;
   - **neutre** : fin du tour ;
   - **mot d'une autre équipe** : compte pour cette équipe, fin du tour ;
   - **bombe** : l'équipe est **éliminée** (à 2 équipes : défaite immédiate, l'autre gagne).
4. **« Stop, on passe »** : bouton à la majorité des devineurs (même seuil), disponible après au moins un mot dévoilé dans le tour.
5. Le tour passe à l'équipe suivante non éliminée.

### Fin de manche
- Gagne la **première équipe dont tous les mots sont dévoilés** (y compris dévoilés par erreur par d'autres équipes), ou la **dernière équipe non éliminée**.
- Si un dévoilement termine les mots d'une autre équipe que l'équipe active, c'est cette autre équipe qui gagne.
- La grille entière est alors révélée à tous (couleurs publiques).

### Manches (option hôte)
- **1 manche** (défaut) ou **« chacun son tour d'espion »** : nombre de manches = taille de la plus grande équipe.
- Score = manches gagnées ; vainqueur(s) de la partie = l'équipe (ou les équipes à égalité) avec le plus de manches.

### Chrono (option hôte)

| Réglage | Indice | Devinettes |
|---|---|---|
| Détendu | — | — |
| **Normal (défaut)** | 2 min | 3 min |
| Rapide | 1 min | 2 min |

- Fin du temps d'indice sans indice → le tour passe à l'équipe suivante (compteur `idle_clue` de l'espion).
- Fin du temps de devinettes → fin du tour.
- Minuteurs serveur habituels : `deadline` ISO dans le state + action `{"type":"tick"}` idempotente.

## 3. Architecture

Conventions existantes (ARCHITECTURE.md « Ajouter un jeu ») ; aucun nouveau mécanisme transverse sauf le sélecteur d'équipes.

### Serveur — `supabase/games/nom-de-code.sql`
- `game_nom_de_code_start(p_players uuid[], p_options jsonb)` et `game_nom_de_code_action(p_state, p_server, p_actor, p_is_host, p_action)`,
  idempotent, terminé par les `revoke`.
- **Secrets** : la clé (couleur de chaque case) n'est jamais dans le state public pendant la manche ; elle est dans `server`
  et recopiée dans `match_secrets` **pour les seuls espions** de la manche (`secrets[spy_id] = {round, key}`).
  À la fin de manche, la clé devient publique (`state.key`).
- **State public** (forme indicative, miroir TS dans `src/games/nom-de-code/types.ts`) :
  `phase` (`roles` | `clue` | `guess` | `round_end` | `finished`), `round`, `total_rounds`, `timer` (`relaxed`|`normal`|`fast`), `deadline`,
  `words[25]`, `teams[{id, players[], spy, found, total, eliminated}]`, `order[]`, `turn` (id d'équipe), `revealed{index: {color, by}}`,
  `clue{word, n, by}`, `guesses_left`, `votes{player_id: index}`, `stop[]`, `round_wins{team: n}`, `round_winner`, `key` (fin de manche seulement), `stats`.
- **Actions** : `clue {word, n}` (espion de l'équipe active, phase `clue`) ; `vote {index}` / `vote {index: null}` (devineur de l'équipe active, phase `guess`) ;
  `stop` (bascule, devineur) ; `tick` ; `next_round` (hôte, phase `round_end`).
- **Démarrage** : options `{ teams: {red:[…], blue:[…], green?:[…], yellow?:[…]}, rounds: 'one'|'each', timer, words: string[25] }` ;
  les 25 mots viennent du front (`prepareStart`), le serveur tire l'équipe qui commence, la répartition des couleurs et les espions.
- **Nouveaux codes d'erreur** (→ `src/features/soiree/errors.ts`) : `invalid_clue`, `clue_is_grid_word`, `not_spy`, `not_guesser`, `stop_too_early`.
- **Fin** : `finish_match` avec les membres de l'équipe gagnante comme vainqueurs ; `results[].stats` porte les compteurs des trophées (§5).
- `supabase/install.sql` régénéré (`npm run sql`) ; l'utilisateur le recolle dans Supabase.

### Front — `src/games/nom-de-code/`
- `index.ts` (definition : `minPlayers: 4`, `maxPlayers: 9`, règles courtes, `order`), `Play.tsx` (lazy), `Summary.tsx` (lazy), `Options.tsx`,
  `setup.ts` (actions + `prepareStart` qui tire 25 mots), `words.ts` (~400 mots), `logic.ts` (normalisation, seuil de majorité — mêmes règles que le SQL), `types.ts`.
- **Sélecteur d'équipes partagé** : `src/features/teams/TeamsPicker.tsx` — 2 à 4 équipes + banc, réutilisable ; Devine en équipe n'est pas modifié.
- **Mode télé** (étape 2) : la route existante `/soiree/:id/tele` rend le `Play` du jeu ; un contexte télé générique (à partir de `DuelTvContext`)
  permet à `Play` d'afficher une vue télé (grande grille, indice, pastilles d'équipe, têtes), lecture seule, sans secret.

## 4. Écrans

1. **Options (hôte)** : sélecteur d'équipes (2-4 + banc), manches (1 / chacun son tour), chrono (Détendu / Normal / Rapide).
2. **Rôles (3 s)** : « 🕵️ Tu es l'espion de l'équipe 🔴 » / « 🔎 Tu devines pour l'équipe 🔵 » / « 👀 Tu regardes » (banc, spectateurs), avec le chibi du joueur.
3. **Jeu (commun)** :
   - bandeau : une pastille par équipe (mots restants, 💀 grisée si éliminée), équipe active, chrono ;
   - grille 5×5, gros caractères (mots ≤ 9 lettres) ; carte dévoilée = retournement animé + couleur
     (équipe : couleur + chibi d'un membre ; neutre : beige ; bombe : explosion 💥 + écran qui tremble) ;
   - têtes (mini-chibis) posées sur les cartes, visibles de tous.
4. **Espion** : couleurs secrètes en fond léger sur les cartes ; à son tour : champ « Ton indice », 9 gros boutons 1-9, « Envoyer » ;
   refus expliqué (« C'est un mot de la grille ! »).
5. **Devineurs** (équipe active) : indice en grand (« 🔎 ANIMAL · 3 »), essais restants, compteur « 2 sur 3 pour dévoiler », bouton « ✋ Stop, on passe » avec son compteur.
6. **Autres équipes, banc, spectateurs** : tout en direct, rien de touchable.
7. **Fin de manche** : grille entièrement dévoilée, bandeau (« 🔴 gagne ! » / « 💣 Boum ! 🔵 est éliminée »), tableau des manches,
   « Manche suivante » (hôte). Fin de partie : écran de résultats habituel (équipe gagnante, confettis).
8. **Télé** (étape 2) : grande grille, indice, pastilles, têtes ; jamais les couleurs secrètes avant dévoilement.

Style « sticker book » (contours épais, ombre décalée, couleurs vives, grosses animations), thème clair + sombre, lisible sur mobile.

## 5. Tenue Hacker 💻 et trophées

- Tenue `hacker` (dossier d'art `hacker`), débloquée par **10 victoires à Nom de Code**, ajoutée à `src/data/tenues.ts` **et** `supabase/features/tenues.sql`.
- Art : 9 planches + 9 portraits V3 fournis par l'utilisateur (prompts : `docs/PROMPTS-TENUES-V3.md`) ; d'ici là repli habituel (chibi de base + 💻).
- 11 trophées (slots 2-12), tous actifs dès la sortie ; compteurs par joueur dans `results[].stats` :

| Slot | id | Nom | Condition | Compteur (stats) |
|---|---|---|---|---|
| 2 | `ndc_kaboum` | Kaboum ! | Avoir voté pour la bombe (mot dévoilé avec sa tête dessus) | `bomb_votes` ≥ 1 |
| 3 | `ndc_page_blanche` | Page blanche | En espion, laisser filer le chrono sans donner d'indice | `idle_clue` ≥ 1 |
| 4 | `ndc_taupe` | Taupe malgré toi | Faire dévoiler 3 mots d'une autre équipe (cumul) | `enemy_reveals` (somme) ≥ 3 |
| 5 | `ndc_bon_flair` | Bon flair | Être le premier à poser sa tête sur 10 mots de son équipe dévoilés (cumul) | `first_good` (somme) ≥ 10 |
| 6 | `ndc_agent_terrain` | Agent de terrain | Jouer 10 parties (cumul) | parties jouées ≥ 10 |
| 7 | `ndc_coup_double` | Coup double | En espion, faire trouver 3 mots avec un seul indice | `best_clue` (max) ≥ 3 |
| 8 | `ndc_maitre_espion` | Maître espion | Gagner 3 parties en espion (cumul) | `spy_wins` (somme) ≥ 3 |
| 9 | `ndc_sans_faute` | Sans faute | Gagner une manche sans aucune erreur de son équipe (ni neutre, ni mot adverse, ni bombe) | `flawless` (somme) ≥ 1 |
| 10 | `ndc_remontada` | Remontada | Gagner une manche après avoir eu 3 mots de retard ou plus | `comeback` (somme) ≥ 1 |
| 11 | `ndc_telepathie` | Télépathie | En espion, faire trouver 4 mots ou plus avec un seul indice | `best_clue` (max) ≥ 4 |
| 12 | `ndc_legende` | Légende du code | Gagner 15 parties (cumul) | victoires ≥ 15 |

« Retard » = (mots restants de son équipe) − (mots restants de l'équipe la plus avancée), mesuré après chaque dévoilement.
Catalogue ajouté à `docs/TROPHEES.md` et au seed de `supabase/features/trophees.sql`.

## 6. Mots, vidéo tuto

- `words.ts` : ~400 mots français tout public, 3 à 9 lettres, sans doublon (normalisé), sans mot ambigu ou vulgaire ; `prepareStart` en tire 25 au hasard.
- Vidéo « Comment on joue ? » (35 s, format et structure de `docs/VIDEOS-JEUX.md`) : `promo-video/src/tuto/games/nom-de-code.tsx`
  — but « Fais deviner tous tes mots à ton équipe… sans toucher la bombe ! » ; étapes : (1) équipes et espion, (2) l'espion tape « ANIMAL · 3 »,
  (3) l'équipe pose ses têtes, la majorité dévoile, (4) attention à la bombe 💣 ; pour gagner : première équipe à trouver tous ses mots.
  Ajout à `src/data/tutos.ts` (`TUTO_GAME_IDS`).

## 7. Tests

- **SQL (PGlite)** `tools/sql-tests/nom-de-code.mjs` : répartition 2/3/4 équipes ; clé visible uniquement des espions
  (devineurs, banc, spectateurs, télé : rien dans `match_secrets`) ; indices refusés (vide, plusieurs mots, mot de la grille non dévoilé ; accepté si déjà dévoilé) ;
  seuils de majorité (1, 2, 3, 4 devineurs) et déplacement/retrait de tête ; 4 effets d'un dévoilement ; limite n+1 ; stop (refusé avant 1 dévoilement, majorité) ;
  ticks idempotents (indice et devinettes) ; élimination à 3-4 équipes et dernière équipe restante ; victoire par mots dévoilés par une autre équipe ;
  manches « chacun son tour » (rotation des espions, score, égalité) ; compteurs des 11 trophées.
- **Front** : `tsc`, `eslint`, `npm run build` ; page de test locale (non commitée) pour jouer à plusieurs onglets ; essai réel sur téléphones par l'utilisateur.

## 8. Livraison

1. **Étape 1 — jeu sur téléphones** : SQL + tests, front (options, rôles, jeu, fin de manche, résumé), sélecteur d'équipes, mots, tenue au catalogue, trophées, docs (ARCHITECTURE.md, TROPHEES.md).
2. **Étape 2 — mode télé**.
3. **Étape 3 — vidéo tuto**.
4. Intégration des planches/portraits Hacker dès réception (circuit habituel).

## 9. Hors périmètre

Mode à 2-3 joueurs (coopératif), indice à voix haute, mots personnalisés par l'hôte, grille 5×6, chat dédié aux équipes.
