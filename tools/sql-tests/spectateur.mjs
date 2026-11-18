// Tests SQL du mode spectateur (PGlite) : node spectateur.mjs ../../supabase/install.sql
// Un ami accepté d'un joueur (ou de l'hôte) peut LIRE la partie (matches), jamais ses secrets.
import { bootDb } from './boot.mjs'

const file = process.argv[2]
if (!file) throw new Error('usage : node spectateur.mjs <install.sql>')
const db = await bootDb(file)

let failed = false
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK   ' : 'ÉCHEC'} ${name}${cond ? '' : ' ' + extra}`)
  if (!cond) failed = true
}

const U = [1, 2, 3, 4, 5, 6].map((i) => `aaaaaaaa-0000-0000-0000-00000000000${i}`)
const prof = (await db.query(`select id from public.profiles order by sort_order limit 6`)).rows
for (let i = 0; i < 6; i++) await db.query(`insert into public.device_sessions(auth_uid, profile_id) values ($1, $2)`, [U[i], prof[i].id])
const [A, B, C, D, E, F] = prof.map((p) => p.id) // A hôte, B joueur, C ami de B, D ami de A, E inconnu, F demande « pending » vers B
const sys = async (q, p = []) => (await db.query(q, p)).rows
const as = (i) => db.query(`select set_config('app.uid', $1, false)`, [U[i]])
/** Appelle une requête comme le joueur i (rôle authenticated : la RLS s'applique) ; renvoie {rows} ou {err}. */
const call = async (i, q, p = []) => {
  await as(i)
  await db.exec('set role authenticated')
  try {
    return { rows: (await db.query(q, p)).rows }
  } catch (e) {
    return { err: e.message }
  } finally {
    await db.exec('reset role')
  }
}
const befriend = (x, y, status = 'accepted') =>
  sys(`insert into public.friendships(requester_id, addressee_id, status, accepted_at) values ($1, $2, $3, case when $3 = 'accepted' then now() end)`, [x, y, status])
await befriend(C, B)
await befriend(D, A)
await befriend(F, B, 'pending')

// Soirée de A avec B ; une partie en cours entre A et B.
await as(0)
const soiree = (await db.query(`select public.create_soiree($1::uuid[]) r`, [`{${B}}`])).rows[0].r.id
const m1 = (
  await db.query(`select public.start_match($1, 'qui-de-nous', $2::jsonb) id`, [soiree, JSON.stringify({ questions: ['Q1', 'Q2'], rounds: 1, player_ids: [A, B] })])
).rows[0].id

const can = async (i) => (await call(i, `select public.can_watch_match($1) r`, [m1])).rows?.[0]?.r
ok('can_watch_match : l’hôte (membre de la soirée)', (await can(0)) === true)
ok('can_watch_match : un joueur (membre)', (await can(1)) === true)
ok('can_watch_match : ami accepté d’un joueur', (await can(2)) === true)
ok('can_watch_match : ami accepté de l’hôte', (await can(3)) === true)
ok('can_watch_match : un inconnu → faux', (await can(4)) === false)
ok('can_watch_match : simple demande d’ami en attente → faux', (await can(5)) === false)

// Lecture directe (RLS)
const readMatch = async (i) => (await call(i, `select id from public.matches where id = $1`, [m1])).rows
ok('RLS matches : un ami d’un joueur lit la partie', (await readMatch(2)).length === 1)
ok('RLS matches : un ami de l’hôte lit la partie', (await readMatch(3)).length === 1)
ok('RLS matches : un inconnu ne lit rien', (await readMatch(4)).length === 0)
ok('RLS matches : demande en attente ne lit rien', (await readMatch(5)).length === 0)

// Les secrets et l'état serveur restent privés
const sec = await call(2, `select count(*)::int c from public.match_secrets where match_id = $1`, [m1])
const srv = await call(2, `select count(*)::int c from public.match_server_state where match_id = $1`, [m1])
ok('RLS match_secrets : l’ami ne lit aucun secret', sec.rows?.[0]?.c === 0, JSON.stringify(sec))
ok('RLS match_server_state : inaccessible à l’ami', srv.err !== undefined || srv.rows?.[0]?.c === 0, JSON.stringify(srv))
// L'ami ne lit toujours ni la soirée, ni ses joueurs, ni le chat
const so = await call(2, `select count(*)::int c from public.soirees where id = $1`, [soiree])
const sp = await call(2, `select count(*)::int c from public.soiree_players where soiree_id = $1`, [soiree])
ok('RLS soirees / soiree_players : toujours réservés aux membres', so.rows?.[0]?.c === 0 && sp.rows?.[0]?.c === 0, JSON.stringify([so, sp]))

// Amitié supprimée → plus de droit
await sys(`delete from public.friendships where requester_id = $1 and addressee_id = $2`, [C, B])
ok('amitié supprimée : l’ancien ami ne peut plus regarder', (await can(2)) === false && (await readMatch(2)).length === 0)
await befriend(C, B) // rétablie pour la suite

// friends_playing
const fp = async (i) => (await call(i, `select public.friends_playing() r`)).rows?.[0]?.r
const fpC = await fp(2)
ok('friends_playing côté C : B est en partie', Array.isArray(fpC) && fpC.length === 1 && fpC[0].profile_id === B && fpC[0].match_id === m1
   && fpC[0].soiree_id === soiree && fpC[0].game_id === 'qui-de-nous', JSON.stringify(fpC))
const fpD = await fp(3)
ok('friends_playing côté D : A (ami) est en partie, une seule ligne', Array.isArray(fpD) && fpD.length === 1 && fpD[0].profile_id === A, JSON.stringify(fpD))
ok('friends_playing côté E (inconnu) : []', JSON.stringify(await fp(4)) === '[]')
ok('friends_playing côté F (demande en attente seulement) : []', JSON.stringify(await fp(5)) === '[]')
ok('friends_playing côté B : mes amis seulement (C n’est pas en partie)', JSON.stringify(await fp(1)) === '[]')

// Fin de partie : plus d'œil, mais un membre peut toujours lire
await as(0)
await db.query(`select public.game_action($1, '{"type":"abort"}'::jsonb)`, [m1])
ok('partie terminée : friends_playing = []', JSON.stringify(await fp(2)) === '[]')
ok('partie terminée : un membre peut toujours la lire', (await readMatch(1)).length === 1)

console.log(failed ? '\nÉCHEC' : '\nTout est OK')
process.exit(failed ? 1 : 0)
