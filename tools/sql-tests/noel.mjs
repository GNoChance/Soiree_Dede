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

// =============================================================================
// 4. Pass de Noël, Grande Hotte, récompenses, noel_state()
// =============================================================================
{
  const more = (await db.query(`select id from public.profiles where not is_guest order by sort_order offset 6 limit 3`)).rows.map((r) => r.id)
  const [G, H, I] = more
  for (const [i, p] of more.entries()) await db.query(`insert into public.device_sessions(auth_uid, profile_id) values ($1, $2)`, [uid(20 + i), p])
  const perfect = async (p, from, n) => {
    for (const [i, day] of days.slice(from, from + n).entries()) {
      for (const m of await missions(day)) await satisfy(p, m, day, 100 + from + i)
      await hotte(p, day, 5, 40)
    }
  }
  const claims = async (p, kind = 'pass') => (await db.query(`select tier, coins, item_id from public.noel_claims where profile_id = $1 and event_key = $2 and kind = $3 order by tier`, [p, KEY, kind])).rows
  const ledger = async (p, reason) => (await one(`select coalesce(sum(delta), 0)::int n from public.coin_ledger where profile_id = $1 and reason = $2`, [p, reason])).n
  const owns = async (p, item) => !!(await one(`select 1 x from public.profile_items where profile_id = $1 and item_id = $2`, [p, item]))
  const state = async (u) => call(u, `select public.noel_state() r`)
  await setNow('2026-12-31T20:00:00Z')

  // G : 11 jours parfaits = 1 320 + 100 de série = 1 420 ❄️ -> palier 9
  await perfect(G, 0, 11)
  ok('G : 1 420 ❄️', (await flakes(G)).total === 1420, String((await flakes(G)).total))
  const sg = await state(uid(20))
  ok('noel_state : live, palier 9', !sg.err && sg.r.phase === 'live' && sg.r.tier === 9 && sg.r.flakes === 1420 && sg.r.next_at === 1500, sg.err ?? JSON.stringify({ ...sg.r, band: undefined }))
  const cg = await claims(G)
  ok('paliers 1..9 attribués', cg.map((c) => c.tier).join(',') === '1,2,3,4,5,6,7,8,9', JSON.stringify(cg))
  ok('pièces des paliers 1..9 = 240', (await ledger(G, 'event_pass')) === 240, String(await ledger(G, 'event_pass')))
  ok('objets des paliers 3, 6, 9', (await owns(G, 't_lutin_chef')) && (await owns(G, 'cb_papier_cadeau')) && (await owns(G, 'd_sucre_orge')))
  ok('new_claims renvoyés une seule fois', sg.r?.new_claims.filter((c) => c.kind === 'pass').length === 9 && (await state(uid(20))).r.new_claims.length === 0)
  // Palier 10 (effet, lot 2) pas prêt : sauté, le 11 est attribué
  await perfect(G, 11, 2)
  await state(uid(20))
  const cg2 = (await claims(G)).map((c) => c.tier)
  ok('palier 10 pas prêt : non attribué, 11 attribué', !cg2.includes(10) && cg2.includes(11), cg2.join(','))
  // Idempotence
  const before = [await ledger(G, 'event_pass'), (await claims(G)).length]
  await state(uid(20))
  await one(`select public._noel_claim($1, $2) r`, [G, KEY])
  ok('aucune récompense en double', JSON.stringify([await ledger(G, 'event_pass'), (await claims(G)).length]) === JSON.stringify(before))

  // H : objet déjà possédé -> 100 pièces à la place
  await db.query(`insert into public.profile_items(profile_id, item_id) values ($1, 'cb_papier_cadeau') on conflict do nothing`, [H])
  await perfect(H, 0, 8)
  const sh = await state(uid(21))
  const c6 = sh.r?.new_claims.find((c) => c.kind === 'pass' && c.tier === 6)
  ok('déjà possédé : compensé par 100 pièces', c6?.compensated === true && c6.coins === 100 && c6.item_id === null, JSON.stringify(c6))

  // Grande Hotte : vrai total = somme des membres hors invités
  const members = (await db.query(`select id from public.profiles where not is_guest`)).rows.map((r) => r.id)
  let sum = 0
  for (const p of members) sum += (await flakes(p)).total
  const band = (await one(`select public._noel_band($1) r`, [KEY])).r
  ok('Grande Hotte : total = somme des membres', band.total === sum, `${band.total} vs ${sum}`)
  ok('contributeurs : triés, sans les membres à 0', band.contributors.every((c, i, a) => c.flakes > 0 && (i === 0 || a[i - 1].flakes >= c.flakes)) && !band.contributors.some((c) => c.profile_id === I), JSON.stringify(band.contributors))
  ok('paliers collectifs', JSON.stringify(await Promise.all([0, 5999, 6000, 14000, 22000, 38000, 99999].map(async (t) => (await one(`select public._noel_band_tier($1) r`, [t])).r))) === '[0,0,1,2,3,5,5]')

  // Total simulé à 22 000 : paliers 1 et 3 pour les éligibles (≥ 400 ❄️), le 2 pas prêt
  await db.query(`create or replace function public._noel_band_total(p_key text) returns integer language sql stable as $$ select 22000 $$`)
  await state(uid(20))
  const bg = (await claims(G, 'band')).map((c) => c.tier).join(',')
  ok('éligible : paliers collectifs 1 et 3 (2 pas prêt)', bg === '1,3' && (await ledger(G, 'event_band')) === 100 && (await owns(G, 'f_noel_aurore')), bg)
  // I : 3 jours parfaits = 390 ❄️ -> pas éligible, puis 402 -> rattrapage
  await perfect(I, 20, 3)
  const si = await state(uid(22))
  ok('I à 390 ❄️ : non éligible, rien reçu', si.r?.flakes === 390 && si.r.band.eligible === false && (await claims(I, 'band')).length === 0, JSON.stringify(si.r?.band ?? si.err))
  await hotte(I, days[23], 2, 100)
  const si2 = await state(uid(22))
  ok('I à 402 ❄️ : éligible, paliers déjà atteints rattrapés', si2.r?.flakes === 402 && si2.r.band.eligible && (await claims(I, 'band')).map((c) => c.tier).join(',') === '1,3', JSON.stringify(si2.r?.band))
  await db.query(`create or replace function public._noel_band_total(p_key text) returns integer language sql stable as $$ select 30000 $$`)
  await state(uid(20))
  ok('palier collectif 4 : 250 pièces + titre', (await ledger(G, 'event_band')) === 350 && (await owns(G, 't_bande_noel')))

  // Phases
  await setNow('2026-11-30T12:00:00Z')
  const pb = await state(uid(20))
  ok('30 nov : before, aucune récompense', pb.r?.phase === 'before' && pb.r.new_claims.length === 0 && pb.r.missions.length === 0, JSON.stringify(pb.r ?? pb.err))
  await setNow('2026-12-10T12:00:00Z')
  const pl = await state(uid(20))
  ok('10 déc : live, 3 missions du jour', pl.r?.phase === 'live' && pl.r.missions.length === 3 && pl.r.day === '2026-12-10' && typeof pl.r.missions[0].done === 'boolean' && ['todo', 'running', 'done'].includes(pl.r.hotte.status), JSON.stringify(pl.r ?? pl.err))
  await setNow('2027-01-10T12:00:00Z')
  const po = await state(uid(20))
  ok('10 janv : over, pass conservé, plus de missions', po.r?.phase === 'over' && po.r.key === KEY && po.r.missions.length === 0 && po.r.tier >= 11, JSON.stringify(po.r ?? po.err))
  await setNow('2027-01-14T12:00:00Z')
  ok('14 janv : off', (await state(uid(20))).r?.phase === 'off')
  ok('invité : refusé', (await state(uid(10))).err === 'guest_forbidden')
}

