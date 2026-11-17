// Génère les effets sonores de la promo par synthèse pure (aucun fichier téléchargé).
// Sortie : public/sfx/*.wav, WAV PCM 48 kHz 16 bits mono, normalisé à -3 dBFS.
// Usage : npm run sfx
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SR = 48000
const TARGET_PEAK = 10 ** (-3 / 20) // -3 dBFS
const FADE = 0.002 // fondu d'entrée/sortie 2 ms
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sfx')

const n = (sec) => Math.round(sec * SR)

/** PRNG déterministe (mulberry32) → bruit reproductible d'un build à l'autre. */
function makeRand(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1 // [-1, 1]
  }
}

/** Sinus à fréquence (éventuellement variable) et enveloppe fournies en fonction de t (s). */
function tone(dur, freq, env) {
  const out = new Float64Array(n(dur))
  let phase = 0
  for (let i = 0; i < out.length; i++) {
    const t = i / SR
    phase += (2 * Math.PI * freq(t)) / SR
    out[i] = Math.sin(phase) * env(t)
  }
  return out
}

/** Bruit blanc passé dans un filtre passe-bande à state-variable (Chamberlin), fc variable. */
function bandNoise(dur, { fc, q = 1, env, seed = 1 }) {
  const rand = makeRand(seed)
  const out = new Float64Array(n(dur))
  const damp = 1 / q
  let low = 0
  let band = 0
  for (let i = 0; i < out.length; i++) {
    const t = i / SR
    const f = 2 * Math.sin((Math.PI * fc(t)) / SR)
    const x = rand()
    low += f * band
    const high = x - low - damp * band
    band += f * high
    out[i] = band * env(t)
  }
  return out
}

/** Additionne src dans dst à partir de offset (s), avec un gain. */
function mix(dst, src, offset = 0, gain = 1) {
  const start = n(offset)
  for (let i = 0; i < src.length; i++) {
    const j = start + i
    if (j >= 0 && j < dst.length) dst[j] += src[i] * gain
  }
  return dst
}

/** Crée une version retardée (écho) du signal, ajoutée au signal sec. */
function echo(buf, delay, gain) {
  return mix(Float64Array.from(buf), buf, delay, gain)
}

/** Note de marimba : fondamentale + harmonique 4 (plus courte), attaque percussive. */
function marimba(dur, freq, decay = 0.13, vel = 1) {
  const attack = (t) => Math.min(1, t / 0.003)
  const fund = tone(dur, () => freq, (t) => attack(t) * Math.exp(-t / decay) * vel)
  const harm = tone(dur, () => freq * 4, (t) => attack(t) * Math.exp(-t / (decay * 0.25)) * 0.25 * vel)
  return mix(new Float64Array(n(dur)), fund, 0, 1).map((v, i) => v + harm[i])
}

function finish(name, samples) {
  const len = samples.length
  const fadeN = n(FADE)
  for (let i = 0; i < fadeN && i < len; i++) {
    const g = i / fadeN
    samples[i] *= g
    samples[len - 1 - i] *= g
  }
  let peak = 0
  for (const v of samples) peak = Math.max(peak, Math.abs(v))
  const scale = peak > 0 ? TARGET_PEAK / peak : 1
  writeWav(join(OUT_DIR, name), samples, scale)
  return { name, dur: len / SR, peakDb: 20 * Math.log10(TARGET_PEAK) }
}

function writeWav(path, samples, scale) {
  const dataBytes = samples.length * 2
  const buf = Buffer.alloc(44 + dataBytes)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(36 + dataBytes, 4)
  buf.write('WAVE', 8, 'ascii')
  buf.write('fmt ', 12, 'ascii')
  buf.writeUInt32LE(16, 16) // taille du chunk fmt (PCM)
  buf.writeUInt16LE(1, 20) // format PCM
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(SR, 24)
  buf.writeUInt32LE(SR * 2, 28) // byte rate
  buf.writeUInt16LE(2, 32) // block align
  buf.writeUInt16LE(16, 34) // bits par échantillon
  buf.write('data', 36, 'ascii')
  buf.writeUInt32LE(dataBytes, 40)
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i] * scale))
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2)
  }
  writeFileSync(path, buf)
}

