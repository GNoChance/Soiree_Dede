/**
 * Parcours « La Kermesse du village » : 9 trous décrits en DONNÉES (primitives déclaratives),
 * lus par la physique (scene/physics.ts, cannon-es) et le rendu (scene/Course.ts, three).
 * Ajouter un trou = ajouter un objet. Aucun import : ce fichier est aussi lu par les tests.
 *
 * Repère : sol en y = 0, le départ (tee) vers +Z (bas de l'écran), le trou vers −Z (haut de l'écran),
 * +X à droite. Unités « mini-golf » : balle de rayon 0,1, pistes de 1,6 à 4 de large.
 * Les pars sont DUPLIQUÉS côté serveur (`_mg_course()` de supabase/games/mini-golf.sql) :
 * le test SQL vérifie la synchro (une ligne `par: n,` par trou, dans l'ordre).
 */

export type V2 = readonly [number, number]

export type Skin = 'grass' | 'wood' | 'green' | 'sand'

export type Piece =
  /** Dalle plate : dessus en y (défaut 0). */
  | { kind: 'floor'; x0: number; x1: number; z0: number; z1: number; y?: number; skin?: Skin }
  /** Rampe inclinée le long de Z : hauteur y0 en z0, y1 en z1. */
  | { kind: 'ramp'; x0: number; x1: number; z0: number; z1: number; y0: number; y1: number; skin?: Skin }
  /** Bordure (segment a → b), du bas `y0` (défaut −0,1) au sommet `top` (défaut 0,3). */
  | { kind: 'wall'; a: V2; b: V2; y0?: number; top?: number }
  /** Plot fixe (cylindre). */
  | { kind: 'post'; x: number; z: number; r: number; style?: 'pin' | 'barrel' }
  /** Bumper : renvoie la balle plus fort. */
  | { kind: 'bumper'; x: number; z: number; r: number; color?: string }
  /** Moulin : maison de x0 à x1 (façade en z = front, profondeur `depth`), tunnel |x − cx| < gap, pales devant. */
  | { kind: 'mill'; cx: number; x0: number; x1: number; front: number; depth: number; gap: number }
  /** Looping scripté : entrée/sortie en z (bas du cercle), rayon r ; la balle ressort décalée de x0 à x1. */
  | { kind: 'loop'; z: number; r: number; x0: number; x1: number; halfWidth: number }

export interface Rect {
  x0: number
  x1: number
  z0: number
  z1: number
}

export type DecorKind = 'tent' | 'tree' | 'flags' | 'bell' | 'stand' | 'lamp'

export interface Decor {
  kind: DecorKind
  x: number
  z: number
  /** Rotation (rad) autour de Y. */
  rot?: number
  color?: string
  /** flags : point d'arrivée de la guirlande. */
  to?: V2
}

export interface HoleDef {
  /** N° du trou dans le parcours complet (1..9) = id serveur. */
  id: number
  name: string
  /** Obstacle en quelques mots (annonce du trou). */
  blurb: string
  par: number
  tee: V2
  cup: V2
  /** Hauteur du sol au trou (green surélevé, cuvette). */
  cupY?: number
  pieces: Piece[]
  /** Zones d'eau (la balle qui tombe dedans : +1 coup, retour au point de frappe). */
  water?: Rect[]
  decor?: Decor[]
  /** Ligne médiane départ → trou (survol de l'annonce, solveur de test). */
  route: V2[]
}

/* -------------------------------------------------------------------------- */
/* Aides                                                                      */
/* -------------------------------------------------------------------------- */

/** Bordures d'un polygone fermé. */
function ring(pts: V2[], y0?: number, top?: number): Piece[] {
  return pts.map((a, i) => ({ kind: 'wall' as const, a, b: pts[(i + 1) % pts.length], y0, top }))
}

/** Bordures d'un rectangle. */
const frame = (x0: number, x1: number, z0: number, z1: number, y0?: number, top?: number) =>
  ring([[x0, z1], [x0, z0], [x1, z0], [x1, z1]], y0, top)

const flags = (x: number, z: number, to: V2): Decor => ({ kind: 'flags', x, z, to })

/* -------------------------------------------------------------------------- */
/* Les 9 trous                                                                */
/* -------------------------------------------------------------------------- */

