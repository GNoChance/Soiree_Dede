// Tests SQL des cartes maison (PGlite) : node cartes-maison.mjs ../../supabase/install.sql
import { bootDb } from './boot.mjs'

const file = process.argv[2]
if (!file) throw new Error('usage : node cartes-maison.mjs <install.sql>')
const db = await bootDb(file)
let failed = false
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK   ' : 'ÉCHEC'} ${name}${cond ? '' : ' ' + extra}`)
  if (!cond) failed = true
}
const U1 = 'aaaaaaaa-0000-0000-0000-000000000001'
const U2 = 'aaaaaaaa-0000-0000-0000-000000000002'
const U3 = 'aaaaaaaa-0000-0000-0000-000000000003'
const ps = (await db.query(`select id from public.profiles order by sort_order limit 3`)).rows.map((r) => r.id)
const [A, B, C] = ps
await db.query(`insert into public.device_sessions(auth_uid, profile_id) values ($1, $2), ($3, $4), ($5, $6)`, [U1, A, U2, B, U3, C])
await db.query(`update public.profiles set is_admin = true where id = $1`, [C])
const as = (u) => db.query(`select set_config('app.uid', $1, false)`, [u])
const call = async (u, sql, args = []) => {
  await as(u)
  try {
    return { r: (await db.query(sql, args)).rows[0]?.r }
  } catch (e) {
    return { err: e.message }
  }
}
const create = (u, g, k, p) => call(u, `select public.create_custom_card($1, $2, $3::jsonb) r`, [g, k, JSON.stringify(p)])

// Création
const d1 = await create(U1, 'tu-preferes', 'dilemma', { a: '  manger   un   cactus ', b: 'boire du vinaigre' })
ok('dilemme créé et normalisé', d1.r?.payload?.a === 'manger un cactus' && d1.r.author_id === A, JSON.stringify(d1))
ok('doublon refusé (casse ignorée)', (await create(U1, 'tu-preferes', 'dilemma', { a: 'Manger un CACTUS', b: 'boire du vinaigre' })).err === 'duplicate_card')
ok('même carte par un autre auteur : ok', !(await create(U2, 'tu-preferes', 'dilemma', { a: 'manger un cactus', b: 'boire du vinaigre' })).err)
ok('dilemme sans B refusé', (await create(U1, 'tu-preferes', 'dilemma', { a: 'oui', b: '' })).err === 'invalid_custom_card')
ok('dilemme trop long refusé', (await create(U1, 'tu-preferes', 'dilemma', { a: 'x'.repeat(121), b: 'non' })).err === 'invalid_custom_card')
ok('mauvais type pour le jeu refusé', (await create(U1, 'qui-de-nous', 'action', { text: 'Fais le tour de la table' })).err === 'invalid_custom_card')
ok('jeu inconnu refusé', (await create(U1, 'morpion', 'dilemma', { a: 'oui', b: 'non' })).err === 'invalid_custom_card')
const a1 = await create(U1, 'action-ou-verite', 'action', { text: 'Imite Dédé en train de râler', level: 2 })
ok('action avec niveau', a1.r?.payload?.level === 2, JSON.stringify(a1))
ok('niveau 1 par défaut', (await create(U1, 'action-ou-verite', 'verite', { text: 'Ton plus gros fou rire ?' })).r?.payload?.level === 1)
ok('niveau 4 refusé', (await create(U1, 'action-ou-verite', 'action', { text: 'Texte assez long', level: 4 })).err === 'invalid_custom_card')
ok('niveau non numérique refusé', (await create(U1, 'action-ou-verite', 'action', { text: 'Texte assez long', level: 'x' })).err === 'invalid_custom_card')
const q1 = await create(U1, 'qui-de-nous', 'question', { text: 'Qui de nous finirait le gâteau en cachette ?' })
ok('question créée', !!q1.r?.id, JSON.stringify(q1))
ok('question trop courte refusée', (await create(U1, 'qui-de-nous', 'question', { text: 'Qui ?' })).err === 'invalid_custom_card')

// Quota
for (let i = 0; i < 200; i++) {
  await db.query(`insert into public.custom_cards(author_id, game_id, kind, payload) values ($1, 'qui-de-nous', 'question', $2::jsonb)`, [C, JSON.stringify({ text: 'Qui de nous numéro ' + i + ' ?' })])
}
ok('plafond de 200 cartes', (await create(U3, 'qui-de-nous', 'question', { text: 'Qui de nous de trop ?' })).err === 'too_many_cards')

// Modification / suppression
ok('modif par l auteur', (await call(U1, `select public.update_custom_card($1, $2::jsonb) r`, [d1.r.id, JSON.stringify({ a: 'avaler un cactus', b: 'boire du vinaigre' })])).r?.payload?.a === 'avaler un cactus')
ok('modif par un autre refusée', (await call(U2, `select public.update_custom_card($1, $2::jsonb) r`, [d1.r.id, JSON.stringify({ a: 'abc', b: 'def' })])).err === 'not_card_author')
ok('modif même pour un admin refusée', (await call(U3, `select public.update_custom_card($1, $2::jsonb) r`, [d1.r.id, JSON.stringify({ a: 'abc', b: 'def' })])).err === 'not_card_author')
ok('suppression par un autre refusée', (await call(U2, `select public.delete_custom_card($1) r`, [d1.r.id])).err === 'not_card_author')

