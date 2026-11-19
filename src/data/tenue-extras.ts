import { TENUE_EXTRAS } from '@/data/tenues-art.generated'

/**
 * Stickers « bonus » : ceux d'une planche de tenue qui ne correspondent à aucune des 12 expressions
 * standard (ils font le charme de chaque perso). Fichiers `public/chibis/<slug>/<dossier>/extra<N>.webp`,
 * nombre dans `TENUE_EXTRAS` (généré). Ils sont équipables comme avatar tant que la tenue est portée
 * (ids `extra1`, `extra2`… envoyés à `equip_expression`). Libellés : clé `slug/dossier`, dans l'ordre extra1, extra2…
 */
export interface TenueExtra {
  id: string
  label: string
  emoji: string
}

// Libellés des stickers bonus, clé `slug/dossier` (aucune planche V3 n'en a pour l'instant).
const LABELS: Record<string, { label: string; emoji: string }[]> = {}

/** Stickers bonus disponibles pour ce perso dans ce dossier d'illustrations (vide si aucun). */
export function tenueExtrasOf(slug: string, dir: string): TenueExtra[] {
  const key = `${slug}/${dir}`
  const n = TENUE_EXTRAS[key] ?? 0
  return Array.from({ length: n }, (_, i) => ({
    id: `extra${i + 1}`,
    label: LABELS[key]?.[i]?.label ?? `Bonus ${i + 1}`,
    emoji: LABELS[key]?.[i]?.emoji ?? '✨',
  }))
}

export const isExtraId = (id: string | null | undefined): boolean => /^extra\d+$/.test(id ?? '')
