// Découpe d'une planche 4x3 (fond noir, liseré blanc) dont les liserés sont ouverts ou se touchent,
// là où free-sheet.mjs échoue (le fond « fuit » dans le dessin, stickers soudés).
// 1. liseré blanc dilaté (referme les trous) -> fond = noir relié au bord sans traverser ce liseré ;
// 2. composantes du reste ; une composante à cheval sur deux cases est coupée à la ligne la plus fine ;
// 3. chaque morceau va à la case de son centre ; sortie identique à free-sheet (256 px + miniature 128).
// Usage : node tools/slice-chibis/closed-sheet.mjs <planche.png> <slug> <dossier> [--preview]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const [file, slug, dir] = process.argv.slice(2);
const preview = process.argv.includes('--preview');
if (!file || !slug || !dir) throw new Error('usage : closed-sheet.mjs <planche.png> <slug> <dossier> [--preview]');
const MAP = 'joie colere pleurs boude reflexion dodo bisou clin_oeil surprise amoureux cool gamer'.split(' ');
const SIZE = 256, THUMB = 128, MARGIN = 9, Q = 88, RING = 5, CLOSE = 6, COLS = 4, ROWS = 3;

const { data, info } = await sharp(path.resolve(ROOT, file)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, N = W * H;
const dark = new Uint8Array(N), white = new Uint8Array(N);
for (let i = 0; i < N; i++) {
  const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
  dark[i] = Math.max(r, g, b) < 45 ? 1 : 0;
  white[i] = Math.min(r, g, b) > 200 ? 1 : 0;
}
function dilate(m, r) {
  // dilatation carrée séparable (rapide)
  const t = new Uint8Array(N), o = new Uint8Array(N);
  for (let y = 0; y < H; y++) { let run = -1e9; for (let x = 0; x < W; x++) { if (m[y * W + x]) run = x; if (x - run <= r) t[y * W + x] = 1; } run = 1e9; for (let x = W - 1; x >= 0; x--) { if (m[y * W + x]) run = x; if (run - x <= r) t[y * W + x] = 1; } }
  for (let x = 0; x < W; x++) { let run = -1e9; for (let y = 0; y < H; y++) { if (t[y * W + x]) run = y; if (y - run <= r) o[y * W + x] = 1; } run = 1e9; for (let y = H - 1; y >= 0; y--) { if (t[y * W + x]) run = y; if (run - y <= r) o[y * W + x] = 1; } }
  return o;
}
function flood(pass) {
  const out = new Uint8Array(N), st = [];
  for (let x = 0; x < W; x++) st.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) st.push(y * W, y * W + W - 1);
  while (st.length) {
    const p = st.pop();
    if (out[p] || !pass[p]) continue;
    out[p] = 1;
    const x = p % W;
    if (x > 0) st.push(p - 1);
    if (x < W - 1) st.push(p + 1);
    if (p >= W) st.push(p - W);
    if (p < N - W) st.push(p + W);
  }
  return out;
}
const ring = dilate(white, CLOSE);
const pass = new Uint8Array(N);
for (let i = 0; i < N; i++) pass[i] = dark[i] && !ring[i] ? 1 : 0;
const bg0 = flood(pass);
// le liseré dilaté a repoussé le fond de CLOSE px : on rend au fond le noir collé à ce fond
const near = dilate(bg0, CLOSE + 1);
const fg = new Uint8Array(N);
for (let i = 0; i < N; i++) fg[i] = bg0[i] || (near[i] && dark[i]) ? 0 : 1;

