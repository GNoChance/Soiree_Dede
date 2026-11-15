/**
 * Logique pure de « Pas de bol ! » côté front (sans React) : méta des couleurs
 * et des cartes perso, jouabilité (miroir de _pdb_playable en SQL), actions.
 */
import type { PdbAction, PdbCard, PdbColor, PdbState, PersoSlug } from './types'

export const PDB_COLORS: PdbColor[] = ['tomate', 'soleil', 'menthe', 'ciel']

export const COLOR_META: Record<PdbColor, { label: string; hex: string; dark: string; text: string }> = {
  tomate: { label: 'Tomate', hex: '#EF476F', dark: '#B8264B', text: '#ffffff' },
  soleil: { label: 'Soleil', hex: '#FFB703', dark: '#C98A00', text: '#1f1b2e' },
  menthe: { label: 'Menthe', hex: '#06D6A0', dark: '#04A077', text: '#1f1b2e' },
  ciel: { label: 'Ciel', hex: '#4CC9F0', dark: '#1F97BD', text: '#1f1b2e' },
}

export interface PersoMeta {
  slug: PersoSlug
  name: string
  title: string
  emoji: string
  /** Expression du chibi sur la carte (existe pour ce perso, cf. characters.ts). */
  expression: string
  effect: string
  needsColor?: boolean
  needsTarget?: boolean
}

export const PERSOS: Record<PersoSlug, PersoMeta> = {
  kevin: { slug: 'kevin', name: 'Keke', title: 'Pause manette', emoji: '🎮', expression: 'gamer', effect: 'Tu rejoues immédiatement.' },
  cycy: { slug: 'cycy', name: 'Cycy', title: 'Câlin d’ours', emoji: '🐻', expression: 'amoureux', effect: 'Échange ta main avec le joueur de ton choix.', needsTarget: true },
  dede: { slug: 'dede', name: 'Dédé', title: 'Reine de la soirée', emoji: '👑', expression: 'cool', effect: 'Tous les autres piochent 1 carte.' },
  manon: { slug: 'manon', name: 'Manon', title: 'Petit carnet', emoji: '✏️', expression: 'reflexion', effect: 'Regarde en secret la main d’un joueur.', needsTarget: true },
  mika: { slug: 'mika', name: 'Mika', title: 'Casquette à l’envers', emoji: '🧢', expression: 'clin_oeil', effect: 'Inverse le sens et choisis la couleur.', needsColor: true },
  cecile: { slug: 'cecile', name: 'Cécile', title: 'Grand ménage', emoji: '🧶', expression: 'joie', effect: 'Défausse aussi toutes tes cartes d’une couleur.', needsColor: true },
  carole: { slug: 'carole', name: 'Karo', title: 'Coup de griffe', emoji: '🐱', expression: 'colere', effect: 'Le joueur de ton choix pioche 3 cartes.', needsTarget: true },
  marius: { slug: 'marius', name: 'Marius', title: 'Capuche', emoji: '🧥', expression: 'boude', effect: 'Bouclier : annule un cumul de +2/+4 qui te vise.' },
  nini: { slug: 'nini', name: 'Nini', title: 'Glissade', emoji: '🐧', expression: 'surprise', effect: 'Chacun passe sa main à son voisin, dans le sens du jeu.' },
}

export const KIND_LABEL: Record<PdbCard['kind'], string> = {
  num: 'Chiffre',
  plus2: '+2',
  reverse: 'Inversion',
  skip: 'Passe',
  wild: 'Joker couleur',
  wild4: 'Joker +4',
  perso: 'Carte perso',
}

export function cardLabel(c: PdbCard): string {
  if (c.kind === 'perso' && c.perso) return `${PERSOS[c.perso].name} « ${PERSOS[c.perso].title} »`
  if (c.kind === 'num') return `${c.value} ${c.color ? COLOR_META[c.color].label : ''}`.trim()
  if (c.color) return `${KIND_LABEL[c.kind]} ${COLOR_META[c.color].label}`
  return KIND_LABEL[c.kind]
}

/** Miroir de public._pdb_playable. */
export function isPlayable(s: Pick<PdbState, 'pending_draw' | 'pending_kind' | 'color' | 'top'>, c: PdbCard): boolean {
  if (s.pending_draw > 0) {
    return c.kind === 'wild4' || (c.kind === 'plus2' && s.pending_kind === 'plus2') || (c.kind === 'perso' && c.perso === 'marius')
  }
  if (c.kind === 'wild' || c.kind === 'wild4' || c.kind === 'perso') return true
  if (c.color === s.color) return true
  if (c.kind === 'num') return s.top.kind === 'num' && s.top.value === c.value
  return s.top.kind === c.kind
}

export const needsColor = (c: PdbCard) => c.kind === 'wild' || c.kind === 'wild4' || (c.kind === 'perso' && !!c.perso && !!PERSOS[c.perso].needsColor)
export const needsTarget = (c: PdbCard) => c.kind === 'perso' && !!c.perso && !!PERSOS[c.perso].needsTarget

const KIND_ORDER: Record<PdbCard['kind'], number> = { num: 0, plus2: 1, reverse: 2, skip: 3, wild: 4, wild4: 5, perso: 6 }

/** Tri de la main : par couleur, puis valeur ; jokers et persos à la fin. */
export function sortHand(hand: PdbCard[]): PdbCard[] {
  return [...hand].sort((a, b) => {
    const ca = a.color ? PDB_COLORS.indexOf(a.color) : 9
    const cb = b.color ? PDB_COLORS.indexOf(b.color) : 9
    if (ca !== cb) return ca - cb
    if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
    if ((a.value ?? 0) !== (b.value ?? 0)) return (a.value ?? 0) - (b.value ?? 0)
    return a.id.localeCompare(b.id)
  })
}

/** Petit hash stable (rotations « en vrac » de la défausse). */
export function hashOf(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

export const pdbActions = {
  play: (card: string, extra: { color?: PdbColor; target?: string; announce?: boolean } = {}): PdbAction => ({ type: 'play', card, ...extra }),
  draw: (): PdbAction => ({ type: 'draw' }),
  pass: (): PdbAction => ({ type: 'pass' }),
  lastCard: (): PdbAction => ({ type: 'last_card' }),
  denounce: (target: string): PdbAction => ({ type: 'denounce', target }),
  tick: (): PdbAction => ({ type: 'tick' }),
}

export const PDB_DEFAULT_OPTIONS = { mode: 'persos' }

export async function preparePasDeBolStart(options: Record<string, unknown>): Promise<Record<string, unknown>> {
  return { mode: options.mode === 'classique' ? 'classique' : 'persos' }
}

