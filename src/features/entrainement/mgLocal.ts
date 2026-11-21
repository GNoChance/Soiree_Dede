/**
 * Mini-golf d'entraînement : miroir local (un seul joueur) de supabase/games/mini-golf.sql
 * (_mg_open_hole, _mg_record, _mg_close_hole, _mg_finish, actions hole / tick / next).
 * Fonctions pures, sans React : testables sous Node (`node --experimental-strip-types`).
 * Rien n'est envoyé au serveur ni compté.
 */
import { DEFI, KERMESSE, RANDOM_POOL, holeById, maxStrokes, pickedUp } from '../../games/mini-golf/holes.ts'
import type { MgCourse, MiniGolfState } from '../../games/mini-golf/types.ts'

/** Annonce du trou (comme le serveur) puis classement après le trou (raccourci : 4 s au lieu de 6). */
export const MG_ANNOUNCE_MS = 3000
export const MG_HOLE_END_MS = 4000

const iso = (ms: number) => new Date(ms).toISOString()

/** n trous tirés au sort parmi 1..RANDOM_POOL, du plus facile (id petit) au plus dur. */
function draw(n: number, rnd: () => number): number[] {
  const pool = Array.from({ length: RANDOM_POOL }, (_, i) => i + 1)
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.slice(0, n).sort((a, b) => a - b)
}

export function pickHoles(course: MgCourse, rnd: () => number = Math.random): number[] {
  if (course === 'kermesse') return [...KERMESSE]
  if (course === 'defi') return [...DEFI]
  return draw(course === 'express' ? 5 : 9, rnd)
}

function openHole(s: MiniGolfState, idx: number, now: number): MiniGolfState {
  return { ...s, phase: 'playing', hole: idx, round: idx + 1, hole_started_at: iso(now + MG_ANNOUNCE_MS), deadline: null, done: [] }
}

export function mgStart(meId: string, course: MgCourse, now: number, rnd: () => number = Math.random): MiniGolfState {
  const holes = pickHoles(course, rnd)
  const pars = holes.map((id) => holeById(id).par)
  return openHole(
    {
      game: 'mini-golf',
      phase: 'playing',
      players: [meId],
      hole: 0,
      total_rounds: holes.length,
      course,
      holes,
      pars,
      timer: 0,
      hole_started_at: '',
      deadline: null,
      cards: { [meId]: [] },
      totals: { [meId]: 0 },
      done: [],
      last_hole: null,
      winners: null,
      results: null,
    },
    0,
    now,
  )
}

const total = (card: number[]) => card.reduce((a, b) => a + b, 0)

function record(s: MiniGolfState, me: string, score: number): MiniGolfState {
  const card = [...(s.cards[me] ?? [])]
  while (card.length < s.hole) card.push(pickedUp(s.pars[card.length]))
  card.length = s.hole
  card.push(score)
  return { ...s, cards: { ...s.cards, [me]: card }, totals: { ...s.totals, [me]: total(card) }, done: s.done.includes(me) ? s.done : [...s.done, me] }
}

function finish(s: MiniGolfState, me: string): MiniGolfState {
  return {
    ...s,
    phase: 'finished',
    deadline: null,
    winners: [me],
    results: [{ profile_id: me, points: 0, won: true, placement: 1 }],
  }
}

function closeHole(s: MiniGolfState, me: string, now: number): MiniGolfState {
  if (!s.done.includes(me)) s = record(s, me, pickedUp(s.pars[s.hole]))
  if (s.hole >= s.holes.length - 1) return finish(s, me)
  return { ...s, phase: 'hole_end', deadline: iso(now + MG_HOLE_END_MS) }
}

/** Action {type: 'hole' | 'tick' | 'next'} ; lève une Error comme le serveur (action refusée). */
export function mgAct(s: MiniGolfState, a: { type: string } & Record<string, unknown>, now: number): MiniGolfState {
  const me = s.players[0]
  const late = s.deadline !== null && now >= Date.parse(s.deadline)
  switch (a.type) {
    case 'hole': {
      if (s.phase === 'finished') throw new Error('wrong_phase')
      if (a.hole !== s.hole) throw new Error('wrong_hole')
      if (s.done.includes(me)) return s
      if (s.phase !== 'playing') throw new Error('wrong_phase')
      if (typeof a.holed !== 'boolean') throw new Error('invalid_action')
      const strokes = a.strokes
      const cap = maxStrokes(s.pars[s.hole])
      if (typeof strokes !== 'number' || !Number.isInteger(strokes) || strokes < 1 || strokes > (a.holed ? cap : cap + 1)) throw new Error('invalid_strokes')
      const score = a.holed ? strokes : cap + 1
      let n = record(s, me, score)
      n = { ...n, last_hole: { id: me, hole: s.hole, strokes: score, holed: a.holed, at: iso(now) } }
      return closeHole(n, me, now)
    }
    case 'tick':
      if (s.phase === 'hole_end' && late) return openHole(s, s.hole + 1, now)
      return s
    case 'next':
      if (s.phase === 'hole_end') return openHole(s, s.hole + 1, now)
      return s
    default:
      throw new Error('unknown_action')
  }
}

/** Total des coups et écart au par de toute la carte (négatif = sous le par). */
export const mgTotal = (s: MiniGolfState) => total(s.cards[s.players[0]] ?? [])
export const mgDiff = (s: MiniGolfState) => mgTotal(s) - s.pars.reduce((a, b) => a + b, 0)
