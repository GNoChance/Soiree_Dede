import * as THREE from 'three'
import type { Decor, TrackDef } from '../tracks'
import { compileTrack, CUT_MARGIN, WALL_MARGIN, type Cut, type Geo } from './geo'
import { outline, toon } from './toon'

export { CUT_MARGIN, WALL_MARGIN }

/** Rayon d'une flaque. */
export const PUDDLE_R = 2.5

type Lat = number | ((i: number) => number)
type Item = { i: number; m: THREE.Matrix4; c: THREE.Color }

/** Obstacle mobile : traverse la piste d'un bord à l'autre (même mouvement sur tous les téléphones). */
export interface Mover {
  mesh: THREE.Group
  i: number
  amp: number
  period: number
  phase: number
  /** Roule (meule, citrouille, tonneau) ou glisse (aspirateur, crabe, caddie). */
  roll: boolean
}

/** Piste échantillonnée : positions, tangentes, largeur, repérage d'un point et maillages. */
export class Track {
  readonly n: number
  readonly px: Float32Array
  readonly pz: Float32Array
  readonly tx: Float32Array
  readonly tz: Float32Array
  /** Demi-largeur de la piste à chaque échantillon. */
  readonly hw: Float32Array
  /** Demi-largeur de base. */
  readonly half: number
  readonly def: TrackDef
  readonly geo: Geo
  readonly cut: Cut | null
  /** Flaques (piste + raccourci). */
  readonly puddles: { x: number; z: number }[]
  readonly movers: Mover[] = []
  /** Ciel : suit la caméra (cf. Game). */
  readonly sky: THREE.Mesh
  /** 1 = dalle turbo, 2 = tremplin, 4 = bosse. */
  private feat: Uint8Array

  constructor(def: TrackDef) {
    this.def = def
    const g = compileTrack(def)
    this.geo = g
    this.n = g.n
    this.px = g.px
    this.pz = g.pz
    this.tx = g.tx
    this.tz = g.tz
    this.hw = g.hw
    this.half = def.width / 2
    this.cut = g.cut
    this.feat = new Uint8Array(g.n)
    for (const [a, b] of g.boosts) for (let i = a; i <= b; i++) this.feat[this.wrap(i)] |= 1
    for (const [a, b] of g.jumps) for (let i = a; i <= b; i++) this.feat[this.wrap(i)] |= 2
    for (const b of g.bumps) for (let i = b - 1; i <= b + 1; i++) this.feat[this.wrap(i)] |= 4
    this.puddles = g.puddles.map((p) => ({ x: p.x, z: p.z }))
    if (g.cut) {
      // flaque décalée d'un côté du raccourci : il reste un passage étroit pour l'éviter
      ;(def.cutPuddles ?? []).forEach((f, k) => {
        const c = g.cut!
        const j = Math.round(f * (c.m - 1))
        const lat = (k % 2 ? -1 : 1) * c.half * 0.7
        this.puddles.push({ x: c.x[j] - c.tz[j] * lat, z: c.z[j] + c.tx[j] * lat })
      })
    }
    this.sky = skyDome(def.colors.sky)
  }

  wrap(i: number) {
    return ((i % this.n) + this.n) % this.n
  }

  /** Échantillon le plus proche entre `from` et `to` + écart latéral (droite > 0) + distance au carré. */
  locateRange(x: number, z: number, from: number, to: number) {
    let best = 0
    let bd = Infinity
    for (let k = from; k <= to; k++) {
      const i = this.wrap(k)
      const dx = x - this.px[i]
      const dz = z - this.pz[i]
      const d = dx * dx + dz * dz
      if (d < bd) {
        bd = d
        best = i
      }
    }
    const lat = (x - this.px[best]) * -this.tz[best] + (z - this.pz[best]) * this.tx[best]
    return { i: best, lat, d2: bd }
  }

  /** Échantillon le plus proche (fenêtre autour de `hint`, ou recherche complète si hint < 0). */
  locate(x: number, z: number, hint = -1) {
    return hint < 0 ? this.locateRange(x, z, 0, this.n - 1) : this.locateRange(x, z, hint - 12, hint + 30)
  }

  /** Repérage sur le raccourci : échantillon, écart latéral, et `out` si on est avant le début / après la fin. */
  locateCut(x: number, z: number) {
    const c = this.cut!
    let j = 0
    let bd = Infinity
    for (let k = 0; k < c.m; k++) {
      const d = (x - c.x[k]) ** 2 + (z - c.z[k]) ** 2
      if (d < bd) {
        bd = d
        j = k
      }
    }
    const dx = x - c.x[j]
    const dz = z - c.z[j]
    const along = dx * c.tx[j] + dz * c.tz[j]
    return { j, lat: dx * -c.tz[j] + dz * c.tx[j], out: (j === 0 && along < -1.5) || (j === c.m - 1 && along > 1.5) }
  }

  /** L'échantillon `i` est-il près d'un bout du raccourci (là où l'on peut y entrer ou en sortir) ? */
  nearCut(i: number) {
    const c = this.cut
    if (!c) return false
    const a = this.wrap(i - c.iA + 14)
    const b = this.wrap(i - c.iB + 84)
    return a < 98 || b < 98
  }

  /** Échantillon de la piste correspondant à l'avancée `j` sur le raccourci (classement, checkpoints). */
  cutIndex(j: number) {
    const c = this.cut!
    return this.wrap(c.iA + Math.round((this.wrap(c.iB - c.iA) * (j + 1)) / (c.m + 1)))
  }

  pointAt(i: number, lat: number): [number, number] {
    const k = this.wrap(i)
    return [this.px[k] - this.tz[k] * lat, this.pz[k] + this.tx[k] * lat]
  }

