// Tests SQL de l'événement de Noël (missions, flocons, séries, pass, Grande Hotte) (PGlite) :
// node noel.mjs ../../supabase/install.sql
import { bootDb } from './boot.mjs'

const file = process.argv[2]
if (!file) throw new Error('usage : node noel.mjs <install.sql>')
const db = await bootDb(file)
let failed = false
const ok = (n, c, x = '') => {
  console.log(`${c ? 'OK   ' : 'ÉCHEC'} ${n}${c ? '' : ' ' + x}`)
  if (!c) failed = true
}
const uid = (i) => `aaaaaaaa-0000-0000-0000-0000000000${String(i).padStart(2, '0')}`
const prof = (await db.query(`select id from public.profiles where not is_guest order by sort_order limit 6`)).rows.map((r) => r.id)
const [A, B, C, D, E, F] = prof
for (let i = 0; i < 6; i++) await db.query(`insert into public.device_sessions(auth_uid, profile_id) values ($1, $2)`, [uid(i), prof[i]])
const call = async (u, q, p = []) => {
  await db.query(`select set_config('app.uid', $1, false)`, [u])
  try {
    return { r: (await db.query(q, p)).rows[0]?.r }
  } catch (e) {
    return { err: e.message }
  }
}
const one = async (q, p = []) => (await db.query(q, p)).rows[0]
const setNow = (iso) => db.query(`create or replace function public._season_now() returns timestamptz language sql stable as $$ select '${iso}'::timestamptz $$`)
const KEY = 'noel-2026'
const days = []
for (let t = Date.UTC(2026, 11, 1); t <= Date.UTC(2027, 0, 6); t += 86400000) days.push(new Date(t).toISOString().slice(0, 10))
const missions = async (day) => (await one(`select public._noel_missions($1, $2::date) r`, [KEY, day])).r
const done = async (p, m, day) => (await one(`select public._noel_mission_done($1, $2, $3::date) r`, [p, m, day])).r
const flakes = async (p) => (await one(`select public._noel_flakes($1, $2) r`, [p, KEY])).r
const prevDay = (day) => new Date(Date.parse(day) - 86400000).toISOString().slice(0, 10)
// Heure de Paris en décembre / janvier = UTC+1 : « 10:00 Paris » = 09:00Z.
const paris = (day, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  return new Date(Date.parse(day + 'T00:00:00Z') + ((h - 1) * 60 + m) * 60000).toISOString()
}

// ---- Fabriques de données
const daily = (p, day, score, fin = paris(day, '10:00')) =>
  db.query(`insert into public.daily_runs(profile_id, day, started_at, finished_at, score) values ($1, $2, $3::timestamptz - interval '2 minutes', $3, $4)
            on conflict (profile_id, day) do update set finished_at = excluded.finished_at, score = excluded.score`, [p, day, fin, score])
const hotte = (p, day, score, secs = 40, answers = 5) =>
  db.query(`insert into public.hotte_runs(profile_id, day, started_at, answers, score, last_answer_at, finished_at)
            values ($1, $2, $3::timestamptz, (select jsonb_agg(jsonb_build_object('round', g, 'answer', 'x', 'ok', true)) from generate_series(1, $5::int) g), $4, $3::timestamptz + make_interval(secs => $6), $3::timestamptz + make_interval(secs => $6))
            on conflict (profile_id, day) do nothing`, [p, day, paris(day, '10:00'), score, answers, secs])
const advent = (p, day) => db.query(`insert into public.advent_opens(profile_id, day, opened_at) values ($1, $2, $3) on conflict do nothing`, [p, day, paris(day, '10:00')])
const card = (p, day) => db.query(`insert into public.custom_cards(author_id, game_id, kind, payload, created_at) values ($1, 'tu-preferes', 'dilemma', '{"a":"x","b":"y"}', $2)`, [p, paris(day, '10:00')])
const challenge = (p, day) => db.query(`insert into public.coin_challenges(challenger_id, opponent_id, game_id, stake, created_at) values ($1, $2, 'morpion', 0, $3)`, [p, p === A ? B : A, paris(day, '10:00')])
let shopN = 0
const shop = async (p, day) => {
  const it = (await one(`select id from public.items i where not exists (select 1 from public.item_purchases x where x.profile_id = $1 and x.item_id = i.id) order by id offset $2 limit 1`, [p, shopN++ % 5])).id
  await db.query(`insert into public.item_purchases(profile_id, item_id, price, bought_at) values ($1, $2, 0, $3)`, [p, it, paris(day, '10:00')])
}
const sid = (await call(uid(0), `select public.create_soiree('{}') r`)).r.id
const match = async (players, day) => {
  const m = (await one(`insert into public.matches(soiree_id, game_id, status, finished_at) values ($1, 'morpion', 'finished', $2) returning id`, [sid, paris(day, '21:00')])).id
  for (const [i, p] of players.entries()) await db.query(`insert into public.match_players(match_id, profile_id, game_id, placement) values ($1, $2, 'morpion', $3)`, [m, p, i + 1])
}
// Réalise une mission donnée pour un joueur et un jour (et rien d'autre).
const satisfy = async (p, m, day, i = 0) => {
  if (m.startsWith('d_') || m === 's_d550') return daily(p, day, 600 + i)
  if (m.startsWith('h_')) return hotte(p, day, 5, 40)
  if (m === 's_advent') return advent(p, day)
  if (m === 's_card') return card(p, day)
  if (m === 's_challenge') return challenge(p, day)
  if (m === 's_shop') return shop(p, day)
  if (m === 's_combo') {
    await daily(p, day, 600 + i)
    return hotte(p, day, 5, 40)
  }
  throw new Error('mission inconnue ' + m)
}

