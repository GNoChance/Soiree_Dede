import { useEffect, useRef } from 'react'
import { LayoutGroup, motion, useReducedMotion } from 'framer-motion'
import { Crown, Flame, Swords } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { mood, pickExpression } from '@/features/soiree/players'
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
/* Tournoi des grosses têtes : le tableau                                      */
/* -------------------------------------------------------------------------- */

/** Dimensions du tableau : normal (salon, résumé) ou grand (mode télé). */
const BK = {
  normal: { card: 'w-40', slot: 'h-10', h: 88, head: 30, text: 'text-xs', gap: 28, champ: 60, title: 'text-sm' },
  big: { card: 'w-56', slot: 'h-14', h: 120, head: 46, text: 'text-base', gap: 40, champ: 96, title: 'text-lg' },
} as const
type BkSize = (typeof BK)[keyof typeof BK]

type SlotState = 'win' | 'lose' | 'live' | 'idle' | 'bye'

function Slot({ id, st, get, meId, z }: { id: string | null; st: SlotState; get: Get; meId: string; z: BkSize }) {
  const reduce = useReducedMotion()
  if (!id) {
    return (
      <div className={cn('flex items-center gap-2 px-2', z.slot)}>
        <span
          className="flex shrink-0 items-center justify-center rounded-full border-[3px] border-dashed border-ink/30 font-display font-extrabold text-muted"
          style={{ width: z.head, height: z.head }}
          aria-hidden
        >
          ?
        </span>
        <span className={cn('text-muted italic', z.text)}>à venir…</span>
      </div>
    )
  }
  const p = get(id)
  const expr =
    st === 'win'
      ? mood(p, 'proud')
      : st === 'lose'
        ? mood(p, 'sad')
        : st === 'bye'
          ? pickExpression(p, 'dodo', 'clin_oeil', 'joie')
          : st === 'live'
            ? pickExpression(p, 'determine', 'colere', 'joie')
            : p.equipped
  return (
    // key = joueur : un vainqueur qui arrive dans la case suivante y « saute » depuis la gauche.
    <motion.div
      key={id}
      initial={reduce ? { opacity: 0 } : { x: -36, scale: 0.5, opacity: 0 }}
      animate={{ x: 0, scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 320, damping: 18 }}
      className={cn('flex items-center gap-2 px-2', z.slot, st === 'win' && 'bg-mint/45', st === 'lose' && 'bg-sunk/70')}
    >
      <motion.span
        key={st}
        initial={reduce || st === 'idle' ? false : { scale: 1.5, rotate: st === 'lose' ? 12 : -12 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 12 }}
        className={cn('relative shrink-0', st === 'lose' && 'opacity-60 grayscale')}
      >
        <Avatar slug={p.slug} expression={expr} tenue={p.equippedTenue} size={z.head} />
        {st === 'lose' && (
          <span className="absolute -right-1 -bottom-1 text-[0.8em] leading-none" aria-hidden>
            💧
          </span>
        )}
      </motion.span>
      <span
        className={cn(
          'min-w-0 flex-1 truncate font-extrabold',
          z.text,
          id === meId && 'text-grape',
          st === 'lose' && 'text-muted line-through decoration-2',
        )}
      >
        {p.nickname}
      </span>
      {st === 'win' && (
        <span className={z.text} aria-label="qualifié·e">
          ✅
        </span>
      )}
      {st === 'lose' && <span className="sr-only">éliminé·e</span>}
    </motion.div>
  )
}

function slotState(m: BracketMatch, id: string | null, current: boolean): SlotState {
  if (!id) return 'idle'
  if (m.status === 'bye') return 'bye'
  if (m.winner) return m.winner === id ? 'win' : 'lose'
  return current ? 'live' : 'idle'
}

function MatchCard({ m, current, replay, get, meId, z }: { m: BracketMatch; current: boolean; replay: boolean; get: Get; meId: string; z: BkSize }) {
  const reduce = useReducedMotion()
  if (m.status === 'bye') {
    return (
      <div className={cn(z.card, 'rounded-xl border-[3px] border-dashed border-ink/40 bg-sunk/60')}>
        <Slot id={m.a} st="bye" get={get} meId={meId} z={z} />
        <div className="px-2 pb-1 text-[10px] font-extrabold text-muted">😴 au repos ➜ tour suivant</div>
      </div>
    )
  }
  const badge = m.random ? '🎲 tirage au sort' : current && replay ? '🔁 revanche !' : m.draws > 0 ? (m.winner ? 'après revanche' : '🔁 revanche') : null
  return (
    <motion.div
      animate={current && !reduce ? { scale: [1, 1.04, 1], rotate: [0, -1, 0] } : { scale: 1 }}
      transition={current ? { repeat: Infinity, duration: 1.4 } : undefined}
      className={cn(
        z.card,
        'relative divide-y-2 divide-ink/15 rounded-xl border-[3px] border-ink bg-surface',
        current ? 'shadow-sticker ring-4 ring-sun' : 'shadow-sticker-sm',
      )}
    >
      <div className="overflow-hidden rounded-t-[9px]">
        <Slot id={m.a} st={slotState(m, m.a, current)} get={get} meId={meId} z={z} />
      </div>
      <div className="overflow-hidden rounded-b-[9px]">
        <Slot id={m.b} st={slotState(m, m.b, current)} get={get} meId={meId} z={z} />
      </div>
      {current && (
        <span className="absolute -top-2.5 -left-2 rounded-full border-2 border-ink bg-tomato px-1.5 text-[10px] font-extrabold text-white uppercase">
          ● en direct
        </span>
      )}
      {badge && (
        <span className="absolute -top-2.5 -right-2 rounded-full border-2 border-ink bg-sun px-1.5 text-[10px] font-extrabold text-[#1f1b2e]">{badge}</span>
      )}
    </motion.div>
  )
}

