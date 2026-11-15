// Banque de catégories du Petit bac (contenu rempli par l'agent contenu).
export interface BacCategory {
  id: string // 'pays'
  label: string // 'Pays'
  emoji: string
  /** Catégorie jouable facilement avec les lettres difficiles ? (sert au tirage) */
  easy?: boolean
}
export const CATEGORIES: BacCategory[] = []
/** Lettres tirables (exclut les lettres trop dures par défaut). */
export const LETTERS: string[] = []
