// Tests SQL du Wrapped annuel (PGlite) : node wrapped.mjs ../../supabase/install.sql
import { bootDb } from './boot.mjs'
const file = process.argv[2]
if (!file) throw new Error('usage : node wrapped.mjs <install.sql>')
const db = await bootDb(file)
let failed = false
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK   ' : 'ÉCHEC'} ${name}${cond ? '' : ' ' + extra}`)
  if (!cond) failed = true
}
const U = [1, 2, 3].map((i) => `aaaaaaaa-0000-0000-0000-00000000000${i}`)
const prof = (await db.query(`select id from public.profiles order by sort_order limit 3`)).rows
for (let i = 0; i < 3; i++) await db.query(`insert into public.device_sessions(auth_uid, profile_id) values ($1, $2)`, [U[i], prof[i].id])
const [A, B, C] = prof.map((p) => p.id)
const call = async (i, q, p = []) => {
  await db.query(`select set_config('app.uid', $1, false)`, [U[i]])
  try { return { r: (await db.query(q, p)).rows[0]?.r } } catch (e) { return { err: e.message } }
}
const sys = async (q, p = []) => (await db.query(q, p)).rows
const g = (await sys(`select id from public.games limit 1`).catch(() => [{ id: 'morpion' }]))[0]?.id ?? 'morpion'

const s1 = (await sys(`insert into public.soirees(code, host_id, status, started_at, ended_at) values ('WRP1', $1, 'ended', '2026-03-10 19:00+01', '2026-03-10 23:00+01') returning id`, [A]))[0].id
const s2 = (await sys(`insert into public.soirees(code, host_id, status, started_at, ended_at) values ('WRP2', $1, 'ended', '2026-05-02 20:00+02', '2026-05-02 21:00+02') returning id`, [A]))[0].id
const mk = async (sid, game, at, winner, loser, third) => {
  const m = (await sys(`insert into public.matches(soiree_id, game_id, status, finished_at) values ($1,$2,'finished',$3) returning id`, [sid, game, at]))[0].id
  await sys(`insert into public.match_players(match_id, profile_id, game_id, placement, won) values ($1,$2,$3,1,true),($1,$4,$3,2,false)`, [m, winner, game, loser])
  if (third) await sys(`insert into public.match_players(match_id, profile_id, game_id, placement, won) values ($1,$2,$3,3,false)`, [m, third, game])
}
await mk(s1, 'morpion', '2026-03-10 20:00+01', B, A)
await mk(s1, 'morpion', '2026-03-10 22:30+01', B, A, C)
await mk(s1, 'echecs', '2026-03-11 00:40+01', A, B)
await mk(s2, 'morpion', '2026-05-02 20:30+02', A, B)
await mk(s2, 'morpion', '2025-12-31 20:30+01', A, B) // hors année
const w = (await call(0, `select public.year_wrapped(2026) r`)).r
ok('appel sans erreur', w && w.year === 2026, JSON.stringify(w))
ok('4 parties dont 2 victoires', w?.games_played === 4 && w.wins === 2, JSON.stringify(w))
ok('2 soirées', w?.soirees === 2)
ok('jeu préféré morpion (3)', w?.favorite_game?.game_id === 'morpion' && w.favorite_game.played === 3)
ok('rival = B (2 défaites)', w?.rival?.profile_id === B && w.rival.losses === 2)
ok('complice = B', w?.buddy?.profile_id === B && w.buddy.together === 4)
ok('soirée la plus longue = 240 min', w?.longest_soiree?.minutes === 240)
ok('partie la plus tardive 00:40', w?.latest_match?.at === '00:40', JSON.stringify(w?.latest_match))
ok('personnalité renseignée', typeof w?.personality?.id === 'string', JSON.stringify(w?.personality))
ok('année invalide', (await call(0, `select public.year_wrapped(5) r`)).err?.includes('invalid_year'))
const e = (await call(0, `select public.year_wrapped(2020) r`)).r
ok('année vide → curieux', e?.games_played === 0 && e.personality.id === 'curieux' && e.favorite_game === null)
console.log(failed ? 'ÉCHECS' : 'TOUT OK')
process.exit(failed ? 1 : 0)
