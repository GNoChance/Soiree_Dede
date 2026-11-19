// Tests SQL du jeu « Kems » (PGlite) : node kems.mjs ../../supabase/install.sql
// Appels directs du moteur (superutilisateur) : game_kems_start / game_kems_action.
import { bootDb } from './boot.mjs'

const file = process.argv[2]
if (!file) throw new Error('usage : node kems.mjs <install.sql>')
const db = await bootDb(file)

let failed = false
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK   ' : 'ÉCHEC'} ${name}${cond ? '' : ' ' + extra}`)
  if (!cond) failed = true
}

const P = (await db.query(`select id from public.profiles order by sort_order limit 9`)).rows.map((r) => r.id)
const SIGNS = ['Se gratter le nez', 'Tirer la langue', 'Clin d’œil', 'Se toucher l’oreille', 'Tousser', 'Croiser les bras']

const start = async (teams, extra = {}, players = P) => {
  const opts = { teams, target: 5, signs: SIGNS, ...extra }
  try {
    return { r: (await db.query(`select public.game_kems_start($1::uuid[], $2::jsonb) r`, [`{${players.join(',')}}`, JSON.stringify(opts)])).rows[0].r }
  } catch (e) {
    return { err: e.message }
  }
}
/** Action ; par défaut on efface la garde anti double-appui (250 ms) pour enchaîner les tests. */
const act = async (st, actor, action, { host = false, keepGuard = false } = {}) => {
  const server = keepGuard ? st.server : { ...st.server, last_swap: {} }
  try {
    const r = (await db.query(`select public.game_kems_action($1::jsonb, $2::jsonb, $3::uuid, $4, $5::jsonb) r`,
      [JSON.stringify(st.state), JSON.stringify(server), actor, host, JSON.stringify(action)])).rows[0].r
    return { r }
  } catch (e) {
    return { err: e.message }
  }
}
const must = (res, label) => {
  if (res.err) throw new Error(label + ' : ' + res.err)
  return res.r
}
/** Fusionne les secrets renvoyés dans un « registre » de secrets par joueur. */
const withSecrets = (prev, r) => ({ ...r, secrets: { ...(prev?.secrets ?? {}), ...(r.secrets ?? {}) } })

const rank = (c) => c.slice(0, -1)
const isSquare = (h) => h.length === 4 && new Set(h.map(rank)).size === 1
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x))
const approx = (iso, sec) => {
  const d = (new Date(iso).getTime() - Date.now()) / 1000
  return d > sec - 5 && d <= sec + 1
}
const T4 = { red: P.slice(0, 2), blue: P.slice(2, 4) }
const T6 = { red: P.slice(0, 2), blue: P.slice(2, 4), green: P.slice(4, 6) }
const T8 = { red: P.slice(0, 2), blue: P.slice(2, 4), green: P.slice(4, 6), yellow: P.slice(6, 8) }
const teamOf = (st, pid) => st.state.teams.find((t) => t.players.includes(pid))
const partnerOf = (st, pid) => teamOf(st, pid).players.find((x) => x !== pid)
const score = (st, id) => st.state.teams.find((t) => t.id === id).score
const scores = (st) => st.state.teams.map((t) => t.score).join()
const allCards = (st) => [...Object.values(st.server.hands).flat(), ...st.state.center, ...st.server.deck, ...st.server.discard]

/** Démarre et passe la phase « signs » (tout le monde prêt). */
const playing = async (teams = T4, extra = {}, players = P.slice(0, 8)) => {
  let s = must(await start(teams, extra, players), 'start')
  s = withSecrets(null, s)
  for (const pid of s.state.players) s = withSecrets(s, must(await act(s, pid, { type: 'ready' }), 'ready'))
  return s
}
/** Impose des mains (jamais de carrés par hasard) puis fixe les cartes voulues. */
const NOSQ = [['2H', '3S', '4D', '5C'], ['6H', '7S', '8D', '9C'], ['10H', 'JS', 'QD', 'KC'], ['AH', '2S', '3D', '4C'], ['5H', '6S', '7D', '8C'], ['9H', '10S', 'JD', 'QC'], ['KH', 'AS', '2D', '3C'], ['4H', '5S', '6D', '7C']]
const rig = (st, hands = {}, center) => {
  const pids = st.state.players
  const h = Object.fromEntries(pids.map((p, i) => [p, hands[p] ?? NOSQ[i]]))
  return { ...st, state: { ...st.state, center: center ?? ['AC', 'KD', 'QS', 'JH'] }, server: { ...st.server, hands: h } }
}
const SQ7 = ['7H', '7S', '7D', '7C']
const SQ9 = ['9H', '9S', '9D', '9C']

