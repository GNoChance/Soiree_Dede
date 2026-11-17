# Soirées de Dédé — Contrats d'architecture

Source de vérité partagée entre tous les agents. Toute divergence = bug.

## Décisions produit
- PWA mobile-first, **en ligne uniquement** (installable, assets/chibis en cache, mais pas de jeu hors ligne).
- **Multi-écrans temps réel** : chaque joueur sur son téléphone. Hôte = celui qui lance la soirée.
- **Plusieurs soirées en même temps** : un joueur peut être dans **5** soirées non terminées (une partie à la fois par soirée). Hub = liste de mes soirées ; bandeau global quand une partie démarre ailleurs (pas de bascule automatique hors du salon concerné). **Fin automatique** d'une soirée après **20 min sans jeu** (compte à rebours les 5 dernières minutes) ; filet : partie sans action depuis 3 h annulée. Contrat : `supabase/README.md` (Soirées).
- Français uniquement, tout public.
- Design « sticker book » : cartoon, contours épais, ombres portées décalées (`box-shadow: 4px 4px 0 <ink>`), couleurs vives, thème clair + sombre. **Très grosses animations** (Framer Motion, confettis, rebonds, transitions de page).
- Hébergement : Vercel (front) + Supabase (BDD, Auth anonyme, Realtime). **Pas d'Edge Functions** : toute la logique serveur est en SQL (RPC `security definer`), livrée dans un seul fichier que l'utilisateur colle dans le SQL Editor.

## Personnages (slug → prénom / pseudo par défaut)
| slug | prénom | pseudo |
|---|---|---|
| kevin | Kevin | Keke |
| cycy | Cyrielle | Cycy |
| dede | Delphine | Dédé |
| manon | Manon | Manon |
| mika | Michael | Mika |
| cecile | Cécile | Cécile |
| carole | Carole | Karo |
| marius | Marius | Marius |
| nini | Nicolas | Nini |

`kevin` a le rôle **admin** (peut réinitialiser un PIN).

## Expressions (ids stables)
Ordre des planches 4×3 (ligne par ligne, gauche→droite) :
- **Standard** (kevin, cycy, dede, manon, mika, cecile, marius) :
  `joie, colere, pleurs, boude, reflexion, dodo, bisou, clin_oeil, surprise, amoureux, cool, gamer`
- **carole** : `joie, colere, pleurs, boude, reflexion, dodo, bisou, clin_oeil, surprise, pouces, timide, charmee`
- **nini** : `joie, colere, pleurs, boude, reflexion, dodo, bisou, clin_oeil, surprise, pouces, timide, gamer`

Fichiers : `public/chibis/<slug>/<tenue>/<expression>.webp` — tenue V1 = `default`.
Sources : `assets-source/planches/<slug>.png`.

