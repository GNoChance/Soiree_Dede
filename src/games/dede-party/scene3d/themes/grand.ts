/**
 * 🎤 Le Grand Plateau de Dédé : rideaux rouges à lambrequin doré, néons « DÉDÉ PARTY », La Scène et la télé du Tunnel de la pub.
 * Les Studios Dédé (M) : les Coulisses (parquet, loges, portant, miroir à ampoules, flight-cases) et la Régie
 * (sol bleu nuit, mur d'écrans qui affichent le dernier évènement, console, caméras).
 */
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { DpEvent } from '../../types'
import { makeNeon, makePlate, makePubScreen, makeScreen } from '../textures'
import { Batch, freeze, recolorSocle, rnd, tr } from './kit'
import type { ThemeCtx, ThemeDef } from './types'

const GOLD = '#FFD23F'

export const grandTheme: ThemeDef = {
  palette: {
    light: { bg: '#fff0d6', floorA: '#ffc98a', floorB: '#ffb86b', carpet: '#fff8ec', carpetDot: '#ffe2b8', road: '#fff6e5', sky: '#ffffff', ground: '#ffd9a8', hemi: 1.25, sun: 1.55, beam: 0.09, curtain: '#d62839' },
    dark: { bg: '#15122b', floorA: '#221a4d', floorB: '#2b2160', carpet: '#33297a', carpetDot: '#42379a', road: '#fff6e5', sky: '#b9a8ff', ground: '#2a1f5c', hemi: 0.95, sun: 1.25, beam: 0.34, curtain: '#a4133c' },
  },
  stageColors: ['#8B5CF6', '#FF8FA3', '#FFD166'],
  build(ctx) {
    const { scene, zWall, xWall } = ctx
    // Lambrequins et galons dorés au-dessus des rideaux (en grande taille, la toile part du bord de l'emprise).
    const lenA = xWall - ctx.ext.minX + 7
    const lenB = ctx.ext.maxZ + 6 - zWall
    const valMat = ctx.toon('#6a0f24')
    const goldMat = ctx.toon(GOLD)
    const valA = new THREE.Mesh(ctx.track(new THREE.BoxGeometry(lenA, 1.1, 0.7)), valMat)
    valA.position.set(xWall - lenA / 2, 7.6, zWall + 0.2)
    const trimA = new THREE.Mesh(ctx.track(new THREE.BoxGeometry(lenA, 0.16, 0.76)), goldMat)
    trimA.position.set(xWall - lenA / 2, 7.0, zWall + 0.2)
    const valB = new THREE.Mesh(ctx.track(new THREE.BoxGeometry(0.7, 1.1, lenB)), valMat)
    valB.position.set(xWall - 0.2, 7.6, zWall + lenB / 2)
    const trimB = new THREE.Mesh(ctx.track(new THREE.BoxGeometry(0.76, 0.16, lenB)), goldMat)
    trimB.position.set(xWall - 0.2, 7.0, zWall + lenB / 2)
    // Décor fixe : figé en un seul maillage à la fin (même rendu, quelques appels de dessin).
    const stat = new THREE.Group()
    stat.add(valA, trimA, valB, trimB)

    // Enseignes néon sur les deux rideaux.
    const neonTex = ctx.track(makeNeon())
    const neonGeo = ctx.track(new THREE.PlaneGeometry(8.6, 2.7))
    const neons: THREE.MeshBasicMaterial[] = []
    for (const k of [0, 1]) {
      const m = ctx.track(new THREE.MeshBasicMaterial({ map: neonTex, transparent: true }))
      const mesh = new THREE.Mesh(neonGeo, m)
      if (k === 0) mesh.position.set(0, 4.9, zWall + 0.45)
      else {
        mesh.rotation.y = -Math.PI / 2
        mesh.position.set(xWall - 0.45, 4.9, 0)
      }
      neons.push(m)
      scene.add(mesh)
    }

    // La Scène : petit podium rond, étoile, panneau.
    const sc = ctx.grid(5, 1)
    const stage = ctx.inked(ctx.track(new THREE.CylinderGeometry(0.5, 0.56, 0.5, 20)), ctx.toon('#EF476F'), 1.08)
    stage.position.set(sc.x, 0.25, sc.z)
    stat.add(stage)
    const starTop = ctx.sprite(ctx.tex.sparkle, { color: GOLD })
    starTop.scale.setScalar(0.9)
    starTop.position.set(sc.x, 1.0, sc.z)
    scene.add(starTop)
    const p1 = makePlate('🎭 La Scène', '#FFD166')
    const plate1 = ctx.sprite(ctx.track(p1.tex), { depthTest: false })
    plate1.scale.set(0.55 * p1.aspect, 0.55, 1)
    plate1.position.set(sc.x + 0.5, 1.5, sc.z)
    plate1.renderOrder = 5
    scene.add(plate1)

    // La télé du Tunnel de la pub : coffre violet, écran qui clignote, antennes, pieds.
    const tv = new THREE.Group()
    tv.position.copy(ctx.grid(9, 4.5))
    tv.rotation.y = -Math.PI / 4
    const box = ctx.inked(ctx.track(new RoundedBoxGeometry(1.25, 0.95, 0.7, 3, 0.12)), ctx.toon('#8B5CF6'), 1.06)
    box.position.y = 0.72
    const pubMat = ctx.track(new THREE.MeshBasicMaterial({ map: ctx.track(makePubScreen()) }))
    const screen = new THREE.Mesh(ctx.track(new THREE.PlaneGeometry(0.95, 0.68)), pubMat)
    screen.position.set(0, 0.74, 0.36)
    const legGeo = ctx.track(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 6))
    const antGeo = ctx.track(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 5))
    const dark = ctx.toon('#2b2545')
    for (const x of [-0.4, 0.4]) {
      const leg = new THREE.Mesh(legGeo, dark)
      leg.position.set(x, 0.14, 0)
      tv.add(leg)
      const ant = new THREE.Mesh(antGeo, dark)
      ant.position.set(x * 0.45, 1.5, 0)
      ant.rotation.z = -x * 1.1
      tv.add(ant)
    }
    tv.add(box, screen)
    stat.add(tv)
    const p2 = makePlate('📺 Tunnel de la pub', '#FF8FA3')
    const plate2 = ctx.sprite(ctx.track(p2.tex), { depthTest: false })
    plate2.scale.set(0.58 * p2.aspect, 0.58, 1)
    plate2.position.set(tv.position.x, 2.25, tv.position.z)
    plate2.renderOrder = 5
    scene.add(plate2)

    scene.add(freeze(ctx, stat))

    const studios = buildStudios(ctx)
    buildClosedStudios(ctx)

    return {
      update() {
        const t = ctx.time()
        neons.forEach((n, i) => n.color.setScalar(0.88 + 0.12 * Math.sin(t * 5 + i * 2)))
        pubMat.color.setHSL((t * 0.25) % 1, 0.35, 0.8)
        studios?.update(t)
      },
      onEvent(e, pawnId, order) {
        studios?.onEvent(e, pawnId, order)
        return false
      },
      applyTheme(d) {
        studios?.applyTheme(d)
      },
    }
  },
}

