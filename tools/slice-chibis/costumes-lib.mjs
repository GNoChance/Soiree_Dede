// Helpers morphologiques (masques binaires Uint8Array) pour costumes.mjs
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
export function dilate(mask, w, h, r) {
  if (r <= 0) return Uint8Array.from(mask);
  const INF = 1e12, g = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = mask[i] ? 0 : INF;
  const m = Math.max(w, h), f = new Float64Array(m), d = new Float64Array(m), v = new Int32Array(m), z = new Float64Array(m + 1);
  for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) f[y] = g[y * w + x]; edt1d(f, h, d, v, z); for (let y = 0; y < h; y++) g[y * w + x] = d[y]; }
  for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) f[x] = g[y * w + x]; edt1d(f, w, d, v, z); for (let x = 0; x < w; x++) g[y * w + x] = d[x]; }
  const out = new Uint8Array(w * h), r2 = r * r + 0.5;
  for (let i = 0; i < w * h; i++) out[i] = g[i] <= r2 ? 1 : 0;
  return out;
}
export const inv = (m) => { const o = new Uint8Array(m.length); for (let i = 0; i < m.length; i++) o[i] = m[i] ? 0 : 1; return o; };
export function erode(mask, w, h, r) {
  if (r <= 0) return Uint8Array.from(mask);
  // bord de l'image = vide (comme du fond)
  const p = new Uint8Array((w + 2) * (h + 2));
  const W2 = w + 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) p[(y + 1) * W2 + x + 1] = mask[y * w + x] ? 0 : 1;
  for (let x = 0; x < W2; x++) { p[x] = 1; p[(h + 1) * W2 + x] = 1; }
  for (let y = 0; y < h + 2; y++) { p[y * W2] = 1; p[y * W2 + W2 - 1] = 1; }
  const d = dilate(p, W2, h + 2, r);
  const o = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) o[y * w + x] = d[(y + 1) * W2 + x + 1] ? 0 : 1;
  return o;
}
export function close(mask, w, h, r) { return r ? erode(dilate(mask, w, h, r), w, h, r) : mask; }
export function label(mask, w, h, conn8 = true) {
  const lab = new Int32Array(w * h), stack = [];
  let n = 0;
  const comps = [null];
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || lab[i]) continue;
    n++; lab[i] = n; stack.push(i);
    const c = { x0: 1e9, y0: 1e9, x1: -1, y1: -1, a: 0, sx: 0, sy: 0 };
    while (stack.length) {
      const p = stack.pop(), x = p % w, y = (p / w) | 0;
      c.a++; c.sx += x; c.sy += y;
      if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!conn8 && dx && dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (mask[q] && !lab[q]) { lab[q] = n; stack.push(q); }
      }
    }
    c.cx = c.sx / c.a; c.cy = c.sy / c.a;
    comps.push(c);
  }
  return { lab, n, comps };
}
export function fillHoles(mask, w, h) {
  const outside = new Uint8Array(w * h), stack = [];
  const push = (i) => { if (!mask[i] && !outside[i]) { outside[i] = 1; stack.push(i); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (stack.length) {
    const p = stack.pop(), x = p % w, y = (p / w) | 0;
    if (x > 0) push(p - 1); if (x < w - 1) push(p + 1); if (y > 0) push(p - w); if (y < h - 1) push(p + w);
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = outside[i] ? 0 : 1;
  return out;
}
// remplissage depuis la bordure a travers les pixels NON masques : renvoie "interieur" (= non atteint)
export const interior = fillHoles;
// BFS multi-sources borne : labels initiaux (Int32Array), propagation dans mask, distance max
export function growLabels(seed, mask, w, h, maxD, allow) {
  const lab = Int32Array.from(seed), dist = new Int32Array(w * h).fill(-1);
  let cur = [];
  for (let i = 0; i < w * h; i++) if (lab[i]) { dist[i] = 0; cur.push(i); }
  for (let d = 1; d <= maxD && cur.length; d++) {
    const nxt = [];
    for (const p of cur) {
      const x = p % w, y = (p / w) | 0, l = lab[p];
      const tr = (q, qx, qy) => {
        if (!mask[q] || lab[q]) return;
        if (allow && !allow(l, qx, qy)) return;
        lab[q] = l; dist[q] = d; nxt.push(q);
      };
      if (x > 0) tr(p - 1, x - 1, y);
      if (x < w - 1) tr(p + 1, x + 1, y);
      if (y > 0) tr(p - w, x, y - 1);
      if (y < h - 1) tr(p + w, x, y + 1);
    }
    cur = nxt;
  }
  return lab;
}
// distance euclidienne au carre jusqu'au pixel masque (mask=1 -> 0) le plus proche
export function edtSq(mask, w, h) {
  const INF = 1e12, g = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = mask[i] ? 0 : INF;
  const m = Math.max(w, h), f = new Float64Array(m), d = new Float64Array(m), v = new Int32Array(m), z = new Float64Array(m + 1);
  for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) f[y] = g[y * w + x]; edt1d(f, h, d, v, z); for (let y = 0; y < h; y++) g[y * w + x] = d[y]; }
  for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) f[x] = g[y * w + x]; edt1d(f, w, d, v, z); for (let x = 0; x < w; x++) g[y * w + x] = d[x]; }
  return g;
}
// bassins versants : germes (Int32Array de labels), inondation dans mask par ordre de "profondeur" (dt) decroissante
export function watershed(seed, mask, dt, w, h) {
  const lab = Int32Array.from(seed), NB = 400;
  const buckets = Array.from({ length: NB }, () => []);
  const key = (i) => Math.min(NB - 1, Math.round(Math.sqrt(dt[i]) * 4));
  let cur = 0;
  for (let i = 0; i < w * h; i++) if (lab[i]) { const k = key(i); buckets[k].push(i); if (k > cur) cur = k; }
  while (cur >= 0) {
    const b = buckets[cur];
    if (!b.length) { cur--; continue; }
    const p = b.pop(), x = p % w, y = (p / w) | 0, l = lab[p];
    const tr = (q) => { if (!mask[q] || lab[q]) return; lab[q] = l; const k = Math.min(key(q), cur); buckets[k].push(q); };
    if (x > 0) tr(p - 1); if (x < w - 1) tr(p + 1); if (y > 0) tr(p - w); if (y < h - 1) tr(p + w);
  }
  return lab;
}
// comme fillHoles, mais le bord BAS du tableau est un mur (stickers coupes par le bas du panneau)
export function fillHolesWall(mask, w, h) {
  const m = new Uint8Array(w * (h + 1));
  m.set(mask); m.fill(1, w * h);
  return fillHoles(m, w, h + 1).subarray(0, w * h);
}
// pour chaque pixel : indice du pixel source (mask=1) le plus proche (BFS 4-voisins, distance max maxD), -1 sinon
export function nearestSrc(mask, w, h, maxD) {
  const src = new Int32Array(w * h).fill(-1);
  let cur = [];
  for (let i = 0; i < w * h; i++) if (mask[i]) { src[i] = i; cur.push(i); }
  for (let d = 1; d <= maxD && cur.length; d++) {
    const nxt = [];
    for (const p of cur) {
      const x = p % w, y = (p / w) | 0, s = src[p];
      if (x > 0 && src[p - 1] < 0) { src[p - 1] = s; nxt.push(p - 1); }
      if (x < w - 1 && src[p + 1] < 0) { src[p + 1] = s; nxt.push(p + 1); }
      if (y > 0 && src[p - w] < 0) { src[p - w] = s; nxt.push(p - w); }
      if (y < h - 1 && src[p + w] < 0) { src[p + w] = s; nxt.push(p + w); }
    }
    cur = nxt;
  }
  return src;
}
// fillHoles avec murs optionnels sur les bords gauche / droit / bas du tableau (stickers coupes par le bord du panneau)
export function fillHolesWalls(mask, w, h, l, r, b) {
  const W2 = w + (l ? 1 : 0) + (r ? 1 : 0), H2 = h + (b ? 1 : 0), ox = l ? 1 : 0;
  const m = new Uint8Array(W2 * H2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * W2 + x + ox] = mask[y * w + x];
  if (l) for (let y = 0; y < H2; y++) m[y * W2] = 1;
  if (r) for (let y = 0; y < H2; y++) m[y * W2 + W2 - 1] = 1;
  if (b) for (let x = 0; x < W2; x++) m[(H2 - 1) * W2 + x] = 1;
  const f = fillHoles(m, W2, H2);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = f[y * W2 + x + ox];
  return out;
}

