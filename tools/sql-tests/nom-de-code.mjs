// Tests SQL du jeu « Nom de Code » (PGlite) : node nom-de-code.mjs ../../supabase/install.sql
// Appels directs du moteur (superutilisateur) : game_nom_de_code_start / game_nom_de_code_action.
import { bootDb } from './boot.mjs'

const file = process.argv[2]
if (!file) throw new Error('usage : node nom-de-code.mjs <install.sql>')
const db = await bootDb(file)

let failed = false
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK   ' : 'ÉCHEC'} ${name}${cond ? '' : ' ' + extra}`)
  if (!cond) failed = true
}

const P = (await db.query(`select id from public.profiles order by sort_order limit 9`)).rows.map((r) => r.id)
const WORDS = Array.from({ length: 125 }, (_, i) => `mot${i}`)

/** Démarre une partie ; renvoie {r} ({state, server, secrets}) ou {err}. */
const start = async (teams, extra = {}, players = P) => {
  const opts = { teams, rounds: 'one', timer: 'normal', words: WORDS, ...extra }
  try {
    return { r: (await db.query(`select public.game_nom_de_code_start($1::uuid[], $2::jsonb) r`, [`{${players.join(',')}}`, JSON.stringify(opts)])).rows[0].r }
  } catch (e) {
    return { err: e.message }
  }
}
const count = (key, c) => key.filter((x) => x === c).length
const totals = (s) => s.state.teams.map((t) => t.total)
const sorted = (a) => [...a].sort((x, y) => x - y)
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x))
const approxSeconds = (iso, sec) => {
  const d = (new Date(iso).getTime() - Date.now()) / 1000
  return d > sec - 5 && d <= sec + 1
}

// ----------------------------------------------------------------------------- démarrage
const T2 = { red: P.slice(0, 5), blue: P.slice(5, 9) }
const s2 = (await start(T2)).r
const k2 = s2.server.key
const otherTeam = (s) => s.state.teams.find((t) => t.id !== s.state.turn).id
ok('2 équipes : 9/8 + 7 neutres + 1 bombe',
  [count(k2, s2.state.turn), count(k2, otherTeam(s2))].join() === '9,8' && count(k2, 'neutral') === 7 && count(k2, 'bomb') === 1,
  JSON.stringify(k2))
ok('équipe qui commence = 9 mots', s2.state.teams.find((t) => t.id === s2.state.turn).total === 9)
ok('ordre des équipes fixe (red puis blue)', s2.state.teams.map((t) => t.id).join() === 'red,blue')
const s3 = (await start({ red: P.slice(0, 3), blue: P.slice(3, 6), green: P.slice(6, 9) })).r
ok('3 équipes : 7/6/6 + 5 + 1', sorted(totals(s3)).join() === '6,6,7' && count(s3.server.key, 'neutral') === 5 && count(s3.server.key, 'bomb') === 1)
const s4 = (await start({ red: P.slice(0, 2), blue: P.slice(2, 4), green: P.slice(4, 6), yellow: P.slice(6, 8) })).r
ok('4 équipes : 6/5/5/5 + 3 + 1', sorted(totals(s4)).join() === '5,5,5,6' && count(s4.server.key, 'neutral') === 3 && count(s4.server.key, 'bomb') === 1)
ok('4 équipes : le 9e joueur est sur le banc', s4.state.bench.length === 1 && s4.state.bench[0] === P[8] && !s4.state.players.includes(P[8]))
ok('phase clue, aucune carte dévoilée, key absente du state',
  s2.state.phase === 'clue' && Object.keys(s2.state.revealed).length === 0 && s2.state.key === null && s2.state.round === 1)
