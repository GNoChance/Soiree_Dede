// Tests SQL des mises (paris entre potes + défis entre joueurs) (PGlite) : node mises.mjs ../../supabase/install.sql
import { bootDb } from './boot.mjs'

const file = process.argv[2]
if (!file) throw new Error('usage : node mises.mjs <install.sql>')
const db = await bootDb(file)
let failed = false
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK   ' : 'ÉCHEC'} ${name}${cond ? '' : ' ' + extra}`)
  if (!cond) failed = true
}
const ids = (await db.query(`select id from public.profiles order by sort_order limit 4`)).rows.map((r) => r.id)
const [A, B, C, D] = ids
const uid = (i) => `aaaaaaaa-0000-0000-0000-00000000000${i + 1}`
for (let i = 0; i < 4; i++) await db.query(`insert into public.device_sessions(auth_uid, profile_id) values ($1, $2)`, [uid(i), ids[i]])
const as = (p) => async (q, args = []) => {
  await db.query(`select set_config('app.uid', $1, false)`, [uid(ids.indexOf(p))])
  try { return { r: (await db.query(q, args)).rows[0]?.r } } catch (e) { return { err: e.message } }
}
const coins = async (p) => (await db.query(`select public._coins($1) c`, [p])).rows[0].c
const give = (p, n, ref) => db.query(`insert into public.coin_ledger(profile_id, delta, reason, ref) values ($1, $2, 'test', $3)`, [p, n, ref])

// Amis : A-B, A-C ; pas A-D.
for (const o of [B, C]) await db.query(`insert into public.friendships(requester_id, addressee_id, status, accepted_at) values ($1, $2, 'accepted', now())`, [A, o])

ok('solde de départ = 0', (await coins(A)) === 0)
await give(A, 100, '1'); await give(B, 40, '1'); await give(C, 30, '1')
ok('registre compté dans le solde', (await coins(A)) === 100 && (await coins(B)) === 40, `${await coins(A)} ${await coins(B)}`)
const sh = await as(A)(`select public.shop_state() r`)
ok('boutique : même solde', sh.r?.coins === 100, JSON.stringify(sh))

// ---------------------------------------------------------------- PARIS
// Soirée A (hôte), B, C, D ; partie de morpion en duel A vs B ; C et D regardent.
const so = (await as(A)(`select public.create_soiree($1::uuid[]) r`, [[B, C, D]])).r.id
const mid = (await as(A)(`select public.start_match($1, 'morpion', $2) r`, [so, JSON.stringify({ mode: 'duel', duel_players: [A, B], player_ids: [A, B] })])).r
ok('partie lancée', Boolean(mid))
const w0 = (await as(C)(`select public.match_wagers($1) r`, [mid])).r
ok('spectateur : peut parier, paris ouverts', w0?.can_bet === true && w0.open === true && w0.coins === 30, JSON.stringify(w0))
ok('cotes : x2 pour un duel sans historique', Number(w0.odds[A]) === 2 && Number(w0.odds[B]) === 2, JSON.stringify(w0.odds))
const wa = (await as(A)(`select public.match_wagers($1) r`, [mid])).r
ok('joueur : ne peut pas parier', wa?.can_bet === false)
ok('joueur : mise refusée', (await as(A)(`select public.place_wager($1, $2, 10) r`, [mid, B])).err?.includes('wager_player_cannot_bet'))
ok('mise > solde refusée', (await as(C)(`select public.place_wager($1, $2, 50) r`, [mid, A])).err?.includes('wager_not_enough_coins'))
ok('mise invalide refusée', (await as(C)(`select public.place_wager($1, $2, 15) r`, [mid, A])).err?.includes('wager_invalid_stake'))
ok('choix hors partie refusé', (await as(C)(`select public.place_wager($1, $2, 10) r`, [mid, D])).err?.includes('wager_invalid_pick'))
const p1 = await as(C)(`select public.place_wager($1, $2, 10) r`, [mid, B])
ok('mise de 10 sur B', p1.r?.mine?.stake === 10 && p1.r.coins === 20, JSON.stringify(p1))
const p2 = await as(C)(`select public.place_wager($1, $2, 25) r`, [mid, A])
ok('changer d’avis : 25 sur A (ancienne mise rendue)', p2.r?.mine?.stake === 25 && p2.r.mine.pick === A && p2.r.coins === 5, JSON.stringify(p2))
ok('D sans pièces : refusé', (await as(D)(`select public.place_wager($1, $2, 10) r`, [mid, A])).err?.includes('wager_not_enough_coins'))
await give(D, 10, '1')
ok('D mise 10 sur B', !(await as(D)(`select public.place_wager($1, $2, 10) r`, [mid, B])).err)
ok('D : solde 0, jamais négatif', (await coins(D)) === 0)

