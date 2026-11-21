/**
 * Bots de Kems (mode solo) : un « cerveau » par bot, pur (heure et hasard injectés), appelé toutes les ~120 ms.
 * Un bot ne connaît que SA main, le centre public, le signe de SON équipe et ce que tout le monde voit
 * (les « flashs » d'expression des autres) : il ne triche jamais sur les mains des autres.
 *
 * - Échanges : à un rythme humain (≈ 4 s entre deux échanges au niveau 1, < 1 s au niveau 10).
 * - Carré : le bot fait le signe de son équipe (flash d'expression) après un temps de réaction, le répète
 *   tant que son coéquipier ne crie pas, et ne bouge plus ses cartes.
 * - Coéquipier qui fait le signe : KEMS ! après un temps de réaction (il peut l'avoir raté ou confondu
 *   avec une fausse expression aux bas niveaux).
 * - Adversaire qui fait une expression : il compte les expressions répétées par l'équipe d'en face ;
 *   quand l'une revient assez souvent (ou par intuition aux hauts niveaux) -> CONTRE-KEMS !
 * - Fausses expressions (bluff) : de temps en temps, plus souvent aux hauts niveaux, pour brouiller les pistes.
 */
import type { Rng } from './local'
import { rankOf } from './logic'

/** Expression neutre de repos ; jamais utilisée comme signe ni comme bluff. */
export const IDLE_EXPRESSION = 'joie'
/** Expressions communes aux 9 persos, utilisables comme signe ou bluff. */
export const SIGN_EXPRESSIONS = ['clin_oeil', 'bisou', 'surprise', 'boude', 'colere', 'reflexion', 'dodo'] as const

export interface SignEvent {
  /** Numéro croissant (pour ne traiter chaque flash qu'une fois). */
  n: number
  at: number
  by: string
  expr: string
  /** Vérité pour les stats / l'explication : le flash était-il le vrai signe de son équipe ? Les bots ne le lisent jamais. */
  real: boolean
}

export type BotOut =
  | { type: 'swap'; give: string; take: string }
  | { type: 'sweep' }
  | { type: 'kems' }
  | { type: 'counter' }
  | { type: 'flash'; expr: string; real: boolean }

export interface BotParams {
  swapMs: number
  smart: number
  signDelay: number
  signRepeat: number
  forget: number
  notice: number
  reaction: number
  misread: number
  spuriousPerSec: number
  fakeEvery: number
  inferThreshold: number
  guess: number
  counterNotice: number
  sweepP: number
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Réglages selon le niveau 1 (lent, distrait) → 10 (vif, précis). */
export function botParams(level: number): BotParams {
  const L = Math.min(10, Math.max(1, level))
  const t = (L - 1) / 9
  return {
    swapMs: lerp(4200, 650, t),
    smart: lerp(0.45, 1, t),
    signDelay: lerp(2200, 450, t),
    signRepeat: lerp(4500, 2200, t),
    forget: lerp(0.3, 0, t),
    notice: lerp(0.6, 1, t),
    reaction: lerp(2000, 450, t),
    misread: 0.1 * (1 - t) * (1 - t),
    spuriousPerSec: L <= 3 ? (4 - L) * 0.0008 : 0,
    fakeEvery: lerp(14000, 6000, t),
    inferThreshold: L <= 2 ? 99 : L <= 5 ? 3 : 2,
    guess: L <= 3 ? 0 : t * 0.3,
    counterNotice: lerp(0.35, 0.95, t),
    sweepP: lerp(0.25, 1, t),
  }
}

const score = (hand: readonly string[]): number => {
  const c: Record<string, number> = {}
  for (const x of hand) c[rankOf(x)] = (c[rankOf(x)] ?? 0) + 1
  return Object.values(c).reduce((a, b) => a + b * b, 0)
}

/** Meilleur échange (main, centre) : celui qui rapproche le plus d'un carré ; null s'il n'y en a pas d'utile. */
export function bestSwap(hand: readonly string[], center: readonly string[], rng: Rng): { give: string; take: string } | null {
  const base = score(hand)
  let best = base
  let found: Array<{ give: string; take: string }> = []
  for (const g of hand) {
    for (const t of center) {
      const s = score(hand.map((c) => (c === g ? t : c)))
      if (s > best) {
        best = s
        found = [{ give: g, take: t }]
      } else if (s === best && s > base) found.push({ give: g, take: t })
    }
  }
  return found.length ? found[Math.floor(rng() * found.length)] : null
}

interface PublicView {
  phase: string
  round: number
  center: string[]
}

export interface BotView {
  now: number
  state: PublicView
  /** MA main (jamais celle des autres). */
  hand: string[]
  events: readonly SignEvent[]
}

export interface BotSetup {
  id: string
  partner: string
  opponents: string[]
  /** Expression du signe de MON équipe. */
  signExpr: string
  level: number
}

const jitter = (ms: number, rng: Rng) => ms * (0.65 + rng() * 0.7)

export class KemsBrain {
  private p: BotParams
  private round = -1
  private lastStep = 0
  private seen = 0
  private nextSwapAt = 0
  private nextFakeAt = 0
  private signAt: number | null = null
  private kemsAt: number | null = null
  private counterAt: number | null = null
  private oppCounts: Record<string, number> = {}

