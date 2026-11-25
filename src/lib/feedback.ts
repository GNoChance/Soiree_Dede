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

/** Coup de bruit filtré (caisse claire, cymbale) à `start` secondes. */
function noiseHit(c: AudioContext, { start = 0, dur, freq, gain = 0.2, type = 'bandpass' as BiquadFilterType }: { start?: number; dur: number; freq: number; gain?: number; type?: BiquadFilterType }) {
  const t0 = c.currentTime + start
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  const src = c.createBufferSource()
  src.buffer = buf
  const filter = c.createBiquadFilter()
  filter.type = type
  filter.frequency.value = freq
  const g = c.createGain()
  g.gain.setValueAtTime(gain, t0)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  src.connect(filter).connect(g).connect(c.destination)
  src.start(t0)
}

/** Suite de notes courtes (arpège), douces par défaut. */
function arp(c: AudioContext, freqs: number[], { step = 0.09, dur = 0.16, type = 'triangle' as OscillatorType, gain = 0.16, start = 0 } = {}) {
  freqs.forEach((f, i) => tone(c, { freq: f, start: start + i * step, dur, type, gain }))
}

export type SoundName =
  | 'pop' | 'success' | 'fail' | 'tick' | 'whoosh' | 'fanfare' | 'cash'
  // suspense : roulement de tambour (1,6 s + cymbale), tic-tac des 5 dernières secondes
  | 'drumroll' | 'clock' | 'clock_last'
  // cartes (Pas de bol)
  | 'slap' | 'deal' | 'shuffle' | 'plus2' | 'plus4' | 'reverse' | 'skip' | 'wild' | 'bell'
  | 'perso_kevin' | 'perso_cycy' | 'perso_dede' | 'perso_manon' | 'perso_mika' | 'perso_cecile' | 'perso_carole' | 'perso_marius' | 'perso_nini' | 'perso_cycy2'

