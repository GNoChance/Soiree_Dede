/**
 * Logique pure de « Bombe à mots » côté front (sans React ni alias `@/`, importable
 * par les tests Node) : options, tirage des syllabes, validation locale d'un mot,
 * surlignage. Contrat : ./types.ts et supabase/games/bombe-a-mots.sql.
 */
import type { BamStartOptions, BamState } from './types'

export const bamActions = {
  word: (n: number, word: string) => ({ type: 'word', word, n }),
  tick: (n: number, quiet = true) => ({ type: 'tick', n, quiet }),
}

/* -------------------------------------------------------------------------- */
/* Options                                                                     */
/* -------------------------------------------------------------------------- */

export const BAM_LIVES_CHOICES = [2, 3, 4] as const
export const BAM_LEVEL_CHOICES = [
  { value: 1, label: '🐣 Tranquille' },
  { value: 2, label: '🌶️ Relevé' },
  { value: 3, label: '🔥 Brûlant' },
] as const

export interface BamOptions {
  lives: number
  startLevel: number
}

export const BAM_DEFAULT_OPTIONS: BamOptions = { lives: 3, startLevel: 1 }

export function readOptions(o: Record<string, unknown>): BamOptions {
  const lives = Number(o.lives)
  const lvl = Number(o.startLevel)
  return {
    lives: (BAM_LIVES_CHOICES as readonly number[]).includes(lives) ? lives : BAM_DEFAULT_OPTIONS.lives,
    startLevel: BAM_LEVEL_CHOICES.some((c) => c.value === lvl) ? lvl : BAM_DEFAULT_OPTIONS.startLevel,
  }
}

/* -------------------------------------------------------------------------- */
/* Syllabes                                                                    */
/* -------------------------------------------------------------------------- */

export interface SyllableLike {
  s: string
  level: number
  count?: number
}

/**
 * Secours si `SYLLABLES` (dictionary.ts) est vide ou trop maigre : groupes très
 * courants en français, classés à la main.
 */
export const FALLBACK_SYLLABLES: SyllableLike[] = [
  ...['ou', 'an', 'on', 're', 'er', 'es', 'en', 'ai', 'in', 'ch', 'te', 'le', 'ra', 'ar', 'la', 'ma', 'ne', 'de', 'ti', 'ur'].map((s) => ({ s, level: 1 })),
  ...['tra', 'pre', 'ent', 'ion', 'eur', 'ais', 'con', 'ous', 'ell', 'ett', 'oi', 'au', 'eau', 'que', 'tio'].map((s) => ({ s, level: 2 })),
  ...['oir', 'ule', 'ign', 'ble', 'ach', 'eil', 'ouv', 'gr', 'cl', 'pl', 'br', 'vr'].map((s) => ({ s, level: 3 })),
  ...['gn', 'ph', 'oin', 'ui', 'ieu', 'ill', 'sc', 'tt', 'pp', 'mm'].map((s) => ({ s, level: 4 })),
  ...['oux', 'yp', 'eux', 'oy', 'ym', 'ax', 'ex', 'iz', 'oz', 'aph'].map((s) => ({ s, level: 5 })),
]

function shuffle<T>(arr: T[], rnd: () => number = Math.random): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Nombre max de syllabes envoyées au serveur (limite serveur : 400). */
export const BAM_SYLLABLE_COUNT = 300
/** Syllabe jouable : au moins ce nombre de mots du dico la contiennent (si `count` connu). */
export const BAM_MIN_COUNT = 25

/**
 * Tire ~300 syllabes ordonnées par difficulté croissante (mélangées à niveau égal),
 * des niveaux startLevel à 5 (le serveur choisit le niveau visé et prend le plus
 * proche disponible).
 */
export function buildSyllables(source: SyllableLike[], startLevel: number, rnd: () => number = Math.random): { s: string; level: number }[] {
  const ok = (x: SyllableLike) => /^[a-z]{2,3}$/.test(x.s) && x.level >= 1 && x.level <= 5 && (x.count == null || x.count === 0 || x.count >= BAM_MIN_COUNT)
  let pool = source.filter(ok)
  if (pool.length < 40) pool = [...pool, ...FALLBACK_SYLLABLES.filter(ok)]
  // Dédoublonnage (garde la première occurrence).
  const seen = new Set<string>()
  pool = pool.filter((x) => (seen.has(x.s) ? false : (seen.add(x.s), true)))

  const levels = [1, 2, 3, 4, 5].filter((l) => l >= startLevel)
  const per = Math.floor(BAM_SYLLABLE_COUNT / levels.length)
  const out: { s: string; level: number }[] = []
  for (const l of levels) {
    // À niveau égal, on garde la moitié la plus fréquente (les comptes incluent les
    // conjugaisons : « bvi » = obvier… peu jouable en soirée), puis on mélange.
    const lv = pool.filter((x) => x.level === l).sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
    const top = lv.slice(0, Math.max(per, Math.ceil(lv.length / 2)))
    out.push(...shuffle(top, rnd).slice(0, per).map((x) => ({ s: x.s, level: l })))
  }
  // Pas assez au-dessus du niveau de départ : on complète avec des plus faciles.
  if (out.length < 10) {
    for (const x of shuffle(pool.filter((p) => p.level < startLevel), rnd)) {
      if (out.length >= 30) break
      out.unshift({ s: x.s, level: x.level })
    }
  }
  return out.sort((a, b) => a.level - b.level).slice(0, 400)
}

