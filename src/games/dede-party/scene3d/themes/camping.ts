/**
 * 🏕️ Le Camping des Pins Penchés : feu de camp vacillant au centre, lac et ponton, tentes, caravane et fil
 * à linge, pins penchés (instanciés), lucioles le soir — et Riton le raton (sprite 🦝 + son sac) qui fait
 * sa ronde à contresens pendant l'épilogue.
 * Grand Camping (M) : le Sous-bois aux Champignons (Rita) et la Rivière aux Castors (Ritou) ; la famille Raton
 * trotte en même temps que Riton, chacun son sac, un dé au-dessus de chacun.
 */
import * as THREE from 'three'
import { FIRE, PACK, RITON_START } from '../../boards/camping'
import { RITON_DIE_MS } from '../../types'
import { makeDots, makeEmoji, makeLabel } from '../textures'
import { Batch, freeze, ghostMat, instInked, plate, recolorSocle, rnd, tr } from './kit'
import type { ThemeCtx, ThemeDef } from './types'

const rand = (i: number) => {
  const x = Math.sin(i * 91.7 + 17.3) * 43758.5453
  return x - Math.floor(x)
}

/** Un raton : socle, sprite 🦝, sac (et l'étiquette « N 🪙 »), foulard teinté pour la famille. */
interface Raton {
  who: number
  name: string
  group: THREE.Group
  sprite: THREE.Sprite
  sack: THREE.Group
  sackLabel: THREE.Sprite
  sackLabelMat: THREE.SpriteMaterial
  cur: THREE.Vector3
  dieAt: THREE.Vector3
  start: number
  path: number[]
  shown: number
  sackShown: number
  sackAspect: number
  startle: number
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
    // Décor fixe : figé en un seul maillage à la fin (même rendu, quelques appels de dessin).
    const stat = new THREE.Group()

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
    scene.add(lake)
    stat.add(p1)
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
      stat.add(t)
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
    stat.add(table)

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
    stat.add(van)
    const poleGeo = ctx.track(new THREE.CylinderGeometry(0.03, 0.03, 1.0, 6))
    const a = ctx.grid(0.4, 8.25)
    const b = ctx.grid(3.0, 8.25)
    for (const p of [a, b]) {
      const pole = new THREE.Mesh(poleGeo, wood)
      pole.position.set(p.x, 0.5, p.z)
      stat.add(pole)
    }
    const line = new THREE.Mesh(ctx.track(new THREE.BoxGeometry(b.x - a.x, 0.015, 0.015)), ctx.inkFront)
    line.position.set((a.x + b.x) / 2, 0.98, a.z)
    stat.add(line)
    const clothGeo = ctx.track(new THREE.PlaneGeometry(0.34, 0.42))
    ;['#EF476F', '#4CC9F0', '#FFD166'].forEach((c, k) => {
      const cl = new THREE.Mesh(clothGeo, ctx.toon(c, { side: THREE.DoubleSide }))
      cl.position.set(a.x + 0.6 + k * 0.85, 0.76, a.z)
      stat.add(cl)
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
    scene.add(freeze(ctx, stat))

    // --- Lucioles (le soir seulement) ; en grande taille, un essaim de plus dans le Sous-bois.
    const sousbois = ctx.board.quarters.find((x) => x.id === 'sousbois')
    const flyBase: Array<[number, number, number]> = []
    for (let i = 0; i < 26; i++) flyBase.push([(rand(i + 40) - 0.5) * (ctx.halfX * 2 + 4), 0.6 + rand(i + 60) * 1.8, (rand(i + 80) - 0.5) * (ctx.halfZ * 2 + 4)])
    if (sousbois) {
      const { c0, r0, c1, r1 } = sousbois.box
      for (let i = 0; i < 18; i++) {
        const p = ctx.grid(c0 + 0.8 + rnd(i, 3) * (c1 - c0 - 1.6), r0 + 0.8 + rnd(i, 4) * (r1 - r0 - 1.6))
        flyBase.push([p.x, 0.5 + rnd(i, 5) * 1.6, p.z])
      }
    }
    const nFly = flyBase.length
    const flyPos = new Float32Array(nFly * 3)
    const flyGeo = ctx.track(new THREE.BufferGeometry())
    flyGeo.setAttribute('position', new THREE.BufferAttribute(flyPos, 3))
    const flyMat = ctx.track(new THREE.PointsMaterial({ map: ctx.tex.glow, color: '#f6ff8a', size: 0.32, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
    const flies = new THREE.Points(flyGeo, flyMat)
    flies.frustumCulled = false
    scene.add(flies)

    // --- La famille Raton : Riton (socle gris foncé), et en grande taille Rita et Ritou (foulard teinté).
    const baseGeo = ctx.track(new THREE.CylinderGeometry(0.28, 0.31, 0.1, 18))
    const baseInkGeo = ctx.track(new THREE.CylinderGeometry(0.34, 0.37, 0.07, 18))
    const ratonTex = ctx.track(makeEmoji('🦝'))
    const sackGeo = ctx.track(new THREE.SphereGeometry(0.2, 14, 10))
    const knotGeo = ctx.track(new THREE.ConeGeometry(0.07, 0.12, 8))
    const sackMat = ctx.toon('#E9C46A')
    const knotMat = ctx.toon('#C99A3A')
    const scarfGeo = ctx.track(new THREE.TorusGeometry(0.3, 0.06, 6, 16))
    scarfGeo.rotateX(Math.PI / 2)
    const tipGeo = ctx.track(new THREE.ConeGeometry(0.1, 0.2, 4))
    tipGeo.rotateX(Math.PI)
    // Les ratons se tiennent dans un coin de la case (les pions restent lisibles).
    const OFF = new THREE.Vector3(0.36, 0, -0.34)
    const packData = (ctx.board.extra.pack as Array<{ name: string; start: number; path: number[] }> | undefined) ?? []
    const makeRaton = (who: number): Raton => {
      const look = who > 0 ? PACK[who - 1] : null
      const group = new THREE.Group()
      const rBase = new THREE.Mesh(baseGeo, look ? ctx.toon(look.scarf) : ctx.toon('#2B2D42'))
      rBase.position.y = 0.07
      const rInk = new THREE.Mesh(baseInkGeo, ctx.inkFront)
      rInk.position.y = 0.035
      const sprite = ctx.sprite(ratonTex, { depthWrite: true, alphaTest: 0.1 })
      sprite.center.set(0.5, 0.06)
      sprite.position.y = 0.1
      sprite.scale.setScalar(1.15)
      const sack = ctx.inked(sackGeo, sackMat, 1.1)
      sack.position.set(0.34, 0.24, 0.05)
      const knot = new THREE.Mesh(knotGeo, knotMat)
      knot.position.y = 0.2
      sack.add(knot)
      const sackLabelMat = ctx.track(new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false }))
      const sackLabel = new THREE.Sprite(sackLabelMat)
      sackLabel.renderOrder = 7
      sackLabel.visible = false
      group.add(rInk, rBase, sprite, sack, sackLabel)
      if (look) {
        // Le foulard : un col noué sous le museau, sa pointe sur le devant.
        const scarfMat = ctx.toon(look.scarf)
        const scarf = ctx.inked(scarfGeo, scarfMat, 1.12)
        scarf.position.y = 0.22
        const tip = ctx.inked(tipGeo, scarfMat, 1.12)
        tip.position.set(0, 0.16, 0.3)
        group.add(scarf, tip)
      }
      group.scale.setScalar(1.35 * (look?.scale ?? 1))
      scene.add(group)
      const p = who > 0 ? packData[who - 1] : null
      const start = p?.start ?? RITON_START
      return {
        who,
        name: look?.name ?? 'Riton',
        group,
        sprite,
        sack,
        sackLabel,
        sackLabelMat,
        cur: ctx.cellPos(start).add(OFF),
        dieAt: new THREE.Vector3(),
        start,
        path: p?.path ?? [],
        shown: -1,
        sackShown: -1,
        sackAspect: 1,
        startle: -10,
      }
    }
    const ratons: Raton[] = [makeRaton(0), ...packData.map((_, k) => makeRaton(k + 1))]
    const goalOf = (cell: number, out: THREE.Vector3) => ctx.cellPos(cell, out).add(OFF)
    const tmp = new THREE.Vector3()
    const tmp2 = new THREE.Vector3()
    const sackWorld = (r: Raton) => r.sack.getWorldPosition(new THREE.Vector3())

    const hit = (e: { k?: string; d?: number; who?: number }, pawnId: string, order: number) => {
      const r = ratons[e.who ?? 0] ?? ratons[0]
      const head = ctx.pawnHead(pawnId)
      r.startle = ctx.time()
      if (!head) return
      const n = Math.abs(e.d ?? 0)
      const tag = r.who ? `🦝 ${r.name}` : '🦝'
      if (e.k === 'steal') {
        ctx.coinsFly(head, sackWorld(r), Math.min(8, n + 1))
        ctx.label(`${tag} −${n} 🪙`, '#ff9db1', head, order)
      } else if (e.k === 'drop') {
        ctx.coinsFly(sackWorld(r), pawnId, Math.min(14, n + 3))
        ctx.confetti(sackWorld(r), 30)
        ctx.label(`${tag} +${n} 🪙`, '#9cf0c9', head, order)
        ctx.cheer(0.9)
      } else ctx.label(`${tag} Rien à piquer…`, '#ffffff', head, order)
    }

    const big = buildBig(ctx)
    buildClosed(ctx)

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
        big?.update(t)

        // Les ratons : saut de case en case pendant la ronde, sinon ils rejoignent leur case et se dandinent.
        const epi = view.epi?.data.t === 'riton' ? view.epi : null
        const mech = view.snap.mech
        for (const r of ratons) {
          const hop = r.who === 0 ? epi?.hop : epi?.packs.find((p) => p.who === r.who)?.hop
          let y = 0
          if (hop) {
            const f = hop.frac
            goalOf(hop.from, tmp)
            goalOf(hop.to, tmp2)
            r.cur.lerpVectors(tmp, tmp2, f)
            y = Math.sin(f * Math.PI) * 0.6
          } else {
            const cell = (r.who === 0 ? mech?.riton : mech?.pack?.[r.who - 1]?.c) ?? r.start
            goalOf(cell, tmp)
            if (r.shown === -1 || r.cur.distanceTo(tmp) > S * 3) r.cur.copy(tmp)
            else r.cur.lerp(tmp, 1 - Math.exp(-dt * 10))
            r.shown = cell
          }
          const since = t - r.startle
          if (since < 0.45) y += Math.sin((since / 0.45) * Math.PI) * 0.45
          r.group.position.set(r.cur.x, TOP_Y + y, r.cur.z)
          r.sprite.material.rotation = Math.sin(t * 5 + r.who * 1.7) * 0.08
          // Le sac : gonflé (et son étiquette) s'il est plein, affaissé s'il est vide.
          const n = (r.who === 0 ? mech?.sack : mech?.pack?.[r.who - 1]?.sack) ?? 0
          if (n !== r.sackShown) {
            r.sackShown = n
            if (n > 0) {
              const { tex, aspect } = makeLabel(`${n} 🪙`, '#FFD166')
              r.sackLabelMat.map?.dispose()
              r.sackLabelMat.map = tex
              r.sackLabelMat.needsUpdate = true
              r.sackAspect = aspect
            }
            r.sackLabel.visible = n > 0
          }
          if (n > 0) r.sack.scale.setScalar(1.25 + Math.sin(t * 4 + r.who) * 0.05)
          else r.sack.scale.set(0.8, 0.45, 0.8)
          r.sackLabel.position.set(0.34, 0.85, 0.05)
          r.sackLabel.scale.set(0.34 * r.sackAspect, 0.34, 1)
        }
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
        if (view.epi?.data.t !== 'riton') return null
        if (ctx.board.size === 's') return ratons[0].cur
        // Grande taille : la télé garde la vue d'ensemble (trois dés, trois ratons) ; au téléphone, le raton
        // de MA zone (celui dont la ronde passe par ma case), sinon Riton.
        if (ctx.tv) return null
        const me = ctx.focusId()
        if (!me) return null
        const cell = view.snap.pos[me]
        return (ratons.find((r) => r.who > 0 && r.path.includes(cell)) ?? ratons[0]).cur
      },
      dieAnchors(view) {
        const epi = view.epi
        if (!epi || epi.data.t !== 'riton' || epi.t > RITON_DIE_MS + 500) return []
        const out = [{ pos: ratons[0].dieAt.copy(ratons[0].cur).setY(TOP_Y + 0.9), value: epi.data.die, t: epi.t }]
        for (const p of epi.data.pack ?? []) {
          const r = ratons[p.who]
          if (r) out.push({ pos: r.dieAt.copy(r.cur).setY(TOP_Y + 0.9), value: p.die, t: epi.t })
        }
        return out.slice(0, 3)
      },
      applyTheme(dark) {
        flies.visible = dark
        lakeMat.color.set(dark ? '#2b6f9e' : '#4CC9F0')
        big?.applyTheme(dark)
      },
    }
  },
}

