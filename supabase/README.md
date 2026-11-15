# Supabase — Soirées de Dédé

## Mise en place (à faire une fois)

1. Créer un projet sur https://supabase.com (région Europe).
2. **Authentication > Sign In / Providers** : activer **Anonymous sign-ins** (« Allow anonymous sign-ins »).
3. **SQL Editor > New query** : coller tout `supabase/schema.sql`, **Run**.
4. Nouvelle requête : coller `supabase/seed.sql`, **Run**.
   Les deux fichiers sont ré-exécutables à volonté (mise à jour du schéma) sans perte de données : le seed n'écrase jamais PIN, XP ni pseudo.
5. **Project Settings > API** : copier `Project URL` et la clé `anon` `public` dans `.env.local` :
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```
6. (Vérif) **Database > Publications > supabase_realtime** doit contenir `soirees`, `soiree_players`, `matches`, `match_players`.

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
| `list_profiles_public()` (aussi en `anon`) | `[{id, slug, first_name, nickname, equipped_expression, expressions, has_pin}]` trié |
| `login_profile(p_slug, p_pin)` | `{ok:true, first_login, profile}` / `{ok:false, error:'wrong_pin', attempts_left}` / `{ok:false, error:'locked', locked_until}` / `{ok:false, error:'invalid_pin_format'\|'unknown_profile'}` |
| `current_profile_id()` | `uuid \| null` |
| `logout_device()` | void |
| `admin_reset_pin(p_slug)` | void (admin seulement, déconnecte aussi les autres appareils du profil) |
| `update_nickname(p_nickname)` | profil (1–20 caractères, espaces normalisés) |
| `equip_expression(p_expression)` | profil (`unknown_expression` / `expression_locked`) |

PIN : exactement 4 chiffres. 5 échecs → blocage 15 min (par profil, tous appareils confondus). Premier login = le PIN saisi devient le PIN.

### Amis
| RPC | Retour |
|---|---|
| `send_friend_request(p_profile_id)` | `{status:'pending'\|'accepted', new_unlocks}` (accepté direct si l'autre m'avait déjà demandé) |
| `respond_friend_request(p_requester_id, p_accept)` | `{status:'accepted'\|'rejected', new_unlocks}` |
| `remove_friend(p_profile_id)` | void (supprime aussi une demande en attente, dans les deux sens) |

Demandes reçues : `from('friendships').select().eq('addressee_id', me).eq('status','pending')`.

### Soirées
| RPC | Retour |
|---|---|
| `create_soiree(p_player_ids uuid[])` | `SoireeJson` (`{...soiree, player_ids}`) — l'hôte est ajouté d'office |
| `join_soiree_by_code(p_code)` | `SoireeJson` (insensible à la casse) |
| `my_active_soiree()` | `SoireeJson \| null` |
| `leave_soiree()` | void — si l'hôte part, l'hôte passe au joueur le plus ancien ; si plus personne, la soirée est terminée |
| `end_soiree(p_soiree_id)` | `{new_unlocks}` (hôte) — les parties en cours passent en `phase:'aborted'` |

Un profil n'est que dans **une** soirée non terminée : `already_in_soiree`, `player_busy` (pseudos dans `error.details`). Les soirées sans activité depuis 12 h sont terminées automatiquement à la prochaine création/jonction.

### Moteur
- `start_match(p_soiree_id, p_game_id, p_options) → uuid` (hôte). Erreur `match_in_progress` s'il y a déjà une partie `playing`. `p_options.player_ids` (optionnel) = sous-ensemble des joueurs de la soirée.
- `game_action(p_match_id, p_action) → state` (le nouveau state public, aussi diffusé en Realtime sur `matches`).
- `state.seq` (entier, absent avant la 1re action) : version du state, incrémentée à chaque `game_action` (et à l'annulation par `abort` / `end_soiree`). Le front ignore un state reçu avec un `seq` inférieur à celui affiché (la réponse RPC et l'évènement Realtime peuvent arriver dans le désordre).
- Action commune : `{"type":"abort"}` (hôte) → `status:'finished'`, `state.phase:'aborted'`, `state.aborted:true`, sans résultats.
- À la fin (`phase:'finished'`) le state contient en plus `results`, `new_unlocks` (`{profile_id: [expr]}`) et `xp_gained` (`{profile_id: xp}`).
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
- **dodo** : soirée terminée (par `end_soiree` ou départ du dernier joueur) entre 2 h 00 et 7 h 59 heure de Paris, pour les joueurs encore présents et ayant fini au moins une partie de la soirée.
- **surprise** : une soirée compte pour un joueur s'il y a fini au moins une partie.
- **cool** : avoir le max de victoires (ex-aequo inclus), au moins 1.
- **pleurs** : « dernier » = plus mauvais placement d'une partie où tout le monde n'est pas ex-aequo.
- **colere** : 3 défaites d'affilée (série en cours ou record).

### Écarts au contrat (ARCHITECTURE.md)
1. `pin_hash` n'est pas dans `profiles` mais dans une table privée `profile_credentials` (sinon `select('*')` sur profiles exposerait le hash ou échouerait). `has_pin` est exposé via `list_profiles_public()`.
2. Colonnes ajoutées : `profiles.sort_order`, `soirees.created_at`, `friendships.accepted_at`, `match_players.game_id` (pour `leaderboard_by_game` sans lire `matches`), `login_attempts.last_failed_at`.
3. Tables internes ajoutées (inaccessibles aux clients) : `profile_credentials`, `match_server_state` (votes en cours, mots, rôles).
4. RPC ajoutée : `my_active_soiree()`. Fonction `level_for_xp(xp)`. Action commune `abort`. Option `player_ids` de `start_match`.
5. `finish_match(p_match_id, p_results)` est interne : `results` = `[{profile_id, points, won, placement, stats}]`, appelée par `game_action`.
6. `matches.status = 'lobby'` n'est jamais utilisé (une partie est créée directement en `playing`).
7. (Phase 2) `state.seq` ajouté par `game_action` / `abort` / `_end_soiree` : version monotone du state public (anti-régression d'affichage côté front). **Re-coller `schema.sql`** pour l'activer ; sans lui le front fonctionne quand même (il accepte alors tout state reçu).
