import { SegmentedControl } from '@/components/ui/SegmentedControl'
import type { GameOptionsProps } from '../types'
import { PdbCardView } from './Card'
import { PERSOS } from './rules'
import type { PersoSlug } from './types'

export function PasDeBolOptions({ options, onChange }: GameOptionsProps) {
  const mode = options.mode === 'classique' ? 'classique' : 'persos'
  return (
    <div className="flex flex-col gap-2">
      <span className="font-display text-lg font-extrabold">Paquet</span>
      <SegmentedControl
        ariaLabel="Mode de jeu"
        value={mode}
        onChange={(v) => onChange({ ...options, mode: v })}
        options={[
          { value: 'classique', label: 'Classique' },
          { value: 'persos', label: 'Persos ✨' },
        ]}
      />
      {mode === 'classique' ? (
        <p className="text-sm leading-snug text-muted">108 cartes : chiffres, +2, Inversion, Passe, Jokers et Jokers +4.</p>
      ) : (
        <>
          <p className="text-sm leading-snug text-muted">Le paquet classique + 10 cartes perso aux pouvoirs spéciaux :</p>
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
            {(Object.keys(PERSOS) as PersoSlug[]).map((slug) => (
              <div key={slug} className="flex w-16 shrink-0 flex-col items-center gap-0.5" title={`${PERSOS[slug].title} : ${PERSOS[slug].effect}`}>
                <PdbCardView card={{ id: `opt-${slug}`, kind: 'perso', perso: slug }} w={56} />
                <span className="w-full truncate text-center text-[10px] leading-tight font-bold text-muted">{PERSOS[slug].title}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
