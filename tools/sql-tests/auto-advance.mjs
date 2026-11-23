// Échéances automatiques : qui-de-nous, undercover, tu-preferes (appels directs aux fonctions de jeu).
// Usage : node tools/sql-tests/auto-advance.mjs supabase/install.sql
import { bootDb } from './boot.mjs'
const db = await bootDb(process.argv[2])
let fails = 0
const ok = (c, m) => {
  if (!c) {
    fails++
    console.log('FAIL', m)
  } else console.log('ok  ', m)
}
const ids = (await db.query(`select id from public.profiles order by sort_order limit 5`)).rows.map((r) => r.id)
const past = (st, extra = {}) => ({ ...st, deadline: new Date(Date.now() - 1000).toISOString(), ...extra })
const call = async (fn, state, server, actor, host, action) =>
  (await db.query(`select public.${fn}($1::jsonb,$2::jsonb,$3::uuid,$4,$5::jsonb) r`, [JSON.stringify(state), JSON.stringify(server), actor, host, JSON.stringify(action)])).rows[0].r
const start = async (fn, players, opts) => (await db.query(`select public.${fn}($1::uuid[],$2::jsonb) r`, [players, JSON.stringify(opts)])).rows[0].r

// ---------- qui-de-nous ----------
{
  const A = 'game_qui_de_nous_action'
  const r = await start('game_qui_de_nous_start', ids.slice(0, 3), { questions: ['q1', 'q2'], rounds: 2 })
  ok(!!r.state.deadline, 'qdn: deadline de vote au départ')
  const t = await call(A, r.state, r.server, ids[0], false, { type: 'tick' })
  ok(t.state.phase === 'voting', 'qdn: tick en avance ignoré')
  let v = r
  for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
    v = await call(A, v.state, v.server, ids[a], false, { type: 'vote', target: ids[b] })
    if (a === 0) ok(v.secrets?.[ids[0]]?.target === ids[1] && v.secrets[ids[0]].round === 1, 'qdn: secret du vote renvoyé')
  }
  ok(v.state.phase === 'reveal', 'qdn: révélation quand tous ont voté')
  ok(v.state.last_reveal.majority.length === 0 && v.state.last_reveal.scorers.length === 0, 'qdn: triangle -> pas de majorité')
  ok(Object.values(v.state.scores).every((x) => x === 0), 'qdn: triangle -> personne ne marque')
  ok(!!v.state.deadline, 'qdn: deadline de suite après reveal')
  let d2 = await start('game_qui_de_nous_start', ids.slice(0, 2), { questions: ['q'], rounds: 1 })
  d2 = await call(A, d2.state, d2.server, ids[0], false, { type: 'vote', target: ids[1] })
  d2 = await call(A, d2.state, d2.server, ids[1], false, { type: 'vote', target: ids[0] })
  ok(d2.state.last_reveal.majority.length === 2, 'qdn: 2 joueurs, égalité 1-1 inchangée')
  const early = await call(A, v.state, v.server, ids[1], false, { type: 'tick' })
  ok(early.state.phase === 'reveal', 'qdn: tick reveal en avance ignoré')
  const adv = await call(A, past(v.state), v.server, ids[1], false, { type: 'tick' })
  ok(adv.state.phase === 'voting' && adv.state.round === 2 && !!adv.state.deadline, 'qdn: tick reveal -> manche 2')
  const again = await call(A, adv.state, adv.server, ids[2], false, { type: 'tick' })
  ok(again.state.round === 2, 'qdn: tick idempotent')
  const rev = await call(A, past(adv.state), adv.server, ids[0], false, { type: 'tick' })
  ok(rev.state.phase === 'reveal', 'qdn: tick voting expiré -> reveal')
  const fin = await call(A, past(rev.state), rev.server, ids[0], false, { type: 'tick' })
  ok(fin.state.phase === 'finished', 'qdn: tick dernière manche -> finished')
  const old = { ...r.state }
  delete old.deadline
  const o = await call(A, old, r.server, ids[0], false, { type: 'tick' })
  ok(o.state.phase === 'voting', 'qdn: ancien state sans deadline OK')
}

