/**
 * 🎪 La Kermesse de Dédé : le stand de la Tombola et sa plaque de cagnotte (en direct), chapiteau rayé,
 * grande roue et manège qui tournent, arche d'entrée, barbes à papa, ballons, fanions, guirlande multicolore.
 */
import * as THREE from 'three'
import { STAND } from '../../boards/kermesse'
import { makePlate } from '../textures'
import { freeze, freezeLocal } from './kit'
import { buildFair, buildClosedFair } from './kermesse-fair'
import type { ThemeDef } from './types'

const CONF = ['#EF476F', '#FFD166', '#06D6A0', '#4CC9F0', '#8B5CF6', '#FF8FA3']

export const kermesseTheme: ThemeDef = {
  palette: {
    light: { bg: '#FFF1E0', floorA: '#B7E4A0', floorB: '#A2D98A', carpet: '#FFF8EC', carpetDot: '#FFD6E0', road: '#FFF6E5', sky: '#ffffff', ground: '#b7e4a0', hemi: 1.25, sun: 1.55, beam: 0.09, curtain: '#FFD9A8' },
    dark: { bg: '#161236', floorA: '#1F3B2D', floorB: '#27493A', carpet: '#2A2460', carpetDot: '#3A3380', road: '#FFF6E5', sky: '#b9a8ff', ground: '#1f3b2d', hemi: 0.95, sun: 1.25, beam: 0.34, curtain: '#2B2160' },
  },
  stageColors: ['#EF476F', '#FFD166', '#4CC9F0'],
  bulbs: CONF,
  build(ctx) {
    const { scene } = ctx
    const white = ctx.toon('#ffffff')
    const orange = ctx.toon('#FF8C42')
    const red = ctx.toon('#EF476F')
    // Décor fixe : figé en un seul maillage à la fin (même rendu, quelques appels de dessin).
    const stat = new THREE.Group()

    // --- Le stand de la Tombola (entre les deux cases Tombola) et la plaque de la cagnotte.
    const stand = new THREE.Group()
    stand.position.copy(ctx.grid(STAND.col, STAND.row))
    const booth = ctx.inked(ctx.track(new THREE.BoxGeometry(0.95, 0.62, 0.7)), orange, 1.05)
    booth.position.y = 0.31
    const stripeGeo = ctx.track(new THREE.BoxGeometry(0.12, 0.63, 0.72))
    for (const x of [-0.3, 0, 0.3]) {
      const s = new THREE.Mesh(stripeGeo, white)
      s.position.set(x, 0.31, 0)
      stand.add(s)
    }
    const awning = ctx.inked(ctx.track(new THREE.BoxGeometry(1.15, 0.07, 0.55)), white, 1.06)
    awning.position.set(0, 0.95, 0.12)
    awning.rotation.x = 0.35
    const postGeo = ctx.track(new THREE.CylinderGeometry(0.035, 0.035, 0.6, 6))
    for (const x of [-0.5, 0.5]) {
      const p = new THREE.Mesh(postGeo, orange)
      p.position.set(x, 0.75, 0.3)
      stand.add(p)
    }
    const drum = ctx.inked(ctx.track(new THREE.SphereGeometry(0.22, 14, 10)), ctx.toon('#FFD23F', { emissive: '#c77700', emissiveIntensity: 0.4 }), 1.1)
    drum.position.y = 0.88
    stand.add(booth, awning)
    stat.add(stand)
    drum.position.copy(stand.position).setY(0.88)
    scene.add(drum)
    const potAt = ctx.grid(STAND.col, STAND.row, 0.9)
    const potMat = ctx.track(new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false }))
    const potPlate = new THREE.Sprite(potMat)
    potPlate.renderOrder = 6
    potPlate.position.copy(ctx.grid(STAND.col, STAND.row + 0.3, 1.25))
    scene.add(potPlate)
    let pot = -1
    let potAspect = 2
    let bump = 0
    const drawPot = (n: number) => {
      const { tex, aspect } = makePlate(`🎟️ ${n}`, '#FF8C42')
      potMat.map?.dispose()
      potMat.map = tex
      potMat.needsUpdate = true
      potAspect = aspect
    }

    // --- Lobe gauche : chapiteau rayé (Dédé sur son estrade juste en dessous).
    const tent = new THREE.Group()
    tent.position.copy(ctx.grid(2, 1.7))
    const wallGeo = ctx.track(new THREE.CylinderGeometry(0.85, 0.85, 0.8, 3, 1, false, 0, Math.PI / 4))
    const roofGeo = ctx.track(new THREE.ConeGeometry(1.0, 0.85, 3, 1, false, 0, Math.PI / 4))
    for (let k = 0; k < 8; k++) {
      const m = k % 2 ? white : red
      const wseg = new THREE.Mesh(wallGeo, m)
      wseg.position.y = 0.4
      wseg.rotation.y = (k * Math.PI) / 4
      wseg.castShadow = true
      const rseg = new THREE.Mesh(roofGeo, m)
      rseg.position.y = 1.22
      rseg.rotation.y = (k * Math.PI) / 4
      rseg.castShadow = true
      tent.add(wseg, rseg)
    }
    const tentInk = new THREE.Mesh(ctx.track(new THREE.CylinderGeometry(0.9, 0.9, 0.82, 16)), ctx.inkBack)
    tentInk.position.y = 0.4
    const flagPole = new THREE.Mesh(ctx.track(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 6)), ctx.inkFront)
    flagPole.position.y = 1.85
    const triShape = new THREE.Shape()
    triShape.moveTo(0, 0)
    triShape.lineTo(0.34, 0.1)
    triShape.lineTo(0, 0.2)
    triShape.closePath()
    const flagGeo = ctx.track(new THREE.ShapeGeometry(triShape))
    const flag = new THREE.Mesh(flagGeo, ctx.track(new THREE.MeshBasicMaterial({ color: '#FFD166', side: THREE.DoubleSide })))
    flag.position.set(0.02, 1.9, 0)
    tent.add(tentInk, flagPole)
    stat.add(tent)
    flag.position.add(tent.position)
    scene.add(flag)

    // --- Lobe droit : grande roue et manège.
    const wheelAt = ctx.grid(8, 2.1)
    const wheel = new THREE.Group()
    wheel.position.set(wheelAt.x, 1.45, wheelAt.z)
    const rim = ctx.inked(ctx.track(new THREE.TorusGeometry(0.95, 0.06, 8, 36)), ctx.toon('#8B5CF6'), 1.25)
    const spokeGeo = ctx.track(new THREE.BoxGeometry(1.9, 0.04, 0.04))
    const spokeMat = ctx.toon('#c9b6ff')
    for (let k = 0; k < 4; k++) {
      const sp = new THREE.Mesh(spokeGeo, spokeMat)
      sp.rotation.z = (k * Math.PI) / 4
      wheel.add(sp)
    }
    const cabGeo = ctx.track(new THREE.SphereGeometry(0.15, 10, 8))
    const cabs: THREE.Object3D[] = []
    for (let k = 0; k < 8; k++) {
      const c = ctx.inked(cabGeo, ctx.toon(CONF[k % CONF.length]), 1.12)
      const a = (k / 8) * Math.PI * 2
      c.position.set(Math.cos(a) * 0.95, Math.sin(a) * 0.95, 0)
      cabs.push(c)
      wheel.add(c)
    }
    wheel.add(rim)
    // Roue et manège tournent d'un bloc : leurs pièces sont figées dans leur repère (les nacelles sont des sphères).
    freezeLocal(ctx, wheel)
    const legGeo = ctx.track(new THREE.CylinderGeometry(0.05, 0.07, 1.65, 6))
    const legMat = ctx.toon('#6c5ce7')
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, legMat)
      leg.position.set(wheelAt.x + s * 0.35, 0.72, wheelAt.z - 0.15)
      leg.rotation.z = s * 0.42
      leg.castShadow = true
      stat.add(leg)
    }
    scene.add(wheel)
    const carousel = new THREE.Group()
    carousel.position.copy(ctx.grid(8, 4.2))
    const floor = ctx.inked(ctx.track(new THREE.CylinderGeometry(0.72, 0.76, 0.16, 20)), ctx.toon('#4CC9F0'), 1.06)
    floor.position.y = 0.08
    const top = ctx.inked(ctx.track(new THREE.ConeGeometry(0.85, 0.5, 20)), ctx.toon('#FFD166'), 1.06)
    top.position.y = 1.25
    carousel.add(floor, top)
    const mastGeo = ctx.track(new THREE.CylinderGeometry(0.03, 0.03, 0.85, 6))
    const horseGeo = ctx.track(new THREE.SphereGeometry(0.13, 10, 8))
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2
      const mast = new THREE.Mesh(mastGeo, white)
      mast.position.set(Math.cos(a) * 0.5, 0.6, Math.sin(a) * 0.5)
      const horse = ctx.inked(horseGeo, ctx.toon(CONF[k]), 1.1)
      horse.position.set(Math.cos(a) * 0.5, 0.55, Math.sin(a) * 0.5)
      horse.scale.set(1.3, 0.9, 0.8)
      carousel.add(mast, horse)
    }
    freezeLocal(ctx, carousel)
    scene.add(carousel)

    // --- Arche d'entrée dans l'encoche du bas.
    const archAt = ctx.grid(5, 5.8)
    const pillarGeo = ctx.track(new THREE.CylinderGeometry(0.08, 0.1, 1.5, 8))
    for (const s of [-1, 1]) {
      const p = ctx.inked(pillarGeo, red, 1.2)
      p.position.set(archAt.x + s * 0.6, 0.75, archAt.z)
      stat.add(p)
    }
    const pa = makePlate('KERMESSE', '#FFD166')
    const archPlate = ctx.sprite(ctx.track(pa.tex))
    archPlate.scale.set(0.42 * pa.aspect, 0.42, 1)
    archPlate.position.set(archAt.x, 1.6, archAt.z)
    scene.add(archPlate)

    // --- Barbes à papa (à gauche) et ballons (à droite) autour du plateau.
    const stickGeo = ctx.track(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 5))
    const candyGeo = ctx.track(new THREE.SphereGeometry(0.24, 12, 9))
    const pink = ctx.toon('#FF8FA3')
    for (let k = 0; k < 3; k++) {
      const g = new THREE.Group()
      g.position.copy(ctx.grid(-1.1, 0.5 + k * 1.5))
      const st = new THREE.Mesh(stickGeo, white)
      st.position.y = 0.3
      const ball = ctx.inked(candyGeo, pink, 1.08)
      ball.position.y = 0.72
      ball.scale.set(1, 1.15, 1)
      g.add(st, ball)
      stat.add(g)
    }
    const balloonGeo = ctx.track(new THREE.SphereGeometry(0.2, 12, 10))
    const stringGeo = ctx.track(new THREE.CylinderGeometry(0.008, 0.008, 0.9, 4))
    const balloons: Array<{ g: THREE.Group; ph: number }> = []
    for (let k = 0; k < 5; k++) {
      const g = new THREE.Group()
      g.position.copy(k < 3 ? ctx.grid(-1.0 - (k % 2) * 0.3, 5.0 + k * 0.6) : ctx.grid(11.2, 5.4 + (k - 3) * 0.8))
      const b = ctx.inked(balloonGeo, ctx.toon(CONF[(k + 2) % CONF.length]), 1.08)
      b.position.y = 1.35
      b.scale.set(1, 1.2, 1)
      const s = new THREE.Mesh(stringGeo, ctx.inkFront)
      s.position.y = 0.75
      g.add(b, s)
      scene.add(g)
      balloons.push({ g, ph: k * 1.3 })
    }

    // --- Fanions triangulaires sur la toile de fond (instanciés).
    const pennant = new THREE.Shape()
    pennant.moveTo(-0.32, 0)
    pennant.lineTo(0.32, 0)
    pennant.lineTo(0, -0.55)
    pennant.closePath()
    const penGeo = ctx.track(new THREE.ShapeGeometry(pennant))
    const lenA = ctx.xWall - ctx.ext.minX + 7
    const nA = Math.floor(lenA / 0.9)
    const pens = new THREE.InstancedMesh(penGeo, ctx.track(new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide })), nA)
    const m4 = new THREE.Matrix4()
    const col = new THREE.Color()
    for (let k = 0; k < nA; k++) {
      const x = ctx.xWall - lenA + 0.45 + k * 0.9
      m4.makeTranslation(x, 6.6 + Math.sin(k * 0.7) * 0.15, ctx.zWall + 0.35)
      pens.setMatrixAt(k, m4)
      pens.setColorAt(k, col.set(CONF[k % CONF.length]))
    }
    scene.add(pens)
    scene.add(freeze(ctx, stat))

    const fair = buildFair(ctx)
    buildClosedFair(ctx)

    return {
      update(view, dt) {
        const t = ctx.time()
        const n = view.snap.mech?.pot ?? 5
        if (n !== pot) {
          if (pot >= 0) bump = 1
          pot = n
          drawPot(n)
          fair?.pot(n, bump > 0)
        }
        bump = Math.max(0, bump - dt * 3)
        const h = 0.6 * (1 + 0.35 * Math.sin(bump * Math.PI))
        potPlate.scale.set(h * potAspect, h, 1)
        potPlate.position.y = 1.25 + Math.sin(t * 2) * 0.04
        drum.rotation.y = t * 2
        drum.rotation.x = t * 1.3
        wheel.rotation.z = t * 0.35
        for (const c of cabs) c.rotation.z = -wheel.rotation.z
        carousel.rotation.y = t * 0.9
        for (const b of balloons) b.g.position.y = Math.sin(t * 1.4 + b.ph) * 0.08
        flag.rotation.y = Math.sin(t * 3) * 0.4
        fair?.update(t, dt)
      },
      onEvent(e, pawnId, order) {
        const head = ctx.pawnHead(pawnId)
        if (!head) return false
        if (e.t === 'toll') {
          const n = -(e.d ?? 0)
          if (n > 0) ctx.coinsFly(head, fair?.nearest(head) ?? potAt, Math.min(8, n + 2))
          ctx.label(n > 0 ? `🎟️ −${n} 🪙` : '🎟️ Offert !', n > 0 ? '#FFC49B' : '#ffffff', head, order)
          return true
        }
        if (e.t === 'jackpot') {
          ctx.coinsFly((fair?.nearest(head) ?? potAt).clone().setY(1.4), pawnId, 20)
          ctx.confetti(head, 70)
          ctx.shake(0.7)
          ctx.chase(3)
          ctx.cheer(1)
          ctx.label(`🎟️ GROS LOT +${e.d ?? 0} 🪙`, '#FFD23F', head, order)
          return true
        }
        fair?.onEvent(e, pawnId, order)
        return false
      },
    }
  },
}
