/**
 * Textures canvas du plateau 3D : générées UNE fois (atlas du plateau, dos de
 * cartes, faces de dés, halo) ; la face de la carte piochée est redessinée à
 * chaque pioche dans la même texture.
 */
import * as THREE from 'three'
import { BOARD, DECK_NAMES, type BoardCell } from '../board'
import { BILL_STYLE, type Denom } from '../money'
import { BOARD_SIZE, cellBox, sideOf } from './layout'

export const ATLAS = 2048
export const PPU = ATLAS / BOARD_SIZE
const INK = '#1f1b2e'
const FONT = '"Baloo 2", "Fredoka", ui-rounded, system-ui, sans-serif'
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'

export const DECK_COLOR = { hasard: '#8B5CF6', potes: '#FF8FA3' } as const
export const DECK_EMOJI = { hasard: '❓', potes: '🍻' } as const

const SPECIAL_BG: Partial<Record<BoardCell['type'], string>> = {
  depart: '#ffd166',
  violon: '#a5d8f3',
  apero: '#c7ef7a',
  direction_violon: '#ff8a7a',
  hasard: '#cdb8fb',
  entre_potes: '#ffc2cf',
  taxe: '#ffd3cc',
  potes: '#a8ecd8',
  service: '#bfe3f7',
}
const SHORT: Partial<Record<BoardCell['type'], string>> = { depart: 'DÉPART', violon: 'VIOLON', apero: 'APÉRO' }

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
  ctx.roundRect(x, y, w, h, r)
}