ok('state.game = nom-de-code', s2.state.game === 'nom-de-code')
ok('25 mots dans la grille', s2.state.words.length === 25 && s2.state.words[0] === 'mot0')
ok('chaque équipe a un espion parmi ses membres', s2.state.teams.every((t) => t.players.includes(t.spy)))
ok('secrets = exactement les espions', sameSet(Object.keys(s2.secrets), s2.state.teams.map((t) => t.spy)), JSON.stringify(Object.keys(s2.secrets)))
const sec = s2.secrets[s2.state.teams[0].spy]
ok('secret d’espion = {round: 1, key de 25}', sec.round === 1 && sec.key.length === 25 && JSON.stringify(sec.key) === JSON.stringify(k2))
ok('banc : absent des secrets', !(P[8] in s4.secrets))
ok('rounds each : total_rounds = taille de la plus grande équipe', (await start(T2, { rounds: 'each' })).r.state.total_rounds === 5)
ok('rounds one : total_rounds = 1', s2.state.total_rounds === 1)
ok('timer normal : deadline ≈ maintenant + 120 s', approxSeconds(s2.state.deadline, 120), s2.state.deadline)
ok('timer fast : deadline ≈ maintenant + 60 s', approxSeconds((await start(T2, { timer: 'fast' })).r.state.deadline, 60))
ok('timer relaxed : deadline null', (await start(T2, { timer: 'relaxed' })).r.state.deadline === null)
ok('stats initialisées à 0 pour chaque joueur', Object.keys(s2.server.stats).length === 9 && s2.server.stats[P[0]].bomb_votes === 0)

// refus
ok('1 seule équipe → invalid_teams', (await start({ red: P.slice(0, 4) })).err === 'invalid_teams')
ok('équipe d’1 joueur → invalid_teams', (await start({ red: P.slice(0, 3), blue: [P[3]] })).err === 'invalid_teams')
ok('joueur dans 2 équipes → invalid_teams', (await start({ red: [P[0], P[1]], blue: [P[1], P[2]] })).err === 'invalid_teams')
ok('membre d’équipe hors p_players → invalid_teams', (await start(T2, {}, P.slice(0, 8))).err === 'invalid_teams')
ok('couleur inconnue → invalid_teams', (await start({ red: P.slice(0, 2), purple: P.slice(2, 4) })).err === 'invalid_teams')
ok('moins de 25 mots → invalid_action', (await start(T2, { words: ['a', 'b'] })).err === 'invalid_action')
ok('pas assez de mots pour toutes les manches → invalid_action', (await start(T2, { rounds: 'each', words: WORDS.slice(0, 100) })).err === 'invalid_action')
ok('doublon dans une grille → invalid_action', (await start(T2, { words: ['Éléphant', 'elephant', ...WORDS.slice(0, 23)] })).err === 'invalid_action')

// Espions récents évités : une partie terminée il y a 1 h avec P[0] espion des rouges
await db.query(`insert into public.device_sessions(auth_uid, profile_id) values ('aaaaaaaa-0000-0000-0000-000000000001', $1)`, [P[0]])
await db.query(`select set_config('app.uid', 'aaaaaaaa-0000-0000-0000-000000000001', false)`)
const soiree = (await db.query(`select public.create_soiree($1::uuid[]) r`, [`{${P.slice(1).join(',')}}`])).rows[0].r.id
const oldState = { players: P.slice(0, 8), teams: [{ id: 'red', spy: P[0], players: P.slice(0, 4) }, { id: 'blue', spy: P[4], players: P.slice(4, 8) }] }
await db.query(`insert into public.matches(soiree_id, game_id, status, state, finished_at) values ($1, 'nom-de-code', 'finished', $2::jsonb, now() - interval '1 hour')`, [soiree, JSON.stringify(oldState)])
const recent = (await db.query(`select public._ndc_recent_spies($1::uuid[]) r`, [`{${P.join(',')}}`])).rows[0].r
ok('_ndc_recent_spies : espions de la dernière partie récente', sameSet(recent, [P[0], P[4]]), JSON.stringify(recent))
let reused = 0
for (let i = 0; i < 10; i++) {
  const s = (await start({ red: P.slice(0, 4), blue: P.slice(4, 8) }, {}, P.slice(0, 8))).r
  if (s.state.teams[0].spy === P[0] || s.state.teams[1].spy === P[4]) reused++
}
ok('10 démarrages : aucun ancien espion repris', reused === 0, `repris ${reused} fois`)
await db.query(`update public.matches set finished_at = now() - interval '13 hours' where game_id = 'nom-de-code'`)
ok('_ndc_recent_spies : rien après 12 h', (await db.query(`select public._ndc_recent_spies($1::uuid[]) r`, [`{${P.join(',')}}`])).rows[0].r.length === 0)

