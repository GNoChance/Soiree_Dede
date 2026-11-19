// Génère un VRAI état public de départ pour chacun des 20 jeux (fonctions SQL game_<id>_start sur install.sql, PGlite)
// → tools/sql-tests/out/states.json, lu par la page locale d'audit du mode spectateur (src/pages/SpectateAuditPage.tsx).
// Usage : node game-states.mjs ../../supabase/install.sql
import fs from 'node:fs'
import { bootDb } from './boot.mjs'

const file = process.argv[2]
if (!file) throw new Error('usage : node game-states.mjs <install.sql>')
const db = await bootDb(file)

const prof = (await db.query(`select id, slug, nickname from public.profiles order by sort_order limit 6`)).rows
const ids = prof.map((p) => p.id)
await db.query(`insert into public.device_sessions(auth_uid, profile_id) values ('aaaaaaaa-0000-0000-0000-000000000001', $1)`, [ids[0]])
await db.query(`select set_config('app.uid', 'aaaaaaaa-0000-0000-0000-000000000001', false)`)

const n = (k, f) => Array.from({ length: k }, (_, i) => f(i))
const words = ['chat', 'chien', 'maison', 'voiture', 'arbre', 'plage', 'montagne', 'pizza', 'guitare', 'avion', 'fleur', 'bateau']
const OPTIONS = {
  'action-ou-verite': { cards: [...n(4, (i) => ({ id: 'a' + i, kind: 'action', text: 'Fais une imitation ' + i, level: 1 })), ...n(4, (i) => ({ id: 'v' + i, kind: 'verite', text: 'Raconte un souvenir ' + i, level: 1 }))], rounds: 5 },
  'bataille-navale': {},
  'bombe-a-mots': { syllables: n(12, (i) => ({ s: ['ou', 'an', 'ent', 'ion', 'ar', 'ra', 'ci', 'eur', 'mon', 'tra', 'ble', 'oi'][i], level: 1 + (i % 3) })) },
  bowling: {},
  'cerveau-en-fete': { questions: n(5, (i) => ({ id: 'q' + i, theme: 'culture', difficulty: 1, prompt: 'Capitale de la France ? (' + i + ')', answer: 'Paris', mode: i % 2 ? 'mcq' : 'typed', distractors: ['Lyon', 'Nice', 'Lille'] })) },
  'dede-kart': {},
  'dessine-devine': { rounds: 1, choices: n(6, (i) => n(3, (j) => ({ word: words[(i * 3 + j) % words.length], aliases: [], difficulty: 1 + j }))) },
  'devine-en-equipe': { words: words.map((w, i) => (i % 3 ? w : { word: w, kind: 'perso' })) },
  'le-plus-proche': { questions: n(4, (i) => ({ id: 'e' + i, theme: 'divers', difficulty: 1, prompt: 'Combien de jours dans une année ? (' + i + ')', answer: 365, unit: 'jours' })) },
  'loup-garou': {},
  menteur: {},
  morpion: {},
  'pas-de-bol': {},
  'nom-de-code': { teams: { red: ids.slice(0, 3), blue: ids.slice(3, 6) }, rounds: 'one', timer: 'normal', words: n(25, (i) => 'mot' + i) },
  'petit-bac': { categories: [{ id: 'prenom', label: 'Prénom', emoji: '🙂' }, { id: 'animal', label: 'Animal', emoji: '🐶' }, { id: 'ville', label: 'Ville', emoji: '🏙️' }] },
  'quatre-a-la-suite': {},
  'qui-de-nous': { questions: n(5, (i) => 'Qui de nous le plus drôle ? ' + i), rounds: 5 },
  'qui-suis-je': { cards: n(8, (i) => ({ id: 'c' + i, name: ['Astérix', 'Obélix', 'Mario', 'Zelda', 'Batman', 'Shrek', 'Elsa', 'Simba'][i], theme: 'divers', difficulty: 1 })) },
  'tour-des-potes': {},
  'tu-preferes': { dilemmas: n(5, (i) => ({ id: 'd' + i, a: 'Plage ' + i, b: 'Montagne ' + i })) },
  undercover: { pair: ['chat', 'chien'] },
}

const fns = (await db.query(`select proname from pg_proc where proname like 'game\\_%\\_start' and pronamespace = 'public'::regnamespace order by 1`)).rows.map((r) => r.proname)
const out = { _players: prof, _ids: ids }
let okCount = 0
for (const fn of fns) {
  const id = Object.keys(OPTIONS).find((k) => `game_${k.replace(/-/g, '_')}_start` === fn)
  if (!id) {
    console.log('ÉCHEC', fn, ': pas d’options définies')
    continue
  }
  try {
    const r = (await db.query(`select public.${fn}($1::uuid[], $2::jsonb) r`, [`{${ids.join(',')}}`, JSON.stringify(OPTIONS[id])])).rows[0].r
    out[id] = { state: r.state, players: ids }
    okCount++
    console.log('OK   ', id, 'phase=' + r.state.phase, 'joueurs=' + (r.state.players?.length ?? '?'))
  } catch (e) {
    console.log('ÉCHEC', id, e.message)
  }
}
fs.mkdirSync(new URL('./out/', import.meta.url), { recursive: true })
fs.writeFileSync(new URL('./out/states.json', import.meta.url), JSON.stringify(out))
console.log(`\n${okCount}/${fns.length} jeux`)
process.exit(okCount === 20 ? 0 : 1)
