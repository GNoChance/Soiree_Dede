// Synchro TS <-> SQL du mode solo (PGlite) : node solo-sync.mjs ../../supabase/install.sql
// Parties aléatoires jouées en parallèle sur le moteur SQL (game_<id>_action, mode duel, 1 manche)
// et sur le moteur local TS (src/features/solo/engine.ts + src/games/<id>/local.ts) :
// phase, plateau, duel, part serveur, secrets et codes d'erreur identiques à chaque coup.
import { bootDb } from './boot.mjs'
import { loadSolo } from './solo-bundle.mjs'

const file = process.argv[2]
if (!file) throw new Error('usage : node solo-sync.mjs <install.sql>')
const S = await loadSolo()
const db = await bootDb(file)

let failed = false
let checks = 0
const ok = (name, cond, extra = '') => {
  checks++
  if (!cond || process.env.VERBOSE) console.log(`${cond ? 'OK   ' : 'ÉCHEC'} ${name}${cond ? '' : ' ' + extra}`)
  if (!cond) failed = true
  return cond
}
const q1 = async (sql, params = []) => (await db.query(sql, params)).rows[0]
const P = (await db.query(`select id from public.profiles order by sort_order limit 2`)).rows.map((r) => r.id)

// Générateur pseudo-aléatoire reproductible (SEED=… pour rejouer).
let seed = Number(process.env.SEED ?? 20261120)
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x80000000
}
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]

// Égalité JSON indépendante de l'ordre des clés ; turn_started_at (horloge) ignoré.
const canon = (v) => {
  if (Array.isArray(v)) return v.map(canon)
  if (v && typeof v === 'object') {
    const o = {}
    for (const k of Object.keys(v).sort()) if (k !== 'turn_started_at') o[k] = canon(v[k])
    return o
  }
  return v === undefined ? null : v
}
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b))
/** Écart lisible : seulement les clés qui diffèrent (objets), sinon les deux valeurs. */
const diff = (a, b) => {
  const ca = canon(a)
  const cb = canon(b)
  if (ca && cb && typeof ca === 'object' && typeof cb === 'object' && !Array.isArray(ca)) {
    const keys = [...new Set([...Object.keys(ca), ...Object.keys(cb)])].filter((k) => JSON.stringify(ca[k]) !== JSON.stringify(cb[k]))
    return keys.map((k) => `\n  [${k}] SQL: ${JSON.stringify(ca[k])?.slice(0, 400)}\n  [${k}] TS : ${JSON.stringify(cb[k])?.slice(0, 400)}`).join('')
  }
  return `\n  SQL: ${JSON.stringify(ca)?.slice(0, 600)}\n  TS : ${JSON.stringify(cb)?.slice(0, 600)}`
}
const DUEL_KEYS = ['a', 'b', 'first', 'starter', 'turn', 'game_no', 'wins', 'games', 'moves', 'last_move', 'outcome', 'winner', 'ready']
const duelView = (d) => {
  const o = Object.fromEntries(DUEL_KEYS.map((k) => [k, d?.[k] ?? null]))
  o.result = d?.result ? { winner: d.result.winner, draw: d.result.draw } : null
  return o
}

const sqlAct = async (gid, x, actor, action, host = false) => {
  const fn = `game_${gid.replace(/-/g, '_')}_action`
  try {
    const r = (await db.query(`select public.${fn}($1::jsonb, $2::jsonb, $3::uuid, $4, $5::jsonb) r`,
      [JSON.stringify(x.state), JSON.stringify(x.server), actor, host, JSON.stringify(action)])).rows[0].r
    return { state: r.state, server: r.server, secrets: r.secrets ?? null }
  } catch (e) {
    return { err: e.message }
  }
}
const sqlStart = async (gid, board) => {
  const fn = `game_${gid.replace(/-/g, '_')}_start`
  const r = (await q1(`select public.${fn}($1::uuid[], $2::jsonb) r`,
    [`{${P.join(',')}}`, JSON.stringify({ mode: 'duel', duel_players: P, best_of: 1, board })])).r
  return sqlAct(gid, { state: r.state, server: r.server }, P[0], { type: 'next' }, true)
}
const tsAct = (L, x, actor, action) => {
  try {
    const r = S.soloAct(L.local, x, actor, action)
    return { x: r, changed: r.changed }
  } catch (e) {
    return { err: e.message }
  }
}

