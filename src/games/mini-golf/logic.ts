import { TENUE_ART_VERSION } from '@/data/characters'
import { DEFAULT_TENUE } from '@/data/tenues'
import { hasTenueArt, tenueArtDir } from '@/components/ui/tenueArt'
import type { PlayerInfo } from '../types'
import { holeById, type HoleDef } from './holes'
import type { MiniGolfState } from './types'

/** Définition du trou n° idx (index dans le parcours). */
export const holeAt = (s: MiniGolfState, idx: number): HoleDef => holeById(s.holes?.[idx] ?? 1)

/** Total après les `upTo` premiers trous (défaut : tous ceux joués). */
export function totalOf(s: MiniGolfState, id: string, upTo?: number) {
  const card = s.cards?.[id] ?? []
  return card.slice(0, upTo ?? card.length).reduce((a, b) => a + b, 0)
}

/** Classement (plus petit total d'abord) avec rangs ex aequo. */
export function ranking(s: MiniGolfState, upTo?: number): Array<{ id: string; total: number; rank: number }> {
  const rows = s.players.map((id) => ({ id, total: totalOf(s, id, upTo) })).sort((a, b) => a.total - b.total || a.id.localeCompare(b.id))
  return rows.map((r) => ({ ...r, rank: rows.findIndex((x) => x.total === r.total) + 1 }))
}

export type Mark = 'under' | 'par' | 'over'

export const markOf = (score: number, par: number): Mark => (score < par ? 'under' : score === par ? 'par' : 'over')

export const MARK_DOT: Record<Mark, string> = { under: '🟢', par: '⚪', over: '🔴' }

export const MARK_CLASS: Record<Mark, string> = {
  under: 'bg-mint text-[#1f1b2e]',
  par: 'bg-surface',
  over: 'bg-tomato/80 text-white',
}

/** « 3 coups (par 3) » ; 7 = balle ramassée. */
export function scoreLabel(score: number, par: number) {
  if (score >= 7) return `Ramassée : 7 (par ${par})`
  return `${score} coup${score > 1 ? 's' : ''} (par ${par})`
}

/** Écart au par cumulé : « +2 », « −1 », « = ». */
export function vsPar(s: MiniGolfState, id: string) {
  const card = s.cards?.[id] ?? []
  const d = card.reduce((a, b, i) => a + b - (s.pars[i] ?? 0), 0)
  return d === 0 ? '=' : d > 0 ? `+${d}` : `−${-d}`
}

/** Chibi d'un joueur pour sa balle fantôme : sa tenue équipée si dessinée, sinon sa tenue de soirée. */
export function spriteOf(p: PlayerInfo) {
  const t = p.equippedTenue
  if (t && t !== DEFAULT_TENUE && hasTenueArt(p.slug, t)) return `/chibis/${p.slug}/${tenueArtDir(t, p.slug)}/joie.webp?v=${TENUE_ART_VERSION}`
  return `/chibis/${p.slug}/default/joie.webp`
}