// composantes
const lab = new Int32Array(N);
const comps = [];
for (let p = 0; p < N; p++) {
  if (!fg[p] || lab[p]) continue;
  const id = comps.length + 1, s = [p], px = [];
  lab[p] = id;
  while (s.length) {
    const q = s.pop(); px.push(q);
    const x = q % W;
    for (const r of [x > 0 ? q - 1 : -1, x < W - 1 ? q + 1 : -1, q - W, q + W]) if (r >= 0 && r < N && fg[r] && !lab[r]) { lab[r] = id; s.push(r); }
  }
  comps.push(px);
}
const cw = W / COLS, ch = H / ROWS;
const cellOf = (x, y) => Math.min(ROWS - 1, Math.floor(y / ch)) * COLS + Math.min(COLS - 1, Math.floor(x / cw));
const cells = Array.from({ length: COLS * ROWS }, () => []);
for (const px of comps) {
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (const q of px) { const x = q % W, y = (q / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  // frontières de case franchies (plusieurs stickers soudés) : ligne/colonne la moins remplie à ±60 px de la frontière
  const cutY = [], cutX = [];
  for (let k = 1; k < ROWS; k++) { const b = k * ch; if (y0 < b - 30 && y1 > b + 30) { const cnt = new Map(); for (const q of px) { const y = (q / W) | 0; if (Math.abs(y - b) <= 60) cnt.set(y, (cnt.get(y) ?? 0) + 1); } let best = b, bv = Infinity; for (const [y, v] of cnt) if (v < bv) { bv = v; best = y; } cutY.push(best); } }
  for (let k = 1; k < COLS; k++) { const b = k * cw; if (x0 < b - 30 && x1 > b + 30) { const cnt = new Map(); for (const q of px) { const x = q % W; if (Math.abs(x - b) <= 60) cnt.set(x, (cnt.get(x) ?? 0) + 1); } let best = b, bv = Infinity; for (const [x, v] of cnt) if (v < bv) { bv = v; best = x; } cutX.push(best); } }
  if (!cutX.length && !cutY.length) {
    let sx = 0, sy = 0; for (const q of px) { sx += q % W; sy += (q / W) | 0; }
    { const c = cells[cellOf(sx / px.length, sy / px.length)]; for (const q of px) c.push(q); }
    continue;
  }
  // coupe droite à la ligne la moins remplie près de chaque frontière franchie
  const parts = new Map();
  for (const q of px) {
    const x = q % W, y = (q / W) | 0;
    const key = `${cutX.filter((c) => x >= c).length},${cutY.filter((c) => y >= c).length}`;
    if (!parts.has(key)) parts.set(key, []);
    parts.get(key).push(q);
  }
  for (const part of parts.values()) {
    let sx = 0, sy = 0; for (const q of part) { sx += q % W; sy += (q / W) | 0; }
    { const c = cells[cellOf(sx / part.length, sy / part.length)]; for (const q of part) c.push(q); }
  }
}

async function tile(px) {
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (const q of px) { const x = q % W, y = (q / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const pad = RING + 3;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
  const sw = x1 - x0 + 1, sh = y1 - y0 + 1, n = sw * sh;
  let m = new Uint8Array(n);
  for (const q of px) m[(((q / W) | 0) - y0) * sw + (q % W) - x0] = 1;
  const at = (q) => ((((q / sw) | 0) + y0) * W + (q % sw) + x0);
  const ldil = (src, r) => {
    const t = new Uint8Array(n), o = new Uint8Array(n);
    for (let y = 0; y < sh; y++) { let run = -1e9; for (let x = 0; x < sw; x++) { if (src[y * sw + x]) run = x; if (x - run <= r) t[y * sw + x] = 1; } run = 1e9; for (let x = sw - 1; x >= 0; x--) { if (src[y * sw + x]) run = x; if (run - x <= r) t[y * sw + x] = 1; } }
    for (let x = 0; x < sw; x++) { let run = -1e9; for (let y = 0; y < sh; y++) { if (t[y * sw + x]) run = y; if (y - run <= r) o[y * sw + x] = 1; } run = 1e9; for (let y = sh - 1; y >= 0; y--) { if (t[y * sw + x]) run = y; if (run - y <= r) o[y * sw + x] = 1; } }
    return o;
  };
  // poches de fond noir enfermées entre ce sticker et un voisin : refaites avec le SEUL liseré de ce sticker
  const lw = new Uint8Array(n);
  for (let q = 0; q < n; q++) lw[q] = m[q] && white[at(q)] ? 1 : 0;
  const lring = ldil(lw, CLOSE);
  const bgL = new Uint8Array(n), st = [];
  for (let x = 0; x < sw; x++) st.push(x, (sh - 1) * sw + x);
  for (let y = 0; y < sh; y++) st.push(y * sw, y * sw + sw - 1);
  while (st.length) {
    const q = st.pop();
    if (bgL[q] || !(!m[q] || (dark[at(q)] && !lring[q]))) continue;
    bgL[q] = 1;
    const x = q % sw;
    if (x > 0) st.push(q - 1);
    if (x < sw - 1) st.push(q + 1);
    if (q >= sw) st.push(q - sw);
    if (q < n - sw) st.push(q + sw);
  }
  const nearL = ldil(bgL, CLOSE + 1);
  for (let q = 0; q < n; q++) if (m[q] && (bgL[q] || (nearL[q] && dark[at(q)]))) m[q] = 0;
  // éclats isolés : lamelles laissées par une ligne de coupe (< 150 px) ou bouts de liseré d'un voisin (petits et presque tout blancs)
  const seen = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    if (!m[p] || seen[p]) continue;
    const s = [p], comp = [];
    seen[p] = 1;
    while (s.length) {
      const q = s.pop(); comp.push(q);
      const x = q % sw;
      for (const r of [x > 0 ? q - 1 : -1, x < sw - 1 ? q + 1 : -1, q - sw, q + sw]) if (r >= 0 && r < n && m[r] && !seen[r]) { seen[r] = 1; s.push(r); }
    }
    const wcount = comp.filter((q) => white[at(q)]).length;
    if (comp.length < 150 || (comp.length < 1500 && wcount > comp.length * 0.6)) for (const q of comp) m[q] = 0;
  }
  // anneau blanc (comme free-sheet) : dilatation locale de RING px
  const F = new Uint8Array(sw * sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    if (!m[y * sw + x]) continue;
    for (let dy = -RING; dy <= RING; dy++) for (let dx = -RING; dx <= RING; dx++) {
      const yy = y + dy, xx = x + dx;
      if (yy >= 0 && yy < sh && xx >= 0 && xx < sw && dx * dx + dy * dy <= RING * RING) F[yy * sw + xx] = 1;
    }
  }
  const rgba = Buffer.alloc(sw * sh * 4);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const q = y * sw + x, i = ((y + y0) * W + x + x0) * 3;
    if (m[q]) { rgba[q * 4] = data[i]; rgba[q * 4 + 1] = data[i + 1]; rgba[q * 4 + 2] = data[i + 2]; rgba[q * 4 + 3] = 255; }
    else if (F[q]) { rgba[q * 4] = 255; rgba[q * 4 + 1] = 255; rgba[q * 4 + 2] = 255; rgba[q * 4 + 3] = 255; }
  }
  const inner = SIZE - 2 * MARGIN, sc = Math.min(inner / sw, inner / sh);
  const tw = Math.max(1, Math.round(sw * sc)), th = Math.max(1, Math.round(sh * sc));
  const up = await sharp(rgba, { raw: { width: sw, height: sh, channels: 4 } }).resize(tw, th, { kernel: 'lanczos3' }).sharpen({ sigma: 0.6 }).png().toBuffer();
  return sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: up, left: Math.round((SIZE - tw) / 2), top: Math.round((SIZE - th) / 2) }]).png().toBuffer();
}

