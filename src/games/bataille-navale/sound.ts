import { useSettings } from '@/store/settings'

/*
 * Sons synthétisés (Web Audio, aucun fichier) de la bataille navale : sonar,
 * sifflement de l'obus, « plouf », « boum » et naufrage. Respectent le réglage
 * `sound` ; silencieux si l'audio est indisponible.
 */

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

/*
 * Déblocage iOS / WebKit : un AudioContext né hors geste reste « suspended » et
 * `resume()` hors geste n'y peut rien. Les sons de tir sont joués depuis un
 * effet (jamais depuis un geste) : sans ce déblocage, un spectateur (ou un
 * duelliste qui ne touche jamais « Mélanger » / « viser ») n'entendrait rien.
 * Tant que le plateau est affiché, chaque geste (n'importe où dans la page)
 * crée / relance ce contexte s'il ne tourne pas ; `audio()` respecte le réglage
 * `sound` (rien n'est créé si le son est coupé).
 */
const GESTURES = ['pointerdown', 'touchend', 'keydown'] as const

function unlockOnGesture() {
  audio()
}

/** À appeler une fois au montage du plateau ; renvoie la fonction de nettoyage. */
export function listenAudioUnlock(): () => void {
  if (typeof window === 'undefined') return () => {}
  for (const ev of GESTURES) window.addEventListener(ev, unlockOnGesture, { capture: true, passive: true })
  return () => {
    for (const ev of GESTURES) window.removeEventListener(ev, unlockOnGesture, { capture: true })
  }
}

function safe(fn: (c: AudioContext, t0: number) => void, delayS = 0) {
  const c = audio()
  if (!c) return
  try {
    fn(c, c.currentTime + delayS)
  } catch {
    /* audio indisponible */
  }
}

/** Oscillateur avec enveloppe percussive (et glissando optionnel). */
function osc(c: AudioContext, t: number, o: { type?: OscillatorType; from: number; to?: number; dur: number; gain: number; attack?: number }) {
  const n = c.createOscillator()
  const g = c.createGain()
  n.type = o.type ?? 'sine'
  n.frequency.setValueAtTime(o.from, t)
  if (o.to) n.frequency.exponentialRampToValueAtTime(o.to, t + o.dur)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(o.gain, t + (o.attack ?? 0.008))
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur)
  n.connect(g).connect(c.destination)
  n.start(t)
  n.stop(t + o.dur + 0.03)
}

/** Bruit blanc filtré (passe-bas qui glisse de `from` à `to`). */
function noise(c: AudioContext, t: number, o: { dur: number; gain: number; from: number; to: number; q?: number; attack?: number }) {
  const len = Math.max(1, Math.floor(c.sampleRate * o.dur))
  const buf = c.createBuffer(1, len, c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  const src = c.createBufferSource()
  src.buffer = buf
  const f = c.createBiquadFilter()
  f.type = 'lowpass'
  f.Q.value = o.q ?? 0.8
  f.frequency.setValueAtTime(o.from, t)
  f.frequency.exponentialRampToValueAtTime(o.to, t + o.dur)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(o.gain, t + (o.attack ?? 0.01))
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur)
  src.connect(f).connect(g).connect(c.destination)
  src.start(t)
  src.stop(t + o.dur + 0.02)
}

/** « Ping » de sonar (avec écho) : viser, début de la préparation. */
export function playSonar(delayS = 0) {
  safe((c, t) => {
    osc(c, t, { from: 1180, to: 1120, dur: 0.55, gain: 0.16, attack: 0.004 })
    osc(c, t + 0.3, { from: 1180, to: 1120, dur: 0.45, gain: 0.05, attack: 0.004 })
  }, delayS)
}

/** Sifflement de l'obus qui tombe (~0,3 s). */
export function playWhistle(delayS = 0) {
  safe((c, t) => osc(c, t, { from: 1700, to: 520, dur: 0.32, gain: 0.07, attack: 0.03 }), delayS)
}

/** « Plouf ! » : gerbe d'eau + bulles. */
export function playSplash(delayS = 0) {
  safe((c, t) => {
    noise(c, t, { dur: 0.45, gain: 0.32, from: 2600, to: 260, attack: 0.006 })
    osc(c, t, { from: 320, to: 110, dur: 0.22, gain: 0.22 })
    for (let i = 0; i < 4; i++) {
      const at = t + 0.12 + i * 0.07 + Math.random() * 0.04
      const f = 520 + Math.random() * 420
      osc(c, at, { from: f, to: f * 1.9, dur: 0.06, gain: 0.05 })
    }
  }, delayS)
}

/** « Boum ! » : explosion (plus longue et plus grave si le bateau coule). */
export function playBoom(big = false, delayS = 0) {
  safe((c, t) => {
    noise(c, t, { dur: big ? 1.1 : 0.6, gain: big ? 0.55 : 0.42, from: big ? 1800 : 1400, to: 70, attack: 0.004 })
    osc(c, t, { from: big ? 140 : 170, to: 38, dur: big ? 0.8 : 0.45, gain: big ? 0.5 : 0.38, attack: 0.004 })
    if (big) osc(c, t + 0.12, { type: 'triangle', from: 90, to: 30, dur: 0.9, gain: 0.25 })
  }, delayS)
}

/** Glouglou du naufrage (après le « boum » d'un bateau coulé). */
export function playSink(delayS = 0) {
  safe((c, t) => {
    noise(c, t, { dur: 1.2, gain: 0.12, from: 500, to: 90, attack: 0.2 })
    for (let i = 0; i < 7; i++) {
      const at = t + 0.1 + i * 0.13 + Math.random() * 0.05
      const f = 260 - i * 18 + Math.random() * 60
      osc(c, at, { from: f, to: f * 1.6, dur: 0.08, gain: 0.07 })
    }
  }, delayS)
}
