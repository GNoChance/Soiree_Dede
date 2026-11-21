import { getGame } from '@/games/registry'
import { fmtDuration } from '@/features/stats/api'
import type { SoireeRecap } from './api'
import { buildAwards } from './cards'
import { INK, FONT, avatarDisc, canvasToBlob, dotsBackground, ensureFonts, fit, loadChibi, makeCanvas, shareImage, sticker } from './imageKit'

const W = 1080
const H = 1920

export async function renderRecapImage(r: SoireeRecap): Promise<Blob> {
  await ensureFonts()
  const { canvas, ctx } = makeCanvas(W, H)

  // fond
  dotsBackground(ctx, W, H)

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
  const imgs = await Promise.all(rows.map((s) => loadChibi(s.slug, s.equipped_tenue)))
  const medal: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' }
  const rowH = 132
  let y = 450
  rows.forEach((s, i) => {
    sticker(ctx, 60, y, W - 130, rowH - 22, 36, s.rank === 1 ? '#ffe08a' : '#ffffff', 8)
    ctx.textAlign = 'center'
    ctx.fillStyle = INK
    ctx.font = `800 52px ${FONT}`
    ctx.fillText(medal[s.rank] ?? String(s.rank), 130, y + 76)
    avatarDisc(ctx, imgs[i], 255, y + 44, 44, s.slug, s.nickname)
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

  return canvasToBlob(canvas)
}

/** Partage l’image du récap (feuille de partage native avec fichier) sinon la télécharge. */
export async function shareRecap(r: SoireeRecap): Promise<'shared' | 'downloaded' | 'cancelled'> {
  return shareImage(await renderRecapImage(r), 'recap-soiree.png', 'Récap de soirée', 'Notre soirée en un coup d’œil ! 🎉')
}
