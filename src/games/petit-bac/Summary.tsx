import { motion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/cn'
import { mood, playerOrPlaceholder } from '@/features/soiree/players'
import type { GameSummaryProps } from '../types'
import type { PetitBacState } from './types'

/** Bloc fin de partie : roi des réponses uniques + tableau des manches. */
export default function PetitBacSummary({ state, players, meId }: GameSummaryProps) {
  const s = state as unknown as PetitBacState
  const history = s.history ?? []
  if (!history.length) return null
  const get = (id: string) => playerOrPlaceholder(players, id)

  const uniques = Object.entries(s.uniques ?? {}).sort((a, b) => b[1] - a[1])
  const top = uniques[0]
  const catLabel = (id: string) => s.categories?.find((c) => c.id === id)?.label ?? ''
  const longest = history.map((h) => h.longest).filter((x): x is NonNullable<typeof x> => !!x && x.text.length >= 7).sort((a, b) => b.text.length - a.text.length)[0]
  const hot = history.map((h) => h.hot).filter((x): x is NonNullable<typeof x> => !!x && (x.contests ?? 0) >= 2).sort((a, b) => (b.contests ?? 0) - (a.contests ?? 0))[0]
  const empties = s.players
    .map((id) => ({ id, n: history.reduce((t, h) => t + (h.det?.[id]?.empty ?? 0), 0) }))
    .sort((a, b) => b.n - a.n)[0]
  const empty = empties && empties.n >= 2 ? empties : null
  const moments: Array<{ id: string; emoji: string; title: string; detail: string }> = []
  if (longest) moments.push({ id: longest.pl, emoji: '📏', title: 'Le mot le plus long', detail: `« ${longest.text} »${catLabel(longest.cat) ? ` (${catLabel(longest.cat)})` : ''}` })
  if (hot)
    moments.push({
      id: hot.pl,
      emoji: '⚖️',
      title: 'La réponse la plus contestée',
      detail: `« ${hot.text} » : ${hot.contests} 👎, ${hot.status === 'refused' ? 'refusée !' : 'mais elle a passé !'}`,
    })
  if (empty) moments.push({ id: empty.id, emoji: '🕳️', title: 'Le roi du blanc', detail: `${empty.n} cases laissées vides` })
  const ranked = [...s.players].sort((a, b) => (s.scores[b] ?? 0) - (s.scores[a] ?? 0))

  return (
    <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.2 }} className="sticker flex flex-col gap-3 bg-surface p-4">
      {top && top[1] > 0 && (
        <div className="flex items-center gap-3">
          <Avatar slug={get(top[0]).slug} expression={mood(get(top[0]), 'proud')} size={60} />
          <div>
            <p className="text-sm text-muted">Esprit le plus original</p>
            <p className="font-display text-xl font-extrabold">
              {get(top[0]).nickname} · {top[1]} réponse{top[1] > 1 ? 's' : ''} unique{top[1] > 1 ? 's' : ''} 🦄
            </p>
          </div>
        </div>
      )}

      {moments.map((m, i) => {
        const p = get(m.id)
        return (
          <motion.div
            key={m.title}
            initial={{ x: -40, opacity: 0, rotate: -3 }}
            animate={{ x: 0, opacity: 1, rotate: 0 }}
            transition={{ delay: 1.3 + i * 0.15, type: 'spring', stiffness: 300, damping: 18 }}
            className="flex items-center gap-3 rounded-chip bg-sunk p-2"
          >
            <Avatar slug={p.slug} expression={mood(p, 'sly')} size={44} />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-muted">
                {m.emoji} {m.title}
              </p>
              <p className="font-display text-base leading-tight font-extrabold">
                {p.nickname} <span className="text-sm font-bold text-muted">· {m.detail}</span>
              </p>
            </div>
          </motion.div>
        )
      })}

      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-y-1 text-center">
          <thead>
            <tr className="font-display text-sm">
              <th className="text-left font-extrabold">Lettre</th>
              {history.map((h) => (
                <th key={h.round} className="font-extrabold">
                  <span className="inline-flex size-7 items-center justify-center rounded-full border-2 border-ink bg-sun text-[#1f1b2e]">{h.letter}</span>
                </th>
              ))}
              <th className="font-extrabold">Total</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((id, i) => (
              <motion.tr
                key={id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 1.4 + i * 0.08 }}
                className={cn('text-sm font-bold', id === meId && 'text-tangerine')}
              >
                <td className="text-left">
                  <span className="flex items-center gap-1.5">
                    <Avatar slug={get(id).slug} size={24} />
                    <span className="max-w-20 truncate">{get(id).nickname}</span>
                  </span>
                </td>
                {history.map((h) => (
                  <td key={h.round} className="tabular-nums">
                    {h.points[id] ?? 0}
                  </td>
                ))}
                <td className="font-display text-base font-extrabold tabular-nums">{s.scores[id] ?? 0}</td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.div>
  )
}
