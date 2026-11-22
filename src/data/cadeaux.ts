/**
 * Catalogue des cadeaux « déco » (miroir de la table `items` de supabase/features/cadeaux.sql) :
 * cadres d'avatar, titres sous le pseudo, objets de jeu. Purement décoratifs, aucun avantage.
 * Sources : calendrier de l'Avent (`adventDay` = cadeau de cette case, `adventCount` = palier en cases ouvertes),
 * ou une règle serveur (items.rule : trophée, niveau, champion de la semaine, victoires) décrite par `howTo`.
 */
export type ItemSlot = 'frame' | 'title' | 'kart' | 'golf_ball' | 'bowling_ball' | 'chess' | 'card_back' | 'dice' | 'marks'

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

/** Saisons de boutique (calendrier : src/data/saisons.ts, SQL : supabase/features/saisons.sql). */
export type SeasonId = 'hiver' | 'printemps' | 'ete' | 'automne'

export interface ItemDef {
  id: string
  slot: ItemSlot
  label: string
  emoji: string
  adventDay?: number
  adventCount?: number
  /** Comment l'obtenir (cadeaux hors Avent). */
  howTo?: string
  /** Prix en pièces : article de la boutique (jamais un cadeau gagné). */
  price?: number
  /** Saison de l'article : collection limitée (avec `price`) ou exclusif du passe de saison (avec `passTier`, sans prix). */
  season?: SeasonId
  /** Palier du passe de saison (5, 10, 15 ou 20) qui offre cet article (jamais vendu). */
  passTier?: number
  frame?: FrameStyle
  /** Dédé Kart : forme (3 = traîneau) et / ou couleur de carrosserie. */
  kart?: { variant?: number; body?: string }
  /** Mini-golf : style spécial ou couleurs de la balle. */
  golf?: { style?: 'snowman' | 'disco'; color?: string; stripe?: string }
  /** Bowling : style spécial ou couleurs de la boule. */
  bowling?: { style?: 'noel' | 'galaxie'; color?: string; band?: string }
  /** Échecs : thème des pièces. */
  chess?: 'gingerbread' | 'marble'
  /** Dos de cartes (Pas de bol, Kems) : fond CSS + emoji au centre. */
  cardBack?: { bg: string; emoji?: string }
  /** Dés du Menteur : face, arête, points. */
  dice?: { face: string; edge: string; pip: string }
  /** Croix et ronds du Morpion : contour, halo lumineux, trait pointillé. */
  marks?: { outline: string; glow?: string; dash?: boolean }
}

