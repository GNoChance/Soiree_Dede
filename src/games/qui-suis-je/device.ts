/**
 * Accès matériel de « Qui suis-je ? » : gyroscope (DeviceOrientationEvent +
 * autorisation iOS), paysage (fullscreen +
 * screen.orientation.lock). Tout est optionnel : chaque API manquante dégrade
 * proprement (boutons de secours, message « tourne ton téléphone »).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_TILT, initialTiltState, stepTilt, type TiltGesture, type TiltState } from './tilt'

/* -------------------------------------------------------------------------- */
/* Inclinaison                                                                 */
/* -------------------------------------------------------------------------- */

type OrientationPermission = 'granted' | 'denied' | 'default'
type DOEWithPermission = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<OrientationPermission> }

const hasOrientation = () => typeof window !== 'undefined' && 'DeviceOrientationEvent' in window
/** iOS 13+ : autorisation explicite à demander dans un geste utilisateur. */
export const tiltNeedsPermission = () =>
  hasOrientation() && typeof (window.DeviceOrientationEvent as DOEWithPermission).requestPermission === 'function'

let permission: OrientationPermission = 'default'
/** Mémorisé pour la session : un capteur qui a déjà répondu évite l'attente. */
let sensorSeen = false

/** Demande l'autorisation (iOS). À appeler DANS un gestionnaire de clic. */
export async function requestTiltPermission(): Promise<boolean> {
  if (!hasOrientation()) return false
  const req = (window.DeviceOrientationEvent as DOEWithPermission).requestPermission
  if (typeof req !== 'function') {
    permission = 'granted'
    return true
  }
  try {
    permission = await req.call(window.DeviceOrientationEvent)
  } catch {
    permission = 'denied'
  }
  return permission === 'granted'
}

/**
 * - 'unsupported'      : pas d'API (boutons seulement)
 * - 'needs-permission' : iOS, bouton « Activer l'inclinaison »
 * - 'denied'           : refusé (iOS : réglages Safari)
 * - 'waiting'          : à l'écoute, aucune mesure reçue pour l'instant
 * - 'active'           : le capteur répond
 * - 'no-sensor'        : l'API existe mais rien ne remonte (ordinateur…)
 */
export type TiltStatus = 'unsupported' | 'needs-permission' | 'denied' | 'waiting' | 'active' | 'no-sensor'

const initialStatus = (): TiltStatus =>
  !hasOrientation()
    ? 'unsupported'
    : tiltNeedsPermission() && permission !== 'granted'
      ? permission === 'denied'
        ? 'denied'
        : 'needs-permission'
      : sensorSeen
        ? 'active'
        : 'waiting'

/**
 * Écoute l'inclinaison. `armKey` : changer sa valeur remet la machine à zéro
 * (il faudra repasser par la position neutre). `onGesture` n'est appelé que si
 * `detect` est vrai ; `pitch` (degrés, rafraîchi ~10 fois/s) sert à l'affichage.
 */
export function useTilt({ detect, armKey, onGesture }: { detect: boolean; armKey: string | number; onGesture: (g: TiltGesture) => void }) {
  const [status, setStatus] = useState<TiltStatus>(initialStatus)
  const [pitch, setPitch] = useState<number | null>(null)
  const machine = useRef<TiltState>(initialTiltState())
  const cb = useRef(onGesture)
  const detectRef = useRef(detect)
  useEffect(() => {
    cb.current = onGesture
    detectRef.current = detect
  })
  useEffect(() => {
    machine.current = initialTiltState()
  }, [armKey, detect])

  const listening = status === 'waiting' || status === 'active' || status === 'no-sensor'
  useEffect(() => {
    if (!listening) return
    let lastUi = 0
    let alive = true
    const onOrientation = (e: DeviceOrientationEvent) => {
      if (e.beta == null || e.gamma == null) return
      if (!sensorSeen) sensorSeen = true
      setStatus((s) => (s === 'active' ? s : 'active'))
      const t = performance.now()
      const r = stepTilt(machine.current, { t, beta: e.beta, gamma: e.gamma }, DEFAULT_TILT)
      machine.current = r.state
      if (t - lastUi > 100) {
        lastUi = t
        setPitch(r.state.pitch)
      }
      if (r.gesture && detectRef.current) cb.current(r.gesture)
    }
    window.addEventListener('deviceorientation', onOrientation)
    // Rien après 2 s : pas de capteur exploitable.
    const timer = window.setTimeout(() => {
      if (alive && !sensorSeen) setStatus((s) => (s === 'waiting' ? 'no-sensor' : s))
    }, 2000)
    return () => {
      alive = false
      clearTimeout(timer)
      window.removeEventListener('deviceorientation', onOrientation)
    }
  }, [listening])

  const enable = useCallback(async () => {
    const ok = await requestTiltPermission()
    setStatus(ok ? (sensorSeen ? 'active' : 'waiting') : hasOrientation() ? 'denied' : 'unsupported')
    return ok
  }, [])

  return { status, pitch, enable }
}

/* -------------------------------------------------------------------------- */
/* Paysage                                                                     */
/* -------------------------------------------------------------------------- */

type OrientationWithLock = ScreenOrientation & { lock?: (o: string) => Promise<void>; unlock?: () => void }

/**
 * Tente plein écran + verrouillage paysage (Android Chrome ; iOS ne sait pas).
 * À appeler DANS un gestionnaire de clic. Renvoie true si verrouillé.
 */
export async function enterLandscape(): Promise<boolean> {
  const orientation = (typeof screen !== 'undefined' ? screen.orientation : undefined) as OrientationWithLock | undefined
  if (!orientation || typeof orientation.lock !== 'function') return false
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
    }
  } catch {
    /* pas de plein écran : on tente quand même le verrou */
  }
  try {
    await orientation.lock('landscape')
    return true
  } catch {
    return false
  }
}

/** Libère le paysage et quitte le plein écran (sans erreur si rien à faire). */
export function leaveLandscape() {
  try {
    ;(screen.orientation as OrientationWithLock | undefined)?.unlock?.()
  } catch {
    /* ignore */
  }
  if (document.fullscreenElement && document.exitFullscreen) void document.exitFullscreen().catch(() => {})
}

/** true si l'écran est plus haut que large. */
export function useIsPortrait() {
  const get = () => (typeof window === 'undefined' ? false : window.innerHeight > window.innerWidth)
  const [portrait, setPortrait] = useState(get)
  useEffect(() => {
    const on = () => setPortrait(get())
    window.addEventListener('resize', on)
    window.addEventListener('orientationchange', on)
    return () => {
      window.removeEventListener('resize', on)
      window.removeEventListener('orientationchange', on)
    }
  }, [])
  return portrait
}

/** Taille de la fenêtre (pour ajuster la police de la carte). */
export function useViewport() {
  const get = () => ({ w: typeof window === 'undefined' ? 800 : window.innerWidth, h: typeof window === 'undefined' ? 400 : window.innerHeight })
  const [vp, setVp] = useState(get)
  useEffect(() => {
    const on = () => setVp(get())
    window.addEventListener('resize', on)
    window.addEventListener('orientationchange', on)
    return () => {
      window.removeEventListener('resize', on)
      window.removeEventListener('orientationchange', on)
    }
  }, [])
  return vp
}
