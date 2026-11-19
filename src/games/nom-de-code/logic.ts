/**
 * Règles pures de Nom de Code (sans React), mêmes règles que supabase/games/nom-de-code.sql :
 * normalisation des mots, seuil de majorité, refus d'un indice, rôles.
 */
import type { TeamColor } from '@/features/teams/teams'
import type { NdcState } from './types'

const FROM = 'àâäáãåçéèêëíìîïñóòôöõúùûüýÿÀÂÄÁÃÅÇÉÈÊËÍÌÎÏÑÓÒÔÖÕÚÙÛÜÝŸ'
const TO = 'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUYY'

/** Comme `_normalize_word` : minuscules, sans accents, œ/æ développés, seulement [a-z0-9]. */
export function normalizeWord(s: string): string {
  const t = s.replace(/œ/g, 'oe').replace(/Œ/g, 'OE').replace(/æ/g, 'ae').replace(/Æ/g, 'AE')
  let out = ''
  for (const ch of t) {
    const i = FROM.indexOf(ch)
    out += i >= 0 ? TO[i] : ch
  }
  return out.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Nombre de têtes nécessaires pour dévoiler (ou passer) : plus de la moitié des devineurs. */
export const majority = (guessers: number): number => Math.floor(guessers / 2) + 1

/** Refus serveur d'un indice, calculé à l'avance pour un message immédiat (null = accepté). */
export function clueProblem(word: string, n: number, s: NdcState): 'invalid_clue' | 'clue_is_grid_word' | null {
  const w = word.trim()
  if (!w || /\s/.test(w) || w.length > 24 || !normalizeWord(w) || !Number.isInteger(n) || n < 1 || n > 9) return 'invalid_clue'
  const nw = normalizeWord(w)
  if (s.words.some((g, i) => !(String(i) in s.revealed) && normalizeWord(g) === nw)) return 'clue_is_grid_word'
  return null
}

export const teamOf = (s: NdcState, id: TeamColor) => s.teams.find((t) => t.id === id)

/** Devineurs d'une équipe (membres sauf l'espion). */
export function guessersOf(s: NdcState, id: TeamColor): string[] {
  const t = teamOf(s, id)
  return t ? t.players.filter((p) => p !== t.spy) : []
}

/** Mon équipe et mon rôle (team null = banc / spectateur). */
export function myRole(s: NdcState, meId: string): { team: TeamColor | null; spy: boolean } {
  const t = s.teams.find((x) => x.players.includes(meId))
  return { team: t?.id ?? null, spy: Boolean(t && t.spy === meId) }
}
