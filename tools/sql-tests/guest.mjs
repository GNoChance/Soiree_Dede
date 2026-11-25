// Tests SQL du mode invité (PGlite) : node guest.mjs ../../supabase/install.sql
import { bootDb } from './boot.mjs'

const file = process.argv[2]
if (!file) throw new Error('usage : node guest.mjs <install.sql>')
const db = await bootDb(file)
let failed = false
const ok = (n, c, x = '') => {
  console.log(`${c ? 'OK   ' : 'ÉCHEC'} ${n}${c ? '' : ' ' + x}`)
  if (!c) failed = true
}
const uid = (i) => `aaaaaaaa-0000-0000-0000-0000000000${String(i).padStart(2, '0')}`
const prof = (await db.query(`select id from public.profiles order by sort_order limit 3`)).rows
const [A, B, C] = prof.map((p) => p.id)
for (let i = 0; i < 3; i++) await db.query(`insert into public.device_sessions(auth_uid, profile_id) values ($1, $2)`, [uid(i), prof[i].id])
const UG = uid(10) // téléphone de l'invité (session anonyme, aucun profil)
const UG2 = uid(11)
const call = async (u, q, p = []) => {
  await db.query(`select set_config('app.uid', $1, false)`, [u])
  try {
    return { r: (await db.query(q, p)).rows[0]?.r }
  } catch (e) {
    return { err: e.message }
  }
}
const one = async (q, p = []) => (await db.query(q, p)).rows[0]

// ---- Soirée de A (avec B), invitations fermées par défaut
const s = await call(uid(0), `select public.create_soiree($1) r`, [[B]])
ok('create_soiree', !s.err, s.err)
const sid = s.r.id
const code = s.r.code
ok('invitations fermées : guests_closed', (await call(UG, `select public.join_as_guest($1, 'Léa', 'renard') r`, [code])).err === 'guests_closed')
ok('ouvrir : hôte seulement', (await call(uid(1), `select public.open_guest_invites($1) r`, [sid])).err === 'not_host')
const inv = await call(uid(0), `select public.open_guest_invites($1) r`, [sid])
ok('open_guest_invites', !inv.err && inv.r.token?.length === 10 && inv.r.code === code, inv.err ?? JSON.stringify(inv.r))
const token = inv.r.token
ok('jeton stable', (await call(uid(0), `select public.open_guest_invites($1) r`, [sid])).r?.token === token)

// ---- Aperçu + rejoindre
const info = await call(UG, `select public.guest_invite_info($1) r`, [token.toLowerCase()])
ok('aperçu par jeton', !info.err && info.r.soiree_id === sid && info.r.me === 'none' && info.r.players === 2, info.err ?? JSON.stringify(info.r))
ok('code inconnu', (await call(UG, `select public.guest_invite_info('ZZZZ') r`)).err === 'soiree_not_found')
ok('prénom vide refusé', (await call(UG, `select public.join_as_guest($1, '   ', 'renard') r`, [token])).err === 'invalid_nickname')
ok('avatar inconnu refusé', (await call(UG, `select public.join_as_guest($1, 'Léa', 'kevin') r`, [token])).err === 'invalid_avatar')
const j = await call(UG, `select public.join_as_guest($1, '  Léa  ', 'renard') r`, [token])
ok('join_as_guest par jeton', !j.err && j.r.profile.nickname === 'Léa' && j.r.soiree.id === sid, j.err)
const G = j.r.profile.id
const gRow = await one(`select slug, is_guest, guest_expires_at > now() + interval '23 hours' as exp, is_admin from public.profiles where id = $1`, [G])
ok('profil invité', gRow.is_guest && gRow.exp && !gRow.is_admin && /^g-renard-[a-z0-9]{6}$/.test(gRow.slug), JSON.stringify(gRow))
ok('session liée à l’appareil', (await call(UG, `select public.current_profile_id() r`)).r === G)
ok('dans la soirée', (await one(`select count(*)::int n from public.soiree_players where soiree_id = $1 and profile_id = $2`, [sid, G])).n === 1)
ok('rejoindre 2 fois : idempotent', !(await call(UG, `select public.join_as_guest($1, 'Léa', 'renard') r`, [token])).err)
ok('membre de la bande : already_member', (await call(uid(1), `select public.join_as_guest($1, 'X', 'chat') r`, [code])).err === 'already_member')
const j2 = await call(UG2, `select public.join_as_guest($1, 'Sam', 'panda') r`, [code.toLowerCase()])
ok('join_as_guest par code à 4 caractères', !j2.err, j2.err)
const G2 = j2.r.profile.id

