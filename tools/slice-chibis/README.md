# slice-chibis — planches 4×3 → chibis `.webp`

Découpe les planches de stickers (12 expressions, grille 4×3) en
`public/chibis/<slug>/<tenue>/<expression>.webp` (512 px) + `<expression>@thumb.webp` (160 px).

## Lancer

```
cd tools/slice-chibis
npm install            # une fois (sharp)
node slice.mjs                    # tout : planches par défaut + toutes les tenues
node slice.mjs --tenues           # seulement les planches de tenue
node slice.mjs kevin kevin-star   # seulement ces planches (<slug> ou <slug>-<tenue>)
```

Un aperçu de contrôle (damier + noms) est écrit dans `tools/slice-chibis/out-check/<planche>.png` :
vérifier que chaque sticker est bien à sa place.

## Planche par défaut

`assets-source/planches/<slug>.png` → tenue `default`.

## Ajouter une tenue (nouvelle planche)

1. Déposer la planche **4×3** dans `assets-source/planches/<slug>-<tenue>.png`
   (ex. `kevin-star.png`, `cycy-espion.png`).
   - `<slug>` : kevin, cycy, dede, manon, mika, cecile, carole, marius, nini.
   - `<tenue>` : id de la tenue (minuscules / chiffres / `_`, **sans tiret**) ; `star`, `espion`,
     `croupier`, `prof`, `ecolier`, `artiste` sont déjà au catalogue.
   - **Même ordre d'expressions que la planche par défaut du perso** (ligne par ligne, gauche→droite ;
     voir `docs/ARCHITECTURE.md` — Carole et Nini ont leur propre ordre).
2. `node slice.mjs --tenues` (ou `node slice.mjs kevin-star`).
3. Le script écrit `public/chibis/<slug>/<tenue>/…` **et régénère `src/data/tenues-art.generated.ts`**
   (liste des couples `slug/tenue` complets, 12 images). Le front l'utilise pour ne pas requêter d'images
   inexistantes : tant qu'un couple n'y figure pas, le joueur voit « Illustration bientôt » dans l'inventaire
   et son chibi `default` + l'emoji de la tenue en coin.
4. Commit : planche, `public/chibis/…`, `tenues-art.generated.ts`. Aucune autre modification nécessaire.

Une tenue dont le dossier est incomplet (moins de 12 expressions) est ignorée avec un avertissement.

### Nouvelle tenue au catalogue (pas seulement une planche)

Ajouter l'id dans `src/data/tenues.ts` **et** une ligne dans `supabase/features/tenues.sql`
(`insert into public.tenues … on conflict do update`), puis `npm run sql` et recoller `supabase/install.sql`.
Le script avertit si la tenue d'une planche est absente de `src/data/tenues.ts`.

## Planches récalcitrantes : `closed-sheet.mjs`

Quand `free-sheet.mjs` rate une planche 4×3 sur fond noir (liserés blancs ouverts : le fond « fuit » dans le dessin ; stickers soudés), même en `split: 'grid'` :
`node tools/slice-chibis/closed-sheet.mjs <planche.png> <slug> <dossier> [--preview]`. Le liseré blanc est refermé avant d'enlever le fond, les blocs soudés sont coupés à la ligne la plus fine, puis les poches de fond enfermées et les éclats sont retirés. Ordre fixe V3 (joie … champion). Retirer ensuite la planche de la config pour qu'un `free-sheet` ne l'écrase pas (ex. Cécile Star).
