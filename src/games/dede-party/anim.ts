import { useEffect, useState } from 'react'
import { serverNow } from '@/features/soiree/useServerClock'
import type { PlayerInfo } from '../types'
import { CELLS, CELL_INFO, FORKS } from './board'
import { dedeLine } from './dede-lines'
import { MOVE_SEG_MS, type DedePartyState, type DpEvent, type DpMove, type DpSnap } from './types'

/** Délai avant le premier pion, durée du lancer de dés à l'écran (ms). */
export const LEAD_MS = 500
export const DICE_MS = 1000
/** Budget de marche d'un pion : la durée d'un saut s'adapte au nombre de cases (2 à 24). */
const WALK_BUDGET_MS = 3300
const STEP_MAX_MS = 300
const STEP_MIN_MS = 130

/** Durée d'un saut de case pour ce déplacement. */
export const stepMs = (m: DpMove) => Math.min(STEP_MAX_MS, Math.max(STEP_MIN_MS, WALK_BUDGET_MS / Math.max(1, m.steps.length)))

export interface Mover {
  id: string
  /** Dernière case où le pion s'est posé. */
  cell: number
  /** Case vers laquelle il saute en ce moment (null : posé), et avancement du saut (0 → 1). */
  next: number | null
  frac: number
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

export interface BoardView {
  /** Plateau affiché (instantané pendant l'animation, state sinon) ; étoiles et aiguillages suivent le pion en direct. */
  snap: DpSnap
  /** Pion en vedette pendant les déplacements. */
  mover: Mover | null
  /** Évènements déjà « joués » du pion en vedette (le dernier en premier). */
  events: DpEvent[]
  /** Tous les pions ont fini. */
  done: boolean
}

const fromState = (s: DedePartyState): DpSnap => ({ pos: s.pos, coins: s.coins, stars: s.stars, star_cells: s.star_cells ?? [], sw: s.sw ?? [0, 0], dist: s.dist })

/** Ce que montre le plateau à l'instant `now` (ms, horloge serveur). */
export function boardViewAt(s: DedePartyState, now: number): BoardView {
  if (s.phase !== 'move' || !s.moves?.length || !s.moves_at || !s.before) {
    return { snap: fromState(s), mover: null, events: [], done: true }
  }
  const elapsed = now - new Date(s.moves_at).getTime() - LEAD_MS
  const i = Math.floor(elapsed / MOVE_SEG_MS)
  if (elapsed < 0) return { snap: s.before, mover: null, events: [], done: false }
  if (i >= s.moves.length) return { snap: s.moves[s.moves.length - 1].after, mover: null, events: [], done: true }
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
  // Étoiles et aiguillages en direct : ils changent dès que le pion est passé.
  let snap: DpSnap = move.after
  if (walking) {
    const sw = [...(base.sw ?? [0, 0])]
    let stars = base.star_cells
    for (let k = events.length - 1; k >= 0; k--) {
      const e = events[k]
      if (e.t === 'fork' && typeof e.fork === 'number') sw[e.fork] = 1 - (e.way ?? 0)
      if (e.stars) stars = e.stars
    }
    snap = { ...base, sw, star_cells: stars }
  }
  return {
    snap,
    mover: {
      id: move.id,
      cell: walking ? cell : (move.after.pos[move.id] ?? cell),
      next: walking && inHop ? move.steps[hops].cell : null,
      frac: inHop ? Math.max(0, Math.min(1, (p - hops) / 0.85)) : 0,
      hops,
      dice: move.dice,
      rolling: segT < DICE_MS,
      walking,
      idx: i,
      t: segT,
      move,
    },
    events,
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
export const forkWay = (e: DpEvent) => {
  const f = FORKS[e.fork ?? 0] ?? FORKS[0]
  const w = e.way === 1 ? 1 : 0
  return { name: f.names[w], emoji: f.emojis[w], detour: w === 1, fork: e.fork ?? 0 }
}

/** Petite étiquette d'un évènement (bulle au-dessus du pion, fil du tour). */
export function eventLabel(e: DpEvent, name: (id: string) => string): string {
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
      const w = forkWay(e)
      return w.detour ? `🔀 Aiguillage : ${w.emoji} ${w.name} !` : '🔀 Aiguillage : tout droit !'
    }
    case 'card': {
      let extra = ''
      if (e.card === 'swap_lead') extra = e.none ? ' (personne devant)' : ` ↔ ${name(e.with ?? '')}`
      if (e.card === 'steal3') extra = e.none ? ' (personne à voler)' : ` (${e.d} 🪙 de ${name(e.from ?? '')})`
      if (e.card === 'charity') extra = ` (${e.d} 🪙 pour ${name(e.to as string)})`
      if (e.card === 'reroll') extra = ` (🎲 ${e.die})`
      return `✉️ ${e.text ?? ''}${extra}`
    }
  }
}

/** Réplique de Dédé pour le pion en vedette (ou la phase). */
export function moverLine(s: DedePartyState, view: BoardView, get: (id: string) => PlayerInfo): string {
  const m = view.mover
  if (!m) return dedeLine('roll', `${s.round}`)
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
    const w = forkWay(last)
    return dedeLine(w.fork === 0 ? (w.detour ? 'fork_scene' : 'fork_scene_no') : w.detour ? 'fork_tunnel' : 'fork_tunnel_no', key, p.nickname)
  }
  const star = seen.find((e) => e.t === 'star')
  if (star) return dedeLine(star.exact ? 'star_exact' : 'star', key, p.nickname)
  const card = seen.find((e) => e.t === 'card')
  if (card) return dedeLine((card.gain ?? 0) > 0 || ['half_price', 'gift_double', 'fwd3', 'reroll'].includes(card.card ?? '') ? 'card_good' : (card.gain ?? 0) < 0 || card.card === 'back3' ? 'card_bad' : 'card', key, p.nickname)
  if (seen.some((e) => e.t === 'pub')) return dedeLine('pub', key, p.nickname)
  if (seen.some((e) => e.t === 'star_poor')) return dedeLine('star_poor', key, p.nickname)
  if (seen.some((e) => e.t === 'clap')) return dedeLine('clap', key, p.nickname)
  if (seen.some((e) => e.t === 'start')) return dedeLine('start', key, p.nickname)
  return dedeLine('nothing', key, p.nickname)
}

export const cellLabel = (cell: number) => CELL_INFO[CELLS[cell]].label