/** Compare SQL et TS après une étape ; renvoie false (et arrête la partie) au premier écart. */
function compare(label, sql, ts, { secrets = true, server = true } = {}) {
  if (sql.err || ts.err) return ok(`${label} : même erreur`, sql.err === ts.err, `SQL=${sql.err} TS=${ts.err}`)
  const a = sql.state
  const b = ts.x.state
  return (
    ok(`${label} : phase`, a.phase === b.phase, `${a.phase} / ${b.phase}`) &&
    ok(`${label} : plateau`, same(a.board, b.board), diff(a.board, b.board)) &&
    ok(`${label} : duel`, same(duelView(a.duel), duelView(b.duel)), diff(duelView(a.duel), duelView(b.duel))) &&
    (!server || ok(`${label} : serveur`, same(sql.server?.board ?? null, ts.x.server.board), diff(sql.server?.board, ts.x.server.board))) &&
    (!secrets || ok(`${label} : secrets`, same(sql.secrets ?? null, ts.changed ?? null), diff(sql.secrets, ts.changed)))
  )
}

/**
 * Joue `games` parties : `legal(x)` -> liste d'actions légales [{actor, action}],
 * `bad(x)` -> action probablement refusée (ou null). `prep(sql, ts)` : préparation commune.
 */
async function run(gid, L, { games, board = () => ({}), maxSteps = 500, legal, bad, prep, badRate = 0.12 }) {
  const stats = { games: 0, steps: 0, errors: 0, ends: {} }
  for (let g = 0; g < games; g++) {
    const opts = board(g)
    let sql = await sqlStart(gid, opts)
    if (!ok(`${gid} #${g} : départ SQL`, !sql.err, sql.err)) return stats
    const d = sql.state.duel
    let ts = { x: S.soloStart(L.local, { a: d.a, b: d.b, first: d.first, options: opts }), changed: null }
    ts.changed = Object.keys(ts.x.secrets).length ? ts.x.secrets : null
    const random = !!prep
    if (!compare(`${gid} #${g} départ`, sql, ts, { secrets: !random, server: !random })) return stats
    if (prep) {
      const r = await prep(sql, ts)
      if (!r) return stats
      ;({ sql, ts } = r)
    }
    let alive = true
    for (let step = 0; alive && step < maxSteps && sql.state.phase === 'playing'; step++) {
      const x = { state: sql.state, server: sql.server }
      const b = rnd() < badRate ? bad(sql.state) : null
      const { actor, action } = b ?? pick(legal(sql.state))
      const s2 = await sqlAct(gid, x, actor, action)
      const t2 = tsAct(L, ts.x, actor, action)
      alive = compare(`${gid} #${g} coup ${step} ${JSON.stringify(action)}`, s2, t2)
      stats.steps++
      if (s2.err) {
        stats.errors++
        continue
      }
      sql = s2
      ts = t2
    }
    if (!alive) return stats
    stats.games++
    const end = sql.state.board?.end?.reason ?? sql.state.duel.outcome ?? sql.state.phase
    stats.ends[end] = (stats.ends[end] ?? 0) + 1
  }
  return stats
}
const report = (name, st) => console.log(`${failed ? 'ÉCHEC' : 'OK   '} ${name} : ${st.games} parties, ${st.steps} actions (dont ${st.errors} refusées), fins ${JSON.stringify(st.ends)}`)
const other = (s, id) => (id === s.duel.a ? s.duel.b : s.duel.a)

// ----------------------------------------------------------------------------- Morpion
{
  const legal = (s) => S.morpion.legalMoves(s.board).map((cell) => ({ actor: s.duel.turn, action: { type: 'move', move: { cell } } }))
  const bad = (s) => {
    const taken = s.board.cells.findIndex((v) => v !== null)
    return pick([
      { actor: other(s, s.duel.turn), action: { type: 'move', move: { cell: S.morpion.legalMoves(s.board)[0] } } },
      { actor: s.duel.turn, action: { type: 'move', move: { cell: s.board.size * s.board.size } } },
      { actor: s.duel.turn, action: { type: 'move', move: { cell: 0, x: 1 } } },
      { actor: s.duel.turn, action: { type: 'move', move: { cell: '1' } } },
      { actor: s.duel.turn, action: { type: 'move', move: { cell: 1.5 } } },
      { actor: s.duel.turn, action: { type: 'ready' } },
      taken >= 0 ? { actor: s.duel.turn, action: { type: 'move', move: { cell: taken } } } : null,
      s.board.variant === 'ultimate' && s.board.next !== null
        ? { actor: s.duel.turn, action: { type: 'move', move: { cell: ((s.board.next + 1) % 9) * 9 + 4 } } }
        : null,
    ].filter(Boolean))
  }
  const variants = ['classic', 'giant', 'ultimate']
  const st = await run('morpion', S.morpion, { games: 120, board: (g) => ({ variant: variants[g % 6 === 5 ? 1 : g % 3 === 1 ? 2 : 0] }), legal, bad })
  report('Morpion (classique, géant, ultime)', st)
}

