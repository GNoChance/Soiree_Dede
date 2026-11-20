/**
 * Les 20 trous du mini-golf décrits en DONNÉES (primitives déclaratives) : 1 à 9 = parcours
 * « La Kermesse du village », 10 à 20 = trous en plus, tirés au sort avec les autres (parcours aléatoire),
 * 21 à 29 = parcours « Défi » (longs trous à thèmes : château hanté, Far-West, station de ski ; jamais tirés au sort),
 * lus par la physique (scene/physics.ts, cannon-es) et le rendu (scene/Course.ts, three).
 * Ajouter un trou = ajouter un objet. Aucun import : ce fichier est aussi lu par les tests.
 *
 * Repère : sol en y = 0, le départ (tee) vers +Z (bas de l'écran), le trou vers −Z (haut de l'écran),
 * +X à droite. Unités « mini-golf » : balle de rayon 0,1, pistes de 1,6 à 4 de large.
 * Les pars sont DUPLIQUÉS côté serveur (`_mg_course()` de supabase/games/mini-golf.sql) :
 * le test SQL vérifie la synchro (une ligne `par: n,` par trou, dans l'ordre).
 */

export type V2 = readonly [number, number]

/**
 * Revêtement d'une dalle : `ice` (glace, la balle glisse loin), `sand` / `snow` (sable, neige : la balle freine fort),
 * les autres ne changent que la couleur.
 */
export type Skin = 'grass' | 'wood' | 'green' | 'sand' | 'ice' | 'snow' | 'stone'

/** Décor d'ensemble du trou (couleurs du sol, des bordures, des dalles). */
export type Theme = 'kermesse' | 'castle' | 'desert' | 'snow'

export type Piece =
  /** Dalle plate : dessus en y (défaut 0). */
  | { kind: 'floor'; x0: number; x1: number; z0: number; z1: number; y?: number; skin?: Skin }
  /**
   * Rampe inclinée le long de Z (défaut) : hauteur y0 en z0, y1 en z1.
   * `axis: 'x'` : dévers le long de X, hauteur y0 en x0, y1 en x1.
   */
  | { kind: 'ramp'; x0: number; x1: number; z0: number; z1: number; y0: number; y1: number; axis?: 'z' | 'x'; skin?: Skin }
  /** Bordure (segment a → b), du bas `y0` (défaut −0,1) au sommet `top` (défaut 0,3) ; `hedge` : haie verte. */
  | { kind: 'wall'; a: V2; b: V2; y0?: number; top?: number; skin?: 'hedge' }
  /** Plot fixe (cylindre) posé au niveau `y` (défaut 0). */
  | { kind: 'post'; x: number; z: number; r: number; y?: number; style?: 'pin' | 'barrel' | 'rock' }
  /** Bumper : renvoie la balle plus fort. */
  | { kind: 'bumper'; x: number; z: number; r: number; y?: number; color?: string }
  /** Moulin : maison de x0 à x1 (façade en z = front, profondeur `depth`), tunnel |x − cx| < gap, pales devant. */
  | { kind: 'mill'; cx: number; x0: number; x1: number; front: number; depth: number; gap: number }
  /** Looping scripté : entrée/sortie en z (bas du cercle), rayon r ; la balle ressort décalée de x0 à x1. */
  | { kind: 'loop'; z: number; r: number; x0: number; x1: number; halfWidth: number }
  /**
   * Barrière mobile (cinématique, calée sur l'horloge serveur comme le moulin) : bloc de largeur `w` (en X)
   * et de profondeur `d` (en Z, défaut 0,3) centré en z, qui va et vient entre x0 et x1 (ses bords)
   * en `period` secondes ; `phase` (0..1) décale le départ. Une balle ne s'arrête jamais sous sa course.
   */
  | { kind: 'slider'; z: number; x0: number; x1: number; w: number; d?: number; period: number; phase?: number }
  /**
   * Porte (herse) qui monte et descend (horloge serveur) : bloc de x0 à x1, profondeur `d` (défaut 0,2) centré en z,
   * sur un sol de hauteur `y` (défaut 0). Fermée ~30 % du temps, rentrée dans le sol ~44 %, période `period` s.
   * Une balle ne s'arrête jamais dessous.
   */
  | { kind: 'gate'; x0: number; x1: number; z: number; d?: number; y?: number; period: number; phase?: number }
  /**
   * Tube (trajectoire scriptée) : la balle qui roule dans l'embouchure `a` (rayon 0,24, sol de hauteur `ya`)
   * ressort en `b` (sol de hauteur `yb`) dans la direction `dir`, avec à peu près sa vitesse d'entrée.
   * `arc` : hauteur de la bosse du tuyau (défaut 0,8).
   */
  | { kind: 'tube'; a: V2; b: V2; ya?: number; yb?: number; dir: V2; arc?: number; color?: string }

export interface Rect {
  x0: number
  x1: number
  z0: number
  z1: number
}

export type DecorKind =
  | 'tent' | 'tree' | 'flags' | 'bell' | 'stand' | 'lamp' | 'balloons' | 'hay' | 'drum'
  // Château hanté, Far-West, Station de ski
  | 'ghost' | 'pumpkin' | 'tower' | 'cactus' | 'saloon' | 'rock' | 'snowman' | 'pine' | 'chalet'

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
  /** N° du trou (1..29) = id serveur. */
  id: number
  name: string
  /** Obstacle en quelques mots (annonce du trou). */
  blurb: string
  par: number
  tee: V2
  cup: V2
  /** Hauteur du sol au trou (green surélevé, cuvette). */
  cupY?: number
  /** Décor d'ensemble (défaut : kermesse). */
  theme?: Theme
  /**
   * Parcours suspendu au-dessus du vide : une balle qui tombe (ou qui sort du parcours) compte +1 coup
   * et revient au point de frappe, comme l'eau. Sans `void`, une balle hors piste revient sans pénalité.
   */
  void?: boolean
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

/** Bordure posée sur un sol de hauteur y (dépasse de h au-dessus). */
const wallAt = (a: V2, b: V2, y: number, h = 0.3): Piece => ({ kind: 'wall', a, b, y0: y - 0.1, top: y + h })

