import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const SRC = path.join(ROOT, 'assets-source/planches');
const OUT = path.join(ROOT, 'public/chibis');
const CHECK = path.join(HERE, 'out-check');
const STD = 'joie,colere,pleurs,boude,reflexion,dodo,bisou,clin_oeil,surprise,amoureux,cool,gamer'.split(',');
const EXPR = {
  carole: 'joie,colere,pleurs,boude,reflexion,dodo,bisou,clin_oeil,surprise,pouces,timide,charmee'.split(','),
  nini: 'joie,colere,pleurs,boude,reflexion,dodo,bisou,clin_oeil,surprise,pouces,timide,gamer'.split(','),
};
const SLUGS = 'kevin cycy dede manon mika cecile carole marius nini'.split(' ');
const INK_THR = 80;
const BIG_AREA = 4000;
const MIN_DECOR = 80; // distance au blanc pour compter comme contenu
const MERGE_R = 1; // dilatation pour regrouper un sticker et ses decorations
const FILL_R = 4; // fermeture avant remplissage des trous
const RING_R = 8; // anneau blanc ajoute (total ~12px depuis l'encre)
const ERODE_R = 3;
const SIZE = 512, THUMB = 160, MARGIN = 16, Q = 85;

// dilatation exacte par transformee de distance (Felzenszwalb)
function edt1d(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s;
    while (true) {
      const p = v[k];
      s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p);
      if (s <= z[k]) k--; else break;
    }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) ** 2 + f[v[k]];
  }
}
function dilate(mask, w, h, r) {
  const INF = 1e12, g = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = mask[i] ? 0 : INF;
  const m = Math.max(w, h), f = new Float64Array(m), d = new Float64Array(m), v = new Int32Array(m), z = new Float64Array(m + 1);
  for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) f[y] = g[y * w + x]; edt1d(f, h, d, v, z); for (let y = 0; y < h; y++) g[y * w + x] = d[y]; }
  for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) f[x] = g[y * w + x]; edt1d(f, w, d, v, z); for (let x = 0; x < w; x++) g[y * w + x] = d[x]; }
  const out = new Uint8Array(w * h), r2 = r * r + 0.5;
  for (let i = 0; i < w * h; i++) out[i] = g[i] <= r2 ? 1 : 0;
  return out;
}
function label(mask, w, h) {
  const lab = new Int32Array(w * h), stack = [];
  let n = 0;
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || lab[i]) continue;
    n++; lab[i] = n; stack.push(i);
    while (stack.length) {
      const p = stack.pop(), x = p % w, y = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (mask[q] && !lab[q]) { lab[q] = n; stack.push(q); }
      }
    }
  }
  return { lab, n };
}
function fillHoles(mask, w, h) {
  const outside = new Uint8Array(w * h), stack = [];
  const push = (i) => { if (!mask[i] && !outside[i]) { outside[i] = 1; stack.push(i); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (stack.length) {
    const p = stack.pop(), x = p % w, y = (p / w) | 0;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (y > 0) push(p - w);
    if (y < h - 1) push(p + w);
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = outside[i] ? 0 : 1;
  return out;
}

async function findStickers(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const m = Math.min(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]);
    ink[i] = 255 - m > INK_THR ? 1 : 0;
  }
  const { lab, n } = label(dilate(ink, w, h, MERGE_R), w, h);
  const comps = Array.from({ length: n + 1 }, () => ({ area: 0, sx: 0, sy: 0 }));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const l = lab[y * w + x]; if (!l) continue;
    const c = comps[l]; c.area++; c.sx += x; c.sy += y;
  }
  const log = [];
  const cellOf = new Int32Array(n + 1).fill(-1);
  for (let l = 1; l <= n; l++) {
    const c = comps[l]; if (c.area < BIG_AREA) continue;
    const col = Math.min(3, Math.floor((c.sx / c.area) / w * 4)), row = Math.min(2, Math.floor((c.sy / c.area) / h * 3));
    cellOf[l] = row * 4 + col;
  }
  // centre de chaque cellule = centre de bbox des grosses composantes
  const cb = Array.from({ length: 12 }, () => ({ x0: 1e9, y0: 1e9, x1: -1, y1: -1 }));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!ink[i]) continue; const l = lab[i]; if (!l || cellOf[l] < 0) continue;
    const k = cb[cellOf[l]]; k.x0 = Math.min(k.x0, x); k.x1 = Math.max(k.x1, x); k.y0 = Math.min(k.y0, y); k.y1 = Math.max(k.y1, y);
  }
  const centers = cb.map((k) => (k.x1 < 0 ? null : [(k.x0 + k.x1) / 2, (k.y0 + k.y1) / 2]));
  for (let l = 1; l <= n; l++) {
    if (cellOf[l] >= 0) continue;
    const c = comps[l]; if (c.area < MIN_DECOR) continue;
    const cx = c.sx / c.area, cy = c.sy / c.area;
    let best = -1, bd = 1e9;
    centers.forEach((ct, k) => { if (!ct) return; const d = Math.hypot(cx - ct[0], cy - ct[1]); if (d < bd) { bd = d; best = k; } });
    cellOf[l] = best;
  }
  log.push('  cellules: ' + [...new Set(Array.from(cellOf).filter((v) => v >= 0))].sort((a,b)=>a-b).join(','));
  const ncells = new Set(Array.from(cellOf).filter((v) => v >= 0)).size;
  const boxes = Array.from({ length: 12 }, () => ({ x0: 1e9, y0: 1e9, x1: -1, y1: -1 }));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!ink[i]) continue; const l = lab[i]; if (!l || cellOf[l] < 0) continue;
    const b = boxes[cellOf[l]]; b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y);
  }
  const ordered = boxes.map((b, id) => ({ ...b, id }));
  return { data, w, h, ink, lab, cellOf, ordered, ncores: ncells, log };
}

