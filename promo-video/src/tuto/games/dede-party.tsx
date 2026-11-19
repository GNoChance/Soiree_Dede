// Tuto « Dédé Party » : le Grand Plateau de 47 cases (cases, couleurs et tracé de src/games/dede-party/board.ts)
// en fausse 3D (projection en perspective maison, vue du téléphone : caméra tournée d'un quart de tour).
// Keke et Dédé portent la tenue Animateur Télé (`host`) ; Manon et Mika restent en tenue par défaut.
import React from 'react'
import { C, DISPLAY, sticker, type Slug } from '../../theme'
import { Avatar, Bubble, Chibi, Finger, Panel, Pill, Pop, Sfx, bob, bySlug, clamp01, easeInOut, lerp, ramp, sp, wiggle } from '../kit'
import { Fly, Phone, Btn } from '../parts'
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
// 1 — Tout le monde lance ses 2 dés en même temps (et le Triple dé, une fois par partie)
// ---------------------------------------------------------------------------
const OTHERS: { slug: Slug; x: number; dice: [number, number]; settle: number }[] = [
  { slug: 'dede', x: 8, dice: [4, 2], settle: 42 },
  { slug: 'manon', x: 247, dice: [2, 3], settle: 48 },
  { slug: 'mika', x: 486, dice: [1, 3], settle: 54 },
]
const PHONE_CAM: Cam = { tx: 0, ty: 0, d: 17.5, oy: 0.52 }
const START_PAWNS: Pawn[] = [
  { slug: 'kevin', ...at(10), expr: 'cool' },
  { slug: 'manon', ...at(1), expr: 'cool' },
  { slug: 'mika', ...at(25), expr: 'cool' },
  { slug: 'dede', ...at(16), expr: 'cool' },
]
const STARS0: Star[] = [at(38), at(33)]

