// Tests SQL : auto-avance / accélérateurs de cerveau-en-fete, le-plus-proche, petit-bac.
// node auto-avance-3jeux.mjs ../../supabase/install.sql
import { bootDb } from './boot.mjs'

const file = process.argv[2]
if (!file) throw new Error('usage : node auto-avance-3jeux.mjs <install.sql>')
const db = await bootDb(file)
let failed = false
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK   ' : 'ÉCHEC'} ${name}${cond ? '' : ' ' + extra}`)
  if (!cond) failed = true
}
const ids = (await db.query(`select id from public.profiles order by sort_order limit 5`)).rows.map((r) => r.id)
const [A, B, C, D] = ids
const start = async (fn, players, opts) =>
  (await db.query(`select public.game_${fn}_start($1::uuid[], $2::jsonb) r`, [`{${players.join(',')}}`, JSON.stringify(opts)])).rows[0].r
const act = async (fn, st, sv, actor, host, action) => {
  try {
    return (await db.query(`select public.game_${fn}_action($1::jsonb,$2::jsonb,$3::uuid,$4,$5::jsonb) r`, [st, sv, actor, host, action])).rows[0].r
  } catch (e) {
    return { err: e.message }
  }
}
const secs = (iso) => (new Date(iso).getTime() - Date.now()) / 1000
const past = (st) => ({ ...st, deadline: new Date(Date.now() - 1000).toISOString() })

/* ---------------- cerveau-en-fete ---------------- */
{
  const qs = [1, 2].map((i) => ({ id: 'q' + i, theme: 't', difficulty: 1, prompt: 'Capitale de la France ' + i, answer: 'Paris', mode: 'typed' }))
  const g = await start('cerveau_en_fete', [A, B, C, D], { duration: 60, questions: qs })
  const F = 'cerveau_en_fete'
  ok('cef : deadline initiale ~60 s', secs(g.state.deadline) > 50)
  let r = await act(F, g.state, g.server, A, false, { type: 'answer', text: 'Paris', round: 1 })
  ok('cef : 1/4 trouvé -> deadline inchangée', secs(r.state.deadline) > 50)
  r = await act(F, r.state, r.server, B, false, { type: 'pass', round: 1 })
  ok('cef : 2/4 (pas majorité) -> inchangée', secs(r.state.deadline) > 50)
  r = await act(F, r.state, r.server, C, false, { type: 'answer', text: 'Paris', round: 1 })
  ok('cef : 3/4 majorité -> deadline ~8 s', secs(r.state.deadline) <= 8.5 && secs(r.state.deadline) > 6, String(secs(r.state.deadline)))
  const g2 = await start(F, [A, B], { duration: 60, questions: qs })
  r = await act(F, g2.state, g2.server, A, false, { type: 'answer', text: 'Paris', round: 1 })
  ok('cef : 2 joueurs, 1 trouvé -> pas d’accélération', secs(r.state.deadline) > 50)
  const st3 = { ...g.state, deadline: new Date(Date.now() + 3000).toISOString() }
  r = await act(F, st3, g.server, A, false, { type: 'answer', text: 'Paris', round: 1 })
  r = await act(F, r.state, r.server, B, false, { type: 'pass', round: 1 })
  r = await act(F, r.state, r.server, C, false, { type: 'pass', round: 1 })
  ok('cef : deadline jamais allongée', secs(r.state.deadline) <= 3.5, String(secs(r.state.deadline)))
}

