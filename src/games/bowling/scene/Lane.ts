/**
 * Décor 3D « sticker book » : piste en bois clair avec flèches colorées,
 * gouttières, quilles stylisées (bandes tomate, contour encre), boule aux
 * couleurs du joueur, fond de piste façon autocollant. Géométries simples,
 * matériaux toon partagés ; tout est libéré par dispose().
 */
import * as THREE from 'three'
import {
  BACK_WALL_Z, BALL_R, DECK_END, GUTTER_DEPTH, GUTTER_W, LANE_HALF, LANE_LEN, PIN_COM, PIN_SPOTS, PIT_FLOOR_Y,
} from './physics'

const INK = '#1f1b2e'
const NEAR_Z = 1.5
const PALETTE = { sun: '#ffb703', tangerine: '#fb8500', tomato: '#ef476f', bubblegum: '#ff8fa3', mint: '#06d6a0', sky: '#4cc9f0', grape: '#8b5cf6', lime: '#b5e61d' }

export interface LaneView {
  root: THREE.Group
  ball: THREE.Group
  pins: THREE.Object3D[]
  /** Points de visée (aperçu du geste). */
  setGuide: (pts: Array<[number, number]> | null) => void
  dispose: () => void
}

/** Profil d'une quille (rayon, hauteur) — 38 cm. */
const PIN_PROFILE: Array<[number, number]> = [
  [0.0, 0.0], [0.026, 0.0], [0.034, 0.012], [0.046, 0.04], [0.057, 0.085], [0.061, 0.12], [0.058, 0.155],
  [0.047, 0.2], [0.032, 0.24], [0.023, 0.268], [0.024, 0.29], [0.031, 0.318], [0.033, 0.338],
  [0.028, 0.36], [0.017, 0.375], [0.0, 0.38],
]
const STRIPES: Array<[number, number]> = [[0.236, 0.248], [0.256, 0.266]]

function radiusAt(y: number) {
  for (let i = 1; i < PIN_PROFILE.length; i++) {
    const [r0, y0] = PIN_PROFILE[i - 1]
    const [r1, y1] = PIN_PROFILE[i]
    if (y >= y0 && y <= y1) return y1 === y0 ? r1 : r0 + ((r1 - r0) * (y - y0)) / (y1 - y0)
  }
  return 0
}

function pinGeometry(): THREE.BufferGeometry {
  const ys = new Set<number>(PIN_PROFILE.map(([, y]) => y))
  for (const [a, b] of STRIPES) for (const y of [a - 0.001, a, b, b + 0.001]) ys.add(y)
  const sorted = [...ys].sort((a, b) => a - b)
  const pts = sorted.map((y) => new THREE.Vector2(y === 0 || y === 0.38 ? 0 : radiusAt(y), y))
  // Doubler les extrémités pour un fond plat net
  pts.splice(1, 0, new THREE.Vector2(PIN_PROFILE[1][0], 0))
  const geo = new THREE.LatheGeometry(pts, 16)
  const pos = geo.getAttribute('position')
  const colors = new Float32Array(pos.count * 3)
  const white = new THREE.Color('#fffaf0')
  const red = new THREE.Color(PALETTE.tomato)
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i)
    const c = STRIPES.some(([a, b]) => y >= a - 1e-4 && y <= b + 1e-4) ? red : white
    colors.set([c.r, c.g, c.b], i * 3)
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.translate(0, -PIN_COM, 0)
  geo.computeVertexNormals()
  return geo
}

/** Contour « encre » : coque inversée gonflée le long des normales (épaisseur ~constante à l'écran). */
function outlineMaterial(color = INK, thickness = 0.0028, maxWorld = 0.012) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, thickness: { value: thickness }, maxWorld: { value: maxWorld } },
    vertexShader: /* glsl */ `
      uniform float thickness;
      uniform float maxWorld;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * normal);
        mv.xyz += n * min(thickness * -mv.z, maxWorld);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      void main() { gl_FragColor = vec4(color, 1.0); }`,
    side: THREE.BackSide,
  })
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, aniso = 4) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  draw(g)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = aniso
  return t
}

