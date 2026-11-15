/**
 * Score officiel du bowling (fonction pure, sans dépendance) — MÊME logique que
 * `supabase/games/bowling.sql` (_bw_next / _bw_score / _bw_fill). Le serveur
 * recalcule tout lui-même à partir des masques ; ce module sert à l'affichage,
 * à la prédiction locale et aux tests Node (`node --experimental-strip-types`).
 *
 * Représentation : une feuille = tableau de frames, une frame = tableau de
 * MASQUES (un par lancer). Masque = entier 0..1023, bit i = quille n° i+1
 * tombée PENDANT ce lancer (⊆ quilles debout avant le lancer).
 *
 * Règles : `n` frames (3, 5 ou 10) ; les n-1 premières sont normales (strike =
 * 1 lancer), la dernière suit les règles de la 10e frame (strike ou spare =
 * lancer(s) bonus, jusqu'à 3 lancers, quilles relevées après chaque strike /
 * spare). Quilles numérotées comme en vrai : 1 en tête, 7-8-9-10 au fond.
 */

export const ALL_PINS = 1023

export type Frame = number[]
export type Sheet = Frame[]

/** Nombre de quilles d'un masque. */
export function pinCount(mask: number): number {
  let m = mask & ALL_PINS
  let c = 0
  while (m) {
    c += m & 1
    m >>= 1
  }
  return c
}

/** Prochain lancer attendu : {frame, roll} (1-based) + quilles debout, ou null si fini. */
export interface NextRoll {
  frame: number
  roll: number
  /** Masque des quilles debout avant ce lancer. */
  standing: number
}

/** Frame `f` (1-based) terminée ? */
export function frameComplete(frame: Frame, isLast: boolean): boolean {
  const c = frame.map(pinCount)
  if (!isLast) return c.length >= 2 || c[0] === 10
  if (c.length < 2) return false
  if (c.length >= 3) return true
  // 2 lancers : bonus seulement si strike au 1er ou spare au 2e.
  return c[0] + c[1] < 10
}

/** Quilles debout avant le prochain lancer d'une frame (non terminée). */
export function standingBefore(frame: Frame, isLast: boolean): number {
  if (frame.length === 0) return ALL_PINS
  if (!isLast) return ALL_PINS & ~frame[0]
  const c = frame.map(pinCount)
  if (frame.length === 1) return c[0] === 10 ? ALL_PINS : ALL_PINS & ~frame[0]
  // 3e lancer de la dernière frame
  if (c[0] === 10) return c[1] === 10 ? ALL_PINS : ALL_PINS & ~frame[1]
  return ALL_PINS // spare -> quilles relevées
}

export function nextRoll(sheet: Sheet, n: number): NextRoll | null {
  for (let f = 0; f < n; f++) {
    const frame = sheet[f] ?? []
    const isLast = f === n - 1
    if (!frameComplete(frame, isLast)) {
      return { frame: f + 1, roll: frame.length + 1, standing: standingBefore(frame, isLast) }
    }
  }
  return null
}

export const isDone = (sheet: Sheet, n: number) => nextRoll(sheet, n) === null

/** Valide un lancer {frame, roll, mask} par rapport à la feuille (comme le serveur). */
export type RollCheck = 'ok' | 'duplicate' | 'already_done' | 'wrong_roll' | 'invalid_roll'
export function checkRoll(sheet: Sheet, n: number, frame: number, roll: number, mask: number): RollCheck {
  if (!Number.isInteger(mask) || mask < 0 || mask > ALL_PINS) return 'invalid_roll'
  const prev = sheet[frame - 1]?.[roll - 1]
  if (prev !== undefined) return prev === mask ? 'duplicate' : 'wrong_roll'
  const next = nextRoll(sheet, n)
  if (!next) return 'already_done'
  if (next.frame !== frame || next.roll !== roll) return 'wrong_roll'
  if ((mask & ~next.standing) !== 0) return 'invalid_roll'
  return 'ok'
}

/** Ajoute un lancer (sans validation) et renvoie une nouvelle feuille. */
export function addRoll(sheet: Sheet, frame: number, mask: number): Sheet {
  const out = sheet.map((f) => f.slice())
  while (out.length < frame) out.push([])
  out[frame - 1].push(mask)
  return out
}

