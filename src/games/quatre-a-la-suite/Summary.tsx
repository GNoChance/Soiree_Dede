import { Avatar } from '@/components/ui/Avatar'
import { DuelSummary } from '@/features/duel/DuelSummary'
import { Moments, names, topOf, type Moment } from '@/features/duel/Moments'
import { mood, playerOrPlaceholder } from '@/features/soiree/players'
import type { DuelGameRecord } from '@/features/duel/types'
import type { GameSummaryProps } from '../types'
import type { Q4State } from './types'

type Game = DuelGameRecord & { x?: { diag?: boolean; double?: boolean } }

/** Fin de session : classement du socle + la victoire la plus expéditive et les moments de la partie. */
export default function QuatreALaSuiteSummary(props: GameSummaryProps) {
  const s = props.state as unknown as Q4State
  const all = (s.session?.history ?? []).flatMap((h) => h.games as Game[])
  const games = all.filter((g) => g.winner)
  const fastest = [...games].sort((x, y) => x.moves - y.moves)[0]
  const totalTokens = all.reduce((n, g) => n + g.moves, 0)
  const get = (id: string) => playerOrPlaceholder(props.players, id)
  const p = fastest?.winner ? get(fastest.winner) : null

  const moments: Moment[] = []
  const many = (a: string[]) => (a.length > 1 ? 'ont' : 'a')
  const winners = [...new Set(games.map((g) => g.winner as string))]
  const diag = topOf(winners, (id) => games.filter((g) => g.winner === id && g.x?.diag).length)
  if (diag) moments.push({ key: 'diag', emoji: '↗️', title: 'Le roi de la diagonale', ids: diag.ids, text: `${names(diag.ids, get)} ${many(diag.ids)} aligné ses jetons en diagonale${diag.value > 1 ? ` ${diag.value} fois` : ''}. Personne ne regarde jamais là !` })
  const dbl = topOf(winners, (id) => games.filter((g) => g.winner === id && g.x?.double).length)
  if (dbl) moments.push({ key: 'double', emoji: '💥', title: 'Double alignement', ids: dbl.ids, text: `${names(dbl.ids, get)} ${many(dbl.ids)} fermé deux lignes d’un seul jeton${dbl.value > 1 ? ` (${dbl.value} fois)` : ''}. Du grand art !` })
  const marathon = [...games].sort((x, y) => y.moves - x.moves)[0]
  if (marathon?.winner && marathon.moves >= 30) moments.push({ key: 'marathon', emoji: '🐌', title: 'Manche marathon', ids: [marathon.winner], text: `${get(marathon.winner).nickname} l’emporte après ${marathon.moves} jetons : la grille était presque pleine !` })
  const draws = all.filter((g) => !g.winner).length
  if (draws > 0) moments.push({ key: 'full', emoji: '🧩', title: draws > 1 ? 'Grilles pleines' : 'Grille pleine', text: `${draws > 1 ? `${draws} manches` : 'Une manche'} sans vainqueur : tous les jetons sont posés et personne n’a gagné.` })

  const extra =
    p && fastest ? (
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-2">
          <div className="sticker flex flex-col items-center gap-1 bg-sky p-2 text-center text-[#1f1b2e]">
            <span className="text-xs font-extrabold uppercase">Éclair ⚡</span>
            <Avatar slug={p.slug} expression={mood(p, 'sly')} size={40} />
            <span className="text-sm font-bold">
              {p.nickname} · manche gagnée en {fastest.moves} coups
            </span>
          </div>
          <div className="sticker flex flex-col items-center justify-center gap-1 bg-sun p-2 text-center text-[#1f1b2e]">
            <span className="text-xs font-extrabold uppercase">Jetons lâchés 🔴🟡</span>
            <span className="font-display text-4xl font-extrabold tabular-nums">{totalTokens}</span>
          </div>
        </div>
        {moments.length > 0 && (
          <div className="sticker bg-surface p-3">
            <Moments moments={moments.slice(0, 3)} get={get} />
          </div>
        )}
      </div>
    ) : null
  return <DuelSummary {...props} extra={extra} />
}
