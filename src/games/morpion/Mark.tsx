import { memo } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { cn } from '@/lib/cn'
import type { Sym } from './logic'
import { useMyItem } from '@/features/cadeaux/useMyItem'

/* Tracés « à main levée » dans un viewBox 100 × 100 (légèrement courbes, le rond déborde un peu). */
const X1 = 'M 25 24 C 40 39, 58 59, 76 77'
const X2 = 'M 76 24 C 61 40, 42 58, 24 76'
const O = 'M 50 17 C 70 16, 83 31, 83 50 C 83 69, 69 83, 50 83 C 31 83, 17 69, 17 50 C 17 33, 29 19, 55 19'

export interface MarkProps {
  sym: Sym
  /** Couleur du duelliste (trait), sur un contour encre. */
  color: string
  /** Tracé qui se dessine (nouveau coup). */
  draw?: boolean
  /** Délai avant le tracé (s). */
  delay?: number
  /** Épaisseur du trait coloré (unités du viewBox 100). */
  weight?: number
  className?: string
  style?: React.CSSProperties
}

/** Symbole ❌ / ⭕ en SVG, aux couleurs du joueur, qui « se dessine » quand `draw`. */
export const Mark = memo(function Mark({ sym, color, draw = false, delay = 0, weight = 11, className, style }: MarkProps) {
  const reduce = useReducedMotion()
  const animate = draw && !reduce
  // Croix et ronds achetés en boutique (sur mon écran) : contour, halo, trait de craie.
  const skin = useMyItem('marks')?.marks
  const paths = sym === 'x' ? [X1, X2] : [O]
  const dur = sym === 'x' ? 0.17 : 0.36
  const stroke = (d: string, i: number, outline: boolean) => {
    const common = {
      d,
      fill: 'none',
      stroke: outline ? (skin?.outline ?? 'var(--ink)') : color,
      strokeWidth: outline ? weight + 7 : weight,
      strokeLinecap: 'round' as const,
      strokeLinejoin: 'round' as const,
    }
    if (!animate) return <path key={`${outline}-${i}`} {...common} strokeDasharray={skin?.dash && !outline ? '14 7' : undefined} />
    const at = delay + i * (dur + 0.04)
    return (
      <motion.path
        key={`${outline}-${i}`}
        {...common}
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ pathLength: { duration: dur, delay: at, ease: 'easeOut' }, opacity: { duration: 0.01, delay: at } }}
      />
    )
  }
  return (
    <svg viewBox="0 0 100 100" className={cn('pointer-events-none size-full overflow-visible', className)} style={skin?.glow ? { filter: `drop-shadow(0 0 5px ${skin.glow})`, ...style } : style} aria-hidden>
      {paths.map((d, i) => stroke(d, i, true))}
      {paths.map((d, i) => stroke(d, i, false))}
    </svg>
  )
})

/** Emoji texte du symbole (consignes). */
export const symEmoji = (sym: Sym | null | undefined) => (sym === 'x' ? '❌' : sym === 'o' ? '⭕' : '')
/** Nom du symbole (accessibilité). */
export const symName = (sym: Sym | null | undefined) => (sym === 'x' ? 'croix' : sym === 'o' ? 'rond' : 'vide')
