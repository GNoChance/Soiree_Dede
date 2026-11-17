// Génère src/data/tenues-art.generated.ts depuis costumes-manifest.json
// (seule source de vérité : les dossiers hors manifest sont ignorés).
// Usage : node tools/slice-chibis/gen-art.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const manifest = JSON.parse(fs.readFileSync(path.join(HERE, 'costumes-manifest.json'), 'utf8'));

// Stickers découpés mais ratés (vus sur out-check) : repli sur une autre expression.
const BAD = [
  'carole/actor/pouces',
  'cecile/pyro/colere',
  'cecile/philosopher/pouces',
];

const EXPR = 'joie colere pleurs boude reflexion dodo bisou clin_oeil surprise pouces timide determine'.split(' ');
const art = [];
const portraits = [];
const extras = {}; // "slug/dossier" -> nombre de stickers bonus (extra1..extraN)
for (const slug of Object.keys(manifest).sort()) {
  for (const c of manifest[slug].costumes ?? []) {
    if (!fs.existsSync(path.join(ROOT, 'public/chibis', slug, c, 'joie.webp'))) continue;
    art.push(`${slug}/${c}`);
    let n = 0;
    while (fs.existsSync(path.join(ROOT, 'public/chibis', slug, c, `extra${n + 1}.webp`))) n++;
    if (n) extras[`${slug}/${c}`] = n;
    // expressions non dessinées sur la planche : écartées (repli sur une voisine)
    for (const e of EXPR) if (!fs.existsSync(path.join(ROOT, 'public/chibis', slug, c, `${e}.webp`)) && !BAD.includes(`${slug}/${c}/${e}`)) BAD.push(`${slug}/${c}/${e}`);
  }
  for (const c of manifest[slug].portraits ?? []) {
    if (fs.existsSync(path.join(ROOT, 'public/chibis', slug, 'portraits', c + '.webp'))) portraits.push(`${slug}/${c}`);
  }
}

const list = (name, arr) =>
  `export const ${name}: readonly string[] = [` + (arr.length ? '\n' + arr.map((a) => `  '${a}',`).join('\n') + '\n' : '') + ']';

fs.writeFileSync(path.join(ROOT, 'src/data/tenues-art.generated.ts'), [
  '// GENERE par tools/slice-chibis/gen-art.mjs - ne pas editer a la main.',
  '// "slug/dossier" des stickers de tenue (public/chibis/<slug>/<dossier>/<expression>.webp, hors default).',
  list('TENUE_ART', art),
  '',
  '// "slug/dossier" des portraits de tenue (public/chibis/<slug>/portraits/<dossier>.webp).',
  list('TENUE_PORTRAITS', portraits),
  '',
  '// Stickers bonus hors liste (extra1..extraN.webp) : "slug/dossier" -> nombre. Libellés : src/data/tenue-extras.ts.',
  'export const TENUE_EXTRAS: Readonly<Record<string, number>> = ' + JSON.stringify(extras, null, 2) + ';',
  '',
  '// "slug/dossier/expression" ratés au découpage : repli sur une expression voisine.',
  list('TENUE_ART_BAD', BAD),
  '',
].join('\n'));
console.log(`tenues-art.generated.ts : ${art.length} tenues, ${portraits.length} portraits, ${BAD.length} stickers écartés`);
