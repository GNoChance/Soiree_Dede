import { motion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/cn'
import { mood, playerOrPlaceholder } from '@/features/soiree/players'
import { useTv } from '@/features/tv/tv'
import { Moments, names, topOf, type Moment } from '@/features/duel/Moments'
import type { GameSummaryProps, PlayerInfo } from '../types'
import { holeById, pickedUp } from './holes'
import { MARK_DOT, courseLabel, markOf, ranking, vsPar } from './logic'
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

  const moments = golfMoments(s, get)

  return (
    <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.2 }} className="sticker flex flex-col gap-3 bg-surface p-4">
      <div className="flex flex-col items-center gap-2 text-center">
        <p className={cn('font-display font-extrabold', tv ? 'text-4xl' : 'text-2xl')}>
          ⛳ {winners.length > 1 ? 'Égalité en tête' : `${get(winners[0].id).nickname} gagne`} avec {winners[0].total} coups
        </p>
        <p className="text-sm font-bold text-muted">
          {courseLabel(s)} · par {parTotal}
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
                {MARK_DOT[markOf(b.score, b.par)]} {b.score >= pickedUp(b.par) ? 'ramassée' : `${b.score} coup${b.score > 1 ? 's' : ''}`} (par {b.par})
              </span>
            </div>
          )
        })}
      </div>
      <Moments moments={moments} get={get} tv={tv} />
    </motion.div>
  )
}
/** Moments drôles : trou maudit, plongeons, trou en un, moulin (masqués si la donnée manque). */
function golfMoments(s: MiniGolfState, get: (id: string) => PlayerInfo): Moment[] {
  const out: Moment[] = []
  const stat = (id: string, k: string) => s.results?.find((r) => r.profile_id === id)?.stats?.[k]
  const ids = s.players ?? Object.keys(s.cards)

  // Le trou maudit : le plus gros score sur un seul trou.
  let w: { id: string; i: number; n: number } | null = null
  for (const id of ids) {
    ;(s.cards[id] ?? []).forEach((n, i) => {
      if (n >= s.pars[i] + 3 && (!w || n > w.n)) w = { id, i, n }
    })
  }
  const cursed = w as { id: string; i: number; n: number } | null
  if (cursed) {
    out.push({
      key: 'cursed',
      emoji: '⛳',
      title: 'Le trou maudit',
      ids: [cursed.id],
      text: `${get(cursed.id).nickname} a lutté ${cursed.n >= pickedUp(s.pars[cursed.i]) ? 'jusqu’à ramasser sa balle' : `${cursed.n} coups`} sur « ${holeById(s.holes[cursed.i]).name} » (par ${s.pars[cursed.i]}). Courage !`,
    })
  }

  const ace = topOf(ids, (id) => stat(id, 'aces'))
  if (ace) out.push({ key: 'ace', emoji: '🎯', title: 'Trou en un !', ids: ace.ids, text: `${names(ace.ids, get)} ${ace.ids.length > 1 ? 'ont' : 'a'} envoyé la balle directement au fond${ace.value > 1 ? ` (${ace.value} fois)` : ''}.` })

  const water = topOf(ids, (id) => stat(id, 'water'))
  if (water) out.push({ key: 'water', emoji: '🌊', title: 'Balles à l’eau', ids: water.ids, text: `${names(water.ids, get)} ${water.ids.length > 1 ? 'ont' : 'a'} piqué ${water.value > 1 ? `${water.value} têtes` : 'une tête'} dans l’eau. Belle nage !` })

  const mill = topOf(ids, (id) => stat(id, 'mill_hits'))
  if (mill && mill.value >= 3) out.push({ key: 'mill', emoji: '🌀', title: 'Le moulin a du caractère', ids: mill.ids, text: `${names(mill.ids, get)} ${mill.ids.length > 1 ? 'ont' : 'a'} pris ${mill.value} coups de pale. Rien de personnel !` })

  return out.slice(0, 4)
}