// Masquage
ok('masquer réservé à l admin', (await call(U2, `select public.hide_custom_card($1, true) r`, [a1.r.id])).err === 'not_admin')
ok('admin masque', !(await call(U3, `select public.hide_custom_card($1, true) r`, [a1.r.id])).err)
// Le rôle de test est superuser : la RLS se vérifie via SET ROLE.
await db.query(`grant usage on schema public to authenticated`)
const rls = async (u) => {
  await as(u)
  await db.query(`set role authenticated`)
  try {
    return (await db.query(`select count(*)::int n from public.custom_cards where id = $1`, [a1.r.id])).rows[0].n
  } finally {
    await db.query(`reset role`)
  }
}
ok('carte masquée invisible pour les autres', (await rls(U2)) === 0)
ok('carte masquée visible pour son auteur', (await rls(U1)) === 1)
ok('carte masquée visible pour l admin', (await rls(U3)) === 1)
ok('admin ré-affiche', !(await call(U3, `select public.hide_custom_card($1, false) r`, [a1.r.id])).err)
ok('visible à nouveau pour tous', (await rls(U2)) === 1)

ok('admin supprime la carte d un autre', !(await call(U3, `select public.delete_custom_card($1) r`, [a1.r.id])).err)
ok('auteur supprime la sienne', !(await call(U1, `select public.delete_custom_card($1) r`, [d1.r.id])).err)
ok('suppression inconnue', (await call(U1, `select public.delete_custom_card($1) r`, [d1.r.id])).err === 'card_not_found')

// Moteurs : champ `by`
await as(U1)
const P = [A, B, C]
const startTp = async (o) => (await db.query(`select public.game_tu_preferes_start($1::uuid[], $2::jsonb) r`, [P, JSON.stringify(o)])).rows[0].r
const tp = await startTp({ rounds: 2, dilemmas: [{ id: 'cm1', a: 'x1', b: 'y1', by: A }, { id: 'tp1', a: 'x2', b: 'y2', theme: 'absurde' }] })
ok('tu-préfères : auteur conservé dans le state', tp.state.dilemma.by === A, JSON.stringify(tp.state.dilemma))
ok('tu-préfères : carte de base sans by', !('by' in tp.server.dilemmas[1]))
const tp3 = await startTp({ rounds: 1, dilemmas: [{ a: 'x3', b: 'y3', by: 'pas-un-uuid' }] })
ok('tu-préfères : by invalide ignoré', !('by' in tp3.server.dilemmas[0]))

const cards = []
for (let i = 0; i < 4; i++) {
  cards.push({ id: 'a' + i, kind: 'action', level: 1, text: 'Action ' + i, ...(i === 0 ? { by: B } : {}) })
  cards.push({ id: 'v' + i, kind: 'verite', level: 1, text: 'Vérité ' + i })
}
const aov = (await db.query(`select public.game_action_ou_verite_start($1::uuid[], $2::jsonb) r`, [P, JSON.stringify({ rounds: 5, cards })])).rows[0].r
ok('action ou vérité : auteur dans le pool', aov.server.pool.find((c) => c.id === 'a0').by === B && !('by' in aov.server.pool.find((c) => c.id === 'a1')))

const qdn = (await db.query(`select public.game_qui_de_nous_start($1::uuid[], $2::jsonb) r`, [P, JSON.stringify({ rounds: 3, questions: ['Qui de nous 1 ?', 'Qui de nous 2 ?', 'Qui de nous 3 ?'], authors: [null, B, 'zzz'] })])).rows[0].r
ok('qui de nous : 1re question de base', qdn.state.question_by === null, JSON.stringify(qdn.state))
ok('qui de nous : auteurs alignés', JSON.stringify(qdn.server.authors) === JSON.stringify([null, B, null]), JSON.stringify(qdn.server.authors))
let st = qdn
const act = async (who, host, action) =>
  (await db.query(`select public.game_qui_de_nous_action($1::jsonb, $2::jsonb, $3::uuid, $4, $5::jsonb) r`, [JSON.stringify(st.state), JSON.stringify(st.server), who, host, JSON.stringify(action)])).rows[0].r
for (const v of P) st = await act(v, v === A, { type: 'vote', target: P.find((p) => p !== v) })
st = await act(A, true, { type: 'next' })
ok('qui de nous : auteur de la 2e question', st.state.question_by === B && st.state.question === 'Qui de nous 2 ?', JSON.stringify(st.state))
const qold = (await db.query(`select public.game_qui_de_nous_start($1::uuid[], $2::jsonb) r`, [P, JSON.stringify({ rounds: 1, questions: ['Qui de nous ?'] })])).rows[0].r
ok('qui de nous : sans authors, ça marche', qold.state.question_by === null)

if (failed) process.exit(1)
console.log('Tout est OK')
process.exit(0)
