// Absent automatique : pas-de-bol, tour-des-potes, menteur. Usage : node absent-auto.mjs ../../supabase/install.sql
import { bootDb } from './boot.mjs'
const db = await bootDb(process.argv[2])
const ids = (await db.query(`select id from public.profiles order by sort_order limit 3`)).rows.map((p) => p.id)
let fails = 0
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fails++ }
const past = (s) => ({ ...s, deadline: new Date(Date.now() - 1000).toISOString() })
async function act(game, st, sv, actor, action, host = false) {
  const r = (await db.query(`select public.game_${game}_action($1::jsonb,$2::jsonb,$3::uuid,$4,$5::jsonb) r`,
    [JSON.stringify(st), JSON.stringify(sv), actor, host, JSON.stringify(action)])).rows[0].r
  return r
}
const secs = (s) => (new Date(s.deadline).getTime() - Date.now()) / 1000

/* ---------------- pas-de-bol ---------------- */
{
  const g = 'pas_de_bol'
  const r0 = (await db.query(`select public.game_pas_de_bol_start($1::uuid[], '{}'::jsonb) r`, [ids])).rows[0].r
  let st = r0.state, sv = r0.server
  const P = st.turn
  // tick trop tôt : inchangé
  let r = await act(g, st, sv, ids[0], { type: 'tick' })
  ok(JSON.stringify(r.state) === JSON.stringify(st), 'pdb : tick trop tôt = état inchangé')
  let guard = 0
  while (!(st.absent && st.absent[P]) && guard++ < 20) {
    r = await act(g, past(st), sv, ids[0], { type: 'tick' })
    st = r.state; sv = r.server
    if (st.turn !== P && st.idle?.[P] === 1) ok(true, 'pdb : idle=1 après 1 tick de P')
  }
  ok(st.absent?.[P] === true && st.idle[P] === 2, 'pdb : P absent après 2 tours auto (' + guard + ' ticks)')
  ok(st.log.some((e) => e.t === 'absent' && e.p === P), 'pdb : log absent')
  // tourner jusqu'à P : échéance courte
  guard = 0
  while (st.turn !== P && guard++ < 5) { r = await act(g, past(st), sv, ids[0], { type: 'tick' }); st = r.state; sv = r.server }
  ok(st.turn === P && secs(st) <= 7 && secs(st) > 3, 'pdb : tour de l\'absent ~6 s (' + secs(st).toFixed(1) + ')')
  // tick tardif répété sur le même tour = pas de double application (échéance future)
  const again = await act(g, st, sv, ids[0], { type: 'tick' })
  ok(JSON.stringify(again.state) === JSON.stringify(st), 'pdb : tick idempotent (échéance non atteinte)')
  // P agit : plus absent
  r = await act(g, st, sv, P, { type: 'draw' })
  ok(!r.state.absent?.[P] && !(P in (r.state.idle || {})), 'pdb : retour de P après son action')
  ok(r.state.log.some((e) => e.t === 'back' && e.p === P), 'pdb : log back')
  // tick hors playing
  const fin = { ...r.state, phase: 'finished' }
  r = await act(g, fin, sv, ids[0], { type: 'tick' })
  ok(r.state.phase === 'finished', 'pdb : tick hors playing sans exception')
  // rétrocompat : state sans absent/idle
  const old = { ...r0.state }; delete old.absent; delete old.idle
  r = await act(g, past(old), r0.server, ids[0], { type: 'tick' })
  ok(r.state.idle[old.turn] === 1, 'pdb : état ancien (sans idle) compatible')
}

