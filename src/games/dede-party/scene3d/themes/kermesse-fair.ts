/**
 * 🎪 La Grande Kermesse (M) : le Train Fantôme (manoir violet de guingois, rails ovales et petit train, fantômes-draps
 * qui surgissent « Bouh ! »), le Grand Huit (rail sur pylônes qui ondule, un looping, train de 4 wagons bras levés)
 * et les guichets 🎟️ des cases 55 et 85, qui affichent la même cagnotte que le stand central.
 * Fermés (taille S) : le manoir et le rail, pâles, sous des bâches gris-bleu (la palissade est posée par PartyScene).
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { STAND } from '../../boards/kermesse'
import type { DpEvent } from '../../types'
import { makePlate } from '../textures'
import { Batch, instInked, rnd, tr } from './kit'
import type { ThemeCtx } from './types'

const LANDING = new Set<DpEvent['t']>(['clap', 'pub', 'card', 'star', 'star_poor'])

/** Tracé du Grand Huit (coordonnées de grille + hauteur) : bosses sur la ligne du fond, looping sur celle de devant. */
function coasterPoints(ctx: ThemeCtx) {
  const pts: THREE.Vector3[] = []
  const ups: THREE.Vector3[] = []
  const UP = new THREE.Vector3(0, 1, 0)
  const push = (c: number, r: number, y: number, dz = 0, up = UP) => {
    pts.push(ctx.grid(c, r, y).add(new THREE.Vector3(0, 0, dz)))
    ups.push(up.clone())
  }
  const base = 0.95
  // Le fond : de la colonne 5 à 11, trois bosses.
  for (let i = 0; i < 36; i++) {
    const f = i / 36
    push(5 + 6 * f, 9.35, base + 1.0 * Math.sin(Math.PI * 3 * f) ** 2)
  }
  // Le virage de droite.
  for (let i = 0; i < 8; i++) {
    const a = -Math.PI / 2 + (i / 8) * Math.PI
    push(11 + Math.cos(a) * 0.65, 10 + Math.sin(a) * 0.65, base)
  }
  // Devant : de 11 à 8, le looping, puis de 8 à 5.
  for (let i = 0; i < 10; i++) push(11 - 3 * (i / 10), 10.65, base)
  const R = 0.75
  const loopC = ctx.grid(8, 10.65, base + R)
  for (let i = 0; i < 20; i++) {
    const th = (i / 20) * Math.PI * 2
    const dz = (i / 20) * 0.3
    const p = ctx.grid(8 - (R * Math.sin(th)) / ctx.S, 10.65, base + R * (1 - Math.cos(th)))
    pts.push(p.add(new THREE.Vector3(0, 0, dz)))
    ups.push(loopC.clone().add(new THREE.Vector3(0, 0, dz)).sub(p).normalize())
  }
  for (let i = 0; i < 10; i++) push(8 - 3 * (i / 10), 10.65, base, 0.3 * (1 - i / 10))
  // Le virage de gauche.
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 2 + (i / 8) * Math.PI
    push(5 + Math.cos(a) * 0.65, 10 + Math.sin(a) * 0.65, base)
  }
  return { pts, ups, loopStart: 36 + 8 + 10, loopEnd: 36 + 8 + 10 + 20 }
}

