// Tests SQL du jeu « Mini-golf » (PGlite) : node mini-golf.mjs ../../supabase/install.sql
// Appels directs du moteur (superutilisateur) : game_mini_golf_start / game_mini_golf_action.
import fs from 'node:fs'
import { bootDb } from './boot.mjs'

const file = process.argv[2]
if (!file) throw new Error('usage : node mini-golf.mjs <install.sql>')
const db = await bootDb(file)

let failed = false
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK   ' : 'ÉCHEC'} ${name}${cond ? '' : ' ' + extra}`)
  if (!cond) failed = true
}

const P = (await db.query(`select id from public.profiles order by sort_order limit 9`)).rows.map((r) => r.id)
const OUT = '00000000-0000-0000-0000-0000000000ff'

const start = async (opts = {}, players = P.slice(0, 4)) => {
  try {
    return { r: (await db.query(`select public.game_mini_golf_start($1::uuid[], $2::jsonb) r`, [`{${players.join(',')}}`, JSON.stringify(opts)])).rows[0].r }
  } catch (e) {
    return { err: e.message }
  }
}
const act = async (st, actor, action, host = false) => {
  try {
    const r = (await db.query(`select public.game_mini_golf_action($1::jsonb, $2::jsonb, $3::uuid, $4, $5::jsonb) r`,
      [JSON.stringify(st.state), JSON.stringify(st.server), actor, host, JSON.stringify(action)])).rows[0].r
    return { r }
  } catch (e) {
    return { err: e.message }
  }
}
const must = (res, label) => {
  if (res.err) throw new Error(label + ' : ' + res.err)
  return res.r
}
const iso = (sec) => new Date(Date.now() + sec * 1000).toISOString()
const approx = (v, sec) => {
  const d = (new Date(v).getTime() - Date.now()) / 1000
  return d > sec - 5 && d <= sec + 1
}
/** Le trou a commencé il y a `sec` secondes (fin de l'annonce dans le passé). */
const started = (st, sec = 60) => ({ ...st, state: { ...st.state, hole_started_at: iso(-sec), deadline: st.state.deadline ? iso(90 - sec) : null } })
/** L'échéance est dépassée de `sec` secondes. */
const late = (st, sec = 1) => ({ ...st, state: { ...st.state, deadline: iso(-sec) } })
const hole = (h, strokes, holed = true, stats = {}) => ({ type: 'hole', hole: h, strokes, holed, stats })
const res = (r, pid) => r.results.find((x) => x.profile_id === pid)

// ----------------------------------------------------------------------------- parcours / synchro avec holes.ts
const holesTs = fs.readFileSync(new URL('../../src/games/mini-golf/holes.ts', import.meta.url), 'utf8')
const tsPars = [...holesTs.matchAll(/^\s+par: (\d),$/gm)].map((m) => Number(m[1]))
const tsExpress = JSON.parse(holesTs.match(/export const EXPRESS = (\[[\d, ]+\])/)[1])
const course = (await db.query(`select public._mg_course() c`)).rows[0].c
ok('holes.ts : 9 trous, par 26', tsPars.length === 9 && tsPars.reduce((a, b) => a + b, 0) === 26, JSON.stringify(tsPars))
ok('synchro des pars SQL ↔ holes.ts', JSON.stringify(course.pars) === JSON.stringify(tsPars), JSON.stringify(course.pars))
ok('synchro du parcours express SQL ↔ holes.ts', JSON.stringify(course.express) === JSON.stringify(tsExpress))

