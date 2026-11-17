// Découpe de planches « libres » générées par ChatGPT (grilles variées, planche + portrait combinés, collages).
// Usage : node tools/slice-chibis/free-sheet.mjs <config.mjs> [--preview] [nom ...]
//   --preview : écrit out-check/<nom>-idx.png (stickers numérotés dans l'ordre de lecture) sans rien publier.
// Config : export default { slug, src, sheets: [{ name, file, region?, n, dir, map }], portraits: [{ file, crop?, dir }] }
//   map[i] = expression du i-ème sticker (ordre de lecture) ou null (ignoré).
// Méthode : fond = pixels proches de la couleur de bord (ou blancs) atteints par inondation depuis le bord de la zone ;
// les n plus grosses composantes restantes sont les stickers, les petites (?, zzz, cœurs) sont rattachées au plus proche ;
// contour blanc reconstruit (dilatation), agrandissement lanczos3 -> 256 (+ @thumb 128).
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dilate, erode, close, label, fillHoles } from './costumes-lib.mjs';

sharp.cache(false);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const args = process.argv.slice(2);
const cfgPath = args.find((a) => a.endsWith('.mjs'));
const preview = args.includes('--preview');
const only = args.filter((a) => !a.startsWith('--') && a !== cfgPath);
const CFG = (await import(pathToFileURL(path.resolve(cfgPath)).href)).default;
const SIZE = 256, THUMB = 128, MARGIN = 9, Q = 88, RING = 5;
const PSIZE = 512, PTHUMB = 160;
const CHECK = path.join(HERE, 'out-check');
fs.mkdirSync(CHECK, { recursive: true });

async function load(file) {
  const { data, info } = await sharp(fs.readFileSync(path.join(ROOT, CFG.src, file))).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { rgb: data, W: info.width, H: info.height };
}

function segment(img, region, n, tol, white = true, openR = 3) {
  const { rgb, W } = img;
  const [x0, y0, x1, y1] = region;
  const w = x1 - x0, h = y1 - y0;
  const px = (x, y) => ((y + y0) * W + x + x0) * 3;
  const samp = [];
  for (let x = 0; x < w; x += 3) samp.push(px(x, 0), px(x, h - 1));
  for (let y = 0; y < h; y += 3) samp.push(px(0, y), px(w - 1, y));
  const bg = [0, 1, 2].map((c) => { const v = samp.map((i) => rgb[i + c]).sort((a, b) => a - b); return v[v.length >> 1]; });
  const like = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = px(x, y), r = rgb[i], g = rgb[i + 1], b = rgb[i + 2];
    const d = Math.max(Math.abs(r - bg[0]), Math.abs(g - bg[1]), Math.abs(b - bg[2]));
    const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
    like[y * w + x] = d <= tol || (white && mn >= 232 && mx - mn <= 16) ? 1 : 0;
  }
  // inondation du fond depuis le bord
  const BG = new Uint8Array(w * h), st = [];
  const push = (p) => { if (like[p] && !BG[p]) { BG[p] = 1; st.push(p); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (st.length) {
    const p = st.pop(), x = p % w, y = (p / w) | 0;
    if (x > 0) push(p - 1); if (x < w - 1) push(p + 1); if (y > 0) push(p - w); if (y < h - 1) push(p + w);
  }
  const FG = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) FG[i] = BG[i] ? 0 : 1;
  // ouverture : supprime les filets fins (halos de contour, traits de séparation) avant l'étiquetage
  const O = openR ? dilate(erode(FG, w, h, openR), w, h, openR) : FG;
  const { lab, n: nl, comps } = label(O, w, h);
  const all = [];
  for (let l = 1; l <= nl; l++) all.push({ l, ...comps[l] });
  all.sort((a, b) => b.a - a.a);
  const big = all.slice(0, n), small = all.slice(n).filter((c) => { const cw = c.x1 - c.x0 + 1, ch = c.y1 - c.y0 + 1; return c.a >= 20 && Math.max(cw, ch) / Math.min(cw, ch) <= 4 && c.a >= 0.25 * cw * ch; });
  const areas = big.map((c) => c.a);
  if (all[n]) console.log(`  aires: plus petit sticker ${Math.min(...areas)}, 1re deco ${all[n].a}`);
  const owner = new Map(big.map((c, k) => [c.l, k]));
  const gap = (a, b) => Math.max(0, a.x0 - b.x1, b.x0 - a.x1) + Math.max(0, a.y0 - b.y1, b.y0 - a.y1);
  for (const c of small) {
    let best = -1, bd = 1e9;
    big.forEach((b, k) => { const d = gap(c, b); if (d < bd) { bd = d; best = k; } });
    if (bd <= (CFG.decoGap ?? 30)) owner.set(c.l, best);
  }
  // ordre de lecture : rangées par centre vertical
  const order = big.map((c, k) => ({ k, cx: (c.x0 + c.x1) / 2, cy: (c.y0 + c.y1) / 2, hh: c.y1 - c.y0 }));
  order.sort((a, b) => a.cy - b.cy);
  const rows = [];
  for (const o of order) { const r = rows.find((rw) => Math.abs(rw[0].cy - o.cy) < rw[0].hh * 0.45); if (r) r.push(o); else rows.push([o]); }
  const ordered = rows.flatMap((r) => r.sort((a, b) => a.cx - b.cx)).map((o) => o.k);
  return { lab, FG, w, h, x0, y0, owner, ordered, big };
}

