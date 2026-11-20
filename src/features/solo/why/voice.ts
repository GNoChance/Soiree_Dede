/**
 * Les 9 voix du bot (intro, chute, bravo, accroche « j'ai appris ») et la composition des
 * explications : texte = [intro] + phrase du moment + [2e phrase, écran seulement] + [chute,
 * 1 fois sur 2] — 3 phrases au plus. Les phrases de moment sont communes (src/games/<id>/why.ts).
 * Ton : jamais « nul », « facile », « raté » ; le bot se moque de lui-même ; aucun accord sur « tu ».
 */
import type { CharacterSlug } from '@/data/characters'
import type { SoloOutcome } from '../log'
import { pickMoment } from './pick'
import { fill, type GameWhy, type Moment } from './types'

interface Voice {
  intros: [string, string]
  chutes: [string, string]
  bravo: string
  learned: string
}

export const VOICES: Record<CharacterSlug, Voice> = {
  kevin: { intros: ['Replay !', 'Analyse du match :'], chutes: ['GG quand même.', 'On relance ?'], bravo: 'GG, joli combo !', learned: 'J’ai repéré ta technique :' },
  cycy: { intros: ['T’en fais pas, regarde :', 'Viens voir, c’est tout bête :'], chutes: ['Tu y étais presque !', 'Un câlin et on rejoue ?'], bravo: 'Oh, bravo ! Je suis trop fière de toi !', learned: 'J’ai bien vu, tu sais :' },
  dede: { intros: ['La reine t’explique :', 'Approche, je te montre :'], chutes: ['La couronne reste chez moi… pour l’instant.', 'La revanche quand tu veux !'], bravo: 'Chapeau ! La reine s’incline.', learned: 'Rien n’échappe à la reine :' },
  manon: { intros: ['J’ai tout noté :', 'D’après mon carnet :'], chutes: ['C’est noté pour la prochaine fois !', 'Tu progresses, je l’écris.'], bravo: 'Je le note en gros : bien joué !', learned: 'C’est dans mon carnet :' },
  mika: { intros: ['Tranquille, regarde :', 'Hé hé, celle-là tu l’as pas vue :'], chutes: ['Sans rancune !', 'La prochaine, elle est pour toi.'], bravo: 'Respect, bien vu !', learned: 'J’ai capté un truc :' },
  cecile: { intros: ['On reprend tranquillement :', 'Voyons ça ensemble :'], chutes: ['Un coup après l’autre, et ça ira.', 'Allez, on range et on rejoue !'], bravo: 'Du beau travail, bravo !', learned: 'J’ai remarqué quelque chose :' },
  carole: { intros: ['Petit coup de griffe !', 'Miaou, regarde là :'], chutes: ['Je rentre les griffes si tu rejoues.', 'Ronron… à la prochaine !'], bravo: 'Tu m’as bien eue, bravo !', learned: 'J’ai flairé quelque chose :' },
  marius: { intros: ['Bon. Regarde.', 'Bah, c’est simple :'], chutes: ['Voilà.', 'T’inquiète, ça arrive.'], bravo: 'Pas mal. Vraiment.', learned: 'J’ai vu un truc :' },
  nini: { intros: ['Oups, ça a glissé là :', 'Attends, je te montre (sans tomber) :'], chutes: ['Moi aussi je glisse souvent !', 'On se relève et on y retourne !'], bravo: 'Waouh, j’ai rien vu venir !', learned: 'J’ai fini par comprendre :' },
}

const FEMININE = new Set<CharacterSlug>(['cycy', 'dede', 'manon', 'cecile', 'carole'])
/** Accord du bot : « je me suis servi{e} ». */
export const eOf = (slug: CharacterSlug): string => (FEMININE.has(slug) ? 'e' : '')
const voiceOf = (slug: CharacterSlug): Voice => VOICES[slug] ?? VOICES.mika

export const LEARNED_LINE = 'Et je me doutais que tu jouerais là : tu le fais souvent !'
export const DRAW_NEUTRAL = 'Égalité ! Personne n’a craqué.'
/** Moments montrés après un nul : le joueur pouvait gagner. */
const DRAW_MISSED = ['victoire_manquee', 'mat_en_1_rate']

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/** Ne pas resservir la même intro deux fois de suite (session). */
let lastIntro = ''

