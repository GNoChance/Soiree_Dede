/** Circuits de Dédé Kart : géométrie côté client (le serveur ne connaît que les checkpoints). */
export interface TrackDef {
  id: string
  name: string
  /** Largeur de la piste (unités monde). */
  width: number
  /** Points de contrôle [x, z] de la boucle fermée (spline Catmull-Rom). */
  points: [number, number][]
  /** Dalles turbo : [début, fin] en fraction du tour (0..1). */
  boosts: [number, number][]
  colors: { sky: string; ground: string; road: string; kerbA: string; kerbB: string; decor: string[] }
}

/** Nombre de checkpoints par tour (identique pour tous les circuits, connu du serveur). */
export const CHECKPOINTS = 8

export const TRACKS: TrackDef[] = [
  {
    id: 'salon',
    name: 'Circuit du Salon',
    width: 15,
    points: [
      [0, 0], [60, 0], [112, -18], [132, -70], [104, -122], [44, -132], [8, -172],
      [-52, -184], [-104, -152], [-114, -92], [-72, -52], [-92, -4], [-52, 16],
    ],
    boosts: [[0.07, 0.085], [0.56, 0.575]],
    colors: {
      sky: '#9ADCFF',
      ground: '#F2C894',
      road: '#5B5F77',
      kerbA: '#FF5A5F',
      kerbB: '#FFFFFF',
      decor: ['#FF5A5F', '#FFD23F', '#4CC9F0', '#7AE582', '#B388FF'],
    },
  },
]
