import { useEffect, useState } from 'react'
import { serverNow } from '@/features/soiree/useServerClock'
import type { PlayerInfo } from '../types'
import { boardOf, CELL_INFO, isJump, quarterOf, transportOf, type BoardDef, type TransportKind } from './board'
import { PACK } from './boards/camping'
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
  type DpRitonHit,
  type DpSnap,
} from './types'

/** Délai avant le premier pion, durée du lancer de dés à l'écran (ms). */
export const LEAD_MS = 500
export const DICE_MS = 1000
/** Budget de marche d'un pion : la durée d'un saut s'adapte au nombre de cases (2 à 24). */
const WALK_BUDGET_MS = 3300
const STEP_MAX_MS = 300
const STEP_MIN_MS = 115
/** Un transport (bac, télécabine, piste…) dure 3 sauts à l'écran (il compte pour 1 pas dans les règles). */
export const RIDE_UNITS = 3

/** Poids de chaque étape d'un déplacement (1 = un saut ; transport = RIDE_UNITS). */
export function stepWeights(b: BoardDef, m: DpMove): number[] {
  return m.steps.map((st, k) => (!st.tp && isJump(b, k === 0 ? m.from : m.steps[k - 1].cell, st.cell) ? RIDE_UNITS : 1))
}

/** Durée d'une unité (un saut) pour ce déplacement : clamp(3300 / (pas + 2 × transports), 115, 300) ms. */
export const stepMs = (m: DpMove, b?: BoardDef) => {
  const units = b ? stepWeights(b, m).reduce((a, w) => a + w, 0) : m.steps.length
  return Math.min(STEP_MAX_MS, Math.max(STEP_MIN_MS, WALK_BUDGET_MS / Math.max(1, units)))
}

/** Saut spécial en cours : télésiège, verglas (étape `tp`) ou transport (liaison `jumps` : luge, bac, cabine, piste). */
export type Leap = 'lift' | 'ice' | TransportKind