/** Les Studios Dédé (M) : les Coulisses et la Régie. */
function buildStudios(ctx: ThemeCtx) {
  const cou = ctx.board.quarters.find((q) => q.id === 'coulisses')
  const reg = ctx.board.quarters.find((q) => q.id === 'regie')
  if (!cou && !reg) return null
  const { scene } = ctx
  const at = (c: number, r: number, y = 0) => ctx.grid(c, r, y)
  const box = (w: number, h: number, d: number) => ctx.track(new THREE.BoxGeometry(w, h, d))
  const cyl = (rt: number, rb: number, h: number, n = 7) => ctx.track(new THREE.CylinderGeometry(rt, rb, h, n))
  const updates: Array<(t: number) => void> = []
  const themed: Array<(d: boolean) => void> = []
  const forkOf = (cell: number) => ctx.board.forks.findIndex((f) => f.cell === cell)
  let mirrorChase = -10

  if (cou) {
    // Parquet chaud de l'envers du décor.
    const floor = ctx.toon('#C9A27A')
    recolorSocle(ctx, 'coulisses', floor)
    themed.push((d) => floor.color.set(d ? '#6B4F3A' : '#C9A27A'))
    const rep = new Batch()
    const det = new Batch()
    // Trois portes de loge à étoile dorée.
    const star = new THREE.Shape()
    for (let k = 0; k < 10; k++) {
      const r = k % 2 ? 0.07 : 0.16
      const a = (k / 10) * Math.PI * 2 + Math.PI / 2
      if (k) star.lineTo(Math.cos(a) * r, Math.sin(a) * r)
      else star.moveTo(Math.cos(a) * r, Math.sin(a) * r)
    }
    const starGeo = ctx.track(new THREE.ShapeGeometry(star))
    ;([[1.5, '#8B5CF6'], [4, '#EF476F'], [6.5, '#4CC9F0']] as const).forEach(([r, col]) => {
      const p = at(-4.5, r)
      rep.add(box(0.9, 1.45, 0.1), '#fff6e5', tr(p.clone().setY(0.72)))
      rep.add(box(0.72, 1.3, 0.06), col, tr(p.clone().add(new THREE.Vector3(0, 0.66, 0.05))), 0)
      det.add(starGeo, GOLD, tr(p.clone().add(new THREE.Vector3(0, 1.0, 0.09))), 0)
      det.add(ctx.track(new THREE.SphereGeometry(0.04, 5, 4)), GOLD, tr(p.clone().add(new THREE.Vector3(0.24, 0.62, 0.1))), 0)
    })
    // Portant à costumes : 2 poteaux, la barre, 6 costumes colorés.
    const rack = at(-5.6, 3)
    for (const dz of [-0.75, 0.75]) rep.add(cyl(0.035, 0.035, 1.4, 6), '#9aa0a6', tr(rack.clone().add(new THREE.Vector3(0, 0.7, dz))), 1.15)
    rep.add(cyl(0.03, 0.03, 1.6, 6), '#9aa0a6', tr(rack.clone().setY(1.38), Math.PI / 2, 0, 0), 1.15)
    ;['#EF476F', '#FFD166', '#06D6A0', '#4CC9F0', '#8B5CF6', '#FF8FA3'].forEach((col, k) =>
      det.add(box(0.5, 0.75, 0.05), col, tr(rack.clone().add(new THREE.Vector3(0, 0.95, -0.62 + k * 0.25)), 0, Math.PI / 2 + (rnd(k, 3) - 0.5) * 0.3, 0)),
    )
    // Miroir de loge à ampoules (elles courent en chenillard quand un pion entre).
    const mir = at(-3.4, 5.2)
    rep.add(box(1.1, 1.25, 0.1), '#2b2545', tr(mir.clone().setY(0.95)))
    det.add(box(0.85, 1.0, 0.02), '#BFE3FF', tr(mir.clone().add(new THREE.Vector3(0, 0.95, 0.06))), 0)
    rep.add(box(1.1, 0.5, 0.45), '#A47148', tr(mir.clone().add(new THREE.Vector3(0, 0.25, 0.2))))
    const bulbPos: THREE.Vector3[] = []
    for (let k = 0; k < 14; k++) {
      const u = k / 14
      const per = u * 4
      const side = Math.floor(per)
      const f = per - side
      const x = side === 0 ? -0.5 + f : side === 1 ? 0.5 : side === 2 ? 0.5 - f : -0.5
      const y = side === 0 ? 0.58 : side === 1 ? 0.58 - f * 1.16 : side === 2 ? -0.58 : -0.58 + f * 1.16
      bulbPos.push(mir.clone().add(new THREE.Vector3(x, 0.95 + y, 0.08)))
    }
    const bulbs = new THREE.InstancedMesh(ctx.track(new THREE.SphereGeometry(0.055, 6, 5)), ctx.track(new THREE.MeshBasicMaterial({ color: '#ffffff' })), bulbPos.length)
    const bm = new THREE.Matrix4()
    bulbPos.forEach((p, i) => bulbs.setMatrixAt(i, bm.makeTranslation(p)))
    const on = new THREE.Color('#FFE9A8')
    const off = new THREE.Color('#8a7a5a')
    const hot = new THREE.Color('#FFD23F')
    scene.add(bulbs)
    ctx.detail(bulbs, mir.clone())
    updates.push((t) => {
      const chase = t - mirrorChase < 3
      for (let i = 0; i < bulbPos.length; i++) {
        const lit = chase ? (Math.floor(t * 12) - i) % 4 === 0 : true
        bulbs.setColorAt(i, chase ? (lit ? hot : off) : on)
      }
      if (bulbs.instanceColor) bulbs.instanceColor.needsUpdate = true
    })
    // Flight-cases empilés (noirs à coins d'alu).
    const fc = at(-5.9, 6.8)
    ;([[0, 0.25, 0, 0.9, 0.5, 0.6, 0.1], [0.05, 0.7, 0.02, 0.75, 0.4, 0.5, -0.2], [-0.05, 1.05, 0, 0.55, 0.3, 0.42, 0.25]] as const).forEach(([dx, y, dz, w, h, d, ry]) => {
      rep.add(box(w, h, d), '#2b2545', tr(fc.clone().add(new THREE.Vector3(dx, y, dz)), 0, ry, 0))
      det.add(box(w + 0.02, 0.05, d + 0.02), '#c9ced6', tr(fc.clone().add(new THREE.Vector3(dx, y + h / 2 - 0.04, dz)), 0, ry, 0), 0)
    })
    const r1 = rep.build(ctx)
    const d1 = det.build(ctx, { shadow: false })
    scene.add(r1, d1)
    ctx.detail(d1, at(-4.5, 4))
  }

  // La Régie : sol bleu nuit, mur de 12 écrans (le dernier évènement), console de mixage, caméras, câbles.
  let screenMat: THREE.MeshBasicMaterial | null = null
  const screens = new Map<string, THREE.Texture>()
  const screenOf = (emoji: string, bg: string) => {
    let t = screens.get(emoji)
    if (!t) {
      t = ctx.track(makeScreen(emoji, bg))
      screens.set(emoji, t)
    }
    return t
  }
  if (reg) {
    const floor = ctx.toon('#1F2A5C')
    recolorSocle(ctx, 'regie', floor)
    themed.push((d) => floor.color.set(d ? '#141B3D' : '#1F2A5C'))
    const rep = new Batch()
    const det = new Batch()
    const wall = at(6, 12.25)
    rep.add(box(2.35, 1.5, 0.22), '#2b2545', tr(wall.clone().setY(0.75)))
    const planes: THREE.BufferGeometry[] = []
    for (let i = 0; i < 12; i++) {
      const c = i % 4
      const r = Math.floor(i / 4)
      planes.push(new THREE.PlaneGeometry(0.5, 0.36).translate(wall.x - 0.81 + c * 0.54, 0.38 + (2 - r) * 0.42, wall.z + 0.12))
    }
    screenMat = ctx.track(new THREE.MeshBasicMaterial({ map: screenOf('⭐', '#8B5CF6') }))
    const wallScreens = new THREE.Mesh(ctx.track(mergeGeometries(planes)!), screenMat)
    planes.forEach((g) => g.dispose())
    scene.add(wallScreens)
    // Console de mixage : pupitre incliné, boutons et curseurs colorés.
    const desk = at(6, 13.2)
    rep.add(box(2.2, 0.55, 0.6), '#3a3f5c', tr(desk.clone().setY(0.28)))
    det.add(box(2.1, 0.06, 0.5), '#565c80', tr(desk.clone().setY(0.6), -0.35, 0, 0), 0)
    const knob = cyl(0.035, 0.035, 0.05, 6)
    const cols = ['#EF476F', '#FFD166', '#06D6A0', '#4CC9F0']
    for (let i = 0; i < 24; i++) {
      const x = -0.9 + (i % 12) * 0.165
      const z = i < 12 ? -0.08 : 0.1
      det.add(knob, cols[(i + (i < 12 ? 0 : 2)) % 4], tr(desk.clone().add(new THREE.Vector3(x, 0.67 - z * 0.35, z)), -0.35, 0, 0), 0)
    }
    // Deux caméras sur pied, tournées vers le mur d'écrans.
    const leg = cyl(0.025, 0.025, 1.0, 5)
    for (const c of [2.5, 9.5]) {
      const p = at(c, 11.5)
      const aim = Math.atan2(wall.x - p.x, wall.z - p.z)
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2
        rep.add(leg, '#2b2545', tr(p.clone().add(new THREE.Vector3(Math.cos(a) * 0.2, 0.45, Math.sin(a) * 0.2)), Math.sin(a) * 0.22, 0, -Math.cos(a) * 0.22), 0)
      }
      const head = p.clone().setY(1.05)
      rep.add(box(0.32, 0.3, 0.55), '#4a4e69', tr(head, 0, aim, 0))
      rep.add(cyl(0.11, 0.13, 0.3, 8), '#2b2545', tr(head.clone().add(new THREE.Vector3(Math.sin(aim) * 0.38, 0, Math.cos(aim) * 0.38)), Math.PI / 2, aim, 0))
      det.add(ctx.track(new THREE.SphereGeometry(0.045, 5, 4)), '#EF476F', tr(head.clone().add(new THREE.Vector3(0, 0.19, 0))), 0)
      // Le câble jusqu'à la console.
      const mid = head.clone().lerp(desk, 0.5)
      det.add(box(0.05, 0.02, head.distanceTo(desk)), '#1f1b2e', tr(mid.setY(0.02), 0, Math.atan2(desk.x - head.x, desk.z - head.z), 0), 0)
    }
    const r2 = rep.build(ctx)
    const d2 = det.build(ctx, { shadow: false })
    scene.add(r2, d2)
    ctx.detail(d2, at(6, 12))
  }

  const SCREENS: Partial<Record<DpEvent['t'], [string, string]>> = {
    star: ['⭐', '#8B5CF6'],
    star_poor: ['⭐', '#6c757d'],
    pub: ['📺', '#FF8FA3'],
    card: ['✉️', '#4CC9F0'],
    clap: ['👏', '#06D6A0'],
    start: ['🏁', '#FFD166'],
  }
  return {
    update: (t: number) => updates.forEach((f) => f(t)),
    onEvent(e: DpEvent, pawnId: string, order: number) {
      // Le mur de la Régie affiche le dernier évènement.
      const s = SCREENS[e.t]
      if (screenMat && s) {
        screenMat.map = screenOf(s[0], s[1])
        screenMat.needsUpdate = true
      }
      // Un pion entre en coulisses : les ampoules du miroir courent, « Silence, on tourne ! ».
      if (cou && e.t === 'fork' && e.way === 1 && e.fork === forkOf(4)) {
        mirrorChase = ctx.time()
        const head = ctx.pawnHead(pawnId)
        if (head) ctx.label('🤫 Silence, on tourne !', '#F2D4B0', head, order + 1)
      }
    },
    applyTheme: (d: boolean) => themed.forEach((f) => f(d)),
  }
}

