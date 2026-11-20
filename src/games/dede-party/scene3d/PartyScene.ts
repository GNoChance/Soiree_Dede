/**
 * Plateau 3D de Dédé Party (three « brut », chargé en différé) : un plateau télé façon sticker book,
 * paramétré par le plateau de la partie (`BoardDef`) et son thème (`themes/<id>.ts`).
 *
 * - Commun aux 5 plateaux : cases épaisses (couleur du type, liseré encre, emoji), ruban du chemin
 *   (teinté par zone, chevrons de sens), aiguillages (flèche sur poteau + voie ouverte éclairée), tapis,
 *   guirlande, toile de fond, gradins et public, projecteurs, estrade de Dédé, pions, étoiles, dés,
 *   pièces, confettis, étiquettes, caméra.
 * - Thème : palette clair / sombre, décor fixe, mécanique animée (marée, cagnotte, Riton, télésièges).
 * - Animation : RIEN n'est simulé ici. Chaque image demande `getView()` (anim.ts : quel pion, quelle
 *   case, quelle fraction de saut, quel moment de l'épilogue à l'heure serveur) : télé et téléphones
 *   montrent la même chose.
 * - Caméra : vue d'ensemble (lancer, début de tour, marée), suivi fluide du pion en vedette (ou de Riton
 *   pendant sa ronde), travelling circulaire pendant les mini-jeux. Portrait : un quart de tour.
 * - Perfs : pixelRatio plafonné, une seule ombre portée calculée une fois (décor fixe), pions sans
 *   ombre portée (socle), instanciation de tout ce qui se répète, particules en réserve fixe,
 *   pause onglet caché, dispose() complet.
 */
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { BoardView, Leap } from '../anim'
import { DICE_MS } from '../anim'
import { boardOf, CELL_INFO, isJump, linksOf, quarterOf, transportOf, zoneOf, type BoardDef, type CellType, type GateLook, type Quarter } from '../board'
import { PIC, skiTerrain } from '../boards/ski-relief'
import type { DpEvent } from '../types'
import { makeBeam, makeCarpet, makeCellTop, makeDieFace, makeFloor, makeGlow, makeLabel, makePlate, makeSparkle, shade } from './textures'
import { THEMES } from './themes'
import { freeze, freezeLocal } from './themes/kit'
import type { Palette, ThemeCtx, ThemeDef, ThemeRuntime } from './themes/types'

export interface ScenePlayer {
  id: string
  color: string
  /** Image du chibi (tenue équipée) et repli (tenue de base). */
  url: string
  fallback: string
}

export interface SceneOptions {
  /** Ce que montre le plateau maintenant (horloge serveur). */
  getView: () => BoardView
  /** Chibi de Dédé l'animatrice (et repli). */
  dedeUrl: string
  dedeFallback: string
  /** Télé : plus de détails (ombres fines, pixelRatio 2). */
  big?: boolean
  onLost: () => void
  /** Plateau de la partie (fixe pendant la vie de la scène). */
  board: BoardDef
}

type CamMode = 'overview' | 'follow' | 'show'

const S = 1.3
const TILE = 1.04
const TILE_H = 0.3
const TOP_Y = TILE_H + 0.02
const FOV = 36
const INK = '#1f1b2e'
const GOLD = '#FFD23F'
const CONFETTI = ['#EF476F', '#FFD166', '#06D6A0', '#4CC9F0', '#8B5CF6', '#FF8FA3']
const BULBS = ['#FFD23F', '#FF8FA3', '#fff6e5']

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const easeOut = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3)
const easeInOut = (t: number) => {
  const x = clamp(t, 0, 1)
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2
}
/** Pseudo-hasard déterministe (décor identique d'un écran à l'autre). */
const rand = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

/** Habillage animé d'une porte : bac, cabine, barrière, tourniquet, portique (suit `sw`). */
interface GateRig {
  look: GateLook
  root: THREE.Group
  /** Partie mobile (bac, cabine, bras, tourniquet) et ses deux positions (voie 0 / voie 1). */
  part: THREE.Object3D
  a: THREE.Vector3
  b: THREE.Vector3
  /** Panneau du portique / voyant du tourniquet (vert = ouvert). */
  lamp: THREE.MeshToonMaterial | null
  k: number
}

interface Pawn {
  id: string
  group: THREE.Group
  sprite: THREE.Sprite
  base: THREE.Mesh
  ring: THREE.Mesh
  cur: THREE.Vector3
  scale: number
  /** Saut en cloche vers une case lointaine (carte « échange », vague). */
  arc: { from: THREE.Vector3; to: THREE.Vector3; t0: number } | null
  landAt: number
  placed: boolean
}

interface Star {
  group: THREE.Group
  mesh: THREE.Object3D
  glow: THREE.Sprite
  beam: THREE.Mesh
  sparkles: THREE.Sprite[]
  cell: number
  /** Déménagement : s'envole vers le pion puis retombe sur sa nouvelle Loge. */
  move: { t0: number; from: THREE.Vector3; via: THREE.Vector3 | null } | null
}

interface Particle {
  mesh: THREE.Object3D
  vel: THREE.Vector3
  spin: THREE.Vector3
  age: number
  life: number
  kind: 'coin_in' | 'coin_out' | 'confetti' | 'dust'
  /** coin_in : file vers la tête d'un pion, ou vers un point fixe (stand, sac de Riton). */
  target: Pawn | null
  goal: THREE.Vector3 | null
  size: number
}

interface FloatLabel {
  sprite: THREE.Sprite
  age: number
  base: THREE.Vector3
  w: number
  h: number
}

const LEAP_H: Record<Leap, number> = { lift: 2.6, ice: 1.1, luge: 3.9, boat: 0.35, cabin: 3.2, slide: 1.2 }
const LEAP_LABEL: Record<Leap, [string, string]> = { lift: ['🚡 Télésiège !', '#B5E61D'], ice: ['🧊 Glissade !', '#DFF3FF'], luge: ['🛷 Grande Luge !', '#ffffff'], boat: ['⛴️ En bac !', '#9be7ff'], cabin: ['🚠 Télécabine !', '#FFD166'], slide: ['⛷️ Piste !', '#ffffff'] }
const LEAP_TRAIL: Record<Leap, string> = { lift: '#fff2c4', ice: '#dff3ff', luge: '#ffffff', boat: '#e8fbff', cabin: '#fff6e5', slide: '#ffffff' }

