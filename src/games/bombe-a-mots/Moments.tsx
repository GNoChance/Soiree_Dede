import { motion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { mood, playerOrPlaceholder } from '@/features/soiree/players'
import type { GameSummaryProps, PlayerInfo } from '../types'

type Mood = Parameters<typeof mood>[1]
interface Moment {
  key: string
  emoji: string
  title: string
  ids: string[]
  detail: string
  expr: Mood
}
type Row = { profile_id: string; stats?: Record<string, number> }
type Lead = { ids: string[]; v: number } | null

/** Joueurs en tête d'une stat (>= min). Ex æquo à 3 et plus : on masque. */
export function leaders(rows: Row[], key: string, min: number): Lead {
  let v = 0
  for (const r of rows) v = Math.max(v, Number(r.stats?.[key] ?? 0))
  if (v < min) return null
  const ids = rows.filter((r) => Number(r.stats?.[key] ?? 0) === v).map((r) => r.profile_id)
  return ids.length > 2 ? null : { ids, v }
}

export const plural = (n: number, w: string) => `${n} ${w}${n > 1 ? 's' : ''}`

export function stat(key: string, emoji: string, title: string, expr: Mood, l: Lead, detail: (v: number) => string): Moment | null {
  return l ? { key, emoji, title, ids: l.ids, detail: detail(l.v), expr } : null
}

export function BamMoments({ state, players }: { state: GameSummaryProps['state']; players: Record<string, PlayerInfo> }) {
  const rows = ((state as unknown as { results?: Row[] | null }).results ?? []) as Row[]
  const moments: Array<Moment | null> = []
  moments.push(stat('close', '😅', 'La plus belle sauvée', 'shocked', leaders(rows, 'close_calls', 1), (v) => `${plural(v, 'mot')} trouvé${v > 1 ? 's' : ''} à la toute dernière seconde`))
  moments.push(stat('fast', '⚡', 'Le plus rapide', 'proud', leaders(rows, 'fast_words', 1), (v) => `${plural(v, 'mot')} éclair`))
  moments.push(stat('dbl', '💥', 'Double boum', 'sad', leaders(rows, 'double_boom', 1), (v) => (v > 1 ? `Deux explosions d'affilée, ${v} fois : pas de chance !` : "Deux explosions d'affilée, pas de chance !")))
  const list = moments.filter((m): m is Moment => !!m).slice(0, 4)
  if (!list.length) return null
  return (
    <div className="sticker flex flex-col gap-2 bg-surface p-3">
      <p className="font-display text-lg font-extrabold">Moments de la partie ✨</p>
      {list.map((m, i) => (
        <motion.div
          key={m.key}
          initial={{ x: -40, opacity: 0, rotate: -3 }}
          animate={{ x: 0, opacity: 1, rotate: 0 }}
          transition={{ delay: 1.2 + i * 0.15, type: 'spring', stiffness: 300, damping: 18 }}
          className="flex items-center gap-3 rounded-chip bg-sunk p-2"
        >
          <div className="flex -space-x-3">
            {m.ids.map((id) => {
              const p = playerOrPlaceholder(players, id)
              return <Avatar key={id} slug={p.slug} expression={mood(p, m.expr)} size={48} />
            })}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-muted">
              {m.emoji} {m.title}
            </p>
            <p className="truncate font-display text-lg font-extrabold">{m.ids.map((id) => playerOrPlaceholder(players, id).nickname).join(' & ')}</p>
            <p className="text-sm font-bold text-muted">{m.detail}</p>
          </div>
        </motion.div>
      ))}
    </div>
  )
}
