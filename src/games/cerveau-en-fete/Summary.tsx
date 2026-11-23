import { motion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/lib/cn'
import { mood, playerOrPlaceholder } from '@/features/soiree/players'
import { useTv } from '@/features/tv/tv'
import { TvFinal } from '@/features/tv/QuizTv'
import type { GameSummaryProps } from '../types'
import type { CefState } from './types'
import { formatMs, themeInfo } from './setup'

const MEDALS = ['🥇', '🥈', '🥉']

/** Bloc fin de partie : scores réels du quiz, stats et récap des questions. */
export default function CerveauSummary({ state, meId, players }: GameSummaryProps) {
  const s = state as unknown as CefState
  const history = s.history ?? []
  const get = (id: string) => playerOrPlaceholder(players, id)
  const tv = useTv()
  if (tv) {
    const good = (id: string) => history.filter((h) => h.found.some((f) => f.profile_id === id)).length
    return <TvFinal ids={s.players} scores={s.scores ?? {}} get={get} sub={(id) => `✓ ${good(id)}/${history.length}`} />
  }

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

  // Moments drôles (masqués quand la donnée manque).
  const pearls: Array<{ id: string; text: string; prompt: string }> = []
  const seen = new Set<string>()
  for (const h of [...history].reverse()) {
    for (const [id, list] of Object.entries(h.wrong ?? {})) {
      const text = list?.[list.length - 1]
      if (!text || seen.has(id) || h.found.some((f) => f.profile_id === id)) continue
      seen.add(id)
      pearls.push({ id, text, prompt: h.prompt })
    }
    if (pearls.length >= 3) break
  }
  const flop = history
    .filter((h) => h.found.length === 0)
    .sort((a, b) => Object.keys(b.wrong ?? {}).length - Object.keys(a.wrong ?? {}).length)[0]
  const streaks = s.players
    .map((id) => {
      let run = 0
      let max = 0
      for (const h of history) {
        if (h.found.some((f) => f.profile_id === id)) max = Math.max(max, ++run)
        else run = 0
      }
      return { id, n: max }
    })
    .sort((a, b) => b.n - a.n)
  const streak = streaks[0] && streaks[0].n >= 3 ? streaks[0] : null
  const hasMoments = pearls.length > 0 || !!flop || !!streak

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

      {hasMoments && (
        <div className="sticker flex flex-col gap-2 bg-surface p-3">
          <p className="font-display text-lg font-extrabold">Les moments de la partie 🎬</p>
          {streak && (
            <div className="flex items-center gap-2 rounded-chip bg-sunk p-2">
              <Avatar slug={get(streak.id).slug} expression={mood(get(streak.id), 'proud')} size={40} />
              <p className="text-sm leading-snug">
                🔥 <b>Meilleure série</b> : {get(streak.id).nickname}, {streak.n} bonnes réponses d’affilée
              </p>
            </div>
          )}
          {flop && (
            <div className="rounded-chip bg-sunk p-2 text-sm leading-snug">
              🤦 <b>La question qui a tout fait rater</b> : {flop.prompt} — c’était <b>« {flop.answer} »</b>
            </div>
          )}
          {pearls.map((x) => (
            <div key={x.id} className="flex items-center gap-2 rounded-chip bg-sunk p-2">
              <Avatar slug={get(x.id).slug} expression={mood(get(x.id), 'shy')} size={36} />
              <p className="min-w-0 text-sm leading-snug">
                ✍️ <b>{get(x.id).nickname}</b> a tapé « {x.text} »
                <span className="block truncate text-xs text-muted">{x.prompt}</span>
              </p>
            </div>
          ))}
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