async function render(S, g, pad = 40) {
  const { data, w, h, ink, lab, cellOf } = S;
  const x0 = Math.max(0, g.x0 - pad), y0 = Math.max(0, g.y0 - pad), x1 = Math.min(w - 1, g.x1 + pad), y1 = Math.min(h - 1, g.y1 + pad);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const m = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const i = (y + y0) * w + x + x0;
    if (ink[i] && lab[i] && cellOf[lab[i]] === g.id) m[y * cw + x] = 1;
  }
  const C = fillHoles(dilate(m, cw, ch, FILL_R), cw, ch);
  const F = dilate(C, cw, ch, RING_R);
  const rgba = Buffer.alloc(cw * ch * 4, 255);
  const a1 = Buffer.alloc(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const k = y * cw + x, i = ((y + y0) * w + x + x0) * 3;
    if (C[k]) { rgba[k * 4] = data[i]; rgba[k * 4 + 1] = data[i + 1]; rgba[k * 4 + 2] = data[i + 2]; }
    a1[k] = F[k] ? 255 : 0;
  }
  const alpha = await sharp(a1, { raw: { width: cw, height: ch, channels: 1 } }).blur(1.2).extractChannel(0).raw().toBuffer();
  for (let k = 0; k < cw * ch; k++) rgba[k * 4 + 3] = alpha[k];
  let bx0 = cw, by0 = ch, bx1 = -1, by1 = -1;
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (F[y * cw + x]) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
  const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
  const inner = SIZE - 2 * MARGIN, sc = Math.min(inner / bw, inner / bh);
  const tw = Math.max(1, Math.round(bw * sc)), th = Math.max(1, Math.round(bh * sc));
  const piece = await sharp(rgba, { raw: { width: cw, height: ch, channels: 4 } })
    .extract({ left: bx0, top: by0, width: bw, height: bh })
    .resize(tw, th, { kernel: 'lanczos3' }).png().toBuffer();
  return sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } } })
    .composite([{ input: piece, left: Math.round((SIZE - tw) / 2), top: Math.round((SIZE - th) / 2) }]).png().toBuffer();
}

fs.mkdirSync(CHECK, { recursive: true });
let total = 0, bytes = 0, problems = 0;

