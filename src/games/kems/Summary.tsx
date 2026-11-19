import { motion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/cn'
import { mood, playerOrPlaceholder } from '@/features/soiree/players'
import { TEAM_INFO } from '@/features/teams/teams'
import { useTv } from '@/features/tv/tv'
import type { GameSummaryProps } from '../types'
import { RevealPanel } from './Reveal'
import type { KemsState } from './types'

/** Bloc fin de partie : équipe(s) gagnante(s), dernière révélation, bilan par équipe (Kems, contres, erreurs). */
export default function KemsSummary({ state, players }: GameSummaryProps) {
  const s = state as unknown as KemsState
  const tv = useTv()
  if (!s.teams?.length) return null
  const get = (id: string) => playerOrPlaceholder(players, id)
  const winners = s.winners ?? []
  const ranked = [...s.teams].sort((a, b) => b.score - a.score)

  return (
    <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.2 }} className="sticker flex flex-col gap-3 bg-surface p-4">
      {winners.map((w) => {
        const t = s.teams.find((x) => x.id === w)
        if (!t) return null
        return (
          <div key={w} className="flex flex-col items-center gap-2 text-center">
            <p className={cn('font-display font-extrabold', tv ? 'text-4xl' : 'text-2xl')} style={{ color: w === 'yellow' ? '#9a6b00' : TEAM_INFO[w].color }}>
              {TEAM_INFO[w].emoji} Les {TEAM_INFO[w].short} gagnent {t.score} à {Math.max(0, ...s.teams.filter((x) => x.id !== w).map((x) => x.score))} !
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {t.players.map((id) => (
                <div key={id} className="flex w-16 flex-col items-center">
                  <Avatar slug={get(id).slug} expression={mood(get(id), 'proud')} tenue={get(id).equippedTenue} size={tv ? 80 : 56} bounce />
                  <span className="w-full truncate text-xs font-extrabold">{get(id).nickname}</span>
                </div>
              ))}
            </div>
          </div>
        )
      })}

      <div className="overflow-hidden rounded-chip border-[3px] border-ink">
        <table className="w-full text-center text-sm font-bold">
          <thead className="bg-sunk text-xs">
            <tr>
              <th className="p-1.5 text-left">Équipe</th>
              <th className="p-1.5">Points</th>
              <th className="p-1.5">🤠 Kems</th>
              <th className="p-1.5">🕵️ Contres</th>
              <th className="p-1.5">😬 Erreurs</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((t) => {
              const st = s.tstats?.[t.id]
              return (
                <tr key={t.id} className="border-t-2 border-ink/20">
                  <td className="p-1.5 text-left">
                    {TEAM_INFO[t.id].emoji} {t.players.map((p) => get(p).nickname).join(' & ')}
                  </td>
                  <td className="p-1.5 font-display text-lg font-extrabold">{t.score}</td>
                  <td className="p-1.5">{st?.kems ?? 0}</td>
                  <td className="p-1.5">{st?.counters ?? 0}</td>
                  <td className="p-1.5">{st?.errors ?? 0}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {s.call && <RevealPanel s={s} call={s.call} players={players} big={tv} animate={false} />}
    </motion.div>
  )
}
