/**
 * Explication de fin de partie des Échecs (2a), à base de règles sur le journal (on ne
 * cherche pas « la position perdue ») : mat en 1 raté, mat évitable, pièce donnée, menace
 * ignorée, défense retirée, deux menaces d'un coup, mauvais échange, roi au centre, repli
 * matériel. « Le bon coup » = recherche du bot (profondeur 2, ≤ 300 ms), montré seulement
 * s'il fait au moins 1,5 pion de mieux. Tourne dans le Web Worker du solo (≤ 1,5 s ;
 * dépassement -> repli). Mêmes détecteurs pour le compliment (loser = 'bot') et pour les
 * compteurs de l'apprentissage (learn.ts : scan).
 */
import type { Chess, Square } from 'chess.js'
import { learnedNear, replayAll, type Side, type SoloLog } from '@/features/solo/log'
import { fill, type GameWhy, type Mark, type Moment, type WhyText } from '@/features/solo/why/types'
import { analyseRoot, boardChess } from './bot'
import { idx, raw, type InternalMove } from './chessCore'
import { local } from './local'
import type { ChessBoard, ChessMove, ChessSide } from './types'

const VAL: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }
const NAMES: Record<string, [string, boolean]> = { p: ['pion', false], n: ['cavalier', false], b: ['fou', false], r: ['tour', true], q: ['dame', true], k: ['roi', false] }

/** « e4 » (0 = a8). */
export const squareName = (i: number): string => `${'abcdefgh'[i % 8]}${8 - Math.floor(i / 8)}`
const sqn = (i: number) => squareName(i) as Square
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
/** « ta dame » (pièce du joueur) / « ma dame » (pièce du bot). */
export function pieceName(type: string, owner: Side): string {
  const [n, fem] = NAMES[type] ?? NAMES.p
  return `${owner === 'me' ? (fem ? 'ta' : 'ton') : fem ? 'ma' : 'mon'} ${n}`
}
const typeAt = (sq: string, i: number) => sq[i]?.toLowerCase() ?? '.'
const colorAt = (sq: string, i: number): ChessSide | null => (sq[i] === '.' || !sq[i] ? null : sq[i] === sq[i].toUpperCase() ? 'w' : 'b')
const other = (c: ChessSide): ChessSide => (c === 'w' ? 'b' : 'w')

interface CPly {
  i: number
  by: Side
  before: ChessBoard
  after: ChessBoard
  /** Coup normal (from / to), sinon abandon / nulle acceptée. */
  from: number
  to: number
  normal: boolean
}

function plies(log: SoloLog): CPly[] {
  const pos = replayAll(local, log)
  return log.entries.map((e, i) => {
    const m = e.action.move as ChessMove & { from?: number; to?: number }
    const normal = typeof m?.from === 'number' && typeof m?.to === 'number'
    return { i, by: e.by, before: pos[i].state.board as ChessBoard, after: pos[i + 1].state.board as ChessBoard, from: normal ? m.from! : -1, to: normal ? m.to! : -1, normal }
  })
}

/** Coups qui matent tout de suite (camp au trait). */
function mateMoves(c: Chess): InternalMove[] {
  const r = raw(c)
  const out: InternalMove[] = []
  for (const m of r._moves({ legal: true })) {
    r._makeMove(m)
    if (r._moves({ legal: true }).length === 0 && c.inCheck()) out.push(m)
    r._undoMove()
  }
  return out
}

function material(sq: string, side: ChessSide): number {
  let n = 0
  for (let i = 0; i < 64; i++) if (colorAt(sq, i) === side) n += VAL[typeAt(sq, i)] ?? 0
  return n
}

export type MateKind = 'couloir' | 'berger' | 'autre'
function mateKind(final: ChessBoard, lc: ChessSide, mf: number, mt: number, before: ChessBoard): MateKind {
  const king = final.sq.indexOf(lc === 'w' ? 'K' : 'k')
  const mover = typeAt(before.sq, mf)
  const back = lc === 'w' ? 7 : 0
  if (king >= 0 && Math.floor(king / 8) === back && (mover === 'r' || mover === 'q') && Math.floor(mt / 8) === back) return 'couloir'
  if (mover === 'q' && (mt === 13 || mt === 53) && before.full <= 6) return 'berger'
  return 'autre'
}