// ----------------------------------------------------------------------------- démarrage / distribution
const s0 = must(await start(T4, {}, P.slice(0, 4)), 'start4')
ok('state.game = kems, phase signs, round 0', s0.state.game === 'kems' && s0.state.phase === 'signs' && s0.state.round === 0)
ok('signs : deadline ≈ +45 s', approx(s0.state.deadline, 45), s0.state.deadline)
ok('objectif par défaut 5, valide 3/7, sinon 5', s0.state.target === 5 && (await start(T4, { target: 7 })).r.state.target === 7 && (await start(T4, { target: 9 })).r.state.target === 5)
ok('équipes dans l’ordre red, blue, scores à 0', s0.state.teams.map((t) => t.id).join() === 'red,blue' && s0.state.teams.every((t) => t.score === 0))
ok('secrets au démarrage : seuls les joueurs, idées de signe (3, identiques au sein d’une équipe)',
  sameSet(Object.keys(s0.secrets), P.slice(0, 4)) && s0.secrets[P[0]].sign_ideas.length === 3 &&
    JSON.stringify(s0.secrets[P[0]].sign_ideas) === JSON.stringify(s0.secrets[P[1]].sign_ideas) && s0.secrets[P[0]].hand.length === 0)
ok('aucune main dans le state public en phase signs', JSON.stringify(s0.state).includes('hands') === false && s0.state.center.length === 0)
ok('pstats initialisés (9 compteurs)', Object.keys(s0.server.pstats[P[0]]).length === 9)

// ready
let G = withSecrets(null, s0)
const r1 = must(await act(G, P[0], { type: 'ready' }), 'ready1')
ok('ready : le joueur est ajouté, toujours en signs', r1.state.phase === 'signs' && r1.state.ready.length === 1)
const r1b = must(await act(r1, P[0], { type: 'ready' }), 'ready1b')
ok('ready répété : idempotent', r1b.state.ready.length === 1)
ok('ready par un joueur du banc/inconnu → not_in_match', (await act(G, P[5], { type: 'ready' })).err === 'not_in_match')
G = r1
for (const pid of P.slice(1, 4)) G = withSecrets(G, must(await act(G, pid, { type: 'ready' }), 'ready'))
ok('tous prêts → phase playing, manche 1', G.state.phase === 'playing' && G.state.round === 1)

