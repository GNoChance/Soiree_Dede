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

export function PdbMoments({ state, players }: { state: GameSummaryProps['state']; players: Record<string, PlayerInfo> }) {
  const rows = ((state as unknown as { results?: Row[] | null }).results ?? []) as Row[]
  const moments: Array<Moment | null> = []
  moments.push(stat('den', '🚨', 'Roi des dénonciations', 'sly', leaders(rows, 'denounces', 1), (v) => `${plural(v, 'dénonciation')}, rien ne lui échappe`))
  moments.push(stat('big', '📚', "Plus gros tas pioché d'un coup", 'shocked', leaders(rows, 'big_draw', 4), (v) => `${v} cartes d'un seul coup, aïe !`))
  moments.push(stat('inf', '😈', 'A fait piocher le plus', 'sly', leaders(rows, 'inflicted', 3), (v) => `${plural(v, 'carte')} refilée${v > 1 ? 's' : ''} aux autres`))
  moments.push(stat('hand', '🃏', 'La main la plus chargée', 'sad', leaders(rows, 'max_hand', 8), (v) => `${v} cartes en main au pire moment`))
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
