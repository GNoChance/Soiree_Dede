// Tests SQL du jeu « Échecs » (PGlite) : node echecs.mjs ../../supabase/install.sql
// Moteur (perft, règles), hooks du socle duel, pendule, coup auto, abandon / nul, trophées,
// et non-régression des autres jeux en duel (turn_seconds, hook board_offturn).
import { bootDb } from './boot.mjs'

const file = process.argv[2]
if (!file) throw new Error('usage : node echecs.mjs <install.sql>')
const db = await bootDb(file)

let failed = false
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK   ' : 'ÉCHEC'} ${name}${cond ? '' : ' ' + extra}`)
  if (!cond) failed = true
}
const q1 = async (sql, params = []) => (await db.query(sql, params)).rows[0]
const P = (await db.query(`select id from public.profiles order by sort_order limit 4`)).rows.map((r) => r.id)

// ----------------------------------------------------------------------------- perft
await db.exec(`create or replace function public._t_perft(p_pos jsonb, d integer) returns bigint language plpgsql as $$
declare n bigint := 0; m integer; l integer[];
begin
  l := public._echecs_legal_moves(p_pos->>'sq', p_pos->>'side', p_pos->>'castle', (p_pos->>'ep')::integer);
  if d = 1 then return cardinality(l); end if;
  foreach m in array l loop n := n + public._t_perft(public._echecs_apply(p_pos, m), d - 1); end loop;
  return n;
end $$;`)
const perft = async (fen, d) => Number((await q1(`select public._t_perft(public._echecs_fen($1), $2) n`, [fen, d])).n)
const PERFT = [
  ['initiale', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', [20, 400, 8902]],
  ['Kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039]],
  ['finale (position 3)', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812]],
  ['position 4 (promotions)', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264]],
  ['position 5', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486]],
]
for (const [name, fen, expected] of PERFT) {
  for (let d = 1; d <= expected.length; d++) {
    const t0 = Date.now()
    const n = await perft(fen, d)
    ok(`perft ${name} profondeur ${d} = ${expected[d - 1]} (${Date.now() - t0} ms)`, n === expected[d - 1], `obtenu ${n}`)
  }
}

// ----------------------------------------------------------------------------- outils de partie
const SQ = (s) => (8 - Number(s[1])) * 8 + (s.charCodeAt(0) - 97)
const act = async (x, actor, action, host = false) => {
  try {
    const r = (await db.query(`select public.game_echecs_action($1::jsonb, $2::jsonb, $3::uuid, $4, $5::jsonb) r`,
      [JSON.stringify(x.state), JSON.stringify(x.server), actor, host, JSON.stringify(action)])).rows[0].r
    return { state: r.state, server: r.server, results: r.results }
  } catch (e) {
    return { err: e.message }
  }
}
const start = async (board = {}, extra = {}, players = P.slice(0, 2)) => {
  const r = (await db.query(`select public.game_echecs_start($1::uuid[], $2::jsonb) r`,
    [`{${players.join(',')}}`, JSON.stringify({ mode: 'duel', duel_players: players.slice(0, 2), board, ...extra })])).rows[0].r
  return act({ state: r.state, server: r.server }, P[0], { type: 'next' }, true)
}
const W = (x) => x.state.board.white
const B = (x) => x.state.board.black
const turnUid = (x) => (x.state.board.side === 'w' ? W(x) : B(x))
/** Joue un coup du joueur au trait : mv(x, 'e2', 'e4', {promo}) ; lève si erreur. */
const mv = async (x, from, to, extra = {}) => {
  const r = await act(x, turnUid(x), { type: 'move', move: { from: SQ(from), to: SQ(to), ...extra } })
  if (r.err) throw new Error(`${from}${to} : ${r.err}`)
  return r
}
const tryMv = (x, from, to, extra = {}) => act(x, turnUid(x), { type: 'move', move: { from: SQ(from), to: SQ(to), ...extra } })
const play = async (x, list) => {
  for (const m of list.split(' ')) x = await mv(x, m.slice(0, 2), m.slice(2, 4), m[4] ? { promo: m[4] } : {})
  return x
}
/** Remplace la position du plateau (FEN), trait = camp du FEN, répétitions remises à zéro. */
const setPos = async (x, fen) => {
  const pos = (await q1(`select public._echecs_fen($1) p`, [fen])).p
  const extra = (await q1(
    `select public._echecs_moves_json(public._echecs_legal_moves($1, $2, $3, $4)) m,
            public._echecs_attacked($1, strpos($1, case when $2 = 'w' then 'K' else 'k' end) - 1, case when $2 = 'w' then 'b' else 'w' end) c`,
    [pos.sq, pos.side, pos.castle, pos.ep])).m
  const chk = (await q1(`select public._echecs_attacked($1, strpos($1, case when $2 = 'w' then 'K' else 'k' end) - 1, case when $2 = 'w' then 'b' else 'w' end) c`, [pos.sq, pos.side])).c
  const state = structuredClone(x.state)
  Object.assign(state.board, pos, { moves: extra, check: chk, last: null, draw_offer: null })
  state.duel.turn = pos.side === 'w' ? state.board.white : state.board.black
  const server = structuredClone(x.server)
  server.board.positions = {}
  return { state, server }
}
const movesFrom = (x, s) => (x.state.board.moves[String(SQ(s))] ?? []).map(Number)
const ago = (sec) => new Date(Date.now() - sec * 1000).toISOString()
const secsTo = (iso) => (new Date(iso).getTime() - Date.now()) / 1000

