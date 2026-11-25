// Calculs de temps de la Hotte (sans import : vérifiables par un simple script node).

/** L'échéance de la Hotte est-elle passée (heure serveur) ? Pas d'échéance = pas fini. */
export function hotteTimeUp(deadline: string | null | undefined, nowMs: number): boolean {
  if (!deadline) return false
  return Date.parse(deadline) <= nowMs
}

/** Date de Paris « AAAA-MM-JJ » d'un instant (le « jour » de l'événement). */
export function parisDay(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms)
}

/**
 * Correction locale d'une manche (aperçu admin uniquement : le vrai jeu est corrigé par le serveur).
 * Même règle que _hotte_proche_ok : « combien ? » juste à ±15 % (au moins ±1), virgule acceptée.
 */
export function hotteLocalOk(round: { type: string; answer: string }, given: string): boolean {
  if (round.type !== 'proche') return given === round.answer
  const txt = given.trim().replace(',', '.')
  const v = Number(txt)
  const target = Number(round.answer)
  if (!txt || !Number.isFinite(v)) return false
  return Math.abs(v - target) <= Math.max(1, 0.15 * Math.abs(target))
}
