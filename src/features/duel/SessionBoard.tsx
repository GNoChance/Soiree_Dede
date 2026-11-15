import { LayoutGroup, motion, useReducedMotion } from 'framer-motion'
import { Crown, Flame, Swords } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { mood } from '@/features/soiree/players'
import { cn } from '@/lib/cn'
import type { PlayerInfo } from '@/games/types'
import { kingProgress, modeInfo, roundName, sessionRanking } from './logic'
import type { BracketMatch, DuelInfo, DuelState } from './types'

type Get = (id: string) => PlayerInfo

/* -------------------------------------------------------------------------- */
/* Roi de la table : la file                                                   */
/* -------------------------------------------------------------------------- */

function KingQueue({ s, get, meId }: { s: DuelState; get: Get; meId: string }) {
  const reduce = useReducedMotion()
  const ses = s.session
  const queue = ses.queue ?? []
  const prog = kingProgress(ses, s.players)
  return (
    <div className="flex flex-col gap-2">
      <LayoutGroup>
        <div className="-mx-1 flex items-end gap-1.5 overflow-x-auto px-1 pt-5 pb-1 [scrollbar-width:none]">
          {queue.map((id, i) => {
            const p = get(id)
            const king = i === 0
            const challenger = i === 1
            const streak = ses.streak.player === id ? ses.streak.count : 0
            return (
              <motion.div
                key={id}
                layout={!reduce}
                transition={{ type: 'spring', stiffness: 300, damping: 24 }}
                className={cn('relative flex shrink-0 flex-col items-center gap-0.5', king ? 'w-[4.6rem]' : 'w-14')}
              >
                {king && (
                  <motion.span
                    className="absolute -top-5 z-10 text-sun drop-shadow-[2px_2px_0_var(--ink)]"
                    animate={reduce ? undefined : { rotate: [-10, 10, -10] }}
                    transition={{ repeat: Infinity, duration: 2 }}
                  >
                    <Crown className="size-6 fill-sun" strokeWidth={2.5} />
                  </motion.span>
                )}
                <Avatar slug={p.slug} expression={king ? mood(p, 'proud') : p.equipped} size={king ? 56 : challenger ? 44 : 36} />
                <span className={cn('max-w-full truncate text-xs font-extrabold', id === meId && 'text-grape')}>{id === meId ? 'Toi' : p.nickname}</span>
                {king && streak > 0 && (
                  <span className="flex items-center gap-0.5 rounded-full border-2 border-ink bg-tangerine px-1.5 text-[11px] font-extrabold text-white">
                    <Flame className="size-3" /> {streak}/{ses.streak_target}
                  </span>
                )}
                {challenger && <span className="text-[10px] font-extrabold text-tomato uppercase">challenger</span>}
                {i === 1 && <Swords className="absolute top-3 -left-3 size-4 text-muted" />}
              </motion.div>
            )
          })}
        </div>
      </LayoutGroup>
      <p className="text-xs leading-snug text-muted">
        Fin : {prog.streakTarget} victoires d’affilée (une fois que tout le monde a joué), ou {prog.minTarget} duels chacun
        {prog.waitingFirst.length > 0 ? ` · pas encore joué : ${prog.waitingFirst.map((id) => get(id).nickname).join(', ')}` : ` · minimum actuel : ${prog.minPlayed}/${prog.minTarget}`}
      </p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Tournoi : le tableau                                                        */
/* -------------------------------------------------------------------------- */

function Slot({ id, win, lose, get, meId }: { id: string | null; win: boolean; lose: boolean; get: Get; meId: string }) {
  if (!id) return <div className="flex h-8 items-center gap-1.5 px-1.5 text-xs text-muted italic">à venir…</div>
  const p = get(id)
  return (
    <div className={cn('flex h-8 items-center gap-1.5 px-1.5', win && 'bg-mint/40', lose && 'opacity-45 grayscale')}>
      <Avatar slug={p.slug} expression={win ? mood(p, 'proud') : lose ? mood(p, 'sad') : p.equipped} size={22} />
      <span className={cn('min-w-0 flex-1 truncate text-xs font-extrabold', id === meId && 'text-grape')}>{p.nickname}</span>
      {win && <span className="text-xs">✅</span>}
    </div>
  )
}

function MatchCard({ m, current, get, meId }: { m: BracketMatch; current: boolean; get: Get; meId: string }) {
  const reduce = useReducedMotion()
  if (m.status === 'bye') {
    return (
      <div className="w-36 rounded-xl border-2 border-dashed border-ink/40 bg-sunk/60">
        <Slot id={m.a} win={false} lose={false} get={get} meId={meId} />
        <div className="px-1.5 pb-1 text-[10px] font-extrabold text-muted uppercase">exempt ➜ qualifié</div>
      </div>
    )
  }
  return (
    <motion.div
      animate={current && !reduce ? { scale: [1, 1.05, 1], rotate: [0, -1, 0] } : { scale: 1 }}
      transition={current ? { repeat: Infinity, duration: 1.4 } : undefined}
      className={cn(
        'relative w-36 divide-y-2 divide-ink/15 overflow-hidden rounded-xl border-[3px] border-ink bg-surface',
        current ? 'shadow-sticker ring-4 ring-sun' : 'shadow-sticker-sm',
      )}
    >
      <Slot id={m.a} win={!!m.winner && m.winner === m.a} lose={!!m.winner && m.winner !== m.a} get={get} meId={meId} />
      <Slot id={m.b} win={!!m.winner && m.winner === m.b} lose={!!m.winner && m.winner !== m.b} get={get} meId={meId} />
      {(m.draws > 0 || m.random) && (
        <span className="absolute top-0.5 right-0.5 rounded-full border border-ink bg-sun px-1 text-[9px] font-extrabold text-[#1f1b2e]">
          {m.random ? '🎲 tirage' : 'revanche'}
        </span>
      )}
    </motion.div>
  )
}

function Bracket({ s, get, meId }: { s: DuelState; get: Get; meId: string }) {
  const b = s.session.bracket
  if (!b) return null
  const d = s.duel
  const live = s.phase !== 'finished' && s.phase !== 'aborted'
  return (
    <div className="-mx-3 overflow-x-auto px-3 pb-2 [scrollbar-width:thin]">
      <div className="flex w-max gap-3">
        {b.rounds.map((round, r) => (
          <div key={r} className="flex flex-col gap-2">
            <span className="text-center font-display text-sm font-extrabold">{roundName(r, b.rounds.length)}</span>
            <div className="flex flex-1 flex-col justify-around gap-2">
              {round.map((m, i) => (
                <motion.div key={i} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: r * 0.15 + i * 0.05 }}>
                  <MatchCard m={m} current={live && !!d && d.round === r && d.match === i} get={get} meId={meId} />
                </motion.div>
              ))}
            </div>
          </div>
        ))}
        {s.session.champion && (
          <div className="flex flex-col items-center justify-center gap-1 px-2">
            <span className="text-3xl">🏆</span>
            <Avatar slug={get(s.session.champion).slug} expression={mood(get(s.session.champion), 'proud')} size={52} />
            <span className="font-display text-sm font-extrabold">{get(s.session.champion).nickname}</span>
          </div>
        )}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Points de session                                                           */
/* -------------------------------------------------------------------------- */

export function ScoreStrip({ s, get, meId, duel }: { s: DuelState; get: Get; meId: string; duel?: DuelInfo | null }) {
  const rows = sessionRanking(s.session, s.players)
  return (
    <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
      {rows.map((r) => {
        const p = get(r.id)
        const fighting = duel && (duel.a === r.id || duel.b === r.id)
        return (
          <motion.div
            key={r.id}
            layout
            className={cn(
              'flex shrink-0 items-center gap-1 rounded-full border-2 border-ink py-0.5 pr-2 pl-0.5',
              fighting ? 'bg-sun text-[#1f1b2e]' : 'bg-surface',
              r.id === meId && 'ring-2 ring-grape',
            )}
          >
            <Avatar slug={p.slug} expression={p.equipped} size={22} />
            <span className="max-w-[4.5rem] truncate text-xs font-extrabold">{p.nickname}</span>
            <motion.span key={r.points} initial={{ scale: 1.8 }} animate={{ scale: 1 }} className="text-xs font-extrabold tabular-nums">
              {r.points}
            </motion.span>
          </motion.div>
        )
      })}
    </div>
  )
}

export interface SessionBoardProps {
  state: DuelState
  get: Get
  meId: string
  className?: string
}

/** Tableau de session : file du roi / tableau du tournoi / score du duel + points. */
export function SessionBoard({ state, get, meId, className }: SessionBoardProps) {
  const ses = state.session
  const info = modeInfo(ses.mode)
  return (
    <div className={cn('sticker flex flex-col gap-2 bg-surface p-3', className)}>
      <div className="flex items-center justify-between">
        <span className="font-display text-lg font-extrabold">
          {info.emoji} {info.label}
        </span>
        <span className="text-xs font-bold text-muted">
          {ses.duel_count} duel{ses.duel_count > 1 ? 's' : ''} joué{ses.duel_count > 1 ? 's' : ''}
        </span>
      </div>
      {ses.mode === 'king' && <KingQueue s={state} get={get} meId={meId} />}
      {ses.mode === 'tournament' && <Bracket s={state} get={get} meId={meId} />}
      {ses.mode === 'duel' && ses.best_of > 1 && <p className="text-sm text-muted">Au meilleur des {ses.best_of} manches.</p>}
      <ScoreStrip s={state} get={get} meId={meId} duel={state.duel} />
    </div>
  )
}
