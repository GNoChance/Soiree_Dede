import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { CustomCardsOption } from '@/features/cartes/CustomCardsOption'
import type { GameOptionsProps } from '../types'
import { QDN_DEFAULT_OPTIONS, QDN_ROUND_CHOICES } from './setup'

export function QuiDeNousOptions({ options, onChange }: GameOptionsProps) {
  const rounds = String(Number(options.rounds) || QDN_DEFAULT_OPTIONS.rounds)
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="font-display text-lg font-extrabold">Nombre de questions</span>
        <SegmentedControl
          ariaLabel="Nombre de questions"
          value={rounds}
          onChange={(v) => onChange({ ...options, rounds: Number(v) })}
          options={QDN_ROUND_CHOICES.map((n) => ({ value: String(n), label: String(n) }))}
        />
      </div>
      <CustomCardsOption game="qui-de-nous" checked={options.customCards !== false} onChange={(v) => onChange({ ...options, customCards: v })} />
    </div>
  )
}
