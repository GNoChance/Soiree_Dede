/**
 * « Le Grand Plateau de Dédé » : boucle de 24 cases autour d'une grille 7 × 7.
 * Le TYPE de chaque case est dupliqué avec `_dp_board()` (supabase/games/dede-party.sql) :
 * synchro vérifiée par tools/sql-tests/dede-party.mjs. Noms et positions à l'écran : front seulement.
 */

export type CellType = 'start' | 'clap' | 'pub' | 'env' | 'loge'

export const CELLS: CellType[] = ['start', 'clap', 'loge', 'pub', 'clap', 'env', 'loge', 'clap', 'clap', 'pub', 'loge', 'env', 'clap', 'loge', 'clap', 'pub', 'env', 'clap', 'loge', 'clap', 'pub', 'env', 'loge', 'clap']

export const STAR_PRICE = 20
export const HALF_PRICE = 10

export interface CellInfo {
  label: string
  emoji: string
  /** Fond de la case (vif, lisible en clair comme en sombre : texte sombre dessus). */
  color: string
  /** Effet en une phrase (aide). */
  effect: string
}

export const CELL_INFO: Record<CellType, CellInfo> = {
  start: { label: 'Départ', emoji: '🎬', color: '#FFB703', effect: '+5 pièces à chaque passage' },
  clap: { label: 'Applaudissements', emoji: '👏', color: '#06D6A0', effect: '+3 pièces' },
  pub: { label: 'Page de pub', emoji: '📺', color: '#EF476F', effect: '−3 pièces' },
  env: { label: 'Enveloppe surprise', emoji: '✉️', color: '#8B5CF6', effect: 'Dédé tire une carte' },
  loge: { label: 'Loge', emoji: '✨', color: '#4CC9F0', effect: 'L’étoile s’y installe (20 pièces)' },
}

/** Position (colonne, ligne) de la case i sur le pourtour de la grille 7 × 7 (départ en bas à gauche, sens horaire). */
export function cellXY(i: number): { col: number; row: number } {
  const k = ((i % 24) + 24) % 24
  if (k <= 6) return { col: 0, row: 6 - k } // colonne de gauche, en montant
  if (k <= 12) return { col: k - 6, row: 0 } // ligne du haut, vers la droite
  if (k <= 18) return { col: 6, row: k - 12 } // colonne de droite, en descendant
  return { col: 24 - k, row: 6 } // ligne du bas, vers la gauche
}

export const GRID = 7
