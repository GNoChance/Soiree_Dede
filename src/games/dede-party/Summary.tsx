import { motion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/cn'
import { mood } from '@/features/soiree/players'
import { makeGet } from './bots'
import { useTv } from '@/features/tv/tv'
import { Moments, names, topOf, type Moment } from '@/features/duel/Moments'
import type { GameSummaryProps, PlayerInfo } from '../types'
import { boardOf } from './board'
import type { DedePartyState, DpStats } from './types'

const MEDAL = ['🥇', '🥈', '🥉']

/** Bloc fin de partie : classement (étoiles, pièces), mini-jeux gagnés, étoiles bonus, meilleur moment. */
export default function DedePartySummary({ state, meId, players }: GameSummaryProps) {
  const s = state as unknown as DedePartyState
  const tv = useTv()
  if (!s.ranking?.length) return null
  const get = makeGet(players, s)
  const winners = s.ranking.filter((r) => r.rank === 1)
  const bonus = (id: string) =>
    (s.awards ?? [])
      .filter((a) => a.ids.includes(id))
      .map((a) => (a.kind === 'king' ? '👑' : '📺'))
      .join(' ')
  const board = boardOf(s.map)
  // Meilleur moment : plus gros gain en une fois (carte Enveloppe, gros lot de la Tombola, sac de Riton).
  const best = s.players
    .map((id) => ({ id, card: s.stats?.[id]?.best_card }))
    .filter((x) => x.card && x.card.gain > 0)
    .sort((a, b) => (b.card?.gain ?? 0) - (a.card?.gain ?? 0))[0]

  const moments = partyMoments(s, get)

  return (
    <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.2 }} className="sticker flex flex-col gap-3 bg-surface p-4">
      <div className="flex flex-col items-center gap-2 text-center">
        <p className={cn('font-display font-extrabold', tv ? 'text-4xl' : 'text-2xl')}>
          🎤 {winners.length > 1 ? 'Victoire partagée' : `${get(winners[0].id).nickname} remporte l’émission`} avec {winners[0].stars} étoile{winners[0].stars > 1 ? 's' : ''}
        </p>
        <p className="text-sm font-bold text-muted">
          {board.emoji} {board.name} · {s.round} tour{s.round > 1 ? 's' : ''} sur {s.rounds}
          {s.forced ? ' · partie écourtée' : ''}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {winners.map((w) => (
            <div key={w.id} className="flex w-28 flex-col items-center">
              <Avatar slug={get(w.id).slug} expression={mood(get(w.id), 'proud')} tenue={get(w.id).equippedTenue} size={tv ? 88 : 64} bounce />
              <span className="w-full truncate text-xs font-extrabold">{get(w.id).nickname}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        {s.ranking.map((r) => {
          const p = get(r.id)
          const st = s.stats?.[r.id]
          return (
            <div key={r.id} className={cn('sticker-sm flex items-center gap-2 px-2 py-1', r.rank === 1 ? 'bg-sun text-[#1f1b2e]' : r.id === meId ? 'bg-sky/25' : 'bg-paper')}>
              <span className={cn('w-8 text-center font-display font-extrabold', tv ? 'text-3xl' : 'text-xl')}>{r.rank <= 3 ? MEDAL[r.rank - 1] : r.rank}</span>
              <Avatar slug={p.slug} tenue={p.equippedTenue} size={tv ? 48 : 36} />
              <div className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className={cn('truncate font-extrabold', tv && 'text-xl')}>
                  {p.nickname} {bonus(r.id)}
                </span>
                <span className="text-xs leading-tight font-bold opacity-75">
                  {st?.mg_wins ?? 0} mini-jeu{(st?.mg_wins ?? 0) > 1 ? 'x' : ''} gagné{(st?.mg_wins ?? 0) > 1 ? 's' : ''} · {st?.pubs ?? 0} pub{(st?.pubs ?? 0) > 1 ? 's' : ''} · {st?.envelopes ?? 0} ✉️
                </span>
              </div>
              <span className={cn('font-display font-extrabold tabular-nums', tv ? 'text-2xl' : 'text-lg')}>
                ⭐ {r.stars} · 🪙 {r.coins}
              </span>
            </div>
          )
        })}
      </div>

      {(s.awards ?? []).some((a) => a.ids.length) && (
        <div className="flex flex-col gap-1 text-sm font-bold">
          {(s.awards ?? []).map((a) =>
            a.ids.length ? (
              <span key={a.kind}>
                {a.kind === 'king' ? '👑 ⭐ Roi des mini-jeux' : '📺 ⭐ Prix de la poisse'} : {a.ids.map((id) => get(id).nickname).join(', ')} ({a.value}
                {a.kind === 'king' ? ' mini-jeux gagnés' : ' pages de pub'})
              </span>
            ) : null,
          )}
        </div>
      )}

      {best?.card && (
        <div className="sticker-sm flex items-center gap-2 bg-grape/20 px-2 py-1.5">
          <Avatar slug={get(best.id).slug} tenue={get(best.id).equippedTenue} expression={mood(get(best.id), 'happy')} size={36} />
          <span className="text-sm leading-tight font-bold">
            <span className="font-display font-extrabold">✨ Meilleur moment : {get(best.id).nickname}</span> — « {best.card.text} » (+{best.card.gain} 🪙)
          </span>
        </div>
      )}
      <Moments moments={moments} get={get} tv={tv} />
    </motion.div>
  )
}
/** Moments drôles : lanterne rouge, séries, doubles, fauchés, mécène de la Tombola… (masqués si 0). */
function partyMoments(s: DedePartyState, get: (id: string) => PlayerInfo): Moment[] {
  const out: Moment[] = []
  const ids = s.players
  const st = (id: string, k: keyof DpStats) => (s.stats?.[id]?.[k] as number | undefined) ?? 0
  const many = (a: string[]) => (a.length > 1 ? 'ont' : 'a')

  const last = s.ranking && s.ranking.length > 2 ? s.ranking[s.ranking.length - 1] : null
  if (last && last.rank > 1 && s.ranking?.filter((r) => r.rank === last.rank).length === 1) {
    out.push({ key: 'last', emoji: '🐢', title: 'La lanterne rouge', ids: [last.id], text: `${get(last.id).nickname} ferme la marche avec ${last.stars} étoile${last.stars > 1 ? 's' : ''} et ${last.coins} 🪙. La revanche sera douce !` })
  }
  const streak = topOf(ids, (id) => st(id, 'mg_streak_max'))
  if (streak && streak.value >= 2) out.push({ key: 'streak', emoji: '🔥', title: 'En série', ids: streak.ids, text: `${names(streak.ids, get)} ${many(streak.ids)} gagné ${streak.value} mini-jeux d’affilée. Intouchable !` })
  const dbl = topOf(ids, (id) => st(id, 'doubles'))
  if (dbl && dbl.value >= 2) out.push({ key: 'doubles', emoji: '🎲', title: 'Les dés en or', ids: dbl.ids, text: `${names(dbl.ids, get)} ${many(dbl.ids)} sorti ${dbl.value} doubles. Les dés ont un chouchou.` })
  const broke = ids.filter((id) => st(id, 'broke') > 0)
  if (broke.length) out.push({ key: 'broke', emoji: '💸', title: 'Les poches vides', ids: broke, text: `${names(broke, get)} ${many(broke)} fini à sec au moins une fois. Heureusement, c’est de l’argent de Monopoly !` })
  const toll = topOf(ids, (id) => st(id, 'toll_paid'))
  if (toll && toll.value >= 10) out.push({ key: 'toll', emoji: '🎟️', title: 'Mécène de la Tombola', ids: toll.ids, text: `${names(toll.ids, get)} ${many(toll.ids)} offert ${toll.value} 🪙 à la cagnotte. Quelqu’un dira merci.` })
  const washed = topOf(ids, (id) => st(id, 'washed'))
  if (washed) out.push({ key: 'washed', emoji: '🌊', title: 'Emporté par la vague', ids: washed.ids, text: `${names(washed.ids, get)} ${many(washed.ids)} été ${washed.value > 1 ? `${washed.value} fois ` : ''}balayé${washed.ids.length > 1 ? 's' : ''} par la marée.` })
  const robbed = topOf(ids, (id) => st(id, 'robbed'))
  if (robbed) out.push({ key: 'robbed', emoji: '🦝', title: 'Victime préférée des ratons', ids: robbed.ids, text: `${names(robbed.ids, get)} ${many(robbed.ids)} été dépouillé${robbed.ids.length > 1 ? 's' : ''} ${robbed.value} fois. Le sac se vide vite !` })
  return out.slice(0, 4)
}

