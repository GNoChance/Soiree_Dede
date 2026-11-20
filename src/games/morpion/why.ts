/**
 * Explication de fin de partie du Morpion classique (2a), exacte grâce au minimax :
 * on cherche le dernier coup du perdant avant lequel il pouvait encore éviter la défaite
 * (valeur ≥ 0 avant, < 0 après), puis on le classe. Mêmes détecteurs pour le compliment
 * (loser = 'bot') et pour les compteurs de l'apprentissage (learn.ts : scanMe).
 */
import { learnedNear, replayAll, type Side, type SoloLog } from '@/features/solo/log'
import { fill, nth, type GameWhy, type Moment, type WhyText } from '@/features/solo/why/types'
import { scoreMoves } from './bot'
import { local } from './local'
import type { CellValue, Sym } from './logic'
import type { MorpionBoard, MorpionMove } from './types'

export const CELL_NAMES = [
  'le coin en haut à gauche',
  'le bord du haut',
  'le coin en haut à droite',
  'le bord de gauche',
  'le centre',
  'le bord de droite',
  'le coin en bas à gauche',
  'le bord du bas',
  'le coin en bas à droite',
]

const LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
]

const emoji = (s: Sym) => (s === 'x' ? '❌' : '⭕')
const other = (s: Sym): Sym => (s === 'x' ? 'o' : 'x')

/** Cases qui font gagner `sym` tout de suite. */
export function winCells(c: readonly CellValue[], sym: Sym): number[] {
  const out = new Set<number>()
  for (const l of LINES) {
    const mine = l.filter((i) => c[i] === sym).length
    const free = l.filter((i) => c[i] === null)
    if (mine === 2 && free.length === 1) out.add(free[0])
  }
  return [...out].sort((p, q) => p - q)
}

/** Les deux pions de `sym` alignés avec la case `cell`. */
function pairWith(c: readonly CellValue[], sym: Sym, cell: number): number[] {
  const l = LINES.find((ln) => ln.includes(cell) && ln.filter((i) => c[i] === sym).length === 2)
  return l ? l.filter((i) => i !== cell) : []
}

interface Ply {
  i: number
  by: Side
  board: MorpionBoard
  after: MorpionBoard
  cell: number
}

const plies = (log: SoloLog): Ply[] => {
  const pos = replayAll(local, log)
  return log.entries.map((e, i) => ({
    i,
    by: e.by,
    board: pos[i].state.board as MorpionBoard,
    after: pos[i + 1].state.board as MorpionBoard,
    cell: (e.action.move as MorpionMove).cell,
  }))
}

const symOf = (b: MorpionBoard, id: string): Sym => (b.x === id ? 'x' : 'o')

/** Faits bruts sur les coups de `who` (explication, compliment, apprentissage). */
export interface MorpionScan {
  /** Victoires immédiates manquées / occasions. */
  win: [number, number]
  /** Blocages oubliés / occasions (hors coups où il gagnait lui-même). */
  block: [number, number]
  /** Dernier coup perdant : indice dans le journal, position avant (cases), n° de son coup. */
  err: { i: number; k: number; cells: CellValue[] } | null
}

export function scan(log: SoloLog, who: Side, ps: Ply[] = plies(log)): MorpionScan {
  const id = who === 'me' ? log.me : log.bot
  const r: MorpionScan = { win: [0, 0], block: [0, 0], err: null }
  let k = 0
  for (const p of ps) {
    if (p.by !== who) continue
    k++
    const s = symOf(p.board, id)
    const wins = winCells(p.board.cells, s)
    if (wins.length) {
      r.win[1]++
      if (!wins.includes(p.cell)) r.win[0]++
    } else {
      const threats = winCells(p.board.cells, other(s))
      if (threats.length) {
        r.block[1]++
        if (!threats.includes(p.cell)) r.block[0]++
      }
    }
    if (p.board.variant !== 'classic') continue
    const scores = scoreMoves(p.board, s)
    const before = Math.max(...scores.map((x) => x.score))
    const after = scores.find((x) => x.cell === p.cell)?.score ?? 0
    if (before >= 0 && after < 0) r.err = { i: p.i, k, cells: [...p.board.cells] }
  }
  return r
}