  isBoost(i: number) {
    return (this.feat[i] & 1) !== 0
  }

  isJump(i: number) {
    return (this.feat[i] & 2) !== 0
  }

  isBump(i: number) {
    return (this.feat[i] & 4) !== 0
  }

  /** Ruban le long de la piste entre deux écarts latéraux. */
  private ribbon(i0: number, i1: number, a: Lat, b: Lat, y: number, col: (k: number) => THREE.Color) {
    const pos: number[] = []
    const colors: number[] = []
    const uvs: number[] = []
    const idx: number[] = []
    for (let k = i0; k <= i1; k++) {
      const i = this.wrap(k)
      const nx = -this.tz[i]
      const nz = this.tx[i]
      const c = col(k)
      const la = typeof a === 'number' ? a : a(i)
      const lb = typeof b === 'number' ? b : b(i)
      pos.push(this.px[i] + nx * la, y, this.pz[i] + nz * la, this.px[i] + nx * lb, y, this.pz[i] + nz * lb)
      colors.push(c.r, c.g, c.b, c.r, c.g, c.b)
      uvs.push(0, k * 0.12, (lb - la) / 6, k * 0.12)
      if (k > i0) {
        const v = (k - i0) * 2
        idx.push(v - 2, v - 1, v, v - 1, v + 1, v)
      }
    }
    return ribbonGeo(pos, colors, uvs, idx)
  }

  /** Ruban le long du raccourci. */
  private cutRibbon(a: number, b: number, y: number, col: (k: number) => THREE.Color) {
    const c = this.cut!
    const pos: number[] = []
    const colors: number[] = []
    const uvs: number[] = []
    const idx: number[] = []
    for (let k = 0; k < c.m; k++) {
      const nx = -c.tz[k]
      const nz = c.tx[k]
      const cc = col(k)
      pos.push(c.x[k] + nx * a, y, c.z[k] + nz * a, c.x[k] + nx * b, y, c.z[k] + nz * b)
      colors.push(cc.r, cc.g, cc.b, cc.r, cc.g, cc.b)
      uvs.push(0, k * 0.12, (b - a) / 6, k * 0.12)
      if (k) {
        const v = k * 2
        idx.push(v - 2, v - 1, v, v - 1, v + 1, v)
      }
    }
    return ribbonGeo(pos, colors, uvs, idx)
  }

  /** Distance au bord de la chaussée la plus proche (< 0 : sur la piste), raccourci compris. */
  private clearance(x: number, z: number) {
    const m = this.locate(x, z)
    let d = Math.sqrt(m.d2) - this.hw[m.i] - WALL_MARGIN
    const c = this.cut
    if (c) {
      let bd = Infinity
      for (let k = 0; k < c.m; k++) bd = Math.min(bd, (x - c.x[k]) ** 2 + (z - c.z[k]) ** 2)
      d = Math.min(d, Math.sqrt(bd) - c.half - CUT_MARGIN)
    }
    return d
  }

  /** Maillages instanciés découpés en 8 tronçons de circuit : ceux qui sont hors champ ne sont pas dessinés. */
  private instanced(group: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, items: Item[]) {
    const CH = 8
    for (let ch = 0; ch < CH; ch++) {
      const mine = items.filter((it) => Math.min(CH - 1, Math.floor((it.i / this.n) * CH)) === ch)
      if (!mine.length) continue
      const mesh = new THREE.InstancedMesh(geo, mat, mine.length)
      mine.forEach((it, k) => {
        mesh.setMatrixAt(k, it.m)
        mesh.setColorAt(k, it.c)
      })
      mesh.computeBoundingSphere()
      group.add(mesh)
    }
  }