export const SLOTS: { id: ItemSlot; label: string; emoji: string; hint: string }[] = [
  { id: 'frame', label: 'Cadre', emoji: '🖼️', hint: 'Autour de ton avatar, partout dans l’appli.' },
  { id: 'title', label: 'Titre', emoji: '🏷️', hint: 'Sous ton pseudo : profil, classement, salon.' },
  { id: 'kart', label: 'Dédé Kart', emoji: '🏎️', hint: 'Ton bolide en course.' },
  { id: 'golf_ball', label: 'Mini-golf', emoji: '⛳', hint: 'Ta balle sur le green.' },
  { id: 'bowling_ball', label: 'Bowling', emoji: '🎳', hint: 'Ta boule sur la piste.' },
  { id: 'chess', label: 'Échecs', emoji: '♟️', hint: 'Tes pièces sur l’échiquier.' },
  { id: 'card_back', label: 'Dos de cartes', emoji: '🃏', hint: 'Pas de bol et Kems, sur ton écran.' },
  { id: 'dice', label: 'Dés', emoji: '🎲', hint: 'Menteur, sur ton écran.' },
  { id: 'marks', label: 'Croix et ronds', emoji: '❌', hint: 'Morpion, sur ton écran.' },
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
  { id: 'bb_noel', slot: 'bowling_ball', label: 'Boule de Noël', emoji: '🎳', adventCount: 6, bowling: { style: 'noel' } },
  { id: 'gb_bonhomme', slot: 'golf_ball', label: 'Balle bonhomme de neige', emoji: '⛄', adventCount: 12, golf: { style: 'snowman' } },
  { id: 'k_traineau', slot: 'kart', label: 'Traîneau', emoji: '🛷', adventCount: 18, kart: { variant: 3 } },
  { id: 'c_pain_epice', slot: 'chess', label: 'Échecs en pain d’épice', emoji: '♟️', adventCount: 24, chess: 'gingerbread' },
  { id: 't_esprit_noel', slot: 'title', label: 'Esprit de Noël incarné', emoji: '🎅', adventCount: 24 },
  // trophées généraux
  { id: 'f_arc_en_ciel', slot: 'frame', label: 'Arc-en-ciel', emoji: '🌈', howTo: 'Trophée « Touche-à-tout » : jouer à 10 jeux différents', frame: { ring: 'conic-gradient(#FF4D6D, #FFB703, #FFE066, #2EC4B6, #4CC9F0, #B388FF, #FF4D6D)' } },
  { id: 't_couteau_suisse', slot: 'title', label: 'Couteau suisse', emoji: '🛠️', howTo: 'Trophée « Polyvalent » : gagner dans 5 jeux différents' },
  { id: 't_pilier', slot: 'title', label: 'Pilier de soirée', emoji: '🏛️', howTo: 'Trophée « Pilier de soirée » : participer à 20 soirées' },
  { id: 'f_nuit_blanche', slot: 'frame', label: 'Nuit blanche', emoji: '🌙', howTo: 'Trophée « Noctambule » : finir 3 soirées après 2 h du matin', frame: { ring: 'linear-gradient(160deg, #0B1340, #2A2F6B)', dots: ['#FFFFFF', '#FFE066'], count: 10, dotScale: 0.55, top: '🌙' } },
  { id: 't_increvable', slot: 'title', label: 'Increvable', emoji: '🔋', howTo: 'Trophée « Marathonien » : 8 parties dans une même soirée' },
  { id: 'f_tapis_rouge', slot: 'frame', label: 'Tapis rouge', emoji: '🏠', howTo: 'Trophée « Hôte de la maison » : organiser 5 soirées', frame: { ring: 'repeating-conic-gradient(#C1121F 0 10deg, #E63946 10deg 20deg)', dots: ['#FFC93C'], count: 8, dotScale: 0.7, top: '🏠' } },
  { id: 't_grande_tablee', slot: 'title', label: 'Grande tablée', emoji: '🍽️', howTo: 'Trophée « Grande tablée » : une soirée à 6 joueurs ou plus' },
  { id: 'f_bulles', slot: 'frame', label: 'Bulles de BD', emoji: '💬', howTo: 'Trophée « Pipelette » : envoyer 50 stickers dans le chat', frame: { ring: 'linear-gradient(135deg, #8ECAE6, #D7F0FF)', emojis: ['💬'], count: 4 } },
  { id: 't_fashion_week', slot: 'title', label: 'Fashion week', emoji: '👗', howTo: 'Trophée « Garde-robe » : débloquer 5 tenues' },
  { id: 'f_medaillon', slot: 'frame', label: 'Médaillon', emoji: '🏅', howTo: 'Trophée « Collectionneur » : compléter une planche de tenue', frame: { ring: 'conic-gradient(#B08D57, #F3E5AB, #B08D57, #F3E5AB, #B08D57)', top: '🏅' } },
  { id: 't_boule_cristal', slot: 'title', label: 'Boule de cristal', emoji: '🔮', howTo: 'Trophée « Madame Irma » : 3 bons pronostics d’affilée' },
  // niveaux
  { id: 'f_bronze', slot: 'frame', label: 'Bronze', emoji: '🥉', howTo: 'Atteindre le niveau 5', frame: { ring: 'linear-gradient(135deg, #8C5A2B, #E0A96D 50%, #8C5A2B)' } },
  { id: 'f_argent', slot: 'frame', label: 'Argent', emoji: '🥈', howTo: 'Atteindre le niveau 10', frame: { ring: 'linear-gradient(135deg, #8E9AAF, #F1F3F8 50%, #8E9AAF)' } },
  { id: 'f_or', slot: 'frame', label: 'Or', emoji: '🥇', howTo: 'Atteindre le niveau 15', frame: { ring: 'linear-gradient(135deg, #B8860B, #FFE38A 50%, #B8860B)', emojis: ['✨'], count: 3 } },
  { id: 'f_diamant', slot: 'frame', label: 'Diamant', emoji: '💎', howTo: 'Atteindre le niveau 20', frame: { ring: 'conic-gradient(#A0E7FF, #FFFFFF, #C3B1FF, #FFFFFF, #A0E7FF)', spin: true, top: '💎' } },
  // champion de la semaine
  { id: 't_patron_semaine', slot: 'title', label: 'Patron de la semaine', emoji: '🥇', howTo: 'Finir champion de la semaine (le plus de victoires)' },
  { id: 'f_couronne', slot: 'frame', label: 'Couronne', emoji: '👑', howTo: 'Finir 3 fois champion de la semaine', frame: { ring: 'linear-gradient(135deg, #B8860B, #FFD166 50%, #B8860B)', dots: ['#E63946', '#4CC9F0'], count: 6, top: '👑' } },
  // victoires par jeu
  { id: 'k_dore', slot: 'kart', label: 'Bolide doré', emoji: '🏆', howTo: 'Gagner 10 courses de Dédé Kart', kart: { body: '#FFC93C' } },
  { id: 'gb_disco', slot: 'golf_ball', label: 'Balle disco', emoji: '🪩', howTo: 'Gagner 10 parties de Mini-golf', golf: { style: 'disco' } },
  { id: 'bb_galaxie', slot: 'bowling_ball', label: 'Boule galaxie', emoji: '🌌', howTo: 'Gagner 10 parties de Bowling', bowling: { style: 'galaxie' } },
  { id: 'c_marbre', slot: 'chess', label: 'Pièces en marbre', emoji: '🗿', howTo: 'Gagner 10 parties d’Échecs', chess: 'marble' },
  // ---- boutique (prix en pièces) ----
  // dos de cartes
  { id: 'cb_bonbon', slot: 'card_back', label: 'Bonbon', emoji: '🍬', price: 100, cardBack: { bg: 'repeating-linear-gradient(45deg, #FF8FAB 0 8px, #FFFFFF 8px 16px)', emoji: '🍬' } },
  { id: 'cb_pois', slot: 'card_back', label: 'Pois', emoji: '🔴', price: 100, cardBack: { bg: 'radial-gradient(#FFFFFF 22%, transparent 24%) 0 0 / 14px 14px, #E63946' } },
  { id: 'cb_damier', slot: 'card_back', label: 'Damier', emoji: '🏁', price: 250, cardBack: { bg: 'repeating-conic-gradient(#1F1B2E 0 25%, #FFFFFF 0 50%) 0 0 / 16px 16px', emoji: '🏁' } },
  { id: 'cb_etoiles', slot: 'card_back', label: 'Nuit étoilée', emoji: '⭐', price: 250, cardBack: { bg: 'radial-gradient(#FFE066 1.5px, transparent 2px) 0 0 / 12px 12px, radial-gradient(#FFFFFF 1px, transparent 1.5px) 6px 6px / 12px 12px, #1D3557', emoji: '🌙' } },
  { id: 'cb_vagues', slot: 'card_back', label: 'Vagues', emoji: '🌊', price: 250, cardBack: { bg: 'radial-gradient(circle at 50% 0, transparent 8px, #4CC9F0 9px, #4CC9F0 12px, transparent 13px) 0 0 / 20px 12px, #0077B6', emoji: '🌊' } },
  { id: 'cb_confettis', slot: 'card_back', label: 'Confettis', emoji: '🎉', price: 500, cardBack: { bg: 'radial-gradient(#FF4D6D 2px, transparent 2.5px) 0 0 / 18px 18px, radial-gradient(#FFD166 2px, transparent 2.5px) 9px 5px / 18px 18px, radial-gradient(#4CC9F0 2px, transparent 2.5px) 4px 11px / 18px 18px, radial-gradient(#2EC4B6 2px, transparent 2.5px) 13px 14px / 18px 18px, #FFF6E5', emoji: '🎉' } },
  { id: 'cb_ubb', slot: 'card_back', label: 'Rugby bordelais', emoji: '🏉', price: 250, cardBack: { bg: 'repeating-linear-gradient(0deg, #7A1F3D 0 10px, #FFFFFF 10px 13px, #1F1B2E 13px 23px, #FFFFFF 23px 26px)', emoji: '🏉' } },
  // dés
  { id: 'd_bonbon', slot: 'dice', label: 'Dés rose bonbon', emoji: '🎲', price: 100, dice: { face: '#FFC2D4', edge: '#E5748F', pip: '#7A1036' } },
  { id: 'd_glacon', slot: 'dice', label: 'Dés glaçon', emoji: '🧊', price: 250, dice: { face: '#DDF4FF', edge: '#8ECAE6', pip: '#1D6FA3' } },
  { id: 'd_nuit', slot: 'dice', label: 'Dés nuit étoilée', emoji: '🌌', price: 250, dice: { face: '#3A3F86', edge: '#1B1F4F', pip: '#FFE066' } },
  { id: 'd_or', slot: 'dice', label: 'Dés en or', emoji: '🥇', price: 500, dice: { face: '#FFD166', edge: '#C99700', pip: '#5A3E00' } },
  // croix et ronds
  { id: 'm_craie', slot: 'marks', label: 'Craie', emoji: '🖍️', price: 100, marks: { outline: '#F4F1EA', dash: true } },
  { id: 'm_neon', slot: 'marks', label: 'Néon', emoji: '💡', price: 250, marks: { outline: '#1F1B2E', glow: '#FF2BD6' } },
  { id: 'm_paillettes', slot: 'marks', label: 'Paillettes', emoji: '✨', price: 500, marks: { outline: '#FFC93C', glow: '#FFD166' } },
  // karts
  { id: 'k_menthe', slot: 'kart', label: 'Peinture menthe', emoji: '🌿', price: 100, kart: { body: '#7FE7C4' } },
  { id: 'k_flamant', slot: 'kart', label: 'Rose flamant', emoji: '🦩', price: 250, kart: { body: '#FF8FAB' } },
  { id: 'k_noir', slot: 'kart', label: 'Noir mat', emoji: '🖤', price: 250, kart: { body: '#2B2B33' } },
  { id: 'k_lave', slot: 'kart', label: 'Lave', emoji: '🌋', price: 500, kart: { body: '#FF5A1F' } },
  { id: 'k_ubb', slot: 'kart', label: 'Peinture UBB', emoji: '🏉', price: 250, kart: { body: '#7A1F3D' } },
  // balles et boules
  { id: 'gb_pasteque', slot: 'golf_ball', label: 'Balle pastèque', emoji: '🍉', price: 100, golf: { color: '#2DC653', stripe: '#FF4D6D' } },
  { id: 'gb_lune', slot: 'golf_ball', label: 'Balle lune', emoji: '🌕', price: 250, golf: { color: '#E9E4D4', stripe: '#8E9AAF' } },
  { id: 'bb_bille', slot: 'bowling_ball', label: 'Boule bille', emoji: '🔵', price: 100, bowling: { color: '#4CC9F0', band: '#FFFFFF' } },
  { id: 'bb_volcan', slot: 'bowling_ball', label: 'Boule volcan', emoji: '🌋', price: 250, bowling: { color: '#3A0F0F', band: '#FF5A1F' } },
  { id: 'bb_ubb', slot: 'bowling_ball', label: 'Boule ovale', emoji: '🏉', price: 250, bowling: { color: '#8B4A24', band: '#FFFFFF' } },
  // cadres
  { id: 'f_pois', slot: 'frame', label: 'Pois', emoji: '🔴', price: 100, frame: { ring: 'radial-gradient(#FFFFFF 25%, transparent 27%) 0 0 / 8px 8px, #FF4D6D' } },
  { id: 'f_damier', slot: 'frame', label: 'Damier', emoji: '🏁', price: 100, frame: { ring: 'repeating-conic-gradient(#1F1B2E 0 25%, #FFFFFF 0 50%) 0 0 / 8px 8px' } },
  { id: 'f_zebre', slot: 'frame', label: 'Zèbre', emoji: '🦓', price: 250, frame: { ring: 'repeating-linear-gradient(60deg, #1F1B2E 0 4px, #FFFFFF 4px 9px)' } },
  { id: 'f_coeurs', slot: 'frame', label: 'Cœurs', emoji: '❤️', price: 250, frame: { ring: '#FFB3C7', emojis: ['❤️'], count: 5 } },
  { id: 'f_fleurs', slot: 'frame', label: 'Fleurs', emoji: '🌼', price: 250, frame: { ring: '#B5E48C', emojis: ['🌼', '🌸'], count: 6 } },
  { id: 'f_neon', slot: 'frame', label: 'Néon', emoji: '💡', price: 500, frame: { ring: 'conic-gradient(#FF2BD6, #2BFFF1, #FF2BD6)', spin: true } },
  { id: 'f_ubb', slot: 'frame', label: 'Supporter UBB', emoji: '🏉', price: 250, frame: { ring: 'repeating-linear-gradient(90deg, #7A1F3D 0 6px, #FFFFFF 6px 8px, #1F1B2E 8px 14px, #FFFFFF 14px 16px)', top: '🏉' } },
  // titres
  { id: 't_mauvaise_foi', slot: 'title', label: 'Mauvaise foi', emoji: '😤', price: 100 },
  { id: 't_coup_de_bluff', slot: 'title', label: 'Coup de bluff', emoji: '🃏', price: 100 },
  { id: 't_pro_chambrage', slot: 'title', label: 'Pro du chambrage', emoji: '😏', price: 100 },
  { id: 't_ubb', slot: 'title', label: 'Supporter UBB', emoji: '🏉', price: 100 },
  { id: 't_tout_ou_rien', slot: 'title', label: 'Tout ou rien', emoji: '🎰', price: 250 },
  { id: 't_chance_insolente', slot: 'title', label: 'Chance insolente', emoji: '🍀', price: 250 },
  { id: 't_legende_vivante', slot: 'title', label: 'Légende vivante', emoji: '🏆', price: 500 },
  // saisons : collections limitées (price) et exclusifs du passe (passTier), cf. docs/superpowers/specs/2026-11-22-saisons-boutique-design.md
  { id: 't_tout_schuss', slot: 'title', label: 'Tout schuss', emoji: '⛷️', price: 100, season: 'hiver' },
  { id: 't_raclette', slot: 'title', label: 'Team raclette', emoji: '🧀', price: 100, season: 'hiver' },
  { id: 'k_glacier', slot: 'kart', label: 'Bleu glacier', emoji: '🧊', price: 100, season: 'hiver', kart: { body: '#7FD6F2' } },
  { id: 'f_bonnet', slot: 'frame', label: 'Bonnet à pompon', emoji: '🧶', price: 250, season: 'hiver', frame: { ring: '#E63946', dots: ['#FFFFFF'], count: 12, dotScale: 0.6, top: '🧶' } },
  { id: 'cb_pull_moche', slot: 'card_back', label: 'Pull moche', emoji: '🦌', price: 250, season: 'hiver', cardBack: { bg: 'repeating-linear-gradient(0deg, #C1121F 0 10px, #FFFFFF 10px 12px, #2D6A4F 12px 22px, #FFFFFF 22px 24px)', emoji: '🦌' } },
  { id: 'd_chocolat_chaud', slot: 'dice', label: 'Dés chocolat chaud', emoji: '☕', price: 250, season: 'hiver', dice: { face: '#6B3E26', edge: '#3E2214', pip: '#FFF3E0' } },
  { id: 'gb_boule_neige', slot: 'golf_ball', label: 'Balle boule de neige', emoji: '❄️', price: 250, season: 'hiver', golf: { color: '#F4FBFF', stripe: '#8ECAE6' } },
  { id: 'm_givre', slot: 'marks', label: 'Givre', emoji: '🧊', price: 500, season: 'hiver', marks: { outline: '#BDE8FF', glow: '#4CC9F0' } },
  { id: 'f_blizzard', slot: 'frame', label: 'Blizzard', emoji: '🏔️', price: 500, season: 'hiver', frame: { ring: 'conic-gradient(#FFFFFF, #8ECAE6, #1D6FA3, #8ECAE6, #FFFFFF)', spin: true, emojis: ['❄️'], count: 4, top: '🏔️' } },
  { id: 't_poisson_avril', slot: 'title', label: 'Poisson d’avril permanent', emoji: '🐟', price: 100, season: 'printemps' },
  { id: 't_allergique', slot: 'title', label: 'Allergique à la défaite', emoji: '🤧', price: 100, season: 'printemps' },
  { id: 'gb_oeuf', slot: 'golf_ball', label: 'Balle œuf en chocolat', emoji: '🥚', price: 100, season: 'printemps', golf: { color: '#6B3E26', stripe: '#FFD166' } },
  { id: 'f_potager', slot: 'frame', label: 'Potager du dimanche', emoji: '🪴', price: 250, season: 'printemps', frame: { ring: '#8D5A2B', emojis: ['🌱', '🥕', '🐛'], count: 6, top: '🪴' } },
  { id: 'cb_pique_nique', slot: 'card_back', label: 'Nappe de pique-nique', emoji: '🧺', price: 250, season: 'printemps', cardBack: { bg: 'linear-gradient(90deg, rgba(230,57,70,0.5) 50%, transparent 50%) 0 0 / 16px 16px, linear-gradient(rgba(230,57,70,0.5) 50%, transparent 50%) 0 0 / 16px 16px, #FFFFFF', emoji: '🧺' } },
  { id: 'd_poussin', slot: 'dice', label: 'Dés poussin', emoji: '🐥', price: 250, season: 'printemps', dice: { face: '#FFE066', edge: '#F4B400', pip: '#FF7B00' } },
  { id: 'k_coccinelle', slot: 'kart', label: 'Rouge coccinelle', emoji: '🐞', price: 250, season: 'printemps', kart: { body: '#E01E37' } },
  { id: 'm_herbe', slot: 'marks', label: 'Herbe fraîche', emoji: '🌱', price: 500, season: 'printemps', marks: { outline: '#2DC653', glow: '#B5E48C' } },
  { id: 'f_giboulees', slot: 'frame', label: 'Giboulées', emoji: '🌦️', price: 500, season: 'printemps', frame: { ring: 'conic-gradient(#8ECAE6, #FFE066, #B5E48C, #FF8FAB, #8ECAE6)', spin: true, emojis: ['💧', '🌸'], count: 6, top: '🌦️' } },
  { id: 't_coup_soleil', slot: 'title', label: 'Coup de soleil intégral', emoji: '🥵', price: 100, season: 'ete' },
  { id: 't_tong', slot: 'title', label: 'Tong gauche perdue', emoji: '🩴', price: 100, season: 'ete' },
  { id: 'bb_petanque', slot: 'bowling_ball', label: 'Boule de pétanque', emoji: '⚪', price: 100, season: 'ete', bowling: { color: '#9AA3AD', band: '#5C6670' } },
  { id: 'cb_transat', slot: 'card_back', label: 'Transat', emoji: '⛱️', price: 250, season: 'ete', cardBack: { bg: 'repeating-linear-gradient(90deg, #00A6D6 0 12px, #FFFFFF 12px 24px)', emoji: '⛱️' } },
  { id: 'd_piscine', slot: 'dice', label: 'Dés piscine', emoji: '💦', price: 250, season: 'ete', dice: { face: '#48CAE4', edge: '#0096C7', pip: '#FFFFFF' } },
  { id: 'k_canard', slot: 'kart', label: 'Jaune bouée canard', emoji: '🦆', price: 250, season: 'ete', kart: { body: '#FFD60A' } },
  { id: 'f_bouee', slot: 'frame', label: 'Bouée de sauvetage', emoji: '🛟', price: 250, season: 'ete', frame: { ring: 'repeating-conic-gradient(#E63946 0 45deg, #FFFFFF 45deg 90deg)', top: '🛟' } },
  { id: 'm_fluo', slot: 'marks', label: 'Bracelet fluo', emoji: '🟢', price: 500, season: 'ete', marks: { outline: '#39FF14', glow: '#CCFF00' } },
  { id: 'f_coucher_soleil', slot: 'frame', label: 'Coucher de soleil', emoji: '🌅', price: 500, season: 'ete', frame: { ring: 'conic-gradient(#FF7B00, #FF4D6D, #7B2CBF, #FFD166, #FF7B00)', spin: true, top: '🌅' } },
  { id: 't_cartable', slot: 'title', label: 'Cartable trop lourd', emoji: '🎒', price: 100, season: 'automne' },
  { id: 't_bonbon_ou_gage', slot: 'title', label: 'Un bonbon ou un gage', emoji: '🍬', price: 100, season: 'automne' },
  { id: 'gb_citrouille', slot: 'golf_ball', label: 'Balle citrouille', emoji: '🎃', price: 100, season: 'automne', golf: { color: '#F77F00', stripe: '#2D6A4F' } },
  { id: 'f_feuilles', slot: 'frame', label: 'Feuilles mortes', emoji: '🍂', price: 250, season: 'automne', frame: { ring: '#8C4A1F', emojis: ['🍂', '🍁'], count: 6 } },
  { id: 'cb_toile', slot: 'card_back', label: 'Toile d’araignée', emoji: '🕸️', price: 250, season: 'automne', cardBack: { bg: 'repeating-radial-gradient(circle at 50% 50%, transparent 0 9px, rgba(255,255,255,0.35) 9px 10px), repeating-conic-gradient(from 0deg at 50% 50%, rgba(255,255,255,0.35) 0 2deg, transparent 2deg 45deg), #2B1B3D', emoji: '🕷️' } },
  { id: 'd_potion', slot: 'dice', label: 'Dés potion', emoji: '🧪', price: 250, season: 'automne', dice: { face: '#7B2CBF', edge: '#3C096C', pip: '#B5FF3D' } },
  { id: 'k_sorciere', slot: 'kart', label: 'Violet balai volant', emoji: '🧹', price: 250, season: 'automne', kart: { body: '#6A0DAD' } },
  { id: 'm_fantome', slot: 'marks', label: 'Fantôme', emoji: '👻', price: 500, season: 'automne', marks: { outline: '#F4F1EA', glow: '#B388FF', dash: true } },
  { id: 'f_pleine_lune', slot: 'frame', label: 'Pleine lune', emoji: '🌕', price: 500, season: 'automne', frame: { ring: 'conic-gradient(#2B1B3D, #7B2CBF, #F77F00, #7B2CBF, #2B1B3D)', spin: true, emojis: ['🦇'], count: 4, top: '🌕' } },
  { id: 'bb_bucheron', slot: 'bowling_ball', label: 'Boule bûcheron', emoji: '🪓', season: 'hiver', passTier: 5, bowling: { color: '#C1121F', band: '#1B4332' } },
  { id: 'f_forfait', slot: 'frame', label: 'Forfait saison', emoji: '🎿', season: 'hiver', passTier: 10, frame: { ring: 'repeating-linear-gradient(45deg, #1D6FA3 0 6px, #FFFFFF 6px 10px, #E63946 10px 16px, #FFFFFF 16px 20px)', top: '🎿' } },
  { id: 'cb_chalet', slot: 'card_back', label: 'Nuit au chalet', emoji: '🏔️', season: 'hiver', passTier: 15, cardBack: { bg: 'radial-gradient(#FFFFFF 1.5px, transparent 2px) 0 0 / 14px 14px, linear-gradient(180deg, #14213D, #3A5A8C)', emoji: '🏔️' } },
  { id: 't_yeti', slot: 'title', label: 'Yéti de salon', emoji: '🥶', season: 'hiver', passTier: 20 },
  { id: 'd_menthe_eau', slot: 'dice', label: 'Dés menthe à l’eau', emoji: '🥤', season: 'printemps', passTier: 5, dice: { face: '#B8F2D0', edge: '#52B788', pip: '#1B4332' } },
  { id: 'f_nid', slot: 'frame', label: 'Nid douillet', emoji: '🐣', season: 'printemps', passTier: 10, frame: { ring: 'repeating-conic-gradient(#A0703C 0 8deg, #C89B5E 8deg 16deg)', emojis: ['🥚'], count: 5, top: '🐣' } },
  { id: 'bb_tulipe', slot: 'bowling_ball', label: 'Boule tulipe', emoji: '🌷', season: 'printemps', passTier: 15, bowling: { color: '#FF5D8F', band: '#2DC653' } },
  { id: 't_jeune_pousse', slot: 'title', label: 'Jeune pousse pleine d’avenir', emoji: '🌱', season: 'printemps', passTier: 20 },
  { id: 'gb_ballon_plage', slot: 'golf_ball', label: 'Balle ballon de plage', emoji: '🏐', season: 'ete', passTier: 5, golf: { color: '#FFD60A', stripe: '#00A6D6' } },
  { id: 'f_glaces', slot: 'frame', label: 'Marchand de glaces', emoji: '🍦', season: 'ete', passTier: 10, frame: { ring: 'linear-gradient(135deg, #FFC2D4, #FFF6E5 50%, #B8F2D0)', emojis: ['🍦', '🍧', '🍉'], count: 6, top: '🍨' } },
  { id: 'cb_barbecue', slot: 'card_back', label: 'Barbecue', emoji: '🌭', season: 'ete', passTier: 15, cardBack: { bg: 'repeating-linear-gradient(0deg, #1F1B2E 0 4px, transparent 4px 14px), linear-gradient(180deg, #FF5A1F, #FFB703)', emoji: '🌭' } },
  { id: 't_legende_camping', slot: 'title', label: 'Légende du camping', emoji: '🏕️', season: 'ete', passTier: 20 },
  { id: 'bb_chataigne', slot: 'bowling_ball', label: 'Boule châtaigne', emoji: '🌰', season: 'automne', passTier: 5, bowling: { color: '#5C3317', band: '#C89B5E' } },
  { id: 'f_citrouilles', slot: 'frame', label: 'Champ de citrouilles', emoji: '🎃', season: 'automne', passTier: 10, frame: { ring: 'linear-gradient(135deg, #F77F00, #FFB703 50%, #D65A00)', emojis: ['🎃', '👻'], count: 6, top: '🕯️' } },
  { id: 'd_champignon', slot: 'dice', label: 'Dés champignon', emoji: '🍄', season: 'automne', passTier: 15, dice: { face: '#E63946', edge: '#9D0208', pip: '#FFFFFF' } },
  { id: 't_terreur_soirees', slot: 'title', label: 'Terreur des soirées', emoji: '🧛', season: 'automne', passTier: 20 },
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
