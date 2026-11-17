import * as THREE from 'three'
import { CHECKPOINTS, type TrackDef } from '../tracks'
import { BallSim, BOX_ROWS, boxMaterial, rollItem, type Fx, type Hazard, type ItemId, type UsePayload } from './items'
import { buildKart, SPARKS } from './kart'
import { Particles } from './particles'
import { Sfx } from './sfx'
import { Track, WALL_MARGIN } from './track'

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
  fx: { spin: boolean; slow: boolean; confetti: boolean; reverse: boolean; star: boolean; bubble: boolean }
}

/** Bits d'effets visibles par les autres (KartSnap.e). */
const E_STAR = 1
const E_BUBBLE = 2
const E_SPIN = 4
const E_SLOW = 8
const E_AIR = 16
/** Durée d'un saut de tremplin (s). */
const AIR = 0.75
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
  onHud: (h: Hud) => void
  /** Un kart local vient de boucler un tour (`completed` = tours terminés). */
  onLap?: (id: string, completed: number) => void
  /** Un kart local lance un objet qui touche les autres (à envoyer au serveur). */
  onUse?: (id: string, p: UsePayload) => void
  /** Un kart local a percuté une boule / une glue. */
  onHit?: (id: string, hazard: number) => void
}

interface HazardView {
  hz: Hazard
  at: number
  mesh: THREE.Mesh
  ball: BallSim | null
  /** touché ici : caché en attendant la confirmation serveur */
  gone: boolean
}

const MAX = 30
const OFFROAD = 13
const BOOST = 43
const DRIFT_LEVELS = [0.7, 1.6, 2.6]
const DRIFT_BOOST = [0, 0.6, 1.2, 1.9]
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
  idx: number
  lat: number
  lap: number
  cp: number
  finish: number | null
  driftDir: number
  charge: number
  boost: number
  yaw: number
  skill: number
  botLat: number
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
  spinA: number
  /** saut en cours (s restantes) */
  air: number
  prevE: number
  /** effets distants (bits E_*) */
  e: number
  body: THREE.MeshLambertMaterial
  bubbleMesh: THREE.Mesh
  cloudMesh: THREE.Group
  chassis: THREE.Group
  wheels: THREE.Group[]
  steerPivots: THREE.Group[]
  shadow: THREE.Mesh
  /** direction lissée (-1..1) et vitesse précédente (tangage) */
  steerS: number
  prevSpeed: number
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b))

/** Course de karts : scène three, physique arcade, bots, karts distants interpolés, caméra, entrées. */
export class Game {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(70, 1, 0.5, 1100)
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
  private camHeading = 0
  private camPos = new THREE.Vector3()
  private camLook = new THREE.Vector3()
  private camSnap = true
  private tmp = new THREE.Vector3()
  /** Cadre de la mini-carte : [x0, z0, côté]. */
  private box: [number, number, number] = [0, 0, 1]
  private dust = new Particles(500, 1.1)
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
  private useBtn = false

