import * as THREE from 'three'
import { CHECKPOINTS, type TrackDef } from '../tracks'
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
  results: RaceResult[] | null
}

const MAX = 30
const OFFROAD = 13
const BOOST = 43
const DRIFT_LEVELS = [0.7, 1.6, 2.6]
const DRIFT_BOOST = [0, 0.6, 1.2, 1.9]
const SPARKS = ['#4CC9F0', '#FF8C42', '#B388FF']

interface Racer {
  d: Driver
  bot: boolean
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
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b))

/** Course de karts : scène three, physique arcade, bots, caméra, entrées. Sans réseau (étape 2). */
export class Game {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(70, 1, 0.5, 600)
  private track: Track
  private racers: Racer[] = []
  private me!: Racer
  private sfx = new Sfx()
  private raf = 0
  private last = 0
  private t0 = 0
  private phase: Hud['phase'] = 'countdown'
  private count = 3
  private time = 0
  private camHeading = 0
  private hudAt = 0
  private keys = new Set<string>()
  private pointer: { id: number; steer: number } | null = null
  private driftBtn = false
  /** Essais : le joueur est conduit par l'IA. */
  autopilot = false
  private ro: ResizeObserver
  private laps: number
  private el: HTMLElement
  private onHud: (h: Hud) => void

  constructor(el: HTMLElement, def: TrackDef, laps: number, drivers: Driver[], onHud: (h: Hud) => void) {
    this.el = el
    this.laps = laps
    this.onHud = onHud
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
    drivers.forEach((d, k) => {
      // grille de départ : 2 de front, derrière la ligne
      const row = Math.floor(k / 2)
      const idx = this.track.n - 6 - row * 7
      const lat = (k % 2 ? 1 : -1) * this.track.half * 0.45
      const [x, z] = this.track.pointAt(idx, lat)
      const i = this.track.wrap(idx)
      const r: Racer = {
        d, bot: k > 0, x, z,
        heading: Math.atan2(this.track.tz[i], this.track.tx[i]),
        speed: 0, idx: i, lat, lap: 0, cp: CHECKPOINTS - 1, finish: null,
        driftDir: 0, charge: 0, boost: 0, yaw: 0,
        skill: 0.84 + ((k * 37) % 13) / 100,
        botLat: lat * 0.9,
        ...this.makeKart(d, loader),
      }
      this.racers.push(r)
      this.scene.add(r.mesh)
    })
    this.me = this.racers[0]
    this.camHeading = this.me.heading

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
    return { mesh: g, sparks, flame }
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
    return { steer, drift: this.driftBtn || k.has('Space'), brake: k.has('ArrowDown') || k.has('KeyS') }
  }

  private step(r: Racer, steer: number, drift: boolean, brake: boolean, dt: number) {
    const tr = this.track
    const off = Math.abs(r.lat) > tr.half
    let max = (off ? OFFROAD : MAX) * (r.bot ? r.skill : 1)
    if (r.boost > 0) {
      r.boost -= dt
      max = BOOST
    }
    if (brake || r.finish !== null) max = r.finish !== null ? 8 : 0
    const rate = r.speed < max ? (r.boost > 0 ? 45 : 13) : 26
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
          if (r === this.me) this.sfx.boost(lvl)
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
      if (r === this.me && r.speed > 16) this.sfx.bump()
      r.speed *= 1 - 2.5 * dt
      const along = Math.atan2(tr.tz[r.idx], tr.tx[r.idx])
      r.heading += angDiff(along, r.heading) * 3 * dt
    }
    if (!off && tr.isBoost(r.idx) && r.boost < 1) {
      if (r === this.me && r.boost <= 0) this.sfx.boost(1)
      r.boost = 1
    }
    // checkpoints et tours
    const c = Math.floor((r.idx / tr.n) * CHECKPOINTS)
    if (c === (r.cp + 1) % CHECKPOINTS) {
      r.cp = c
      if (c === 0) {
        r.lap++
        if (r.lap > this.laps && r.finish === null) r.finish = this.time
        else if (r === this.me && r.lap > 1) this.sfx.lap()
      }
    }
  }

  private botInput(r: Racer) {
    const tr = this.track
    const [tx, tz] = tr.pointAt(r.idx + 9, r.botLat)
    const want = Math.atan2(tz - r.z, tx - r.x)
    return clamp(angDiff(want, r.heading) * 2.5, -1, 1)
  }

  private progress(r: Racer) {
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

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame)
    if (!this.last) {
      this.last = now
      this.t0 = now
    }
    const dt = Math.min(0.05, (now - this.last) / 1000)
    this.last = now

    if (this.phase === 'countdown') {
      const left = 3.5 - (now - this.t0) / 1000
      const count = Math.max(0, Math.ceil(left - 0.5))
      if (count !== this.count) {
        this.count = count
        this.sfx.beep(count === 0)
      }
      if (count === 0) this.phase = 'racing'
    } else {
      this.time += dt
      const inp = this.input()
      for (const r of this.racers) {
        if (r.bot || r.finish !== null || this.autopilot) this.step(r, this.botInput(r), false, false, dt)
        else this.step(r, inp.steer, inp.drift, inp.brake, dt)
      }
      // karts qui se poussent
      for (let a = 0; a < this.racers.length; a++) {
        for (let b = a + 1; b < this.racers.length; b++) {
          const A = this.racers[a]
          const B = this.racers[b]
          const dx = B.x - A.x
          const dz = B.z - A.z
          const d = Math.hypot(dx, dz)
          if (d > 0.01 && d < 2.2) {
            const p = (2.2 - d) / 2 / d
            A.x -= dx * p
            A.z -= dz * p
            B.x += dx * p
            B.z += dz * p
          }
        }
      }
      if (this.phase === 'racing' && this.me.finish !== null) this.phase = 'finished'
    }

    for (const r of this.racers) {
      r.yaw += (r.driftDir * 0.4 - r.yaw) * Math.min(1, 10 * dt)
      r.mesh.position.set(r.x, r.driftDir ? 0.08 : 0, r.z)
      r.mesh.rotation.y = -(r.heading + r.yaw)
      const lvl = DRIFT_LEVELS.filter((v) => r.charge >= v).length
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

    // caméra derrière le kart, champ élargi pendant les turbos
    const m = this.me
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
    this.sfx.update(this.phase === 'countdown' ? 0.1 : m.speed / BOOST, m.driftDir ? lvl : -1)
    this.renderer.render(this.scene, this.camera)

    if (now - this.hudAt > 100) {
      this.hudAt = now
      const rank = this.ranking()
      const tr = this.track
      const wrong = Math.cos(m.heading) * tr.tx[m.idx] + Math.sin(m.heading) * tr.tz[m.idx] < -0.3
      this.onHud({
        phase: this.phase,
        count: this.count,
        lap: clamp(m.lap, 1, this.laps),
        laps: this.laps,
        place: rank.indexOf(m) + 1,
        total: this.racers.length,
        time: m.finish ?? this.time,
        speed: clamp(m.speed / MAX, 0, 1.5),
        driftLevel: m.driftDir ? lvl : -1,
        boost: m.boost > 0,
        wrongWay: wrong && this.phase === 'racing',
        results: this.phase === 'finished' ? rank.map((r) => ({ id: r.d.id, name: r.d.name, time: r.finish, me: r === m })) : null,
      })
    }
  }
}
