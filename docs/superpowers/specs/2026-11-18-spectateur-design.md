# Mode spectateur — design

Date : 2026-11-18 · Statut : à relire par l'utilisateur avant le plan d'implémentation.

## Intention

Permettre de **regarder une partie en cours** sans y jouer :
- quelqu'un qui rejoint une soirée pendant un jeu ne reste pas devant un salon vide ;
- on voit dans la **liste d'amis** qui est en pleine partie (œil 👀) et on peut la regarder, même depuis l'extérieur de la soirée ;
- toucher un ami ouvre son **profil**.

Public : joueurs peu technophiles, mobile, français. Réussite : un spectateur arrive sur un écran de jeu lisible, sans secret, sans bouton qui échoue en erreur, et sait qu'il jouera à la partie suivante.

## État de l'existant (vérifié dans le code)

- Tout membre de la soirée peut déjà **lire** l'état public d'une partie (`matches_select` = `is_soiree_member`). Les secrets restent privés (`match_secrets_select` : son propre profil seulement). Le salon propose déjà « Rejoindre la partie en cours » à tous.
- `game_action` refuse toute action d'un non-joueur non-hôte (`not_in_match`), **y compris les `tick`** : un spectateur ne doit donc rien envoyer du tout.
- Le « mode télé » des duels (`src/features/duel/tv.ts`, `TvPage`) rend déjà `Play` en lecture seule (`secret = null`, actions filtrées) pour les 3 jeux en duel ; les autres jeux n'ont jamais été rendus par quelqu'un qui n'est pas dans la partie.
- Une ligne de `FriendsPage` n'est pas cliquable ; la page `/profil/:id` existe.
- Un nouvel arrivant est déjà inscrit d'office aux parties suivantes (le serveur prend tous les `soiree_players`).

## Fonctionnement