// ----------------------------------------------------------------------------- démarrage
let g = await start()
ok('départ : phase playing, Blancs = starter, trait aux Blancs', g.state.phase === 'playing' && W(g) === g.state.duel.starter && g.state.duel.turn === W(g) && g.state.board.side === 'w')
ok('départ : 20 coups publiés (16 pièces mobiles : 10 cases de départ)', Object.values(g.state.board.moves).flat().length === 20 && Object.keys(g.state.board.moves).length === 10)
ok('départ : cadence rapid5 par défaut, pendules à 300 000 ms', g.state.board.cadence === 'rapid5' && g.state.board.clock[W(g)] === 300000 && g.state.board.clock[B(g)] === 300000)
ok('départ : échéance = pendule des Blancs (~300 s)', Math.abs(secsTo(g.state.deadline) - 300) < 3, String(secsTo(g.state.deadline)))
ok('départ : position initiale comptée une fois', Object.values(g.server.board.positions).join() === '1')
ok('cadence inconnue -> rapid5', (await start({ cadence: 'zzz' })).state.board.cadence === 'rapid5')
ok('cadence blitz3 -> 180 s', Math.abs(secsTo((await start({ cadence: 'blitz3' })).state.deadline) - 180) < 3)
ok('cadence slow10 -> 600 s', Math.abs(secsTo((await start({ cadence: 'slow10' })).state.deadline) - 600) < 3)
const gn = await start({ cadence: 'none' })
ok('sans pendule : 60 s par coup, pas de pendule', Math.abs(secsTo(gn.state.deadline) - 60) < 3 && gn.state.board.clock === null)

// ----------------------------------------------------------------------------- format strict
const bad = async (name, move, code = 'invalid_move') => {
  const r = await act(g, W(g), { type: 'move', move })
  ok(`refus ${name} -> ${code}`, r.err === code, r.err ?? 'accepté')
}
await bad('clé en trop', { from: SQ('e2'), to: SQ('e4'), x: 1 })
await bad('from en texte', { from: String(SQ('e2')), to: SQ('e4') })
await bad('from décimal', { from: 52.5, to: SQ('e4') })
await bad('to = 64', { from: SQ('e2'), to: 64 })
await bad('to négatif', { from: SQ('e2'), to: -1 })
await bad('coup illégal (e2-e5)', { from: SQ('e2'), to: SQ('e5') })
await bad('pièce adverse', { from: SQ('e7'), to: SQ('e5') })
await bad('promo sur un coup normal', { from: SQ('e2'), to: SQ('e4'), promo: 'q' })
await bad('offer_draw non booléen', { from: SQ('e2'), to: SQ('e4'), offer_draw: 1 })
await bad('type inconnu', { type: 'pass' })
await bad('flag avant l’heure', { type: 'flag' })
ok('coup du joueur qui n’est pas au trait -> not_your_turn', (await act(g, B(g), { type: 'move', move: { from: SQ('e7'), to: SQ('e5') } })).err === 'not_your_turn')
ok('spectateur -> not_duelist', (await act(g, P[2] ?? P[0], { type: 'move', move: { type: 'resign' } })).err === (P[2] ? 'not_duelist' : 'not_your_turn'))

