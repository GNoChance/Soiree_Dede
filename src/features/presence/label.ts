/** « En ligne » = dernier signal il y a moins de 2 min (le téléphone en envoie un par minute). */
export const ONLINE_MS = 2 * 60_000

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

export interface PresenceLabel {
  online: boolean
  /** « En ligne », « Vu il y a 5 min », « Vu hier »… */
  text: string
}

/** Libellé de présence ; null si la personne n'a jamais été vue. */
export function presenceLabel(lastSeen: number | null | undefined, now: number): PresenceLabel | null {
  if (lastSeen == null || !Number.isFinite(lastSeen)) return null
  const ago = Math.max(0, now - lastSeen)
  if (ago < ONLINE_MS) return { online: true, text: 'En ligne' }
  if (ago < HOUR) return { online: false, text: `Vu il y a ${Math.floor(ago / MIN)} min` }
  if (ago < DAY) return { online: false, text: `Vu il y a ${Math.floor(ago / HOUR)} h` }
  if (ago < 2 * DAY) return { online: false, text: 'Vu hier' }
  if (ago < 30 * DAY) return { online: false, text: `Vu il y a ${Math.floor(ago / DAY)} jours` }
  return { online: false, text: 'Vu il y a longtemps' }
}
