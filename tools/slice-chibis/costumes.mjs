// Decoupe des planches "tenues" : <slug>-mega.png (12 panneaux x 12 stickers) et <slug>-portraits.png (12 portraits).
// Usage : node tools/slice-chibis/costumes.mjs [slug ...]   (sans argument : tous les persos dont une planche existe)
//
// Methode (planches mega), par panneau :
//  1. masque "anneau" M (pixels blancs du contour des stickers ; kevin : "encre" non blanche sur carte blanche),
//     ferme de 1-2 px, puis "interieur" I = tout ce qui n'est pas atteint en inondant le fond depuis le bord ;
//  2. noyaux = I erode de 8 px -> grille reguliere cols x rows (12 cases) ;
//  3. bassins versants (watershed sur la distance au fond) germes sur les 12 noyaux : separe les stickers colles ;
//     les decorations isolees (?, zzz, coeurs, !) sont rattachees au sticker le plus proche ;
//  4. par sticker : anneau local ferme + trous remplis (les poches de fond entre voisins sont exclues) ;
//     etiquettes de texte (cycy, manon) coupees juste au-dessus du texte ;
//  5. contour blanc reconstruit (erosion 1 + dilatation 3), agrandissement lanczos3 -> 256x256 (+ @thumb 128).
// Portraits : stickers sur fond creme -> masque = ecart au fond creme.
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dilate, erode, close, label, fillHoles, fillHolesWall, fillHolesWalls, growLabels, edtSq, competeLabels, watershed } from './costumes-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const SRC = path.join(ROOT, 'assets-source/costumes');
const OUT = path.join(ROOT, 'public/chibis');
const CHECK = path.join(HERE, 'out-check');
const MANIFEST = path.join(HERE, 'costumes-manifest.json');

const SLUGS = 'cecile manon cycy mika kevin nini carole marius dede'.split(' ');
const COSTUMES = 'spy cinema student croupier painter werewolf pyro pirate philosopher archer actor coach'.split(' ');
const EXPR = 'joie colere pleurs boude reflexion dodo bisou clin_oeil surprise pouces timide determine'.split(' ');

// Bornes des panneaux (mesurees : bandes de blanc "page" entre les panneaux).
// rg : [debut,fin] des 2 gouttieres horizontales ; top/bot : haut/bas du 1er/3e panneau ; cg : 3 gouttieres verticales ; left/right.
// cols x rows de stickers par panneau ; label : etiquettes texte sous les stickers ; ink : stickers sur carte blanche.
const CG = [[311, 316], [623, 629], [936, 942]];
const CFG = {
  manon:  { rg: [[396, 403], [828, 834]], top: 3, bot: 1249, cols: 4, rows: 3, label: true },
  cycy:   { rg: [[414, 419], [819, 822]], top: 5, bot: 1249, cols: 4, rows: 3, label: true },
  mika:   { rg: [[416, 421], [833, 838]], top: 5, bot: 1249, cols: 3, rows: 4 },
  nini:   { rg: [[418, 424], [834, 841]], top: 5, bot: 1249, cols: 3, rows: 4 },
  carole: { rg: [[411, 414], [832, 835]], top: 4, bot: 1249, cols: 4, rows: 3 },
  marius: { rg: [[389, 393], [792, 796]], top: 4, bot: 1243, cols: 4, rows: 3 },
  kevin:  { ptop: [158, 576, 982], rg: [[407, 424], [818, 830]], top: 12, bot: 1234, cg: [[307, 316], [618, 634], [930, 945]], left: 12, right: 1243, cols: 4, rows: 3, ink: true },
  cecile: { rg: [[449, 458], [797, 815]], top: 118, bot: 1143, cols: 4, rows: 3 },
  dede:   { rg: [[417, 422], [828, 832]], top: 6, bot: 1249, cols: 4, rows: 3 },
};
function panelBox(cfg, pr, pc, tag) {
  const cg = cfg.cg || CG, left = cfg.left ?? 3, right = cfg.right ?? 1250;
  return {
    x0: (pc ? cg[pc - 1][1] + 1 : left) + INSET, x1: (pc < 3 ? cg[pc][0] : right) - INSET,
    y0: cfg.ptop ? cfg.ptop[pr] : (pr ? cfg.rg[pr - 1][1] + 1 : cfg.top) + INSET, y1: (pr < 2 ? cfg.rg[pr][0] : cfg.bot) - INSET, tag,
  };
}

const WT = +(process.env.WT || 222);
const NT = +(process.env.NT || 12);
const INSET = +(process.env.INSET || 1);
const RING = +(process.env.RING || 9); // epaisseur d'anneau blanc reprise autour du contenu
const BGT = +(process.env.BGT || 70);
const CM = +(process.env.CM || 40); // cout de traversee d'un pixel d'anneau (contre 1 pour un autre pixel)
const HLO = +(process.env.HLO || 196), HNT = +(process.env.HNT || 40);
const RT = +(process.env.RT || 4);
const PEEL = +(process.env.PEEL || 0.12);
const BIGBG = +(process.env.BIGBG || 700);
const UNAN = +(process.env.UNAN || 0.75);
const RINGW = +(process.env.RINGW || 7);
const AMAX = +(process.env.AMAX || 1.4), AMIN = +(process.env.AMIN || 0.45);
const OPEN_R = +(process.env.OPEN_R || 3);
const INKSAT = +(process.env.INKSAT || 55);
const FRINGE = +(process.env.FRINGE || 7);
const EDGEINK = +(process.env.EDGEINK || 6);
const SEEDX = +(process.env.SEEDX || 0.28), SEEDY = +(process.env.SEEDY || 0.25);
const SEAL = +(process.env.SEAL || 5);
const PAL = +(process.env.PAL || 0.6);
const DECO_D = +(process.env.DECO_D || 26);
const DEPTH = +(process.env.DEPTH || 3);
const POCKET = +(process.env.POCKET || 0.6);
const SIZE = 256, THUMB = 128, MARGIN = 9, Q = 88;
const PSIZE = 512, PTHUMB = 160, PMARGIN = 16;

const argv = process.argv.slice(2);
const wanted = argv.filter((a) => !a.startsWith('--'));
const dbgPanel = process.env.DBGP || '';

// ---------------------------------------------------------------- masques
// modes : R (blanc), R3 (blanc, ferme 3), W (blanc|sombre), D / D6 (sombre), ink (non blanc, carte blanche)
function ringMask(rgb, W, box, cw, ch, mode) {
  const M = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const i = ((y + box.y0) * W + x + box.x0) * 3;
    const r = rgb[i], g = rgb[i + 1], b = rgb[i + 2];
    const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
    const white = mode === 'L' ? mn >= 206 && mx - mn <= 34 : mode === 'S' ? mn >= 238 && mx - mn <= 8 : mode === 'T' ? mn >= 247 && mx - mn <= 6 : mn >= WT && mx - mn <= NT;
    let v;
    if (mode === 'ink') v = mn < 226;
    else if (mode[0] === 'D') v = mx < (mode === 'D6' ? 95 : 80);
    else if (mode === 'W') v = white || mx < 48;
    else v = white;
    M[y * cw + x] = v ? 1 : 0;
  }
  if (mode === 'H') { // hysteresis : pixels "presque blancs" relies a l'anneau strict (comble les trous de l'anneau)
    const lo = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const i = ((y + box.y0) * W + x + box.x0) * 3, mn = Math.min(rgb[i], rgb[i + 1], rgb[i + 2]), mx = Math.max(rgb[i], rgb[i + 1], rgb[i + 2]);
      lo[y * cw + x] = mn >= HLO && mx - mn <= HNT ? 1 : 0;
    }
    const st = [];
    for (let i = 0; i < cw * ch; i++) if (M[i]) st.push(i);
    while (st.length) {
      const p = st.pop(), x = p % cw, y = (p / cw) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
        const q = ny * cw + nx; if (!M[q] && lo[q]) { M[q] = 1; st.push(q); }
      }
    }
  }
  const cr = mode === 'ink' ? 2 : mode === 'R3' ? 3 : mode === 'R2' ? 2 : 1;
  return { M, cr };
}