export interface BracketProps {
  s: DuelState
  get: Get
  meId: string
  /** Grand format (mode télé). */
  big?: boolean
  /** Sans défilement horizontal (le parent met le tableau à l'échelle). */
  fit?: boolean
  className?: string
}

/**
 * Tableau du tournoi des grosses têtes : têtes chibi dans les cases, traits
 * entre les tours (verts une fois le match joué), vainqueurs qui « sautent »
 * dans la case suivante, éliminés grisés en pleurs, exempts qui font la sieste,
 * revanches et tirages au sort signalés, champion couronné au bout.
 */
export function Bracket({ s, get, meId, big, fit, className }: BracketProps) {
  const reduce = useReducedMotion()
  const scroller = useRef<HTMLDivElement>(null)
  const b = s.session.bracket
  const focusKey = s.session.champion ? 'champion' : s.duel ? `${s.duel.round}-${s.duel.match}` : ''
  // Sur téléphone (défilement horizontal) : on amène le match en cours (ou le champion) au centre.
  useEffect(() => {
    const box = scroller.current
    if (fit || !box || !focusKey) return
    const el = box.querySelector<HTMLElement>('[data-focus="1"]')
    if (!el) return
    const left = el.getBoundingClientRect().left - box.getBoundingClientRect().left + box.scrollLeft
    box.scrollTo({ left: Math.max(0, left - box.clientWidth / 2 + el.offsetWidth / 2), behavior: reduce ? 'auto' : 'smooth' })
  }, [focusKey, fit, reduce])
  if (!b) return null
  const z = big ? BK.big : BK.normal
  const d = s.duel
  const live = s.phase !== 'finished' && s.phase !== 'aborted'
  const half = z.gap / 2
  const champion = s.session.champion
  const last = b.rounds.length - 1
  return (
    <div ref={scroller} className={cn(fit ? 'pt-3 pb-1' : '-mx-3 overflow-x-auto px-3 pt-3 pb-2 [scrollbar-width:thin]', className)}>
      <div className="flex w-max" style={{ columnGap: z.gap }}>
        {b.rounds.map((round, r) => (
          <div key={r} className="flex flex-col gap-2">
            <span className={cn('text-center font-display font-extrabold', z.title)}>{roundName(r, b.rounds.length)}</span>
            <div className="flex flex-1 flex-col">
              {round.map((m, i) => {
                const done = !!m.winner
                const line = done ? 'bg-mint' : 'bg-ink/30'
                const current = live && !!d && d.round === r && d.match === i
                return (
                  <div key={i} data-focus={current && !champion ? '1' : undefined} className="relative flex flex-1 items-center py-2" style={{ minHeight: z.h + 16 }}>
                    {/* trait d'arrivée (depuis le tour précédent) */}
                    {r > 0 && <span className="absolute top-1/2 h-[3px] -translate-y-1/2 bg-ink/30" style={{ left: -half, width: half }} aria-hidden />}
                    {/* trait de sortie vers le tour suivant (ou le trophée) */}
                    <span className={cn('absolute top-1/2 h-[3px] -translate-y-1/2', line)} style={{ right: -half, width: half }} aria-hidden />
                    {/* jonction verticale de la paire (i, i+1) */}
                    {r < last && i % 2 === 0 && <span className="absolute top-1/2 h-full w-[3px] bg-ink/30" style={{ right: -half - 1.5 }} aria-hidden />}
                    <motion.div
                      initial={reduce ? { opacity: 0 } : { opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: r * 0.15 + i * 0.05 }}
                    >
                      <MatchCard m={m} current={current} replay={!!d?.replay} get={get} meId={meId} z={z} />
                    </motion.div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
        {/* Le trophée : la future grosse tête */}
        <div className="flex flex-col gap-2" data-focus={champion ? '1' : undefined}>
          <span className={cn('text-center font-display font-extrabold', z.title)}>🏆</span>
          <div className="flex flex-1 flex-col items-center justify-center gap-1 px-1">
            {champion ? (
              <motion.div
                key={champion}
                initial={reduce ? { opacity: 0 } : { scale: 0, rotate: -30 }}
                animate={{ scale: 1, rotate: 0, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 260, damping: 12 }}
                className="relative flex flex-col items-center gap-1 pt-4"
              >
                <motion.span
                  className="absolute -top-2 z-10 text-sun drop-shadow-[2px_2px_0_var(--ink)]"
                  animate={reduce ? undefined : { rotate: [-12, 12, -12], y: [0, -3, 0] }}
                  transition={{ repeat: Infinity, duration: 1.6 }}
                >
                  <Crown className={big ? 'size-10 fill-sun' : 'size-7 fill-sun'} strokeWidth={2.5} />
                </motion.span>
                <Avatar slug={get(champion).slug} expression={mood(get(champion), 'proud')} tenue={get(champion).equippedTenue} size={z.champ} />
                <span className={cn('max-w-28 truncate font-display font-extrabold', z.title)}>{get(champion).nickname}</span>
                <span className="rounded-full border-2 border-ink bg-sun px-2 text-[10px] font-extrabold text-[#1f1b2e] uppercase">grosse tête !</span>
              </motion.div>
            ) : (
              <div className="flex flex-col items-center gap-1 opacity-70">
                <span
                  className="flex items-center justify-center rounded-full border-[3px] border-dashed border-ink/40 font-display text-2xl font-extrabold text-muted"
                  style={{ width: z.champ, height: z.champ }}
                >
                  ?
                </span>
                <span className="text-[11px] font-bold text-muted">grosse tête</span>
              </div>
            )}
          </div>
        </div>
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