const Roll: MockScene = ({ f }) => {
  const rolled = f >= 70
  const pressed = f >= 62 && f < 72
  const tilt = wiggle(f, 0, 3, 24)
  return (
    <>
      {OTHERS.map((o, k) => (
        <Pop key={o.slug} f={f} at={4 + k * 4} from={-40} style={{ position: 'absolute', left: o.x, top: 8, display: 'flex', alignItems: 'center', gap: 7 }}>
          <Avatar slug={o.slug} expression="joie" size={94} outfit={OUTFITS[o.slug]} />
          <RollDie f={f} size={58} seed={k + 1} settle={o.settle} end={o.dice[0]} />
          <RollDie f={f} size={58} seed={k + 4} settle={o.settle + 3} end={o.dice[1]} />
        </Pop>
      ))}
      <Pop f={f} at={0} from={120} style={{ position: 'absolute', left: 130, top: 126 }}>
        <Phone w={460} h={660}>
          <div style={{ position: 'absolute', left: 0, right: 0, top: 16, textAlign: 'center', fontFamily: DISPLAY, fontWeight: 800, fontSize: 29, lineHeight: 1.1, color: INK }}>
            Tour 3 / 9 : lance tes dés !
          </div>
          <Stage3D f={f} w={396} h={376} cam={PHONE_CAM} pawns={START_PAWNS} stars={STARS0} sw={[1, 0]} tags={0} style={{ position: 'absolute', left: 11, top: 58 }}>
            {!rolled ? (
              <div style={{ position: 'absolute', left: 30, top: 262, transform: `rotate(${tilt}deg)`, zIndex: 400 }}>
                <Btn bg={C.sun} w={326} h={92} size={38} style={{ gap: 10, padding: '0 10px', whiteSpace: 'nowrap' }}>
                  <Die v={5} size={58} />
                  <Die v={3} size={58} />
                  <div style={{ paddingTop: 6 }}>Lancer !</div>
                </Btn>
              </div>
            ) : (
              <Pop f={f} at={70} style={{ position: 'absolute', left: 9, top: 262, zIndex: 400 }}>
                <Panel bg={C.surface} radius={26} shadow={6} style={{ width: 368, height: 92, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <RollDie f={f - 70} size={58} seed={1} settle={14} end={3} />
                  <RollDie f={f - 70} size={58} seed={3} settle={19} end={4} />
                  <RollDie f={f - 70} size={58} seed={5} settle={24} end={2} />
                  {f >= 96 && <Pop f={f} at={96}><div style={{ fontSize: 31, lineHeight: 1, paddingTop: 6, whiteSpace: 'nowrap', color: C.tangerine }}>= 9 cases !</div></Pop>}
                </Panel>
              </Pop>
            )}
          </Stage3D>
          <div style={{ position: 'absolute', left: 30, top: 448 }}>
            <Btn bg={rolled ? C.sunk : C.surface} w={358} h={80} pressed={pressed} size={32}>{rolled ? 'Triple dé utilisé' : '🎲🎲🎲 Triple dé (1)'}</Btn>
          </div>
          <div style={{ position: 'absolute', left: 16, right: 16, top: 546, textAlign: 'center', fontFamily: DISPLAY, fontWeight: 800, fontSize: 20, lineHeight: 1.15, color: C.muted }}>
            Le Triple dé ajoute un troisième dé :<br />une fois par partie !
          </div>
        </Phone>
      </Pop>
      <Pop f={f} at={8} from={100} style={{ position: 'absolute', left: 0, top: 640 }}>
        <Chibi slug="kevin" expression={f >= 96 ? 'joie' : 'cool'} size={150} outfit="host" style={{ transform: `translateY(${bob(f, 0, 8, 30)}px)` }} />
      </Pop>
      {f >= 70 ? (
        <Pop f={f} at={74} rot={2} style={{ position: 'absolute', left: 0, right: 0, top: 806, display: 'flex', justifyContent: 'center' }}>
          <Pill bg={C.bubblegum} size={36}>🎲🎲🎲 Triple dé : 1 fois par partie !</Pill>
        </Pop>
      ) : (
        <Pop f={f} at={22} rot={-2} style={{ position: 'absolute', left: 0, right: 0, top: 806, display: 'flex', justifyContent: 'center' }}>
          <Pill bg={C.sun} size={38}>⚡ Tous en même temps !</Pill>
        </Pop>
      )}
      <Finger f={f} taps={[{ at: 62, x: 360, y: 636 }]} />
      <Sfx name="whoosh" at={6} volume={0.3} />
      <Sfx name="tap" at={42} volume={0.4} />
      <Sfx name="tap" at={48} volume={0.4} />
      <Sfx name="tap" at={54} volume={0.4} />
      <Sfx name="tap" at={62} volume={0.6} />
      <Sfx name="tap" at={90} volume={0.4} />
      <Sfx name="pop" at={96} volume={0.5} />
      <Sfx name="success" at={102} volume={0.4} />
    </>
  )
}

// ---------------------------------------------------------------------------
// 2 — Les pions avancent tout seuls : à chaque case son effet
// ---------------------------------------------------------------------------
const P_MANON = [1, 2, 3, 4, 5, 6]
const P_MIKA = [25, 26, 27, 28, 29]
const P_DEDE = [16, 17, 18, 19, 20, 21, 22]

const Effects: MockScene = ({ f }) => {
  const im = hopIdx(f, 8, 5, 4)
  const ik = hopIdx(f, 60, 4, 4)
  const id = hopIdx(f, 108, 6, 4)
  const phase = f < 58 ? 'a' : f < 106 ? 'b' : 'c'
  const pawns: Pawn[] = [
    { slug: 'kevin', ...at(10), expr: 'cool' },
    { slug: 'manon', ...onPath(P_MANON, im), mover: phase === 'a', expr: f >= 28 ? 'joie' : 'cool' },
    { slug: 'mika', ...onPath(P_MIKA, ik), mover: phase === 'b', expr: f >= 76 ? 'boude' : 'cool' },
    { slug: 'dede', ...onPath(P_DEDE, id), mover: phase === 'c', expr: f >= 142 ? 'joie' : 'cool' },
  ]
  const lit = phase === 'a' ? P_MANON[Math.round(im)] : phase === 'b' ? P_MIKA[Math.round(ik)] : P_DEDE[Math.round(id)]
  const dd = mkProj(OVERVIEW, SW, SH)(...W2(22), 1)
  return (
    <>
      <Stage3D f={f} w={SW} h={SH} cam={OVERVIEW} pawns={pawns} stars={STARS0} sw={[1, 0]} lit={lit} host={phase === 'b' ? 'cool' : phase === 'c' && f < 142 ? 'surprise' : 'joie'} style={{ position: 'absolute', left: SX, top: 0 }}>
        {phase === 'a' && <TurnBanner f={f} from={0} slug="manon" name="Manon" dice={[2, 3]} />}
        {phase === 'b' && <TurnBanner f={f} from={58} slug="mika" name="Mika" dice={[1, 3]} />}
        {phase === 'c' && <TurnBanner f={f} from={106} slug="dede" name="Dédé" dice={[4, 2]} />}
        <Event f={f} from={28} to={58} bg={C.mint}>👏 Bravo : +3 🪙</Event>
        <Event f={f} from={76} to={106} bg={C.tomato} color="#ffffff">📺 Page de pub : −3 🪙</Event>
        {f >= 132 && f < 142 && (
          <Pop f={f} at={132} from={20} style={{ position: 'absolute', left: 0, right: 0, top: 230, textAlign: 'center', zIndex: 400 }}><div style={{ fontSize: 170, lineHeight: 1 }}>✉️</div></Pop>
        )}
        {f >= 142 && (
          <Pop f={f} at={142} rot={-3} from={30} style={{ position: 'absolute', left: 0, right: 0, top: 236, display: 'flex', justifyContent: 'center', zIndex: 400 }}>
            <Panel bg={C.surface} radius={26} shadow={7} style={{ width: 400, padding: '14px 12px 12px', textAlign: 'center', lineHeight: 1.1 }}>
              <div style={{ fontSize: 28, color: C.muted }}>✉️ Carte surprise</div>
              <div style={{ fontSize: 40, marginTop: 4 }}>Cachet de star :</div>
              <div style={{ fontSize: 54, color: C.tangerine }}>+8 pièces !</div>
            </Panel>
          </Pop>
        )}
        <div style={{ position: 'absolute', left: -5, top: -5, zIndex: 500 }}>
          {[0, 1, 2].map((k) => (
            <Fly key={k} f={f} at={150 + k * 4} len={12} from={[340, 370]} to={[dd.x, dd.y]} arc={60} size={50}>🪙</Fly>
          ))}
        </div>
      </Stage3D>
      <DedeSays f={f} from={30} to={58} expr="joie">Le public adore Manon !<br />Trois pièces !</DedeSays>
      <DedeSays f={f} from={78} to={106} expr="cool">Coupure publicitaire !<br />Mika paie l’addition.</DedeSays>
      <DedeSays f={f} from={144} to={999} expr="joie">Oh, la belle carte<br />pour Dédé !</DedeSays>
      <Note f={f} from={4} to={999} bg={C.sun}>👏 +3 · 📺 −3 · ✉️ carte surprise</Note>
      <Sfx name="tap" at={12} volume={0.4} />
      <Sfx name="tap" at={20} volume={0.4} />
      <Sfx name="pop" at={28} volume={0.5} />
      <Sfx name="tap" at={64} volume={0.4} />
      <Sfx name="tap" at={72} volume={0.4} />
      <Sfx name="pop" at={76} volume={0.5} />
      <Sfx name="tap" at={112} volume={0.4} />
      <Sfx name="tap" at={120} volume={0.4} />
      <Sfx name="tap" at={128} volume={0.4} />
      <Sfx name="pop" at={132} volume={0.5} />
      <Sfx name="success" at={142} volume={0.45} />
      <Sfx name="swoosh-up" at={150} volume={0.35} />
    </>
  )
}

// ---------------------------------------------------------------------------
// 3 — L'aiguillage envoie Keke sur La Scène, où il rafle sa première étoile (15 pièces)
// ---------------------------------------------------------------------------
const P_KEKE = [10, 11, 12, 13, 36, 37, 38, 39, 40, 15]
const FOLLOW: Cam = { tx: -2.2, ty: 0.2, d: 10.6, oy: 0.6 }
const T_FORK = 28
const T_STAR = 54

const StarBuy: MockScene = ({ f }) => {
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
      <Sfx name="tap" at={16} volume={0.4} />
      <Sfx name="tap" at={22} volume={0.4} />
      <Sfx name="pop" at={T_FORK} volume={0.5} />
      <Sfx name="whoosh" at={42} volume={0.3} />
      <Sfx name="tap" at={42} volume={0.4} />
      <Sfx name="tap" at={48} volume={0.4} />
      <Sfx name="success" at={T_STAR} volume={0.55} />
      <Sfx name="pop" at={T_STAR + 8} volume={0.5} />
      <Sfx name="tap" at={66} volume={0.35} />
      <Sfx name="whoosh" at={118} volume={0.4} />
      <Sfx name="pop" at={122} volume={0.5} />
    </>
  )
}

// ---------------------------------------------------------------------------
// 4 — Un mini-jeu à chaque tour : le Buzzer
// ---------------------------------------------------------------------------
const ROULETTE: { e: string; name: string; c: string }[] = [
  { e: '❓', name: 'Questions pour un Dédé', c: '#4CC9F0' },
  { e: '🎯', name: 'Au pif', c: '#FFB570' },
  { e: '🫵', name: 'Comme tout le monde', c: '#FF8FA3' },
  { e: '🌠', name: 'Pluie d’étoiles', c: '#8B5CF6' },
  { e: '⏱️', name: 'Top chrono', c: '#06D6A0' },
  { e: '🚨', name: 'Le Buzzer', c: '#EF476F' },
]
const ROULETTE_AT = [4, 9, 15, 22, 30, 39]

const PODIUM: { slug: Slug; name: string; medal: string; gain: string; bg: string }[] = [
  { slug: 'kevin', name: 'Keke', medal: '🥇', gain: '+10', bg: C.sun },
  { slug: 'manon', name: 'Manon', medal: '🥈', gain: '+6', bg: C.surface },
  { slug: 'dede', name: 'Dédé', medal: '🥉', gain: '+4', bg: C.surface },
  { slug: 'mika', name: 'Mika', medal: '4', gain: '+2', bg: C.surface },
]

const Mini: MockScene = ({ f }) => {
  let j = -1
  ROULETTE_AT.forEach((t, k) => { if (f >= t) j = k })
  const card = ROULETTE[Math.max(0, j)]
  const last = j === 5
  const lockP = sp(f, 39)
  const green = f >= 70
  const showPhone = f >= 46 && f < 112
  const ph = sp(f, 46)
  return (
    <>
      <Pop f={f} at={0} rot={-2} from={-40} style={{ position: 'absolute', left: 0, right: 0, top: 0, display: 'flex', justifyContent: 'center' }}>
        <Pill bg={C.sun} size={34}>Mini-jeu n°3</Pill>
      </Pop>
      {f >= 4 && (
        <div style={{ position: 'absolute', left: 60, top: 70, width: 600, transform: last ? `scale(${0.9 + 0.1 * lockP})` : undefined }}>
          <Panel bg={card.c} radius={34} shadow={8} style={{ height: 130, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 18, padding: '0 16px', fontSize: last ? 54 : 40, lineHeight: 1.05, textAlign: 'center' }}>
            <span style={{ fontSize: 70 }}>{card.e}</span>
            <span>{card.name}</span>
          </Panel>
        </div>
      )}
      {showPhone && (
        <div style={{ position: 'absolute', left: 190, top: 240, transform: `scale(${Math.max(0, ph)})`, transformOrigin: '50% 50%', opacity: 1 - ramp(f, 104, 112) }}>
          <Phone w={340} h={540} bg={green ? C.mint : C.tomato}>
            <div style={{ position: 'absolute', left: 12, right: 12, top: 150, textAlign: 'center', fontFamily: DISPLAY, fontWeight: 800, color: green ? INK : '#ffffff', fontSize: green ? 84 : 46, lineHeight: 1.05 }}>
              {green ? '⚡ TAPE !' : '✋ Attends le vert…'}
            </div>
            {f >= 88 && (
              <Pop f={f} at={88} from={40} style={{ position: 'absolute', left: 20, right: 20, top: 330 }}>
                <Panel bg={C.surface} radius={24} shadow={5} style={{ textAlign: 'center', fontSize: 58, padding: '10px 0 4px', lineHeight: 1.1 }}>0,287 s</Panel>
              </Pop>
            )}
          </Phone>
        </div>
      )}
      {f >= 46 && f < 112 && <Finger f={f} taps={[{ at: 84, x: 360, y: 640 }]} />}
      {PODIUM.map((r, k) => (
        <Pop key={r.slug} f={f} at={114 + k * 6} from={50} rot={k % 2 ? 1 : -1} style={{ position: 'absolute', left: 40, top: 230 + k * 124 }}>
          <Panel bg={r.bg} radius={30} shadow={6} style={{ width: 640, height: 108, display: 'flex', alignItems: 'center', gap: 16, padding: '0 28px 0 20px' }}>
            <div style={{ width: 70, textAlign: 'center', fontSize: r.medal === '4' ? 54 : 62, lineHeight: 1 }}>{r.medal}</div>
            <Avatar slug={r.slug} expression={k === 0 ? 'joie' : k === 3 ? 'boude' : 'cool'} size={84} outfit={OUTFITS[r.slug]} />
            <div style={{ flex: 1, fontSize: 42, lineHeight: 1 }}>{r.name}</div>
            <div style={{ fontSize: 50, lineHeight: 1, color: C.tangerine }}>{r.gain} 🪙</div>
          </Panel>
        </Pop>
      ))}
      <Pop f={f} at={22} rot={2} from={30} style={{ position: 'absolute', left: 0, right: 0, top: 802, display: 'flex', justifyContent: 'center' }}>
        <Pill bg={C.bubblegum} size={36}>🎮 6 mini-jeux différents !</Pill>
      </Pop>
      {ROULETTE_AT.map((t) => <Sfx key={t} name="tap" at={t} volume={0.3} />)}
      <Sfx name="pop" at={39} volume={0.55} />
      <Sfx name="whoosh" at={46} volume={0.3} />
      <Sfx name="pop" at={70} volume={0.5} />
      <Sfx name="tap" at={84} volume={0.6} />
      <Sfx name="success" at={90} volume={0.4} />
      {PODIUM.map((_, k) => <Sfx key={k} name="pop" at={116 + k * 6} volume={0.45} />)}
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
    { text: 'Tout le monde lance ses 2 dés en même temps !', seconds: 5.4, Mock: Roll },
    { text: 'Les pions avancent tout seuls : à chaque case son effet', seconds: 6, Mock: Effects },
    { text: 'La flèche t’aiguille… passe sur l’étoile : elle est à toi !', seconds: 5.4, Mock: StarBuy },
    { text: 'Un mini-jeu à chaque tour : le 1er rafle 10 pièces !', seconds: 5.6, Mock: Mini },
  ],
  win: {
    text: 'Le plus d’étoiles gagne !',
    sub: 'En 6, 9 ou 12 tours. À la fin, 2 étoiles bonus surprise !',
    winners: ['kevin'],
    Board,
  },
}
