import { useSettings } from '@/store/settings'

/* Sons synthétisés (Web Audio) légers du Morpion : crayon qui trace, petit carillon. */

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

/** Frottement de crayon : bruit filtré, enveloppe courte, fréquence qui glisse. */
function scratch(c: AudioContext, at: number, dur: number, from: number, to: number, gain: number) {
  const buf = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * dur)), c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (0.6 + 0.4 * Math.sin(i / 40))
  const src = c.createBufferSource()
  src.buffer = buf
  const f = c.createBiquadFilter()
  f.type = 'bandpass'
  f.Q.value = 2.2
  f.frequency.setValueAtTime(from, at)
  f.frequency.exponentialRampToValueAtTime(to, at + dur)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(gain, at + dur * 0.25)
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  src.connect(f).connect(g).connect(c.destination)
  src.start(at)
}

/** « Scritch » : deux traits pour la croix, une boucle pour le rond. */
export function playScribble(sym: 'x' | 'o', delayS = 0) {
  const c = audio()
  if (!c) return
  try {
    const t0 = c.currentTime + delayS
    if (sym === 'x') {
      scratch(c, t0, 0.09, 2600, 4200, 0.16)
      scratch(c, t0 + 0.2, 0.09, 2800, 4400, 0.16)
    } else {
      scratch(c, t0, 0.3, 2200, 3800, 0.13)
    }
  } catch {
    /* audio indisponible */
  }
}

/** Petit carillon (ultime : un petit morpion vient d'être gagné). */
export function playCapture(delayS = 0) {
  const c = audio()
  if (!c) return
  try {
    const t0 = c.currentTime + delayS
    ;[1046.5, 1568].forEach((f, i) => {
      const o = c.createOscillator()
      const g = c.createGain()
      o.type = 'triangle'
      o.frequency.setValueAtTime(f, t0 + i * 0.09)
      g.gain.setValueAtTime(0.0001, t0 + i * 0.09)
      g.gain.exponentialRampToValueAtTime(0.09, t0 + i * 0.09 + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.09 + 0.35)
      o.connect(g).connect(c.destination)
      o.start(t0 + i * 0.09)
      o.stop(t0 + i * 0.09 + 0.4)
    })
  } catch {
    /* audio indisponible */
  }
}