export const HOLES: HoleDef[] = [
  {
    id: 1,
    name: 'L’Échauffement',
    blurb: 'Tout droit, pour apprendre le geste',
    par: 2,
    tee: [0, 3.4],
    cup: [0, -3.3],
    pieces: [{ kind: 'floor', x0: -0.8, x1: 0.8, z0: -4.3, z1: 4.3 }, ...frame(-0.8, 0.8, -4.3, 4.3)],
    decor: [
      { kind: 'tent', x: -2.1, z: -1.5, color: '#FF5D73' },
      { kind: 'tent', x: 2.1, z: 1.2, rot: Math.PI, color: '#4CC9F0' },
      { kind: 'tree', x: 1.8, z: -3.4 },
      { kind: 'tree', x: -1.9, z: 3.2 },
      flags(-1.6, -4.8, [1.6, -4.8]),
    ],
    route: [[0, 3.4], [0, -3.3]],
  },
  {
    id: 2,
    name: 'Le Virage du Boulanger',
    blurb: 'Un coude à angle droit : joue la bande !',
    par: 2,
    tee: [-1.2, 3.0],
    cup: [1.35, -2.7],
    pieces: [
      { kind: 'floor', x0: -2, x1: -0.4, z0: -3.6, z1: 3.8 },
      { kind: 'floor', x0: -2, x1: 2.2, z0: -3.6, z1: -1.8 },
      ...ring([[-2, 3.8], [-2, -3.6], [2.2, -3.6], [2.2, -1.8], [-0.4, -1.8], [-0.4, 3.8]]),
    ],
    decor: [
      { kind: 'stand', x: 1.0, z: 1.2, color: '#FFB627' },
      { kind: 'tree', x: 1.7, z: 3.2 },
      { kind: 'tree', x: -2.8, z: -0.4 },
      flags(-2.4, -4.2, [2.6, -4.2]),
    ],
    route: [[-1.2, 3.0], [-1.2, -2.7], [1.35, -2.7]],
  },
  {
    id: 3,
    name: 'Les Quilles de Dédé',
    blurb: '5 plots en quinconce, comme au bowling',
    par: 3,
    tee: [0, 3.6],
    cup: [0, -3.6],
    pieces: [
      { kind: 'floor', x0: -1, x1: 1, z0: -4.5, z1: 4.5 },
      ...frame(-1, 1, -4.5, 4.5),
      { kind: 'post', x: -0.5, z: 0.7, r: 0.14, style: 'pin' },
      { kind: 'post', x: 0.5, z: 0.7, r: 0.14, style: 'pin' },
      { kind: 'post', x: 0, z: -0.1, r: 0.14, style: 'pin' },
      { kind: 'post', x: -0.5, z: -0.9, r: 0.14, style: 'pin' },
      { kind: 'post', x: 0.5, z: -0.9, r: 0.14, style: 'pin' },
    ],
    decor: [
      { kind: 'tent', x: 2.3, z: -0.4, rot: Math.PI, color: '#9B5DE5' },
      { kind: 'tree', x: -2.0, z: 2.4 },
      { kind: 'lamp', x: -1.6, z: -3.0 },
      flags(-1.8, -5.0, [1.8, -5.0]),
    ],
    route: [[0, 3.6], [0, 1.4], [-0.25, 0.3], [0, -1.6], [0, -3.6]],
  },
  {
    id: 4,
    name: 'Le Pont du Lavoir',
    blurb: 'Une passerelle étroite au-dessus de l’eau',
    par: 3,
    tee: [0.6, 3.7],
    cup: [-0.5, -3.5],
    pieces: [
      { kind: 'floor', x0: -1.2, x1: 1.2, z0: 1.2, z1: 4.6 },
      { kind: 'floor', x0: -0.35, x1: 0.35, z0: -1.25, z1: 1.25, skin: 'wood' },
      { kind: 'floor', x0: -1.2, x1: 1.2, z0: -4.6, z1: -1.2 },
      // fond du lavoir (la balle tombe dessus : plouf)
      { kind: 'floor', x0: -1.2, x1: 1.2, z0: -1.2, z1: 1.2, y: -0.7, skin: 'sand' },
      ...frame(-1.2, 1.2, -4.6, 4.6, -0.8, 0.45),
    ],
    water: [{ x0: -1.2, x1: 1.2, z0: -1.2, z1: 1.2 }],
    decor: [
      { kind: 'tree', x: -2.0, z: 0.4 },
      { kind: 'tree', x: 2.0, z: -0.6 },
      { kind: 'stand', x: 2.2, z: 3.2, rot: Math.PI, color: '#4CC9F0' },
      flags(-1.8, -5.1, [1.8, -5.1]),
    ],
    route: [[0.6, 3.7], [0, 1.6], [0, -1.6], [-0.5, -3.5]],
  },
  {
    id: 5,
    name: 'Le Moulin',
    blurb: 'Passe entre les pales du moulin',
    par: 3,
    tee: [0, 3.9],
    cup: [0.3, -3.6],
    pieces: [
      { kind: 'floor', x0: -1.1, x1: 1.1, z0: -4.8, z1: 4.8 },
      ...frame(-1.1, 1.1, -4.8, 4.8),
      { kind: 'mill', cx: 0, x0: -1.1, x1: 1.1, front: -0.4, depth: 1.0, gap: 0.3 },
    ],
    decor: [
      { kind: 'tree', x: -2.0, z: 2.6 },
      { kind: 'tree', x: 2.1, z: -3.2 },
      { kind: 'tent', x: 2.2, z: 2.2, rot: Math.PI, color: '#FFB627' },
      flags(-1.7, -5.3, [1.7, -5.3]),
    ],
    route: [[0, 3.9], [0, 0.2], [0, -1.8], [0.3, -3.6]],
  },
  {
    id: 6,
    name: 'La Bosse des Vignes',
    blurb: 'Deux bosses puis une cuvette : trop fort, ça ressort !',
    par: 3,
    tee: [0, 4.1],
    cup: [0, -3.4],
    cupY: -0.2,
    pieces: [
      { kind: 'floor', x0: -1, x1: 1, z0: 2.3, z1: 5 },
      { kind: 'ramp', x0: -1, x1: 1, z0: 1.6, z1: 2.4, y0: 0.25, y1: 0 },
      { kind: 'ramp', x0: -1, x1: 1, z0: 0.8, z1: 1.6, y0: 0, y1: 0.25 },
      { kind: 'floor', x0: -1, x1: 1, z0: 0.1, z1: 0.9 },
      { kind: 'ramp', x0: -1, x1: 1, z0: -0.6, z1: 0.2, y0: 0.3, y1: 0 },
      { kind: 'ramp', x0: -1, x1: 1, z0: -1.4, z1: -0.6, y0: 0, y1: 0.3 },
      { kind: 'floor', x0: -1, x1: 1, z0: -2.2, z1: -1.3 },
      { kind: 'ramp', x0: -1, x1: 1, z0: -3.0, z1: -2.2, y0: -0.2, y1: 0 },
      { kind: 'floor', x0: -1, x1: 1, z0: -3.9, z1: -2.9, y: -0.2, skin: 'green' },
      { kind: 'ramp', x0: -1, x1: 1, z0: -4.6, z1: -3.8, y0: 0.15, y1: -0.2 },
      ...frame(-1, 1, -4.6, 5, -0.5, 0.6),
    ],
    decor: [
      { kind: 'tree', x: -1.9, z: 1.2 },
      { kind: 'tree', x: 1.9, z: -0.2 },
      { kind: 'tree', x: -1.9, z: -2.6 },
      { kind: 'stand', x: 2.2, z: 3.4, rot: Math.PI, color: '#9B5DE5' },
      flags(-1.6, -5.1, [1.6, -5.1]),
    ],
    route: [[0, 4.1], [0, 1.6], [0, -0.6], [0, -3.4]],
  },
  {
    id: 7,
    name: 'Le Flipper de la Kermesse',
    blurb: '3 bumpers qui renvoient la balle plus fort',
    par: 3,
    tee: [0, 3.8],
    cup: [0.55, -3.5],
    pieces: [
      { kind: 'floor', x0: -1.3, x1: 1.3, z0: -4.6, z1: 4.6 },
      ...frame(-1.3, 1.3, -4.6, 4.6),
      { kind: 'bumper', x: -0.62, z: 0.9, r: 0.26, color: '#FF5D73' },
      { kind: 'bumper', x: 0.62, z: 0.9, r: 0.26, color: '#4CC9F0' },
      { kind: 'bumper', x: 0, z: -0.6, r: 0.26, color: '#FFB627' },
      { kind: 'wall', a: [-1.3, -2.4], b: [-0.6, -3.1] },
    ],
    decor: [
      { kind: 'tent', x: -2.3, z: 0.2, color: '#7AE582' },
      { kind: 'lamp', x: 1.9, z: 2.6 },
      { kind: 'lamp', x: 1.9, z: -2.4 },
      flags(-1.9, -5.1, [1.9, -5.1]),
    ],
    route: [[0, 3.8], [0, 2.0], [-0.3, 0.1], [0.4, -1.6], [0.55, -3.5]],
  },
  {
    id: 8,
    name: 'Le Grand Huit',
    blurb: 'Un looping : prends de l’élan !',
    par: 3,
    tee: [0, 4.0],
    cup: [0.25, -3.8],
    pieces: [
      { kind: 'floor', x0: -1.2, x1: 1.2, z0: 0.3, z1: 4.8 },
      { kind: 'floor', x0: -0.45, x1: 0.45, z0: -1.5, z1: 1.0 },
      { kind: 'floor', x0: -1.2, x1: 1.2, z0: -4.8, z1: -1.4 },
      ...ring([
        [-1.2, 4.8], [-1.2, 1.0], [-0.45, 0.4], [-0.45, -1.4], [-1.2, -2.0], [-1.2, -4.8],
        [1.2, -4.8], [1.2, -2.0], [0.45, -1.4], [0.45, 0.4], [1.2, 1.0], [1.2, 4.8],
      ]),
      { kind: 'loop', z: -0.3, r: 0.78, x0: -0.15, x1: 0.15, halfWidth: 0.45 },
    ],
    decor: [
      { kind: 'tent', x: -2.1, z: 2.6, color: '#FF5D73' },
      { kind: 'tree', x: 2.0, z: 2.8 },
      { kind: 'stand', x: -1.9, z: -0.4, color: '#FFB627' },
      { kind: 'stand', x: 1.9, z: -0.4, rot: Math.PI, color: '#4CC9F0' },
      flags(-1.8, -5.3, [1.8, -5.3]),
    ],
    route: [[0, 4.0], [0, 0.6], [0, -1.6], [0.25, -3.8]],
  },
  {
    id: 9,
    name: 'Le Clocher',
    blurb: 'Une rampe vers le green du clocher',
    par: 4,
    tee: [-1.4, 3.6],
    cup: [0, -3.2],
    cupY: 0.45,
    pieces: [
      { kind: 'floor', x0: -2, x1: 2, z0: 2.6, z1: 4.6 },
      { kind: 'floor', x0: 0.4, x1: 2, z0: 0.5, z1: 2.7 },
      { kind: 'ramp', x0: 0.4, x1: 2, z0: -1.0, z1: 0.6, y0: 0.45, y1: 0 },
      { kind: 'floor', x0: -1.2, x1: 2, z0: -4.4, z1: -1.0, y: 0.45, skin: 'green' },
      { kind: 'wall', a: [-2, 4.6], b: [2, 4.6] },
      { kind: 'wall', a: [-2, 2.6], b: [-2, 4.6] },
      { kind: 'wall', a: [-2, 2.6], b: [0.4, 2.6] },
      { kind: 'wall', a: [2, 4.6], b: [2, -4.4], top: 0.8 },
      { kind: 'wall', a: [0.4, 2.6], b: [0.4, -1.0], top: 0.8 },
      { kind: 'wall', a: [0.4, -1.0], b: [-1.2, -1.0], y0: 0.3, top: 0.75 },
      { kind: 'wall', a: [-1.2, -1.0], b: [-1.2, -4.4], top: 0.75 },
      { kind: 'wall', a: [-1.2, -4.4], b: [2, -4.4], top: 0.75 },
    ],
    decor: [
      { kind: 'bell', x: 0.4, z: -5.2 },
      { kind: 'tree', x: -1.5, z: 0.8 },
      { kind: 'tent', x: -1.0, z: 1.2, rot: 0.3, color: '#9B5DE5' },
      { kind: 'lamp', x: 2.6, z: 2.4 },
      flags(-2.4, 5.1, [2.4, 5.1]),
    ],
    route: [[-1.4, 3.6], [1.2, 3.6], [1.2, 0.6], [1.2, -1.6], [0, -3.2]],
  },
]

/** Parcours express (ids). Dupliqué avec `_mg_course()->'express'`. */
export const EXPRESS = [1, 3, 5, 8, 9]

export const holeById = (id: number): HoleDef => HOLES.find((h) => h.id === id) ?? HOLES[0]

/** Hauteur du sol (dalles / rampes) en (x, z) ; 0 hors des dalles. */
export function floorHeight(h: HoleDef, x: number, z: number): number {
  let best = -Infinity
  for (const p of h.pieces) {
    if (p.kind === 'floor' && x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1) best = Math.max(best, p.y ?? 0)
    if (p.kind === 'ramp' && x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1) best = Math.max(best, p.y0 + ((p.y1 - p.y0) * (z - p.z0)) / (p.z1 - p.z0))
  }
  return best === -Infinity ? 0 : best
}

/** Constantes de jeu (affichage + physique). */
export const MAX_STROKES = 6
/** Score inscrit pour une balle non rentrée. */
export const PICKED_UP = 7