/** Le Grand Camping (M) : le Sous-bois aux Champignons et la Rivière aux Castors. */
function buildBig(ctx: ThemeCtx) {
  const sb = ctx.board.quarters.find((x) => x.id === 'sousbois')
  const rv = ctx.board.quarters.find((x) => x.id === 'riviere')
  if (!sb && !rv) return null
  const { scene, S } = ctx
  const updates: Array<(t: number) => void> = []
  const themed: Array<(dark: boolean) => void> = []
  const P = new THREE.Vector3()
  const M4 = new THREE.Matrix4()
  const at = (c: number, r: number, y = 0) => ctx.grid(c, r, y, P)

  // Socles : le Sous-bois en terre de forêt sombre, la Rivière en prairie.
  const socleOf = (id: string, light: string, dark: string) => {
    const m = ctx.toon(light)
    recolorSocle(ctx, id, m)
    themed.push((d) => m.color.set(d ? dark : light))
  }
  if (sb) socleOf('sousbois', '#7BA663', '#183326')
  if (rv) socleOf('riviere', '#A8DB8C', '#22432F')

  const cyl = (rt: number, rb: number, h: number, n = 8) => ctx.track(new THREE.CylinderGeometry(rt, rb, h, n))
  const box = (w: number, h: number, d: number) => ctx.track(new THREE.BoxGeometry(w, h, d))
  const ball = (r: number, w = 8, h = 6) => ctx.track(new THREE.SphereGeometry(r, w, h))

  if (sb) {
    const rep = new Batch()
    const det = new Batch()
    // Forêt serrée : 20 pins penchés, plus sombres, plus inclinés (instanciés).
    const pines: Array<[number, number]> = [
      [-8, 1.1], [-7.9, 3.2], [-8.1, 5.4], [-7.6, 7.0], [-6.6, 7.1], [-4.6, 7.0], [-3.1, 7.1], [-3.0, 1.0], [-4.4, 1.1], [-6.9, 1.0],
      [-10.3, 0.5], [-10.4, 2.8], [-10.2, 5.0], [-10.4, 7.4], [-8.5, -1.2], [-6.2, -1.3], [-3.8, -1.2], [-9.6, 9.3], [-6, 9.4], [-3.2, 9.3],
    ]
    const tGeo = cyl(0.08, 0.11, 0.8, 5)
    tGeo.translate(0, 0.4, 0)
    const aGeo = ctx.track(new THREE.ConeGeometry(0.52, 0.95, 7))
    aGeo.translate(0, 1.05, 0)
    const bGeo = ctx.track(new THREE.ConeGeometry(0.37, 0.75, 7))
    bGeo.translate(0, 1.52, 0)
    const dkPine = ctx.toon('#1F4D3A')
    const pt = new THREE.InstancedMesh(tGeo, ctx.toon('#6B4430'), pines.length)
    const pa = new THREE.InstancedMesh(aGeo, dkPine, pines.length)
    const pb = new THREE.InstancedMesh(bGeo, dkPine, pines.length)
    pines.forEach(([c, r], i) => {
      const tilt = (14 + rnd(i, 1) * 12) * (Math.PI / 180)
      const dir = rnd(i, 2) * 6.28
      const s = 0.95 + rnd(i, 3) * 0.45
      tr(at(c, r), Math.cos(dir) * tilt, rnd(i, 4) * 6.28, Math.sin(dir) * tilt, s, s, s, M4)
      for (const m of [pt, pa, pb]) m.setMatrixAt(i, M4)
    })
    for (const m of [pt, pa, pb]) m.castShadow = true
    scene.add(pt, pa, pb)

    // 6 champignons géants à chapeau rouge à pois (le plus grand, 1,8 de haut, au milieu).
    const shrooms: Array<[number, number, number]> = [
      [-5.5, 4, 1.8], [-7.3, 2.3, 0.9], [-3.7, 2.6, 0.75], [-7.0, 6.2, 1.1], [-4.0, 5.6, 0.85], [-6.3, 5.0, 0.6],
    ]
    const capGeo = ctx.track(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2))
    const capTex = ctx.track(makeDots('#E63946', '#ffffff', 6))
    const caps = instInked(ctx, capGeo, ctx.toon('#ffffff', { map: capTex }), shrooms.length, 1.06)
    const stemGeo = cyl(0.55, 0.7, 1, 8)
    stemGeo.translate(0, 0.5, 0)
    shrooms.forEach(([c, r, h], i) => {
      const w = 0.5 * h
      rep.add(stemGeo, '#FFF1D6', tr(at(c, r), 0, 0, 0, w * 0.5, h * 0.62, w * 0.5))
      caps.set(i, tr(at(c, r, h * 0.58), rnd(i, 9) * 0.2 - 0.1, rnd(i, 8) * 6, 0, w, w * 0.62, w))
    })
    caps.dirty()
    scene.add(caps.group)

    // Le tronc creux, couché.
    const log = cyl(0.3, 0.3, 1.5, 9)
    const hole = ctx.track(new THREE.CircleGeometry(0.22, 9))
    const lp = at(-3.9, 4.1, 0.3).clone()
    rep.add(log, '#8D5A3B', tr(lp, 0, 0.5, Math.PI / 2))
    for (const s of [-1, 1]) {
      const end = lp.clone().add(new THREE.Vector3(Math.cos(0.5) * 0.76 * s, 0, -Math.sin(0.5) * 0.76 * s))
      det.add(hole, '#2B1D14', tr(end, 0, 0.5 + (s > 0 ? Math.PI / 2 : -Math.PI / 2), 0), 0)
    }
    // La souche-terrier de Rita : souche, cernes, trou noir sur le devant, petit panneau.
    const stump = at(-6, 2).clone()
    rep.add(cyl(0.5, 0.62, 0.55, 10), '#8D5A3B', tr(stump.clone().setY(0.27)))
    det.add(cyl(0.48, 0.48, 0.03, 10), '#E0B98A', tr(stump.clone().setY(0.56)), 0)
    det.add(cyl(0.28, 0.28, 0.035, 10), '#C99A6A', tr(stump.clone().setY(0.57)), 0)
    det.add(ctx.track(new THREE.CircleGeometry(0.2, 8, 0, Math.PI)), '#1f1b2e', tr(stump.clone().add(new THREE.Vector3(0, 0.05, 0.58))), 0)
    // Fougères (petits cônes bas) au pied des pins.
    const fern = ctx.track(new THREE.ConeGeometry(0.22, 0.32, 5))
    for (let i = 0; i < 10; i++) det.add(fern, i % 2 ? '#2E7D4F' : '#3E9B5F', tr(at(-8 + rnd(i, 11) * 5, 1.5 + rnd(i, 12) * 5, 0.16), 0, rnd(i, 13) * 3, 0, 1, 0.7 + rnd(i, 14) * 0.5, 1), 0)
    const r1 = rep.build(ctx)
    const d1 = det.build(ctx, { shadow: false })
    scene.add(r1, d1)
    ctx.detail(d1, at(-5.5, 4).clone())
    const ritaSign = plate(ctx, '🦝 Chez Rita', '#FF8FA3', at(-6, 2, 1.15).clone(), 0.3, true)
    ctx.detail(ritaSign)
  }

  if (rv) {
    const rep = new Batch()
    const det = new Batch()
    // La rivière : un ruban d'eau sinueux de (1 ; −6) à (9 ; −4), liseré encre.
    const rowAt = (c: number) => -5 - Math.cos((Math.PI * (c - 1)) / 8) + 0.35 * Math.sin((Math.PI * (c - 1)) / 2)
    const strip = (half: number, y: number) => {
      const N = 30
      const pts: number[] = []
      const idx: number[] = []
      for (let i = 0; i <= N; i++) {
        const c = 0.7 + (8.6 * i) / N
        const p = ctx.grid(c, rowAt(c))
        const p2 = ctx.grid(c + 0.05, rowAt(c + 0.05))
        const dx = p2.x - p.x
        const dz = p2.z - p.z
        const l = Math.hypot(dx, dz)
        const nx = -dz / l
        const nz = dx / l
        // Bouts arrondis : la rivière s'affine aux deux extrémités.
        const k = Math.min(1, Math.min(i, N - i) / 3)
        const h = half * (0.45 + 0.55 * Math.sqrt(k))
        pts.push(p.x + nx * h, y, p.z + nz * h, p.x - nx * h, y, p.z - nz * h)
        if (i < N) {
          const o = i * 2
          idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3)
        }
      }
      const g = ctx.track(new THREE.BufferGeometry())
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
      g.setIndex(idx)
      g.computeVertexNormals()
      return g
    }
    const waterMat = ctx.toon('#4CC9F0', { side: THREE.DoubleSide })
    themed.push((d) => waterMat.color.set(d ? '#2b6f9e' : '#4CC9F0'))
    const water = new THREE.Mesh(strip(0.5 * S, 0.035), waterMat)
    water.receiveShadow = true
    const rim = new THREE.Mesh(strip(0.5 * S + 0.09, 0.025), ctx.track(new THREE.MeshBasicMaterial({ color: '#1f1b2e', side: THREE.DoubleSide })))
    scene.add(rim, water)
    const tangent = (c: number) => {
      const p = ctx.grid(c, rowAt(c))
      const q = ctx.grid(c + 0.05, rowAt(c + 0.05))
      return q.sub(p).normalize()
    }

    // Le barrage de rondins en (5 ; −5), en travers de la rivière.
    const tg = tangent(5)
    const ax = new THREE.Vector3(-tg.z, 0, tg.x)
    const ry = Math.atan2(-ax.z, ax.x)
    const dam = at(5, rowAt(5)).clone()
    const logGeo = cyl(0.11, 0.11, 1.9, 7)
    for (let k = 0; k < 5; k++) {
      const up = k < 3 ? 0 : 1
      const off = up ? (k - 3.5) * 0.24 : (k - 1) * 0.24
      const p = dam.clone().addScaledVector(tg, off).setY(0.1 + up * 0.18)
      rep.add(logGeo, k % 2 ? '#A47148' : '#8D5A3B', tr(p, 0, ry, Math.PI / 2), 1.1)
    }
    // La cabane de Ritou, près du barrage : rondins, toit, porte, cheminée.
    const cab = at(6.4, -6.7).clone()
    rep.add(box(1.0, 0.62, 0.8), '#A47148', tr(cab.clone().setY(0.31)))
    rep.add(ctx.track(new THREE.ConeGeometry(0.82, 0.55, 4)), '#6B4430', tr(cab.clone().setY(0.9), 0, Math.PI / 4, 0))
    rep.add(box(0.12, 0.35, 0.12), '#6c757d', tr(cab.clone().add(new THREE.Vector3(0.28, 1.05, -0.1))))
    det.add(box(0.26, 0.4, 0.02), '#3B2618', tr(cab.clone().add(new THREE.Vector3(0, 0.2, 0.41))), 0)
    det.add(box(0.18, 0.15, 0.02), '#FFD166', tr(cab.clone().add(new THREE.Vector3(-0.32, 0.4, 0.41))), 0)
    // Le castor, au pied du barrage (corps, tête, dents) ; sa queue tape l'eau.
    const bv = dam.clone().addScaledVector(tg, 0.75).addScaledVector(ax, 0.75)
    rep.add(ball(0.24), '#7A4E2D', tr(bv.clone().setY(0.2), 0, 0, 0, 1.25, 0.85, 1))
    const head = bv.clone().addScaledVector(tg, 0.28).setY(0.33)
    rep.add(ball(0.14), '#8D5A3B', tr(head))
    det.add(box(0.07, 0.07, 0.02), '#ffffff', tr(head.clone().addScaledVector(tg, 0.13).setY(0.28), 0, ry + Math.PI / 2, 0), 0)
    const tail = ctx.inked(box(0.32, 0.04, 0.2), ctx.toon('#3B2618'), 1.15)
    const tailPivot = new THREE.Group()
    tailPivot.position.copy(bv).setY(0.14).addScaledVector(tg, -0.22)
    tailPivot.rotation.y = Math.atan2(tg.z, -tg.x) + Math.PI
    tail.position.x = 0.16
    tailPivot.add(tail)
    scene.add(tailPivot)
    ctx.detail(tailPivot)
    // Roseaux le long des berges, cailloux.
    const reed = cyl(0.025, 0.03, 0.75, 4)
    reed.translate(0, 0.37, 0)
    const cattail = cyl(0.055, 0.055, 0.18, 5)
    for (let i = 0; i < 18; i++) {
      const c = 1 + rnd(i, 21) * 8
      const side = i % 2 ? 1 : -1
      const t = tangent(c)
      const p = at(c, rowAt(c)).clone().addScaledVector(new THREE.Vector3(-t.z, 0, t.x), side * (0.5 * S + 0.12 + rnd(i, 22) * 0.2))
      const lean = (rnd(i, 23) - 0.5) * 0.3
      const h = 0.8 + rnd(i, 24) * 0.5
      det.add(reed, '#5A8F3E', tr(p, lean, 0, lean, 1, h, 1), 0)
      det.add(cattail, '#7A4E2D', tr(p.clone().setY(0.75 * h - 0.02), lean, 0, lean), 0)
    }
    const pebble = ball(0.18, 6, 5)
    for (let i = 0; i < 6; i++) det.add(pebble, '#9aa0a6', tr(at(1.5 + rnd(i, 31) * 7, -7.3 + rnd(i, 32) * 0.6, 0.06), 0, rnd(i, 33) * 3, 0, 1 + rnd(i, 34), 0.6, 1), 1.12)
    const r2 = rep.build(ctx)
    const d2 = det.build(ctx, { shadow: false })
    scene.add(r2, d2)
    ctx.detail(d2, dam.clone())
    // Le canoë, qui dérive doucement au fil de l'eau.
    const canoe = new THREE.Group()
    const hull = ctx.inked(ctx.track(new THREE.SphereGeometry(0.5, 10, 6)), ctx.toon('#EF476F'), 1.08)
    hull.scale.set(1.05, 0.22, 0.3)
    const paddle = new THREE.Mesh(box(0.06, 0.02, 0.8), ctx.toon('#C68B59'))
    paddle.position.set(0.1, 0.12, 0)
    paddle.rotation.y = 0.5
    canoe.add(hull, paddle)
    scene.add(canoe)
    ctx.detail(canoe, at(2.6, rowAt(2.6)).clone())
    const ritouSign = plate(ctx, '🦝 Chez Ritou', '#4CC9F0', cab.clone().setY(1.6), 0.3, true)
    ctx.detail(ritouSign)
    updates.push((t) => {
      tail.parent!.rotation.z = Math.max(0, Math.sin(t * 2.2)) * 0.9
      const c = 2.6 + Math.sin(t * 0.18) * 0.9
      const p = ctx.grid(c, rowAt(c))
      const tc = tangent(c)
      canoe.position.set(p.x, 0.07 + Math.sin(t * 1.6) * 0.02, p.z)
      canoe.rotation.set(0, Math.atan2(-tc.z, tc.x), Math.sin(t * 1.3) * 0.06)
    })
  }

  return {
    update: (t: number) => updates.forEach((f) => f(t)),
    applyTheme: (dark: boolean) => themed.forEach((f) => f(dark)),
  }
}

