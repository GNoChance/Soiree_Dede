/**
 * Web Worker du mode solo : calcule le coup du bot (4 à la suite, Échecs) hors du fil
 * principal pour ne jamais figer l'écran. Chaque bot plafonne lui-même son temps (~0,9 s).
 */
import { chooseMove as q4Move } from '@/games/quatre-a-la-suite/bot'
import { chooseMove as chessMove } from '@/games/echecs/bot'
import type { Q4Board } from '@/games/quatre-a-la-suite/types'
import type { ChessBoard } from '@/games/echecs/types'

export interface BotJob {
  id: number
  game: 'quatre-a-la-suite' | 'echecs'
  board: unknown
  me: string
  level: number
}

const ctx = self as unknown as { onmessage: ((e: MessageEvent<BotJob>) => void) | null; postMessage: (m: unknown) => void }

ctx.onmessage = (e) => {
  const { id, game, board, me, level } = e.data
  try {
    const move = game === 'echecs' ? chessMove(board as ChessBoard, me, level) : q4Move(board as Q4Board, me, level)
    ctx.postMessage({ id, move })
  } catch (err) {
    ctx.postMessage({ id, error: String((err as Error)?.message ?? err) })
  }
}