  build(): THREE.Group {
    const c = this.def.colors
    const g = this.geo
    const group = new THREE.Group()
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })
    const add = (geo: THREE.BufferGeometry) => group.add(new THREE.Mesh(geo, mat))
    const hw = (i: number) => this.hw[i]
    const road = new THREE.Color(c.road)
    const roadB = road.clone().multiplyScalar(0.93)
    const kA = new THREE.Color(c.kerbA)
    const kB = new THREE.Color(c.kerbB)
    // bitume texturé (grain) légèrement varié
    const roadMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, map: noiseTexture(200, 255, 2600) })
    group.add(new THREE.Mesh(this.ribbon(0, this.n, (i) => -hw(i), hw, 0.02, (k) => (Math.floor(k / 8) % 2 ? road : roadB)), roadMat))
    // ligne blanche centrale en pointillés
    const dash = new THREE.Color('#F4F4F4')
    for (let k = 4; k < this.n - 4; k += 12) add(this.ribbon(k, k + 5, -0.18, 0.18, 0.035, () => dash))
    add(this.ribbon(0, this.n, (i) => -hw(i) - 1.2, (i) => -hw(i), 0.03, (k) => (Math.floor(k / 4) % 2 ? kA : kB)))
    add(this.ribbon(0, this.n, hw, (i) => hw(i) + 1.2, 0.03, (k) => (Math.floor(k / 4) % 2 ? kA : kB)))
    // ligne de départ (damier)
    const white = new THREE.Color('#FFFFFF')
    const black = new THREE.Color('#1B1B2F')
    const h0 = this.hw[0]
    for (let s = 0; s < 8; s++) {
      const a = -h0 + (s * 2 * h0) / 8
      add(this.ribbon(0, 1, a, a + (2 * h0) / 8, 0.04, () => (s % 2 ? white : black)))
      add(this.ribbon(1, 2, a, a + (2 * h0) / 8, 0.04, () => (s % 2 ? black : white)))
    }
    // dalles turbo (chevrons jaune / orange)
    const padA = new THREE.Color('#FFD23F')
    const padB = new THREE.Color('#FF8C42')
    for (const [i0, i1] of g.boosts) add(this.ribbon(i0, i1, (i) => -hw(i) * 0.55, (i) => hw(i) * 0.55, 0.05, (k) => (k % 2 ? padA : padB)))
    // tremplins : rampe rayée noir/jaune sur toute la largeur
    for (const [i0, i1] of g.jumps) {
      const ramp = this.ribbon(i0, i1, (i) => -hw(i), hw, 0.06, (k) => (k % 2 ? black : padA))
      const pos = ramp.getAttribute('position')
      for (let v = 0; v < pos.count; v++) pos.setY(v, 0.06 + (Math.floor(v / 2) / Math.max(1, i1 - i0)) * 0.9)
      add(ramp)
    }
    // bosses : petit dos d'âne rayé
    const humpA = new THREE.Color('#FF5A5F')
    for (const b of g.bumps) {
      const hump = this.ribbon(b - 1, b + 1, (i) => -hw(i), hw, 0.05, (k) => (k === b ? white : humpA))
      const pos = hump.getAttribute('position')
      pos.setY(2, 0.5)
      pos.setY(3, 0.5)
      add(hump)
    }
    // lignes blanches de bord de piste
    add(this.ribbon(0, this.n, (i) => -hw(i) + 0.35, (i) => -hw(i) + 0.65, 0.034, () => dash))
    add(this.ribbon(0, this.n, (i) => hw(i) - 0.65, (i) => hw(i) - 0.35, 0.034, () => dash))
    // raccourci : chemin étroit d'une autre matière, bordé d'un liseré
    const cut = this.cut
    if (cut) {
      const cA = new THREE.Color(c.cut)
      const cB = cA.clone().multiplyScalar(0.88)
      const rim = cA.clone().multiplyScalar(0.55)
      add(this.cutRibbon(-cut.half - 0.5, cut.half + 0.5, 0.042, () => rim))
      add(this.cutRibbon(-cut.half, cut.half, 0.048, (k) => (Math.floor(k / 3) % 2 ? cA : cB)))
    }
    // flaques : tache colorée cernée d'un bord plus sombre
    {
      const disc = new THREE.CircleGeometry(1, 20)
      disc.rotateX(-Math.PI / 2)
      const col = new THREE.Color(c.puddle)
      const m = new THREE.Matrix4()
      for (const [r, y, cc] of [[PUDDLE_R + 0.35, 0.056, col.clone().multiplyScalar(0.6)], [PUDDLE_R, 0.062, col], [PUDDLE_R * 0.35, 0.068, col.clone().lerp(white, 0.6)]] as const) {
        const mesh = new THREE.InstancedMesh(disc, new THREE.MeshBasicMaterial({ color: cc }), this.puddles.length)
        this.puddles.forEach((p, k) => {
          const off = r < 1 ? 0.9 : 0
          m.makeScale(r * (k % 2 ? 1.15 : 0.95), 1, r * (k % 2 ? 0.9 : 1.1)).setPosition(p.x - off, y, p.z - off * 0.6)
          mesh.setMatrixAt(k, m)
        })
        mesh.computeBoundingSphere()
        group.add(mesh)
      }
    }
    // sol : grain + grandes taches claires/sombres pour casser l'aplat
    let cx = 0
    let cz = 0
    for (let i = 0; i < this.n; i++) {
      cx += this.px[i] / this.n
      cz += this.pz[i] / this.n
    }
    const groundTex = groundTexture()
    groundTex.repeat.set(15, 15)
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2300, 2300), new THREE.MeshBasicMaterial({ color: c.ground, map: groundTex }))
    ground.rotation.x = -Math.PI / 2
    ground.position.set(cx, 0, cz)
    group.add(ground)

    // décor : emplacements hors de la piste (jamais dans une autre portion du circuit ni sur le raccourci)
    const spots: { i: number; x: number; z: number; s: number; a: number }[] = []
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < this.n; i += 5) {
      for (const side of [-1, 1]) {
        if (rnd() < 0.3) continue
        const [x, z] = this.pointAt(i, side * (this.hw[i] + WALL_MARGIN + 3 + rnd() * 30))
        if (this.clearance(x, z) < 2.5) continue
        spots.push({ i, x, z, s: 1.6 + rnd() * 3, a: rnd() * Math.PI * 2 })
      }
    }
    // chaque thème a ses objets ; un objet = plusieurs formes, chacune instanciée par tronçon
    const props = decorProps(this.def.decor, c.decor)
    const weights = [3, 2, 1]
    const kindOf = (k: number) => {
      const r = (k * 7) % 6
      return r < weights[0] ? 0 : r < weights[0] + weights[1] ? 1 : 2
    }
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    props.forEach((parts, kind) => {
      const mine = spots.filter((_, k) => kindOf(k) === kind)
      for (const part of parts) {
        const items: Item[] = mine.map((p, k) => {
          q.setFromAxisAngle(up, p.a)
          return { i: p.i, m: new THREE.Matrix4().compose(new THREE.Vector3(p.x, part.y(p.s), p.z), q, part.scale(p.s)), c: new THREE.Color(part.color(k)) }
        })
        this.instanced(group, part.geo, toon(), items)
      }
    })
    this.addWalls(group)
    this.addGate(group, this.px[1], this.pz[1], Math.atan2(this.tz[1], this.tx[1]), this.hw[1] + 1.6, 'DÉDÉ KART', '#FF8C42', 6.6)
    if (cut && cut.m > 12) {
      const j = 7
      this.addGate(group, cut.x[j], cut.z[j], Math.atan2(cut.tz[j], cut.tx[j]), cut.half + 1.2, 'RACCOURCI', '#7B2CBF', 4.6)
    }
    this.addMovers(group)
    // horizon : relief lointain selon le thème, nuages, soleil
    const far = backdrop(this.def.decor, c.sky)
    far.position.set(cx, 0, cz)
    group.add(far)
    return group
  }

  /** Murs de pneus le long des bords infranchissables (piste et raccourci). */
  private addWalls(group: THREE.Group) {
    const tire = new THREE.TorusGeometry(0.5, 0.24, 4, 9)
    tire.rotateX(Math.PI / 2)
    const red = new THREE.Color('#E63946')
    const white = new THREE.Color('#F1F1F1')
    const black = new THREE.Color('#2A2A33')
    const items: Item[] = []
    let k = 0
    for (let i = 0; i < this.n; i += 4) {
      for (const side of [-1, 1]) {
        const [x, z] = this.pointAt(i, side * (this.hw[i] + WALL_MARGIN + 0.6))
        // pas de pneus là où une autre portion (épingle) ou le raccourci passe
        if (this.clearance(x, z) < -0.1) continue
        for (const y of [0.24, 0.66]) {
          items.push({ i, m: new THREE.Matrix4().makeTranslation(x, y, z), c: y < 0.5 ? black : Math.floor(k / 3) % 2 ? red : white })
        }
        k++
      }
    }
    const c = this.cut
    if (c) {
      const col = new THREE.Color('#7B2CBF')
      for (let j = 0; j < c.m; j += 3) {
        for (const side of [-1, 1]) {
          const lat = side * (c.half + CUT_MARGIN + 0.6)
          const x = c.x[j] - c.tz[j] * lat
          const z = c.z[j] + c.tx[j] * lat
          const m = this.locate(x, z)
          if (Math.sqrt(m.d2) < this.hw[m.i] + WALL_MARGIN + 0.5) continue
          items.push({ i: this.cutIndex(j), m: new THREE.Matrix4().makeTranslation(x, 0.24, z), c: Math.floor(j / 3) % 2 ? col : white })
        }
      }
    }
    this.instanced(group, tire, new THREE.MeshLambertMaterial(), items)
  }

  /** Portique (ligne de départ, entrée du raccourci). */
  private addGate(group: THREE.Group, x0: number, z0: number, ang: number, span: number, text: string, color: string, top: number) {
    const mat = new THREE.MeshLambertMaterial({ color: '#2B2D42' })
    const g = new THREE.Group()
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, top + 0.4, 8), mat)
      post.position.set(0, (top + 0.4) / 2, s * span)
      g.add(post)
    }
    const c = document.createElement('canvas')
    c.width = 512
    c.height = 96
    const ctx = c.getContext('2d')!
    ctx.fillStyle = color
    ctx.fillRect(0, 0, 512, 96)
    for (let i = 0; i < 16; i++) {
      ctx.fillStyle = i % 2 ? '#1B1B2F' : '#FFFFFF'
      ctx.fillRect(i * 32, 0, 32, 14)
      ctx.fillStyle = i % 2 ? '#FFFFFF' : '#1B1B2F'
      ctx.fillRect(i * 32, 82, 32, 14)
    }
    ctx.fillStyle = '#FFFFFF'
    ctx.font = 'bold 54px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, 256, 50)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    const face = new THREE.MeshBasicMaterial({ map: tex })
    const banner = new THREE.Mesh(new THREE.BoxGeometry(0.4, Math.min(1.6, span * 0.4), span * 2 + 0.8), [face, face, mat, mat, mat, mat])
    banner.position.y = top
    g.add(banner)
    g.position.set(x0, 0, z0)
    g.rotation.y = -ang
    group.add(g)
  }

  /** Obstacles mobiles du thème (animés par Game). */
  private addMovers(group: THREE.Group) {
    for (const m of this.geo.movers) {
      const { mesh, roll } = moverMesh(this.def.decor)
      // l'axe x du modèle = sens de la traversée (perpendiculaire à la piste)
      mesh.rotation.y = -Math.atan2(this.tx[m.i], -this.tz[m.i])
      group.add(mesh)
      this.movers.push({ mesh, roll, i: m.i, amp: m.amp, period: m.period, phase: m.phase })
    }
  }
}