// Usage : node slice.mjs                -> tout (planches par defaut + tenues)
//         node slice.mjs --tenues       -> seulement les planches de tenue
//         node slice.mjs kevin kevin-star -> seulement ces planches (<slug> ou <slug>-<tenue>)
const argv = process.argv.slice(2);
const onlyTenues = argv.includes('--tenues');
const wanted = argv.filter((a) => !a.startsWith('--'));
const want = (key, isTenue) => (onlyTenues && !isTenue ? false : wanted.length === 0 || wanted.includes(key));

// Planches a traiter : <slug>.png (tenue "default") puis <slug>-<tenue>.png
const sheets = [];
for (const slug of SLUGS) sheets.push({ slug, tenue: 'default', file: path.join(SRC, slug + '.png') });
const TENUE_RE = new RegExp('^(' + SLUGS.join('|') + ')-([a-z0-9_]+)\\.png$');
for (const f of fs.readdirSync(SRC).sort()) {
  const m = TENUE_RE.exec(f);
  if (m) sheets.push({ slug: m[1], tenue: m[2], file: path.join(SRC, f) });
}
const catalogue = fs.readFileSync(path.join(ROOT, 'src/data/tenues.ts'), 'utf8');

for (const { slug, tenue, file } of sheets) {
  const isTenue = tenue !== 'default';
  const key = isTenue ? slug + '-' + tenue : slug;
  if (!want(key, isTenue)) continue;
  if (!fs.existsSync(file)) { console.log(key + ': planche absente (' + path.relative(ROOT, file) + ')'); if (!isTenue) problems++; continue; }
  if (isTenue && !catalogue.includes("'" + tenue + "'")) console.log('  !! tenue "' + tenue + '" absente de src/data/tenues.ts (et de supabase/features/tenues.sql ?)');
  // Meme ordre d'expressions que la planche par defaut du perso.
  const exprs = EXPR[slug] || STD;
  const S = await findStickers(file);
  console.log(`${key}: ${S.w}x${S.h}, ${S.ncores} composantes (dilatees)`);
  S.log.forEach((l) => console.log(l));
  if (S.ncores < 12) { console.log(`  !! moins de 12 stickers (${S.ncores})`); problems++; continue; }
  const dir = path.join(OUT, slug, tenue);
  fs.mkdirSync(dir, { recursive: true });
  const tiles = [];
  for (let i = 0; i < 12; i++) {
    const png = await render(S, S.ordered[i]);
    const big = path.join(dir, `${exprs[i]}.webp`), thumb = path.join(dir, `${exprs[i]}@thumb.webp`);
    await sharp(png).webp({ quality: Q, alphaQuality: 90 }).toFile(big);
    await sharp(png).resize(THUMB, THUMB).webp({ quality: Q, alphaQuality: 90 }).toFile(thumb);
    bytes += fs.statSync(big).size + fs.statSync(thumb).size; total += 2;
    tiles.push({ png, name: exprs[i] });
  }
  const T = 256, W = T * 4, H = T * 3;
  let checker = '';
  for (let y = 0; y < H / 32; y++) for (let x = 0; x < W / 32; x++) checker += `<rect x="${x * 32}" y="${y * 32}" width="32" height="32" fill="${(x + y) % 2 ? '#3a3f55' : '#2a2e40'}"/>`;
  const labels = tiles.map((t, i) => `<text x="${(i % 4) * T + 6}" y="${Math.floor(i / 4) * T + 18}" font-size="16" font-family="Arial" fill="#ff0" stroke="#000" stroke-width="3" paint-order="stroke">${t.name}</text>`).join('');
  const comps = await Promise.all(tiles.map(async (t, i) => ({ input: await sharp(t.png).resize(T, T).png().toBuffer(), left: (i % 4) * T, top: Math.floor(i / 4) * T })));
  const bg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${checker}</svg>`);
  const lb = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${labels}</svg>`);
  await sharp(bg).composite([...comps, { input: lb }]).png().toFile(path.join(CHECK, key + '.png'));
}
console.log(`\n${total} fichiers, ${(bytes / 1024).toFixed(0)} Ko, problemes: ${problems}`);

// --- src/data/tenues-art.generated.ts : régénéré depuis costumes-manifest.json.
await import('./gen-art.mjs');
