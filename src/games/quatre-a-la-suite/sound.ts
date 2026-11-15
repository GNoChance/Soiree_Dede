import { useSettings } from '@/store/settings'

/* Son synthétisé (Web Audio) du jeton qui tombe : « clac » plastique + petit rebond. */

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

function hit(c: AudioContext, at: number, gain: number, pitch: number) {
  const dur = 0.05
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 4)
  const src = c.createBufferSource()
  src.buffer = buf
  const f = c.createBiquadFilter()
  f.type = 'bandpass'
  f.frequency.value = pitch
  f.Q.value = 4
  const g = c.createGain()
  g.gain.setValueAtTime(gain, at)
  src.connect(f).connect(g).connect(c.destination)
  src.start(at)

  const o = c.createOscillator()
  const og = c.createGain()
  o.type = 'sine'
  o.frequency.setValueAtTime(pitch * 0.18, at)
  o.frequency.exponentialRampToValueAtTime(pitch * 0.1, at + 0.08)
  og.gain.setValueAtTime(0.0001, at)
  og.gain.exponentialRampToValueAtTime(gain * 0.6, at + 0.004)
  og.gain.exponentialRampToValueAtTime(0.0001, at + 0.1)
  o.connect(og).connect(c.destination)
  o.start(at)
  o.stop(at + 0.12)
}

/** « Clac ! » : `depth` = nombre de cases de chute (plus c'est haut, plus ça claque). */
export function playClack(depth = 3, delayS = 0) {
  const c = audio()
  if (!c) return
  try {
    const t0 = c.currentTime + delayS
    const g = 0.35 + Math.min(depth, 6) * 0.05
    hit(c, t0, g, 1900)
    hit(c, t0 + 0.11, g * 0.35, 2300) // rebond
  } catch {
    /* audio indisponible */
  }
}
