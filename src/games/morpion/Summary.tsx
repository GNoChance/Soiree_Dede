import { Avatar } from '@/components/ui/Avatar'
import { DuelSummary } from '@/features/duel/DuelSummary'
import { mood, playerOrPlaceholder } from '@/features/soiree/players'
import type { GameSummaryProps } from '../types'
import { variantInfo, variantOf } from './logic'
import type { MorpionState } from './types'

/** Fin de session : classement du socle + variante jouée, victoire éclair, symboles tracés. */
export default function MorpionSummary(props: GameSummaryProps) {
  const s = props.state as unknown as MorpionState
  const history = s.session?.history ?? []
  const games = history.flatMap((h) => h.games)
  const fastest = games.filter((g) => g.winner).sort((x, y) => x.moves - y.moves)[0]
  const total = games.reduce((n, g) => n + g.moves, 0)
  const info = variantInfo(variantOf(s.session?.board_options))
  const p = fastest?.winner ? playerOrPlaceholder(props.players, fastest.winner) : null
  const extra =
    games.length > 0 ? (
      <div className="grid grid-cols-2 gap-2">
        {p && fastest ? (
          <div className="sticker flex flex-col items-center gap-1 bg-sky p-2 text-center text-[#1f1b2e]">
            <span className="text-xs font-extrabold uppercase">Éclair ⚡</span>
            <Avatar slug={p.slug} expression={mood(p, 'sly')} size={40} />
            <span className="text-sm font-bold">
              {p.nickname} · manche gagnée en {fastest.moves} coups
            </span>
          </div>
        ) : (
          <div className="sticker flex flex-col items-center justify-center gap-1 bg-sky p-2 text-center text-[#1f1b2e]">
            <span className="text-xs font-extrabold uppercase">Morpion {info.label.toLowerCase()}</span>
            <span className="font-display text-3xl">🤝</span>
            <span className="text-sm font-bold">Que des manches nulles !</span>
          </div>
        )}
        <div className="sticker flex flex-col items-center justify-center gap-1 bg-sun p-2 text-center text-[#1f1b2e]">
          <span className="text-xs font-extrabold uppercase">Symboles tracés ❌⭕</span>
          <span className="font-display text-4xl font-extrabold tabular-nums">{total}</span>
          <span className="text-xs font-bold">Variante {info.label.toLowerCase()}</span>
        </div>
      </div>
    ) : null
  return <DuelSummary {...props} extra={extra} />
}
