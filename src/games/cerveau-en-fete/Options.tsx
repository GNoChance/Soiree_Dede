import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { fx } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import type { GameOptionsProps } from '../types'
import type { QuizTheme } from './questions'
import { CEF_COUNT_CHOICES, CEF_DURATION_CHOICES, CEF_THEMES, readOptions } from './setup'

function Label({ children }: { children: ReactNode }) {
  return <span className="font-display text-lg font-extrabold">{children}</span>
}

export function CerveauOptions({ options, onChange }: GameOptionsProps) {
  const o = readOptions(options)
  const set = (patch: Record<string, unknown>) => onChange({ ...options, ...o, ...patch })
  const all = o.themes.length === 0

  const toggleTheme = (id: QuizTheme) => {
    fx.pop()
    const cur = all ? CEF_THEMES.map((t) => t.id) : o.themes
    const next = cur.includes(id) ? cur.filter((t) => t !== id) : [...cur, id]
    // Aucun ou tous cochés = « tous les thèmes ».
    set({ themes: next.length === 0 || next.length === CEF_THEMES.length ? [] : next })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label>Nombre de questions</Label>
        <SegmentedControl
          ariaLabel="Nombre de questions"
          value={String(o.count)}
          onChange={(v) => set({ count: Number(v) })}
          options={CEF_COUNT_CHOICES.map((n) => ({ value: String(n), label: String(n) }))}
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
          {CEF_THEMES.map((t) => {
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
        <Label>Temps par question</Label>
        <SegmentedControl
          ariaLabel="Temps par question"
          value={String(o.duration)}
          onChange={(v) => set({ duration: Number(v) })}
          options={CEF_DURATION_CHOICES.map((n) => ({ value: String(n), label: `${n} s` }))}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Réponses</Label>
        <SegmentedControl
          ariaLabel="Format des réponses"
          value={o.format}
          onChange={(v) => set({ format: v })}
          options={[
            { value: 'mixte', label: '🔀 Mixte' },
            { value: 'tape', label: '⌨️ Tapées' },
            { value: 'qcm', label: '🔘 QCM' },
          ]}
        />
      </div>
    </div>
  )
}
