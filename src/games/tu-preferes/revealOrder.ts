import { hash01 } from '../qui-de-nous/autoTick'
import type { TpReveal, TpSide } from './types'

/** Ordre d'envol des avatars (déterministe, identique sur téléphone et télé) : alterné A / B, mélangé par manche. */
export function tpFlyOrder(lr: TpReveal): string[] {
  const shuffled = (side: TpSide) =>
    Object.keys(lr.choices)
      .filter((id) => lr.choices[id] === side)
      .sort((x, y) => hash01(`${lr.round}:${x}`) - hash01(`${lr.round}:${y}`))
  const a = shuffled('a')
  const b = shuffled('b')
  const out: string[] = []
  while (a.length || b.length) {
    if (a.length) out.push(a.shift()!)
    if (b.length) out.push(b.shift()!)
  }
  return out
}
