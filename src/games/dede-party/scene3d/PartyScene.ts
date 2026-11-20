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
import type { BoardView } from '../anim'
import { DICE_MS } from '../anim'
import { CELL_INFO, isJump, linksOf, zoneOf, type BoardDef, type CellType } from '../board'
import type { DpEvent } from '../types'
import { makeBeam, makeCarpet, makeCellTop, makeDieFace, makeFloor, makeGlow, makeLabel, makeSparkle, shade } from './textures'
import { THEMES } from './themes'
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

const LEAP_H: Record<'lift' | 'ice' | 'luge', number> = { lift: 2.6, ice: 1.1, luge: 3.9 }
const LEAP_LABEL: Record<'lift' | 'ice' | 'luge', [string, string]> = { lift: ['🚡 Télésiège !', '#B5E61D'], ice: ['🧊 Glissade !', '#DFF3FF'], luge: ['🛷 Grande Luge !', '#ffffff'] }
const LEAP_TRAIL: Record<'lift' | 'ice' | 'luge', string> = { lift: '#fff2c4', ice: '#dff3ff', luge: '#ffffff' }

export class PartyScene {
  private host: HTMLElement
  private opts: SceneOptions
  private board: BoardDef
  private theme: ThemeDef
  private rt: ThemeRuntime = {}
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 140)
  private fitCam = new THREE.PerspectiveCamera(FOV, 1, 0.5, 140)
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

  // lumières / thème
  private hemi!: THREE.HemisphereLight
  private sun!: THREE.DirectionalLight
  private floorMat!: THREE.MeshToonMaterial
  private carpetMat!: THREE.MeshToonMaterial
  private curtainMat!: THREE.MeshToonMaterial
  private beamMats: THREE.MeshBasicMaterial[] = []

  // plateau
  private tiles: Array<{ group: THREE.Group; bump: number }> = []
  private tops: THREE.Mesh[] = []
  private links: Array<[number, number]> = []
  private roadIn!: THREE.InstancedMesh
  private forkLinks: number[][] = []
  private signs: Array<{ arrow: THREE.Group; ang: number; vel: number; way: number; wiggle: number }> = []
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
    this.halfX = ((this.board.cols - 1) / 2) * S
    this.halfZ = ((this.board.rows - 1) / 2) * S
    this.zWall = -this.halfZ - 6.3
    this.xWall = this.halfX + 6.3
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
    return out.set((col - (this.board.cols - 1) / 2) * S, y, (row - (this.board.rows - 1) / 2) * S)
  }

  private cellPos(i: number, out = new THREE.Vector3()): THREE.Vector3 {
    const n = this.board.cells.length
    const [col, row] = this.board.xy[((i % n) + n) % n]
    return this.grid(col, row, 0, out)
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
    cam.left = -(this.halfX + 6.5)
    cam.right = this.halfX + 8.5
    cam.top = this.halfZ + 7.8
    cam.bottom = -(this.halfZ + 7.8)
    cam.near = 2
    cam.far = 40
    this.sun.shadow.bias = -0.0015
    this.sun.shadow.radius = 4
    this.scene.add(this.sun, this.sun.target)
  }

  private buildGround() {
    const floorGeo = this.track(new THREE.CircleGeometry(60, 48))
    floorGeo.rotateX(-Math.PI / 2)
    this.floorMat = this.toon('#ffffff')
    const floor = new THREE.Mesh(floorGeo, this.floorMat)
    floor.position.y = -0.2
    floor.receiveShadow = true
    this.scene.add(floor)

    // Tapis du plateau (bord encre + dessus à pois).
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
    const pos = geo.getAttribute('position')
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 4, pos.getZ(i) / 4)
    const carpet = new THREE.Mesh(geo, this.carpetMat)
    carpet.position.y = -0.08
    carpet.receiveShadow = true
    this.scene.add(carpet)

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

  private buildBoard() {
    const b = this.board
    const n = b.cells.length
    // Tracé : ruban encre + ruban clair (pas de ruban pour les sauts) ; la voie ouverte des aiguillages s'allume.
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
    const one = new THREE.Vector3(1, 1, 1)
    const up = new THREE.Vector3(0, 1, 0)
    this.links.forEach(([i, j], k) => {
      this.cellPos(i, a)
      this.cellPos(j, c)
      const mid = a.clone().add(c).multiplyScalar(0.5)
      q.setFromAxisAngle(up, -Math.atan2(c.z - a.z, c.x - a.x))
      this.tmpM.compose(mid.clone().setY(0.05), q, one)
      roadInk.setMatrixAt(k, this.tmpM)
      this.tmpM.compose(mid.clone().setY(0.065), q, one)
      this.roadIn.setMatrixAt(k, this.tmpM)
      this.roadIn.setColorAt(k, this.tmpC.set(this.roadColor(k)))
      const ci = chev.indexOf(k)
      if (ci >= 0) {
        this.tmpM.compose(mid.clone().setY(0.212), q, one)
        chevInk.setMatrixAt(ci, this.tmpM)
        this.tmpM.compose(mid.clone().setY(0.218), q, one)
        chevIn.setMatrixAt(ci, this.tmpM)
      }
    })
    this.forkLinks = b.forks.map((f) => f.ways.map((wcell) => this.links.findIndex(([i, j]) => i === f.cell && j === wcell)))
    for (const m of [roadInk, this.roadIn, chevInk, chevIn]) m.frustumCulled = false
    this.scene.add(roadInk, this.roadIn, chevInk, chevIn)

    // Cases : socle encre (instancié), corps coloré arrondi, dessus illustré.
    const slabGeo = this.track(new RoundedBoxGeometry(TILE + 0.16, 0.2, TILE + 0.16, 3, 0.09))
    const slabs = new THREE.InstancedMesh(slabGeo, this.inkFront, n)
    slabs.castShadow = true
    slabs.frustumCulled = false
    const bodyGeo = this.track(new RoundedBoxGeometry(TILE, TILE_H, TILE, 3, 0.1))
    const topGeo = this.track(new THREE.PlaneGeometry(TILE * 0.94, TILE * 0.94))
    topGeo.rotateX(-Math.PI / 2)
    const types = (Object.keys(CELL_INFO) as CellType[]).filter((t) => b.cells.includes(t))
    const bodyMat = Object.fromEntries(types.map((t) => [t, this.toon(shade(CELL_INFO[t].color, -0.22))])) as unknown as Record<CellType, THREE.Material>
    const topMat = Object.fromEntries(
      types.map((t) => [t, this.track(new THREE.MeshToonMaterial({ map: this.track(makeCellTop(t, this.maxAniso)), gradientMap: this.ramp, transparent: true, alphaTest: 0.4 }))]),
    ) as unknown as Record<CellType, THREE.Material>
    for (let i = 0; i < n; i++) {
      const p = this.cellPos(i)
      this.tmpM.makeTranslation(p.x, 0.1, p.z)
      slabs.setMatrixAt(i, this.tmpM)
      const g = new THREE.Group()
      g.position.copy(p)
      const body = new THREE.Mesh(bodyGeo, bodyMat[b.cells[i]])
      body.position.y = TILE_H / 2 + 0.02
      body.castShadow = true
      const top = new THREE.Mesh(topGeo, topMat[b.cells[i]])
      top.position.y = TOP_Y + 0.006
      this.tops.push(top)
      g.add(body, top)
      this.scene.add(g)
      this.tiles.push({ group: g, bump: 0 })
    }
    this.scene.add(slabs)
  }

  private buildForks() {
    if (!this.board.forks.length) return
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
      const d = f.ways.map((c) => this.cellPos(c).sub(o).normalize())
      const at = o.clone().add(d[0].clone().add(d[1]).multiplyScalar(S * 0.5))
      const g = new THREE.Group()
      g.position.copy(at)
      const pole = this.inked(poleGeo, poleMat, 1.25)
      pole.position.y = 0.7
      const foot = this.inked(footGeo, footMat, 1.12)
      foot.position.y = 0.06
      const arrow = this.inked(geo, f.mode === 'tide' ? tideMat : mat, 1.14)
      arrow.position.y = 1.5
      g.add(foot, pole, arrow)
      this.scene.add(g)
      this.signs.push({ arrow, ang: 0, vel: 0, way: -1, wiggle: 0 })
    })
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
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.4
        const s = this.sprite(this.sparkleTex, { color: GOLD })
        s.scale.setScalar(0.42)
        s.position.set(Math.cos(a) * 1.48, 0.5, Math.sin(a) * 1.48)
        g.add(s)
      }
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
    const { zWall, xWall, halfX, halfZ } = this
    this.curtainMat = this.toon('#ffffff', { side: THREE.DoubleSide })
    const curtain = (len: number) => {
      const geo = this.track(new THREE.PlaneGeometry(len, 8, Math.round(len * 5), 1))
      const p = geo.getAttribute('position')
      for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 3.6) * 0.22)
      geo.computeVertexNormals()
      return new THREE.Mesh(geo, this.curtainMat)
    }
    const lenA = xWall + halfX + 7
    const wallA = curtain(lenA)
    wallA.position.set(xWall - lenA / 2, 3.8, zWall)
    const lenB = halfZ + 6 - zWall
    const wallB = curtain(lenB)
    wallB.rotation.y = -Math.PI / 2
    wallB.position.set(xWall, 3.8, zWall + lenB / 2)
    this.scene.add(wallA, wallB)

    // Gradins (3 marches) et public : têtes + corps instanciés qui sautillent.
    const stepMat = this.toon('#5b3fa8')
    const stepMat2 = this.toon('#7353c9')
    const seats: Array<{ x: number; y: number; z: number }> = []
    for (let r = 0; r < 3; r++) {
      const h = 0.5 + r * 0.5
      const za = -halfZ - 2.5 - r * 1.05
      const a = new THREE.Mesh(this.track(new THREE.BoxGeometry(halfX * 2 + 1, h, 1.05)), r % 2 === 0 ? stepMat : stepMat2)
      a.position.set(0, h / 2 - 0.2, za)
      a.castShadow = true
      const xb = halfX + 2.5 + r * 1.05
      const b = new THREE.Mesh(this.track(new THREE.BoxGeometry(1.05, h, halfZ * 2 + 1)), r % 2 === 0 ? stepMat : stepMat2)
      b.position.set(xb, h / 2 - 0.2, 0)
      b.castShadow = true
      this.scene.add(a, b)
      for (let x = -halfX + (r % 2) * 0.45; x <= halfX; x += 0.92) seats.push({ x, y: h - 0.2, z: za })
      for (let z = -halfZ + (r % 2) * 0.45; z <= halfZ; z += 0.92) seats.push({ x: xb, y: h - 0.2, z })
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
      [-halfX - 2.2, zWall + 1.3, '#FFD166'],
      [halfX * 0.25, zWall + 1.0, '#FF8FA3'],
      [xWall - 1.2, zWall + 1.3, '#4CC9F0'],
      [xWall - 1.0, halfZ * 0.3, '#FFD166'],
      [xWall - 1.3, halfZ + 3.4, '#8B5CF6'],
    ]
    spots.forEach(([x, z, col], i) => {
      const tower = new THREE.Mesh(towerGeo, towerMat)
      tower.position.set(x, 4.3, z)
      const lamp = new THREE.Mesh(headGeo2, lampMat)
      lamp.position.set(x, 8.9, z)
      this.scene.add(tower, lamp)
      const mat = this.track(new THREE.MeshBasicMaterial({ map: this.beamTex, color: col, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, opacity: 0.3 }))
      this.beamMats.push(mat)
      const mesh = new THREE.Mesh(beamGeo, mat)
      mesh.renderOrder = 3
      this.scene.add(mesh)
      this.beams.push({ mesh, src: new THREE.Vector3(x, 8.7, z), aim: new THREE.Vector3(0, 0, 0), ph: i * 1.7 })
    })

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

  /** Phase du jeu : choisit le cadrage quand aucun pion n'est en vedette. */
  setPhase(phase: string) {
    if (phase === this.phase) return
    this.phase = phase
  }

  /* ------------------------------ boucle ------------------------------ */

  private resize() {
    const w = Math.max(1, this.host.clientWidth)
    const h = Math.max(1, this.host.clientHeight)
    if (w === this.width && h === this.height) return
    this.width = w
    this.height = h
    this.portrait = h > w * 1.02
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.overviewDist = this.fitDistance()
    this.camSnap = true
    // Les emojis des cases se lisent depuis la caméra (portrait : un quart de tour).
    for (const t of this.tops) t.rotation.y = this.portrait ? -Math.PI / 2 : 0
    this.setFog()
  }

  private baseAz() {
    return this.portrait ? -Math.PI / 2 : 0
  }

  private overviewEl() {
    return this.portrait ? 1.0 : 0.93
  }

  private place(cam: THREE.PerspectiveCamera, target: THREE.Vector3, az: number, el: number, dist: number) {
    cam.position.set(target.x + Math.sin(az) * Math.cos(el) * dist, target.y + Math.sin(el) * dist, target.z + Math.cos(az) * Math.cos(el) * dist)
    cam.lookAt(target)
  }

  /** Distance de la vue d'ensemble : tout le plateau tient dans le cadre (marge en haut pour le décor). */
  private fitDistance(): number {
    const cam = this.fitCam
    cam.aspect = this.camera.aspect
    cam.updateProjectionMatrix()
    const mx = this.halfX + 1.25
    const mz = this.halfZ + 1.25
    const pts: THREE.Vector3[] = []
    for (const x of [-mx, mx]) for (const z of [-mz, mz]) for (const y of [0, 1.7]) pts.push(new THREE.Vector3(x, y, z))
    const target = new THREE.Vector3(0, 0.3, 0)
    const fits = (d: number) => {
      this.place(cam, target, this.baseAz(), this.overviewEl(), d)
      cam.updateMatrixWorld()
      return pts.every((p) => {
        const v = this.tmp.copy(p).project(cam)
        // z hors de [-1, 1] : point derrière la caméra (projection miroir, à rejeter).
        return Math.abs(v.z) < 1 && Math.abs(v.x) <= 0.96 && v.y >= -0.95 && v.y <= (this.portrait ? 0.72 : 0.8)
      })
    }
    let lo = 8
    let hi = 90
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2
      if (fits(mid)) hi = mid
      else lo = mid
    }
    return hi
  }

  private frame = (now: number) => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.frame)
    if (document.hidden) {
      this.lastT = now
      return
    }
    const dt = Math.min(0.05, (now - this.lastT) / 1000)
    this.lastT = now
    this.time += dt
    const view = this.opts.getView()
    this.updateBoard(view, dt)
    this.updateStars(view)
    this.updatePawns(view, dt, now)
    this.updateEvents(view, now)
    this.updateDice(view, dt)
    this.updateFx(dt)
    this.updateDecor(view, dt)
    this.rt.update?.(view, dt)
    this.updateCamera(view, dt)
    this.primed = true
    this.renderer.render(this.scene, this.camera)
  }

  /* ------------------------------ plateau ------------------------------ */

  private updateBoard(view: BoardView, dt: number) {
    for (const t of this.tiles) {
      if (t.bump <= 0.001) continue
      t.bump = Math.max(0, t.bump - dt * 5)
      t.group.position.y = -0.09 * Math.sin(t.bump * Math.PI)
    }
    // Aiguillages : flèche (ressort) + voie ouverte allumée.
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
      sg.arrow.rotation.y = sg.ang
      const s = 1 + 0.35 * Math.sin(sg.wiggle * Math.PI) + 0.04 * Math.sin(this.time * 4 + k)
      sg.arrow.scale.setScalar(s)
      sg.arrow.position.y = 1.5 + 0.06 * Math.sin(this.time * 2.4 + k * 2)
    })
    if (colors && this.roadIn.instanceColor) this.roadIn.instanceColor.needsUpdate = true
  }

  /* ------------------------------ étoiles ------------------------------ */

  private makeStar(cell: number): Star {
    const group = new THREE.Group()
    const mesh = new THREE.Mesh(this.starGeo, this.starMat)
    const hull = new THREE.Mesh(this.starGeo, this.inkBack)
    hull.scale.set(1.13, 1.13, 1.5)
    const spin = new THREE.Group()
    spin.add(mesh, hull)
    const glow = this.sprite(this.glowTex, { color: '#ffe066', blending: THREE.AdditiveBlending, opacity: 0.75 })
    glow.scale.setScalar(2.3)
    const beamMat = this.track(new THREE.MeshBasicMaterial({ map: this.beamTex, color: '#ffe066', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, opacity: 0.4 }))
    const beam = new THREE.Mesh(this.starBeamGeo, beamMat)
    beam.rotation.x = Math.PI
    beam.renderOrder = 3
    const sparkles: THREE.Sprite[] = []
    for (let i = 0; i < 3; i++) {
      const s = this.sprite(this.sparkleTex, { color: '#fffbe0', blending: THREE.AdditiveBlending })
      sparkles.push(s)
      group.add(s)
    }
    group.add(glow, spin)
    this.scene.add(group, beam)
    const st: Star = { group, mesh: spin, glow, beam, sparkles, cell, move: null }
    const p = this.cellPos(cell)
    group.position.set(p.x, 1.55, p.z)
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
      const bob = 1.55 + Math.sin(this.time * 2.2 + i * 2.1) * 0.12
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
      st.beam.position.set(st.group.position.x, TOP_Y + 2.75, st.group.position.z)
      ;(st.beam.material as THREE.MeshBasicMaterial).opacity = (this.dark ? 0.42 : 0.2) * beamK * (0.85 + 0.15 * Math.sin(this.time * 3 + i))
    })
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
        const goal = this.tmp2.set(tx, TOP_Y, tz)
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
        let y = 0
        let squash = 0
        let spin = 0
        if (m.rolling) {
          // Pendant les dés : le pion trépigne.
          squash = Math.sin(this.time * 14) * 0.07
        } else if (m.next !== null) {
          const b = this.cellPos(m.next, this.tmp2)
          const f = m.frac
          const leap = m.leap
          if (leap) {
            // Télésiège, verglas, Grande Luge : étiquette au décollage, grande cloche, traînée.
            const key = `${m.idx}:${m.id}:${m.hops}`
            if (key !== this.leapKey) {
              this.leapKey = key
              if (this.primed) {
                const [txt, bg] = LEAP_LABEL[leap]
                this.label(txt, bg, this.headOf(pw, new THREE.Vector3()), 0)
                this.cheerK = Math.max(this.cheerK, leap === 'ice' ? 0.4 : 0.8)
              }
            }
          }
          // 0-18 % : s'accroupit ; ensuite : bond en cloche, étiré.
          if (f < 0.18) squash = 0.34 * Math.sin((f / 0.18) * Math.PI * 0.5)
          else {
            const g = (f - 0.18) / 0.82
            const e = easeInOut(g)
            x = lerp(a.x, b.x, e)
            z = lerp(a.z, b.z, e)
            y = Math.sin(g * Math.PI) * (leap ? LEAP_H[leap] : 0.85)
            squash = 0.34 * (1 - Math.min(1, g * 5)) - 0.3 * Math.sin(g * Math.PI)
            if (leap === 'ice') spin = g * Math.PI * 4
            if (leap && this.time - this.trailT > 0.035) {
              this.trailT = this.time
              this.spawn('dust', this.tmp2.set(x, TOP_Y + y + 0.3, z).clone(), new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.2, (Math.random() - 0.5) * 0.6), 0.55, leap === 'luge' ? 0.42 : 0.32, null, LEAP_TRAIL[leap])
            }
          }
        }
        const since = (now - pw.landAt) / 1000
        if (since < 0.3 && (m.next === null || m.frac < 0.18)) squash += 0.4 * Math.exp(-since * 12)
        pw.cur.set(x, TOP_Y, z)
        pw.placed = true
        pw.arc = null
        pw.scale = lerp(pw.scale, 1.18, 1 - Math.exp(-dt * 10))
        this.poseePawn(pw, x, TOP_Y + y, z, squash, true, spin)
      }
    }
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
      this.puff(at.clone().setY(TOP_Y))
      const tile = this.tiles[m.cell]
      if (tile) tile.bump = 1
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
      return this.label(e.way === 1 ? '🔀 Détour !' : '🔀 Tout droit', '#FFD166', head, order)
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
    const anchor = !m ? (this.rt.dieAnchor?.(view) ?? null) : null
    const right = this.tmp.set(1, 0, 0).applyQuaternion(this.camera.quaternion)
    for (let i = 0; i < 3; i++) {
      const die = this.dice[i]
      if (anchor) {
        const on = i === 0
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
    if (mover) this.spot.position.set(mover.group.position.x, TOP_Y + 0.03, mover.group.position.z)

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

  private updateCamera(view: BoardView, dt: number) {
    const m = view.mover
    const mover = m ? this.pawns.get(m.id) : null
    // Sans pion en vedette, le thème peut demander qu'on suive autre chose (Riton pendant sa ronde).
    const focus = !mover ? (this.rt.focus?.(view) ?? null) : null
    const mode: CamMode = mover || focus ? 'follow' : this.phase === 'roll' || this.phase === 'move' || this.phase === 'intro' ? 'overview' : 'show'
    this.mode = mode
    const goalT = this.tmp
    let az = this.baseAz()
    let el = this.overviewEl()
    let dist = this.overviewDist
    if (mode === 'follow' && (mover || focus)) {
      const at = mover ? mover.cur : focus!
      az += Math.sin(this.time * 0.4) * 0.06
      el = this.portrait ? 0.9 : 0.84
      dist = clamp(this.overviewDist * (this.portrait ? 0.5 : 0.68), 11, 26)
      // On vise un peu au-delà du pion (il reste sous le bandeau) et un peu vers le centre
      // (le plateau et les étoiles restent dans le champ, pas seulement les gradins).
      goalT.set(at.x * 0.82 - Math.sin(az) * dist * 0.07, 0.9, at.z * 0.82 - Math.cos(az) * dist * 0.07)
    } else if (mode === 'show') {
      goalT.set(0, 0.6, 0)
      az += Math.sin(this.time * 0.22) * 0.45
      el = 0.72
      dist = this.overviewDist * 0.92
    } else {
      goalT.set(0, 0.3, 0)
      az += Math.sin(this.time * 0.3) * 0.035
    }
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
    return { mode: this.mode, calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles }
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
