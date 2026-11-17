import type { Driver } from './engine/Game'
import { fmtTime } from './KartRace'
import type { DkState } from './types'

const MEDALS = ['🥇', '🥈', '🥉']

/** Classement d'une course (places, temps, points gagnés) + total de la coupe. */
export function Standings({ s, drivers, meId }: { s: DkState; drivers: Driver[]; meId: string }) {
  const last = s.standings[s.standings.length - 1]
  if (!last) return null
  const name = (id: string) => drivers.find((d) => d.id === id)?.name ?? '…'
  const total = [...new Set([...s.players, ...s.bots])].sort((a, b) => (s.points[b] ?? 0) - (s.points[a] ?? 0))
  return (
    <div className="flex flex-col gap-3">
      <ol className="space-y-1">
        {last.places.map((p) => (
          <li
            key={p.id}
            className={`flex items-center gap-2 rounded-chip border-2 border-ink px-3 py-1 font-bold ${p.id === meId ? 'bg-sun text-ink' : 'bg-sunk'}`}
          >
            <span className="w-7">{MEDALS[p.place - 1] ?? `${p.place}.`}</span>
            <span className="flex-1 truncate">{name(p.id)}</span>
            <span className="text-sm tabular-nums">{p.time === null ? `${p.laps} tour${p.laps > 1 ? 's' : ''}` : fmtTime(p.time / 1000)}</span>
            <span className="w-12 text-right">+{p.pts}</span>
          </li>
        ))}
      </ol>
      {s.races > 1 && (
        <div>
          <h3 className="font-display text-lg font-extrabold">Coupe · après {s.standings.length}/{s.races} courses</h3>
          <ol className="mt-1 space-y-1">
            {total.map((id, k) => (
              <li key={id} className={`flex items-center gap-2 px-1 text-sm font-bold ${id === meId ? 'text-tomato' : ''}`}>
                <span className="w-6">{k + 1}.</span>
                <span className="flex-1 truncate">{name(id)}</span>
                <span className="tabular-nums">{s.points[id] ?? 0} pts</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}
