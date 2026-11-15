// Banque « Le plus proche » : questions à réponse chiffrée (contenu rempli par l'agent contenu).
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
export const CLOSE_QUESTIONS: CloseQuestion[] = []
