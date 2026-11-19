// Tests SQL du Petit bac (PGlite) : node petit-bac.mjs ../../supabase/install.sql
// « STOP ! » : l'hôte peut toujours arrêter la manche ; un joueur seulement s'il a rempli toutes ses cases.
import { bootDb } from './boot.mjs'

const file = process.argv[2]
if (!file) throw new Error('usage : node petit-bac.mjs <install.sql>')
const db = await bootDb(file)

let failed = false
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK   ' : 'ÉCHEC'} ${name}${cond ? '' : ' ' + extra}`)
  if (!cond) failed = true
}

const ids = (await db.query(`select id from public.profiles order by sort_order limit 4`)).rows.map((r) => r.id)
const [A, B, C, X] = ids // A hôte (joueur), B et C joueurs, X hors partie
const cats = [{ id: 'prenom', label: 'Prénom', emoji: '🙂' }, { id: 'animal', label: 'Animal', emoji: '🐶' }, { id: 'ville', label: 'Ville', emoji: '🏙️' }]
const start = (await db.query(`select public.game_petit_bac_start($1::uuid[], $2::jsonb) r`, [`{${A},${B},${C}}`, JSON.stringify({ categories: cats })])).rows[0].r
const s0 = start.state
const sv0 = start.server

/** Applique une action au moteur ; renvoie {r} ou {err}. */
const run = async (state, server, actor, isHost, action) => {
  try {
    return { r: (await db.query(`select public.game_petit_bac_action($1::jsonb, $2::jsonb, $3::uuid, $4, $5::jsonb) r`, [state, server, actor, isHost, action])).rows[0].r }
  } catch (e) {
    return { err: e.message }
  }
}
const full = { prenom: 'Paul', animal: 'Panda', ville: 'Paris' }
const STOP = { type: 'end_round' }

ok('départ en phase writing', s0.phase === 'writing', s0.phase)

let x = await run(s0, sv0, A, true, STOP)
ok('l’hôte arrête la manche même sans avoir fini', x.r?.state?.phase === 'validation', JSON.stringify(x))

x = await run(s0, sv0, B, false, STOP)
ok('un joueur qui n’a pas fini ne peut pas crier STOP', x.err === 'not_finished', JSON.stringify(x))

x = await run(s0, sv0, B, false, { ...STOP, answers: { prenom: 'Paul', animal: 'Panda' } })
ok('un joueur avec une case vide ne peut pas crier STOP', x.err === 'not_finished', JSON.stringify(x))

const saved = (await run(s0, sv0, B, false, { type: 'save', round: s0.round, answers: full })).r
x = await run(saved.state, saved.server, B, false, STOP)
ok('un joueur qui a tout rempli (déjà sauvegardé) crie STOP', x.r?.state?.phase === 'validation', JSON.stringify(x))

x = await run(s0, sv0, B, false, { ...STOP, answers: full })
ok('STOP avec les dernières réponses jointes : manche arrêtée', x.r?.state?.phase === 'validation', JSON.stringify(x))
ok('… et ces réponses sont bien prises en compte', x.r?.state?.validation?.answers?.ville?.[B]?.text === 'Paris', JSON.stringify(x.r?.state?.validation?.answers?.ville))
ok('… marqué comme arrêt anticipé', x.r?.state?.forced === true)

x = await run(s0, sv0, X, false, { ...STOP, answers: full })
ok('quelqu’un hors partie ne peut pas crier STOP', x.err === 'not_a_player', JSON.stringify(x))

const v = (await run(s0, sv0, A, true, STOP)).r
x = await run(v.state, v.server, B, false, { ...STOP, answers: full })
ok('STOP pendant la validation → wrong_phase', x.err === 'wrong_phase', JSON.stringify(x))

console.log(failed ? '\nÉCHEC' : '\nTout est OK')
process.exit(failed ? 1 : 0)
