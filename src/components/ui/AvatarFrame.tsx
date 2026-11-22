import { motion, useReducedMotion } from 'framer-motion'
import type { FrameStyle } from '@/data/cadeaux'

/**
 * Cadre d'avatar (cadeau déco) : anneau derrière le disque de l'avatar + décorations autour.
 * À poser dans le conteneur `relative` de l'avatar ; `size` = diamètre du disque.
 * Sous 36 px, seul l'anneau est dessiné (lisibilité).
 */
export function AvatarFrame({ frame, size }: { frame: FrameStyle; size: number }) {
  const reduce = useReducedMotion()
  const ringW = Math.max(3, Math.round(size * 0.11))
  const count = frame.count ?? 0
  const small = size < 36
  const r = size / 2 + ringW / 2
  const items = small ? [] : Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2 + Math.PI / 4
    return { i, x: size / 2 + Math.cos(a) * r, y: size / 2 + Math.sin(a) * r }
  })
  const emojiSize = Math.max(10, size * 0.22)
  const dotSize = Math.max(4, size * 0.09 * (frame.dotScale ?? 1))
  return (
    <>
      <motion.span
        aria-hidden
        className="pointer-events-none absolute -z-10 rounded-full border-2 border-ink"
        style={{ inset: -ringW, background: frame.ring }}
        animate={frame.spin && !reduce ? { rotate: 360 } : undefined}
        transition={frame.spin ? { repeat: Infinity, duration: 8, ease: 'linear' } : undefined}
      />
      {items.map(({ i, x, y }) =>
        frame.dots ? (
          <span
            key={i}
            aria-hidden
            className="pointer-events-none absolute z-10 rounded-full border border-ink"
            style={{ width: dotSize, height: dotSize, left: x - dotSize / 2, top: y - dotSize / 2, background: frame.dots[i % frame.dots.length] }}
          />
        ) : frame.emojis ? (
          <span
            key={i}
            aria-hidden
            className="pointer-events-none absolute z-10 leading-none"
            style={{ fontSize: emojiSize, left: x, top: y, transform: 'translate(-50%, -50%)' }}
          >
            {frame.emojis[i % frame.emojis.length]}
          </span>
        ) : null,
      )}
      {frame.top && !small && (
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 z-10 leading-none"
          style={{ fontSize: Math.max(12, size * 0.28), top: -ringW, transform: 'translate(-50%, -55%)' }}
        >
          {frame.top}
        </span>
      )}
    </>
  )
}
