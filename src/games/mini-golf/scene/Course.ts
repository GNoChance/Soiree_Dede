/**
 * Rendu three d'un trou (style « sticker » : aplats toon, contours épais, couleurs franches).
 * Lit les mêmes primitives que la physique (holes.ts) + le décor de kermesse.
 */
import * as THREE from 'three'
import { floorHeight, type Decor, type HoleDef, type Piece, type Skin, type Theme } from '../holes'
import { BALL_R, CUP_R, GATE_H, MILL_BLADE, MILL_HUB_Y, SLIDER_H, TUBE_MOUTH, gateY, loopPoint, tubePoint } from './physics'

export const GROUND_Y = -0.35
/** Trou suspendu (`void`) : le sol (fond du vide) est loin en dessous. */
export const VOID_Y = -2.6

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
  /** Barrières mobiles (position X calée sur l'horloge par la scène). */
  sliders: Array<{ obj: THREE.Object3D; def: Extract<Piece, { kind: 'slider' }> }>
  /** Portes (position Y calée sur l'horloge par la scène). */
  gates: Array<{ obj: THREE.Object3D; def: Extract<Piece, { kind: 'gate' }> }>
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
  hedge: string
  hedgeTop: string
  ice: string
  snow: string
  stone: string
  /** Fond du vide (trous suspendus). */
  abyss: string
  ink: string
}

const PAL_LIGHT: Palette = { ground: '#9ED98A', grass: '#2FBF5B', green: '#58D97A', wood: '#C98B55', sand: '#E9D3A1', wall: '#FF6B6B', wallTop: '#FFF4E0', hedge: '#2E9E4F', hedgeTop: '#6FDB8A', ice: '#7FE3FF', snow: '#D3E2EE', stone: '#B4B2C6', abyss: '#5E8C61', ink: '#1F1B2E' }
const PAL_DARK: Palette = { ground: '#2C5A3E', grass: '#25A94F', green: '#46C46A', wood: '#B57A47', sand: '#CDB585', wall: '#F2545B', wallTop: '#FFE9C7', hedge: '#257F40', hedgeTop: '#4CC46C', ice: '#45BEE0', snow: '#A9BCCC', stone: '#807E96', abyss: '#1D3A2A', ink: '#0D0B16' }

/** Couleurs propres à chaque décor d'ensemble (par-dessus la palette kermesse). */
const THEMES: Record<Exclude<Theme, 'kermesse'>, { light: Partial<Palette>; dark: Partial<Palette> }> = {
  // Château hanté de Dédé : feutre violet, remparts de pierre
  castle: {
    light: { ground: '#8C7BBF', grass: '#9D87E8', green: '#C1B0FF', wall: '#5A4790', wallTop: '#E5DBFF', abyss: '#3E3266' },
    dark: { ground: '#2C2247', grass: '#6E58C4', green: '#9483E0', wall: '#46377A', wallTop: '#C9B8FF', abyss: '#140F24' },
  },
  // Far-West : terre rouge, planches de saloon
  desert: {
    light: { ground: '#F2C57C', grass: '#E58F4E', green: '#F2B26B', wall: '#8C4A2F', wallTop: '#FFE3B3', sand: '#FFE29A', abyss: '#B86A3C' },
    dark: { ground: '#6E4A2B', grass: '#B8693A', green: '#C98A4E', wall: '#6B3622', wallTop: '#E8C38E', sand: '#CFAE5E', abyss: '#3A2416' },
  },
  // Station de ski : pistes bleues, piquets rouges
  snow: {
    light: { ground: '#E3F2FC', grass: '#6FB7E3', green: '#7FD39A', wall: '#E63946', wallTop: '#FFFFFF', abyss: '#A9CBE3' },
    dark: { ground: '#2B3F5C', grass: '#3D7FB0', green: '#46A86A', wall: '#C42A37', wallTop: '#E8F1F8', abyss: '#16233A' },
  },
}