async function cutSticker(img, seg, k, closeR = 2) {
  const { rgb, W } = img;
  const { lab, FG, w, h, x0, y0, owner } = seg;
  let bx0 = w, by0 = h, bx1 = -1, by1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const l = lab[y * w + x]; if (l && owner.get(l) === k) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; } }
  const pad = RING + 3;
  const cx0 = Math.max(0, bx0 - pad), cy0 = Math.max(0, by0 - pad), cx1 = Math.min(w - 1, bx1 + pad), cy1 = Math.min(h - 1, by1 + pad);
  const sw = cx1 - cx0 + 1, sh = cy1 - cy0 + 1;
  let m = new Uint8Array(sw * sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { const l = lab[(y + cy0) * w + x + cx0]; if (l && owner.get(l) === k) m[y * sw + x] = 1; }
  // pixels d'origine proches de la composante ouverte (rend les détails fins sans les filets éloignés)
  const near = dilate(m, sw, sh, 4);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { const q = y * sw + x; m[q] = near[q] && FG[(y + cy0) * w + x + cx0] ? 1 : 0; }
  // closeR > 2 : referme les contours troués (ex. casquette blanche collée au liseré blanc du sticker)
  m = fillHoles(close(m, sw, sh, closeR), sw, sh);
  const F = fillHoles(dilate(m, sw, sh, RING), sw, sh);
  const rgba = Buffer.alloc(sw * sh * 4);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const q = y * sw + x, i = ((y + cy0 + y0) * W + x + cx0 + x0) * 3;
    if (m[q]) { rgba[q * 4] = rgb[i]; rgba[q * 4 + 1] = rgb[i + 1]; rgba[q * 4 + 2] = rgb[i + 2]; rgba[q * 4 + 3] = 255; }
    else if (F[q]) { rgba[q * 4] = 255; rgba[q * 4 + 1] = 255; rgba[q * 4 + 2] = 255; rgba[q * 4 + 3] = 255; }
  }
  const inner = SIZE - 2 * MARGIN, sc = Math.min(inner / sw, inner / sh);
  const tw = Math.max(1, Math.round(sw * sc)), th = Math.max(1, Math.round(sh * sc));
  const up = await sharp(rgba, { raw: { width: sw, height: sh, channels: 4 } }).resize(tw, th, { kernel: 'lanczos3' }).sharpen({ sigma: 0.6 }).png().toBuffer();
  return sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: up, left: Math.round((SIZE - tw) / 2), top: Math.round((SIZE - th) / 2) }]).png().toBuffer();
}

async function contact(tiles, labels, file) {
  const cols = 6, cell = 200, rowsN = Math.ceil(tiles.length / cols);
  const board = [];
  for (let i = 0; i < tiles.length; i++) {
    const svg = Buffer.from(`<svg width="${cell}" height="${cell}"><rect width="${cell}" height="${cell}" fill="#7a8"/><text x="6" y="22" font-size="20" font-family="Arial" font-weight="bold" fill="#000">${labels[i]}</text></svg>`);
    const t = await sharp(tiles[i]).resize(cell - 20, cell - 20).png().toBuffer();
    const c = await sharp(svg).composite([{ input: t, left: 10, top: 16 }]).png().toBuffer();
    board.push({ input: c, left: (i % cols) * cell, top: Math.floor(i / cols) * cell });
  }
  await sharp({ create: { width: cols * cell, height: rowsN * cell, channels: 3, background: '#333' } }).composite(board).png().toFile(file);
}

