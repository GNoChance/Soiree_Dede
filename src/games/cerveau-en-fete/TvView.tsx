import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { burst } from '@/components/ui/confetti'
import { cn } from '@/lib/cn'
import { mood, playerOrPlaceholder } from '@/features/soiree/players'
import { useCountdown } from '@/features/soiree/useServerClock'
import { TvChip, TvDots, TvLayout, TvScores, TvTimer, type TvDot } from '@/features/tv/QuizTv'
import type { GamePlayProps } from '../types'
import type { CefPublicQuestion, CefReveal, CefState } from './types'
import { formatMs, rankLabel, themeInfo } from './setup'

const CHOICE_COLORS = ['bg-sky', 'bg-bubblegum', 'bg-sun', 'bg-lime'] as const
const LETTERS = ['A', 'B', 'C', 'D'] as const

/** Taille du texte selon la longueur (énoncés longs = un peu moins gros, mais toujours énormes). */
const promptSize = (t: string) => (t.length < 45 ? 'text-[6.4vmin]' : t.length < 90 ? 'text-[5vmin]' : t.length < 150 ? 'text-[4vmin]' : 'text-[3.2vmin]')

function Image({ image, tall }: { image: NonNullable<CefPublicQuestion['image']>; tall?: boolean }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    <img
      src={image.url}
      alt=""
      onError={() => setFailed(true)}
      className={cn('w-auto max-w-full rounded-chip border-4 border-ink bg-white object-contain', tall ? 'max-h-[34vh]' : 'max-h-[22vh]')}
    />
  )
}

/**
 * Vue télé de Cerveau en fête (rendue par Play sous TvContext) : lecture seule, state public uniquement.
 * Les ticks (fin de chrono / de révélation) sont envoyés par Play.
 */
export default function CerveauTv({ state, players }: Pick<GamePlayProps, 'state' | 'players'>) {
  const s = state as unknown as CefState
  const get = (id: string) => playerOrPlaceholder(players, id)
  const reveal = s.phase === 'reveal' && s.last_reveal ? s.last_reveal : null
  // Les points de la manche n'entrent dans le classement qu'une fois les gagnants annoncés.
  const [landed, setLanded] = useState(0)
  useEffect(() => {
    if (!reveal) return
    const id = window.setTimeout(() => setLanded(s.round), 1800)
    return () => clearTimeout(id)
  }, [reveal, s.round])
  const pts = reveal ? reveal.points : {}
  const showing = !reveal || landed === s.round
  const scoreOf = (id: string) => (s.scores[id] ?? 0) - (showing ? 0 : (pts[id] ?? 0))

  return (
    <TvLayout
      main={reveal ? <RevealTv key={`r${s.round}`} s={s} lr={reveal} get={get} /> : <QuestionTv key={`q${s.round}`} s={s} get={get} />}
      side={<TvScores ids={s.players} scores={scoreOf} deltas={reveal && showing ? pts : undefined} get={get} />}
    />
  )
}

