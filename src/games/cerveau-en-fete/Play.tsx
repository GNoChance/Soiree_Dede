import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AnimatePresence, LayoutGroup, motion, useAnimate, useReducedMotion } from 'framer-motion'
import confetti from 'canvas-confetti'
import { ArrowRight, Flag, SkipForward, Send, Trophy } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ChibiImage } from '@/components/ui/ChibiImage'
import { burst } from '@/components/ui/confetti'
import { fx } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import { ConfirmModal, DropCard } from '@/features/soiree/components'
import { mood, playerOrPlaceholder } from '@/features/soiree/players'
import { serverNow, useCountdown } from '@/features/soiree/useServerClock'
import { useTv } from '@/features/tv/tv'
import { TvButton } from '@/features/tv/TvButton'
import CerveauTv from './TvView'
import type { GamePlayProps, PlayerInfo } from '../types'
import type { CefPublicQuestion, CefReveal, CefState } from './types'
import { cefActions, formatMs, rankLabel, themeInfo } from './setup'

type Get = (id: string) => PlayerInfo
type ActFn = GamePlayProps['act']

const CHOICE_COLORS = ['bg-sky', 'bg-bubblegum', 'bg-sun', 'bg-lime'] as const
const LETTERS = ['A', 'B', 'C', 'D'] as const

