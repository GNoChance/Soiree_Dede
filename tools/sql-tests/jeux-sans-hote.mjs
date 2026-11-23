// Tests « plus aucune partie bloquée » : action-ou-verite, qui-suis-je, devine-en-equipe (PGlite).
// node jeux-sans-hote.mjs ../../supabase/install.sql
import { bootDb } from './boot.mjs'

const file = process.argv[2]
if (!file) throw new Error('usage : node jeux-sans-hote.mjs <install.sql>')
const db = await bootDb(file)
let failed = false
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK   ' : 'ÉCHEC'} ${name}${cond ? '' : ' ' + extra}`)
  if (!cond) failed = true
}
const P = (await db.query(`select id from public.profiles order by sort_order limit 6`)).rows.map((r) => r.id)
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/
const past = '2000-01-01T00:00:00.000Z'
const call = async (fn, args) => (await db.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) r`, args)).rows[0].r
const secsLeft = (iso) => (new Date(iso).getTime() - Date.now()) / 1000
const n = (k, f) => Array.from({ length: k }, (_, i) => f(i))
const clone = (x) => JSON.parse(JSON.stringify(x))

// ------------------------------------------------------------------ action-ou-verite
{
  const cards = [...n(4, (i) => ({ id: 'a' + i, kind: 'action', text: 'Act ' + i, level: 1 })), ...n(4, (i) => ({ id: 'v' + i, kind: 'verite', text: 'Ver ' + i, level: 1 }))]
  const players = P.slice(0, 5) // 4 votants
  const A = (st, actor, host, a) => call('game_action_ou_verite_action', [JSON.stringify(st.state), JSON.stringify(st.server), actor, host, JSON.stringify(a)])
  const start = (opts) => call('game_action_ou_verite_start', [`{${players.join(',')}}`, JSON.stringify({ cards, rounds: 5, ...opts })])
  let st = await start({})
  ok('AOV deadline ISO ms Z (choose)', ISO.test(st.state.deadline) && ISO.test(st.state.spin.until), st.state.deadline)
  const tgt = st.state.target
  st = await A(st, tgt, false, { type: 'choose', kind: 'action' })
  ok('AOV deadline ISO (vote)', ISO.test(st.state.deadline))
  const voters = players.filter((p) => p !== tgt)
  for (const v of voters) st = await A(st, v, false, { type: 'vote_card', index: 0 })
  ok('AOV phase perform + ISO', st.state.phase === 'perform' && ISO.test(st.state.deadline) && ISO.test(st.state.timer_until))
  const mk = async (votes) => {
    let s2 = st
    for (const [i, up] of votes.entries()) s2 = await A(s2, voters[i], false, { type: 'vote_result', success: up })
    return s2
  }
  let t = await mk([true, false, true, false])
  ok('AOV égalité 2-2 = réussi', t.state.phase === 'result' && t.state.last_result.outcome === 'success' && t.state.last_result.points === 1, JSON.stringify(t.state.last_result))
  ok('AOV result : deadline ~25 s sans auto', ISO.test(t.state.deadline) && secsLeft(t.state.deadline) > 20 && secsLeft(t.state.deadline) <= 25.5, String(t.state.deadline))
  t = await mk([true, true])
  ok('AOV 2/4 pour : perform, deadline raccourcie ~5 s', t.state.phase === 'perform' && secsLeft(t.state.deadline) <= 5.5, t.state.deadline)
  const early = clone(t)
  early.state.deadline = past
  const closed = await A(early, voters[2], false, { type: 'tick' })
  ok('AOV tick après grâce ferme le tour (réussi)', closed.state.phase === 'result' && closed.state.last_result.outcome === 'success')
  const noop = await A(t, voters[2], false, { type: 'tick' })
  ok('AOV tick avant grâce = no-op', noop.state.phase === 'perform')
  t = await mk([false, false, false])
  ok('AOV 3 contre sur 4 : deadline raccourcie', t.state.phase === 'perform' && secsLeft(t.state.deadline) <= 5.5)
  t = await mk([true, false])
  ok('AOV 1-1 : deadline inchangée (~150 s)', t.state.phase === 'perform' && secsLeft(t.state.deadline) > 100)
  const r = await mk([true, true, true, true])
  ok('AOV tous ont jugé : result', r.state.phase === 'result')
  const r0 = await A(r, P[0], false, { type: 'tick' })
  ok('AOV tick result avant échéance = no-op', r0.state.phase === 'result' && r0.state.round === r.state.round)
  const rx = clone(r)
  rx.state.deadline = past
  const r1 = await A(rx, P[0], false, { type: 'tick' })
  ok('AOV tick result après échéance : tour suivant', r1.state.phase === 'choose' && r1.state.round === r.state.round + 1)
  const r2 = await A(r1, P[1], false, { type: 'tick' })
  ok('AOV tick répété idempotent', r2.state.phase === 'choose' && r2.state.round === r1.state.round)
  const sa = await start({ auto: true })
  ok('AOV option auto conservée', sa.state.auto === true)
}

// ------------------------------------------------------------------ qui-suis-je
{
  const cards = n(8, (i) => ({ id: 'c' + i, name: 'Perso' + i, theme: 'divers', difficulty: 1 }))
  const Q = (st, actor, host, a) => call('game_qui_suis_je_action', [JSON.stringify(st.state), JSON.stringify(st.server), actor, host, JSON.stringify(a)])
  const st = await call('game_qui_suis_je_start', [`{${P.slice(0, 3).join(',')}}`, JSON.stringify({ cards })])
  ok('QSJ placing : deadline ISO ~45 s', st.state.phase === 'placing' && ISO.test(st.state.deadline) && secsLeft(st.state.deadline) > 40 && secsLeft(st.state.deadline) <= 45.5, String(st.state.deadline))
  const early = await Q(st, P[0], false, { type: 'tick' })
  ok('QSJ tick placing avant échéance = no-op', early.state.phase === 'placing' && early.state.turn === 1)
  const rdy = await Q(st, st.state.guesser, false, { type: 'ready' })
  ok('QSJ ready toujours possible', rdy.state.phase === 'playing')
  const exp = clone(st)
  exp.state.deadline = past
  const sk = await Q(exp, P[1], false, { type: 'tick' })
  ok('QSJ tick après échéance : tour sauté', sk.state.phase === 'recap' && sk.state.last_turn.skipped === true, JSON.stringify(sk.state.last_turn))
  const sk2 = await Q(sk, P[1], false, { type: 'tick' })
  ok('QSJ tick répété ne ressaute pas', sk2.state.phase === 'recap' && sk2.state.turn === sk.state.turn)
  const skx = clone(sk)
  skx.state.deadline = past
  const nx = await Q(skx, P[1], false, { type: 'tick' })
  ok('QSJ recap -> tour suivant, nouvelle échéance 45 s', nx.state.phase === 'placing' && nx.state.turn === 2 && secsLeft(nx.state.deadline) > 40)
  const old = clone(st)
  old.state.deadline = null
  const o2 = await Q(old, P[0], false, { type: 'tick' })
  ok('QSJ rétrocompat placing sans deadline : ignoré', o2.state.phase === 'placing')
}

// ------------------------------------------------------------------ devine-en-equipe
{
  const words = n(12, (i) => 'mot' + i)
  const D = (st, actor, host, a) => call('game_devine_en_equipe_action', [JSON.stringify(st.state), JSON.stringify(st.server), actor, host, JSON.stringify(a)])
  const st = await call('game_devine_en_equipe_start', [`{${P.slice(0, 4).join(',')}}`, JSON.stringify({ words })])
  ok('DEE ready : deadline ISO ~45 s', st.state.phase === 'ready' && ISO.test(st.state.deadline) && secsLeft(st.state.deadline) > 40 && secsLeft(st.state.deadline) <= 45.5, String(st.state.deadline))
  const e = await D(st, P[0], false, { type: 'tick' })
  ok('DEE tick ready avant échéance = no-op', e.state.phase === 'ready' && e.state.turn_no === st.state.turn_no)
  const rd = await D(st, st.state.speaker, false, { type: 'ready' })
  ok('DEE ready : deadline = budget de jeu', rd.state.phase === 'playing' && ISO.test(rd.state.deadline))
  const ex = clone(st)
  ex.state.deadline = past
  const sk = await D(ex, P[0], false, { type: 'tick' })
  ok('DEE tick après échéance : passage sauté', sk.state.phase === 'ready' && sk.state.turn_no === st.state.turn_no + 1 && sk.state.last_turn.reason === 'skip', JSON.stringify(sk.state.last_turn))
  ok('DEE nouvelle échéance après saut', secsLeft(sk.state.deadline) > 40)
  const sk2 = await D(sk, P[0], false, { type: 'tick' })
  ok('DEE tick répété idempotent', sk2.state.turn_no === sk.state.turn_no)
}

process.exit(failed ? 1 : 0)
