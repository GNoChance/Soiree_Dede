import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { cn } from '@/lib/cn'

/**
 * Décors du Loup-garou : ciel (nuit / aube / jour), lune, étoiles scintillantes,
 * brouillard qui dérive, silhouette du village. 100 % CSS/SVG, aucun asset.
 */

export type SkyMode = 'night' | 'dawn' | 'day' | 'dusk'

const SKY: Record<SkyMode, string> = {
  night: 'linear-gradient(180deg, #05041a 0%, #141040 45%, #2b1d5e 100%)',
  dusk: 'linear-gradient(180deg, #1a1446 0%, #4b2a7a 55%, #c2557a 100%)',
  dawn: 'linear-gradient(180deg, #2b1d5e 0%, #8a4f9e 40%, #ff8fa3 75%, #ffb703 100%)',
  day: 'linear-gradient(180deg, #4cc9f0 0%, #9be3f7 60%, #fff1c9 100%)',
}

interface Star {
  x: number
  y: number
  r: number
  d: number
  delay: number
}

function makeStars(n: number): Star[] {
  return Array.from({ length: n }, () => ({
    x: Math.random() * 100,
    y: Math.random() * 70,
    r: Math.random() < 0.15 ? 2.6 : Math.random() < 0.5 ? 1.7 : 1.1,
    d: 1.8 + Math.random() * 3,
    delay: Math.random() * 4,
  }))
}

export function Stars({ count = 60, className }: { count?: number; className?: string }) {
  const [stars] = useState(() => makeStars(count))
  const reduce = useReducedMotion()
  return (
    <div aria-hidden className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}>
      {stars.map((s, i) => (
        <motion.span
          key={i}
          className="absolute rounded-full bg-white"
          style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.r, height: s.r, boxShadow: s.r > 2 ? '0 0 6px 1px rgba(255,255,255,.8)' : undefined }}
          animate={reduce ? undefined : { opacity: [0.25, 1, 0.25], scale: [0.8, 1.2, 0.8] }}
          transition={{ repeat: Infinity, duration: s.d, delay: s.delay, ease: 'easeInOut' }}
        />
      ))}
      {!reduce && (
        <motion.span
          className="absolute h-[2px] w-24 rounded-full bg-gradient-to-r from-transparent via-white to-transparent"
          style={{ top: '12%', left: '-20%', rotate: 18 }}
          animate={{ x: ['0vw', '140vw'], opacity: [0, 1, 0] }}
          transition={{ repeat: Infinity, duration: 1.4, repeatDelay: 9, ease: 'easeOut' }}
        />
      )}
    </div>
  )
}

export function Moon({ size = 90, className, blood }: { size?: number; className?: string; blood?: boolean }) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      aria-hidden
      className={cn('pointer-events-none relative rounded-full', className)}
      style={{
        width: size,
        height: size,
        background: blood ? 'radial-gradient(circle at 35% 35%, #ffd0c2, #e85d75 60%, #8c2a45)' : 'radial-gradient(circle at 35% 35%, #fffdf0, #f6e7b0 60%, #d9c27a)',
        boxShadow: blood ? '0 0 50px 12px rgba(239,71,111,.45)' : '0 0 60px 14px rgba(255,241,190,.35)',
      }}
      animate={reduce ? undefined : { y: [0, -6, 0], rotate: [0, 3, 0] }}
      transition={{ repeat: Infinity, duration: 7, ease: 'easeInOut' }}
    >
      <span className="absolute rounded-full bg-black/10" style={{ width: size * 0.22, height: size * 0.22, left: '22%', top: '30%' }} />
      <span className="absolute rounded-full bg-black/10" style={{ width: size * 0.14, height: size * 0.14, left: '58%', top: '55%' }} />
      <span className="absolute rounded-full bg-black/10" style={{ width: size * 0.1, height: size * 0.1, left: '60%', top: '22%' }} />
    </motion.div>
  )
}

export function Sun({ size = 80, className }: { size?: number; className?: string }) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      aria-hidden
      className={cn('pointer-events-none relative', className)}
      style={{ width: size, height: size }}
      animate={reduce ? undefined : { rotate: 360 }}
      transition={{ repeat: Infinity, duration: 40, ease: 'linear' }}
    >
      <div className="absolute inset-0 rounded-full" style={{ background: 'repeating-conic-gradient(#ffd166 0deg 12deg, transparent 12deg 30deg)', transform: 'scale(1.45)', opacity: 0.6 }} />
      <div className="absolute inset-0 rounded-full border-[3px] border-ink" style={{ background: 'radial-gradient(circle at 35% 35%, #fff3b0, #ffb703)' }} />
    </motion.div>
  )
}

