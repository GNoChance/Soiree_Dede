/**
 * Catalogue des cadeaux « déco » (miroir de la table `items` de supabase/features/cadeaux.sql) :
 * cadres d'avatar, titres sous le pseudo, objets de jeu. Purement décoratifs, aucun avantage.
 * Source : calendrier de l'Avent (`adventDay` = cadeau de cette case, `adventCount` = palier en cases ouvertes).
 */
export type ItemSlot = 'frame' | 'title' | 'kart' | 'golf_ball' | 'bowling_ball' | 'chess'

/** Décor d'un cadre : anneau (fond CSS) + éléments répartis autour + un éventuel élément en haut. */
export interface FrameStyle {
  ring: string
  /** Emojis répartis autour (en boucle sur la liste). */
  emojis?: string[]
  /** Pastilles de couleur réparties autour (guirlande, boules…). */
  dots?: string[]
  /** Nombre d'éléments autour. */
  count?: number
  /** Taille relative des pastilles (défaut 1). */
  dotScale?: number
  /** Emoji posé en haut du cadre. */
  top?: string
  /** Anneau qui tourne lentement. */
  spin?: boolean
}

export interface ItemDef {
  id: string
  slot: ItemSlot
  label: string
  emoji: string
  adventDay?: number
  adventCount?: number
  frame?: FrameStyle
}

export const SLOTS: { id: ItemSlot; label: string; emoji: string; hint: string }[] = [
  { id: 'frame', label: 'Cadre', emoji: '🖼️', hint: 'Autour de ton avatar, partout dans l’appli.' },
  { id: 'title', label: 'Titre', emoji: '🏷️', hint: 'Sous ton pseudo : profil, classement, salon.' },
  { id: 'kart', label: 'Dédé Kart', emoji: '🏎️', hint: 'Ton bolide en course.' },
  { id: 'golf_ball', label: 'Mini-golf', emoji: '⛳', hint: 'Ta balle sur le green.' },
  { id: 'bowling_ball', label: 'Bowling', emoji: '🎳', hint: 'Ta boule sur la piste.' },
  { id: 'chess', label: 'Échecs', emoji: '♟️', hint: 'Tes pièces sur l’échiquier.' },
]

