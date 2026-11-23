import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { burst } from '@/components/ui/confetti'
import { cn } from '@/lib/cn'
import { mood } from '@/features/soiree/players'
import { useViewport } from '@/features/tv/tv'
import type { QuiDeNousState } from '@/types/db'
import { qdnSequence } from './revealOrder'
import { TvAnswered, TvNextIn, TvScores, TvTimer, vh, type TvGet } from './TvParts'

/**
 * Vue télé de « Qui de nous ? » (rendue par Play sous TvContext) : lecture seule.
 * Vote : seuls `s.question` et `s.voters` (qui a voté, jamais pour qui) sont lus.
 * Les votes ne sont lus que dans `s.last_reveal` (public seulement au dépouillement).
 */
type QdnS = QuiDeNousState & { deadline?: string | null }

export function QuiDeNousTv({ s, get }: { s: QdnS; get: TvGet }) {
  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ gap: vh(1.6), padding: vh(2) }}>
      {s.phase === 'voting' && <TvVoting s={s} get={get} />}
      {s.phase === 'reveal' && s.last_reveal && <TvReveal key={s.last_reveal.round} s={s} get={get} />}
    </div>
  )
}

/** Taille de police (en vh) de la question selon sa longueur. */
const qFont = (q: string, big: number) => (q.length > 110 ? big * 0.66 : q.length > 70 ? big * 0.8 : big)

function QuestionCard({ round, total, question, big }: { round: number; total: number; question: string; big: number }) {
  return (
    <motion.div
      key={round}
      initial={{ y: -80, scale: 0.8, opacity: 0 }}
      animate={{ y: 0, scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 220, damping: 15 }}
      className="sticker flex shrink-0 flex-col items-center justify-center bg-sun text-center text-[#1f1b2e]"
      style={{ padding: `${vh(1.5)} ${vh(3)}`, gap: vh(0.5) }}
    >
      <span className="rounded-full border-[0.4vh] border-ink bg-surface px-[1.6vh] font-display font-extrabold" style={{ fontSize: vh(2.6) }}>
        Question {round}/{total}
      </span>
      <p lang="fr" className="font-display leading-tight font-extrabold" style={{ fontSize: vh(qFont(question, big)) }}>
        {question}
      </p>
    </motion.div>
  )
}

function TvVoting({ s, get }: { s: QdnS; get: TvGet }) {
  const all = s.voters.length >= s.players.length
  return (
    <>
      <TvTimer deadline={s.deadline} label="Révélation dans" />
      <QuestionCard round={s.round} total={s.total_rounds} question={s.question} big={7.5} />
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center" style={{ gap: vh(2) }}>
        <p className="text-center font-display font-extrabold" style={{ fontSize: vh(3.6) }}>
          {all ? 'Tout le monde a voté !' : 'Désignez quelqu’un sur votre téléphone…'}
        </p>
        <TvAnswered ids={s.players} done={s.voters} get={get} size={16} />
      </div>
      <div className="shrink-0">
        <TvScores id="tvqdn-scores" players={s.players} scores={s.scores} get={get} />
      </div>
    </>
  )
}

