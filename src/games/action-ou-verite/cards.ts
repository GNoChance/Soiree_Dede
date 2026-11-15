// Banque « Action ou vérité » (contenu rempli par l'agent contenu), tout public.
export interface TruthDareCard {
  id: string // 'av0001'
  kind: 'action' | 'verite'
  level: 1 | 2 | 3 // 1 soft, 2 fun, 3 osé (mais tout public)
  text: string
}
export const TD_CARDS: TruthDareCard[] = []
