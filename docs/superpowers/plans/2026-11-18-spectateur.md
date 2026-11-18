# Mode spectateur — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** Regarder une partie en cours sans y jouer — depuis le salon (arrivant ou non-joueur) et depuis la liste d'amis (œil 👀, même hors soirée) — avec un écran de jeu en lecture seule sans secret ; toucher un ami ouvre son profil.

**Architecture :** Un spectateur = quelqu'un qui n'est ni hôte ni dans `state.players` de la partie. `MatchPage` détecte ce cas, affiche un bandeau, passe `secret = null` et un `act` no-op aux écrans de jeu. Côté serveur, une fonction `can_watch_match` élargit la lecture de `matches` aux amis acceptés d'un joueur ou de l'hôte ; `friends_playing` alimente les yeux. Les 20 écrans de jeu sont audités en lecture seule avec de vrais états générés par le serveur de test.

**Tech Stack :** Postgres/Supabase (RLS, RPC `security definer`, Realtime), React 19 + TypeScript, Tailwind 4, framer-motion, react-router 7. Tests SQL : PGlite (`tools/sql-tests/`). Audit visuel : Chrome headless (puppeteer-core, hors dépôt).

**Spec :** [docs/superpowers/specs/2026-11-18-spectateur-design.md](../specs/2026-11-18-spectateur-design.md)

## Global Constraints

