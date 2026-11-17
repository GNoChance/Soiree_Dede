# Soirées de Dédé — guide pour Claude

PWA de mini-jeux multijoueurs pour soirées en famille / entre amis (joueurs peu technophiles : UX ultra simple, gros boutons, lisible sur mobile). Français uniquement, tout public.

**Source de vérité : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).** Ne la relire que pour la section utile à la tâche (contrats SQL/front, duels, Tour des Potes, tenues).

## Stack
- Front : React 19 + Vite 8 + TypeScript, Tailwind 4, zustand, react-router 7, framer-motion, canvas-confetti, three/cannon-es (bowling). PWA via `vite-plugin-pwa` (en ligne uniquement). Alias `@/` → `src/`.
- Back : Supabase (Auth anonyme + PIN, Realtime, RLS). **Pas d'Edge Functions** : toute la logique serveur = RPC SQL `security definer`.
- Hébergement : Vercel. Env : `.env.local` → `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (jamais commitées).

## Commandes
- `npm run dev` · `npm run build` (tsc + vite) · `npm run lint`
- `npm run sql` → régénère `supabase/install.sql` (schema + features + games + seed). C'est **ce** fichier que l'utilisateur colle dans le SQL Editor Supabase → le rappeler après toute modif SQL.
- Chibis : `cd tools/slice-chibis && node slice.mjs [--tenues | <slug>-<tenue>]` (package.json séparé).

## Arborescence clé
- `src/games/<id>/` : un dossier par jeu (19 jeux), `index.ts` exporte `definition` (auto-découvert par `src/games/registry.ts`, champ `order`). Play/Summary en `lazy`. Types du jeu dans `src/games/<id>/types.ts` (ne pas toucher `src/types/db.ts`).
- `supabase/games/<id>.sql` : moteur du jeu (`game_<id_underscore>_start` / `_action`), idempotent, terminé par les `revoke`.
- `src/features/` : `soiree` (salon, horloge serveur, `errors.ts`), `duel` (socle des jeux à 2), `tenues`, `admin`.
- `supabase/features/*.sql` : briques partagées (duel, tenues…), chargées entre `schema.sql` et `games/`.
- `src/data/tenues.ts` (catalogue skins) + `src/data/tenues-art.generated.ts` (généré, ne pas éditer à la main).

## Conventions essentielles
- État serveur autoritaire : `matches.state` (public) + `match_secrets` (privé). Toutes les actions passent par `game_action`.
- Minuteurs : `deadline` ISO dans le state + action `{"type":"tick"}` idempotente ; front `useCountdown` (`@/features/soiree/useServerClock`).
- Éphémère (traits de dessin…) : broadcast Realtime `match:<matchId>`, pas de BDD.
- Nouveau jeu en duel : copier `quatre-a-la-suite` (SQL + front), ne fournir que le plateau.
- Nouveaux codes d'erreur → `src/features/soiree/errors.ts`.
- Design « sticker book » : contours épais, ombre décalée `box-shadow: 4px 4px 0 <ink>`, couleurs vives, thème clair + sombre, grosses animations.

## Skins (chibis)
- Style **Chibi** (générés via ChatGPT/Gemini), planches **4×3** = 12 expressions dans un ordre fixe (voir ARCHITECTURE.md ; Carole et Nini ont leur propre ordre).
- 9 persos : kevin, cycy, dede, manon, mika, cecile, carole, marius, nini.
- Nouvelle planche : `assets-source/planches/<slug>-<tenue>.png` (tenue sans tiret) → `node slice.mjs <slug>-<tenue>` → commit planche + `public/chibis/<slug>/<tenue>/` + `tenues-art.generated.ts`.
- Nouvelle tenue au catalogue : `src/data/tenues.ts` **et** `supabase/features/tenues.sql`, puis `npm run sql`.
- Pratique actuelle (récents commits) : planches de tenue dans `assets-source/costumes/<slug>-v2/<slug>-<dossier>.png` (dossiers en anglais : spy, teacher, admiral…, cf. champ `art`/`artOwn` de `tenues.ts`) + config `tools/slice-chibis/configs/<slug>-v2.mjs` → `costumes.mjs`. Portraits de tenue (`public/chibis/<slug>/portraits/<dossier>.webp` + `@thumb`) : `portraits-extra.mjs`.
- 19 dossiers d'art par perso (star/cinema et teacher/student sont distincts). Inventaire des manques : comparer `TENUE_ART` / `TENUE_PORTRAITS` de `tenues-art.generated.ts` à cette liste.
- L'utilisateur fournit les planches, Claude les intègre (découpe, génération, commit).
- Détails : [tools/slice-chibis/README.md](tools/slice-chibis/README.md).

## Git
Utilisateur seul sur le projet : commits directement sur `main`.

## Règles de travail (économie de tokens)
- Poser une question courte plutôt qu'explorer le repo à l'aveugle. Lire des extraits ciblés, ne pas réécrire un fichier entier.
- Annoncer en début de tâche le modèle adapté (l'utilisateur switche via `/model`) :
  - **Haiku** : petits fixes CSS/texte, ajout de skins/expressions dans les configs, git basique.
  - **Fable** : idées de jeux, règles, textes humoristiques, prompts d'images chibi.
  - **Sonnet** : logique d'un jeu, refactoring, state, PWA, intégration d'assets/animations.
  - **Opus** : seulement sur demande ou bug complexe (sync temps réel, architecture).
- Réponses courtes et directes.
