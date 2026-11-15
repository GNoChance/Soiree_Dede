import { SegmentedControl } from '@/components/ui/SegmentedControl'
import type { GameOptionsProps } from '../types'
import { DD_DEFAULT_OPTIONS, DD_DIFFICULTIES, DD_ROUND_CHOICES, DD_SECONDS_CHOICES } from './setup'
import type { Difficulty } from './types'

const DIFF_LABEL: Record<Difficulty, string> = { facile: 'Facile', mixte: 'Mixte', difficile: 'Difficile' }

export function DessineOptions({ options, onChange, playerCount }: GameOptionsProps) {
  const rounds = String(Number(options.rounds) || DD_DEFAULT_OPTIONS.rounds)
  const secs = String(Number(options.drawSeconds) || DD_DEFAULT_OPTIONS.drawSeconds)
  const diff = (DD_DIFFICULTIES.includes(options.difficulty as Difficulty) ? options.difficulty : DD_DEFAULT_OPTIONS.difficulty) as Difficulty
  const turns = Number(rounds) * playerCount
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="font-display text-lg font-extrabold">Chacun dessine</span>
        <SegmentedControl
          ariaLabel="Nombre de dessins par joueur"
          value={rounds}
          onChange={(v) => onChange({ ...options, rounds: Number(v) })}
          options={DD_ROUND_CHOICES.map((n) => ({ value: String(n), label: `${n}×` }))}
        />
        <p className="text-sm text-muted">
          {turns} dessin{turns > 1 ? 's' : ''} au total.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="font-display text-lg font-extrabold">Temps pour dessiner</span>
        <SegmentedControl
          ariaLabel="Temps de dessin"
          value={secs}
          onChange={(v) => onChange({ ...options, drawSeconds: Number(v) })}
          options={DD_SECONDS_CHOICES.map((n) => ({ value: String(n), label: `${n} s` }))}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="font-display text-lg font-extrabold">Mots</span>
        <SegmentedControl
          ariaLabel="Difficulté des mots"
          value={diff}
          onChange={(v) => onChange({ ...options, difficulty: v })}
          options={DD_DIFFICULTIES.map((d) => ({ value: d, label: DIFF_LABEL[d] }))}
        />
      </div>
    </div>
  )
}