// ----------------------------------------------------------------------------- mat du berger
let x = await play(g, 'e2e4 e7e5 f1c4 b8c6 d1h5 g8f6')
ok('coup publié : last + recopie dans duel.last_move', x.state.board.last.from === SQ('g8') && x.state.board.last.to === SQ('f6') && x.state.duel.last_move.move.from === SQ('g8'))
x = await mv(x, 'h5', 'f7')
ok('berger : mat, victoire des Blancs', x.state.phase === 'result' && x.state.duel.outcome === 'win' && x.state.duel.winner === W(g) && x.state.board.end.reason === 'mate' && x.state.board.check === true)
ok('berger : plus de coups publiés, prise comptée', Object.keys(x.state.board.moves).length === 0 && x.state.board.captured.w === 'p')
const gx = x.state.duel.games[0].x
ok('berger : bilan de manche (game) rangé par le socle', gx.reason === 'mate' && gx.p[W(g)].moves === 4 && gx.p[W(g)].captures === 1 && gx.p[B(g)].moves === 3, JSON.stringify(gx))
const fin = await act(x, P[0], { type: 'next' }, true)
const st = (id) => fin.results.find((r) => r.profile_id === id).stats
ok('fin de session : stats trophées du vainqueur (mates, fast_mates, duel_wins)', st(W(g)).mates === 1 && st(W(g)).fast_mates === 1 && st(W(g)).duel_wins === 1 && st(W(g)).captures === 1 && st(W(g)).max_moves === 4, JSON.stringify(st(W(g))))
ok('fin de session : stats du maté (fast_mated)', st(B(g)).fast_mated === 1 && st(B(g)).mates === 0 && st(B(g)).duel_wins === 0, JSON.stringify(st(B(g))))
ok('fin de session : les 10 compteurs présents', ['fast_mated', 'queens_lost', 'stalemate_blunders', 'captures', 'max_moves', 'castles', 'en_passants', 'promotions', 'mates', 'fast_mates'].every((k) => k in st(W(g))))
ok('coup après la fin de manche -> wrong_phase', (await act(x, B(g), { type: 'move', move: { from: SQ('a7'), to: SQ('a6') } })).err === 'wrong_phase')

// ----------------------------------------------------------------------------- mat prioritaire, pat
x = await mv(await setPos(g, '7k/8/6K1/8/8/8/8/R7 w - - 99 80'), 'a1', 'a8')
ok('mat au 100e demi-coup : le mat prime sur les 50 coups', x.state.board.end?.reason === 'mate' && x.state.duel.winner === W(g))
x = await mv(await setPos(g, '7k/5K2/8/6Q1/8/8/8/8 w - - 0 1'), 'g5', 'g6')
ok('pat : nul', x.state.duel.outcome === 'draw' && x.state.board.end.reason === 'stalemate')
ok('pat avec 9 points d’avance : stalemate_blunders', x.state.duel.games[0].x.p[W(g)].stalemate_blunders === 1)

