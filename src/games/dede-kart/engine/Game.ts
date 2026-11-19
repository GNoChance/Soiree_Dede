import * as THREE from 'three'
import { CHECKPOINTS, type TrackDef } from '../tracks'
import { BallSim, boxMaterial, HEN_LIFE, rollItem, type Fx, type Hazard, type ItemId, type UsePayload } from './items'
import { buildKart, SPARKS } from './kart'
import { Particles } from './particles'
import { Sfx } from './sfx'
import { outline, toon } from './toon'
import { CUT_MARGIN, PUDDLE_R, Track, WALL_MARGIN, type Mover } from './track'

export interface Driver {
  id: string
  name: string
  color: string
  /** Forme du kart (0 classique, 1 bolide, 2 buggy). */
  kart?: number
  /** Image du pilote (chibi). */
  sprite: string
}

export interface RaceResult {
  id: string
  name: string
  /** Temps en secondes, null si pas arrivé. */
  time: number | null
  me: boolean
}

export interface Hud {
  phase: 'countdown' | 'racing' | 'finished'
  /** 3, 2, 1 puis 0 = partez. */
  count: number
  lap: number
  laps: number
  place: number
  total: number
  time: number
  /** 0..1 */
  speed: number
  driftLevel: number
  boost: boolean
  wrongWay: boolean
  /** Classement local (indicatif en multi : le serveur fait foi). */
  results: RaceResult[] | null
  /** Objet en main (null = rien), roulette en cours. */
  item: ItemId | null
  rolling: boolean
  /** Mini-carte : karts en coordonnées normalisées 0..1. */
  dots: { x: number; y: number; c: string; me: boolean }[]
  /** Effets subis / actifs sur mon kart. */
  fx: {
    spin: boolean
    slow: boolean
    confetti: boolean
    reverse: boolean
    star: boolean
    bubble: boolean
    /** Ça glisse (flaque, beurre, klaxon). */
    slip: boolean
    magnet: boolean
    /** Aspiration derrière un autre kart. */
    draft: boolean
    /** Sur le raccourci. */
    cut: boolean
  }
}

/** Bits d'effets visibles par les autres (KartSnap.e). */
const E_STAR = 1
const E_BUBBLE = 2
const E_SPIN = 4
const E_SLOW = 8
const E_AIR = 16
const E_HOP = 32
const E_SLIP = 64
/** Durée d'un saut de tremplin / d'une bosse (s). */
const AIR = 0.75
const HOP = 0.32
/** Durée d'un tête-à-queue (s). */
const SPIN = 1.1

/** État d'un kart diffusé en broadcast (~8 Hz). */
export interface KartSnap {
  id: string
  x: number
  z: number
  /** cap (rad) */
  h: number
  /** vitesse */
  s: number
  /** sens du dérapage -1/0/1 */
  d: number
  /** turbo en cours */
  b: number
  /** progression (classement en direct) */
  p: number
  /** tour / dernier checkpoint (reprise des bots par un autre téléphone) */
  l?: number
  c?: number
  /** temps d'arrivée (s) ou null */
  f: number | null
  /** effets visibles (bits E_*) */
  e?: number
  /** heure serveur de l'envoi (ms) */
  t: number
}

export interface GameOptions {
  track: TrackDef
  laps: number
  /** Tous les karts de la course. */
  drivers: Driver[]
  /** Mon kart (null = spectateur, caméra sur le 1er). */
  meId: string | null
  /** Bots simulés sur CE téléphone (l'hôte en multi). Les autres karts non locaux sont distants. */
  localBots: string[]
  /** Tous les bots de la course (leur conducteur peut changer en cours de route). */
  botIds?: string[]
  /** Feu vert (ms, horloge `now`). */
  goAt: number
  /** Horloge commune (serverNow en multi). */
  now: () => number
  autopilot?: boolean
  /** Pilote automatique : prend le raccourci (essais). */
  autoCut?: boolean
  onHud: (h: Hud) => void
  /** Un kart local vient de boucler un tour (`completed` = tours terminés). */
  onLap?: (id: string, completed: number) => void
  /** Un kart local lance un objet qui touche les autres (à envoyer au serveur). */
  onUse?: (id: string, p: UsePayload) => void
  /** Un kart local a percuté une boule / une glue / du beurre / une poule. */
  onHit?: (id: string, hazard: number) => void
}

interface HazardView {
  hz: Hazard
  at: number
  mesh: THREE.Object3D
  ball: BallSim | null
  /** Poule : échantillon de piste autour duquel elle se promène. */
  i0: number
  /** touché ici : caché en attendant la confirmation serveur */
  gone: boolean
}

const MAX = 30
const OFFROAD = 13
/** Hors du raccourci : terrain très lent (c'est le risque). */
const OFFROAD_CUT = 9
const BOOST = 43
const MAGNET = 39
const DRIFT_LEVELS = [0.7, 1.6, 2.6]
const DRIFT_BOOST = [0, 0.6, 1.2, 1.9]
/** Portée du Klaxon de tracteur. */
const HONK_RANGE = 24
/** Retard d'affichage des karts distants (ms) : on interpole entre deux paquets reçus. */
const INTERP_DELAY = 220

type Kind = 'me' | 'bot' | 'remote'

interface Racer {
  d: Driver
  kind: Kind
  x: number
  z: number
  heading: number
  speed: number
  /** Échantillon de piste (sur le raccourci : équivalent pour le classement et les checkpoints). */
  idx: number
  lat: number
  /** Sur le raccourci : échantillon du raccourci, sinon -1. */
  cut: number
  /** Hors de la chaussée (herbe, sable…). */
  off: boolean
  lap: number
  cp: number
  finish: number | null
  driftDir: number
  charge: number
  boost: number
  yaw: number
  skill: number
  botLat: number
  /** Bot qui tente le raccourci. */
  cutter: boolean
  mesh: THREE.Group
  sparks: THREE.Mesh[]
  flame: THREE.Mesh
  /** Distant : paquets reçus (triés par t) + dernière progression connue. */
  buf: KartSnap[]
  netP: number
  /** Objets : en main, roulette (s), temps avant usage (bots), effets (s restantes). */
  item: ItemId | null
  roll: number
  hold: number
  spin: number
  slow: number
  star: number
  bubble: number
  reverse: number
  confetti: number
  slip: number
  magnet: number
  /** Répit après un choc (obstacle mobile, kart invincible). */
  safe: number
  /** Délais entre deux chocs contre un mur / un kart. */
  wallT: number
  bumpT: number
  /** Aspiration (s passées dans le sillage d'un kart) et coup de pouce aux retardataires (0..0,07). */
  draft: number
  catchup: number
  spinA: number
  /** saut en cours (s restantes) et sa durée totale */
  air: number
  airMax: number
  /** petit sursaut du châssis (début de dérapage, atterrissage) */
  kick: number
  prevE: number
  /** effets distants (bits E_*) */
  e: number
  body: THREE.MeshToonMaterial
  bubbleMesh: THREE.Mesh
  cloudMesh: THREE.Group
  chassis: THREE.Group
  wheels: THREE.Group[]
  steerPivots: THREE.Group[]
  shadow: THREE.Mesh
  /** direction lissée (-1..1) et vitesse précédente (tangage) */
  steerS: number
  /** temps passé à tourner franchement (déclenche le dérapage automatique) */
  autoT: number
  prevSpeed: number
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b))
const TIMERS = ['spin', 'slow', 'star', 'bubble', 'reverse', 'confetti', 'slip', 'magnet', 'safe', 'wallT', 'bumpT', 'kick'] as const

