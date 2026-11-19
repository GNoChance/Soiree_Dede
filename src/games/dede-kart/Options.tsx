import { SegmentedControl } from '@/components/ui/SegmentedControl'
import type { GameOptionsProps } from '../types'
import { TRACKS } from './tracks'
import type { DkOptions } from './types'

export const DK_DEFAULT_OPTIONS: DkOptions = { races: 3, laps: 3, fill: 0, track: -1 }
const FILLS = [0, 6, 8, 12] as const

/** p_options de start_match (le serveur revalide). */
export function normalizeOptions(o: Record<string, unknown>): Record<string, unknown> {
  const fill = Number(o.fill)
  const track = Number(o.track)
  return {
    // -1 = circuit surprise (le serveur tire au hasard)
    track: Number.isInteger(track) && track >= 0 && track < TRACKS.length ? track : -1,
    races: Number(o.races) === 1 ? 1 : 3,
    laps: Number(o.laps) === 2 ? 2 : 3,
    fill: (FILLS as readonly number[]).includes(fill) ? fill : 0,
  }
}

export function KartOptions({ options, onChange, playerCount }: GameOptionsProps) {
  const o = normalizeOptions(options)
  const bots = Math.max(0, Number(o.fill) - playerCount)
  const first = Number(o.track)
  const cup = Number(o.races) === 3
  const picks = [{ id: -1, emoji: '🎲', name: 'Surprise' }, ...TRACKS.map((t, id) => ({ id, emoji: t.emoji, name: t.name }))]
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="font-display text-lg font-extrabold">{cup ? 'Premier circuit' : 'Circuit'}</span>
        <div role="radiogroup" aria-label="Circuit" className="grid grid-cols-4 gap-2">
          {picks.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={first === p.id}
              aria-label={p.name}
              onClick={() => onChange({ ...options, track: p.id })}
              className={`rounded-card border-[3px] border-ink px-1 py-2 text-3xl shadow-sticker-sm ${first === p.id ? 'bg-sun' : 'bg-surface'}`}
            >
              {p.emoji}
            </button>
          ))}
        </div>
        <p className="text-sm text-muted">
          {first < 0
            ? cup ? 'Trois circuits tirés au sort, à la suite.' : 'Un circuit tiré au sort.'
            : cup
              ? `${[0, 1, 2].map((k) => TRACKS[(first + k) % TRACKS.length].name).join(' → ')}`
              : TRACKS[first].name}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <span className="font-display text-lg font-extrabold">Format</span>
        <SegmentedControl
          ariaLabel="Format"
          value={String(o.races)}
          onChange={(v) => onChange({ ...options, races: Number(v) })}
          options={[{ value: '3', label: 'Coupe (3 courses)' }, { value: '1', label: '1 course' }]}
        />
      </div>
      <div className="flex flex-col gap-2">
        <span className="font-display text-lg font-extrabold">Tours par course</span>
        <SegmentedControl
          ariaLabel="Tours par course"
          value={String(o.laps)}
          onChange={(v) => onChange({ ...options, laps: Number(v) })}
          options={[{ value: '2', label: '2 tours' }, { value: '3', label: '3 tours' }]}
        />
      </div>
      <div className="flex flex-col gap-2">
        <span className="font-display text-lg font-extrabold">Bots</span>
        <SegmentedControl
          ariaLabel="Compléter avec des bots"
          value={String(o.fill)}
          onChange={(v) => onChange({ ...options, fill: Number(v) })}
          options={FILLS.map((n) => ({ value: String(n), label: n ? `${n} karts` : 'Aucun' }))}
        />
        <p className="text-sm text-muted">
          {bots ? `${bots} bot${bots > 1 ? 's' : ''} complète${bots > 1 ? 'nt' : ''} la grille (conduits par le téléphone de l'hôte).` : 'Que des vrais pilotes.'}
        </p>
      </div>
    </div>
  )
}