export interface Mover {
  id: string
  /** Dernière case où le pion s'est posé. */
  cell: number
  /** Case vers laquelle il saute en ce moment (null : posé), et avancement du saut (0 → 1). */
  next: number | null
  frac: number
  /** Le saut en cours est un grand saut (télésiège, verglas, transport) : en grande cloche ou à bord du véhicule. */
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

/** Un raton en train de trotter pendant l'épilogue (0 = Riton, 1… = la famille). */
export interface RatonWalk {
  who: number
  /** Nombre de cases déjà parcourues ; saut en cours. */
  step: number
  hop: { from: number; to: number; frac: number } | null
}

/** Épilogue du tour en cours d'animation (marée, ronde des ratons). */
export interface EpiView {
  data: DpEpi
  /** Temps écoulé depuis le début de l'épilogue (ms, 0 → EPI_MS). */
  t: number
  /** Riton : nombre de cases déjà parcourues ; saut en cours (case de départ, d'arrivée, avancement). */
  step: number
  hop: { from: number; to: number; frac: number } | null
  /** La famille Raton (grande taille), dans l'ordre de `mech.pack`. */
  packs: RatonWalk[]
  /** Évènements déjà « joués » (le dernier en premier) : croisements des ratons, pions emportés (`wash`). */
  events: DpEvent[]
}

export interface BoardView {
  /** Plateau de la partie (à sa taille). */
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

/** Nom d'un raton : 0 = Riton, 1… = la famille (Rita, Ritou). */
export const ratonName = (who = 0) => (who > 0 ? (PACK[who - 1]?.name ?? 'Riton') : 'Riton')

/** Ce que montre l'épilogue à l'instant `t` (ms depuis son début). */
function epiAt(epi: DpEpi, base: DpSnap, t: number): { snap: DpSnap; view: EpiView } {
  if (epi.t === 'tide') {
    const washed = t >= WASH_AT_MS
    const events: DpEvent[] = washed ? epi.washed.map((w) => ({ t: 'wash' as const, id: w.id, d: w.d, from: w.from, cell: w.to })).reverse() : []
    return { snap: washed ? epi.after : base, view: { data: epi, t, step: 0, hop: null, packs: [], events } }
  }
  // Riton et sa famille trottent en même temps : même dé à l'écran, même cadence.
  const walk = (t - RITON_DIE_MS) / RITON_STEP_MS
  const walker = (who: number, from: number, path: number[]): RatonWalk & { cell: number } => {
    const step = t < RITON_DIE_MS ? 0 : Math.max(0, Math.min(path.length, Math.floor(walk)))
    const cell = step === 0 ? from : path[step - 1]
    const hop = t >= RITON_DIE_MS && step < path.length ? { from: cell, to: path[step], frac: Math.max(0, Math.min(1, walk - step)) } : null
    return { who, step, hop, cell }
  }
  const riton = walker(0, epi.from, epi.path)
  const packs = (epi.pack ?? []).map((p) => walker(p.who, p.from, p.path))
  const coins = { ...base.coins }
  let sack = base.mech?.sack ?? 0
  const pack = (base.mech?.pack ?? []).map((x) => ({ ...x }))
  // Croisements déjà vus, dans l'ordre où ils arrivent (rang sur la ronde, puis Riton avant la famille).
  const seen: Array<{ at: number; who: number; h: DpRitonHit }> = []
  for (const h of epi.hits) {
    const at = epi.path.indexOf(h.cell)
    if (at >= 0 && at < riton.step) seen.push({ at, who: 0, h })
  }
  ;(epi.pack ?? []).forEach((p, k) => {
    for (const h of p.hits) {
      const at = p.path.indexOf(h.cell)
      if (at >= 0 && at < packs[k].step) seen.push({ at, who: p.who, h })
    }
  })
  seen.sort((a, b) => a.at - b.at || a.who - b.who)
  const events: DpEvent[] = []
  for (const { who, h } of seen) {
    coins[h.id] = Math.max(0, (coins[h.id] ?? 0) + h.d)
    if (who === 0) sack = h.sack
    else if (pack[who - 1]) pack[who - 1].sack = h.sack
    events.unshift({ t: 'riton', id: h.id, k: h.k, d: h.d, sack: h.sack, cell: h.cell, ...(who ? { who } : {}) })
  }
  packs.forEach((p, k) => {
    if (pack[k]) pack[k].c = p.cell
  })
  const mech: DpMech = { ...(base.mech ?? {}), riton: riton.cell, sack, ...(pack.length ? { pack } : {}) }
  return {
    snap: { ...base, coins, mech },
    view: { data: epi, t, step: riton.step, hop: riton.hop, packs: packs.map(({ who, step, hop }) => ({ who, step, hop })), events },
  }
}

/** Évènements d'une étape, avec le transport (front seulement : `ride`) en tête s'il y en a un. */
function stepEvents(b: BoardDef, m: DpMove, k: number): DpEvent[] {
  const st = m.steps[k]
  const from = k === 0 ? m.from : m.steps[k - 1].cell
  const ride = !st.tp ? transportOf(b, from, st.cell) : null
  return ride ? [{ t: 'ride', k: ride.kind, from, cell: st.cell, text: ride.name }, ...st.ev] : st.ev
}

/** Ce que montre le plateau à l'instant `now` (ms, horloge serveur). */
export function boardViewAt(s: DedePartyState, now: number): BoardView {
  const board = boardOf(s.map, s.size)
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
  const unit = stepMs(move, board)
  const weights = stepWeights(board, move)
  const n = move.steps.length
  // Avancement en unités ; un saut « atterrit » à 85 % de sa durée (le reste est l'écrasement à l'arrivée).
  const p = (segT - DICE_MS) / unit
  let hops = 0
  let start = 0
  for (let k = 0; k < n; k++) {
    if (p >= start + 0.85 * weights[k]) {
      hops = k + 1
      start += weights[k]
    } else break
  }
  const total = weights.reduce((a, w) => a + w, 0)
  const walking = segT < DICE_MS + total * unit + 150
  const cell = hops === 0 ? move.from : move.steps[hops - 1].cell
  // Début du saut en cours (en unités) : somme des poids des étapes déjà franchies.
  const hopStart = weights.slice(0, hops).reduce((a, w) => a + w, 0)
  const inHop = p >= 0 && hops < n
  const events = Array.from({ length: hops }, (_, k) => stepEvents(board, move, k))
    .flat()
    .reverse()
  // Étoiles, aiguillages et mécanique en direct : ils changent dès que le pion est passé.
  let snap: DpSnap = move.after
  if (walking) {
    const sw = [...(base.sw ?? [])]
    let stars = base.star_cells
    const mech: DpMech = { ...(base.mech ?? {}), pack: base.mech?.pack?.map((x) => ({ ...x })) }
    if (!mech.pack) delete mech.pack
    for (let k = events.length - 1; k >= 0; k--) {
      const e = events[k]
      if (e.t === 'fork' && typeof e.fork === 'number' && !e.tide) sw[e.fork] = 1 - (e.way ?? 0)
      if (e.stars) stars = e.stars
      if ((e.t === 'toll' || e.t === 'jackpot') && typeof e.pot === 'number') mech.pot = e.pot
      if (e.t === 'riton' && typeof e.sack === 'number') {
        if (e.who && mech.pack?.[e.who - 1]) mech.pack[e.who - 1].sack = e.sack
        else if (!e.who) mech.sack = e.sack
      }
    }
    snap = { ...base, sw, star_cells: stars, mech }
  }
  let leap: Leap | null = null
  if (walking && inHop) {
    const st = move.steps[hops]
    leap = st.tp ?? transportOf(board, cell, st.cell)?.kind ?? (isJump(board, cell, st.cell) ? 'luge' : null)
  }
  return {
    board,
    snap,
    mover: {
      id: move.id,
      cell: walking ? cell : (move.after.pos[move.id] ?? cell),
      next: walking && inHop ? move.steps[hops].cell : null,
      frac: inHop ? Math.max(0, Math.min(1, (p - hopStart) / (0.85 * weights[hops]))) : 0,
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

/** Embranchement d'un évènement `fork` : voie prise, son nom, l'habillage de la porte. */
export const forkWay = (b: BoardDef, e: DpEvent) => {
  const f = b.forks[e.fork ?? 0] ?? b.forks[0]
  const w = e.way === 1 ? 1 : 0
  const to = f?.ways[1] ?? -1
  return { name: f?.names[w] ?? '', zone: (f && quarterOf(b, to)?.name) || (f?.names[1] ?? ''), emoji: f?.emojis[w] ?? '🔀', detour: w === 1, fork: e.fork ?? 0, cell: f?.cell ?? -1, look: f?.look ?? 'switch', tide: Boolean(e.tide) }
}

const RIDE_EMOJI: Record<TransportKind, string> = { boat: '⛴️', cabin: '🚠', slide: '⛷️', luge: '🛷' }

/** Petite étiquette d'un évènement (bulle au-dessus du pion, fil du tour). */
export function eventLabel(e: DpEvent, name: (id: string) => string, b: BoardDef = boardOf()): string {
  switch (e.t) {
    case 'start':
      if (e.halt) return `🏁 Halte : ${signed(e.d ?? 5)} 🪙`
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
      if (w.tide) return w.detour ? `🏝️ ${w.name} !` : `🌊 Marée haute : ${w.name}`
      if (w.look === 'boat') return w.detour ? `⛴️ Le bac est à quai : ${w.zone} !` : '⛴️ Le bac est au large : on reste'
      if (w.look === 'cabin') return w.detour ? `🚠 ${w.name} !` : '🚠 Cabine partie : à pied !'
      if (w.look === 'piste') return w.detour ? `⛷️ ${w.name} : ouverte !` : '🧗 Par l’arête !'
      if (w.look === 'gate') return w.detour ? `🚧 Barrière levée : ${w.zone} !` : '🚧 Barrière baissée : le camp'
      if (w.look === 'turnstile') return w.detour ? `🎠 Tourniquet : ${w.zone} !` : '🎠 Tourniquet bloqué : tout droit'
      return w.detour ? `🔀 Aiguillage : ${w.emoji} ${w.name} !` : '🔀 Aiguillage : tout droit !'
    }
    case 'ride':
      return `${RIDE_EMOJI[(e.k as TransportKind) ?? 'luge'] ?? '🛷'} ${e.text ?? 'En route !'}`
    case 'toll':
      return e.d ? `🎟️ Tombola : ${signed(e.d)} 🪙 (cagnotte ${e.pot})` : '🎟️ Tombola : offert !'
    case 'jackpot':
      return `🎟️ GROS LOT : ${signed(e.d ?? 0)} 🪙 !`
    case 'riton': {
      const r = ratonName(e.who)
      return e.k === 'drop' ? `🦝 ${r} lâche son sac : ${signed(e.d ?? 0)} 🪙 !` : e.k === 'steal' ? `🦝 ${r} chipe ${-(e.d ?? 0)} 🪙 !` : '🦝 Rien à piquer…'
    }
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

/** Réplique du générique : le plateau du soir, ce que la taille ouvre (ou un teaser), les départs répartis. */
export function introLine(s: DedePartyState): string {
  const b = boardOf(s.map, s.size)
  const key = String(s.players.length)
  if (!s.map) return dedeLine('intro', key)
  if (b.size === 'l') return `${dedeLine(`open_${b.id}_l` as LineKind, key)} ${b.starts ? dedeLine('spread', b.id === 'ski' ? '1' : '0') : ''}`.trim()
  if (b.size === 'm') return dedeLine(`open_${b.id}_m` as LineKind, key)
  // Taille S : une partie sur deux, Dédé parle du quartier fermé.
  if (b.closed.length && s.order.join().length % 2 === 0) return dedeLine(`teaser_${b.id}` as LineKind, key)
  return dedeLine(`map_${b.id}` as LineKind, key)
}

const names = (ids: string[], get: (id: string) => PlayerInfo) => ids.map((id) => get(id).nickname).join(' et ')

/** Réplique de Dédé pendant (et après) l'épilogue du tour. */
export function epiLine(s: DedePartyState, epi: DpEpi, events: DpEvent[], get: (id: string) => PlayerInfo): string {
  const key = `${s.round}:epi`
  const big = Boolean(s.size && s.size !== 's')
  if (epi.t === 'tide') {
    if (epi.tide === 0) return dedeLine('tide_down', key)
    if (!epi.washed.length) return dedeLine('tide_up', key)
    if (epi.washed.length > 1) return big ? dedeLine('tide_up_many', key, '', epi.washed.length) : dedeLine('tide_wash_many', key, names(epi.washed.map((w) => w.id), get))
    const w = epi.washed[0]
    // Banc d'une île (au-delà du plateau classique) : les répliques des gués.
    return dedeLine(big && w.from >= 45 ? 'tide_wash_isle' : 'tide_wash', key, get(w.id).nickname)
  }
  const last = events.find((e) => e.t === 'riton')
  if (!last) return dedeLine(epi.pack?.length ? 'pack_move' : 'riton_move', key)
  const who = last.who ?? 0
  const kind: LineKind = who
    ? last.k === 'drop'
      ? 'pack_drop'
      : last.k === 'steal'
        ? 'pack_steal'
        : 'pack_none'
    : last.k === 'drop'
      ? 'riton_drop'
      : last.k === 'steal'
        ? 'riton_steal'
        : 'riton_none'
  return dedeLine(kind, `${key}:${last.id}:${last.cell}:${who}`, get(last.id ?? '').nickname, Math.abs(last.d ?? 0), ratonName(who))
}

/** Toutes les étapes vues du pion en vedette, avec leur liaison (case de départ → case d'arrivée). */
function seenLinks(m: Mover): Array<{ from: number; to: number; tp?: string }> {
  const steps = m.walking ? m.move.steps.slice(0, m.hops) : m.move.steps
  return steps.map((st, k) => ({ from: k === 0 ? m.move.from : steps[k - 1].cell, to: st.cell, tp: st.tp }))
}

/** Réplique de Dédé pour le pion en vedette (ou la phase). */
export function moverLine(s: DedePartyState, view: BoardView, get: (id: string) => PlayerInfo): string {
  const b = view.board
  const m = view.mover
  if (!m) {
    if (view.epi) return epiLine(s, view.epi.data, view.epi.events, get)
    if (view.done && s.epi) {
      const ev: DpEvent[] =
        s.epi.t === 'riton'
          ? [...s.epi.hits.map((h): DpEvent => ({ t: 'riton', ...h })), ...(s.epi.pack ?? []).flatMap((p) => p.hits.map((h): DpEvent => ({ t: 'riton', ...h, who: p.who })))].reverse()
          : []
      return epiLine(s, s.epi, ev, get)
    }
    return dedeLine('roll', `${s.round}`)
  }
  const p = get(m.id)
  const key = `${s.round}:${m.id}`
  const total = m.dice.reduce((a, x) => a + x, 0)
  if (p.slug === 'dede' && m.walking && !view.events.length) return dedeLine('self', key)
  if (m.walking && !view.events.length) return `${p.nickname} avance de ${total} case${total > 1 ? 's' : ''}…`
  const all = m.move.steps.flatMap((_, k) => stepEvents(b, m.move, k))
  const seen = m.walking ? view.events : all
  const zoneName = (cell: number) => quarterOf(b, cell)?.name ?? b.name
  // En marche : on commente le dernier évènement vu (la porte ou le transport a son moment de gloire).
  const last = m.walking ? view.events[0] : undefined
  if (last?.t === 'fork') return forkLine(b, last, key, p.nickname)
  if (last?.t === 'ride') return rideLine(b, last, key, p.nickname)
  // Priorité : gros lot > étoile > raton > Grande Descente > télésiège / verglas > transport > Halte > porte > le reste.
  const jackpot = seen.find((e) => e.t === 'jackpot')
  if (jackpot) return dedeLine('jackpot', key, p.nickname, jackpot.d)
  const star = seen.find((e) => e.t === 'star')
  if (star) return dedeLine(star.exact ? 'star_exact' : 'star', key, p.nickname)
  const riton = seen.find((e) => e.t === 'riton')
  if (riton) {
    const who = riton.who ?? 0
    const k = riton.k === 'drop' ? 'drop' : riton.k === 'steal' ? 'steal' : 'none'
    return dedeLine(`${who ? 'pack' : 'riton'}_${k}` as LineKind, key, p.nickname, Math.abs(riton.d ?? 0), ratonName(who))
  }
  const links = seenLinks(m)
  const rides = links.map((l) => ({ ...l, ride: l.tp ? null : transportOf(b, l.from, l.to) })).filter((l) => l.ride)
  if (rides.some((l) => l.ride!.kind === 'luge' && l.from !== 48)) return dedeLine('descent', key, p.nickname)
  const tp = seen.find((e) => e.t === 'tp')
  if (tp) return dedeLine(tp.k === 'ice' ? 'ice' : 'lift', key, p.nickname)
  const ride = seen.find((e) => e.t === 'ride')
  if (ride) return rideLine(b, ride, key, p.nickname)
  const halt = seen.find((e) => e.t === 'start' && e.halt)
  if (halt) return dedeLine('halt', key, p.nickname, 5, zoneName(m.cell))
  if (b.id === 'ski' && b.cellNames?.[m.cell] === 'La Loge du Pic' && !m.walking) return dedeLine('pic', key, p.nickname)
  const fork = seen.find((e) => e.t === 'fork')
  if (fork) return forkLine(b, fork, key, p.nickname)
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

/** Réplique d'une porte : aiguillages historiques du Grand Plateau, bancs de marée, bacs, cabines, barrières… */
function forkLine(b: BoardDef, e: DpEvent, key: string, name: string): string {
  const w = forkWay(b, e)
  if (w.tide) return dedeLine(w.detour ? 'fork_banc' : 'fork_banc_no', key, name)
  if (b.id === 'grand' && (w.cell === 13 || w.cell === 22)) return dedeLine(w.cell === 13 ? (w.detour ? 'fork_scene' : 'fork_scene_no') : w.detour ? 'fork_tunnel' : 'fork_tunnel_no', key, name)
  if (w.look === 'boat') return dedeLine(w.detour ? 'ferry' : 'ferry_miss', key, name, 0, w.zone)
  if (w.look === 'cabin') return dedeLine(w.detour ? 'cabin' : 'cabin_miss', key, name, 0, w.zone)
  if (w.look === 'piste') return w.detour ? dedeLine('piste', key, name) : dedeLine('gate_miss', key, name)
  return dedeLine(w.detour ? 'gate_in' : 'gate_miss', key, name, 0, w.zone)
}

/** Réplique d'un transport : bac vers une île ou navette du retour, télécabine, piste, Grande Descente. */
function rideLine(b: BoardDef, e: DpEvent, key: string, name: string): string {
  const to = typeof e.cell === 'number' ? e.cell : -1
  const zone = quarterOf(b, to)?.name ?? ''
  if (e.k === 'boat') return dedeLine(b.cells[to] === 'halt' ? 'ferry' : 'ferry_back', key, name, 0, zone)
  if (e.k === 'cabin') return dedeLine('cabin', key, name, 0, zone)
  if (e.k === 'slide') return dedeLine('piste', key, name)
  return dedeLine(e.from === 48 ? 'luge' : 'descent', key, name)
}

/** Nom d'une case (nom propre s'il y en a un, sinon son type). */
export const cellLabel = (b: BoardDef, cell: number) => b.cellNames?.[cell] ?? CELL_INFO[b.cells[cell]].label

/**
 * Texte de la puce de mécanique (à côté du tour en cours) ; null : pas de puce sur ce plateau.
 * `meCell` : case de mon pion (au camping en grande taille, le raton de MA zone passe en premier).
 */
export function mechChip(b: BoardDef, mech: DpMech | undefined, meCell?: number): { text: string; alert?: boolean; sub?: string } | null {
  const m = mech ?? {}
  if (b.id === 'mer') {
    const banks = ((b.extra.banks as unknown[]) ?? [0]).length
    const extra = banks > 1 ? ` · ${banks} bancs ${m.tide === 1 ? 'sous l’eau' : 'ouverts'}` : ''
    if (m.tide === 1) return { text: `🌊 Marée haute · elle redescend à la fin de ce tour${extra}` }
    if ((m.tide_in ?? 2) <= 1) return { text: `⚠️ La mer monte à la fin de ce tour !${extra}`, alert: true }
    return { text: `🌊 Marée basse · elle monte dans ${m.tide_in} tours${extra}` }
  }
  if (b.id === 'kermesse') {
    const n = b.cells.filter((t) => t === 'tombola').length
    return { text: `🎟️ Cagnotte : ${m.pot ?? 5} 🪙${n > 2 ? ` · ${n} guichets` : ''}` }
  }
  if (b.id === 'camping') {
    const raton = (who: number) => {
      const sack = who === 0 ? (m.sack ?? 0) : (m.pack?.[who - 1]?.sack ?? 0)
      return { who, sack }
    }
    const all = [raton(0), ...(m.pack ?? []).map((_, k) => raton(k + 1))]
    if (all.length === 1) return (m.sack ?? 0) > 0 ? { text: `🦝 Riton : sac plein (${m.sack} 🪙) — le prochain qui le croise ramasse tout !` } : { text: '🦝 Riton : sac vide — gare à tes pièces !' }
    // Grande taille : le raton de ma zone d'abord (Rita au Sous-bois, Ritou à la Rivière, Riton au camp).
    const q = typeof meCell === 'number' ? quarterOf(b, meCell) : null
    const mine = q ? Math.max(0, b.quarters.indexOf(q) + 1) : 0
    const main = all.find((r) => r.who === mine) ?? all[0]
    const txt = (r: { who: number; sack: number }, long: boolean) => (r.sack > 0 ? `${ratonName(r.who)} : sac plein${long ? `, ${r.sack} 🪙 !` : ` (${r.sack})`}` : `${ratonName(r.who)} : sac vide`)
    return { text: `🦝 ${txt(main, true)}`, sub: all.filter((r) => r !== main).map((r) => txt(r, false)).join(' · ') }
  }
  return null
}
