// Tests SQL de la présence (en ligne / vu il y a…) (PGlite) : node presence.mjs ../../supabase/install.sql
import { bootDb } from './boot.mjs'

const file = process.argv[2]
if (!file) throw new Error('usage : node presence.mjs <install.sql>')
const db = await bootDb(file)
let failed = false
const ok = (n, c, x = '') => {
  console.log(`${c ? 'OK   ' : 'ÉCHEC'} ${n}${c ? '' : ' ' + x}`)
  if (!c) failed = true
}
const uid = (i) => `aaaaaaaa-0000-0000-0000-0000000000${String(i).padStart(2, '0')}`
const prof = (await db.query(`select id from public.profiles where not is_guest order by sort_order limit 3`)).rows
const [A, B] = prof.map((p) => p.id)
for (let i = 0; i < 2; i++) await db.query(`insert into public.device_sessions(auth_uid, profile_id) values ($1, $2)`, [uid(i), prof[i].id])
const call = async (u, q, p = []) => {
  await db.query(`select set_config('app.uid', $1, false)`, [u])
  try {
    return { r: (await db.query(q, p)).rows[0]?.r }
  } catch (e) {
    return { err: e.message }
  }
}
const one = async (q, p = []) => (await db.query(q, p)).rows[0]
const presenceOf = (rows, id) => (rows ?? []).find((x) => x.profile_id === id)

ok('sans profil : refusé', (await call(uid(9), `select public.ping_presence() r`)).err === 'not_logged_in')

const p0 = await call(uid(0), `select public.band_presence() r`)
ok('personne vu au départ : liste vide', Array.isArray(p0.r) && p0.r.length === 0, JSON.stringify(p0))

const ping = await call(uid(0), `select public.ping_presence() r`)
ok('ping OK', !ping.err, ping.err)
const p1 = (await call(uid(1), `select public.band_presence() r`)).r
const a1 = presenceOf(p1, A)
ok('A apparaît, vu à l’instant', a1 && Date.now() - new Date(a1.last_seen_at).getTime() < 60_000, JSON.stringify(p1))
ok('B (jamais pingé) absent', !presenceOf(p1, B))

// Le ping met à jour l'heure
await db.query(`update public.presence set last_seen_at = now() - interval '3 hours' where profile_id = $1`, [A])
await call(uid(0), `select public.ping_presence() r`)
const a2 = presenceOf((await call(uid(1), `select public.band_presence() r`)).r, A)
ok('nouveau ping : heure rafraîchie', a2 && Date.now() - new Date(a2.last_seen_at).getTime() < 60_000, JSON.stringify(a2))
ok('une seule ligne par personne', (await one(`select count(*)::int n from public.presence where profile_id = $1`, [A])).n === 1)

// Invités : ni ping, ni lecture, jamais dans la liste
const sid = (await call(uid(0), `select public.create_soiree('{}') r`)).r.id
const tok = (await call(uid(0), `select public.open_guest_invites($1) r`, [sid])).r.token
const G = (await call(uid(10), `select public.join_as_guest($1, 'Léa', 'renard') r`, [tok])).r.profile.id
ok('invité : ping refusé', (await call(uid(10), `select public.ping_presence() r`)).err === 'guest_forbidden')
ok('invité : lecture refusée', (await call(uid(10), `select public.band_presence() r`)).err === 'guest_forbidden')
await db.query(`insert into public.presence(profile_id, last_seen_at) values ($1, now())`, [G])
ok('invité jamais dans la liste', !presenceOf((await call(uid(1), `select public.band_presence() r`)).r, G))

// Pas d'accès direct à la table
const direct = await db.query(`select has_table_privilege('authenticated', 'public.presence', 'select') s`).catch(() => ({ rows: [{ s: null }] }))
const rls = (await one(`select relrowsecurity r from pg_class where oid = 'public.presence'::regclass`)).r
ok('table protégée (RLS, accès par RPC seulement)', rls === true, String(direct.rows[0]?.s))

console.log(failed ? '\nDES TESTS ONT ÉCHOUÉ' : '\nTous les tests passent')
process.exit(failed ? 1 : 0)
