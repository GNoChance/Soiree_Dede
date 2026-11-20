// Tuto « Dédé Party » : le choix du plateau (5 plateaux, « Au hasard » par défaut), le tour des 5 plateaux et leur
// particularité, le plateau qui grandit avec le nombre de joueurs (tracés réels à plat, voir dede-party-boards.ts),
// puis la boucle de jeu sur le Grand Plateau en fausse 3D (projection en perspective maison, vue du téléphone) et les
// 6 mini-jeux. Keke et Dédé portent la tenue Animateur Télé (`host`) ; les autres restent en tenue par défaut.
import React from 'react'
import { C, DISPLAY, sticker, type Slug } from '../../theme'
import { Avatar, Bubble, Chibi, Finger, Panel, Pill, Pop, SPRING, Sfx, bob, bySlug, clamp01, easeInOut, lerp, nb, ramp, sp, wiggle } from '../kit'
import { Fly } from '../parts'
import { CAMPING, KERMESSE, MER_L, SKI, type Bd } from './dede-party-boards'
import type { MockScene, TutoSpec } from '../types'

const OUTFITS: Partial<Record<Slug, string>> = { kevin: 'host', dede: 'host' }
const INK = C.ink

// ---------------------------------------------------------------------------
// Dé dessiné (pastilles en CSS)
// ---------------------------------------------------------------------------
const PIPS: Record<number, number[]> = {
  1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
}
const Die: React.FC<{ v: number; size: number; rot?: number; style?: React.CSSProperties }> = ({ v, size, rot = 0, style }) => (
  <div
    style={{
      width: size, height: size, boxSizing: 'border-box', background: '#ffffff', border: `${Math.max(3, size * 0.06)}px solid ${INK}`, borderRadius: size * 0.2,
      boxShadow: `${size * 0.06}px ${size * 0.06}px 0 0 ${INK}`, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gridTemplateRows: 'repeat(3, 1fr)',
      padding: size * 0.12, transform: `rotate(${rot}deg)`, flexShrink: 0, ...style,
    }}
  >
    {Array.from({ length: 9 }, (_, i) => (
      <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {PIPS[v].includes(i) && <div style={{ width: size * 0.17, height: size * 0.17, borderRadius: '50%', background: INK }} />}
      </div>
    ))}
  </div>
)

/** Dé qui roule jusqu'à `settle` puis se pose sur `end` (avec un petit rebond). */
const RollDie: React.FC<{ f: number; size: number; seed: number; settle: number; end: number; style?: React.CSSProperties }> = ({ f, size, seed, settle, end, style }) => {
  const rolling = f < settle
  const v = rolling ? ((Math.floor(Math.max(0, f) / 3) + seed * 2) % 6) + 1 : end
  const land = clamp01((f - settle) / 10)
  const rot = rolling ? Math.sin(f * 0.8 + seed) * 22 : 0
  const s = rolling ? 1 : 1 + 0.25 * Math.sin(land * Math.PI)
  return <Die v={v} size={size} rot={rot} style={{ transform: `rotate(${rot}deg) scale(${s})`, ...style }} />
}

// ---------------------------------------------------------------------------
// Le Grand Plateau (copie de board.ts : types, tracé, embranchements)
// ---------------------------------------------------------------------------
type CellType = 'start' | 'clap' | 'pub' | 'env' | 'loge'
const CELLS: CellType[] = ['start', 'clap', 'pub', 'loge', 'clap', 'env', 'clap', 'loge', 'pub', 'clap', 'env', 'loge', 'clap', 'clap', 'pub', 'clap', 'env', 'loge', 'clap', 'pub', 'loge', 'clap', 'env', 'clap', 'clap', 'clap', 'env', 'loge', 'clap', 'pub', 'loge', 'clap', 'env', 'loge', 'pub', 'clap', 'clap', 'env', 'loge', 'clap', 'clap', 'pub', 'clap', 'pub', 'env', 'pub', 'clap']
const NEXT: Array<number | [number, number]> = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, [14, 36], 15, 16, 17, 18, 19, 20, 21, 22, [23, 41], 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 0, 37, 38, 39, 40, 15, 42, 43, 44, 45, 46, 25]
const LINKS: Array<[number, number]> = NEXT.flatMap((n, i) => (Array.isArray(n) ? n.map((x) => [i, x] as [number, number]) : [[i, n] as [number, number]]))
/** [colonne, ligne] sur la grille 11 × 9 (paysage). */
const XY: Array<[number, number]> = [
  [1, 8], [1, 7], [0, 7], [0, 6], [0, 5], [0, 4], [0, 3], [0, 2], [0, 1], [1, 1], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [7, 0], [8, 0],
  [9, 0], [9, 1], [10, 1], [10, 2], [10, 3], [10, 4], [10, 5], [10, 6], [10, 7], [10, 8], [9, 8], [8, 8], [7, 8], [6, 8], [5, 8], [4, 8], [3, 8], [2, 8],
  [4, 1], [4, 2], [5, 2], [6, 2], [6, 1],
  [9, 3], [8, 3], [8, 4], [8, 5], [8, 6], [9, 6],
]
const FORKS: { cell: number; ways: [number, number] }[] = [
  { cell: 13, ways: [14, 36] },
  { cell: 22, ways: [23, 41] },
]
const CI: Record<CellType, { e: string; c: string }> = {
  start: { e: '🎬', c: '#FFB703' },
  clap: { e: '👏', c: '#06D6A0' },
  pub: { e: '📺', c: '#EF476F' },
  env: { e: '✉️', c: '#8B5CF6' },
  loge: { e: '✨', c: '#4CC9F0' },
}

/** Position au sol d'une case (vue téléphone : X = ligne, Y = colonne, Y grand = fond de scène). */
const W2 = (cell: number): [number, number] => [XY[cell][1] - 4, XY[cell][0] - 5]

const shade = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16)
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)))
  return `rgb(${ch(n >> 16)}, ${ch((n >> 8) & 255)}, ${ch(n & 255)})`
}

// ---------------------------------------------------------------------------
// Caméra et projection (sténopé incliné de 52°)
// ---------------------------------------------------------------------------
type Cam = { tx: number; ty: number; d: number; oy: number }
type Pt = { x: number; y: number; s: number }
type Proj = (X: number, Y: number, Z?: number) => Pt
const PITCH = (52 * Math.PI) / 180
const CP = Math.cos(PITCH)
const SP = Math.sin(PITCH)
const mkProj = (cam: Cam, w: number, h: number): Proj => (X, Y, Z = 0) => {
  const ry = Y - cam.ty + cam.d * CP
  const rz = Z - cam.d * SP
  const s = (w * 1.26) / Math.max(0.5, ry * CP - rz * SP)
  return { x: w / 2 + (X - cam.tx) * s, y: h * cam.oy - (ry * SP + rz * CP) * s, s }
}
const mixCam = (a: Cam, b: Cam, t: number): Cam => ({ tx: lerp(a.tx, b.tx, t), ty: lerp(a.ty, b.ty, t), d: lerp(a.d, b.d, t), oy: lerp(a.oy, b.oy, t) })
const str = (pts: Pt[]) => pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')

/** Enveloppe convexe (silhouette d'un pavé projeté). */
const hull = (pts: Pt[]): Pt[] => {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y)
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const half = (list: Pt[]) => {
    const out: Pt[] = []
    for (const q of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], q) <= 0) out.pop()
      out.push(q)
    }
    out.pop()
    return out
  }
  return [...half(p), ...half([...p].reverse())]
}

/** Contour d'un carré arrondi (demi-côté `a`, rayon `r`) autour de (cx, cy). */
const roundSq = (cx: number, cy: number, a: number, r: number): [number, number][] => {
  const out: [number, number][] = []
  const corners: [number, number, number][] = [[1, 1, 0], [-1, 1, 90], [-1, -1, 180], [1, -1, 270]]
  for (const [sx, sy, a0] of corners) {
    for (let k = 0; k <= 4; k++) {
      const t = ((a0 + k * 22.5) * Math.PI) / 180
      out.push([cx + sx * (a - r) + Math.cos(t) * r, cy + sy * (a - r) + Math.sin(t) * r])
    }
  }
  return out
}
const disc = (P: Proj, cx: number, cy: number, r: number, z: number) => str(Array.from({ length: 28 }, (_, k) => P(cx + Math.cos((k / 28) * Math.PI * 2) * r, cy + Math.sin((k / 28) * Math.PI * 2) * r, z)))
const rect = (P: Proj, x0: number, x1: number, y0: number, y1: number, z: number) => str([P(x0, y0, z), P(x1, y0, z), P(x1, y1, z), P(x0, y1, z)])

const TILE_H = 0.24
const ORDER = CELLS.map((_, i) => i).sort((a, b) => W2(b)[1] - W2(a)[1])
const CROWD = ['#EF476F', '#FFD166', '#06D6A0', '#4CC9F0', '#FF8FA3', '#FFB570']
const SKIN = ['#ffd9b3', '#f2c097', '#c98d5e', '#ffe3c7']
const ARROW: [number, number][] = [[-0.5, -0.17], [0.02, -0.17], [0.02, -0.4], [0.56, 0], [0.02, 0.4], [0.02, 0.17], [-0.5, 0.17]]
const ESTRADE: [number, number] = [1.1, -1.1]
const TAGS = [
  { t: '🎭 La Scène', X: -2.4, Y: -1.85, z: 0.3, bg: '#FFD166' },
  { t: '📺 Tunnel de la pub', X: -0.2, Y: 2.2, z: 0.3, bg: '#FF8FA3' },
]

type Pawn = { slug: Slug; X: number; Y: number; hop?: number; mover?: boolean; expr?: string }
type Star = { X: number; Y: number; z?: number; k?: number }

const at = (cell: number): { X: number; Y: number } => ({ X: W2(cell)[0], Y: W2(cell)[1] })
/** Place d'un pion sur un trajet (liste de cases) à l'indice fractionnaire `p` : petit saut entre deux cases. */
const onPath = (path: number[], p: number): { X: number; Y: number; hop: number } => {
  const a = Math.min(path.length - 1, Math.floor(p))
  const b = Math.min(path.length - 1, a + 1)
  const t = p - a
  const A = W2(path[a])
  const B = W2(path[b])
  return { X: lerp(A[0], B[0], t), Y: lerp(A[1], B[1], t), hop: Math.sin(t * Math.PI) * 0.55 }
}
/** Indice atteint à la frame f : `hop` frames par case, départ à `start`, `n` sauts. */
const hopIdx = (f: number, start: number, n: number, hop: number) => {
  const p = clamp01((f - start) / (hop * n)) * n
  const k = Math.floor(p)
  return k >= n ? n : k + easeInOut(p - k)
}

/**
 * Le plateau télé en fausse 3D : rideau rouge, gradins et public, tapis, cases épaisses, La Scène dorée,
 * le Tunnel de la pub, l'estrade de Dédé, les flèches d'aiguillage, les étoiles et les pions sur socle.
 * `sw[i]` = voie ouverte de l'embranchement i (0 = tout droit, 1 = détour ; fractionnaire pendant la bascule).
 */