function TvReveal({ s, get }: { s: QdnS; get: TvGet }) {
  const lr = s.last_reveal!
  const reduce = useReducedMotion()
  const { h } = useViewport()
  const [sequence] = useState(() => qdnSequence(lr))
  const [step, setStep] = useState(reduce ? sequence.length : 0)
  const done = step >= sequence.length

  useEffect(() => {
    if (done) return
    const delay = step === 0 ? 900 : Math.max(380, 900 - step * 70)
    const t = window.setTimeout(() => setStep((n) => n + 1), delay)
    return () => clearTimeout(t)
  }, [step, done])

  const celebrated = useRef(false)
  useEffect(() => {
    if (!done || celebrated.current) return
    celebrated.current = true
    if (lr.majority.length) burst({ x: 0.5, y: 0.35 }, 140)
  }, [done, lr])

  const counts: Record<string, number> = {}
  for (const v of sequence.slice(0, step)) counts[v.target] = (counts[v.target] ?? 0) + 1
  const max = Math.max(1, ...Object.values(lr.counts))
  const current = !done && step > 0 ? sequence[step - 1] : null
  const last = s.round >= s.total_rounds
  const n = s.players.length
  const av = Math.round((h * (n > 6 ? 11 : 14)) / 100)
  const gains: Record<string, number> = {}
  for (const id of lr.scorers) gains[id] = 1

  return (
    <>
      <QuestionCard round={s.round} total={s.total_rounds} question={lr.question} big={5} />

      {/* Le vote en cours de dépouillement */}
      <div className="flex shrink-0 items-center justify-center" style={{ height: vh(11) }}>
        <AnimatePresence mode="popLayout">
          {current ? (
            <motion.div
              key={step}
              initial={{ y: -40, scale: 0.4, opacity: 0 }}
              animate={{ y: 0, scale: 1, opacity: 1 }}
              exit={{ y: 50, scale: 0.6, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 18 }}
              className="sticker-sm flex items-center bg-surface"
              style={{ gap: vh(1.5), padding: `${vh(0.6)} ${vh(2)}` }}
            >
              <Avatar slug={get(current.voter).slug} tenue={get(current.voter).equippedTenue} size={Math.round(h * 0.08)} />
              <span className="font-display font-extrabold" style={{ fontSize: vh(4) }}>{get(current.voter).nickname}</span>
              <ArrowRight style={{ width: vh(5), height: vh(5) }} strokeWidth={3} />
              <Avatar slug={get(current.target).slug} tenue={get(current.target).equippedTenue} expression={mood(get(current.target), 'shocked')} size={Math.round(h * 0.08)} />
              <span className="font-display font-extrabold" style={{ fontSize: vh(4) }}>{get(current.target).nickname}</span>
            </motion.div>
          ) : !done ? (
            <motion.p key="wait" animate={{ opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 1 }} className="font-display font-extrabold" style={{ fontSize: vh(4.5) }}>
              Dépouillement…
            </motion.p>
          ) : (
            <motion.div
              key="verdict"
              initial={{ scale: 0, rotate: -8 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 12 }}
              className="sticker flex items-center bg-bubblegum text-[#1f1b2e]"
              style={{ gap: vh(2), padding: `${vh(0.8)} ${vh(3)}` }}
            >
              {lr.majority.length ? (
                <>
                  <span style={{ fontSize: vh(6) }}>👑</span>
                  <span className="font-display font-extrabold" style={{ fontSize: vh(4.4) }}>
                    {lr.majority.length > 1 ? 'Égalité ! ' : 'Le plus désigné : '}
                    {lr.majority.map((id) => get(id).nickname).join(' & ')} ({lr.counts[lr.majority[0]]} vote{lr.counts[lr.majority[0]] > 1 ? 's' : ''})
                  </span>
                </>
              ) : (
                <span className="font-display font-extrabold" style={{ fontSize: vh(4.4) }}>
                  {Object.keys(lr.votes).length ? 'Pas de majorité ! ⚖️' : 'Personne n’a voté ! 🦗'}
                </span>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Une colonne par joueur : la barre monte à chaque vote reçu */}
      <div className="flex min-h-0 flex-1 items-end justify-center" style={{ gap: vh(2) }}>
        {s.players.map((id) => {
          const p = get(id)
          const c = done ? (lr.counts[id] ?? 0) : (counts[id] ?? 0)
          const isMaj = done && lr.majority.includes(id)
          const hit = current?.target === id
          return (
            <motion.div
              key={id}
              animate={isMaj && !reduce ? { y: [0, -10, 0] } : { y: 0 }}
              transition={isMaj ? { repeat: Infinity, duration: 1.1 } : undefined}
              className="flex h-full min-w-0 flex-1 flex-col items-center justify-end"
              style={{ maxWidth: vh(24), gap: vh(0.8) }}
            >
              <motion.span key={c} initial={{ scale: 2.2 }} animate={{ scale: 1 }} className="font-display font-extrabold" style={{ fontSize: vh(7) }}>
                {c}
              </motion.span>
              <div className="relative flex w-3/5 flex-1 items-end overflow-hidden rounded-t-chip border-[0.5vh] border-b-0 border-ink bg-sunk">
                <motion.div
                  className={cn('w-full', isMaj ? 'bg-tomato' : 'bg-sky')}
                  animate={{ height: `${(c / max) * 100}%` }}
                  transition={{ type: 'spring', stiffness: 200, damping: 18 }}
                />
              </div>
              <motion.div animate={{ scale: hit || isMaj ? 1.15 : 1 }} transition={{ type: 'spring', stiffness: 400, damping: 12 }}>
                <Avatar slug={p.slug} tenue={p.equippedTenue} expression={isMaj || hit ? mood(p, 'shocked') : p.equipped} size={av} badge={isMaj ? '👑' : undefined} />
              </motion.div>
              <span className="max-w-full truncate font-display font-extrabold" style={{ fontSize: vh(3) }}>{p.nickname}</span>
            </motion.div>
          )
        })}
      </div>

      <div className="shrink-0">
        <TvScores id="tvqdn-scores" players={s.players} scores={s.scores} get={get} gains={done ? gains : undefined} />
      </div>
      {done && <TvNextIn deadline={s.deadline} label={last ? 'Résultats dans' : 'Question suivante dans'} />}
    </>
  )
}