export type LossType = 'piece_donnee' | 'menace_ignoree' | 'defense_retiree' | 'fourchette' | 'mauvais_echange'
interface Loss {
  type: LossType
  /** Coup du perdant ; j = prise du gagnant (i + 1). */
  i: number
  j: number
  /** Case et type de la pièce perdue. */
  s: number
  x: string
  net: number
  /** Pièce jouée par le perdant (type), sa case d'arrivée, ce qu'il a pris (type ou ''). */
  p: string
  t: number
  took: string
  /** Case et type de la pièce du gagnant qui prend. */
  a: number
  at: string
  recaptured: boolean
  /** Deux menaces d'un coup : case de la pièce qui attaque et cases visées. */
  y?: number
  targets?: number[]
}

/** Pertes nettes ≥ 2 (pion 1, cavalier/fou 3, tour 5, dame 9) du camp `lc`, une par prise. */
function losses(ps: CPly[], loser: Side, lc: ChessSide): Loss[] {
  const wc = other(lc)
  const out: Loss[] = []
  for (const p of ps) {
    if (p.by !== loser || !p.normal) continue
    const w = ps[p.i + 1]
    if (!w || w.by === loser || !w.normal) continue
    const s = w.to
    if (colorAt(w.before.sq, s) !== lc) continue
    const x = typeAt(w.before.sq, s)
    const at = typeAt(w.before.sq, w.from)
    const took = colorAt(p.before.sq, p.to) === wc ? typeAt(p.before.sq, p.to) : ''
    const re = ps[p.i + 2]
    const recaptured = !!re && re.by === loser && re.normal && re.to === s
    const net = VAL[x] - (took ? VAL[took] : 0) - (recaptured ? VAL[at] : 0)
    if (net < 2) continue
    const pt = typeAt(p.before.sq, p.from)
    const base = { i: p.i, j: w.i, s, x, net, p: pt, t: p.to, took, a: w.from, at, recaptured }
    if (s === p.to) {
      if (took) out.push({ ...base, type: 'mauvais_echange' })
      else if ('nbrq'.includes(pt)) out.push({ ...base, type: 'piece_donnee' })
      continue
    }
    // Deux menaces d'un coup : la pièce qui prend venait d'arriver et attaquait 2 pièces (ou le roi et une pièce).
    const prev = ps[p.i - 1]
    if (prev && prev.by !== loser && prev.normal && prev.to === w.from) {
      const c = boardChess(p.before)
      const targets: number[] = []
      for (let q = 0; q < 64; q++) {
        if (colorAt(p.before.sq, q) !== lc) continue
        const tq = typeAt(p.before.sq, q)
        if (tq !== 'k' && VAL[tq] < 3) continue
        if (c.attackers(sqn(q), wc).includes(sqn(w.from))) targets.push(q)
      }
      if (targets.length >= 2) {
        const order = (q: number) => (typeAt(p.before.sq, q) === 'k' ? 100 : VAL[typeAt(p.before.sq, q)]) + (q === s ? 0.5 : 0)
        out.push({ ...base, type: 'fourchette', y: w.from, targets: targets.sort((u, v) => order(v) - order(u)).slice(0, 2) })
        continue
      }
    }
    // Déjà « sans protection » avant son coup (attaquée, et pas ou mal défendue) ?
    const c0 = boardChess(p.before)
    if (c0.isAttacked(sqn(s), wc)) {
      const att = c0.attackers(sqn(s), wc).map((n) => VAL[typeAt(p.before.sq, (8 - Number(n[1])) * 8 + n.charCodeAt(0) - 97)])
      const def = c0.attackers(sqn(s), lc)
      if (!def.length || Math.min(...att) <= VAL[x] - 2) {
        out.push({ ...base, type: 'menace_ignoree' })
        continue
      }
    }
    out.push({ ...base, type: 'defense_retiree' })
  }
  return out
}

