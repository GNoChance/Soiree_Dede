import * as THREE from 'three'
import type { TrackDef } from '../tracks'
import { toon } from './toon'

/** Marge roulable (lente) de chaque côté de la piste avant le mur invisible. */
export const WALL_MARGIN = 7

/** Piste échantillonnée : positions, tangentes, repérage d'un point et maillages. */
export class Track {
  readonly n: number
  readonly px: Float32Array
  readonly pz: Float32Array
  readonly tx: Float32Array
  readonly tz: Float32Array
  readonly half: number
  readonly def: TrackDef

  constructor(def: TrackDef, samples = 640) {
    this.def = def
    this.n = samples
    this.half = def.width / 2
    const curve = new THREE.CatmullRomCurve3(def.points.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'catmullrom', 0.5)
    const pts = curve.getSpacedPoints(samples)
    this.px = new Float32Array(samples)
    this.pz = new Float32Array(samples)
    this.tx = new Float32Array(samples)
    this.tz = new Float32Array(samples)
    for (let i = 0; i < samples; i++) {
      this.px[i] = pts[i].x
      this.pz[i] = pts[i].z
    }
    for (let i = 0; i < samples; i++) {
      const a = (i + samples - 1) % samples
      const b = (i + 1) % samples
      const dx = this.px[b] - this.px[a]
      const dz = this.pz[b] - this.pz[a]
      const l = Math.hypot(dx, dz) || 1
      this.tx[i] = dx / l
      this.tz[i] = dz / l
    }
  }

  wrap(i: number) {
    return ((i % this.n) + this.n) % this.n
  }

  /** Échantillon le plus proche (fenêtre autour de `hint`, ou recherche complète si hint < 0) + écart latéral (droite > 0). */
  locate(x: number, z: number, hint = -1) {
    const from = hint < 0 ? 0 : hint - 12
    const to = hint < 0 ? this.n - 1 : hint + 30
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
    return { i: best, lat }
  }

  pointAt(i: number, lat: number): [number, number] {
    const k = this.wrap(i)
    return [this.px[k] - this.tz[k] * lat, this.pz[k] + this.tx[k] * lat]
  }

  isBoost(i: number) {
    const f = i / this.n
    return this.def.boosts.some(([a, b]) => f >= a && f <= b)
  }

  isJump(i: number) {
    const f = i / this.n
    return this.def.jumps.some(([a, b]) => f >= a && f <= b)
  }

