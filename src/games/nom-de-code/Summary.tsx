import { motion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { mood, playerOrPlaceholder } from '@/features/soiree/players'
import { TEAM_INFO } from '@/features/teams/teams'
import type { GameSummaryProps } from '../types'
import type { NdcState } from './types'

/** Bloc fin de partie : équipe(s) gagnante(s) et score des manches. */
export default function NomDeCodeSummary({ state, players }: GameSummaryProps) {
  const s = state as unknown as NdcState
  if (!s.teams?.length) return null
  const winners = s.winners ?? (s.round_winner ? [s.round_winner] : [])
  const get = (id: string) => playerOrPlaceholder(players, id)
  return (
    <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.2 }} className="sticker flex flex-col gap-3 bg-surface p-4">
      {winners.map((w) => {
        const t = s.teams.find((x) => x.id === w)
        if (!t) return null
        return (
          <div key={w} className="flex flex-col items-center gap-2 text-center">
            <p className="font-display text-2xl font-extrabold" style={{ color: TEAM_INFO[w].color }}>
              {TEAM_INFO[w].emoji} Les {TEAM_INFO[w].short} gagnent !
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {t.players.map((id) => (
                <div key={id} className="flex w-16 flex-col items-center">
                  <Avatar slug={get(id).slug} expression={mood(get(id), 'proud')} tenue={get(id).equippedTenue} size={52} />
                  <span className="w-full truncate text-xs font-extrabold">{get(id).nickname}</span>
                </div>
              ))}
            </div>
          </div>
        )
      })}
      {s.total_rounds > 1 && (
        <div className="flex flex-wrap justify-center gap-2">
          {s.teams.map((t) => (
            <span key={t.id} className="sticker-sm rounded-full px-3 py-1 font-display font-extrabold" style={{ backgroundColor: TEAM_INFO[t.id].soft, color: '#1f1b2e' }}>
              {TEAM_INFO[t.id].emoji} {s.round_wins[t.id] ?? 0} manche{(s.round_wins[t.id] ?? 0) > 1 ? 's' : ''}
            </span>
          ))}
        </div>
      )}
    </motion.div>
  )
}
