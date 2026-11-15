import { useId, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/cn'
import { fx } from '@/lib/feedback'

export interface SegmentOption<T extends string> {
  value: T
  label: ReactNode
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[]
  value: T
  onChange: (v: T) => void
  className?: string
  ariaLabel?: string
}

/** Onglets / choix segmente avec pastille animee (layoutId). Export aussi sous le nom `Tabs`. */
export function SegmentedControl<T extends string>({ options, value, onChange, className, ariaLabel }: SegmentedControlProps<T>) {
  const id = useId()
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn('sticker relative flex gap-1 rounded-bubble bg-sunk p-1', className)}
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => {
              if (!active) {
                fx.tick()
                onChange(o.value)
              }
            }}
            className={cn(
              'relative flex-1 rounded-card px-3 py-2 text-base font-extrabold transition-colors',
              active ? 'text-[#1f1b2e]' : 'text-muted',
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 rounded-card border-2 border-ink bg-sun shadow-sticker-sm"
                transition={{ type: 'spring', stiffness: 500, damping: 28 }}
              />
            )}
            <span className="relative z-10 flex items-center justify-center gap-1.5">{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export const Tabs = SegmentedControl