  constructor(
    private cfg: BotSetup,
    private rng: Rng = Math.random,
  ) {
    this.p = botParams(cfg.level)
  }

  private resetRound(now: number, round: number) {
    this.round = round
    this.nextSwapAt = now + jitter(this.p.swapMs, this.rng) * 0.8
    this.nextFakeAt = now + jitter(this.p.fakeEvery, this.rng)
    this.signAt = null
    this.kemsAt = null
    this.counterAt = null
  }

  /** À appeler régulièrement ; renvoie les actions à jouer maintenant (le plus souvent aucune). */
  step(v: BotView): BotOut[] {
    const { now } = v
    const dt = this.lastStep ? Math.min(1000, now - this.lastStep) : 0
    this.lastStep = now
    if (v.state.phase !== 'playing') {
      this.round = -1
      this.seen = v.events.length ? v.events[v.events.length - 1].n : this.seen
      return []
    }
    if (v.state.round !== this.round) {
      this.resetRound(now, v.state.round)
      // les flashs d'avant la manche ne comptent pas comme signe de cette manche
      this.seen = v.events.length ? v.events[v.events.length - 1].n : this.seen
    }
    const { cfg, p, rng } = this
    const out: BotOut[] = []

    // 1. Ce que je vois : flashs de mon coéquipier et des adversaires
    for (const ev of v.events) {
      if (ev.n <= this.seen) continue
      this.seen = ev.n
      if (ev.by === cfg.partner) {
        const isSign = ev.expr === cfg.signExpr
        const sees = isSign ? rng() < p.notice : rng() < p.misread
        if (sees && this.kemsAt === null) this.kemsAt = now + jitter(p.reaction, rng)
      } else if (cfg.opponents.includes(ev.by)) {
        const c = (this.oppCounts[ev.expr] = (this.oppCounts[ev.expr] ?? 0) + 1)
        const top = Math.max(...Object.values(this.oppCounts))
        const suspect = (c >= p.inferThreshold && c === top) || rng() < p.guess
        if (suspect && rng() < p.counterNotice && this.counterAt === null) this.counterAt = now + jitter(p.reaction, rng)
      }
    }

    // 2. Cris dus (un seul à la fois, le plus pressé d'abord)
    if (this.kemsAt !== null && now >= this.kemsAt) {
      this.kemsAt = null
      return [{ type: 'kems' }]
    }
    if (this.counterAt !== null && now >= this.counterAt) {
      this.counterAt = null
      return [{ type: 'counter' }]
    }
    // Étourderie des bas niveaux : un « Kems ! » lancé pour rien
    if (p.spuriousPerSec > 0 && rng() < (p.spuriousPerSec * dt) / 1000) return [{ type: 'kems' }]

    // 3. Carré en main : on fait le signe, on ne bouge plus
    if (isSq(v.hand)) {
      if (this.signAt === null) this.signAt = now + jitter(p.signDelay, rng)
      if (now >= this.signAt) {
        const forgot = rng() < p.forget
        this.signAt = now + jitter(p.signRepeat, rng)
        if (!forgot) out.push({ type: 'flash', expr: cfg.signExpr, real: true })
      }
      return out
    }
    this.signAt = null

    // 4. Échanges
    if (now >= this.nextSwapAt) {
      this.nextSwapAt = now + jitter(p.swapMs, rng)
      if (rng() >= p.smart) {
        // distrait : il hésite, ou il échange n'importe quoi
        if (rng() < 0.5 && v.state.center.length && v.hand.length) {
          out.push({ type: 'swap', give: v.hand[Math.floor(rng() * v.hand.length)], take: v.state.center[Math.floor(rng() * v.state.center.length)] })
        }
      } else {
        const m = bestSwap(v.hand, v.state.center, rng)
        if (m) out.push({ type: 'swap', give: m.give, take: m.take })
        else if (rng() < p.sweepP) out.push({ type: 'sweep' })
      }
    }

    // 5. Bluff : une fausse expression de temps en temps
    if (now >= this.nextFakeAt) {
      this.nextFakeAt = now + jitter(p.fakeEvery, rng)
      const fakes = SIGN_EXPRESSIONS.filter((e) => e !== cfg.signExpr)
      out.push({ type: 'flash', expr: fakes[Math.floor(rng() * fakes.length)], real: false })
    }
    return out
  }
}

const isSq = (hand: readonly string[]): boolean => hand.length === 4 && new Set(hand.map(rankOf)).size === 1
