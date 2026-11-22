// Tests SQL du mode Réveillon (PGlite) : node reveillon.mjs ../../supabase/install.sql
import { bootDb } from './boot.mjs'

const file = process.argv[2]
if (!file) throw new Error('usage : node reveillon.mjs <install.sql>')
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
  try {
    return { r: (await db.query(q, p)).rows[0]?.r }
  } catch (e) {
    return { err: e.message }
  }
}
const sys = async (q, p = []) => (await db.query(q, p)).rows
const arr = (ids) => `{${ids.join(',')}}`
const GAMES = ['qui-de-nous', 'tu-preferes', 'undercover']
const CH = ['n_renne', 'n_chant', 'n_trinque']
const sc = async (id) => (await sys(`select scenario from public.soirees where id = $1`, [id]))[0].scenario

// Soirée : hôte A, joueurs B, C ; D hors soirée.
const soiree = (await call(0, `select public.create_soiree($1::uuid[]) r`, [arr([B, C])])).r.id
const start = (i, theme = 'noel', rounds = 4, games = GAMES, ch = CH) =>
  call(i, `select public.reveillon_start($1, $2, $3, $4::text[], $5::text[]) r`, [soiree, theme, rounds, arr(games), arr(ch)])
const launch = (i = 0) => call(i, `select public.reveillon_launch($1, $2::jsonb) r`, [soiree, JSON.stringify({ questions: ['Q1', 'Q2'], rounds: 1, pairs: [['chat', 'chien']] })])
const next = (i, bravo = [], games = GAMES) => call(i, `select public.reveillon_next($1, $2::uuid[], $3::text[]) r`, [soiree, arr(bravo), arr(games)])
const finish = async (matchId, ranking) => {
  // ranking : [gagnant, 2e, 3e…] (comme game_action : finish_match puis status finished)
  await db.query(`select public.finish_match($1, $2::jsonb)`, [
    matchId,
    JSON.stringify(ranking.map((p, i) => ({ profile_id: p, points: i === 0 ? 3 : 0, won: i === 0, placement: i + 1 }))),
  ])
  await db.query(`update public.matches set status = 'finished', finished_at = now() where id = $1`, [matchId])
}

// --- démarrage -------------------------------------------------------------
ok('non-hôte refusé', (await start(1)).err?.includes('not_host'))
ok('thème inconnu refusé', (await start(0, 'paques')).err?.includes('reveillon_invalid'))
ok('nombre de manches invalide refusé', (await start(0, 'noel', 5)).err?.includes('reveillon_invalid'))
ok('sans jeu refusé', (await start(0, 'noel', 4, [])).err?.includes('reveillon_no_games'))
const s1 = (await start(0, 'noel', 4)).r
ok('démarrage : manche 1 tirée', s1?.phase === 'draw' && s1.round === 1 && GAMES.includes(s1.game_id) && s1.draw === 1 && s1.deck.length === 3, JSON.stringify(s1))
ok('scénario visible dans la ligne soirees', (await sc(soiree))?.game_id === s1.game_id)
ok('double démarrage refusé', (await start(0)).err?.includes('reveillon_already_on'))

// --- relance du tirage -------------------------------------------------------
const rr = (await call(0, `select public.reveillon_reroll($1, $2::text[]) r`, [soiree, arr(GAMES)])).r
ok('relance : autre jeu, draw+1', rr?.game_id !== s1.game_id && rr.draw === 2 && rr.phase === 'draw', JSON.stringify(rr))
ok('relance par un non-hôte refusée', (await call(1, `select public.reveillon_reroll($1, $2::text[]) r`, [soiree, arr(GAMES)])).err?.includes('not_host'))
// on force qui-de-nous pour pouvoir le lancer avec des options simples
await sys(`update public.soirees set scenario = scenario || '{"game_id":"qui-de-nous"}' where id = $1`, [soiree])
ok('manche suivante pendant le tirage refusée', (await next(0)).err?.includes('reveillon_wrong_phase'))

// --- manche 1 : partie annulée puis jouée -----------------------------------
const m0 = (await launch()).r
ok('lancement : partie créée, phase playing', Boolean(m0) && (await sc(soiree)).phase === 'playing' && (await sc(soiree)).match_id === m0, JSON.stringify(await sc(soiree)))
ok('relancer pendant la partie refusé', (await launch()).err?.includes('reveillon_wrong_phase'))
ok('arrêter pendant la partie refusé', (await call(0, `select public.reveillon_stop($1) r`, [soiree])).err?.includes('match_in_progress'))
await call(0, `select public.game_action($1, '{"type":"abort"}'::jsonb) r`, [m0])
const sa = await sc(soiree)
ok('partie annulée : retour au tirage, même jeu', sa.phase === 'draw' && sa.game_id === 'qui-de-nous' && sa.match_id === null && sa.history.length === 0, JSON.stringify(sa))
const m1 = (await launch()).r
await finish(m1, [B, C, A])
const s2 = await sc(soiree)
ok('fin de partie : phase défi', s2.phase === 'challenge' && CH.includes(s2.challenge?.id) && s2.deck.length === 2, JSON.stringify(s2))
ok('défi : gagnant B, perdant A', s2.challenge.winner_id === B && s2.challenge.loser_id === A && [A, B, C].includes(s2.challenge.random_id), JSON.stringify(s2.challenge))
const h1 = s2.history[0]
ok('historique : points 3/2/1, victoire B', h1.points[B] === 3 && h1.points[C] === 2 && h1.points[A] === 1 && h1.wins.length === 1 && h1.wins[0] === B && h1.double === false, JSON.stringify(h1))

