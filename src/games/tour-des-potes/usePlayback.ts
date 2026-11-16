/**
 * Animation du dernier coup : le state serveur est déjà « à jour », on rejoue
 * l'affichage — dés qui culbutent, pions qui avancent case par case, gains /
 * pertes d'argent flottants. Au premier rendu (rejoindre en cours de partie),
 * rien n'est rejoué : on affiche directement l'état courant.
 *
 * Taxes et loyers : repérés dans `events`, ils attendent l'ARRIVÉE du pion du
 * payeur ; la taxe fait alors voler des billets vers le pot du centre (`taxFx`,
 * le pot affiché `taxPot` ne grossit qu'à l'atterrissage), le loyer ouvre la
 * mini-scène « chez le propriétaire » (`rent`). Cagnotte ramassée sur « Pause
 * apéro » (évènement 'pot') : le tas reste affiché jusqu'à l'arrivée du pion, puis
 * ses billets s'envolent vers lui (`potFx`).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { fx } from '@/lib/feedback'
import { cardKeyOf } from './format'
import type { TdpState } from './types'

export const DICE_MS = 900
/** Animation 3D de pioche (soulever, retourner, face caméra) avant l'affichage de la carte. */
export const DRAW_ANIM_MS = 1900
/** Vol des billets d'une taxe, du pion jusqu'au pot du centre. */
export const TAX_FLY_MS = 1300
/** Cagnotte ramassée : vol des billets du centre vers le pion + annonce « Cagnotte ! ». */
export const POT_SHOW_MS = 2600
/** Pause entre l'arrivée du pion et l'effet (billets / mini-scène de loyer). */
const ARRIVE_MS = 350
const STEP_MS = 110
const MAX_WALK = 12

export interface MoneyFloat {
  key: string
  player: string
  amount: number
}

/** Taxe payée : billets qui volent du pion du payeur vers le centre (cagnotte ramassée : l'inverse). */
export interface TaxFx {
  /** Numéro de l'évènement 'tax'. */
  key: number
  player: string
  amount: number
  cell: number
}

/** Visiteur déjà passé à la caisse chez le même propriétaire pendant ce tour de table. */
export interface RentVisit {
  no: number
  payer: string
  amount: number
}

/** Loyer payé : mini-scène « chez le propriétaire ». */
export interface RentFx {
  /** Numéro de l'évènement 'rent'. */
  key: number
  payer: string
  owner: string
  cell: number
  amount: number
  /** File d'attente : ceux qui ont déjà payé ce propriétaire pendant le tour de table, dans l'ordre. */
  before: RentVisit[]
}

type PendingFx = ({ kind: 'tax'; fx: TaxFx } | { kind: 'pot'; fx: TaxFx } | { kind: 'rent'; fx: RentFx }) & { flying?: boolean }

/** Taxes et loyers produits par la dernière action (numéro > `after`). */
function moneyEvents(s: TdpState, after: number): PendingFx[] {
  const out: PendingFx[] = []
  if (s.phase === 'aborted') return out
  for (const e of s.events ?? []) {
    if (e.no <= after || !e.player || e.cell === undefined || !e.amount || e.amount <= 0) continue
    if (e.kind === 'tax' || e.kind === 'pot') out.push({ kind: e.kind, fx: { key: e.no, player: e.player, amount: e.amount, cell: e.cell } })
    else if (e.kind === 'rent' && e.to) {
      // champ récent : peut manquer dans une partie commencée avant la mise à jour du moteur
      const rr = (s as { round_rents?: TdpState['round_rents'] }).round_rents
      const before = (rr && rr.round === s.round ? (rr.payments ?? []) : []).filter((p) => p.owner === e.to && p.no < e.no).map((p) => ({ no: p.no, payer: p.payer, amount: p.amount }))
      out.push({ kind: 'rent', fx: { key: e.no, payer: e.player, owner: e.to, cell: e.cell, amount: e.amount, before } })
    }
  }
  return out
}

const playerOf = (p: PendingFx) => (p.kind === 'rent' ? p.fx.payer : p.fx.player)

/** Cases à parcourir en avant (0 si trop long : le pion « saute »). */
export function walkSteps(from: number, to: number): number {
  const n = (((to - from) % 40) + 40) % 40
  return n <= MAX_WALK ? n : 0
}

/**
 * `paused` : on fige la marche des pions (carte lue à l'écran) ; `cardHoldMs` : délai
 * avant que la carte piochée soit affichée (le déplacement qu'elle cause attend la fin).
 */