// ---- Ce qu'un invité ne peut pas faire
ok('invité : pas de soirée à lui', (await call(UG, `select public.create_soiree('{}') r`)).err === 'guest_forbidden')
// Un autre téléphone ne peut pas se connecter sur le profil invité (slug public, pas de PIN).
const steal = await call(uid(12), `select public.login_profile($1, '0000') r`, [gRow.slug])
ok('login_profile sur un invité : refusé', steal.r?.ok === false && steal.r?.error === 'unknown_profile', JSON.stringify(steal))
ok('login_profile sur un invité : aucune session créée', !(await one(`select 1 x from public.device_sessions where auth_uid = $1`, [uid(12)])))
ok('invité : pas de carte maison', (await call(UG, `select public.create_custom_card('tu-preferes', 'dilemma', '{"a":"x","b":"y"}') r`)).err === 'guest_forbidden')
// Trophées : jamais pour un invité (pronos, stickers…), même si la règle est remplie.
await db.query(`insert into public.trophies(id, name, description, rule, active) values ('t_test_guest', 'T', 'T', '{"agg":"all","rules":[]}', true)`)
ok('invité : evaluate_trophy ne débloque rien', (await one(`select public.evaluate_trophy($1, 't_test_guest') r`, [G])).r === false)
ok('invité : evaluate_trophies ne débloque rien', ((await one(`select public.evaluate_trophies($1) r`, [G])).r ?? []).length === 0)
ok('membre : la règle débloque bien', ((await one(`select public.evaluate_trophies($1) r`, [A])).r ?? []).includes('t_test_guest'))
await db.query(`delete from public.trophies where id = 't_test_guest'`)
ok('invité : pas de join par code', (await call(UG, `select public.join_soiree_by_code($1) r`, [code])).err === 'guest_forbidden')
ok('invité : pas d’amis', (await call(UG, `select public.send_friend_request($1) r`, [A])).err === 'guest_forbidden')
ok('bande : pas d’ami invité', (await call(uid(0), `select public.send_friend_request($1) r`, [G])).err === 'guest_forbidden')
ok('invité : pas de défi du jour', (await call(UG, `select public.start_daily() r`)).err === 'guest_forbidden')
ok('invité : pas d’admin', (await call(UG, `select public.admin_list_soirees() r`)).err === 'forbidden')
ok('invité : pas d’ouverture d’invitations', (await call(UG, `select public.open_guest_invites($1) r`, [sid])).err === 'guest_forbidden')
ok('bande : pas d’invité dans une autre soirée', (await call(uid(2), `select public.create_soiree($1) r`, [[G]])).err === 'unknown_profile')
ok('écran de connexion sans invités', (await one(`select count(*)::int n from public.list_profiles_public() where id in ($1, $2)`, [G, G2])).n === 0)
ok('invité : voit sa soirée (RLS)', (await call(UG, `select public.is_soiree_member($1) r`, [sid])).r === true)

