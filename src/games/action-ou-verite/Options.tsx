import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Toggle } from '@/components/ui/Toggle'
import { fx } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import type { GameOptionsProps } from '../types'
import type { AovLevel } from './types'
import { AOV_LEVELS, AOV_ROUND_CHOICES, readOptions, roundsLabel } from './setup'

function Label({ children }: { children: ReactNode }) {
  return <span className="font-display text-lg font-extrabold">{children}</span>
}

export function ActionVeriteOptions({ options, onChange }: GameOptionsProps) {
  const o = readOptions(options)
  const set = (patch: Record<string, unknown>) => onChange({ ...options, ...o, ...patch })

  const toggleLevel = (id: AovLevel) => {
    fx.pop()
    const next = o.levels.includes(id) ? o.levels.filter((l) => l !== id) : [...o.levels, id].sort()
    // Au moins un niveau.
    if (next.length) set({ levels: next })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label>Nombre de tours</Label>
        <SegmentedControl
          ariaLabel="Nombre de tours"
          value={String(o.rounds)}
          onChange={(v) => set({ rounds: Number(v) })}
          options={AOV_ROUND_CHOICES.map((n) => ({ value: String(n), label: roundsLabel(n) }))}
        />
        {o.rounds === 0 && <span className="text-sm text-muted">∞ : on joue jusqu’à ce que l’hôte arrête.</span>}
      </div>

      <div className="flex flex-col gap-2">
        <Label>Niveaux des cartes</Label>
        <div className="grid grid-cols-3 gap-2">
          {AOV_LEVELS.map((l) => {
            const on = o.levels.includes(l.id)
            return (
              <motion.button
                key={l.id}
                type="button"
                whileTap={{ scale: 0.85, rotate: -4 }}
                animate={{ scale: on ? 1 : 0.94 }}
                transition={{ type: 'spring', stiffness: 500, damping: 15 }}
                onClick={() => toggleLevel(l.id)}
                aria-pressed={on}
                className={cn(
                  'flex flex-col items-center rounded-card border-[3px] border-ink px-2 py-2 font-display font-extrabold shadow-sticker-sm transition-colors',
                  on ? 'text-[#1f1b2e]' : 'bg-sunk text-muted opacity-60 shadow-none',
                )}
                style={on ? { backgroundColor: l.color } : undefined}
              >
                <span className="text-2xl">{l.emoji}</span>
                <span className="text-base">{l.label}</span>
                <span className="text-[11px] leading-tight font-bold opacity-80">{l.hint}</span>
              </motion.button>
            )
          })}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <Label>Chrono des actions ⏱️</Label>
          <span className="text-sm text-muted">Minuteur indicatif de 60 s</span>
        </div>
        <Toggle checked={o.softTimer} onChange={(v) => set({ softTimer: v })} label="Chrono des actions" />
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <Label>Enchaînement auto 🔁</Label>
          <span className="text-sm text-muted">Tour suivant 12 s après le verdict</span>
        </div>
        <Toggle checked={o.auto} onChange={(v) => set({ auto: v })} label="Enchaînement automatique" />
      </div>
    </div>
  )
}
