import { motion } from 'framer-motion'
import { cn } from '@/lib/cn'
import { fx } from '@/lib/feedback'

export interface ToggleProps {
  checked: boolean
  onChange: (v: boolean) => void
  label?: string
}

export function Toggle({ checked, onChange, label }: ToggleProps) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => {
        onChange(!checked)
        fx.pop()
      }}
      className={cn(
        'flex h-9 w-16 shrink-0 items-center rounded-full border-[3px] border-ink p-0.5 shadow-sticker-sm transition-colors',
        checked ? 'bg-mint justify-end' : 'bg-sunk justify-start',
      )}
    >
      <motion.span
        layout
        transition={{ type: 'spring', stiffness: 700, damping: 22 }}
        className="size-6 rounded-full border-2 border-ink bg-surface"
      />
    </button>
  )
}