### Conditions de déblocage
| id | label | condition |
|---|---|---|
| joie | Joie | défaut (débloqué d'office) |
| pouces | Pouces | 5 victoires |
| gamer | Gamer | 25 victoires |
| cool | Cool | être n°1 du classement général (victoires) |
| clin_oeil | Clin d'œil | gagner Undercover en étant l'undercover |
| reflexion | Réflexion | 10 parties d'Undercover jouées |
| boude | Boude | être éliminé en premier 3 fois à Undercover |
| bisou | Bisou | être désigné 10 fois dans « Qui de nous ? » |
| timide | Timide | être désigné 25 fois dans « Qui de nous ? » |
| amoureux | Amoureux | avoir 5 amis |
| charmee | Charmée | être ami avec les 8 autres |
| colere | Colère | perdre 3 parties d'affilée |
| pleurs | Pleurs | finir dernier 5 fois |
| dodo | Dodo | terminer une soirée après 2h du matin (Europe/Paris) |
| surprise | Surprise | participer à 10 soirées |

En jeu, **toutes** les expressions du perso sont utilisables comme réactions (même verrouillées). Le verrouillage ne concerne que l'avatar équipé.

## Auth (sans Edge Function)
1. Le client fait `supabase.auth.signInAnonymously()` (à activer dans le dashboard).
2. RPC `login_profile(p_slug text, p_pin text)` :
   - si le profil n'a pas encore de PIN → le définit (bcrypt via pgcrypto) = première connexion ;
   - sinon vérifie le PIN ; anti-bruteforce (5 échecs → blocage 15 min) ;
   - lie `auth.uid()` au profil dans `device_sessions` (plusieurs appareils possibles).
3. `current_profile_id()` = profil lié à `auth.uid()` ; utilisé par toutes les RLS.
4. RPC `admin_reset_pin(p_slug)` réservée à l'admin.
5. `update_nickname(p_nickname)`, `equip_expression(p_expression)` (vérifie unlock).

## Modèle de données (Supabase, schéma public)
- `profiles` (id uuid, slug unique, first_name, nickname, pin_hash, is_admin, equipped_expression default 'joie', expressions text[] (dispo pour ce perso), xp int, created_at)
- `device_sessions` (auth_uid pk, profile_id, created_at)
- `login_attempts` (slug, failed_count, locked_until)
- `friendships` (requester_id, addressee_id, status 'pending'|'accepted', created_at) — amitié réciproque une fois acceptée
- `soirees` (id, code char(4) unique parmi les actives, host_id, status 'lobby'|'active'|'ended', end_reason 'host'|'empty'|'idle'|'abandoned', started_at, ended_at)
- `soiree_players` (soiree_id, profile_id, joined_at) — l'hôte invite des joueurs ; ils voient la soirée dans l'app (et code 4 lettres en secours)
- `matches` (id, soiree_id, game_id text, status 'lobby'|'playing'|'finished', state jsonb **public**, created_at, finished_at, updated_at)
- `match_players` (match_id, profile_id, placement int, points int, won bool)
- `match_secrets` (match_id, profile_id, secret jsonb) — RLS : lecture uniquement par son propriétaire
- `unlocks` (profile_id, expression, unlocked_at)
- `player_stats` (vue ou table mise à jour) : compteurs nécessaires aux conditions
- vues `leaderboard_general`, `leaderboard_by_game` ; le filtre « amis » se fait via `friendships`.

Realtime activé sur `soirees`, `soiree_players`, `matches`, `match_players`.

## Moteur de jeu
- État serveur autoritaire : `matches.state` (public) + `match_secrets` (privé).
- Toutes les actions passent par **une RPC générique** `game_action(p_match_id uuid, p_action jsonb)` qui dispatche vers `game_<id>_action(...)`. Démarrage : `start_match(p_soiree_id, p_game_id, p_options jsonb)`. Fin : la logique du jeu appelle `finish_match(p_match_id, results jsonb)` qui écrit `match_players`, XP, stats et évalue les unlocks.
- XP : points de la partie ×10 + 50 par victoire. Niveau = `floor(sqrt(xp / 100)) + 1`.
- Les clients s'abonnent aux changements de la ligne `matches` et lisent leur `match_secrets`.

### Module front d'un jeu — `src/games/<id>/`
```ts
// src/games/types.ts
export interface GameDefinition {
  id: string;              // 'qui-de-nous' | 'undercover'
  name: string;
  tagline: string;
  emoji: string;
  color: string;           // couleur d'accent de la carte
  minPlayers: number;
  maxPlayers: number;
  Play: React.ComponentType<GamePlayProps>;
  Options?: React.ComponentType<GameOptionsProps>;
}
```
Registre : `src/games/registry.ts` exporte `GAMES: GameDefinition[]`.

### Jeu 1 — `qui-de-nous`
10 manches (option). Une question s'affiche, chacun vote pour un joueur présent (pas soi-même). Révélation animée. 1 point si ton vote = joueur majoritaire (égalité : tous les majoritaires comptent). Stat « désigné » += nombre de votes reçus. Gagnant(s) = max de points. Banque : `src/games/qui-de-nous/questions.ts` (≥200 questions, tout public, « Qui de nous… »).

### Jeu 2 — `undercover`
3+ joueurs. Civils ont le mot A, undercover(s) le mot B (1 undercover, 2 si ≥7 joueurs), option Mister White (aucun mot). Description à l'oral ; vote d'élimination sur téléphone ; l'éliminé révèle son rôle. Mister White éliminé peut deviner le mot civil (gagne s'il trouve). Civils gagnent quand tous les infiltrés (undercovers + Mister White) sont éliminés ; les infiltrés gagnent quand civils restants ≤ infiltrés restants. Si l'undercover survit jusqu'à la victoire des infiltrés → stat « gagné en undercover ». Banque : `src/games/undercover/words.ts` (≥150 paires).

