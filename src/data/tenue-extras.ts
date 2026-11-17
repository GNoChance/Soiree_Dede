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

const LABELS: Record<string, { label: string; emoji: string }[]> = {
  'kevin/croupier': [{ label: 'Pluie de jetons', emoji: '🎰' }, { label: 'Bienvenue au casino', emoji: '🙌' }],
  'marius/admiral': [{ label: 'Victoire en mer', emoji: '🎉' }, { label: 'Jumelles !', emoji: '🔭' }],
  'marius/tycoon': [{ label: 'Jackpot', emoji: '💰' }, { label: 'Bonne main', emoji: '🃏' }],
  'marius/star': [{ label: 'Yeux étoilés', emoji: '🤩' }, { label: 'Sous les projecteurs', emoji: '🎤' }],
  'marius/spy': [{ label: 'Oreillette', emoji: '🎧' }, { label: 'Top secret', emoji: '📁' }],
  'marius/croupier': [{ label: 'Gros gain', emoji: '🎉' }, { label: 'Cartes en main', emoji: '🃏' }],
  'marius/teacher': [{ label: 'Le nez dans les livres', emoji: '📚' }, { label: 'Au tableau', emoji: '🧪' }],
  'marius/student': [{ label: 'Hourra, les vacances', emoji: '🎒' }, { label: 'A+ !', emoji: '💯' }],
  'marius/painter': [{ label: 'Éclaboussures', emoji: '🎨' }, { label: 'Chef-d\'œuvre', emoji: '🖼️' }],
  'marius/werewolf': [{ label: 'Pattes de loup', emoji: '🐾' }, { label: 'Grand saut', emoji: '🌲' }],
  'marius/pyro': [{ label: 'Feu d\'artifice', emoji: '🎆' }, { label: 'Étincelle', emoji: '✨' }],
}

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
