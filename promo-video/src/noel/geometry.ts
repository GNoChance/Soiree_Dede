// Géométrie déterministe de la vidéo de Noël : glaçon à pans coupés, fissures, 14 éclats et givre fractal.
import { random } from 'remotion'

export type Pt = [number, number]
export const CUBE_W = 720
export const CUBE_H = 1280
const CUT = 38 // pans coupés du glaçon
export const CUBE_POLY: Pt[] = [
  [CUT, 0], [CUBE_W - CUT, 0], [CUBE_W, CUT], [CUBE_W, CUBE_H - CUT], [CUBE_W - CUT, CUBE_H], [CUT, CUBE_H], [0, CUBE_H - CUT], [0, CUT],
]
export const pts = (p: Pt[]) => p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
export const clipPoly = (p: Pt[]) => `polygon(${p.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(',')})`

// ── Fissures et éclats ────────────────────────────────────────────────────────────────────────────────
const CENTER: Pt = [372, 560]
const N_RAYS = 7
const RING_IDX = 3
const FRACS = [0, 0.14, 0.3, 0.44, 0.6, 0.77, 0.9, 1]

const edgeLens = CUBE_POLY.map((p, i) => Math.hypot(CUBE_POLY[(i + 1) % CUBE_POLY.length][0] - p[0], CUBE_POLY[(i + 1) % CUBE_POLY.length][1] - p[1]))
const cum = edgeLens.map((_, i) => edgeLens.slice(0, i).reduce((a, b) => a + b, 0))
const PERIM = edgeLens.reduce((a, b) => a + b, 0)

const rayHit = (ang: number): { pt: Pt; pos: number } => {
  const dx = Math.cos(ang)
  const dy = Math.sin(ang)
  let best = Infinity
  let out = { pt: CENTER, pos: 0 }
  CUBE_POLY.forEach((p, e) => {
    const q = CUBE_POLY[(e + 1) % CUBE_POLY.length]
    const ex = q[0] - p[0]
    const ey = q[1] - p[1]
    const den = dx * ey - dy * ex
    if (Math.abs(den) < 1e-9) return
    const t = ((p[0] - CENTER[0]) * ey - (p[1] - CENTER[1]) * ex) / den
    const u = ((p[0] - CENTER[0]) * dy - (p[1] - CENTER[1]) * dx) / den
    if (t > 0 && u >= -1e-6 && u <= 1 + 1e-6 && t < best) {
      best = t
      out = { pt: [CENTER[0] + dx * t, CENTER[1] + dy * t], pos: cum[e] + u * edgeLens[e] }
    }
  })
  return out
}

const RAYS: Pt[][] = []
const HITS: { pt: Pt; pos: number }[] = []
for (let i = 0; i < N_RAYS; i++) {
  const ang = -0.35 + (i * Math.PI * 2) / N_RAYS + (random(`cr-a${i}`) - 0.5) * 0.38
  const hit = rayHit(ang)
  HITS.push(hit)
  const D = Math.hypot(hit.pt[0] - CENTER[0], hit.pt[1] - CENTER[1])
  const nx = -Math.sin(ang)
  const ny = Math.cos(ang)
  RAYS.push(
    FRACS.map((fr, k): Pt => {
      if (k === 0) return CENTER
      if (k === FRACS.length - 1) return hit.pt
      const j = (random(`cr-j${i}-${k}`) - 0.5) * 2 * (k === RING_IDX ? 6 : 15)
      return [CENTER[0] + Math.cos(ang) * D * fr + nx * j, CENTER[1] + Math.sin(ang) * D * fr + ny * j]
    }),
  )
}
/** Arc de fissure entre les anneaux de deux rayons voisins (1 point intermédiaire décalé). */
const RINGS: Pt[][] = RAYS.map((r, i) => {
  const a = r[RING_IDX]
  const b = RAYS[(i + 1) % N_RAYS][RING_IDX]
  const mx = (a[0] + b[0]) / 2
  const my = (a[1] + b[1]) / 2
  const dx = mx - CENTER[0]
  const dy = my - CENTER[1]
  const d = Math.hypot(dx, dy) || 1
  const push = (random(`cr-r${i}`) - 0.3) * 34
  return [a, [mx + (dx / d) * push, my + (dy / d) * push], b]
})

