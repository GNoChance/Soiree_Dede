// Effets communs de la vidéo de Noël : flocon sticker, étincelles, givre, rafale, guirlande, transitions « flocon ».
import React from 'react'
import { AbsoluteFill, random } from 'remotion'
import { C } from '../theme'
import { TH, TW, clamp01, easeIn, easeInOut, lerp, ramp } from '../tuto/kit'
import { frostCorner } from './geometry'

export const N = { red: '#d62839', green: '#1b8a5a', gold: '#ffc93c', cream: '#fff6e5', ice: '#9fdcff', deep: '#1f6fd1' }
/** 1 temps de la musique (120 à la noire) en images. */
export const BEAT = 15
/** Temps « sur 3 » : les mouvements d'ambiance (rebonds, ondulations) changent toutes les 3 images — plus nerveux et bien plus léger à encoder. */
export const step3 = (f: number) => Math.floor(f / 3) * 3
export const sec = (s: number) => Math.round(s * 30)

/** Secousse déterministe (px) : amplitude décroissante entre `at` et `at + len`. */
export const shake = (f: number, at: number, len: number, amp: number, seed = 'sk') => {
  const t = f - at
  if (t < 0 || t >= len) return { x: 0, y: 0, r: 0 }
  const k = (1 - t / len) ** 1.5 * amp
  return { x: (random(`${seed}x${f}`) - 0.5) * 2 * k, y: (random(`${seed}y${f}`) - 0.5) * 2 * k, r: (random(`${seed}r${f}`) - 0.5) * k * 0.12 }
}

/** Flocon à 6 branches : contour d'encre épais (sticker) + ombre décalée. */
export const Flake: React.FC<{ size: number; outline?: boolean; shadow?: boolean; color?: string; style?: React.CSSProperties }> = ({ size, outline, shadow, color = '#ffffff', style }) => {
  const arms = (stroke: string, w: number, dx = 0) => (
    <g stroke={stroke} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" fill="none" transform={`translate(${dx},${dx})`}>
      {[0, 60, 120].map((a) => (
        <g key={a} transform={`rotate(${a})`}>
          <line x1={0} y1={-36} x2={0} y2={36} />
          <path d="M-11,-32 L0,-21 L11,-32 M-11,32 L0,21 L11,32" />
        </g>
      ))}
    </g>
  )
  return (
    <svg width={size * 1.12} height={size * 1.12} viewBox="-56 -56 112 112" style={{ display: 'block', overflow: 'visible', ...style }}>
      {shadow && arms(C.ink, 18, 5)}
      {outline && arms(C.ink, 18)}
      {arms(color, 10)}
    </svg>
  )
}

/** Étincelle à 4 branches. */
export const Sparkle: React.FC<{ size: number; color?: string; ink?: boolean; style?: React.CSSProperties }> = ({ size, color = '#ffffff', ink = true, style }) => (
  <svg width={size} height={size} viewBox="-12 -12 24 24" style={{ display: 'block', overflow: 'visible', ...style }}>
    <path d="M0,-11 Q1.2,-1.2 11,0 Q1.2,1.2 0,11 Q-1.2,1.2 -11,0 Q-1.2,-1.2 0,-11Z" fill={color} stroke={ink ? C.ink : 'none'} strokeWidth={ink ? 2.2 : 0} strokeLinejoin="round" />
  </svg>
)