/* -------------------------------------------------------------------------- */
/* Les 29 trous                                                               */
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
  /* ------------------------------------------------------------------------ */
  /* Trous 10 à 20 : les nouveautés du village (tirés au sort avec les 9 autres) */
  /* ------------------------------------------------------------------------ */

  {
    id: 10,
    name: 'L’Entonnoir du Pressoir',
    blurb: 'Tout finit par passer dans le goulot',
    par: 3,
    tee: [0.9, 3.8],
    cup: [0.55, -3.3],
    pieces: [
      { kind: 'floor', x0: -2, x1: 2, z0: 0, z1: 4.6 },
      { kind: 'floor', x0: -1.2, x1: 1.2, z0: -0.8, z1: 0 },
      { kind: 'floor', x0: -0.4, x1: 0.4, z0: -1.6, z1: -0.8, skin: 'wood' },
      { kind: 'floor', x0: -1.2, x1: 1.2, z0: -4.4, z1: -1.6 },
      ...ring([
        [-2, 4.6], [-2, 0.8], [-0.4, -0.8], [-0.4, -1.6], [-1.2, -1.6], [-1.2, -4.4],
        [1.2, -4.4], [1.2, -1.6], [0.4, -1.6], [0.4, -0.8], [2, 0.8], [2, 4.6],
      ]),
    ],
    decor: [
      { kind: 'hay', x: -2.0, z: -0.6 },
      { kind: 'hay', x: 2.1, z: -0.9, rot: 0.6 },
      { kind: 'tree', x: -2.0, z: -3.2 },
      { kind: 'stand', x: 2.1, z: -3.0, rot: Math.PI, color: '#9B5DE5' },
      flags(-1.6, -4.9, [1.6, -4.9]),
    ],
    route: [[0.9, 3.8], [0, 0.6], [0, -1.2], [0.55, -3.3]],
  },
  {
    id: 11,
    name: 'Le Tremplin des Canards',
    blurb: 'Saute la mare ! Trop mou : plouf, trop fort : ça revient',
    par: 3,
    tee: [0, 3.8],
    cup: [0.3, -3.2],
    pieces: [
      { kind: 'floor', x0: -1, x1: 1, z0: 1.6, z1: 4.6 },
      { kind: 'ramp', x0: -1, x1: 1, z0: 0.7, z1: 1.6, y0: 0.3, y1: 0, skin: 'wood' },
      // fond de la mare
      { kind: 'floor', x0: -1, x1: 1, z0: -0.9, z1: 0.7, y: -0.7, skin: 'sand' },
      { kind: 'floor', x0: -1, x1: 1, z0: -4.6, z1: -0.9 },
      ...frame(-1, 1, -4.6, 4.6, -0.8, 0.9),
    ],
    water: [{ x0: -1, x1: 1, z0: -0.9, z1: 0.7 }],
    decor: [
      { kind: 'balloons', x: -1.8, z: 2.6, color: '#FF5D73' },
      { kind: 'tree', x: 1.9, z: 0.2 },
      { kind: 'tree', x: -1.9, z: -1.4 },
      { kind: 'tent', x: 2.1, z: 3.2, rot: Math.PI, color: '#7AE582' },
      flags(-1.6, -5.1, [1.6, -5.1]),
    ],
    route: [[0, 3.8], [0, 1.2], [0, -1.6], [0.3, -3.2]],
  },
  {
    id: 12,
    name: 'Le Dévers de la Fanfare',
    blurb: 'Tout penche vers la grosse caisse : vise plus haut !',
    par: 3,
    tee: [0.6, 3.8],
    cup: [-0.6, -3.4],
    cupY: 0.2,
    pieces: [
      { kind: 'ramp', axis: 'x', x0: -1.4, x1: 1.4, z0: -4.6, z1: 4.6, y0: 0.28, y1: 0 },
      { kind: 'wall', a: [-1.4, 4.6], b: [-1.4, -4.6], top: 0.65 },
      { kind: 'wall', a: [1.4, -4.6], b: [1.4, 4.6], top: 0.35 },
      { kind: 'wall', a: [-1.4, -4.6], b: [1.4, -4.6], top: 0.65 },
      { kind: 'wall', a: [1.4, 4.6], b: [-1.4, 4.6], top: 0.65 },
      { kind: 'post', x: 0.55, z: 0.6, r: 0.2, style: 'barrel' },
      { kind: 'post', x: -0.45, z: -1.3, r: 0.2, style: 'barrel' },
    ],
    decor: [
      { kind: 'drum', x: 2.2, z: 0.2, rot: -0.4 },
      { kind: 'tent', x: -2.3, z: 1.6, color: '#FFB627' },
      { kind: 'lamp', x: 2.0, z: -3.0 },
      { kind: 'tree', x: -2.1, z: -2.6 },
      flags(-1.8, -5.1, [1.8, -5.1]),
    ],
    route: [[0.6, 3.8], [0, 1.6], [-0.3, -0.4], [-0.6, -3.4]],
  },
  {
    id: 13,
    name: 'Le Passage à Niveau',
    blurb: 'La barrière va et vient : attends ton moment !',
    par: 2,
    tee: [0, 3.6],
    cup: [-0.3, -3.4],
    pieces: [
      { kind: 'floor', x0: -1.1, x1: 1.1, z0: -4.4, z1: 4.4 },
      ...frame(-1.1, 1.1, -4.4, 4.4),
      // course de la barrière à 0,23 des bordures : une balle n'est jamais coincée contre le mur
      { kind: 'slider', z: 0.2, x0: -0.8, x1: 0.8, w: 0.6, period: 3.2 },
    ],
    decor: [
      { kind: 'lamp', x: -1.6, z: 0.9 },
      { kind: 'lamp', x: 1.6, z: -0.5 },
      { kind: 'tree', x: -2.0, z: -2.6 },
      { kind: 'tree', x: 2.0, z: 2.8 },
      { kind: 'stand', x: -2.1, z: 3.0, color: '#4CC9F0' },
      flags(-1.6, -4.9, [1.6, -4.9]),
    ],
    route: [[0, 3.6], [0, 0.2], [-0.3, -3.4]],
  },
  {
    id: 14,
    name: 'La Chatière de Mémé',
    blurb: 'Passe par la chatière… ou fais le tour de la haie',
    par: 3,
    tee: [0.4, 3.7],
    cup: [-1.1, -3.3],
    pieces: [
      { kind: 'floor', x0: -2, x1: 2, z0: -4.4, z1: 4.4 },
      ...frame(-2, 2, -4.4, 4.4),
      // la haie, avec sa chatière (x ≈ −0,5) et le passage à droite
      { kind: 'wall', a: [-2, 0], b: [-0.82, 0], top: 0.42, skin: 'hedge' },
      { kind: 'wall', a: [-0.18, 0], b: [0.7, 0], top: 0.42, skin: 'hedge' },
    ],
    decor: [
      { kind: 'tent', x: -2.7, z: 2.0, color: '#FF5D73' },
      { kind: 'tree', x: 2.6, z: -2.4 },
      { kind: 'tree', x: -2.6, z: -3.4 },
      { kind: 'lamp', x: 2.6, z: 2.6 },
      flags(-2.2, -4.9, [2.2, -4.9]),
    ],
    route: [[0.4, 3.7], [1.4, 0.8], [1.4, -0.8], [-1.1, -3.3]],
  },
  {
    id: 15,
    name: 'Le Serpent de la Brocante',
    blurb: 'Trois allées en zigzag : prends les virages !',
    par: 4,
    tee: [1.3, 3.1],
    cup: [-1.2, -3.1],
    pieces: [
      { kind: 'floor', x0: -2, x1: 2, z0: -4.5, z1: 4.5 },
      ...frame(-2, 2, -4.5, 4.5),
      { kind: 'wall', a: [-0.2, 1.5], b: [2, 1.5] },
      { kind: 'wall', a: [-2, -1.5], b: [0.2, -1.5] },
      { kind: 'post', x: 0.3, z: 0.55, r: 0.22, style: 'barrel' },
      { kind: 'post', x: -0.2, z: -3.6, r: 0.2, style: 'barrel' },
    ],
    decor: [
      { kind: 'stand', x: 2.7, z: 0.2, rot: -Math.PI / 2, color: '#FFB627' },
      { kind: 'stand', x: -2.7, z: -0.4, rot: Math.PI / 2, color: '#FF5D73' },
      { kind: 'tree', x: 2.6, z: -3.4 },
      { kind: 'tree', x: -2.6, z: 3.4 },
      flags(-2.2, -5.0, [2.2, -5.0]),
    ],
    route: [[1.3, 3.1], [-1.1, 2.6], [-1.1, 0.4], [1.1, -0.4], [1.1, -2.6], [-1.2, -3.1]],
  },
  {
    id: 16,
    name: 'Le Grand Flipper',
    blurb: '5 bumpers et deux rampes de lancement : tilt !',
    par: 3,
    tee: [0, 3.9],
    cup: [0, -3.75],
    pieces: [
      { kind: 'floor', x0: -1.5, x1: 1.5, z0: -4.6, z1: 4.6 },
      ...frame(-1.5, 1.5, -4.6, 4.6),
      { kind: 'bumper', x: -0.75, z: 1.7, r: 0.26, color: '#FF5D73' },
      { kind: 'bumper', x: 0.75, z: 1.7, r: 0.26, color: '#4CC9F0' },
      { kind: 'bumper', x: 0, z: 0.5, r: 0.28, color: '#FFB627' },
      { kind: 'bumper', x: -0.85, z: -0.8, r: 0.24, color: '#7AE582' },
      { kind: 'bumper', x: 0.85, z: -0.8, r: 0.24, color: '#9B5DE5' },
      { kind: 'wall', a: [-1.5, -2.5], b: [-0.75, -3.3] },
      { kind: 'wall', a: [1.5, -2.5], b: [0.75, -3.3] },
    ],
    decor: [
      { kind: 'lamp', x: -2.0, z: 2.6 },
      { kind: 'lamp', x: 2.0, z: 2.6 },
      { kind: 'balloons', x: -2.1, z: -1.4, color: '#4CC9F0' },
      { kind: 'tent', x: 2.3, z: -1.2, rot: Math.PI, color: '#FF5D73' },
      flags(-1.9, -5.1, [1.9, -5.1]),
    ],
    route: [[0, 3.9], [0, 2.6], [0.55, 1.1], [0, -1.2], [0, -3.75]],
  },
  {
    id: 17,
    name: 'La Rivière aux Deux Ponts',
    blurb: 'Le grand pont, ou la planche étroite droit sur le trou ?',
    par: 3,
    tee: [-0.2, 3.8],
    cup: [1.1, -3.3],
    pieces: [
      { kind: 'floor', x0: -1.8, x1: 1.8, z0: 0.8, z1: 4.6 },
      { kind: 'floor', x0: -1.8, x1: -0.8, z0: -0.8, z1: 0.8, skin: 'wood' },
      { kind: 'floor', x0: 0.82, x1: 1.38, z0: -0.8, z1: 0.8, skin: 'wood' },
      // lit de la rivière
      { kind: 'floor', x0: -1.8, x1: 1.8, z0: -0.8, z1: 0.8, y: -0.7, skin: 'sand' },
      { kind: 'floor', x0: -1.8, x1: 1.8, z0: -4.6, z1: -0.8 },
      ...frame(-1.8, 1.8, -4.6, 4.6, -0.8, 0.45),
    ],
    water: [{ x0: -1.8, x1: 1.8, z0: -0.8, z1: 0.8 }],
    decor: [
      { kind: 'tree', x: -2.5, z: 0 },
      { kind: 'tree', x: 2.5, z: 0.4 },
      { kind: 'stand', x: -2.5, z: 3.0, color: '#7AE582' },
      { kind: 'balloons', x: 2.4, z: -2.8, color: '#FFB627' },
      flags(-2.0, -5.1, [2.0, -5.1]),
    ],
    route: [[-0.2, 3.8], [-1.25, 1.4], [-1.25, -1.4], [1.1, -3.3]],
  },
  {
    id: 18,
    name: 'Le Toboggan de la Mairie',
    blurb: 'Ça descend vite… et ça remonte derrière le trou !',
    par: 3,
    tee: [0, 3.9],
    cup: [0, -2.3],
    pieces: [
      { kind: 'floor', x0: -1, x1: 1, z0: 2.8, z1: 4.6, y: 0.6, skin: 'wood' },
      { kind: 'ramp', x0: -1, x1: 1, z0: 0.6, z1: 2.8, y0: 0, y1: 0.6 },
      { kind: 'floor', x0: -1, x1: 1, z0: -2.8, z1: 0.6 },
      { kind: 'ramp', x0: -1, x1: 1, z0: -4.6, z1: -2.8, y0: 0.35, y1: 0 },
      { kind: 'wall', a: [-1, 4.6], b: [1, 4.6], top: 0.95 },
      { kind: 'wall', a: [-1, -4.6], b: [-1, 4.6], top: 0.95 },
      { kind: 'wall', a: [1, 4.6], b: [1, -4.6], top: 0.95 },
      { kind: 'wall', a: [1, -4.6], b: [-1, -4.6], top: 0.7 },
      { kind: 'post', x: -0.42, z: -0.7, r: 0.14, style: 'pin' },
      { kind: 'post', x: 0.42, z: -0.7, r: 0.14, style: 'pin' },
    ],
    decor: [
      { kind: 'tent', x: -2.0, z: 3.4, color: '#4CC9F0' },
      { kind: 'balloons', x: 1.8, z: 3.8, color: '#9B5DE5' },
      { kind: 'tree', x: 1.9, z: 0.2 },
      { kind: 'tree', x: -1.9, z: -1.6 },
      { kind: 'lamp', x: 1.7, z: -3.4 },
      flags(-1.6, -5.1, [1.6, -5.1]),
    ],
    route: [[0, 3.9], [0, 0.6], [0, -2.3]],
  },
  {
    id: 19,
    name: 'Le Moulin de la Meunière',
    blurb: 'Longe la mare, puis file sous le moulin',
    par: 3,
    tee: [0.5, 4.0],
    cup: [-0.7, -3.7],
    pieces: [
      { kind: 'floor', x0: -1.4, x1: 1.4, z0: 2.6, z1: 4.8 },
      { kind: 'floor', x0: -0.3, x1: 1.4, z0: 0.8, z1: 2.6 },
      { kind: 'floor', x0: -1.4, x1: -0.3, z0: 0.8, z1: 2.6, y: -0.7, skin: 'sand' },
      { kind: 'floor', x0: -1.4, x1: 1.4, z0: -4.8, z1: 0.8 },
      ...frame(-1.4, 1.4, -4.8, 4.8, -0.8, 0.45),
      { kind: 'mill', cx: 0.5, x0: -1.4, x1: 1.4, front: -0.6, depth: 1.0, gap: 0.3 },
    ],
    water: [{ x0: -1.4, x1: -0.3, z0: 0.8, z1: 2.6 }],
    decor: [
      { kind: 'hay', x: -2.1, z: 3.6 },
      { kind: 'tree', x: 2.1, z: 1.6 },
      { kind: 'tree', x: -2.2, z: -2.8 },
      { kind: 'tent', x: 2.3, z: -3.0, rot: Math.PI, color: '#FFB627' },
      flags(-1.8, -5.3, [1.8, -5.3]),
    ],
    route: [[0.5, 4.0], [0.5, 0.4], [0.5, -2.0], [-0.7, -3.7]],
  },
  {
    id: 20,
    name: 'Le Bouquet Final',
    blurb: 'Looping, bumpers… et la cloche sonne pour le gagnant !',
    par: 3,
    tee: [0, 4.0],
    cup: [-1.0, -4.0],
    pieces: [
      { kind: 'floor', x0: -1.2, x1: 1.2, z0: 1.9, z1: 4.8 },
      { kind: 'floor', x0: -0.45, x1: 0.45, z0: -1.0, z1: 2.0 },
      { kind: 'floor', x0: -1.6, x1: 1.6, z0: -4.8, z1: -0.9 },
      ...ring([
        [-1.2, 4.8], [-1.2, 2.5], [-0.45, 1.9], [-0.45, -0.9], [-1.6, -1.5], [-1.6, -4.8],
        [1.6, -4.8], [1.6, -1.5], [0.45, -0.9], [0.45, 1.9], [1.2, 2.5], [1.2, 4.8],
      ]),
      { kind: 'loop', z: 0.5, r: 0.78, x0: -0.15, x1: 0.15, halfWidth: 0.45 },
      { kind: 'bumper', x: 0.35, z: -2.3, r: 0.26, color: '#FF5D73' },
      { kind: 'bumper', x: -0.45, z: -3.2, r: 0.24, color: '#FFD23F' },
    ],
    decor: [
      { kind: 'bell', x: 0.6, z: -5.6 },
      { kind: 'balloons', x: -2.0, z: 3.6, color: '#7AE582' },
      { kind: 'stand', x: -1.9, z: 0.6, color: '#FFB627' },
      { kind: 'stand', x: 1.9, z: 0.6, rot: Math.PI, color: '#4CC9F0' },
      { kind: 'lamp', x: 2.2, z: -3.0 },
      flags(-2.0, 5.2, [2.0, 5.2]),
    ],
    route: [[0, 4.0], [0, 0.6], [0, -1.6], [-1.0, -4.0]],
  },
  /* ------------------------------------------------------------------------ */
  /* Trous 21 à 29 : parcours « Défi » (longs trous, pars 4 à 6, jamais tirés */
  /* au sort) — Château hanté de Dédé, Far-West, Station de ski.             */
  /* ------------------------------------------------------------------------ */

  {
    id: 21,
    name: 'Les Douves du Château',
    blurb: 'Pont-levis, herse qui monte et descend… et des fantômes !',
    par: 4,
    theme: 'castle',
    tee: [0, 4.6],
    cup: [-1.4, -4.4],
    pieces: [
      { kind: 'floor', x0: -1.2, x1: 1.2, z0: 3.4, z1: 5.6 },
      { kind: 'floor', x0: -0.45, x1: 0.45, z0: 1.6, z1: 3.4, skin: 'wood' },
      // fond des douves
      { kind: 'floor', x0: -2.4, x1: 2.4, z0: 1.6, z1: 3.4, y: -0.7, skin: 'sand' },
      { kind: 'floor', x0: -2.4, x1: 2.4, z0: -5.6, z1: 1.6, skin: 'stone' },
      { kind: 'wall', a: [-1.2, 3.4], b: [-1.2, 5.6] },
      { kind: 'wall', a: [-1.2, 5.6], b: [1.2, 5.6] },
      { kind: 'wall', a: [1.2, 5.6], b: [1.2, 3.4] },
      { kind: 'wall', a: [-2.4, 3.4], b: [-1.2, 3.4], y0: -0.8 },
      { kind: 'wall', a: [1.2, 3.4], b: [2.4, 3.4], y0: -0.8 },
      { kind: 'wall', a: [-2.4, -5.6], b: [-2.4, 3.4], y0: -0.8 },
      { kind: 'wall', a: [2.4, 3.4], b: [2.4, -5.6], y0: -0.8 },
      { kind: 'wall', a: [-2.4, -5.6], b: [2.4, -5.6] },
      // parapet des douves (on ne retombe à l'eau que par le pont-levis)
      { kind: 'wall', a: [-2.4, 1.6], b: [-0.52, 1.6], y0: -0.8 },
      { kind: 'wall', a: [0.52, 1.6], b: [2.4, 1.6], y0: -0.8 },
      // remparts et herse
      { kind: 'wall', a: [-2.4, 0.2], b: [-0.52, 0.2], top: 0.65 },
      { kind: 'wall', a: [0.52, 0.2], b: [2.4, 0.2], top: 0.65 },
      { kind: 'gate', x0: -0.45, x1: 0.45, z: 0.2, period: 4 },
      // la cour : un mur à contourner
      { kind: 'wall', a: [-2.4, -2.0], b: [1.0, -2.0], top: 0.45 },
      { kind: 'bumper', x: -1.2, z: -0.6, r: 0.26, color: '#F4F1FF' },
      { kind: 'bumper', x: 1.3, z: -3.7, r: 0.24, color: '#F4F1FF' },
    ],
    water: [{ x0: -2.4, x1: 2.4, z0: 1.6, z1: 3.4 }],
    decor: [
      { kind: 'tower', x: -3.3, z: 0.6 },
      { kind: 'tower', x: 3.3, z: 0.6, color: '#FF5D73' },
      { kind: 'ghost', x: -3.3, z: -3.2 },
      { kind: 'pumpkin', x: 2.6, z: 4.6 },
      { kind: 'pumpkin', x: -2.5, z: 5.0, color: '#FFB627' },
      { kind: 'tree', x: 3.3, z: -3.8 },
    ],
    route: [[0, 4.6], [0, 2.5], [0, -0.4], [1.7, -1.0], [1.7, -3.0], [-1.4, -4.4]],
  },
  {
    id: 22,
    name: 'L’Escalier du Fantôme',
    blurb: 'Trois étages au-dessus du vide : gare à la chute !',
    par: 4,
    theme: 'castle',
    void: true,
    tee: [-1.5, 4.6],
    cup: [-1.6, -4.6],
    cupY: 1,
    pieces: [
      { kind: 'floor', x0: -2.4, x1: -0.6, z0: 3.6, z1: 5.6, skin: 'stone' },
      { kind: 'ramp', x0: -2.4, x1: -1.2, z0: 1.2, z1: 3.6, y0: 0.5, y1: 0 },
      { kind: 'floor', x0: -2.4, x1: 2.4, z0: -0.6, z1: 1.2, y: 0.5, skin: 'stone' },
      { kind: 'ramp', x0: 1.2, x1: 2.4, z0: -3.2, z1: -0.6, y0: 1, y1: 0.5 },
      { kind: 'floor', x0: -2.4, x1: 2.4, z0: -5.6, z1: -3.2, y: 1 },
      // départ
      wallAt([-2.4, 5.6], [-0.6, 5.6], 0),
      wallAt([-2.4, 5.6], [-2.4, 3.6], 0),
      // 1re rampe
      wallAt([-2.4, 3.6], [-2.4, 1.2], 0, 0.8),
      wallAt([-1.2, 3.6], [-1.2, 1.2], 0, 0.8),
      // balcon (garde-fous partiels : le reste donne sur le vide)
      wallAt([-2.4, 1.2], [-2.4, -0.6], 0.5),
      wallAt([0.6, 1.2], [2.4, 1.2], 0.5),
      wallAt([2.4, 1.2], [2.4, -0.6], 0.5),
      wallAt([-2.4, -0.6], [-0.4, -0.6], 0.5),
      { kind: 'bumper', x: 0.3, z: 0.3, r: 0.26, y: 0.5, color: '#F4F1FF' },
      // 2e rampe
      wallAt([1.2, -0.6], [1.2, -3.2], 0.5, 0.8),
      wallAt([2.4, -0.6], [2.4, -3.2], 0.5, 0.8),
      // sommet
      wallAt([2.4, -3.2], [2.4, -5.6], 1),
      wallAt([2.4, -5.6], [-2.4, -5.6], 1),
      wallAt([-2.4, -5.6], [-2.4, -3.2], 1),
      wallAt([-2.4, -3.2], [-1.0, -3.2], 1),
      // passage secret : du balcon (au bord du vide) au sommet
      { kind: 'tube', a: [-0.3, -0.25], ya: 0.5, b: [-0.3, -3.9], yb: 1, dir: [-0.8, -0.6], arc: 0.9, color: '#9B5DE5' },
    ],
    decor: [
      { kind: 'ghost', x: -3.4, z: 2.2 },
      { kind: 'ghost', x: 3.4, z: -2.2 },
      { kind: 'tower', x: 3.4, z: 4.2 },
      { kind: 'pumpkin', x: -3.3, z: -4.4 },
      { kind: 'pumpkin', x: 0.6, z: 3.2, color: '#FFB627' },
    ],
    route: [[-1.5, 4.6], [-1.8, 2.6], [-1.8, 0.3], [1.8, 0.3], [1.8, -2.0], [0.6, -4.4], [-1.6, -4.6]],
  },
  {
    id: 23,
    name: 'La Galerie des Herses',
    blurb: 'Trois herses qui montent et descendent : passe au bon moment',
    par: 6,
    theme: 'castle',
    tee: [1.0, 4.8],
    cup: [1.2, -4.6],
    pieces: [
      { kind: 'floor', x0: -2, x1: 2, z0: -5.8, z1: 5.8, skin: 'stone' },
      ...frame(-2, 2, -5.8, 5.8),
      { kind: 'wall', a: [-2, 2.8], b: [-1.67, 2.8], top: 0.6 },
      { kind: 'wall', a: [-0.33, 2.8], b: [2, 2.8], top: 0.6 },
      { kind: 'gate', x0: -1.6, x1: -0.4, z: 2.8, period: 4 },
      { kind: 'wall', a: [-2, 0], b: [0.33, 0], top: 0.6 },
      { kind: 'wall', a: [1.67, 0], b: [2, 0], top: 0.6 },
      { kind: 'gate', x0: 0.4, x1: 1.6, z: 0, period: 4, phase: 0.33 },
      { kind: 'wall', a: [-2, -2.8], b: [-0.67, -2.8], top: 0.6 },
      { kind: 'wall', a: [0.67, -2.8], b: [2, -2.8], top: 0.6 },
      { kind: 'gate', x0: -0.6, x1: 0.6, z: -2.8, period: 4, phase: 0.66 },
      { kind: 'bumper', x: 0.9, z: 1.6, r: 0.25, color: '#F4F1FF' },
      { kind: 'bumper', x: -0.9, z: -1.3, r: 0.25, color: '#F4F1FF' },
    ],
    decor: [
      { kind: 'tower', x: -3.0, z: -4.6, color: '#FF5D73' },
      { kind: 'ghost', x: 3.0, z: 2.4 },
      { kind: 'ghost', x: -3.0, z: 0.6 },
      { kind: 'pumpkin', x: 2.9, z: -1.6 },
      { kind: 'pumpkin', x: -2.8, z: 4.8, color: '#FFB627' },
      { kind: 'lamp', x: 2.8, z: -4.8 },
    ],
    route: [[1.0, 4.8], [-1.0, 3.3], [-1.0, 2.3], [1.0, 0.5], [1.0, -0.5], [0, -2.3], [0, -3.3], [1.2, -4.6]],
  },
  {
    id: 24,
    name: 'Le Canyon du Coyote',
    blurb: 'Le long du ravin, ou le tremplin par-dessus le vide ?',
    par: 4,
    theme: 'desert',
    void: true,
    tee: [1.6, 4.8],
    cup: [1.6, -4.4],
    pieces: [
      { kind: 'floor', x0: 0.6, x1: 2.6, z0: 3.4, z1: 5.8 },
      { kind: 'ramp', x0: 0.8, x1: 2.4, z0: 2.6, z1: 3.4, y0: 0.3, y1: 0, skin: 'wood' },
      { kind: 'floor', x0: -2.6, x1: 0.6, z0: 4.2, z1: 5.8 },
      { kind: 'floor', x0: -2.6, x1: -0.8, z0: 1.6, z1: 4.2 },
      { kind: 'floor', x0: -2.6, x1: -0.8, z0: 0.6, z1: 1.6, skin: 'sand' },
      { kind: 'floor', x0: -2.6, x1: -0.8, z0: -1, z1: 0.6 },
      // garde-fous (le reste du bord donne sur le ravin)
      { kind: 'wall', a: [-0.8, 4.2], b: [0.6, 4.2] },
      { kind: 'wall', a: [-0.8, 4.2], b: [-0.8, 1.6] },
      { kind: 'floor', x0: -2.6, x1: 2.6, z0: -5.8, z1: -1 },
      { kind: 'wall', a: [-2.6, 5.8], b: [2.6, 5.8] },
      { kind: 'wall', a: [2.6, 5.8], b: [2.6, 3.4] },
      { kind: 'wall', a: [-2.6, -5.8], b: [-2.6, 5.8] },
      { kind: 'wall', a: [-2.6, -5.8], b: [2.6, -5.8] },
      { kind: 'wall', a: [2.6, -1], b: [2.6, -5.8] },
      { kind: 'post', x: 0.2, z: -3.0, r: 0.25, style: 'rock' },
      { kind: 'post', x: -1.3, z: -4.3, r: 0.22, style: 'rock' },
    ],
    decor: [
      { kind: 'cactus', x: -0.2, z: 2.2 },
      { kind: 'rock', x: 0.6, z: 0.6 },
      { kind: 'cactus', x: 3.4, z: 0.4 },
      { kind: 'cactus', x: -3.4, z: -2.0 },
      { kind: 'saloon', x: 3.7, z: -3.6, rot: -Math.PI / 2 },
      { kind: 'rock', x: -3.6, z: 3.4 },
    ],
    route: [[1.6, 4.8], [-1.8, 5.0], [-1.8, -1.8], [1.6, -4.4]],
  },
  {
    id: 25,
    name: 'La Mine d’Or de Dédé',
    blurb: 'Trois galeries de mine : une seule mène au trésor !',
    par: 4,
    theme: 'desert',
    tee: [0.4, 4.8],
    cup: [1.7, -4.8],
    pieces: [
      { kind: 'floor', x0: -2.6, x1: 2.6, z0: 1.6, z1: 5.8 },
      { kind: 'floor', x0: -2.6, x1: 2.6, z0: -1.2, z1: 1.6 },
      { kind: 'floor', x0: -2.6, x1: -0.2, z0: -5.8, z1: -1.2 },
      { kind: 'floor', x0: -0.2, x1: 1, z0: -5.8, z1: -1.2, skin: 'sand' },
      { kind: 'floor', x0: 1, x1: 2.6, z0: -5.8, z1: -1.2 },
      ...frame(-2.6, 2.6, -5.8, 5.8),
      // la paroi de la mine : on ne passe que par les galeries
      { kind: 'wall', a: [-2.6, 1.6], b: [2.6, 1.6], top: 0.7 },
      { kind: 'tube', a: [-1.8, 2.3], b: [-2.0, -2.2], dir: [0.3, -1], color: '#C77A4A' },
      { kind: 'tube', a: [0, 2.3], b: [1.8, -0.4], dir: [0, 1], color: '#8C4A2F' },
      { kind: 'tube', a: [1.8, 2.3], b: [-1.2, -0.4], dir: [-1, 0], color: '#E0A458' },
      { kind: 'post', x: 1.7, z: -3.6, r: 0.22, style: 'rock' },
      { kind: 'post', x: -0.9, z: 4.0, r: 0.2, style: 'barrel' },
      { kind: 'post', x: 1.1, z: 3.7, r: 0.2, style: 'barrel' },
    ],
    decor: [
      { kind: 'saloon', x: 3.7, z: 4.0, rot: -Math.PI / 2 },
      { kind: 'cactus', x: -3.4, z: -2.0 },
      { kind: 'rock', x: 3.5, z: -2.6 },
      { kind: 'cactus', x: 3.4, z: 0.8 },
      { kind: 'rock', x: -3.5, z: 3.4 },
    ],
    route: [[0.4, 4.8], [-1.8, 2.3], [-2.0, -2.2], [-1.0, -4.8], [1.7, -4.8]],
  },
  {
    id: 26,
    name: 'La Grand-Rue du Saloon',
    blurb: 'Diligences, sable et tonneaux jusqu’au perron du saloon',
    par: 4,
    theme: 'desert',
    tee: [0, 5.2],
    cup: [0.6, -5.3],
    cupY: 0.35,
    pieces: [
      { kind: 'floor', x0: -1.6, x1: 1.6, z0: 3.2, z1: 6 },
      { kind: 'floor', x0: -1.6, x1: 0, z0: 1.6, z1: 3.2, skin: 'sand' },
      { kind: 'floor', x0: 0, x1: 1.6, z0: 1.6, z1: 3.2 },
      { kind: 'floor', x0: -1.6, x1: 1.6, z0: -3.6, z1: 1.6 },
      { kind: 'ramp', x0: -1.6, x1: 1.6, z0: -4.8, z1: -3.6, y0: 0.35, y1: 0, skin: 'wood' },
      { kind: 'floor', x0: -1.6, x1: 1.6, z0: -6, z1: -4.8, y: 0.35, skin: 'wood' },
      { kind: 'wall', a: [-1.6, 6], b: [1.6, 6] },
      { kind: 'wall', a: [-1.6, 6], b: [-1.6, -3.6] },
      { kind: 'wall', a: [1.6, 6], b: [1.6, -3.6] },
      { kind: 'wall', a: [-1.6, -3.6], b: [-1.6, -6], top: 1 },
      { kind: 'wall', a: [1.6, -3.6], b: [1.6, -6], top: 1 },
      { kind: 'wall', a: [-1.6, -6], b: [1.6, -6], top: 1 },
      // diligences qui traversent la rue
      { kind: 'slider', z: 0.4, x0: -1.3, x1: 1.3, w: 0.9, period: 3 },
      { kind: 'slider', z: -1.8, x0: -1.3, x1: 1.3, w: 0.8, period: 2.4, phase: 0.5 },
      { kind: 'post', x: -0.8, z: -3.0, r: 0.2, style: 'barrel' },
      { kind: 'post', x: 0.85, z: -2.9, r: 0.2, style: 'barrel' },
    ],
    decor: [
      { kind: 'saloon', x: -2.8, z: -5.0, rot: Math.PI / 2 },
      { kind: 'saloon', x: 2.8, z: 1.0, rot: -Math.PI / 2 },
      { kind: 'cactus', x: -2.6, z: 3.0 },
      { kind: 'cactus', x: 2.6, z: 4.6 },
      { kind: 'rock', x: -2.6, z: -1.0 },
      { kind: 'rock', x: 2.7, z: -3.6 },
    ],
    route: [[0, 5.2], [0.6, 2.4], [0, 0.4], [0, -1.8], [0, -4.2], [0.6, -5.3]],
  },
  {
    id: 27,
    name: 'La Patinoire de Dédé',
    blurb: 'Tout est en glace : ça glisse, ça rebondit… doucement !',
    par: 4,
    theme: 'snow',
    tee: [0, 4.4],
    cup: [0, -4.2],
    pieces: [
      { kind: 'floor', x0: -2.4, x1: 2.4, z0: -4.8, z1: 5.2, skin: 'ice' },
      { kind: 'floor', x0: -2.4, x1: 2.4, z0: -5.2, z1: -4.8, skin: 'snow' },
      ...frame(-2.4, 2.4, -5.2, 5.2),
      ...ring([[-0.8, 1.2], [-0.8, -1.2], [0.8, -1.2], [0.8, 1.2]]),
      { kind: 'bumper', x: -1.6, z: 2.8, r: 0.26, color: '#4CC9F0' },
      { kind: 'bumper', x: 1.6, z: 2.8, r: 0.26, color: '#FF5D73' },
      { kind: 'bumper', x: 0, z: -2.6, r: 0.24, color: '#FFD23F' },
    ],
    decor: [
      { kind: 'snowman', x: -3.2, z: 0 },
      { kind: 'pine', x: 3.2, z: 3.0 },
      { kind: 'pine', x: -3.2, z: -3.6 },
      { kind: 'chalet', x: 3.4, z: -2.6, rot: -Math.PI / 2 },
      flags(-2.0, -5.7, [2.0, -5.7]),
    ],
    route: [[0, 4.4], [1.6, 1.6], [1.6, -1.6], [0, -4.2]],
  },
  {
    id: 28,
    name: 'Le Grand Tremplin',
    blurb: 'Saute le ravin… ou prends le chemin des piétons',
    par: 4,
    theme: 'snow',
    void: true,
    tee: [0, 5.2],
    cup: [-1.4, -4.8],
    pieces: [
      { kind: 'floor', x0: -1.2, x1: 1.2, z0: 4.4, z1: 6, y: 1.2 },
      { kind: 'ramp', x0: -1.2, x1: 1.2, z0: 1.4, z1: 4.4, y0: 0.3, y1: 1.2 },
      { kind: 'floor', x0: -1.2, x1: 2.4, z0: 0.6, z1: 1.4, y: 0.3 },
      { kind: 'ramp', x0: -1.2, x1: 1.2, z0: -0.2, z1: 0.6, y0: 0.55, y1: 0.3, skin: 'wood' },
      { kind: 'ramp', x0: 1.4, x1: 2.4, z0: -2.6, z1: 0.6, y0: 0, y1: 0.3 },
      { kind: 'floor', x0: -2.4, x1: 1.4, z0: -3.8, z1: -2.6, skin: 'ice' },
      { kind: 'floor', x0: 1.4, x1: 2.4, z0: -3.8, z1: -2.6 },
      { kind: 'floor', x0: -2.4, x1: 2.4, z0: -6, z1: -3.8 },
      // départ et descente
      wallAt([-1.2, 6], [1.2, 6], 1.2),
      wallAt([-1.2, 6], [-1.2, 1.4], 0.3, 1.2),
      wallAt([1.2, 6], [1.2, 1.4], 0.3, 1.2),
      // replat, tremplin, chemin des piétons
      wallAt([-1.2, 1.4], [-1.2, -0.2], 0.3, 0.55),
      wallAt([1.2, 1.4], [2.4, 1.4], 0.3),
      wallAt([2.4, 1.4], [2.4, -2.6], 0.3),
      { kind: 'wall', a: [1.3, 0.6], b: [1.3, -2.6], top: 0.75 },
      // plateau d'arrivée (le bord du ravin est ouvert)
      { kind: 'wall', a: [2.4, -2.6], b: [2.4, -6] },
      { kind: 'wall', a: [2.4, -6], b: [-2.4, -6] },
      { kind: 'wall', a: [-2.4, -6], b: [-2.4, -2.6] },
      { kind: 'post', x: -0.5, z: 3.0, r: 0.12, y: 0.82, style: 'pin' },
      { kind: 'post', x: 0.5, z: 2.2, r: 0.12, y: 0.6, style: 'pin' },
    ],
    decor: [
      { kind: 'pine', x: -3.4, z: 2.0 },
      { kind: 'pine', x: 3.6, z: 3.4 },
      { kind: 'snowman', x: -3.4, z: -4.4 },
      { kind: 'chalet', x: 3.7, z: -1.0, rot: -Math.PI / 2 },
      { kind: 'pine', x: 0.2, z: -1.4 },
    ],
    route: [[0, 5.2], [0, 1.0], [1.9, 1.0], [1.9, -3.0], [-1.4, -4.8]],
  },
  {
    id: 29,
    name: 'Le Sommet de Dédé',
    blurb: 'Patinoire, balcon, sommet… ou la télécabine pour les malins',
    par: 5,
    theme: 'snow',
    void: true,
    tee: [1.6, 5.2],
    cup: [1.4, -5.2],
    cupY: 1,
    pieces: [
      { kind: 'floor', x0: -2.6, x1: 2.6, z0: 2.6, z1: 6, skin: 'ice' },
      { kind: 'ramp', x0: 1.4, x1: 2.6, z0: -0.4, z1: 2.6, y0: 0.5, y1: 0 },
      { kind: 'floor', x0: -2.6, x1: -0.4, z0: -2.2, z1: -0.4, y: 0.5 },
      { kind: 'floor', x0: -0.4, x1: 0.4, z0: -2.2, z1: -0.4, y: 0.5, skin: 'snow' },
      { kind: 'floor', x0: 0.4, x1: 2.6, z0: -2.2, z1: -0.4, y: 0.5 },
      { kind: 'ramp', x0: -2.6, x1: -1.4, z0: -4.4, z1: -2.2, y0: 1, y1: 0.5 },
      { kind: 'floor', x0: -2.6, x1: 2.6, z0: -6, z1: -4.4, y: 1 },
      // patinoire du bas
      { kind: 'wall', a: [-2.6, 6], b: [2.6, 6] },
      { kind: 'wall', a: [-2.6, 6], b: [-2.6, 2.6] },
      { kind: 'wall', a: [2.6, 6], b: [2.6, 2.6] },
      { kind: 'wall', a: [-2.6, 2.6], b: [1.4, 2.6] },
      { kind: 'post', x: 0.2, z: 4.4, r: 0.12, style: 'pin' },
      { kind: 'post', x: -1.0, z: 5.0, r: 0.12, style: 'pin' },
      // télécabine (raccourci jusqu'au balcon) gardée par trois piquets
      { kind: 'post', x: -1.0, z: 3.66, r: 0.12, style: 'pin' },
      { kind: 'post', x: -1.46, z: 3.2, r: 0.12, style: 'pin' },
      { kind: 'post', x: -1.0, z: 2.74, r: 0.12, style: 'pin' },
      { kind: 'tube', a: [-1.0, 3.2], b: [2.0, -1.3], yb: 0.5, dir: [-1, 0], arc: 1.0, color: '#E63946' },
      // rampe vers le balcon
      wallAt([1.4, 2.6], [1.4, -0.4], 0, 0.8),
      wallAt([2.6, 2.6], [2.6, -0.4], 0, 0.8),
      // balcon (le bord avant donne sur le vide)
      wallAt([2.6, -0.4], [2.6, -2.2], 0.5),
      wallAt([-1.4, -2.2], [2.6, -2.2], 0.5),
      wallAt([-2.6, -0.4], [-2.6, -2.2], 0.5),
      // rampe vers le sommet
      wallAt([-2.6, -2.2], [-2.6, -4.4], 0.5, 0.8),
      wallAt([-1.4, -2.2], [-1.4, -4.4], 0.5, 0.8),
      // sommet : bord droit et bord avant ouverts sur le vide
      wallAt([-2.6, -4.4], [-2.6, -6], 1),
      wallAt([-2.6, -6], [2.6, -6], 1),
      wallAt([-1.4, -4.4], [0.4, -4.4], 1),
    ],
    decor: [
      { kind: 'pine', x: -3.6, z: 1.0 },
      { kind: 'pine', x: 3.6, z: -3.0 },
      { kind: 'chalet', x: 3.8, z: 1.4, rot: -Math.PI / 2 },
      { kind: 'snowman', x: -3.6, z: -3.4 },
      { kind: 'pine', x: 0.2, z: 1.2 },
    ],
    route: [[1.6, 5.2], [2.0, 3.4], [2.0, -1.3], [-2.0, -1.3], [-2.0, -4.8], [1.4, -5.2]],
  },
]

