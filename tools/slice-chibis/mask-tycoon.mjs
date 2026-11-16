// Remplace le logo de marque du portrait « tycoon » de Dédé par une plaque « Tour des Potes ».
// À relancer après portraits-extra.mjs (qui régénère le portrait d'origine).
// Usage : node tools/slice-chibis/mask-tycoon.mjs
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(HERE, '../../public/chibis/dede/portraits');
const big = path.join(DIR, 'tycoon.webp');

const plate = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
  <rect x="186" y="441" width="148" height="40" rx="8" fill="#FFF4DD" stroke="#C62828" stroke-width="3"/>
  <text x="260" y="466" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="14"
        fill="#C62828" text-anchor="middle" letter-spacing="0.5">TOUR DES POTES</text>
</svg>`);

// Lecture/écriture par buffers (Windows verrouille les fichiers ouverts par sharp).
sharp.cache(false);
const src = await sharp(fs.readFileSync(big)).png().toBuffer();
const out = await sharp(src).composite([{ input: plate }]).png().toBuffer();
fs.writeFileSync(big, await sharp(out).webp({ quality: 88, alphaQuality: 92 }).toBuffer());
fs.writeFileSync(path.join(DIR, 'tycoon@thumb.webp'),
  await sharp(out).resize(160, 160, { kernel: 'lanczos3' }).webp({ quality: 88, alphaQuality: 92 }).toBuffer());
console.log('logo masqué');