/** Explosion verte (bonne réponse) depuis un élément. */
function greenBurst(el: Element | null) {
  const r = el?.getBoundingClientRect()
  const origin = r
    ? { x: (r.left + r.width / 2) / window.innerWidth, y: (r.top + r.height / 2) / window.innerHeight }
    : { x: 0.5, y: 0.5 }
  void confetti({
    particleCount: 110, spread: 100, startVelocity: 42, origin, zIndex: 100, disableForReducedMotion: true,
    colors: ['#06D6A0', '#B5E61D', '#2EC4B6', '#FFFFFF'],
  })
  void confetti({
    particleCount: 30, spread: 360, startVelocity: 22, origin, zIndex: 100, disableForReducedMotion: true,
    shapes: ['star'], colors: ['#06D6A0', '#FFB703'], scalar: 1.4,
  })
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
      if (sent++ < 6) void act(cefActions.tick())
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

export default function CerveauPlay({ soireeId, state, meId, isHost, players, act, pending }: GamePlayProps) {
  const s = state as unknown as CefState
  const get: Get = (id) => playerOrPlaceholder(players, id)
  useDeadlineTick(s.phase === 'question' || s.phase === 'reveal' ? s.deadline : null, act)
  const tv = useTv()
  if (tv) return <CerveauTv state={state} players={players} />

  return (
    <div className="flex flex-col gap-4 pb-6">
      {s.phase === 'question' && <QuestionPhase key={`q${s.round}`} s={s} meId={meId} isHost={isHost} get={get} act={act} />}
      {s.phase === 'reveal' && s.last_reveal && (
        <RevealPhase key={`r${s.round}`} s={s} lr={s.last_reveal} meId={meId} isHost={isHost} get={get} act={act} pending={pending} />
      )}
      <Scoreboard s={s} meId={meId} get={get} />
      {(isHost || !s.players.includes(meId)) && (
        <div className="flex justify-center">
          <TvButton soireeId={soireeId} />
        </div>
      )}
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
        {!urgent && <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(-45deg,transparent_0_10px,rgba(255,255,255,0.25)_10px_20px)]" />}
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

/* -------------------------------------------------------------------------- */
/* Carte question                                                              */
/* -------------------------------------------------------------------------- */

const EMOJI_RUN = /((?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|‍|️|⃣)(?:\s*(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|‍|️|⃣))*)/u
const PICTO = /\p{Extended_Pictographic}/gu

/** Énoncé : les rébus d'émojis (≥ 2 émojis à la suite) s'affichent en très gros. */
function PromptText({ text, small }: { text: string; small?: boolean }) {
  const parts = text.split(EMOJI_RUN)
  const isRebus = (p: string) => (p.match(PICTO)?.length ?? 0) >= 2
  if (!parts.some(isRebus)) {
    return <p className={cn('font-display leading-tight font-extrabold', small ? 'text-xl' : 'text-[1.6rem]')}>{text}</p>
  }
  return (
    <div className="flex flex-col items-center gap-2">
      {parts.map((p, i) =>
        isRebus(p) ? (
          <motion.span
            key={i}
            className={cn('block leading-none tracking-widest', small ? 'text-5xl' : 'text-7xl')}
            initial={{ scale: 0.2, rotate: -20 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 10, delay: 0.35 }}
          >
            {p.replace(/\s+/g, ' ').trim()}
          </motion.span>
        ) : p.replace(/^[\s:–-]+|[\s:–-]+$/g, '') ? (
          <p key={i} className={cn('font-display leading-tight font-extrabold', small ? 'text-lg' : 'text-2xl')}>
            {p.replace(/^[\s:–-]+|[\s:–-]+$/g, '')}
          </p>
        ) : null,
      )}
    </div>
  )
}

function QuestionImage({ image, small }: { image: NonNullable<CefPublicQuestion['image']>; small?: boolean }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    <figure className="mb-3 flex flex-col items-center gap-0.5">
      <img
        src={image.url}
        alt=""
        onError={() => setFailed(true)}
        className={cn('w-auto max-w-full rounded-chip border-[3px] border-ink object-contain bg-white', small ? 'max-h-32' : 'max-h-56')}
      />
      {image.credit && (
        <figcaption className="text-[10px] leading-tight opacity-70">
          © {image.credit}
          {image.license ? ` · ${image.license}` : ''}
        </figcaption>
      )}
    </figure>
  )
}

function QuestionBadges({ q, round, total }: { q: CefPublicQuestion; round: number; total: number }) {
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
      <motion.span initial={{ scale: 0 }} animate={{ scale: 1, rotate: [0, -8, 8, 0] }} transition={{ delay: 0.5, type: 'spring', stiffness: 400, damping: 10 }}>
        <Badge tone={q.mode === 'typed' ? 'grape' : 'sky'}>{q.mode === 'typed' ? '⌨️ Tape ta réponse' : '🔘 QCM · 1 essai'}</Badge>
      </motion.span>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Phase question                                                              */
/* -------------------------------------------------------------------------- */

function QuestionPhase({ s, meId, isHost, get, act }: { s: CefState; meId: string; isHost: boolean; get: Get; act: ActFn }) {
  const q = s.question
  const isPlayer = s.players.includes(meId)
  const myFound = s.found.find((f) => f.profile_id === meId)
  const iPassed = s.passed.includes(meId)
  const iMissed = s.missed.includes(meId)
  const done = !!myFound || iPassed || iMissed
  const zoneRef = useRef<HTMLDivElement>(null)
  const [passing, setPassing] = useState(false)
  const [confirmReveal, setConfirmReveal] = useState(false)

  // Célébration quand je trouve (réponse RPC ou Realtime, une seule fois).
  const celebrated = useRef(false)
  useEffect(() => {
    if (!myFound || celebrated.current) return
    celebrated.current = true
    fx.success()
    window.setTimeout(() => fx.pop(), 180)
    greenBurst(zoneRef.current)
  }, [myFound])

  const pass = async () => {
    setPassing(true)
    await act(cefActions.pass(s.round))
    setPassing(false)
  }

  return (
    <>
      <TimerBar deadline={s.deadline} totalMs={s.duration * 1000} />

      <DropCard k={s.round} accent={themeInfo(q.theme).color} className="text-[#1f1b2e]">
        <QuestionBadges q={q} round={s.round} total={s.total_rounds} />
        {q.image && <QuestionImage image={q.image} />}
        <PromptText text={q.prompt} />
      </DropCard>

      <div ref={zoneRef}>
        {!isPlayer ? (
          <p className="text-center font-bold text-muted">Tu regardes : les joueurs cherchent… 🤔</p>
        ) : done ? (
          <DoneCard s={s} meId={meId} />
        ) : q.mode === 'typed' ? (
          <TypedAnswer s={s} meId={meId} act={act} />
        ) : (
          <ChoiceAnswer s={s} meId={meId} act={act} />
        )}
      </div>

      <FinderStrip s={s} get={get} meId={meId} />

      <div className="flex gap-2">
        {isPlayer && !done && (
          <Button variant="secondary" className="flex-1" loading={passing} icon={<Flag className="size-5" />} onClick={() => void pass()}>
            Je passe 🏳️
          </Button>
        )}
      </div>
      {isHost && (
        <div className="mt-4 flex items-center justify-between gap-2 border-t-2 border-dashed border-ink/30 pt-2">
          <span className="text-xs font-bold text-muted">Hôte</span>
          <Button
            variant="ghost"
            size="sm"
            icon={<SkipForward className="size-4" />}
            onClick={() => {
              if (isPlayer && !done) setConfirmReveal(true)
              else void act(cefActions.skip(s.round))
            }}
          >
            ⏭ Révéler la réponse
          </Button>
        </div>
      )}
      <ConfirmModal
        open={confirmReveal}
        onClose={() => setConfirmReveal(false)}
        title="Révéler la réponse ?"
        confirmLabel="Révéler"
        onConfirm={() => {
          setConfirmReveal(false)
          void act(cefActions.skip(s.round))
        }}
      >
        La question s’arrête pour tout le monde, toi compris.
      </ConfirmModal>
    </>
  )
}

function TypedAnswer({ s, meId, act }: { s: CefState; meId: string; act: ActFn }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [shake, setShake] = useState(0)
  const [wrong, setWrong] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const reduce = useReducedMotion()
  const [scope, animate] = useAnimate<HTMLFormElement>()

  useEffect(() => {
    const t = window.setTimeout(() => inputRef.current?.focus(), 450)
    return () => clearTimeout(t)
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const t = text.trim()
    if (!t || sending) return
    setSending(true)
    const res = (await act(cefActions.answer(s.round, t))) as unknown as CefState | null
    setSending(false)
    inputRef.current?.focus()
    if (!res || res.round !== s.round || res.phase !== 'question') return
    // Trouvé : le parent bascule sur DoneCard (célébration). Sinon : échec.
    if (res.found.some((f) => f.profile_id === meId)) return
    setWrong(t)
    setShake((n) => n + 1)
    // On vide le champ (sauf si le joueur a déjà retapé autre chose entre-temps).
    setText((cur) => (cur.trim() === t ? '' : cur))
    fx.fail()
    // Pas de `key` qui changerait : remonter l'input fermerait le clavier mobile.
    if (scope.current && !reduce) void animate(scope.current, { x: [0, -16, 16, -12, 12, -6, 6, 0] }, { duration: 0.45 })
  }

  return (
    <form ref={scope} onSubmit={(e) => void submit(e)} className="flex flex-col gap-2">
      <div className={cn('sticker flex items-center gap-2 p-2 transition-colors', shake ? 'bg-tomato/15' : 'bg-surface')}>
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          enterKeyHint="send"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={80}
          placeholder="Ta réponse…"
          aria-label="Ta réponse"
          className="min-w-0 flex-1 bg-transparent px-2 py-2 font-display text-3xl font-extrabold outline-none placeholder:text-muted/60"
        />
        <motion.button
          type="submit"
          // garde le focus (et le clavier mobile) sur le champ
          onPointerDown={(e) => e.preventDefault()}
          whileTap={{ scale: 0.85 }}
          disabled={!text.trim()}
          aria-label="Envoyer"
          className="flex size-14 shrink-0 items-center justify-center rounded-full border-[3px] border-ink bg-mint text-[#1f1b2e] shadow-sticker-sm disabled:opacity-40"
        >
          <Send className="size-6" strokeWidth={3} />
        </motion.button>
      </div>
      <div className="h-6 text-center">
        <AnimatePresence mode="popLayout">
          {wrong && (
            <motion.p
              key={shake}
              initial={{ y: -10, opacity: 0, scale: 1.3 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="font-display font-extrabold text-tomato"
            >
              ✗ « {wrong} » — essaie encore !
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </form>
  )
}

function ChoiceAnswer({ s, meId, act }: { s: CefState; meId: string; act: ActFn }) {
  const [picked, setPicked] = useState<number | null>(null)
  const choices = s.question.choices ?? []

  const choose = async (i: number) => {
    if (picked !== null) return
    setPicked(i)
    const res = (await act(cefActions.choose(s.round, i))) as unknown as CefState | null
    if (!res) {
      setPicked(null)
      return
    }
    if (res.round === s.round && res.missed?.includes(meId)) fx.fail()
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      {choices.map((c, i) => (
        <motion.button
          key={i}
          type="button"
          initial={{ scale: 0, rotate: i % 2 ? 10 : -10 }}
          animate={{ scale: picked === i ? 1.05 : 1, rotate: 0, opacity: picked !== null && picked !== i ? 0.45 : 1 }}
          transition={{ type: 'spring', stiffness: 420, damping: 14, delay: picked === null ? 0.3 + i * 0.07 : 0 }}
          whileTap={{ scale: 0.9 }}
          disabled={picked !== null}
          onClick={() => {
            fx.pop()
            void choose(i)
          }}
          className={cn('sticker flex min-h-20 items-center gap-2 p-3 text-left text-[#1f1b2e]', CHOICE_COLORS[i % 4])}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-white font-display font-extrabold">{LETTERS[i]}</span>
          <span className="font-display text-lg leading-tight font-extrabold">{c}</span>
        </motion.button>
      ))}
    </div>
  )
}

function DoneCard({ s, meId }: { s: CefState; meId: string }) {
  const f = s.found.find((x) => x.profile_id === meId)
  const reduce = useReducedMotion()
  if (f) {
    return (
      <motion.div
        initial={{ scale: 0.3, rotate: -12 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 11 }}
        className="sticker flex flex-col items-center gap-1 bg-mint p-4 text-center text-[#1f1b2e]"
      >
        <motion.span className="text-5xl" animate={reduce ? undefined : { rotate: [0, -15, 15, 0], scale: [1, 1.2, 1] }} transition={{ duration: 0.6 }}>
          🎉
        </motion.span>
        <p className="font-display text-3xl font-extrabold">Trouvé !</p>
        <p className="font-display text-lg font-extrabold">
          {f.rank === 1 ? '⚡ Le plus rapide !' : `${rankLabel(f.rank)} à trouver`} · {formatMs(f.ms)}
        </p>
        <motion.span initial={{ scale: 3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.25, type: 'spring', stiffness: 300, damping: 12 }} className="font-display text-4xl font-extrabold">
          +{f.points}
        </motion.span>
      </motion.div>
    )
  }
  const missed = s.missed.includes(meId)
  return (
    <motion.div
      initial={{ y: 30, opacity: 0 }}
      animate={missed && !reduce ? { y: 0, opacity: 1, x: [0, -12, 12, -8, 8, 0] } : { y: 0, opacity: 1 }}
      className={cn('sticker p-4 text-center', missed ? 'bg-tomato text-white' : 'bg-sunk')}
    >
      <p className="font-display text-2xl font-extrabold">{missed ? '✗ Raté !' : '🏳️ Tu passes'}</p>
      <p className="font-bold opacity-90">{missed ? 'Un seul essai en QCM… la réponse arrive !' : 'Réponse dans un instant…'}</p>
    </motion.div>
  )
}

/** Avatars qui s'allument quand un joueur trouve (avec son rang). */
function FinderStrip({ s, get, meId }: { s: CefState; get: Get; meId: string }) {
  const done = s.found.length + s.passed.length + s.missed.length
  return (
    <div className="sticker flex flex-col gap-2 bg-surface p-3">
      <div className="flex items-center justify-between">
        <span className="font-display text-lg font-extrabold">
          <motion.span key={s.found.length} initial={{ scale: 1.8, color: '#06D6A0' }} animate={{ scale: 1, color: 'var(--text)' }} className="inline-block">
            {s.found.length}
          </motion.span>
          /{s.players.length} ont trouvé
        </span>
        <div className="h-3 w-24 overflow-hidden rounded-full border-2 border-ink bg-sunk">
          <motion.div className="h-full bg-mint" animate={{ width: `${(done / Math.max(1, s.players.length)) * 100}%` }} />
        </div>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {s.players.map((id) => {
          const p = get(id)
          const f = s.found.find((x) => x.profile_id === id)
          const passed = s.passed.includes(id)
          const missed = s.missed.includes(id)
          return (
            <motion.div
              key={id}
              animate={f ? { scale: [1, 1.35, 1], y: [0, -10, 0], opacity: 1 } : { scale: 1, opacity: passed || missed ? 0.4 : 0.75 }}
              transition={{ duration: 0.45 }}
              className={cn('flex flex-col items-center', !f && 'grayscale')}
            >
              <div className={cn('relative rounded-full', f && 'ring-4 ring-mint')}>
                <Avatar
                  slug={p.slug}
                  expression={f ? mood(p, f.rank === 1 ? 'proud' : 'happy') : passed ? mood(p, 'sleepy') : missed ? mood(p, 'sad') : mood(p, 'think')}
                  size={44}
                  badge={passed ? '🏳️' : missed ? '✗' : undefined}
                />
                {f && (
                  <motion.span
                    initial={{ scale: 0, rotate: -40 }}
                    animate={{ scale: 1, rotate: -8 }}
                    transition={{ type: 'spring', stiffness: 600, damping: 12 }}
                    className="absolute -top-2 -right-3 rounded-full border-2 border-ink bg-mint px-1.5 font-display text-xs font-extrabold text-[#1f1b2e] shadow-sticker-sm"
                  >
                    {f.rank === 1 ? '⚡1er' : `✓${rankLabel(f.rank)}`}
                  </motion.span>
                )}
              </div>
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

function RevealPhase({ s, lr, meId, isHost, get, act, pending }: { s: CefState; lr: CefReveal; meId: string; isHost: boolean; get: Get; act: ActFn; pending: boolean }) {
  const reduce = useReducedMotion()
  const left = useCountdown(s.deadline, 200)
  const totalMs = (s.reveal_seconds || 8) * 1000
  const last = s.round >= s.total_rounds
  const mine = lr.found.find((f) => f.profile_id === meId)
  const nobody = lr.found.length === 0

  const done = useRef(false)
  useEffect(() => {
    if (done.current) return
    done.current = true
    if (mine) {
      fx.success()
      burst({ x: 0.5, y: 0.3 }, 80)
    } else {
      fx.whoosh()
    }
  }, [mine])

  const notFound = s.players.filter((id) => !lr.found.some((f) => f.profile_id === id))

  return (
    <>
      <motion.div
        initial={{ scale: 0.2, rotate: -20, opacity: 0 }}
        animate={{ scale: 1, rotate: -1.5, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 11 }}
        className="sticker flex flex-col items-center gap-2 bg-sun p-5 text-center text-[#1f1b2e]"
      >
        {lr.question.image && <QuestionImage image={lr.question.image} small />}
        <PromptText text={lr.question.prompt} small />
        <p className="mt-1 text-sm font-bold opacity-75">La réponse :</p>
        <motion.p
          initial={{ scale: 3, opacity: 0, rotate: 10 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          transition={{ delay: 0.35, type: 'spring', stiffness: 320, damping: 12 }}
          className="font-display text-4xl leading-tight font-extrabold [paint-order:stroke] [-webkit-text-stroke:1px_#1f1b2e]"
        >
          {lr.answer}
        </motion.p>
      </motion.div>

      {/* QCM : qui a choisi quoi */}
      {lr.mode === 'mcq' && lr.choices && (
        <div className="grid grid-cols-2 gap-2">
          {lr.choices.map((c, i) => {
            const ok = i === lr.correct
            const who = Object.entries(lr.picks).filter(([, v]) => v === i).map(([k]) => k)
            return (
              <motion.div
                key={i}
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: ok ? 1.04 : 0.96, opacity: ok ? 1 : 0.55 }}
                transition={{ delay: 0.6 + i * 0.08, type: 'spring', stiffness: 300, damping: 14 }}
                className={cn('sticker flex flex-col gap-1 p-2 text-[#1f1b2e]', ok ? 'bg-mint' : 'bg-sunk text-text')}
              >
                <span className="font-display leading-tight font-extrabold">
                  {ok ? '✓ ' : ''}
                  {c}
                </span>
                <div className="flex flex-wrap gap-0.5">
                  {who.map((id) => (
                    <Avatar key={id} slug={get(id).slug} size={24} expression={ok ? mood(get(id), 'happy') : mood(get(id), 'sad')} />
                  ))}
                </div>
              </motion.div>
            )
          })}
        </div>
      )}

      {/* Qui a trouvé, en combien de temps */}
      <div className="sticker flex flex-col gap-1.5 bg-surface p-3">
        <p className="font-display text-lg font-extrabold">{nobody ? 'Personne n’a trouvé ! 🦗' : `${lr.found.length} ${lr.found.length > 1 ? 'ont' : 'a'} trouvé`}</p>
        {[...lr.found]
          .sort((a, b) => a.rank - b.rank)
          .map((f, i) => {
            const p = get(f.profile_id)
            return (
              <motion.div
                key={f.profile_id}
                initial={{ x: -60, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ delay: 0.7 + i * 0.12, type: 'spring', stiffness: 300, damping: 18 }}
                className={cn('flex items-center gap-2 rounded-chip px-1 py-0.5', f.profile_id === meId && 'bg-mint/25')}
              >
                <span className="w-8 text-center font-display font-extrabold">{f.rank === 1 ? '⚡' : rankLabel(f.rank)}</span>
                <Avatar slug={p.slug} expression={mood(p, f.rank === 1 ? 'proud' : 'happy')} size={34} />
                <span className="flex-1 truncate font-bold">{p.nickname}</span>
                <span className="text-sm font-bold text-muted">{formatMs(f.ms)}</span>
                <Badge tone="mint">+{f.points}</Badge>
              </motion.div>
            )
          })}
        {notFound.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-2 border-t-2 border-dashed border-ink/20 pt-2">
            {notFound.map((id) => {
              const p = get(id)
              const tries = lr.tries[id] ?? 0
              const tag = lr.passed.includes(id) ? '🏳️' : lr.missed.includes(id) ? '✗' : '⌛'
              return (
                <span key={id} className="flex items-center gap-1 rounded-full bg-sunk py-0.5 pr-2 pl-0.5 text-sm font-bold">
                  <Avatar slug={p.slug} expression={mood(p, 'sad')} size={24} />
                  {p.nickname} {tag}
                  {tries > 0 && <span className="text-muted">· {tries} essai{tries > 1 ? 's' : ''}</span>}
                  {(lr.wrong?.[id]?.length ?? 0) > 0 && <span className="text-muted">· ✍️ « {lr.wrong?.[id]?.[lr.wrong[id].length - 1]} »</span>}
                </span>
              )
            })}
          </div>
        )}
      </div>

      {s.players.includes(meId) && !mine && (
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.9, type: 'spring' }} className="flex items-center justify-center gap-2">
          <ChibiImage slug={get(meId).slug} expression={mood(get(meId), 'sad')} size={56} />
          <span className="font-display text-lg font-extrabold text-muted">Raté pour cette fois…</span>
        </motion.div>
      )}

      {/* Suite automatique */}
      <div className="flex items-center gap-2">
        <div className="h-2 flex-1 overflow-hidden rounded-full border-2 border-ink bg-sunk">
          <motion.div className="h-full bg-grape" animate={{ width: `${Math.min(100, (left / totalMs) * 100)}%` }} transition={{ ease: 'linear', duration: reduce ? 0 : 0.2 }} />
        </div>
        <span className="text-sm font-bold text-muted">{last ? 'Résultats' : 'Suite'} dans {Math.ceil(left / 1000)} s</span>
      </div>

      {isHost && (
        <Button size="lg" fullWidth loading={pending} icon={last ? <Trophy className="size-6" /> : <ArrowRight className="size-6" />} onClick={() => void act(cefActions.next(s.round))}>
          {last ? 'Voir les résultats' : 'Question suivante'}
        </Button>
      )}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Tableau des scores                                                          */
/* -------------------------------------------------------------------------- */

function Scoreboard({ s, meId, get }: { s: CefState; meId: string; get: Get }) {
  const sorted = [...s.players].sort((a, b) => (s.scores[b] ?? 0) - (s.scores[a] ?? 0))
  const deltas = s.phase === 'reveal' ? (s.last_reveal?.points ?? {}) : {}
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
            return (
              <motion.div
                layout
                key={id}
                transition={{ type: 'spring', stiffness: 320, damping: 26 }}
                className={cn('flex items-center gap-2 rounded-chip bg-surface px-2 py-1', id === meId && 'ring-2 ring-sun')}
              >
                <span className="w-6 text-center font-display font-extrabold">{i === 0 && sc > 0 ? '👑' : i + 1}</span>
                <Avatar slug={p.slug} size={30} />
                <span className="flex-1 truncate text-sm font-bold">{p.nickname}</span>
                <AnimatePresence>
                  {d ? (
                    <motion.span
                      key={`d${s.round}`}
                      initial={{ scale: 0, y: 10 }}
                      animate={{ scale: 1, y: 0 }}
                      exit={{ scale: 0, opacity: 0 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 14, delay: 0.4 }}
                      className="font-display text-sm font-extrabold text-mint"
                    >
                      +{d}
                    </motion.span>
                  ) : null}
                </AnimatePresence>
                <AnimatedNumber value={sc} className="w-14 text-right font-display text-lg font-extrabold" />
              </motion.div>
            )
          })}
        </div>
      </LayoutGroup>
    </div>
  )
}