export interface Explanation {
  mode: SoloOutcome
  /** null : rien à montrer (pas de « Montre-moi »). */
  moment: Moment | null
  /** Bulle de la carte de fin. */
  card: string
  /** Bulle de l'écran (1 à 3 phrases). */
  lines: string[]
  tip?: string
  title: string
  sticker: 'reflexion' | 'surprise'
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

/** « 🧠 J'ai capté un truc : tu commences toujours au centre. » */
export const learnedLine = (slug: CharacterSlug, text: string): string => `${voiceOf(slug).learned} ${lowerFirst(insightText(slug, text))}`

/** Phrase d'habitude avec l'accord du perso (« Tu m'as déjà battu{e} »). */
export const insightText = (slug: CharacterSlug, text: string): string => fill(text, { e: eOf(slug) }).replace(/\{\w+\}/g, '')

/**
 * Explication de fin de partie. `moments` : findMoments(log, 'me') pour une défaite ou un nul,
 * findMoments(log, 'bot') pour une victoire du joueur.
 */
export function explain(args: {
  slug: CharacterSlug
  why: GameWhy
  outcome: SoloOutcome
  moments: Moment[]
  lastWhy?: readonly string[]
  seed: string
}): Explanation {
  const { slug, why, outcome, seed } = args
  const v = voiceOf(slug)
  const e = eOf(slug)
  const h = hash(seed)
  const withE = (s: string) => fill(s, { e }).replace(/\{\w+\}/g, '')

  if (outcome === 'draw') {
    const missed = pickMoment(args.moments.filter((m) => DRAW_MISSED.includes(m.type)))
    if (!missed) return { mode: 'draw', moment: null, card: DRAW_NEUTRAL, lines: [DRAW_NEUTRAL], title: 'Égalité', sticker: 'surprise' }
    const t = why.texts(missed, 'me')
    const coup = missed.vars.coup ?? missed.vars.coup_txt ?? ''
    const when = !coup ? '' : /^\d+$/.test(String(coup)) ? ` au coup ${coup}` : ` à ton ${coup}`
    const card = `Égalité… mais${when}, tu pouvais gagner !`
    return { mode: 'draw', moment: missed, card, lines: t.lines.slice(0, 2).map(withE), tip: t.tip && withE(t.tip), title: 'Tu pouvais gagner !', sticker: 'reflexion' }
  }

  const moment = pickMoment(args.moments, outcome === 'loss' ? (args.lastWhy ?? []) : [])
  if (!moment) {
    const fallback = outcome === 'win' ? 'Bien joué : tu as été plus solide que moi du début à la fin.' : DRAW_NEUTRAL
    return { mode: outcome, moment: null, card: fallback, lines: [fallback], title: outcome === 'win' ? 'Ton meilleur coup' : 'Pourquoi tu as perdu', sticker: outcome === 'win' ? 'surprise' : 'reflexion' }
  }
  const t = why.texts(moment, outcome === 'win' ? 'bot' : 'me')
  const [p1, p2] = t.lines.map(withE)

  if (outcome === 'win') {
    return {
      mode: 'win',
      moment: moment.steps.length ? moment : { ...moment, steps: [] },
      card: `${v.bravo} ${p1}`,
      lines: [v.bravo, p1, ...(p2 ? [p2] : [])].slice(0, 3),
      title: 'Ton meilleur coup',
      sticker: 'surprise',
    }
  }

  let ii = h % 2
  if (v.intros[ii] === lastIntro) ii = 1 - ii
  const intro = v.intros[ii]
  lastIntro = intro
  const chute = (h >> 1) % 2 === 0 ? v.chutes[(h >> 2) % 2] : null
  const third = moment.learned ? LEARNED_LINE : (p2 ?? chute)
  return {
    mode: 'loss',
    moment,
    card: [intro, p1, chute].filter(Boolean).join(' '),
    lines: [intro, p1, third].filter((x): x is string => !!x).slice(0, 3),
    tip: t.tip && withE(t.tip),
    title: 'Pourquoi tu as perdu',
    sticker: 'reflexion',
  }
}
