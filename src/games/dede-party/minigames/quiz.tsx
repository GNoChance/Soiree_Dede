import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/cn'
import { fx } from '@/lib/feedback'
import { DoneStrip } from '../Parts'
import type { QuizData } from '../types'
import { startedAt, useServerNow, type MgPlayProps, type MgTvProps } from './common'

const COLORS = ['bg-sky', 'bg-bubblegum', 'bg-lime', 'bg-sun']
const LETTERS = ['A', 'B', 'C', 'D']

/** Question en cours (0..2), calée sur l'horloge serveur : tout le monde voit la même en même temps. */
function useQuestion(mg: MgPlayProps['mg']) {
  const data = mg.data as unknown as QuizData
  const now = useServerNow(100)
  const elapsed = now - startedAt(mg)
  const per = data.per_q || 8000
  const qi = Math.min(2, Math.max(0, Math.floor(elapsed / per)))
  const left = Math.max(0, per * (qi + 1) - elapsed)
  return { data, elapsed, per, qi, left, over: elapsed >= per * 3 }
}

function TimeBar({ left, per }: { left: number; per: number }) {
  return (
    <div className="sticker-sm h-4 overflow-hidden bg-sunk">
      <div className={cn('h-full transition-[width] duration-100 ease-linear', left < 2500 ? 'bg-tomato' : 'bg-mint')} style={{ width: `${(100 * left) / per}%` }} />
    </div>
  )
}

/** Questions pour un Dédé : 3 QCM éclair de 8 s. */
export function QuizPlay({ mg, submit, submitted }: MgPlayProps) {
  const { data, elapsed, per, qi, left, over } = useQuestion(mg)
  const [answers, setAnswers] = useState<Array<number | null>>([null, null, null])
  const [ms, setMs] = useState<number[]>([8000, 8000, 8000])
  const sent = useRef(false)

  const send = (a: Array<number | null>, m: number[]) => {
    if (sent.current || submitted) return
    sent.current = true
    void submit({ answers: a, ms: m })
  }
  useEffect(() => {
    if (over) send(answers, ms)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [over])

  const choose = (i: number) => {
    if (answers[qi] !== null || submitted) return
    fx.pop()
    const a = answers.map((x, k) => (k === qi ? i : x))
    const m = ms.map((x, k) => (k === qi ? Math.max(0, Math.min(per, Math.round(elapsed - qi * per))) : x))
    setAnswers(a)
    setMs(m)
    if (qi === 2) send(a, m)
  }

  const q = data.questions[qi]
  if (!q) return null
  const mine = answers[qi]
  if (submitted && mine === null) {
    return <p className="sticker bg-mint p-3 text-center font-display text-xl font-extrabold text-[#1f1b2e]">✔ Tes 3 réponses sont envoyées !</p>
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between font-display text-lg font-extrabold">
        <span>Question {qi + 1} / 3</span>
        <span className="tabular-nums">{Math.ceil(left / 1000)} s</span>
      </div>
      <TimeBar left={left} per={per} />
      <motion.p key={qi} initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="sticker bg-surface p-3 text-center font-display text-xl leading-snug font-extrabold">
        {q.prompt}
      </motion.p>
      <div className="grid grid-cols-1 gap-2">
        {q.choices.map((c, i) => (
          <motion.button
            key={`${qi}-${i}`}
            type="button"
            whileTap={{ x: 3, y: 3 }}
            disabled={mine !== null || submitted}
            onClick={() => choose(i)}
            className={cn(
              'flex min-h-14 items-center gap-3 rounded-card border-[3px] border-ink px-3 py-2 text-left font-display text-lg font-extrabold text-[#1f1b2e] shadow-sticker',
              COLORS[i],
              mine !== null && mine !== i && 'opacity-35',
              mine === i && 'ring-4 ring-ink',
            )}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-white">{LETTERS[i]}</span>
            <span className="min-w-0 flex-1 leading-tight">{c}</span>
            {mine === i && <span>✔</span>}
          </motion.button>
        ))}
      </div>
      {mine !== null && qi < 2 && <p className="text-center font-display font-extrabold text-muted">Réponse notée ! Question suivante dans {Math.ceil(left / 1000)} s…</p>}
    </div>
  )
}

/** Télé : la question en cours en grand, les 4 choix, le temps. */
export function QuizTv({ s, mg, get }: MgTvProps) {
  const { data, qi, left, per } = useQuestion(mg)
  const q = data.questions[qi]
  if (!q) return null
  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex items-center justify-between font-display text-3xl font-extrabold">
        <span>Question {qi + 1} / 3</span>
        <span className="tabular-nums">{Math.ceil(left / 1000)} s</span>
      </div>
      <TimeBar left={left} per={per} />
      <p className="sticker bg-surface p-4 text-center font-display text-4xl leading-tight font-extrabold">{q.prompt}</p>
      <div className="grid grid-cols-2 gap-3">
        {q.choices.map((c, i) => (
          <div key={i} className={cn('flex items-center gap-3 rounded-card border-[3px] border-ink px-4 py-3 font-display text-3xl font-extrabold text-[#1f1b2e] shadow-sticker', COLORS[i])}>
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-white">{LETTERS[i]}</span>
            <span className="leading-tight">{c}</span>
          </div>
        ))}
      </div>
      <DoneStrip ids={s.players} done={mg.submitted} get={get} size={52} />
    </div>
  )
}
