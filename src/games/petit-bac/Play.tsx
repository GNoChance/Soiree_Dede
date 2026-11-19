import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, Check, CloudOff, FastForward, Hand, Loader2, Trophy } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { burst } from '@/components/ui/confetti'
import { fx, playSound, vibrate } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import { supabase } from '@/lib/supabase'
import type { GameAction } from '@/types/db'
import { ConfirmModal } from '@/features/soiree/components'
import { mood, playerOrPlaceholder } from '@/features/soiree/players'
import { serverNow, useCountdown } from '@/features/soiree/useServerClock'
import type { GamePlayProps, PlayerInfo } from '../types'
import { autoStatus, cleanAnswer, scoreCategory, type ScoreStatus } from './logic'
import { pbActions } from './setup'
import type { PbSecret, PetitBacState } from './types'

type Get = (id: string) => PlayerInfo
type ActFn = GamePlayProps['act']

const URGENT_MS = 10_000

export default function PetitBacPlay({ matchId, state, secret, meId, isHost, players, act, pending }: GamePlayProps) {
  const s = state as unknown as PetitBacState
  const get = useCallback((id: string) => playerOrPlaceholder(players, id), [players])
  const isPlayer = s.players.includes(meId)

  // Compte à rebours partagé (STOP géant affiché par-dessus tout).
  const left = useCountdown(s.phase === 'writing' ? s.deadline : null)
  const timeUp = s.phase === 'writing' && !!s.deadline && left <= 0

  // STOP visible : temps écoulé localement, puis ~1,5 s après le passage en validation.
  const [stopRound, setStopRound] = useState<number | null>(null)
  const prevPhase = useRef(s.phase)
  useEffect(() => {
    const prev = prevPhase.current
    prevPhase.current = s.phase
    if (prev === 'writing' && s.phase === 'validation') setStopRound(s.round)
  }, [s.phase, s.round])
  useEffect(() => {
    if (stopRound === null) return
    const t = window.setTimeout(() => setStopRound(null), 1500)
    return () => clearTimeout(t)
  }, [stopRound])
  const showStop = timeUp || (stopRound === s.round && s.phase === 'validation')

  // Buzzer une seule fois par manche.
  const buzzed = useRef(0)
  useEffect(() => {
    if (showStop && buzzed.current !== s.round) {
      buzzed.current = s.round
      playSound('fail')
      vibrate([220, 80, 220])
    }
  }, [showStop, s.round])

  return (
    <div className="flex flex-col gap-4 pb-6">
      {s.phase === 'writing' && (
        <Writing key={`w${s.round}`} s={s} matchId={matchId} secret={secret} meId={meId} isPlayer={isPlayer} isHost={isHost} get={get} act={act} left={left} timeUp={timeUp} />
      )}
      {s.phase === 'validation' && s.validation && <Validation s={s} meId={meId} isPlayer={isPlayer} isHost={isHost} get={get} act={act} pending={pending} />}
      {s.phase === 'round_score' && s.last_round && <RoundScore key={`r${s.round}`} s={s} meId={meId} isHost={isHost} get={get} act={act} pending={pending} />}

      <AnimatePresence>{showStop && <StopOverlay key="stop" />}</AnimatePresence>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* STOP !                                                                      */
/* -------------------------------------------------------------------------- */

function StopOverlay() {
  return (
    <motion.div
      className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-ink/40"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.3 } }}
    >
      <motion.div
        initial={{ scale: 4, rotate: -30 }}
        animate={{ scale: 1, rotate: -8 }}
        exit={{ scale: 0.3, rotate: 20, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 11 }}
        className="sticker bg-tomato px-10 py-6 text-center text-white"
        style={{ boxShadow: '8px 8px 0 0 var(--ink)' }}
      >
        <span className="font-display text-8xl leading-none font-extrabold tracking-tight">STOP !</span>
        <p className="mt-1 font-display text-xl font-extrabold">On pose les stylos ✋</p>
      </motion.div>
    </motion.div>
  )
}

/* -------------------------------------------------------------------------- */
/* Tirage de la lettre                                                         */
/* -------------------------------------------------------------------------- */

const WHEEL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

function LetterWheel({ letter, startsAt, onDone }: { letter: string; startsAt: string; onDone: () => void }) {
  const [shown, setShown] = useState('?')
  const [landed, setLanded] = useState(false)
  const doneRef = useRef(onDone)
  useEffect(() => {
    doneRef.current = onDone
  })

  useEffect(() => {
    const end = new Date(startsAt).getTime()
    const landAt = end - 900 // la lettre s'affiche ~1 s avant le départ du chrono
    let delay = 55
    let t = 0
    const step = () => {
      const now = serverNow()
      if (now >= landAt) {
        setShown(letter)
        setLanded(true)
        fx.success()
        t = window.setTimeout(() => doneRef.current(), Math.max(300, end - serverNow()))
        return
      }
      setShown(WHEEL[Math.floor(Math.random() * WHEEL.length)])
      fx.tick()
      delay = Math.min(260, delay * 1.09)
      t = window.setTimeout(step, delay)
    }
    step()
    return () => clearTimeout(t)
  }, [letter, startsAt])

  return (
    <motion.div className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-6 bg-paper/95" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 1.2 }}>
      <p className="font-display text-2xl font-extrabold">{landed ? 'La lettre est…' : 'Tirage de la lettre…'}</p>
      <motion.div
        animate={landed ? { rotate: [0, -12, 8, 0], scale: [1, 1.35, 1] } : { rotate: [-4, 4, -4] }}
        transition={landed ? { duration: 0.6 } : { repeat: Infinity, duration: 0.25 }}
        className={cn('sticker flex size-48 items-center justify-center rounded-full', landed ? 'bg-sun' : 'bg-surface')}
        style={{ boxShadow: '8px 8px 0 0 var(--ink)' }}
      >
        <AnimatePresence mode="popLayout">
          <motion.span
            key={shown + String(landed)}
            initial={{ y: -60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={{ duration: landed ? 0.3 : 0.06 }}
            className="font-display text-[7rem] leading-none font-extrabold text-[#1f1b2e]"
          >
            {shown}
          </motion.span>
        </AnimatePresence>
      </motion.div>
      {landed && (
        <motion.p initial={{ scale: 0 }} animate={{ scale: 1 }} className="font-display text-3xl font-extrabold">
          À vos stylos ! ✍️
        </motion.p>
      )}
    </motion.div>
  )
}

/* -------------------------------------------------------------------------- */
/* Écriture                                                                    */
/* -------------------------------------------------------------------------- */

type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

function Writing({
  s, matchId, secret, meId, isPlayer, isHost, get, act, left, timeUp,
}: {
  s: PetitBacState; matchId: string; secret: unknown; meId: string; isPlayer: boolean; isHost: boolean; get: Get; act: ActFn; left: number; timeUp: boolean
}) {
  const reduce = useReducedMotion()
  const round = s.round
  const mySecret = secret as PbSecret | null
  const secretAnswers = mySecret && mySecret.round === round && mySecret.answers ? mySecret.answers : null

  const [answers, setAnswers] = useState<Record<string, string>>(() => secretAnswers ?? {})
  const [touched, setTouched] = useState(false)
  // Le secret (mes réponses, après rechargement) peut arriver après le montage.
  if (secretAnswers && !touched && Object.keys(answers).length === 0 && Object.keys(secretAnswers).length > 0) {
    setAnswers(secretAnswers)
  }

  // Tirage : affiché seulement si on arrive avant le départ du chrono.
  const [wheel, setWheel] = useState(() => !!s.starts_at && new Date(s.starts_at).getTime() - serverNow() > 600)
  const startsLeft = useCountdown(s.starts_at, 200)
  const started = startsLeft <= 0 || !wheel

  /* ----------------------------- sauvegarde auto ---------------------------- */
  const [status, setStatus] = useState<SaveStatus>('idle')
  const answersRef = useRef(answers)
  useEffect(() => {
    answersRef.current = answers
  }, [answers])
  const dirtyRef = useRef(false)
  const inFlight = useRef(false)
  const again = useRef(false)
  const timer = useRef(0)
  const retry = useRef(0)

  const flush = useCallback(async (): Promise<void> => {
    clearTimeout(timer.current)
    if (!isPlayer || !dirtyRef.current) return
    if (inFlight.current) {
      again.current = true
      return
    }
    inFlight.current = true
    dirtyRef.current = false
    setStatus('saving')
    const payload = Object.fromEntries(Object.entries(answersRef.current).map(([k, v]) => [k, cleanAnswer(v)]))
    let ok: boolean
    try {
      const { error } = await supabase.rpc('game_action', {
        p_match_id: matchId,
        p_action: pbActions.save(round, payload) as unknown as GameAction,
      })
      ok = !error
    } catch {
      ok = false
    }
    inFlight.current = false
    if (!ok) {
      dirtyRef.current = true
      setStatus('error')
      clearTimeout(retry.current)
      retry.current = window.setTimeout(() => void flushRef.current(), 2000)
      return
    }
    if (again.current || dirtyRef.current) {
      again.current = false
      dirtyRef.current = true
      return flushRef.current()
    }
    setStatus('saved')
  }, [isPlayer, matchId, round])

  const flushRef = useRef(flush)
  useEffect(() => {
    flushRef.current = flush
  })

  const change = (catId: string, value: string) => {
    const next = { ...answersRef.current, [catId]: value }
    answersRef.current = next
    dirtyRef.current = true
    setAnswers(next)
    setTouched(true)
    setStatus('dirty')
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void flushRef.current(), 800)
  }

  // Dernière sauvegarde juste avant l'échéance, au passage en arrière-plan et au démontage
  // (le serveur accepte encore ~2 s après l'échéance).
  const finalSent = useRef(false)
  useEffect(() => {
    if (!finalSent.current && started && left > 0 && left <= 1500) {
      finalSent.current = true
      void flushRef.current()
    }
  }, [left, started])
  useEffect(() => {
    const h = () => {
      if (document.visibilityState === 'hidden') void flushRef.current()
    }
    document.addEventListener('visibilitychange', h)
    return () => {
      document.removeEventListener('visibilitychange', h)
      clearTimeout(timer.current)
      clearTimeout(retry.current)
      void flushRef.current()
    }
  }, [])

  /* ------------------------------ tick à l'échéance ------------------------- */
  useEffect(() => {
    if (!timeUp || !(isPlayer || isHost)) return
    let t = 0
    let cancelled = false
    const send = async () => {
      await flushRef.current()
      if (cancelled) return
      await act(pbActions.tick())
      if (!cancelled) t = window.setTimeout(() => void send(), 2500) // horloge en avance : on réessaie
    }
    t = window.setTimeout(() => void send(), 150 + Math.random() * 500)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [timeUp, act, isPlayer, isHost])

  /* --------------------------- urgence (10 dernières s) ---------------------- */
  const urgent = started && left > 0 && left <= URGENT_MS
  const lastSec = useRef(-1)
  useEffect(() => {
    if (!urgent) return
    const sec = Math.ceil(left / 1000)
    if (sec !== lastSec.current) {
      lastSec.current = sec
      playSound('tick')
      vibrate(sec <= 3 ? 60 : 15)
    }
  }, [urgent, left])

  /* -------------------------------- champs ---------------------------------- */
  const inputs = useRef<Array<HTMLInputElement | null>>([])
  const total = s.categories.length
  const filled = s.categories.filter((c) => (answers[c.id] ?? '').trim()).length
  const totalMs = s.duration * 1000
  const ratio = started ? Math.max(0, Math.min(1, left / totalMs)) : 1
  const secs = Math.ceil((started ? left : totalMs) / 1000)
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
  const locked = !started || timeUp

  const [confirmEnd, setConfirmEnd] = useState(false)
  const [ending, setEnding] = useState(false)

  return (
    <>
      <AnimatePresence>{wheel && <LetterWheel key="wheel" letter={s.letter} startsAt={s.starts_at} onDone={() => setWheel(false)} />}</AnimatePresence>

      {/* En-tête collant : lettre + chrono */}
      <div className="sticky top-0 z-30 -mx-1 flex flex-col gap-2 bg-paper/95 px-1 pt-1 pb-2 backdrop-blur">
        <div className="flex items-center gap-3">
          <motion.div
            initial={{ scale: 0, rotate: -180 }}
            animate={urgent && !reduce ? { scale: [1, 1.08, 1], rotate: [0, -4, 4, 0] } : { scale: 1, rotate: -4 }}
            transition={urgent ? { repeat: Infinity, duration: 0.5 } : { type: 'spring', stiffness: 260, damping: 12 }}
            className={cn('sticker flex size-20 shrink-0 items-center justify-center rounded-full', urgent ? 'bg-tomato text-white' : 'bg-sun text-[#1f1b2e]')}
          >
            <span className="font-display text-6xl leading-none font-extrabold">{s.letter}</span>
          </motion.div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <motion.span
                key={urgent ? secs : 'calm'}
                initial={urgent ? { scale: 1.6 } : false}
                animate={{ scale: 1 }}
                className={cn('font-display text-3xl font-extrabold tabular-nums', urgent && 'text-tomato')}
              >
                {clock}
              </motion.span>
              {isPlayer && <SaveIndicator status={status} />}
            </div>
            <motion.div
              animate={urgent && !reduce ? { x: [0, -3, 3, -2, 0] } : { x: 0 }}
              transition={urgent ? { repeat: Infinity, duration: 0.4 } : undefined}
              className="h-5 overflow-hidden rounded-full border-[3px] border-ink bg-sunk"
            >
              <motion.div
                className="h-full rounded-full"
                animate={{ width: `${ratio * 100}%`, backgroundColor: urgent ? '#EF476F' : ratio < 0.35 ? '#FFB703' : '#06D6A0' }}
                transition={{ duration: 0.25, ease: 'linear' }}
              />
            </motion.div>
          </div>
        </div>
      </div>

      {isPlayer ? (
        <div className="flex flex-col gap-3">
          {s.categories.map((c, i) => {
            const v = answers[c.id] ?? ''
            const auto = v.trim() ? autoStatus(v, s.letter) : 'empty'
            const last = i === total - 1
            return (
              <motion.label
                key={c.id}
                initial={{ x: i % 2 ? 60 : -60, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.05 * i }}
                className={cn('sticker flex flex-col gap-1 p-3 transition-colors', auto === null ? 'bg-mint/25' : 'bg-surface')}
              >
                <span className="flex items-center gap-2 font-display text-lg font-extrabold">
                  <span className="text-2xl">{c.emoji}</span>
                  <span className="flex-1 truncate">{c.label}</span>
                  <AnimatePresence mode="wait">
                    {auto === null ? (
                      <motion.span key="ok" initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0 }} className="flex size-7 items-center justify-center rounded-full border-2 border-ink bg-mint">
                        <Check className="size-4" strokeWidth={4} />
                      </motion.span>
                    ) : auto === 'letter' ? (
                      <motion.span key="bad" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="text-sm font-bold text-tomato">
                        Pas un {s.letter} !
                      </motion.span>
                    ) : null}
                  </AnimatePresence>
                </span>
                <input
                  ref={(el) => {
                    inputs.current[i] = el
                  }}
                  value={v}
                  disabled={locked}
                  maxLength={60}
                  placeholder={started ? `${c.label} en ${s.letter}…` : '…'}
                  enterKeyHint={last ? 'done' : 'next'}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="sentences"
                  spellCheck={false}
                  onChange={(e) => change(c.id, e.target.value)}
                  onBlur={() => void flush()}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return
                    e.preventDefault()
                    const next = inputs.current[i + 1]
                    if (next) next.focus()
                    else e.currentTarget.blur()
                  }}
                  className="h-14 w-full rounded-chip border-[3px] border-ink bg-surface px-3 font-display text-2xl font-extrabold text-text outline-none placeholder:text-base placeholder:font-bold placeholder:text-muted focus:ring-4 focus:ring-sun disabled:opacity-60"
                />
              </motion.label>
            )
          })}
          <p className="text-center font-display text-lg font-extrabold">
            <motion.span key={filled} initial={{ scale: 1.8 }} animate={{ scale: 1 }} className="inline-block">
              {filled}
            </motion.span>
            /{total} cases remplies {filled === total && '🔥'}
          </p>
        </div>
      ) : (
        <p className="text-center font-bold text-muted">Tu regardes cette partie : les joueurs écrivent…</p>
      )}

      <ProgressStrip s={s} meId={meId} get={get} />

      {(isHost || (isPlayer && filled === total)) && (
        <>
          <Button
            variant={isPlayer && filled === total ? 'primary' : 'secondary'}
            fullWidth
            icon={<Hand className="size-5" />}
            disabled={timeUp || ending}
            onClick={() => setConfirmEnd(true)}
          >
            {isPlayer && filled === total ? 'STOP ! J’ai fini' : 'Fin de manche'}
          </Button>
          <ConfirmModal
            open={confirmEnd}
            onClose={() => setConfirmEnd(false)}
            title="Arrêter la manche ?"
            confirmLabel="STOP !"
            danger
            loading={ending}
            onConfirm={async () => {
              setEnding(true)
              clearTimeout(timer.current)
              // Mes réponses partent avec le STOP : le serveur vérifie que tout est rempli.
              await act(pbActions.endRound(isPlayer ? Object.fromEntries(Object.entries(answersRef.current).map(([k, v]) => [k, cleanAnswer(v)])) : undefined))
              setEnding(false)
              setConfirmEnd(false)
            }}
          >
            Tout le monde pose son stylo maintenant, même s’il reste du temps.
          </ConfirmModal>
        </>
      )}
    </>
  )
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  const map: Record<SaveStatus, { icon: ReactNode; label: string; cls: string }> = {
    idle: { icon: <Check className="size-4" />, label: 'Prêt', cls: 'text-muted' },
    dirty: { icon: <Loader2 className="size-4 animate-spin" />, label: 'Saisie…', cls: 'text-muted' },
    saving: { icon: <Loader2 className="size-4 animate-spin" />, label: 'Sauvegarde…', cls: 'text-muted' },
    saved: { icon: <Check className="size-4" strokeWidth={3} />, label: 'Sauvegardé', cls: 'text-mint' },
    error: { icon: <CloudOff className="size-4" />, label: 'Hors ligne…', cls: 'text-tomato' },
  }
  const m = map[status]
  return (
    <AnimatePresence mode="wait">
      <motion.span key={status} initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 8, opacity: 0 }} className={cn('flex items-center gap-1 text-sm font-extrabold', m.cls)}>
        {m.icon}
        {m.label}
      </motion.span>
    </AnimatePresence>
  )
}

