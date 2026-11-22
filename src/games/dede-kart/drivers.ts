import { CHARACTERS, chibiUrl, TENUE_ART_VERSION } from '@/data/characters'
import { DEFAULT_TENUE } from '@/data/tenues'
import { hasTenueArt, tenueArtDir } from '@/components/ui/tenueArt'
import type { PlayerInfo } from '../types'
import { equippedOf } from '@/data/cadeaux'
import type { Driver } from './engine/Game'

/** Forme de kart propre à chaque perso (0 classique, 1 bolide, 2 buggy). */
export const kartOf = (slug: string) => Math.max(0, CHARACTERS.findIndex((c) => c.slug === slug)) % 3

/** Forme imposée par le kart équipé (3 = traîneau), sinon la forme du perso. */
const kartFor = (p: PlayerInfo | undefined, slug: string) => equippedOf(p?.equippedItems, 'kart')?.kart?.variant ?? kartOf(slug)

/** Couleur de carrosserie du kart équipé (Bolide doré, peintures de la boutique). */
const bodyFor = (p: PlayerInfo | undefined) => equippedOf(p?.equippedItems, 'kart')?.kart?.body

/** Chibi du pilote : sa tenue équipée si elle est dessinée, sinon sa tenue de soirée. */
function spriteOf(p: PlayerInfo) {
  const t = p.equippedTenue
  if (t && t !== DEFAULT_TENUE && hasTenueArt(p.slug, t)) return `/chibis/${p.slug}/${tenueArtDir(t, p.slug)}/joie.webp?v=${TENUE_ART_VERSION}`
  return chibiUrl(p.slug) // invité : emoji de son avatar
}

/**
 * Karts de la course, dans le même ordre sur tous les téléphones (joueurs puis bots).
 * Les bots prennent les persos que personne ne joue.
 */
export function buildDrivers(playerIds: string[], botIds: string[], players: Record<string, PlayerInfo>): Driver[] {
  const humans = playerIds.map((id) => {
    const p = players[id]
    const c = CHARACTERS.find((x) => x.slug === p?.slug) ?? CHARACTERS[0]
    return { id, name: p?.nickname ?? '…', color: p?.color ?? c.color, sprite: p ? spriteOf(p) : `/chibis/${c.slug}/default/joie.webp`, kart: kartFor(p, c.slug), body: bodyFor(p) }
  })
  const taken = new Set(playerIds.map((id) => players[id]?.slug))
  const free = CHARACTERS.filter((c) => !taken.has(c.slug))
  const pool = free.length ? free : CHARACTERS
  const bots = botIds.map((id, k) => {
    const c = pool[k % pool.length]
    return { id, name: `${c.nickname} 🤖`, color: c.color, sprite: `/chibis/${c.slug}/default/joie.webp`, kart: kartOf(c.slug) }
  })
  return [...humans, ...bots]
}
