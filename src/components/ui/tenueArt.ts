import { useSyncExternalStore } from 'react'
import { DEFAULT_TENUE, getTenue } from '@/data/tenues'
import { TENUE_ART } from '@/data/tenues-art.generated'

/**
 * Disponibilité des illustrations de tenue.
 * - connues d'avance : `TENUE_ART` (généré par tools/slice-chibis) -> aucune requête 404 ;
 * - filet de sécurité : un onError sur l'image marque le couple (slug, tenue) comme absent
 *   pour toute la session (pas de nouveau téléchargement).
 */
const known = new Set<string>(TENUE_ART)
const failed = new Set<string>()
const listeners = new Set<() => void>()
let version = 0

const key = (slug: string, tenue: string) => `${slug}/${tenue}`

export function hasTenueArt(slug: string, tenue: string): boolean {
  return tenue === DEFAULT_TENUE || (known.has(key(slug, tenue)) && !failed.has(key(slug, tenue)))
}

export function markTenueArtMissing(slug: string, tenue: string) {
  if (tenue === DEFAULT_TENUE || failed.has(key(slug, tenue))) return
  failed.add(key(slug, tenue))
  version++
  listeners.forEach((l) => l())
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/** Tenue réellement affichable : repli sur 'default' (+ emoji de la tenue demandée) si pas d'illustration. */
export function useTenueArt(slug: string, tenue: string | undefined) {
  useSyncExternalStore(subscribe, () => version)
  const wanted = tenue || DEFAULT_TENUE
  const ok = hasTenueArt(slug, wanted)
  return {
    /** Tenue à utiliser pour l'URL de l'image. */
    tenue: ok ? wanted : DEFAULT_TENUE,
    /** Emoji à afficher en coin quand la tenue équipée n'a pas (encore) d'illustration. */
    missingEmoji: ok ? null : (getTenue(wanted)?.emoji ?? null),
  }
}
