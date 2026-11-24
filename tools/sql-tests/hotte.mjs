// Tests SQL de la Hotte du jour (événement de Noël) (PGlite) : node hotte.mjs ../../supabase/install.sql
import { bootDb } from './boot.mjs'

const file = process.argv[2]
if (!file) throw new Error('usage : node hotte.mjs <install.sql>')
const db = await bootDb(file)
let failed = false
const ok = (n, c, x = '') => {
  console.log(`${c ? 'OK   ' : 'ÉCHEC'} ${n}${c ? '' : ' ' + x}`)
  if (!c) failed = true
}
const uid = (i) => `aaaaaaaa-0000-0000-0000-0000000000${String(i).padStart(2, '0')}`
const prof = (await db.query(`select id from public.profiles where not is_guest order by sort_order limit 3`)).rows
const [A, B] = prof.map((p) => p.id)
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
const setNow = (iso) => db.query(`create or replace function public._season_now() returns timestamptz language sql stable as $$ select '${iso}'::timestamptz $$`)
const start = (u) => call(u, `select public.hotte_start() r`)
const answer = (u, round, a) => call(u, `select public.hotte_answer($1, $2) r`, [round, String(a)])
const board = (u) => call(u, `select public.hotte_board() r`)
const roundsOf = async (day) => (await one(`select public._hotte_rounds($1::date) r`, [day])).r

// ---- Banques réelles (Task 2 : contenu écrit pour l'événement) — SKIP_BANKS=1 pour les sauter
if (!process.env.SKIP_BANKS) {
  const n = async (t) => (await one(`select count(*)::int n from public.${t}`)).n
  ok('banque quiz : 40 questions', (await n('hotte_quiz')) === 40, String(await n('hotte_quiz')))
  ok('banque chansons : 20 extraits', (await n('hotte_songs')) === 20, String(await n('hotte_songs')))
  ok('banque « combien » : 20 questions', (await n('hotte_estimates')) === 20, String(await n('hotte_estimates')))
  const dupQ = (await one(`select count(*)::int n from (select prompt from public.hotte_quiz group by prompt having count(*) > 1) x`)).n
  const dupS = (await one(`select count(*)::int n from (select line from public.hotte_songs group by line having count(*) > 1) x`)).n
  const dupE = (await one(`select count(*)::int n from (select prompt from public.hotte_estimates group by prompt having count(*) > 1) x`)).n
  ok('banques : pas de doublon', dupQ + dupS + dupE === 0)
  const badOpts = (await one(`select count(*)::int n from (
      select answer, distractors from public.hotte_quiz union all select answer, distractors from public.hotte_songs) x
    where cardinality(distractors) <> 3 or answer = any(distractors)
       or (select count(distinct d) from unnest(distractors) d) <> 3`)).n
  ok('QCM : 3 distracteurs distincts, jamais la bonne réponse', badOpts === 0, String(badOpts))
  const badLine = (await one(`select count(*)::int n from public.hotte_songs
    where (length(line) - length(replace(line, '___', ''))) / 3 <> 1`)).n
  ok('chansons : exactement un « ___ » par extrait', badLine === 0, String(badLine))
  const badEst = (await one(`select count(*)::int n from public.hotte_estimates where answer <= 0 or coalesce(btrim(unit), '') = ''`)).n
  ok('« combien » : valeur > 0 et unité', badEst === 0, String(badEst))
}

// ---- Fixtures (indépendantes du contenu réel)
await db.exec(`delete from public.hotte_quiz; delete from public.hotte_songs; delete from public.hotte_estimates`)
for (let i = 1; i <= 6; i++) await db.query(`insert into public.hotte_quiz(prompt, answer, distractors) values ($1, $2, $3)`, [`Question ${i} ?`, `Bonne ${i}`, [`Faux ${i}a`, `Faux ${i}b`, `Faux ${i}c`]])
for (let i = 1; i <= 4; i++) await db.query(`insert into public.hotte_songs(line, answer, distractors) values ($1, $2, $3)`, [`Mon beau ___ ${i}`, `sapin${i}`, [`x${i}`, `y${i}`, `z${i}`]])
for (let i = 1; i <= 4; i++) await db.query(`insert into public.hotte_estimates(prompt, answer, unit) values ($1, $2, 'rennes')`, [`Combien ${i} ?`, 10 * i])

