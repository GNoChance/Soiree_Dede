import { useEffect, type ReactNode } from 'react'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import type { GameOptionsProps } from '../types'
import { BAM_LEVEL_CHOICES, BAM_LIVES_CHOICES, readOptions } from './setup'
import { DictIndicator } from './DictIndicator'
import { preloadDictionary } from './useDictionary'

function Label({ children }: { children: ReactNode }) {
  return <span className="font-display text-lg font-extrabold">{children}</span>
}

export function BombeOptions({ options, onChange }: GameOptionsProps) {
  const o = readOptions(options)
  const set = (patch: Record<string, unknown>) => onChange({ ...options, ...o, ...patch })

  // L'hôte commence à charger le dico dès l'écran de lancement.
  useEffect(() => {
    void preloadDictionary()
  }, [])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label>Vies</Label>
        <SegmentedControl
          ariaLabel="Nombre de vies"
          value={String(o.lives)}
          onChange={(v) => set({ lives: Number(v) })}
          options={BAM_LIVES_CHOICES.map((n) => ({ value: String(n), label: '❤️'.repeat(n) }))}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label>Syllabes de départ</Label>
        <SegmentedControl
          ariaLabel="Difficulté de départ"
          value={String(o.startLevel)}
          onChange={(v) => set({ startLevel: Number(v) })}
          options={BAM_LEVEL_CHOICES.map((c) => ({ value: String(c.value), label: c.label }))}
        />
        <p className="text-sm font-bold text-muted">Ça se corse tous les 8 mots, jusqu’au niveau 5 💀</p>
      </div>
      <DictIndicator />
    </div>
  )
}