// =============================================================================
// 1. Tirage des missions
// =============================================================================
{
  const all = []
  let shape = true
  let stable = true
  for (const day of days) {
    const ms = await missions(day)
    all.push(ms)
    if (!(ms.length === 3 && new Set(ms).size === 3 && ms[0].startsWith('d_') && ms[1].startsWith('h_') && ms[2].startsWith('s_'))) shape = false
    if (JSON.stringify(await missions(day)) !== JSON.stringify(ms)) stable = false
  }
  ok('tirage : 3 missions distinctes par jour, slots Défi / Hotte / Surprise', shape, JSON.stringify(all))
  ok('tirage : déterministe', stable)
  const surprise = all.map((m) => m[2])
  ok('s_advent jamais après le 24 décembre', surprise.every((s, i) => s !== 's_advent' || days[i] <= '2026-12-24'))
  const week = (day) => {
    const d = new Date(day + 'T12:00:00Z')
    const dow = (d.getUTCDay() + 6) % 7
    return new Date(d.getTime() - dow * 86400000).toISOString().slice(0, 10)
  }
  const perWeek = {}
  surprise.forEach((s, i) => {
    const k = week(days[i]) + s
    perWeek[k] = (perWeek[k] ?? 0) + 1
  })
  const over = Object.entries(perWeek).filter(([k, n]) => (k.endsWith('s_challenge') || k.endsWith('s_shop')) ? n > 1 : k.endsWith('s_card') ? n > 2 : false)
  ok('défi à un pote / boutique ≤ 1 par semaine, carte maison ≤ 2', over.length === 0, JSON.stringify(over))
  ok('jamais la même surprise deux jours de suite', surprise.every((s, i) => i === 0 || s !== surprise[i - 1]))
  ok('au moins 3 surprises différentes', new Set(surprise).size >= 3, [...new Set(surprise)].join(','))
  const fams = new Set(all.flat())
  ok('les 4 missions Défi et les 4 Hotte sortent au moins une fois', ['d_finish', 'd_400', 'd_beat', 'd_morning', 'h_play', 'h_3', 'h_4', 'h_fast'].every((m) => fams.has(m)), [...fams].join(','))
}

// =============================================================================
// 2. Vérification de chaque mission (joueur C, jours isolés)
// =============================================================================
{
  const T = '2026-12-10'
  const Y = prevDay(T)
  // Défi du jour
  await daily(C, T, 420, paris(T, '11:59'))
  ok('d_finish : fait le jour J, pas la veille', (await done(C, 'd_finish', T)) && !(await done(C, 'd_finish', Y)))
  ok('d_400 : 420 ≥ 400', await done(C, 'd_400', T))
  ok('s_d550 : 420 < 550', !(await done(C, 's_d550', T)))
  ok('d_morning : fini à 11:59 Paris', await done(C, 'd_morning', T))
  ok('d_beat : pas de défi la veille → un défi fini suffit', await done(C, 'd_beat', T))
  const T2 = '2026-12-12'
  await daily(D, prevDay(T2), 300)
  await daily(D, T2, 350, paris(T2, '12:01'))
  ok('d_beat : 350 > 300 hier', await done(D, 'd_beat', T2))
  ok('d_morning : fini à 12:01 Paris → non', !(await done(D, 'd_morning', T2)))
  ok('d_400 : 350 → non', !(await done(D, 'd_400', T2)))
  const T3 = '2026-12-14'
  await daily(E, prevDay(T3), 300)
  await daily(E, T3, 250)
  ok('d_beat : 250 < 300 hier → non', !(await done(E, 'd_beat', T3)))
  await daily(E, '2026-12-16', 560)
  ok('s_d550 : 560 ≥ 550', await done(E, 's_d550', '2026-12-16'))
  // Minuit à Paris
  await daily(F, '2026-12-05', 500, '2026-12-05T22:30:00Z')
  ok('minuit : défi fini à 23:30 Paris compte pour son jour, pas le lendemain', (await done(F, 'd_finish', '2026-12-05')) && !(await done(F, 'd_finish', '2026-12-06')))
  // Hotte
  await hotte(C, T, 3, 59)
  ok('h_play : Hotte finie', (await done(C, 'h_play', T)) && !(await done(C, 'h_play', Y)))
  ok('h_3 : 3/5', await done(C, 'h_3', T))
  ok('h_4 : 3/5 → non', !(await done(C, 'h_4', T)))
  ok('h_fast : 59 s', await done(C, 'h_fast', T))
  await hotte(D, T2, 4, 61)
  ok('h_4 : 4/5', await done(D, 'h_4', T2))
  ok('h_fast : 61 s → non', !(await done(D, 'h_fast', T2)))
  await hotte(E, T3, 5, 30, 3)
  ok('h_fast : essai clos sans 5 réponses → non', !(await done(E, 'h_fast', T3)))
  ok('s_combo : défi + Hotte', (await done(C, 's_combo', T)) && !(await done(E, 's_combo', '2026-12-16')))
  // Surprises
  await advent(C, T)
  ok('s_advent', (await done(C, 's_advent', T)) && !(await done(C, 's_advent', Y)))
  await card(C, T)
  ok('s_card', (await done(C, 's_card', T)) && !(await done(C, 's_card', Y)))
  await challenge(C, T)
  ok('s_challenge', (await done(C, 's_challenge', T)) && !(await done(C, 's_challenge', Y)))
  await shop(C, T)
  ok('s_shop', (await done(C, 's_shop', T)) && !(await done(C, 's_shop', Y)))
  // Bonus soirée
  await match([C, D], T)
  await match([E], T)
  const bonus = async (p, day) => (await one(`select public._noel_soiree_bonus($1, $2::date) r`, [p, day])).r
  ok('bonus soirée : partie à 2 finie le jour J', (await bonus(C, T)) && !(await bonus(C, Y)))
  ok('bonus soirée : partie seul → non', !(await bonus(E, T)))
}

