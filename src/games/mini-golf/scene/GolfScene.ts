/**
 * Orchestrateur 3D du mini-golf (chargé en lazy : three + cannon-es ne sont que dans ce chunk).
 * Rendu three, physique cannon au pas fixe 1/120 s, geste lance-pierre, caméra fixe, sons,
 * balles fantômes des autres joueurs (interpolées, sans collision). Pause quand l'onglet est
 * caché ; rendu à la demande quand rien ne bouge ; dispose() libère tout.
 */
import * as THREE from 'three'
import { vibrate } from '@/lib/feedback'
import { hasBell, type HoleDef } from '../holes'
import { GolfAudio } from './audio'
import { CameraRig, type Frame } from './camera'
import { buildCourse, type CourseView } from './Course'
import { attachInput, type Drag } from './input'
import { BALL_R, GolfPhysics, STEP, gateY, millAngle, sliderX } from './physics'

export type Vec3 = [number, number, number]

export interface StrokeResult {
  holed: boolean
  water: boolean
  /** Chute dans le vide (trou suspendu) : +1 coup comme l'eau. */
  fall: boolean
  out: boolean
  /** Position de repos de la balle (ou du trou si rentrée). */
  pos: Vec3
  /** Rebonds sur bordures / plots / bumpers pendant ce coup. */
  bounces: number
  /** La balle a touché une pale du moulin pendant ce coup. */
  mill: boolean
}

export interface SceneCallbacks {
  onShot?: (power: number) => void
  onStrokeEnd?: (r: StrokeResult) => void
  /** Chaque image pendant que la balle roule. */
  onRolling?: (pos: Vec3) => void
}

export interface SceneOptions {
  dark: boolean
  /** Vue télé : trou à l'horizontale. */
  landscape?: boolean
  /** Horloge serveur (ms) : moulin synchronisé pour tout le monde. */
  now: () => number
  callbacks: SceneCallbacks
  /** Ma balle (absente en télé / spectateur). */
  ball?: { color: string; /** Balle spéciale (cadeau / boutique). */ style?: 'snowman' | 'disco'; /** Couleur de la bande. */ stripe?: string }
  frame?: Frame
  /** Taille des têtes des fantômes. */
  ghostScale?: number
}

export interface GhostInfo {
  color: string
  sprite: string
}

/** État d'une balle diffusée : 0 roule, 1 arrêtée, 2 dans le trou. */
export type GhostState = 0 | 1 | 2

interface Ghost {
  grp: THREE.Group
  ball: THREE.Mesh
  head: THREE.Sprite
  cur: THREE.Vector3
  target: THREE.Vector3
  state: GhostState
  shown: boolean
}

interface Fx {
  t: number
  dur: number
  update: (k: number) => void
  end?: () => void
}

export class GolfScene {
  private container: HTMLElement
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private rig: CameraRig
  private light: THREE.DirectionalLight
  private audio = new GolfAudio()
  private o: SceneOptions
  private course: CourseView | null = null
  private phys: GolfPhysics | null = null
  private hole: HoleDef | null = null
  private ballGrp = new THREE.Group()
  private ballMesh: THREE.Mesh
  private ringMesh: THREE.Mesh
  private arrow = new THREE.Group()
  private arrowMat = new THREE.MeshBasicMaterial({ color: '#2ECC71', transparent: true, opacity: 0.95, depthTest: false })
  private arrowShaft: THREE.Mesh
  private arrowHead: THREE.Mesh
  private dots: THREE.Mesh[] = []
  private canShoot = false
  private hasBall: boolean
  private drag: Drag | null = null
  private sinking = false
  private ghosts = new Map<string, Ghost>()
  private texLoader = new THREE.TextureLoader()
  private textures = new Map<string, THREE.Texture>()
  private fx: Fx[] = []
  private acc = 0
  private raf = 0
  private last = 0
  private disposed = false
  private hidden = false
  private dirty = true
  private water = false
  private fall = false
  private out = false
  private cleanups: Array<() => void> = []
  private shared: THREE.BufferGeometry[] = []
  private sharedMats: THREE.Material[] = []
  private ray = new THREE.Raycaster()
  private tmp = new THREE.Vector3()
  private tmp2 = new THREE.Vector3()
  private q = new THREE.Quaternion()
  private axis = new THREE.Vector3()