// Fin : A gagne -> C touche 25 x 2 = 50, D perd 10.
await db.query(`select public.finish_match($1, $2)`, [mid, JSON.stringify([{ profile_id: A, won: true, placement: 1, points: 3 }, { profile_id: B, won: false, placement: 2, points: 0 }])])
const wc = (await as(C)(`select public.match_wagers($1) r`, [mid])).r
ok('règlement : C gagne 50', wc.mine.status === 'won' && wc.mine.payout === 50 && (await coins(C)) === 55, JSON.stringify(wc.mine) + ' ' + (await coins(C)))
const wd = (await as(D)(`select public.match_wagers($1) r`, [mid])).r
ok('règlement : D perd', wd.mine.status === 'lost' && (await coins(D)) === 0, JSON.stringify(wd.mine))
ok('paris fermés après la fin', (await as(C)(`select public.place_wager($1, $2, 10) r`, [mid, A])).err?.includes('wager_closed'))
const n1 = Number((await db.query(`select count(*) c from public.coin_ledger where reason = 'wager_win'`)).rows[0].c)
await db.query(`select public._mises_settle($1)`, [mid])
ok('règlement idempotent', Number((await db.query(`select count(*) c from public.coin_ledger where reason = 'wager_win'`)).rows[0].c) === n1)

// Partie annulée -> remboursement
const mid2 = (await as(A)(`select public.start_match($1, 'morpion', $2) r`, [so, JSON.stringify({ mode: 'duel', duel_players: [A, B], player_ids: [A, B] })])).r
const c0 = await coins(C)
ok('C mise 50', !(await as(C)(`select public.place_wager($1, $2, 50) r`, [mid2, B])).err && (await coins(C)) === c0 - 50)
await as(A)(`select public.game_action($1, '{"type":"abort"}') r`, [mid2])
ok('partie annulée : remboursé', (await coins(C)) === c0, `${await coins(C)} vs ${c0}`)
ok('statut remboursé', (await as(C)(`select public.match_wagers($1) r`, [mid2])).r.mine.status === 'refunded')

// Paris fermés 45 s après le lancement
const mid3 = (await as(A)(`select public.start_match($1, 'morpion', $2) r`, [so, JSON.stringify({ mode: 'duel', duel_players: [A, B], player_ids: [A, B] })])).r
await db.query(`update public.matches set created_at = now() - interval '46 seconds' where id = $1`, [mid3])
ok('paris fermés après 45 s', (await as(C)(`select public.place_wager($1, $2, 10) r`, [mid3, A])).err?.includes('wager_closed'))
await as(A)(`select public.game_action($1, '{"type":"abort"}') r`, [mid3])

// Cote d'un habitué : 10 parties, 6 victoires, duel -> (10+2)/(6+1) = 1,71 -> x1,5 ; novice à 6 joueurs -> x5 (plafond)
const so2 = (await db.query(`insert into public.soirees(code, host_id, status) values ('QQQQ', $1, 'ended') returning id`, [A])).rows[0].id
for (let i = 0; i < 10; i++) {
  const m = (await db.query(`insert into public.matches(soiree_id, game_id, status, finished_at) values ($1, 'echecs', 'finished', now()) returning id`, [so2])).rows[0].id
  await db.query(`insert into public.match_players(match_id, profile_id, game_id, placement, won) values ($1, $2, 'echecs', 1, $3)`, [m, D, i < 6])
}
ok('cote d’un habitué : x1,5 (plancher)', Number((await db.query(`select public._wager_odds('echecs', $1, 2) o`, [D])).rows[0].o) === 1.5)
ok('cote d’un novice à 6 : x5 (plafond)', Number((await db.query(`select public._wager_odds('echecs', $1, 6) o`, [C])).rows[0].o) === 5)
ok('cote novice à 3 : x3', Number((await db.query(`select public._wager_odds('echecs', $1, 3) o`, [C])).rows[0].o) === 3)

