/**
 * Bowling d'entraînement : miroir local (un seul joueur) de supabase/games/bowling.sql
 * (roll -> _bw_refresh -> fin de partie). Le calcul du score est celui de scoring.ts (déjà partagé).
 * Fonctions pures, sans React. Rien n'est envoyé au serveur ni compté.
 */
import { addRoll, checkRoll, nextRoll, rollKind, scoreSheet, pinCount, type Sheet } from '../../games/bowling/scoring.ts'
import type { BowlingState } from '../../games/bowling/types.ts'

const iso = (ms: number) => new Date(ms).toISOString()

function refresh(s: BowlingState, me: string, sheet: Sheet): BowlingState {
  const sc = scoreSheet(sheet, s.frames)
  const next = nextRoll(sheet, s.frames)
  return {
    ...s,
    sheets: { ...s.sheets, [me]: sheet },
    scores: { ...s.scores, [me]: sc.total },
    cum: { ...s.cum, [me]: sc.cum },
    next: { ...s.next, [me]: next },
    done: next ? [] : [me],
  }
}

export function bwStart(meId: string, frames: 3 | 5 | 10, now: number): BowlingState {
  return refresh(
    {
      game: 'bowling',
      phase: 'playing',
      players: [meId],
      frames,
      time_limit: 0,
      started_at: iso(now),
      deadline: null,
      sheets: {},
      scores: {},
      cum: {},
      next: {},
      done: [],
      last_roll: null,
      forced: false,
      winners: null,
      results: null,
    },
    meId,
    [],
  )
}

/** Action {type: 'roll', frame, roll, pins_down_mask} ; lève une Error si le lancer est incohérent. */
export function bwAct(s: BowlingState, a: { type: string } & Record<string, unknown>, now: number): BowlingState {
  const me = s.players[0]
  if (a.type === 'tick') return s
  if (a.type !== 'roll') throw new Error('unknown_action')
  if (s.phase === 'finished') return s
  const sheet = s.sheets[me] ?? []
  const frame = Number(a.frame)
  const roll = Number(a.roll)
  const mask = Number(a.pins_down_mask)
  const chk = checkRoll(sheet, s.frames, frame, roll, mask)
  if (chk === 'duplicate') return s
  if (chk !== 'ok') throw new Error(chk)
  const nsheet = addRoll(sheet, frame, mask)
  const n = refresh(s, me, nsheet)
  const finished = n.done.includes(me)
  return {
    ...n,
    last_roll: { player: me, frame, roll, mask, pins: pinCount(mask), kind: rollKind(nsheet, frame, roll, s.frames), at: iso(now) },
    phase: finished ? 'finished' : 'playing',
    winners: finished ? [me] : null,
    results: finished ? [{ profile_id: me, points: 0, won: true, placement: 1 }] : null,
  }
}