  constructor(container: HTMLElement, opts: SceneOptions) {
    this.container = container
    this.o = opts
    this.hasBall = !!opts.ball
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

    const bg = new THREE.Color(opts.dark ? '#1A2E2A' : '#CFEFFF')
    this.scene.background = bg
    this.scene.fog = new THREE.Fog(bg, 18, 40)
    this.scene.add(new THREE.HemisphereLight('#ffffff', opts.dark ? '#2b3d5c' : '#ffe2b0', opts.dark ? 1.5 : 1.9))
    const light = new THREE.DirectionalLight('#fff3dc', opts.dark ? 2.0 : 2.4)
    light.castShadow = true
    light.shadow.mapSize.set(1024, 1024)
    light.shadow.bias = -0.0006
    this.scene.add(light, light.target)
    this.light = light

    this.rig = new CameraRig(!!opts.landscape)

    // Ma balle
    const disco = opts.ball?.style === 'disco'
    const ballGeo = this.geo(disco ? new THREE.IcosahedronGeometry(BALL_R, 1) : new THREE.SphereGeometry(BALL_R, 20, 14))
    const snowman = opts.ball?.style === 'snowman'
    const ballMat = this.mat(new THREE.MeshToonMaterial({ color: snowman ? '#F7FBFF' : disco ? '#D9DEE8' : (opts.ball?.color ?? '#ffffff') }))
    this.ballMesh = new THREE.Mesh(ballGeo, ballMat)
    this.ballMesh.castShadow = true
    const ink = this.mat(new THREE.MeshBasicMaterial({ color: '#1F1B2E', side: THREE.BackSide }))
    const ol = new THREE.Mesh(ballGeo, ink)
    ol.scale.setScalar(1.22)
    this.ballMesh.add(ol)
    const stripe = new THREE.Mesh(this.geo(new THREE.TorusGeometry(BALL_R * 0.98, BALL_R * 0.16, 6, 20)), this.mat(new THREE.MeshToonMaterial({ color: snowman ? '#E63946' : disco ? '#FF4D9D' : (opts.ball?.stripe ?? '#FFFFFF') })))
    this.ballMesh.add(stripe)
    if (snowman) {
      // nez carotte + 2 yeux charbon
      const nose = new THREE.Mesh(this.geo(new THREE.ConeGeometry(BALL_R * 0.22, BALL_R * 0.7, 8)), this.mat(new THREE.MeshToonMaterial({ color: '#FF8C42' })))
      nose.rotation.x = Math.PI / 2
      nose.position.set(0, BALL_R * 0.35, BALL_R * 1.15)
      this.ballMesh.add(nose)
      const eyeGeo = this.geo(new THREE.SphereGeometry(BALL_R * 0.12, 8, 6))
      const eyeMat = this.mat(new THREE.MeshBasicMaterial({ color: '#1F1B2E' }))
      for (const x of [-0.32, 0.32]) {
        const eye = new THREE.Mesh(eyeGeo, eyeMat)
        eye.position.set(BALL_R * x, BALL_R * 0.62, BALL_R * 0.8)
        this.ballMesh.add(eye)
      }
    }
    // balle un peu grossie à l'affichage (lisibilité sur téléphone), physique inchangée
    this.ballMesh.scale.setScalar(1.3)
    this.ballMesh.position.y = BALL_R * 0.3
    this.ballGrp.add(this.ballMesh)
    this.ringMesh = new THREE.Mesh(this.geo(new THREE.RingGeometry(BALL_R * 1.5, BALL_R * 1.9, 28)), this.mat(new THREE.MeshBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: 0.85, depthWrite: false })))
    this.ringMesh.rotation.x = -Math.PI / 2
    this.ringMesh.renderOrder = 2
    this.ballGrp.add(this.ringMesh)
    this.ballGrp.visible = false
    this.scene.add(this.ballGrp)

    // Flèche de visée (à plat, dessinée par-dessus)
    this.arrowShaft = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(1, 1)), this.arrowMat)
    this.arrowShaft.rotation.x = -Math.PI / 2
    const tri = new THREE.Shape()
    tri.moveTo(-0.17, 0)
    tri.lineTo(0.17, 0)
    tri.lineTo(0, 0.3)
    tri.closePath()
    this.arrowHead = new THREE.Mesh(this.geo(new THREE.ShapeGeometry(tri)), this.arrowMat)
    this.arrowHead.rotation.x = -Math.PI / 2
    const dotGeo = this.geo(new THREE.CircleGeometry(0.035, 10))
    const dotMat = this.mat(new THREE.MeshBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: 0.8, depthTest: false }))
    for (let i = 0; i < 6; i++) {
      const d = new THREE.Mesh(dotGeo, dotMat)
      d.rotation.x = -Math.PI / 2
      d.renderOrder = 3
      this.dots.push(d)
      this.arrow.add(d)
    }
    this.arrowShaft.renderOrder = 3
    this.arrowHead.renderOrder = 3
    this.arrow.add(this.arrowShaft, this.arrowHead)
    this.arrow.visible = false
    this.scene.add(this.arrow)

    const ro = new ResizeObserver(() => this.resize())
    ro.observe(container)
    this.cleanups.push(() => ro.disconnect())
    this.resize()

    const vis = () => {
      this.hidden = document.hidden
      if (this.hidden) {
        cancelAnimationFrame(this.raf)
        this.raf = 0
      } else if (!this.raf && !this.disposed) {
        this.last = performance.now()
        this.raf = requestAnimationFrame(this.loop)
      }
    }
    document.addEventListener('visibilitychange', vis)
    this.cleanups.push(() => document.removeEventListener('visibilitychange', vis))

    if (this.hasBall) {
      this.cleanups.push(
        attachInput(canvas, {
          enabled: () => this.canShoot && this.phys?.status === 'rest' && !this.sinking,
          onStart: () => this.audio.ensure(),
          onDrag: (d) => {
            this.drag = d
            this.dirty = true
          },
          onRelease: (d) => {
            this.drag = null
            this.dirty = true
            if (d) this.shoot(d)
          },
        }),
      )
    }

    this.last = performance.now()
    this.raf = requestAnimationFrame(this.loop)
  }

  /* ------------------------------------------------------------------------ */
  /* API                                                                       */
  /* ------------------------------------------------------------------------ */

  /** Charge un trou ; `ball` = position de ma balle (null : pas de balle, ex. trou fini). */
  loadHole(def: HoleDef, ball: Vec3 | null, intro = false) {
    if (this.course) {
      this.scene.remove(this.course.root)
      this.course.dispose()
    }
    this.hole = def
    this.course = buildCourse(def, this.o.dark)
    this.scene.add(this.course.root)
    this.phys = new GolfPhysics(def, this.o.now() / 1000)
    if (ball) this.phys.place(ball[0], ball[1], ball[2])
    this.sinking = false
    this.fx = []
    this.ballGrp.visible = this.hasBall && !!ball
    this.ballMesh.visible = true
    this.ballGrp.scale.setScalar(1)
    this.syncBall()
    for (const g of this.ghosts.values()) g.shown = false

    // Ombres : couvrent le trou
    const b = this.course.bounds
    const c = b.getCenter(new THREE.Vector3())
    const size = b.getSize(new THREE.Vector3())
    const half = Math.max(size.x, size.z) / 2 + 1
    const sc = this.light.shadow.camera
    sc.left = -half
    sc.right = half
    sc.top = half
    sc.bottom = -half
    sc.near = 0.5
    sc.far = 30
    sc.updateProjectionMatrix()
    this.light.target.position.set(c.x, 0, c.z)
    this.light.position.set(c.x + 3, 10, c.z + 4)

    this.refit()
    this.rig.snap()
    if (intro) this.rig.flyover(new THREE.Vector3(def.cup[0], def.cupY ?? 0, def.cup[1]))
    this.dirty = true
  }

  setCanShoot(on: boolean) {
    this.canShoot = on
    if (!on) this.drag = null
    this.dirty = true
  }

  /** Remet ma balle à une position (reprise après rechargement). */
  placeBall(p: Vec3 | null) {
    if (!this.phys) return
    if (p) this.phys.place(p[0], p[1], p[2])
    this.ballGrp.visible = this.hasBall && !!p
    this.ballMesh.visible = true
    this.syncBall()
    this.dirty = true
  }

  ballPosition(): Vec3 | null {
    if (!this.phys) return null
    const p = this.phys.ball.position
    return [p.x, p.y, p.z]
  }

  isRolling() {
    return !!this.phys && (this.phys.status === 'rolling' || this.phys.status === 'loop' || this.phys.status === 'tube')
  }

  setGhost(id: string, info: GhostInfo, pos: Vec3, state: GhostState) {
    let g = this.ghosts.get(id)
    if (!g) g = this.makeGhost(id, info)
    g.target.set(pos[0], pos[1], pos[2])
    if (!g.shown) g.cur.copy(g.target)
    g.shown = true
    g.state = state
    this.dirty = true
  }

  removeGhost(id: string) {
    const g = this.ghosts.get(id)
    if (!g) return
    this.scene.remove(g.grp)
    ;(g.ball.material as THREE.Material).dispose()
    ;(g.head.material as THREE.Material).dispose()
    this.ghosts.delete(id)
    this.dirty = true
  }

  ringBell() {
    const bell = this.course?.bell
    if (!bell) return
    this.audio.bell()
    this.fx.push({ t: 0, dur: 2.4, update: (k) => (bell.rotation.x = Math.sin(k * 14) * 0.6 * (1 - k)) })
  }

  /** Débloque l'audio (à appeler sur un geste). */
  unlockAudio() {
    this.audio.ensure()
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    for (const c of this.cleanups) c()
    this.cleanups = []
    this.audio.dispose()
    for (const id of [...this.ghosts.keys()]) this.removeGhost(id)
    for (const t of this.textures.values()) t.dispose()
    this.course?.dispose()
    for (const g of this.shared) g.dispose()
    for (const m of this.sharedMats) m.dispose()
    this.scene.clear()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.renderer.domElement.remove()
  }

  /* ------------------------------------------------------------------------ */

  private geo<T extends THREE.BufferGeometry>(g: T) {
    this.shared.push(g)
    return g
  }

  private mat<T extends THREE.Material>(m: T) {
    this.sharedMats.push(m)
    return m
  }

  private refit() {
    if (!this.course) return
    const land = !!this.o.landscape
    this.rig.fit(this.course.bounds, this.o.frame ?? (land ? { top: 0.1, bottom: 0.04, side: 0.04 } : { top: 0.11, bottom: 0.1, side: 0.03 }))
  }

  private resize() {
    const w = Math.max(1, this.container.clientWidth)
    const h = Math.max(1, this.container.clientHeight)
    this.renderer.setSize(w, h, false)
    this.rig.setAspect(w / h)
    this.refit()
    this.rig.snap()
    this.dirty = true
  }

  private makeGhost(id: string, info: GhostInfo): Ghost {
    const grp = new THREE.Group()
    const ball = new THREE.Mesh(this.ghostGeo(), new THREE.MeshToonMaterial({ color: info.color, transparent: true, opacity: 0.6, depthWrite: false }))
    grp.add(ball)
    let tex = this.textures.get(info.sprite)
    if (!tex) {
      tex = this.texLoader.load(info.sprite, () => (this.dirty = true))
      tex.colorSpace = THREE.SRGBColorSpace
      this.textures.set(info.sprite, tex)
    }
    const head = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.95 }))
    const s = 0.5 * (this.o.ghostScale ?? 1)
    head.scale.set(s, s, 1)
    head.position.y = BALL_R + s * 0.5
    head.renderOrder = 4
    grp.add(head)
    grp.visible = false
    this.scene.add(grp)
    const g: Ghost = { grp, ball, head, cur: new THREE.Vector3(), target: new THREE.Vector3(), state: 1, shown: false }
    this.ghosts.set(id, g)
    return g
  }

  private ghostGeometry: THREE.SphereGeometry | null = null
  private ghostGeo() {
    if (!this.ghostGeometry) this.ghostGeometry = this.geo(new THREE.SphereGeometry(BALL_R, 14, 10))
    return this.ghostGeometry
  }

  /** Point du sol (hauteur y) sous un point écran (px). */
  private groundAt(px: number, py: number, y: number, out: THREE.Vector3) {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    this.ray.setFromCamera(new THREE.Vector2((px / w) * 2 - 1, -(py / h) * 2 + 1), this.rig.camera)
    const r = this.ray.ray
    const t = (y - r.origin.y) / (r.direction.y || -1e-6)
    return out.copy(r.origin).addScaledVector(r.direction, Math.max(0, t))
  }

  /** Direction (monde, XZ) du tir pour un glissé écran : à l'opposé du doigt. */
  private aimDir(d: Drag): THREE.Vector3 | null {
    if (!this.phys) return null
    const b = this.phys.ball.position
    const s = this.tmp.set(b.x, b.y, b.z).project(this.rig.camera)
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    const sx = ((s.x + 1) / 2) * w
    const sy = ((1 - s.y) / 2) * h
    const len = Math.hypot(d.dx, d.dy) || 1
    const p = this.groundAt(sx - (d.dx / len) * 80, sy - (d.dy / len) * 80, b.y, this.tmp2)
    p.sub(this.tmp.set(b.x, b.y, b.z))
    p.y = 0
    if (p.lengthSq() < 1e-6) return null
    return p.normalize()
  }

  private shoot(d: Drag) {
    const ph = this.phys
    if (!ph || ph.status !== 'rest') return
    const dir = this.aimDir(d)
    if (!dir) return
    this.audio.ensure()
    this.audio.putt(d.power)
    vibrate(18)
    this.water = false
    this.fall = false
    this.out = false
    ph.shoot(dir.x, dir.z, d.power)
    this.o.callbacks.onShot?.(d.power)
    this.dirty = true
  }

  private syncBall() {
    if (!this.phys) return
    const p = this.phys.ball.position
    this.ballGrp.position.set(p.x, p.y, p.z)
  }

  private endStroke(holed: boolean) {
    const ph = this.phys!
    const p = ph.ball.position
    const pos: Vec3 = holed ? [this.hole!.cup[0], (this.hole!.cupY ?? 0) + BALL_R, this.hole!.cup[1]] : [p.x, p.y, p.z]
    this.o.callbacks.onStrokeEnd?.({ holed, water: this.water, fall: this.fall, out: this.out, pos, bounces: ph.bounces, mill: ph.millHit })
  }

  private splash(x: number, z: number) {
    const drops: THREE.Mesh[] = []
    const geo = this.ghostGeo()
    const mat = new THREE.MeshBasicMaterial({ color: '#E8F8FF', transparent: true })
    const vel: THREE.Vector3[] = []
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(geo, mat)
      m.scale.setScalar(0.5 + Math.random() * 0.6)
      m.position.set(x, -0.08, z)
      const a = (i / 12) * Math.PI * 2
      vel.push(new THREE.Vector3(Math.cos(a) * (0.6 + Math.random() * 0.6), 2.2 + Math.random() * 1.6, Math.sin(a) * (0.6 + Math.random() * 0.6)))
      this.scene.add(m)
      drops.push(m)
    }
    const ring = new THREE.Mesh(this.geo(new THREE.RingGeometry(0.1, 0.16, 24)), new THREE.MeshBasicMaterial({ color: '#FFFFFF', transparent: true, depthWrite: false }))
    ring.rotation.x = -Math.PI / 2
    ring.position.set(x, -0.085, z)
    this.scene.add(ring)
    this.fx.push({
      t: 0,
      dur: 0.9,
      update: (k) => {
        const t = k * 0.9
        drops.forEach((m, i) => {
          const v = vel[i]
          m.position.set(x + v.x * t, -0.08 + v.y * t - 4.9 * t * t, z + v.z * t)
        })
        mat.opacity = 1 - k
        ring.scale.setScalar(1 + k * 5)
        ;(ring.material as THREE.MeshBasicMaterial).opacity = 1 - k
      },
      end: () => {
        for (const m of drops) this.scene.remove(m)
        this.scene.remove(ring)
        mat.dispose()
        ;(ring.material as THREE.Material).dispose()
      },
    })
  }

  private handleEvents(events: ReturnType<GolfPhysics['step']>) {
    for (const e of events) {
      if (e.type === 'hit') {
        if (e.tag === 'bumper') {
          this.audio.boing()
          vibrate(25)
          const b = this.course?.bumpers.get(e.index)
          if (b) this.fx.push({ t: 0, dur: 0.3, update: (k) => b.scale.setScalar(1 + 0.3 * Math.sin(k * Math.PI)), end: () => b.scale.setScalar(1) })
        } else {
          this.audio.clack(e.speed)
          if (e.speed > 2.5) vibrate(10)
        }
      } else if (e.type === 'lip') this.audio.lip()
      else if (e.type === 'loop') this.audio.loop(e.ok)
      else if (e.type === 'water') {
        this.water = true
        this.audio.splash()
        vibrate([60, 40, 90])
        this.splash(e.x, e.z)
        // la balle réapparaît au point de frappe
        this.ballMesh.visible = false
        this.fx.push({ t: 0, dur: 0.7, update: () => undefined, end: () => (this.ballMesh.visible = true) })
        this.endStroke(false)
      } else if (e.type === 'fall') {
        this.fall = true
        this.audio.lip()
        vibrate([60, 40, 90])
        // la balle réapparaît au point de frappe
        this.ballMesh.visible = false
        this.fx.push({ t: 0, dur: 0.7, update: () => undefined, end: () => (this.ballMesh.visible = true) })
        this.endStroke(false)
      } else if (e.type === 'tube') this.audio.loop(true)
      else if (e.type === 'out') {
        this.out = true
        this.audio.lip()
        this.endStroke(false)
      } else if (e.type === 'stop') this.endStroke(false)
      else if (e.type === 'holed') this.sink()
    }
  }

  private sink() {
    const h = this.hole!
    const from = this.ballGrp.position.clone()
    const cy = (h.cupY ?? 0) + BALL_R
    this.sinking = true
    this.audio.cup()
    vibrate([30, 30, 60])
    this.fx.push({
      t: 0,
      dur: 0.45,
      update: (k) => {
        this.ballGrp.position.set(from.x + (h.cup[0] - from.x) * Math.min(1, k * 2), cy - k * k * 0.35, from.z + (h.cup[1] - from.z) * Math.min(1, k * 2))
      },
      end: () => {
        this.sinking = false
        this.ballGrp.visible = false
        if (hasBell(h)) this.ringBell()
        this.endStroke(true)
      },
    })
  }

  private loop = (now: number) => {
    if (this.disposed || this.hidden) return
    this.raf = requestAnimationFrame(this.loop)
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000))
    this.last = now
    const ph = this.phys
    const tNow = this.o.now() / 1000
    let moving = false

    if (ph) {
      const active = ph.status === 'rolling' || ph.status === 'loop' || ph.status === 'tube'
      if (active) {
        this.acc += dt
        let n = 0
        while (this.acc >= STEP && n < 12 && (ph.status === 'rolling' || ph.status === 'loop' || ph.status === 'tube')) {
          this.acc -= STEP
          n++
          this.handleEvents(ph.step(tNow - this.acc))
        }
        if (n === 12) this.acc = 0 // appareil trop lent : on ralentit plutôt que d'accumuler
      } else this.acc = 0
      if (ph.status === 'rolling' || ph.status === 'loop' || ph.status === 'tube') {
        moving = true
        const v = ph.ball.velocity
        const p = ph.ball.position
        const sp = Math.hypot(v.x, v.z)
        if (ph.status === 'loop') {
          this.axis.set(1, 0, 0)
          this.q.setFromAxisAngle(this.axis, -dt * 12)
          this.ballMesh.quaternion.premultiply(this.q)
        } else if (sp > 0.01) {
          this.axis.set(v.z, 0, -v.x).normalize()
          this.q.setFromAxisAngle(this.axis, (sp / BALL_R) * dt)
          this.ballMesh.quaternion.premultiply(this.q)
        }
        if (!this.sinking) this.ballGrp.position.set(p.x, p.y, p.z)
        this.o.callbacks.onRolling?.([p.x, p.y, p.z])
      } else if (!this.sinking && ph.status === 'rest') this.syncBall()
    }

    // Moulin (horloge serveur)
    const blades = this.course?.blades
    if (blades) {
      blades.rotation.z = -millAngle(tNow)
      moving = true
    }
    // Barrières mobiles (horloge serveur)
    for (const s of this.course?.sliders ?? []) {
      s.obj.position.x = sliderX(s.def, tNow)
      moving = true
    }
    // Portes (horloge serveur)
    for (const g of this.course?.gates ?? []) {
      g.obj.position.y = gateY(g.def, tNow)
      moving = true
    }

    // Anneau « à toi de jouer »
    const ready = this.canShoot && ph?.status === 'rest' && !this.sinking
    this.ringMesh.visible = ready && !this.drag
    if (this.ringMesh.visible) {
      const k = 1 + Math.sin(now / 220) * 0.12
      this.ringMesh.scale.setScalar(k)
      moving = true
    }

    // Flèche de visée
    if (this.drag && ready) {
      const dir = this.aimDir(this.drag)
      if (dir && ph) {
        const b = ph.ball.position
        const pw = this.drag.power
        const len = 0.25 + pw * 2.0
        this.arrowMat.color.setHSL((1 - pw) * 0.33, 0.85, 0.5)
        this.arrow.position.set(b.x, b.y - BALL_R + 0.03, b.z)
        this.arrow.rotation.y = Math.atan2(dir.x, dir.z)
        this.arrowShaft.scale.set(0.09 + pw * 0.05, len, 1)
        this.arrowShaft.position.set(0, 0, BALL_R + len / 2)
        this.arrowHead.position.set(0, 0, BALL_R + len - 0.02)
        this.arrowHead.scale.setScalar(0.8 + pw * 0.5)
        this.dots.forEach((d, i) => {
          d.position.set(0, 0, BALL_R + len + 0.35 + i * 0.28)
          d.visible = pw > 0.05
        })
        this.arrow.visible = true
      } else this.arrow.visible = false
    } else this.arrow.visible = false

    // Fantômes : interpolation douce vers la dernière position reçue
    const k = 1 - Math.exp(-dt * 10)
    for (const g of this.ghosts.values()) {
      const vis = g.shown && g.state !== 2
      g.grp.visible = vis
      if (!vis) continue
      if (g.cur.distanceToSquared(g.target) > 1e-6) {
        g.cur.lerp(g.target, k)
        moving = true
      }
      g.grp.position.copy(g.cur)
    }

    // Effets
    if (this.fx.length) {
      moving = true
      for (const f of [...this.fx]) {
        f.t += dt
        const kk = Math.min(1, f.t / f.dur)
        f.update(kk)
        if (kk >= 1) {
          this.fx.splice(this.fx.indexOf(f), 1)
          f.end?.()
        }
      }
    }

    if (this.rig.moving) moving = true
    this.rig.update(dt)
    if (!moving && !this.dirty) return
    this.renderer.render(this.scene, this.rig.camera)
    this.dirty = false
  }
}
