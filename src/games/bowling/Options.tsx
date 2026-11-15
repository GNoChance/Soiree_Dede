import { SegmentedControl } from '@/components/ui/SegmentedControl'
import type { GameOptionsProps } from '../types'
import type { BwOptions } from './types'

export const BW_FRAMES = [3, 5, 10] as const
export const BW_LIMITS = [0, 5, 10, 15] as const
export const BW_DEFAULT_OPTIONS: BwOptions = { frames: 5, time_limit: 0 }

/** p_options de start_match : {frames: 3|5|10, time_limit: minutes} (le serveur revalide). */
export function normalizeOptions(o: Record<string, unknown>): Record<string, unknown> {
  const frames = Number(o.frames)
  const limit = Number(o.time_limit)
  return {
    frames: (BW_FRAMES as readonly number[]).includes(frames) ? frames : BW_DEFAULT_OPTIONS.frames,
    time_limit: (BW_LIMITS as readonly number[]).includes(limit) ? limit : 0,
  }
}

export function BowlingOptions({ options, onChange }: GameOptionsProps) {
  const o = normalizeOptions(options)
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="font-display text-lg font-extrabold">Nombre de frames</span>
        <SegmentedControl
          ariaLabel="Nombre de frames"
          value={String(o.frames)}
          onChange={(v) => onChange({ ...options, frames: Number(v) })}
          options={BW_FRAMES.map((n) => ({ value: String(n), label: n === 10 ? '10 (officiel)' : String(n) }))}
        />
        <p className="text-sm text-muted">La dernière frame suit les règles de la 10ᵉ : strike ou spare = lancers bonus.</p>
      </div>
      <div className="flex flex-col gap-2">
        <span className="font-display text-lg font-extrabold">Limite de temps</span>
        <SegmentedControl
          ariaLabel="Limite de temps"
          value={String(o.time_limit)}
          onChange={(v) => onChange({ ...options, time_limit: Number(v) })}
          options={BW_LIMITS.map((n) => ({ value: String(n), label: n ? `${n} min` : 'Aucune' }))}
        />
        <p className="text-sm text-muted">À l’échéance, les lancers pas encore joués comptent 0.</p>
      </div>
    </div>
  )
}
