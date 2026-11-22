// Tests SQL des cadeaux déco hors Avent (PGlite) : node cadeaux.mjs ../../supabase/install.sql
import { bootDb } from './boot.mjs'

const file = process.argv[2]
if (!file) throw new Error('usage : node cadeaux.mjs <install.sql>')
const db = await bootDb(file)
let failed = false
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK   ' : 'ÉCHEC'} ${name}${cond ? '' : ' ' + extra}`)
  if (!cond) failed = true
}
const U = 'aaaaaaaa-0000-0000-0000-000000000001'
const A = (await db.query(`select id from public.profiles order by sort_order limit 1`)).rows[0].id
await db.query(`insert into public.device_sessions(auth_uid, profile_id) values ($1, $2)`, [U, A])
const sync = async () => {
  await db.query(`select set_config('app.uid', $1, false)`, [U])
  try { return (await db.query(`select public.sync_my_items() r`)).rows[0].r } catch (e) { return { err: e.message } }
}

const s0 = await sync()
ok('rien au départ', Array.isArray(s0) && s0.length === 0, JSON.stringify(s0))

await db.query(`update public.profiles set xp = 1600 where id = $1`, [A]) // niveau 5
const s1 = await sync()
ok('niveau 5 : cadre bronze', JSON.stringify(s1) === '["f_bronze"]', JSON.stringify(s1))
ok('idempotent', (await sync()).length === 0)

await db.query(`insert into public.trophy_unlocks(profile_id, trophy_id) values ($1, 'gen_pipelette')`, [A])
const s2 = await sync()
ok('trophée Pipelette : cadre Bulles', JSON.stringify(s2) === '["f_bulles"]', JSON.stringify(s2))

// 9 puis 10 victoires de Dédé Kart (+ une victoire d'un autre jeu qui ne compte pas)
const so = (await db.query(`insert into public.soirees(code, host_id, status) values ('ZZZZ', $1, 'ended') returning id`, [A])).rows[0].id
const win = async (game, n) => {
  for (let i = 0; i < n; i++) {
    const m = (await db.query(`insert into public.matches(soiree_id, game_id, status, finished_at) values ($1, $2, 'finished', now() - interval '30 days') returning id`, [so, game])).rows[0].id
    await db.query(`insert into public.match_players(match_id, profile_id, game_id, placement, won) values ($1, $2, $3, 1, true)`, [m, A, game])
  }
}
await win('dede-kart', 9)
await win('bowling', 1)
const s3 = await sync()
ok('9 victoires : pas encore le bolide', !s3.includes('k_dore'), JSON.stringify(s3))
await win('dede-kart', 1)
const s4 = await sync()
ok('10 victoires : bolide doré', s4.includes('k_dore'), JSON.stringify(s4))
// les victoires d'il y a 30 jours font de A un champion de semaine passée
ok('champion d’une semaine passée : titre Patron', s3.includes('t_patron_semaine'), JSON.stringify(s3))
ok('pas encore la couronne (3 semaines)', !(await db.query(`select 1 from public.profile_items where profile_id = $1 and item_id = 'f_couronne'`, [A])).rows.length)

const eq = await (async () => {
  await db.query(`select set_config('app.uid', $1, false)`, [U])
  return (await db.query(`select public.equip_item('kart', 'k_dore') r`)).rows[0].r
})()
ok('équiper le bolide doré', eq.kart === 'k_dore', JSON.stringify(eq))
process.exit(failed ? 1 : 0)
