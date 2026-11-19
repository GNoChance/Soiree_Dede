import { SegmentedControl } from '@/components/ui/SegmentedControl'
import type { GameOptionsProps } from '../types'
import type { MgOptions } from './types'

export const MG_COUNTS = [9, 5] as const
export const MG_TIMERS = [60, 90, 0] as const
export const MG_DEFAULT_OPTIONS: MgOptions = { holes: 9, timer: 90 }

/** p_options de start_match : {holes: 9|5, timer: 60|90|0} (le serveur revalide). */
export function normalizeOptions(o: Record<string, unknown>): Record<string, unknown> {
  const holes = Number(o.holes)
  const timer = Number(o.timer)
  return {
    holes: (MG_COUNTS as readonly number[]).includes(holes) ? holes : MG_DEFAULT_OPTIONS.holes,
    timer: o.timer !== undefined && (MG_TIMERS as readonly number[]).includes(timer) ? timer : MG_DEFAULT_OPTIONS.timer,
  }
}

export function MiniGolfOptions({ options, onChange }: GameOptionsProps) {
  const o = normalizeOptions(options)
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="font-display text-lg font-extrabold">Parcours</span>
        <SegmentedControl
          ariaLabel="Parcours"
          value={String(o.holes)}
          onChange={(v) => onChange({ ...options, holes: Number(v) })}
          options={[
            { value: '9', label: '9 trous' },
            { value: '5', label: 'Express (5)' },
          ]}
        />
        <p className="text-sm text-muted">{o.holes === 9 ? 'La Kermesse du village complète, par 26 (≈ 12 min).' : 'Trous 1, 3, 5, 8 et 9, par 15 (≈ 6 min).'}</p>
      </div>
      <div className="flex flex-col gap-2">
        <span className="font-display text-lg font-extrabold">Chrono par trou</span>
        <SegmentedControl
          ariaLabel="Chrono par trou"
          value={String(o.timer)}
          onChange={(v) => onChange({ ...options, timer: Number(v) })}
          options={MG_TIMERS.map((n) => ({ value: String(n), label: n ? `${n} s` : 'Sans' }))}
        />
        <p className="text-sm text-muted">
          {o.timer ? 'À la fin du chrono, ceux qui n’ont pas rentré leur balle marquent 7.' : 'Sans chrono : l’hôte passe au trou suivant quand il veut.'}
        </p>
      </div>
    </div>
  )
}
