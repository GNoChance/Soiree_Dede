/**
 * Outils communs aux thèmes pour le décor des grandes tailles (budget §4.6) : fusion de tout le décor fixe d'un
 * quartier en UN maillage à couleurs par sommet (+ son contour encre fusionné), instanciation, aperçu pâle des
 * quartiers fermés. Un « Batch » = 2 appels de dessin, quel que soit le nombre de pièces.
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { makePlate } from '../textures'
import type { ThemeCtx } from './types'

/** Hasard déterministe (même décor sur tous les écrans). */
export const rnd = (i: number, seed = 0) => {
  const x = Math.sin(i * 91.7 + seed * 13.13 + 17.3) * 43758.5453
  return x - Math.floor(x)
}

const Q = new THREE.Quaternion()
const E = new THREE.Euler()
const SC = new THREE.Vector3()
const C = new THREE.Color()

/** Matrice : position, rotation (Euler XYZ), échelle. */
export function tr(pos: THREE.Vector3, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx, out = new THREE.Matrix4()): THREE.Matrix4 {
  return out.compose(pos, Q.setFromEuler(E.set(rx, ry, rz)), SC.set(sx, sy, sz))
}

/** Copie non indexée, sans groupes, réduite aux attributs utiles. */
function prep(geo: THREE.BufferGeometry, keepNormal: boolean): THREE.BufferGeometry {
  const src = geo.index ? geo.toNonIndexed() : geo.clone()
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', src.getAttribute('position').clone())
  if (keepNormal) {
    if (!src.getAttribute('normal')) src.computeVertexNormals()
    g.setAttribute('normal', src.getAttribute('normal').clone())
  }
  src.dispose()
  return g
}

/**
 * Décor fixe fusionné : chaque pièce a sa couleur (par sommet) et, si `grow` > 0, son contour encre (la même
 * forme grossie autour de SON origine, comme `ctx.inked`). `build` rend un groupe de 2 maillages au plus.
 */
export class Batch {
  private parts: THREE.BufferGeometry[] = []
  private inks: THREE.BufferGeometry[] = []
  get size() {
    return this.parts.length
  }
  add(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, m: THREE.Matrix4, grow = 1.07): this {
    const g = prep(geo, true).applyMatrix4(m)
    C.set(color)
    const n = g.getAttribute('position').count
    const col = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) col.set([C.r, C.g, C.b], i * 3)
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    this.parts.push(g)
    if (grow > 0) {
      const o = prep(geo, false)
      o.scale(grow, grow, grow)
      o.applyMatrix4(m)
      this.inks.push(o)
    }
    return this
  }
  /** Contour encre déjà grossi et placé (pièce figée par `freeze`). */
  addInk(geo: THREE.BufferGeometry, m: THREE.Matrix4): this {
    this.inks.push(prep(geo, false).applyMatrix4(m))
    return this
  }
  /** `mat` : matériau à couleurs par sommet (ctx.toon blanc + vertexColors) ; `ink` : matériau du contour. */
  build(ctx: ThemeCtx, opts: { shadow?: boolean; mat?: THREE.Material; ink?: THREE.Material } = {}): THREE.Group {
    const g = new THREE.Group()
    if (!this.parts.length) return g
    const geo = ctx.track(mergeGeometries(this.parts)!)
    const mesh = new THREE.Mesh(geo, opts.mat ?? ctx.toon('#ffffff', { vertexColors: true }))
    mesh.castShadow = opts.shadow ?? true
    mesh.receiveShadow = true
    g.add(mesh)
    if (this.inks.length) {
      const ink = new THREE.Mesh(ctx.track(mergeGeometries(this.inks)!), opts.ink ?? ctx.inkBack)
      g.add(ink)
    }
    for (const p of [...this.parts, ...this.inks]) p.dispose()
    this.parts = []
    this.inks = []
    return g
  }
}

/** Maillage instancié + contour encre instancié (mêmes matrices). 2 appels de dessin. */
export function instInked(ctx: ThemeCtx, geo: THREE.BufferGeometry, mat: THREE.Material, n: number, grow = 1.08) {
  const mesh = new THREE.InstancedMesh(geo, mat, n)
  mesh.castShadow = true
  let ink: THREE.InstancedMesh | null = null
  if (grow > 0) {
    const og = ctx.track(geo.clone())
    og.scale(grow, grow, grow)
    ink = new THREE.InstancedMesh(og, ctx.inkBack, n)
  }
  const group = new THREE.Group()
  group.add(mesh)
  if (ink) group.add(ink)
  return {
    group,
    mesh,
    set(i: number, m: THREE.Matrix4) {
      mesh.setMatrixAt(i, m)
      ink?.setMatrixAt(i, m)
    },
    color(i: number, c: THREE.ColorRepresentation) {
      mesh.setColorAt(i, C.set(c))
    },
    dirty() {
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      if (ink) ink.instanceMatrix.needsUpdate = true
    },
  }
}

/** Matériau « fantôme » des aperçus de quartier fermé (pâle, translucide). */
export function ghostMat(ctx: ThemeCtx, color: string, opacity = 0.35) {
  return ctx.toon(color, { transparent: true, opacity, depthWrite: false })
}

/** Panneau (sprite toujours lisible) au-dessus d'un point. */
export function plate(ctx: ThemeCtx, text: string, bg: string, at: THREE.Vector3, h = 0.5, depthTest = false) {
  const p = makePlate(text, bg)
  const s = ctx.sprite(ctx.track(p.tex), { depthTest })
  s.scale.set(h * p.aspect, h, 1)
  s.position.copy(at)
  s.renderOrder = 5
  ctx.scene.add(s)
  return s
}

