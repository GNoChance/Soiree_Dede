import { cn } from '@/lib/cn'
import { levelStars } from './level'

/**
 * Jauge du bot : 5 étoiles, demi-étoiles comprises (niveau 1 → ½, niveau 10 → 5).
 * `onColor` : posée sur un fond coloré fixe (carte de fin) → contours sombres dans les deux thèmes.
 */
export function LevelGauge({ level, size = 22, onColor = false, className }: { level: number; size?: number; onColor?: boolean; className?: string }) {
  const stars = levelStars(level)
  const empty = onColor ? 'text-[#1f1b2e]/15 [-webkit-text-stroke:1.5px_#1f1b2e]' : 'text-muted/25 [-webkit-text-stroke:1.5px_var(--muted)]'
  return (
    <span
      className={cn('inline-flex items-center gap-0.5 leading-none', className)}
      role="img"
      aria-label={`Niveau du bot : ${String(stars).replace('.', ',')} étoile${stars > 1 ? 's' : ''} sur 5`}
    >
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.max(0, Math.min(1, stars - i))
        return (
          <span key={i} aria-hidden className="relative inline-block" style={{ width: size, height: size, fontSize: size }}>
            <span className={cn('absolute inset-0 leading-none', empty)}>★</span>
            <span className="absolute inset-0 overflow-hidden leading-none text-sun [-webkit-text-stroke:1.5px_#1f1b2e]" style={{ width: `${fill * 100}%` }}>
              ★
            </span>
          </span>
        )
      })}
    </span>
  )
}
