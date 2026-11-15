// Banque de mots de Dessine & devine (contenu rempli par l'agent contenu).
export interface DrawWord {
  id: string // 'd0001'
  word: string // forme affichée/attendue, ex. 'tour Eiffel'
  aliases?: string[] // autres réponses acceptées
  difficulty: 1 | 2 | 3
  theme: string
}
export const WORDS: DrawWord[] = []
