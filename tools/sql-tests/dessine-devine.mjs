// Tests SQL « Dessine & devine » (PGlite) : node dessine-devine.mjs ../../supabase/install.sql
import { bootDb } from './boot.mjs'

const file = process.argv[2]
if (!file) throw new Error('usage : node dessine-devine.mjs <install.sql>')
const db = await bootDb(file)
let failed = false
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK   ' : 'ÉCHEC'} ${name}${cond ? '' : ' ' + extra}`)
  if (!cond) failed = true
}
const P = (await db.query(`select id from public.profiles order by sort_order limit 4`)).rows.map((r) => r.id)
const choices = Array.from({ length: 8 }, (_, i) => Array.from({ length: 3 }, (_, j) => ({ word: `mot${i}${j}abc`, aliases: [], difficulty: 1 + j })))
const start = async () =>
  (await db.query(`select public.game_dessine_devine_start($1::uuid[], $2::jsonb) r`, [`{${P.join(',')}}`, JSON.stringify({ rounds: 1, choices })])).rows[0].r
const act = async (st, actor, isHost, action) => {
  try {
    const r = (await db.query(`select public.game_dessine_devine_action($1::jsonb,$2::jsonb,$3::uuid,$4,$5::jsonb) r`,
      [JSON.stringify(st.state), JSON.stringify(st.server), actor, isHost, JSON.stringify(action)])).rows[0].r
    return { r }
  } catch (e) { return { err: e.message } }
}
const must = (x, l) => { if (x.err) throw new Error(l + ' : ' + x.err); return x.r }
const shift = (st, key, sec) => ({ ...st, state: { ...st.state, [key]: new Date(Date.now() - sec * 1000).toISOString() } })

let G = await start()
const drawer = G.state.drawer
const other = P.find((p) => p !== drawer)
G = must(await act(G, drawer, false, { type: 'choose_word', index: 0 }), 'choose')
ok('drawing : drawn=false + draw_check_at posé', G.state.phase === 'drawing' && G.state.drawn === false && !!G.state.draw_check_at)
const t0 = must(await act(G, other, false, { type: 'tick' }), 't0')
ok('tick avant 25 s : rien', t0.state.phase === 'drawing')
const idle = must(await act(shift(G, 'draw_check_at', 1), other, false, { type: 'tick' }), 'idle')
ok('tick après 25 s sans trait : tour passé (idle, skipped, word null? non)', idle.state.phase === 'reveal' && idle.state.last_turn.skipped === true && idle.state.last_turn.idle === true, JSON.stringify(idle.state.last_turn))
const idle2 = must(await act(idle, other, false, { type: 'tick' }), 'idle2')
ok('tick rejoué : idempotent', idle2.state.phase === 'reveal' && idle2.state.turn === idle.state.turn)
ok('drawing_started par un autre : ignoré', must(await act(G, other, false, { type: 'drawing_started' }), 'ds0').state.drawn === false)
const D = must(await act(G, drawer, false, { type: 'drawing_started' }), 'ds')
ok('drawing_started : drawn=true, draw_check_at null', D.state.drawn === true && D.state.draw_check_at === null)
const D2 = must(await act(D, drawer, false, { type: 'drawing_started' }), 'ds2')
ok('drawing_started rejoué : idempotent', JSON.stringify(D2.state) === JSON.stringify(D.state))
const D3 = must(await act(shift(D, 'started_at', 30), other, false, { type: 'tick' }), 'd3')
ok('dessinateur présent : tick à 25 s ne passe pas le tour', D3.state.phase === 'drawing')
// ancienne partie (sans draw_check_at) : jamais sautée
const old = { ...G, state: { ...G.state } }
delete old.state.draw_check_at; delete old.state.drawn
ok('ancienne partie sans drapeau : pas de saut', must(await act(old, other, false, { type: 'tick' }), 'old').state.phase === 'drawing')
// tour sauté en choosing : mot null
let C = await start()
const sk = must(await act(C, P[0], true, { type: 'skip_turn' }), 'skipc')
ok('skip en choosing : reveal, last_turn.word null, skipped', sk.state.phase === 'reveal' && sk.state.last_turn.word === null && sk.state.last_turn.skipped === true)

console.log(failed ? '\nÉCHEC' : '\nTout est OK')
process.exit(failed ? 1 : 0)
