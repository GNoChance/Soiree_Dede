// Tuto « Mini-golf » : maquettes 2D vues de dessus (couleurs et formes de src/games/mini-golf/holes.ts).
// Keke et Dédé portent la tenue Golfeur (`golfer`) ; Manon et Mika restent en tenue par défaut.
import React from 'react'
import { C, type Slug } from '../../theme'
import { Avatar, Chibi, Panel, Pill, Pop, Sfx, bob, easeInOut, lerp, ramp } from '../kit'
import { Phone } from '../parts'
import type { MockScene, TutoSpec } from '../types'

const OUTFITS: Partial<Record<Slug, string>> = { kevin: 'golfer', dede: 'golfer' }
const INK = C.ink

// Écran du téléphone (Phone 560 × 780 posé en (80, 20), liseré 25 px).
const PX = 105
const PY = 45
const SW = 510
const SH = 730
const YC = 372 // ordonnée écran de la ligne z = cz

// Palette claire de scene/Course.ts
const GROUND = '#9ED98A'
const TRACK = '#5BD37A'
const TRACK_STRIPE = '#52C972'
const GREEN = '#86EFA0'
const WOOD = '#C98B55'
const WALL = '#FF6B6B'
const WATER = '#4CC9F0'
const TOMATO = '#ef476f'

const easeOut = (t: number) => 1 - (1 - t) * (1 - t)

// ---------------------------------------------------------------------------
// Géométrie des 4 trous montrés (unités du jeu : x vers la droite, z vers le bas = départ)
// ---------------------------------------------------------------------------
type Rect4 = [number, number, number, number] // x0, x1, z0, z1
type Pt = [number, number]
type Dec =
  | { k: 'tent' | 'stand'; x: number; z: number; c: string; rot?: number }
  | { k: 'tree' | 'lamp' | 'bell'; x: number; z: number }
  | { k: 'flags'; x: number; z: number; to: Pt }
type Geo = {
  floors: { r: Rect4; skin?: 'wood' | 'green' }[]
  ramp?: Rect4
  water?: Rect4
  walls: Pt[]
  decor: Dec[]
  cup: Pt
}
type View = { S: number; cz: number }

const H1: Geo = {
  floors: [{ r: [-0.8, 0.8, -4.3, 4.3] }],
  walls: [[-0.8, 4.3], [-0.8, -4.3], [0.8, -4.3], [0.8, 4.3], [-0.8, 4.3]],
  decor: [
    { k: 'tent', x: -2.1, z: -1.5, c: '#FF5D73' },
    { k: 'tent', x: 2.1, z: 1.2, c: '#4CC9F0', rot: Math.PI },
    { k: 'tree', x: 1.8, z: -3.4 },
    { k: 'tree', x: -1.9, z: 3.2 },
    { k: 'flags', x: -1.6, z: -4.8, to: [1.6, -4.8] },
  ],
  cup: [0, -3.3],
}
const V1: View = { S: 66, cz: 0 }

const H4: Geo = {
  floors: [{ r: [-1.2, 1.2, 1.2, 4.6] }, { r: [-0.35, 0.35, -1.25, 1.25], skin: 'wood' }, { r: [-1.2, 1.2, -4.6, -1.2] }],
  water: [-1.2, 1.2, -1.2, 1.2],
  walls: [[-1.2, 4.6], [-1.2, -4.6], [1.2, -4.6], [1.2, 4.6], [-1.2, 4.6]],
  decor: [
    { k: 'tree', x: -2.0, z: 0.4 },
    { k: 'tree', x: 2.0, z: -0.6 },
    { k: 'stand', x: 2.2, z: 3.2, c: '#4CC9F0', rot: Math.PI },
    { k: 'flags', x: -1.8, z: -5.1, to: [1.8, -5.1] },
  ],
  cup: [-0.5, -3.5],
}
const V4: View = { S: 62, cz: 0 }

const H5: Geo = {
  floors: [{ r: [-1.1, 1.1, -4.8, 4.8] }],
  walls: [[-1.1, 4.8], [-1.1, -4.8], [1.1, -4.8], [1.1, 4.8], [-1.1, 4.8]],
  decor: [
    { k: 'tree', x: -2.0, z: 2.6 },
    { k: 'tree', x: 2.1, z: -3.2 },
    { k: 'tent', x: 2.2, z: 2.2, c: '#FFB627', rot: Math.PI },
    { k: 'flags', x: -1.7, z: -5.3, to: [1.7, -5.3] },
  ],
  cup: [0.3, -3.6],
}
const V5: View = { S: 58, cz: 0 }
const HUB: Pt = [0, -0.25] // moyeu des pales