// ---- Une vraie partie de morpion : A contre l'invité, l'invité gagne
const mid = (await call(uid(0), `select public.start_match($1, 'morpion', $2) r`, [sid, { mode: 'duel', player_ids: [A, G], duel_players: [A, G] }])).r
ok('start_match avec un invité', typeof mid === 'string', String(mid))
const xpA0 = (await one(`select xp from public.profiles where id = $1`, [A])).xp
const st = async () => (await one(`select state from public.matches where id = $1`, [mid])).state
const act = async (u, a) => call(u, `select public.game_action($1, $2) r`, [mid, a])
const uOf = (pid) => (pid === A ? uid(0) : UG)
let state = await st()
for (let k = 0; k < 3 && state.phase === 'transition'; k++) {
  await act(uid(0), { type: 'next' })
  state = await st()
}
ok('duel en cours', state.phase === 'playing', state.phase)
// L'invité joue 0, 1, 2 ; A joue 3, 4 (et 8 s'il commence) -> l'invité gagne.
const firstIsG = state.duel.turn === G
const order = firstIsG ? [[G, 0], [A, 3], [G, 1], [A, 4], [G, 2]] : [[A, 3], [G, 0], [A, 4], [G, 1], [A, 8], [G, 2]]
for (const [p, cell] of order) {
  const r = await act(uOf(p), { type: 'move', move: { cell } })
  if (r.err) ok(`coup ${cell}`, false, r.err)
}
state = await st()
for (let k = 0; k < 4 && state.phase !== 'finished'; k++) {
  await act(uid(0), { type: 'next' })
  state = await st()
}
ok('partie terminée', state.phase === 'finished', state.phase)
const mpG = await one(`select won, placement from public.match_players where match_id = $1 and profile_id = $2`, [mid, G])
ok('invité : ligne match_players (salon / récap)', mpG?.won === true, JSON.stringify(mpG))
ok('invité : 0 XP', (await one(`select xp from public.profiles where id = $1`, [G])).xp === 0)
ok('invité : pas de player_stats', !(await one(`select 1 x from public.player_stats where profile_id = $1`, [G])))
ok('invité : pas de déblocages / tenues / trophées',
  !(await one(`select 1 x from public.unlocks where profile_id = $1 union all select 1 from public.tenue_unlocks where profile_id = $1 union all select 1 from public.trophy_unlocks where profile_id = $1`, [G])))
ok('bande : XP et stats comptés', (await one(`select xp from public.profiles where id = $1`, [A])).xp >= xpA0 &&
  (await one(`select games_played from public.player_stats where profile_id = $1`, [A]))?.games_played === 1)
ok('classement général sans invité', !(await one(`select 1 x from public.leaderboard_general where profile_id in ($1, $2)`, [G, G2])))
ok('classement par jeu sans invité', !(await one(`select 1 x from public.leaderboard_by_game where profile_id = $1`, [G])) &&
  !!(await one(`select 1 x from public.leaderboard_by_game where profile_id = $1 and game_id = 'morpion'`, [A])))
const wk = (await call(uid(0), `select public.leaderboard_week() r`)).r
ok('classement de la semaine sans invité', wk.rows.every((r) => r.profile_id !== G && r.profile_id !== G2) && wk.rows.length === (await one(`select count(*)::int n from public.profiles where not is_guest`)).n, String(wk.rows.length))
const ss = (await call(UG, `select public.soiree_standings($1) r`, [sid])).r
ok('classement de la soirée avec l’invité', ss?.standings.some((r) => r.profile_id === G && r.wins === 1), JSON.stringify(ss))

// ---- L'hôte part : jamais un invité comme hôte
const s2 = (await call(uid(2), `select public.create_soiree('{}') r`)).r
await call(uid(2), `select public.open_guest_invites($1) r`, [s2.id])
const j3 = await call(UG2, `select public.join_as_guest($1, 'Sam', 'koala') r`, [s2.code])
ok('invité : change de soirée (quitte l’ancienne)', !j3.err &&
  (await one(`select count(*)::int n from public.soiree_players where profile_id = $1`, [G2])).n === 1, j3.err)