export type Shard = { poly: Pt[]; cx: number; cy: number; ring: 0 | 1; i: number }
export const SHARDS: Shard[] = []
for (let i = 0; i < N_RAYS; i++) {
  const j = (i + 1) % N_RAYS
  const ri = RAYS[i]
  const rj = RAYS[j]
  // Pièce intérieure : centre → anneau (rayon i) → arc → anneau (rayon j) → centre.
  const inner: Pt[] = [CENTER, ...ri.slice(1, RING_IDX + 1), ...RINGS[i].slice(1, -1), ...rj.slice(1, RING_IDX + 1).reverse()]
  // Pièce extérieure : anneau → bord (rayon i), sommets du périmètre entre les deux impacts, bord → anneau (rayon j).
  let p0 = HITS[i].pos
  let p1 = HITS[j].pos
  if (p1 < p0) p1 += PERIM
  const between: Pt[] = []
  CUBE_POLY.forEach((v, k) => {
    for (const c of [cum[k], cum[k] + PERIM]) if (c > p0 + 0.01 && c < p1 - 0.01) between.push(v)
  })
  const outer: Pt[] = [...ri.slice(RING_IDX), ...between, ...rj.slice(RING_IDX).reverse(), ...RINGS[i].slice(1, -1).reverse()]
  for (const [poly, ring] of [[inner, 0], [outer, 1]] as [Pt[], 0 | 1][]) {
    SHARDS.push({ poly, ring, i, cx: poly.reduce((s, p) => s + p[0], 0) / poly.length, cy: poly.reduce((s, p) => s + p[1], 0) / poly.length })
  }
}

const lenOf = (p: Pt[]) => p.slice(1).reduce((s, q, k) => s + Math.hypot(q[0] - p[k][0], q[1] - p[k][1]), 0)
/** Début de polyligne sur la fraction `frac` de sa longueur. */
export const partial = (p: Pt[], frac: number): Pt[] => {
  if (frac >= 0.999) return p
  const target = lenOf(p) * Math.max(0, frac)
  const out: Pt[] = [p[0]]
  let acc = 0
  for (let k = 1; k < p.length; k++) {
    const seg = Math.hypot(p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1])
    if (acc + seg >= target) {
      const t = seg ? (target - acc) / seg : 0
      out.push([p[k - 1][0] + (p[k][0] - p[k - 1][0]) * t, p[k - 1][1] + (p[k][1] - p[k - 1][1]) * t])
      return out
    }
    acc += seg
    out.push(p[k])
  }
  return out
}

/** Portée de chaque fissure (fraction de la longueur du rayon) aux 3 « crac » : 10,5 s, 11,0 s, 11,5 s. */
export const CRACK_REACH: number[][] = [
  [0.5, 0, 0, 0.55, 0, 0.45, 0],
  [0.62, 0.5, 0.58, 0.62, 0.48, 0.6, 0.55],
  [1, 1, 1, 1, 1, 1, 1],
]
export const CRACK_RAYS = RAYS
export const CRACK_RINGS = RINGS
/** Petites fissures secondaires (apparaissent au 3e crac). */
export const MICRO_CRACKS: Pt[][] = Array.from({ length: 16 }, (_, k) => {
  const r = RAYS[k % N_RAYS]
  const at = 4 + Math.floor(random(`mc-at${k}`) * 3)
  const a = r[at]
  const base = Math.atan2(r[at + 1][1] - a[1], r[at + 1][0] - a[0])
  const ang = base + (random(`mc-s${k}`) < 0.5 ? -1 : 1) * (0.6 + random(`mc-a${k}`) * 0.5)
  const L = 34 + random(`mc-l${k}`) * 46
  return [a, [a[0] + Math.cos(ang) * L * 0.55 + (random(`mc-x${k}`) - 0.5) * 8, a[1] + Math.sin(ang) * L * 0.55], [a[0] + Math.cos(ang) * L, a[1] + Math.sin(ang) * L]]
})

// ── Givre en fougères (coin haut-gauche ; les 3 autres coins sont des symétries) ─────────────────────
export type FrostSeg = { d: string; w: number; at: number; dur: number }
export type FrostCorner = { segs: FrostSeg[]; mass: string; mass2: string }

const nz = (s: string) => random(s)
const pathD = (p: Pt[]) => `M${p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L')}`

/**
 * Givre d'un coin : 3 plumes (tige + brindilles qui pointent vers l'avant, de plus en plus courtes) qui rayonnent depuis (0,0)
 * vers +x/+y, + une masse givrée en pointes. Peu de traits, nets : on doit lire des cristaux, pas un nid.
 */
