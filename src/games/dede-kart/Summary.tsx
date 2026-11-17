import { useMemo } from 'react'
import type { GameSummaryProps } from '../types'
import { buildDrivers } from './drivers'
import { Standings } from './Standings'
import type { DkState } from './types'

/** Fin de coupe : dernière course + classement général. */
export default function KartSummary({ state, meId, players }: GameSummaryProps) {
  const s = state as unknown as DkState
  const drivers = useMemo(() => buildDrivers(s.players ?? [], s.bots ?? [], players), [s.players, s.bots, players])
  const top = Object.entries(s.hits ?? {}).sort((a, b) => b[1] - a[1])[0]
  const sniper = top && top[1] > 0 ? { name: drivers.find((d) => d.id === top[0])?.name ?? '…', n: top[1] } : null
  if (!s.standings?.length) return null
  return (
    <div className="sticker flex flex-col gap-2 bg-surface p-4">
      {s.forced && <p className="text-sm font-bold text-muted">Coupe arrêtée avant la fin.</p>}
      {sniper && (
        <p className="font-bold">
          🎯 Meilleur tireur : {sniper.name} ({sniper.n} touche{sniper.n > 1 ? 's' : ''})
        </p>
      )}
      <h3 className="font-display text-xl font-extrabold">🏎️ Dernière course</h3>
      <Standings s={s} drivers={drivers} meId={meId} />
    </div>
  )
}
