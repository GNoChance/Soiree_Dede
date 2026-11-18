// Tests SQL des pronostics (PGlite) : node pronos.mjs ../../supabase/install.sql
// Charge install.sql deux fois (idempotence) puis déroule des scénarios ; sort en code 1 au premier échec.
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import fs from 'node:fs'

const file = process.argv[2]
if (!file) throw new Error('usage : node pronos.mjs <install.sql>')
const sql = fs.readFileSync(file, 'utf8')

const db = new PGlite({ extensions: { pgcrypto } })
await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
create schema net;
create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
returns bigint language sql as $$ select 1::bigint $$;`)
// install.sql est découpé par fichier source ; un fichier qui dépend d'une colonne ajoutée plus loin
// (cas d'une base neuve : daily.sql lit profiles.equipped_tenue, créée par tenues.sql) est rejoué à la 2e passe.
const parts = sql
  .split('\n-- ===== ')
  .slice(1)
  .map((p) => ({ name: p.slice(0, p.indexOf(' =====')), body: p.slice(p.indexOf('\n') + 1) }))
let pending = parts
for (let pass = 1; pass <= 3 && pending.length; pass++) {
  const next = []
  for (const part of pending) {
    try {
      await db.exec(part.body)
    } catch (e) {
      if (pass === 3) {
        console.log('ÉCHEC install.sql (' + part.name + ') :', e.message)
        process.exit(1)
      }
      next.push(part)
    }
  }
  pending = next
}
for (const part of parts) {
  try {
    await db.exec(part.body)
  } catch (e) {
    console.log('ÉCHEC idempotence (' + part.name + ') :', e.message)
    process.exit(1)
  }
}

let failed = false
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK   ' : 'ÉCHEC'} ${name}${cond ? '' : ' ' + extra}`)
  if (!cond) failed = true
}

const U = [1, 2, 3, 4, 5].map((i) => `aaaaaaaa-0000-0000-0000-00000000000${i}`)
const prof = (await db.query(`select id, nickname from public.profiles order by sort_order limit 5`)).rows
for (let i = 0; i < 5; i++) await db.query(`insert into public.device_sessions(auth_uid, profile_id) values ($1, $2)`, [U[i], prof[i].id])
const [A, B, C, D, E] = prof.map((p) => p.id)
const as = (i) => db.query(`select set_config('app.uid', $1, false)`, [U[i]])
/** Appelle une requête comme le joueur i ; renvoie {r} (1re ligne) ou {err}. */
const call = async (i, q, p = []) => {
  await as(i)
  try {
    return { r: (await db.query(q, p)).rows[0] }
  } catch (e) {
    return { err: e.message }
  }
}
const sys = async (q, p = []) => (await db.query(q, p)).rows
const arr = (ids) => `{${ids.join(',')}}`

// Soirée : hôte A, joueurs B, C, D ; E est un profil extérieur.
await as(0)
const soiree = (await call(0, `select public.create_soiree($1::uuid[]) r`, [arr([B, C, D])])).r.r.id
const open = (i, game, ids) => call(i, `select public.open_pronos($1, $2, $3::uuid[]) r`, [soiree, game, arr(ids)])
const bet = (i, pick) => call(i, `select public.set_prono($1, $2)`, [soiree, pick])
const openCount = async () => Number((await sys(`select count(*)::int c from public.soiree_pronos where soiree_id = $1 and match_id is null`, [soiree]))[0].c)
const QDN = { questions: ['Q1', 'Q2'], rounds: 1 }
const start = (players = [A, B, C]) =>
  call(0, `select public.start_match($1, 'qui-de-nous', $2::jsonb) id`, [soiree, JSON.stringify({ ...QDN, player_ids: players })])
const finish = async (matchId, winners, players = [A, B, C]) =>
  (await db.query(`select public.finish_match($1, $2::jsonb) r`, [
    matchId,
    JSON.stringify(players.map((p, i) => ({ profile_id: p, points: winners.includes(p) ? 3 : 0, won: winners.includes(p), placement: winners.includes(p) ? 1 : 2 + i })))
  ])).rows[0].r

// --- ouverture -------------------------------------------------------------
ok('set_prono avant toute ouverture → pronos_closed', (await bet(1, A)).err?.includes('pronos_closed'))
ok('open_pronos par un non-hôte → not_host', (await open(1, 'qui-de-nous', [A, B, C])).err?.includes('not_host'))
ok('open_pronos avec un seul joueur → invalid_pronos', (await open(0, 'qui-de-nous', [A])).err?.includes('invalid_pronos'))
ok('open_pronos avec un joueur hors soirée → invalid_pronos', (await open(0, 'qui-de-nous', [A, E])).err?.includes('invalid_pronos'))
const round = (await open(0, 'qui-de-nous', [A, B, C])).r?.r
ok('open_pronos par l’hôte → manche à 0 pari', round?.bets === 0 && round?.game_id === 'qui-de-nous' && round?.player_ids?.length === 3, JSON.stringify(round))

