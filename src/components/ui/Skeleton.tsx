import { cn } from '@/lib/cn'

export interface SkeletonProps {
  className?: string
  /** Disque (avatars) */
  circle?: boolean
}

/** Placeholder de chargement : a dimensionner via className (ex: "h-6 w-32"). */
export function Skeleton({ className, circle }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={cn(
        'animate-shimmer border-2 border-ink/40 bg-sunk',
        circle ? 'rounded-full' : 'rounded-chip',
        className,
      )}
    />
  )
}
