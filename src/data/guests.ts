/**
 * Avatars des invités (mode invité, supabase/features/guest.sql) : pas de chibi, un emoji dans un
 * disque sticker coloré. Les ids doivent rester alignés sur `_guest_avatars()` côté SQL.
 * Le slug d'un invité vaut `g-<avatar>-<6 car.>` : l'avatar se lit dans le slug (aucune requête).
 */
export interface GuestAvatar {
  id: string
  emoji: string
  color: string
  label: string
}

export const GUEST_AVATARS: GuestAvatar[] = [
  { id: 'renard', emoji: '🦊', color: '#FFB86B', label: 'Renard' },
  { id: 'chat', emoji: '🐱', color: '#FFD6A5', label: 'Chat' },
  { id: 'chien', emoji: '🐶', color: '#C8B6FF', label: 'Chien' },
  { id: 'panda', emoji: '🐼', color: '#BDE0FE', label: 'Panda' },
  { id: 'lapin', emoji: '🐰', color: '#FFC8DD', label: 'Lapin' },
  { id: 'grenouille', emoji: '🐸', color: '#B9FBC0', label: 'Grenouille' },
  { id: 'licorne', emoji: '🦄', color: '#E4C1F9', label: 'Licorne' },
  { id: 'pieuvre', emoji: '🐙', color: '#FF99C8', label: 'Pieuvre' },
  { id: 'poussin', emoji: '🐥', color: '#FDFFB6', label: 'Poussin' },
  { id: 'koala', emoji: '🐨', color: '#CAD2C5', label: 'Koala' },
  { id: 'tigre', emoji: '🐯', color: '#FFADAD', label: 'Tigre' },
  { id: 'singe', emoji: '🐵', color: '#D4A373', label: 'Singe' },
]

const BY_ID = Object.fromEntries(GUEST_AVATARS.map((a) => [a.id, a])) as Record<string, GuestAvatar>

/** Invité de passage (slug `g-…`). */
export const isGuestSlug = (slug: string | null | undefined): boolean => !!slug && slug.startsWith('g-')

/** Membre de la bande sans chibi (slug `m-<avatar>-<6 car.>`, supabase/features/membres.sql) : avatar emoji. */
export const isEmojiMemberSlug = (slug: string | null | undefined): boolean => !!slug && slug.startsWith('m-')

/** Rendu emoji (invité ou membre sans chibi). */
export const isEmojiSlug = (slug: string | null | undefined): boolean => isGuestSlug(slug) || isEmojiMemberSlug(slug)

/** Avatar emoji d'après le slug (repli : renard), ou undefined si le slug a un vrai chibi. */
export function emojiAvatarOf(slug: string | null | undefined): GuestAvatar | undefined {
  if (!isEmojiSlug(slug)) return undefined
  return BY_ID[slug!.split('-')[1] ?? ''] ?? GUEST_AVATARS[0]
}

/** Alias historique (écran invité, Avatar, ChibiImage). */
export const guestAvatarOf = emojiAvatarOf

const spriteCache = new Map<string, string>()

/**
 * Image de l'avatar invité (data URL SVG : disque + emoji), utilisable partout où l'on attend une
 * image de chibi (<img>, canvas des jeux, textures 3D). `disc` = false -> emoji seul (fond transparent).
 */
export function guestSpriteUrl(slug: string, disc = false): string {
  const key = `${slug}|${disc}`
  const hit = spriteCache.get(key)
  if (hit) return hit
  const a = emojiAvatarOf(slug) ??GUEST_AVATARS[0]
  const bg = disc ? `<circle cx="64" cy="64" r="60" fill="${a.color}" stroke="#1f1b2e" stroke-width="6"/>` : ''
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">${bg}` +
    `<text x="64" y="70" font-size="${disc ? 72 : 96}" text-anchor="middle" dominant-baseline="central"` +
    ` font-family="Apple Color Emoji,Segoe UI Emoji,Noto Color Emoji,sans-serif">${a.emoji}</text></svg>`
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  spriteCache.set(key, url)
  return url
}