const Stage3D: React.FC<{
  f: number; w: number; h: number; cam: Cam; pawns: Pawn[]; stars: Star[]; sw: [number, number]; host?: string; lit?: number; tags?: number
  style?: React.CSSProperties; children?: React.ReactNode
}> = ({ f, w, h, cam, pawns, stars, sw, host = 'joie', lit = -1, tags = 2, style, children }) => {
  const u = w / 680
  const B = 5 * u
  const P = mkProj(cam, w, h)
  const sk = 4 * u
  const e0 = P(ESTRADE[0], ESTRADE[1], 0.3)
  return (
    <div style={{ position: 'relative', width: w, height: h, boxSizing: 'border-box', borderRadius: 34 * u, border: `${B}px solid ${INK}`, boxShadow: sticker(7 * u), background: '#ffc98a', overflow: 'hidden', ...style }}>
      <svg width={w} height={h} style={{ position: 'absolute', left: -B, top: -B }} strokeLinejoin="round" strokeLinecap="round">
        {/* rideau rouge */}
        <rect x={0} y={0} width={w} height={h * 0.2} fill="#d62839" />
        {Array.from({ length: 9 }, (_, k) => <rect key={k} x={(k + 0.5) * (w / 9) - 3 * u} y={0} width={6 * u} height={h * 0.2} fill="#b01e2e" />)}
        {Array.from({ length: 9 }, (_, k) => <circle key={k} cx={(k + 0.5) * (w / 9)} cy={h * 0.2} r={w / 18} fill="#d62839" />)}
        {/* gradins et public */}
        {[2, 1, 0].map((k) => {
          const y0 = 7 + k * 0.95
          const z1 = (k + 1) * 0.75
          const s = P(0, y0 + 0.45, z1).s
          return (
            <g key={k}>
              <polygon points={rect(P, -7, 7, y0, y0 + 0.95, z1)} fill="#8b6cf0" stroke={INK} strokeWidth={sk} />
              <polygon points={str([P(-7, y0, z1), P(7, y0, z1), P(7, y0, z1 - 0.75), P(-7, y0, z1 - 0.75)])} fill="#5f43c9" stroke={INK} strokeWidth={sk} />
              {Array.from({ length: 15 }, (_, j) => {
                const p = P(-6.3 + j * 0.9 + (k % 2) * 0.45, y0 + 0.45, z1)
                const hop = Math.abs(Math.sin((f + j * 7 + k * 11) / 9)) * 0.08 * s
                return (
                  <g key={j}>
                    <rect x={p.x - 0.22 * s} y={p.y - 0.62 * s - hop} width={0.44 * s} height={0.62 * s} rx={0.16 * s} fill={CROWD[(j + k * 2) % CROWD.length]} stroke={INK} strokeWidth={sk * 0.5} />
                    <circle cx={p.x} cy={p.y - 0.78 * s - hop} r={0.19 * s} fill={SKIN[(j * 3 + k) % SKIN.length]} stroke={INK} strokeWidth={sk * 0.5} />
                  </g>
                )
              })}
            </g>
          )
        })}
        {/* tapis */}
        <polygon points={rect(P, -5.45, 5.45, -6.4, 6.4, 0)} fill="#fff8ec" stroke={INK} strokeWidth={sk * 1.5} />
        {Array.from({ length: 22 }, (_, k) => {
          const p = P(((k * 37) % 90) / 10 - 4.5, ((k * 53) % 110) / 10 - 5.5, 0)
          return <circle key={k} cx={p.x} cy={p.y} r={0.07 * p.s} fill="#ffe2b8" />
        })}
        {/* La Scène (dorée) et le Tunnel de la pub */}
        <polygon points={rect(P, -3.6, -1.4, -1.6, 1.6, 0.02)} fill="#FFD166" stroke={INK} strokeWidth={sk} />
        <polygon points={rect(P, -1.6, 2.6, 2.4, 4.6, 0.02)} fill="#c9b8ff" stroke={INK} strokeWidth={sk} />
        {/* estrade de Dédé */}
        <polygon points={disc(P, ESTRADE[0], ESTRADE[1], 1.55, 0.02)} fill="#5f43c9" stroke={INK} strokeWidth={sk} />
        <polygon points={disc(P, ESTRADE[0], ESTRADE[1], 1.55, 0.2)} fill="#8B5CF6" stroke={INK} strokeWidth={sk} />
        <polygon points={disc(P, ESTRADE[0], ESTRADE[1], 1.1, 0.24)} fill="#FF8FA3" />
        <polygon points={disc(P, ESTRADE[0], ESTRADE[1], 0.62, 0.28)} fill="#FFD166" />
        {/* chemin */}
        {LINKS.map(([a, b]) => {
          const A = P(...W2(a), 0.05)
          const Bp = P(...W2(b), 0.05)
          return <line key={`o${a}-${b}`} x1={A.x} y1={A.y} x2={Bp.x} y2={Bp.y} stroke={INK} strokeWidth={0.36 * A.s} />
        })}
        {LINKS.map(([a, b]) => {
          const A = P(...W2(a), 0.05)
          const Bp = P(...W2(b), 0.05)
          return <line key={`i${a}-${b}`} x1={A.x} y1={A.y} x2={Bp.x} y2={Bp.y} stroke="#ffffff" strokeWidth={0.2 * A.s} />
        })}
        {/* cases épaisses, du fond vers l'avant */}
        {ORDER.map((i) => {
          const [X, Y] = W2(i)
          const on = i === lit
          const z = TILE_H + (on ? 0.1 : 0)
          const o = roundSq(X, Y, 0.43, 0.13)
          const top = o.map(([x, y]) => P(x, y, z))
          const side = hull([...top, ...o.map(([x, y]) => P(x, y, 0))])
          const c = P(X, Y, z)
          const col = CI[CELLS[i]].c
          return (
            <g key={i}>
              <polygon points={str(side)} fill={shade(col, 0.62)} stroke={INK} strokeWidth={sk} />
              <polygon points={str(top)} fill={col} stroke={on ? '#ffffff' : INK} strokeWidth={on ? sk * 1.3 : sk * 0.8} />
              <polygon points={str(roundSq(X, Y, 0.3, 0.1).map(([x, y]) => P(x, y, z)))} fill="#ffffff" opacity={0.28} />
              <text transform={`translate(${c.x.toFixed(1)} ${(c.y + 0.02 * c.s).toFixed(1)}) scale(1 0.8)`} fontSize={0.5 * c.s} textAnchor="middle" dominantBaseline="central">{CI[CELLS[i]].e}</text>
            </g>
          )
        })}
        {/* flèches d'aiguillage (jaunes, au-dessus de l'embranchement) */}
        {FORKS.map((fk, i) => {
          const [X, Y] = W2(fk.cell)
          const a0 = Math.atan2(W2(fk.ways[0])[1] - Y, W2(fk.ways[0])[0] - X)
          const a1 = Math.atan2(W2(fk.ways[1])[1] - Y, W2(fk.ways[1])[0] - X)
          const a = lerp(a0, a1, sw[i])
          const cx = X + Math.cos(a) * 0.62
          const cy = Y + Math.sin(a) * 0.62
          const k = 1.25 + 0.1 * Math.sin(f / 5 + i)
          const shape = (z: number) => str(ARROW.map(([x, y]) => P(cx + (x * Math.cos(a) - y * Math.sin(a)) * k, cy + (x * Math.sin(a) + y * Math.cos(a)) * k, z)))
          return (
            <g key={i}>
              <polygon points={shape(TILE_H + 0.02)} fill={INK} opacity={0.22} />
              <polygon points={shape(0.95 + 0.12 * Math.sin(f / 6 + i))} fill="#FFD23F" stroke={INK} strokeWidth={sk * 1.1} />
            </g>
          )
        })}
      </svg>
      {/* Dédé sur son estrade */}
      <div style={{ position: 'absolute', left: e0.x - B - e0.s * 1.25, top: e0.y - B - e0.s * 2.3, zIndex: 100 + Math.round((10 - ESTRADE[1]) * 10) }}>
        <Chibi slug="dede" expression={host} size={e0.s * 2.5} outfit="host" thumb={false} style={{ transform: `translateY(${bob(f, 0, 0.12 * e0.s, 28)}px)` }} />
      </div>
      {/* étiquettes des deux détours */}
      {TAGS.slice(0, tags).map((g) => {
        const p = P(g.X, g.Y, g.z)
        return (
          <div key={g.t} style={{ position: 'absolute', left: p.x - B, top: p.y - B, width: 0, height: 0, zIndex: 100 + Math.round((10 - g.Y) * 10) }}>
            <div style={{ position: 'absolute', left: 0, top: 0, transform: 'translate(-50%, -50%)', whiteSpace: 'nowrap', background: g.bg, border: `${3 * u}px solid ${INK}`, borderRadius: 10 * u, boxShadow: sticker(3 * u), fontFamily: DISPLAY, fontWeight: 800, color: INK, fontSize: Math.max(13 * u, 0.4 * p.s), lineHeight: 1, padding: `${0.14 * p.s}px ${0.2 * p.s}px ${0.08 * p.s}px` }}>{g.t}</div>
          </div>
        )
      })}
      {/* étoiles */}
      {stars.map((st, k) => {
        const p = P(st.X, st.Y, st.z ?? 1.05 + 0.12 * Math.sin(f / 7 + k))
        const size = 1.15 * p.s * (st.k ?? 1)
        if (size <= 1) return null
        return (
          <div key={k} style={{ position: 'absolute', left: p.x - B - size / 2, top: p.y - B - size / 2, width: size, height: size, zIndex: 101 + Math.round((10 - st.Y) * 10) }}>
            <div style={{ position: 'absolute', inset: '-18%', borderRadius: '50%', background: 'radial-gradient(circle, #fff7b0cc 0%, #fff7b000 68%)' }} />
            <div style={{ position: 'relative', fontSize: size * 0.86, lineHeight: `${size}px`, textAlign: 'center', transform: `rotate(${Math.sin(f / 9 + k) * 14}deg) scale(${1 + 0.08 * Math.sin(f / 5 + k)})` }}>⭐</div>
          </div>
        )
      })}
      {/* pions : chibi debout sur un socle */}
      {pawns.map((pw) => {
        const g = P(pw.X, pw.Y, TILE_H)
        const p = P(pw.X, pw.Y, TILE_H + (pw.hop ?? 0))
        const size = g.s * (pw.mover ? 1.75 : 1.4)
        return (
          <div key={pw.slug} style={{ position: 'absolute', left: -B, top: -B, zIndex: 100 + Math.round((10 - pw.Y) * 10) + (pw.mover ? 3 : 0) }}>
            <div style={{ position: 'absolute', left: g.x - 0.4 * g.s, top: g.y - 0.2 * g.s, width: 0.8 * g.s, height: 0.4 * g.s, borderRadius: '50%', background: INK, opacity: 0.25 }} />
            <div style={{ position: 'absolute', left: p.x - 0.38 * g.s, top: p.y - 0.24 * g.s, width: 0.76 * g.s, height: 0.44 * g.s, boxSizing: 'border-box', borderRadius: '50%', background: bySlug(pw.slug).color, border: `${3 * u}px solid ${INK}`, boxShadow: pw.mover ? `0 0 0 ${3 * u}px ${C.sun}` : undefined }} />
            <div style={{ position: 'absolute', left: p.x - size / 2, top: p.y - size * 0.93 }}>
              <Chibi slug={pw.slug} expression={pw.expr ?? 'joie'} size={size} outfit={OUTFITS[pw.slug]} thumb={false} />
            </div>
          </div>
        )
      })}
      {children}
    </div>
  )
}

