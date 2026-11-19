/**
 * Rendu three d'un trou (style « sticker » : aplats toon, contours épais, couleurs franches).
 * Lit les mêmes primitives que la physique (holes.ts) + le décor de kermesse.
 */
import * as THREE from 'three'
import { floorHeight, type Decor, type HoleDef, type Piece, type Skin } from '../holes'
import { BALL_R, CUP_R, MILL_BLADE, MILL_HUB_Y, loopPoint } from './physics'

export const GROUND_Y = -0.35

let ramp: THREE.DataTexture | null = null
function gradient() {
  if (!ramp) {
    ramp = new THREE.DataTexture(new Uint8Array([120, 175, 225, 255]), 4, 1, THREE.RedFormat)
    ramp.minFilter = ramp.magFilter = THREE.NearestFilter
    ramp.needsUpdate = true
  }
  return ramp
}

export interface CourseView {
  root: THREE.Group
  /** Pales du moulin (rotation autour de Z). */
  blades: THREE.Group | null
  /** Bumpers (index de pièce → maillage, pour le « flash »). */
  bumpers: Map<number, THREE.Object3D>
  water: THREE.Mesh[]
  bell: THREE.Object3D | null
  /** Boîte englobante du parcours (cadrage caméra). */
  bounds: THREE.Box3
  dispose: () => void
}

interface Palette {
  ground: string
  grass: string
  green: string
  wood: string
  sand: string
  wall: string
  wallTop: string
  ink: string
}

const PAL_LIGHT: Palette = { ground: '#9ED98A', grass: '#2FBF5B', green: '#58D97A', wood: '#C98B55', sand: '#E9D3A1', wall: '#FF6B6B', wallTop: '#FFF4E0', ink: '#1F1B2E' }
const PAL_DARK: Palette = { ground: '#2C5A3E', grass: '#25A94F', green: '#46C46A', wood: '#B57A47', sand: '#CDB585', wall: '#F2545B', wallTop: '#FFE9C7', ink: '#0D0B16' }

