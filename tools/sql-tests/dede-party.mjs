// Tests SQL du jeu « Dédé Party » (PGlite) :
//   node dede-party.mjs ../../supabase/install.sql [parties simulées par config, Grand Plateau] [parties simulées par config et par plateau] [parties par (plateau, nombre de joueurs) en grande taille]
// Appels directs du moteur (superutilisateur) : game_dede_party_start / game_dede_party_action.
// Dés et cartes imposés via server.forced_dice / server.forced_cards / server.forced_mg ; états de mécanique par patch.
import fs from 'node:fs'
import { bootDb } from './boot.mjs'

const file = process.argv[2]
if (!file) throw new Error('usage : node dede-party.mjs <install.sql> [simulations] [simulations par plateau]')
const SIMS = Number(process.argv[3] ?? 12)
const MAP_SIMS = Number(process.argv[4] ?? 6)
const db = await bootDb(file)

let failed = false
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK   ' : 'ÉCHEC'} ${name}${cond ? '' : ' ' + extra}`)
  if (!cond) failed = true
}

/** JSON aux clés triées (jsonb réordonne les clés des objets). */
const canon = (x) => JSON.stringify(x, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v))

const P = (await db.query(`select id from public.profiles order by sort_order limit 9`)).rows.map((r) => r.id)
const OUT = '00000000-0000-0000-0000-0000000000ff'
const [A, B, C, D] = P

const QUIZ = Array.from({ length: 6 }, (_, i) => ({ prompt: `Question ${i} ?`, answer: `Bonne ${i}`, distractors: [`Faux ${i}a`, `Faux ${i}b`, `Faux ${i}c`] }))
const PIF = [{ prompt: 'Combien de marches ?', answer: 100, unit: 'marches' }, { prompt: 'Combien de km ?', answer: 42 }]
const MAJ = ['Qui de nous ronfle le plus ?', 'Qui de nous arrive toujours en retard ?']
// size: 's' : les tests historiques gardent les plateaux classiques quel que soit le nombre de joueurs (la taille
// automatique, M dès 5 joueurs, est testée plus bas avec AUTO).
const OPTS = { quiz: QUIZ, pif: PIF, majorite: MAJ, map: 'grand', size: 's' }
const AUTO = { quiz: QUIZ, pif: PIF, majorite: MAJ, map: 'grand' }

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