export function buildStartOptions(source: SyllableLike[], options: Record<string, unknown>, rnd: () => number = Math.random): BamStartOptions {
  const o = readOptions(options)
  return { lives: o.lives, start_level: o.startLevel, syllables: buildSyllables(source, o.startLevel, rnd) }
}

export async function prepareBombeStart(options: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { SYLLABLES } = await import('./dictionary')
  return { ...buildStartOptions(SYLLABLES, options) }
}

/* -------------------------------------------------------------------------- */
/* Validation locale d'un mot                                                  */
/* -------------------------------------------------------------------------- */

export type RejectReason = 'empty' | 'chars' | 'missing' | 'short' | 'played' | 'dico' | 'loading'

/** Même normalisation que dictionary.normalizeWord (copie : pas d'import du gros module). */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/œ/gi, 'oe')
    .replace(/æ/gi, 'ae')
    .toLowerCase()
    .replace(/[^a-z-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Statut du dictionnaire côté client. `off` = indisponible : pas de vérification. */
export type DictStatus = 'loading' | 'ready' | 'off'

export function checkWord(
  raw: string,
  syllable: string,
  played: Iterable<string>,
  dict: { status: DictStatus; has: (w: string) => boolean },
): { ok: true; word: string } | { ok: false; reason: RejectReason; word: string } {
  const word = normalize(raw)
  if (!word) return { ok: false, reason: 'empty', word }
  if (!/^[a-z]+(-[a-z]+)*$/.test(word) || word.length > 40) return { ok: false, reason: 'chars', word }
  if (!word.includes(syllable)) return { ok: false, reason: 'missing', word }
  if (word.replace(/-/g, '').length <= syllable.length) return { ok: false, reason: 'short', word }
  for (const w of played) if (w === word) return { ok: false, reason: 'played', word }
  // Dico pas encore chargé (ou indisponible) : on ne pénalise personne à cause du réseau, on se fie au serveur.
  if (dict.status === 'ready' && !dict.has(word)) return { ok: false, reason: 'dico', word }
  return { ok: true, word }
}

export function rejectLabel(reason: string, syllable: string): string {
  switch (reason) {
    case 'missing':
      return `Ne contient pas ${syllable.toUpperCase()} !`
    case 'short':
      return 'Trop court : il faut plus que la syllabe !'
    case 'played':
      return 'Déjà joué dans la partie !'
    case 'dico':
      return 'Pas dans le dico !'
    case 'chars':
      return 'Lettres uniquement (et tirets) !'
    case 'loading':
      return 'Le dico charge encore… une seconde !'
    case 'server':
      return 'Refusé !'
    default:
      return 'Tape un mot !'
  }
}

/* -------------------------------------------------------------------------- */
/* Affichage                                                                   */
/* -------------------------------------------------------------------------- */

/** Découpe `text` (affiché tel quel) autour de la 1re occurrence de `syl` (comparée sans accents). */
export function highlight(text: string, syl: string): { before: string; match: string; after: string } | null {
  if (!syl) return null
  const chars = Array.from(text)
  // Version normalisée + position d'origine de chaque caractère normalisé.
  let plain = ''
  const origin: number[] = []
  chars.forEach((c, i) => {
    const n = c === '-' ? '-' : normalize(c)
    for (const x of n) {
      plain += x
      origin.push(i)
    }
  })
  const at = plain.indexOf(syl)
  if (at < 0) return null
  const start = origin[at]
  const end = origin[at + syl.length - 1] + 1
  return { before: chars.slice(0, start).join(''), match: chars.slice(start, end).join(''), after: chars.slice(end).join('') }
}

/** Joueur vivant suivant dans l'ordre de table. */
export function nextAlive(s: Pick<BamState, 'players' | 'alive'>, from: string): string | null {
  const n = s.players.length
  const i = s.players.indexOf(from)
  for (let k = 1; k <= n; k++) {
    const c = s.players[(i + k + n) % n]
    if (s.alive.includes(c)) return c
  }
  return null
}

/** Mot le plus long de la partie (premier en cas d'égalité). */
export function longestWord(words: BamState['words']) {
  return words.reduce<BamState['words'][number] | null>((best, w) => (!best || w.w.replace(/-/g, '').length > best.w.replace(/-/g, '').length ? w : best), null)
}