function ribbonGeo(pos: number[], colors: number[], uvs: number[], idx: number[]) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  g.setIndex(idx)
  return g
}

type Part = { geo: THREE.BufferGeometry; y: (s: number) => number; scale: (s: number) => THREE.Vector3; color: (k: number) => string }

/** Objets de décor d'un thème : 3 objets (fréquent, moyen, rare), chacun fait de quelques formes simples. */
function decorProps(kind: Decor, palette: string[]): Part[][] {
  const pal = (k: number) => palette[k % palette.length]
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
  const sphere = () => new THREE.SphereGeometry(1, 12, 9)
  if (kind === 'parasols') {
    return [
      // parasol
      [
        { geo: new THREE.CylinderGeometry(0.1, 0.1, 1, 6), y: (s) => s * 0.6, scale: (s) => V(1, s * 1.2, 1), color: () => '#FFFFFF' },
        { geo: new THREE.ConeGeometry(1, 0.55, 12), y: (s) => s * 1.25, scale: (s) => V(s * 0.95, s * 0.6, s * 0.95), color: pal },
      ],
      // palmier
      [
        { geo: new THREE.CylinderGeometry(0.16, 0.26, 1, 7), y: (s) => s * 1.1, scale: (s) => V(1, s * 2.2, 1), color: () => '#9C6B4A' },
        { geo: new THREE.IcosahedronGeometry(1, 0), y: (s) => s * 2.3, scale: (s) => V(s * 1.15, s * 0.32, s * 1.15), color: (k) => (k % 2 ? '#2FA36B' : '#3DBB7E') },
      ],
      // ballon de plage
      [{ geo: sphere(), y: (s) => s * 0.3, scale: (s) => V(s * 0.3, s * 0.3, s * 0.3), color: pal }],
    ]
  }
  if (kind === 'pines') {
    const roof = new THREE.ConeGeometry(1, 1, 4)
    roof.rotateY(Math.PI / 4)
    return [
      // sapin enneigé
      [
        { geo: new THREE.ConeGeometry(1, 1, 8), y: (s) => s * 1.1, scale: (s) => V(s * 0.75, s * 2.2, s * 0.75), color: pal },
        { geo: new THREE.ConeGeometry(1, 1, 8), y: (s) => s * 2.0, scale: (s) => V(s * 0.32, s * 0.5, s * 0.32), color: () => '#FFFFFF' },
      ],
      // chalet au toit enneigé
      [
        { geo: new THREE.BoxGeometry(1, 1, 1), y: (s) => s * 0.4, scale: (s) => V(s * 1.3, s * 0.8, s * 1.1), color: (k) => (k % 2 ? '#8A5A3B' : '#A46B45') },
        { geo: roof, y: (s) => s * 1.1, scale: (s) => V(s * 1.15, s * 0.65, s * 1.0), color: () => '#FFFFFF' },
      ],
      // bonhomme de neige
      [
        { geo: sphere(), y: (s) => s * 0.3, scale: (s) => V(s * 0.32, s * 0.32, s * 0.32), color: () => '#FFFFFF' },
        { geo: sphere(), y: (s) => s * 0.72, scale: (s) => V(s * 0.21, s * 0.21, s * 0.21), color: () => '#FFFFFF' },
      ],
    ]
  }
  if (kind === 'garden') {
    const root = new THREE.ConeGeometry(1, 1, 9)
    root.rotateX(Math.PI)
    return [
      // carotte géante plantée
      [
        { geo: root, y: (s) => s * 0.55, scale: (s) => V(s * 0.42, s * 1.1, s * 0.42), color: (k) => (k % 3 ? '#FF8C42' : '#F4A340') },
        { geo: new THREE.IcosahedronGeometry(1, 0), y: (s) => s * 1.3, scale: (s) => V(s * 0.5, s * 0.42, s * 0.5), color: (k) => (k % 2 ? '#2FA36B' : '#3DBB7E') },
      ],
      // chou / salade
      [
        { geo: sphere(), y: (s) => s * 0.3, scale: (s) => V(s * 0.6, s * 0.42, s * 0.6), color: (k) => (k % 3 === 0 ? '#9B5DE5' : k % 2 ? '#5FBF4A' : '#7BD15C') },
        { geo: sphere(), y: (s) => s * 0.5, scale: (s) => V(s * 0.36, s * 0.3, s * 0.36), color: (k) => (k % 3 === 0 ? '#C29BF2' : '#B6EBA0') },
      ],
      // tournesol
      [
        { geo: new THREE.CylinderGeometry(0.12, 0.16, 1, 6), y: (s) => s * 1.1, scale: (s) => V(1, s * 2.2, 1), color: () => '#3C9A4B' },
        { geo: sphere(), y: (s) => s * 2.3, scale: (s) => V(s * 0.6, s * 0.6, s * 0.16), color: () => '#FFD23F' },
        { geo: sphere(), y: (s) => s * 2.3, scale: (s) => V(s * 0.3, s * 0.3, s * 0.22), color: () => '#6B3F1D' },
      ],
    ]
  }
  if (kind === 'market') {
    const box = () => new THREE.BoxGeometry(1, 1, 1)
    const can = () => new THREE.CylinderGeometry(1, 1, 1, 12)
    return [
      // rayon : étagère colorée, étiquette de prix, dessus sombre
      [
        { geo: box(), y: (s) => s * 0.8, scale: (s) => V(s * 1.7, s * 1.6, s * 0.7), color: pal },
        { geo: box(), y: (s) => s * 0.8, scale: (s) => V(s * 1.72, s * 0.14, s * 0.72), color: () => '#FFFFFF' },
        { geo: box(), y: (s) => s * 1.66, scale: (s) => V(s * 1.8, s * 0.12, s * 0.8), color: () => '#2B2D42' },
      ],
      // pyramide de conserves
      [
        { geo: can(), y: (s) => s * 0.3, scale: (s) => V(s * 0.75, s * 0.6, s * 0.75), color: pal },
        { geo: can(), y: (s) => s * 0.85, scale: (s) => V(s * 0.52, s * 0.5, s * 0.52), color: (k) => pal(k + 2) },
        { geo: can(), y: (s) => s * 1.3, scale: (s) => V(s * 0.3, s * 0.4, s * 0.3), color: (k) => pal(k + 4) },
      ],
      // panneau « promo » : poteau + étoile jaune
      [
        { geo: new THREE.CylinderGeometry(0.1, 0.1, 1, 6), y: (s) => s * 1.0, scale: (s) => V(1, s * 2, 1), color: () => '#6B6F85' },
        { geo: new THREE.CylinderGeometry(1, 1, 0.3, 10), y: (s) => s * 2.2, scale: (s) => V(s * 0.7, s * 0.7, s * 0.7), color: () => '#FFD23F' },
        { geo: sphere(), y: (s) => s * 2.2, scale: (s) => V(s * 0.3, s * 0.3, s * 0.3), color: () => '#E63946' },
      ],
    ]
  }
  if (kind === 'castle') {
    return [
      // arbre rond
      [
        { geo: new THREE.CylinderGeometry(0.16, 0.22, 1, 6), y: (s) => s * 0.5, scale: (s) => V(1, s, 1), color: () => '#7A5536' },
        { geo: new THREE.IcosahedronGeometry(1, 1), y: (s) => s * 1.25, scale: (s) => V(s * 0.7, s * 0.7, s * 0.7), color: (k) => (k % 2 ? '#3F8F4A' : '#5B8C5A') },
      ],
      // tente de tournoi rayée, boule dorée au sommet
      [
        { geo: new THREE.CylinderGeometry(1, 1, 1, 10), y: (s) => s * 0.35, scale: (s) => V(s * 0.8, s * 0.7, s * 0.8), color: () => '#F4E9CD' },
        { geo: new THREE.ConeGeometry(1, 1, 10), y: (s) => s * 1.1, scale: (s) => V(s * 0.95, s * 0.85, s * 0.95), color: pal },
        { geo: sphere(), y: (s) => s * 1.58, scale: (s) => V(s * 0.12, s * 0.12, s * 0.12), color: () => '#F4C430' },
      ],
      // tour de guet
      [
        { geo: new THREE.CylinderGeometry(1, 1.1, 1, 10), y: (s) => s * 1.2, scale: (s) => V(s * 0.55, s * 2.4, s * 0.55), color: (k) => (k % 2 ? '#B9B2A3' : '#CFC8B8') },
        { geo: new THREE.CylinderGeometry(1, 1, 1, 10), y: (s) => s * 2.5, scale: (s) => V(s * 0.68, s * 0.3, s * 0.68), color: () => '#A39C8D' },
        { geo: new THREE.ConeGeometry(1, 1, 10), y: (s) => s * 3.15, scale: (s) => V(s * 0.72, s * 1.0, s * 0.72), color: () => '#9D2235' },
      ],
    ]
  }
  return [
    // cube de jouet
    [{ geo: new THREE.BoxGeometry(1, 1, 1), y: (s) => s / 2, scale: (s) => V(s, s, s), color: pal }],
    // ballon
    [{ geo: sphere(), y: (s) => s * 0.5, scale: (s) => V(s * 0.5, s * 0.5, s * 0.5), color: pal }],
    // crayon de couleur géant
    [
      { geo: new THREE.CylinderGeometry(0.3, 0.3, 1, 8), y: (s) => s * 0.9, scale: (s) => V(1, s * 1.8, 1), color: pal },
      { geo: new THREE.ConeGeometry(0.3, 0.6, 8), y: (s) => s * 1.8 + 0.3, scale: () => V(1, 1, 1), color: () => '#F3D9B1' },
    ],
  ]
}

