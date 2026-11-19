/**
 * Circuits de Dédé Kart : géométrie côté client (le serveur ne connaît que l'ordre des circuits
 * et le temps minimum par tour, cf. `_dk_min_lap_ms` dans supabase/games/dede-kart.sql).
 *
 * Un tracé est une suite de lignes droites et d'arcs de cercle mis bout à bout depuis (0, 0), cap +x
 * (« tortue ») : il doit revenir à son point de départ. Les aménagements (turbos, tremplins, boîtes,
 * flaques, obstacles mobiles) sont posés sur un segment, à une position 0..1 le long de celui-ci.
 */
export interface Seg {
  /** Ligne droite : longueur. */
  s?: number
  /** Virage à gauche / à droite : rayon (≥ 26)… */
  l?: number
  r?: number
  /** …et angle en degrés. */
  a?: number
  /** Largeur de la piste × w sur ce segment (section large ou étroite, transitions adoucies). */
  w?: number
  /** Dalles turbo. */
  boost?: number[]
  /** Tremplins (saut si on arrive vite). */
  jump?: number[]
  /** Bosses (petit saut). */
  bump?: number[]
  /** Rangées de boîtes « ? ». */
  box?: number[]
  /** Flaques glissantes : [position, écart latéral -1..1]. */
  puddle?: [number, number][]
  /** Obstacles mobiles qui traversent la piste : [position, période en secondes]. */
  mover?: [number, number][]
  /** Départ (`in`) ou retour (`out`) du raccourci, à cette position. */
  cut?: ['in' | 'out', number]
}

export type Decor = 'blocks' | 'parasols' | 'pines' | 'garden' | 'market' | 'castle'

export interface TrackDef {
  id: string
  name: string
  emoji: string
  /** Largeur de base de la piste (unités monde). */
  width: number
  path: Seg[]
  /** Raccourci : largeur, longueur des tangentes (forme de la courbe), flaques posées dessus (position 0..1, décalées sur un côté). */
  cutWidth?: number
  cutK?: number
  cutPuddles?: number[]
  /** Nom du raccourci et des pièges (affichage, doc). */
  cutName: string
  moverName: string
  puddleName: string
  /** Style du décor posé autour de la piste. */
  decor: Decor
  colors: { sky: string; ground: string; road: string; kerbA: string; kerbB: string; cut: string; puddle: string; decor: string[] }
}

/** Nombre de checkpoints par tour (identique pour tous les circuits). */
export const CHECKPOINTS = 8