export function usePlayback(s: TdpState, paused = false, cardHoldMs = 600) {
  const [shownPos, setShownPos] = useState<Record<string, number>>(s.pos)
  const [rolling, setRolling] = useState(false)
  const [floats, setFloats] = useState<MoneyFloat[]>([])
  const [prevCash, setPrevCash] = useState(s.cash)
  const initialNo = useState(() => s.last_event?.no ?? 0)[0]
  const holdUntil = useRef(0)
  const target = useRef(s.pos)
  const pausedRef = useRef(paused)
  const initialCard = useState(() => cardKeyOf(s))[0]
  const [seenNo, setSeenNo] = useState(s.event_no)
  const [pendingFx, setPendingFx] = useState<PendingFx[]>([])
  const [taxFx, setTaxFx] = useState<TaxFx | null>(null)
  const [potFx, setPotFx] = useState<TaxFx | null>(null)
  const [rent, setRent] = useState<RentFx | null>(null)
  const timers = useRef(new Set<number>())

  // Gains / pertes : comparaison du state précédent (ajustement pendant le rendu).
  if (s.cash !== prevCash) {
    setPrevCash(s.cash)
    const add: MoneyFloat[] = []
    for (const id of Object.keys(s.cash)) {
      const d = (s.cash[id] ?? 0) - (prevCash[id] ?? s.cash[id] ?? 0)
      if (d !== 0) add.push({ key: `${s.event_no}-${id}-${d}`, player: id, amount: d })
    }
    if (add.length) setFloats((f) => [...f, ...add].slice(-12))
  }

  // Taxes / loyers de la dernière action : en attente de l'arrivée du pion.
  if (s.event_no !== seenNo) {
    setSeenNo(s.event_no)
    const add = moneyEvents(s, seenNo)
    if (add.length) setPendingFx((q) => [...q, ...add].slice(-6))
  }
  // Une carte est lue en grand : la mini-scène de loyer lui laisse la place.
  if (paused && rent) setRent(null)

  const dismissFloat = (key: string) => setFloats((f) => f.filter((x) => x.key !== key))

  // Nouveau lancer : dés qui roulent, les pions attendent la fin du lancer.
  const rollNo = s.last_event?.no ?? 0
  useEffect(() => {
    if (rollNo === initialNo) return
    holdUntil.current = Date.now() + DICE_MS
    const t0 = window.setTimeout(() => setRolling(true), 0)
    const t1 = window.setTimeout(() => setRolling(false), DICE_MS)
    return () => {
      clearTimeout(t0)
      clearTimeout(t1)
    }
  }, [rollNo, initialNo])

  useEffect(() => {
    pausedRef.current = paused
  }, [paused])

  // Carte piochée : les pions attendent que la carte ait été montrée.
  const cardKey = cardKeyOf(s)
  useEffect(() => {
    if (!cardKey || cardKey === initialCard) return
    holdUntil.current = Math.max(holdUntil.current, Date.now() + cardHoldMs + 400)
  }, [cardKey, initialCard, cardHoldMs])

  // Marche des pions vers leur case réelle.
  useEffect(() => {
    target.current = s.pos
  }, [s.pos])
  useEffect(() => {
    const id = window.setInterval(() => {
      if (pausedRef.current || Date.now() < holdUntil.current) return
      setShownPos((cur) => {
        let changed = false
        const next = { ...cur }
        for (const [p, t] of Object.entries(target.current)) {
          const d = cur[p]
          if (d === undefined || d === t) {
            if (d === undefined) {
              next[p] = t
              changed = true
            }
            continue
          }
          next[p] = walkSteps(d, t) > 0 ? (d + 1) % 40 : t
          changed = true
        }
        return changed ? next : cur
      })
    }, STEP_MS)
    return () => clearInterval(id)
  }, [])

  // Le pion du payeur est arrivé : billets vers le centre / mini-scène de loyer.
  useEffect(() => {
    const ready = pendingFx.filter((p) => !p.flying && shownPos[playerOf(p)] === p.fx.cell)
    if (!ready.length) return
    const t = window.setTimeout(() => {
      const keys = new Set(ready.map((p) => p.fx.key))
      const tax = ready.filter((p) => p.kind === 'tax')
      const rents = ready.filter((p) => p.kind === 'rent')
      const pots = ready.filter((p) => p.kind === 'pot')
      setPendingFx((q) => q.filter((p) => p.kind === 'tax' || !keys.has(p.fx.key)).map((p) => (keys.has(p.fx.key) ? { ...p, flying: true } : p)))
      if (rents.length) {
        fx.whoosh()
        setRent(rents[rents.length - 1].fx)
      }
      for (const p of pots) {
        const f = p.fx
        fx.success()
        setPotFx(f)
        const done = window.setTimeout(() => {
          timers.current.delete(done)
          setPotFx((cur) => (cur?.key === f.key ? null : cur))
        }, POT_SHOW_MS)
        timers.current.add(done)
      }
      for (const p of tax) {
        const f = p.fx
        fx.cash()
        setTaxFx(f)
        // atterrissage : le pot affiché grossit, l'effet est consommé
        const land = window.setTimeout(() => {
          timers.current.delete(land)
          setPendingFx((q) => q.filter((x) => x.fx.key !== f.key))
          setTaxFx((cur) => (cur?.key === f.key ? null : cur))
        }, TAX_FLY_MS)
        timers.current.add(land)
      }
    }, Math.max(0, holdUntil.current - Date.now()) + ARRIVE_MS)
    return () => clearTimeout(t)
  }, [pendingFx, shownPos])

  // Filet : un effet jamais déclenché (pion ailleurs) ne retient pas le pot indéfiniment.
  useEffect(() => {
    const stuck = pendingFx.filter((p) => !p.flying)
    if (!stuck.length) return
    const t = window.setTimeout(() => setPendingFx((q) => q.filter((p) => !stuck.includes(p))), 12000)
    return () => clearTimeout(t)
  }, [pendingFx])

  useEffect(() => {
    const set = timers.current
    return () => {
      for (const t of set) clearTimeout(t)
      set.clear()
    }
  }, [])

  const dismissRent = useCallback(() => setRent(null), [])
  // Cagnotte affichée : les billets encore en route n'y sont pas ; une cagnotte ramassée
  // (déjà à 0 côté serveur) reste au centre tant que le pion n'est pas arrivé.
  const held = pendingFx.reduce((n, p) => (p.kind === 'tax' ? n + p.fx.amount : p.kind === 'pot' ? n - p.fx.amount : n), 0)
  const taxPot = Math.max(0, ((s as { tax_pot?: number }).tax_pot ?? 0) - held)

  return { shownPos, rolling, floats, dismissFloat, initialNo, taxPot, taxFx, potFx, rent, dismissRent }
}