export const ITEMS: ItemDef[] = [
  // titres (jours impairs)
  { id: 't_lutin_stagiaire', slot: 'title', label: 'Lutin stagiaire', emoji: '🧝', adventDay: 1 },
  { id: 't_chocolat_chaud', slot: 'title', label: 'Accro au chocolat chaud', emoji: '☕', adventDay: 3 },
  { id: 't_pote_rennes', slot: 'title', label: 'Pote des rennes', emoji: '🦌', adventDay: 5 },
  { id: 't_artiste_neiges', slot: 'title', label: 'Artiste des neiges', emoji: '⛄', adventDay: 7 },
  { id: 't_papier_cadeau', slot: 'title', label: 'As du papier cadeau', emoji: '🎁', adventDay: 9 },
  { id: 't_chorale', slot: 'title', label: 'Chorale à soi tout seul', emoji: '🎶', adventDay: 11 },
  { id: 't_mange_biscuits', slot: 'title', label: 'Mange-biscuits', emoji: '🍪', adventDay: 13 },
  { id: 't_pilote_luge', slot: 'title', label: 'Pilote de luge', emoji: '🛷', adventDay: 15 },
  { id: 't_pro_guirlandes', slot: 'title', label: 'Pro des guirlandes', emoji: '✨', adventDay: 17 },
  { id: 't_garde_sapin', slot: 'title', label: 'Garde du sapin', emoji: '🎄', adventDay: 19 },
  { id: 't_grelot_officiel', slot: 'title', label: 'Grelot officiel', emoji: '🔔', adventDay: 21 },
  { id: 't_etoile_soiree', slot: 'title', label: 'Étoile de la soirée', emoji: '🌟', adventDay: 23 },
  // cadres (jours pairs)
  { id: 'f_guirlande', slot: 'frame', label: 'Guirlande lumineuse', emoji: '💡', adventDay: 2, frame: { ring: '#2D6A4F', dots: ['#FF4D6D', '#FFD166', '#4CC9F0', '#B388FF'], count: 10 } },
  { id: 'f_flocons', slot: 'frame', label: 'Flocons', emoji: '❄️', adventDay: 4, frame: { ring: 'linear-gradient(135deg, #BDE8FF, #F4FBFF 50%, #9AD3F5)', emojis: ['❄️'], count: 6 } },
  { id: 'f_sucre_orge', slot: 'frame', label: 'Sucre d’orge', emoji: '🍭', adventDay: 6, frame: { ring: 'repeating-conic-gradient(#E63946 0 15deg, #FFFFFF 15deg 30deg)' } },
  { id: 'f_houx', slot: 'frame', label: 'Houx', emoji: '🌿', adventDay: 8, frame: { ring: '#2D6A4F', emojis: ['🌿', '🍒'], count: 6 } },
  { id: 'f_pain_epice', slot: 'frame', label: 'Pain d’épice', emoji: '🍪', adventDay: 10, frame: { ring: '#B5651D', dots: ['#FFFFFF'], count: 12, dotScale: 0.6, top: '🍪' } },
  { id: 'f_boules', slot: 'frame', label: 'Boules de Noël', emoji: '🔴', adventDay: 12, frame: { ring: '#1B4332', dots: ['#E63946', '#FFB703', '#4CC9F0', '#B388FF'], count: 8, dotScale: 1.5 } },
  { id: 'f_cadeau', slot: 'frame', label: 'Paquet cadeau', emoji: '🎀', adventDay: 14, frame: { ring: 'repeating-conic-gradient(from -7deg, #FFB703 0 14deg, #E63946 14deg 90deg)', top: '🎀' } },
  { id: 'f_etoiles', slot: 'frame', label: 'Étoiles', emoji: '⭐', adventDay: 16, frame: { ring: '#1D3557', emojis: ['⭐'], count: 5 } },
  { id: 'f_neige', slot: 'frame', label: 'Tempête de neige', emoji: '🌨️', adventDay: 18, frame: { ring: 'linear-gradient(160deg, #A9D6F5, #E8F6FF)', dots: ['#FFFFFF'], count: 14, top: '⛄' } },
  { id: 'f_sapin', slot: 'frame', label: 'Sapin', emoji: '🎄', adventDay: 20, frame: { ring: '#2D6A4F', emojis: ['🎄'], count: 4, top: '⭐' } },
  { id: 'f_aurore', slot: 'frame', label: 'Aurore boréale', emoji: '🌌', adventDay: 22, frame: { ring: 'conic-gradient(#4CC9F0, #7B2CBF, #2EC4B6, #B5E48C, #4CC9F0)', spin: true } },
  { id: 'f_etoile_doree', slot: 'frame', label: 'Étoile dorée', emoji: '🌟', adventDay: 24, frame: { ring: 'conic-gradient(#FFD166, #FFF3B0, #E9A800, #FFF3B0, #FFD166)', spin: true, emojis: ['✨'], count: 4, top: '🌟' } },
  // paliers (cases ouvertes)
  { id: 'bb_noel', slot: 'bowling_ball', label: 'Boule de Noël', emoji: '🎳', adventCount: 6 },
  { id: 'gb_bonhomme', slot: 'golf_ball', label: 'Balle bonhomme de neige', emoji: '⛄', adventCount: 12 },
  { id: 'k_traineau', slot: 'kart', label: 'Traîneau', emoji: '🛷', adventCount: 18 },
  { id: 'c_pain_epice', slot: 'chess', label: 'Échecs en pain d’épice', emoji: '♟️', adventCount: 24 },
  { id: 't_esprit_noel', slot: 'title', label: 'Esprit de Noël incarné', emoji: '🎅', adventCount: 24 },
]

const BY_ID: Record<string, ItemDef> = Object.fromEntries(ITEMS.map((i) => [i.id, i]))

export const getItem = (id: string | null | undefined): ItemDef | undefined => (id ? BY_ID[id] : undefined)

/** Paliers de l'Avent (nombre de cases ouvertes -> cadeaux), dans l'ordre. */
export const ADVENT_MILESTONES: { count: number; items: ItemDef[] }[] = [...new Set(ITEMS.filter((i) => i.adventCount).map((i) => i.adventCount!))]
  .sort((a, b) => a - b)
  .map((count) => ({ count, items: ITEMS.filter((i) => i.adventCount === count) }))

/** Cadeau de la case du jour `day` (1-24). */
export const adventDayItem = (day: number): ItemDef | undefined => ITEMS.find((i) => i.adventDay === day)

/** Objet équipé dans un slot (null si rien ou objet inconnu). */
export function equippedOf(equipped: Record<string, string> | null | undefined, slot: ItemSlot): ItemDef | null {
  const it = getItem(equipped?.[slot])
  return it && it.slot === slot ? it : null
}