function laneTexture(): THREE.CanvasTexture {
  const W = 256
  const H = 2048
  const total = NEAR_Z - DECK_END
  const yOf = (z: number) => ((z - DECK_END) / total) * H
  return canvasTexture(W, H, (g) => {
    // Lattes de bois
    const boards = 13
    for (let i = 0; i < boards; i++) {
      g.fillStyle = i % 2 ? '#ffd796' : '#ffe2ae'
      g.fillRect((i * W) / boards, 0, W / boards + 1, H)
      g.fillStyle = 'rgba(160, 100, 40, 0.10)'
      for (let k = 0; k < 14; k++) g.fillRect((i * W) / boards + ((k * 7) % 17), (k * 241 + i * 97) % H, 1.5, 60 + ((k * 53) % 90))
    }
    // Plateau des quilles (plus clair) + emplacements
    g.fillStyle = 'rgba(255,255,255,0.35)'
    g.fillRect(0, 0, W, yOf(-LANE_LEN + 0.45))
    for (const [x, z] of PIN_SPOTS) {
      g.beginPath()
      g.arc(((x + LANE_HALF) / (2 * LANE_HALF)) * W, yOf(z), 4, 0, Math.PI * 2)
      g.fillStyle = 'rgba(31,27,46,0.35)'
      g.fill()
    }
    // Ligne de faute
    g.fillStyle = INK
    g.fillRect(0, yOf(0) - 5, W, 10)
    // Points de visée (2 m) et flèches (4,5 m)
    const colors = [PALETTE.tomato, PALETTE.sun, PALETTE.mint, PALETTE.grape, PALETTE.mint, PALETTE.sun, PALETTE.tomato]
    for (let i = 0; i < 7; i++) {
      const cx = ((i + 1) * W) / 8
      g.beginPath()
      g.arc(cx, yOf(-2), 5, 0, Math.PI * 2)
      g.fillStyle = INK
      g.fill()
      const cy = yOf(-4.5) + Math.abs(i - 3) * 22
      g.beginPath()
      g.moveTo(cx, cy - 34)
      g.lineTo(cx - 11, cy + 14)
      g.lineTo(cx + 11, cy + 14)
      g.closePath()
      g.fillStyle = colors[i]
      g.fill()
      g.lineWidth = 3.5
      g.strokeStyle = INK
      g.stroke()
    }
    // Étoiles déco sur l'approche
    g.font = 'bold 34px sans-serif'
    g.textAlign = 'center'
    g.fillStyle = PALETTE.tangerine
    g.fillText('★', W / 2, yOf(0.8))
    // Bords de piste
    g.fillStyle = INK
    g.fillRect(0, 0, 4, H)
    g.fillRect(W - 4, 0, 4, H)
  }, 8)
}

function bannerTexture(): THREE.CanvasTexture {
  return canvasTexture(512, 256, (g) => {
    g.fillStyle = PALETTE.tomato
    g.fillRect(0, 0, 512, 256)
    // pois
    g.fillStyle = 'rgba(255,255,255,0.18)'
    for (let y = 0; y < 256; y += 32) for (let x = (y / 32) % 2 ? 16 : 0; x < 512; x += 32) {
      g.beginPath()
      g.arc(x, y, 5, 0, Math.PI * 2)
      g.fill()
    }
    // bandeau sticker
    g.save()
    g.translate(256, 128)
    g.rotate(-0.06)
    g.fillStyle = INK
    roundRect(g, -214, -62, 440, 128, 34)
    g.fill()
    g.fillStyle = PALETTE.sun
    roundRect(g, -220, -70, 440, 128, 34)
    g.fill()
    g.lineWidth = 7
    g.strokeStyle = INK
    g.stroke()
    g.fillStyle = INK
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = '800 64px "Baloo 2", "Fredoka", system-ui, sans-serif'
    g.fillText('DÉDÉ BOWL', 0, -14)
    g.font = '800 30px "Baloo 2", system-ui, sans-serif'
    g.fillText('★ STRIKE ZONE ★', 0, 34)
    g.restore()
  })
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath()
  g.moveTo(x + r, y)
  g.arcTo(x + w, y, x + w, y + h, r)
  g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r)
  g.arcTo(x, y, x + w, y, r)
  g.closePath()
}

