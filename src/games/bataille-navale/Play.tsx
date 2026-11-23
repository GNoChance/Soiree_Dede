import { useMemo } from 'react'
import type { GamePlayProps } from '../types'
import { DuelPlay } from '@/features/duel/DuelPlay'
import Board from './Board'
import { BnMatchContext } from './context'
import type { BnBoard, BnMove } from './types'

/** Écran de jeu : le socle duel + le plateau de bataille navale (préparation 60 s, puis tirs). */
export default function BatailleNavalePlay(props: GamePlayProps) {
  const { matchId, act } = props
  const deadline = (props.state as { deadline?: string | null }).deadline ?? null
  const ctx = useMemo(() => ({ matchId, act, deadline }), [matchId, act, deadline])
  return (
    <BnMatchContext.Provider value={ctx}>
      <DuelPlay<BnBoard, BnMove>
        {...props}
        Board={Board}
        myTurnHint="À toi : vise et fais feu ! 🎯"
        setupHint="Place ta flotte en secret, puis « Prêt ! » ⚓"
      />
    </BnMatchContext.Provider>
  )
}
