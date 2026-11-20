/**
 * ⛷️ Dédé 2000 : télésièges (pylônes, câble, nacelle qui fait la navette), traînées de verglas, tremplin
 * de la Grande Luge, chalet de la Station, sapins enneigés (instanciés), bonhomme de neige, montagnes sur
 * la toile de fond, flocons. Le ruban est teinté par zone (Vallée, Pistes, Sommet) par PartyScene.
 * Derrière la Station se dresse la grande montagne (Dédé 2500 / 3000) : une surface de neige en terrasses, ses
 * secteurs (Combe aux Chamois, Alpages, Glacier, Crête des Aigles), le Pic — et des skieurs pendant toute la
 * partie (même en taille S, où la montagne est fermée mais visible).
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { PIC, skiTerrain as snowH } from '../../boards/ski-relief'
import { makePlate } from '../textures'
import { Batch, freeze, instInked, rnd, tr } from './kit'
import type { ThemeCtx, ThemeDef } from './types'

const rand = (i: number) => {
  const x = Math.sin(i * 53.3 + 7.1) * 43758.5453
  return x - Math.floor(x)
}
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
/** Inclinaison (autour de x) d'un objet posé sur la pente de la neige en (colonne, ligne). */
const tiltAt = (S: number, c: number, r: number) => -Math.atan((snowH(c, r + 0.15) - snowH(c, r - 0.15)) / (0.3 * S))

const JACKETS = ['#EF476F', '#FFD166', '#06D6A0', '#4CC9F0', '#8B5CF6', '#FF8FA3', '#FF8C42']