## Arborescence
```
supabase/schema.sql          ← Opus (un seul fichier idempotent, à coller)
supabase/seed.sql            ← Opus (9 profils)
src/types/db.ts              ← Opus (types TS des tables/RPC)
src/lib/supabase.ts          ← Sonnet (client)
src/games/**/questions.ts, words.ts ← Haiku
tools/slice-chibis/          ← agent assets (package.json séparé)
public/chibis/**             ← généré par tools/slice-chibis
reste du front               ← Sonnet
```
Variables : `.env.local` → `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (jamais commitées).

## Ajouter un jeu (convention depuis la phase 3)
- Front : dossier `src/games/<id>/` avec `index.ts` exportant `definition: GameDefinition` (auto-découvert par `registry.ts`, champ `order` pour l'ordre du hub). Play/Summary en `lazy`. Types du jeu dans `src/games/<id>/types.ts` (ne pas toucher `src/types/db.ts`).
- SQL : fichier `supabase/games/<id>.sql` (idempotent, `create or replace`) avec
  `game_<id_underscore>_start(p_players uuid[], p_options jsonb) returns jsonb` → `{state, server, secrets}` et
  `game_<id_underscore>_action(p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb) returns jsonb` → `{state, server, results?, secrets?}`.
  Dispatch dynamique dans `start_match`/`game_action`. `secrets` renvoyé par une action = upsert des secrets (mains de cartes…). `results` (tableau) = fin de partie → `finish_match`. Terminer le fichier par les `revoke all ... from public, anon, authenticated` de ses fonctions.
- Minuteurs : échéance ISO dans le state (`deadline`), front `useCountdown(deadline)` de `@/features/soiree/useServerClock`. N'importe quel joueur envoie `{"type":"tick"}` à l'échéance ; le serveur vérifie `now() >= deadline` (idempotent, ignore sinon sans erreur : renvoie le state inchangé).
- Temps réel éphémère (ex. traits de dessin) : canal Supabase Realtime **broadcast** `match:<matchId>` (pas de BDD). L'état qui compte reste dans `matches.state`.
- `npm run sql` génère `supabase/install.sql` (schema + features + games + seed) : c'est CE fichier que l'utilisateur colle dans Supabase.

## Tenues (skins)
Variante vestimentaire du chibi : `public/chibis/<slug>/<tenue>/<expression>.webp`. Catalogue : table `tenues` (`supabase/features/tenues.sql`) + miroir `src/data/tenues.ts`. `profiles.equipped_tenue` (défaut `default`), RPC `equip_tenue`, déblocage « 10 victoires dans un jeu » évalué en fin de partie (`new_tenues` dans le state final). `Avatar`/`ChibiImage` prennent `tenue` (sans `tenue`, `Avatar` lit l'annuaire `usePlayers`) et se replient sur `default` + emoji si l'illustration manque (`src/data/tenues-art.generated.ts`, généré par `tools/slice-chibis`). Détails : `supabase/README.md` (Tenues) et `tools/slice-chibis/README.md`.

## Jeux en duel (socle commun)
Jeux à 2 joueurs à la fois (4 à la suite, morpion, bataille navale…) : les autres regardent en direct et **parient**. Le socle gère la session, les tours, le minuteur, les paris, les points et `finish_match` ; un jeu ne fournit **que son plateau** (3 fonctions SQL + 1 composant React).
Fichiers : `supabase/features/duel.sql` (chargé après `schema.sql`, avant `games/*.sql` par `npm run sql`), `src/features/duel/*`. Premier client : `quatre-a-la-suite` (`supabase/games/quatre-a-la-suite.sql`, `src/games/quatre-a-la-suite/`) — **le modèle à copier**. Autres clients : `morpion` (variantes `classic` 3×3 / `giant` 10×10 aligner 5 / `ultimate`, option `board.variant` via `BoardOptions`) et `bataille-navale` (seul jeu avec préparation `board_setup` : flotte 5-4-3-3-2 secrète, 60 s, placement auto ou manuel ; touché/coulé = rejoue). Détails des plateaux : en-tête de chaque `supabase/games/<id>.sql`.

### Modes de session (option `mode`, choisie par l'hôte)
| mode | déroulé | fin | `won` |
|---|---|---|---|
| `king` 👑 Roi de la table | file tirée au sort ; duel `queue[0]` (roi) vs `queue[1]` (challenger). Gagnant → reste en tête, perdant → fin de file. **Nul → les deux sortent** (fin de file, roi puis challenger), les 2 suivants entrent. | dès qu'un joueur enchaîne **3 victoires** (`streak_target`) une fois que tout le monde a joué ≥ 1 duel, **ou** quand tout le monde a joué ≥ **2** duels (`min_played`). Garde-fou : `4n+10` duels (`limit`). | meilleur(s) score(s) (> 0) |
| `tournament` 🏆 | tableau à élimination directe tiré au sort ; taille = puissance de 2 ≥ n, `taille−n` exempts placés au hasard au 1er tour (qualifiés d'office). Matchs joués tour par tour, dans l'ordre. **Nul → revanche une fois** (`replay`, même match) ; **2e nul → qualifié tiré au sort** (`random`). | finale jouée | le champion (classé 1er quels que soient les points) |
| `duel` ⚔️ | 2 joueurs choisis (`duel_players`) ou au hasard ; `best_of` 1 ou 3 (premier à 2 manches ; après 3 manches, le plus de manches gagnées l'emporte, égalité = nul). | le duel | le vainqueur (nul : personne) |

`best_of` vaut toujours 1 hors mode duel. L'hôte peut **arrêter** (`stop`) à tout moment : le duel en cours ne compte pas ; `won` = champion du tournoi s'il existe déjà, sinon meilleur(s) score(s) > 0.

**Points de session** : victoire de duel **+3**, duel nul **+1** chacun (y compris un nul de tournoi départagé au tirage), **pari juste +1** (un pari sur un duel nul ne rapporte rien). `finish_match` reçoit `points` = points de session, `placement` = rang (gagnants d'abord, puis points ; ex-aequo partagés).
**Premier joueur** : pour chaque duel, celui des deux qui a commencé le moins de manches dans la session (égalité : au hasard) ; il alterne ensuite à chaque manche du duel.

### Phases et minuteurs (`state.phase`, `deadline` + `{"type":"tick"}`)
`transition` (« Prochain duel : X vs Y », paris ouverts ; 8 s au 1er duel puis 5 s) → [`setup` : préparation simultanée, durée donnée par le jeu] → `playing` (**30 s par coup**, option `turn_seconds` 10–120 ; à l'échéance **coup automatique au hasard** via `board_auto`) → `result` (4 s après une manche, 5 s après le duel) → manche suivante / `transition` du duel suivant / `finished`. L'hôte accélère `transition` et `result` avec `{"type":"next"}`.
**Paris** : spectateurs = joueurs de la partie hors duellistes (l'hôte non joueur ne parie pas). Ouverts en `transition`, puis en manche 1 tant qu'aucun coup n'est joué **ou** pendant les 15 premières secondes du duel (`duel.bets_until`). Modifiables tant qu'ouverts. Publics (`duel.bets`).

### State public (`DuelState<Board, Move>`, miroir TS : `src/features/duel/types.ts`)
```json
{ "game": "<id>", "phase": "transition|setup|playing|result|finished|aborted",
  "players": ["uuid"], "deadline": "ISO|null", "winners": ["uuid"], "results": [],
  "session": { "mode": "king|tournament|duel", "best_of": 1, "turn_seconds": 30, "board_options": {},
    "scores": {"uuid": 0},
    "stats": {"uuid": {"played":0,"wins":0,"draws":0,"losses":0,"bets":0,"bets_won":0,"starts":0}},
    "streak": {"player": null, "count": 0}, "streak_target": 3, "min_played": 2, "duel_count": 0,
    "history": [{"no":1,"a":"","b":"","winner":null,"draw":true,"advanced":null,"wins":{},"games":[],
                 "bets":{},"bets_right":[],"round":null,"match":null,"replay":false}],
    "queue": ["uuid"],
    "bracket": {"size":8,"byes":3,"rounds":[[{"a":"","b":null,"winner":"","status":"pending|done|bye","draws":0,"random":false}]]},
    "pair": ["uuid","uuid"], "over": false,
    "end_reason": "streak|rotation|limit|bracket|duel|stopped|null", "champion": null },
  "duel": { "no": 1, "a": "uuid", "b": "uuid", "first": "uuid", "starter": "uuid", "turn": "uuid|null",
    "game_no": 1, "wins": {"uuid": 0}, "games": [{"no":1,"starter":"","winner":null,"moves":12}],
    "bets": {"<spectateur>": "<duelliste>"}, "bets_until": "ISO", "moves": 0,
    "last_move": {"by": "uuid", "move": {}, "auto": false}, "outcome": "win|draw|null", "winner": null,
    "ready": [], "result": {"winner": null, "draw": false, "advanced": null, "bets_right": []},
    "round": 0, "match": 0, "replay": false },
  "board": { "…": "plateau PUBLIC du jeu (null en transition)" } }
```
`queue`/`bracket`/`pair` ne sont renseignés que dans leur mode. `duel.result` n'est renseigné qu'à la fin du **duel** (pas d'une manche). `match_server_state.data` = `{"board": <server du jeu>}`.

### Actions (communes, traitées par `_duel_action`)
`{"type":"move","move":{…}}` (duelliste au trait en `playing` ; en `setup` : coup de préparation de l'un ou l'autre) · `{"type":"ready"}` (duelliste, `setup`) · `{"type":"bet","winner":"<uuid>"}` (spectateur) · `{"type":"tick"}` (tous ; sans effet avant l'échéance) · `{"type":"next"}` (hôte, `transition`/`result`) · `{"type":"stop"}` (hôte). `abort` reste géré par le moteur.
Erreurs du socle : `wrong_phase`, `not_duelist`, `not_your_turn`, `invalid_move`, `already_ready`, `not_a_player`, `duelist_cannot_bet`, `invalid_bet`, `bets_closed`, `not_host`, `unknown_action` ; au démarrage `not_enough_players`, `too_many_players` (> 16 ; le jeu peut être plus strict), `invalid_mode`, `invalid_duel_players`, `unknown_game` (hook obligatoire manquant) ; hook incohérent : `invalid_board`.

### Contrat SQL d'un jeu en duel — `supabase/games/<id>.sql`
Préfixe `game_<id_underscore>_` ; les joueurs sont passés en **texte** (uuid::text). Hooks sans `security definer` (appelés depuis `game_<id>_action`, qui l'est). Terminer par les `revoke all … from public, anon, authenticated`.
1. `board_new(p_ctx jsonb, p_a text, p_b text) returns jsonb` — **obligatoire**. `p_ctx = {duel_no, game_no, a, b, starter, options}` (`options` = `p_options.board`). Renvoie `{board: {…objet public}, server?: any, secrets?: {"<uid>": any}, setup_seconds?: int}`. Appelé à chaque **manche**.
2. `board_move(p_board jsonb, p_server jsonb, p_actor text, p_move jsonb) returns jsonb` — **obligatoire**. Lève un code métier si le coup est illégal (`invalid_move` ou code propre, ex. `column_full`). Renvoie `{board, server?, secrets?, outcome: null|'win'|'draw', winner?: uid, turn?: uid}` ; `turn` absent = alternance (présent = ex. « touché, rejoue ») ; `server` absent = inchangé.
3. `board_auto(p_board jsonb, p_server jsonb, p_actor text) returns jsonb` — **obligatoire**. Un coup **légal tiré au hasard** pour `p_actor` (même format que `p_move`) ; le socle le rejoue via `board_move` (`last_move.auto = true`).
4. `board_setup(p_board jsonb, p_server jsonb, p_actor text, p_move jsonb) returns jsonb` — **optionnel** : préparation **simultanée** (ex. bataille navale : placer sa flotte en 60 s). Activée si `board_new` renvoie `setup_seconds > 0` : phase `setup`, les deux duellistes envoient des coups de préparation sans tour (`{"type":"move","move":{…}}` → `board_setup(actor, move)`), puis `{"type":"ready"}`. Le hook reçoit en plus trois coups **réservés** (refusés s'ils viennent d'un client) : `{"type":"ready"}` (valider ; lever par ex. `setup_incomplete`), `{"type":"auto"}` (à l'échéance : **compléter au hasard** la préparation de `p_actor`, non prêt), `{"type":"begin"}` avec `p_actor` **NULL** (les deux sont prêts : figer). Renvoie `{board, server?, secrets?}`. Ensuite `playing`, `turn = starter`. Coup de préparation après `ready` → `already_ready`.
5. Délégation (seules fonctions vues par le moteur) :
```sql
create or replace function public.game_<id>_start(p_players uuid[], p_options jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if cardinality(p_players) > 9 then raise exception 'too_many_players'; end if;
  return public._duel_start('<id>', p_players, p_options);
end $$;
create or replace function public.game_<id>_action(p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin return public._duel_action('<id>', p_state, p_server, p_actor, p_is_host, p_action); end $$;
```
**Information cachée** (flottes…) : jamais dans `board` ; la vérité dans `server`, la vue de chaque duelliste dans `secrets` (upsert, jamais supprimés : y mettre `duel_no`/`game_no` pour que le front ignore le secret d'un duel précédent ; les spectateurs n'ont pas de secret).
Helpers internes (`revoke`) : `_duel_start`, `_duel_action`, `_duel_announce`, `_duel_pair_next`, `_duel_begin_game`, `_duel_apply_move`, `_duel_end_game`, `_duel_end_duel`, `_duel_advance`, `_duel_finish`, `_duel_setup_call`, `_duel_setup_begin`, `_duel_bracket_new`, `_duel_bracket_win`, `_duel_hook`/`_duel_fn` (dispatch dynamique, comme `_game_fn`), `_duel_board_new/_move/_auto/_setup`, `_duel_iso`, `_duel_in`, `_duel_stat`, `_duel_score`, `_duel_other`, `_duel_add_secrets`, `_duel_shuffle`.

### Contrat front — `src/games/<id>/`
- `index.ts` : `export const definition = makeDuelGame({ id, order, name, tagline, emoji, color, rules, minPlayers?, maxPlayers?, Play, Summary?, BoardOptions?, defaultBoardOptions?, prepareBoard? })` (`@/features/duel/makeDuelGame`). Fournit `Options` = `DuelOptions` (mode, meilleur de 1/3, choix des duellistes) + `BoardOptions` éventuel (stocké sous `options.board`, envoyé sous `p_options.board`), `defaultOptions`, `prepareStart` (`prepareDuelOptions` : un duelliste décoché dans « Qui joue ? » est remplacé au hasard par le serveur), `roundLabel` (`duelHeadline`) et `Summary` par défaut (`DuelSummary`). `Play`/`Summary` en `lazy`.
- `Play.tsx` : `export default (props: GamePlayProps) => <DuelPlay<Board, Move> {...props} Board={MonPlateau} myTurnHint="…" setupHint="…" sideColors={…optionnel} />`. `DuelPlay` assemble `DuelStage` (face-à-face, chibis, chrono du joueur au trait, points, manches gagnées), `DuelTransition`, `BetPanel`, `DuelResultBanner` (vainqueur, confettis, paris justes), `SessionBoard` (file du roi / tableau animé / points), les ticks (`useDuelTicker`) et les boutons de l'hôte (`next`, `stop`).
- Plateau : `ComponentType<DuelBoardProps<Board, Move>>` — props `board, me, isMyTurn, onMove(move), onReady(), pending, duel, phase, spectator, get(id), colors {a, b}, secret`. Il est rendu en `setup`, `playing` et `result` (y mettre en valeur le coup gagnant). `colors.a` = `duel.a`, `colors.b` = `duel.b` (couleurs des persos, repli tomate/soleil si trop proches : `pickSideColors`).
- Hooks/utilitaires : `useDuel(state, meId, players)` (rôle, `isMyTurn`, `betsOpen`, `left`, `betsLeft`, `get`…), `useDuelTicker`, logique pure `@/features/duel/logic` (`duelRole`, `betsOpen`, `sessionRanking`, `roundName`, `winsNeeded`, `pickSideColors`…, testable sous Node). `Summary.tsx` optionnel : `<DuelSummary {...props} extra={<StatsDuJeu />} />`.
- À ne pas oublier : codes d'erreur propres au jeu dans `src/features/soiree/errors.ts`, éventuelle tenue dans `features/tenues.sql`.

## Jeu `tour-des-potes` — « Le Tour des Potes » 🏙️
Jeu de plateau d'achat / location dans les villes des amis (2–9 joueurs, tour par tour, pas en duel). Nom, plateau et cartes 100 % originaux.
- **Fichiers** : `supabase/games/tour-des-potes.sql` (moteur, préfixe `_tdp_`), `src/games/tour-des-potes/` : `types.ts` (**contrat** complet du state public et des actions — à lire en premier), `board.ts` (40 cases : noms, anecdotes, couleurs + économie), `rules.ts` (helpers purs : `rentFor`, `buildBlocker`/`canBuild`, `sellBlocker`/`canSell`, `fortuneOf`…), `Options.tsx`, `Play.tsx`/`Summary.tsx` (versions minimales à remplacer par la vraie UI).
- **Plateau** : 0 Départ (+200), 10 violon, 20 Pause apéro, 30 Direction le violon ; 8 quartiers (Bayon ×2, Pugnac ×2, Berson ×2, Bordeaux ×2), 4 maisons des potes (5/15/25/35), 2 services (12/28), 2 taxes (4/38), cartes Hasard (7/22/36) et Entre potes (2/17/33). **Économie dupliquée** : `_tdp_board()` (SQL) = `BOARD` (board.ts) pour type/group/price/house/rents/amount — modifier les deux (le test PGlite `test-tour-des-potes.mjs` vérifie la synchro). Noms et anecdotes des lieux : **seulement** dans `board.ts`. Textes des cartes : **seulement** dans le SQL (`_tdp_cards()`, le state porte le texte tiré).
- **Tour** : phases `roll` → (`card`) → (`buy`) → `manage` → `end_turn` ; double = rejoue (3e double = violon) ; `jail` (payer 50, carte, ou tenter le double — 3e échec : paie 50 et avance) ; `debt` (vendre des bâtiments, sinon faillite immédiate ; biens rendus à la banque). Construction uniforme sur quartier complet, hôtel = 5e niveau, revente à moitié prix. Pas d'hypothèques / enchères / échanges (points d'extension notés en tête du SQL).
- **Cartes (pioche interactive)** : case Hasard / Entre potes atteinte **directement par les dés** (lancer normal ou sortie du violon en lançant) → phase `card`, `pending = {cell, deck}` (`pending` = `{cell, price}` en `buy`) ; le joueur au trait envoie `{"type":"draw"}` (`_tdp_draw`) → carte tirée et appliquée (déplacement, achat, loyer, violon…), `last_event.card` rempli (même `last_event.no`), puis suite normale (double → `roll`, sinon `manage`). Une carte qui renvoie sur une autre case carte est appliquée aussitôt (chaîne ≤ 4, pas de nouvelle phase `card`). Pas de `build`/`sell` en `card` ; minuteur / absent → pioche automatique. Côté front : `TdpState` est une union discriminée par `phase` (`s.phase === 'card'` type `pending`), helpers `pendingCard`/`pendingBuy`, `TDP_ACTIVE_PHASES`, `tdpActions.draw()`.
- **Fin** : option `format` = `chrono` (30/45/60 min, on finit le tour en cours), `tours` (10/15/20 tours de table), `classique` (dernier en lice, filet 3 h). Classement par fortune (argent + lieux + bâtiments), ex-aequo partagés ; `points = n − rang + 1`, `won` = rang 1. State final : `ranking`, `winners`, `end_reason`, `stats`.
- **Minuteur** : `turn_seconds` (0/30/45/60/90, défaut 45) → `deadline` + `{"type":"tick"}` (décision automatique). Hôte : `{"type":"skip"}` marque le joueur au trait absent (`away` : ses tours sont joués d'office jusqu'à ce qu'il agisse ou envoie `back`).
- **Affichage commun** : `last_event` (dernier lancer : case atteinte → anecdote, loyer, taxe, carte, achat, violon), `events` (évènements de la dernière action, à animer), `log` (40 derniers).
- **Cagnotte / loyers du tour** (affichage seul) : `tax_pot` = total payé sur les cases taxe 4/38 depuis le début (billets au centre ; jamais redistribué, hors fortune, cartes exclues) ; `round_rents = {round, payments: [{no, payer, owner, cell, amount}]}` = loyers du tour de table en cours (cartes « la plus proche » incluses, `no` = event_no du log `rent`, 60 max), vidé dans `_tdp_next_turn` au changement de `round`. States antérieurs sans ces champs : coalesce côté SQL, `?? 0` / `?.` côté front.
- Tests : dés imposés via `match_server_state.data.forced_dice` (file `[[a,b],…]`, jamais exposée aux clients). Tenue `magnat` 🎩 (10 victoires).

## Jeu `dede-kart` — « Dédé Kart » 🏎️ (jeu n°20)
Course de karts 3D arcade, **3 à 12 joueurs, tous en même temps**, chacun sur son téléphone. Jeu **original** (aucun nom, objet, circuit ou visuel d'un jeu existant). Même principe que `bowling` : le client simule sa conduite, le serveur valide et calcule le classement.

### Décisions (validées par l'utilisateur)
- Vraie 3D `three` (déjà utilisé par le bowling), sans moteur physique lourd (physique arcade maison). Pas de R3F.
- Contrôles : glisser/toucher gauche-droite pour tourner, accélération automatique, bouton Drift, bouton Objet. Clavier sur ordinateur (flèches/ZQSD, Espace, Entrée).
- **Coupe de 3 circuits**, points par place à chaque course ; option « 1 seule course ».
- Bonus avec **rattrapage** : le tirage dépend de ta place (les derniers reçoivent les gros bonus).
- **Bots** : nombre choisi par l'hôte (option `fill`, total ≤ 12). Ils sont conduits par le **premier joueur présent** (ordre de `players`, présence = positions reçues depuis < 2,5 s ; pendant le décompte, tout le monde est supposé présent). Si ce joueur disparaît, le suivant reprend les bots depuis leur dernier état (`Game.setBotDriver`, champs `l`/`c` du broadcast). N'importe quel joueur peut envoyer les actions d'un bot (`"bot":"botK"`) ; un tour de bot décalé est ignoré sans erreur.
- **Stats identiques** pour tous. Chaque perso a son kart (sprite chibi de sa tenue équipée dans un kart de sa couleur) et son klaxon ; rien qui change la vitesse.

### Options (hôte)
`{ "cup": true|false, "laps": 2|3, "bots": 0..11 }` (défaut : coupe, 3 tours, 0 bot).

### Circuits (`src/games/dede-kart/tracks.ts`, géométrie côté client ; le serveur ne connaît que `checkpoints` et `min_cp_ms`)
1. **Circuit du Salon** 🛋️ : décor de cubes-jouets, 2 dalles turbo.
2. **Plage Tongs-Palace** 🏖️ : route en planches, parasols, 2 dalles turbo, 1 tremplin.
3. **Montagne Raclette** 🏔️ : neige, sapins, 2 dalles turbo, 2 tremplins.
Tracés vérifiés : rayon de virage ≥ 22 et portions de piste espacées de ≥ 30 (sinon le ruban de piste se replie et le repérage des karts déraille). Tremplin : saut de 0,75 s si on arrive vite (on passe au-dessus de la glue), bit `E_AIR` dans le broadcast. Karts : 3 formes (classique, bolide, buggy) selon le perso (`kartOf`), couleur du perso. Tenue `pilote` 🏎️ (10 victoires, dossier d'art `racer` à fournir : planches + portraits).

### Course
Phases : `countdown` (3-2-1, `deadline` = feu vert) → `racing` → `results` (classement de la course + points) → course suivante ou `finished`. Course terminée quand tous ont fini, ou 30 s après l'arrivée du 1er (les autres classés à leur progression), ou l'hôte la coupe.
- Progression : chaque téléphone vérifie lui-même ses checkpoints (8 par tour) et n'envoie au serveur qu'**un tour bouclé** : `{"type":"lap","lap":n}` (l'hôte ajoute `"bot":"botK"` pour ses bots). Le serveur vérifie l'ordre des tours et un temps minimum par tour (`_dk_min_lap_ms`, 12 s) ; doublons ignorés. ~36 écritures par course à 12.
- Arrivée : le dernier tour bouclé = arrivée ; `finish[id]` = ms depuis `go_at`, `arrival` = ordre d'arrivée.
- Positions : **broadcast** `kart:<matchId>` (~10 Hz : x, z, cap, vitesse, drift, état), jamais en base. Les karts des autres sont interpolés.

### Objets (nom provisoire → effet)
| Objet | Effet |
|---|---|
| 🚀 Pétard turbo | boost de 2 s |
| 🎳 Boule rebondissante | projectile, 3 rebonds, fait tournoyer qui touche |
| 🍯 Flaque de glue | piège posé derrière toi, ralentit + fait tournoyer |
| 🌈 Bouclier arc-en-ciel | invincible + vitesse max 5 s |
| 🛡️ Bulle | absorbe 1 coup |
| ☁️ Gros nuage | ralentit 3 s tous ceux qui sont devant toi (réservé aux places > 6) |
| 🎊 Confettis | brouille l'écran du joueur devant toi 3 s |
| 🔄 Demi-tour | inverse les commandes du 1er 3 s (réservé aux places > 3) |

Boîtes `?` (3 rangées de 4, `BOX_ROWS`), réapparition 5 s **sur chaque téléphone**. **Tirage sur le téléphone** (`rollItem(place, total)`, roulette 1,2 s, pas d'écriture en base). Turbo, Bouclier arc-en-ciel et Bulle restent locaux (visibles des autres via le broadcast, champ `e`). Les objets qui touchent les autres passent par le serveur : `{"type":"use","item":"ball"|"glue","x","z","h"}` → `state.hazards[{id,type,owner,x,z,h,at}]` ; `{"type":"use","item":"cloud"|"confetti"|"reverse","targets":[ids]}` (cibles calculées par le lanceur) → `state.fx[{id,type,target,by,until}]` (3 s). Chaque téléphone simule les boules (trajectoire déterministe `BallSim`, pas fixe 1/60 s, 3 rebonds, 6 s) ; la **victime** envoie `{"type":"hit","hazard":id}` (doublons ignorés, `hits[lanceur]++`). Protection appliquée chez la victime (bouclier : intouchable ; bulle : absorbe 1 coup). Boules > 6 s, flaques > 30 s et effets expirés purgés à chaque `use`/`hit`.
Poids de tirage : 1er quart → Bulle/Boule/Glue ; milieu → équilibré ; dernier tiers → Pétard, Bouclier arc-en-ciel, Gros nuage, Demi-tour. Gros nuage : 2ᵉ moitié du classement ; Demi-tour : places > 3.

### Coupe
Points par place (12 places) : 15, 12, 10, 8, 7, 6, 5, 4, 3, 2, 1, 0 (moins de joueurs : on prend le début de la liste). Total des courses ; égalité → meilleure place, puis dernière course. `finish_match` : `points` = total, `placement` = rang final, `won` = rang 1.

### Contrat SQL — `supabase/games/dede-kart.sql`
`game_dede_kart_start` / `game_dede_kart_action` (actions : `lap`, `tick`, `next` (hôte), `end_game` (hôte) ; objets : étape 4). Options `{races: 1|3, laps: 2|3, fill: 0|6|8|12}` (bots = fill − joueurs). State public : `phase (racing/results/finished), race, races, track, laps, go_at, deadline, players, bots, laps_done{}, lap_at{}, finish{}, arrival[], points{}, standings[{race, track, places[{id, place, pts, time, laps}]}]`. Points finaux = total ÷ nombre de courses (XP comparable aux autres jeux).

### Étapes de réalisation
1 cadrage (ce document) · 2 course solo (moteur 3D, kart, drift, circuit 1) · 3 multi (broadcast, karts des autres) · 4 objets + SQL · 5 3 circuits, coupe, résumé, karts par perso.
