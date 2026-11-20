// Outils communs des tests solo 2a / 2b (sans base).
export const ME = 'humain'
export const BOT = 'bot'

export function mkTest() {
  let failed = 0
  let passed = 0
  const ok = (name, cond, extra = '') => {
    console.log(`${cond ? 'OK   ' : 'ÉCHEC'} ${name}${cond ? '' : ' ' + extra}`)
    if (cond) passed++
    else failed++
  }
  const section = (name) => console.log(`\n--- ${name}`)
  const done = (what) => {
    console.log(`\n${passed} OK, ${failed} échec(s)`)
    if (failed) {
      console.log(`\nDES TESTS ${what} ONT ÉCHOUÉ`)
      process.exit(1)
    }
    console.log(`\nTous les tests ${what} passent.`)
  }
  return { ok, section, done }
}

export function mkRng(seed = 7) {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x80000000
  }
}

/** Faux localStorage (Map), installé sur globalThis. */
export function fakeStorage() {
  const m = new Map()
  const s = {
    get length() {
      return m.size
    },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
    _map: m,
  }
  globalThis.localStorage = s
  return s
}

let logSeq = 0
/**
 * Joue une partie scriptée et renvoie son journal (même forme que useSoloMatch).
 * setup : [['me'|'bot', action]] ; moves : [['me'|'bot', move, learned?]].
 */
export function playLog(S, L, { game, first = 'me', perso = 'mika', level = 5, options = {}, setup = [], moves = [], ctx } = {}) {
  let x = S.soloStart(L.local, { a: ME, b: BOT, first: first === 'me' ? ME : BOT, options })
  const log = {
    id: `test-${++logSeq}-${Math.random().toString(36).slice(2, 6)}`,
    game,
    me: ME,
    bot: BOT,
    first: first === 'me' ? ME : BOT,
    perso,
    level,
    secret0: x.secrets[ME] ?? null,
    setup: [],
    x0: null,
    entries: [],
    outcome: null,
    ...(ctx !== undefined ? { ctx } : {}),
  }
  for (const [by, action] of setup) {
    x = S.soloAct(L.local, x, by === 'me' ? ME : BOT, action)
    log.setup.push({ by, action })
  }
  if (x.state.phase === 'playing') log.x0 = x
  for (const [by, move, learned] of moves) {
    const action = { type: 'move', move }
    x = S.soloAct(L.local, x, by === 'me' ? ME : BOT, action)
    log.entries.push({ by, action, ...(learned ? { learned } : {}) })
    if (x.state.phase === 'result') break
  }
  if (x.state.phase === 'result') {
    const w = x.state.duel.winner
    log.outcome = w === ME ? 'win' : w === BOT ? 'loss' : 'draw'
  }
  return { log, x }
}

/** Partie complète : `pickMe(board, x)` / `pickBot(board, x)` renvoient { move, learned? } ou un coup. */
export function autoLog(S, L, { game, first = 'me', level = 5, options = {}, setup = [], pickMe, pickBot, maxPly = 400, ctx }) {
  const { log, x: x1 } = playLog(S, L, { game, first, level, options, setup, ctx })
  let x = x1
  if (!log.x0) log.x0 = x
  for (let ply = 0; x.state.phase === 'playing' && ply < maxPly; ply++) {
    const turn = x.state.duel.turn
    const by = turn === ME ? 'me' : 'bot'
    const r = (by === 'me' ? pickMe : pickBot)(x.state.board, x)
    const move = r && typeof r === 'object' && 'move' in r ? r.move : r
    const learned = r && typeof r === 'object' && 'learned' in r ? r.learned : undefined
    const action = { type: 'move', move }
    x = S.soloAct(L.local, x, turn, action)
    log.entries.push({ by, action, ...(learned ? { learned } : {}) })
  }
  if (x.state.phase === 'result') {
    const w = x.state.duel.winner
    log.outcome = w === ME ? 'win' : w === BOT ? 'loss' : 'draw'
  }
  return { log, x }
}

/** Le premier moment de ce type (ou undefined). */
export const momentOf = (moments, type) => moments.find((m) => m.type === type)
/** Cases des marques `kind` sur toutes les étapes. */
export const marked = (m, kind) => (m?.steps ?? []).flatMap((s) => s.marks.filter((k) => k.kind === kind).flatMap((k) => k.cells))