function QuestionTv({ s, get }: { s: CefState; get: (id: string) => ReturnType<typeof playerOrPlaceholder> }) {
  const q = s.question
  const t = themeInfo(q.theme)
  const dots: TvDot[] = s.players.map((id) => {
    const f = s.found.find((x) => x.profile_id === id)
    const passed = s.passed.includes(id)
    const missed = s.missed.includes(id)
    const p = get(id)
    return {
      id,
      lit: !!f,
      out: passed || missed,
      badge: passed ? '🏳️' : missed ? '✗' : undefined,
      tag: f ? (f.rank === 1 ? '⚡ 1er' : `✓ ${rankLabel(f.rank)}`) : undefined,
      expression: f ? mood(p, f.rank === 1 ? 'proud' : 'happy') : passed ? mood(p, 'sleepy') : missed ? mood(p, 'sad') : mood(p, 'think'),
    }
  })
  return (
    <>
      <TvTimer deadline={s.deadline} totalMs={s.duration * 1000} />
      <motion.div
        key={s.round}
        initial={{ scale: 0.85, opacity: 0, rotate: -1.5 }}
        animate={{ scale: 1, opacity: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 16 }}
        className="sticker flex min-h-0 flex-1 flex-col items-center justify-center gap-[1.5vmin] p-[2vmin] text-center text-[#1f1b2e]"
        style={{ backgroundColor: t.color }}
      >
        <div className="flex flex-wrap items-center justify-center gap-[1.2vmin]">
          <TvChip>{t.emoji} {t.label}</TvChip>
          <TvChip>{s.round}/{s.total_rounds}</TvChip>
          {q.difficulty && <TvChip>{'⭐'.repeat(q.difficulty)}</TvChip>}
          <TvChip className={q.mode === 'typed' ? 'bg-grape text-white' : 'bg-sky'}>{q.mode === 'typed' ? '⌨️ On tape sa réponse' : '🔘 QCM · 1 seul essai'}</TvChip>
        </div>
        {q.image && <Image image={q.image} tall={!q.choices} />}
        <p className={cn('font-display leading-tight font-extrabold break-words', promptSize(q.prompt))}>{q.prompt}</p>
        {q.mode === 'mcq' && q.choices && (
          <div className="mt-[1vmin] grid w-full grid-cols-2 gap-[1.5vmin]">
            {q.choices.map((c, i) => (
              <motion.div
                key={i}
                initial={{ scale: 0, rotate: i % 2 ? 6 : -6 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 380, damping: 14, delay: 0.3 + i * 0.1 }}
                className={cn('sticker flex items-center gap-[1.2vmin] p-[1.4vmin] text-left', CHOICE_COLORS[i % 4])}
              >
                <span className="flex size-[6vmin] shrink-0 items-center justify-center rounded-full border-[3px] border-ink bg-white font-display text-[3.4vmin] font-extrabold">{LETTERS[i]}</span>
                <span className="font-display text-[3.6vmin] leading-tight font-extrabold break-words">{c}</span>
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>
      <div className="sticker flex flex-col gap-[1vmin] bg-surface p-[1.5vmin]">
        <p className="text-center font-display text-[3vmin] font-extrabold">
          <motion.span key={s.found.length} initial={{ scale: 1.8, color: '#06D6A0' }} animate={{ scale: 1, color: 'var(--text)' }} className="inline-block">
            {s.found.length}
          </motion.span>
          /{s.players.length} ont trouvé
        </p>
        <TvDots dots={dots} get={get} />
      </div>
    </>
  )
}

function RevealTv({ s, lr, get }: { s: CefState; lr: CefReveal; get: (id: string) => ReturnType<typeof playerOrPlaceholder> }) {
  const left = useCountdown(s.deadline, 250)
  const last = s.round >= s.total_rounds
  const t = themeInfo(lr.question.theme)
  const nobody = lr.found.length === 0
  const celebrated = useRef(false)
  useEffect(() => {
    if (celebrated.current) return
    celebrated.current = true
    if (!nobody) burst({ x: 0.4, y: 0.3 }, 110)
  }, [nobody])
  const notFound = s.players.filter((id) => !lr.found.some((f) => f.profile_id === id))
  const sorted = [...lr.found].sort((a, b) => a.rank - b.rank)

  return (
    <>
      <motion.div
        initial={{ scale: 0.3, rotate: -12, opacity: 0 }}
        animate={{ scale: 1, rotate: -1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 12 }}
        className="sticker flex flex-col items-center gap-[0.8vmin] p-[2vmin] text-center text-[#1f1b2e]"
        style={{ backgroundColor: '#FFB703' }}
      >
        <p className="font-display text-[2.8vmin] leading-tight font-extrabold opacity-80">
          {t.emoji} {lr.question.prompt}
        </p>
        <p className="text-[2.6vmin] font-bold opacity-75">La réponse :</p>
        <motion.p
          initial={{ scale: 3.2, opacity: 0, rotate: 10 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          transition={{ delay: 0.35, type: 'spring', stiffness: 300, damping: 12 }}
          className={cn('font-display leading-tight font-extrabold break-words', lr.answer.length < 20 ? 'text-[8.5vmin]' : lr.answer.length < 40 ? 'text-[6vmin]' : 'text-[4.4vmin]')}
        >
          {lr.answer}
        </motion.p>
      </motion.div>

      {lr.mode === 'mcq' && lr.choices && (
        <div className="grid grid-cols-2 gap-[1.2vmin]">
          {lr.choices.map((c, i) => {
            const ok = i === lr.correct
            const who = Object.entries(lr.picks).filter(([, v]) => v === i).map(([k]) => k)
            return (
              <motion.div
                key={i}
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: ok ? 1.03 : 0.97, opacity: ok ? 1 : 0.5 }}
                transition={{ delay: 0.6 + i * 0.08, type: 'spring', stiffness: 300, damping: 14 }}
                className={cn('sticker flex items-center gap-[1vmin] p-[1.2vmin] text-[#1f1b2e]', ok ? 'bg-mint' : 'bg-sunk text-text')}
              >
                <span className="min-w-0 flex-1 font-display text-[3vmin] leading-tight font-extrabold break-words">
                  {ok ? '✓ ' : ''}
                  {c}
                </span>
                <div className="flex -space-x-2">
                  {who.map((id) => (
                    <Avatar key={id} slug={get(id).slug} size={44} expression={ok ? mood(get(id), 'happy') : mood(get(id), 'sad')} />
                  ))}
                </div>
              </motion.div>
            )
          })}
        </div>
      )}

      <div className="sticker flex min-h-0 flex-1 flex-col justify-center gap-[0.8vmin] bg-surface p-[1.5vmin]">
        <p className="font-display text-[3vmin] font-extrabold">{nobody ? 'Personne n’a trouvé ! 🦗' : `${lr.found.length} ${lr.found.length > 1 ? 'ont' : 'a'} trouvé`}</p>
        <div className="flex flex-wrap gap-x-[2vmin] gap-y-[0.8vmin]">
          {sorted.map((f, i) => {
            const p = get(f.profile_id)
            return (
              <motion.div
                key={f.profile_id}
                initial={{ x: -60, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ delay: 0.8 + i * 0.15, type: 'spring', stiffness: 300, damping: 18 }}
                className="flex items-center gap-[1vmin] rounded-full border-[3px] border-ink bg-sunk py-[0.4vmin] pr-[1.6vmin] pl-[0.4vmin]"
              >
                <span className="font-display text-[2.8vmin] font-extrabold">{f.rank === 1 ? '⚡' : rankLabel(f.rank)}</span>
                <Avatar slug={p.slug} size={52} expression={mood(p, f.rank === 1 ? 'proud' : 'happy')} />
                <span className="font-display text-[2.8vmin] font-extrabold">{p.nickname}</span>
                <span className="text-[2.2vmin] font-bold text-muted">{formatMs(f.ms)}</span>
                <span className="font-display text-[2.8vmin] font-extrabold text-mint">+{f.points}</span>
              </motion.div>
            )
          })}
        </div>
        {notFound.length > 0 && (
          <div className="flex flex-wrap items-center gap-[1vmin] border-t-2 border-dashed border-ink/20 pt-[0.8vmin]">
            {notFound.map((id) => {
              const p = get(id)
              return (
                <span key={id} className="flex items-center gap-1 rounded-full bg-sunk py-0.5 pr-2 pl-0.5 text-[2.2vmin] font-bold">
                  <Avatar slug={p.slug} expression={mood(p, 'sad')} size={32} />
                  {p.nickname} {lr.passed.includes(id) ? '🏳️' : lr.missed.includes(id) ? '✗' : '⌛'}
                </span>
              )
            })}
          </div>
        )}
      </div>
      <p className="text-center font-display text-[2.6vmin] font-extrabold text-muted">
        {last ? 'Résultats' : 'Question suivante'} dans {Math.max(0, Math.ceil(left / 1000))} s
      </p>
    </>
  )
}
