import { useSyncExternalStore } from 'react'
import type { GamePlayProps } from '../types'
import { DuelPlay } from '@/features/duel/DuelPlay'
import Board from './Board'
import type { Q4Board, Q4Move } from './types'

const coarse = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
const subscribe = (cb: () => void) => {
  const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(pointer: coarse)') : null
  mq?.addEventListener?.('change', cb)
  return () => mq?.removeEventListener?.('change', cb)
}

/** Écran de jeu : le socle duel + le plateau 7 × 6. */
export default function QuatreALaSuitePlay(props: GamePlayProps) {
  const touch = useSyncExternalStore(subscribe, coarse, () => false)
  const hint = touch ? 'Touche une colonne, puis retouche-la pour lâcher ton jeton' : 'À toi : clique une colonne pour lâcher un jeton !'
  return <DuelPlay<Q4Board, Q4Move> {...props} Board={Board} myTurnHint={hint} />
}