// ----------------------------------------------------------------------------- démarrage
const s0 = must(await start(), 'start')
ok('state : game mini-golf, phase playing, trou 0', s0.state.game === 'mini-golf' && s0.state.phase === 'playing' && s0.state.hole === 0 && s0.state.round === 1)
ok('défaut : 9 trous (1..9), pars du parcours, chrono 90 s', JSON.stringify(s0.state.holes) === '[1,2,3,4,5,6,7,8,9]' && JSON.stringify(s0.state.pars) === JSON.stringify(tsPars) && s0.state.timer === 90 && s0.state.total_rounds === 9)
ok('annonce : hole_started_at ≈ +3 s, deadline ≈ +93 s', approx(s0.state.hole_started_at, 3) && approx(s0.state.deadline, 93))
ok('cartes vides, totaux à 0, personne n’a fini', Object.values(s0.state.cards).every((c) => c.length === 0) && Object.values(s0.state.totals).every((t) => t === 0) && s0.state.done.length === 0)
const ex = must(await start({ holes: 5, timer: 60 }), 'express')
ok('express : trous 1, 3, 5, 8, 9 (par 15), chrono 60 s', JSON.stringify(ex.state.holes) === '[1,3,5,8,9]' && ex.state.pars.reduce((a, b) => a + b, 0) === 15 && ex.state.timer === 60)
const nt = must(await start({ timer: 0 }), 'sans chrono')
ok('sans chrono : timer 0, pas d’échéance', nt.state.timer === 0 && nt.state.deadline === null)
const bad = must(await start({ holes: 7, timer: 45 }), 'bad')
ok('options invalides → 9 trous, 90 s', bad.state.holes.length === 9 && bad.state.timer === 90)
ok('1 joueur → not_enough_players', (await start({}, P.slice(0, 1))).err === 'not_enough_players')
ok('10 joueurs → too_many_players', (await start({}, [...P, OUT])).err === 'too_many_players')
ok('9 joueurs acceptés', !(await start({}, P)).err)

// ----------------------------------------------------------------------------- envoi d'un trou : validations
let G = started(s0, 60)
ok('pas joueur → not_a_player', (await act(G, OUT, hole(0, 2))).err === 'not_a_player')
ok('mauvais trou → wrong_hole', (await act(G, P[0], hole(1, 2))).err === 'wrong_hole')
ok('trou absent → invalid_action', (await act(G, P[0], { type: 'hole', strokes: 2, holed: true })).err === 'invalid_action')
ok('holed absent → invalid_action', (await act(G, P[0], { type: 'hole', hole: 0, strokes: 2 })).err === 'invalid_action')
ok('0 coup → invalid_strokes', (await act(G, P[0], hole(0, 0))).err === 'invalid_strokes')
ok('7 coups rentrée → invalid_strokes', (await act(G, P[0], hole(0, 7))).err === 'invalid_strokes')
ok('8 coups non rentrée → invalid_strokes', (await act(G, P[0], hole(0, 8, false))).err === 'invalid_strokes')
ok('coups en texte → invalid_strokes', (await act(G, P[0], { type: 'hole', hole: 0, strokes: '2', holed: true })).err === 'invalid_strokes')
ok('pendant l’annonce → too_fast', (await act(s0, P[0], hole(0, 1))).err === 'too_fast')
ok('4 coups en 5 s → too_fast', (await act(started(s0, 5), P[0], hole(0, 4))).err === 'too_fast')
ok('4 coups dont 2 à l’eau en 5 s (2 frappes) → accepté', !(await act(started(s0, 5), P[0], hole(0, 4, true, { water: 2 }))).err)
ok('2 coups en 3,5 s → accepté', !(await act(started(s0, 3.5), P[0], hole(0, 2))).err)

