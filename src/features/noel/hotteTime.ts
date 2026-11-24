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
