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
import { GEOGRAPHIE_2 } from './questions/geographie-2'
import { HISTOIRE_2 } from './questions/histoire-2'
import { SCIENCES_2 } from './questions/sciences-2'
import { SPORT_2 } from './questions/sport-2'
import { CULTURE_2 } from './questions/culture-2'
import { CORPS_HUMAIN_2 } from './questions/corps-humain-2'
import { ANIMAUX_2 } from './questions/animaux-2'
import { RECORDS_2 } from './questions/records-2'
import { QUOTIDIEN_2 } from './questions/quotidien-2'
import { ESPACE_2 } from './questions/espace-2'

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
  // Lot 2 : toujours en fin de liste (les identifiants pp0001… servent à l'historique « déjà jouées »).
  ...GEOGRAPHIE_2, ...HISTOIRE_2, ...SCIENCES_2, ...SPORT_2, ...CULTURE_2,
  ...CORPS_HUMAIN_2, ...ANIMAUX_2, ...RECORDS_2, ...QUOTIDIEN_2, ...ESPACE_2,
].map((q, i) => ({ id: `pp${String(i + 1).padStart(4, '0')}`, ...q }))
