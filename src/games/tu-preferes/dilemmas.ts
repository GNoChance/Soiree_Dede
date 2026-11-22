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
import { ABSURDE_2 } from './dilemmas/absurde-2'
import { QUOTIDIEN_2 } from './dilemmas/quotidien-2'
import { BOUFFE_2 } from './dilemmas/bouffe-2'
import { POUVOIRS_2 } from './dilemmas/pouvoirs-2'
import { VOYAGE_2 } from './dilemmas/voyage-2'
import { SOIREE_2 } from './dilemmas/soiree-2'
import { GENANT_2 } from './dilemmas/genant-2'
import { FUTUR_2 } from './dilemmas/futur-2'
import { ANIMAUX_2 } from './dilemmas/animaux-2'
import { POP_2 } from './dilemmas/pop-2'

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
  // Lot 2 : toujours APRÈS les lots 1, les ids (tp0001…) sont positionnels.
  ['absurde', ABSURDE_2],
  ['quotidien', QUOTIDIEN_2],
  ['bouffe', BOUFFE_2],
  ['pouvoirs', POUVOIRS_2],
  ['voyage', VOYAGE_2],
  ['soiree', SOIREE_2],
  ['gênant', GENANT_2],
  ['futur', FUTUR_2],
  ['animaux', ANIMAUX_2],
  ['pop', POP_2],
]

export const DILEMMAS: Dilemma[] = SOURCES.flatMap(([theme, list]) => list.map(([a, b]) => ({ theme, a, b }))).map(
  (d, i) => ({ id: `tp${String(i + 1).padStart(4, '0')}`, ...d }),
)