/** Obstacle mobile du thème (≈ 3 de large, l'axe x du modèle est son sens de déplacement). */
function moverMesh(kind: Decor): { mesh: THREE.Group; roll: boolean } {
  const mesh = new THREE.Group()
  const body = new THREE.Group()
  mesh.add(body)
  const put = (geo: THREE.BufferGeometry, color: string, x: number, y: number, z: number, ink = false) => {
    const m = new THREE.Mesh(geo, toon(color))
    m.position.set(x, y, z)
    if (ink) m.add(outline(geo, 1.07))
    body.add(m)
    return m
  }
  let roll = false
  if (kind === 'parasols') {
    // crabe
    const shell = new THREE.SphereGeometry(1.3, 14, 10)
    shell.scale(1, 0.55, 0.8)
    put(shell, '#E63946', 0, 0.9, 0, true)
    for (const s of [-1, 1]) {
      put(new THREE.SphereGeometry(0.5, 10, 8), '#FF5A5F', 1.5 * s, 1.2, 0.5, true)
      put(new THREE.SphereGeometry(0.2, 8, 6), '#FFFFFF', 0.4 * s, 1.7, 0.5)
      put(new THREE.SphereGeometry(0.1, 6, 5), '#1B1B2F', 0.4 * s, 1.75, 0.66)
      for (const z of [-0.5, 0, 0.5]) put(new THREE.CylinderGeometry(0.08, 0.08, 0.8, 5), '#C1272D', 1.1 * s, 0.4, z).rotation.z = 0.6 * s
    }
  } else if (kind === 'pines') {
    // meule de fromage qui roule
    roll = true
    const wheel = new THREE.CylinderGeometry(1.5, 1.5, 0.9, 20)
    wheel.rotateX(Math.PI / 2)
    put(wheel, '#FFD23F', 0, 0, 0, true)
    const rind = new THREE.CylinderGeometry(1.52, 1.52, 0.3, 20)
    rind.rotateX(Math.PI / 2)
    put(rind, '#F4A340', 0, 0, 0)
    for (const [x, y] of [[0.6, 0.5], [-0.7, 0.2], [0.1, -0.8], [-0.2, 0.9]]) put(new THREE.SphereGeometry(0.22, 8, 6), '#E8B72E', x, y, 0.42)
    body.position.y = 1.5
  } else if (kind === 'garden') {
    // citrouille qui roule
    roll = true
    const gourd = new THREE.SphereGeometry(1.5, 16, 12)
    gourd.scale(1, 1, 0.82)
    put(gourd, '#FF8C42', 0, 0, 0, true)
    const rib = new THREE.TorusGeometry(1.5, 0.09, 6, 20)
    put(rib, '#D96A1E', 0, 0, 0).scale.set(1, 1, 0.82)
    const rib2 = put(rib, '#D96A1E', 0, 0, 0)
    rib2.rotation.x = Math.PI / 2
    put(new THREE.CylinderGeometry(0.16, 0.24, 0.7, 6), '#3C9A4B', 0, 1.6, 0)
    body.position.y = 1.5
  } else if (kind === 'market') {
    // caddie
    const basket = new THREE.BoxGeometry(2.4, 1.2, 1.6)
    put(basket, '#C9D3E0', 0, 1.5, 0, true)
    put(new THREE.BoxGeometry(2.0, 0.7, 1.3), '#E63946', 0, 1.95, 0)
    put(new THREE.BoxGeometry(0.9, 0.5, 0.9), '#FFD23F', 0.4, 2.3, 0.1)
    const bar = put(new THREE.CylinderGeometry(0.1, 0.1, 1.8, 6), '#E63946', -1.45, 2.2, 0)
    bar.rotation.x = Math.PI / 2
    for (const x of [-0.9, 0.9]) for (const z of [-0.7, 0.7]) put(new THREE.SphereGeometry(0.28, 8, 6), '#2A2A33', x, 0.3, z)
    for (const x of [-0.9, 0.9]) put(new THREE.CylinderGeometry(0.07, 0.07, 0.7, 5), '#8A93A6', x, 0.65, 0)
  } else if (kind === 'castle') {
    // tonneau qui roule
    roll = true
    const barrel = new THREE.CylinderGeometry(1.35, 1.35, 2.2, 16)
    barrel.rotateX(Math.PI / 2)
    put(barrel, '#8A5A3B', 0, 0, 0, true)
    for (const z of [-0.75, 0, 0.75]) {
      const ring = new THREE.CylinderGeometry(z ? 1.4 : 1.5, z ? 1.4 : 1.5, 0.22, 16)
      ring.rotateX(Math.PI / 2)
      put(ring, z ? '#3C3C4A' : '#A46B45', 0, 0, z)
    }
    put(new THREE.SphereGeometry(0.2, 8, 6), '#3C3C4A', 0.9, 0.4, 1.12)
    body.position.y = 1.4
  } else {
    // aspirateur robot
    put(new THREE.CylinderGeometry(1.6, 1.6, 0.6, 20), '#3C3C4A', 0, 0.45, 0, true)
    put(new THREE.CylinderGeometry(1.1, 1.1, 0.12, 20), '#6B6F85', 0, 0.8, 0)
    put(new THREE.SphereGeometry(0.2, 8, 6), '#38E07B', 0.9, 0.82, 0)
    put(new THREE.BoxGeometry(0.3, 0.3, 1.6), '#FF5A5F', 1.45, 0.4, 0)
  }
  mesh.userData.body = body
  return { mesh, roll }
}

