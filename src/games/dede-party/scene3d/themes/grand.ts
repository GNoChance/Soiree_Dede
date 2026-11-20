/** 🎤 Le Grand Plateau de Dédé : rideaux rouges à lambrequin doré, néons « DÉDÉ PARTY », La Scène et la télé du Tunnel de la pub. */
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { makeNeon, makePlate, makePubScreen } from '../textures'
import type { ThemeDef } from './types'

const GOLD = '#FFD23F'

export const grandTheme: ThemeDef = {
  palette: {
    light: { bg: '#fff0d6', floorA: '#ffc98a', floorB: '#ffb86b', carpet: '#fff8ec', carpetDot: '#ffe2b8', road: '#fff6e5', sky: '#ffffff', ground: '#ffd9a8', hemi: 1.25, sun: 1.55, beam: 0.09, curtain: '#d62839' },
    dark: { bg: '#15122b', floorA: '#221a4d', floorB: '#2b2160', carpet: '#33297a', carpetDot: '#42379a', road: '#fff6e5', sky: '#b9a8ff', ground: '#2a1f5c', hemi: 0.95, sun: 1.25, beam: 0.34, curtain: '#a4133c' },
  },
  stageColors: ['#8B5CF6', '#FF8FA3', '#FFD166'],
  build(ctx) {
    const { scene, zWall, xWall, halfX, halfZ } = ctx
    // Lambrequins et galons dorés au-dessus des rideaux.
    const lenA = xWall + halfX + 7
    const lenB = halfZ + 6 - zWall
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
    scene.add(valA, trimA, valB, trimB)

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
    scene.add(stage)
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
    scene.add(tv)
    const p2 = makePlate('📺 Tunnel de la pub', '#FF8FA3')
    const plate2 = ctx.sprite(ctx.track(p2.tex), { depthTest: false })
    plate2.scale.set(0.58 * p2.aspect, 0.58, 1)
    plate2.position.set(tv.position.x, 2.25, tv.position.z)
    plate2.renderOrder = 5
    scene.add(plate2)

    return {
      update() {
        const t = ctx.time()
        neons.forEach((n, i) => n.color.setScalar(0.88 + 0.12 * Math.sin(t * 5 + i * 2)))
        pubMat.color.setHSL((t * 0.25) % 1, 0.35, 0.8)
      },
    }
  },
}