/** Parcours « La Kermesse du village » (ids, dans l'ordre). Dupliqué avec `_mg_course()->'kermesse'`. */
export const KERMESSE = [1, 2, 3, 4, 5, 6, 7, 8, 9]

/** Parcours « Défi » (ids, dans l'ordre). Dupliqué avec `_mg_course()->'defi'`. */
export const DEFI = [21, 22, 23, 24, 25, 26, 27, 28, 29]

/** Les ids 1..RANDOM_POOL sont tirés au sort (aléatoire, express) ; le Défi n'est jamais tiré. Dupliqué : `_mg_course()->'pool'`. */
export const RANDOM_POOL = 20

export const holeById = (id: number): HoleDef => HOLES.find((h) => h.id === id) ?? HOLES[0]

/** Le trou a un clocher : la cloche sonne quand une balle rentre. */
export const hasBell = (h: HoleDef) => !!h.decor?.some((d) => d.kind === 'bell')

/** Hauteur du sol (dalles / rampes) en (x, z) ; 0 hors des dalles. */
export function floorHeight(h: HoleDef, x: number, z: number): number {
  let best = -Infinity
  for (const p of h.pieces) {
    if (p.kind === 'floor' && x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1) best = Math.max(best, p.y ?? 0)
    if (p.kind === 'ramp' && x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1) {
      const k = p.axis === 'x' ? (x - p.x0) / (p.x1 - p.x0) : (z - p.z0) / (p.z1 - p.z0)
      best = Math.max(best, p.y0 + (p.y1 - p.y0) * k)
    }
  }
  return best === -Infinity ? 0 : best
}

/**
 * Coups max sur un trou : MIN_CAP (6), ou par + CAP_OVER_PAR pour les longs trous (par 5 → 7, par 6 → 8).
 * Dupliqué côté serveur (`_mg_cap()` / `_mg_picked()` de mini-golf.sql), synchro vérifiée par le test SQL.
 */
export const MIN_CAP = 6
export const CAP_OVER_PAR = 2
export const maxStrokes = (par: number) => Math.max(MIN_CAP, par + CAP_OVER_PAR)
/** Score inscrit pour une balle non rentrée (ramassée) : coups max + 1 (7 sur un par 2 à 4). */
export const pickedUp = (par: number) => maxStrokes(par) + 1