// ----------------------------------------------------------------------------- distribution 4 / 6 / 8
const check = (label, st, nPlayers, nCards) => {
  const cards = allCards(st)
  ok(`${label} : ${nCards} cartes, aucun doublon`, cards.length === nCards && new Set(cards).size === nCards, `${cards.length} / ${new Set(cards).size}`)
  ok(`${label} : 4 cartes par joueur, 4 au centre, pioche = ${nCards - nPlayers * 4 - 4}`,
    Object.values(st.server.hands).every((h) => h.length === 4) && Object.keys(st.server.hands).length === nPlayers &&
      st.state.center.length === 4 && st.server.deck.length === nCards - nPlayers * 4 - 4 && st.state.deck_count === st.server.deck.length)
}
check('4 joueurs', G, 4, 32)
ok('4 joueurs : valeurs 7 à As uniquement', allCards(G).every((c) => ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'].includes(rank(c))))
const G6 = await playing(T6, {}, P.slice(0, 7))
check('6 joueurs', G6, 6, 52)
ok('6 joueurs : le 7e est sur le banc, hors state.players et hors mains', G6.state.bench.join() === P[6] && !G6.state.players.includes(P[6]) && !(P[6] in G6.server.hands) && !(P[6] in G6.secrets))
const G8 = await playing(T8, {}, P.slice(0, 9))
check('8 joueurs', G8, 8, 52)
ok('8 joueurs : 52 cartes dont les 2 à 6', allCards(G8).some((c) => rank(c) === '2'))
ok('playing : sweep.deadline ≈ +10 s, round_deadline ≈ +180 s, deadline = la plus proche',
  approx(G.state.sweep.deadline, 10) && approx(G.state.round_deadline, 180) && G.state.deadline === G.state.sweep.deadline, JSON.stringify(G.state.sweep))

// secrets : jamais de main dans le public, chacun voit la sienne
const pub = JSON.stringify(G.state)
ok('mains absentes du state public', !Object.values(G.server.hands).some((h) => h.some((c) => pub.includes(`"${c}"`) && !G.state.center.includes(c))))
ok('chaque joueur a SA main dans son secret (round, hand, square, sign_ideas)',
  P.slice(0, 4).every((p) => JSON.stringify(G.secrets[p].hand) === JSON.stringify(G.server.hands[p]) && G.secrets[p].round === 1 &&
    typeof G.secrets[p].square === 'boolean' && G.secrets[p].sign_ideas.length === 3))
ok('hand_ver augmente à la distribution', P.slice(0, 4).every((p) => G.state.hand_ver[p] === 2))
ok('secret.square vrai quand on a un carré (_kems_secret)', (await db.query(`select (public._kems_secret($1::jsonb, $2::jsonb, $3)->>'square')::boolean r`, [JSON.stringify(rig(G, { [P[0]]: SQ7 }).state), JSON.stringify(rig(G, { [P[0]]: SQ7 }).server), P[0]])).rows[0].r === true)

// refus au démarrage
ok('équipe de 1 → invalid_teams', (await start({ red: P.slice(0, 2), blue: [P[2]] })).err === 'invalid_teams')
ok('équipe de 3 → invalid_teams', (await start({ red: P.slice(0, 3), blue: P.slice(3, 5) })).err === 'invalid_teams')
ok('1 seule équipe → invalid_teams', (await start({ red: P.slice(0, 2) })).err === 'invalid_teams')
ok('joueur dans 2 équipes → invalid_teams', (await start({ red: [P[0], P[1]], blue: [P[1], P[2]] })).err === 'invalid_teams')
ok('membre hors p_players → invalid_teams', (await start(T4, {}, P.slice(0, 3))).err === 'invalid_teams')
ok('couleur inconnue → invalid_teams', (await start({ red: P.slice(0, 2), purple: P.slice(2, 4) })).err === 'invalid_teams')

// tick en signs
const pastDl = (st, patch = {}) => ({ ...st, state: { ...st.state, deadline: new Date(Date.now() - 1000).toISOString(), ...patch } })
const tkSign0 = must(await act(s0, P[0], { type: 'tick' }), 'tkSign0')
ok('tick signs avant échéance : inchangé', tkSign0.state.phase === 'signs')
const tkSign = must(await act(pastDl(s0), P[0], { type: 'tick' }), 'tkSign')
ok('tick signs échu : distribution, phase playing', tkSign.state.phase === 'playing' && tkSign.state.round === 1 && Object.keys(tkSign.secrets).length === 4)
ok('tick signs rejoué sur playing : inchangé', must(await act(tkSign, P[0], { type: 'tick' }), 'tk').state.round === 1)

// ----------------------------------------------------------------------------- échanges
let S = rig(G)
const ev = (patch) => ({ ...S, ...patch })
const give0 = S.server.hands[P[0]][0]
const sw = must(await act(S, P[0], { type: 'swap', give: give0, take: 'AC' }), 'swap')
ok('swap nominal : main et centre échangés (même position)',
  sw.server.hands[P[0]].includes('AC') && !sw.server.hands[P[0]].includes(give0) && sw.state.center[0] === give0 && sw.state.center.length === 4)
const swReal = must(await act(G, P[0], { type: 'swap', give: G.server.hands[P[0]][0], take: G.state.center[0] }), 'swReal')
ok('swap : total des cartes conservé, pas de doublon', allCards(swReal).length === 32 && new Set(allCards(swReal)).size === 32)
ok('swap : secret du seul acteur mis à jour (main + v)', Object.keys(sw.secrets).join() === P[0] && sw.secrets[P[0]].hand.includes('AC') && sw.secrets[P[0]].v === sw.state.hand_ver[P[0]])
ok('swap : feed public {by, took, gave}, swaps +1', sw.state.feed[0].by === P[0] && sw.state.feed[0].took === 'AC' && sw.state.feed[0].gave === give0 && sw.state.swaps === 1)
ok('swap : aucune main dans le state public', !JSON.stringify(sw.state).includes('hands'))
ok('swap : carte absente de la main → not_in_hand', (await act(S, P[0], { type: 'swap', give: '2D', take: 'AC' })).err === 'not_in_hand')
ok('swap : carte d’un autre joueur → not_in_hand', (await act(S, P[0], { type: 'swap', give: S.server.hands[P[1]][0], take: 'AC' })).err === 'not_in_hand')
ok('swap : carte hors centre → card_taken', (await act(S, P[0], { type: 'swap', give: give0, take: '2D' })).err === 'card_taken')
ok('swap : paramètres invalides → invalid_action', (await act(S, P[0], { type: 'swap', give: 3, take: 'AC' })).err === 'invalid_action')
ok('swap par le banc → not_in_match', (await act(S, P[5], { type: 'swap', give: give0, take: 'AC' })).err === 'not_in_match')
// concurrence : deux joueurs visent la même carte du centre
const give1 = S.server.hands[P[1]][0]
const race2 = await act(sw, P[1], { type: 'swap', give: give1, take: 'AC' })
ok('2 swap sur la même carte du centre : le 2e → card_taken, mains intactes',
  race2.err === 'card_taken' && JSON.stringify(sw.server.hands[P[1]]) === JSON.stringify(S.server.hands[P[1]]))
ok('swap périmé (la carte donnée a déjà changé de main) → not_in_hand', (await act(sw, P[0], { type: 'swap', give: give0, take: 'KD' })).err === 'not_in_hand')
const sw2 = must(await act(sw, P[1], { type: 'swap', give: give1, take: 'KD' }), 'sw2')
ok('autre carte du centre : OK, feed à 2 entrées (la plus récente d’abord)', sw2.state.feed.length === 2 && sw2.state.feed[0].by === P[1])
// feed borné à 6
let F = S
for (let i = 0; i < 9; i++) {
  const p = P[i % 4]
  const g = F.server.hands[p][0]
  const t = F.state.center[0]
  F = must(await act(F, p, { type: 'swap', give: g, take: t }), 'feed')
}
ok('feed limité à 6 entrées', F.state.feed.length === 6 && F.state.swaps === 9)
// garde anti double-appui
const g1 = must(await act(S, P[0], { type: 'swap', give: give0, take: 'AC' }, { keepGuard: true }), 'g1')
const g2 = await act(g1, P[0], { type: 'swap', give: g1.server.hands[P[0]][1], take: 'KD' }, { keepGuard: true })
ok('double appui (< 250 ms) du même joueur : ignoré sans erreur', g2.err === undefined && g2.r.state.swaps === 1 && JSON.stringify(g2.r.server.hands[P[0]]) === JSON.stringify(g1.server.hands[P[0]]), g2.err)
const g3 = await act(g1, P[1], { type: 'swap', give: g1.server.hands[P[1]][0], take: 'KD' }, { keepGuard: true })
ok('… mais pas pour un autre joueur', g3.err === undefined && g3.r.state.swaps === 2)
// échange annule les votes de balayage ; remet le chrono de 10 s
let V = must(await act(S, P[0], { type: 'sweep' }), 'v')
ok('sweep : vote enregistré', V.state.sweep.votes.join() === P[0])
V = must(await act(V, P[1], { type: 'swap', give: V.server.hands[P[1]][0], take: 'AC' }), 'vs')
ok('un échange annule les votes de balayage', V.state.sweep.votes.length === 0)
ok('un échange repousse le balayage auto (≈ +10 s)', approx(V.state.sweep.deadline, 10))
// carré réuni
const sqHand = { [P[0]]: ['7H', '7S', '7D', '2C'] }
const SQ = rig(G, sqHand, ['7C', 'KD', 'QS', 'JH'])
const sqSw = must(await act(SQ, P[0], { type: 'swap', give: '2C', take: '7C' }), 'sq')
ok('swap qui forme un carré : secret.square = true, compteur squares +1', sqSw.secrets[P[0]].square === true && sqSw.server.pstats[P[0]].squares === 1)
const sqSw2 = must(await act({ ...sqSw, state: { ...sqSw.state, center: ['2C', 'KD', 'QS', 'JH'] } }, P[0], { type: 'swap', give: '7C', take: '2C' }), 'sq2')
const sqSw3 = must(await act({ ...sqSw2, state: { ...sqSw2.state, center: ['7C', 'KD', 'QS', 'JH'] } }, P[0], { type: 'swap', give: '2C', take: '7C' }), 'sq3')
ok('carré recomposé dans la même manche : compté une seule fois', sqSw3.server.pstats[P[0]].squares === 1)
ok('actions hors playing ignorées (swap en signs, kems en signs)', (await act(s0, P[0], { type: 'swap', give: 'x', take: 'y' })).r?.state.phase === 'signs' && (await act(s0, P[0], { type: 'kems' })).r?.state.phase === 'signs')

// ----------------------------------------------------------------------------- balayage
let W = rig(G)
const oldCenter = W.state.center
const deck0 = W.server.deck
W = must(await act(W, P[0], { type: 'sweep' }), 'w1')
ok('1 vote sur 4 : pas de balayage', W.state.sweeps === 0 && JSON.stringify(W.state.center) === JSON.stringify(oldCenter))
const wOff = must(await act(W, P[0], { type: 'sweep' }), 'wOff')
ok('re-voter retire son vote', wOff.state.sweep.votes.length === 0)
for (const pid of P.slice(1, 3)) W = must(await act(W, pid, { type: 'sweep' }), 'w')
ok('3 votes sur 4 : pas de balayage', JSON.stringify(W.state.center) === JSON.stringify(oldCenter) && W.state.sweep.votes.length === 3)
W = must(await act(W, P[3], { type: 'sweep' }), 'w4')
ok('unanimité : 4 nouvelles cartes depuis la pioche, ancien centre en défausse, votes vidés',
  JSON.stringify(W.state.center) === JSON.stringify(deck0.slice(0, 4)) && JSON.stringify(W.server.discard) === JSON.stringify(oldCenter) &&
    W.state.deck_count === deck0.length - 4 && W.state.sweep.votes.length === 0 && W.state.sweeps === 1)
let WR = G
for (const pid of P.slice(0, 4)) WR = must(await act(WR, pid, { type: 'sweep' }), 'wr')
ok('balayage : total des cartes conservé', WR.state.sweeps === 1 && allCards(WR).length === 32 && new Set(allCards(WR)).size === 32)
ok('balayage : nouveau délai de 10 s', approx(W.state.sweep.deadline, 10))
// pioche vide → défausse remélangée
const emptyDeck = { ...rig(G), server: { ...rig(G).server, deck: ['2S', '3S'], discard: ['4S', '5S', '6S', '8S', '9S', '10S'] } }
let E = emptyDeck
for (const pid of P.slice(0, 4)) E = must(await act(E, pid, { type: 'sweep' }), 'e')
ok('pioche presque vide : on prend le reste puis la défausse remélangée',
  E.state.center[0] === '2S' && E.state.center[1] === '3S' && E.state.center.length === 4 && E.server.discard.length === 4 &&
    sameSet(E.state.center.slice(2), ['4S', '5S', '6S', '8S', '9S', '10S'].filter((c) => E.state.center.includes(c))) &&
    E.server.deck.length === 4, JSON.stringify(E.server))
const E2 = { ...rig(G), server: { ...rig(G).server, deck: [], discard: ['4S', '5S', '6S', '8S', '9S', '10S'] } }
let E3 = E2
for (const pid of P.slice(0, 4)) E3 = must(await act(E3, pid, { type: 'sweep' }), 'e3')
ok('pioche vide : défausse remélangée (centre ≠ ancien centre), total conservé',
  E3.state.center.every((c) => ['4S', '5S', '6S', '8S', '9S', '10S'].includes(c)) && E3.state.deck_count === 2 && E3.server.discard.length === 4)
// balayage automatique après 10 s
const tkSw0 = must(await act(rig(G), P[0], { type: 'tick' }), 'tkSw0')
ok('tick avant échéance : inchangé', JSON.stringify(tkSw0.state.center) === JSON.stringify(rig(G).state.center))
const pastSweep = { ...rig(G), state: { ...rig(G).state, sweep: { votes: [P[0]], deadline: new Date(Date.now() - 1000).toISOString() } } }
const tkSw = must(await act(pastSweep, P[2], { type: 'tick' }), 'tkSw')
ok('tick 10 s sans échange : balayage automatique, votes vidés', tkSw.state.sweeps === 1 && tkSw.state.sweep.votes.length === 0 && JSON.stringify(tkSw.state.center) !== JSON.stringify(pastSweep.state.center))
const tkSw2 = must(await act(tkSw, P[3], { type: 'tick' }), 'tkSw2')
ok('tick rejoué : idempotent (une seule balayage)', tkSw2.state.sweeps === 1 && JSON.stringify(tkSw2.state.center) === JSON.stringify(tkSw.state.center))
ok('deadline du state = prochaine échéance', tkSw.state.deadline === tkSw.state.sweep.deadline)

// ----------------------------------------------------------------------------- KEMS
const base = (hands, center) => rig(G, hands, center)
const K = base({ [P[0]]: SQ7 })
ok('rig : le joueur 0 (rouge) a un carré, partenaire P1', isSquare(K.server.hands[P[0]]) && partnerOf(K, P[0]) === P[1])
const kOk = must(await act(K, P[1], { type: 'kems' }), 'kems ok')
ok('KEMS valide (le partenaire du détenteur) : +1 à l’équipe rouge, phase reveal',
  kOk.state.phase === 'reveal' && score(kOk, 'red') === 1 && score(kOk, 'blue') === 0 && kOk.state.call.ok === true && kOk.state.call.double === false)
ok('call : type kems, by, team, hands révélées, holders', kOk.state.call.type === 'kems' && kOk.state.call.by === P[1] && kOk.state.call.team === 'red' &&
  Object.keys(kOk.state.call.hands).length === 4 && kOk.state.call.holders.join() === P[0])
ok('reveal : deadline ≈ +6 s, votes vidés', approx(kOk.state.deadline, 6))
ok('Kems : team_kems +1 aux deux coéquipiers, tstats.kems', kOk.server.pstats[P[0]].team_kems === 1 && kOk.server.pstats[P[1]].team_kems === 1 && kOk.state.tstats.red.kems === 1)
ok('Kems rapide (< 20 s) : fast_kems aux deux coéquipiers', kOk.server.pstats[P[0]].fast_kems === 1 && kOk.server.pstats[P[1]].fast_kems === 1)
const slow = { ...K, server: { ...K.server, round_started_at: new Date(Date.now() - 30000).toISOString() } }
const kSlow = must(await act(slow, P[1], { type: 'kems' }), 'slow')
ok('Kems après 20 s : pas de fast_kems', kSlow.server.pstats[P[0]].fast_kems === 0 && kSlow.server.pstats[P[1]].fast_kems === 0)
const kSelf = must(await act(K, P[0], { type: 'kems' }), 'self')
ok('KEMS annoncé par le détenteur pour lui-même : raté (pas de carré chez le partenaire), +1 aux autres',
  kSelf.state.call.ok === false && score(kSelf, 'red') === 0 && score(kSelf, 'blue') === 1 && kSelf.server.pstats[P[0]].false_kems === 1 && kSelf.state.tstats.red.errors === 1)
const kNone = must(await act(base({}), P[0], { type: 'kems' }), 'none')
const K3 = rig(G6, {}, undefined)
const kNone3 = must(await act(K3, P[0], { type: 'kems' }), 'none3')
ok('3 équipes, KEMS raté : +1 à chacune des 2 autres équipes', scores(kNone3) === '0,1,1' && kNone3.state.call.deltas.blue === 1 && kNone3.state.call.deltas.green === 1)
ok('KEMS raté : tstats.errors, false_kems', kNone.state.tstats.red.errors === 1 && kNone.server.pstats[P[0]].false_kems === 1)
const dbl = must(await act(base({ [P[0]]: SQ7, [P[1]]: SQ9 }), P[1], { type: 'kems' }), 'double')
ok('Double Kems (les deux ont un carré) : +2, double_kems aux deux', dbl.state.call.double === true && score(dbl, 'red') === 2 && dbl.server.pstats[P[0]].double_kems === 1 && dbl.server.pstats[P[1]].double_kems === 1)
ok('Double Kems : holders = les deux', sameSet(dbl.state.call.holders, [P[0], P[1]]))
// appel tardif ignoré
const late = await act(kOk, P[2], { type: 'kems' })
ok('KEMS/CONTRE tardif (phase reveal) : ignoré sans erreur, state inchangé', late.err === undefined && JSON.stringify(late.r.state) === JSON.stringify(kOk.state))
const lateC = await act(kOk, P[2], { type: 'counter' })
ok('CONTRE-KEMS tardif : ignoré sans erreur', lateC.err === undefined && JSON.stringify(lateC.r.state) === JSON.stringify(kOk.state))
ok('swap tardif (reveal) : ignoré sans erreur', (await act(kOk, P[0], { type: 'swap', give: 'a', take: 'b' })).err === undefined)
ok('KEMS par un joueur du banc → not_in_match', (await act(K, P[5], { type: 'kems' })).err === 'not_in_match')

// ----------------------------------------------------------------------------- CONTRE-KEMS
const C = base({ [P[0]]: SQ7 }) // rouge : P0 carré ; bleu : P2, P3
const cOk = must(await act(C, P[2], { type: 'counter' }), 'counter ok')
ok('CONTRE-KEMS réussi (2 équipes, cible implicite) : +1 à l’équipe qui contre',
  cOk.state.phase === 'reveal' && score(cOk, 'blue') === 1 && score(cOk, 'red') === 0 && cOk.state.call.type === 'counter' && cOk.state.call.ok === true && cOk.state.call.target === 'red')
ok('Contre réussi : counters_ok (celui qui crie), countered (équipe visée), tstats',
  cOk.server.pstats[P[2]].counters_ok === 1 && cOk.server.pstats[P[0]].countered === 1 && cOk.server.pstats[P[1]].countered === 1 &&
    cOk.state.tstats.blue.counters === 1 && cOk.state.tstats.red.countered === 1)
const cKo = must(await act(base({}), P[2], { type: 'counter', team: 'red' }), 'counter ko')
ok('CONTRE-KEMS raté : +1 pour l’autre équipe, false_counters', score(cKo, 'red') === 1 && score(cKo, 'blue') === 0 && cKo.server.pstats[P[2]].false_counters === 1 && cKo.state.tstats.blue.errors === 1)
ok('Contre : équipe visée explicite = même résultat à 2 équipes', must(await act(C, P[3], { type: 'counter', team: 'red' }), 'c').state.call.ok === true)
ok('Contre sur sa propre équipe → invalid_action', (await act(C, P[2], { type: 'counter', team: 'blue' })).err === 'invalid_action')
ok('Contre sur une équipe inconnue → invalid_action', (await act(C, P[2], { type: 'counter', team: 'purple' })).err === 'invalid_action')
const C4 = rig(G8, { [P[4]]: SQ9 })
ok('4 équipes : contre sans cible → invalid_action', (await act(C4, P[0], { type: 'counter' })).err === 'invalid_action')
const c4Ok = must(await act(C4, P[0], { type: 'counter', team: 'green' }), 'c4ok')
ok('4 équipes : contre réussi sur le vert (carré chez P4) : +1 au rouge', scores(c4Ok) === '1,0,0,0' && c4Ok.state.call.target === 'green')
const c4Ko = must(await act(C4, P[0], { type: 'counter', team: 'yellow' }), 'c4ko')
ok('4 équipes : contre raté sur le jaune : +1 à chacune des 3 autres équipes (bleu, vert, jaune)', scores(c4Ko) === '0,1,1,1', scores(c4Ko))
const c3Ok = must(await act(rig(G6, { [P[2]]: SQ7 }), P[4], { type: 'counter', team: 'blue' }), 'c3')
ok('3 équipes : contre réussi sur le bleu', scores(c3Ok) === '0,0,1' && c3Ok.state.call.team === 'green')
// contre sur une équipe dont le carré est chez le coéquipier de celui qui contre : inutile (c'est une autre équipe)
ok('contre sur une équipe avec un carré chez l’un OU l’autre : réussi', must(await act(base({ [P[3]]: SQ9 }), P[0], { type: 'counter' }), 'c').state.call.ok === true)

// ----------------------------------------------------------------------------- révélation, manche suivante
ok('hôte : next en reveal → manche 2, nouvelle distribution', await (async () => {
  const n = must(await act(kOk, P[0], { type: 'next' }, { host: true }), 'next')
  return n.state.phase === 'playing' && n.state.round === 2 && n.state.center.length === 4 && n.state.call === null && n.state.feed.length === 0 && allCards(n).length === 32 && n.state.teams[0].score === 1
})())
ok('next par un non-hôte → not_host', (await act(kOk, P[0], { type: 'next' })).err === 'not_host')
ok('next hors reveal : ignoré', (await act(K, P[0], { type: 'next' }, { host: true })).r?.state.phase === 'playing')
const tkRev0 = must(await act(kOk, P[0], { type: 'tick' }), 'tkRev0')
ok('tick pendant la révélation (avant 6 s) : inchangé', tkRev0.state.phase === 'reveal')
const tkRev = must(await act(pastDl(kOk), P[0], { type: 'tick' }), 'tkRev')
ok('tick après la révélation : manche suivante, scores conservés', tkRev.state.phase === 'playing' && tkRev.state.round === 2 && scores(tkRev) === '1,0')
ok('manche 2 : nouveau secret pour chaque joueur (round 2, v incrémenté)', P.slice(0, 4).every((p) => tkRev.secrets[p].round === 2 && tkRev.secrets[p].v === kOk.state.hand_ver[p] + 1))
const tkRev2 = must(await act(tkRev, P[1], { type: 'tick' }), 'tkRev2')
ok('tick rejoué : idempotent (toujours manche 2)', tkRev2.state.round === 2 && JSON.stringify(tkRev2.state.center) === JSON.stringify(tkRev.state.center))

// ----------------------------------------------------------------------------- manche blanche
const roundPast = { ...rig(G), state: { ...rig(G).state, round_deadline: new Date(Date.now() - 1000).toISOString() } }
const blank = must(await act(roundPast, P[0], { type: 'tick' }), 'blank')
ok('manche blanche (3 min sans appel) : reveal sans point, call timeout', blank.state.phase === 'reveal' && blank.state.call.type === 'timeout' && scores(blank) === '0,0' && blank.state.call.ok === false)
ok('manche blanche : mains révélées', Object.keys(blank.state.call.hands).length === 4)
const blankNext = must(await act(pastDl(blank), P[0], { type: 'tick' }), 'blankNext')
ok('manche blanche → on redistribue (manche 2)', blankNext.state.phase === 'playing' && blankNext.state.round === 2)
ok('manche blanche prioritaire sur le balayage auto', blank.state.sweeps === 0)

// ----------------------------------------------------------------------------- fin de partie
const near = (st, red, blue) => ({ ...st, state: { ...st.state, teams: st.state.teams.map((t) => ({ ...t, score: { red, blue }[t.id] ?? t.score })) } })
const fin = must(await act(near(K, 4, 0), P[1], { type: 'kems' }), 'fin')
ok('objectif atteint : phase finished + results + winners', fin.state.phase === 'finished' && Array.isArray(fin.results) && fin.state.winners.join() === 'red' && score(fin, 'red') === 5)
ok('state.results recopié, call conservé (révélation finale)', fin.state.results.length === 4 && fin.state.call.type === 'kems' && fin.state.call.hands[P[0]].length === 4)
const res = (st, pid) => st.results.find((x) => x.profile_id === pid)
ok('gagnants : won, placement 1, points = score ; perdants placement 2',
  [P[0], P[1]].every((p) => res(fin, p).won && res(fin, p).placement === 1 && res(fin, p).points === 5) && [P[2], P[3]].every((p) => !res(fin, p).won && res(fin, p).placement === 2 && res(fin, p).points === 0))
ok('results : membres d’équipe seulement', sameSet(fin.results.map((x) => x.profile_id), P.slice(0, 4)))
const STAT_KEYS = ['false_kems', 'countered', 'false_counters', 'squares', 'team_kems', 'counters_ok', 'fast_kems', 'clean_win', 'double_kems']
ok('stats : les 9 compteurs sont présents et entiers', fin.results.every((x) => STAT_KEYS.every((k) => Number.isInteger(x.stats[k]))))
ok('clean_win : victoire sans erreur ni contre subi', [P[0], P[1]].every((p) => res(fin, p).stats.clean_win === 1) && [P[2], P[3]].every((p) => res(fin, p).stats.clean_win === 0))
const dirty = { ...near(K, 4, 0), state: { ...near(K, 4, 0).state, tstats: { red: { kems: 0, counters: 0, errors: 1, countered: 0 }, blue: { kems: 0, counters: 0, errors: 0, countered: 0 } } } }
ok('clean_win : pas de poker face après une erreur de l’équipe', res(must(await act(dirty, P[1], { type: 'kems' }), 'd'), P[0]).stats.clean_win === 0)
const countered = { ...near(K, 4, 0), state: { ...near(K, 4, 0).state, tstats: { red: { kems: 0, counters: 0, errors: 0, countered: 1 }, blue: { kems: 0, counters: 0, errors: 0, countered: 0 } } } }
ok('clean_win : pas de poker face après un contre subi', res(must(await act(countered, P[1], { type: 'kems' }), 'd'), P[0]).stats.clean_win === 0)
// faute qui offre la victoire à une autre équipe
const gift = must(await act(near(base({}), 0, 4), P[0], { type: 'kems' }), 'gift')
ok('faute : l’autre équipe atteint l’objectif et gagne', gift.state.phase === 'finished' && gift.state.winners.join() === 'blue')
// co-vainqueurs : 3 équipes, rouge fait une faute avec bleu et vert à 4
const co = must(await act(near3(rig(G6), 0, 4, 4), P[0], { type: 'kems' }), 'co')
function near3(st, r, b, g) {
  return { ...st, state: { ...st.state, teams: st.state.teams.map((t) => ({ ...t, score: { red: r, blue: b, green: g }[t.id] })) } }
}
ok('plusieurs équipes atteignent l’objectif sur la même manche : co-vainqueurs',
  co.state.phase === 'finished' && sameSet(co.state.winners, ['blue', 'green']) && co.results.filter((x) => x.won).length === 4 && co.results.filter((x) => x.placement === 1).length === 4)
ok('co-vainqueurs : le perdant est placé 2e', co.results.filter((x) => x.placement === 2).length === 2)
const dbl7 = must(await act(near(base({ [P[0]]: SQ7, [P[1]]: SQ9 }), 4, 0), P[1], { type: 'kems' }), 'dbl7')
ok('Double Kems à 4 points : 6, victoire', dbl7.state.phase === 'finished' && score(dbl7, 'red') === 6)
ok('objectif 3 respecté', must(await act(near(await playing(T4, { target: 3 }, P.slice(0, 4)).then((s) => rig(s, { [P[0]]: SQ7 })), 2, 0), P[1], { type: 'kems' }), 'o3').state.phase === 'finished')
ok('actions inconnues → unknown_action', (await act(G, P[0], { type: 'danse' })).err === 'unknown_action')

// catalogue
const tenue = (await db.query(`select game_id, condition_type, threshold, emoji from public.tenues where id = 'cowboy'`)).rows[0]
ok('catalogue : tenue cowboy (10 victoires à kems)', tenue?.game_id === 'kems' && tenue.condition_type === 'game_wins' && tenue.threshold === 10 && tenue.emoji === '🤠')
const tr = (await db.query(`select slot, id, rule from public.trophies where tenue_id = 'cowboy' and game_id = 'kems' and active order by slot`)).rows
ok('catalogue : 11 trophées kems actifs (slots 2 à 12)', tr.length === 11 && tr[0].slot === 2 && tr[10].slot === 12, String(tr.length))
ok('trophées : toutes les stats du catalogue sont posées par le moteur', tr.filter((t) => t.rule.stat && t.rule.stat !== 'won').every((t) => STAT_KEYS.includes(t.rule.stat)), JSON.stringify(tr.map((t) => t.rule.stat)))

console.log(failed ? '\nÉCHEC' : '\nTout est OK')
process.exit(failed ? 1 : 0)
