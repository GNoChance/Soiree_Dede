import { Avatar } from '@/components/ui/Avatar'
import { DuelSummary } from '@/features/duel/DuelSummary'
import { mood, playerOrPlaceholder } from '@/features/soiree/players'
import type { GameSummaryProps } from '../types'
import type { Q4State } from './types'

/** Fin de session : classement du socle + la victoire la plus expéditive. */
export default function QuatreALaSuiteSummary(props: GameSummaryProps) {
  const s = props.state as unknown as Q4State
  const games = (s.session?.history ?? []).flatMap((h) => h.games.filter((g) => g.winner))
  const fastest = games.sort((x, y) => x.moves - y.moves)[0]
  const totalTokens = (s.session?.history ?? []).reduce((n, h) => n + h.games.reduce((m, g) => m + g.moves, 0), 0)
  const p = fastest?.winner ? playerOrPlaceholder(props.players, fastest.winner) : null
  const extra =
    p && fastest ? (
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
    ) : null
  return <DuelSummary {...props} extra={extra} />
}
