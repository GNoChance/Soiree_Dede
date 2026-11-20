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
 * (serveur) passée à `step(t)`, de même que les barrières mobiles (`slider`). Looping : trajectoire SCRIPTÉE
 * (seul obstacle truqué, pour la fiabilité).
 */
import * as CANNON from 'cannon-es'
import { floorHeight, type HoleDef, type Piece, type Skin } from '../holes'

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

export type BallStatus = 'rest' | 'rolling' | 'loop' | 'tube' | 'holed'
export type Tag = 'floor' | 'wall' | 'post' | 'bumper' | 'mill' | 'blade' | 'slider' | 'gate'

export type PhysEvent =
  | { type: 'hit'; tag: Tag; speed: number; index: number }
  | { type: 'lip' }
  | { type: 'holed' }
  | { type: 'water'; x: number; z: number }
  /** Chute dans le vide (trou `void`) : +1 coup, retour au point de frappe. */
  | { type: 'fall'; x: number; y: number; z: number }
  | { type: 'out' }
  | { type: 'tube' }
  | { type: 'tube_end' }
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

type SliderDef = Extract<Piece, { kind: 'slider' }>
type GateDef = Extract<Piece, { kind: 'gate' }>
type TubeDef = Extract<Piece, { kind: 'tube' }>

/** Revêtements : multiplicateurs [décélération, traînée] du roulement. */
const SURFACE: Partial<Record<Skin, [number, number]>> = { ice: [0.2, 0.3], sand: [3.4, 2.5], snow: [3.4, 2.5] }

/** Porte : hauteur de la herse. */
export const GATE_H = 0.45
/** Porte : levée de 0 (rentrée dans le sol, ~44 % du temps) à 1 (fermée, ~30 % du temps) à l'instant t. */
export function gateLift(p: GateDef, t: number) {
  return clamp(0.25 + 1.25 * Math.sin(Math.PI * 2 * (t / p.period + (p.phase ?? 0))), 0, 1)
}
/** Porte : hauteur du centre de la herse à l'instant t. */
export const gateY = (p: GateDef, t: number) => (p.y ?? 0) + gateLift(p, t) * GATE_H - GATE_H / 2 - 0.03

/** Tube : rayon de l'embouchure qui avale la balle. */
export const TUBE_MOUTH = 0.24
/** Tube : point (x, y, z) du centre de la balle à l'avancement k (0..1), le long d'une courbe de Bézier en cloche. */
export function tubePoint(p: TubeDef, k: number): [number, number, number] {
  const ya = (p.ya ?? 0) + BALL_R
  const yb = (p.yb ?? 0) + BALL_R
  const top = Math.max(ya, yb) + (p.arc ?? 0.8)
  const u = 1 - k
  return [u * p.a[0] + k * p.b[0], u * u * ya + 2 * u * k * top + k * k * yb, u * p.a[1] + k * p.b[1]]
}

/** Barrière mobile : abscisse du centre du bloc à l'instant t (s). */
export function sliderX(p: SliderDef, t: number) {
  const amp = (p.x1 - p.x0 - p.w) / 2
  return (p.x0 + p.x1) / 2 + amp * Math.sin(Math.PI * 2 * (t / p.period + (p.phase ?? 0)))
}

/** Barrière mobile : vitesse du bloc (u/s) à l'instant t. */
export function sliderV(p: SliderDef, t: number) {
  const amp = (p.x1 - p.x0 - p.w) / 2
  const w = (Math.PI * 2) / p.period
  return amp * w * Math.cos(w * t + Math.PI * 2 * (p.phase ?? 0))
}

