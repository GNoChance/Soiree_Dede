import { motion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/lib/cn'
import { mood, playerOrPlaceholder } from '@/features/soiree/players'
import { useTv } from '@/features/tv/tv'
import { TvFinal } from '@/features/tv/QuizTv'
import type { GameSummaryProps } from '../types'
import type { LppState } from './types'
import { computeStats, describeMiss, formatNumber, themeInfo, withUnit } from './setup'

const MEDALS = ['🥇', '🥈', '🥉']

/** Bloc fin de partie : scores, le plus précis, le roi de l'exact, la pire estimation. */
export default function LePlusProcheSummary({ state, meId, players }: GameSummaryProps) {
  const s = state as unknown as LppState
  const history = s.history ?? []
  const get = (id: string) => playerOrPlaceholder(players, id)
  const tv = useTv()
  if (tv) return <TvFinal ids={s.players} scores={s.scores ?? {}} get={get} sub={(id) => ((s.exacts?.[id] ?? 0) > 0 ? `🎯 ×${s.exacts[id]}` : null)} />
  const { stats, mostPrecise, exactKings, maxExact, worst } = computeStats(s.players, history)
  const rows = [...stats].sort((a, b) => (s.scores?.[b.id] ?? 0) - (s.scores?.[a.id] ?? 0))
  const scoreRank = (score: number) => rows.findIndex((x) => (s.scores?.[x.id] ?? 0) === score)
  const names = (ids: string[]) => ids.map((id) => get(id).nickname).join(' & ')
  const precOf = (id: string) => stats.find((x) => x.id === id)?.precision ?? 0

  return (
    <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.2 }} className="flex flex-col gap-3">
      <div className="sticker flex flex-col gap-1.5 bg-surface p-3">
        <p className="font-display text-lg font-extrabold">🎯 Scores</p>
        {rows.map((x, i) => {
          const p = get(x.id)
          const score = s.scores?.[x.id] ?? 0
          const r = scoreRank(score)
          return (
            <motion.div
              key={x.id}
              initial={{ x: 60, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 1.4 + i * 0.08 }}
              className={cn('flex items-center gap-2 rounded-chip px-1 py-0.5', x.id === meId && 'bg-sunk')}
            >
              <span className="w-6 text-center">{score > 0 ? (MEDALS[r] ?? r + 1) : r + 1}</span>
              <Avatar slug={p.slug} expression={r === 0 && score > 0 ? mood(p, 'proud') : p.equipped} size={32} />
              <div className="min-w-0 flex-1">
                <p className="truncate leading-tight font-bold">{p.nickname}</p>
                <p className="text-xs font-bold text-muted">
                  {x.answered}/{history.length} estimations{x.exacts > 0 && ` · 🎯 ${x.exacts} pile`}
                </p>
              </div>
              <span className="font-display text-lg font-extrabold">{score}</span>
            </motion.div>
          )
        })}
      </div>

      {mostPrecise.length > 0 && history.length > 0 && (
        <div className="sticker flex items-center gap-3 bg-mint p-3 text-[#1f1b2e]">
          <Avatar slug={get(mostPrecise[0]).slug} expression={mood(get(mostPrecise[0]), 'proud')} size={52} />
          <div className="min-w-0">
            <p className="text-sm font-bold">📐 Le plus précis</p>
            <p className="font-display text-lg leading-tight font-extrabold">{names(mostPrecise)}</p>
            <p className="text-sm">
              écart moyen {formatNumber(Math.round((precOf(mostPrecise[0]) / history.length) * 100))} %
            </p>
          </div>
        </div>
      )}

      {exactKings.length > 0 && (
        <div className="sticker flex items-center gap-3 bg-grape p-3 text-white">
          <Avatar slug={get(exactKings[0]).slug} expression={mood(get(exactKings[0]), 'love')} size={52} />
          <div className="min-w-0">
            <p className="text-sm font-bold">👑 {exactKings.length > 1 ? 'Les rois' : 'Le roi'} de l’exact</p>
            <p className="font-display text-lg leading-tight font-extrabold">{names(exactKings)}</p>
            <p className="text-sm">
              {maxExact} réponse{maxExact > 1 ? 's' : ''} pile poil
            </p>
          </div>
        </div>
      )}

      {worst && (
        <div className="sticker flex items-center gap-3 bg-tomato p-3 text-white">
          <Avatar slug={get(worst.profile_id).slug} expression={mood(get(worst.profile_id), 'shocked')} size={52} />
          <div className="min-w-0">
            <p className="text-sm font-bold">🙈 La pire estimation</p>
            <p className="font-display text-lg leading-tight font-extrabold">
              {get(worst.profile_id).nickname} : {withUnit(worst.value, worst.unit)}
            </p>
            <p className="text-sm leading-snug">
              au lieu de {withUnit(worst.answer, worst.unit)} ({describeMiss(worst.value, worst.answer)}) — « {worst.prompt} »
            </p>
          </div>
        </div>
      )}

      {history.length > 0 && (
        <details className="sticker bg-surface p-3">
          <summary className="cursor-pointer font-display font-extrabold">Toutes les réponses ({history.length})</summary>
          <ol className="mt-2 flex flex-col gap-2">
            {history.map((h) => {
              const best = h.ranking.filter((r) => r.rank === 1)
              return (
                <li key={h.round} className="flex flex-col gap-0.5 rounded-chip bg-sunk p-2">
                  <span className="text-sm leading-snug">
                    {themeInfo(h.theme).emoji} {h.prompt}
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Badge tone="mint" tilted={false}>
                      {withUnit(h.answer, h.unit)}
                    </Badge>
                    <span className="text-xs font-bold text-muted">
                      {best.length
                        ? `${best.map((b) => get(b.profile_id).nickname).join(', ')} ${best[0].exact ? '🎯 pile' : `(${withUnit(best[0].value, h.unit)})`}`
                        : 'aucune estimation'}
                    </span>
                  </span>
                </li>
              )
            })}
          </ol>
        </details>
      )}
    </motion.div>
  )
}