function stripeTexture(a: string, b: string): THREE.CanvasTexture {
  const t = canvasTexture(64, 64, (g) => {
    g.fillStyle = a
    g.fillRect(0, 0, 64, 64)
    g.fillStyle = b
    for (let i = -64; i < 128; i += 32) {
      g.beginPath()
      g.moveTo(i, 0)
      g.lineTo(i + 16, 0)
      g.lineTo(i + 16 + 64, 64)
      g.lineTo(i + 64, 64)
      g.closePath()
      g.fill()
    }
  })
  t.wrapS = THREE.RepeatWrapping
  t.wrapT = THREE.RepeatWrapping
  return t
}

export function buildLane(opts: { ballColor: string; ballStyle?: 'noel'; dark: boolean }): LaneView {
  const noel = opts.ballStyle === 'noel'
  const disposables: Array<{ dispose: () => void }> = []
  const keep = <T extends { dispose: () => void }>(x: T) => {
    disposables.push(x)
    return x
  }

  // Dégradé toon 3 tons
  const grad = keep(new THREE.DataTexture(new Uint8Array([110, 190, 255]), 3, 1, THREE.RedFormat))
  grad.minFilter = THREE.NearestFilter
  grad.magFilter = THREE.NearestFilter
  grad.generateMipmaps = false
  grad.needsUpdate = true
  const toon = (p: THREE.MeshToonMaterialParameters) => keep(new THREE.MeshToonMaterial({ gradientMap: grad, ...p }))

  const root = new THREE.Group()
  const total = NEAR_Z - DECK_END
  const zMid = (NEAR_Z + DECK_END) / 2

  // ---------------------------------------------------------------- piste
  const laneMat = toon({ map: keep(laneTexture()) })
  const laneGeo = keep(new THREE.PlaneGeometry(LANE_HALF * 2, total))
  const lane = new THREE.Mesh(laneGeo, laneMat)
  lane.rotation.x = -Math.PI / 2
  lane.position.set(0, 0, zMid)
  lane.receiveShadow = true
  root.add(lane)

  // Gouttières (creux arrondi simulé : fond + 2 pentes)
  const gutterMat = toon({ color: opts.dark ? '#5b4bb0' : '#b9a6ff' })
  const edgeMat = toon({ color: PALETTE.grape })
  const gutterGeo = keep(new THREE.BoxGeometry(GUTTER_W, 0.02, total))
  const capGeo = keep(new THREE.BoxGeometry(0.06, 0.12, total))
  for (const s of [-1, 1]) {
    const g = new THREE.Mesh(gutterGeo, gutterMat)
    g.position.set(s * (LANE_HALF + GUTTER_W / 2), -GUTTER_DEPTH - 0.01, zMid)
    g.receiveShadow = true
    root.add(g)
    const cap = new THREE.Mesh(capGeo, edgeMat)
    cap.position.set(s * (LANE_HALF + GUTTER_W + 0.03), 0.0, zMid)
    root.add(cap)
  }

  // Parois rayées autour du plateau
  const kickTex = keep(stripeTexture(PALETTE.sky, '#ffffff'))
  kickTex.repeat.set(6, 2)
  const kickMat = toon({ color: '#ffffff', map: kickTex })
  const kickGeo = keep(new THREE.BoxGeometry(0.1, 0.9, 3.2))
  for (const s of [-1, 1]) {
    const k = new THREE.Mesh(kickGeo, kickMat)
    k.position.set(s * (LANE_HALF + GUTTER_W + 0.05), 0.35, -LANE_LEN - 0.4)
    root.add(k)
  }

  // Fosse + rideau + panneau du fond
  const pitMat = toon({ color: '#2a2458' })
  const pitW = 2 * (LANE_HALF + GUTTER_W + 0.1)
  const pitGeo = keep(new THREE.BoxGeometry(pitW, 0.05, DECK_END - BACK_WALL_Z + 0.4))
  const pit = new THREE.Mesh(pitGeo, pitMat)
  pit.position.set(0, PIT_FLOOR_Y, (DECK_END + BACK_WALL_Z) / 2)
  root.add(pit)
  const curtainGeo = keep(new THREE.PlaneGeometry(pitW, 1.4))
  const curtain = new THREE.Mesh(curtainGeo, toon({ color: '#1f1b2e' }))
  curtain.position.set(0, 0.2, BACK_WALL_Z)
  root.add(curtain)
  const bannerGeo = keep(new THREE.PlaneGeometry(2.6, 1.3))
  const banner = new THREE.Mesh(bannerGeo, keep(new THREE.MeshBasicMaterial({ map: keep(bannerTexture()) })))
  banner.position.set(0, 1.55, BACK_WALL_Z + 0.05)
  root.add(banner)
  const maskGeo = keep(new THREE.BoxGeometry(pitW + 0.4, 0.12, 0.6))
  const mask = new THREE.Mesh(maskGeo, toon({ color: PALETTE.sun }))
  mask.position.set(0, 0.85, BACK_WALL_Z + 0.4)
  root.add(mask)

  // Grand mur du fond (pois façon autocollant) qui remplit le ciel
  const wallTex = keep(canvasTexture(256, 256, (g) => {
    g.fillStyle = opts.dark ? '#2a2458' : '#ffd166'
    g.fillRect(0, 0, 256, 256)
    const dots = [PALETTE.tomato, PALETTE.sky, PALETTE.mint, PALETTE.grape]
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      g.beginPath()
      g.arc(x * 64 + (y % 2 ? 32 : 0) + 16, y * 64 + 32, 11, 0, Math.PI * 2)
      g.fillStyle = dots[(x + y) % 4]
      g.globalAlpha = opts.dark ? 0.55 : 0.8
      g.fill()
    }
    g.globalAlpha = 1
  }))
  wallTex.wrapS = THREE.RepeatWrapping
  wallTex.wrapT = THREE.RepeatWrapping
  wallTex.repeat.set(10, 3)
  const wallGeo = keep(new THREE.PlaneGeometry(24, 7))
  const wall = new THREE.Mesh(wallGeo, keep(new THREE.MeshBasicMaterial({ map: wallTex, fog: false })))
  wall.position.set(0, 3.2, BACK_WALL_Z - 0.3)
  root.add(wall)
  // Frise encre + bandeau tomate au pied du mur
  const friezeGeo = keep(new THREE.PlaneGeometry(24, 0.5))
  const frieze = new THREE.Mesh(friezeGeo, keep(new THREE.MeshBasicMaterial({ color: PALETTE.tomato, fog: false })))
  frieze.position.set(0, 0.95, BACK_WALL_Z - 0.28)
  root.add(frieze)

  // Pistes voisines (décor) + séparateurs
  const sideLaneMat = toon({ map: laneMat.map, color: opts.dark ? '#b8a8d8' : '#f3e6d0' })
  const sepMat = toon({ color: PALETTE.mint })
  const sepGeo = keep(new THREE.BoxGeometry(0.5, 0.16, total))
  const pitch = 2 * (LANE_HALF + GUTTER_W + 0.06) + 0.5
  for (const s of [-1, 1]) {
    for (const k of [1, 2]) {
      const sl = new THREE.Mesh(laneGeo, sideLaneMat)
      sl.rotation.x = -Math.PI / 2
      sl.position.set(s * k * pitch, -0.002, zMid)
      root.add(sl)
      const sep = new THREE.Mesh(sepGeo, k === 1 ? sepMat : edgeMat)
      sep.position.set(s * (k - 0.5) * pitch, 0.02, zMid)
      root.add(sep)
    }
  }
  // Sol de la salle
  const floorGeo = keep(new THREE.PlaneGeometry(40, 60))
  const floor = new THREE.Mesh(floorGeo, toon({ color: opts.dark ? '#211c45' : '#ffe9bf' }))
  floor.rotation.x = -Math.PI / 2
  floor.position.set(0, -0.12, -10)
  root.add(floor)

  // ---------------------------------------------------------------- quilles
  const pinGeo = keep(pinGeometry())
  const pinMat = toon({ vertexColors: true })
  const outline = keep(outlineMaterial())
  const pins = PIN_SPOTS.map(() => {
    const g = new THREE.Group()
    const body = new THREE.Mesh(pinGeo, pinMat)
    body.castShadow = true
    g.add(body)
    g.add(new THREE.Mesh(pinGeo, outline))
    root.add(g)
    return g
  })

  // ---------------------------------------------------------------- boule
  const ball = new THREE.Group()
  const ballGeo = keep(new THREE.SphereGeometry(BALL_R, 28, 18))
  const ballMesh = new THREE.Mesh(ballGeo, toon({ color: noel ? '#C1121F' : opts.ballColor }))
  ballMesh.castShadow = true
  ball.add(ballMesh)
  ball.add(new THREE.Mesh(ballGeo, outline))
  // Bande décorative + trous
  const bandGeo = keep(new THREE.TorusGeometry(BALL_R * 0.995, noel ? 0.012 : 0.007, 6, 40))
  const band = new THREE.Mesh(bandGeo, toon({ color: noel ? '#FFC93C' : '#ffffff' }))
  band.rotation.y = Math.PI / 2
  ball.add(band)
  if (noel) {
    // boule de Noël (cadeau de l'Avent) : 2e bande dorée croisée
    const band2 = new THREE.Mesh(bandGeo, toon({ color: '#FFC93C' }))
    ball.add(band2)
  }
  const holeGeo = keep(new THREE.CircleGeometry(0.013, 12))
  const holeMat = keep(new THREE.MeshBasicMaterial({ color: INK }))
  for (const [a, b, s] of [[0.35, 0.25, 1], [0.55, 0.1, 1], [0.52, 0.42, 1.2]] as const) {
    const h = new THREE.Mesh(holeGeo, holeMat)
    const dir = new THREE.Vector3(Math.sin(a) * Math.cos(b), Math.cos(a), Math.sin(a) * Math.sin(b)).normalize()
    h.position.copy(dir).multiplyScalar(BALL_R * 1.002)
    h.lookAt(dir.clone().multiplyScalar(2))
    h.scale.setScalar(s)
    ball.add(h)
  }
  root.add(ball)

  // ---------------------------------------------------------------- aperçu de visée
  const guide = new THREE.Group()
  const dotGeo = keep(new THREE.CircleGeometry(0.025, 10))
  const dotMat = keep(new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false }))
  const dotInk = keep(new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0.6, depthWrite: false }))
  const DOTS = 18
  for (let i = 0; i < DOTS; i++) {
    const d = new THREE.Mesh(dotGeo, i % 2 ? dotMat : dotInk)
    d.rotation.x = -Math.PI / 2
    d.visible = false
    guide.add(d)
  }
  root.add(guide)

  const setGuide = (pts: Array<[number, number]> | null) => {
    guide.children.forEach((d, i) => {
      const p = pts?.[i]
      d.visible = !!p
      if (p) d.position.set(p[0], 0.004, p[1])
    })
  }

  return {
    root,
    ball,
    pins,
    setGuide,
    dispose: () => {
      for (const d of disposables) d.dispose()
      disposables.length = 0
    },
  }
}