/* ---------------- le-plus-proche ---------------- */
{
  const F = 'le_plus_proche'
  const qs = [1, 2].map((i) => ({ id: 'l' + i, theme: 't', difficulty: 1, prompt: 'Combien ' + i, answer: 100, unit: null, note: null }))
  const g = await start(F, [A, B, C], { duration: 60, questions: qs })
  let r = await act(F, g.state, g.server, A, false, { type: 'answer', round: 1, value: 90 })
  ok('lpp : 1/3 -> inchangée', secs(r.state.deadline) > 50)
  r = await act(F, r.state, r.server, B, false, { type: 'answer', round: 1, value: 120 })
  ok('lpp : tous sauf un -> deadline ~8 s', secs(r.state.deadline) <= 8.5 && secs(r.state.deadline) > 6, String(secs(r.state.deadline)))
  r = await act(F, r.state, r.server, C, false, { type: 'answer', round: 1, value: 100 })
  ok('lpp : reveal avec deadline auto', r.state.phase === 'reveal' && secs(r.state.deadline) > 10, JSON.stringify(r.state.deadline))
  let t = await act(F, r.state, r.server, A, false, { type: 'tick' })
  ok('lpp : tick en avance en reveal ignoré', t.state.phase === 'reveal')
  t = await act(F, past(r.state), r.server, A, false, { type: 'tick' })
  ok('lpp : tick à l’échéance -> manche 2', t.state.phase === 'question' && t.state.round === 2, t.state?.phase + ' ' + t.err)
  const r2 = await act(F, t.state, t.server, A, true, { type: 'reveal', round: 2 })
  const t2 = await act(F, past(r2.state), r2.server, B, false, { type: 'tick' })
  ok('lpp : tick à l’échéance de la dernière -> finished', t2.state.phase === 'finished', t2.state?.phase + ' ' + t2.err)
  const old = { ...r.state, deadline: null }
  t = await act(F, old, r.server, A, false, { type: 'tick' })
  ok('lpp : reveal ancien sans deadline -> tick inerte', t.state.phase === 'reveal')
}

/* ---------------- petit-bac ---------------- */
{
  const F = 'petit_bac'
  const cats = [{ id: 'ville', label: 'Ville', emoji: '🏙️' }, { id: 'animal', label: 'Animal', emoji: '🦁' }]
  const norm = async (x) => (await db.query(`select public._pb_norm($1) r`, [x])).rows[0].r
  ok('pb : lion = lions', (await norm('lion')) === (await norm('Lions')) && (await norm('lions')) === 'lion')
  ok('pb : bus reste bus (≤ 3)', (await norm('bus')) === 'bus')
  ok('pb : chevaux -> chevau (x final)', (await norm('chevaux')) === 'chevau')
  const g = await start(F, [A, B, C], { categories: cats, letters: ['L'], rounds: 1 })
  let st = g.state
  let sv = g.server
  const save = async (p, ans) => {
    const x = await act(F, st, sv, p, false, { type: 'save', round: 1, answers: ans })
    st = x.state
    sv = x.server
  }
  await save(A, { ville: "L'Italie", animal: 'Lion' })
  await save(B, { ville: 'La Réunion', animal: 'Lions' })
  await save(C, { ville: 'Le Havre', animal: 'Panda' })
  const r = await act(F, st, sv, A, true, { type: 'end_round' })
  const v = r.state.validation
  ok('pb : validation a une deadline ~15 s', secs(v.deadline) > 12 && secs(v.deadline) <= 15.5)
  ok("pb : L'Italie acceptée pour L", v.answers.ville[A].auto === null)
  ok('pb : La Réunion acceptée pour L', v.answers.ville[B].auto === null)
  ok('pb : Le Havre accepté pour L (texte brut)', v.answers.ville[C].auto === null)
  ok('pb : Panda refusé', v.answers.animal[C].auto === 'letter')
  st = r.state
  sv = r.server
  let t = await act(F, st, sv, A, false, { type: 'tick' })
  ok('pb : tick en avance inerte', t.state.validation.cat_index === 0)
  t = await act(F, { ...st, validation: { ...st.validation, deadline: new Date(Date.now() - 1000).toISOString() } }, sv, A, false, { type: 'tick' })
  ok('pb : tick à l’échéance -> catégorie 2 + nouvelle deadline', t.state.validation.cat_index === 1 && secs(t.state.validation.deadline) > 12, JSON.stringify(t.state.validation?.cat_index))
  const near = { ...st, validation: { ...st.validation, deadline: new Date(Date.now() + 2000).toISOString() } }
  const c = await act(F, near, sv, B, false, { type: 'contest', category: 'ville', target: A, value: true })
  ok('pb : contestation -> deadline ~8 s', secs(c.state.validation.deadline) > 6 && secs(c.state.validation.deadline) <= 8.5, String(secs(c.state.validation.deadline)))
  const last = { ...t.state, validation: { ...t.state.validation, deadline: new Date(Date.now() - 1000).toISOString() } }
  t = await act(F, last, sv, B, false, { type: 'tick' })
  ok('pb : tick sur la dernière catégorie -> round_score', t.state.phase === 'round_score', t.state?.phase + t.err)
  const d = t.state.last_round.detail.animal
  ok('pb : lion et lions = doublon', d[A].status === 'shared' && d[B].status === 'shared', JSON.stringify(d))

  // 2 joueurs : un seul 👎 ne refuse pas
  const g2 = await start(F, [A, B], { categories: [cats[0]], letters: ['L'], rounds: 1 })
  let s2 = g2.state
  let v2 = g2.server
  let q = await act(F, s2, v2, A, false, { type: 'save', round: 1, answers: { ville: 'Lyon' } })
  s2 = q.state
  v2 = q.server
  q = await act(F, s2, v2, B, false, { type: 'save', round: 1, answers: { ville: 'Lille' } })
  s2 = q.state
  v2 = q.server
  q = await act(F, s2, v2, A, true, { type: 'end_round' })
  q = await act(F, q.state, q.server, B, false, { type: 'contest', category: 'ville', target: A, value: true })
  q = await act(F, q.state, q.server, A, true, { type: 'close_validation' })
  ok('pb : à 2 joueurs un 👎 ne refuse pas', q.state.last_round.detail.ville[A].status === 'unique', JSON.stringify(q.state.last_round?.detail))

  // 3 joueurs : 2 👎 refusent toujours
  let w = await act(F, r.state, r.server, B, false, { type: 'contest', category: 'ville', target: A, value: true })
  w = await act(F, w.state, w.server, C, false, { type: 'contest', category: 'ville', target: A, value: true })
  w = await act(F, w.state, w.server, A, true, { type: 'close_validation' })
  ok('pb : à 3 joueurs 2 👎 refusent', w.state.last_round.detail.ville[A].status === 'refused', JSON.stringify(w.state.last_round?.detail?.ville?.[A]))
}

