# Nom de Code — étape 1 (jeu sur téléphones) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer le jeu n°21 « Nom de Code » jouable sur téléphones (2 à 4 équipes + banc, indice tapé, majorité d'équipe, bombe, manches, chrono), avec sa tenue Hacker et ses 11 trophées.

**Architecture:** Moteur serveur autoritaire `supabase/games/nom-de-code.sql` (start + action, state public, clé secrète dans `server` et `match_secrets` des seuls espions), testé en PGlite. Module front `src/games/nom-de-code/` sur les conventions des 20 jeux (auto-découvert par le registre), plus un sélecteur d'équipes réutilisable `src/features/teams/`.

**Tech Stack:** PostgreSQL plpgsql (RPC `security definer`), PGlite pour les tests, React 19 + TypeScript + Tailwind 4 + framer-motion.

**Spec:** `docs/superpowers/specs/2026-11-19-nom-de-code-design.md` (étapes 2 « télé » et 3 « vidéo tuto » : hors de ce plan).

## Global Constraints

- Français uniquement, tout public ; UX ultra simple, gros boutons, lisible sur mobile ; style « sticker book » (contours épais, `box-shadow: 4px 4px 0 <ink>`), thème clair + sombre.
- Pas d'Edge Function : toute la logique serveur en SQL `security definer`, fichier idempotent terminé par les `revoke`.
- Minuteurs : `deadline` ISO dans le state + action `{"type":"tick"}` idempotente ; front `useCountdown` (`@/features/soiree/useServerClock`).
- Nouveaux codes d'erreur dans `src/features/soiree/errors.ts`. Ne pas toucher `src/types/db.ts` ; types du jeu dans `src/games/nom-de-code/types.ts`.
- Après toute modif SQL : `npm run sql` (régénère `supabase/install.sql`), et rappeler à l'utilisateur de le recoller dans le SQL Editor Supabase.
- Commits directement sur `main` (message terminé par la ligne `Co-Authored-By` de la session), chemins explicites (`git add <fichiers>`) : ne jamais committer `src/App.tsx` ni les pages de test locales `src/pages/*Test*.tsx`, `GalleryPage.tsx`, `SpectateAuditPage.tsx`. Pousser seulement quand l'utilisateur dit « pousse ».
- Valeurs fixées par la spec : 4 à 9 joueurs ; 2 à 4 équipes (`red`, `blue`, `green`, `yellow`, dans cet ordre de jeu), 2 joueurs min. par équipe ; grille 25 mots ; répartition 2 équipes 9/8 + 7 neutres + 1 bombe, 3 équipes 7/6/6 + 5 + 1, 4 équipes 6/5/5/5 + 3 + 1 ; indice = 1 mot (≤ 24 caractères) + nombre 1-9 ; essais = n + 1 ; majorité = `floor(devineurs / 2) + 1` ; chrono Détendu (aucun) / Normal 120 s indice + 180 s devinettes (défaut) / Rapide 60 s + 120 s ; manches `one` (défaut) ou `each` (= taille de la plus grande équipe) ; tenue `hacker` 💻 débloquée à 10 victoires.

## Review Focus

