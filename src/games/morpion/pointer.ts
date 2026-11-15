import { useSyncExternalStore } from 'react'

/**
 * Le joueur utilise-t-il un écran tactile (ou un stylet) ? Sert aux consignes :
 * en géant / ultime, au doigt, un premier toucher vise et un second joue, alors
 * qu'à la souris un clic suffit. Valeur = dernier pointeur réellement utilisé sur
 * le plateau (notePointer), sinon la media query `(pointer: coarse)`.
 * Partagé entre le bandeau « À toi » (Play) et le plateau (Board).
 */
let last: boolean | null = null
const subs = new Set<() => void>()

const coarseQuery = (): MediaQueryList | null =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(pointer: coarse)') : null

/** À appeler sur chaque pointerdown du plateau (e.pointerType). */
export function notePointer(pointerType: string) {
  const touch = pointerType !== 'mouse'
  if (touch === last) return
  last = touch
  subs.forEach((f) => f())
}

function subscribe(cb: () => void) {
  subs.add(cb)
  const mq = coarseQuery()
  mq?.addEventListener?.('change', cb)
  return () => {
    subs.delete(cb)
    mq?.removeEventListener?.('change', cb)
  }
}

const coarse = (): boolean => coarseQuery()?.matches ?? false
const lastOrCoarse = (): boolean => last ?? coarse()

/**
 * `followPointer` = false : media query seule, stable pendant le tour. À utiliser
 * pour un texte placé AU-DESSUS du plateau (bandeau « À toi ») : s'il changeait au
 * premier toucher (appareil hybride), son retour à la ligne décalerait le plateau
 * entre le toucher qui vise et celui qui joue.
 */
export function useTouch(followPointer = true): boolean {
  return useSyncExternalStore(subscribe, followPointer ? lastOrCoarse : coarse, () => false)
}
