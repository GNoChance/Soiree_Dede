import { useState } from 'react'
import { chibiUrl, getCharacter } from '@/data/characters'
import { cn } from '@/lib/cn'

export interface ChibiImageProps {
  slug: string
  expression?: string
  tenue?: string
  /** Taille en px (carre) */
  size?: number
  className?: string
  alt?: string
  /** Fallback minimal (juste l'initiale, sans disque colore) - utilise par Avatar */
  bare?: boolean
}

/** Image du chibi `/chibis/<slug>/<tenue>/<expression>.webp` ; fallback = rond colore + initiale. */
export function ChibiImage({ slug, expression = 'joie', tenue = 'default', size = 96, className, alt, bare }: ChibiImageProps) {
  const src = chibiUrl(slug, expression, tenue)
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const char = getCharacter(slug)
  const failed = failedSrc === src

  if (failed) {
    const initial = (char?.nickname ?? slug).charAt(0).toUpperCase()
    return (
      <div
        role="img"
        aria-label={alt ?? char?.nickname ?? slug}
        className={cn(
          'inline-flex shrink-0 items-center justify-center font-display font-extrabold text-[#1f1b2e]',
          !bare && 'rounded-full border-[3px] border-ink',
          className,
        )}
        style={{ width: size, height: size, fontSize: size * 0.5, backgroundColor: bare ? undefined : (char?.color ?? '#FFB703') }}
      >
        {initial}
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={alt ?? char?.nickname ?? slug}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailedSrc(src)}
      className={cn('shrink-0 object-contain', className)}
      style={{ width: size, height: size }}
    />
  )
}
