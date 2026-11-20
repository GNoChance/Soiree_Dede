/**
 * Explication de fin de partie de la Bataille navale (2a) — une course : on montre le plus
 * gros gaspillage de tirs du joueur, d'après ce qu'il savait à ce moment-là (ses tirs, les
 * bateaux coulés) : ligne pas suivie, chasse abandonnée, tir dans un trou trop petit,
 * bateaux collés ; 2b : flotte prévisible (contexte figé au début : SoloLog.ctx).
 *
 * Cases des marques : y × 10 + x sur les eaux du BOT (tirs du joueur) ; + 100 = les eaux
 * du JOUEUR (sa flotte, les tirs du bot) — cf. Diagram.tsx.
 */
import { replayAll, type Side, type SoloLog } from '@/features/solo/log'
import { fill, nth, type GameWhy, type Moment, type WhyText } from '@/features/solo/why/types'
import { heatMap } from './bot'
import { local } from './local'
import { FLEET_CELLS, SHIPS, autoShotCandidates, cellIndex, cellName, cellXY, fleetMap, shipCells } from './logic'
import type { BnBoard, BnShip, BnShotMove } from './types'

/** Plus grand décalage pour les eaux du joueur dans les marques. */
export const OWN = 100

/** Contexte d'apprentissage figé au début de la partie (learn.ts → logCtx). */
export interface BnLogCtx {
  /** B1 actif (le bot tire d'abord sur les cachettes habituelles). */
  b1: boolean
  /** Cases habituelles du joueur (p ≥ 0,5). */
  cells: number[]
}

const name = (i: number) => {
  const [x, y] = cellXY(i)
  return cellName(x, y)
}

interface Shot {
  /** Indice dans le journal. */
  i: number
  /** n° de tir du tireur (1, 2…). */
  k: number
  cell: number
  /** Plateau AVANT le tir. */
  board: BnBoard
}

function shotsOf(log: SoloLog, who: Side, boards: BnBoard[]): Shot[] {
  const out: Shot[] = []
  let k = 0
  log.entries.forEach((e, i) => {
    if (e.by !== who) return
    const m = e.action.move as BnShotMove
    out.push({ i, k: ++k, cell: cellIndex(m.x, m.y), board: boards[i] })
  })
  return out
}

/** Cases de bateau touchées par `shooter` sur l'ensemble de la partie. */
const hitsBy = (b: BnBoard, shooter: string) => {
  const target = shooter === b.a ? b.b : b.a
  return (b.waters[target]?.shots ?? []).filter((s) => s.r !== 'miss').length
}

/** Trou : cases encore inconnues sur la ligne et la colonne du tir (jusqu'à une case déjà visée). */
function hole(b: BnBoard, shooter: string, cell: number): number[] {
  const target = shooter === b.a ? b.b : b.a
  const known = new Set((b.waters[target]?.shots ?? []).map((s) => cellIndex(s.x, s.y)))
  const [x0, y0] = cellXY(cell)
  const out = [cell]
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    for (let x = x0 + dx, y = y0 + dy; x >= 0 && y >= 0 && x < 10 && y < 10 && !known.has(cellIndex(x, y)); x += dx, y += dy) out.push(cellIndex(x, y))
  }
  return out
}

/** Bateaux collés : cases des bateaux qui en touchent un autre (bord ou coin). */
export function gluedCells(fleet: readonly BnShip[]): number[] {
  const owner = fleetMap(fleet)
  const out = new Set<number>()
  for (const s of fleet)
    for (const [x, y] of shipCells(s) ?? [])
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx > 9 || ny > 9) continue
          const o = owner.get(cellIndex(nx, ny))
          if (o && o !== s.id) for (const [cx, cy] of shipCells(s) ?? []) out.add(cellIndex(cx, cy))
        }
  return [...out].sort((p, q) => p - q)
}

/** Défauts de tir de `who` (explication, apprentissage). */
export interface BnScan {
  line: Array<{ s: Shot; hits: number[]; better: number[] }>
  hunt: Array<{ s: Shot; hit: number; better: number[] }>
  waste: Array<{ s: Shot; hole: number[]; minSize: number }>
}

