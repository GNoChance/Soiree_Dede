import { chibiUrl } from '@/data/characters'
import { getGame } from '@/games/registry'
import { hasTenueArt, tenueArtDir } from '@/components/ui/tenueArt'
import { DEFAULT_TENUE } from '@/data/tenues'
import { fmtDuration } from '@/features/stats/api'
import type { SoireeRecap } from './api'
import { buildAwards } from './cards'

/**
 * Image « story » (1080x1920) du récap, dessinée à la main sur un canvas
 * (aucune dépendance). Les chibis sont servis par notre propre origine : pas de
 * canvas « taché » (tainted).
 */
const W = 1080
const H = 1920
const INK = '#1f1b2e'
const FONT = '"Baloo 2", "Fredoka", ui-rounded, system-ui, sans-serif'

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

const chibiSrc = (slug: string, tenue: string) => {
  const ok = tenue !== DEFAULT_TENUE && hasTenueArt(slug, tenue)
  return chibiUrl(slug, 'joie', ok ? (tenueArtDir(tenue, slug) ?? 'default') : 'default', true)
}

function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  if (ctx.measureText(text).width <= maxW) return text
  let t = text
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1)
  return t + '…'
}

function sticker(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string, shadow = 10) {
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

export async function renderRecapImage(r: SoireeRecap): Promise<Blob> {
  try {
    await document.fonts?.load(`800 40px "Baloo 2"`)
  } catch {
    /* police de repli */
  }
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas')
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'

  // fond
  ctx.fillStyle = '#fff6e5'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = 'rgba(31,27,46,0.07)'
  for (let y = 20; y < H; y += 40) for (let x = 20; x < W; x += 40) ctx.fillRect(x, y, 4, 4)

  // en-tête
  sticker(ctx, 60, 70, W - 130, 330, 48, '#ffb703')
  ctx.fillStyle = INK
  ctx.font = `800 96px ${FONT}`
  ctx.fillText('🎉 Récap de soirée', W / 2 - 5, 200)
  ctx.font = `700 44px ${FONT}`
  const date = r.ended_at ? new Date(r.ended_at).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) : ''
  ctx.fillText(date, W / 2 - 5, 275)
  ctx.font = `700 40px ${FONT}`
  ctx.fillText(`${fmtDuration(r.duration_min)} · ${r.games_played} partie${r.games_played > 1 ? 's' : ''} · ${r.players_count} joueur${r.players_count > 1 ? 's' : ''}`, W / 2 - 5, 340)

  // classement (6 premiers)
  const rows = r.standings.slice(0, 6)
  const imgs = await Promise.all(rows.map((s) => loadImage(chibiSrc(s.slug, s.equipped_tenue))))
  const medal: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' }
  const rowH = 132
  let y = 450
  rows.forEach((s, i) => {
    sticker(ctx, 60, y, W - 130, rowH - 22, 36, s.rank === 1 ? '#ffe08a' : '#ffffff', 8)
    ctx.textAlign = 'center'
    ctx.fillStyle = INK
    ctx.font = `800 52px ${FONT}`
    ctx.fillText(medal[s.rank] ?? String(s.rank), 130, y + 76)
    ctx.save()
    ctx.beginPath()
    ctx.arc(255, y + 44, 44, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.clip()
    const img = imgs[i]
    if (img) ctx.drawImage(img, 255 - 46, y + 44 - 40, 92, 92)
    ctx.restore()
    ctx.strokeStyle = INK
    ctx.lineWidth = 5
    ctx.beginPath()
    ctx.arc(255, y + 44, 44, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = INK
    ctx.textAlign = 'left'
    ctx.font = `800 50px ${FONT}`
    ctx.fillText(fit(ctx, s.nickname, 520), 335, y + 74)
    ctx.textAlign = 'right'
    ctx.fillText(`${s.points} pt${s.points > 1 ? 's' : ''}`, W - 110, y + 74)
    y += rowH
  })

  // awards (3 premiers)
  const awards = buildAwards(r).filter((a) => a.key !== 'star').slice(0, 3)
  y = Math.max(y + 30, 1290)
  if (awards.length) {
    ctx.textAlign = 'center'
    ctx.fillStyle = INK
    ctx.font = `800 56px ${FONT}`
    ctx.fillText('Les awards', W / 2, y)
    y += 30
    const fills: Record<string, string> = { 'bg-tangerine': '#fb8500', 'bg-lime': '#b5e61d', 'bg-sky': '#4cc9f0', 'bg-bubblegum': '#ff8fa3', 'bg-mint': '#06d6a0', 'bg-sun': '#ffb703' }
    for (const a of awards) {
      sticker(ctx, 60, y, W - 130, 118, 32, fills[a.bg] ?? '#ffb703', 8)
      ctx.fillStyle = INK
      ctx.textAlign = 'left'
      ctx.font = `800 40px ${FONT}`
      ctx.fillText(fit(ctx, `${a.emoji} ${a.title}`, W - 190), 95, y + 50)
      ctx.font = `700 38px ${FONT}`
      ctx.fillText(fit(ctx, `${a.who.map((w) => w.nickname).join(' & ')} · ${a.big}`, W - 190), 95, y + 96)
      y += 142
    }
  }

  // pied
  ctx.textAlign = 'center'
  ctx.fillStyle = INK
  ctx.font = `800 48px ${FONT}`
  const g = r.top_game ? getGame(r.top_game.game_id) : null
  if (g) ctx.fillText(`Jeu de la soirée : ${g.emoji} ${g.name}`, W / 2, H - 120)
  ctx.font = `700 36px ${FONT}`
  ctx.fillText('Soirées de Dédé', W / 2, H - 60)

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/png'))
}

/** Partage l'image (feuille de partage native avec fichier) sinon la télécharge. Renvoie 'shared' | 'downloaded' | 'cancelled'. */
export async function shareRecap(r: SoireeRecap): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const blob = await renderRecapImage(r)
  const file = new File([blob], 'recap-soiree.png', { type: 'image/png' })
  const text = 'Notre soirée en un coup d’œil ! 🎉'
  if (typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Récap de soirée', text })
      return 'shared'
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
      // partage refusé : on retombe sur le téléchargement
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'recap-soiree.png'
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return 'downloaded'
}
