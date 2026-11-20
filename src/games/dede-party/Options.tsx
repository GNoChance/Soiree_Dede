import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { cn } from '@/lib/cn'
import type { GameOptionsProps } from '../types'
import { BOARDS, MAP_IDS } from './board'
import { BoardThumb } from './BoardThumb'
import { DP_DURATION, DP_ROUNDS, normalizeOptions, type DpMapChoice } from './setup'

/** Options (hôte) : plateau (défaut « Au hasard »), durée de l'émission + rappel du mode télé. */
export function DedePartyOptions({ options, onChange }: GameOptionsProps) {
  const o = normalizeOptions(options)
  const pick = (map: DpMapChoice) => onChange({ ...options, map })
  const card = (selected: boolean) =>
    cn(
      'flex min-h-[72px] flex-col items-start gap-1 rounded-card border-[3px] border-ink px-2.5 py-2 text-left leading-tight transition-transform active:scale-95',
      selected ? 'bg-sun text-[#1f1b2e] shadow-sticker' : 'bg-surface shadow-sticker-sm',
    )
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="font-display text-lg font-extrabold">Plateau</span>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Plateau">
          {MAP_IDS.map((id) => {
            const b = BOARDS[id]
            const on = o.map === id
            return (
              <button key={id} type="button" role="radio" aria-checked={on} className={card(on)} onClick={() => pick(id)}>
                <span className="flex w-full items-center gap-1.5">
                  <span className="text-2xl leading-none">{b.emoji}</span>
                  <span className="min-w-0 flex-1 font-display text-base font-extrabold">{b.name}</span>
                </span>
                <BoardThumb board={b} className="h-10 w-auto self-center" />
                <span className={cn('text-xs font-bold', on ? 'opacity-80' : 'text-muted')}>{b.pitch}</span>
              </button>
            )
          })}
          <button type="button" role="radio" aria-checked={o.map === 'random'} className={card(o.map === 'random')} onClick={() => pick('random')}>
            <span className="flex w-full items-center gap-1.5">
              <span className="text-2xl leading-none">🎲</span>
              <span className="font-display text-base font-extrabold">Au hasard</span>
            </span>
            <span className="self-center text-2xl leading-none" aria-hidden>
              {MAP_IDS.map((id) => BOARDS[id].emoji).join('')}
            </span>
            <span className={cn('text-xs font-bold', o.map === 'random' ? 'opacity-80' : 'text-muted')}>Surprise : l’un des 5, jamais le même que la dernière fois.</span>
          </button>
        </div>
      </div>
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
