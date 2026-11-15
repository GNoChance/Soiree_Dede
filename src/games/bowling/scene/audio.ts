/**
 * Sons du bowling, synthétisés en Web Audio (aucun fichier) :
 * grondement de la boule (volume/filtre suivant la vitesse), choc des quilles,
 * gouttière (trombone triste). Respecte le réglage « son » de l'app.
 * Fanfare / succès : réutilisent `playSound` de @/lib/feedback.
 */
import { useSettings } from '@/store/settings'

export class BowlingAudio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private rumbleGain: GainNode | null = null
  private rumbleFilter: BiquadFilterNode | null = null
  private rumbleSrc: AudioBufferSourceNode | null = null
  private rumbleOsc: OscillatorNode | null = null
  private noise: AudioBuffer | null = null
  private white: AudioBuffer | null = null
  private lastImpact = 0

  private enabled() {
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
      this.master.gain.value = 0.9
      this.master.connect(this.ctx.destination)
      const len = Math.floor(this.ctx.sampleRate * 1.5)
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
      const d = this.noise.getChannelData(0)
      // Bruit « brun » (grave) : intégration d'un bruit blanc.
      let last = 0
      for (let i = 0; i < len; i++) {
        last = (last + 0.04 * (Math.random() * 2 - 1)) / 1.04
        d[i] = last * 3.2
      }
      this.white = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
      const w = this.white.getChannelData(0)
      for (let i = 0; i < len; i++) w[i] = Math.random() * 2 - 1
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    return this.ctx
  }

  /** Démarre le grondement (boule lancée). */
  startRumble() {
    const c = this.ensure()
    if (!c || !this.master || !this.noise || this.rumbleSrc) return
    const src = c.createBufferSource()
    src.buffer = this.noise
    src.loop = true
    const f = c.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = 180
    f.Q.value = 2
    const g = c.createGain()
    g.gain.value = 0.0001
    const osc = c.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = 48
    const og = c.createGain()
    og.gain.value = 0.35
    osc.connect(og).connect(g)
    src.connect(f).connect(g).connect(this.master)
    src.start()
    osc.start()
    this.rumbleSrc = src
    this.rumbleOsc = osc
    this.rumbleGain = g
    this.rumbleFilter = f
  }

  /** speed en m/s ; onLane=false (gouttière / fosse) = son plus creux. */
  setRumble(speed: number, onLane = true) {
    if (!this.ctx || !this.rumbleGain || !this.rumbleFilter) return
    const t = this.ctx.currentTime
    const level = this.enabled() ? Math.min(1, speed / 9) : 0
    this.rumbleGain.gain.setTargetAtTime(0.0001 + level * (onLane ? 0.55 : 0.3), t, 0.05)
    this.rumbleFilter.frequency.setTargetAtTime(110 + level * (onLane ? 260 : 120), t, 0.05)
    this.rumbleOsc?.frequency.setTargetAtTime(38 + level * 30, t, 0.05)
  }

  stopRumble() {
    if (!this.ctx || !this.rumbleGain) return
    const t = this.ctx.currentTime
    this.rumbleGain.gain.setTargetAtTime(0.0001, t, 0.08)
    const src = this.rumbleSrc
    const osc = this.rumbleOsc
    try {
      src?.stop(t + 0.5)
      osc?.stop(t + 0.5)
    } catch {
      /* déjà arrêté */
    }
    this.rumbleSrc = null
    this.rumbleOsc = null
    this.rumbleGain = null
    this.rumbleFilter = null
  }

  /** Choc de quille (bois creux) : intensité 0..1. */
  impact(intensity: number, ballHit = false) {
    if (!this.enabled()) return
    const c = this.ctx
    if (!c || !this.master || !this.white) return
    const now = c.currentTime
    if (now - this.lastImpact < 0.025) return
    this.lastImpact = now
    const v = Math.max(0.05, Math.min(1, intensity))
    // Claquement : bruit filtré passe-bande court
    const src = c.createBufferSource()
    src.buffer = this.white
    const bp = c.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = ballHit ? 900 : 1400 + Math.random() * 900
    bp.Q.value = 3
    const g = c.createGain()
    g.gain.setValueAtTime(v * (ballHit ? 2.2 : 1.4), now)
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.12)
    src.connect(bp).connect(g).connect(this.master)
    src.start(now, Math.random() * 1.2, 0.15)
    // Résonance du bois
    for (const [freq, gain] of [[ballHit ? 420 : 760 + Math.random() * 200, 0.22], [ballHit ? 980 : 1650, 0.08]] as const) {
      const o = c.createOscillator()
      o.type = 'triangle'
      o.frequency.setValueAtTime(freq, now)
      o.frequency.exponentialRampToValueAtTime(freq * 0.8, now + 0.15)
      const og = c.createGain()
      og.gain.setValueAtTime(gain * v, now)
      og.gain.exponentialRampToValueAtTime(0.0001, now + 0.16)
      o.connect(og).connect(this.master)
      o.start(now)
      o.stop(now + 0.18)
    }
  }

  /** Gouttière : « wah wah wah waaah ». */
  sad() {
    if (!this.enabled()) return
    const c = this.ensure()
    if (!c || !this.master) return
    const t0 = c.currentTime + 0.05
    const notes = [392, 370, 349, 330]
    notes.forEach((f, i) => {
      const last = i === notes.length - 1
      const start = t0 + i * 0.42
      const dur = last ? 1.1 : 0.36
      const o = c.createOscillator()
      o.type = 'sawtooth'
      o.frequency.setValueAtTime(f, start)
      if (last) {
        const lfo = c.createOscillator()
        lfo.frequency.value = 6
        const lg = c.createGain()
        lg.gain.value = 9
        lfo.connect(lg).connect(o.frequency)
        lfo.start(start + 0.2)
        lfo.stop(start + dur)
        o.frequency.linearRampToValueAtTime(f * 0.94, start + dur)
      }
      const lp = c.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.setValueAtTime(500, start)
      lp.frequency.linearRampToValueAtTime(1300, start + 0.12)
      lp.frequency.linearRampToValueAtTime(600, start + dur)
      const g = c.createGain()
      g.gain.setValueAtTime(0.0001, start)
      g.gain.exponentialRampToValueAtTime(0.16, start + 0.05)
      g.gain.setValueAtTime(0.16, start + dur - 0.08)
      g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
      o.connect(lp).connect(g).connect(this.master!)
      o.start(start)
      o.stop(start + dur + 0.02)
    })
  }

  /** Clameur de foule (strike / spare). */
  cheer(strength = 1) {
    if (!this.enabled()) return
    const c = this.ensure()
    if (!c || !this.master || !this.white) return
    const now = c.currentTime
    const src = c.createBufferSource()
    src.buffer = this.white
    src.loop = true
    const bp = c.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 1100
    bp.Q.value = 0.7
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, now)
    g.gain.exponentialRampToValueAtTime(0.5 * strength, now + 0.25)
    g.gain.exponentialRampToValueAtTime(0.0001, now + 1.8)
    src.connect(bp).connect(g).connect(this.master)
    src.start(now)
    src.stop(now + 1.9)
  }

  dispose() {
    this.stopRumble()
    const c = this.ctx
    this.ctx = null
    this.master = null
    if (c) void c.close().catch(() => undefined)
  }
}