function findMoments(log: SoloLog, loser: Side): Moment[] {
  if (!log.x0) return []
  const ps = plies(log)
  const lid = loser === 'me' ? log.me : log.bot
  const out: Moment[] = []
  const meK = (i: number) => ps.filter((p) => p.by === 'me' && p.i <= i).length
  const end = ps.length

  // Victoires immédiates manquées (à n'importe quel moment).
  let k = 0
  for (const p of ps) {
    if (p.by !== loser) continue
    k++
    const s = symOf(p.board, lid)
    const wins = winCells(p.board.cells, s)
    if (!wins.length || wins.includes(p.cell)) continue
    const w = wins[0]
    const vars = { coup: nth(k), case: CELL_NAMES[w], case_jouee: CELL_NAMES[p.cell], signe: emoji(s) }
    out.push(
      loser === 'me'
        ? { type: 'victoire_manquee', weight: 100, vars, steps: [{ ply: p.i + 1, marks: [{ kind: 'played', cells: [p.cell] }] }, { ply: p.i, marks: [{ kind: 'line', cells: [...pairWith(p.board.cells, s, w), w] }, { kind: 'better', cells: [w] }] }] }
        : { type: 'victoire_manquee', weight: 100, vars, steps: [{ ply: p.i + 1, marks: [{ kind: 'played', cells: [p.cell] }, { kind: 'threat', cells: [w] }] }, finalStep(ps)] },
    )
  }

  // Blocages oubliés (une seule menace, à n'importe quel moment : bruit du niveau compris).
  k = 0
  for (const p of ps) {
    if (p.by !== loser) continue
    k++
    const s = symOf(p.board, lid)
    const threats = winCells(p.board.cells, other(s))
    if (threats.length !== 1 || threats.includes(p.cell) || winCells(p.board.cells, s).length) continue
    out.push(blockMoment(p, k, s, threats[0], loser, ps))
  }

  // Le coup perdant.
  const err = scan(log, loser, ps).err
  if (err) {
    const p = ps[err.i]
    const s = symOf(p.board, lid)
    const ws = other(s)
    const threats = winCells(p.board.cells, ws)
    if (threats.length && !threats.includes(p.cell) && !winCells(p.board.cells, s).length) {
      if (threats.length > 1) out.push(blockMoment(p, err.k, s, threats[0], loser, ps))
    } else {
      // Deux menaces d'un coup, préparées par ce coup.
      const fork = ps.find((q) => q.i > p.i && q.by !== loser && winCells(q.after.cells, ws).length >= 2)
      if (fork) {
        const two = winCells(fork.after.cells, ws)
        const scores = scoreMoves(p.board, s)
        const top = Math.max(...scores.map((x) => x.score))
        const good = scores.filter((x) => x.score === top).map((x) => x.cell)
        const hold = good.includes(4) ? 4 : good[0]
        const vars = { coup: loser === 'me' ? nth(err.k) : nth(meK(fork.i)), case: CELL_NAMES[hold], case_jouee: CELL_NAMES[p.cell], signe_bot: emoji(ws) }
        out.push(
          loser === 'me'
            ? { type: 'fourchette', weight: 70, vars, steps: [{ ply: fork.i + 1, marks: [{ kind: 'played', cells: [p.cell] }, { kind: 'threat', cells: two }] }, { ply: p.i, marks: [{ kind: 'better', cells: [hold] }] }] }
            : { type: 'fourchette', weight: 70, vars, steps: [{ ply: p.i + 1, marks: [{ kind: 'played', cells: [p.cell] }] }, { ply: fork.i, marks: [{ kind: 'threat', cells: two }, { kind: 'better', cells: [fork.cell] }] }] },
        )
      }
    }
  }

  // Repli : la ligne gagnante.
  const last = ps[end - 1]
  const winnerSide: Side = loser === 'me' ? 'bot' : 'me'
  if (last && last.after.lines?.length) {
    const wsym = symOf(last.after, winnerSide === 'me' ? log.me : log.bot)
    out.push({ type: 'alignement', weight: 10, vars: { signe_bot: emoji(wsym), coup: nth(meK(end - 1)) }, steps: [winnerSide === 'me' ? finalStep(ps) : { ply: end, marks: [{ kind: 'line', cells: last.after.lines.flat() }] }] })
  }
  // Coup décisif du bot appris (2b).
  if (loser === 'me')
    for (const m of out) {
      if (m.learned || !m.steps.length) continue
      const plys = m.steps.map((st) => st.ply)
      m.learned = learnedNear(log, Math.min(...plys) - 1, Math.max(...plys) + 3)
      if (!m.learned) delete m.learned
    }
  return out
}