/** Horizon du circuit : relief lointain selon le thème, nuages et soleil. */
function backdrop(kind: Decor, sky: string) {
  const group = new THREE.Group()
  const air = new THREE.Color(sky)
  const tint = (hex: string, f: number) => new THREE.Color(hex).lerp(air, f)
  let clouds = 16
  let sunAt: [number, number, number, number] | null = [380, 320, -480, 210]
  if (kind === 'pines') {
    // deux rangées de sommets enneigés
    group.add(ridge(720, 70, 240, 0.8, tint('#5F7FAE', 0.3), tint('#FFFFFF', 0), 1.7))
    group.add(ridge(620, 28, 135, 1.1, tint('#3F5F92', 0.15), tint('#DCE9FB', 0), 4.2))
  } else if (kind === 'parasols') {
    // la mer jusqu'à l'horizon, un liseré d'écume, puis des îles
    const sea = new THREE.Mesh(new THREE.RingGeometry(420, 1000, 64), new THREE.MeshBasicMaterial({ color: tint('#1FA7D6', 0.15), fog: false }))
    sea.rotation.x = -Math.PI / 2
    sea.position.y = 0.25
    group.add(sea)
    const foam = new THREE.Mesh(new THREE.RingGeometry(414, 424, 64), new THREE.MeshBasicMaterial({ color: '#FFFFFF', fog: false }))
    foam.rotation.x = -Math.PI / 2
    foam.position.y = 0.27
    group.add(foam)
    group.add(ridge(740, 0, 100, 2.0, tint('#2E8A5C', 0.25), tint('#7BD39A', 0.15), 2.9))
  } else if (kind === 'garden') {
    // haie du jardin, puis collines vertes
    group.add(ridge(720, 40, 120, 1.3, tint('#3E9B57', 0.3), tint('#A9E08A', 0.2), 5.1))
    group.add(ridge(600, 26, 16, 0.6, tint('#1F6B3A', 0.1), tint('#3C9A4B', 0.05), 2.2))
  } else if (kind === 'market') {
    // murs du magasin : soubassement rouge, mur clair, bandeau jaune
    clouds = 0
    sunAt = null
    group.add(ridge(700, 150, 0, 1, tint('#F4F7FB', 0), tint('#C9D6E8', 0), 1))
    group.add(ridge(698, 96, 0, 1, tint('#FFD23F', 0), tint('#FFD23F', 0), 1))
    group.add(ridge(696, 84, 0, 1, tint('#F4F7FB', 0), tint('#F4F7FB', 0), 1))
    group.add(ridge(694, 22, 0, 1, tint('#B71F2B', 0), tint('#E63946', 0), 1))
  } else if (kind === 'castle') {
    // remparts au loin, collines au couchant
    sunAt = [-420, 150, -520, 300]
    group.add(ridge(740, 50, 170, 1.0, tint('#7A4B7C', 0.3), tint('#E9A0A0', 0.25), 3.9))
    group.add(ridge(620, 20, 70, 1.6, tint('#3E6B45', 0.15), tint('#7FB069', 0.1), 1.3))
  } else {
    // collines pastel de pays des jouets
    group.add(ridge(720, 42, 130, 1.2, tint('#A77BD9', 0.25), tint('#F2A9D8', 0.15), 0.6))
    group.add(ridge(620, 18, 70, 1.4, tint('#5FC08A', 0.15), tint('#B6EBA0', 0.1), 3.3))
  }
  // nuages : petits amas de boules aplaties
  if (clouds) {
    const puff = new THREE.SphereGeometry(1, 8, 6)
    const mesh = new THREE.InstancedMesh(puff, new THREE.MeshBasicMaterial({ color: kind === 'castle' ? '#FFE3D0' : '#FFFFFF', fog: false, transparent: true, opacity: 0.92 }), clouds * 3)
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    let seed = 23
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let n = 0; n < clouds; n++) {
      const a = rnd() * Math.PI * 2
      const r = 320 + rnd() * 300
      const y = 130 + rnd() * 80
      const s = 22 + rnd() * 22
      for (let k = 0; k < 3; k++) {
        m.compose(
          new THREE.Vector3(Math.cos(a) * r + (k - 1) * s * 0.9, y + (k === 1 ? s * 0.25 : 0), Math.sin(a) * r),
          q,
          new THREE.Vector3(s * (k === 1 ? 1.2 : 0.9), s * 0.5, s * 0.8),
        )
        mesh.setMatrixAt(n * 3 + k, m)
      }
    }
    mesh.frustumCulled = false
    group.add(mesh)
  }
  // soleil avec halo
  if (sunAt) {
    const c = document.createElement('canvas')
    c.width = c.height = 128
    const g = c.getContext('2d')!
    const grad = g.createRadialGradient(64, 64, 6, 64, 64, 64)
    grad.addColorStop(0, 'rgba(255,255,240,1)')
    grad.addColorStop(0.3, kind === 'castle' ? 'rgba(255,190,120,0.95)' : 'rgba(255,240,170,0.95)')
    grad.addColorStop(0.45, 'rgba(255,225,140,0.35)')
    grad.addColorStop(1, 'rgba(255,225,140,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 128, 128)
    const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), fog: false, depthWrite: false }))
    sun.scale.set(sunAt[3], sunAt[3], 1)
    sun.position.set(sunAt[0], sunAt[1], sunAt[2])
    group.add(sun)
  }
  return group
}

