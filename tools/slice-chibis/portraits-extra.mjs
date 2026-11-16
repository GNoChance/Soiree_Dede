// Découpe une planche de portraits « libre » (N illustrations sur fond uni) en portraits de tenue.
// Usage : node tools/slice-chibis/portraits-extra.mjs <slug> <planche.png> <nom1> <nom2> ...
// Les noms suivent l'ordre de lecture (rangées de haut en bas, gauche -> droite).
// Sorties : public/chibis/<slug>/portraits/<nom>.webp (+ @thumb) ; ajoute les noms au manifest.
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dilate, close, label, fillHoles } from './costumes-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const [slug, file, ...names] = process.argv.slice(2);
if (!slug || !file || !names.length) { console.error('usage: <slug> <planche.png> <noms...>'); process.exit(1); }
const PSIZE = 512, PTHUMB = 160, PMARGIN = 16, Q = 88;

const { data: rgb, info } = await sharp(path.resolve(ROOT, file)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: w, height: h } = info;
const samp = [];
for (let x = 0; x < w; x += 7) samp.push(x, (h - 1) * w + x);
for (let y = 0; y < h; y += 7) samp.push(y * w, y * w + w - 1);
const med = [0, 1, 2].map((c) => { const v = samp.map((i) => rgb[i * 3 + c]).sort((a, b) => a - b); return v[v.length >> 1]; });
const D = new Uint8Array(w * h);
for (let i = 0; i < w * h; i++) {
  const d = Math.max(Math.abs(rgb[i * 3] - med[0]), Math.abs(rgb[i * 3 + 1] - med[1]), Math.abs(rgb[i * 3 + 2] - med[2]));
  D[i] = d > 32 ? 1 : 0;
}
const M = fillHoles(close(D, w, h, 2), w, h);
const { lab, n, comps } = label(M, w, h);
let big = [];
for (let l = 1; l <= n; l++) if (comps[l].a > 15000) big.push({ l, ...comps[l] });
console.log(`fond=${med.join(',')} composantes=${big.length} (attendu ${names.length})`);
if (big.length !== names.length) { console.error('nombre de composantes inattendu'); process.exit(2); }
// rangées : regroupe par chevauchement vertical des centres
big.sort((a, b) => a.cy - b.cy);
const rows = [];
for (const c of big) {
  const r = rows.find((rw) => Math.abs(rw[0].cy - c.cy) < (rw[0].y1 - rw[0].y0) / 2);
  if (r) r.push(c); else rows.push([c]);
}
const ordered = rows.flatMap((r) => r.sort((a, b) => a.cx - b.cx));

async function finalize(rgba, F, sw, sh) {
  let bx0 = sw, by0 = sh, bx1 = -1, by1 = -1;
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) if (F[y * sw + x]) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
  const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
  const inner = PSIZE - 2 * PMARGIN, sc = Math.min(inner / bw, inner / bh);
  const tw = Math.max(1, Math.round(bw * sc)), th = Math.max(1, Math.round(bh * sc));
  const a1 = Buffer.alloc(sw * sh), rgbBuf = Buffer.alloc(sw * sh * 3);
  for (let i = 0; i < sw * sh; i++) { a1[i] = F[i] ? 255 : 0; rgbBuf[i * 3] = rgba[i * 4]; rgbBuf[i * 3 + 1] = rgba[i * 4 + 1]; rgbBuf[i * 3 + 2] = rgba[i * 4 + 2]; }
  const ext = { left: bx0, top: by0, width: bw, height: bh };
  const rgbUp = await sharp(rgbBuf, { raw: { width: sw, height: sh, channels: 3 } }).extract(ext).resize(tw, th, { kernel: 'lanczos3' }).sharpen({ sigma: 0.7, m1: 0.8, m2: 1.2 }).raw().toBuffer();
  const aUp = await sharp(a1, { raw: { width: sw, height: sh, channels: 1 } }).extract(ext).resize(tw, th, { kernel: 'cubic' }).blur(1.1).linear(2.6, -2.6 * 127).extractChannel(0).raw().toBuffer();
  const px = Buffer.alloc(tw * th * 4);
  for (let i = 0; i < tw * th; i++) { px[i * 4] = rgbUp[i * 3]; px[i * 4 + 1] = rgbUp[i * 3 + 1]; px[i * 4 + 2] = rgbUp[i * 3 + 2]; px[i * 4 + 3] = aUp[i]; }
  const p2 = await sharp(px, { raw: { width: tw, height: th, channels: 4 } }).png().toBuffer();
  return sharp({ create: { width: PSIZE, height: PSIZE, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } } })
    .composite([{ input: p2, left: Math.round((PSIZE - tw) / 2), top: Math.round((PSIZE - th) / 2) }]).png().toBuffer();
}

const dir = path.join(ROOT, 'public/chibis', slug, 'portraits');
fs.mkdirSync(dir, { recursive: true });
const tiles = [];
for (let k = 0; k < ordered.length; k++) {
  const c = ordered[k], pad = 12;
  const x0 = Math.max(0, c.x0 - pad), y0 = Math.max(0, c.y0 - pad), x1 = Math.min(w - 1, c.x1 + pad), y1 = Math.min(h - 1, c.y1 + pad);
  const sw = x1 - x0 + 1, sh = y1 - y0 + 1;
  const m = new Uint8Array(sw * sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) if (lab[(y + y0) * w + x + x0] === c.l) m[y * sw + x] = 1;
  const F = dilate(m, sw, sh, 2);
  const rgba = Buffer.alloc(sw * sh * 4, 255);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const kk = y * sw + x;
    if (F[kk]) { const i = ((y + y0) * w + x + x0) * 3; rgba[kk * 4] = rgb[i]; rgba[kk * 4 + 1] = rgb[i + 1]; rgba[kk * 4 + 2] = rgb[i + 2]; }
  }
  const png = await finalize(rgba, F, sw, sh);
  await sharp(png).webp({ quality: Q, alphaQuality: 92 }).toFile(path.join(dir, `${names[k]}.webp`));
  await sharp(png).resize(PTHUMB, PTHUMB, { kernel: 'lanczos3' }).webp({ quality: Q, alphaQuality: 92 }).toFile(path.join(dir, `${names[k]}@thumb.webp`));
  tiles.push(png);
  console.log(`${names[k]} <- composante (${c.x0},${c.y0})-(${c.x1},${c.y1})`);
}
// planche contact
const T = 300;
const comps2 = await Promise.all(tiles.map(async (p, k) => ({ input: await sharp(p).resize(T, T).png().toBuffer(), left: k * T, top: 24 })));
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${T * tiles.length}" height="${T + 24}"><rect width="100%" height="100%" fill="#23263a"/>`;
names.forEach((nm, i) => { svg += `<text x="${i * T + 6}" y="18" font-size="16" font-family="Arial" fill="#ffd54a">${nm}</text>`; });
svg += '</svg>';
fs.mkdirSync(path.join(HERE, 'out-check'), { recursive: true });
await sharp(Buffer.from(svg)).composite(comps2).png().toFile(path.join(HERE, 'out-check', `portraits-extra-${slug}.png`));
// manifest
const mf = path.join(HERE, 'costumes-manifest.json');
const manifest = JSON.parse(fs.readFileSync(mf, 'utf8'));
manifest[slug] ??= { costumes: [], portraits: [] };
for (const nm of names) if (!manifest[slug].portraits.includes(nm)) manifest[slug].portraits.push(nm);
fs.writeFileSync(mf, JSON.stringify(manifest, null, 2) + '\n');
console.log('manifest mis à jour');
