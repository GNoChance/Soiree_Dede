import { getGame } from '@/games/registry'
import { fmtDuration } from '@/features/stats/api'
import type { SoireeRecap } from './api'
import { buildAwards, profilesOf } from './cards'
import { reveillonSummary } from '@/features/reveillon/ReveillonRecapCard'
import { FONT, INK, avatarDisc, canvasToBlob, dotsBackground, ensureFonts, fit, loadChibi, makeCanvas, shareImage, sticker } from './imageKit'

/** « Photo souvenir » de fin de soirée : image carrée 4:5 (1080x1350), podium en chibis. */
const W = 1080
const H = 1350
const AWARD_FILLS: Record<string, string> = { 'bg-tangerine': '#fb8500', 'bg-lime': '#b5e61d', 'bg-sky': '#4cc9f0', 'bg-bubblegum': '#ff8fa3', 'bg-mint': '#06d6a0', 'bg-sun': '#ffb703' }

export async function renderSouvenirImage(r: SoireeRecap): Promise<Blob> {
  await ensureFonts()
  const { canvas, ctx } = makeCanvas(W, H)
  dotsBackground(ctx, W, H)

  // titre
  sticker(ctx, 60, 50, W - 130, 190, 48, '#ffb703')
  ctx.fillStyle = INK
  ctx.font = `800 84px ${FONT}`
  // soirée scénarisée : titre du thème + ligne « champion·ne » en tête des awards
  const rv = r.reveillon ? reveillonSummary(r.reveillon, profilesOf(r)) : null
  ctx.fillText(fit(ctx, rv ? `${rv.theme.emoji} ${rv.theme.name}` : '👑 Star de la soirée', W - 170), W / 2 - 5, 150)
  const date = r.ended_at ? new Date(r.ended_at).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : ''
  ctx.font = `700 42px ${FONT}`
  ctx.fillText(date, W / 2 - 5, 210)

  // podium : 2e - 1er - 3e
  const top = r.standings.filter((s) => s.points > 0 || r.standings.length <= 3).slice(0, 3)
  const imgs = await Promise.all(top.map((s) => loadChibi(s.slug, s.equipped_tenue, 'joie')))
  const layout = [
    { i: 1, cx: 190, h: 140, r: 88, color: '#cfd8e3', medal: '🥈' },
    { i: 0, cx: 540, h: 190, r: 118, color: '#ffe08a', medal: '🥇' },
    { i: 2, cx: 890, h: 100, r: 88, color: '#f0b98a', medal: '🥉' },
  ]
  const baseY = 860
  for (const l of layout) {
    const s = top[l.i]
    if (!s) continue
    const topY = baseY - l.h
    const cy = topY - l.r - 24
    avatarDisc(ctx, imgs[l.i], l.cx, cy, l.r, s.slug, s.nickname)
    sticker(ctx, l.cx - 150, topY, 300, l.h, 28, l.color, 8)
    ctx.fillStyle = INK
    ctx.textAlign = 'center'
    ctx.font = `800 40px ${FONT}`
    ctx.fillText(fit(ctx, s.nickname, 270), l.cx, topY + 52)
    ctx.font = `700 34px ${FONT}`
    ctx.fillText(`${l.medal} ${s.points} pt${s.points > 1 ? 's' : ''}`, l.cx, topY + 96)
  }

  // chiffres
  const g = r.top_game ? getGame(r.top_game.game_id) : null
  sticker(ctx, 60, 930, W - 130, 118, 32, '#4cc9f0', 8)
  ctx.fillStyle = INK
  ctx.textAlign = 'center'
  ctx.font = `800 44px ${FONT}`
  ctx.fillText(fit(ctx, `🎲 ${r.games_played} partie${r.games_played > 1 ? 's' : ''} · ⏱️ ${fmtDuration(r.duration_min)} · 🧑‍🤝‍🧑 ${r.players_count}`, W - 170), W / 2 - 5, 985)
  if (g) {
    ctx.font = `700 38px ${FONT}`
    ctx.fillText(fit(ctx, `Jeu le plus joué : ${g.emoji} ${g.name}`, W - 170), W / 2 - 5, 1028)
  }

  // un ou deux awards
  const awards = buildAwards(r).filter((a) => a.key !== 'star')
  if (rv && rv.champs.length) awards.unshift({ key: 'reveillon', emoji: '🏆', title: `Champion·ne · ${rv.theme.name}`, big: `${rv.champPoints} pts · 🎁 ${rv.defis} défi${rv.defis > 1 ? 's' : ''}`, line: '', bg: 'bg-sun', who: rv.champs })
  awards.splice(2)
  let y = 1085
  for (const a of awards) {
    sticker(ctx, 60, y, W - 130, 96, 28, AWARD_FILLS[a.bg] ?? '#ffb703', 8)
    ctx.fillStyle = INK
    ctx.textAlign = 'left'
    ctx.font = `800 36px ${FONT}`
    ctx.fillText(fit(ctx, `${a.emoji} ${a.title}`, W - 190), 95, y + 40)
    ctx.font = `700 34px ${FONT}`
    ctx.fillText(fit(ctx, `${a.who.map((w) => w.nickname).join(' & ')} · ${a.big}`, W - 190), 95, y + 80)
    y += 112
  }

  ctx.textAlign = 'center'
  ctx.fillStyle = INK
  ctx.font = `800 36px ${FONT}`
  ctx.fillText('Soirées de Dédé', W / 2, H - 28)
  return canvasToBlob(canvas)
}

export async function shareSouvenir(r: SoireeRecap): Promise<'shared' | 'downloaded' | 'cancelled'> {
  return shareImage(await renderSouvenirImage(r), 'photo-souvenir.png', 'Photo souvenir', 'Souvenir de notre soirée ! 📸')
}
