import * as THREE from 'three'
import { outline, toon } from './toon'

/** Couleurs des étincelles de dérapage (bleu, orange, violet). */
export const SPARKS = ['#4CC9F0', '#FF8C42', '#B388FF']

export interface KartModel {
  /** Racine : position au sol + cap. */
  root: THREE.Group
  /** Châssis : inclinaison (roulis / tangage) et saut. */
  chassis: THREE.Group
  bodyMat: THREE.MeshToonMaterial
  /** Les 4 roues (rotation autour de l'axe). */
  wheels: THREE.Group[]
  /** Pivots des roues avant (braquage). */
  steer: THREE.Group[]
  sparks: THREE.Mesh[]
  flame: THREE.Mesh
  bubbleMesh: THREE.Mesh
  cloudMesh: THREE.Group
  shadow: THREE.Mesh
}

// Géométries et matériaux partagés (créés une fois pour tous les karts).
let shared: ReturnType<typeof makeShared> | null = null

function roundedTrapezoid(back: number, front: number, wBack: number, wFront: number, r: number) {
  const s = new THREE.Shape()
  s.moveTo(back + r, -wBack)
  s.lineTo(front - r, -wFront)
  s.quadraticCurveTo(front, -wFront, front, -wFront + r)
  s.lineTo(front, wFront - r)
  s.quadraticCurveTo(front, wFront, front - r, wFront)
  s.lineTo(back + r, wBack)
  s.quadraticCurveTo(back, wBack, back, wBack - r)
  s.lineTo(back, -wBack + r)
  s.quadraticCurveTo(back, -wBack, back + r, -wBack)
  return s
}

function shadowTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 4, 32, 32, 32)
  grad.addColorStop(0, 'rgba(0,0,0,0.45)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(c)
}

function makeShared() {
  const body = new THREE.ExtrudeGeometry(roundedTrapezoid(-1.25, 1.3, 0.72, 0.5, 0.28), {
    depth: 0.3,
    bevelEnabled: true,
    bevelThickness: 0.08,
    bevelSize: 0.08,
    bevelSegments: 2,
    curveSegments: 6,
  })
  body.rotateX(-Math.PI / 2)
  const tire = new THREE.CylinderGeometry(1, 1, 1, 18)
  tire.rotateX(Math.PI / 2)
  const rim = new THREE.CylinderGeometry(1, 1, 1, 10)
  rim.rotateX(Math.PI / 2)
  return {
    body,
    tire,
    rim,
    capsule: new THREE.CapsuleGeometry(1, 1, 4, 10),
    box: new THREE.BoxGeometry(1, 1, 1),
    torus: new THREE.TorusGeometry(0.2, 0.045, 8, 18),
    cyl: new THREE.CylinderGeometry(1, 1, 1, 10),
    spark: new THREE.OctahedronGeometry(0.22),
    flame: new THREE.ConeGeometry(0.32, 1.3, 10),
    bubble: new THREE.SphereGeometry(2.1, 20, 14),
    puff: new THREE.SphereGeometry(1, 10, 8),
    shadow: new THREE.PlaneGeometry(3.4, 2.2),
    dark: toon('#2E2E3C'),
    rubber: toon('#22222A'),
    metal: toon('#D5DAE3'),
    seat: toon('#3C3C4A'),
    grey: toon('#6B6F85'),
    shadowMat: new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }),
  }
}

