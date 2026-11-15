import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, Check, FastForward, Flag, ThumbsDown, ThumbsUp, Trophy } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { burst, burstFrom, confettiRain } from '@/components/ui/confetti'
import { fx } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import { ConfirmModal, VoterStrip } from '@/features/soiree/components'
import { mood, playerOrPlaceholder } from '@/features/soiree/players'
import { serverNow, useCountdown } from '@/features/soiree/useServerClock'
import type { GamePlayProps, PlayerInfo } from '../types'
import type { AovCard, AovKind, AovResult, AovState } from './types'
import { AOV_LEVELS, KIND_INFO, aovActions } from './setup'
import { Wheel } from './Wheel'

type Get = (id: string) => PlayerInfo
type ActFn = GamePlayProps['act']

interface PhaseProps {
  s: AovState
  meId: string
  isHost: boolean
  get: Get
  players: Record<string, PlayerInfo>
  act: ActFn
  pending: boolean
}

/** Durées de référence des phases (= _aov_const côté SQL) pour les barres de temps. */
const CHOOSE_MS = 15_000
const VOTE_MS = 30_000
const PERFORM_MS = 150_000
const SOFT_MS = 60_000
const AUTO_MS = 12_000

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
      if (sent++ < 6) void act(aovActions.tick())
    }
    const first = window.setTimeout(send, 150 + Math.random() * 450)
    const retry = window.setInterval(send, 2500)
    return () => {
      clearTimeout(first)
      clearInterval(retry)
    }
  }, [expired, deadline, act])
}