const sounds = {
  // Clic doux de toucher d'écran : sinus aigu qui chute vite + petit bruit filtré.
  'tap.wav': () => {
    const dur = 0.06
    const buf = new Float64Array(n(dur))
    mix(buf, tone(dur, (t) => 2400 + 800 * Math.exp(-t / 0.008), (t) => Math.exp(-t / 0.014)))
    mix(buf, bandNoise(dur, { fc: () => 3200, q: 2, env: (t) => Math.exp(-t / 0.005), seed: 11 }), 0, 0.4)
    return buf
  },

  // Souffle de transition : bruit passe-bande dont la fréquence balaie, enveloppe en cloche.
  'whoosh.wav': () => {
    const dur = 0.4
    return bandNoise(dur, {
      fc: (t) => 400 * Math.pow(2500 / 400, t / dur),
      q: 1.2,
      env: (t) => Math.pow(Math.sin((Math.PI * t) / dur), 2),
      seed: 22,
    })
  },

  // Bulle : sinus avec glissando montant rapide (300 → 1200 Hz) puis chute d'enveloppe.
  'pop.wav': () => {
    const dur = 0.12
    return tone(
      dur,
      (t) => 300 + 900 * (1 - Math.exp(-t / 0.02)),
      (t) => Math.min(1, t / 0.002) * Math.exp(-t / 0.04),
    )
  },

  // Feuille qui remonte : bruit filtré montant, plus doux (enveloppe large, Q bas).
  'swoosh-up.wav': () => {
    const dur = 0.3
    return bandNoise(dur, {
      fc: (t) => 500 * Math.pow(3000 / 500, t / dur),
      q: 0.9,
      env: (t) => Math.pow(Math.sin((Math.PI * t) / dur), 1.5),
      seed: 33,
    })
  },

  // Petit arpège majeur joyeux (C5 E5 G5) en marimba, ~500 ms.
  'success.wav': () => {
    const dur = 0.5
    const buf = new Float64Array(n(dur))
    mix(buf, marimba(0.3, 523.25, 0.1), 0)
    mix(buf, marimba(0.3, 659.25, 0.1), 0.09)
    mix(buf, marimba(0.4, 783.99, 0.14), 0.18)
    return buf
  },

  // Jingle final ~1,8 s : arpège ascendant C5 E5 G5 C6 puis accord brillant, léger écho.
  'jingle.wav': () => {
    const dur = 1.8
    const buf = new Float64Array(n(dur))
    const arp = [523.25, 659.25, 783.99, 1046.5]
    arp.forEach((f, i) => mix(buf, marimba(0.4, f, 0.2, 0.9), i * 0.12))
    // Accord final : sinus + 2e et 3e partiels pour un timbre brillant.
    const chord = [523.25, 659.25, 783.99, 1046.5]
    const chordEnv = (t) => Math.min(1, t / 0.005) * Math.exp(-t / 0.7)
    for (const f of chord) {
      const d = 1.3
      mix(buf, tone(d, () => f, chordEnv), 0.5, 0.22)
      mix(buf, tone(d, () => f * 2, (t) => chordEnv(t) * 0.25), 0.5, 0.22)
      mix(buf, tone(d, () => f * 3, (t) => chordEnv(t) * 0.1), 0.5, 0.22)
    }
    const withEcho = echo(echo(buf, 0.22, 0.35), 0.44, 0.15)
    return withEcho.subarray(0, n(dur))
  },

  // Frappe clavier : claquement court (bruit filtré + petit clic sinus).
  'type.wav': () => {
    const dur = 0.04
    const buf = new Float64Array(n(dur))
    mix(buf, bandNoise(dur, { fc: () => 2400, q: 1.5, env: (t) => Math.exp(-t / 0.006), seed: 44 }), 0, 1)
    mix(buf, tone(dur, () => 1800, (t) => Math.exp(-t / 0.004)), 0, 0.5)
    return buf
  },
}

mkdirSync(OUT_DIR, { recursive: true })
for (const [file, make] of Object.entries(sounds)) {
  const { name, dur } = finish(file, make())
  const bytes = 44 + n(dur) * 2
  console.log(`${name.padEnd(16)} ${dur.toFixed(3)} s  ${bytes} octets  -> ${join(OUT_DIR, name)}`)
}
