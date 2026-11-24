// Tests SQL du lien de musique de la soirée (Spotify Jam) (PGlite) : node musique.mjs ../../supabase/install.sql
import { bootDb } from './boot.mjs'

const file = process.argv[2]
if (!file) throw new Error('usage : node musique.mjs <install.sql>')
const db = await bootDb(file)
let failed = false
const ok = (n, c, x = '') => {
  console.log(`${c ? 'OK   ' : 'ÉCHEC'} ${n}${c ? '' : ' ' + x}`)
  if (!c) failed = true
}
const uid = (i) => `aaaaaaaa-0000-0000-0000-0000000000${String(i).padStart(2, '0')}`
const prof = (await db.query(`select id from public.profiles where not is_guest order by sort_order limit 3`)).rows
const [, B] = prof.map((p) => p.id)
for (let i = 0; i < 3; i++) await db.query(`insert into public.device_sessions(auth_uid, profile_id) values ($1, $2)`, [uid(i), prof[i].id])
const call = async (u, q, p = []) => {
  await db.query(`select set_config('app.uid', $1, false)`, [u])
  try {
    return { r: (await db.query(q, p)).rows[0]?.r }
  } catch (e) {
    return { err: e.message }
  }
}
const one = async (q, p = []) => (await db.query(q, p)).rows[0]
const setMusic = (u, sid, url) => call(u, `select public.set_soiree_music($1, $2) r`, [sid, url])
const music = async (sid) => (await one(`select music_url from public.soirees where id = $1`, [sid])).music_url

const sid = (await call(uid(0), `select public.create_soiree($1) r`, [[B]])).r.id
ok('pas de musique au départ', (await music(sid)) === null)

ok('non-hôte refusé', (await setMusic(uid(1), sid, 'https://spotify.link/abc123')).err === 'not_host')
ok('lien non Spotify refusé', (await setMusic(uid(0), sid, 'https://exemple.com/jam')).err === 'invalid_music_link')
ok('http refusé', (await setMusic(uid(0), sid, 'http://open.spotify.com/socialsession/x')).err === 'invalid_music_link')
ok('lien trop long refusé', (await setMusic(uid(0), sid, 'https://spotify.link/' + 'a'.repeat(400))).err === 'invalid_music_link')
ok('faux domaine refusé', (await setMusic(uid(0), sid, 'https://spotify.link.evil.com/x')).err === 'invalid_music_link')

const s1 = await setMusic(uid(0), sid, '  https://spotify.link/AbC123xYz  ')
ok('lien spotify.link accepté (espaces retirés)', !s1.err && (await music(sid)) === 'https://spotify.link/AbC123xYz', s1.err)
const s2 = await setMusic(uid(0), sid, 'https://open.spotify.com/socialsession/9f2b1c?si=abc&utm_source=copy-link')
ok('lien open.spotify.com accepté', !s2.err && (await music(sid)).startsWith('https://open.spotify.com/socialsession/'), s2.err)
ok('lien extrait d’un texte de partage', !(await setMusic(uid(0), sid, 'Rejoins ma Jam sur Spotify ! https://spotify.link/Zz9 🎶')).err && (await music(sid)) === 'https://spotify.link/Zz9', await music(sid))

const c = await setMusic(uid(0), sid, '')
ok('vide = musique retirée', !c.err && (await music(sid)) === null, c.err)
await setMusic(uid(0), sid, 'https://spotify.link/AbC')
ok('null = musique retirée', !(await setMusic(uid(0), sid, null)).err && (await music(sid)) === null)

await call(uid(0), `select public.end_soiree($1) r`, [sid])
ok('soirée terminée : refusé', (await setMusic(uid(0), sid, 'https://spotify.link/AbC')).err === 'soiree_ended')
ok('soirée inconnue', (await setMusic(uid(0), '00000000-0000-0000-0000-000000000001', 'https://spotify.link/AbC')).err === 'soiree_not_found')

console.log(failed ? '\nDES TESTS ONT ÉCHOUÉ' : '\nTous les tests passent')
process.exit(failed ? 1 : 0)