  /** Ruban le long de la piste entre deux écarts latéraux. */
  private ribbon(i0: number, i1: number, a: number, b: number, y: number, col: (k: number) => THREE.Color) {
    const pos: number[] = []
    const colors: number[] = []
    const uvs: number[] = []
    const idx: number[] = []
    for (let k = i0; k <= i1; k++) {
      const i = this.wrap(k)
      const nx = -this.tz[i]
      const nz = this.tx[i]
      const c = col(k)
      pos.push(this.px[i] + nx * a, y, this.pz[i] + nz * a, this.px[i] + nx * b, y, this.pz[i] + nz * b)
      colors.push(c.r, c.g, c.b, c.r, c.g, c.b)
      uvs.push(0, k * 0.12, (b - a) / 6, k * 0.12)
      if (k > i0) {
        const v = (k - i0) * 2
        idx.push(v - 2, v - 1, v, v - 1, v + 1, v)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    g.setIndex(idx)
    return g
  }

  build(): THREE.Group {
    const c = this.def.colors
    const group = new THREE.Group()
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })
    const add = (g: THREE.BufferGeometry) => group.add(new THREE.Mesh(g, mat))
    const h = this.half
    const road = new THREE.Color(c.road)
    const roadB = road.clone().multiplyScalar(0.93)
    const kA = new THREE.Color(c.kerbA)
    const kB = new THREE.Color(c.kerbB)
    // bitume texturé (grain) légèrement varié
    const roadMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, map: noiseTexture(200, 255, 2600) })
    group.add(new THREE.Mesh(this.ribbon(0, this.n, -h, h, 0.02, (k) => (Math.floor(k / 8) % 2 ? road : roadB)), roadMat))
    // ligne blanche centrale en pointillés
    const dash = new THREE.Color('#F4F4F4')
    for (let k = 4; k < this.n - 4; k += 12) add(this.ribbon(k, k + 5, -0.18, 0.18, 0.035, () => dash))
    add(this.ribbon(0, this.n, -h - 1.2, -h, 0.03, (k) => (Math.floor(k / 4) % 2 ? kA : kB)))
    add(this.ribbon(0, this.n, h, h + 1.2, 0.03, (k) => (Math.floor(k / 4) % 2 ? kA : kB)))
    // ligne de départ (damier)
    const white = new THREE.Color('#FFFFFF')
    const black = new THREE.Color('#1B1B2F')
    for (let s = 0; s < 8; s++) {
      const a = -h + (s * 2 * h) / 8
      add(this.ribbon(0, 1, a, a + (2 * h) / 8, 0.04, () => (s % 2 ? white : black)))
      add(this.ribbon(1, 2, a, a + (2 * h) / 8, 0.04, () => (s % 2 ? black : white)))
    }
    // dalles turbo
    const padA = new THREE.Color('#FFD23F')
    const padB = new THREE.Color('#FF8C42')
    for (const [f0, f1] of this.def.boosts) {
      add(this.ribbon(Math.floor(f0 * this.n), Math.ceil(f1 * this.n), -h * 0.55, h * 0.55, 0.05, (k) => (k % 2 ? padA : padB)))
    }
    // tremplins : rampe rayée noir/jaune sur toute la largeur
    const rampA = new THREE.Color('#1B1B2F')
    const rampB = new THREE.Color('#FFD23F')
    for (const [f0, f1] of this.def.jumps) {
      const i0 = Math.floor(f0 * this.n)
      const i1 = Math.ceil(f1 * this.n)
      const ramp = this.ribbon(i0, i1, -h, h, 0.06, (k) => (k % 2 ? rampA : rampB))
      // la rampe monte jusqu'au bord de saut
      const pos = ramp.getAttribute('position')
      for (let v = 0; v < pos.count; v++) pos.setY(v, 0.06 + (Math.floor(v / 2) / Math.max(1, i1 - i0)) * 0.9)
      add(ramp)
    }
    // lignes blanches de bord de piste
    const edge = new THREE.Color('#F4F4F4')
    add(this.ribbon(0, this.n, -h + 0.35, -h + 0.65, 0.034, () => edge))
    add(this.ribbon(0, this.n, h - 0.65, h - 0.35, 0.034, () => edge))
    // sol : grain + grandes taches claires/sombres pour casser l'aplat
    const groundTex = groundTexture()
    groundTex.repeat.set(9, 9)
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.MeshBasicMaterial({ color: c.ground, map: groundTex }))
    ground.rotation.x = -Math.PI / 2
    group.add(ground)

    // décor : emplacements hors de la piste (jamais dans une autre portion du circuit)
    const spots: { x: number; z: number; s: number; a: number }[] = []
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < this.n; i += 4) {
      for (const side of [-1, 1]) {
        if (rnd() < 0.3) continue
        const [x, z] = this.pointAt(i, side * (h + WALL_MARGIN + 3 + rnd() * 30))
        if (Math.abs(this.locate(x, z).lat) < h + WALL_MARGIN + 2.5) continue
        spots.push({ x, z, s: 1.6 + rnd() * 3, a: rnd() * Math.PI * 2 })
      }
    }
    // chaque thème a ses objets ; un objet = plusieurs formes, chacune instanciée une seule fois
    const pal = (k: number) => c.decor[k % c.decor.length]
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
    type Part = { geo: THREE.BufferGeometry; y: (s: number) => number; scale: (s: number) => THREE.Vector3; color: (k: number) => string }
    const roof = new THREE.ConeGeometry(1, 1, 4)
    roof.rotateY(Math.PI / 4)
    const props: Part[][] =
      this.def.decor === 'parasols'
        ? [
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
            [{ geo: new THREE.SphereGeometry(1, 14, 10), y: (s) => s * 0.3, scale: (s) => V(s * 0.3, s * 0.3, s * 0.3), color: pal }],
          ]
        : this.def.decor === 'pines'
          ? [
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
                { geo: new THREE.SphereGeometry(1, 12, 10), y: (s) => s * 0.3, scale: (s) => V(s * 0.32, s * 0.32, s * 0.32), color: () => '#FFFFFF' },
                { geo: new THREE.SphereGeometry(1, 12, 10), y: (s) => s * 0.72, scale: (s) => V(s * 0.21, s * 0.21, s * 0.21), color: () => '#FFFFFF' },
              ],
            ]
          : [
              // cube de jouet
              [{ geo: new THREE.BoxGeometry(1, 1, 1), y: (s) => s / 2, scale: (s) => V(s, s, s), color: pal }],
              // ballon
              [{ geo: new THREE.SphereGeometry(1, 14, 10), y: (s) => s * 0.5, scale: (s) => V(s * 0.5, s * 0.5, s * 0.5), color: pal }],
              // crayon de couleur géant
              [
                { geo: new THREE.CylinderGeometry(0.3, 0.3, 1, 8), y: (s) => s * 0.9, scale: (s) => V(1, s * 1.8, 1), color: pal },
                { geo: new THREE.ConeGeometry(0.3, 0.6, 8), y: (s) => s * 1.8 + 0.3, scale: () => V(1, 1, 1), color: () => '#F3D9B1' },
              ],
            ]
    const weights = [3, 2, 1]
    const kindOf = (k: number) => {
      const r = (k * 7) % 6
      return r < weights[0] ? 0 : r < weights[0] + weights[1] ? 1 : 2
    }
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    props.forEach((parts, kind) => {
      const mine = spots.filter((_, k) => kindOf(k) === kind)
      for (const part of parts) {
        const mesh = new THREE.InstancedMesh(part.geo, toon(), mine.length)
        mine.forEach((p, k) => {
          q.setFromAxisAngle(up, p.a)
          m.compose(new THREE.Vector3(p.x, part.y(p.s), p.z), q, part.scale(p.s))
          mesh.setMatrixAt(k, m)
          mesh.setColorAt(k, new THREE.Color(part.color(k)))
        })
        group.add(mesh)
      }
    })
    this.addWalls(group, rnd)
    this.addGantry(group)
    // horizon : relief lointain (collines / îles + mer / sommets), nuages, soleil
    let cx = 0
    let cz = 0
    for (let i = 0; i < this.n; i++) {
      cx += this.px[i] / this.n
      cz += this.pz[i] / this.n
    }
    const far = backdrop(this.def.decor, c.sky)
    far.position.set(cx, 0, cz)
    group.add(far)
    group.add(skyDome(c.sky))
    return group
  }

  /** Murs de pneus (rouge / blanc) le long des bords infranchissables. */
  private addWalls(group: THREE.Group, rnd: () => number) {
    const tire = new THREE.TorusGeometry(0.5, 0.24, 6, 12)
    tire.rotateX(Math.PI / 2)
    const spots: [number, number, number][] = []
    for (let i = 0; i < this.n; i += 3) {
      for (const side of [-1, 1]) {
        const [x, z] = this.pointAt(i, side * (this.half + WALL_MARGIN + 0.6))
        // pas de pneus là où le mur d'en face passe trop près (épingle)
        if (Math.abs(this.locate(x, z).lat) < this.half + WALL_MARGIN - 0.5) continue
        for (const y of [0.24, 0.66]) spots.push([x, y, z])
      }
    }
    const mesh = new THREE.InstancedMesh(tire, new THREE.MeshLambertMaterial(), spots.length)
    const m = new THREE.Matrix4()
    const red = new THREE.Color('#E63946')
    const white = new THREE.Color('#F1F1F1')
    const black = new THREE.Color('#2A2A33')
    spots.forEach(([x, y, z], k) => {
      m.makeTranslation(x, y, z)
      mesh.setMatrixAt(k, m)
      mesh.setColorAt(k, y < 0.5 ? black : Math.floor(k / 4) % 2 ? red : white)
    })
    void rnd
    group.add(mesh)
  }

  /** Portique de départ au-dessus de la ligne. */
  private addGantry(group: THREE.Group) {
    const mat = new THREE.MeshLambertMaterial({ color: '#2B2D42' })
    const span = this.half + 1.6
    const [x0, z0] = this.pointAt(1, 0)
    const ang = Math.atan2(this.tz[1], this.tx[1])
    const g = new THREE.Group()
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 7, 10), mat)
      post.position.set(0, 3.5, s * span)
      g.add(post)
    }
    const c = document.createElement('canvas')
    c.width = 512
    c.height = 96
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#FF8C42'
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
    ctx.fillText('DÉDÉ KART', 256, 50)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    const banner = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.6, span * 2 + 0.8), [
      mat, mat, mat, mat,
      new THREE.MeshBasicMaterial({ map: tex }),
      new THREE.MeshBasicMaterial({ map: tex }),
    ])
    banner.position.y = 6.6
    banner.rotation.y = Math.PI / 2
    const holder = new THREE.Group()
    holder.add(banner)
    holder.rotation.y = -Math.PI / 2
    g.add(holder)
    g.position.set(x0, 0, z0)
    g.rotation.y = -ang
    group.add(g)
  }
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
  const geo = new THREE.SphereGeometry(520, 24, 12)
  const h = new THREE.Color(horizon)
  const top = h.clone().offsetHSL(0.02, 0.15, -0.22)
  const pos = geo.getAttribute('position')
  const cols: number[] = []
  const tmp = new THREE.Color()
  for (let i = 0; i < pos.count; i++) {
    const f = Math.max(0, pos.getY(i) / 520)
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

/** Horizon du circuit : relief lointain selon le thème, nuages et soleil. */
function backdrop(kind: TrackDef['decor'], sky: string) {
  const group = new THREE.Group()
  const air = new THREE.Color(sky)
  const tint = (hex: string, f: number) => new THREE.Color(hex).lerp(air, f)
  if (kind === 'pines') {
    // deux rangées de sommets enneigés
    group.add(ridge(500, 50, 170, 0.8, tint('#5F7FAE', 0.3), tint('#FFFFFF', 0), 1.7))
    group.add(ridge(430, 20, 95, 1.1, tint('#3F5F92', 0.15), tint('#DCE9FB', 0), 4.2))
  } else if (kind === 'parasols') {
    // la mer jusqu'à l'horizon, un liseré d'écume, puis des îles
    const sea = new THREE.Mesh(new THREE.RingGeometry(300, 700, 64), new THREE.MeshBasicMaterial({ color: tint('#1FA7D6', 0.15), fog: false }))
    sea.rotation.x = -Math.PI / 2
    sea.position.y = 0.25
    group.add(sea)
    const foam = new THREE.Mesh(new THREE.RingGeometry(296, 303, 64), new THREE.MeshBasicMaterial({ color: '#FFFFFF', fog: false }))
    foam.rotation.x = -Math.PI / 2
    foam.position.y = 0.27
    group.add(foam)
    group.add(ridge(520, 0, 70, 2.0, tint('#2E8A5C', 0.25), tint('#7BD39A', 0.15), 2.9))
  } else {
    // collines pastel de pays des jouets
    group.add(ridge(500, 30, 90, 1.2, tint('#A77BD9', 0.25), tint('#F2A9D8', 0.15), 0.6))
    group.add(ridge(430, 12, 50, 1.4, tint('#5FC08A', 0.15), tint('#B6EBA0', 0.1), 3.3))
  }
  // nuages : petits amas de boules aplaties
  const puff = new THREE.SphereGeometry(1, 8, 6)
  const clouds = new THREE.InstancedMesh(puff, new THREE.MeshBasicMaterial({ color: '#FFFFFF', fog: false, transparent: true, opacity: 0.92 }), 16 * 3)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  let seed = 23
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let n = 0; n < 16; n++) {
    const a = rnd() * Math.PI * 2
    const r = 220 + rnd() * 220
    const y = 95 + rnd() * 60
    const s = 16 + rnd() * 16
    for (let k = 0; k < 3; k++) {
      m.compose(
        new THREE.Vector3(Math.cos(a) * r + (k - 1) * s * 0.9, y + (k === 1 ? s * 0.25 : 0), Math.sin(a) * r),
        q,
        new THREE.Vector3(s * (k === 1 ? 1.2 : 0.9), s * 0.5, s * 0.8),
      )
      clouds.setMatrixAt(n * 3 + k, m)
    }
  }
  group.add(clouds)
  // soleil avec halo
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(64, 64, 6, 64, 64, 64)
  grad.addColorStop(0, 'rgba(255,255,240,1)')
  grad.addColorStop(0.3, 'rgba(255,240,170,0.95)')
  grad.addColorStop(0.45, 'rgba(255,225,140,0.35)')
  grad.addColorStop(1, 'rgba(255,225,140,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), fog: false, depthWrite: false }))
  sun.scale.set(150, 150, 1)
  sun.position.set(260, 230, -330)
  group.add(sun)
  return group
}
