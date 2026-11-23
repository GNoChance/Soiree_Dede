// Tests SQL du jeu « Bowling » (PGlite) : node bowling.mjs ../../supabase/install.sql
// Fin automatique quand il ne reste qu'un joueur (idle_deadline).
import { bootDb } from './boot.mjs'

const file = process.argv[2]
if (!file) throw new Error('usage : node bowling.mjs <install.sql>')
const db = await bootDb(file)

let failed = false
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK   ' : 'ÉCHEC'} ${name}${cond ? '' : ' ' + extra}`)
  if (!cond) failed = true
}
const P = (await db.query(`select id from public.profiles order by sort_order limit 9`)).rows.map((r) => r.id)
const [A, B, C] = P

const q = async (fn, args) => (await db.query(`select ${fn} r`, args)).rows[0].r
const start = (players, opts) => q('public.game_bowling_start($1::uuid[], $2::jsonb)', [`{${players.join(',')}}`, JSON.stringify(opts)])
const act = async (st, actor, action, host = false) =>
  q('public.game_bowling_action($1::jsonb, $2::jsonb, $3::uuid, $4, $5::jsonb)', [JSON.stringify(st.state), JSON.stringify(st.server), actor, host, JSON.stringify(action)])
const roll = (f, r) => ({ type: 'roll', frame: f, roll: r, pins_down_mask: 0 })
const iso = (sec) => new Date(Date.now() + sec * 1000).toISOString()
const approx = (v, sec) => {
  const d = (new Date(v).getTime() - Date.now()) / 1000
  return d > sec - 5 && d <= sec + 1
}
/** Joue toute la feuille (3 frames, 2 gouttières par frame) ; renvoie le dernier résultat. */
const playAll = async (st, who) => {
  for (let f = 1; f <= 3; f++) for (let r = 1; r <= 2; r++) st = await act(st, who, roll(f, r))
  return st
}

let st = await start([A, B, C], { frames: 3 })
ok('départ : pas d’échéance de fin auto', st.state.idle_deadline === null && st.state.time_limit === 0)
st = await playAll(st, A)
ok('1 fini sur 3 : pas d’échéance', st.state.phase === 'playing' && !st.state.idle_deadline)
st = await playAll(st, B)
ok('2 finis sur 3 : échéance ≈ +90 s', st.state.phase === 'playing' && approx(st.state.idle_deadline, 90), String(st.state.idle_deadline))
const early = await act(st, A, { type: 'tick' })
ok('tick avant l’échéance : rien', early.state.phase === 'playing')
const expired = { ...st, state: { ...st.state, idle_deadline: iso(-1) } }
const fin = await act(expired, A, { type: 'tick' })
ok('tick après l’échéance : fin forcée', fin.state.phase === 'finished' && fin.state.forced === true)
const rc = fin.results.find((x) => x.profile_id === C)
ok('absent : feuille comblée, 0 gouttière dans les stats serveur', fin.state.sheets[C].length === 3 && rc.stats.gutters === 0, JSON.stringify(rc?.stats))
const ra = fin.results.find((x) => x.profile_id === A)
ok('joueur ayant joué : 6 gouttières comptées', ra.stats.gutters === 6, JSON.stringify(ra?.stats))
const late = { ...st, state: { ...st.state, idle_deadline: iso(-10) } }
const lr = await act(late, C, roll(1, 1))
ok('lancer très en retard : fin forcée', lr.state.phase === 'finished')
const ok2 = await act({ ...st, state: { ...st.state, idle_deadline: iso(-1) } }, C, roll(1, 1))
ok('lancer dans la tolérance (3 s) : accepté', ok2.state.phase === 'playing')
const dup = await playAll(st, C)
ok('le dernier joue tout à temps : fin normale', dup.state.phase === 'finished' && dup.state.forced === false)

console.log(failed ? '\nÉCHEC' : '\nTout est OK')
process.exit(failed ? 1 : 0)
