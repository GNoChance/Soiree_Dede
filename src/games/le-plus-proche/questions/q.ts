import type { CloseQuestion, CloseTheme } from '../questions'

/** [prompt, answer, unit, difficulty, note?] */
export type Row = [string, number, string, 1 | 2 | 3, string?]

export function mk(theme: CloseTheme, rows: Row[]): Omit<CloseQuestion, 'id'>[] {
  return rows.map(([prompt, answer, unit, difficulty, note]) => {
    const q: Omit<CloseQuestion, 'id'> = { prompt, answer, unit, theme, difficulty }
    if (note) q.note = note
    return q
  })
}
