import { motion } from 'framer-motion'
import { Minus, Plus, Sparkles, Wand2 } from 'lucide-react'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Toggle } from '@/components/ui/Toggle'
import { fx } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import type { GameOptionsProps } from '../types'
import { ROLE_INFO, SPECIAL_ROLES, compositionError, fullComposition, type LgCompositionInput, type LgOptions } from './types'
import { effectiveComposition, effectiveCount, readOptions } from './setup'

export function LoupGarouOptions({ options, onChange, playerCount }: GameOptionsProps) {
  const opts = readOptions(options)
  const n = effectiveCount(playerCount, opts.host_plays)
  const { comp, auto } = effectiveComposition(opts, n)
  const full = fullComposition(comp, n)
  const set = (patch: Partial<LgOptions>) => onChange({ ...opts, ...patch })
  const setComp = (c: LgCompositionInput) => {
    if (compositionError(c, n)) {
      fx.fail()
      return
    }
    set({ composition: c })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <span className="font-display text-lg font-extrabold">{opts.host_plays ? 'L’hôte joue' : 'L’hôte est meneur 🎙️'}</span>
          <p className="text-sm leading-snug text-muted">
            {opts.host_plays ? 'La voix du conteur sort de ton téléphone, tu joues quand même.' : 'Tu racontes l’histoire et tu vois tous les rôles, sans jouer.'}
          </p>
        </div>
        <Toggle checked={!opts.host_plays} onChange={(v) => set({ host_plays: !v })} label="L’hôte est meneur" />
      </div>
      {n < 5 && <p className="rounded-chip border-2 border-ink/30 bg-sunk px-3 py-1.5 text-sm font-bold">Il faut au moins 5 joueurs (sans compter le meneur).</p>}

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="font-display text-lg font-extrabold">Composition ({Math.max(n, 0)} joueurs)</span>
          <button
            type="button"
            onClick={() => {
              fx.pop()
              set({ composition: undefined })
            }}
            className={cn('flex items-center gap-1 rounded-chip border-2 border-ink px-2 py-1 text-sm font-extrabold', auto ? 'bg-mint text-[#1f1b2e]' : 'bg-surface')}
          >
            <Wand2 className="size-4" /> {auto ? 'Suggestion' : 'Suggérer'}
          </button>
        </div>

        <div className="sticker flex items-center gap-3 bg-surface p-2">
          <span className="text-3xl">{ROLE_INFO.loup.emoji}</span>
          <span className="flex-1 font-display font-extrabold">Loups-garous</span>
          <button type="button" aria-label="Moins de loups" className="flex size-9 items-center justify-center rounded-full border-2 border-ink bg-sunk" onClick={() => setComp({ ...comp, loup: comp.loup - 1 })}>
            <Minus className="size-4" strokeWidth={3} />
          </button>
          <motion.span key={comp.loup} initial={{ scale: 1.8 }} animate={{ scale: 1 }} className="w-6 text-center font-display text-2xl font-extrabold">
            {comp.loup}
          </motion.span>
          <button type="button" aria-label="Plus de loups" className="flex size-9 items-center justify-center rounded-full border-2 border-ink bg-sunk" onClick={() => setComp({ ...comp, loup: comp.loup + 1 })}>
            <Plus className="size-4" strokeWidth={3} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {SPECIAL_ROLES.map((r) => {
            const on = comp[r] === 1
            const info = ROLE_INFO[r]
            return (
              <motion.button
                key={r}
                type="button"
                whileTap={{ scale: 0.92 }}
                onClick={() => setComp({ ...comp, [r]: on ? 0 : 1 })}
                aria-pressed={on}
                className={cn('sticker flex items-center gap-2 p-2 text-left text-[#1f1b2e] transition-opacity', !on && 'opacity-45 grayscale')}
                style={{ backgroundColor: info.color }}
              >
                <span className="text-2xl">{info.emoji}</span>
                <span className="font-display text-sm leading-tight font-extrabold">{info.label}</span>
              </motion.button>
            )
          })}
          <div className="sticker flex items-center gap-2 bg-sunk p-2">
            <span className="text-2xl">{ROLE_INFO.villageois.emoji}</span>
            <span className="font-display text-sm leading-tight font-extrabold">
              {full.villageois} villageois
            </span>
          </div>
        </div>
        <p className="flex items-center gap-1 text-xs text-muted">
          <Sparkles className="size-3.5" /> Au moins 1 loup, et moins de la moitié des joueurs. La composition est connue de tous.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <span className="font-display text-lg font-extrabold">Durée du débat</span>
        <SegmentedControl
          ariaLabel="Durée du débat"
          value={String(opts.debate_seconds)}
          onChange={(v) => set({ debate_seconds: Number(v) })}
          options={[
            { value: '120', label: '2 min' },
            { value: '180', label: '3 min' },
            { value: '300', label: '5 min' },
          ]}
        />
      </div>
    </div>
  )
}
