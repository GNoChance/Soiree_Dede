import type { GamePlayProps } from '../types'
import { TEAM_INFO } from '@/features/teams/teams'
import { myRole } from './logic'
import type { NdcState } from './types'

/** Squelette (Task 5) : remplacé par les écrans de jeu (Task 6). */
export default function NomDeCodePlay({ state, meId }: GamePlayProps) {
  const s = state as unknown as NdcState
  const role = myRole(s, meId)
  return (
    <div className="sticker flex flex-col gap-2 bg-surface p-4 text-center">
      <p className="font-display text-xl font-extrabold">Phase : {s.phase}</p>
      <p>{role.team ? `${role.spy ? '🕵️ Espion' : '🔎 Devineur'} · ${TEAM_INFO[role.team].emoji} ${TEAM_INFO[role.team].short}` : '👀 Tu regardes'}</p>
    </div>
  )
}
