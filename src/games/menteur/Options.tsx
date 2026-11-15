import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Toggle } from '@/components/ui/Toggle'
import type { GameOptionsProps } from '../types'
import { normalizeOptions } from './rules'

export function MenteurOptions({ options, onChange }: GameOptionsProps) {
  const o = normalizeOptions(options)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <span className="font-display text-lg font-extrabold">Temps par tour ⏱️</span>
        <SegmentedControl
          ariaLabel="Temps par tour"
          value={String(o.turn_seconds) as '30' | '45' | '60'}
          onChange={(v) => onChange({ ...options, turn_seconds: Number(v) })}
          options={[
            { value: '30', label: '30 s' },
            { value: '45', label: '45 s' },
            { value: '60', label: '60 s' },
          ]}
        />
        <p className="text-sm leading-snug text-muted">Trop lent ? Le jeu surenchérit à ta place (+1 dé, même valeur).</p>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <span className="font-display text-lg font-extrabold">Variante « Pile ! » 🎯</span>
          <p className="text-sm leading-snug text-muted">
            Parie que l’enchère est pile juste : gagné, tu récupères un dé ; raté, tu en perds un.
          </p>
        </div>
        <Toggle checked={o.pile} onChange={(v) => onChange({ ...options, pile: v })} label="Variante Pile" />
      </div>
    </div>
  )
}