/** Retour à la ligne : coupe aux espaces pour tenir dans `maxW`. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w
    if (ctx.measureText(t).width <= maxW || !cur) cur = t
    else {
      lines.push(cur)
      cur = w
    }
  }
  if (cur) lines.push(cur)
  return lines
}

/** Plus grande police (≤ max) qui fait tenir le texte dans la boîte. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxH: number, max: number, min: number, weight = 800) {
  for (let size = max; size >= min; size -= 2) {
    ctx.font = `${weight} ${size}px ${FONT}`
    const lines = wrap(ctx, text, maxW)
    if (lines.length * size * 1.05 <= maxH && lines.every((l) => ctx.measureText(l).width <= maxW)) return { size, lines }
  }
  ctx.font = `${weight} ${min}px ${FONT}`
  return { size: min, lines: wrap(ctx, text, maxW) }
}

function drawLines(ctx: CanvasRenderingContext2D, lines: string[], size: number, cx: number, cy: number) {
  const lh = size * 1.05
  const y0 = cy - ((lines.length - 1) * lh) / 2
  lines.forEach((l, k) => ctx.fillText(l, cx, y0 + k * lh))
}

function drawCell(ctx: CanvasRenderingContext2D, cell: BoardCell) {
  const b = cellBox(cell.i)
  const x = b.u * PPU
  const y = b.v * PPU
  const w = b.w * PPU
  const h = b.d * PPU
  const side = sideOf(cell.i)
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
  ctx.fillStyle = SPECIAL_BG[cell.type] ?? '#fff6e2'
  ctx.fillRect(x, y, w, h)

  let tx = x
  let ty = y
  let tw = w
  let th = h
  if (cell.type === 'quartier') {
    const bw = 0.32
    ctx.fillStyle = cell.color ?? '#999'
    if (side === 'bottom') {
      ctx.fillRect(x, y, w, h * bw)
      ty = y + h * bw
      th = h * (1 - bw)
    } else if (side === 'top') {
      ctx.fillRect(x, y + h * (1 - bw), w, h * bw)
      th = h * (1 - bw)
    } else if (side === 'left') {
      ctx.fillRect(x + w * (1 - bw), y, w * bw, h)
      tw = w * (1 - bw)
    } else {
      ctx.fillRect(x, y, w * bw, h)
      tx = x + w * bw
      tw = w * (1 - bw)
    }
    ctx.fillStyle = INK
    // filet entre bandeau et corps
    if (side === 'bottom') ctx.fillRect(x, ty - 3, w, 6)
    else if (side === 'top') ctx.fillRect(x, y + th - 3, w, 6)
    else if (side === 'left') ctx.fillRect(x + tw - 3, y, 6, h)
    else ctx.fillRect(tx - 3, y, 6, h)
  }

  const cx = tx + tw / 2
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = INK
  const corner = side === 'corner'
  if (cell.type === 'quartier') {
    const name = fitText(ctx, cell.name, tw - 14, th * 0.62, 34, 18)
    drawLines(ctx, name.lines, name.size, cx, ty + th * 0.38)
    ctx.font = `800 ${Math.min(40, th * 0.24)}px ${FONT}`
    ctx.fillText(`${cell.price} €`, cx, ty + th * 0.8)
  } else {
    const emojiSize = corner ? w * 0.42 : Math.min(tw, th) * 0.42
    ctx.font = `${emojiSize}px ${EMOJI_FONT}`
    ctx.fillText(cell.emoji ?? '', cx, ty + th * (corner ? 0.34 : 0.28))
    const label = SHORT[cell.type] ?? cell.name
    const box = fitText(ctx, label, tw - 14, th * (corner ? 0.34 : 0.4), corner ? 40 : 30, 16)
    drawLines(ctx, box.lines, box.size, cx, ty + th * (corner ? 0.76 : 0.68))
    if (cell.amount) {
      ctx.font = `800 ${corner ? 40 : 34}px ${FONT}`
      ctx.fillText(`−${cell.amount} €`, cx, ty + th * 0.92)
    }
  }
  ctx.restore()
  ctx.strokeStyle = INK
  ctx.lineWidth = 5
  ctx.strokeRect(x + 2.5, y + 2.5, w - 5, h - 5)
}

/** Atlas du plateau entier : cases + centre (même repère que les coordonnées monde). */
export function makeBoardAtlas(maxAniso: number): THREE.CanvasTexture {
  const [c, ctx] = canvas(ATLAS, ATLAS)
  // Centre : feutrine + titre + emplacements des tas
  const c0 = 1.5 * PPU
  const cs = 9 * PPU
  const g = ctx.createLinearGradient(c0, c0, c0 + cs, c0 + cs)
  g.addColorStop(0, '#2fb98f')
  g.addColorStop(1, '#2491a8')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, ATLAS, ATLAS)
  ctx.save()
  ctx.beginPath()
  ctx.rect(c0, c0, cs, cs)
  ctx.clip()
  ctx.strokeStyle = 'rgba(255,255,255,0.09)'
  ctx.lineWidth = 26
  for (let k = -cs; k < cs * 2; k += 110) {
    ctx.beginPath()
    ctx.moveTo(c0 + k, c0)
    ctx.lineTo(c0 + k + cs, c0 + cs)
    ctx.stroke()
  }
  ctx.restore()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const mx = ATLAS / 2
  ctx.lineJoin = 'round'
  ctx.font = `800 ${PPU * 0.78}px ${FONT}`
  ctx.lineWidth = 16
  ctx.strokeStyle = INK
  ctx.fillStyle = '#ffd166'
  ctx.strokeText('LE TOUR', mx, c0 + PPU * 1.05)
  ctx.fillText('LE TOUR', mx, c0 + PPU * 1.05)
  ctx.font = `800 ${PPU * 0.9}px ${FONT}`
  ctx.strokeText('DES POTES', mx, c0 + PPU * 1.95)
  ctx.fillText('DES POTES', mx, c0 + PPU * 1.95)
  // emplacements des tas
  const slot = (dx: number, label: string, color: string) => {
    const sx = mx + dx * PPU
    const sz = mx + 0.1 * PPU
    ctx.setLineDash([22, 16])
    ctx.lineWidth = 8
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'
    roundRect(ctx, sx - 1.1 * PPU, sz - 1.55 * PPU, 2.2 * PPU, 3.1 * PPU, 30)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = color
    ctx.font = `800 ${PPU * 0.3}px ${FONT}`
    ctx.fillText(label, sx, sz + 1.95 * PPU)
  }
  slot(-2.35, 'HASARD', '#e6dcff')
  slot(2.35, 'ENTRE POTES', '#ffe0e6')
  ctx.fillStyle = 'rgba(255,255,255,0.75)'
  ctx.font = `700 ${PPU * 0.28}px ${FONT}`
  ctx.fillText('Lancez les dés au centre', mx, c0 + cs - PPU * 0.55)
  for (const cell of BOARD) drawCell(ctx, cell)
  return tex(c, maxAniso)
}

