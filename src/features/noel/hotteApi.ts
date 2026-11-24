import { loose } from '@/features/soiree/hostTools'

/** La Hotte du jour (supabase/features/hotte.sql) : manches telles qu'envoyées (sans les réponses). */
export type HotteRound =
  | { type: 'quiz'; prompt: string; options: string[] }
  | { type: 'chanson'; line: string; options: string[] }
  | { type: 'memoire'; shown: string[]; remaining: string[]; options: string[] }
  | { type: 'intrus'; grid: string[] }
  | { type: 'proche'; prompt: string; unit: string }

export interface HotteRun {
  day: string
  started_at: string
  deadline: string
  rounds: HotteRound[]
  answers: { round: number; answer: string; ok: boolean }[]
  score: number
  finished: boolean
}

export interface HotteAnswer {
  ok: boolean
  correct: string
  score: number
  finished: boolean
}

export interface HotteBoardRow {
  profile_id: string
  score: number
  secs: number
}

async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await loose.rpc(fn, args)
  if (error) throw error
  return data as T
}

export const hotteStart = () => call<HotteRun>('hotte_start')
export const hotteAnswer = (round: number, answer: string) => call<HotteAnswer>('hotte_answer', { p_round: round, p_answer: answer })
export const hotteBoard = () => call<HotteBoardRow[]>('hotte_board')

/** ❄️ gagnés à la Hotte : 6 par bonne réponse. */
export const hotteFlakes = (score: number) => 6 * score
