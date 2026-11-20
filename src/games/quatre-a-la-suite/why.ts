/**
 * Explication de fin de partie de « 4 à la suite » (2a). Détecteurs immédiats à chaque coup
 * du perdant (victoire manquée, blocage oublié, cadeau sous la case gagnante), puis recherche
 * du coup qui a fait basculer la partie : on remonte depuis la fin (6 coups du perdant au plus)
 * tant que tous ses coups perdaient (gain forcé de l'adversaire, profondeur ≤ 8, approfondie
 * tant que le budget le permet) ; on s'arrête au premier coup où une autre colonne tenait.
 * Tourne dans le Web Worker du solo ; dépassement de temps → on garde la profondeur finie,
 * et toujours le repli « alignement ». Mêmes détecteurs pour le compliment et la mémoire (scan).
 */
import { learnedNear, replayAll, type Side, type SoloLog } from '@/features/solo/log'
import { fill, nth, type GameWhy, type Mark, type Moment, type Step, type WhyText } from '@/features/solo/why/types'
import { ORDER, fromBoard, type Pos } from './bot'
import { local } from './local'
import type { Q4Board, Q4Move } from './types'

const W = 7
const H = 6

export const COL_NAMES = [
  'la colonne tout à gauche',
  'la 2e colonne',
  'la 3e colonne',
  'la colonne du milieu',
  'la 5e colonne',
  'la 6e colonne',
  'la colonne tout à droite',
]
export type DirId = 'h' | 'v' | 'd'
export const DIR_TXT: Record<DirId, string> = { h: 'à l’horizontale', v: 'à la verticale', d: 'en diagonale' }

/** Case = colonne × 6 + ligne (ligne 0 en bas). */
export const cellOf = (c: number, r: number): number => c * H + r

const DIRS: Array<[number, number, DirId]> = [
  [1, 0, 'h'],
  [0, 1, 'v'],
  [1, 1, 'd'],
  [1, -1, 'd'],
]

/** Colonnes où `p` gagne tout de suite. */
export const immediate = (pos: Pos, p: number): number[] => ORDER.filter((c) => pos.h[c] < H && pos.winsWith(c, p))

/** Jetons de `p` alignés avec la case où tomberait un jeton en colonne c (≥ 3), et la direction. */
export function alignedWith(pos: Pos, p: number, c: number): { cells: number[]; dir: DirId } {
  const r = pos.h[c]
  const at = (cc: number, rr: number) => cc >= 0 && cc < W && rr >= 0 && rr < H && pos.g[cc * H + rr] === p
  for (const [dc, dr, dir] of DIRS) {
    const cells: number[] = []
    for (let k = 1; at(c + k * dc, r + k * dr); k++) cells.push(cellOf(c + k * dc, r + k * dr))
    for (let k = 1; at(c - k * dc, r - k * dr); k++) cells.push(cellOf(c - k * dc, r - k * dr))
    if (cells.length >= 3) return { cells, dir }
  }
  return { cells: [], dir: 'h' }
}

/** Direction d'un alignement gagnant (cases [c, r]). */
function lineDir(line: Array<[number, number]>): DirId {
  const [a, b] = line
  if (!b) return 'h'
  const same = (k: 0 | 1) => line.slice(0, 4).every((p) => p[k] === a[k])
  return same(1) ? 'h' : same(0) ? 'v' : 'd'
}

/* ------------------------------------------------------------------ recherche (gain forcé) */

class OutOfTime extends Error {}
interface Ctx {
  nodes: number
  deadline: number
}
const tick = (ctx: Ctx) => {
  if ((++ctx.nodes & 1023) === 0 && performance.now() > ctx.deadline) throw new OutOfTime()
}

/** `p` (au trait) peut-il forcer un alignement en `d` demi-coups au plus (le sien compris) ? */
export function canWin(pos: Pos, p: number, d: number, ctx: Ctx): boolean {
  if (d <= 0 || pos.n >= W * H) return false
  tick(ctx)
  const q = 3 - p
  for (const c of ORDER) if (pos.h[c] < H && pos.winsWith(c, p)) return true
  if (d < 3) return false
  const qw = immediate(pos, q)
  if (qw.length >= 2) return false
  const cand = qw.length ? qw : ORDER.filter((c) => pos.h[c] < H)
  for (const c of cand) {
    pos.play(c, p)
    const forced = !escapes(pos, q, d - 1, ctx)
    pos.undo(c)
    if (forced) return true
  }
  return false
}