**Qui est spectateur.** Dans `MatchPage` : `spectator = !isHost && !(state.players ?? []).includes(meId)` (`state.players` existe pour tous les jeux, le serveur s'en sert pour `not_in_match`). Un joueur exclu ou parti retombe dans le même cas, sans traitement particulier.

**Écran de partie en lecture seule** (même écran pour toutes les entrées) :
- bandeau fixe « 👀 Tu regardes — tu joues à la prochaine ! » + bouton retour (au salon, ou à la liste d'amis pour un spectateur extérieur) ;
- `Play` rendu avec `secret = null`, `isHost = false`, `meId` réel, et `act` = **no-op** (aucune action envoyée, aucun toast) ;
- l'état public suit en temps réel comme pour les joueurs ; les secrets (mains, rôles, mots à dessiner) ne sont jamais révélés ;
- à la fin de la partie, l'écran de résultats s'affiche comme pour les autres.

**Entrées.**
1. **Salon** : le bouton « Rejoindre la partie en cours » devient « 👀 Regarder la partie » pour qui ne joue pas la partie, avec la ligne « Tu joueras à la suivante ». Le compte à rebours de lancement emmène aussi les non-joueurs (ils arrivent en spectateurs).
2. **Liste d'amis** : sur chaque ligne, toucher la ligne ouvre `/profil/:id` ; un bouton 👀 (cible tactile ≥ 44 px, `aria-label` « Regarder la partie de X », emoji du jeu) apparaît seulement si l'ami est dans une partie `playing`, et ouvre `/partie/:matchId`.

**Spectateur extérieur** (ami, hors soirée) : lecture seule uniquement — ni chat, ni pronostics, ni présence dans le salon, pas de bouton d'accès à la soirée.

## Serveur (supabase/features/spectateur.sql, idempotent)

- `can_watch_match(p_match_id uuid) returns boolean` (stable, `security definer`) : vrai si l'appelant est membre de la soirée de la partie, **ou** s'il est **ami accepté** (`friendships.status = 'accepted'`, dans les deux sens) d'au moins un joueur de la partie (`state->'players'`) ou de l'hôte de la soirée.
- Politique `matches_select` remplacée (`drop policy` + `create policy`) : `using (is_soiree_member(soiree_id) or can_watch_match(id))`. Rien d'autre n'est ouvert : `soirees`, `soiree_players`, `soiree_messages`, `match_secrets`, `match_server_state` restent réservés comme aujourd'hui.
- `friends_playing() returns jsonb` (`security definer`, grant `authenticated`) : pour chacun de mes amis acceptés qui est dans le `state->'players'` d'une partie `status = 'playing'` : `{profile_id, match_id, soiree_id, game_id}` (une ligne par ami ; si plusieurs parties, la plus récente).
- Confidentialité : tout ami accepté d'un joueur peut regarder ses parties, sans option de refus (voir « Points à confirmer »).

## Front

- `src/features/spectate/` : `useSpectator(state, meId, isHost)` (le critère ci-dessus), `SpectatorBanner`, `useFriendsPlaying()` (RPC `friends_playing`, relue sur changement de `matches` en Realtime et au retour au premier plan).
- `MatchPage` : passe en mode spectateur ; pour un spectateur extérieur, `useSoiree`/`useCurrentMatch`/chat/`useViewingSoiree` sont ignorés (RLS) et le retour va à `/amis`.
- `SoireePage` : texte du bouton + ligne « Tu joueras à la suivante ».
- `FriendsPage` : ligne cliquable vers le profil + œil 👀 (`PersonRow`).
- Les 20 écrans de jeu : corrections au cas par cas quand un `Play` ne supporte pas `secret = null` / un `meId` étranger (le mécanisme commun reste dans `MatchPage`, pas dans chaque jeu).

## Cas particuliers

- Partie terminée ou annulée pendant qu'on regarde : écran habituel (résultats / « Partie annulée »).
- L'ami quitte la partie ou n'est plus ami : à la prochaine lecture RLS la partie devient illisible → « Partie introuvable » avec retour à la liste d'amis.
- Un joueur de la soirée exclu par l'hôte de la manche en cours regarde sa partie comme spectateur.
- Aucun `tick` n'est envoyé par un spectateur : les minuteurs avancent grâce aux joueurs et à l'hôte (si plus personne n'est connecté, la partie ne progresse plus — comportement inchangé).
- Dessin en direct : les traits passent par le broadcast `match:<matchId>` ; le spectateur y est abonné en écoute seule.

## Tests et vérification

- **SQL** (PGlite, `tools/sql-tests/spectateur.mjs`) : `can_watch_match` vrai pour un membre, pour un ami d'un joueur, pour un ami de l'hôte ; faux pour un inconnu, pour une demande d'ami seulement `pending`, après suppression de l'amitié ; `matches` illisible pour un inconnu et lisible pour un ami ; `match_secrets` toujours illisible ; `friends_playing` ne renvoie que les amis acceptés en partie `playing`, et plus rien une fois la partie terminée.
- **Les 20 jeux, en lecture seule** : pour chaque jeu, un vrai état est généré par la fonction SQL `game_<id>_start` (PGlite), puis `Play` est rendu dans une page locale avec un `meId` étranger, `secret = null` et un `act` espion ; capture mobile 390×844. Critères : aucun plantage ni erreur console, aucune action envoyée par un clic, bandeau visible, aucun secret affiché. Les corrections nécessaires sont faites jeu par jeu.
- `npm run build`, `npm run lint` ; rappel après la modification SQL : `npm run sql`, puis coller `supabase/install.sql` dans le SQL Editor Supabase.

## Hors périmètre

Interrupteur de confidentialité, chat ou pronostics pour un spectateur extérieur, notifications « ton ami joue », rediffusion, mode spectateur tactile avec réactions dédiées (le chat de soirée existant suffit pour ceux du salon), refonte du mode télé.

## Points à confirmer

- Confidentialité : faut-il un interrupteur « Mes amis peuvent regarder mes parties » (défaut activé) dans les réglages ?
- Un joueur exclu de la manche par l'hôte et un nouvel arrivant sont tous deux emmenés en spectateurs par le compte à rebours de lancement : acceptable, ou préfère-t-on les laisser au salon ?