// ----------------------------------------------------------------------------- les 5 plateaux : synchro avec boards/<id>.ts + contrôles de tracé
const MAPS = (await db.query(`select public._dp_maps() m`)).rows[0].m
ok('5 plateaux : grand, mer, kermesse, camping, ski', canon(MAPS) === '["grand","mer","kermesse","camping","ski"]', canon(MAPS))
/** Une constante (une seule ligne) d'un fichier boards/<id>.ts. */
const tsConst = (src, name) => JSON.parse(src.match(new RegExp(`export const ${name}[^=]*= (.+)\\n`))[1].replace(/'/g, '"'))
const sqlOf = async (fn, id) => (await db.query(`select public.${fn}($1) b`, [id])).rows[0].b
const MAPDATA = {}
// Attendus de la spec (§2 à §5) : tour(s) de plateau, nombre de cases de chaque type.
const EXPECT = {
  grand: { laps: [36, 44], n: 47, count: { start: 1, clap: 20, pub: 9, env: 8, loge: 9 } },
  mer: { laps: [36, 44], n: 45, count: { start: 1, clap: 19, pub: 8, env: 8, loge: 9 } },
  kermesse: { laps: [40], n: 40, count: { start: 1, clap: 16, pub: 7, env: 6, loge: 8, tombola: 2 } },
  camping: { laps: [36], n: 36, count: { start: 1, clap: 15, pub: 7, env: 6, loge: 7 } },
  ski: { laps: [49], n: 49, count: { start: 1, clap: 17, pub: 8, env: 7, loge: 8, lift: 5, ice: 3 } },
}
for (const id of MAPS) {
  const src = fs.readFileSync(new URL(`../../src/games/dede-party/boards/${id}.ts`, import.meta.url), 'utf8')
  const ts = { cells: tsConst(src, 'CELLS'), next: tsConst(src, 'NEXT'), prev: tsConst(src, 'PREV'), xy: tsConst(src, 'XY'), extra: tsConst(src, 'EXTRA') }
  const sq = { cells: await sqlOf('_dp_board', id), next: await sqlOf('_dp_next', id), prev: await sqlOf('_dp_prev', id), extra: await sqlOf('_dp_map', id) }
  MAPDATA[id] = { ...sq, xy: ts.xy }
  const E = EXPECT[id]
  ok(`${id} : synchro SQL ↔ boards/${id}.ts (CELLS, NEXT, PREV, EXTRA)`, ['cells', 'next', 'prev', 'extra'].every((k) => canon(sq[k]) === canon(ts[k])), ['cells', 'next', 'prev', 'extra'].filter((k) => canon(sq[k]) !== canon(ts[k])).join())
  const { cells, next, prev, xy, extra } = MAPDATA[id]
  const n = cells.length
  const jumps = id === 'ski' ? [[48, 0]] : []
  const count = (t) => cells.filter((x) => x === t).length
  ok(`${id} : ${E.n} cases, tableaux de même taille`, n === E.n && next.length === n && prev.length === n && xy.length === n)
  ok(`${id} : compte de chaque type (${canon(E.count)})`, Object.entries(E.count).every(([t, c]) => count(t) === c) && cells[0] === 'start' && cells.every((t) => t in { start: 1, clap: 1, pub: 1, env: 1, loge: 1, tombola: 1, lift: 1, ice: 1 }) && cells.filter((t) => !(t in E.count)).length === 0)
  ok(`${id} : Loges ≥ 6, n° ${extra.no}`, count('loge') >= 6 && extra.no === MAPS.indexOf(id) + 1)
  const cols = 11, rows = id === 'kermesse' ? 7 : 9
  ok(`${id} : cases dans la grille ${cols} × ${rows}, aucune superposée`, xy.every(([c, r]) => c >= 0 && c < cols && r >= 0 && r < rows) && new Set(xy.map((p) => p.join())).size === n)
  const links = next.flatMap((x, i) => [x].flat().map((j) => [i, j]))
  const adj = (i, j) => Math.abs(xy[i][0] - xy[j][0]) + Math.abs(xy[i][1] - xy[j][1]) === 1
  ok(`${id} : liaisons entre cases voisines (sauf sauts ${canon(jumps)})`, links.every(([i, j]) => jumps.some(([a, b]) => a === i && b === j) || adj(i, j)))
  const linked = new Set(links.flatMap(([i, j]) => [`${i}-${j}`, `${j}-${i}`]))
  const amb = []
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (adj(i, j) && !linked.has(`${i}-${j}`)) amb.push(`${i}/${j}`)
  ok(`${id} : aucune paire de cases voisines non reliées`, amb.length === 0 || id === 'grand', amb.join(' '))
  ok(`${id} : PREV inverse de NEXT`, prev.every((p, i) => [next[p]].flat().includes(i)))
  const reach = new Set([0])
  for (let grew = true; grew; ) {
    grew = false
    for (const i of [...reach]) for (const j of [next[i]].flat()) if (!reach.has(j)) { reach.add(j); grew = true }
  }
  const forkCells = next.map((x, i) => (Array.isArray(x) ? i : -1)).filter((i) => i >= 0)
  const lapOf = (way) => { let i = 0, k = 0; do { const nx = next[i]; i = Array.isArray(nx) ? nx[way] : nx; k++ } while (i !== 0 && k < 200); return k }
  const laps = forkCells.length ? [lapOf(0), lapOf(1)] : [lapOf(0)]
  ok(`${id} : tout est atteignable, tour de ${E.laps.join(' / ')} cases`, reach.size === n && canon(laps) === canon(E.laps), canon(laps))
  ok(`${id} : un mode d'aiguillage par embranchement`, Array.isArray(extra.forks) && extra.forks.length === forkCells.length)
  for (const [a, b] of Object.entries(extra.tp ?? {})) {
    const A = xy[a], B = xy[b]
    ok(`${id} : téléporteur ${a} → ${b} à 2 cases en ligne droite, arrivée sans téléporteur`, Math.abs(A[0] - B[0]) + Math.abs(A[1] - B[1]) === 2 && (A[0] === B[0] || A[1] === B[1]) && !(b in extra.tp) && (cells[a] === 'lift') === (b > +a) && ['lift', 'ice'].includes(cells[a]))
  }
}
ok('ski : 8 téléporteurs, un par case lift / ice', Object.keys(MAPDATA.ski.extra.tp).length === 8 && MAPDATA.ski.cells.every((t, i) => !['lift', 'ice'].includes(t) || String(i) in MAPDATA.ski.extra.tp))
ok('_dp_map : fiches de mécanique', MAPDATA.mer.extra.mech === 'tide' && canon(MAPDATA.mer.extra.bank) === '[36,37,38,39,40,41,42,43,44]' && MAPDATA.mer.extra.wash_to === 14 && MAPDATA.camping.extra.riton_start === 18 && MAPDATA.kermesse.extra.mech === 'tombola' && MAPDATA.grand.extra.mech === 'forks')
ok('plateau inconnu → Grand Plateau (parties lancées avant les 5 plateaux)', canon(await sqlOf('_dp_board', 'lune')) === canon(MAPDATA.grand.cells) && canon(await sqlOf('_dp_next', null)) === canon(MAPDATA.grand.next))

// Grand Plateau : contrôles historiques.
const board = MAPDATA.grand.cells
const NEXT = MAPDATA.grand.next
const PREV = MAPDATA.grand.prev
const count = (t) => board.filter((x) => x === t).length
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
ok('state : game dede-party, phase intro (≈ 8 s, le temps de lire le plateau), tour 0/9', s0.state.game === 'dede-party' && s0.state.phase === 'intro' && s0.state.round === 0 && s0.state.rounds === 9 && approx(s0.state.deadline, 8))
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
ok('0 joueur → not_enough_players', (await start(OPTS, [])).err === 'not_enough_players')
// ----------------------------------------------------------------------------- bots
{
  const solo = must(await start(OPTS, P.slice(0, 1)), 'solo')
  ok('1 joueur seul → 1 bot ajouté d’office', JSON.stringify(solo.state.bots) === '["bot1"]' && solo.state.players.length === 2 && solo.state.coins.bot1 === 10)
  const b3 = must(await start({ ...OPTS, bots: 3 }, P.slice(0, 2)), 'b3')
  ok('option bots : 2 joueurs + 3 bots = 5 participants', b3.state.players.length === 5 && b3.state.bots.length === 3 && b3.state.size === 's')
  ok('bots plafonnés à 8 participants', must(await start({ ...OPTS, bots: 9 }, P.slice(0, 6)), 'b9').state.players.length === 8)
  // partie complète en solo + 3 bots : le joueur ne fait rien, tout avance aux échéances
  let st = must(await start({ ...OPTS, rounds: 6, bots: 3 }, P.slice(0, 1)), 'bots-game')
  let res = null
  let botsRolled = true
  let botsPlayed = true
  for (let i = 0; i < 200 && st.state.phase !== 'finished'; i++) {
    const r = must(await act(late(st), A, tick), 'tick ' + st.state.phase)
    if (r.state.phase === 'roll') botsRolled &&= r.state.bots.every((b) => r.state.rolls[b]?.dice?.length >= 2)
    if (r.state.phase === 'mg_result') botsPlayed &&= r.state.bots.every((b) => r.state.mg.results.find((x) => x.id === b)?.played)
    if (r.results) res = r.results
    st = r
  }
  ok('bots : dés lancés dès l’ouverture du lancer', botsRolled)
  ok('bots : jouent chaque mini-jeu', botsPlayed)
  ok('bots : partie terminée, classement complet affiché', st.state.phase === 'finished' && st.state.results.length === 4)
  ok('seul avec des bots : entraînement, rien ne va dans finish_match (ni XP, ni trophées)', Array.isArray(res) && res.length === 0, JSON.stringify(res))
  ok('seul avec des bots : l’état le dit (training)', st.state.training === true)
}
{
  // 2 vrais joueurs + 2 bots : les deux vrais joueurs comptent, pas les bots
  let st = must(await start({ ...OPTS, rounds: 6, bots: 2 }, P.slice(0, 2)), 'bots-duo')
  ok('2 joueurs + bots : pas d’entraînement', st.state.training === false)
  let res = null
  for (let i = 0; i < 200 && st.state.phase !== 'finished'; i++) {
    const r = must(await act(late(st), A, tick), 'tick ' + st.state.phase)
    if (r.results) res = r.results
    st = r
  }
  ok('2 joueurs + bots : les 2 vrais joueurs vont dans finish_match', res?.length === 2 && res.every((r) => [A, B].includes(r.profile_id)), JSON.stringify(res))
}
ok('9 joueurs → too_many_players', (await start(OPTS, P.slice(0, 9))).err === 'too_many_players')
ok('8 joueurs acceptés', !(await start(OPTS, P.slice(0, 8))).err)

// ----------------------------------------------------------------------------- choix du plateau
const logesOf = (id) => MAPDATA[id].cells.map((t, i) => (t === 'loge' ? i : -1)).filter((i) => i >= 0)
const SW_LEN = { grand: 2, mer: 1, kermesse: 0, camping: 0, ski: 0 }
for (const id of MAPS) {
  const g = must(await start({ ...OPTS, map: id }, P.slice(0, 7)), 'map ' + id)
  const m = g.state.mech
  const mechOk = id === 'mer' ? [0, 1].includes(m.tide) && [1, 2].includes(m.tide_in) && !(m.tide === 1 && m.tide_in === 2) && g.state.sw[0] === 1 - m.tide
    : id === 'kermesse' ? canon(m) === '{"pot":5}'
    : id === 'camping' ? canon(m) === '{"riton":18,"sack":0}'
    : canon(m) === '{}'
  ok(`option map « ${id} » : plateau, mécanique initiale, ${SW_LEN[id]} aiguillage(s), 3 étoiles sur des Loges du plateau, pas d'épilogue`, g.state.map === id && mechOk && g.state.sw.length === SW_LEN[id] && g.state.sw.every((x) => x === 0 || x === 1) && g.state.star_cells.length === 3 && g.state.star_cells.every((c) => logesOf(id).includes(c)) && g.state.epi === null, canon([g.state.map, m, g.state.sw, g.state.star_cells]))
  ok(`option map « ${id} » : stats des plateaux à 0`, ['washed', 'toll_paid', 'jackpots', 'jackpot_best', 'robbed', 'loot', 'lifts', 'slides'].every((k) => g.state.stats[A][k] === 0))
}
const drawn = new Set()
const tides = new Set()
let highOn40 = false
for (let i = 0; i < 40; i++) {
  const g = must(await start(i % 2 ? { ...OPTS, map: 'lune' } : { quiz: QUIZ }, P.slice(0, 7)), 'rand')
  drawn.add(g.state.map)
  const gm = must(await start({ ...OPTS, map: 'mer' }, P.slice(0, 8)), 'mer phase')
  tides.add(canon(gm.state.mech))
  if (gm.state.mech.tide === 1 && gm.state.star_cells.includes(40)) highOn40 = true
}
ok('map absent ou inconnu → tirage parmi les 5 plateaux', [...drawn].every((x) => MAPS.includes(x)) && drawn.size >= 3, canon([...drawn]))
ok('mer : phase de marée tirée parmi 3 (basse 2 tours, basse 1 tour, haute 1 tour)', tides.size === 3 && [...tides].every((t) => ['{"tide":0,"tide_in":2}', '{"tide":0,"tide_in":1}', '{"tide":1,"tide_in":1}'].includes(t)), canon([...tides]))
ok('mer : à marée haute, jamais d’étoile posée sur la Loge du Phare (40)', !highOn40)

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
async function turn(st, { pos = {}, coins = {}, stars = {}, star = [30], sw, dist = {}, half = {}, dice = [1, 1], extra = [], diceB = [1, 1], cards = [], mech = {}, order = [A, B] } = {}) {
  const base = patch(st, {
    order,
    pos: { ...st.state.pos, [B]: 1, ...pos },
    coins: { ...st.state.coins, ...coins },
    stars: { ...st.state.stars, ...stars },
    dist: { ...st.state.dist, ...dist },
    half_price: { [A]: false, [B]: false, ...half },
    star_cells: star,
    sw: sw ?? ((st.state.map ?? 'grand') === 'grand' ? [0, 0] : st.state.sw),
    mech: { ...st.state.mech, ...mech },
  }, { forced_dice: [...dice, ...diceB, ...extra], dice_i: 0, forced_cards: cards })
  const a = must(await act(base, order[0], roll()), 'turn A')
  return must(await act(a, order[1], roll()), 'turn B')
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
ok('Grand Plateau : pas d’épilogue, déplacements 2 + 5 s × 2', t.state.epi === null && approx(t.state.deadline, 12) && canon(t.state.mech) === '{}')

// Partie en cours lancée avant les 5 plateaux (state sans map / mech / epi) : continue sur le Grand Plateau.
{
  const legacy = { state: { ...T0.state }, server: T0.server }
  delete legacy.state.map
  delete legacy.state.mech
  delete legacy.state.epi
  t = await turn(legacy, { pos: { [A]: 12 }, sw: [1, 0], dice: [1, 1] })
  ok('partie sans « map » : Grand Plateau (aiguillage 13 → La Scène), sans épilogue', t.state.pos[A] === 36 && canon(t.state.sw) === '[0,0]' && !t.state.epi && approx(t.state.deadline, 12))
}

/** Démarre une partie à 2 joueurs (A puis B) sur un plateau, générique passé. */
const onMap = async (id) => must(await act(late(must(await start({ ...OPTS, map: id }, [A, B]), 'start ' + id)), A, tick), 'intro ' + id)
const stepsOf = (r, id = A) => r.state.moves.find((m) => m.id === id).steps

// ----------------------------------------------------------------------------- 🏖️ Dédé-sur-Mer : la Grande Marée
const MER = await onMap('mer')
// Marée basse : tout le monde coupe par le Banc de sable (12 → 36), l'aiguillage ne bascule pas.
t = await turn(MER, { pos: { [A]: 11 }, mech: { tide: 0, tide_in: 2 }, sw: [1], dice: [1, 1] })
ok('mer, marée basse : 11 → 12 → 36 (Banc de sable, +3), pas de bascule', t.state.pos[A] === 36 && t.state.coins[A] === 13 && canon(t.state.sw) === '[1]' && evOf(t).some((e) => e.t === 'fork' && e.fork === 0 && e.way === 1 && e.tide === true))
t = await turn(MER, { pos: { [A]: 11, [B]: 11 }, mech: { tide: 0, tide_in: 2 }, sw: [1], dice: [1, 1] })
ok('mer, marée basse : deux pions de suite passent tous les deux par le Banc', t.state.pos[A] === 36 && t.state.pos[B] === 36)
t = await turn(MER, { pos: { [A]: 11 }, mech: { tide: 1, tide_in: 1 }, sw: [1], dice: [1, 1] })
ok('mer, marée haute : 11 → 12 → 13 (la Digue, Pub), l’aiguillage suit la mer', t.state.pos[A] === 13 && t.state.coins[A] === 7 && evOf(t).some((e) => e.t === 'fork' && e.way === 0 && e.tide === true))
t = await turn(MER, { pos: { [A]: 43 }, mech: { tide: 0, tide_in: 2 }, sw: [1], dice: [1, 1] })
ok('mer : le Banc rejoint la Digue (43 → 44 → 14)', t.state.pos[A] === 14)
ok('mer : marée qui ne change pas → pas d’épilogue, tide_in − 1, 2 + 5 s × 2', t.state.epi === null && canon(t.state.mech) === '{"tide":0,"tide_in":1}' && approx(t.state.deadline, 12))
// La mer monte : A s'arrête sur le Banc (37), B sur la boucle.
t = await turn(MER, { pos: { [A]: 11 }, dist: { [A]: 11 }, mech: { tide: 0, tide_in: 1 }, sw: [1], dice: [1, 2] })
ok('mer : la mer monte à la fin du tour → épilogue, marée haute pour 1 tour, voie fermée', t.state.epi?.t === 'tide' && t.state.epi.tide === 1 && canon(t.state.mech) === '{"tide":1,"tide_in":1}' && canon(t.state.sw) === '[0]')
ok('mer : pion emporté → case 14, −5 pièces, dist + le chemin qui restait, stat washed', t.state.pos[A] === 14 && t.state.coins[A] === 8 && t.state.dist[A] === 11 + 3 + 8 && t.state.stats[A].washed === 1 && canon(t.state.epi.washed) === canon([{ id: A, from: 37, d: -5 }]), canon([t.state.pos[A], t.state.coins[A], t.state.dist[A], t.state.epi?.washed]))
ok('mer : le témoin (sur la boucle) reste au sec', t.state.pos[B] === 3 && t.state.stats[B].washed === 0)
ok('mer : épilogue → échéance des déplacements 2 + 5 s × 2 + 4 s, instantané after', approx(t.state.deadline, 16) && t.state.epi.after.pos[A] === 14 && t.state.epi.after.mech.tide === 1 && t.state.moves[0].after.mech.tide === 0)
t = await turn(MER, { pos: { [A]: 11 }, coins: { [A]: 1 }, mech: { tide: 0, tide_in: 1 }, sw: [1], dice: [1, 2] })
ok('mer : pion emporté pauvre → il perd ce qu’il a (4), Fauché', t.state.coins[A] === 0 && t.state.epi.washed[0].d === -4 && t.state.stats[A].broke === 1)
t = await turn(MER, { pos: { [A]: 11, [B]: 37 }, mech: { tide: 0, tide_in: 1 }, sw: [1], dice: [1, 2], order: [B, A] })
ok('mer : plusieurs pions emportés, dans l’ordre de passage', canon(t.state.epi.washed.map((w) => w.id)) === canon([B, A]) && t.state.pos[A] === 14 && t.state.pos[B] === 14)
t = await turn(MER, { pos: { [A]: 1 }, star: [40, 3], mech: { tide: 0, tide_in: 1 }, sw: [1] })
ok('mer : étoile sur la Loge du Phare quand la mer monte → elle déménage (pas sur 40)', !t.state.star_cells.includes(40) && t.state.star_cells.includes(3) && canon(t.state.epi.stars) === canon(t.state.star_cells) && t.state.epi.washed.length === 0)
t = await turn(MER, { pos: { [A]: 1 }, mech: { tide: 1, tide_in: 1 }, sw: [0] })
ok('mer : la mer redescend → épilogue, marée basse pour 2 tours, le Banc rouvre', t.state.epi?.t === 'tide' && t.state.epi.tide === 0 && canon(t.state.epi.washed) === '[]' && canon(t.state.mech) === '{"tide":0,"tide_in":2}' && canon(t.state.sw) === '[1]')
{
  // À marée haute, une étoile qui déménage ne s'installe jamais sur la Loge du Phare.
  const others = logesOf('mer').filter((c) => c !== 40)
  let never40 = true
  for (let i = 0; i < 12; i++) {
    const st = { ...MER.state, map: 'mer', mech: { tide: 1, tide_in: 1 }, star_cells: [others[0], ...others.slice(2, 8)].slice(0, 7) }
    const r = (await db.query(`select public._dp_move_star($1::jsonb, $2) s`, [canon(st), others[0]])).rows[0].s
    if (r.star_cells.includes(40)) never40 = false
  }
  ok('mer : étoile qui déménage à marée haute → jamais sur 40', never40)
}
/** Joue n tours de suite (dés 1 + 1, personne sur le Banc à la montée) et rend la suite des épilogues. */
async function tideRun(phase, n = 9) {
  let st = patch(MER, { mech: phase, sw: [1 - phase.tide] })
  const out = []
  for (let r = 0; r < n; r++) {
    st = patch(st, { phase: 'roll', rolls: { [A]: null, [B]: null }, pos: { [A]: 23, [B]: 23 } }, { forced_dice: [1, 1, 1, 1], dice_i: 0 })
    st = must(await act(must(await act(st, A, roll()), 'tide A'), B, roll()), 'tide B')
    out.push(st.state.epi ? (st.state.epi.tide === 1 ? 'H' : 'B') : '·')
  }
  return out.join('')
}
ok('mer : cycle 2 tours basse / 1 tour haute sur 9 tours, pour les 3 phases de départ (3 montées chacune)',
  (await tideRun({ tide: 0, tide_in: 2 })) === '·HB·HB·HB' && (await tideRun({ tide: 0, tide_in: 1 })) === 'HB·HB·HB·' && (await tideRun({ tide: 1, tide_in: 1 })) === 'B·HB·HB·H')

// ----------------------------------------------------------------------------- 🎪 La Kermesse : la Tombola
const KER = await onMap('kermesse')
t = await turn(KER, { pos: { [A]: 12 }, mech: { pot: 5 }, dice: [1, 1] })
ok('kermesse : passer sur la Tombola (13) coûte 3 pièces, versées dans la cagnotte', t.state.pos[A] === 14 && t.state.coins[A] === 10 && t.state.mech.pot === 8 && t.state.stats[A].toll_paid === 3 && evOf(t).some((e) => e.t === 'toll' && e.d === -3 && e.pot === 8))
t = await turn(KER, { pos: { [A]: 12 }, coins: { [A]: 2 }, mech: { pot: 5 }, dice: [1, 1] })
ok('kermesse : péage partiel (2 pièces)', t.state.coins[A] === 3 && t.state.mech.pot === 7 && evOf(t).some((e) => e.t === 'toll' && e.d === -2))
t = await turn(KER, { pos: { [A]: 12 }, coins: { [A]: 0 }, mech: { pot: 5 }, dice: [1, 1] })
ok('kermesse : sans pièce, on passe gratuitement (évènement d : 0)', t.state.coins[A] === 3 && t.state.mech.pot === 5 && evOf(t).some((e) => e.t === 'toll' && e.d === 0) && t.state.stats[A].broke === 0)
t = await turn(KER, { pos: { [A]: 13 }, mech: { pot: 5 }, dice: [1, 1] })
ok('kermesse : repartir d’une case Tombola ne coûte rien', t.state.pos[A] === 15 && t.state.coins[A] === 10 && t.state.mech.pot === 5)
t = await turn(KER, { pos: { [A]: 33 }, mech: { pot: 5 }, dice: [1, 1], cards: ['back3'] })
ok('kermesse : reculer sur la Tombola (carte) ne coûte rien', t.state.pos[A] === 32 && t.state.coins[A] === 10 && t.state.mech.pot === 5)
t = await turn(KER, { pos: { [A]: 11 }, mech: { pot: 14 }, dice: [1, 1] })
ok('kermesse : pile sur la Tombola → gros lot (14), cagnotte remise à 5', t.state.pos[A] === 13 && t.state.coins[A] === 24 && t.state.mech.pot === 5 && t.state.stats[A].jackpots === 1 && t.state.stats[A].jackpot_best === 14 && evOf(t).some((e) => e.t === 'jackpot' && e.d === 14 && e.pot === 5) && !evOf(t).some((e) => e.t === 'toll'))
ok('kermesse : gros lot = meilleur moment', canon(t.state.stats[A].best_card) === canon({ card: 'jackpot', text: 'Gros lot de la Tombola', gain: 14 }))
t = await turn(KER, { pos: { [A]: 10 }, mech: { pot: 5 }, dice: [1, 1], cards: ['fwd3'] })
ok('kermesse : carte qui franchit la Tombola → péage', t.state.pos[A] === 15 && t.state.coins[A] === 7 && t.state.mech.pot === 8)
t = await turn(KER, { pos: { [A]: 10 }, mech: { pot: 9 }, dice: [1, 1], cards: ['reroll'], extra: [1] })
ok('kermesse : carte qui s’arrête sur la Tombola → ni péage ni gros lot', t.state.pos[A] === 13 && t.state.coins[A] === 10 && t.state.mech.pot === 9)
ok('kermesse : pas d’épilogue', t.state.epi === null && approx(t.state.deadline, 12))
t = await turn(KER, { pos: { [A]: 12, [B]: 11 }, mech: { pot: 5 }, dice: [1, 1], diceB: [1, 1] })
ok('kermesse : A paie le péage (8), puis B s’arrête pile et touche 8', t.state.coins[A] === 10 && t.state.coins[B] === 18 && t.state.mech.pot === 5 && t.state.moves[0].after.mech.pot === 8)

// ----------------------------------------------------------------------------- 🏕️ Le Camping : Riton le raton
const CAMP = await onMap('camping')
const ritonOf = (r, id = A) => evOf(r, id).filter((e) => e.t === 'riton')
// B loin de Riton (26 → 28) ; Riton fait 1 case à la fin du tour (dé imposé après ceux des joueurs).
t = await turn(CAMP, { pos: { [A]: 2, [B]: 26 }, mech: { riton: 4, sack: 0 }, dice: [1, 1], extra: [1] })
ok('camping : s’arrêter sur Riton (sac vide) → il pique 5 pièces (puis Applaudissements +3)', t.state.coins[A] === 8 && ritonOf(t).length === 1 && ritonOf(t)[0].k === 'steal' && ritonOf(t)[0].d === -5 && ritonOf(t)[0].sack === 5 && t.state.stats[A].robbed === 1)
ok('camping : épilogue à chaque tour (dé de Riton, à contresens), échéance + 4 s', t.state.epi?.t === 'riton' && t.state.epi.die === 1 && t.state.epi.from === 4 && canon(t.state.epi.path) === '[3]' && canon(t.state.mech) === '{"riton":3,"sack":5}' && approx(t.state.deadline, 16))
t = await turn(CAMP, { pos: { [A]: 2, [B]: 26 }, mech: { riton: 3, sack: 5 }, dice: [1, 1], extra: [1] })
ok('camping : passer sur Riton (sac plein) → il lâche tout', t.state.coins[A] === 18 && ritonOf(t)[0].k === 'drop' && ritonOf(t)[0].d === 5 && t.state.stats[A].loot === 5 && t.state.moves[0].after.mech.sack === 0)
ok('camping : sac de Riton = meilleur moment', canon(t.state.stats[A].best_card) === canon({ card: 'riton', text: 'Le sac de Riton', gain: 5 }))
t = await turn(CAMP, { pos: { [A]: 2, [B]: 26 }, coins: { [A]: 0 }, mech: { riton: 3, sack: 0 }, dice: [1, 1], extra: [1] })
ok('camping : sans pièce, Riton repart bredouille', t.state.coins[A] === 3 && ritonOf(t)[0].k === 'none' && t.state.moves[0].after.mech.sack === 0 && t.state.stats[A].robbed === 0)
t = await turn(CAMP, { pos: { [A]: 2, [B]: 26 }, coins: { [A]: 3 }, mech: { riton: 3, sack: 0 }, dice: [1, 1], extra: [1] })
ok('camping : pion pauvre → Riton prend ce qu’il a (3)', ritonOf(t)[0].d === -3 && t.state.moves[0].after.mech.sack === 3)
// En reculant (carte) : 3 → 5 (Enveloppe), recule 4, 3 (Riton : vol), 2 ; puis la ronde de Riton (3 → 2) recroise A : il lâche le sac.
t = await turn(CAMP, { pos: { [A]: 3, [B]: 26 }, mech: { riton: 3, sack: 0 }, dice: [1, 1], cards: ['back3'], extra: [1] })
ok('camping : croiser Riton en reculant (carte) → vol', t.state.moves[0].after.coins[A] === 5 && ritonOf(t).some((e) => e.k === 'steal') && t.state.moves[0].after.pos[A] === 2)
ok('camping : pendant la ronde, Riton arrive sur A → sac lâché', canon(t.state.epi.hits) === canon([{ id: A, cell: 2, k: 'drop', d: 5, sack: 0 }]) && t.state.coins[A] === 10 && canon(t.state.mech) === '{"riton":2,"sack":0}')
ok('camping : quitter la case de Riton n’est pas un croisement (un seul vol, en reculant)', ritonOf(t).length === 1 && t.state.stats[A].robbed === 1)
// Ronde de 4 cases (20 → 19, 18, 17, 16) : A posé en 18 (vol), B en 17 (lâcher).
t = await turn(CAMP, { pos: { [A]: 16, [B]: 15 }, mech: { riton: 20, sack: 0 }, dice: [1, 1], diceB: [1, 1], extra: [4] })
ok('camping : ronde de Riton → plusieurs pions dans l’ordre des cases (vol, puis lâcher)', canon(t.state.epi.path) === '[19,18,17,16]' && canon(t.state.epi.hits.map((h) => [h.id, h.cell, h.k, h.d])) === canon([[A, 18, 'steal', -5], [B, 17, 'drop', 5]]) && t.state.coins[A] === 5 && t.state.coins[B] === 12 && t.state.mech.riton === 16 && t.state.mech.sack === 0)
t = await turn(CAMP, { pos: { [A]: 16, [B]: 16 }, mech: { riton: 20, sack: 0 }, dice: [1, 1], diceB: [1, 1], extra: [2], order: [B, A] })
ok('camping : deux pions sur la même case → dans l’ordre de passage', canon(t.state.epi.hits.map((h) => [h.id, h.k])) === canon([[B, 'steal'], [A, 'drop']]))
t = await turn(CAMP, { pos: { [A]: 18, [B]: 26 }, mech: { riton: 20, sack: 0 }, dice: [1, 1], extra: [1] })
ok('camping : A s’arrête sur Riton (vol), Riton s’en va sans le recroiser', ritonOf(t).length === 1 && t.state.epi.hits.length === 0 && t.state.epi.from === 20 && t.state.mech.riton === 19)
t = await turn(CAMP, { pos: { [A]: 11, [B]: 26 }, coins: { [A]: 32 }, star: [13], mech: { riton: 13, sack: 0 }, dice: [1, 1], extra: [1] })
ok('camping : Riton passe avant l’étoile (32 − 5 = 27 < 30 → ratée)', t.state.stars[A] === 0 && canon(stepsOf(t)[1].ev.map((e) => e.t)) === '["riton","star_poor"]')
t = await turn(CAMP, { pos: { [A]: 3, [B]: 26 }, mech: { riton: 30, sack: 0 }, dice: [1, 1], cards: ['reroll'], extra: [2, 5] })
ok('camping : dé de Riton après tous les dés du tour (lancers puis « Bis »)', cev(t).die === 2 && t.state.epi.die === 5 && canon(t.state.epi.path) === '[29,28,27,26,25]')
ok('camping : Riton croise B sur sa ronde (B arrivé en 28)', t.state.epi.hits.some((h) => h.id === B && h.cell === 28))

// ----------------------------------------------------------------------------- ⛷️ Dédé 2000 : télésièges, verglas, Grande Luge
const SKI = await onMap('ski')
for (const [from, to] of Object.entries(MAPDATA.ski.extra.tp).map(([a, b]) => [Number(a), b])) {
  const k = to > from ? 'lift' : 'ice'
  t = await turn(SKI, { pos: { [A]: from - 2 }, dist: { [A]: 100 }, dice: [1, 1], diceB: [1, 2] })
  const st = stepsOf(t)
  const last = st[st.length - 1]
  ok(`ski : ${k === 'lift' ? 'télésiège' : 'verglas'} ${from} → ${to} (pile dessus)`, t.state.pos[A] === to && t.state.dist[A] === 100 + 2 + (to - from) && t.state.coins[A] === 10 && st.length === 3 && last.cell === to && last.tp === k && canon(last.ev[0]) === canon({ t: 'tp', k, from, to }) && t.state.stats[A][k === 'lift' ? 'lifts' : 'slides'] === 1, canon(st))
}
t = await turn(SKI, { pos: { [A]: 1 }, dice: [1, 2], diceB: [1, 2] })
ok('ski : passer sur un télésiège ne fait rien', t.state.pos[A] === 4 && t.state.stats[A].lifts === 0)
t = await turn(SKI, { pos: { [A]: 12 }, dice: [1, 1], diceB: [1, 2], cards: ['reroll'], extra: [1] })
ok('ski : une carte qui s’arrête sur un télésiège ne le déclenche pas', t.state.pos[A] === 15 && t.state.stats[A].lifts === 0)
t = await turn(SKI, { pos: { [A]: 1 }, coins: { [A]: 30 }, star: [37], dice: [1, 1], diceB: [1, 2] })
ok('ski : étoile achetée à l’arrivée du télésiège (Pile dessus)', t.state.stars[A] === 1 && t.state.stats[A].star_exact === 1 && stepsOf(t)[2].ev.some((e) => e.t === 'star' && e.exact === true))
t = await turn(SKI, { pos: { [A]: 1 }, coins: { [A]: 20 }, star: [37], dice: [1, 1], diceB: [1, 2] })
ok('ski : pas assez de pièces à l’arrivée → star_poor', t.state.stars[A] === 0 && stepsOf(t)[2].ev.some((e) => e.t === 'star_poor'))
t = await turn(SKI, { pos: { [A]: 47 }, dice: [1, 1], diceB: [1, 2] })
ok('ski : Grande Luge 48 → 0, +5 au Départ', t.state.pos[A] === 0 && t.state.coins[A] === 15 && canon(stepsOf(t).map((s) => s.cell)) === '[48,0]')
{
  const w = (await db.query(`select public._dp_walk($1::jsonb, $2, 3, -1) w`, [canon({ ...SKI.state, pos: { ...SKI.state.pos, [A]: 1 } }), A])).rows[0].w
  ok('ski : carte « recule » à travers la Grande Luge (1 → 0, 48, 47), sans bonus', canon(w.steps.map((s) => s.cell)) === '[0,48,47]' && w.state.coins[A] === 10)
}
ok('ski : pas d’épilogue', t.state.epi === null && approx(t.state.deadline, 12))

// ============================================================================= GRANDES TAILLES (S / M / L)
// Spec : docs/superpowers/specs/2026-11-20-dede-party-grands-plateaux-design.md (§1, §3, §7, annexe A).
const BIG_KEYS = ['grand:m', 'mer:m', 'mer:l', 'kermesse:m', 'camping:m', 'ski:m', 'ski:l']
const EXPECT_BIG = {
  'grand:m': { n: 100, laps: [36, 92], count: { start: 1, clap: 46, pub: 17, env: 19, loge: 17 } },
  'mer:m': { n: 100, laps: [36, 94], count: { start: 1, clap: 42, pub: 16, env: 16, loge: 23, halt: 2 } },
  'mer:l': { n: 201, laps: [36, 190], count: { start: 1, clap: 87, pub: 30, env: 32, loge: 46, halt: 5 } },
  'kermesse:m': { n: 100, laps: [40, 98], count: { start: 1, clap: 47, pub: 16, env: 15, loge: 17, tombola: 4 } },
  'camping:m': { n: 100, laps: [36, 98], count: { start: 1, clap: 52, pub: 13, env: 16, loge: 18 } },
  'ski:m': { n: 105, laps: [73, 75], count: { start: 1, clap: 47, pub: 12, env: 13, loge: 16, lift: 9, ice: 5, halt: 2 } },
  'ski:l': { n: 204, laps: [73, 95], count: { start: 1, clap: 91, pub: 26, env: 23, loge: 33, lift: 17, ice: 9, halt: 4 } },
}
/** Quartiers de chaque plateau (cases), pour compter les visiteurs de la simulation. */
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i)
const QUARTERS = {
  grand: [range(47, 72), range(73, 99)],
  mer: [range(45, 72), range(73, 99), range(100, 130), range(131, 166), range(167, 200)],
  kermesse: [range(40, 70), range(71, 99)],
  camping: [range(36, 66), range(67, 99)],
  ski: [range(49, 76), range(77, 104), range(105, 154), range(155, 203)],
}
const tsConstOpt = (src, name) => {
  const m = src.match(new RegExp(`export const ${name}[^=]*= (.+)\\n`))
  return m ? JSON.parse(m[1].replace(/'/g, '"')) : null
}
const sqlOf2 = async (fn, id, size) => {
  try {
    return (await db.query(`select public.${fn}($1, $2) b`, [id, size])).rows[0].b
  } catch (e) {
    return { err: e.message }
  }
}
const BIG = {}
for (const key of BIG_KEYS) {
  const [id, size] = key.split(':')
  const S = size.toUpperCase()
  const src = fs.readFileSync(new URL(`../../src/games/dede-party/boards/${id}.ts`, import.meta.url), 'utf8')
  const ts = { cells: tsConstOpt(src, `CELLS_${S}`), next: tsConstOpt(src, `NEXT_${S}`), prev: tsConstOpt(src, `PREV_${S}`), xy: tsConstOpt(src, `XY_${S}`), jumps: tsConstOpt(src, `JUMPS_${S}`), extra: tsConstOpt(src, `EXTRA_${S}`) }
  const sq = { cells: await sqlOf2('_dp_board', id, size), next: await sqlOf2('_dp_next', id, size), prev: await sqlOf2('_dp_prev', id, size), extra: await sqlOf2('_dp_map', id, size) }
  const E = EXPECT_BIG[key]
  const synced = ['cells', 'next', 'prev', 'extra'].every((k) => ts[k] && canon(sq[k]) === canon(ts[k]))
  ok(`${key} : synchro SQL ↔ boards/${id}.ts (CELLS_${S}, NEXT_${S}, PREV_${S}, EXTRA_${S})`, synced, ['cells', 'next', 'prev', 'extra'].filter((k) => !ts[k] || canon(sq[k]) !== canon(ts[k])).join())
  if (!synced || !ts.xy || !ts.jumps || !Array.isArray(sq.cells)) {
    ok(`${key} : données disponibles pour les contrôles de tracé`, false)
    continue
  }
  const { cells, next, prev, extra } = sq
  const xy = ts.xy
  const jumps = ts.jumps
  BIG[key] = { cells, next, prev, extra, xy, jumps }
  const n = cells.length
  const count = (t) => cells.filter((x) => x === t).length
  ok(`${key} : ${E.n} cases, tableaux de même taille`, n === E.n && next.length === n && prev.length === n && xy.length === n)
  ok(`${key} : compte de chaque type (${canon(E.count)})`, Object.entries(E.count).every(([t, c]) => count(t) === c) && cells[0] === 'start' && cells.every((t) => t in E.count), canon(Object.fromEntries([...new Set(cells)].map((t) => [t, count(t)]))))
  ok(`${key} : fiche size = ${size}, n° ${extra.no}`, extra.size === size && extra.no === MAPS.indexOf(id) + 1)
  ok(`${key} : aucune case superposée`, new Set(xy.map((p) => p.join())).size === n)
  const links = next.flatMap((x, i) => [x].flat().map((j) => [i, j]))
  const adj = (i, j) => Math.abs(xy[i][0] - xy[j][0]) + Math.abs(xy[i][1] - xy[j][1]) === 1
  const isJ = (i, j) => jumps.some(([a, b]) => a === i && b === j)
  ok(`${key} : liaisons entre cases voisines, sauf les ${jumps.length} transports`, links.every(([i, j]) => isJ(i, j) || adj(i, j)), canon(links.filter(([i, j]) => !isJ(i, j) && !adj(i, j))))
  ok(`${key} : aucun transport entre cases voisines, tous les transports sont des liaisons`, jumps.every(([i, j]) => !adj(i, j) && links.some(([a, b]) => a === i && b === j)))
  const linked = new Set(links.flatMap(([i, j]) => [`${i}-${j}`, `${j}-${i}`]))
  const amb = []
  const n0 = MAPDATA[id].cells.length
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (adj(i, j) && !linked.has(`${i}-${j}`) && !(id === 'grand' && i < n0 && j < n0) && !(id === 'ski' && i === 13 && j === 14)) amb.push(`${i}/${j}`)
  ok(`${key} : deux cases voisines sont toujours reliées (exceptions de la spec)`, amb.length === 0, amb.join(' '))
  ok(`${key} : PREV inverse de NEXT`, prev.every((p, i) => [next[p]].flat().includes(i)))
  const reach = new Set([0])
  for (let grew = true; grew; ) {
    grew = false
    for (const i of [...reach]) for (const j of [next[i]].flat()) if (!reach.has(j)) { reach.add(j); grew = true }
  }
  const back = new Set([0])
  for (let grew = true; grew; ) {
    grew = false
    for (let i = 0; i < n; i++) if (!back.has(i) && [next[i]].flat().some((j) => back.has(j))) { back.add(i); grew = true }
  }
  ok(`${key} : tout est atteignable depuis le Départ, toute case ramène au Départ`, reach.size === n && back.size === n)
  const small = size === 'l' ? BIG[`${id}:m`] : { cells: MAPDATA[id].cells, xy: MAPDATA[id].xy }
  ok(`${key} : la taille du dessous est un préfixe (types et coordonnées)`, Boolean(small) && canon(cells.slice(0, small.cells.length)) === canon(small.cells) && canon(xy.slice(0, small.xy.length)) === canon(small.xy))
  const forkCells = next.map((x, i) => (Array.isArray(x) ? i : -1)).filter((i) => i >= 0)
  const lapOf = (way) => { let i = 0, k = 0; do { const nx = next[i]; i = Array.isArray(nx) ? nx[way] : nx; k++ } while (i !== 0 && k < 400); return k }
  ok(`${key} : tours voie 0 / voie 1 = ${E.laps.join(' / ')} cases`, canon([lapOf(0), lapOf(1)]) === canon(E.laps), canon([lapOf(0), lapOf(1)]))
  ok(`${key} : un mode par embranchement (toggle | tide)`, Array.isArray(extra.forks) && extra.forks.length === forkCells.length && extra.forks.every((f) => f === 'toggle' || f === 'tide'))
  const allLoges = cells.map((t, i) => (t === 'loge' ? i : -1)).filter((i) => i >= 0)
  const zoneLoges = (extra.stars ?? []).flatMap((z) => z.loges)
  ok(`${key} : zones d'étoiles = partition des Loges, au moins n + 2 Loges chacune (base : 5)`, Array.isArray(extra.stars) && extra.stars[0].n === 0 && extra.stars.every((z) => z.loges.length >= (z.n || 3) + 2 && z.loges.every((c) => cells[c] === 'loge')) && canon([...zoneLoges].sort((a, b) => a - b)) === canon(allLoges))
  for (const bk of extra.banks ?? []) {
    ok(`${key} : banc ${bk.cells[0]}-${bk.cells.at(-1)} sans Pub, rejoint ${bk.wash_to}, end ${bk.end}`, bk.cells.every((c) => cells[c] !== 'pub') && next[bk.cells.at(-1)] === bk.wash_to && bk.end === bk.cells.at(-1) + 1)
  }
  let tpOk = true
  for (const [a, b] of Object.entries(extra.tp ?? {})) {
    const P1 = xy[a], P2 = xy[b]
    if (!(Math.abs(P1[0] - P2[0]) + Math.abs(P1[1] - P2[1]) === 2 && (P1[0] === P2[0] || P1[1] === P2[1]) && cells[b] === 'clap' && ['lift', 'ice'].includes(cells[a]) && !Array.isArray(next[a]) && !Array.isArray(next[b]))) tpOk = false
  }
  if (id === 'ski') ok(`${key} : ${size === 'm' ? 14 : 26} téléporteurs (2 cases en ligne droite, arrivée Applaudissements, hors embranchement), un par case lift / ice`, tpOk && Object.keys(extra.tp).length === (size === 'm' ? 14 : 26) && cells.every((t, i) => !['lift', 'ice'].includes(t) || String(i) in extra.tp))
  if (extra.starts) ok(`${key} : haltes de départ = cases Halte`, extra.starts.every((c) => cells[c] === 'halt'))
}
ok('fiches S inchangées (pas de size, pas de stars)', MAPS.every((id) => MAPDATA[id].extra.size === undefined && MAPDATA[id].extra.stars === undefined))
ok('_dp_board(map, taille absente / inconnue / indisponible) → taille S', canon(await sqlOf2('_dp_board', 'mer', null)) === canon(MAPDATA.mer.cells) && canon(await sqlOf2('_dp_board', 'mer', 'xl')) === canon(MAPDATA.mer.cells) && canon(await sqlOf2('_dp_board', 'grand', 'l')) === canon(MAPDATA.grand.cells) && canon(await sqlOf2('_dp_next', 'lune', 'm')) === canon(BIG['grand:m']?.next))

// ----------------------------------------------------------------------------- _dp_size
const szOf = async (m, n, w = null) => {
  try {
    return (await db.query(`select public._dp_size($1, $2, $3) s`, [m, n, w])).rows[0].s
  } catch (e) {
    return 'ERR ' + e.message
  }
}
{
  const got = {}
  for (const id of MAPS) {
    let s = ''
    for (const n of [2, 3, 4, 5, 6, 7, 8]) s += await szOf(id, n)
    got[id] = s
  }
  ok('_dp_size : 2-4 → s ; 5-6 → m ; 7-8 → l sur mer et ski, m ailleurs', canon(got) === canon({ grand: 'sssmmmm', mer: 'sssmmll', kermesse: 'sssmmmm', camping: 'sssmmmm', ski: 'sssmmll' }), canon(got))
  ok('_dp_size : option de test valide (mer à 3 → l, mer à 8 → s, ski à 2 → m)', (await szOf('mer', 3, 'l')) === 'l' && (await szOf('mer', 8, 's')) === 's' && (await szOf('ski', 2, 'm')) === 'm')
  ok('_dp_size : option inconnue ou trop grande → règle automatique', (await szOf('mer', 6, 'xl')) === 'm' && (await szOf('grand', 8, 'l')) === 'm' && (await szOf('kermesse', 3, 'l')) === 's' && (await szOf('ski', 8, '')) === 'l')
}

// ----------------------------------------------------------------------------- démarrage en grande taille
const inZone = (extra, z, c) => extra.stars[z].loges.includes(c)
const wetOf = (extra, mech) => (mech?.tide === 1 ? (extra.banks ?? []).flatMap((b) => b.cells) : [])
for (const key of BIG_KEYS) {
  const [id, size] = key.split(':')
  const D = BIG[key]
  if (!D) continue
  for (const n of size === 'l' ? [7, 8] : [5, 6]) {
    const g = must(await start({ ...AUTO, map: id }, P.slice(0, n)), `start ${key} ${n}`)
    const st = g.state
    const forkCells = D.next.map((x, i) => (Array.isArray(x) ? i : -1)).filter((i) => i >= 0)
    const swOk = st.sw.length === forkCells.length && st.sw.every((x, k) => (D.extra.forks[k] === 'tide' ? x === 1 - (st.mech.tide ?? 0) : x === 0 || x === 1))
    const zoneOk = D.extra.stars.every((z, k) => st.star_cells.filter((c) => inZone(D.extra, k, c)).length === (z.n || (n >= 7 ? 3 : 2)))
    const dryOk = st.star_cells.every((c) => !wetOf(D.extra, st.mech).includes(c)) && new Set(st.star_cells).size === st.star_cells.length
    ok(`${key} à ${n} : state.size, ${forkCells.length} aiguillages (marée : 1 − tide), étoiles par zone, au sec, générique ${size === 'l' ? 12 : 10} s`, st.size === size && swOk && zoneOk && dryOk && approx(st.deadline, size === 'l' ? 12 : 10), canon([st.size, st.sw, st.mech, st.star_cells]))
    const pos = Object.values(st.pos)
    if (size === 'm') ok(`${key} à ${n} : tout le monde au Départ, 10 pièces`, pos.every((c) => c === 0) && Object.values(st.coins).every((c) => c === 10))
    else {
      const halts = [...new Set(pos)]
      const per = halts.map((h) => pos.filter((c) => c === h).length).sort()
      ok(`${key} à ${n} : départs répartis par deux sur ${Math.ceil(n / 2)} haltes de la fiche, sans bonus`, halts.length === Math.ceil(n / 2) && halts.every((h) => D.extra.starts.includes(h)) && canon(per) === canon(n === 7 ? [1, 2, 2, 2] : [2, 2, 2, 2]) && Object.values(st.coins).every((c) => c === 10) && Object.values(st.dist).every((d) => d === 0) && st.order.every((p, k) => st.pos[p] === st.pos[st.order[k % halts.length]]), canon(st.pos))
    }
    if (id === 'camping') ok(`${key} à ${n} : mech.pack (Rita en 51, Ritou en 83, sacs vides)`, canon(st.mech) === canon({ riton: 18, sack: 0, pack: [{ c: 51, sack: 0 }, { c: 83, sack: 0 }] }), canon(st.mech))
    if (id === 'kermesse') ok(`${key} à ${n} : une seule cagnotte`, canon(st.mech) === '{"pot":5}')
  }
}
{
  // Étoiles jamais sur un banc noyé au départ (mer L, marée haute).
  let wetStar = false
  let highSeen = false
  for (let i = 0; i < 16; i++) {
    const g = must(await start({ ...AUTO, map: 'mer' }, P.slice(0, 8)), 'mer L wet')
    if (g.state.mech.tide === 1) highSeen = true
    if (g.state.star_cells.some((c) => wetOf(BIG['mer:l']?.extra ?? {}, g.state.mech).includes(c))) wetStar = true
  }
  ok('mer L : à marée haute, aucune étoile posée sur un banc (4 bancs)', highSeen && !wetStar)
}
ok('2 à 4 joueurs : taille s (state.size)', must(await start(AUTO, P.slice(0, 4)), 's4').state.size === 's')

/** Partie à 2 joueurs (A puis B) sur un plateau à une taille imposée (option de test), générique passé. */
const onSize = async (id, size) => must(await act(late(must(await start({ ...AUTO, map: id, size }, [A, B]), `start ${id}:${size}`)), A, tick), `intro ${id}:${size}`)
const cellsOf = (r, id = A) => stepsOf(r, id).map((s) => s.cell)

// ----------------------------------------------------------------------------- partie lancée avant ce lot (sans size)
{
  const old = await onMap('mer')
  const st = { ...old.state }
  delete st.size
  t = await turn({ ...old, state: st }, { pos: { [A]: 3 }, sw: [1], mech: { tide: 0, tide_in: 2 }, dice: [1, 2] })
  ok('partie sans state.size : jouée en taille S (4 → 5 → 6, pas de bac)', t.state.pos[A] === 6 && t.state.size === undefined && t.state.sw.length === 1)
}

// ----------------------------------------------------------------------------- portes et transports
const MERM = await onSize('mer', 'm')
ok('option size m (2 joueurs) : mer en taille M, 4 aiguillages', MERM.state.size === 'm' && MERM.state.sw.length === 4)
t = await turn(MERM, { pos: { [A]: 3 }, sw: [1, 0, 1, 1], mech: { tide: 0, tide_in: 2 }, dice: [1, 1] })
{
  const st = stepsOf(t)
  ok('mer M : bac à quai (sw = 1) → 4 → Halte 45 (ponton), +5, le bac reste à l’île (sw = 0)', t.state.pos[A] === 45 && t.state.coins[A] === 15 && t.state.sw[0] === 0 && canon(st.map((s) => s.cell)) === '[4,45]' && canon(st[1].ev) === canon([{ t: 'fork', fork: 0, way: 1 }, { t: 'start', d: 5, halt: true }]), canon(st))
}
t = await turn(MERM, { pos: { [A]: 3 }, sw: [0, 0, 1, 1], mech: { tide: 0, tide_in: 2 }, dice: [1, 2] })
ok('mer M : bac en mer (sw = 0) → le pion reste sur la Grande Île (4 → 5 → 6), le bac revient (sw = 1)', t.state.pos[A] === 6 && t.state.sw[0] === 1 && cellsOf(t).join() === '4,5,6')
t = await turn(MERM, { pos: { [A]: 3 }, sw: [0, 1, 1, 1], mech: { tide: 0, tide_in: 2 }, dice: [1, 1], cards: ['reroll'], extra: [5] })
ok('mer M : carte « Bis » à travers une porte (5 → … 9 → bac → Halte 73, +5)', t.state.pos[A] === 73 && t.state.sw[1] === 0 && stepsOf(t).some((s) => s.card && s.cell === 73 && s.ev.some((e) => e.t === 'start' && e.halt === true)) && t.state.coins[A] === 15, canon(cellsOf(t)))
{
  const w = (await db.query(`select public._dp_walk($1::jsonb, $2, 3, -1) w`, [canon({ ...MERM.state, star_cells: [3], pos: { ...MERM.state.pos, [A]: 47 } }), A])).rows[0].w
  ok('mer M : carte « recule » depuis l’île : 46, Halte 45, embarcadère 4, sans bonus', canon(w.steps.map((s) => s.cell)) === '[46,45,4]' && w.state.coins[A] === 10 && w.steps.every((s) => s.ev.length === 0))
}
t = await turn(MERM, { pos: { [A]: 66 }, sw: [0, 0, 1, 1], mech: { tide: 0, tide_in: 2 }, dice: [1, 1] })
ok('mer M : la navette du retour (67 → 8), toujours là', cellsOf(t).join() === '67,8' && t.state.pos[A] === 8)
t = await turn(MERM, { pos: { [A]: 48 }, sw: [0, 0, 1, 1], mech: { tide: 0, tide_in: 2 }, dice: [1, 1] })
ok('mer M : marée basse → la Langue des Mouettes (49 → 68), sans bascule', cellsOf(t).join() === '49,68' && canon(t.state.sw) === '[0,0,1,1]' && evOf(t).some((e) => e.t === 'fork' && e.fork === 3 && e.way === 1 && e.tide === true))
t = await turn(MERM, { pos: { [A]: 48 }, sw: [0, 0, 0, 0], mech: { tide: 1, tide_in: 1 }, dice: [1, 1] })
ok('mer M : marée haute → 49 → 50 (l’île, pas le banc)', cellsOf(t).join() === '49,50')

const GRM = await onSize('grand', 'm')
t = await turn(GRM, { pos: { [A]: 3 }, sw: [1, 0, 0, 0], dice: [1, 1] })
ok('grand M : aiguillage en 4 → Les Coulisses (47), à pied, sans bonus', cellsOf(t).join() === '4,47' && t.state.sw[0] === 0 && !evOf(t).some((e) => e.t === 'start'))
t = await turn(GRM, { pos: { [A]: 27 }, sw: [0, 0, 0, 1], dice: [1, 1] })
ok('grand M : aiguillage en 28 → La Régie (73)', cellsOf(t).join() === '28,73' && t.state.sw[3] === 0)
t = await turn(GRM, { pos: { [A]: 71 }, sw: [0, 0, 0, 0], dice: [1, 1] })
ok('grand M : sortie des Coulisses 72 → 7', cellsOf(t).join() === '72,7')

const SKIM = await onSize('ski', 'm')
t = await turn(SKIM, { pos: { [A]: 12 }, sw: [0], dice: [1, 1] })
ok('ski M : passage obligé 13 → télécabine des Alpages → Halte 77 (+5)', cellsOf(t).join() === '13,77' && t.state.coins[A] === 15 && !evOf(t).some((e) => e.t === 'fork'))
t = await turn(SKIM, { pos: { [A]: 10 }, sw: [1], dice: [1, 1] })
ok('ski M : une cabine sur deux en 11 → Halte 49 (+5), la cabine bascule', cellsOf(t).join() === '11,49' && t.state.coins[A] === 15 && t.state.sw[0] === 0)
t = await turn(SKIM, { pos: { [A]: 10 }, sw: [0], dice: [1, 1] })
ok('ski M : cabine manquée en 11 → 12 (la voie des Alpages)', cellsOf(t).slice(0, 2).join() === '11,12' && t.state.sw[0] === 1)
t = await turn(SKIM, { pos: { [A]: 75 }, sw: [0], dice: [1, 1], cards: ['everyone3'] })
ok('ski M : la piste des Chamois ramène en 14 (76 → 14)', cellsOf(t).join() === '76,14' && t.state.pos[A] === 14)
{
  const w = (await db.query(`select public._dp_walk($1::jsonb, $2, 2, -1) w`, [canon({ ...SKIM.state, pos: { ...SKIM.state.pos, [A]: 15 } }), A])).rows[0].w
  ok('ski M : reculer depuis 15 → 14 → 76 (PREV[14] = 76, par la piste)', canon(w.steps.map((s) => s.cell)) === '[14,76]')
}
const SKIL = await onSize('ski', 'l')
ok('option size l (2 joueurs) : ski en taille L, les deux joueurs sur la même gare', SKIL.state.size === 'l' && SKIL.state.pos[A] === SKIL.state.pos[B] && [49, 77, 105, 155].includes(SKIL.state.pos[A]))
for (const [cell, k, way, to] of [[76, 1, 0, 14], [76, 1, 1, 105], [104, 2, 0, 18], [104, 2, 1, 155], [130, 3, 0, 131], [130, 3, 1, 20], [180, 4, 0, 181], [180, 4, 1, 24]]) {
  const sw = [0, 0, 0, 0, 0]
  sw[k] = way
  t = await turn(SKIL, { pos: { [A]: cell - 1 }, sw, dice: [1, 1], cards: ['everyone3'] })
  ok(`ski L : aiguillage ${cell} voie ${way} → ${to}${to === 105 || to === 155 ? ' (Halte +5)' : ''}`, cellsOf(t)[1] === to && t.state.sw[k] === 1 - way && (![105, 155].includes(to) || stepsOf(t)[1].ev.some((e) => e.t === 'start' && e.halt)), canon(cellsOf(t)))
}
t = await turn(SKIL, { pos: { [A]: 152 }, sw: [0, 0, 0, 0, 0], dice: [1, 1] })
ok('ski L : l’arête ouest arrive au Pic (153 → 154)', cellsOf(t).join() === '153,154')
t = await turn(SKIL, { pos: { [A]: 202 }, sw: [0, 0, 0, 0, 0], dice: [1, 1] })
ok('ski L : l’arête est arrive au Pic (203 → 154)', cellsOf(t).join() === '203,154')
t = await turn(SKIL, { pos: { [A]: 153 }, sw: [0, 0, 0, 0, 0], dice: [1, 1] })
ok('ski L : la Grande Descente (154 → Départ), +5', cellsOf(t).join() === '154,0' && t.state.coins[A] === 15 && stepsOf(t)[1].ev.some((e) => e.t === 'start' && e.d === 5 && !e.halt))
for (const key of ['ski:m', 'ski:l']) {
  const G0 = key === 'ski:m' ? SKIM : SKIL
  const tp = BIG[key]?.extra.tp ?? {}
  const ext = Object.entries(tp).map(([a, b]) => [Number(a), b]).filter(([a]) => a >= 49)
  let good = 0
  for (const [from, to] of ext) {
    const k = to > from ? 'lift' : 'ice'
    t = await turn(G0, { pos: { [A]: from - 2 }, dist: { [A]: 100 }, sw: G0.state.sw.map(() => 0), dice: [1, 1], diceB: [1, 2] })
    const st = stepsOf(t)
    const last = st[st.length - 1]
    if (t.state.pos[A] === to && t.state.dist[A] === 100 + 2 + (to - from) && last.tp === k && canon(last.ev[0]) === canon({ t: 'tp', k, from, to })) good++
  }
  ok(`${key} : les ${ext.length} téléporteurs de la montagne (pile dessus)`, ext.length === (key === 'ski:m' ? 6 : 18) && good === ext.length, `${good}/${ext.length}`)
}
t = await turn(SKIL, { pos: { [A]: 107 }, coins: { [A]: 30 }, star: [127, 3, 7], sw: [0, 0, 0, 0, 0], dice: [1, 1] })
ok('ski L : étoile achetée à l’arrivée d’un télésiège du Glacier (109 → 127)', t.state.stars[A] === 1 && t.state.stats[A].star_exact === 1 && !t.state.star_cells.includes(127), canon([cellsOf(t), t.state.star_cells, t.state.coins[A], t.state.stars[A]]))

// ----------------------------------------------------------------------------- étoiles par zone
{
  let stays = true
  const coul = BIG['grand:m']?.extra.stars[1].loges ?? []
  for (let i = 0; i < 8; i++) {
    t = await turn(GRM, { pos: { [A]: 47 }, coins: { [A]: 40 }, star: [49, 3, 7, 77], sw: [0, 0, 0, 0], dice: [1, 1] })
    if (t.state.stars[A] !== 1 || !coul.includes(t.state.star_cells[0]) || t.state.star_cells[0] === 49) stays = false
  }
  ok('étoile achetée dans les Coulisses → elle déménage dans une autre Loge des Coulisses', stays)
  let r = { ...GRM.state, star_cells: [3, 7, 49, 77] }
  for (const c of [3, 7, 49, 77]) r = (await db.query(`select public._dp_move_star($1::jsonb, $2) s`, [canon(r), c])).rows[0].s
  const Z = BIG['grand:m']?.extra.stars ?? [{ loges: [] }, { loges: [] }, { loges: [] }]
  ok('« Changement de décor » : chaque étoile déménage dans sa zone', Z[0].loges.includes(r.star_cells[0]) && Z[0].loges.includes(r.star_cells[1]) && Z[1].loges.includes(r.star_cells[2]) && Z[2].loges.includes(r.star_cells[3]) && new Set(r.star_cells).size === 4, canon(r.star_cells))
  const mz = BIG['mer:m']?.extra.stars[1].loges ?? []
  const full = { ...MERM.state, mech: { tide: 1, tide_in: 1 }, star_cells: mz.filter((c) => c !== 70) }
  r = (await db.query(`select public._dp_move_star($1::jsonb, 46) s`, [canon(full)])).rows[0].s
  ok('zone dont toutes les autres Loges sont noyées (70 sous l’eau) : l’étoile reste où elle est', mz.length === 7 && canon(r.star_cells) === canon(full.star_cells))
}

// ----------------------------------------------------------------------------- la marée sur plusieurs bancs
t = await turn(MERM, { pos: { [A]: 36, [B]: 68 }, sw: [0, 0, 1, 1], star: [3, 7, 46, 74], mech: { tide: 0, tide_in: 1 }, dice: [1, 2], diceB: [1, 1] })
ok('mer M : la mer monte → les embranchements de marée se ferment (sw[2] = sw[3] = 0), les bacs ne bougent pas', canon(t.state.sw) === '[0,0,0,0]' && t.state.mech.tide === 1)
ok('mer M : deux bancs rincés le même tour, chacun vers son retour (14 et 51), dist, ordre de passage', canon(t.state.epi?.washed) === canon([{ id: A, from: 39, d: -5, to: 14 }, { id: B, from: 70, d: -5, to: 51 }]) && t.state.pos[A] === 14 && t.state.pos[B] === 51 && t.state.dist[A] === 3 + 6 && t.state.dist[B] === 2 + 3, canon([t.state.epi?.washed, t.state.dist]))
t = await turn(MERM, { pos: { [A]: 1 }, sw: [0, 0, 1, 1], star: [3, 7, 70, 74], mech: { tide: 0, tide_in: 1 } })
ok('mer M : étoile sur la Loge des Mouettes (70) quand la mer monte → elle déménage dans l’île aux Mouettes', !t.state.star_cells.includes(70) && Boolean(BIG['mer:m']?.extra.stars[1].loges.includes(t.state.star_cells[2])) && canon(t.state.epi?.stars) === canon(t.state.star_cells))
t = await turn(MERM, { pos: { [A]: 1 }, sw: [1, 0, 0, 0], mech: { tide: 1, tide_in: 1 } })
ok('mer M : la mer redescend → tous les bancs rouvrent (sw[2] = sw[3] = 1), le bac garde sa position', canon(t.state.sw) === '[1,0,1,1]' && t.state.epi?.tide === 0)
const MERL = await onSize('mer', 'l')
t = await turn(MERL, { pos: { [A]: 160, [B]: 194 }, sw: MERL.state.sw.map((x, k) => ((BIG['mer:l']?.extra.forks ?? [])[k] === 'tide' ? 1 : 0)), star: [3, 7, 46, 74, 101, 132, 168], mech: { tide: 0, tide_in: 1 }, dice: [1, 2], diceB: [1, 1] })
ok('mer L : Gué du Trésor → 145, Gué des Crabes → 180, embranchements de marée fermés', canon(t.state.epi?.washed?.map((w) => [w.id, w.from, w.to])) === canon([[A, 163, 145], [B, 196, 180]]) && t.state.pos[A] === 145 && t.state.pos[B] === 180 && t.state.sw.every((x, k) => (BIG['mer:l']?.extra.forks ?? [])[k] !== 'tide' || x === 0), canon(t.state.epi?.washed))

// ----------------------------------------------------------------------------- la Tombola à 4 guichets
const KERM = await onSize('kermesse', 'm')
ok('kermesse M : 4 guichets (13, 33, 55, 85)', canon(BIG['kermesse:m']?.cells.map((c, i) => (c === 'tombola' ? i : -1)).filter((i) => i >= 0)) === '[13,33,55,85]')
t = await turn(KERM, { pos: { [A]: 54, [B]: 84 }, sw: [0, 0], mech: { pot: 5 }, dice: [1, 1], diceB: [1, 1] })
ok('kermesse M : péage aux guichets du Train Fantôme (55) et du Grand Huit (85), une seule cagnotte', t.state.mech.pot === 11 && evOf(t).some((e) => e.t === 'toll' && e.pot === 8) && evOf(t, B).some((e) => e.t === 'toll' && e.pot === 11))
t = await turn(KERM, { pos: { [A]: 83 }, sw: [0, 0], mech: { pot: 20 }, dice: [1, 1] })
ok('kermesse M : gros lot sur le guichet du Grand Huit (85) : toute la cagnotte', t.state.pos[A] === 85 && evOf(t).some((e) => e.t === 'jackpot' && e.d === 20) && t.state.mech.pot === 5)

// ----------------------------------------------------------------------------- la famille Raton
const CAMPM = await onSize('camping', 'm')
const pack0 = (rita, ritou, sacks = [0, 0, 0]) => ({ riton: 26, sack: sacks[0], pack: [{ c: rita, sack: sacks[1] }, { c: ritou, sack: sacks[2] }] })
t = await turn(CAMPM, { pos: { [A]: 49, [B]: 28 }, sw: [0, 0], mech: pack0(51, 90), dice: [1, 1], extra: [1, 1, 1] })
{
  const ev = ritonOf(t)
  ok('camping M : croiser Rita (51) → elle pique 5 pièces (évènement who = 1), dans son sac à elle', ev.length === 1 && ev[0].who === 1 && ev[0].k === 'steal' && t.state.moves[0].after.mech.pack?.[0].sack === 5 && t.state.moves[0].after.mech.sack === 0 && t.state.moves[0].after.mech.pack?.[1].sack === 0, canon(ev))
}
t = await turn(CAMPM, { pos: { [A]: 49, [B]: 80 }, sw: [0, 0], mech: pack0(52, 83, [0, 5, 0]), dice: [1, 1], diceB: [1, 1], extra: [6, 1, 1] })
ok('camping M : ronde du soir → Rita lâche son sac sur A (sous-bois), Ritou vole B (rivière), Riton ne quitte pas le camp', canon(t.state.epi?.pack?.map((p) => [p.who, p.die, p.from, p.path, p.hits.map((h) => [h.id, h.k])])) === canon([[1, 1, 52, [51], [[A, 'drop']]], [2, 1, 83, [82], [[B, 'steal']]]]) && t.state.epi.path.every((c) => c < 36) && canon(t.state.mech.pack) === canon([{ c: 51, sack: 0 }, { c: 82, sack: 5 }]), canon([t.state.epi?.pack, t.state.mech]))
t = await turn(CAMPM, { pos: { [A]: 20, [B]: 28 }, sw: [0, 0], mech: pack0(36, 67), dice: [1, 1], extra: [1, 2, 3] })
ok('camping M : rondes cycliques (Rita 36 → 66 → 65, Ritou 67 → 99 → 98 → 97)', t.state.epi?.die === 1 && canon(t.state.epi?.pack?.map((p) => [p.die, p.path])) === canon([[2, [66, 65]], [3, [99, 98, 97]]]))
t = await turn(CAMPM, { pos: { [A]: 3, [B]: 28 }, sw: [0, 0], mech: pack0(60, 90), dice: [1, 1], cards: ['reroll'], extra: [2, 4, 5, 6] })
ok('camping M : ordre des dés (lancers, carte « Bis », Riton, Rita, Ritou)', cev(t)?.die === 2 && t.state.epi?.die === 4 && canon(t.state.epi?.pack?.map((p) => p.die)) === '[5,6]')
ok('camping M : épilogue toujours de 4 s', approx(t.state.deadline, 16))

// ----------------------------------------------------------------------------- size_no dans les stats de fin
{
  const W2 = patch(MERM, { phase: 'awards', round: 9, rounds: 9, deadline: iso(-1), awards: [], ranking: [{ id: A, stars: 1, coins: 0, rank: 1 }, { id: B, stars: 0, coins: 0, rank: 2 }] })
  const f2 = must(await act(W2, A, tick), 'finish M')
  ok('stats de fin : size_no (2 = grand format) à côté de map_no', Array.isArray(f2.results) && f2.results.every((r) => r.stats.size_no === 2 && r.stats.map_no === 2), canon(f2.results?.map((r) => r.stats)))
}

// ----------------------------------------------------------------------------- enchaînement des phases
let G = auto
ok('tick pendant les déplacements (avant échéance) : sans effet', must(await act(G, A, tick), 'gm').state.phase === 'move')
G = must(await act(late(patch(G, {}, { forced_mg: ['quiz'] })), A, tick), 'mgi')
ok('fin des déplacements → annonce du mini-jeu (10 s), mini-jeu n°1', G.state.phase === 'mg_intro' && G.state.mg.no === 1 && G.state.mg.kind === 'quiz' && approx(G.state.deadline, 10) && G.state.mg.finale === false)
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
// Constellation : seuil selon la durée et le nombre de joueurs (2-4 j : 3/4/5 ★ en 6/9/12 tours ; 5-8 j : 3/3/4 ★).
const cst = async (n, rounds, stars) => {
  const ids = Array.from({ length: n }, (_, i) => `p${i}`)
  const st = { rounds, round: rounds, stars: Object.fromEntries(ids.map((id, i) => [id, i === 0 ? stars : 0])) }
  return (await db.query(`select public._dp_tstats($1::jsonb, 'p0', false)->>'constellation' c`, [JSON.stringify(st)])).rows[0].c
}
ok('Constellation 4 j : 3★/6 t oui, 2★/6 t non', (await cst(4, 6, 3)) === '1' && (await cst(4, 6, 2)) === '0')
ok('Constellation 4 j : 4★/9 t oui, 3★/9 t non', (await cst(4, 9, 4)) === '1' && (await cst(4, 9, 3)) === '0')
ok('Constellation 2 j : 5★/12 t oui, 4★/12 t non', (await cst(2, 12, 5)) === '1' && (await cst(2, 12, 4)) === '0')
ok('Constellation 6 j : 3★/9 t oui, 2★/9 t non', (await cst(6, 9, 3)) === '1' && (await cst(6, 9, 2)) === '0')
ok('Constellation 8 j : 4★/12 t oui, 3★/12 t non ; 3★/6 t oui', (await cst(8, 12, 4)) === '1' && (await cst(8, 12, 3)) === '0' && (await cst(8, 6, 3)) === '1')
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
ok('stats de fin : compteurs des plateaux et map_no (1 = Grand Plateau)', fr(C).stats.map_no === 1 && ['washed', 'toll_paid', 'jackpots', 'jackpot_best', 'robbed', 'loot', 'lifts', 'slides'].every((k) => fr(C).stats[k] === 0))

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
/** Partie complète ; size : 's' (défaut, les plateaux classiques) ou null (taille automatique selon le nombre de joueurs). */
async function simulate(n, rounds, skilled = false, map = 'grand', size = 's') {
  const players = P.slice(0, n)
  const lvl = (p) => 1 - players.indexOf(p) / (n - 1)
  let st = must(await start({ ...AUTO, rounds, map, ...(size ? { size } : {}) }, players), 'sim')
  // Quartiers visités (grandes tailles) : par quartier, l'ensemble des joueurs qui y sont passés.
  const nCells = BIG[`${map}:${st.state.size}`]?.cells.length ?? 0
  const quarters = st.state.size && st.state.size !== 's' ? QUARTERS[map].filter((q) => q[q.length - 1] < nCells) : []
  const visits = quarters.map(() => new Set())
  const seen = (p, c) => quarters.forEach((q, k) => q.includes(c) && visits[k].add(p))
  for (const p of players) seen(p, st.state.pos[p])
  st = must(await act(late(st), players[0], tick), 'sim intro')
  let moveS = 0
  // Évènements signature du plateau, comptés dans les scénarios publiés.
  const ev = { rises: 0, washed: 0, tolls: 0, jackpots: 0, jackpotSum: 0, jackpotMax: 0, steals: 0, drops: 0, nones: 0, lifts: 0, slides: 0, luges: 0, starts: 0, halts: 0, descents: 0 }
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
      for (const m of st.state.moves) for (const s of m.steps) seen(m.id, s.cell)
      const all = st.state.moves.flatMap((m) => m.steps.flatMap((s) => s.ev))
      for (const e of all) {
        if (e.t === 'toll') ev.tolls++
        if (e.t === 'jackpot') { ev.jackpots++; ev.jackpotSum += e.d; ev.jackpotMax = Math.max(ev.jackpotMax, e.d) }
        if (e.t === 'riton') ev[e.k === 'steal' ? 'steals' : e.k === 'drop' ? 'drops' : 'nones']++
        if (e.t === 'tp') ev[e.k === 'lift' ? 'lifts' : 'slides']++
        if (e.t === 'start' && !e.halt) ev.starts++
        if (e.t === 'start' && e.halt) ev.halts++
      }
      const epi = st.state.epi
      if (epi?.t === 'tide' && epi.tide === 1) { ev.rises++; ev.washed += epi.washed.length }
      if (epi?.t === 'riton') for (const h of epi.hits) ev[h.k === 'steal' ? 'steals' : h.k === 'drop' ? 'drops' : 'nones']++
      if (st.state.moves.some((m) => m.steps.some((s, k) => s.cell === 0 && (k === 0 ? m.from : m.steps[k - 1].cell) === 48 && map === 'ski'))) ev.luges++
      for (const m of st.state.moves) for (const [k, s] of m.steps.entries()) if (map === 'ski' && s.cell === 0 && (k === 0 ? m.from : m.steps[k - 1].cell) === 154) ev.descents++
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
  return { st, maxSteps: moveS, ev, visits: visits.map((v) => v.size), quarterCount: players.map((p) => visits.filter((v) => v.has(p)).length) }
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

// ----------------------------------------------------------------------------- simulation des 5 plateaux (2, 4 et 8 joueurs, 9 tours)
// Comparée aux chiffres du modèle JS de la spec (§2 à §6) : écart > 15 % signalé (pas un échec : le modèle
// JS tire les mini-jeux au sort sans absents, la simulation SQL joue des envois au hasard avec des absents).
const SPEC = {
  // étoiles par joueur (bonus de cérémonie compris), à 2 / 4 / 8 joueurs
  stars: { grand: [2.61, 2.37, 1.97], mer: [2.62, 2.32, 1.89], kermesse: [2.58, 2.31, 1.89], camping: [2.76, 2.47, 2.04], ski: [2.32, 2.22, 1.89] },
  // évènements signature par partie, à 2 / 4 / 8 joueurs (null : pas de chiffre dans la spec)
  ev: {
    mer: { rises: [3, 3, 3], washed: [0.77 * 2, 3.1, 0.77 * 8] },
    kermesse: { jackpots: [0.9, 1.7, 3.5], tolls: [null, 11, null] },
    camping: { steals: [3, 5.9, 11.5] },
    ski: { lifts: [2.2, 4.5, 8.9], slides: [0.9, 1.8, 3.5] },
  },
}
const t1 = Date.now()
const mapSims = []
for (const map of MAPS) {
  for (const n of [2, 4, 8]) {
    for (let i = 0; i < MAP_SIMS; i++) {
      const r = await simulate(n, 9, false, map)
      mapSims.push({ map, n, ...r })
    }
  }
}
ok(`simulation des 5 plateaux : ${mapSims.length} parties complètes (2, 4, 8 joueurs) jusqu’à finished`, mapSims.every((x) => x.st.state.phase === 'finished' && x.st.results.length === x.n))
ok('simulation des 5 plateaux : jamais plus de 24 pas pour un pion en un tour', mapSims.every((x) => x.maxSteps <= 24), String(Math.max(...mapSims.map((x) => x.maxSteps))))
ok('simulation des 5 plateaux : pièces jamais négatives, map_no dans les stats de fin', mapSims.every((x) => Object.values(x.st.state.coins).every((v) => v >= 0) && x.st.results.every((r) => r.stats.map_no === MAPS.indexOf(x.map) + 1)))
ok('simulation des 5 plateaux : les mécaniques se déclenchent (marée, gros lot, Riton, télésiège)', !mapSims.length || ['mer:rises', 'kermesse:tolls', 'camping:steals', 'ski:lifts'].every((k) => { const [m, e] = k.split(':'); return mapSims.filter((x) => x.map === m).some((x) => x.ev[e] > 0) }))
const ecarts = []
const vs = (label, got, ref) => {
  if (ref == null || !mapSims.length) return `${label} ${got.toFixed(2)}`
  const d = (got - ref) / ref
  if (Math.abs(d) > 0.15) ecarts.push(`${label} : ${got.toFixed(2)} contre ${ref} dans la spec (${d > 0 ? '+' : ''}${Math.round(d * 100)} %)`)
  return `${label} ${got.toFixed(2)} (spec ${ref})`
}
console.log(`\n— Simulation des 5 plateaux (${MAP_SIMS} parties par config, 9 tours, ${((Date.now() - t1) / 1000).toFixed(1)} s) —`)
for (const map of MAPS) {
  for (const [k, n] of [2, 4, 8].entries()) {
    const g = mapSims.filter((x) => x.map === map && x.n === n)
    if (!g.length) continue
    const all = g.flatMap((x) => x.st.results)
    const per = (f) => g.reduce((a, x) => a + f(x), 0) / g.length
    let line = `  ${map.padEnd(8)} ${n} joueurs : ${vs('étoiles/joueur', all.reduce((a, r) => a + r.stats.stars, 0) / all.length, SPEC.stars[map][k])} · vainqueur ${avg(g.map((x) => Math.max(...x.st.results.map((r) => r.stats.stars))))} ★ · sans étoile ${pct(all.filter((r) => r.stats.no_star).length, all.length)} · fauché ${pct(all.filter((r) => r.stats.broke).length, all.length)} · pubs≥3 ${pct(all.filter((r) => r.stats.pubs >= 3).length, all.length)} · Départ/joueur ${(per((x) => x.ev.starts) / n).toFixed(2)} · pas max ${Math.max(...g.map((x) => x.maxSteps))}`
    const E = SPEC.ev[map] ?? {}
    if (map === 'mer') line += `\n             marée : ${vs('montées', per((x) => x.ev.rises), E.rises[k])} · ${vs('pions emportés', per((x) => x.ev.washed), E.washed[k])}`
    if (map === 'kermesse') line += `\n             tombola : ${vs('péages', per((x) => x.ev.tolls), E.tolls[k])} · ${vs('gros lots', per((x) => x.ev.jackpots), E.jackpots[k])} · gros lot moyen ${(g.reduce((a, x) => a + x.ev.jackpotSum, 0) / Math.max(1, g.reduce((a, x) => a + x.ev.jackpots, 0))).toFixed(1)} · record ${Math.max(...g.map((x) => x.ev.jackpotMax))}`
    if (map === 'camping') line += `\n             Riton : ${vs('vols', per((x) => x.ev.steals), E.steals[k])} · sacs lâchés ${per((x) => x.ev.drops).toFixed(2)} · bredouilles ${per((x) => x.ev.nones).toFixed(2)}`
    if (map === 'ski') line += `\n             ski : ${vs('télésièges', per((x) => x.ev.lifts), E.lifts[k])} · ${vs('glissades', per((x) => x.ev.slides), E.slides[k])} · Grandes Luges ${per((x) => x.ev.luges).toFixed(2)}`
    console.log(line)
  }
}
if (ecarts.length) console.log(`\n⚠ Écarts > 15 % avec la spec (${MAP_SIMS} parties par config : à relire avec plus de parties) :\n  - ${ecarts.join('\n  - ')}`)
else console.log('\nAucun écart > 15 % avec les chiffres de la spec.')

// ----------------------------------------------------------------------------- simulation des grandes tailles (5 à 8 joueurs, 9 tours, taille automatique)
// Comparée aux chiffres du modèle JS de la spec grands plateaux (§2.2) : écart > 15 % signalé.
const SIZE_SIMS = Number(process.argv[5] ?? 2)
const SPEC_BIG = {
  // étoiles par joueur à 5 / 6 / 7 / 8 joueurs
  stars: { grand: [2.17, 2.02, 2.04, 1.94], mer: [2.26, 2.08, 1.98, 1.89], kermesse: [2.07, 1.92, 1.94, 1.85], camping: [2.10, 1.95, 1.95, 1.85], ski: [2.15, 1.99, 2.01, 1.91] },
}
const t2 = Date.now()
const sizeSims = []
for (const map of MAPS) {
  for (const n of [5, 6, 7, 8]) {
    for (let i = 0; i < SIZE_SIMS; i++) {
      const r = await simulate(n, 9, false, map, null)
      sizeSims.push({ map, n, size: r.st.state.size, ...r })
    }
  }
}
const SIZE_NO = { s: 1, m: 2, l: 3 }
ok(`simulation des grandes tailles : ${sizeSims.length} parties complètes (5 à 8 joueurs) jusqu’à finished`, sizeSims.every((x) => x.st.state.phase === 'finished' && x.st.results.length === x.n))
ok('simulation des grandes tailles : taille automatique (m à 5-6 ; l à 7-8 sur mer et ski), size_no dans les stats de fin', sizeSims.every((x) => x.size === (x.n >= 7 && ['mer', 'ski'].includes(x.map) ? 'l' : 'm') && x.st.results.every((r) => r.stats.size_no === SIZE_NO[x.size])))
ok('simulation des grandes tailles : jamais plus de 24 pas pour un pion en un tour', sizeSims.every((x) => x.maxSteps <= 24), String(Math.max(...sizeSims.map((x) => x.maxSteps))))
ok('simulation des grandes tailles : pièces jamais négatives', sizeSims.every((x) => Object.values(x.st.state.coins).every((v) => v >= 0)))
const ecartsBig = []
console.log(`\n— Simulation des grandes tailles (${SIZE_SIMS} parties par config, 9 tours, ${((Date.now() - t2) / 1000).toFixed(1)} s) —`)
for (const map of MAPS) {
  for (const [k, n] of [5, 6, 7, 8].entries()) {
    const g = sizeSims.filter((x) => x.map === map && x.n === n)
    if (!g.length) continue
    const all = g.flatMap((x) => x.st.results)
    const per = (f) => g.reduce((a, x) => a + f(x), 0) / g.length
    const stars = all.reduce((a, r) => a + r.stats.stars, 0) / all.length
    const ref = SPEC_BIG.stars[map][k]
    const d = (stars - ref) / ref
    if (Math.abs(d) > 0.15) ecartsBig.push(`${map} ${g[0].size.toUpperCase()} à ${n} : étoiles/joueur ${stars.toFixed(2)} contre ${ref} (${d > 0 ? '+' : ''}${Math.round(d * 100)} %)`)
    const noStar = all.filter((r) => r.stats.no_star).length / all.length
    if (noStar >= 0.1) ecartsBig.push(`${map} ${g[0].size.toUpperCase()} à ${n} : ${Math.round(noStar * 100)} % de joueurs sans étoile (objectif < 10 %)`)
    const vis = g[0].visits.map((_, q) => per((x) => x.visits[q]))
    if (vis.some((v) => v < 2)) ecartsBig.push(`${map} ${g[0].size.toUpperCase()} à ${n} : un quartier à moins de 2 visiteurs par partie (${vis.map((v) => v.toFixed(1)).join(' · ')})`)
    const noQ = all.length ? g.reduce((a, x) => a + x.quarterCount.filter((c) => c === 0).length, 0) / all.length : 0
    let line = `  ${map.padEnd(8)} ${g[0].size.toUpperCase()} ${n} joueurs : étoiles/joueur ${stars.toFixed(2)} (spec ${ref}) · vainqueur ${avg(g.map((x) => Math.max(...x.st.results.map((r) => r.stats.stars))))} ★ · sans étoile ${pct(all.filter((r) => r.stats.no_star).length, all.length)} · fauché ${pct(all.filter((r) => r.stats.broke).length, all.length)} · Départ/joueur ${(per((x) => x.ev.starts) / n).toFixed(2)} + haltes ${(per((x) => x.ev.halts) / n).toFixed(2)} · pas max ${Math.max(...g.map((x) => x.maxSteps))}`
    line += `\n             quartiers : ${(g.reduce((a, x) => a + x.quarterCount.reduce((s, c) => s + c, 0), 0) / all.length).toFixed(2)} par joueur, aucun ${Math.round(noQ * 100)} % · visiteurs ${vis.map((v) => v.toFixed(1)).join(' · ')}`
    if (map === 'mer') line += ` · marée : ${per((x) => x.ev.rises).toFixed(1)} montées, ${per((x) => x.ev.washed).toFixed(1)} pions emportés`
    if (map === 'kermesse') line += ` · tombola : ${(per((x) => x.ev.tolls) / n).toFixed(2)} péages/joueur, ${per((x) => x.ev.jackpots).toFixed(1)} gros lots`
    if (map === 'camping') line += ` · ratons : ${((per((x) => x.ev.steals + x.ev.drops + x.ev.nones)) / n).toFixed(2)} croisements/joueur`
    if (map === 'ski') line += ` · ski : ${(per((x) => x.ev.lifts) / n).toFixed(2)} télésièges et ${(per((x) => x.ev.slides) / n).toFixed(2)} glissades/joueur, Grande Descente ${per((x) => x.ev.descents).toFixed(1)}/partie`
    console.log(line)
  }
}
if (ecartsBig.length) console.log(`\n⚠ Grandes tailles, à surveiller (${SIZE_SIMS} parties par config) :\n  - ${ecartsBig.join('\n  - ')}`)
else console.log('\nGrandes tailles : aucun écart > 15 % avec la spec.')

console.log(failed ? '\nÉCHEC' : '\nTout est OK')
process.exit(failed ? 1 : 0)
