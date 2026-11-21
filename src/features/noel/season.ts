import { useSettings } from '@/store/settings'

/**
 * Saison de Noël : du 1er décembre au 6 janvier (date de Paris).
 * Forcer pour tester : `?noel=1` (actif), `?noel=0` (inactif) ou `?noel=2026-12-12` (fausse date de Paris,
 * utile pour l'affichage seulement : le serveur garde sa vraie date). Mémorisé pour la session de l'onglet.
 */
const KEY = 'dede-noel-force'

function readForce(): string | null {
  try {
    const q = new URLSearchParams(window.location.search).get('noel')
    if (q !== null) window.sessionStorage.setItem(KEY, q)
    return window.sessionStorage.getItem(KEY)
  } catch {
    return null
  }
}

/** Mois (1-12) et jour (1-31) à Paris. */
export function parisMonthDay(d: Date = new Date()): { month: number; day: number } {
  const p = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', month: 'numeric', day: 'numeric' }).formatToParts(d)
  return { month: Number(p.find((x) => x.type === 'month')?.value), day: Number(p.find((x) => x.type === 'day')?.value) }
}

export const inNoelWindow = (month: number, day: number): boolean => month === 12 || (month === 1 && day <= 6)

/** La saison est-elle ouverte (indépendamment du réglage de l'utilisateur) ? */
export function isNoelSeason(): boolean {
  const f = readForce()
  if (f === '1') return true
  if (f === '0') return false
  const m = f?.match(/^\d{4}-(\d{2})-(\d{2})$/)
  if (m) return inNoelWindow(Number(m[1]), Number(m[2]))
  const { month, day } = parisMonthDay()
  return inNoelWindow(month, day)
}

/** Saison ouverte ET décor non désactivé dans les réglages. */
export function useNoelDecor(): boolean {
  const on = useSettings((s) => s.noelDecor)
  return on && isNoelSeason()
}