// Dijkstra multi-germes : lab0 = labels de depart (>0), cost = cout d'entree de chaque pixel.
// Chaque pixel prend le label du germe le moins "cher" a atteindre (4-voisins). Renvoie Int32Array.
export function competeLabels(lab0, cost, w, h) {
  const n = w * h, lab = Int32Array.from(lab0), dist = new Float64Array(n).fill(Infinity);
  const hp = [], hk = [];
  const push = (i, d) => {
    let k = hp.length; hp.push(i); hk.push(d);
    while (k > 0) { const p = (k - 1) >> 1; if (hk[p] <= hk[k]) break; [hp[p], hp[k]] = [hp[k], hp[p]]; [hk[p], hk[k]] = [hk[k], hk[p]]; k = p; }
  };
  const pop = () => {
    const i = hp[0], d = hk[0], li = hp.pop(), ld = hk.pop();
    if (hp.length) {
      hp[0] = li; hk[0] = ld; let k = 0;
      for (;;) { let c = 2 * k + 1; if (c >= hp.length) break; if (c + 1 < hp.length && hk[c + 1] < hk[c]) c++; if (hk[k] <= hk[c]) break; [hp[k], hp[c]] = [hp[c], hp[k]]; [hk[k], hk[c]] = [hk[c], hk[k]]; k = c; }
    }
    return [i, d];
  };
  for (let i = 0; i < n; i++) if (lab[i]) { dist[i] = 0; push(i, 0); }
  while (hp.length) {
    const [p, d] = pop();
    if (d > dist[p]) continue;
    const x = p % w, y = (p / w) | 0;
    const rel = (q) => { const nd = d + cost[q]; if (nd < dist[q]) { dist[q] = nd; lab[q] = lab[p]; push(q, nd); } };
    if (x > 0) rel(p - 1); if (x < w - 1) rel(p + 1); if (y > 0) rel(p - w); if (y < h - 1) rel(p + w);
  }
  return lab;
}