/* ---------------- petit-bac : auto-avance de round_score ---------------- */
{
  const F = 'petit_bac'
  const cats = [{ id: 'ville', label: 'Ville', emoji: '🏙️' }]
  const g = await start(F, [A, B], { categories: cats, letters: ['L', 'M'], rounds: 2 })
  let q = await act(F, g.state, g.server, A, false, { type: 'save', round: 1, answers: { ville: 'Lyon' } })
  q = await act(F, q.state, q.server, A, true, { type: 'end_round' })
  q = await act(F, q.state, q.server, A, true, { type: 'close_validation' })
  ok('pb : round_score a un score_deadline ~20 s', q.state.phase === 'round_score' && secs(q.state.score_deadline) > 15)
  let t = await act(F, q.state, q.server, B, false, { type: 'tick' })
  ok('pb : tick en avance en round_score inerte', t.state.phase === 'round_score')
  const old = { ...q.state }
  delete old.score_deadline
  t = await act(F, old, q.server, B, false, { type: 'tick' })
  ok('pb : round_score ancien sans deadline -> tick inerte', t.state.phase === 'round_score')
  const due = { ...q.state, score_deadline: new Date(Date.now() - 1000).toISOString() }
  t = await act(F, due, q.server, B, false, { type: 'tick' })
  ok('pb : tick à l’échéance -> manche 2', t.state.phase === 'writing' && t.state.round === 2, t.state?.phase + t.err)
  // dernière manche -> finished
  const lastDue = { ...due, round: 2 }
  t = await act(F, lastDue, q.server, B, false, { type: 'tick' })
  ok('pb : tick à l’échéance de la dernière -> finished', t.state.phase === 'finished', t.state?.phase + t.err)
}

console.log(failed ? '\nÉCHEC' : '\nTout est OK')
process.exit(failed ? 1 : 0)
