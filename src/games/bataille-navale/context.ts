import { createContext } from 'react'
import type { BaseGameState, GameActionPayload } from '@/games/types'

/**
 * Accès du plateau à la partie (fourni par Play.tsx) : `matchId` pour relire
 * mon secret si le temps réel tarde, `act` (promesse) pour ENCHAÎNER les coups
 * de préparation (« place » puis « ready » dans cet ordre).
 */
export interface BnMatchCtx {
  matchId: string
  act: (action: GameActionPayload) => Promise<BaseGameState | null>
}

export const BnMatchContext = createContext<BnMatchCtx | null>(null)
