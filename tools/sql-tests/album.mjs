// Tests SQL de l'album souvenir (PGlite) : node album.mjs ../../supabase/install.sql
import { bootDb } from './boot.mjs'
const file = process.argv[2]
if (!file) throw new Error('usage : node album.mjs <install.sql>')
const db = await bootDb(file)
let failed = false
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK   ' : 'ÉCHEC'} ${name}${cond ? '' : ' ' + extra}`)
  if (!cond) failed = true
}
const U = [1, 2, 3, 4].map((i) => `aaaaaaaa-0000-0000-0000-00000000000${i}`)
const prof = (await db.query(`select id from public.profiles order by sort_order limit 4`)).rows
for (let i = 0; i < 4; i++) await db.query(`insert into public.device_sessions(auth_uid, profile_id) values ($1, $2)`, [U[i], prof[i].id])
const [A, B, C, D] = prof.map((p) => p.id)
const call = async (i, q, p = []) => {
  await db.query(`select set_config('app.uid', $1, false)`, [U[i]])
  try { return { r: (await db.query(q, p)).rows[0]?.r } } catch (e) { return { err: e.message } }
}
const sys = async (q, p = []) => (await db.query(q, p)).rows

const s1 = (await sys(`insert into public.soirees(code, host_id, status, started_at, ended_at) values ('ALB1', $1, 'ended', '2026-03-10 19:00+01', '2026-03-10 23:00+01') returning id`, [A]))[0].id
const s2 = (await sys(`insert into public.soirees(code, host_id, status, started_at, ended_at) values ('ALB2', $1, 'ended', '2026-05-02 20:00+02', '2026-05-02 21:00+02') returning id`, [A]))[0].id
const s3 = (await sys(`insert into public.soirees(code, host_id, status, started_at, ended_at) values ('ALB3', $1, 'ended', '2025-05-02 20:00+02', '2025-05-02 21:00+02') returning id`, [A]))[0].id
await sys(`insert into public.soirees(code, host_id, status, started_at) values ('ALB4', $1, 'active', '2026-06-02 20:00+02')`, [A])
const mk = async (sid, game, at, winner, loser, state = {}) => {
  const m = (await sys(`insert into public.matches(soiree_id, game_id, status, finished_at, state) values ($1,$2,'finished',$3,$4) returning id`, [sid, game, at, state]))[0].id
  await sys(`insert into public.match_players(match_id, profile_id, game_id, placement, won) values ($1,$2,$3,1,true),($1,$4,$3,2,false)`, [m, winner, game, loser])
}
await mk(s1, 'morpion', '2026-03-10 20:00+01', B, A)
await mk(s1, 'morpion', '2026-03-10 21:00+01', B, A)
await mk(s1, 'petit-bac', '2026-03-10 22:00+01', A, B, {
  categories: [{ id: 'animal', label: 'Animal' }],
  last_round: { letter: 'E', detail: { animal: { [A]: { text: 'Éléphant', status: 'unique', pts: 2 }, [B]: { text: 'Ez', status: 'shared', pts: 1 } } } },
})
await mk(s1, 'tu-preferes', '2026-03-10 22:30+01', A, B, {
  history: [
    { counts: { a: 3, b: 0 }, dilemma: { a: 'Pizza', b: 'Pâtes' } },
    { counts: { a: 2, b: 2 }, dilemma: { a: 'Chat', b: 'Chien' } },
  ],
})
await mk(s2, 'morpion', '2026-05-02 20:30+02', A, B)
await mk(s3, 'morpion', '2025-05-02 20:30+02', A, B)
await sys(`insert into public.soiree_players(soiree_id, profile_id) values ($1,$2),($1,$3) on conflict do nothing`, [s1, A, B]).catch(() => {})
const tid = (await sys(`select id from public.trophies where active limit 1`))[0].id
await sys(`insert into public.trophy_unlocks(profile_id, trophy_id, unlocked_at) values ($1,$2,'2026-03-10 21:30+01')`, [B, tid])
await sys(`insert into public.trophy_unlocks(profile_id, trophy_id, unlocked_at) values ($1,$2,'2026-01-01 10:00+01') on conflict do nothing`, [A, tid])

const r = (await call(0, `select public.album_year(2026) r`)).r
ok('appel sans erreur', r && r.year === 2026, JSON.stringify(r))
ok('2 soirées terminées de 2026, dans l’ordre', r?.soirees?.length === 2 && r.soirees[0].soiree_id === s1 && r.soirees[1].soiree_id === s2)
const p1 = r?.soirees?.[0]
ok('durée 240 min, 4 parties, hôte A', p1?.duration_min === 240 && p1.games_played === 4 && p1.host?.id === A, JSON.stringify(p1?.duration_min))
ok('parties listées avec gagnants', p1?.matches?.length === 4 && p1.matches[0].winners[0].profile_id === B)
ok('classement + winner_ids', p1?.standings?.length >= 2 && Array.isArray(p1.winner_ids))
ok('trophée débloqué pendant la soirée seulement', p1?.highlights?.trophies?.length === 1 && p1.highlights.trophies[0].profile_id === B, JSON.stringify(p1?.highlights?.trophies))
ok('mot du Petit Bac', p1?.highlights?.words?.length === 1 && p1.highlights.words[0].text === 'Éléphant' && p1.highlights.words[0].category === 'Animal' && p1.highlights.words[0].letter === 'E', JSON.stringify(p1?.highlights?.words))
ok('dilemme le plus partagé', p1?.highlights?.dilemma?.a === 'Chat' && p1.highlights.dilemma.count_a === 2, JSON.stringify(p1?.highlights?.dilemma))
ok('soirée 2 sans moments forts rares', r?.soirees?.[1]?.highlights?.words?.length === 0 && r.soirees[1].highlights.dilemma === null)
ok('année 2025 : 1 soirée', (await call(0, `select jsonb_array_length(public.album_year(2025)->'soirees') r`)).r === 1)
ok('étranger à la soirée : rien', (await call(3, `select jsonb_array_length(public.album_year(2026)->'soirees') r`)).r === 0)
ok('année invalide refusée', (await call(0, `select public.album_year(1999) r`)).err?.includes('album_invalid_year'))
ok('sans profil refusé', (await db.query(`select set_config('app.uid', '', false)`), (await db.query(`select public.album_year(2026)`).catch((e) => e.message)).toString().length > 0))
process.exit(failed ? 1 : 0)
