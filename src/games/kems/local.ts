/**
 * Moteur LOCAL de Kems (mode solo : toi + un bot contre 2 bots, tout sur le téléphone).
 * Miroir fidèle de supabase/games/kems.sql (game_kems_start / game_kems_action) : mêmes states, mêmes
 * secrets, mêmes codes d'erreur (`throw new Error('<code>')`). Synchro vérifiée par
 * tools/sql-tests/kems-solo.mjs (PGlite) ; l'heure (`now`, en ms) et le hasard (`rng`) sont injectés.
 * Rien ici ne touche au réseau : rien ne peut compter côté serveur.
 */
import type { TeamColor } from '@/features/teams/teams'

type J = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
export interface KemsX {
  state: J
  server: J
  secrets?: Record<string, J> | null
  results?: J[]
}
export type Rng = () => number

const COLORS: TeamColor[] = ['red', 'blue', 'green', 'yellow']
const SUITS = ['S', 'H', 'D', 'C']
const RANKS_4 = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A']
const RANKS_52 = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']

function fail(code: string): never {
  throw new Error(code)
}
const iso = (ms: number) => new Date(ms).toISOString()
const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T))
const rankOf = (c: string) => c.slice(0, -1)

export function shuffle<T>(a: readonly T[], rng: Rng): T[] {
  const out = [...a]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** Quatre cartes de même valeur (_kems_square). */
export const square = (hand: unknown): boolean => Array.isArray(hand) && hand.length === 4 && new Set(hand.map((c) => rankOf(String(c)))).size === 1

function bump(server: J, pid: string, key: string, delta: number): J {
  if (!server.pstats?.[pid]) return server
  return { ...server, pstats: { ...server.pstats, [pid]: { ...server.pstats[pid], [key]: (server.pstats[pid][key] ?? 0) + delta } } }
}
function tbump(state: J, team: string, key: string, delta: number): J {
  return { ...state, tstats: { ...state.tstats, [team]: { ...state.tstats[team], [key]: (state.tstats?.[team]?.[key] ?? 0) + delta } } }
}
function secretOf(state: J, server: J, pid: string): J {
  return {
    round: state.round,
    hand: server.hands?.[pid] ?? [],
    square: square(server.hands?.[pid]),
    sign_ideas: server.signs?.[pid] ?? [],
    v: state.hand_ver?.[pid] ?? 1,
  }
}
/** state.deadline = prochaine échéance du tick pendant « playing » (_kems_playing_deadline). */
function playingDeadline(state: J): J {
  const a = Date.parse(state.sweep.deadline)
  const b = Date.parse(state.round_deadline)
  return { ...state, deadline: iso(Math.min(a, b)) }
}

function deal(state0: J, server0: J, round: number, now: number, rng: Rng): KemsX {
  let state = state0
  let server = server0
  const players: string[] = state.players
  const n = players.length
  const ranks = n <= 4 ? RANKS_4 : RANKS_52
  const deck = shuffle(ranks.flatMap((r) => SUITS.map((s) => r + s)), rng)
  const hands: J = {}
  const ver: J = { ...(state.hand_ver ?? {}) }
  const sq: J = {}
  players.forEach((pid, i) => {
    hands[pid] = deck.slice(i * 4, i * 4 + 4)
    ver[pid] = (ver[pid] ?? 0) + 1
    if (square(hands[pid])) {
      server = bump(server, pid, 'squares', 1)
      sq[pid] = round
    }
  })
  state = {
    ...state,
    phase: 'playing',
    round,
    ready: [],
    hand_ver: ver,
    center: deck.slice(n * 4, n * 4 + 4),
    deck_count: deck.length - n * 4 - 4,
    sweep: { votes: [], deadline: iso(now + 10000) },
    round_deadline: iso(now + 180000),
    feed: [],
    call: null,
  }
  state = playingDeadline(state)
  server = {
    ...server,
    deck: deck.slice(n * 4 + 4),
    discard: [],
    hands,
    round_started_at: iso(now),
    sq_counted: { ...(server.sq_counted ?? {}), ...sq },
    last_swap: {},
  }
  const secrets: J = {}
  for (const pid of players) secrets[pid] = secretOf(state, server, pid)
  return { state, server, secrets }
}

function sweep(state0: J, server0: J, now: number, rng: Rng): KemsX {
  let state = state0
  let server = server0
  const swept: string[] = state.center
  let deck: string[] = server.deck
  let nu = deck.slice(0, 4)
  deck = deck.slice(4)
  const need = 4 - nu.length
  if (need > 0) {
    deck = shuffle(server.discard ?? [], rng)
    nu = [...nu, ...deck.slice(0, need)]
    deck = deck.slice(need)
    server = { ...server, discard: [] }
  }
  server = { ...server, deck, discard: [...server.discard, ...swept] }
  state = {
    ...state,
    center: nu,
    deck_count: deck.length,
    sweeps: (state.sweeps ?? 0) + 1,
    sweep: { votes: [], deadline: iso(now + 10000) },
  }
  return { state: playingDeadline(state), server }
}

function finish(state0: J, server0: J): KemsX {
  let state = state0
  let server = server0
  const target: number = state.target
  const teams: J[] = state.teams
  for (const t of teams) {
    if (t.score >= target && (state.tstats?.[t.id]?.errors ?? 0) === 0 && (state.tstats?.[t.id]?.countered ?? 0) === 0) {
      for (const m of t.players) server = bump(server, m, 'clean_win', 1)
    }
  }
  const scores = [...new Set(teams.map((t) => t.score))].sort((a, b) => b - a)
  const results = teams.flatMap((t) =>
    t.players.map((m: string) => ({
      profile_id: m,
      points: t.score,
      won: t.score >= target,
      placement: scores.indexOf(t.score) + 1,
      stats: server.pstats?.[m] ?? {},
    })),
  )
  state = {
    ...state,
    phase: 'finished',
    results,
    deadline: null,
    winners: teams.filter((t) => t.score >= target).map((t) => t.id),
  }
  return { state, server, results }
}

function endRound(state0: J, server: J, call0: J, now: number): KemsX {
  let state = state0
  const teams = state.teams.map((t: J) => ({ ...t, score: t.score + (call0.deltas?.[t.id] ?? 0) }))
  const call = {
    ...call0,
    hands: server.hands,
    round: state.round,
    holders: Object.keys(server.hands).filter((k) => square(server.hands[k])),
  }
  state = {
    ...state,
    teams,
    call,
    phase: 'reveal',
    sweep: { votes: [], deadline: null },
    deadline: iso(now + 6000),
  }
  if (teams.some((t: J) => t.score >= state.target)) return finish(state, server)
  return { state, server }
}

export interface KemsStartOptions {
  teams: Partial<Record<TeamColor, string[]>>
  target?: number
  /** Idées de signes (liste vide en solo : le signe est choisi à l'écran). */
  signs?: string[]
}

/** Miroir de game_kems_start. `players` = tous les participants (le banc = ceux hors équipes). */
export function kemsStart(players: string[], opt: KemsStartOptions, now: number, rng: Rng = Math.random): KemsX {
  const inTeams = opt.teams as Record<string, string[]> | undefined
  if (!inTeams || typeof inTeams !== 'object') fail('invalid_teams')
  for (const k of Object.keys(inTeams!)) if (!COLORS.includes(k as TeamColor)) fail('invalid_teams')
  const target = opt.target === 3 || opt.target === 5 || opt.target === 7 ? opt.target : 5
  const pool = (opt.signs ?? []).filter((x) => x.trim() !== '')
  const teams: J[] = []
  const all: string[] = []
  const seen: string[] = []
  const tstats: J = {}
  const signs: J = {}
  for (const c of COLORS) {
    if (!(c in inTeams!)) continue
    const members = inTeams![c]
    if (!Array.isArray(members) || members.length !== 2) fail('invalid_teams')
    for (const m of members) {
      if (seen.includes(m) || !players.includes(m)) fail('invalid_teams')
      seen.push(m)
    }
    teams.push({ id: c, players: members, score: 0 })
    all.push(...members)
    tstats[c] = { kems: 0, counters: 0, errors: 0, countered: 0 }
    const ideas = shuffle(pool, rng).slice(0, 3).map((x) => x.slice(0, 80))
    for (const m of members) signs[m] = ideas
  }
  if (teams.length < 2 || teams.length > 4) fail('invalid_teams')
  const pstats: J = {}
  const ver: J = {}
  for (const m of all) {
    pstats[m] = { false_kems: 0, countered: 0, false_counters: 0, squares: 0, team_kems: 0, counters_ok: 0, fast_kems: 0, clean_win: 0, double_kems: 0 }
    ver[m] = 1
  }
  const state: J = {
    game: 'kems',
    phase: 'signs',
    players: all,
    bench: players.filter((p) => !seen.includes(p)),
    round: 0,
    target,
    teams,
    ready: [],
    center: [],
    deck_count: 0,
    sweep: { votes: [], deadline: null },
    round_deadline: null,
    deadline: iso(now + 45000),
    feed: [],
    swaps: 0,
    sweeps: 0,
    hand_ver: ver,
    call: null,
    tstats,
  }
  const server: J = { signs, pstats, hands: {}, deck: [], discard: [], sq_counted: {}, last_swap: {} }
  const secrets: J = {}
  for (const m of all) secrets[m] = secretOf(state, server, m)
  return { state, server, secrets }
}

/** Miroir de game_kems_action. Ne mute pas ses arguments ; lève Error(code) si l'action est refusée. */
export function kemsAct(x0: { state: J; server: J }, actor: string, isHost: boolean, action: J, now: number, rng: Rng = Math.random): KemsX {
  const state0: J = clone(x0.state)
  const server0: J = clone(x0.server)
  let state = state0
  let server = server0
  const type = action?.type
  const phase: string = state.phase
  const unchanged: KemsX = { state, server }
  const n: number = state.players.length
  const team: J | undefined = state.teams.find((t: J) => t.players.includes(actor))
  const partner: string | undefined = team?.players.find((p: string) => p !== actor)

  if (type === 'ready') {
    if (phase !== 'signs') return unchanged
    if (!team) fail('not_in_match')
    if (!state.ready.includes(actor)) state = { ...state, ready: [...state.ready, actor] }
    if (state.ready.length >= n) return deal(state, server, 1, now, rng)
    return { state, server }
  }

  if (type === 'swap') {
    if (phase !== 'playing') return unchanged
    if (!team) fail('not_in_match')
    if (typeof action.give !== 'string' || typeof action.take !== 'string') fail('invalid_action')
    const give: string = action.give
    const take: string = action.take
    // double appui : un échange du même joueur moins de 250 ms après le précédent est ignoré
    if (now - (server.last_swap?.[actor] ?? 0) < 250) return unchanged
    const hand0: string[] = server.hands[actor]
    if (!hand0.includes(give)) fail('not_in_hand')
    if (!state.center.includes(take)) fail('card_taken')
    const hand = hand0.map((c) => (c === give ? take : c))
    state = {
      ...state,
      center: state.center.map((c: string) => (c === take ? give : c)),
      swaps: (state.swaps ?? 0) + 1,
      feed: [{ n: (state.swaps ?? 0) + 1, by: actor, took: take, gave: give }, ...state.feed].slice(0, 6),
      sweep: { votes: [], deadline: iso(now + 10000) },
      hand_ver: { ...state.hand_ver, [actor]: (state.hand_ver?.[actor] ?? 0) + 1 },
    }
    state = playingDeadline(state)
    server = { ...server, hands: { ...server.hands, [actor]: hand }, last_swap: { ...(server.last_swap ?? {}), [actor]: now } }
    if (square(hand) && String(server.sq_counted?.[actor]) !== String(state.round)) {
      server = bump(server, actor, 'squares', 1)
      server = { ...server, sq_counted: { ...server.sq_counted, [actor]: state.round } }
    }
    return { state, server, secrets: { [actor]: secretOf(state, server, actor) } }
  }

  if (type === 'sweep') {
    if (phase !== 'playing') return unchanged
    if (!team) fail('not_in_match')
    let votes: string[] = state.sweep.votes
    votes = votes.includes(actor) ? votes.filter((v) => v !== actor) : [...votes, actor]
    state = { ...state, sweep: { ...state.sweep, votes } }
    if (votes.length >= n) return sweep(state, server, now, rng)
    return { state, server }
  }

  if (type === 'kems') {
    if (phase !== 'playing') return unchanged
    if (!team) fail('not_in_match')
    const tid: string = team.id
    const ok = square(server.hands[partner!])
    let double = false
    let deltas: J
    if (ok) {
      double = square(server.hands[actor])
      const started = Date.parse(server.round_started_at)
      deltas = { [tid]: double ? 2 : 1 }
      state = tbump(state, tid, 'kems', 1)
      for (const m of team.players as string[]) {
        server = bump(server, m, 'team_kems', 1)
        if (double) server = bump(server, m, 'double_kems', 1)
        if ((now - started) / 1000 < 20) server = bump(server, m, 'fast_kems', 1)
      }
    } else {
      deltas = Object.fromEntries(state.teams.filter((t: J) => t.id !== tid).map((t: J) => [t.id, 1]))
      state = tbump(state, tid, 'errors', 1)
      server = bump(server, actor, 'false_kems', 1)
    }
    return endRound(state, server, { type: 'kems', by: actor, team: tid, target: null, ok, double, deltas }, now)
  }

  if (type === 'counter') {
    if (phase !== 'playing') return unchanged
    if (!team) fail('not_in_match')
    const tid: string = team.id
    const others: string[] = state.teams.filter((t: J) => t.id !== tid).map((t: J) => t.id)
    let target: string
    if (action.team === undefined || action.team === null) {
      if (others.length !== 1) fail('invalid_action')
      target = others[0]
    } else if (others.includes(action.team)) target = action.team
    else return fail('invalid_action')
    const res: J = state.teams.find((t: J) => t.id === target)
    const ok = (res.players as string[]).some((p) => square(server.hands[p]))
    let deltas: J
    if (ok) {
      deltas = { [tid]: 1 }
      state = tbump(tbump(state, tid, 'counters', 1), target, 'countered', 1)
      server = bump(server, actor, 'counters_ok', 1)
      for (const m of res.players as string[]) server = bump(server, m, 'countered', 1)
    } else {
      deltas = Object.fromEntries(state.teams.filter((t: J) => t.id !== tid).map((t: J) => [t.id, 1]))
      state = tbump(state, tid, 'errors', 1)
      server = bump(server, actor, 'false_counters', 1)
    }
    return endRound(state, server, { type: 'counter', by: actor, team: tid, target, ok, double: false, deltas }, now)
  }

  if (type === 'tick') {
    if (phase === 'signs' && now >= Date.parse(state.deadline)) return deal(state, server, 1, now, rng)
    if (phase === 'playing') {
      if (now >= Date.parse(state.round_deadline)) {
        return endRound(state, server, { type: 'timeout', by: null, team: null, target: null, ok: false, double: false, deltas: {} }, now)
      }
      if (now >= Date.parse(state.sweep.deadline)) return sweep(state, server, now, rng)
    }
    if (phase === 'reveal' && now >= Date.parse(state.deadline)) return deal(state, server, state.round + 1, now, rng)
    return unchanged
  }

  if (type === 'next') {
    if (!isHost) fail('not_host')
    if (phase !== 'reveal') return unchanged
    return deal(state, server, state.round + 1, now, rng)
  }

  return fail('unknown_action')
}
