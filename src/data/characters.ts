import type { ExpressionId } from './expressions'

export type CharacterSlug =
  | 'kevin' | 'cycy' | 'dede' | 'manon' | 'mika' | 'cecile' | 'carole' | 'marius' | 'nini'

export interface Character {
  slug: CharacterSlug
  firstName: string
  /** Pseudo par defaut */
  nickname: string
  /** Couleur d'accent du perso (hex) */
  color: string
  /** Expressions disponibles, dans l'ordre des planches 4x3 */
  expressions: ExpressionId[]
  isAdmin?: boolean
}

const STANDARD: ExpressionId[] = [
  'joie', 'colere', 'pleurs', 'boude', 'reflexion', 'dodo',
  'bisou', 'clin_oeil', 'surprise', 'amoureux', 'cool', 'gamer',
]
const CAROLE: ExpressionId[] = [
  'joie', 'colere', 'pleurs', 'boude', 'reflexion', 'dodo',
  'bisou', 'clin_oeil', 'surprise', 'pouces', 'timide', 'charmee',
]
const NINI: ExpressionId[] = [
  'joie', 'colere', 'pleurs', 'boude', 'reflexion', 'dodo',
  'bisou', 'clin_oeil', 'surprise', 'pouces', 'timide', 'gamer',
]

export const CHARACTERS: Character[] = [
  { slug: 'kevin', firstName: 'Kevin', nickname: 'Keke', color: '#4CC9F0', expressions: STANDARD, isAdmin: true },
  { slug: 'cycy', firstName: 'Cyrielle', nickname: 'Cycy', color: '#FF8FA3', expressions: STANDARD },
  { slug: 'dede', firstName: 'Delphine', nickname: 'Dédé', color: '#FFB703', expressions: STANDARD },
  { slug: 'manon', firstName: 'Manon', nickname: 'Manon', color: '#8B5CF6', expressions: STANDARD },
  { slug: 'mika', firstName: 'Michael', nickname: 'Mika', color: '#06D6A0', expressions: STANDARD },
  { slug: 'cecile', firstName: 'Cécile', nickname: 'Cécile', color: '#EF476F', expressions: STANDARD },
  { slug: 'carole', firstName: 'Carole', nickname: 'Karo', color: '#FB8500', expressions: CAROLE },
  { slug: 'marius', firstName: 'Marius', nickname: 'Marius', color: '#3A86FF', expressions: STANDARD },
  { slug: 'nini', firstName: 'Nicolas', nickname: 'Nini', color: '#7AE582', expressions: NINI },
]

export const CHARACTERS_BY_SLUG = Object.fromEntries(
  CHARACTERS.map((c) => [c.slug, c]),
) as Record<CharacterSlug, Character>

export const getCharacter = (slug: string): Character | undefined =>
  (CHARACTERS_BY_SLUG as Record<string, Character>)[slug]

/**
 * Version des illustrations de TENUE (planches + portraits V3) : les fichiers gardent leur nom d'une
 * génération à l'autre, ce suffixe force le téléchargement des nouveaux (cache du service worker 90 j
 * + cache HTTP 7 j). À incrémenter à chaque refonte des planches. Les chibis de base ne changent pas.
 */
export const TENUE_ART_VERSION = 3
export const artVersion = (tenue: string) => (tenue === 'default' ? '' : `?v=${TENUE_ART_VERSION}`)

export const chibiUrl = (slug: string, expression: string = 'joie', tenue: string = 'default', thumb = false) =>
  `/chibis/${slug}/${tenue}/${expression}${thumb ? '@thumb' : ''}.webp${artVersion(tenue)}`
