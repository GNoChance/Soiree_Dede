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
const tsIds = [...holesTs.matchAll(/^\s+id: (\d+),$/gm)].map((m) => Number(m[1]))
const tsPars = [...holesTs.matchAll(/^\s+par: (\d),$/gm)].map((m) => Number(m[1]))
const tsKermesse = JSON.parse((holesTs.match(/export const KERMESSE = (\[[\d, ]+\])/) ?? [0, 'null'])[1])
const tsDefi = JSON.parse((holesTs.match(/export const DEFI = (\[[\d, ]+\])/) ?? [0, 'null'])[1])
const tsPool = Number((holesTs.match(/export const RANDOM_POOL = (\d+)/) ?? [0, 'NaN'])[1])
const tsMinCap = Number((holesTs.match(/export const MIN_CAP = (\d+)/) ?? [0, 'NaN'])[1])
const tsOverPar = Number((holesTs.match(/export const CAP_OVER_PAR = (\d+)/) ?? [0, 'NaN'])[1])
const course = (await db.query(`select public._mg_course() c`)).rows[0].c
const N = tsPars.length
const sum = (a) => a.reduce((x, y) => x + y, 0)
ok('holes.ts : 29 trous, ids 1..29 dans l’ordre, un par par trou', N === 29 && tsIds.length === 29 && tsIds.every((id, i) => id === i + 1), JSON.stringify(tsIds))
ok('holes.ts : pars de 2 à 4 (trous 1..20), de 4 à 6 (Défi, 21..29)', tsPars.slice(0, 20).every((p) => p >= 2 && p <= 4) && tsPars.slice(20).every((p) => p >= 4 && p <= 6), JSON.stringify(tsPars))
ok('holes.ts : La Kermesse = trous 1..9, par 26', JSON.stringify(tsKermesse) === '[1,2,3,4,5,6,7,8,9]' && sum(tsPars.slice(0, 9)) === 26)
ok('holes.ts : Défi = trous 21..29, tirage au sort parmi 1..20', JSON.stringify(tsDefi) === '[21,22,23,24,25,26,27,28,29]' && tsPool === 20)
ok('synchro des pars SQL ↔ holes.ts', JSON.stringify(course.pars) === JSON.stringify(tsPars), JSON.stringify(course.pars))
ok('synchro de La Kermesse SQL ↔ holes.ts', JSON.stringify(course.kermesse) === JSON.stringify(tsKermesse))
ok('synchro du Défi et du tirage SQL ↔ holes.ts', JSON.stringify(course.defi) === JSON.stringify(tsDefi) && course.pool === tsPool)
const caps = (await db.query(`select p, public._mg_cap(p) c, public._mg_picked(p) k from generate_series(2, 6) p`)).rows
ok('plafond de coups SQL ↔ holes.ts : max(6, par + 2), ramassée = plafond + 1', tsMinCap === 6 && tsOverPar === 2 &&
  caps.every((r) => r.c === Math.max(tsMinCap, r.p + tsOverPar) && r.k === r.c + 1) && caps.map((r) => r.k).join() === '7,7,7,8,9', JSON.stringify(caps))
/** Tirage valide : n ids distincts de 1..20, pars du parcours, triés par par croissant. */
const validDraw = (st, n) => {
  const h = st.holes
  return h.length === n && new Set(h).size === n && h.every((id) => Number.isInteger(id) && id >= 1 && id <= 20) &&
    JSON.stringify(st.pars) === JSON.stringify(h.map((id) => tsPars[id - 1])) && st.pars.every((p, i) => i === 0 || st.pars[i - 1] <= p) &&
    st.total_rounds === n
}