// ----------------------------------------------------------------------------- 4 à la suite
{
  const legal = (s) => S.q4.legalMoves(s.board).map((col) => ({ actor: s.duel.turn, action: { type: 'move', move: { col } } }))
  const bad = (s) => {
    const full = s.board.cols.findIndex((c) => c.length >= 6)
    return pick([
      { actor: other(s, s.duel.turn), action: { type: 'move', move: { col: 3 } } },
      { actor: s.duel.turn, action: { type: 'move', move: { col: 7 } } },
      { actor: s.duel.turn, action: { type: 'move', move: { col: '2' } } },
      { actor: s.duel.turn, action: { type: 'move', move: [] } },
      full >= 0 ? { actor: s.duel.turn, action: { type: 'move', move: { col: full } } } : null,
    ].filter(Boolean))
  }
  report('4 à la suite', await run('quatre-a-la-suite', S.q4, { games: 120, legal, bad }))

  // Grille pleine (nul) : rare au hasard -> on cherche une partie nulle sur le moteur TS, puis on la rejoue sur les deux.
  let cols = null
  for (let g = 0; g < 50000 && !cols; g++) {
    let x = S.soloStart(S.q4.local, { a: P[0], b: P[1], first: P[0] })
    const seq = []
    while (x.state.phase === 'playing') {
      const col = pick(S.q4.legalMoves(x.state.board))
      seq.push(col)
      x = S.soloAct(S.q4.local, x, x.state.duel.turn, { type: 'move', move: { col } })
    }
    if (x.state.duel.outcome === 'draw') cols = seq
  }
  if (ok('4 à la suite : une partie nulle trouvée', !!cols)) {
    let sql = await sqlStart('quatre-a-la-suite', {})
    const d = sql.state.duel
    let ts = { x: S.soloStart(S.q4.local, { a: d.a, b: d.b, first: d.first }), changed: null }
    let good = true
    for (const col of cols) {
      if (!good) break
      const action = { type: 'move', move: { col } }
      const s2 = await sqlAct('quatre-a-la-suite', { state: sql.state, server: sql.server }, sql.state.duel.turn, action)
      const t2 = tsAct(S.q4, ts.x, sql.state.duel.turn, action)
      good = compare(`4 à la suite (nul) col ${col}`, s2, t2)
      sql = s2
      ts = t2
    }
    if (good) ok('4 à la suite : grille pleine -> nul identique', sql.state.duel.outcome === 'draw' && sql.state.phase === 'result')
    console.log(`${failed ? 'ÉCHEC' : 'OK   '} 4 à la suite : partie nulle (42 jetons) identique`)
  }
}

