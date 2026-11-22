import { accentColorOf, chibiUrl } from '@/data/characters'
import { hasTenueArt, tenueArtDir } from '@/components/ui/tenueArt'
import { DEFAULT_TENUE } from '@/data/tenues'

/**
 * Boîte à outils commune des images partageables dessinées sur canvas (récap, photo souvenir, Mon année).
 * Les chibis sont servis par notre propre origine : pas de canvas « taché » (tainted).
 */
export const INK = '#1f1b2e'
export const FONT = '"Baloo 2", "Fredoka", ui-rounded, system-ui, sans-serif'

/** Charge une image ; `null` si elle manque (on dessine alors un repli). Délai maxi pour ne jamais bloquer. */
export function loadImage(src: string, timeoutMs = 8000): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    const t = window.setTimeout(() => resolve(null), timeoutMs)
    img.onload = () => {
      window.clearTimeout(t)
      resolve(img)
    }
    img.onerror = () => {
      window.clearTimeout(t)
      resolve(null)
    }
    img.src = src
  })
}

export const chibiSrc = (slug: string, tenue: string, expression = 'joie') => {
  const ok = tenue !== DEFAULT_TENUE && hasTenueArt(slug, tenue)
  return chibiUrl(slug, expression, ok ? (tenueArtDir(tenue, slug) ?? 'default') : 'default', true)
}

/** Charge le chibi ; si la tenue manque, retente avec la tenue par défaut. */
export async function loadChibi(slug: string, tenue: string, expression = 'joie'): Promise<HTMLImageElement | null> {
  return (await loadImage(chibiSrc(slug, tenue, expression))) ?? (await loadImage(chibiUrl(slug, 'joie', 'default', true)))
}

export async function ensureFonts() {
  try {
    await document.fonts?.load(`800 40px "Baloo 2"`)
  } catch {
    /* police de repli */
  }
}

export function makeCanvas(w: number, h: number) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas')
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  return { canvas, ctx }
}

export function dotsBackground(ctx: CanvasRenderingContext2D, w: number, h: number, color = '#fff6e5') {
  ctx.fillStyle = color
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = 'rgba(31,27,46,0.07)'
  for (let y = 20; y < h; y += 40) for (let x = 20; x < w; x += 40) ctx.fillRect(x, y, 4, 4)
}

export function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  if (ctx.measureText(text).width <= maxW) return text
  let t = text
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1)
  return t + '…'
}

export function sticker(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string, shadow = 10) {
  ctx.fillStyle = INK
  ctx.beginPath()
  ctx.roundRect(x + shadow, y + shadow, w, h, r)
  ctx.fill()
  ctx.fillStyle = fill
  ctx.strokeStyle = INK
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
  ctx.fill()
  ctx.stroke()
}

/** Chibi dans un disque (centre cx,cy, rayon r). Image absente : initiale du pseudo sur la couleur du perso. */
export function avatarDisc(ctx: CanvasRenderingContext2D, img: HTMLImageElement | null, cx: number, cy: number, r: number, slug: string, nickname: string, bg = '#ffffff') {
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = img ? bg : accentColorOf(slug, '#ffb703')
  ctx.fill()
  ctx.clip()
  if (img) {
    const s = r * 2 * 1.05
    ctx.drawImage(img, cx - s / 2, cy - s / 2 + r * 0.05, s, s)
  } else {
    ctx.fillStyle = INK
    ctx.textAlign = 'center'
    ctx.font = `800 ${Math.round(r * 1.1)}px ${FONT}`
    ctx.fillText((nickname || '?').slice(0, 1).toUpperCase(), cx, cy + r * 0.38)
  }
  ctx.restore()
  ctx.strokeStyle = INK
  ctx.lineWidth = Math.max(4, r / 9)
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.stroke()
}

/** Passe à la ligne un texte centré (max `maxLines` lignes). Renvoie la hauteur utilisée. */
export function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number, maxLines = 3) {
  const words = text.split(' ')
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w
    if (ctx.measureText(t).width > maxW && cur) {
      lines.push(cur)
      cur = w
    } else cur = t
  }
  if (cur) lines.push(cur)
  lines.slice(0, maxLines).forEach((l, i) => ctx.fillText(i === maxLines - 1 && lines.length > maxLines ? fit(ctx, l + '…', maxW) : l, x, y + i * lineH))
  return Math.min(lines.length, maxLines) * lineH
}

export const canvasToBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/png'))

/** Partage l'image (feuille de partage native avec fichier) sinon la télécharge. */
export async function shareImage(blob: Blob, filename: string, title: string, text: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], filename, { type: 'image/png' })
  if (typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title, text })
      return 'shared'
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
      // partage refusé : on retombe sur le téléchargement
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return 'downloaded'
}