export function buildFair(ctx: ThemeCtx) {
  const ft = ctx.board.quarters.find((q) => q.id === 'fantome')
  const gh = ctx.board.quarters.find((q) => q.id === 'huit')
  if (!ft && !gh) return null
  const { scene } = ctx
  const at = (c: number, r: number, y = 0) => ctx.grid(c, r, y)
  const box = (w: number, h: number, d: number) => ctx.track(new THREE.BoxGeometry(w, h, d))
  const cyl = (rt: number, rb: number, h: number, n = 7) => ctx.track(new THREE.CylinderGeometry(rt, rb, h, n))
  const updates: Array<(t: number, dt: number) => void> = []
  const ghostPos: THREE.Vector3[] = []
  const ghostPop: number[] = []
  let lastBouh = -10

  if (ft) {
    const rep = new Batch()
    const det = new Batch()
    // Le manoir violet de guingois : boîte penchée, toit tordu, cheminée de travers, fenêtres jaunes, bouche.
    const m = at(-5.5, 2.5)
    rep.add(box(3.3, 2.0, 2.4), '#6A4C93', tr(m.clone().setY(1.0), 0, 0.08, 0.05))
    rep.add(ctx.track(new THREE.ConeGeometry(2.5, 1.5, 4)), '#3D2C5E', tr(m.clone().add(new THREE.Vector3(0.15, 2.65, 0)), 0.08, Math.PI / 4 + 0.35, -0.12, 1, 1, 0.8))
    rep.add(box(0.3, 0.9, 0.3), '#3D2C5E', tr(m.clone().add(new THREE.Vector3(-0.9, 2.9, -0.3)), 0, 0, 0.25))
    for (const [x, y] of [[-1.0, 1.45], [0.95, 1.5], [-1.05, 0.7], [1.0, 0.75]] as const)
      det.add(box(0.42, 0.42, 0.04), '#FFD166', tr(m.clone().add(new THREE.Vector3(x, y, 1.22)), 0, 0.08, 0.05 + x * 0.04), 0)
    // L'entrée en forme de bouche (et ses dents).
    det.add(ctx.track(new THREE.CircleGeometry(0.62, 10)), '#1f1b2e', tr(m.clone().add(new THREE.Vector3(0, 0.62, 1.23)), 0, 0.08, 0, 1, 0.75, 1), 0)
    const tooth = ctx.track(new THREE.ConeGeometry(0.08, 0.18, 3))
    for (let k = 0; k < 5; k++) det.add(tooth, '#ffffff', tr(m.clone().add(new THREE.Vector3(-0.36 + k * 0.18, 0.98, 1.27)), Math.PI, 0.08, 0), 0)
    // Les rails ovales (deux rails, des traverses) autour du manoir.
    const oc = at(-5.5, 3.2)
    const RX = 2.2 * ctx.S
    const RZ = 2.5 * ctx.S
    const railGeo = new THREE.TorusGeometry(1, 0.03, 4, 56)
    railGeo.rotateX(Math.PI / 2)
    for (const k of [-0.13, 0.13]) {
      const g = railGeo.clone()
      g.scale(RX + k, 1, RZ + k)
      det.add(g, '#9aa0a6', tr(oc.clone().setY(0.06)), 0)
      g.dispose()
    }
    railGeo.dispose()
    const tie = box(0.38, 0.04, 0.08)
    for (let k = 0; k < 30; k++) {
      const a = (k / 30) * Math.PI * 2
      det.add(tie, '#6B4430', tr(oc.clone().add(new THREE.Vector3(Math.cos(a) * RX, 0.03, Math.sin(a) * RZ)), 0, -a, 0), 0)
    }
    // Panneaux derrière lesquels surgissent les fantômes.
    const spots: Array<[number, number]> = [[-6.8, 4.4], [-5.5, 4.75], [-4.2, 4.4], [-8.0, 0.2], [-3.0, 6.4]]
    spots.forEach(([c, r], i) => {
      const p = at(c, r)
      ghostPos.push(p.clone())
      ghostPop.push(-10)
      rep.add(box(0.6, 0.55, 0.08), i % 2 ? '#8D5A3B' : '#6c757d', tr(p.clone().add(new THREE.Vector3(0, 0.27, 0.3)), 0, 0, (rnd(i, 7) - 0.5) * 0.3))
    })
    // Lampions orange.
    const lamp = ctx.track(new THREE.SphereGeometry(0.11, 6, 5))
    const lamps = new THREE.InstancedMesh(lamp, ctx.track(new THREE.MeshBasicMaterial({ color: '#FF8C42' })), 8)
    const lm = new THREE.Matrix4()
    for (let k = 0; k < 8; k++) {
      const p = at(-8 + k * 0.72, 6.35, 1.25 + Math.sin(k * 0.9) * 0.08)
      lamps.setMatrixAt(k, lm.makeTranslation(p))
      if (k % 2 === 0) rep.add(cyl(0.03, 0.03, 1.25, 5), '#2b2545', tr(p.clone().setY(0.62)), 0)
    }
    scene.add(lamps)
    ctx.detail(lamps, at(-5, 6))
    // Les fantômes-draps (corps + yeux, instanciés) qui montent et descendent.
    const sheet = mergeGeometries([new THREE.ConeGeometry(0.26, 0.6, 8, 1, true).translate(0, 0.3, 0).toNonIndexed(), new THREE.SphereGeometry(0.2, 8, 6).translate(0, 0.58, 0).toNonIndexed()])!
    const ghosts = instInked(ctx, ctx.track(sheet), ctx.toon('#ffffff', { side: THREE.DoubleSide }), spots.length, 1.08)
    const eyesGeo = mergeGeometries([new THREE.SphereGeometry(0.045, 5, 4).translate(-0.08, 0.62, 0.17), new THREE.SphereGeometry(0.045, 5, 4).translate(0.08, 0.62, 0.17)])!
    const eyes = new THREE.InstancedMesh(ctx.track(eyesGeo), ctx.inkFront, spots.length)
    scene.add(ghosts.group, eyes)
    ctx.detail(ghosts.group, at(-5.5, 3))
    ctx.detail(eyes, at(-5.5, 3))
    // Le petit train de 3 wagons qui fait le tour du manoir.
    const wagons = instInked(ctx, box(0.36, 0.26, 0.6), ctx.toon('#ffffff'), 3, 1.1)
    ;['#8B5CF6', '#FF8C42', '#06D6A0'].forEach((c, i) => wagons.color(i, c))
    scene.add(wagons.group)
    const gm = new THREE.Matrix4()
    const gp = new THREE.Vector3()
    updates.push((t) => {
      spots.forEach((_, i) => {
        const pop = t - ghostPop[i]
        let y = 0.1 + Math.max(0, Math.sin(t * 1.1 + i * 1.7)) * 0.55
        if (pop >= 0 && pop < 1.2) y = Math.max(y, Math.sin((pop / 1.2) * Math.PI) * 1.3)
        gp.copy(ghostPos[i]).setY(y)
        tr(gp, 0, Math.sin(t * 0.8 + i) * 0.4, Math.sin(t * 2 + i) * 0.08, 1, 1, 1, gm)
        ghosts.set(i, gm)
        eyes.setMatrixAt(i, gm)
      })
      ghosts.dirty()
      eyes.instanceMatrix.needsUpdate = true
      for (let i = 0; i < 3; i++) {
        const a = t * 0.45 - i * 0.24
        gp.set(oc.x + Math.cos(a) * RX, 0.2, oc.z + Math.sin(a) * RZ)
        const yaw = Math.atan2(-Math.sin(a) * RX, Math.cos(a) * RZ)
        tr(gp, 0, yaw, Math.sin(t * 9 + i) * 0.03, 1, 1, 1, gm)
        wagons.set(i, gm)
      }
      wagons.dirty()
    })
    const r = rep.build(ctx)
    const d = det.build(ctx, { shadow: false })
    scene.add(r, d)
    ctx.detail(d, at(-5.5, 3))
  }

  if (gh) {
    const { pts, ups, loopStart, loopEnd } = coasterPoints(ctx)
    const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal')
    const rail = new THREE.Mesh(ctx.track(new THREE.TubeGeometry(curve, 200, 0.06, 4, true)), ctx.toon('#EF476F'))
    rail.castShadow = true
    const railInk = new THREE.Mesh(ctx.track(new THREE.TubeGeometry(curve, 200, 0.095, 4, true)), ctx.inkBack)
    scene.add(rail, railInk)
    // Pylônes (instanciés) sous le rail, hors du looping.
    const pyl = ctx.track(new THREE.CylinderGeometry(0.04, 0.06, 1, 5))
    pyl.translate(0, 0.5, 0)
    const legs: THREE.Vector3[] = []
    pts.forEach((p, i) => {
      if (i % 4 === 0 && (i < loopStart - 1 || i > loopEnd)) legs.push(p)
    })
    const pylons = new THREE.InstancedMesh(pyl, ctx.toon('#FFD166'), legs.length)
    const pm = new THREE.Matrix4()
    legs.forEach((p, i) => pylons.setMatrixAt(i, pm.compose(new THREE.Vector3(p.x, 0, p.z), new THREE.Quaternion(), new THREE.Vector3(1, p.y, 1))))
    pylons.castShadow = true
    scene.add(pylons)
    // Le train : 4 wagons, des passagers bras levés.
    const wagons = instInked(ctx, box(0.36, 0.22, 0.5), ctx.toon('#ffffff'), 4, 1.1)
    ;['#4CC9F0', '#FFD166', '#06D6A0', '#FF8FA3'].forEach((c, i) => wagons.color(i, c))
    const rider = mergeGeometries([
      new THREE.SphereGeometry(0.1, 6, 5).translate(0, 0.25, 0).toNonIndexed(),
      new THREE.CylinderGeometry(0.025, 0.025, 0.26, 4).rotateZ(0.4).translate(-0.12, 0.38, 0).toNonIndexed(),
      new THREE.CylinderGeometry(0.025, 0.025, 0.26, 4).rotateZ(-0.4).translate(0.12, 0.38, 0).toNonIndexed(),
    ])!
    const riders = new THREE.InstancedMesh(ctx.track(rider), ctx.toon('#FFD9B3'), 4)
    for (const m of [wagons.mesh, riders]) m.frustumCulled = false
    scene.add(wagons.group, riders)
    // Paramétrage à l'abscisse curviligne (avec le « haut » de chaque point, retourné dans le looping).
    const L = curve.getLength()
    const n = pts.length
    let u = 0
    let aaah = -10
    const P = new THREE.Vector3()
    const T = new THREE.Vector3()
    const X = new THREE.Vector3()
    const Y = new THREE.Vector3()
    const wm = new THREE.Matrix4()
    const one = new THREE.Vector3(1, 1, 1)
    const Q = new THREE.Quaternion()
    const upAt = (v: number) => ups[Math.floor((((curve.getUtoTmapping(v, 0) * n) % n) + n) % n)]
    updates.push((t, dt) => {
      curve.getPointAt(u, P)
      // Il ralentit en haut des bosses, file en bas.
      const v = Math.min(5, Math.max(1.4, 4.6 - 1.7 * (P.y - 0.95)))
      // (dt peut être négatif à la première image : on ne recule jamais.)
      u = (u + (v * Math.max(0, dt)) / L) % 1
      for (let i = 0; i < 4; i++) {
        const w = (((u - (i * 0.62) / L) % 1) + 1) % 1
        curve.getPointAt(w, P)
        curve.getTangentAt(w, T)
        const up = upAt(w)
        X.crossVectors(up, T).normalize()
        Y.crossVectors(T, X).normalize()
        wm.makeBasis(X, Y, T)
        Q.setFromRotationMatrix(wm)
        wm.compose(P.clone().addScaledVector(Y, 0.16), Q, one)
        wagons.set(i, wm)
        riders.setMatrixAt(i, wm)
      }
      wagons.dirty()
      riders.instanceMatrix.needsUpdate = true
      // Télé : « Aaaah ! » au looping.
      const k = Math.floor(curve.getUtoTmapping(u, 0) * n)
      if (ctx.tv && k === loopStart && t - aaah > 3) {
        aaah = t
        ctx.label('😱 Aaaah !', '#FFD1E0', ctx.grid(8, 10.65, 2.9))
      }
    })
  }

  // Les guichets 🎟️ (cases 55 et 85) : une guérite et la même plaque de cagnotte que le stand central.
  const booths: THREE.Vector3[] = []
  if (ft) booths.push(at(-10.15, 4))
  if (gh) booths.push(at(7, 13.15))
  const bb = new Batch()
  for (const p of booths) {
    bb.add(box(0.7, 0.55, 0.55), '#FF8C42', tr(p.clone().setY(0.28)))
    for (const x of [-0.2, 0.2]) bb.add(box(0.12, 0.56, 0.57), '#ffffff', tr(p.clone().add(new THREE.Vector3(x, 0.28, 0))), 0)
    bb.add(box(0.85, 0.06, 0.5), '#ffffff', tr(p.clone().add(new THREE.Vector3(0, 0.75, 0.1)), 0.35, 0, 0))
  }
  scene.add(bb.build(ctx))
  const potMat = ctx.track(new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false }))
  const plates = booths.map((p) => {
    const s = new THREE.Sprite(potMat)
    s.renderOrder = 6
    s.position.copy(p).setY(1.3)
    scene.add(s)
    return s
  })
  let aspect = 2
  let bump = 0
  const stand = at(STAND.col, STAND.row, 0.9)
  return {
    /** La cagnotte a changé : même plaque aux guichets qu'au stand central. */
    pot(n: number, bumped: boolean) {
      const { tex, aspect: a } = makePlate(`🎟️ ${n}`, '#FF8C42')
      potMat.map?.dispose()
      potMat.map = tex
      potMat.needsUpdate = true
      aspect = a
      if (bumped) bump = 1
    },
    update(t: number, dt: number) {
      bump = Math.max(0, bump - dt * 3)
      const h = 0.5 * (1 + 0.35 * Math.sin(bump * Math.PI))
      for (const s of plates) {
        s.scale.set(h * aspect, h, 1)
        s.position.y = 1.3 + Math.sin(t * 2) * 0.04
      }
      for (const f of updates) f(t, dt)
    },
    /** Guichet le plus proche d'un point s'il est plus près que le stand central (où vont les pièces). */
    nearest(p: THREE.Vector3): THREE.Vector3 | null {
      let best: THREE.Vector3 | null = null
      let d = p.distanceTo(stand)
      for (const b of booths) {
        const k = p.distanceTo(b)
        if (k < d) {
          d = k
          best = b.clone().setY(0.9)
        }
      }
      return best
    },
    /** Un pion s'arrête au Train Fantôme : le fantôme le plus proche fait « Bouh ! ». */
    onEvent(e: DpEvent, pawnId: string, order: number) {
      if (!ft || !LANDING.has(e.t)) return
      const head = ctx.pawnHead(pawnId)
      if (!head) return
      const c = (head.x + ctx.halfX) / ctx.S
      const r = (head.z + ctx.halfZ) / ctx.S
      const { c0, r0, c1, r1 } = ft.box
      if (c < c0 - 0.5 || c > c1 + 0.5 || r < r0 - 0.5 || r > r1 + 0.5) return
      const t = ctx.time()
      if (t - lastBouh < 1.5) return
      lastBouh = t
      let k = 0
      ghostPos.forEach((g, i) => {
        if (g.distanceTo(head) < ghostPos[k].distanceTo(head)) k = i
      })
      ghostPop[k] = t
      ctx.label('👻 Bouh !', '#E3D0FF', ghostPos[k].clone().setY(1.6), order + 1)
    },
  }
}

