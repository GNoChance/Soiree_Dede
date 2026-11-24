import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, Clock } from 'lucide-react'
import { useNavigate } from 'react-router'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { victoryConfetti } from '@/components/ui/confetti'
import { errorCode, toastError } from '@/features/soiree/errors'
import { playerOrPlaceholder, usePlayers } from '@/features/soiree/players'
import { serverNow, useCountdown } from '@/features/soiree/useServerClock'
import { fx } from '@/lib/feedback'
import { useSession } from '@/store/session'
import { useHoldUpdate } from '@/store/updateHold'
import { useNoelState } from './api'
import { hotteAnswer, hotteBoard, hotteFlakes, hotteStart, type HotteBoardRow, type HotteRun } from './hotteApi'
import { HotteRoundView, type RoundFeedback } from './hotte/Rounds'
import { hotteTimeUp, parisDay } from './hotteTime'

type Phase = 'intro' | 'loading' | 'play' | 'end'

/** La Hotte du jour : 5 manches de Noël, un seul essai, classement du jour de la bande. */
export function HottePage() {
  const navigate = useNavigate()
  const { state, refetch } = useNoelState(true)
  const [phase, setPhase] = useState<Phase>('intro')
  const [run, setRun] = useState<HotteRun | null>(null)
  const [feedback, setFeedback] = useState<RoundFeedback | null>(null)
  const [score, setScore] = useState(0)
  const [board, setBoard] = useState<HotteBoardRow[] | null>(null)
  useHoldUpdate(phase === 'loading' || phase === 'play')

  const idx = run ? run.answers.length : 0
  const left = useCountdown(phase === 'play' ? run?.deadline : null, 500)
  // Une réponse en cours d'envoi / une fin déjà déclenchée : on ignore les doubles appuis.
  const sending = useRef(false)
  const ended = useRef(false)

  const loadBoard = async () => {
    try {
      setBoard(await hotteBoard())
    } catch {
      setBoard([])
    }
  }

  const finish = async (final: number) => {
    if (ended.current) return
    ended.current = true
    setScore(final)
    setPhase('end')
    if (final >= 4) victoryConfetti(1800)
    else fx.success()
    await Promise.all([loadBoard(), refetch()])
  }

  // Hotte déjà faite AUJOURD'HUI (pas l'état d'hier resté en mémoire) : directement le résultat.
  const doneToday = state?.hotte.status === 'done' && state.day === parisDay(serverNow())
  useEffect(() => {
    if (doneToday && phase === 'intro') {
      ended.current = true
      setScore(state?.hotte.score ?? 0)
      setPhase('end')
      void loadBoard()
    }
  }, [doneToday, phase, state?.hotte.score])

  // Temps écoulé (vraie échéance, pas la valeur initiale du compte à rebours) : l'essai est clos
  // par le serveur avec les réponses déjà données. Relu aussi à la fin d'un retour juste/faux.
  useEffect(() => {
    if (phase === 'play' && run && !feedback && hotteTimeUp(run.deadline, serverNow())) void finish(run.score)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, left, feedback])

  const start = async () => {
    setPhase('loading')
    try {
      const r = await hotteStart()
      setRun(r)
      setScore(r.score)
      if (r.finished) await finish(r.score)
      else setPhase('play')
    } catch (e) {
      if (errorCode(e) === 'hotte_done') {
        await finish(state?.hotte.score ?? 0)
        return
      }
      toastError(e)
      setPhase('intro')
    }
  }

  const answer = async (a: string) => {
    if (!run || feedback || sending.current || ended.current) return
    sending.current = true
    const round = idx + 1
    try {
      const res = await hotteAnswer(round, a)
      setFeedback({ chosen: a, correct: res.correct, ok: res.ok })
      if (res.ok) fx.success()
      else fx.fail()
      setScore(res.score)
      window.setTimeout(() => {
        sending.current = false
        setFeedback(null)
        setRun((r) => (r ? { ...r, score: res.score, answers: [...r.answers, { round, answer: a, ok: res.ok }] } : r))
        if (res.finished) void finish(res.score)
      }, 1300)
    } catch (e) {
      sending.current = false
      toastError(e)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col gap-4 p-4 pt-safe">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Retour"
          onClick={() => navigate('/noel')}
          className="flex size-11 items-center justify-center rounded-full border-[3px] border-ink bg-surface shadow-sticker-sm"
        >
          <ArrowLeft className="size-5" strokeWidth={3} />
        </button>
        <h1 className="flex-1 text-3xl">🎁 La Hotte du jour</h1>
        {phase === 'play' && (
          <span className="flex items-center gap-1 font-display font-extrabold tabular-nums">
            <Clock className="size-5" /> {Math.max(0, Math.ceil(left / 1000))} s
          </span>
        )}
      </div>

      {phase === 'intro' && (
        <Card className="flex flex-col items-center gap-4 text-center">
          <motion.span className="text-8xl" animate={{ rotate: [0, -6, 6, 0] }} transition={{ repeat: Infinity, duration: 2.4 }}>
            🎁
          </motion.span>
          <p className="font-display text-2xl font-extrabold">5 manches de Noël, un seul essai !</p>
          <p className="font-bold text-muted">Quiz, cadeau disparu, intrus, « combien ? » et chansons à trous. Chaque bonne réponse rapporte 6 ❄️.</p>
          <Button size="lg" fullWidth onClick={() => void start()} disabled={state?.phase !== 'live'}>
            Ouvrir la Hotte
          </Button>
          {state && state.phase !== 'live' && <p className="text-sm font-bold text-muted">La Hotte ouvre du 1er décembre au 6 janvier.</p>}
        </Card>
      )}

      {phase === 'loading' && <p className="text-center font-display text-xl font-extrabold">🎅 Le Père Noël prépare la Hotte…</p>}

      {phase === 'play' && run && run.rounds[idx] && (
        <>
          <div className="flex items-center justify-center gap-2" aria-label={`Manche ${idx + 1} sur 5`}>
            {run.rounds.map((_, i) => (
              <span
                key={i}
                className={`size-4 rounded-full border-2 border-ink ${i < idx ? (run.answers[i]?.ok ? 'bg-mint' : 'bg-tomato') : i === idx ? 'bg-sun' : 'bg-surface'}`}
              />
            ))}
          </div>
          <AnimatePresence mode="wait">
            <motion.div key={idx} initial={{ x: 60, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -60, opacity: 0 }}>
              <HotteRoundView round={run.rounds[idx]} feedback={feedback} onAnswer={(a) => void answer(a)} />
            </motion.div>
          </AnimatePresence>
        </>
      )}

      {phase === 'end' && <HotteEnd score={score} board={board} onBack={() => navigate('/noel')} />}
    </div>
  )
}

function HotteEnd({ score, board, onBack }: { score: number; board: HotteBoardRow[] | null; onBack: () => void }) {
  const { byId } = usePlayers()
  const meId = useSession((s) => s.profile?.id)
  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col items-center gap-2 text-center">
        <motion.p className="font-display text-6xl font-extrabold" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 10 }}>
          {score}/5
        </motion.p>
        <p className="font-display text-2xl font-extrabold">+{hotteFlakes(score)} ❄️</p>
        <p className="font-bold text-muted">{score === 5 ? 'Sans faute, digne du Père Noël ! 🎅' : score >= 3 ? 'Joli ! Les lutins sont fiers de toi.' : 'Le Père Noël a vu pire… Revanche demain !'}</p>
      </Card>
      <Card className="flex flex-col gap-2">
        <p className="font-display text-xl font-extrabold">🏆 Classement du jour</p>
        {board === null && <p className="text-sm font-bold text-muted">Chargement…</p>}
        {board?.map((r, i) => {
          const p = playerOrPlaceholder(byId, r.profile_id)
          return (
            <div key={r.profile_id} className={`flex items-center gap-3 rounded-card p-2 ${r.profile_id === meId ? 'bg-sun/30' : ''}`}>
              <span className="w-6 text-center font-display font-extrabold">{i + 1}</span>
              <Avatar slug={p.slug} tenue={p.equippedTenue} size={40} />
              <span className="min-w-0 flex-1 truncate font-bold">{p.nickname}</span>
              <span className="font-display font-extrabold">{r.score}/5</span>
              <span className="w-12 text-right text-xs font-bold text-muted">{r.secs} s</span>
            </div>
          )
        })}
      </Card>
      <Button size="lg" fullWidth onClick={onBack}>
        Retour à Noël
      </Button>
    </div>
  )
}
