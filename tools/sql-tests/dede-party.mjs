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
const tsConst = (name) => JSON.parse(boardTs.match(new RegExp(`export const ${name}[^=]*= (\\[.+\\])\\n`))[1].replace(/'/g, '"'))
const tsCells = tsConst('CELLS')
const board = (await db.query(`select public._dp_board() b`)).rows[0].b
const NEXT = (await db.query(`select public._dp_next() b`)).rows[0].b
const PREV = (await db.query(`select public._dp_prev() b`)).rows[0].b
const count = (t) => board.filter((x) => x === t).length
ok('synchro du plateau SQL ↔ board.ts (cases)', JSON.stringify(board) === JSON.stringify(tsCells), JSON.stringify(tsCells))
ok('synchro du tracé SQL ↔ board.ts (NEXT, PREV)', JSON.stringify(NEXT) === JSON.stringify(tsConst('NEXT')) && JSON.stringify(PREV) === JSON.stringify(tsConst('PREV')))
ok('plateau : 47 cases (1 Départ, 20 Applaudissements, 9 Pub, 8 Enveloppes, 9 Loges)', board.length === 47 && board[0] === 'start' && count('start') === 1 && count('clap') === 20 && count('pub') === 9 && count('env') === 8 && count('loge') === 9, JSON.stringify([count('clap'), count('pub'), count('env'), count('loge')]))
const forks = NEXT.map((n, i) => (Array.isArray(n) ? i : -1)).filter((i) => i >= 0)
ok('tracé : 2 embranchements (cases 13 et 22), chaque case a une suivante et une précédente', NEXT.length === 47 && PREV.length === 47 && JSON.stringify(forks) === '[13,22]')
ok('tracé : PREV est bien l’inverse de NEXT (par la grande boucle aux retours)', PREV.every((p, i) => [NEXT[p]].flat().includes(i)))
// Toutes les cases sont atteignables depuis le Départ, et on revient toujours au Départ.
const reach = new Set([0])
for (let grew = true; grew; ) {
  grew = false
  for (const i of [...reach]) for (const n of [NEXT[i]].flat()) if (!reach.has(n)) { reach.add(n); grew = true }
}
const lap = (ways) => {
  let i = 0, n = 0
  do { const nx = NEXT[i]; i = Array.isArray(nx) ? nx[ways[forks.indexOf(i)]] : nx; n++ } while (i !== 0 && n < 100)
  return n
}
ok('tracé : tout est atteignable ; tour de 36 cases au plus court, 44 par les deux détours', reach.size === 47 && lap([0, 0]) === 36 && lap([1, 1]) === 44 && lap([1, 0]) === 40 && lap([0, 1]) === 40)
const LOGES = board.map((t, i) => (t === 'loge' ? i : -1)).filter((i) => i >= 0)
const cards = (await db.query(`select public._dp_cards() c`)).rows[0].c
ok('12 cartes Enveloppe surprise', cards.length === 12 && new Set(cards.map((c) => c.id)).size === 12)

// ----------------------------------------------------------------------------- démarrage
const s0 = must(await start(), 'start')
ok('state : game dede-party, phase intro (≈ 5 s), tour 0/9', s0.state.game === 'dede-party' && s0.state.phase === 'intro' && s0.state.round === 0 && s0.state.rounds === 9 && approx(s0.state.deadline, 5))
ok('chacun : Départ, 10 pièces, 0 étoile, 1 Triple dé, première étoile à moitié prix', [A, B, C, D].every((p) => s0.state.pos[p] === 0 && s0.state.coins[p] === 10 && s0.state.stars[p] === 0 && s0.state.double_left[p] === 1 && s0.state.half_price[p] === true))
const starsOk = (st, n) => st.state.star_cells.length === n && new Set(st.state.star_cells).size === n && st.state.star_cells.every((c) => LOGES.includes(c))
ok('4 joueurs : 2 étoiles posées sur 2 Loges différentes', starsOk(s0, 2), JSON.stringify(s0.state.star_cells))
ok('2 joueurs : 1 étoile ; 3 à 6 : 2 étoiles ; 7-8 : 3 étoiles', starsOk(must(await start(OPTS, P.slice(0, 2)), 'n2'), 1) && starsOk(must(await start(OPTS, P.slice(0, 3)), 'n3'), 2) && starsOk(must(await start(OPTS, P.slice(0, 6)), 'n6'), 2) && starsOk(must(await start(OPTS, P.slice(0, 7)), 'n7'), 3) && starsOk(must(await start(OPTS, P.slice(0, 8)), 'n8'), 3))
ok('aiguillages : 2, chacun à 0 ou 1', s0.state.sw.length === 2 && s0.state.sw.every((x) => x === 0 || x === 1))
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

// ----------------------------------------------------------------------------- lancer (2 dés, 3 avec le Triple dé)
ok('pas joueur → not_a_player', (await act(r1, OUT, roll())).err === 'not_a_player')
// Étoiles loin (27, 30) et sans pièces : le trajet de A (0 → 6) ne dépend que des dés.
const r1f = patch(r1, { star_cells: [27, 30] }, { forced_dice: [4, 2, 6, 1, 3], dice_i: 0 })
let R = must(await act(r1f, A, roll()), 'rollA')
ok('lancer : deux dés (dés imposés 4 + 2), en attente des autres', JSON.stringify(R.state.rolls[A].dice) === '[4,2]' && R.state.rolls[A].double === false && R.state.phase === 'roll')
ok('deuxième lancer → already_rolled', (await act(R, A, roll())).err === 'already_rolled')
R = must(await act(R, B, roll(true)), 'rollB')
ok('Triple dé : trois dés (6 + 1 + 3), plus de Triple dé', JSON.stringify(R.state.rolls[B].dice) === '[6,1,3]' && R.state.double_left[B] === 0 && R.state.stats[B].doubles === 1)
ok('Triple dé déjà utilisé → no_double_left', (await act(patch(R, { rolls: { ...R.state.rolls, [B]: null } }), B, roll(true))).err === 'no_double_left')
const auto = must(await act(late(R), C, tick), 'auto')
ok('échéance : lancers d’office (2 dés) puis déplacements', auto.state.phase === 'move' && auto.state.rolls[C].auto === true && auto.state.rolls[D].dice.length === 2 && auto.state.moves.length === 4)
ok('déplacements : scénario dans l’ordre de passage, durée 2 + 5 s × 4', JSON.stringify(auto.state.moves.map((m) => m.id)) === JSON.stringify(auto.state.order) && approx(auto.state.deadline, 22))
ok('déplacements : instantanés before / after (pions, étoiles, aiguillages)', auto.state.before.pos[A] === 0 && auto.state.moves.every((m) => m.after && typeof m.after.coins === 'object' && Array.isArray(m.after.star_cells) && Array.isArray(m.after.sw)))
const mA = auto.state.moves.find((m) => m.id === A)
ok('pion A : 6 cases, une étape par case', mA.from === 0 && mA.steps.length >= 6 && mA.steps[5].cell === 6)
let lateRoll = must(await act(late(patch(r1, {}, { forced_dice: [3, 3, 3, 3, 3, 3, 3, 3] })), A, roll()), 'lateRoll')
ok('lancer après l’échéance : compté, puis tout le tour se résout', lateRoll.state.phase === 'move' && lateRoll.state.rolls[A].auto === undefined && lateRoll.state.rolls[B].auto === true)

// ----------------------------------------------------------------------------- cases (2 joueurs, ordre A puis B)
const two = must(await start(OPTS, [A, B]), 'two')
const T0 = must(await act(late(two), A, tick), 'T0')
/**
 * Joue un tour : `dice` = les 2 dés de A, puis ceux de B (1 + 1 par défaut), puis les dés suivants (carte « Bis »).
 * Par défaut : B part de la case 1 et s'arrête en 3 (Loge sans étoile : rien), l'étoile est loin (30),
 * pas de promo de bienvenue, aiguillages tout droit.
 */
async function turn(st, { pos = {}, coins = {}, stars = {}, star = [30], sw = [0, 0], dist = {}, half = {}, dice = [1, 1], extra = [], diceB = [1, 1], cards = [] } = {}) {
  const base = patch(st, {
    order: [A, B],
    pos: { ...st.state.pos, [B]: 1, ...pos },
    coins: { ...st.state.coins, ...coins },
    stars: { ...st.state.stars, ...stars },
    dist: { ...st.state.dist, ...dist },
    half_price: { [A]: false, [B]: false, ...half },
    star_cells: star,
    sw,
  }, { forced_dice: [...dice, ...diceB, ...extra], dice_i: 0, forced_cards: cards })
  const a = must(await act(base, A, roll()), 'turn A')
  return must(await act(a, B, roll()), 'turn B')
}
const evOf = (r, id = A) => r.state.moves.find((m) => m.id === id).steps.flatMap((s) => s.ev)

let t = await turn(T0, { dice: [1, 3] })
ok('Applaudissements : +3', t.state.pos[A] === 4 && t.state.coins[A] === 13 && evOf(t).some((e) => e.t === 'clap' && e.d === 3))
ok('B (témoin) : case 1 → 3, Loge sans étoile, rien', t.state.pos[B] === 3 && t.state.coins[B] === 10 && evOf(t, B).length === 0)
t = await turn(T0, { dice: [1, 2] })
ok('Loge sans étoile : rien', t.state.pos[A] === 3 && t.state.coins[A] === 10 && evOf(t).length === 0)
t = await turn(T0, { dice: [1, 1] })
ok('Page de pub : −3, compteur pubs', t.state.pos[A] === 2 && t.state.coins[A] === 7 && t.state.stats[A].pubs === 1 && evOf(t).some((e) => e.t === 'pub' && e.d === -3))
t = await turn(T0, { coins: { [A]: 1 }, dice: [1, 1] })
ok('Page de pub : jamais sous 0, Fauché', t.state.coins[A] === 0 && t.state.stats[A].broke === 1 && evOf(t).some((e) => e.t === 'pub' && e.d === -1))
t = await turn(T0, { pos: { [A]: 34 }, dice: [1, 2] })
ok('passage par Départ : +5 (+3 à l’arrivée sur Applaudissements)', t.state.pos[A] === 1 && t.state.coins[A] === 18 && evOf(t).some((e) => e.t === 'start' && e.d === 5))
t = await turn(T0, { pos: { [A]: 33 }, dice: [1, 2] })
ok('arrêt sur Départ : +5 une seule fois', t.state.pos[A] === 0 && t.state.coins[A] === 15)
ok('chemin parcouru (dist)', t.state.dist[A] === 3)

// ----------------------------------------------------------------------------- embranchements (l'aiguillage bascule à chaque passage)
t = await turn(T0, { pos: { [A]: 12 }, sw: [0, 0], dice: [1, 1] })
ok('aiguillage 13 « tout droit » : 12 → 13 → 14 (Pub), puis il bascule', t.state.pos[A] === 14 && t.state.coins[A] === 7 && JSON.stringify(t.state.sw) === '[1,0]' && evOf(t).some((e) => e.t === 'fork' && e.fork === 0 && e.way === 0))
t = await turn(T0, { pos: { [A]: 12 }, sw: [1, 0], dice: [1, 1] })
ok('aiguillage 13 « La Scène » : 12 → 13 → 36 (Applaudissements), puis il bascule', t.state.pos[A] === 36 && t.state.coins[A] === 13 && JSON.stringify(t.state.sw) === '[0,0]' && evOf(t).some((e) => e.t === 'fork' && e.fork === 0 && e.way === 1))
ok('l’évènement fork est sur la première case de la voie prise', t.state.moves[0].steps[1].cell === 36 && t.state.moves[0].steps[1].ev[0].t === 'fork' && t.state.moves[0].steps[0].ev.length === 0)
t = await turn(T0, { pos: { [A]: 21 }, sw: [0, 1], dice: [1, 1] })
ok('aiguillage 22 « Tunnel de la pub » : 21 → 22 → 41 (Pub)', t.state.pos[A] === 41 && t.state.coins[A] === 7 && JSON.stringify(t.state.sw) === '[0,0]' && evOf(t).some((e) => e.t === 'fork' && e.fork === 1 && e.way === 1))
t = await turn(T0, { pos: { [A]: 21 }, sw: [0, 0], dice: [1, 2] })
ok('aiguillage 22 « tout droit » : 21 → 22 → 23 → 24', t.state.pos[A] === 24 && JSON.stringify(t.state.sw) === '[0,1]')
t = await turn(T0, { pos: { [A]: 11 }, sw: [1, 0], dice: [1, 1] })
ok('s’arrêter SUR l’embranchement ne bascule pas l’aiguillage', t.state.pos[A] === 13 && JSON.stringify(t.state.sw) === '[1,0]' && !evOf(t).some((e) => e.t === 'fork'))
t = await turn(T0, { pos: { [A]: 12, [B]: 12 }, sw: [1, 0], dice: [1, 1] })
ok('deux pions de suite : le premier par La Scène, le second tout droit', t.state.pos[A] === 36 && t.state.pos[B] === 14 && JSON.stringify(t.state.sw) === '[1,0]' && t.state.moves[0].after.sw[0] === 0)
t = await turn(T0, { pos: { [A]: 39 }, dice: [1, 1] })
ok('La Scène rejoint la boucle : 39 → 40 → 15', t.state.pos[A] === 15 && t.state.coins[A] === 13)
t = await turn(T0, { pos: { [A]: 45 }, dice: [1, 1] })
ok('Le Tunnel rejoint la boucle : 45 → 46 → 25', t.state.pos[A] === 25)
t = await turn(T0, { pos: { [A]: 10 }, sw: [1, 0], dice: [6, 6] })
ok('grand lancer à travers La Scène : 10 → … 13, 36-40, 15, 16, 17, 18 (12 cases)', t.state.pos[A] === 18 && JSON.stringify(t.state.moves[0].steps.map((s) => s.cell)) === '[11,12,13,36,37,38,39,40,15,16,17,18]', JSON.stringify(t.state.moves[0].steps.map((s) => s.cell)))

// ----------------------------------------------------------------------------- étoiles
t = await turn(T0, { coins: { [A]: 30 }, star: [3], dice: [1, 2] })
ok('étoile à l’arrêt : achetée 30 pièces, Pile dessus', t.state.stars[A] === 1 && t.state.coins[A] === 0 && t.state.stats[A].star_exact === 1 && evOf(t).some((e) => e.t === 'star' && e.exact === true && e.cost === 30))
ok('achat d’étoile : pas « Fauché » même à 0 pièce', t.state.stats[A].broke === 0)
ok('l’étoile déménage dans une autre Loge', t.state.star_cells.length === 1 && LOGES.includes(t.state.star_cells[0]) && t.state.star_cells[0] !== 3 && JSON.stringify(evOf(t).find((e) => e.t === 'star').stars) === JSON.stringify(t.state.moves[0].after.star_cells))
t = await turn(T0, { coins: { [A]: 35 }, star: [3], dice: [2, 2] })
ok('étoile au passage : achetée, pas « pile dessus »', t.state.stars[A] === 1 && t.state.coins[A] === 8 && t.state.stats[A].star_exact === 0)
t = await turn(T0, { coins: { [A]: 29 }, star: [3], dice: [1, 2] })
ok('29 pièces : pas d’achat (star_poor), l’étoile reste', t.state.stars[A] === 0 && t.state.star_cells[0] === 3 && evOf(t).some((e) => e.t === 'star_poor' && e.need === 30))
t = await turn(T0, { coins: { [A]: 15 }, half: { [A]: true }, star: [3], dice: [1, 2] })
ok('demi-tarif (promo de bienvenue / carte) : étoile à 15, promo consommée', t.state.stars[A] === 1 && t.state.coins[A] === 0 && t.state.half_price[A] === false)
t = await turn(T0, { coins: { [A]: 65 }, star: [3, 7], dice: [4, 4] })
ok('deux étoiles sur le trajet : les deux achetées (65 − 60 − 3 de pub)', t.state.stars[A] === 2 && t.state.coins[A] === 2 && t.state.stats[A].stars_bought === 2)
ok('les deux étoiles déménagent sur deux Loges différentes', t.state.star_cells.length === 2 && new Set(t.state.star_cells).size === 2 && t.state.star_cells.every((c) => LOGES.includes(c)), JSON.stringify(t.state.star_cells))
t = await turn(T0, { pos: { [A]: 13 }, coins: { [A]: 30 }, sw: [1, 0], star: [38], dice: [1, 2] })
ok('étoile dans la Loge de La Scène (38) : achetée quand l’aiguillage y mène', t.state.pos[A] === 38 && t.state.stars[A] === 1)
t = await turn(T0, { pos: { [A]: 13 }, coins: { [A]: 30 }, sw: [0, 0], star: [38], dice: [1, 1] })
ok('… et ratée quand l’aiguillage envoie tout droit', t.state.pos[A] === 15 && t.state.stars[A] === 0 && t.state.star_cells[0] === 38)

// ----------------------------------------------------------------------------- les 12 cartes (A part de 0, dés 2 + 3 -> Enveloppe en 5)
const card = async (id, opts = {}) => turn(T0, { dice: [2, 3], cards: [id], ...opts })
const cev = (r) => evOf(r).find((e) => e.t === 'card')
t = await card('plus8')
ok('carte +8', t.state.coins[A] === 18 && cev(t).card === 'plus8' && cev(t).text.length > 5 && t.state.stats[A].envelopes === 1)
ok('meilleur moment : plus gros gain en une carte', t.state.stats[A].best_card?.gain === 8)
t = await card('minus5')
ok('carte −5', t.state.coins[A] === 5)
t = await card('fwd3')
const fwdSteps = t.state.moves.find((m) => m.id === A).steps
ok('carte avance de 3 : 5 → 8, étapes marquées card, pas d’effet d’arrivée (8 = Pub)', t.state.pos[A] === 8 && fwdSteps.length === 8 && fwdSteps.slice(5).every((s) => s.card) && t.state.coins[A] === 10)
t = await card('fwd3', { coins: { [A]: 30 }, star: [7] })
ok('carte avance de 3 : achat d’étoile au passage', t.state.stars[A] === 1)
t = await card('back3')
ok('carte recule de 3 : 5 → 2, sans effet d’arrivée', t.state.pos[A] === 2 && t.state.coins[A] === 10 && t.state.dist[A] === 2)
t = await turn(T0, { pos: { [A]: 14 }, dice: [1, 1], cards: ['back3'] })
ok('carte recule de 3 depuis 16 : 15, 14, 13 (par la grande boucle)', t.state.pos[A] === 13)
t = await turn(T0, { pos: { [A]: 13 }, sw: [1, 0], dice: [1, 1], cards: ['back3'] })
ok('carte recule de 3 depuis La Scène (37) : 36, 13, 12, l’aiguillage ne rebascule pas', t.state.pos[A] === 12 && JSON.stringify(t.state.sw) === '[0,0]')
t = await turn(T0, { pos: { [A]: 20 }, sw: [0, 0], dice: [1, 1], cards: ['fwd3'] })
ok('carte avance de 3 à travers un aiguillage (22 → 23, 24, 25) : il bascule', t.state.pos[A] === 25 && JSON.stringify(t.state.sw) === '[0,1]')
// Enveloppe en 32 (30 + 2) puis « Bis » avec un dé de 4 : 33, 34, 35, 0 (Départ).
t = await turn(T0, { pos: { [A]: 30 }, dice: [1, 1], extra: [4], cards: ['reroll'] })
ok('carte Bis par-dessus Départ : +5', t.state.pos[A] === 0 && t.state.coins[A] === 15 && cev(t).die === 4)
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
t = await card('star_moves', { star: [11, 17] })
ok('carte changement de décor : toutes les étoiles déménagent', t.state.star_cells.length === 2 && new Set(t.state.star_cells).size === 2 && t.state.star_cells.every((c) => LOGES.includes(c)) && t.state.star_cells[0] !== 11 && !t.state.star_cells.includes(17) && JSON.stringify(cev(t).stars) === JSON.stringify(t.state.star_cells), JSON.stringify(t.state.star_cells))
t = await card('reroll', { extra: [2] })
ok('carte Bis : relance UN dé, 5 → 7, sans effet d’arrivée', t.state.pos[A] === 7 && t.state.coins[A] === 10 && cev(t).die === 2)
t = await card('half_price')
ok('carte demi-tarif', t.state.half_price[A] === true)
t = await card('gift_double')
ok('carte cadeau : +1 Triple dé', t.state.double_left[A] === 2 && cev(t).text.includes('Triple dé'))
t = await turn(T0, { dice: [2, 3], cards: [] })
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

// ----------------------------------------------------------------------------- parties complètes (simulation d'équilibrage)
// Deux familles : « hasard » (tout le monde joue au pif) et « niveaux » (le joueur 0 est le plus fort aux
// mini-jeux, le dernier le plus faible) pour mesurer l'écart entre bons et mauvais joueurs.
const rnd = (n) => Math.floor(Math.random() * n)
function randomPayload(st) {
  const k = st.state.mg.kind
  const players = st.state.players
  if (k === 'quiz') return { answers: [rnd(4), rnd(4), Math.random() < 0.1 ? null : rnd(4)], ms: [rnd(8000), rnd(8000), rnd(8000)] }
  if (k === 'pif') return { value: rnd(200) }
  if (k === 'majorite') return { target: players[rnd(players.length)] }
  if (k === 'buzzer') return Math.random() < 0.1 ? { false_start: true } : { ms: 150 + rnd(600) }
  if (k === 'etoiles') return { score: rnd(31) }
  return { ms: 5000 + rnd(4000) }
}
/** Envoi d'un joueur de niveau `lvl` (1 = très fort, 0 = très faible). */
function skilledPayload(st, lvl) {
  const k = st.state.mg.kind
  const secret = st.server.mg?.secret ?? {}
  if (k === 'quiz') {
    return {
      answers: [0, 1, 2].map((i) => (Math.random() < 0.3 + 0.6 * lvl ? secret.answers[i] : (secret.answers[i] + 1 + rnd(3)) % 4)),
      ms: [0, 1, 2].map(() => Math.min(7900, Math.round(1200 + (1 - lvl) * 4000 + rnd(2000)))),
    }
  }
  if (k === 'pif') return { value: Math.round(Number(secret.answer) * (1 + (Math.random() - 0.5) * 2 * (0.08 + 0.9 * (1 - lvl)))) }
  if (k === 'majorite') return { target: st.state.players[rnd(st.state.players.length)] }
  if (k === 'buzzer') return Math.random() < 0.08 ? { false_start: true } : { ms: Math.round(180 + (1 - lvl) * 350 + rnd(250)) }
  if (k === 'etoiles') return { score: Math.round(5 + 15 * lvl + rnd(9)) }
  return { ms: Math.round(7000 + (Math.random() - 0.5) * 2 * (150 + 1800 * (1 - lvl))) }
}
async function simulate(n, rounds, skilled = false) {
  const players = P.slice(0, n)
  const lvl = (p) => 1 - players.indexOf(p) / (n - 1)
  let st = must(await start({ ...OPTS, rounds }, players), 'sim')
  st = must(await act(late(st), players[0], tick), 'sim intro')
  let moveS = 0
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
      moveS = Math.max(moveS, ...st.state.moves.map((m) => m.steps.length))
    } else if (ph === 'mg_play') {
      if (st.state.mg.kind === 'buzzer') st = patch(st, { mg: { ...st.state.mg, data: { ...st.state.mg.data, go_at: iso(-2) } } })
      for (const p of players) {
        if (st.state.phase !== 'mg_play') break
        if (Math.random() < 0.05) continue
        st = must(await act(st, p, sub(st.state.mg.no, skilled ? skilledPayload(st, lvl(p)) : randomPayload(st))), 'sim sub')
      }
      if (st.state.phase === 'mg_play') st = must(await act(late(st), players[0], tick), 'sim mg tick')
    } else {
      st = must(await act(late(st), players[0], tick), 'sim tick ' + ph)
    }
  }
  return { st, maxSteps: moveS }
}
const t0 = Date.now()
const CONFIGS = [[4, 9, false], [6, 9, false], [8, 9, false], [2, 9, false], [3, 6, false], [4, 12, false], [4, 9, true], [6, 9, true], [8, 9, true]]
const sims = []
for (const [n, rounds, skilled] of CONFIGS) {
  for (let i = 0; i < SIMS; i++) {
    const { st, maxSteps } = await simulate(n, rounds, skilled)
    sims.push({ n, rounds, skilled, st, maxSteps })
  }
}
ok(`simulation : ${sims.length} parties complètes jusqu’à finished`, sims.every((x) => x.st.state.phase === 'finished' && x.st.results.length === x.n))
ok('simulation : coins jamais négatifs, étoiles cohérentes', sims.every((x) => Object.values(x.st.state.coins).every((v) => v >= 0) && x.st.results.every((r) => r.stats.stars >= 0)))
ok('simulation : jamais plus de 24 cases pour un pion en un tour (animation de 5 s)', sims.every((x) => x.maxSteps <= 24), String(Math.max(...sims.map((x) => x.maxSteps))))
const pct = (a, b) => `${Math.round((100 * a) / Math.max(1, b))} %`
const avg = (a) => (a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)).toFixed(2)
console.log(`\n— Simulation (${SIMS} parties par config, ${((Date.now() - t0) / 1000).toFixed(1)} s) —`)
for (const [n, rounds, skilled] of CONFIGS) {
  const g = sims.filter((x) => x.n === n && x.rounds === rounds && x.skilled === skilled)
  const win = g.map((x) => Math.max(...x.st.results.map((r) => r.stats.stars)))
  const all = g.flatMap((x) => x.st.results)
  const dist = {}
  for (const w of win) dist[w] = (dist[w] ?? 0) + 1
  const trophy = (f) => pct(all.filter(f).length, all.length)
  const of = (i) => g.map((x) => x.st.results.find((r) => r.profile_id === P[i]))
  let line = `  ${n} joueurs, ${rounds} tours${skilled ? ' (niveaux)' : ''} : étoiles du vainqueur ${JSON.stringify(dist)} · étoiles/joueur ${avg(all.map((r) => r.stats.stars))} · sans étoile ${trophy((r) => r.stats.no_star === 1)}`
  if (skilled) {
    const best = of(0), worst = of(n - 1)
    line += ` · MEILLEUR : ${avg(best.map((r) => r.stats.stars))} ★, gagne ${pct(best.filter((r) => r.won).length, best.length)}, sans étoile ${pct(best.filter((r) => r.stats.no_star === 1).length, best.length)} · PIRE : ${avg(worst.map((r) => r.stats.stars))} ★, gagne ${pct(worst.filter((r) => r.won).length, worst.length)}, sans étoile ${pct(worst.filter((r) => r.stats.no_star === 1).length, worst.length)}`
  } else {
    line += ` · pubs≥3 ${trophy((r) => r.stats.pubs >= 3)} · fauché ${trophy((r) => r.stats.broke)} · pile dessus ${trophy((r) => r.stats.star_exact)} · triplé ${trophy((r) => r.stats.mg_streak >= 3)} · 3★+ ${trophy((r) => r.stats.stars >= 3)} · carton plein ${trophy((r) => r.stats.win_mvp)} · pièces gagnées/partie ${Math.round(all.reduce((a, r) => a + r.stats.coins_earned, 0) / all.length)} · enveloppes/partie ${(all.reduce((a, r) => a + r.stats.envelopes, 0) / all.length).toFixed(1)}`
  }
  console.log(line)
}

console.log(failed ? '\nÉCHEC' : '\nTout est OK')
process.exit(failed ? 1 : 0)
