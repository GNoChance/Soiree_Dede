import { motion } from 'framer-motion'
import { fx } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import type { DuelBoardOptionsProps } from '@/features/duel/types'
import { VARIANTS, variantInfo, variantOf, type Variant } from './logic'

/* Mini-illustrations statiques (viewBox 60 × 60) : traits en currentColor, ❌ tomate, ⭕ ciel. */
const X_COLOR = '#EF476F'
const O_COLOR = '#4CC9F0'

function X({ cx, cy, r, w }: { cx: number; cy: number; r: number; w: number }) {
  return <path d={`M ${cx - r} ${cy - r} L ${cx + r} ${cy + r} M ${cx + r} ${cy - r} L ${cx - r} ${cy + r}`} stroke={X_COLOR} strokeWidth={w} strokeLinecap="round" fill="none" />
}
function O({ cx, cy, r, w }: { cx: number; cy: number; r: number; w: number }) {
  return <circle cx={cx} cy={cy} r={r} stroke={O_COLOR} strokeWidth={w} fill="none" />
}

function Illustration({ variant }: { variant: Variant }) {
  if (variant === 'classic') {
    return (
      <svg viewBox="0 0 60 60" className="size-14" aria-hidden>
        <path d="M 21 5 C 22 22, 19 38, 21 55 M 39 5 C 38 22, 41 38, 39 55 M 5 21 C 22 20, 38 23, 55 21 M 5 39 C 22 40, 38 37, 55 39" stroke="currentColor" strokeWidth="3" strokeLinecap="round" fill="none" />
        <X cx={12} cy={12} r={5} w={3.5} />
        <O cx={30} cy={30} r={5.5} w={3.5} />
        <X cx={48} cy={12} r={5} w={3.5} />
        <O cx={48} cy={48} r={5.5} w={3.5} />
        <X cx={30} cy={12} r={5} w={3.5} />
        <path d="M 5 12 L 55 12" stroke="var(--ink)" strokeWidth="2.5" strokeLinecap="round" opacity=".85" />
      </svg>
    )
  }
  if (variant === 'giant') {
    const lines: string[] = []
    for (let k = 1; k < 10; k++) lines.push(`M ${k * 6} 0 L ${k * 6} 60 M 0 ${k * 6} L 60 ${k * 6}`)
    return (
      <svg viewBox="0 0 60 60" className="size-14" aria-hidden>
        <rect x="0.5" y="0.5" width="59" height="59" rx="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d={lines.join(' ')} stroke="currentColor" strokeWidth="0.6" opacity=".45" />
        {[1, 2, 3, 4, 5].map((k) => (
          <X key={k} cx={k * 6 + 9} cy={k * 6 + 9} r={1.8} w={1.6} />
        ))}
        {[
          [2, 4],
          [4, 1],
          [6, 6],
          [3, 7],
          [7, 3],
        ].map(([c, r]) => (
          <O key={`${c}-${r}`} cx={c * 6 + 3} cy={r * 6 + 3} r={1.9} w={1.4} />
        ))}
        <path d="M 13 13 L 47 47" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" />
      </svg>
    )
  }
  const small: string[] = []
  for (let b = 0; b < 9; b++) {
    const x0 = (b % 3) * 20 + 3
    const y0 = Math.floor(b / 3) * 20 + 3
    small.push(`M ${x0 + 4.7} ${y0} L ${x0 + 4.7} ${y0 + 14} M ${x0 + 9.3} ${y0} L ${x0 + 9.3} ${y0 + 14}`)
    small.push(`M ${x0} ${y0 + 4.7} L ${x0 + 14} ${y0 + 4.7} M ${x0} ${y0 + 9.3} L ${x0 + 14} ${y0 + 9.3}`)
  }
  return (
    <svg viewBox="0 0 60 60" className="size-14" aria-hidden>
      <rect x="41" y="21" width="18" height="18" rx="3" fill="#FFB703" opacity=".55" />
      <path d={small.join(' ')} stroke="currentColor" strokeWidth="0.8" opacity=".6" />
      <path d="M 20 2 C 21 22, 19 40, 20 58 M 40 2 C 39 22, 41 40, 40 58 M 2 20 C 22 19, 40 21, 58 20 M 2 40 C 22 41, 40 39, 58 40" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      <X cx={10} cy={10} r={6} w={3} />
      <O cx={30} cy={30} r={6.5} w={3} />
      <X cx={22.5} cy={45.5} r={1.6} w={1.3} />
      <O cx={5.5} cy={50} r={1.7} w={1.2} />
    </svg>
  )
}

/** Choix de la variante (options propres au jeu, stockées sous `options.board`). */
export default function MorpionBoardOptions({ value, onChange }: DuelBoardOptionsProps) {
  const v = variantOf(value)
  return (
    <div className="flex flex-col gap-2">
      <span className="font-display text-lg font-extrabold">Variante</span>
      <div className="grid grid-cols-3 gap-2">
        {VARIANTS.map((x) => {
          const sel = x.id === v
          return (
            <motion.button
              key={x.id}
              type="button"
              onClick={() => {
                if (sel) return
                fx.pop()
                onChange({ ...value, variant: x.id })
              }}
              animate={{ scale: sel ? 1.04 : 0.96, rotate: sel ? -2 : 0 }}
              whileTap={{ scale: 0.9 }}
              aria-pressed={sel}
              className={cn(
                'flex min-w-0 flex-col items-center gap-1 rounded-card border-[3px] border-ink p-1.5 text-center',
                sel ? 'bg-sun text-[#1f1b2e] shadow-sticker' : 'bg-sunk text-muted',
              )}
            >
              <Illustration variant={x.id} />
              <span className="font-display text-sm leading-tight font-extrabold">{x.label}</span>
              <span className="text-[11px] leading-tight font-bold">{x.short}</span>
            </motion.button>
          )
        })}
      </div>
      <p className="text-sm leading-snug text-muted">{variantInfo(v).help}</p>
    </div>
  )
}