export const skiTheme: ThemeDef = {
  palette: {
    light: { bg: '#E6F4FF', floorA: '#FFFFFF', floorB: '#EAF4FB', carpet: '#F4FAFF', carpetDot: '#DCEBF7', road: '#FFFFFF', sky: '#ffffff', ground: '#eaf4fb', hemi: 1.2, sun: 1.45, beam: 0.08, curtain: '#BFD9F2' },
    dark: { bg: '#0E1B3D', floorA: '#27406B', floorB: '#2F4C7D', carpet: '#34558C', carpetDot: '#4168A6', road: '#FFFFFF', sky: '#b9c8ff', ground: '#27406b', hemi: 0.95, sun: 1.2, beam: 0.34, curtain: '#182B57' },
  },
  stageColors: ['#FFFFFF', '#DFF3FF', '#BFE3FF'],
  bulbs: ['#BFE3FF', '#ffffff', '#EF476F'],
  build(ctx) {
    const { scene, board, S } = ctx
    const big = board.size !== 's'
    const white = ctx.toon('#ffffff')
    // Décor fixe : figé en un seul maillage à la fin (même rendu, quelques appels de dessin).
    const stat = new THREE.Group()

    // --- Télésièges : deux pylônes de part et d'autre, câble à 1,6, nacelle qui fait la navette.
    // --- Verglas : traînée bleu clair translucide de la case à son arrivée.
    const lifts: Array<{ a: THREE.Vector3; b: THREE.Vector3; cab: THREE.Group | null; yaw: number; ph: number }> = []
    const entries = Object.entries(board.tp ?? {}).map(([from, v]) => [Number(from), v.to] as const)
    const liftList = entries.filter(([f]) => board.cells[f] === 'lift')
    const iceList = entries.filter(([f]) => board.cells[f] === 'ice')
    const pylonGeo = ctx.track(new THREE.CylinderGeometry(0.05, 0.08, 1.75, 6))
    pylonGeo.translate(0, 0.875, 0)
    const pylons = new THREE.InstancedMesh(pylonGeo, ctx.toon('#6C757D'), liftList.length * 2)
    pylons.castShadow = true
    const cableGeo = ctx.track(new THREE.BoxGeometry(1, 0.03, 0.03))
    const cableMat = ctx.inkFront
    const cabGeo = ctx.track(new THREE.BoxGeometry(0.3, 0.22, 0.24))
    const rodGeo = ctx.track(new THREE.CylinderGeometry(0.015, 0.015, 0.3, 4))
    const cabMat = ctx.toon('#EF476F')
    const m4 = new THREE.Matrix4()
    // Grande taille (26 télésièges en L) : câbles, nacelles et tiges instanciés (budget du téléphone).
    const n = liftList.length
    const cablesI = big ? new THREE.InstancedMesh(cableGeo, cableMat, Math.max(1, n)) : null
    const cabsI = big ? instInked(ctx, cabGeo, cabMat, Math.max(1, n), 1.1) : null
    const rodsI = big ? new THREE.InstancedMesh(rodGeo, ctx.inkFront, Math.max(1, n)) : null
    const X = new THREE.Vector3(1, 0, 0)
    const qd = new THREE.Quaternion()
    liftList.forEach(([from, to], k) => {
      const A = ctx.cellPos(from)
      const B = ctx.cellPos(to)
      const dir = B.clone().sub(A).setY(0).normalize()
      const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(S * 0.5)
      const a = A.clone().add(side)
      const b = B.clone().add(side)
      m4.makeTranslation(a.x, a.y, a.z)
      pylons.setMatrixAt(k * 2, m4)
      m4.makeTranslation(b.x, b.y, b.z)
      pylons.setMatrixAt(k * 2 + 1, m4)
      const yaw = -Math.atan2(b.z - a.z, b.x - a.x)
      if (cablesI) {
        const d3 = b.clone().sub(a)
        qd.setFromUnitVectors(X, d3.clone().normalize())
        m4.compose(a.clone().add(b).multiplyScalar(0.5).setY((a.y + b.y) / 2 + 1.7), qd, new THREE.Vector3(d3.length(), 1, 1))
        cablesI.setMatrixAt(k, m4)
        lifts.push({ a: a.setY(a.y + 1.7), b: b.setY(b.y + 1.7), cab: null, yaw, ph: k * 0.37 })
        return
      }
      const cable = new THREE.Mesh(cableGeo, cableMat)
      cable.position.set((a.x + b.x) / 2, 1.7, (a.z + b.z) / 2)
      cable.scale.x = a.distanceTo(b)
      cable.rotation.y = yaw
      const cab = new THREE.Group()
      const box = ctx.inked(cabGeo, cabMat, 1.1)
      box.position.y = -0.3
      const rod = new THREE.Mesh(rodGeo, ctx.inkFront)
      rod.position.y = -0.12
      cab.add(box, rod)
      cab.rotation.y = cable.rotation.y
      cab.traverse((o) => ((o as THREE.Mesh).castShadow = false))
      stat.add(cable)
      scene.add(cab)
      lifts.push({ a: a.setY(1.7), b: b.setY(1.7), cab, yaw, ph: k * 0.37 })
    })
    scene.add(pylons)
    if (cablesI && cabsI && rodsI) {
      cabsI.mesh.castShadow = false
      cabsI.mesh.frustumCulled = false
      rodsI.frustumCulled = false
      scene.add(cablesI, cabsI.group, rodsI)
    }
    const iceMat = ctx.track(new THREE.MeshBasicMaterial({ color: '#DFF3FF', transparent: true, opacity: 0.8, depthWrite: false }))
    const iceGeo = ctx.track(new THREE.PlaneGeometry(1, 0.55))
    iceGeo.rotateX(-Math.PI / 2)
    const iceParts: THREE.BufferGeometry[] = []
    for (const [from, to] of iceList) {
      const A = ctx.cellPos(from)
      const B = ctx.cellPos(to)
      const trail = new THREE.Mesh(iceGeo, iceMat)
      trail.position.set((A.x + B.x) / 2, 0.04, (A.z + B.z) / 2)
      trail.scale.x = A.distanceTo(B)
      trail.rotation.y = -Math.atan2(B.z - A.z, B.x - A.x)
      trail.renderOrder = 1
      if (!big) {
        scene.add(trail)
        continue
      }
      // Grande taille : la traînée épouse la neige entre les deux étages (bande subdivisée, posée sur le relief).
      const strip = new THREE.PlaneGeometry(1, 0.55, 12, 1)
      strip.rotateX(-Math.PI / 2)
      const sp = strip.getAttribute('position')
      const dirv = B.clone().sub(A).setY(0)
      const side = new THREE.Vector3(-dirv.z, 0, dirv.x).normalize()
      for (let v = 0; v < sp.count; v++) {
        const u = sp.getX(v) + 0.5
        const w = sp.getZ(v)
        const x = A.x + (B.x - A.x) * u + side.x * w
        const z = A.z + (B.z - A.z) * u + side.z * w
        const y = Math.max(A.y + (B.y - A.y) * u, snowH((x + ctx.halfX) / S, (z + ctx.halfZ) / S)) + 0.07
        sp.setXYZ(v, x, y, z)
      }
      iceParts.push(strip)
    }
    if (iceParts.length) {
      const ice = new THREE.Mesh(ctx.track(mergeGeometries(iceParts)!), iceMat)
      ice.renderOrder = 1
      scene.add(ice)
      iceParts.forEach((g) => g.dispose())
    }

    // --- La Grande Luge : tremplin et panneau près du Sommet (48).
    const top = board.jumps[0]?.[0] ?? board.cells.length - 1
    const tp = ctx.cellPos(top)
    const ramp = ctx.inked(ctx.track(new THREE.BoxGeometry(0.6, 0.08, 1.1)), ctx.toon('#8D5A3B'), 1.08)
    ramp.position.set(tp.x, 0.28, tp.z + S * 0.78)
    ramp.rotation.x = -0.4
    stat.add(ramp)
    const pl = makePlate('🛷 Grande Luge', '#ffffff')
    const plate = ctx.sprite(ctx.track(pl.tex), { depthTest: false })
    plate.scale.set(0.42 * pl.aspect, 0.42, 1)
    plate.position.set(tp.x, 1.35, tp.z + S * 1.05)
    plate.renderOrder = 5
    scene.add(plate)

    // --- Chalet de la Station, près du Départ.
    const chalet = new THREE.Group()
    chalet.position.copy(ctx.grid(-1.45, 7.5))
    const cBody = ctx.inked(ctx.track(new THREE.BoxGeometry(1.0, 0.75, 0.9)), ctx.toon('#8D5A3B'), 1.05)
    cBody.position.y = 0.38
    const cRoof = ctx.inked(ctx.track(new THREE.ConeGeometry(0.85, 0.6, 4)), white, 1.06)
    cRoof.position.y = 1.05
    cRoof.rotation.y = Math.PI / 4
    const win = new THREE.Mesh(ctx.track(new THREE.PlaneGeometry(0.3, 0.25)), ctx.toon('#FFD166', { emissive: '#FFD166', emissiveIntensity: 0.6 }))
    win.position.set(0, 0.42, 0.46)
    chalet.add(cBody, cRoof, win)
    stat.add(chalet)

    // --- Sapins enneigés (instanciés) : dans les couloirs entre les spires et autour ; en grande taille, aussi
    // au pied de la montagne et sur ses flancs (posés sur la neige).
    const spots: Array<[number, number]> = [
      [1, 1.5], [1, 3.6], [1, 5.8], [3, 1], [5.2, 1], [7.6, 1], [9, 2.6], [9, 4.6], [9, 6.6], [7.4, 7], [8.6, 6.1],
      [-1.3, 0.6], [-1.3, 3.2], [11.1, 7.6], [2.4, -1.3], [7.8, -1.3],
    ]
    if (big) {
      spots.push([-8, -0.9], [-6.2, -0.8], [-1.6, -0.9], [12, -0.9], [16.4, -0.8], [18.6, -1])
      // Forêt des flancs : dense au pied, de plus en plus rare en altitude (aucun sapin au-dessus de ~5 unités),
      // jamais sur une piste ni sous un téléski.
      const lanes = [-10.5, -12.3, 20.5, 22.3]
      const topRow = board.size === 'l' ? -13 : -7
      for (let i = 0; spots.length < (board.size === 'l' ? 90 : 64) && i < 900; i++) {
        const west = rand(i + 300) < 0.5
        const c = west ? -10 - rand(i + 301) * 9 : 20 + rand(i + 302) * 9
        const r = -0.9 + (topRow + 0.9) * rand(i + 303) ** 1.6
        if (lanes.some((x) => Math.abs(c - x) < 0.75)) continue
        const h = snowH(c, r)
        if (h > 5.5 || rand(i + 304) > 1.15 - h * 0.2) continue
        spots.push([c, r])
      }
    }
    const trunkGeo = ctx.track(new THREE.CylinderGeometry(0.07, 0.09, 0.4, 6))
    trunkGeo.translate(0, 0.2, 0)
    const fGeo = ctx.track(new THREE.ConeGeometry(0.42, 1.0, 8))
    fGeo.translate(0, 0.85, 0)
    const capGeo = ctx.track(new THREE.ConeGeometry(0.2, 0.36, 8))
    capGeo.translate(0, 1.2, 0)
    const trunks = new THREE.InstancedMesh(trunkGeo, ctx.toon('#8D5A3B'), spots.length)
    const firs = new THREE.InstancedMesh(fGeo, ctx.toon('#2D6A4F'), spots.length)
    const caps = new THREE.InstancedMesh(capGeo, white, spots.length)
    const pos = new THREE.Vector3()
    const q = new THREE.Quaternion()
    const scl = new THREE.Vector3()
    spots.forEach(([c, r], i) => {
      ctx.grid(c, r, big ? snowH(c, r) : 0, pos)
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand(i) * 6.28)
      const s = (0.8 + rand(i + 5) * 0.35) * (big ? 1 - Math.min(0.4, pos.y * 0.07) : 1)
      m4.compose(pos, q, scl.set(s, s, s))
      trunks.setMatrixAt(i, m4)
      firs.setMatrixAt(i, m4)
      caps.setMatrixAt(i, m4)
    })
    for (const m of [trunks, firs, caps]) m.castShadow = true
    scene.add(trunks, firs, caps)

    // --- Bonhomme de neige.
    const snowman = new THREE.Group()
    snowman.position.copy(ctx.grid(3.6, 6.8))
    const ballGeo = ctx.track(new THREE.SphereGeometry(1, 14, 10))
    for (const [y, r] of [[0.3, 0.32], [0.78, 0.23], [1.13, 0.16]] as const) {
      const b = ctx.inked(ballGeo, white, 1.06)
      b.scale.setScalar(r)
      b.position.y = y
      snowman.add(b)
    }
    const nose = new THREE.Mesh(ctx.track(new THREE.ConeGeometry(0.04, 0.2, 6)), ctx.toon('#FF8C42'))
    nose.rotation.x = Math.PI / 2
    nose.position.set(0, 1.13, 0.22)
    snowman.add(nose)
    stat.add(snowman)

    // --- Trois montagnes sur la toile de fond.
    const mGeo = ctx.track(new THREE.ConeGeometry(1, 1, 7))
    const mMat = ctx.toon('#8FA8C8')
    const peakGeo = ctx.track(new THREE.ConeGeometry(1, 1, 7))
    // Aplaties contre la toile (décor peint en relief), elles dépassent au-dessus des gradins.
    for (const [x, z, h, r, side] of [[-ctx.halfX + 0.5, ctx.zWall, 9, 3.6, false], [ctx.halfX * 0.55, ctx.zWall, 11, 4.4, false], [ctx.xWall, -ctx.halfZ * 0.3, 9.5, 3.6, true]] as const) {
      const flat = 0.2
      const m = new THREE.Mesh(mGeo, mMat)
      m.scale.set(side ? r * flat : r, h, side ? r : r * flat)
      m.position.set(side ? x - r * flat - 0.15 : x, h / 2 - 0.2, side ? z : z + r * flat + 0.15)
      const p = new THREE.Mesh(peakGeo, white)
      p.scale.set(m.scale.x * 0.36, h * 0.36, m.scale.z * 0.36 + 0.02)
      p.position.set(m.position.x + (side ? -0.02 : 0), h - 0.2 - (h * 0.36) / 2 + 0.02, m.position.z + (side ? 0 : 0.02))
      stat.add(m, p)
    }
    scene.add(freeze(ctx, stat))

    // --- Flocons lents (un seul nuage de points) ; en grande taille, sur toute l'emprise.
    const nFlake = big ? 150 : 90
    const fx = big ? (ctx.ext.maxX - ctx.ext.minX) / 2 + 5 : ctx.halfX + 5
    const fz = big ? (ctx.ext.maxZ - ctx.ext.minZ) / 2 + 5 : ctx.halfZ + 5
    const fcx = big ? (ctx.ext.maxX + ctx.ext.minX) / 2 : 0
    const fcz = big ? (ctx.ext.maxZ + ctx.ext.minZ) / 2 : 0
    const flakeTop = big ? 13 : 9
    const flakePos = new Float32Array(nFlake * 3)
    const speed: number[] = []
    for (let i = 0; i < nFlake; i++) {
      flakePos[i * 3] = fcx + (rand(i + 20) - 0.5) * 2 * fx
      flakePos[i * 3 + 1] = rand(i + 30) * flakeTop
      flakePos[i * 3 + 2] = fcz + (rand(i + 40) - 0.5) * 2 * fz
      speed.push(0.35 + rand(i + 50) * 0.4)
    }
    const flakeGeo = ctx.track(new THREE.BufferGeometry())
    flakeGeo.setAttribute('position', new THREE.BufferAttribute(flakePos, 3))
    const flakeMat = ctx.track(new THREE.PointsMaterial({ map: ctx.tex.glow, color: '#ffffff', size: 0.22, transparent: true, depthWrite: false, opacity: 0.9 }))
    const flakes = new THREE.Points(flakeGeo, flakeMat)
    flakes.frustumCulled = false
    scene.add(flakes)

    const mountain = buildMountain(ctx)
    const skiers = buildSkiers(ctx)

    const cm = new THREE.Matrix4()
    const cq = new THREE.Quaternion()
    const ce = new THREE.Euler()
    const cp = new THREE.Vector3()
    const one = new THREE.Vector3(1, 1, 1)
    const down = new THREE.Matrix4().makeTranslation(0, -0.3, 0)
    const rodDown = new THREE.Matrix4().makeTranslation(0, -0.12, 0)
    const tmpM = new THREE.Matrix4()
    return {
      update(_view, dt) {
        const t = ctx.time()
        lifts.forEach((l, i) => {
          // Navette : aller-retour en 5 s, petite pause à chaque bout.
          const u = (Math.sin((t * Math.PI * 2) / 5 + l.ph * 6) + 1) / 2
          const k = Math.min(1, Math.max(0, (u - 0.08) / 0.84))
          const sway = Math.sin(t * 3 + l.ph) * 0.06
          if (l.cab) {
            l.cab.position.lerpVectors(l.a, l.b, k)
            l.cab.rotation.z = sway
          } else if (cabsI && rodsI) {
            cp.lerpVectors(l.a, l.b, k)
            cm.compose(cp, cq.setFromEuler(ce.set(0, l.yaw, sway)), one)
            cabsI.set(i, tmpM.multiplyMatrices(cm, down))
            rodsI.setMatrixAt(i, tmpM.multiplyMatrices(cm, rodDown))
          }
        })
        if (cabsI && rodsI) {
          cabsI.dirty()
          rodsI.instanceMatrix.needsUpdate = true
        }
        for (let i = 0; i < nFlake; i++) {
          let y = flakePos[i * 3 + 1] - speed[i] * dt
          if (y < 0) y += flakeTop
          flakePos[i * 3 + 1] = y
          flakePos[i * 3] += Math.sin(t * 0.7 + i) * dt * 0.15
        }
        flakeGeo.attributes.position.needsUpdate = true
        mountain.update(t)
        skiers.update(t, dt)
      },
      applyTheme(dark) {
        flakeMat.opacity = dark ? 1 : 0.85
        flakeMat.color.set(dark ? '#ffffff' : '#cfe6ff')
        mountain.applyTheme(dark)
      },
    }
  },
}