const neverCastled = (ps: CPly[], who: Side) => !ps.some((p) => p.by === who && p.normal && typeAt(p.before.sq, p.from) === 'k' && Math.abs(p.to - p.from) === 2)

/** Faits bruts sur la partie du joueur, pour l'apprentissage (sans recherche, rapide). */
export interface ChessScan {
  /** Types de pièces perdues (pièce donnée, menace ignorée, défense retirée). */
  hang: string[]
  castled: boolean
  /** Sa dame a bougé avant son 6e coup. */
  queenEarly: boolean
  /** Il s'est fait mater : comment. */
  mate: MateKind | null
}

export function scan(log: SoloLog): ChessScan {
  if (!log.x0) return { hang: [], castled: false, queenEarly: false, mate: null }
  const ps = plies(log)
  const x0 = log.x0.state.board as ChessBoard
  const mc: ChessSide = x0.white === log.me ? 'w' : 'b'
  const hang = losses(ps, 'me', mc)
    .filter((l) => l.type === 'piece_donnee' || l.type === 'menace_ignoree' || l.type === 'defense_retiree')
    .map((l) => l.x)
  const mine = ps.filter((p) => p.by === 'me' && p.normal)
  const queenEarly = mine.slice(0, 5).some((p) => typeAt(p.before.sq, p.from) === 'q')
  const final = ps.length ? ps[ps.length - 1].after : x0
  let mate: MateKind | null = null
  const last = ps[ps.length - 1]
  if (final.end?.reason === 'mate' && final.end.winner === log.bot && last?.normal) mate = mateKind(final, mc, last.from, last.to, last.before)
  return { hang, castled: !neverCastled(ps, 'me'), queenEarly, mate }
}

class TimeUp extends Error {}
const BETTER_TYPES = new Set(['mat_evitable', 'piece_donnee', 'menace_ignoree', 'defense_retiree', 'fourchette', 'mauvais_echange'])

interface Draft extends Moment {
  /** Position (indice du journal) où chercher le bon coup, coup joué, coups permis (mat évitable). */
  at?: number
  played?: [number, number]
  alt?: Array<[number, number]>
}

