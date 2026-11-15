import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, Check, Eye, Pencil, Trophy } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { burst } from '@/components/ui/confetti'
import { fx } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import { DropCard } from '@/features/soiree/components'
import { mood, playerOrPlaceholder } from '@/features/soiree/players'
import { serverNow, useCountdown } from '@/features/soiree/useServerClock'
import type { GamePlayProps, PlayerInfo } from '../types'
import type { LppPublicQuestion, LppRankingEntry, LppReveal, LppSecret, LppState } from './types'
import {
  assignLanes,
  buildScale,
  describeMiss,
  formatCompact,
  formatLive,
  lppActions,
  parseNumberInput,
  rankLabel,
  themeInfo,
  toInputText,
  withUnit,
} from './setup'

type Get = (id: string) => PlayerInfo
type ActFn = GamePlayProps['act']

const MEDALS = ['🥇', '🥈', '🥉']

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
      if (sent++ < 6) void act(lppActions.tick())
    }
    const first = window.setTimeout(send, 150 + Math.random() * 450)
    const retry = window.setInterval(send, 2500)
    return () => {
      clearTimeout(first)
      clearInterval(retry)
    }
  }, [expired, deadline, act])
  return left
}

export default function LePlusProchePlay({ state, secret, meId, isHost, players, act, pending }: GamePlayProps) {
  const s = state as unknown as LppState
  const get: Get = (id) => playerOrPlaceholder(players, id)
  useDeadlineTick(s.phase === 'question' ? s.deadline : null, act)
  const mySecret = secret as LppSecret | null

  return (
    <div className="flex flex-col gap-4 pb-6">
      {s.phase === 'question' && (
        <QuestionPhase key={`q${s.round}`} s={s} secret={mySecret?.round === s.round ? mySecret : null} meId={meId} isHost={isHost} get={get} act={act} />
      )}
      {s.phase === 'reveal' && s.last_reveal && (
        <RevealPhase key={`r${s.round}`} s={s} lr={s.last_reveal} meId={meId} isHost={isHost} get={get} act={act} pending={pending} />
      )}
      <Scoreboard s={s} meId={meId} get={get} />
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
      <div className="relative h-6 flex-1 overflow-hidden rounded-full border-[3px] border-ink bg-sunk shadow-sticker-sm">
        <motion.div className={cn('h-full rounded-full', color)} animate={{ width: `${pct}%` }} transition={{ ease: 'linear', duration: 0.1 }} />
      </div>
      <motion.span
        key={urgent ? secs : 'calm'}
        initial={urgent ? { scale: 1.8, rotate: -10 } : false}
        animate={{ scale: 1, rotate: 0 }}
        className={cn(
          'flex size-12 items-center justify-center rounded-full border-[3px] border-ink font-display text-2xl font-extrabold shadow-sticker-sm',
          urgent ? 'bg-tomato text-white' : 'bg-surface',
        )}
      >
        {secs}
      </motion.span>
    </div>
  )
}

