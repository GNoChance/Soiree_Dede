// Petite boîte à musique de la vidéo d'annonce de Noël (composition NoelIntro), par synthèse pure :
// refrain de « Vive le vent » (Jingle Bells, 1857, domaine public) + grelots, aucun fichier téléchargé.
// Sortie : public/sfx/noel-music.mp3 (mono, 96 kb/s), via le ffmpeg fourni par Remotion.
// Usage : node scripts/make-noel-music.mjs [durée en secondes, défaut 36]
//   1 mesure de grelots + 16 mesures de refrain + accord final qui résonne 2 s : le tempo s'adapte à la durée.
import { execSync } from 'node:child_process'
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SECONDS = Number(process.argv[2] ?? 36)
const SR = 32000
const TAIL = 2
const BEAT = (SECONDS - TAIL) / (17 * 4) // 0,5 s à 36 s (120 à la noire)
const n = (s) => Math.round(s * SR)
const out = new Float64Array(n(SECONDS))

const HZ = { C: 523.25, D: 587.33, E: 659.25, F: 698.46, G: 783.99 }
/** Refrain : [note, durée en temps]. */
const A = [['E', 1], ['E', 1], ['E', 2], ['E', 1], ['E', 1], ['E', 2], ['E', 1], ['G', 1], ['C', 1.5], ['D', 0.5], ['E', 4]]
const B = [['F', 1], ['F', 1], ['F', 1.5], ['F', 0.5], ['F', 1], ['E', 1], ['E', 1], ['E', 0.5], ['E', 0.5]]
const MELODY = [...A, ...B, ['E', 1], ['D', 1], ['D', 1], ['E', 1], ['D', 2], ['G', 2], ...A, ...B, ['G', 1], ['G', 1], ['F', 1], ['D', 1], ['C', 4]]
/** Basse (fondamentale, quinte) de chaque mesure. */
const CHORDS = ['C', 'C', 'C', 'C', 'F', 'C', 'G', 'G', 'C', 'C', 'C', 'C', 'F', 'C', 'G', 'C']
const BASS = { C: [130.81, 196.0, 329.63], F: [174.61, 261.63, 349.23], G: [196.0, 293.66, 392.0] }

let seed = 2026
const rand = () => {
  seed = (seed + 0x6d2b79f5) >>> 0
  let t = seed
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** Somme de partiels sinus amortis [multiple, gain, amortissement en s] à partir de `at` (s). */
function pluck(at, freq, partials, gain, len = 2.2) {
  const start = n(at)
  const N = Math.min(n(len), out.length - start)
  for (const [mult, g, decay] of partials) {
    const w = (2 * Math.PI * freq * mult) / SR
    for (let i = 0; i < N; i++) {
      const t = i / SR
      out[start + i] += Math.sin(w * i) * Math.min(1, t / 0.003) * Math.exp(-t / decay) * g * gain
    }
  }
}
/** Lamelle de boîte à musique : fondamentale longue, harmoniques brèves, doublure à l'octave. */
const box = (at, freq, gain = 1) => {
  pluck(at, freq, [[1, 1, 0.7], [2, 0.3, 0.3], [3, 0.1, 0.12], [5.4, 0.06, 0.04]], gain * 0.5)
  pluck(at, freq * 2, [[1, 1, 0.35]], gain * 0.12)
}
/** Note grave douce (accompagnement). */
const soft = (at, freq, gain = 1) => pluck(at, freq, [[1, 1, 0.38], [2, 0.18, 0.15]], gain * 0.22, 1.4)
/** Coup de grelots : quelques sinus très aigus, légèrement désaccordés, très brefs. */
const bells = (at, gain = 1) => {
  for (const f of [3150, 4270, 5480, 6630, 7900]) {
    pluck(at + rand() * 0.012, f * (0.985 + rand() * 0.03), [[1, 1, 0.045 + rand() * 0.03]], gain * 0.035 * (0.6 + rand() * 0.8), 0.4)
  }
}

// Mesure 0 : les grelots arrivent (croches, de plus en plus fort) + petite montée.
for (let k = 0; k < 8; k++) bells(k * BEAT * 0.5, 0.5 + k * 0.14)
;[392.0, 523.25, 659.25, 783.99].forEach((f, k) => box((2 + k * 0.5) * BEAT, f, 0.55))

// Refrain.
const T0 = 4 * BEAT
let beat = 0
for (const [note, len] of MELODY) {
  box(T0 + beat * BEAT, HZ[note], 1)
  beat += len
}
CHORDS.forEach((c, bar) => {
  const [root, fifth, third] = BASS[c]
  const t = T0 + bar * 4 * BEAT
  soft(t, root, 1)
  soft(t + 2 * BEAT, fifth, 0.8)
  soft(t + BEAT, third, 0.45)
  soft(t + 3 * BEAT, third, 0.45)
  for (let k = 0; k < 4; k++) bells(t + k * BEAT, k % 2 ? 1 : 0.6)
})

// Accord final arpégé + derniers grelots.
const END = T0 + 16 * 4 * BEAT
;[523.25, 659.25, 783.99, 1046.5].forEach((f, k) => box(END + k * 0.07, f, 0.8))
soft(END, 130.81, 1.2)
for (let k = 0; k < 6; k++) bells(END + k * 0.11, 1 - k * 0.13)

// Léger écho, fondu de sortie, normalisation à -3 dBFS.
const dry = Float64Array.from(out)
const d = n(0.19)
for (let i = d; i < out.length; i++) out[i] += dry[i - d] * 0.22
const fade = n(0.5)
for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade
let peak = 0
for (const v of out) peak = Math.max(peak, Math.abs(v))
const scale = 10 ** (-3 / 20) / peak

const wav = Buffer.alloc(44 + out.length * 2)
wav.write('RIFF', 0, 'ascii')
wav.writeUInt32LE(36 + out.length * 2, 4)
wav.write('WAVEfmt ', 8, 'ascii')
wav.writeUInt32LE(16, 16)
wav.writeUInt16LE(1, 20)
wav.writeUInt16LE(1, 22)
wav.writeUInt32LE(SR, 24)
wav.writeUInt32LE(SR * 2, 28)
wav.writeUInt16LE(2, 32)
wav.writeUInt16LE(16, 34)
wav.write('data', 36, 'ascii')
wav.writeUInt32LE(out.length * 2, 40)
for (let i = 0; i < out.length; i++) wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, out[i] * scale)) * 32767), 44 + i * 2)

mkdirSync(join(ROOT, 'out'), { recursive: true })
const tmp = join(ROOT, 'out', 'noel-music.wav')
const mp3 = join(ROOT, 'public', 'sfx', 'noel-music.mp3')
writeFileSync(tmp, wav)
execSync(`npx remotion ffmpeg -y -loglevel error -i "${tmp}" -ac 1 -b:a 96k "${mp3}"`, { cwd: ROOT, stdio: 'inherit' })
console.log(`noel-music.mp3  ${SECONDS} s  ${(60 / BEAT).toFixed(1)} à la noire  ${statSync(mp3).size} octets`)
