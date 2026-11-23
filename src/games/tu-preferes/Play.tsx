import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, Check, Eye, FastForward, Pencil, Trophy, Undo2 } from 'lucide-react'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { burst, burstFrom } from '@/components/ui/confetti'
import { fx } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import { VoterStrip } from '@/features/soiree/components'
import { mood, playerOrPlaceholder } from '@/features/soiree/players'
import { serverNow, useCountdown } from '@/features/soiree/useServerClock'
import { AuthorBadge } from '@/features/cartes/AuthorBadge'
import type { GamePlayProps, PlayerInfo } from '../types'
import type { TpDilemma, TpReveal, TpSecret, TpSide, TpState } from './types'
import { percents, themeInfo, tpActions } from './setup'
import { hash01, NextIn } from '../qui-de-nous/autoTick'

type Get = (id: string) => PlayerInfo
type ActFn = GamePlayProps['act']

const SIDES = ['a', 'b'] as const
const SIDE = {
  a: { letter: 'A', bg: 'bg-tomato', text: 'text-white', hex: '#EF476F', tilt: -3 },
  b: { letter: 'B', bg: 'bg-sky', text: 'text-[#1f1b2e]', hex: '#4CC9F0', tilt: 3 },
} as const

function isSecret(v: unknown): v is TpSecret {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.round === 'number' && (o.choice === 'a' || o.choice === 'b') && (o.bet === 'a' || o.bet === 'b')
}

/**
 * Envoie {"type":"tick"} quand l'échéance est passée (horloge serveur), puis
 * réessaie tant que le state n'a pas changé (le serveur ignore les ticks en avance).
 */
function useDeadlineTick(deadline: string | null | undefined, act: ActFn) {
  const left = useCountdown(deadline)
  const expired = !!deadline && left <= 0 && new Date(deadline).getTime() <= serverNow()
  useEffect(() => {
    if (!expired) return
    let sent = 0
    const send = () => {
      if (sent++ < 6) void act(tpActions.tick())
    }
    const first = window.setTimeout(send, 150 + Math.random() * 450)
    const retry = window.setInterval(send, 2500)
    return () => {
      clearTimeout(first)
      clearInterval(retry)
    }
  }, [expired, deadline, act])
}

