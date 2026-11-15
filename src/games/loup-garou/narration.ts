import { useSyncExternalStore } from 'react'
import { useSettings } from '@/store/settings'
import { CAUSE_LABEL, ROLE_INFO, type LgDeath, type LgStep, type LgWinner } from './types'

/**
 * Narration du Loup-garou (téléphone de l'HÔTE uniquement) :
 * - voix de synthèse (Web Speech API, voix fr-FR préférée, silencieux si absent) ;
 * - ambiance synthétisée (Web Audio : vent, hurlement, cloche, chouette).
 *
 * RÈGLE D'OR : les phrases ne reçoivent que des informations PUBLIQUES (nom des
 * étapes de la composition, morts et rôles révélés). Jamais un rôle secret.
 */

/* -------------------------------------------------------------------------- */
/* Interrupteur voix (persistant, partagé entre composants)                    */
/* -------------------------------------------------------------------------- */

const KEY = 'dede:lg-voice'
let voiceOn = (() => {
  try {
    return localStorage.getItem(KEY) !== '0'
  } catch {
    return true
  }
})()
const listeners = new Set<() => void>()

export function setVoiceEnabled(v: boolean) {
  voiceOn = v
  try {
    localStorage.setItem(KEY, v ? '1' : '0')
  } catch {
    /* ignore */
  }
  if (!v) {
    stopSpeech()
    stopWind()
  }
  listeners.forEach((l) => l())
}

export function useVoiceEnabled(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => voiceOn,
    () => voiceOn,
  )
}

/**
 * L'écran de résultats (Summary) remplace Play dès la fin : Play note ici que ce
 * téléphone est celui du conteur, Summary annonce alors la victoire (une fois).
 */
export const narrationSession: { host: boolean; spoken: Set<string> } = { host: false, spoken: new Set() }

/* -------------------------------------------------------------------------- */
/* Voix                                                                        */
/* -------------------------------------------------------------------------- */

const synth = (): SpeechSynthesis | null => (typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null)

let voice: SpeechSynthesisVoice | null = null
function pickVoice() {
  const s = synth()
  if (!s) return
  const voices = s.getVoices()
  voice =
    voices.find((v) => v.lang === 'fr-FR' && /google|thomas|amelie|audrey|marie|hortense|denise/i.test(v.name)) ??
    voices.find((v) => v.lang === 'fr-FR') ??
    voices.find((v) => v.lang?.toLowerCase().startsWith('fr')) ??
    null
}
if (typeof window !== 'undefined' && synth()) {
  pickVoice()
  try {
    synth()!.addEventListener('voiceschanged', pickVoice)
  } catch {
    /* vieux Safari */
  }
}

export function speechAvailable(): boolean {
  return Boolean(synth())
}

/** Lit des phrases à la suite (file d'attente). `interrupt` coupe ce qui est en cours. */
export function speak(lines: string[], interrupt = false) {
  const s = synth()
  if (!s || !voiceOn) return
  try {
    if (interrupt) s.cancel()
    if (!voice) pickVoice()
    for (const line of lines) {
      if (!line) continue
      const u = new SpeechSynthesisUtterance(line)
      u.lang = 'fr-FR'
      if (voice) u.voice = voice
      u.rate = 0.92
      u.pitch = 0.85
      u.volume = 1
      s.speak(u)
    }
  } catch {
    /* synthèse indisponible : silence */
  }
}

export function stopSpeech() {
  try {
    synth()?.cancel()
  } catch {
    /* ignore */
  }
}

/* -------------------------------------------------------------------------- */
/* Ambiance Web Audio                                                          */
/* -------------------------------------------------------------------------- */

let ctx: AudioContext | null = null
function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    try {
      ctx = new Ctor()
    } catch {
      return null
    }
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
  return ctx
}

const ambienceAllowed = () => voiceOn && useSettings.getState().sound

/** À appeler sur un geste (iOS) : débloque l'audio et la synthèse vocale. */
export function unlockNarration() {
  audio()
  const s = synth()
  if (s && voiceOn) {
    try {
      const u = new SpeechSynthesisUtterance(' ')
      u.volume = 0
      s.speak(u)
    } catch {
      /* ignore */
    }
  }
}

function noiseBuffer(c: AudioContext, seconds: number): AudioBuffer {
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate)
  const d = buf.getChannelData(0)
  let last = 0
  for (let i = 0; i < d.length; i++) {
    // bruit brun (plus doux que le blanc)
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02
    d[i] = last * 3.5
  }
  return buf
}