// ---------------------------------------------------------------- DÉFIS
const cA = await coins(A), cB = await coins(B)
const opt = (await as(A)(`select public.challenge_options() r`)).r
const fB = opt.friends.find((f) => f.id === B)
ok('options : amis B et C, enjeu max = min des soldes', opt.friends.length === 2 && fB.max_stake === Math.min(cA, cB), JSON.stringify(opt))
ok('pas ami : refusé', (await as(A)(`select public.create_challenge($1, 'morpion', 10) r`, [D])).err?.includes('challenge_not_friend'))
ok('jeu pas en duel : refusé', (await as(A)(`select public.create_challenge($1, 'undercover', 10) r`, [B])).err?.includes('challenge_invalid_game'))
ok('enjeu invalide : refusé', (await as(A)(`select public.create_challenge($1, 'morpion', 30) r`, [B])).err?.includes('challenge_invalid_stake'))
ok('enjeu > solde de l’autre : refusé', (await as(A)(`select public.create_challenge($1, 'morpion', 100) r`, [B])).err?.includes('challenge_stake_too_high'))

// Défi expiré : rien de prélevé
const ch1 = (await as(A)(`select public.create_challenge($1, 'morpion', 25) r`, [B])).r
ok('défi créé (en attente)', ch1?.status === 'pending' && ch1.role === 'sent', JSON.stringify(ch1))
ok('un seul défi ouvert par paire', (await as(B)(`select public.create_challenge($1, 'echecs', 10) r`, [A])).err?.includes('challenge_already_open'))
const recv = (await as(B)(`select public.my_challenges() r`)).r
ok('B le voit dans ses défis reçus', recv.challenges.some((c) => c.id === ch1.id && c.role === 'received'), JSON.stringify(recv))
await db.query(`update public.coin_challenges set expires_at = now() - interval '1 second' where id = $1`, [ch1.id])
ok('accepter après 48 h : expiré', (await as(B)(`select public.respond_challenge($1, true) r`, [ch1.id])).err?.includes('challenge_expired'))
ok('expiré : rien de prélevé', (await coins(A)) === cA && (await coins(B)) === cB)
await as(B)(`select public.my_challenges() r`)
const st1 = (await db.query(`select status from public.coin_challenges where id = $1`, [ch1.id])).rows[0].status
ok('statut expired', st1 === 'expired', st1)

// Refus
const ch2 = (await as(A)(`select public.create_challenge($1, 'morpion', 10) r`, [B])).r
ok('seul l’adversaire répond', (await as(C)(`select public.respond_challenge($1, true) r`, [ch2.id])).err?.includes('challenge_not_found'))
ok('refus', (await as(B)(`select public.respond_challenge($1, false) r`, [ch2.id])).r?.status === 'declined')