// ----------------------------------------------------------------------------- Bataille navale
{
  const target = (s) => other(s, s.duel.turn)
  const legal = (s) => S.bn.legalMoves(s.board, s.duel.turn).map(({ x, y }) => ({ actor: s.duel.turn, action: { type: 'move', move: { x, y } } }))
  const bad = (s) => {
    const shot = s.board.waters[target(s)].shots[0]
    return pick([
      { actor: target(s), action: { type: 'move', move: { x: 0, y: 0 } } },
      { actor: s.duel.turn, action: { type: 'move', move: { x: 10, y: 0 } } },
      { actor: s.duel.turn, action: { type: 'move', move: { x: 1, y: 1, z: 0 } } },
      { actor: s.duel.turn, action: { type: 'move', move: { type: 'shuffle' } } },
      shot ? { actor: s.duel.turn, action: { type: 'move', move: { x: shot.x, y: shot.y } } } : null,
    ].filter(Boolean))
  }
  // Préparation : la flotte tirée par board_new est aléatoire des deux côtés -> chacun place la même flotte
  // (aléatoire, contact permis) sur les deux moteurs, avec quelques refus, puis « Prêt ».
  const anyFleet = () => {
    for (;;) {
      const fleet = S.bn.SHIP_DEFS.map((d) => {
        const dir = rnd() < 0.5 ? 'h' : 'v'
        const len = 10 - d.size + 1
        return { id: d.id, x: Math.floor(rnd() * (dir === 'h' ? len : 10)), y: Math.floor(rnd() * (dir === 'v' ? len : 10)), dir }
      })
      if (S.bn.fleetErrorOf(fleet) === null) return fleet
    }
  }
  const prep = async (sql, ts) => {
    // board_new (TS) : flottes valides et sans contact, secrets cohérents
    for (const p of P) {
      const f = ts.x.server.board.fleets[p]
      const e = (await q1(`select public._bn_fleet_error($1::jsonb) e`, [JSON.stringify(f)])).e
      if (!ok('bn : flotte aléatoire TS valide (SQL)', e === null, e)) return null
      ok('bn : flotte aléatoire TS sans contact', !S.bn.fleetTouchesOf(f))
      ok('bn : secret TS = flotte serveur', same(ts.x.secrets[p].fleet, f) && ts.x.secrets[p].me === p)
    }
    // Même point de départ (flottes tirées par le SQL) pour la suite.
    ts = { x: { ...ts.x, server: structuredClone(sql.server), secrets: structuredClone(sql.secrets ?? {}) }, changed: null }
    const steps = []
    for (const p of P) {
      steps.push([p, { type: 'move', move: { type: 'place', ships: [] } }])
      steps.push([p, { type: 'move', move: { type: 'place', ships: anyFleet().map((s, i) => (i === 1 ? { ...s, x: 0, y: 0, dir: 'h' } : i === 0 ? { ...s, x: 0, y: 0, dir: 'v' } : s)) } }])
      steps.push([p, { type: 'move', move: { type: 'place', ships: anyFleet() } }])
    }
    steps.push([P[0], { type: 'move', move: { x: 0, y: 0 } }])
    steps.push([P[0], { type: 'ready' }])
    steps.push([P[0], { type: 'ready' }])
    steps.push([P[0], { type: 'move', move: { type: 'place', ships: anyFleet() } }])
    steps.push([P[1], { type: 'move', move: { type: 'ready' } }])
    steps.push([P[1], { type: 'ready' }])
    for (const [actor, action] of steps) {
      const s2 = await sqlAct('bataille-navale', { state: sql.state, server: sql.server }, actor, action)
      const t2 = tsAct(S.bn, ts.x, actor, action)
      if (!compare(`bn préparation ${JSON.stringify(action).slice(0, 60)}`, s2, t2)) return null
      if (!s2.err) {
        sql = s2
        ts = t2
      }
    }
    return ok('bn : préparation -> playing', sql.state.phase === 'playing') ? { sql, ts } : null
  }
  report('Bataille navale', await run('bataille-navale', S.bn, { games: 25, legal, bad, prep }))
}

