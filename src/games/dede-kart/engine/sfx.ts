/** Bruitages synthétisés (Web Audio), aucun fichier son. À démarrer sur un geste de l'utilisateur. */
export class Sfx {
  private ctx: AudioContext | null = null
  private engine: OscillatorNode | null = null
  private engineGain: GainNode | null = null
  private drift: OscillatorNode | null = null
  private driftGain: GainNode | null = null

  start() {
    if (this.ctx) return
    try {
      const ctx = new AudioContext()
      this.ctx = ctx
      const mk = (type: OscillatorType): [OscillatorNode, GainNode] => {
        const o = ctx.createOscillator()
        const g = ctx.createGain()
        o.type = type
        g.gain.value = 0
        o.connect(g).connect(ctx.destination)
        o.start()
        return [o, g]
      }
      ;[this.engine, this.engineGain] = mk('sawtooth')
      ;[this.drift, this.driftGain] = mk('square')
    } catch {
      this.ctx = null
    }
  }

  /** speed 0..1 (fraction de la vitesse max), level = palier de dérapage 0..3 (-1 = pas de dérapage). */
  update(speed: number, level: number) {
    if (!this.ctx || !this.engine || !this.engineGain || !this.drift || !this.driftGain) return
    const t = this.ctx.currentTime
    this.engine.frequency.setTargetAtTime(55 + speed * 130, t, 0.05)
    this.engineGain.gain.setTargetAtTime(0.035, t, 0.1)
    this.drift.frequency.setTargetAtTime(level < 0 ? 200 : 260 + level * 140, t, 0.03)
    this.driftGain.gain.setTargetAtTime(level < 0 ? 0 : 0.018, t, 0.03)
  }

  private tone(from: number, to: number, dur: number, type: OscillatorType = 'square', vol = 0.08) {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const o = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    o.type = type
    o.frequency.setValueAtTime(from, t)
    o.frequency.exponentialRampToValueAtTime(to, t + dur)
    g.gain.setValueAtTime(vol, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    o.connect(g).connect(this.ctx.destination)
    o.start(t)
    o.stop(t + dur)
  }

  beep(go: boolean) {
    this.tone(go ? 880 : 440, go ? 880 : 440, go ? 0.5 : 0.18)
  }
  boost(level: number) {
    this.tone(300, 900 + level * 300, 0.35 + level * 0.1, 'sawtooth', 0.07)
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
    this.tone(400, 160, 0.25, 'sawtooth', 0.06)
  }
  hit() {
    this.tone(700, 90, 0.6, 'sawtooth', 0.08)
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
