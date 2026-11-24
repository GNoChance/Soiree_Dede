import { useEffect, useRef } from 'react'
import { playSound } from '@/lib/feedback'

/** Tic-tac stressant sur les 5 dernières secondes d'un chrono (un son par seconde, plus grave sur la dernière). */
export function useUrgentTicks(secs: number, active = true) {
  const last = useRef<number | null>(null)
  useEffect(() => {
    if (!active || secs < 1 || secs > 5) {
      last.current = null
      return
    }
    if (last.current === secs) return
    last.current = secs
    playSound(secs === 1 ? 'clock_last' : 'clock')
  }, [secs, active])
}
