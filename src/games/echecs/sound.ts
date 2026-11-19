import { useSettings } from '@/store/settings'

/* Sons synthétisés (Web Audio) : pièce posée « toc » en bois, prise plus sèche, échec = petit carillon. */

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

function knock(c: AudioContext, at: number, pitch: number, gain: number) {
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = 'triangle'
  o.frequency.setValueAtTime(pitch, at)
  o.frequency.exponentialRampToValueAtTime(pitch * 0.55, at + 0.08)
  g.gain.setValueAtTime(gain, at)
  g.gain.exponentialRampToValueAtTime(0.001, at + 0.12)
  o.connect(g).connect(c.destination)
  o.start(at)
  o.stop(at + 0.14)
}

function chime(c: AudioContext, at: number, f: number) {
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = 'sine'
  o.frequency.value = f
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(0.18, at + 0.01)
  g.gain.exponentialRampToValueAtTime(0.001, at + 0.35)
  o.connect(g).connect(c.destination)
  o.start(at)
  o.stop(at + 0.4)
}

/** Son d'un coup (après l'animation de glissement). */
export function playMoveSound(kind: { capture: boolean; check: boolean }, delay = 0.18) {
  const c = audio()
  if (!c) return
  const t = c.currentTime + delay
  if (kind.capture) {
    knock(c, t, 520, 0.35)
    knock(c, t + 0.05, 340, 0.3)
  } else {
    knock(c, t, 420, 0.3)
  }
  if (kind.check) {
    chime(c, t + 0.12, 988)
    chime(c, t + 0.22, 1319)
  }
}
