import type { TrackDef } from '../tracks'

/** Marge roulable (lente) de chaque côté de la piste avant le mur invisible. */
export const WALL_MARGIN = 7
/** Marge roulable de chaque côté d'un raccourci (étroit : on en sort vite). */
export const CUT_MARGIN = 2.6
/** Écart visé entre deux échantillons de piste (unités monde). */
const SPACING = 1.2

/** Raccourci : petit chemin étroit qui relie deux points de la piste. */
export interface Cut {
  /** Échantillons de la piste où il part / où il revient. */
  iA: number
  iB: number
  /** Nombre d'échantillons du raccourci (hors de la piste principale). */
  m: number
  x: Float32Array
  z: Float32Array
  tx: Float32Array
  tz: Float32Array
  half: number
  /** Longueur du raccourci et de la portion de piste qu'il évite. */
  len: number
  mainLen: number
}

/** Circuit échantillonné (calcul pur, sans three : sert aussi aux outils de vérification). */
export interface Geo {
  n: number
  /** Longueur d'un tour (unités monde). */
  len: number
  px: Float32Array
  pz: Float32Array
  tx: Float32Array
  tz: Float32Array
  /** Demi-largeur de la piste à chaque échantillon. */
  hw: Float32Array
  /** Dalles turbo et tremplins : [début, fin] en échantillons. */
  boosts: [number, number][]
  jumps: [number, number][]
  /** Bosses (petit saut) et rangées de boîtes : échantillon. */
  bumps: number[]
  boxes: number[]
  /** Flaques : échantillon + écart latéral (unités). */
  puddles: { i: number; lat: number; x: number; z: number }[]
  /** Obstacles mobiles : traversent la piste de -amp à +amp en `period` secondes. */
  movers: { i: number; amp: number; period: number; phase: number }[]
  cut: Cut | null
  /** Début de chaque segment du tracé (fraction du tour) et défaut de fermeture (outil de mise au point). */
  segStart: number[]
  closeErr: number
}

const RAD = Math.PI / 180

/** Tracé « tortue » : lignes droites et arcs de cercle mis bout à bout depuis (0, 0), cap +x. */
export function compileTrack(def: TrackDef): Geo {
  const segs = def.path
  const lens = segs.map((s) => (s.s !== undefined ? s.s : (s.l ?? s.r ?? 0) * (s.a ?? 0) * RAD))
  const len = lens.reduce((a, b) => a + b, 0)
  const n = Math.round(len / SPACING / 8) * 8
  const ds = len / n
  const px = new Float32Array(n)
  const pz = new Float32Array(n)
  const tx = new Float32Array(n)
  const tz = new Float32Array(n)
  const mult = new Float32Array(n)

  // départ de chaque segment
  const sx: number[] = []
  const sz: number[] = []
  const sh: number[] = []
  const sd: number[] = []
  let x = 0
  let z = 0
  let h = 0
  let d = 0
  const at = (k: number, u: number): [number, number, number] => {
    const s = segs[k]
    if (s.s !== undefined) return [sx[k] + Math.cos(sh[k]) * u, sz[k] + Math.sin(sh[k]) * u, sh[k]]
    // gauche = cap qui diminue (vers -z)
    const dir = s.l !== undefined ? -1 : 1
    const R = (s.l ?? s.r)!
    const cx = sx[k] - Math.sin(sh[k]) * dir * R
    const cz = sz[k] + Math.cos(sh[k]) * dir * R
    const hh = sh[k] + (dir * u) / R
    return [cx + Math.sin(hh) * dir * R, cz - Math.cos(hh) * dir * R, hh]
  }
  segs.forEach((_, k) => {
    sx.push(x)
    sz.push(z)
    sh.push(h)
    sd.push(d)
    ;[x, z, h] = at(k, lens[k])
    d += lens[k]
  })
  const closeErr = Math.hypot(x, z)
  // le petit défaut de fermeture est réparti le long du tour
  let k = 0
  for (let i = 0; i < n; i++) {
    const dist = i * ds
    while (k < segs.length - 1 && dist >= sd[k] + lens[k]) k++
    const [qx, qz] = at(k, dist - sd[k])
    px[i] = qx - (x * dist) / len
    pz[i] = qz - (z * dist) / len
    mult[i] = segs[k].w ?? 1
  }
  for (let i = 0; i < n; i++) {
    const a = (i + n - 1) % n
    const b = (i + 1) % n
    const dx = px[b] - px[a]
    const dz = pz[b] - pz[a]
    const l = Math.hypot(dx, dz) || 1
    tx[i] = dx / l
    tz[i] = dz / l
  }
  // largeur : transitions douces entre sections larges et étroites
  let cur = mult
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(n)
    const R = 12
    let sum = 0
    for (let j = -R; j <= R; j++) sum += cur[(j + n) % n]
    for (let i = 0; i < n; i++) {
      next[i] = sum / (2 * R + 1)
      sum += cur[(i + R + 1) % n] - cur[(i - R + n) % n]
    }
    cur = next
  }
  const hw = new Float32Array(n)
  for (let i = 0; i < n; i++) hw[i] = (def.width / 2) * cur[i]

  const idx = (kk: number, t: number) => Math.round((sd[kk] + lens[kk] * t) / ds) % n
  const geo: Geo = { n, len, px, pz, tx, tz, hw, boosts: [], jumps: [], bumps: [], boxes: [], puddles: [], movers: [], cut: null, segStart: sd.map((v) => v / len), closeErr }
  let iA = -1
  let iB = -1
  segs.forEach((s, kk) => {
    for (const t of s.boost ?? []) geo.boosts.push([idx(kk, t), idx(kk, t) + 9])
    for (const t of s.jump ?? []) geo.jumps.push([idx(kk, t), idx(kk, t) + 6])
    for (const t of s.bump ?? []) geo.bumps.push(idx(kk, t))
    for (const t of s.box ?? []) geo.boxes.push(idx(kk, t))
    for (const [t, f] of s.puddle ?? []) {
      const i = idx(kk, t)
      const lat = f * hw[i]
      geo.puddles.push({ i, lat, x: px[i] - tz[i] * lat, z: pz[i] + tx[i] * lat })
    }
    for (const [t, period] of s.mover ?? []) {
      const i = idx(kk, t)
      geo.movers.push({ i, amp: hw[i] * 0.82, period, phase: (geo.movers.length * 0.37) % 1 })
    }
    if (s.cut?.[0] === 'in') iA = idx(kk, s.cut[1])
    if (s.cut?.[0] === 'out') iB = idx(kk, s.cut[1])
  })
  if (iA >= 0 && iB >= 0) geo.cut = buildCut(geo, iA, iB, def.cutK, (def.cutWidth ?? 7) / 2)
  return geo
}