/** Attractions fermées (taille S) : le manoir et le rail, pâles, sous des bâches gris-bleu. */
export function buildClosedFair(ctx: ThemeCtx) {
  const b = new Batch()
  const geos: THREE.BufferGeometry[] = []
  const g = <T extends THREE.BufferGeometry>(x: T) => {
    geos.push(x)
    return x
  }
  for (const q of ctx.board.closed) {
    if (q.id === 'fantome') {
      const m = ctx.grid(-5.5, 2.5)
      b.add(g(new THREE.BoxGeometry(3.3, 2.0, 2.4)), '#9aa7bd', tr(m.clone().setY(1.0), 0, 0.08, 0.05), 0)
      b.add(g(new THREE.ConeGeometry(2.5, 1.5, 4)), '#7d8fa8', tr(m.clone().setY(2.65), 0.08, Math.PI / 4 + 0.35, -0.12, 1, 1, 0.8), 0)
    } else if (q.id === 'huit') {
      const pts = [0, 1, 2, 3, 4, 5, 6].map((i) => ctx.grid(5 + i, 9.6 + (i % 2) * 0.4, 0.9 + Math.sin(i * 1.3) ** 2))
      b.add(g(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.07, 4)), '#9aa7bd', new THREE.Matrix4(), 0)
      for (const i of [0, 3, 6]) b.add(g(new THREE.CylinderGeometry(0.05, 0.07, pts[i].y, 5)), '#9aa7bd', tr(pts[i].clone().setY(pts[i].y / 2)), 0)
    }
  }
  if (!b.size) return
  ctx.scene.add(b.build(ctx, { shadow: false, mat: ctx.toon('#ffffff', { vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false }) }))
  geos.forEach((x) => x.dispose())
}