// Accepté puis gagné
const ch3 = (await as(A)(`select public.create_challenge($1, 'morpion', 25) r`, [B])).r
const acc = await as(B)(`select public.respond_challenge($1, true) r`, [ch3.id])
ok('accepté : enjeux bloqués', acc.r?.status === 'accepted' && (await coins(A)) === cA - 25 && (await coins(B)) === cB - 25, JSON.stringify(acc))
ok('déjà accepté : plus de réponse', (await as(B)(`select public.respond_challenge($1, true) r`, [ch3.id])).err?.includes('challenge_not_pending'))
const pl = (await as(B)(`select public.play_challenge($1) r`, [ch3.id])).r
ok('jouer : soirée commune trouvée', pl?.soiree_id === so, JSON.stringify(pl))
const sc = (await as(A)(`select public.soiree_challenges($1) r`, [so])).r
ok('carte de l’hôte : défi à lancer', sc.length === 1 && sc[0].id === ch3.id, JSON.stringify(sc))
ok('seul l’hôte lance', (await as(B)(`select public.start_challenge($1, $2, '{}') r`, [ch3.id, so])).err?.includes('not_host'))
const cm = (await as(A)(`select public.start_challenge($1, $2, '{}') r`, [ch3.id, so])).r
const ms = (await db.query(`select state from public.matches where id = $1`, [cm])).rows[0].state
ok('duel lancé : A vs B seuls, mode duel', ms.players.length === 2 && ms.session.mode === 'duel', JSON.stringify(ms.players))
ok('déjà lancé', (await as(A)(`select public.start_challenge($1, $2, '{}') r`, [ch3.id, so])).err?.includes('challenge_already_started'))
await db.query(`select public.finish_match($1, $2)`, [cm, JSON.stringify([{ profile_id: B, won: true, placement: 1, points: 3 }, { profile_id: A, won: false, placement: 2, points: 0 }])])
const after = (await db.query(`select status, winner_id from public.coin_challenges where id = $1`, [ch3.id])).rows[0]
ok('B gagne : statut finished', after.status === 'finished' && after.winner_id === B, JSON.stringify(after))
// B : -25 + 50 (pot) + 5 + 15 (partie gagnée) ; A : -25 + 5 (partie)
ok('B empoche le pot', (await coins(B)) === cB - 25 + 50 + 20, String(await coins(B)))
ok('A perd son enjeu', (await coins(A)) === cA - 25 + 5, String(await coins(A)))

// Accepté puis partie annulée par un des duellistes (l'hôte A) -> abandon : B empoche le pot
const a1 = await coins(A), b1 = await coins(B)
const ch4 = (await as(B)(`select public.create_challenge($1, 'quatre-a-la-suite', 10) r`, [A])).r
await as(A)(`select public.respond_challenge($1, true) r`, [ch4.id])
const cm4 = (await as(A)(`select public.start_challenge($1, $2, '{}') r`, [ch4.id, so])).r
await as(A)(`select public.game_action($1, '{"type":"abort"}') r`, [cm4])
const s4 = (await db.query(`select status from public.coin_challenges where id = $1`, [ch4.id])).rows[0].status
const w4 = (await db.query(`select winner_id from public.coin_challenges where id = $1`, [ch4.id])).rows[0].winner_id
ok('annulé par un duelliste : abandon, l’adversaire empoche le pot', s4 === 'finished' && w4 === B && (await coins(A)) === a1 - 10 && (await coins(B)) === b1 + 10, `${s4} ${w4} ${await coins(A)}/${a1} ${await coins(B)}/${b1}`)
const a1e = await coins(A), b1e = await coins(B)

// Égalité -> remboursement
const ch5 = (await as(A)(`select public.create_challenge($1, 'morpion', 10) r`, [B])).r
await as(B)(`select public.respond_challenge($1, true) r`, [ch5.id])
const cm5 = (await as(A)(`select public.start_challenge($1, $2, '{}') r`, [ch5.id, so])).r
await db.query(`select public.finish_match($1, $2)`, [cm5, JSON.stringify([{ profile_id: A, won: false, placement: 1, points: 1 }, { profile_id: B, won: false, placement: 1, points: 1 }])])
const s5 = (await db.query(`select status, winner_id from public.coin_challenges where id = $1`, [ch5.id])).rows[0]
ok('égalité : remboursé', s5.status === 'finished' && s5.winner_id === null && (await coins(A)) === a1e + 5 && (await coins(B)) === b1e + 5, `${JSON.stringify(s5)} ${await coins(A)} ${await coins(B)}`)