/** Dos d'une carte (design maison : losanges + médaillon). */
export function makeCardBack(deck: 'hasard' | 'potes'): THREE.CanvasTexture {
  const W = 288
  const H = 400
  const [c, ctx] = canvas(W, H)
  const base = DECK_COLOR[deck]
  ctx.fillStyle = INK
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = base
  roundRect(ctx, 10, 10, W - 20, H - 20, 26)
  ctx.fill()
  ctx.save()
  roundRect(ctx, 22, 22, W - 44, H - 44, 18)
  ctx.clip()
  ctx.fillStyle = 'rgba(255,255,255,0.16)'
  for (let gy = 0; gy < H; gy += 40)
    for (let gx = 0; gx < W; gx += 40) {
      const ox = (gy / 40) % 2 ? 20 : 0
      ctx.beginPath()
      ctx.moveTo(gx + ox + 20, gy)
      ctx.lineTo(gx + ox + 36, gy + 20)
      ctx.lineTo(gx + ox + 20, gy + 40)
      ctx.lineTo(gx + ox + 4, gy + 20)
      ctx.fill()
    }
  ctx.restore()
  ctx.strokeStyle = '#fff6e2'
  ctx.lineWidth = 6
  roundRect(ctx, 22, 22, W - 44, H - 44, 18)
  ctx.stroke()
  ctx.fillStyle = '#fff6e2'
  ctx.strokeStyle = INK
  ctx.lineWidth = 8
  ctx.beginPath()
  ctx.arc(W / 2, H / 2, 84, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `86px ${EMOJI_FONT}`
  ctx.fillText(DECK_EMOJI[deck], W / 2, H / 2 + 4)
  ctx.fillStyle = '#fff6e2'
  ctx.strokeStyle = INK
  ctx.lineWidth = 7
  ctx.lineJoin = 'round'
  ctx.font = `800 34px ${FONT}`
  const name = DECK_NAMES[deck].toUpperCase()
  ctx.strokeText(name, W / 2, 62)
  ctx.fillText(name, W / 2, 62)
  ctx.save()
  ctx.translate(W / 2, H - 62)
  ctx.rotate(Math.PI)
  ctx.strokeText(name, 0, 0)
  ctx.fillText(name, 0, 0)
  ctx.restore()
  return tex(c, 4)
}

/** Tranche d'un tas : papier crème rayé. */
export function makeStackSide(): THREE.CanvasTexture {
  const [c, ctx] = canvas(8, 64)
  ctx.fillStyle = '#fff6e2'
  ctx.fillRect(0, 0, 8, 64)
  ctx.fillStyle = '#cdbf9c'
  for (let y = 0; y < 64; y += 6) ctx.fillRect(0, y, 8, 2)
  return tex(c)
}

export interface CardFaceInfo {
  deck: 'hasard' | 'potes'
  text: string
  /** Texte du montant (« +100 € ») ou null. */
  amountText: string | null
  positive: boolean
  extra: string | null
}

export function makeCardFace(): { texture: THREE.CanvasTexture; draw: (info: CardFaceInfo) => void } {
  const W = 512
  const H = 712
  const [c, ctx] = canvas(W, H)
  const texture = tex(c, 4)
  const draw = (info: CardFaceInfo) => {
    const color = DECK_COLOR[info.deck]
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = INK
    roundRect(ctx, 0, 0, W, H, 40)
    ctx.fill()
    ctx.fillStyle = '#fff6e2'
    roundRect(ctx, 12, 12, W - 24, H - 24, 30)
    ctx.fill()
    ctx.fillStyle = color
    ctx.save()
    roundRect(ctx, 12, 12, W - 24, H - 24, 30)
    ctx.clip()
    ctx.fillRect(12, 12, W - 24, 130)
    ctx.restore()
    ctx.fillStyle = INK
    ctx.fillRect(12, 140, W - 24, 6)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `70px ${EMOJI_FONT}`
    ctx.fillText(DECK_EMOJI[info.deck], 82, 80)
    ctx.fillStyle = INK
    ctx.font = `800 54px ${FONT}`
    ctx.fillText(DECK_NAMES[info.deck].toUpperCase(), W / 2 + 40, 80)
    const tall = info.amountText || info.extra
    const box = fitText(ctx, info.text, W - 90, tall ? 300 : 400, 50, 26, 700)
    drawLines(ctx, box.lines, box.size, W / 2, tall ? 300 : 345)
    if (info.amountText) {
      ctx.font = `800 62px ${FONT}`
      const tw = ctx.measureText(info.amountText).width + 56
      ctx.fillStyle = info.positive ? '#06d6a0' : '#ef476f'
      ctx.strokeStyle = INK
      ctx.lineWidth = 6
      roundRect(ctx, W / 2 - tw / 2, 536, tw, 92, 46)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = info.positive ? INK : '#fff'
      ctx.fillText(info.amountText, W / 2, 584)
    } else if (info.extra) {
      ctx.fillStyle = INK
      ctx.font = `800 40px ${FONT}`
      ctx.fillText(info.extra, W / 2, 590)
    }
    texture.needsUpdate = true
  }
  return { texture, draw }
}

/** Faces d'un dé (points), dans l'ordre des matériaux three : +x −x +y −y +z −z. */
export const DIE_FACE_ORDER = [3, 4, 1, 6, 2, 5] as const
const PIPS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
}
export function makeDieFaces(): THREE.CanvasTexture[] {
  return DIE_FACE_ORDER.map((v) => {
    const [c, ctx] = canvas(128, 128)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 128, 128)
    ctx.strokeStyle = '#d9d4e6'
    ctx.lineWidth = 8
    ctx.strokeRect(0, 0, 128, 128)
    ctx.fillStyle = v === 1 ? '#ef476f' : '#1f1b2e'
    for (const [gx, gy] of PIPS[v]) {
      ctx.beginPath()
      ctx.arc(32 + gx * 32, 32 + gy * 32, v === 1 ? 17 : 11, 0, Math.PI * 2)
      ctx.fill()
    }
    return tex(c, 2)
  })
}

