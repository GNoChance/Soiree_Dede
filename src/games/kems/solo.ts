/**
 * Partie de Kems en solo : toi + un bot coéquipier contre 2 bots (équipes rouge / bleue).
 * Orchestre le moteur local (local.ts : miroir du SQL) et les cerveaux des bots (bot.ts), sans React ni horloge
 * propre : l'appelant passe `now` (ms). Testable avec une horloge simulée (tools/sql-tests/kems-solo.mjs).
 * Les « signes » sont des flashs d'expression de chibi visibles de tous ; rien n'est compté nulle part.
 */
import { KemsBrain, SIGN_EXPRESSIONS, type BotOut, type SignEvent } from './bot'
import { kemsAct, kemsStart, square, type KemsX, type Rng } from './local'

export interface KemsSoloSetup {
  me: string
  partner: string
  opps: [string, string]
  /** Expression du signe de mon équipe (choisie par le joueur), et celui de l'équipe adverse (tiré au sort). */
  mySign: string
  oppSign: string
  level: number
  target: 3 | 5 | 7
  rng?: Rng
}

export interface KemsRoundLog {
  round: number
  type: 'kems' | 'counter' | 'timeout'
  /** Qui a crié (null = manche blanche). */
  by: string | null
  ok: boolean
  /** Équipe qui a crié / qui était visée. */
  team: string | null
  target: string | null
  holders: string[]
  /** Flashs du vrai signe pendant la manche (carré en main). */
  partnerSigns: number
  mySigns: number
  oppSigns: number
  /** Mes flashs sans carré (bluff). */
  myBluffs: number
}

export const FACE_MS = 1400
export const BOT_TICK_MS = 120

export class KemsSoloSim {
  x: KemsX
  events: SignEvent[] = []
  rounds: KemsRoundLog[] = []
  /** Expression affichée par chacun (flash en cours). */
  faces: Record<string, { expr: string; until: number }> = {}
  /** Incrémenté à chaque changement visible (state ou visage) : l'UI ne se met à jour que si elle change. */
  version = 0
  private brains: Record<string, KemsBrain> = {}
  private roundStart = 0
  private evN = 0
  private lastBotStep = 0

  constructor(
    readonly cfg: KemsSoloSetup,
    now: number,
  ) {
    const rng = cfg.rng ?? Math.random
    const ids = [cfg.me, cfg.partner, cfg.opps[0], cfg.opps[1]]
    let x = kemsStart(ids, { teams: { red: [cfg.me, cfg.partner], blue: [cfg.opps[0], cfg.opps[1]] }, target: cfg.target }, now, rng)
    for (const id of ids) x = kemsAct(x, id, id === cfg.me, { type: 'ready' }, now, rng)
    this.x = x
    const mk = (id: string, partner: string, opponents: string[], signExpr: string) =>
      (this.brains[id] = new KemsBrain({ id, partner, opponents, signExpr, level: cfg.level }, rng))
    mk(cfg.partner, cfg.me, [...cfg.opps], cfg.mySign)
    mk(cfg.opps[0], cfg.opps[1], [cfg.me, cfg.partner], cfg.oppSign)
    mk(cfg.opps[1], cfg.opps[0], [cfg.me, cfg.partner], cfg.oppSign)
    this.roundStart = 0
  }

  get state() {
    return this.x.state
  }
  get phase(): string {
    return this.x.state.phase
  }
  get myHand(): string[] {
    return this.x.server.hands?.[this.cfg.me] ?? []
  }
  /** win / loss / draw une fois la partie finie. */
  get outcome(): 'win' | 'loss' | 'draw' | null {
    if (this.phase !== 'finished') return null
    const w: string[] = this.x.state.winners ?? []
    const mine = w.includes('red')
    const theirs = w.includes('blue')
    return mine && theirs ? 'draw' : mine ? 'win' : 'loss'
  }

  /** Action d'un joueur (toi ou un bot). Renvoie le code d'erreur si le moteur refuse, sinon null. */
  act(actor: string, action: Record<string, unknown>, now: number): string | null {
    const prev = this.x.state
    try {
      const r = kemsAct(this.x, actor, actor === this.cfg.me, action, now, this.cfg.rng ?? Math.random)
      if (r.state === undefined) return null
      this.x = { state: r.state, server: r.server, secrets: { ...(this.x.secrets ?? {}), ...(r.secrets ?? {}) } }
      if (r.results) this.x.results = r.results
    } catch (e) {
      return e instanceof Error ? e.message : 'unknown'
    }
    const next = this.x.state
    if (prev.phase === 'playing' && (next.phase === 'reveal' || next.phase === 'finished') && next.call) this.logRound(next)
    if (next.phase === 'playing' && prev.round !== next.round) this.roundStart = this.evN
    this.version++
    return null
  }