1. **Devineur absent en mode Détendu** (téléphone éteint) : la majorité n'est jamais atteinte → l'hôte doit pouvoir faire avancer la partie. Action hôte `skip` (indice → équipe suivante ; devinettes → fin du tour). Test : Task 2 « skip ».
2. **Deux devineurs touchent le même mot au même instant** : un seul dévoilement, compteurs non doublés ; un vote arrivant sur une carte déjà dévoilée est ignoré sans erreur (pas de toast d'erreur pour une course normale). Test : Task 2 « vote sur carte dévoilée ».
3. **Indice qui ressemble à un mot de la grille** à la casse / aux accents près (« ÉLÉPHANT » vs `éléphant`, « Elephant ») → refusé ; un mot à tiret (« arc-en-ciel ») = un seul mot, accepté s'il n'est pas dans la grille ; un mot de la grille déjà dévoilé redevient autorisé. Test : Task 2 « indices ».
4. **Équipe éliminée par la bombe** dont les mots sont ensuite tous dévoilés par d'autres → elle ne gagne pas ; les tours sautent les équipes éliminées. Test : Task 2 « élimination ».
5. **Joueur du banc ou espion qui vote** (ou un ancien espion qui garde un vieux secret) → refusé (`not_guesser`) ; un ancien espion reçoit `{round, key: null}` à la manche suivante. Test : Task 2 « rôles » et Task 3 « rotation ».

---

## File Structure

| Fichier | Rôle |
|---|---|
| Create `supabase/games/nom-de-code.sql` | Moteur : `game_nom_de_code_start`, `game_nom_de_code_action`, helpers `_ndc_*` |
| Create `tools/sql-tests/nom-de-code.mjs` | Tests PGlite du moteur (même harnais que `petit-bac.mjs`) |
| Modify `tools/sql-tests/game-states.mjs` | Options de démarrage de `nom-de-code` pour l'audit spectateur |
| Modify `supabase/features/tenues.sql`, `supabase/features/trophees.sql` | Tenue `hacker` + 11 trophées `ndc_*` |
| Create `src/features/teams/teams.ts`, `src/features/teams/TeamsPicker.tsx` | Couleurs d'équipe partagées + sélecteur 2-4 équipes + banc |
| Create `src/games/nom-de-code/{types,logic,setup,words}.ts` | Types, règles pures (normalisation, majorité, indice), actions, options, pioche |
| Create `src/games/nom-de-code/{index.ts,Options.tsx,Play.tsx,Grid.tsx,CluePanel.tsx,RoundEnd.tsx,Summary.tsx}` | Définition du jeu et écrans |
| Modify `src/features/soiree/errors.ts`, `src/data/tenues.ts` | Codes d'erreur, tenue Hacker |
| Modify `docs/ARCHITECTURE.md`, `docs/TROPHEES.md`, `CLAUDE.md` | Documentation |

---

### Task 1: Moteur — démarrage, grille, espions, secrets

**Files:**
- Create: `supabase/games/nom-de-code.sql`
- Test: `tools/sql-tests/nom-de-code.mjs`
- Modify: `tools/sql-tests/game-states.mjs` (entrée `OPTIONS['nom-de-code']`)

**Interfaces:**
- Produces (SQL) : `public.game_nom_de_code_start(p_players uuid[], p_options jsonb) returns jsonb` → `{state, server, secrets}`.
- Options attendues : `{ teams: {red?: uuid[], blue?: uuid[], green?: uuid[], yellow?: uuid[]}, rounds: 'one'|'each', timer: 'relaxed'|'normal'|'fast', words: text[] }` (`words` : au moins `25 × total_rounds` mots, chaque grille de 25 sans doublon après `_normalize_word`).
- Produces (state public, contrat pour toutes les tâches suivantes) :
  ```
  phase: 'clue' | 'guess' | 'round_end' | 'finished'
  players: uuid[]            -- membres d'équipe uniquement (ordre des équipes) ; jamais le banc
  bench: uuid[]              -- p_players qui ne sont dans aucune équipe
  round: int, total_rounds: int, rounds: 'one'|'each', timer: 'relaxed'|'normal'|'fast'
  deadline: timestamptz|null -- null en Détendu et hors phases clue/guess
  words: text[25]
  teams: [{ id: 'red'|'blue'|'green'|'yellow', players: uuid[], spy: uuid, found: int, total: int, eliminated: bool }]
                             -- ordre fixe red, blue, green, yellow (équipes présentes)
  turn: team id              -- équipe active
  revealed: { "<index 0..24>": { color: cell, by: team id } }   -- cell = team id | 'neutral' | 'bomb'
  clue: { word: text, n: int } | null
  guesses_left: int, votes: { "<player>": index }, stop: uuid[], turn_found: int
  round_wins: { "<team>": int }, round_winner: team id | null, round_end_reason: 'words'|'bomb'|'last_team'|null
  key: cell[25] | null       -- public uniquement en round_end / finished
  ```
- Produces (server) : `{ key: cell[25], spy_order: {team: uuid[]}, first: {index: uuid}, stats: {player: {bomb_votes, idle_clue, enemy_reveals, first_good, best_clue, spy_wins, flawless, comeback}}, team_err: {team: int}, max_deficit: {team: int}, words_all: text[] }`.
- Produces (secrets) : `{ "<spy>": { round: int, key: cell[25] } }` pour les seuls espions.
- Produces : `public._ndc_recent_spies(p_players uuid[]) returns uuid[]` — espions de la dernière partie `nom-de-code` terminée depuis moins de 12 h qui partage au moins 2 joueurs avec `p_players`.

- [ ] **Step 1: Écrire le test (partie démarrage) dans `tools/sql-tests/nom-de-code.mjs`**

Même harnais que `petit-bac.mjs` (`bootDb`, `ok(name, cond, extra)`, appel direct des fonctions en superutilisateur). Profils : 9 premiers `public.profiles` par `sort_order`. Helper `start(teams, extra = {})` qui construit les options avec `words` = 125 mots distincts `mot0`…`mot124`. Assertions :
```js
// 2 équipes 5 + 4 → 9/8/7/1, l'équipe qui commence a 9 mots et joue en premier
const s2 = (await start({ red: P.slice(0, 5), blue: P.slice(5, 9) })).r
const k2 = s2.server.key
ok('2 équipes : 9/8 + 7 neutres + 1 bombe', [count(k2, s2.state.turn), count(k2, other(s2.state.turn))].join() === '9,8'
   && count(k2, 'neutral') === 7 && count(k2, 'bomb') === 1)
ok('équipe qui commence = 9 mots', s2.state.teams.find((t) => t.id === s2.state.turn).total === 9)
ok('3 équipes : 7/6/6 + 5 + 1', sorted(totals(s3)).join() === '6,6,7' && count(s3.server.key, 'neutral') === 5)
ok('4 équipes : 6/5/5/5 + 3 + 1', sorted(totals(s4)).join() === '5,5,5,6' && count(s4.server.key, 'neutral') === 3)
ok('phase clue, aucune carte dévoilée, key absente du state', s2.state.phase === 'clue' && Object.keys(s2.state.revealed).length === 0 && s2.state.key === null)
ok('secrets = exactement les espions', sameSet(Object.keys(s2.secrets), s2.state.teams.map((t) => t.spy)))
ok('secret d\'espion = {round: 1, key}', s2.secrets[s2.state.teams[0].spy].round === 1 && s2.secrets[s2.state.teams[0].spy].key.length === 25)
ok('banc : joueur hors équipe ni dans players ni dans les secrets', /* start avec 8 joueurs en équipes sur 9 */ bench.state.bench.length === 1 && !bench.state.players.includes(bench.state.bench[0]))
ok('rounds each : total_rounds = taille de la plus grande équipe', (await start({ red: P.slice(0, 5), blue: P.slice(5, 9) }, { rounds: 'each' })).r.state.total_rounds === 5)
ok('timer normal : deadline ≈ maintenant + 120 s', approxSeconds(s2.state.deadline, 120))
ok('timer relaxed : deadline null', (await start(T2, { timer: 'relaxed' })).r.state.deadline === null)
// refus
ok('1 seule équipe → invalid_teams', (await start({ red: P.slice(0, 4) })).err === 'invalid_teams')
ok('équipe d\'1 joueur → invalid_teams', (await start({ red: P.slice(0, 3), blue: [P[3]] })).err === 'invalid_teams')
ok('joueur dans 2 équipes → invalid_teams', (await start({ red: [P[0], P[1]], blue: [P[1], P[2]] })).err === 'invalid_teams')
ok('membre d\'équipe hors p_players → invalid_teams', /* p_players sans P[8] */ err === 'invalid_teams')
ok('moins de 25 mots → invalid_action', (await start(T2, { words: ['a', 'b'] })).err === 'invalid_action')
```
Test `_ndc_recent_spies` : insérer une partie `nom-de-code` terminée (`matches` status `finished`, `finished_at = now() - interval '1 hour'`, `state.teams[].spy`) puis vérifier que `start` ne choisit pas ces espions quand une autre option existe (lancer 10 démarrages : aucun ne reprend l'ancien espion de l'équipe rouge à 4 joueurs).

- [ ] **Step 2: Lancer le test — doit échouer**

Run: `cd tools/sql-tests && node nom-de-code.mjs ../../supabase/install.sql`
Expected: ÉCHEC — `function public.game_nom_de_code_start(uuid[], jsonb) does not exist`.

- [ ] **Step 3: Implémenter `game_nom_de_code_start` et `_ndc_recent_spies` dans `supabase/games/nom-de-code.sql`**

En-tête du fichier sur le modèle de `petit-bac.sql` (phases, où sont les secrets). Tirages avec `random()` : équipe qui commence, positions des couleurs (mélange de 25 cases), ordre de rotation des espions par équipe (`spy_order[team]` mélangé, les espions récents placés en fin de liste). Espion de la manche 1 = `spy_order[team][1]`. Validation des équipes → `invalid_teams`. Grille de la manche r = `words[25(r-1)+1 .. 25r]`. Terminer par les `revoke all … from public, anon, authenticated` des fonctions `_ndc_*`.

- [ ] **Step 4: Régénérer et relancer**

Run: `npm run sql && cd tools/sql-tests && node nom-de-code.mjs ../../supabase/install.sql`
Expected: toutes les lignes `OK`, `Tout est OK`.

- [ ] **Step 5: Ajouter l'entrée `OPTIONS['nom-de-code']` dans `game-states.mjs`** (`teams: {red: ids 0-2, blue: ids 3-5}`, `words: 25 mots`, `rounds: 'one'`, `timer: 'normal'`), lancer `node game-states.mjs ../../supabase/install.sql` → ligne `OK nom-de-code phase=clue`.

- [ ] **Step 6: Commit**

```bash
git add supabase/games/nom-de-code.sql supabase/install.sql tools/sql-tests/nom-de-code.mjs tools/sql-tests/game-states.mjs
git commit -m "Nom de Code : moteur — démarrage, grille, espions, secrets (+ tests)"
```

---

### Task 2: Moteur — indices, votes, dévoilements, stop, chrono, élimination

**Files:**
- Modify: `supabase/games/nom-de-code.sql`
- Test: `tools/sql-tests/nom-de-code.mjs`

**Interfaces:**
- Consumes: state/server/secrets de Task 1.
- Produces (SQL) : `public.game_nom_de_code_action(p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb) returns jsonb` → `{state, server, secrets?, results?}`.
- Actions : `{type:'clue', word, n}` · `{type:'vote', index: int|null}` · `{type:'stop'}` (bascule) · `{type:'tick'}` · `{type:'skip'}` (hôte) · `{type:'next_round'}` (hôte, Task 3).
- Codes d'erreur : `wrong_phase`, `not_spy`, `not_guesser`, `invalid_clue`, `clue_is_grid_word`, `stop_too_early`, `not_host`, `invalid_action`, `unknown_action`.

Règles à implémenter (spec §2) :
- `clue` : espion de `turn`, phase `clue`. Mot nettoyé (`btrim`), refus `invalid_clue` si vide, contient un espace, > 24 caractères, ou `n` hors 1-9 ; refus `clue_is_grid_word` si `_normalize_word(word)` = `_normalize_word` d'un mot **non dévoilé**. Succès : `clue`, `guesses_left = n + 1`, `turn_found = 0`, `votes = {}`, `stop = []`, phase `guess`, `deadline` = devinettes.
- `vote` : devineur (membre de `turn` sauf l'espion), phase `guess`, sinon `not_guesser` / `wrong_phase`. `index` null → retire la tête. Index déjà dévoilé → **state inchangé, sans erreur**. Sinon `votes[actor] = index` ; `server.first[index]` posé s'il est vide. Si le nombre de votes de l'équipe sur `index` ≥ `floor(g/2)+1` (g = devineurs de l'équipe) → dévoilement.
- Dévoilement de la case `i` (couleur `c = server.key[i]`) : `revealed[i] = {color: c, by: turn}` ; compteurs (voir Task 3) ; puis selon `c` :
  équipe active → `found+1`, `turn_found+1`, `guesses_left-1` ; autre équipe → `found+1` de cette équipe, `team_err[turn]+1`, fin du tour ; neutre → `team_err[turn]+1`, fin du tour ; bombe → `team_err[turn]+1`, équipe active `eliminated = true`.
  Ensuite, dans l'ordre : (a) une équipe **non éliminée** avec `found = total` → elle gagne la manche (`round_end_reason 'words'`) ; (b) une seule équipe non éliminée → elle gagne (`'bomb'` à 2 équipes, `'last_team'` sinon) ; (c) bombe à 3-4 équipes → fin du tour ; (d) `guesses_left = 0` → fin du tour. Après tout dévoilement : `votes = {}`, `stop = []`, `server.first = {}`.
- Fin du tour : `turn` = équipe suivante non éliminée dans l'ordre red→blue→green→yellow (circulaire), phase `clue`, `clue = null`, `deadline` = indice.
- `stop` : devineur, phase `guess` ; `turn_found = 0` et aucun dévoilement dans le tour → `stop_too_early` ; bascule l'acteur dans `stop` ; `|stop| ≥ floor(g/2)+1` → fin du tour.
- `tick` (idempotent) : phase `clue` et `now() ≥ deadline` → `idle_clue+1` pour l'espion, fin du tour ; phase `guess` et échéance passée → fin du tour ; sinon inchangé. Détendu (`deadline` null) : jamais.
- `skip` : hôte seulement (`not_host`) ; phase `clue` → fin du tour (sans `idle_clue`) ; phase `guess` → fin du tour ; autre phase → `wrong_phase`.
- Fin de manche (appelée par (a)/(b)) : `round_winner`, `round_wins[winner]+1`, `round_end_reason`, `key = server.key` (public), phase `round_end`, `deadline = null`. Si c'était la dernière manche : enchaîne sur la fin de partie (Task 3).

- [ ] **Step 1: Ajouter les tests (section « tours ») à `nom-de-code.mjs`**

Helper `act(st, actor, isHost, action)` → `{r}` ou `{err}` ; helpers `spyOf(st, team)`, `guessers(st, team)`, `idxOf(st, color, k)` (k-ième case de cette couleur d'après `server.key`). Partie de référence : équipes rouge 3 (1 espion + 2 devineurs → majorité 2) et bleue 3. Assertions :
```js
// indices
ok('indice vide → invalid_clue', (await act(S, spy, false, { type: 'clue', word: '  ', n: 1 })).err === 'invalid_clue')
ok('deux mots → invalid_clue', (await act(S, spy, false, { type: 'clue', word: 'gros chat', n: 2 })).err === 'invalid_clue')
ok('n = 0 ou 10 → invalid_clue', e0 === 'invalid_clue' && e10 === 'invalid_clue')
ok('mot de la grille à la casse/accent près → clue_is_grid_word', (await act(S, spy, false, { type: 'clue', word: S.state.words[3].toUpperCase(), n: 1 })).err === 'clue_is_grid_word')
ok('mot à tiret hors grille accepté', (await act(S, spy, false, { type: 'clue', word: 'arc-en-ciel', n: 2 })).r.state.phase === 'guess')
ok('mot de la grille déjà dévoilé → accepté', okAfterReveal)
ok('devineur qui donne l\'indice → not_spy', e === 'not_spy')
// rôles
ok('espion qui vote → not_guesser', e1 === 'not_guesser')
ok('joueur du banc qui vote → not_guesser', e2 === 'not_guesser')
ok('adversaire qui vote → not_guesser', e3 === 'not_guesser')
// majorité
ok('1 tête sur 2 devineurs : pas de dévoilement', Object.keys(v1.state.revealed).length === 0 && v1.state.votes[g1] === i)
ok('2e tête : dévoilé, votes vidés', v2.state.revealed[i].color === 'red' && Object.keys(v2.state.votes).length === 0)
ok('retirer sa tête (index null)', !(i in vNull.state.votes))
ok('déplacer sa tête', vMove.state.votes[g1] === j)
ok('équipe d\'1 devineur : dévoilement immédiat', soloReveal)
ok('vote sur carte dévoilée : ignoré sans erreur', vDone.err === undefined && JSON.stringify(vDone.r.state.revealed) === JSON.stringify(v2.state.revealed))
// effets
ok('bon mot : found+1, guesses_left-1, toujours en guess', ...)
ok('neutre : fin du tour → bleu en phase clue', ...)
ok('mot adverse : compte pour bleu, fin du tour', ...)
ok('n + 1 essais puis fin du tour', ...)
ok('bombe à 2 équipes : bleu gagne la manche (bomb)', b.state.phase === 'round_end' || b.state.phase === 'finished')
ok('dernier mot d\'une équipe dévoilé par l\'adversaire → cette équipe gagne', ...)
// stop
ok('stop avant tout dévoilement → stop_too_early', ...)
ok('stop à la majorité → fin du tour', ...)
// chrono
ok('tick avant échéance : inchangé', ...)
ok('tick indice échu : tour suivant + idle_clue', ...)   // forcer state.deadline dans le passé
ok('tick devinettes échu : fin du tour', ...)
ok('tick rejoué : idempotent', ...)
ok('relaxed : tick ne fait rien', ...)
// skip
ok('skip par un non-hôte → not_host', ...)
ok('skip en phase clue : équipe suivante, sans idle_clue', ...)
ok('skip en phase guess : fin du tour', ...)
// élimination (3 équipes)
ok('bombe à 3 équipes : équipe éliminée, les 2 autres continuent', ...)
ok('le tour saute l\'équipe éliminée', ...)
ok('mots de l\'équipe éliminée tous dévoilés : elle ne gagne pas', ...)
ok('dernière équipe en jeu → gagne (last_team)', ...)
```

- [ ] **Step 2: Lancer — doit échouer** (`function public.game_nom_de_code_action(...) does not exist`).

Run: `cd tools/sql-tests && node nom-de-code.mjs ../../supabase/install.sql`

- [ ] **Step 3: Implémenter `game_nom_de_code_action` (sauf `next_round` et la fin de partie)** et les helpers `_ndc_end_turn(state, server)`, `_ndc_reveal(state, server, index)`, `_ndc_end_round(state, server, winner, reason)`, `_ndc_deadline(timer, phase)`, tous `jsonb → jsonb {state, server}` ; ajouter leurs `revoke`.

- [ ] **Step 4: `npm run sql` puis relancer les tests** → `Tout est OK`.

- [ ] **Step 5: Commit**

```bash
git add supabase/games/nom-de-code.sql supabase/install.sql tools/sql-tests/nom-de-code.mjs
git commit -m "Nom de Code : moteur — indices, majorité, dévoilements, stop, chrono, élimination (+ tests)"
```

---

### Task 3: Moteur — manches, fin de partie, compteurs, tenue Hacker et trophées

**Files:**
- Modify: `supabase/games/nom-de-code.sql`, `supabase/features/tenues.sql`, `supabase/features/trophees.sql`
- Test: `tools/sql-tests/nom-de-code.mjs`

**Interfaces:**
- Consumes: actions et helpers de Task 2.
- Produces : action `next_round` ; `results` de fin de partie au format `finish_match` :
  `[{profile_id, points: round_wins de son équipe, won: bool, placement: rang dense par round_wins décroissant (1 = meilleur), stats: {bomb_votes, idle_clue, enemy_reveals, first_good, best_clue, spy_wins, flawless, comeback}}]` — un élément par membre d'équipe, jamais le banc ; toutes les clés présentes (0 par défaut).
- Produces : tenue `hacker` (`tenues.sql`) et trophées `ndc_*` (`trophees.sql`).

Règles :
- `next_round` : hôte, phase `round_end`, `round < total_rounds` (sinon `wrong_phase`). Nouvelle grille (mots suivants de `server.words_all`), nouvelle clé, nouvelle équipe qui commence (tirée), espion suivant de `spy_order` de chaque équipe, toutes les équipes non éliminées, `found` / `total` / `revealed` / `team_err` / `max_deficit` remis à zéro, `key = null`, phase `clue`. `secrets` : nouveaux espions `{round, key}`, tous les autres membres `{round, key: null}`.
- Fin de partie (après la dernière manche, au lieu de `round_end`) : phase `finished`, gagnants = équipes au maximum de `round_wins` (égalité possible) → `results`.
- Compteurs (dans `server.stats`, recopiés dans `results[].stats`) :
  - `bomb_votes` : +1 pour chaque devineur dont la tête était sur la bombe au dévoilement ;
  - `enemy_reveals` : +1 pour chaque tête sur une case d'une autre équipe dévoilée ;
  - `first_good` : +1 pour `server.first[i]` quand `i` est une case de l'équipe active ;
  - `best_clue` : max, pour l'espion, de `turn_found` à chaque fin de tour (et à la fin de manche si elle survient pendant son tour) ;
  - `idle_clue` : Task 2 (tick d'indice échu) ;
  - `spy_wins` : +1 pour l'espion de l'équipe qui gagne une manche ;
  - `flawless` : +1 pour chaque membre de l'équipe qui gagne une manche avec `team_err[winner] = 0` ;
  - `comeback` : +1 pour chaque membre de l'équipe qui gagne une manche avec `max_deficit[winner] ≥ 3`, où après chaque dévoilement `deficit(team) = (total − found)(team) − min sur les équipes non éliminées de (total − found)`.
- Tenue (`tenues.sql`) : `('hacker', 'Hacker', '💻', 'nom-de-code', 'game_wins', 10, 210)`.
- Trophées (`trophees.sql`, tenue `hacker`, jeu `nom-de-code`, `active = true`, `sort_order` 2100-2110), noms et descriptions = spec §5 :

| id | slot | rule |
|---|---|---|
| `ndc_kaboum` | 2 | `{"agg":"sum","stat":"bomb_votes","threshold":1}` |
| `ndc_page_blanche` | 3 | `{"agg":"sum","stat":"idle_clue","threshold":1}` |
| `ndc_taupe` | 4 | `{"agg":"sum","stat":"enemy_reveals","threshold":3}` |
| `ndc_bon_flair` | 5 | `{"agg":"sum","stat":"first_good","threshold":10}` |
| `ndc_agent_terrain` | 6 | `{"agg":"count","threshold":10}` |
| `ndc_coup_double` | 7 | `{"agg":"max","stat":"best_clue","threshold":3}` |
| `ndc_maitre_espion` | 8 | `{"agg":"sum","stat":"spy_wins","threshold":3}` |
| `ndc_sans_faute` | 9 | `{"agg":"sum","stat":"flawless","threshold":1}` |
| `ndc_remontada` | 10 | `{"agg":"sum","stat":"comeback","threshold":1}` |
| `ndc_telepathie` | 11 | `{"agg":"max","stat":"best_clue","threshold":4}` |
| `ndc_legende` | 12 | `{"agg":"sum","stat":"won","threshold":15}` |

- [ ] **Step 1: Ajouter les tests (sections « manches », « fin », « compteurs », « catalogue »)**
```js
ok('rounds one : victoire de manche → phase finished + results', f.state.phase === 'finished' && Array.isArray(f.results))
ok('results : membres d\'équipe seulement, banc exclu', sameSet(f.results.map((x) => x.profile_id), f.state.players))
ok('gagnants : won = true, placement 1, points = 1', ...)
ok('toutes les clés de stats présentes', f.results.every((x) => ['bomb_votes','idle_clue','enemy_reveals','first_good','best_clue','spy_wins','flawless','comeback'].every((k) => Number.isInteger(x.stats[k]))))
ok('rounds each : round_end puis next_round (hôte)', ...)
ok('next_round par un non-hôte → not_host', ...)
ok('rotation : nouvel espion dans chaque équipe à la manche 2', ...)
ok('ancien espion : secret {round: 2, key: null}', ...)
ok('nouvelle grille, revealed vide, key null', ...)
ok('égalité de manches → les deux équipes gagnantes', ...)
ok('bomb_votes / enemy_reveals / first_good / best_clue / spy_wins / flawless / comeback', ...) // une assertion par compteur, scénario construit
ok('catalogue : tenue hacker + 11 trophées ndc actifs', (await db.query(`select count(*)::int c from public.trophies where tenue_id = 'hacker' and active`)).rows[0].c === 11)
```

- [ ] **Step 2: Lancer — doit échouer** sur `next_round` (`unknown_action`) et le catalogue (0 trophée).
- [ ] **Step 3: Implémenter** `next_round`, la fin de partie, les compteurs, la tenue et les trophées.
- [ ] **Step 4: `npm run sql`, relancer `nom-de-code.mjs`, puis la non-régression** `node spectateur.mjs …`, `node pronos.mjs …`, `node daily.mjs …`, `node petit-bac.mjs …` → tous `Tout est OK`.
- [ ] **Step 5: Commit**

```bash
git add supabase/games/nom-de-code.sql supabase/features/tenues.sql supabase/features/trophees.sql supabase/install.sql tools/sql-tests/nom-de-code.mjs
git commit -m "Nom de Code : manches, fin de partie, compteurs, tenue Hacker et 11 trophées (+ tests)"
```

---

### Task 4: Front — types, règles, actions, options, pioche de mots

**Files:**
- Create: `src/features/teams/teams.ts`, `src/games/nom-de-code/types.ts`, `src/games/nom-de-code/logic.ts`, `src/games/nom-de-code/setup.ts`, `src/games/nom-de-code/words.ts`
- Modify: `src/features/soiree/errors.ts`, `src/data/tenues.ts`

**Interfaces:**
- Produces `src/features/teams/teams.ts` : `export type TeamColor = 'red' | 'blue' | 'green' | 'yellow'` ; `export const TEAM_COLORS: TeamColor[]` (cet ordre) ; `export const TEAM_INFO: Record<TeamColor, { label: string; emoji: string; bg: string; soft: string; text: string }>` (`Rouges 🔴`, `Bleus 🔵`, `Verts 🟢`, `Jaunes 🟡`, classes Tailwind du design system existant, cf. `TEAM_META` de `devine-en-equipe/setup.ts`) ; `export function distributeTeams(ids: string[], count: 2 | 3 | 4): Partial<Record<TeamColor, string[]>>` (mélange puis répartition équilibrée).
- Produces `types.ts` : `NdcCell = TeamColor | 'neutral' | 'bomb'` ; `NdcTeam`, `NdcState extends BaseGameState` (champs exacts du state de Task 1), `NdcSecret = { round: number; key: NdcCell[] | null }`, `NdcStats`.
- Produces `logic.ts` : `normalizeWord(s: string): string` (minuscules, sans accents ni ponctuation, mêmes règles que `_normalize_word`) ; `majority(guessers: number): number` (= `floor(g/2)+1`) ; `clueProblem(word: string, n: number, s: NdcState): 'invalid_clue' | 'clue_is_grid_word' | null` (miroir des refus serveur, pour le message immédiat) ; `guessersOf(s, team): string[]` ; `myRole(s, meId): { team: TeamColor | null; spy: boolean }`.
- Produces `setup.ts` : `ndcActions = { clue(word, n), vote(index: number | null), stop(), tick(), skip(), nextRound() }` (`type` = `clue`, `vote`, `stop`, `tick`, `skip`, `next_round`) ; `NDC_TIMERS = { relaxed: null, normal: { clue: 120, guess: 180 }, fast: { clue: 60, guess: 120 } }` ; `NdcOptions = { teamCount: 2 | 3 | 4; teams?: Partial<Record<TeamColor, string[]>>; rounds: 'one' | 'each'; timer: 'relaxed' | 'normal' | 'fast' }` ; `NDC_DEFAULT_OPTIONS = { teamCount: 2, rounds: 'one', timer: 'normal' }` ; `readNdcOptions(o): NdcOptions` ; `prepareNdcStart(options, playerIds): Promise<Record<string, unknown>>` — garde des équipes stockées seulement les ids présents dans `playerIds`, complète/équilibre avec `distributeTeams` si une équipe a < 2 joueurs ou si aucune composition n'est stockée, calcule `total_rounds` comme le serveur, et renvoie `{ teams, rounds, timer, words: pickWords(25 * total_rounds) }`.
- Produces `words.ts` : `export const NDC_WORDS: readonly string[]` (~400 mots, 3 à 9 lettres, tout public, uniques après `normalizeWord`) ; `pickWords(n: number): string[]` (tirage sans remise).
- Errors (`errors.ts`) : `invalid_teams: 'Il faut 2 à 4 équipes d’au moins 2 joueurs.'`, `invalid_clue: 'Un seul mot (sans espace) et un nombre de 1 à 9.'`, `clue_is_grid_word: 'C’est un mot de la grille !'`, `not_spy: 'Seul l’espion donne l’indice.'`, `not_guesser: 'Ce n’est pas à toi de deviner.'`, `stop_too_early: 'Trouvez au moins un mot avant de passer.'`.
- Tenue (`tenues.ts`) : `'hacker'` ajouté à `TenueId` ; entrée `{ ...wins('hacker', 'Hacker', '💻', 'nom-de-code', 'Nom de Code'), art: 'hacker' }` après `pilote`.

- [ ] **Step 1: Écrire le contrôle de la pioche** (script ponctuel, non commité) : `node -e` qui lit `words.ts`, extrait les chaînes et vérifie : nombre ≥ 380, longueur 3-9, aucun doublon après normalisation (même algorithme que `normalizeWord`), aucun espace.
Expected avant implémentation : échec (fichier absent).
- [ ] **Step 2: Implémenter les 5 fichiers + errors + tenue.** Mots : noms communs concrets et variés (animaux, objets, lieux, métiers, nature, nourriture, sport, espace…), pas de noms propres, rien de vulgaire ni d'ambigu.
- [ ] **Step 3: Vérifier** : le script de pioche passe ; `npx tsc -b` et `npx eslint src/features/teams src/games/nom-de-code src/features/soiree/errors.ts src/data/tenues.ts` sans sortie.
- [ ] **Step 4: Commit**

```bash
git add src/features/teams/teams.ts src/games/nom-de-code/types.ts src/games/nom-de-code/logic.ts src/games/nom-de-code/setup.ts src/games/nom-de-code/words.ts src/features/soiree/errors.ts src/data/tenues.ts
git commit -m "Nom de Code : types, règles, actions, options, pioche de 400 mots, tenue Hacker"
```

---

### Task 5: Front — sélecteur d'équipes, options, définition du jeu

**Files:**
- Create: `src/features/teams/TeamsPicker.tsx`, `src/games/nom-de-code/Options.tsx`, `src/games/nom-de-code/index.ts`, `src/games/nom-de-code/Play.tsx` (squelette : affiche `phase` et le rôle, remplacé en Task 6), `src/games/nom-de-code/Summary.tsx`

**Interfaces:**
- Consumes: `TEAM_COLORS`, `TEAM_INFO`, `distributeTeams` (Task 4) ; `readNdcOptions`, `NDC_DEFAULT_OPTIONS`, `prepareNdcStart` (Task 4) ; `useSoiree`, `usePlayers` (`@/features/soiree/hooks`, `@/features/soiree/players`).
- Produces `TeamsPicker` : `export function TeamsPicker(props: { teamCount: 2 | 3 | 4; teams: Partial<Record<TeamColor, string[]>>; playerIds: string[]; onChange: (teams: Partial<Record<TeamColor, string[]>>, teamCount: 2 | 3 | 4) => void })`. Choix du nombre d'équipes (2 / 3 / 4), bouton « 🎲 Mélanger » (`distributeTeams`), colonnes par équipe + colonne « 👀 Banc » ; toucher un avatar le fait passer à l'équipe suivante (… → banc → première équipe) ; avertissement visible si une équipe a moins de 2 joueurs.
- Produces `definition: GameDefinition` : `id: 'nom-de-code'`, `order: 210`, `name: 'Nom de Code'`, `emoji: '🔐'`, `color: '#5EE6A8'`, `minPlayers: 4`, `maxPlayers: 9`, `tagline: 'Un espion, un mot, un nombre : retrouvez vos mots… sans toucher la bombe !'`, `rules: 'En équipes, l’espion voit quels mots sont les vôtres et donne un indice d’un seul mot avec un nombre. L’équipe pose ses têtes sur les mots : la majorité dévoile. Trouvez tous vos mots avant les autres… et gare à la bombe 💣 !'`, `Options: NdcOptionsPanel` (composant exporté par `Options.tsx`), `defaultOptions: { ...NDC_DEFAULT_OPTIONS }`, `prepareStart: (o, ctx) => prepareNdcStart(o, ctx.playerIds)`, `roundLabel` : `Manche r/total` si `total_rounds > 1`, sinon `null`.
- `Summary` : équipe(s) gagnante(s) avec emoji et membres (avatars), score des manches si `total_rounds > 1`.

- [ ] **Step 1: Implémenter** `TeamsPicker`, `Options.tsx` (`export function NdcOptionsPanel(props: GameOptionsProps)` : SegmentedControl « Manches » : `1 manche` / `Chacun son tour d’espion` ; « Chrono » : `😌 Détendu` / `⏱️ Normal` / `⚡ Rapide` ; puis `TeamsPicker`), `index.ts`, le squelette `Play.tsx`, `Summary.tsx`.
- [ ] **Step 2: Vérifier** : `npx tsc -b`, `npx eslint src/features/teams src/games/nom-de-code`, `npm run build` sans erreur ; le jeu apparaît dans le hub (registre auto) en dev (`npm run dev`, salon de test) et une partie démarre (squelette affiché, phase `clue`) — nécessite `install.sql` recollé dans Supabase : le demander à l'utilisateur avant ce test.
- [ ] **Step 3: Commit**

```bash
git add src/features/teams/TeamsPicker.tsx src/games/nom-de-code/Options.tsx src/games/nom-de-code/index.ts src/games/nom-de-code/Play.tsx src/games/nom-de-code/Summary.tsx
git commit -m "Nom de Code : sélecteur 2-4 équipes + banc, options, définition du jeu"
```

---

### Task 6: Front — écrans de jeu

**Files:**
- Modify: `src/games/nom-de-code/Play.tsx`
- Create: `src/games/nom-de-code/Grid.tsx`, `src/games/nom-de-code/CluePanel.tsx`, `src/games/nom-de-code/RoundEnd.tsx`

**Interfaces:**
- Consumes: `NdcState`, `NdcSecret` (Task 4) ; `ndcActions`, `clueProblem`, `majority`, `guessersOf`, `myRole` (Task 4) ; `GamePlayProps` ; `useCountdown` (`@/features/soiree/useServerClock`) ; `Avatar`, `Button`, composants UI existants.
- Produces `Grid` : `export function Grid(props: { s: NdcState; secretKey: NdcCell[] | null; meId: string; canVote: boolean; onVote: (index: number | null) => void; players: Record<string, PlayerInfo> })` — 5×5, mots en gros (≤ 9 lettres), fond léger de la couleur secrète si `secretKey`, carte dévoilée retournée (couleur d'équipe + chibi d'un membre ; neutre beige ; bombe 💥 + secousse), mini-têtes des `votes` de l'équipe active sur les cartes ; toucher sa carte votée = retirer (`onVote(null)`).
- Produces `CluePanel` : espion de l'équipe active en phase `clue` → champ « Ton indice » + 9 gros boutons 1-9 + « Envoyer » (message `clueProblem` immédiat avant envoi) ; tout le monde en phase `guess` → bandeau « 🔎 MOT · n » + essais restants ; devineurs actifs → « x sur y pour dévoiler » (y = `majority`) et bouton « ✋ Stop, on passe » avec son compteur (grisé tant que `turn_found = 0`) ; hôte → petit bouton « ⏭️ Passer le tour » (`skip`).
- Produces `RoundEnd` : grille entièrement colorée (`s.key`), bandeau selon `round_end_reason` (« 🔴 gagne ! » / « 💣 Boum ! … est éliminée » / « … dernière équipe en jeu »), tableau des manches si `total_rounds > 1`, bouton hôte « Manche suivante » (`nextRound`).
- `Play` : bandeau (pastille par équipe : emoji, mots restants `total - found`, 💀 et grisé si éliminée ; équipe active en avant ; chrono `useCountdown(s.deadline)`) ; overlay « rôle » 3 s au début de chaque manche (front uniquement — la phase `roles` de la spec n'existe pas côté serveur —, mémorisé par manche : « 🕵️ Tu es l'espion des Rouges » / « 🔎 Tu devines pour les Bleus » / « 👀 Tu regardes ») ; envoi du `tick` à l'échéance comme `petit-bac/Play.tsx` (petit délai aléatoire, ré-essai) ; la clé du secret n'est utilisée que si `secret.round === s.round`.

- [ ] **Step 1: Implémenter** les 4 fichiers.
- [ ] **Step 2: Vérifier** : `npx tsc -b`, `npx eslint src/games/nom-de-code`, `npm run build` ; partie réelle en dev avec plusieurs onglets / profils (page de test locale non commitée si utile) : indice refusé puis accepté, vote à la majorité, neutre, mot adverse, bombe, stop, fin de manche, manche suivante, banc en lecture seule, thème sombre.
- [ ] **Step 3: Commit**

```bash
git add src/games/nom-de-code/Play.tsx src/games/nom-de-code/Grid.tsx src/games/nom-de-code/CluePanel.tsx src/games/nom-de-code/RoundEnd.tsx
git commit -m "Nom de Code : écrans de jeu (grille, indice, votes, fin de manche)"
```

---

### Task 7: Documentation et vérification finale

**Files:**
- Modify: `docs/ARCHITECTURE.md` (section « Jeu `nom-de-code` » : règles, contrat SQL, state, actions, secrets), `docs/TROPHEES.md` (tableau « Hacker 💻 — Nom de Code »), `CLAUDE.md` (nombre de jeux 19 → 21 dans « Arborescence clé », dossier d'art `hacker`).

- [ ] **Step 1: Écrire la doc.**
- [ ] **Step 2: Vérification finale** : `npm run sql` ; toutes les suites SQL (`nom-de-code`, `spectateur`, `pronos`, `daily`, `petit-bac`) → `Tout est OK` ; `npx tsc -b`, `npm run lint`, `npm run build` sans erreur.
- [ ] **Step 3: Commit**

```bash
git add docs/ARCHITECTURE.md docs/TROPHEES.md CLAUDE.md
git commit -m "Docs : Nom de Code (architecture, trophées)"
```
- [ ] **Step 4: Rappeler à l'utilisateur** de recoller `supabase/install.sql` dans Supabase, puis de tester sur de vrais téléphones ; ne pas pousser sans « pousse ».
