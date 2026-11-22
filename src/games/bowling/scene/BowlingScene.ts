/**
 * Orchestrateur 3D (chargé en lazy : three + cannon-es ne sont que dans ce chunk).
 * Rendu Three, physique cannon au pas fixe 1/120 s, geste, caméra, sons,
 * enregistrement pour le replay. Pause quand l'onglet est caché ; dispose()
 * libère tout (géométries, textures, contexte WebGL, audio, écouteurs).
 */
import * as THREE from 'three'
import { vibrate } from '@/lib/feedback'
import { BowlingAudio } from './audio'
import { CameraRig, type CamMode } from './camera'
import { attachInput, analyzeSwipe, type SwipePoint, type SwipeResult } from './input'
import { buildLane, type LaneView } from './Lane'
import {
  BALL_R, BALL_START_Z, BowlingPhysics, GUTTER_DEPTH, HOOK_ACCEL, LANE_HALF, LANE_LEN, MAX_START_X, STEP, clamp,
} from './physics'

export type ScenePhase = 'aim' | 'rolling' | 'result' | 'replay'

export interface RollOutcome {
  /** Quilles tombées pendant ce lancer (⊆ quilles debout). */
  mask: number
  gutter: boolean
  /** La boule a touché au moins une quille. */
  hit: boolean
  /** Paramètres du lancer (stats / debug). */
  params: SwipeResult & { x: number }
}

export interface SceneCallbacks {
  onThrow?: (p: SwipeResult & { x: number }) => void
  onRollEnd: (o: RollOutcome) => void
  onInvalidSwipe?: () => void
  onReplayEnd?: () => void
  /** Premier choc boule-quille (pour les effets d'interface). */
  onPinHit?: () => void
}

export interface SceneOptions {
  ballColor: string
  /** Boule de cadeau (bb_noel). */
  ballStyle?: 'noel' | 'galaxie'
  dark: boolean
  callbacks: SceneCallbacks
}

const BODIES = 11
const REC_EVERY = 2 // 60 Hz
const REPLAY_SPEED = 0.5

export class BowlingScene {
  private container: HTMLElement
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private rig: CameraRig
  private lane: LaneView
  private light: THREE.DirectionalLight
  private phys: BowlingPhysics
  private audio = new BowlingAudio()
  private cb: SceneCallbacks
  private phase: ScenePhase = 'aim'
  private inputOn = false
  private ballX = 0
  private placeX0 = 0
  private acc = 0
  private raf = 0
  private last = 0
  private disposed = false
  private hidden = false
  private stepCount = 0
  private rec: Float32Array[] = []
  private recFirstHit = -1
  private replayT = 0
  private replayFrom = 0
  private replayTo = 0
  private params: (SwipeResult & { x: number }) | null = null
  private hitNotified = false
  private lastVibe = 0
  private dirty = true
  private tmpV = new THREE.Vector3()
  private cleanups: Array<() => void> = []

