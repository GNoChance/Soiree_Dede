// Tests SQL du calendrier de l'Avent (PGlite) : node advent.mjs ../../supabase/install.sql
import { bootDb } from './boot.mjs'

const file = process.argv[2]
if (!file) throw new Error('usage : node advent.mjs <install.sql>')
const db = await bootDb(file)
let failed = false
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK   ' : 'ÉCHEC'} ${name}${cond ? '' : ' ' + extra}`)
  if (!cond) failed = true
}
const U = 'aaaaaaaa-0000-0000-0000-000000000001'
const A = (await db.query(`select id from public.profiles order by sort_order limit 1`)).rows[0].id
await db.query(`insert into public.device_sessions(auth_uid, profile_id) values ($1, $2)`, [U, A])
const call = async (q, p = []) => {
  await db.query(`select set_config('app.uid', $1, false)`, [U])
  try { return { r: (await db.query(q, p)).rows[0]?.r } } catch (e) { return { err: e.message } }
}
// date fixée au 5 décembre 2026
await db.query(`create or replace function public._daily_day() returns date language sql stable as $$ select date '2026-12-05' $$`)
const open = (d) => call(`select public.advent_open($1::date) r`, [d])
const xp = async () => Number((await db.query(`select xp from public.profiles where id = $1`, [A])).rows[0].xp)
const run = (d) => db.query(`insert into public.daily_runs(profile_id, day, finished_at, score) values ($1, $2, now(), 100) on conflict do nothing`, [A, d])

ok('jour hors avent refusé', (await open('2026-12-25')).err?.includes('advent_invalid_day'))
ok('jour futur refusé', (await open('2026-12-06')).err?.includes('advent_not_yet'))
ok('défi non fait = raté', (await open('2026-12-03')).err?.includes('advent_missed'))
await run('2026-12-05')
const x0 = await xp()
const r1 = await open('2026-12-05')
ok('ouverture +25 XP', r1.r?.new === true && r1.r.xp === 25 && (await xp()) === x0 + 25, JSON.stringify(r1))
const r2 = await open('2026-12-05')
ok('idempotent (0 XP)', r2.r?.new === false && r2.r.xp === 0 && (await xp()) === x0 + 25, JSON.stringify(r2))
const st = (await call(`select public.advent_state() r`)).r
ok('état : 1 ouverte, 1 faite', st.opened.length === 1 && st.done.length === 1 && st.year === 2026, JSON.stringify(st))
// 12 cases -> trophée + tenue lutin
for (let d = 10; d <= 19; d++) await db.query(`insert into public.advent_opens(profile_id, day) values ($1, $2) on conflict do nothing`, [A, `2026-12-${d}`])
const cnt = Number((await db.query(`select count(*) c from public.advent_opens where profile_id = $1`, [A])).rows[0].c)
ok('11 cases avant la dernière', cnt === 11, String(cnt))
await run('2026-12-04')
const r12 = await open('2026-12-04')
ok('12e case : trophée', r12.r?.trophy === true && r12.r.count === 12, JSON.stringify(r12))
const t = (await db.query(`select 1 from public.tenue_unlocks where profile_id = $1 and tenue_id = 'lutin'`, [A])).rows
ok('tenue lutin débloquée', t.length === 1)
await db.query(`create or replace function public._daily_day() returns date language sql stable as $$ select date '2027-01-10' $$`)
ok('après le 6 janvier : fermé', (await open('2026-12-05')).err?.includes('advent_closed'))
process.exit(failed ? 1 : 0)