/** Halo doux (pulsation du tas à piocher). */
export function makeGlow(): THREE.CanvasTexture {
  const [c, ctx] = canvas(128, 128)
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.55, 'rgba(255,255,255,0.55)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  return tex(c)
}

/** Petite pastille emoji (violon). */
export function makeEmojiTex(emoji: string): THREE.CanvasTexture {
  const [c, ctx] = canvas(96, 96)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `72px ${EMOJI_FONT}`
  ctx.fillText(emoji, 48, 52)
  return tex(c)
}

/** Face d'un billet maison (même dessin que le billet 2D : bande claire, pastille, valeur). */
export function makeBillTex(value: Denom): THREE.CanvasTexture {
  const W = 192
  const H = 108
  const [c, ctx] = canvas(W, H)
  const s = BILL_STYLE[value]
  ctx.fillStyle = INK
  ctx.fillRect(0, 0, W, H)
  roundRect(ctx, 8, 8, W - 16, H - 16, 14)
  ctx.fillStyle = s.bg
  ctx.fill()
  ctx.save()
  ctx.clip()
  ctx.fillStyle = s.light
  ctx.globalAlpha = 0.75
  ctx.translate(W * 0.72, H / 2)
  ctx.rotate(0.3)
  ctx.fillRect(-24, -H, 48, H * 2)
  ctx.restore()
  ctx.fillStyle = s.light
  ctx.beginPath()
  ctx.arc(W * 0.2, H / 2, 17, 0, Math.PI * 2)
  ctx.fill()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `800 ${value >= 100 ? 58 : 66}px ${FONT}`
  ctx.fillStyle = s.fg
  ctx.fillText(String(value), W / 2 + 4, H / 2 + 5)
  return tex(c)
}

/** Étiquette « Cagnotte : X € » posée derrière le tas (redessinée quand le montant change). */
export function makePotLabel(): { texture: THREE.CanvasTexture; draw: (text: string) => void } {
  const W = 512
  const H = 112
  const [c, ctx] = canvas(W, H)
  const texture = tex(c, 4)
  const draw = (text: string) => {
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = INK
    roundRect(ctx, 0, 0, W, H, 44)
    ctx.fill()
    ctx.fillStyle = '#fff8e7'
    roundRect(ctx, 9, 9, W - 18, H - 18, 36)
    ctx.fill()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = INK
    let size = 62
    do {
      ctx.font = `800 ${size}px ${FONT}`
      size -= 3
    } while (ctx.measureText(text).width > W - 56 && size > 28)
    ctx.fillText(text, W / 2, H / 2 + 5)
    texture.needsUpdate = true
  }
  draw('')
  return { texture, draw }
}
