import { useCallback, useRef, useState } from 'react'
import { serverNow } from '@/features/soiree/useServerClock'
import type { GameActionPayload } from '@/games/types'

/**
 * Partie locale d'un jeu : le state vit ici (rien au serveur) et `act` applique l'action avec le
 * moteur local du jeu. Même contrat que `act` de GamePlayProps : renvoie le nouveau state, ou null
 * si l'action est refusée (le moteur lève une Error, comme le serveur lèverait une exception).
 */
export function useLocalMatch<S>(init: () => S, reduce: (s: S, a: GameActionPayload, now: number) => S) {
  const [state, setState] = useState<S>(init)
  const ref = useRef(state)
  const act = useCallback(
    async (a: GameActionPayload): Promise<S | null> => {
      try {
        const next = reduce(ref.current, a, serverNow())
        if (next !== ref.current) {
          ref.current = next
          setState(next)
        }
        return next
      } catch (e) {
        console.warn('[entrainement] action refusée', a.type, e)
        return null
      }
    },
    [reduce],
  )
  return [state, act] as const
}
