import { motion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/lib/cn'
import { mood, playerOrPlaceholder } from '@/features/soiree/players'
import type { GameSummaryProps } from '../types'
import type { CefState } from './types'
import { formatMs, themeInfo } from './setup'

const MEDALS = ['🥇', '🥈', '🥉']

/** Bloc fin de partie : scores réels du quiz, stats et récap des questions. */
export default function CerveauSummary({ state, meId, players }: GameSummaryProps) {
  const s = state as unknown as CefState
  const history = s.history ?? []
  const get = (id: string) => playerOrPlaceholder(players, id)

  const stats = s.players.map((id) => {
    const mine = history.flatMap((h) => h.found.filter((f) => f.profile_id === id))
    return {
      id,
      score: s.scores?.[id] ?? 0,
      good: mine.length,
      firsts: mine.filter((f) => f.rank === 1).length,
      best: mine.length ? Math.min(...mine.map((f) => f.ms)) : null,
    }
  })
  stats.sort((a, b) => b.score - a.score)
  const scoreRank = (score: number) => stats.findIndex((x) => x.score === score)

  const fastest = history
    .flatMap((h) => h.found.map((f) => ({ ...f, h })))
    .sort((a, b) => a.ms - b.ms)[0]

  return (
    <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.2 }} className="flex flex-col gap-3">
      <div className="sticker flex flex-col gap-1.5 bg-surface p-3">
        <p className="font-display text-lg font-extrabold">🧠 Scores du quiz</p>
        {stats.map((x, i) => {
          const p = get(x.id)
          const r = scoreRank(x.score)
          return (
            <motion.div
              key={x.id}
              initial={{ x: 60, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 1.4 + i * 0.08 }}
              className={cn('flex items-center gap-2 rounded-chip px-1 py-0.5', x.id === meId && 'bg-sunk')}
            >
              <span className="w-6 text-center">{x.score > 0 ? (MEDALS[r] ?? r + 1) : r + 1}</span>
              <Avatar slug={p.slug} expression={r === 0 && x.score > 0 ? mood(p, 'proud') : p.equipped} size={32} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold leading-tight">{p.nickname}</p>
                <p className="text-xs font-bold text-muted">
                  ✓ {x.good}/{history.length}
                  {x.firsts > 0 && ` · ⚡ ${x.firsts}`}
                  {x.best !== null && ` · record ${formatMs(x.best)}`}
                </p>
              </div>
              <span className="font-display text-lg font-extrabold">{x.score.toLocaleString('fr-FR')}</span>
            </motion.div>
          )
        })}
      </div>

      {fastest && (
        <div className="sticker flex items-center gap-3 bg-mint p-3 text-[#1f1b2e]">
          <Avatar slug={get(fastest.profile_id).slug} expression={mood(get(fastest.profile_id), 'proud')} size={52} />
          <div className="min-w-0">
            <p className="text-sm font-bold">⚡ Réflexe de la partie</p>
            <p className="font-display text-lg leading-tight font-extrabold">
              {get(fastest.profile_id).nickname} en {formatMs(fastest.ms)}
            </p>
            <p className="truncate text-sm">« {fastest.h.answer} »</p>
          </div>
        </div>
      )}

      {history.length > 0 && (
        <details className="sticker bg-surface p-3">
          <summary className="cursor-pointer font-display font-extrabold">Toutes les réponses ({history.length})</summary>
          <ol className="mt-2 flex flex-col gap-2">
            {history.map((h) => (
              <li key={h.round} className="flex flex-col gap-0.5 rounded-chip bg-sunk p-2">
                <span className="text-sm leading-snug">
                  {themeInfo(h.theme).emoji} {h.prompt}
                </span>
                <span className="flex flex-wrap items-center gap-1.5">
                  <Badge tone="mint" tilted={false}>
                    {h.answer}
                  </Badge>
                  <span className="text-xs font-bold text-muted">
                    {h.found.length ? `${h.found.length} trouvé${h.found.length > 1 ? 's' : ''}` : 'personne'}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </motion.div>
  )
}
