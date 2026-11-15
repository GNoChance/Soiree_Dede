/**
 * Physique du bowling (cannon-es, SANS three : testable sous Node).
 *
 * Repère : piste le long de -Z, ligne de faute en z = 0, quille n°1 en
 * z = -LANE_LEN ; +X = droite du joueur ; Y = haut ; sol de la piste en y = 0.
 * Unités SI (m, kg, s). Pas fixe 1/120 s : pour des paramètres de lancer
 * identiques, la simulation est déterministe (monde reconstruit à chaque lancer).
 */
import * as CANNON from 'cannon-es'

export const STEP = 1 / 120

export const BALL_R = 0.109
export const BALL_MASS = 7
export const PIN_H = 0.38
export const PIN_MASS = 1.5
/** Hauteur du centre de masse d'une quille debout (origine du corps). */
export const PIN_COM = 0.14
export const LANE_LEN = 14
export const LANE_HALF = 0.53
export const GUTTER_W = 0.24
export const GUTTER_DEPTH = 0.08
/** Fin du plateau des quilles (au-delà : la fosse). */
export const DECK_END = -(LANE_LEN + 0.95)
export const PIT_FLOOR_Y = -0.45
export const BACK_WALL_Z = -(LANE_LEN + 1.75)
export const BALL_START_Z = -0.4
/** Décalage latéral max de la boule au départ. */
export const MAX_START_X = 0.42
export const SPEED_MIN = 4.5
export const SPEED_MAX = 10.5
export const MAX_ANGLE = (4.5 * Math.PI) / 180
/** Accélération latérale max de l'effet (m/s²), en fin de piste. */
export const HOOK_ACCEL = 1.25

const ROW = 0.2639 // 12 pouces × cos 30°
const COL = 0.1524 // 6 pouces
/** Emplacements des quilles 1..10 (x, z). 7-8-9-10 au fond, 7 à gauche. */
export const PIN_SPOTS: Array<[number, number]> = [
  [0, 0],
  [-COL, -ROW], [COL, -ROW],
  [-2 * COL, -2 * ROW], [0, -2 * ROW], [2 * COL, -2 * ROW],
  [-3 * COL, -3 * ROW], [-COL, -3 * ROW], [COL, -3 * ROW], [3 * COL, -3 * ROW],
].map(([x, z]) => [x, z - LANE_LEN] as [number, number])

export interface ThrowParams {
  /** Position latérale de départ (m, ±MAX_START_X). */
  x: number
  /** Vitesse (m/s, SPEED_MIN..SPEED_MAX). */
  speed: number
  /** Angle (rad, + = vers la droite). */
  angle: number
  /** Effet -1..1 (+ = la boule tourne vers la droite en fin de piste). */
  spin: number
}

export type ImpactKind = 'ball-pin' | 'pin-pin' | 'pin-floor' | 'wall'
export type ImpactListener = (kind: ImpactKind, speed: number) => void

/** Sous-forme d'une quille (sphères : collisions rapides et stables). */
const PIN_SPHERES: Array<[number, number]> = [
  // [rayon, hauteur du centre depuis le bas]
  [0.06, 0.12],
  [0.047, 0.2],
  [0.03, 0.27],
  [0.033, 0.335],
]
const FOOT_R = 0.016
const FOOT_RING = 0.026

export class BowlingPhysics {
  world!: CANNON.World
  ball!: CANNON.Body
  pins: CANNON.Body[] = []
  /** Quilles présentes sur le plateau au début du lancer (masque). */
  standing = 1023
  time = 0
  launched = false
  inGutter = false
  hitPins = false
  /** Temps du 1er contact boule-quille (s) ou -1. */
  firstHit = -1
  private ballOutAt = -1
  private calmFor = 0
  private spin = 0
  private steps = 0
  onImpact: ImpactListener | null = null
  private mats!: Record<'ball' | 'pin' | 'lane' | 'wall' | 'cushion', CANNON.Material>

  constructor(standing = 1023, startX = 0) {
    this.reset(standing, startX)
  }