/** Ordre = ordre des coupes : le serveur joue le circuit (1er circuit + n° de course − 1) % 6. */
export const TRACKS: TrackDef[] = [
  {
    id: 'salon',
    name: 'Circuit du Salon',
    emoji: '🛋️',
    width: 15,
    path: [
      { s: 110, boost: [0.4], box: [0.8] },
      { l: 50, a: 90 },
      { s: 40, puddle: [[0.5, 0.4]] },
      { l: 32, a: 90 },
      { s: 50, bump: [0.25, 0.6] },
      { r: 28, a: 180 },
      { s: 60, w: 0.72, box: [0.6] },
      { l: 30, a: 90 },
      { s: 30 },
      { l: 45, a: 90 },
      { s: 150, w: 1.5, boost: [0.1], box: [0.25], mover: [[0.45, 3.4], [0.8, 2.7]] },
      { l: 35, a: 90 },
      { s: 50, puddle: [[0.4, -0.35]] },
      { r: 30, a: 90, w: 0.72 },
      { s: 40, w: 0.72 },
      { r: 30, a: 90 },
      { s: 40, cut: ['in', 0] },
      { l: 30, a: 180, puddle: [[0.5, 0.3]] },
      { s: 150, cut: ['out', 0.27], box: [0.5], jump: [0.7] },
      { l: 30, a: 90 },
      { s: 60, boost: [0.2] },
      { r: 30, a: 90 },
      { l: 28, a: 90 },
      { s: 74 },
    ],
    cutK: 40,
    cutName: 'Sous le canapé',
    moverName: 'aspirateurs robots',
    puddleName: 'jus de fruit renversé',
    decor: 'blocks',
    colors: {
      sky: '#9ADCFF',
      ground: '#F2C894',
      road: '#5B5F77',
      kerbA: '#FF5A5F',
      kerbB: '#FFFFFF',
      cut: '#B98A5E',
      puddle: '#FF9F1C',
      decor: ['#FF5A5F', '#FFD23F', '#4CC9F0', '#7AE582', '#B388FF'],
    },
  },
  {
    id: 'plage',
    name: 'Plage Tongs-Palace',
    emoji: '🏖️',
    width: 16,
    path: [
      { s: 100, boost: [0.35], box: [0.75] },
      { l: 70, a: 60, w: 1.3 },
      { r: 70, a: 60, w: 1.3, puddle: [[0.5, -0.4]] },
      { s: 30, jump: [0.1] },
      { l: 55, a: 180, box: [0.5] },
      { s: 40, mover: [[0.5, 3]] },
      { r: 40, a: 90 },
      { s: 30, bump: [0.5] },
      { l: 40, a: 90 },
      { s: 10, cut: ['in', 0.5] },
      { r: 28, a: 90 },
      { s: 10 },
      { l: 28, a: 90 },
      { s: 50, box: [0.5] },
      { l: 28, a: 90 },
      { s: 10 },
      { r: 28, a: 90 },
      { s: 10, cut: ['out', 0.5] },
      { l: 45, a: 90 },
      { s: 40, puddle: [[0.5, 0.3]] },
      { l: 35, a: 90 },
      { s: 100, w: 0.75, boost: [0.5] },
      { r: 30, a: 180 },
      { s: 170, w: 1.4, box: [0.5], mover: [[0.3, 3.2], [0.65, 2.5]], jump: [0.8] },
      { l: 40, a: 90 },
      { s: 30 },
      { l: 40, a: 90 },
      { s: 130.76 },
    ],
    cutWidth: 6.5,
    cutPuddles: [0.5],
    cutName: 'Le ponton',
    moverName: 'crabes',
    puddleName: 'flaques d’eau de mer',
    decor: 'parasols',
    colors: {
      sky: '#7FD1FF',
      ground: '#F7D9A0',
      road: '#6E4A33',
      kerbA: '#2EC4B6',
      kerbB: '#FFFFFF',
      cut: '#C9A26B',
      puddle: '#4CC9F0',
      decor: ['#FF5A5F', '#FFD23F', '#2EC4B6', '#FF8C42', '#4CC9F0'],
    },
  },
  {
    id: 'montagne',
    name: 'Montagne Raclette',
    emoji: '🏔️',
    width: 14,
    path: [
      { s: 100, box: [0.8] },
      { l: 40, a: 90 },
      { s: 60, jump: [0.3] },
      { l: 30, a: 90 },
      { s: 60, puddle: [[0.5, 0.3]] },
      { r: 27, a: 180 },
      { s: 80, cut: ['in', 0.5], bump: [0.2] },
      { l: 27, a: 180, box: [0.5] },
      { s: 100, cut: ['out', 0.4], boost: [0.65] },
      { r: 27, a: 180 },
      { s: 60, w: 0.75, puddle: [[0.6, -0.3]] },
      { l: 35, a: 90 },
      { s: 30 },
      { l: 40, a: 90 },
      { s: 180, w: 1.45, box: [0.12], jump: [0.5], mover: [[0.28, 3], [0.57, 2.4]] },
      { l: 40, a: 90 },
      { s: 70, boost: [0.3] },
      { l: 50, a: 45 },
      { r: 50, a: 90, box: [0.5] },
      { l: 50, a: 45 },
      { s: 105.58, jump: [0.25], puddle: [[0.75, 0.2]] },
      { l: 40, a: 90 },
      { s: 95 },
    ],
    cutK: 38,
    cutName: 'La piste noire',
    moverName: 'meules de fromage',
    puddleName: 'plaques de verglas',
    decor: 'pines',
    colors: {
      sky: '#8EC5F4',
      ground: '#EEF4FF',
      road: '#5B5F77',
      kerbA: '#3A86FF',
      kerbB: '#FFFFFF',
      cut: '#9FB7D9',
      puddle: '#CFEFFF',
      decor: ['#2D6A4F', '#40916C', '#1B4332', '#52B788'],
    },
  },
  {
    id: 'potager',
    name: 'Potager Turbo-Carotte',
    emoji: '🥕',
    width: 15,
    path: [
      { s: 120, boost: [0.4], box: [0.8] },
      { l: 45, a: 90 },
      { s: 30 },
      { r: 40, a: 60 },
      { l: 40, a: 120, puddle: [[0.5, 0.5]] },
      { r: 40, a: 120, box: [0.5] },
      { l: 40, a: 120, puddle: [[0.5, 0.5]] },
      { r: 40, a: 60 },
      { s: 20, bump: [0.5] },
      { l: 35, a: 90 },
      { s: 60, cut: ['in', 0.95] },
      { r: 30, a: 90 },
      { l: 50, a: 180, box: [0.5] },
      { r: 30, a: 90 },
      { s: 50, cut: ['out', 0.05] },
      { l: 40, a: 90 },
      { s: 60, boost: [0.4] },
      { r: 60, a: 40, w: 1.4 },
      { l: 60, a: 80, w: 1.4, mover: [[0.3, 3.2], [0.75, 2.6]] },
      { r: 60, a: 40, w: 1.4 },
      { s: 112.86, box: [0.1], bump: [0.3, 0.42], jump: [0.6] },
      { l: 40, a: 90 },
      { s: 140, mover: [[0.3, 2.8]] },
    ],
    cutWidth: 6.5,
    cutPuddles: [0.5],
    cutName: 'À travers les salades',
    moverName: 'citrouilles qui roulent',
    puddleName: 'flaques d’arrosage',
    decor: 'garden',
    colors: {
      sky: '#A6E3FF',
      ground: '#8FD46A',
      road: '#B8875A',
      kerbA: '#FF8C42',
      kerbB: '#FFF3D6',
      cut: '#7A5536',
      puddle: '#5FB8E8',
      decor: ['#FF8C42', '#E63946', '#7AE582', '#FFD23F', '#9B5DE5'],
    },
  },
  {
    id: 'supermarche',
    name: 'Hyper Dédé Promo',
    emoji: '🛒',
    width: 16,
    path: [
      { s: 130, w: 1.4, boost: [0.3, 0.65], box: [0.92] },
      { l: 30, a: 90 },
      { s: 170, box: [0.5], mover: [[0.3, 3], [0.7, 2.4]] },
      { l: 26, a: 90 },
      { s: 30 },
      { l: 26, a: 90 },
      { s: 90, cut: ['in', 0.5], puddle: [[0.25, 0.3]] },
      { r: 26, a: 90 },
      { s: 20, box: [0.5] },
      { r: 26, a: 90 },
      { s: 90, cut: ['out', 0.5] },
      { l: 26, a: 90 },
      { s: 30, bump: [0.5] },
      { l: 26, a: 90 },
      { s: 90, w: 0.72 },
      { r: 26, a: 90 },
      { s: 20 },
      { r: 26, a: 90 },
      { s: 90, box: [0.85], mover: [[0.45, 2.6]] },
      { l: 26, a: 90 },
      { s: 30 },
      { l: 26, a: 90 },
      { s: 164, w: 1.35, boost: [0.15], puddle: [[0.45, -0.4], [0.55, 0.4]], jump: [0.72] },
      { l: 36, a: 90 },
      { s: 194, box: [0.35] },
    ],
    cutK: 48,
    cutName: 'Le rayon promo',
    moverName: 'caddies fous',
    puddleName: 'lait renversé',
    decor: 'market',
    colors: {
      sky: '#DDEBFA',
      ground: '#E9E4DA',
      road: '#4D556B',
      kerbA: '#E63946',
      kerbB: '#FFD23F',
      cut: '#8FA3BF',
      puddle: '#FFFFFF',
      decor: ['#E63946', '#FFD23F', '#3A86FF', '#2EC4B6', '#FF8C42', '#9B5DE5'],
    },
  },
  {
    id: 'chateau',
    name: 'Château Saint-Glinglin',
    emoji: '🏰',
    width: 15,
    path: [
      { s: 120, boost: [0.4], box: [0.8] },
      { l: 80, a: 90, w: 1.3 },
      { s: 90, jump: [0.35], puddle: [[0.85, 0.3]] },
      { l: 80, a: 90, w: 1.3, box: [0.5] },
      { s: 40 },
      { l: 30, a: 90 },
      { s: 40, bump: [0.5] },
      { r: 28, a: 180 },
      { s: 20 },
      { l: 28, a: 180, box: [0.5] },
      { s: 60, cut: ['in', 0.33] },
      { r: 28, a: 180, puddle: [[0.5, 0.2]] },
      { s: 90, cut: ['out', 0.44], boost: [0.7] },
      { l: 30, a: 90 },
      { s: 20 },
      { l: 80, a: 90, w: 1.4, mover: [[0.4, 3.2], [0.75, 2.6]] },
      { s: 120, w: 0.72, box: [0.3], puddle: [[0.7, -0.3]] },
      { l: 60, a: 90 },
      { s: 188, mover: [[0.2, 2.8]], jump: [0.45] },
    ],
    cutK: 37,
    cutName: 'Le passage secret',
    moverName: 'tonneaux qui roulent',
    puddleName: 'flaques de boue',
    decor: 'castle',
    colors: {
      sky: '#FFC9A3',
      ground: '#7FB069',
      road: '#8A8578',
      kerbA: '#9D2235',
      kerbB: '#F4E9CD',
      cut: '#5E5A52',
      puddle: '#6B4A2B',
      decor: ['#9D2235', '#F4C430', '#3A5FCD', '#F4E9CD', '#5B8C5A'],
    },
  },
]