const tiles = [];
for (const px of cells) tiles.push(await tile(px));
const CHECK = path.join(HERE, 'out-check');
fs.mkdirSync(CHECK, { recursive: true });
const cell = 200, board = [];
for (let i = 0; i < tiles.length; i++) {
  const t = await sharp(tiles[i]).resize(cell - 20, cell - 20).png().toBuffer();
  const svg = Buffer.from(`<svg width="${cell}" height="${cell}"><rect width="${cell}" height="${cell}" fill="#7a8"/><text x="6" y="22" font-size="20" font-family="Arial" font-weight="bold">${i}</text></svg>`);
  board.push({ input: await sharp(svg).composite([{ input: t, left: 10, top: 16 }]).png().toBuffer(), left: (i % 6) * cell, top: Math.floor(i / 6) * cell });
}
await sharp({ create: { width: 6 * cell, height: 2 * cell, channels: 3, background: '#333' } }).composite(board).png().toFile(path.join(CHECK, `${dir}-idx.png`));
if (preview) process.exit(0);
const out = path.join(ROOT, 'public/chibis', slug, dir);
fs.mkdirSync(out, { recursive: true });
for (let i = 0; i < tiles.length; i++) {
  await sharp(tiles[i]).webp({ quality: Q, alphaQuality: 92 }).toFile(path.join(out, `${MAP[i]}.webp`));
  await sharp(tiles[i]).resize(THUMB, THUMB, { kernel: 'lanczos3' }).webp({ quality: Q, alphaQuality: 92 }).toFile(path.join(out, `${MAP[i]}@thumb.webp`));
}
console.log(`${slug}/${dir} : ${tiles.length} stickers`);