// =============================================================================
// 5. Rappel push de 18 h : série de Noël pendant l'événement
// =============================================================================
{
  await db.query(`insert into public.push_subscriptions(profile_id, endpoint, p256dh, auth) values ($1, 'https://push.test/a', 'k', 'a')`, [A])
  await setNow('2026-12-02T17:00:00Z')
  const dec = (await one(`select public.push_test_targets((select slug from public.profiles where id = $1)) r`, [A])).r
  ok('rappel en décembre : noel_streak numérique', dec.length === 1 && typeof dec[0].noel_streak === 'number', JSON.stringify(dec))
  const tgt = (await one(`select public.push_daily_reminder_targets(false) r`)).r
  ok('cibles du rappel : champ noel_streak présent', tgt.every((t) => 'noel_streak' in t), JSON.stringify(tgt))
  await setNow('2026-11-20T17:00:00Z')
  const nov = (await one(`select public.push_test_targets((select slug from public.profiles where id = $1)) r`, [A])).r
  ok('rappel en novembre : noel_streak null', nov.length === 1 && nov[0].noel_streak === null, JSON.stringify(nov))
}

console.log(failed ? '\nDES TESTS ONT ÉCHOUÉ' : '\nTous les tests passent')
process.exit(failed ? 1 : 0)
