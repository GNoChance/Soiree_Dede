import { useEffect, useRef } from 'react'

/** Appelle `fn` quand l'onglet redevient visible / la fenêtre reprend le focus. */
export function useRefetchOnFocus(fn: () => void) {
  const ref = useRef(fn)
  useEffect(() => {
    ref.current = fn
  })
  useEffect(() => {
    const h = () => {
      if (document.visibilityState === 'visible') ref.current()
    }
    document.addEventListener('visibilitychange', h)
    window.addEventListener('focus', h)
    return () => {
      document.removeEventListener('visibilitychange', h)
      window.removeEventListener('focus', h)
    }
  }, [])
}