function bboxOf(m, cw, ch) {
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (m[y * cw + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { x0, y0, x1, y1 };
}

// ligne de coupe des etiquettes : haut du texte - marge (texte = pixel sombre entoure de blanc a gauche et a droite)
function labelCut(rgb, W, ox, oy, mask, cw, ch, bb) {
  const isW = (x, y) => { const i = ((y + oy) * W + x + ox) * 3; return Math.min(rgb[i], rgb[i + 1], rgb[i + 2]) >= 225; };
  const isD = (x, y) => { const i = ((y + oy) * W + x + ox) * 3; return Math.max(rgb[i], rgb[i + 1], rgb[i + 2]) < 120; };
  const yMin = bb.y0 + Math.floor((bb.y1 - bb.y0) * 0.6);
  const cnt = new Map();
  for (let y = yMin; y <= bb.y1; y++) {
    let c = 0;
    for (let x = bb.x0 + 3; x <= bb.x1 - 3; x++) {
      if (!mask[y * cw + x] || !isD(x, y)) continue;
      if (x < 4 || x > cw - 5) continue;
      let l = false, r = false;
      for (let k = 1; k <= 3; k++) { if (isW(x - k, y)) l = true; if (isW(x + k, y)) r = true; }
      if (l && r) c++;
    }
    cnt.set(y, c);
  }
  // premiere ligne de texte : >=2 pixels "lettre" sur 2 lignes consecutives
  for (let y = yMin; y <= bb.y1 - 1; y++) if ((cnt.get(y) || 0) >= 2 && (cnt.get(y + 1) || 0) >= 2) return y - 5;
  return null;
}

// carte "profondeur locale" : max sur 11x11 de la distance au fond de l'interieur I (un centre de sticker = un pic)
function depthMap(I, cw, ch) {
  const dtq = edtSq(Uint8Array.from(I, (v) => (v ? 0 : 1)), cw, ch);
  for (let i = 0; i < dtq.length; i++) dtq[i] = Math.sqrt(dtq[i]);
  const R = 5, tmp = new Float32Array(cw * ch), lm = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { let m = 0; for (let k = -R; k <= R; k++) { const xx = x + k; if (xx >= 0 && xx < cw) m = Math.max(m, dtq[y * cw + xx]); } tmp[y * cw + x] = m; }
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { let m = 0; for (let k = -R; k <= R; k++) { const yy = y + k; if (yy >= 0 && yy < ch) m = Math.max(m, tmp[yy * cw + x]); } lm[y * cw + x] = m; }
  return { lm, cw, ch };
}
// grille reguliere cols x rows (cx0, dx, cy0, dy) maximisant la somme des profondeurs locales aux 12 centres,
// sommee sur une ou plusieurs cartes (consensus de tous les panneaux d'un perso, ancrage haut-gauche du panneau).
// base : {cx0,dx,cy0,dy} -> recherche locale (+-8 px / +-4 px) autour d'une grille de consensus.
function fitGridLm(maps, cfg, base) {
  const { cols, rows } = cfg;
  const cw = Math.min(...maps.map((m) => m.cw)), ch = Math.min(...maps.map((m) => m.ch));
  const chMax = Math.max(...maps.map((m) => m.ch));
  let best = null;
  const rng = (lo, hi, st) => { const r = []; for (let v = lo; v <= hi + 1e-6; v += st) r.push(v); return r; };
  const dxs = base ? rng(base.dx - 4, base.dx + 4, 1) : rng((cw / cols) * 0.66, (cw / cols) * 1.02, 2);
  const dys = base ? rng(base.dy - 4, base.dy + 4, 1) : rng((chMax * 0.5) / rows, (chMax * (cfg.ptop ? 1.02 : 0.9)) / rows, 2);
  for (const dx of dxs) for (const dy of dys) {
    const cx0s = base ? rng(base.cx0 - 8, base.cx0 + 8, 1) : rng(Math.max(8, cw * 0.04), Math.min(cw * 0.3, cw - (cols - 1) * dx - 8), 2);
    const cy0s = base ? rng(base.cy0 - 10, base.cy0 + 10, 1) : rng(chMax * (cfg.ptop ? 0.05 : 0.16), chMax * 0.55, 2);
    for (const cx0 of cx0s) for (const cy0 of cy0s) {
      if (cx0 < 0 || cx0 + (cols - 1) * dx > cw) continue;
      const cyLast = cy0 + (rows - 1) * dy;
      if (!base && (cyLast > chMax - dy * 0.28 || cyLast < chMax - dy * 0.8)) continue;
      let sc = 0;
      for (const m of maps) for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const x = Math.round(cx0 + c * dx), y = Math.round(cy0 + r * dy); if (x < 0 || y < 0 || x >= m.cw || y >= m.ch) { sc -= 50; continue; } sc += m.lm[y * m.cw + x]; }
      sc /= maps.length;
      if (!best || sc > best.sc) best = { sc, cx0, dx, cy0, dy };
    }
  }
  if (!best) return null;
  const cells = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push({ r, c, cx: best.cx0 + c * best.dx, cy: best.cy0 + r * best.dy });
  return { cells, pitchX: best.dx, pitchY: best.dy, score: best.sc / (rows * cols), base: best };
}

// elagage : ne garde que le corps (plus grosse composante) et les decorations plausibles (compactes, au-dessus / a cote du
// corps, pas des debris fins ni sous le milieu du corps). Les cases de decoration dont la forme est coupee sont ecartees.
function pruneDeco(S, cw, ch) {
  const lb = label(S, cw, ch);
  if (!lb.n) return;
  let bl = 1; for (let l = 2; l <= lb.n; l++) if (lb.comps[l].a > lb.comps[bl].a) bl = l;
  const B = lb.comps[bl], bh = B.y1 - B.y0 + 1, midY = B.y0 + bh * 0.62;
  for (let l = 1; l <= lb.n; l++) {
    if (l === bl) continue;
    const c = lb.comps[l], w = c.x1 - c.x0 + 1, h = c.y1 - c.y0 + 1;
    const keep = c.a >= 25 && c.cy <= midY && Math.max(w, h) / Math.max(1, Math.min(w, h)) <= 3.2 && c.y1 <= B.y1 - bh * 0.25;
    if (!keep) for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) if (lb.lab[y * cw + x] === l) S[y * cw + x] = 0;
  }
}

// controle qualite commun : aire proche de la mediane, forme pleine, taille plausible
function qcStickers(out, cw, ch, px, py, cfg) {
  if (process.env.DBGK && globalThis.__tag === dbgPanel) { const o = out[+process.env.DBGK]; const lb = label(o.S, cw, ch); { const m = Buffer.alloc(cw * ch); for (let i = 0; i < cw * ch; i++) m[i] = o.S[i] ? 255 : 0; sharp(m, { raw: { width: cw, height: ch, channels: 1 } }).png().toFile(path.join(CHECK, 'dbgSk.png')); } console.log('S comps', lb.comps.slice(1).map((c) => `${c.a}@${c.x0},${c.y0}-${c.x1},${c.y1}`).join(' '), 'ch', ch); }
  out.forEach((o) => pruneDeco(o.S, cw, ch));
  const ars = out.map((o) => { let n = 0; for (let i = 0; i < o.S.length; i++) n += o.S[i]; return n; });
  const med = cfg._single || [...ars].sort((a, b) => a - b)[out.length >> 1];
  out.forEach((o, k) => {
    const bb = bboxOf(o.S, cw, ch);
    const bw = bb.x1 - bb.x0 + 1, bh = bb.y1 - bb.y0 + 1;
    const fill = bb.x1 >= 0 ? ars[k] / (bw * bh) : 0;
    const lim = cfg.label ? 0.5 : 0.62;
    if (bb.x1 < 0 || ars[k] < med * lim || ars[k] > med * 1.6 || fill < 0.45 || bw > px * 1.7 || bh > py * 1.5) { o.info.bad = true; o.info.why = `aire ${(ars[k] / med).toFixed(2)} fill ${fill.toFixed(2)} ${bw}x${bh}`; }
  });
}

