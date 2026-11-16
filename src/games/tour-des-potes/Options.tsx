import { SegmentedControl } from '@/components/ui/SegmentedControl'
import type { GameOptionsProps } from '../types'
import { normalizeOptions } from './rules'

export function TourDesPotesOptions({ options, onChange, playerCount }: GameOptionsProps) {
  const o = normalizeOptions(options)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <span className="font-display text-lg font-extrabold">Format de partie 🏙️</span>
        <SegmentedControl
          ariaLabel="Format de partie"
          value={o.format}
          onChange={(v) => onChange({ ...options, format: v })}
          options={[
            { value: 'chrono', label: '⏳ Chrono' },
            { value: 'tours', label: '🔁 Tours' },
            { value: 'classique', label: '👑 Classique' },
          ]}
        />
        {o.format === 'chrono' && (
          <SegmentedControl
            ariaLabel="Durée"
            value={String(o.minutes) as '30' | '45' | '60'}
            onChange={(v) => onChange({ ...options, minutes: Number(v) })}
            options={[
              { value: '30', label: '30 min' },
              { value: '45', label: '45 min' },
              { value: '60', label: '1 h' },
            ]}
          />
        )}
        {o.format === 'tours' && (
          <SegmentedControl
            ariaLabel="Nombre de tours"
            value={String(o.rounds) as '10' | '15' | '20'}
            onChange={(v) => onChange({ ...options, rounds: Number(v) })}
            options={[
              { value: '10', label: '10 tours' },
              { value: '15', label: '15 tours' },
              { value: '20', label: '20 tours' },
            ]}
          />
        )}
        <p className="text-sm leading-snug text-muted">
          {o.format === 'chrono' && 'À la fin du temps, on termine le tour en cours : le plus riche gagne.'}
          {o.format === 'tours' && 'Après ce nombre de tours de table, le plus riche gagne.'}
          {o.format === 'classique' && 'Jusqu’à ce qu’il ne reste qu’un joueur (3 h maximum). Prévois du temps !'}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <span className="font-display text-lg font-extrabold">Temps par décision ⏱️</span>
        <SegmentedControl
          ariaLabel="Temps par décision"
          value={String(o.turn_seconds) as '0' | '30' | '45' | '60' | '90'}
          onChange={(v) => onChange({ ...options, turn_seconds: Number(v) })}
          options={[
            { value: '30', label: '30 s' },
            { value: '45', label: '45 s' },
            { value: '60', label: '60 s' },
            { value: '90', label: '90 s' },
            { value: '0', label: '∞' },
          ]}
        />
        <p className="text-sm leading-snug text-muted">
          Trop lent ? Le jeu lance les dés, passe l’achat ou finit le tour à ta place.
          {playerCount >= 6 && o.turn_seconds === 0 && ' À beaucoup, un minuteur est conseillé !'}
        </p>
      </div>
    </div>
  )
}