export default function TuPreferesPlay({ state, secret, meId, isHost, players, act, pending }: GamePlayProps) {
  const s = state as unknown as TpState
  const get: Get = (id) => playerOrPlaceholder(players, id)
  useDeadlineTick(s.phase === 'answering' || s.phase === 'reveal' ? s.deadline : null, act)

  return (
    <div className="flex flex-col gap-4 pb-6">
      {s.phase === 'answering' && s.dilemma && (
        <Answering key={`q${s.round}`} s={s} d={s.dilemma} secret={secret} meId={meId} isHost={isHost} players={players} act={act} pending={pending} />
      )}
      {s.phase === 'reveal' && s.last_reveal && (
        <Reveal key={`r${s.last_reveal.round}`} s={s} lr={s.last_reveal} meId={meId} isHost={isHost} get={get} act={act} pending={pending} />
      )}
      <Scores s={s} meId={meId} get={get} />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Barre de temps                                                              */
/* -------------------------------------------------------------------------- */

function TimerBar({ deadline, totalMs }: { deadline: string | null; totalMs: number }) {
  const left = useCountdown(deadline, 100)
  const secs = Math.ceil(left / 1000)
  const pct = Math.max(0, Math.min(100, (left / totalMs) * 100))
  const urgent = secs <= 5
  const lastSec = useRef(secs)
  useEffect(() => {
    if (secs !== lastSec.current) {
      lastSec.current = secs
      if (secs > 0 && secs <= 5) fx.tick()
    }
  }, [secs])
  const color = pct > 50 ? 'bg-mint' : pct > 25 ? 'bg-sun' : 'bg-tomato'
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-5 flex-1 overflow-hidden rounded-full border-[3px] border-ink bg-sunk shadow-sticker-sm">
        <motion.div className={cn('h-full rounded-full', color)} animate={{ width: `${pct}%` }} transition={{ ease: 'linear', duration: 0.1 }} />
      </div>
      <motion.span
        key={urgent ? secs : 'calm'}
        initial={urgent ? { scale: 1.8, rotate: -10 } : false}
        animate={{ scale: 1, rotate: 0 }}
        className={cn(
          'flex size-11 items-center justify-center rounded-full border-[3px] border-ink font-display text-xl font-extrabold shadow-sticker-sm',
          urgent ? 'bg-tomato text-white' : 'bg-surface',
        )}
      >
        {secs}
      </motion.span>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Les deux cartes face à face                                                 */
/* -------------------------------------------------------------------------- */

function DuelCards({ d, selected, mark, onPick, disabled }: { d: TpDilemma; selected: TpSide | null; mark?: TpSide | null; onPick?: (side: TpSide) => void; disabled?: boolean }) {
  const reduce = useReducedMotion()
  return (
    <div className="relative grid grid-cols-2 gap-3 pt-3">
      {SIDES.map((side, i) => {
        const st = SIDE[side]
        const sel = selected === side
        const dim = !!selected && !sel
        return (
          <motion.button
            key={side}
            type="button"
            disabled={disabled}
            initial={reduce ? false : { x: side === 'a' ? -180 : 180, rotate: side === 'a' ? -25 : 25, opacity: 0 }}
            animate={{ x: 0, opacity: dim ? 0.5 : 1, rotate: sel ? 0 : st.tilt, scale: sel ? 1.06 : dim ? 0.93 : 1, y: sel ? -6 : 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 15, delay: selected ? 0 : 0.1 + i * 0.08 }}
            whileHover={disabled ? undefined : { scale: sel ? 1.08 : 1.03, rotate: 0 }}
            whileTap={disabled ? undefined : { scale: 0.9, rotate: st.tilt * 2 }}
            onClick={() => onPick?.(side)}
            aria-pressed={sel}
            aria-label={`${st.letter} : ${d[side]}`}
            className={cn(
              'sticker relative flex min-h-44 flex-col items-center justify-center gap-2 px-3 pt-6 pb-4 text-center hyphens-auto',
              st.bg,
              st.text,
              sel && 'shadow-sticker-lg',
              disabled && 'cursor-default',
            )}
          >
            <span className="absolute -top-4 left-1/2 flex size-9 -translate-x-1/2 items-center justify-center rounded-full border-[3px] border-ink bg-surface font-display text-lg font-extrabold text-text shadow-sticker-sm">
              {st.letter}
            </span>
            <span className="font-display text-xl leading-tight font-extrabold break-words">{d[side]}</span>
            {mark === side && (
              <span className="rounded-full border-2 border-ink bg-surface px-2 py-0.5 font-display text-xs font-extrabold text-text">🫵 ton choix</span>
            )}
            <AnimatePresence>
              {sel && (
                <motion.span
                  initial={{ scale: 0, rotate: -90 }}
                  animate={{ scale: 1, rotate: 0 }}
                  exit={{ scale: 0 }}
                  transition={{ type: 'spring', stiffness: 600, damping: 14 }}
                  className="absolute -top-3 -right-3 flex size-9 items-center justify-center rounded-full border-[3px] border-ink bg-mint text-[#1f1b2e] shadow-sticker-sm"
                >
                  <Check className="size-5" strokeWidth={4} />
                </motion.span>
              )}
            </AnimatePresence>
          </motion.button>
        )
      })}
      <motion.div
        initial={reduce ? false : { scale: 0, rotate: -200 }}
        animate={{ scale: 1, rotate: -8 }}
        transition={{ type: 'spring', stiffness: 400, damping: 12, delay: 0.35 }}
        className="pointer-events-none absolute top-1/2 left-1/2 z-10 -mt-5 -ml-6 flex size-12 items-center justify-center rounded-full border-[3px] border-ink bg-sun font-display text-base font-extrabold text-[#1f1b2e] shadow-sticker-sm"
      >
        OU
      </motion.div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Réponse (étape 1 : mon choix, étape 2 : pari sur la majorité)               */
/* -------------------------------------------------------------------------- */

type Step = 'choice' | 'bet' | 'done'
interface Draft {
  step: Step
  choice: TpSide | null
  bet: TpSide | null
}

function Answering({
  s, d, secret, meId, isHost, players, act, pending,
}: { s: TpState; d: TpDilemma; secret: unknown; meId: string; isHost: boolean; players: Record<string, PlayerInfo>; act: ActFn; pending: boolean }) {
  const isPlayer = s.players.includes(meId)
  const iAnswered = s.answered.includes(meId)
  const mine = isSecret(secret) && secret.round === s.round ? secret : null
  // Tant que je n'ai rien touché, l'état vient du serveur (secret) : utile après un rechargement.
  const [draft, setDraft] = useState<Draft | null>(null)
  const cur: Draft = draft ?? (mine ? { step: 'done', choice: mine.choice, bet: mine.bet } : iAnswered ? { step: 'done', choice: null, bet: null } : { step: 'choice', choice: null, bet: null })
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const theme = themeInfo(d.theme)
  const allAnswered = s.answered.length >= s.players.length
  const left = useCountdown(s.deadline, 100)

  // Filet : choix fait mais pari pas encore envoyé à la dernière seconde -> envoi auto (pari = mon choix).
  const autoSent = useRef(false)
  useEffect(() => {
    if (autoSent.current || !s.deadline || left > 1200 || left <= 0) return
    if (!isPlayer || cur.step === 'done' || !cur.choice) return
    autoSent.current = true
    const choice = cur.choice
    setDraft({ step: 'done', choice, bet: choice })
    void act(tpActions.answer(s.round, choice, choice))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left])

  const pickChoice = (side: TpSide) => {
    if (cur.step !== 'choice') return
    fx.pop()
    setDraft({ step: 'choice', choice: side, bet: cur.bet })
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      fx.whoosh()
      setDraft((p) => (p ? { ...p, step: 'bet' } : p))
    }, 520)
  }

  const pickBet = async (side: TpSide) => {
    if (cur.step !== 'bet' || !cur.choice) return
    const choice = cur.choice
    fx.pop()
    setDraft({ step: 'done', choice, bet: side })
    const res = await act(tpActions.answer(s.round, choice, side))
    if (!res) setDraft({ step: 'bet', choice, bet: null })
    else fx.success()
  }

  return (
    <>
      <motion.div
        initial={{ y: -120, rotate: -8, opacity: 0 }}
        animate={{ y: 0, rotate: -1.5, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 14 }}
        className="sticker flex flex-col gap-3 bg-surface p-4"
      >
        <div className="flex items-center justify-between gap-2">
          <Badge tone="neutral">
            Dilemme {s.round}/{s.total_rounds}
          </Badge>
          <span className="rounded-full border-2 border-ink px-2.5 py-0.5 font-display text-sm font-extrabold text-[#1f1b2e]" style={{ backgroundColor: theme.color }}>
            {theme.emoji} {theme.label}
          </span>
        </div>
        <p className="text-center font-display text-3xl font-extrabold">Tu préfères…</p>
        {d.by && (
          <div className="flex justify-center">
            <AuthorBadge by={d.by} />
          </div>
        )}
        <TimerBar deadline={s.deadline} totalMs={s.timer * 1000} />
      </motion.div>

      {isPlayer ? (
        <div className="relative min-h-72 overflow-x-clip">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={cur.step}
              initial={{ x: 90, opacity: 0, rotate: 3 }}
              animate={{ x: 0, opacity: 1, rotate: 0 }}
              exit={{ x: -90, opacity: 0, rotate: -3 }}
              transition={{ type: 'spring', stiffness: 380, damping: 28 }}
              className="flex flex-col gap-3"
            >
              {cur.step === 'choice' && (
                <>
                  <StepTitle n={1} emoji="🫵" title="Toi, tu préfères ?" hint="Choix secret, révélé à la fin de la manche." />
                  <DuelCards d={d} selected={cur.choice} onPick={pickChoice} />
                </>
              )}
              {cur.step === 'bet' && (
                <>
                  <StepTitle n={2} emoji="👥" title="Et la majorité ?" hint="Parie sur ce que choisiront le plus de joueurs : +1 si c’est juste !" />
                  <DuelCards d={d} selected={cur.bet} mark={cur.choice} onPick={(side) => void pickBet(side)} disabled={pending} />
                  <button
                    type="button"
                    className="mx-auto flex items-center gap-1 font-display font-extrabold text-muted underline"
                    onClick={() => setDraft({ step: 'choice', choice: cur.choice, bet: null })}
                  >
                    <Undo2 className="size-4" /> Changer mon choix
                  </button>
                </>
              )}
              {cur.step === 'done' && (
                <Recap d={d} choice={cur.choice} bet={cur.bet} onEdit={() => setDraft({ step: 'choice', choice: null, bet: null })} />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      ) : (
        <>
          <p className="text-center font-bold text-muted">Tu regardes cette partie : les joueurs choisissent…</p>
          <DuelCards d={d} selected={null} disabled />
        </>
      )}

      <VoterStrip ids={s.players} voters={s.answered} players={players} label="ont répondu" />

      {isHost && (
        <Button variant={allAnswered ? 'primary' : 'secondary'} fullWidth loading={pending} icon={<Eye className="size-5" />} onClick={() => void act(tpActions.reveal())}>
          {s.answered.length === 0 ? 'Révéler (personne n’a répondu)' : 'Révéler maintenant'}
        </Button>
      )}
    </>
  )
}

function StepTitle({ n, emoji, title, hint }: { n: number; emoji: string; title: string; hint: string }) {
  return (
    <div className="flex items-center gap-3">
      <motion.span
        initial={{ scale: 0, rotate: -30 }}
        animate={{ scale: 1, rotate: -6 }}
        transition={{ type: 'spring', stiffness: 500, damping: 12, delay: 0.1 }}
        className="flex size-12 shrink-0 items-center justify-center rounded-2xl border-[3px] border-ink bg-sun text-2xl shadow-sticker-sm"
      >
        {emoji}
      </motion.span>
      <div>
        <p className="font-display text-xs font-extrabold tracking-wide text-muted uppercase">Étape {n}/2</p>
        <p className="font-display text-2xl leading-tight font-extrabold">{title}</p>
        <p className="text-sm leading-snug text-muted">{hint}</p>
      </div>
    </div>
  )
}

function Recap({ d, choice, bet, onEdit }: { d: TpDilemma; choice: TpSide | null; bet: TpSide | null; onEdit: () => void }) {
  const Row = ({ label, side }: { label: string; side: TpSide }) => (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 font-display text-sm font-extrabold text-muted">{label}</span>
      <span className={cn('sticker-sm flex-1 truncate px-2 py-1 font-display font-extrabold', SIDE[side].bg, SIDE[side].text)}>
        {SIDE[side].letter} · {d[side]}
      </span>
    </div>
  )
  return (
    <div className="sticker flex flex-col gap-3 bg-surface p-4">
      <motion.p
        initial={{ scale: 0.6 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 500, damping: 12 }}
        className="text-center font-display text-2xl font-extrabold"
      >
        C’est dans la boîte ! 🗳️
      </motion.p>
      {choice && bet ? (
        <>
          <Row label="Toi" side={choice} />
          <Row label="La majorité" side={bet} />
        </>
      ) : (
        <p className="text-center text-muted">Réponse enregistrée.</p>
      )}
      <motion.p animate={{ opacity: [0.45, 1, 0.45] }} transition={{ repeat: Infinity, duration: 1.4 }} className="text-center font-bold text-muted">
        En attente des autres…
      </motion.p>
      <Button variant="ghost" size="sm" icon={<Pencil className="size-4" />} onClick={onEdit}>
        Modifier ma réponse
      </Button>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Révélation                                                                  */
/* -------------------------------------------------------------------------- */

const SPLIT_STEP = 1
const FLY_STEP = 2

function Reveal({ s, lr, meId, isHost, get, act, pending }: { s: TpState; lr: TpReveal; meId: string; isHost: boolean; get: Get; act: ActFn; pending: boolean }) {
  const reduce = useReducedMotion()
  // Ordre d'envol : alterné A / B (mélangé) pour garder le suspense. Calculé une fois par manche.
  const [order] = useState(() => {
    const shuffled = (side: TpSide) =>
      Object.keys(lr.choices)
        .filter((id) => lr.choices[id] === side)
        .sort((x, y) => hash01(`${lr.round}:${x}`) - hash01(`${lr.round}:${y}`))
    const a = shuffled('a')
    const b = shuffled('b')
    const out: string[] = []
    while (a.length || b.length) {
      if (a.length) out.push(a.shift()!)
      if (b.length) out.push(b.shift()!)
    }
    return out
  })
  const end = FLY_STEP + order.length
  const [step, setStep] = useState(reduce ? end : 0)
  const done = step >= end
  const flown = Math.max(0, Math.min(order.length, step - FLY_STEP))

  useEffect(() => {
    if (done) return
    const delay = step === 0 ? 1000 : step === SPLIT_STEP ? 1100 : Math.max(200, 420 - (step - FLY_STEP) * 30)
    const t = window.setTimeout(() => {
      if (step === 0) fx.whoosh()
      else fx.pop()
      setStep((n) => n + 1)
    }, delay)
    return () => clearTimeout(t)
  }, [step, done])

  const majRef = useRef<HTMLDivElement>(null)
  const celebrated = useRef(false)
  useEffect(() => {
    if (!done || celebrated.current) return
    celebrated.current = true
    if (lr.majority) {
      fx.fanfare()
      if (majRef.current) burstFrom(majRef.current, 90)
      else burst({ x: 0.5, y: 0.4 }, 90)
    }
    const g = lr.gains[meId] ?? 0
    if (meId in lr.choices) window.setTimeout(() => (g > 0 ? fx.success() : fx.fail()), 800)
  }, [done, lr, meId])

  const pct = percents(lr.counts)
  const total = lr.counts.a + lr.counts.b
  const split = step >= SPLIT_STEP
  const placed = new Set(order.slice(0, flown))
  const pool = order.filter((id) => !placed.has(id))
  const silent = s.players.filter((id) => !(id in lr.choices))
  const last = s.round >= s.total_rounds
  const unanimous = total >= 2 && (lr.counts.a === 0 || lr.counts.b === 0)

  return (
    <>
      {/* Rappel du dilemme */}
      <div className="grid grid-cols-2 gap-3 pt-2">
        {SIDES.map((side) => {
          const st = SIDE[side]
          const win = done && lr.majority === side
          return (
            <motion.div
              key={side}
              animate={{ rotate: win ? 0 : st.tilt, scale: win ? 1.04 : done && lr.majority ? 0.96 : 1, opacity: done && lr.majority && !win ? 0.7 : 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 14 }}
              className={cn('sticker relative p-3 text-center hyphens-auto', st.bg, st.text)}
            >
              <span className="font-display text-xs font-extrabold opacity-80">{st.letter}</span>
              <p className="font-display text-base leading-tight font-extrabold break-words">{lr.dilemma[side]}</p>
              <AnimatePresence>
                {win && (
                  <motion.span
                    initial={{ scale: 0, y: 20, rotate: -40 }}
                    animate={{ scale: 1, y: 0, rotate: -12 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 10 }}
                    className="absolute -top-5 -left-2 text-3xl"
                  >
                    👑
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.div>
          )
        })}
      </div>

      {/* La barre qui se scinde */}
      <div className="relative h-14 overflow-hidden rounded-full border-[3px] border-ink bg-sunk shadow-sticker">
        <div className="flex h-full">
          {SIDES.map((side) => (
            <motion.div
              key={side}
              className={cn('flex h-full items-center overflow-hidden', SIDE[side].bg, SIDE[side].text, side === 'a' ? 'justify-start pl-3' : 'justify-end pr-3')}
              initial={{ width: '50%' }}
              animate={{ width: split ? `${total ? pct[side] : 50}%` : '50%' }}
              transition={{ type: 'spring', stiffness: 120, damping: 16, delay: 0.15 }}
            >
              {split && (total ? pct[side] >= 12 : true) && (
                <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.4, type: 'spring', stiffness: 500, damping: 12 }} className="font-display text-2xl font-extrabold whitespace-nowrap">
                  <AnimatedNumber value={total ? pct[side] : 0} duration={1.1} />%
                </motion.span>
              )}
            </motion.div>
          ))}
        </div>
        {/* Rideau : s'ouvre par le centre */}
        <motion.div
          className="absolute inset-0 flex items-center justify-center bg-ink"
          initial={{ clipPath: 'inset(0% 0% 0% 0%)' }}
          animate={{ clipPath: split ? 'inset(0% 50% 0% 50%)' : 'inset(0% 0% 0% 0%)' }}
          transition={{ duration: 0.55, ease: [0.7, 0, 0.3, 1] }}
        >
          {!split && (
            <motion.span animate={{ opacity: [0.4, 1, 0.4], scale: [1, 1.08, 1] }} transition={{ repeat: Infinity, duration: 0.9 }} className="font-display text-xl font-extrabold text-paper">
              Verdict…
            </motion.span>
          )}
        </motion.div>
      </div>

      {/* Les avatars s'envolent de chaque côté */}
      <LayoutGroup id={`tp-${lr.round}`}>
        <div className="flex min-h-14 flex-wrap items-center justify-center gap-2">
          {pool.map((id) => (
            <PlayerChip key={id} id={id} lr={lr} get={get} done={false} />
          ))}
          {pool.length === 0 && !done && order.length > 0 && <span className="font-display font-extrabold text-muted">…</span>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {SIDES.map((side) => {
            const ids = order.filter((id) => placed.has(id) && lr.choices[id] === side)
            const win = done && lr.majority === side
            return (
              <div
                key={side}
                ref={lr.majority === side ? majRef : undefined}
                className={cn(
                  'flex min-h-32 flex-col items-center gap-2 rounded-card border-[3px] border-dashed p-2 transition-colors',
                  win ? 'border-solid border-ink bg-sun/25' : 'border-ink/30',
                )}
                style={{ backgroundColor: win ? undefined : `${SIDE[side].hex}1A` }}
              >
                <span className={cn('rounded-full border-2 border-ink px-2 font-display text-sm font-extrabold', SIDE[side].bg, SIDE[side].text)}>
                  {SIDE[side].letter} · {ids.length}
                </span>
                <div className="flex flex-wrap justify-center gap-2">
                  {ids.map((id) => (
                    <PlayerChip key={id} id={id} lr={lr} get={get} done={done} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </LayoutGroup>

      {done && silent.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-1.5 text-sm text-muted">
          <span className="font-bold">Pas répondu :</span>
          {silent.map((id) => (
            <span key={id} className="grayscale opacity-60">
              <Avatar slug={get(id).slug} expression={mood(get(id), 'sleepy')} size={28} />
            </span>
          ))}
        </div>
      )}

      {/* Verdict */}
      <AnimatePresence>
        {done && (
          <motion.div
            initial={{ scale: 0, rotate: -10 }}
            animate={{ scale: 1, rotate: -1 }}
            transition={{ type: 'spring', stiffness: 280, damping: 12 }}
            className={cn('sticker p-3 text-center font-display font-extrabold', lr.majority ? cn(SIDE[lr.majority].bg, SIDE[lr.majority].text) : 'bg-sun text-[#1f1b2e]')}
          >
            {total === 0 ? (
              <p className="text-xl">Personne n’a répondu ! 🦗</p>
            ) : lr.majority ? (
              <>
                <p className="text-sm opacity-85">{unanimous ? 'Unanimité ! 🤝' : 'La majorité préfère…'}</p>
                <p className="text-xl leading-tight">{lr.dilemma[lr.majority]}</p>
              </>
            ) : (
              <>
                <p className="text-xl">Égalité parfaite ! ⚖️</p>
                <p className="text-sm">Pas de majorité : personne ne marque sur son pari.</p>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {done && s.players.includes(meId) && <MyResult lr={lr} meId={meId} bonus={s.rebel_bonus} />}

      {!done && (
        <button type="button" className="mx-auto flex items-center gap-1 font-display font-extrabold text-muted underline" onClick={() => setStep(end)}>
          <FastForward className="size-4" /> Passer l’animation
        </button>
      )}

      {isHost && (
        <Button size="lg" fullWidth loading={pending} disabled={!done} icon={last ? <Trophy className="size-6" /> : <ArrowRight className="size-6" />} onClick={() => void act(tpActions.next())}>
          {last ? 'Voir les résultats' : 'Dilemme suivant'}
        </Button>
      )}
      {done && <NextIn deadline={s.deadline} label={last ? 'Résultats dans' : 'Dilemme suivant dans'} />}
    </>
  )
}

/** Avatar d'un joueur pendant la révélation (layoutId : il « vole » du centre vers son camp). */
function PlayerChip({ id, lr, get, done }: { id: string; lr: TpReveal; get: Get; done: boolean }) {
  const p = get(id)
  const ok = done && lr.bettors_ok.includes(id)
  const rebel = done && lr.rebels.includes(id)
  return (
    <motion.div
      layoutId={`tp-${lr.round}-${id}`}
      layout
      transition={{ type: 'spring', stiffness: 380, damping: 22 }}
      className="relative flex w-14 flex-col items-center"
    >
      <motion.div
        className="rounded-full"
        animate={ok ? { boxShadow: ['0 0 0 0px rgba(255,183,3,0.95)', '0 0 0 12px rgba(255,183,3,0)'], scale: [1, 1.12, 1] } : { boxShadow: '0 0 0 0px rgba(255,183,3,0)', scale: 1 }}
        transition={ok ? { repeat: Infinity, duration: 1.3 } : { duration: 0.2 }}
      >
        <Avatar
          slug={p.slug}
          expression={!done ? mood(p, 'think') : ok ? mood(p, 'proud') : mood(p, 'shocked')}
          size={48}
          badge={ok ? '🎯' : undefined}
        />
      </motion.div>
      {rebel && (
        <motion.span
          initial={{ scale: 0, rotate: 30 }}
          animate={{ scale: 1, rotate: -8 }}
          transition={{ type: 'spring', stiffness: 500, damping: 10, delay: 0.3 }}
          className="absolute -top-2 -left-3 rounded-full border-2 border-ink bg-grape px-1 font-display text-[10px] font-extrabold text-white"
        >
          🤘 rebelle
        </motion.span>
      )}
      <span className={cn('max-w-full truncate font-display text-xs font-extrabold', ok && 'text-tangerine')}>{p.nickname}</span>
    </motion.div>
  )
}

function MyResult({ lr, meId, bonus }: { lr: TpReveal; meId: string; bonus: boolean }) {
  const answered = meId in lr.choices
  const g = lr.gains[meId] ?? 0
  const ok = lr.bettors_ok.includes(meId)
  const rebel = lr.rebels.includes(meId)
  const bet = lr.bets[meId]
  return (
    <motion.div
      initial={{ scale: 0, y: 30 }}
      animate={{ scale: 1, y: 0 }}
      transition={{ delay: 0.5, type: 'spring', stiffness: 400, damping: 12 }}
      className={cn('sticker flex flex-col items-center gap-1 p-3 text-center font-display font-extrabold', g > 0 ? 'bg-mint text-[#1f1b2e]' : 'bg-sunk')}
    >
      {!answered ? (
        <p className="text-lg">Tu n’as pas répondu cette fois ! 😴</p>
      ) : (
        <>
          {g > 0 && (
            <motion.span initial={{ scale: 3, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={{ delay: 0.7, type: 'spring', stiffness: 400, damping: 10 }} className="text-4xl">
              +{g}
            </motion.span>
          )}
          {ok ? (
            <p className="text-lg">🎯 Bien vu, tu connais ta bande !</p>
          ) : lr.majority ? (
            <p className="text-lg">Raté… tu pariais sur « {bet ? lr.dilemma[bet] : '?'} »</p>
          ) : (
            <p className="text-lg">Égalité : pas de point de pari.</p>
          )}
          {rebel && <p className="text-base">🤘 Seul·e de ton avis {bonus ? ': +1 Rebelle !' : '(bonus désactivé)'}</p>}
        </>
      )}
    </motion.div>
  )
}

/* -------------------------------------------------------------------------- */
/* Scores cumulés                                                              */
/* -------------------------------------------------------------------------- */

function Scores({ s, meId, get }: { s: TpState; meId: string; get: Get }) {
  const sorted = [...s.players].sort((a, b) => (s.scores[b] ?? 0) - (s.scores[a] ?? 0))
  return (
    <div className="sticker bg-sunk p-3">
      <p className="mb-2 flex items-center gap-1.5 font-display font-extrabold">
        <Trophy className="size-4" /> Scores
      </p>
      <LayoutGroup id="tp-scores">
        <div className="flex flex-wrap gap-2">
          {sorted.map((id) => {
            const p = get(id)
            const sc = s.scores[id] ?? 0
            return (
              <motion.div layout key={id} className={cn('sticker-sm flex items-center gap-1.5 bg-surface py-0.5 pr-2.5 pl-0.5', id === meId && 'ring-2 ring-sun')}>
                <Avatar slug={p.slug} size={28} />
                <span className="text-sm font-bold">{p.nickname}</span>
                <motion.span key={sc} initial={{ scale: 2.2, color: '#06D6A0' }} animate={{ scale: 1, color: 'var(--text)' }} className="font-display font-extrabold">
                  {sc}
                </motion.span>
              </motion.div>
            )
          })}
        </div>
      </LayoutGroup>
    </div>
  )
}
