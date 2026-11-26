import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { victoryConfetti, burst } from '@/components/ui/confetti'
import { refreshProfile } from '@/lib/auth'
import { useHoldUpdate } from '@/store/updateHold'
import { toastError } from '@/features/soiree/errors'
import { PushReminderCard } from '@/features/push/PushReminderCard'
import { DailyBoardView } from './DailyBoard'
import { DailyPlay, type RoundAnswer } from './DailyPlay'
import { buildChallenge, type DailyRound } from './challenge'
import { finishDaily, saveDailyRound, startDaily, submitDaily, useDailyToday, type DailySubmitResult } from './api'
import { TOTAL_MAX, dailyTitle, endMessage } from './scoring'

type Phase = 'home' | 'loading' | 'play' | 'sending' | 'result'

/** Écran du Défi du jour : accueil, manches, résultat + classements. */
export function DailyPage() {
  const navigate = useNavigate()
  const [version, setVersion] = useState(0)
  const today = useDailyToday(version)
  const [phase, setPhase] = useState<Phase>('home')
  const [rounds, setRounds] = useState<DailyRound[]>([])
  const [done, setDone] = useState<RoundAnswer[]>([])
  const [result, setResult] = useState<DailySubmitResult | null>(null)
  // Pas de « Mettre à jour » en plein défi : le rechargement clôturerait la tentative.
  useHoldUpdate(phase === 'loading' || phase === 'play' || phase === 'sending')
  // Enregistrement des manches : une file, pour garder l'ordre ; les échecs sont sans gravité
  // (la fin de partie renvoie toutes les réponses, et une tentative coupée est cloturée par le serveur).
  const saveChain = useRef<Promise<unknown>>(Promise.resolve())
  const onRound = (idx: number, a: { points: number; ms: number }) => {
    saveChain.current = saveChain.current.then(() => saveDailyRound(idx, a)).catch(() => undefined)
  }

  const start = async () => {
    if (!today.data) return
    setPhase('loading')
    try {
      const r = await buildChallenge(today.data.day)
      await startDaily()
      setDone([])
      setRounds(r)
      setPhase('play')
    } catch (e) {
      toastError(e)
      setPhase('home')
      setVersion((v) => v + 1)
    }
  }

  // Appli rechargée ou coupée en cours de défi : on reprend à la manche suivante (même tirage,
  // même jour). Si les questions ne se chargent pas, on termine avec les manches déjà enregistrées.
  const resume = async () => {
    const t = today.data
    if (!t) return
    const prev = (t.answers ?? []).map((a) => ({ points: a.points, ms: a.ms }))
    if (prev.length < 6) {
      setPhase('loading')
      try {
        setRounds(await buildChallenge(t.day))
        setDone(prev)
        setPhase('play')
        return
      } catch {
        /* banques introuvables : on termine ci-dessous */
      }
    }
    setPhase('sending')
    try {
      const res = await finishDaily()
      setResult(res)
      setPhase('result')
      void refreshProfile().catch(() => undefined)
      setVersion((v) => v + 1)
    } catch (e) {
      toastError(e)
      setPhase('home')
      setVersion((v) => v + 1)
    }
  }

  const finish = async (answers: RoundAnswer[]) => {
    setPhase('sending')
    try {
      await saveChain.current
      const res = await submitDaily(answers)
      setResult(res)
      setPhase('result')
      void refreshProfile().catch(() => undefined)
      setVersion((v) => v + 1)
    } catch (e) {
      toastError(e)
      setPhase('home')
      setVersion((v) => v + 1)
    }
  }

  useEffect(() => {
    if (phase === 'result' && result && result.score > 0) {
      if (result.score / TOTAL_MAX >= 0.6) victoryConfetti()
      else burst()
    }
  }, [phase, result])

  const status = today.data?.status
  const title = today.data ? dailyTitle(today.data.day) : 'Défi du jour'

  if (phase === 'play') return <DailyPlay rounds={rounds} done={done} onFinish={(a) => void finish(a)} onRound={onRound} />

  return (
    <div className="flex flex-col gap-4 pb-8">
      <button type="button" onClick={() => navigate('/')} className="flex min-h-12 items-center gap-2 self-start font-extrabold">
        <ArrowLeft className="size-6" /> Retour
      </button>

      {phase === 'result' && result ? (
        <ResultCard result={result} />
      ) : (
        <Card className="flex flex-col items-center gap-3 text-center" accent="var(--color-sun)">
          <motion.span className="text-6xl" animate={{ rotate: [0, -8, 8, 0] }} transition={{ repeat: Infinity, duration: 3 }}>🗓️</motion.span>
          <h1 className="text-3xl text-[#1f1b2e]">{title}</h1>
          {(status === 'todo' || phase === 'loading' || phase === 'sending') && (
            <>
              <p className="font-bold text-[#1f1b2e]">6 manches : 4 questions, 1 estimation et 1 bonus ×2. Une seule tentative par jour, pour toute la bande !</p>
              <Button size="lg" fullWidth loading={phase === 'loading' || phase === 'sending'} onClick={() => void start()}>C’est parti !</Button>
            </>
          )}
          {status === 'done' && phase === 'home' && (
            <p className="text-xl font-extrabold text-[#1f1b2e]">
              Déjà fait : {today.data?.score} pts, {today.data?.rank === 1 ? '1er' : `${today.data?.rank}e`} sur {today.data?.players} ! Reviens demain.
            </p>
          )}
          {status === 'running' && phase === 'home' && (
            <>
              <p className="font-bold text-[#1f1b2e]">Ton défi a été interrompu. Les manches déjà jouées sont gardées : reprends là où tu en étais{today.data?.secs_left ? ` (encore ${Math.ceil(today.data.secs_left / 60)} min)` : ''} !</p>
              <Button size="lg" fullWidth onClick={() => void resume()}>Reprendre mon défi</Button>
            </>
          )}
          {status === 'missed' && phase === 'home' && (
            <p className="font-bold text-[#1f1b2e]">Tu as déjà commencé le défi d’aujourd’hui (une seule tentative). Reviens demain !</p>
          )}
          {today.data && today.data.streak > 0 && <p className="font-extrabold text-[#1f1b2e]">🔥 {today.data.streak} jour{today.data.streak > 1 ? 's' : ''} d’affilée</p>}
        </Card>
      )}

      <PushReminderCard promo />

      <h2 className="text-2xl">Classements</h2>
      <DailyBoardView version={version} />
    </div>
  )
}

function ResultCard({ result }: { result: DailySubmitResult }) {
  const msg = endMessage(result.score)
  return (
    <Card className="flex flex-col items-center gap-2 text-center" accent="var(--color-mint)">
      <motion.span className="text-7xl" initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 10 }}>{msg.emoji}</motion.span>
      <p className="text-5xl font-extrabold text-[#1f1b2e]"><AnimatedNumber value={result.score} /> <span className="text-xl">/ {TOTAL_MAX}</span></p>
      <p className="text-xl font-extrabold text-[#1f1b2e]">{result.expired ? 'Trop long : le temps est écoulé.' : msg.text}</p>
      {result.rank ? <p className="font-bold text-[#1f1b2e]">{result.rank === 1 ? '1er' : `${result.rank}e`} du jour sur {result.players}</p> : null}
      {result.xp > 0 && <p className="font-bold text-[#1f1b2e]">+{result.xp} XP</p>}
      {result.streak ? <p className="font-extrabold text-[#1f1b2e]">🔥 {result.streak} jour{result.streak > 1 ? 's' : ''} d’affilée</p> : null}
    </Card>
  )
}