let wind: { src: AudioBufferSourceNode; gain: GainNode; lfo: OscillatorNode } | null = null

/** Vent nocturne en boucle (fondu). */
export function startWind() {
  if (wind || !ambienceAllowed()) return
  const c = audio()
  if (!c) return
  try {
    const src = c.createBufferSource()
    src.buffer = noiseBuffer(c, 4)
    src.loop = true
    const filter = c.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = 500
    filter.Q.value = 0.8
    const lfo = c.createOscillator()
    const lfoGain = c.createGain()
    lfo.frequency.value = 0.13
    lfoGain.gain.value = 320
    lfo.connect(lfoGain).connect(filter.frequency)
    const gain = c.createGain()
    gain.gain.setValueAtTime(0.0001, c.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.16, c.currentTime + 2.5)
    src.connect(filter).connect(gain).connect(c.destination)
    src.start()
    lfo.start()
    wind = { src, gain, lfo }
  } catch {
    wind = null
  }
}

export function stopWind() {
  const c = ctx
  const w = wind
  wind = null
  if (!c || !w) return
  try {
    w.gain.gain.cancelScheduledValues(c.currentTime)
    w.gain.gain.setValueAtTime(Math.max(w.gain.gain.value, 0.0001), c.currentTime)
    w.gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 1.5)
    w.src.stop(c.currentTime + 1.6)
    w.lfo.stop(c.currentTime + 1.6)
  } catch {
    /* ignore */
  }
}

function voiceTone(c: AudioContext, start: number, from: number, peak: number, end: number, dur: number, gain: number) {
  const t0 = c.currentTime + start
  const o = c.createOscillator()
  const o2 = c.createOscillator()
  const vib = c.createOscillator()
  const vibGain = c.createGain()
  const g = c.createGain()
  const f = c.createBiquadFilter()
  o.type = 'sawtooth'
  o2.type = 'sine'
  f.type = 'lowpass'
  f.frequency.value = 1400
  vib.frequency.value = 5.5
  vibGain.gain.value = 9
  vib.connect(vibGain)
  vibGain.connect(o.frequency)
  vibGain.connect(o2.frequency)
  for (const osc of [o, o2]) {
    osc.frequency.setValueAtTime(from, t0)
    osc.frequency.exponentialRampToValueAtTime(peak, t0 + dur * 0.35)
    osc.frequency.setValueAtTime(peak, t0 + dur * 0.7)
    osc.frequency.exponentialRampToValueAtTime(end, t0 + dur)
  }
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(gain, t0 + dur * 0.3)
  g.gain.setValueAtTime(gain, t0 + dur * 0.7)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  o.connect(f)
  o2.connect(f)
  f.connect(g).connect(c.destination)
  for (const osc of [o, o2, vib]) {
    osc.start(t0)
    osc.stop(t0 + dur + 0.05)
  }
}

/** Hurlement stylisé (deux voix qui montent puis retombent). */
export function howl() {
  if (!ambienceAllowed()) return
  const c = audio()
  if (!c) return
  try {
    voiceTone(c, 0, 260, 520, 300, 2.6, 0.07)
    voiceTone(c, 0.5, 300, 620, 340, 2.4, 0.05)
  } catch {
    /* ignore */
  }
}

/** Cloche du matin (partiels inharmoniques qui résonnent). */
export function bell(strokes = 3) {
  if (!ambienceAllowed()) return
  const c = audio()
  if (!c) return
  try {
    for (let k = 0; k < strokes; k++) {
      const t0 = c.currentTime + k * 1.1
      for (const [ratio, g] of [
        [1, 0.16],
        [2.76, 0.06],
        [5.4, 0.035],
        [0.5, 0.08],
      ] as const) {
        const o = c.createOscillator()
        const gn = c.createGain()
        o.type = 'sine'
        o.frequency.value = 392 * ratio
        gn.gain.setValueAtTime(0.0001, t0)
        gn.gain.exponentialRampToValueAtTime(g, t0 + 0.01)
        gn.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.4)
        o.connect(gn).connect(c.destination)
        o.start(t0)
        o.stop(t0 + 2.5)
      }
    }
  } catch {
    /* ignore */
  }
}

