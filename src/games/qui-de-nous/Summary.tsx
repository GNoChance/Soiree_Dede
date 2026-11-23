import { motion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import type { QuiDeNousState } from '@/types/db'
import { mood, playerOrPlaceholder } from '@/features/soiree/players'
import type { GameSummaryProps } from '../types'

type Hist = { round: number; question: string; counts: Record<string, number>; majority: string[]; scorers?: string[] }

/** Plus longue série de manches avec la majorité, par joueur (history[].scorers, absent sur les anciennes parties). */
function flair(history: Hist[], players: string[]): { id: string; n: number } | null {
  let best: { id: string; n: number } | null = null
  for (const id of players) {
    let run = 0
    let max = 0
    for (const h of history) {
      if (h.scorers?.includes(id)) max = Math.max(max, ++run)
      else run = 0
    }
    if (max >= 3 && (!best || max > best.n)) best = { id, n: max }
  }
  return best
}

/** Bloc fin de partie : la star, quelques moments drôles et les manches les plus unanimes. */
export default function QuiDeNousSummary({ state, players }: GameSummaryProps) {
  const s = state as unknown as QuiDeNousState
  const entries = Object.entries(s.designated ?? {}).sort((a, b) => b[1] - a[1])
  const top = entries[0]
  if (!top || top[1] === 0) return null
  const p = playerOrPlaceholder(players, top[0])
  const history = (s.history ?? []) as Hist[]

  // Les 3 manches les plus unanimes (un seul désigné, avec le plus de voix sur le total des votes).
  const highlights = history
    .map((h) => {
      const total = Object.values(h.counts ?? {}).reduce((a, b) => a + b, 0)
      const n = h.majority.length === 1 ? (h.counts[h.majority[0]] ?? 0) : 0
      return { h, n, total }
    })
    .filter((x) => x.n >= 2 && x.total > 0)
    .sort((a, b) => b.n / b.total - a.n / a.total || b.n - a.n || b.h.round - a.h.round)
    .slice(0, 3)
    .sort((a, b) => a.h.round - b.h.round)

  const fl = flair(history, s.players ?? [])
  const ids = s.players ?? []
  const low = ids.length >= 3 ? [...ids].sort((a, b) => (s.designated?.[a] ?? 0) - (s.designated?.[b] ?? 0))[0] : null
  const discreet = low && low !== top[0] && (s.designated?.[low] ?? 0) < top[1] / 2 ? low : null

  const moments: Array<{ id: string; emoji: string; title: string; detail: string; expr: 'happy' | 'proud' | 'shy' }> = []
  if (fl) moments.push({ id: fl.id, emoji: '🔮', title: 'Le flair', detail: `a suivi la majorité ${fl.n} manches d’affilée`, expr: 'proud' })
  if (discreet) {
    const n = s.designated?.[discreet] ?? 0
    moments.push({ id: discreet, emoji: '🫥', title: 'Le·la plus discret·e', detail: n === 0 ? 'n’a jamais été désigné·e' : `désigné·e seulement ${n} fois`, expr: 'shy' })
  }

  return (
    <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.2 }} className="sticker flex flex-col gap-3 bg-surface p-4">
      <div className="flex items-center gap-3">
        <Avatar slug={p.slug} expression={mood(p, 'shy')} size={60} />
        <div>
          <p className="text-sm text-muted">⭐ Le plus désigné de la soirée</p>
          <p className="font-display text-xl font-extrabold">
            {p.nickname} · désigné·e {top[1]} fois
          </p>
        </div>
      </div>
      {moments.map((m, i) => {
        const q = playerOrPlaceholder(players, m.id)
        return (
          <motion.div
            key={m.title}
            initial={{ x: -40, opacity: 0, rotate: -3 }}
            animate={{ x: 0, opacity: 1, rotate: 0 }}
            transition={{ delay: 1.4 + i * 0.15, type: 'spring', stiffness: 300, damping: 18 }}
            className="flex items-center gap-3 rounded-chip bg-sunk p-2"
          >
            <Avatar slug={q.slug} expression={mood(q, m.expr)} size={44} />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-muted">
                {m.emoji} {m.title}
              </p>
              <p className="font-display text-base leading-tight font-extrabold">
                {q.nickname} <span className="text-sm font-bold text-muted">· {m.detail}</span>
              </p>
            </div>
          </motion.div>
        )
      })}
      {highlights.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">🤝 Les manches les plus unanimes</p>
          <ul className="flex flex-col gap-2">
            {highlights.map(({ h, n, total }) => {
              const w = playerOrPlaceholder(players, h.majority[0])
              return (
                <li key={h.round} className="flex items-center gap-2 rounded-chip bg-sunk p-2">
                  <Avatar slug={w.slug} size={28} />
                  <span className="text-sm leading-snug">
                    <b>{w.nickname}</b> — {h.question} <span className="font-bold text-muted">({n}/{total})</span>
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </motion.div>
  )
}
