// Banque de dilemmes « Tu préfères ? » (contenu rempli par l'agent contenu).
import { ABSURDE } from './dilemmas/absurde'
import { QUOTIDIEN } from './dilemmas/quotidien'
import { BOUFFE } from './dilemmas/bouffe'
import { POUVOIRS } from './dilemmas/pouvoirs'
import { VOYAGE } from './dilemmas/voyage'
import { SOIREE } from './dilemmas/soiree'
import { GENANT } from './dilemmas/genant'
import { FUTUR } from './dilemmas/futur'
import { ANIMAUX } from './dilemmas/animaux'
import { POP } from './dilemmas/pop'

export type DilemmaTheme = 'absurde' | 'quotidien' | 'bouffe' | 'pouvoirs' | 'voyage' | 'soiree' | 'gênant' | 'futur' | 'animaux' | 'pop'
export interface Dilemma {
  id: string // 'tp0001'
  a: string // « avoir des mains en spaghetti »
  b: string // « des pieds en saucisse »
  theme: DilemmaTheme
}

const SOURCES: [DilemmaTheme, [string, string][]][] = [
  ['absurde', ABSURDE],
  ['quotidien', QUOTIDIEN],
  ['bouffe', BOUFFE],
  ['pouvoirs', POUVOIRS],
  ['voyage', VOYAGE],
  ['soiree', SOIREE],
  ['gênant', GENANT],
  ['futur', FUTUR],
  ['animaux', ANIMAUX],
  ['pop', POP],
]

export const DILEMMAS: Dilemma[] = SOURCES.flatMap(([theme, list]) => list.map(([a, b]) => ({ theme, a, b }))).map(
  (d, i) => ({ id: `tp${String(i + 1).padStart(4, '0')}`, ...d }),
)
