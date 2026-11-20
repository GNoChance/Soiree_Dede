/**
 * 🏖️ Dédé-sur-Mer : la baie (plan d'eau dont la hauteur EST la marée), le Banc de sable, le Phare,
 * l'estrade-bouée de Dédé qui flotte, voilier, pédalo, parasols, cabines, palmiers, échelle de marée.
 */
import * as THREE from 'three'
import { TIDE_MS } from '../../types'
import { makePlate } from '../textures'
import type { ThemeDef } from './types'

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
    ph.add(islet, tower, lantern, roof, sweep)
    scene.add(ph)
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
      scene.add(r)
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
    gauge.add(pole, floatRing)
    noShadow(floatRing)
    scene.add(gauge)

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
      scene.add(g)
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
      scene.add(g)
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
      scene.add(g)
    }

    // --- La Baraque à frites, derrière la case 13.
    const pf = makePlate('🍟 Baraque à frites', '#FFD166')
    const plateF = ctx.sprite(ctx.track(pf.tex), { depthTest: false })
    plateF.scale.set(0.4 * pf.aspect, 0.4, 1)
    plateF.position.copy(ctx.grid(5, -0.95, 1.35))
    plateF.renderOrder = 5
    const kiosk = ctx.inked(ctx.track(new THREE.BoxGeometry(0.9, 0.7, 0.5)), ctx.toon('#EF476F'), 1.06)
    kiosk.position.copy(ctx.grid(5, -0.95, 0.35))
    scene.add(plateF, kiosk)

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
      },
      onEpiEvent(e, order) {
        if (e.t !== 'wash' || !e.id) return false
        const head = ctx.pawnHead(e.id)
        if (!head) return false
        ctx.label(`🌊 ${(e.d ?? 0) < 0 ? `−${-(e.d ?? 0)}` : '0'} 🪙`, '#9be7ff', head, order)
        if (e.d) ctx.coinsFly(head, ctx.grid(5, 4.5, level), Math.min(8, -(e.d ?? 0)))
        if (typeof e.from === 'number') ctx.puff(ctx.cellPos(e.from).setY(ctx.TOP_Y + 0.2), '#bdefff')
        ctx.cheer(1)
        ctx.ola(2.5)
        return true
      },
      applyTheme(dark) {
        waterMat.color.set(dark ? '#1F4E8C' : '#2EC4F1')
        sandMat.color.set(dark ? '#E0B04A' : '#FFD166')
        beamMat.opacity = dark ? 0.55 : 0.3
      },
    }
  },
}
