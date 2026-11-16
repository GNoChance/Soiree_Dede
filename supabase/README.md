# Supabase — Soirées de Dédé

## Mise en place (à faire une fois)

1. Créer un projet sur https://supabase.com (région Europe).
2. **Authentication > Sign In / Providers** : activer **Anonymous sign-ins** (« Allow anonymous sign-ins »).
3. **SQL Editor > New query** : coller tout `supabase/install.sql` (généré par `npm run sql` = `schema.sql` + `features/*.sql` + `games/*.sql` + `seed.sql`), **Run**.
   (Équivalent : `schema.sql`, puis les `features/*.sql` (ordre alphabétique : `duel.sql`, `tenues.sql`), les `games/*.sql`, puis `seed.sql`, dans cet ordre.)
4. Les fichiers sont ré-exécutables à volonté (mise à jour du schéma) sans perte de données : le seed n'écrase jamais PIN, XP ni pseudo.
5. **Project Settings > API** : copier `Project URL` et la clé `anon` `public` dans `.env.local` :
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```
6. (Vérif) **Database > Publications > supabase_realtime** doit contenir `soirees`, `soiree_players`, `matches`, `match_players`.
7. (Recommandé) Activer **pg_cron** pour la fin automatique des soirées à la minute près : voir « Activer pg_cron » plus bas.

Réinitialiser un PIN oublié : Kevin (admin) appelle `admin_reset_pin('slug')` depuis l'app. Le joueur choisira un nouveau PIN à sa prochaine connexion.

---

## Contrat pour le front

Types TypeScript : `src/types/db.ts` (`createClient<Database>(...)`).

### Règles générales
- Les clients **ne peuvent que lire** (RLS select). Toute écriture passe par `supabase.rpc(...)`.
- Les erreurs métier sont levées avec un code court dans `error.message` (`not_host`, `wrong_phase`, … voir `RpcErrorCode`). Exception : `login_profile` ne lève jamais pour un mauvais PIN, il renvoie `{ ok: false, ... }`.
- Toutes les RPC (sauf `list_profiles_public`) exigent une session anonyme Supabase ; la plupart exigent aussi un profil lié (`not_logged_in` sinon).
- RLS : `profiles`, `friendships` (acceptées + mes demandes), `match_players`, `unlocks`, `player_stats`, vues de classement = lisibles par tous les connectés. `soirees`, `soiree_players`, `matches` = membres de la soirée seulement. `match_secrets` = son propriétaire seulement. `device_sessions` = sa propre ligne.

### Auth / profil
| RPC | Retour |
|---|---|
| `list_profiles_public()` (aussi en `anon`) | `[{id, slug, first_name, nickname, equipped_expression, equipped_tenue, expressions, has_pin}]` trié |
| `login_profile(p_slug, p_pin)` | `{ok:true, first_login, profile}` / `{ok:false, error:'wrong_pin', attempts_left}` / `{ok:false, error:'locked', locked_until}` / `{ok:false, error:'invalid_pin_format'\|'unknown_profile'}` |
| `current_profile_id()` | `uuid \| null` |
| `logout_device()` | void |
| `admin_reset_pin(p_slug)` | void (admin seulement, déconnecte aussi les autres appareils du profil) |
| `admin_list_soirees()` | jsonb : soirées non terminées (code, hôte, joueurs, partie en cours) — admin seulement |
| `admin_end_soiree(p_soiree_id)` | {new_unlocks} : clôt de force (end_reason 'admin', partie en cours annulée sans XP) — admin seulement |
| `update_nickname(p_nickname)` | profil (1–20 caractères, espaces normalisés) |
| `equip_expression(p_expression)` | profil (`unknown_expression` / `expression_locked`) |
| `equip_tenue(p_tenue)` | profil (`unknown_tenue` / `tenue_locked`) — cf. section Tenues |

PIN : exactement 4 chiffres. 5 échecs → blocage 15 min (par profil, tous appareils confondus). Premier login = le PIN saisi devient le PIN.

### Amis
| RPC | Retour |
|---|---|
| `send_friend_request(p_profile_id)` | `{status:'pending'\|'accepted', new_unlocks}` (accepté direct si l'autre m'avait déjà demandé) |
| `respond_friend_request(p_requester_id, p_accept)` | `{status:'accepted'\|'rejected', new_unlocks}` |
| `remove_friend(p_profile_id)` | void (supprime aussi une demande en attente, dans les deux sens) |

Demandes reçues : `from('friendships').select().eq('addressee_id', me).eq('status','pending')`.

### Soirées (plusieurs en même temps + fin automatique)
| RPC | Retour |
|---|---|
| `create_soiree(p_player_ids uuid[])` | `SoireeJson` — l'hôte est ajouté d'office |
| `join_soiree_by_code(p_code)` | `SoireeJson` (insensible à la casse ; déjà membre = OK, même à 5 soirées) |
| `my_active_soirees()` | `ActiveSoireeJson[]` : **toutes** mes soirées non terminées (5 au plus), la plus récente d'abord |
| `my_active_soiree()` | compat : `SoireeJson \| null` = la soirée non terminée la plus récemment rejointe |
| `leave_soiree(p_soiree_id uuid default null)` | void — quitte **cette** soirée (sans paramètre = compat : la plus récemment rejointe). Sans effet ni erreur si je n'en suis pas membre ou si elle est terminée. Si l'hôte part, l'hôte passe au joueur arrivé le plus tôt ; si plus personne : fin (`end_reason 'empty'`) |
| `end_soiree(p_soiree_id)` | `{new_unlocks}` (hôte) — `end_reason 'host'` ; les parties en cours passent en `phase:'aborted'` |

- `SoireeJson` = ligne `soirees` (dont `end_reason`) + `player_ids` (ordre d'arrivée) + `last_activity_at` + `current_match` + `idle_deadline` :
  - `current_match` = partie non terminée la plus récente `{id, game_id, status, created_at, player_ids}` (`player_ids` = `state.players`), ou `null` (« dans le salon ») ;
  - `idle_deadline` = fin automatique prévue = `last_activity_at + 20 min` ; `null` pendant une partie ou si la soirée est terminée.
- `ActiveSoireeJson` = `SoireeJson` + `host` (profil de l'hôte, format `_profile_json`, avec `equipped_tenue`) + `joined_at` (mon arrivée).
- `end_reason` : `'host'` (end_soiree) | `'empty'` (le dernier joueur est parti) | `'idle'` (fin auto, 20 min sans jeu) | `'abandoned'` (filet : partie figée 3 h) ; `null` tant que la soirée est ouverte (et pour les soirées terminées avant la colonne). Posée dans le **même** UPDATE que `status = 'ended'` : l'évènement Realtime de fin porte la raison.

**Plusieurs soirées en même temps** : un profil peut être membre de **5** soirées non terminées au plus (`_soiree_max_open()`). Erreurs : `too_many_soirees` (moi, à la création ou à la jonction) ; `player_busy` = un invité de `create_soiree` est **déjà dans 5 soirées** (pseudos dans `error.details`). Une seule partie non terminée **par soirée** (`match_in_progress`), mais un joueur peut jouer dans des parties de soirées différentes en même temps. `already_in_soiree` n'est plus levé (ancien serveur).

**Fin automatique** (`_cleanup_stale_soirees()`) :
1. Une soirée **sans partie en cours** dont la dernière activité (création, démarrage, ou fin/annulation de sa dernière partie ; arrivées et départs ne comptent pas) date de plus de **20 min** est terminée : `end_reason 'idle'`, fin **naturelle** (compte dans les soirées jouées ; « dodo » si l'échéance tombe entre 2 h et 8 h, heure de Paris), **datée à l'échéance** (`ended_at = last_activity_at + 20 min`, quel que soit le moment où le nettoyage passe).
2. Filet : une partie non terminée **sans aucune écriture depuis 3 h** (`matches.updated_at`, tenu par le trigger `matches_touch` : toute action, même un `tick`, le rafraîchit) est annulée (`phase:'aborted'`, `seq` +1) et sa soirée terminée : `end_reason 'abandoned'`, fin non naturelle (pas de dodo). À l'installation de la colonne, les parties **non terminées** existantes sont datées à l'heure de la migration (leur dernière action est inconnue) : une longue session en cours au moment où l'on recolle `install.sql` n'est donc pas tuée ; une partie réellement abandonnée vit au pire 3 h de plus.
- Une partie en cours (écrite depuis moins de 3 h) n'entraîne **jamais** la fin de sa soirée. Le nettoyage verrouille chaque soirée candidate puis revérifie (une partie lancée au même instant annule la clôture).
- Exécution : job **pg_cron** `soirees-idle-cleanup` chaque minute (créé par `schema.sql` si l'extension est disponible), **et** paresseusement au début de `my_active_soiree(s)`, `create_soiree`, `join_soiree_by_code`, `start_match`. Sur une soirée dont l'échéance est dépassée mais pas encore close : `start_match` → `soiree_ended`, `join_soiree_by_code` → `soiree_not_found` (l'erreur annule la clôture faite dans la même transaction : le front rappelle alors `my_active_soirees`, comme quand son compte à rebours atteint zéro).

#### Activer pg_cron (Supabase)
1. **Database > Extensions** : chercher **pg_cron** et l'activer (schéma proposé par défaut).
2. Re-coller `install.sql` (ou au moins `schema.sql`) : la section 16 (re)crée deux jobs, idempotents : `soirees-idle-cleanup` (`* * * * *` → `select public._cleanup_stale_soirees()`) et `soirees-idle-cleanup-purge` (chaque nuit à 4 h 17 UTC : efface de `cron.job_run_details` l'historique de ce job de plus de 2 jours ; il tourne 1 440 fois par jour).
3. Vérifier : `select jobname, schedule, active from cron.job;` puis, une minute plus tard, `select status, start_time from cron.job_run_details order by start_time desc limit 5;` (`succeeded`).

Sans pg_cron, le script affiche une NOTICE « pg_cron indisponible… » et continue : la fin auto reste assurée par les RPC ci-dessus et par le front (le hub recharge `my_active_soirees` toutes les 60 s quand l'app est au premier plan, au retour au premier plan, et quand un compte à rebours atteint zéro). Une soirée oubliée alors que plus personne n'a l'app ouverte est close à la connexion suivante, datée à son échéance (même résultat de stats et de dodo).
Désactiver : `select cron.unschedule('soirees-idle-cleanup'); select cron.unschedule('soirees-idle-cleanup-purge');` (les re-coller les recrée).

### Moteur
- `start_match(p_soiree_id, p_game_id, p_options) → uuid` (hôte). Erreur `match_in_progress` s'il y a déjà une partie `playing`. `p_options.player_ids` (optionnel) = sous-ensemble des joueurs de la soirée.
- `game_action(p_match_id, p_action) → state` (le nouveau state public, aussi diffusé en Realtime sur `matches`).
- `state.seq` (entier, absent avant la 1re action) : version du state, incrémentée à chaque `game_action` (et à l'annulation par `abort` / `end_soiree`). Le front ignore un state reçu avec un `seq` inférieur à celui affiché (la réponse RPC et l'évènement Realtime peuvent arriver dans le désordre).
- Action commune : `{"type":"abort"}` (hôte) → `status:'finished'`, `state.phase:'aborted'`, `state.aborted:true`, sans résultats.
- À la fin (`phase:'finished'`) le state contient en plus `results`, `new_unlocks` (`{profile_id: [expr]}`), `new_tenues` (`{profile_id: [tenue_id]}`, `{}` si aucune) et `xp_gained` (`{profile_id: xp}`).
- Le client s'abonne à `matches` (filtre `soiree_id=eq.<id>`) et lit **son** secret : `from('match_secrets').select('secret').eq('match_id', id).maybeSingle()`.
- XP = points × 10 + 50 si victoire. Niveau = `floor(sqrt(xp/100)) + 1` (`levelForXp`).

### Jeu `qui-de-nous`
Options : `{"rounds": 10, "questions": ["Qui de nous…", ...]}` — le front tire les questions (au moins `rounds`, sinon `rounds` est réduit au nombre de questions). ≥ 2 joueurs.

State public :
```json
{
  "game": "qui-de-nous", "phase": "voting|reveal|finished|aborted",
  "round": 1, "total_rounds": 10, "question": "Qui de nous…",
  "players": ["uuid"], "voters": ["uuid"],
  "scores": {"uuid": 0}, "designated": {"uuid": 0},
  "last_reveal": {"round":1,"question":"…","votes":{"voter":"target"},"counts":{"target":3},
                  "majority":["uuid"],"scorers":["uuid"]},
  "history": [{"round":1,"question":"…","counts":{},"majority":[]}],
  "winners": null, "results": null
}
```
Pendant `voting`, seuls les **votants** sont publics (pas leurs choix). Les votes apparaissent dans `last_reveal` en phase `reveal`.

Actions :
- `{"type":"vote","target":"uuid"}` — joueur, phase `voting`, pas soi-même ; on peut changer d'avis tant que non révélé. Quand tous ont voté → `reveal` automatique.
- `{"type":"reveal"}` — hôte, force la révélation.
- `{"type":"next"}` — hôte, `reveal` → manche suivante, ou `finished` après la dernière.

Score : +1 si mon vote = un majoritaire (égalité : tous comptent). Gagnant(s) = max de points (personne si tout le monde a 0). `designated` = votes reçus (stat bisou/timide).

### Jeu `undercover`
Options : `{"pair": ["chat","chien"], "misterWhite": true}` — le serveur tire au sort lequel des deux mots est le mot civil, les rôles et l'ordre de parole. ≥ 3 joueurs ; 2 undercovers si ≥ 7 joueurs ; Mister White seulement si ≥ 5 joueurs (sinon ignoré, cf. `setup.mister_white`).

Secret (`match_secrets.secret`) : `{"word":"chat"}` pour civils et undercovers (le rôle n'est volontairement PAS transmis : règle classique, personne ne sait s'il est undercover), `{"role":"mrwhite","word":null}` pour Mister White.

State public (aucun mot avant la fin) :
```json
{
  "game": "undercover", "phase": "describe|vote|elimination|mrwhite_guess|finished|aborted",
  "round": 1, "players": ["uuid"], "order": ["uuid"], "alive": ["uuid"], "starter": "uuid",
  "setup": {"civils": 4, "undercovers": 1, "mister_white": true},
  "voters": [], "candidates": [], "revote": false,
  "last_vote": {"round":1,"votes":{"voter":"target"},"counts":{"uuid":2},"outcome":"majority|revote|random","tied":["uuid"]},
  "eliminated": [{"profile_id":"uuid","role":"civil","round":1}],
  "current_elimination": {"profile_id":"uuid","role":"undercover","round":1},
  "mrwhite_guess": {"profile_id":"uuid","word":"chien","correct":false},
  "winner": null, "words": null, "roles": null, "results": null
}
```
Ordre de parole d'une manche : `order` filtré sur `alive`, en commençant par `starter` (Mister White n'est jamais premier en manche 1 ; ensuite `starter` tourne d'un joueur vivant à chaque manche).

Actions :
- `{"type":"start_vote"}` — hôte, `describe` → `vote` (`candidates` = vivants).
- `{"type":"vote","target":"uuid"}` — joueur vivant, cible ∈ `candidates`, pas soi-même. Quand tous les vivants ont voté → dépouillement automatique.
- `{"type":"close_vote"}` — hôte, dépouille avec les votes reçus (joueur absent).
- Égalité → `phase` reste `vote`, `revote:true`, `candidates` = ex-aequo, `last_vote.outcome:'revote'`. Nouvelle égalité → tirage au sort (`outcome:'random'`).
- Élimination → `phase:'elimination'` (rôle révélé dans `current_elimination`), ou `phase:'mrwhite_guess'` si c'est Mister White.
- `{"type":"guess","word":"…"}` — Mister White éliminé uniquement. Comparaison insensible à la casse, aux accents, espaces et ponctuation. Juste → fin, `winner:'mrwhite'` (il gagne seul). Faux → `phase:'elimination'`.
- `{"type":"skip_guess"}` — hôte, Mister White ne répond pas (= faux).
- `{"type":"next"}` — hôte, depuis `elimination` : vérifie la victoire puis `finished` ou manche suivante (`describe`).

Victoire : civils si plus aucun infiltré (undercovers + Mister White) vivant ; infiltrés si civils vivants ≤ infiltrés vivants (toute l'équipe infiltrée gagne, même éliminée). En fin de partie : `words: {civil, undercover}`, `roles`, `winner: 'civils'|'infiltres'|'mrwhite'`.
Points : gagnant vivant 3, gagnant éliminé 2, perdant 0 (Mister White qui devine : 3). Classement : gagnants d'abord, puis ordre de survie.

### Déblocages (évalués côté serveur)
Évalués à chaque fin de partie (tous les joueurs de la partie, d'où « cool »), à l'acceptation d'amitié (amoureux/charmée), à la fin de soirée (dodo/surprise) et au login. Seules les expressions de `profiles.expressions` sont débloquées. `new_unlocks` renvoyé par les RPC/states permet d'animer le déblocage.
- **dodo** : soirée terminée « naturellement » (`end_soiree`, départ du dernier joueur, ou fin auto après 20 min sans jeu — datée à son échéance) entre 2 h 00 et 7 h 59 heure de Paris, pour les joueurs encore présents et ayant fini au moins une partie de la soirée. Pas de dodo pour le filet « partie abandonnée ».
- **surprise** : une soirée compte pour un joueur s'il y a fini au moins une partie.
- **cool** : avoir le max de victoires (ex-aequo inclus), au moins 1.
- **pleurs** : « dernier » = plus mauvais placement d'une partie où tout le monde n'est pas ex-aequo.
- **colere** : 3 défaites d'affilée (série en cours ou record).

### Tenues (`supabase/features/tenues.sql`)
Skins vestimentaires : variante du chibi (`public/chibis/<slug>/<tenue>/<expr>.webp`), indépendante de l'expression équipée.
- Tables : `tenues` (catalogue : `id, label, emoji, game_id, condition_type, threshold, sort_order, has_art`), `tenue_unlocks` (`profile_id, tenue_id, unlocked_at`). Lecture pour tout `authenticated` ; aucune écriture client. Colonne `profiles.equipped_tenue` (défaut `'default'`), exposée dans `_profile_json`, `list_profiles_public()` et les deux vues de classement.
- Catalogue seedé (`on conflict do update` label/emoji/condition/seuil, **jamais `has_art`**) : `default` (toujours débloquée), puis une tenue par jeu, débloquée par **10 victoires** dans ce jeu : `star` (qui-de-nous), `espion` (undercover), `croupier` (pas-de-bol), `prof` (cerveau-en-fete), `ecolier` (petit-bac), `artiste` (dessine-devine), `loup` (loup-garou), `artificier` (bombe-a-mots), `pirate` (menteur), `bowler` (bowling), `philosophe` (tu-preferes), `vedette` (qui-suis-je), `archer` (le-plus-proche), `comedien` (action-ou-verite), `coach` (devine-en-equipe), `stratege` (quatre-a-la-suite), `ninja` (morpion), `amiral` (bataille-navale), `magnat` (tour-des-potes). Miroir front : `src/data/tenues.ts` (mêmes id/label/emoji/game_id). Jeux en duel : une victoire = une **session** gagnée (`won` posé par `_duel_finish`), pas une manche.
- `condition_type` : `'default'` ou `'game_wins'` (≥ `threshold` lignes `won` de `match_players` pour `game_id` ; `game_id` null = tous jeux). Nouveau type de condition = un `when` de plus dans `evaluate_tenues`.
- `equip_tenue(p_tenue)` → profil ; erreurs `unknown_tenue`, `tenue_locked`. `default` toujours équipable.
- `evaluate_tenues(p_profile_id) → text[]` (interne) : insère les déblocages manquants, renvoie les ids nouvellement débloqués. Un rattrapage tourne à chaque exécution du fichier (victoires acquises avant l'installation).
- **Branchement fin de partie** : `schema.sql` définit un hook no-op `_after_finish_match(p_match_id, p_profile_ids) → jsonb` appelé en dernier par `finish_match` ; `tenues.sql` le redéfinit pour évaluer les tenues de tous les joueurs. `finish_match` renvoie `{new_unlocks, xp_gained, new_tenues}` et `game_action` met `new_tenues` dans le state final.
- `has_art` est informatif ; côté front la disponibilité des illustrations vient de `src/data/tenues-art.generated.ts` (généré par `tools/slice-chibis`).
- Ordre d'exécution : `tenues.sql` APRÈS `schema.sql` (il redéfinit `_profile_json`, `list_profiles_public`, les vues). `schema.sql` fait un `drop function list_profiles_public()` avant de la recréer pour rester ré-exécutable seul.

### Écarts au contrat (ARCHITECTURE.md)
1. `pin_hash` n'est pas dans `profiles` mais dans une table privée `profile_credentials` (sinon `select('*')` sur profiles exposerait le hash ou échouerait). `has_pin` est exposé via `list_profiles_public()`.
2. Colonnes ajoutées : `profiles.sort_order`, `soirees.created_at`, `friendships.accepted_at`, `match_players.game_id` (pour `leaderboard_by_game` sans lire `matches`), `login_attempts.last_failed_at`.
3. Tables internes ajoutées (inaccessibles aux clients) : `profile_credentials`, `match_server_state` (votes en cours, mots, rôles).
4. RPC ajoutée : `my_active_soiree()`. Fonction `level_for_xp(xp)`. Action commune `abort`. Option `player_ids` de `start_match`.
5. `finish_match(p_match_id, p_results)` est interne : `results` = `[{profile_id, points, won, placement, stats}]`, appelée par `game_action`.
6. `matches.status = 'lobby'` n'est jamais utilisé (une partie est créée directement en `playing`).
7. (Phase 2) `state.seq` ajouté par `game_action` / `abort` / `_end_soiree` : version monotone du state public (anti-régression d'affichage côté front). **Re-coller `schema.sql`** pour l'activer ; sans lui le front fonctionne quand même (il accepte alors tout state reçu).
8. (Multi-soirées) Colonnes `soirees.end_reason` (check : `host|empty|idle|abandoned`) et `matches.updated_at` (trigger `matches_touch`, index partiel `matches_unfinished_idx`). RPC `my_active_soirees()`, `leave_soiree(p_soiree_id uuid default null)` (remplace `leave_soiree()`). Internes : `_close_soiree(id, reason, natural, at)` (`_end_soiree(id, natural)` reste un alias), `_open_soirees_count`, `_soiree_last_activity`, constantes `_soiree_max_open()` = 5, `_soiree_idle_timeout()` = 20 min, `_match_stale_timeout()` = 3 h. La fin auto « 12 h sans activité » est remplacée par les règles 20 min / 3 h ci-dessus. Le front gère encore un serveur pas à jour (repli sur `my_active_soiree()` et `leave_soiree()`), mais **re-coller `install.sql`** pour activer le multi-soirées.
