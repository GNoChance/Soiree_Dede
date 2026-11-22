// Tests SQL de la boutique (PGlite) : node boutique.mjs ../../supabase/install.sql
import { bootDb } from './boot.mjs'

const file = process.argv[2]
if (!file) throw new Error('usage : node boutique.mjs <install.sql>')
const db = await bootDb(file)
let failed = false
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK   ' : 'ÉCHEC'} ${name}${cond ? '' : ' ' + extra}`)
  if (!cond) failed = true
}
const U = 'aaaaaaaa-0000-0000-0000-000000000001'
const A = (await db.query(`select id from public.profiles order by sort_order limit 1`)).rows[0].id
await db.query(`insert into public.device_sessions(auth_uid, profile_id) values ($1, $2)`, [U, A])
const call = async (q, p = []) => {
  await db.query(`select set_config('app.uid', $1, false)`, [U])
  try { return { r: (await db.query(q, p)).rows[0]?.r } } catch (e) { return { err: e.message } }
}
const state = async () => (await call(`select public.shop_state() r`)).r
const buy = (id) => call(`select public.buy_item($1) r`, [id])

const n = Number((await db.query(`select count(*) c from public.items where price is not null`)).rows[0].c)
ok('catalogue boutique : 38 articles', n === 38, String(n))
const s0 = await state()
ok('vitrine de 6 articles, 0 pièce', s0.items.length === 6 && s0.coins === 0, JSON.stringify(s0))
ok('pas assez de pièces', (await buy(s0.items[0])).err?.includes('shop_not_enough_coins'))

// 20 parties dont 10 victoires = 20*5 + 10*15 = 250 ; + 1 trophée (20) = 270
const so = (await db.query(`insert into public.soirees(code, host_id, status) values ('ZZZZ', $1, 'ended') returning id`, [A])).rows[0].id
for (let i = 0; i < 20; i++) {
  const m = (await db.query(`insert into public.matches(soiree_id, game_id, status, finished_at) values ($1, 'morpion', 'finished', now()) returning id`, [so])).rows[0].id
  await db.query(`insert into public.match_players(match_id, profile_id, game_id, placement, won) values ($1, $2, 'morpion', 1, $3)`, [m, A, i < 10])
}
await db.query(`insert into public.trophy_unlocks(profile_id, trophy_id) values ($1, 'gen_pipelette')`, [A])
const s1 = await state()
ok('solde = 270', s1.coins === 270, String(s1.coins))

const prices = Object.fromEntries((await db.query(`select id, price from public.items where price is not null`)).rows.map((r) => [r.id, r.price]))
const cheap = s1.items.find((id) => prices[id] <= 270)
if (cheap) {
  const b = await buy(cheap)
  ok('achat', b.r?.item === cheap && b.r.coins === 270 - prices[cheap], JSON.stringify(b))
  ok('déjà possédé', (await buy(cheap)).err?.includes('item_already_owned'))
  const s2 = await state()
  ok('vitrine stable dans la semaine (article acheté toujours affiché)', s2.items.includes(cheap) && s2.owned.includes(cheap), JSON.stringify(s2))
  const eq = await call(`select public.equip_item((select slot from public.items where id = $1), $1) r`, [cheap])
  ok('équiper l’article acheté', !eq.err, JSON.stringify(eq))
} else ok('un article abordable en vitrine', false, JSON.stringify(s1.items.map((i) => prices[i])))
const outside = Object.keys(prices).find((id) => !s1.items.includes(id))
ok('hors vitrine : refusé', (await buy(outside)).err?.includes('shop_not_available'))
ok('cadeau gagné non achetable', (await buy('f_bronze')).err?.includes('shop_not_available'))

// semaine suivante : l'article acheté sort de la vitrine
await db.query(`create or replace function public._week_start_now() returns date language sql stable as $$ select (date_trunc('week', now())::date + 7) $$`)
const s3 = await state()
ok('semaine suivante : vitrine de 6 sans l’article déjà possédé', s3.items.length === 6 && (!cheap || !s3.items.includes(cheap)), JSON.stringify(s3.items))
process.exit(failed ? 1 : 0)