// ----------------------------------------------------------------------------- tours (Task 2)
const act = async (st, actor, isHost, action) => {
  try {
    const r = (await db.query(`select public.game_nom_de_code_action($1::jsonb, $2::jsonb, $3::uuid, $4, $5::jsonb) r`,
      [JSON.stringify(st.state), JSON.stringify(st.server), actor, isHost, JSON.stringify(action)])).rows[0].r
    return { r }
  } catch (e) {
    return { err: e.message }
  }
}
const must = (res, label) => {
  if (res.err) throw new Error(label + ' : ' + res.err)
  return res.r
}
const team = (st, id) => st.state.teams.find((t) => t.id === id)
const spyOf = (st, id = st.state.turn) => team(st, id).spy
const guessersOf = (st, id = st.state.turn) => team(st, id).players.filter((p) => p !== team(st, id).spy)
const idxOf = (st, color, k = 0) =>
  st.server.key.map((c, i) => [c, i]).filter(([c, i]) => c === color && !(String(i) in st.state.revealed)).map(([, i]) => i)[k]
const otherOf = (st) => st.state.teams.find((t) => t.id !== st.state.turn).id // à 2 équipes
const giveClue = async (st, word = 'indice', n = 2) => must(await act(st, spyOf(st), false, { type: 'clue', word, n }), 'clue')
/** Tous les devineurs de l'équipe active votent pour index (s'arrête au dévoilement). */
const reveal = async (st, index) => {
  let cur = st
  for (const g of guessersOf(st)) {
    cur = must(await act(cur, g, false, { type: 'vote', index }), 'vote')
    if (String(index) in cur.state.revealed) break
  }
  return cur
}
const T6 = { red: P.slice(0, 3), blue: P.slice(3, 6) } // 1 espion + 2 devineurs → majorité 2 ; P[6] sur le banc
const fresh = async (teams = T6, extra = {}, players = P.slice(0, 7)) => {
  const s = must(await start(teams, extra, players), 'start')
  return { state: s.state, server: s.server }
}
const past = (st) => ({ ...st, state: { ...st.state, deadline: new Date(Date.now() - 1000).toISOString() } })
const BENCH = P[6]

// indices
let G = await fresh()
const e = async (action, actor = spyOf(G), st = G) => (await act(st, actor, false, action)).err
ok('indice vide → invalid_clue', (await e({ type: 'clue', word: '  ', n: 1 })) === 'invalid_clue')
ok('deux mots → invalid_clue', (await e({ type: 'clue', word: 'gros chat', n: 2 })) === 'invalid_clue')
ok('n = 0 ou 10 → invalid_clue', (await e({ type: 'clue', word: 'chat', n: 0 })) === 'invalid_clue' && (await e({ type: 'clue', word: 'chat', n: 10 })) === 'invalid_clue')
ok('plus de 24 caractères → invalid_clue', (await e({ type: 'clue', word: 'a'.repeat(25), n: 1 })) === 'invalid_clue')
ok('ponctuation seule → invalid_clue', (await e({ type: 'clue', word: '!!!', n: 1 })) === 'invalid_clue')
ok('mot de la grille en majuscules → clue_is_grid_word', (await e({ type: 'clue', word: G.state.words[3].toUpperCase(), n: 1 })) === 'clue_is_grid_word')
const GA = await fresh(T6, { words: ['éléphant', ...WORDS.slice(0, 24)] })
ok('mot de la grille sans accents → clue_is_grid_word', (await act(GA, spyOf(GA), false, { type: 'clue', word: 'ELEPHANT', n: 1 })).err === 'clue_is_grid_word')
const c1 = await giveClue(G, 'arc-en-ciel', 2)
ok('mot à tiret hors grille accepté → phase guess, 3 essais', c1.state.phase === 'guess' && c1.state.clue.word === 'arc-en-ciel' && c1.state.clue.n === 2 && c1.state.guesses_left === 3)
ok('phase guess : deadline ≈ +180 s', approxSeconds(c1.state.deadline, 180))
ok('devineur qui donne l’indice → not_spy', (await e({ type: 'clue', word: 'chat', n: 1 }, guessersOf(G)[0])) === 'not_spy')
ok('espion adverse qui donne l’indice → not_spy', (await e({ type: 'clue', word: 'chat', n: 1 }, spyOf(G, otherOf(G)))) === 'not_spy')
ok('indice pendant les devinettes → wrong_phase', (await act(c1, spyOf(c1), false, { type: 'clue', word: 'chat', n: 1 })).err === 'wrong_phase')

