import { useId, useMemo, type CSSProperties } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { cn } from '@/lib/cn'

/* -------------------------------------------------------------------------- */
/* Points (SVG, repère 100×100)                                                */
/* -------------------------------------------------------------------------- */

const P = { a: 26, m: 50, z: 74 }
const PIPS: Record<number, Array<[number, number]>> = {
  1: [[P.m, P.m]],
  2: [[P.a, P.a], [P.z, P.z]],
  3: [[P.a, P.a], [P.m, P.m], [P.z, P.z]],
  4: [[P.a, P.a], [P.z, P.a], [P.a, P.z], [P.z, P.z]],
  5: [[P.a, P.a], [P.z, P.a], [P.m, P.m], [P.a, P.z], [P.z, P.z]],
  6: [[P.a, P.a], [P.z, P.a], [P.a, P.m], [P.z, P.m], [P.a, P.z], [P.z, P.z]],
}

/** Points d'une face. Le 1 (joker) est un gros point rouge. */
export function Pips({ value, color = '#1f1b2e' }: { value: number; color?: string }) {
  const one = value === 1
  return (
    <>
      {(PIPS[value] ?? []).map(([cx, cy], i) => (
        <g key={i}>
          <circle cx={cx} cy={cy + 1.5} r={one ? 15 : 9.5} fill="#000" opacity=".18" />
          <circle cx={cx} cy={cy} r={one ? 15 : 9.5} fill={one ? '#EF476F' : color} />
          <circle cx={cx - (one ? 4.5 : 3)} cy={cy - (one ? 4.5 : 3)} r={one ? 4 : 2.6} fill="#fff" opacity=".35" />
        </g>
      ))}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Dé plat (icône) : sélecteur de valeur, enchère au centre, historique        */
/* -------------------------------------------------------------------------- */

export function FaceIcon({ value, size = 32, className, tone = 'ivory' }: { value: number; size?: number; className?: string; tone?: 'ivory' | 'gold' | 'dim' }) {
  const fill = tone === 'gold' ? '#FFD166' : tone === 'dim' ? '#d9d4c7' : '#fffaf0'
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={cn('shrink-0', className)} aria-label={`dé ${value}`} role="img">
      <rect x="4" y="8" width="92" height="88" rx="22" fill="var(--ink)" />
      <rect x="4" y="4" width="88" height="88" rx="22" fill={fill} stroke="var(--ink)" strokeWidth="6" />
      <rect x="12" y="10" width="72" height="16" rx="8" fill="#fff" opacity=".55" />
      <Pips value={value} />
    </svg>
  )
}

/* -------------------------------------------------------------------------- */
/* Dé 3D CSS (cube à 6 faces, faces en SVG)                                    */
/* -------------------------------------------------------------------------- */

// Rotation du cube qui amène la face v vers l'observateur.
const SHOW: Record<number, { x: number; y: number }> = {
  1: { x: 0, y: 0 },
  6: { x: 0, y: 180 },
  3: { x: 0, y: -90 },
  4: { x: 0, y: 90 },
  2: { x: -90, y: 0 },
  5: { x: 90, y: 0 },
}
// Position de chaque face sur le cube (faces opposées : somme 7).
const FACE_TF: Record<number, string> = {
  1: 'rotateY(0deg)',
  6: 'rotateY(180deg)',
  3: 'rotateY(90deg)',
  4: 'rotateY(-90deg)',
  2: 'rotateX(90deg)',
  5: 'rotateX(-90deg)',
}

export interface Die3DProps {
  value: number
  size?: number
  /** Animation de lancer (tourne puis se pose sur `value`). */
  rolling?: boolean
  /** Délai avant de se poser (s). */
  delay?: number
  /** Dé compté pendant la révélation : face dorée + halo. */
  lit?: boolean
  /** Dé non compté (révélation terminée) : atténué. */
  dim?: boolean
  /** Graine pour varier l'inclinaison / la rotation de lancer. */
  seed?: number
  className?: string
  style?: CSSProperties
}

function rand(seed: number) {
  const x = Math.sin(seed * 9301 + 49297) * 233280
  return x - Math.floor(x)
}

export function Die3D({ value, size = 44, rolling, delay = 0, lit, dim, seed = 0, className, style }: Die3DProps) {
  const reduce = useReducedMotion()
  const half = size / 2
  const target = SHOW[value] ?? SHOW[1]
  const spins = useMemo(() => ({ x: 2 + Math.floor(rand(seed + 1) * 2), y: 1 + Math.floor(rand(seed + 2) * 2) }), [seed])
  const tilt = useMemo(() => ({ x: -16 - rand(seed + 3) * 8, y: 18 + rand(seed + 4) * 14, z: (rand(seed + 5) - 0.5) * 16 }), [seed])
  const animateRoll = rolling && !reduce
  const face = lit ? '#FFD166' : '#fffaf0'
  const edge = lit ? '#e9a800' : '#e7dcc4'

  return (
    <div
      className={cn('relative shrink-0 transition-[filter,opacity] duration-300', dim && 'opacity-45 saturate-50', className)}
      style={{ width: size, height: size, perspective: size * 5, filter: lit ? 'drop-shadow(0 0 8px #FFD166) drop-shadow(0 0 3px #FB8500)' : undefined, ...style }}
    >
      {/* ombre portée au sol */}
      <motion.div
        className="absolute rounded-[50%] bg-black/30 blur-[2px]"
        style={{ left: size * 0.1, right: size * 0.05, bottom: -size * 0.12, height: size * 0.22 }}
        initial={animateRoll ? { scale: 0.4, opacity: 0 } : false}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: delay + 0.3, duration: 0.5 }}
      />
      <motion.div
        className="absolute inset-0"
        style={{ transformStyle: 'preserve-3d' }}
        initial={animateRoll ? { y: -size * 1.6, rotateZ: tilt.z - 140 } : false}
        animate={{ y: animateRoll ? [-size * 1.6, 0, -size * 0.25, 0] : 0, rotateZ: tilt.z }}
        transition={{ delay, duration: 0.85, times: animateRoll ? [0, 0.55, 0.75, 1] : undefined, ease: 'easeOut' }}
      >
        <div className="absolute inset-0" style={{ transformStyle: 'preserve-3d', transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)` }}>
          <motion.div
            className="absolute inset-0"
            style={{ transformStyle: 'preserve-3d' }}
            initial={animateRoll ? { rotateX: target.x + 360 * spins.x, rotateY: target.y - 360 * spins.y } : false}
            animate={{ rotateX: target.x, rotateY: target.y }}
            transition={{ delay, duration: animateRoll ? 0.95 : 0.4, ease: [0.2, 0.7, 0.3, 1] }}
          >
            {[1, 2, 3, 4, 5, 6].map((v) => (
              <div
                key={v}
                className="absolute inset-0 overflow-hidden"
                style={{
                  transform: `${FACE_TF[v]} translateZ(${half}px)`,
                  backfaceVisibility: 'hidden',
                  borderRadius: size * 0.2,
                  background: `radial-gradient(circle at 30% 25%, #ffffff 0%, ${face} 45%, ${edge} 100%)`,
                  boxShadow: `inset 0 0 0 ${Math.max(1.5, size * 0.045)}px var(--ink), inset 0 0 ${size * 0.18}px rgba(120,90,40,.35)`,
                }}
              >
                <svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden>
                  <Pips value={v} />
                </svg>
              </div>
            ))}
            {/* cœur sombre : évite de voir à travers les arêtes arrondies */}
            <div
              className="absolute"
              style={{ inset: size * 0.06, transform: 'rotateX(90deg)', background: edge, backfaceVisibility: 'visible' }}
            />
            <div className="absolute" style={{ inset: size * 0.06, transform: 'rotateY(90deg)', background: edge }} />
            <div className="absolute" style={{ inset: size * 0.06, background: edge }} />
          </motion.div>
        </div>
      </motion.div>
      <span className="sr-only">{value}</span>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Gobelet (SVG)                                                               */
