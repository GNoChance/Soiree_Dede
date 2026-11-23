import { Avatar } from '@/components/ui/Avatar'
import { DuelSummary } from '@/features/duel/DuelSummary'
import { Moments, names, topOf, type Moment } from '@/features/duel/Moments'
import { mood, playerOrPlaceholder } from '@/features/soiree/players'
import type { DuelGameRecord } from '@/features/duel/types'
import type { GameSummaryProps, PlayerInfo } from '../types'
import type { ChessEndReason, ChessGameX, ChessState } from './types'

type Game = DuelGameRecord & { x?: ChessGameX }

/** Raisons de fin expliquées simplement (les débutants ne les connaissent pas toujours). */
const EXPLAIN: Partial<Record<ChessEndReason, { emoji: string; title: string; text: string }>> = {
  stalemate: { emoji: '🤷', title: 'Un pat !', text: 'Le joueur dont c’était le tour ne pouvait plus rien jouer sans se mettre en échec : dans ce cas, c’est nul.' },
  repetition: { emoji: '🔁', title: 'Trois fois la même position', text: 'Quand la même position revient 3 fois, on arrête : match nul.' },
  fifty: { emoji: '🐌', title: '50 coups sans rien capturer', text: 'Ni prise ni pion avancé pendant 50 coups : la partie est déclarée nulle.' },
  material: { emoji: '🪶', title: 'Plus assez de pièces', text: 'Avec si peu de pièces, impossible de faire échec et mat : nul.' },
}

function chessMoments(games: Game[], get: (id: string) => PlayerInfo): Moment[] {
  const out: Moment[] = []
  const ids = [...new Set(games.flatMap((g) => Object.keys(g.x?.p ?? {})))]
  const sum = (id: string, k: keyof NonNullable<ChessGameX['p'][string]>) => games.reduce((n, g) => n + (g.x?.p[id]?.[k] ?? 0), 0)
  const many = (a: string[]) => (a.length > 1 ? 'ont' : 'a')

  const blunder = topOf(ids, (id) => sum(id, 'stalemate_blunders'))
  if (blunder) out.push({ key: 'patgaffe', emoji: '🤦', title: 'La gaffe du pat', ids: blunder.ids, text: `${names(blunder.ids, get)} ${many(blunder.ids)} dominé la partie… avant de bloquer l’adversaire par erreur (pat = nul). Aïe !` })

  // Fins de manche à expliquer (une carte par raison, les plus rares d'abord).
  const seen = new Set<ChessEndReason>()
  for (const g of games) if (g.x?.reason && EXPLAIN[g.x.reason]) seen.add(g.x.reason)
  for (const r of ['stalemate', 'repetition', 'fifty', 'material'] as const) {
    if (seen.has(r) && !(r === 'stalemate' && blunder)) out.push({ key: `end-${r}`, emoji: EXPLAIN[r]!.emoji, title: EXPLAIN[r]!.title, text: EXPLAIN[r]!.text })
  }
  const clock = games.find((g) => g.x?.reason === 'time' && g.winner)
  if (clock?.winner) {
    const loser = Object.keys(clock.x?.p ?? {}).find((id) => id !== clock.winner)
    if (loser) out.push({ key: 'time', emoji: '⏰', title: 'Plus de temps !', ids: [loser], text: `${get(loser).nickname} a vu sa pendule tomber à zéro : ${get(clock.winner).nickname} gagne au temps.` })
  }
  const resign = games.find((g) => g.x?.reason === 'resign' && g.winner)
  if (resign?.winner) {
    const loser = Object.keys(resign.x?.p ?? {}).find((id) => id !== resign.winner)
    if (loser) out.push({ key: 'resign', emoji: '🏳️', title: 'Drapeau blanc', ids: [loser], text: `${get(loser).nickname} a abandonné : bon joueur, on sait reconnaître un adversaire coriace.` })
  }

  const queens = topOf(ids, (id) => sum(id, 'queens_lost'))
  if (queens && queens.value >= 2) out.push({ key: 'queens', emoji: '👸', title: 'Adieu la Dame', ids: queens.ids, text: `${names(queens.ids, get)} ${many(queens.ids)} perdu sa Dame ${queens.value} fois. Elle revient dimanche ?` })
  const ep = topOf(ids, (id) => sum(id, 'en_passants'))
  if (ep) out.push({ key: 'enpassant', emoji: '🥷', title: 'Prise en passant', ids: ep.ids, text: `${names(ep.ids, get)} ${many(ep.ids)} sorti la règle que personne ne connaît : la prise en passant !` })
  return out.slice(0, 4)
}

/** Fin de session : classement du socle + le mat le plus rapide, les pièces croquées et les moments de la partie. */
export default function EchecsSummary(props: GameSummaryProps) {
  const s = props.state as unknown as ChessState
  const games = (s.session?.history ?? []).flatMap((h) => h.games as Game[])
  const get = (id: string) => playerOrPlaceholder(props.players, id)
  const mates = games
    .filter((g) => g.winner && g.x?.reason === 'mate')
    .map((g) => ({ winner: g.winner as string, moves: g.x?.p[g.winner as string]?.moves ?? 0 }))
    .sort((a, b) => a.moves - b.moves)
  const fastest = mates[0]
  const captures = games.reduce((n, g) => n + Object.values(g.x?.p ?? {}).reduce((m, t) => m + (t.captures ?? 0), 0), 0)
  const p = fastest ? get(fastest.winner) : null
  const moments = chessMoments(games, get)
  const extra =
    games.length > 0 ? (
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-2">
          <div className="sticker flex flex-col items-center justify-center gap-1 bg-sky p-2 text-center text-[#1f1b2e]">
            <span className="text-xs font-extrabold uppercase">Mat éclair ⚡</span>
            {p && fastest ? (
              <>
                <Avatar slug={p.slug} expression={mood(p, 'sly')} size={40} />
                <span className="text-sm font-bold">
                  {p.nickname} · mat en {fastest.moves} coup{fastest.moves > 1 ? 's' : ''}
                </span>
              </>
            ) : (
              <span className="text-sm font-bold">Aucun échec et mat ce soir… les rois ont tenu bon !</span>
            )}
          </div>
          <div className="sticker flex flex-col items-center justify-center gap-1 bg-sun p-2 text-center text-[#1f1b2e]">
            <span className="text-xs font-extrabold uppercase">Pièces croquées 🍽️</span>
            <span className="font-display text-4xl font-extrabold tabular-nums">{captures}</span>
          </div>
        </div>
        {moments.length > 0 && (
          <div className="sticker bg-surface p-3">
            <Moments moments={moments} get={get} />
          </div>
        )}
      </div>
    ) : null
  return <DuelSummary {...props} extra={extra} />
}
