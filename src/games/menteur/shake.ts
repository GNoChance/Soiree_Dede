import { useEffect, useRef, useState } from 'react'
import { useSettings } from '@/store/settings'

/* -------------------------------------------------------------------------- */
/* Son synthétisé (Web Audio) : dés qui roulent dans le gobelet                */
/* -------------------------------------------------------------------------- */

let ctx: AudioContext | null = null

function audio(): AudioContext | null {
  if (typeof window === 'undefined' || !useSettings.getState().sound) return null
  if (!ctx) {
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    try {
      ctx = new Ctor()
    } catch {
      return null
    }
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

/** Petit « clac » de dé : bruit très court filtré + résonance boisée. */
function clack(c: AudioContext, at: number, gain: number, pitch: number) {
  const dur = 0.045
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3)
  const src = c.createBufferSource()
  src.buffer = buf
  const f = c.createBiquadFilter()
  f.type = 'bandpass'
  f.frequency.value = pitch
  f.Q.value = 6
  const g = c.createGain()
  g.gain.setValueAtTime(gain, at)
  src.connect(f).connect(g).connect(c.destination)
  src.start(at)

  const o = c.createOscillator()
  const og = c.createGain()
  o.type = 'triangle'
  o.frequency.setValueAtTime(pitch * 0.35, at)
  og.gain.setValueAtTime(0.0001, at)
  og.gain.exponentialRampToValueAtTime(gain * 0.25, at + 0.004)
  og.gain.exponentialRampToValueAtTime(0.0001, at + 0.06)
  o.connect(og).connect(c.destination)
  o.start(at)
  o.stop(at + 0.08)
}

/** Dés secoués dans le gobelet (≈ dur s). */
export function playRattle(dur = 0.9) {
  const c = audio()
  if (!c) return
  try {
    const t0 = c.currentTime
    const n = Math.round(dur * 26)
    for (let i = 0; i < n; i++) {
      const at = t0 + (i / n) * dur + Math.random() * 0.025
      clack(c, at, 0.18 + Math.random() * 0.2, 1800 + Math.random() * 2200)
    }
  } catch {
    /* audio indisponible */
  }
}

/** Dés versés sur la table : quelques rebonds qui s'espacent. */
export function playPour() {
  const c = audio()
  if (!c) return
  try {
    const t0 = c.currentTime
    let t = 0
    for (let i = 0; i < 9; i++) {
      t += 0.03 + i * 0.012 + Math.random() * 0.02
      clack(c, t0 + t, 0.4 * (1 - i / 11), 900 + Math.random() * 1400)
    }
  } catch {
    /* audio indisponible */
  }
}

/** Un dé qui s'allume au comptage (note qui monte avec le compteur). */
export function playCount(n: number) {
  const c = audio()
  if (!c) return
  try {
    const t0 = c.currentTime
    const o = c.createOscillator()
    const g = c.createGain()
    o.type = 'triangle'
    o.frequency.setValueAtTime(330 * Math.pow(2, Math.min(n, 24) / 12), t0)
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18)
    o.connect(g).connect(c.destination)
    o.start(t0)
    o.stop(t0 + 0.2)
  } catch {
    /* audio indisponible */
  }
}

/* -------------------------------------------------------------------------- */
/* Détection de secousse (DeviceMotionEvent)                                   */
/* -------------------------------------------------------------------------- */

type MotionPermission = 'granted' | 'denied' | 'default'
type DMEWithPermission = typeof DeviceMotionEvent & { requestPermission?: () => Promise<MotionPermission> }

const hasMotion = () => typeof window !== 'undefined' && 'DeviceMotionEvent' in window
/** iOS 13+ exige une autorisation explicite sur un geste utilisateur. */
export const motionNeedsPermission = () =>
  hasMotion() && typeof (window.DeviceMotionEvent as DMEWithPermission).requestPermission === 'function'

let permission: MotionPermission = 'default'

export async function requestMotionPermission(): Promise<boolean> {
  if (!hasMotion()) return false
  const req = (window.DeviceMotionEvent as DMEWithPermission).requestPermission
  if (typeof req !== 'function') {
    permission = 'granted'
    return true
  }
  try {
    permission = await req.call(window.DeviceMotionEvent)
  } catch {
    permission = 'denied'
  }
  return permission === 'granted'
}

/**
 * Appelle `onShake` quand le téléphone est secoué (tant que `enabled`).
 * Renvoie l'état d'autorisation : 'unsupported' | 'needs-permission' | 'ready' | 'denied'.
 */
export function useShake(enabled: boolean, onShake: () => void) {
  const cb = useRef(onShake)
  useEffect(() => {
    cb.current = onShake
  })
  const [status, setStatus] = useState<'unsupported' | 'needs-permission' | 'ready' | 'denied'>(() =>
    !hasMotion() ? 'unsupported' : motionNeedsPermission() && permission !== 'granted' ? (permission === 'denied' ? 'denied' : 'needs-permission') : 'ready',
  )

  useEffect(() => {
    if (!enabled || status !== 'ready') return
    let last: { x: number; y: number; z: number } | null = null
    let energy = 0
    let lastT = 0
    const onMotion = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity ?? e.acceleration
      if (!a || a.x == null || a.y == null || a.z == null) return
      const cur = { x: a.x, y: a.y, z: a.z }
      if (last) {
        const d = Math.abs(cur.x - last.x) + Math.abs(cur.y - last.y) + Math.abs(cur.z - last.z)
        const now = performance.now()
        // énergie qui décroît : il faut quelques secousses franches rapprochées
        energy = energy * Math.exp(-(now - lastT) / 400) + (d > 12 ? d : 0)
        lastT = now
        if (energy > 70) {
          energy = 0
          cb.current()
        }
      }
      last = cur
    }
    window.addEventListener('devicemotion', onMotion)
    return () => window.removeEventListener('devicemotion', onMotion)
  }, [enabled, status])

  const enable = async () => {
    const ok = await requestMotionPermission()
    setStatus(ok ? 'ready' : 'denied')
  }

  return { status, enable }
}
