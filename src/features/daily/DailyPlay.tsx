import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/lib/cn'
import { fx } from '@/lib/feedback'
import type { DailyRound } from './challenge'
import { EST_TIME_MS, QCM_TIME_MS, estimatePoints, qcmPoints } from './scoring'

export interface RoundAnswer { points: number; ms: number }

const CHOICE_COLORS = ['var(--color-sky)', 'var(--color-bubblegum)', 'var(--color-lime)', 'var(--color-sun)']

interface RoundProps {
  round: DailyRound
  index: number
  total: number
  onDone: (a: RoundAnswer) => void
}

function RoundView({ round, index, total, onDone }: RoundProps) {
  const limit = round.kind === 'qcm' ? QCM_TIME_MS : EST_TIME_MS
  const [t0] = useState(() => Date.now())
  const [now, setNow] = useState(t0)
  const [picked, setPicked] = useState<number | null>(null)
  const [text, setText] = useState('')
  const [result, setResult] = useState<RoundAnswer | null>(null)
  const settled = useRef(false)
  const doneRef = useRef(false)
  const next = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onDoneRef = useRef(onDone)
  useEffect(() => {
    onDoneRef.current = onDone
  })

  const advance = (a: RoundAnswer) => {
    if (doneRef.current) return
    doneRef.current = true
    onDoneRef.current(a)
  }
  const settle = (points: number, ms: number) => {
    if (settled.current) return
    settled.current = true
    const a = { points, ms }
    setResult(a)
    if (points > 0) fx.success()
    else fx.fail()
    next.current = setTimeout(() => advance(a), 2200)
  }
  const settleRef = useRef(settle)
  useEffect(() => {
    settleRef.current = settle
  })

  useEffect(() => {
    const iv = setInterval(() => {
      const t = Date.now()
      setNow(t)
      if (!settled.current && t - t0 >= limit) settleRef.current(0, limit)
    }, 100)
    return () => {
      clearInterval(iv)
      if (next.current) clearTimeout(next.current)
    }
  }, [t0, limit])

  const elapsed = Math.min(now - t0, limit)
  const left = Math.max(0, 1 - elapsed / limit)

  const pickChoice = (i: number) => {
    if (settled.current || round.kind !== 'qcm') return
    setPicked(i)
    const ms = Date.now() - t0
    settle(qcmPoints(i === round.correct, ms, round.bonus), ms)
  }
  const submitEstimate = () => {
    if (settled.current || round.kind !== 'estimate') return
    const v = parseFloat(text.replace(/\s/g, '').replace(',', '.'))
    if (!Number.isFinite(v)) return
    settle(estimatePoints(v, round.answer), Date.now() - t0)
  }

  return (
    <motion.div
      initial={{ x: 60, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: -60, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 24 }}
      className="flex flex-col gap-4"
    >
      <div className="flex items-center gap-2">
        <Badge tone="grape">Manche {index + 1}/{total}</Badge>
        {round.bonus && <Badge tone="tomato">⭐ Bonus ×2</Badge>}
        {round.kind === 'estimate' && <Badge tone="sky">🎯 Le plus proche</Badge>}
        <span className="ml-auto text-lg font-extrabold tabular-nums">{Math.ceil((left * limit) / 1000)} s</span>
      </div>
      <div className="h-4 overflow-hidden rounded-full border-[3px] border-ink bg-sunk">
        <div className={cn('h-full', left < 0.25 ? 'bg-tomato' : 'bg-mint')} style={{ width: `${left * 100}%` }} />
      </div>

      <div className="sticker bg-surface p-5 text-center">
        <p className="text-2xl font-extrabold leading-snug">{round.prompt}</p>
      </div>

      {round.kind === 'qcm' ? (
        <div className="flex flex-col gap-3">
          {round.choices.map((c, i) => {
            const isRight = result && i === round.correct
            const isWrong = result && picked === i && i !== round.correct
            return (
              <motion.button
                key={i}
                type="button"
                disabled={!!result}
                whileTap={{ scale: 0.97, x: 3, y: 3 }}
                animate={isWrong ? { x: [0, -8, 8, -6, 6, 0] } : isRight ? { scale: [1, 1.05, 1] } : {}}
                onClick={() => pickChoice(i)}
                className="sticker min-h-16 px-4 py-3 text-xl font-extrabold text-[#1f1b2e]"
                style={{ backgroundColor: isRight ? 'var(--color-mint)' : isWrong ? 'var(--color-tomato)' : CHOICE_COLORS[i % 4], opacity: result && !isRight && !isWrong ? 0.5 : 1 }}
              >
                {c}
              </motion.button>
            )
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <input
              inputMode="decimal"
              value={text}
              disabled={!!result}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitEstimate()}
              placeholder="Ton estimation"
              className="sticker min-h-16 w-full bg-surface px-4 text-center text-3xl font-extrabold text-text"
            />
            {round.unit && <span className="text-lg font-extrabold">{round.unit}</span>}
          </div>
          {!result && <Button size="lg" fullWidth onClick={submitEstimate} disabled={!text.trim()}>Valider</Button>}
        </div>
      )}

      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className={cn('sticker p-4 text-center text-[#1f1b2e]', result.points > 0 ? 'bg-mint' : 'bg-bubblegum')}
          >
            <p className="text-2xl font-extrabold">
              {result.points > 0 ? `+${result.points} pts` : picked === null && round.kind === 'qcm' ? 'Trop lent !' : 'Raté !'}
            </p>
            {round.kind === 'estimate' && (
              <p className="font-bold">
                Réponse : {round.answer.toLocaleString('fr-FR')} {round.unit}
                {round.note ? ` — ${round.note}` : ''}
              </p>
            )}
            {round.kind === 'qcm' && result.points === 0 && <p className="font-bold">C’était : {round.choices[round.correct]}</p>}
            <Button size="sm" variant="secondary" className="mt-3" onClick={() => advance(result)}>Suivant</Button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

/** Écran de jeu : enchaîne les manches, renvoie les réponses à la fin. */
export function DailyPlay({ rounds, onFinish }: { rounds: DailyRound[]; onFinish: (answers: RoundAnswer[]) => void }) {
  const [idx, setIdx] = useState(0)
  const answers = useRef<RoundAnswer[]>([])
  const [total, setTotal] = useState(0)
  return (
    <div className="flex flex-col gap-3 pb-6">
      <p className="text-center text-sm font-bold text-muted">Score : {total}</p>
      <AnimatePresence mode="wait">
        <RoundView
          key={idx}
          round={rounds[idx]}
          index={idx}
          total={rounds.length}
          onDone={(a) => {
            answers.current = [...answers.current, a]
            setTotal((t) => t + a.points)
            if (idx + 1 >= rounds.length) onFinish(answers.current)
            else setIdx(idx + 1)
          }}
        />
      </AnimatePresence>
    </div>
  )
}
