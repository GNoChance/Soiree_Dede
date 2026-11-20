/**
 * Contrat des thèmes du plateau 3D : un thème = une palette (clair / sombre), un décor fixe construit une
 * fois (`build`) et, en retour, les crochets animés (mécanique du plateau, évènements, caméra).
 * PartyScene garde tout ce qui est commun aux 5 plateaux (cases, ruban, pions, étoiles, dés, public…).
 */
import type * as THREE from 'three'
import type { BoardView } from '../../anim'
import type { BoardDef } from '../../board'
import type { DpEvent } from '../../types'

export interface Palette {
  bg: string
  floorA: string
  floorB: string
  carpet: string
  carpetDot: string
  road: string
  sky: string
  ground: string
  hemi: number
  sun: number
  beam: number
  /** Toile de fond (rideaux du Grand Plateau). */
  curtain: string
}

export interface ThemeCtx {
  scene: THREE.Scene
  board: BoardDef
  /** Pas de la grille, hauteur du dessus des cases. */
  S: number
  TOP_Y: number
  halfX: number
  halfZ: number
  /** Toiles de fond : plan du fond (z) et plan de droite (x) — repoussées au-delà de l'emprise en grande taille. */
  zWall: number
  xWall: number
  /**
   * Emprise des cases ouvertes en coordonnées monde. L'origine reste au centre du plateau de base (taille S) à
   * toutes les tailles : `grid(col, row)` est juste pour les quartiers (colonnes / lignes négatives ou > 10).
   * Taille du tracé et quartiers : `board.size`, `board.quarters` (ouverts), `board.closed` (fermés : le
   * voile générique et la plaque « 🔒 » sont posés par PartyScene), `board.alt` (altitude des cases, ski).
   */
  ext: { minX: number; maxX: number; minZ: number; maxZ: number }
  /** Télé (plus de détails permis). */
  tv: boolean
  /**
   * Décor « détail » (petits objets d'un quartier) : masqué au téléphone en grande taille quand il est à plus de
   * 22 unités de la cible de la caméra, et en vue d'ensemble. `at` : position de référence (défaut : celle de l'objet).
   */
  detail: (obj: THREE.Object3D, at?: THREE.Vector3) => void
  /** Socle (tapis) d'un quartier ouvert, posé par PartyScene : le thème peut le recolorer ou le masquer. */
  socle: (id: string) => THREE.Group | null
  /** Mon pion (téléphone, grande taille) : pour cadrer le raton ou le banc de MA zone pendant l'épilogue. */
  focusId: () => string | null
  /** Cible courante de la caméra (lecture seule). */
  camTarget: () => THREE.Vector3
  /** Position monde d'une case / d'un point de grille (décimales permises). */
  cellPos: (i: number, out?: THREE.Vector3) => THREE.Vector3
  grid: (col: number, row: number, y?: number, out?: THREE.Vector3) => THREE.Vector3
  toon: (color: THREE.ColorRepresentation, extra?: THREE.MeshToonMaterialParameters) => THREE.MeshToonMaterial
  /** Maillage + contour encre. */
  inked: (geo: THREE.BufferGeometry, mat: THREE.Material, grow?: number) => THREE.Group
  sprite: (map: THREE.Texture, opts?: THREE.SpriteMaterialParameters) => THREE.Sprite
  track: <T extends { dispose: () => void }>(x: T) => T
  tex: { glow: THREE.Texture; sparkle: THREE.Texture; beam: THREE.Texture }
  /** Matériaux encre partagés. */
  inkBack: THREE.Material
  inkFront: THREE.Material
  /** Estrade de Dédé (déjà placée et à l'échelle) et le sprite de Dédé posé dessus. */
  stage: THREE.Group
  dede: THREE.Sprite
  isDark: () => boolean
  time: () => number
  /** Effets communs. */
  label: (text: string, bg: string, at: THREE.Vector3, order?: number) => void
  confetti: (at: THREE.Vector3, n: number) => void
  /** Pièces qui volent d'un point vers un autre (ou vers la tête d'un pion). */
  coinsFly: (from: THREE.Vector3, to: THREE.Vector3 | string, n: number) => void
  puff: (at: THREE.Vector3, color?: string) => void
  /** Tête d'un pion (null s'il n'existe pas). */
  pawnHead: (id: string) => THREE.Vector3 | null
  shake: (k: number) => void
  cheer: (k: number) => void
  /** Ola du public (s). */
  ola: (sec: number) => void
  /** Guirlande en chenillard (s). */
  chase: (sec: number) => void
}

export interface ThemeRuntime {
  /** Chaque image (décor animé, mécanique). */
  update?: (view: BoardView, dt: number) => void
  /** Évènement du pion en vedette ; true = géré (pas d'effet générique). */
  onEvent?: (e: DpEvent, pawnId: string, order: number) => boolean
  /** Évènement de l'épilogue (croisement de Riton, pion emporté). */
  onEpiEvent?: (e: DpEvent, order: number) => boolean
  /** Cible de caméra quand aucun pion n'est en vedette (Riton pendant sa ronde). */
  focus?: (view: BoardView) => THREE.Vector3 | null
  /** Dé à faire rouler hors pion (dé de Riton). */
  dieAnchor?: (view: BoardView) => { pos: THREE.Vector3; value: number; t: number } | null
  /** Plusieurs dés hors pion (la famille Raton : un dé au-dessus de chaque raton, 3 au plus) ; prioritaire sur dieAnchor. */
  dieAnchors?: (view: BoardView) => Array<{ pos: THREE.Vector3; value: number; t: number }>
  /** Thème clair / sombre basculé. */
  applyTheme?: (dark: boolean) => void
}

export interface ThemeDef {
  palette: { light: Palette; dark: Palette }
  /** Couleurs des 3 marches de l'estrade de Dédé (sinon l'estrade est construite par le thème). */
  stageColors?: [string, string, string]
  /** Couleurs de la guirlande d'ampoules. */
  bulbs?: string[]
  build: (ctx: ThemeCtx) => ThemeRuntime
}
