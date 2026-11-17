import * as THREE from 'three'
import type { TrackDef } from '../tracks'

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
    const idx: number[] = []
    for (let k = i0; k <= i1; k++) {
      const i = this.wrap(k)
      const nx = -this.tz[i]
      const nz = this.tx[i]
      const c = col(k)
      pos.push(this.px[i] + nx * a, y, this.pz[i] + nz * a, this.px[i] + nx * b, y, this.pz[i] + nz * b)
      colors.push(c.r, c.g, c.b, c.r, c.g, c.b)
      if (k > i0) {
        const v = (k - i0) * 2
        idx.push(v - 2, v - 1, v, v - 1, v + 1, v)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
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
    add(this.ribbon(0, this.n, -h, h, 0.02, (k) => (Math.floor(k / 8) % 2 ? road : roadB)))
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
    // sol
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.MeshBasicMaterial({ color: c.ground }))
    ground.rotation.x = -Math.PI / 2
    group.add(ground)
    // décor : cubes de couleur en instancing, hors de la piste
    const spots: { x: number; z: number; s: number }[] = []
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < this.n; i += 5) {
      for (const side of [-1, 1]) {
        if (rnd() < 0.35) continue
        const [x, z] = this.pointAt(i, side * (h + WALL_MARGIN + 3 + rnd() * 22))
        if (Math.abs(this.locate(x, z).lat) < h + WALL_MARGIN + 2) continue
        spots.push({ x, z, s: 1.5 + rnd() * 3.5 })
      }
    }
    // décor en instancing (un seul appel de rendu par forme) : cubes de jouets, parasols ou sapins
    const parts: { geo: THREE.BufferGeometry; y: (s: number) => number; scale: (s: number) => THREE.Vector3; color: (k: number) => string }[] =
      this.def.decor === 'parasols'
        ? [
            { geo: new THREE.CylinderGeometry(0.12, 0.12, 1, 6), y: (s) => s * 0.6, scale: (s) => new THREE.Vector3(1, s * 1.2, 1), color: () => '#FFFFFF' },
            { geo: new THREE.ConeGeometry(1, 0.6, 10), y: (s) => s * 1.25, scale: (s) => new THREE.Vector3(s * 0.9, s * 0.6, s * 0.9), color: (k) => c.decor[k % c.decor.length] },
          ]
        : this.def.decor === 'pines'
          ? [
              { geo: new THREE.ConeGeometry(1, 1, 8), y: (s) => s * 1.1, scale: (s) => new THREE.Vector3(s * 0.75, s * 2.2, s * 0.75), color: (k) => c.decor[k % c.decor.length] },
              { geo: new THREE.ConeGeometry(1, 1, 8), y: (s) => s * 2.0, scale: (s) => new THREE.Vector3(s * 0.32, s * 0.5, s * 0.32), color: () => '#FFFFFF' },
            ]
          : [{ geo: new THREE.BoxGeometry(1, 1, 1), y: (s) => s / 2, scale: (s) => new THREE.Vector3(s, s, s), color: (k) => c.decor[k % c.decor.length] }]
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const angles = spots.map(() => rnd() * Math.PI)
    for (const part of parts) {
      const mesh = new THREE.InstancedMesh(part.geo, new THREE.MeshLambertMaterial(), spots.length)
      spots.forEach((p, k) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), angles[k])
        m.compose(new THREE.Vector3(p.x, part.y(p.s), p.z), q, part.scale(p.s))
        mesh.setMatrixAt(k, m)
        mesh.setColorAt(k, new THREE.Color(part.color(k)))
      })
      group.add(mesh)
    }
    return group
  }
}