/** Hululement de chouette (deux notes douces). */
export function owl() {
  if (!ambienceAllowed()) return
  const c = audio()
  if (!c) return
  try {
    const notes: Array<[number, number, number]> = [
      [0, 440, 0.35],
      [0.55, 415, 0.9],
    ]
    for (const [start, f, dur] of notes) {
      const t0 = c.currentTime + start
      const o = c.createOscillator()
      const g = c.createGain()
      o.type = 'sine'
      o.frequency.setValueAtTime(f, t0)
      o.frequency.exponentialRampToValueAtTime(f * 0.92, t0 + dur)
      g.gain.setValueAtTime(0.0001, t0)
      g.gain.exponentialRampToValueAtTime(0.09, t0 + 0.06)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
      o.connect(g).connect(c.destination)
      o.start(t0)
      o.stop(t0 + dur + 0.05)
    }
  } catch {
    /* ignore */
  }
}

/** Glas (mort annoncée) : une note grave. */
export function knell() {
  if (!ambienceAllowed()) return
  const c = audio()
  if (!c) return
  try {
    const t0 = c.currentTime
    for (const [f, g] of [
      [98, 0.18],
      [196, 0.07],
      [294, 0.03],
    ] as const) {
      const o = c.createOscillator()
      const gn = c.createGain()
      o.type = 'triangle'
      o.frequency.value = f
      gn.gain.setValueAtTime(0.0001, t0)
      gn.gain.exponentialRampToValueAtTime(g, t0 + 0.02)
      gn.gain.exponentialRampToValueAtTime(0.0001, t0 + 3)
      o.connect(gn).connect(c.destination)
      o.start(t0)
      o.stop(t0 + 3.1)
    }
  } catch {
    /* ignore */
  }
}

/* -------------------------------------------------------------------------- */
/* Textes (originaux)                                                          */
/* -------------------------------------------------------------------------- */

const pick = <T,>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)]