function ProgressStrip({ s, meId, get }: { s: PetitBacState; meId: string; get: Get }) {
  const total = s.categories.length
  return (
    <div className="sticker flex flex-col gap-2 bg-surface p-3">
      <p className="font-display font-extrabold">Où en sont les autres ? 👀</p>
      <div className="grid grid-cols-1 gap-1.5">
        {s.players.map((id) => {
          const p = get(id)
          const n = s.progress?.[id] ?? 0
          const full = n >= total
          return (
            <div key={id} className="flex items-center gap-2">
              <Avatar slug={p.slug} expression={full ? mood(p, 'proud') : n === 0 ? mood(p, 'think') : p.equipped} size={30} />
              <span className={cn('w-16 truncate text-sm font-bold', id === meId && 'text-tangerine')}>{p.nickname}</span>
              <div className="h-3 flex-1 overflow-hidden rounded-full border-2 border-ink bg-sunk">
                <motion.div className={cn('h-full', full ? 'bg-mint' : 'bg-sky')} animate={{ width: `${(n / Math.max(1, total)) * 100}%` }} transition={{ type: 'spring', stiffness: 200, damping: 20 }} />
              </div>
              <motion.span key={n} initial={{ scale: 1.8 }} animate={{ scale: 1 }} className="w-9 text-right font-display text-sm font-extrabold tabular-nums">
                {n}/{total}
              </motion.span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Validation (catégorie par catégorie)                                        */
/* -------------------------------------------------------------------------- */

const STATUS_UI: Record<ScoreStatus, { label: string; tone: 'mint' | 'sky' | 'tomato' | 'neutral' }> = {
  unique: { label: '2 pts', tone: 'mint' },
  shared: { label: '1 pt · doublon', tone: 'sky' },
  refused: { label: 'Refusée', tone: 'tomato' },
  empty: { label: 'Vide', tone: 'neutral' },
  letter: { label: 'Mauvaise lettre', tone: 'tomato' },
}

function Validation({ s, meId, isPlayer, isHost, get, act, pending }: { s: PetitBacState; meId: string; isPlayer: boolean; isHost: boolean; get: Get; act: ActFn; pending: boolean }) {
  const v = s.validation!
  const idx = Math.min(v.cat_index, s.categories.length - 1)
  const cat = s.categories[idx]
  const n = s.players.length
  const answers = v.answers[cat.id] ?? {}
  const contests = v.contests[cat.id] ?? {}
  const last = idx >= s.categories.length - 1

  const live = scoreCategory(s.players.map((id) => ({ id, text: answers[id]?.text ?? '', contests: (contests[id] ?? []).length })), s.letter, n)

  // Ordre de révélation : réponses vides à la fin (suspense sur les vraies réponses).
  const order = [...s.players].sort((a, b) => Number(!answers[a]?.text) - Number(!answers[b]?.text))

  const [busy, setBusy] = useState<string | null>(null)
  const toggle = async (target: string, value: boolean) => {
    setBusy(target)
    if (value) {
      playSound('fail')
      vibrate(30)
    } else fx.pop()
    await act(pbActions.contest(cat.id, target, value))
    setBusy(null)
  }

  return (
    <>
      <div className="flex justify-center gap-1.5">
        {s.categories.map((c, i) => (
          <motion.span
            key={c.id}
            animate={{ scale: i === idx ? 1.3 : 1 }}
            className={cn('size-3 rounded-full border-2 border-ink', i < idx ? 'bg-mint' : i === idx ? 'bg-sun' : 'bg-sunk')}
          />
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={cat.id}
          initial={{ x: 300, rotate: 8, opacity: 0 }}
          animate={{ x: 0, rotate: -1.5, opacity: 1 }}
          exit={{ x: -300, rotate: -8, opacity: 0, transition: { duration: 0.2 } }}
          transition={{ type: 'spring', stiffness: 260, damping: 18 }}
          onAnimationStart={() => fx.whoosh()}
          className="sticker flex items-center gap-3 bg-sun p-4 text-[#1f1b2e]"
        >
          <span className="text-5xl">{cat.emoji}</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold">
              Catégorie {idx + 1}/{s.categories.length}
            </p>
            <p className="truncate font-display text-3xl leading-tight font-extrabold">{cat.label}</p>
          </div>
          <span className="flex size-14 items-center justify-center rounded-full border-[3px] border-ink bg-surface font-display text-4xl font-extrabold text-text">{s.letter}</span>
        </motion.div>
      </AnimatePresence>

      <div key={cat.id} className="flex flex-col gap-2">
        {order.map((id, i) => {
          const p = get(id)
          const a = answers[id]
          const text = a?.text ?? ''
          const st = live[id]?.status ?? 'empty'
          const voters = contests[id] ?? []
          const mine = voters.includes(meId)
          const canContest = isPlayer && id !== meId && !a?.auto
          const refused = st === 'refused' || st === 'letter' || st === 'empty'
          const ui = STATUS_UI[st]
          return (
            <motion.div
              key={id}
              initial={{ scale: 0.3, y: 40, opacity: 0, rotate: i % 2 ? 6 : -6 }}
              animate={{ scale: 1, y: 0, opacity: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 18, delay: 0.35 + i * 0.28 }}
              onAnimationStart={() => window.setTimeout(() => fx.tick(), 350 + i * 280)}
              className={cn('sticker flex items-center gap-2 p-2.5', st === 'unique' ? 'bg-mint/30' : st === 'shared' ? 'bg-sky/25' : refused ? 'bg-sunk' : 'bg-surface')}
            >
              <Avatar slug={p.slug} expression={st === 'unique' ? mood(p, 'proud') : refused ? mood(p, 'sad') : p.equipped} size={44} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-bold text-muted">{p.nickname}</p>
                <p className={cn('font-display text-xl leading-tight font-extrabold break-words', refused && 'text-muted line-through decoration-tomato decoration-[3px]', !text && 'no-underline')}>
                  {text || '—'}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <motion.span key={st} initial={{ scale: 0.4 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 12 }}>
                    <Badge tone={ui.tone} tilted={false} className="text-xs">
                      {ui.label}
                    </Badge>
                  </motion.span>
                  {voters.length > 0 && (
                    <span className="flex items-center -space-x-2">
                      {voters.map((vid) => (
                        <motion.span key={vid} initial={{ scale: 0, y: -10 }} animate={{ scale: 1, y: 0 }}>
                          <Avatar slug={get(vid).slug} expression={mood(get(vid), 'angry')} size={22} />
                        </motion.span>
                      ))}
                    </span>
                  )}
                </div>
              </div>
              {canContest && (
                <motion.button
                  type="button"
                  aria-pressed={mine}
                  aria-label={mine ? `Retirer ma contestation de ${p.nickname}` : `Contester la réponse de ${p.nickname}`}
                  disabled={busy === id}
                  onClick={() => void toggle(id, !mine)}
                  whileTap={{ scale: 0.75, rotate: -25 }}
                  animate={mine ? { rotate: [0, -25, 15, -10, 0], scale: [1, 1.35, 1] } : { rotate: 0, scale: 1 }}
                  transition={{ duration: 0.45 }}
                  className={cn(
                    'relative flex size-14 shrink-0 items-center justify-center rounded-full border-[3px] border-ink text-3xl',
                    mine ? 'bg-tomato shadow-none' : 'bg-surface shadow-sticker-sm',
                  )}
                >
                  👎
                  {voters.length > 0 && (
                    <motion.span key={voters.length} initial={{ scale: 2 }} animate={{ scale: 1 }} className="absolute -top-1.5 -right-1.5 flex size-6 items-center justify-center rounded-full border-2 border-ink bg-sun font-display text-xs font-extrabold text-[#1f1b2e]">
                      {voters.length}
                    </motion.span>
                  )}
                </motion.button>
              )}
            </motion.div>
          )
        })}
      </div>

      <p className="text-center text-sm text-muted">
        👎 pour contester une réponse : refusée si plus de la moitié des autres joueurs la contestent.
      </p>

      {isHost ? (
        <div className="flex flex-col gap-2">
          <Button size="lg" fullWidth loading={pending} icon={last ? <Trophy className="size-6" /> : <ArrowRight className="size-6" />} onClick={() => void act(pbActions.nextCategory())}>
            {last ? 'Voir les scores' : 'Catégorie suivante'}
          </Button>
          {!last && (
            <button type="button" className="mx-auto flex items-center gap-1 font-display font-extrabold text-muted underline" onClick={() => void act(pbActions.closeValidation())}>
              <FastForward className="size-4" /> Tout valider d’un coup
            </button>
          )}
        </div>
      ) : (
        <p className="text-center font-bold text-muted">L’hôte passe à la catégorie suivante…</p>
      )}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Scores de la manche                                                         */
/* -------------------------------------------------------------------------- */

function RoundScore({ s, meId, isHost, get, act, pending }: { s: PetitBacState; meId: string; isHost: boolean; get: Get; act: ActFn; pending: boolean }) {
  const lr = s.last_round!
  const reduce = useReducedMotion()
  const [landed, setLanded] = useState(!!reduce)
  useEffect(() => {
    if (landed) return
    const t = window.setTimeout(() => {
      setLanded(true)
      fx.success()
    }, 1600)
    return () => clearTimeout(t)
  }, [landed])

  const best = Math.max(0, ...Object.values(lr.points))
  const celebrated = useRef(false)
  useEffect(() => {
    if (!landed || celebrated.current) return
    celebrated.current = true
    if (best > 0) {
      fx.fanfare()
      burst({ x: 0.5, y: 0.3 }, 110)
    }
  }, [landed, best])

  const before = (id: string) => (s.scores[id] ?? 0) - (lr.points[id] ?? 0)
  const shownScore = (id: string) => (landed ? (s.scores[id] ?? 0) : before(id))
  const rows = [...s.players].sort((a, b) => shownScore(b) - shownScore(a))
  const last = s.round >= s.total_rounds
  const mine = lr.points[meId]

  return (
    <>
      <motion.div
        initial={{ y: -200, rotate: -10, opacity: 0 }}
        animate={{ y: 0, rotate: -1.5, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 240, damping: 13 }}
        onAnimationStart={() => fx.whoosh()}
        className="sticker flex items-center gap-3 bg-lime p-4 text-[#1f1b2e]"
      >
        <span className="flex size-16 items-center justify-center rounded-full border-[3px] border-ink bg-sun font-display text-5xl font-extrabold">{lr.letter}</span>
        <div>
          <p className="text-sm font-bold">
            Manche {lr.round}/{s.total_rounds}
          </p>
          <p className="font-display text-3xl leading-tight font-extrabold">Les scores !</p>
        </div>
      </motion.div>

      {typeof mine === 'number' && (
        <motion.p initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.4, type: 'spring', stiffness: 400, damping: 12 }} className="text-center font-display text-2xl font-extrabold">
          {mine === best && best > 0 ? `🏅 Meilleur score de la manche : +${mine} !` : mine > 0 ? `Tu marques +${mine} 👏` : 'Zéro pointé cette fois… 🙈'}
        </motion.p>
      )}

      <LayoutGroup>
        <div className="sticker flex flex-col gap-2 bg-surface p-3">
          {rows.map((id, i) => {
            const p = get(id)
            const pts = lr.points[id] ?? 0
            return (
              <motion.div layout key={id} transition={{ type: 'spring', stiffness: 260, damping: 24 }} className={cn('relative flex items-center gap-2 rounded-chip p-1.5', id === meId && 'bg-sun/25')}>
                <span className="w-6 text-center font-display text-lg font-extrabold">{i + 1}</span>
                <Avatar slug={p.slug} expression={landed && pts === best && best > 0 ? mood(p, 'proud') : pts === 0 ? mood(p, 'sad') : p.equipped} size={40} />
                <span className="flex-1 truncate font-display text-lg font-extrabold">{p.nickname}</span>
                {/* +pts qui s'envolent vers le total */}
                <AnimatePresence>
                  {!landed && (
                    <motion.span
                      key="fly"
                      initial={{ scale: 0, x: -30, y: 10 }}
                      animate={{ scale: 1.2, x: 0, y: 0 }}
                      exit={{ x: 70, y: -6, scale: 0.4, opacity: 0, transition: { duration: 0.35, ease: 'easeIn' } }}
                      transition={{ delay: 0.3 + i * 0.12, type: 'spring', stiffness: 500, damping: 14 }}
                      className={cn('rounded-full border-2 border-ink px-2 font-display text-lg font-extrabold', pts > 0 ? 'bg-mint text-[#1f1b2e]' : 'bg-sunk')}
                    >
                      +{pts}
                    </motion.span>
                  )}
                </AnimatePresence>
                <motion.span
                  animate={landed && pts > 0 ? { scale: [1, 1.5, 1] } : { scale: 1 }}
                  transition={{ duration: 0.45 }}
                  className="w-12 text-right font-display text-2xl font-extrabold tabular-nums"
                >
                  <AnimatedNumber value={shownScore(id)} duration={0.6} />
                </motion.span>
              </motion.div>
            )
          })}
        </div>
      </LayoutGroup>

      <details className="sticker bg-surface p-3">
        <summary className="cursor-pointer font-display font-extrabold">Détail des réponses</summary>
        <div className="mt-2 flex flex-col gap-3">
          {s.categories.map((c) => (
            <div key={c.id}>
              <p className="font-display font-extrabold">
                {c.emoji} {c.label}
              </p>
              <ul className="mt-1 flex flex-col gap-1">
                {s.players.map((id) => {
                  const d = lr.detail[c.id]?.[id]
                  if (!d) return null
                  return (
                    <li key={id} className="flex items-center gap-2 text-sm">
                      <Avatar slug={get(id).slug} size={22} />
                      <span className={cn('flex-1 truncate font-bold', d.pts === 0 && 'text-muted line-through')}>{d.text || '—'}</span>
                      <Badge tone={STATUS_UI[d.status].tone} tilted={false} className="text-xs">
                        {d.pts > 0 ? `+${d.pts}` : STATUS_UI[d.status].label}
                      </Badge>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      </details>

      {isHost ? (
        <Button size="lg" fullWidth loading={pending} icon={last ? <Trophy className="size-6" /> : <ArrowRight className="size-6" />} onClick={() => void act(pbActions.nextRound())}>
          {last ? 'Résultats finaux' : 'Manche suivante'}
        </Button>
      ) : (
        <p className="text-center font-bold text-muted">{last ? 'L’hôte va afficher les résultats…' : 'L’hôte va lancer la manche suivante…'}</p>
      )}
    </>
  )
}