/** Courbe de Bézier qui quitte la piste en A et la rejoint en B, tangente à la piste aux deux bouts. */
function buildCut(g: Geo, iA: number, iB: number, k: number | undefined, half: number): Cut {
  const w = (i: number) => ((i % g.n) + g.n) % g.n
  const A = [g.px[iA], g.pz[iA]]
  const B = [g.px[iB], g.pz[iB]]
  const kk = k ?? Math.hypot(B[0] - A[0], B[1] - A[1]) * 0.35
  const C1 = [A[0] + g.tx[iA] * kk, A[1] + g.tz[iA] * kk]
  const C2 = [B[0] - g.tx[iB] * kk, B[1] - g.tz[iB] * kk]
  const dense: [number, number][] = []
  for (let q = 0; q <= 200; q++) {
    const t = q / 200
    const u = 1 - t
    const c = (d: number) => u * u * u * A[d] + 3 * u * u * t * C1[d] + 3 * u * t * t * C2[d] + t * t * t * B[d]
    dense.push([c(0), c(1)])
  }
  // rééchantillonnage à pas constant
  const cum = [0]
  for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]))
  const total = cum[cum.length - 1]
  const count = Math.max(2, Math.round(total / SPACING))
  const all: [number, number][] = []
  let j = 0
  for (let i = 0; i <= count; i++) {
    const dd = (i / count) * total
    while (j < dense.length - 2 && cum[j + 1] < dd) j++
    const f = (dd - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j])
    all.push([dense[j][0] + (dense[j + 1][0] - dense[j][0]) * f, dense[j][1] + (dense[j + 1][1] - dense[j][1]) * f])
  }
  // on ne garde que la partie hors de la chaussée principale
  const span = w(iB - iA)
  const inside = ([qx, qz]: [number, number]) => {
    for (const [from, to] of [[iA - 10, iA + 90], [iB - 90, iB + 10]]) {
      for (let q = from; q <= to; q++) {
        const i = w(q)
        if ((qx - g.px[i]) ** 2 + (qz - g.pz[i]) ** 2 < (g.hw[i] - 0.5) ** 2) return true
      }
    }
    return false
  }
  let a = 0
  let b = all.length - 1
  while (a < b && inside(all[a])) a++
  while (b > a && inside(all[b])) b--
  const pts = all.slice(a, b + 1)
  const m = pts.length
  const cut: Cut = {
    iA, iB, m, half,
    x: new Float32Array(m), z: new Float32Array(m), tx: new Float32Array(m), tz: new Float32Array(m),
    len: total, mainLen: (span / g.n) * g.len,
  }
  for (let i = 0; i < m; i++) {
    cut.x[i] = pts[i][0]
    cut.z[i] = pts[i][1]
    const p = pts[Math.max(0, i - 1)]
    const q = pts[Math.min(m - 1, i + 1)]
    const l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1
    cut.tx[i] = (q[0] - p[0]) / l
    cut.tz[i] = (q[1] - p[1]) / l
  }
  return cut
}
