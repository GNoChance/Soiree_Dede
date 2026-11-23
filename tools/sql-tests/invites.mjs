// Tests SQL : notification d'invitation push + face-a-face (PGlite) : node invites.mjs ../../supabase/install.sql
import { bootDb } from './boot.mjs'
const file = process.argv[2]
if (!file) throw new Error('usage : node invites.mjs <install.sql>')
const db = await bootDb(file)
let failed = false
const ok = (n, c, x = '') => { console.log(`${c ? 'OK   ' : 'ÉCHEC'} ${n}${c ? '' : ' ' + x}`); if (!c) failed = true }
const U = [1, 2, 3].map((i) => `aaaaaaaa-0000-0000-0000-00000000000${i}`)
const prof = (await db.query(`select id from public.profiles order by sort_order limit 3`)).rows
for (let i = 0; i < 3; i++) await db.query(`insert into public.device_sessions(auth_uid, profile_id) values ($1, $2)`, [U[i], prof[i].id])
const [A, B, C] = prof.map((p) => p.id)
const call = async (i, q, p = []) => {
  await db.query(`select set_config('app.uid', $1, false)`, [U[i]])
  try { return { r: (await db.query(q, p)).rows[0]?.r } } catch (e) { return { err: e.message } }
}
await db.query(`insert into public.push_config(id, reminder_url, secret) values (true, 'https://x.app/api/daily-reminder', 's')`)
await db.query(`insert into public.push_subscriptions(profile_id, endpoint, p256dh, auth) values ($1,'https://e/b','p'||repeat('x',30),repeat('a',12)), ($2,'https://e/c','p'||repeat('x',30),repeat('a',12)), ($3,'https://e/a','p'||repeat('x',30),repeat('a',12))`, [B, C, A])
ok('prefs defaut', (await call(1, `select public.get_push_prefs() r`)).r?.invites === true)
await call(2, `select public.set_push_invites(false)`)
ok('prefs off', (await call(2, `select public.get_push_prefs() r`)).r?.invites === false)
const s = await call(0, `select public.create_soiree($1) r`, [[B, C]])
ok('create_soiree', !s.err, s.err)
const sid = s.r.id
ok('file: 2 lignes (pas l hote)', (await db.query(`select count(*)::int n from public.push_invites`)).rows[0].n === 2)
const cl = (await db.query(`select public.push_invite_claim() r`)).rows[0].r
ok('claim: B seul (C a desactive)', cl.length === 1 && cl[0].profile_id === B && cl[0].soiree_id === sid && cl[0].host_nick, JSON.stringify(cl))
ok('claim idempotent', (await db.query(`select public.push_invite_claim() r`)).rows[0].r.length === 0)
await call(0, `select public.kick_soiree_player($1,$2)`, [sid, B])
await call(0, `select public.invite_to_soiree($1,$2)`, [sid, B])
ok('reinvitation: pas de doublon', (await db.query(`select count(*)::int n from public.push_invites where profile_id=$1`, [B])).rows[0].n === 1 && (await db.query(`select public.push_invite_claim() r`)).rows[0].r.length === 0)
// Rejoindre seul par le code : ce n'est pas une invitation, pas de notification
await call(2, `select public.leave_soiree($1)`, [sid])
await db.query(`delete from public.push_invites where profile_id = $1`, [C])
const jc = await call(2, `select public.join_soiree_by_code($1) r`, [s.r.code])
ok('join par code', !jc.err, jc.err)
ok('join par code : pas de notification d invitation', (await db.query(`select count(*)::int n from public.push_invites where profile_id=$1`, [C])).rows[0].n === 0)
// face-a-face
const m = (await db.query(`insert into public.matches(soiree_id, game_id, status, finished_at) values ($1,'morpion','finished',now()) returning id`, [sid])).rows[0].id
await db.query(`insert into public.match_players(match_id, profile_id, game_id, placement, won) values ($1,$2,'morpion',1,true), ($1,$3,'morpion',2,false)`, [m, A, B])
const m2 = (await db.query(`insert into public.matches(soiree_id, game_id, status, finished_at) values ($1,'morpion','finished',now()) returning id`, [sid])).rows[0].id
await db.query(`insert into public.match_players(match_id, profile_id, game_id, placement, won) values ($1,$2,'morpion',2,false), ($1,$3,'morpion',1,true), ($1,$4,'morpion',3,false)`, [m2, A, B, C])
const h = (await call(0, `select public.head_to_head($1) r`, [B])).r
ok('h2h comptes', h.played === 2 && h.me_wins === 1 && h.other_wins === 1 && h.duels === 1 && h.me_duel_wins === 1 && h.other_duel_wins === 0, JSON.stringify(h))
ok('h2h autre + last', h.other.id === B && h.last.game_id === 'morpion')
ok('h2h soi-meme refuse', (await call(0, `select public.head_to_head($1) r`, [A])).err?.includes('unknown_profile'))
process.exit(failed ? 1 : 0)
