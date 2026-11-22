// Tests SQL de la boîte à idées (PGlite) : node idees.mjs ../../supabase/install.sql
import { bootDb } from './boot.mjs'

const file = process.argv[2]
if (!file) throw new Error('usage : node idees.mjs <install.sql>')
const db = await bootDb(file)
let failed = false
const ok = (n, c, x = '') => {
  console.log(`${c ? 'OK   ' : 'ÉCHEC'} ${n}${c ? '' : ' ' + x}`)
  if (!c) failed = true
}
const uid = (i) => `aaaaaaaa-0000-0000-0000-0000000000${String(i).padStart(2, '0')}`
const prof = (await db.query(`select id, slug, is_admin from public.profiles order by sort_order limit 3`)).rows
const admin = prof.find((p) => p.is_admin)
const other = prof.find((p) => !p.is_admin)
await db.query(`insert into public.device_sessions(auth_uid, profile_id) values ($1, $2), ($3, $4)`, [uid(0), admin.id, uid(1), other.id])
const g = (await db.query(`insert into public.profiles(slug, first_name, nickname, is_guest, guest_expires_at) values ('g-renard-abcdef', 'Léa', 'Léa', true, now() + interval '1 day') returning id`)).rows[0]
await db.query(`insert into public.device_sessions(auth_uid, profile_id) values ($1, $2)`, [uid(2), g.id])
const call = async (u, q, p = []) => {
  await db.query(`select set_config('app.uid', $1, false)`, [u])
  try {
    return { r: (await db.query(q, p)).rows[0]?.r }
  } catch (e) {
    return { err: e.message }
  }
}
const A = uid(0), M = uid(1), G = uid(2)
const submit = (u, b, an = false) => call(u, `select public.submit_idea($1, $2) r`, [b, an])

ok('invité refusé', (await submit(G, 'Un jeu')).err === 'guest_forbidden')
ok('état : invité refusé', (await call(G, `select public.idea_box_state() r`)).err === 'guest_forbidden')
ok('texte vide refusé', (await submit(M, '   ')).err === 'invalid_idea')
ok('texte trop long refusé', (await submit(M, 'x'.repeat(501))).err === 'invalid_idea')
const s1 = await submit(M, '  Un jeu de pétanque  ')
ok('membre soumet', !s1.err && s1.r.total === 1 && s1.r.mine === 1 && s1.r.is_admin === false && s1.r.unread === 0, s1.err ?? JSON.stringify(s1.r))
await db.query(`update public.ideas set created_at = created_at - interval '1 minute'`)
const s2 = await submit(M, 'Idée secrète', true)
ok('anonyme soumis', !s2.err && s2.r.total === 2)
ok('non-admin ne liste pas', (await call(M, `select public.admin_list_ideas() r`)).err === 'forbidden')
const st = await call(A, `select public.idea_box_state() r`)
ok('état admin : unread 2', st.r.is_admin === true && st.r.unread === 2 && st.r.mine === 0, JSON.stringify(st.r))
const l = await call(A, `select public.admin_list_ideas() r`)
ok('admin liste (récent d’abord)', l.r.length === 2 && l.r[0].body === 'Idée secrète' && l.r[1].body === 'Un jeu de pétanque', JSON.stringify(l.r))
ok('anonymat respecté', l.r[0].author_slug === null && l.r[0].author_nickname === null && l.r[1].author_slug === other.slug)
ok('non-admin : statut refusé', (await call(M, `select public.admin_set_idea_status($1, 'done') r`, [l.r[0].id])).err === 'forbidden')
ok('statut invalide', (await call(A, `select public.admin_set_idea_status($1, 'zzz') r`, [l.r[0].id])).err === 'invalid_status')
ok('statut done', !(await call(A, `select public.admin_set_idea_status($1, 'done') r`, [l.r[0].id])).err)
ok('unread décrémenté', (await call(A, `select public.idea_box_state() r`)).r.unread === 1)
ok('idée inconnue', (await call(A, `select public.admin_set_idea_status(gen_random_uuid(), 'done') r`)).err === 'unknown_idea')
ok('non-admin : suppression refusée', (await call(M, `select public.admin_delete_idea($1) r`, [l.r[0].id])).err === 'forbidden')
ok('suppression', !(await call(A, `select public.admin_delete_idea($1) r`, [l.r[0].id])).err)
ok('total après suppression', (await call(A, `select public.idea_box_state() r`)).r.total === 1)
for (let i = 0; i < 19; i++) await submit(M, 'spam ' + i)
ok('limite anti-spam', (await submit(M, 'trop')).err === 'too_many_ideas')
ok('autre membre non bloqué', !(await submit(A, 'ok')).err)
process.exit(failed ? 1 : 0)
