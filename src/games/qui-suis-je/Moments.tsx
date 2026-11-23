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

export function QsjMoments({ state, players }: { state: GameSummaryProps['state']; players: Record<string, PlayerInfo> }) {
  const rows = ((state as unknown as { results?: Row[] | null }).results ?? []) as Row[]
  const moments: Array<Moment | null> = []
  moments.push(stat('run', '🔥', 'Meilleure série', 'proud', leaders(rows, 'best_run', 3), (v) => `${v} cartes trouvées d'affilée`))
  moments.push(stat('hard', '🧠', 'Les cartes costaudes', 'proud', leaders(rows, 'hard_found', 1), (v) => `${plural(v, 'carte')} difficile${v > 1 ? 's' : ''} devinée${v > 1 ? 's' : ''}`))
  const list = moments.filter((m): m is Moment => !!m).slice(0, 4)
  // Carte la plus passée (au moins 2 fois) : « celle qui a fait craquer tout le monde ».
  const passes: Record<string, number> = {}
  for (const turn of (state as unknown as { history?: Array<{ log?: Array<{ n: string; r: string }> }> }).history ?? [])
    for (const e of turn.log ?? []) if (e.r === 'pass') passes[e.n] = (passes[e.n] ?? 0) + 1
  const worst = Object.entries(passes).sort((a, b) => b[1] - a[1])[0]
  const stuck = worst && worst[1] >= 2 ? worst : null
  if (!list.length && !stuck) return null
  return (
    <div className="flex flex-col gap-2">
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
      {stuck && (
        <div className="flex items-center gap-3 rounded-chip bg-sunk p-2">
          <span className="flex size-12 items-center justify-center text-3xl">🧱</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-muted">La carte qui a fait craquer tout le monde</p>
            <p className="truncate font-display text-lg font-extrabold">{stuck[0]}</p>
            <p className="text-sm font-bold text-muted">passée {stuck[1]} fois, elle était pourtant là !</p>
          </div>
        </div>
      )}
    </div>
  )
}
