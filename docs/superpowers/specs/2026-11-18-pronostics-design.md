# Pronostics entre potes — design

Date : 2026-11-18 · Statut : à relire par l'utilisateur avant le plan d'implémentation.

## Intention

Rendre la soirée plus vivante : avant chaque jeu, chacun parie en 1 tap sur le gagnant. Les bons pronostics rapportent des points de soirée (« Meilleur devin ») et un trophée avec un sticker exclusif (fourni par l'utilisateur). Public : joueurs peu technophiles, mobile, français, tout public.

Réussite : un pari prend 1 tap, ne ralentit jamais le lancement d'un jeu, et les bons devins sont mis en valeur au podium et dans le Wrapped.

## Fonctionnement

- Étape « Pronostics » dans le salon, **avant** le lancement du jeu (les jeux démarrent immédiatement : parier en cours de partie serait de la triche).
- L'hôte choisit le jeu (liste ou roue), l'étape s'ouvre chez tous les joueurs : « Qui va gagner ? », avatars chibi des joueurs de la manche, 1 tap pour choisir, un autre tap pour changer. On peut parier sur soi-même. Pas de bouton « Valider » : le choix est enregistré au tap.
- L'hôte voit « N/M ont parié » et lance quand il veut. Lien « Sans pronostics » pour lancer directement. Les joueurs sans pari ne sont pas comptés.
- Une fois la partie lancée, plus de paris.
- Les paris ne sont lisibles qu'après la fin de la partie (personne ne copie un choix).

## Points

- +1 par bon pronostic. Classement « Meilleur devin » de la soirée, affiché au podium et dans le Wrapped. N'influence pas le classement des jeux. Calculé à la lecture (pas de table de scores).
- Plusieurs gagnants (égalité, équipe gagnante) : parier sur n'importe lequel d'entre eux est bon.
- Partie annulée par l'hôte, sans gagnant, ou un seul joueur : pronostics annulés, personne ne marque.
- Hors périmètre : mises, paris sur la 2e place / le dernier, classement cumulé entre soirées.

## Trophée

- Trophée général (comme les 10 existants, `tenue_id`/`slot` nuls) : « Madame Irma », 3 bons pronostics d'affilée (seuil à confirmer). Règle `special` nommée, évaluée dans `_after_finish_trophies`. Sticker exclusif fourni par l'utilisateur (hors périmètre technique : branchement de l'art quand l'image est livrée).
- Révélation par l'écran existant `TrophyUnlockReveal`.

## Modèle de données (supabase/features/pronos.sql, idempotent)

Table `soiree_pronos(soiree_id, profile_id, game_id, pick_profile_id, match_id null, created_at, updated_at)`, clé `(soiree_id, profile_id)` tant que `match_id is null`. RLS activée, aucun droit client direct.

RPC (security definer, grant `authenticated`) :
- `open_pronos(p_soiree_id, p_game_id)` — hôte uniquement ; ouvre l'étape (efface les paris ouverts si le jeu change). Erreurs : `not_host`, `soiree_ended`, `match_in_progress`.
- `set_prono(p_soiree_id, p_pick uuid)` — un joueur de la soirée parie sur un joueur de la manche ; upsert. Erreurs : `pronos_closed`, `invalid_pick`.
- `get_pronos(p_soiree_id)` — état de l'étape pour le front : jeu, joueurs de la manche, mon choix, nombre de parieurs (jamais les choix des autres tant que la partie n'est pas finie).
- Lecture des résultats : après la fin, paris + bons devins d'une partie ; classement « Meilleur devin » d'une soirée (pour podium et Wrapped).

Intégrations dans l'existant :
- `start_match` : rattache les paris ouverts de la soirée au nouveau `match_id` (si le jeu correspond ; sinon ils sont ignorés).
- Hook de fin de partie (après `_after_finish_trophies`) : résout les paris (gagnants = `match_players.won`), stocke le résultat dans le state final (`pronos`), évalue « Madame Irma ».
- `finish_match` n'est pas modifié dans sa signature ; une partie annulée (`abort`) ne résout rien.
- Wrapped (`_soiree_recap_compute`) et podium : une ligne « Meilleur devin » si au moins un pari a été fait.
- Nouveaux codes d'erreur dans `src/features/soiree/errors.ts`.
- Aucun des 20 jeux n'est modifié.

## Front (src/features/pronos/)

- `PronosStep` (salon, hôte) : réutilise `PronosPicker` + compteur + « Lancer » / « Sans pronostics ».
- `PronosPicker` (tous) : grille d'avatars chibi, gros boutons, coche sur le choix.
- `PronosResult` : bande sous les résultats existants (`ResultsScreen`) : étoile et +1 pour les bons devins, choix grisé pour les autres.
- Ligne « Meilleur devin » au podium / Wrapped.
- Mise à jour en direct via la souscription Realtime du salon existante. Design « sticker book » (contours épais, ombre décalée, thème clair/sombre, animations sobres).
- Types dans `src/features/pronos/types.ts` (ne pas toucher `src/types/db.ts` hors types RPC).

## Cas particuliers

- Joueur exclu ou parti : son pari est ignoré ; si le joueur choisi n'est plus dans la manche, le pari est annulé.
- Hôte qui change de jeu : l'étape se rouvre à zéro.
- Arrivée tardive avant le lancement : la carte s'affiche quand même ; après le lancement, plus de paris.
- Jeux en équipe : on parie sur un joueur, bon si son équipe gagne.

## Tests

- SQL : PGlite avec `install.sql` complet (ouverture, pari, changement de pari, clôture au lancement, résolution avec égalité / équipe / annulation / un seul joueur, série de 3, exclusion, droits).
- Front : `npm run build`, `npm run lint`, captures d'écran headless de l'étape (hôte et joueur) et de la bande de résultat sur mobile 390×844.
- Rappel après toute modif SQL : `npm run sql`, puis coller `supabase/install.sql` dans le SQL Editor Supabase.

## Points à confirmer

- Seuil et nom du trophée (« Madame Irma », 3 d'affilée).
- Les jeux sans gagnant explicite (le cas échéant) : liste à établir lors du plan en lisant les 20 `_finish`.
