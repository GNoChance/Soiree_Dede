import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { ChibiImage } from '@/components/ui/ChibiImage'
import { mood, pickExpression, playerOrPlaceholder } from '@/features/soiree/players'
import { cn } from '@/lib/cn'
import type { GameSummaryProps } from '@/games/types'
import { SessionBoard } from './SessionBoard'
import { endReasonLabel, modeInfo, sessionRanking } from './logic'
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

export default DuelSummary