const SW = 680
const SH = 645
const SX = 20
const OVERVIEW: Cam = { tx: 0, ty: 0, d: 17, oy: 0.555 }

/** Bandeau du haut du plateau : à qui le tour, ses dés, le total. */
const TurnBanner: React.FC<{ f: number; from: number; slug: Slug; name: string; dice: number[] }> = ({ f, from, slug, name, dice }) =>
  f >= from ? (
    <Pop f={f} at={from} from={-30} style={{ position: 'absolute', left: 0, right: 0, top: 8, display: 'flex', justifyContent: 'center', zIndex: 400 }}>
      <Panel bg={C.surface} radius={26} shadow={5} style={{ height: 70, display: 'flex', alignItems: 'center', gap: 10, padding: '0 18px 0 8px', border: `4px solid ${INK}` }}>
        <Avatar slug={slug} expression="joie" size={52} outfit={OUTFITS[slug]} />
        <div style={{ fontSize: 34, lineHeight: 1, paddingTop: 6 }}>{name}</div>
        {dice.map((d, k) => <Die key={k} v={d} size={42} />)}
        <div style={{ fontSize: 34, lineHeight: 1, paddingTop: 6 }}>= {dice.reduce((a, b) => a + b, 0)}</div>
      </Panel>
    </Pop>
  ) : null

/** Étiquette d'évènement, en haut du plateau comme dans l'appli. */
const Event: React.FC<{ f: number; from: number; to: number; bg: string; color?: string; children: React.ReactNode }> = ({ f, from, to, bg, color, children }) =>
  f >= from && f < to ? (
    <Pop f={f} at={from} rot={-1} from={-20} style={{ position: 'absolute', left: 0, right: 0, top: 88, display: 'flex', justifyContent: 'center', zIndex: 400 }}>
      <Pill bg={bg} color={color} size={34}>{children}</Pill>
    </Pop>
  ) : null

/** Dédé et sa bulle, sous le plateau. */
const DedeSays: React.FC<{ f: number; from: number; to: number; expr: string; children: React.ReactNode }> = ({ f, from, to, expr, children }) =>
  f >= from && f < to ? (
    <>
      <Pop f={f} at={from} from={30} style={{ position: 'absolute', left: 10, top: 652 }}>
        <Chibi slug="dede" expression={expr} size={146} outfit="host" />
      </Pop>
      <Pop f={f} at={from + 2} from={30} style={{ position: 'absolute', left: 160, top: 664 }}>
        <Bubble size={35} tail="none">{children}</Bubble>
      </Pop>
    </>
  ) : null

const Note: React.FC<{ f: number; from: number; to: number; bg: string; children: React.ReactNode }> = ({ f, from, to, bg, children }) =>
  f >= from && f < to ? (
    <Pop f={f} at={from} rot={-2} from={30} style={{ position: 'absolute', left: 0, right: 0, top: 808, display: 'flex', justifyContent: 'center' }}>
      <Pill bg={bg} size={36}>{children}</Pill>
    </Pop>
  ) : null

// ---------------------------------------------------------------------------
// Plateaux vus de dessus (tracés réels de boards/*.ts) : vignettes du choix, tour des 5 plateaux, plateau qui grandit
// ---------------------------------------------------------------------------
const CODE: Record<CellType, string> = { start: 's', clap: 'c', pub: 'p', env: 'e', loge: 'l' }
const TINT: Record<string, string> = { s: '#FFB703', c: '#06D6A0', p: '#EF476F', e: '#8B5CF6', l: '#4CC9F0', t: '#FF9F1C', L: '#3A86FF', i: '#BDEBFF', h: '#FFD166' }
const GRAND: Bd = { xy: XY, cells: CELLS.map((c) => CODE[c]).join(''), next: NEXT, jumps: [] }
/** Dédé-sur-Mer en format classique = les 45 premières cases de l'archipel. */
const MER: Bd = { xy: MER_L.xy.slice(0, 45), cells: MER_L.cells.slice(0, 45), next: MER_L.next.slice(0, 45).map((n) => (Array.isArray(n) ? n.filter((x) => x < 45) : n)), jumps: [] }

/** Cadrage d'un plateau à plat : centre (en cases) et pas (px par case). */
type View = { x: number; y: number; k: number }
type XYpx = [number, number]
const fit = (b: Bd, n: number, w: number, h: number): View => {
  const xs = b.xy.slice(0, n).map((p) => p[0])
  const ys = b.xy.slice(0, n).map((p) => p[1])
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys)
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, k: Math.min(w / (x1 - x0 + 1.9), h / (y1 - y0 + 1.9)) }
}
const mixView = (a: View, b: View, t: number): View => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), k: lerp(a.k, b.k, t) })
const toPx = (v: View, w: number, h: number) => (X: number, Y: number): XYpx => [w / 2 + (X - v.x) * v.k, h / 2 + (Y - v.y) * v.k]

/** Plateau à plat : une pastille par case, liaisons en ruban, transports (bacs, luge) en pointillés, sol optionnel. */
const Flat: React.FC<{ b: Bd; w: number; h: number; view: View; land?: string; show?: (i: number) => number }> = ({ b, w, h, view, land, show }) => {
  const px = toPx(view, w, h)
  const k = view.k
  const sw = Math.max(1.4, k * 0.07)
  const vis = b.xy.map((_, i) => (show ? clamp01(show(i)) : 1))
  const links = b.next.flatMap((n, i) => (Array.isArray(n) ? n : [n]).filter((t) => t < b.xy.length && vis[i] > 0 && vis[t] > 0).map((t) => {
    const A = px(b.xy[i][0], b.xy[i][1])
    const B = px(b.xy[t][0], b.xy[t][1])
    return { id: `${i}-${t}`, A, B, far: Math.abs(b.xy[i][0] - b.xy[t][0]) + Math.abs(b.xy[i][1] - b.xy[t][1]) > 1, o: Math.min(vis[i], vis[t]) }
  }))
  return (
    <svg width={w} height={h} style={{ position: 'absolute', left: 0, top: 0 }} strokeLinecap="round" strokeLinejoin="round">
      {land && [k * 0.9 + sw * 1.5, k * 0.9].map((r0, pass) => b.xy.map(([X, Y], i) => {
        if (vis[i] <= 0) return null
        const [x, y] = px(X, Y)
        const r = r0 * vis[i]
        return <rect key={`${pass}-${i}`} x={x - r} y={y - r} width={r * 2} height={r * 2} rx={k * 0.45} fill={pass ? land : INK} />
      }))}
      {links.filter((l) => l.far).map((l) => <line key={l.id} x1={l.A[0]} y1={l.A[1]} x2={l.B[0]} y2={l.B[1]} stroke={INK} strokeWidth={sw * 1.4} strokeDasharray={`${k * 0.2} ${k * 0.36}`} opacity={l.o} />)}
      {links.filter((l) => !l.far).map((l) => <line key={l.id} x1={l.A[0]} y1={l.A[1]} x2={l.B[0]} y2={l.B[1]} stroke={INK} strokeWidth={k * 0.36} />)}
      {links.filter((l) => !l.far).map((l) => <line key={l.id} x1={l.A[0]} y1={l.A[1]} x2={l.B[0]} y2={l.B[1]} stroke="#ffffff" strokeWidth={k * 0.18} />)}
      {b.xy.map(([X, Y], i) => {
        if (vis[i] <= 0) return null
        const [x, y] = px(X, Y)
        const r = k * 0.39 * vis[i]
        return <rect key={i} x={x - r} y={y - r} width={r * 2} height={r * 2} rx={r * 0.45} fill={TINT[b.cells[i]]} stroke={INK} strokeWidth={sw} />
      })}
    </svg>
  )
}

/** Position (en cases) sur un trajet à l'indice fractionnaire `p`, et hauteur du petit saut (0 → 1 → 0). */
const walk = (b: Bd, path: number[], p: number): [number, number, number] => {
  const a = Math.min(path.length - 1, Math.floor(p))
  const c = Math.min(path.length - 1, a + 1)
  const t = p - a
  return [lerp(b.xy[path[a]][0], b.xy[path[c]][0], t), lerp(b.xy[path[a]][1], b.xy[path[c]][1], t), Math.sin(t * Math.PI)]
}
const Tok: React.FC<{ p: XYpx; size: number; slug: Slug; expr?: string; lift?: number }> = ({ p, size, slug, expr, lift = 0 }) => (
  <div style={{ position: 'absolute', left: p[0] - size / 2, top: p[1] - size / 2 - lift, zIndex: 6 }}>
    <Avatar slug={slug} expression={expr} size={size} outfit={OUTFITS[slug]} />
  </div>
)
const Emo: React.FC<{ p: XYpx; size: number; rot?: number; z?: number; children: React.ReactNode }> = ({ p, size, rot = 0, z = 4, children }) => (
  <div style={{ position: 'absolute', left: p[0], top: p[1], fontSize: size, lineHeight: 1, transform: `translate(-50%, -50%) rotate(${rot}deg)`, zIndex: z }}>{children}</div>
)
/** Petite étiquette qui surgit sur un point du plateau. */
const Tag: React.FC<{ f: number; from: number; to?: number; p: XYpx; bg?: string; children: React.ReactNode }> = ({ f, from, to = 999, p, bg = C.surface, children }) =>
  f >= from && f < to ? (
    <Pop f={f} at={from} style={{ position: 'absolute', left: p[0], top: p[1], width: 0, height: 0, zIndex: 8 }}>
      <div style={{ position: 'absolute', left: 0, top: 0, transform: 'translate(-50%, -50%)' }}>
        <Pill bg={bg} size={28} style={{ boxShadow: sticker(3), border: `3px solid ${INK}` }}>{children}</Pill>
      </div>
    </Pop>
  ) : null

const MAPS: { e: string; name: string; b: Bd; c: string }[] = [
  { e: '🎤', name: 'Le Grand Plateau', b: GRAND, c: '#FFD9A0' },
  { e: '🏖️', name: 'Dédé-sur-Mer', b: MER, c: '#A6E0FF' },
  { e: '🎪', name: 'La Kermesse', b: KERMESSE, c: '#FFC2D9' },
  { e: '🏕️', name: 'Le Camping', b: CAMPING, c: '#C4EBA8' },
  { e: '⛷️', name: 'Dédé 2000', b: SKI, c: '#DDF1FF' },
]