export function buildCourse(hole: HoleDef, dark: boolean): CourseView {
  const theme = hole.theme && hole.theme !== 'kermesse' ? THEMES[hole.theme] : null
  const P: Palette = { ...(dark ? PAL_DARK : PAL_LIGHT), ...(theme ? (dark ? theme.dark : theme.light) : {}) }
  const hang = !!hole.void
  const GY = hang ? VOID_Y : GROUND_Y
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
  const skinColor = (s: Skin | undefined) =>
    s === 'wood' ? P.wood : s === 'green' ? P.green : s === 'sand' ? P.sand : s === 'ice' ? P.ice : s === 'snow' ? P.snow : s === 'stone' ? P.stone : P.grass
  const bounds = new THREE.Box3()
  const bumpers = new Map<number, THREE.Object3D>()
  const water: THREE.Mesh[] = []
  let blades: THREE.Group | null = null
  const sliders: CourseView['sliders'] = []
  const gates: CourseView['gates'] = []
  let bell: THREE.Object3D | null = null

  // Sol (fond du vide pour un trou suspendu)
  const ground = mesh(g(new THREE.PlaneGeometry(60, 60)), toon(hang ? P.abyss : P.ground), root, false, true)
  ground.rotation.x = -Math.PI / 2
  ground.position.y = GY

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

  /** Pose une forme plane (face +Z) à plat sur le sol, inclinée comme lui (dévers). */
  function lieFlat(m: THREE.Object3D, x: number, z: number) {
    const e = 0.02
    const n = new THREE.Vector3(
      -(floorHeight(hole, x + e, z) - floorHeight(hole, x - e, z)) / (2 * e),
      1,
      -(floorHeight(hole, x, z + e) - floorHeight(hole, x, z - e)) / (2 * e),
    ).normalize()
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n)
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
  lieFlat(cup, hole.cup[0], hole.cup[1])
  cup.position.set(hole.cup[0], cy, hole.cup[1])
  const rim = mesh(g(new THREE.RingGeometry(CUP_R, CUP_R + 0.03, 28)), toon('#FFFFFF'), root, false, false)
  lieFlat(rim, hole.cup[0], hole.cup[1])
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
  lieFlat(tee, hole.tee[0], hole.tee[1])
  tee.position.set(hole.tee[0], 0.003 + floorHeight(hole, hole.tee[0], hole.tee[1]), hole.tee[1])

  for (const d of hole.decor ?? []) buildDecor(d)

  return {
    root,
    blades,
    sliders,
    gates,
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
      block(p.x0, p.x1, p.z0, p.z1, hang ? y - 0.3 : Math.min(GY, y - 0.3), y, skinColor(p.skin))
      if (p.skin === 'ice') {
        // reflets de la glace
        for (let k = 0; k < Math.max(1, Math.round(((p.x1 - p.x0) * (p.z1 - p.z0)) / 2.5)); k++) {
          const fx = ((k * 0.618) % 1) * 0.7 + 0.15
          const fz = ((k * 0.382 + 0.2) % 1) * 0.7 + 0.15
          const l = mesh(g(new THREE.BoxGeometry(0.42, 0.004, 0.05)), toon('#FFFFFF'), root, false, false)
          l.position.set(p.x0 + (p.x1 - p.x0) * fx, y + 0.003, p.z0 + (p.z1 - p.z0) * fz)
          l.rotation.y = 0.6
        }
      }
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
    } else if (p.kind === 'ramp' && p.axis === 'x') {
      // dévers : pente le long de X
      const geo = g(new THREE.BoxGeometry(1, 1, 1))
      const pos = geo.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < pos.count; i++) {
        const lx = pos.getX(i)
        const ly = pos.getY(i)
        const lz = pos.getZ(i)
        const top = lx < 0 ? p.y0 : p.y1
        pos.setXYZ(i, lx < 0 ? p.x0 : p.x1, ly > 0 ? top : hang ? top - 0.3 : GY - 0.01, lz < 0 ? p.z0 : p.z1)
      }
      geo.computeVertexNormals()
      mesh(geo, toon(p.skin ? skinColor(p.skin) : dark ? '#33B95A' : '#45CF6C'))
      // liserés de niveau (parallèles à la pente) : on voit de quel côté ça penche
      for (const f of [0.2, 0.4, 0.6, 0.8]) {
        const x = p.x0 + (p.x1 - p.x0) * f
        const y = p.y0 + (p.y1 - p.y0) * f
        const l = mesh(g(new THREE.BoxGeometry(0.025, 0.01, p.z1 - p.z0)), toon(dark ? '#1C7A3A' : '#24A04C'), root, false, false)
        l.position.set(x, y + 0.004, (p.z0 + p.z1) / 2)
        l.rotation.z = Math.atan2(p.y1 - p.y0, p.x1 - p.x0)
      }
      grow(p.x0, p.x1, p.z0, p.z1, Math.max(p.y0, p.y1))
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
        pos.setXYZ(i, x, ly > 0 ? top : hang ? top - 0.3 : GY - 0.01, z)
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
      const y0 = hang ? (p.y0 ?? -0.1) : Math.max(GY, p.y0 ?? -0.1)
      const top = p.top ?? 0.3
      const grp = new THREE.Group()
      grp.position.set((ax + bx) / 2, 0, (az + bz) / 2)
      grp.rotation.y = Math.atan2(-(bz - az), bx - ax)
      root.add(grp)
      const body = mesh(g(new THREE.BoxGeometry(len, top - y0, 0.14)), toon(p.skin === 'hedge' ? P.hedge : P.wall), grp)
      body.position.y = (top + y0) / 2
      const cap = mesh(g(new THREE.BoxGeometry(len + 0.01, 0.05, 0.16)), toon(p.skin === 'hedge' ? P.hedgeTop : P.wallTop), grp)
      cap.position.y = top
      const o = new THREE.Mesh(g(new THREE.BoxGeometry(len + 0.05, top - y0 + 0.06, 0.2)), ink)
      o.position.y = (top + y0) / 2 + 0.01
      grp.add(o)
    } else if (p.kind === 'post' && p.style === 'rock') {
      // rocher
      const geo = g(new THREE.DodecahedronGeometry(p.r * 1.15, 0))
      const rock = mesh(geo, toon(dark ? '#8E7F74' : '#B9A99B'))
      rock.position.set(p.x, (p.y ?? 0) + 0.12, p.z)
      rock.scale.set(1, 0.8, 1)
      outline(geo, rock, 1.1)
    } else if (p.kind === 'post' && p.style === 'barrel') {
      // tonneau de cidre
      const grp = new THREE.Group()
      grp.position.set(p.x, (p.y ?? 0) - 0.1, p.z)
      root.add(grp)
      const geo = g(new THREE.CylinderGeometry(p.r * 0.9, p.r * 0.9, 0.5, 16))
      const c = mesh(geo, toon('#B9763F'), grp)
      c.position.y = 0.25
      outline(geo, c, 1.1)
      const belly = mesh(g(new THREE.CylinderGeometry(p.r, p.r, 0.22, 16)), toon('#C98B55'), grp)
      belly.position.y = 0.25
      for (const y of [0.08, 0.42]) {
        const hoop = mesh(g(new THREE.CylinderGeometry(p.r * 0.94, p.r * 0.94, 0.04, 16)), toon('#3B2F4A'), grp)
        hoop.position.y = y
      }
      const lid = mesh(g(new THREE.CylinderGeometry(p.r * 0.8, p.r * 0.8, 0.02, 16)), toon('#8A5A33'), grp)
      lid.position.y = 0.505
    } else if (p.kind === 'post') {
      const grp = new THREE.Group()
      grp.position.set(p.x, (p.y ?? 0) - 0.1, p.z)
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
      grp.position.set(p.x, (p.y ?? 0) - 0.1, p.z)
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
      block(p.x0, p.cx - p.gap, back, p.front, GY, H, '#FFF3E0')
      block(p.cx + p.gap, p.x1, back, p.front, GY, H, '#FFF3E0')
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
    } else if (p.kind === 'slider') {
      // barrière de passage à niveau rayée rouge et blanc, qui va et vient
      const d = p.d ?? 0.3
      const grp = new THREE.Group()
      grp.position.set((p.x0 + p.x1) / 2, 0, p.z)
      root.add(grp)
      const body = mesh(g(new THREE.BoxGeometry(p.w, SLIDER_H, d)), toon('#FFFFFF'), grp)
      body.position.y = SLIDER_H / 2 - 0.02
      const o = new THREE.Mesh(g(new THREE.BoxGeometry(p.w + 0.06, SLIDER_H + 0.05, d + 0.06)), ink)
      o.position.copy(body.position)
      grp.add(o)
      const n = Math.max(2, Math.round(p.w / 0.22))
      for (let k = 0; k < n; k += 2) {
        const s = mesh(g(new THREE.BoxGeometry(p.w / n, SLIDER_H + 0.01, d + 0.01)), toon('#FF3B4E'), grp)
        s.position.set(-p.w / 2 + (k + 0.5) * (p.w / n), body.position.y, 0)
      }
      const lamp = mesh(g(new THREE.SphereGeometry(0.07, 10, 8)), toon('#FFD23F'), grp)
      lamp.position.y = SLIDER_H + 0.04
      // rail au sol (toute la course)
      const rail = mesh(g(new THREE.BoxGeometry(p.x1 - p.x0, 0.01, 0.06)), toon('#3B2F4A'), root, false, false)
      rail.position.set((p.x0 + p.x1) / 2, 0.004, p.z)
      sliders.push({ obj: grp, def: p })
    } else if (p.kind === 'gate') {
      // herse : barreaux sombres + traverse, qui montent et descendent
      const d = p.d ?? 0.2
      const w = p.x1 - p.x0
      const grp = new THREE.Group()
      grp.position.set((p.x0 + p.x1) / 2, gateY(p, 0), p.z)
      root.add(grp)
      const n = Math.max(3, Math.round(w / 0.16))
      const barGeo = g(new THREE.BoxGeometry(0.05, GATE_H, d))
      const barMat = toon(dark ? '#5C5470' : '#4A4458')
      for (let k = 0; k <= n; k++) mesh(barGeo, barMat, grp).position.x = -w / 2 + (k * w) / n
      for (const yy of [-GATE_H / 2 + 0.06, GATE_H / 2 - 0.04]) {
        const t = mesh(g(new THREE.BoxGeometry(w, 0.06, d + 0.02)), toon('#3B2F4A'), grp)
        t.position.y = yy
      }
      for (const k of [0, n]) {
        const tip = mesh(g(new THREE.ConeGeometry(0.04, 0.1, 6)), toon('#FFD23F'), grp)
        tip.position.set(-w / 2 + (k * w) / n, GATE_H / 2 + 0.05, 0)
      }
      // fente dans le sol + piliers
      const slot = mesh(g(new THREE.BoxGeometry(w, 0.006, d + 0.04)), toon('#1F1B2E'), root, false, false)
      slot.position.set((p.x0 + p.x1) / 2, (p.y ?? 0) + 0.003, p.z)
      for (const x of [p.x0 - 0.1, p.x1 + 0.1]) {
        const pil = mesh(g(new THREE.BoxGeometry(0.16, 0.75, d + 0.12)), toon(P.stone), root)
        pil.position.set(x, (p.y ?? 0) + 0.3, p.z)
        outline(pil.geometry, pil, 1.08)
      }
      gates.push({ obj: grp, def: p })
    } else if (p.kind === 'tube') {
      // tuyau en cloche entre les deux embouchures
      const pts: THREE.Vector3[] = []
      for (let i = 0; i <= 24; i++) pts.push(new THREE.Vector3(...tubePoint(p, i / 24)))
      const col = p.color ?? '#2EC4B6'
      const geo = g(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.17, 10, false))
      const pipe = mesh(geo, toon(col))
      outline(geo, pipe, 1.12)
      for (const [x, y, z] of [[p.a[0], p.ya ?? 0, p.a[1]], [p.b[0], p.yb ?? 0, p.b[1]]]) {
        const mouth = mesh(g(new THREE.TorusGeometry(TUBE_MOUTH, 0.05, 8, 20)), toon('#FFD23F'), root, false, false)
        mouth.rotation.x = -Math.PI / 2
        mouth.position.set(x, y + 0.03, z)
        const pit = mesh(g(new THREE.CircleGeometry(TUBE_MOUTH - 0.03, 20)), toon('#1F1B2E'), root, false, false)
        pit.rotation.x = -Math.PI / 2
        pit.position.set(x, y + 0.006, z)
      }
      const top = tubePoint(p, 0.5)
      grow(Math.min(p.a[0], p.b[0]), Math.max(p.a[0], p.b[0]), Math.min(p.a[1], p.b[1]), Math.max(p.a[1], p.b[1]), top[1])
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
        pyl.position.set(sx * 0.32 + (p.x0 + p.x1) / 2, p.r + 0.3 + GY + 0.0, p.z)
      }
      grow(-p.halfWidth, p.halfWidth, p.z - p.r, p.z + p.r, p.r * 2)
    }
  }

  function grow(x0: number, x1: number, z0: number, z1: number, top: number) {
    bounds.expandByPoint(new THREE.Vector3(x0, GY, z0))
    bounds.expandByPoint(new THREE.Vector3(x1, Math.max(0.3, top), z1))
  }

  function buildDecor(d: Decor) {
    const grp = new THREE.Group()
    grp.position.set(d.x, GY, d.z)
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
    } else if (d.kind === 'balloons') {
      // grappe de ballons de baudruche
      const colors = [d.color ?? '#FF5D73', '#FFD23F', '#4CC9F0', '#7AE582', '#9B5DE5']
      const weight = mesh(g(new THREE.BoxGeometry(0.12, 0.1, 0.12)), toon('#3B2F4A'), grp)
      weight.position.y = 0.05
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2
        const top = new THREE.Vector3(Math.cos(a) * 0.22, 1.35 + (k % 2) * 0.22, Math.sin(a) * 0.22)
        const geo = g(new THREE.SphereGeometry(0.17, 12, 10))
        const b = mesh(geo, toon(colors[k]), grp)
        b.scale.set(1, 1.18, 1)
        b.position.copy(top)
        outline(geo, b, 1.1)
        const len = top.length()
        const str = mesh(g(new THREE.CylinderGeometry(0.008, 0.008, len, 4)), toon('#3B2F4A'), grp, false, false)
        str.position.copy(top).multiplyScalar(0.5)
        str.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().normalize())
      }
    } else if (d.kind === 'hay') {
      // botte de foin
      const geo = g(new THREE.BoxGeometry(0.75, 0.42, 0.48))
      const bale = mesh(geo, toon('#F2C94C'), grp)
      bale.position.y = 0.21
      outline(geo, bale, 1.06)
      for (const x of [-0.2, 0.2]) {
        const band = mesh(g(new THREE.BoxGeometry(0.04, 0.44, 0.5)), toon('#B5651D'), grp)
        band.position.set(x, 0.21, 0)
      }
      const top = mesh(g(new THREE.BoxGeometry(0.5, 0.3, 0.36)), toon('#F7DC6F'), grp)
      top.position.set(0.05, 0.57, 0)
      top.rotation.y = 0.3
      outline(top.geometry, top, 1.08)
    } else if (d.kind === 'drum') {
      // grosse caisse de la fanfare
      const geo = g(new THREE.CylinderGeometry(0.38, 0.38, 0.32, 20))
      const shell = mesh(geo, toon('#FF3B4E'), grp)
      shell.rotation.x = Math.PI / 2
      shell.position.y = 0.4
      outline(geo, shell, 1.08)
      for (const s of [-1, 1]) {
        const skin = mesh(g(new THREE.CylinderGeometry(0.33, 0.33, 0.02, 20)), toon('#FFF4E0'), grp)
        skin.rotation.x = Math.PI / 2
        skin.position.set(0, 0.4, s * 0.17)
      }
      const stick = mesh(g(new THREE.CylinderGeometry(0.025, 0.025, 0.6, 6)), toon('#8A5A33'), grp)
      stick.position.set(0.3, 0.75, 0.2)
      stick.rotation.z = 0.7
      const knob = mesh(g(new THREE.SphereGeometry(0.07, 10, 8)), toon('#FFFFFF'), grp)
      knob.position.set(0.09, 0.98, 0.2)
    } else if (d.kind === 'ghost') {
      // fantôme en drap (il flotte)
      const geo = g(new THREE.SphereGeometry(0.32, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62))
      const sheet = mesh(geo, toon('#FFFFFF'), grp)
      sheet.position.y = 1.35
      sheet.scale.set(1, 1.35, 1)
      outline(geo, sheet, 1.08)
      const skirt = mesh(g(new THREE.CylinderGeometry(0.29, 0.36, 0.42, 14, 1, true)), new THREE.MeshToonMaterial({ color: '#FFFFFF', gradientMap: gradient(), side: THREE.DoubleSide }), grp)
      mats.set('skirt' + d.x + d.z, skirt.material as THREE.Material)
      skirt.position.y = 1.05
      for (const sx of [-0.1, 0.1]) {
        const eye = mesh(g(new THREE.SphereGeometry(0.05, 8, 6)), toon('#1F1B2E'), grp, false, false)
        eye.position.set(sx, 1.5, 0.27)
      }
      const mouth = mesh(g(new THREE.SphereGeometry(0.045, 8, 6)), toon('#1F1B2E'), grp, false, false)
      mouth.position.set(0, 1.37, 0.29)
    } else if (d.kind === 'pumpkin') {
      const geo = g(new THREE.SphereGeometry(0.3, 14, 10))
      const pk = mesh(geo, toon(d.color ?? '#FF8C2B'), grp)
      pk.position.y = 0.26
      pk.scale.set(1.2, 0.85, 1.2)
      outline(geo, pk, 1.08)
      const stem = mesh(g(new THREE.CylinderGeometry(0.04, 0.05, 0.14, 6)), toon('#3FA34D'), grp)
      stem.position.y = 0.55
      for (const sx of [-0.12, 0.12]) {
        const eye = mesh(g(new THREE.ConeGeometry(0.06, 0.08, 3)), toon('#3B2F4A'), grp, false, false)
        eye.position.set(sx, 0.34, 0.33)
        eye.rotation.x = Math.PI / 2
      }
    } else if (d.kind === 'tower') {
      // tour de château, toit pointu
      const geo = g(new THREE.CylinderGeometry(0.55, 0.6, 2.2, 10))
      const t = mesh(geo, toon(dark ? '#8C89A6' : '#C9C4DD'), grp)
      t.position.y = 1.1
      outline(geo, t, 1.05)
      const roofGeo = g(new THREE.ConeGeometry(0.72, 1.1, 10))
      const roof = mesh(roofGeo, toon(d.color ?? '#7B4FD8'), grp)
      roof.position.y = 2.75
      outline(roofGeo, roof, 1.06)
      const win = mesh(g(new THREE.BoxGeometry(0.2, 0.3, 0.05)), new THREE.MeshBasicMaterial({ color: '#FFD23F' }), grp, false, false)
      mats.set('twin' + d.x + d.z, win.material as THREE.Material)
      win.position.set(0, 1.6, 0.58)
      const flag = mesh(g(new THREE.BoxGeometry(0.3, 0.16, 0.02)), toon('#FF5D73'), grp)
      flag.position.set(0.17, 3.35, 0)
    } else if (d.kind === 'cactus') {
      const col = toon(dark ? '#2E8B57' : '#3FB36B')
      const geo = g(new THREE.CapsuleGeometry(0.16, 0.9, 4, 10))
      const trunk = mesh(geo, col, grp)
      trunk.position.y = 0.6
      outline(geo, trunk, 1.1)
      for (const [sx, h] of [[-1, 0.55], [1, 0.8]]) {
        const armGeo = g(new THREE.CapsuleGeometry(0.1, 0.32, 4, 8))
        const arm = mesh(armGeo, col, grp)
        arm.position.set(sx * 0.3, h + 0.15, 0)
        outline(armGeo, arm, 1.12)
        const link = mesh(g(new THREE.CylinderGeometry(0.08, 0.08, 0.2, 8)), col, grp)
        link.rotation.z = Math.PI / 2
        link.position.set(sx * 0.18, h - 0.05, 0)
      }
      const flower = mesh(g(new THREE.SphereGeometry(0.07, 8, 6)), toon('#FF5D73'), grp, false, false)
      flower.position.y = 1.2
    } else if (d.kind === 'saloon') {
      // façade de saloon à fausse corniche
      const geo = g(new THREE.BoxGeometry(1.4, 1.0, 0.8))
      const body = mesh(geo, toon(dark ? '#9A6A44' : '#C98B55'), grp)
      body.position.y = 0.5
      outline(geo, body, 1.04)
      const front = mesh(g(new THREE.BoxGeometry(1.5, 0.55, 0.08)), toon(dark ? '#B57A47' : '#E0A458'), grp)
      front.position.set(0, 1.25, 0.4)
      const sign = mesh(g(new THREE.BoxGeometry(0.9, 0.22, 0.04)), toon('#FFF4E0'), grp)
      sign.position.set(0, 1.27, 0.46)
      for (const sx of [-0.13, 0.13]) {
        const door = mesh(g(new THREE.BoxGeometry(0.24, 0.32, 0.03)), toon('#8A5A33'), grp)
        door.position.set(sx, 0.42, 0.42)
      }
    } else if (d.kind === 'rock') {
      const geo = g(new THREE.DodecahedronGeometry(0.42, 0))
      const r = mesh(geo, toon(dark ? '#8E5A3C' : '#C77A4A'), grp)
      r.position.y = 0.3
      r.scale.set(1.3, 0.9, 1)
      outline(geo, r, 1.08)
      const r2 = mesh(g(new THREE.DodecahedronGeometry(0.22, 0)), toon(dark ? '#A06A47' : '#D99063'), grp)
      r2.position.set(0.45, 0.16, 0.15)
    } else if (d.kind === 'snowman') {
      for (const [r, y] of [[0.32, 0.3], [0.23, 0.78], [0.17, 1.13]]) {
        const geo = g(new THREE.SphereGeometry(r, 14, 10))
        const b = mesh(geo, toon('#FFFFFF'), grp)
        b.position.y = y
        outline(geo, b, 1.08)
      }
      const nose = mesh(g(new THREE.ConeGeometry(0.04, 0.18, 6)), toon('#FF8C42'), grp)
      nose.rotation.x = Math.PI / 2
      nose.position.set(0, 1.13, 0.22)
      const hat = mesh(g(new THREE.CylinderGeometry(0.13, 0.13, 0.2, 10)), toon('#1F1B2E'), grp)
      hat.position.y = 1.36
      const scarf = mesh(g(new THREE.TorusGeometry(0.18, 0.05, 6, 14)), toon(d.color ?? '#E63946'), grp)
      scarf.rotation.x = Math.PI / 2
      scarf.position.y = 0.97
    } else if (d.kind === 'pine') {
      const trunk = mesh(g(new THREE.CylinderGeometry(0.07, 0.09, 0.35, 6)), toon('#8A5A33'), grp)
      trunk.position.y = 0.17
      for (const [r, y] of [[0.55, 0.55], [0.42, 0.95], [0.28, 1.3]]) {
        const geo = g(new THREE.ConeGeometry(r, 0.6, 8))
        const c = mesh(geo, toon(dark ? '#1F7A4A' : '#2E9E5B'), grp)
        c.position.y = y
        outline(geo, c, 1.08)
        const snowCap = mesh(g(new THREE.ConeGeometry(r * 0.55, 0.22, 8)), toon('#FFFFFF'), grp, false, false)
        snowCap.position.y = y + 0.2
      }
    } else if (d.kind === 'chalet') {
      const geo = g(new THREE.BoxGeometry(1.1, 0.75, 0.9))
      const body = mesh(geo, toon(dark ? '#9A6A44' : '#B9763F'), grp)
      body.position.y = 0.38
      outline(geo, body, 1.05)
      const roofGeo = g(new THREE.ConeGeometry(0.95, 0.6, 4))
      const roof = mesh(roofGeo, toon('#FFFFFF'), grp)
      roof.rotation.y = Math.PI / 4
      roof.scale.set(1, 1, 0.8)
      roof.position.y = 1.05
      outline(roofGeo, roof, 1.06)
      const win = mesh(g(new THREE.BoxGeometry(0.26, 0.22, 0.03)), new THREE.MeshBasicMaterial({ color: '#FFD23F' }), grp, false, false)
      mats.set('cwin' + d.x + d.z, win.material as THREE.Material)
      win.position.set(0, 0.45, 0.46)
    } else if (d.kind === 'flags' && d.to) {
      grp.rotation.y = 0
      grp.position.set(0, GY, 0)
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
