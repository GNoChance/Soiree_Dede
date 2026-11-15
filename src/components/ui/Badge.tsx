import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export type BadgeTone = 'sun' | 'tomato' | 'mint' | 'sky' | 'grape' | 'bubblegum' | 'neutral'

const TONES: Record<BadgeTone, string> = {
  sun: 'bg-sun text-[#1f1b2e]',
  tomato: 'bg-tomato text-white',
  mint: 'bg-mint text-[#1f1b2e]',
  sky: 'bg-sky text-[#1f1b2e]',
  grape: 'bg-grape text-white',
  bubblegum: 'bg-bubblegum text-[#1f1b2e]',
  neutral: 'bg-surface text-text',
}

export interface BadgeProps {
  tone?: BadgeTone
  children: ReactNode
  className?: string
  /** Legere inclinaison facon sticker */
  tilted?: boolean
}

export function Badge({ tone = 'sun', children, className, tilted = true }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border-2 border-ink px-2.5 py-0.5 font-display text-sm font-extrabold shadow-sticker-sm',
        tilted && '-rotate-2',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
