import { useSyncExternalStore } from 'react'
import { getCharacter } from '@/data/characters'
import { COSTUME_EXPRESSIONS, expressionIn } from '@/data/expressions'
import { DEFAULT_TENUE, getTenue } from '@/data/tenues'
import { TENUE_ART, TENUE_ART_BAD, TENUE_PORTRAITS } from '@/data/tenues-art.generated'

/**
 * Disponibilité des illustrations de tenue.
 * - connues d'avance : `TENUE_ART` (généré par tools/slice-chibis/gen-art.mjs) -> aucune requête 404 ;
 * - filet de sécurité : un onError sur l'image marque le couple (slug, tenue) comme absent
 *   pour toute la session (pas de nouveau téléchargement).
 * Une tenue pointe vers un dossier d'illustrations (`TenueDef.art`) : plusieurs tenues peuvent
 * partager le même dossier (ex. Star et Star de cinéma -> cinema).
 */
const known = new Set<string>(TENUE_ART)
const portraits = new Set<string>(TENUE_PORTRAITS)
const bad = new Set<string>(TENUE_ART_BAD)
const failed = new Set<string>()
const listeners = new Set<() => void>()
let version = 0

const key = (slug: string, tenue: string) => `${slug}/${tenue}`

/** Dossier d'illustrations d'une tenue (undefined = pas d'illustration). */
export const tenueArtDir = (tenue: string): string | undefined => getTenue(tenue)?.art

export function hasTenueArt(slug: string, tenue: string): boolean {
  if (tenue === DEFAULT_TENUE) return true
  const dir = tenueArtDir(tenue)
  return Boolean(dir && known.has(key(slug, dir)) && !failed.has(key(slug, tenue)))
}

/** URL du portrait de tenue (carte de succès), ou null. */
export function tenuePortraitUrl(slug: string, tenue: string, thumb = false): string | null {
  const dir = tenueArtDir(tenue)
  if (!dir || !portraits.has(key(slug, dir))) return null
  return `/chibis/${slug}/portraits/${dir}${thumb ? '@thumb' : ''}.webp`
}

/** Expressions dessinées pour ce perso dans cette tenue (tenue sans illustration -> planche de base). */
export function tenuePalette(slug: string, tenue: string): readonly string[] {
  if (tenue === DEFAULT_TENUE || !hasTenueArt(slug, tenue)) return getCharacter(slug)?.expressions ?? ['joie']
  const dir = tenueArtDir(tenue)!
  return COSTUME_EXPRESSIONS.filter((e) => !bad.has(`${slug}/${dir}/${e}`))
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

/**
 * Tenue + expression réellement affichables :
 * - repli sur 'default' (+ emoji de la tenue demandée) si pas d'illustration ;
 * - expression absente de la palette -> expression voisine (cool/gamer -> déterminé, amoureux -> bisou…).
 */
export function useTenueArt(slug: string, tenue: string | undefined, expression = 'joie') {
  useSyncExternalStore(subscribe, () => version)
  const wanted = tenue || DEFAULT_TENUE
  const ok = hasTenueArt(slug, wanted)
  const shown = ok ? wanted : DEFAULT_TENUE
  return {
    /** Tenue affichée (id). */
    tenue: shown,
    /** Dossier des images. */
    dir: shown === DEFAULT_TENUE ? 'default' : tenueArtDir(shown)!,
    /** Expression à afficher. */
    expression: expressionIn(tenuePalette(slug, shown), expression),
    /** Emoji à afficher en coin quand la tenue équipée n'a pas (encore) d'illustration. */
    missingEmoji: ok ? null : (getTenue(wanted)?.emoji ?? null),
  }
}
