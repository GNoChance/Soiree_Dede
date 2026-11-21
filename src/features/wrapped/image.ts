import { getGame } from '@/games/registry'
import { FONT, INK, avatarDisc, canvasToBlob, dotsBackground, ensureFonts, fit, loadChibi, makeCanvas, shareImage, sticker, wrapText } from '@/features/recap/imageKit'
import type { YearWrapped } from './api'
import { personalityOf } from './texts'

const W = 1080
const H = 1920

/** Image « story » 1080x1920 de la dernière carte de Mon année. */
export async function renderWrappedImage(w: YearWrapped): Promise<Blob> {
  await ensureFonts()
  const { canvas, ctx } = makeCanvas(W, H)
  dotsBackground(ctx, W, H)
  const pers = personalityOf(w.personality.id)
  const me = w.profile
  const [meImg, buddyImg] = await Promise.all([loadChibi(me.slug, me.equipped_tenue, 'joie'), w.buddy ? loadChibi(w.buddy.slug, w.buddy.equipped_tenue) : Promise.resolve(null)])

  sticker(ctx, 60, 60, W - 130, 250, 48, '#ffb703')
  ctx.fillStyle = INK
  ctx.font = `800 100px ${FONT}`
  ctx.fillText(`Mon année ${w.year}`, W / 2 - 5, 190)
  ctx.font = `700 48px ${FONT}`
  ctx.fillText(fit(ctx, me.nickname, W - 200), W / 2 - 5, 262)

  avatarDisc(ctx, meImg, W / 2, 520, 190, me.slug, me.nickname, '#ffffff')
  sticker(ctx, 90, 760, W - 180, 230, 44, '#ff8fa3')
  ctx.fillStyle = INK
  ctx.textAlign = 'center'
  ctx.font = `800 64px ${FONT}`
  ctx.fillText(fit(ctx, `${pers.emoji} ${pers.title}`, W - 240), W / 2 - 5, 850)
  ctx.font = `700 38px ${FONT}`
  wrapText(ctx, pers.line, W / 2 - 5, 915, W - 260, 48, 2)

  const stats: Array<[string, string, string]> = [
    [String(w.games_played), 'parties', '#4cc9f0'],
    [String(w.wins), 'victoires', '#ffb703'],
    [String(w.soirees), w.soirees > 1 ? 'soirées' : 'soirée', '#06d6a0'],
    [String(w.trophies.count), w.trophies.count > 1 ? 'trophées' : 'trophée', '#b5e61d'],
  ]
  stats.forEach(([v, label, color], i) => {
    const x = 60 + (i % 2) * 495
    const y = 1050 + Math.floor(i / 2) * 190
    sticker(ctx, x, y, 460, 160, 36, color, 8)
    ctx.fillStyle = INK
    ctx.textAlign = 'center'
    ctx.font = `800 80px ${FONT}`
    ctx.fillText(v, x + 230, y + 90)
    ctx.font = `700 38px ${FONT}`
    ctx.fillText(label, x + 230, y + 138)
  })

  let y = 1450
  const g = w.favorite_game ? getGame(w.favorite_game.game_id) : null
  if (g) {
    sticker(ctx, 60, y, W - 130, 100, 30, '#ffffff', 8)
    ctx.fillStyle = INK
    ctx.textAlign = 'center'
    ctx.font = `800 42px ${FONT}`
    ctx.fillText(fit(ctx, `Jeu préféré : ${g.emoji} ${g.name}`, W - 190), W / 2 - 5, y + 64)
    y += 125
  }
  if (w.buddy) {
    sticker(ctx, 60, y, W - 130, 130, 30, '#ffffff', 8)
    avatarDisc(ctx, buddyImg, 150, y + 65, 46, w.buddy.slug, w.buddy.nickname)
    ctx.fillStyle = INK
    ctx.textAlign = 'left'
    ctx.font = `800 40px ${FONT}`
    ctx.fillText(fit(ctx, `Complice : ${w.buddy.nickname}`, W - 330), 225, y + 62)
    ctx.font = `700 34px ${FONT}`
    ctx.fillText(`${w.buddy.together} parties ensemble`, 225, y + 104)
    ctx.textAlign = 'center'
  }
  ctx.fillStyle = INK
  ctx.font = `800 44px ${FONT}`
  ctx.fillText('Soirées de Dédé', W / 2, H - 60)
  return canvasToBlob(canvas)
}

export async function shareWrapped(w: YearWrapped) {
  return shareImage(await renderWrappedImage(w), `mon-annee-${w.year}.png`, `Mon année ${w.year}`, `Mon année ${w.year} sur Soirées de Dédé ! 🎉`)
}