export function scan(log: SoloLog, who: Side, boards: BnBoard[]): BnScan {
  const id = who === 'me' ? log.me : log.bot
  const r: BnScan = { line: [], hunt: [], waste: [] }
  for (const s of shotsOf(log, who, boards)) {
    const target = id === s.board.a ? s.board.b : s.board.a
    const w = s.board.waters[target]
    const shots = w?.shots ?? []
    const c = autoShotCandidates(shots)
    const live = shots.filter((q) => q.r === 'hit').map((q) => cellIndex(q.x, q.y))
    if (c.line.length) {
      if (!c.line.includes(s.cell)) {
        // les deux touchés alignés qui donnent la ligne
        const tip = c.line[0]
        const [tx, ty] = cellXY(tip)
        const near = live.filter((h) => {
          const [hx, hy] = cellXY(h)
          return (hx === tx || hy === ty) && Math.abs(hx - tx) + Math.abs(hy - ty) <= 2
        })
        r.line.push({ s, hits: near.slice(0, 2).sort((p, q) => p - q), better: c.line })
      }
      continue
    }
    if (c.adjacent.length) {
      if (!c.adjacent.includes(s.cell)) r.hunt.push({ s, hit: live[0], better: c.adjacent })
      continue
    }
    if (live.length) continue
    const heat = heatMap(s.board, id)
    if (heat[s.cell] === 0) {
      const sunk = new Set((w?.sunk ?? []).map((q) => q.id))
      const minSize = Math.min(...SHIPS.filter((d) => !sunk.has(d.id)).map((d) => d.size))
      r.waste.push({ s, hole: hole(s.board, id, s.cell), minSize })
    }
  }
  return r
}

const pct = (hits: number, shots: number) => (shots ? Math.round((100 * hits) / shots) : 0)

/** Meilleure série de touchés consécutifs de `who` (cases). */
function bestRun(log: SoloLog, who: Side, boards: BnBoard[], final: BnBoard): number[] {
  const id = who === 'me' ? log.me : log.bot
  const target = id === final.a ? final.b : final.a
  const res = new Map((final.waters[target]?.shots ?? []).map((s) => [cellIndex(s.x, s.y), s.r]))
  let best: number[] = []
  let cur: number[] = []
  for (const s of shotsOf(log, who, boards)) {
    if (res.get(s.cell) !== 'miss') {
      cur.push(s.cell)
      if (cur.length > best.length) best = [...cur]
    } else cur = []
  }
  return best
}

function findMoments(log: SoloLog, loser: Side): Moment[] {
  if (!log.x0) return []
  const xs = replayAll(local, log)
  const boards = xs.map((x) => x.state.board as BnBoard)
  const end = boards.length - 1
  const final = boards[end]
  const out: Moment[] = []
  const meStats = final.stats[log.me] ?? { shots: 0, hits: 0, best: 0 }
  const botStats = final.stats[log.bot] ?? { shots: 0, hits: 0, best: 0 }
  const manque = FLEET_CELLS - hitsBy(final, log.me)
  const common = { manque, precision_moi: pct(meStats.hits, meStats.shots), precision_bot: pct(botStats.hits, botStats.shots), serie: meStats.best ?? 0 }

  if (loser === 'bot') {
    const sc = scan(log, 'me', boards)
    const run = bestRun(log, 'me', boards, final)
    const p = common.precision_moi
    out.push({ type: 'radar', weight: p >= 90 ? 95 : 60, vars: common, steps: [{ ply: end, marks: [{ kind: 'zone', cells: run }] }] })
    if (!sc.line.length && !sc.hunt.length && !sc.waste.length) out.push({ type: 'suivi', weight: 75, vars: common, steps: [{ ply: end, marks: [] }] })
    out.push({ type: 'course', weight: 10, vars: common, steps: [] })
    return out
  }

  const sc = scan(log, 'me', boards)
  if (sc.line.length) {
    const { s, hits, better } = sc.line[0]
    out.push({
      type: 'ligne_pas_suivie',
      weight: 80,
      vars: { ...common, coup: nth(s.k, 'tir'), case_a: name(hits[0] ?? better[0]), case_b: name(hits[1] ?? hits[0] ?? better[0]), case_jouee: name(s.cell), case: name(better[0]), nb: sc.line.length },
      steps: [
        { ply: s.i + 1, marks: [{ kind: 'threat', cells: hits }, { kind: 'played', cells: [s.cell] }] },
        { ply: s.i, marks: [{ kind: 'threat', cells: hits }, { kind: 'better', cells: better }] },
      ],
    })
  }
  if (sc.hunt.length) {
    const { s, hit, better } = sc.hunt[0]
    out.push({
      type: 'chasse_abandonnee',
      weight: 75,
      vars: { ...common, coup: nth(s.k, 'tir'), case_a: name(hit), case_jouee: name(s.cell), case: name(better[0]), nb: sc.hunt.length },
      steps: [
        { ply: s.i + 1, marks: [{ kind: 'threat', cells: [hit] }, { kind: 'played', cells: [s.cell] }] },
        { ply: s.i, marks: [{ kind: 'threat', cells: [hit] }, { kind: 'better', cells: better }] },
      ],
    })
  }
  if (sc.waste.length >= 2) {
    const { s, hole: h, minSize } = sc.waste[0]
    out.push({
      type: 'tir_gaspille',
      weight: 70,
      vars: { ...common, coup: nth(s.k, 'tir'), case_jouee: name(s.cell), taille: minSize, nb: sc.waste.length },
      steps: [{ ply: s.i + 1, marks: [{ kind: 'zone', cells: h }, { kind: 'played', cells: [s.cell] }] }],
    })
  }

  const myFleet = (final.reveal?.[log.me] ?? (xs[0].secrets[log.me] as { fleet?: BnShip[] } | undefined)?.fleet ?? []) as BnShip[]
  const fleetCells = myFleet.flatMap((s) => (shipCells(s) ?? []).map(([x, y]) => cellIndex(x, y)))
  const ctx = log.ctx as Partial<BnLogCtx> | undefined
  if (ctx?.b1 && Array.isArray(ctx.cells) && ctx.cells.length && fleetCells.length) {
    const usual = new Set(ctx.cells)
    const onUsual = fleetCells.filter((c) => usual.has(c)).length / fleetCells.length
    const first10 = shotsOf(log, 'bot', boards).slice(0, 10)
    const resMe = new Map((final.waters[log.me]?.shots ?? []).map((q) => [cellIndex(q.x, q.y), q.r]))
    const nb = first10.filter((q) => resMe.get(q.cell) !== 'miss').length
    if (onUsual >= 0.5 && nb >= 4) {
      out.push({
        type: 'flotte_previsible',
        weight: 85,
        vars: { ...common, nb },
        steps: [{ ply: Math.min(end, (first10.at(-1)?.i ?? end - 1) + 1), marks: [{ kind: 'zone', cells: ctx.cells.map((c) => c + OWN) }] }],
      })
    }
  }

  const glued = gluedCells(myFleet)
  if (glued.length && (botStats.best ?? 0) >= 6) {
    out.push({ type: 'bateaux_colles', weight: 50, vars: { ...common, nb: botStats.best ?? 0 }, steps: [{ ply: end, marks: [{ kind: 'zone', cells: glued.map((c) => c + OWN) }] }] })
  }

  out.push({ type: 'course', weight: 10, vars: common, steps: [] })
  return out
}