- Français uniquement, tout public ; UX ultra simple, gros boutons (cibles tactiles ≥ 44 px), lisible sur mobile 390×844 ; design « sticker book », thème clair + sombre.
- Logique serveur = RPC SQL `security definer` ou RLS (pas d'Edge Function) ; SQL idempotent ; nouveau fichier `supabase/features/spectateur.sql` ; après toute modif SQL : `npm run sql`, puis rappeler de coller `supabase/install.sql` dans le SQL Editor Supabase.
- Un spectateur est **strictement en lecture seule** : aucune action envoyée (même pas `tick`, que le serveur refuse à un non-joueur : `not_in_match`) ; aucun secret affiché (`secret = null`).
- Seule la lecture de `matches` est élargie : `soirees`, `soiree_players`, `soiree_messages`, `match_secrets`, `match_server_state` restent réservés comme aujourd'hui. Pas d'interrupteur de confidentialité (décision utilisateur) : tout ami accepté d'un joueur ou de l'hôte peut regarder.
- Ne pas toucher `src/types/db.ts` (RPC appelées via `loose` de `src/features/soiree/hostTools.ts`), ni la signature de `finish_match`/`start_match`/`game_action`.
- Aucune régression pour les joueurs : le chemin « je joue la partie » doit rester identique.
- Commits sur `main`, chemins explicites (jamais `git add .`) ; les pages de test locales (`src/pages/*Test*`, `GalleryPage`, `SpectateAuditPage`) et les routes DEV de `src/App.tsx` ne se committent pas. Ne pousser que sur demande (« pousse »).

## Review Focus

1. **Ami en attente ou ancien ami** : une demande `pending`, ou une amitié supprimée, ne donne aucun droit de lecture (Tâche 1).
2. **Fuite de secrets** : un ami lit `matches.state` mais jamais `match_secrets` ni `match_server_state` (Tâche 1) ; aucun secret du jeu n'apparaît à l'écran du spectateur (Tâche 4).
3. **Partie qui se termine / amitié retirée pendant qu'on regarde** : l'écran passe aux résultats ou à « Partie introuvable » avec retour à `/amis`, sans plantage (Tâche 2).
4. **Aucune action ne part** d'un spectateur, même les minuteurs (`tick`) et même sur un clic de bouton de jeu (Tâches 2 et 4).
5. **Un écran de jeu qui ne supporte pas `secret = null` / un `meId` étranger** : aucun plantage, aucune erreur console sur les 20 jeux (Tâche 4).

## File Structure

| Fichier | Rôle |
|---|---|
| `supabase/features/spectateur.sql` (créer) | `can_watch_match`, politique `matches_select` élargie, `friends_playing` |
| `tools/sql-tests/boot.mjs` (créer), `spectateur.mjs` (créer), `pronos.mjs` (modifier) | Bootstrap PGlite partagé ; scénarios SQL du spectateur |
| `src/features/spectate/useSpectator.ts`, `SpectatorBanner.tsx`, `api.ts` (créer) | Critère de spectateur, bandeau, hook `useFriendsPlaying` |
| `src/pages/MatchPage.tsx` (modifier) | Mode spectateur et spectateur extérieur |
| `src/features/soiree/hooks.ts` (modifier) | `MatchHead.player_ids` (qui joue la partie courante) |
| `src/pages/SoireePage.tsx` (modifier) | Bouton « 👀 Regarder la partie » |
| `src/pages/FriendsPage.tsx` (modifier) | Ligne cliquable vers le profil + œil 👀 |
| `tools/sql-tests/game-states.mjs` (créer), `src/pages/SpectateAuditPage.tsx` (créer, local), `src/games/*/Play.tsx` (corrections au besoin) | Audit des 20 jeux en lecture seule |
| `docs/ARCHITECTURE.md` (modifier) | Section « Mode spectateur » |

---

### Task 1 : Lecture des parties par les amis (serveur)

**Files:**
- Create: `supabase/features/spectateur.sql`, `tools/sql-tests/boot.mjs`, `tools/sql-tests/spectateur.mjs`
- Modify: `tools/sql-tests/pronos.mjs` (utiliser `boot.mjs`), `.gitignore` (ligne `tools/sql-tests/out/`)

**Interfaces:**
- Produces (SQL, `security definer`) :
  - `can_watch_match(p_match_id uuid) returns boolean` (stable) : vrai si l'appelant est membre de la soirée de la partie (`is_soiree_member`), **ou** ami accepté (`friendships.status = 'accepted'`, dans les deux sens) d'au moins un joueur de `state->'players'` ou de l'hôte de la soirée.
  - Politique `matches_select` (remplacée par `drop policy if exists` + `create policy`) : `using (public.is_soiree_member(soiree_id) or public.can_watch_match(id))`.
  - `friends_playing() returns jsonb` (grant `authenticated`) : `[{ "profile_id", "match_id", "soiree_id", "game_id" }]` — un élément par ami accepté qui figure dans `state->'players'` d'une partie `status = 'playing'` (la plus récente si plusieurs) ; `[]` si aucun.
- Produces (test) : `boot.mjs` exporte `async function bootDb(installSqlPath: string): Promise<PGlite>` (rôles `anon`/`authenticated`/`service_role`, schéma `auth` avec `auth.uid()` lue dans `current_setting('app.uid')`, faux `net.http_post`, `pgcrypto`, chargement de `install.sql` fichier par fichier en 2 passes puis rejeu d'idempotence — le code actuellement en tête de `pronos.mjs`).

- [ ] **Step 1 : Extraire `boot.mjs` et refaire passer `pronos.mjs`.** Déplacer le bootstrap (début de `pronos.mjs`) dans `boot.mjs` ; `pronos.mjs` fait `const db = await bootDb(file)`. Run : `node tools/sql-tests/pronos.mjs supabase/install.sql` → Expected : `Tout est OK`, 35 `OK`.
- [ ] **Step 2 : Écrire `tools/sql-tests/spectateur.mjs` (échoue tant que `spectateur.sql` n'existe pas).** Profils A, B (même soirée), C (ami de B), D (ami de l'hôte A), E (inconnu), F (demande d'ami seulement `pending` envers B). Une partie `qui-de-nous` en cours (options minimales : `{"questions":["Q1","Q2"],"rounds":1}`). Assertions :
  - `can_watch_match` : vrai pour A (hôte), B (joueur), C (ami d'un joueur), D (ami de l'hôte) ; faux pour E et pour F (`pending`) ;
  - amitié supprimée (`delete from friendships`) → C ne peut plus ;
  - lecture directe `select … from matches where id = $1` : 1 ligne pour C, 0 ligne pour E ;
  - `select … from match_secrets` et `match_server_state` : 0 ligne pour C ;
  - `friends_playing` côté C : une ligne `{profile_id: B, match_id, soiree_id, game_id: 'qui-de-nous'}` (et une par ami en partie, pas de doublon) ; côté E : `[]` ;
  - après `game_action … abort` (partie `finished`) : `friends_playing` côté C = `[]` et `can_watch_match` reste vrai pour un membre.
  Chaque assertion affiche `OK`/`ÉCHEC` ; sortie code 1 au premier échec. Les lectures « comme le joueur X » se font en `set role authenticated` + `set_config('app.uid', …)` pour que la RLS s'applique (les requêtes `matches`/`match_secrets` directes en superuser la contourneraient).
- [ ] **Step 3 : Run** `node tools/sql-tests/spectateur.mjs supabase/install.sql` → Expected : échec « function can_watch_match does not exist ».
- [ ] **Step 4 : Créer `supabase/features/spectateur.sql`** avec les trois éléments ci-dessus (en-tête de commentaire : contrats, erreurs, confidentialité « tout ami accepté »). Idempotent, `revoke … from public, anon` puis `grant execute … to authenticated`.
- [ ] **Step 5 : `npm run sql`, puis relancer** `spectateur.mjs` et `pronos.mjs` → Expected : tout `OK`, rejeu d'idempotence sans erreur.
- [ ] **Step 6 : Commit.** `git add supabase/features/spectateur.sql supabase/install.sql tools/sql-tests/boot.mjs tools/sql-tests/spectateur.mjs tools/sql-tests/pronos.mjs .gitignore` ; `git commit -m "Spectateur : lecture des parties par les amis (can_watch_match, friends_playing)"`.

---

### Task 2 : Écran de partie en lecture seule (mécanisme commun)

**Files:**
- Create: `src/features/spectate/useSpectator.ts`, `src/features/spectate/SpectatorBanner.tsx`
- Modify: `src/pages/MatchPage.tsx`

**Interfaces:**
- Produces :
  - `useSpectator(state: BaseGameState | undefined, meId: string, isHost: boolean): boolean` — `true` si `state` est défini, `!isHost` et `!(state.players ?? []).includes(meId)` (`BaseGameState.players: string[]` ; si le champ manque, `false` par prudence).
  - `readOnlyAct: (a: GameActionPayload) => Promise<BaseGameState | null>` exporté de `useSpectator.ts` — renvoie toujours `Promise.resolve(null)` (aucune action, aucun toast).
  - `SpectatorBanner({ onBack, backLabel }: { onBack: () => void; backLabel: string })` — bandeau fixe en haut de la page : « 👀 Tu regardes — tu joues à la prochaine ! » + bouton retour (≥ 44 px).
- Consumes : `useMatch`, `useSoiree` (renvoie `{ data, loading, notFound }`), `BaseGameState`, `GameActionPayload`.
- Comportement dans `MatchPage` :
  - `spectator = useSpectator(state, meId, isHost)` ; si vrai : `act` passé à `Play` = `readOnlyAct`, `secret = null`, `isHost = false`, bandeau affiché, boutons « Annuler la partie » / retour-salon d'origine masqués au profit du bandeau.
  - **Spectateur extérieur** : si `useSoiree` renvoie `notFound` (RLS) alors que la partie est lisible, `soireeData` est ignoré : pas de `useViewingSoiree`, pas de `useCurrentMatch` (liens vers le salon masqués), `backLabel = 'Mes amis'`, retour vers `/amis`.
  - Partie illisible (amitié retirée, partie supprimée) : l'écran « Partie introuvable » existant avec bouton de retour (vers `/amis` pour un extérieur, `/` sinon).
  - Fin de partie / annulation : écrans existants inchangés (`ResultsScreen`, « Partie annulée »).

- [ ] **Step 1 : Fixer les critères** (pas de framework de test front ; vérifiés à la Tâche 4 via la page d'audit et ici par `tsc`/`eslint`) : pour un état dont `players` ne contient pas `meId` → `useSpectator` vrai ; avec `isHost` vrai → faux ; sans `players` → faux ; `readOnlyAct({type:'tick'})` résout `null` sans appeler le réseau.
- [ ] **Step 2 : Implémenter** `useSpectator.ts`, `SpectatorBanner.tsx` et les changements de `MatchPage.tsx` (aucun changement de comportement pour un joueur ou l'hôte).
- [ ] **Step 3 : Vérifier** `npx tsc -b` et `npx eslint src/features/spectate src/pages/MatchPage.tsx` → Expected : aucune erreur.
- [ ] **Step 4 : Commit.** `git add src/features/spectate src/pages/MatchPage.tsx` ; `git commit -m "Spectateur : écran de partie en lecture seule (bandeau, actions bloquées, spectateur extérieur)"`.

---

### Task 3 : Les entrées — salon, liste d'amis, profil

**Files:**
- Create: `src/features/spectate/api.ts`
- Modify: `src/features/soiree/hooks.ts` (`MatchHead`, `useCurrentMatch`), `src/pages/SoireePage.tsx`, `src/pages/FriendsPage.tsx`

**Interfaces:**
- Produces :
  - `MatchHead.player_ids: string[]` (ajouté à l'interface existante `{ id, game_id, status, created_at }`) ; `useCurrentMatch` lit `state` en plus (`select('id, game_id, status, created_at, state')` et, dans le handler Realtime, `row.state`) et en tire `player_ids = state.players ?? []`.
  - `FriendPlaying { profile_id: string; match_id: string; soiree_id: string; game_id: string }` et `useFriendsPlaying(): { playing: Record<string, FriendPlaying>; ready: boolean }` (clé = `profile_id` de l'ami) — RPC `friends_playing` via `loose`, relue au retour au premier plan (`useResync`) et sur `postgres_changes` de `matches` (INSERT/UPDATE).
- Consumes : `loose` (`hostTools.ts`), `useResync`, `getGame(id).emoji`.
- Comportement :
  - **Salon** (`SoireePage`, bouton existant « Rejoindre la partie en cours ») : si `match.player_ids` ne contient pas `meId` et que je ne suis pas hôte → libellé « 👀 Regarder la partie » et, dessous, « Tu joueras à la suivante » ; sinon texte inchangé.
  - **Liste d'amis** (`PersonRow` de `FriendsPage`) : toute la zone avatar + noms devient un `Link` vers `/profil/${p.id}` ; dans « Mes amis », si `playing[p.id]` existe, un bouton œil 👀 (`aria-label` « Regarder la partie de {nickname} », cible ≥ 44 px, emoji du jeu en pastille) navigue vers `/partie/${match_id}` ; les lignes des autres sections (demandes, ajout) ouvrent aussi le profil.

- [ ] **Step 1 : Implémenter** `api.ts`, l'extension de `MatchHead`/`useCurrentMatch`, le bouton du salon, la ligne cliquable et l'œil. Aucune modification des props de `PersonRow` autres que l'ajout de la zone cliquable et d'un slot pour l'œil.
- [ ] **Step 2 : Vérifier** `npx tsc -b`, `npx eslint src/pages src/features/spectate src/features/soiree`.
- [ ] **Step 3 : Page locale de test non commitée** `src/pages/SpectateAuditPage.tsx` (route DEV `/spectate-audit`, ajoutée à `src/App.tsx` en local seulement) : ajouter une section « Liste d'amis » qui rend des lignes `PersonRow`-équivalentes avec de fausses données (`useFriendsPlaying` simulé par `loose.rpc` remplacé, comme dans `PronosTestPage`). Capture mobile 390×844 : ligne cliquable, œil visible seulement pour l'ami en partie, cible ≥ 44 px, pas de défilement horizontal, thèmes clair et sombre.
- [ ] **Step 4 : Commit.** `git add src/features/spectate/api.ts src/features/soiree/hooks.ts src/pages/SoireePage.tsx src/pages/FriendsPage.tsx` ; `git commit -m "Spectateur : bouton Regarder la partie, œil dans la liste d'amis, ligne ami vers le profil"`.

---

### Task 4 : Audit et correction des 20 jeux en lecture seule

**Files:**
- Create: `tools/sql-tests/game-states.mjs`, `src/pages/SpectateAuditPage.tsx` (local, non commité)
- Modify: `src/games/<id>/Play.tsx` (seulement les jeux qui plantent), `.gitignore` si besoin

**Interfaces:**
- Produces : `tools/sql-tests/game-states.mjs <install.sql>` écrit `tools/sql-tests/out/states.json` : `{ "<game_id>": { "state": {…}, "players": [uuid…], "options": {…} } }` pour les 20 jeux, généré par `game_<id_underscore>_start(players uuid[], options jsonb)` sur `install.sql` (PGlite). Sonde faite : 9 jeux démarrent avec `{}` (bataille-navale, bowling, dede-kart, menteur, morpion, pas-de-bol, quatre-a-la-suite, tour-des-potes) ; les autres exigent des options (`questions`, `words`, `cards`, `dilemmas`, `categories`, `syllables`, `pair`) ou plus de joueurs (`loup-garou`, `undercover`, `dessine-devine`, `devine-en-equipe` : 6 joueurs) — l'implémentation inspire ses options de `src/games/<id>/setup.ts`/`defaultOptions` et itère jusqu'à obtenir les 20 états.
- Page d'audit : `SpectateAuditPage` lit `?game=<id>`, importe `tools/sql-tests/out/states.json` (import JSON Vite), rend `getGame(id).Play` avec `meId` = un uuid étranger absent de `state.players`, `secret = null`, `isHost = false`, `pending = false`, `players` = annuaire des profils (CHARACTERS) et `act` = espion (`window.__acts.push(action)`, renvoie `null`), plus le `SpectatorBanner`.
- Script de capture (hors dépôt, scratchpad) : pour chaque jeu, Chrome 390×844 → `/spectate-audit?game=<id>` ; relève erreurs console/`pageerror`, clique sur tous les `button:not([disabled])` visibles du jeu, lit `window.__acts` ; capture d'écran.

- [ ] **Step 1 : Écrire `game-states.mjs`** et le lancer : `node tools/sql-tests/game-states.mjs supabase/install.sql` → Expected : `20/20 jeux`, fichier écrit (ignoré par git).
- [ ] **Step 2 : Créer la page d'audit locale et le script de capture**, lancer l'audit sur les 20 jeux. Critères de réussite par jeu : (a) aucune `pageerror`, aucune `console.error` ; (b) `window.__acts` vide à l'affichage puis après avoir cliqué tous les boutons actifs : `act` est un espion et **tout appel est un échec**, y compris `tick` (en vrai, `readOnlyAct` de `MatchPage` les supprime ; ici on vérifie que l'écran du jeu ne dépend pas d'un `act` pour s'afficher et que ses boutons ne partent pas à vide) ; (c) aucune donnée secrète visible (mains de cartes, rôles, mot à dessiner, grille cachée) ; (d) l'écran affiche le plateau/score/état public et un message cohérent pour un non-joueur.
- [ ] **Step 3 : Corriger jeu par jeu** chaque échec de l'audit dans le `Play.tsx` concerné (cas typiques : `secret.xxx` lu sans garde, `players.find(meId)` supposé non nul, boutons d'action rendus actifs pour un non-joueur) — un commit par jeu corrigé : `git add src/games/<id>` ; `git commit -m "Spectateur : <jeu> s'affiche en lecture seule"`. Relancer l'audit du jeu après chaque correction jusqu'au vert.
- [ ] **Step 4 : Rapport d'audit** : tableau final 20 lignes (jeu · OK/corrigé · note) collé dans le message de fin ; captures conservées dans le scratchpad.
- [ ] **Step 5 : Vérifier** `npm run build` et `npm run lint` → Expected : sans erreur (les avertissements de pages de test locales sont connus).

---

### Task 5 : Documentation et vérification finale

**Files:**
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1 : Documentation** : section « Mode spectateur » (critère `state.players`, `readOnlyAct`, `can_watch_match` + politique `matches_select`, `friends_playing`, entrées salon/amis, spectateur extérieur en lecture seule, confidentialité sans interrupteur, audit des 20 jeux).
- [ ] **Step 2 : Vérification** : `npm run sql` (aucun diff), `node tools/sql-tests/pronos.mjs supabase/install.sql` et `node tools/sql-tests/spectateur.mjs supabase/install.sql` → tout `OK` ; `npm run build`, `npm run lint` sans erreur.
- [ ] **Step 3 : Relecture du diff** (`git diff origin/main...HEAD --stat`) : aucun `src/types/db.ts`, aucune page de test, aucun `src/App.tsx` ; seuls les `Play.tsx` corrigés par l'audit touchent `src/games/`.
- [ ] **Step 4 : Commit** `git add docs/ARCHITECTURE.md` ; `git commit -m "Spectateur : documentation"`. Message à l'utilisateur : SQL à coller (`supabase/install.sql`) puis « pousse » ; rappeler la confidentialité (tout ami accepté peut regarder).

---

## Auto-revue

- **Couverture de la spec :** qui est spectateur et écran lecture seule (T2) ; entrées salon et amis, ligne vers le profil (T3) ; serveur `can_watch_match`, `matches_select`, `friends_playing` (T1) ; spectateur extérieur sans chat/pronos/salon (T2) ; cas particuliers fin de partie / amitié retirée (T2) ; audit des 20 jeux avec états réels (T4) ; hors périmètre respecté ; points à confirmer : interrupteur refusé (contrainte globale), lancement qui emmène les non-joueurs en spectateurs conservé par défaut (T2/T3 n'y touchent pas : `LaunchCountdown` existant les emmène sur `/partie/:id`).
- **Cohérence des noms :** `can_watch_match`, `friends_playing`, `useSpectator`, `readOnlyAct`, `SpectatorBanner`, `useFriendsPlaying`, `FriendPlaying`, `MatchHead.player_ids` identiques entre tâches.
- **Écart avec la spec :** `readOnlyAct` de la spec s'appelle ainsi mais diffère de celui du mode télé (`src/features/duel/tv.ts`, qui laisse passer les `tick`) : le nouveau n'envoie rien du tout, car le serveur refuse les `tick` d'un non-joueur — le mode télé conserve son comportement.
- **Proportion :** 5 tâches courtes ; signatures, assertions et critères seulement, pas de corps de fonction.