/**
 * La grande montagne : la neige en terrasses (de la ligne −1 à −13 ; en S, seulement derrière la toile, de −5
 * à −13 : fermée mais visible), les secteurs ouverts (décor) et le Pic (L), des nuages sur les secteurs fermés.
 */
function buildMountain(ctx: ThemeCtx) {
  const { scene, board, S } = ctx
  const big = board.size !== 's'
  const updates: Array<(t: number) => void> = []
  const themed: Array<(d: boolean) => void> = []
  const at = (c: number, r: number, dy = 0) => ctx.grid(c, r, snowH(c, r) + dy)
  for (const q of board.quarters) {
    const g = ctx.socle(q.id)
    if (g) g.visible = false
  }

  // --- La neige : un plan subdivisé 60 × 30, hauteurs lissées, teinte bleutée dans les pentes.
  // Le massif : un seul maillage bas-poly (≈ 12 k triangles), de la ligne −0,4 au revers des sommets (ligne −21),
  // flancs compris ; neige blanche à plat, bleutée dans les pentes, roche grise dans les à-pics.
  const c0 = -20
  const c1 = 30
  const r0 = -21
  const r1 = big ? -0.4 : -5.2
  const a = ctx.grid(c0, r0)
  const b = ctx.grid(c1, r1)
  const segW = 84
  const segH = big ? 70 : 52
  const geo = ctx.track(new THREE.PlaneGeometry(b.x - a.x, b.z - a.z, segW, segH))
  geo.rotateX(-Math.PI / 2)
  geo.translate((a.x + b.x) / 2, 0, (a.z + b.z) / 2)
  const p = geo.getAttribute('position')
  const col = new Float32Array(p.count * 3)
  const snow = new THREE.Color('#ffffff')
  const blue = new THREE.Color('#A9C8EC')
  const stone = new THREE.Color('#7E8899')
  const cc = new THREE.Color()
  const e = 0.18
  for (let i = 0; i < p.count; i++) {
    const c = (p.getX(i) + ctx.halfX) / S
    const r = (p.getZ(i) + ctx.halfZ) / S
    const h = snowH(c, r)
    // Bords rabattus jusqu'au sol : pas de tranche visible.
    const ix = i % (segW + 1)
    const iy = Math.floor(i / (segW + 1))
    p.setY(i, ix === 0 || ix === segW || iy === 0 || iy === segH ? -0.2 : h - 0.03)
    const gx = (snowH(c + e, r) - snowH(c - e, r)) / (2 * e * S)
    const gz = (snowH(c, r + e) - snowH(c, r - e)) / (2 * e * S)
    const slope = Math.hypot(gx, gz)
    cc.copy(snow).lerp(blue, smooth(0.3, 0.9, slope))
    // Roche : à-pics hors des terrasses, bandes sombres sous les crêtes (pas sur les sommets, enneigés).
    const face = c > -9.8 && c < 19.8 && r > -12.6 ? 0.3 : 1
    const rock = smooth(1.2, 1.9, slope) * (1 - smooth(13, 16, h)) * (Math.sin(c * 2.3 + r * 1.1) * 0.25 + 0.85) * face
    cc.lerp(stone, Math.min(1, rock))
    col.set([cc.r, cc.g, cc.b], i * 3)
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
  geo.computeVertexNormals()
  const snowMat = ctx.toon('#ffffff', { vertexColors: true })
  themed.push((d) => snowMat.color.set(d ? '#9DB4DE' : '#ffffff'))
  const surface = new THREE.Mesh(geo, snowMat)
  surface.receiveShadow = true
  scene.add(surface)

  const has = (id: string) => board.quarters.some((q) => q.id === id)
  const rep = new Batch()
  const details: Array<{ b: Batch; at: THREE.Vector3 }> = []
  const detailOf = (c: number, r: number) => {
    const d = { b: new Batch(), at: at(c, r) }
    details.push(d)
    return d.b
  }
  const box = (w: number, h: number, d: number) => ctx.track(new THREE.BoxGeometry(w, h, d))
  const cyl = (rt: number, rb: number, h: number, n = 7) => ctx.track(new THREE.CylinderGeometry(rt, rb, h, n))
  const rock = ctx.track(new THREE.DodecahedronGeometry(0.5, 0))

  // 🐐 La Combe aux Chamois : un rocher et 4 chamois (boîtes + cornes).
  if (has('combe')) {
    const det = detailOf(-6, -3)
    const rk = at(-6.2, -3, 0.05)
    rep.add(rock, '#8d939a', tr(rk, 0.3, 0.5, 0, 1.6, 0.9, 1.2))
    rep.add(rock, '#a3a9b0', tr(at(-1.6, -3, 0.05), 0.2, 1.2, 0, 0.9, 0.6, 0.8))
    const body = box(0.42, 0.2, 0.18)
    const head = box(0.14, 0.15, 0.13)
    const leg = box(0.05, 0.22, 0.05)
    const horn = ctx.track(new THREE.ConeGeometry(0.025, 0.16, 4))
    ;([[-0.5, 0.42, 0.2, 0.3], [0.1, 0.55, -0.1, -0.6], [0.55, 0.35, 0.15, 2.6], [-0.15, 0.3, 0.45, 1.4]] as const).forEach(([dx, dy, dz, ry], i) => {
      const o = new THREE.Object3D()
      o.position.set(rk.x + dx, rk.y + dy, rk.z + dz)
      o.rotation.y = ry
      o.updateMatrix()
      const part = (g: THREE.BufferGeometry, color: string, x: number, y: number, z: number, rz = 0, grow = 1.1) =>
        det.add(g, color, new THREE.Matrix4().multiplyMatrices(o.matrix, tr(new THREE.Vector3(x, y, z), 0, 0, rz)), grow)
      const fur = i % 2 ? '#8D5A3B' : '#A47148'
      part(body, fur, 0, 0.24, 0)
      part(head, '#5b4030', 0.26, 0.36, 0)
      for (const [x, z] of [[-0.15, -0.06], [-0.15, 0.06], [0.15, -0.06], [0.15, 0.06]] as const) part(leg, '#4a3528', x, 0.1, z, 0, 0)
      for (const z of [-0.04, 0.04]) part(horn, '#2b2545', 0.27, 0.49, z, -0.3, 0)
    })
  }

  // 🐄 Les Alpages : chalet d'alpage, 5 vaches à cloche, barrière.
  if (has('alpages')) {
    const det = detailOf(15, -3)
    // Posé sur la pente : plancher au niveau du haut, soubassement de pierre jusqu'à la neige du bas.
    const fl = snowH(10.6, -3.4)
    const drop = fl - snowH(10.6, -2.6) + 0.1
    const ch = ctx.grid(10.6, -3, fl)
    rep.add(box(1.3, 0.75, 0.9), '#A47148', tr(ch.clone().setY(ch.y + 0.38)))
    rep.add(box(1.4, drop, 1.0), '#8d939a', tr(ch.clone().setY(ch.y - drop / 2)))
    rep.add(ctx.track(new THREE.ConeGeometry(1.05, 0.6, 4)), '#ffffff', tr(ch.clone().setY(ch.y + 1.05), 0, Math.PI / 4, 0, 1.15, 1, 0.85))
    det.add(box(0.28, 0.4, 0.02), '#5b4030', tr(ch.clone().add(new THREE.Vector3(0, 0.2, 0.46))), 0)
    det.add(box(0.24, 0.18, 0.02), '#FFD166', tr(ch.clone().add(new THREE.Vector3(0.4, 0.45, 0.46))), 0)
    const cowBody = box(0.42, 0.24, 0.22)
    const cowHead = box(0.14, 0.15, 0.15)
    const spot = box(0.16, 0.02, 0.12)
    const bell = ctx.track(new THREE.SphereGeometry(0.04, 5, 4))
    const leg = box(0.05, 0.18, 0.05)
    ;([15.2, 16.0, 16.9, 17.6, 18.4] as const).forEach((c, i) => {
      const o = new THREE.Object3D()
      const cr = -3 + (i % 2 ? 0.25 : -0.2)
      o.position.copy(at(c, cr))
      o.rotation.set(tiltAt(S, c, cr), rnd(i, 61) * 6, 0)
      o.updateMatrix()
      const part = (g: THREE.BufferGeometry, color: string, x: number, y: number, z: number, grow = 1.1) =>
        det.add(g, color, new THREE.Matrix4().multiplyMatrices(o.matrix, new THREE.Matrix4().makeTranslation(x, y, z)), grow)
      part(cowBody, '#ffffff', 0, 0.3, 0)
      part(cowHead, '#ffffff', 0.27, 0.38, 0)
      part(spot, '#2b2545', -0.05, 0.43, 0.03, 0)
      part(bell, '#FFD23F', 0.24, 0.24, 0, 0)
      for (const [x, z] of [[-0.15, -0.07], [-0.15, 0.07], [0.15, -0.07], [0.15, 0.07]] as const) part(leg, '#2b2545', x, 0.09, z, 0)
    })
    const post = cyl(0.04, 0.04, 0.5, 5)
    const rail = box(0.9, 0.04, 0.04)
    for (let k = 0; k < 5; k++) {
      const c = 14.6 + k * 0.95
      det.add(post, '#8D5A3B', tr(at(c, -3.55, 0.25)), 0)
      if (k < 4) for (const y of [0.18, 0.38]) det.add(rail, '#C68B59', tr(at(c + 0.47, -3.55, y)), 0)
    }
  }

  // 🧊 Le Glacier : plaques de glace bleue translucide, crevasses (boîtes sombres étroites).
  if (has('glacier')) {
    const det = detailOf(-3, -9)
    const plates: THREE.BufferGeometry[] = []
    ;([[-6.4, -7], [0.6, -7], [-1.6, -9], [-6.8, -9.1], [-5, -11], [1.2, -11]] as const).forEach(([c, r], i) => {
      const g = new THREE.CylinderGeometry(0.9, 1.0, 0.08, 7)
      g.applyMatrix4(tr(at(c, r, 0.02), tiltAt(S, c, r), rnd(i, 71) * 3, 0, 1.2 + rnd(i, 72) * 0.6, 1, 0.5))
      plates.push(g)
    })
    const iceMat = ctx.toon('#8FD3FF', { transparent: true, opacity: 0.72, emissive: '#3aa0ff', emissiveIntensity: 0.15 })
    const ice = new THREE.Mesh(ctx.track(mergeGeometries(plates.map((g) => g.toNonIndexed()))!), iceMat)
    plates.forEach((g) => g.dispose())
    ice.renderOrder = 1
    scene.add(ice)
    ;([[-4.6, -7.1, 0.4], [-0.6, -9, -0.3], [-7.4, -11, 0.2], [2.2, -9.1, 0.6]] as const).forEach(([c, r, ry]) => det.add(box(1.4, 0.06, 0.16), '#1d3557', tr(at(c, r, 0.01), tiltAt(S, c, r), ry, 0), 0))
  }

  // 🦅 La Crête des Aigles : rochers sombres, 3 aigles qui planent en cercle.
  if (has('aigles')) {
    ;([[8.6, -7], [16.2, -9], [10.8, -11], [17.4, -7.1], [12.2, -9.1], [15, -11]] as const).forEach(([c, r], i) =>
      rep.add(rock, i % 2 ? '#4a4e69' : '#5c6178', tr(at(c, r, 0.1), rnd(i, 81), rnd(i, 82) * 3, 0, 1.1 + rnd(i, 83) * 0.6, 0.8, 1)),
    )
    const wing = new Float32Array([0, 0, 0.12, -0.55, 0.12, 0, 0, 0, -0.12, 0, 0, 0.12, 0.55, 0.12, 0, 0, 0, -0.12])
    const eg = ctx.track(new THREE.BufferGeometry())
    eg.setAttribute('position', new THREE.BufferAttribute(wing, 3))
    eg.computeVertexNormals()
    const eagles = new THREE.InstancedMesh(eg, ctx.track(new THREE.MeshBasicMaterial({ color: '#5b4030', side: THREE.DoubleSide })), 3)
    eagles.frustumCulled = false
    scene.add(eagles)
    ctx.detail(eagles, at(12, -9))
    const hub = at(12.5, -9, 3.6)
    const em = new THREE.Matrix4()
    const ep = new THREE.Vector3()
    updates.push((t) => {
      for (let i = 0; i < 3; i++) {
        const ang = t * 0.35 + (i * Math.PI * 2) / 3
        const rad = 2.2 + i * 0.6
        ep.set(hub.x + Math.cos(ang) * rad, hub.y + i * 0.5 + Math.sin(t * 0.8 + i) * 0.2, hub.z + Math.sin(ang) * rad * 0.7)
        tr(ep, 0, -ang, 0.35 + Math.sin(t * 1.3 + i) * 0.08, 1, 1, 1, em)
        eagles.setMatrixAt(i, em)
      }
      eagles.instanceMatrix.needsUpdate = true
    })
  }

  // 🚩 Le Pic du Dédé (L), derrière la case 154 : cône blanc à arêtes bleutées, drapeau rouge.
  let flag: THREE.Mesh | null = null
  if (big) {
    // Le Pic (visible dès Dédé 2500, au-dessus des nuages) : cône enneigé à pied rocheux bleuté, drapeau rouge.
    const pk = at(PIC.c, PIC.r, -0.8)
    const H = PIC.h + 0.8
    const pic = ctx.track(new THREE.ConeGeometry(PIC.base, H, 6).toNonIndexed())
    pic.computeVertexNormals()
    rep.add(pic, '#ffffff', tr(pk.clone().setY(pk.y + H / 2), 0, 0.3, 0), 1.04)
    rep.add(ctx.track(new THREE.ConeGeometry(PIC.base * 1.01, H * 0.42, 6)), '#9FB8D6', tr(pk.clone().setY(pk.y + H * 0.21), 0, 0.3, 0), 0)
    rep.add(cyl(0.04, 0.04, 1.2, 5), '#2b2545', tr(pk.clone().setY(pk.y + H + 0.5)), 0)
    // Rochers : sur les flancs raides et au pied des sommets (fusionnés avec le reste du décor fixe).
    for (let i = 0, n = 0; n < (board.size === 'l' ? 34 : 22) && i < 600; i++) {
      const c = -19 + rand(i + 700) * 48
      const r = -1.5 - rand(i + 701) * (board.size === 'l' ? 18 : 15)
      const inFace = c > -9.9 && c < 19.9 && r > -12.7
      if (inFace) continue
      const h = snowH(c, r)
      if (h < 0.6) continue
      n++
      const s = 0.5 + rand(i + 702) * 0.9
      rep.add(rock, rand(i + 703) < 0.5 ? '#7E8899' : '#9AA3B0', tr(at(c, r, 0.05), rand(i + 704), rand(i + 705) * 3, 0, s * 1.3, s * 0.8, s))
    }
    pk.y += H + 1.08 - 4.32
    const tri = new THREE.Shape()
    tri.moveTo(0, 0)
    tri.lineTo(0.55, -0.16)
    tri.lineTo(0, -0.34)
    tri.closePath()
    flag = new THREE.Mesh(ctx.track(new THREE.ShapeGeometry(tri)), ctx.toon('#EF476F', { side: THREE.DoubleSide }))
    flag.position.copy(pk).setY(pk.y + 4.32)
    flag.scale.setScalar(1.7)
    scene.add(flag)
  }

  scene.add(rep.build(ctx))
  for (const d of details) {
    const g = d.b.build(ctx, { shadow: false })
    scene.add(g)
    ctx.detail(g, d.at)
  }

  // Secteurs fermés de la montagne : des nuages au-dessus de la neige (le voile de PartyScene est posé à hauteur
  // de sol, sous la pente).
  const clouds: Array<{ s: THREE.Sprite; base: THREE.Vector3; k: number }> = []
  for (const q of board.closed) {
    if (q.box.r0 > -5) continue
    const cx = (q.box.c0 + q.box.c1) / 2
    const cr = (q.box.r0 + q.box.r1) / 2
    for (let k = 0; k < 3; k++) {
      const s = ctx.sprite(ctx.tex.glow, { color: '#ffffff', opacity: 0.85, depthWrite: false })
      const w = (q.box.c1 - q.box.c0) * S * 0.7
      s.scale.set(w, w * 0.45, 1)
      const base = at(cx + (k - 1) * (q.box.c1 - q.box.c0) * 0.28, cr + (k - 1) * 1.2, 1.4 + k * 0.4)
      s.position.copy(base)
      scene.add(s)
      clouds.push({ s, base, k })
    }
  }
  updates.push((t) => {
    for (const c of clouds) {
      c.s.position.set(c.base.x + Math.sin(t * 0.15 + c.k * 2) * 1.2, c.base.y + Math.sin(t * 0.4 + c.k) * 0.15, c.base.z)
      c.s.material.opacity = 0.65 + 0.2 * Math.sin(t * 0.3 + c.k)
    }
    if (flag) flag.rotation.y = Math.sin(t * 3) * 0.35
  })

  return {
    update: (t: number) => updates.forEach((f) => f(t)),
    applyTheme: (d: boolean) => themed.forEach((f) => f(d)),
  }
}

interface Skier {
  piste: number
  s: number
  speed: number
  wait: number
  /** Sur le téléski (remontée), pas sur la piste. */
  up: boolean
  board: boolean
  faller: boolean
  fallAt: number
  ph: number
}

interface Line {
  v: THREE.Vector3[]
  lens: number[]
  len: number
}

/**
 * Les skieurs (décor permanent, spec §3.5) : corps (avec contour encre), tête + bonnet, skis — 4 maillages
 * instanciés ; sur des pistes en coordonnées de grille qui ne croisent aucune case, au ras du relief ; slalom,
 * sauts des pistes à bosses par-dessus les lacets. En grande taille, ceux des flancs remontent par deux téléskis
 * (câble et pylônes instanciés : 2 appels de plus).
 */
function buildSkiers(ctx: ThemeCtx) {
  const { scene, board, S } = ctx
  const size = board.size
  const bottom = size === 's' ? -5.2 : -1
  const top = (r: number) => (size === 'm' ? Math.max(r, -5) : r)
  const line = (pts: Array<[number, number]>): Line => {
    const v = pts.map(([c, r]) => ctx.grid(c, r))
    const lens = v.slice(1).map((p, i) => p.distanceTo(v[i]))
    return { v, lens, len: lens.reduce((x, y) => x + y, 0) }
  }
  // Pistes (du haut vers le bas) : le Grand Couloir, les flancs, les deux pistes à bosses.
  const raw: Array<{ pts: Array<[number, number]>; bumps: boolean; up?: Array<[number, number]> }> = [
    { pts: [[5, top(-11)], [5, bottom]], bumps: false },
    { pts: size === 'm' ? [[-10.5, -5], [-10.5, bottom]] : [[-9.5, -9], [-10.5, -5], [-10.5, bottom]], bumps: false },
  ]
  if (size !== 's') {
    const hi = size === 'm' ? -5 : -9
    raw[1].up = [[-10.5, bottom], [-12.3, -1.6], [-12.3, hi], [size === 'm' ? -10.5 : -9.5, hi]]
    raw.push({ pts: size === 'm' ? [[20.5, -5], [20.5, bottom]] : [[19.5, -9], [20.5, -5], [20.5, bottom]], bumps: false, up: [[20.5, bottom], [22.3, -1.6], [22.3, hi], [size === 'm' ? 20.5 : 19.5, hi]] })
    raw.push({ pts: [[-3.5, top(-11)], [-3.5, bottom]], bumps: true }, { pts: [[13.5, top(-11)], [13.5, bottom]], bumps: true })
  }
  const pistes = raw.map(({ pts, bumps, up }) => ({ ...line(pts), bumps, up: up ? line(up) : null }))
  const count = size === 's' ? 8 : size === 'm' ? (ctx.tv ? 16 : 12) : ctx.tv ? 32 : 16
  const skiers: Skier[] = Array.from({ length: count }, (_, i) => ({
    piste: i % 2 === 0 ? 0 : 1 + (((i - 1) / 2) % (pistes.length - 1)),
    s: 0,
    speed: 2.2 + rnd(i, 92) * 1.2,
    wait: 0,
    up: false,
    board: i % 12 === 5,
    faller: ctx.tv && i % 30 === 7,
    fallAt: -10,
    ph: rnd(i, 93) * 6.28,
  }))
  for (const k of skiers) {
    const p = pistes[k.piste]
    k.s = rnd(k.ph, 94) * p.len
    // Un sur deux des flancs commence sur le téléski : il y a toujours du monde qui remonte.
    if (p.up && rnd(k.ph, 95) < 0.5) {
      k.up = true
      k.s = rnd(k.ph, 96) * p.up.len
    }
  }

  // Téléskis (grande taille) : pylônes et câble le long de la remontée, à 1,3 au-dessus de la neige.
  const ups = pistes.filter((p) => p.up).map((p) => p.up!)
  if (ups.length) {
    const tops: THREE.Vector3[][] = ups.map((u) => {
      const out: THREE.Vector3[] = []
      u.v.forEach((a, k) => {
        if (k === u.v.length - 1) return out.push(a.clone())
        const n = Math.max(1, Math.round(u.lens[k] / 2.6))
        for (let j = 0; j < n; j++) out.push(a.clone().lerp(u.v[k + 1], j / n))
      })
      for (const p of out) p.y = snowH((p.x + ctx.halfX) / S, (p.z + ctx.halfZ) / S) + 1.3
      return out
    })
    const nP = tops.reduce((n, t) => n + t.length, 0)
    const poleGeo = ctx.track(new THREE.CylinderGeometry(0.05, 0.07, 1, 6))
    poleGeo.translate(0, -0.5, 0)
    const poles = new THREE.InstancedMesh(poleGeo, ctx.toon('#6C757D'), nP)
    const wire = new THREE.InstancedMesh(ctx.track(new THREE.BoxGeometry(1, 0.035, 0.035)), ctx.inkFront, nP)
    const m4 = new THREE.Matrix4()
    const X = new THREE.Vector3(1, 0, 0)
    const q = new THREE.Quaternion()
    const d = new THREE.Vector3()
    let i = 0
    let w = 0
    for (const t of tops) {
      t.forEach((p, k) => {
        m4.compose(p, q.identity(), d.set(1, 1.3 + 0.2, 1))
        poles.setMatrixAt(i++, m4)
        if (k === t.length - 1) return
        d.subVectors(t[k + 1], p)
        q.setFromUnitVectors(X, d.clone().normalize())
        m4.compose(p.clone().add(t[k + 1]).multiplyScalar(0.5), q, new THREE.Vector3(d.length(), 1, 1))
        wire.setMatrixAt(w++, m4)
      })
    }
    wire.count = w
    poles.castShadow = true
    scene.add(poles, wire)
  }

  // Maillages : corps (capsule, contour encre), tête + bonnet (couleurs par sommet), skis (2 boîtes fines).
  const bodyGeo = ctx.track(new THREE.CapsuleGeometry(0.12, 0.2, 3, 7))
  bodyGeo.translate(0, 0.25, 0)
  const head = new THREE.SphereGeometry(0.1, 7, 5).translate(0, 0.5, 0).toNonIndexed()
  const hat = new THREE.ConeGeometry(0.1, 0.16, 7).translate(0, 0.62, 0).toNonIndexed()
  const pom = new THREE.SphereGeometry(0.04, 5, 4).translate(0, 0.71, 0).toNonIndexed()
  const paint = (g: THREE.BufferGeometry, hex: string) => {
    const c = new THREE.Color(hex)
    const n = g.getAttribute('position').count
    const a = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3)
    g.setAttribute('color', new THREE.BufferAttribute(a, 3))
    g.deleteAttribute('uv')
    return g
  }
  const headGeo = ctx.track(mergeGeometries([paint(head, '#FFD9B3'), paint(hat, '#EF476F'), paint(pom, '#ffffff')])!)
  ;[head, hat, pom].forEach((g) => g.dispose())
  const skiL = new THREE.BoxGeometry(0.05, 0.02, 0.5).translate(-0.06, 0.01, 0)
  const skiR = new THREE.BoxGeometry(0.05, 0.02, 0.5).translate(0.06, 0.01, 0)
  const skisGeo = ctx.track(mergeGeometries([skiL, skiR])!)
  ;[skiL, skiR].forEach((g) => g.dispose())
  const bodies = instInked(ctx, bodyGeo, ctx.toon('#ffffff'), count, 1.22)
  const heads = new THREE.InstancedMesh(headGeo, ctx.toon('#ffffff', { vertexColors: true }), count)
  const skis = new THREE.InstancedMesh(skisGeo, ctx.toon('#ffffff'), count)
  skiers.forEach((k, i) => {
    bodies.color(i, JACKETS[i % JACKETS.length])
    skis.setColorAt(i, new THREE.Color(k.board ? '#8B5CF6' : '#2b2545'))
  })
  for (const m of [bodies.mesh, heads, skis]) m.castShadow = true
  for (const m of [...bodies.group.children, heads, skis]) m.frustumCulled = false
  scene.add(bodies.group, heads, skis)

  const P = new THREE.Vector3()
  const D = new THREE.Vector3()
  const M = new THREE.Matrix4()
  const Mski = new THREE.Matrix4()
  const Q = new THREE.Quaternion()
  const E = new THREE.Euler(0, 0, 0, 'YXZ')
  const SC = new THREE.Vector3()
  const zero = new THREE.Matrix4().makeScale(0, 0, 0)
  const bumpRows = [-2, -4, -6, -8, -10]
  const hide = (i: number) => {
    bodies.set(i, zero)
    heads.setMatrixAt(i, zero)
    skis.setMatrixAt(i, zero)
  }
  /** Point d'une polyligne à l'abscisse curviligne s (et sa direction). */
  const sample = (p: Line, s: number) => {
    let d = Math.max(0, Math.min(p.len, s))
    for (let k = 0; k < p.lens.length; k++) {
      if (d <= p.lens[k] || k === p.lens.length - 1) {
        const f = p.lens[k] > 0 ? Math.min(1, d / p.lens[k]) : 0
        P.lerpVectors(p.v[k], p.v[k + 1], f)
        D.subVectors(p.v[k + 1], p.v[k]).normalize()
        return
      }
      d -= p.lens[k]
    }
  }
  // Échelle : un peu plus petit qu'un pion, mais lisible de loin (contour encre).
  const SCALE = 1.55
  return {
    update(t: number, dt0: number) {
      const dt = Math.max(0, dt0)
      skiers.forEach((k, i) => {
        const p = pistes[k.piste]
        if (k.wait > 0) {
          k.wait -= dt
          if (k.wait <= 0) k.s = 0
          return hide(i)
        }
        // Remontée au téléski : debout, tiré par la perche, sans slalom.
        if (k.up && p.up) {
          k.s += 1.6 * dt
          if (k.s >= p.up.len) {
            k.up = false
            k.s = 0
          }
          sample(p.up, k.s)
          P.y = snowH((P.x + ctx.halfX) / S, (P.z + ctx.halfZ) / S)
          Q.setFromEuler(E.set(-0.15, Math.atan2(D.x, D.z), Math.sin(t * 3 + k.ph) * 0.05))
          M.compose(P, Q, SC.set(SCALE, SCALE, SCALE))
          bodies.set(i, M)
          heads.setMatrixAt(i, M)
          skis.setMatrixAt(i, M)
          return
        }
        // En bas : il freine (gerbe de neige) ; aux flancs il file au téléski, ailleurs il disparaît et repart d'en haut.
        const left = p.len - k.s
        const brake = Math.min(1, Math.max(0, left / 1.6))
        k.s += k.speed * dt * (0.25 + 0.75 * brake)
        if (k.s >= p.len) {
          if (p.up) {
            k.up = true
            k.s = 0
          } else k.wait = 0.5 + rnd(t, i) * 2.5
          if (ctx.tv && rnd(i, t) < 0.3) {
            sample(p, p.len)
            ctx.puff(P.clone().setY(snowH((P.x + ctx.halfX) / S, (P.z + ctx.halfZ) / S) + 0.2), '#ffffff')
          }
          return hide(i)
        }
        sample(p, k.s)
        // Slalom : écart latéral 0,35 × sin (plus large en planche), penché dans les virages.
        const amp = (k.board ? 0.6 : 0.35) * brake
        const w = 2.2
        const lat = Math.sin(k.s * w + k.ph) * amp
        const dLat = Math.cos(k.s * w + k.ph) * amp * w
        const nx = -D.z
        const nz = D.x
        P.x += nx * lat
        P.z += nz * lat
        const c = (P.x + ctx.halfX) / S
        const r = (P.z + ctx.halfZ) / S
        let y = snowH(c, r)
        // Pistes à bosses : un saut en cloche par-dessus chaque lacet (0,8 de haut).
        if (p.bumps) {
          for (const br of bumpRows) {
            const u = (r - br + 0.45) / 0.9
            if (u > 0 && u < 1) y = Math.max(y, snowH(c, br + 0.5) + Math.sin(u * Math.PI) * 0.8)
          }
        }
        const yaw = Math.atan2(D.x + nx * dLat * 0.3, D.z + nz * dLat * 0.3)
        const pitch = Math.atan2(snowH(c, r - 0.3) - snowH(c, r + 0.3), 0.6 * S) * 0.6
        let roll = -dLat * 0.35
        let pitchX = pitch
        // Télé : un skieur sur trente tombe, roule en boule une seconde et repart.
        if (k.faller) {
          if (t - k.fallAt > 9 + (i % 5) && k.s > 2 && k.s < p.len - 3) k.fallAt = t
          const f = t - k.fallAt
          if (f < 1) {
            pitchX += f * Math.PI * 4
            roll = 0
            y += 0.15
            k.s -= k.speed * dt * 0.7
          }
        }
        const sc = SCALE * (left < 0.5 ? Math.max(0.05, left / 0.5) : 1)
        Q.setFromEuler(E.set(pitchX, yaw, roll))
        P.y = y
        M.compose(P, Q, SC.set(sc, sc, sc))
        bodies.set(i, M)
        heads.setMatrixAt(i, M)
        Mski.compose(P, Q, SC.set(sc * (k.board ? 2.6 : 1), sc, sc * (k.board ? 0.7 : 1)))
        skis.setMatrixAt(i, Mski)
      })
      bodies.dirty()
      heads.instanceMatrix.needsUpdate = true
      skis.instanceMatrix.needsUpdate = true
    },
  }
}
