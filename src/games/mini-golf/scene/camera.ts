/**
 * Caméra fixe en plongée : le trou entier tient dans l'écran (portrait : départ en bas, trou en haut ;
 * paysage / télé : départ à gauche, trou à droite). Annonce : survol du trou vers le départ.
 */
import * as THREE from 'three'

export interface Frame {
  /** Marges réservées en haut / en bas (fraction de la hauteur) pour l'interface. */
  top: number
  bottom: number
  side: number
}

const ELEVATION = (62 * Math.PI) / 180

export class CameraRig {
  camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200)
  private target = new THREE.Vector3()
  private dist = 10
  private yaw = 0
  private fitTarget = new THREE.Vector3()
  private fitDist = 10
  private intro = 0
  private introFrom = new THREE.Vector3()
  private tmp = new THREE.Vector3()

  constructor(landscape: boolean) {
    // paysage (télé) : trou à l'horizontale, vu un peu de biais pour lire le moulin et le looping
    this.yaw = landscape ? Math.PI / 2 - 0.4 : 0
  }

  setAspect(a: number) {
    this.camera.aspect = a
    this.camera.updateProjectionMatrix()
  }

  private dir() {
    return this.tmp.set(Math.sin(this.yaw) * Math.cos(ELEVATION), Math.sin(ELEVATION), Math.cos(this.yaw) * Math.cos(ELEVATION))
  }

  private place(target: THREE.Vector3, dist: number) {
    this.camera.position.copy(target).addScaledVector(this.dir(), dist)
    this.camera.lookAt(target)
    this.camera.updateMatrixWorld()
  }

  /** Calcule le cadrage qui fait tenir `box` dans l'écran (hors marges). */
  fit(box: THREE.Box3, frame: Frame) {
    const corners: THREE.Vector3[] = []
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z))
    const target = box.getCenter(new THREE.Vector3())
    target.y = 0
    let dist = 12
    const p = new THREE.Vector3()
    const right = new THREE.Vector3()
    const up = new THREE.Vector3()
    const allowX = 1 - frame.side
    const allowY0 = -1 + 2 * frame.bottom
    const allowY1 = 1 - 2 * frame.top
    for (let it = 0; it < 12; it++) {
      this.place(target, dist)
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
      for (const c of corners) {
        p.copy(c).project(this.camera)
        x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y)
      }
      const scale = Math.max((x1 - x0) / (2 * allowX), (y1 - y0) / (allowY1 - allowY0))
      // recentrage dans la zone utile
      const halfH = dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))
      const halfW = halfH * this.camera.aspect
      const cx = (x0 + x1) / 2
      const cy = (y0 + y1) / 2 - (allowY0 + allowY1) / 2
      right.setFromMatrixColumn(this.camera.matrixWorld, 0)
      up.setFromMatrixColumn(this.camera.matrixWorld, 1)
      up.y = 0
      if (up.lengthSq() > 1e-6) up.normalize()
      target.addScaledVector(right, cx * halfW * 0.9).addScaledVector(up, (cy * halfH * 0.9) / Math.sin(ELEVATION))
      target.y = 0
      dist *= 0.35 + 0.65 * scale
    }
    this.fitTarget.copy(target)
    this.fitDist = dist
  }

  /** Cadrage immédiat (sans animation). */
  snap() {
    this.target.copy(this.fitTarget)
    this.dist = this.fitDist
    this.intro = 0
    this.place(this.target, this.dist)
  }

  /** Survol d'annonce : part du trou (zoomé) et recule jusqu'au cadrage complet. */
  flyover(cup: THREE.Vector3) {
    this.introFrom.copy(cup)
    this.intro = 1
  }

  get moving() {
    return this.intro > 0
  }

  update(dt: number) {
    if (this.intro > 0) {
      this.intro = Math.max(0, this.intro - dt / 2.2)
      const k = this.intro * this.intro * (3 - 2 * this.intro)
      this.target.lerpVectors(this.fitTarget, this.introFrom, k)
      this.dist = this.fitDist * (1 - 0.55 * k)
    } else {
      this.target.copy(this.fitTarget)
      this.dist = this.fitDist
    }
    this.place(this.target, this.dist)
  }
}
