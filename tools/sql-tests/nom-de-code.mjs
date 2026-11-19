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

console.log(failed ? '\nÉCHEC' : '\nTout est OK')
process.exit(failed ? 1 : 0)
