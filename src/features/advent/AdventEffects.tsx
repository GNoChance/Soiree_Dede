import { motion } from 'framer-motion'

/** Rayons dorés (soleil de papier) : une salve (ouverture d'une porte) ou en rotation continue (récompense). */
export function Rays({ size = 360, loop = false, className }: { size?: number; loop?: boolean; className?: string }) {
  const style = {
    width: size,
    height: size,
    marginLeft: -size / 2,
    marginTop: -size / 2,
    background: 'repeating-conic-gradient(from 0deg, rgba(255, 236, 130, 0.95) 0deg 9deg, rgba(255, 236, 130, 0) 9deg 24deg)',
    WebkitMaskImage: 'radial-gradient(circle, #000 6%, transparent 66%)',
    maskImage: 'radial-gradient(circle, #000 6%, transparent 66%)',
  } as const
  return loop ? (
    <motion.span
      aria-hidden
      className={'pointer-events-none absolute top-1/2 left-1/2 rounded-full ' + (className ?? '')}
      style={{ ...style, background: 'repeating-conic-gradient(from 0deg, rgba(255, 190, 40, 0.5) 0deg 9deg, rgba(255, 190, 40, 0) 9deg 24deg)', opacity: 0.9 }}
      animate={{ rotate: 360 }}
      transition={{ repeat: Infinity, duration: 16, ease: 'linear' }}
    />
  ) : (
    <motion.span
      aria-hidden
      className={'pointer-events-none absolute top-1/2 left-1/2 rounded-full ' + (className ?? '')}
      style={style}
      initial={{ opacity: 0, scale: 0.15, rotate: 0 }}
      animate={{ opacity: [0, 1, 1, 0], scale: [0.15, 1, 1.12, 1.3], rotate: 55 }}
      transition={{ duration: 1.8, times: [0, 0.16, 0.7, 1], ease: 'easeOut' }}
    />
  )
}

const SPARKS = ['✨', '⭐', '✨', '🌟', '✨', '⭐', '✨', '🌟', '✨', '⭐']

/** Étincelles qui partent en étoile autour de la porte. */
export function Sparks({ radius = 110 }: { radius?: number }) {
  return (
    <>
      {SPARKS.map((s, i) => {
        const a = (i / SPARKS.length) * Math.PI * 2 + 0.3
        const r = radius * (0.7 + ((i * 37) % 10) / 22)
        return (
          <motion.span
            key={i}
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-1/2 text-xl leading-none"
            style={{ marginLeft: '-0.5em', marginTop: '-0.5em' }}
            initial={{ x: 0, y: 0, scale: 0, opacity: 0 }}
            animate={{ x: Math.cos(a) * r, y: Math.sin(a) * r, scale: [0, 1.5, 0.9, 0], opacity: [0, 1, 1, 0], rotate: (i % 2 ? 1 : -1) * 120 }}
            transition={{ duration: 1.3, delay: 0.25 + i * 0.03, ease: 'easeOut' }}
          >
            {s}
          </motion.span>
        )
      })}
    </>
  )
}