  constructor(container: HTMLElement, opts: SceneOptions) {
    this.container = container
    this.cb = opts.callbacks
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.renderer = new THREE.WebGLRenderer({ antialias: dpr < 1.5, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(dpr)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    const canvas = this.renderer.domElement
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.display = 'block'
    canvas.style.touchAction = 'none'
    container.appendChild(canvas)

    const bg = new THREE.Color(opts.dark ? '#15122b' : '#fff6e5')
    this.scene.background = bg
    this.scene.fog = new THREE.Fog(bg, 16, 34)

    this.scene.add(new THREE.HemisphereLight('#ffffff', opts.dark ? '#3a2f7a' : '#ffd9a0', opts.dark ? 1.6 : 2.0))
    const light = new THREE.DirectionalLight('#fff3dc', opts.dark ? 2.2 : 2.6)
    light.castShadow = true
    light.shadow.mapSize.set(512, 512)
    const sc = light.shadow.camera
    sc.left = -2.2
    sc.right = 2.2
    sc.top = 2.2
    sc.bottom = -2.2
    sc.near = 0.5
    sc.far = 14
    light.shadow.bias = -0.0008
    this.scene.add(light, light.target)
    this.light = light

    this.lane = buildLane({ ballColor: opts.ballColor, ballStyle: opts.ballStyle, dark: opts.dark })
    this.scene.add(this.lane.root)

    this.rig = new CameraRig(1)
    this.phys = new BowlingPhysics(1023, 0)
    this.wireImpacts()
    this.syncMeshes()

    // Taille
    const ro = new ResizeObserver(() => this.resize())
    ro.observe(container)
    this.cleanups.push(() => ro.disconnect())
    this.resize()

    // Pause quand l'onglet est caché
    const vis = () => {
      this.hidden = document.hidden
      if (this.hidden) {
        cancelAnimationFrame(this.raf)
        this.raf = 0
        this.audio.setRumble(0)
      } else if (!this.raf && !this.disposed) {
        this.last = performance.now()
        this.raf = requestAnimationFrame(this.loop)
      }
    }
    document.addEventListener('visibilitychange', vis)
    this.cleanups.push(() => document.removeEventListener('visibilitychange', vis))

    this.cleanups.push(
      attachInput(canvas, {
        enabled: () => this.inputOn && this.phase === 'aim',
        hitBall: (x, y) => this.hitBall(x, y),
        onPlace: (dx, ph) => {
          if (ph === 'start') {
            this.placeX0 = this.ballX
            this.audio.ensure()
          }
          const w = this.container.clientWidth || 1
          this.ballX = clamp(this.placeX0 + (dx / w) * 1.4, -MAX_START_X, MAX_START_X)
          this.phys.setBallX(this.ballX)
          this.dirty = true
        },
        onSwipe: (pts, ph) => this.preview(ph === 'move' ? pts : null),
        onThrow: (r) => this.throwBall(r),
        onInvalid: () => this.cb.onInvalidSwipe?.(),
      }),
    )

    // Un tap pendant le replay le passe.
    const skip = () => {
      if (this.phase === 'replay') this.endReplay()
    }
    canvas.addEventListener('pointerdown', skip)
    this.cleanups.push(() => canvas.removeEventListener('pointerdown', skip))

    this.last = performance.now()
    this.raf = requestAnimationFrame(this.loop)
  }

  /** Nouveau lancer : quilles `standing` remises sur leurs emplacements, visée. */
  prepare(standing: number, canThrow = true) {
    if (this.phase === 'rolling') return // jamais en plein lancer
    this.phys.reset(standing, this.ballX)
    this.wireImpacts()
    this.phase = 'aim'
    this.inputOn = canThrow
    this.rec = []
    this.recFirstHit = -1
    this.stepCount = 0
    this.acc = 0
    this.hitNotified = false
    this.params = null
    this.lane.setGuide(null)
    this.syncMeshes()
    this.dirty = true
  }

  setInputEnabled(on: boolean) {
    this.inputOn = on
  }

  getPhase() {
    return this.phase
  }

  /** Rejoue le lancer au ralenti (strike). */
  replay() {
    if (this.rec.length < 10) {
      this.cb.onReplayEnd?.()
      return
    }
    const fps = 60
    const hit = this.recFirstHit >= 0 ? Math.round(this.recFirstHit * fps) : Math.max(0, this.rec.length - 120)
    this.replayFrom = Math.max(0, hit - 24)
    this.replayTo = Math.min(this.rec.length - 1, hit + 110)
    this.replayT = 0
    this.phase = 'replay'
    this.applyFrame(this.replayFrom)
    this.rig.snap('replay', this.tmpV.set(0, 0, -LANE_LEN))
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    for (const c of this.cleanups) c()
    this.cleanups = []
    this.audio.dispose()
    this.lane.dispose()
    this.scene.clear()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.renderer.domElement.remove()
  }

  /* ------------------------------------------------------------------------ */

  private wireImpacts() {
    this.phys.onImpact = (kind, speed) => {
      if (this.phase !== 'rolling') return
      const v = Math.min(1, speed / 6)
      if (kind === 'ball-pin') {
        this.audio.impact(v, true)
        if (!this.hitNotified) {
          this.hitNotified = true
          this.cb.onPinHit?.()
          vibrate(35)
        }
      } else if (kind !== 'wall' || speed > 0.8) {
        this.audio.impact(v * 0.8)
        const now = performance.now()
        if (kind === 'pin-pin' && speed > 1.5 && now - this.lastVibe > 90) {
          this.lastVibe = now
          vibrate(12)
        }
      }
    }
  }

  private resize() {
    const w = Math.max(1, this.container.clientWidth)
    const h = Math.max(1, this.container.clientHeight)
    this.renderer.setSize(w, h, false)
    this.rig.setAspect(w / h)
    this.dirty = true
  }

  private hitBall(x: number, y: number) {
    const p = this.tmpV.set(this.ballX, BALL_R, BALL_START_Z).project(this.rig.camera)
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    const sx = ((p.x + 1) / 2) * w
    const sy = ((1 - p.y) / 2) * h
    return Math.hypot(sx - x, sy - y) < Math.max(46, w * 0.12)
  }

  /** Aperçu de la trajectoire pendant le geste. */
  private preview(pts: SwipePoint[] | null) {
    this.dirty = true
    const r = pts ? analyzeSwipe(pts, this.container.clientHeight) : null
    if (!r) {
      this.lane.setGuide(null)
      return
    }
    const out: Array<[number, number]> = []
    let x = this.ballX
    let vx = Math.sin(r.angle) * r.speed
    const vz = Math.cos(r.angle) * r.speed
    let z = -BALL_START_Z
    const dt = 1 / 30
    for (let i = 0; i < 400 && out.length < 18 && z < LANE_LEN * 0.8; i++) {
      const ramp = clamp((z - LANE_LEN * 0.35) / (LANE_LEN * 0.4), 0, 1)
      vx += r.spin * HOOK_ACCEL * ramp * dt
      x += vx * dt
      z += vz * dt
      if (i % 3 === 2) out.push([clamp(x, -LANE_HALF - 0.1, LANE_HALF + 0.1), -z])
    }
    this.lane.setGuide(out)
  }

  private throwBall(r: SwipeResult) {
    this.audio.ensure()
    this.lane.setGuide(null)
    this.params = { ...r, x: this.ballX }
    this.phys.launch(this.params)
    this.phase = 'rolling'
    this.acc = 0
    this.audio.startRumble()
    this.cb.onThrow?.(this.params)
  }

  private record() {
    const f = new Float32Array(BODIES * 7)
    const bodies = this.phys.bodies()
    for (let i = 0; i < BODIES; i++) {
      const b = bodies[i]
      f.set([b.position.x, b.position.y, b.position.z, b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w], i * 7)
    }
    this.rec.push(f)
    if (this.recFirstHit < 0 && this.phys.firstHit >= 0) this.recFirstHit = this.phys.firstHit
  }

  private applyFrame(idx: number) {
    const f = this.rec[Math.max(0, Math.min(this.rec.length - 1, idx))]
    const objs = [this.lane.ball, ...this.lane.pins]
    for (let i = 0; i < BODIES; i++) {
      objs[i].position.set(f[i * 7], f[i * 7 + 1], f[i * 7 + 2])
      objs[i].quaternion.set(f[i * 7 + 3], f[i * 7 + 4], f[i * 7 + 5], f[i * 7 + 6])
    }
  }

  private syncMeshes() {
    const bodies = this.phys.bodies()
    const objs = [this.lane.ball, ...this.lane.pins]
    for (let i = 0; i < BODIES; i++) {
      const b = bodies[i]
      objs[i].visible = i === 0 || !!b.world
      objs[i].position.set(b.position.x, b.position.y, b.position.z)
      objs[i].quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w)
    }
  }

  private endReplay() {
    if (this.phase !== 'replay') return
    this.phase = 'result'
    if (this.rec.length) this.applyFrame(this.rec.length - 1)
    this.cb.onReplayEnd?.()
  }

  private loop = (now: number) => {
    if (this.disposed || this.hidden) return
    this.raf = requestAnimationFrame(this.loop)
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000))
    this.last = now

