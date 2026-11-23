import { useEffect, useRef } from 'react'
import type { GamePlayProps } from '../types'
import { ndcActions } from './setup'

/** Qui envoie : l'hôte d'abord, les joueurs en secours, la télé en dernier recours. */
export type TickRole = 'host' | 'player' | 'tv'

/** Délai avant le 1er envoi après l'échéance : [fixe, aléa] en ms. */
const DELAY: Record<TickRole, [number, number]> = {
  host: [150, 150],
  player: [2500, 1500],
  tv: [5000, 1500],
}

/**
 * Échéance du chrono : `{"type":"tick"}` (idempotent côté serveur). Un seul téléphone l'envoie tout de suite
 * (l'hôte) ; les autres joueurs et la télé ne servent que de secours et n'envoient qu'au bout de quelques
 * secondes si rien n'a bougé (le changement de phase donne une nouvelle échéance : `timeUp` retombe et les
 * envois s'arrêtent). Ré-essai toutes les 3 à 4 s tant que la phase n'a pas changé.
 */
export function useDeadlineTick(timeUp: boolean, act: GamePlayProps['act'], role: TickRole) {
  const actRef = useRef(act)
  useEffect(() => {
    actRef.current = act
  })
  useEffect(() => {
    if (!timeUp) return
    let t = 0
    let cancelled = false
    const send = async () => {
      if (cancelled) return
      await actRef.current(ndcActions.tick())
      if (!cancelled) t = window.setTimeout(() => void send(), 3000 + Math.random() * 1000)
    }
    const [base, spread] = DELAY[role]
    t = window.setTimeout(() => void send(), base + Math.random() * spread)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [timeUp, role])
}