const H9: Geo = {
  floors: [{ r: [-2, 2, 2.6, 4.6] }, { r: [0.4, 2, 0.5, 2.7] }, { r: [-1.2, 2, -4.4, -1.0], skin: 'green' }],
  ramp: [0.4, 2, -1.0, 0.6],
  walls: [[-2, 4.6], [2, 4.6], [2, -4.4], [-1.2, -4.4], [-1.2, -1.0], [0.4, -1.0], [0.4, 2.6], [-2, 2.6], [-2, 4.6]],
  decor: [
    { k: 'tree', x: -1.5, z: 0.8 },
    { k: 'tent', x: -1.0, z: 1.2, c: '#9B5DE5', rot: 0.3 },
    { k: 'lamp', x: 2.6, z: 2.4 },
  ],
  cup: [0, -3.2],
}
const V9: View = { S: 60, cz: 0.1 }

const px = (v: View, x: number) => SW / 2 + x * v.S
const py = (v: View, z: number) => YC + (z - v.cz) * v.S

const DecorSvg: React.FC<{ d: Dec }> = ({ d }) => {
  switch (d.k) {
    case 'tent':
      return (
        <g transform={`translate(${d.x} ${d.z}) rotate(${((d.rot ?? 0) * 180) / Math.PI})`}>
          <rect x={-0.55} y={-0.55} width={1.1} height={1.1} rx={0.08} fill={d.c} stroke={INK} strokeWidth={0.07} />
          <path d="M-0.55 -0.55 L0.55 0.55 M0.55 -0.55 L-0.55 0.55" stroke="#ffffff" strokeWidth={0.06} opacity={0.65} />
          <circle r={0.1} fill={INK} />
        </g>
      )
    case 'stand':
      return (
        <g transform={`translate(${d.x} ${d.z}) rotate(${((d.rot ?? 0) * 180) / Math.PI})`}>
          <rect x={-0.55} y={-0.35} width={1.1} height={0.7} rx={0.06} fill={d.c} stroke={INK} strokeWidth={0.07} />
          <path d="M-0.18 -0.35 L-0.18 0.35 M0.18 -0.35 L0.18 0.35" stroke="#ffffff" strokeWidth={0.07} opacity={0.7} />
        </g>
      )
    case 'tree':
      return (
        <g transform={`translate(${d.x} ${d.z})`}>
          <circle r={0.5} fill="#2FBF5B" stroke={INK} strokeWidth={0.07} />
          <circle cx={-0.1} cy={-0.1} r={0.28} fill="#6FE38C" />
        </g>
      )
    case 'lamp':
      return <circle cx={d.x} cy={d.z} r={0.17} fill="#FFE08A" stroke={INK} strokeWidth={0.06} />
    case 'bell':
      return <circle cx={d.x} cy={d.z} r={0.35} fill={C.sun} stroke={INK} strokeWidth={0.07} />
    case 'flags': {
      const cols = ['#FF5D73', '#4CC9F0', '#FFB627', '#7AE582', '#9B5DE5']
      return (
        <g>
          <line x1={d.x} y1={d.z} x2={d.to[0]} y2={d.to[1]} stroke={INK} strokeWidth={0.05} />
          {Array.from({ length: 7 }, (_, i) => {
            const t = (i + 0.7) / 7.4
            const x = lerp(d.x, d.to[0], t)
            const z = lerp(d.z, d.to[1], t)
            return <path key={i} d={`M${x - 0.17} ${z} L${x + 0.17} ${z} L${x} ${z + 0.34} Z`} fill={cols[i % 5]} stroke={INK} strokeWidth={0.04} strokeLinejoin="round" />
          })}
        </g>
      )
    }
  }
}