export class PartyScene {
  private host: HTMLElement
  private opts: SceneOptions
  private board: BoardDef
  private theme: ThemeDef
  private rt: ThemeRuntime = {}
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 320)
  private fitCam = new THREE.PerspectiveCamera(FOV, 1, 0.5, 320)
  private disposables: Array<{ dispose: () => void }> = []
  private cleanups: Array<() => void> = []
  private disposed = false
  private raf = 0
  private lastT = 0
  private time = 0
  private width = 1
  private height = 1
  private portrait = false
  private dark = false
  private pal: Palette
  private ramp!: THREE.DataTexture
  private inkBack!: THREE.MeshBasicMaterial
  private inkFront!: THREE.MeshBasicMaterial
  private maxAniso = 1
  private halfX: number
  private halfZ: number
  private zWall: number
  private xWall: number
  /** Grande taille (M / L) : géométrie allégée, ombres et décor au loin gérés par zone. */
  private big: boolean
  /** Dédé 2500 / 3000 : la grande montagne en relief (sol, caméra, pistes). */
  private mountain: boolean
  private pisteKey = ''
  /** Cible de la vue d'ensemble de la montagne (recentrée par fitDistance). */
  private ovT: THREE.Vector3 | null = null
  private piste: { pts: THREE.Vector3[]; lens: number[]; len: number } = { pts: [], lens: [], len: 0 }
  /** Emprise des cases ouvertes en coordonnées monde (taille S : ±halfX, ±halfZ) et son centre. */
  private ext: { minX: number; maxX: number; minZ: number; maxZ: number }
  private center = new THREE.Vector3()

  // lumières / thème
  private hemi!: THREE.HemisphereLight
  private sun!: THREE.DirectionalLight
  private floorMat!: THREE.MeshToonMaterial
  private carpetMat!: THREE.MeshToonMaterial
  private curtainMat!: THREE.MeshToonMaterial
  private beamMats: THREE.MeshBasicMaterial[] = []

  // plateau
  /** Cases instanciées : un corps et un dessus par type (≤ 18 appels de dessin pour tout le plateau). */
  private tiles: Array<{ type: CellType; k: number; bump: number }> = []
  private tileBodies = new Map<CellType, THREE.InstancedMesh>()
  private tileTops = new Map<CellType, THREE.InstancedMesh>()
  private bumped = new Set<number>()
  private links: Array<[number, number]> = []
  private roadIn!: THREE.InstancedMesh
  private forkLinks: number[][] = []
  private signs: Array<{ at: THREE.Vector3; ang: number; vel: number; way: number; wiggle: number; gate: GateRig | null }> = []
  /** Flèches des panneaux : instanciées (corps jaune ou bleu marée + contour encre), une instance par porte. */
  private arrows: { body: THREE.InstancedMesh; ink: THREE.InstancedMesh; tide: THREE.InstancedMesh; tideInk: THREE.InstancedMesh; slot: Array<[boolean, number]> } | null = null
  /** Liseré des 12 prochaines cases de mon trajet probable (vue perso). */
  private route!: THREE.InstancedMesh
  /** Véhicule à bord duquel voyage le pion en vedette (bac, cabine, luge), créé à la demande. */
  private rides = new Map<string, THREE.Group>()
  /** Décor « détail » des quartiers : masqué au loin (téléphone, grande taille). */
  private details: Array<{ obj: THREE.Object3D; at: THREE.Vector3 }> = []
  private detailTick = 0
  /** Socles des quartiers ouverts, voiles des quartiers fermés. */
  private socles = new Map<string, THREE.Group>()
  /** Décor fixe des portes (pieds, poteaux, gares), fusionné en un seul lot. */
  private gateStatic = new THREE.Group()
  private dots: Array<{ p: THREE.Vector3; color: string; r: number }> = []
  private veils: Array<{ q: Quarter; group: THREE.Group; clouds: THREE.Sprite[]; mats: THREE.Material[] }> = []
  private bulbs!: THREE.InstancedMesh
  private bulbTick = -1
  private chaseUntil = 0

  // décor animé
  private crowdHeads!: THREE.InstancedMesh
  private crowdBodies!: THREE.InstancedMesh
  private crowd: Array<{ x: number; y: number; z: number; ph: number }> = []
  private cheerK = 0
  private olaUntil = 0
  private beams: Array<{ mesh: THREE.Mesh; src: THREE.Vector3; aim: THREE.Vector3; ph: number }> = []
  private spot!: THREE.Mesh
  private stage!: THREE.Group
  private dede!: THREE.Sprite

  // acteurs
  private players: ScenePlayer[] = []
  private pawns = new Map<string, Pawn>()
  private pawnTex = new Map<string, THREE.Texture>()
  private baseGeo!: THREE.CylinderGeometry
  private baseInkGeo!: THREE.CylinderGeometry
  private ringGeo!: THREE.TorusGeometry
  private ringMat!: THREE.MeshBasicMaterial
  private stars: Star[] = []
  private starInst: { body: THREE.InstancedMesh; hull: THREE.InstancedMesh } | null = null
  private pawnInst: { base: THREE.InstancedMesh; ink: THREE.InstancedMesh } | null = null
  private starGeo!: THREE.ExtrudeGeometry
  private starMat!: THREE.MeshToonMaterial
  private starBeamGeo!: THREE.CylinderGeometry
  private glowTex!: THREE.CanvasTexture
  private sparkleTex!: THREE.CanvasTexture
  private beamTex!: THREE.CanvasTexture
  private dice: THREE.Mesh[] = []
  private dieScale = [0, 0, 0]
  private particles: Particle[] = []
  private pool: Record<'coin' | 'confetti' | 'dust', THREE.Object3D[]> = { coin: [], confetti: [], dust: [] }
  private labels: FloatLabel[] = []

  // suivi des évènements déjà joués
  private evKey = ''
  private evCount = 0
  private hopKey = ''
  private hopCount = 0
  private leapKey = ''
  private trailT = 0
  private epiKey = ''
  private epiCount = 0
  private primed = false

  // caméra
  private mode: CamMode = 'overview'
  private phase = 'roll'
  private camT = new THREE.Vector3()
  private camAz = 0
  private camEl = 1
  private camDist = 30
  private overviewDist = 30
  private camSnap = true
  private focusId: string | null = null
  private tilesOriented = false
  private frameAvg = 16
  private slowFor = 0
  private quality = 0
  private shadowAt = new THREE.Vector3(1e9, 0, 0)
  private shadowT = 0
  private frameTick = 0
  /** Générique : début (survol des quartiers) ; transport en cours (plan de traversée). */
  private introT0 = -1
  private introShown = -1
  private rideKey = ''
  private rideMid = new THREE.Vector3()
  private rideDist = 26
  private forceOverview = false
  private frameRect: { c0: number; r0: number; c1: number; r1: number } | null = null
  private shakeK = 0
  private tmp = new THREE.Vector3()
  private tmp2 = new THREE.Vector3()
  private tmpQ = new THREE.Quaternion()
  private tmpM = new THREE.Matrix4()
  private tmpC = new THREE.Color()

  constructor(host: HTMLElement, opts: SceneOptions) {
    this.host = host
    this.opts = opts
    this.board = opts.board
    this.theme = THEMES[opts.board.id] ?? THEMES.grand
    // Repère monde : l'origine reste au centre du plateau de base (taille S) à toutes les tailles, les quartiers
    // s'étendent autour (colonnes / lignes négatives ou au-delà de 10) ; le décor existant reste juste.
    const base = boardOf(this.board.id)
    this.halfX = ((base.cols - 1) / 2) * S
    this.halfZ = ((base.rows - 1) / 2) * S
    this.big = this.board.size !== 's'
    this.mountain = this.big && this.board.id === 'ski'
    const c0 = Math.min(0, this.board.col0)
    const r0 = Math.min(0, this.board.row0)
    this.ext = {
      minX: (c0 - (base.cols - 1) / 2) * S,
      maxX: (Math.max(base.cols - 1, this.board.col0 + this.board.cols - 1) - (base.cols - 1) / 2) * S,
      minZ: (r0 - (base.rows - 1) / 2) * S,
      maxZ: (Math.max(base.rows - 1, this.board.row0 + this.board.rows - 1) - (base.rows - 1) / 2) * S,
    }
    this.center.set((this.ext.minX + this.ext.maxX) / 2, 0, (this.ext.minZ + this.ext.maxZ) / 2)
    this.zWall = this.ext.minZ - 6.3
    this.xWall = this.ext.maxX + 6.3
    // Dédé 2500 / 3000 : la toile du fond passe derrière toute la montagne (jusqu'au Pic, ligne −13).
    // Le massif (et ses sommets, jusqu'à la ligne −21) est tout entier devant la toile.
    if (this.mountain) this.zWall = Math.min(this.zWall, -23 * S - this.halfZ)
    this.dark = document.documentElement.classList.contains('dark')
    this.pal = this.dark ? this.theme.palette.dark : this.theme.palette.light
    const cores = navigator.hardwareConcurrency || 4
    const dpr = Math.min(window.devicePixelRatio || 1, opts.big ? 2 : cores <= 4 ? 1.5 : 2)
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(dpr)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.shadowMap.autoUpdate = false
    this.maxAniso = Math.min(4, this.renderer.capabilities.getMaxAnisotropy())
    const el = this.renderer.domElement
    el.style.cssText = 'display:block;width:100%;height:100%;touch-action:pan-y;outline:none'
    el.setAttribute('role', 'img')
    el.setAttribute('aria-label', `${this.board.name} en 3D`)
    host.appendChild(el)

    this.ramp = this.track(new THREE.DataTexture(new Uint8Array([120, 185, 235, 255]), 4, 1, THREE.RedFormat))
    this.ramp.minFilter = this.ramp.magFilter = THREE.NearestFilter
    this.ramp.needsUpdate = true
    this.inkBack = this.track(new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide }))
    this.inkFront = this.track(new THREE.MeshBasicMaterial({ color: INK }))
    this.glowTex = this.track(makeGlow())
    this.sparkleTex = this.track(makeSparkle())
    this.beamTex = this.track(makeBeam())

    this.buildLights()
    this.buildGround()
    this.buildBoard()
    this.buildForks()
    this.buildCenter()
    this.buildStudio()
    this.buildActors()
    this.buildVeils()
    this.rt = this.theme.build(this.ctx())
    this.applyTheme()

    this.resize()
    const ro = new ResizeObserver(() => this.resize())
    ro.observe(host)
    this.cleanups.push(() => ro.disconnect())
    const mo = new MutationObserver(() => {
      const dark = document.documentElement.classList.contains('dark')
      if (dark !== this.dark) {
        this.dark = dark
        this.pal = dark ? this.theme.palette.dark : this.theme.palette.light
        this.applyTheme()
      }
    })
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    this.cleanups.push(() => mo.disconnect())
    const lost = (e: Event) => {
      e.preventDefault()
      this.opts.onLost()
    }
    el.addEventListener('webglcontextlost', lost)
    this.cleanups.push(() => el.removeEventListener('webglcontextlost', lost))

    this.renderer.shadowMap.needsUpdate = true
    this.lastT = performance.now()
    this.raf = requestAnimationFrame(this.frame)
  }

  /* ------------------------------ outils ------------------------------ */

  private track<T extends { dispose: () => void }>(x: T): T {
    this.disposables.push(x)
    return x
  }

  private toon(color: THREE.ColorRepresentation, extra: THREE.MeshToonMaterialParameters = {}) {
    return this.track(new THREE.MeshToonMaterial({ color, gradientMap: this.ramp, ...extra }))
  }

  /** Maillage + son contour encre (même forme, grossie, vue de l'intérieur). */
  private inked(geo: THREE.BufferGeometry, mat: THREE.Material, grow = 1.07): THREE.Group {
    const g = new THREE.Group()
    const m = new THREE.Mesh(geo, mat)
    m.castShadow = true
    const o = new THREE.Mesh(geo, this.inkBack)
    o.scale.setScalar(grow)
    g.add(m, o)
    return g
  }

  private sprite(map: THREE.Texture, opts: THREE.SpriteMaterialParameters = {}): THREE.Sprite {
    return new THREE.Sprite(this.track(new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, ...opts })))
  }

  /** Position monde d'un point de grille (colonne, ligne ; décimales permises). */
  private grid(col: number, row: number, y = 0, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(col * S - this.halfX, y, row * S - this.halfZ)
  }

  /** Position monde d'une case (au sol de sa terrasse : altitude des lacets de Dédé 2000). */
  private cellPos(i: number, out = new THREE.Vector3()): THREE.Vector3 {
    const n = this.board.cells.length
    const k = ((i % n) + n) % n
    const [col, row] = this.board.xy[k]
    return this.grid(col, row, this.board.alt?.[k] ?? 0, out)
  }

  /** Hauteur du sol en (x, z) monde : la neige du massif sur Dédé 2500 / 3000, 0 ailleurs. */
  private groundY(x: number, z: number): number {
    return this.mountain ? skiTerrain((x + this.halfX) / S, (z + this.halfZ) / S) : 0
  }

  /** Montagne : points du trajet d'une piste / de la Grande Descente (on rejoint le Grand Couloir, colonne 5). */
  private pistePts(from: number, to: number): THREE.Vector3[] {
    const [ca, ra] = this.board.xy[from]
    const [cb, rb] = this.board.xy[to]
    const g: Array<[number, number]> = [[ca, ra]]
    if (ca !== 5) g.push([5, ra])
    g.push([5, -0.6], [cb, rb])
    return g.map(([c, r]) => this.grid(c, r))
  }

  /** Point d'un trajet de piste à la fraction e (au ras de la neige) ; renvoie le cap et l'avancée dans le dernier tronçon. */
  private pisteAt(from: number, to: number, e: number, out: THREE.Vector3): { heading: number; last: number } {
    const key = `${from}-${to}`
    if (key !== this.pisteKey) {
      this.pisteKey = key
      const pts = this.pistePts(from, to)
      const lens = pts.slice(1).map((p, i) => p.distanceTo(pts[i]))
      this.piste = { pts, lens, len: lens.reduce((a, b) => a + b, 0) }
    }
    const { pts, lens, len } = this.piste
    let d = clamp(e, 0, 1) * len
    for (let k = 0; k < lens.length; k++) {
      if (d <= lens[k] || k === lens.length - 1) {
        const f = lens[k] > 0 ? clamp(d / lens[k], 0, 1) : 1
        out.lerpVectors(pts[k], pts[k + 1], f)
        out.y = this.groundY(out.x, out.z)
        return { heading: -Math.atan2(pts[k + 1].z - pts[k].z, pts[k + 1].x - pts[k].x), last: k === lens.length - 1 ? f : -1 }
      }
      d -= lens[k]
    }
    return { heading: 0, last: -1 }
  }

  /** Ce que les thèmes peuvent utiliser. */
  private ctx(): ThemeCtx {
    return {
      scene: this.scene,
      board: this.board,
      S,
      TOP_Y,
      halfX: this.halfX,
      halfZ: this.halfZ,
      zWall: this.zWall,
      xWall: this.xWall,
      cellPos: (i, out) => this.cellPos(i, out),
      grid: (c, r, y, out) => this.grid(c, r, y, out),
      toon: (c, e) => this.toon(c, e),
      inked: (g, m, grow) => this.inked(g, m, grow),
      sprite: (m, o) => this.sprite(m, o),
      track: (x) => this.track(x),
      tex: { glow: this.glowTex, sparkle: this.sparkleTex, beam: this.beamTex },
      inkBack: this.inkBack,
      inkFront: this.inkFront,
      stage: this.stage,
      dede: this.dede,
      isDark: () => this.dark,
      time: () => this.time,
      label: (text, bg, at, order = 0) => this.label(text, bg, at, order),
      confetti: (at, n) => this.confetti(at, n),
      coinsFly: (from, to, n) => this.coinsFly(from, to, n),
      puff: (at, color) => this.puff(at, color),
      pawnHead: (id) => {
        const pw = this.pawns.get(id)
        return pw ? this.headOf(pw, new THREE.Vector3()) : null
      },
      shake: (k) => (this.shakeK = Math.max(this.shakeK, k)),
      cheer: (k) => (this.cheerK = Math.max(this.cheerK, k)),
      ola: (sec) => (this.olaUntil = this.time + sec),
      chase: (sec) => (this.chaseUntil = this.time + sec),
      ext: { ...this.ext },
      tv: Boolean(this.opts.big),
      detail: (obj, at) => {
        this.details.push({ obj, at: at ?? obj.getWorldPosition(new THREE.Vector3()) })
      },
      socle: (id) => this.socles.get(id) ?? null,
      focusId: () => this.focusId,
      camTarget: () => this.camT,
    }
  }

  /* ------------------------------ construction ------------------------------ */

  private buildLights() {
    this.hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1)
    this.scene.add(this.hemi)
    this.sun = new THREE.DirectionalLight(0xffffff, 1.5)
    this.sun.position.set(-7, 15, 9)
    this.sun.castShadow = true
    const size = this.opts.big ? 2048 : 1024
    this.sun.shadow.mapSize.set(size, size)
    const cam = this.sun.shadow.camera
    if (!this.big) {
      cam.left = -(this.halfX + 6.5)
      cam.right = this.halfX + 8.5
      cam.top = this.halfZ + 7.8
      cam.bottom = -(this.halfZ + 7.8)
    } else {
      // Grande taille : une carte d'ombre cadrée sur la cible de la caméra (téléphone ± 14, télé ± 24 en L,
      // toute l'emprise en M), recadrée quand la cible bouge (updateShadow).
      const R = this.shadowR()
      cam.left = -R
      cam.right = R
      cam.top = R
      cam.bottom = -R
    }
    cam.near = 2
    cam.far = 60
    this.sun.shadow.bias = -0.0015
    this.sun.shadow.radius = 4
    this.scene.add(this.sun, this.sun.target)
  }

  private buildGround() {
    // Sol : un grand disque centré sur l'emprise (assez grand pour les plateaux géants).
    const halfDiag = Math.hypot(this.ext.maxX - this.ext.minX, this.ext.maxZ - this.ext.minZ) / 2
    const floorGeo = this.track(new THREE.CircleGeometry(Math.max(60, 1.6 * halfDiag + 10), 48))
    floorGeo.rotateX(-Math.PI / 2)
    this.floorMat = this.toon('#ffffff')
    const floor = new THREE.Mesh(floorGeo, this.floorMat)
    floor.position.set(this.center.x, -0.2, this.center.z)
    floor.receiveShadow = true
    this.scene.add(floor)

    // Tapis du plateau de base (bord encre + dessus à pois).
    const w = this.halfX * 2 + 2.3
    const d = this.halfZ * 2 + 2.3
    const inkGeo = this.track(new RoundedBoxGeometry(w + 0.36, 0.2, d + 0.36, 4, 0.1))
    const ink = new THREE.Mesh(inkGeo, this.inkFront)
    ink.position.y = -0.12
    ink.receiveShadow = true
    this.scene.add(ink)
    const geo = this.track(new RoundedBoxGeometry(w, 0.2, d, 4, 0.1))
    this.carpetMat = this.toon('#ffffff')
    // Seul le dessus porte les pois : UV planaires recalculés.
    const planarUv = (g: THREE.BufferGeometry) => {
      const pos = g.getAttribute('position')
      const uv = g.getAttribute('uv') as THREE.BufferAttribute
      for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 4, pos.getZ(i) / 4)
    }
    planarUv(geo)
    const carpet = new THREE.Mesh(geo, this.carpetMat)
    carpet.position.y = -0.08
    carpet.receiveShadow = true
    this.scene.add(carpet)

    // Quartiers ouverts : un socle chacun (le tapis du quartier), que le thème peut recolorer ou masquer.
    for (const q of this.board.quarters) {
      const a = this.grid(q.box.c0 - 0.75, q.box.r0 - 0.75)
      const b = this.grid(q.box.c1 + 0.75, q.box.r1 + 0.75)
      const qw = b.x - a.x
      const qd = b.z - a.z
      const g = new THREE.Group()
      const qInk = new THREE.Mesh(this.track(new THREE.BoxGeometry(qw + 0.3, 0.18, qd + 0.3)), this.inkFront)
      qInk.position.y = -0.13
      const qGeo = this.track(new THREE.BoxGeometry(qw, 0.18, qd))
      planarUv(qGeo)
      const top = new THREE.Mesh(qGeo, this.carpetMat)
      top.position.y = -0.09
      top.receiveShadow = true
      g.add(qInk, top)
      g.position.set((a.x + b.x) / 2, 0, (a.z + b.z) / 2)
      this.scene.add(g)
      this.socles.set(q.id, g)
    }

    // Guirlande d'ampoules autour du tapis.
    const pts: Array<[number, number]> = []
    const step = 1.15
    for (let x = -w / 2 + 0.3; x <= w / 2 - 0.3; x += step) pts.push([x, -d / 2 + 0.16], [x, d / 2 - 0.16])
    for (let z = -d / 2 + 0.3 + step; z <= d / 2 - 0.3 - step; z += step) pts.push([-w / 2 + 0.16, z], [w / 2 - 0.16, z])
    const bGeo = this.track(new THREE.SphereGeometry(0.11, 10, 8))
    this.bulbs = new THREE.InstancedMesh(bGeo, this.track(new THREE.MeshBasicMaterial({ color: '#ffffff' })), pts.length)
    pts.forEach(([x, z], i) => {
      this.tmpM.makeTranslation(x, 0.1, z)
      this.bulbs.setMatrixAt(i, this.tmpM)
      this.bulbs.setColorAt(i, this.tmpC.set('#FFD166'))
    })
    this.bulbs.frustumCulled = false
    this.scene.add(this.bulbs)
  }

  /** Teinte du ruban d'une liaison : celle de la zone d'arrivée si elle en a une. */
  private roadColor(k: number): string {
    const [i, j] = this.links[k]
    return zoneOf(this.board, j)?.road ?? zoneOf(this.board, i)?.road ?? this.pal.road
  }

  /** Matrice d'une case instanciée (corps ou dessus), enfoncée de `dip` (pion qui se pose). */
  private setTile(i: number, dip = 0) {
    const t = this.tiles[i]
    const p = this.cellPos(i, this.tmp)
    this.tmpM.makeTranslation(p.x, p.y + TILE_H / 2 + 0.02 - dip, p.z)
    this.tileBodies.get(t.type)!.setMatrixAt(t.k, this.tmpM)
    this.tmpQ.setFromAxisAngle(this.tmp2.set(0, 1, 0), this.portrait ? -Math.PI / 2 : 0)
    this.tmpM.compose(this.tmp.set(p.x, p.y + TOP_Y + 0.006 - dip, p.z), this.tmpQ, this.tmp2.set(1, 1, 1))
    this.tileTops.get(t.type)!.setMatrixAt(t.k, this.tmpM)
  }

  private buildBoard() {
    const b = this.board
    const n = b.cells.length
    // Géométrie allégée en grande taille au téléphone (et en L partout) : ≤ 150 triangles par case.
    const lite = this.big && (!this.opts.big || b.size === 'l')
    // Tracé : ruban encre + ruban clair (pas de ruban pour les transports) ; la voie ouverte des aiguillages s'allume.
    this.links = linksOf(b).filter(([i, j]) => !isJump(b, i, j))
    const inkGeo = this.track(new THREE.BoxGeometry(S, 0.06, 0.52))
    const inGeo = this.track(new THREE.BoxGeometry(S, 0.06, 0.26))
    const roadInk = new THREE.InstancedMesh(inkGeo, this.inkFront, this.links.length)
    this.roadIn = new THREE.InstancedMesh(inGeo, this.track(new THREE.MeshBasicMaterial({ color: '#ffffff' })), this.links.length)
    // Chevrons de sens : un triangle toutes les 3 liaisons, posé entre deux cases, pointe dans le sens de marche.
    const tri = (len: number, half: number) => {
      const sh = new THREE.Shape()
      sh.moveTo(len * 0.55, 0)
      sh.lineTo(-len * 0.45, half)
      sh.lineTo(-len * 0.45, -half)
      sh.closePath()
      const g = this.track(new THREE.ShapeGeometry(sh))
      g.rotateX(-Math.PI / 2)
      return g
    }
    const chev = this.links.map((_, k) => k).filter((k) => k % 3 === 1)
    const chevInk = new THREE.InstancedMesh(tri(0.36, 0.2), this.inkFront, chev.length)
    const chevIn = new THREE.InstancedMesh(tri(0.22, 0.12), this.track(new THREE.MeshBasicMaterial({ color: '#FFD166' })), chev.length)
    const a = new THREE.Vector3()
    const c = new THREE.Vector3()
    const q = new THREE.Quaternion()
    const xAxis = new THREE.Vector3(1, 0, 0)
    const dir = new THREE.Vector3()
    const scale = new THREE.Vector3()
    this.links.forEach(([i, j], k) => {
      this.cellPos(i, a)
      this.cellPos(j, c)
      const mid = a.clone().add(c).multiplyScalar(0.5)
      // Pente (lacets de la montagne) : le ruban suit la terrasse.
      dir.copy(c).sub(a)
      const len = dir.length()
      q.setFromUnitVectors(xAxis, dir.normalize())
      scale.set(len / S, 1, 1)
      this.tmpM.compose(mid.clone().setY(mid.y + 0.05), q, scale)
      roadInk.setMatrixAt(k, this.tmpM)
      this.tmpM.compose(mid.clone().setY(mid.y + 0.065), q, scale)
      this.roadIn.setMatrixAt(k, this.tmpM)
      this.roadIn.setColorAt(k, this.tmpC.set(this.roadColor(k)))
      const ci = chev.indexOf(k)
      if (ci >= 0) {
        scale.set(1, 1, 1)
        this.tmpM.compose(mid.clone().setY(mid.y + 0.212), q, scale)
        chevInk.setMatrixAt(ci, this.tmpM)
        this.tmpM.compose(mid.clone().setY(mid.y + 0.218), q, scale)
        chevIn.setMatrixAt(ci, this.tmpM)
      }
    })
    this.forkLinks = b.forks.map((f) => f.ways.map((wcell) => this.links.findIndex(([i, j]) => i === f.cell && j === wcell)))
    for (const m of [roadInk, this.roadIn, chevInk, chevIn]) m.frustumCulled = false
    this.scene.add(roadInk, this.roadIn, chevInk, chevIn)

    // Cases : socle encre (instancié), corps coloré, dessus illustré — corps et dessus instanciés PAR TYPE.
    const slabGeo = this.track(lite ? new THREE.BoxGeometry(TILE + 0.16, 0.2, TILE + 0.16) : new RoundedBoxGeometry(TILE + 0.16, 0.2, TILE + 0.16, 3, 0.09))
    const slabs = new THREE.InstancedMesh(slabGeo, this.inkFront, n)
    slabs.castShadow = true
    slabs.frustumCulled = false
    const bodyGeo = this.track(new RoundedBoxGeometry(TILE, TILE_H, TILE, lite ? 1 : 3, 0.1))
    const topGeo = this.track(new THREE.PlaneGeometry(TILE * 0.94, TILE * 0.94))
    topGeo.rotateX(-Math.PI / 2)
    const types = (Object.keys(CELL_INFO) as CellType[]).filter((t) => b.cells.includes(t))
    for (const t of types) {
      const count = b.cells.filter((x) => x === t).length
      const body = new THREE.InstancedMesh(bodyGeo, this.toon(shade(CELL_INFO[t].color, -0.22)), count)
      body.castShadow = true
      body.frustumCulled = false
      const topMat = this.track(new THREE.MeshToonMaterial({ map: this.track(makeCellTop(t, this.maxAniso)), gradientMap: this.ramp, transparent: true, alphaTest: 0.4 }))
      const top = new THREE.InstancedMesh(topGeo, topMat, count)
      top.frustumCulled = false
      this.tileBodies.set(t, body)
      this.tileTops.set(t, top)
      this.scene.add(body, top)
    }
    const used = new Map<CellType, number>()
    for (let i = 0; i < n; i++) {
      const t = b.cells[i]
      const k = used.get(t) ?? 0
      used.set(t, k + 1)
      this.tiles.push({ type: t, k, bump: 0 })
      const p = this.cellPos(i)
      this.tmpM.makeTranslation(p.x, p.y + 0.1, p.z)
      slabs.setMatrixAt(i, this.tmpM)
      this.setTile(i)
    }
    this.scene.add(slabs)

    // Vue perso : liseré clair sur les 12 prochaines cases de mon trajet probable.
    const ringShape = new THREE.Shape()
    const R = TILE * 0.62
    ringShape.moveTo(-R, -R)
    ringShape.lineTo(R, -R)
    ringShape.lineTo(R, R)
    ringShape.lineTo(-R, R)
    ringShape.closePath()
    const hole = new THREE.Path()
    const r = TILE * 0.5
    hole.moveTo(-r, -r)
    hole.lineTo(-r, r)
    hole.lineTo(r, r)
    hole.lineTo(r, -r)
    hole.closePath()
    ringShape.holes.push(hole)
    const ringGeo = this.track(new THREE.ShapeGeometry(ringShape))
    ringGeo.rotateX(-Math.PI / 2)
    this.route = new THREE.InstancedMesh(ringGeo, this.track(new THREE.MeshBasicMaterial({ color: '#fffbe0', transparent: true, opacity: 0.85, depthWrite: false })), 12)
    this.route.count = 0
    this.route.frustumCulled = false
    this.route.renderOrder = 2
    this.scene.add(this.route)
  }

  /** Habillage d'une porte selon son `look` : bac, cabine, barrière, tourniquet, portique de piste. */
  private buildGateRig(look: GateLook, cell: number, way1: number, at: THREE.Vector3): GateRig | null {
    if (look === 'switch') return null
    const root = new THREE.Group()
    const o = this.cellPos(cell)
    const t = this.cellPos(way1)
    const ink = (geo: THREE.BufferGeometry, color: string, grow = 1.08) => this.inked(this.track(geo), this.toon(color), grow)
    let part: THREE.Object3D
    let a = new THREE.Vector3()
    let b = new THREE.Vector3()
    let lamp: THREE.MeshToonMaterial | null = null
    if (look === 'boat') {
      // Le bac : coque, cabine, cheminée rayée. Voie 1 (à quai) : contre l'embarcadère ; voie 0 : au ponton de l'île.
      const boat = new THREE.Group()
      const hull = ink(new THREE.BoxGeometry(1.15, 0.28, 0.55), '#EF476F')
      hull.position.y = 0.14
      const cab = ink(new THREE.BoxGeometry(0.5, 0.32, 0.42), '#fff6e5')
      cab.position.set(-0.1, 0.44, 0)
      const chim = ink(new THREE.CylinderGeometry(0.08, 0.08, 0.36, 10), '#ffffff', 1.2)
      chim.position.set(0.18, 0.62, 0)
      const band = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.085, 0.085, 0.1, 10)), this.toon('#EF476F'))
      band.position.set(0.18, 0.7, 0)
      boat.add(hull, cab, chim, band)
      part = boat
      const dirv = t.clone().sub(o).setY(0).normalize()
      a = t.clone().sub(dirv.clone().multiplyScalar(S * 0.95)).setY(0.08)
      b = o.clone().add(dirv.clone().multiplyScalar(S * 0.95)).setY(0.08)
      boat.rotation.y = -Math.atan2(dirv.z, dirv.x)
      freezeLocal(this.ctx(), boat)
      this.scene.add(boat)
      // Ligne de bouées pointillée entre l'embarcadère et le ponton.
      this.dotted(o, t, '#FFD166', 0.09)
      return { look, root: boat, part, a, b, lamp, k: -1 }
    }
    if (look === 'cabin') {
      // Télécabine : deux gares, un câble, une cabine rouge (voie 1 : elle attend en bas).
      const top = t.clone().setY(t.y + 2.4)
      const bottom = o.clone().setY(o.y + 2.4)
      for (const p of [o, t]) {
        const st = ink(new THREE.BoxGeometry(0.7, 0.6, 0.7), '#8d6e63')
        st.position.copy(p).add(this.tmp.set(0.55, 0.3, -0.55))
        const roof = ink(new THREE.ConeGeometry(0.62, 0.4, 4), '#EF476F')
        roof.position.copy(st.position).setY(st.position.y + 0.5)
        roof.rotation.y = Math.PI / 4
        this.gateStatic.add(st, roof)
      }
      const cable = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.025, 0.025, 1, 6)), this.inkFront)
      const mid = bottom.clone().add(top).multiplyScalar(0.5)
      cable.position.copy(mid)
      cable.scale.y = bottom.distanceTo(top)
      cable.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(bottom).normalize())
      this.gateStatic.add(cable)
      for (const k of [0.25, 0.5, 0.75]) {
        const p = bottom.clone().lerp(top, k)
        const g0 = this.groundY(p.x, p.z)
        const pylon = ink(new THREE.CylinderGeometry(0.06, 0.09, p.y - g0 + 0.2, 6), '#9aa0a6', 1.2)
        pylon.position.set(p.x, (p.y + g0 - 0.2) / 2, p.z)
        this.gateStatic.add(pylon)
      }
      const cabin = new THREE.Group()
      const box = ink(new RoundedBoxGeometry(0.55, 0.5, 0.45, 2, 0.1), '#EF476F')
      box.position.y = -0.35
      const win = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.57, 0.18, 0.3)), this.toon('#bde0fe'))
      win.position.y = -0.28
      const hook = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 5)), this.inkFront)
      hook.position.y = -0.05
      cabin.add(box, win, hook)
      freezeLocal(this.ctx(), cabin)
      this.scene.add(cabin)
      return { look, root: cabin, part: cabin, a: bottom, b: top, lamp, k: -1 }
    }
    root.position.copy(at)
    this.scene.add(root)
    const d = t.clone().sub(o).setY(0).normalize()
    root.rotation.y = -Math.atan2(d.z, d.x) + Math.PI / 2
    if (look === 'gate') {
      // Barrière levante rouge et blanche (voie 1 : levée).
      const post = ink(new THREE.BoxGeometry(0.18, 0.7, 0.18), '#5b4a3a')
      post.position.set(-0.55, 0.35, 0)
      const arm = new THREE.Group()
      arm.position.set(-0.55, 0.62, 0)
      for (let k = 0; k < 4; k++) {
        const seg = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.3, 0.09, 0.09)), this.toon(k % 2 ? '#ffffff' : '#EF476F'))
        seg.position.x = 0.15 + k * 0.3
        arm.add(seg)
      }
      root.add(post, arm)
      part = arm
      a = new THREE.Vector3(0, 0, 0)
      b = new THREE.Vector3(0, 0, 1.25)
      return { look, root, part, a, b, lamp, k: -1 }
    }
    if (look === 'turnstile') {
      // Tourniquet : moyeu, trois bras, voyant (vert = il tourne pour le prochain).
      const hub = ink(new THREE.CylinderGeometry(0.12, 0.14, 0.8, 10), '#c0c6cf', 1.15)
      hub.position.set(0.55, 0.4, 0)
      const arms = new THREE.Group()
      arms.position.set(0.55, 0.62, 0)
      for (let k = 0; k < 3; k++) {
        const arm = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.04, 0.04, 0.6, 6)), this.toon('#c0c6cf'))
        arm.rotation.z = Math.PI / 2
        arm.position.x = 0.3
        const holder = new THREE.Group()
        holder.rotation.y = (k * Math.PI * 2) / 3
        holder.add(arm)
        arms.add(holder)
      }
      lamp = this.toon('#06D6A0', { emissive: '#06D6A0', emissiveIntensity: 0.6 })
      const bulb = new THREE.Mesh(this.track(new THREE.SphereGeometry(0.09, 10, 8)), lamp)
      bulb.position.set(0.55, 0.88, 0)
      root.add(hub, arms, bulb)
      return { look, root, part: arms, a, b, lamp, k: -1 }
    }
    // Portique de piste : deux poteaux, un panneau vert « ouverte » / rouge « fermée ».
    for (const x of [-0.5, 0.5]) {
      const pole = ink(new THREE.CylinderGeometry(0.05, 0.05, 1.3, 6), '#fff6e5', 1.2)
      pole.position.set(x, 0.65, 0)
      root.add(pole)
    }
    lamp = this.toon('#06D6A0', { emissive: '#06D6A0', emissiveIntensity: 0.4 })
    const panel = this.inked(this.track(new THREE.BoxGeometry(1.15, 0.32, 0.06)), lamp, 1.06)
    panel.position.y = 1.25
    root.add(panel)
    return { look, root, part: panel, a, b, lamp, k: -1 }
  }

  /** Pointillés (bouées, piquets) entre deux points : un InstancedMesh de petites sphères. */
  private dotted(from: THREE.Vector3, to: THREE.Vector3, color: string, r: number) {
    const len = from.distanceTo(to)
    const n = Math.max(2, Math.round(len / 0.55))
    for (let k = 0; k < n; k++) {
      const p = from.clone().lerp(to, (k + 0.5) / n)
      p.y = (this.mountain ? Math.max(lerp(from.y, to.y, (k + 0.5) / n), this.groundY(p.x, p.z)) : Math.max(from.y, to.y) * ((k + 0.5) / n)) + 0.12
      this.dots.push({ p, color, r })
    }
  }

  private buildForks() {
    const shape = new THREE.Shape()
    shape.moveTo(-0.5, -0.17)
    shape.lineTo(0.05, -0.17)
    shape.lineTo(0.05, -0.4)
    shape.lineTo(0.58, 0)
    shape.lineTo(0.05, 0.4)
    shape.lineTo(0.05, 0.17)
    shape.lineTo(-0.5, 0.17)
    shape.closePath()
    const geo = this.track(new THREE.ExtrudeGeometry(shape, { depth: 0.14, bevelEnabled: false }))
    geo.translate(0, 0, -0.07)
    geo.rotateX(-Math.PI / 2)
    const mat = this.toon('#FFD166', { emissive: '#7a4a00', emissiveIntensity: 0.35 })
    // Aiguillage de la marée : flèche bleue (elle suit la mer, pas les pions).
    const tideMat = this.toon('#4CC9F0', { emissive: '#0b4f6c', emissiveIntensity: 0.35 })
    const poleGeo = this.track(new THREE.CylinderGeometry(0.07, 0.09, 1.4, 8))
    const poleMat = this.toon('#fff6e5')
    const footGeo = this.track(new THREE.CylinderGeometry(0.26, 0.3, 0.12, 14))
    const footMat = this.toon('#EF476F')
    this.board.forks.forEach((f) => {
      const o = this.cellPos(f.cell)
      // Les voies d'un transport partent loin : on ne garde que la direction (le panneau reste près de sa case).
      const d = f.ways.map((c) => this.cellPos(c).sub(o).setY(0).normalize())
      const at = o.clone().add(d[0].clone().add(d[1]).multiplyScalar(S * 0.5))
      // Poteau et pied : décor fixe, fusionné avec celui des autres portes (budget des appels de dessin).
      const pole = this.inked(poleGeo, poleMat, 1.25)
      pole.position.copy(at).setY(at.y + 0.7)
      const foot = this.inked(footGeo, footMat, 1.12)
      foot.position.copy(at).setY(at.y + 0.06)
      this.gateStatic.add(foot, pole)
      const side = at.clone().add(d[0].clone().sub(d[1]).multiplyScalar(-0.35))
      this.signs.push({ at: at.clone(), ang: 0, vel: 0, way: -1, wiggle: 0, gate: this.buildGateRig(f.look ?? 'switch', f.cell, f.ways[1], side) })
    })
    // Transports hors porte (navettes, passage obligé, pistes) : le trajet en pointillés.
    for (const [from, to] of this.board.jumps) {
      if (this.board.forks.some((f) => f.cell === from && f.ways[1] === to && f.look && f.look !== 'switch' && f.look !== 'piste')) continue
      const kind = transportOf(this.board, from, to)?.kind
      if (!kind || kind === 'luge') continue
      // Télécabine sans porte (passage obligé des Alpages) : une gare en bas (entre les cases 13 et 14), une en haut.
      if (kind === 'cabin') {
        const lo = this.cellPos(from)
        if (this.board.id === 'ski' && from === 13) lo.lerp(this.cellPos(14), 0.5).add(this.tmp.set(0, 0, -0.9))
        for (const p of [lo, this.cellPos(to).add(this.tmp.set(0.55, 0, -0.55))]) {
          const st = this.inked(this.track(new THREE.BoxGeometry(0.8, 0.65, 0.7)), this.toon('#8d6e63'), 1.08)
          st.position.copy(p).setY(p.y + 0.33)
          const roof = this.inked(this.track(new THREE.ConeGeometry(0.66, 0.42, 4)), this.toon('#EF476F'), 1.08)
          roof.position.copy(p).setY(p.y + 0.86)
          roof.rotation.y = Math.PI / 4
          this.gateStatic.add(st, roof)
        }
      }
      if (this.mountain && kind === 'slide') {
        const pts = this.pistePts(from, to)
        pts.slice(1).forEach((p, k) => this.dotted(pts[k], p, '#EF476F', 0.08))
        continue
      }
      this.dotted(this.cellPos(from), this.cellPos(to), kind === 'boat' ? '#FFD166' : kind === 'cabin' ? '#2b2545' : '#EF476F', kind === 'cabin' ? 0.05 : 0.08)
    }
    if (this.gateStatic.children.length) this.scene.add(freeze(this.ctx(), this.gateStatic))
    // Tous les pointillés (bouées, câbles, piquets) : un seul maillage instancié.
    if (this.dots.length) {
      const m = new THREE.InstancedMesh(this.track(new THREE.SphereGeometry(1, 8, 6)), this.toon('#ffffff'), this.dots.length)
      this.dots.forEach((d, k) => {
        this.tmpM.compose(d.p, this.tmpQ.identity(), this.tmp.set(d.r, d.r, d.r))
        m.setMatrixAt(k, this.tmpM)
        m.setColorAt(k, this.tmpC.set(d.color))
      })
      this.scene.add(m)
    }
    // Flèches : 4 maillages instanciés pour toutes les portes.
    const isTide = this.board.forks.map((f) => f.mode === 'tide')
    const nT = isTide.filter(Boolean).length
    const nA = isTide.length - nT
    const inst = (m: THREE.Material, n: number) => {
      const x = new THREE.InstancedMesh(geo, m, Math.max(1, n))
      x.count = n
      x.frustumCulled = false
      this.scene.add(x)
      return x
    }
    let a = 0
    let t = 0
    this.arrows = {
      body: inst(mat, nA),
      ink: inst(this.inkBack, nA),
      tide: inst(tideMat, nT),
      tideInk: inst(this.inkBack, nT),
      slot: isTide.map((x) => [x, x ? t++ : a++] as [boolean, number]),
    }
  }

  /** L'estrade de Dédé (placée par `board.dede`) ; un thème sans `stageColors` la construit lui-même. */
  private buildCenter() {
    const { col, row, scale } = this.board.dede
    const g = new THREE.Group()
    this.grid(col, row, 0, g.position)
    g.scale.setScalar(scale)
    const cols = this.theme.stageColors
    if (cols) {
      const t1 = this.inked(this.track(new THREE.CylinderGeometry(1.75, 1.85, 0.28, 36)), this.toon(cols[0]), 1.04)
      t1.position.y = 0.14
      const t2 = this.inked(this.track(new THREE.CylinderGeometry(1.2, 1.28, 0.24, 32)), this.toon(cols[1]), 1.05)
      t2.position.y = 0.4
      const t3 = this.inked(this.track(new THREE.CylinderGeometry(0.7, 0.76, 0.2, 28)), this.toon(cols[2]), 1.07)
      t3.position.y = 0.62
      g.add(t1, t2, t3)
      // Petites étoiles dorées posées sur la première marche.
      for (let i = 0; i < (this.big && !this.opts.big ? 0 : 6); i++) {
        const a = (i / 6) * Math.PI * 2 + 0.4
        const s = this.sprite(this.sparkleTex, { color: GOLD })
        s.scale.setScalar(0.42)
        s.position.set(Math.cos(a) * 1.48, 0.5, Math.sin(a) * 1.48)
        g.add(s)
      }
      // Les trois marches : un seul lot (le thème peut faire bouger l'estrade, elle bouge d'un bloc).
      freezeLocal(this.ctx(), g)
    }
    this.scene.add(g)
    this.stage = g
    const mat = this.track(new THREE.SpriteMaterial({ transparent: true, alphaTest: 0.08, color: '#ffffff' }))
    this.dede = new THREE.Sprite(mat)
    this.dede.center.set(0.5, 0.04)
    this.dede.scale.setScalar(2.3)
    this.dede.position.set(0, 0.7, 0)
    this.dede.visible = false
    g.add(this.dede)
    this.loadTexture([this.opts.dedeUrl, this.opts.dedeFallback], (t) => {
      mat.map = t
      mat.needsUpdate = true
      this.dede.visible = true
    })
  }

  /** Toile de fond (rideaux drapés), gradins et public, tours de projecteurs (côtés lointains de la caméra). */
  private buildStudio() {
    const { zWall, xWall } = this
    const { minX, maxX, minZ, maxZ } = this.ext
    this.curtainMat = this.toon('#ffffff', { side: THREE.DoubleSide })
    const curtain = (len: number) => {
      const geo = this.track(new THREE.PlaneGeometry(len, 8, Math.round(len * 5), 1))
      const p = geo.getAttribute('position')
      for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 3.6) * 0.22)
      geo.computeVertexNormals()
      return new THREE.Mesh(geo, this.curtainMat)
    }
    const lenA = xWall - minX + 7
    const wallA = curtain(lenA)
    wallA.position.set(xWall - lenA / 2, 3.8, zWall)
    const lenB = maxZ + 6 - zWall
    const wallB = curtain(lenB)
    wallB.rotation.y = -Math.PI / 2
    wallB.position.set(xWall, 3.8, zWall + lenB / 2)
    this.scene.add(wallA, wallB)

    // Gradins (3 marches) et public : têtes + corps instanciés qui sautillent.
    const stepMat = this.toon('#5b3fa8')
    const stepMat2 = this.toon('#7353c9')
    const seats: Array<{ x: number; y: number; z: number }> = []
    // Grande taille : les gradins font le tour de l'emprise, public plafonné (téléphone 120, télé 200) ;
    // à Dédé 2000, la montagne remplace le gradin du fond.
    const back = !(this.big && this.board.id === 'ski')
    // Gradins et tours de projecteurs : décor fixe, fusionné en un lot (budget des appels de dessin).
    const studio = new THREE.Group()
    const cap = this.opts.big ? 200 : 120
    const lenX = maxX - minX
    const lenZ = maxZ - minZ
    const pitch = Math.max(0.92, ((back ? lenX : 0) + lenZ) / (cap / 3))
    for (let r = 0; r < 3; r++) {
      const h = 0.5 + r * 0.5
      const za = minZ - 2.5 - r * 1.05
      if (back) {
        const a = new THREE.Mesh(this.track(new THREE.BoxGeometry(lenX + 1, h, 1.05)), r % 2 === 0 ? stepMat : stepMat2)
        a.position.set((minX + maxX) / 2, h / 2 - 0.2, za)
        a.castShadow = true
        studio.add(a)
        for (let x = minX + (r % 2) * 0.45; x <= maxX; x += pitch) seats.push({ x, y: h - 0.2, z: za })
      }
      const xb = maxX + 2.5 + r * 1.05
      const b = new THREE.Mesh(this.track(new THREE.BoxGeometry(1.05, h, lenZ + 1)), r % 2 === 0 ? stepMat : stepMat2)
      b.position.set(xb, h / 2 - 0.2, (minZ + maxZ) / 2)
      b.castShadow = true
      studio.add(b)
      for (let z = minZ + (r % 2) * 0.45; z <= maxZ; z += pitch) seats.push({ x: xb, y: h - 0.2, z })
    }
    const headGeo = this.track(new THREE.SphereGeometry(0.27, 12, 9))
    const bodyGeo = this.track(new THREE.CylinderGeometry(0.2, 0.3, 0.5, 10))
    this.crowdHeads = new THREE.InstancedMesh(headGeo, this.toon('#ffffff'), seats.length)
    this.crowdBodies = new THREE.InstancedMesh(bodyGeo, this.toon('#ffffff'), seats.length)
    const skins = ['#ffd9b3', '#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffe0bd']
    seats.forEach((s, i) => {
      this.crowd.push({ ...s, ph: rand(i) * 6.28 })
      this.crowdHeads.setColorAt(i, this.tmpC.set(skins[Math.floor(rand(i + 50) * skins.length)]))
      this.crowdBodies.setColorAt(i, this.tmpC.set(CONFETTI[Math.floor(rand(i + 99) * CONFETTI.length)]))
    })
    this.crowdHeads.frustumCulled = false
    this.crowdBodies.frustumCulled = false
    this.scene.add(this.crowdHeads, this.crowdBodies)

    // Tours de projecteurs + faisceaux.
    const towerGeo = this.track(new THREE.BoxGeometry(0.4, 9, 0.4))
    const towerMat = this.toon('#2b2545')
    const headGeo2 = this.track(new THREE.CylinderGeometry(0.34, 0.5, 0.8, 12))
    const lampMat = this.toon('#FFD166', { emissive: '#FFD166', emissiveIntensity: 0.6 })
    const beamGeo = this.track(new THREE.CylinderGeometry(0.16, 1.5, 1, 18, 1, true))
    beamGeo.translate(0, -0.5, 0)
    const spots: Array<[number, number, string]> = [
      [minX - 2.2, zWall + 1.3, '#FFD166'],
      [minX + lenX * 0.62, zWall + 1.0, '#FF8FA3'],
      [xWall - 1.2, zWall + 1.3, '#4CC9F0'],
      [xWall - 1.0, minZ + lenZ * 0.65, '#FFD166'],
      [xWall - 1.3, maxZ + 3.4, '#8B5CF6'],
    ]
    const lamps = new THREE.InstancedMesh(headGeo2, lampMat, spots.length)
    spots.forEach(([x, z, col], i) => {
      const tower = new THREE.Mesh(towerGeo, towerMat)
      tower.position.set(x, 4.3, z)
      studio.add(tower)
      this.tmpM.makeTranslation(x, 8.9, z)
      lamps.setMatrixAt(i, this.tmpM)
      const mat = this.track(new THREE.MeshBasicMaterial({ map: this.beamTex, color: col, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, opacity: 0.3 }))
      this.beamMats.push(mat)
      const mesh = new THREE.Mesh(beamGeo, mat)
      mesh.renderOrder = 3
      // Téléphone, grande taille : pas de faisceaux (budget des appels de dessin).
      mesh.visible = !(this.big && !this.opts.big)
      this.scene.add(mesh)
      this.beams.push({ mesh, src: new THREE.Vector3(x, 8.7, z), aim: new THREE.Vector3(0, 0, 0), ph: i * 1.7 })
    })
    const frozen = freeze(this.ctx(), studio)
    frozen.traverse((o) => (o.castShadow = true))
    this.scene.add(frozen, lamps)

    // Pastille de lumière sous le pion en vedette (poursuite).
    const spotGeo = this.track(new THREE.PlaneGeometry(3.2, 3.2))
    spotGeo.rotateX(-Math.PI / 2)
    this.spot = new THREE.Mesh(spotGeo, this.track(new THREE.MeshBasicMaterial({ map: this.glowTex, color: '#fff2c4', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 })))
    this.spot.position.y = TOP_Y + 0.03
    this.spot.renderOrder = 2
    this.scene.add(this.spot)
  }

  private buildActors() {
    this.baseGeo = this.track(new THREE.CylinderGeometry(0.38, 0.42, 0.14, 24))
    this.baseInkGeo = this.track(new THREE.CylinderGeometry(0.46, 0.5, 0.1, 24))
    this.ringGeo = this.track(new THREE.TorusGeometry(0.6, 0.06, 8, 28))
    this.ringGeo.rotateX(Math.PI / 2)
    this.ringMat = this.track(new THREE.MeshBasicMaterial({ color: '#FFD23F' }))

    // Étoile extrudée (5 branches), dorée, contour encre.
    const shape = new THREE.Shape()
    for (let k = 0; k < 10; k++) {
      const r = k % 2 === 0 ? 0.5 : 0.235
      const a = (k * Math.PI) / 5 + Math.PI / 2
      if (k === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r)
      else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r)
    }
    shape.closePath()
    this.starGeo = this.track(new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 2 }))
    this.starGeo.center()
    this.starMat = this.toon(GOLD, { emissive: '#c77700', emissiveIntensity: 0.45 })
    this.starBeamGeo = this.track(new THREE.CylinderGeometry(0.5, 0.42, 5.5, 16, 1, true))

    // Dés (jusqu'à 3) : faces +x, −x, +y, −y, +z, −z = 2, 5, 3, 4, 1, 6.
    const faces = [2, 5, 3, 4, 1, 6].map((v) => this.track(new THREE.MeshToonMaterial({ map: this.track(makeDieFace(v)), gradientMap: this.ramp })))
    const dieGeo = this.track(new RoundedBoxGeometry(0.62, 0.62, 0.62, 3, 0.09))
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(dieGeo, faces)
      m.visible = false
      m.renderOrder = 6
      this.dice.push(m)
      this.scene.add(m)
    }

    // Réserves de particules.
    const coinGeo = this.track(new THREE.CylinderGeometry(0.15, 0.15, 0.05, 14))
    coinGeo.rotateX(Math.PI / 2)
    const coinMat = this.toon(GOLD, { emissive: '#c77700', emissiveIntensity: 0.5 })
    const coinInk = this.track(new THREE.CylinderGeometry(0.19, 0.19, 0.035, 14))
    coinInk.rotateX(Math.PI / 2)
    for (let i = 0; i < 32; i++) {
      const g = new THREE.Group()
      g.add(new THREE.Mesh(coinGeo, coinMat), new THREE.Mesh(coinInk, this.inkFront))
      g.visible = false
      this.pool.coin.push(g)
      this.scene.add(g)
    }
    const confGeo = this.track(new THREE.PlaneGeometry(0.16, 0.24))
    const confMats = CONFETTI.map((c) => this.track(new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide })))
    for (let i = 0; i < 90; i++) {
      const m = new THREE.Mesh(confGeo, confMats[i % confMats.length])
      m.visible = false
      this.pool.confetti.push(m)
      this.scene.add(m)
    }
    for (let i = 0; i < 26; i++) {
      const s = this.sprite(this.glowTex, { color: '#fff6e5', opacity: 0.9 })
      s.visible = false
      this.pool.dust.push(s)
      this.scene.add(s)
    }
  }

  private applyTheme() {
    const p = this.pal
    this.scene.background = new THREE.Color(p.bg)
    this.setFog()
    this.hemi.color.set(p.sky)
    this.hemi.groundColor.set(p.ground)
    this.hemi.intensity = p.hemi
    this.sun.intensity = p.sun
    const oldFloor = this.floorMat.map
    this.floorMat.map = makeFloor(p.floorA, p.floorB)
    this.floorMat.needsUpdate = true
    oldFloor?.dispose()
    const oldCarpet = this.carpetMat.map
    this.carpetMat.map = makeCarpet(p.carpet, p.carpetDot)
    this.carpetMat.needsUpdate = true
    oldCarpet?.dispose()
    this.curtainMat.color.set(p.curtain)
    for (const m of this.beamMats) m.opacity = p.beam
    // Ruban : couleurs de base (les voies des aiguillages sont recolorées à la prochaine image).
    this.links.forEach((_, k) => this.roadIn.setColorAt(k, this.tmpC.set(this.roadColor(k))))
    if (this.roadIn.instanceColor) this.roadIn.instanceColor.needsUpdate = true
    for (const s of this.signs) s.way = -1
    this.rt.applyTheme?.(this.dark)
  }

  private setFog() {
    this.scene.fog = new THREE.Fog(this.pal.bg, this.overviewDist * 1.25, this.overviewDist * 2.9)
  }

  /* ------------------------------ joueurs ------------------------------ */

  private loadTexture(urls: string[], done: (t: THREE.Texture) => void) {
    const cached = this.pawnTex.get(urls[0])
    if (cached) return done(cached)
    const loader = new THREE.TextureLoader()
    const attempt = (k: number) => {
      if (k >= urls.length || this.disposed) return
      loader.load(
        urls[k],
        (t) => {
          if (this.disposed) return t.dispose()
          t.colorSpace = THREE.SRGBColorSpace
          t.anisotropy = this.maxAniso
          this.pawnTex.set(urls[0], t)
          done(t)
        },
        undefined,
        () => attempt(k + 1),
      )
    }
    attempt(0)
  }

  setPlayers(list: ScenePlayer[]) {
    const key = (p: ScenePlayer) => `${p.id}|${p.url}|${p.color}`
    if (list.map(key).join() === this.players.map(key).join()) return
    this.players = list
    const keep = new Set(list.map((p) => p.id))
    for (const [id, pw] of this.pawns) {
      if (keep.has(id)) continue
      this.scene.remove(pw.group)
      pw.sprite.material.dispose()
      ;(pw.base.material as THREE.Material).dispose()
      this.pawns.delete(id)
    }
    for (const p of list) {
      let pw = this.pawns.get(p.id)
      if (!pw) {
        const group = new THREE.Group()
        const base = new THREE.Mesh(this.baseGeo, new THREE.MeshToonMaterial({ color: p.color, gradientMap: this.ramp }))
        base.position.y = 0.09
        const ink = new THREE.Mesh(this.baseInkGeo, this.inkFront)
        ink.position.y = 0.05
        const ring = new THREE.Mesh(this.ringGeo, this.ringMat)
        ring.position.y = 0.05
        ring.visible = false
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, alphaTest: 0.08 }))
        sprite.center.set(0.5, 0.05)
        sprite.position.y = 0.12
        sprite.visible = false
        // Socles dessinés par deux maillages instanciés communs (pawnInst) : ceux-ci ne portent que la transformation.
        base.visible = false
        ink.visible = false
        group.add(ink, base, ring, sprite)
        this.scene.add(group)
        pw = { id: p.id, group, sprite, base, ring, cur: new THREE.Vector3(), scale: 1, arc: null, landAt: -1e9, placed: false }
        this.pawns.set(p.id, pw)
      }
      ;(pw.base.material as THREE.MeshToonMaterial).color.set(p.color)
      const target = pw
      this.loadTexture([p.url, p.fallback], (t) => {
        target.sprite.material.map = t
        target.sprite.material.needsUpdate = true
        target.sprite.visible = true
      })
    }
  }

  /** Vue perso (téléphone, grandes tailles, phase de lancer) : la caméra cadre ce pion ; null = vue d'ensemble. */
  setFocus(id: string | null) {
    this.focusId = id
  }

  /** Bouton « 🗺️ » : force la vue d'ensemble (true) ou rend la main à la caméra automatique (false). */
  setOverview(force: boolean) {
    this.forceOverview = force
  }

  /** Ce que filme la caméra, en coordonnées de grille du plateau (cadre blanc de la mini-carte), ou null. */
  viewFrame(): { c0: number; r0: number; c1: number; r1: number } | null {
    return this.frameRect
  }

  /** Phase du jeu : choisit le cadrage quand aucun pion n'est en vedette. */
  setPhase(phase: string) {
    if (phase === this.phase) return
    this.phase = phase
    // Générique d'une grande taille : survol des quartiers ouverts (plaques au passage).
    this.introT0 = phase === 'intro' ? this.time : -1
    this.introShown = -1
  }

  /* ------------------------------ boucle ------------------------------ */

  private resize() {
    const w = Math.max(1, this.host.clientWidth)
    const h = Math.max(1, this.host.clientHeight)
    if (w === this.width && h === this.height) return
    this.width = w
    this.height = h
    const wasPortrait = this.portrait
    this.portrait = h > w * 1.02
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.overviewDist = this.fitDistance()
    this.camSnap = true
    // Les emojis des cases se lisent depuis la caméra (portrait : un quart de tour).
    if (wasPortrait !== this.portrait || !this.tilesOriented) {
      this.tilesOriented = true
      for (let i = 0; i < this.tiles.length; i++) this.setTile(i)
      for (const m of this.tileBodies.values()) m.instanceMatrix.needsUpdate = true
      for (const m of this.tileTops.values()) m.instanceMatrix.needsUpdate = true
    }
    this.setFog()
  }

  private baseAz() {
    return this.portrait ? -Math.PI / 2 : 0
  }

  private overviewEl() {
    // La montagne : caméra plus basse, la pente et les étages se lisent en perspective.
    if (this.mountain) return this.portrait ? 0.78 : 0.5
    return this.portrait ? 1.0 : 0.93
  }

  private place(cam: THREE.PerspectiveCamera, target: THREE.Vector3, az: number, el: number, dist: number) {
    cam.position.set(target.x + Math.sin(az) * Math.cos(el) * dist, target.y + Math.sin(el) * dist, target.z + Math.cos(az) * Math.cos(el) * dist)
    cam.lookAt(target)
  }

  /** Distance à laquelle un rectangle du sol (monde) tient dans le cadre, vu depuis `target`. */
  private fitRect(x0: number, x1: number, z0: number, z1: number, top: number, target: THREE.Vector3, az: number, el: number, hiMax = 200): number {
    const pts: THREE.Vector3[] = []
    for (const x of [x0, x1]) for (const z of [z0, z1]) for (const y of [0, top]) pts.push(new THREE.Vector3(x, y, z))
    return this.fitPts(pts, target, az, el, hiMax)
  }

  /** Distance à laquelle des points (monde) tiennent dans le cadre, vus depuis `target`. */
  private fitPts(pts: THREE.Vector3[], target: THREE.Vector3, az: number, el: number, hiMax = 200): number {
    const cam = this.fitCam
    cam.aspect = this.camera.aspect
    cam.updateProjectionMatrix()
    const fits = (d: number) => {
      this.place(cam, target, az, el, d)
      cam.updateMatrixWorld()
      return pts.every((p) => {
        const v = this.tmp.copy(p).project(cam)
        // z hors de [-1, 1] : point derrière la caméra (projection miroir, à rejeter).
        return Math.abs(v.z) < 1 && Math.abs(v.x) <= 0.96 && v.y >= -0.95 && v.y <= (this.portrait ? 0.72 : 0.8)
      })
    }
    let lo = 4
    let hi = hiMax
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2
      if (fits(mid)) hi = mid
      else lo = mid
    }
    return hi
  }

  /** Distance de la vue d'ensemble : toutes les cases ouvertes tiennent dans le cadre (marge en haut pour le décor). */
  private fitDistance(): number {
    const { minX, maxX, minZ, maxZ } = this.ext
    if (this.mountain) {
      // Toutes les cases à leur altitude (+ la tête des pions).
      const pts: THREE.Vector3[] = []
      for (let i = 0; i < this.board.cells.length; i++) {
        const p = this.cellPos(i)
        pts.push(p.clone().add(this.tmp.set(0, 0, 0.9)), p.clone().setY(p.y + 1.9))
      }
      // L : le Pic et son drapeau ; M : la montagne jusqu'à mi-hauteur (le haut, fermé, file dans les nuages).
      if (this.board.size === 'l') pts.push(this.grid(PIC.c, PIC.r, skiTerrain(PIC.c, PIC.r) + PIC.h + 1.4))
      else pts.push(this.grid(5, -9, skiTerrain(5, -9) + 1))
      // La cible est recentrée sur ce que l'on cadre (la Station devant, le Pic en haut) : pas de sol vide.
      const T = this.grid(0, 0).set(this.center.x, Math.max(...this.board.alt!) * 0.45, this.center.z - S)
      const cam = this.fitCam
      const up = new THREE.Vector3()
      const right = new THREE.Vector3()
      let d: number
      for (let it = 0; it < 4; it++) {
        d = this.fitPts(pts, T, this.baseAz(), this.overviewEl())
        this.place(cam, T, this.baseAz(), this.overviewEl(), d)
        cam.updateMatrixWorld()
        let y0 = 1
        let y1 = -1
        let x0 = 1
        let x1 = -1
        for (const p of pts) {
          const v = this.tmp.copy(p).project(cam)
          y0 = Math.min(y0, v.y)
          y1 = Math.max(y1, v.y)
          x0 = Math.min(x0, v.x)
          x1 = Math.max(x1, v.x)
        }
        const hh = Math.tan((FOV * Math.PI) / 360) * d
        up.set(0, 1, 0).applyQuaternion(cam.quaternion)
        right.set(1, 0, 0).applyQuaternion(cam.quaternion)
        T.addScaledVector(up, ((y0 + y1) / 2 - (this.portrait ? -0.115 : -0.075)) * hh).addScaledVector(right, ((x0 + x1) / 2) * hh * cam.aspect)
      }
      this.ovT = T
      return this.fitPts(pts, T, this.baseAz(), this.overviewEl())
    }
    const top = 1.7 + Math.max(0, ...(this.board.alt ?? [0]))
    return this.fitRect(minX - 1.25, maxX + 1.25, minZ - 1.25, maxZ + 1.25, top, this.overviewTarget(), this.baseAz(), this.overviewEl())
  }

  /** Cible de la vue d'ensemble : le centre de l'emprise (et de la montagne). */
  private overviewTarget(out = new THREE.Vector3()) {
    const alt = this.board.alt
    if (this.mountain && this.ovT) return out.copy(this.ovT)
    return out.set(this.center.x, 0.3 + (alt ? Math.max(...alt) * 0.35 : 0), this.center.z)
  }

  private frame = (now: number) => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.frame)
    if (document.hidden) {
      this.lastT = now
      return
    }
    const raw = now - this.lastT
    const dt = Math.min(0.05, raw / 1000)
    this.lastT = now
    this.time += dt
    this.adaptQuality(raw)
    const view = this.opts.getView()
    this.updateBoard(view, dt)
    this.updateStars(view)
    this.updatePawns(view, dt, now)
    this.updateEvents(view, now)
    this.updateDice(view, dt)
    this.updateFx(dt)
    this.updateDecor(view, dt)
    this.updateVeils(dt)
    this.rt.update?.(view, dt)
    this.updateCamera(view, dt)
    this.updateShadow(view)
    this.updateDetails()
    this.updateFrameRect()
    this.primed = true
    this.renderer.render(this.scene, this.camera)
  }

  /**
   * Budget du téléphone : si la moyenne dépasse 33 ms par image pendant 2 s, résolution 1,25, puis 1,0, puis
   * ombres coupées (jamais de remontée en cours de partie). La télé n'est pas concernée.
   */
  private adaptQuality(raw: number) {
    if (raw > 0 && raw < 500) this.frameAvg = this.frameAvg * 0.95 + raw * 0.05
    if (this.opts.big || this.time < 3) return
    if (this.frameAvg > 33) {
      this.slowFor += Math.min(0.05, raw / 1000)
      if (this.slowFor > 2) {
        this.slowFor = 0
        this.quality++
        if (this.quality === 1) this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25))
        else if (this.quality === 2) this.renderer.setPixelRatio(1)
        else if (this.quality === 3) {
          this.renderer.shadowMap.enabled = false
          this.scene.traverse((o) => {
            const m = (o as THREE.Mesh).material as THREE.Material | undefined
            if (m) m.needsUpdate = true
          })
        }
        this.width = 0
        this.resize()
      }
    } else this.slowFor = 0
  }

  /* ------------------------------ plateau ------------------------------ */

  private updateBoard(view: BoardView, dt: number) {
    // Case qui s'enfonce quand un pion s'y pose : seule la matrice de son instance bouge.
    if (this.bumped.size) {
      const dirty = new Set<CellType>()
      for (const i of this.bumped) {
        const t = this.tiles[i]
        t.bump = Math.max(0, t.bump - dt * 5)
        this.setTile(i, 0.09 * Math.sin(t.bump * Math.PI))
        dirty.add(t.type)
        if (t.bump <= 0.001) this.bumped.delete(i)
      }
      for (const ty of dirty) {
        this.tileBodies.get(ty)!.instanceMatrix.needsUpdate = true
        this.tileTops.get(ty)!.instanceMatrix.needsUpdate = true
      }
    }
    // Aiguillages : flèche (ressort) + voie ouverte allumée + habillage de la porte (bac, cabine, barrière…).
    let colors = false
    this.signs.forEach((sg, k) => {
      const f = this.board.forks[k]
      const way = view.snap.sw?.[k] === 1 ? 1 : 0
      const o = this.cellPos(f.cell, this.tmp)
      const d = this.cellPos(f.ways[way], this.tmp2).sub(o)
      const goal = -Math.atan2(d.z, d.x)
      if (sg.way !== way) {
        if (sg.way === -1) sg.ang = goal
        else if (this.primed) sg.wiggle = 1
        sg.way = way
        this.forkLinks[k].forEach((link, w) => {
          if (link >= 0) this.roadIn.setColorAt(link, this.tmpC.set(w === way ? '#FFD23F' : '#8f88a8'))
        })
        colors = true
      }
      // Ressort amorti vers l'angle voulu (chemin le plus court).
      let diff = goal - sg.ang
      diff = Math.atan2(Math.sin(diff), Math.cos(diff))
      sg.vel += (diff * 90 - sg.vel * 9) * dt
      sg.ang += sg.vel * dt
      sg.wiggle = Math.max(0, sg.wiggle - dt * 1.6)
      const s = 1 + 0.35 * Math.sin(sg.wiggle * Math.PI) + 0.04 * Math.sin(this.time * 4 + k)
      if (this.arrows) {
        const [tide, slot] = this.arrows.slot[k]
        this.tmpQ.setFromAxisAngle(this.tmp.set(0, 1, 0), sg.ang)
        const p = this.tmp2.copy(sg.at).setY(sg.at.y + 1.5 + 0.06 * Math.sin(this.time * 2.4 + k * 2))
        this.tmpM.compose(p, this.tmpQ, this.tmp.set(s, s, s))
        ;(tide ? this.arrows.tide : this.arrows.body).setMatrixAt(slot, this.tmpM)
        this.tmpM.compose(p, this.tmpQ, this.tmp.set(s * 1.14, s * 1.14, s * 1.14))
        ;(tide ? this.arrows.tideInk : this.arrows.ink).setMatrixAt(slot, this.tmpM)
      }
      if (sg.gate) this.updateGate(sg.gate, way, dt, k)
    })
    if (colors && this.roadIn.instanceColor) this.roadIn.instanceColor.needsUpdate = true
    if (this.arrows) for (const m of [this.arrows.body, this.arrows.ink, this.arrows.tide, this.arrows.tideInk]) m.instanceMatrix.needsUpdate = true
  }

  /** La porte suit son aiguillage : voie 1 = le véhicule est là / la barrière levée ; voie 0 = parti / baissée. */
  private updateGate(g: GateRig, way: number, dt: number, k: number) {
    const goal = way === 1 ? 1 : 0
    g.k = g.k < 0 ? goal : g.k + (goal - g.k) * (1 - Math.exp(-dt * 2.2))
    const t = this.time
    if (g.look === 'boat' || g.look === 'cabin') {
      // Le bac traverse (voie 1 : à quai, à l'embarcadère) ; la cabine monte et redescend le long du câble.
      if (g.look === 'boat') {
        g.part.position.copy(g.a.clone().lerp(g.b, g.k))
        g.part.position.y = 0.08 + Math.sin(t * 1.7 + k) * 0.04
        g.part.rotation.z = Math.sin(t * 1.3 + k) * 0.05
      } else {
        g.part.position.copy(g.b.clone().lerp(g.a, g.k))
        g.part.rotation.z = Math.sin(t * 2 + k) * 0.06
      }
    } else if (g.look === 'gate') g.part.rotation.z = g.k * 1.25
    else if (g.look === 'turnstile') {
      if (goal === 1) g.part.rotation.y += dt * 1.6
      g.lamp?.color.set(goal === 1 ? '#06D6A0' : '#EF476F')
      g.lamp?.emissive.set(goal === 1 ? '#06D6A0' : '#EF476F')
    } else if (g.look === 'piste') {
      g.lamp?.color.set(goal === 1 ? '#06D6A0' : '#EF476F')
      g.lamp?.emissive.set(goal === 1 ? '#06D6A0' : '#EF476F')
    }
  }

  /* ------------------------------ grandes tailles ------------------------------ */

  /** Demi-côté de la carte d'ombre en grande taille : téléphone ± 14, télé ± 24 en L, toute l'emprise en M. */
  private shadowR() {
    if (!this.opts.big) return 14
    if (this.board.size === 'l') return 24
    return Math.max(this.ext.maxX - this.ext.minX, this.ext.maxZ - this.ext.minZ) / 2 + 8
  }

  /** Grande taille : la carte d'ombre suit la cible de la caméra (recadrée quand elle bouge de plus de 2 unités). */
  private updateShadow(view: BoardView) {
    if (!this.big) return
    const moving = Boolean(view.mover?.walking)
    const at = this.opts.big && this.board.size === 'm' ? this.center : this.camT
    if (this.shadowAt.distanceTo(at) > 2 || (moving && this.time - this.shadowT > 0.25)) {
      this.shadowAt.copy(at)
      this.shadowT = this.time
      const y0 = this.mountain ? at.y : 0
      this.sun.target.position.set(at.x, y0, at.z)
      this.sun.position.set(at.x - 7, y0 + 15, at.z + 9)
      this.sun.target.updateMatrixWorld()
      this.sun.updateMatrixWorld()
      this.renderer.shadowMap.needsUpdate = true
    }
  }

  /**
   * Décor « détail » des quartiers (téléphone, grande taille) : masqué au-delà de 22 unités de la cible de la
   * caméra et en vue d'ensemble ; toujours visible à la télé.
   */
  private updateDetails() {
    if (!this.details.length || this.opts.big || !this.big) return
    if (++this.detailTick % 8 !== 0) return
    const wide = this.mode === 'overview'
    for (const d of this.details) d.obj.visible = !wide && d.at.distanceTo(this.camT) < 22
  }

  /** Ce que filme la caméra, en coordonnées de grille (pour le cadre de la mini-carte). */
  private updateFrameRect() {
    if (!this.big || ++this.frameTick % 6 !== 0) return
    const ray = new THREE.Raycaster()
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), this.mountain ? -this.camT.y : 0)
    const hit = new THREE.Vector3()
    let c0 = Infinity
    let c1 = -Infinity
    let r0 = Infinity
    let r1 = -Infinity
    for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      ray.setFromCamera(new THREE.Vector2(x, y), this.camera)
      if (!ray.ray.intersectPlane(plane, hit)) {
        // Coin au-dessus de l'horizon : on borne à la distance de la caméra.
        hit.copy(ray.ray.direction).setY(0).normalize().multiplyScalar(this.camDist * 2).add(this.camera.position)
      }
      const c = (hit.x + this.halfX) / S
      const r = (hit.z + this.halfZ) / S
      c0 = Math.min(c0, c)
      c1 = Math.max(c1, c)
      r0 = Math.min(r0, r)
      r1 = Math.max(r1, r)
    }
    this.frameRect = { c0, r0, c1, r1 }
  }

  /**
   * Quartiers fermés : une silhouette (socle pâle, sans cases ni ruban), un voile selon le thème (rideau, brume
   * de mer, palissade, brume de forêt, nuages) et une plaque « 🔒 … · à 5 joueurs » / « à 7 joueurs ».
   */
  private buildVeils() {
    for (const q of this.board.closed) {
      const g = new THREE.Group()
      const a = this.grid(q.box.c0 - 0.6, q.box.r0 - 0.6)
      const b = this.grid(q.box.c1 + 0.6, q.box.r1 + 0.6)
      const w = b.x - a.x
      const d = b.z - a.z
      const cx = (a.x + b.x) / 2
      const cz = (a.z + b.z) / 2
      const mats: THREE.Material[] = []
      const ghost = (color: string, opacity: number) => {
        const m = this.track(new THREE.MeshToonMaterial({ color, gradientMap: this.ramp, transparent: true, opacity, depthWrite: false }))
        mats.push(m)
        return m
      }
      // Silhouette : le socle du quartier, à 35 % d'opacité.
      const base = new THREE.Mesh(this.track(new THREE.BoxGeometry(w, 0.14, d)), ghost(this.pal.carpet, 0.35))
      base.position.set(cx, -0.1, cz)
      g.add(base)
      const clouds: THREE.Sprite[] = []
      const fog = (color: string, n: number, h: number) => {
        for (let k = 0; k < n; k++) {
          const s = this.sprite(this.glowTex, { color, opacity: 0.85, depthWrite: false })
          s.scale.set(Math.max(w, d) * 0.75, Math.max(w, d) * 0.4, 1)
          s.position.set(cx + (rand(k + q.cells[0]) - 0.5) * w * 0.6, h + k * 0.5, cz + (rand(k + 7 + q.cells[0]) - 0.5) * d * 0.6)
          s.userData.base = s.position.clone()
          clouds.push(s)
          g.add(s)
        }
      }
      // Côté tourné vers le plateau de base : là où l'on pose rideau / palissade.
      const toBase = new THREE.Vector3(-cx, 0, -cz)
      const alongX = Math.abs(toBase.x) < Math.abs(toBase.z)
      const edge = alongX ? new THREE.Vector3(cx, 0, cz + Math.sign(toBase.z) * d * 0.5) : new THREE.Vector3(cx + Math.sign(toBase.x) * w * 0.5, 0, cz)
      const span = alongX ? w : d
      // La palissade est posée un peu en retrait, côté quartier (elle ne cache pas la rangée de cases voisine).
      edge.add(new THREE.Vector3(cx, 0, cz).sub(edge).setY(0).normalize().multiplyScalar(0.6))
      // Montagne : le voile se pose sur la neige, à l'altitude du secteur.
      if (this.board.id === 'ski') {
        g.position.y = skiTerrain((q.box.c0 + q.box.c1) / 2, (q.box.r0 + q.box.r1) / 2)
        if (this.big) base.visible = false
      }
      if (q.veil === 'curtain') {
        const geo = this.track(new THREE.PlaneGeometry(span, 3.2, Math.round(span * 4), 1))
        const p = geo.getAttribute('position')
        for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 3.4) * 0.2)
        geo.computeVertexNormals()
        const curtain = new THREE.Mesh(geo, this.track(new THREE.MeshToonMaterial({ color: '#c1121f', gradientMap: this.ramp, side: THREE.DoubleSide })))
        curtain.position.copy(edge).setY(1.6)
        curtain.rotation.y = alongX ? 0 : Math.PI / 2
        const glow = this.sprite(this.glowTex, { color: '#FFD166', opacity: 0.5, blending: THREE.AdditiveBlending })
        glow.position.copy(edge).setY(0.15)
        glow.scale.set(span * 0.8, 0.6, 1)
        g.add(curtain, glow)
        fog('#2b2545', 2, 1.4)
      } else if (q.veil === 'fence') {
        // Palissade de chantier rayée orange et blanc.
        const n = Math.max(4, Math.round(span / 0.5))
        const boards = new THREE.InstancedMesh(this.track(new THREE.BoxGeometry(0.42, 0.85, 0.08)), this.toon('#ffffff'), n)
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n - 0.5
          this.tmp.copy(edge).add(alongX ? this.tmp2.set(t * span, 0.42, 0) : this.tmp2.set(0, 0.42, t * span))
          this.tmpQ.setFromAxisAngle(this.tmp2.set(0, 1, 0), alongX ? 0 : Math.PI / 2)
          this.tmpM.compose(this.tmp, this.tmpQ, this.tmp2.set(1, 1, 1))
          boards.setMatrixAt(k, this.tmpM)
          boards.setColorAt(k, this.tmpC.set(k % 2 ? '#ffffff' : '#FF8C42'))
        }
        g.add(boards)
        // Les attractions sous des bâches gris-bleu.
        const tarp = new THREE.Mesh(this.track(new THREE.ConeGeometry(Math.min(w, d) * 0.35, 2.4, 4)), ghost('#7d8fa8', 0.85))
        tarp.position.set(cx, 1.2, cz)
        tarp.rotation.y = Math.PI / 4
        g.add(tarp)
      } else if (q.veil === 'forest') {
        fog('#3b4a3a', 3, 0.9)
        // Deux yeux de chouette qui clignent dans le noir.
        const eyes = new THREE.Group()
        for (const s of [-0.16, 0.16]) {
          const e = this.sprite(this.glowTex, { color: '#ffe066', blending: THREE.AdditiveBlending })
          e.scale.setScalar(0.32)
          e.position.x = s
          eyes.add(e)
        }
        eyes.position.set(cx, 1.6, cz)
        eyes.userData.owl = true
        g.add(eyes)
      } else if (q.veil === 'clouds') {
        fog('#ffffff', 4, 2.2)
      } else {
        fog('#eaf6ff', 3, 0.8)
      }
      // La plaque « 🔒 … · à N joueurs ».
      const pl = makePlate(`🔒 ${q.emoji} ${q.name} · à ${q.opens === 'm' ? 5 : 7} joueurs`, '#ffffff')
      const plate = this.sprite(this.track(pl.tex), { depthTest: false })
      plate.scale.set(0.62 * pl.aspect, 0.62, 1)
      plate.position.set(cx, 2.6, cz)
      plate.renderOrder = 5
      g.add(plate)
      this.scene.add(g)
      this.veils.push({ q, group: g, clouds, mats })
    }
  }

  /** Voiles des quartiers fermés : la brume dérive, la chouette cligne. */
  private updateVeils(dt: number) {
    if (!this.veils.length) return
    void dt
    for (const v of this.veils) {
      v.clouds.forEach((c, k) => {
        const b = c.userData.base as THREE.Vector3
        c.position.set(b.x + Math.sin(this.time * 0.15 + k * 2) * 1.2, b.y + Math.sin(this.time * 0.4 + k) * 0.15, b.z + Math.cos(this.time * 0.12 + k) * 0.8)
        ;(c.material as THREE.SpriteMaterial).opacity = 0.55 + 0.25 * Math.sin(this.time * 0.3 + k)
      })
      for (const o of v.group.children) if (o.userData.owl) o.visible = Math.sin(this.time * 1.3) > -0.85
    }
  }

  /** Les 12 prochaines cases de mon trajet probable (aiguillages dans leur état actuel ; marée : voie ouverte). */
  private routeAhead(from: number, sw: number[], n = 12): number[] {
    const out: number[] = []
    const ways = [...sw]
    let c = from
    for (let k = 0; k < n; k++) {
      const nx = this.board.next[c]
      if (Array.isArray(nx)) {
        const fi = this.board.forks.findIndex((f) => f.cell === c)
        const w = ways[fi] === 1 ? 1 : 0
        if (fi >= 0 && this.board.forks[fi].mode === 'toggle') ways[fi] = 1 - w
        c = nx[w]
      } else c = nx
      out.push(c)
    }
    return out
  }

  /** Véhicule d'un transport (créé à la demande) : bac, cabine, luge / planche de glisse. */
  private rideOf(kind: Leap): THREE.Group | null {
    if (kind === 'lift' || kind === 'ice') return null
    let g = this.rides.get(kind)
    if (g) return g
    g = new THREE.Group()
    const ink = (geo: THREE.BufferGeometry, color: string, grow = 1.08) => this.inked(this.track(geo), this.toon(color), grow)
    if (kind === 'boat') {
      const hull = ink(new THREE.BoxGeometry(1.3, 0.3, 0.7), '#EF476F')
      hull.position.y = -0.05
      const rail = ink(new THREE.BoxGeometry(1.3, 0.08, 0.72), '#fff6e5')
      rail.position.y = 0.14
      const chim = ink(new THREE.CylinderGeometry(0.09, 0.09, 0.45, 10), '#ffffff', 1.2)
      chim.position.set(-0.45, 0.4, 0)
      g.add(hull, rail, chim)
    } else if (kind === 'cabin') {
      const box = ink(new RoundedBoxGeometry(0.95, 0.85, 0.8, 2, 0.14), '#EF476F')
      box.position.y = 0.42
      const hook = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 6)), this.inkFront)
      hook.position.y = 1.2
      g.add(box, hook)
      ;(box.children[0] as THREE.Mesh).material = this.toon('#EF476F', { transparent: true, opacity: 0.55 })
    } else {
      const sled = ink(new THREE.BoxGeometry(0.9, 0.08, 0.42), kind === 'slide' ? '#4CC9F0' : '#EF476F')
      sled.position.y = -0.02
      g.add(sled)
    }
    g.visible = false
    this.scene.add(g)
    this.rides.set(kind, g)
    return g
  }

  /* ------------------------------ étoiles ------------------------------ */

  private makeStar(cell: number): Star {
    const group = new THREE.Group()
    // L'étoile elle-même (et son contour) est dessinée par deux maillages instanciés communes à toutes les
    // étoiles (starInst) : `spin` ne porte que sa transformation.
    const spin = new THREE.Group()
    if (!this.starInst) {
      const body = new THREE.InstancedMesh(this.starGeo, this.starMat, 12)
      const hull = new THREE.InstancedMesh(this.starGeo, this.inkBack, 12)
      for (const m of [body, hull]) {
        m.count = 0
        m.frustumCulled = false
        this.scene.add(m)
      }
      this.starInst = { body, hull }
    }
    const glow = this.sprite(this.glowTex, { color: '#ffe066', blending: THREE.AdditiveBlending, opacity: 0.75 })
    glow.scale.setScalar(2.3)
    const beamMat = this.track(new THREE.MeshBasicMaterial({ map: this.beamTex, color: '#ffe066', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, opacity: 0.4 }))
    const beam = new THREE.Mesh(this.starBeamGeo, beamMat)
    beam.rotation.x = Math.PI
    beam.renderOrder = 3
    const sparkles: THREE.Sprite[] = []
    // Téléphone, grande taille : pas d'étincelles (jusqu'à 9 étoiles en jeu, budget des appels de dessin).
    for (let i = 0; i < (this.big && !this.opts.big ? 0 : 3); i++) {
      const s = this.sprite(this.sparkleTex, { color: '#fffbe0', blending: THREE.AdditiveBlending })
      sparkles.push(s)
      group.add(s)
    }
    group.add(glow, spin)
    this.scene.add(group, beam)
    const st: Star = { group, mesh: spin, glow, beam, sparkles, cell, move: null }
    const p = this.cellPos(cell)
    group.position.set(p.x, p.y + 1.55, p.z)
    return st
  }

  private updateStars(view: BoardView) {
    const cells = view.snap.star_cells ?? []
    while (this.stars.length < cells.length) this.stars.push(this.makeStar(cells[this.stars.length]))
    this.stars.forEach((st, i) => {
      const on = i < cells.length
      st.group.visible = on
      st.beam.visible = on
      if (!on) return
      const cell = cells[i]
      if (cell !== st.cell) {
        const mover = view.mover ? this.pawns.get(view.mover.id) : null
        if (this.primed) st.move = { t0: this.time, from: st.group.position.clone(), via: mover ? mover.group.position.clone().setY(1.2) : null }
        st.cell = cell
      }
      const home = this.cellPos(cell, this.tmp)
      const bob = home.y + 1.55 + Math.sin(this.time * 2.2 + i * 2.1) * 0.12
      let scale = 1
      let beamK = 1
      if (st.move) {
        const t = this.time - st.move.t0
        if (t < 0.5) {
          // Attrapée : file vers le pion en rétrécissant.
          const k = easeInOut(t / 0.5)
          if (st.move.via) st.group.position.lerpVectors(st.move.from, st.move.via, k)
          scale = 1 - k * 0.95
          beamK = 1 - k
        } else if (t < 1.5) {
          // Retombe du ciel sur sa nouvelle Loge, avec un petit rebond.
          const k = (t - 0.5) / 1.0
          const fall = k < 0.6 ? 1 - easeInOut(k / 0.6) : 0
          const bounce = k >= 0.6 ? Math.abs(Math.sin(((k - 0.6) / 0.4) * Math.PI)) * 0.35 * (1 - (k - 0.6) / 0.4) : 0
          st.group.position.set(home.x, bob + fall * 9 + bounce, home.z)
          scale = Math.min(1, k * 4)
          beamK = k
        } else st.move = null
      }
      if (!st.move) st.group.position.set(home.x, bob, home.z)
      // Face à la caméra, en se dandinant (un tour complet de temps en temps, toupie quand elle déménage).
      const twirl = Math.max(0, Math.sin(this.time * 0.5 + i * 2)) ** 12 * Math.PI * 2
      st.mesh.rotation.y = this.camAz + Math.sin(this.time * 1.5 + i) * 0.7 + twirl + (st.move ? (this.time - st.move.t0) * 9 : 0)
      st.mesh.rotation.z = Math.sin(this.time * 1.7 + i) * 0.12
      const pulse = 1 + Math.sin(this.time * 4 + i) * 0.06
      st.mesh.scale.setScalar(scale * pulse * 1.15)
      st.glow.scale.setScalar(2.4 * scale * (1 + Math.sin(this.time * 3 + i) * 0.12))
      st.sparkles.forEach((s, k) => {
        const a = this.time * 1.6 + (k * Math.PI * 2) / 3 + i
        s.position.set(Math.cos(a) * 0.75, Math.sin(a * 1.3) * 0.35, Math.sin(a) * 0.75)
        s.scale.setScalar(scale * (0.2 + 0.16 * Math.abs(Math.sin(this.time * 5 + k * 2))))
      })
      st.beam.position.set(st.group.position.x, home.y + TOP_Y + 2.75, st.group.position.z)
      ;(st.beam.material as THREE.MeshBasicMaterial).opacity = (this.dark ? 0.42 : 0.2) * beamK * (0.85 + 0.15 * Math.sin(this.time * 3 + i))
    })
    // Les étoiles visibles, dans les deux maillages instanciés.
    if (this.starInst) {
      let n = 0
      const hullS = new THREE.Matrix4().makeScale(1.13, 1.13, 1.5)
      this.stars.forEach((st) => {
        if (!st.group.visible || n >= 12) return
        st.group.updateMatrixWorld(true)
        this.starInst!.body.setMatrixAt(n, st.mesh.matrixWorld)
        this.tmpM.multiplyMatrices(st.mesh.matrixWorld, hullS)
        this.starInst!.hull.setMatrixAt(n, this.tmpM)
        n++
      })
      for (const m of [this.starInst.body, this.starInst.hull]) {
        m.count = n
        m.instanceMatrix.needsUpdate = true
      }
    }
  }

  /* ------------------------------ pions ------------------------------ */

  private headOf(pw: Pawn, out: THREE.Vector3) {
    return out.copy(pw.group.position).setY(pw.group.position.y + 1.05 * pw.scale)
  }

  private updatePawns(view: BoardView, dt: number, now: number) {
    const m = view.mover
    const flying = m && m.walking ? m.id : null
    // Regroupe les pions posés par case (ordre stable : celui de la liste des joueurs).
    const groups = new Map<number, string[]>()
    for (const p of this.players) {
      if (p.id === flying) continue
      const c = m && m.id === p.id ? m.cell : (view.snap.pos[p.id] ?? 0)
      const g = groups.get(c)
      if (g) g.push(p.id)
      else groups.set(c, [p.id])
    }
    for (const [cell, ids] of groups) {
      const n = ids.length
      const base = this.cellPos(cell, this.tmp)
      const r = n === 1 ? 0 : n === 2 ? 0.27 : n <= 4 ? 0.31 : 0.36
      const scale = n === 1 ? 1 : n === 2 ? 0.82 : n <= 4 ? 0.7 : 0.58
      ids.forEach((id, k) => {
        const pw = this.pawns.get(id)
        if (!pw) return
        const a = (k / n) * Math.PI * 2 + (this.portrait ? 0 : Math.PI / 2) + (n === 2 ? 0 : Math.PI / n)
        const tx = base.x + Math.cos(a) * r
        const tz = base.z + Math.sin(a) * r
        const isStar = m?.id === id
        const goal = this.tmp2.set(tx, base.y + TOP_Y, tz)
        if (!pw.placed) {
          pw.cur.copy(goal)
          pw.placed = true
        }
        if (!pw.arc && pw.cur.distanceTo(goal) > S * 2.2 && this.primed) pw.arc = { from: pw.cur.clone(), to: goal.clone(), t0: this.time }
        let y = 0
        let squash = 0
        if (pw.arc) {
          const t = (this.time - pw.arc.t0) / 0.75
          if (t >= 1) {
            pw.cur.copy(goal)
            pw.arc = null
            pw.landAt = now
            this.puff(pw.cur)
          } else {
            pw.cur.lerpVectors(pw.arc.from, goal, easeInOut(t))
            y = Math.sin(t * Math.PI) * 3.2
            squash = -0.3 * Math.sin(t * Math.PI)
          }
        } else pw.cur.lerp(goal, 1 - Math.exp(-dt * 12))
        const since = (now - pw.landAt) / 1000
        if (since < 0.4) squash += 0.42 * Math.exp(-since * 11) * Math.cos(since * 22)
        const idle = isStar ? 0 : Math.sin(this.time * 2.3 + k * 1.3 + cell) * 0.025
        pw.scale = lerp(pw.scale, scale * (isStar ? 1.15 : 1), 1 - Math.exp(-dt * 10))
        this.poseePawn(pw, pw.cur.x, pw.cur.y + y, pw.cur.z, squash + idle, isStar, 0)
      })
    }
    // Le pion en vedette, en plein saut : position exacte donnée par l'horloge.
    if (m && flying) {
      const pw = this.pawns.get(m.id)
      if (pw) {
        const a = this.cellPos(m.cell, this.tmp)
        let x = a.x
        let z = a.z
        let ground = a.y
        let y = 0
        let squash = 0
        let spin = 0
        let ride: THREE.Group | null = null
        let heading = 0
        if (m.rolling) {
          // Pendant les dés : le pion trépigne.
          squash = Math.sin(this.time * 14) * 0.07
        } else if (m.next !== null) {
          const b = this.cellPos(m.next, this.tmp2)
          const f = m.frac
          const leap = m.leap
          const vehicle = leap === 'boat' || leap === 'cabin' || leap === 'slide' || leap === 'luge'
          if (leap) {
            // Télésiège, verglas, transport : étiquette au décollage, grande cloche ou trajet à bord, traînée.
            const key = `${m.idx}:${m.id}:${m.hops}`
            if (key !== this.leapKey) {
              this.leapKey = key
              if (this.primed) {
                const [txt, bg] = leap === 'luge' && m.cell !== 48 ? (['🚩 Grande Descente !', '#ffffff'] as [string, string]) : LEAP_LABEL[leap]
                this.label(txt, bg, this.headOf(pw, new THREE.Vector3()), 0)
                this.cheerK = Math.max(this.cheerK, leap === 'ice' ? 0.4 : 0.8)
              }
            }
          }
          // 0-18 % : s'accroupit (ou embarque) ; ensuite : bond en cloche, ou le trajet dans le véhicule.
          if (f < 0.18) squash = 0.34 * Math.sin((f / 0.18) * Math.PI * 0.5)
          else {
            const g = (f - 0.18) / 0.82
            const e = vehicle && leap !== 'luge' ? g * g * (3 - 2 * g) : easeInOut(g)
            x = lerp(a.x, b.x, e)
            z = lerp(a.z, b.z, e)
            ground = lerp(a.y, b.y, e)
            y = Math.sin(g * Math.PI) * (leap ? LEAP_H[leap] : 0.85)
            if (leap === 'boat') y = 0.12 + Math.sin(this.time * 6) * 0.05 + Math.sin(g * Math.PI) * 0.25
            squash = vehicle && leap !== 'luge' ? 0 : 0.34 * (1 - Math.min(1, g * 5)) - 0.3 * Math.sin(g * Math.PI)
            if (leap === 'ice') spin = g * Math.PI * 4
            if (vehicle) {
              ride = this.rideOf(leap)
              heading = -Math.atan2(b.z - a.z, b.x - a.x)
            }
            // Montagne : la piste et la Grande Descente dévalent la neige par le Grand Couloir (saut final pour la Descente).
            if (this.mountain && (leap === 'slide' || (leap === 'luge' && m.cell !== 48))) {
              const at = this.pisteAt(m.cell, m.next, e, this.tmp2)
              x = this.tmp2.x
              z = this.tmp2.z
              ground = this.tmp2.y
              heading = at.heading
              y = at.last >= 0 ? Math.sin(at.last * Math.PI) * (leap === 'luge' ? 3.4 : 0.6) : 0.05 + Math.abs(Math.sin(g * 40)) * 0.08
            }
            if (leap && this.time - this.trailT > (leap === 'boat' ? 0.06 : 0.035)) {
              this.trailT = this.time
              this.spawn('dust', this.tmp2.set(x, ground + (leap === 'boat' ? 0.1 : TOP_Y + y + 0.3), z).clone(), new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.2, (Math.random() - 0.5) * 0.6), 0.55, leap === 'luge' ? 0.42 : 0.32, null, LEAP_TRAIL[leap])
            }
          }
        }
        // Le véhicule du transport en cours (les autres restent au garage).
        for (const [, g] of this.rides) if (g !== ride) g.visible = false
        if (ride) {
          ride.visible = true
          ride.position.set(x, ground + TOP_Y + y - 0.02, z)
          ride.rotation.y = heading
          ride.rotation.z = Math.sin(this.time * 3) * 0.04
        }
        const since = (now - pw.landAt) / 1000
        if (since < 0.3 && (m.next === null || m.frac < 0.18)) squash += 0.4 * Math.exp(-since * 12)
        pw.cur.set(x, ground + TOP_Y, z)
        pw.placed = true
        pw.arc = null
        pw.scale = lerp(pw.scale, 1.18, 1 - Math.exp(-dt * 10))
        this.poseePawn(pw, x, ground + TOP_Y + y, z, squash, true, spin)
      }
    } else for (const [, g] of this.rides) g.visible = false
    this.drawPawnBases()
  }

  /** Socles des pions (corps coloré + bord encre) : 2 appels de dessin pour tous les pions. */
  private drawPawnBases() {
    if (!this.pawnInst) {
      const base = new THREE.InstancedMesh(this.baseGeo, this.toon('#ffffff'), 8)
      const ink = new THREE.InstancedMesh(this.baseInkGeo, this.inkFront, 8)
      for (const m of [base, ink]) {
        m.frustumCulled = false
        this.scene.add(m)
      }
      this.pawnInst = { base, ink }
    }
    let n = 0
    for (const p of this.players) {
      const pw = this.pawns.get(p.id)
      if (!pw || n >= 8) continue
      pw.group.updateMatrixWorld(true)
      this.pawnInst.base.setMatrixAt(n, pw.base.matrixWorld)
      this.pawnInst.base.setColorAt(n, this.tmpC.set(p.color))
      this.pawnInst.ink.setMatrixAt(n, (pw.base.parent!.children[0] as THREE.Object3D).matrixWorld)
      n++
    }
    for (const m of [this.pawnInst.base, this.pawnInst.ink]) {
      m.count = n
      m.instanceMatrix.needsUpdate = true
    }
    if (this.pawnInst.base.instanceColor) this.pawnInst.base.instanceColor.needsUpdate = true
  }

  private poseePawn(pw: Pawn, x: number, y: number, z: number, squash: number, star: boolean, spin: number) {
    pw.group.position.set(x, y, z)
    const w = 1.55 * pw.scale
    pw.sprite.scale.set(w * (1 + squash * 0.55), w * (1 - squash * 0.55), 1)
    pw.sprite.material.rotation = spin
    pw.base.scale.set(pw.scale * (1 + squash * 0.3), pw.scale, pw.scale * (1 + squash * 0.3))
    pw.base.parent!.children[0].scale.copy(pw.base.scale)
    pw.ring.visible = star
    if (star) {
      const s = pw.scale * (1 + 0.1 * Math.sin(this.time * 6))
      pw.ring.scale.set(s, 1, s)
    }
  }

  /* ------------------------------ évènements du tour ------------------------------ */

  private updateEvents(view: BoardView, now: number) {
    const m = view.mover
    const key = m ? `${m.idx}:${m.id}` : ''
    if (key !== this.evKey) {
      this.evKey = key
      this.evCount = this.primed ? 0 : view.events.length
    }
    if (key !== this.hopKey) {
      this.hopKey = key
      this.hopCount = this.primed ? 0 : (m?.hops ?? 0)
    }
    // Épilogue (marée, ronde de Riton) : ses propres évènements.
    const epi = view.epi
    const ek = epi ? `${epi.data.t}:${JSON.stringify(epi.data.after.coins)}` : ''
    if (ek !== this.epiKey) {
      this.epiKey = ek
      this.epiCount = this.primed ? 0 : (epi?.events.length ?? 0)
      if (epi && this.primed && epi.data.t === 'tide' && epi.data.tide === 1) this.olaUntil = this.time + 2.5
    }
    if (epi && epi.events.length > this.epiCount) {
      const fresh = epi.events.slice(0, epi.events.length - this.epiCount).reverse()
      this.epiCount = epi.events.length
      fresh.forEach((e, i) => {
        if (this.rt.onEpiEvent?.(e, i)) return
        const pw = e.id ? this.pawns.get(e.id) : undefined
        if (pw) this.playEvent(e, pw, i)
      })
    }
    if (!m) return
    const pw = this.pawns.get(m.id)
    if (!pw) return
    if (m.hops > this.hopCount) {
      this.hopCount = m.hops
      pw.landAt = now
      const at = this.cellPos(m.cell, this.tmp)
      this.puff(at.clone().setY(at.y + TOP_Y))
      const tile = this.tiles[m.cell]
      if (tile) {
        tile.bump = 1
        this.bumped.add(m.cell)
      }
    }
    if (view.events.length > this.evCount) {
      const fresh = view.events.slice(0, view.events.length - this.evCount).reverse()
      this.evCount = view.events.length
      fresh.forEach((e, i) => {
        if (this.rt.onEvent?.(e, m.id, i)) return
        this.playEvent(e, pw, i)
      })
    }
  }

  private playEvent(e: DpEvent, pw: Pawn, order: number) {
    const head = this.headOf(pw, new THREE.Vector3())
    const gain = e.t === 'card' ? (e.gain ?? 0) : (e.d ?? 0)
    if (e.t === 'tp') return // étiquette déjà posée au décollage
    if (e.t === 'star') {
      this.confetti(head, 70)
      this.coins(pw, -Math.min(12, Math.round((e.cost ?? 20) / 3)))
      this.label('⭐ +1', '#FFD23F', head, order)
      this.cheerK = 1
      this.shakeK = 0.5
      return
    }
    if (e.t === 'star_poor') return this.label(`😬 ${e.need} 🪙 ?`, '#ffffff', head, order)
    if (e.t === 'fork') {
      if (e.tide) return this.label(e.way === 1 ? '🏝️ Banc de sable !' : '🌊 Par la Digue', '#9be7ff', head, order)
      // Habillage de la porte : bac, cabine, barrière, tourniquet, portique de piste (défaut : aiguillage).
      const look = this.board.forks[e.fork ?? 0]?.look ?? 'switch'
      const TXT: Record<string, [string, string]> = { switch: ['🔀 Détour !', '🔀 Tout droit'], boat: ['⛴️ Le bac est là !', '⛴️ Bac parti'], cabin: ['🚠 Une cabine !', '🚠 À pied'], gate: ['🚧 Barrière levée !', '🚧 Barrière baissée'], turnstile: ['🎠 Ça tourne !', '🎠 Bloqué'], piste: ['⛷️ Piste rouge !', '🧗 Par l’arête'] }
      return this.label((TXT[look] ?? TXT.switch)[e.way === 1 ? 0 : 1], '#FFD166', head, order)
    }
    if (e.t === 'card') {
      this.label('✉️ Surprise !', '#c9b6ff', head, order)
      this.confetti(head, 14)
      if (gain) this.coins(pw, gain)
      return
    }
    if (gain) {
      this.coins(pw, gain)
      this.label(`${gain > 0 ? '+' : '−'}${Math.abs(gain)} 🪙`, gain > 0 ? '#9cf0c9' : '#ff9db1', head, order)
      if (gain > 0) this.cheerK = Math.max(this.cheerK, e.t === 'clap' ? 0.8 : 0.5)
    } else if (e.t === 'pub') this.label('📺 À sec…', '#ff9db1', head, order)
  }

  private spawn(kind: Particle['kind'], pos: THREE.Vector3, vel: THREE.Vector3, life: number, size: number, target: Pawn | null = null, color?: string, goal: THREE.Vector3 | null = null) {
    const list = kind === 'confetti' ? this.pool.confetti : kind === 'dust' ? this.pool.dust : this.pool.coin
    const mesh = list.find((o) => !o.visible)
    if (!mesh) return
    mesh.visible = true
    mesh.position.copy(pos)
    mesh.scale.setScalar(size)
    if (kind === 'dust') ((mesh as THREE.Sprite).material as THREE.SpriteMaterial).color.set(color ?? '#fff6e5')
    this.particles.push({ mesh, vel, spin: new THREE.Vector3(Math.random() * 10 - 5, Math.random() * 14 - 7, Math.random() * 10 - 5), age: 0, life, kind, target, goal, size })
  }

  private puff(at: THREE.Vector3, color?: string) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.random()
      this.spawn('dust', at.clone().setY(at.y + 0.08), new THREE.Vector3(Math.cos(a) * 1.5, 0.5 + Math.random() * 0.5, Math.sin(a) * 1.5), 0.4, 0.3, null, color)
    }
  }

  private confetti(at: THREE.Vector3, n: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const r = 1.2 + Math.random() * 2.6
      this.spawn('confetti', at.clone(), new THREE.Vector3(Math.cos(a) * r, 4 + Math.random() * 4.5, Math.sin(a) * r), 1.5 + Math.random() * 0.8, 0.8 + Math.random() * 0.7)
    }
  }

  /** n > 0 : les pièces jaillissent de la case et filent vers le pion ; n < 0 : elles s'échappent du pion. */
  private coins(pw: Pawn, n: number) {
    const count = Math.min(12, Math.abs(n) + 1)
    const head = this.headOf(pw, new THREE.Vector3())
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.5
      const r = 1.3 + Math.random() * 1.1
      if (n > 0) this.spawn('coin_in', pw.group.position.clone().setY(TOP_Y + 0.2), new THREE.Vector3(Math.cos(a) * r, 5 + Math.random() * 2, Math.sin(a) * r), 0.95 + i * 0.03, 1, pw)
      else this.spawn('coin_out', head.clone(), new THREE.Vector3(Math.cos(a) * r * 1.3, 3.2 + Math.random() * 2, Math.sin(a) * r * 1.3), 1.0, 1)
    }
  }

  /** Pièces qui jaillissent de `from` et filent vers un point (stand, sac) ou la tête d'un pion (id). */
  private coinsFly(from: THREE.Vector3, to: THREE.Vector3 | string, n: number) {
    const pw = typeof to === 'string' ? (this.pawns.get(to) ?? null) : null
    const goal = typeof to === 'string' ? null : to.clone()
    if (!pw && !goal) return
    const count = Math.min(20, Math.max(1, n))
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.5
      const r = 0.8 + Math.random() * 0.9
      this.spawn('coin_in', from.clone(), new THREE.Vector3(Math.cos(a) * r, 4.2 + Math.random() * 2, Math.sin(a) * r), 1.1 + i * 0.03, 1, pw, undefined, goal)
    }
  }

  private label(text: string, bg: string, at: THREE.Vector3, order: number) {
    const { tex, aspect } = makeLabel(text, bg)
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }))
    sprite.renderOrder = 10
    const h = clamp(this.camDist * 0.034, 0.36, 0.62)
    this.scene.add(sprite)
    this.labels.push({ sprite, age: -order * 0.28, base: at.clone().setY(at.y + 1.0), w: h * aspect, h })
    sprite.visible = false
  }

  private updateFx(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      p.age += dt
      const k = p.age / p.life
      let dead = k >= 1
      if (p.kind === 'dust') {
        p.mesh.position.addScaledVector(p.vel, dt)
        p.vel.multiplyScalar(1 - dt * 5)
        p.mesh.scale.setScalar(p.size * (0.6 + k * 1.6))
        ;((p.mesh as THREE.Sprite).material as THREE.SpriteMaterial).opacity = 0.85 * (1 - k)
      } else if (p.kind === 'confetti') {
        p.vel.y -= 9 * dt
        p.vel.multiplyScalar(1 - dt * 1.4)
        p.mesh.position.addScaledVector(p.vel, dt)
        p.mesh.rotation.x += p.spin.x * dt
        p.mesh.rotation.y += p.spin.y * dt
        p.mesh.scale.setScalar(p.size * (k > 0.8 ? (1 - k) / 0.2 : 1))
        if (p.mesh.position.y < 0) dead = true
      } else {
        p.vel.y -= 13 * dt
        p.mesh.position.addScaledVector(p.vel, dt)
        p.mesh.rotation.y += p.spin.y * dt
        p.mesh.rotation.x += p.spin.x * dt * 0.4
        if (p.kind === 'coin_in' && (p.target || p.goal) && p.age > 0.38) {
          const head = p.target ? this.headOf(p.target, this.tmp) : this.tmp.copy(p.goal!)
          p.mesh.position.lerp(head, 1 - Math.exp(-dt * 11))
          p.mesh.scale.setScalar(Math.max(0.3, 1 - (k - 0.4) * 1.1))
          if (p.mesh.position.distanceTo(head) < 0.2) dead = true
        } else if (p.kind === 'coin_out') {
          p.mesh.scale.setScalar(k > 0.7 ? (1 - k) / 0.3 : 1)
          if (p.mesh.position.y < TOP_Y + 0.1 && p.vel.y < 0) p.vel.y *= -0.45
        }
      }
      if (dead) {
        p.mesh.visible = false
        this.particles.splice(i, 1)
      }
    }
    for (let i = this.labels.length - 1; i >= 0; i--) {
      const l = this.labels[i]
      l.age += dt
      if (l.age < 0) continue
      const t = l.age / 1.5
      if (t >= 1) {
        this.scene.remove(l.sprite)
        l.sprite.material.map?.dispose()
        l.sprite.material.dispose()
        this.labels.splice(i, 1)
        continue
      }
      l.sprite.visible = true
      const pop = t < 0.14 ? 0.4 + 0.75 * (t / 0.14) : 1 + 0.15 * Math.exp(-(t - 0.14) * 16)
      l.sprite.scale.set(l.w * pop, l.h * pop, 1)
      l.sprite.position.set(l.base.x, l.base.y + easeOut(t) * 1.1, l.base.z)
      l.sprite.material.opacity = t > 0.78 ? (1 - t) / 0.22 : 1
    }
  }

  /* ------------------------------ dés ------------------------------ */

  private static FACE: Record<number, THREE.Quaternion> = (() => {
    const z = new THREE.Vector3(0, 0, 1)
    const n: Record<number, THREE.Vector3> = { 2: new THREE.Vector3(1, 0, 0), 5: new THREE.Vector3(-1, 0, 0), 3: new THREE.Vector3(0, 1, 0), 4: new THREE.Vector3(0, -1, 0), 1: z, 6: new THREE.Vector3(0, 0, -1) }
    const out: Record<number, THREE.Quaternion> = {}
    for (const v of [1, 2, 3, 4, 5, 6]) {
      out[v] = v === 6 ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI) : new THREE.Quaternion().setFromUnitVectors(n[v], z)
    }
    return out
  })()

  private updateDice(view: BoardView, dt: number) {
    const m = view.mover
    const pw = m ? this.pawns.get(m.id) : null
    const n = m ? Math.min(3, m.dice.length) : 0
    // Hors pion : le dé du thème (dé de Riton au début de sa ronde).
    // Hors pion : les dés du thème (Riton, et sa famille en grande taille : un dé au-dessus de chaque raton).
    const one = !m ? (this.rt.dieAnchor?.(view) ?? null) : null
    const anchors = !m ? (this.rt.dieAnchors?.(view) ?? (one ? [one] : [])) : []
    const right = this.tmp.set(1, 0, 0).applyQuaternion(this.camera.quaternion)
    for (let i = 0; i < 3; i++) {
      const die = this.dice[i]
      if (anchors.length) {
        const anchor = anchors[Math.min(i, anchors.length - 1)]
        const on = i < anchors.length
        this.dieScale[i] = lerp(this.dieScale[i], on ? 1 : 0, 1 - Math.exp(-dt * (on ? 14 : 9)))
        if (this.dieScale[i] < 0.02) {
          die.visible = false
          continue
        }
        die.visible = true
        const t = clamp(anchor.t / 600, 0, 1)
        const rise = easeOut(Math.min(1, t * 2.2))
        die.position.set(anchor.pos.x, anchor.pos.y + 0.4 + rise * 1.4 + Math.sin(this.time * 3) * 0.05, anchor.pos.z)
        const spin = (1 - easeOut(t)) * 11
        this.tmpQ.setFromAxisAngle(this.tmp2.set(0.8, 0.5, 0.3).normalize(), spin)
        const v = clamp(Math.round(anchor.value), 1, 6)
        die.quaternion.copy(this.camera.quaternion).multiply(this.tmpQ).multiply(PartyScene.FACE[v])
        die.scale.setScalar(this.dieScale[i] * 0.84)
        continue
      }
      // Les dés restent le temps de les lire, puis laissent la place aux étiquettes (le bandeau les garde).
      const on = Boolean(m && pw && i < n && m.walking && m.t < DICE_MS + 900)
      this.dieScale[i] = lerp(this.dieScale[i], on ? 1 : 0, 1 - Math.exp(-dt * (on ? 14 : 9)))
      if (this.dieScale[i] < 0.02 || !m || !pw) {
        die.visible = false
        continue
      }
      die.visible = true
      const t = clamp(m.t / DICE_MS, 0, 1)
      const off = (i - (n - 1) / 2) * 0.66
      // Monte du pion, rebondit, puis plane au-dessus de sa tête.
      const rise = easeOut(Math.min(1, t * 2.2))
      const bounce = t < 1 ? Math.abs(Math.sin(t * Math.PI * 2.5 + i)) * 0.5 * (1 - t) : 0
      const hover = Math.sin(this.time * 3 + i * 1.7) * 0.05
      const px = pw.group.position.x + right.x * off * rise
      const pz = pw.group.position.z + right.z * off * rise
      die.position.set(px, pw.cur.y + 0.8 + rise * 2.25 * pw.scale + bounce + hover, pz)
      const spin = (1 - easeOut(t)) * (9 + i * 2.3)
      this.tmpQ.setFromAxisAngle(this.tmp2.set(0.8, 0.5 + i * 0.2, 0.3).normalize(), spin)
      const v = clamp(Math.round(m.dice[i] ?? 1), 1, 6)
      die.quaternion.copy(this.camera.quaternion).multiply(this.tmpQ).multiply(PartyScene.FACE[v])
      const settle = t >= 1 ? 1 + 0.18 * Math.exp(-((m.t - DICE_MS) / 1000) * 9) : 1
      die.scale.setScalar(this.dieScale[i] * settle * 0.84)
    }
  }

  /* ------------------------------ décor vivant ------------------------------ */

  private updateDecor(view: BoardView, dt: number) {
    this.cheerK = Math.max(0, this.cheerK - dt * 0.45)
    const amp = 0.05 + this.cheerK * 0.5
    const ola = this.olaUntil > this.time
    const one = this.tmp2.set(1, 1, 1)
    this.crowd.forEach((c, i) => {
      let hop = Math.abs(Math.sin(this.time * (3 + this.cheerK * 5) + c.ph)) * amp
      // Ola : une vague de bras levés qui fait le tour des gradins.
      if (ola) hop += Math.max(0, Math.sin(this.time * 7 - (c.x - c.z) * 0.45)) ** 3 * 0.75
      this.tmpM.compose(this.tmp.set(c.x, c.y + 0.25 + hop, c.z), this.tmpQ.identity(), one)
      this.crowdBodies.setMatrixAt(i, this.tmpM)
      this.tmpM.compose(this.tmp.set(c.x, c.y + 0.72 + hop * 1.15, c.z), this.tmpQ.identity(), one)
      this.crowdHeads.setMatrixAt(i, this.tmpM)
    })
    this.crowdBodies.instanceMatrix.needsUpdate = true
    this.crowdHeads.instanceMatrix.needsUpdate = true

    // Projecteurs : balayage tranquille, deux d'entre eux poursuivent le pion en vedette.
    const mover = view.mover ? this.pawns.get(view.mover.id) : null
    this.beams.forEach((b, i) => {
      const goal = this.tmp
      if (mover && (i === 0 || i === 3)) goal.copy(mover.group.position).setY(0.4)
      else goal.set(Math.sin(this.time * 0.35 + b.ph) * this.halfX * 0.8, 0, Math.cos(this.time * 0.27 + b.ph * 1.3) * this.halfZ * 0.8)
      b.aim.lerp(goal, 1 - Math.exp(-dt * 3))
      const dir = this.tmp2.copy(b.aim).sub(b.src)
      const len = dir.length()
      b.mesh.position.copy(b.src)
      b.mesh.quaternion.setFromUnitVectors(this.tmp.set(0, -1, 0), dir.normalize())
      b.mesh.scale.set(1, len, 1)
    })
    const spotMat = this.spot.material as THREE.MeshBasicMaterial
    spotMat.opacity = lerp(spotMat.opacity, mover ? (this.dark ? 0.6 : 0.45) : 0, 1 - Math.exp(-dt * 6))
    if (mover) this.spot.position.set(mover.group.position.x, mover.cur.y + 0.03, mover.group.position.z)

    // Guirlande : alterne tranquillement ; en chenillard (gros lot) une ampoule sur trois file autour du tapis.
    const chase = this.chaseUntil > this.time
    const tick = Math.floor(this.time * (chase ? 14 : 2.2))
    if (tick !== this.bulbTick) {
      this.bulbTick = tick
      const cols = this.theme.bulbs ?? BULBS
      for (let i = 0; i < this.bulbs.count; i++) {
        if (chase) this.bulbs.setColorAt(i, this.tmpC.set((i + tick) % 3 === 0 ? '#ffffff' : (i + tick) % 3 === 1 ? GOLD : '#3a2a10'))
        else this.bulbs.setColorAt(i, this.tmpC.set((i + tick) % 2 === 0 ? cols[0] : cols[1 + (((i + tick) >> 1) % (cols.length - 1))]))
      }
      if (this.bulbs.instanceColor) this.bulbs.instanceColor.needsUpdate = true
    }
    // Dédé se balance.
    this.dede.material.rotation = Math.sin(this.time * 1.6) * 0.05
    const d = 2.3 * (1 + this.cheerK * 0.06 * Math.abs(Math.sin(this.time * 9)))
    this.dede.scale.set(d, d, 1)
  }

  /* ------------------------------ caméra ------------------------------ */

  /** Centre (monde) de la zone d'une case : son quartier, ou le plateau de base. */
  private zoneCenter(cell: number, out: THREE.Vector3) {
    const q = this.big ? quarterOf(this.board, cell) : null
    if (!q) return out.set(0, 0, 0)
    return this.grid((q.box.c0 + q.box.c1) / 2, (q.box.r0 + q.box.r1) / 2, 0, out)
  }

  private updateCamera(view: BoardView, dt: number) {
    const m = view.mover
    const mover = m ? this.pawns.get(m.id) : null
    // Sans pion en vedette, le thème peut demander qu'on suive autre chose (Riton pendant sa ronde).
    let focus = !mover ? (this.rt.focus?.(view) ?? null) : null
    // Téléphone, grande taille : mon pion emporté par la vague, la caméra le suit.
    const me = this.focusId ? this.pawns.get(this.focusId) : null
    if (!mover && me && !this.opts.big && view.epi?.data.t === 'tide' && view.epi.events.some((e) => e.t === 'wash' && e.id === this.focusId)) focus = me.cur
    // Vue perso (téléphone, grande taille, phase de lancer) : mon pion, 3 cases devant lui sur sa route.
    const persona = !mover && !focus && !this.forceOverview && this.big && me && this.phase === 'roll'
    let mode: CamMode = mover || focus || persona ? 'follow' : this.phase === 'roll' || this.phase === 'move' || this.phase === 'intro' ? 'overview' : 'show'
    if (this.forceOverview) mode = 'overview'
    this.mode = mode
    const goalT = this.tmp
    let az = this.baseAz()
    let el = this.overviewEl()
    let dist = this.overviewDist
    // Liseré des 12 prochaines cases (vue perso).
    let routeN = 0
    if (mode === 'follow' && persona && me) {
      const pos = view.snap.pos[this.focusId!] ?? 0
      const ahead = this.routeAhead(pos, view.snap.sw ?? [])
      ahead.forEach((c, k) => {
        const p = this.cellPos(c, this.tmp2)
        this.tmpM.makeTranslation(p.x, p.y + TOP_Y + 0.012, p.z)
        this.route.setMatrixAt(k, this.tmpM)
      })
      routeN = ahead.length
      const tgt = this.cellPos(ahead[2] ?? pos, new THREE.Vector3()).lerp(me.cur, 0.35)
      az += Math.sin(this.time * 0.4) * 0.04
      el = (this.portrait ? 0.92 : 0.86) - (this.mountain && tgt.y > 0.5 ? 0.16 : 0)
      dist = 20
      goalT.set(tgt.x, tgt.y + 0.9, tgt.z)
    } else if (mode === 'follow' && (mover || focus)) {
      const at = mover ? mover.cur : focus!
      az += Math.sin(this.time * 0.4) * 0.06
      el = (this.portrait ? 0.9 : 0.84) - (this.mountain && (mover ? mover.cur : focus!).y > 0.5 ? 0.16 : 0)
      dist = clamp(this.overviewDist * (this.portrait ? 0.5 : 0.68), 11, 26)
      // On vise un peu au-delà du pion (il reste sous le bandeau) et un peu vers le centre de SA zone
      // (l'île, le quartier ou le plateau de base restent dans le champ, pas seulement les gradins).
      const zc = this.zoneCenter(m ? m.cell : -1, this.tmp2)
      const pull = this.big ? 0.25 : 0.18
      goalT.set(lerp(at.x, zc.x, pull) - Math.sin(az) * dist * 0.07, this.big ? at.y + 0.6 : 0.9, lerp(at.z, zc.z, pull) - Math.cos(az) * dist * 0.07)
      // Plan de traversée (grande taille) : pendant un transport, la caméra recule pour cadrer le départ et l'arrivée.
      if (this.big && m && m.next !== null && m.leap && m.leap !== 'lift' && m.leap !== 'ice') {
        const key = `${m.cell}-${m.next}`
        if (key !== this.rideKey) {
          this.rideKey = key
          const p = this.cellPos(m.cell)
          const q = this.cellPos(m.next)
          this.rideMid.copy(p).add(q).multiplyScalar(0.5)
          this.rideDist = clamp(this.fitRect(Math.min(p.x, q.x) - 2, Math.max(p.x, q.x) + 2, Math.min(p.z, q.z) - 2, Math.max(p.z, q.z) + 2, 3 + Math.max(p.y, q.y), this.rideMid, az, el), 26, this.overviewDist)
        }
        goalT.set(this.rideMid.x, this.rideMid.y + 0.6, this.rideMid.z)
        dist = this.rideDist
      }
    } else if (mode === 'show') {
      this.overviewTarget(goalT).y += 0.3
      az += Math.sin(this.time * 0.22) * 0.45
      el = 0.72
      dist = this.overviewDist * 0.92
    } else {
      this.overviewTarget(goalT)
      az += Math.sin(this.time * 0.3) * 0.035
      // Générique d'une grande taille : vue d'ensemble, puis survol de chaque quartier ouvert (1,1 s chacun).
      const qs = this.board.quarters
      if (this.phase === 'intro' && this.big && this.introT0 >= 0 && qs.length && !this.forceOverview) {
        const k = Math.floor((this.time - this.introT0 - 1.6) / 1.1)
        if (k >= 0 && k < qs.length) {
          const q = qs[k]
          const a = this.grid(q.box.c0, q.box.r0)
          const b = this.grid(q.box.c1, q.box.r1)
          this.grid((q.box.c0 + q.box.c1) / 2, (q.box.r0 + q.box.r1) / 2, 0.3, goalT)
          dist = clamp(this.fitRect(a.x - 1.5, b.x + 1.5, a.z - 1.5, b.z + 1.5, 2, goalT, az, el), 12, this.overviewDist)
          if (this.introShown !== k) {
            this.introShown = k
            this.label(`${q.emoji} ${q.name}`, q.road ?? '#FFD166', goalT.clone().setY(1.6), 0)
            this.cheerK = Math.max(this.cheerK, 0.6)
          }
        }
      }
    }
    if (this.route.count !== routeN) {
      this.route.count = routeN
    }
    if (routeN) this.route.instanceMatrix.needsUpdate = true
    if (mode !== 'follow' || !m || m.next === null || !m.leap) this.rideKey = ''
    if (this.camSnap) {
      this.camSnap = false
      this.camT.copy(goalT)
      this.camAz = az
      this.camEl = el
      this.camDist = dist
    } else {
      const k = 1 - Math.exp(-dt * (mode === 'follow' ? 3.2 : 2.2))
      this.camT.lerp(goalT, k)
      this.camAz = lerp(this.camAz, az, k)
      this.camEl = lerp(this.camEl, el, k)
      this.camDist = lerp(this.camDist, dist, k)
    }
    this.shakeK = Math.max(0, this.shakeK - dt * 1.8)
    this.place(this.camera, this.camT, this.camAz, this.camEl, this.camDist)
    if (this.shakeK > 0) {
      this.camera.position.x += Math.sin(this.time * 47) * 0.06 * this.shakeK
      this.camera.position.y += Math.cos(this.time * 53) * 0.06 * this.shakeK
    }
  }

  /** Cadrage courant et coût de la dernière image (mise au point). */
  get stats() {
    return { mode: this.mode, calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles, frameMs: Math.round(this.frameAvg * 10) / 10, quality: this.quality }
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.raf)
    for (const c of this.cleanups) c()
    for (const pw of this.pawns.values()) {
      pw.sprite.material.dispose()
      ;(pw.base.material as THREE.Material).dispose()
    }
    for (const l of this.labels) {
      l.sprite.material.map?.dispose()
      l.sprite.material.dispose()
    }
    for (const t of this.pawnTex.values()) t.dispose()
    this.floorMat.map?.dispose()
    this.carpetMat.map?.dispose()
    for (const d of this.disposables) d.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.renderer.domElement.remove()
  }
}

/** Attend la police d'affichage (textes des textures canvas) puis crée la scène. */
export async function createPartyScene(host: HTMLElement, opts: SceneOptions): Promise<PartyScene> {
  try {
    await Promise.race([document.fonts.load('800 32px "Baloo 2"'), new Promise((r) => setTimeout(r, 1500))])
  } catch {
    /* police absente : repli système */
  }
  return new PartyScene(host, opts)
}
