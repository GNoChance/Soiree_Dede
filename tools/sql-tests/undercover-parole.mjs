// Tests SQL : ordre de parole « J'ai parlé » d'undercover.
// node undercover-parole.mjs ../../supabase/install.sql
import { bootDb } from './boot.mjs'

const file = process.argv[2]
if (!file) throw new Error('usage : node undercover-parole.mjs <install.sql>')
const db = await bootDb(file)
let failed = false
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK   ' : 'ÉCHEC'} ${name}${cond ? '' : ' ' + extra}`)
  if (!cond) failed = true
}
const ids = (await db.query(`select id from public.profiles order by sort_order limit 4`)).rows.map((r) => r.id)
const F = 'undercover'
const g = (await db.query(`select public.game_undercover_start($1::uuid[], $2::jsonb) r`, [`{${ids.join(',')}}`, JSON.stringify({ pair: ['Chat', 'Chien'], misterWhite: false })])).rows[0].r
const act = async (st, sv, actor, host, action) => {
  try {
    return (await db.query(`select public.game_${F}_action($1::jsonb,$2::jsonb,$3::uuid,$4,$5::jsonb) r`, [st, sv, actor, host, action])).rows[0].r
  } catch (e) {
    return { err: e.message }
  }
}
const order = g.state.order
ok('start : spoken vide', Array.isArray(g.state.spoken) && g.state.spoken.length === 0)

// Un non-orateur (non hôte) ne peut pas passer le premier
let r = await act(g.state, g.server, order[1], false, { type: 'spoke', player: order[0] })
ok('un autre joueur ne peut pas passer l’orateur', r.err === 'not_host', JSON.stringify(r.err))
// L'orateur passe
r = await act(g.state, g.server, order[0], false, { type: 'spoke', player: order[0] })
ok('orateur : J’ai parlé', r.state?.spoken?.length === 1 && r.state.spoken[0] === order[0])
// Idempotence
const r2 = await act(r.state, r.server, order[0], false, { type: 'spoke', player: order[0] })
ok('double appui idempotent', r2.state.spoken.length === 1)
// Sans player : un joueur hors tour ne peut pas
let r3 = await act(r.state, r.server, order[3], false, { type: 'spoke' })
ok('sans cible : seul l’orateur courant (ou l’hôte)', r3.err === 'not_host', JSON.stringify(r3.err))
// L'hôte passe l'orateur courant
r3 = await act(r.state, r.server, order[3], true, { type: 'spoke' })
ok('hôte passe l’orateur courant', r3.state?.spoken?.[1] === order[1], JSON.stringify(r3.state?.spoken))
// Éliminé sauté : on retire order[2] des vivants
const elim = { ...r3.state, alive: r3.state.alive.filter((x) => x !== order[2]) }
let r4 = await act(elim, r3.server, order[3], true, { type: 'spoke' })
ok('éliminé sauté', r4.state?.spoken?.[2] === order[3], JSON.stringify(r4.state?.spoken))
// Vote verrouillé avant la fin pour un joueur non hôte (vote_unlock futur)
let v = await act(r.state, r.server, order[1], false, { type: 'start_vote' })
ok('vote non hôte refusé avant fin de parole', v.err === 'not_host', JSON.stringify(v.err))
// Tout le monde a parlé : n'importe quel vivant peut ouvrir le vote
v = await act(r4.state, r4.server, order[1], false, { type: 'start_vote' })
ok('fin de parole : un joueur ouvre le vote', v.state?.phase === 'vote', JSON.stringify(v.err))
// Hôte peut toujours
v = await act(r.state, r.server, order[1], true, { type: 'start_vote' })
ok('hôte ouvre le vote à tout moment', v.state?.phase === 'vote')
// Règle des 90 s conservée
const late = { ...r.state, vote_unlock: new Date(Date.now() - 1000).toISOString() }
v = await act(late, r.server, order[1], false, { type: 'start_vote' })
ok('règle des 90 s conservée', v.state?.phase === 'vote')
// Rétrocompat : vieux state sans spoken
const { spoken, ...old } = g.state
r = await act(old, g.server, order[0], false, { type: 'spoke', player: order[0] })
ok('vieille partie sans spoken', r.state?.spoken?.length === 1)
v = await act(old, g.server, order[1], false, { type: 'start_vote' })
ok('vieille partie : vote non hôte verrouillé', v.err === 'not_host')
// Hors phase
r = await act({ ...g.state, phase: 'vote' }, g.server, order[0], false, { type: 'spoke' })
ok('hors phase describe refusé', r.err === 'wrong_phase')
process.exit(failed ? 1 : 0)