// ---------- undercover ----------
{
  const A = 'game_undercover_action'
  const pl = ids.slice(0, 4)
  const r = await start('game_undercover_start', pl, { pair: ['chat', 'chien'] })
  ok(!!r.state.vote_unlock, 'uc: vote_unlock au départ')
  let err = null
  try {
    await call(A, r.state, r.server, pl[1], false, { type: 'start_vote' })
  } catch (e) {
    err = e.message
  }
  ok(err && err.includes('not_host'), 'uc: joueur ne peut pas lancer le vote avant 90 s')
  const unlocked = { ...r.state, vote_unlock: new Date(Date.now() - 1000).toISOString() }
  const sv = await call(A, unlocked, r.server, pl[1], false, { type: 'start_vote' })
  ok(sv.state.phase === 'vote' && !!sv.state.deadline, 'uc: joueur lance le vote après 90 s, deadline 60 s')
  const t0 = await call(A, sv.state, sv.server, pl[0], false, { type: 'tick' })
  ok(t0.state.phase === 'vote', 'uc: tick vote en avance ignoré')
  const vv = await call(A, sv.state, sv.server, pl[0], false, { type: 'vote', target: pl[1] })
  const tl = await call(A, past(vv.state), vv.server, pl[2], false, { type: 'tick' })
  ok(tl.state.phase !== 'vote' || tl.state.revote === true, 'uc: tick vote expiré -> dépouillement (' + tl.state.phase + ')')
  const el = await call(A, sv.state, { ...sv.server, votes: { [pl[0]]: pl[1], [pl[2]]: pl[1], [pl[3]]: pl[1] } }, pl[0], true, { type: 'close_vote' })
  ok((el.state.phase === 'elimination' || el.state.phase === 'mrwhite_guess') && !!el.state.deadline, 'uc: élimination avec deadline')
  if (el.state.phase === 'elimination') {
    const earlyN = await call(A, el.state, el.server, pl[2], false, { type: 'tick' })
    ok(earlyN.state.phase === 'elimination', 'uc: tick élimination en avance ignoré')
    const nx = await call(A, past(el.state), el.server, pl[2], false, { type: 'tick' })
    ok(['describe', 'finished'].includes(nx.state.phase), 'uc: tick élimination -> suite (' + nx.state.phase + ')')
    if (nx.state.phase === 'describe') ok(!!nx.state.vote_unlock && nx.state.round === 2, 'uc: nouvelle manche, nouveau délai')
    const again = await call(A, nx.state, nx.server, pl[3], false, { type: 'tick' })
    ok(again.state.phase === nx.state.phase && again.state.round === nx.state.round, 'uc: tick idempotent')
  }
  const mwState = { ...sv.state, phase: 'mrwhite_guess', current_elimination: { profile_id: pl[1], role: 'mrwhite', round: 1 }, deadline: new Date(Date.now() - 1000).toISOString() }
  const mw = await call(A, mwState, sv.server, pl[0], false, { type: 'tick' })
  ok(mw.state.phase === 'elimination' && mw.state.mrwhite_guess.correct === false && new Date(mw.state.deadline) > new Date(), 'uc: devinette expirée -> pas trouvé')
}

// ---------- tu-preferes ----------
{
  const A = 'game_tu_preferes_action'
  const pl = ids.slice(0, 3)
  let r = await start('game_tu_preferes_start', pl, { dilemmas: [1, 2].map((i) => ({ id: 'd' + i, a: 'A' + i, b: 'B' + i })), rounds: 2 })
  for (const p of pl) r = await call(A, r.state, r.server, p, false, { type: 'answer', round: 1, choice: 'a', bet: 'a' })
  ok(r.state.phase === 'reveal' && !!r.state.deadline, 'tp: reveal avec deadline')
  const e = await call(A, r.state, r.server, pl[0], false, { type: 'tick' })
  ok(e.state.phase === 'reveal', 'tp: tick reveal en avance ignoré')
  const n = await call(A, past(r.state), r.server, pl[0], false, { type: 'tick' })
  ok(n.state.phase === 'answering' && n.state.round === 2, 'tp: tick reveal -> dilemme 2')
  const n2 = await call(A, n.state, n.server, pl[1], false, { type: 'tick' })
  ok(n2.state.round === 2 && n2.state.phase === 'answering', 'tp: tick idempotent')
  const rv = await call(A, past(n.state), n.server, pl[0], false, { type: 'tick' })
  ok(rv.state.phase === 'reveal', 'tp: tick answering expiré -> reveal')
  const f = await call(A, past(rv.state), rv.server, pl[0], false, { type: 'tick' })
  ok(f.state.phase === 'finished', 'tp: tick dernière manche -> finished')
}
console.log(fails ? `${fails} ECHEC(S)` : 'TOUT OK')
process.exit(fails ? 1 : 0)
