import { useEffect } from 'react'

interface WakeLockSentinelLike {
  release: () => Promise<void>
  released?: boolean
}
type NavigatorWithWakeLock = Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> } }

/** Garde l'écran allumé tant que `active` (réacquis au retour sur l'onglet). Sans effet si l'API manque. */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    const nav = navigator as NavigatorWithWakeLock
    if (!active || !nav.wakeLock) return
    let sentinel: WakeLockSentinelLike | null = null
    let cancelled = false
    const acquire = async () => {
      if (document.visibilityState !== 'visible' || (sentinel && !sentinel.released)) return
      try {
        const s = await nav.wakeLock!.request('screen')
        if (cancelled) void s.release().catch(() => {})
        else sentinel = s
      } catch {
        /* refusé (batterie faible…) : tant pis */
      }
    }
    void acquire()
    const onVis = () => void acquire()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVis)
      void sentinel?.release().catch(() => {})
    }
  }, [active])
}