const a1 = must(await act(G, P[0], hole(0, 2, true, { water: 0, mill_hits: 0, bank_shot: 1 })), 'a1')
ok('trou envoyé : carte [2], total 2, fini', JSON.stringify(a1.state.cards[P[0]]) === '[2]' && a1.state.totals[P[0]] === 2 && a1.state.done.join() === P[0])
ok('last_hole publié', a1.state.last_hole.id === P[0] && a1.state.last_hole.strokes === 2 && a1.state.last_hole.holed === true && a1.state.last_hole.hole === 0)
ok('toujours en jeu tant que d’autres jouent', a1.state.phase === 'playing')
const dup = must(await act(a1, P[0], hole(0, 3)), 'dup')
ok('doublon : ignoré sans erreur (carte inchangée)', JSON.stringify(dup.state.cards[P[0]]) === '[2]' && dup.state.done.length === 1)
const a2 = must(await act(a1, P[1], hole(0, 6, false, { water: 1 })), 'a2')
ok('non rentrée → 7 inscrits', a2.state.cards[P[1]][0] === 7 && a2.state.last_hole.holed === false)
ok('compteurs client stockés côté serveur (privé)', a2.server.tstats[P[1]].water === 1 && a2.server.tstats[P[1]].picked_up === 1 && a2.server.tstats[P[0]].bank_shot === 1 && JSON.stringify(a2.state).includes('tstats') === false)
const a3 = must(await act(a2, P[2], hole(0, 3)), 'a3')
const a4 = must(await act(a3, P[3], hole(0, 1)), 'a4')
ok('tous ont fini → hole_end, échéance ≈ +6 s', a4.state.phase === 'hole_end' && approx(a4.state.deadline, 6) && a4.state.done.length === 4)
ok('envoi en hole_end pour ce trou (déjà fini) : ignoré', !(await act(a4, P[0], hole(0, 2))).err)
ok('envoi pour le trou suivant en hole_end → wrong_hole', (await act(a4, P[0], hole(1, 2))).err === 'wrong_hole')

// ----------------------------------------------------------------------------- tick / next
const t0 = must(await act(a4, P[0], { type: 'tick' }), 't0')
ok('tick avant l’échéance : sans effet', t0.state.phase === 'hole_end' && t0.state.hole === 0)
const t1 = must(await act(late(a4), P[2], { type: 'tick' }), 't1')
ok('tick après l’échéance de hole_end → trou suivant (annonce + chrono)', t1.state.phase === 'playing' && t1.state.hole === 1 && t1.state.round === 2 && t1.state.done.length === 0 && approx(t1.state.hole_started_at, 3) && approx(t1.state.deadline, 93))
const t1b = must(await act(t1, P[2], { type: 'tick' }), 't1b')
ok('tick répété : idempotent', t1b.state.hole === 1 && t1b.state.phase === 'playing')

let H = started(t1, 30)
H = { ...H, state: must(await act(H, P[0], hole(1, 3)), 'h1').state, server: H.server }
const chrono = must(await act(late(H), P[1], { type: 'tick' }), 'chrono')
ok('chrono écoulé : absents = 7, trou clos', chrono.state.phase === 'hole_end' && chrono.state.cards[P[0]][1] === 3 && [P[1], P[2], P[3]].every((p) => chrono.state.cards[p][1] === 7))
ok('chrono écoulé : ramassage par chrono ≠ « balle ramassée » (trophée)', !chrono.server.tstats[P[2]]?.picked_up)
const chrono2 = must(await act(chrono, P[1], { type: 'tick' }), 'chrono2')
ok('tick idempotent après clôture', JSON.stringify(chrono2.state.cards) === JSON.stringify(chrono.state.cards) && chrono2.state.phase === 'hole_end')
const lateSend = must(await act(late(H, 5), P[1], hole(1, 2)), 'lateSend')
ok('envoi après chrono + 3 s : trou clos, 7 inscrits', lateSend.state.phase === 'hole_end' && lateSend.state.cards[P[1]][1] === 7)
const graceSend = must(await act(late(H, 1), P[1], hole(1, 2)), 'graceSend')
ok('envoi dans la tolérance de 3 s : accepté', graceSend.state.cards[P[1]][1] === 2 && graceSend.state.phase === 'playing')

ok('next par un joueur → not_host', (await act(H, P[1], { type: 'next' })).err === 'not_host')
const nx = must(await act(H, P[1], { type: 'next' }, true), 'next')
ok('next (hôte) en jeu : clôt le trou (absents = 7)', nx.state.phase === 'hole_end' && nx.state.cards[P[3]][1] === 7)
const nx2 = must(await act(nx, P[1], { type: 'next' }, true), 'next2')
ok('next (hôte) en hole_end : trou suivant', nx2.state.phase === 'playing' && nx2.state.hole === 2)
const ntA = must(await act(started(nt, 40), P[0], hole(0, 2)), 'ntA')
ok('sans chrono : le tick ne clôt jamais le trou', must(await act(ntA, P[1], { type: 'tick' }), 'ntT').state.phase === 'playing')

