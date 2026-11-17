import { createContext, useContext } from 'react'
import type { BaseGameState, GameActionPayload } from '@/games/types'

/**
 * Mode télé : vue spectateur plein écran d'un jeu en duel (route
 * `/soiree/:id/tele`). TvPage rend le `Play` du jeu sous ce contexte ; DuelPlay
 * affiche alors DuelTv au lieu de l'écran de jeu. Lecture seule : aucun coup,
 * aucun pari, aucun secret (`meId` = TV_VIEWER_ID, `secret` = null).
 */
export const DuelTvContext = createContext(false)
export const useDuelTv = () => useContext(DuelTvContext)

/** Identifiant fictif du « joueur » télé : jamais duelliste, jamais spectateur parieur. */
export const TV_VIEWER_ID = '00000000-0000-0000-0000-00000000007e'

/** Seules actions qu'une télé envoie : les ticks (idempotents) qui font avancer les minuteurs. */
export function readOnlyAct(act: (a: GameActionPayload) => Promise<BaseGameState | null>) {
  return (a: GameActionPayload): Promise<BaseGameState | null> => (a.type === 'tick' ? act(a) : Promise.resolve(null))
}

/** Le state est-il celui d'un jeu en duel (socle duel.sql) ? */
export function isDuelState(state: unknown): boolean {
  const s = state as { session?: { mode?: unknown } } | null
  return !!s && typeof s.session === 'object' && s.session !== null && typeof s.session.mode === 'string'
}