function findMoments(log: SoloLog, loser: Side, budgetMs = 1500): Moment[] {
  if (!log.x0) return []
  const deadline = performance.now() + budgetMs
  const tick = () => {
    if (performance.now() > deadline) throw new TimeUp()
  }
  const x0 = log.x0.state.board as ChessBoard
  const ps = plies(log)
  const meWhite = x0.white === log.me
  const lc: ChessSide = (loser === 'me') === meWhite ? 'w' : 'b'
  const wc = other(lc)
  const winner: Side = loser === 'me' ? 'bot' : 'me'
  const final = ps.length ? ps[ps.length - 1].after : x0
  const ecart = material(final.sq, wc) - material(final.sq, lc)
  const repli: Moment = { type: 'materiel', weight: 10, vars: { ecart }, steps: [{ ply: ps.length, marks: [] }] }
  const out: Draft[] = []

  try {
    // 1. Mat en 1 raté (à n'importe quel moment).
    for (const p of ps) {
      if (p.by !== loser || !p.normal) continue
      tick()
      const mates = mateMoves(boardChess(p.before))
      if (!mates.length || mates.some((m) => idx(m.from) === p.from && idx(m.to) === p.to)) continue
      const f = idx(mates[0].from)
      const t = idx(mates[0].to)
      const vars = { coup: String(p.before.full), piece: pieceName(typeAt(p.before.sq, f), loser), case: squareName(t) }
      out.push({
        type: 'mat_en_1_rate',
        weight: loser === 'me' ? 100 : 85,
        vars,
        steps: [
          { ply: p.i + 1, marks: [{ kind: 'played', cells: [p.to] }] },
          { ply: p.i, marks: [{ kind: loser === 'me' ? 'better' : 'threat', cells: [t], arrow: [f, t] }] },
        ],
      })
    }

    // 2. Fin par mat.
    const last = ps[ps.length - 1]
    if (final.end?.reason === 'mate' && last?.normal && last.by === winner) {
      const mf = last.from
      const mt = last.to
      const kind = mateKind(final, lc, mf, mt, last.before)
      if (loser === 'me') {
        const prev = [...ps].reverse().find((p) => p.by === 'me' && p.normal && p.i < last.i)
        if (prev) {
          tick()
          const c = boardChess(prev.before)
          const r = raw(c)
          const alt: Array<[number, number]> = []
          for (const m of r._moves({ legal: true })) {
            r._makeMove(m)
            if (!mateMoves(c).length) alt.push([idx(m.from), idx(m.to)])
            r._undoMove()
          }
          if (alt.length) {
            out.push({
              type: 'mat_evitable',
              weight: 90,
              vars: {
                coup: String(prev.before.full),
                piece_jouee: pieceName(typeAt(prev.before.sq, prev.from), 'me'),
                case_jouee: squareName(prev.to),
                piece_bot: pieceName(typeAt(last.before.sq, mf), 'bot'),
                kind,
              },
              steps: [{ ply: prev.i + 1, marks: [{ kind: 'played', cells: [prev.to] }, { kind: 'threat', cells: [mt], arrow: [mf, mt] }] }],
              at: prev.i,
              played: [prev.from, prev.to],
              alt,
            })
          }
        }
        const king = final.sq.indexOf(lc === 'w' ? 'K' : 'k')
        if (king >= 0 && king % 8 === 4 && neverCastled(ps, 'me'))
          out.push({ type: 'roi_au_centre', weight: 40, vars: { kind }, steps: [{ ply: ps.length, marks: [{ kind: 'threat', cells: [king] }, { kind: 'played', cells: [mt] }] }] })
      } else {
        out.push({
          type: 'mat',
          weight: 95,
          vars: { coup: String(last.before.full), piece: pieceName(typeAt(last.before.sq, mf), 'me'), case: squareName(mt) },
          steps: [{ ply: last.i, marks: [{ kind: 'better', cells: [mt], arrow: [mf, mt] }] }],
        })
      }
    }

    // 3. Pièces perdues.
    tick()
    for (const l of losses(ps, loser, lc)) {
      tick()
      const p = ps[l.i]
      const w = ps[l.j]
      const bonus = Math.min(l.net, 9) / 10
      const weight = { piece_donnee: 80, menace_ignoree: 78, defense_retiree: 76, fourchette: 72, mauvais_echange: 65 }[l.type] + bonus
      if (loser === 'bot') {
        out.push({
          type: l.type,
          weight,
          vars: { coup: String(w.before.full), piece_bot: pieceName(l.x, 'bot'), piece: pieceName(l.at, 'me'), case: squareName(l.s) },
          steps: [{ ply: l.i + 1, marks: [{ kind: 'played', cells: [l.t] }, { kind: 'better', cells: [l.s], arrow: [l.a, l.s] }] }],
        })
        continue
      }
      const fem = l.x === 'r' || l.x === 'q'
      const vars: Record<string, string | number> = {
        coup: String(p.before.full),
        piece: pieceName(l.x, 'me'),
        piece_jouee: pieceName(l.p, 'me'),
        case_jouee: squareName(l.t),
        piece_bot: pieceName(l.at, 'bot'),
        Piece_bot: cap(pieceName(l.at, 'bot')),
        piece_prise: l.took ? pieceName(l.took, 'bot') : '',
        pris: fem ? 'prise' : 'pris',
        le: fem ? 'la' : 'le',
        protege: l.recaptured ? 1 : 0,
      }
      let marks: Mark[]
      let ply = l.i + 1
      if (l.type === 'piece_donnee') marks = [{ kind: 'played', cells: [l.t] }, { kind: 'threat', cells: [l.a], arrow: [l.a, l.t] }]
      else if (l.type === 'mauvais_echange') {
        ply = l.i + 2
        marks = [{ kind: 'played', cells: [l.t] }, { kind: 'threat', cells: [l.a], arrow: [l.a, l.t] }]
      } else if (l.type === 'fourchette') {
        ply = l.i
        const targets = l.targets ?? []
        marks = targets.map((q) => ({ kind: 'threat' as const, cells: [q], arrow: [l.y!, q] as [number, number] }))
        const sb = p.before.sq
        vars.Piece_bot = cap(pieceName(typeAt(sb, l.y!), 'bot'))
        vars.piece_a = pieceName(typeAt(sb, targets[0]), 'me')
        vars.piece_b = pieceName(typeAt(sb, targets[1]), 'me')
        const before = [...ps].reverse().find((q) => q.by === 'me' && q.normal && q.i < l.i - 1)
        vars.avant = before ? String(before.before.full) : ''
      } else marks = [{ kind: 'played', cells: [l.t] }, { kind: 'threat', cells: [l.s], arrow: [l.a, l.s] }]
      out.push({ type: l.type, weight, vars, steps: [{ ply, marks }], at: l.i, played: [p.from, p.to] })
    }
  } catch (e) {
    if (e instanceof TimeUp) return [repli]
    throw e
  }
  out.push(repli)

  // 4. « Le bon coup » pour les moments les plus parlants (dans le temps qui reste).
  if (loser === 'me') {
    const ranked = [...out].filter((m) => BETTER_TYPES.has(m.type) && m.at !== undefined).sort((p, q) => q.weight - p.weight)
    for (const m of ranked.slice(0, 3)) {
      const left = deadline - performance.now()
      if (left < 30) break
      const res = analyseRoot(boardChess(ps[m.at!].before), 2, Math.min(300, left))
      if (!res?.length) continue
      const key = (x: InternalMove): [number, number] => [idx(x.from), idx(x.to)]
      let best = res[0]
      if (m.alt) {
        const ok = res.filter((x) => m.alt!.some(([f, t]) => f === idx(x.m.from) && t === idx(x.m.to)))
        if (!ok.length) continue
        best = ok[0]
      } else {
        const played = res.find((x) => idx(x.m.from) === m.played![0] && idx(x.m.to) === m.played![1])
        if (!played || best.s - played.s < 150) continue
      }
      const [f, t] = key(best.m)
      m.steps.push({ ply: m.at!, marks: [{ kind: 'better', cells: [t], arrow: [f, t] }] })
      m.vars.piece = m.type === 'mat_evitable' ? pieceName(typeAt(ps[m.at!].before.sq, f), 'me') : m.vars.piece
      m.vars.case = squareName(t)
      m.vars.sauve = 1
    }
    // Coup décisif du bot appris (2b).
    for (const m of out) {
      if (!m.steps.length) continue
      const pl = m.steps.map((s) => s.ply)
      const learned = learnedNear(log, Math.min(...pl) - 1, Math.max(...pl) + 3)
      if (learned) m.learned = learned
    }
  }
  return out.map((d) => {
    const m: Draft = { ...d }
    delete m.at
    delete m.played
    delete m.alt
    return m as Moment
  })
}

