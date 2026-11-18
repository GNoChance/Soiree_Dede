import type { BaseGameState, GameActionPayload } from '@/games/types'

/**
 * Spectateur = quelqu'un qui regarde une partie sans y jouer : ni hôte, ni dans `state.players`
 * (liste que le serveur utilise aussi pour refuser les actions : `not_in_match`).
 * Sans `players` (état inattendu), on ne présume rien : faux.
 */
export function useSpectator(state: BaseGameState | undefined, meId: string, isHost: boolean): boolean {
  if (!state || isHost || !meId) return false
  const players = (state as { players?: unknown }).players
  return Array.isArray(players) && !players.includes(meId)
}

/**
 * `act` d'un spectateur : n'envoie RIEN, pas même les `tick` (le serveur les refuse à un non-joueur) ;
 * aucune erreur, aucun toast. Les minuteurs avancent grâce aux joueurs et à l'hôte.
 */
export const readOnlyAct: (a: GameActionPayload) => Promise<BaseGameState | null> = () => Promise.resolve(null)
