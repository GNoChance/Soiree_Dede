// Tokens du design « sticker book » de l'app (copie de src/index.css).
import { loadFont as loadBaloo } from '@remotion/google-fonts/Baloo2'
import { loadFont as loadNunito } from '@remotion/google-fonts/Nunito'

export const { fontFamily: DISPLAY } = loadBaloo('normal', { weights: ['600', '700', '800'], subsets: ['latin', 'latin-ext'] })
export const { fontFamily: BODY } = loadNunito('normal', { weights: ['400', '600', '700', '800'], subsets: ['latin', 'latin-ext'] })
/** Police système imitant l'UI iOS / Android (navigateurs, feuilles de partage). */
export const SYSTEM = '-apple-system, "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'

export const C = {
  paper: '#fff6e5', surface: '#ffffff', sunk: '#ffe9bf', ink: '#1f1b2e', text: '#1f1b2e', muted: '#6b6485',
  night: '#15122b', nightSurface: '#2a2458',
  sun: '#ffb703', tangerine: '#fb8500', tomato: '#ef476f', bubblegum: '#ff8fa3',
  mint: '#06d6a0', sky: '#4cc9f0', grape: '#8b5cf6', lime: '#b5e61d',
} as const
export const sticker = (n = 4) => `${n}px ${n}px 0 0 ${C.ink}`

export type Slug = 'kevin' | 'cycy' | 'dede' | 'manon' | 'mika' | 'cecile' | 'carole' | 'marius' | 'nini'
export const CHARACTERS: { slug: Slug; nickname: string; firstName: string; color: string; expressions: string[] }[] = [
  { slug: 'kevin', nickname: 'Keke', firstName: 'Kevin', color: '#4CC9F0', expressions: ['joie','colere','pleurs','boude','reflexion','dodo','bisou','clin_oeil','surprise','amoureux','cool','gamer'] },
  { slug: 'cycy', nickname: 'Cycy', firstName: 'Cyrielle', color: '#FF8FA3', expressions: ['joie','colere','pleurs','boude','reflexion','dodo','bisou','clin_oeil','surprise','amoureux','cool','gamer'] },
  { slug: 'dede', nickname: 'Dédé', firstName: 'Delphine', color: '#FFB703', expressions: ['joie','colere','pleurs','boude','reflexion','dodo','bisou','clin_oeil','surprise','amoureux','cool','gamer'] },
  { slug: 'manon', nickname: 'Manon', firstName: 'Manon', color: '#8B5CF6', expressions: ['joie','colere','pleurs','boude','reflexion','dodo','bisou','clin_oeil','surprise','amoureux','cool','gamer'] },
  { slug: 'mika', nickname: 'Mika', firstName: 'Michael', color: '#06D6A0', expressions: ['joie','colere','pleurs','boude','reflexion','dodo','bisou','clin_oeil','surprise','amoureux','cool','gamer'] },
  { slug: 'cecile', nickname: 'Cécile', firstName: 'Cécile', color: '#EF476F', expressions: ['joie','colere','pleurs','boude','reflexion','dodo','bisou','clin_oeil','surprise','amoureux','cool','gamer'] },
  { slug: 'carole', nickname: 'Karo', firstName: 'Carole', color: '#FB8500', expressions: ['joie','colere','pleurs','boude','reflexion','dodo','bisou','clin_oeil','surprise','pouces','timide','charmee'] },
  { slug: 'marius', nickname: 'Marius', firstName: 'Marius', color: '#3A86FF', expressions: ['joie','colere','pleurs','boude','reflexion','dodo','bisou','clin_oeil','surprise','amoureux','cool','gamer'] },
  { slug: 'nini', nickname: 'Nini', firstName: 'Nicolas', color: '#7AE582', expressions: ['joie','colere','pleurs','boude','reflexion','dodo','bisou','clin_oeil','surprise','pouces','timide','gamer'] },
]
/** URL d'un chibi (staticFile). thumb = 160 px. */
export const chibiPath = (slug: Slug, expr = 'joie', thumb = false) => `chibis/${slug}/default/${expr}${thumb ? '@thumb' : ''}.webp`
