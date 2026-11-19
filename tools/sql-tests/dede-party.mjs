// Tests SQL du jeu « Dédé Party » (PGlite) : node dede-party.mjs ../../supabase/install.sql [nb de parties simulées]
// Appels directs du moteur (superutilisateur) : game_dede_party_start / game_dede_party_action.
// Dés et cartes imposés via server.forced_dice / server.forced_cards / server.forced_mg.
import fs from 'node:fs'
import { bootDb } from './boot.mjs'

const file = process.argv[2]
if (!file) throw new Error('usage : node dede-party.mjs <install.sql> [simulations]')
const SIMS = Number(process.argv[3] ?? 12)
const db = await bootDb(file)

let failed = false
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK   ' : 'ÉCHEC'} ${name}${cond ? '' : ' ' + extra}`)
  if (!cond) failed = true
}

const P = (await db.query(`select id from public.profiles order by sort_order limit 9`)).rows.map((r) => r.id)
const OUT = '00000000-0000-0000-0000-0000000000ff'
const [A, B, C, D] = P

const QUIZ = Array.from({ length: 6 }, (_, i) => ({ prompt: `Question ${i} ?`, answer: `Bonne ${i}`, distractors: [`Faux ${i}a`, `Faux ${i}b`, `Faux ${i}c`] }))
const PIF = [{ prompt: 'Combien de marches ?', answer: 100, unit: 'marches' }, { prompt: 'Combien de km ?', answer: 42 }]
const MAJ = ['Qui de nous ronfle le plus ?', 'Qui de nous arrive toujours en retard ?']
const OPTS = { quiz: QUIZ, pif: PIF, majorite: MAJ }