/** Sentiers fermés (taille S) : barrière baissée, panneau de bois « Sentier fermé », pins pâles dans la brume. */
function buildClosed(ctx: ThemeCtx) {
  const spots: Record<string, { sign: [number, number]; rot: number }> = {
    sousbois: { sign: [-0.95, 4.0], rot: Math.PI / 2 },
    riviere: { sign: [5, -0.95], rot: 0 },
  }
  for (const q of ctx.board.closed) {
    const s = spots[q.id]
    if (!s) continue
    const b = new Batch()
    const p = ctx.grid(s.sign[0], s.sign[1])
    const along = new THREE.Vector3(Math.cos(s.rot), 0, -Math.sin(s.rot))
    const post = ctx.track(new THREE.CylinderGeometry(0.05, 0.06, 0.7, 6))
    for (const k of [-1, 1]) b.add(post, '#6B4430', tr(p.clone().addScaledVector(along, k * 0.5).setY(0.35)))
    // La barrière baissée, rayée rouge et blanc.
    const seg = ctx.track(new THREE.BoxGeometry(0.25, 0.08, 0.08))
    for (let k = 0; k < 4; k++) b.add(seg, k % 2 ? '#ffffff' : '#EF476F', tr(p.clone().addScaledVector(along, (k - 1.5) * 0.25).setY(0.42), 0, s.rot, 0), 1.12)
    ctx.scene.add(b.build(ctx))
    plate(ctx, '🚧 Sentier fermé', '#C68B59', p.clone().setY(0.95), 0.3, true)
    // Pins pâles de la forêt cachée (un seul maillage instancié).
    const n = 7
    const geo = ctx.track(new THREE.ConeGeometry(0.55, 1.6, 6))
    geo.translate(0, 0.8, 0)
    const pines = new THREE.InstancedMesh(geo, ghostMat(ctx, '#3b4a3a', 0.4), n)
    const { c0, r0, c1, r1 } = q.box
    const m = new THREE.Matrix4()
    for (let i = 0; i < n; i++) {
      const c = c0 + 0.6 + rnd(i, q.cells[0]) * (c1 - c0 - 1.2)
      const r = r0 + 0.6 + rnd(i + 9, q.cells[0]) * (r1 - r0 - 1.2)
      const k = 0.8 + rnd(i + 3, 1) * 0.6
      tr(ctx.grid(c, r), 0, 0, (rnd(i, 5) - 0.5) * 0.4, k, k, k, m)
      pines.setMatrixAt(i, m)
    }
    ctx.scene.add(pines)
  }
}
