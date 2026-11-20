/**
 * 🏖️ Dédé-sur-Mer : la baie (plan d'eau dont la hauteur EST la marée), le Banc de sable, le Phare,
 * l'estrade-bouée de Dédé qui flotte, voilier, pédalo, parasols, cabines, palmiers, échelle de marée.
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { BoardView } from '../../anim'
import type { DpEvent } from '../../types'
import { TIDE_MS } from '../../types'
import { makeEmoji, makePlate } from '../textures'
import { Batch, freeze, freezeLocal, instInked, rnd, slabGeo, tr } from './kit'
import type { ThemeCtx, ThemeDef } from './types'

const LOW = 0.05
const HIGH = 0.42
const ease = (t: number) => {
  const x = Math.min(1, Math.max(0, t))
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2
}

export const merTheme: ThemeDef = {
  palette: {
    light: { bg: '#CFF4FF', floorA: '#FFE8A3', floorB: '#FFD97A', carpet: '#FFF1C9', carpetDot: '#FFE29A', road: '#FFF6E5', sky: '#ffffff', ground: '#ffe8a3', hemi: 1.25, sun: 1.55, beam: 0.08, curtain: '#7FDBFF' },
    dark: { bg: '#1B1740', floorA: '#3A2E6B', floorB: '#473A80', carpet: '#4A3F8A', carpetDot: '#5A4EA0', road: '#FFE9B0', sky: '#b9a8ff', ground: '#2a1f5c', hemi: 0.95, sun: 1.25, beam: 0.32, curtain: '#2B2160' },
  },
  bulbs: ['#FFD166', '#EF476F', '#ffffff', '#4CC9F0'],
  build(ctx) {
    const { scene, S } = ctx
    const floaters: Array<{ obj: THREE.Object3D; base: number; ph: number }> = []
    // Décor fixe : figé en un seul maillage à la fin (même rendu, quelques appels de dessin).
    const stat = new THREE.Group()
    const noShadow = (o: THREE.Object3D) => o.traverse((x) => ((x as THREE.Mesh).castShadow = false))

    // --- La baie : plan d'eau semi-transparent + liseré d'écume.
    const x0 = 0.6
    const x1 = 9.4
    const z0 = 0.6
    const z1 = 7.4
    const w = (x1 - x0) * S
    const d = (z1 - z0) * S
    const waterGeo = ctx.track(new THREE.PlaneGeometry(w, d))
    waterGeo.rotateX(-Math.PI / 2)
    const waterMat = ctx.toon('#2EC4F1', { transparent: true, opacity: 0.8, depthWrite: false })
    const water = new THREE.Mesh(waterGeo, waterMat)
    water.renderOrder = 1
    const center = ctx.grid((x0 + x1) / 2, (z0 + z1) / 2)
    water.position.copy(center)
    const foamMat = ctx.track(new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9 }))
    const foam = new THREE.Group()
    const fx = ctx.track(new THREE.BoxGeometry(w + 0.16, 0.04, 0.14))
    const fz = ctx.track(new THREE.BoxGeometry(0.14, 0.04, d))
    for (const s of [-1, 1]) {
      const a = new THREE.Mesh(fx, foamMat)
      a.position.set(0, 0, (s * d) / 2)
      const b = new THREE.Mesh(fz, foamMat)
      b.position.set((s * w) / 2, 0, 0)
      foam.add(a, b)
    }
    foam.position.copy(center)
    scene.add(water, foam)

    // --- Le Banc de sable : langue de sable sous les cases 36-44 (et le creux où se dresse le Phare).
    const sandMat = ctx.toon('#FFD166')
    const bank = ctx.inked(ctx.track(new THREE.BoxGeometry(2.9 * S, 0.16, 3.9 * S)), sandMat, 1.02)
    bank.position.copy(ctx.grid(5, 2.5, 0.02))
    scene.add(bank)

    // --- Le Phare, dans le creux du Banc : îlot, tour à anneaux rouges, lanterne qui tourne, toit.
    const red = ctx.toon('#EF476F')
    const white = ctx.toon('#ffffff')
    const ph = new THREE.Group()
    ph.position.copy(ctx.grid(5, 2.2))
    const islet = ctx.inked(ctx.track(new THREE.CylinderGeometry(0.5, 0.6, 0.5, 18)), sandMat, 1.06)
    islet.position.y = 0.25
    const tower = ctx.inked(ctx.track(new THREE.CylinderGeometry(0.24, 0.32, 1.7, 16)), white, 1.08)
    tower.position.y = 1.3
    const ringGeo = ctx.track(new THREE.CylinderGeometry(0.3, 0.31, 0.16, 16))
    for (const y of [0.75, 1.25, 1.75]) {
      const r = new THREE.Mesh(ringGeo, red)
      r.position.y = y
      r.scale.setScalar(1 - (y - 0.75) * 0.12)
      ph.add(r)
    }
    const lantern = new THREE.Mesh(ctx.track(new THREE.SphereGeometry(0.2, 14, 10)), ctx.toon('#FFD166', { emissive: '#FFD166', emissiveIntensity: 0.8 }))
    lantern.position.y = 2.28
    const roof = ctx.inked(ctx.track(new THREE.ConeGeometry(0.3, 0.38, 14)), red, 1.1)
    roof.position.y = 2.62
    const sweep = new THREE.Group()
    sweep.position.y = 2.28
    const beamGeo = ctx.track(new THREE.CylinderGeometry(0.06, 0.55, 2.6, 12, 1, true))
    beamGeo.translate(0, -1.3, 0)
    beamGeo.rotateZ(Math.PI / 2)
    const beamMat = ctx.track(new THREE.MeshBasicMaterial({ map: ctx.tex.beam, color: '#fff3b0', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, opacity: 0.35 }))
    const beam = new THREE.Mesh(beamGeo, beamMat)
    beam.renderOrder = 3
    sweep.add(beam)
    ph.add(islet, tower, lantern, roof)
    stat.add(ph)
    sweep.position.set(ph.position.x, 2.28, ph.position.z)
    scene.add(sweep)
    const pb = makePlate('🏝️ Le Banc de sable', '#FFD166')
    const plateB = ctx.sprite(ctx.track(pb.tex), { depthTest: false })
    plateB.scale.set(0.5 * pb.aspect, 0.5, 1)
    plateB.position.copy(ctx.grid(5, 2.2, 3.3))
    plateB.renderOrder = 5
    scene.add(plateB)

    // --- L'estrade de Dédé : une grosse bouée rayée rouge / blanc qui flotte avec la marée.
    const torusGeo = ctx.track(new THREE.TorusGeometry(1.25, 0.34, 10, 6, Math.PI / 4))
    torusGeo.rotateX(Math.PI / 2)
    const buoy = new THREE.Group()
    for (let k = 0; k < 8; k++) {
      const seg = new THREE.Mesh(torusGeo, k % 2 ? white : red)
      seg.rotation.y = (k * Math.PI) / 4
      buoy.add(seg)
    }
    const buoyInk = new THREE.Mesh(ctx.track(new THREE.TorusGeometry(1.25, 0.4, 10, 32)), ctx.inkBack)
    buoyInk.rotation.x = Math.PI / 2
    const deck = ctx.inked(ctx.track(new THREE.CylinderGeometry(1.0, 1.0, 0.2, 28)), ctx.toon('#4CC9F0'), 1.05)
    deck.position.y = 0.05
    buoy.add(buoyInk, deck)
    // La bouée flotte d'un bloc : ses 8 segments, son contour et son pont en un lot.
    freezeLocal(ctx, buoy)
    ctx.stage.add(buoy)
    ctx.dede.position.y = 0.2
    noShadow(ctx.stage)

    // --- Ce qui flotte dans la baie.
    const float = (obj: THREE.Object3D, base: number) => {
      noShadow(obj)
      scene.add(obj)
      floaters.push({ obj, base, ph: floaters.length * 1.7 })
    }
    const boat = new THREE.Group()
    boat.position.copy(ctx.grid(2, 3.2))
    const hull = ctx.inked(ctx.track(new THREE.BoxGeometry(1.0, 0.24, 0.42)), ctx.toon('#8B5CF6'), 1.08)
    const mast = new THREE.Mesh(ctx.track(new THREE.CylinderGeometry(0.03, 0.03, 1.1, 6)), ctx.toon('#5b4a3a'))
    mast.position.y = 0.6
    const sail = ctx.inked(ctx.track(new THREE.ConeGeometry(0.36, 0.95, 3)), white, 1.06)
    sail.position.set(0.12, 0.62, 0)
    sail.scale.z = 0.18
    boat.add(hull, mast, sail)
    float(boat, 0.1)
    const pedalo = new THREE.Group()
    pedalo.position.copy(ctx.grid(2.2, 6))
    const pBody = ctx.inked(ctx.track(new THREE.BoxGeometry(0.7, 0.18, 0.5)), ctx.toon('#FFD166'), 1.08)
    const seat = new THREE.Mesh(ctx.track(new THREE.BoxGeometry(0.3, 0.25, 0.4)), red)
    seat.position.set(-0.1, 0.18, 0)
    pedalo.add(pBody, seat)
    float(pedalo, 0.08)
    const buoyBallGeo = ctx.track(new THREE.SphereGeometry(0.17, 12, 9))
    const yellow = ctx.toon('#FFD166')
    for (const [c, r] of [[7.7, 5.8], [8.4, 6.3]] as const) {
      const b = ctx.inked(buoyBallGeo, yellow, 1.12)
      b.position.copy(ctx.grid(c, r))
      float(b, 0.08)
    }
    // Rocher (posé au fond, il dépasse de l'eau).
    const rockGeo = ctx.track(new THREE.SphereGeometry(0.4, 10, 8))
    const rockMat = ctx.toon('#9aa0a6')
    for (const [dx, dz, s] of [[0, 0, 1], [0.35, 0.2, 0.7], [-0.3, 0.25, 0.6]] as const) {
      const r = ctx.inked(rockGeo, rockMat, 1.06)
      r.position.copy(ctx.grid(8.3 + dx / S, 3 + dz / S, 0.15))
      r.scale.set(s, s * 0.85, s)
      stat.add(r)
    }

    // --- Échelle de marée près de l'embranchement : poteau gradué + flotteur rouge.
    const gauge = new THREE.Group()
    gauge.position.copy(ctx.grid(3.4, 0.9))
    const pole = ctx.inked(ctx.track(new THREE.CylinderGeometry(0.06, 0.06, 1.4, 8)), white, 1.3)
    pole.position.y = 0.7
    const markGeo = ctx.track(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 8))
    for (let k = 0; k < 5; k++) {
      const m = new THREE.Mesh(markGeo, ctx.inkFront)
      m.position.y = 0.15 + k * 0.22
      gauge.add(m)
    }
    const floatRing = ctx.inked(ctx.track(new THREE.TorusGeometry(0.14, 0.06, 8, 16)), red, 1.15)
    floatRing.rotation.x = Math.PI / 2
    gauge.add(pole)
    floatRing.position.set(gauge.position.x, 0.12, gauge.position.z)
    noShadow(floatRing)
    scene.add(floatRing)
    stat.add(gauge)

    // --- La Plage (parasols), cabines rayées à gauche du Port, palmiers aux coins.
    const umbGeo = ctx.track(new THREE.ConeGeometry(0.62, 0.32, 8))
    const stickGeo = ctx.track(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 6))
    const umbMats = ['#FF8FA3', '#06D6A0', '#FFD166', '#8B5CF6'].map((c) => ctx.toon(c))
    const stickMat = ctx.toon('#fff6e5')
    for (let k = 0; k < 6; k++) {
      const g = new THREE.Group()
      g.position.copy(ctx.grid(1 + k * 1.6, 9.55))
      const stick = new THREE.Mesh(stickGeo, stickMat)
      stick.position.y = 0.45
      const top = ctx.inked(umbGeo, umbMats[k % 4], 1.08)
      top.position.y = 0.95
      g.add(stick, top)
      g.rotation.z = (k % 2 ? 1 : -1) * 0.12
      stat.add(g)
    }
    const cabGeo = ctx.track(new THREE.BoxGeometry(0.55, 0.85, 0.55))
    const roofGeo = ctx.track(new THREE.ConeGeometry(0.46, 0.35, 4))
    const cabMats = [ctx.toon('#EF476F'), ctx.toon('#4CC9F0')]
    const doorGeo = ctx.track(new THREE.PlaneGeometry(0.3, 0.55))
    for (let k = 0; k < 4; k++) {
      const g = new THREE.Group()
      g.position.copy(ctx.grid(-1.25, 1.2 + k * 1.15))
      const body = ctx.inked(cabGeo, cabMats[k % 2], 1.06)
      body.position.y = 0.42
      const roofM = ctx.inked(roofGeo, white, 1.08)
      roofM.position.y = 1.02
      roofM.rotation.y = Math.PI / 4
      const door = new THREE.Mesh(doorGeo, white)
      door.position.set(0.28, 0.35, 0)
      door.rotation.y = Math.PI / 2
      g.add(body, roofM, door)
      stat.add(g)
    }
    const trunkGeo = ctx.track(new THREE.CylinderGeometry(0.09, 0.14, 1.8, 8))
    const trunkMat = ctx.toon('#a0703f')
    const leafGeo = ctx.track(new THREE.ConeGeometry(0.22, 1.0, 6))
    leafGeo.translate(0, 0.5, 0)
    const leafMat = ctx.toon('#2a9d5c')
    for (const [c, r] of [[-1.3, -0.9], [11.0, -0.9], [-1.3, 9.2], [11.2, 9.2]] as const) {
      const g = new THREE.Group()
      g.position.copy(ctx.grid(c, r))
      const trunk = ctx.inked(trunkGeo, trunkMat, 1.08)
      trunk.position.y = 0.9
      trunk.rotation.z = 0.12
      g.add(trunk)
      for (let k = 0; k < 5; k++) {
        const leaf = ctx.inked(leafGeo, leafMat, 1.08)
        leaf.position.set(0.11, 1.78, 0)
        leaf.rotation.set(0, (k / 5) * Math.PI * 2, 1.25)
        leaf.scale.set(1, 1, 0.35)
        g.add(leaf)
      }
      stat.add(g)
    }

    // --- La Baraque à frites, derrière la case 13.
    const pf = makePlate('🍟 Baraque à frites', '#FFD166')
    const plateF = ctx.sprite(ctx.track(pf.tex), { depthTest: false })
    plateF.scale.set(0.4 * pf.aspect, 0.4, 1)
    plateF.position.copy(ctx.grid(5, -0.95, 1.35))
    plateF.renderOrder = 5
    const kiosk = ctx.inked(ctx.track(new THREE.BoxGeometry(0.9, 0.7, 0.5)), ctx.toon('#EF476F'), 1.06)
    kiosk.position.copy(ctx.grid(5, -0.95, 0.35))
    scene.add(plateF)
    stat.add(kiosk)
    scene.add(freeze(ctx, stat, [sandMat]))

    const isles = buildIslands(ctx, waterMat, foamMat, sandMat)
    buildClosedIsles(ctx)

    let level = LOW
    return {
      update(view, dt) {
        const t = ctx.time()
        // Hauteur de l'eau = la marée ; pendant l'épilogue, elle monte (ou descend) en TIDE_MS.
        const epi = view.epi?.data.t === 'tide' ? view.epi : null
        if (epi && epi.data.t === 'tide') {
          const k = ease(epi.t / TIDE_MS)
          level = epi.data.tide === 1 ? LOW + (HIGH - LOW) * k : HIGH - (HIGH - LOW) * k
        } else {
          const goal = view.snap.mech?.tide === 1 ? HIGH : LOW
          level += (goal - level) * (1 - Math.exp(-dt * 4))
        }
        const lap = Math.sin(t * 1.7) * 0.012
        water.position.y = level + lap
        foam.position.y = level + 0.01 + lap
        foam.scale.setScalar(1 + Math.sin(t * 2.2) * 0.004)
        // Bouée de Dédé et tout ce qui flotte : sur l'eau, tanguent doucement.
        ctx.stage.position.y = level - 0.02 + Math.sin(t * 1.3) * 0.05
        ctx.stage.rotation.x = Math.sin(t * 0.9) * 0.05
        ctx.stage.rotation.z = Math.sin(t * 1.1 + 1) * 0.05
        for (const f of floaters) {
          f.obj.position.y = level + f.base + Math.sin(t * 1.5 + f.ph) * 0.04
          f.obj.rotation.z = Math.sin(t * 1.2 + f.ph) * 0.08
        }
        floatRing.position.y = Math.max(0.12, level + 0.06)
        sweep.rotation.y = t * 1.6
        isles?.update(level, t)
      },
      onEvent(e, pawnId) {
        isles?.onEvent(e, pawnId)
        return false
      },
      focus(view) {
        return isles?.focus(view) ?? null
      },
      onEpiEvent(e, order) {
        if (e.t !== 'wash' || !e.id) return false
        const head = ctx.pawnHead(e.id)
        if (!head) return false
        ctx.label(`🌊 ${(e.d ?? 0) < 0 ? `−${-(e.d ?? 0)}` : '0'} 🪙`, '#9be7ff', head, order)
        if (e.d) ctx.coinsFly(head, (typeof e.from === 'number' && isles?.bankAt(e.from, level)) || ctx.grid(5, 4.5, level), Math.min(8, -(e.d ?? 0)))
        if (typeof e.from === 'number') ctx.puff(ctx.cellPos(e.from).setY(ctx.TOP_Y + 0.2), '#bdefff')
        ctx.cheer(1)
        ctx.ola(2.5)
        return true
      },
      applyTheme(dark) {
        waterMat.color.set(dark ? '#1F4E8C' : '#2EC4F1')
        sandMat.color.set(dark ? '#E0B04A' : '#FFD166')
        beamMat.opacity = dark ? 0.55 : 0.3
        isles?.applyTheme(dark)
      },
    }
  },
}

interface Bank {
  cells: number[]
  wash_to: number
  end: number
}

/** Bassins des bancs des grandes tailles (coordonnées de grille c0, r0, c1, r1) : la crique et le lagon en entier. */
const POOLS: Record<number, [number, number, number, number]> = {
  160: [12.55, 6.55, 19.45, 12.45],
  194: [-9.45, 6.55, -3.55, 12.45],
}

