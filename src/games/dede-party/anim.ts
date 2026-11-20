import { useEffect, useState } from 'react'
import { serverNow } from '@/features/soiree/useServerClock'
import type { PlayerInfo } from '../types'
import { boardOf, CELL_INFO, isJump, type BoardDef } from './board'
import { dedeLine, type LineKind } from './dede-lines'
import {
  EPI_MS,
  MOVE_SEG_MS,
  RITON_DIE_MS,
  RITON_STEP_MS,
  WASH_AT_MS,
  type DedePartyState,
  type DpEpi,
  type DpEvent,
  type DpMech,
  type DpMove,
  type DpSnap,
} from './types'

/** Délai avant le premier pion, durée du lancer de dés à l'écran (ms). */
export const LEAD_MS = 500
export const DICE_MS = 1000
/** Budget de marche d'un pion : la durée d'un saut s'adapte au nombre de cases (2 à 24). */
const WALK_BUDGET_MS = 3300
const STEP_MAX_MS = 300
const STEP_MIN_MS = 130

/** Durée d'un saut de case pour ce déplacement. */
export const stepMs = (m: DpMove) => Math.min(STEP_MAX_MS, Math.max(STEP_MIN_MS, WALK_BUDGET_MS / Math.max(1, m.steps.length)))

/** Saut spécial en cours : télésiège, verglas (étape `tp`) ou Grande Luge (liaison `jumps`). */
export type Leap = 'lift' | 'ice' | 'luge'

export interface Mover {
  id: string
  /** Dernière case où le pion s'est posé. */
  cell: number
  /** Case vers laquelle il saute en ce moment (null : posé), et avancement du saut (0 → 1). */
  next: number | null
  frac: number
  /** Le saut en cours est un grand saut (télésiège, verglas, luge) : en grande cloche. */
  leap: Leap | null
  /** Nombre de cases déjà franchies. */
  hops: number
  dice: number[]
  /** Les dés roulent encore (avant le premier saut). */
  rolling: boolean
  walking: boolean
  idx: number
  /** Temps écoulé depuis le début de la séquence de ce pion (ms). */
  t: number
  move: DpMove
}

/** Épilogue du tour en cours d'animation (marée, ronde de Riton). */
export interface EpiView {
  data: DpEpi
  /** Temps écoulé depuis le début de l'épilogue (ms, 0 → EPI_MS). */
  t: number
  /** Riton : nombre de cases déjà parcourues ; saut en cours (case de départ, d'arrivée, avancement). */
  step: number
  hop: { from: number; to: number; frac: number } | null
  /** Évènements déjà « joués » (le dernier en premier) : croisements de Riton, pions emportés (`wash`). */
  events: DpEvent[]
}

export interface BoardView {
  /** Plateau de la partie. */
  board: BoardDef
  /** Plateau affiché (instantané pendant l'animation, state sinon) ; étoiles, aiguillages et mécanique suivent en direct. */
  snap: DpSnap
  /** Pion en vedette pendant les déplacements. */
  mover: Mover | null
  /** Évènements déjà « joués » du pion en vedette (le dernier en premier). */
  events: DpEvent[]
  /** Épilogue du tour (après le dernier pion), sinon null. */
  epi: EpiView | null
  /** Tous les pions (et l'épilogue) ont fini. */
  done: boolean
}

const fromState = (s: DedePartyState): DpSnap => ({ pos: s.pos, coins: s.coins, stars: s.stars, star_cells: s.star_cells ?? [], sw: s.sw ?? [], dist: s.dist, mech: s.mech ?? {} })

/** Ce que montre l'épilogue à l'instant `t` (ms depuis son début). */
function epiAt(epi: DpEpi, base: DpSnap, t: number): { snap: DpSnap; view: EpiView } {
  if (epi.t === 'tide') {
    const washed = t >= WASH_AT_MS
    const events: DpEvent[] = washed ? epi.washed.map((w) => ({ t: 'wash' as const, id: w.id, d: w.d, from: w.from })).reverse() : []
    return { snap: washed ? epi.after : base, view: { data: epi, t, step: 0, hop: null, events } }
  }
  const walk = (t - RITON_DIE_MS) / RITON_STEP_MS
  const step = t < RITON_DIE_MS ? 0 : Math.max(0, Math.min(epi.path.length, Math.floor(walk)))
  const cell = step === 0 ? epi.from : epi.path[step - 1]
  const hop = t >= RITON_DIE_MS && step < epi.path.length ? { from: cell, to: epi.path[step], frac: Math.max(0, Math.min(1, walk - step)) } : null
  const coins = { ...base.coins }
  let sack = base.mech?.sack ?? 0
  const events: DpEvent[] = []
  for (const h of epi.hits) {
    const at = epi.path.indexOf(h.cell)
    if (at < 0 || at >= step) continue
    coins[h.id] = Math.max(0, (coins[h.id] ?? 0) + h.d)
    sack = h.sack
    events.unshift({ t: 'riton', id: h.id, k: h.k, d: h.d, sack: h.sack, cell: h.cell })
  }
  const mech: DpMech = { ...(base.mech ?? {}), riton: cell, sack }
  return { snap: { ...base, coins, mech }, view: { data: epi, t, step, hop, events } }
}