// rôles
ok('espion qui vote → not_guesser', (await act(c1, spyOf(c1), false, { type: 'vote', index: 0 })).err === 'not_guesser')
ok('joueur du banc qui vote → not_guesser', (await act(c1, BENCH, false, { type: 'vote', index: 0 })).err === 'not_guesser')
ok('adversaire qui vote → not_guesser', (await act(c1, guessersOf(c1, otherOf(c1))[0], false, { type: 'vote', index: 0 })).err === 'not_guesser')
ok('vote pendant la phase d’indice → wrong_phase', (await act(G, guessersOf(G)[0], false, { type: 'vote', index: 0 })).err === 'wrong_phase')

// majorité
const [g1, g2] = guessersOf(c1)
const own = idxOf(c1, c1.state.turn)
const own2 = idxOf(c1, c1.state.turn, 1)
const v1 = must(await act(c1, g1, false, { type: 'vote', index: own }), 'v1')
ok('1 tête sur 2 devineurs : pas de dévoilement', Object.keys(v1.state.revealed).length === 0 && v1.state.votes[g1] === own)
const vNull = must(await act(v1, g1, false, { type: 'vote', index: null }), 'vNull')
ok('retirer sa tête (index null)', !(g1 in vNull.state.votes))
const vMove = must(await act(v1, g1, false, { type: 'vote', index: own2 }), 'vMove')
ok('déplacer sa tête', vMove.state.votes[g1] === own2)
const v2 = must(await act(v1, g2, false, { type: 'vote', index: own }), 'v2')
ok('2e tête : dévoilé, votes vidés', v2.state.revealed[own]?.color === c1.state.turn && v2.state.revealed[own]?.by === c1.state.turn && Object.keys(v2.state.votes).length === 0)
ok('bon mot : found+1, guesses_left-1, turn_found 1, toujours en guess',
  team(v2, v2.state.turn).found === 1 && v2.state.guesses_left === 2 && v2.state.turn_found === 1 && v2.state.phase === 'guess')
const vDone = await act(v2, g1, false, { type: 'vote', index: own })
ok('vote sur carte dévoilée : ignoré sans erreur', vDone.err === undefined && JSON.stringify(vDone.r.state.revealed) === JSON.stringify(v2.state.revealed) && !(g1 in vDone.r.state.votes))
ok('index hors grille → invalid_action', (await act(c1, g1, false, { type: 'vote', index: 25 })).err === 'invalid_action')
const solo = await giveClue(await fresh({ red: P.slice(0, 2), blue: P.slice(2, 4) }, {}, P.slice(0, 4)))
const soloIdx = idxOf(solo, solo.state.turn)
const soloR = must(await act(solo, guessersOf(solo)[0], false, { type: 'vote', index: soloIdx }), 'solo')
ok('équipe d’1 devineur : dévoilement immédiat', String(soloIdx) in soloR.state.revealed)

