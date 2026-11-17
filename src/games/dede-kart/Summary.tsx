import { useMemo } from 'react'
import type { GameSummaryProps } from '../types'
import { buildDrivers } from './drivers'
import { Standings } from './Standings'
import type { DkState } from './types'

/** Fin de coupe : dernière course + classement général. */
export default function KartSummary({ state, meId, players }: GameSummaryProps) {
  const s = state as unknown as DkState
  const drivers = useMemo(() => buildDrivers(s.players ?? [], s.bots ?? [], players), [s.players, s.bots, players])
  if (!s.standings?.length) return null
  return (
    <div className="sticker flex flex-col gap-2 bg-surface p-4">
      {s.forced && <p className="text-sm font-bold text-muted">Coupe arrêtée avant la fin.</p>}
      <h3 className="font-display text-xl font-extrabold">🏎️ Dernière course</h3>
      <Standings s={s} drivers={drivers} meId={meId} />
    </div>
  )
}
