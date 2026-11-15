// Banque de dilemmes « Tu préfères ? » (contenu rempli par l'agent contenu).
export type DilemmaTheme = 'absurde' | 'quotidien' | 'bouffe' | 'pouvoirs' | 'voyage' | 'soiree' | 'gênant' | 'futur' | 'animaux' | 'pop'
export interface Dilemma {
  id: string // 'tp0001'
  a: string // « avoir des mains en spaghetti »
  b: string // « des pieds en saucisse »
  theme: DilemmaTheme
}
export const DILEMMAS: Dilemma[] = []