/** Hauteur d'une barrière mobile. */
export const SLIDER_H = 0.32

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
  private sliders: Array<{ body: CANNON.Body; def: SliderDef }> = []
  private gates: Array<{ body: CANNON.Body; def: GateDef }> = []
  private tubes: TubeDef[] = []
  private tubeRun: { def: TubeDef; k: number; v: number; len: number } | null = null
  private loops: LoopDef[] = []
  private loopRun: LoopRun | null = null
  private loopCool = false
  private lipped = false
  private slow = 0
  private events: PhysEvent[] = []
  private pendingBump: CANNON.Body | null = null
  private gateHit = false
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
    this.sliders = []
    this.gates = []
    this.tubes = []
    this.tubeRun = null
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
      slider: new CANNON.Material('slider'),
      gate: new CANNON.Material('gate'),
    }
    const rest: Record<Tag, number> = { floor: 0, wall: 0.62, post: 0.6, bumper: 0.9, mill: 0.55, blade: 0.6, slider: 0.6, gate: 0.5 }
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
    } else if (p.kind === 'ramp' && p.axis === 'x') {
      // dévers : pente le long de X (rotation autour de Z)
      const dx = p.x1 - p.x0
      const dy = p.y1 - p.y0
      const len = Math.hypot(dx, dy)
      const psi = Math.atan2(dy, dx)
      const b = box(len / 2, FLOOR_T / 2, (p.z1 - p.z0) / 2)
      b.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 0, 1), psi)
      const nx = -Math.sin(psi)
      const ny = Math.cos(psi)
      b.position.set((p.x0 + p.x1) / 2 - (nx * FLOOR_T) / 2, (p.y0 + p.y1) / 2 - (ny * FLOOR_T) / 2, (p.z0 + p.z1) / 2)
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
      b.position.set(p.x, (p.y ?? 0) + h / 2 - 0.1, p.z)
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
    } else if (p.kind === 'slider') {
      const b = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, shape: new CANNON.Box(new CANNON.Vec3(p.w / 2, SLIDER_H / 2, (p.d ?? 0.3) / 2)) })
      b.position.set((p.x0 + p.x1) / 2, SLIDER_H / 2 - 0.02, p.z)
      add(b, 'slider', index)
      this.sliders.push({ body: b, def: p })
    } else if (p.kind === 'gate') {
      const b = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, shape: new CANNON.Box(new CANNON.Vec3((p.x1 - p.x0) / 2, GATE_H / 2, (p.d ?? 0.2) / 2)) })
      b.position.set((p.x0 + p.x1) / 2, gateY(p, 0), p.z)
      add(b, 'gate', index)
      this.gates.push({ body: b, def: p })
    } else if (p.kind === 'tube') {
      this.tubes.push(p)
    } else if (p.kind === 'loop') {
      this.loops.push({ z: p.z, r: p.r, x0: p.x0, x1: p.x1, halfWidth: p.halfWidth })
    }
  }

  private setMill(t: number) {
    for (const s of this.sliders) {
      s.body.position.x = sliderX(s.def, t)
      s.body.velocity.set(sliderV(s.def, t), 0, 0)
    }
    for (const g of this.gates) {
      g.body.position.y = gateY(g.def, t)
      g.body.velocity.set(0, (gateY(g.def, t + 0.01) - gateY(g.def, t)) / 0.01, 0)
    }
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
    if (info.tag === 'gate' || info.tag === 'blade') this.gateHit = true
    if (info.tag === 'blade') this.millHit = true
    const last = this.lastWallAt.get(e.body) ?? -1
    if (this.strokeTime - last < 0.12) return
    this.lastWallAt.set(e.body, this.strokeTime)
    if (speed < 0.25 && info.tag !== 'bumper') return
    if (speed > 0.5 && (info.tag === 'wall' || info.tag === 'post' || info.tag === 'mill' || info.tag === 'bumper' || info.tag === 'slider' || info.tag === 'gate')) this.bounces++
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
    this.tubeRun = null
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
      if (this.mill || this.sliders.length || this.gates.length) this.world.step(STEP) // pales / barrières seulement (la balle cinématique ne bouge pas)
      return this.events
    }
    this.strokeTime += STEP
    if (this.status === 'loop') {
      this.stepLoop()
      return this.events
    }
    if (this.status === 'tube') {
      this.stepTube()
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

    // Herse qui monte sous la balle, pale du moulin qui la fauche : elles la repoussent, sans la catapulter par-dessus les bordures.
    if (this.gateHit) {
      if (b.velocity.y > 0.8) b.velocity.y = 0.8
      this.gateHit = false
    }

    // Contact au sol : roulement simulé (décélération constante + traînée).
    this.grounded = false
    let surface: [number, number] | undefined
    for (const eq of this.world.contacts) {
      if (eq.bi !== b && eq.bj !== b) continue
      const other = eq.bi === b ? eq.bj : eq.bi
      const info = this.tags.get(other)
      if (info?.tag !== 'floor') continue
      const ny = eq.bi === b ? -eq.ni.y : eq.ni.y
      if (ny > 0.5) {
        this.grounded = true
        const piece = this.hole.pieces[info.index]
        surface = (piece.kind === 'floor' || piece.kind === 'ramp') && piece.skin ? (SURFACE[piece.skin] ?? surface) : surface
      }
    }
    let sp = this.speed()
    if (this.grounded && sp > 0) {
      const [kd, kv] = surface ?? [1, 1]
      const ns = Math.max(0, sp - (ROLL_DECEL * kd + DRAG * kv * sp) * STEP)
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

    // Tube : la balle qui roule dans l'embouchure est avalée.
    for (const T of this.tubes) {
      if (Math.hypot(x - T.a[0], z - T.a[1]) < TUBE_MOUTH && Math.abs(y - ((T.ya ?? 0) + BALL_R)) < 0.15) {
        let len = 0
        let prev = tubePoint(T, 0)
        for (let i = 1; i <= 16; i++) {
          const q = tubePoint(T, i / 16)
          len += Math.hypot(q[0] - prev[0], q[1] - prev[1], q[2] - prev[2])
          prev = q
        }
        this.tubeRun = { def: T, k: 0, v: clamp(sp, 2.2, 6), len }
        b.type = CANNON.Body.KINEMATIC
        b.velocity.setZero()
        this.status = 'tube'
        this.events.push({ type: 'tube' })
        return this.events
      }
    }

    // Eau / vide / hors piste.
    for (const w of this.hole.water ?? []) {
      if (y < 0.02 && x > w.x0 && x < w.x1 && z > w.z0 && z < w.z1) {
        this.events.push({ type: 'water', x, z })
        this.place(this.lastHit[0], this.lastHit[1], this.lastHit[2])
        return this.events
      }
    }
    const B = this.bounds
    const away = x < B.x0 - 1 || x > B.x1 + 1 || z < B.z0 - 1 || z > B.z1 + 1
    if (this.hole.void && (y < -0.6 || away)) {
      this.events.push({ type: 'fall', x, y, z })
      this.place(this.lastHit[0], this.lastHit[1], this.lastHit[2])
      return this.events
    }
    if (y < -1.2 || away) {
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
      const [px, pz] = this.clearOfSliders(b.position.x, b.position.z)
      this.place(px, px === b.position.x && pz === b.position.z ? b.position.y : this.floorY(px, pz) + BALL_R, pz)
      this.events.push({ type: 'stop' })
    }
    return this.events
  }

  /** Une balle ne s'arrête jamais sous la course d'une barrière mobile ou d'une porte : poussée juste devant ou derrière. */
  private clearOfSliders(x: number, z: number): [number, number] {
    for (const p of [...this.sliders.map((s) => ({ ...s.def, d: s.def.d ?? 0.3 })), ...this.gates.map((g) => ({ ...g.def, d: g.def.d ?? 0.2 }))]) {
      const half = p.d / 2 + BALL_R + 0.02
      if (x > p.x0 - BALL_R && x < p.x1 + BALL_R && Math.abs(z - p.z) < half) z = p.z + (z >= p.z ? half + 0.03 : -half - 0.03)
    }
    return [x, z]
  }

  /** Dans le tube : avance le long de la courbe, puis ressort en b dans la direction dir. */
  private stepTube() {
    const r = this.tubeRun!
    const b = this.ball
    r.k += (r.v * STEP) / r.len
    if (r.k >= 1) {
      const T = r.def
      const n = Math.hypot(T.dir[0], T.dir[1]) || 1
      const dx = T.dir[0] / n
      const dz = T.dir[1] / n
      b.type = CANNON.Body.DYNAMIC
      b.position.set(T.b[0] + dx * 0.05, (T.yb ?? 0) + BALL_R + 0.01, T.b[1] + dz * 0.05)
      const v = Math.max(1.6, r.v * 0.9)
      b.velocity.set(dx * v, 0, dz * v)
      this.status = 'rolling'
      this.tubeRun = null
      this.prevZ = b.position.z
      this.events.push({ type: 'tube_end' })
      return
    }
    const [x, y, z] = tubePoint(r.def, r.k)
    b.position.set(x, y, z)
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
    let fall = false
    let out = false
    let holed = false
    for (let i = 0; i < maxSteps && this.status !== 'rest' && this.status !== 'holed'; i++) {
      t += STEP
      for (const e of this.step(t)) {
        if (e.type === 'water') water = true
        if (e.type === 'fall') fall = true
        if (e.type === 'out') out = true
        if (e.type === 'holed') holed = true
      }
    }
    const p = this.ball.position
    return { holed, water, fall, out, x: p.x, y: p.y, z: p.z, time: t - t0, bounces: this.bounces, mill: this.millHit }
  }
}
