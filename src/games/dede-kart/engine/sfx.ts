/** Bruitages synthétisés (Web Audio), aucun fichier son. À démarrer sur un geste de l'utilisateur. */
const MUTE_KEY = 'dk-mute'
const readMute = () => {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

export class Sfx {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private engine: OscillatorNode | null = null
  private engineFilter: BiquadFilterNode | null = null
  private engineGain: GainNode | null = null
  private drift: OscillatorNode | null = null
  private driftGain: GainNode | null = null
  private _muted = readMute()

  get muted() {
    return this._muted
  }

  /** Coupe / remet le son (mémorisé sur ce téléphone). */
  setMuted(m: boolean) {
    this._muted = m
    try {
      localStorage.setItem(MUTE_KEY, m ? '1' : '0')
    } catch {
      /* stockage indisponible : réglage pour cette partie seulement */
    }
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.7, this.ctx.currentTime, 0.05)
  }

  start() {
    if (this.ctx) return
    try {
      const ctx = new AudioContext()
      this.ctx = ctx
      this.master = ctx.createGain()
      this.master.gain.value = this._muted ? 0 : 0.7
      this.master.connect(ctx.destination)
      // moteur : ronronnement grave (triangle) adouci par un filtre passe-bas
      this.engine = ctx.createOscillator()
      this.engine.type = 'triangle'
      this.engineFilter = ctx.createBiquadFilter()
      this.engineFilter.type = 'lowpass'
      this.engineFilter.frequency.value = 300
      this.engineGain = ctx.createGain()
      this.engineGain.gain.value = 0
      this.engine.connect(this.engineFilter).connect(this.engineGain).connect(this.master)
      this.engine.start()
      // dérapage : léger sifflement (sinus)
      this.drift = ctx.createOscillator()
      this.drift.type = 'sine'
      this.driftGain = ctx.createGain()
      this.driftGain.gain.value = 0
      this.drift.connect(this.driftGain).connect(this.master)
      this.drift.start()
    } catch {
      this.ctx = null
    }
  }

  /** speed 0..1 (fraction de la vitesse max), level = palier de dérapage 0..3 (-1 = pas de dérapage). */
  update(speed: number, level: number) {
    if (!this.ctx || !this.engine || !this.engineFilter || !this.engineGain || !this.drift || !this.driftGain) return
    const t = this.ctx.currentTime
    const s = Math.min(1, Math.max(0, speed))
    this.engine.frequency.setTargetAtTime(45 + s * 70, t, 0.08)
    this.engineFilter.frequency.setTargetAtTime(250 + s * 350, t, 0.1)
    this.engineGain.gain.setTargetAtTime(0.012 + s * 0.02, t, 0.15)
    this.drift.frequency.setTargetAtTime(level < 0 ? 300 : 380 + level * 90, t, 0.05)
    this.driftGain.gain.setTargetAtTime(level < 0 ? 0 : 0.012, t, 0.05)
  }

  private tone(from: number, to: number, dur: number, type: OscillatorType = 'triangle', vol = 0.06) {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const o = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    o.type = type
    o.frequency.setValueAtTime(from, t)
    o.frequency.exponentialRampToValueAtTime(to, t + dur)
    g.gain.setValueAtTime(vol, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    o.connect(g).connect(this.master ?? this.ctx.destination)
    o.start(t)
    o.stop(t + dur)
  }

  beep(go: boolean) {
    this.tone(go ? 880 : 440, go ? 880 : 440, go ? 0.5 : 0.18)
  }
  boost(level: number) {
    this.tone(300, 900 + level * 300, 0.35 + level * 0.1, 'triangle', 0.05)
  }
  bump() {
    this.tone(120, 60, 0.12, 'triangle', 0.1)
  }
  lap() {
    this.tone(660, 990, 0.25, 'triangle')
  }
  box() {
    this.tone(520, 1040, 0.15, 'square', 0.05)
  }
  pick() {
    this.tone(784, 1568, 0.2, 'triangle')
  }
  launch() {
    this.tone(400, 160, 0.25, 'triangle', 0.05)
  }
  hit() {
    this.tone(700, 90, 0.6, 'triangle', 0.05)
  }
  jump() {
    this.tone(300, 700, 0.3, 'triangle', 0.07)
  }
  pop() {
    this.tone(1200, 300, 0.12, 'triangle', 0.08)
  }

  stop() {
    void this.ctx?.close()
    this.ctx = null
  }
}
