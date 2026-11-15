// Banque « Action ou vérité » (contenu rempli par l'agent contenu), tout public.
export interface TruthDareCard {
  id: string // 'av0001'
  kind: 'action' | 'verite'
  level: 1 | 2 | 3 // 1 soft, 2 fun, 3 osé (mais tout public)
  text: string
}
import { ACTION_1 } from './cards/action-1'
import { ACTION_2 } from './cards/action-2'
import { ACTION_3 } from './cards/action-3'
import { VERITE_1 } from './cards/verite-1'
import { VERITE_2 } from './cards/verite-2'
import { VERITE_3 } from './cards/verite-3'

const groups: Array<[TruthDareCard['kind'], TruthDareCard['level'], string[]]> = [
  ['action', 1, ACTION_1],
  ['action', 2, ACTION_2],
  ['action', 3, ACTION_3],
  ['verite', 1, VERITE_1],
  ['verite', 2, VERITE_2],
  ['verite', 3, VERITE_3],
]

export const TD_CARDS: TruthDareCard[] = groups
  .flatMap(([kind, level, texts]) => texts.map((text) => ({ kind, level, text })))
  .map((c, i) => ({ id: 'av' + String(i + 1).padStart(4, '0'), ...c }))