// Accepté jamais joué sous 7 jours -> remboursé
const a2 = await coins(A), c2 = await coins(C)
const ch6 = (await as(A)(`select public.create_challenge($1, 'echecs', 0) r`, [C])).r
ok('défi amical à 0 🪙', ch6?.stake === 0)
await as(C)(`select public.respond_challenge($1, true) r`, [ch6.id])
const ch7 = (await as(C)(`select public.create_challenge($1, 'morpion', 10) r`, [A])).err
ok('défi déjà ouvert avec C', ch7?.includes('challenge_already_open'))
await db.query(`update public.coin_challenges set accepted_at = now() - interval '8 days' where id = $1`, [ch6.id])
await as(A)(`select public.my_challenges() r`)
ok('accepté non joué 7 j : annulé', (await db.query(`select status from public.coin_challenges where id = $1`, [ch6.id])).rows[0].status === 'void' && (await coins(A)) === a2 && (await coins(C)) === c2)

// Concurrence simple : B accepte alors que A a dépensé entre-temps -> refusé
const ch8 = (await as(A)(`select public.create_challenge($1, 'morpion', 50) r`, [B])).r
ok('défi à 50', ch8?.stake === 50, JSON.stringify(ch8))
await give(A, -(await coins(A)) + 20, '2') // A n'a plus que 20
ok('A n’a plus assez : acceptation refusée', (await as(B)(`select public.respond_challenge($1, true) r`, [ch8.id])).err?.includes('challenge_opponent_broke'))
ok('soldes jamais négatifs', Number((await db.query(`select count(*) c from public.profiles p where public._coins(p.id) < 0`)).rows[0].c) === 0)
ok('annuler son défi', (await as(A)(`select public.cancel_challenge($1) r`, [ch8.id])).r?.status === 'cancelled')

// ---- L'hôte qui annule ne récupère pas SON pari (les autres sont remboursés)
await give(A, 100, '3'); await give(D, 20, '3')
const mh = (await as(A)(`select public.start_match($1, 'morpion', $2) r`, [so, JSON.stringify({ mode: 'duel', duel_players: [B, C], player_ids: [B, C] })])).r
const ah = await coins(A), dh = await coins(D)
ok('hôte meneur : peut parier', !(await as(A)(`select public.place_wager($1, $2, 10) r`, [mh, B])).err)
ok('D parie', !(await as(D)(`select public.place_wager($1, $2, 10) r`, [mh, C])).err)
await as(A)(`select public.game_action($1, '{"type":"abort"}') r`, [mh])
ok('hôte qui annule : son pari est perdu', (await coins(A)) === ah - 10 && (await as(A)(`select public.match_wagers($1) r`, [mh])).r.mine.status === 'lost', String(await coins(A)))
ok('hôte qui annule : les autres sont remboursés', (await coins(D)) === dh)

// ---- Défi entre B et C annulé par l'hôte A (pas duelliste) -> remboursé (void)
await db.query(`insert into public.friendships(requester_id, addressee_id, status, accepted_at) values ($1, $2, 'accepted', now())`, [B, C])
await give(B, 20, '4'); await give(C, 20, '4')
const bv = await coins(B), cv = await coins(C)
const ch9 = (await as(B)(`select public.create_challenge($1, 'morpion', 10) r`, [C])).r
await as(C)(`select public.respond_challenge($1, true) r`, [ch9.id])
const cm9 = (await as(A)(`select public.start_challenge($1, $2, '{}') r`, [ch9.id, so])).r
await as(A)(`select public.game_action($1, '{"type":"abort"}') r`, [cm9])
ok('annulé par l’hôte non duelliste : remboursé (void)', (await db.query(`select status from public.coin_challenges where id = $1`, [ch9.id])).rows[0].status === 'void' && (await coins(B)) === bv && (await coins(C)) === cv)

// ---- Fin de soirée par l'hôte : même règle (son pari perdu)
const me2 = (await as(A)(`select public.start_match($1, 'morpion', $2) r`, [so, JSON.stringify({ mode: 'duel', duel_players: [B, C], player_ids: [B, C] })])).r
const ae = await coins(A)
await as(A)(`select public.place_wager($1, $2, 10) r`, [me2, C])
await as(A)(`select public.end_soiree($1) r`, [so])
ok('fin de soirée par l’hôte : son pari est perdu', (await coins(A)) === ae - 10, String(await coins(A)))

process.exit(failed ? 1 : 0)
