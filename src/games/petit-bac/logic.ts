/**
 * Logique pure du Petit bac (sans import : testable directement sous Node).
 * Miroir exact de supabase/games/petit-bac.sql (_pb_norm, _pb_score) pour
 * l'affichage en direct pendant la validation ; le serveur reste l'arbitre.
 */

const ACC_FROM = 'àâäáãåçéèêëíìîïñóòôöõúùûüýÿÀÂÄÁÃÅÇÉÈÊËÍÌÎÏÑÓÒÔÖÕÚÙÛÜÝŸ'
const ACC_TO = 'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUYY'
const ACC_MAP: Record<string, string> = {}
for (let i = 0; i < ACC_FROM.length; i++) ACC_MAP[ACC_FROM[i]] = ACC_TO[i]

/** Article de tête ignoré : le / la / les / l' / un / une. */
const ARTICLE = /^(l\s*['’`]\s*|(le|la|les|un|une)\s+)/

/** Minuscules, sans accents, espaces ni ponctuation (article de tête conservé). */
function plain(s: string): string {
  const t = s.replace(/œ/g, 'oe').replace(/Œ/g, 'OE').replace(/æ/g, 'ae').replace(/Æ/g, 'AE')
  let out = ''
  for (const ch of t) out += ACC_MAP[ch] ?? ch
  return out.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Minuscules, sans article de tête, sans accents/espaces/ponctuation, sans s/x final si > 3 car. (lion = lions). */
export function normalizeAnswer(p: string | null | undefined): string {
  const n = plain((p ?? '').trim().toLowerCase().replace(ARTICLE, ''))
  return n.length > 3 && /[sx]$/.test(n) ? n.slice(0, -1) : n
}

/** Nettoyage d'une saisie avant envoi (comme _pb_clean). */
export function cleanAnswer(p: string): string {
  return p.replace(/\s+/g, ' ').trim().slice(0, 60)
}

export type AutoStatus = 'empty' | 'letter' | null

/** Refus automatique : vide, ou ne commence pas par la lettre. */
export function autoStatus(text: string, letter: string): AutoStatus {
  const n = normalizeAnswer(text)
  if (!n) return 'empty'
  const l = (letter ?? '').toLowerCase()
  // Article accepté : « La Réunion », « L'Italie » valent pour la lettre L.
  const raw = plain((text ?? '').trim().toLowerCase())
  if (n[0] !== l && raw[0] !== l) return 'letter'
  return null
}

/** Refusée si contestée par la majorité stricte des AUTRES joueurs (au moins 2 : à 2 joueurs, jamais). */
export function isRefusedByVotes(contests: number, nPlayers: number): boolean {
  return contests >= 2 && contests * 2 > nPlayers - 1
}

export type ScoreStatus = 'unique' | 'shared' | 'refused' | 'empty' | 'letter'

/** Barème d'une catégorie : unique valide 2, valide partagée 1, sinon 0. */
export function scoreCategory(
  entries: Array<{ id: string; text: string; contests: number }>,
  letter: string,
  nPlayers: number,
): Record<string, { status: ScoreStatus; pts: number }> {
  const out: Record<string, { status: ScoreStatus; pts: number }> = {}
  const valid: Array<{ id: string; norm: string }> = []
  for (const e of entries) {
    const auto = autoStatus(e.text, letter)
    if (auto) out[e.id] = { status: auto, pts: 0 }
    else if (isRefusedByVotes(e.contests, nPlayers)) out[e.id] = { status: 'refused', pts: 0 }
    else valid.push({ id: e.id, norm: normalizeAnswer(e.text) })
  }
  for (const v of valid) {
    const shared = valid.some((o) => o.id !== v.id && o.norm === v.norm)
    out[v.id] = shared ? { status: 'shared', pts: 1 } : { status: 'unique', pts: 2 }
  }
  return out
}