// coupe des etiquettes de texte (cycy, manon) sous chaque sticker
function cutLabels(rgb, W, box, S, g, px, cw, ch) {
  const bb = bboxOf(S, cw, ch);
  if (bb.x1 < 0) return null;
  const half = px / 2;
  const cut = labelCut(rgb, W, box.x0, box.y0, S, cw, ch, { x0: Math.max(0, Math.round(g.cx - half)), x1: Math.min(cw - 1, Math.round(g.cx + half)), y0: bb.y0, y1: bb.y1 });
  return cut;
}

// case d'une decoration (?, zzz, !, coeur) : dans le tiers haut / cote de SON sticker
function decoCell(cells, px, py, x, y) {
  let bk = 0, bd = 1e9;
  for (let k = 0; k < cells.length; k++) {
    const dx = (x - cells[k].cx) / px, dy = (y - cells[k].cy) / py;
    if (dy < -0.65 || dy > 0.3 || dx < -0.75 || dx > 0.85) continue;
    const d = dx * dx + (dy + 0.2) ** 2;
    if (d < bd) { bd = d; bk = k + 1; }
  }
  return bk;
}

// germes : ellipse centree sur le point le plus "profond" (loin du fond) de l'interieur I autour du centre de case
function stickerSeeds(cells, px, py, cw, ch, M) {
  const seed = new Int32Array(cw * ch);
  const I = M ? fillHolesWall(close(M, cw, ch, 2), cw, ch) : null;
  const dt = I ? edtSq(Uint8Array.from(I, (v) => (v ? 0 : 1)), cw, ch) : null;
  cells.forEach((g, k) => {
    let cx = g.cx, cy = g.cy;
    if (dt) {
      let bd = 36, bx = -1, by = -1; // profondeur mini 6 px (carre 36)
      for (let y = Math.round(g.cy - 0.38 * py); y <= Math.round(g.cy + 0.38 * py); y++) for (let x = Math.round(g.cx - 0.42 * px); x <= Math.round(g.cx + 0.42 * px); x++) {
        if (x < 0 || y < 0 || x >= cw || y >= ch) continue;
        const d = dt[y * cw + x] - 0.004 * ((x - g.cx) ** 2 + (y - g.cy) ** 2);
        if (d > bd) { bd = d; bx = x; by = y; }
      }
      if (bx >= 0) { cx = bx; cy = by; }
    }
    for (let y = Math.round(cy - py * SEEDY); y <= Math.round(cy + py * SEEDY); y++) for (let x = Math.round(cx - px * SEEDX); x <= Math.round(cx + px * SEEDX); x++) {
      if (x < 0 || y < 0 || x >= cw || y >= ch) continue;
      const nx = (x - cx) / (px * SEEDX), ny = (y - cy) / (py * SEEDY);
      if (nx * nx + ny * ny <= 1 && (!dt || dt[y * cw + x] > 0 || true)) seed[y * cw + x] = k + 1;
    }
  });
  return seed;
}

// ---------------------------------------------------------------- un panneau, un mode
// Principe : l'anneau blanc M separe le fond (qui touche les bords / la bande du titre), les poches de fond enclos,
// les decorations et les interieurs de stickers. Les composantes hors-anneau portant un germe de sticker sont
// des stickers ; celles reliees aux bords = fond (sa palette sert a reperer les poches) ; les petites composantes
// colorees isolees = decorations. Un Dijkstra multi-germes (anneau fin = traversee couteuse) delimite ensuite chaque sticker.
function runMode(rgb, W, box, cfg, mode, baseGrid) {
  globalThis.__tag = box.tag;
  const cw = box.x1 - box.x0, ch = box.y1 - box.y0, N = cw * ch;
  const { M, cr } = ringMask(rgb, W, box, cw, ch, mode);
  const I = fillHolesWall(close(M, cw, ch, cr), cw, ch);
  const grid = fitGridLm([depthMap(I, cw, ch)], cfg, baseGrid);
  if (process.env.DBGALL) console.log(box.tag, mode, grid && [grid.score.toFixed(1), grid.cells[0].cx.toFixed(0), grid.pitchX.toFixed(0), grid.cells[0].cy.toFixed(0), grid.pitchY.toFixed(0)].join(' '));
  if (!grid || grid.score < 12) return null;
  const { cells, pitchX: px, pitchY: py } = grid;
  const rowTop = Math.min(...cells.map((c) => c.cy)) - py * 0.62;
  const out = mode === 'ink' ? segInk(rgb, W, box, cfg, M, grid, rowTop) : segRing(rgb, W, box, cfg, close(M, cw, ch, cr), grid, rowTop);
  qcStickers(out, cw, ch, px, py, cfg);
  out.grid = grid;
  return out;
}