// =============================================================================
// 3. Flocons et séries (joueur A : 8 jours parfaits du 1er au 8 déc, trou le 9, 2 jours ensuite)
// =============================================================================
await setNow('2026-12-11T20:00:00Z')
{
  for (const [i, day] of days.slice(0, 8).entries()) {
    for (const m of await missions(day)) await satisfy(A, m, day, i)
    await hotte(A, day, 5, 40)
  }
  await match([A, B], '2026-12-01')
  for (const day of ['2026-12-10', '2026-12-11']) for (const m of await missions(day)) await satisfy(A, m, day, 20)
  const f = await flakes(A)
  ok('jour parfait + soirée = 150 ❄️', f.by_day['2026-12-01'] === 150, JSON.stringify(f.by_day))
  ok('jour parfait sans soirée = 120 ❄️', f.by_day['2026-12-02'] === 120)
  ok('jour sans rien = 0', (f.by_day['2026-12-09'] ?? 0) === 0)
  ok('série : best 8, current 2', f.streak.best === 8 && f.streak.current === 2, JSON.stringify(f.streak))
  ok('bonus de série 3 + 7 jours = 100', f.streak_bonus === 100, String(f.streak_bonus))
  const sum = Object.values(f.by_day).reduce((a, b) => a + b, 0)
  ok('total = jours + bonus de série', f.total === sum + 100, `${f.total} vs ${sum}+100`)
  ok('jamais plus de 150 par jour', Object.values(f.by_day).every((n) => n <= 150))
  // Hotte 2/5 seule (joueur B, 3 déc)
  await hotte(B, '2026-12-03', 2, 200)
  const nDone = (await Promise.all((await missions('2026-12-03')).map((m) => done(B, m, '2026-12-03')))).filter(Boolean).length
  const fb = await flakes(B)
  ok('Hotte 2/5 = 12 ❄️ (+ missions éventuellement réussies)', fb.by_day['2026-12-03'] === 12 + 30 * nDone, `${fb.by_day['2026-12-03']} / missions ${nDone}`)
  // Le jour en cours sans mission ne casse pas la série
  await setNow('2026-12-12T09:00:00Z')
  ok('jour en cours pas encore joué : série intacte', (await flakes(A)).streak.current === 2)
  await setNow('2026-12-13T09:00:00Z')
  ok('jour raté (hier) : série remise à 0', (await flakes(A)).streak.current === 0)
  // Après l'édition : plus rien ne bouge
  await setNow('2027-01-06T22:00:00Z')
  const last = (await flakes(A)).total
  await daily(A, '2027-01-10', 650)
  await setNow('2027-01-20T12:00:00Z')
  ok('après le 6 janvier : total figé', (await flakes(A)).total === last)
  // Invité
  const tok = (await call(uid(0), `select public.open_guest_invites($1) r`, [sid])).r?.token
  const g = (await call(uid(10), `select public.join_as_guest($1, 'Léa', 'renard') r`, [tok])).r?.profile?.id
  if (g) await daily(g, '2026-12-05', 600)
  ok('invité : 0 ❄️', !!g && (await one(`select public._noel_flakes($1, $2) r`, [g, KEY])).r.total === 0)
}

console.log(failed ? '\nDES TESTS ONT ÉCHOUÉ' : '\nTous les tests passent')
process.exit(failed ? 1 : 0)