/** Remplace le dessus du socle d'un quartier par un matériau propre (le socle de PartyScene partage celui du tapis). */
export function recolorSocle(ctx: ThemeCtx, id: string, mat: THREE.Material): THREE.Group | null {
  const g = ctx.socle(id)
  const top = g?.children[1] as THREE.Mesh | undefined
  if (top) top.material = mat
  return g
}

/** Quartier → centre monde de sa boîte (bornes comprises). */
export function boxCenter(ctx: ThemeCtx, box: { c0: number; r0: number; c1: number; r1: number }, y = 0) {
  return ctx.grid((box.c0 + box.c1) / 2, (box.r0 + box.r1) / 2, y)
}

/** Quartier (ouvert) qui contient une case, sinon null. */
export function quarterOf(ctx: ThemeCtx, cell: number) {
  return ctx.board.quarters.find((q) => q.cells.includes(cell)) ?? null
}

/** Dalle horizontale à coins arrondis (socle d'île, plaque…) : dessus à y = 0, épaisseur h vers le bas. */
export function slabGeo(w: number, d: number, r: number, h: number): THREE.BufferGeometry {
  const s = new THREE.Shape()
  const x = -w / 2
  const y = -d / 2
  const k = Math.min(r, w / 2 - 0.01, d / 2 - 0.01)
  s.moveTo(x + k, y)
  s.lineTo(x + w - k, y)
  s.quadraticCurveTo(x + w, y, x + w, y + k)
  s.lineTo(x + w, y + d - k)
  s.quadraticCurveTo(x + w, y + d, x + w - k, y + d)
  s.lineTo(x + k, y + d)
  s.quadraticCurveTo(x, y + d, x, y + d - k)
  s.lineTo(x, y + k)
  s.quadraticCurveTo(x, y, x + k, y)
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 4 })
  g.rotateX(-Math.PI / 2)
  g.translate(0, -h, 0)
  return g
}

/**
 * Fige un décor fixe déjà construit (maillages toon opaques + leurs contours encre) en un Batch : même rendu, 2 ou 3
 * appels de dessin au lieu d'un par maillage. Ce qui ne se fusionne pas (transparent, texturé, émissif, double face,
 * sprites, instanciés) est gardé tel quel, à sa place. Renvoie le groupe à ajouter à la scène.
 */
export function freeze(ctx: ThemeCtx, root: THREE.Object3D, skip: THREE.Material[] = []): THREE.Group {
  root.updateMatrixWorld(true)
  const col = new Batch()
  const basic = new Batch()
  const keep: THREE.Object3D[] = []
  const frozen = new Set<THREE.Object3D>()
  root.traverse((o) => {
    if (o === root) return
    const m = o as THREE.Mesh
    if (!m.isMesh) {
      if ((o as THREE.Sprite).isSprite || (o as THREE.Points).isPoints || (o as THREE.Line).isLine) keep.push(o)
      return
    }
    const mat = m.material
    if ((m as THREE.InstancedMesh).isInstancedMesh || Array.isArray(mat) || skip.includes(mat)) return void keep.push(m)
    if (mat === ctx.inkBack) {
      col.addInk(m.geometry, m.matrixWorld)
      frozen.add(m)
    } else if (mat === ctx.inkFront) {
      basic.add(m.geometry, '#1f1b2e', m.matrixWorld, 0)
      frozen.add(m)
    } else {
      const t = mat as THREE.MeshToonMaterial
      if (t.isMeshToonMaterial && !t.transparent && !t.map && t.side === THREE.FrontSide && t.emissive.getHex() === 0) {
        col.add(m.geometry, t.color, m.matrixWorld, 0)
        frozen.add(m)
      } else keep.push(m)
    }
  })
  const out = new THREE.Group()
  if (col.size) out.add(col.build(ctx))
  if (basic.size) out.add(basic.build(ctx, { mat: ctx.track(new THREE.MeshBasicMaterial({ vertexColors: true })) }))
  // Ce qui reste garde sa place dans le monde (attach conserve la transformation).
  ctx.scene.add(out)
  for (const o of keep) {
    if (keep.some((p) => p !== o && isAncestor(p, o))) continue
    out.attach(o)
  }
  ctx.scene.remove(out)
  // Un objet gardé ne doit plus porter les pièces figées (elles sont déjà dans le Batch).
  for (const o of keep) {
    const gone: THREE.Object3D[] = []
    o.traverse((x) => frozen.has(x) && gone.push(x))
    for (const x of gone) x.parent?.remove(x)
  }
  return out
}

function isAncestor(a: THREE.Object3D, b: THREE.Object3D) {
  for (let p = b.parent; p; p = p.parent) if (p === a) return true
  return false
}

/** Comme `freeze`, mais dans le repère d'un groupe animé (qui tourne, flotte…) : ses enfants fixes deviennent un Batch. */
export function freezeLocal(ctx: ThemeCtx, group: THREE.Object3D, skip: THREE.Material[] = []) {
  const parent = group.parent
  parent?.remove(group)
  const p = group.position.clone()
  const q = group.quaternion.clone()
  const s = group.scale.clone()
  group.position.set(0, 0, 0)
  group.quaternion.identity()
  group.scale.set(1, 1, 1)
  const out = freeze(ctx, group, skip)
  group.clear()
  group.add(...out.children)
  group.position.copy(p)
  group.quaternion.copy(q)
  group.scale.copy(s)
  parent?.add(group)
}
