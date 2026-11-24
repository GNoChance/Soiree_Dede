import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import type { HotteRound } from '../hotteApi'

/** Retour après une réponse : ce qu'on a choisi, la bonne réponse. */
export interface RoundFeedback {
  chosen: string
  correct: string
  ok: boolean
}

interface RoundProps<T extends HotteRound> {
  round: T
  feedback: RoundFeedback | null
  onAnswer: (answer: string) => void
}

/** Gros boutons de réponse (2 × 2), verts / rouges après la réponse. */
function Options({ options, feedback, onAnswer, big }: { options: string[]; feedback: RoundFeedback | null; onAnswer: (a: string) => void; big?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {options.map((o) => {
        const isCorrect = feedback && o === feedback.correct
        const isWrong = feedback && !feedback.ok && o === feedback.chosen
        return (
          <motion.button
            key={o}
            type="button"
            disabled={Boolean(feedback)}
            onClick={() => onAnswer(o)}
            whileTap={{ scale: 0.95 }}
            animate={isWrong ? { x: [0, -8, 8, -6, 6, 0] } : isCorrect ? { scale: [1, 1.08, 1] } : {}}
            className={cn(
              'sticker flex min-h-20 items-center justify-center rounded-card bg-surface p-3 text-center font-display font-extrabold text-text',
              big ? 'text-5xl' : 'text-lg leading-tight',
              isCorrect && 'bg-mint',
              isWrong && 'bg-tomato text-white',
              feedback && !isCorrect && !isWrong && 'opacity-50',
            )}
          >
            {o}
          </motion.button>
        )
      })}
    </div>
  )
}

function Prompt({ children }: { children: React.ReactNode }) {
  return <p className="text-center font-display text-2xl leading-snug font-extrabold">{children}</p>
}

export function QuizRound({ round, feedback, onAnswer }: RoundProps<Extract<HotteRound, { type: 'quiz' }>>) {
  return (
    <div className="flex flex-col gap-5">
      <Prompt>{round.prompt}</Prompt>
      <Options options={round.options} feedback={feedback} onAnswer={onAnswer} />
    </div>
  )
}

export function ChansonRound({ round, feedback, onAnswer }: RoundProps<Extract<HotteRound, { type: 'chanson' }>>) {
  const [before, after] = round.line.split('___')
  return (
    <div className="flex flex-col gap-5">
      <p className="text-center text-sm font-bold text-muted">🎶 Complète la chanson</p>
      <Prompt>
        « {before}
        <span className="mx-1 inline-block min-w-16 rounded-chip border-b-4 border-dashed border-ink px-2 text-grape">{feedback ? feedback.correct : '…'}</span>
        {after} »
      </Prompt>
      <Options options={round.options} feedback={feedback} onAnswer={onAnswer} />
    </div>
  )
}

export function MemoireRound({ round, feedback, onAnswer }: RoundProps<Extract<HotteRound, { type: 'memoire' }>>) {
  const [showing, setShowing] = useState(true)
  useEffect(() => {
    const t = window.setTimeout(() => setShowing(false), 3000)
    return () => window.clearTimeout(t)
  }, [])
  return (
    <div className="flex flex-col gap-5">
      <Prompt>{showing ? '👀 Retiens bien ces 6 cadeaux…' : '🎁 Lequel a disparu ?'}</Prompt>
      <div className="sticker grid grid-cols-3 gap-2 rounded-card bg-surface p-4 text-center text-5xl">
        {(showing ? round.shown : round.remaining).map((e) => (
          <motion.span key={e} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 14 }}>
            {e}
          </motion.span>
        ))}
        {!showing && <span className="text-5xl opacity-30">❓</span>}
      </div>
      {!showing && <Options options={round.options} feedback={feedback} onAnswer={onAnswer} big />}
      {showing && <p className="text-center text-sm font-bold text-muted">Les cadeaux vont se mélanger dans 3 secondes !</p>}
    </div>
  )
}

export function IntrusRound({ round, feedback, onAnswer }: RoundProps<Extract<HotteRound, { type: 'intrus' }>>) {
  return (
    <div className="flex flex-col gap-5">
      <Prompt>🕵️ Trouve l’intrus : il n’a rien à voir avec Noël !</Prompt>
      <div className="grid grid-cols-3 gap-3">
        {round.grid.map((e) => {
          const isCorrect = feedback && e === feedback.correct
          const isWrong = feedback && !feedback.ok && e === feedback.chosen
          return (
            <motion.button
              key={e}
              type="button"
              disabled={Boolean(feedback)}
              onClick={() => onAnswer(e)}
              whileTap={{ scale: 0.9 }}
              className={cn(
                'sticker flex aspect-square items-center justify-center rounded-card bg-surface text-5xl',
                isCorrect && 'bg-mint',
                isWrong && 'bg-tomato',
                feedback && !isCorrect && !isWrong && 'opacity-40',
              )}
            >
              {e}
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}

export function ProcheRound({ round, feedback, onAnswer }: RoundProps<Extract<HotteRound, { type: 'proche' }>>) {
  const [value, setValue] = useState('')
  const valid = /^\d+([.,]\d+)?$/.test(value.trim())
  return (
    <div className="flex flex-col gap-5">
      <Prompt>{round.prompt}</Prompt>
      <p className="text-center text-sm font-bold text-muted">🎯 Vise juste : à 15 % près, c’est gagné</p>
      <div className="flex items-center gap-2">
        <input
          inputMode="decimal"
          aria-label="Ta réponse"
          value={feedback ? feedback.chosen : value}
          disabled={Boolean(feedback)}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && valid && onAnswer(value.trim())}
          className="sticker-sm min-w-0 flex-1 rounded-card border-[3px] border-ink bg-surface px-4 py-3 text-center font-display text-3xl font-extrabold text-text outline-none"
          placeholder="?"
        />
        <span className="shrink-0 font-display text-lg font-extrabold">{round.unit}</span>
      </div>
      {feedback ? (
        <p className={cn('text-center font-display text-xl font-extrabold', feedback.ok ? 'text-text' : 'text-tomato')}>
          {feedback.ok ? '✅ Bien visé !' : '❌ Raté'} · la réponse : {feedback.correct} {round.unit}
        </p>
      ) : (
        <Button size="lg" fullWidth disabled={!valid} onClick={() => onAnswer(value.trim())}>
          Valider
        </Button>
      )}
    </div>
  )
}

/** Manche selon son type. `key` = numéro de manche côté parent (remet l'état à zéro). */
export function HotteRoundView({ round, feedback, onAnswer }: RoundProps<HotteRound>) {
  switch (round.type) {
    case 'quiz':
      return <QuizRound round={round} feedback={feedback} onAnswer={onAnswer} />
    case 'chanson':
      return <ChansonRound round={round} feedback={feedback} onAnswer={onAnswer} />
    case 'memoire':
      return <MemoireRound round={round} feedback={feedback} onAnswer={onAnswer} />
    case 'intrus':
      return <IntrusRound round={round} feedback={feedback} onAnswer={onAnswer} />
    case 'proche':
      return <ProcheRound round={round} feedback={feedback} onAnswer={onAnswer} />
  }
}
