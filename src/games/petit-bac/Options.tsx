import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { Dices } from 'lucide-react'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { fx } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import type { GameOptionsProps } from '../types'
import { CATEGORIES } from './categories'
import { PB_DEFAULT_OPTIONS, PB_DURATIONS, PB_MAX_CATS, PB_MIN_CATS, PB_ROUNDS, formatDuration, randomCategories, validChoice } from './setup'

export function PetitBacOptions({ options, onChange }: GameOptionsProps) {
  const chosen = validChoice(CATEGORIES, options.categories)
  const duration = String(Number(options.duration) || PB_DEFAULT_OPTIONS.duration)
  const rounds = String(Number(options.rounds) || PB_DEFAULT_OPTIONS.rounds)

  // Premier affichage : une sélection au hasard toute prête.
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current || !CATEGORIES.length) return
    seeded.current = true
    if (validChoice(CATEGORIES, options.categories).length === 0) {
      onChange({ ...PB_DEFAULT_OPTIONS, ...options, categories: randomCategories(CATEGORIES, PB_MIN_CATS) })
    }
  }, [options, onChange])

  const toggle = (id: string) => {
    const on = chosen.includes(id)
    if (!on && chosen.length >= PB_MAX_CATS) {
      fx.fail()
      return
    }
    fx.tick()
    onChange({ ...options, categories: on ? chosen.filter((c) => c !== id) : [...chosen, id] })
  }

  const shuffle = () => {
    fx.whoosh()
    onChange({ ...options, categories: randomCategories(CATEGORIES, PB_MIN_CATS + Math.floor(Math.random() * 3)) })
  }

  const enough = chosen.length >= PB_MIN_CATS

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="font-display text-lg font-extrabold">
            Catégories{' '}
            <motion.span key={chosen.length} initial={{ scale: 1.8 }} animate={{ scale: 1 }} className={cn('inline-block', enough ? 'text-mint' : 'text-tomato')}>
              {chosen.length}
            </motion.span>
            /{PB_MAX_CATS}
          </span>
          <motion.button
            type="button"
            whileTap={{ scale: 0.9, rotate: -20 }}
            onClick={shuffle}
            className="sticker-sm flex items-center gap-1.5 bg-sun px-3 py-1.5 font-display font-extrabold text-[#1f1b2e]"
          >
            <Dices className="size-5" /> Au hasard
          </motion.button>
        </div>
        {!CATEGORIES.length ? (
          <p className="text-sm text-muted">La banque de catégories est vide : des catégories seront tirées au lancement.</p>
        ) : (
          <>
            <p className="text-sm text-muted">
              Choisis {PB_MIN_CATS} à {PB_MAX_CATS} catégories{!enough ? ` (il en manque ${PB_MIN_CATS - chosen.length} : complétées au hasard au lancement)` : '.'}
            </p>
            <div className="flex max-h-64 flex-wrap gap-1.5 overflow-y-auto p-1">
              {CATEGORIES.map((c) => {
                const on = chosen.includes(c.id)
                return (
                  <motion.button
                    key={c.id}
                    type="button"
                    layout
                    whileTap={{ scale: 0.88 }}
                    animate={{ scale: on ? 1.04 : 1, rotate: on ? -1.5 : 0 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 18 }}
                    onClick={() => toggle(c.id)}
                    aria-pressed={on}
                    className={cn(
                      'flex items-center gap-1 rounded-full border-2 border-ink px-2.5 py-1 text-sm font-bold',
                      on ? 'bg-mint text-[#1f1b2e] shadow-sticker-sm' : 'bg-surface opacity-75',
                    )}
                  >
                    <span>{c.emoji}</span>
                    {c.label}
                  </motion.button>
                )
              })}
            </div>
          </>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="font-display text-lg font-extrabold">Temps par manche</span>
        <SegmentedControl
          ariaLabel="Temps par manche"
          value={duration}
          onChange={(v) => onChange({ ...options, duration: Number(v) })}
          options={PB_DURATIONS.map((d) => ({ value: String(d), label: formatDuration(d) }))}
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className="font-display text-lg font-extrabold">Nombre de manches</span>
        <SegmentedControl
          ariaLabel="Nombre de manches"
          value={rounds}
          onChange={(v) => onChange({ ...options, rounds: Number(v) })}
          options={PB_ROUNDS.map((n) => ({ value: String(n), label: String(n) }))}
        />
      </div>
    </div>
  )
}