  private logRound(state: KemsX['state']) {
    const call = state.call
    const { me, partner } = this.cfg
    const inRound = this.events.filter((e) => e.n > this.roundStart)
    const mine = inRound.filter((e) => e.by === me)
    this.rounds.push({
      round: state.round,
      type: call.type,
      by: call.by,
      ok: call.ok,
      team: call.team,
      target: call.target,
      holders: call.holders,
      partnerSigns: inRound.filter((e) => e.by === partner && e.real).length,
      mySigns: mine.filter((e) => e.real).length,
      oppSigns: inRound.filter((e) => this.cfg.opps.includes(e.by) && e.real).length,
      myBluffs: mine.filter((e) => !e.real).length,
    })
  }

  /** Un joueur (ou bot) fait une expression visible de tous. */
  flash(by: string, expr: string, real: boolean, now: number) {
    this.events.push({ n: ++this.evN, at: now, by, expr, real })
    this.faces[by] = { expr, until: now + FACE_MS }
    this.version++
  }

  /** Bouton « Faire le signe » du joueur : vrai signe si carré, sinon bluff. */
  humanSign(now: number) {
    if (this.phase !== 'playing') return
    this.flash(this.cfg.me, this.cfg.mySign, square(this.myHand), now)
  }

  private runBot(id: string, out: BotOut, now: number) {
    if (this.phase !== 'playing') return
    if (out.type === 'flash') this.flash(id, out.expr, out.real, now)
    else if (out.type === 'swap') this.act(id, { type: 'swap', give: out.give, take: out.take }, now)
    else if (out.type === 'sweep') this.act(id, { type: 'sweep' }, now)
    else if (out.type === 'kems') this.act(id, { type: 'kems' }, now)
    else if (out.type === 'counter') this.act(id, { type: 'counter' }, now)
  }

  /** À appeler toutes les ~120 ms : visages, bots, échéances (balayage auto, manche blanche, fin de révélation). */
  step(now: number) {
    for (const [id, f] of Object.entries(this.faces)) {
      if (f.until <= now) {
        delete this.faces[id]
        this.version++
      }
    }
    if (now - this.lastBotStep >= BOT_TICK_MS) {
      this.lastBotStep = now
      for (const id of [this.cfg.partner, ...this.cfg.opps]) {
        if (this.phase !== 'playing') break
        const outs = this.brains[id].step({
          now,
          state: this.x.state as { phase: string; round: number; center: string[] },
          hand: this.x.server.hands?.[id] ?? [],
          events: this.events,
        })
        for (const o of outs) this.runBot(id, o, now)
      }
    }
    const dl = this.x.state.deadline
    if ((this.phase === 'playing' || this.phase === 'reveal') && dl && now >= Date.parse(dl)) this.act(this.cfg.me, { type: 'tick' }, now)
  }
}

/** Signe de l'équipe adverse : tiré au hasard, différent du mien. */
export function pickOppSign(mySign: string, rng: Rng = Math.random): string {
  const pool = SIGN_EXPRESSIONS.filter((e) => e !== mySign)
  return pool[Math.floor(rng() * pool.length)]
}

/* ------------------------------------------------------------------ explication de fin de partie */

export interface KemsWhy {
  /** Phrases courtes, tutoiement ; vide si rien de marquant. */
  lines: string[]
}

/** « Pourquoi j'ai perdu » (ou compliment) à partir des manches jouées. `label` : libellé du signe adverse. */
export function explainKems(rounds: readonly KemsRoundLog[], outcome: 'win' | 'loss' | 'draw', partnerName: string): KemsWhy {
  const lines: string[] = []
  const partnerSigns = rounds.reduce((a, r) => a + r.partnerSigns, 0)
  const spotted = rounds.filter((r) => r.type === 'counter' && r.ok && r.team === 'blue')
  const missed = rounds.filter((r) => r.partnerSigns > 0 && !(r.team === 'red' && r.type === 'kems' && r.ok))
  const wrongRed = rounds.filter((r) => r.team === 'red' && !r.ok && r.type !== 'timeout')
  const mineOk = rounds.filter((r) => r.team === 'red' && r.ok && r.type === 'kems')
  if (outcome === 'loss') {
    if (partnerSigns > 0 && missed.length > 0) {
      const n = missed.reduce((a, r) => a + r.partnerSigns, 0)
      lines.push(`${partnerName} avait fait son signe ${n} fois sans que tu cries KEMS : surveille-le !`)
    }
    if (spotted.length) lines.push(`Les Bleus ont repéré ton signe ${spotted.length} fois : change de rythme, ou bluffe avec un faux signe.`)
    if (wrongRed.length) lines.push(`Tu as fait ${wrongRed.length} faux appel${wrongRed.length > 1 ? 's' : ''} : chacun offre un point aux autres.`)
  } else if (outcome === 'win') {
    if (mineOk.length) lines.push(`${mineOk.length} KEMS réussi${mineOk.length > 1 ? 's' : ''} avec ${partnerName} : beau duo !`)
    if (partnerSigns > 0) lines.push(`${partnerName} a fait son signe ${partnerSigns} fois : tu l’as bien guetté.`)
  }
  return { lines: lines.slice(0, 3) }
}
