import { useEffect, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Crown } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { ChibiImage } from '@/components/ui/ChibiImage'
import { confettiRain } from '@/components/ui/confetti'
import { fx } from '@/lib/feedback'
import { mood, pickExpression, playerOrPlaceholder } from '@/features/soiree/players'
import { cn } from '@/lib/cn'
import type { GameSummaryProps, PlayerInfo } from '@/games/types'
import { SessionBoard } from './SessionBoard'
import { bracketPath, endReasonLabel, modeInfo, roundName, runnerUp, sessionRanking } from './logic'
import type { DuelState } from './types'

const MEDALS = ['🥇', '🥈', '🥉']

export interface DuelSummaryProps extends GameSummaryProps {
  /** Bloc propre au jeu (stats du plateau…) affiché après le classement. */
  extra?: ReactNode
}

/**
 * Fin de session d'un jeu en duel : champion / meilleur score, classement par
 * points (V/N/D, paris gagnés), tableau final et historique des duels.
 */
export function DuelSummary({ state, meId, players, extra }: DuelSummaryProps) {
  const reduce = useReducedMotion()
  const s = state as unknown as DuelState
  const champion = s.session?.mode === 'tournament' ? s.session.champion : null
  // Sacre : la couronne tombe (~0,9 s), pluie de confettis + fanfare
  // (la fanfare du gagnant est déjà jouée par l'écran de résultats).
  useEffect(() => {
    if (!champion) return
    const t = window.setTimeout(() => {
      confettiRain(3200)
      if (champion !== meId) fx.fanfare()
    }, 900)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- un seul sacre par écran
  }, [champion])
  if (!s.session) return null
  const get = (id: string) => playerOrPlaceholder(players, id)
  const ses = s.session
  const rows = sessionRanking(ses, s.players, s.winners)
  const winners = s.winners ?? []
  const hero = winners.length ? get(winners[0]) : null
  const info = modeInfo(ses.mode)
  const heroTitle =
    !hero
      ? ses.mode === 'duel'
        ? 'Match nul !'
        : 'Personne ne s’impose…'
      : ses.mode === 'tournament' && ses.champion
        ? `${winners[0] === meId ? 'Tu es' : `${hero.nickname} est`} champion${winners[0] === meId ? '' : '·ne'} du tournoi !`
        : ses.mode === 'duel' && ses.champion
          ? `${winners[0] === meId ? 'Tu remportes' : `${hero.nickname} remporte`} le duel !`
          : winners.length > 1
            ? 'Égalité au sommet !'
            : `${winners[0] === meId ? 'Tu règnes' : `${hero.nickname} règne`} sur la table !`

  return (
    <div className="flex flex-col gap-3">
      {champion ? (
        <ChampionCrowning s={s} champion={champion} meId={meId} get={get} />
      ) : (
        <motion.div
          initial={{ scale: 0, rotate: -10 }}
          animate={{ scale: 1, rotate: 1.5 }}
          transition={{ type: 'spring', stiffness: 220, damping: 12, delay: 0.3 }}
          className="sticker relative flex flex-col items-center gap-1 overflow-hidden bg-grape p-3 text-center text-white"
        >
          <span className="rounded-full border-2 border-ink bg-sun px-2 text-xs font-extrabold text-[#1f1b2e] uppercase">
            {info.emoji} {info.label}
          </span>
          {hero ? (
            <div className="flex -space-x-6">
              {winners.slice(0, 3).map((id) => (
                <motion.div key={id} animate={reduce ? undefined : { y: [0, -6, 0], rotate: [-2, 2, -2] }} transition={{ repeat: Infinity, duration: 1.1 }}>
                  <ChibiImage slug={get(id).slug} expression={pickExpression(get(id), 'cool', 'pouces', 'joie')} tenue={get(id).equippedTenue} size={winners.length > 1 ? 100 : 130} />
                </motion.div>
              ))}
            </div>
          ) : (
            <span className="text-6xl">🤝</span>
          )}
          <p className="font-display text-2xl leading-tight font-extrabold" style={{ textShadow: '3px 3px 0 #1f1b2e' }}>
            {heroTitle}
          </p>
          <p className="text-sm font-bold">
            {endReasonLabel(ses.end_reason)} {ses.duel_count} duel{ses.duel_count > 1 ? 's' : ''} joué{ses.duel_count > 1 ? 's' : ''}.
          </p>
        </motion.div>
      )}

      <div className="sticker flex flex-col gap-1.5 bg-surface p-3">
        <p className="font-display font-extrabold">Classement de la session</p>
        {rows.map((r, i) => {
          const p = get(r.id)
          const st = ses.stats[r.id]
          return (
            <motion.div
              key={r.id}
              initial={{ x: -40, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.2 + i * 0.06 }}
              className={cn('flex items-center gap-2', r.id === meId && 'font-extrabold')}
            >
              <span className="w-7 text-center text-lg">{MEDALS[r.rank - 1] ?? `${r.rank}.`}</span>
              <Avatar slug={p.slug} expression={r.rank === 1 ? mood(p, 'proud') : i === rows.length - 1 && rows.length > 2 ? mood(p, 'sad') : p.equipped} size={30} />
              <span className="min-w-0 flex-1 truncate">{p.nickname}</span>
              {st && (
                <span className="text-[11px] text-muted tabular-nums" title="Victoires / nuls / défaites · paris gagnés">
                  {st.wins}V {st.draws}N {st.losses}D{st.bets ? ` · 🎟️${st.bets_won}/${st.bets}` : ''}
                </span>
              )}
              <span className="w-10 text-right font-display font-extrabold tabular-nums">{r.points}</span>
            </motion.div>
          )
        })}
        <p className="mt-1 text-xs text-muted">Victoire de duel +3 · nul +1 · pari juste +1.</p>
      </div>

      {extra}

      {ses.mode !== 'duel' && <SessionBoard state={s} get={get} meId={meId} />}

      {ses.history.length > 0 && (
        <div className="sticker flex flex-col gap-1 bg-surface p-3">
          <p className="font-display font-extrabold">Les duels</p>
          {ses.history.map((h) => (
            <div key={h.no} className="flex items-center gap-1.5 text-sm">
              <span className="w-6 text-xs font-bold text-muted">#{h.no}</span>
              <Avatar slug={get(h.a).slug} expression={h.winner === h.a ? mood(get(h.a), 'proud') : h.winner ? mood(get(h.a), 'sad') : get(h.a).equipped} size={22} />
              <span className={cn('truncate', h.winner === h.a && 'font-extrabold')}>{get(h.a).nickname}</span>
              <span className="text-xs text-muted">{h.draw ? '=' : 'vs'}</span>
              <span className={cn('truncate', h.winner === h.b && 'font-extrabold')}>{get(h.b).nickname}</span>
              <Avatar slug={get(h.b).slug} expression={h.winner === h.b ? mood(get(h.b), 'proud') : h.winner ? mood(get(h.b), 'sad') : get(h.b).equipped} size={22} />
              <span className="ml-auto shrink-0 text-xs">
                {h.draw ? (h.advanced ? `🎲 ${get(h.advanced).nickname}` : 'nul') : '🏅'}
                {h.games.length > 1 ? ` (${h.wins[h.a] ?? 0}-${h.wins[h.b] ?? 0})` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Sacre du tournoi des grosses têtes : couronne qui tombe, parcours, finaliste. */
function ChampionCrowning({ s, champion, meId, get }: { s: DuelState; champion: string; meId: string; get: (id: string) => PlayerInfo }) {
  const reduce = useReducedMotion()
  const p = get(champion)
  const b = s.session.bracket
  const path = bracketPath(b, champion)
  const second = runnerUp(b)
  const total = b?.rounds.length ?? 1
  return (
    <motion.div
      initial={reduce ? { opacity: 0 } : { scale: 0, rotate: -10 }}
      animate={{ scale: 1, rotate: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 220, damping: 12, delay: 0.2 }}
      className="sticker relative flex flex-col items-center gap-2 overflow-hidden bg-grape px-3 pt-3 pb-4 text-center text-white"
    >
      <motion.div
        className="pointer-events-none absolute top-[42%] left-1/2 aspect-square w-[190%] -translate-x-1/2 -translate-y-1/2 opacity-25"
        style={{ background: 'repeating-conic-gradient(#FFB703 0 8deg, transparent 8deg 20deg)' }}
        animate={reduce ? undefined : { rotate: 360 }}
        transition={{ repeat: Infinity, duration: 30, ease: 'linear' }}
        aria-hidden
      />
      <span className="relative rounded-full border-2 border-ink bg-sun px-2 text-xs font-extrabold text-[#1f1b2e] uppercase">🏆 Tournoi des grosses têtes</span>
      <div className="relative mt-10">
        <motion.div
          initial={reduce ? { opacity: 0 } : { y: -180, rotate: -50, opacity: 0 }}
          animate={{ y: 0, rotate: -10, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 170, damping: 10, delay: 0.7 }}
          className="absolute -top-12 left-1/2 z-10 -translate-x-1/2 drop-shadow-[3px_3px_0_var(--ink)]"
          aria-hidden
        >
          <Crown className="size-16 fill-sun text-ink" strokeWidth={2} />
        </motion.div>
        <motion.div
          animate={reduce ? undefined : { y: [0, -8, 0], rotate: [-2, 2, -2] }}
          transition={{ repeat: Infinity, duration: 1.1, delay: 1.2 }}
          className="rounded-full border-4 border-ink shadow-sticker"
          style={{ background: p.color }}
        >
          <div className="size-40 overflow-hidden rounded-full">
            <ChibiImage slug={p.slug} expression={pickExpression(p, 'pouces', 'cool', 'joie')} tenue={p.equippedTenue} size={150} bare className="mx-auto mt-[6%]" />
          </div>
        </motion.div>
      </div>
      <motion.p
        initial={reduce ? { opacity: 0 } : { scale: 2, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 14, delay: 1 }}
        className="relative font-display text-3xl leading-tight font-extrabold"
        style={{ textShadow: '3px 3px 0 #1f1b2e' }}
      >
        {champion === meId ? 'Tu es' : `${p.nickname} est`} la grosse tête de la soirée !
      </motion.p>
      <p className="relative text-sm font-bold">Champion·ne du tournoi · {s.session.duel_count} duel{s.session.duel_count > 1 ? 's' : ''} joué{s.session.duel_count > 1 ? 's' : ''}</p>
      {path.length > 0 && (
        <div className="relative flex flex-wrap items-center justify-center gap-1.5">
          {path.map((st) => (
            <span
              key={st.round}
              className="flex items-center gap-1 rounded-full border-2 border-ink bg-surface py-0.5 pr-2 pl-0.5 text-xs font-extrabold text-text"
              title={roundName(st.round, total)}
            >
              {st.opponent ? <Avatar slug={get(st.opponent).slug} expression={mood(get(st.opponent), 'sad')} size={22} /> : <span className="px-1">😴</span>}
              {st.bye ? 'au repos' : st.random ? `${get(st.opponent!).nickname} 🎲` : `bat ${get(st.opponent!).nickname}`}
            </span>
          ))}
        </div>
      )}
      {second && (
        <p className="relative flex items-center gap-1.5 text-sm font-bold">
          <Avatar slug={get(second).slug} expression={mood(get(second), 'sad')} size={26} /> Finaliste : {get(second).nickname}, bravo quand même !
        </p>
      )}
    </motion.div>
  )
}

export default DuelSummary
