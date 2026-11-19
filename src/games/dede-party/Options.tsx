import { SegmentedControl } from '@/components/ui/SegmentedControl'
import type { GameOptionsProps } from '../types'
import { DP_DURATION, DP_ROUNDS, normalizeOptions } from './setup'

/** Options (hôte) : durée de l'émission + rappel du mode télé. */
export function DedePartyOptions({ options, onChange }: GameOptionsProps) {
  const o = normalizeOptions(options)
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="font-display text-lg font-extrabold">Durée</span>
        <SegmentedControl
          ariaLabel="Durée"
          value={String(o.rounds)}
          onChange={(v) => onChange({ ...options, rounds: Number(v) })}
          options={DP_ROUNDS.map((r) => ({ value: String(r), label: DP_DURATION[r].label }))}
        />
        <p className="text-sm text-muted">
          {o.rounds} tours ({DP_DURATION[o.rounds].minutes}) : un lancer de dé et un mini-jeu à chaque tour. Le plus d’étoiles gagne !
        </p>
      </div>
      <div className="sticker-sm flex items-center gap-3 bg-sky/20 px-3 py-2">
        <span className="text-3xl">📺</span>
        <p className="text-sm font-bold leading-tight">Mets la télé pour le plateau en grand : bouton « Mode télé » une fois la partie lancée. Sans télé, chaque téléphone montre aussi le plateau.</p>
      </div>
    </div>
  )
}