/** Quartiers fermés (taille S) : la Régie derrière sa baie, écrans qui clignotent ; loges pâles derrière le rideau. */
function buildClosedStudios(ctx: ThemeCtx) {
  for (const q of ctx.board.closed) {
    if (q.id === 'regie') {
      const wall = ctx.grid(6, 12.25)
      const back = new THREE.Mesh(ctx.track(new THREE.BoxGeometry(2.35, 1.5, 0.22)), ctx.toon('#2b2545', { transparent: true, opacity: 0.6, depthWrite: false }))
      back.position.copy(wall).setY(0.75)
      const planes: THREE.BufferGeometry[] = []
      for (let i = 0; i < 12; i++) planes.push(new THREE.PlaneGeometry(0.5, 0.36).translate(wall.x - 0.81 + (i % 4) * 0.54, 0.38 + (2 - Math.floor(i / 4)) * 0.42, wall.z + 0.12))
      const mat = ctx.track(new THREE.MeshBasicMaterial({ color: '#4CC9F0', transparent: true, opacity: 0.7 }))
      const scr = new THREE.Mesh(ctx.track(mergeGeometries(planes)!), mat)
      planes.forEach((g) => g.dispose())
      ctx.scene.add(back, scr)
      // Les écrans clignotent (sans rien coûter : une couleur qui change).
      const blink = () => {
        const t = ctx.time()
        mat.color.setHSL((Math.floor(t * 1.5) * 0.17) % 1, 0.7, 0.6)
        mat.opacity = 0.45 + 0.3 * Math.abs(Math.sin(t * 2))
      }
      scr.onBeforeRender = blink
    } else if (q.id === 'coulisses') {
      const b = new Batch()
      for (const r of [1.5, 4, 6.5]) b.add(new THREE.BoxGeometry(0.9, 1.45, 0.1), '#f2d4b0', tr(ctx.grid(-4.5, r, 0.72)), 0)
      b.add(new THREE.BoxGeometry(0.1, 1.4, 1.6), '#f2d4b0', tr(ctx.grid(-5.6, 3, 0.7)), 0)
      ctx.scene.add(b.build(ctx, { shadow: false, mat: ctx.toon('#ffffff', { vertexColors: true, transparent: true, opacity: 0.35, depthWrite: false }) }))
    }
  }
}