const start = async (opts = OPTS, players = P.slice(0, 4)) => {
  try {
    return { r: (await db.query(`select public.game_dede_party_start($1::uuid[], $2::jsonb) r`, [`{${players.join(',')}}`, JSON.stringify(opts)])).rows[0].r }
  } catch (e) {
    return { err: e.message }
  }
}
const act = async (st, actor, action, host = false) => {
  try {
    const r = (await db.query(`select public.game_dede_party_action($1::jsonb, $2::jsonb, $3::uuid, $4, $5::jsonb) r`,
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
/** L'échéance est dépassée de `sec` secondes. */
const late = (st, sec = 1) => ({ ...st, state: { ...st.state, deadline: iso(-sec) } })
/** Remplace des clés du state / du server. */
const patch = (st, s = {}, sv = {}) => ({ state: { ...st.state, ...s }, server: { ...st.server, ...sv } })
const tick = { type: 'tick' }
const roll = (double = false) => ({ type: 'roll', double })
const sub = (no, payload) => ({ type: 'mg_submit', no, payload })
const map = (ids, vals) => Object.fromEntries(ids.map((id, i) => [id, Array.isArray(vals) ? vals[i] : vals]))

// ----------------------------------------------------------------------------- plateau / synchro avec board.ts
const boardTs = fs.readFileSync(new URL('../../src/games/dede-party/board.ts', import.meta.url), 'utf8')
const tsCells = JSON.parse(boardTs.match(/export const CELLS: CellType\[\] = (\[[^\]]+\])/)[1].replace(/'/g, '"'))
const board = (await db.query(`select public._dp_board() b`)).rows[0].b
const count = (t) => board.filter((x) => x === t).length
ok('synchro du plateau SQL ↔ board.ts', JSON.stringify(board) === JSON.stringify(tsCells), JSON.stringify(tsCells))
ok('plateau : 24 cases (1 Départ, 9 Applaudissements, 4 Pub, 4 Enveloppes, 6 Loges)', board.length === 24 && board[0] === 'start' && count('start') === 1 && count('clap') === 9 && count('pub') === 4 && count('env') === 4 && count('loge') === 6)
const LOGES = board.map((t, i) => (t === 'loge' ? i : -1)).filter((i) => i >= 0)
const cards = (await db.query(`select public._dp_cards() c`)).rows[0].c
ok('12 cartes Enveloppe surprise', cards.length === 12 && new Set(cards.map((c) => c.id)).size === 12)

// ----------------------------------------------------------------------------- démarrage
const s0 = must(await start(), 'start')
ok('state : game dede-party, phase intro (≈ 5 s), tour 0/9', s0.state.game === 'dede-party' && s0.state.phase === 'intro' && s0.state.round === 0 && s0.state.rounds === 9 && approx(s0.state.deadline, 5))
ok('chacun : Départ, 10 pièces, 0 étoile, 1 Double dé', [A, B, C, D].every((p) => s0.state.pos[p] === 0 && s0.state.coins[p] === 10 && s0.state.stars[p] === 0 && s0.state.double_left[p] === 1))
ok('étoile posée sur une Loge', LOGES.includes(s0.state.star_cell))
ok('ordre de passage = les 4 joueurs', s0.state.order.length === 4 && [A, B, C, D].every((p) => s0.state.order.includes(p)))
ok('questions et réponses jamais dans le state public', !JSON.stringify(s0.state).includes('Bonne 0') && s0.server.q.quiz.length === 6 && s0.server.q.pif.length === 2 && s0.server.q.majorite.length === 2)
ok('options : 6 et 12 tours', must(await start({ rounds: 6 }), 's6').state.rounds === 6 && must(await start({ rounds: 12 }), 's12').state.rounds === 12)
ok('options invalides → 9 tours, questions mal formées ignorées', (await (async () => {
  const r = must(await start({ rounds: 7, quiz: [{ prompt: 'x' }, QUIZ[0]], pif: [{ prompt: 'y', answer: 'abc' }], majorite: [3, 'ok'] }), 'bad')
  return r.state.rounds === 9 && r.server.q.quiz.length === 1 && r.server.q.pif.length === 0 && r.server.q.majorite.length === 1
})()))
ok('1 joueur → not_enough_players', (await start(OPTS, P.slice(0, 1))).err === 'not_enough_players')
ok('9 joueurs → too_many_players', (await start(OPTS, P.slice(0, 9))).err === 'too_many_players')
ok('8 joueurs acceptés', !(await start(OPTS, P.slice(0, 8))).err)

// ----------------------------------------------------------------------------- intro -> lancer
ok('tick avant l’échéance : sans effet', must(await act(s0, A, tick), 't0').state.phase === 'intro')
ok('roll pendant le générique → wrong_phase', (await act(s0, A, roll())).err === 'wrong_phase')
const r1 = must(await act(late(s0), A, tick), 'r1')
ok('fin du générique → lancer, tour 1, échéance ≈ 15 s', r1.state.phase === 'roll' && r1.state.round === 1 && approx(r1.state.deadline, 15) && Object.values(r1.state.rolls).every((x) => x === null))
ok('tour 1 : ordre de passage inchangé', JSON.stringify(r1.state.order) === JSON.stringify(s0.state.order))
ok('tick répété : idempotent', must(await act(r1, A, tick), 't1').state.round === 1)

// ----------------------------------------------------------------------------- lancer
ok('pas joueur → not_a_player', (await act(r1, OUT, roll())).err === 'not_a_player')
let R = must(await act(patch(r1, {}, { forced_dice: [4, 2, 6], dice_i: 0 }), A, roll()), 'rollA')
ok('lancer : un dé (dé imposé 4), en attente des autres', JSON.stringify(R.state.rolls[A].dice) === '[4]' && R.state.rolls[A].double === false && R.state.phase === 'roll')
ok('deuxième lancer → already_rolled', (await act(R, A, roll())).err === 'already_rolled')
R = must(await act(R, B, roll(true)), 'rollB')
ok('Double dé : deux dés (2 + 6), plus de Double dé', JSON.stringify(R.state.rolls[B].dice) === '[2,6]' && R.state.double_left[B] === 0 && R.state.stats[B].doubles === 1)
ok('Double dé déjà utilisé → no_double_left', (await act(patch(R, { rolls: { ...R.state.rolls, [B]: null } }), B, roll(true))).err === 'no_double_left')
const auto = must(await act(late(R), C, tick), 'auto')
ok('échéance : lancers d’office (dé simple) puis déplacements', auto.state.phase === 'move' && auto.state.rolls[C].auto === true && auto.state.rolls[D].dice.length === 1 && auto.state.moves.length === 4)
ok('déplacements : scénario dans l’ordre de passage, durée 2 + 5 s × 4', JSON.stringify(auto.state.moves.map((m) => m.id)) === JSON.stringify(auto.state.order) && approx(auto.state.deadline, 22))
ok('déplacements : instantanés before / after', auto.state.before.pos[A] === 0 && auto.state.moves.every((m) => m.after && typeof m.after.coins === 'object'))
const mA = auto.state.moves.find((m) => m.id === A)
ok('pion A : 4 cases, une étape par case', mA.from === 0 && mA.steps.length >= 4 && mA.steps[3].cell === 4)
let lateRoll = must(await act(late(patch(r1, {}, { forced_dice: [3, 3, 3, 3] })), A, roll()), 'lateRoll')
ok('lancer après l’échéance : compté, puis tout le tour se résout', lateRoll.state.phase === 'move' && lateRoll.state.rolls[A].auto === undefined && lateRoll.state.rolls[B].auto === true)

// ----------------------------------------------------------------------------- cases (2 joueurs, ordre A puis B)
const two = must(await start(OPTS, [A, B]), 'two')
const T0 = must(await act(late(two), A, tick), 'T0')
/** Joue un tour : dés imposés pour A puis B (+ dés suivants), cartes imposées. */
async function turn(st, { pos = {}, coins = {}, stars = {}, star = 18, dist = {}, half = {}, dice = [1, 1], cards = [] } = {}) {
  const base = patch(st, {
    order: [A, B],
    pos: { ...st.state.pos, ...pos },
    coins: { ...st.state.coins, ...coins },
    stars: { ...st.state.stars, ...stars },
    dist: { ...st.state.dist, ...dist },
    half_price: { ...st.state.half_price, ...half },
    star_cell: star,
  }, { forced_dice: dice, dice_i: 0, forced_cards: cards })
  const a = must(await act(base, A, roll()), 'turn A')
  return must(await act(a, B, roll()), 'turn B')
}
const evOf = (r, id = A) => r.state.moves.find((m) => m.id === id).steps.flatMap((s) => s.ev)
// B part de 13 (Loge sans étoile -> 14 Applaudissements) avec un dé de 1, sauf mention contraire.
const NB = { pos: { [B]: 12 } }

let t = await turn(T0, { ...NB, dice: [1, 1] })
ok('Applaudissements : +3', t.state.pos[A] === 1 && t.state.coins[A] === 13 && evOf(t).some((e) => e.t === 'clap' && e.d === 3))
t = await turn(T0, { ...NB, dice: [2, 1] })
ok('Loge sans étoile : rien', t.state.pos[A] === 2 && t.state.coins[A] === 10 && evOf(t).length === 0)
t = await turn(T0, { ...NB, dice: [3, 1] })
ok('Page de pub : −3, compteur pubs', t.state.coins[A] === 7 && t.state.stats[A].pubs === 1 && evOf(t).some((e) => e.t === 'pub' && e.d === -3))
t = await turn(T0, { ...NB, coins: { [A]: 1 }, dice: [3, 1] })
ok('Page de pub : jamais sous 0, Fauché', t.state.coins[A] === 0 && t.state.stats[A].broke === 1 && evOf(t).some((e) => e.t === 'pub' && e.d === -1))
t = await turn(T0, { ...NB, pos: { ...NB.pos, [A]: 22 }, dice: [3, 1] })
ok('passage par Départ : +5 (+3 à l’arrivée sur Applaudissements)', t.state.pos[A] === 1 && t.state.coins[A] === 18 && evOf(t).some((e) => e.t === 'start' && e.d === 5))
t = await turn(T0, { ...NB, pos: { ...NB.pos, [A]: 20 }, dice: [4, 1] })
ok('arrêt sur Départ : +5 une seule fois', t.state.pos[A] === 0 && t.state.coins[A] === 15)
ok('chemin parcouru (dist)', t.state.dist[A] === 4)

// ----------------------------------------------------------------------------- étoile
t = await turn(T0, { ...NB, coins: { [A]: 20 }, star: 2, dice: [2, 1] })
ok('étoile à l’arrêt : achetée 20 pièces, Pile dessus', t.state.stars[A] === 1 && t.state.coins[A] === 0 && t.state.stats[A].star_exact === 1 && evOf(t).some((e) => e.t === 'star' && e.exact === true && e.cost === 20))
ok('achat d’étoile : pas « Fauché » même à 0 pièce', t.state.stats[A].broke === 0)
ok('l’étoile déménage dans une autre Loge', LOGES.includes(t.state.star_cell) && t.state.star_cell !== 2)
t = await turn(T0, { ...NB, coins: { [A]: 25 }, star: 2, dice: [4, 1] })
ok('étoile au passage : achetée, pas « pile dessus »', t.state.stars[A] === 1 && t.state.coins[A] === 8 && t.state.stats[A].star_exact === 0)
t = await turn(T0, { ...NB, coins: { [A]: 19 }, star: 2, dice: [2, 1] })
ok('19 pièces : pas d’achat (star_poor), l’étoile reste', t.state.stars[A] === 0 && t.state.star_cell === 2 && evOf(t).some((e) => e.t === 'star_poor' && e.need === 20))
t = await turn(T0, { ...NB, coins: { [A]: 10 }, half: { [A]: true }, star: 2, dice: [2, 1] })
ok('demi-tarif : étoile à 10, promo consommée', t.state.stars[A] === 1 && t.state.coins[A] === 0 && t.state.half_price[A] === false)

// ----------------------------------------------------------------------------- les 12 cartes (A part de 0, dé 5 -> Enveloppe en 5)
const card = async (id, opts = {}) => turn(T0, { ...NB, dice: [5, 1, ...(opts.extra ?? [])], cards: [id], ...opts })
const cev = (r) => evOf(r).find((e) => e.t === 'card')
t = await card('plus8')
ok('carte +8', t.state.coins[A] === 18 && cev(t).card === 'plus8' && cev(t).text.length > 5 && t.state.stats[A].envelopes === 1)
ok('meilleur moment : plus gros gain en une carte', t.state.stats[A].best_card?.gain === 8)
t = await card('minus5')
ok('carte −5', t.state.coins[A] === 5)
t = await card('fwd3')
const fwdSteps = t.state.moves.find((m) => m.id === A).steps
ok('carte avance de 3 : 5 → 8, étapes marquées card, pas d’effet d’arrivée (8 = Applaudissements)', t.state.pos[A] === 8 && fwdSteps.length === 8 && fwdSteps.slice(5).every((s) => s.card) && t.state.coins[A] === 10)
t = await card('fwd3', { coins: { [A]: 20 }, star: 6 })
ok('carte avance de 3 : achat d’étoile au passage', t.state.stars[A] === 1)
t = await card('back3')
ok('carte recule de 3 : 5 → 2, sans effet d’arrivée', t.state.pos[A] === 2 && t.state.coins[A] === 10 && t.state.dist[A] === 2)
// Enveloppe en 21 (16 + 5) puis avance de 3 : 22, 23, 0 (Départ).
t = await turn(T0, { ...NB, pos: { ...NB.pos, [A]: 16 }, dice: [5, 1], cards: ['fwd3'] })
ok('carte avance de 3 par-dessus Départ : +5', t.state.pos[A] === 0 && t.state.coins[A] === 15)
t = await card('swap_lead', { pos: { [A]: 0, [B]: 12 }, dist: { [A]: 0, [B]: 40 } })
ok('carte échange de place avec le plus loin devant (dist)', t.state.pos[A] === 12 && t.state.moves.find((m) => m.id === A).after.pos[B] === 5 && t.state.dist[A] === 40 && cev(t).with === B)
t = await card('swap_lead', { pos: { [A]: 0, [B]: 12 }, dist: { [A]: 0, [B]: 0 } })
ok('carte échange : personne devant → sans effet', t.state.pos[A] === 5 && cev(t).none === true)
t = await card('steal3', { coins: { [A]: 10, [B]: 30 } })
ok('carte pickpocket : 3 pièces au plus riche', t.state.coins[A] === 13 && t.state.coins[B] === 27 && cev(t).from === B)
t = await card('steal3', { coins: { [A]: 10, [B]: 2 } })
ok('carte pickpocket : pas plus que ce qu’il a', t.state.coins[A] === 12 && t.state.coins[B] === 0)
t = await card('charity', { coins: { [A]: 10, [B]: 1 }, stars: { [A]: 1, [B]: 0 } })
ok('carte Téléthon : tout le monde donne 2 au dernier (B : 0 étoile)', t.state.coins[A] === 8 && t.state.coins[B] === 3 && cev(t).to === B && cev(t).d === 2)
t = await card('charity', { coins: { [A]: 1, [B]: 30 } })
ok('carte Téléthon : le tireur est dernier → il reçoit', t.state.coins[A] === 3 && t.state.coins[B] === 28)
t = await card('everyone3')
ok('carte tournée générale : +3 pour tous', t.state.coins[A] === 13 && t.state.coins[B] === 13)
t = await card('star_moves', { star: 13 })
ok('carte l’étoile déménage', t.state.star_cell !== 13 && LOGES.includes(t.state.star_cell))
t = await card('reroll', { extra: [2] })
ok('carte rejoue un dé : 5 → 7, sans effet d’arrivée', t.state.pos[A] === 7 && t.state.coins[A] === 10 && cev(t).die === 2)
t = await card('half_price')
ok('carte demi-tarif', t.state.half_price[A] === true)
t = await card('gift_double')
ok('carte cadeau : +1 Double dé', t.state.double_left[A] === 2)
t = await turn(T0, { ...NB, pos: { [A]: 0, [B]: 12 }, dice: [5, 1], cards: [] })
ok('enveloppe sans carte imposée : pioche mélangée', cev(t) && cards.some((c) => c.id === cev(t).card) && t.server.deck.length === 11)

// ----------------------------------------------------------------------------- enchaînement des phases
let G = auto
ok('tick pendant les déplacements (avant échéance) : sans effet', must(await act(G, A, tick), 'gm').state.phase === 'move')
G = must(await act(late(patch(G, {}, { forced_mg: ['quiz'] })), A, tick), 'mgi')
ok('fin des déplacements → annonce du mini-jeu (8 s), mini-jeu n°1', G.state.phase === 'mg_intro' && G.state.mg.no === 1 && G.state.mg.kind === 'quiz' && approx(G.state.deadline, 8) && G.state.mg.finale === false)
ok('quiz : 3 questions à 4 choix, sans les réponses', G.state.mg.data.questions.length === 3 && G.state.mg.data.questions.every((q) => q.choices.length === 4) && !('answers' in G.state.mg.data) && G.server.mg.secret.answers.length === 3)
ok('envoi pendant l’annonce : ignoré', must(await act(G, A, sub(1, { answers: [0, 0, 0], ms: [1, 1, 1] })), 'early').state.mg.submitted.length === 0)
G = must(await act(late(G), A, tick), 'mgp')
ok('fin de l’annonce → mini-jeu, échéance ≈ 26 s, départ commun', G.state.phase === 'mg_play' && approx(G.state.deadline, 26) && approx(G.state.mg.started_at, 0))
ok('tick idempotent pendant le mini-jeu', must(await act(G, A, tick), 'mgt').state.phase === 'mg_play')
const ans = G.server.mg.secret.answers
const wrong = (i) => (ans[i] + 1) % 4
let Q = must(await act(G, A, sub(1, { answers: ans, ms: [1000, 1000, 1000] })), 'qa')
ok('envoi : compté, résultat caché', Q.state.mg.submitted.includes(A) && Q.state.mg.results === null && Q.state.phase === 'mg_play')
ok('doublon : ignoré', must(await act(Q, A, sub(1, { answers: [null, null, null], ms: [0, 0, 0] })), 'dupq').state.mg.submitted.length === 1)
ok('mauvais numéro de mini-jeu : ignoré sans erreur', must(await act(Q, B, sub(7, { answers: ans, ms: [1, 1, 1] })), 'wrongno').state.mg.submitted.length === 1)
ok('envoi mal formé → invalid_submit', (await act(Q, B, sub(1, { answers: [0, 0], ms: [1, 1] }))).err === 'invalid_submit' && (await act(Q, B, sub(1, { answers: [5, 0, 0], ms: [1, 1, 1] }))).err === 'invalid_submit' && (await act(Q, B, sub(1, { answers: [0, 0, 0], ms: [1, 1, 99999] }))).err === 'invalid_submit')
ok('pas joueur → not_a_player', (await act(Q, OUT, sub(1, { answers: ans, ms: [1, 1, 1] }))).err === 'not_a_player')
Q = must(await act(Q, B, sub(1, { answers: [ans[0], ans[1], wrong(2)], ms: [500, 500, 500] })), 'qb')
const coinsBefore = { ...Q.state.coins }
Q = must(await act(Q, C, sub(1, { answers: ans, ms: [3000, 3000, 3000] })), 'qc')
Q = must(await act(late(Q), D, tick), 'qclose')
const res = (st, id) => st.state.mg.results.find((r) => r.id === id)
ok('quiz : fin à l’échéance → résultats (8 s)', Q.state.phase === 'mg_result' && approx(Q.state.deadline, 8))
ok('quiz : 3 bonnes rapides 1er (+10), 3 bonnes lentes 2e (+6), 2 bonnes 3e (+4), pas joué 0', res(Q, A).rank === 1 && res(Q, C).rank === 2 && res(Q, B).rank === 3 && res(Q, D).played === false && res(Q, A).coins === 10 && res(Q, C).coins === 6 && res(Q, B).coins === 4 && res(Q, D).coins === 0)
ok('quiz : pièces versées', Q.state.coins[A] === coinsBefore[A] + 10 && Q.state.coins[D] === coinsBefore[D])
ok('quiz : réponses révélées, score = bonnes réponses', JSON.stringify(Q.state.mg.reveal.answers) === JSON.stringify(ans) && res(Q, A).score === 3 && res(Q, B).score === 2)
ok('mini-jeux gagnés / série', Q.state.stats[A].mg_wins === 1 && Q.state.stats[A].mg_streak_max === 1 && Q.state.stats[C].mg_wins === 0)
ok('envoi après la fin : ignoré', must(await act(Q, D, sub(1, { answers: ans, ms: [1, 1, 1] })), 'after').state.mg.results.length === 4)
const N2 = must(await act(late(Q), A, tick), 'next')
ok('fin des résultats → tour 2 : l’ordre de passage tourne d’un cran', N2.state.phase === 'roll' && N2.state.round === 2 && JSON.stringify(N2.state.order) === JSON.stringify([...auto.state.order.slice(1), auto.state.order[0]]))
ok('tour 2 : lancers remis à zéro', Object.values(N2.state.rolls).every((x) => x === null) && N2.state.moves.length === 0)

/** Ouvre un mini-jeu `kind` (n°2) prêt à jouer depuis l'état « move » d'un tour. */
async function openMg(kind, from = auto, statePatch = {}) {
  let st = must(await act(late(patch(from, statePatch, { forced_mg: [kind] })), A, tick), 'open ' + kind)
  st = must(await act(late(st), A, tick), 'play ' + kind)
  return st
}
const close = async (st) => must(await act(late(st, 4), A, tick), 'close')

// pif : réponse 100 ; A 90, B 110 (même écart) ex aequo 1ers, C 50 3e, D pas joué.
let M = await openMg('pif')
ok('pif : question publique, réponse cachée', M.state.mg.data.prompt === 'Combien de marches ?' && M.state.mg.data.unit === 'marches' && !('answer' in M.state.mg.data) && approx(M.state.deadline, 22))
ok('pif : valeur non numérique → invalid_submit', (await act(M, A, sub(1, { value: '90' }))).err === 'invalid_submit')
for (const [p, v] of [[A, 90], [B, 110], [C, 50]]) M = must(await act(M, p, sub(1, { value: v })), 'pif ' + p)
M = await close(M)
ok('pif : ex aequo 1ers (+10 chacun), suivant 3e (+4)', res(M, A).rank === 1 && res(M, B).rank === 1 && res(M, C).rank === 3 && res(M, A).coins === 10 && res(M, B).coins === 10 && res(M, C).coins === 4 && M.state.mg.reveal.answer === 100)
ok('pif : deux vainqueurs → mg_wins pour chacun', M.state.stats[A].mg_wins === 1 && M.state.stats[B].mg_wins === 1)

// majorite : A, B, C votent pour A, D pour B.
M = await openMg('majorite')
ok('majorite : vote pour un non-joueur → invalid_submit', (await act(M, A, sub(1, { target: OUT }))).err === 'invalid_submit')
for (const [p, v] of [[A, A], [B, A], [C, A]]) M = must(await act(M, p, sub(1, { target: v })), 'maj ' + p)
M = must(await act(M, D, sub(1, { target: B })), 'maj D')
ok('majorite : tous ont voté → résultats tout de suite', M.state.phase === 'mg_result')
ok('majorite : la majorité 1re (+10), les autres derniers (+2)', [A, B, C].every((p) => res(M, p).rank === 1 && res(M, p).coins === 10) && res(M, D).rank === 4 && res(M, D).coins === 2 && JSON.stringify(M.state.mg.reveal.top) === JSON.stringify([A]))

// buzzer
M = await openMg('buzzer')
ok('buzzer : instant du vert publié, échéance = vert + 4 s', M.state.mg.data.go_at && Math.abs(new Date(M.state.deadline) - new Date(M.state.mg.data.go_at) - 4000) < 50)
ok('buzzer : envoi bien avant le vert → invalid_submit', (await act(M, A, sub(1, { ms: 300 }))).err === 'invalid_submit' || new Date(M.state.mg.data.go_at) - Date.now() < 1000)
M = patch(M, { mg: { ...M.state.mg, data: { ...M.state.mg.data, go_at: iso(-1) } } })
ok('buzzer : réaction hors bornes → invalid_submit', (await act(M, A, sub(1, { ms: 9000 }))).err === 'invalid_submit')
for (const [p, v] of [[A, { ms: 250 }], [B, { ms: 300 }], [C, { false_start: true }], [D, { ms: 50 }]]) M = must(await act(M, p, sub(1, v)), 'buz ' + p)
ok('buzzer : plus rapide 1er, faux départs (et < 120 ms) derniers ex aequo', res(M, A).rank === 1 && res(M, B).rank === 2 && res(M, C).rank === 3 && res(M, D).rank === 3 && res(M, D).false_start === true && res(M, C).coins === 4)

// etoiles : score plafonné
M = await openMg('etoiles')
ok('etoiles : graine et plafond publiés', Number.isInteger(M.state.mg.data.seed) && M.state.mg.data.cap === 30 && approx(M.state.deadline, 18))
ok('etoiles : score négatif → invalid_submit', (await act(M, A, sub(1, { score: -1 }))).err === 'invalid_submit')
M = must(await act(M, A, sub(1, { score: 999 })), 'et A')
M = must(await act(M, B, sub(1, { score: 12 })), 'et B')
M = await close(M)
ok('etoiles : score plafonné à 30, meilleur score 1er', res(M, A).score === 30 && res(M, A).rank === 1 && res(M, B).rank === 2 && res(M, C).coins === 0)

// chrono : cible 7 000 ms
M = await openMg('chrono')
for (const [p, v] of [[A, 7400], [B, 6900], [C, 7000]]) M = must(await act(M, p, sub(1, { ms: v })), 'chr ' + p)
ok('chrono : valeur hors bornes → invalid_submit', (await act(M, D, sub(1, { ms: 70000 }))).err === 'invalid_submit')
M = await close(M)
ok('chrono : plus petit écart à 7,00 s', res(M, C).rank === 1 && res(M, B).rank === 2 && res(M, A).rank === 3 && M.state.mg.reveal.target === 7000)

// envoi en retard (> échéance + 3 s) : le mini-jeu se clôt sans lui
M = await openMg('chrono')
M = must(await act(late(M, 5), A, sub(1, { ms: 7000 })), 'late sub')
ok('envoi après échéance + 3 s : mini-jeu clos, envoi ignoré', M.state.phase === 'mg_result' && res(M, A).played === false)
M = await openMg('chrono')
M = must(await act(late(M, 1), A, sub(1, { ms: 7000 })), 'grace sub')
ok('envoi dans la tolérance de 3 s : accepté', M.state.mg.submitted.includes(A) && M.state.phase === 'mg_play')

// finale : gains doublés
M = await openMg('etoiles', auto, { round: 9 })
ok('dernier tour : mini-jeu « finale »', M.state.mg.finale === true)
M = must(await act(M, A, sub(1, { score: 10 })), 'fin A')
M = must(await act(M, B, sub(1, { score: 5 })), 'fin B')
M = await close(M)
ok('finale : gains doublés (20 / 12)', res(M, A).coins === 20 && res(M, B).coins === 12)

// série de mini-jeux gagnés (Le triplé)
let S = auto
for (let i = 0; i < 3; i++) {
  S = await openMg('etoiles', S)
  S = must(await act(S, A, sub(S.state.mg.no, { score: 20 })), 'streak')
  S = await close(S)
  S = patch(S, { phase: 'move' })
}
ok('3 mini-jeux gagnés d’affilée : mg_streak_max 3', S.state.stats[A].mg_streak_max === 3 && S.state.stats[A].mg_wins === 3)
S = await openMg('etoiles', S)
S = must(await act(S, B, sub(S.state.mg.no, { score: 20 })), 'streak b')
S = await close(S)
ok('série cassée, le maximum reste', S.state.stats[A].mg_streak === 0 && S.state.stats[A].mg_streak_max === 3)

// ----------------------------------------------------------------------------- sac de mini-jeux
const pick = async (server, state) => (await db.query(`select d.* from public._dp_pick_kind($1::jsonb, $2::jsonb) d`, [JSON.stringify(server), JSON.stringify(state)])).rows[0]
async function draws(server, state, n) {
  const out = []
  for (let i = 0; i < n; i++) {
    const r = await pick(server, state)
    out.push(r.kind)
    server = r.p_server
  }
  return out
}
const seq = await draws(s0.server, s0.state, 18)
const perm = (a) => [...a].sort().join() === 'buzzer,chrono,etoiles,majorite,pif,quiz'
ok('sac : les 6 passent avant qu’un revienne', perm(seq.slice(0, 6)) && perm(seq.slice(6, 12)) && perm(seq.slice(12, 18)), seq.join())
ok('sac : jamais deux fois le même d’affilée', seq.every((k, i) => i === 0 || k !== seq[i - 1]), seq.join())
const seq2 = await draws(two.server, two.state, 10)
ok('sac à 2 joueurs : pas de vote « Comme tout le monde »', !seq2.includes('majorite') && seq2.length === 10)
const bare = must(await start({}, P.slice(0, 3)), 'bare')
const seq3 = await draws(bare.server, bare.state, 9)
ok('sans questions : seulement buzzer, étoiles, chrono', seq3.every((k) => ['buzzer', 'etoiles', 'chrono'].includes(k)) && new Set(seq3).size === 3)
// Le contenu change à chaque fois : 2 quiz de suite = questions 0-2 puis 3-5.
let Z = must(await act(late(patch(auto, {}, { forced_mg: ['quiz'] })), A, tick), 'z1')
const q1 = Z.state.mg.data.questions.map((q) => q.prompt)
Z = must(await act(late(patch(Z, { phase: 'move' }, { forced_mg: ['quiz'] })), A, tick), 'z2')
const q2 = Z.state.mg.data.questions.map((q) => q.prompt)
ok('questions renouvelées d’un quiz à l’autre', q1.join() === 'Question 0 ?,Question 1 ?,Question 2 ?' && q2.join() === 'Question 3 ?,Question 4 ?,Question 5 ?')

// ----------------------------------------------------------------------------- skip / end_game
ok('skip par un joueur → not_host', (await act(r1, A, { type: 'skip' })).err === 'not_host')
const sk = must(await act(r1, A, { type: 'skip' }, true), 'skip')
ok('skip (hôte) au lancer : lancers d’office et déplacements', sk.state.phase === 'move' && sk.state.moves.length === 4)
ok('skip (hôte) en déplacement → annonce du mini-jeu', must(await act(sk, A, { type: 'skip' }, true), 'skip2').state.phase === 'mg_intro')
ok('end_game par un joueur → not_host', (await act(sk, A, { type: 'end_game' })).err === 'not_host')
const eg = must(await act(sk, A, { type: 'end_game' }, true), 'eg')
ok('end_game (hôte) : cérémonie tout de suite', eg.state.phase === 'awards' && eg.state.forced === true && eg.state.ranking.length === 4 && approx(eg.state.deadline, 12))
const egf = must(await act(eg, A, { type: 'end_game' }, true), 'egf')
ok('end_game pendant la cérémonie : fin', egf.state.phase === 'finished' && egf.results.length === 4)
ok('après la fin : end_game / skip → wrong_phase, tick sans effet', (await act(egf, A, { type: 'end_game' }, true)).err === 'wrong_phase' && (await act(egf, A, { type: 'skip' }, true)).err === 'wrong_phase' && must(await act(egf, A, tick), 'ft').state.phase === 'finished')
ok('action inconnue → unknown_action', (await act(r1, A, { type: 'danse' })).err === 'unknown_action')

// ----------------------------------------------------------------------------- cérémonie, classement final
const W = patch(Q, {
  round: 9,
  stars: map([A, B, C, D], [2, 2, 1, 0]),
  coins: map([A, B, C, D], [5, 30, 40, 50]),
  stats: {
    [A]: { ...Q.state.stats[A], mg_wins: 3, pubs: 0 },
    [B]: { ...Q.state.stats[B], mg_wins: 1, pubs: 2 },
    [C]: { ...Q.state.stats[C], mg_wins: 3, pubs: 2 },
    [D]: { ...Q.state.stats[D], mg_wins: 0, pubs: 1 },
  },
})
const aw = must(await act(late(W), A, tick), 'awards')
ok('dernier tour fini → cérémonie (12 s)', aw.state.phase === 'awards' && approx(aw.state.deadline, 12))
const king = aw.state.awards.find((x) => x.kind === 'king'), poisse = aw.state.awards.find((x) => x.kind === 'poisse')
ok('Roi des mini-jeux ex aequo : chacun son étoile', JSON.stringify(king.ids) === JSON.stringify([A, C].sort()) && king.value === 3)
ok('Prix de la poisse ex aequo : chacun son étoile', JSON.stringify(poisse.ids) === JSON.stringify([B, C].sort()) && poisse.value === 2)
ok('étoiles bonus versées (A 3, B 3, C 3, D 0)', aw.state.stars[A] === 3 && aw.state.stars[B] === 3 && aw.state.stars[C] === 3 && aw.state.stars[D] === 0)
const rk = (id) => aw.state.ranking.find((x) => x.id === id).rank
ok('classement : étoiles puis pièces (C 40, B 30, A 5, D)', rk(C) === 1 && rk(B) === 2 && rk(A) === 3 && rk(D) === 4 && JSON.stringify(aw.state.winners) === JSON.stringify([C]))
const fin = must(await act(late(aw), A, tick), 'finish')
const fr = (id) => fin.results.find((x) => x.profile_id === id)
ok('fin de la cérémonie → finished + results', fin.state.phase === 'finished' && fin.results.length === 4 && fin.state.results.length === 4)
ok('placement = rang, points = n − rang + 1, won = rang 1', fr(C).placement === 1 && fr(C).points === 4 && fr(C).won && fr(D).placement === 4 && fr(D).points === 1 && !fr(B).won)
ok('stats : Carton plein (vainqueur + Roi), Constellation, Ciel couvert', fr(C).stats.win_mvp === 1 && fr(A).stats.win_mvp === 0 && fr(C).stats.stars === 3 && fr(D).stats.no_star === 1 && fr(C).stats.no_star === 0)
const tieW = patch(W, { stars: map([A, B, C, D], [1, 1, 0, 0]), coins: map([A, B, C, D], [10, 10, 5, 5]), stats: map([A, B, C, D], { mg_wins: 0, pubs: 0 }) })
const tie = must(await act(late(must(await act(late(tieW), A, tick), 'tieA')), A, tick), 'tieF')
ok('égalité parfaite : victoire partagée (rang 1 ×2, rang 3 ×2), pas d’étoile bonus sans mini-jeu gagné ni pub', tie.results.filter((x) => x.won).length === 2 && tie.results.find((x) => x.profile_id === C).placement === 3 && tie.state.awards.every((x) => x.ids.length === 0))

// ----------------------------------------------------------------------------- catalogue
const tenue = (await db.query(`select game_id, condition_type, threshold, emoji, label from public.tenues where id = 'host'`)).rows[0]
ok('catalogue : tenue host « Animateur Télé » (5 victoires à Dédé Party)', tenue?.game_id === 'dede-party' && tenue.condition_type === 'game_wins' && tenue.threshold === 5 && tenue.emoji === '🎤' && tenue.label === 'Animateur Télé')
const tr = (await db.query(`select slot, id, rule from public.trophies where tenue_id = 'host' and game_id = 'dede-party' and active order by slot`)).rows
ok('catalogue : 11 trophées party_* actifs (slots 2 à 12)', tr.length === 11 && tr[0].slot === 2 && tr[10].slot === 12 && tr.every((x) => x.id.startsWith('party_')), String(tr.length))
const keys = Object.keys(fr(C).stats)
ok('trophées : toutes les stats du catalogue sont posées par le moteur', tr.filter((x) => x.rule.stat && x.rule.stat !== 'won').every((x) => keys.includes(x.rule.stat)), JSON.stringify(tr.map((x) => x.rule.stat)))

// ----------------------------------------------------------------------------- parties complètes au hasard (simulation d'équilibrage)
const rnd = (n) => Math.floor(Math.random() * n)
function randomPayload(st, me, players) {
  const k = st.state.mg.kind
  if (k === 'quiz') return { answers: [rnd(4), rnd(4), Math.random() < 0.1 ? null : rnd(4)], ms: [rnd(8000), rnd(8000), rnd(8000)] }
  if (k === 'pif') return { value: rnd(200) }
  if (k === 'majorite') return { target: players[rnd(players.length)] }
  if (k === 'buzzer') return Math.random() < 0.1 ? { false_start: true } : { ms: 150 + rnd(600) }
  if (k === 'etoiles') return { score: rnd(31) }
  return { ms: 5000 + rnd(4000) }
}
async function simulate(n, rounds) {
  const players = P.slice(0, n)
  let st = must(await start({ ...OPTS, rounds }, players), 'sim')
  st = must(await act(late(st), players[0], tick), 'sim intro')
  for (let guard = 0; guard < 400 && st.state.phase !== 'finished'; guard++) {
    const ph = st.state.phase
    if (ph === 'roll') {
      for (const p of players) {
        if (st.state.phase !== 'roll') break
        if (Math.random() < 0.08) continue // distrait : lancer d'office
        const dbl = st.state.double_left[p] > 0 && Math.random() < 0.25
        st = must(await act(st, p, roll(dbl)), 'sim roll')
      }
      if (st.state.phase === 'roll') st = must(await act(late(st), players[0], tick), 'sim roll tick')
    } else if (ph === 'mg_play') {
      if (st.state.mg.kind === 'buzzer') st = patch(st, { mg: { ...st.state.mg, data: { ...st.state.mg.data, go_at: iso(-2) } } })
      for (const p of players) {
        if (st.state.phase !== 'mg_play') break
        if (Math.random() < 0.05) continue
        st = must(await act(st, p, sub(st.state.mg.no, randomPayload(st, p, players))), 'sim sub')
      }
      if (st.state.phase === 'mg_play') st = must(await act(late(st), players[0], tick), 'sim mg tick')
    } else {
      st = must(await act(late(st), players[0], tick), 'sim tick ' + ph)
    }
  }
  return st
}
const t0 = Date.now()
const sims = []
for (const [n, rounds] of [[4, 9], [6, 9], [8, 9], [3, 6], [4, 12]]) {
  for (let i = 0; i < SIMS; i++) {
    const st = await simulate(n, rounds)
    sims.push({ n, rounds, st })
  }
}
ok(`simulation : ${sims.length} parties complètes jusqu’à finished`, sims.every((x) => x.st.state.phase === 'finished' && x.st.results.length === x.n))
ok('simulation : coins jamais négatifs, étoiles cohérentes', sims.every((x) => Object.values(x.st.state.coins).every((v) => v >= 0) && x.st.results.every((r) => r.stats.stars >= 0)))
const pct = (a, b) => `${Math.round((100 * a) / Math.max(1, b))} %`
console.log(`\n— Simulation (${SIMS} parties par config, ${((Date.now() - t0) / 1000).toFixed(1)} s) —`)
for (const [n, rounds] of [[4, 9], [6, 9], [8, 9], [3, 6], [4, 12]]) {
  const g = sims.filter((x) => x.n === n && x.rounds === rounds)
  const win = g.map((x) => Math.max(...x.st.results.map((r) => r.stats.stars)))
  const all = g.flatMap((x) => x.st.results)
  const dist = {}
  for (const w of win) dist[w] = (dist[w] ?? 0) + 1
  const trophy = (f) => pct(all.filter(f).length, all.length)
  console.log(`  ${n} joueurs, ${rounds} tours : étoiles du vainqueur ${JSON.stringify(dist)} · sans étoile ${trophy((r) => r.stats.no_star === 1)} · pubs≥3 ${trophy((r) => r.stats.pubs >= 3)} · fauché ${trophy((r) => r.stats.broke)} · pile dessus ${trophy((r) => r.stats.star_exact)} · triplé ${trophy((r) => r.stats.mg_streak >= 3)} · 3★+ ${trophy((r) => r.stats.stars >= 3)} · carton plein ${trophy((r) => r.stats.win_mvp)} · pièces gagnées/partie ${Math.round(all.reduce((a, r) => a + r.stats.coins_earned, 0) / all.length)} · enveloppes/partie ${(all.reduce((a, r) => a + r.stats.envelopes, 0) / all.length).toFixed(1)}`)
}

console.log(failed ? '\nÉCHEC' : '\nTout est OK')
process.exit(failed ? 1 : 0)
