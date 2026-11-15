# Soirées de Dédé — Contrats d'architecture

Source de vérité partagée entre tous les agents. Toute divergence = bug.

## Décisions produit
- PWA mobile-first, **en ligne uniquement** (installable, assets/chibis en cache, mais pas de jeu hors ligne).
- **Multi-écrans temps réel** : chaque joueur sur son téléphone. Hôte = celui qui lance la soirée.
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
- `soirees` (id, code char(4) unique parmi les actives, host_id, status 'lobby'|'active'|'ended', started_at, ended_at)
- `soiree_players` (soiree_id, profile_id, joined_at) — l'hôte invite des joueurs ; ils voient la soirée dans l'app (et code 4 lettres en secours)
- `matches` (id, soiree_id, game_id text, status 'lobby'|'playing'|'finished', state jsonb **public**, created_at, finished_at)
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
