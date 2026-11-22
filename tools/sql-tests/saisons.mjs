// Tests SQL des saisons de boutique (PGlite) : node saisons.mjs ../../supabase/install.sql
import { bootDb } from './boot.mjs'

const file = process.argv[2]
if (!file) throw new Error('usage : node saisons.mjs <install.sql>')
const db = await bootDb(file)
let failed = false
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK   ' : 'ÉCHEC'} ${name}${cond ? '' : ' ' + extra}`)
  if (!cond) failed = true
}
const U = 'aaaaaaaa-0000-0000-0000-000000000001'
const U2 = 'aaaaaaaa-0000-0000-0000-000000000009'
const profs = (await db.query(`select id from public.profiles order by sort_order limit 3`)).rows.map((r) => r.id)
const A = profs[0]
const B = profs[1]
await db.query(`insert into public.device_sessions(auth_uid, profile_id) values ($1, $2)`, [U, A])
const call = async (q, p = []) => {
  await db.query(`select set_config('app.uid', $1, false)`, [U])
  try { return { r: (await db.query(q, p)).rows[0]?.r } } catch (e) { return { err: e.message } }
}
const setNow = (iso) => db.query(`create or replace function public._season_now() returns timestamptz language sql stable as $$ select '${iso}'::timestamptz $$`)
const state = async () => (await call(`select public.shop_state() r`)).r
const sync = async () => (await call(`select public.season_sync() r`)).r
const buy = (id) => call(`select public.buy_item($1) r`, [id])
const coins = async () => (await state()).coins
const season = async (iso) => (await db.query(`select * from public._season_at('${iso}'::timestamptz)`)).rows[0]

// ---- _season_at
ok('30 nov. 2026 : pas de saison', !(await season('2026-11-30T12:00:00+01')))
ok('30 nov. 2026 23:59 Paris : pas de saison', !(await season('2026-11-30T23:59:59+01')))
let s = await season('2026-12-01T00:00:00+01')
ok('1er déc. 2026 00:00 Paris : hiver-2026', s?.season_key === 'hiver-2026', JSON.stringify(s))
ok('31 déc. : hiver-2026', (await season('2026-12-31T12:00:00+01')).season_key === 'hiver-2026')
s = await season('2027-01-01T12:00:00+01')
ok('1er janv. 2027 : hiver-2026', s.season_key === 'hiver-2026')
ok('hiver 2026 finit le 28 fév. 2027', new Date(s.ends_on).getDate() === 28 && new Date(s.ends_on).getMonth() === 1)
ok('28 fév. 2027 23:59 Paris : hiver-2026', (await season('2027-02-28T23:59:59+01')).season_key === 'hiver-2026')
ok('1er mars 2027 00:00 Paris : printemps-2027', (await season('2027-03-01T00:00:00+01')).season_key === 'printemps-2027')
s = await season('2028-02-29T12:00:00+01')
ok('29 fév. 2028 : hiver-2027, fin le 29', s.season_key === 'hiver-2027' && new Date(s.ends_on).getDate() === 29, JSON.stringify(s))
ok('été et automne', (await season('2027-07-14T12:00:00+02')).season_key === 'ete-2027' && (await season('2027-10-01T12:00:00+02')).season_key === 'automne-2027')

// ---- catalogue
const n = Number((await db.query(`select count(*) c from public.items where season is not null`)).rows[0].c)
const nColl = Number((await db.query(`select count(*) c from public.items where season is not null and pass_tier is null and price is not null`)).rows[0].c)
ok('52 articles de saison dont 36 en collection', n === 52 && nColl === 36, `${n}/${nColl}`)

// ---- avant le lancement : pas de saison
await setNow('2026-11-22T12:00:00+01')
let st = await state()
ok('avant lancement : season null, vitrine de 6', st.season === null && st.season_items.length === 0 && st.items.length === 6, JSON.stringify(st))
ok('avant lancement : season_sync sans saison', (await sync()).season === null)

// ---- en saison : collection visible, vitrine sans article de saison
await setNow('2026-12-10T12:00:00+01')
st = await state()
ok('hiver : 9 articles de collection', st.season === 'hiver' && st.season_items.length === 9, JSON.stringify(st.season_items))
const prices = Object.fromEntries((await db.query(`select id, price from public.items`)).rows.map((r) => [r.id, r.price]))
ok('collection triée par prix', st.season_items.every((id, i, a) => i === 0 || prices[a[i - 1]] <= prices[id]))
ok('collection : 3×100, 4×250, 2×500', [100, 250, 500].map((p) => st.season_items.filter((i) => prices[i] === p).length).join() === '3,4,2')
ok('vitrine hebdo : 6 articles, aucun article de saison', st.items.length === 6 && !st.items.some((i) => st.season_items.includes(i)))
const withSeason = Number((await db.query(`select count(*) c from public.items i where i.id = any($1) and i.season is not null`, [st.items])).rows[0].c)
ok('vitrine : tous permanents', withSeason === 0)
ok('exclusif du passe : jamais en collection', !st.season_items.includes('bb_bucheron') && !st.season_items.includes('t_yeti'))