/** Nappes de brouillard qui dérivent. */
export function Fog({ className, strong }: { className?: string; strong?: boolean }) {
  const reduce = useReducedMotion()
  const layers = [
    { bottom: '6%', h: 90, d: 26, o: strong ? 0.35 : 0.22, from: '-30%', to: '10%' },
    { bottom: '0%', h: 120, d: 34, o: strong ? 0.3 : 0.18, from: '5%', to: '-25%' },
    { bottom: '16%', h: 60, d: 22, o: strong ? 0.22 : 0.12, from: '-10%', to: '20%' },
  ]
  return (
    <div aria-hidden className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}>
      {layers.map((l, i) => (
        <motion.div
          key={i}
          className="absolute w-[160%] rounded-[50%] blur-2xl"
          style={{ bottom: l.bottom, height: l.h, left: '-30%', background: `rgba(220,215,255,${l.o})` }}
          animate={reduce ? undefined : { x: [l.from, l.to, l.from] }}
          transition={{ repeat: Infinity, duration: l.d, ease: 'easeInOut' }}
        />
      ))}
    </div>
  )
}

/** Silhouette du village (maisons, clocher, sapins). Fenêtres allumées optionnelles. */
export function Village({ lit = true, className, color = '#0b0920' }: { lit?: boolean; className?: string; color?: string }) {
  const reduce = useReducedMotion()
  const windows: Array<[number, number]> = [
    [42, 92],
    [118, 86],
    [196, 98],
    [262, 90],
    [330, 94],
  ]
  return (
    <svg aria-hidden viewBox="0 0 400 130" preserveAspectRatio="xMidYMax slice" className={cn('pointer-events-none absolute inset-x-0 bottom-0 h-28 w-full', className)}>
      <g fill={color}>
        <path d="M0 130 V104 L14 80 L28 104 V130 Z" />
        <path d="M20 130 V86 L50 62 L80 86 V130 Z" />
        <path d="M86 130 V96 L104 70 L122 96 V130 Z" />
        <path d="M100 130 V78 L130 56 L160 78 V130 Z" />
        <rect x="170" y="52" width="26" height="78" />
        <path d="M166 54 L183 18 L200 54 Z" />
        <path d="M181 18 V8 M176 12 H186" stroke={color} strokeWidth="3" />
        <path d="M200 130 V90 L226 70 L252 90 V130 Z" />
        <path d="M244 130 V82 L276 58 L308 82 V130 Z" />
        <path d="M312 130 V100 L326 72 L340 100 V130 Z" />
        <path d="M330 130 V86 L358 66 L386 86 V130 Z" />
        <path d="M380 130 V106 L392 84 L404 106 V130 Z" />
        <rect x="0" y="122" width="400" height="8" />
      </g>
      {lit &&
        windows.map(([x, y], i) => (
          <motion.rect
            key={i}
            x={x}
            y={y}
            width="8"
            height="9"
            rx="1.5"
            fill="#ffd166"
            animate={reduce ? undefined : { opacity: [0.9, 0.35, 0.9] }}
            transition={{ repeat: Infinity, duration: 2.5 + i * 0.7, delay: i * 0.4 }}
          />
        ))}
    </svg>
  )
}

/** Panneau « scène » (sticker) avec ciel animé, pour les phases de jour. */
export function SkyPanel({ mode, children, className }: { mode: SkyMode; children: ReactNode; className?: string }) {
  const dark = mode !== 'day'
  return (
    <motion.div
      layout
      className={cn('sticker relative overflow-hidden p-4 pb-24', dark ? 'text-white' : 'text-[#1f1b2e]', className)}
      style={{ background: SKY[mode] }}
      transition={{ type: 'spring', stiffness: 200, damping: 24 }}
    >
      {dark && <Stars count={mode === 'night' ? 50 : 22} />}
      <div className="pointer-events-none absolute top-3 right-3">{mode === 'day' ? <Sun size={56} /> : <Moon size={mode === 'dawn' ? 44 : 56} />}</div>
      <Fog strong={mode === 'night'} />
      <Village lit={mode !== 'day'} color={mode === 'day' ? '#2b4a3a' : '#0b0920'} />
      <div className="relative z-10">{children}</div>
    </motion.div>
  )
}

/** Écran de nuit plein écran (couvre l'en-tête : tous les téléphones se ressemblent). */
export function NightOverlay({ children }: { children: ReactNode }) {
  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 1.2 }}
      className="fixed inset-0 z-[70] overflow-y-auto text-white"
      style={{ background: SKY.night }}
    >
      <Stars count={90} className="fixed" />
      <Fog strong className="fixed" />
      <div className="pointer-events-none fixed inset-x-0 bottom-0 h-28">
        <Village lit={false} color="#020109" />
      </div>
      <div className="pt-safe pb-safe pl-safe pr-safe relative z-10 mx-auto flex min-h-dvh max-w-md flex-col px-4 pt-4 pb-32">{children}</div>
    </motion.div>,
    document.body,
  )
}