const LOSS: Record<string, { lines: string[]; tip: string }> = {
  mat_en_1_rate: {
    lines: ['Au coup {coup}, tu pouvais me faire échec et mat : {piece} en {case} !', 'Mon roi n’avait plus aucune sortie.'],
    tip: 'Quand tu peux donner échec, regarde si mon roi a encore une case où fuir.',
  },
  mat_evitable: {
    lines: ['Au coup {coup}, tu as joué {piece_jouee} en {case_jouee} : ça m’a laissé le mat avec {piece_bot}.', 'Avec {piece} en {case}, ton roi s’en sortait.'],
    tip: 'Avant de jouer : est-ce que ton roi peut être mis en échec au prochain coup ?',
  },
  piece_donnee: {
    lines: ['Au coup {coup}, tu as posé {piece} en {case_jouee}, pile sur une case que {piece_bot} attaquait.', 'Personne ne protégeait {piece} : je me suis servi{e}.'],
    tip: 'Avant de lâcher une pièce, regarde qui attaque la case d’arrivée.',
  },
  menace_ignoree: {
    lines: ['{Piece_bot} attaquait {piece} et tu as joué autre chose. Je l’ai {pris} !', 'Au coup {coup}, il fallait {le} bouger ou {le} protéger.'],
    tip: 'Après chacun de mes coups, demande-toi : qu’est-ce qu’il attaque ?',
  },
  defense_retiree: {
    lines: ['En bougeant {piece_jouee}, tu as laissé {piece} sans protection.'],
    tip: 'Avant de bouger une pièce, regarde ce qu’elle protégeait.',
  },
  fourchette: {
    lines: ['{Piece_bot} attaquait {piece_a} et {piece_b} en même temps : tu ne pouvais en sauver qu’une.', 'Deux menaces d’un coup, arrivées juste après ton coup {avant}.'],
    tip: 'Méfie-toi de mes cavaliers et de ma dame : ils adorent attaquer deux pièces à la fois.',
  },
  mauvais_echange: {
    lines: ['Au coup {coup}, tu as pris {piece_prise} avec {piece}… mais la case était protégée, et j’ai repris {piece}.'],
    tip: 'Avant de prendre, compte : qu’est-ce que je gagne, qu’est-ce que je risque de perdre ?',
  },
  roi_au_centre: {
    lines: ['Ton roi est resté au milieu toute la partie : c’est là que mes pièces l’ont attrapé.'],
    tip: 'Roque dans les 10 premiers coups : ton roi sera à l’abri derrière ses pions.',
  },
  materiel: {
    lines: ['Pas de grosse bêtise : j’ai grignoté petit à petit.', 'À la fin, j’avais {ecart} points de pièces en plus.'],
    tip: 'Avant chaque coup : est-ce qu’une de tes pièces est attaquée ?',
  },
}
const COULOIR_TIP = 'Ouvre une petite fenêtre à ton roi : avance d’une case un pion devant lui.'