const poly = (pts: Pt[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ')

/** Trou vu de dessus (SVG en unités du jeu). */
const HoleSvg: React.FC<{ g: Geo; v: View; f: number; mill?: boolean }> = ({ g, v, f, mill }) => {
  const wx = (f * 0.012) % 0.6
  return (
    <svg width={SW} height={SH} style={{ position: 'absolute', left: 0, top: 0 }}>
      <defs>
        <pattern id="mow" width={1} height={1} patternUnits="userSpaceOnUse">
          <rect width={1} height={0.5} fill={TRACK_STRIPE} />
        </pattern>
        <linearGradient id="rampg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#B6F5C6" />
          <stop offset="1" stopColor="#52C972" />
        </linearGradient>
        <clipPath id="wclip">{g.water && <rect x={g.water[0]} y={g.water[2]} width={g.water[1] - g.water[0]} height={g.water[3] - g.water[2]} />}</clipPath>
      </defs>
      <g transform={`translate(${SW / 2} ${YC}) scale(${v.S}) translate(0 ${-v.cz})`}>
        {g.decor.map((d, i) => <DecorSvg key={i} d={d} />)}
        {g.water && (
          <g>
            <rect x={g.water[0]} y={g.water[2]} width={g.water[1] - g.water[0]} height={g.water[3] - g.water[2]} fill={WATER} />
            <g clipPath="url(#wclip)">
              {[-0.95, -0.5, -0.05, 0.4, 0.85].map((z, i) => (
                <path key={i} d={`M${-1.5 + (i % 2) * 0.3 + wx} ${z} q0.15 -0.14 0.3 0 t0.3 0 t0.3 0 t0.3 0 t0.3 0 t0.3 0 t0.3 0 t0.3 0 t0.3 0 t0.3 0`} fill="none" stroke="#ffffff" strokeWidth={0.05} opacity={0.75} strokeLinecap="round" />
              ))}
            </g>
          </g>
        )}
        {g.floors.map((fl, i) => {
          const [x0, x1, z0, z1] = fl.r
          const fill = fl.skin === 'wood' ? WOOD : fl.skin === 'green' ? GREEN : TRACK
          return (
            <g key={i}>
              <rect x={x0} y={z0} width={x1 - x0} height={z1 - z0} fill={fill} />
              {!fl.skin && <rect x={x0} y={z0} width={x1 - x0} height={z1 - z0} fill="url(#mow)" />}
              {fl.skin === 'wood' &&
                Array.from({ length: Math.round((z1 - z0) / 0.25) }, (_, k) => <line key={k} x1={x0} x2={x1} y1={z0 + (k + 1) * 0.25} y2={z0 + (k + 1) * 0.25} stroke={INK} strokeWidth={0.03} opacity={0.35} />)}
            </g>
          )
        })}
        {g.ramp && (
          <g>
            <rect x={g.ramp[0]} y={g.ramp[2]} width={g.ramp[1] - g.ramp[0]} height={g.ramp[3] - g.ramp[2]} fill="url(#rampg)" />
            {[0.2, 0.8, 1.4].map((o, i) => (
              <path key={i} d={`M${lerp(g.ramp![0], g.ramp![1], 0.5) - 0.3} ${g.ramp![2] + o + 0.25} l0.3 -0.22 l0.3 0.22`} fill="none" stroke="#ffffff" strokeWidth={0.07} strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
            ))}
          </g>
        )}
        {mill && (
          <g>
            <rect x={-0.3} y={-1.4} width={0.6} height={1.0} fill="rgba(31,27,46,0.3)" />
            {[[-1.1, -0.3], [0.3, 1.1]].map(([a, b], i) => (
              <g key={i}>
                <rect x={a} y={-1.4} width={b - a} height={1.0} fill="#FFF4E0" stroke={INK} strokeWidth={0.07} />
                <rect x={a + 0.1} y={-1.3} width={b - a - 0.2} height={0.8} fill="#FF5D73" stroke={INK} strokeWidth={0.05} />
              </g>
            ))}
          </g>
        )}
        <path d={poly(g.walls)} fill="none" stroke={INK} strokeWidth={0.3} strokeLinejoin="round" strokeLinecap="round" />
        <path d={poly(g.walls)} fill="none" stroke={WALL} strokeWidth={0.17} strokeLinejoin="round" strokeLinecap="round" />
        {/* trou + drapeau */}
        <circle cx={g.cup[0]} cy={g.cup[1]} r={0.22} fill={INK} />
        <circle cx={g.cup[0]} cy={g.cup[1]} r={0.15} fill="#0d0b16" />
        <line x1={g.cup[0]} y1={g.cup[1]} x2={g.cup[0]} y2={g.cup[1] - 1.0} stroke={INK} strokeWidth={0.06} />
        <path d={`M${g.cup[0]} ${g.cup[1] - 1.0} L${g.cup[0]} ${g.cup[1] - 0.55} L${g.cup[0] + 0.5} ${g.cup[1] - 0.775} Z`} fill={TOMATO} stroke={INK} strokeWidth={0.05} strokeLinejoin="round" />
      </g>
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Balles, chibis, HUD, bandeaux (UI de Play.tsx)
// ---------------------------------------------------------------------------
type Key = [number, number, number] // frame, x, z
/** Position (x, z) le long d'une liste de clés (linéaire entre clés). */
const track = (f: number, K: Key[]): Pt => {
  if (f <= K[0][0]) return [K[0][1], K[0][2]]
  for (let i = 1; i < K.length; i++) {
    if (f <= K[i][0]) {
      const t = (f - K[i - 1][0]) / (K[i][0] - K[i - 1][0])
      return [lerp(K[i - 1][1], K[i][1], t), lerp(K[i - 1][2], K[i][2], t)]
    }
  }
  const l = K[K.length - 1]
  return [l[1], l[2]]
}

const BR = 11
const Ball: React.FC<{ x: number; y: number; ghost?: boolean; op?: number; s?: number; head?: { slug: Slug; expr?: string } }> = ({ x, y, ghost, op = 1, s = 1, head }) => (
  <>
    <div
      style={{
        position: 'absolute', left: x - BR, top: y - BR, width: BR * 2, height: BR * 2, borderRadius: '50%', boxSizing: 'border-box',
        background: ghost ? 'rgba(255,255,255,0.55)' : '#ffffff', border: `3px solid ${INK}`, opacity: (ghost ? 0.7 : 1) * op,
        boxShadow: ghost ? 'none' : `2px 2px 0 0 ${INK}`, transform: `scale(${s})`, zIndex: 5,
      }}
    />
    {head && (
      <div style={{ position: 'absolute', left: x - 23, top: y - 66, opacity: (ghost ? 0.72 : 1) * op, transform: `scale(${s})`, zIndex: 6 }}>
        <Avatar slug={head.slug} expression={head.expr ?? 'joie'} size={46} outfit={OUTFITS[head.slug]} />
      </div>
    )}
  </>
)

const Hud: React.FC<{ n: number; par: number; name: string; clock: string; red?: boolean; f: number }> = ({ n, par, name, clock, red, f }) => (
  <div style={{ position: 'absolute', left: 12, right: 12, top: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', zIndex: 30 }}>
    <Panel radius={18} shadow={4} style={{ padding: '7px 16px 3px', lineHeight: 1.05 }}>
      <div style={{ fontSize: 25 }}>Trou {n}/9 <span style={{ color: C.muted }}>· par {par}</span></div>
      <div style={{ fontSize: 18, color: C.muted }}>{name}</div>
    </Panel>
    <Panel
      bg={red ? TOMATO : C.surface}
      radius={16}
      shadow={4}
      style={{ padding: '8px 14px 3px', fontSize: 28, lineHeight: 1.1, color: red ? '#ffffff' : INK, transform: red ? `scale(${1 + 0.08 * Math.sin(f * 0.5)})` : undefined }}
    >
      ⏱️ {clock}
    </Panel>
  </div>
)

const Counter: React.FC<{ n: number; pulse?: number }> = ({ n, pulse = 0 }) => (
  <div style={{ position: 'absolute', left: 0, right: 0, bottom: 14, display: 'flex', justifyContent: 'center', zIndex: 30 }}>
    <Panel radius={16} shadow={4} style={{ padding: '6px 22px 1px', fontSize: 38, lineHeight: 1.1, transform: `scale(${1 + 0.25 * Math.sin(pulse * Math.PI)})` }}>
      Coup {n} <span style={{ fontSize: 24, color: C.muted }}>/ 6</span>
    </Panel>
  </div>
)

const Banner: React.FC<{ f: number; at: number; bg: string; color?: string; title: string; sub: string }> = ({ f, at, bg, color = INK, title, sub }) => (
  <Pop f={f} at={at} from={-40} style={{ position: 'absolute', left: 60, right: 60, top: 92, zIndex: 40 }}>
    <Panel bg={bg} radius={26} shadow={7} style={{ textAlign: 'center', color, padding: '12px 10px 8px', lineHeight: 1.05 }}>
      <div style={{ fontSize: 52 }}>{title}</div>
      <div style={{ fontSize: 23, marginTop: 4 }}>{sub}</div>
    </Panel>
  </Pop>
)

/** Téléphone de jeu : l'écran intérieur fait 510 × 730, fond herbe. */
const GolfPhone: React.FC<{ f: number; children: React.ReactNode }> = ({ f, children }) => (
  <Pop f={f} at={0} from={100} style={{ position: 'absolute', left: 80, top: 20 }}>
    <Phone w={560} h={780} bg={GROUND}>{children}</Phone>
  </Pop>
)

const Corner: React.FC<{ f: number; at: number; slug: Slug; expr: string }> = ({ f, at, slug, expr }) => (
  <Pop f={f} at={at} from={120} style={{ position: 'absolute', left: 495, top: 600, zIndex: 30 }}>
    <Chibi slug={slug} expression={expr} size={190} outfit={OUTFITS[slug]} style={{ transform: `translateY(${bob(f, 0, 10, 30)}px)` }} />
  </Pop>
)

const Touch: React.FC<{ x: number; y: number; vis: number; down: boolean; press?: number }> = ({ x, y, vis, down, press = 0 }) => {
  if (vis <= 0) return null
  return (
    <div style={{ position: 'absolute', left: PX + x, top: PY + y, width: 0, height: 0, opacity: vis, zIndex: 60 }}>
      {press > 0 && press < 1 && <div style={{ position: 'absolute', left: -45, top: -45, width: 90, height: 90, borderRadius: '50%', border: `6px solid ${INK}`, boxSizing: 'border-box', transform: `scale(${0.5 + press * 1.3})`, opacity: 1 - press }} />}
      <div style={{ position: 'absolute', left: -32, top: -32, width: 64, height: 64, borderRadius: '50%', background: 'rgba(255,255,255,0.85)', border: `5px solid ${INK}`, boxSizing: 'border-box', boxShadow: `${down ? 1 : 5}px ${down ? 1 : 5}px 0 0 ${INK}`, transform: `scale(${down ? 0.86 : 1})` }} />
      <div style={{ position: 'absolute', left: -22, top: -14, fontSize: 64, lineHeight: 1, transform: `scale(${down ? 0.9 : 1})` }}>👆</div>
    </div>
  )
}

const mixRgb = (t: number) => {
  const a = [6, 214, 160]
  const b = [239, 71, 111]
  return `rgb(${a.map((v, i) => Math.round(lerp(v, b[i], t))).join(',')})`
}

/** Flèche de visée qui part de la balle vers le haut (sens opposé au tirage), longueur L px. */
const AimArrow: React.FC<{ x: number; y: number; L: number }> = ({ x, y, L }) => {
  if (L < 6) return null
  const head = Math.min(38, L * 0.6)
  const col = mixRgb(Math.min(1, L / 200))
  const tip = y - 8 - L
  return (
    <svg width={80} height={L + 40} style={{ position: 'absolute', left: x - 40, top: tip - 4, zIndex: 4, overflow: 'visible' }}>
      <polygon
        points={`${40 - 9},${L + 20} ${40 - 9},${head + 4} ${40 - 24},${head + 4} 40,4 ${40 + 24},${head + 4} ${40 + 9},${head + 4} ${40 + 9},${L + 20}`}
        fill={col}
        stroke={INK}
        strokeWidth={5}
        strokeLinejoin="round"
      />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// 1 — Tous sur le même trou : annonce, balle de Keke et balles fantômes
// ---------------------------------------------------------------------------
const GHOSTS: { slug: Slug; keys: Key[] }[] = [
  { slug: 'manon', keys: [[56, 0.55, 2.2], [90, 0.5, 1.2], [130, 0.45, 0.4], [162, 0.45, 0.1]] },
  { slug: 'mika', keys: [[56, -0.55, 1.2], [100, -0.5, 0.0], [140, -0.45, -0.8], [162, -0.45, -1.0]] },
  { slug: 'dede', keys: [[56, 0, 0.1], [90, 0, -1.2], [130, 0.05, -2.3], [162, 0.05, -2.6]] },
]

const Intro: MockScene = ({ f }) => {
  const annOut = easeInOut(ramp(f, 54, 66))
  const show = ramp(f, 56, 64)
  const clock = f < 120 ? '1:30' : '1:29'
  return (
    <>
      <GolfPhone f={f}>
        <HoleSvg g={H1} v={V1} f={f} />
        {GHOSTS.map((g) => {
          const [x, z] = track(f, g.keys)
          return f >= 56 ? <Ball key={g.slug} ghost op={show} x={px(V1, x)} y={py(V1, z)} head={{ slug: g.slug, expr: g.slug === 'dede' ? 'cool' : 'joie' }} /> : null
        })}
        <Ball x={px(V1, 0)} y={py(V1, 3.4)} head={{ slug: 'kevin' }} />
        <Hud n={1} par={2} name="L’Échauffement" clock={clock} f={f} />
        {f >= 60 && <Counter n={1} />}
        {annOut < 1 && (
          <div style={{ position: 'absolute', left: 45, right: 45, top: 230, zIndex: 50, opacity: 1 - annOut, transform: `scale(${1 - annOut * 0.5})` }}>
            <Pop f={f} at={4} from={-60} rot={-3}>
              <Panel bg={C.sun} radius={26} shadow={8} style={{ textAlign: 'center', padding: '14px 12px 12px', lineHeight: 1.08 }}>
                <div style={{ fontSize: 28 }}>Trou 1</div>
                <div style={{ fontSize: 50 }}>L’Échauffement</div>
                <div style={{ fontSize: 24, marginTop: 4 }}>Tout droit, pour apprendre le geste</div>
                <div style={{ fontSize: 34, marginTop: 6 }}>⛳ par 2</div>
              </Panel>
            </Pop>
          </div>
        )}
      </GolfPhone>
      {f >= 84 && (
        <Pop f={f} at={84} rot={-2} style={{ position: 'absolute', left: 0, right: 0, top: 812, display: 'flex', justifyContent: 'center' }}>
          <Pill bg={C.mint} size={36}>👻 Les balles ne se gênent pas</Pill>
        </Pop>
      )}
      <Sfx name="whoosh" at={0} volume={0.35} />
      <Sfx name="pop" at={6} volume={0.5} />
      <Sfx name="swoosh-up" at={56} volume={0.4} />
      <Sfx name="pop" at={84} volume={0.4} />
    </>
  )
}

// ---------------------------------------------------------------------------
// 2 — Le geste : poser le doigt, tirer en arrière, lâcher
// ---------------------------------------------------------------------------
const P1: Pt = [410, 300]
const P2: Pt = [410, 190]
const Gesture: MockScene = ({ f }) => {
  // doigt (coordonnées écran)
  const d1 = easeInOut(ramp(f, 22, 54))
  const d2 = easeInOut(ramp(f, 108, 118))
  let fx: number
  let fy: number
  let down = false
  let vis = 0
  let press = 0
  if (f < 90) {
    const m = easeInOut(ramp(f, 6, 18))
    fx = lerp(P1[0] + 70, P1[0], m)
    fy = lerp(P1[1] + 90, P1[1], m) + 190 * d1
    down = f >= 18 && f < 62
    vis = ramp(f, 4, 10) * (1 - ramp(f, 62, 72))
    press = f >= 18 && f < 28 ? (f - 18) / 10 : 0
    if (f >= 62) { fx += (f - 62) * 2; fy -= (f - 62) * 2 }
  } else {
    const m = easeInOut(ramp(f, 92, 104))
    fx = lerp(P2[0] + 70, P2[0], m)
    fy = lerp(P2[1] + 90, P2[1], m) + 40 * d2
    down = f >= 104 && f < 122
    vis = ramp(f, 92, 98) * (1 - ramp(f, 122, 132))
    press = f >= 104 && f < 114 ? (f - 104) / 10 : 0
    if (f >= 122) { fx += (f - 122) * 2; fy -= (f - 122) * 2 }
  }
  // balle
  const keys: Key[] = [[0, 0, 3.4], [62, 0, 3.4], [66, 0, 3.1], [80, 0, -1.4], [92, 0, -2.2], [122, 0, -2.2], [127, 0, -2.6], [134, 0, -3.3]]
  const [bx, bz] = track(f, keys)
  const ballX = px(V1, bx)
  const ballY = py(V1, bz)
  const sink = ramp(f, 134, 142)
  const L = f < 62 ? 190 * d1 : f >= 108 && f < 122 ? 40 * d2 : 0
  const strokes = f < 62 ? 1 : 2
  const trailOn = (f >= 22 && f < 62) || (f >= 108 && f < 122)
  const t0 = f < 90 ? P1 : P2
  return (
    <>
      <GolfPhone f={f}>
        <HoleSvg g={H1} v={V1} f={f} />
        {trailOn && (
          <svg width={SW} height={SH} style={{ position: 'absolute', left: 0, top: 0, zIndex: 7 }}>
            <line x1={t0[0]} y1={t0[1]} x2={fx} y2={fy} stroke={INK} strokeWidth={6} strokeDasharray="2 14" strokeLinecap="round" opacity={0.7} />
          </svg>
        )}
        <AimArrow x={ballX} y={ballY} L={L} />
        <Ball x={ballX} y={ballY} s={1 - sink} head={f < 140 ? { slug: 'kevin' } : undefined} />
        <Hud n={1} par={2} name="L’Échauffement" clock="1:27" f={f} />
        {f < 138 && <Counter n={strokes} pulse={f >= 62 && f < 74 ? ramp(f, 62, 74) : 0} />}
        {f >= 138 && <Banner f={f} at={138} bg={C.sun} title="Rentré en 2 !" sub="⚪ 2 coups (par 2)" />}
      </GolfPhone>
      <Touch x={fx} y={fy} vis={vis} down={down} press={press} />
      {f >= 30 && f < 100 && (
        <Pop f={f} at={30} rot={-2} style={{ position: 'absolute', left: 0, right: 0, top: 812, display: 'flex', justifyContent: 'center' }}>
          <Pill bg={C.sun} size={36}>💪 Tire plus = plus fort !</Pill>
        </Pop>
      )}
      {f >= 142 && <Corner f={f} at={142} slug="kevin" expr="joie" />}
      <Sfx name="tap" at={18} volume={0.5} />
      <Sfx name="tap" at={62} volume={0.7} />
      <Sfx name="whoosh" at={64} volume={0.3} />
      <Sfx name="tap" at={104} volume={0.5} />
      <Sfx name="tap" at={122} volume={0.6} />
      <Sfx name="jingle" at={136} volume={0.5} />
      <Sfx name="success" at={138} volume={0.55} />
    </>
  )
}

// ---------------------------------------------------------------------------
// 3 — Moulin (pales) puis Pont du Lavoir (plouf, +1 coup)
// ---------------------------------------------------------------------------
const Blades: React.FC<{ f: number; v: View }> = ({ f, v }) => {
  const a = f * 4.5
  const x = px(v, HUB[0])
  const y = py(v, HUB[1])
  const len = 0.85 * v.S
  const w = 0.15 * v.S
  return (
    <svg width={SW} height={SH} style={{ position: 'absolute', left: 0, top: 0, zIndex: 9 }}>
      <g transform={`translate(${x} ${y}) rotate(${a})`}>
        {[0, 90, 180, 270].map((r) => (
          <g key={r} transform={`rotate(${r})`}>
            <rect x={-w / 2} y={0} width={w} height={len} rx={w / 3} fill="#FFF4E0" stroke={INK} strokeWidth={4} />
            <rect x={-w / 2} y={len * 0.55} width={w} height={len * 0.45} rx={w / 3} fill="#FF5D73" stroke={INK} strokeWidth={4} />
          </g>
        ))}
        <circle r={0.16 * v.S} fill={C.sun} stroke={INK} strokeWidth={4} />
      </g>
    </svg>
  )
}

const MillAndBridge: MockScene = ({ f }) => {
  const swap = easeInOut(ramp(f, 76, 90))
  // --- trou 5 : Keke ---
  const k1: Key[] = [[0, 0, 3.9], [4, 0, 3.9], [20, 0, 0.76], [24, 0, 0.9], [40, 0, 2.5], [42, 0, 2.6]]
  const k2: Key[] = [[42, 0, 2.6], [46, 0, 1.2], [50, 0, -0.25], [58, 0.05, -1.9], [66, 0.18, -3.0], [74, 0.3, -3.6]]
  const [x5, z5] = f < 42 ? track(f, k1) : track(f, k2)
  const sink5 = ramp(f, 74, 82)
  // --- trou 4 : Dédé ---
  const k4: Key[] = [[0, 0.5, 2.1], [102, 0.5, 2.1], [112, 0.3, 1.0], [122, 0.62, 0.25]]
  const [x4, z4] = track(f, k4)
  const fall = ramp(f, 122, 130)
  const respawn = ramp(f, 146, 154)
  const splash = ramp(f, 122, 150)
  const strokes4 = f < 146 ? 2 : 4
  return (
    <>
      <GolfPhone f={f}>
        {swap < 1 && (
          <div style={{ position: 'absolute', inset: 0, opacity: 1 - swap }}>
            <HoleSvg g={H5} v={V5} f={f} mill />
            <Ball x={px(V5, x5)} y={py(V5, z5)} s={1 - sink5} head={{ slug: 'kevin', expr: f >= 24 ? 'boude' : 'joie' }} />
            <Blades f={f} v={V5} />
            <Hud n={5} par={3} name="Le Moulin" clock="1:12" f={f} />
            <Counter n={f < 42 ? 1 : 2} pulse={f >= 40 && f < 52 ? ramp(f, 40, 52) : 0} />
          </div>
        )}
        {swap > 0 && (
          <div style={{ position: 'absolute', inset: 0, opacity: swap }}>
            <HoleSvg g={H4} v={V4} f={f} />
            {f < 126 && <Ball x={px(V4, x4)} y={py(V4, z4)} s={1 - fall} head={{ slug: 'dede', expr: 'reflexion' }} />}
            {f >= 146 && <Ball x={px(V4, 0.5)} y={py(V4, 2.1)} s={respawn} head={{ slug: 'dede', expr: 'surprise' }} />}
            {splash > 0 && splash < 1 && (
              <div style={{ position: 'absolute', left: px(V4, 0.62), top: py(V4, 0.25), zIndex: 6 }}>
                {[0, 0.3].map((o, i) => {
                  const t = Math.max(0, Math.min(1, splash * 1.4 - o))
                  return <div key={i} style={{ position: 'absolute', left: -50 * t, top: -50 * t, width: 100 * t, height: 100 * t, borderRadius: '50%', border: `5px solid #ffffff`, boxSizing: 'border-box', opacity: 1 - t }} />
                })}
                <div style={{ position: 'absolute', left: -30, top: -40 - 40 * Math.sin(splash * Math.PI), fontSize: 56, opacity: 1 - splash }}>💦</div>
              </div>
            )}
            <Hud n={4} par={3} name="Le Pont du Lavoir" clock="1:03" f={f} />
            <Counter n={strokes4} pulse={f >= 146 && f < 160 ? ramp(f, 146, 160) : 0} />
            {f >= 128 && <Banner f={f} at={128} bg={C.sky} title="Plouf !" sub="💦 +1 coup de pénalité" />}
          </div>
        )}
      </GolfPhone>
      {f >= 24 && f < 84 && <Corner f={f} at={24} slug="kevin" expr="boude" />}
      {f >= 126 && <Corner f={f} at={126} slug="dede" expr="surprise" />}
      <Sfx name="tap" at={4} volume={0.5} />
      <Sfx name="tap" at={20} volume={0.6} />
      <Sfx name="tap" at={42} volume={0.5} />
      <Sfx name="success" at={74} volume={0.45} />
      <Sfx name="whoosh" at={78} volume={0.3} />
      <Sfx name="tap" at={100} volume={0.5} />
      <Sfx name="pop" at={122} volume={0.6} />
      <Sfx name="swoosh-up" at={124} volume={0.35} />
      <Sfx name="pop" at={146} volume={0.5} />
    </>
  )
}

// ---------------------------------------------------------------------------
// 4 — Le Clocher : 6 coups, balle ramassée = 7 ; chrono à zéro = 7 aussi
// ---------------------------------------------------------------------------
const Limits: MockScene = ({ f }) => {
  const keys: Key[] = [
    [6, 1.2, 2.2], [20, 1.2, 0.2], [32, 1.2, -1.6], [40, 0.9, -2.5], [48, 0.45, -2.95], [54, 0.27, -3.05], [58, 0.24, -3.0],
    [66, 0.6, -2.5], [78, 1.0, -1.5], [86, 1.2, -0.9], [94, 1.2, 0.4], [102, 1.2, 1.4], [108, 1.2, 1.9],
  ]
  const [bx, bz] = track(f, keys)
  const secs = Math.max(10, 14 - Math.floor(f / 30))
  const red = secs <= 10
  return (
    <>
      <GolfPhone f={f}>
        <HoleSvg g={H9} v={V9} f={f} />
        <Ball x={px(V9, bx)} y={py(V9, bz)} head={{ slug: 'dede', expr: f < 104 ? 'reflexion' : 'pleurs' }} />
        <Hud n={9} par={4} name="Le Clocher" clock={`0:${String(secs).padStart(2, '0')}`} red={red && f >= 118} f={f} />
        <Counter n={6} />
        {f >= 104 && <Banner f={f} at={104} bg={C.grape} color="#ffffff" title="Balle ramassée" sub="🧺 6 coups sans rentrer : 7 inscrits" />}
      </GolfPhone>
      {f >= 126 && (
        <Pop f={f} at={126} rot={-2} style={{ position: 'absolute', left: 0, right: 0, top: 812, display: 'flex', justifyContent: 'center' }}>
          <Pill bg={C.sun} size={36}>⏱️ Chrono fini : 7 aussi !</Pill>
        </Pop>
      )}
      {f >= 106 && <Corner f={f} at={106} slug="dede" expr="pleurs" />}
      <Sfx name="tap" at={6} volume={0.6} />
      <Sfx name="whoosh" at={8} volume={0.3} />
      <Sfx name="tap" at={54} volume={0.4} />
      <Sfx name="swoosh-up" at={104} volume={0.4} />
      <Sfx name="pop" at={106} volume={0.5} />
      <Sfx name="pop" at={126} volume={0.5} />
    </>
  )
}

// ---------------------------------------------------------------------------
// Victoire : carte de score
// ---------------------------------------------------------------------------
const BOARD: { slug: Slug; name: string; pts: number; bg: string }[] = [
  { slug: 'kevin', name: 'Keke', pts: 24, bg: C.sun },
  { slug: 'manon', name: 'Manon', pts: 27, bg: C.surface },
  { slug: 'mika', name: 'Mika', pts: 29, bg: C.surface },
  { slug: 'dede', name: 'Dédé', pts: 33, bg: C.surface },
]
const Board: React.FC<{ f: number }> = ({ f }) => (
  <>
    {BOARD.map((b, i) => (
      <Pop key={b.slug} f={f} at={14 + i * 4} from={40} style={{ position: 'absolute', left: 36 + (i % 2) * 330, top: Math.floor(i / 2) * 112, width: 318 }}>
        <Panel bg={b.bg} radius={26} shadow={6} style={{ height: 98, display: 'flex', alignItems: 'center', gap: 10, padding: '0 18px 0 12px' }}>
          <Avatar slug={b.slug} expression={i === 3 ? 'pleurs' : i === 0 ? 'joie' : 'cool'} size={70} outfit={OUTFITS[b.slug]} />
          <div style={{ flex: 1, fontSize: 34, lineHeight: 1 }}>{b.name}</div>
          <div style={{ fontSize: 48, lineHeight: 1, color: INK }}>{b.pts}</div>
        </Panel>
      </Pop>
    ))}
  </>
)

export const miniGolf: TutoSpec = {
  id: 'mini-golf',
  name: 'Mini-golf',
  emoji: '⛳',
  color: '#7AE582',
  players: '2 à 9 joueurs',
  goal: 'Rentre ta balle en un minimum de coups !',
  cast: ['kevin', 'dede', 'manon', 'mika'],
  outfits: OUTFITS,
  steps: [
    { text: 'Tous sur le même trou, en même temps : chacun sa balle', seconds: 5.4, Mock: Intro },
    { text: 'Pose le doigt n’importe où, tire en arrière… et lâche !', seconds: 5.6, Mock: Gesture },
    { text: 'Moulin, looping, bumpers… Balle à l’eau : +1 coup !', seconds: 5.6, Mock: MillAndBridge },
    { text: '6 coups et 90 s par trou. Pas rentrée ? 7 inscrits !', seconds: 5.4, Mock: Limits },
  ],
  win: {
    text: 'Le plus petit total de coups gagne !',
    sub: '9 trous, ou Express en 5. Chrono 60 s, 90 s ou sans.',
    winners: ['kevin'],
    Board,
  },
}

