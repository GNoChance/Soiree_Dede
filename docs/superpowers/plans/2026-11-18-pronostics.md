# Pronostics entre potes — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** Avant chaque jeu lancé depuis le salon, chacun parie en 1 tap sur le gagnant ; bons pronostics = points « Meilleur devin » de la soirée + trophée « Madame Irma ».

**Architecture :** Une étape « Pronostics » s'ouvre côté serveur (table `soiree_prono_rounds`, temps réel) *avant* `start_match`. Les paris vivent dans `soiree_pronos` (aucun accès client direct). Un trigger sur `matches` les rattache à la partie créée ; le résultat est calculé à la lecture en joignant `match_players.won`. Aucune modification des 20 jeux ni de `finish_match`.

**Tech Stack :** Postgres/Supabase (RPC `security definer`, RLS, Realtime), React 19 + TypeScript, Tailwind 4, framer-motion. Tests SQL : PGlite (`tools/sql-tests/`, package.json séparé).

**Spec :** [docs/superpowers/specs/2026-11-18-pronostics-design.md](../specs/2026-11-18-pronostics-design.md)

## Global Constraints

- Français uniquement, tout public ; UX ultra simple (gros boutons, 1 tap, pas de bouton « Valider » pour parier), lisible sur mobile 390×844.
- Design « sticker book » : contours épais, ombre décalée `box-shadow: 4px 4px 0 <ink>`, thème clair + sombre, animations sobres.
- Toute la logique serveur = RPC SQL `security definer` (pas d'Edge Function) ; SQL idempotent ; nouveau fichier `supabase/features/pronos.sql` ; après toute modif SQL : `npm run sql` puis rappeler de coller `supabase/install.sql` dans le SQL Editor Supabase.
- Ne pas toucher `src/types/db.ts` (RPC appelées via le client non typé `loose` de `hostTools.ts`) ni les 20 jeux ni la signature de `finish_match`.
- Nouveaux codes d'erreur dans `src/features/soiree/errors.ts`.
- Un pari par (soirée, joueur) ; +1 point par bon pronostic ; le classement « Meilleur devin » n'influence pas le classement des jeux.
- Trophée « Madame Irma » = 3 bons pronostics d'affilée (général : `tenue_id`/`slot` nuls). Le sticker exclusif est fourni plus tard par l'utilisateur : hors périmètre.
- Commits sur `main`, chemins explicites (jamais `git add .`) ; les pages de test locales (`src/pages/*Test*`, `GalleryPage`) et les routes DEV de `src/App.tsx` ne se committent pas. Ne pousser que sur demande (« pousse »).

## Review Focus

Entrées que la spec implique sans qu'une tâche les exerce de façon évidente ; chacune a son test dans la tâche indiquée.

1. **Étape ouverte puis abandonnée** (l'hôte quitte l'écran sans lancer) : la carte ne doit pas rester affichée indéfiniment chez les joueurs → expiration à 10 min côté serveur (Tâche 1).
2. **Hôte qui change de jeu ou d'effectif pendant l'étape** : les paris faits pour l'ancien jeu ne doivent pas compter pour le nouveau → `open_pronos` repart de zéro (Tâche 1, Tâche 4).
3. **Parieur absent de la manche** (joueur de la soirée exclu de la manche par l'hôte) : il peut parier, ses points comptent, il ne reçoit pas d'écran de révélation mais reçoit le trophée (Tâche 1, Tâche 2).
4. **Partie sans gagnant ou annulée** : paris annulés, ni points ni rupture de série (Tâche 1, Tâche 2).
5. **Double tap rapide / changement d'avis** : un seul pari par joueur, le dernier gagne, le compteur « N ont parié » reste juste (Tâche 1, Tâche 3).

## File Structure

| Fichier | Rôle |
|---|---|
| `supabase/features/pronos.sql` (créer) | Tables, RLS, Realtime, RPC (`open_pronos`, `close_pronos`, `set_prono`, `get_pronos`, `match_pronos`, `soiree_prono_board`), trigger d'attache sur `matches`, helper `_prono_resolved` |
| `supabase/features/trophees.sql` (modifier) | Règle `special` `prono_streak`, trophée `gen_madame_irma`, `_after_finish_trophies` inclut les parieurs |
| `supabase/features/recap.sql` (modifier) | Award `devin` dans `_soiree_recap_compute` |
| `tools/sql-tests/` (créer) | `package.json` (`@electric-sql/pglite`), `pronos.mjs` : scénarios SQL sur `install.sql` complet |
| `src/features/pronos/types.ts`, `api.ts` (créer) | Types, appels RPC, hooks `usePronos`, `useDevinBoard` |
| `src/features/pronos/PronosPicker.tsx` (créer) | Grille d'avatars, 1 tap = pari (présentationnel) |
| `src/features/pronos/PronosCard.tsx` (créer) | Carte « Qui va gagner ? » côté joueur (branchée sur `usePronos`) |
| `src/features/pronos/PronosResult.tsx`, `DevinLine.tsx` (créer) | Bande de résultat fin de partie ; ligne « Meilleur devin » |
| `src/pages/SoireePage.tsx` (modifier) | `HostPanel` : étape Pronostics avant le lancement ; `PronosCard` pour les non-hôtes |
| `src/features/soiree/ResultsScreen.tsx`, `src/pages/MatchPage.tsx` (modifier) | Bande de résultat (prop `matchId`) |
| `src/features/stats/SoireeStandings.tsx` (modifier) | `DevinLine` dans le classement du salon et le podium |
| `src/features/recap/api.ts`, `cards.ts` (modifier) | Award `devin` |
| `src/data/trophees.ts`, `src/features/soiree/errors.ts`, `src/features/soiree/hostTools.ts`, `docs/ARCHITECTURE.md` (modifier) | Miroir du trophée, erreurs, export de `loose`, doc |

---

### Task 1 : Noyau serveur des pronostics (tables, RPC, trigger, résultat)

**Files:**
- Create: `supabase/features/pronos.sql`, `tools/sql-tests/package.json`, `tools/sql-tests/pronos.mjs`
- Modify: `package.json` (scripts : rien — `tools/sql-tests` a son propre `package.json`)

**Interfaces:**
- Produces (SQL, tous `security definer`, `grant execute … to authenticated`) :
  - `open_pronos(p_soiree_id uuid, p_game_id text, p_player_ids uuid[]) returns jsonb` → `{soiree_id, game_id, player_ids, bets, opened_at}`. Hôte seulement. Erreurs : `not_host`, `soiree_ended`, `match_in_progress`, `invalid_pronos` (moins de 2 joueurs, ou un joueur hors soirée). Supprime les paris ouverts de la soirée puis (ré)écrit la manche.
  - `close_pronos(p_soiree_id uuid) returns void` — hôte ; supprime manche et paris ouverts.
  - `set_prono(p_soiree_id uuid, p_pick uuid) returns void` — membre de la soirée. Erreurs : `pronos_closed` (pas de manche ouverte, ou ouverte depuis plus de 10 min), `invalid_pick` (hors `player_ids`). Upsert du pari, puis `bets` de la manche = nombre de paris ouverts.
  - `get_pronos(p_soiree_id uuid) returns jsonb` → `{"round": <manche|null>, "my_pick": <uuid|null>}` (manche expirée = `null`) ; jamais les paris des autres.
  - `match_pronos(p_match_id uuid) returns jsonb` → `null` si aucun pari ; sinon `{"void": boolean, "picks": [{"profile_id","pick","ok"}]}` ; `void = true` si la partie n'est pas terminée ou n'a aucun gagnant ; `ok` = le joueur choisi a `match_players.won`. Réservé aux membres de la soirée de la partie.
  - `soiree_prono_board(p_soiree_id uuid) returns jsonb` → `[{"profile_id","hits","bets"}]` trié `hits desc, bets asc, sort_order`, parties résolues seulement (non annulées, avec gagnant) ; `[]` si aucun pari.
  - `_prono_resolved() returns table(soiree_id uuid, match_id uuid, profile_id uuid, pick uuid, ok boolean, at timestamptz)` (interne, `revoke all`) : paris rattachés à une partie `finished` ayant au moins un `match_players.won`.
- Tables : `soiree_prono_rounds(soiree_id pk, game_id, player_ids uuid[], bets int, opened_at)` (select pour `is_soiree_member`, dans la publication `supabase_realtime`) ; `soiree_pronos(id, soiree_id, profile_id, pick_profile_id, match_id null, created_at, updated_at)` avec index uniques partiels `(soiree_id, profile_id) where match_id is null` et `(match_id, profile_id) where match_id is not null` ; aucun droit client.
- Trigger `after insert on public.matches` `_pronos_attach()` : si une manche ouverte existe pour `new.soiree_id` **et** `game_id = new.game_id`, rattache les paris ouverts à `new.id` ; dans tous les cas supprime la manche et les paris ouverts restants.

- [ ] **Step 1 : Écrire `tools/sql-tests/pronos.mjs` (scénarios, échouent tant que `pronos.sql` n'existe pas).** Bootstrap : même schéma que le test push existant (rôles `anon`/`authenticated`, schéma `auth` avec `auth.uid()` lue dans `current_setting('app.uid')`, extension `pgcrypto`, chargement de `supabase/install.sql` deux fois pour vérifier l'idempotence). Trois profils A (hôte), B, C. Assertions, une par ligne :
  - `open_pronos` par B → erreur `not_host` ; avec un seul joueur → `invalid_pronos` ; par A avec `{A,B,C}` → manche `bets = 0`.
  - `set_prono(B → A)` puis `set_prono(B → C)` : un seul pari (le dernier), `bets = 1` ; `set_prono(B → D)` hors manche → `invalid_pick` ; avant ouverture → `pronos_closed`.
  - `get_pronos` côté C : `my_pick = null`, `round.bets = 1`, aucune trace du pari de B ; `update soiree_prono_rounds set opened_at = now() - interval '11 minutes'` → `get_pronos.round = null` et `set_prono` → `pronos_closed`.
  - `open_pronos` rappelé avec un autre jeu : les paris précédents sont effacés (`bets = 0`).
  - `start_match` du même jeu : paris rattachés (`match_id` non nul), manche supprimée ; `start_match` d'un autre jeu : paris supprimés.
  - Résolution via `finish_match` : A et C gagnent (égalité) → `match_pronos` : B (pick C) `ok = true`, `void = false` ; partie sans gagnant → `void = true` ; partie annulée (`game_action abort`) → `void = true`.
  - `soiree_prono_board` : `hits`/`bets` justes après deux parties ; parieur absent de la manche (joueur de la soirée hors `player_ids` du match) compte.
  - `match_pronos` appelé par un non-membre → erreur.
  Chaque assertion affiche `OK`/`ÉCHEC` et le script sort en code 1 au premier échec.
- [ ] **Step 2 : Lancer et vérifier l'échec.** `cd tools/sql-tests && npm i && node pronos.mjs ../../supabase/install.sql` → attendu : échec « function open_pronos does not exist » (ou équivalent).
- [ ] **Step 3 : Créer `supabase/features/pronos.sql`** avec les tables, politiques, publication (bloc `do $$ … alter publication supabase_realtime add table` gardé comme dans `soiree-hote.sql`), les fonctions et le trigger ci-dessus. Idempotent (`create table if not exists`, `create or replace`, `drop trigger if exists`), terminé par les `revoke`/`grant`. Imiter le style de `supabase/features/soiree-hote.sql` (en-tête de commentaire listant erreurs et contrats).
- [ ] **Step 4 : `npm run sql` puis relancer `node pronos.mjs ../../supabase/install.sql`** → attendu : toutes les assertions `OK`, 2e chargement idempotent sans erreur.
- [ ] **Step 5 : Commit.** `git add supabase/features/pronos.sql supabase/install.sql tools/sql-tests/package.json tools/sql-tests/pronos.mjs` puis `git commit -m "Pronostics : noyau serveur (manche, paris, résultat, classement)"`.

---

### Task 2 : Trophée « Madame Irma » et award « Meilleur devin » du Wrapped

**Files:**
- Modify: `supabase/features/trophees.sql` (`_tr_progress` : ajouter `when 'prono_streak'` ; catalogue : ligne `gen_madame_irma` ; `_after_finish_trophies` : inclure les parieurs), `supabase/features/recap.sql` (`_soiree_recap_compute` : candidat `devin`), `tools/sql-tests/pronos.mjs`

**Interfaces:**
- Consumes : `_prono_resolved()` (Tâche 1).
- Produces :
  - Règle `{"agg":"special","name":"prono_streak","threshold":3}` : plus longue suite de bons pronostics consécutifs (tri `at, match_id`) parmi les pronostics **résolus** ; un pronostic annulé n'interrompt ni n'allonge la série.
  - Trophée `gen_madame_irma` (`tenue_id`/`slot` nuls, `name` « Madame Irma », description « 3 bons pronostics d'affilée », `active = true`, `sort_order` 231).
  - `_after_finish_trophies(p_match_id, p_profile_ids)` évalue aussi `distinct profile_id` de `soiree_pronos where match_id = p_match_id`.
  - Award recap `{id:'devin', profile_id, value: hits, extra:{bets}}`, candidat si `hits >= 1` ; placé en dernier dans l'ordre `array_position`.

- [ ] **Step 1 : Ajouter au test** `pronos.mjs` : (a) A parie juste 2 fois puis une partie sans gagnant puis une 3e fois juste → `evaluate_trophies` débloque `gen_madame_irma` (l'annulée ne casse pas la série) ; (b) un faux pronostic au milieu remet la série à 0 (pas de déblocage après 2+2) ; (c) un parieur absent de la manche reçoit le trophée dans `finish_match` (`new_trophies` contient son id) ; (d) `soiree_recap` d'une soirée terminée contient un award `devin` avec `value` = nombre de bons pronostics du meilleur parieur, et aucun award `devin` si personne n'a parié.
- [ ] **Step 2 : Lancer → échecs attendus** (« trophée inexistant », pas d'award).
- [ ] **Step 3 : Implémenter** les trois modifications SQL. `prono_streak` : îlots (`row_number() over (order by at, match_id) - row_number() over (partition by ok order by at, match_id)`), max de la longueur des îlots où `ok`.
- [ ] **Step 4 : `npm run sql`, relancer `node tools/sql-tests/pronos.mjs supabase/install.sql`** → toutes les assertions (Tâches 1 et 2) `OK`.
- [ ] **Step 5 : Commit.** `git add supabase/features/trophees.sql supabase/features/recap.sql supabase/install.sql tools/sql-tests/pronos.mjs` ; `git commit -m "Pronostics : trophée Madame Irma et award Meilleur devin"`.

---

### Task 3 : Front — API, hook temps réel, sélecteur et carte joueur

**Files:**
- Create: `src/features/pronos/types.ts`, `src/features/pronos/api.ts`, `src/features/pronos/PronosPicker.tsx`, `src/features/pronos/PronosCard.tsx`
- Modify: `src/features/soiree/hostTools.ts` (exporter `loose`), `src/features/soiree/errors.ts` (`pronos_closed`, `invalid_pick`, `invalid_pronos` avec messages français courts), `src/pages/SoireePage.tsx` (afficher `PronosCard` aux non-hôtes sous `WaitingCard`)

**Interfaces:**
- Produces (`types.ts`) : `PronoRound { soiree_id: string; game_id: string; player_ids: string[]; bets: number; opened_at: string }`, `PronosState { round: PronoRound | null; my_pick: string | null }`, `MatchPronos { void: boolean; picks: { profile_id: string; pick: string; ok: boolean }[] }`, `DevinRow { profile_id: string; hits: number; bets: number }`.
- Produces (`api.ts`) : `openPronos(soireeId: string, gameId: string, playerIds: string[])`, `closePronos(soireeId: string)`, `setProno(soireeId: string, pick: string)` (chacun renvoie `{ error }` comme `spinWheel`), `fetchMatchPronos(matchId: string): Promise<MatchPronos | null>`, `usePronos(soireeId: string | undefined): { state: PronosState; pick: (id: string) => Promise<void> }` (lit `get_pronos`, s'abonne aux `postgres_changes` de `soiree_prono_rounds` filtrés par `soiree_id`, refetch sur chaque évènement et au retour de focus via `useResync` ; `pick` met à jour `my_pick` de façon optimiste puis appelle `setProno`, et restaure l'ancien choix en cas d'erreur), `useDevinBoard(soireeId: string | undefined): DevinRow[]` (RPC `soiree_prono_board`, relue quand `matches` passe à `finished`, comme `useSoireeStandings`).
- Produces (`PronosPicker.tsx`) : `PronosPicker({ playerIds, byId, meId, myPick, onPick, disabled }: { playerIds: string[]; byId: Record<string, PlayerInfo>; meId: string; myPick: string | null; onPick: (id: string) => void; disabled?: boolean })` — grille de boutons d'avatars chibi (min 96 px de large, cible tactile ≥ 56 px), pastille « moi » sur son propre avatar, coche animée sur le choix ; purement présentationnel.
- Produces (`PronosCard.tsx`) : `PronosCard({ soireeId, meId, byId })` — `null` s'il n'y a pas de manche ; sinon `Card` « 🔮 Qui va gagner ? », nom du jeu, `PronosPicker`, texte « Choisis, tu peux changer d'avis jusqu'au lancement ».
- Consumes : `PlayerInfo` / `usePlayers().byId` (`src/features/soiree/players.ts`), `playerOrPlaceholder`, `useResync` (`hooks.ts`).

- [ ] **Step 1 : Fixer les critères de test** (le projet n'a pas de framework de test front ; ils sont vérifiés à l'étape 4 dans la page locale) : clic rapide sur A puis B → `my_pick` finit à B ; échec RPC (`pronos_closed`) → retour à l'ancien choix et toast d'erreur ; avatar du joueur exclu de la manche absent de la grille.
- [ ] **Step 2 : Créer** `types.ts`, `api.ts` (RPC via `loose`), `PronosPicker.tsx`, `PronosCard.tsx` selon les signatures ci-dessus ; exporter `loose` ; ajouter les 3 messages d'erreur ; brancher `PronosCard` dans `SoireePage` (non-hôtes, hors `launching`).
- [ ] **Step 3 : Vérifier** `npx tsc -b` et `npx eslint src/features/pronos src/pages/SoireePage.tsx` sans erreur.
- [ ] **Step 4 : Page locale de test non commitée** `src/pages/PronosTestPage.tsx` (route DEV `/pronos-test`, ajoutée à `src/App.tsx` en local seulement) qui rend `PronosPicker` avec 4 faux joueurs et un état simulé (choix, changement, désactivé). Capture headless 390×844 (clair et sombre) : avatars non coupés, cible tactile ≥ 56 px, coche visible, pas de défilement horizontal.
- [ ] **Step 5 : Commit.** `git add src/features/pronos src/features/soiree/hostTools.ts src/features/soiree/errors.ts src/pages/SoireePage.tsx` ; `git commit -m "Pronostics : carte joueur et sélecteur d'avatars"`.

---

### Task 4 : Front — étape Pronostics côté hôte

**Files:**
- Modify: `src/pages/SoireePage.tsx` (`HostPanel`), `src/features/pronos/api.ts` si un helper manque

**Interfaces:**
- Consumes : `openPronos`, `closePronos`, `usePronos`, `PronosPicker` (Tâche 3) ; dans `HostPanel` : `gameId`, `playing` (joueurs retenus), `start()`, `launchReq`, `pendingStart`.
- Produces : état `pronos: 'off' | 'open'` dans `HostPanel`.
  - Bouton principal « C'est parti ! » : si `playing.length >= 2` → `openPronos(soireeId, game.id, playing)` puis `pronos = 'open'` ; sinon (cas dégénéré) → `start()` direct.
  - En `open` : afficher `PronosPicker` (l'hôte parie aussi), le texte « N/M ont parié » (`round.bets` / nombre de joueurs de la soirée), le bouton principal devient « Lancer la partie » (appelle `start()`), et un lien « Annuler les pronostics » (`closePronos`, retour `off`).
  - Lien secondaire « Lancer sans pronostics » (visible en `off`) : `start()` direct, sans ouvrir.
  - Si `gameId` ou la liste `playing` change pendant `open` : rappeler `openPronos` (paris remis à zéro) ; si `start()` échoue, rester en `open`.
  - Le lancement depuis la roue (`launchReq` → `pendingStart`) ouvre l'étape Pronostics au lieu de `start()` direct.
  - `busy`/`launching` (partie déjà en cours) : jamais d'ouverture ; à la fin du démarrage (`onStarted`), `pronos` repasse à `off`.

- [ ] **Step 1 : Implémenter** les transitions ci-dessus dans `HostPanel`, en réutilisant la barre fixée existante (`onBarHeight` continue d'être mesuré : la barre change de hauteur quand l'étape s'ouvre).
- [ ] **Step 2 : Vérifier** `npx tsc -b`, `npx eslint src/pages/SoireePage.tsx`.
- [ ] **Step 3 : Capture headless locale** via la page de test (états `off`, `open` avec compteur 3/5, jeu changé → compteur remis à 0) à 390×844 ; vérifier que le bouton « Lancer la partie » reste atteignable (la page réserve `barH + 16` de marge basse).
- [ ] **Step 4 : Commit.** `git add src/pages/SoireePage.tsx src/features/pronos` ; `git commit -m "Pronostics : étape avant le lancement côté hôte"`.

---

### Task 5 : Front — résultat, meilleur devin, Wrapped, trophée, documentation

**Files:**
- Create: `src/features/pronos/PronosResult.tsx`, `src/features/pronos/DevinLine.tsx`
- Modify: `src/features/soiree/ResultsScreen.tsx`, `src/pages/MatchPage.tsx` (passer `matchId={match.id}`), `src/features/stats/SoireeStandings.tsx` (`SoireeStandingsCard` et `SoireePodium`), `src/features/recap/api.ts` (`AwardId` + `'devin'`, `extra.bets?: number`), `src/features/recap/cards.ts` (cas `devin`), `src/data/trophees.ts` (entrée `gen_madame_irma`, `target: 3`, `active: true`), `docs/ARCHITECTURE.md` (section « Pronostics » : tables, RPC, flux, trophée)

**Interfaces:**
- Consumes : `fetchMatchPronos`, `useDevinBoard` (Tâche 3), `Avatar`, `Card`.
- Produces :
  - `PronosResult({ matchId, meId, byId }: { matchId: string; meId: string; byId: Record<string, PlayerInfo> })` — charge `fetchMatchPronos` ; `null` si pas de paris ou `void` ; sinon bande « 🔮 Les pronostics » : un avatar par parieur, étoile + « +1 » (spring) pour `ok`, choix grisé sinon ; ma ligne en premier.
  - `DevinLine({ soireeId }: { soireeId: string })` — `null` si `useDevinBoard` vide ; sinon « 🔮 Meilleur devin : <pseudos ex æquo> · N bon(s) pronostic(s) ».
  - Carte Wrapped `devin` : emoji 🔮, titre « Meilleur devin », `big` = `N bons pronostics`, ligne bienveillante, `bg-grape` (ou classe existante équivalente).
  - Prop `matchId: string` ajoutée à `ResultsScreen`.

- [ ] **Step 1 : Créer** `PronosResult.tsx` et `DevinLine.tsx` ; insérer `PronosResult` sous le podium de `ResultsScreen` (passer `matchId`), `DevinLine` dans `SoireeStandingsCard` et sous le `Podium` de `SoireePodium`.
- [ ] **Step 2 : Wrapped + trophée** : cas `devin` dans `awardView`, `AwardId`, entrée `TROPHIES`. Vérifier que le texte du partage en image (`share.ts`) n'a pas de liste fermée d'ids (sinon l'étendre).
- [ ] **Step 3 : Documentation** : section « Pronostics » dans `docs/ARCHITECTURE.md` (contrats SQL, flux hôte → joueurs → résolution, expiration 10 min, erreurs).
- [ ] **Step 4 : Vérifier** `npx tsc -b`, `npm run lint`, `npm run build` sans erreur ; capture headless de `PronosResult` (bons devins / aucun / `void`) via la page de test locale à 390×844.
- [ ] **Step 5 : Commit.** `git add src/features/pronos src/features/soiree/ResultsScreen.tsx src/pages/MatchPage.tsx src/features/stats/SoireeStandings.tsx src/features/recap src/data/trophees.ts docs/ARCHITECTURE.md` ; `git commit -m "Pronostics : résultat, meilleur devin, Wrapped et trophée Madame Irma"`.

---

### Task 6 : Vérification finale et passage de relais

**Files:** aucun nouveau (régénération de `supabase/install.sql`).

- [ ] **Step 1 :** `npm run sql` ; `node tools/sql-tests/pronos.mjs supabase/install.sql` → tout `OK` ; `npm run build` et `npm run lint` → sans erreur.
- [ ] **Step 2 :** Relecture finale du diff complet de la branche (`git diff origin/main...HEAD --stat`) : aucun fichier de jeu, aucun `src/types/db.ts`, aucune page de test, aucun `src/App.tsx` commité.
- [ ] **Step 3 :** Commit de `supabase/install.sql` s'il a changé, puis message à l'utilisateur : « SQL à coller dans le SQL Editor Supabase (`supabase/install.sql`), puis dire "pousse" ». Rappel : le sticker exclusif « Madame Irma » reste à brancher à la livraison de l'image.

---

## Auto-revue

- **Couverture de la spec :** étape avant lancement (T1, T4) ; pari 1 tap sur soi inclus (T3) ; compteur et « Lancer » / « Sans pronostics » (T4) ; lisibilité des paris seulement à la fin (T1, `get_pronos`) ; points, égalité, annulation, un seul joueur (T1, T2) ; classement et Wrapped (T2, T5) ; trophée (T2, T5) ; cas particuliers : exclu/parti, changement de jeu, arrivée tardive (`get_pronos` + Realtime, T1/T3), équipes (via `won`) ; documentation (T5). Aucun trou identifié.
- **Écart assumé avec la spec :** la spec disait « hook de fin de partie » ; le plan calcule le résultat à la lecture (aucun changement de `finish_match`) et n'ajoute qu'un trigger d'attache sur `matches`, plus simple et sans risque pour les 20 jeux.
- **Cohérence des types :** `PronosState`, `PronoRound`, `MatchPronos`, `DevinRow` définis en T3 et consommés tels quels en T4/T5 ; noms de RPC identiques entre T1 (SQL), T2 (`_prono_resolved`) et T3 (`api.ts`).
- **Proportion :** plan court (6 tâches), signatures et assertions seulement, aucun corps de fonction.
