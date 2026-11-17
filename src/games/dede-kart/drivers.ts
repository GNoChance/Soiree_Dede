import { CHARACTERS } from '@/data/characters'
import { DEFAULT_TENUE } from '@/data/tenues'
import { hasTenueArt, tenueArtDir } from '@/components/ui/tenueArt'
import type { PlayerInfo } from '../types'
import type { Driver } from './engine/Game'

/** Chibi du pilote : sa tenue équipée si elle est dessinée, sinon sa tenue de soirée. */
function spriteOf(p: PlayerInfo) {
  const t = p.equippedTenue
  if (t && t !== DEFAULT_TENUE && hasTenueArt(p.slug, t)) return `/chibis/${p.slug}/${tenueArtDir(t, p.slug)}/joie.webp`
  return `/chibis/${p.slug}/default/joie.webp`
}

/**
 * Karts de la course, dans le même ordre sur tous les téléphones (joueurs puis bots).
 * Les bots prennent les persos que personne ne joue.
 */
export function buildDrivers(playerIds: string[], botIds: string[], players: Record<string, PlayerInfo>): Driver[] {
  const humans = playerIds.map((id) => {
    const p = players[id]
    const c = CHARACTERS.find((x) => x.slug === p?.slug) ?? CHARACTERS[0]
    return { id, name: p?.nickname ?? '…', color: p?.color ?? c.color, sprite: p ? spriteOf(p) : `/chibis/${c.slug}/default/joie.webp` }
  })
  const taken = new Set(playerIds.map((id) => players[id]?.slug))
  const free = CHARACTERS.filter((c) => !taken.has(c.slug))
  const pool = free.length ? free : CHARACTERS
  const bots = botIds.map((id, k) => {
    const c = pool[k % pool.length]
    return { id, name: `${c.nickname} 🤖`, color: c.color, sprite: `/chibis/${c.slug}/default/joie.webp` }
  })
  return [...humans, ...bots]
}