// ---------------------------------------------------------------------------
// Givre : fougères blanches + masse givrée qui poussent depuis les 4 coins. p = 0 → 1.
// ---------------------------------------------------------------------------
const FROST = [frostCorner('fa'), frostCorner('fb'), frostCorner('fc'), frostCorner('fd')]
const CORNERS = [
  { x: 0, y: 0, sx: 1, sy: 1 },
  { x: TW, y: 0, sx: -1, sy: 1 },
  { x: 0, y: TH, sx: 1, sy: -1 },
  { x: TW, y: TH, sx: -1, sy: -1 },
]
export const Frost: React.FC<{ p: number; style?: React.CSSProperties }> = ({ p, style }) => {
  if (p <= 0.001) return null
  const grow = (at: number, dur: number) => 1 - (1 - clamp01((p - at) / dur)) ** 2
  const massK = grow(0, 0.9)
  return (
    <svg width={TW} height={TH} viewBox={`0 0 ${TW} ${TH}`} style={{ position: 'absolute', left: 0, top: 0, ...style }}>
      {FROST.map((fr, c) => {
        const k = CORNERS[c]
        const segs = fr.segs.filter((s) => p > s.at)
        return (
          <g key={c} transform={`translate(${k.x},${k.y}) scale(${k.sx},${k.sy})`}>
            <g stroke={C.ink} strokeLinecap="round" strokeLinejoin="round" fill="none">
              {segs.map((s, i) => (
                <path key={i} d={s.d} pathLength={1} strokeWidth={s.w + 4.5} strokeDasharray="1 1" strokeDashoffset={1 - grow(s.at, s.dur)} />
              ))}
            </g>
            <g transform={`scale(${massK})`}>
              <polygon points={fr.mass} fill="#ffffff" stroke={C.ink} strokeWidth={5} strokeLinejoin="round" />
            </g>
            <g stroke="#ffffff" strokeLinecap="round" strokeLinejoin="round" fill="none">
              {segs.map((s, i) => (
                <path key={i} d={s.d} pathLength={1} strokeWidth={s.w} strokeDasharray="1 1" strokeDashoffset={1 - grow(s.at, s.dur)} />
              ))}
            </g>
            <g transform={`scale(${massK})`}>
              <polygon points={fr.mass2} fill="#bfe9ff" opacity={0.85} />
            </g>
          </g>
        )
      })}
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Rafale : traînées de vent + particules de neige, toujours de gauche à droite.
// ---------------------------------------------------------------------------
const STREAKS = Array.from({ length: 20 }, (_, k) => ({
  y: random(`st-y${k}`) * TH,
  len: 190 + random(`st-l${k}`) * 480,
  th: 3 + random(`st-t${k}`) * 6,
  v: 64 + random(`st-v${k}`) * 90,
  ph: random(`st-p${k}`) * 2000,
  o: 0.4 + random(`st-o${k}`) * 0.5,
}))
export const Streaks: React.FC<{ f: number; amount: number }> = ({ f, amount }) => {
  if (amount <= 0) return null
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      {STREAKS.slice(0, Math.ceil(STREAKS.length * amount)).map((s, k) => {
        const span = TW + s.len + 240
        const x = ((s.ph + f * s.v * (0.6 + amount * 0.6)) % span) - s.len
        return (
          <div key={k} style={{ position: 'absolute', left: x, top: s.y, width: s.len, height: s.th, borderRadius: 999, opacity: s.o * Math.min(1, amount * 1.4), background: 'linear-gradient(90deg, rgba(255,255,255,0), #ffffff 70%)' }} />
        )
      })}
    </AbsoluteFill>
  )
}

const DOTS = Array.from({ length: 90 }, (_, k) => ({
  x: random(`dx${k}`) * 1000,
  y: random(`dy${k}`) * 1500,
  r: 3 + random(`dr${k}`) * (k % 5 === 0 ? 9 : 5),
  vx: 16 + random(`dv${k}`) * 34,
  vy: 1 + random(`dw${k}`) * 7,
  w: 0.05 + random(`dq${k}`) * 0.12,
  big: k % 11 === 0,
}))
/** Neige poussée par le vent. amount 0 → 1 (nombre et vitesse). */
export const Storm: React.FC<{ f: number; amount: number; speed?: number; style?: React.CSSProperties }> = ({ f, amount, speed = 1, style }) => {
  if (amount <= 0) return null
  const n = Math.ceil(DOTS.length * Math.min(1, amount))
  return (
    <svg width={TW} height={TH} style={{ position: 'absolute', left: 0, top: 0, ...style }}>
      {DOTS.slice(0, n).map((d, k) => {
        const x = ((d.x + f * d.vx * speed) % 1000) - 140
        const y = ((d.y + f * d.vy + Math.sin(f * d.w + k) * 26) % 1500) - 110
        if (d.big) {
          return (
            <g key={k} transform={`translate(${x},${y}) rotate(${f * 6 + k * 30}) scale(${d.r / 22})`} stroke="#ffffff" strokeWidth={6} strokeLinecap="round" fill="none">
              <line x1={0} y1={-18} x2={0} y2={18} transform="rotate(0)" />
              <line x1={0} y1={-18} x2={0} y2={18} transform="rotate(60)" />
              <line x1={0} y1={-18} x2={0} y2={18} transform="rotate(120)" />
            </g>
          )
        }
        return <ellipse key={k} cx={x} cy={y} rx={d.r * (1 + Math.min(2.2, d.vx * speed * 0.05))} ry={d.r} fill="#ffffff" opacity={0.92} />
      })}
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Guirlande lumineuse (haut du cadre) : tombe à `at`, s'allume ampoule par ampoule.
// ---------------------------------------------------------------------------
const BULBS = [N.gold, '#ffffff', C.sky, C.bubblegum]
const GARLAND = (() => {
  const xs = [-10, 175, 360, 545, 730]
  const bulbs: { x: number; y: number }[] = []
  let d = `M${xs[0]},8`
  for (let i = 0; i < xs.length - 1; i++) {
    const cx = (xs[i] + xs[i + 1]) / 2
    d += ` Q${cx},118 ${xs[i + 1]},8`
    for (const t of [0.2, 0.4, 0.6, 0.8]) bulbs.push({ x: (1 - t) ** 2 * xs[i] + 2 * (1 - t) * t * cx + t * t * xs[i + 1], y: 8 + 2 * (1 - t) * t * 110 })
  }
  return { d, bulbs }
})()
export const Garland: React.FC<{ f: number; at: number; lightFrom?: number; every?: number }> = ({ f, at, lightFrom = at + 6, every = 3 }) => {
  const t = f - at
  if (t < 0) return null
  const drop = 1 - Math.min(1, t / 9)
  const lit = Math.floor((f - lightFrom) / every) + 1
  return (
    <svg width={TW} height={140} style={{ position: 'absolute', left: 0, top: 0, transform: `translateY(${-drop * drop * 150}px)`, overflow: 'visible' }}>
      <path d={GARLAND.d} stroke={C.ink} strokeWidth={6} fill="none" />
      {GARLAND.bulbs.map((b, k) => {
        const on = k < lit
        const fresh = on ? ramp(f, lightFrom + k * every, lightFrom + k * every + 5) : 0
        const beat = Math.floor(f / BEAT) % 2 === k % 2 ? 1 : 0.55
        const glow = on ? (k < lit - 1 ? beat : 1.3 - fresh * 0.3) : 0
        return (
          <g key={k} transform={`translate(${b.x},${b.y})`}>
            {on && <circle cy={18} r={24 + (1 - fresh) * 18} fill="#ffffff" opacity={0.34 * glow} />}
            <rect x={-6} y={-3} width={12} height={10} rx={2} fill={C.ink} />
            <ellipse cy={20} rx={12} ry={16} fill={on ? BULBS[k % BULBS.length] : '#5d5878'} stroke={C.ink} strokeWidth={4} />
            {on && <ellipse cx={-4} cy={15} rx={3.2} ry={5} fill="#ffffff" opacity={0.7} />}
            {!on && <ellipse cy={20} rx={10} ry={14} fill={C.ink} opacity={0.18} />}
          </g>
        )
      })}
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Transitions « flocon » : la couleur du temps suivant se révèle derrière un gros flocon (fil rouge de la vidéo).
//   grow  : cercle depuis (ox, oy), le flocon grossit et essuie l'écran
//   sweep : bord incliné qui file de gauche à droite, le flocon chevauche le bord
//   drop  : cercle depuis le haut, le flocon tombe en grossissant
// La nouvelle scène n'apparaît que dans la zone déjà révélée (wipeClip) ; le flocon est dessiné au-dessus de tout.
// ---------------------------------------------------------------------------
export type WipeKind = 'grow' | 'sweep' | 'drop'
export const WIPE_FRAMES = 16

const wipeShape = (f: number, kind: WipeKind, ox: number, oy: number, spin: number) => {
  const p = easeInOut(ramp(f, 0, WIPE_FRAMES))
  if (kind === 'grow') {
    const r = p * 1000
    return { clip: `circle(${r}px at ${ox}px ${oy}px)`, flake: { x: ox, y: oy, s: Math.max(150, r * 1.7), rot: f * 11 * spin } }
  }
  if (kind === 'sweep') {
    const x = lerp(-260, TW + 400, p)
    return { clip: `polygon(0 0, ${x + 160}px 0, ${x - 160}px ${TH}px, 0 ${TH}px)`, flake: { x, y: oy, s: lerp(170, 560, Math.sin(p * Math.PI) * 0.9 + p * 0.1), rot: f * 14 * spin } }
  }
  const r = p * 1500
  return { clip: `circle(${r}px at ${ox}px ${oy}px)`, flake: { x: ox, y: oy + r * 0.62, s: Math.max(150, r * 0.9), rot: f * 9 * spin } }
}

/** Zone déjà révélée (à appliquer à la nouvelle scène), ou undefined hors transition. */
export const wipeClip = (f: number, kind: WipeKind, ox = TW / 2, oy = 700): string | undefined =>
  f < 0 || f >= WIPE_FRAMES ? undefined : wipeShape(f, kind, ox, oy, 1).clip

/** Fond du temps suivant : plein dès la fin de la transition, révélé par la forme pendant. */
export const WipeLayer: React.FC<{ f: number; kind: WipeKind; bg: string; ox?: number; oy?: number }> = ({ f, kind, bg, ox = TW / 2, oy = 700 }) => {
  if (f < 0) return null
  return (
    <AbsoluteFill style={{ clipPath: wipeClip(f, kind, ox, oy) }}>
      <AbsoluteFill style={{ background: bg }} />
      <AbsoluteFill style={{ background: 'radial-gradient(circle at 50% 40%, rgba(255,255,255,0.24), rgba(255,255,255,0) 64%)' }} />
      <AbsoluteFill style={{ backgroundImage: 'radial-gradient(rgba(0,0,0,0.1) 3px, transparent 3.6px)', backgroundSize: '40px 40px' }} />
    </AbsoluteFill>
  )
}

/** Le flocon de la transition (au-dessus de tout). */
export const WipeFlake: React.FC<{ f: number; kind: WipeKind; ox?: number; oy?: number; spin?: number }> = ({ f, kind, ox = TW / 2, oy = 700, spin = 1 }) => {
  if (f < 0 || f >= WIPE_FRAMES) return null
  const { flake } = wipeShape(f, kind, ox, oy, spin)
  const fade = 1 - ramp(f, WIPE_FRAMES - 5, WIPE_FRAMES)
  return (
    <AbsoluteFill style={{ overflow: 'hidden', pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', left: flake.x - flake.s / 2, top: flake.y - flake.s / 2, opacity: fade, transform: `rotate(${flake.rot}deg)` }}>
        <Flake size={flake.s} outline shadow />
      </div>
    </AbsoluteFill>
  )
}