// effets
const nIdx = idxOf(c1, 'neutral')
const neu = await reveal(c1, nIdx)
ok('neutre : fin du tour → l’autre équipe en phase clue',
  neu.state.revealed[nIdx]?.color === 'neutral' && neu.state.turn === otherOf(c1) && neu.state.phase === 'clue' && neu.state.clue === null)
ok('fin du tour : deadline ≈ +120 s', approxSeconds(neu.state.deadline, 120))
const enemy = otherOf(c1)
const eIdx = idxOf(c1, enemy)
const en = await reveal(c1, eIdx)
ok('mot adverse : compte pour l’adversaire, fin du tour', team(en, enemy).found === 1 && team(en, c1.state.turn).found === 0 && en.state.turn === enemy && en.state.phase === 'clue')
let lim = await giveClue(G, 'chat', 1)
lim = await reveal(lim, idxOf(lim, lim.state.turn))
ok('n = 1 : encore en guess après 1 bon mot', lim.state.phase === 'guess' && lim.state.guesses_left === 1)
lim = await reveal(lim, idxOf(lim, lim.state.turn))
ok('n + 1 essais puis fin du tour', lim.state.phase === 'clue' && lim.state.turn === otherOf(G) && team(lim, G.state.turn).found === 2)
const bmb = await reveal(c1, idxOf(c1, 'bomb'))
ok('bombe à 2 équipes : l’autre équipe gagne la manche (bomb)',
  ['round_end', 'finished'].includes(bmb.state.phase) && bmb.state.round_winner === enemy && bmb.state.round_end_reason === 'bomb' && team(bmb, c1.state.turn).eliminated === true)
ok('fin de manche : clé publique, deadline null', Array.isArray(bmb.state.key) && bmb.state.key.length === 25 && bmb.state.deadline === null)
// dernier mot de l'adversaire dévoilé par l'équipe active → l'adversaire gagne
const almost = { ...c1, state: { ...c1.state, teams: c1.state.teams.map((t) => (t.id === enemy ? { ...t, found: t.total - 1 } : t)) } }
const gift = await reveal(almost, eIdx)
ok('dernier mot d’une équipe dévoilé par l’adversaire → cette équipe gagne (words)', gift.state.round_winner === enemy && gift.state.round_end_reason === 'words')
const allOwn = { ...c1, state: { ...c1.state, teams: c1.state.teams.map((t) => (t.id === c1.state.turn ? { ...t, found: t.total - 1 } : t)) } }
const win = await reveal(allOwn, own)
ok('dernier mot de son équipe → elle gagne (words)', win.state.round_winner === c1.state.turn && win.state.round_end_reason === 'words')

// stop
ok('stop avant tout dévoilement → stop_too_early', (await act(c1, g1, false, { type: 'stop' })).err === 'stop_too_early')
const st1 = must(await act(v2, g1, false, { type: 'stop' }), 'st1')
ok('1 stop sur 2 : on continue', st1.state.phase === 'guess' && st1.state.stop.includes(g1))
const stOff = must(await act(st1, g1, false, { type: 'stop' }), 'stOff')
ok('re-stop : retire son stop', !stOff.state.stop.includes(g1))
const st2 = must(await act(st1, g2, false, { type: 'stop' }), 'st2')
ok('stop à la majorité → fin du tour', st2.state.phase === 'clue' && st2.state.turn === otherOf(v2))
ok('stop par l’espion → not_guesser', (await act(v2, spyOf(v2), false, { type: 'stop' })).err === 'not_guesser')

