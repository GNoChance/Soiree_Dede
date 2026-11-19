import { useSyncExternalStore } from 'react'
import { getCharacter } from '@/data/characters'
import { COSTUME_EXPRESSIONS, expressionIn } from '@/data/expressions'
import { DEFAULT_TENUE, getTenue } from '@/data/tenues'
import { tenueExtrasOf } from '@/data/tenue-extras'
import { TENUE_ART, TENUE_ART_BAD, TENUE_ART_FILL, TENUE_PORTRAITS } from '@/data/tenues-art.generated'

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
export function tenueArtDir(tenue: string, slug?: string): string | undefined {
  const def = getTenue(tenue)
  if (def?.artOwn && slug && known.has(key(slug, def.artOwn))) return def.artOwn
  return def?.art
}

export function hasTenueArt(slug: string, tenue: string): boolean {
  if (tenue === DEFAULT_TENUE) return true
  const dir = tenueArtDir(tenue, slug)
  return Boolean(dir && known.has(key(slug, dir)) && !failed.has(key(slug, tenue)))
}

/** URL du portrait de tenue (carte de succès), ou null. */
export function tenuePortraitUrl(slug: string, tenue: string, thumb = false): string | null {
  const dir = tenueArtDir(tenue, slug)
  if (!dir || !portraits.has(key(slug, dir))) return null
  return `/chibis/${slug}/portraits/${dir}${thumb ? '@thumb' : ''}.webp`
}

/**
 * Les 12 cases d'une planche de tenue : case i = COSTUME_EXPRESSIONS[i] si elle est dessinée, sinon le
 * sticker hors liste qui la remplace (amoureux, cool, gamer… cf. TENUE_ART_FILL), sinon null (case vide).
 */
function tenueSlots(slug: string, dir: string): readonly (string | null)[] {
  const fill = TENUE_ART_FILL[key(slug, dir)]
  return COSTUME_EXPRESSIONS.map((e) => (bad.has(`${slug}/${dir}/${e}`) ? (fill?.[e] ?? null) : e))
}

/** Planche de la tenue portée (dossier), ou undefined si pas d'illustration (planche de base). */
function wornDir(slug: string, tenue: string): string | undefined {
  return tenue !== DEFAULT_TENUE && hasTenueArt(slug, tenue) ? tenueArtDir(tenue, slug) : undefined
}

/** Expressions dessinées pour ce perso dans cette tenue (tenue sans illustration -> planche de base). */
export function tenuePalette(slug: string, tenue: string): readonly string[] {
  const dir = wornDir(slug, tenue)
  if (!dir) return getCharacter(slug)?.expressions ?? ['joie']
  return tenueSlots(slug, dir).filter((e): e is string => e !== null)
}

/** Stickers bonus de la tenue portée (hors liste standard), vide si aucun. */
export function tenueExtras(slug: string, tenue: string) {
  if (tenue === DEFAULT_TENUE || !hasTenueArt(slug, tenue)) return []
  return tenueExtrasOf(slug, tenueArtDir(tenue, slug)!)
}

/**
 * Trophées : rang (1..12) d'un sticker dans la planche d'une tenue = sa place dans la palette commune
 * (COSTUME_EXPRESSIONS) ; `extraN` = 12 + N (stickers bonus, offerts avec la tenue) ; 0 = inconnu.
 * Le slot 1 (joie) est offert avec la tenue, les slots 2..12 se gagnent avec le trophée (tenue, slot).
 */
export function stickerSlot(slug: string, tenue: string, id: string): number {
  const m = /^extra([0-9]+)$/.exec(id)
  if (m) return 12 + Number(m[1])
  const dir = wornDir(slug, tenue)
  return (dir ? tenueSlots(slug, dir) : (COSTUME_EXPRESSIONS as readonly string[])).indexOf(id) + 1
}

/** Sticker (id d'expression) de rang `slot` dans la planche de ce perso pour cette tenue, ou null s'il n'existe pas. */
export function tenueStickerAt(slug: string, tenue: string, slot: number): string | null {
  if (slot > 12) return tenueExtras(slug, tenue)[slot - 13]?.id ?? null
  const dir = wornDir(slug, tenue)
  if (dir) return tenueSlots(slug, dir)[slot - 1] ?? null
  const e = COSTUME_EXPRESSIONS[slot - 1]
  return e && tenuePalette(slug, tenue).includes(e) ? e : null
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
    dir: shown === DEFAULT_TENUE ? 'default' : tenueArtDir(shown, slug)!,
    /** Expression à afficher. */
    expression: expressionIn([...tenuePalette(slug, shown), ...tenueExtras(slug, shown).map((x) => x.id)], expression),
    /** Emoji à afficher en coin quand la tenue équipée n'a pas (encore) d'illustration. */
    missingEmoji: ok ? null : (getTenue(wanted)?.emoji ?? null),
  }
}
