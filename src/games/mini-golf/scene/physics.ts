/**
 * Physique du mini-golf (cannon-es, SANS three : utilisable par la page de test hors rendu).
 *
 * Un trou = assemblage de PRIMITIVES (dalles, rampes et bordures en boîtes, plots/bumpers en cylindres),
 * jamais de maillage triangulé. Pas fixe 1/120 s. La balle GLISSE sans frottement de contact
 * (stable et prévisible) ; le roulement est simulé à la main : décélération constante + traînée quand
 * elle touche le sol, vitesse bornée (anti-tunnel), rotation visuelle calculée par la scène.
 *
 * Le trou n'est pas creusé : la balle est « avalée » sous une vitesse seuil, sinon elle saute
 * par-dessus avec une petite déviation. Moulin : corps cinématique dont l'angle dépend de l'horloge
 * (serveur) passée à `step(t)`. Looping : trajectoire SCRIPTÉE (seul obstacle truqué, pour la fiabilité).
 */
import * as CANNON from 'cannon-es'
import { floorHeight, type HoleDef, type Piece } from '../holes'

export const STEP = 1 / 120
export const G = 9.81
export const BALL_R = 0.1
export const CUP_R = 0.17
/** Vitesse max d'un tir / de la balle (u/s) : < BALL_R / STEP × 0,7, pas d'effet tunnel. */
export const VMAX = 8.5
export const VMIN_SHOT = 0.5
export const ROLL_DECEL = 1.9
export const DRAG = 0.22
/** Au-delà, la balle passe par-dessus le trou. */
export const SINK_V = 1.7
/** Moulin : vitesse angulaire (rad/s), hauteur du moyeu, longueur des pales. */
export const MILL_W = 0.95
export const MILL_HUB_Y = 1.25
export const MILL_BLADE = 1.25
/** Looping : élan minimum. */
export const LOOP_V = 3.9
const FLOOR_T = 0.3
const WALL_T = 0.14

export type BallStatus = 'rest' | 'rolling' | 'loop' | 'holed'
export type Tag = 'floor' | 'wall' | 'post' | 'bumper' | 'mill' | 'blade'

export type PhysEvent =
  | { type: 'hit'; tag: Tag; speed: number; index: number }
  | { type: 'lip' }
  | { type: 'holed' }
  | { type: 'water'; x: number; z: number }
  | { type: 'out' }
  | { type: 'stop' }
  | { type: 'loop'; ok: boolean }
  | { type: 'loop_end' }

interface LoopDef {
  z: number
  r: number
  x0: number
  x1: number
  halfWidth: number
}

interface LoopRun {
  def: LoopDef
  theta: number
  v0: number
  ok: boolean
  up: boolean
  xIn: number
  thetaMax: number
}

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)

/** Vitesse de tir (u/s) pour une puissance 0..1. */
export const shotSpeed = (power: number) => VMIN_SHOT + (VMAX - VMIN_SHOT) * Math.pow(clamp(power, 0, 1), 1.15)

/** Angle des pales du moulin à l'instant t (s). */
export const millAngle = (t: number) => (t * MILL_W) % (Math.PI * 2)

/** Position (x, y, z) de la balle dans le looping pour l'angle θ. */
export function loopPoint(def: LoopDef, theta: number, xIn: number): [number, number, number] {
  const rc = def.r - BALL_R
  const track = def.x0 + ((def.x1 - def.x0) * clamp(theta, 0, Math.PI * 2)) / (Math.PI * 2)
  const k = clamp(theta / (Math.PI * 0.5), 0, 1)
  const x = xIn + (track - xIn) * (k * k * (3 - 2 * k))
  return [x, BALL_R + rc * (1 - Math.cos(theta)), def.z - rc * Math.sin(theta)]
}

export class GolfPhysics {
  world!: CANNON.World
  ball!: CANNON.Body
  hole!: HoleDef
  status: BallStatus = 'rest'
  /** Point de frappe du coup en cours (retour en cas d'eau / hors piste). */
  lastHit: [number, number, number] = [0, BALL_R, 0]
  /** Compteurs du coup en cours. */
  bounces = 0
  millHit = false
  strokeTime = 0
  grounded = false
  private tags = new Map<CANNON.Body, { tag: Tag; index: number }>()
  private mill: CANNON.Body | null = null
  private loops: LoopDef[] = []
  private loopRun: LoopRun | null = null
  private loopCool = false
  private lipped = false
  private slow = 0
  private events: PhysEvent[] = []
  private pendingBump: CANNON.Body | null = null
  private lastWallAt = new Map<CANNON.Body, number>()
  private bounds = { x0: -5, x1: 5, z0: -6, z1: 6 }
  private prevZ = 0

