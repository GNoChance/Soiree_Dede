import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Toggle } from '@/components/ui/Toggle'
import { fx } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import type { GameOptionsProps } from '../types'
import type { DilemmaTheme } from './dilemmas'
import { TP_ROUND_CHOICES, TP_THEMES, TP_TIMER_CHOICES, readOptions } from './setup'

function Label({ children }: { children: ReactNode }) {
  return <span className="font-display text-lg font-extrabold">{children}</span>
}

export function TuPreferesOptions({ options, onChange }: GameOptionsProps) {
  const o = readOptions(options)
  const set = (patch: Record<string, unknown>) => onChange({ ...options, ...o, ...patch })
  const all = o.themes.length === 0

  const toggleTheme = (id: DilemmaTheme) => {
    fx.pop()
    const cur = all ? TP_THEMES.map((t) => t.id) : o.themes
    const next = cur.includes(id) ? cur.filter((t) => t !== id) : [...cur, id]
    // Aucun ou tous cochés = « tous les thèmes ».
    set({ themes: next.length === 0 || next.length === TP_THEMES.length ? [] : next })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label>Nombre de dilemmes</Label>
        <SegmentedControl
          ariaLabel="Nombre de dilemmes"
          value={String(o.rounds)}
          onChange={(v) => set({ rounds: Number(v) })}
          options={TP_ROUND_CHOICES.map((n) => ({ value: String(n), label: String(n) }))}
        />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label>Thèmes</Label>
          <button
            type="button"
            onClick={() => {
              fx.tick()
              set({ themes: [] })
            }}
            className={cn('rounded-full border-2 border-ink px-3 py-0.5 font-display text-sm font-extrabold', all ? 'bg-sun text-[#1f1b2e]' : 'bg-surface')}
          >
            Tous
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {TP_THEMES.map((t) => {
            const on = all || o.themes.includes(t.id)
            return (
              <motion.button
                key={t.id}
                type="button"
                whileTap={{ scale: 0.85, rotate: -4 }}
                animate={{ scale: on ? 1 : 0.94 }}
                transition={{ type: 'spring', stiffness: 500, damping: 15 }}
                onClick={() => toggleTheme(t.id)}
                aria-pressed={on}
                className={cn(
                  'flex items-center gap-1 rounded-full border-2 border-ink px-3 py-1 font-display text-sm font-extrabold shadow-sticker-sm transition-colors',
                  on ? 'text-[#1f1b2e]' : 'bg-sunk text-muted opacity-60 shadow-none',
                )}
                style={on ? { backgroundColor: t.color } : undefined}
              >
                <span>{t.emoji}</span>
                {t.label}
              </motion.button>
            )
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Temps pour répondre</Label>
        <SegmentedControl
          ariaLabel="Temps pour répondre"
          value={String(o.timer)}
          onChange={(v) => set({ timer: Number(v) })}
          options={TP_TIMER_CHOICES.map((n) => ({ value: String(n), label: `${n} s` }))}
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <Label>Bonus Rebelle 🤘</Label>
          <span className="text-sm text-muted">+1 pour le seul joueur de son avis</span>
        </div>
        <Toggle checked={o.rebel} onChange={(v) => set({ rebel: v })} label="Bonus Rebelle" />
      </div>
    </div>
  )
}