const WIN: Record<string, string> = {
  mat: 'Échec et mat au coup {coup} avec {piece} en {case} : je ne l’ai pas vu venir !',
  mat_en_1_rate: 'Entre nous : je pouvais gagner juste avant et je ne l’ai pas vu. Bravo d’en avoir profité !',
  piece_donnee: 'Ton coup {coup} m’a pris {piece_bot} : c’est là que la partie a tourné.',
  materiel: 'Bien joué : tu as été plus solide que moi du début à la fin.',
}

function texts(m: Moment, loser: Side): WhyText {
  if (loser === 'bot') {
    const t = WIN[m.type] ?? (m.vars.piece_bot ? WIN.piece_donnee : WIN.materiel)
    return { lines: [fill(t, m.vars)] }
  }
  const t = LOSS[m.type] ?? LOSS.materiel
  let lines = t.lines
  if (m.type === 'mat_evitable' && !m.vars.sauve) lines = lines.slice(0, 1)
  else if (m.type === 'mat_evitable' && m.vars.piece === 'ton roi') lines = [lines[0], 'En allant en {case}, ton roi s’en sortait.']
  if (m.type === 'piece_donnee' && m.vars.protege) lines = [lines[0], 'Même en reprenant, tu perdais plus que moi.']
  if (m.type === 'fourchette' && !m.vars.avant) lines = [lines[0], 'Deux menaces d’un coup : impossible de tout sauver.']
  if (m.type === 'materiel' && !(Number(m.vars.ecart) > 0)) lines = ['Pas de grosse bêtise : la partie s’est jouée sur des détails.']
  const tip = m.type === 'mat_evitable' && m.vars.kind === 'couloir' ? COULOIR_TIP : t.tip
  return { lines: lines.map((s) => fill(s, m.vars)), tip }
}

export const why: GameWhy = { findMoments, texts }
