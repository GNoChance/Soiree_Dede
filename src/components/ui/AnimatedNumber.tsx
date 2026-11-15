import { useEffect, useRef } from 'react'
import { animate, useMotionValue, useReducedMotion } from 'framer-motion'

/** Compteur qui défile vers `value`. */
export function AnimatedNumber({ value, className, duration = 0.9 }: { value: number; className?: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const mv = useMotionValue(0)
  const reduce = useReducedMotion()
  useEffect(() => {
    const unsub = mv.on('change', (v) => {
      if (ref.current) ref.current.textContent = Math.round(v).toLocaleString('fr-FR')
    })
    const controls = animate(mv, value, reduce ? { duration: 0 } : { duration, ease: 'easeOut' })
    return () => {
      unsub()
      controls.stop()
    }
  }, [value, mv, duration, reduce])
  return <span ref={ref} className={className}>{value.toLocaleString('fr-FR')}</span>
}