export const lines = {
  intro: () =>
    pick([
      'Bienvenue au village. Regardez votre carte en secret… et surtout, ne montrez rien sur votre visage.',
      'Le village s’installe autour du feu. Chacun découvre son rôle, en silence. Certains sourires cachent des crocs…',
      'Ce soir, le village croit dormir tranquille. Découvrez votre rôle sans rien laisser paraître.',
    ]),
  nightFalls: (night: number) =>
    night === 1
      ? pick([
          'La nuit tombe sur le village… Tout le monde ferme les yeux et pose un doigt sur son écran.',
          'Le soleil disparaît derrière les collines. Le village s’endort… Fermez les yeux.',
        ])
      : pick([
          `La nuit numéro ${night} tombe sur le village… Fermez les yeux.`,
          'Les volets se ferment, les bougies s’éteignent. Le village s’endort à nouveau…',
          'Le vent se lève, la lune monte dans le ciel. Tout le monde dort… ou fait semblant.',
        ]),
  wake: (step: LgStep) =>
    ({
      cupidon: pick(['Cupidon, ouvre les yeux. Choisis deux cœurs à unir pour toujours.', 'Cupidon se réveille et prépare ses flèches. Désigne les deux amoureux.']),
      amoureux: pick(['Les amoureux se réveillent, se découvrent… et tombent éperdument amoureux. Puis ils se rendorment.', 'Deux cœurs battent désormais à l’unisson. Amoureux, regardez-vous… puis refermez les yeux.']),
      voyante: pick(['Voyante, ouvre les yeux. Ta boule de cristal s’illumine : quel secret veux-tu percer ?', 'La voyante se réveille. Choisis la personne dont tu veux connaître la vraie nature.']),
      protecteur: pick(['Protecteur, ouvre les yeux. Qui veilleras-tu cette nuit ?', 'Le protecteur se réveille et lève son bouclier. Qui mettras-tu à l’abri ?']),
      loups: pick([
        'Loups-garous, ouvrez les yeux… et choisissez votre victime.',
        'Les loups-garous se réveillent, les babines retroussées. Mettez-vous d’accord sur votre proie.',
        'Un hurlement déchire la nuit. Loups-garous, réveillez-vous et désignez votre victime.',
      ]),
      sorciere: pick(['Sorcière, ouvre les yeux. Voici la victime de cette nuit… Veux-tu utiliser une potion ?', 'La sorcière se réveille et ouvre son grimoire. Sauver, empoisonner… ou ne rien faire ?']),
    })[step],
  sleep: (step: LgStep) =>
    ({
      cupidon: 'Cupidon, ferme les yeux.',
      amoureux: 'Les amoureux se rendorment.',
      voyante: 'Voyante, ferme les yeux.',
      protecteur: 'Protecteur, rendors-toi.',
      loups: pick(['Les loups-garous, repus, ferment les yeux.', 'Les loups-garous retournent se cacher. Fermez les yeux.']),
      sorciere: 'Sorcière, referme ton grimoire et ferme les yeux.',
    })[step],
  dawn: (deaths: Array<{ name: string } & Pick<LgDeath, 'role' | 'cause'>>) => {
    const out = [pick(['Le village se réveille…', 'Le coq chante, le soleil se lève sur le village…', 'Le jour se lève. Tout le monde ouvre les yeux…'])]
    const first = deaths.filter((d) => d.cause === 'night')
    const others = deaths.filter((d) => d.cause !== 'night')
    if (first.length === 0) out.push(pick(['Miracle ! Personne n’est mort cette nuit.', 'Ouf… cette nuit, personne n’a été dévoré.', 'Silence… Le village est au complet ce matin.']))
    else {
      out.push(first.length === 1 ? 'et découvre avec horreur que…' : 'et découvre avec horreur plusieurs corps…')
      for (const d of first) out.push(`${d.name} est mort cette nuit. C’était… ${roleWithArticle(d.role)}.`)
    }
    for (const d of others) out.push(deathLine(d.name, d.role, d.cause))
    return out
  },
  day: () =>
    pick([
      'Place au débat ! Qui soupçonnez-vous ?',
      'Le village se rassemble sur la place. Discutez, accusez, défendez-vous !',
      'Les esprits s’échauffent. Il est temps de démasquer les loups.',
    ]),
  vote: (revote: boolean) =>
    revote ? 'Égalité ! On revote, seulement entre les ex-aequo.' : pick(['Le débat est clos. Votez maintenant !', 'C’est l’heure du vote. Qui le village va-t-il éliminer ?']),
  voteResult: (name: string | null, role: string | null, outcome: string | undefined, extra: Array<{ name: string } & Pick<LgDeath, 'role' | 'cause'>>) => {
    const out: string[] = []
    if (!name) out.push(outcome === 'tie' ? 'Encore une égalité… Le village n’arrive pas à se décider. Personne n’est éliminé.' : 'Personne n’a voté… le village épargne tout le monde aujourd’hui.')
    else out.push(`Le village a tranché : ${name} est éliminé. C’était… ${role}.`)
    for (const d of extra) out.push(deathLine(d.name, d.role, d.cause))
    return out
  },
  hunter: (name: string) => pick([`${name} était chasseur ! Dans un dernier souffle, il épaule son arme…`, `${name}, le chasseur, n’a pas dit son dernier mot. Qui emportera-t-il ?`]),
  hunterResult: (target: Array<{ name: string } & Pick<LgDeath, 'role' | 'cause'>>) =>
    target.length === 0 ? ['Le chasseur baisse son arme… Il n’a pas tiré.'] : target.map((d) => deathLine(d.name, d.role, d.cause)),
  win: (w: LgWinner) =>
    ({
      village: 'Le dernier loup-garou est tombé ! Le village est sauvé, et peut enfin dormir en paix.',
      loups: 'Les loups-garous sont maintenant aussi nombreux que les villageois… Le village est perdu. Victoire des loups !',
      amoureux: 'Il ne reste plus que deux cœurs… Les amoureux ont triomphé de tout le village !',
    })[w],
}

function roleWithArticle(role: string): string {
  const info = ROLE_INFO[role as keyof typeof ROLE_INFO]
  if (!info) return role
  const article = role === 'sorciere' || role === 'voyante' ? 'la' : role === 'loup' ? 'un' : role === 'villageois' ? 'un' : 'le'
  return `${article} ${info.label.toLowerCase()}`
}

function deathLine(name: string, role: string, cause: LgDeath['cause']): string {
  if (cause === 'chagrin') return `${name}, fou de chagrin, rejoint son amour dans la tombe. C’était ${roleWithArticle(role)}.`
  if (cause === 'chasseur') return `Pan ! ${name} est abattu par le chasseur. C’était ${roleWithArticle(role)}.`
  return `${name} est ${CAUSE_LABEL[cause].replace('·e', '')}. C’était ${roleWithArticle(role)}.`
}

export { roleWithArticle }
