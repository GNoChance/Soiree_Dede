import { motion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import type { QuiDeNousState } from '@/types/db'
import { mood, playerOrPlaceholder } from '@/features/soiree/players'
import type { GameSummaryProps } from '../types'

/** Bloc fin de partie : le plus désigné de la soirée + les meilleures questions. */
export default function QuiDeNousSummary({ state, players }: GameSummaryProps) {
  const s = state as unknown as QuiDeNousState
  const entries = Object.entries(s.designated ?? {}).sort((a, b) => b[1] - a[1])
  const top = entries[0]
  if (!top || top[1] === 0) return null
  const p = playerOrPlaceholder(players, top[0])
  const highlights = (s.history ?? []).filter((h) => h.majority.length === 1).slice(-3)
  return (
    <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.2 }} className="sticker flex flex-col gap-3 bg-surface p-4">
      <div className="flex items-center gap-3">
        <Avatar slug={p.slug} expression={mood(p, 'shy')} size={60} />
        <div>
          <p className="text-sm text-muted">Star de la partie</p>
          <p className="font-display text-xl font-extrabold">
            {p.nickname} · désigné·e {top[1]} fois
          </p>
        </div>
      </div>
      {highlights.length > 0 && (
        <ul className="flex flex-col gap-2">
          {highlights.map((h) => {
            const w = playerOrPlaceholder(players, h.majority[0])
            return (
              <li key={h.round} className="flex items-center gap-2 rounded-chip bg-sunk p-2">
                <Avatar slug={w.slug} size={28} />
                <span className="text-sm leading-snug">
                  <b>{w.nickname}</b> — {h.question}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </motion.div>
  )
}
