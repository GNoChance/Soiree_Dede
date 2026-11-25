import { cn } from '@/lib/cn'

/** Pseudo-aléatoire stable (même neige à chaque rendu, pas de saut). */
const rnd = (i: number, k: number) => {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453
  return x - Math.floor(x)
}

/**
 * Neige qui tombe dans son conteneur (qui doit être positionné). Purement décoratif, sans clic.
 * size : taille des flocons en px ; duration : secondes moyennes de chute ; fixed : tout l'écran (fond de page).
 */
export function SnowLayer({ count = 12, size = 14, duration = 7, fixed, className }: { count?: number; size?: number; duration?: number; fixed?: boolean; className?: string }) {
  return (
    <div aria-hidden className={cn('snow-layer pointer-events-none inset-0 overflow-hidden', fixed ? 'fixed' : 'absolute', className)}>
      {Array.from({ length: count }, (_, i) => {
        const d = duration * (0.75 + rnd(i, 1) * 0.6)
        return (
          <span
            key={i}
            className="snow-flake"
            style={
              {
                '--x': `${Math.round(rnd(i, 2) * 92)}%`,
                '--y': `${Math.round(8 + rnd(i, 3) * 80)}%`,
                '--d': `${d.toFixed(2)}s`,
                '--delay': `${(-rnd(i, 4) * d).toFixed(2)}s`,
                '--sway': `${Math.round((rnd(i, 5) - 0.5) * size * 2.4)}px`,
                fontSize: Math.round(size * (0.7 + rnd(i, 6) * 0.6)),
              } as React.CSSProperties
            }
          >
            ❄
          </span>
        )
      })}
    </div>
  )
}
