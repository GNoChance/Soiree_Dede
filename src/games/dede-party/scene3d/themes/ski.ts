/**
 * ⛷️ Dédé 2000 : télésièges (pylônes, câble, nacelle qui fait la navette), traînées de verglas, tremplin
 * de la Grande Luge, chalet de la Station, sapins enneigés (instanciés), bonhomme de neige, montagnes sur
 * la toile de fond, flocons. Le ruban est teinté par zone (Vallée, Pistes, Sommet) par PartyScene.
 */
import * as THREE from 'three'
import { makePlate } from '../textures'
import type { ThemeDef } from './types'

const rand = (i: number) => {
  const x = Math.sin(i * 53.3 + 7.1) * 43758.5453
  return x - Math.floor(x)
}

export const skiTheme: ThemeDef = {
  palette: {
    light: { bg: '#E6F4FF', floorA: '#FFFFFF', floorB: '#EAF4FB', carpet: '#F4FAFF', carpetDot: '#DCEBF7', road: '#FFFFFF', sky: '#ffffff', ground: '#eaf4fb', hemi: 1.2, sun: 1.45, beam: 0.08, curtain: '#BFD9F2' },
    dark: { bg: '#0E1B3D', floorA: '#27406B', floorB: '#2F4C7D', carpet: '#34558C', carpetDot: '#4168A6', road: '#FFFFFF', sky: '#b9c8ff', ground: '#27406b', hemi: 0.95, sun: 1.2, beam: 0.34, curtain: '#182B57' },
  },
  stageColors: ['#FFFFFF', '#DFF3FF', '#BFE3FF'],
  bulbs: ['#BFE3FF', '#ffffff', '#EF476F'],
  build(ctx) {
    const { scene, board, S } = ctx
    const white = ctx.toon('#ffffff')

    // --- Télésièges : deux pylônes de part et d'autre, câble à 1,6, nacelle qui fait la navette.
    // --- Verglas : traînée bleu clair translucide de la case à son arrivée.
    const lifts: Array<{ a: THREE.Vector3; b: THREE.Vector3; cab: THREE.Group; ph: number }> = []
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
    liftList.forEach(([from, to], k) => {
      const A = ctx.cellPos(from)
      const B = ctx.cellPos(to)
      const dir = B.clone().sub(A).normalize()
      const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(S * 0.5)
      const a = A.clone().add(side)
      const b = B.clone().add(side)
      m4.makeTranslation(a.x, 0, a.z)
      pylons.setMatrixAt(k * 2, m4)
      m4.makeTranslation(b.x, 0, b.z)
      pylons.setMatrixAt(k * 2 + 1, m4)
      const cable = new THREE.Mesh(cableGeo, cableMat)
      cable.position.set((a.x + b.x) / 2, 1.7, (a.z + b.z) / 2)
      cable.scale.x = a.distanceTo(b)
      cable.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x)
      const cab = new THREE.Group()
      const box = ctx.inked(cabGeo, cabMat, 1.1)
      box.position.y = -0.3
      const rod = new THREE.Mesh(rodGeo, ctx.inkFront)
      rod.position.y = -0.12
      cab.add(box, rod)
      cab.rotation.y = cable.rotation.y
      cab.traverse((o) => ((o as THREE.Mesh).castShadow = false))
      scene.add(cable, cab)
      lifts.push({ a: a.setY(1.7), b: b.setY(1.7), cab, ph: k * 0.37 })
    })
    scene.add(pylons)
    const iceMat = ctx.track(new THREE.MeshBasicMaterial({ color: '#DFF3FF', transparent: true, opacity: 0.8, depthWrite: false }))
    const iceGeo = ctx.track(new THREE.PlaneGeometry(1, 0.55))
    iceGeo.rotateX(-Math.PI / 2)
    for (const [from, to] of iceList) {
      const A = ctx.cellPos(from)
      const B = ctx.cellPos(to)
      const trail = new THREE.Mesh(iceGeo, iceMat)
      trail.position.set((A.x + B.x) / 2, 0.04, (A.z + B.z) / 2)
      trail.scale.x = A.distanceTo(B)
      trail.rotation.y = -Math.atan2(B.z - A.z, B.x - A.x)
      trail.renderOrder = 1
      scene.add(trail)
    }

    // --- La Grande Luge : tremplin et panneau près du Sommet (48).
    const top = board.jumps[0]?.[0] ?? board.cells.length - 1
    const tp = ctx.cellPos(top)
    const ramp = ctx.inked(ctx.track(new THREE.BoxGeometry(0.6, 0.08, 1.1)), ctx.toon('#8D5A3B'), 1.08)
    ramp.position.set(tp.x, 0.28, tp.z + S * 0.78)
    ramp.rotation.x = -0.4
    scene.add(ramp)
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
    scene.add(chalet)

    // --- Sapins enneigés (instanciés) : dans les couloirs entre les spires et autour.
    const spots: Array<[number, number]> = [
      [1, 1.5], [1, 3.6], [1, 5.8], [3, 1], [5.2, 1], [7.6, 1], [9, 2.6], [9, 4.6], [9, 6.6], [7.4, 7], [8.6, 6.1],
      [-1.3, 0.6], [-1.3, 3.2], [11.1, 7.6], [2.4, -1.3], [7.8, -1.3],
    ]
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
      ctx.grid(c, r, 0, pos)
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand(i) * 6.28)
      const s = 0.8 + rand(i + 5) * 0.35
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
    scene.add(snowman)

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
      scene.add(m, p)
    }

    // --- Flocons lents (un seul nuage de points).
    const nFlake = 90
    const fx = ctx.halfX + 5
    const fz = ctx.halfZ + 5
    const flakePos = new Float32Array(nFlake * 3)
    const speed: number[] = []
    for (let i = 0; i < nFlake; i++) {
      flakePos[i * 3] = (rand(i + 20) - 0.5) * 2 * fx
      flakePos[i * 3 + 1] = rand(i + 30) * 9
      flakePos[i * 3 + 2] = (rand(i + 40) - 0.5) * 2 * fz
      speed.push(0.35 + rand(i + 50) * 0.4)
    }
    const flakeGeo = ctx.track(new THREE.BufferGeometry())
    flakeGeo.setAttribute('position', new THREE.BufferAttribute(flakePos, 3))
    const flakeMat = ctx.track(new THREE.PointsMaterial({ map: ctx.tex.glow, color: '#ffffff', size: 0.22, transparent: true, depthWrite: false, opacity: 0.9 }))
    const flakes = new THREE.Points(flakeGeo, flakeMat)
    flakes.frustumCulled = false
    scene.add(flakes)

    return {
      update(_view, dt) {
        const t = ctx.time()
        for (const l of lifts) {
          // Navette : aller-retour en 5 s, petite pause à chaque bout.
          const u = (Math.sin((t * Math.PI * 2) / 5 + l.ph * 6) + 1) / 2
          const k = Math.min(1, Math.max(0, (u - 0.08) / 0.84))
          l.cab.position.lerpVectors(l.a, l.b, k)
          l.cab.rotation.z = Math.sin(t * 3 + l.ph) * 0.06
        }
        for (let i = 0; i < nFlake; i++) {
          let y = flakePos[i * 3 + 1] - speed[i] * dt
          if (y < 0) y += 9
          flakePos[i * 3 + 1] = y
          flakePos[i * 3] += Math.sin(t * 0.7 + i) * dt * 0.15
        }
        flakeGeo.attributes.position.needsUpdate = true
      },
      applyTheme(dark) {
        flakeMat.opacity = dark ? 1 : 0.85
        flakeMat.color.set(dark ? '#ffffff' : '#cfe6ff')
      },
    }
  },
}
