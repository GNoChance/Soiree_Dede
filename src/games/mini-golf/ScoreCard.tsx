import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/cn'
import { playerOrPlaceholder } from '@/features/soiree/players'
import type { PlayerInfo } from '../types'
import { holeById } from './holes'
import { MARK_CLASS, markOf, ranking } from './logic'
import type { MiniGolfState } from './types'

/**
 * Carte de score : un joueur par ligne (classés), un trou par colonne, case colorée selon le par
 * (vert sous le par, blanc dans le par, rouge au-dessus ; par + 4 au moins = balle ramassée, 7 sur un par 2 à 4).
 */
export function ScoreCard({ s, players, meId, current, big }: { s: MiniGolfState; players: Record<string, PlayerInfo>; meId?: string; current?: number; big?: boolean }) {
  const rows = ranking(s)
  const n = s.holes.length
  const parTotal = s.pars.reduce((a, b) => a + b, 0)
  const cell = big ? 'min-w-11 px-1 py-1.5 text-xl' : 'min-w-6.5 px-0.5 py-1 text-sm'
  return (
    <div className="overflow-x-auto rounded-chip border-[3px] border-ink [scrollbar-width:none]">
      <table className={cn('w-full border-collapse text-center font-bold tabular-nums', big ? 'text-lg' : 'text-xs')}>
        <thead className="bg-sunk">
          <tr>
            <th className="sticky left-0 bg-sunk p-1 text-left">Trou</th>
            {s.holes.map((id, i) => (
              <th key={i} title={holeById(id).name} className={cn(cell, 'font-display font-extrabold', i === current && 'bg-sun text-[#1f1b2e]')}>
                {i + 1}
              </th>
            ))}
            <th className={cn(cell, 'font-display')}>Tot.</th>
          </tr>
          <tr className="text-muted">
            <th className="sticky left-0 bg-sunk p-1 text-left font-bold">par</th>
            {s.pars.map((p, i) => (
              <th key={i} className="font-bold">
                {p}
              </th>
            ))}
            <th className="font-bold">{parTotal}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const pl = playerOrPlaceholder(players, r.id)
            const card = s.cards?.[r.id] ?? []
            return (
              <tr key={r.id} className={cn('border-t-2 border-ink/20', r.id === meId && 'bg-sun/25')}>
                <td className="sticky left-0 z-10 bg-surface p-1 text-left">
                  <span className="flex items-center gap-1">
                    <span className="w-4 text-center font-display">{r.rank}</span>
                    <Avatar slug={pl.slug} tenue={pl.equippedTenue} size={big ? 40 : 22} />
                    <span className={cn('truncate', big ? 'max-w-40' : 'max-w-16')}>{pl.nickname}</span>
                  </span>
                </td>
                {Array.from({ length: n }, (_, i) => {
                  const v = card[i]
                  return (
                    <td key={i} className={cn(cell, 'border-l border-ink/15', i === current && 'outline-2 -outline-offset-2 outline-sun')}>
                      {v !== undefined ? (
                        <span className={cn('inline-flex min-w-5 items-center justify-center rounded-full border-2 border-ink px-1 leading-tight', MARK_CLASS[markOf(v, s.pars[i])])}>{v}</span>
                      ) : (
                        <span className="text-muted">·</span>
                      )}
                    </td>
                  )
                })}
                <td className={cn(cell, 'border-l-2 border-ink/40 font-display font-extrabold')}>{r.total}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