/** Course de karts : scène three, physique arcade, bots, karts distants interpolés, caméra, entrées. */
export class Game {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(70, 1, 0.6, 1700)
  private track: Track
  private racers: Racer[] = []
  private byId = new Map<string, Racer>()
  private me: Racer | null
  private sfx = new Sfx()
  private raf = 0
  private last = 0
  private phase: Hud['phase'] = 'countdown'
  private count = -1
  private time = 0
  private nowMs = 0
  private camHeading = 0
  private camPos = new THREE.Vector3()
  private camLook = new THREE.Vector3()
  private camSnap = true
  private camBack = 0
  /** Secousse de caméra (chocs), amortie. */
  private shake = 0
  private tmp = new THREE.Vector3()
  /** Cadre de la mini-carte : [x0, z0, côté]. */
  private box: [number, number, number] = [0, 0, 1]
  private dust = new Particles(500, 0.75, false, 0.45)
  private glow = new Particles(300, 0.55, true)
  private hudAt = 0
  private keys = new Set<string>()
  private pointer: { id: number; steer: number } | null = null
  private driftBtn = false
  private ro: ResizeObserver
  private o: GameOptions
  private el: HTMLElement
  private boxes: { x: number; z: number; mesh: THREE.Mesh; until: number }[] = []
  private hazards = new Map<number, HazardView>()
  private seenFx = new Set<number>()
  private seenHonk = new Set<string>()
  private rings: { mesh: THREE.Mesh; t: number }[] = []
  private useBtn = false
  /** Visée des bots : échantillons de piste en face du début du raccourci et un peu plus loin, côté du raccourci. */
  private cutEntry0 = 0
  private cutEntry = 0
  private cutSide = 1

  constructor(el: HTMLElement, o: GameOptions) {
    this.el = el
    this.o = o
    const def = o.track
    this.track = new Track(def)
    const tr = this.track
    {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
      for (let i = 0; i < tr.n; i++) {
        x0 = Math.min(x0, tr.px[i]); x1 = Math.max(x1, tr.px[i])
        z0 = Math.min(z0, tr.pz[i]); z1 = Math.max(z1, tr.pz[i])
      }
      const span = Math.max(x1 - x0, z1 - z0) * 1.1
      this.box = [(x0 + x1) / 2 - span / 2, (z0 + z1) / 2 - span / 2, span]
    }
    if (tr.cut) {
      const at = (j: number) => tr.locate(tr.cut!.x[Math.min(j, tr.cut!.m - 1)], tr.cut!.z[Math.min(j, tr.cut!.m - 1)])
      this.cutEntry0 = at(0).i
      this.cutEntry = at(14).i
      this.cutSide = Math.sign(at(10).lat) || 1
    }
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    el.appendChild(this.renderer.domElement)
    this.scene.background = new THREE.Color(def.colors.sky)
    this.scene.fog = new THREE.Fog(def.colors.sky, 120, 420)
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#b0a090', 2.2))
    const sun = new THREE.DirectionalLight('#ffffff', 1.4)
    sun.position.set(40, 80, 20)
    this.scene.add(sun)
    this.scene.add(tr.build(), tr.sky)
    this.scene.add(this.dust.points, this.glow.points)

    const loader = new THREE.TextureLoader()
    const bots = new Set(o.localBots)
    o.drivers.forEach((d, k) => {
      // grille de départ : 2 de front, derrière la ligne (même ordre sur tous les téléphones)
      const row = Math.floor(k / 2)
      const idx = tr.n - 6 - row * 7
      const lat = (k % 2 ? 1 : -1) * tr.hw[tr.wrap(idx)] * 0.45
      const [x, z] = tr.pointAt(idx, lat)
      const i = tr.wrap(idx)
      const kind: Kind = d.id === o.meId ? 'me' : bots.has(d.id) ? 'bot' : 'remote'
      const skill = 0.84 + ((k * 37) % 13) / 100
      const r: Racer = {
        d, kind, x, z,
        heading: Math.atan2(tr.tz[i], tr.tx[i]),
        speed: 0, idx: i, lat, cut: -1, off: false, lap: 0, cp: CHECKPOINTS - 1, finish: null,
        driftDir: 0, charge: 0, boost: 0, yaw: 0,
        skill,
        botLat: lat * 0.9,
        // les meilleurs bots tentent le raccourci
        cutter: skill >= 0.93,
        buf: [], netP: 0,
        item: null, roll: 0, hold: 0, spin: 0, slow: 0, star: 0, bubble: 0, reverse: 0, confetti: 0,
        slip: 0, magnet: 0, safe: 0, wallT: 0, bumpT: 0, draft: 0, catchup: 0,
        spinA: 0, air: 0, airMax: AIR, kick: 0, prevE: 0, e: 0, steerS: 0, autoT: 0, prevSpeed: 0,
        ...this.makeKart(d, loader),
      }
      r.netP = this.progress(r)
      this.racers.push(r)
      this.byId.set(d.id, r)
      this.scene.add(r.mesh)
    })
    this.me = o.meId ? this.byId.get(o.meId) ?? null : null
    this.camHeading = (this.me ?? this.racers[0]).heading

    // boîtes « ? » : rangées de 4 en travers de la piste
    const boxGeo = new THREE.BoxGeometry(1.5, 1.5, 1.5)
    const boxMat = boxMaterial()
    for (const i of tr.geo.boxes) {
      for (const lat of [-0.66, -0.22, 0.22, 0.66]) {
        const [x, z] = tr.pointAt(i, lat * tr.hw[i])
        const mesh = new THREE.Mesh(boxGeo, boxMat)
        mesh.position.set(x, 1.3, z)
        this.scene.add(mesh)
        this.boxes.push({ x, z, mesh, until: 0 })
      }
    }

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(el)
    this.resize()
    window.addEventListener('keydown', this.onKey)
    window.addEventListener('keyup', this.onKey)
    const c = this.renderer.domElement
    c.style.touchAction = 'none'
    c.addEventListener('pointerdown', this.onPointer)
    c.addEventListener('pointermove', this.onPointer)
    c.addEventListener('pointerup', this.onPointerUp)
    c.addEventListener('pointercancel', this.onPointerUp)
    this.sfx.start()
    this.raf = requestAnimationFrame(this.frame)
  }

  get muted() {
    return this.sfx.muted
  }

  setMuted(m: boolean) {
    this.sfx.setMuted(m)
  }

  private norm(x: number, z: number): [number, number] {
    return [(x - this.box[0]) / this.box[2], (z - this.box[1]) / this.box[2]]
  }

  /** Contour du circuit pour la mini-carte (coordonnées 0..1). */
  outline(): [number, number][] {
    const out: [number, number][] = []
    for (let i = 0; i < this.track.n; i += 6) out.push(this.norm(this.track.px[i], this.track.pz[i]))
    return out
  }

  /** Tracé du raccourci pour la mini-carte (vide s'il n'y en a pas). */
  cutOutline(): [number, number][] {
    const c = this.track.cut
    const out: [number, number][] = []
    if (c) for (let j = 0; j < c.m; j += 3) out.push(this.norm(c.x[j], c.z[j]))
    return out
  }

  /** Bouton Drift de l'écran tactile. */
  setDrift(on: boolean) {
    this.driftBtn = on
  }

  private bits(r: Racer) {
    return (
      (r.star > 0 ? E_STAR : 0) | (r.bubble > 0 ? E_BUBBLE : 0) | (r.spin > 0 ? E_SPIN : 0) | (r.slow > 0 ? E_SLOW : 0) |
      (r.air > 0 ? (r.airMax === AIR ? E_AIR : E_HOP) : 0) | (r.slip > 0 ? E_SLIP : 0)
    )
  }

  /** État des karts simulés ici (moi + bots locaux), à diffuser. */
  snapshots(): KartSnap[] {
    const t = this.o.now()
    return this.racers
      .filter((r) => r.kind !== 'remote')
      .map((r) => ({
        id: r.d.id,
        x: Math.round(r.x * 100) / 100,
        z: Math.round(r.z * 100) / 100,
        h: Math.round(r.heading * 1000) / 1000,
        s: Math.round(r.speed * 10) / 10,
        d: r.driftDir,
        b: r.boost > 0 || r.magnet > 0 ? 1 : 0,
        p: Math.round(this.progress(r)),
        l: r.lap,
        c: r.cp,
        f: r.finish,
        e: this.bits(r),
        t,
      }))
  }

  /** Bouton Objet (tactile) : utilise l'objet en main. */
  useItem() {
    this.useBtn = true
  }