/** Ce que montre le plateau à l'instant `now` (ms, horloge serveur). */
export function boardViewAt(s: DedePartyState, now: number): BoardView {
  const board = boardOf(s.map)
  if (s.phase !== 'move' || !s.moves?.length || !s.moves_at || !s.before) {
    return { board, snap: fromState(s), mover: null, events: [], epi: null, done: true }
  }
  const elapsed = now - new Date(s.moves_at).getTime() - LEAD_MS
  const i = Math.floor(elapsed / MOVE_SEG_MS)
  if (elapsed < 0) return { board, snap: s.before, mover: null, events: [], epi: null, done: false }
  if (i >= s.moves.length) {
    const last = s.moves[s.moves.length - 1].after
    const et = elapsed - s.moves.length * MOVE_SEG_MS
    if (s.epi && et < EPI_MS) {
      const { snap, view } = epiAt(s.epi, last, et)
      return { board, snap, mover: null, events: [], epi: view, done: false }
    }
    return { board, snap: fromState(s), mover: null, events: [], epi: null, done: true }
  }
  const move = s.moves[i]
  const base = i === 0 ? s.before : s.moves[i - 1].after
  const segT = elapsed - i * MOVE_SEG_MS
  const dur = stepMs(move)
  const n = move.steps.length
  const p = (segT - DICE_MS) / dur
  // Un saut « atterrit » à 85 % de sa durée : le reste est l'écrasement à l'arrivée.
  const hops = Math.max(0, Math.min(n, Math.floor(p + 0.15)))
  const walking = segT < DICE_MS + n * dur + 150
  const cell = hops === 0 ? move.from : move.steps[hops - 1].cell
  const inHop = p >= 0 && hops < n
  const events = move.steps
    .slice(0, hops)
    .flatMap((st) => st.ev)
    .reverse()
  // Étoiles, aiguillages et mécanique en direct : ils changent dès que le pion est passé.
  let snap: DpSnap = move.after
  if (walking) {
    const sw = [...(base.sw ?? [])]
    let stars = base.star_cells
    const mech: DpMech = { ...(base.mech ?? {}) }
    for (let k = events.length - 1; k >= 0; k--) {
      const e = events[k]
      if (e.t === 'fork' && typeof e.fork === 'number' && !e.tide) sw[e.fork] = 1 - (e.way ?? 0)
      if (e.stars) stars = e.stars
      if ((e.t === 'toll' || e.t === 'jackpot') && typeof e.pot === 'number') mech.pot = e.pot
      if (e.t === 'riton' && typeof e.sack === 'number') mech.sack = e.sack
    }
    snap = { ...base, sw, star_cells: stars, mech }
  }
  let leap: Leap | null = null
  if (walking && inHop) {
    const st = move.steps[hops]
    leap = st.tp ?? (isJump(board, cell, st.cell) ? 'luge' : null)
  }
  return {
    board,
    snap,
    mover: {
      id: move.id,
      cell: walking ? cell : (move.after.pos[move.id] ?? cell),
      next: walking && inHop ? move.steps[hops].cell : null,
      frac: inHop ? Math.max(0, Math.min(1, (p - hops) / 0.85)) : 0,
      leap,
      hops,
      dice: move.dice,
      rolling: segT < DICE_MS,
      walking,
      idx: i,
      t: segT,
      move,
    },
    events,
    epi: null,
    done: false,
  }
}

/** Vue du plateau rafraîchie ~10 fois par seconde pendant les déplacements. */
export function useBoardView(s: DedePartyState): BoardView {
  const [now, setNow] = useState(() => serverNow())
  const animating = s.phase === 'move'
  useEffect(() => {
    if (!animating) return
    const id = window.setInterval(() => setNow(serverNow()), 90)
    return () => clearInterval(id)
  }, [animating])
  return boardViewAt(s, animating ? now : serverNow())
}

/** « +3 » / « −3 » (vrai signe moins). */
export const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0')

/** Nom de la voie prise à un embranchement. */
export const forkWay = (b: BoardDef, e: DpEvent) => {
  const f = b.forks[e.fork ?? 0] ?? b.forks[0]
  const w = e.way === 1 ? 1 : 0
  return { name: f?.names[w] ?? '', emoji: f?.emojis[w] ?? '🔀', detour: w === 1, fork: e.fork ?? 0, tide: Boolean(e.tide) }
}

