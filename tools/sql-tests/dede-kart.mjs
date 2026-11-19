// Tests du moteur SQL de Dédé Kart (PGlite) : circuits (choix, enchaînement), temps minimum par tour, objets, fin de course.
// Usage : node dede-kart.mjs ../../supabase/install.sql
import { bootDb } from './boot.mjs'

const file = process.argv[2]
if (!file) throw new Error('usage : node dede-kart.mjs <install.sql>')
const db = await bootDb(file)
const ids = (await db.query(`select id from public.profiles order by sort_order limit 3`)).rows.map((r) => r.id)
let ok = 0, ko = 0
const check = (name, cond, extra = '') => { cond ? ok++ : ko++; console.log(cond ? 'OK   ' : 'ÉCHEC', name, extra) }
const start = async (o) => (await db.query(`select public.game_dede_kart_start($1::uuid[], $2::jsonb) r`, [`{${ids.join(',')}}`, JSON.stringify(o)])).rows[0].r.state
const act = async (state, actor, a, host = false) => (await db.query(`select public.game_dede_kart_action($1::jsonb, '{}'::jsonb, $2::uuid, $3, $4::jsonb) r`, [JSON.stringify(state), actor, host, JSON.stringify(a)])).rows[0].r
const fails = async (state, actor, a, code) => { try { await act(state, actor, a); return false } catch (e) { return String(e.message).includes(code) } }

let s = await start({ track: 4, races: 3, laps: 2, fill: 6 })
check('circuit de départ choisi', s.track === 4 && s.track0 === 4, `track=${s.track}`)
check('3 bots', s.bots.length === 3)
const seen = new Set()
for (let k = 0; k < 40; k++) seen.add((await start({ track: -1 })).track)
check('circuit surprise : tirage 0..5', [...seen].every((t) => t >= 0 && t <= 5) && seen.size >= 4, [...seen].sort().join(','))
check('option invalide → hasard', (await start({ track: 9 })).track <= 5)
for (const [t, ms] of [[0, 31000], [1, 34000], [2, 34000], [3, 31000], [4, 33000], [5, 32000]]) {
  const r = (await db.query(`select public._dk_min_lap_ms($1) v`, [t])).rows[0].v
  check(`temps mini circuit ${t}`, r === ms, r)
}
// tour trop rapide puis valide
const back = (st, secs) => ({ ...st, go_at: new Date(Date.now() - secs * 1000).toISOString() })
check('tour avant le feu vert refusé', await fails(s, ids[0], { type: 'lap', lap: 1 }, 'too_early'))
check('tour en 20 s refusé (too_fast)', await fails(back(s, 20), ids[0], { type: 'lap', lap: 1 }, 'too_fast'))
let r = await act(back(s, 50), ids[0], { type: 'lap', lap: 1 })
check('tour en 50 s accepté', r.state.laps_done[ids[0]] === 1)
s = r.state
check('2e tour immédiat refusé', await fails(s, ids[0], { type: 'lap', lap: 2 }, 'too_fast'))
// objets
for (const item of ['butter', 'hen', 'glue', 'ball']) {
  r = await act(s, ids[1], { type: 'use', item, x: 10.5, z: -3, h: 1.2 })
  s = r.state
  check(`piège ${item} posé`, s.hazards.at(-1).type === item && s.hazards.at(-1).owner === ids[1])
}
r = await act(s, ids[1], { type: 'use', item: 'honk', targets: [ids[0], ids[2], 'bot1', ids[1], 'inconnu'] })
s = r.state
check('klaxon : 3 cibles valides (pas soi-même)', s.fx.filter((f) => f.type === 'honk').length === 3 && s.used[ids[1]].honk === 1)
check('objet inconnu refusé', await fails(s, ids[1], { type: 'use', item: 'banane', x: 0, z: 0, h: 0 }, 'invalid_action'))
const hen = s.hazards.find((h) => h.type === 'hen').id
r = await act(s, ids[0], { type: 'hit', hazard: hen })
s = r.state
check('poule percutée : retirée, touche comptée', !s.hazards.some((h) => h.id === hen) && s.hits[ids[1]] === 1 && s.taken[ids[0]] === 1)
// fin de course : 45 s après le 1er, circuit suivant
let t = back(s, 120)
t.lap_at = { [ids[0]]: new Date(Date.now() - 60000).toISOString() }
r = await act(t, ids[0], { type: 'lap', lap: 2 })
const dl = (Date.parse(r.state.deadline) - Date.now()) / 1000
check('arrivée du 1er : échéance à 45 s', r.state.arrival[0] === ids[0] && dl > 43 && dl <= 45.5, dl.toFixed(1))
r = await act({ ...r.state, deadline: new Date(Date.now() - 1000).toISOString() }, ids[1], { type: 'tick' })
check('fin de course → résultats', r.state.phase === 'results' && r.state.standings.length === 1 && r.state.standings[0].track === 4)
r = await act(r.state, ids[0], { type: 'next' }, true)
check('course 2 : circuit suivant (5)', r.state.phase === 'racing' && r.state.race === 2 && r.state.track === 5)
r = await act({ ...r.state, deadline: new Date(Date.now() - 1000).toISOString() }, ids[1], { type: 'tick' })
r = await act(r.state, ids[0], { type: 'next' }, true)
check('course 3 : retour au circuit 0', r.state.race === 3 && r.state.track === 0)
// trophées : victoire sur le circuit 4 = win_track_5
const st = (await db.query(`select public._dk_tstats($1::jsonb, $2) v`, [JSON.stringify(r.state), ids[0]])).rows[0].v
check('stats : win_track_5 = 1 (circuit 4)', st.win_track_5 === 1 && st.win_track_1 === 0, JSON.stringify(st))
console.log(`\n${ok} OK, ${ko} échec(s)`)
process.exit(ko ? 1 : 0)