  constructor(hole: HoleDef, t = 0) {
    this.load(hole, t)
  }

  /** (Re)construit le monde du trou ; la balle au départ, à l'arrêt. */
  load(hole: HoleDef, t = 0) {
    this.hole = hole
    this.tags.clear()
    this.loops = []
    this.mill = null
    this.loopRun = null
    this.events = []
    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -G, 0) })
    ;(world.solver as CANNON.GSSolver).iterations = 10
    world.defaultContactMaterial.friction = 0
    world.defaultContactMaterial.restitution = 0
    this.world = world

    const mBall = new CANNON.Material('ball')
    const mats: Record<Tag, CANNON.Material> = {
      floor: new CANNON.Material('floor'),
      wall: new CANNON.Material('wall'),
      post: new CANNON.Material('post'),
      bumper: new CANNON.Material('bumper'),
      mill: new CANNON.Material('mill'),
      blade: new CANNON.Material('blade'),
    }
    const rest: Record<Tag, number> = { floor: 0, wall: 0.62, post: 0.6, bumper: 0.9, mill: 0.55, blade: 0.6 }
    for (const k of Object.keys(mats) as Tag[]) {
      world.addContactMaterial(new CANNON.ContactMaterial(mBall, mats[k], { friction: 0, restitution: rest[k] }))
    }

    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
    const grow = (x: number, z: number) => {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z)
    }
    const add = (b: CANNON.Body, tag: Tag, index: number) => {
      b.material = mats[tag]
      world.addBody(b)
      this.tags.set(b, { tag, index })
    }
    hole.pieces.forEach((p, index) => this.build(p, index, add, grow))
    this.bounds = { x0, x1, z0, z1 }

    const ball = new CANNON.Body({ mass: 0.05, material: mBall, shape: new CANNON.Sphere(BALL_R), allowSleep: false })
    ball.linearDamping = 0
    ball.angularDamping = 1
    ball.fixedRotation = true
    ball.updateMassProperties()
    ball.addEventListener('collide', (e: { body: CANNON.Body; contact: CANNON.ContactEquation }) => this.collide(e))
    world.addBody(ball)
    this.ball = ball
    this.place(hole.tee[0], this.floorY(hole.tee[0], hole.tee[1]) + BALL_R, hole.tee[1])
    this.setMill(t)
  }

  /** Hauteur du sol (dalles / rampes) en (x, z), 0 par défaut. */
  floorY(x: number, z: number): number {
    return floorHeight(this.hole, x, z)
  }

  private build(p: Piece, index: number, add: (b: CANNON.Body, t: Tag, i: number) => void, grow: (x: number, z: number) => void) {
    const box = (hx: number, hy: number, hz: number) => new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(hx, hy, hz)) })
    if (p.kind === 'floor') {
      const y = p.y ?? 0
      const b = box((p.x1 - p.x0) / 2, FLOOR_T / 2, (p.z1 - p.z0) / 2)
      b.position.set((p.x0 + p.x1) / 2, y - FLOOR_T / 2, (p.z0 + p.z1) / 2)
      add(b, 'floor', index)
      grow(p.x0, p.z0)
      grow(p.x1, p.z1)
    } else if (p.kind === 'ramp') {
      const dz = p.z1 - p.z0
      const dy = p.y1 - p.y0
      const len = Math.hypot(dz, dy)
      const phi = Math.atan2(-dy, dz)
      const b = box((p.x1 - p.x0) / 2, FLOOR_T / 2, len / 2)
      b.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), phi)
      const ny = Math.cos(phi)
      const nz = Math.sin(phi)
      b.position.set((p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2 - (ny * FLOOR_T) / 2, (p.z0 + p.z1) / 2 - (nz * FLOOR_T) / 2)
      add(b, 'floor', index)
      grow(p.x0, p.z0)
      grow(p.x1, p.z1)
    } else if (p.kind === 'wall') {
      const [ax, az] = p.a
      const [bx, bz] = p.b
      const len = Math.hypot(bx - ax, bz - az)
      const y0 = p.y0 ?? -0.1
      const top = p.top ?? 0.3
      const b = box(len / 2 + WALL_T / 2, (top - y0) / 2, WALL_T / 2)
      b.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), Math.atan2(-(bz - az), bx - ax))
      b.position.set((ax + bx) / 2, (top + y0) / 2, (az + bz) / 2)
      add(b, 'wall', index)
      grow(ax, az)
      grow(bx, bz)
    } else if (p.kind === 'post' || p.kind === 'bumper') {
      const h = p.kind === 'post' ? 0.5 : 0.36
      const b = new CANNON.Body({ mass: 0, shape: new CANNON.Cylinder(p.r, p.r, h, 14) })
      b.position.set(p.x, h / 2 - 0.1, p.z)
      add(b, p.kind, index)
    } else if (p.kind === 'mill') {
      const back = p.front - p.depth
      const zc = (p.front + back) / 2
      for (const [a, c] of [[p.x0, p.cx - p.gap], [p.cx + p.gap, p.x1]]) {
        const b = box((c - a) / 2, 0.6, p.depth / 2)
        b.position.set((a + c) / 2, 0.5, zc)
        add(b, 'mill', index)
      }
      // toit du tunnel
      const roof = box(p.gap, 0.3, p.depth / 2)
      roof.position.set(p.cx, 0.75, zc)
      add(roof, 'mill', index)
      // pales (cinématiques) devant la façade
      const blades = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC })
      const half = MILL_BLADE / 2 - 0.02
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2
        const q = new CANNON.Quaternion()
        q.setFromAxisAngle(new CANNON.Vec3(0, 0, 1), a)
        blades.addShape(new CANNON.Box(new CANNON.Vec3(0.11, half, 0.04)), new CANNON.Vec3(-Math.sin(a) * (half + 0.04), Math.cos(a) * (half + 0.04), 0), q)
      }
      blades.position.set(p.cx, MILL_HUB_Y, p.front + 0.16)
      add(blades, 'blade', index)
      this.mill = blades
    } else if (p.kind === 'loop') {
      this.loops.push({ z: p.z, r: p.r, x0: p.x0, x1: p.x1, halfWidth: p.halfWidth })
    }
  }

  private setMill(t: number) {
    if (!this.mill) return
    this.mill.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 0, 1), -millAngle(t))
    this.mill.angularVelocity.set(0, 0, -MILL_W)
  }

  private collide(e: { body: CANNON.Body; contact: CANNON.ContactEquation }) {
    if (this.status !== 'rolling') return
    const info = this.tags.get(e.body)
    if (!info || info.tag === 'floor') return
    const speed = Math.abs(e.contact.getImpactVelocityAlongNormal())
    if (info.tag === 'bumper') this.pendingBump = e.body
    if (info.tag === 'blade') this.millHit = true
    const last = this.lastWallAt.get(e.body) ?? -1
    if (this.strokeTime - last < 0.12) return
    this.lastWallAt.set(e.body, this.strokeTime)
    if (speed < 0.25 && info.tag !== 'bumper') return
    if (speed > 0.5 && (info.tag === 'wall' || info.tag === 'post' || info.tag === 'mill' || info.tag === 'bumper')) this.bounces++
    this.events.push({ type: 'hit', tag: info.tag, speed, index: info.index })
  }

  /** Pose la balle (à l'arrêt). */
  place(x: number, y: number, z: number) {
    const b = this.ball
    b.type = CANNON.Body.KINEMATIC
    b.position.set(x, y, z)
    b.velocity.setZero()
    b.angularVelocity.setZero()
    this.status = 'rest'
    this.loopRun = null
    this.prevZ = z
  }

  /** Frappe : direction (dx, dz) normalisée par la fonction, puissance 0..1. */
  shoot(dx: number, dz: number, power: number) {
    if (this.status !== 'rest') return
    const n = Math.hypot(dx, dz) || 1
    const v = shotSpeed(power)
    const b = this.ball
    this.lastHit = [b.position.x, b.position.y, b.position.z]
    b.type = CANNON.Body.DYNAMIC
    b.mass = 0.05
    b.updateMassProperties()
    b.velocity.set((dx / n) * v, 0, (dz / n) * v)
    this.status = 'rolling'
    this.bounces = 0
    this.millHit = false
    this.strokeTime = 0
    this.lipped = false
    this.slow = 0
    this.loopCool = false
    this.lastWallAt.clear()
    this.prevZ = b.position.z
  }

  speed() {
    return this.ball.velocity.length()
  }

  /** Un pas fixe ; t = horloge (s) pour le moulin. Renvoie les événements du pas. */
  step(t: number): PhysEvent[] {
    this.events = []
    this.setMill(t)
    if (this.status === 'rest' || this.status === 'holed') {
      if (this.mill) this.world.step(STEP) // pales seulement (la balle cinématique ne bouge pas)
      return this.events
    }
    this.strokeTime += STEP
    if (this.status === 'loop') {
      this.stepLoop()
      return this.events
    }
    const b = this.ball
    this.world.step(STEP)

    // Bumper : renvoi plus fort, vers l'extérieur.
    if (this.pendingBump) {
      const c = this.pendingBump.position
      let nx = b.position.x - c.x
      let nz = b.position.z - c.z
      const nl = Math.hypot(nx, nz) || 1
      nx /= nl
      nz /= nl
      const sp = Math.min(VMAX, Math.max(this.speed() * 1.3, 3.4))
      let vx = b.velocity.x + nx * 1.5
      let vz = b.velocity.z + nz * 1.5
      if (vx * nx + vz * nz < 0.3) {
        vx = nx
        vz = nz
      }
      const vl = Math.hypot(vx, vz) || 1
      b.velocity.set((vx / vl) * sp, b.velocity.y, (vz / vl) * sp)
      this.pendingBump = null
    }

    // Contact au sol : roulement simulé (décélération constante + traînée).
    this.grounded = false
    for (const eq of this.world.contacts) {
      if (eq.bi !== b && eq.bj !== b) continue
      const other = eq.bi === b ? eq.bj : eq.bi
      if (this.tags.get(other)?.tag !== 'floor') continue
      const ny = eq.bi === b ? -eq.ni.y : eq.ni.y
      if (ny > 0.5) this.grounded = true
    }
    let sp = this.speed()
    if (this.grounded && sp > 0) {
      const ns = Math.max(0, sp - (ROLL_DECEL + DRAG * sp) * STEP)
      b.velocity.scale(ns / sp, b.velocity)
      sp = ns
    }
    if (sp > VMAX) {
      b.velocity.scale(VMAX / sp, b.velocity)
      sp = VMAX
    }

    const { x, y, z } = b.position

    // Looping : entrée franchie en avançant.
    for (const L of this.loops) {
      if (this.loopCool) {
        if (Math.abs(z - L.z) > 0.35) this.loopCool = false
        continue
      }
      if (this.prevZ > L.z && z <= L.z && b.velocity.z < 0 && Math.abs(x) < L.halfWidth && y < BALL_R + 0.15) {
        const v0 = Math.max(0.3, -b.velocity.z)
        const ok = v0 >= LOOP_V
        this.loopRun = { def: L, theta: 0, v0, ok, up: true, xIn: x, thetaMax: ok ? Math.PI * 2 : Math.PI * 0.45 * clamp(v0 / LOOP_V, 0.15, 1) }
        b.type = CANNON.Body.KINEMATIC
        b.velocity.setZero()
        this.status = 'loop'
        this.events.push({ type: 'loop', ok })
        this.prevZ = z
        return this.events
      }
    }
    this.prevZ = z

    // Eau / hors piste.
    for (const w of this.hole.water ?? []) {
      if (y < 0.02 && x > w.x0 && x < w.x1 && z > w.z0 && z < w.z1) {
        this.events.push({ type: 'water', x, z })
        this.place(this.lastHit[0], this.lastHit[1], this.lastHit[2])
        return this.events
      }
    }
    const B = this.bounds
    if (y < -1.2 || x < B.x0 - 1 || x > B.x1 + 1 || z < B.z0 - 1 || z > B.z1 + 1) {
      this.events.push({ type: 'out' })
      this.place(this.lastHit[0], this.lastHit[1], this.lastHit[2])
      return this.events
    }

    // Le trou.
    const cy = (this.hole.cupY ?? 0) + BALL_R
    const d = Math.hypot(x - this.hole.cup[0], z - this.hole.cup[1])
    if (Math.abs(y - cy) < 0.06) {
      if ((d < CUP_R && sp < SINK_V) || (d < CUP_R + 0.03 && sp < 0.3)) {
        b.type = CANNON.Body.KINEMATIC
        b.velocity.setZero()
        this.status = 'holed'
        this.events.push({ type: 'holed' })
        return this.events
      }
      if (d < CUP_R * 0.8 && !this.lipped) {
        // Trop vite : la balle saute par-dessus, légèrement déviée et freinée.
        this.lipped = true
        const side = (x - this.hole.cup[0]) * b.velocity.z - (z - this.hole.cup[1]) * b.velocity.x >= 0 ? 1 : -1
        const a = side * 0.25
        const vx = b.velocity.x * Math.cos(a) - b.velocity.z * Math.sin(a)
        const vz = b.velocity.x * Math.sin(a) + b.velocity.z * Math.cos(a)
        b.velocity.set(vx * 0.8, 0.6, vz * 0.8)
        this.events.push({ type: 'lip' })
      } else if (d > CUP_R * 1.5) this.lipped = false
    }

    // Arrêt.
    if (sp < 0.07 && (this.grounded || this.strokeTime > 1)) this.slow += STEP
    else this.slow = 0
    if (this.slow > 0.15 || this.strokeTime > 25) {
      this.place(b.position.x, b.position.y, b.position.z)
      this.events.push({ type: 'stop' })
    }
    return this.events
  }

  private stepLoop() {
    const r = this.loopRun!
    const b = this.ball
    const rc = r.def.r - BALL_R
    if (r.ok) {
      const h = BALL_R + rc * (1 - Math.cos(r.theta))
      const v = Math.max(r.v0 * 0.5, Math.sqrt(Math.max(0, r.v0 * r.v0 - 2 * G * h * 0.55)))
      r.theta += (v / rc) * STEP
      if (r.theta >= Math.PI * 2) {
        const [x, , z] = loopPoint(r.def, Math.PI * 2, r.xIn)
        b.type = CANNON.Body.DYNAMIC
        b.position.set(x, BALL_R, z - 0.01)
        b.velocity.set(0, 0, -r.v0 * 0.85)
        this.status = 'rolling'
        this.loopRun = null
        this.loopCool = true
        this.prevZ = b.position.z
        this.events.push({ type: 'loop_end' })
        return
      }
    } else {
      const f = Math.sqrt(Math.max(0.04, 1 - r.theta / r.thetaMax))
      if (r.up) {
        r.theta += ((r.v0 * f) / rc) * STEP
        if (r.theta >= r.thetaMax * 0.97) r.up = false
      } else {
        r.theta -= ((r.v0 * 0.8 * f) / rc) * STEP
        if (r.theta <= 0) {
          const [x, , z] = loopPoint(r.def, 0, r.xIn)
          b.type = CANNON.Body.DYNAMIC
          b.position.set(x, BALL_R, z + 0.02)
          b.velocity.set(0, 0, r.v0 * 0.7)
          this.status = 'rolling'
          this.loopRun = null
          this.loopCool = true
          this.prevZ = b.position.z
          this.events.push({ type: 'loop_end' })
          return
        }
      }
    }
    const [x, y, z] = loopPoint(r.def, r.theta, r.xIn)
    b.position.set(x, y, z)
  }

  /** Simule un coup complet hors rendu (tests) : renvoie le résultat et la position finale. */
  simulate(dx: number, dz: number, power: number, t0 = 0, maxSteps = 120 * 30) {
    this.shoot(dx, dz, power)
    let t = t0
    let water = false
    let out = false
    let holed = false
    for (let i = 0; i < maxSteps && this.status !== 'rest' && this.status !== 'holed'; i++) {
      t += STEP
      for (const e of this.step(t)) {
        if (e.type === 'water') water = true
        if (e.type === 'out') out = true
        if (e.type === 'holed') holed = true
      }
    }
    const p = this.ball.position
    return { holed, water, out, x: p.x, y: p.y, z: p.z, time: t - t0, bounces: this.bounces, mill: this.millHit }
  }
}