/** `q` (au trait) échappe-t-il à un gain forcé de l'autre en `d` demi-coups ? */
function escapes(pos: Pos, q: number, d: number, ctx: Ctx): boolean {
  if (pos.n >= W * H) return true
  tick(ctx)
  const p = 3 - q
  for (const c of ORDER) if (pos.h[c] < H && pos.winsWith(c, q)) return true
  const pw = immediate(pos, p)
  if (pw.length >= 2) return false
  const cand = pw.length ? pw : ORDER.filter((c) => pos.h[c] < H)
  for (const c of cand) {
    pos.play(c, q)
    const lost = canWin(pos, p, d - 1, ctx)
    pos.undo(c)
    if (!lost) return true
  }
  return false
}

/** Le joueur 1 (au trait) perd-il en jouant c (gain forcé de l'autre en `d`) ? */
function loses(pos: Pos, c: number, d: number, ctx: Ctx): boolean {
  if (pos.winsWith(c, 1)) return false
  pos.play(c, 1)
  try {
    return canWin(pos, 2, d, ctx)
  } finally {
    pos.undo(c)
  }
}

/* ------------------------------------------------------------------ journal */

interface Ply {
  i: number
  by: Side
  board: Q4Board
  after: Q4Board
  col: number
  row: number
}

function plies(log: SoloLog): Ply[] {
  const pos = replayAll(local, log)
  return log.entries.map((e, i) => {
    const board = pos[i].state.board as Q4Board
    const col = (e.action.move as Q4Move).col
    return { i, by: e.by, board, after: pos[i + 1].state.board as Q4Board, col, row: board.cols[col]?.length ?? 0 }
  })
}

/** Faits bruts sur les coups de `who` (apprentissage). */
export interface Q4Scan {
  /** Blocages oubliés / occasions par direction de l'alignement adverse. */
  miss: Record<DirId, [number, number]>
  win: [number, number]
  /** Jetons posés juste sous une case gagnante adverse. */
  gift: number
}

export function scan(log: SoloLog, who: Side): Q4Scan {
  const r: Q4Scan = { miss: { h: [0, 0], v: [0, 0], d: [0, 0] }, win: [0, 0], gift: 0 }
  if (!log.x0) return r
  const id = who === 'me' ? log.me : log.bot
  for (const p of plies(log)) {
    if (p.by !== who) continue
    const pos = fromBoard(p.board, id)
    const own = immediate(pos, 1)
    const opp = immediate(pos, 2)
    if (own.length) {
      r.win[1]++
      if (!own.includes(p.col)) r.win[0]++
      continue
    }
    if (opp.length === 1) {
      const dir = alignedWith(pos, 2, opp[0]).dir
      r.miss[dir][1]++
      if (p.col !== opp[0]) r.miss[dir][0]++
    }
    if (!opp.length && fromBoard(p.after, id).winsWith(p.col, 2)) r.gift++
  }
  return r
}

/* ------------------------------------------------------------------ moments */

const mk = (type: string, weight: number, vars: Moment['vars'], steps: Step[]): Moment => ({ type, weight, vars, steps })
const st = (ply: number, ...marks: Array<Mark | false | undefined>): Step => ({ ply, marks: marks.filter((m): m is Mark => !!m && m.cells.length > 0) })

