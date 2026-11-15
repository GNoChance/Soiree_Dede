import { motion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/cn'
import type { PlayerInfo } from '../types'
import { frameMarks, scoreSheet, type Sheet } from './scoring'

/** Feuille de score officielle d'un joueur (marques X / - + cumuls). */
export function ScoreSheet({
  player, sheet, frames, current, rank, me, done, compact,
}: {
  player: PlayerInfo
  sheet: Sheet
  frames: number
  /** Frame en cours (1-based) à surligner. */
  current?: number | null
  rank?: number
  me?: boolean
  done?: boolean
  compact?: boolean
}) {
  const { total, cum } = scoreSheet(sheet, frames)
  return (
    <div className={cn('sticker-sm flex flex-col gap-1 bg-surface p-2', me && 'ring-2 ring-tangerine')}>
      <div className="flex items-center gap-2">
        {rank !== undefined && <span className="w-5 text-center font-display text-lg font-extrabold">{rank}</span>}
        <Avatar slug={player.slug} tenue={player.equippedTenue} size={compact ? 26 : 32} />
        <span className="min-w-0 flex-1 truncate font-display font-extrabold">
          {player.nickname}
          {done && <span className="ml-1 text-sm">✅</span>}
        </span>
        <motion.span key={total} initial={{ scale: 1.6 }} animate={{ scale: 1 }} className="font-display text-xl font-extrabold tabular-nums">
          {total}
        </motion.span>
      </div>
      <div className="grid gap-px overflow-hidden rounded-chip border-2 border-ink bg-ink" style={{ gridTemplateColumns: `repeat(${frames - 1}, minmax(0, 1fr)) minmax(0, 1.45fr)` }}>
        {Array.from({ length: frames }, (_, f) => {
          const isLast = f === frames - 1
          const marks = frameMarks(sheet[f] ?? [], isLast)
          const slots = isLast ? 3 : 2
          const active = current === f + 1
          return (
            <div key={f} className={cn('flex flex-col bg-surface', active && 'bg-sun/40')}>
              <div className="flex justify-end text-[10px] leading-4 font-bold text-muted">
                <span className="mr-auto pl-0.5">{f + 1}</span>
              </div>
              <div className="flex justify-end">
                {Array.from({ length: slots }, (_, r) => {
                  const m = marks[r] ?? ''
                  // En frame normale, un strike s'affiche dans la 2e case (comme sur une vraie feuille).
                  const shown = !isLast && marks[0] === 'X' ? (r === 1 ? 'X' : '') : m
                  return (
                    <span
                      key={r}
                      className={cn(
                        'flex h-4 min-w-0 flex-1 items-center justify-center border-l border-ink/30 text-[11px] font-extrabold',
                        shown === 'X' && 'bg-tomato text-white',
                        shown === '/' && 'bg-sky text-[#1f1b2e]',
                      )}
                    >
                      {shown}
                    </span>
                  )
                })}
              </div>
              <div className="h-5 text-center font-display text-sm leading-5 font-extrabold tabular-nums">{cum[f] ?? ''}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
