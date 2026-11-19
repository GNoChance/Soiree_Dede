import { useEffect, useState } from 'react'
import { serverNow } from '@/features/soiree/useServerClock'
import type { PlayerInfo } from '../types'
import { CELLS, CELL_INFO } from './board'
import { dedeLine } from './dede-lines'
import { MOVE_SEG_MS, type DedePartyState, type DpEvent, type DpMove, type DpSnap } from './types'

/** Délai avant le premier pion, apparition du dé, durée d'une case (en ms). */
const LEAD_MS = 500
const DICE_MS = 900
const STEP_MS = 330
const CARD_STEP_MS = 260

export interface BoardView {
  /** Plateau affiché (instantané pendant l'animation, state sinon). */
  snap: DpSnap
  /** Pion en vedette pendant les déplacements. */
  mover: { id: string; cell: number; dice: number[]; walking: boolean; idx: number; move: DpMove } | null
  /** Évènements déjà « joués » du pion en vedette (le dernier en premier). */
  events: DpEvent[]
  /** Tous les pions ont fini. */
  done: boolean
}

const fromState = (s: DedePartyState): DpSnap => ({ pos: s.pos, coins: s.coins, stars: s.stars, star_cell: s.star_cell, dist: s.dist })

/** Durée de marche d'un déplacement (après le dé). */
const walkMs = (m: DpMove) => m.steps.reduce((t, st) => t + (st.card ? CARD_STEP_MS : STEP_MS), 0)

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
  const t = elapsed - i * MOVE_SEG_MS - DICE_MS
  // Combien de cases déjà franchies ?
  let k = 0
  let acc = 0
  for (const st of move.steps) {
    acc += st.card ? CARD_STEP_MS : STEP_MS
    if (t >= acc) k++
    else break
  }
  const walking = t < walkMs(move) + 150
  const cell = k === 0 ? move.from : move.steps[k - 1].cell
  const events = move.steps
    .slice(0, k)
    .flatMap((st) => st.ev)
    .reverse()
  return {
    snap: walking ? base : move.after,
    mover: { id: move.id, cell: walking ? cell : (move.after.pos[move.id] ?? cell), dice: move.dice, walking, idx: i, move },
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
  if (p.slug === 'dede' && m.walking && !view.events.length) return dedeLine('self', key)
  if (m.walking && !view.events.length) return `${p.nickname} avance de ${m.dice.reduce((a, b) => a + b, 0)} case${m.dice.reduce((a, b) => a + b, 0) > 1 ? 's' : ''}…`
  const all = m.move.steps.flatMap((st) => st.ev)
  const seen = m.walking ? view.events : all
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
