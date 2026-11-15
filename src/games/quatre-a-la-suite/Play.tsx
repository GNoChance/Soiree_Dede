import type { GamePlayProps } from '../types'
import { DuelPlay } from '@/features/duel/DuelPlay'
import Board from './Board'
import type { Q4Board, Q4Move } from './types'

/** Écran de jeu : le socle duel + le plateau 7 × 6. */
export default function QuatreALaSuitePlay(props: GamePlayProps) {
  return <DuelPlay<Q4Board, Q4Move> {...props} Board={Board} myTurnHint="À toi : lâche un jeton !" />
}