// ----------------------------------------------------------------------------- end_game
ok('end_game par un joueur → not_host', (await act(H, P[0], { type: 'end_game' })).err === 'not_host')
const eg = must(await act(H, P[0], { type: 'end_game' }, true), 'eg')
ok('end_game (hôte) : fini, trous restants = 7 pour tous', eg.state.phase === 'finished' && eg.state.forced === true && eg.state.cards[P[1]].length === 9 && eg.state.cards[P[1]].slice(1).every((x) => x === 7))
ok('end_game : les coups joués restent', eg.state.cards[P[0]][0] === 2 && eg.state.cards[P[0]][1] === 3)
ok('end_game : results renvoyés (finish_match)', Array.isArray(eg.results) && eg.results.length === 4)
ok('end_game en hole_end : accepté', must(await act(a4, P[0], { type: 'end_game' }, true), 'eg2').state.phase === 'finished')
ok('end_game après la fin → wrong_phase', (await act(eg, P[0], { type: 'end_game' }, true)).err === 'wrong_phase')
ok('envoi après la fin → wrong_phase', (await act(eg, P[0], hole(8, 2))).err === 'wrong_phase')
ok('action inconnue → unknown_action', (await act(G, P[0], { type: 'danse' })).err === 'unknown_action')

// ----------------------------------------------------------------------------- partie complète, classement
/** Joue un parcours entier : scores[joueur][trou] (null = absent, clos au chrono), extras[joueur][trou] = stats. */
async function play(opts, players, scores, extras = {}) {
  let st = must(await start(opts, players), 'start')
  const n = st.state.holes.length
  for (let h = 0; h < n; h++) {
    st = started(st, 60)
    let last = st
    for (const p of players) {
      const v = scores[p][h]
      if (v === null) continue
      const r = must(await act(last, p, hole(h, v === 7 ? 6 : v, v !== 7, extras[p]?.[h] ?? {})), `p${h}`)
      last = { ...r, server: r.server }
    }
    if (last.state.phase === 'playing') last = must(await act(late(last), players[0], { type: 'tick' }), 'close')
    if (last.state.phase === 'finished') return last
    st = must(await act(late(last), players[0], { type: 'tick' }), 'nexth')
  }
  return st
}
const pars = tsPars
const A = P[0], B = P[1], C = P[2], D = P[3]
const fin = await play({}, [A, B, C, D], {
  [A]: [1, 2, 2, 3, 3, 3, 3, 3, 4], // as au 1, birdie au 3 : 24, sous le par, sans bavure
  [B]: [2, 2, 3, 3, 3, 3, 3, 3, 4], // le par partout : 26, sans bavure, pas sous le par
  [C]: [3, 7, 3, 4, 3, 3, 3, 3, 5], // ramassée au 2
  [D]: [3, 2, 7, 3, 4, 3, 3, 3, null], // ramassée au 3 ; chrono au 9 (7)
}, { [B]: { 4: { mill_hits: 3 }, 5: { mill_hits: 4 } }, [C]: { 0: { water: 1 }, 3: { water: 2, bank_shot: 1 } }, [D]: { 1: { bank_shot: 1 } } })
ok('partie complète : phase finished, results', fin.state.phase === 'finished' && fin.results.length === 4)
ok('totaux : 24 / 26 / 34 / 35', fin.state.totals[A] === 24 && fin.state.totals[B] === 26 && fin.state.totals[C] === 34 && fin.state.totals[D] === 35, JSON.stringify(fin.state.totals))
ok('classement : plus petit total gagne', res(fin, A).placement === 1 && res(fin, B).placement === 2 && res(fin, C).placement === 3 && res(fin, D).placement === 4)
ok('points = n − rang + 1 ; won = rang 1', res(fin, A).points === 4 && res(fin, D).points === 1 && res(fin, A).won && !res(fin, B).won)
ok('winners = [A]', JSON.stringify(fin.state.winners) === JSON.stringify([A]))
const sA = res(fin, A).stats, sB = res(fin, B).stats, sC = res(fin, C).stats, sD = res(fin, D).stats
ok('stats A : as 1, birdies 2, pars 9, sous le par, sans bavure', sA.aces === 1 && sA.birdies === 2 && sA.pars === 9 && sA.under_par === 1 && sA.clean_card === 1, JSON.stringify(sA))
ok('stats B : pars 9, birdies 0, sans bavure mais pas sous le par', sB.pars === 9 && sB.birdies === 0 && sB.clean_card === 1 && sB.under_par === 0 && sB.aces === 0)
ok('stats B : moulin cumulé, borné par les coups du trou (3 + 3)', sB.mill_hits === 6, String(sB.mill_hits))
ok('stats C : 3 balles à l’eau, ramassée 1, par la bande (rentrée)', sC.water === 3 && sC.picked_up === 1 && sC.bank_shot === 1 && sC.clean_card === 0, JSON.stringify(sC))
ok('stats D : ramassée 1 (le chrono ne compte pas), bande 1, total 35', sD.picked_up === 1 && sD.bank_shot === 1 && sD.total === 35)
ok('stats : holes = 9', [sA, sB, sC, sD].every((x) => x.holes === 9))
const fin5 = await play({ holes: 5 }, [A, B], { [A]: [1, 2, 2, 2, 3], [B]: [2, 3, 3, 3, 4] })
ok('express : sous le par / sans bavure exigent 9 trous', res(fin5, A).stats.under_par === 0 && res(fin5, A).stats.clean_card === 0 && res(fin5, A).stats.aces === 1)
const tie = await play({ holes: 5 }, [A, B, C], { [A]: [2, 3, 3, 3, 4], [B]: [2, 3, 3, 3, 4], [C]: [3, 3, 3, 3, 4] })
ok('ex aequo : rang 1 partagé, deux vainqueurs, 3e = rang 3', res(tie, A).placement === 1 && res(tie, B).placement === 1 && res(tie, C).placement === 3 && res(tie, A).won && res(tie, B).won && tie.state.winners.length === 2)
ok('ex aequo : points 3 / 3 / 1', res(tie, A).points === 3 && res(tie, B).points === 3 && res(tie, C).points === 1)
ok('bornes : bank_shot ignoré si non rentrée, eau ≤ coups', (await (async () => {
  const st = started(must(await start({}, [A, B]), 's'), 60)
  const r = must(await act(st, A, hole(0, 6, false, { water: 40, mill_hits: 99, bank_shot: 1 })), 'b')
  return r.server.tstats[A].water <= 6 && r.server.tstats[A].mill_hits <= 6 && !r.server.tstats[A].bank_shot
})()))

// ----------------------------------------------------------------------------- catalogue
const tenue = (await db.query(`select game_id, condition_type, threshold, emoji from public.tenues where id = 'golfer'`)).rows[0]
ok('catalogue : tenue golfer (10 victoires au mini-golf)', tenue?.game_id === 'mini-golf' && tenue.condition_type === 'game_wins' && tenue.threshold === 10 && tenue.emoji === '⛳')
const tr = (await db.query(`select slot, id, rule from public.trophies where tenue_id = 'golfer' and game_id = 'mini-golf' and active order by slot`)).rows
ok('catalogue : 11 trophées mg_* actifs (slots 2 à 12)', tr.length === 11 && tr[0].slot === 2 && tr[10].slot === 12 && tr.every((t) => t.id.startsWith('mg_')), String(tr.length))
const keys = Object.keys(sA)
ok('trophées : toutes les stats du catalogue sont posées par le moteur', tr.filter((t) => t.rule.stat && t.rule.stat !== 'won').every((t) => keys.includes(t.rule.stat)), JSON.stringify(tr.map((t) => t.rule.stat)))

console.log(failed ? '\nÉCHEC' : '\nTout est OK')
process.exit(failed ? 1 : 0)
