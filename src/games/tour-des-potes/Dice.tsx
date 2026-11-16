import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { cn } from '@/lib/cn'

/** Position des points (grille 3×3, indices 0-8) pour chaque face. */
const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
}

export function DieFace({ value, size = 36, className }: { value: number; size?: number; className?: string }) {
  const on = PIPS[value] ?? []
  return (
    <div
      role="img"
      aria-label={`Dé : ${value}`}
      className={cn('grid shrink-0 grid-cols-3 grid-rows-3 rounded-[22%] border-[3px] border-ink bg-white p-[12%] shadow-sticker-sm', className)}
      style={{ width: size, height: size }}
    >
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className="flex items-center justify-center">
          {on.includes(i) && <span className="block size-[78%] rounded-full bg-[#1f1b2e]" />}
        </span>
      ))}
    </div>
  )
}

/** Dé qui culbute (faces aléatoires) tant que `rolling`, puis se pose sur `value`. */
export function Die({ value, rolling, size = 36, delay = 0 }: { value: number; rolling: boolean; size?: number; delay?: number }) {
  const reduce = useReducedMotion()
  const [face, setFace] = useState(value)
  useEffect(() => {
    if (!rolling) return
    const id = setInterval(() => setFace(1 + Math.floor(Math.random() * 6)), 75)
    return () => clearInterval(id)
  }, [rolling])
  const shown = rolling ? face : value
  return (
    <motion.div
      key={rolling ? 'roll' : `rest-${value}`}
      animate={
        rolling && !reduce
          ? { rotate: [0, 120, 240, 360], y: [0, -8, 0, -4, 0], scale: [1, 1.12, 1] }
          : { rotate: 0, y: 0, scale: 1 }
      }
      transition={rolling ? { repeat: Infinity, duration: 0.45, delay } : { type: 'spring', stiffness: 420, damping: 12 }}
    >
      <DieFace value={shown} size={size} />
    </motion.div>
  )
}
