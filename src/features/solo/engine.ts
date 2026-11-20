/**
 * Mini-socle « duel » LOCAL du mode solo (joueur contre bot, tout sur le téléphone).
 * Miroir TS de supabase/features/duel.sql restreint à UNE manche (mode duel, best_of 1,
 * sans minuteur ni paris) : produit le même `state` (phase, duel, board) que le serveur
 * pour les mêmes actions, ce qui permet de réutiliser les plateaux des jeux tels quels.
 * Synchro vérifiée par tools/sql-tests/solo-sync.mjs (PGlite).
 *
 * Chaque jeu fournit ses hooks (src/games/<id>/local.ts), miroirs de game_<id>_board_*.
 * Erreurs métier : `throw new Error('<code>')` (mêmes codes que le SQL).
 */
import type { DuelInfo, DuelSession, DuelState } from '@/features/duel/types'

export interface BoardCtx {
  duel_no: number
  game_no: number
  a: string
  b: string
  starter: string
  options: Record<string, unknown>
}

/** Retour d'un hook (même forme que le jsonb renvoyé par le SQL). */
export interface HookResult<B> {
  board: B
  server?: unknown
  secrets?: Record<string, unknown>
  outcome?: 'win' | 'draw' | null
  winner?: string
  turn?: string
  game?: unknown
  setup_seconds?: number
  turn_seconds?: number
}

export interface LocalDuelGame<B = unknown, M = unknown> {
  id: string
  boardNew: (ctx: BoardCtx, a: string, b: string) => HookResult<B>
  boardMove: (board: B, server: unknown, actor: string, move: M) => HookResult<B>
  boardSetup?: (board: B, server: unknown, actor: string | null, move: { type: string } & Record<string, unknown>) => HookResult<B>
  boardOffturn?: (board: B, server: unknown, actor: string, move: M) => HookResult<B>
}

/** Partie locale : state public + part serveur (jamais montrée) + secrets de chacun. */
export interface SoloX<B = unknown, M = unknown> {
  state: DuelState<B, M>
  server: { board: unknown }
  /** Secrets courants par joueur (équivalent de match_secrets). */
  secrets: Record<string, unknown>
}

/** Résultat d'une action (comme game_action : `secrets` = secrets réécrits par CETTE action). */
export interface SoloStep<B = unknown, M = unknown> extends SoloX<B, M> {
  changed: Record<string, unknown> | null
}

export type SoloAction = { type: string } & Record<string, unknown>

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T))
const fail = (code: string): never => {
  throw new Error(code)
}

function session(a: string, b: string, options: Record<string, unknown>): DuelSession {
  return {
    mode: 'duel',
    best_of: 1,
    turn_seconds: 0,
    board_options: options,
    scores: { [a]: 0, [b]: 0 },
    stats: {},
    streak: { player: null, count: 0 },
    streak_target: 0,
    min_played: 0,
    duel_count: 0,
    history: [],
    queue: null,
    bracket: null,
    pair: [a, b],
    over: false,
    end_reason: null,
    champion: null,
  }
}

/** Démarre la manche (miroir de _duel_begin_game, 1er duel, 1re manche). `first` = ❌ / Blancs / premier à jouer. */
export function soloStart<B, M>(
  game: LocalDuelGame<B, M>,
  { a, b, first, options = {} }: { a: string; b: string; first: string; options?: Record<string, unknown> },
): SoloX<B, M> {
  const r = game.boardNew({ duel_no: 1, game_no: 1, a, b, starter: first, options: clone(options) }, a, b)
  const setup = typeof r.setup_seconds === 'number' && r.setup_seconds > 0
  const duel: DuelInfo<M> = {
    no: 1,
    a,
    b,
    first,
    starter: first,
    turn: setup ? null : first,
    game_no: 1,
    wins: { [a]: 0, [b]: 0 },
    games: [],
    bets: {},
    bets_until: null,
    moves: 0,
    last_move: null,
    outcome: null,
    winner: null,
    ready: [],
    result: null,
    round: null,
    match: null,
    replay: false,
  }
  return {
    state: {
      game: game.id,
      phase: setup ? 'setup' : 'playing',
      players: [a, b],
      session: session(a, b, clone(options)),
      duel,
      board: r.board,
      deadline: null,
      winners: null,
    },
    server: { board: r.server ?? null },
    secrets: { ...(r.secrets ?? {}) },
  }
}

/** Fin de manche (miroir de _duel_end_game + _duel_end_duel en best_of 1). */
function endGame<B, M>(state: DuelState<B, M>, outcome: 'win' | 'draw', winner: string | null, game: unknown): DuelState<B, M> {
  const d = { ...(state.duel as DuelInfo<M>) }
  if (outcome === 'win' && (!winner || (winner !== d.a && winner !== d.b))) fail('invalid_board')
  const wins = { ...d.wins }
  if (outcome === 'win' && winner) wins[winner] = (wins[winner] ?? 0) + 1
  const rec: DuelInfo['games'][number] & { x?: unknown } = { no: d.game_no, starter: d.starter, winner: outcome === 'win' ? winner : null, moves: d.moves }
  if (game !== undefined) rec.x = game
  const w = outcome === 'win' ? winner : null
  return {
    ...state,
    phase: 'result',
    duel: {
      ...d,
      wins,
      outcome,
      winner: w,
      turn: null,
      games: [...d.games, rec],
      result: { winner: w, draw: w === null, advanced: null, bets_right: [] },
    },
  }
}