/** Petite étiquette d'un évènement (bulle au-dessus du pion, fil du tour). */
export function eventLabel(e: DpEvent, name: (id: string) => string, b: BoardDef = boardOf()): string {
  switch (e.t) {
    case 'start':
      return `🎬 Départ : ${signed(e.d ?? 5)} 🪙`
    case 'clap':
      return `👏 Bravo : ${signed(e.d ?? 3)} 🪙`
    case 'pub':
      return e.d ? `📺 Page de pub : ${signed(e.d)} 🪙` : '📺 Page de pub (déjà à sec)'
    case 'star':
      return `⭐ Étoile achetée (${e.cost} 🪙) !`
    case 'star_poor':
      return `⭐ Il faut ${e.need} 🪙…`
    case 'fork': {
      const w = forkWay(b, e)
      if (w.tide) return w.detour ? '🏝️ Banc de sable !' : '🌊 Marée haute : par la Digue'
      return w.detour ? `🔀 Aiguillage : ${w.emoji} ${w.name} !` : '🔀 Aiguillage : tout droit !'
    }
    case 'toll':
      return e.d ? `🎟️ Tombola : ${signed(e.d)} 🪙 (cagnotte ${e.pot})` : '🎟️ Tombola : offert !'
    case 'jackpot':
      return `🎟️ GROS LOT : ${signed(e.d ?? 0)} 🪙 !`
    case 'riton':
      return e.k === 'drop' ? `🦝 Riton lâche son sac : ${signed(e.d ?? 0)} 🪙 !` : e.k === 'steal' ? `🦝 Riton chipe ${-(e.d ?? 0)} 🪙 !` : '🦝 Rien à piquer…'
    case 'tp':
      return e.k === 'ice' ? '🧊 Glissade !' : '🚡 Télésiège !'
    case 'wash':
      return `🌊 Emporté par la vague : ${signed(e.d ?? 0)} 🪙`
    case 'card': {
      let extra = ''
      if (e.card === 'swap_lead') extra = e.none ? ' (personne devant)' : ` ↔ ${name(e.with ?? '')}`
      if (e.card === 'steal3') extra = e.none ? ' (personne à voler)' : ` (${e.d} 🪙 de ${name(String(e.from ?? ''))})`
      if (e.card === 'charity') extra = ` (${e.d} 🪙 pour ${name(e.to as string)})`
      if (e.card === 'reroll') extra = ` (🎲 ${e.die})`
      return `✉️ ${e.text ?? ''}${extra}`
    }
  }
}

/** Réplique de Dédé pendant le lancer (Dédé-sur-Mer : alerte quand la mer monte à la fin du tour). */
export function rollLine(s: DedePartyState): string {
  const key = String(s.round)
  if (s.round === s.rounds) return dedeLine('finale', key)
  if (s.map === 'mer' && s.mech?.tide === 0 && s.mech.tide_in === 1) return dedeLine('tide_warn', key)
  return dedeLine('roll', key)
}

const names = (ids: string[], get: (id: string) => PlayerInfo) => ids.map((id) => get(id).nickname).join(' et ')

/** Réplique de Dédé pendant (et après) l'épilogue du tour. */
export function epiLine(s: DedePartyState, epi: DpEpi, events: DpEvent[], get: (id: string) => PlayerInfo): string {
  const key = `${s.round}:epi`
  if (epi.t === 'tide') {
    if (epi.tide === 0) return dedeLine('tide_down', key)
    if (!epi.washed.length) return dedeLine('tide_up', key)
    return epi.washed.length > 1 ? dedeLine('tide_wash_many', key, names(epi.washed.map((w) => w.id), get)) : dedeLine('tide_wash', key, get(epi.washed[0].id).nickname)
  }
  const last = events.find((e) => e.t === 'riton')
  if (!last) return dedeLine('riton_move', key)
  const kind: LineKind = last.k === 'drop' ? 'riton_drop' : last.k === 'steal' ? 'riton_steal' : 'riton_none'
  return dedeLine(kind, `${key}:${last.id}:${last.cell}`, get(last.id ?? '').nickname, Math.abs(last.d ?? 0))
}