/** Grain gris clair (multiplie la couleur) : bitume, sable, neige. */
function noiseTexture(lo: number, hi: number, dots: number) {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  g.fillStyle = `rgb(${hi},${hi},${hi})`
  g.fillRect(0, 0, 128, 128)
  let seed = 3
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < dots; i++) {
    const v = Math.round(lo + rnd() * (hi - lo))
    g.fillStyle = `rgb(${v},${v},${v})`
    g.fillRect(Math.floor(rnd() * 128), Math.floor(rnd() * 128), 1 + Math.floor(rnd() * 2), 1 + Math.floor(rnd() * 2))
  }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

/** Ciel en dégradé (horizon clair -> zénith plus profond). */
function skyDome(horizon: string) {
  const geo = new THREE.SphereGeometry(1000, 24, 12)
  const h = new THREE.Color(horizon)
  const top = h.clone().offsetHSL(0.02, 0.15, -0.22)
  const pos = geo.getAttribute('position')
  const cols: number[] = []
  const tmp = new THREE.Color()
  for (let i = 0; i < pos.count; i++) {
    const f = Math.max(0, pos.getY(i) / 1000)
    tmp.copy(h).lerp(top, Math.pow(f, 0.6))
    cols.push(tmp.r, tmp.g, tmp.b)
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3))
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }))
}