// Segmentation d'un passage de fermeture r de l'anneau : renvoie pour chaque sticker son "noyau" (contenu hors anneau
// retenu) + l'anneau qui lui appartient, et l'aire de sa composante germe (une fuite par un trou d'anneau la fait exploser)
function ownershipPass(Mr, seed, cells, cw, ch, rowTop, px, py, rgb, W, box) {
  const N = cw * ch;
  // propriete des pixels d'anneau : Dijkstra depuis les germes de stickers, un anneau FIN coute cher a traverser
  // (deux stickers voisins aux anneaux colles se partagent l'anneau a mi-chemin)
  const dNon = edtSq(Uint8Array.from(Mr, (v) => (v ? 1 : 0)), cw, ch);
  const cost = new Float32Array(N);
  for (let i = 0; i < N; i++) cost[i] = Mr[i] ? (dNon[i] <= RT * RT ? CM : 2) : 1;
  const L = competeLabels(seed, cost, cw, ch);
  // composantes hors anneau : germe (interieur de sticker) / bord (fond) / sinon fragment d'UN sticker si tout l'anneau
  // qui la borde lui appartient (detail interne, decoration entouree de son anneau), poche de fond sinon
  const nonM = new Uint8Array(N);
  for (let i = 0; i < N; i++) nonM[i] = !Mr[i] && ((i / cw) | 0) >= rowTop ? 1 : 0;
  const lb = label(nonM, cw, ch, false);
  const seededBy = new Int32Array(lb.n + 1), nSeeds = new Int32Array(lb.n + 1), touch = new Uint8Array(lb.n + 1);
  const seen = new Set();
  for (let i = 0; i < N; i++) {
    const l = lb.lab[i]; if (!l) continue;
    if (seed[i]) { if (!seededBy[l]) seededBy[l] = seed[i]; const key = l * 64 + seed[i]; if (!seen.has(key)) { seen.add(key); nSeeds[l]++; } }
    const x = i % cw, y = (i / cw) | 0;
    if (x <= 8 || x >= cw - 9 || y >= ch - 7 || y <= rowTop + 1.5) touch[l] = 1;
  }
  const kind = new Int32Array(lb.n + 1); // k+1 retenu, 0 = fond / poche, -1 = germes fusionnes
  // palette du fond (composantes reliees au bord / au titre, ou grands aplats sans germe), tolerance +-1 niveau (16)
  const binOf = (i) => { const j = ((((i / cw) | 0) + box.y0) * W + (i % cw) + box.x0) * 3; return ((rgb[j] >> 4) << 8) | ((rgb[j + 1] >> 4) << 4) | (rgb[j + 2] >> 4); };
  const pal = new Set();
  for (let i = 0; i < N; i++) { const l = lb.lab[i]; if (l && !seededBy[l] && ((touch[l] && lb.comps[l].a >= 200) || lb.comps[l].a >= BIGBG)) pal.add(binOf(i)); }
  const inPal = (i) => { const b = binOf(i), r = b >> 8, g = (b >> 4) & 15, bl = b & 15; for (let dr = -1; dr <= 1; dr++) for (let dg = -1; dg <= 1; dg++) for (let db = -1; db <= 1; db++) { const rr = r + dr, gg = g + dg, bb = bl + db; if (rr < 0 || gg < 0 || bb < 0 || rr > 15 || gg > 15 || bb > 15) continue; if (pal.has((rr << 8) | (gg << 4) | bb)) return true; } return false; };
  const bodyD = []; // corps des stickers (composantes-germes) dilate, pour juger la proximite des decorations
  const bodyM = [], bodyDr = {};
  const nearBody = (k, c, l, r) => {
    if (!bodyM[k]) { const m = new Uint8Array(N); for (let i = 0; i < N; i++) { const q = lb.lab[i]; if (q && seededBy[q] === k + 1 && kind[q] === k + 1) m[i] = 1; } bodyM[k] = m; }
    const key = k * 100 + r;
    if (!bodyDr[key]) bodyDr[key] = dilate(bodyM[k], cw, ch, r);
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) if (lb.lab[y * cw + x] === l && bodyDr[key][y * cw + x]) return true;
    return false;
  };
  for (let l = 1; l <= lb.n; l++) if (seededBy[l]) kind[l] = nSeeds[l] === 1 ? seededBy[l] : -1;
  for (let l = 1; l <= lb.n; l++) {
    if (seededBy[l] || touch[l]) continue;
    const c = lb.comps[l];
    if (c.a < 12 || c.a > 3000 || c.x1 - c.x0 > 1.3 * px || c.y1 - c.y0 > 1.3 * py) continue; // trop grand : fond
    const hist = new Map();
    let tot = 0, np = 0;
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) {
      if (lb.lab[y * cw + x] !== l) continue;
      if (inPal(y * cw + x)) np++;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= cw || yy >= ch) continue;
        const q = yy * cw + xx; if (!Mr[q]) continue;
        hist.set(L[q], (hist.get(L[q]) || 0) + 1); tot++;
      }
    }
    let best = 0, bv = 0; for (const [v, n] of hist) if (n > bv) { bv = n; best = v; }
    if (!best) continue;
    const unan = bv / tot;
    const g = cells[best - 1];
    const inner = Math.abs(c.cx - g.cx) < 0.42 * px && Math.abs(c.cy - g.cy) < 0.42 * py; // detail interne du sticker
    if (inner) { if (unan >= UNAN && np < PAL * c.a) kind[l] = best; continue; }
    // hors du coeur : decoration (?, zzz, !, coeur, 4 etoiles) ou poche de fond entre deux stickers
    if (np >= PAL * c.a || unan < 0.55) continue; // couleur du fond ou borde par plusieurs stickers : poche
    let dk = 0;
    for (const r of [4, 8, 14, 20, DECO_D]) {
      for (let k = 0; k < cells.length; k++) {
        const dx = (c.cx - cells[k].cx) / px, dy = (c.cy - cells[k].cy) / py;
        if (dy < -0.66 || dy > 0.2 || dx < -0.7 || dx > 0.9) continue;
        if (nearBody(k, c, l, r)) { dk = k + 1; break; }
      }
      if (dk) break;
    }
    if (dk) kind[l] = dk;
  }
  const area = new Array(cells.length).fill(0);
  for (let l = 1; l <= lb.n; l++) if (kind[l] > 0 && seededBy[l] === kind[l]) area[kind[l] - 1] += lb.comps[l].a;
  const leaked = new Array(cells.length).fill(false);
  for (let l = 1; l <= lb.n; l++) if (kind[l] === -1) for (let k = 0; k < cells.length; k++) { /* marque ci-dessous */ }
  for (let i = 0; i < N; i++) { const l = lb.lab[i]; if (l && kind[l] === -1 && seed[i]) leaked[seed[i] - 1] = true; }
  const own = new Int32Array(N);
  for (let i = 0; i < N; i++) { const l = lb.lab[i]; if (l && kind[l] > 0) own[i] = kind[l]; }
  // les composantes-germes : ouverture (coupe les cols minces = fuites par un trou d'anneau) puis plus grosse composante
  for (let k = 0; k < cells.length; k++) {
    const m = new Uint8Array(N);
    for (let i = 0; i < N; i++) { const l = lb.lab[i]; if (l && kind[l] === k + 1 && seededBy[l] === k + 1) m[i] = 1; }
    const op = dilate(erode(m, cw, ch, OPEN_R), cw, ch, OPEN_R);
    const lo = label(op, cw, ch);
    let bl = 0, ba = 0; for (let l = 1; l <= lo.n; l++) if (lo.comps[l].a > ba) { ba = lo.comps[l].a; bl = l; }
    for (let i = 0; i < N; i++) if (m[i] && !(bl && lo.lab[i] === bl)) own[i] = 0;
    area[k] = ba;
  }
  if (process.env.DBGR && globalThis.__tag === dbgPanel) { const o = Buffer.alloc(N * 3); for (let i = 0; i < N; i++) { const l = lb.lab[i]; if (Mr[i]) { o[i * 3] = 255; o[i * 3 + 1] = 255; o[i * 3 + 2] = 255; } else if (l && kind[l] === -1) { o[i * 3] = 255; } else if (l && kind[l] > 0) { o[i * 3 + 1] = 160; } else if (l) { o[i * 3 + 2] = 160; } } sharp(o, { raw: { width: cw, height: ch, channels: 3 } }).png().toFile(path.join(CHECK, `dbgR-${process.env.DBGR}.png`)); }
  return { L, own, area, leaked };
}

function segRing(rgb, W, box, cfg, M0, grid, rowTop) {
  const cw = box.x1 - box.x0, ch = box.y1 - box.y0, N = cw * ch;
  const { cells, pitchX: px, pitchY: py } = grid;
  const seed = stickerSeeds(cells, px, py, cw, ch, null);
  // les stickers coupes par le bord du panneau : on scelle les bords gauche / droit / bas (murs d'anneau)
  const Mb = Uint8Array.from(M0);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (x < SEAL || x >= cw - SEAL || y >= ch - 2) Mb[y * cw + x] = 1;
  // un sticker dont l'anneau a un trou fusionne avec le fond : on ferme l'anneau de plus en plus (r = 0..6) jusqu'a
  // retrouver une composante d'aire normale (reference = mediane des aires a r = 0)
  const CK = new Array(cells.length).fill(null), chosen = new Array(cells.length).fill(-1);
  let Aref = 0;
  for (const r of [0, 1, 2, 3, 4, 5, 6, 8, 10]) {
    if (chosen.every((c) => c >= 0)) break;
    const Mr = r ? close(Mb, cw, ch, r) : Mb;
    const P = ownershipPass(Mr, seed, cells, cw, ch, rowTop, px, py, rgb, W, box);
    if (process.env.DBGP && dbgPanel === box.tag) console.log("r", r, P.area.join(" "), P.leaked.map((v) => (v ? 1 : 0)).join(""));
    if (r === 0) Aref = [...P.area].sort((a, b) => a - b)[cells.length >> 1];
    for (let k = 0; k < cells.length; k++) {
      if (chosen[k] >= 0) continue;
      const ok = !P.leaked[k] && P.area[k] > 0 && P.area[k] <= AMAX * Aref && P.area[k] >= AMIN * Aref;
      if (!ok && r < 10) continue;
      chosen[k] = r;
      const core = new Uint8Array(N);
      for (let i = 0; i < N; i++) if (P.own[i] === k + 1) core[i] = 1;
      // anneau = pixels d'anneau CONTIGUS au contenu (geodesique a travers l'anneau, <= RINGW px) et attribues a ce sticker
      const G = growLabels(Int32Array.from(core), Mr, cw, ch, RINGW, null);
      const Ck = Uint8Array.from(core);
      for (let i = 0; i < N; i++) { const x = i % cw, y = (i / cw) | 0; if (G[i] && Mr[i] && P.L[i] === k + 1 && y >= rowTop && y < ch - 2 && x >= 2 && x < cw - 2) Ck[i] = 1; }
      CK[k] = { Ck, own: core, coreBottom: bboxOf(core, cw, ch).y1 >= ch - 8, Lk: Uint8Array.from(P.L, (v) => (v === k + 1 ? 1 : 0)) };
    }
  }
  if (dbgPanel === box.tag) {
    const o = Buffer.alloc(N * 3);
    CK.forEach((c, k) => { for (let i = 0; i < N; i++) { if (c.own[i]) { o[i * 3] = ((k + 1) * 67) % 200 + 55; o[i * 3 + 1] = ((k + 1) * 131) % 200 + 55; o[i * 3 + 2] = ((k + 1) * 29) % 200 + 55; } else if (c.Ck[i]) { o[i * 3] = 90; o[i * 3 + 1] = 90; o[i * 3 + 2] = 90; } } });
    sharp(o, { raw: { width: cw, height: ch, channels: 3 } }).png().toFile(path.join(CHECK, 'dbgL-ring.png'));
  }
  const out = [];
  for (let k = 0; k < cells.length; k++) {
    const { Ck, own, Lk, coreBottom } = CK[k];
    const S = fillHolesWalls(close(Ck, cw, ch, 3), cw, ch, false, false, coreBottom);
    for (let i = 0; i < N; i++) if (S[i] && !Lk[i] && !own[i]) S[i] = 0;
    const cut = cfg.label ? cutLabels(rgb, W, box, S, cells[k], px, cw, ch) : null;
    out.push({ S, cw, ch, ox: box.x0, oy: box.y0, k, cut, cy: cells[k].cy, info: { mode: 'ring', bad: false, r: chosen[k] } });
  }
  if (dbgPanel === box.tag) {
    const o = Buffer.alloc(N * 3);
    for (let i = 0; i < N; i++) { const j = ((((i / cw) | 0) + box.y0) * W + (i % cw) + box.x0) * 3; o[i * 3] = rgb[j] >> 2; o[i * 3 + 1] = rgb[j + 1] >> 2; o[i * 3 + 2] = rgb[j + 2] >> 2; }
    out.forEach((st) => { for (let i = 0; i < N; i++) if (st.S[i]) { const j = ((((i / cw) | 0) + box.y0) * W + (i % cw) + box.x0) * 3; o[i * 3] = rgb[j]; o[i * 3 + 1] = rgb[j + 1]; o[i * 3 + 2] = rgb[j + 2]; } });
    sharp(o, { raw: { width: cw, height: ch, channels: 3 } }).resize(cw * 2, ch * 2).png().toFile(path.join(CHECK, 'dbgS-ring.png'));
    console.log(box.tag, 'r choisis:', chosen.join(' '), 'Aref', Aref);
  }
  return out;
}

