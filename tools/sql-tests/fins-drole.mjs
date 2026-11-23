// Moments de fin de partie : cerveau-en-fete (mauvaises réponses), undercover (vote_log), petit-bac (longest/hot).
// Usage : node tools/sql-tests/fins-drole.mjs supabase/install.sql
import { bootDb } from './boot.mjs'
const db = await bootDb(process.argv[2])
let fails = 0
const ok = (c, m) => {
  if (!c) {
    fails++
    console.log('FAIL', m)
  } else console.log('ok  ', m)
}
const ids = (await db.query(`select id from public.profiles order by sort_order limit 4`)).rows.map((r) => r.id)
const [A, B, C, D] = ids
const q = async (sql, params) => (await db.query(sql, params)).rows[0].r
const past = (st) => ({ ...st, deadline: new Date(Date.now() - 1000).toISOString() })

// ---------- cerveau-en-fete ----------
{
  const qs = [{ id: 'q1', theme: 't', difficulty: 1, prompt: 'Capitale ?', answer: 'Paris', accept: ['paris'], mode: 'typed' }]
  const g = await q(`select public.game_cerveau_en_fete_start($1::uuid[], $2::jsonb) r`, [`{${A},${B},${C}}`, JSON.stringify({ duration: 60, questions: qs })])
  let { state, server } = g
  const act = async (actor, action) => {
    const r = await q(`select public.game_cerveau_en_fete_action($1::jsonb,$2::jsonb,$3::uuid,false,$4::jsonb) r`, [JSON.stringify(state), JSON.stringify(server), actor, JSON.stringify(action)])
    state = r.state
    server = r.server
  }
  for (const t of ['Londres', 'Napoléon', 'Marseille-sur-un-nom-vraiment-trop-long-pour-tenir']) await act(B, { type: 'answer', text: t })
  ok(server.wrong?.[B]?.length === 2 && server.wrong[B][0] === 'Napoléon', 'cef: 2 dernières mauvaises propositions gardées (' + JSON.stringify(server.wrong?.[B]) + ')')
  ok(server.wrong[B][1].length === 30, 'cef: proposition tronquée à 30 caractères')
  ok(!state.last_reveal && JSON.stringify(state).indexOf('Napoléon') === -1, 'cef: rien de publié pendant la question')
  await act(A, { type: 'answer', text: 'Paris' })
  state = past(state)
  await act(C, { type: 'tick' })
  ok(state.phase === 'reveal' && state.last_reveal.wrong?.[B]?.[0] === 'Napoléon', 'cef: wrong publié à la révélation')
  ok(state.history[0].wrong?.[B]?.length === 2, 'cef: wrong gardé dans history')
  ok(state.history[0].found.length === 1 && state.last_reveal.tries[B] === 3, 'cef: found et tries inchangés')
}

// ---------- undercover ----------
{
  const st = { players: [A, B, C, D], alive: [A, B], eliminated: [{ profile_id: C, role: 'civil', round: 1 }] }
  const roles = { [A]: 'civil', [B]: 'civil', [C]: 'civil', [D]: 'undercover' }
  const log = [{ [A]: C, [B]: C, [D]: C }]
  const r = await q(`select public._uc_finish($1::jsonb,$2::jsonb,'infiltres') r`, [JSON.stringify(st), JSON.stringify({ roles, civil_word: 'a', undercover_word: 'b', vote_log: log })])
  ok(r.state.vote_log.length === 1 && r.state.vote_log[0][A] === C && r.state.vote_log[0][D] === C, 'uc: vote_log exposé en fin de partie')
  const r2 = await q(`select public._uc_finish($1::jsonb,$2::jsonb,'infiltres') r`, [JSON.stringify(st), JSON.stringify({ roles, civil_word: 'a', undercover_word: 'b' })])
  ok(Array.isArray(r2.state.vote_log) && r2.state.vote_log.length === 0, 'uc: sans journal -> tableau vide')
}

// ---------- petit-bac ----------
{
  const cat = { id: 'animal', label: 'Animal', emoji: '🐶' }
  const ans = (text, norm) => ({ text, norm, auto: null })
  const st = {
    players: [A, B], categories: [cat], round: 1, letter: 'E', scores: { [A]: 0, [B]: 0 }, uniques: { [A]: 0, [B]: 0 }, history: [],
    validation: { cat_index: 0, answers: { animal: { [A]: ans('Éléphant', 'elephant'), [B]: ans('Ezard', 'ezard') } }, contests: { animal: { [B]: [A] } } },
  }
  const r = await q(`select public._pb_score($1::jsonb,$2::jsonb) r`, [JSON.stringify(st), '{}'])
  const h = r.state.history[0]
  ok(h.longest?.pl === A && h.longest.text === 'Éléphant' && h.longest.cat === 'animal', 'pb: mot valide le plus long')
  ok(h.hot?.pl === B && h.hot.contests === 1 && h.hot.text === 'Ezard', 'pb: réponse la plus contestée')
  ok(h.points && h.det, 'pb: points et det toujours là')
  st.validation.contests = {}
  const r2 = await q(`select public._pb_score($1::jsonb,$2::jsonb) r`, [JSON.stringify(st), '{}'])
  ok(r2.state.history[0].hot === null, 'pb: pas de contestation -> hot null')
}
console.log(fails ? `${fails} ECHEC(S)` : 'TOUT OK')
process.exit(fails ? 1 : 0)