/**
 * Les Îles / L'Archipel (M, L) : la mer tout autour (elle suit la marée), un socle de sable arrondi par île, les
 * bancs de marée (bassin + banc de sable, noyés à marée haute) et le décor de chaque île.
 */
function buildIslands(ctx: ThemeCtx, bayMat: THREE.Material, foamMat: THREE.Material, sandMat: THREE.Material) {
  if (ctx.board.size === 's') return null
  const { scene, S } = ctx
  const themed: Array<(d: boolean) => void> = []
  const at = (c: number, r: number, y = 0, out?: THREE.Vector3) => ctx.grid(c, r, y, out)
  const q = (id: string) => ctx.board.quarters.find((x) => x.id === id) ?? null
  const cyl = (rt: number, rb: number, h: number, n = 8) => ctx.track(new THREE.CylinderGeometry(rt, rb, h, n))
  const box = (w: number, h: number, d: number) => ctx.track(new THREE.BoxGeometry(w, h, d))
  const ball = (r: number, w = 8, h = 6) => ctx.track(new THREE.SphereGeometry(r, w, h))

  // --- La mer : un grand plan d'eau sous l'emprise ; le tapis du plateau de base devient la Grande Île.
  const { minX, maxX, minZ, maxZ } = ctx.ext
  const R = Math.max(60, 1.6 * (Math.hypot(maxX - minX, maxZ - minZ) / 2) + 10)
  const seaGeo = ctx.track(new THREE.CircleGeometry(R, 48))
  seaGeo.rotateX(-Math.PI / 2)
  const seaMat = ctx.toon('#35C2EE')
  themed.push((d) => seaMat.color.set(d ? '#1B3F78' : '#35C2EE'))
  const sea = new THREE.Mesh(seaGeo, seaMat)
  sea.position.set((minX + maxX) / 2, -0.165, (minZ + maxZ) / 2)
  sea.receiveShadow = true
  scene.add(sea)

  // --- Socles de sable arrondis (le Piton sur du sable noir) : un maillage par sable, contour encre fusionné.
  const sands: THREE.BufferGeometry[] = []
  const blacks: THREE.BufferGeometry[] = []
  const inks: THREE.BufferGeometry[] = []
  for (const isle of ctx.board.quarters) {
    const g = ctx.socle(isle.id)
    if (g) g.visible = false
    const a = at(isle.box.c0 - 0.75, isle.box.r0 - 0.75)
    const b = at(isle.box.c1 + 0.75, isle.box.r1 + 0.75)
    const w = b.x - a.x
    const d = b.z - a.z
    const top = slabGeo(w, d, 1.7, 0.3)
    top.translate((a.x + b.x) / 2, 0.02, (a.z + b.z) / 2)
    ;(isle.id === 'piton' ? blacks : sands).push(top)
    const ink = slabGeo(w + 0.32, d + 0.32, 1.86, 0.3)
    ink.translate((a.x + b.x) / 2, -0.01, (a.z + b.z) / 2)
    inks.push(ink)
  }
  const islandSand = ctx.toon('#FFE29A')
  themed.push((d) => islandSand.color.set(d ? '#C9A24A' : '#FFE29A'))
  const blackSand = ctx.toon('#6B5B53')
  for (const [list, mat] of [[sands, islandSand], [blacks, blackSand], [inks, ctx.inkFront]] as const) {
    if (!list.length) continue
    const m = new THREE.Mesh(ctx.track(mergeGeometries(list)!), mat)
    m.receiveShadow = mat !== ctx.inkFront
    scene.add(m)
    list.forEach((x) => x.dispose())
  }

  // --- Les bancs de marée des îles : un bassin (même eau que la baie, à la hauteur de la marée) et un banc de
  // sable sous chaque case de banc, noyé à marée haute.
  const banks = ((ctx.board.extra.banks as Bank[] | undefined) ?? []).filter((bk) => bk.cells.some((c) => c >= 45))
  const poolGeos: THREE.BufferGeometry[] = []
  const rimGeos: THREE.BufferGeometry[] = []
  const bankCenters: Array<{ cells: number[]; at: THREE.Vector3 }> = [{ cells: [36, 37, 38, 39, 40, 41, 42, 43, 44], at: at(5, 2.5) }]
  const padCells = banks.flatMap((bk) => bk.cells)
  const pads = instInked(ctx, box(1.15 * S, 0.16, 1.15 * S), sandMat, Math.max(1, padCells.length), 1.04)
  const M4 = new THREE.Matrix4()
  padCells.forEach((c, i) => pads.set(i, M4.makeTranslation(ctx.cellPos(c).setY(0.02))))
  pads.dirty()
  pads.mesh.castShadow = false
  if (padCells.length) scene.add(pads.group)
  for (const bk of banks) {
    const cs = bk.cells.map((c) => ctx.board.xy[c])
    const [c0, r0, c1, r1] = POOLS[bk.cells[0]] ?? [
      Math.min(...cs.map((p) => p[0])) - 0.55,
      Math.min(...cs.map((p) => p[1])) - 0.55,
      Math.max(...cs.map((p) => p[0])) + 0.55,
      Math.max(...cs.map((p) => p[1])) + 0.55,
    ]
    const a = at(c0, r0)
    const b = at(c1, r1)
    const w = b.x - a.x
    const d = b.z - a.z
    const cx = (a.x + b.x) / 2
    const cz = (a.z + b.z) / 2
    const pg = new THREE.PlaneGeometry(w, d)
    pg.rotateX(-Math.PI / 2)
    pg.translate(cx, 0, cz)
    poolGeos.push(pg)
    for (const s of [-1, 1]) {
      rimGeos.push(new THREE.BoxGeometry(w + 0.14, 0.04, 0.12).translate(cx, 0.01, cz + (s * d) / 2))
      rimGeos.push(new THREE.BoxGeometry(0.12, 0.04, d).translate(cx + (s * w) / 2, 0.01, cz))
    }
    bankCenters.push({ cells: bk.cells, at: new THREE.Vector3(cx, 0, cz) })
  }
  let pools: THREE.Mesh | null = null
  let rims: THREE.Mesh | null = null
  if (poolGeos.length) {
    pools = new THREE.Mesh(ctx.track(mergeGeometries(poolGeos)!), bayMat)
    pools.renderOrder = 1
    rims = new THREE.Mesh(ctx.track(mergeGeometries(rimGeos)!), foamMat)
    scene.add(pools, rims)
    ;[...poolGeos, ...rimGeos].forEach((x) => x.dispose())
  }

  // --- Décor des îles : gros volumes fusionnés (toujours visibles), petits objets par île (détail).
  const rep = new Batch()
  const details: Array<{ b: Batch; at: THREE.Vector3 }> = []
  const detailOf = (c: number, r: number) => {
    const d = { b: new Batch(), at: at(c, r) }
    details.push(d)
    return d.b
  }
  const updates: Array<(t: number, k: number, seaY: number, level: number) => void> = []
  let gullDive = -10
  let cocoDrop = -10

  // 🐦 L'Île aux Mouettes : village de pêcheurs, casiers, 8 mouettes qui tournent (et plongent).
  const mouettes = q('mouettes')
  if (mouettes) {
    const det = detailOf(-6, -1)
    const roofs = ['#EF476F', '#4CC9F0', '#FFD166', '#06D6A0']
    const houses: Array<[number, number]> = [[-7, -2.5], [-5.5, -2.5], [-7, -0.5], [-5, 0]]
    houses.forEach(([c, r], k) => {
      const p = at(c, r)
      rep.add(box(0.8, 0.62, 0.7), '#ffffff', tr(p.clone().setY(0.33), 0, k * 0.3, 0))
      rep.add(ctx.track(new THREE.ConeGeometry(0.66, 0.5, 4)), roofs[k], tr(p.clone().setY(0.88), 0, Math.PI / 4 + k * 0.3, 0))
      det.add(box(0.22, 0.34, 0.02), '#3a86c8', tr(p.clone().add(new THREE.Vector3(Math.sin(k * 0.3) * 0.36, 0.17, Math.cos(k * 0.3) * 0.36)), 0, k * 0.3, 0), 0)
    })
    for (let i = 0; i < 4; i++) det.add(box(0.3, 0.22, 0.3), '#C68B59', tr(at(-4.2 - (i % 2) * 0.32, -3.3 + i * 0.25, 0.12 + (i > 1 ? 0.22 : 0))), 1.1)
    det.add(cyl(0.05, 0.05, 1.0, 5), '#8D5A3B', tr(at(-7.9, 1.0, 0.5)))
    det.add(cyl(0.05, 0.05, 1.0, 5), '#8D5A3B', tr(at(-7.9, -1.6, 0.5)))
    det.add(box(0.03, 0.5, 3.2), '#2a6f8f', tr(at(-7.9, -0.3, 0.7)), 0)
    // Les mouettes : deux triangles en V, instanciées.
    const gv = new Float32Array([0, 0, 0, -0.32, 0.1, -0.08, 0, 0, -0.14, 0, 0, 0, 0.32, 0.1, -0.08, 0, 0, -0.14])
    const gGeo = ctx.track(new THREE.BufferGeometry())
    gGeo.setAttribute('position', new THREE.BufferAttribute(gv, 3))
    gGeo.computeVertexNormals()
    const gulls = new THREE.InstancedMesh(gGeo, ctx.track(new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide })), 8)
    gulls.frustumCulled = false
    scene.add(gulls)
    ctx.detail(gulls, at(-6, -1))
    const hub = at(-6, -1)
    const gm = new THREE.Matrix4()
    const gp = new THREE.Vector3()
    updates.push((t) => {
      const dive = t - gullDive
      for (let i = 0; i < 8; i++) {
        const a = t * (0.5 + (i % 3) * 0.08) + (i / 8) * Math.PI * 2
        const rad = 1.3 + (i % 3) * 0.45
        let y = 2.6 + (i % 2) * 0.5 + Math.sin(t * 1.7 + i) * 0.15
        if (dive >= 0 && dive < 1.8) y -= Math.sin((dive / 1.8) * Math.PI) * (1.8 + (i % 3) * 0.3)
        gp.set(hub.x + Math.cos(a) * rad, y, hub.z + Math.sin(a) * rad)
        tr(gp, Math.sin(t * 9 + i) * 0.35, -a, 0.3, 1, 1, 1, gm)
        gulls.setMatrixAt(i, gm)
      }
      gulls.instanceMatrix.needsUpdate = true
    })
  }

  // 🥥 L'Île Coco : 7 cocotiers le long de la ligne −4, la paillote, deux hamacs ; une noix de coco tombe.
  const coco = q('coco')
  if (coco) {
    const det = detailOf(5, -4)
    const trunkGeo = cyl(0.08, 0.13, 1.7, 6)
    trunkGeo.translate(0, 0.85, 0)
    const leafGeo = ctx.track(new THREE.ConeGeometry(0.22, 1.0, 5))
    leafGeo.translate(0, 0.5, 0)
    const nut = ball(0.1, 6, 5)
    const palms: Array<[number, number]> = [[0.9, -4.6], [1.6, -4], [3.4, -4], [4.1, -3.1], [6.6, -4], [8.4, -4], [9.1, -3.4]]
    palms.forEach(([c, r], i) => {
      const p = at(c, r)
      const lean = (rnd(i, 41) - 0.5) * 0.35
      const top = p.clone().add(new THREE.Vector3(Math.sin(lean) * 1.7, 1.68, 0))
      rep.add(trunkGeo, '#a0703f', tr(p, 0, 0, -lean))
      for (let k = 0; k < 5; k++) rep.add(leafGeo, '#2a9d5c', tr(top, 0, (k / 5) * Math.PI * 2 + i, 1.25, 1, 1, 0.35))
      for (let k = 0; k < 2; k++) det.add(nut, '#6B4430', tr(top.clone().add(new THREE.Vector3(k ? 0.1 : -0.08, -0.12, k ? -0.06 : 0.08))), 1.12)
    })
    const hut = at(5, -4)
    rep.add(cyl(0.5, 0.55, 0.6, 8), '#E9C46A', tr(hut.clone().setY(0.3)))
    rep.add(ctx.track(new THREE.ConeGeometry(0.95, 0.65, 8)), '#C99A3A', tr(hut.clone().setY(0.92)))
    det.add(box(0.3, 0.42, 0.04), '#6B4430', tr(hut.clone().add(new THREE.Vector3(0, 0.21, 0.53))), 0)
    const hammocks: Array<[number, string]> = [[2.5, '#EF476F'], [7.5, '#4CC9F0']]
    for (const [c, col] of hammocks) det.add(ball(0.5, 10, 6), col, tr(at(c, -4, 0.62), 0, 0, 0, 1.45, 0.14, 0.42), 1.08)
    // La noix de coco qui tombe (« toc ! ») : de temps en temps, et quand un pion débarque au ponton.
    const falling = ctx.inked(nut, ctx.toon('#6B4430'), 1.15)
    falling.scale.setScalar(0)
    scene.add(falling)
    ctx.detail(falling, at(5, -4))
    let tocked = true
    let nextAuto = 6
    updates.push((t) => {
      if (t > nextAuto) {
        nextAuto = t + 9
        if (t - cocoDrop > 4) cocoDrop = t
      }
      const f = t - cocoDrop
      const k = Math.abs(Math.floor(cocoDrop * 7)) % palms.length
      const [c, r] = palms[k]
      if (f >= 0 && f < 1.4) {
        const p = at(c, r)
        falling.position.set(p.x + 0.2, Math.max(0.1, 1.6 - 4.9 * f * f), p.z + 0.15)
        falling.scale.setScalar(1)
        if (f < 0.5) tocked = false
        else if (!tocked) {
          tocked = true
          if (ctx.tv || falling.position.distanceTo(ctx.camTarget()) < 22) ctx.label('🥥 Toc !', '#FFE9B0', falling.position.clone().setY(0.9))
        }
      } else falling.scale.setScalar(0)
    })
  }

  // 🌋 Le Piton Fumant : le cône, le cratère orange (la lave pulse la nuit), un rond de fumée par seconde.
  const piton = q('piton')
  if (piton) {
    const det = detailOf(16, -2)
    const peak = at(16, -2)
    rep.add(cyl(0.6, 2.6 * S, 3.2, 10), '#5B4B49', tr(peak.clone().setY(1.6)), 1.03)
    rep.add(cyl(0.62, 0.9, 0.5, 10), '#4a3c3a', tr(peak.clone().setY(2.95)), 0)
    const rock = ball(0.3, 6, 5)
    for (let i = 0; i < 7; i++) det.add(rock, '#3F3433', tr(at(13.6 + rnd(i, 51) * 5, -5.2 + (i % 2) * 6.2 + rnd(i, 52) * 0.4, 0.12), 0, rnd(i, 53) * 3, 0, 1 + rnd(i, 54), 0.7, 1), 1.1)
    const lavaMat = ctx.toon('#FF8C42', { emissive: '#FF5A1F', emissiveIntensity: 0.9 })
    const crater = new THREE.Mesh(ctx.track(new THREE.CircleGeometry(0.55, 10)), lavaMat)
    crater.rotation.x = -Math.PI / 2
    crater.position.copy(peak).setY(3.22)
    scene.add(crater)
    const smoke: THREE.Sprite[] = []
    for (let k = 0; k < 3; k++) {
      const s = ctx.sprite(ctx.tex.glow, { color: '#b9b0aa', opacity: 0.6 })
      smoke.push(s)
      scene.add(s)
    }
    let lastTide = -1
    updates.push((t, _k, _s, level) => {
      lavaMat.emissiveIntensity = (ctx.isDark() ? 1.3 : 0.7) * (0.75 + 0.25 * Math.sin(t * 2.4))
      smoke.forEach((s, k) => {
        const f = ((t + k) % 3) / 3
        s.position.set(peak.x + Math.sin(t * 0.5 + k) * 0.3 * f, 3.4 + f * 2.6, peak.z - f * 0.4)
        s.scale.setScalar(0.8 + f * 1.8)
        s.material.opacity = 0.6 * (1 - f)
      })
      // Il « tousse » quand la marée change : gros rond de fumée, petite secousse.
      const tide = level > (LOW + HIGH) / 2 ? 1 : 0
      if (lastTide >= 0 && tide !== lastTide) {
        for (let k = 0; k < 3; k++) ctx.puff(peak.clone().setY(3.6 + k * 0.4), '#9d938d')
        ctx.shake(0.25)
      }
      lastTide = tide
    })
  }

  // 🏴‍☠️ La Crique des Pirates : l'épave penchée dans la crique, le coffre ouvert qui scintille.
  const pirates = q('pirates')
  if (pirates) {
    const det = detailOf(15, 10)
    const wreck = at(15, 11.2)
    rep.add(ctx.track(new THREE.CapsuleGeometry(0.42, 1.5, 3, 8)), '#8D5A3B', tr(wreck.clone().setY(0.12), 0.35, 0.3, Math.PI / 2, 1, 1, 0.75))
    rep.add(cyl(0.05, 0.06, 2.0, 5), '#5b4a3a', tr(wreck.clone().setY(1.05), 0, 0, 0.32))
    det.add(box(0.9, 0.8, 0.03), '#EDE6D6', tr(wreck.clone().add(new THREE.Vector3(-0.2, 1.15, 0.05)), 0, 0.3, 0.32), 1.05)
    const chest = at(14, 8.5)
    rep.add(box(0.55, 0.32, 0.38), '#A0522D', tr(chest.clone().setY(0.18)))
    det.add(box(0.5, 0.06, 0.34), '#FFD23F', tr(chest.clone().setY(0.35)), 0)
    det.add(box(0.57, 0.06, 0.38), '#8D4426', tr(chest.clone().add(new THREE.Vector3(0, 0.5, -0.2)), -1.1, 0, 0))
    const flag = ctx.sprite(ctx.track(makeEmoji('🏴‍☠️')), {})
    flag.position.copy(wreck).add(new THREE.Vector3(-0.62, 2.2, 0))
    flag.scale.setScalar(0.6)
    scene.add(flag)
    ctx.detail(flag, wreck.clone())
    const glint = ctx.sprite(ctx.tex.sparkle, { color: '#FFD23F', blending: THREE.AdditiveBlending })
    glint.position.copy(chest).setY(0.7)
    scene.add(glint)
    ctx.detail(glint, chest.clone())
    updates.push((t) => {
      glint.scale.setScalar(0.45 + 0.25 * Math.abs(Math.sin(t * 3)))
      glint.material.rotation = t
    })
  }

  // 🦀 L'Îlot des Crabes : rochers gris, 6 crabes qui marchent de côté le long du lagon (cachés à marée haute).
  const crabes = q('crabes')
  if (crabes) {
    const rock = ball(0.42, 7, 5)
    const rocks: Array<[number, number, number]> = [[-4.1, 7.2, 1], [-4.3, 12.0, 0.8], [-9.0, 12.1, 0.9], [-6, 7.0, 0.7], [-11.2, 9.5, 1.3], [-11.0, 12.5, 1]]
    rocks.forEach(([c, r, s], i) => rep.add(rock, i % 2 ? '#8d939a' : '#a3a9b0', tr(at(c, r, 0.1), 0, i, 0, s * 1.2, s * 0.8, s)))
    const body = new THREE.SphereGeometry(0.14, 8, 6).scale(1.35, 0.55, 1)
    const clawL = new THREE.SphereGeometry(0.065, 6, 4).translate(-0.19, 0.02, 0.1)
    const clawR = new THREE.SphereGeometry(0.065, 6, 4).translate(0.19, 0.02, 0.1)
    const crabGeo = ctx.track(mergeGeometries([body, clawL, clawR])!)
    ;[body, clawL, clawR].forEach((x) => x.dispose())
    const crabs = instInked(ctx, crabGeo, ctx.toon('#EF476F'), 6, 1.15)
    crabs.mesh.frustumCulled = false
    scene.add(crabs.group)
    ctx.detail(crabs.group, at(-6.5, 10))
    const cm = new THREE.Matrix4()
    const cp = new THREE.Vector3()
    updates.push((t, k) => {
      for (let i = 0; i < 6; i++) {
        const u = (Math.sin(t * 0.45 + i * 1.9) + 1) / 2
        const onRow = i < 3
        if (onRow) at(-8.6 + u * 4.3, 11.75 - (i % 2) * 0.25, 0, cp)
        else at(-4.35 + (i % 2) * 0.2, 7.4 + u * 4.1, 0, cp)
        // Ils se cachent quand la mer monte (ils s'enfouissent dans le sable).
        const hide = Math.min(1, k * 1.4)
        cp.y = 0.06 - hide * 0.2 + Math.abs(Math.sin(t * 9 + i)) * 0.02
        const sc = 1 - hide * 0.7
        tr(cp, 0, onRow ? 0 : Math.PI / 2, Math.sin(t * 8 + i) * 0.08, sc, sc, sc, cm)
        crabs.set(i, cm)
      }
      crabs.dirty()
    })
  }

  // --- Navettes du retour (à quai, côté île) et lignes de bouées des bacs.
  const nav: THREE.Vector3[] = []
  const lanes: THREE.Vector3[] = []
  for (const [a, b] of ctx.board.jumps) {
    if (ctx.board.transports[`${a}-${b}`]?.kind !== 'boat') continue
    const A = ctx.cellPos(a)
    const B = ctx.cellPos(b)
    if (a >= 45) nav.push(A.clone().lerp(B, 0.3))
    else for (let k = 1; k <= 4; k++) lanes.push(A.clone().lerp(B, k / 5).add(new THREE.Vector3(B.z - A.z, 0, A.x - B.x).normalize().multiplyScalar(0.55)))
  }
  const hulls = instInked(ctx, box(1.0, 0.24, 0.46), ctx.toon('#EF476F'), Math.max(1, nav.length), 1.1)
  const cabParts = [new THREE.BoxGeometry(0.42, 0.26, 0.34).translate(0, 0.25, 0), new THREE.CylinderGeometry(0.06, 0.06, 0.3, 6).translate(0.1, 0.5, 0)]
  const cabins = new THREE.InstancedMesh(ctx.track(mergeGeometries(cabParts.map((g) => g.toNonIndexed()))!), ctx.toon('#ffffff'), Math.max(1, nav.length))
  cabParts.forEach((g) => g.dispose())
  hulls.mesh.castShadow = false
  const buoys = new THREE.InstancedMesh(ball(0.1, 6, 5), ctx.toon('#ffffff'), Math.max(1, lanes.length))
  lanes.forEach((p, i) => {
    buoys.setMatrixAt(i, M4.makeTranslation(p))
    buoys.setColorAt(i, new THREE.Color(i % 2 ? '#ffffff' : '#EF476F'))
  })
  const buoyGroup = new THREE.Group()
  buoyGroup.add(buoys)
  if (lanes.length) scene.add(buoyGroup)
  if (nav.length) scene.add(hulls.group, cabins)
  const nm = new THREE.Matrix4()
  const np = new THREE.Vector3()
  updates.push((t, _k, seaY) => {
    nav.forEach((p, i) => {
      np.copy(p).setY(seaY + 0.12 + Math.sin(t * 1.5 + i) * 0.03)
      tr(np, 0, i * 1.3, Math.sin(t * 1.2 + i) * 0.07, 1, 1, 1, nm)
      hulls.set(i, nm)
      cabins.setMatrixAt(i, nm)
    })
    hulls.dirty()
    cabins.instanceMatrix.needsUpdate = true
    buoyGroup.position.y = seaY + 0.12 + Math.sin(t * 1.4) * 0.02
  })

  scene.add(rep.build(ctx))
  for (const d of details) {
    const g = d.b.build(ctx, { shadow: false })
    scene.add(g)
    ctx.detail(g, d.at)
  }

  return {
    update(level: number, t: number) {
      const k = (level - LOW) / (HIGH - LOW)
      const lap = Math.sin(t * 1.7) * 0.012
      const seaY = -0.165 + k * 0.14 + lap * 0.5
      sea.position.y = seaY
      if (pools) pools.position.y = level + lap
      if (rims) rims.position.y = level + 0.01 + lap
      for (const u of updates) u(t, k, seaY, level)
    },
    onEvent(e: DpEvent, pawnId: string) {
      if (e.t !== 'start' || !e.halt) return
      const head = ctx.pawnHead(pawnId)
      if (!head) return
      if (mouettes && head.distanceTo(at(-6, -1)) < 9) gullDive = ctx.time()
      if (coco && head.distanceTo(at(5, -4)) < 9) cocoDrop = ctx.time()
    },
    /** Épilogue de la marée : télé en vue d'ensemble ; téléphone sur le banc le plus proche de mon pion. */
    focus(view: BoardView): THREE.Vector3 | null {
      if (view.epi?.data.t !== 'tide' || ctx.tv) return null
      const me = ctx.focusId()
      if (!me) return null
      const p = ctx.cellPos(view.snap.pos[me] ?? 0)
      let best = bankCenters[0].at
      for (const b of bankCenters) if (b.at.distanceTo(p) < best.distanceTo(p)) best = b.at
      return best
    },
    /** Centre du bassin d'un banc des îles (où filent les pièces des emportés). */
    bankAt(cell: number, level: number): THREE.Vector3 | null {
      const b = bankCenters.find((x) => x.cells.includes(cell))
      return b && b.cells[0] !== 36 ? b.at.clone().setY(level) : null
    },
    applyTheme(dark: boolean) {
      themed.forEach((f) => f(dark))
    },
  }
}

