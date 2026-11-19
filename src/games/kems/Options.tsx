import { useEffect, useMemo } from 'react'
import { useParams } from 'react-router'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { useSoiree } from '@/features/soiree/hooks'
import { TeamsPicker } from '@/features/teams/TeamsPicker'
import { distributeTeams } from '@/features/teams/teams'
import type { GameOptionsProps } from '../types'
import { KEMS_TEAM_SIZE, feasibleTeamCount, readKemsOptions } from './setup'

export function KemsOptionsPanel({ options, onChange, playerCount }: GameOptionsProps) {
  const o = readKemsOptions(options)
  const set = (patch: Record<string, unknown>) => onChange({ ...options, ...patch })
  const { id: soireeId } = useParams()
  const { data } = useSoiree(soireeId)
  const ids = useMemo(() => data?.playerIds ?? [], [data?.playerIds])

  // Première ouverture : équipes de 2 tirées au hasard (le plus d'équipes possible), puis composables à la main.
  useEffect(() => {
    if (!o.teams && ids.length) {
      const teamCount = feasibleTeamCount(ids.length)
      onChange({ ...options, teams: distributeTeams(ids, teamCount, KEMS_TEAM_SIZE), teamCount })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.length, Boolean(o.teams)])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="font-display text-lg font-extrabold">Points pour gagner</span>
        <SegmentedControl
          ariaLabel="Points pour gagner"
          value={String(o.target)}
          onChange={(v) => set({ target: Number(v) })}
          options={[
            { value: '3', label: '3 · vite fait' },
            { value: '5', label: '5 · classique' },
            { value: '7', label: '7 · long' },
          ]}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="font-display text-lg font-extrabold">Équipes de 2</span>
        <p className="text-sm text-muted">🤫 Assieds-toi en face de ton coéquipier : vous aurez un signe secret, à faire en vrai !</p>
        <TeamsPicker
          teamCount={o.teamCount}
          teams={o.teams ?? {}}
          playerIds={ids}
          teamSize={KEMS_TEAM_SIZE}
          onChange={(teams, teamCount) => onChange({ ...options, teams, teamCount })}
        />
        {playerCount < ids.length && <p className="text-sm text-muted">Les joueurs décochés plus haut ne joueront pas (équipes refaites si besoin).</p>}
        {playerCount < 4 && <p className="text-sm font-bold text-tomato">Il faut au moins 4 joueurs (2 équipes de 2).</p>}
      </div>
    </div>
  )
}
