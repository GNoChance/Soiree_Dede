import { createContext, useContext, useEffect, useState } from 'react'
import type { BaseGameState, GameActionPayload } from '@/games/types'

/**
 * Mode télé : vue spectateur plein écran d'un jeu (route `/soiree/:id/tele`).
 * TvPage rend le `Play` du jeu sous ce contexte pour tout jeu dont la
 * définition porte `tv: true` ; le `Play` affiche alors sa vue télé (DuelPlay
 * -> DuelTv pour les duels). Lecture seule : aucun coup, aucun pari, aucun
 * secret (`meId` = TV_VIEWER_ID, `secret` = null, seuls les ticks partent).
 */
export const TvContext = createContext(false)
export const useTv = () => useContext(TvContext)

/** Identifiant fictif du « joueur » télé : jamais joueur, jamais spectateur parieur. */
export const TV_VIEWER_ID = '00000000-0000-0000-0000-00000000007e'

/** Seules actions qu'une télé envoie : les ticks (idempotents) qui font avancer les minuteurs. */
export function readOnlyAct(act: (a: GameActionPayload) => Promise<BaseGameState | null>) {
  return (a: GameActionPayload): Promise<BaseGameState | null> => (a.type === 'tick' ? act(a) : Promise.resolve(null))
}

/** Taille de la fenêtre (px), mise à jour au redimensionnement / à la rotation. */
export function useViewport() {
  const read = () => ({ w: window.innerWidth, h: window.innerHeight })
  const [vp, setVp] = useState(read)
  useEffect(() => {
    const on = () => setVp(read())
    window.addEventListener('resize', on)
    window.addEventListener('orientationchange', on)
    return () => {
      window.removeEventListener('resize', on)
      window.removeEventListener('orientationchange', on)
    }
  }, [])
  return vp
}
