/** Textures dessinées au canvas pour le plateau 3D de Dédé Party (style sticker : aplats, contours épais). */
import * as THREE from 'three'
import { CELL_INFO, type CellType } from '../board'

export const INK = '#1f1b2e'
const FONT = '"Baloo 2","Nunito",system-ui,sans-serif'
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('canvas 2d indisponible')
  return [c, ctx]
}

function tex(c: HTMLCanvasElement, anisotropy = 1): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = anisotropy
  return t
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** Éclaircit (k > 0) ou assombrit (k < 0) une couleur hex. */
export function shade(hex: string, k: number): string {
  const c = new THREE.Color(hex)
  if (k >= 0) c.lerp(new THREE.Color('#ffffff'), k)
  else c.lerp(new THREE.Color('#1f1b2e'), -k)
  return `#${c.getHexString()}`
}

/** Dessus d'une case : couleur du type, liseré clair, gros emoji. */
export function makeCellTop(type: CellType, anisotropy: number): THREE.CanvasTexture {
  const S = 256
  const [c, ctx] = canvas(S, S)
  const info = CELL_INFO[type]
  roundRect(ctx, 6, 6, S - 12, S - 12, 54)
  ctx.fillStyle = info.color
  ctx.fill()
  // Reflet « autocollant » en haut à gauche.
  ctx.save()
  ctx.clip()
  ctx.fillStyle = shade(info.color, 0.28)
  ctx.beginPath()
  ctx.ellipse(70, 40, 190, 80, -0.5, 0, Math.PI * 2)
  ctx.fill()
  if (type === 'start') {
    // Damier d'arrivée discret.
    ctx.fillStyle = 'rgba(31,27,46,0.16)'
    for (let i = 0; i < 8; i++) for (let j = 0; j < 2; j++) if ((i + j) % 2 === 0) ctx.fillRect(i * 32, S - 64 + j * 32, 32, 32)
  }
  ctx.restore()
  roundRect(ctx, 16, 16, S - 32, S - 32, 46)
  // Case très claire (verglas) : liseré intérieur encre plutôt que blanc, sinon il disparaît.
  ctx.strokeStyle = new THREE.Color(info.color).getHSL({ h: 0, s: 0, l: 0 }).l > 0.85 ? 'rgba(31,27,46,0.35)' : 'rgba(255,255,255,0.55)'
  ctx.lineWidth = 7
  ctx.stroke()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  // Départ et Halte (ponton, gare) : l'émoji en haut, le mot en dessous.
  const word = type === 'start' ? 'DÉPART' : type === 'halt' ? 'HALTE' : null
  ctx.font = `${word ? 118 : 138}px ${EMOJI_FONT}`
  ctx.fillText(info.emoji, S / 2, word ? 104 : 138)
  if (word) {
    ctx.font = `800 46px ${FONT}`
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#fff6e5'
    ctx.lineWidth = 10
    ctx.strokeText(word, S / 2, 204)
    ctx.fillStyle = INK
    ctx.fillText(word, S / 2, 204)
  }
  return tex(c, anisotropy)
}

const PIPS: Record<number, Array<[number, number]>> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [0, 2], [2, 0], [2, 2]],
  5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]],
  6: [[0, 0], [0, 2], [1, 0], [1, 2], [2, 0], [2, 2]],
}

/** Face de dé (blanc, liseré encre, points). */
export function makeDieFace(v: number): THREE.CanvasTexture {
  const [c, ctx] = canvas(128, 128)
  ctx.fillStyle = INK
  ctx.fillRect(0, 0, 128, 128)
  roundRect(ctx, 7, 7, 114, 114, 22)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.fillStyle = v === 1 ? '#ef476f' : INK
  for (const [gx, gy] of PIPS[v]) {
    ctx.beginPath()
    ctx.arc(34 + gx * 30, 34 + gy * 30, v === 1 ? 18 : 12, 0, Math.PI * 2)
    ctx.fill()
  }
  return tex(c, 2)
}

/** Halo doux (étoile, poussière, pastille de lumière au sol). */
export function makeGlow(): THREE.CanvasTexture {
  const [c, ctx] = canvas(128, 128)
  const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 62)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.4, 'rgba(255,255,255,0.55)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  return tex(c)
}