// ----------------------------------------------------------------------------- démarrage
const s0 = must(await start(), 'start')
ok('state : game mini-golf, phase playing, trou 0', s0.state.game === 'mini-golf' && s0.state.phase === 'playing' && s0.state.hole === 0 && s0.state.round === 1)
ok('défaut : aléatoire, 9 trous distincts parmi 1..20, pars cohérents, triés par par, chrono 90 s', s0.state.course === 'random' && validDraw(s0.state, 9) && s0.state.timer === 90, JSON.stringify([s0.state.holes, s0.state.pars]))
ok('annonce : hole_started_at ≈ +3 s, deadline ≈ +93 s', approx(s0.state.hole_started_at, 3) && approx(s0.state.deadline, 93))
ok('cartes vides, totaux à 0, personne n’a fini', Object.values(s0.state.cards).every((c) => c.length === 0) && Object.values(s0.state.totals).every((t) => t === 0) && s0.state.done.length === 0)
const draws = []
for (let i = 0; i < 40; i++) draws.push(must(await start(i % 2 ? {} : { course: 'random' }), 'random').state)
ok('aléatoire × 40 : tirages tous valides', draws.every((d) => d.course === 'random' && validDraw(d, 9)))
const seen = new Set(draws.flatMap((d) => d.holes))
ok('aléatoire × 40 : tirages variés, les nouveaux trous (10..20) sortent', new Set(draws.map((d) => d.holes.join())).size > 30 && [...seen].some((id) => id > 9) && seen.size >= 18, String(seen.size))
const ker = must(await start({ course: 'kermesse' }), 'kermesse')
ok('La Kermesse : trous 1..9 dans l’ordre, par 26', ker.state.course === 'kermesse' && JSON.stringify(ker.state.holes) === '[1,2,3,4,5,6,7,8,9]' && sum(ker.state.pars) === 26 && ker.state.total_rounds === 9)
const ex = must(await start({ course: 'express', timer: 60 }), 'express')
ok('express : 5 trous distincts parmi 1..20, pars cohérents, chrono 60 s', ex.state.course === 'express' && validDraw(ex.state, 5) && ex.state.timer === 60, JSON.stringify(ex.state.holes))
const exs = []
for (let i = 0; i < 20; i++) exs.push(must(await start({ course: 'express' }), 'express').state)
ok('express × 20 : tirages valides et variés', exs.every((d) => validDraw(d, 5)) && new Set(exs.map((d) => d.holes.join())).size > 10)
const leg9 = must(await start({ holes: 9, timer: 60 }), 'legacy 9')
ok('options anciennes {holes: 9} → La Kermesse (1..9)', leg9.state.course === 'kermesse' && JSON.stringify(leg9.state.holes) === '[1,2,3,4,5,6,7,8,9]' && leg9.state.timer === 60)
const leg5 = must(await start({ holes: 5 }), 'legacy 5')
ok('options anciennes {holes: 5} → express tiré au sort (5 trous)', leg5.state.course === 'express' && validDraw(leg5.state, 5))
ok('course prioritaire sur holes', must(await start({ course: 'kermesse', holes: 5 }), 'prio').state.holes.length === 9)
const junk = must(await start({ course: 'golf-de-luxe', timer: 'vite' }), 'junk')
ok('course inconnue → aléatoire 9 trous, 90 s', junk.state.course === 'random' && validDraw(junk.state, 9) && junk.state.timer === 90)
const defi = must(await start({ course: 'defi', timer: 60 }), 'defi')
ok('Défi : trous 21..29 dans l’ordre, pars du parcours (4 à 6)', defi.state.course === 'defi' && JSON.stringify(defi.state.holes) === JSON.stringify(tsDefi) &&
  JSON.stringify(defi.state.pars) === JSON.stringify(tsPars.slice(20)) && defi.state.total_rounds === 9 && defi.state.timer === 60, JSON.stringify(defi.state.holes))