    let mode: CamMode = 'aim'
    if (this.phase === 'rolling') {
      this.acc += dt
      let n = 0
      while (this.acc >= STEP && n < 12) {
        this.phys.step()
        this.stepCount++
        if (this.stepCount % REC_EVERY === 0) this.record()
        this.acc -= STEP
        n++
        if (this.phys.isDone()) break
      }
      if (n === 12) this.acc = 0 // appareil trop lent : on ralentit plutôt que d'accumuler
      this.syncMeshes()
      const b = this.phys.ball.position
      this.audio.setRumble(this.phys.ballOut() ? 0 : this.phys.ballSpeed(), Math.abs(b.x) < LANE_HALF && b.y > -GUTTER_DEPTH / 2)
      mode = 'follow'
      if (this.phys.isDone()) {
        this.record()
        this.phase = 'result'
        this.inputOn = false
        this.audio.stopRumble()
        this.cb.onRollEnd({
          mask: this.phys.knockedMask(),
          gutter: this.phys.inGutter,
          hit: this.phys.hitPins,
          params: this.params ?? { x: this.ballX, speed: 0, angle: 0, spin: 0, power: 0 },
        })
      }
      this.dirty = true
    } else if (this.phase === 'replay') {
      this.replayT += dt * REPLAY_SPEED
      const idx = this.replayFrom + Math.floor(this.replayT * 60)
      if (idx >= this.replayTo) this.endReplay()
      else this.applyFrame(idx)
      mode = 'replay'
      this.dirty = true
    } else if (this.phase === 'result') {
      mode = 'pins'
    } else {
      this.lane.ball.position.set(this.ballX, BALL_R, BALL_START_Z)
      this.lane.ball.quaternion.identity()
    }

    const before = this.rig.camera.position.clone()
    this.rig.update(dt, mode, this.lane.ball.position)
    const moved = before.distanceToSquared(this.rig.camera.position) > 1e-8
    if (!moved && !this.dirty) return // scène immobile : on économise la batterie

    // Ombres (petite shadow map) centrées sur la boule, ou sur les quilles en fin de piste.
    const bp = this.lane.ball.position
    const nearPins = this.rig.mode === 'pins' || this.rig.mode === 'replay' || bp.z < -LANE_LEN + 1.5
    this.light.target.position.set(nearPins ? 0 : bp.x, 0, nearPins ? -LANE_LEN - 0.3 : bp.z - 0.8)
    this.light.position.set(this.light.target.position.x + 1.6, 5.5, this.light.target.position.z + 2.2)
    this.renderer.render(this.scene, this.rig.camera)
    this.dirty = false
  }
}