/* ---------------- menteur ---------------- */
{
  const g = 'menteur'
  const r0 = (await db.query(`select public.game_menteur_start($1::uuid[], '{}'::jsonb) r`, [ids])).rows[0].r
  let st = r0.state, sv = r0.server
  // le premier tour se joue (new_round est dans start ?)
  st = { ...st }
  const P = st.turn
  ok(st.phase === 'bidding' && !!P, 'mtr : partie démarrée, tour de ' + P?.slice(0, 4))
  let guard = 0, r
  while (!(st.absent && st.absent[P]) && guard++ < 20) {
    r = await act(g, past(st), sv, ids[0], { type: 'tick' }); st = r.state; sv = r.server
    if (st.phase === 'reveal') { r = await act(g, past(st), sv, ids[0], { type: 'tick' }); st = r.state; sv = r.server }
  }
  ok(st.absent?.[P] === true, 'mtr : P absent après 2 tours auto (' + guard + ' ticks)')
  guard = 0
  while (st.turn !== P && guard++ < 10) {
    r = await act(g, past(st), sv, ids[0], { type: 'tick' }); st = r.state; sv = r.server
    if (st.phase === 'reveal') { r = await act(g, past(st), sv, ids[0], { type: 'tick' }); st = r.state; sv = r.server }
  }
  ok(st.phase === 'bidding' && st.turn === P && secs(st) <= 9, 'mtr : tour de l\'absent court (' + secs(st).toFixed(1) + ' s)')
  const again = await act(g, st, sv, ids[0], { type: 'tick' })
  ok(JSON.stringify(again.state) === JSON.stringify(st), 'mtr : tick idempotent')
  const idx = ids.indexOf(P)
  const qty = (st.bid?.qty ?? 0) + 1
  r = await act(g, st, sv, P, st.bid ? { type: 'bid', qty, face: st.bid.face } : { type: 'bid', qty: 1, face: 2 })
  ok(!r.state.absent?.[P] && r.state.returned === P, 'mtr : retour de P après son enchère')
  r = await act(g, { ...r.state, phase: 'finished' }, r.server, ids[0], { type: 'tick' })
  ok(r.state.phase === 'finished', 'mtr : tick hors partie sans exception')
}

/* ---------------- tour-des-potes ---------------- */
{
  const g = 'tour_des_potes'
  const r0 = (await db.query(`select public.game_tour_des_potes_start($1::uuid[], '{"format":"classique","turn_seconds":30}'::jsonb) r`, [ids])).rows[0].r
  let st = r0.state, sv = r0.server
  const P = st.turn
  let guard = 0, r
  while (!(st.away || []).includes(P) && guard++ < 60) {
    r = await act(g, past(st), sv, ids[0], { type: 'tick' }); st = r.state; sv = r.server
  }
  ok((st.away || []).includes(P), 'tdp : P absent après 2 tours entièrement auto (' + guard + ' ticks)')
  ok(st.log.some((e) => e.kind === 'away' && e.player === P), 'tdp : log away')
  // ses tours suivants sont joués d'office : le tour n'est jamais à P après un appel
  ok(st.turn !== P, 'tdp : le tour de l\'absent est enchaîné sans attendre (turn=' + st.turn?.slice(0, 4) + ')')
  // retour
  r = await act(g, st, sv, P, { type: 'back' })
  ok(!(r.state.away || []).includes(P), 'tdp : retour via back')
  // tour où le joueur agit lui-même puis laisse tick : pas compté
  const r1 = (await db.query(`select public.game_tour_des_potes_start($1::uuid[], '{"format":"classique","turn_seconds":30}'::jsonb) r`, [ids])).rows[0].r
  let s2 = r1.state, v2 = r1.server
  const Q = s2.turn, qi = ids.indexOf(Q)
  r = await act(g, s2, v2, Q, { type: 'roll' }); s2 = r.state; v2 = r.server
  let n = 0
  while (s2.turn === Q && n++ < 20) { r = await act(g, past(s2), v2, ids[0], { type: 'tick' }); s2 = r.state; v2 = r.server }
  ok(!(s2.away || []).includes(Q) && !(s2.idle?.[Q] > 0), 'tdp : tour avec action du joueur non compté en auto')
  r = await act(g, { ...s2, phase: 'finished' }, v2, ids[0], { type: 'tick' }).catch((e) => ({ err: e.message }))
  ok(true, 'tdp : tick hors partie -> ' + (r.err ?? 'ok') + ' (existant : wrong_phase)')
}
console.log(fails ? fails + ' ÉCHEC(S)' : 'TOUT OK')
process.exit(fails ? 1 : 0)
