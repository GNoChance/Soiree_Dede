/**
 * Sons du mini-golf, synthétisés en Web Audio (aucun fichier) : frappe du putter, rebond sur
 * bordure, bumper, balle dans le trou, plouf, cloche du clocher, looping. Respecte le réglage « son ».
 */
import { useSettings } from '@/store/settings'

export class GolfAudio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noise: AudioBuffer | null = null
  private lastHit = 0

  private on() {
    return useSettings.getState().sound
  }

  /** À appeler sur un geste utilisateur (déblocage iOS). */
  ensure(): AudioContext | null {
    if (typeof window === 'undefined') return null
    if (!this.ctx) {
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return null
      try {
        this.ctx = new Ctor()
      } catch {
        return null
      }
      this.master = this.ctx.createGain()
      this.master.gain.value = 0.8
      this.master.connect(this.ctx.destination)
      const len = Math.floor(this.ctx.sampleRate * 0.8)
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
      const d = this.noise.getChannelData(0)
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    return this.ctx
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', slideTo?: number, delay = 0) {
    const c = this.ctx
    if (!c || !this.master) return
    const t0 = c.currentTime + delay
    const o = c.createOscillator()
    const g = c.createGain()
    o.type = type
    o.frequency.setValueAtTime(freq, t0)
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur)
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.006)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    o.connect(g).connect(this.master)
    o.start(t0)
    o.stop(t0 + dur + 0.05)
  }

  private burst(dur: number, gain: number, freq: number, q = 1, type: BiquadFilterType = 'bandpass', delay = 0, slideTo?: number) {
    const c = this.ctx
    if (!c || !this.master || !this.noise) return
    const t0 = c.currentTime + delay
    const src = c.createBufferSource()
    src.buffer = this.noise
    const f = c.createBiquadFilter()
    f.type = type
    f.frequency.setValueAtTime(freq, t0)
    if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur)
    f.Q.value = q
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.005)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    src.connect(f).connect(g).connect(this.master)
    src.start(t0)
    src.stop(t0 + dur + 0.05)
  }

  private ready() {
    return this.on() && !!this.ensure()
  }

  /** « Tok » du putter (plus fort = plus sec). */
  putt(power: number) {
    if (!this.ready()) return
    this.tone(900 + power * 500, 0.07, 0.25 + power * 0.3, 'triangle', 500)
    this.burst(0.05, 0.25 + power * 0.25, 2600, 2)
  }

  /** Rebond sur une bordure / un plot. */
  clack(speed: number) {
    const now = performance.now()
    if (now - this.lastHit < 60 || !this.ready()) return
    this.lastHit = now
    const v = Math.min(1, speed / 5)
    this.tone(320 + v * 260, 0.06, 0.08 + v * 0.3, 'square', 180)
    this.burst(0.04, 0.1 + v * 0.25, 1500, 3)
  }

  boing() {
    if (!this.ready()) return
    this.tone(180, 0.35, 0.35, 'sine', 620)
    this.tone(360, 0.2, 0.12, 'triangle', 900, 0.02)
  }

  /** Balle dans le trou : « plop » + roulement dans la coupe. */
  cup() {
    if (!this.ready()) return
    this.tone(520, 0.12, 0.35, 'sine', 160)
    for (let i = 0; i < 4; i++) this.tone(1300 - i * 120, 0.05, 0.12 - i * 0.02, 'triangle', undefined, 0.12 + i * 0.07)
  }

  lip() {
    if (!this.ready()) return
    this.tone(700, 0.08, 0.15, 'triangle', 1100)
  }

  splash() {
    if (!this.ready()) return
    this.burst(0.5, 0.5, 900, 0.8, 'lowpass', 0, 250)
    this.tone(260, 0.25, 0.2, 'sine', 90)
    this.burst(0.25, 0.2, 3000, 1.5, 'bandpass', 0.08)
  }

  bell() {
    if (!this.ready()) return
    for (const [f, g] of [[660, 0.35], [1320, 0.15], [1980, 0.08], [880, 0.12]] as const) this.tone(f, 2.2, g, 'sine')
    this.tone(660, 2.0, 0.25, 'sine', undefined, 0.7)
  }

  loop(ok: boolean) {
    if (!this.ready()) return
    if (ok) {
      this.tone(300, 0.7, 0.2, 'sawtooth', 1200)
      this.burst(0.7, 0.15, 800, 1, 'bandpass', 0, 3000)
    } else this.tone(500, 0.6, 0.18, 'triangle', 150)
  }

  dispose() {
    if (this.ctx) void this.ctx.close().catch(() => undefined)
    this.ctx = null
  }
}