// stickers sur carte blanche (kevin) : le sticker = encre (non blanc), l'anneau blanc est invisible sur la carte
function segInk(rgb, W, box, cfg, M, grid, rowTop) {
  const cw = box.x1 - box.x0, ch = box.y1 - box.y0, N = cw * ch;
  const { cells, pitchX: px, pitchY: py } = grid;
  if (process.env.DBGD && dbgPanel === box.tag) console.log('cells', cells.map((g) => Math.round(g.cx) + ',' + Math.round(g.cy)).join(' '), 'p', px, py);
  const ink = new Uint8Array(N);
  for (let i = 0; i < N; i++) { const x = i % cw, y = (i / cw) | 0; ink[i] = M[i] && y >= rowTop && x >= EDGEINK && x < cw - EDGEINK && y < ch - 3 ? 1 : 0; } // bord de la carte exclu
  const merged = close(ink, cw, ch, 2);
  const lb = label(merged, cw, ch);
  const BIG = 500;
  const big = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (lb.lab[i] && lb.comps[lb.lab[i]].a >= BIG) big[i] = 1;
  // corps : separation des stickers colles par bassins versants (distance au vide) germes sur les centres de cases
  const coreB = dilate(erode(big, cw, ch, 4), cw, ch, 4);
  const dt = edtSq(Uint8Array.from(coreB, (v) => (v ? 0 : 1)), cw, ch);
  const seed = new Int32Array(N);
  cells.forEach((g, k) => {
    let bx = Math.round(g.cx), by = Math.round(g.cy), bd = -1;
    for (let y = by - 14; y <= by + 14; y++) for (let x = bx - 14; x <= bx + 14; x++) { if (x < 0 || y < 0 || x >= cw || y >= ch || !coreB[y * cw + x]) continue; if (dt[y * cw + x] > bd) { bd = dt[y * cw + x]; bx = x; by = y; } }
    for (let y = by - 4; y <= by + 4; y++) for (let x = bx - 4; x <= bx + 4; x++) if (x >= 0 && y >= 0 && x < cw && y < ch && coreB[y * cw + x] && !seed[y * cw + x]) seed[y * cw + x] = k + 1;
  });
  const Lw = watershed(seed, coreB, dt, cw, ch);
  // frange d'anneau (peu sature) : rattachee au corps le plus proche ; le reste de "big" (couleurs vives) = decorations collees
  const lowSat = new Uint8Array(N);
  for (let i = 0; i < N; i++) { if (!big[i] || coreB[i]) continue; const j = (((((i / cw) | 0)) + box.y0) * W + (i % cw) + box.x0) * 3; lowSat[i] = Math.max(rgb[j], rgb[j + 1], rgb[j + 2]) - Math.min(rgb[j], rgb[j + 1], rgb[j + 2]) < INKSAT ? 1 : 0; }
  const fr = growLabels(Lw, Uint8Array.from(big, (v, i) => (v && (coreB[i] || lowSat[i]) ? 1 : 0)), cw, ch, FRINGE, null);
  for (let i = 0; i < N; i++) if (fr[i] && !Lw[i]) Lw[i] = fr[i];
  const rest = new Uint8Array(N);
  for (let i = 0; i < N; i++) rest[i] = big[i] && !Lw[i] ? 1 : 0;
  const lbRest = label(dilate(rest, cw, ch, 2), cw, ch);
  // les composantes "corps" sans germe (debris, bandeau residuel) sont ignorees ; decorations (petites composantes colorees) :
  // rattachees au corps le plus proche en pixels
  const Lc = Int32Array.from(Lw);
  const bodyD = {};
  const bodyAt = (k, r) => { const key = k * 100 + r; if (!bodyD[key]) { const m = new Uint8Array(N); for (let i = 0; i < N; i++) if (Lw[i] === k + 1) m[i] = 1; bodyD[key] = dilate(m, cw, ch, r); } return bodyD[key]; };
  const attach = (c, pix) => {
    const n = pix.length;
    let vivid = 0;
    for (const i of pix) { const j = ((((i / cw) | 0) + box.y0) * W + (i % cw) + box.x0) * 3; if (Math.max(rgb[j], rgb[j + 1], rgb[j + 2]) - Math.min(rgb[j], rgb[j + 1], rgb[j + 2]) >= 90) vivid++; }
    if (vivid < 12 && vivid < 0.15 * n) return; // debris gris / blanc d'un voisin : ecarte
    const allowed = [];
    for (let k = 0; k < cells.length; k++) { const dx = (c.cx - cells[k].cx) / px, dy = (c.cy - cells[k].cy) / py; if (dy >= -0.66 && dy <= 0.2 && dx >= -0.7 && dx <= 0.9) allowed.push(k); }
    let best = -1;
    for (const r of [6, 14, 26]) {
      let bf = 0.25;
      for (const k of allowed) { const Dm = bodyAt(k, r); let hit = 0; for (const i of pix) if (Dm[i]) hit++; if (hit / n > bf) { bf = hit / n; best = k; } }
      if (best >= 0) break;
    }
    if (process.env.DBGD && dbgPanel === box.tag) console.log('deco', Math.round(c.cx), Math.round(c.cy), 'a', n, 'allowed', allowed.join(','), 'best', best);
    if (best >= 0) for (const i of pix) Lc[i] = best + 1;
  };
  for (let l = 1; l <= lbRest.n; l++) {
    const c = lbRest.comps[l];
    const pix = [];
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) { const i = y * cw + x; if (lbRest.lab[i] === l && rest[i]) pix.push(i); }
    if (pix.length < 30) continue;
    attach(c, pix);
  }
  for (let l = 1; l <= lb.n; l++) {
    const c = lb.comps[l];
    if (c.a >= BIG || c.a < 40) continue;
    let sat = 0, n = 0; const pix = [];
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) {
      const i = y * cw + x; if (lb.lab[i] !== l) continue;
      const j = ((y + box.y0) * W + x + box.x0) * 3; sat += Math.max(rgb[j], rgb[j + 1], rgb[j + 2]) - Math.min(rgb[j], rgb[j + 1], rgb[j + 2]); n++; pix.push(i);
    }
    if (sat / n < INKSAT) continue; // debris gris / blanc : ecarte
    attach(c, pix);
  }
  if (dbgPanel === box.tag) { const o = Buffer.alloc(N * 3); for (let i = 0; i < N; i++) { const a = Lc[i], j = ((((i / cw) | 0) + box.y0) * W + (i % cw) + box.x0) * 3; o[i * 3] = rgb[j] >> 1; o[i * 3 + 1] = rgb[j + 1] >> 1; o[i * 3 + 2] = rgb[j + 2] >> 1; if (a) { o[i * 3] = ((a * 67) % 200) + 55; o[i * 3 + 1] = ((a * 131) % 200) + 55; o[i * 3 + 2] = ((a * 29) % 200) + 55; } if (!a && big[i]) { o[i * 3] = 255; } } sharp(o, { raw: { width: cw, height: ch, channels: 3 } }).resize(cw * 2, ch * 2, { kernel: 'nearest' }).png().toFile(path.join(CHECK, 'dbgInk.png')); }
  const out = [];
  for (let k = 0; k < cells.length; k++) {
    const Ck = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (Lc[i] === k + 1) Ck[i] = 1;
    const S = fillHolesWalls(close(Ck, cw, ch, 3), cw, ch, false, false, bboxOf(Ck, cw, ch).y1 >= ch - 10);
    out.push({ S, cw, ch, ox: box.x0, oy: box.y0, k, cut: null, info: { mode: 'ink', bad: false } });
  }
  return out;
}