const JOUABLE = ' Sans ça, c’était jouable !'

const LOSS: Record<string, { lines: string[]; tip: string }> = {
  ligne_pas_suivie: {
    lines: ['Tu avais deux touchés alignés, {case_a} et {case_b}, et tu as tiré en {case_jouee}.', 'Mon bateau continuait dans la même ligne : {case} était le bon tir.'],
    tip: 'Deux touchés alignés ? Continue tout droit jusqu’à « coulé ».',
  },
  chasse_abandonnee: {
    lines: ['Tu m’as touché{e} en {case_a}, puis tu as tiré ailleurs. Mon bateau a eu le temps de souffler !', 'Le reste du bateau était forcément juste à côté. Ça t’est arrivé {nb} fois.'],
    tip: 'Touché ? Tire autour (haut, bas, gauche, droite) jusqu’à « coulé ».',
  },
  tir_gaspille: {
    lines: ['Ton tir en {case_jouee} ne pouvait rien toucher : mon plus petit bateau restant fait {taille} cases.', '{nb} de tes tirs sont tombés dans des trous trop petits pour mes bateaux.'],
    tip: 'Regarde quels bateaux il me reste : inutile de tirer dans un trou plus petit qu’eux.',
  },
  flotte_previsible: {
    lines: ['Tes bateaux étaient presque au même endroit que les dernières fois : je suis allé{e} droit dessus !', '{nb} de mes 10 premiers tirs ont touché. Je connais tes cachettes !'],
    tip: 'Change de cachettes à chaque partie… ou appuie sur Mélanger 🎲.',
  },
  bateaux_colles: {
    lines: ['Tes bateaux se touchaient : en coulant l’un, je suis tombé{e} sur son voisin.'],
    tip: 'Laisse au moins une case d’eau entre tes bateaux.',
  },
  course: {
    lines: ['C’était serré : il te manquait {manque} touché(s).', 'J’ai réussi {precision_bot} % de mes tirs, toi {precision_moi} %.'],
    tip: 'Pour chercher, tire en damier (une case sur deux) : aucun bateau ne passe entre.',
  },
}

const WIN: Record<string, string> = {
  radar: '{precision_moi} % de tirs réussis, dont {serie} touchés d’affilée : un vrai radar !',
  suivi: 'Aucun tir perdu : tu as suivi chaque bateau jusqu’au bout.',
  course: 'Bien joué : tu as été plus solide que moi du début à la fin.',
}

function texts(m: Moment, loser: Side): WhyText {
  if (loser === 'bot') return { lines: [fill(WIN[m.type] ?? WIN.course, m.vars)] }
  const t = LOSS[m.type] ?? LOSS.course
  const lines = t.lines.map((s) => fill(s, m.vars))
  const nb = Number(m.vars.nb ?? 0)
  const manque = Number(m.vars.manque ?? 99)
  if (['ligne_pas_suivie', 'chasse_abandonnee', 'tir_gaspille'].includes(m.type) && nb >= manque && manque > 0) {
    const i = lines.length - 1
    lines[i] = lines[i] + JOUABLE
  }
  return { lines, tip: t.tip }
}

export const why: GameWhy = { findMoments, texts }