/** Réplique de Dédé pour le pion en vedette (ou la phase). */
export function moverLine(s: DedePartyState, view: BoardView, get: (id: string) => PlayerInfo): string {
  const b = view.board
  const m = view.mover
  if (!m) {
    if (view.epi) return epiLine(s, view.epi.data, view.epi.events, get)
    if (view.done && s.epi) {
      const ev = s.epi.t === 'riton' ? s.epi.hits.map((h): DpEvent => ({ t: 'riton', ...h })).reverse() : []
      return epiLine(s, s.epi, ev, get)
    }
    return dedeLine('roll', `${s.round}`)
  }
  const p = get(m.id)
  const key = `${s.round}:${m.id}`
  const total = m.dice.reduce((a, b) => a + b, 0)
  if (p.slug === 'dede' && m.walking && !view.events.length) return dedeLine('self', key)
  if (m.walking && !view.events.length) return `${p.nickname} avance de ${total} case${total > 1 ? 's' : ''}…`
  const all = m.move.steps.flatMap((st) => st.ev)
  const seen = m.walking ? view.events : all
  // En marche : on commente le dernier évènement vu (l'aiguillage a son moment de gloire).
  const last = m.walking ? view.events[0] : undefined
  if (last?.t === 'fork') {
    const w = forkWay(b, last)
    if (w.tide) return dedeLine(w.detour ? 'fork_banc' : 'fork_banc_no', key, p.nickname)
    return dedeLine(w.fork === 0 ? (w.detour ? 'fork_scene' : 'fork_scene_no') : w.detour ? 'fork_tunnel' : 'fork_tunnel_no', key, p.nickname)
  }
  // Priorité : gros lot > étoile > Riton > télésiège / verglas > Grande Luge > aiguillage > le reste.
  const jackpot = seen.find((e) => e.t === 'jackpot')
  if (jackpot) return dedeLine('jackpot', key, p.nickname, jackpot.d)
  const star = seen.find((e) => e.t === 'star')
  if (star) return dedeLine(star.exact ? 'star_exact' : 'star', key, p.nickname)
  const riton = seen.find((e) => e.t === 'riton')
  if (riton) return dedeLine(riton.k === 'drop' ? 'riton_drop' : riton.k === 'steal' ? 'riton_steal' : 'riton_none', key, p.nickname, Math.abs(riton.d ?? 0))
  const tp = seen.find((e) => e.t === 'tp')
  if (tp) return dedeLine(tp.k === 'ice' ? 'ice' : 'lift', key, p.nickname)
  const seenSteps = m.walking ? m.move.steps.slice(0, m.hops) : m.move.steps
  if (seenSteps.some((st, k) => isJump(b, k === 0 ? m.move.from : seenSteps[k - 1].cell, st.cell))) return dedeLine('luge', key, p.nickname)
  const fork = seen.find((e) => e.t === 'fork')
  if (fork?.tide) return dedeLine(forkWay(b, fork).detour ? 'fork_banc' : 'fork_banc_no', key, p.nickname)
  const card = seen.find((e) => e.t === 'card')
  if (card) return dedeLine((card.gain ?? 0) > 0 || ['half_price', 'gift_double', 'fwd3', 'reroll'].includes(card.card ?? '') ? 'card_good' : (card.gain ?? 0) < 0 || card.card === 'back3' ? 'card_bad' : 'card', key, p.nickname)
  const toll = seen.find((e) => e.t === 'toll')
  if (toll) return dedeLine(toll.d ? 'toll' : 'toll_poor', key, p.nickname, -(toll.d ?? 0))
  if (seen.some((e) => e.t === 'pub')) return dedeLine('pub', key, p.nickname)
  if (seen.some((e) => e.t === 'star_poor')) return dedeLine('star_poor', key, p.nickname)
  if (seen.some((e) => e.t === 'clap')) return dedeLine('clap', key, p.nickname)
  if (seen.some((e) => e.t === 'start')) return dedeLine('start', key, p.nickname)
  return dedeLine('nothing', key, p.nickname)
}

/** Nom d'une case (nom propre s'il y en a un, sinon son type). */
export const cellLabel = (b: BoardDef, cell: number) => b.cellNames?.[cell] ?? CELL_INFO[b.cells[cell]].label

/** Texte de la puce de mécanique (à côté du tour en cours) ; null : pas de puce sur ce plateau. */
export function mechChip(b: BoardDef, mech: DpMech | undefined): { text: string; alert?: boolean } | null {
  const m = mech ?? {}
  if (b.id === 'mer') {
    if (m.tide === 1) return { text: '🌊 Marée haute · elle redescend à la fin de ce tour' }
    if ((m.tide_in ?? 2) <= 1) return { text: '⚠️ La mer monte à la fin de ce tour !', alert: true }
    return { text: `🌊 Marée basse · elle monte dans ${m.tide_in} tours` }
  }
  if (b.id === 'kermesse') return { text: `🎟️ Cagnotte : ${m.pot ?? 5} 🪙` }
  if (b.id === 'camping') return (m.sack ?? 0) > 0 ? { text: `🦝 Riton : sac plein (${m.sack} 🪙) — le prochain qui le croise ramasse tout !` } : { text: '🦝 Riton : sac vide — gare à tes pièces !' }
  return null
}