// Secours par case : zone locale autour de la case, interieur = inondation depuis le centre a travers le non-anneau,
// fermeture de l'anneau croissante jusqu'a obtenir une aire plausible (reference = mediane des cases reussies)
function localCell(rgb, W, box, cfg, grid, k, Aref, mode) {
  const cw = box.x1 - box.x0, ch = box.y1 - box.y0, N = cw * ch;
  const { cells, pitchX: px, pitchY: py } = grid, g = cells[k];
  const { M: M0 } = ringMask(rgb, W, box, cw, ch, mode);
  const rx0 = Math.max(0, Math.round(g.cx - 0.54 * px)), rx1 = Math.min(cw - 1, Math.round(g.cx + 0.54 * px));
  const ry0 = Math.max(0, Math.round(g.cy - 0.6 * py)), ry1 = Math.min(ch - 1, Math.round(g.cy + 0.55 * py));
  const inR = (x, y) => x >= rx0 && x <= rx1 && y >= ry0 && y <= ry1;
  let best = null;
  for (const r of [0, 1, 2, 3, 4, 6, 8]) {
    const M = r ? close(M0, cw, ch, r) : M0;
    const C = new Uint8Array(N), st = [];
    const sx = Math.round(g.cx), sy = Math.round(g.cy);
    for (let y = sy - 8; y <= sy + 8; y++) for (let x = sx - 8; x <= sx + 8; x++) if (inR(x, y) && !M[y * cw + x] && !C[y * cw + x]) { C[y * cw + x] = 1; st.push(y * cw + x); }
    while (st.length) {
      const p = st.pop(), x = p % cw, y = (p / cw) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (!inR(nx, ny)) continue; const q = ny * cw + nx; if (!M[q] && !C[q]) { C[q] = 1; st.push(q); } }
    }
    const G = growLabels(Int32Array.from(C), M, cw, ch, RINGW, null);
    const S0 = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (C[i] || (G[i] && M[i] && inR(i % cw, (i / cw) | 0))) S0[i] = 1;
    const S = fillHolesWalls(close(S0, cw, ch, 3), cw, ch, false, false, ry1 >= ch - 8);
    for (let i = 0; i < N; i++) if (!inR(i % cw, (i / cw) | 0)) S[i] = 0;
    let n = 0; for (let i = 0; i < N; i++) n += S[i];
    if (n >= 0.7 * Aref && n <= 1.3 * Aref) { best = { S, n, r }; break; }
    if (!best || Math.abs(n - Aref) < Math.abs(best.n - Aref)) best = { S, n, r };
  }
  if (!best) return null;
  { const bb = bboxOf(best.S, cw, ch); if (bb.x1 < 0 || bb.x0 <= rx0 + 1 || bb.x1 >= rx1 - 1 || bb.y0 <= ry0 + 1) return null; } // coupe par le cadre : inutilisable
  const cut = cfg.label ? cutLabels(rgb, W, box, best.S, g, px, cw, ch) : null;
  return { S: best.S, cw, ch, ox: box.x0, oy: box.y0, k, cut, cy: g.cy, info: { mode: 'local' + mode, bad: false, r: best.r } };
}

function segmentPanel(rgb, W, slug, pr, pc, cfg, baseGrid) {
  const box = panelBox(cfg, pr, pc, `${slug},${pr},${pc}`);
  const best = Array(12).fill(null);
  const cands = Array.from({ length: 12 }, () => []);
  const why = Array(12).fill('');
  let grid0 = null;
  for (const mode of (cfg.ink ? ['ink'] : (process.env.MODES || 'R,S,H,R3,T').split(','))) {
    const r0 = runMode(rgb, W, box, cfg, mode, baseGrid);
    if (!r0) continue;
    if (!grid0) grid0 = r0.grid;
    if (process.env.DBGW && dbgPanel === box.tag) console.log(mode, r0.map((o) => (o.info.bad ? "X" + o.info.why : "ok")).join(" | "));
    r0.forEach((o, k) => {
      if (o.info.bad) { if (!cands[k].length) why[k] = o.info.why; return; }
      let n = 0; for (let i = 0; i < o.S.length; i++) n += o.S[i];
      cands[k].push({ o, n });
    });
    // on s'arrete des que chaque case a un candidat d'aire "typique" (0.85-1.2 de la mediane des candidats)
    const all = cands.flat().map((c) => c.n).sort((a, b) => a - b);
    const med = all.length ? all[all.length >> 1] : 0;
    if (cands.every((cl) => cl.some((c) => c.n >= 0.85 * med && c.n <= 1.2 * med))) break;
  }
  { // meilleur candidat par case : aire la plus proche de la mediane du panneau
    const all = cands.flat().map((c) => c.n).sort((a, b) => a - b);
    const med = all.length ? all[all.length >> 1] : 0;
    cands.forEach((cl, k) => { if (cl.length) best[k] = cl.reduce((a, b) => (Math.abs(Math.log(b.n / med)) < Math.abs(Math.log(a.n / med)) ? b : a)).o; });
  }
  // cases suspectes (aire hors 0.8-1.25 de la mediane) : on tente le secours local, retenu seulement s'il est plus typique
  if (grid0 && !cfg.ink && best.filter(Boolean).length >= 6) {
    const cnt = (o) => { let n = 0; for (let i = 0; i < o.S.length; i++) n += o.S[i]; return n; };
    const ar = best.map((o) => (o ? cnt(o) : 0));
    const med0 = ar.filter(Boolean).sort((a, b) => a - b)[ar.filter(Boolean).length >> 1];
    for (let k = 0; k < 12; k++) {
      if (!best[k] || (ar[k] >= 0.8 * med0 && ar[k] <= 1.25 * med0)) continue;
      for (const mode of ['R', 'S', 'R3']) {
        const o = localCell(rgb, W, box, cfg, grid0, k, med0, mode);
        if (!o) continue;
        const n = cnt(o);
        if (n >= 0.85 * med0 && n <= 1.2 * med0) { qcStickers([o], o.cw, o.ch, grid0.pitchX, grid0.pitchY, Object.assign({}, cfg, { _single: med0 })); if (!o.info.bad) { best[k] = o; break; } }
      }
    }
  }
  // secours par case pour ce qui reste
  if (grid0 && !cfg.ink && best.some((b) => !b) && best.filter(Boolean).length >= 4) {
    const areas = best.filter(Boolean).map((o) => { let n = 0; for (let i = 0; i < o.S.length; i++) n += o.S[i]; return n; }).sort((a, b) => a - b);
    const Aref = areas[areas.length >> 1];
    for (let k = 0; k < 12; k++) {
      if (best[k]) continue;
      for (const mode of ['R', 'S', 'R3']) {
        const o = localCell(rgb, W, box, cfg, grid0, k, Aref, mode);
        if (!o) continue;
        qcStickers([o], o.cw, o.ch, grid0.pitchX, grid0.pitchY, Object.assign({}, cfg, { _single: Aref }));
        if (!o.info.bad) { best[k] = o; break; }
        why[k] = (why[k] || '') + ' local:' + o.info.why;
      }
    }
  }
  best.grid = grid0;
  best.missing = best.map((b, k) => (b ? '' : EXPR[k] + '(' + why[k] + ')')).filter(Boolean);
  return best;
}