const OUT = path.join(ROOT, 'public/chibis', CFG.slug);
for (const s of CFG.sheets) {
  if (only.length && !only.includes(s.name)) continue;
  const img = await load(s.file);
  const region = s.region ?? [0, 0, img.W, img.H];
  console.log(`${s.name} (${s.file}) zone ${region.join(',')}`);
  const seg = segment(img, region, s.n, s.tol ?? 24, s.white ?? true, s.open ?? 3);
  const tiles = [];
  for (const k of seg.ordered) tiles.push(await cutSticker(img, seg, k, s.closeR ?? 2));
  if (preview) {
    await contact(tiles, tiles.map((_, i) => String(i)), path.join(CHECK, `${s.name}-idx.png`));
    continue;
  }
  const dir = path.join(OUT, s.dir);
  fs.mkdirSync(dir, { recursive: true });
  const labels = [];
  const used = [];
  for (let i = 0; i < tiles.length; i++) {
    const exprs = [s.map[i]].flat().filter(Boolean);
    for (const e of exprs) {
      await sharp(tiles[i]).webp({ quality: Q, alphaQuality: 92 }).toFile(path.join(dir, `${e}.webp`));
      await sharp(tiles[i]).resize(THUMB, THUMB, { kernel: 'lanczos3' }).webp({ quality: Q, alphaQuality: 92 }).toFile(path.join(dir, `${e}@thumb.webp`));
      used.push(e); labels.push(e);
    }
  }
  await contact(used.map((e) => fs.readFileSync(path.join(dir, `${e}.webp`))), labels, path.join(CHECK, `${s.name}.png`));
  console.log(`  -> ${s.dir}: ${used.join(' ')}`);
}

// Portrait « sticker » sur fond noir : le noir relié au bord de l'image devient transparent (+2 px pour la frange).
async function cutoutBlack(file) {
  const { data, info } = await sharp(fs.readFileSync(file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const dark = (i) => Math.max(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) < 48;
  const out = new Uint8Array(w * h);
  const stack = [];
  const push = (i) => { if (!out[i] && dark(i)) { out[i] = 1; stack.push(i); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (stack.length) {
    const i = stack.pop(), x = i % w, y = (i - x) / w;
    if (x > 0) push(i - 1); if (x < w - 1) push(i + 1); if (y > 0) push(i - w); if (y < h - 1) push(i + w);
  }
  let cur = out;
  for (let k = 0; k < 2; k++) {
    const nx = cur.slice();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!cur[i] && ((x > 0 && cur[i - 1]) || (x < w - 1 && cur[i + 1]) || (y > 0 && cur[i - w]) || (y < h - 1 && cur[i + w]))) nx[i] = 1;
    }
    cur = nx;
  }
  for (let i = 0; i < w * h; i++) if (cur[i]) data[i * 4 + 3] = 0;
  return sharp(data, { raw: { width: w, height: h, channels: 4 } });
}

for (const p of CFG.portraits ?? []) {
  if (only.length && !only.includes(p.dir) && !only.includes('portraits')) continue;
  const img = sharp(fs.readFileSync(path.join(ROOT, CFG.src, p.file)));
  const meta = await img.metadata();
  const [x0, y0, x1, y1] = p.crop ?? [0, 0, meta.width, meta.height];
  if (preview) continue;
  const base = await (p.cutout ? await cutoutBlack(path.join(ROOT, CFG.src, p.file)) : sharp(fs.readFileSync(path.join(ROOT, CFG.src, p.file)))).extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 })
    .resize(PSIZE, PSIZE, { fit: 'inside', kernel: 'lanczos3' }).png().toBuffer();
  const dir = path.join(OUT, 'portraits');
  fs.mkdirSync(dir, { recursive: true });
  await sharp(base).webp({ quality: Q }).toFile(path.join(dir, `${p.dir}.webp`));
  await sharp(base).resize(PTHUMB, PTHUMB, { fit: 'inside', kernel: 'lanczos3' }).webp({ quality: Q }).toFile(path.join(dir, `${p.dir}@thumb.webp`));
  console.log(`portrait ${p.dir} <- ${p.file} [${x0},${y0},${x1},${y1}]`);
}
