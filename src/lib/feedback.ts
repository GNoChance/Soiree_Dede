import { useSettings } from '@/store/settings'

/**
 * Feedback sonore (Web Audio, synthese pure) + haptique (navigator.vibrate).
 * Respecte les reglages `sound` / `haptics` du store settings.
 */

let ctx: AudioContext | null = null

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    ctx = new Ctor()
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

/** A appeler sur un geste utilisateur (iOS exige un deblocage). Fait automatiquement par initFeedback(). */
export function unlockAudio() {
  getCtx()
}

export function initFeedback() {
  const once = () => {
    unlockAudio()
    window.removeEventListener('pointerdown', once)
    window.removeEventListener('keydown', once)
  }
  window.addEventListener('pointerdown', once)
  window.addEventListener('keydown', once)
}

interface ToneOpts {
  freq: number
  start?: number
  dur: number
  type?: OscillatorType
  gain?: number
  slideTo?: number
}

function tone(c: AudioContext, { freq, start = 0, dur, type = 'sine', gain = 0.2, slideTo }: ToneOpts) {
  const t0 = c.currentTime + start
  const osc = c.createOscillator()
  const g = c.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(g).connect(c.destination)
  osc.start(t0)
  osc.stop(t0 + dur + 0.02)
}

function noiseSweep(c: AudioContext, dur: number, from: number, to: number, gain = 0.25) {
  const t0 = c.currentTime
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  const src = c.createBufferSource()
  src.buffer = buf
  const filter = c.createBiquadFilter()
  filter.type = 'bandpass'
  filter.Q.value = 1.2
  filter.frequency.setValueAtTime(from, t0)
  filter.frequency.exponentialRampToValueAtTime(to, t0 + dur)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(gain, t0 + dur * 0.4)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  src.connect(filter).connect(g).connect(c.destination)
  src.start(t0)
}

export type SoundName = 'pop' | 'success' | 'fail' | 'tick' | 'whoosh' | 'fanfare'

const SOUNDS: Record<SoundName, (c: AudioContext) => void> = {
  pop: (c) => tone(c, { freq: 620, slideTo: 220, dur: 0.1, gain: 0.22 }),
  tick: (c) => tone(c, { freq: 1400, dur: 0.035, type: 'square', gain: 0.08 }),
  success: (c) => {
    tone(c, { freq: 659, dur: 0.14, type: 'triangle', gain: 0.22 })
    tone(c, { freq: 880, start: 0.11, dur: 0.22, type: 'triangle', gain: 0.22 })
  },
  fail: (c) => {
    tone(c, { freq: 260, slideTo: 90, dur: 0.38, type: 'sawtooth', gain: 0.14 })
    tone(c, { freq: 196, start: 0.12, slideTo: 70, dur: 0.38, type: 'sawtooth', gain: 0.1 })
  },
  whoosh: (c) => noiseSweep(c, 0.3, 300, 2400),
  fanfare: (c) => {
    const notes = [523.25, 659.25, 783.99, 1046.5]
    notes.forEach((f, i) => tone(c, { freq: f, start: i * 0.11, dur: 0.2, type: 'square', gain: 0.1 }))
    ;[523.25, 659.25, 783.99, 1046.5].forEach((f) =>
      tone(c, { freq: f, start: 0.5, dur: 0.7, type: 'triangle', gain: 0.1 }),
    )
    tone(c, { freq: 1568, start: 0.55, dur: 0.6, type: 'sine', gain: 0.08 })
  },
}

export function playSound(name: SoundName) {
  if (!useSettings.getState().sound) return
  const c = getCtx()
  if (!c) return
  try {
    SOUNDS[name](c)
  } catch {
    /* audio indisponible : on ignore */
  }
}

export function vibrate(pattern: number | number[]) {
  if (!useSettings.getState().haptics) return
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
  try {
    navigator.vibrate(pattern)
  } catch {
    /* ignore */
  }
}

/** Combos son + haptique prets a l'emploi. */
export const fx = {
  pop: () => { playSound('pop'); vibrate(10) },
  tick: () => { playSound('tick'); vibrate(5) },
  success: () => { playSound('success'); vibrate([15, 40, 25]) },
  fail: () => { playSound('fail'); vibrate([60, 40, 90]) },
  whoosh: () => { playSound('whoosh'); vibrate(8) },
  fanfare: () => { playSound('fanfare'); vibrate([30, 40, 30, 40, 120]) },
}