// chrono
const tk0 = must(await act(G, P[0], false, { type: 'tick' }), 'tk0')
ok('tick avant échéance : inchangé', tk0.state.phase === 'clue' && tk0.state.turn === G.state.turn)
const tk1 = must(await act(past(G), P[0], false, { type: 'tick' }), 'tk1')
ok('tick indice échu : tour suivant + idle_clue', tk1.state.turn === otherOf(G) && tk1.state.phase === 'clue' && tk1.server.stats[spyOf(G)].idle_clue === 1)
const tk2 = must(await act(past(c1), P[0], false, { type: 'tick' }), 'tk2')
ok('tick devinettes échu : fin du tour (sans idle_clue)', tk2.state.turn === otherOf(c1) && tk2.state.phase === 'clue' && tk2.server.stats[spyOf(c1)].idle_clue === 0)
const tk3 = must(await act(tk1, P[0], false, { type: 'tick' }), 'tk3')
ok('tick rejoué : idempotent', tk3.state.turn === tk1.state.turn && tk3.server.stats[spyOf(G)].idle_clue === 1)
const relaxed = await fresh(T6, { timer: 'relaxed' })
const tkR = must(await act({ ...relaxed, state: { ...relaxed.state } }, P[0], false, { type: 'tick' }), 'tkR')
ok('relaxed : tick ne fait rien', tkR.state.turn === relaxed.state.turn && tkR.state.phase === 'clue' && tkR.state.deadline === null)

// skip (hôte)
ok('skip par un non-hôte → not_host', (await act(G, P[1], false, { type: 'skip' })).err === 'not_host')
const sk1 = must(await act(G, P[1], true, { type: 'skip' }), 'sk1')
ok('skip en phase clue : équipe suivante, sans idle_clue', sk1.state.turn === otherOf(G) && sk1.state.phase === 'clue' && sk1.server.stats[spyOf(G)].idle_clue === 0)
const sk2 = must(await act(c1, P[1], true, { type: 'skip' }), 'sk2')
ok('skip en phase guess : fin du tour', sk2.state.turn === otherOf(c1) && sk2.state.phase === 'clue')
ok('skip en fin de manche → wrong_phase', (await act(bmb, P[1], true, { type: 'skip' })).err === 'wrong_phase' || bmb.state.phase === 'finished')
ok('action inconnue → unknown_action', (await act(G, P[1], true, { type: 'danse' })).err === 'unknown_action')

// élimination (3 équipes de 2 : 1 espion + 1 devineur)
const T3 = { red: P.slice(0, 2), blue: P.slice(2, 4), green: P.slice(4, 6) }
let E3 = await giveClue(await fresh(T3, {}, P.slice(0, 6)))
const first = E3.state.turn
const order = ['red', 'blue', 'green']
const nextOf = (t, skip = []) => { let i = order.indexOf(t); do { i = (i + 1) % 3 } while (skip.includes(order[i])); return order[i] }
E3 = await reveal(E3, idxOf(E3, 'bomb'))
ok('bombe à 3 équipes : équipe éliminée, les autres continuent', team(E3, first).eliminated && E3.state.phase === 'clue' && E3.state.turn === nextOf(first))
const second = E3.state.turn
E3 = await reveal(await giveClue(E3), idxOf(E3, 'neutral'))
ok('le tour saute l’équipe éliminée', E3.state.turn === nextOf(second, [first]) && E3.state.turn !== first)
// les mots de l'équipe éliminée sont dévoilés par une autre équipe : elle ne gagne pas
const elimAlmost = { ...E3, state: { ...E3.state, teams: E3.state.teams.map((t) => (t.id === first ? { ...t, found: t.total - 1 } : t)) } }
const elimLast = await reveal(await giveClue(elimAlmost), idxOf(elimAlmost, first))
ok('mots de l’équipe éliminée tous dévoilés : elle ne gagne pas', elimLast.state.phase === 'clue' && elimLast.state.round_winner === null)
// une 2e équipe éliminée (manipulée) → la dernière équipe en jeu gagne
const two = await giveClue(await fresh(T3, {}, P.slice(0, 6)))
const elimOne = { ...two, state: { ...two.state, teams: two.state.teams.map((t) => (t.id === nextOf(two.state.turn) ? { ...t, eliminated: true } : t)) } }
const lastTeam = await reveal(elimOne, idxOf(elimOne, 'bomb'))
const survivor = order.find((t) => t !== two.state.turn && t !== nextOf(two.state.turn))
ok('dernière équipe en jeu → gagne (last_team)', lastTeam.state.round_winner === survivor && lastTeam.state.round_end_reason === 'last_team')

