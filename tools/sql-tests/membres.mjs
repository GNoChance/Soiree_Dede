// Tests SQL des membres emoji ajoutés par l'admin (PGlite) : node membres.mjs ../../supabase/install.sql
import { bootDb } from './boot.mjs'

const file = process.argv[2]
if (!file) throw new Error('usage : node membres.mjs <install.sql>')
const db = await bootDb(file)
let failed = false
const ok = (n, c, x = '') => {
  console.log(`${c ? 'OK   ' : 'ÉCHEC'} ${n}${c ? '' : ' ' + x}`)
  if (!c) failed = true
}
const uid = (i) => `aaaaaaaa-0000-0000-0000-0000000000${String(i).padStart(2, '0')}`
const prof = (await db.query(`select id, is_admin from public.profiles order by sort_order limit 3`)).rows
const admin = prof.find((p) => p.is_admin)
const other = prof.find((p) => !p.is_admin)
await db.query(`insert into public.device_sessions(auth_uid, profile_id) values ($1, $2), ($3, $4)`, [uid(0), admin.id, uid(1), other.id])
const UN = uid(10) // téléphone de la nouvelle
const call = async (u, q, p = []) => {
  await db.query(`select set_config('app.uid', $1, false)`, [u])
  try {
    return { r: (await db.query(q, p)).rows[0]?.r }
  } catch (e) {
    return { err: e.message }
  }
}
const one = async (q, p = []) => (await db.query(q, p)).rows[0]
const create = (u, f, n, a) => call(u, `select public.admin_create_member($1, $2, $3) r`, [f, n, a])

ok('non-admin refusé', (await create(uid(1), 'Léa', 'Léa', 'renard')).err === 'forbidden')
ok('avatar invalide refusé', (await create(uid(0), 'Léa', 'Léa', 'kevin')).err === 'invalid_avatar')
ok('prénom vide refusé', (await create(uid(0), '  ', 'Léa', 'renard')).err === 'invalid_first_name')
ok('surnom vide refusé', (await create(uid(0), 'Léa', ' ', 'renard')).err === 'invalid_nickname')
ok('surnom trop long refusé', (await create(uid(0), 'Léa', 'x'.repeat(21), 'renard')).err === 'invalid_nickname')

const maxSort = (await one(`select max(sort_order)::int n from public.profiles where not is_guest`)).n
const c = await create(uid(0), '  Léa ', ' Léa-Lou ', 'renard')
ok('création OK', !c.err && c.r.nickname === 'Léa-Lou' && c.r.first_name === 'Léa', c.err)
const row = await one(`select * from public.profiles where id = $1`, [c.r.id])
ok('profil membre (pas invité, pas admin, slug m-)', !row.is_guest && !row.is_admin && /^m-renard-[a-z0-9]{6}$/.test(row.slug), row.slug)
ok('sort_order après les membres', row.sort_order === maxSort + 1, String(row.sort_order))
ok('expressions de départ', row.expressions.length === 12 && row.expressions[0] === 'joie')
ok('doublon de surnom refusé (insensible à la casse)', (await create(uid(0), 'Autre', 'léa-LOU', 'chat')).err === 'nickname_taken')

const lp = (await db.query(`select * from public.list_profiles_public()`)).rows
const mine = lp.find((p) => p.id === c.r.id)
ok('apparaît dans list_profiles_public (avec un code)', !!mine && mine.has_pin === true)
const PIN = c.r.pin
ok('code de 4 chiffres renvoyé à l’admin', /^[0-9]{4}$/.test(PIN ?? ''), String(PIN))
const wrong = PIN === '1234' ? '4321' : '1234'
ok('personne ne peut prendre le profil avec un autre code', (await call(UN, `select public.login_profile($1, $2) r`, [row.slug, wrong])).r?.error === 'wrong_pin')
const l1 = await call(UN, `select public.login_profile($1, $2) r`, [row.slug, PIN])
ok('connexion avec le code donné par l’admin', l1.r?.ok === true && l1.r.first_login === false, JSON.stringify(l1))
ok('bon PIN ensuite accepté', (await call(uid(11), `select public.login_profile($1, $2) r`, [row.slug, PIN])).r?.ok === true)

// Avatar
ok('avatar : non-admin refusé', (await call(uid(1), `select public.admin_update_member_avatar($1, 'chat') r`, [c.r.id])).err === 'forbidden')
ok('avatar : invalide refusé', (await call(uid(0), `select public.admin_update_member_avatar($1, 'zzz') r`, [c.r.id])).err === 'invalid_avatar')
ok('avatar : pas un membre emoji', (await call(uid(0), `select public.admin_update_member_avatar($1, 'chat') r`, [other.id])).err === 'unknown_profile')
const u = await call(uid(0), `select public.admin_update_member_avatar($1, 'panda') r`, [c.r.id])
ok('avatar changé', !u.err && u.r.slug === row.slug.replace('renard', 'panda'), u.err ?? u.r?.slug)
ok('même PIN après changement d’avatar', (await call(uid(12), `select public.login_profile($1, $2) r`, [u.r.slug, PIN])).r?.ok === true)

// Compte comme la bande
const sid = (await call(uid(0), `select public.create_soiree($1) r`, [[c.r.id]])).r?.id
ok('invitable à une soirée', !!sid)
const cnt = (await one(`select count(*)::int n from public.leaderboard_general where profile_id = $1`, [c.r.id])).n
ok('présent au classement général', cnt === 1, String(cnt))

console.log(failed ? '\nDES TESTS ONT ÉCHOUÉ' : '\nTous les tests passent')
process.exit(failed ? 1 : 0)
