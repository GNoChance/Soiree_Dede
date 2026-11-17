import * as THREE from 'three'

function dotTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 32
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.5, 'rgba(255,255,255,0.6)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 32, 32)
  return new THREE.CanvasTexture(c)
}

/**
 * Particules légères (un seul THREE.Points, pool circulaire) : poussière, fumée, étincelles.
 * Aucune allocation par image.
 */
export class Particles {
  readonly points: THREE.Points
  private n: number
  private pos: Float32Array
  private col: Float32Array
  private vel: Float32Array
  private life: Float32Array
  private max: Float32Array
  private base: Float32Array
  private next = 0
  private c = new THREE.Color()

  constructor(n = 400, size = 0.9, additive = false) {
    this.n = n
    this.pos = new Float32Array(n * 3)
    this.col = new Float32Array(n * 3)
    this.base = new Float32Array(n * 3)
    this.vel = new Float32Array(n * 3)
    this.life = new Float32Array(n)
    this.max = new Float32Array(n)
    for (let i = 0; i < n; i++) this.pos[i * 3 + 1] = -100
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3))
    this.points = new THREE.Points(
      g,
      new THREE.PointsMaterial({
        size,
        map: dotTexture(),
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      }),
    )
    this.points.frustumCulled = false
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: string, life: number) {
    const i = this.next
    this.next = (this.next + 1) % this.n
    this.pos.set([x, y, z], i * 3)
    this.vel.set([vx, vy, vz], i * 3)
    this.c.set(color)
    this.base.set([this.c.r, this.c.g, this.c.b], i * 3)
    this.life[i] = life
    this.max[i] = life
  }

  update(dt: number) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue
      this.life[i] -= dt
      const k = i * 3
      if (this.life[i] <= 0) {
        this.pos[k + 1] = -100
        continue
      }
      this.pos[k] += this.vel[k] * dt
      this.pos[k + 1] += this.vel[k + 1] * dt
      this.pos[k + 2] += this.vel[k + 2] * dt
      this.vel[k + 1] -= 2 * dt
      // estompage : la couleur tend vers 0 (transparent en additif, plus pâle sinon)
      const f = this.life[i] / this.max[i]
      this.col[k] = this.base[k] * f + (1 - f)
      this.col[k + 1] = this.base[k + 1] * f + (1 - f)
      this.col[k + 2] = this.base[k + 2] * f + (1 - f)
    }
    this.points.geometry.attributes.position.needsUpdate = true
    this.points.geometry.attributes.color.needsUpdate = true
  }
}
