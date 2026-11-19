import { motion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/cn'
import { mood, playerOrPlaceholder } from '@/features/soiree/players'
import { useTv } from '@/features/tv/tv'
import type { GameSummaryProps } from '../types'
import { holeById } from './holes'
import { MARK_DOT, markOf, ranking, vsPar } from './logic'
import { ScoreCard } from './ScoreCard'
import type { MiniGolfState } from './types'

const parText = (v: string) => (v === '=' ? 'pile le par' : v.startsWith('+') ? `${v} au-dessus du par` : `${v} sous le par`)

/** Bloc fin de partie : vainqueur(s), carte de score complète, meilleur trou de chacun. */
export default function MiniGolfSummary({ state, meId, players }: GameSummaryProps) {
  const s = state as unknown as MiniGolfState
  const tv = useTv()
  if (!s.holes?.length || !s.cards) return null
  const get = (id: string) => playerOrPlaceholder(players, id)
  const rows = ranking(s)
  const winners = rows.filter((r) => r.rank === 1)
  const parTotal = s.pars.reduce((a, b) => a + b, 0)

  /** Meilleur trou : plus grand écart sous le par (puis le plus difficile). */
  const best = (id: string) => {
    const card = s.cards[id] ?? []
    let bi = -1
    for (let i = 0; i < card.length; i++) {
      if (bi < 0 || card[i] - s.pars[i] < card[bi] - s.pars[bi] || (card[i] - s.pars[i] === card[bi] - s.pars[bi] && s.pars[i] > s.pars[bi])) bi = i
    }
    return bi < 0 ? null : { i: bi, score: card[bi], par: s.pars[bi] }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.2 }} className="sticker flex flex-col gap-3 bg-surface p-4">
      <div className="flex flex-col items-center gap-2 text-center">
        <p className={cn('font-display font-extrabold', tv ? 'text-4xl' : 'text-2xl')}>
          ⛳ {winners.length > 1 ? 'Égalité en tête' : `${get(winners[0].id).nickname} gagne`} avec {winners[0].total} coups
        </p>
        <p className="text-sm font-bold text-muted">
          Parcours {s.holes.length === 9 ? 'complet' : 'express'} · par {parTotal}
          {s.forced ? ' · partie écourtée' : ''}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {winners.map((w) => (
            <div key={w.id} className="flex w-28 flex-col items-center">
              <Avatar slug={get(w.id).slug} expression={mood(get(w.id), 'proud')} tenue={get(w.id).equippedTenue} size={tv ? 88 : 64} bounce />
              <span className="w-full truncate text-xs font-extrabold">{get(w.id).nickname}</span>
              <span className="text-xs font-bold text-muted">{parText(vsPar(s, w.id))}</span>
            </div>
          ))}
        </div>
      </div>

      <ScoreCard s={s} players={players} meId={meId} big={tv} />

      <div className="flex flex-col gap-1">
        <span className="font-display font-extrabold">🌟 Meilleur trou de chacun</span>
        {rows.map((r) => {
          const b = best(r.id)
          if (!b) return null
          return (
            <div key={r.id} className={cn('flex items-center gap-2 text-sm leading-tight font-bold', tv && 'text-lg')}>
              <Avatar slug={get(r.id).slug} tenue={get(r.id).equippedTenue} size={tv ? 36 : 28} />
              <span className="min-w-0">
                <span className="font-extrabold">{get(r.id).nickname}</span>
                <span className="text-muted"> · {holeById(s.holes[b.i]).name} : </span>
                {MARK_DOT[markOf(b.score, b.par)]} {b.score >= 7 ? 'ramassée' : `${b.score} coup${b.score > 1 ? 's' : ''}`} (par {b.par})
              </span>
            </div>
          )
        })}
      </div>
    </motion.div>
  )
}
