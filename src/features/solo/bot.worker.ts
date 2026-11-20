/**
 * Web Worker du mode solo : calcule hors du fil principal, pour ne jamais figer l'écran,
 * le coup du bot (4 à la suite, Échecs) et l'analyse de fin de partie (tâche `why`).
 * Chaque calcul plafonne lui-même son temps.
 */
import { decide as q4Decide } from '@/games/quatre-a-la-suite/bot'
import { decide as chessDecide } from '@/games/echecs/bot'
import { why as q4Why } from '@/games/quatre-a-la-suite/why'
import { why as chessWhy } from '@/games/echecs/why'
import type { Q4Board } from '@/games/quatre-a-la-suite/types'
import type { ChessBoard } from '@/games/echecs/types'
import type { Side, SoloLog } from './log'

export type WorkerGame = 'quatre-a-la-suite' | 'echecs'

export type BotJob =
  | { id: number; kind?: 'move'; game: WorkerGame; board: unknown; me: string; level: number; hints?: unknown }
  | { id: number; kind: 'why'; game: WorkerGame; log: SoloLog; loser: Side; budget: number }

export type BotJobInput = BotJob extends infer J ? (J extends unknown ? Omit<J, 'id'> : never) : never

const ctx = self as unknown as { onmessage: ((e: MessageEvent<BotJob>) => void) | null; postMessage: (m: unknown) => void }

ctx.onmessage = (e) => {
  const job = e.data
  try {
    if (job.kind === 'why') {
      const w = job.game === 'echecs' ? chessWhy : q4Why
      ctx.postMessage({ id: job.id, moments: w.findMoments(job.log, job.loser, job.budget) })
      return
    }
    const r =
      job.game === 'echecs'
        ? chessDecide(job.board as ChessBoard, job.me, job.level, Math.random, 900, job.hints as never)
        : q4Decide(job.board as Q4Board, job.me, job.level, Math.random, 900, job.hints as never)
    ctx.postMessage({ id: job.id, ...r })
  } catch (err) {
    ctx.postMessage({ id: job.id, error: String((err as Error)?.message ?? err) })
  }
}
