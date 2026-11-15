import type { GamePlayProps } from '../types'
import { DuelPlay } from '@/features/duel/DuelPlay'
import Board from './Board'
import { symEmoji } from './Mark'
import { symOf, turnHint } from './logic'
import { useTouch } from './pointer'
import type { MorpionBoard, MorpionMove, MorpionState } from './types'

/** Écran de jeu : le socle duel + le plateau du Morpion (classique, géant ou ultime). */
export default function MorpionPlay(props: GamePlayProps) {
  const touch = useTouch(false) // stable : ne décale pas le plateau entre deux touchers
  const b = (props.state as unknown as MorpionState).board
  // Bandeau « À toi » (toujours à l'écran, au-dessus du plateau) : annonce le double toucher en tactile.
  const hint = b ? turnHint(b, symEmoji(symOf(b, props.meId)), touch) : undefined
  return <DuelPlay<MorpionBoard, MorpionMove> {...props} Board={Board} myTurnHint={hint} />
}