// ---- achat
ok('achat sans pièces refusé', (await buy('t_raclette')).err?.includes('shop_not_enough_coins'))
await db.query(`insert into public.coin_ledger(profile_id, delta, reason, ref) values ($1, 1000, 'test', 'x')`, [A])
const b1 = await buy('t_raclette')
ok('achat article de saison', b1.r?.item === 't_raclette' && b1.r.coins === 900, JSON.stringify(b1))
ok('déjà possédé', (await buy('t_raclette')).err?.includes('item_already_owned'))
st = await state()
ok('season_owned', st.season_owned.length === 1 && st.season_owned[0] === 't_raclette')
ok('exclusif du passe non achetable', (await buy('bb_bucheron')).err?.includes('shop_not_available'))
ok('article d’une autre saison refusé', (await buy('t_poisson_avril')).err?.includes('shop_not_available'))
await setNow('2027-03-02T12:00:00+01')
ok('hors saison : refusé', (await buy('t_tout_schuss')).err?.includes('shop_not_available'))
ok('la nouvelle saison est le printemps', (await state()).season === 'printemps')
ok('l’article reste équipable', !(await call(`select public.equip_item('title', 't_raclette') r`)).err)
await setNow('2026-12-10T12:00:00+01')

// ---- points : parties, défis, soirées
const so = (await db.query(`insert into public.soirees(code, host_id, status) values ('SAIS', $1, 'ended') returning id`, [A])).rows[0].id
const so2 = (await db.query(`insert into public.soirees(code, host_id, status) values ('SAI2', $1, 'ended') returning id`, [A])).rows[0].id
const game = async (soiree, at, won, withB = true) => {
  const m = (await db.query(`insert into public.matches(soiree_id, game_id, status, created_at, finished_at) values ($1, 'morpion', 'finished', $2, $2) returning id`, [soiree, at])).rows[0].id
  await db.query(`insert into public.match_players(match_id, profile_id, game_id, placement, won) values ($1, $2, 'morpion', 1, $3)`, [m, A, won])
  if (withB) await db.query(`insert into public.match_players(match_id, profile_id, game_id, placement, won) values ($1, $2, 'morpion', 2, false)`, [m, B])
}
const pts = async (key = 'hiver-2026') => Number((await db.query(`select public._season_points($1, $2) r`, [A, key])).rows[0].r)
await game(so, '2026-11-30T22:00:00Z', true) // 30 nov. 23:00 Paris : veille, ne compte pas
await game(so, '2027-03-01T00:30:00+01', true) // lendemain de la fin : ne compte pas
ok('événements hors fenêtre : 0 point', (await pts()) === 0, String(await pts()))
await game(so, '2026-12-05T20:00:00+01', false)
ok('1 partie à 2 : 10 + soirée 25 = 35', (await pts()) === 35, String(await pts()))
await game(so, '2026-12-05T20:30:00+01', true)
ok('victoire : +20, soirée une seule fois = 55', (await pts()) === 55, String(await pts()))
await game(so2, '2026-12-06T20:30:00+01', false, false)
ok('solo (1 humain) : 10, pas de bonus soirée = 65', (await pts()) === 65, String(await pts()))
await db.query(`insert into public.daily_runs(profile_id, day, finished_at) values ($1, '2026-12-07', '2026-12-07T10:00:00+01')`, [A])
await db.query(`insert into public.daily_runs(profile_id, day, finished_at) values ($1, '2026-11-20', '2026-11-20T10:00:00+01')`, [A])
await db.query(`insert into public.daily_runs(profile_id, day) values ($1, '2026-12-08')`, [A])
ok('défi du jour terminé +15 (hors fenêtre / non terminé exclus) = 80', (await pts()) === 80, String(await pts()))

// ---- season_sync : paliers
const c0 = await coins()
let r = await sync()
ok('sync : points 80, palier 2', r.points === 80 && r.tier === 2 && r.season_key === 'hiver-2026', JSON.stringify(r))
ok('sync : 2 paliers de 20 pièces', r.new_claims.length === 2 && r.new_claims.every((c) => c.coins === 20), JSON.stringify(r.new_claims))
ok('_coins +40', (await coins()) === c0 + 40, `${await coins()} vs ${c0}`)
r = await sync()
ok('sync idempotent', r.new_claims.length === 0 && (await coins()) === c0 + 40)
const ledger = Number((await db.query(`select count(*) c from public.coin_ledger where reason = 'season_pass'`)).rows[0].c)
ok('2 lignes de registre', ledger === 2, String(ledger))

