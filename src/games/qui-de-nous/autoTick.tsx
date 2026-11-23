import { useEffect } from 'react'
import { serverNow, useCountdown } from '@/features/soiree/useServerClock'

/**
 * Envoie `tickAction` quand l'échéance (ISO, horloge serveur) est passée, puis réessaie
 * (max 6 fois) tant que le state n'a pas changé : le serveur ignore les ticks en avance.
 * Retourne les ms restantes.
 */
export function useDeadlineTick(
  deadline: string | null | undefined,
  act: (a: { type: string }) => Promise<unknown>,
  tickAction: { type: string } = { type: 'tick' },
): number {
  const left = useCountdown(deadline)
  const expired = !!deadline && left <= 0 && new Date(deadline).getTime() <= serverNow()
  useEffect(() => {
    if (!expired) return
    let sent = 0
    const send = () => {
      if (sent++ < 6) void act(tickAction)
    }
    const first = window.setTimeout(send, 150 + Math.random() * 450)
    const retry = window.setInterval(send, 2500)
    return () => {
      clearTimeout(first)
      clearInterval(retry)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expired, deadline, act])
  return left
}

/** Petit compte à rebours lisible : « Suite dans 12 s ». */
export function NextIn({ deadline, label = 'Suite dans', className }: { deadline: string | null | undefined; label?: string; className?: string }) {
  const left = useCountdown(deadline)
  if (!deadline) return null
  return (
    <p className={className ?? 'text-center font-bold text-muted'}>
      {label} {Math.max(0, Math.ceil(left / 1000))} s
    </p>
  )
}

/** Hash stable (FNV-1a) -> [0, 1) : même valeur sur tous les téléphones. */
export function hash01(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 100000) / 100000
}
