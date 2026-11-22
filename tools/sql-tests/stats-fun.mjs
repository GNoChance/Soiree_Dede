// Tests SQL des stats fun (PGlite) : node stats-fun.mjs ../../supabase/install.sql
import { bootDb } from './boot.mjs'

const file = process.argv[2]
if (!file) throw new Error('usage : node stats-fun.mjs <install.sql>')
const db = await bootDb(file)
let failed = false
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK   ' : 'ÉCHEC'} ${name}${cond ? '' : ' ' + extra}`)
  if (!cond) failed = true
}
const U = 'aaaaaaaa-0000-0000-0000-000000000001'
const ps = (await db.query(`select id from public.profiles order by sort_order limit 2`)).rows.map((r) => r.id)
const [A, B] = ps
await db.query(`insert into public.device_sessions(auth_uid, profile_id) values ($1, $2)`, [U, A])
await db.query(`select set_config('app.uid', $1, false)`, [U])
const fun = async () => (await db.query(`select public.fun_stats($1) r`, [A])).rows[0].r

const so = (await db.query(`insert into public.soirees(code, host_id, status, started_at, ended_at) values ('ZZZZ', $1, 'ended', now() - interval '5 hours', now()) returning id`, [A])).rows[0].id
// A perd contre B en duel (Paris 23h30 = 22h30 UTC en hiver) ; heure fixe en janvier
let k = 0
const play = async (game, aWon, hourUtc, withB = true) => {
  k++
  const fin = `2026-01-${String(10 + (k % 15)).padStart(2, '0')} ${String(hourUtc).padStart(2, '0')}:30:00+00`
  const m = (await db.query(`insert into public.matches(soiree_id, game_id, status, finished_at) values ($1, $2, 'finished', $3) returning id`, [so, game, fin])).rows[0].id
  await db.query(`insert into public.match_players(match_id, profile_id, game_id, placement, won) values ($1,$2,$3,$4,$5)`, [m, A, game, aWon ? 1 : 2, aWon])
  if (withB) await db.query(`insert into public.match_players(match_id, profile_id, game_id, placement, won) values ($1,$2,$3,$4,$5)`, [m, B, game, aWon ? 2 : 1, !aWon])
}
for (let i = 0; i < 9; i++) await play('morpion', false, 22)
const few = await fun()
ok('moins de 10 parties : pas assez', few.enough === false && few.games === 9, JSON.stringify(few))
await play('morpion', false, 22) // 10e
for (let i = 0; i < 3; i++) await play('bowling', true, 14)
const r = await fun()
ok('assez de parties', r.enough === true && r.games === 13 && r.wins === 3, JSON.stringify(r))
const nuit = r.slots.find((s) => s.slot === 'nuit')
ok('23h30 Paris = nuit, 10 parties 0 victoire', nuit && nuit.played === 10 && nuit.wins === 0, JSON.stringify(r.slots))
ok('série de défaites 10, victoires 3', r.streak.loss === 10 && r.streak.win === 3, JSON.stringify(r.streak))
const b = r.duels.find((d) => d.profile_id === B)
ok('rival B : 10 défaites, 3 victoires', b && b.their_wins === 10 && b.my_wins === 3, JSON.stringify(r.duels))
ok('pote B : 13 parties ensemble', r.mates[0]?.profile_id === B && r.mates[0].together === 13, JSON.stringify(r.mates))
ok('soirée la plus longue ~300 min', r.longest_soiree && Math.abs(r.longest_soiree.minutes - 300) <= 1, JSON.stringify(r.longest_soiree))
ok('par jeu', r.per_game.length === 2 && r.per_game[0].game_id === 'morpion')
process.exit(failed ? 1 : 0)