// ---- Hors période
await setNow('2026-11-30T12:00:00Z')
ok('avant le 1er décembre : fermée', (await start(uid(0))).err === 'hotte_closed')
await setNow('2027-01-07T12:00:00Z')
ok('après le 6 janvier : fermée', (await start(uid(0))).err === 'hotte_closed')

// ---- Composition du jour
await setNow('2026-12-05T09:00:00Z')
const s1 = await start(uid(0))
ok('hotte_start : 5 manches', !s1.err && s1.r.rounds.length === 5 && s1.r.day === '2026-12-05', s1.err ?? JSON.stringify(s1.r))
const types = s1.r.rounds.map((r) => r.type)
const counts = types.reduce((m, t) => ({ ...m, [t]: (m[t] ?? 0) + 1 }), {})
ok('au moins 1 quiz, au plus 2 du même type', counts.quiz >= 1 && Object.values(counts).every((c) => c <= 2), types.join(','))
ok('types connus', types.every((t) => ['quiz', 'memoire', 'intrus', 'proche', 'chanson'].includes(t)))
ok('aucune réponse envoyée', !JSON.stringify(s1.r.rounds).includes('"answer"'))
const shapeOk = s1.r.rounds.every((r) =>
  r.type === 'quiz' ? r.prompt && r.options.length === 4
  : r.type === 'chanson' ? r.line.includes('___') && r.options.length === 4
  : r.type === 'memoire' ? r.shown.length === 6 && r.remaining.length === 5 && r.options.length === 4
  : r.type === 'intrus' ? r.grid.length === 9
  : r.type === 'proche' ? r.prompt && r.unit
  : false)
ok('formats publics des manches', shapeOk, JSON.stringify(s1.r.rounds))
const sB = await start(uid(1))
ok('même Hotte pour toute la bande', JSON.stringify(sB.r.rounds) === JSON.stringify(s1.r.rounds))
const full5 = await roundsOf('2026-12-05')
const full6 = await roundsOf('2026-12-06')
ok('autre jour, autre Hotte', JSON.stringify(full5) !== JSON.stringify(full6))
ok('_hotte_rounds déterministe', JSON.stringify(await roundsOf('2026-12-05')) === JSON.stringify(full5))
const mem = full5.find((r) => r.type === 'memoire')
if (mem) ok('mémoire : le disparu est dans shown, pas dans remaining, et proposé', mem.shown.includes(mem.answer) && !mem.remaining.includes(mem.answer) && mem.options.includes(mem.answer))
const intr = full5.find((r) => r.type === 'intrus')
if (intr) ok('intrus : présent une fois dans la grille', intr.grid.filter((x) => x === intr.answer).length === 1)

// ---- Les 37 jours : chaque Hotte est valide et tous les types apparaissent
{
  const seen = new Set()
  let allOk = true
  for (let t = Date.UTC(2026, 11, 1); t <= Date.UTC(2027, 0, 6); t += 86400000) {
    const day = new Date(t).toISOString().slice(0, 10)
    const rs = await roundsOf(day)
    rs.forEach((r) => seen.add(r.type))
    if (rs.length !== 5 || !rs.some((r) => r.type === 'quiz') || rs.some((r) => r.answer == null || r.answer === '')) allOk = false
    const p = rs.find((r) => r.type === 'proche')
    if (p && !/^[0-9]+([.][0-9]+)?$/.test(p.answer)) allOk = false
  }
  ok('37 jours : 5 manches valides chaque jour', allOk)
  ok('37 jours : les 5 types apparaissent', seen.size === 5, [...seen].join(','))
}