/** Sol : grain fin + grandes taches douces (clair / sombre). */
function groundTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 512
  const g = c.getContext('2d')!
  g.fillStyle = '#F2F2F2'
  g.fillRect(0, 0, 512, 512)
  let seed = 11
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 46; i++) {
    const x = rnd() * 512
    const y = rnd() * 512
    const r = 30 + rnd() * 70
    const dark = rnd() < 0.55
    // répété sur les bords pour que la texture se raccorde
    for (const dx of [-512, 0, 512]) {
      for (const dy of [-512, 0, 512]) {
        const grad = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r)
        grad.addColorStop(0, dark ? 'rgba(170,170,170,0.5)' : 'rgba(255,255,255,0.7)')
        grad.addColorStop(1, 'rgba(255,255,255,0)')
        g.fillStyle = grad
        g.fillRect(x + dx - r, y + dy - r, r * 2, r * 2)
      }
    }
  }
  for (let i = 0; i < 9000; i++) {
    const v = Math.round(205 + rnd() * 50)
    g.fillStyle = `rgba(${v},${v},${v},0.6)`
    g.fillRect(Math.floor(rnd() * 512), Math.floor(rnd() * 512), 2, 2)
  }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

/** Anneau de relief lointain : silhouette douce ou pointue, teintée vers le ciel (perspective atmosphérique). */
function ridge(radius: number, base: number, amp: number, sharp: number, low: THREE.Color, high: THREE.Color, seed: number) {
  const N = 120
  const pos: number[] = []
  const col: number[] = []
  const idx: number[] = []
  const height = (a: number) => {
    const n = Math.sin(a * 3 + seed) * 0.5 + Math.sin(a * 7 + seed * 2.3) * 0.3 + Math.sin(a * 13 + seed * 0.7) * 0.2
    return base + amp * Math.pow(Math.abs(n), sharp)
  }
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2
    const x = Math.cos(a) * radius
    const z = Math.sin(a) * radius
    pos.push(x, -2, z, x, height(a), z)
    col.push(low.r, low.g, low.b, high.r, high.g, high.b)
    if (i) {
      const v = i * 2
      idx.push(v - 2, v, v - 1, v - 1, v, v + 1)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setIndex(idx)
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false }))
}