function findMoments(log: SoloLog, loser: Side, budgetMs = 400): Moment[] {
  if (!log.x0) return []
  const t0 = performance.now()
  const ctx: Ctx = { nodes: 0, deadline: t0 + Math.max(0, budgetMs * 0.85 - 10) }
  const ps = plies(log)
  const lid = loser === 'me' ? log.me : log.bot
  const out: Moment[] = []
  const end = ps.length
  const last = ps[end - 1]
  const meK = (i: number) => ps.filter((p) => p.by === 'me' && p.i <= i).length
  const winSide: Side = loser === 'me' ? 'bot' : 'me'
  const finalLine = (last?.after.line ?? []) as Array<[number, number]>
  const lineCells = finalLine.map(([c, r]) => cellOf(c, r))
  /** Position avant le coup gagnant du joueur : ce coup en vert + sa ligne. */
  const finalStep = (): Step => st(end - 1, { kind: 'line', cells: lineCells }, last && { kind: 'better', cells: [cellOf(last.col, last.row)] })
  const playedOf = (p: Ply): Mark => ({ kind: 'played', cells: [cellOf(p.col, p.row)] })
  const landing = (b: Q4Board, c: number) => cellOf(c, b.cols[c].length)
  const seen = new Set<string>()
  const push = (m: Moment, ply: number) => {
    const k = `${m.type}@${ply}`
    if (seen.has(k)) return
    seen.add(k)
    out.push(m)
  }

  // Détecteurs immédiats, à chaque coup du perdant.
  let k = 0
  for (const p of ps) {
    if (p.by !== loser) continue
    k++
    const pos = fromBoard(p.board, lid)
    const own = immediate(pos, 1)
    const opp = immediate(pos, 2)
    const base = { coup: nth(loser === 'me' ? k : meK(p.i)), col_jouee: COL_NAMES[p.col] }
    if (own.length && !own.includes(p.col)) {
      const w = own[0]
      const al = alignedWith(pos, 1, w)
      const wc = landing(p.board, w)
      const vars = { ...base, col: COL_NAMES[w], dir: DIR_TXT[al.dir] }
      push(
        loser === 'me'
          ? mk('victoire_manquee', 100, vars, [st(p.i + 1, playedOf(p)), st(p.i, { kind: 'line', cells: [...al.cells, wc] }, { kind: 'better', cells: [wc] })])
          : mk('victoire_manquee', 100, vars, [st(p.i + 1, playedOf(p), { kind: 'threat', cells: [wc] }), finalStep()]),
        p.i,
      )
      continue
    }
    if (own.length) continue
    if (opp.length === 1 && p.col !== opp[0]) {
      const blk = opp[0]
      const al = alignedWith(pos, 2, blk)
      const bc = landing(p.board, blk)
      const vars = { ...base, col: COL_NAMES[blk], dir: DIR_TXT[al.dir], dir_id: al.dir }
      push(
        loser === 'me'
          ? mk('blocage_oublie', 90, vars, [st(p.i + 1, { kind: 'threat', cells: al.cells }, playedOf(p)), st(p.i, { kind: 'threat', cells: al.cells }, { kind: 'better', cells: [bc] })])
          : mk('blocage_oublie', 90, vars, [st(p.i + 1, { kind: 'threat', cells: [...al.cells, bc] }, playedOf(p)), finalStep()]),
        p.i,
      )
      continue
    }
    if (!opp.length && fromBoard(p.after, lid).winsWith(p.col, 2)) {
      const above = cellOf(p.col, p.row + 1)
      // une colonne sûre : qui n'offre pas de victoire immédiate
      const safe = ORDER.find((c) => {
        if (c === p.col || pos.h[c] >= H) return false
        pos.play(c, 1)
        const bad = immediate(pos, 2).length > 0
        pos.undo(c)
        return !bad
      })
      const next = ps[p.i + 1]
      const shown = next && next.by !== loser && next.col === p.col ? p.i + 2 : p.i + 1
      const vars = { ...base, col: safe === undefined ? COL_NAMES[p.col] : COL_NAMES[safe] }
      push(
        loser === 'me'
          ? mk('cadeau_dessous', 80, vars, [st(shown, playedOf(p), { kind: 'threat', cells: [above] }), ...(safe === undefined ? [] : [st(p.i, { kind: 'better', cells: [landing(p.board, safe)] })])])
          : mk('cadeau_dessous', 80, vars, [st(shown, playedOf(p), { kind: 'threat', cells: [above] }), finalStep()]),
        p.i,
      )
    }
  }

  const kOf = new Map<number, number>()
  for (const p of ps) if (p.by === loser) kOf.set(p.i, kOf.size + 1)

  // Le coup qui a fait basculer la partie (approfondissement tant que le budget le permet).
  let critical: { p: Ply; hold: number } | null = null
  const mine = ps.filter((p) => p.by === loser).reverse().slice(0, 6)
  try {
    for (const d of [3, 5, 7]) {
      let found: { p: Ply; hold: number } | null = null
      for (const p of mine) {
        const pos = fromBoard(p.board, lid)
        if (!loses(pos, p.col, d, ctx)) break
        const hold = ORDER.find((c) => c !== p.col && pos.h[c] < H && !loses(pos, c, d, ctx))
        if (hold !== undefined) {
          found = { p, hold }
          break
        }
      }
      critical = found
    }
  } catch (e) {
    if (!(e instanceof OutOfTime)) throw e
  }

  if (critical) {
    const { p, hold } = critical
    const known = out.some((m) => m.steps.some((s) => s.ply === p.i || s.ply === p.i + 1) && ['victoire_manquee', 'blocage_oublie', 'cadeau_dessous'].includes(m.type))
    if (!known) {
      const reply = ps[p.i + 1]
      const holdCell = landing(p.board, hold)
      const base = { coup: nth(loser === 'me' ? (kOf.get(p.i) ?? 1) : meK(p.i)), col: COL_NAMES[hold], col_jouee: COL_NAMES[p.col] }
      let two: number[] = []
      if (reply && reply.by !== loser) {
        const posR = fromBoard(reply.after, lid)
        const wins = immediate(posR, 2)
        two = wins.map((c) => landing(reply.after, c))
        // menace « empilée » : bloquer la case gagnante lui offre celle du dessus
        for (const c of wins) {
          posR.play(c, 1)
          if (posR.h[c] < H && posR.winsWith(c, 2)) two.push(cellOf(c, posR.h[c]))
          posR.undo(c)
        }
      }
      if (two.length >= 2) {
        out.push(
          loser === 'me'
            ? mk('double_menace', 70, base, [st(p.i + 2, playedOf(p), { kind: 'threat', cells: two }), st(p.i, { kind: 'better', cells: [holdCell] })])
            : mk('double_menace', 70, { ...base, coup: nth(meK(reply.i)) }, [st(p.i + 1, playedOf(p)), st(reply.i, { kind: 'threat', cells: two }, { kind: 'better', cells: [cellOf(reply.col, reply.row)] })]),
        )
      } else {
        out.push(
          loser === 'me'
            ? mk('mauvais_plan', 50, base, [st(p.i + 1, playedOf(p)), st(p.i, { kind: 'better', cells: [holdCell] })])
            : mk('mauvais_plan', 50, base, [st(p.i + 1, playedOf(p)), finalStep()]),
        )
      }
    }
  }

  // Repli : l'alignement gagnant.
  if (lineCells.length) {
    const vars = { dir: DIR_TXT[lineDir(finalLine)], coup: nth(meK(end - 1)) }
    out.push(mk('alignement', 10, vars, [winSide === 'me' ? finalStep() : st(end, { kind: 'line', cells: lineCells })]))
  }

  // Coup décisif du bot appris (2b).
  if (loser === 'me')
    for (const m of out) {
      if (m.learned || !m.steps.length) continue
      const plys = m.steps.map((s) => s.ply)
      const l = learnedNear(log, Math.min(...plys) - 1, Math.max(...plys) + 3)
      if (l) m.learned = l
    }
  return out
}