// ----------------------------------------------------------------------------- Échecs (sans pendule)
{
  const SQ = (s) => (8 - Number(s[1])) * 8 + (s.charCodeAt(0) - 97)
  const mover = (s) => (s.board.side === 'w' ? s.board.white : s.board.black)
  const legal = (s) => {
    const out = S.echecs.legalMoves(s.board).map((m) => ({ actor: mover(s), action: { type: 'move', move: rnd() < 0.002 ? { ...m, offer_draw: rnd() < 0.8 } : m } }))
    if (s.board.draw_offer && s.board.draw_offer !== mover(s) && rnd() < 0.5) return [{ actor: mover(s), action: { type: 'move', move: { type: 'accept_draw' } } }]
    if (rnd() < 0.0005) return [{ actor: pick([s.board.white, s.board.black]), action: { type: 'move', move: { type: 'resign' } } }]
    return out
  }
  const bad = (s) => {
    const ms = S.echecs.legalMoves(s.board)
    const m = ms[0]
    const promo = ms.find((x) => x.promo)
    return pick([
      { actor: other(s, mover(s)), action: { type: 'move', move: m } },
      { actor: other(s, mover(s)), action: { type: 'move', move: { type: 'accept_draw' } } },
      { actor: mover(s), action: { type: 'move', move: { from: m.from, to: m.from } } },
      { actor: mover(s), action: { type: 'move', move: { ...m, x: 1 } } },
      { actor: mover(s), action: { type: 'move', move: { from: 64, to: 1 } } },
      { actor: mover(s), action: { type: 'move', move: { from: '12', to: 28 } } },
      { actor: mover(s), action: { type: 'move', move: { type: 'flag' } } },
      { actor: mover(s), action: { type: 'move', move: { type: 'accept_draw' } } },
      { actor: mover(s), action: { type: 'move', move: { from: m.from, to: m.to, promo: 'q' } } },
      { actor: mover(s), action: { type: 'move', move: { ...m, offer_draw: 1 } } },
      promo ? { actor: mover(s), action: { type: 'move', move: { from: promo.from, to: promo.to } } } : null,
      promo ? { actor: mover(s), action: { type: 'move', move: { from: promo.from, to: promo.to, promo: 'k' } } } : null,
    ].filter(Boolean))
  }
  const t0 = Date.now()
  report('Échecs (parties aléatoires)', await run('echecs', S.echecs, { games: 30, board: () => ({ cadence: 'none' }), maxSteps: 700, legal, bad, badRate: 0.08 }))

  // Fins scriptées : mat du berger, pat de Loyd, répétition, nulle proposée, abandon hors de son tour.
  const scripted = [
    ['mat', 'f2f3 e7e5 g2g4 d8h4'],
    ['pat', 'e2e3 a7a5 d1h5 a8a6 h5a5 h7h5 h2h4 a6h6 a5c7 f7f6 c7d7 e8f7 d7b7 d8d3 b7b8 d3h7 b8c8 f7g6 c8e6'],
    ['répétition', 'g1f3 g8f6 f3g1 f6g8 g1f3 g8f6 f3g1 f6g8'],
    ['promotion', 'h2h4 g7g5 h4g5 h7h6 g5h6 f8g7 h6g7 g8f6 g7h8q'],
    ['prise en passant + roques', 'e2e4 a7a6 e4e5 d7d5 e5d6 e7d6 g1f3 c8g4 f1e2 b8c6 e1g1 d8d7 d2d3 e8c8'],
  ]
  for (const [name, list] of scripted) {
    let sql = await sqlStart('echecs', { cadence: 'none' })
    const d = sql.state.duel
    let ts = { x: S.soloStart(S.echecs.local, { a: d.a, b: d.b, first: d.first, options: { cadence: 'none' } }), changed: null }
    let good = compare(`échecs ${name} : départ`, sql, ts, { secrets: false })
    for (const mv of list.split(' ')) {
      if (!good) break
      const move = { from: SQ(mv.slice(0, 2)), to: SQ(mv.slice(2, 4)), ...(mv[4] ? { promo: mv[4] } : {}) }
      const action = { type: 'move', move }
      const s2 = await sqlAct('echecs', { state: sql.state, server: sql.server }, mover(sql.state), action)
      const t2 = tsAct(S.echecs, ts.x, mover(sql.state), action)
      good = compare(`échecs ${name} ${mv}`, s2, t2) && ok(`échecs ${name} ${mv} accepté`, !s2.err, s2.err)
      sql = s2
      ts = t2
    }
    if (good && name === 'pat') ok('échecs : pat de Loyd -> stalemate', sql.state.board.end?.reason === 'stalemate', JSON.stringify(sql.state.board.end))
    if (good && name === 'mat') ok('échecs : mat du berger -> mate', sql.state.board.end?.reason === 'mate')
    if (good && name === 'répétition') ok('échecs : triple répétition', sql.state.board.end?.reason === 'repetition', JSON.stringify(sql.state.board.end))
    if (good && name === 'prise en passant + roques') {
      // abandon hors de son tour (hook board_offturn)
      const loser = sql.state.board.side === 'w' ? sql.state.board.black : sql.state.board.white
      const s2 = await sqlAct('echecs', { state: sql.state, server: sql.server }, loser, { type: 'move', move: { type: 'resign' } })
      const t2 = tsAct(S.echecs, ts.x, loser, { type: 'move', move: { type: 'resign' } })
      if (compare('échecs : abandon hors de son tour', s2, t2)) ok('échecs : abandon -> resign', s2.state.board.end?.reason === 'resign')
    }
  }
  console.log(`${failed ? 'ÉCHEC' : 'OK   '} Échecs : fins scriptées (${Date.now() - t0} ms au total)`)
}

console.log(`${checks} vérifications.`)
if (failed) {
  console.log('\nDES TESTS ONT ÉCHOUÉ')
  process.exit(1)
}
console.log('\nTous les tests de synchro solo passent.')
