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
  /** Échéance de la phase en cours (ISO) : sert à envoyer sans délai en fin de préparation. */
  deadline?: string | null
}

export const BnMatchContext = createContext<BnMatchCtx | null>(null)