export default function ActionVeritePlay({ state, meId, isHost, players, act, pending }: GamePlayProps) {
  const s = state as unknown as AovState
  const get: Get = (id) => playerOrPlaceholder(players, id)
  const live = s.phase === 'choose' || s.phase === 'vote' || s.phase === 'perform' || s.phase === 'result'
  useDeadlineTick(live ? s.deadline : null, act)
  const p: PhaseProps = { s, meId, isHost, get, players, act, pending }

  return (
    <div className="flex flex-col gap-4 pb-6">
      {s.phase === 'choose' && <ChoosePhase key={`c${s.round}`} {...p} />}
      {s.phase === 'vote' && <VotePhase key={`v${s.round}`} {...p} />}
      {s.phase === 'perform' && s.card && <PerformPhase key={`p${s.round}`} {...p} card={s.card} />}
      {s.phase === 'result' && s.last_result && <ResultPhase key={`r${s.round}`} {...p} r={s.last_result} />}
      <Scores s={s} meId={meId} get={get} />
      {isHost && live && <HostBar s={s} act={act} pending={pending} />}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Petits composants                                                           */
/* -------------------------------------------------------------------------- */

function TimerBar({ deadline, totalMs, label }: { deadline: string | null; totalMs: number; label?: string }) {
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
      {label && <span className="shrink-0 font-display text-sm font-extrabold text-muted">{label}</span>}
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

function KindBadge({ kind, big, random }: { kind: AovKind; big?: boolean; random?: boolean }) {
  const k = KIND_INFO[kind]
  return (
    <motion.span
      initial={{ scale: 0, rotate: -30 }}
      animate={{ scale: 1, rotate: -4 }}
      transition={{ type: 'spring', stiffness: 500, damping: 11 }}
      className={cn(
        'inline-flex items-center gap-1.5 self-center rounded-full border-[3px] border-ink font-display font-extrabold shadow-sticker-sm',
        big ? 'px-5 py-1.5 text-3xl' : 'px-3 py-0.5 text-base',
        k.text,
      )}
      style={{ backgroundColor: k.color }}
    >
      {k.emoji} {k.label}
      {random && <span className="text-sm opacity-90">🎲</span>}
    </motion.span>
  )
}

function levelInfo(level: number) {
  return AOV_LEVELS.find((l) => l.id === level) ?? AOV_LEVELS[0]
}

/** Avatar du désigné + titre, en tête de chaque phase. */
function TargetHeader({ s, get, meId, title }: { s: AovState; get: Get; meId: string; title: string }) {
  const t = get(s.target)
  const me = s.target === meId
  return (
    <div className="sticker flex items-center gap-3 bg-surface p-3">
      <Avatar slug={t.slug} expression={mood(t, 'shy')} size={56} bounce />
      <div className="min-w-0 flex-1">
        <p className="font-display text-xs font-extrabold tracking-wide text-muted uppercase">{title}</p>
        <p className="truncate font-display text-2xl leading-tight font-extrabold">{me ? 'Toi ! 🫵' : t.nickname}</p>
      </div>
      {s.kind && <KindBadge kind={s.kind} random={s.kind_random} />}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* 1. La roue + choix action / vérité                                          */
/* -------------------------------------------------------------------------- */

function ChoosePhase({ s, meId, get, act, pending }: PhaseProps) {
  const [spun, setSpun] = useState(() => serverNow() >= new Date(s.spin.until).getTime())
  const wheelPlayers = s.players.map(get)
  const t = get(s.target)
  const me = s.target === meId
  const [sent, setSent] = useState<AovKind | null>(null)

  const onDone = () => {
    if (spun) return
    setSpun(true)
    fx.fanfare()
    burst({ x: 0.5, y: 0.35 }, me ? 140 : 70)
  }

  const choose = async (kind: AovKind) => {
    if (sent) return
    fx.whoosh()
    setSent(kind)
    const res = await act(aovActions.choose(kind))
    if (!res) setSent(null)
  }

  return (
    <AnimatePresence mode="wait">
      {!spun ? (
        <motion.div key="wheel" exit={{ scale: 0.4, opacity: 0, rotate: 20 }} transition={{ duration: 0.35 }} className="flex flex-col items-center gap-3">
          <motion.p
            animate={{ scale: [1, 1.06, 1], rotate: [-2, 2, -2] }}
            transition={{ repeat: Infinity, duration: 0.8 }}
            className="text-center font-display text-3xl font-extrabold"
          >
            Qui va passer à la casserole ? 🍳
          </motion.p>
          <Wheel players={wheelPlayers} spin={s.spin} onDone={onDone} size={Math.min(320, typeof window !== 'undefined' ? window.innerWidth - 48 : 300)} />
          <p className="text-center font-bold text-muted">Tour {s.round}{s.total_rounds ? `/${s.total_rounds}` : ''} · la roue tourne…</p>
        </motion.div>
      ) : (
        <motion.div key="chosen" initial={{ scale: 0.3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 14 }} className="flex flex-col gap-4">
          <div className="sticker relative flex flex-col items-center gap-2 overflow-hidden bg-bubblegum p-5 text-[#1f1b2e]">
            <motion.div
              className="pointer-events-none absolute inset-0 opacity-30"
              style={{ background: 'repeating-conic-gradient(from 0deg, #fff 0deg 10deg, transparent 10deg 20deg)' }}
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 14, ease: 'linear' }}
            />
            <motion.div initial={{ y: -80, rotate: -20 }} animate={{ y: 0, rotate: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 9 }} className="relative">
              <Avatar slug={t.slug} expression={mood(t, me ? 'shocked' : 'sly')} size={120} bounce />
            </motion.div>
            <p className="relative text-center font-display text-4xl leading-none font-extrabold">{me ? 'C’est à TOI !' : `C’est à ${t.nickname} !`}</p>
            <p className="relative font-bold">{me ? 'Alors… tu choisis quoi ?' : `${t.nickname} choisit…`}</p>
          </div>

          <TimerBar deadline={s.deadline} totalMs={CHOOSE_MS} />

          {me ? (
            <div className="grid grid-cols-2 gap-3">
              {(['action', 'verite'] as const).map((kind, i) => {
                const k = KIND_INFO[kind]
                const chosen = sent === kind
                return (
                  <motion.button
                    key={kind}
                    type="button"
                    disabled={!!sent || pending}
                    initial={{ y: 120, rotate: i ? 12 : -12, opacity: 0 }}
                    animate={{ y: 0, rotate: chosen ? 0 : i ? 3 : -3, opacity: sent && !chosen ? 0.4 : 1, scale: chosen ? 1.08 : 1 }}
                    transition={{ type: 'spring', stiffness: 320, damping: 13, delay: 0.15 + i * 0.1 }}
                    whileHover={{ scale: 1.05, rotate: 0 }}
                    whileTap={{ scale: 0.88 }}
                    onClick={() => void choose(kind)}
                    className={cn('sticker flex min-h-48 flex-col items-center justify-center gap-2 p-3 shadow-sticker-lg', k.text)}
                    style={{ backgroundColor: k.color }}
                  >
                    <motion.span animate={{ scale: [1, 1.2, 1], rotate: [0, i ? 10 : -10, 0] }} transition={{ repeat: Infinity, duration: 1.1, delay: i * 0.3 }} className="text-6xl">
                      {k.emoji}
                    </motion.span>
                    <span className="font-display text-3xl font-extrabold">{k.label}</span>
                  </motion.button>
                )
              })}
            </div>
          ) : (
            <div className="flex items-center justify-center gap-4 py-2">
              {(['action', 'verite'] as const).map((kind, i) => (
                <motion.span
                  key={kind}
                  animate={{ y: [0, -10, 0], rotate: [0, i ? 6 : -6, 0] }}
                  transition={{ repeat: Infinity, duration: 0.9, delay: i * 0.45 }}
                  className={cn('rounded-card border-[3px] border-ink px-4 py-2 font-display text-xl font-extrabold shadow-sticker-sm', KIND_INFO[kind].text)}
                  style={{ backgroundColor: KIND_INFO[kind].color }}
                >
                  {KIND_INFO[kind].emoji} {KIND_INFO[kind].label}
                </motion.span>
              ))}
            </div>
          )}
          {me && <p className="text-center text-sm font-bold text-muted">Pas de choix avant la fin du chrono = tirage au sort 🎲</p>}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* -------------------------------------------------------------------------- */
/* 2. Les autres votent pour une des 3 cartes                                  */
/* -------------------------------------------------------------------------- */

function MiniCard({ c, index, selected, onPick, disabled, footer }: { c: AovCard; index: number; selected?: boolean; onPick?: () => void; disabled?: boolean; footer?: ReactNode }) {
  const lv = levelInfo(c.level)
  return (
    <motion.button
      type="button"
      disabled={disabled}
      initial={{ x: index % 2 ? 200 : -200, rotate: index % 2 ? 15 : -15, opacity: 0 }}
      animate={{ x: 0, rotate: selected ? 0 : (index - 1) * 1.5, opacity: 1, scale: selected ? 1.04 : 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 18, delay: 0.1 + index * 0.12 }}
      whileTap={disabled ? undefined : { scale: 0.94 }}
      onClick={onPick}
      aria-pressed={selected}
      className={cn(
        'sticker relative flex items-start gap-3 bg-surface p-3 text-left',
        selected && 'bg-sun text-[#1f1b2e] shadow-sticker-lg',
        disabled && 'cursor-default',
      )}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full border-[3px] border-ink bg-surface font-display text-lg font-extrabold text-text">
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-display text-lg leading-snug font-extrabold break-words">{c.text}</p>
        <span className="mt-1 inline-block rounded-full border-2 border-ink px-2 text-xs font-extrabold text-[#1f1b2e]" style={{ backgroundColor: lv.color }}>
          {lv.emoji} {lv.label}
        </span>
        {footer}
      </div>
      <AnimatePresence>
        {selected && (
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
}

function VotePhase({ s, meId, get, players, act, pending }: PhaseProps) {
  const t = get(s.target)
  const me = s.target === meId
  const isVoter = s.players.includes(meId) && !me
  const voters = s.players.filter((id) => id !== s.target)
  const [mine, setMine] = useState<number | null>(null)
  const iVoted = s.voted.includes(meId)
  const kind = s.kind ?? 'action'

  const vote = async (i: number) => {
    if (pending) return
    fx.pop()
    const prev = mine
    setMine(i)
    const res = await act(aovActions.voteCard(i))
    if (!res) setMine(prev)
  }

  if (me) {
    return (
      <>
        <TargetHeader s={s} get={get} meId={meId} title="Sur la sellette" />
        <div className="sticker relative flex flex-col items-center gap-4 overflow-hidden bg-ink p-6 text-paper">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <motion.span
              key={i}
              className="pointer-events-none absolute text-2xl"
              style={{ left: `${10 + i * 15}%`, top: '80%' }}
              animate={{ y: [-10, -220], opacity: [0, 1, 0], rotate: [0, i % 2 ? 40 : -40] }}
              transition={{ repeat: Infinity, duration: 2.6, delay: i * 0.4, ease: 'easeOut' }}
            >
              {['😈', '🔮', '✨', '🤭', '👀', '🎲'][i]}
            </motion.span>
          ))}
          <motion.span animate={{ rotate: [0, 360] }} transition={{ repeat: Infinity, duration: 3, ease: 'linear' }} className="text-7xl">
            🔮
          </motion.span>
          <motion.p animate={{ opacity: [0.6, 1, 0.6], scale: [1, 1.04, 1] }} transition={{ repeat: Infinity, duration: 1.4 }} className="text-center font-display text-3xl leading-tight font-extrabold">
            Les autres choisissent ton destin…
          </motion.p>
          <p className="text-center font-bold opacity-80">
            Tu as choisi <span style={{ color: KIND_INFO[kind].color }}>{KIND_INFO[kind].label}</span>
            {s.kind_random ? ' (enfin, le hasard a choisi pour toi 🎲)' : ''}. Trop tard pour reculer !
          </p>
          <Avatar slug={t.slug} expression={mood(t, 'shocked')} size={72} />
        </div>
        <TimerBar deadline={s.deadline} totalMs={VOTE_MS} />
        <VoterStrip ids={voters} voters={s.voted} players={players} label="ont choisi" />
      </>
    )
  }

  return (
    <>
      <TargetHeader s={s} get={get} meId={meId} title="Victime du tour" />
      {s.kind_random && (
        <p className="text-center font-display font-extrabold text-muted">⏰ Trop lent ! Le hasard a choisi : {KIND_INFO[kind].label}</p>
      )}
      <p className="text-center font-display text-2xl leading-tight font-extrabold">
        {isVoter ? `Quelle ${kind === 'action' ? 'action' : 'vérité'} pour ${t.nickname} ? 😈` : `Les joueurs choisissent pour ${t.nickname}…`}
      </p>
      <TimerBar deadline={s.deadline} totalMs={VOTE_MS} />
      <div className="flex flex-col gap-3 pt-2">
        {s.proposals.map((c, i) => (
          <MiniCard key={c.id} c={c} index={i} selected={mine === i} disabled={!isVoter || pending} onPick={isVoter ? () => void vote(i) : undefined} />
        ))}
      </div>
      {isVoter && (
        <p className="text-center text-sm font-bold text-muted">
          {iVoted && mine === null ? 'Vote enregistré (tu peux encore changer d’avis).' : 'Vote secret ; tu peux changer d’avis jusqu’au dépouillement.'}
        </p>
      )}
      <VoterStrip ids={voters} voters={s.voted} players={players} label="ont choisi" />
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* 3. Révélation + réalisation + jugement                                      */
/* -------------------------------------------------------------------------- */

function SoftTimer({ until }: { until: string }) {
  const left = useCountdown(until, 200)
  const total = SOFT_MS
  const secs = Math.ceil(left / 1000)
  const started = left <= total
  const pct = Math.max(0, Math.min(1, left / total))
  const over = left <= 0
  const prev = useRef(over)
  useEffect(() => {
    if (over && !prev.current) fx.fail()
    prev.current = over
  }, [over])
  const r = 26
  const circ = 2 * Math.PI * r
  return (
    <div className="flex items-center justify-center gap-3">
      <div className="relative size-16">
        <svg viewBox="0 0 64 64" className="size-full -rotate-90">
          <circle cx="32" cy="32" r={r} fill="var(--surface)" stroke="var(--ink)" strokeWidth="5" />
          <circle cx="32" cy="32" r={r} fill="none" stroke={pct > 0.3 ? '#06D6A0' : '#EF476F'} strokeWidth="5" strokeDasharray={circ} strokeDashoffset={circ * (1 - (started ? pct : 1))} strokeLinecap="round" />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center font-display text-lg font-extrabold">{over ? '⏰' : started ? secs : '60'}</span>
      </div>
      <span className="font-display font-extrabold text-muted">{over ? 'Temps écoulé ! (on est sympas, ça compte quand même si c’est fait)' : 'Chrono doux : 60 s pour le faire'}</span>
    </div>
  )
}

function PerformPhase({ s, meId, get, players, act, pending, card }: PhaseProps & { card: AovCard }) {
  const reduce = useReducedMotion()
  const t = get(s.target)
  const me = s.target === meId
  const isVoter = s.players.includes(meId) && !me
  const voters = s.players.filter((id) => id !== s.target)
  const [revealed, setRevealed] = useState(!!reduce)
  const [verdict, setVerdict] = useState<boolean | null>(null)
  const [confirmRefuse, setConfirmRefuse] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const k = KIND_INFO[card.kind]
  const cv = s.card_vote

  // Roulement de tambour puis retournement de la carte.
  useEffect(() => {
    if (revealed) return
    let n = 0
    const drum = window.setInterval(() => {
      n++
      fx.tick()
      if (n > 12) window.clearInterval(drum)
    }, 110)
    const tm = window.setTimeout(() => {
      setRevealed(true)
      fx.fanfare()
      if (cardRef.current) burstFrom(cardRef.current, 80)
    }, 1700)
    return () => {
      window.clearInterval(drum)
      window.clearTimeout(tm)
    }
  }, [revealed])

  const judge = async (ok: boolean) => {
    const prev = verdict
    setVerdict(ok)
    if (ok) fx.success()
    else fx.fail()
    const res = await act(aovActions.voteResult(ok))
    if (!res) setVerdict(prev)
  }

  const refuse = async () => {
    const res = await act(aovActions.refuse())
    if (res) setConfirmRefuse(false)
  }

  return (
    <>
      <TargetHeader s={s} get={get} meId={meId} title={me ? 'À toi de jouer !' : `Au tour de ${t.nickname}`} />

      {/* La carte, ÉNORME */}
      <div className="relative [perspective:1200px]">
        <motion.div
          ref={cardRef}
          initial={false}
          animate={revealed ? { rotateY: 0, scale: 1, rotate: -1.5 } : { rotateY: 180, scale: [0.9, 0.95, 0.9], rotate: [-2, 2, -2] }}
          transition={revealed ? { type: 'spring', stiffness: 160, damping: 13 } : { repeat: Infinity, duration: 0.5 }}
          className={cn('sticker relative flex min-h-64 flex-col items-center justify-center gap-3 p-6 text-center shadow-sticker-lg', k.text)}
          style={{ backgroundColor: k.color, transformStyle: 'preserve-3d' }}
        >
          {revealed ? (
            <>
              <span className="absolute top-3 left-3 rounded-full border-2 border-ink bg-surface px-2 font-display text-sm font-extrabold text-text">
                {k.emoji} {k.label}
              </span>
              <span className="absolute top-3 right-3 rounded-full border-2 border-ink px-2 text-xs font-extrabold text-[#1f1b2e]" style={{ backgroundColor: levelInfo(card.level).color }}>
                {levelInfo(card.level).emoji} {levelInfo(card.level).label}
              </span>
              <motion.p
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.25, type: 'spring', stiffness: 300, damping: 12 }}
                className="pt-6 font-display text-3xl leading-tight font-extrabold break-words hyphens-auto"
              >
                {card.text}
              </motion.p>
            </>
          ) : (
            <span className="font-display text-6xl font-extrabold" style={{ transform: 'rotateY(180deg)' }}>
              ❓
            </span>
          )}
        </motion.div>
      </div>

      {!revealed && (
        <motion.p animate={{ opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 0.6 }} className="text-center font-display text-2xl font-extrabold">
          Le destin a choisi… 🥁
        </motion.p>
      )}

      {revealed && (
        <>
          {cv && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }} className="flex flex-col gap-1.5">
              {cv.random && (
                <p className="text-center font-display font-extrabold text-tangerine">
                  {cv.counts.every((c) => c === 0) ? '🦗 Personne n’a voté : tirage au sort !' : '⚖️ Égalité : tirage au sort parmi les ex-aequo ! 🎲'}
                </p>
              )}
              <div className="flex flex-wrap justify-center gap-2">
                {s.proposals.map((c, i) => {
                  const who = Object.keys(cv.votes).filter((v) => cv.votes[v] === i)
                  return (
                    <div key={c.id} className={cn('flex items-center gap-1 rounded-full border-2 border-ink px-2 py-0.5 text-xs font-bold', i === cv.winner ? 'bg-sun text-[#1f1b2e]' : 'bg-sunk opacity-70')}>
                      <span className="font-display font-extrabold">#{i + 1}</span>
                      <span>· {cv.counts[i] ?? 0} vote{(cv.counts[i] ?? 0) > 1 ? 's' : ''}</span>
                      {who.map((id) => (
                        <Avatar key={id} slug={get(id).slug} size={20} />
                      ))}
                    </div>
                  )
                })}
              </div>
            </motion.div>
          )}

          {s.timer_until && <SoftTimer until={s.timer_until} />}
          {!s.timer_until && card.kind === 'verite' && (
            <p className="text-center font-display font-extrabold text-muted">🗣️ Réponds à voix haute… et sans mentir !</p>
          )}

          {me && (
            <div className="flex flex-col gap-3">
              <div className="sticker flex flex-col items-center gap-1 bg-mint p-3 text-center text-[#1f1b2e]">
                <p className="font-display text-xl font-extrabold">{card.kind === 'action' ? 'Fais-le devant tout le monde ! 💪' : 'Dis toute la vérité ! 🤞'}</p>
                <p className="text-sm font-bold">Les autres vont juger : majorité de 👍 = +1 point.</p>
              </div>
              <Button variant="danger" fullWidth icon={<Flag className="size-5" />} onClick={() => setConfirmRefuse(true)}>
                Refuser (gage !)
              </Button>
            </div>
          )}

          {isVoter && (
            <div className="flex flex-col gap-2">
              <p className="text-center font-display text-xl font-extrabold">{t.nickname} a réussi ?</p>
              <div className="grid grid-cols-2 gap-3">
                {([true, false] as const).map((ok) => {
                  const sel = verdict === ok
                  return (
                    <motion.button
                      key={String(ok)}
                      type="button"
                      disabled={pending}
                      whileTap={{ scale: 0.85, rotate: ok ? -8 : 8 }}
                      animate={{ scale: sel ? 1.07 : verdict !== null ? 0.94 : 1, opacity: verdict !== null && !sel ? 0.55 : 1 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 14 }}
                      onClick={() => void judge(ok)}
                      aria-pressed={sel}
                      className={cn(
                        'sticker flex min-h-28 flex-col items-center justify-center gap-1 font-display text-xl font-extrabold',
                        ok ? 'bg-mint text-[#1f1b2e]' : 'bg-tomato text-white',
                        sel && 'shadow-sticker-lg',
                      )}
                    >
                      {ok ? <ThumbsUp className="size-10" strokeWidth={2.5} /> : <ThumbsDown className="size-10" strokeWidth={2.5} />}
                      {ok ? 'Réussi' : 'Raté'}
                    </motion.button>
                  )
                })}
              </div>
              <p className="text-center text-sm font-bold text-muted">
                {s.validated.includes(meId) && verdict === null ? 'Verdict enregistré (modifiable).' : 'Verdict secret jusqu’à ce que tout le monde ait jugé.'}
              </p>
            </div>
          )}

          <VoterStrip ids={voters} voters={s.validated} players={players} label="ont jugé" />
          <TimerBar deadline={s.deadline} totalMs={PERFORM_MS} label="Verdict auto" />
        </>
      )}

      <ConfirmModal
        open={confirmRefuse}
        onClose={() => setConfirmRefuse(false)}
        onConfirm={() => void refuse()}
        title="Refuser la carte ? 🐔"
        confirmLabel="Je refuse"
        danger
        loading={pending}
      >
        Tu ne marques pas de point et tu écopes d’un <b>gage</b> tiré au sort !
      </ConfirmModal>
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* 4. Verdict                                                                  */
/* -------------------------------------------------------------------------- */

const OUTCOME = {
  success: { title: 'RÉUSSI !', emoji: '🏆', bg: 'bg-mint text-[#1f1b2e]', mood: 'proud' },
  fail: { title: 'RATÉ…', emoji: '💥', bg: 'bg-tomato text-white', mood: 'sad' },
  refused: { title: 'REFUSÉ !', emoji: '🐔', bg: 'bg-sun text-[#1f1b2e]', mood: 'shy' },
} as const

function ResultPhase({ s, meId, isHost, get, act, pending, r }: PhaseProps & { r: AovResult }) {
  const t = get(r.target)
  const o = OUTCOME[r.outcome]
  const me = r.target === meId
  const last = s.total_rounds > 0 && s.round >= s.total_rounds
  const boxRef = useRef<HTMLDivElement>(null)
  const autoLeft = useCountdown(s.auto ? s.deadline : null, 250)

  useEffect(() => {
    if (r.outcome === 'success') {
      fx.fanfare()
      if (boxRef.current) burstFrom(boxRef.current, 120)
      if (me) confettiRain(1800)
    } else if (r.outcome === 'fail') fx.fail()
    else fx.whoosh()
  }, [r.outcome, me])

  const voters = Object.keys(r.votes)

  return (
    <>
      <motion.div
        ref={boxRef}
        initial={{ scale: 0, rotate: -25 }}
        animate={r.outcome === 'fail' ? { scale: 1, rotate: [-1, 4, -4, 3, -2, -1] } : { scale: 1, rotate: -2 }}
        transition={r.outcome === 'fail' ? { duration: 0.6 } : { type: 'spring', stiffness: 260, damping: 10 }}
        className={cn('sticker relative flex flex-col items-center gap-2 overflow-hidden p-5 text-center', o.bg)}
      >
        <motion.div initial={{ y: -60 }} animate={{ y: 0 }} transition={{ type: 'spring', stiffness: 400, damping: 9, delay: 0.15 }}>
          <Avatar slug={t.slug} expression={mood(t, o.mood)} size={104} badge={o.emoji} />
        </motion.div>
        <p className="font-display text-5xl leading-none font-extrabold">{o.title}</p>
        <p className="font-display text-xl font-extrabold">
          {r.outcome === 'success'
            ? `${me ? 'Bravo, tu gagnes' : `${t.nickname} gagne`} +1 point !`
            : r.outcome === 'fail'
              ? `${me ? 'Pas de point pour toi' : `Pas de point pour ${t.nickname}`}…`
              : `${me ? 'Tu as' : `${t.nickname} a`} pris la poudre d’escampette !`}
        </p>
        {r.outcome === 'success' && (
          <motion.span initial={{ scale: 4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.5, type: 'spring', stiffness: 400, damping: 10 }} className="absolute top-3 right-4 font-display text-4xl font-extrabold">
            +1
          </motion.span>
        )}
      </motion.div>

      {r.outcome === 'refused' && r.gage && (
        <motion.div
          initial={{ y: 200, rotate: 20, opacity: 0 }}
          animate={{ y: 0, rotate: [-3, 2, -3], opacity: 1 }}
          transition={{ y: { type: 'spring', stiffness: 200, damping: 12, delay: 0.5 }, opacity: { delay: 0.5 }, rotate: { repeat: Infinity, duration: 2.2, delay: 1 } }}
          className="sticker flex flex-col items-center gap-2 bg-grape p-5 text-center text-white shadow-sticker-lg"
        >
          <span className="rounded-full border-2 border-ink bg-sun px-3 font-display text-lg font-extrabold text-[#1f1b2e]">🎁 GAGE</span>
          <p className="font-display text-3xl leading-tight font-extrabold">{r.gage}</p>
        </motion.div>
      )}

      <div className="sticker-sm flex flex-col gap-1 bg-sunk p-3">
        <span className="font-display text-xs font-extrabold text-muted uppercase">
          {KIND_INFO[r.kind].emoji} {KIND_INFO[r.kind].label}
        </span>
        <p className="font-bold">{r.card.text}</p>
      </div>

      {voters.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-center font-display font-extrabold">
            👍 {r.up} · 👎 {r.down}
          </p>
          <LayoutGroup>
            <div className="flex flex-wrap justify-center gap-3">
              {voters.map((id, i) => {
                const p = get(id)
                const up = r.votes[id]
                return (
                  <motion.div
                    key={id}
                    initial={{ scale: 0, y: 30 }}
                    animate={{ scale: 1, y: 0 }}
                    transition={{ delay: 0.4 + i * 0.15, type: 'spring', stiffness: 500, damping: 12 }}
                    className="flex w-16 flex-col items-center"
                  >
                    <Avatar slug={p.slug} expression={mood(p, up ? 'happy' : 'angry')} size={48} badge={up ? '👍' : '👎'} />
                    <span className="max-w-full truncate font-display text-xs font-extrabold">{p.nickname}</span>
                  </motion.div>
                )
              })}
            </div>
          </LayoutGroup>
        </div>
      )}
      {voters.length === 0 && r.outcome === 'fail' && <p className="text-center font-bold text-muted">Personne n’a jugé à temps 🦗</p>}

      {s.auto && s.deadline && (
        <p className="text-center font-display font-extrabold text-muted">
          {last ? 'Résultats' : 'Tour suivant'} dans {Math.ceil(autoLeft / 1000)} s…
          <span className="mx-auto mt-1 block h-2 w-40 overflow-hidden rounded-full border-2 border-ink bg-sunk">
            <span className="block h-full bg-sun transition-[width] duration-200" style={{ width: `${Math.max(0, Math.min(100, (autoLeft / AUTO_MS) * 100))}%` }} />
          </span>
        </p>
      )}

      {isHost ? (
        <Button size="lg" fullWidth loading={pending} icon={last ? <Trophy className="size-6" /> : <ArrowRight className="size-6" />} onClick={() => void act(aovActions.next(s.round))}>
          {last ? 'Voir les résultats' : 'Tour suivant'}
        </Button>
      ) : (
        <p className="text-center font-bold text-muted">L’hôte va relancer la roue…</p>
      )}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Hôte : passer / arrêter                                                     */
/* -------------------------------------------------------------------------- */

function HostBar({ s, act, pending }: { s: AovState; act: ActFn; pending: boolean }) {
  const [confirm, setConfirm] = useState(false)
  const skipLabel =
    s.phase === 'choose' ? 'Choix au hasard' : s.phase === 'vote' ? 'Dépouiller maintenant' : s.phase === 'perform' ? 'Clore le verdict' : null
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {skipLabel && (
        <Button variant="secondary" size="sm" loading={pending} icon={<FastForward className="size-4" />} onClick={() => void act(aovActions.next())}>
          {skipLabel}
        </Button>
      )}
      <Button variant="ghost" size="sm" icon={<Flag className="size-4" />} onClick={() => setConfirm(true)}>
        Terminer la partie
      </Button>
      <ConfirmModal
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={async () => {
          const res = await act(aovActions.stop())
          if (res) setConfirm(false)
        }}
        title="Terminer la partie ?"
        confirmLabel="Terminer"
        loading={pending}
      >
        On arrête là et on passe au classement avec les points actuels{s.phase !== 'result' ? ' (le tour en cours ne compte pas)' : ''}.
      </ConfirmModal>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Scores cumulés                                                              */
/* -------------------------------------------------------------------------- */

function Scores({ s, meId, get }: { s: AovState; meId: string; get: Get }) {
  const sorted = [...s.players].sort((a, b) => (s.scores[b] ?? 0) - (s.scores[a] ?? 0))
  return (
    <div className="sticker bg-sunk p-3">
      <p className="mb-2 flex items-center gap-1.5 font-display font-extrabold">
        <Trophy className="size-4" /> Scores
      </p>
      <LayoutGroup id="aov-scores">
        <div className="flex flex-wrap gap-2">
          {sorted.map((id) => {
            const p = get(id)
            const sc = s.scores[id] ?? 0
            return (
              <motion.div layout key={id} className={cn('sticker-sm flex items-center gap-1.5 bg-surface py-0.5 pr-2.5 pl-0.5', id === meId && 'ring-2 ring-sun', id === s.target && 'bg-bubblegum text-[#1f1b2e]')}>
                <Avatar slug={p.slug} size={28} />
                <span className="text-sm font-bold">{p.nickname}</span>
                <motion.span key={sc} initial={{ scale: 2.2, color: '#06D6A0' }} animate={{ scale: 1, color: 'var(--text)' }} className="font-display font-extrabold">
                  {sc}
                </motion.span>
                <span className="text-[10px] font-bold text-muted">🎯{s.turns[id] ?? 0}</span>
              </motion.div>
            )
          })}
        </div>
      </LayoutGroup>
    </div>
  )
}