// ---------------------------------------------------------------- mega
async function doMega(slug, manifest, stats) {
  const file = path.join(SRC, `${slug}-mega.png`);
  if (!fs.existsSync(file)) { console.log(`${slug}: pas de planche mega`); return; }
  const cfg = CFG[slug];
  const { data: rgb, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const tiles = [], done = [];
  // grille de consensus : meme mise en page dans les 12 panneaux du perso
  const maps = [];
  for (let pr = 0; pr < 3; pr++) for (let pc = 0; pc < 4; pc++) {
    const box = panelBox(cfg, pr, pc, '');
    const cw = box.x1 - box.x0, ch = box.y1 - box.y0;
    const { M, cr } = ringMask(rgb, W, box, cw, ch, cfg.ink ? 'ink' : 'R');
    maps.push(depthMap(fillHolesWall(close(M, cw, ch, cr), cw, ch), cw, ch));
  }
  const cons = fitGridLm(maps, cfg, null);
  console.log(`  grille: cx0=${cons.base.cx0} dx=${cons.base.dx} cy0=${cons.base.cy0} dy=${cons.base.dy} score=${cons.score.toFixed(1)}`);
  const segs = [];
  for (let pr = 0; pr < 3; pr++) for (let pc = 0; pc < 4; pc++) segs.push(segmentPanel(rgb, W, slug, pr, pc, cfg, cons.base));
  // etiquettes (cycy, manon) : la ligne de coupe suit la mise en page (decalage fixe sous le centre de la case, par rangee)
  if (cfg.label) {
    const offs = [[], [], []];
    segs.forEach((sg) => sg.forEach((o) => { if (o && o.cut !== null && o.cut !== undefined) offs[Math.floor(o.k / cfg.cols)].push(o.cut - o.cy); }));
    const med = offs.map((v) => { v.sort((x, y) => x - y); return v.length ? v[v.length >> 1] : null; });
    console.log('  etiquettes: decalage de coupe par rangee', med.map((m, r) => (m === null ? '?' : m.toFixed(1)) + '(' + offs[r].length + ')').join(' '));
    segs.forEach((sg) => sg.forEach((o) => {
      if (!o) return;
      const m = med[Math.floor(o.k / cfg.cols)];
      if (m === null) return;
      const ym = Math.round(o.cy + m);
      const y0 = Math.max(0, o.cut !== null && o.cut !== undefined ? Math.min(ym, Math.max(o.cut, ym - 10)) : ym); // etiquette sur 2 lignes : pastille plus haute
      for (let y = y0; y < o.ch; y++) o.S.fill(0, y * o.cw, (y + 1) * o.cw);
      o.cut = y0;
    }));
  }
  for (let pr = 0; pr < 3; pr++) for (let pc = 0; pc < 4; pc++) {
    const ci = pr * 4 + pc, costume = COSTUMES[ci];
    const dir = path.join(OUT, slug, costume);
    const seg = segs[ci];
    if (seg.missing.length) {
      console.log(`  !! ${slug}/${costume} : ${seg.missing.join(' ')}`);
      stats.problems.push(`${slug}/${costume}: ${seg.missing.join(' ')}`);
      continue;
    }
    fs.mkdirSync(dir, { recursive: true });
    const pngs = [];
    for (let k = 0; k < 12; k++) {
      const piece = await renderSticker(rgb, W, seg[k], !!cfg.ink);
      const png = piece && (await finalize(piece, SIZE, MARGIN));
      if (!png) { console.log(`  !! ${slug}/${costume}/${EXPR[k]} vide`); stats.problems.push(`${slug}/${costume}/${EXPR[k]}: vide`); break; }
      pngs.push(png);
    }
    if (pngs.length < 12) continue;
    for (let k = 0; k < 12; k++) {
      await saveWebp(pngs[k], path.join(dir, `${EXPR[k]}.webp`), path.join(dir, `${EXPR[k]}@thumb.webp`), SIZE, THUMB, stats.bytes);
      tiles.push({ png: pngs[k], r: ci, c: k });
    }
    done.push(costume);
    const modes = [...new Set(seg.map((s) => s.info.mode))].join('+');
    const nocut = cfg.label ? seg.filter((s) => s.cut === null).map((s) => EXPR[s.k]) : [];
    console.log(`  ${slug}/${costume} ok (${modes})${nocut.length ? ' !! etiquette non detectee: ' + nocut.join(',') : ''}`);
    if (nocut.length) stats.problems.push(`${slug}/${costume}: etiquette non coupee ${nocut.join(',')}`);
  }
  manifest[slug].costumes = COSTUMES.filter((c) => done.includes(c));
  await contact(path.join(CHECK, `costumes-${slug}.png`), COSTUMES, EXPR, tiles, 96);
}

// ---------------------------------------------------------------- rendu d'un sticker
const PAD = 14;
async function renderSticker(rgb, W, st, ink) {
  // sous-image avec marge
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  const { S, cw, ch } = st;
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (S[y * cw + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const sw = x1 - x0 + 1 + 2 * PAD, sh = y1 - y0 + 1 + 2 * PAD;
  const m = new Uint8Array(sw * sh);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (S[y * cw + x]) m[(y - y0 + PAD) * sw + x - x0 + PAD] = 1;
  // nettoyage : trous remplis, petites poussieres retirees
  let F0 = fillHoles(m, sw, sh);
  const lb = label(F0, sw, sh);
  let big = 0; for (let l = 1; l <= lb.n; l++) big = Math.max(big, lb.comps[l].a);
  for (let i = 0; i < sw * sh; i++) if (F0[i] && lb.comps[lb.lab[i]].a < Math.max(25, big * 0.004)) F0[i] = 0;
  const C = F0;
  const F = dilate(C, sw, sh, 4);
  const rgba = Buffer.alloc(sw * sh * 4, 255);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const k = y * sw + x;
    if (C[k]) {
      const i = ((y + y0 - PAD + st.oy) * W + (x + x0 - PAD + st.ox)) * 3;
      rgba[k * 4] = rgb[i]; rgba[k * 4 + 1] = rgb[i + 1]; rgba[k * 4 + 2] = rgb[i + 2];
    }
  }
  return { rgba, F, sw, sh };
}

// rgba (couleurs, fond blanc hors C) + masque F (0/1) -> png SIZExSIZE transparent
async function finalize(piece, size, margin) {
  const { rgba, F, sw, sh } = piece;
  let bx0 = sw, by0 = sh, bx1 = -1, by1 = -1;
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) if (F[y * sw + x]) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
  if (bx1 < 0) return null;
  const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
  const inner = size - 2 * margin, sc = Math.min(inner / bw, inner / bh);
  const tw = Math.max(1, Math.round(bw * sc)), th = Math.max(1, Math.round(bh * sc));
  const a1 = Buffer.alloc(sw * sh);
  for (let i = 0; i < sw * sh; i++) a1[i] = F[i] ? 255 : 0;
  const rgbBuf = Buffer.alloc(sw * sh * 3);
  for (let i = 0; i < sw * sh; i++) { rgbBuf[i * 3] = rgba[i * 4]; rgbBuf[i * 3 + 1] = rgba[i * 4 + 1]; rgbBuf[i * 3 + 2] = rgba[i * 4 + 2]; }
  const ext = { left: bx0, top: by0, width: bw, height: bh };
  const rgbUp = await sharp(rgbBuf, { raw: { width: sw, height: sh, channels: 3 } }).extract(ext)
    .resize(tw, th, { kernel: 'lanczos3' }).sharpen({ sigma: 0.7, m1: 0.8, m2: 1.2 }).raw().toBuffer();
  const aUp = await sharp(a1, { raw: { width: sw, height: sh, channels: 1 } }).extract(ext)
    .resize(tw, th, { kernel: 'cubic' }).blur(1.1).linear(2.6, -2.6 * 127).extractChannel(0).raw().toBuffer();
  const px = Buffer.alloc(tw * th * 4);
  for (let i = 0; i < tw * th; i++) { px[i * 4] = rgbUp[i * 3]; px[i * 4 + 1] = rgbUp[i * 3 + 1]; px[i * 4 + 2] = rgbUp[i * 3 + 2]; px[i * 4 + 3] = aUp[i]; }
  const piece2 = await sharp(px, { raw: { width: tw, height: th, channels: 4 } }).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } } })
    .composite([{ input: piece2, left: Math.round((size - tw) / 2), top: Math.round((size - th) / 2) }]).png().toBuffer();
}