// ----------------------------------------------------------------------------- manches, fin, compteurs (Task 3)
const STAT_KEYS = ['bomb_votes', 'idle_clue', 'enemy_reveals', 'first_good', 'best_clue', 'spy_wins', 'flawless', 'comeback']
const res = (st, pid) => st.results.find((x) => x.profile_id === pid)
// rounds one : manche gagnée → fin de partie
ok('rounds one : victoire → phase finished + results', win.state.phase === 'finished' && Array.isArray(win.results), win.state.phase)
ok('results : membres d’équipe seulement, banc exclu', sameSet(win.results.map((x) => x.profile_id), win.state.players) && !win.results.some((x) => x.profile_id === BENCH))
const winner = win.state.round_winner
const loser = win.state.teams.find((t) => t.id !== winner).id
ok('gagnants : won, placement 1, points 1', team(win, winner).players.every((p) => res(win, p).won === true && res(win, p).placement === 1 && res(win, p).points === 1))
ok('perdants : pas won, placement 2, points 0', team(win, loser).players.every((p) => res(win, p).won === false && res(win, p).placement === 2 && res(win, p).points === 0))
ok('toutes les clés de stats présentes', win.results.every((x) => STAT_KEYS.every((k) => Number.isInteger(x.stats[k]))))
ok('bombe : fin de partie aussi (rounds one)', bmb.state.phase === 'finished' && Array.isArray(bmb.results))

// compteurs
ok('bomb_votes : chaque tête sur la bombe', guessersOf(c1).every((g) => res(bmb, g).stats.bomb_votes === 1) && res(bmb, spyOf(c1)).stats.bomb_votes === 0)
ok('enemy_reveals : têtes sur un mot adverse', guessersOf(c1).every((g) => en.server.stats[g].enemy_reveals === 1))
ok('first_good : premier à poser sa tête sur un bon mot', v2.server.stats[g1].first_good === 1 && v2.server.stats[g2].first_good === 0)
ok('best_clue : mots trouvés avec un indice (fin du tour)', lim.server.stats[spyOf(G)].best_clue === 2, JSON.stringify(lim.server.stats[spyOf(G)]))
ok('spy_wins : espion de l’équipe gagnante', res(win, spyOf(c1, winner)).stats.spy_wins === 1 && res(win, spyOf(c1, loser)).stats.spy_wins === 0)
ok('flawless : manche gagnée sans erreur', team(win, winner).players.every((p) => res(win, p).stats.flawless === 1))
ok('flawless : pas pour une victoire après erreur', res(gift, spyOf(c1, enemy)).stats.flawless === 1 && guessersOf(c1).every((g) => res(gift, g).stats.flawless === 0))
// remontada : l'équipe active a 9 mots restants contre 1 pour l'adversaire, puis gagne
const behind = { ...c1, state: { ...c1.state, teams: c1.state.teams.map((t) => (t.id === enemy ? { ...t, found: t.total - 1 } : t)) } }
const bh1 = await reveal(behind, own)
ok('max_deficit suivi après chaque dévoilement', bh1.server.max_deficit[c1.state.turn] >= 3, JSON.stringify(bh1.server.max_deficit))
const comebackSt = { ...bh1, state: { ...bh1.state, teams: bh1.state.teams.map((t) => (t.id === c1.state.turn ? { ...t, found: t.total - 1 } : t)) } }
const cb = await reveal(comebackSt, own2)
ok('comeback : victoire après 3 mots de retard', cb.state.round_winner === c1.state.turn && team(cb, c1.state.turn).players.every((p) => res(cb, p).stats.comeback === 1))
ok('pas de comeback sans retard', team(win, winner).players.every((p) => res(win, p).stats.comeback === 0))

