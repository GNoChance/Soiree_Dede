/**
 * Plateau « Le Tour des Potes » — 40 cases, indices 0-39 dans le sens horaire.
 *
 * Les NOMS, ANECDOTES et descriptions des lieux vivent ICI (front uniquement).
 * Les valeurs ÉCONOMIQUES (type, group, price, house, rents, amount) sont le
 * miroir EXACT de `_tdp_board()` dans supabase/games/tour-des-potes.sql :
 * toute modification doit être faite des deux côtés (le test PGlite
 * test-tour-des-potes.mjs vérifie la synchro).
 *
 * Lieux réels : table `LIEUX` ci-dessous (+ `anecdote`, affichée sur tous les
 * écrans quand un joueur s'y arrête — à compléter avec les souvenirs de la bande).
 *
 * Fichier autonome (aucun import) : importable tel quel sous Node.
 */

export type CellType =
  | 'depart'
  | 'quartier'
  | 'potes'
  | 'service'
  | 'taxe'
  | 'hasard'
  | 'entre_potes'
  | 'violon'
  | 'apero'
  | 'direction_violon'

export type CityId = 'bayon' | 'pugnac' | 'berson' | 'bordeaux'

/** Quartiers de couleur (2 par ville) + familles des maisons des potes et des services. */
export type GroupId =
  | 'bayon-1'
  | 'bayon-2'
  | 'pugnac-1'
  | 'pugnac-2'
  | 'berson-1'
  | 'berson-2'
  | 'bordeaux-1'
  | 'bordeaux-2'
  | 'potes'
  | 'service'

export interface BoardCell {
  /** Index sur le plateau (0 = Départ). */
  i: number
  type: CellType
  /** Nom affiché (provisoire pour les lieux). */
  name: string
  /** Petit texte affiché quand un joueur s'arrête sur la case (vide = rien). */
  anecdote: string
  /** Description plus longue (fiche du lieu), optionnelle. */
  description?: string
  emoji?: string
  /** Ville (lieux, maisons des potes). */
  city?: CityId
  /** Quartier / famille (achetables). */
  group?: GroupId
  /** Couleur du bandeau (quartiers). */
  color?: string
  /** Prix d'achat (achetables). */
  price?: number
  /** Prix d'une maison (quartiers ; l'hôtel coûte une 5e maison). */
  house?: number
  /** Loyers des quartiers : [nu, 1 maison, 2, 3, 4, hôtel] (nu ×2 si quartier complet sans bâtiment). */
  rents?: number[]
  /** Montant d'une taxe. */
  amount?: number
}

export const CITIES: Record<CityId, { name: string; short: string }> = {
  bayon: { name: 'Bayon-sur-Gironde', short: 'Bayon' },
  pugnac: { name: 'Pugnac', short: 'Pugnac' },
  berson: { name: 'Berson', short: 'Berson' },
  bordeaux: { name: 'Bordeaux', short: 'Bordeaux' },
}

/** Quartiers de couleur, par prix croissant. */
export const GROUPS: Record<Exclude<GroupId, 'potes' | 'service'>, { city: CityId; color: string; label: string }> = {
  'bayon-1': { city: 'bayon', color: '#8B5A2B', label: 'Bayon (1)' },
  'bayon-2': { city: 'bayon', color: '#7DD3FC', label: 'Bayon (2)' },
  'pugnac-1': { city: 'pugnac', color: '#EC4899', label: 'Pugnac (1)' },
  'pugnac-2': { city: 'pugnac', color: '#F97316', label: 'Pugnac (2)' },
  'berson-1': { city: 'berson', color: '#EF4444', label: 'Berson (1)' },
  'berson-2': { city: 'berson', color: '#FACC15', label: 'Berson (2)' },
  'bordeaux-1': { city: 'bordeaux', color: '#22C55E', label: 'Bordeaux (1)' },
  'bordeaux-2': { city: 'bordeaux', color: '#2563EB', label: 'Bordeaux (2)' },
}

/**
 * Lieux réels de chaque ville, du moins cher au plus cher (n = rang dans la ville).
 * `anecdote` : souvenir de la bande, affiché sur tous les écrans quand on s'y arrête (à compléter).
 */