export const frostCorner = (seed: string, scale = 1): FrostCorner => {
  const segs: FrostSeg[] = []
  const MAXD = 520 * scale
  const add = (p: Pt[], w: number) => {
    const L = lenOf(p)
    segs.push({ d: pathD(p), w, at: Math.min(0.72, (Math.hypot(p[0][0], p[0][1]) / MAXD) * 0.9), dur: 0.1 + (L / MAXD) * 0.75 })
  }
  const stems = [
    { ang: 0.3, len: 330 },
    { ang: Math.PI / 4, len: 470 },
    { ang: 1.27, len: 330 },
  ]
  stems.forEach((st, m) => {
    const L = st.len * scale
    const N = 16
    const stem: Pt[] = []
    let a = st.ang + (nz(`${seed}-sa${m}`) - 0.5) * 0.1
    let x = 0
    let y = 0
    for (let k = 0; k <= N + 1; k++) {
      stem.push([x, y])
      a += (nz(`${seed}-sw${m}-${k}`) - 0.5) * 0.05
      x += Math.cos(a) * (L / N)
      y += Math.sin(a) * (L / N)
    }
    add(stem.slice(0, N + 1), 8)
    for (let k = 3; k < N; k += 2) {
      const [px, py] = stem[k]
      const dir = Math.atan2(stem[k + 1][1] - stem[k - 1][1], stem[k + 1][0] - stem[k - 1][0])
      const rest = 1 - k / N
      for (const side of [-1, 1]) {
        const tl = (0.3 * L * Math.pow(rest, 0.85) + 20) * (0.85 + nz(`${seed}-tl${m}${k}${side}`) * 0.3)
        const ta = dir + side * 0.86
        add([[px, py], [px + Math.cos(ta) * tl * 0.5, py + Math.sin(ta) * tl * 0.5], [px + Math.cos(ta) * tl, py + Math.sin(ta) * tl]], 5)
        if (tl > 58) {
          for (const f of [0.42, 0.72]) {
            const hx = px + Math.cos(ta) * tl * f
            const hy = py + Math.sin(ta) * tl * f
            for (const hs of [-1, 1]) {
              const ha = ta + hs * 0.85
              add([[hx, hy], [hx + Math.cos(ha) * tl * 0.28, hy + Math.sin(ha) * tl * 0.28]], 3.2)
            }
          }
        }
      }
    }
  })
  // Masse givrée : pointes régulières mais variées.
  const R = 150 * scale
  const mass: string[] = ['0,0']
  const mass2: string[] = ['0,0']
  for (let k = 0; k <= 36; k++) {
    const a = (k / 36) * (Math.PI / 2)
    const spike = k % 2 ? 0.58 : 1
    const r = R * (0.7 + 0.5 * nz(`${seed}-m${k}`)) * spike * (1 + 0.35 * Math.sin(a * 2))
    mass.push(`${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`)
    mass2.push(`${(Math.cos(a) * r * 0.7).toFixed(1)},${(Math.sin(a) * r * 0.7).toFixed(1)}`)
  }
  return { segs, mass: mass.join(' '), mass2: mass2.join(' ') }
}

/** Dents de givre le long d'un bord du glaçon (triangles blancs qui pointent vers l'intérieur). */
export const rimTeeth = (seed: string): Pt[][] => {
  const teeth: Pt[][] = []
  const edges: [Pt, Pt][] = CUBE_POLY.map((p, i) => [p, CUBE_POLY[(i + 1) % CUBE_POLY.length]])
  edges.forEach(([p, q], e) => {
    const L = Math.hypot(q[0] - p[0], q[1] - p[1])
    if (L < 100) return
    const ux = (q[0] - p[0]) / L
    const uy = (q[1] - p[1]) / L
    const nx = -uy // normale vers l'intérieur (polygone horaire en y vers le bas)
    const ny = ux
    let s = 16
    let k = 0
    while (s < L - 30) {
      const w = 16 + nz(`${seed}-w${e}-${k}`) * 30
      const h = 12 + Math.pow(nz(`${seed}-h${e}-${k}`), 1.6) * 54
      const a: Pt = [p[0] + ux * s, p[1] + uy * s]
      const b: Pt = [p[0] + ux * (s + w), p[1] + uy * (s + w)]
      const tip: Pt = [p[0] + ux * (s + w * (0.3 + nz(`${seed}-t${e}-${k}`) * 0.4)) + nx * h, p[1] + uy * (s + w * 0.5) + ny * h]
      teeth.push([a, tip, b])
      s += w * 0.8
      k++
    }
  })
  return teeth
}