// rounds each : 3 manches (équipes de 3)
let R = await giveClue(await fresh(T6, { rounds: 'each' }))
const r1Spies = R.state.teams.map((t) => t.spy)
R = { ...R, state: { ...R.state, teams: R.state.teams.map((t) => (t.id === R.state.turn ? { ...t, found: t.total - 1 } : t)) } }
R = await reveal(R, idxOf(R, R.state.turn))
ok('rounds each : manche 1 gagnée → round_end, pas de results', R.state.phase === 'round_end' && R.results === undefined && R.state.round_wins[R.state.round_winner] === 1)
ok('next_round par un non-hôte → not_host', (await act(R, P[1], false, { type: 'next_round' })).err === 'not_host')
ok('next_round hors fin de manche → wrong_phase', (await act(G, P[1], true, { type: 'next_round' })).err === 'wrong_phase')
const R2 = must(await act(R, P[1], true, { type: 'next_round' }), 'next_round')
ok('manche 2 : phase clue, revealed vide, key null, round 2', R2.state.phase === 'clue' && R2.state.round === 2 && Object.keys(R2.state.revealed).length === 0 && R2.state.key === null)
ok('manche 2 : nouvelle grille (mots 25 à 49)', R2.state.words[0] === 'mot25' && R2.state.words[24] === 'mot49')
ok('manche 2 : found remis à 0, aucune équipe éliminée', R2.state.teams.every((t) => t.found === 0 && !t.eliminated))
ok('rotation : nouvel espion dans chaque équipe', R2.state.teams.every((t, i) => t.spy !== r1Spies[i]))
ok('nouveaux espions : secret {round 2, key}', R2.state.teams.every((t) => R2.secrets[t.spy]?.round === 2 && R2.secrets[t.spy].key.length === 25))
ok('ancien espion : secret {round: 2, key: null}', r1Spies.every((s) => R2.secrets[s]?.round === 2 && R2.secrets[s].key === null))
ok('score des manches conservé', JSON.stringify(R2.state.round_wins) === JSON.stringify(R.state.round_wins))
// égalité : 2 manches (équipes de 2), chaque équipe en gagne une
let Q = await giveClue(await fresh({ red: P.slice(0, 2), blue: P.slice(2, 4) }, { rounds: 'each' }, P.slice(0, 4)))
const winRound = async (st) => {
  const t = st.state.turn
  const s1 = { ...st, state: { ...st.state, teams: st.state.teams.map((x) => (x.id === t ? { ...x, found: x.total - 1 } : x)) } }
  return reveal(s1, idxOf(s1, t))
}
Q = await winRound(Q)
const firstWinner = Q.state.round_winner
Q = must(await act(Q, P[0], true, { type: 'next_round' }), 'q2')
if (Q.state.turn === firstWinner) Q = must(await act(Q, P[0], true, { type: 'skip' }), 'q-skip')
Q = await winRound(await giveClue(Q))
ok('égalité de manches → les deux équipes gagnantes', Q.state.phase === 'finished' && Q.results.every((x) => x.won && x.placement === 1 && x.points === 1), JSON.stringify(Q.state.round_wins))

// catalogue
const nTr = (await db.query(`select count(*)::int c from public.trophies where tenue_id = 'hacker' and game_id = 'nom-de-code' and active`)).rows[0].c
const tenue = (await db.query(`select game_id, condition_type, threshold from public.tenues where id = 'hacker'`)).rows[0]
ok('catalogue : tenue hacker (10 victoires à nom-de-code)', tenue?.game_id === 'nom-de-code' && tenue.condition_type === 'game_wins' && tenue.threshold === 10)
ok('catalogue : 11 trophées ndc actifs (slots 2 à 12)', nTr === 11, String(nTr))

console.log(failed ? '\nÉCHEC' : '\nTout est OK')
process.exit(failed ? 1 : 0)