/* -------------------------------------------------------------------------- */

export function Cup({ size = 120, color = '#8B5CF6', className }: { size?: number; color?: string; className?: string }) {
  const id = `cup${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  return (
    <svg viewBox="0 0 120 130" width={size} height={size * (130 / 120)} className={cn('shrink-0', className)} aria-hidden>
      <defs>
        <linearGradient id={`${id}-g`} x1="0" x2="1">
          <stop offset="0" stopColor="#000" stopOpacity=".28" />
          <stop offset=".35" stopColor="#fff" stopOpacity=".25" />
          <stop offset=".55" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity=".35" />
        </linearGradient>
      </defs>
      {/* ombre dure */}
      <path d="M24 14 H104 L114 124 H14 Z" transform="translate(5 4)" fill="var(--ink)" />
      {/* corps */}
      <path d="M22 12 H98 L110 120 H10 Z" fill={color} stroke="var(--ink)" strokeWidth="5" strokeLinejoin="round" />
      <path d="M22 12 H98 L110 120 H10 Z" fill={`url(#${id}-g)`} />
      {/* cerclages */}
      <path d="M14 96 H106" stroke="var(--ink)" strokeWidth="4" />
      <path d="M13 104 H107" stroke="#FFD166" strokeWidth="5" />
      <path d="M20 30 H100" stroke="#FFD166" strokeWidth="5" />
      <path d="M21 36 H99" stroke="var(--ink)" strokeWidth="3" opacity=".6" />
      {/* fond (dessus) */}
      <ellipse cx="60" cy="12" rx="38" ry="7" fill={color} stroke="var(--ink)" strokeWidth="5" />
      {/* étoile décorative */}
      <path d="M60 52 l6 13 14 1 -11 9 4 14 -13 -8 -13 8 4 -14 -11 -9 14 -1z" fill="#FFD166" stroke="var(--ink)" strokeWidth="3" strokeLinejoin="round" />
      <path d="M30 46 Q 28 80 24 104" stroke="#fff" strokeOpacity=".45" strokeWidth="5" strokeLinecap="round" fill="none" />
    </svg>
  )
}

/** Rangée de petits dés plats (compteur de dés d'un joueur, faces cachées). */
export function HiddenDice({ n, size = 12, max = 5 }: { n: number; size?: number; max?: number }) {
  return (
    <span className="inline-flex gap-[2px]" aria-label={`${n} dé${n > 1 ? 's' : ''}`}>
      {Array.from({ length: max }, (_, i) => (
        <span
          key={i}
          className={cn('inline-block rounded-[3px] border-[1.5px] border-ink transition-all', i < n ? 'bg-surface' : 'scale-75 bg-transparent opacity-25')}
          style={{ width: size, height: size }}
        />
      ))}
    </span>
  )
}
