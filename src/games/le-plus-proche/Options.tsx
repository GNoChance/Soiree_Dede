import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { fx } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import type { GameOptionsProps } from '../types'
import type { CloseTheme } from './questions'
import { LPP_DURATION_CHOICES, LPP_ROUND_CHOICES, LPP_THEMES, readOptions } from './setup'

function Label({ children }: { children: ReactNode }) {
  return <span className="font-display text-lg font-extrabold">{children}</span>
}

export function LppOptionsPanel({ options, onChange }: GameOptionsProps) {
  const o = readOptions(options)
  const set = (patch: Record<string, unknown>) => onChange({ ...options, ...o, ...patch })
  const all = o.themes.length === 0

  const toggleTheme = (id: CloseTheme) => {
    fx.pop()
    const cur = all ? LPP_THEMES.map((t) => t.id) : o.themes
    const next = cur.includes(id) ? cur.filter((t) => t !== id) : [...cur, id]
    // Aucun ou tous cochés = « tous les thèmes ».
    set({ themes: next.length === 0 || next.length === LPP_THEMES.length ? [] : next })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label>Nombre de manches</Label>
        <SegmentedControl
          ariaLabel="Nombre de manches"
          value={String(o.rounds)}
          onChange={(v) => set({ rounds: Number(v) })}
          options={LPP_ROUND_CHOICES.map((n) => ({ value: String(n), label: String(n) }))}
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
          {LPP_THEMES.map((t) => {
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
        <Label>Difficulté</Label>
        <SegmentedControl
          ariaLabel="Difficulté"
          value={o.difficulty}
          onChange={(v) => set({ difficulty: v })}
          options={[
            { value: 'facile', label: '🐣 Facile' },
            { value: 'mixte', label: '🎲 Mixte' },
            { value: 'difficile', label: '🔥 Difficile' },
          ]}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Temps pour répondre</Label>
        <SegmentedControl
          ariaLabel="Temps pour répondre"
          value={String(o.duration)}
          onChange={(v) => set({ duration: Number(v) })}
          options={LPP_DURATION_CHOICES.map((n) => ({ value: String(n), label: `${n} s` }))}
        />
      </div>
    </div>
  )
}