// ----------------------------------------------------------------------------- nuls automatiques
x = await play(g, 'g1f3 g8f6 f3g1 f6g8 g1f3 g8f6 f3g1')
ok('répétition : pas encore (2e fois)', x.state.phase === 'playing')
x = await mv(x, 'f6', 'g8')
ok('répétition triple : nul', x.state.duel.outcome === 'draw' && x.state.board.end.reason === 'repetition')
x = await mv(await setPos(g, '7k/8/8/8/8/8/R7/K7 w - - 99 80'), 'a2', 'a3')
ok('50 coups (demi-coups à 100) : nul', x.state.board.end?.reason === 'fifty' && x.state.board.half === 100)
x = await mv(await setPos(g, '7k/8/8/8/8/8/R7/K7 w - - 98 80'), 'a2', 'a3')
ok('99 demi-coups : la partie continue', x.state.phase === 'playing' && x.state.board.half === 99)
x = await mv(await setPos(g, '7k/8/8/8/8/8/K7/R6p w - - 98 80'), 'a1', 'h1')
ok('prise : compteur des 50 coups remis à 0', x.state.board.half === 0 && x.state.board.captured.w === 'p')
const material = async (name, fen, from, to, draw) => {
  const r = await mv(await setPos(g, fen), from, to)
  ok(`matériel ${name} : ${draw ? 'nul' : 'la partie continue'}`, draw ? r.state.board.end?.reason === 'material' : r.state.phase === 'playing', JSON.stringify(r.state.board.end))
}
await material('roi contre roi', '8/8/8/3k4/8/8/3p4/3K4 w - - 0 1', 'd1', 'd2', true)
await material('roi + fou contre roi', '8/8/8/3k4/8/8/3p4/3KB3 w - - 0 1', 'd1', 'd2', true)
await material('roi + cavalier contre roi', '8/8/8/3k4/8/8/3p4/3KN3 w - - 0 1', 'd1', 'd2', true)
await material('roi + fou contre roi + fou (même couleur)', '8/8/8/3k4/8/2b5/3p4/3KB3 w - - 0 1', 'e1', 'd2', true)
await material('roi + fou contre roi + fou (couleurs opposées)', '8/7b/8/3k4/8/8/3p4/3KB3 w - - 0 1', 'e1', 'd2', false)
await material('roi + 2 cavaliers contre roi', '8/8/8/3k4/8/8/3p4/3KNN2 w - - 0 1', 'd1', 'd2', false)