// ---------------------------------------------------------------------------
// 1 — Le choix du plateau : 6 cartes, « Au hasard » par défaut, et le tirage au sort
// ---------------------------------------------------------------------------
const SPIN = [0, 2, 4, 1, 3, 0, 2, 4, 3, 0, 1]
const SPIN_AT = 34
const SPIN_STEP = 4
const LOCK = SPIN_AT + (SPIN.length - 1) * SPIN_STEP

const Pick: MockScene = ({ f }) => {
  const step = f < SPIN_AT ? -1 : Math.min(SPIN.length - 1, Math.floor((f - SPIN_AT) / SPIN_STEP))
  const hot = step < 0 ? -1 : SPIN[step]
  const locked = f >= LOCK
  const bump = Math.sin(ramp(f, LOCK, LOCK + 10) * Math.PI)
  return (
    <>
      {MAPS.map((m, i) => {
        const on = i === hot
        return (
          <Pop key={i} f={f} at={i * 3} from={40} rot={i % 2 ? 1 : -1} style={{ position: 'absolute', left: 26 + (i % 2) * 344, top: 4 + Math.floor(i / 2) * 182, zIndex: on ? 2 : 1 }}>
            <Panel bg={on ? m.c : C.surface} radius={30} shadow={6} style={{ width: 324, height: 166, display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px 0 14px', ...(on ? { boxShadow: `${sticker(8)}, 0 0 0 6px ${C.sun}`, transform: `scale(${1.05 + (locked ? 0.06 * bump : 0)})` } : {}) }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 52, lineHeight: 1 }}>{m.e}</div>
                <div style={{ fontSize: 29, lineHeight: 1.02, marginTop: 8 }}>{m.name}</div>
              </div>
              <div style={{ position: 'relative', width: 116, height: 100, flexShrink: 0 }}>
                <Flat b={m.b} w={116} h={100} view={fit(m.b, m.b.xy.length, 116, 100)} />
              </div>
            </Panel>
          </Pop>
        )
      })}
      <Pop f={f} at={15} from={40} rot={1} style={{ position: 'absolute', left: 370, top: 368, zIndex: 3 }}>
        <Panel bg={C.sun} radius={30} shadow={8} style={{ width: 324, height: 166, border: `7px solid ${INK}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, transform: `rotate(${f >= SPIN_AT && !locked ? wiggle(f, 0, 3, 8) : 0}deg)` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 54, lineHeight: 1, display: 'inline-block', transform: `rotate(${f >= SPIN_AT && !locked ? f * 24 : 0}deg)` }}>🎲</span>
            <span style={{ fontSize: 40, lineHeight: 1, paddingTop: 6 }}>Au hasard</span>
          </div>
          <div style={{ fontSize: 30, lineHeight: 1, letterSpacing: 3 }}>🎤🏖️🎪🏕️⛷️</div>
        </Panel>
        <div style={{ position: 'absolute', right: -12, top: -22, transform: 'rotate(6deg)' }}><Pill bg={C.mint} size={24}>Par défaut</Pill></div>
      </Pop>
      <Pop f={f} at={24} from={50} style={{ position: 'absolute', left: 30, top: 558 }}>
        <Panel bg={locked ? C.mint : C.surface} radius={34} shadow={8} style={{ width: 660, height: 108, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, fontSize: 40, lineHeight: 1, whiteSpace: 'nowrap', transform: `scale(${1 + 0.08 * bump})` }}>
          <span style={{ paddingTop: 6 }}>Ce soir :</span>
          <span style={{ fontSize: 56 }}>{hot < 0 ? '🎲' : MAPS[hot].e}</span>
          <span style={{ paddingTop: 6 }}>{hot < 0 ? '…' : MAPS[hot].name}</span>
        </Panel>
      </Pop>
      <Pop f={f} at={20} from={120} style={{ position: 'absolute', left: 14, top: 690 }}>
        <Chibi slug="dede" expression={locked ? 'joie' : 'clin_oeil'} size={180} outfit="host" style={{ transform: `translateY(${bob(f, 0, 8, 28)}px)` }} />
      </Pop>
      {f < LOCK + 4 ? (
        <Pop f={f} at={SPIN_AT} from={30} style={{ position: 'absolute', left: 204, top: 730 }}>
          <Bubble size={36} tail="none">Roulement de tambour…</Bubble>
        </Pop>
      ) : (
        <Pop f={f} at={LOCK + 4} from={30} style={{ position: 'absolute', left: 204, top: 712 }}>
          <Bubble size={36} bg={C.sun} tail="none">Crème solaire<br />pour tout le monde !</Bubble>
        </Pop>
      )}
      <Sfx name="pop" at={4} volume={0.4} />
      <Sfx name="pop" at={16} volume={0.4} />
      <Sfx name="whoosh" at={24} volume={0.3} />
      {SPIN.map((_, k) => <Sfx key={k} name="tap" at={SPIN_AT + k * SPIN_STEP} volume={0.35} />)}
      <Sfx name="success" at={LOCK} volume={0.5} />
      <Sfx name="pop" at={LOCK + 6} volume={0.5} />
    </>
  )
}

// ---------------------------------------------------------------------------
// 2 — Le tour des 5 plateaux : une carte par plateau, sa particularité animée sur le vrai tracé
// ---------------------------------------------------------------------------
const BW = 632
const BH = 422
const SLIDE = 46
/** Décalage (en frames de l’étape) de la carte affichée : ses effets sonores `Sx` sont calés sur sa frame locale. */
const T0 = React.createContext(0)
const Sx: React.FC<React.ComponentProps<typeof Sfx>> = (p) => <Sfx {...p} at={p.at + React.useContext(T0)} />

const Slide: React.FC<{ g: number; e: string; name: string; bg: string; note: string; noteBg: string; children: React.ReactNode }> = ({ g, e, name, bg, note, noteBg, children }) => {
  const s = sp(g, 0, SPRING.snappy)
  return (
    <div style={{ position: 'absolute', left: 20, top: 0, transform: `translateX(${(1 - s) * 740}px) rotate(${(1 - s) * 5}deg)` }}>
      <Panel radius={40} shadow={9} style={{ position: 'relative', width: 680, height: 640 }}>
        <div style={{ position: 'absolute', left: 0, right: 0, top: 10, height: 84, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, whiteSpace: 'nowrap' }}>
          <span style={{ fontSize: 62, lineHeight: 1 }}>{e}</span>
          <span style={{ fontSize: name.length > 18 ? 42 : 50, lineHeight: 1, paddingTop: 8 }}>{name}</span>
        </div>
        <div style={{ position: 'absolute', left: 15, top: 98, width: BW, height: BH, border: `4px solid ${INK}`, borderRadius: 26, background: bg, overflow: 'hidden' }}>{children}</div>
        <div style={{ position: 'absolute', left: 0, right: 0, top: 548, display: 'flex', justifyContent: 'center' }}>
          <Pop f={g} at={8} rot={-1.5}><Pill bg={noteBg} size={34}>{note}</Pill></Pop>
        </div>
      </Panel>
    </div>
  )
}

const V_GRAND = fit(GRAND, 47, BW, BH)
const SlideGrand: React.FC<{ g: number }> = ({ g }) => {
  const px = toPx(V_GRAND, BW, BH)
  const k = V_GRAND.k
  const a = walk(GRAND, [11, 12, 13, 36, 37, 38], hopIdx(g, 5, 5, 4))
  const m = walk(GRAND, [10, 11, 12, 13, 14, 15], hopIdx(g, 23, 5, 4))
  const rad = (lerp(90, 0, easeInOut(ramp(g, 15, 21))) * Math.PI) / 180
  const c = px(XY[13][0] + Math.cos(rad) * 0.12, XY[13][1] + Math.sin(rad) * 0.12)
  const S = k * 1.3 * (1 + 0.07 * Math.sin(g / 2.5))
  return (
    <Slide g={g} e={MAPS[0].e} name={MAPS[0].name} bg="#FFE7C2" note="🔀 Les aiguillages basculent !" noteBg={C.sun}>
      <Flat b={GRAND} w={BW} h={BH} view={V_GRAND} />
      <Emo p={px(5, 1.05)} size={k * 0.8}>🎭</Emo>
      <Emo p={px(9, 4.5)} size={k * 0.8}>📺</Emo>
      <Emo p={px(4.2, 5.6)} size={k * 2.2} rot={wiggle(g, 0, 4, 30)}>🎤</Emo>
      <svg width={BW} height={BH} style={{ position: 'absolute', left: 0, top: 0, zIndex: 5 }} strokeLinejoin="round">
        <polygon points={ARROW.map(([x, y]) => `${(c[0] + (x * Math.cos(rad) - y * Math.sin(rad)) * S).toFixed(1)},${(c[1] + (x * Math.sin(rad) + y * Math.cos(rad)) * S).toFixed(1)}`).join(' ')} fill="#FFD23F" stroke={INK} strokeWidth={4} />
      </svg>
      <Tok p={px(m[0], m[1])} size={k * 1.05} slug="manon" lift={m[2] * k * 0.3} />
      <Tok p={px(a[0], a[1])} size={k * 1.05} slug="kevin" lift={a[2] * k * 0.3} />
      <Tag f={g} from={13} to={30} p={px(5, 3.5)} bg="#FFD166">🎭 Keke file sur La Scène</Tag>
      <Tag f={g} from={30} p={px(5, 3.5)} bg={C.mint}>➡️ Manon : tout droit !</Tag>
      <Sx name="tap" at={13} volume={0.4} />
      <Sx name="whoosh" at={15} volume={0.3} />
      <Sx name="pop" at={30} volume={0.4} />
    </Slide>
  )
}

const V_MER = fit(MER, 45, BW, BH)
const SlideMer: React.FC<{ g: number }> = ({ g }) => {
  const px = toPx(V_MER, BW, BH)
  const k = V_MER.k
  const tide = easeInOut(ramp(g, 17, 26))
  const w = walk(MER, [12, 36, 37, 38, 39], hopIdx(g, 2, 4, 4))
  const swept = easeInOut(ramp(g, 24, 35))
  const from = px(w[0], w[1])
  const to = px(MER.xy[14][0], MER.xy[14][1])
  const p0 = px(3.42, 0.56)
  const p1 = px(6.58, 4.6)
  return (
    <Slide g={g} e={MAPS[1].e} name={MAPS[1].name} bg="#7FD0F7" note="🌊 La marée monte : gare au sable !" noteBg={C.sky}>
      <Flat b={MER} w={BW} h={BH} view={V_MER} land="#FFE9B0" />
      <Emo p={px(2.1, 5.6 + 0.08 * Math.sin(g / 5))} size={k * 1.1} rot={wiggle(g, 0, 6, 28)}>⛵</Emo>
      <Emo p={px(8.2, 5.2)} size={k * 1.2}>⛱️</Emo>
      <div style={{ position: 'absolute', left: p0[0], top: p0[1], width: p1[0] - p0[0], height: p1[1] - p0[1], borderRadius: k * 0.5, background: '#1E88D6', opacity: 0.86 * tide, zIndex: 3 }} />
      {tide > 0 && <Emo p={px(5, 2.5)} size={k * 1.9 * tide} rot={wiggle(g, 0, 8, 12)} z={5}>🌊</Emo>}
      <Tok p={px(MER.xy[17][0], MER.xy[17][1])} size={k * 1.05} slug="dede" />
      <Tok p={[lerp(from[0], to[0], swept), lerp(from[1], to[1], swept)]} size={k * 1.05} slug="mika" expr={g >= 20 ? 'pleurs' : 'cool'} lift={w[2] * k * 0.3 + Math.sin(swept * Math.PI) * k * 0.9} />
      <Tag f={g} from={5} to={18} p={px(5, 6.2)} bg="#FFE9B0">🏝️ Raccourci : le Banc de sable</Tag>
      <Tag f={g} from={30} p={px(5, 6.2)} bg={C.bubblegum}>Mika emporté : −5 🪙 !</Tag>
      <Sx name="whoosh" at={17} volume={0.45} />
      <Sx name="pop" at={30} volume={0.5} />
    </Slide>
  )
}

const V_KER = fit(KERMESSE, 40, BW, BH)
const SlideKermesse: React.FC<{ g: number }> = ({ g }) => {
  const px = toPx(V_KER, BW, BH)
  const k = V_KER.k
  const a = walk(KERMESSE, [11, 12, 13, 14, 15], hopIdx(g, 3, 4, 4))
  const d = walk(KERMESSE, [30, 31, 32, 33], hopIdx(g, 21, 3, 4))
  const pot = g < 11 ? 5 : g < 35 ? 8 : 5
  const pp = px(8, 3)
  const bump = Math.max(Math.sin(ramp(g, 11, 19) * Math.PI), Math.sin(ramp(g, 35, 43) * Math.PI))
  return (
    <Slide g={g} e={MAPS[2].e} name={MAPS[2].name} bg="#FFD3E4" note="🎟️ Tombola : pile dessus, gros lot !" noteBg={C.bubblegum}>
      <Flat b={KERMESSE} w={BW} h={BH} view={V_KER} />
      <Emo p={px(2, 3)} size={k * 2.1} rot={wiggle(g, 0, 3, 30)}>🎪</Emo>
      <Emo p={px(5, 3)} size={k * 0.85}>🎟️</Emo>
      <div style={{ position: 'absolute', left: pp[0] - 76, top: pp[1] - 62, zIndex: 4, transform: `scale(${1 + 0.18 * bump})` }}>
        <Panel bg={C.sun} radius={22} shadow={4} style={{ width: 152, height: 124, border: `4px solid ${INK}`, textAlign: 'center' }}>
          <div style={{ fontSize: 25, lineHeight: 1, marginTop: 16 }}>Cagnotte</div>
          <div style={{ fontSize: 50, lineHeight: 1, marginTop: 10 }}>🪙 {pot}</div>
        </Panel>
      </div>
      <Tok p={px(a[0], a[1])} size={k * 0.95} slug="kevin" lift={a[2] * k * 0.3} />
      <Tok p={px(d[0], d[1])} size={k * 0.95} slug="dede" expr={g >= 35 ? 'joie' : 'cool'} lift={d[2] * k * 0.3} />
      <Fly f={g} at={11} len={8} from={px(5, 2)} to={pp} arc={50} size={34}>🪙</Fly>
      <Fly f={g} at={35} len={8} from={pp} to={px(5, 4)} arc={50} size={40}>💰</Fly>
      <Tag f={g} from={11} to={30} p={px(5, 0.75)}>En passant : −3 🪙</Tag>
      <Tag f={g} from={37} p={px(5, 5.5)} bg={C.mint}>Gros lot : +8 🪙 !</Tag>
      <Sx name="tap" at={11} volume={0.4} />
      <Sx name="success" at={35} volume={0.45} />
    </Slide>
  )
}

const V_CAMP = fit(CAMPING, 36, BW, BH)
const SlideCamping: React.FC<{ g: number }> = ({ g }) => {
  const px = toPx(V_CAMP, BW, BH)
  const k = V_CAMP.k
  const r = walk(CAMPING, [18, 17, 16, 15, 14], hopIdx(g, 4, 4, 5))
  const rp = px(r[0] + 0.95 * ramp(g, 19, 24), r[1] - 0.3 * ramp(g, 19, 24))
  const hit = g >= 25
  return (
    <Slide g={g} e={MAPS[3].e} name={MAPS[3].name} bg="#BFE6A3" note="🦝 Riton chipe… puis lâche tout !" noteBg={C.mint}>
      <Flat b={CAMPING} w={BW} h={BH} view={V_CAMP} />
      <Emo p={px(5, 4)} size={k * 1.2 * (1 + 0.06 * Math.sin(g / 2))}>🔥</Emo>
      <Emo p={px(1.4, 7.1)} size={k * 1.5}>⛺</Emo>
      <Emo p={px(8.4, 7)} size={k * 1.4}>🌲</Emo>
      <Emo p={px(9.5, 7.5)} size={k * 1.2}>🌲</Emo>
      <Emo p={px(1.3, 1.9)} size={k * 1.3}>🌲</Emo>
      <Tok p={px(CAMPING.xy[14][0], CAMPING.xy[14][1])} size={k * 1.05} slug="manon" expr={hit ? 'pleurs' : 'joie'} />
      <Emo p={[rp[0], rp[1] - r[2] * k * 0.35]} size={k * 1.25} rot={hit ? wiggle(g, 0, 10, 8) : 0} z={7}>🦝</Emo>
      <Tag f={g} from={3} to={25} p={px(9, 1.2)}>🦝 À contresens !</Tag>
      <Tag f={g} from={25} p={px(1.6, 0.5)} bg={C.bubblegum}>Manon : −5 🪙</Tag>
      <Tag f={g} from={30} p={px(9, 1.2)} bg={C.sun}>💰 Sac plein…</Tag>
      <Sx name="tap" at={9} volume={0.3} />
      <Sx name="tap" at={14} volume={0.3} />
      <Sx name="tap" at={19} volume={0.3} />
      <Sx name="pop" at={25} volume={0.55} />
    </Slide>
  )
}

const LIFTS: [number, number][] = [[3, 37], [6, 40], [12, 42], [15, 45], [21, 47]]
const ICES: [number, number][] = [[36, 2], [43, 13], [46, 20]]
const V_SKI = fit(SKI, 49, BW, BH)
const SlideSki: React.FC<{ g: number }> = ({ g }) => {
  const px = toPx(V_SKI, BW, BH)
  const k = V_SKI.k
  const cell = (i: number) => px(SKI.xy[i][0], SKI.xy[i][1])
  const a = walk(SKI, [10, 11, 12], hopIdx(g, 2, 2, 4))
  const ride = easeInOut(ramp(g, 12, 22))
  const ap: XYpx = [lerp(px(a[0], a[1])[0], cell(42)[0], ride), lerp(px(a[0], a[1])[1], cell(42)[1], ride)]
  const m = walk(SKI, [44, 45, 46], hopIdx(g, 20, 2, 4))
  const slip = easeInOut(ramp(g, 30, 38))
  const mp: XYpx = [lerp(px(m[0], m[1])[0], cell(20)[0], slip), lerp(px(m[0], m[1])[1], cell(20)[1], slip)]
  return (
    <Slide g={g} e={MAPS[4].e} name={MAPS[4].name} bg="#E3F3FF" note="🚡 Télésièges, 🧊 verglas, 🛷 luge !" noteBg={C.sky}>
      <Flat b={SKI} w={BW} h={BH} view={V_SKI} />
      <Emo p={px(5.9, 6)} size={k * 2.6}>🏔️</Emo>
      <Emo p={px(3.7, 6.5)} size={k * 0.95} rot={-20}>🛷</Emo>
      <svg width={BW} height={BH} style={{ position: 'absolute', left: 0, top: 0, zIndex: 3 }} strokeLinecap="round">
        {LIFTS.map(([x, y]) => <line key={x} x1={cell(x)[0]} y1={cell(x)[1]} x2={cell(y)[0]} y2={cell(y)[1]} stroke="#3A86FF" strokeWidth={5} strokeDasharray="2 10" />)}
        {ICES.map(([x, y]) => <line key={x} x1={cell(x)[0]} y1={cell(x)[1]} x2={cell(y)[0]} y2={cell(y)[1]} stroke="#39A9DB" strokeWidth={5} strokeDasharray="2 10" />)}
      </svg>
      {LIFTS.map(([x]) => <Emo key={x} p={cell(x)} size={k * 0.62}>🚡</Emo>)}
      {ICES.map(([x]) => <Emo key={x} p={cell(x)} size={k * 0.62}>🧊</Emo>)}
      <Tok p={ap} size={k * 1.05} slug="kevin" expr={g >= 22 ? 'joie' : 'cool'} lift={a[2] * k * 0.3 + Math.sin(ride * Math.PI) * k * 0.25} />
      <Tok p={mp} size={k * 1.05} slug="mika" expr={g >= 30 ? 'pleurs' : 'cool'} lift={m[2] * k * 0.3} />
      <Tag f={g} from={16} to={34} p={px(4.6, 3.6)} bg={C.mint}>🚡 Keke grimpe : +30 cases</Tag>
      <Tag f={g} from={34} p={px(5.6, 3.6)} bg={C.bubblegum}>🧊 Mika glisse : −26 cases</Tag>
      <Sx name="swoosh-up" at={12} volume={0.45} />
      <Sx name="whoosh" at={30} volume={0.4} />
      <Sx name="pop" at={34} volume={0.4} />
    </Slide>
  )
}

const SLIDES = [SlideGrand, SlideMer, SlideKermesse, SlideCamping, SlideSki]

const Tour: MockScene = ({ f }) => {
  const cur = Math.min(SLIDES.length - 1, Math.max(0, Math.floor(f / SLIDE)))
  const Cur = SLIDES[cur]
  return (
    <>
      <T0.Provider value={cur * SLIDE + 8}><Cur g={f - cur * SLIDE} /></T0.Provider>
      {MAPS.map((m, i) => {
        const on = i === cur
        const s = on ? 1 + 0.16 * sp(f, cur * SLIDE) : 1
        return (
          <div key={i} style={{ position: 'absolute', left: 56 + i * 126, top: 672, transform: `scale(${s}) rotate(${on ? wiggle(f, 0, 3, 24) : 0}deg)`, opacity: i > cur ? 0.7 : 1, zIndex: on ? 2 : 1 }}>
            <Panel bg={on ? m.c : i < cur ? C.sunk : C.surface} radius={28} shadow={on ? 7 : 4} style={{ width: 104, height: 104, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 58, lineHeight: 1 }}>{m.e}</Panel>
          </div>
        )
      })}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 804, display: 'flex', justifyContent: 'center' }}>
        <Pill bg={C.surface} size={30}>Plateau {cur + 1} / 5</Pill>
      </div>
      {SLIDES.map((_, i) => <Sfx key={i} name="whoosh" at={i * SLIDE + 8} volume={0.3} />)}
    </>
  )
}

// ---------------------------------------------------------------------------
// 3 — Plus on est nombreux, plus le plateau est grand : Dédé-sur-Mer en 45, 100 puis 201 cases
// ---------------------------------------------------------------------------
const GW = 670
const GH = 520
/** Cadrage un peu plus large que `fit` : les îles ne touchent pas le bord du cadre. */
const fitG = (n: number): View => {
  const v = fit(MER_L, n, GW, GH)
  return { ...v, k: v.k * 0.95 }
}
const V_S = fitG(45)
const V_M = fitG(100)
const V_L = fitG(201)
const CROWD8: Slug[] = ['kevin', 'dede', 'manon', 'mika', 'cycy', 'cecile', 'marius', 'nini']
const CROWD_AT = [0, 2, 4, 6, 40, 43, 88, 91]
const ISLES = [
  { e: '🐦', a: 45, b: 73, at: 50 },
  { e: '🥥', a: 73, b: 100, at: 54 },
  { e: '🌋', a: 100, b: 131, at: 98 },
  { e: '🏴‍☠️', a: 131, b: 167, at: 101 },
  { e: '🦀', a: 167, b: 201, at: 104 },
].map((q) => {
  const pts = MER_L.xy.slice(q.a, q.b)
  return { ...q, x: pts.reduce((n, p) => n + p[0], 0) / pts.length, y: pts.reduce((n, p) => n + p[1], 0) / pts.length }
})
const G_PLAYERS = ['2 à 4 joueurs', '5 ou 6 joueurs', '7 ou 8 joueurs']
const G_AT = [0, 40, 88]
const G_SIZE: { t: string; bg: string }[] = [
  { t: '🏖️ Dédé-sur-Mer : 45 cases', bg: C.sky },
  { t: '⛴️ 2 îles en plus : 100 cases !', bg: C.sun },
  { t: '🏝️ L’archipel géant : 201 cases !', bg: C.bubblegum },
]
const G_SUB = ['Petit comité, petit plateau', 'Pareil sur les 5 plateaux !', '⛷️ Dédé 2000 aussi : 204 cases !']

const Grow: MockScene = ({ f }) => {
  const view = mixView(mixView(V_S, V_M, easeInOut(ramp(f, 40, 56))), V_L, easeInOut(ramp(f, 88, 104)))
  const px = toPx(view, GW, GH)
  const phase = f < G_AT[1] ? 0 : f < G_AT[2] ? 1 : 2
  const show = (i: number) => (i < 45 ? 1 : i < 100 ? sp(f, 42 + Math.round((i - 45) * 0.22), SPRING.snappy) : sp(f, 90 + Math.round((i - 100) * 0.12), SPRING.snappy))
  return (
    <>
      {CROWD8.map((slug, i) => (
        <div key={slug} style={{ position: 'absolute', left: 68 + i * 74, top: 0, width: 66, height: 66 }}>
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: `3px dashed ${INK}66`, background: '#ffffff66', boxSizing: 'border-box' }} />
          <Pop f={f} at={CROWD_AT[i]} style={{ position: 'absolute', left: 0, top: 0 }}><Avatar slug={slug} size={66} outfit={OUTFITS[slug]} /></Pop>
        </div>
      ))}
      <Pop f={f} at={G_AT[phase]} rot={-2} style={{ position: 'absolute', left: 0, right: 0, top: 80, display: 'flex', justifyContent: 'center' }}>
        <Pill bg={C.surface} size={40}>👥 {G_PLAYERS[phase]}</Pill>
      </Pop>
      <div style={{ position: 'absolute', left: 20, top: 160, width: GW, height: GH, border: `5px solid ${INK}`, borderRadius: 34, boxShadow: sticker(8), background: '#7FD0F7', overflow: 'hidden' }}>
        <Flat b={MER_L} w={GW} h={GH} view={view} land="#FFE9B0" show={show} />
        {ISLES.map((q) => {
          const p = px(q.x, q.y)
          return (
            <Pop key={q.e} f={f} at={q.at} style={{ position: 'absolute', left: p[0], top: p[1], width: 0, height: 0 }}>
              <div style={{ position: 'absolute', left: 0, top: 0, transform: 'translate(-50%, -50%)', fontSize: Math.max(34, view.k * 2), lineHeight: 1 }}>{q.e}</div>
            </Pop>
          )
        })}
      </div>
      <Pop f={f} at={G_AT[phase] + 6} rot={-1.5} from={30} style={{ position: 'absolute', left: 0, right: 0, top: 708, display: 'flex', justifyContent: 'center' }}>
        <Pill bg={G_SIZE[phase].bg} size={36}>{G_SIZE[phase].t}</Pill>
      </Pop>
      <Pop f={f} at={G_AT[phase] + 16} rot={1.5} from={30} style={{ position: 'absolute', left: 0, right: 0, top: 786, display: 'flex', justifyContent: 'center' }}>
        <Pill bg={C.surface} size={30}>{G_SUB[phase]}</Pill>
      </Pop>
      <Sfx name="pop" at={6} volume={0.4} />
      <Sfx name="whoosh" at={40} volume={0.4} />
      <Sfx name="pop" at={46} volume={0.5} />
      <Sfx name="whoosh" at={88} volume={0.45} />
      <Sfx name="pop" at={94} volume={0.5} />
      <Sfx name="success" at={104} volume={0.4} />
    </>
  )
}

// ---------------------------------------------------------------------------
// 4 — Tout le monde lance en même temps (2 dés, ou le Triple dé), puis les pions avancent tout seuls :
//     l'aiguillage envoie Keke sur La Scène, où il rafle sa première étoile (15 pièces)
// ---------------------------------------------------------------------------
const LEAD = 42
const THROWS: { slug: Slug; dice: number[]; settle: number }[] = [
  { slug: 'kevin', dice: [3, 4, 2], settle: 18 },
  { slug: 'dede', dice: [4, 2], settle: 20 },
  { slug: 'manon', dice: [2, 3], settle: 22 },
  { slug: 'mika', dice: [1, 3], settle: 24 },
]
const Throws: React.FC<{ f: number }> = ({ f }) => {
  const out = easeInOut(ramp(f, LEAD - 7, LEAD + 1))
  if (out >= 1) return null
  return (
    <div style={{ position: 'absolute', left: SX, top: 0, width: SW, height: SH, borderRadius: 34, background: 'rgba(31,27,46,0.55)', zIndex: 500, opacity: 1 - out, transform: `translateY(${-out * 50}px)` }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 36, display: 'flex', justifyContent: 'center' }}>
        <Pop f={f} at={0} rot={-2}><Pill bg={C.sun} size={42}>⚡ Tous en même temps !</Pill></Pop>
      </div>
      {THROWS.map((t, k) => (
        <Pop key={t.slug} f={f} at={2 + k * 2} from={40} style={{ position: 'absolute', left: 30 + (k % 2) * 320, top: 170 + Math.floor(k / 2) * 158 }}>
          <Panel radius={30} shadow={6} style={{ width: 300, height: 122, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px' }}>
            <Avatar slug={t.slug} size={84} outfit={OUTFITS[t.slug]} />
            {t.dice.map((d, j) => <RollDie key={j} f={f} size={t.dice.length > 2 ? 54 : 66} seed={k + j * 3 + 1} settle={t.settle + j * 2} end={d} />)}
          </Panel>
          {k === 0 && <div style={{ position: 'absolute', left: 84, top: -24, transform: 'rotate(-4deg)' }}><Pill bg={C.bubblegum} size={22}>🎲🎲🎲 Triple dé !</Pill></div>}
        </Pop>
      ))}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 508, display: 'flex', justifyContent: 'center' }}>
        <Pop f={f} at={24} rot={1.5}><Pill bg={C.surface} size={28}>🎲 Triple dé : 1 fois par partie !</Pill></Pop>
      </div>
    </div>
  )
}

const P_KEKE = [10, 11, 12, 13, 36, 37, 38, 39, 40, 15]
const FOLLOW: Cam = { tx: -2.2, ty: 0.2, d: 10.6, oy: 0.6 }
const T_FORK = 28
const T_STAR = 54

const StarBuy: MockScene = ({ f: f0 }) => {
  const f = f0 - LEAD
  const idx = f < 36 ? hopIdx(f, 10, 3, 6) : 3 + hopIdx(f, 36, 6, 6)
  const kp = onPath(P_KEKE, idx)
  const bought = f >= T_STAR
  const cam = mixCam(OVERVIEW, FOLLOW, easeInOut(ramp(f, 0, 14)) * (1 - easeInOut(ramp(f, 100, 118))))
  const P = mkProj(cam, SW, SH)
  const grab = easeInOut(ramp(f, T_STAR, T_STAR + 12))
  const s38 = at(38)
  const stars: Star[] = [
    at(33),
    bought ? { X: lerp(s38.X, kp.X, grab), Y: lerp(s38.Y, kp.Y, grab) - 0.01, z: lerp(1.05, 1.9, grab), k: 1 - ramp(f, T_STAR + 10, T_STAR + 20) } : s38,
    ...(f >= 120 ? [{ ...at(11), k: Math.max(0, sp(f, 120)) }] : []),
  ]
  const pawns: Pawn[] = [
    { slug: 'manon', ...at(6) },
    { slug: 'mika', ...at(29), expr: 'boude' },
    { slug: 'dede', ...at(22) },
    { slug: 'kevin', ...kp, mover: true, expr: bought ? 'joie' : 'cool' },
  ]
  const fl = P(s38.X, s38.Y, 1)
  const flash = ramp(f, T_STAR, T_STAR + 14)
  const n7 = P(...W2(11), 1)
  const pop7 = ramp(f, 120, 134)
  return (
    <>
      <Stage3D f={f} w={SW} h={SH} cam={cam} pawns={pawns} stars={stars} sw={[1 - easeInOut(ramp(f, 42, 52)), 0]} lit={P_KEKE[Math.round(idx)]} tags={1} host={bought ? 'surprise' : 'joie'} style={{ position: 'absolute', left: SX, top: 0 }}>
        <TurnBanner f={f} from={0} slug="kevin" name="Keke" dice={[3, 4, 2]} />
        <Event f={f} from={T_FORK} to={T_STAR + 2} bg={C.sun}>🔀 Aiguillage : 🎭 La Scène !</Event>
        <Event f={f} from={T_STAR + 2} to={120} bg={C.sun}>⭐ Étoile achetée (15 🪙) !</Event>
        {flash > 0 && flash < 1 && (
          <div style={{ position: 'absolute', left: fl.x - 5 - 130, top: fl.y - 5 - 130, width: 260, height: 260, borderRadius: '50%', background: '#ffffff', border: `6px solid ${C.sun}`, boxSizing: 'border-box', opacity: 0.85 * (1 - flash), transform: `scale(${0.3 + flash})`, zIndex: 390 }} />
        )}
        {pop7 > 0 && pop7 < 1 && (
          <div style={{ position: 'absolute', left: n7.x - 5 - 90, top: n7.y - 5 - 90, width: 180, height: 180, borderRadius: '50%', background: '#ffffff', border: `6px solid ${C.sun}`, boxSizing: 'border-box', opacity: 0.85 * (1 - pop7), transform: `scale(${0.3 + pop7})`, zIndex: 390 }} />
        )}
        <Pop f={f} at={4} from={40} style={{ position: 'absolute', right: 12, bottom: 12, zIndex: 400 }}>
          <Panel bg={C.surface} radius={24} shadow={5} style={{ height: 76, display: 'flex', alignItems: 'center', gap: 10, padding: '0 18px 0 8px', border: `4px solid ${INK}` }}>
            <Avatar slug="kevin" expression={bought ? 'joie' : 'cool'} size={56} outfit="host" />
            <div style={{ fontSize: 38, lineHeight: 1, paddingTop: 6, whiteSpace: 'nowrap', transform: `scale(${1 + 0.2 * Math.sin(ramp(f, T_STAR + 8, T_STAR + 20) * Math.PI)})` }}>
              ⭐ {f >= T_STAR + 8 ? 1 : 0} · 🪙 {f >= T_STAR + 8 ? 6 : 21}
            </div>
          </Panel>
        </Pop>
      </Stage3D>
      <DedeSays f={f} from={T_FORK + 2} to={T_STAR + 8} expr="joie">L’aiguillage envoie Keke<br />sur La Scène !</DedeSays>
      <DedeSays f={f} from={T_STAR + 8} to={999} expr="surprise">UNE ÉTOILE POUR Keke !<br />Le public est debout !</DedeSays>
      <Note f={f} from={2} to={T_STAR + 4} bg={C.sun}>🔀 La flèche décide… puis bascule !</Note>
      <Note f={f} from={T_STAR + 4} to={120} bg={C.mint}>⭐ 30 🪙 l’étoile, la 1re à 15 !</Note>
      <Note f={f} from={120} to={999} bg={C.sky}>✨ Puis l’étoile déménage !</Note>
      <Throws f={f0} />
      <Sfx name="whoosh" at={2} volume={0.3} />
      {THROWS.map((t, k) => <Sfx key={k} name="tap" at={t.settle + 8} volume={0.45} />)}
      <Sfx name="pop" at={34} volume={0.45} />
      <Sfx name="tap" at={LEAD + 16} volume={0.4} />
      <Sfx name="tap" at={LEAD + 22} volume={0.4} />
      <Sfx name="pop" at={LEAD + T_FORK} volume={0.5} />
      <Sfx name="whoosh" at={LEAD + 42} volume={0.3} />
      <Sfx name="tap" at={LEAD + 42} volume={0.4} />
      <Sfx name="tap" at={LEAD + 48} volume={0.4} />
      <Sfx name="success" at={LEAD + T_STAR} volume={0.55} />
      <Sfx name="pop" at={LEAD + T_STAR + 8} volume={0.5} />
      <Sfx name="tap" at={LEAD + 66} volume={0.35} />
      <Sfx name="whoosh" at={LEAD + 118} volume={0.4} />
      <Sfx name="pop" at={LEAD + 122} volume={0.5} />
    </>
  )
}

// ---------------------------------------------------------------------------
// 5 — Un mini-jeu à chaque tour : les 6 mini-jeux en revue (noms, couleurs et règles de minigames/index.ts), puis le podium
// ---------------------------------------------------------------------------
const MSLIDE = 44
const BTN: React.CSSProperties = { position: 'absolute', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', border: `4px solid ${INK}` }

const MQuiz: React.FC<{ g: number }> = ({ g }) => (
  <Slide g={g} e="❓" name="Questions pour un Dédé" bg="#DFF4FF" note="⚡ 3 questions : réponds vite !" noteBg="#4CC9F0">
    <Panel radius={24} shadow={5} style={{ ...BTN, left: 36, top: 26, width: 560, height: 96, fontSize: 38 }}>Capitale de l’Italie ?</Panel>
    {['Milan', 'Rome', 'Naples', 'Venise'].map((t, i) => {
      const hit = i === 1 && g >= 24
      return <Panel key={t} bg={hit ? C.mint : C.surface} radius={22} shadow={hit ? 2 : 5} style={{ ...BTN, left: 36 + (i % 2) * 290, top: 158 + Math.floor(i / 2) * 116, width: 270, height: 92, fontSize: 38 }}>{hit ? '✅ ' : ''}{t}</Panel>
    })}
    <Finger f={g} taps={[{ at: 22, x: 540, y: 232 }]} />
    <Sx name="tap" at={22} volume={0.5} />
    <Sx name="success" at={25} volume={0.35} />
  </Slide>
)

const GUESS: { slug: Slug; n: string }[] = [{ slug: 'manon', n: '800' }, { slug: 'kevin', n: '1 500' }, { slug: 'mika', n: '3 000' }]
const MPif: React.FC<{ g: number }> = ({ g }) => (
  <Slide g={g} e="🎯" name="Au pif" bg="#FFE9D2" note="🎯 Le plus proche gagne !" noteBg="#FFB570">
    <Panel radius={24} shadow={5} style={{ ...BTN, left: 36, top: 22, width: 560, height: 100, fontSize: 30, lineHeight: 1.08, padding: '6px 14px 0' }}>{nb('Combien de marches à la tour Eiffel ?')}</Panel>
    {GUESS.map((q, i) => {
      const win = i === 1 && g >= 26
      return (
        <Pop key={q.slug} f={g} at={6 + i * 4} from={30} style={{ position: 'absolute', left: 36 + i * 195, top: 146 }}>
          <Panel bg={win ? C.sun : C.surface} radius={24} shadow={5} style={{ width: 170, height: 158, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, border: `4px solid ${INK}`, transform: `scale(${win ? 1.08 + 0.08 * Math.sin(ramp(g, 26, 36) * Math.PI) : 1})` }}>
            <Avatar slug={q.slug} size={76} outfit={OUTFITS[q.slug]} />
            <div style={{ fontSize: 38, lineHeight: 1 }}>{win ? '🥇 ' : ''}{q.n}</div>
          </Panel>
        </Pop>
      )
    })}
    <Tag f={g} from={22} p={[316, 362]} bg={C.mint}>✅ Réponse : 1 665 marches</Tag>
    <Sx name="pop" at={22} volume={0.5} />
    <Sx name="success" at={26} volume={0.35} />
  </Slide>
)

const VOTED: { slug: Slug; name: string; at: number[] }[] = [
  { slug: 'kevin', name: 'Keke', at: [] },
  { slug: 'dede', name: 'Dédé', at: [15] },
  { slug: 'mika', name: 'Mika', at: [11, 19, 24] },
  { slug: 'manon', name: 'Manon', at: [] },
]
const MMajo: React.FC<{ g: number }> = ({ g }) => (
  <Slide g={g} e="🫵" name="Comme tout le monde" bg="#FFE1E8" note="🫵 Vote comme la majorité !" noteBg="#FF8FA3">
    <Panel radius={24} shadow={5} style={{ ...BTN, left: 36, top: 22, width: 560, height: 92, fontSize: 36 }}>Qui est le plus gourmand ?</Panel>
    {VOTED.map((v, i) => {
      const n = v.at.filter((t) => g >= t).length
      const win = i === 2 && g >= 28
      return (
        <Panel key={v.slug} bg={win ? C.sun : C.surface} radius={24} shadow={5} style={{ position: 'absolute', left: 30 + i * 146, top: 140, width: 134, height: 196, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, border: `4px solid ${INK}`, transform: `scale(${1 + 0.12 * Math.max(0, ...v.at.map((t) => 1 - Math.abs(g - t - 3) / 4))})` }}>
          <Avatar slug={v.slug} expression={win ? 'surprise' : 'joie'} size={84} outfit={OUTFITS[v.slug]} />
          <div style={{ fontSize: 27, lineHeight: 1 }}>{v.name}</div>
          <div style={{ fontSize: 30, lineHeight: 1, opacity: n ? 1 : 0.25 }}>🫵 × {n}</div>
        </Panel>
      )
    })}
    <Tag f={g} from={28} p={[316, 380]} bg={C.mint}>La majorité a dit : Mika !</Tag>
    {[11, 15, 19, 24].map((t) => <Sx key={t} name="tap" at={t} volume={0.4} />)}
    <Sx name="pop" at={28} volume={0.5} />
  </Slide>
)

const MBuzz: React.FC<{ g: number }> = ({ g }) => {
  const green = g >= 18
  return (
    <Slide g={g} e="🚨" name="Le Buzzer" bg={green ? C.mint : C.tomato} note="🚨 Au vert, tape le plus vite !" noteBg="#EF476F">
      <div style={{ position: 'absolute', left: 0, right: 0, top: green ? 60 : 130, textAlign: 'center', fontSize: green ? 104 : 60, lineHeight: 1.05, color: green ? INK : '#ffffff', transform: `scale(${green ? 1 + 0.1 * Math.sin(ramp(g, 18, 26) * Math.PI) : 1})` }}>
        {green ? '⚡ TAPE !' : <>✋ Attends<br />le vert…</>}
      </div>
      {g >= 28 && (
        <Pop f={g} at={28} from={40} style={{ position: 'absolute', left: 156, top: 230 }}>
          <Panel radius={26} shadow={6} style={{ width: 320, height: 110, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 64, lineHeight: 1, paddingTop: 8 }}>0,287 s</Panel>
        </Pop>
      )}
      <Finger f={g} taps={[{ at: 25, x: 316, y: 378 }]} />
      <Sx name="pop" at={18} volume={0.5} />
      <Sx name="tap" at={25} volume={0.6} />
      <Sx name="success" at={28} volume={0.35} />
    </Slide>
  )
}

const DROPS: { e: string; x: number; v: number; d: number; hit?: number }[] = [
  { e: '⭐', x: 96, v: 9, d: 0, hit: 17 },
  { e: '🍅', x: 214, v: 7.5, d: 3 },
  { e: '⭐', x: 330, v: 10, d: 8, hit: 28 },
  { e: '⭐', x: 446, v: 7, d: 1 },
  { e: '🍅', x: 548, v: 9, d: 10 },
  { e: '⭐', x: 160, v: 8.5, d: 22 },
  { e: '⭐', x: 500, v: 9.5, d: 26 },
]
const dropY = (d: { v: number; d: number }, g: number) => -40 + (g - d.d) * d.v
const HITS = DROPS.flatMap((d) => (d.hit === undefined ? [] : [{ at: d.hit, x: d.x, y: dropY(d, d.hit) }]))
const MStars: React.FC<{ g: number }> = ({ g }) => (
  <Slide g={g} e="🌠" name="Pluie d’étoiles" bg="#2A2458" note="🌠 Les étoiles, pas les tomates !" noteBg="#B79CFF">
    {DROPS.map((d, i) => {
      const gone = d.hit !== undefined && g >= d.hit
      const pop = gone ? ramp(g, d.hit!, d.hit! + 5) : 0
      if (g < d.d || pop >= 1) return null
      return <Emo key={i} p={[d.x, dropY(d, gone ? d.hit! : g)]} size={66 * (1 + pop * 0.8)} rot={g * 5 + i * 40}><span style={{ opacity: 1 - pop }}>{d.e}</span></Emo>
    })}
    {HITS.map((h) => <Tag key={h.at} f={g} from={h.at + 2} to={h.at + 14} p={[h.x + 74, h.y - 26]} bg={C.sun}>+1</Tag>)}
    <div style={{ position: 'absolute', right: 14, top: 12, zIndex: 9 }}><Pill bg={C.surface} size={32}>⭐ {3 + HITS.filter((h) => g >= h.at).length}</Pill></div>
    <Finger f={g} taps={HITS} />
    {HITS.map((h) => <Sx key={h.at} name="pop" at={h.at} volume={0.5} />)}
  </Slide>
)

const MChrono: React.FC<{ g: number }> = ({ g }) => {
  const txt = g < 14 ? ((Math.max(0, g) * 3) / 14).toFixed(2).replace('.', ',') : g < 28 ? '?,??' : '7,04'
  return (
    <Slide g={g} e="⏱️" name="Top chrono" bg="#DFF9EE" note="⏱️ Stoppe pile à 7,00 s !" noteBg="#06D6A0">
      <div style={{ position: 'absolute', left: 0, right: 0, top: 18, display: 'flex', justifyContent: 'center' }}><Pill bg={C.sun} size={32}>🎯 Objectif : 7,00 s</Pill></div>
      <Panel bg={g >= 28 ? C.sun : C.surface} radius={30} shadow={7} style={{ ...BTN, left: 126, top: 78, width: 380, height: 130, fontSize: 100, lineHeight: 1, paddingTop: 12, transform: `scale(${1 + 0.1 * Math.sin(ramp(g, 28, 36) * Math.PI)})` }}>{txt}</Panel>
      <Panel bg={C.tomato} radius={30} shadow={g >= 28 && g < 34 ? 2 : 7} style={{ ...BTN, left: 176, top: 232, width: 280, height: 88, fontSize: 48, color: '#ffffff', paddingTop: 6 }}>STOP !</Panel>
      <Tag f={g} from={14} to={28} p={[316, 376]}>🙈 Le chrono se cache…</Tag>
      <Tag f={g} from={31} p={[316, 376]} bg={C.mint}>À 4 centièmes près !</Tag>
      <Finger f={g} taps={[{ at: 28, x: 420, y: 296 }]} />
      <Sx name="tap" at={28} volume={0.6} />
      <Sx name="success" at={31} volume={0.35} />
    </Slide>
  )
}

const MINIS: { e: string; c: string; Scene: React.FC<{ g: number }> }[] = [
  { e: '❓', c: '#4CC9F0', Scene: MQuiz },
  { e: '🎯', c: '#FFB570', Scene: MPif },
  { e: '🫵', c: '#FF8FA3', Scene: MMajo },
  { e: '🚨', c: '#EF476F', Scene: MBuzz },
  { e: '🌠', c: '#B79CFF', Scene: MStars },
  { e: '⏱️', c: '#06D6A0', Scene: MChrono },
]
const M_END = MINIS.length * MSLIDE

const PODIUM: { slug: Slug; name: string; medal: string; gain: string; bg: string }[] = [
  { slug: 'kevin', name: 'Keke', medal: '🥇', gain: '+10', bg: C.sun },
  { slug: 'manon', name: 'Manon', medal: '🥈', gain: '+6', bg: C.surface },
  { slug: 'dede', name: 'Dédé', medal: '🥉', gain: '+4', bg: C.surface },
  { slug: 'mika', name: 'Mika', medal: '4', gain: '+2', bg: C.surface },
]

const Mini: MockScene = ({ f }) => {
  const cur = Math.min(MINIS.length - 1, Math.max(0, Math.floor(f / MSLIDE)))
  const Cur = MINIS[cur].Scene
  const end = f >= M_END
  return (
    <>
      {!end && <T0.Provider value={cur * MSLIDE + 8}><Cur g={f - cur * MSLIDE} /></T0.Provider>}
      {!end && MINIS.map((m, i) => {
        const on = i === cur
        return (
          <div key={i} style={{ position: 'absolute', left: 37 + i * 110, top: 676, transform: `scale(${on ? 1 + 0.16 * sp(f, cur * MSLIDE) : 1}) rotate(${on ? wiggle(f, 0, 3, 24) : 0}deg)`, opacity: i > cur ? 0.7 : 1, zIndex: on ? 2 : 1 }}>
            <Panel bg={on ? m.c : i < cur ? C.sunk : C.surface} radius={26} shadow={on ? 7 : 4} style={{ width: 96, height: 96, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 54, lineHeight: 1 }}>{m.e}</Panel>
          </div>
        )
      })}
      {!end && (
        <div style={{ position: 'absolute', left: 0, right: 0, top: 804, display: 'flex', justifyContent: 'center' }}>
          <Pill bg={C.surface} size={30}>Mini-jeu {cur + 1} / 6 : tiré au sort !</Pill>
        </div>
      )}
      {end && (
        <Pop f={f} at={M_END} rot={-2} from={-40} style={{ position: 'absolute', left: 0, right: 0, top: 10, display: 'flex', justifyContent: 'center' }}>
          <Pill bg={C.sun} size={40}>🏅 Et à l’arrivée…</Pill>
        </Pop>
      )}
      {end && PODIUM.map((r, k) => (
        <Pop key={r.slug} f={f} at={M_END + 3 + k * 4} from={50} rot={k % 2 ? 1 : -1} style={{ position: 'absolute', left: 40, top: 110 + k * 132 }}>
          <Panel bg={r.bg} radius={30} shadow={6} style={{ width: 640, height: 114, display: 'flex', alignItems: 'center', gap: 16, padding: '0 28px 0 20px' }}>
            <div style={{ width: 70, textAlign: 'center', fontSize: r.medal === '4' ? 54 : 62, lineHeight: 1 }}>{r.medal}</div>
            <Avatar slug={r.slug} expression={k === 0 ? 'joie' : k === 3 ? 'boude' : 'cool'} size={88} outfit={OUTFITS[r.slug]} />
            <div style={{ flex: 1, fontSize: 44, lineHeight: 1 }}>{r.name}</div>
            <div style={{ fontSize: 52, lineHeight: 1, color: k === 0 ? INK : C.tangerine }}>{r.gain} 🪙</div>
          </Panel>
        </Pop>
      ))}
      {end && (
        <Pop f={f} at={M_END + 22} rot={2} from={30} style={{ position: 'absolute', left: 0, right: 0, top: 660, display: 'flex', justifyContent: 'center' }}>
          <Pill bg={C.bubblegum} size={36}>🔥 Dernier tour : gains doublés !</Pill>
        </Pop>
      )}
      {MINIS.map((_, i) => <Sfx key={i} name="whoosh" at={i * MSLIDE + 8} volume={0.3} />)}
      {PODIUM.map((_, k) => <Sfx key={k} name="pop" at={M_END + 12 + k * 4} volume={0.45} />)}
    </>
  )
}

// ---------------------------------------------------------------------------
// Victoire : étoiles bonus + classement
// ---------------------------------------------------------------------------
const RANK: { slug: Slug; name: string; stars: number; bg: string }[] = [
  { slug: 'kevin', name: 'Keke', stars: 4, bg: C.sun },
  { slug: 'manon', name: 'Manon', stars: 3, bg: C.surface },
  { slug: 'mika', name: 'Mika', stars: 2, bg: C.surface },
  { slug: 'dede', name: 'Dédé', stars: 2, bg: C.surface },
]
const Board: React.FC<{ f: number }> = ({ f }) => (
  <>
    <Pop f={f} at={14} from={-60} rot={-2} style={{ position: 'absolute', left: 0, right: 0, top: 0, display: 'flex', justifyContent: 'center' }}>
      <Pill bg={C.sun} size={32}>👑 ⭐ Roi des mini-jeux : Keke</Pill>
    </Pop>
    <Pop f={f} at={26} from={-60} rot={2} style={{ position: 'absolute', left: 0, right: 0, top: 68, display: 'flex', justifyContent: 'center' }}>
      <Pill bg={C.sun} size={32}>📺 ⭐ Prix de la poisse : Mika</Pill>
    </Pop>
    {RANK.map((r, i) => (
      <Pop key={r.slug} f={f} at={40 + i * 5} from={40} style={{ position: 'absolute', left: 20 + i * 170, top: 146, width: 162 }}>
        <Panel bg={r.bg} radius={24} shadow={6} style={{ height: 100, display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px 0 8px' }}>
          <Avatar slug={r.slug} expression={i === 0 ? 'joie' : 'cool'} size={58} outfit={OUTFITS[r.slug]} />
          <div style={{ flex: 1, lineHeight: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 24 }}>{r.name}</div>
            <div style={{ fontSize: 34, marginTop: 4, whiteSpace: 'nowrap' }}>⭐ {r.stars}</div>
          </div>
        </Panel>
      </Pop>
    ))}
    <Sfx name="pop" at={14} volume={0.5} />
    <Sfx name="pop" at={26} volume={0.5} />
    <Sfx name="pop" at={42} volume={0.4} />
  </>
)

export const dedeParty: TutoSpec = {
  id: 'dede-party',
  name: 'Dédé Party',
  emoji: '🎤',
  color: '#FFB703',
  players: '2 à 8 joueurs',
  goal: 'Décroche le plus d’étoiles dans le jeu télé de Dédé !',
  cast: ['kevin', 'dede', 'manon', 'mika'],
  outfits: OUTFITS,
  steps: [
    { text: 'Choisis ton plateau… ou laisse faire le hasard !', seconds: 4, Mock: Pick },
    { text: '5 plateaux, 5 ambiances : à chacun sa surprise !', seconds: 8, Mock: Tour },
    { text: 'Plus on est nombreux, plus le plateau est grand !', seconds: 4.8, Mock: Grow },
    { text: 'Tous lancent en même temps… passe sur l’étoile : elle est à toi !', seconds: 6.6, Mock: StarBuy },
    { text: '6 mini-jeux, un à chaque tour : le 1er rafle 10 pièces !', seconds: 10.7, Mock: Mini },
  ],
  win: {
    text: 'Le plus d’étoiles gagne !',
    sub: 'En 6, 9 ou 12 tours. À la fin, 2 étoiles bonus surprise !',
    winners: ['kevin'],
    Board,
  },
}
