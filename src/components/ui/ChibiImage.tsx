import { useState } from 'react'
import { chibiUrl, getCharacter } from '@/data/characters'
import { cn } from '@/lib/cn'
import { markTenueArtMissing, useTenueArt } from './tenueArt'

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
  /** Miniature 160px (listes) ; auto si size <= 100 */
  thumb?: boolean
  /** Affiche l'emoji de la tenue en coin quand elle n'a pas d'illustration (repli sur `default`). */
  tenueBadge?: boolean
}

/**
 * Image du chibi `/chibis/<slug>/<tenue>/<expression>.webp` ; fallback = rond colore + initiale.
 * Tenue sans illustration (liste générée ou onError) -> repli automatique sur `default`.
 */
export function ChibiImage({ slug, expression = 'joie', tenue, size = 96, className, alt, bare, thumb, tenueBadge }: ChibiImageProps) {
  const art = useTenueArt(slug, tenue)
  const src = chibiUrl(slug, expression, art.tenue, thumb ?? size <= 100)
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const char = getCharacter(slug)
  const failed = failedSrc === src

  let node: React.ReactNode
  if (failed) {
    const initial = (char?.nickname ?? slug).charAt(0).toUpperCase()
    node = (
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
  } else {
    node = (
      <img
        src={src}
        alt={alt ?? char?.nickname ?? slug}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => {
          if (art.tenue !== 'default') markTenueArtMissing(slug, art.tenue)
          else setFailedSrc(src)
        }}
        className={cn('shrink-0 object-contain', className)}
        style={{ width: size, height: size }}
      />
    )
  }

  if (!tenueBadge || !art.missingEmoji) return node
  return (
    <span className="relative inline-flex shrink-0">
      {node}
      <span
        aria-hidden
        className="absolute right-0 bottom-0 flex items-center justify-center rounded-full border-2 border-ink bg-surface leading-none shadow-sticker-sm"
        style={{ width: size * 0.3, height: size * 0.3, fontSize: size * 0.17 }}
      >
        {art.missingEmoji}
      </span>
    </span>
  )
}