const LIEUX: Record<CityId, { name: string; description: string; anecdote?: string }[]> = {
  bayon: [
    { name: 'Balade des lavoirs', description: 'Circuit de randonnée qui passe par les lavoirs de la commune.' },
    { name: 'Château Tayac', description: 'Demeure reconstruite en 1892, qui domine l’estuaire de la Gironde.' },
    { name: 'Route de la Corniche', description: 'Route le long de l’estuaire, de Gauriac à Bayon, site inscrit depuis 1983.' },
    { name: 'Château Falfas', description: 'Château viticole du XVIIe siècle, monument historique depuis 2008.' },
    { name: 'Église Notre-Dame', description: 'Ancienne église prieurale : clocher et abside du XIIe siècle classés.' },
  ],
  pugnac: [
    { name: 'Monument aux morts', description: 'Le monument aux morts de Pugnac, près de la mairie.' },
    { name: 'Chapelle Saint-Urbain', description: 'Petit sanctuaire sans doute du XVIIe siècle, restauré en 1988.' },
    { name: 'Villa gallo-romaine', description: 'Villa gallo-romaine découverte au lieu-dit Lassalle, près du Moron.' },
    { name: 'Château de Calmeilh', description: 'Ancien château fortifié, reconstruit au XVIIIe siècle, à Lafosse.' },
    { name: 'Église Notre-Dame', description: 'Église néo-romane bâtie à partir de 1861.' },
    { name: 'Église de Lafosse', description: 'Église romane Saint-Sulpice (XIe-XIIe s.), classée en 2009.' },
  ],
  berson: [
    { name: 'Bourg de Berson', description: 'Le cœur de la commune : mairie, école, poste et salle des fêtes.' },
    { name: 'La Cibarde', description: 'Lieu-dit au point culminant de la commune (environ 90 m).' },
    { name: 'Monument du Cau', description: 'Souvenir du combat du 19 août 1944, l’un des derniers de la guerre ici.' },
    { name: 'Château Puynard', description: 'Château viticole de Berson.' },
    { name: 'Maison forte du Boisset', description: 'Maison forte des XVe-XVIIe siècles entourée de fossés.' },
    { name: 'Église Saint-Saturnin', description: 'Église d’origine XIIe siècle, classée monument historique en 1909.' },
  ],
  bordeaux: [
    { name: 'Rue Sainte-Catherine', description: 'La grande rue piétonne commerçante, de la Comédie à la Victoire.' },
    { name: 'Cité du Vin', description: 'Le musée du vin aux Bassins à flot, ouvert en 2016.' },
    { name: 'Grand-Théâtre', description: 'Théâtre néo-classique de Victor Louis, inauguré en 1780.' },
    { name: 'Parc Bordelais', description: 'Le grand parc paysager du XIXe siècle, à Caudéran.' },
    { name: 'Stade Chaban-Delmas', description: 'L’ancien Parc Lescure (1938), aujourd’hui le stade de l’UBB.' },
  ],
}

type Lieu = Pick<BoardCell, 'i' | 'price' | 'house' | 'rents'> & { group: keyof typeof GROUPS; n: number }

const lieu = ({ i, group, n, price, house, rents }: Lieu): BoardCell => ({
  i,
  type: 'quartier',
  name: LIEUX[GROUPS[group].city][n - 1]?.name ?? `${CITIES[GROUPS[group].city].short} — lieu ${n}`,
  description: LIEUX[GROUPS[group].city][n - 1]?.description,
  anecdote: LIEUX[GROUPS[group].city][n - 1]?.anecdote ?? '',
  city: GROUPS[group].city,
  group,
  color: GROUPS[group].color,
  price,
  house,
  rents,
})

