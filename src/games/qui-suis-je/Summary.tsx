import { motion } from 'framer-motion'
import { Check } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { mood, playerOrPlaceholder } from '@/features/soiree/players'
import type { GameSummaryProps } from '../types'
import type { QsjState } from './types'

/** Fin de partie : meilleur tour + tous les tours avec leurs cartes trouvées. */
export default function QuiSuisJeSummary({ state, players, meId }: GameSummaryProps) {
  const s = state as unknown as QsjState
  const history = s.history ?? []
  if (!history.length) return null
  const best = history.reduce((a, b) => (b.found > a.found ? b : a), history[0])
  const bestPlayer = best.found > 0 ? playerOrPlaceholder(players, best.guesser) : null
  const totalFound = history.reduce((n, t) => n + t.found, 0)
  return (
    <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.2 }} className="sticker flex flex-col gap-3 bg-surface p-4">
      {bestPlayer && (
        <div className="flex items-center gap-3">
          <Avatar slug={bestPlayer.slug} expression={mood(bestPlayer, 'proud')} size={60} />
          <div>
            <p className="text-sm text-muted">Le front le plus futé 🙈</p>
            <p className="font-display text-xl font-extrabold">
              {bestPlayer.nickname} · {best.found} carte{best.found > 1 ? 's' : ''} en un tour
            </p>
          </div>
        </div>
      )}
      <p className="font-display text-lg font-extrabold">
        {totalFound} carte{totalFound > 1 ? 's' : ''} trouvée{totalFound > 1 ? 's' : ''} au total
      </p>
      <div className="flex flex-col gap-2">
        {history.map((t, i) => {
          const p = playerOrPlaceholder(players, t.guesser)
          const found = t.log.filter((e) => e.r === 'found')
          return (
            <motion.div
              key={t.turn}
              initial={{ opacity: 0, x: i % 2 ? 40 : -40 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 20, delay: 1.4 + i * 0.06 }}
              className="flex items-start gap-2 rounded-card bg-sunk p-2"
            >
              <Avatar slug={p.slug} size={36} />
              <div className="min-w-0 flex-1">
                <p className="font-display text-base leading-tight font-extrabold">
                  {p.nickname}
                  {t.guesser === meId && <span className="text-muted"> (toi)</span>} · {t.found} ✓
                  {t.skipped && <span className="text-sm font-bold text-muted"> (tour passé)</span>}
                </p>
                {found.length > 0 && (
                  <p className="flex flex-wrap gap-1 pt-1">
                    {found.map((e, k) => (
                      <span key={k} className="inline-flex items-center gap-0.5 rounded-full border-2 border-ink bg-mint px-2 text-xs font-extrabold text-[#1f1b2e]">
                        <Check className="size-3" strokeWidth={4} />
                        {e.n}
                      </span>
                    ))}
                  </p>
                )}
              </div>
            </motion.div>
          )
        })}
      </div>
    </motion.div>
  )
}