  /** Reconstruit le monde : quilles debout de `standing` sur leurs emplacements, boule au départ. */
  reset(standing: number, startX = 0) {
    this.standing = standing & 1023
    this.time = 0
    this.steps = 0
    this.launched = false
    this.inGutter = false
    this.hitPins = false
    this.firstHit = -1
    this.ballOutAt = -1
    this.calmFor = 0
    this.spin = 0

    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0) })
    world.allowSleep = true
    ;(world.solver as CANNON.GSSolver).iterations = 12
    world.defaultContactMaterial.friction = 0.2
    world.defaultContactMaterial.restitution = 0.3
    this.world = world

    const m = {
      ball: new CANNON.Material('ball'),
      pin: new CANNON.Material('pin'),
      lane: new CANNON.Material('lane'),
      wall: new CANNON.Material('wall'),
      cushion: new CANNON.Material('cushion'),
    }
    this.mats = m
    const cm = (a: CANNON.Material, b: CANNON.Material, friction: number, restitution: number) =>
      world.addContactMaterial(new CANNON.ContactMaterial(a, b, { friction, restitution }))
    cm(m.ball, m.lane, 0.04, 0.05)
    cm(m.pin, m.lane, 0.35, 0.12)
    cm(m.ball, m.pin, 0.12, 0.6)
    cm(m.pin, m.pin, 0.25, 0.55)
    cm(m.pin, m.wall, 0.2, 0.45)
    cm(m.ball, m.wall, 0.1, 0.2)
    cm(m.pin, m.cushion, 0.6, 0.05)
    cm(m.ball, m.cushion, 0.6, 0.02)

    this.buildStatics()

    // Boule
    const ball = new CANNON.Body({
      mass: BALL_MASS,
      material: m.ball,
      shape: new CANNON.Sphere(BALL_R),
      linearDamping: 0.01,
      angularDamping: 0.01,
      allowSleep: false,
    })
    ball.position.set(clamp(startX, -MAX_START_X, MAX_START_X), BALL_R, BALL_START_Z)
    ball.type = CANNON.Body.KINEMATIC // immobile jusqu'au lancer
    world.addBody(ball)
    this.ball = ball

    // Quilles
    this.pins = PIN_SPOTS.map(([x, z], i) => {
      const body = new CANNON.Body({
        mass: PIN_MASS,
        material: m.pin,
        linearDamping: 0.05,
        angularDamping: 0.25,
        allowSleep: true,
        sleepSpeedLimit: 0.05,
        sleepTimeLimit: 0.4,
      })
      for (const [r, h] of PIN_SPHERES) body.addShape(new CANNON.Sphere(r), new CANNON.Vec3(0, h - PIN_COM, 0))
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2 + Math.PI / 4
        body.addShape(new CANNON.Sphere(FOOT_R), new CANNON.Vec3(Math.cos(a) * FOOT_RING, FOOT_R - PIN_COM, Math.sin(a) * FOOT_RING))
      }
      body.position.set(x, PIN_COM, z)
      if ((this.standing >> i) & 1) {
        world.addBody(body)
        body.sleep()
      }
      body.addEventListener('collide', (e: { body: CANNON.Body; contact: CANNON.ContactEquation }) => this.collide(body, e))
      return body
    })
  }

  private collide(pin: CANNON.Body, e: { body: CANNON.Body; contact: CANNON.ContactEquation }) {
    if (!this.onImpact) return
    const speed = Math.abs(e.contact.getImpactVelocityAlongNormal())
    if (speed < 0.25) return
    const other = e.body
    if (other === this.ball) this.onImpact('ball-pin', speed)
    else if (this.pins.includes(other)) {
      if (this.pins.indexOf(other) > this.pins.indexOf(pin)) this.onImpact('pin-pin', speed)
    } else if (other.material === this.mats.lane) this.onImpact('pin-floor', speed)
    else this.onImpact('wall', speed)
  }

  private box(hx: number, hy: number, hz: number, x: number, y: number, z: number, mat: CANNON.Material) {
    const b = new CANNON.Body({ mass: 0, material: mat, shape: new CANNON.Box(new CANNON.Vec3(hx, hy, hz)) })
    b.position.set(x, y, z)
    this.world.addBody(b)
    return b
  }

  private buildStatics() {
    const m = this.mats
    const deckLen = -DECK_END + 1.5 // de z=+1.5 à DECK_END
    const zMid = (1.5 + DECK_END) / 2
    // Piste + plateau (dessus en y = 0)
    this.box(LANE_HALF, 0.1, deckLen / 2, 0, -0.1, zMid, m.lane)
    // Gouttières (fond en y = -GUTTER_DEPTH) + bords extérieurs
    for (const s of [-1, 1]) {
      this.box(GUTTER_W / 2, 0.1, deckLen / 2, s * (LANE_HALF + GUTTER_W / 2), -GUTTER_DEPTH - 0.1, zMid, m.lane)
      this.box(0.03, 0.15, deckLen / 2, s * (LANE_HALF + GUTTER_W + 0.03), 0.05, zMid, m.wall)
      // Parois latérales hautes autour du plateau (« kickbacks »)
      this.box(0.05, 0.45, 1.6, s * (LANE_HALF + GUTTER_W + 0.05), 0.35, -LANE_LEN - 0.4, m.wall)
    }
    // Fosse : sol bas + rideau du fond (amorti)
    const pitLen = DECK_END - BACK_WALL_Z
    this.box(LANE_HALF + GUTTER_W + 0.1, 0.1, pitLen / 2 + 0.2, 0, PIT_FLOOR_Y - 0.1, (DECK_END + BACK_WALL_Z) / 2, m.cushion)
    this.box(LANE_HALF + GUTTER_W + 0.1, 0.6, 0.1, 0, 0.1, BACK_WALL_Z - 0.1, m.cushion)
  }

  setBallX(x: number) {
    if (this.launched) return
    this.ball.position.x = clamp(x, -MAX_START_X, MAX_START_X)
  }

  launch(p: ThrowParams) {
    if (this.launched) return
    const speed = clamp(p.speed, SPEED_MIN, SPEED_MAX)
    const angle = clamp(p.angle, -MAX_ANGLE, MAX_ANGLE)
    this.spin = clamp(p.spin, -1, 1)
    const b = this.ball
    b.type = CANNON.Body.DYNAMIC
    b.mass = BALL_MASS
    b.updateMassProperties()
    b.position.set(clamp(p.x, -MAX_START_X, MAX_START_X), BALL_R, BALL_START_Z)
    const vx = Math.sin(angle) * speed
    const vz = -Math.cos(angle) * speed
    b.velocity.set(vx, 0, vz)
    // Roulement sans glissement : ω × (0,-R,0) = -v
    b.angularVelocity.set(vz / BALL_R, 0, -vx / BALL_R)
    this.launched = true
  }

  /** Un pas fixe de 1/120 s. */
  step() {
    const b = this.ball
    if (this.launched) {
      const onLane = Math.abs(b.position.x) < LANE_HALF && b.position.y > BALL_R * 0.6 && b.position.z > DECK_END
      if (!this.inGutter && Math.abs(b.position.x) > LANE_HALF + 0.015 && b.position.z > -LANE_LEN + 0.3) {
        this.inGutter = true
      }
      if (this.inGutter && b.position.z > DECK_END) {
        // La boule reste au fond de la gouttière.
        const cx = Math.sign(b.position.x) * (LANE_HALF + GUTTER_W / 2)
        b.velocity.x = (cx - b.position.x) * 4
      } else if (onLane && this.spin !== 0 && !this.hitPins) {
        // Effet : accélération latérale croissante sur la fin de piste (zone sèche).
        const z = -b.position.z
        const ramp = clamp((z - LANE_LEN * 0.35) / (LANE_LEN * 0.4), 0, 1)
        const dv = this.spin * HOOK_ACCEL * ramp * STEP
        b.velocity.x += dv
        b.angularVelocity.z -= dv / BALL_R
      }
    }
    this.world.step(STEP)
    this.time += STEP
    this.steps++
    if (this.launched && this.firstHit < 0) {
      for (const p of this.pins) {
        if (p.world && p.position.distanceTo(b.position) < 0.25 && p.sleepState !== CANNON.Body.SLEEPING) {
          this.firstHit = this.time
          this.hitPins = true
          break
        }
      }
    }
    if (this.launched && this.ballOutAt < 0 && this.ballOut()) this.ballOutAt = this.time
    if (this.ballOutAt >= 0) {
      this.calmFor = this.pinsCalm() ? this.calmFor + STEP : 0
    }
  }

  ballSpeed() {
    return this.ball.velocity.length()
  }

  ballOut() {
    const b = this.ball
    return b.position.z < DECK_END - 0.05 || b.position.y < -0.2 || (this.time > 1 && this.ballSpeed() < 0.08)
  }

  private pinsCalm() {
    // Seules les quilles encore debout comptent (une quille couchée ne se relève pas).
    for (let i = 0; i < 10; i++) {
      const p = this.pins[i]
      if (!p.world || p.sleepState === CANNON.Body.SLEEPING || this.pinDown(i)) continue
      if (p.velocity.length() > 0.06 || p.angularVelocity.length() > 0.4) return false
    }
    return true
  }

  /** Lancer terminé (quilles immobiles, ou délais de sécurité). */
  isDone() {
    if (!this.launched) return false
    if (this.time > 14) return true
    if (this.ballOutAt < 0) return false
    return this.calmFor > 0.6 || this.time - this.ballOutAt > 3
  }

  /** Quille n° i+1 tombée (ou sortie du plateau) ? */
  pinDown(i: number) {
    const p = this.pins[i]
    if (!p.world) return true
    const up = p.quaternion.vmult(new CANNON.Vec3(0, 1, 0))
    return (
      up.y < 0.82 ||
      p.position.y < PIN_COM - 0.05 ||
      Math.abs(p.position.x) > LANE_HALF + 0.02 ||
      p.position.z < DECK_END
    )
  }

  /** Masque des quilles tombées PENDANT ce lancer (⊆ standing). */
  knockedMask() {
    let m = 0
    for (let i = 0; i < 10; i++) if ((this.standing >> i) & 1 && this.pinDown(i)) m |= 1 << i
    return m
  }

  /** Corps simulés dans l'ordre [boule, quille1..10] (les absents restent à leur place). */
  bodies() {
    return [this.ball, ...this.pins]
  }

  /** Simule un lancer complet hors-ligne (tests). */
  static simulate(standing: number, p: ThrowParams) {
    const sim = new BowlingPhysics(standing, p.x)
    sim.launch(p)
    while (!sim.isDone()) sim.step()
    return { mask: sim.knockedMask(), time: sim.time, gutter: sim.inGutter, hit: sim.firstHit }
  }
}

export function clamp(v: number, a: number, b: number) {
  return v < a ? a : v > b ? b : v
}
