// Tests SQL du défi du jour (PGlite) : node daily.mjs ../../supabase/install.sql
// Tolérance aux interruptions : les manches jouées sont enregistrées une à une ; une tentative interrompue compte.
import { bootDb } from './boot.mjs'

const file = process.argv[2]
if (!file) throw new Error('usage : node daily.mjs <install.sql>')
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
const save = (i, idx, pts, ms = 1000) => call(i, `select public.save_daily_round($1, $2, $3) r`, [idx, pts, ms])
const board = async (i = 0) => (await call(i, `select public.daily_board() r`)).r
const rowOf = (b, who) => b.rows.find((x) => x.profile_id === who)
const xpOf = async (who) => Number((await sys(`select xp from public.profiles where id = $1`, [who]))[0].xp)
const ago = (who, min) => sys(`update public.daily_runs set started_at = now() - ($2 || ' minutes')::interval where profile_id = $1 and day = public._daily_day()`, [who, String(min)])

// --- enregistrement manche par manche -------------------------------------------
ok('save_daily_round avant le démarrage → daily_not_started', (await save(0, 0, 50)).err?.includes('daily_not_started'))
await call(0, `select public.start_daily() r`)
ok('manche 1 enregistrée avant la 0 (trou) → invalid_answers', (await save(0, 1, 50)).err?.includes('invalid_answers'))
ok('manche 0 enregistrée', (await save(0, 0, 90)).err === undefined)
await save(0, 1, 50)
await save(0, 2, 999) // plafonné à 100
await save(0, 0, 5) // rejoué (coupure réseau puis nouvel essai) : sans effet
const saved = (await sys(`select answers a from public.daily_runs where profile_id = $1 and day = public._daily_day()`, [A]))[0].a
ok('manche rejouée : sans effet ; points plafonnés', saved.length === 3 && saved[0].points === 90 && saved[2].points === 100, JSON.stringify(saved))
ok('manche 6 → invalid_answers', (await save(0, 6, 10)).err?.includes('invalid_answers'))
ok('points négatifs ramenés à 0', (await (async () => { await save(0, 3, -40); return (await sys(`select answers->3->>'points' p from public.daily_runs where profile_id=$1 and day=public._daily_day()`, [A]))[0].p === '0' })()))
ok('tentative en cours : pas encore au classement', rowOf(await board(), A) === undefined)
const t0 = (await call(0, `select public.daily_today() r`)).r
ok('daily_today : running avec temps restant', t0.status === 'running' && t0.secs_left > 0, JSON.stringify(t0))

// --- une tentative interrompue compte une fois les 10 minutes écoulées -------------------
const xp0 = await xpOf(A)
await ago(A, 11)
const b1 = await board()
ok('tentative expirée : au classement avec les manches jouées (90+50+100+0)', rowOf(b1, A)?.score === 240 && rowOf(b1, A)?.rank === 1, JSON.stringify(b1))
ok('XP créditée (score/10)', (await xpOf(A)) === xp0 + 24, String(await xpOf(A)))
await board()
ok('fermeture idempotente : XP créditée une seule fois', (await xpOf(A)) === xp0 + 24)
const t1 = (await call(0, `select public.daily_today() r`)).r
ok('daily_today : done, score et rang', t1.status === 'done' && t1.score === 240 && t1.rank === 1, JSON.stringify(t1))
ok('save après expiration → daily_already_done', (await save(0, 4, 50)).err?.includes('daily_already_done'))
const wk = (await call(2, `select public.daily_week_board() r`)).r
ok('classement de la semaine : la tentative fermée compte', wk.rows.some((x) => x.profile_id === A && x.score >= 240), JSON.stringify(wk))

// --- finish_daily : terminer maintenant avec les manches jouées ------------------------------
await call(1, `select public.start_daily() r`)
await save(1, 0, 60)
await save(1, 1, 80)
const fin = await call(1, `select public.finish_daily() r`)
ok('finish_daily : score = manches jouées, rang et joueurs renvoyés', fin.r?.score === 140 && fin.r?.rank === 2 && fin.r?.players === 2 && fin.r?.xp === 14, JSON.stringify(fin))
ok('finish_daily deux fois → daily_already_done', (await call(1, `select public.finish_daily() r`)).err?.includes('daily_already_done'))
ok('finish_daily sans tentative → daily_not_started', (await call(2, `select public.finish_daily() r`)).err?.includes('daily_not_started'))

// --- submit_daily complet après des enregistrements partiels : le total envoyé fait foi ---------------
await call(2, `select public.start_daily() r`)
await save(2, 0, 10)
const full = JSON.stringify(Array.from({ length: 6 }, () => ({ points: 50, ms: 900 })))
const sub = await call(2, `select public.submit_daily($1::jsonb) r`, [full])
ok('submit_daily complet : 6 × 50 = 300', sub.r?.score === 300, JSON.stringify(sub))

// --- jamais joué une manche, 10 minutes écoulées : tentative à 0 point ----------------------------
await call(3, `select public.start_daily() r`)
await ago(D, 12)
const b2 = await board(3)
ok('tentative sans aucune manche, expirée : 0 point, au classement', rowOf(b2, D)?.score === 0, JSON.stringify(b2))
const sub2 = await call(3, `select public.submit_daily($1::jsonb) r`, [full])
ok('submit_daily après fermeture → daily_already_done', sub2.err?.includes('daily_already_done'), JSON.stringify(sub2))

console.log(failed ? '\nÉCHEC' : '\nTout est OK')
process.exit(failed ? 1 : 0)
