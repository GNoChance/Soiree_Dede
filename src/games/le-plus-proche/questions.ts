// Banque « Le plus proche » : questions à réponse chiffrée (contenu rempli par l'agent contenu).
import { GEOGRAPHIE } from './questions/geographie'
import { HISTOIRE } from './questions/histoire'
import { SCIENCES } from './questions/sciences'
import { SPORT } from './questions/sport'
import { CULTURE } from './questions/culture'
import { CORPS_HUMAIN } from './questions/corps-humain'
import { ANIMAUX } from './questions/animaux'
import { RECORDS } from './questions/records'
import { QUOTIDIEN } from './questions/quotidien'
import { ESPACE } from './questions/espace'

export type CloseTheme = 'geographie' | 'histoire' | 'sciences' | 'sport' | 'culture' | 'corps-humain' | 'animaux' | 'records' | 'quotidien' | 'espace'
export interface CloseQuestion {
  id: string // 'pp0001'
  prompt: string // « Combien de marches compte la tour Eiffel jusqu’au sommet ? »
  answer: number // valeur de référence
  unit?: string // « marches », « km », « ans »… (affichée à côté du champ)
  theme: CloseTheme
  difficulty: 1 | 2 | 3
  /** Précision affichée à la révélation (source / approximation), optionnelle. */
  note?: string
}
export const CLOSE_QUESTIONS: CloseQuestion[] = [
  ...GEOGRAPHIE, ...HISTOIRE, ...SCIENCES, ...SPORT, ...CULTURE,
  ...CORPS_HUMAIN, ...ANIMAUX, ...RECORDS, ...QUOTIDIEN, ...ESPACE,
].map((q, i) => ({ id: `pp${String(i + 1).padStart(4, '0')}`, ...q }))