// ---------------------------------------------------------------- planche contact
async function contact(file, rowNames, colNames, tiles, T, rowLabelW = 78, headH = 30) {
  const nr = rowNames.length, nc = colNames.length;
  const W = rowLabelW + nc * T, H = headH + nr * T;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#23263a"/>`;
  for (let y = 0; y < nr; y++) for (let x = 0; x < nc; x++) if ((x + y) % 2) svg += `<rect x="${rowLabelW + x * T}" y="${headH + y * T}" width="${T}" height="${T}" fill="#2c3048"/>`;
  colNames.forEach((n, i) => { svg += `<text x="${rowLabelW + i * T + T / 2}" y="20" font-size="${Math.min(13, T / 7)}" font-family="Arial" fill="#ffd54a" text-anchor="middle">${n}</text>`; });
  rowNames.forEach((n, i) => { svg += `<text x="4" y="${headH + i * T + T / 2}" font-size="13" font-family="Arial" fill="#7fe0ff">${n}</text>`; });
  svg += '</svg>';
  const comps = [];
  for (const t of tiles) comps.push({ input: await sharp(t.png).resize(T, T).png().toBuffer(), left: rowLabelW + t.c * T, top: headH + t.r * T });
  await sharp(Buffer.from(svg)).composite(comps).png().toFile(file);
}

async function saveWebp(png, big, thumb, size, tsize, bytesRef) {
  await sharp(png).webp({ quality: Q, alphaQuality: 92 }).toFile(big);
  await sharp(png).resize(tsize, tsize, { kernel: 'lanczos3' }).webp({ quality: Q, alphaQuality: 92 }).toFile(thumb);
  bytesRef.n += fs.statSync(big).size + fs.statSync(thumb).size; bytesRef.f += 2;
}

// ---------------------------------------------------------------- portraits
async function doPortraits(slug, manifest, stats) {
  const file = path.join(SRC, `${slug}-portraits.png`);
  if (!fs.existsSync(file)) { console.log(`${slug}: pas de planche portraits`); return; }
  const { data: rgb, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  // couleur de fond = mediane des pixels de bord
  const samp = [];
  for (let x = 0; x < w; x += 7) { samp.push(0 * w + x, (h - 1) * w + x); }
  for (let y = 0; y < h; y += 7) { samp.push(y * w, y * w + w - 1); }
  const med = [0, 1, 2].map((c) => { const v = samp.map((i) => rgb[i * 3 + c]).sort((a, b) => a - b); return v[v.length >> 1]; });
  const D = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const d = Math.max(Math.abs(rgb[i * 3] - med[0]), Math.abs(rgb[i * 3 + 1] - med[1]), Math.abs(rgb[i * 3 + 2] - med[2]));
    D[i] = d > 24 ? 1 : 0;
  }
  const M = fillHoles(close(D, w, h, 3), w, h);
  const { lab, n, comps } = label(M, w, h);
  const big = [];
  for (let l = 1; l <= n; l++) if (comps[l].a > 15000) big.push({ l, ...comps[l] });
  console.log(`${slug} portraits: fond=${med.join(',')} composantes=${big.length}`);
  if (big.length !== 12) { if (big.length < 12) { stats.problems.push(`${slug}/portraits: ${big.length} composantes`); return; } big.sort((a, b) => b.a - a.a); big.length = 12; }
  // ordre : 3 rangees (ou 4) lecture gauche->droite
  const cols = guessCols(big);
  big.sort((a, b) => a.cy - b.cy);
  const rowsN = 12 / cols, ordered = [];
  for (let r = 0; r < rowsN; r++) ordered.push(...big.slice(r * cols, (r + 1) * cols).sort((a, b) => a.cx - b.cx));
  const dir = path.join(OUT, slug, 'portraits');
  fs.mkdirSync(dir, { recursive: true });
  const tiles = [];
  for (let k = 0; k < 12; k++) {
    const c = ordered[k];
    const pad = 12;
    const x0 = Math.max(0, c.x0 - pad), y0 = Math.max(0, c.y0 - pad), x1 = Math.min(w - 1, c.x1 + pad), y1 = Math.min(h - 1, c.y1 + pad);
    const sw = x1 - x0 + 1, sh = y1 - y0 + 1;
    const m = new Uint8Array(sw * sh);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) if (lab[(y + y0) * w + x + x0] === c.l) m[y * sw + x] = 1;
    const Cm = m, F = dilate(Cm, sw, sh, 6);
    const rgba = Buffer.alloc(sw * sh * 4, 255);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      const kk = y * sw + x;
      if (Cm[kk]) { const i = ((y + y0) * w + x + x0) * 3; rgba[kk * 4] = rgb[i]; rgba[kk * 4 + 1] = rgb[i + 1]; rgba[kk * 4 + 2] = rgb[i + 2]; }
    }
    const png = await finalize({ rgba, F, sw, sh }, PSIZE, PMARGIN);
    await saveWebp(png, path.join(dir, `${COSTUMES[k]}.webp`), path.join(dir, `${COSTUMES[k]}@thumb.webp`), PSIZE, PTHUMB, stats.bytes);
    tiles.push({ png, r: Math.floor(k / 4), c: k % 4 });
  }
  
  manifest[slug].portraits = COSTUMES.slice();
  const T = 300;
  const names = COSTUMES;
  // contact : 4 colonnes x 3 rangees
  const W = 4 * T, H = 3 * T;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#23263a"/>`;
  names.forEach((nm, i) => { svg += `<text x="${(i % 4) * T + 6}" y="${Math.floor(i / 4) * T + 18}" font-size="16" font-family="Arial" fill="#ffd54a">${i + 1} ${nm}</text>`; });
  svg += '</svg>';
  const comps2 = [];
  for (let k = 0; k < 12; k++) comps2.push({ input: await sharp(tiles[k].png).resize(T, T).png().toBuffer(), left: (k % 4) * T, top: Math.floor(k / 4) * T });
  await sharp(Buffer.from(svg)).composite(comps2).png().toFile(path.join(CHECK, `portraits-${slug}.png`));
}
function guessCols(big) {
  // 4 colonnes x 3 rangees ou 3 colonnes x 4 rangees : essaie les 2 et garde la plus reguliere
  const score = (cols) => {
    const s = [...big].sort((a, b) => a.cy - b.cy);
    let worst = 0;
    for (let r = 0; r < 12 / cols; r++) { const row = s.slice(r * cols, (r + 1) * cols); const cys = row.map((c) => c.cy); worst = Math.max(worst, Math.max(...cys) - Math.min(...cys)); }
    return worst;
  };
  return score(4) <= score(3) ? 4 : 3;
}

// ---------------------------------------------------------------- main
fs.mkdirSync(CHECK, { recursive: true });
const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {};
const stats = { problems: [], bytes: { n: 0, f: 0 } };
for (const slug of SLUGS) {
  if (wanted.length && !wanted.includes(slug)) continue;
  console.log(`== ${slug}`); manifest[slug] = { costumes: [], portraits: [] };
  await doMega(slug, manifest, stats);
  await doPortraits(slug, manifest, stats);
}
const sorted = {};
for (const k of Object.keys(manifest).sort()) sorted[k] = manifest[k];
fs.writeFileSync(MANIFEST, JSON.stringify(sorted, null, 2) + '\n');
console.log(`\n${stats.bytes.f} fichiers, ${(stats.bytes.n / 1024).toFixed(0)} Ko, problemes: ${stats.problems.length}`);
stats.problems.forEach((p) => console.log('  - ' + p));
