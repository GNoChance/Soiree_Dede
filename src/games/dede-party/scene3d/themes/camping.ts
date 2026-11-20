/**
 * 🏕️ Le Camping des Pins Penchés : feu de camp vacillant au centre, lac et ponton, tentes, caravane et fil
 * à linge, pins penchés (instanciés), lucioles le soir — et Riton le raton (sprite 🦝 + son sac) qui fait
 * sa ronde à contresens pendant l'épilogue.
 */
import * as THREE from 'three'
import { FIRE, RITON_START } from '../../boards/camping'
import { RITON_DIE_MS } from '../../types'
import { makeEmoji, makeLabel } from '../textures'
import type { ThemeDef } from './types'

const rand = (i: number) => {
  const x = Math.sin(i * 91.7 + 17.3) * 43758.5453
  return x - Math.floor(x)
}

export const campingTheme: ThemeDef = {
  palette: {
    light: { bg: '#DDF5E4', floorA: '#9BD77E', floorB: '#86C96B', carpet: '#E9D8A6', carpetDot: '#DCC68A', road: '#F5E6C8', sky: '#ffffff', ground: '#9bd77e', hemi: 1.25, sun: 1.5, beam: 0.08, curtain: '#BFE8C8' },
    dark: { bg: '#101A2E', floorA: '#1E3A2B', floorB: '#254634', carpet: '#3B3A2A', carpetDot: '#4A4936', road: '#EAD9B5', sky: '#9fb4ff', ground: '#1e3a2b', hemi: 0.85, sun: 1.1, beam: 0.3, curtain: '#16243F' },
  },
  stageColors: ['#A47148', '#C68B59', '#FFD166'],
  bulbs: ['#FFD166', '#FF8C42', '#fff6e5'],
  build(ctx) {
    const { scene, S, TOP_Y } = ctx
    const white = ctx.toon('#ffffff')
    const wood = ctx.toon('#8D5A3B')

    // --- Le feu de camp : bûches, flammes qui vacillent, halo.
    const fire = new THREE.Group()
    fire.position.copy(ctx.grid(FIRE.col, FIRE.row))
    fire.scale.setScalar(1.5)
    const logGeo = ctx.track(new THREE.CylinderGeometry(0.08, 0.09, 0.8, 8))
    for (let k = 0; k < 3; k++) {
      const log = ctx.inked(logGeo, wood, 1.15)
      log.rotation.set(Math.PI / 2, (k * Math.PI) / 3, 0)
      log.position.y = 0.1
      fire.add(log)
    }
    const flameA = new THREE.Mesh(ctx.track(new THREE.ConeGeometry(0.26, 0.7, 10)), ctx.toon('#FF8C42', { emissive: '#FF8C42', emissiveIntensity: 0.9 }))
    flameA.position.y = 0.45
    const flameB = new THREE.Mesh(ctx.track(new THREE.ConeGeometry(0.15, 0.45, 10)), ctx.toon('#FFD166', { emissive: '#FFD166', emissiveIntensity: 1 }))
    flameB.position.y = 0.4
    const halo = ctx.sprite(ctx.tex.glow, { color: '#ffb347', blending: THREE.AdditiveBlending, opacity: 0.5 })
    halo.position.y = 0.5
    halo.scale.setScalar(2.6)
    fire.add(flameA, flameB, halo)
    scene.add(fire)

    // --- Coin haut-gauche : le lac, le ponton, un canard.
    const lakeMat = ctx.toon('#4CC9F0')
    const lake = ctx.inked(ctx.track(new THREE.CylinderGeometry(1.5 * S * 0.9, 1.5 * S * 0.9, 0.06, 40)), lakeMat, 1.02)
    lake.position.copy(ctx.grid(1.5, 1, 0.03))
    lake.scale.z = 0.72
    const plankGeo = ctx.track(new THREE.BoxGeometry(0.35, 0.06, 0.9))
    const p1 = ctx.inked(plankGeo, ctx.toon('#C68B59'), 1.08)
    p1.position.copy(ctx.grid(2.8, 1.5, 0.1))
    p1.rotation.y = 0.9
    scene.add(lake, p1)
    const duck = new THREE.Group()
    const yellow = ctx.toon('#FFD166')
    const dBody = ctx.inked(ctx.track(new THREE.SphereGeometry(0.16, 12, 9)), yellow, 1.1)
    dBody.scale.set(1.3, 0.8, 1)
    const dHead = ctx.inked(ctx.track(new THREE.SphereGeometry(0.09, 10, 8)), yellow, 1.12)
    dHead.position.set(0.15, 0.15, 0)
    duck.add(dBody, dHead)
    duck.position.copy(ctx.grid(1.2, 0.9, 0.12))
    scene.add(duck)

    // --- Coin bas-droit : 3 tentes et une table de pique-nique.
    const tentGeo = ctx.track(new THREE.ConeGeometry(0.62, 0.85, 4))
    ;(
      [
        [7.8, 6.9, '#EF476F'],
        [9.4, 6.7, '#FFD166'],
        [9.1, 8.0, '#4CC9F0'],
      ] as const
    ).forEach(([c, r, color], k) => {
      const t = ctx.inked(tentGeo, ctx.toon(color), 1.06)
      t.position.copy(ctx.grid(c, r, 0.42))
      t.rotation.y = Math.PI / 4 + k * 0.3
      scene.add(t)
    })
    const table = new THREE.Group()
    table.position.copy(ctx.grid(7.6, 8.1))
    const tTop = ctx.inked(ctx.track(new THREE.BoxGeometry(0.8, 0.06, 0.45)), ctx.toon('#C68B59'), 1.08)
    tTop.position.y = 0.42
    const benchGeo = ctx.track(new THREE.BoxGeometry(0.8, 0.05, 0.14))
    for (const z of [-0.36, 0.36]) {
      const b = new THREE.Mesh(benchGeo, wood)
      b.position.set(0, 0.24, z)
      table.add(b)
    }
    const legGeo = ctx.track(new THREE.BoxGeometry(0.06, 0.42, 0.5))
    for (const x of [-0.3, 0.3]) {
      const l = new THREE.Mesh(legGeo, wood)
      l.position.set(x, 0.21, 0)
      table.add(l)
    }
    table.add(tTop)
    scene.add(table)

    // --- Coin bas-gauche : la caravane et le fil à linge.
    const van = new THREE.Group()
    van.position.copy(ctx.grid(1.7, 6.9))
    const vBody = ctx.inked(ctx.track(new THREE.CapsuleGeometry(0.42, 0.9, 6, 12)), white, 1.06)
    vBody.rotation.z = Math.PI / 2
    vBody.position.y = 0.62
    vBody.scale.set(1, 1, 0.95)
    const band = new THREE.Mesh(ctx.track(new THREE.BoxGeometry(1.5, 0.12, 0.82)), ctx.toon('#06D6A0'))
    band.position.y = 0.55
    const wheelGeo = ctx.track(new THREE.CylinderGeometry(0.16, 0.16, 0.1, 12))
    wheelGeo.rotateX(Math.PI / 2)
    for (const x of [-0.4, 0.4]) {
      const w = new THREE.Mesh(wheelGeo, ctx.inkFront)
      w.position.set(x, 0.18, 0.4)
      van.add(w)
    }
    van.add(vBody, band)
    scene.add(van)
    const poleGeo = ctx.track(new THREE.CylinderGeometry(0.03, 0.03, 1.0, 6))
    const a = ctx.grid(0.4, 8.25)
    const b = ctx.grid(3.0, 8.25)
    for (const p of [a, b]) {
      const pole = new THREE.Mesh(poleGeo, wood)
      pole.position.set(p.x, 0.5, p.z)
      scene.add(pole)
    }
    const line = new THREE.Mesh(ctx.track(new THREE.BoxGeometry(b.x - a.x, 0.015, 0.015)), ctx.inkFront)
    line.position.set((a.x + b.x) / 2, 0.98, a.z)
    scene.add(line)
    const clothGeo = ctx.track(new THREE.PlaneGeometry(0.34, 0.42))
    ;['#EF476F', '#4CC9F0', '#FFD166'].forEach((c, k) => {
      const cl = new THREE.Mesh(clothGeo, ctx.toon(c, { side: THREE.DoubleSide }))
      cl.position.set(a.x + 0.6 + k * 0.85, 0.76, a.z)
      scene.add(cl)
    })

    // --- Pins penchés (instanciés) : tronc incliné de 10 à 20°, deux cônes verts.
    const spots: Array<[number, number]> = [
      [-1.3, 0.6], [-1.4, 2.6], [-1.2, 7.4], [3.05, 0.25], [0.4, -1.2], [2.6, -1.3], [8.0, -1.3], [10.0, -1.2],
      [10.4, 1.6], [5, 1.6], [-1.3, 5.3], [2.4, 4.2], [8.4, 4.3], [10.3, 7.4], [4.9, 9.4], [0.7, 9.3],
    ]
    const trunkGeo = ctx.track(new THREE.CylinderGeometry(0.08, 0.11, 0.8, 6))
    trunkGeo.translate(0, 0.4, 0)
    const coneA = ctx.track(new THREE.ConeGeometry(0.5, 0.9, 8))
    coneA.translate(0, 1.05, 0)
    const coneB = ctx.track(new THREE.ConeGeometry(0.36, 0.7, 8))
    coneB.translate(0, 1.5, 0)
    const pineMat = ctx.toon('#2D6A4F')
    const trunks = new THREE.InstancedMesh(trunkGeo, ctx.toon('#8D5A3B'), spots.length)
    const lowers = new THREE.InstancedMesh(coneA, pineMat, spots.length)
    const uppers = new THREE.InstancedMesh(coneB, pineMat, spots.length)
    const m4 = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    const pos = new THREE.Vector3()
    const scl = new THREE.Vector3()
    spots.forEach(([c, r], i) => {
      const tilt = (10 + rand(i) * 10) * (Math.PI / 180)
      e.set(Math.cos(rand(i + 7) * 6.28) * tilt, rand(i + 3) * 6.28, Math.sin(rand(i + 7) * 6.28) * tilt)
      q.setFromEuler(e)
      ctx.grid(c, r, 0, pos)
      const s = 0.85 + rand(i + 11) * 0.4
      scl.set(s, s, s)
      m4.compose(pos, q, scl)
      trunks.setMatrixAt(i, m4)
      lowers.setMatrixAt(i, m4)
      uppers.setMatrixAt(i, m4)
    })
    for (const m of [trunks, lowers, uppers]) m.castShadow = true
    scene.add(trunks, lowers, uppers)

    // --- Lucioles (le soir seulement).
    const nFly = 26
    const flyPos = new Float32Array(nFly * 3)
    const flyBase: Array<[number, number, number]> = []
    for (let i = 0; i < nFly; i++) flyBase.push([(rand(i + 40) - 0.5) * (ctx.halfX * 2 + 4), 0.6 + rand(i + 60) * 1.8, (rand(i + 80) - 0.5) * (ctx.halfZ * 2 + 4)])
    const flyGeo = ctx.track(new THREE.BufferGeometry())
    flyGeo.setAttribute('position', new THREE.BufferAttribute(flyPos, 3))
    const flyMat = ctx.track(new THREE.PointsMaterial({ map: ctx.tex.glow, color: '#f6ff8a', size: 0.32, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
    const flies = new THREE.Points(flyGeo, flyMat)
    flies.frustumCulled = false
    scene.add(flies)

    // --- Riton : socle gris foncé, sprite 🦝, son sac (et l'étiquette « N 🪙 » quand il est plein).
    const riton = new THREE.Group()
    const rBase = new THREE.Mesh(ctx.track(new THREE.CylinderGeometry(0.28, 0.31, 0.1, 18)), ctx.toon('#2B2D42'))
    rBase.position.y = 0.07
    const rInk = new THREE.Mesh(ctx.track(new THREE.CylinderGeometry(0.34, 0.37, 0.07, 18)), ctx.inkFront)
    rInk.position.y = 0.035
    const rSprite = ctx.sprite(ctx.track(makeEmoji('🦝')), { depthWrite: true, alphaTest: 0.1 })
    rSprite.center.set(0.5, 0.06)
    rSprite.position.y = 0.1
    rSprite.scale.setScalar(1.15)
    const sackMat = ctx.toon('#E9C46A')
    const sack = ctx.inked(ctx.track(new THREE.SphereGeometry(0.2, 14, 10)), sackMat, 1.1)
    sack.position.set(0.34, 0.24, 0.05)
    const knot = new THREE.Mesh(ctx.track(new THREE.ConeGeometry(0.07, 0.12, 8)), ctx.toon('#C99A3A'))
    knot.position.y = 0.2
    sack.add(knot)
    const sackLabelMat = ctx.track(new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false }))
    const sackLabel = new THREE.Sprite(sackLabelMat)
    sackLabel.renderOrder = 7
    sackLabel.visible = false
    riton.add(rInk, rBase, rSprite, sack, sackLabel)
    riton.scale.setScalar(1.35)
    scene.add(riton)
    // Riton se tient dans un coin de la case (les pions restent lisibles).
    const OFF = new THREE.Vector3(0.36, 0, -0.34)
    const cur = ctx.cellPos(RITON_START).add(OFF)
    let shown = -1
    let sackShown = -1
    let sackAspect = 1
    let startle = -10
    const goalOf = (cell: number, out: THREE.Vector3) => ctx.cellPos(cell, out).add(OFF)
    const tmp = new THREE.Vector3()
    const tmp2 = new THREE.Vector3()
    const dieAt = new THREE.Vector3()
    const sackWorld = () => sack.getWorldPosition(new THREE.Vector3())

    const hit = (e: { k?: string; d?: number }, pawnId: string, order: number) => {
      const head = ctx.pawnHead(pawnId)
      startle = ctx.time()
      if (!head) return
      const n = Math.abs(e.d ?? 0)
      if (e.k === 'steal') {
        ctx.coinsFly(head, sackWorld(), Math.min(8, n + 1))
        ctx.label(`🦝 −${n} 🪙`, '#ff9db1', head, order)
      } else if (e.k === 'drop') {
        ctx.coinsFly(sackWorld(), pawnId, Math.min(14, n + 3))
        ctx.confetti(sackWorld(), 30)
        ctx.label(`🦝 +${n} 🪙`, '#9cf0c9', head, order)
        ctx.cheer(0.9)
      } else ctx.label('🦝 Rien à piquer…', '#ffffff', head, order)
    }

    return {
      update(view, dt) {
        const t = ctx.time()
        // Feu qui vacille.
        flameA.scale.set(1 + Math.sin(t * 13) * 0.08, 1 + Math.sin(t * 9.3) * 0.16, 1 + Math.cos(t * 11) * 0.08)
        flameB.scale.set(1 + Math.cos(t * 15) * 0.1, 1 + Math.sin(t * 12.1 + 1) * 0.2, 1 + Math.sin(t * 14) * 0.1)
        halo.material.opacity = (ctx.isDark() ? 0.75 : 0.35) * (0.85 + 0.15 * Math.sin(t * 17))
        duck.position.x = ctx.grid(1.2 + Math.sin(t * 0.3) * 0.5, 0.9).x
        duck.rotation.y = Math.cos(t * 0.3) > 0 ? 0 : Math.PI
        // Lucioles.
        if (flies.visible) {
          flyBase.forEach(([x, y, z], i) => {
            flyPos[i * 3] = x + Math.sin(t * 0.6 + i) * 0.4
            flyPos[i * 3 + 1] = y + Math.sin(t * 1.3 + i * 2) * 0.25
            flyPos[i * 3 + 2] = z + Math.cos(t * 0.5 + i) * 0.4
          })
          flyGeo.attributes.position.needsUpdate = true
          flyMat.opacity = 0.6 + 0.4 * Math.sin(t * 3)
        }

        // Riton : saut de case en case pendant sa ronde, sinon il rejoint sa case et se dandine.
        const epi = view.epi?.data.t === 'riton' ? view.epi : null
        let y = 0
        if (epi?.hop) {
          const f = epi.hop.frac
          goalOf(epi.hop.from, tmp)
          goalOf(epi.hop.to, tmp2)
          cur.lerpVectors(tmp, tmp2, f)
          y = Math.sin(f * Math.PI) * 0.6
        } else {
          const cell = view.snap.mech?.riton ?? RITON_START
          goalOf(cell, tmp)
          if (shown === -1 || cur.distanceTo(tmp) > S * 3) cur.copy(tmp)
          else cur.lerp(tmp, 1 - Math.exp(-dt * 10))
          shown = cell
        }
        const since = t - startle
        if (since < 0.45) y += Math.sin((since / 0.45) * Math.PI) * 0.45
        riton.position.set(cur.x, TOP_Y + y, cur.z)
        rSprite.material.rotation = Math.sin(t * 5) * 0.08
        // Le sac : gonflé (et son étiquette) s'il est plein, affaissé s'il est vide.
        const n = view.snap.mech?.sack ?? 0
        if (n !== sackShown) {
          sackShown = n
          if (n > 0) {
            const { tex, aspect } = makeLabel(`${n} 🪙`, '#FFD166')
            sackLabelMat.map?.dispose()
            sackLabelMat.map = tex
            sackLabelMat.needsUpdate = true
            sackAspect = aspect
          }
          sackLabel.visible = n > 0
        }
        if (n > 0) sack.scale.setScalar(1.25 + Math.sin(t * 4) * 0.05)
        else sack.scale.set(0.8, 0.45, 0.8)
        sackLabel.position.set(0.34, 0.85, 0.05)
        sackLabel.scale.set(0.34 * sackAspect, 0.34, 1)
      },
      onEvent(e, pawnId, order) {
        if (e.t !== 'riton') return false
        hit(e, pawnId, order)
        return true
      },
      onEpiEvent(e, order) {
        if (e.t !== 'riton' || !e.id) return false
        hit(e, e.id, order)
        return true
      },
      focus(view) {
        return view.epi?.data.t === 'riton' ? cur : null
      },
      dieAnchor(view) {
        const epi = view.epi
        if (!epi || epi.data.t !== 'riton' || epi.t > RITON_DIE_MS + 500) return null
        return { pos: dieAt.copy(cur).setY(TOP_Y + 0.9), value: epi.data.die, t: epi.t }
      },
      applyTheme(dark) {
        flies.visible = dark
        lakeMat.color.set(dark ? '#2b6f9e' : '#4CC9F0')
      },
    }
  },
}
