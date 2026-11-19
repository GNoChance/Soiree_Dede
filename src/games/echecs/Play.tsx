import type { GamePlayProps } from '../types'
import { DuelPlay } from '@/features/duel/DuelPlay'
import Board from './Board'
import type { ChessBoard, ChessMove } from './types'

/** Écran de jeu : le socle duel + l'échiquier. */
export default function EchecsPlay(props: GamePlayProps) {
  return <DuelPlay<ChessBoard, ChessMove> {...props} Board={Board} myTurnHint="À toi : touche une pièce !" />
}
