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

/** Ramène un composant à une énergie (RMS) donnée avant mixage : équilibre prévisible entre couches. */
function norm(buf, rms = 0.25) {
  let e = 0
  for (const v of buf) e += v * v
  const cur = Math.sqrt(e / Math.max(1, buf.length)) || 1
  const g = rms / cur
  return buf.map((v) => v * g)
}

/** Passe-bas à un pôle, fréquence de coupure variable fc(t) (sons « étouffés »). */
function lowpass(buf, fc) {
  const out = new Float64Array(buf.length)
  let y = 0
  for (let i = 0; i < buf.length; i++) {
    const a = 1 - Math.exp((-2 * Math.PI * fc(i / SR)) / SR)
    y += a * (buf[i] - y)
    out[i] = y
  }
  return out
}

/** Gouttelettes aiguës (éclats de glace / grelots) : sinus brefs à instants aléatoires, densité décroissante. */
function tinkles(dur, { count, fmin, fmax, decay, spread, seed }) {
  const rand = makeRand(seed)
  const buf = new Float64Array(n(dur))
  for (let k = 0; k < count; k++) {
    const at = Math.min(dur - 0.12, -Math.log(1 - (rand() + 1) / 2 * 0.98) * spread)
    const f = fmin + ((rand() + 1) / 2) * (fmax - fmin)
    const d = decay * (0.5 + (rand() + 1) / 2)
    const amp = (0.25 + (rand() + 1) / 2 * 0.75) * Math.exp(-at / (spread * 1.3))
    mix(buf, tone(0.12, () => f, (t) => Math.min(1, t / 0.001) * Math.exp(-t / d)), at, amp)
  }
  return buf
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

  // ── Vidéo de Noël v2 ─────────────────────────────────────────────────────────────────────────────────
  // Vent qui monte (1,5 s) : souffle filtré dont la fréquence grimpe + sifflement + grondement grave.
  'wind-rise.wav': () => {
    const dur = 1.5
    const rise = (t) => Math.pow(t / dur, 1.7)
    const buf = new Float64Array(n(dur))
    mix(buf, norm(bandNoise(dur, { fc: (t) => 260 + 1900 * Math.pow(t / dur, 2), q: 3.5, env: (t) => rise(t), seed: 61 }), 0.3))
    mix(buf, norm(tone(dur, (t) => 430 + 950 * Math.pow(t / dur, 2) + 22 * Math.sin(t * 9), (t) => rise(t)), 0.1))
    mix(buf, norm(bandNoise(dur, { fc: () => 140, q: 1, env: (t) => 0.6 * rise(t), seed: 62 }), 0.2))
    return buf
  },

  // Gros souffle (1,5 s) : rafale d'attaque brutale, retombe en soufflerie, avec une pulsation de bourrasque.
  'gust.wav': () => {
    const dur = 1.5
    const gate = (t) => Math.min(1, t / 0.035) * Math.exp(-t / 0.55) * (0.82 + 0.18 * Math.sin(2 * Math.PI * 6.5 * t))
    const buf = new Float64Array(n(dur))
    mix(buf, norm(bandNoise(dur, { fc: (t) => 650 - 330 * Math.min(1, t / 1.2), q: 0.8, env: gate, seed: 63 }), 0.3))
    mix(buf, norm(bandNoise(dur, { fc: () => 3200, q: 0.9, env: (t) => Math.min(1, t / 0.02) * Math.exp(-t / 0.16), seed: 64 }), 0.16))
    mix(buf, norm(tone(dur, (t) => 40 + 55 * Math.exp(-t / 0.18), (t) => Math.min(1, t / 0.004) * Math.exp(-t / 0.28)), 0.22))
    return buf
  },

  // Craquement de glace : claquement sec + tic de verre + petits cliquetis. 1 = petit, 2 = moyen, 3 = gros (CRAC).
  ...Object.fromEntries(
    [
      ['crack1.wav', 0.38, 71, 0, 5200],
      ['crack2.wav', 0.46, 72, 0.5, 4300],
      ['crack3.wav', 0.9, 73, 1, 3400],
    ].map(([name, dur, seed, big, fc]) => [
      name,
      () => {
        const buf = new Float64Array(n(dur))
        mix(buf, norm(bandNoise(dur, { fc: () => fc, q: 1.4, env: (t) => Math.min(1, t / 0.0008) * Math.exp(-t / (0.009 + big * 0.02)), seed }), 0.34))
        mix(buf, norm(tone(dur, (t) => 600 + (1700 + big * 600) * Math.exp(-t / 0.018), (t) => Math.exp(-t / (0.03 + big * 0.04))), 0.2))
        mix(buf, norm(tinkles(dur, { count: 9 + big * 14, fmin: 2400, fmax: 8200, decay: 0.012, spread: 0.1 + big * 0.12, seed: seed + 5 }), 0.1), 0.02)
        if (big) mix(buf, norm(tone(dur, (t) => 48 + 90 * Math.exp(-t / 0.12), (t) => Math.min(1, t / 0.004) * Math.exp(-t / 0.3)), 0.3))
        return buf
      },
    ]),
  ),

  // Éclat de glace / de verre (1,4 s) : explosion sèche + pluie de tintements aigus + grondement.
  'shatter.wav': () => {
    const dur = 1.4
    const buf = new Float64Array(n(dur))
    mix(buf, norm(bandNoise(dur, { fc: (t) => 4200 - 1600 * Math.min(1, t / 0.4), q: 0.8, env: (t) => Math.min(1, t / 0.0012) * Math.exp(-t / 0.075), seed: 81 }), 0.34))
    mix(buf, norm(tone(dur, (t) => 36 + 110 * Math.exp(-t / 0.1), (t) => Math.min(1, t / 0.003) * Math.exp(-t / 0.22)), 0.3))
    mix(buf, norm(tinkles(dur, { count: 130, fmin: 2200, fmax: 9500, decay: 0.03, spread: 0.32, seed: 82 }), 0.2), 0.01)
    mix(buf, norm(bandNoise(dur, { fc: () => 1400, q: 0.7, env: (t) => Math.exp(-t / 0.3) * Math.min(1, t / 0.01), seed: 83 }), 0.1))
    return echo(buf, 0.11, 0.18).subarray(0, n(dur))
  },

  // Tampon encreur (0,3 s) : choc mat + claquement + clic.
  'stamp.wav': () => {
    const dur = 0.3
    const buf = new Float64Array(n(dur))
    mix(buf, norm(tone(dur, (t) => 70 + 150 * Math.exp(-t / 0.035), (t) => Math.min(1, t / 0.002) * Math.exp(-t / 0.07)), 0.34))
    mix(buf, norm(bandNoise(dur, { fc: () => 1700, q: 0.9, env: (t) => Math.exp(-t / 0.022), seed: 91 }), 0.22))
    mix(buf, norm(tone(dur, () => 980, (t) => Math.exp(-t / 0.006)), 0.08))
    return buf
  },

  // Toc (0,2 s) : jointure sur un bloc de glace : sinus bref + partiels vitreux + clic. Deux « toc » = 2 appels.
  'knock.wav': () => {
    const dur = 0.2
    const buf = new Float64Array(n(dur))
    for (const [m, g, d] of [[1, 1, 0.05], [2, 0.5, 0.032], [3.1, 0.28, 0.02], [4.6, 0.12, 0.012]]) {
      mix(buf, tone(dur, () => 640 * m, (t) => Math.min(1, t / 0.0008) * Math.exp(-t / d)), 0, g)
    }
    mix(buf, norm(tone(dur, (t) => 170 + 120 * Math.exp(-t / 0.02), (t) => Math.exp(-t / 0.04)), 0.12))
    mix(buf, norm(bandNoise(dur, { fc: () => 2600, q: 1.2, env: (t) => Math.exp(-t / 0.004), seed: 92 }), 0.1))
    return buf
  },

  // Crissement de freinage (0,9 s) : sifflement saturé qui glisse vers le grave + grain de gomme.
  'skid.wav': () => {
    const dur = 0.9
    const buf = new Float64Array(n(dur))
    let ph = 0
    const sq = new Float64Array(n(dur))
    for (let i = 0; i < sq.length; i++) {
      const t = i / SR
      const f0 = 2100 * Math.exp(-t / 0.55) + 780 + 70 * Math.sin(t * 38)
      ph += (2 * Math.PI * f0) / SR
      sq[i] = (Math.sin(ph) + 0.5 * Math.sin(3 * ph) + 0.28 * Math.sin(5 * ph)) * (0.7 + 0.3 * Math.sin(t * 61)) * Math.min(1, t / 0.02) * Math.min(1, (dur - t) / 0.18)
    }
    mix(buf, norm(sq, 0.28))
    mix(buf, norm(bandNoise(dur, { fc: (t) => 3000 - 1500 * (t / dur), q: 4, env: (t) => Math.min(1, t / 0.02) * Math.min(1, (dur - t) / 0.2), seed: 93 }), 0.2))
    return buf
  },

  // Gros impact grave (1,0 s) : l'éclat de Noël, la hotte qui tombe.
  'boom.wav': () => {
    const dur = 1.0
    const buf = new Float64Array(n(dur))
    mix(buf, norm(tone(dur, (t) => 36 + 90 * Math.exp(-t / 0.1), (t) => Math.min(1, t / 0.003) * Math.exp(-t / 0.4)), 0.4))
    mix(buf, norm(lowpass(bandNoise(dur, { fc: () => 300, q: 0.7, env: (t) => Math.exp(-t / 0.26), seed: 94 }), () => 500), 0.2))
    mix(buf, norm(bandNoise(dur, { fc: () => 3400, q: 0.8, env: (t) => Math.exp(-t / 0.03), seed: 95 }), 0.14))
    return buf
  },

  // Glaçon vu de l'intérieur (2,4 s) : grondement étouffé qui enfle + 2 bourdons + tintements lointains.
  'freeze-hum.wav': () => {
    const dur = 2.4
    const swell = (t) => 0.55 + 0.45 * Math.sin((Math.PI * t) / dur) ** 2
    const buf = new Float64Array(n(dur))
    mix(buf, norm(lowpass(bandNoise(dur, { fc: () => 200, q: 0.8, env: swell, seed: 96 }), (t) => 160 + 140 * (t / dur)), 0.3))
    mix(buf, norm(tone(dur, (t) => 82.4 * (1 + 0.02 * t), (t) => swell(t) * (0.8 + 0.2 * Math.sin(t * 31))), 0.2))
    mix(buf, norm(tone(dur, (t) => 123.5 * (1 + 0.02 * t), (t) => swell(t) * (0.8 + 0.2 * Math.sin(t * 23))), 0.1))
    mix(buf, norm(lowpass(tinkles(dur, { count: 10, fmin: 1500, fmax: 4200, decay: 0.2, spread: 1.1, seed: 97 }), () => 1800), 0.05))
    return buf
  },

  // Traîneau (1,4 s) : grelots secoués qui passent (enveloppe en cloche) + souffle.
  'sleigh.wav': () => {
    const dur = 1.4
    const buf = new Float64Array(n(dur))
    const rand = makeRand(101)
    for (let k = 0; k < 46; k++) {
      const at = ((rand() + 1) / 2) * 1.2
      const bell = Math.sin((Math.PI * Math.min(1, at / 1.25))) ** 0.8
      const f = 2800 + ((rand() + 1) / 2) * 4400
      for (const [m, g] of [[1, 1], [2.76, 0.4], [5.4, 0.15]]) {
        mix(buf, tone(0.3, () => f * m, (t) => Math.min(1, t / 0.001) * Math.exp(-t / (0.05 + ((rand() + 1) / 2) * 0.1))), at, g * bell * 0.35)
      }
    }
    const air = bandNoise(dur, { fc: (t) => 700 + 1800 * Math.sin((Math.PI * t) / dur), q: 1, env: (t) => Math.sin((Math.PI * t) / dur) ** 2, seed: 102 })
    return mix(norm(buf, 0.22), norm(air, 0.1))
  },

  // Page de calendrier arrachée (0,3 s) : bruit haché, aigu, qui s'éteint.
  'rip.wav': () => {
    const dur = 0.3
    const rand = makeRand(103)
    const raw = bandNoise(dur, { fc: () => 3800, q: 0.7, env: (t) => Math.min(1, t / 0.006) * Math.exp(-t / 0.11), seed: 104 })
    let gain = 1
    return raw.map((v, i) => {
      if (i % Math.round(SR * 0.004) === 0) gain = 0.15 + ((rand() + 1) / 2) * 0.85
      return v * gain
    })
  },

  // Montée de tension (0,5 s) : souffle qui s'aiguise, juste avant un silence d'un temps.
  'riser.wav': () => {
    const dur = 0.5
    const buf = new Float64Array(n(dur))
    mix(buf, norm(bandNoise(dur, { fc: (t) => 500 + 3600 * Math.pow(t / dur, 2), q: 2.5, env: (t) => Math.pow(t / dur, 2), seed: 105 }), 0.3))
    mix(buf, norm(tone(dur, (t) => 300 + 900 * Math.pow(t / dur, 2), (t) => Math.pow(t / dur, 2)), 0.1))
    return buf
  },
}

mkdirSync(OUT_DIR, { recursive: true })
for (const [file, make] of Object.entries(sounds)) {
  const { name, dur } = finish(file, make())
  const bytes = 44 + n(dur) * 2
  console.log(`${name.padEnd(16)} ${dur.toFixed(3)} s  ${bytes} octets  -> ${join(OUT_DIR, name)}`)
}