  private hazardMesh(hz: Hazard): THREE.Object3D {
    if (hz.type === 'ball') {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 12), new THREE.MeshLambertMaterial({ color: '#7B2CBF', emissive: '#3c0f66' }))
      m.position.y = 0.9
      return m
    }
    if (hz.type === 'butter') {
      const geo = new THREE.BoxGeometry(2.4, 0.6, 1.5)
      const m = new THREE.Mesh(geo, toon('#FFE066'))
      m.add(outline(geo, 1.08))
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.14, 1.52), toon('#FFF6C2'))
      top.position.set(-0.4, 0.28, 0)
      m.add(top)
      m.position.set(hz.x, 0.36, hz.z)
      m.rotation.y = -hz.h
      return m
    }
    if (hz.type === 'hen') {
      const g = new THREE.Group()
      const put = (geo: THREE.BufferGeometry, color: string, x: number, y: number, z: number, ink = false) => {
        const m = new THREE.Mesh(geo, toon(color))
        m.position.set(x, y, z)
        if (ink) m.add(outline(geo, 1.08))
        g.add(m)
        return m
      }
      const body = new THREE.SphereGeometry(0.85, 12, 10)
      body.scale(1.15, 1, 0.9)
      put(body, '#FFFFFF', 0, 0.95, 0, true)
      put(new THREE.SphereGeometry(0.45, 10, 8), '#FFFFFF', 0.75, 1.75, 0, true)
      put(new THREE.SphereGeometry(0.2, 8, 6), '#E63946', 0.75, 2.2, 0)
      put(new THREE.ConeGeometry(0.16, 0.4, 6), '#FF8C42', 1.25, 1.7, 0).rotation.z = -Math.PI / 2
      put(new THREE.SphereGeometry(0.4, 8, 6), '#F1F1F1', -0.95, 1.25, 0)
      for (const z of [-0.3, 0.3]) put(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 5), '#FF8C42', 0, 0.25, z)
      g.scale.setScalar(1.35)
      return g
    }
    const m = new THREE.Mesh(new THREE.CircleGeometry(2.1, 20), new THREE.MeshBasicMaterial({ color: '#E0A526' }))
    m.rotation.x = -Math.PI / 2
    m.position.set(hz.x, 0.07, hz.z)
    return m
  }

  /** Pièges / projectiles et effets du state serveur. */
  syncItems(hazards: Hazard[], fx: Fx[]) {
    const live = new Set<number>()
    for (const hz of hazards) {
      live.add(hz.id)
      if (this.hazards.has(hz.id)) continue
      const mesh = this.hazardMesh(hz)
      this.scene.add(mesh)
      this.hazards.set(hz.id, {
        hz, at: Date.parse(hz.at), mesh, gone: false,
        ball: hz.type === 'ball' ? new BallSim(hz) : null,
        i0: hz.type === 'hen' ? this.track.locate(hz.x, hz.z).i : 0,
      })
    }
    for (const [id, v] of this.hazards) {
      if (!live.has(id)) {
        this.scene.remove(v.mesh)
        this.hazards.delete(id)
      }
    }
    const now = this.o.now()
    for (const f of fx) {
      if (this.seenFx.has(f.id)) continue
      this.seenFx.add(f.id)
      const left = (Date.parse(f.until) - now) / 1000
      if (f.type === 'honk' && left > 0) {
        // l'onde part du klaxonneur (une seule fois, même s'il touche plusieurs karts)
        const key = `${f.by}|${f.until}`
        const by = this.byId.get(f.by)
        if (by && !this.seenHonk.has(key)) {
          this.seenHonk.add(key)
          this.ring(by.x, by.z)
        }
      }
      const r = this.byId.get(f.target)
      if (!r || r.kind === 'remote' || left <= 0 || r.finish !== null) continue
      if (!this.protect(r)) continue
      if (f.type === 'cloud') r.slow = Math.max(r.slow, left)
      else if (f.type === 'honk') this.slide(r, 1.2, 0.55)
      else if (r.kind === 'bot') r.slow = Math.max(r.slow, 1)
      else if (f.type === 'confetti') r.confetti = Math.max(r.confetti, left)
      else r.reverse = Math.max(r.reverse, left)
      if (r === this.me) this.sfx.hit()
    }
  }

  /** Bouclier arc-en-ciel : intouchable. Bulle : absorbe le coup. Renvoie true si le coup porte. */
  private protect(r: Racer) {
    if (r.star > 0) return false
    if (r.bubble > 0) {
      r.bubble = 0
      if (r === this.me) this.sfx.pop()
      return false
    }
    return true
  }

  /** Tête-à-queue. */
  private spinOut(r: Racer, keep: number) {
    r.spin = SPIN
    r.speed *= keep
    r.driftDir = 0
    r.charge = 0
    r.safe = 1.6
    if (r === this.me) {
      this.sfx.hit()
      this.shake = Math.max(this.shake, 0.6)
    }
  }

  /** Glissade : plus de direction pendant `t` secondes. */
  private slide(r: Racer, t: number, keep: number) {
    r.slip = Math.max(r.slip, t)
    r.speed *= keep
    r.driftDir = 0
    r.charge = 0
    if (r === this.me) this.sfx.splash()
  }

  /** Gerbe de particules (choc, plumes, éclaboussures). */
  private burst(x: number, z: number, color: string, n: number, y = 0.5) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2
      const v = 3 + Math.random() * 6
      this.dust.emit(x, y, z, Math.cos(a) * v, 2 + Math.random() * 4, Math.sin(a) * v, color, 0.5 + Math.random() * 0.4)
    }
  }

  /** Onde du Klaxon de tracteur. */
  private ring(x: number, z: number) {
    const geo = new THREE.RingGeometry(0.86, 1, 40)
    geo.rotateX(-Math.PI / 2)
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#FFD23F', transparent: true, depthWrite: false, side: THREE.DoubleSide }))
    mesh.position.set(x, 0.5, z)
    this.scene.add(mesh)
    this.rings.push({ mesh, t: 0 })
    const m = this.me ?? this.racers[0]
    if ((m.x - x) ** 2 + (m.z - z) ** 2 < 70 * 70) this.sfx.honk()
  }

  private fire(r: Racer) {
    const it = r.item
    if (!it || r.roll > 0 || r.spin > 0) return
    r.item = null
    const isMe = r === this.me
    const cx = Math.cos(r.heading)
    const cz = Math.sin(r.heading)
    const rank = this.ranking()
    const pos = rank.indexOf(r)
    const round = (v: number) => Math.round(v * 100) / 100
    const behind = () => ({ x: round(r.x - cx * 3.5), z: round(r.z - cz * 3.5), h: round(r.heading) })
    if (it === 'turbo') r.boost = Math.max(r.boost, 2)
    else if (it === 'star') r.star = 5
    else if (it === 'bubble') r.bubble = 15
    else if (it === 'magnet') {
      r.magnet = 4
      if (isMe) this.sfx.zap()
    } else if (it === 'ball') this.o.onUse?.(r.d.id, { item: 'ball', x: round(r.x + cx * 3), z: round(r.z + cz * 3), h: round(r.heading) })
    else if (it === 'glue' || it === 'butter' || it === 'hen') this.o.onUse?.(r.d.id, { item: it, ...behind() })
    else if (it === 'honk') {
      const ids = this.racers.filter((x) => x !== r && x.finish === null && (x.x - r.x) ** 2 + (x.z - r.z) ** 2 < HONK_RANGE ** 2).map((x) => x.d.id)
      if (ids.length) this.o.onUse?.(r.d.id, { item: 'honk', targets: ids })
      // personne à portée : on klaxonne dans le vide
      else this.ring(r.x, r.z)
    } else {
      const ahead = rank.slice(0, pos).filter((x) => x.finish === null)
      const behindMe = rank.slice(pos + 1)
      const targets =
        it === 'cloud' ? ahead : it === 'confetti' ? [ahead[ahead.length - 1] ?? behindMe[0]] : [ahead[0] ?? behindMe[0]]
      const ids = targets.filter(Boolean).map((x) => x.d.id)
      if (ids.length) this.o.onUse?.(r.d.id, { item: it, targets: ids })
    }
    if (isMe && it !== 'magnet') this.sfx.launch()
  }

  private moverLat(m: Mover) {
    return m.amp * Math.sin(Math.PI * 2 * (this.nowMs / 1000 / m.period + m.phase))
  }

  /** Objets : roulette, usage par les bots, boîtes, pièges, obstacles du circuit, minuteurs d'effets. */
  private updateItems(dt: number, now: number) {
    const rank = this.ranking()
    const lead = this.progress(rank[0])
    for (const r of this.racers) {
      if (r.kind === 'remote') continue
      for (const k of TIMERS) r[k] = Math.max(0, r[k] - dt)
      // coup de pouce aux retardataires : jusqu'à +7 % de vitesse quand on est loin du 1er
      const gap = (lead - this.progress(r)) * (this.track.geo.len / this.track.n)
      r.catchup = r.finish === null ? clamp((gap - 90) / 450, 0, 1) * 0.07 : 0
      // aspiration : rester 0,6 s dans le sillage d'un kart
      let wake = false
      const hx = Math.cos(r.heading)
      const hz = Math.sin(r.heading)
      for (const q of this.racers) {
        if (q === r || q.speed < 15) continue
        const dx = q.x - r.x
        const dz = q.z - r.z
        const d2 = dx * dx + dz * dz
        if (d2 > 9 && d2 < 15 * 15 && dx * hx + dz * hz > 0.93 * Math.sqrt(d2)) wake = true
      }
      r.draft = wake ? Math.min(1.4, r.draft + dt) : Math.max(0, r.draft - dt * 2)
      if (r.roll > 0) {
        r.roll -= dt
        if (r.roll <= 0) {
          r.item = rollItem(rank.indexOf(r) + 1, rank.length)
          r.hold = 1 + Math.random() * 3
          if (r === this.me) this.sfx.pick()
        }
      } else if (r.item && r.finish === null) {
        if (r === this.me && !this.o.autopilot) {
          if (this.useBtn) this.fire(r)
        } else {
          r.hold -= dt
          if (r.hold <= 0) this.fire(r)
        }
      }
      // boîtes
      if (!r.item && r.roll <= 0 && r.finish === null) {
        for (const b of this.boxes) {
          if (b.until > now) continue
          if ((r.x - b.x) ** 2 + (r.z - b.z) ** 2 < 5.5) {
            b.until = now + 5000
            r.roll = 1.2
            if (r === this.me) this.sfx.box()
            break
          }
        }
      }
    }
    this.useBtn = false

    for (const b of this.boxes) {
      b.mesh.visible = b.until <= now
      b.mesh.rotation.y += dt * 1.5
      b.mesh.position.y = 1.3 + Math.sin(now / 300 + b.x) * 0.15
    }

    // pièges et projectiles
    const tr = this.track
    for (const v of this.hazards.values()) {
      const age = (now - v.at) / 1000
      const type = v.hz.type
      let hx = v.hz.x
      let hz = v.hz.z
      if (v.ball) {
        v.ball.advance(tr, Math.max(0, age))
        hx = v.ball.x
        hz = v.ball.z
        v.mesh.position.set(hx, 0.9, hz)
        v.mesh.rotation.z -= dt * 8
      } else if (type === 'hen') {
        // la poule traverse la piste en zigzag (même trajet sur tous les téléphones)
        const ph = age * 1.7 + v.hz.id
        ;[hx, hz] = tr.pointAt(v.i0, Math.sin(ph) * tr.hw[v.i0] * 0.75)
        v.mesh.position.set(hx, Math.abs(Math.sin(age * 9)) * 0.35, hz)
        v.mesh.rotation.y = -Math.atan2(tr.tx[v.i0], -tr.tz[v.i0]) + (Math.cos(ph) < 0 ? Math.PI : 0)
      }
      const dead = v.gone || (v.ball ? v.ball.dead : age > (type === 'hen' ? HEN_LIFE : 30))
      v.mesh.visible = !dead && age >= 0
      if (dead || age < 0) continue
      for (const r of this.racers) {
        if (r.kind === 'remote' || r.finish !== null || r.spin > 0 || r.air > 0) continue
        // son propre objet ne touche qu'après un court délai
        if (r.d.id === v.hz.owner && age < (v.ball ? 0.6 : 1.5)) continue
        if ((r.x - hx) ** 2 + (r.z - hz) ** 2 > (v.ball ? 4 : 5.3)) continue
        v.gone = true
        this.o.onHit?.(r.d.id, v.hz.id)
        if (type === 'hen') {
          this.burst(hx, hz, '#FFFFFF', 14, 1)
          if ((this.camPos.x - hx) ** 2 + (this.camPos.z - hz) ** 2 < 60 * 60) this.sfx.cluck()
        }
        if (this.protect(r)) {
          if (type === 'butter') this.slide(r, 1.8, 0.75)
          else this.spinOut(r, 0.3)
        }
        break
      }
    }

    // obstacles mobiles du circuit
    for (const m of tr.movers) {
      const lat = this.moverLat(m)
      const [mx, mz] = tr.pointAt(m.i, lat)
      m.mesh.position.set(mx, 0, mz)
      const body = m.mesh.userData.body as THREE.Group
      const dir = Math.cos(Math.PI * 2 * (this.nowMs / 1000 / m.period + m.phase)) < 0 ? -1 : 1
      if (m.roll) body.rotation.z = -lat / 1.45
      else {
        body.rotation.y = dir < 0 ? Math.PI : 0
        body.position.y = Math.abs(Math.sin(this.nowMs / 90 + m.i)) * 0.08
      }
      for (const r of this.racers) {
        if (r.kind === 'remote' || r.finish !== null || r.spin > 0 || r.air > 0 || r.safe > 0) continue
        if ((r.x - mx) ** 2 + (r.z - mz) ** 2 > 2.5 * 2.5) continue
        this.burst(mx, mz, tr.def.colors.kerbA, 8, 1)
        if (this.protect(r)) this.spinOut(r, 0.35)
        else r.safe = 1
      }
    }
    // flaques : glissade
    for (const p of tr.puddles) {
      for (const r of this.racers) {
        if (r.kind === 'remote' || r.finish !== null || r.slip > 0 || r.spin > 0 || r.air > 0 || r.star > 0) continue
        if ((r.x - p.x) ** 2 + (r.z - p.z) ** 2 > (PUDDLE_R + 0.5) ** 2) continue
        this.slide(r, 0.9, 0.9)
        this.burst(r.x, r.z, tr.def.colors.puddle, 8, 0.3)
      }
    }
    // ondes de klaxon
    for (let k = this.rings.length - 1; k >= 0; k--) {
      const g = this.rings[k]
      g.t += dt
      const f = g.t / 0.55
      g.mesh.scale.setScalar(1 + f * (HONK_RANGE - 1))
      ;(g.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - f)
      if (f >= 1) {
        this.scene.remove(g.mesh)
        g.mesh.geometry.dispose()
        this.rings.splice(k, 1)
      }
    }
  }

  /** Paquet reçu d'un autre téléphone. */
  applyRemote(s: KartSnap) {
    const r = this.byId.get(s.id)
    if (!r || r.kind !== 'remote') return
    const buf = r.buf
    if (buf.length && s.t <= buf[buf.length - 1].t) return
    buf.push(s)
    if (buf.length > 10) buf.shift()
    r.netP = s.p
    r.finish = s.f
    r.e = s.e ?? 0
    if (typeof s.l === 'number') r.lap = s.l
    if (typeof s.c === 'number') r.cp = s.c
  }

  /**
   * Ce téléphone conduit-il les bots ? (le premier joueur présent, cf. Play).
   * Reprise : on part du dernier état reçu (position, cap, vitesse, tour, checkpoint).
   * Abandon : les bots redeviennent distants et suivent les paquets du nouveau conducteur.
   */
  setBotDriver(on: boolean) {
    for (const id of this.o.botIds ?? []) {
      const r = this.byId.get(id)
      if (!r || r.kind === 'me' || (on ? r.kind === 'bot' : r.kind === 'remote')) continue
      if (on) {
        const last = r.buf[r.buf.length - 1]
        if (last) {
          r.x = last.x
          r.z = last.z
          r.heading = last.h
          r.speed = last.s
        }
        // repris sur le raccourci : le kart est ramené sur la piste par le mur le plus proche
        r.idx = this.track.locate(r.x, r.z, -1).i
        r.lat = this.track.locate(r.x, r.z, r.idx).lat
        r.cut = -1
        r.driftDir = 0
        r.charge = 0
        r.kind = 'bot'
      } else {
        r.netP = this.progress(r)
        r.kind = 'remote'
      }
      r.buf = []
    }
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
    window.removeEventListener('keydown', this.onKey)
    window.removeEventListener('keyup', this.onKey)
    this.sfx.stop()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  /** Poussière hors piste, fumée et étincelles de dérapage, gerbe du turbo (près de la caméra seulement). */
  private emitFx(r: Racer, lift: number) {
    if (lift > 0.3 || r.speed < 6) return
    const cam = this.camPos
    if ((r.x - cam.x) ** 2 + (r.z - cam.z) ** 2 > 90 * 90) return
    const h = r.heading + r.yaw
    const cx = Math.cos(h)
    const cz = Math.sin(h)
    const rand = (s: number) => (Math.random() - 0.5) * s
    for (const side of [-1, 1]) {
      const wx = r.x - cx * 0.95 - cz * side * 0.82
      const wz = r.z - cz * 0.95 + cx * side * 0.82
      const back = -r.speed * 0.15
      if (r.off && r.star <= 0) {
        if (Math.random() < 0.6) this.dust.emit(wx, 0.3, wz, cx * back + rand(2), 1 + Math.random(), cz * back + rand(2), this.track.def.colors.ground, 0.7)
      } else if (r.driftDir) {
        if (Math.random() < 0.5) this.dust.emit(wx, 0.25, wz, cx * back + rand(1.5), 0.8, cz * back + rand(1.5), '#D9D9E3', 0.5)
        const lvl = r.kind === 'remote' ? 2 : DRIFT_LEVELS.filter((v) => r.charge >= v).length
        if (lvl) this.glow.emit(wx, 0.2, wz, rand(5) - cx * 3, 1.5 + Math.random() * 2, rand(5) - cz * 3, SPARKS[lvl - 1], 0.35)
      }
    }
    if (r.boost > 0 && Math.random() < 0.8) {
      this.glow.emit(r.x - cx * 1.9, 0.7, r.z - cz * 1.9, -cx * 6 + rand(2), rand(1.5), -cz * 6 + rand(2), Math.random() < 0.5 ? '#FFB627' : '#FF5A1F', 0.3)
    }
    // aimant : étincelles roses devant le kart ; aspiration : filets d'air
    if (r.magnet > 0 && Math.random() < 0.7) this.glow.emit(r.x + cx * 2.4 + rand(1.5), 0.6 + Math.random(), r.z + cz * 2.4 + rand(1.5), cx * 14, rand(1), cz * 14, '#FF4FA3', 0.25)
    if (r.draft > 0.6 && r === this.me && Math.random() < 0.5) this.glow.emit(r.x + cx * 4 + rand(5), 0.4 + Math.random() * 1.8, r.z + cz * 4 + rand(5), -cx * 16, 0, -cz * 16, '#9FDCFF', 0.22)
  }

  private makeKart(d: Driver, loader: THREE.TextureLoader) {
    const k = buildKart(d.color, d.sprite, d.kart ?? 0, loader)
    return {
      mesh: k.root, chassis: k.chassis, wheels: k.wheels, steerPivots: k.steer, shadow: k.shadow,
      sparks: k.sparks, flame: k.flame, body: k.bodyMat, bubbleMesh: k.bubbleMesh, cloudMesh: k.cloudMesh,
    }
  }

  private resize() {
    const w = this.el.clientWidth || 1
    const h = this.el.clientHeight || 1
    this.renderer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  private onKey = (e: KeyboardEvent) => {
    // on écrit dans le chat (ou un autre champ) : le clavier ne pilote pas le kart
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
      this.keys.clear()
      return
    }
    if (e.type === 'keydown') this.keys.add(e.code)
    else this.keys.delete(e.code)
    if (e.type === 'keydown' && !e.repeat && (e.code === 'Enter' || e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyE')) this.useBtn = true
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault()
  }

  private onPointer = (e: PointerEvent) => {
    if (e.type === 'pointerdown') {
      this.pointer = { id: e.pointerId, steer: 0 }
      this.sfx.start()
    }
    if (!this.pointer || this.pointer.id !== e.pointerId) return
    const rect = this.el.getBoundingClientRect()
    // doigt à gauche/droite du centre : on tourne, d'autant plus fort qu'on s'en éloigne
    // (petite zone neutre au milieu : un doigt posé au centre ne fait pas zigzaguer)
    const v = (e.clientX - rect.left - rect.width / 2) / (rect.width * 0.26)
    this.pointer.steer = Math.abs(v) < 0.12 ? 0 : clamp(v - Math.sign(v) * 0.12, -1, 1)
  }

  private onPointerUp = (e: PointerEvent) => {
    if (this.pointer?.id === e.pointerId) this.pointer = null
  }

  private input() {
    const k = this.keys
    let steer = this.pointer?.steer ?? 0
    if (k.has('ArrowLeft') || k.has('KeyQ') || k.has('KeyA')) steer = -1
    if (k.has('ArrowRight') || k.has('KeyD')) steer = 1
    if (this.me && this.me.reverse > 0) steer = -steer
    return { steer, drift: this.driftBtn || k.has('Space'), brake: k.has('ArrowDown') || k.has('KeyS') }
  }

  /** Choc contre un mur : on perd de la vitesse selon l'angle, le kart est renvoyé dans l'axe de la piste. */
  private hitWall(r: Racer, along: number, dt: number) {
    const diff = angDiff(along, r.heading)
    if (r.wallT <= 0 && r.speed > 14) {
      const hit = Math.abs(Math.sin(diff))
      r.speed *= 1 - 0.45 * hit
      r.heading += diff * 0.5
      if (hit > 0.25) {
        r.driftDir = 0
        r.charge = 0
        this.burst(r.x, r.z, '#FFFFFF', 5)
      }
      if (r === this.me) {
        this.sfx.bump()
        this.shake = Math.max(this.shake, 0.15 + hit * 0.5)
      }
    }
    r.wallT = 0.3
    r.speed *= 1 - 1.5 * dt
    r.heading += diff * 3 * dt
  }

  /** Repère le kart sur la piste ou sur le raccourci, et l'empêche de traverser les murs. */
  private place(r: Racer, dt: number) {
    const tr = this.track
    const cut = tr.cut
    if (cut && r.cut >= 0) {
      const c = tr.locateCut(r.x, r.z)
      const m = c.j > cut.m / 2 ? tr.locateRange(r.x, r.z, cut.iB - 84, cut.iB + 14) : tr.locateRange(r.x, r.z, cut.iA - 14, cut.iA + 84)
      const mOk = m.d2 - m.lat * m.lat < 9
      const onMain = mOk && Math.abs(m.lat) <= tr.hw[m.i]
      const inMain = mOk && Math.abs(m.lat) <= tr.hw[m.i] + WALL_MARGIN
      const onCut = !c.out && Math.abs(c.lat) <= cut.half
      if ((onMain && !onCut) || (c.out && inMain)) {
        // retour sur la piste
        r.cut = -1
        r.idx = m.i
        r.lat = m.lat
        r.off = !onMain
        return
      }
      r.cut = c.j
      r.idx = tr.cutIndex(c.j)
      r.lat = c.lat
      r.off = !onCut && !onMain
      const wall = cut.half + CUT_MARGIN
      if ((Math.abs(c.lat) > wall || c.out) && !inMain) {
        // on garde l'avancée le long du chemin (sinon le kart resterait collé au mur)
        const lat = clamp(c.lat, -wall, wall)
        const along = c.out ? 0 : (r.x - cut.x[c.j]) * cut.tx[c.j] + (r.z - cut.z[c.j]) * cut.tz[c.j]
        r.x = cut.x[c.j] - cut.tz[c.j] * lat + cut.tx[c.j] * along
        r.z = cut.z[c.j] + cut.tx[c.j] * lat + cut.tz[c.j] * along
        this.hitWall(r, Math.atan2(cut.tz[c.j], cut.tx[c.j]), dt)
      }
      return
    }
    const loc = tr.locate(r.x, r.z, r.idx)
    r.idx = loc.i
    r.lat = loc.lat
    const h = tr.hw[loc.i]
    r.off = Math.abs(loc.lat) > h
    let free = false
    if (cut && r.off && tr.nearCut(loc.i)) {
      const c = tr.locateCut(r.x, r.z)
      if (!c.out && Math.abs(c.lat) <= cut.half) {
        // on s'engage sur le raccourci
        r.off = false
        free = true
        if (r.kind === 'me' || r.cutter) {
          r.cut = c.j
          r.idx = tr.cutIndex(c.j)
          return
        }
      } else free = !c.out && Math.abs(c.lat) <= cut.half + CUT_MARGIN
    }
    const wall = h + WALL_MARGIN
    if (Math.abs(r.lat) > wall && !free) {
      // on garde l'avancée le long de la piste (sinon le kart resterait collé au mur)
      const k = r.idx
      const along = (r.x - tr.px[k]) * tr.tx[k] + (r.z - tr.pz[k]) * tr.tz[k]
      r.lat = clamp(r.lat, -wall, wall)
      const [wx, wz] = tr.pointAt(k, r.lat)
      r.x = wx + tr.tx[k] * along
      r.z = wz + tr.tz[k] * along
      this.hitWall(r, Math.atan2(tr.tz[r.idx], tr.tx[r.idx]), dt)
    }
  }

  private step(r: Racer, steer: number, drift: boolean, brake: boolean, dt: number) {
    const tr = this.track
    const isMe = r === this.me
    const human = isMe && !this.o.autopilot && r.finish === null
    const off = r.off && r.star <= 0 && r.air <= 0
    let max = (off ? (r.cut >= 0 ? OFFROAD_CUT : OFFROAD) : MAX) * (r.kind === 'bot' ? r.skill : 1) * (1 + r.catchup)
    if (r.draft > 0.6 && !off) max += 2.5
    if (r.boost > 0) {
      r.boost -= dt
      max = BOOST
    }
    if (r.magnet > 0 && !off) max = Math.max(max, MAGNET)
    if (r.star > 0) max = Math.max(max, BOOST * 0.92)
    if (r.slow > 0) max *= 0.55
    if (r.slip > 0) {
      // ça glisse : le kart zigzague tout seul, plus de dérapage
      max *= 0.85
      steer = Math.sin(this.time * 13 + r.skill * 40) * 0.5
      drift = false
      r.driftDir = 0
      r.charge = 0
    }
    if (r.spin > 0) {
      // tête-à-queue : un tour complet amorti, plus de contrôle, on ralentit fort
      max = 0
      steer = 0
      drift = false
      const p = 1 - r.spin / SPIN
      r.spinA = Math.PI * 2 * (1 - (1 - p) * (1 - p))
    } else r.spinA = 0
    // aide à la conduite : sans toucher l'écran, le kart revient doucement vers la piste et se remet dans l'axe
    // (pas assez fort pour prendre un virage serré à fond : il faut quand même tourner)
    let assist = 0
    if (human && Math.abs(steer) < 0.05 && r.spin <= 0 && r.slip <= 0 && r.air <= 0 && r.cut < 0 && !r.driftDir) {
      const a = tr.wrap(r.idx + 9)
      const keep = tr.hw[a] * 0.6
      const [ax, az] = tr.pointAt(a, clamp(r.lat, -keep, keep))
      assist = clamp(angDiff(Math.atan2(az - r.z, ax - r.x), r.heading) * 1.8, -0.55, 0.55)
    }
    // direction progressive (plus de coups de volant secs)
    r.steerS += (steer - r.steerS) * Math.min(1, dt * 9)
    steer = r.steerS
    if (brake || r.finish !== null) max = r.finish !== null ? 8 : 0
    const rate = r.speed < max ? (r.boost > 0 || r.star > 0 || r.magnet > 0 ? 45 : 14) : r.spin > 0 ? 40 : 26
    r.speed += Math.sign(max - r.speed) * Math.min(Math.abs(max - r.speed), rate * dt)

    // dérapage automatique (mon kart) : on tourne franchement un instant -> la glisse part toute seule ;
    // on redresse (ou on lâche le doigt) -> fin de glisse et mini-turbo. Espace = dérapage manuel au clavier.
    if (isMe) {
      r.autoT = Math.abs(steer) > 0.55 && r.speed > 14 && !off ? r.autoT + dt : 0
      drift = drift || (r.driftDir ? steer * r.driftDir > 0.3 : r.autoT > 0.3)
    }
    // la glisse charge un mini-turbo tant qu'elle dure
    if (!r.driftDir && drift && Math.abs(steer) > 0.25 && r.speed > 14 && !off && r.air <= 0) {
      r.driftDir = Math.sign(steer)
      r.charge = 0
      // petit sursaut au départ de la glisse
      r.kick = 0.22
    }
    if (r.driftDir) {
      if (!drift || r.speed < 10) {
        const lvl = DRIFT_LEVELS.filter((v) => r.charge >= v).length
        if (lvl) {
          r.boost = Math.max(r.boost, DRIFT_BOOST[lvl])
          if (isMe) {
            this.sfx.boost(lvl)
            this.shake = Math.max(this.shake, 0.12 * lvl)
          }
        }
        r.driftDir = 0
        r.charge = 0
      } else {
        r.charge += dt * (0.55 + 0.65 * Math.max(0, steer * r.driftDir))
      }
    }
    const grip = clamp(r.speed / 12, 0, 1)
    // un peu moins vif à pleine vitesse, plus stable
    const omega = r.driftDir ? r.driftDir * 1.1 + steer * 0.7 : steer * 1.7 * (1 - 0.2 * clamp(r.speed / MAX, 0, 1))
    r.heading += (omega + assist) * grip * dt
    r.x += Math.cos(r.heading) * r.speed * dt
    r.z += Math.sin(r.heading) * r.speed * dt

    this.place(r, dt)
    const main = r.cut < 0
    if (main && !r.off && tr.isBoost(r.idx) && r.boost < 1) {
      if (isMe && r.boost <= 0) this.sfx.boost(1)
      r.boost = 1
    }
    // tremplin : saut si on arrive vite ; bosse : petit saut
    if (r.air > 0) {
      r.air = Math.max(0, r.air - dt)
      if (r.air === 0 && r.airMax === AIR) {
        // atterrissage
        r.kick = 0.2
        this.burst(r.x, r.z, '#FFFFFF', 6, 0.3)
        if (isMe) {
          this.sfx.bump()
          this.shake = Math.max(this.shake, 0.3)
        }
      }
    } else if (main && tr.isJump(r.idx) && r.speed > 15) {
      r.air = r.airMax = AIR
      if (isMe) this.sfx.jump()
    } else if (main && tr.isBump(r.idx) && r.speed > 12) {
      r.air = r.airMax = HOP
      if (isMe) this.sfx.hop()
    }
    // checkpoints et tours (le 1er passage de la ligne = départ, pas un tour bouclé)
    const c = Math.floor((r.idx / tr.n) * CHECKPOINTS)
    if (c === (r.cp + 1) % CHECKPOINTS) {
      r.cp = c
      if (c === 0) {
        r.lap++
        const completed = r.lap - 1
        if (completed >= 1) this.o.onLap?.(r.d.id, completed)
        if (completed >= this.o.laps && r.finish === null) r.finish = this.time
        else if (isMe && completed >= 1) this.sfx.lap()
      }
    }
  }

  /** Kart distant : position interpolée entre deux paquets, extrapolée brièvement si le réseau traîne. */
  private follow(r: Racer, now: number) {
    const buf = r.buf
    if (!buf.length) return
    const rt = now - INTERP_DELAY
    let a = buf[0]
    let b: KartSnap | null = null
    for (let k = 0; k < buf.length; k++) {
      if (buf[k].t <= rt) a = buf[k]
      else {
        b = buf[k]
        break
      }
    }
    if (b && b !== a && rt >= a.t) {
      const f = (rt - a.t) / (b.t - a.t)
      r.x = a.x + (b.x - a.x) * f
      r.z = a.z + (b.z - a.z) * f
      r.heading = a.h + angDiff(b.h, a.h) * f
      r.speed = a.s + (b.s - a.s) * f
    } else {
      const last = b ?? a
      const ahead = clamp((rt - last.t) / 1000, 0, 0.4)
      r.x = last.x + Math.cos(last.h) * last.s * ahead
      r.z = last.z + Math.sin(last.h) * last.s * ahead
      r.heading = last.h
      r.speed = last.s
    }
    const cur = b && rt < b.t ? a : buf[buf.length - 1]
    r.driftDir = cur.d
    r.boost = cur.b ? 0.2 : 0
    r.e = cur.e ?? 0
    const tr = this.track
    let loc = tr.locate(r.x, r.z, r.idx)
    // loin de la piste (raccourci, paquet perdu) : on le recherche sur tout le circuit
    if (loc.d2 > (tr.hw[loc.i] + WALL_MARGIN + 3) ** 2) loc = tr.locate(r.x, r.z)
    r.idx = loc.i
    r.lat = loc.lat
    r.off = Math.abs(loc.lat) > tr.hw[loc.i]
    if (r.off && tr.cut && tr.nearCut(loc.i)) {
      const c = tr.locateCut(r.x, r.z)
      if (!c.out && Math.abs(c.lat) <= tr.cut.half) r.off = false
    }
  }

  private botInput(r: Racer) {
    const tr = this.track
    const cut = tr.cut
    let tx: number
    let tz: number
    if (cut && r.cut >= 0) {
      // sur le raccourci : on le suit, puis on vise la piste à sa sortie
      const j = r.cut + 6
      if (j < cut.m) {
        tx = cut.x[j]
        tz = cut.z[j]
      } else [tx, tz] = tr.pointAt(cut.iB + 6, 0)
    } else if (cut && (r.kind === 'me' ? this.o.autoCut : r.cutter) && tr.wrap(r.idx - this.cutEntry0 + 14) < tr.wrap(this.cutEntry - this.cutEntry0 + 14)) {
      // un bon bot prend le raccourci
      const j = Math.min(cut.m - 1, 12)
      tx = cut.x[j]
      tz = cut.z[j]
    } else {
      const a = tr.wrap(r.idx + 9)
      const h = tr.hw[a]
      let lat = clamp(r.botLat, -h * 0.7, h * 0.7)
      // il se place du bon côté avant l'entrée
      if (cut && (r.kind === 'me' ? this.o.autoCut : r.cutter) && tr.wrap(r.idx - this.cutEntry0 + 50) < 36) lat = this.cutSide * h * 0.55
      // évite l'obstacle mobile qui arrive en face
      for (const m of tr.movers) {
        const ahead = tr.wrap(m.i - r.idx)
        if (ahead < 2 || ahead > 26) continue
        const ml = this.moverLat(m)
        if (Math.abs(ml - lat) < 4.5) lat = clamp(ml > 0 ? ml - 6 : ml + 6, -h * 0.85, h * 0.85)
      }
      ;[tx, tz] = tr.pointAt(a, lat)
    }
    const want = Math.atan2(tz - r.z, tx - r.x)
    return clamp(angDiff(want, r.heading) * 2.5, -1, 1)
  }

  private progress(r: Racer) {
    if (r.kind === 'remote') return r.netP
    const n = this.track.n
    const idx = r.cp === CHECKPOINTS - 1 && r.idx < n / 4 ? r.idx + n : r.cp === 0 && r.idx > (n * 3) / 4 ? r.idx - n : r.idx
    return (r.lap - 1) * n + (r.lap === 0 ? idx - n : idx)
  }

  private ranking() {
    return [...this.racers].sort((a, b) => {
      if (a.finish !== null || b.finish !== null) return (a.finish ?? Infinity) - (b.finish ?? Infinity)
      return this.progress(b) - this.progress(a)
    })
  }

  /** Karts qui se touchent : ils se poussent, échangent un peu de vitesse ; un kart invincible envoie l'autre en tête-à-queue. */
  private collide() {
    for (let a = 0; a < this.racers.length; a++) {
      for (let b = a + 1; b < this.racers.length; b++) {
        const A = this.racers[a]
        const B = this.racers[b]
        const la = A.kind !== 'remote'
        const lb = B.kind !== 'remote'
        if (!la && !lb) continue
        const dx = B.x - A.x
        const dz = B.z - A.z
        const d = Math.hypot(dx, dz)
        if (d < 0.01 || d >= 2.2 || A.air > 0.1 || B.air > 0.1) continue
        // seuls les karts simulés ici bougent
        const p = ((2.2 - d) / d) * (la && lb ? 0.5 : 1)
        if (la) {
          A.x -= dx * p
          A.z -= dz * p
        }
        if (lb) {
          B.x += dx * p
          B.z += dz * p
        }
        const starA = A.kind === 'remote' ? (A.e & E_STAR) !== 0 : A.star > 0
        const starB = B.kind === 'remote' ? (B.e & E_STAR) !== 0 : B.star > 0
        for (const [me, other, mine, star] of [[A, B, la, starB], [B, A, lb, starA]] as const) {
          if (!mine || me.finish !== null) continue
          if (star && me.star <= 0 && me.safe <= 0 && me.spin <= 0) {
            if (this.protect(me)) this.spinOut(me, 0.4)
            else me.safe = 1
            continue
          }
          if (me.bumpT > 0) continue
          me.bumpT = 0.35
          const rel = other.speed - me.speed
          me.speed += rel * 0.35
          if (me === this.me && Math.abs(rel) > 2.5) {
            this.sfx.bump()
            this.shake = Math.max(this.shake, 0.22)
            this.burst((A.x + B.x) / 2, (A.z + B.z) / 2, '#FFD23F', 5, 0.8)
          }
        }
      }
    }
  }

  private frame = (stamp: number) => {
    this.raf = requestAnimationFrame(this.frame)
    if (!this.last) this.last = stamp
    const dt = Math.min(0.05, (stamp - this.last) / 1000)
    this.last = stamp
    const now = this.o.now()
    this.nowMs = now
    const left = this.o.goAt - now

    if (this.phase === 'countdown') {
      const count = clamp(Math.ceil(left / 1000), 0, 3)
      if (count !== this.count) {
        if (this.count !== -1 || count <= 3) this.sfx.beep(count === 0)
        this.count = count
      }
      if (left <= 0) this.phase = 'racing'
    } else {
      this.time = Math.max(0, -left / 1000)
      const inp = this.input()
      for (const r of this.racers) {
        if (r.kind === 'remote') this.follow(r, now)
        else if (r.kind === 'bot' || r.finish !== null || this.o.autopilot) this.step(r, this.botInput(r), false, false, dt)
        else this.step(r, inp.steer, inp.drift, inp.brake, dt)
      }
      this.collide()
      if (this.phase === 'racing' && this.me?.finish != null) this.phase = 'finished'
    }
    // les obstacles du circuit bougent dès le décompte
    this.updateItems(this.phase === 'countdown' ? 0 : dt, now)

    const t = stamp / 1000
    for (const r of this.racers) {
      const e = r.kind === 'remote' ? r.e : this.bits(r)
      if (r.kind === 'remote') {
        // tête-à-queue et saut distants : déclenchés sur le front montant des bits
        if (e & E_SPIN && !(r.prevE & E_SPIN)) r.spin = SPIN
        else r.spin = Math.max(0, r.spin - dt)
        const p = 1 - r.spin / SPIN
        r.spinA = r.spin > 0 ? Math.PI * 2 * (1 - (1 - p) * (1 - p)) : 0
        if (e & (E_AIR | E_HOP) && !(r.prevE & (E_AIR | E_HOP))) r.air = r.airMax = e & E_AIR ? AIR : HOP
        else r.air = Math.max(0, r.air - dt)
        r.prevE = e
        r.steerS += (clamp(angDiff(r.heading, r.mesh.userData.h ?? r.heading) / Math.max(dt, 1e-3) / 1.7, -1, 1) - r.steerS) * Math.min(1, dt * 6)
        r.mesh.userData.h = r.heading
      }
      const lift = r.air > 0 ? Math.sin(Math.PI * (1 - r.air / r.airMax)) * (r.airMax === AIR ? 2.6 : 0.7) : 0
      const wobble = e & E_SLIP ? Math.sin(t * 15 + r.skill * 30) * 0.4 : 0
      r.yaw += (r.driftDir * 0.4 + wobble - r.yaw) * Math.min(1, 10 * dt)
      r.mesh.position.set(r.x, 0, r.z)
      r.mesh.rotation.y = -(r.heading + r.yaw + r.spinA)
      // châssis : saut, roulis dans les virages (vers l'extérieur), tangage à l'accélération
      const sp = clamp(r.speed / MAX, 0, 1.4)
      const accel = clamp((r.speed - r.prevSpeed) / Math.max(dt, 1e-3) / 40, -1, 1)
      r.prevSpeed = r.speed
      r.chassis.position.y = lift + (r.driftDir ? 0.06 : 0) + Math.sin(Math.PI * clamp(r.kick / 0.22, 0, 1)) * 0.28
      r.chassis.rotation.x += (r.steerS * sp * 0.13 + r.driftDir * 0.05 - r.chassis.rotation.x) * Math.min(1, 8 * dt)
      r.chassis.rotation.z += (accel * 0.05 + (r.air > 0 && r.airMax === AIR ? 0.12 : 0) - r.chassis.rotation.z) * Math.min(1, 6 * dt)
      // roues : rotation selon la vitesse, braquage des roues avant
      for (const w of r.wheels) w.rotation.z -= (r.speed * dt) / 0.35
      for (const s of r.steerPivots) s.rotation.y = -r.steerS * 0.45
      // ombre : se resserre pendant un saut
      r.shadow.scale.setScalar(1 - lift * 0.15)
      this.emitFx(r, lift)
      if (e & E_STAR) r.body.color.setHSL((performance.now() / 400) % 1, 0.9, 0.55)
      else r.body.color.set(r.d.color)
      r.bubbleMesh.visible = Boolean(e & E_BUBBLE)
      r.cloudMesh.visible = Boolean(e & E_SLOW)
      const lvl = r.kind === 'remote' ? (r.driftDir ? 2 : 0) : DRIFT_LEVELS.filter((v) => r.charge >= v).length
      for (const s of r.sparks) {
        s.visible = lvl > 0
        if (lvl) {
          ;(s.material as THREE.MeshBasicMaterial).color.set(SPARKS[lvl - 1])
          s.rotation.x += 20 * dt
          s.scale.setScalar(0.7 + 0.5 * Math.random())
        }
      }
      r.flame.visible = r.boost > 0
      if (r.boost > 0) r.flame.scale.setScalar(0.8 + 0.4 * Math.random())
    }

    this.dust.update(dt)
    this.glow.update(dt)

    // caméra derrière mon kart (spectateur : derrière le 1er) : elle recule et s'élargit avec la vitesse
    const rank = this.ranking()
    const m = this.me ?? rank[0]
    this.camHeading += angDiff(m.heading + m.yaw * 0.35, this.camHeading) * Math.min(1, 5 * dt)
    const cx = Math.cos(this.camHeading)
    const cz = Math.sin(this.camHeading)
    const portrait = this.camera.aspect < 1
    const fast = m.boost > 0 || m.magnet > 0 || m.star > 0
    this.camBack += (clamp(m.speed / MAX, 0, 1.4) * 0.9 + (fast ? 0.4 : 0) - this.camBack) * Math.min(1, 3.5 * dt)
    const back = (portrait ? 8.0 : 6.8) + this.camBack
    const lift = m.air > 0 ? Math.sin(Math.PI * (1 - m.air / m.airMax)) * (m.airMax === AIR ? 1.6 : 0.3) : 0
    // caméra sur ressort : suit le kart sans à-coups (position et point visé amortis)
    const k = 1 - Math.exp(-13 * dt)
    this.camPos.lerp(this.tmp.set(m.x - cx * back, (portrait ? 4.4 : 3.6) + lift, m.z - cz * back), this.camSnap ? 1 : k)
    this.camLook.lerp(this.tmp.set(m.x + cx * 5, 1.3 + lift * 0.6, m.z + cz * 5), this.camSnap ? 1 : k)
    this.camSnap = false
    this.camera.position.copy(this.camPos)
    if (this.shake > 0.01) {
      // secousse : chocs, atterrissages, mini-turbos
      this.camera.position.x += (Math.random() - 0.5) * this.shake
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.7
      this.camera.position.z += (Math.random() - 0.5) * this.shake
      this.shake *= Math.exp(-7 * dt)
    }
    this.camera.lookAt(this.camLook)
    this.track.sky.position.set(this.camPos.x, 0, this.camPos.z)
    const fov = (portrait ? 78 : 64) + (fast ? 11 : 0) + clamp(m.speed / MAX, 0, 1.2) * 8
    if (Math.abs(fov - this.camera.fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, 6 * dt)
      this.camera.updateProjectionMatrix()
    }
    const lvl = DRIFT_LEVELS.filter((v) => m.charge >= v).length
    this.sfx.update(this.phase === 'countdown' ? 0.1 : m.speed / BOOST, m.driftDir && m.kind !== 'remote' ? lvl : -1)
    this.renderer.render(this.scene, this.camera)

    if (stamp - this.hudAt > 100) {
      this.hudAt = stamp
      const tr = this.track
      const wrong = m.cut < 0 && Math.cos(m.heading) * tr.tx[m.idx] + Math.sin(m.heading) * tr.tz[m.idx] < -0.3
      const mine = this.me
      this.onHud({
        phase: this.phase,
        count: this.count,
        lap: clamp(m.lap, 1, this.o.laps),
        laps: this.o.laps,
        place: rank.indexOf(m) + 1,
        total: this.racers.length,
        time: m.finish ?? this.time,
        speed: clamp(m.speed / MAX, 0, 1.5),
        driftLevel: m.driftDir && m.kind !== 'remote' ? lvl : -1,
        boost: m.boost > 0 || m.magnet > 0,
        wrongWay: wrong && this.phase === 'racing' && m === this.me,
        results: this.phase === 'finished' ? rank.map((r) => ({ id: r.d.id, name: r.d.name, time: r.finish, me: r === this.me })) : null,
        dots: this.racers.map((r) => {
          const [x, y] = this.norm(r.x, r.z)
          return { x, y, c: r.d.color, me: r === this.me }
        }),
        item: mine?.item ?? null,
        rolling: (mine?.roll ?? 0) > 0,
        fx: {
          spin: (mine?.spin ?? 0) > 0,
          slow: (mine?.slow ?? 0) > 0,
          confetti: (mine?.confetti ?? 0) > 0,
          reverse: (mine?.reverse ?? 0) > 0,
          star: (mine?.star ?? 0) > 0,
          bubble: (mine?.bubble ?? 0) > 0,
          slip: (mine?.slip ?? 0) > 0,
          magnet: (mine?.magnet ?? 0) > 0,
          draft: (mine?.draft ?? 0) > 0.6 && (mine?.finish ?? null) === null,
          cut: (mine?.cut ?? -1) >= 0,
        },
      })
    }
  }

  private onHud(h: Hud) {
    this.o.onHud(h)
  }
}