function QuestionBadges({ q, round, total }: { q: LppPublicQuestion; round: number; total: number }) {
  const t = themeInfo(q.theme)
  return (
    <div className="mb-3 flex flex-wrap items-center justify-center gap-1.5">
      <Badge tone="neutral" tilted={false}>
        {round}/{total}
      </Badge>
      <Badge tone="neutral" tilted={false}>
        {t.emoji} {t.label}
      </Badge>
      {q.difficulty && (
        <Badge tone="neutral" tilted={false}>
          {'⭐'.repeat(q.difficulty)}
        </Badge>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Phase question                                                              */
/* -------------------------------------------------------------------------- */

function QuestionPhase({ s, secret, meId, isHost, get, act }: { s: LppState; secret: LppSecret | null; meId: string; isHost: boolean; get: Get; act: ActFn }) {
  const q = s.question
  const isPlayer = s.players.includes(meId)
  return (
    <>
      <TimerBar deadline={s.deadline} totalMs={s.duration * 1000} />

      <DropCard k={s.round} accent={themeInfo(q.theme).color} className="text-[#1f1b2e]">
        <QuestionBadges q={q} round={s.round} total={s.total_rounds} />
        <p className="font-display text-[1.6rem] leading-tight font-extrabold">{q.prompt}</p>
        {q.unit && <p className="mt-2 text-sm font-bold opacity-75">Réponse en {q.unit}</p>}
      </DropCard>

      {isPlayer ? (
        <AnswerBox s={s} secret={secret} act={act} />
      ) : (
        <p className="text-center font-bold text-muted">Tu regardes : les joueurs estiment… 🤔</p>
      )}

      <AnsweredStrip s={s} get={get} meId={meId} />

      {isHost && (
        <Button variant="ghost" icon={<Eye className="size-5" />} onClick={() => void act(lppActions.reveal(s.round))}>
          Révéler maintenant
        </Button>
      )}
    </>
  )
}

type Sent = { value: number | null } | null

function AnswerBox({ s, secret, act }: { s: LppState; secret: LppSecret | null; act: ActFn }) {
  const unit = s.question.unit
  const [sent, setSent] = useState<Sent>(secret ? { value: secret.value } : null)
  const [editing, setEditing] = useState(!secret)
  const [text, setText] = useState(secret?.value != null ? toInputText(secret.value) : '')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const caretRef = useRef<number | null>(null)
  const left = useCountdown(s.deadline, 250)

  // Secret arrivé après coup (rechargement lent) : on l'adopte s'il n'y a rien en local.
  useEffect(() => {
    if (secret && !sent) {
      setSent({ value: secret.value })
      setEditing(false)
      if (secret.value != null) setText(toInputText(secret.value))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secret])

  useEffect(() => {
    if (!editing) return
    const t = window.setTimeout(() => inputRef.current?.focus(), 450)
    return () => clearTimeout(t)
  }, [editing])

  useLayoutEffect(() => {
    if (caretRef.current !== null && inputRef.current && document.activeElement === inputRef.current) {
      inputRef.current.setSelectionRange(caretRef.current, caretRef.current)
    }
    caretRef.current = null
  }, [text])

  const send = async (value: number | null) => {
    if (sending) return false
    setSending(true)
    const res = await act(lppActions.answer(s.round, value))
    setSending(false)
    if (!res) return false
    setSent({ value })
    setEditing(false)
    setError(null)
    return true
  }

  // Filet : saisie valide non envoyée à l'approche de la fin du temps -> envoi auto.
  const autoSent = useRef(false)
  useEffect(() => {
    if (!editing || autoSent.current || !s.deadline || left > 1200 || left <= 0) return
    const p = parseNumberInput(text)
    if (!p.ok || (sent && sent.value === p.value)) return
    autoSent.current = true
    void send(p.value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const p = parseNumberInput(text)
    if (!p.ok) {
      setError(p.reason === 'empty' ? 'Tape un nombre (ou « Je ne sais pas »).' : p.reason === 'range' ? 'Nombre beaucoup trop grand !' : 'Ce n’est pas un nombre (chiffres et virgule uniquement).')
      fx.fail()
      return
    }
    if (await send(p.value)) fx.success()
  }

  const toggleSign = () => {
    fx.tick()
    setText((t) => (t.startsWith('-') ? t.slice(1) : `-${t}`))
    inputRef.current?.focus()
  }

  if (sent && !editing) {
    return (
      <motion.div
        initial={{ scale: 0.4, rotate: -8 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 13 }}
        className={cn('sticker flex flex-col items-center gap-1 p-4 text-center text-[#1f1b2e]', sent.value === null ? 'bg-sunk text-text' : 'bg-mint')}
      >
        {sent.value === null ? (
          <>
            <span className="text-4xl">🤷</span>
            <p className="font-display text-2xl font-extrabold">Je ne sais pas</p>
            <p className="text-sm font-bold opacity-75">Pas d’estimation pour cette manche.</p>
          </>
        ) : (
          <>
            <p className="text-sm font-bold opacity-75">Ton estimation (secrète)</p>
            <p className="font-display text-4xl leading-tight font-extrabold break-all">{withUnit(sent.value, unit)}</p>
          </>
        )}
        <Button variant="secondary" size="sm" className="mt-2" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
          Modifier
        </Button>
      </motion.div>
    )
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-2">
      <div className={cn('sticker flex items-center gap-2 p-2', error ? 'bg-tomato/15' : 'bg-surface')}>
        <button
          type="button"
          onPointerDown={(e) => e.preventDefault()}
          onClick={toggleSign}
          aria-label="Changer le signe"
          className="flex size-11 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-sunk font-display text-xl font-extrabold"
        >
          ±
        </button>
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => {
            const r = formatLive(e.target.value, e.target.selectionStart ?? e.target.value.length)
            caretRef.current = r.caret
            setText(r.text)
            setError(null)
          }}
          inputMode="decimal"
          enterKeyHint="send"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Ton estimation"
          aria-label="Ton estimation"
          className="min-w-0 flex-1 bg-transparent px-1 py-2 text-right font-display text-3xl font-extrabold outline-none placeholder:text-left placeholder:text-xl placeholder:text-muted/60"
        />
        {unit && <span className="max-w-[30%] shrink-0 truncate font-display text-lg font-extrabold text-muted">{unit}</span>}
      </div>
      <div className="min-h-6 text-center">
        <AnimatePresence mode="popLayout">
          {error && (
            <motion.p key={error} initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ opacity: 0 }} className="font-display font-extrabold text-tomato">
              {error}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="secondary" className="flex-1" disabled={sending} onClick={() => void send(null)}>
          🤷 Je ne sais pas
        </Button>
        <Button type="submit" className="flex-1" loading={sending} disabled={!text.trim() || text === '-'} icon={<Check className="size-5" strokeWidth={3} />}>
          Valider
        </Button>
      </div>
      {sent && (
        <button type="button" onClick={() => setEditing(false)} className="text-sm font-bold text-muted underline">
          Garder {sent.value === null ? '« Je ne sais pas »' : withUnit(sent.value, unit)}
        </button>
      )}
    </form>
  )
}

/** Avatars qui s'allument quand un joueur a répondu (jamais la valeur). */
function AnsweredStrip({ s, get, meId }: { s: LppState; get: Get; meId: string }) {
  const n = s.answered.length
  return (
    <div className="sticker flex flex-col gap-2 bg-surface p-3">
      <div className="flex items-center justify-between">
        <span className="font-display text-lg font-extrabold">
          <motion.span key={n} initial={{ scale: 1.8, color: '#06D6A0' }} animate={{ scale: 1, color: 'var(--text)' }} className="inline-block">
            {n}
          </motion.span>
          /{s.players.length} ont répondu
        </span>
        <div className="h-3 w-24 overflow-hidden rounded-full border-2 border-ink bg-sunk">
          <motion.div className="h-full bg-mint" animate={{ width: `${(n / Math.max(1, s.players.length)) * 100}%` }} />
        </div>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {s.players.map((id) => {
          const p = get(id)
          const done = s.answered.includes(id)
          return (
            <motion.div
              key={id}
              animate={done ? { scale: [1, 1.3, 1], y: [0, -8, 0], opacity: 1 } : { scale: 1, opacity: 0.6 }}
              transition={{ duration: 0.4 }}
              className={cn('flex flex-col items-center', !done && 'grayscale')}
            >
              <Avatar slug={p.slug} expression={done ? mood(p, 'sly') : mood(p, 'think')} size={44} badge={done ? '✓' : undefined} />
              <span className={cn('max-w-[3.5rem] truncate text-xs font-bold', id === meId && 'underline')}>{p.nickname}</span>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Révélation                                                                  */
/* -------------------------------------------------------------------------- */

const LANE_H = 50
const AVATAR = 34

/** Délais de l'animation (s) : avatars un par un, puis la bonne réponse tombe. */
function timeline(n: number, reduce: boolean) {
  if (reduce) return { avatar: () => 0, truth: 0, after: 0.2 }
  const step = n > 6 ? 0.25 : 0.35
  const truth = 0.5 + n * step + 0.5
  return { avatar: (i: number) => 0.5 + i * step, truth, after: truth + 0.9 }
}

function Ruler({ lr, get, meId, unit }: { lr: LppReveal; get: Get; meId: string; unit: string | null }) {
  const reduce = !!useReducedMotion()
  const entries = lr.ranking
  const scale = useMemo(() => buildScale(entries.map((e) => e.value), lr.answer), [entries, lr.answer])
  const positions = entries.map((e) => scale.pos(e.value))
  const lanes = assignLanes(positions)
  const laneCount = Math.max(1, ...lanes.map((l) => l + 1))
  const truthPos = scale.pos(lr.answer)
  // Ordre d'apparition : du plus loin au plus proche (suspense).
  const order = entries.map((_, i) => i).reverse()
  const t = timeline(entries.length, reduce)
  const winners = entries.filter((e) => e.rank === 1)
  const top = laneCount * LANE_H + 24 // hauteur de la zone des avatars au-dessus de la règle

  // Sons synchronisés avec l'animation.
  useEffect(() => {
    const timers: number[] = []
    order.forEach((_, k) => timers.push(window.setTimeout(() => fx.pop(), t.avatar(k) * 1000 + 250)))
    timers.push(window.setTimeout(() => fx.whoosh(), t.truth * 1000))
    timers.push(
      window.setTimeout(() => {
        const mine = entries.find((e) => e.profile_id === meId)
        if (mine?.exact) {
          fx.fanfare()
          burst({ x: 0.5, y: 0.35 }, 140)
        } else if (mine && mine.rank === 1) {
          fx.success()
          burst({ x: 0.5, y: 0.35 }, 80)
        } else if (mine && mine.points > 0) fx.success()
        else fx.fail()
      }, t.truth * 1000 + 450),
    )
    return () => timers.forEach(clearTimeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="sticker overflow-hidden bg-surface px-2 pt-3 pb-2">
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="font-display font-extrabold">📏 Qui est le plus proche ?</span>
        {scale.kind === 'log' && (
          <Badge tone="grape" tilted={false}>
            échelle log
          </Badge>
        )}
      </div>
      <div className="relative mx-5" style={{ height: top + 64 }}>
        {/* Règle */}
        <div className="absolute inset-x-0 h-3 rounded-full border-2 border-ink bg-sunk" style={{ top: top - 6 }} />
        {scale.ticks.map((v) => (
          <div key={v} className="absolute -translate-x-1/2" style={{ left: `${scale.pos(v) * 100}%`, top: top + 6 }}>
            <div className="mx-auto h-2 w-0.5 bg-ink" />
            <span className="block text-center text-[10px] font-bold whitespace-nowrap text-muted">{formatCompact(v)}</span>
          </div>
        ))}

        {/* Écart du (des) gagnant(s) : segment vert entre l'estimation et la réponse */}
        {winners.map((w) => {
          const a = Math.min(scale.pos(w.value), truthPos)
          const b = Math.max(scale.pos(w.value), truthPos)
          return (
            <motion.div
              key={`seg${w.profile_id}`}
              className="absolute h-3 origin-left rounded-full bg-mint"
              style={{ left: `${a * 100}%`, width: `max(${(b - a) * 100}%, 6px)`, top: top - 6 }}
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ delay: t.truth + 0.5, duration: 0.4 }}
            />
          )
        })}

        {/* Avatars des joueurs à leur estimation */}
        {order.map((idx, k) => {
          const e = entries[idx]
          const p = get(e.profile_id)
          const lane = lanes[idx]
          const stem = lane * LANE_H + 10
          return (
            <motion.div
              key={e.profile_id}
              className="absolute flex -translate-x-1/2 flex-col items-center"
              style={{ left: `${positions[idx] * 100}%`, bottom: 64 + 6 }}
              initial={{ y: -220, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: t.avatar(k), type: 'spring', stiffness: 380, damping: 16 }}
            >
              <Avatar
                slug={p.slug}
                size={AVATAR}
                selected={e.profile_id === meId}
                expression={mood(p, e.exact ? 'love' : e.rank === 1 ? 'proud' : 'think')}
              />
              <div className="w-0.5 bg-ink/70" style={{ height: stem }} />
            </motion.div>
          )
        })}

        {/* La bonne réponse tombe */}
        <motion.div
          className="absolute z-10 flex -translate-x-1/2 flex-col items-center"
          style={{ left: `${truthPos * 100}%`, top: top - 40 }}
          initial={{ y: -top - 60, opacity: 0, scale: 1.6 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          transition={{ delay: t.truth, type: 'spring', stiffness: 520, damping: 13 }}
        >
          <span className="text-3xl leading-none drop-shadow">🎯</span>
          <div className="h-3 w-1 rounded bg-tomato" />
        </motion.div>
        <motion.div
          className="absolute z-10 -translate-x-1/2 rounded-full border-2 border-ink bg-tomato px-2 font-display text-sm font-extrabold whitespace-nowrap text-white shadow-sticker-sm"
          style={{ left: `clamp(2.5rem, ${truthPos * 100}%, calc(100% - 2.5rem))`, top: top + 30 }}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: t.truth + 0.3, type: 'spring', stiffness: 500, damping: 14 }}
        >
          {withUnit(lr.answer, unit)}
        </motion.div>
      </div>
      {entries.length === 0 && <p className="text-center text-sm font-bold text-muted">Personne n’a osé une estimation… 🦗</p>}
    </div>
  )
}

/** Podium de la manche (rangs 1 à 3, ex-aequo groupés). */
function Podium({ entries, get, delay }: { entries: LppRankingEntry[]; get: Get; delay: number }) {
  const cols = [2, 1, 3]
    .map((rank) => ({ rank, list: entries.filter((e) => e.rank === rank) }))
    .filter((c) => c.list.length > 0)
  if (!cols.length) return null
  const height = { 1: 'h-20', 2: 'h-14', 3: 'h-10' } as Record<number, string>
  const bg = { 1: 'bg-sun', 2: 'bg-sky', 3: 'bg-bubblegum' } as Record<number, string>
  return (
    <div className="flex items-end justify-center gap-2">
      {cols.map((c, i) => (
        <motion.div
          key={c.rank}
          initial={{ y: 60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: delay + (c.rank === 1 ? 0.3 : i * 0.1), type: 'spring', stiffness: 300, damping: 15 }}
          className="flex w-24 flex-col items-center"
        >
          <div className="flex flex-wrap justify-center -space-x-2">
            {c.list.map((e) => {
              const p = get(e.profile_id)
              return <Avatar key={e.profile_id} slug={p.slug} size={c.rank === 1 ? 46 : 38} expression={mood(p, c.rank === 1 ? 'proud' : 'happy')} badge={e.exact ? '🎯' : undefined} />
            })}
          </div>
          <div className={cn('mt-1 flex w-full flex-col items-center justify-center rounded-t-chip border-[3px] border-b-0 border-ink text-[#1f1b2e]', height[c.rank], bg[c.rank])}>
            <span className="text-xl leading-none">{MEDALS[c.rank - 1]}</span>
            <span className="font-display text-sm font-extrabold">+{c.list[0].points}</span>
          </div>
        </motion.div>
      ))}
    </div>
  )
}

function RevealPhase({ s, lr, meId, isHost, get, act, pending }: { s: LppState; lr: LppReveal; meId: string; isHost: boolean; get: Get; act: ActFn; pending: boolean }) {
  const reduce = !!useReducedMotion()
  const unit = lr.question.unit
  const t = timeline(lr.ranking.length, reduce)
  const last = s.round >= s.total_rounds
  const silent = s.players.filter((id) => !lr.ranking.some((e) => e.profile_id === id))

  return (
    <>
      <motion.div
        initial={{ scale: 0.3, rotate: -10, opacity: 0 }}
        animate={{ scale: 1, rotate: -1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 13 }}
        className="sticker flex flex-col items-center gap-1 p-4 text-center text-[#1f1b2e]"
        style={{ backgroundColor: themeInfo(lr.question.theme).color }}
      >
        <p className="font-display text-lg leading-tight font-extrabold">{lr.question.prompt}</p>
        <p className="mt-1 text-sm font-bold opacity-75">La réponse :</p>
        <motion.p
          initial={{ scale: 3, opacity: 0, rotate: 8 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          transition={{ delay: t.truth + 0.2, type: 'spring', stiffness: 320, damping: 12 }}
          className="font-display text-4xl leading-tight font-extrabold break-words"
        >
          {withUnit(lr.answer, unit)}
        </motion.p>
        {lr.note && (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: t.after }} className="mt-1 text-sm leading-snug font-bold opacity-80">
            💡 {lr.note}
          </motion.p>
        )}
      </motion.div>

      <Ruler lr={lr} get={get} meId={meId} unit={unit} />

      <Podium entries={lr.ranking} get={get} delay={t.after} />

      {/* Distances */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: t.after + 0.4 }} className="sticker flex flex-col gap-1.5 bg-surface p-3">
        {lr.ranking.map((e) => {
          const p = get(e.profile_id)
          return (
            <div key={e.profile_id} className={cn('flex items-center gap-2 rounded-chip px-1 py-0.5', e.profile_id === meId && 'bg-sun/25')}>
              <span className="w-7 text-center font-display font-extrabold">{e.rank <= 3 ? MEDALS[e.rank - 1] : rankLabel(e.rank)}</span>
              <Avatar slug={p.slug} size={32} expression={mood(p, e.points > 0 ? 'happy' : 'sad')} />
              <div className="min-w-0 flex-1">
                <p className="truncate leading-tight font-bold">{p.nickname}</p>
                <p className="truncate text-xs font-bold text-muted">
                  {withUnit(e.value, unit)} · {e.exact ? '🎯 pile !' : `à ${withUnit(e.gap, unit)} (${describeMiss(e.value, lr.answer)})`}
                </p>
              </div>
              {e.points > 0 && <Badge tone={e.exact ? 'grape' : 'mint'}>+{e.points}</Badge>}
            </div>
          )
        })}
        {silent.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-2 border-t-2 border-dashed border-ink/20 pt-2">
            {silent.map((id) => {
              const p = get(id)
              return (
                <span key={id} className="flex items-center gap-1 rounded-full bg-sunk py-0.5 pr-2 pl-0.5 text-sm font-bold">
                  <Avatar slug={p.slug} expression={mood(p, 'sleepy')} size={24} />
                  {p.nickname} {lr.answers[id] === null ? '🤷' : '⌛'}
                </span>
              )
            })}
          </div>
        )}
      </motion.div>

      {isHost ? (
        <Button size="lg" fullWidth loading={pending} icon={last ? <Trophy className="size-6" /> : <ArrowRight className="size-6" />} onClick={() => void act(lppActions.next(s.round))}>
          {last ? 'Voir les résultats' : 'Manche suivante'}
        </Button>
      ) : (
        <p className="text-center text-sm font-bold text-muted">L’hôte lance la suite…</p>
      )}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Tableau des scores                                                          */
/* -------------------------------------------------------------------------- */

function Scoreboard({ s, meId, get }: { s: LppState; meId: string; get: Get }) {
  const sorted = [...s.players].sort((a, b) => (s.scores[b] ?? 0) - (s.scores[a] ?? 0))
  const deltas = s.phase === 'reveal' ? (s.last_reveal?.points ?? {}) : {}
  const delay = s.phase === 'reveal' ? timeline(s.last_reveal?.ranking.length ?? 0, false).after : 0
  return (
    <div className="sticker bg-sunk p-3">
      <p className="mb-2 flex items-center gap-1.5 font-display font-extrabold">
        <Trophy className="size-4" /> Classement
      </p>
      <LayoutGroup>
        <div className="flex flex-col gap-1">
          {sorted.map((id, i) => {
            const p = get(id)
            const sc = s.scores[id] ?? 0
            const d = deltas[id]
            const ex = s.exacts?.[id] ?? 0
            return (
              <motion.div
                layout
                key={id}
                transition={{ type: 'spring', stiffness: 320, damping: 26 }}
                className={cn('flex items-center gap-2 rounded-chip bg-surface px-2 py-1', id === meId && 'ring-2 ring-sun')}
              >
                <span className="w-6 text-center font-display font-extrabold">{i === 0 && sc > 0 ? '👑' : i + 1}</span>
                <Avatar slug={p.slug} size={30} />
                <span className="flex-1 truncate text-sm font-bold">
                  {p.nickname}
                  {ex > 0 && <span className="ml-1 text-xs text-muted">🎯×{ex}</span>}
                </span>
                <AnimatePresence>
                  {d ? (
                    <motion.span
                      key={`d${s.round}`}
                      initial={{ scale: 0, y: 10 }}
                      animate={{ scale: 1, y: 0 }}
                      exit={{ scale: 0, opacity: 0 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 14, delay }}
                      className="font-display text-sm font-extrabold text-mint"
                    >
                      +{d}
                    </motion.span>
                  ) : null}
                </AnimatePresence>
                <AnimatedNumber value={sc} className="w-10 text-right font-display text-lg font-extrabold" />
              </motion.div>
            )
          })}
        </div>
      </LayoutGroup>
    </div>
  )
}