// --- paris -----------------------------------------------------------------
await bet(1, A)
await bet(1, C)
ok('un seul pari par joueur, le dernier gagne', (await openCount()) === 1 && (await sys(`select pick_profile_id p from public.soiree_pronos where soiree_id=$1 and profile_id=$2`, [soiree, B]))[0].p === C)
ok('set_prono hors manche → invalid_pick', (await bet(1, D)).err?.includes('invalid_pick'))
ok('un joueur de la soirée hors manche peut parier', (await bet(3, A)).err === undefined)
const g = (await call(2, `select public.get_pronos($1) r`, [soiree])).r.r
ok('get_pronos : compteur juste, pas de pari des autres', g.round.bets === 2 && g.my_pick === null && Object.keys(g).sort().join() === 'my_pick,round', JSON.stringify(g))
const gb = (await call(1, `select public.get_pronos($1) r`, [soiree])).r.r
ok('get_pronos : mon propre pari', gb.my_pick === C, JSON.stringify(gb))

// --- expiration ------------------------------------------------------------
await sys(`update public.soiree_prono_rounds set opened_at = now() - interval '11 minutes' where soiree_id = $1`, [soiree])
ok('manche ouverte depuis plus de 10 min : get_pronos.round = null', (await call(2, `select public.get_pronos($1) r`, [soiree])).r.r.round === null)
ok('manche expirée : set_prono → pronos_closed', (await bet(2, A)).err?.includes('pronos_closed'))
await sys(`update public.soiree_prono_rounds set opened_at = now() where soiree_id = $1`, [soiree])

// --- changement de jeu / annulation -----------------------------------------
await open(0, 'tu-preferes', [A, B, C])
ok('open_pronos rappelé (autre jeu) : paris effacés, compteur à 0', (await openCount()) === 0 && (await sys(`select bets from public.soiree_prono_rounds where soiree_id=$1`, [soiree]))[0].bets === 0)
await bet(1, A)
await call(0, `select public.close_pronos($1)`, [soiree])
ok('close_pronos : manche et paris supprimés', (await openCount()) === 0 && (await sys(`select count(*)::int c from public.soiree_prono_rounds where soiree_id=$1`, [soiree]))[0].c === 0)
ok('close_pronos par un non-hôte → not_host', (await call(1, `select public.close_pronos($1)`, [soiree])).err?.includes('not_host'))

// --- lancement : rattachement ---------------------------------------------------
await open(0, 'tu-preferes', [A, B, C])
await bet(1, A)
const mDiff = (await start()).r?.id
ok('start_match d’un autre jeu que la manche : paris supprimés, manche supprimée', Boolean(mDiff) && (await openCount()) === 0 && (await sys(`select count(*)::int c from public.soiree_pronos where soiree_id=$1`, [soiree]))[0].c === 0)
await finish(mDiff, [A])

await open(0, 'qui-de-nous', [A, B, C])
await bet(1, C)
await bet(3, A)
const m1 = (await start()).r?.id
const att = await sys(`select profile_id, match_id from public.soiree_pronos where soiree_id=$1 order by profile_id`, [soiree])
ok('start_match du même jeu : paris rattachés à la partie, manche supprimée', att.length === 2 && att.every((x) => x.match_id === m1) && (await sys(`select count(*)::int c from public.soiree_prono_rounds where soiree_id=$1`, [soiree]))[0].c === 0, JSON.stringify(att))

// --- résultat ---------------------------------------------------------------------
const before = (await call(1, `select public.match_pronos($1) r`, [m1])).r.r
ok('match_pronos avant la fin : void = true', before?.void === true, JSON.stringify(before))
await finish(m1, [A, C]) // égalité : A et C gagnent
const r1 = (await call(1, `select public.match_pronos($1) r`, [m1])).r.r
const pickOf = (r, who) => r.picks.find((x) => x.profile_id === who)
ok('match_pronos : égalité, parier sur n’importe quel gagnant est bon', r1.void === false && pickOf(r1, B).ok === true && pickOf(r1, D).ok === true, JSON.stringify(r1))
ok('match_pronos par un non-membre → erreur', Boolean((await call(4, `select public.match_pronos($1) r`, [m1])).err))

// partie sans gagnant
await open(0, 'qui-de-nous', [A, B, C])
await bet(1, A)
const m2 = (await start()).r.id
await finish(m2, [])
ok('partie sans gagnant : void = true', (await call(1, `select public.match_pronos($1) r`, [m2])).r.r.void === true)

// partie annulée
await open(0, 'qui-de-nous', [A, B, C])
await bet(1, A)
const m3 = (await start()).r.id
await call(0, `select public.game_action($1, '{"type":"abort"}'::jsonb)`, [m3])
ok('partie annulée : void = true', (await call(1, `select public.match_pronos($1) r`, [m3])).r.r.void === true)