ok('aléatoire et express ne piochent jamais dans le Défi (ids ≤ 20)', [...draws, ...exs].every((d) => d.holes.every((id) => id <= 20)))
const nt = must(await start({ timer: 0 }), 'sans chrono')
ok('sans chrono : timer 0, pas d’échéance', nt.state.timer === 0 && nt.state.deadline === null)
const bad = must(await start({ holes: 7, timer: 45 }), 'bad')
ok('options invalides → aléatoire 9 trous, 90 s', bad.state.course === 'random' && validDraw(bad.state, 9) && bad.state.timer === 90)
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
const A = P[0], B = P[1], C = P[2], D = P[3]
const fin = await play({ course: 'kermesse' }, [A, B, C, D], {
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
const fin5 = await play({ course: 'express' }, [A, B], { [A]: [1, 1, 1, 1, 1], [B]: [2, 3, 3, 3, 4] })
ok('express : sous le par / sans bavure exigent 9 trous', res(fin5, A).stats.under_par === 0 && res(fin5, A).stats.clean_card === 0 && res(fin5, A).stats.aces === 5)
const tie = await play({ course: 'express' }, [A, B, C], { [A]: [2, 3, 3, 3, 4], [B]: [2, 3, 3, 3, 4], [C]: [3, 3, 3, 3, 4] })
ok('ex aequo : rang 1 partagé, deux vainqueurs, 3e = rang 3', res(tie, A).placement === 1 && res(tie, B).placement === 1 && res(tie, C).placement === 3 && res(tie, A).won && res(tie, B).won && tie.state.winners.length === 2)
ok('ex aequo : points 3 / 3 / 1', res(tie, A).points === 3 && res(tie, B).points === 3 && res(tie, C).points === 1)
const rnd9 = await play({}, [A, B], { [A]: Array(9).fill(1), [B]: Array(9).fill(7) })
ok('aléatoire 9 trous : « sous le par » et « sans bavure » possibles', res(rnd9, A).stats.under_par === 1 && res(rnd9, A).stats.clean_card === 1 && res(rnd9, A).stats.aces === 9 && res(rnd9, B).stats.under_par === 0)
// ----------------------------------------------------------------------------- Défi : plafond de coups selon le par
const dPars = tsPars.slice(20)
const picked = (p) => Math.max(6, p + 2) + 1
const i4 = dPars.indexOf(4), i5 = dPars.indexOf(5), i6 = dPars.indexOf(6)
ok('Défi : au moins un par 4, un par 5 et un par 6', i4 >= 0 && i5 >= 0 && i6 >= 0, JSON.stringify(dPars))
const dStart = must(await start({ course: 'defi' }, [A, B]), 'defi AB')
/** Place la partie sur le trou d'index i (trous précédents non joués). */
const at = (st, i) => started({ ...st, state: { ...st.state, hole: i, round: i + 1 } }, 60)
const d5 = at(dStart, Math.max(0, i5)), d6 = at(dStart, Math.max(0, i6)), d4 = at(dStart, Math.max(0, i4))
const r57 = await act(d5, A, hole(i5, 7))
ok('par 5 : rentrée en 7 acceptée (plafond 7)', !r57.err && r57.r.state.cards[A][i5] === 7, r57.err)
ok('par 5 : trous précédents non joués = ramassée selon leur par', !r57.err && r57.r.state.cards[A].slice(0, i5).every((v, j) => v === picked(dPars[j])), JSON.stringify(r57.r?.state.cards[A]))
ok('par 5 : rentrée en 8 → invalid_strokes', (await act(d5, A, hole(i5, 8))).err === 'invalid_strokes')
const r58 = await act(d5, A, hole(i5, 7, false))
ok('par 5 : non rentrée → 8 inscrits', !r58.err && r58.r.state.cards[A][i5] === 8, r58.err)
ok('par 5 : non rentrée en 9 → invalid_strokes', (await act(d5, A, hole(i5, 9, false))).err === 'invalid_strokes')
const r68 = await act(d6, A, hole(i6, 8))
ok('par 6 : rentrée en 8 acceptée, non rentrée → 9', !r68.err && r68.r.state.cards[A][i6] === 8 && must(await act(d6, A, hole(i6, 8, false)), 'r69').state.cards[A][i6] === 9, r68.err)
ok('par 4 : plafond inchangé (6, ramassée 7)', (await act(d4, A, hole(i4, 7))).err === 'invalid_strokes' && must(await act(d4, A, hole(i4, 6, false)), 'r47').state.cards[A][i4] === 7)
const ch5 = must(await act(late(must(await act(d5, A, hole(i5, 5)), 'c5')), B, { type: 'tick' }), 'ch5')
ok('par 5 : chrono écoulé → absent = 8', ch5.state.cards[B][i5] === 8 && ch5.state.cards[A][i5] === 5)
const dEnd = must(await act(started(dStart, 60), A, { type: 'end_game' }, true), 'dEnd')
ok('Défi : fin forcée → chaque trou restant = ramassée selon son par', dEnd.state.totals[B] === sum(dPars.map(picked)) && JSON.stringify(dEnd.state.cards[B]) === JSON.stringify(dPars.map(picked)), JSON.stringify(dEnd.state.cards[B]))
const dFin = await play({ course: 'defi' }, [A, B], { [A]: dPars, [B]: dPars.map((p) => p + 1) })
ok('Défi : parcours de 9 trous → « sans bavure » possible, « sous le par » non au par', res(dFin, A).stats.clean_card === 1 && res(dFin, A).stats.under_par === 0 && res(dFin, A).stats.pars === 9 && res(dFin, B).stats.pars === 0 && res(dFin, A).placement === 1)

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
