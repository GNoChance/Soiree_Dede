/**
 * Animation du dernier coup : le state serveur est déjà « à jour », on rejoue
 * l'affichage — dés qui culbutent, pions qui avancent case par case, gains /
 * pertes d'argent flottants. Au premier rendu (rejoindre en cours de partie),
 * rien n'est rejoué : on affiche directement l'état courant.
 */
import { useEffect, useRef, useState } from 'react'
import { cardKeyOf } from './format'
import type { TdpState } from './types'

export const DICE_MS = 900
/** Animation 3D de pioche (soulever, retourner, face caméra) avant l'affichage de la carte. */
export const DRAW_ANIM_MS = 1900
const STEP_MS = 110
const MAX_WALK = 12

export interface MoneyFloat {
  key: string
  player: string
  amount: number
}

/** Cases à parcourir en avant (0 si trop long : le pion « saute »). */
export function walkSteps(from: number, to: number): number {
  const n = (((to - from) % 40) + 40) % 40
  return n <= MAX_WALK ? n : 0
}

/**
 * `paused` : on fige la marche des pions (carte lue à l'écran) ; `cardHoldMs` : délai
 * avant que la carte piochée soit affichée (le déplacement qu'elle cause attend la fin).
 */
export function usePlayback(s: TdpState, paused = false, cardHoldMs = 600) {
  const [shownPos, setShownPos] = useState<Record<string, number>>(s.pos)
  const [rolling, setRolling] = useState(false)
  const [floats, setFloats] = useState<MoneyFloat[]>([])
  const [prevCash, setPrevCash] = useState(s.cash)
  const initialNo = useState(() => s.last_event?.no ?? 0)[0]
  const holdUntil = useRef(0)
  const target = useRef(s.pos)
  const pausedRef = useRef(paused)
  const initialCard = useState(() => cardKeyOf(s))[0]

  // Gains / pertes : comparaison du state précédent (ajustement pendant le rendu).
  if (s.cash !== prevCash) {
    setPrevCash(s.cash)
    const add: MoneyFloat[] = []
    for (const id of Object.keys(s.cash)) {
      const d = (s.cash[id] ?? 0) - (prevCash[id] ?? s.cash[id] ?? 0)
      if (d !== 0) add.push({ key: `${s.event_no}-${id}-${d}`, player: id, amount: d })
    }
    if (add.length) setFloats((f) => [...f, ...add].slice(-12))
  }

  const dismissFloat = (key: string) => setFloats((f) => f.filter((x) => x.key !== key))

  // Nouveau lancer : dés qui roulent, les pions attendent la fin du lancer.
  const rollNo = s.last_event?.no ?? 0
  useEffect(() => {
    if (rollNo === initialNo) return
    holdUntil.current = Date.now() + DICE_MS
    const t0 = window.setTimeout(() => setRolling(true), 0)
    const t1 = window.setTimeout(() => setRolling(false), DICE_MS)
    return () => {
      clearTimeout(t0)
      clearTimeout(t1)
    }
  }, [rollNo, initialNo])

  useEffect(() => {
    pausedRef.current = paused
  }, [paused])

  // Carte piochée : les pions attendent que la carte ait été montrée.
  const cardKey = cardKeyOf(s)
  useEffect(() => {
    if (!cardKey || cardKey === initialCard) return
    holdUntil.current = Math.max(holdUntil.current, Date.now() + cardHoldMs + 400)
  }, [cardKey, initialCard, cardHoldMs])

  // Marche des pions vers leur case réelle.
  useEffect(() => {
    target.current = s.pos
  }, [s.pos])
  useEffect(() => {
    const id = window.setInterval(() => {
      if (pausedRef.current || Date.now() < holdUntil.current) return
      setShownPos((cur) => {
        let changed = false
        const next = { ...cur }
        for (const [p, t] of Object.entries(target.current)) {
          const d = cur[p]
          if (d === undefined || d === t) {
            if (d === undefined) {
              next[p] = t
              changed = true
            }
            continue
          }
          next[p] = walkSteps(d, t) > 0 ? (d + 1) % 40 : t
          changed = true
        }
        return changed ? next : cur
      })
    }, STEP_MS)
    return () => clearInterval(id)
  }, [])

  return { shownPos, rolling, floats, dismissFloat, initialNo }
}