// ----------------------------------------------------------------------------- roque
x = await setPos(g, 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1')
ok('roque : petit et grand roques proposés', movesFrom(x, 'e1').includes(SQ('g1')) && movesFrom(x, 'e1').includes(SQ('c1')))
let y = await mv(x, 'e1', 'g1')
ok('petit roque : tour en f1, droits blancs perdus', y.state.board.sq[SQ('f1')] === 'R' && y.state.board.sq[SQ('g1')] === 'K' && y.state.board.sq[SQ('h1')] === '.' && y.state.board.castle === 'kq')
y = await mv(y, 'e8', 'c8')
ok('grand roque noir : tour en d8', y.state.board.sq[SQ('d8')] === 'r' && y.state.board.sq[SQ('c8')] === 'k' && y.state.board.sq[SQ('a8')] === '.' && y.state.board.castle === '')
ok('roque compté (castles)', y.server.board.tstats[W(g)].castles === 1 && y.server.board.tstats[B(g)].castles === 1)
x = await setPos(g, 'r3k2r/8/8/8/8/8/4r3/R3K2R w KQkq - 0 1')
ok('roque refusé : roi en échec', !movesFrom(x, 'e1').includes(SQ('g1')) && !movesFrom(x, 'e1').includes(SQ('c1')) && x.state.board.check === true)
x = await setPos(g, 'r3k2r/8/8/8/8/8/5r2/R3K2R w KQkq - 0 1')
ok('roque refusé : case traversée (f1) attaquée ; grand roque permis', !movesFrom(x, 'e1').includes(SQ('g1')) && movesFrom(x, 'e1').includes(SQ('c1')))
ok('roque refusé par le serveur même si envoyé', (await tryMv(x, 'e1', 'g1')).err === 'invalid_move')
x = await setPos(g, 'r3k2r/8/8/8/8/8/6r1/R3K2R w KQkq - 0 1')
ok('roque refusé : case d’arrivée (g1) attaquée', !movesFrom(x, 'e1').includes(SQ('g1')))
x = await setPos(g, 'r3k2r/8/8/8/8/8/1r6/R3K2R w KQkq - 0 1')
ok('grand roque permis avec b1 attaquée', movesFrom(x, 'e1').includes(SQ('c1')))
x = await setPos(g, 'r3k2r/8/8/8/8/8/8/RN2K2R w KQkq - 0 1')
ok('grand roque refusé : b1 occupée', !movesFrom(x, 'e1').includes(SQ('c1')))
x = await play(await setPos(g, 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'), 'h1g1 a8b8 g1h1 b8a8')
ok('roque refusé : tour déjà bougée (même revenue)', !movesFrom(x, 'e1').includes(SQ('g1')) && movesFrom(x, 'e1').includes(SQ('c1')) && x.state.board.castle === 'Qk')
x = await play(await setPos(g, 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'), 'e1f1 a8b8 f1e1 b8a8')
ok('roque refusé : roi déjà bougé', !movesFrom(x, 'e1').includes(SQ('g1')) && !movesFrom(x, 'e1').includes(SQ('c1')))
x = await play(await setPos(g, 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'), 'a1a8')
ok('prise de la tour a8 : droit q perdu', x.state.board.castle === 'Kk')

// ----------------------------------------------------------------------------- prise en passant
x = await play(g, 'e2e4 a7a6 e4e5 d7d5')
ok('en passant proposé juste après la poussée de deux cases', movesFrom(x, 'e5').includes(SQ('d6')) && x.state.board.ep === SQ('d6'))
y = await mv(x, 'e5', 'd6')
ok('en passant : pion d5 retiré, compté', y.state.board.sq[SQ('d5')] === '.' && y.state.board.sq[SQ('d6')] === 'P' && y.state.board.captured.w === 'p' && y.server.board.tstats[W(g)].en_passants === 1)
y = await play(x, 'h2h3 h7h6')
ok('en passant refusé un coup trop tard', !movesFrom(y, 'e5').includes(SQ('d6')) && (await tryMv(y, 'e5', 'd6')).err === 'invalid_move')
x = await setPos(g, '8/8/8/8/k2Pp2R/8/8/K7 b - d3 0 1')
ok('en passant illégal (clouage horizontal du roi)', !movesFrom(x, 'e4').includes(SQ('d3')))

// ----------------------------------------------------------------------------- promotion
x = await setPos(g, '7k/P7/8/8/8/8/8/K7 w - - 0 1')
ok('promotion : une seule case publiée pour le pion', movesFrom(x, 'a7').join() === String(SQ('a8')))
ok('promotion sans promo -> promotion_required', (await tryMv(x, 'a7', 'a8')).err === 'promotion_required')
ok('promo invalide -> invalid_move', (await tryMv(x, 'a7', 'a8', { promo: 'k' })).err === 'invalid_move')
y = await mv(x, 'a7', 'a8', { promo: 'n' })
ok('sous-promotion en cavalier', y.state.board.sq[SQ('a8')] === 'N' && y.server.board.tstats[W(g)].promotions === 1)
y = await mv(x, 'a7', 'a8', { promo: 'q' })
ok('promotion en dame (donne échec)', y.state.board.sq[SQ('a8')] === 'Q' && y.state.board.check === true)
x = await setPos(g, '1r5k/P7/8/8/8/8/8/K7 w - - 0 1')
y = await mv(x, 'a7', 'b8', { promo: 'r' })
ok('promotion en prenant (tour)', y.state.board.sq[SQ('b8')] === 'R' && y.state.board.captured.w === 'r')

// ----------------------------------------------------------------------------- pendule
x = structuredClone(g)
x.state.board.turn_started_at = ago(10)
y = await mv(x, 'e2', 'e4')
ok('pendule : 10 s décomptés aux Blancs', Math.abs(y.state.board.clock[W(g)] - 290000) < 1500, String(y.state.board.clock[W(g)]))
ok('pendule : échéance = pendule des Noirs', Math.abs(secsTo(y.state.deadline) - 300) < 3 && y.state.board.clock[B(g)] === 300000)
x = structuredClone(y)
x.state.board.turn_started_at = ago(299)
ok('flag refusé avant l’heure (1 s restante)', (await act(x, B(g), { type: 'move', move: { type: 'flag' } })).err === 'invalid_move')
x.state.board.turn_started_at = ago(301)
x.state.deadline = ago(1)
y = await act(x, P[0], { type: 'tick' })
ok('chute du drapeau (tick) : défaite des Noirs au temps', y.state.phase === 'result' && y.state.duel.winner === W(g) && y.state.board.end.reason === 'time' && y.state.board.clock[B(g)] === 0 && y.state.duel.last_move.auto === true, JSON.stringify(y.state.board.end ?? y.err))
y = await act(x, B(g), { type: 'move', move: { from: SQ('e7'), to: SQ('e5') } })
ok('coup joué après la chute du drapeau = défaite au temps', y.state.board.end?.reason === 'time' && y.state.duel.winner === W(g))
x = await setPos(g, '7k/8/8/8/8/8/8/KQ6 b - - 0 1')
x.state.board.turn_started_at = ago(301)
x.state.deadline = ago(1)
y = await act(x, P[0], { type: 'tick' })
ok('temps écoulé des Noirs, Blancs avec dame : défaite', y.state.board.end?.reason === 'time' && y.state.duel.winner === W(g))
x = await setPos(g, '7k/8/8/8/8/8/8/KN6 b - - 0 1')
x.state.board.turn_started_at = ago(301)
x.state.deadline = ago(1)
y = await act(x, P[0], { type: 'tick' })
ok('temps écoulé, adversaire roi + cavalier : nul', y.state.board.end?.reason === 'time' && y.state.duel.outcome === 'draw')
x = await setPos(g, 'k7/8/8/8/8/8/8/K7 w - - 0 1')
ok('position de départ forcée : roi contre roi ne s’arrête pas sans coup', x.state.phase === 'playing')
ok('tick avant l’échéance : sans effet', (await act(g, P[0], { type: 'tick' })).state.board.side === 'w')

// ----------------------------------------------------------------------------- sans pendule : coup auto
x = structuredClone(gn)
x.state.deadline = ago(1)
y = await act(x, P[0], { type: 'tick' })
ok('sans pendule : coup légal joué au hasard à l’échéance', y.state.board.side === 'b' && y.state.duel.last_move.auto === true && Object.values(gn.state.board.moves).flat().length === 20 &&
  (gn.state.board.moves[String(y.state.duel.last_move.move.from)] ?? []).includes(y.state.duel.last_move.move.to))
ok('sans pendule : prochaine échéance 60 s', Math.abs(secsTo(y.state.deadline) - 60) < 3)
const autoCheck = async (name, fen) => {
  const xx = await setPos(gn, fen)
  const r = await q1(`select count(*) filter (where not coalesce((b->'moves'->(m->>'from')) @> to_jsonb((m->>'to')::integer), false)
                                           or ((m ? 'promo') <> (upper(substr(b->>'sq', (m->>'from')::integer + 1, 1)) = 'P' and (m->>'to')::integer / 8 in (0, 7)))
                                           or (m ? 'promo' and m->>'promo' <> 'q')) bad,
                             count(distinct m) n
                        from (select $1::jsonb b) t, generate_series(1, 1000) i,
                             lateral (select public.game_echecs_board_auto(t.b || jsonb_build_object('_i', i), null, $2) m) a`, [JSON.stringify(xx.state.board), turnUid(xx)])
  ok(`board_auto toujours légal (1 000 tirages, ${name}, ${r.n} coups distincts)`, Number(r.bad) === 0 && Number(r.n) > 1, JSON.stringify(r))
}
await autoCheck('Kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1')
await autoCheck('promotions', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 b kq - 0 1')
x = structuredClone(g)
x.state.board.turn_started_at = ago(400)
ok('board_auto pendule écoulée -> flag', (await q1(`select public.game_echecs_board_auto($1::jsonb, null, $2) m`, [JSON.stringify(x.state.board), W(g)])).m.type === 'flag')

// ----------------------------------------------------------------------------- abandon, nul
y = await act(g, B(g), { type: 'move', move: { type: 'resign' } })
ok('abandon hors de son tour (Noirs au trait des Blancs) : victoire des Blancs', y.state?.board.end?.reason === 'resign' && y.state.duel.winner === W(g), y.err)
y = await act(g, W(g), { type: 'move', move: { type: 'resign' } })
ok('abandon à son tour', y.state.board.end.reason === 'resign' && y.state.duel.winner === B(g))
ok('abandon avec clé en trop -> invalid_move', (await act(g, B(g), { type: 'move', move: { type: 'resign', x: 1 } })).err === 'invalid_move')
ok('flag hors de son tour -> not_your_turn', (await act(g, B(g), { type: 'move', move: { type: 'flag' } })).err === 'not_your_turn')
ok('accept_draw sans proposition -> no_draw_offer', (await act(g, W(g), { type: 'move', move: { type: 'accept_draw' } })).err === 'no_draw_offer')
x = await mv(g, 'e2', 'e4', { offer_draw: true })
ok('nul proposé avec le coup', x.state.board.draw_offer === W(g))
ok('accept_draw hors de son tour -> not_your_turn', (await act(x, W(g), { type: 'move', move: { type: 'accept_draw' } })).err === 'not_your_turn')
y = await act(x, B(g), { type: 'move', move: { type: 'accept_draw' } })
ok('nul accepté : nul d’un commun accord', y.state.duel.outcome === 'draw' && y.state.board.end.reason === 'agreement')
y = await mv(x, 'e7', 'e5')
ok('nul ignoré (l’adversaire joue) : la proposition tombe', y.state.board.draw_offer === null)
ok('… puis accept_draw -> no_draw_offer', (await act(y, W(g), { type: 'move', move: { type: 'accept_draw' } })).err === 'no_draw_offer')
y = await mv(x, 'e7', 'e5', { offer_draw: true })
ok('contre-proposition : le Noir propose à son tour', y.state.board.draw_offer === B(g))

// ----------------------------------------------------------------------------- dame perdue, session en 3 manches
x = await play(g, 'e2e4 d7d5 e4d5 d8d5 b1c3 a7a6 c3d5')
ok('dame prise : queens_lost / captures', x.server.board.tstats[B(g)].queens_lost === 1 && x.server.board.tstats[W(g)].captures === 2 && x.state.board.captured.w === 'pq')
let s3 = await start({}, { best_of: 3 })
const w1 = W(s3)
s3 = await act(s3, B(s3), { type: 'move', move: { type: 'resign' } })
ok('BO3 manche 1 : abandon, pas encore fini', s3.state.phase === 'result' && !s3.state.duel.result)
s3 = await act(s3, P[0], { type: 'next' }, true)
ok('BO3 manche 2 : couleurs inversées', s3.state.phase === 'playing' && W(s3) !== w1 && s3.state.duel.game_no === 2 && s3.state.board.sq.startsWith('rnbqkbnr'))
s3 = await act(s3, W(s3), { type: 'move', move: { type: 'resign' } })
ok('BO3 : 2 manches à 0 pour le même joueur = duel gagné', s3.state.duel.result?.winner === w1, JSON.stringify(s3.state.duel.wins))
s3 = await act(s3, P[0], { type: 'next' }, true)
ok('BO3 : fin de session, duel_wins = 1', s3.state.phase === 'finished' && s3.results.find((r) => r.profile_id === w1).stats.duel_wins === 1)

// ----------------------------------------------------------------------------- performance
{
  let t = await play(g, 'e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 d2d3 f8c5')
  const t0 = Date.now()
  for (const m of ['c2c3', 'd7d6', 'b1d2', 'a7a6', 'a2a4', 'c8e6', 'h2h3', 'h7h6']) t = await mv(t, m.slice(0, 2), m.slice(2, 4))
  console.log(`      (temps moyen d’un coup complet sous PGlite : ${Math.round((Date.now() - t0) / 8)} ms)`)
}

// ----------------------------------------------------------------------------- non-régression des autres duels
const startGame = async (id, opts) => {
  const fn = `game_${id.replace(/-/g, '_')}_start`
  const r = (await db.query(`select public.${fn}($1::uuid[], $2::jsonb) r`, [`{${P.slice(0, 3).join(',')}}`, JSON.stringify(opts)])).rows[0].r
  const a = (await db.query(`select public.game_${id.replace(/-/g, '_')}_action($1::jsonb, $2::jsonb, $3::uuid, true, '{"type":"next"}'::jsonb) r`,
    [JSON.stringify(r.state), JSON.stringify(r.server), P[0]])).rows[0].r
  return a
}
const actG = async (id, x2, actor, action) => {
  try {
    return (await db.query(`select public.game_${id.replace(/-/g, '_')}_action($1::jsonb, $2::jsonb, $3::uuid, false, $4::jsonb) r`,
      [JSON.stringify(x2.state), JSON.stringify(x2.server), actor, JSON.stringify(action)])).rows[0].r
  } catch (e) {
    return { err: e.message }
  }
}
for (const id of ['quatre-a-la-suite', 'morpion']) {
  const s0 = await startGame(id, {})
  ok(`${id} : mode par défaut king`, s0.state.session.mode === 'king')
  ok(`${id} : 1er coup, échéance 30 s (turn_seconds de session)`, s0.state.phase === 'playing' && Math.abs(secsTo(s0.state.deadline) - 30) < 3)
  const turn = s0.state.duel.turn
  const other = turn === s0.state.duel.a ? s0.state.duel.b : s0.state.duel.a
  const move = id === 'morpion' ? { type: 'move', move: { cell: 4 } } : { type: 'move', move: { col: 3 } }
  const s1 = await actG(id, s0, turn, move)
  ok(`${id} : après un coup, échéance 30 s, tour à l’autre`, !s1.err && s1.state.duel.turn === other && Math.abs(secsTo(s1.state.deadline) - 30) < 3, s1.err ?? '')
  ok(`${id} : coup hors de son tour -> not_your_turn (pas de hook board_offturn)`, (await actG(id, s1, turn, move)).err === 'not_your_turn')
  const s2 = await startGame(id, { turn_seconds: 45 })
  ok(`${id} : option turn_seconds 45 respectée`, Math.abs(secsTo(s2.state.deadline) - 45) < 3)
  const s3b = structuredClone(s0)
  s3b.state.deadline = ago(1)
  const s4 = await actG(id, s3b, P[0], { type: 'tick' })
  ok(`${id} : coup auto à l’échéance, échéance suivante 30 s`, !s4.err && s4.state.duel.last_move?.auto === true && Math.abs(secsTo(s4.state.deadline) - 30) < 3, s4.err ?? '')
}
{
  const s0 = await startGame('bataille-navale', { mode: 'duel', turn_seconds: 40 })
  ok('bataille-navale : phase setup', s0.state.phase === 'setup')
  const s1 = structuredClone(s0)
  s1.state.deadline = ago(1)
  const s2 = await actG('bataille-navale', s1, P[0], { type: 'tick' })
  ok('bataille-navale : fin de préparation, échéance = turn_seconds de session (40 s)', !s2.err && s2.state.phase === 'playing' && Math.abs(secsTo(s2.state.deadline) - 40) < 3, s2.err ?? s2.state?.phase)
}

console.log(failed ? '\nDES TESTS ONT ÉCHOUÉ' : '\nTous les tests passent')
process.exit(failed ? 1 : 0)
