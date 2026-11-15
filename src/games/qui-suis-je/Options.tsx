import { motion } from 'framer-motion'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { fx } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import type { GameOptionsProps } from '../types'
import { CARDS_PER_TURN, QSJ_DIFFICULTIES, QSJ_ROUND_CHOICES, QSJ_SECONDS_CHOICES, QSJ_THEMES, readOptions } from './setup'
import type { QsjDifficulty } from './types'

const DIFF_LABEL: Record<QsjDifficulty, string> = { facile: 'Facile', mixte: 'Mixte', difficile: 'Difficile' }

export function QuiSuisJeOptions({ options, onChange, playerCount }: GameOptionsProps) {
  const o = readOptions(options)
  const set = (patch: Record<string, unknown>) => onChange({ ...options, ...o, ...patch })
  const turns = o.rounds * playerCount
  const toggleTheme = (id: string) => {
    const on = o.themes.includes(id)
    if (on && o.themes.length === 1) return // au moins un thème
    fx.tick()
    set({ themes: on ? o.themes.filter((t) => t !== id) : [...o.themes, id] })
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="font-display text-lg font-extrabold">Chacun devine</span>
        <SegmentedControl
          ariaLabel="Nombre de passages par joueur"
          value={String(o.rounds)}
          onChange={(v) => set({ rounds: Number(v) })}
          options={QSJ_ROUND_CHOICES.map((n) => ({ value: String(n), label: n === 1 ? '1 fois' : '2 fois' }))}
        />
        <p className="text-sm text-muted">
          {turns} tour{turns > 1 ? 's' : ''} au total.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="font-display text-lg font-extrabold">Temps par tour</span>
        <SegmentedControl
          ariaLabel="Temps par tour"
          value={String(o.turnSeconds)}
          onChange={(v) => set({ turnSeconds: Number(v) })}
          options={QSJ_SECONDS_CHOICES.map((n) => ({ value: String(n), label: `${n} s` }))}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="font-display text-lg font-extrabold">Cartes</span>
        <SegmentedControl
          ariaLabel="Difficulté des cartes"
          value={o.difficulty}
          onChange={(v) => set({ difficulty: v })}
          options={QSJ_DIFFICULTIES.map((d) => ({ value: d, label: DIFF_LABEL[d] }))}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="font-display text-lg font-extrabold">Thèmes</span>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Thèmes des cartes">
          {QSJ_THEMES.map((t) => {
            const on = o.themes.includes(t.id)
            return (
              <motion.button
                key={t.id}
                type="button"
                aria-pressed={on}
                whileTap={{ scale: 0.9 }}
                animate={{ rotate: on ? -1.5 : 0, scale: on ? 1 : 0.97 }}
                transition={{ type: 'spring', stiffness: 500, damping: 18 }}
                onClick={() => toggleTheme(t.id)}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border-[3px] border-ink px-3 py-1.5 font-display text-base font-extrabold',
                  on ? 'bg-sun text-[#1f1b2e] shadow-sticker-sm' : 'bg-sunk text-muted',
                )}
              >
                <span aria-hidden>{t.emoji}</span>
                {t.label}
              </motion.button>
            )
          })}
        </div>
        <p className="text-sm text-muted">
          Les cartes sont tirées au hasard ({CARDS_PER_TURN} par tour), sans reprendre celles vues récemment.
        </p>
      </div>
    </div>
  )
}
