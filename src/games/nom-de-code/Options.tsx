import { useEffect, useMemo } from 'react'
import { useParams } from 'react-router'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { useSoiree } from '@/features/soiree/hooks'
import { TeamsPicker } from '@/features/teams/TeamsPicker'
import { distributeTeams } from '@/features/teams/teams'
import type { GameOptionsProps } from '../types'
import { readNdcOptions } from './setup'

export function NdcOptionsPanel({ options, onChange, playingIds }: GameOptionsProps) {
  const o = readNdcOptions(options)
  const set = (patch: Record<string, unknown>) => onChange({ ...options, ...patch })
  const { id: soireeId } = useParams()
  // Seuls les joueurs retenus (cochés dans « Qui joue ? ») sont proposés ; sans cette info, tous ceux de la soirée.
  const { data } = useSoiree(playingIds ? undefined : soireeId)
  const ids = useMemo(() => playingIds ?? data?.playerIds ?? [], [playingIds, data?.playerIds])

  // Première ouverture : équipes tirées au hasard (puis composables à la main).
  useEffect(() => {
    if (!o.teams && ids.length) onChange({ ...options, teams: distributeTeams(ids, o.teamCount) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.length, Boolean(o.teams)])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="font-display text-lg font-extrabold">Manches</span>
        <SegmentedControl
          ariaLabel="Nombre de manches"
          value={o.rounds}
          onChange={(v) => set({ rounds: v })}
          options={[
            { value: 'one', label: '1 manche' },
            { value: 'each', label: 'Chacun son tour d’espion' },
          ]}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="font-display text-lg font-extrabold">Chrono</span>
        <SegmentedControl
          ariaLabel="Chrono"
          value={o.timer}
          onChange={(v) => set({ timer: v })}
          options={[
            { value: 'relaxed', label: '😌 Détendu' },
            { value: 'normal', label: '⏱️ Normal' },
            { value: 'fast', label: '⚡ Rapide' },
          ]}
        />
        <p className="text-sm text-muted">
          {o.timer === 'relaxed' ? 'On prend son temps (5 min max par phase, le chrono n’apparaît qu’à la dernière minute).' : o.timer === 'fast' ? '1 min pour l’indice, 2 min pour deviner.' : '2 min pour l’indice, 3 min pour deviner.'}
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="font-display text-lg font-extrabold">Équipes</span>
        <TeamsPicker
          teamCount={o.teamCount}
          teams={o.teams ?? {}}
          playerIds={ids}
          onChange={(teams, teamCount) => onChange({ ...options, teams, teamCount })}
        />
      </div>
    </div>
  )
}