export function buildCourse(hole: HoleDef, dark: boolean): CourseView {
  const P = dark ? PAL_DARK : PAL_LIGHT
  const root = new THREE.Group()
  const geos: THREE.BufferGeometry[] = []
  const mats = new Map<string, THREE.Material>()
  const toon = (c: string) => {
    const k = 't' + c
    let m = mats.get(k)
    if (!m) {
      m = new THREE.MeshToonMaterial({ color: c, gradientMap: gradient() })
      mats.set(k, m)
    }
    return m
  }
  const ink = (() => {
    const m = new THREE.MeshBasicMaterial({ color: P.ink, side: THREE.BackSide })
    mats.set('ink', m)
    return m
  })()
  const g = <T extends THREE.BufferGeometry>(x: T) => {
    geos.push(x)
    return x
  }
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D = root, cast = true, receive = true) => {
    const m = new THREE.Mesh(geo, mat)
    m.castShadow = cast
    m.receiveShadow = receive
    parent.add(m)
    return m
  }
  /** Contour : même forme grossie (relatif), vue de l'intérieur. */
  const outline = (geo: THREE.BufferGeometry, src: THREE.Object3D, grow = 1.08) => {
    const o = new THREE.Mesh(geo, ink)
    o.position.copy(src.position)
    o.quaternion.copy(src.quaternion)
    o.scale.copy(src.scale).multiplyScalar(grow)
    src.parent?.add(o)
    return o
  }
  const skinColor = (s: Skin | undefined) => (s === 'wood' ? P.wood : s === 'green' ? P.green : s === 'sand' ? P.sand : P.grass)
  const bounds = new THREE.Box3()
  const bumpers = new Map<number, THREE.Object3D>()
  const water: THREE.Mesh[] = []
  let blades: THREE.Group | null = null
  let bell: THREE.Object3D | null = null

  // Sol de la kermesse
  const ground = mesh(g(new THREE.PlaneGeometry(60, 60)), toon(P.ground), root, false, true)
  ground.rotation.x = -Math.PI / 2
  ground.position.y = GROUND_Y

  /** Bloc vertical de y0 à y1 (contour noir : rebord de 0,03 sur les côtés). */
  const block = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, color: string, outlined = true) => {
    const w = x1 - x0
    const d = z1 - z0
    const h = y1 - y0
    const m = mesh(g(new THREE.BoxGeometry(w, h, d)), toon(color))
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
    if (outlined) {
      const o = new THREE.Mesh(g(new THREE.BoxGeometry(w + 0.06, h + 0.03, d + 0.06)), ink)
      o.position.set(m.position.x, m.position.y - 0.015, m.position.z)
      root.add(o)
    }
    return m
  }

  for (const [index, p] of hole.pieces.entries()) buildPiece(p, index)
  for (const w of hole.water ?? []) {
    const m = mesh(g(new THREE.PlaneGeometry(w.x1 - w.x0, w.z1 - w.z0)), new THREE.MeshToonMaterial({ color: '#4CC9F0', gradientMap: gradient(), transparent: true, opacity: 0.88 }), root, false, true)
    mats.set('water' + water.length, m.material as THREE.Material)
    m.rotation.x = -Math.PI / 2
    m.position.set((w.x0 + w.x1) / 2, -0.1, (w.z0 + w.z1) / 2)
    water.push(m)
    // nénuphars + canard
    for (const [fx, fz, s] of [[0.2, 0.25, 1], [0.75, 0.7, 0.8], [0.15, 0.8, 0.7]]) {
      const pad = mesh(g(new THREE.CircleGeometry(0.13 * s, 10, 0.4, Math.PI * 1.8)), toon('#3FA34D'), root, false, false)
      pad.rotation.x = -Math.PI / 2
      pad.position.set(w.x0 + (w.x1 - w.x0) * fx, -0.09, w.z0 + (w.z1 - w.z0) * fz)
    }
    const duck = new THREE.Group()
    const body = mesh(g(new THREE.SphereGeometry(0.12, 12, 8)), toon('#FFD23F'), duck)
    body.scale.set(1.2, 0.8, 1)
    outline(g(new THREE.SphereGeometry(0.12, 12, 8)), body, 1.12)
    const head = mesh(g(new THREE.SphereGeometry(0.075, 10, 8)), toon('#FFD23F'), duck)
    head.position.set(0.1, 0.12, 0)
    const beak = mesh(g(new THREE.ConeGeometry(0.03, 0.08, 6)), toon('#FF8C42'), duck)
    beak.rotation.z = -Math.PI / 2
    beak.position.set(0.19, 0.11, 0)
    duck.position.set(w.x0 + (w.x1 - w.x0) * 0.82, -0.06, w.z0 + (w.z1 - w.z0) * 0.3)
    root.add(duck)
  }

  // Trou + drapeau (planté à côté du trou, côté « haut d'écran »)
  const cy = (hole.cupY ?? 0) + 0.004
  const cup = mesh(g(new THREE.CircleGeometry(CUP_R, 28)), new THREE.MeshBasicMaterial({ color: '#0D0B16' }), root, false, false)
  mats.set('cup', cup.material as THREE.Material)
  cup.rotation.x = -Math.PI / 2
  cup.position.set(hole.cup[0], cy, hole.cup[1])
  const rim = mesh(g(new THREE.RingGeometry(CUP_R, CUP_R + 0.03, 28)), toon('#FFFFFF'), root, false, false)
  rim.rotation.x = -Math.PI / 2
  rim.position.set(hole.cup[0], cy + 0.001, hole.cup[1])
  const flag = new THREE.Group()
  const pole = mesh(g(new THREE.CylinderGeometry(0.018, 0.018, 0.95, 6)), toon('#FFFFFF'), flag)
  pole.position.y = 0.475
  const tri = new THREE.Shape()
  tri.moveTo(0, 0)
  tri.lineTo(0.36, -0.12)
  tri.lineTo(0, -0.24)
  tri.closePath()
  const cloth = mesh(g(new THREE.ShapeGeometry(tri)), new THREE.MeshToonMaterial({ color: '#FF5D73', gradientMap: gradient(), side: THREE.DoubleSide }), flag)
  mats.set('cloth', cloth.material as THREE.Material)
  cloth.position.y = 0.94
  const flagTop = mesh(g(new THREE.SphereGeometry(0.04, 8, 6)), toon('#FFD23F'), flag)
  flagTop.position.y = 0.97
  flag.position.set(hole.cup[0] + CUP_R + 0.07, (hole.cupY ?? 0), hole.cup[1] - 0.05)
  root.add(flag)

  // Départ
  const tee = mesh(g(new THREE.PlaneGeometry(0.5, 0.5)), toon(dark ? '#1E7F3D' : '#239B4A'), root, false, true)
  tee.rotation.x = -Math.PI / 2
  tee.position.set(hole.tee[0], 0.003 + floorHeight(hole, hole.tee[0], hole.tee[1]), hole.tee[1])

  for (const d of hole.decor ?? []) buildDecor(d)

  return {
    root,
    blades,
    bumpers,
    water,
    bell,
    bounds,
    dispose: () => {
      for (const x of geos) x.dispose()
      for (const m of mats.values()) m.dispose()
      root.clear()
    },
  }

  /* ---------------------------------------------------------------------- */

  function buildPiece(p: Piece, index: number) {
    if (p.kind === 'floor') {
      const y = p.y ?? 0
      block(p.x0, p.x1, p.z0, p.z1, Math.min(GROUND_Y, y - 0.3), y, skinColor(p.skin))
      if (p.skin === 'wood') {
        // planches
        for (let z = p.z0 + 0.2; z < p.z1 - 0.1; z += 0.25) {
          const l = mesh(g(new THREE.BoxGeometry(p.x1 - p.x0, 0.005, 0.02)), toon('#8A5A33'), root, false, false)
          l.position.set((p.x0 + p.x1) / 2, y + 0.003, z)
        }
        for (const x of [p.x0, p.x1]) for (const z of [p.z0 + 0.15, p.z1 - 0.15]) {
          const post = mesh(g(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 8)), toon('#8A5A33'), root)
          post.position.set(x, y + 0.11, z)
        }
      }
      if (y >= -0.25) grow(p.x0, p.x1, p.z0, p.z1, y)
    } else if (p.kind === 'ramp') {
      const geo = g(new THREE.BoxGeometry(1, 1, 1))
      const pos = geo.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < pos.count; i++) {
        const lx = pos.getX(i)
        const ly = pos.getY(i)
        const lz = pos.getZ(i)
        const x = lx < 0 ? p.x0 : p.x1
        const z = lz < 0 ? p.z0 : p.z1
        const top = lz < 0 ? p.y0 : p.y1
        pos.setXYZ(i, x, ly > 0 ? top : GROUND_Y - 0.01, z)
      }
      geo.computeVertexNormals()
      // montée (vers le trou) plus claire, descente plus sombre : les bosses se lisent d'en haut
      const up = p.y0 > p.y1
      mesh(geo, toon(p.skin ? skinColor(p.skin) : up ? (dark ? '#4CCB6E' : '#6FE38C') : dark ? '#1C8A41' : '#1FA34B'))
      // liserés de pente (lisibilité)
      for (const f of [0.25, 0.5, 0.75]) {
        const z = p.z0 + (p.z1 - p.z0) * f
        const y = p.y0 + (p.y1 - p.y0) * f
        const l = mesh(g(new THREE.BoxGeometry(p.x1 - p.x0, 0.01, 0.025)), toon(dark ? '#1C7A3A' : '#24A04C'), root, false, false)
        l.position.set((p.x0 + p.x1) / 2, y + 0.004, z)
        l.rotation.x = Math.atan2(p.y1 - p.y0, p.z1 - p.z0) * -1
      }
      grow(p.x0, p.x1, p.z0, p.z1, Math.max(p.y0, p.y1))
    } else if (p.kind === 'wall') {
      const [ax, az] = p.a
      const [bx, bz] = p.b
      const len = Math.hypot(bx - ax, bz - az) + 0.14
      const y0 = Math.max(GROUND_Y, p.y0 ?? -0.1)
      const top = p.top ?? 0.3
      const grp = new THREE.Group()
      grp.position.set((ax + bx) / 2, 0, (az + bz) / 2)
      grp.rotation.y = Math.atan2(-(bz - az), bx - ax)
      root.add(grp)
      const body = mesh(g(new THREE.BoxGeometry(len, top - y0, 0.14)), toon(P.wall), grp)
      body.position.y = (top + y0) / 2
      const cap = mesh(g(new THREE.BoxGeometry(len + 0.01, 0.05, 0.16)), toon(P.wallTop), grp)
      cap.position.y = top
      const o = new THREE.Mesh(g(new THREE.BoxGeometry(len + 0.05, top - y0 + 0.06, 0.2)), ink)
      o.position.y = (top + y0) / 2 + 0.01
      grp.add(o)
    } else if (p.kind === 'post') {
      const grp = new THREE.Group()
      grp.position.set(p.x, -0.1, p.z)
      root.add(grp)
      const geo = g(new THREE.CylinderGeometry(p.r * 0.85, p.r, 0.5, 16))
      const c = mesh(geo, toon('#FFFFFF'), grp)
      c.position.y = 0.25
      outline(geo, c, 1.12)
      const top = mesh(g(new THREE.SphereGeometry(p.r * 0.85, 14, 8)), toon('#FFFFFF'), grp)
      top.position.y = 0.5
      for (const y of [0.32, 0.4]) {
        const ring = mesh(g(new THREE.CylinderGeometry(p.r * 0.92, p.r * 0.92, 0.035, 16)), toon('#FF3B4E'), grp)
        ring.position.y = y
      }
    } else if (p.kind === 'bumper') {
      const grp = new THREE.Group()
      grp.position.set(p.x, -0.1, p.z)
      root.add(grp)
      const geo = g(new THREE.CylinderGeometry(p.r, p.r * 1.05, 0.36, 20))
      const c = mesh(geo, toon(p.color ?? '#FF5D73'), grp)
      c.position.y = 0.18
      outline(geo, c, 1.1)
      const cap = mesh(g(new THREE.CylinderGeometry(p.r * 0.7, p.r * 0.7, 0.06, 20)), toon('#FFFFFF'), grp)
      cap.position.y = 0.39
      const star = mesh(g(new THREE.CylinderGeometry(p.r * 0.32, p.r * 0.32, 0.07, 5)), toon('#FFD23F'), grp)
      star.position.y = 0.41
      bumpers.set(index, grp)
    } else if (p.kind === 'mill') {
      const back = p.front - p.depth
      const zc = (p.front + back) / 2
      const H = 1.1
      // maison (deux blocs + linteau au-dessus du tunnel)
      block(p.x0, p.cx - p.gap, back, p.front, GROUND_Y, H, '#FFF3E0')
      block(p.cx + p.gap, p.x1, back, p.front, GROUND_Y, H, '#FFF3E0')
      block(p.cx - p.gap, p.cx + p.gap, back, p.front, 0.45, H, '#FFF3E0')
      // intérieur sombre du tunnel
      const inside = mesh(g(new THREE.BoxGeometry(p.gap * 2, 0.02, p.depth)), toon('#3B2F4A'), root, false, true)
      inside.position.set(p.cx, 0.44, zc)
      // toit
      const roof = mesh(g(new THREE.ConeGeometry((p.x1 - p.x0) * 0.4, 0.55, 4)), toon('#C8553D'))
      roof.rotation.y = Math.PI / 4
      roof.scale.set(1, 1, 0.75)
      roof.position.set(p.cx, H + 0.45, zc)
      // porte et fenêtre
      const win = mesh(g(new THREE.CircleGeometry(0.16, 16)), toon('#4CC9F0'), root, false, false)
      win.position.set(p.cx - 0.65, 0.75, p.front + 0.005)
      // pales
      blades = new THREE.Group()
      blades.position.set(p.cx, MILL_HUB_Y, p.front + 0.16)
      root.add(blades)
      const half = MILL_BLADE / 2
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2
        const arm = new THREE.Group()
        arm.rotation.z = a
        blades.add(arm)
        const beam = mesh(g(new THREE.BoxGeometry(0.06, MILL_BLADE, 0.06)), toon('#8A5A33'), arm)
        beam.position.y = half + 0.04
        const sail = mesh(g(new THREE.BoxGeometry(0.3, MILL_BLADE * 0.78, 0.03)), toon(k % 2 ? '#FFFFFF' : '#FFD23F'), arm)
        sail.position.set(0.16, half + 0.18, 0)
        const o = new THREE.Mesh(g(new THREE.BoxGeometry(0.35, MILL_BLADE * 0.78 + 0.05, 0.05)), ink)
        o.position.copy(sail.position)
        arm.add(o)
      }
      const hub = mesh(g(new THREE.CylinderGeometry(0.1, 0.1, 0.14, 12)), toon('#E63946'), blades)
      hub.rotation.x = Math.PI / 2
      grow(p.x0, p.x1, back, p.front, H + 0.9)
    } else if (p.kind === 'loop') {
      /** Point de la piste sous la balle (θ), écarté de `out` vers l'extérieur du cercle et de dx en X. */
      const at = (th: number, out: number, dx: number) => {
        const [x, y, z] = loopPoint(p, th, p.x0)
        return new THREE.Vector3(x + dx, y - Math.cos(th) * (BALL_R + out), z + Math.sin(th) * (BALL_R + out))
      }
      for (const [dx, col] of [[-0.1, '#FFD23F'], [0.1, '#FF5D73']] as const) {
        const pts: THREE.Vector3[] = []
        for (let i = 0; i <= 72; i++) pts.push(at((i / 72) * Math.PI * 2, 0.03, dx))
        mesh(g(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 110, 0.055, 8, false)), toon(col))
      }
      // traverses
      for (let i = 0; i < 24; i++) {
        const th = (i / 24) * Math.PI * 2
        const tie = mesh(g(new THREE.BoxGeometry(0.3, 0.03, 0.07)), toon('#8A5A33'))
        tie.position.copy(at(th, 0.06, 0))
        tie.rotation.x = -th
      }
      // pylônes
      for (const sx of [-1, 1]) {
        const pyl = mesh(g(new THREE.CylinderGeometry(0.04, 0.05, p.r * 2 + 0.6, 8)), toon('#4CC9F0'))
        pyl.position.set(sx * 0.32 + (p.x0 + p.x1) / 2, p.r + 0.3 + GROUND_Y + 0.0, p.z)
      }
      grow(-p.halfWidth, p.halfWidth, p.z - p.r, p.z + p.r, p.r * 2)
    }
  }

  function grow(x0: number, x1: number, z0: number, z1: number, top: number) {
    bounds.expandByPoint(new THREE.Vector3(x0, GROUND_Y, z0))
    bounds.expandByPoint(new THREE.Vector3(x1, Math.max(0.3, top), z1))
  }

  function buildDecor(d: Decor) {
    const grp = new THREE.Group()
    grp.position.set(d.x, GROUND_Y, d.z)
    grp.rotation.y = d.rot ?? 0
    root.add(grp)
    if (d.kind === 'tree') {
      const trunk = mesh(g(new THREE.CylinderGeometry(0.07, 0.1, 0.5, 8)), toon('#8A5A33'), grp)
      trunk.position.y = 0.25
      const geo = g(new THREE.IcosahedronGeometry(0.42, 0))
      const top = mesh(geo, toon('#2E9E4F'), grp)
      top.position.y = 0.8
      outline(geo, top, 1.1)
      const top2 = mesh(g(new THREE.IcosahedronGeometry(0.28, 0)), toon('#45C46A'), grp)
      top2.position.set(0.12, 1.1, 0.05)
    } else if (d.kind === 'tent') {
      const col = d.color ?? '#FF5D73'
      const base = mesh(g(new THREE.CylinderGeometry(0.5, 0.5, 0.55, 8)), toon('#FFFFFF'), grp)
      base.position.y = 0.28
      for (let k = 0; k < 4; k++) {
        const s = mesh(g(new THREE.BoxGeometry(0.2, 0.56, 0.02)), toon(col), grp)
        const a = (k / 4) * Math.PI * 2 + Math.PI / 8
        s.position.set(Math.cos(a) * 0.47, 0.28, Math.sin(a) * 0.47)
        s.rotation.y = -a + Math.PI / 2
      }
      const roofGeo = g(new THREE.ConeGeometry(0.62, 0.55, 8))
      const roof = mesh(roofGeo, toon(col), grp)
      roof.position.y = 0.83
      outline(roofGeo, roof, 1.08)
      const pennant = mesh(g(new THREE.ConeGeometry(0.05, 0.16, 4)), toon('#FFD23F'), grp)
      pennant.position.y = 1.18
    } else if (d.kind === 'stand') {
      const col = d.color ?? '#FFB627'
      const counter = mesh(g(new THREE.BoxGeometry(0.9, 0.45, 0.4)), toon('#FFF3E0'), grp)
      counter.position.y = 0.23
      outline(counter.geometry, counter, 1.06)
      for (let k = 0; k < 5; k++) {
        const s = mesh(g(new THREE.BoxGeometry(0.18, 0.04, 0.55)), toon(k % 2 ? '#FFFFFF' : col), grp)
        s.position.set(-0.36 + k * 0.18, 0.86, 0.05)
        s.rotation.x = 0.35
      }
      for (const sx of [-0.42, 0.42]) {
        const pole = mesh(g(new THREE.CylinderGeometry(0.025, 0.025, 0.85, 6)), toon('#8A5A33'), grp)
        pole.position.set(sx, 0.43, 0.25)
      }
      // barbe à papa
      const cotton = mesh(g(new THREE.IcosahedronGeometry(0.11, 1)), toon('#FF9ECF'), grp)
      cotton.position.set(0.2, 0.62, 0)
    } else if (d.kind === 'lamp') {
      const pole = mesh(g(new THREE.CylinderGeometry(0.03, 0.04, 1.2, 6)), toon('#3B2F4A'), grp)
      pole.position.y = 0.6
      const bulb = mesh(g(new THREE.SphereGeometry(0.12, 12, 8)), new THREE.MeshBasicMaterial({ color: '#FFE38A' }), grp, false, false)
      mats.set('bulb' + d.x + d.z, bulb.material as THREE.Material)
      bulb.position.y = 1.26
    } else if (d.kind === 'bell') {
      const tower = mesh(g(new THREE.BoxGeometry(0.8, 2.0, 0.8)), toon('#E9D8C3'), grp)
      tower.position.y = 1.0
      outline(tower.geometry, tower, 1.05)
      const roof = mesh(g(new THREE.ConeGeometry(0.7, 0.9, 4)), toon('#5B6CFF'), grp)
      roof.rotation.y = Math.PI / 4
      roof.position.y = 2.45
      const arch = mesh(g(new THREE.BoxGeometry(0.5, 0.5, 0.82)), toon('#3B2F4A'), grp)
      arch.position.y = 1.65
      const b = new THREE.Group()
      b.position.set(0, 1.85, 0.3)
      const bellGeo = g(new THREE.CylinderGeometry(0.08, 0.2, 0.3, 14))
      const bm = mesh(bellGeo, toon('#FFC233'), b)
      bm.position.y = -0.15
      outline(bellGeo, bm, 1.12)
      grp.add(b)
      bell = b
      const cross = mesh(g(new THREE.BoxGeometry(0.05, 0.3, 0.05)), toon('#FFD23F'), grp)
      cross.position.y = 3.0
    } else if (d.kind === 'flags' && d.to) {
      grp.rotation.y = 0
      grp.position.set(0, GROUND_Y, 0)
      const a = new THREE.Vector3(d.x, 1.3, d.z)
      const b = new THREE.Vector3(d.to[0], 1.3, d.to[1])
      for (const p of [a, b]) {
        const pole = mesh(g(new THREE.CylinderGeometry(0.03, 0.03, 1.65, 6)), toon('#8A5A33'), grp)
        pole.position.set(p.x, 0.82, p.z)
      }
      const n = Math.max(4, Math.round(a.distanceTo(b) / 0.32))
      const colors = ['#FF5D73', '#FFD23F', '#4CC9F0', '#7AE582', '#9B5DE5']
      const triGeo = g(new THREE.BufferGeometry())
      triGeo.setAttribute('position', new THREE.Float32BufferAttribute([-0.11, 0, 0, 0.11, 0, 0, 0, -0.24, 0], 3))
      triGeo.computeVertexNormals()
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n
        const p = a.clone().lerp(b, t)
        p.y -= Math.sin(t * Math.PI) * 0.25
        const mat = new THREE.MeshBasicMaterial({ color: colors[i % colors.length], side: THREE.DoubleSide })
        mats.set(`flag${d.x}${i}`, mat)
        const f = mesh(triGeo, mat, grp, false, false)
        f.position.copy(p)
        f.lookAt(p.x, p.y, p.z + 1)
      }
      const pts: THREE.Vector3[] = []
      for (let i = 0; i <= 16; i++) {
        const t = i / 16
        const p = a.clone().lerp(b, t)
        p.y -= Math.sin(t * Math.PI) * 0.25
        pts.push(p)
      }
      mesh(g(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.012, 4, false)), toon('#3B2F4A'), grp, false, false)
    }
  }
}
