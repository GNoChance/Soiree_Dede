import { useEffect } from 'react'
import { useCountdown } from '@/features/soiree/useServerClock'
import type { GamePlayProps } from '../types'
import { mgActions, type MiniGolfState } from './types'

/** Échéance (chrono du trou, fin du classement) : un tick idempotent, ré-essayé tant que rien ne bouge. */
export function useDeadlineTick(s: MiniGolfState, act: GamePlayProps['act'], enabled: boolean) {
  const live = s.phase === 'playing' || s.phase === 'hole_end'
  const left = useCountdown(live ? s.deadline : null)
  const timeUp = enabled && live && Boolean(s.deadline) && left <= 0
  useEffect(() => {
    if (!timeUp) return
    let t = 0
    let cancelled = false
    const send = async () => {
      if (cancelled) return
      await act(mgActions.tick())
      if (!cancelled) t = window.setTimeout(() => void send(), 2500)
    }
    t = window.setTimeout(() => void send(), 150 + Math.random() * 600)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [timeUp, act, s.deadline])
  return left
}

export const fmtClock = (ms: number) => {
  const sec = Math.ceil(ms / 1000)
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}