function applyHook<B, M>(
  x: SoloX<B, M>,
  r: HookResult<B>,
  actor: string,
  move: M,
  offturn: boolean,
): SoloStep<B, M> {
  const out = r.outcome ?? null
  if (out !== null && out !== 'win' && out !== 'draw') fail('invalid_board')
  const server = 'server' in r ? { board: r.server ?? null } : x.server
  const d0 = x.state.duel as DuelInfo<M>
  let d: DuelInfo<M> = {
    ...d0,
    moves: offturn ? d0.moves : d0.moves + 1,
    last_move: { by: actor, move: clone(move), auto: false },
  }
  let state: DuelState<B, M> = { ...x.state, board: r.board, duel: d }
  if (out) {
    state = endGame(state, out, r.winner ?? null, r.game)
  } else if (!offturn) {
    const turn = r.turn ?? (actor === d.a ? d.b : d.a)
    if (turn !== d.a && turn !== d.b) fail('invalid_board')
    d = { ...d, turn }
    state = { ...state, duel: d }
  }
  const changed = r.secrets && Object.keys(r.secrets).length ? r.secrets : null
  return { state, server, secrets: changed ? { ...x.secrets, ...changed } : x.secrets, changed }
}

function setupCall<B, M>(game: LocalDuelGame<B, M>, x: SoloX<B, M>, actor: string | null, move: SoloAction) {
  if (!game.boardSetup) return { x, changed: {} as Record<string, unknown> }
  const r = game.boardSetup(x.state.board as B, x.server.board, actor, move)
  const server = 'server' in r ? { board: r.server ?? null } : x.server
  const changed = r.secrets ?? {}
  return { x: { state: { ...x.state, board: r.board }, server, secrets: { ...x.secrets, ...changed } }, changed }
}

/**
 * Applique l'action `action` de `actor` (miroir de _duel_action pour 'move' et 'ready').
 * Ne mute pas `x`. Lève Error(code) si l'action est refusée.
 */
export function soloAct<B, M>(game: LocalDuelGame<B, M>, x0: SoloX<B, M>, actor: string, action: SoloAction): SoloStep<B, M> {
  const x = clone(x0)
  const phase = x.state.phase
  const d = x.state.duel as DuelInfo<M>
  if (!['transition', 'setup', 'playing', 'result'].includes(phase)) fail('wrong_phase')
  const duelist = actor === d.a || actor === d.b

  if (action.type === 'move') {
    if (!duelist) fail('not_duelist')
    const move = action.move as M
    if (move === null || typeof move !== 'object' || Array.isArray(move)) fail('invalid_move')
    if (phase === 'playing') {
      if (d.turn !== actor) {
        if (!game.boardOffturn) fail('not_your_turn')
        const r = game.boardOffturn!(x.state.board as B, x.server.board, actor, move)
        if (!r || typeof r.board !== 'object' || r.board === null) fail('invalid_board')
        return applyHook(x, r, actor, move, true)
      }
      return applyHook(x, game.boardMove(x.state.board as B, x.server.board, actor, move), actor, move, false)
    }
    if (phase === 'setup') {
      if (d.ready.includes(actor)) fail('already_ready')
      const t = (move as { type?: unknown }).type
      if (t === 'ready' || t === 'auto' || t === 'begin') fail('invalid_move')
      const s = setupCall(game, x, actor, move as unknown as SoloAction)
      return { ...s.x, changed: Object.keys(s.changed).length ? s.changed : null }
    }
    return fail('wrong_phase')
  }

  if (action.type === 'ready') {
    if (!duelist) fail('not_duelist')
    if (phase !== 'setup') fail('wrong_phase')
    if (d.ready.includes(actor)) fail('already_ready')
    const s = setupCall(game, x, actor, { type: 'ready' })
    let cur = s.x
    let changed = s.changed
    const ready = [...d.ready, actor]
    cur = { ...cur, state: { ...cur.state, duel: { ...(cur.state.duel as DuelInfo<M>), ready } } }
    if (ready.length >= 2) {
      const b = setupCall(game, cur, null, { type: 'begin' })
      cur = b.x
      changed = { ...changed, ...b.changed }
      const dd = cur.state.duel as DuelInfo<M>
      cur = { ...cur, state: { ...cur.state, phase: 'playing', duel: { ...dd, turn: dd.starter } } }
    }
    return { ...cur, changed: Object.keys(changed).length ? changed : null }
  }

  return fail('unknown_action')
}
