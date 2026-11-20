// Échecs (2b) : livre d'ouvertures appris (habitude repérée à la 3e partie, oubliée en 5), E1 (ne se fait
// pas battre deux fois par le même début, même au niveau 10), E2 (vise les pièces mal gardées),
// pièces laissées sans protection, roque, dame sortie tôt, mats ; learnRate 0 -> pas d'indices ; taille.
import { BOT, ME, mkRng } from './util.mjs'
import { chessLog, SQ } from './echecs.why.mjs'

export default async function (S, { ok }) {
  const Lr = S.echecsLearner
  const M = S.memory
  let now = 5_000_000
  const learn = (mem, log) => M.learn(Lr, mem, log, (now += 60_000))
  const R = { type: 'resign' }
  const has = (mem, id) => Lr.insights(mem).some((i) => i.id === id)
  const ids = (mem) => JSON.stringify(Lr.insights(mem).map((i) => `${i.id}${i.use ? '🎯' : '👀'} ${i.text}`))

  // Habitude : 3 parties avec les Blancs qui commencent par e4 -> repérée ; 5 autres débuts -> oubliée.
  const opening = (u, reply = 'e7e5') => chessLog(S, { moves: [['me', u], ['bot', reply], ['me', R]] })
  let mem = Lr.empty()
  mem = learn(mem, opening('e2e4'))
  mem = learn(mem, opening('e2e4'))
  ok('Échecs : pas d’habitude après 2 parties', !has(mem, 'first:52-36'), ids(mem))
  mem = learn(mem, opening('e2e4'))
  const ins = Lr.insights(mem).find((i) => i.id === 'first:52-36')
  ok('Échecs : « Tu commences toujours par ton pion en e4. » à la 3e partie', ins?.text === 'Tu commences toujours par ton pion en e4.' && ins.use, ids(mem))
  for (const u of ['d2d4', 'g1f3', 'c2c4', 'b1c3', 'g2g3']) mem = learn(mem, opening(u))
  ok('Échecs : habitude oubliée après 5 débuts différents', !has(mem, 'first:52-36'), ids(mem))
  ok('Échecs : livre d’ouvertures rempli (clés courtes, couleur du bot)', Object.keys(mem.book).every((k) => /^[wb][A-Za-z0-9_-]+$/.test(k) && k.length % 2 === 1 && k.length <= 25), Object.keys(mem.book).join(' '))

  // Pièces laissées sans protection, dame sortie tôt, roque, mat du couloir.
  let mh = Lr.empty()
  const queenGift = () => chessLog(S, { moves: [['me', 'e2e4'], ['bot', 'd7d5'], ['me', 'd1g4'], ['bot', 'c8g4'], ['me', R]] })
  mh = learn(mh, queenGift())
  mh = learn(mh, queenGift())
  ok('Échecs : dame donnée comptée (hang.q ≈ 1,9)', mh.hang.q > 1.8, JSON.stringify(mh.hang))
  mh = learn(mh, queenGift())
  ok('Échecs : « Tu laisses parfois ta dame sans protection. » (🎯)', Lr.insights(mh).some((i) => i.id === 'hang:q' && i.use && i.text === 'Tu laisses parfois ta dame sans protection.'), ids(mh))
  ok('Échecs : « Tu sors ta dame très tôt. » (🎯)', Lr.insights(mh).some((i) => i.id === 'queenEarly' && i.use), ids(mh))
  mh = learn(mh, queenGift())
  mh = learn(mh, queenGift())
  ok('Échecs : « Tu oublies souvent de roquer. » (👀, n ≥ 4)', Lr.insights(mh).some((i) => i.id === 'castle' && !i.use), ids(mh))
  const couloir = () => chessLog(S, { fen: '4r1k1/5ppp/8/8/3Q4/8/5PPP/6K1 w - - 0 20', moves: [['me', 'd4a7'], ['bot', 'e8e1']] })
  let mc = Lr.empty()
  mc = learn(mc, couloir())
  mc = learn(mc, couloir())
  mc = learn(mc, couloir())
  ok('Échecs : « Le mat du couloir marche bien sur toi. » (👀)', Lr.insights(mc).some((i) => i.id === 'mates:couloir' && !i.use) && mc.mates.couloir >= 2, ids(mc))
  const castled = chessLog(S, { moves: [['me', 'e2e4'], ['bot', 'e7e5'], ['me', 'g1f3'], ['bot', 'b8c6'], ['me', 'f1c4'], ['bot', 'g8f6'], ['me', 'e1g1'], ['bot', 'f8c5'], ['me', R]] })
  ok('Échecs : roque compté', learn(Lr.empty(), castled).castle === 1)

  // E1 : le bot (Blancs, niveau 10) a perdu après son coup favori -> il ne le rejoue pas.
  const start = S.soloStart(S.echecs.local, { a: ME, b: BOT, first: BOT, options: { cadence: 'none' } }).state.board
  const m0 = S.echecsBot.chooseMove(start, BOT, 10, mkRng(1), 1e9)
  const u0 = 'abcdefgh'[m0.from % 8] + (8 - Math.floor(m0.from / 8)) + 'abcdefgh'[m0.to % 8] + (8 - Math.floor(m0.to / 8))
  const beaten = chessLog(S, { me: 'b', moves: [['bot', u0], ['me', 'e7e5'], ['bot', R]] })
  ok('Échecs : le bot perd après son coup favori', beaten.outcome === 'win')
  const mb = learn(Lr.empty(), beaten)
  const emptyLog = { ...beaten, entries: [], outcome: null }
  const h = Lr.hintsFor(mb, M.learnRate(10, mb.streak), start, emptyLog)
  ok('Échecs : indices du livre (coup déjà perdu)', !!h?.next && h.next[`${m0.from}-${m0.to}`]?.[2] >= 1, JSON.stringify(h))
  let avoided = 0
  let tagged = 0
  for (let k = 0; k < 6; k++) {
    const r = S.echecsBot.decide(start, BOT, 10, mkRng(100 + k), 1e9, h)
    if (r.move.from !== m0.from || r.move.to !== m0.to) avoided++
    if (r.learned === 'e1') tagged++
  }
  ok(`Échecs E1 : niveau 10, évite le début où il a perdu (${avoided}/6)`, avoided === 6 && tagged === 6)
  ok('Échecs : « Tu as déjà gagné contre moi avec ce début de partie : je m’en souviens ! »', Lr.insights(mb).some((i) => i.id === 'bookLoss' && i.use), ids(mb))
  const deep = S.echecsBot.decide(start, BOT, 10, mkRng(1), 1e9, { rate: 1 })
  ok('Échecs : indices sans rien d’utile -> même coup que sans indices', deep.move.from === m0.from && deep.move.to === m0.to && !deep.learned)

  // E2 : bonus aux coups qui attaquent une pièce mal gardée.
  const pos = chessLog(S, { fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2', me: 'w', moves: [] }).x0.state.board
  const he = { rate: 1, hang: ['q'] }
  const base = S.echecsBot.decide(pos, BOT, 6, mkRng(4), 1e9)
  const e2 = S.echecsBot.decide(pos, BOT, 6, mkRng(4), 1e9, he)
  ok('Échecs E2 : coup légal avec ou sans bonus', S.echecs.legalMoves(pos).some((q) => q.from === e2.move.from && q.to === e2.move.to) && !!base.move)

  // learnRate 0 (niveaux 1-2, frein) -> aucun indice.
  ok('Échecs : learnRate 0 -> pas d’indices', Lr.hintsFor(mb, 0, start, emptyLog) === undefined)
  ok('Échecs : frein après 3 défaites -> learnRate 0', M.learnRate(9, 3) === 0)

  // Taille : 500 parties courtes (coups au hasard).
  const rnd = mkRng(21)
  let big = Lr.empty()
  for (let g = 0; g < 500; g++) {
    const meW = g % 2 === 0
    let x = S.soloStart(S.echecs.local, { a: ME, b: BOT, first: meW ? ME : BOT, options: { cadence: 'none' } })
    const lg = { id: `big-${g}`, game: 'echecs', me: ME, bot: BOT, first: meW ? ME : BOT, perso: 'mika', level: 5, secret0: null, setup: [], x0: x, entries: [], outcome: null }
    const n = 14 + Math.floor(rnd() * 20)
    for (let ply = 0; ply < n && x.state.phase === 'playing'; ply++) {
      const b = x.state.board
      const turn = b.side === 'w' ? b.white : b.black
      const ms = S.echecs.legalMoves(b)
      const action = { type: 'move', move: ms[Math.floor(rnd() * ms.length)] }
      x = S.soloAct(S.echecs.local, x, turn, action)
      lg.entries.push({ by: turn === ME ? 'me' : 'bot', action })
    }
    if (x.state.phase === 'playing') {
      const who = rnd() < 0.5 ? ME : BOT
      x = S.soloAct(S.echecs.local, x, who, { type: 'move', move: R })
      lg.entries.push({ by: who === ME ? 'me' : 'bot', action: { type: 'move', move: R } })
    }
    const w = x.state.duel.winner
    lg.outcome = w === ME ? 'win' : w === BOT ? 'loss' : 'draw'
    big = learn(big, lg)
  }
  const size = JSON.stringify(big).length
  ok(`Échecs : mémoire après 500 parties = ${(size / 1024).toFixed(1)} Ko (< 100 Ko)`, size < 100_000)
  ok('Échecs : livre plafonné à 400 entrées', Object.keys(big.book).length <= 400, String(Object.keys(big.book).length))
  globalThis.__sizes = { ...(globalThis.__sizes ?? {}), echecs: size }
  void SQ
}