// --- manche suivante ----------------------------------------------------------
const s3 = (await next(0, [A, C, D])).r
ok('bravo enregistré (hors soirée ignoré)', s3?.history[0].bravo.length === 2 && !s3.history[0].bravo.includes(D), JSON.stringify(s3?.history))
ok('manche 2 : nouveau jeu jamais joué', s3.round === 2 && s3.phase === 'draw' && s3.game_id !== 'qui-de-nous' && !s3.pool.includes('qui-de-nous') && s3.challenge === null, JSON.stringify(s3))
ok('défi suivant hors phase refusé', (await next(0)).err?.includes('reveillon_wrong_phase'))

// manches 2 à 4 (on force qui-de-nous pour lancer)
for (let r = 2; r <= 4; r++) {
  await sys(`update public.soirees set scenario = scenario || '{"game_id":"qui-de-nous"}' where id = $1`, [soiree])
  const m = (await launch()).r
  await finish(m, [C, A, B])
  if (r < 4) await next(0, [], GAMES)
}
const s4 = await sc(soiree)
ok('4 manches jouées, la dernière en double', s4.history.length === 4 && s4.history[3].double === true && s4.history[3].points[C] === 6, JSON.stringify(s4.history[3]))
ok('paquet de défis remélangé quand il est vide', s4.challenge?.id && CH.includes(s4.challenge.id), JSON.stringify(s4.challenge))
const s5 = (await next(0, [B])).r
ok('après la dernière manche : terminé', s5?.phase === 'finished' && s5.finished_at && s5.history[3].bravo[0] === B, JSON.stringify(s5))

// --- partie hors scénario : ignorée -------------------------------------------
const free = (await call(0, `select public.start_match($1, 'qui-de-nous', '{"questions":["Q"],"rounds":1}'::jsonb) r`, [soiree])).r
await finish(free, [A, B, C])
ok('partie normale après la fin : scénario inchangé', (await sc(soiree)).history.length === 4)

// --- récap / arrêt -------------------------------------------------------------
const rc = (await call(1, `select public.reveillon_recap($1) r`, [soiree])).r
ok('récap : scénario sans le paquet', rc?.theme === 'noel' && rc.history.length === 4 && !('deck' in rc) && !('challenge_ids' in rc), JSON.stringify(rc))
ok('récap refusé hors soirée', (await call(3, `select public.reveillon_recap($1) r`, [soiree])).err?.includes('not_in_soiree'))
await call(0, `select public.reveillon_stop($1) r`, [soiree])
ok('arrêt : refermé mais gardé', (await sc(soiree)).closed === true && (await sc(soiree)).history.length === 4)
ok('arrêter un scénario refermé : reveillon_off', (await call(0, `select public.reveillon_stop($1) r`, [soiree])).err?.includes('reveillon_off'))
const s6 = (await start(0, 'nouvel-an', 6)).r
ok('nouveau scénario après fermeture', s6?.theme === 'nouvel-an' && s6.rounds === 6 && s6.history.length === 0, JSON.stringify(s6))
await call(0, `select public.reveillon_stop($1) r`, [soiree])
ok('arrêt sans manche jouée : effacé', (await sc(soiree)) === null)

// --- fin de soirée : récap toujours là ------------------------------------------
await start(0, 'surprise', 4)
await sys(`update public.soirees set scenario = scenario || '{"game_id":"qui-de-nous"}' where id = $1`, [soiree])
const m9 = (await launch()).r
await finish(m9, [A, B, C])
await call(0, `select public.end_soiree($1) r`, [soiree])
const rc2 = (await call(2, `select public.reveillon_recap($1) r`, [soiree])).r
ok('soirée terminée : récap du scénario', rc2?.theme === 'surprise' && rc2.history.length === 1, JSON.stringify(rc2))
ok('soirée terminée : plus d’action', (await next(0)).err?.includes('soiree_ended'))
const solo = (await call(3, `select public.create_soiree('{}'::uuid[]) r`)).r.id
ok('seul dans le salon : not_enough_players', (await call(3, `select public.reveillon_start($1, 'noel', 4, $2::text[], $3::text[]) r`, [solo, arr(GAMES), arr(CH)])).err?.includes('not_enough_players'))

process.exit(failed ? 1 : 0)
