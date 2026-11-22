import type { CSSProperties, ReactNode } from 'react'
import { motion } from 'framer-motion'

const LINES = 'repeating-linear-gradient(transparent 0 27px, #9ec9f0 27px 28px)'
const EASE = [0.45, 0, 0.2, 1] as const
export const FOLD_MS = 650

const hidden: CSSProperties = { backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }

/** Face écrite (recto) : on n'en montre que la moitié haute (shift 0) ou basse (shift = -h/2). */
function Written({ text, w, h, shift, className = '' }: { text: string; w: number; h: number; shift: number; className?: string }) {
  return (
    <div className={`absolute inset-0 overflow-hidden border-[3px] border-ink bg-[#fffdf2] ${className}`}>
      <div
        className="absolute left-0 text-lg leading-[28px] break-words whitespace-pre-wrap text-[#1f1b2e]"
        style={{ top: shift, width: w, height: h, padding: 16, backgroundImage: LINES, backgroundPositionY: 12 }}
      >
        <p className="mb-1 font-display text-lg font-extrabold leading-[28px]">Mon idée</p>
        {text}
      </div>
    </div>
  )
}

/** Verso / papier déjà plié : plus sombre, avec un trait de pliure. */
function Blank({ children, edge }: { children?: ReactNode; edge?: 'top' | 'left' | 'none' }) {
  return (
    <div className="absolute inset-0 overflow-hidden border-[3px] border-ink bg-[#e7dfc0]">
      <div className="absolute inset-0 opacity-50" style={{ backgroundImage: LINES, backgroundPositionY: 12 }} />
      {edge === 'top' && <div className="absolute inset-x-0 top-0 h-3 bg-gradient-to-b from-black/25 to-transparent" />}
      {edge === 'left' && <div className="absolute inset-y-0 left-0 w-3 bg-gradient-to-r from-black/25 to-transparent" />}
      {children}
    </div>
  )
}

function Shade({ from, to, delay = 0 }: { from: number; to: number; delay?: number }) {
  return (
    <motion.div
      className="pointer-events-none absolute inset-0 bg-black"
      initial={{ opacity: from }}
      animate={{ opacity: to }}
      transition={{ duration: FOLD_MS / 1000, ease: EASE, delay }}
    />
  )
}

/**
 * Papier plié en 3D. phase 1 : la moitié haute se rabat sur la moitié basse (pliure horizontale) ;
 * phase 2 : le résultat (w × h/2) se replie en deux autour de la pliure verticale -> paquet w/2 × h/2
 * en bas à gauche de la zone (son centre : (w/4, 3h/4)), avec un coin replié.
 */
export function PaperFold({ text, w, h, phase }: { text: string; w: number; h: number; phase: 1 | 2 }) {
  const hh = h / 2
  const hw = w / 2
  const t = { duration: FOLD_MS / 1000, ease: EASE }
  if (phase === 1) {
    return (
      <div className="relative" style={{ width: w, height: h, perspective: 1400 }}>
        <div className="absolute inset-x-0" style={{ top: hh, height: hh }}>
          <Written text={text} w={w} h={h} shift={-hh} />
          <Shade from={0} to={0.3} />
        </div>
        <motion.div
          className="absolute inset-x-0 top-0"
          style={{ height: hh, transformOrigin: '50% 100%', transformStyle: 'preserve-3d' }}
          initial={{ rotateX: 0 }}
          animate={{ rotateX: -180 }}
          transition={t}
        >
          <div className="absolute inset-0" style={hidden}>
            <Written text={text} w={w} h={h} shift={0} />
            <Shade from={0} to={0.55} />
          </div>
          <div className="absolute inset-0" style={{ ...hidden, transform: 'rotateX(180deg)' }}>
            <Blank edge="top" />
            <Shade from={0.5} to={0} />
          </div>
        </motion.div>
      </div>
    )
  }
  return (
    <div className="relative" style={{ width: w, height: h }}>
      <div className="absolute left-0" style={{ top: hh, width: w, height: hh, perspective: 1400 }}>
        <div className="absolute left-0 top-0" style={{ width: hw, height: hh }}>
          <Blank edge="top" />
          <Shade from={0} to={0.25} />
        </div>
        <motion.div
          className="absolute top-0"
          style={{ left: hw, width: hw, height: hh, transformOrigin: '0% 50%', transformStyle: 'preserve-3d' }}
          initial={{ rotateY: 0 }}
          animate={{ rotateY: -180 }}
          transition={t}
        >
          <div className="absolute inset-0" style={hidden}>
            <Blank edge="top" />
            <Shade from={0} to={0.5} />
          </div>
          <div className="absolute inset-0" style={{ ...hidden, transform: 'rotateY(180deg)' }}>
            <Blank edge="left" />
            <Shade from={0.45} to={0} />
          </div>
        </motion.div>
        {/* petit coin replié */}
        <motion.div
          className="absolute top-0 border-ink bg-[#fffdf2]"
          style={{ zIndex: 5, left: hw - 34, width: 34, height: 34, clipPath: 'polygon(0 0, 100% 0, 100% 100%)', transformOrigin: '100% 0%' }}
          initial={{ scale: 0, rotate: 40 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 10, delay: FOLD_MS / 1000 }}
        />
      </div>
    </div>
  )
}