export const BOARD: BoardCell[] = [
  { i: 0, type: 'depart', name: 'Départ', emoji: '🏁', anecdote: '' },
  lieu({ i: 1, group: 'bayon-1', n: 1, price: 60, house: 50, rents: [2, 10, 30, 90, 160, 250] }),
  { i: 2, type: 'entre_potes', name: 'Entre potes', emoji: '🍻', anecdote: '' },
  lieu({ i: 3, group: 'bayon-1', n: 2, price: 60, house: 50, rents: [4, 20, 60, 180, 320, 450] }),
  { i: 4, type: 'taxe', name: 'Cotisation apéro', emoji: '🥂', amount: 200, anecdote: '' },
  { i: 5, type: 'potes', name: 'Chez Dédé & Nini', emoji: '🏡', city: 'bayon', group: 'potes', price: 200, anecdote: '' },
  lieu({ i: 6, group: 'bayon-2', n: 3, price: 100, house: 50, rents: [6, 30, 90, 270, 400, 550] }),
  { i: 7, type: 'hasard', name: 'Hasard', emoji: '❓', anecdote: '' },
  lieu({ i: 8, group: 'bayon-2', n: 4, price: 100, house: 50, rents: [6, 30, 90, 270, 400, 550] }),
  lieu({ i: 9, group: 'bayon-2', n: 5, price: 120, house: 50, rents: [8, 40, 100, 300, 450, 600] }),
  { i: 10, type: 'violon', name: 'En visite / Au violon', emoji: '🚔', anecdote: '' },
  lieu({ i: 11, group: 'pugnac-1', n: 1, price: 140, house: 100, rents: [10, 50, 150, 450, 625, 750] }),
  { i: 12, type: 'service', name: 'Bac Blaye–Lamarque', emoji: '⛴️', group: 'service', price: 150, anecdote: '', description: 'Le bac du Département qui traverse l’estuaire entre Blaye et Lamarque.' },
  lieu({ i: 13, group: 'pugnac-1', n: 2, price: 140, house: 100, rents: [10, 50, 150, 450, 625, 750] }),
  lieu({ i: 14, group: 'pugnac-1', n: 3, price: 160, house: 100, rents: [12, 60, 180, 500, 700, 900] }),
  { i: 15, type: 'potes', name: 'Chez Cécile & Mika', emoji: '🏡', city: 'pugnac', group: 'potes', price: 200, anecdote: '' },
  lieu({ i: 16, group: 'pugnac-2', n: 4, price: 180, house: 100, rents: [14, 70, 200, 550, 750, 950] }),
  { i: 17, type: 'entre_potes', name: 'Entre potes', emoji: '🍻', anecdote: '' },
  lieu({ i: 18, group: 'pugnac-2', n: 5, price: 180, house: 100, rents: [14, 70, 200, 550, 750, 950] }),
  lieu({ i: 19, group: 'pugnac-2', n: 6, price: 200, house: 100, rents: [16, 80, 220, 600, 800, 1000] }),
  { i: 20, type: 'apero', name: 'Pause apéro', emoji: '🍹', anecdote: '' },
  lieu({ i: 21, group: 'berson-1', n: 1, price: 220, house: 150, rents: [18, 90, 250, 700, 875, 1050] }),
  { i: 22, type: 'hasard', name: 'Hasard', emoji: '❓', anecdote: '' },
  lieu({ i: 23, group: 'berson-1', n: 2, price: 220, house: 150, rents: [18, 90, 250, 700, 875, 1050] }),
  lieu({ i: 24, group: 'berson-1', n: 3, price: 240, house: 150, rents: [20, 100, 300, 750, 925, 1100] }),
  { i: 25, type: 'potes', name: 'Chez Karo, Manon & Marius', emoji: '🏡', city: 'berson', group: 'potes', price: 200, anecdote: '' },
  lieu({ i: 26, group: 'berson-2', n: 4, price: 260, house: 150, rents: [22, 110, 330, 800, 975, 1150] }),
  lieu({ i: 27, group: 'berson-2', n: 5, price: 260, house: 150, rents: [22, 110, 330, 800, 975, 1150] }),
  { i: 28, type: 'service', name: 'Cave de l’Alliance', emoji: '🍷', group: 'service', price: 150, anecdote: '', description: 'La cave coopérative des Côtes de Bourg, à Pugnac.' },
  lieu({ i: 29, group: 'berson-2', n: 6, price: 280, house: 150, rents: [24, 120, 360, 850, 1025, 1200] }),
  { i: 30, type: 'direction_violon', name: 'Direction le violon', emoji: '👮', anecdote: '' },
  lieu({ i: 31, group: 'bordeaux-1', n: 1, price: 300, house: 200, rents: [26, 130, 390, 900, 1100, 1275] }),
  lieu({ i: 32, group: 'bordeaux-1', n: 2, price: 300, house: 200, rents: [26, 130, 390, 900, 1100, 1275] }),
  { i: 33, type: 'entre_potes', name: 'Entre potes', emoji: '🍻', anecdote: '' },
  lieu({ i: 34, group: 'bordeaux-1', n: 3, price: 320, house: 200, rents: [28, 150, 450, 1000, 1200, 1400] }),
  { i: 35, type: 'potes', name: 'Chez Cycy & Kev', emoji: '🏡', city: 'bordeaux', group: 'potes', price: 200, anecdote: '' },
  { i: 36, type: 'hasard', name: 'Hasard', emoji: '❓', anecdote: '' },
  lieu({ i: 37, group: 'bordeaux-2', n: 4, price: 350, house: 200, rents: [35, 175, 500, 1100, 1300, 1500] }),
  { i: 38, type: 'taxe', name: 'Amende de voisinage', emoji: '📯', amount: 100, anecdote: '' },
  lieu({ i: 39, group: 'bordeaux-2', n: 5, price: 400, house: 200, rents: [50, 200, 600, 1400, 1700, 2000] }),
]

/** Cases constantes. */
export const GO_CELL = 0
export const JAIL_CELL = 10
export const GO_AMOUNT = 200
export const JAIL_FINE = 50
export const START_CASH = 1500
/** Loyers des maisons des potes selon le nombre possédé (1 à 4). */
export const POTES_RENTS = [25, 50, 100, 200]
/** Multiplicateur des dés pour les services (1 ou 2 possédés). */
export const SERVICE_MULT = [4, 10]
/** Noms des paquets de cartes. */
export const DECK_NAMES = { hasard: 'Hasard', potes: 'Entre potes' } as const
