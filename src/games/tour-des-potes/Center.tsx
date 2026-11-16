/** Centre du plateau : joueur au trait, dés, ce qui se passe, dernier évènement. */
import { Avatar } from '@/components/ui/Avatar'
import { mood, playerOrPlaceholder } from '@/features/soiree/players'
import type { PlayerInfo } from '../types'
import { Die } from './Dice'
import { logLine, nowLine } from './format'
import type { TdpState } from './types'

interface Props {
  s: TdpState
  players: Record<string, PlayerInfo>
  meId: string
  name: (id: string | null | undefined) => string
  rolling: boolean
}

export default function Center({ s, players, meId, name, rolling }: Props) {
  const p = s.turn ? playerOrPlaceholder(players, s.turn) : null
  const last = [...s.log].reverse().map((e) => logLine(e, name)).find((l) => l && l.icon !== '▶️')
  const dice = s.dice ?? s.last_event?.dice ?? null
  const me = s.turn === meId
  return (
    <div className="flex size-full min-h-0 min-w-0 flex-col items-center justify-between gap-1 overflow-hidden text-center">
      <p className="font-display text-[10px] leading-none font-extrabold tracking-wide text-muted uppercase">Le Tour des Potes</p>
      <div className="flex min-h-0 flex-col items-center gap-0.5">
        {p ? (
          <>
            <Avatar slug={p.slug} expression={me ? mood(p, 'happy') : mood(p, 'think')} size={40} bounce />
            <p className="max-w-full truncate font-display text-base leading-none font-extrabold">{me ? 'À toi !' : p.nickname}</p>
          </>
        ) : (
          <p className="text-3xl">🏆</p>
        )}
      </div>
      <div className="flex items-center gap-2" aria-live="polite">
        {dice ? (
          <>
            <Die value={dice[0]} rolling={rolling} size={34} />
            <Die value={dice[1]} rolling={rolling} size={34} delay={0.08} />
          </>
        ) : (
          <span className="text-3xl" aria-hidden>
            🎲
          </span>
        )}
      </div>
      <p className="max-w-full text-xs leading-tight font-extrabold">{nowLine(s, name, meId)}</p>
      {last && (
        <p className="line-clamp-2 max-w-full text-[10px] leading-tight text-muted">
          {last.icon} {last.text}
        </p>
      )}
    </div>
  )
}
