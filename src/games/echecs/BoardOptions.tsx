import { motion } from 'framer-motion'
import { fx } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import type { DuelBoardOptionsProps } from '@/features/duel/types'
import { CADENCES, aboutMinutes, cadenceInfo, cadenceOf } from './logic'

/** Cadence (options propres au jeu, stockées sous `options.board`) + durée estimée selon le format. */
export default function EchecsBoardOptions({ value, onChange, playerCount }: DuelBoardOptionsProps) {
  const c = cadenceOf(value)
  const info = cadenceInfo(c)
  const n = Math.max(2, playerCount)
  return (
    <div className="flex flex-col gap-2">
      <span className="font-display text-lg font-extrabold">Cadence</span>
      <div className="grid grid-cols-2 gap-2">
        {CADENCES.map((x) => {
          const sel = x.id === c
          return (
            <motion.button
              key={x.id}
              type="button"
              onClick={() => {
                if (sel) return
                fx.pop()
                onChange({ ...value, cadence: x.id })
              }}
              animate={{ scale: sel ? 1.03 : 0.97, rotate: sel ? -1.5 : 0 }}
              whileTap={{ scale: 0.9 }}
              aria-pressed={sel}
              className={cn(
                'flex min-w-0 items-center gap-2 rounded-card border-[3px] border-ink p-2 text-left',
                sel ? 'bg-sun text-[#1f1b2e] shadow-sticker' : 'bg-sunk text-muted',
              )}
            >
              <span className="text-3xl leading-none">{x.emoji}</span>
              <span className="flex min-w-0 flex-col">
                <span className="font-display text-base leading-tight font-extrabold">{x.label}</span>
                <span className="text-xs leading-tight font-bold">{x.short}</span>
              </span>
            </motion.button>
          )
        })}
      </div>
      <p className="text-sm leading-snug text-muted">{info.help}</p>
      <p className="rounded-card border-2 border-dashed border-ink/30 px-2 py-1 text-xs leading-snug font-bold text-muted">
        ⏳ Durée estimée : ⚔️ Duel {aboutMinutes(info.typical)} · 🏆 Tournoi {aboutMinutes(info.typical * (n - 1))} · 👑 Roi de la table {aboutMinutes(info.typical * n)}
      </p>
    </div>
  )
}