const SOUNDS: Record<SoundName, (c: AudioContext) => void> = {
  // carte posée sur la table : claque sèche
  slap: (c) => {
    noiseSweep(c, 0.08, 2200, 900, 0.14)
    tone(c, { freq: 180, slideTo: 70, dur: 0.09, gain: 0.18 })
  },
  // carte piochée : petit glissement
  deal: (c) => noiseSweep(c, 0.14, 1100, 3200, 0.1),
  shuffle: (c) => {
    noiseSweep(c, 0.12, 1500, 3500, 0.09)
    for (const t of [110, 220, 330]) setTimeout(() => noiseSweep(c, 0.12, 1500, 3500, 0.09), t)
  },
  plus2: (c) => {
    arp(c, [523, 659], { step: 0.09 })
    noiseSweep(c, 0.18, 700, 2200, 0.08)
  },
  plus4: (c) => {
    tone(c, { freq: 300, slideTo: 110, dur: 0.45, type: 'triangle', gain: 0.2 })
    arp(c, [440, 415, 392, 370, 330], { step: 0.09, dur: 0.2, gain: 0.15 })
  },
  reverse: (c) => {
    tone(c, { freq: 380, slideTo: 900, dur: 0.16, gain: 0.18 })
    tone(c, { freq: 900, slideTo: 380, start: 0.15, dur: 0.18, gain: 0.18 })
  },
  skip: (c) => tone(c, { freq: 420, slideTo: 140, dur: 0.22, type: 'triangle', gain: 0.22 }),
  wild: (c) => arp(c, [523, 659, 784, 988, 1319], { step: 0.07, dur: 0.14, gain: 0.14 }),
  bell: (c) => arp(c, [988, 1319], { step: 0.1, dur: 0.35, type: 'sine', gain: 0.16 }),
  // une petite signature par personnage
  perso_kevin: (c) => arp(c, [523, 784], { step: 0.08 }),
  perso_cycy: (c) => arp(c, [659, 880, 659, 440], { step: 0.08, type: 'sine' }),
  perso_dede: (c) => {
    arp(c, [523, 659, 784, 1047], { step: 0.09 })
    tone(c, { freq: 1568, start: 0.4, dur: 0.4, gain: 0.08 })
  },
  perso_manon: (c) => arp(c, [440, 415, 392], { step: 0.14, type: 'sine', gain: 0.12, dur: 0.25 }),
  perso_mika: (c) => {
    tone(c, { freq: 380, slideTo: 900, dur: 0.16, gain: 0.18 })
    tone(c, { freq: 900, slideTo: 380, start: 0.15, dur: 0.18, gain: 0.18 })
  },
  perso_cecile: (c) => {
    noiseSweep(c, 0.25, 3000, 800, 0.1)
    arp(c, [880, 1175], { step: 0.1, start: 0.2, type: 'sine' })
  },
  perso_carole: (c) => {
    tone(c, { freq: 900, slideTo: 220, dur: 0.22, type: 'sawtooth', gain: 0.07 })
    noiseSweep(c, 0.12, 3500, 1200, 0.1)
  },
  perso_marius: (c) => arp(c, [262, 196], { step: 0.15, type: 'sine', gain: 0.16, dur: 0.3 }),
  perso_nini: (c) => {
    tone(c, { freq: 300, slideTo: 900, dur: 0.15, gain: 0.16 })
    tone(c, { freq: 900, slideTo: 300, start: 0.15, dur: 0.15, gain: 0.16 })
  },
  // Va chercher ! : deux petits « ouaf » (glissando court vers le grave).
  perso_cycy2: (c) => {
    tone(c, { freq: 520, slideTo: 260, dur: 0.09, type: 'square', gain: 0.1 })
    tone(c, { freq: 560, slideTo: 280, start: 0.16, dur: 0.09, type: 'square', gain: 0.1 })
  },
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
  drumroll: (c) => {
    // coups de caisse claire de plus en plus forts pendant 1,6 s, puis cymbale
    for (let i = 0; i < 36; i++) noiseHit(c, { start: i * 0.045, dur: 0.06, freq: 1800, gain: 0.04 + 0.16 * (i / 35) })
    noiseHit(c, { start: 1.62, dur: 0.9, freq: 6500, gain: 0.22, type: 'highpass' })
    tone(c, { freq: 98, start: 1.62, dur: 0.35, type: 'sine', gain: 0.25 })
  },
  clock: (c) => {
    tone(c, { freq: 1050, dur: 0.05, type: 'square', gain: 0.07 })
    tone(c, { freq: 70, dur: 0.12, type: 'sine', gain: 0.22 })
  },
  clock_last: (c) => {
    tone(c, { freq: 1400, dur: 0.07, type: 'square', gain: 0.09 })
    tone(c, { freq: 60, dur: 0.2, type: 'sine', gain: 0.3 })
  },
  // billets / caisse : froissement bref puis petit « ding »
  cash: (c) => {
    noiseSweep(c, 0.12, 2200, 5200, 0.07)
    tone(c, { freq: 1318, start: 0.08, dur: 0.07, type: 'square', gain: 0.05 })
    tone(c, { freq: 1760, start: 0.15, dur: 0.2, type: 'triangle', gain: 0.13 })
  },
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
  slap: () => { playSound('slap'); vibrate(12) },
  deal: () => { playSound('deal'); vibrate(6) },
  pop:() => { playSound('pop'); vibrate(10) },
  tick: () => { playSound('tick'); vibrate(5) },
  success: () => { playSound('success'); vibrate([15, 40, 25]) },
  fail: () => { playSound('fail'); vibrate([60, 40, 90]) },
  whoosh: () => { playSound('whoosh'); vibrate(8) },
  cash: () => { playSound('cash'); vibrate([8, 30, 12]) },
  fanfare: () => { playSound('fanfare'); vibrate([30, 40, 30, 40, 120]) },
}