/* ------------------------------------------------------------------ phrases */

const LOSS: Record<string, { lines: string[]; tip: string }> = {
  victoire_manquee: {
    lines: ['À ton {coup}, un jeton dans {col} et tu alignais quatre !', 'Tu avais trois jetons alignés et la place était libre dans {col}.'],
    tip: 'Avant de lâcher ton jeton, cherche tes alignements de trois.',
  },
  blocage_oublie: {
    lines: ['J’avais trois jetons alignés {dir} : il fallait jouer {col} pour me bloquer.', 'À ton {coup}, tu as joué {col_jouee}, et j’ai fini ma ligne.'],
    tip: 'Compte mes jetons alignés : à trois, il faut bloquer.',
  },
  cadeau_dessous: {
    lines: ['Ton jeton dans {col_jouee} m’a fait la courte échelle : j’ai posé le mien juste au-dessus.', 'La case du dessus me faisait gagner : il valait mieux jouer {col}.'],
    tip: 'Avant de jouer une colonne, regarde ce que la case du dessus m’offrirait.',
  },
  double_menace: {
    lines: ['À ton {coup}, tu as joué {col_jouee}. Après ma réponse, j’avais deux façons de gagner.', 'Tu ne pouvais en bloquer qu’une. Avec {col}, je n’avais pas ma double menace.'],
    tip: 'Deux de mes jetons côte à côte avec de la place des deux côtés ? Bloque tout de suite.',
  },
  mauvais_plan: {
    // (phrase du § 5.2 coupée en deux pour tenir dans la carte : ≤ 110 caractères)
    lines: ['À ton {coup}, {col_jouee} m’a ouvert la voie : après, je gagnais quoi que tu fasses.', 'Avec {col} à la place, ça tenait encore.'],
    tip: 'Garde le milieu du plateau : c’est de là que partent le plus d’alignements.',
  },
  alignement: {
    lines: ['J’ai construit mon alignement {dir}, petit à petit.'],
    tip: 'Regarde mes jetons après chacun de mes coups : où est-ce que j’en ai deux ou trois ?',
  },
}
const DIAG_TIP = 'Les diagonales sont les plus dures à voir : suis-les du doigt avant de jouer.'

const WIN_TXT: Record<string, string> = {
  double_menace: 'Ton {coup} m’a eu{e} : deux menaces d’un coup, je ne pouvais plus tout bloquer !',
  blocage_oublie: 'J’ai oublié de te bloquer… et tu n’as pas raté ça. Bien vu !',
  victoire_manquee: 'Entre nous : je pouvais gagner juste avant et je ne l’ai pas vu. Bravo d’en avoir profité !',
  cadeau_dessous: 'J’ai posé mon jeton juste sous ta case gagnante… et tu as sauté dessus. Bien vu !',
  repli: 'Bien joué : tu as été plus solide que moi du début à la fin.',
}

function texts(m: Moment, loser: Side): WhyText {
  if (loser === 'bot') return { lines: [fill(WIN_TXT[m.type] ?? WIN_TXT.repli, m.vars)] }
  const t = LOSS[m.type] ?? LOSS.alignement
  const tip = m.type === 'blocage_oublie' && m.vars.dir_id === 'd' ? DIAG_TIP : t.tip
  return { lines: t.lines.map((s) => fill(s, m.vars)), tip: fill(tip, m.vars) }
}

export const why: GameWhy = { findMoments, texts }