  constructor(el: HTMLElement, o: GameOptions) {
    this.el = el
    this.o = o
    const def = o.track
    this.track = new Track(def)
    {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
      for (let i = 0; i < this.track.n; i++) {
        x0 = Math.min(x0, this.track.px[i]); x1 = Math.max(x1, this.track.px[i])
        z0 = Math.min(z0, this.track.pz[i]); z1 = Math.max(z1, this.track.pz[i])
      }
      const span = Math.max(x1 - x0, z1 - z0) * 1.1
      this.box = [(x0 + x1) / 2 - span / 2, (z0 + z1) / 2 - span / 2, span]
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
    this.scene.add(this.track.build())
    this.scene.add(this.dust.points, this.glow.points)

    const loader = new THREE.TextureLoader()
    const bots = new Set(o.localBots)
    o.drivers.forEach((d, k) => {
      // grille de départ : 2 de front, derrière la ligne (même ordre sur tous les téléphones)
      const row = Math.floor(k / 2)
      const idx = this.track.n - 6 - row * 7
      const lat = (k % 2 ? 1 : -1) * this.track.half * 0.45
      const [x, z] = this.track.pointAt(idx, lat)
      const i = this.track.wrap(idx)
      const kind: Kind = d.id === o.meId ? 'me' : bots.has(d.id) ? 'bot' : 'remote'
      const r: Racer = {
        d, kind, x, z,
        heading: Math.atan2(this.track.tz[i], this.track.tx[i]),
        speed: 0, idx: i, lat, lap: 0, cp: CHECKPOINTS - 1, finish: null,
        driftDir: 0, charge: 0, boost: 0, yaw: 0,
        skill: 0.84 + ((k * 37) % 13) / 100,
        botLat: lat * 0.9,
        buf: [], netP: 0,
        item: null, roll: 0, hold: 0, spin: 0, slow: 0, star: 0, bubble: 0, reverse: 0, confetti: 0, spinA: 0, air: 0, prevE: 0, e: 0, steerS: 0, prevSpeed: 0,
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
    for (const f of BOX_ROWS) {
      for (const lat of [-0.66, -0.22, 0.22, 0.66]) {
        const [x, z] = this.track.pointAt(Math.round(f * this.track.n), lat * this.track.half)
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

  /** Contour du circuit pour la mini-carte (coordonnées 0..1). */
  outline(): [number, number][] {
    const out: [number, number][] = []
    for (let i = 0; i < this.track.n; i += 6) out.push([(this.track.px[i] - this.box[0]) / this.box[2], (this.track.pz[i] - this.box[1]) / this.box[2]])
    return out
  }

  /** Bouton Drift de l'écran tactile. */
  setDrift(on: boolean) {
    this.driftBtn = on
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
        b: r.boost > 0 ? 1 : 0,
        p: Math.round(this.progress(r)),
        l: r.lap,
        c: r.cp,
        f: r.finish,
        e: (r.star > 0 ? E_STAR : 0) | (r.bubble > 0 ? E_BUBBLE : 0) | (r.spin > 0 ? E_SPIN : 0) | (r.slow > 0 ? E_SLOW : 0) | (r.air > 0 ? E_AIR : 0),
        t,
      }))
  }

  /** Bouton Objet (tactile) : utilise l'objet en main. */
  useItem() {
    this.useBtn = true
  }

  /** Pièges / projectiles et effets du state serveur. */
  syncItems(hazards: Hazard[], fx: Fx[]) {
    const live = new Set<number>()
    for (const hz of hazards) {
      live.add(hz.id)
      if (this.hazards.has(hz.id)) continue
      const isBall = hz.type === 'ball'
      const mesh = isBall
        ? new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 12), new THREE.MeshLambertMaterial({ color: '#7B2CBF', emissive: '#3c0f66' }))
        : new THREE.Mesh(new THREE.CircleGeometry(2.1, 20), new THREE.MeshBasicMaterial({ color: '#E0A526' }))
      if (isBall) mesh.position.y = 0.9
      else {
        mesh.rotation.x = -Math.PI / 2
        mesh.position.set(hz.x, 0.07, hz.z)
      }
      this.scene.add(mesh)
      this.hazards.set(hz.id, { hz, at: Date.parse(hz.at), mesh, ball: isBall ? new BallSim(hz) : null, gone: false })
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
      const r = this.byId.get(f.target)
      const left = (Date.parse(f.until) - now) / 1000
      if (!r || r.kind === 'remote' || left <= 0 || r.finish !== null) continue
      if (!this.protect(r)) continue
      if (f.type === 'cloud') r.slow = Math.max(r.slow, left)
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
    if (it === 'turbo') r.boost = Math.max(r.boost, 2)
    else if (it === 'star') r.star = 5
    else if (it === 'bubble') r.bubble = 15
    else if (it === 'ball') this.o.onUse?.(r.d.id, { item: 'ball', x: round(r.x + cx * 3), z: round(r.z + cz * 3), h: round(r.heading) })
    else if (it === 'glue') this.o.onUse?.(r.d.id, { item: 'glue', x: round(r.x - cx * 3.5), z: round(r.z - cz * 3.5), h: round(r.heading) })
    else {
      const ahead = rank.slice(0, pos).filter((x) => x.finish === null)
      const behind = rank.slice(pos + 1)
      const targets =
        it === 'cloud' ? ahead : it === 'confetti' ? [ahead[ahead.length - 1] ?? behind[0]] : [ahead[0] ?? behind[0]]
      const ids = targets.filter(Boolean).map((x) => x.d.id)
      if (ids.length) this.o.onUse?.(r.d.id, { item: it, targets: ids })
    }
    if (isMe) this.sfx.launch()
  }

  /** Objets : roulette, usage par les bots, boîtes, pièges, touches, minuteurs d'effets. */
  private updateItems(dt: number, now: number) {
    const rank = this.ranking()
    for (const r of this.racers) {
      if (r.kind === 'remote') continue
      for (const k of ['spin', 'slow', 'star', 'bubble', 'reverse', 'confetti'] as const) r[k] = Math.max(0, r[k] - dt)
      if (r.roll > 0) {
        r.roll -= dt
        if (r.roll <= 0) {
          r.item = rollItem(rank.indexOf(r) + 1, rank.length)
          r.hold = 1 + Math.random() * 3
          if (r === this.me) this.sfx.pick()
        }
      } else if (r.item && r.finish === null) {
        if (r === this.me) {
          if (this.useBtn) this.fire(r)
        } else if (r.kind === 'bot' || this.o.autopilot) {
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
    for (const v of this.hazards.values()) {
      const age = (now - v.at) / 1000
      if (v.ball) {
        v.ball.advance(this.track, Math.max(0, age))
        v.mesh.position.set(v.ball.x, 0.9, v.ball.z)
        v.mesh.rotation.z -= dt * 8
      }
      const dead = v.gone || (v.ball ? v.ball.dead : age > 30)
      v.mesh.visible = !dead && age >= 0
      if (dead || age < 0) continue
      const hx = v.ball ? v.ball.x : v.hz.x
      const hz = v.ball ? v.ball.z : v.hz.z
      for (const r of this.racers) {
        if (r.kind === 'remote' || r.finish !== null || r.spin > 0 || r.air > 0) continue
        // son propre objet ne touche qu'après un court délai
        if (r.d.id === v.hz.owner && age < (v.ball ? 0.6 : 1.5)) continue
        if ((r.x - hx) ** 2 + (r.z - hz) ** 2 > (v.ball ? 4 : 5.3)) continue
        v.gone = true
        this.o.onHit?.(r.d.id, v.hz.id)
        if (this.protect(r)) {
          r.spin = SPIN
          r.speed *= 0.3
          r.driftDir = 0
          r.charge = 0
          if (r === this.me) this.sfx.hit()
        }
        break
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
        r.idx = this.track.locate(r.x, r.z, -1).i
        r.lat = this.track.locate(r.x, r.z, r.idx).lat
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
      if (Math.abs(r.lat) > this.track.half && r.star <= 0) {
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
    this.pointer.steer = clamp((e.clientX - rect.left - rect.width / 2) / (rect.width * 0.28), -1, 1)
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

  private step(r: Racer, steer: number, drift: boolean, brake: boolean, dt: number) {
    const tr = this.track
    const isMe = r === this.me
    const off = Math.abs(r.lat) > tr.half && r.star <= 0 && r.air <= 0
    let max = (off ? OFFROAD : MAX) * (r.kind === 'bot' ? r.skill : 1)
    if (r.boost > 0) {
      r.boost -= dt
      max = BOOST
    }
    if (r.star > 0) max = Math.max(max, BOOST * 0.92)
    if (r.slow > 0) max *= 0.55
    if (r.spin > 0) {
      // tête-à-queue : un tour complet amorti, plus de contrôle, on ralentit fort
      max = 0
      steer = 0
      drift = false
      const p = 1 - r.spin / SPIN
      r.spinA = Math.PI * 2 * (1 - (1 - p) * (1 - p))
    } else r.spinA = 0
    // direction progressive (plus de coups de volant secs)
    r.steerS += (steer - r.steerS) * Math.min(1, dt * 9)
    steer = r.steerS
    if (brake || r.finish !== null) max = r.finish !== null ? 8 : 0
    const rate = r.speed < max ? (r.boost > 0 || r.star > 0 ? 45 : 13) : r.spin > 0 ? 40 : 26
    r.speed += Math.sign(max - r.speed) * Math.min(Math.abs(max - r.speed), rate * dt)

    // dérapage : on charge tant qu'on maintient, on relâche pour un mini-turbo
    if (!r.driftDir && drift && Math.abs(steer) > 0.25 && r.speed > 14 && !off) {
      r.driftDir = Math.sign(steer)
      r.charge = 0
    }
    if (r.driftDir) {
      if (!drift || r.speed < 10) {
        const lvl = DRIFT_LEVELS.filter((v) => r.charge >= v).length
        if (lvl) {
          r.boost = Math.max(r.boost, DRIFT_BOOST[lvl])
          if (isMe) this.sfx.boost(lvl)
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
    r.heading += omega * grip * dt
    r.x += Math.cos(r.heading) * r.speed * dt
    r.z += Math.sin(r.heading) * r.speed * dt

    const loc = tr.locate(r.x, r.z, r.idx)
    r.idx = loc.i
    r.lat = loc.lat
    const wall = tr.half + WALL_MARGIN
    if (Math.abs(r.lat) > wall) {
      r.lat = clamp(r.lat, -wall, wall)
      ;[r.x, r.z] = tr.pointAt(r.idx, r.lat)
      if (isMe && r.speed > 16) this.sfx.bump()
      r.speed *= 1 - 2.5 * dt
      const along = Math.atan2(tr.tz[r.idx], tr.tx[r.idx])
      r.heading += angDiff(along, r.heading) * 3 * dt
    }
    if (!off && tr.isBoost(r.idx) && r.boost < 1) {
      if (isMe && r.boost <= 0) this.sfx.boost(1)
      r.boost = 1
    }
    // tremplin : saut si on arrive vite (en l'air : on garde le cap)
    if (r.air > 0) r.air = Math.max(0, r.air - dt)
    else if (tr.isJump(r.idx) && r.speed > 15) {
      r.air = AIR
      if (isMe) this.sfx.jump()
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
    const loc = this.track.locate(r.x, r.z, r.idx)
    r.idx = loc.i
    r.lat = loc.lat
  }

  private botInput(r: Racer) {
    const tr = this.track
    const [tx, tz] = tr.pointAt(r.idx + 9, r.botLat)
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

  private frame = (stamp: number) => {
    this.raf = requestAnimationFrame(this.frame)
    if (!this.last) this.last = stamp
    const dt = Math.min(0.05, (stamp - this.last) / 1000)
    this.last = stamp
    const now = this.o.now()
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
      // karts qui se poussent : seuls les karts simulés ici bougent
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
          if (d > 0.01 && d < 2.2) {
            const p = ((2.2 - d) / d) * (la && lb ? 0.5 : 1)
            if (la) {
              A.x -= dx * p
              A.z -= dz * p
            }
            if (lb) {
              B.x += dx * p
              B.z += dz * p
            }
          }
        }
      }
      this.updateItems(dt, now)
      if (this.phase === 'racing' && this.me?.finish != null) this.phase = 'finished'
    }

    for (const r of this.racers) {
      const e = r.kind === 'remote' ? r.e : (r.star > 0 ? E_STAR : 0) | (r.bubble > 0 ? E_BUBBLE : 0) | (r.spin > 0 ? E_SPIN : 0) | (r.slow > 0 ? E_SLOW : 0) | (r.air > 0 ? E_AIR : 0)
      if (r.kind === 'remote') {
        // tête-à-queue et saut distants : déclenchés sur le front montant des bits
        if (e & E_SPIN && !(r.prevE & E_SPIN)) r.spin = SPIN
        else r.spin = Math.max(0, r.spin - dt)
        const p = 1 - r.spin / SPIN
        r.spinA = r.spin > 0 ? Math.PI * 2 * (1 - (1 - p) * (1 - p)) : 0
        if (e & E_AIR && !(r.prevE & E_AIR)) r.air = AIR
        else r.air = Math.max(0, r.air - dt)
        r.prevE = e
        r.steerS += (clamp(angDiff(r.heading, r.mesh.userData.h ?? r.heading) / Math.max(dt, 1e-3) / 1.7, -1, 1) - r.steerS) * Math.min(1, dt * 6)
        r.mesh.userData.h = r.heading
      }
      const lift = r.air > 0 ? Math.sin(Math.PI * (1 - r.air / AIR)) * 2.6 : 0
      r.yaw += (r.driftDir * 0.4 - r.yaw) * Math.min(1, 10 * dt)
      r.mesh.position.set(r.x, 0, r.z)
      r.mesh.rotation.y = -(r.heading + r.yaw + r.spinA)
      // châssis : saut, roulis dans les virages (vers l'extérieur), tangage à l'accélération
      const sp = clamp(r.speed / MAX, 0, 1.4)
      const accel = clamp((r.speed - r.prevSpeed) / Math.max(dt, 1e-3) / 40, -1, 1)
      r.prevSpeed = r.speed
      r.chassis.position.y = lift + (r.driftDir ? 0.06 : 0)
      r.chassis.rotation.x += (r.steerS * sp * 0.13 + r.driftDir * 0.05 - r.chassis.rotation.x) * Math.min(1, 8 * dt)
      r.chassis.rotation.z += (accel * 0.05 - r.chassis.rotation.z) * Math.min(1, 6 * dt)
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

    // caméra derrière mon kart (spectateur : derrière le 1er), champ élargi pendant les turbos
    const rank = this.ranking()
    const m = this.me ?? rank[0]
    this.camHeading += angDiff(m.heading + m.yaw * 0.35, this.camHeading) * Math.min(1, 5 * dt)
    const cx = Math.cos(this.camHeading)
    const cz = Math.sin(this.camHeading)
    const portrait = this.camera.aspect < 1
    const back = portrait ? 8.6 : 7.4
    const lift = m.air > 0 ? Math.sin(Math.PI * (1 - m.air / AIR)) * 1.6 : 0
    // caméra sur ressort : suit le kart sans à-coups (position et point visé amortis)
    const k = 1 - Math.exp(-13 * dt)
    this.camPos.lerp(this.tmp.set(m.x - cx * back, (portrait ? 4.4 : 3.6) + lift, m.z - cz * back), this.camSnap ? 1 : k)
    this.camLook.lerp(this.tmp.set(m.x + cx * 5, 1.3 + lift * 0.6, m.z + cz * 5), this.camSnap ? 1 : k)
    this.camSnap = false
    this.camera.position.copy(this.camPos)
    this.camera.lookAt(this.camLook)
    const fov = (portrait ? 80 : 66) + (m.boost > 0 ? 10 : 0) + (m.speed / MAX) * 5
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
      const wrong = Math.cos(m.heading) * tr.tx[m.idx] + Math.sin(m.heading) * tr.tz[m.idx] < -0.3
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
        boost: m.boost > 0,
        wrongWay: wrong && this.phase === 'racing' && m === this.me,
        results: this.phase === 'finished' ? rank.map((r) => ({ id: r.d.id, name: r.d.name, time: r.finish, me: r === this.me })) : null,
        dots: this.racers.map((r) => ({ x: (r.x - this.box[0]) / this.box[2], y: (r.z - this.box[1]) / this.box[2], c: r.d.color, me: r === this.me })),
        item: this.me?.item ?? null,
        rolling: (this.me?.roll ?? 0) > 0,
        fx: {
          spin: (this.me?.spin ?? 0) > 0,
          slow: (this.me?.slow ?? 0) > 0,
          confetti: (this.me?.confetti ?? 0) > 0,
          reverse: (this.me?.reverse ?? 0) > 0,
          star: (this.me?.star ?? 0) > 0,
          bubble: (this.me?.bubble ?? 0) > 0,
        },
      })
    }
  }

  private onHud(h: Hud) {
    this.o.onHud(h)
  }
}