// sans pari : null
const mNo = (await start()).r.id
await finish(mNo, [A])
ok('match_pronos sans aucun pari → null', (await call(1, `select public.match_pronos($1) r`, [mNo])).r.r === null)

// --- classement -------------------------------------------------------------------
const board = (await call(2, `select public.soiree_prono_board($1) r`, [soiree])).r.r
const row = (id) => board.find((x) => x.profile_id === id)
ok('soiree_prono_board : bons pronostics comptés (parieur hors manche inclus), annulés ignorés',
  board.length === 2 && row(B).hits === 1 && row(B).bets === 1 && row(D).hits === 1 && row(D).bets === 1, JSON.stringify(board))
ok('soiree_prono_board par un non-membre → erreur', Boolean((await call(4, `select public.soiree_prono_board($1) r`, [soiree])).err))


// --- trophée « Madame Irma » (3 bons pronostics d'affilée) ------------------------
const round3 = async (winners, bets) => {
  await open(0, 'qui-de-nous', [A, B, C])
  for (const [who, pick] of bets) await bet(who, pick)
  const id = (await start()).r.id
  return { id, fin: await finish(id, winners) }
}
const hasIrma = async (who) => (await sys(`select 1 from public.trophy_unlocks where profile_id = $1 and trophy_id = 'gen_madame_irma'`, [who])).length > 0
ok('le trophée gen_madame_irma existe (général, actif)', (await sys(`select 1 from public.trophies where id='gen_madame_irma' and tenue_id is null and active`)).length === 1)
// D (parieur absent de la manche) : ok en m1 ; B : ok en m1
await round3([A], [[3, A], [1, C]]) // m4 : D ok, B (pick C) perd → série de B cassée
ok('2 bons pronostics seulement : pas de trophée', !(await hasIrma(D)))
await round3([], [[3, A]]) // m5 : sans gagnant → annulé, n'interrompt rien
ok('un pronostic annulé n’interrompt ni n’allonge la série', !(await hasIrma(D)))
const m6 = await round3([A], [[3, A], [1, A]]) // m6 : D ok (3e), B ok (1 seule d'affilée)
ok('3e bon pronostic d’affilée (parieur absent de la manche) : trophée débloqué', await hasIrma(D))
ok('finish_match annonce le trophée du parieur absent dans new_trophies', (m6.fin.new_trophies?.[D] ?? []).includes('gen_madame_irma'), JSON.stringify(m6.fin.new_trophies))
ok('une série cassée par un faux pronostic : pas de trophée', !(await hasIrma(B)))

// --- award « Meilleur devin » du Wrapped -----------------------------------------
await call(0, `select public.end_soiree($1)`, [soiree])
const rec = await call(0, `select public.soiree_recap($1) r`, [soiree])
const awards = rec.r.r.awards
const devin = awards.find((a) => a.id === 'devin')
ok('soiree_recap : award devin = meilleur parieur (3 bons pronostics)', devin?.profile_id === D && devin?.value === 3 && devin?.extra?.bets === 3, JSON.stringify(devin))
const soiree2 = (await call(0, `select public.create_soiree($1::uuid[]) r`, [arr([B, C])])).r.r.id
const m7 = (await call(0, `select public.start_match($1, 'qui-de-nous', $2::jsonb) id`, [soiree2, JSON.stringify({ ...QDN, player_ids: [A, B, C] })])).r.id
await finish(m7, [A])
await call(0, `select public.end_soiree($1)`, [soiree2])
const awards2 = (await call(0, `select public.soiree_recap($1) r`, [soiree2])).r.r.awards
ok('soiree_recap sans aucun pari : pas d’award devin', !awards2.some((a) => a.id === 'devin'), JSON.stringify(awards2))

// --- pari sur un joueur qui n'est pas dans la partie : annulé, ni raté ni compté (revue finale I2) -----------
const soiree3 = (await call(0, `select public.create_soiree($1::uuid[]) r`, [arr([B, C])])).r.r.id
await call(0, `select public.open_pronos($1, 'qui-de-nous', $2::uuid[])`, [soiree3, arr([A, B, C])])
await call(1, `select public.set_prono($1, $2)`, [soiree3, C]) // B parie sur C…
const m8 = (await call(0, `select public.start_match($1, 'qui-de-nous', $2::jsonb) id`, [soiree3, JSON.stringify({ ...QDN, player_ids: [A, B] })])).r.id // …mais C ne joue pas
await finish(m8, [A], [A, B])
const r8 = (await call(1, `select public.match_pronos($1) r`, [m8])).r.r
ok('pari sur un joueur absent de la partie : pas de pronostic compté (annulé)', r8 === null || r8.picks.length === 0, JSON.stringify(r8))
ok('pari sur un joueur absent de la partie : absent du classement devin', (await call(1, `select public.soiree_prono_board($1) r`, [soiree3])).r.r.length === 0)

console.log(failed ? '\nÉCHEC' : '\nTout est OK')
process.exit(failed ? 1 : 0)
