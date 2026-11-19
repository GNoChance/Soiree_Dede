import { Avatar } from '@/components/ui/Avatar'
import { DuelSummary } from '@/features/duel/DuelSummary'
import { mood, playerOrPlaceholder } from '@/features/soiree/players'
import type { DuelGameRecord } from '@/features/duel/types'
import type { GameSummaryProps } from '../types'
import type { ChessGameX, ChessState } from './types'

/** Fin de session : classement du socle + le mat le plus rapide et les pièces croquées. */
export default function EchecsSummary(props: GameSummaryProps) {
  const s = props.state as unknown as ChessState
  const games = (s.session?.history ?? []).flatMap((h) => h.games as Array<DuelGameRecord & { x?: ChessGameX }>)
  const mates = games
    .filter((g) => g.winner && g.x?.reason === 'mate')
    .map((g) => ({ winner: g.winner as string, moves: g.x?.p[g.winner as string]?.moves ?? 0 }))
    .sort((a, b) => a.moves - b.moves)
  const fastest = mates[0]
  const captures = games.reduce((n, g) => n + Object.values(g.x?.p ?? {}).reduce((m, t) => m + (t.captures ?? 0), 0), 0)
  const p = fastest ? playerOrPlaceholder(props.players, fastest.winner) : null
  const extra =
    games.length > 0 ? (
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
    ) : null
  return <DuelSummary {...props} extra={extra} />
}
