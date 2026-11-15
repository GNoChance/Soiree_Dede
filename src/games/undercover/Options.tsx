import { Toggle } from '@/components/ui/Toggle'
import type { GameOptionsProps } from '../types'
import { MISTER_WHITE_MIN_PLAYERS } from './setup'

export function UndercoverOptions({ options, onChange, playerCount }: GameOptionsProps) {
  const on = options.misterWhite !== false
  const enough = playerCount >= MISTER_WHITE_MIN_PLAYERS
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <span className="font-display text-lg font-extrabold">Mister White 🤫</span>
          <p className="text-sm leading-snug text-muted">
            Un joueur sans mot qui doit bluffer. Dès {MISTER_WHITE_MIN_PLAYERS} joueurs.
          </p>
        </div>
        <Toggle checked={on} onChange={(v) => onChange({ ...options, misterWhite: v })} label="Mister White" />
      </div>
      {on && !enough && (
        <p className="rounded-chip border-2 border-ink/30 bg-sunk px-3 py-1.5 text-sm font-bold">
          À {playerCount} joueurs, pas de Mister White pour cette partie.
        </p>
      )}
      <p className="text-sm text-muted">{playerCount >= 7 ? '2 undercovers (7 joueurs et plus).' : '1 undercover.'}</p>
    </div>
  )
}
