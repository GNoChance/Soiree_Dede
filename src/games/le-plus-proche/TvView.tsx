import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/cn'
import { mood, playerOrPlaceholder } from '@/features/soiree/players'
import { useCountdown } from '@/features/soiree/useServerClock'
import { TvChip, TvDots, TvLayout, TvScores, TvTimer, type TvDot } from '@/features/tv/QuizTv'
import { useViewport } from '@/features/tv/tv'
import type { GamePlayProps, PlayerInfo } from '../types'
import type { LppReveal, LppState } from './types'
import { Ruler, timeline } from './Ruler'
import { describeMiss, rankLabel, themeInfo, withUnit } from './setup'

type Get = (id: string) => PlayerInfo

const MEDALS = ['🥇', '🥈', '🥉']

const promptSize = (t: string) => (t.length < 50 ? 'text-[6.6vmin]' : t.length < 100 ? 'text-[5.2vmin]' : t.length < 160 ? 'text-[4.2vmin]' : 'text-[3.4vmin]')

/**
 * Vue télé du Plus proche (rendue par Play sous TvContext) : lecture seule, state public uniquement.
 * La règle graduée de la révélation est le composant `Ruler` du téléphone, agrandi. Les ticks partent de Play.
 */
export default function LppTv({ state, players }: Pick<GamePlayProps, 'state' | 'players'>) {
  const s = state as unknown as LppState
  const get: Get = (id) => playerOrPlaceholder(players, id)
  const reduce = useReducedMotion()
  const lr = s.phase === 'reveal' && s.last_reveal ? s.last_reveal : null
  // Les points n'entrent au classement qu'une fois l'animation de la règle terminée.
  const [landed, setLanded] = useState(0)
  useEffect(() => {
    if (!lr) return
    const t = timeline(lr.ranking.length, !!reduce)
    const id = window.setTimeout(() => setLanded(s.round), (t.after + 0.9) * 1000)
    return () => clearTimeout(id)
  }, [lr, s.round, reduce])
  const pts = lr ? lr.points : {}
  const showing = !lr || landed === s.round
  const scoreOf = (id: string) => (s.scores[id] ?? 0) - (showing ? 0 : (pts[id] ?? 0))

  return (
    <TvLayout
      main={lr ? <RevealTv key={`r${s.round}`} s={s} lr={lr} get={get} /> : <QuestionTv key={`q${s.round}`} s={s} get={get} />}
      side={<TvScores ids={s.players} scores={scoreOf} deltas={lr && showing ? pts : undefined} get={get} />}
    />
  )
}

function QuestionTv({ s, get }: { s: LppState; get: Get }) {
  const q = s.question
  const t = themeInfo(q.theme)
  const dots: TvDot[] = s.players.map((id) => {
    const done = s.answered.includes(id)
    const p = get(id)
    return { id, lit: done, badge: done ? '✓' : undefined, expression: done ? mood(p, 'sly') : mood(p, 'think') }
  })
  return (
    <>
      <TvTimer deadline={s.deadline} totalMs={s.duration * 1000} />
      <motion.div
        key={s.round}
        initial={{ scale: 0.85, opacity: 0, rotate: -1.5 }}
        animate={{ scale: 1, opacity: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 16 }}
        className="sticker flex min-h-0 flex-1 flex-col items-center justify-center gap-[2vmin] p-[2vmin] text-center text-[#1f1b2e]"
        style={{ backgroundColor: t.color }}
      >
        <div className="flex flex-wrap items-center justify-center gap-[1.2vmin]">
          <TvChip>{t.emoji} {t.label}</TvChip>
          <TvChip>{s.round}/{s.total_rounds}</TvChip>
          {q.difficulty && <TvChip>{'⭐'.repeat(q.difficulty)}</TvChip>}
        </div>
        <p className={cn('font-display leading-tight font-extrabold break-words', promptSize(q.prompt))}>{q.prompt}</p>
        {q.unit && <p className="font-display text-[3.4vmin] font-extrabold opacity-80">Réponse en {q.unit}</p>}
      </motion.div>
      <div className="sticker flex flex-col gap-[1vmin] bg-surface p-[1.5vmin]">
        <p className="text-center font-display text-[3vmin] font-extrabold">
          <motion.span key={s.answered.length} initial={{ scale: 1.8, color: '#06D6A0' }} animate={{ scale: 1, color: 'var(--text)' }} className="inline-block">
            {s.answered.length}
          </motion.span>
          /{s.players.length} ont répondu
        </p>
        <TvDots dots={dots} get={get} />
      </div>
    </>
  )
}