/** Îles fermées : leur silhouette pâle sous la brume (un seul maillage pour toutes). */
function buildClosedIsles(ctx: ThemeCtx) {
  if (!ctx.board.closed.length) return
  const b = new Batch()
  const at = (c: number, r: number, y = 0) => ctx.grid(c, r, y)
  const pale = '#eef6ff'
  const geos: THREE.BufferGeometry[] = []
  const g = <T extends THREE.BufferGeometry>(x: T) => {
    geos.push(x)
    return x
  }
  for (const isle of ctx.board.closed) {
    const { c0, r0, c1, r1 } = isle.box
    const mid = at((c0 + c1) / 2, (r0 + r1) / 2)
    if (isle.id === 'piton') b.add(g(new THREE.CylinderGeometry(0.6, 2.6 * ctx.S, 3.2, 8)), '#d9cfcb', tr(at(16, -2, 1.6)), 0)
    else if (isle.id === 'coco') {
      for (const c of [2, 5, 8]) b.add(g(new THREE.ConeGeometry(0.5, 2.0, 5)), pale, tr(at(c, -4, 1.0)), 0)
    } else if (isle.id === 'mouettes') {
      for (const [c, r] of [[-7, -2.5], [-5.5, -0.5]] as const) b.add(g(new THREE.ConeGeometry(0.7, 1.3, 4)), pale, tr(at(c, r, 0.65), 0, Math.PI / 4, 0), 0)
    } else if (isle.id === 'pirates') {
      b.add(g(new THREE.CapsuleGeometry(0.42, 1.5, 3, 8)), pale, tr(at(15, 11, 0.2), 0.3, 0.3, Math.PI / 2, 1, 1, 0.75), 0)
      b.add(g(new THREE.CylinderGeometry(0.05, 0.06, 2, 5)), pale, tr(at(15, 11, 1.1), 0, 0, 0.3), 0)
    } else {
      for (let i = 0; i < 3; i++) b.add(g(new THREE.SphereGeometry(0.6, 6, 5)), pale, tr(mid.clone().add(new THREE.Vector3((i - 1) * 1.6, 0.2, (i % 2) * 0.8)), 0, i, 0, 1, 0.6, 1), 0)
    }
  }
  ctx.scene.add(b.build(ctx, { shadow: false, mat: ctx.toon('#ffffff', { vertexColors: true, transparent: true, opacity: 0.45, depthWrite: false }) }))
  geos.forEach((x) => x.dispose())
}