// saut de plusieurs paliers : +720 points => 800 = palier 20 d'un coup
await db.query(`insert into public.daily_runs(profile_id, day, finished_at)
  select $1, ('2026-12-10'::date + g), '2026-12-20T10:00:00+01' from generate_series(1, 48) g`, [A])
r = await sync()
ok('saut : points 800, palier 20', r.points === 800 && r.tier === 20, JSON.stringify([r.points, r.tier]))
ok('saut : 18 nouveaux paliers', r.new_claims.length === 18, String(r.new_claims.length))
const gotItems = r.new_claims.filter((c) => c.item_id).map((c) => c.item_id).sort().join()
ok('cosmétiques exclusifs 5/10/15/20', gotItems === 'bb_bucheron,cb_chalet,f_forfait,t_yeti', gotItems)
const gain = r.new_claims.reduce((a, c) => a + c.coins, 0)
ok('total passe = 620 pièces', gain + 40 === 620, String(gain + 40))
ok('exclusifs possédés', Number((await db.query(`select count(*) c from public.profile_items where profile_id = $1 and item_id in ('bb_bucheron','f_forfait','cb_chalet','t_yeti')`, [A])).rows[0].c) === 4)
r = await sync()
ok('passe terminé : plus rien', r.new_claims.length === 0 && r.tier === 20)

// ---- rattrapage de la saison précédente + modale de fin
await setNow('2027-03-05T12:00:00+01')
r = await sync()
ok('nouvelle saison : repart de zéro (seule la victoire du 1er mars compte : 45)', r.season === 'printemps' && r.points === 45 && r.tier === 1, JSON.stringify(r))
ok('ended renvoyé', r.ended?.season === 'hiver' && r.ended.tier === 20 && r.ended.coins_total === 620 && r.ended.collection_owned === 1, JSON.stringify(r.ended))

// ---- rattrapage : paliers gagnés en fin de saison, appli rouverte après la fin
await db.query(`delete from public.season_pass_claims where season_key = 'hiver-2026' and tier > 2`)
r = await sync()
ok('rattrapage de la saison précédente après la fin', r.new_claims.length >= 17 && r.new_claims.every((c) => c.season_key === 'hiver-2026'), String(r.new_claims.length))

// ---- compensation : retour l'année suivante, exclusifs déjà possédés
await setNow('2027-12-10T12:00:00+01')
await db.query(`insert into public.daily_runs(profile_id, day, finished_at)
  select $1, ('2027-12-01'::date + g), '2027-12-15T10:00:00+01' from generate_series(0, 53) g`, [A])
const before = await coins()
r = await sync()
const t5 = r.new_claims.find((c) => c.tier === 5 && c.season_key === 'hiver-2026')
ok('hiver-2026 (rattrapage 2e année) hors périmètre : pas de nouveau claim', !t5)
const k27 = r.new_claims.filter((c) => c.season_key === 'hiver-2027')
const c5 = k27.find((c) => c.tier === 5)
const c20 = k27.find((c) => c.tier === 20)
ok('hiver 2027 : palier 5 déjà possédé = 100 pièces', c5?.item_id === null && c5.coins === 100 && c5.compensated, JSON.stringify(c5))
ok('hiver 2027 : palier 20, titre déjà possédé = 150 pièces', c20?.item_id === null && c20.coins === 150, JSON.stringify(c20))
const expected = r.new_claims.reduce((a, c) => a + c.coins, 0)
ok('_coins augmente du bon montant', (await coins()) === before + expected, `${await coins()} vs ${before + expected}`)

// ---- invité exclu
await setNow('2026-12-10T12:00:00+01')
const G = (await db.query(`insert into public.profiles(slug, first_name, nickname, is_guest, guest_expires_at, sort_order) values ('g-test-aaaaaa', 'Invité', 'Invité', true, now() + interval '1 day', 999) returning id`)).rows[0].id
await db.query(`insert into public.device_sessions(auth_uid, profile_id) values ($1, $2)`, [U2, G])
await db.query(`insert into public.daily_runs(profile_id, day, finished_at) select $1, ('2026-12-10'::date + g), '2026-12-20T10:00:00+01' from generate_series(1, 50) g`, [G])
await db.query(`select set_config('app.uid', $1, false)`, [U2])
let gr
try { gr = (await db.query(`select public.season_sync() r`)).rows[0].r } catch (e) { gr = { err: e.message } }
ok('invité : pas de passe', gr.season === null && gr.new_claims?.length === 0, JSON.stringify(gr))
ok('invité : 0 point', Number((await db.query(`select public._season_points($1, 'hiver-2026') r`, [G])).rows[0].r) === 0)
process.exit(failed ? 1 : 0)
