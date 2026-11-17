/** Circuits de Dédé Kart : géométrie côté client (le serveur ne connaît que l'ordre des circuits et le temps minimum par tour). */
export interface TrackDef {
  id: string
  name: string
  emoji: string
  /** Largeur de la piste (unités monde). */
  width: number
  /** Points de contrôle [x, z] de la boucle fermée (spline Catmull-Rom). Rayon de virage ≥ 22 partout. */
  points: [number, number][]
  /** Dalles turbo : [début, fin] en fraction du tour (0..1). */
  boosts: [number, number][]
  /** Tremplins : [début, fin] en fraction du tour (saut si on arrive vite). */
  jumps: [number, number][]
  /** Style du décor posé autour de la piste. */
  decor: 'blocks' | 'parasols' | 'pines'
  colors: { sky: string; ground: string; road: string; kerbA: string; kerbB: string; decor: string[] }
}

/** Nombre de checkpoints par tour (identique pour tous les circuits). */
export const CHECKPOINTS = 8

/** Ordre = ordre de la coupe (le serveur joue le circuit (course - 1) % 3). */
export const TRACKS: TrackDef[] = [
  {
    id: 'salon',
    name: 'Circuit du Salon',
    emoji: '🛋️',
    width: 15,
    points: [
      [0, 0], [60, 0], [112, -18], [134, -70], [108, -124], [50, -136], [10, -168],
      [-52, -184], [-106, -156], [-124, -98], [-104, -46], [-64, -10],
    ],
    boosts: [[0.07, 0.085], [0.56, 0.575]],
    jumps: [],
    decor: 'blocks',
    colors: {
      sky: '#9ADCFF',
      ground: '#F2C894',
      road: '#5B5F77',
      kerbA: '#FF5A5F',
      kerbB: '#FFFFFF',
      decor: ['#FF5A5F', '#FFD23F', '#4CC9F0', '#7AE582', '#B388FF'],
    },
  },
  {
    id: 'plage',
    name: 'Plage Tongs-Palace',
    emoji: '🏖️',
    width: 16,
    points: [
      [0, 0], [90, 0], [160, 6], [196, -36], [184, -96], [128, -116], [70, -100],
      [10, -128], [-56, -156], [-118, -128], [-134, -66], [-84, -18],
    ],
    boosts: [[0.3, 0.315], [0.82, 0.835]],
    jumps: [[0.12, 0.13]],
    decor: 'parasols',
    colors: {
      sky: '#7FD1FF',
      ground: '#F7D9A0',
      road: '#6E4A33',
      kerbA: '#2EC4B6',
      kerbB: '#FFFFFF',
      decor: ['#FF5A5F', '#FFD23F', '#2EC4B6', '#FF8C42', '#4CC9F0'],
    },
  },
  {
    id: 'montagne',
    name: 'Montagne Raclette',
    emoji: '🏔️',
    width: 14,
    points: [
      [0, 0], [60, -2], [110, -30], [122, -84], [86, -124], [30, -130], [-6, -164],
      [-26, -210], [-84, -230], [-140, -198], [-150, -140], [-160, -84], [-138, -28], [-74, 6],
    ],
    boosts: [[0.24, 0.255], [0.7, 0.715]],
    jumps: [[0.4, 0.41], [0.9, 0.91]],
    decor: 'pines',
    colors: {
      sky: '#BFE3FF',
      ground: '#EEF4FF',
      road: '#5B5F77',
      kerbA: '#3A86FF',
      kerbB: '#FFFFFF',
      decor: ['#2D6A4F', '#40916C', '#1B4332', '#52B788'],
    },
  },
]
