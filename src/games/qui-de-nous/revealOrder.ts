import type { QuiDeNousState } from '@/types/db'
import { hash01 } from './autoTick'

type Reveal = NonNullable<QuiDeNousState['last_reveal']>

/**
 * Ordre de dépouillement (déterministe, identique sur téléphone et télé) : d'abord les joueurs
 * les moins désignés, la majorité en dernier (suspense).
 */
export function qdnSequence(lr: Reveal) {
  return Object.entries(lr.votes)
    .map(([voter, target]) => ({ voter, target, w: (lr.counts[target] ?? 0) + hash01(`${lr.round}:${voter}`) * 0.5 }))
    .sort((a, b) => a.w - b.w)
}
