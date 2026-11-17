import * as THREE from 'three'
import { CHECKPOINTS, type TrackDef } from '../tracks'
import { BallSim, BOX_ROWS, boxMaterial, rollItem, type Fx, type Hazard, type ItemId, type UsePayload } from './items'
import { Sfx } from './sfx'
import { Track, WALL_MARGIN } from './track'

export interface Driver {
  id: string
  name: string
  color: string
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
  /** Effets subis / actifs sur mon kart. */
  fx: { spin: boolean; slow: boolean; confetti: boolean; reverse: boolean; star: boolean; bubble: boolean }
}

/** Bits d'effets visibles par les autres (KartSnap.e). */
const E_STAR = 1
const E_BUBBLE = 2
const E_SPIN = 4
const E_SLOW = 8

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
const SPARKS = ['#4CC9F0', '#FF8C42', '#B388FF']
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
  /** effets distants (bits E_*) */
  e: number
  body: THREE.MeshLambertMaterial
  bubbleMesh: THREE.Mesh
  cloudMesh: THREE.Group
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b))

/** Course de karts : scène three, physique arcade, bots, karts distants interpolés, caméra, entrées. */
export class Game {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(70, 1, 0.5, 600)
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
        item: null, roll: 0, hold: 0, spin: 0, slow: 0, star: 0, bubble: 0, reverse: 0, confetti: 0, spinA: 0, e: 0,
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
        f: r.finish,
        e: (r.star > 0 ? E_STAR : 0) | (r.bubble > 0 ? E_BUBBLE : 0) | (r.spin > 0 ? E_SPIN : 0) | (r.slow > 0 ? E_SLOW : 0),
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
        if (r.kind === 'remote' || r.finish !== null || r.spin > 0) continue
        // son propre objet ne touche qu'après un court délai
        if (r.d.id === v.hz.owner && age < (v.ball ? 0.6 : 1.5)) continue
        if ((r.x - hx) ** 2 + (r.z - hz) ** 2 > (v.ball ? 4 : 5.3)) continue
        v.gone = true
        this.o.onHit?.(r.d.id, v.hz.id)
        if (this.protect(r)) {
          r.spin = 1.3
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

  private makeKart(d: Driver, loader: THREE.TextureLoader) {
    const g = new THREE.Group()
    const body = new THREE.MeshLambertMaterial({ color: d.color })
    const dark = new THREE.MeshLambertMaterial({ color: '#1B1B2F' })
    const box = (w: number, h: number, l: number, x: number, y: number, m: THREE.Material) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), m)
      mesh.position.set(x, y, 0)
      g.add(mesh)
    }
    box(2.4, 0.45, 1.3, 0, 0.55, body)
    box(0.9, 0.3, 1.5, 1.1, 0.5, dark)
    box(0.35, 0.8, 1.2, -0.95, 0.95, body)
    const wheel = new THREE.CylinderGeometry(0.42, 0.42, 0.36, 12)
    wheel.rotateX(Math.PI / 2)
    const sparks: THREE.Mesh[] = []
    for (const [x, z] of [[0.85, 0.82], [0.85, -0.82], [-0.85, 0.82], [-0.85, -0.82]]) {
      const w = new THREE.Mesh(wheel, dark)
      w.position.set(x, 0.42, z)
      g.add(w)
      if (x < 0) {
        const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.32), new THREE.MeshBasicMaterial({ color: SPARKS[0] }))
        s.position.set(x - 0.5, 0.25, z)
        s.visible = false
        g.add(s)
        sparks.push(s)
      }
    }
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.6, 8), new THREE.MeshBasicMaterial({ color: '#FFD23F' }))
    flame.rotation.z = Math.PI / 2
    flame.position.set(-2, 0.6, 0)
    flame.visible = false
    g.add(flame)
    const tex = loader.load(d.sprite)
    tex.colorSpace = THREE.SRGBColorSpace
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex }))
    sprite.scale.set(2.1, 2.1, 1)
    sprite.position.set(-0.1, 1.75, 0)
    g.add(sprite)
    const bubbleMesh = new THREE.Mesh(
      new THREE.SphereGeometry(2.1, 20, 14),
      new THREE.MeshBasicMaterial({ color: '#7FDBFF', transparent: true, opacity: 0.3, depthWrite: false }),
    )
    bubbleMesh.position.y = 1.2
    bubbleMesh.visible = false
    g.add(bubbleMesh)
    const cloudMesh = new THREE.Group()
    const grey = new THREE.MeshLambertMaterial({ color: '#6B6F85' })
    for (const [x, z, s] of [[0, 0, 0.9], [0.7, 0.2, 0.7], [-0.7, -0.1, 0.75], [0.1, 0.6, 0.6]]) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(s, 10, 8), grey)
      puff.position.set(x, 0, z)
      cloudMesh.add(puff)
    }
    cloudMesh.position.y = 3.6
    cloudMesh.visible = false
    g.add(cloudMesh)
    return { mesh: g, sparks, flame, body, bubbleMesh, cloudMesh }
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
    const off = Math.abs(r.lat) > tr.half && r.star <= 0
    let max = (off ? OFFROAD : MAX) * (r.kind === 'bot' ? r.skill : 1)
    if (r.boost > 0) {
      r.boost -= dt
      max = BOOST
    }
    if (r.star > 0) max = Math.max(max, BOOST * 0.92)
    if (r.slow > 0) max *= 0.55
    if (r.spin > 0) {
      // tête-à-queue : plus de contrôle, on ralentit fort
      max = 0
      steer = 0
      drift = false
      r.spinA += dt * 14
    } else r.spinA = 0
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
    const omega = r.driftDir ? r.driftDir * 1.15 + steer * 0.75 : steer * 1.75
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
    r.idx = this.track.locate(r.x, r.z, r.idx).i
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
      const e = r.kind === 'remote' ? r.e : (r.star > 0 ? E_STAR : 0) | (r.bubble > 0 ? E_BUBBLE : 0) | (r.spin > 0 ? E_SPIN : 0) | (r.slow > 0 ? E_SLOW : 0)
      if (r.kind === 'remote') r.spinA = e & E_SPIN ? r.spinA + dt * 14 : 0
      r.yaw += (r.driftDir * 0.4 - r.yaw) * Math.min(1, 10 * dt)
      r.mesh.position.set(r.x, r.driftDir ? 0.08 : 0, r.z)
      r.mesh.rotation.y = -(r.heading + r.yaw + r.spinA)
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

    // caméra derrière mon kart (spectateur : derrière le 1er), champ élargi pendant les turbos
    const rank = this.ranking()
    const m = this.me ?? rank[0]
    this.camHeading += angDiff(m.heading + m.yaw * 0.35, this.camHeading) * Math.min(1, 5 * dt)
    const cx = Math.cos(this.camHeading)
    const cz = Math.sin(this.camHeading)
    const portrait = this.camera.aspect < 1
    const back = portrait ? 9.5 : 8
    this.camera.position.set(m.x - cx * back, portrait ? 5 : 4, m.z - cz * back)
    this.camera.lookAt(m.x + cx * 6, 1.4, m.z + cz * 6)
    const fov = (portrait ? 82 : 68) + (m.boost > 0 ? 12 : 0) + (m.speed / MAX) * 5
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