/** Complète la feuille avec des lancers à 0 (fin forcée). */
export function fillWithZeros(sheet: Sheet, n: number): Sheet {
  let out = sheet.slice(0, n).map((f) => f.slice())
  for (let next = nextRoll(out, n); next; next = nextRoll(out, n)) out = addRoll(out, next.frame, 0)
  return out
}

export interface SheetScore {
  /** Total « en cours » (bonus pas encore joués comptés 0). */
  total: number
  /** Cumul officiel par frame (null tant que la frame ou ses bonus ne sont pas joués). */
  cum: Array<number | null>
  /** Score propre de chaque frame (null si pas encore calculable). */
  frameScores: Array<number | null>
}

export function scoreSheet(sheet: Sheet, n: number): SheetScore {
  const flat: number[] = []
  const start: number[] = []
  for (let f = 0; f < n; f++) {
    start.push(flat.length)
    for (const m of sheet[f] ?? []) flat.push(pinCount(m))
  }
  const at = (i: number) => flat[i]
  const cum: Array<number | null> = []
  const frameScores: Array<number | null> = []
  let running = 0
  let total = 0
  let broken = false
  for (let f = 0; f < n; f++) {
    const frame = sheet[f] ?? []
    const c = frame.map(pinCount)
    const i = start[f]
    const isLast = f === n - 1
    let score: number | null = null
    let partial = c.reduce((a, b) => a + b, 0)
    if (!isLast) {
      if (c[0] === 10) {
        const b1 = at(i + 1)
        const b2 = at(i + 2)
        partial = 10 + (b1 ?? 0) + (b2 ?? 0)
        if (b1 !== undefined && b2 !== undefined) score = partial
      } else if (c.length >= 2 && c[0] + c[1] === 10) {
        const b1 = at(i + 2)
        partial = 10 + (b1 ?? 0)
        if (b1 !== undefined) score = partial
      } else if (c.length >= 2) {
        score = partial
      }
    } else if (frameComplete(frame, true)) {
      score = partial
    }
    total += partial
    frameScores.push(score)
    if (score === null) broken = true
    if (!broken && score !== null) {
      running += score
      cum.push(running)
    } else {
      cum.push(null)
    }
  }
  return { total, cum, frameScores }
}

/** Symboles d'affichage d'une frame : 'X', '/', '-', '7'… */
export function frameMarks(frame: Frame, isLast: boolean): string[] {
  const c = frame.map(pinCount)
  const marks: string[] = []
  for (let r = 0; r < c.length; r++) {
    const v = c[r]
    let firstOfRack: boolean
    if (!isLast) firstOfRack = r === 0
    else if (r === 0) firstOfRack = true
    else if (r === 1) firstOfRack = c[0] === 10
    else firstOfRack = c[1] === 10 || (c[0] !== 10 && c[0] + c[1] === 10)
    if (firstOfRack && v === 10) marks.push('X')
    else if (!firstOfRack && v > 0 && v + c[r - 1] === 10) marks.push('/')
    else marks.push(v === 0 ? '-' : String(v))
  }
  return marks
}

/** Type d'un lancer pour les effets : strike / spare / gouttière / normal. */
export type RollKind = 'strike' | 'spare' | 'zero' | 'normal'
export function rollKind(sheet: Sheet, frame: number, roll: number, n: number): RollKind {
  const marks = frameMarks(sheet[frame - 1] ?? [], frame === n)
  const m = marks[roll - 1]
  return m === 'X' ? 'strike' : m === '/' ? 'spare' : m === '-' ? 'zero' : 'normal'
}

/** Stats d'une feuille : strikes, spares, meilleure frame (score). */
export function sheetStats(sheet: Sheet, n: number) {
  let strikes = 0
  let spares = 0
  let gutters = 0
  sheet.forEach((f, i) => {
    for (const m of frameMarks(f, i === n - 1)) {
      if (m === 'X') strikes++
      else if (m === '/') spares++
      else if (m === '-') gutters++
    }
  })
  const { frameScores } = scoreSheet(sheet, n)
  let bestFrame = 0
  let bestFrameNo = 0
  frameScores.forEach((s, i) => {
    if (s !== null && s > bestFrame) {
      bestFrame = s
      bestFrameNo = i + 1
    }
  })
  return { strikes, spares, gutters, bestFrame, bestFrameNo }
}

/** Points du classement général (XP) : round(score / 30) → 300 = 10 pts. */
export const pointsForScore = (score: number) => Math.round(score / 30)