/** Étincelle à 4 branches. */
export function makeSparkle(): THREE.CanvasTexture {
  const [c, ctx] = canvas(64, 64)
  ctx.translate(32, 32)
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  for (let i = 0; i < 8; i++) {
    const r = i % 2 === 0 ? 30 : 6
    const a = (i * Math.PI) / 4
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r)
  }
  ctx.closePath()
  ctx.fill()
  return tex(c)
}

/** Faisceau de projecteur : opaque à la source (haut de la texture), transparent au bout. */
export function makeBeam(): THREE.CanvasTexture {
  const [c, ctx] = canvas(8, 128)
  const g = ctx.createLinearGradient(0, 0, 0, 128)
  g.addColorStop(0, 'rgba(255,255,255,0.9)')
  g.addColorStop(0.6, 'rgba(255,255,255,0.3)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 8, 128)
  return tex(c)
}

/** Étiquette sticker (« +3 », « ⭐ »…) : renvoie la texture et son rapport largeur / hauteur. */
export function makeLabel(text: string, bg: string, fg = INK): { tex: THREE.CanvasTexture; aspect: number } {
  const H = 112
  const [m, mctx] = canvas(8, 8)
  void m
  mctx.font = `800 70px ${FONT},${EMOJI_FONT}`
  const tw = Math.ceil(mctx.measureText(text).width)
  const W = Math.max(H, tw + 64)
  const [c, ctx] = canvas(W, H)
  roundRect(ctx, 5, 5, W - 10, H - 10, 34)
  ctx.fillStyle = INK
  ctx.fill()
  roundRect(ctx, 13, 11, W - 26, H - 28, 28)
  ctx.fillStyle = bg
  ctx.fill()
  ctx.font = `800 70px ${FONT},${EMOJI_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = fg
  ctx.fillText(text, W / 2, H / 2 - 2)
  return { tex: tex(c), aspect: W / H }
}

/** Enseigne néon « DÉDÉ PARTY » (panneau sombre, lettres lumineuses, ampoules). */
export function makeNeon(): THREE.CanvasTexture {
  const W = 1024
  const H = 320
  const [c, ctx] = canvas(W, H)
  roundRect(ctx, 6, 6, W - 12, H - 12, 60)
  ctx.fillStyle = INK
  ctx.fill()
  roundRect(ctx, 24, 24, W - 48, H - 48, 46)
  ctx.fillStyle = '#3a1e6e'
  ctx.fill()
  // Ampoules du pourtour.
  const bulbs = 34
  for (let i = 0; i < bulbs; i++) {
    const t = i / bulbs
    const per = 2 * (W - 96 + H - 96)
    let d = t * per
    let x = 48
    let y = 48
    if (d < W - 96) x += d
    else if ((d -= W - 96) < H - 96) { x = W - 48; y += d }
    else if ((d -= H - 96) < W - 96) { x = W - 48 - d; y = H - 48 }
    else { d -= W - 96; y = H - 48 - d }
    ctx.fillStyle = i % 2 === 0 ? '#FFD166' : '#fff6e5'
    ctx.beginPath()
    ctx.arc(x, y, 11, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `800 168px ${FONT}`
  ctx.lineJoin = 'round'
  ctx.shadowColor = '#ff5fa2'
  ctx.shadowBlur = 36
  ctx.strokeStyle = '#ff5fa2'
  ctx.lineWidth = 20
  ctx.strokeText('DÉDÉ PARTY', W / 2, H / 2 + 8)
  ctx.shadowBlur = 0
  ctx.fillStyle = '#fff6e5'
  ctx.fillText('DÉDÉ PARTY', W / 2, H / 2 + 8)
  return tex(c, 4)
}

/** Petit panneau de zone (« LA SCÈNE », « TUNNEL DE LA PUB »). */
export function makePlate(text: string, bg: string): { tex: THREE.CanvasTexture; aspect: number } {
  const H = 128
  const [, mctx] = canvas(8, 8)
  mctx.font = `800 62px ${FONT},${EMOJI_FONT}`
  const W = Math.ceil(mctx.measureText(text).width) + 80
  const [c, ctx] = canvas(W, H)
  roundRect(ctx, 4, 4, W - 8, H - 8, 30)
  ctx.fillStyle = INK
  ctx.fill()
  roundRect(ctx, 14, 14, W - 28, H - 28, 22)
  ctx.fillStyle = bg
  ctx.fill()
  ctx.font = `800 62px ${FONT},${EMOJI_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = INK
  ctx.fillText(text, W / 2, H / 2 + 2)
  return { tex: tex(c, 4), aspect: W / H }
}

/** Un gros emoji seul sur fond transparent (sprite : Riton…). */
export function makeEmoji(emoji: string, size = 128): THREE.CanvasTexture {
  const [c, ctx] = canvas(size, size)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `${Math.round(size * 0.82)}px ${EMOJI_FONT}`
  ctx.fillText(emoji, size / 2, size / 2 + size * 0.04)
  return tex(c, 2)
}

/** Écran de la télé du Tunnel de la pub. */
export function makePubScreen(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 192)
  const cols = ['#EF476F', '#FFD166', '#06D6A0', '#4CC9F0', '#8B5CF6']
  cols.forEach((col, i) => {
    ctx.fillStyle = col
    ctx.fillRect((i * 256) / cols.length, 0, 256 / cols.length + 1, 192)
  })
  ctx.fillStyle = 'rgba(31,27,46,0.82)'
  roundRect(ctx, 34, 52, 188, 88, 22)
  ctx.fill()
  ctx.font = `800 78px ${FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#fff6e5'
  ctx.fillText('PUB', 128, 100)
  return tex(c, 2)
}

/** Tapis du plateau : aplat + semis de pois et d'étoiles (répété). */
export function makeCarpet(base: string, dot: string): THREE.CanvasTexture {
  const S = 256
  const [c, ctx] = canvas(S, S)
  ctx.fillStyle = base
  ctx.fillRect(0, 0, S, S)
  ctx.fillStyle = dot
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const x = i * 64 + (j % 2 === 0 ? 16 : 48)
      const y = j * 64 + 32
      ctx.beginPath()
      if ((i + j) % 3 === 0) {
        for (let k = 0; k < 10; k++) {
          const r = k % 2 === 0 ? 13 : 5.5
          const a = (k * Math.PI) / 5 - Math.PI / 2
          ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r)
        }
      } else ctx.arc(x, y, 6, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  const t = tex(c, 4)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

/** Sol du studio : anneaux concentriques (façon piste de plateau télé). */
export function makeFloor(a: string, b: string): THREE.CanvasTexture {
  const S = 512
  const [c, ctx] = canvas(S, S)
  ctx.fillStyle = a
  ctx.fillRect(0, 0, S, S)
  for (let r = 250; r > 0; r -= 42) {
    ctx.beginPath()
    ctx.arc(S / 2, S / 2, r, 0, Math.PI * 2)
    ctx.fillStyle = Math.round(r / 42) % 2 === 0 ? a : b
    ctx.fill()
  }
  return tex(c, 4)
}

/** Aplat à pois (chapeau de champignon, bâche…) : fond + pois clairs, répétable. */
export function makeDots(bg: string, dot: string, n = 5): THREE.CanvasTexture {
  const S = 128
  const [c, ctx] = canvas(S, S)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, S, S)
  ctx.fillStyle = dot
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < 2; j++) {
      const x = ((i + (j ? 0.5 : 0)) / n) * S
      const y = (j ? 0.68 : 0.25) * S
      ctx.beginPath()
      ctx.arc(x, y, S * 0.075, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  const t = tex(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

/** Écran de régie : fond coloré, liseré, gros emoji au centre. */
export function makeScreen(emoji: string, bg: string): THREE.CanvasTexture {
  const W = 128
  const H = 96
  const [c, ctx] = canvas(W, H)
  ctx.fillStyle = INK
  ctx.fillRect(0, 0, W, H)
  roundRect(ctx, 7, 7, W - 14, H - 14, 12)
  ctx.fillStyle = bg
  ctx.fill()
  ctx.fillStyle = 'rgba(255,255,255,0.18)'
  for (let y = 10; y < H - 10; y += 6) ctx.fillRect(9, y, W - 18, 2)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `56px ${EMOJI_FONT}`
  ctx.fillText(emoji, W / 2, H / 2 + 3)
  return tex(c)
}