function RevealTv({ s, lr, get }: { s: LppState; lr: LppReveal; get: Get }) {
  const reduce = !!useReducedMotion()
  const { h } = useViewport()
  const left = useCountdown(s.deadline, 500)
  const last = s.round >= s.total_rounds
  const unit = lr.question.unit
  const t = timeline(lr.ranking.length, reduce)
  // La règle est conçue pour un téléphone : on l'agrandit (zoom CSS) selon la hauteur de l'écran.
  const zoom = Math.max(1.2, Math.min(2.2, h / 560))
  const silent = s.players.filter((id) => !lr.ranking.some((e) => e.profile_id === id))
  const top = lr.ranking.slice(0, 6)

  return (
    <>
      <motion.div
        initial={{ scale: 0.3, rotate: -10, opacity: 0 }}
        animate={{ scale: 1, rotate: -1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 13 }}
        className="sticker flex flex-col items-center gap-[0.6vmin] p-[1.8vmin] text-center text-[#1f1b2e]"
        style={{ backgroundColor: themeInfo(lr.question.theme).color }}
      >
        <p className="font-display text-[2.8vmin] leading-tight font-extrabold opacity-80">{lr.question.prompt}</p>
        <motion.p
          initial={{ scale: 3, opacity: 0, rotate: 8 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          transition={{ delay: t.truth + 0.2, type: 'spring', stiffness: 320, damping: 12 }}
          className="font-display text-[8vmin] leading-tight font-extrabold break-words"
        >
          🎯 {withUnit(lr.answer, unit)}
        </motion.p>
        {lr.note && (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: t.after }} className="text-[2.4vmin] leading-snug font-bold opacity-80">
            💡 {lr.note}
          </motion.p>
        )}
      </motion.div>

      <div className="min-w-0" style={{ zoom }}>
        <Ruler lr={lr} get={get} meId="" unit={unit} fast={false} tv />
      </div>

      <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: t.after }} className="sticker flex min-h-0 flex-1 flex-col justify-center gap-[0.8vmin] bg-surface p-[1.5vmin]">
        <div className="flex flex-wrap gap-x-[2vmin] gap-y-[0.8vmin]">
          {top.map((e) => {
            const p = get(e.profile_id)
            return (
              <div key={e.profile_id} className="flex items-center gap-[1vmin] rounded-full border-[3px] border-ink bg-sunk py-[0.4vmin] pr-[1.6vmin] pl-[0.4vmin]">
                <span className="font-display text-[2.8vmin] font-extrabold">{e.rank <= 3 ? MEDALS[e.rank - 1] : rankLabel(e.rank)}</span>
                <Avatar slug={p.slug} size={52} expression={mood(p, e.exact ? 'love' : e.points > 0 ? 'happy' : 'sad')} />
                <div className="leading-tight">
                  <p className="font-display text-[2.6vmin] font-extrabold">
                    {p.nickname} {e.points > 0 && <span className="text-mint">+{e.points}</span>}
                  </p>
                  <p className="text-[2vmin] font-bold text-muted">
                    {withUnit(e.value, unit)} · {e.exact ? '🎯 pile !' : `à ${withUnit(e.gap, unit)} (${describeMiss(e.value, lr.answer)})`}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
        {silent.length > 0 && (
          <div className="flex flex-wrap items-center gap-[1vmin] border-t-2 border-dashed border-ink/20 pt-[0.8vmin]">
            {silent.map((id) => {
              const p = get(id)
              return (
                <span key={id} className="flex items-center gap-1 rounded-full bg-sunk py-0.5 pr-2 pl-0.5 text-[2.2vmin] font-bold">
                  <Avatar slug={p.slug} expression={mood(p, 'sleepy')} size={32} />
                  {p.nickname} {lr.answers[id] === null ? '🤷' : '⌛'}
                </span>
              )
            })}
          </div>
        )}
      </motion.div>
      {s.deadline && (
        <p className="text-center font-display text-[2.6vmin] font-extrabold text-muted">
          {last ? 'Résultats' : 'Manche suivante'} dans {Math.max(0, Math.ceil(left / 1000))} s
        </p>
      )}
    </>
  )
}