ok('même profil, avatar changé', j3.r.profile.id === G2 && j3.r.profile.slug.startsWith('g-koala-'))
await call(uid(2), `select public.leave_soiree($1)`, [s2.id])
const s2row = await one(`select status, end_reason, host_id from public.soirees where id = $1`, [s2.id])
ok('hôte parti, reste un invité : soirée terminée', s2row.status === 'ended' && s2row.end_reason === 'empty' && s2row.host_id === C, JSON.stringify(s2row))
ok('soirée terminée : stats soirées sans invité', !(await one(`select 1 x from public.player_stats where profile_id = $1`, [G2])))

// ---- Fermer les invitations
await call(uid(0), `select public.close_guest_invites($1)`, [sid])
ok('invitations fermées : jeton mort', (await call(UG2, `select public.join_as_guest($1, 'Sam', 'panda') r`, [token])).err === 'soiree_not_found')
ok('invitations fermées : code refusé', (await call(UG2, `select public.join_as_guest($1, 'Sam', 'panda') r`, [code])).err === 'guests_closed')

// ---- Expiration / purge
await db.query(`update public.profiles set guest_expires_at = now() - interval '1 minute' where id in ($1, $2)`, [G, G2])
await db.query(`select public._purge_guests()`)
ok('expiré mais encore dans une soirée en cours : gardé', !!(await one(`select 1 x from public.profiles where id = $1`, [G])))
ok('expiré et sans soirée : purgé', !(await one(`select 1 x from public.profiles where id = $1`, [G2])) &&
  (await call(UG2, `select public.current_profile_id() r`)).r === null)
await call(uid(0), `select public.end_soiree($1) r`, [sid])
const purged = (await one(`select public._purge_guests() n`)).n
ok('fin de soirée puis purge : invité supprimé', purged === 1 && !(await one(`select 1 x from public.profiles where id = $1`, [G])))
ok('purge : la partie de la bande reste', !!(await one(`select 1 x from public.match_players where match_id = $1 and profile_id = $2`, [mid, A])))
ok('purge idempotente', (await one(`select public._purge_guests() n`)).n === 0)

// ---- Invité exclu : il ne revient pas avec un autre téléphone / une nouvelle session
{
  const s3 = (await call(uid(1), `select public.create_soiree('{}') r`)).r
  const t3 = (await call(uid(1), `select public.open_guest_invites($1) r`, [s3.id])).r.token
  const g4 = (await call(uid(14), `select public.join_as_guest($1, 'Max', 'chat') r`, [t3])).r.profile.id
  const k = await call(uid(1), `select public.kick_soiree_player($1, $2) r`, [s3.id, g4])
  ok('exclure un invité', !k.err, k.err)
  ok('exclure un invité ferme les invitations', (await one(`select guest_token from public.soirees where id = $1`, [s3.id])).guest_token === null)
  ok('exclu : nouvelle session, ancien QR refusé', (await call(uid(15), `select public.join_as_guest($1, 'Max', 'chat') r`, [t3])).err === 'soiree_not_found')
  ok('exclu : nouvelle session, code refusé', (await call(uid(15), `select public.join_as_guest($1, 'Max', 'chat') r`, [s3.code])).err === 'guests_closed')
  const t4 = (await call(uid(1), `select public.open_guest_invites($1) r`, [s3.id])).r.token
  ok('invitations rouvertes : nouveau QR', t4 && t4 !== t3)
  ok('exclu : même prénom refusé même avec une nouvelle session', (await call(uid(15), `select public.join_as_guest($1, ' max ', 'panda') r`, [t4])).err === 'soiree_banned')
  ok('exclu : même téléphone refusé', (await call(uid(14), `select public.join_as_guest($1, 'Maxou', 'chat') r`, [t4])).err === 'soiree_banned')
  const other = await call(uid(15), `select public.join_as_guest($1, 'Paul', 'panda') r`, [t4])
  ok('un autre invité peut toujours venir', !other.err, other.err)
}

console.log(failed ? '\nDES TESTS ONT ÉCHOUÉ' : '\nTous les tests passent')
process.exit(failed ? 1 : 0)