// ---- Réponses (A)
const a1 = await answer(uid(0), 1, full5[0].answer)
ok('bonne réponse manche 1', !a1.err && a1.r.ok === true && a1.r.score === 1 && a1.r.finished === false, a1.err ?? JSON.stringify(a1.r))
ok('répondre deux fois à la même manche refusé', (await answer(uid(0), 1, full5[0].answer)).err === 'hotte_bad_round')
ok('manche 6 refusée', (await answer(uid(0), 6, 'x')).err === 'hotte_bad_round')
let score = 1
for (let i = 2; i <= 5; i++) {
  const r = full5[i - 1]
  const wrong = i === 2
  const a = await answer(uid(0), i, wrong ? 'mauvaise réponse' : r.answer)
  if (!wrong) score++
  ok(`manche ${i} (${r.type}) ${wrong ? 'fausse' : 'juste'}`, !a.err && a.r.ok === !wrong && a.r.correct === String(r.answer), a.err ?? JSON.stringify(a.r))
}
const fin = await one(`select score, finished_at is not null f from public.hotte_runs where profile_id = $1 and day = '2026-12-05'`, [A])
ok('Hotte finie, score enregistré', fin.f && fin.score === score, JSON.stringify(fin))
ok('second essai refusé', (await start(uid(0))).err === 'hotte_done')

// ---- Proche : tolérance ±15 % (au moins ±1)
const proche = await one(`select public._hotte_proche_ok($1, $2) a, public._hotte_proche_ok($3, $2) b, public._hotte_proche_ok($4, 10) c, public._hotte_proche_ok($5, 10) d`, ['114', 100, '116', '9', '12'])
ok('proche : +14 % juste, +16 % faux, ±1 sur petite valeur', proche.a === true && proche.b === false && proche.c === true && proche.d === false, JSON.stringify(proche))

// ---- Reprise et expiration (B)
await answer(uid(1), 1, full5[0].answer)
await answer(uid(1), 2, 'raté')
const resume = await start(uid(1))
ok('reprise : mêmes manches et réponses déjà données', !resume.err && JSON.stringify(resume.r.rounds) === JSON.stringify(s1.r.rounds) && resume.r.answers.length === 2 && resume.r.finished === false, resume.err ?? JSON.stringify(resume.r?.answers))
ok('classement avant d’avoir fini : refusé', (await board(uid(1))).err === 'hotte_not_done')
await setNow('2026-12-05T09:06:00Z')
const bd = await board(uid(0))
const rowB = await one(`select score, finished_at is not null f from public.hotte_runs where profile_id = $1 and day = '2026-12-05'`, [B])
ok('après 5 min : essai clos avec le score partiel', rowB.f && rowB.score === 1, JSON.stringify(rowB))
ok('classement : trié par score puis durée', !bd.err && bd.r.length === 2 && bd.r[0].profile_id === A && bd.r[1].profile_id === B && typeof bd.r[0].secs === 'number', bd.err ?? JSON.stringify(bd.r))

// ---- Minuit à Paris : une Hotte commencée à 23:58 reste celle de ce jour
await setNow('2026-12-06T22:58:00Z')
const late = await start(uid(2))
await setNow('2026-12-06T23:01:00Z')
const fullL = await roundsOf('2026-12-06')
await answer(uid(2), 1, fullL[0].answer)
const rowL = await one(`select day::text d, jsonb_array_length(answers) n from public.hotte_runs where profile_id = $1`, [prof[2].id])
ok('minuit : réponse rattachée au jour de départ', !late.err && late.r.day === '2026-12-06' && rowL.d === '2026-12-06' && rowL.n === 1, JSON.stringify(rowL))

// ---- Invités
await setNow('2026-12-07T10:00:00Z')
const sid = (await call(uid(0), `select public.create_soiree('{}') r`)).r.id
const tok = (await call(uid(0), `select public.open_guest_invites($1) r`, [sid])).r.token
await call(uid(10), `select public.join_as_guest($1, 'Léa', 'renard') r`, [tok])
ok('invité : refusé', (await start(uid(10))).err === 'guest_forbidden')

console.log(failed ? '\nDES TESTS ONT ÉCHOUÉ' : '\nTous les tests passent')
process.exit(failed ? 1 : 0)