/** Position avant le coup gagnant du joueur : ce coup en vert + sa ligne. */
function finalStep(ps: Ply[]) {
  const last = ps[ps.length - 1]
  return { ply: ps.length - 1, marks: [{ kind: 'line' as const, cells: last.after.lines?.flat() ?? [] }, { kind: 'better' as const, cells: [last.cell] }] }
}

function blockMoment(p: Ply, k: number, s: Sym, blk: number, loser: Side, ps: Ply[]): Moment {
  const ws = other(s)
  const pair = pairWith(p.board.cells, ws, blk)
  const vars = { coup: nth(k), case: CELL_NAMES[blk], case_jouee: CELL_NAMES[p.cell], signe_bot: emoji(ws), signe: emoji(s) }
  return loser === 'me'
    ? { type: 'blocage_oublie', weight: 90, vars, steps: [{ ply: p.i + 1, marks: [{ kind: 'threat', cells: pair }, { kind: 'played', cells: [p.cell] }] }, { ply: p.i, marks: [{ kind: 'threat', cells: pair }, { kind: 'better', cells: [blk] }] }] }
    : { type: 'blocage_oublie', weight: 90, vars, steps: [{ ply: p.i + 1, marks: [{ kind: 'threat', cells: [...pair, blk] }, { kind: 'played', cells: [p.cell] }] }, finalStep(ps)] }
}

const LOSS: Record<string, { lines: string[]; tip: string }> = {
  victoire_manquee: {
    lines: ['À ton {coup}, tu pouvais gagner tout de suite en jouant {case}.', 'Tu avais deux {signe} alignés : il ne manquait que {case} !'],
    tip: 'Avant de jouer, cherche d’abord si tu peux aligner trois.',
  },
  blocage_oublie: {
    lines: ['J’avais deux {signe_bot} alignés et {case} était libre : il fallait me bloquer.', 'À ton {coup}, tu as joué {case_jouee}. Du coup, j’ai fini ma ligne avec {case}.'],
    tip: 'Si tu ne peux pas gagner, regarde où je peux gagner et prends la case.',
  },
  fourchette: {
    lines: ['À ton {coup}, tu as joué {case_jouee} : ça m’a permis de faire deux menaces d’un coup.', 'Tu ne pouvais plus tout bloquer. Avec {case} à la place, pas de double menace.'],
    tip: 'Quand j’ai deux {signe_bot} qui ne se touchent pas, méfie-toi : je prépare deux menaces.',
  },
  alignement: {
    lines: ['J’ai aligné mes trois {signe_bot}, petit à petit.'],
    tip: 'Si tu ne peux pas gagner, regarde où je peux gagner et prends la case.',
  },
}

const WIN: Record<string, string[]> = {
  fourchette: ['Ton {coup} m’a eu{e} : deux menaces d’un coup, je ne pouvais plus tout bloquer !'],
  blocage_oublie: ['J’ai oublié de te bloquer… et tu n’as pas raté ça. Bien vu !'],
  victoire_manquee: ['Entre nous : je pouvais gagner juste avant et je ne l’ai pas vu. Bravo d’en avoir profité !'],
  alignement: ['Bien joué : tu as été plus solide que moi du début à la fin.'],
}

function texts(m: Moment, loser: Side): WhyText {
  if (loser === 'bot') return { lines: (WIN[m.type] ?? WIN.alignement).map((s) => fill(s, m.vars)) }
  const t = LOSS[m.type] ?? LOSS.alignement
  return { lines: t.lines.map((s) => fill(s, m.vars)), tip: fill(t.tip, m.vars) }
}

export const why: GameWhy = { findMoments, texts }