/** Kart low-poly arrondi : carrosserie, pontons, volant, moteur, 4 roues (braquage avant), pilote chibi. */
export function buildKart(color: string, sprite: string, variant: number, loader: THREE.TextureLoader): KartModel {
  const S = (shared ??= makeShared())
  const root = new THREE.Group()
  const chassis = new THREE.Group()
  root.add(chassis)
  const bodyMat = toon(color)
  const accent = toon(new THREE.Color(color).lerp(new THREE.Color('#FFFFFF'), 0.5))

  const put = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, parent: THREE.Object3D = chassis) => {
    const m = new THREE.Mesh(geo, mat)
    m.position.set(x, y, z)
    m.scale.set(sx, sy, sz)
    parent.add(m)
    return m
  }

  // carrosserie + pontons latéraux + pare-chocs
  put(S.body, bodyMat, 0, 0.32, 0).add(outline(S.body, 1.05))
  for (const z of [-0.66, 0.66]) {
    const pod = put(S.capsule, accent, -0.1, 0.42, z, 0.17, 0.55, 0.17)
    pod.rotation.z = Math.PI / 2
  }
  const bumper = put(S.capsule, S.dark, 1.42, 0.34, 0, 0.12, 0.55, 0.12)
  bumper.rotation.x = Math.PI / 2
  // siège, volant, moteur et échappements
  put(S.box, S.seat, -0.5, 0.82, 0, 0.5, 0.18, 0.62)
  put(S.box, S.seat, -0.76, 1.08, 0, 0.14, 0.55, 0.62)
  const column = put(S.cyl, S.dark, 0.32, 0.86, 0, 0.035, 0.42, 0.035)
  column.rotation.z = -0.9
  const wheel = put(S.torus, S.dark, 0.18, 1.02, 0)
  wheel.rotation.y = Math.PI / 2
  wheel.rotation.x = 0.6
  put(S.box, S.dark, -1.08, 0.68, 0, 0.42, 0.34, 0.7)
  for (const z of [-0.2, 0.2]) {
    const pipe = put(S.cyl, S.metal, -1.4, 0.72, z, 0.07, 0.4, 0.07)
    pipe.rotation.z = Math.PI / 2
  }

  // variantes : bolide (grand aileron), buggy (arceau), classique (petit becquet + phares)
  if (variant === 1) {
    for (const z of [-0.45, 0.45]) put(S.box, S.dark, -1.3, 0.92, z, 0.1, 0.4, 0.06)
    put(S.box, bodyMat, -1.36, 1.14, 0, 0.5, 0.08, 1.8)
    put(S.box, accent, -1.36, 1.2, 0, 0.4, 0.03, 1.82)
  } else if (variant === 2) {
    for (const z of [-0.5, 0.5]) put(S.cyl, S.metal, 0.15, 1.2, z, 0.05, 0.9, 0.05)
    const bar = put(S.cyl, S.metal, 0.15, 1.65, 0, 0.05, 1.05, 0.05)
    bar.rotation.x = Math.PI / 2
  } else {
    put(S.box, accent, -1.28, 1.0, 0, 0.3, 0.06, 1.2)
    for (const z of [-0.32, 0.32]) put(S.cyl, S.metal, 1.38, 0.55, z, 0.09, 0.05, 0.09).rotation.z = Math.PI / 2
  }

  // roues (avant dans un pivot de braquage)
  const wheels: THREE.Group[] = []
  const steer: THREE.Group[] = []
  const big = variant === 2 ? 1.12 : 1
  for (const [x, z, front] of [[0.9, 0.8, true], [0.9, -0.8, true], [-0.88, 0.84, false], [-0.88, -0.84, false]] as const) {
    const r = (front ? 0.32 : 0.38) * big
    const w = new THREE.Group()
    put(S.tire, S.rubber, 0, 0, 0, r, r, front ? 0.26 : 0.32, w).add(outline(S.tire, 1.1))
    put(S.rim, S.metal, 0, 0, 0, r * 0.55, r * 0.55, (front ? 0.26 : 0.32) + 0.02, w)
    put(S.box, S.dark, 0, 0, 0, r * 1.5, r * 0.25, (front ? 0.26 : 0.32) + 0.04, w)
    if (front) {
      const pivot = new THREE.Group()
      pivot.position.set(x, r, z)
      pivot.add(w)
      chassis.add(pivot)
      steer.push(pivot)
    } else {
      w.position.set(x, r, z)
      chassis.add(w)
    }
    wheels.push(w)
  }

  // étincelles de dérapage, flamme de turbo
  const sparks: THREE.Mesh[] = []
  for (const z of [-0.84, 0.84]) {
    const s = put(S.spark, new THREE.MeshBasicMaterial({ color: SPARKS[0] }), -1.35, 0.15, z)
    s.visible = false
    sparks.push(s)
  }
  const flame = put(S.flame, new THREE.MeshBasicMaterial({ color: '#FFB627', transparent: true, opacity: 0.9 }), -1.95, 0.72, 0)
  flame.rotation.z = Math.PI / 2
  flame.visible = false

  // pilote (chibi de sa tenue)
  const tex = loader.load(sprite)
  tex.colorSpace = THREE.SRGBColorSpace
  const pilot = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex }))
  pilot.scale.set(1.9, 1.9, 1)
  pilot.position.set(-0.4, 1.62, 0)
  chassis.add(pilot)

  // bulle de protection, nuage (malus)
  const bubbleMesh = put(S.bubble, new THREE.MeshBasicMaterial({ color: '#7FDBFF', transparent: true, opacity: 0.28, depthWrite: false }), 0, 1.2, 0)
  bubbleMesh.visible = false
  const cloudMesh = new THREE.Group()
  for (const [x, z, s] of [[0, 0, 0.9], [0.7, 0.2, 0.7], [-0.7, -0.1, 0.75], [0.1, 0.6, 0.6]]) put(S.puff, S.grey, x, 0, z, s, s, s, cloudMesh)
  cloudMesh.position.y = 3.6
  cloudMesh.visible = false
  chassis.add(cloudMesh)

  // ombre portée (reste au sol pendant les sauts)
  const shadow = new THREE.Mesh(S.shadow, S.shadowMat)
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = 0.04
  root.add(shadow)

  return { root, chassis, bodyMat, wheels, steer, sparks, flame, bubbleMesh, cloudMesh, shadow }
}
