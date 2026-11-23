import { motion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/cn'
import { mood, playerOrPlaceholder } from '@/features/soiree/players'
import type { PlayerInfo } from '../types'
import type { NdcState } from './types'

interface Moment {
  key: string
  emoji: string
  title: string
  ids: string[]
  detail: string
  expr: Parameters<typeof mood>[1]
}

type Row = { profile_id: string; stats?: Record<string, number> }

/** Joueurs en tête d'une stat (>= min). Ex æquo à 3 et plus : on masque. */
function leaders(rows: Row[], key: string, min: number): { ids: string[]; v: number } | null {
  let v = 0
  for (const r of rows) v = Math.max(v, Number(r.stats?.[key] ?? 0))
  if (v < min) return null
  const ids = rows.filter((r) => Number(r.stats?.[key] ?? 0) === v).map((r) => r.profile_id)
  return ids.length > 2 ? null : { ids, v }
}

const s_ = (n: number, w: string) => `${n} ${w}${n > 1 ? 's' : ''}`

/** « Moments de la partie » : stats déjà calculées par le serveur (state.results[].stats). */
export function NdcMoments({ s, players, tv }: { s: NdcState; players: Record<string, PlayerInfo>; tv?: boolean }) {
  const rows = (s.results ?? []) as unknown as Row[]
  const moments: Moment[] = []
  const add = (key: string, emoji: string, title: string, expr: Moment['expr'], l: { ids: string[]; v: number } | null, detail: (v: number) => string) => {
    if (l) moments.push({ key, emoji, title, ids: l.ids, detail: detail(l.v), expr })
  }
  add('clue', '🧠', 'Le plus bel indice', 'proud', leaders(rows, 'best_clue', 2), (v) => `${s_(v, 'mot')} trouvés d'un seul indice`)
  add('first', '🎯', 'Premier sur les bons mots', 'proud', leaders(rows, 'first_good', 2), (v) => `${s_(v, 'bon mot')} trouvés en premier`)
  add('gift', '🎁', "Le plus généreux envers l'adversaire", 'happy', leaders(rows, 'enemy_reveals', 1), (v) => `${s_(v, 'cadeau')} offert${v > 1 ? 's' : ''} à l'autre équipe`)
  add('bomb', '💣', 'A visé la bombe', 'shocked', leaders(rows, 'bomb_votes', 1), (v) => `${s_(v, 'vote')} pour la bombe, boum !`)
  if (!moments.length) return null
  return (
    <div className={cn('flex flex-col gap-2', tv && 'w-full max-w-xl')}>
      <p className={cn('text-center font-display font-extrabold', tv ? 'text-2xl' : 'text-lg')}>Moments de la partie ✨</p>
      {moments.slice(0, 4).map((m, i) => (
        <motion.div
          key={m.key}
          initial={{ x: -40, opacity: 0, rotate: -3 }}
          animate={{ x: 0, opacity: 1, rotate: 0 }}
          transition={{ delay: 1.4 + i * 0.15, type: 'spring', stiffness: 300, damping: 18 }}
          className="flex items-center gap-3 rounded-chip bg-sunk p-2"
        >
          <div className="flex -space-x-3">
            {m.ids.map((id) => {
              const p = playerOrPlaceholder(players, id)
              return <Avatar key={id} slug={p.slug} expression={mood(p, m.expr)} size={tv ? 64 : 48} />
            })}
          </div>
          <div className="min-w-0 flex-1">
            <p className={cn('text-muted', tv ? 'text-base' : 'text-sm')}>
              {m.emoji} {m.title}
            </p>
            <p className={cn('truncate font-display font-extrabold', tv ? 'text-2xl' : 'text-lg')}>{m.ids.map((id) => playerOrPlaceholder(players, id).nickname).join(' & ')}</p>
            <p className="text-sm font-bold text-muted">{m.detail}</p>
          </div>
        </motion.div>
      ))}
    </div>
  )
}
