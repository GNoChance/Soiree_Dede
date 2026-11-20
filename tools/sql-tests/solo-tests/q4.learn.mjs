// 4 à la suite (2b) : habitudes (1re colonne, colonne adorée, blocages oubliés par direction, cadeaux,
// livre des débuts de partie), oubli, Q1 / Q2 / Q3 exploités, learnRate 0 -> pas d'indices, taille.
import { BOT, autoLog, mkRng, playLog } from './util.mjs'

export default async function (S, { ok }) {
  const L = S.q4
  const Lr = S.q4Learner
  const M = S.memory
  const game = 'quatre-a-la-suite'
  const rnd = mkRng(21)
  let now = 5_000_000
  const learn = (mem, log) => M.learn(Lr, mem, log, (now += 60_000))
  const seq = (first, cols) => {
    let by = first
    return cols.map((c) => {
      const e = [by, { col: c }]
      by = by === 'me' ? 'bot' : 'me'
      return e
    })
  }
  const script = (first, cols) => playLog(S, L, { game, first, moves: seq(first, cols) }).log
  const randomCol = (b) => {
    const legal = L.legalMoves(b)
    return { col: legal[Math.floor(rnd() * legal.length)] }
  }
  /** Partie où le joueur commence par `open` puis joue au hasard, contre un bot rapide. */
  const gameFrom = (open, first = 'me') =>
    autoLog(S, L, {
      game,
      first,
      pickMe: (b) => (b.count === 0 || (first === 'bot' && b.count === 1) ? { col: open } : randomCol(b)),
      pickBot: (b) => S.q4Bot.decide(b, BOT, 3, rnd, 5),
    }).log
  const ins = (mem, id) => Lr.insights(mem).find((i) => i.id === id)

  // 1re colonne : repérée à la 3e partie identique, oubliée en 5 parties différentes.
  let mem = Lr.empty()
  mem = learn(mem, gameFrom(1))
  mem = learn(mem, gameFrom(1))
  ok('Q4 : pas d’habitude après 2 parties', !ins(mem, 'first:1'))
  mem = learn(mem, gameFrom(1))
  ok('Q4 : « Tu commences toujours par la 2e colonne. » à la 3e partie', ins(mem, 'first:1')?.text === 'Tu commences toujours par la 2e colonne.' && ins(mem, 'first:1').use, JSON.stringify(Lr.insights(mem)))
  for (const c of [0, 2, 4, 5, 6]) mem = learn(mem, gameFrom(c))
  ok('Q4 : habitude oubliée après 5 parties différentes', !ins(mem, 'first:1'), JSON.stringify(mem.first))
  ok('Q4 : part des colonnes = 1 par partie', Math.abs(mem.cols.reduce((s, v) => s + v, 0) - mem.n) < 0.05, `${mem.cols} / ${mem.n}`)

  // Colonne adorée (≥ 30 %).
  let ma = Lr.empty()
  for (let g = 0; g < 3; g++) ma = learn(ma, script('me', [5, 0, 5, 1, 5, 2, 6, 3]))
  ok('Q4 : « Tu adores la 6e colonne. »', ins(ma, 'cols:5')?.text === 'Tu adores la 6e colonne.' && ins(ma, 'cols:5').use, JSON.stringify(Lr.insights(ma)))
  const tie = playLog(S, L, { game, first: 'me', moves: seq('me', [0, 2, 3]) }).x.state.board
  ok('Q4 : indices fav pour la colonne adorée', Lr.hintsFor(ma, 0.6, tie, null)?.fav === 5)

  // Blocages oubliés à l'horizontale (4 occasions) -> Q2.
  let mh = Lr.empty()
  const forgotH = () => script('me', [0, 1, 6, 2, 5, 3, 6, 4])
  for (let g = 0; g < 3; g++) mh = learn(mh, forgotH())
  ok('Q4 : blocages oubliés comptés par direction', mh.miss.h[0] > 2.7 && mh.miss.v[1] === 0, JSON.stringify(mh.miss))
  ok('Q4 : pas encore d’habitude (occasions < 3)', !ins(mh, 'miss:h'))
  mh = learn(mh, forgotH())
  ok('Q4 : « Tu ne vois pas toujours mes alignements à l’horizontale. »', ins(mh, 'miss:h')?.text === 'Tu ne vois pas toujours mes alignements à l’horizontale.' && ins(mh, 'miss:h').use, JSON.stringify(Lr.insights(mh)))
  const hh = Lr.hintsFor(mh, 0.6, tie, null)
  ok('Q2 : alignements horizontaux du bot × 1,3 (0,5 × 0,6 × 100 %)', hh?.boost?.[0] === 1.3 && hh.boost[1] === 1 && hh.boost[2] === 1, JSON.stringify(hh))
  let legal = true
  let r2 = mkRng(5)
  for (let g = 0; g < 6; g++) {
    const { log } = autoLog(S, L, { game, first: g % 2 ? 'me' : 'bot', pickMe: randomCol, pickBot: (b) => S.q4Bot.decide(b, BOT, 6, r2, 30, hh) })
    if (!log.outcome) legal = false
  }
  ok('Q2 : le bot avec boost joue des parties complètes (coups légaux)', legal)

  // Cadeaux sous la case gagnante (👀, ≥ 2).
  let mg = Lr.empty()
  const giftLog = () => playLog(S, L, { game, first: 'me', moves: [['me', { col: 1 }], ['bot', { col: 0 }], ['me', { col: 2 }], ['bot', { col: 3 }], ['me', { col: 0 }], ['bot', { col: 1 }], ['me', { col: 6 }], ['bot', { col: 2 }], ['me', { col: 6 }], ['bot', { col: 3 }], ['me', { col: 4 }], ['bot', { col: 4 }]] }).log
  for (let g = 0; g < 3; g++) mg = learn(mg, giftLog())
  ok('Q4 : « Tu poses parfois ton jeton juste sous ma case gagnante. » (👀)', ins(mg, 'gift') && !ins(mg, 'gift').use, JSON.stringify(Lr.insights(mg)))

  // Livre des débuts de partie : une victoire du joueur -> « Tu m'as déjà battu{e}… » ; Q3 évite la suite perdue.
  let mb = Lr.empty()
  const beat = () => script('me', [3, 3, 2, 2, 4, 4, 1])
  mb = learn(mb, beat())
  ok('Q4 : partie gagnée par le joueur enregistrée dans le livre (clé m33…)', mb.book.m33?.[2] === 1 && Object.keys(mb.book).length === 7, JSON.stringify(mb.book))
  ok('Q4 : « Tu m’as déjà battu{e} avec ce début de partie : je m’en souviens ! »', ins(mb, 'book')?.use === true && ins(mb, 'book').text.includes('je m’en souviens'))
  mb = learn(mb, beat())
  const after3 = playLog(S, L, { game, first: 'me', moves: seq('me', [3]) })
  const h3 = Lr.hintsFor(mb, 1, after3.x.state.board, after3.log)
  ok('Q3 : indices next[3] = suite déjà perdue', h3?.next?.[3]?.[2] > 1.8, JSON.stringify(h3))
  const base = S.q4Bot.decide(after3.x.state.board, BOT, 7, mkRng(1), 1e9)
  const withH = S.q4Bot.decide(after3.x.state.board, BOT, 7, mkRng(1), 1e9, h3)
  ok(`Q3 : sans mémoire il joue ${base.move.col}, avec il évite la suite perdue (${withH.move.col}, ${withH.learned})`, base.move.col === 3 && withH.move.col !== 3 && withH.learned === 'q3')
  ok('Q3 : clés miroir (colonne -> 6 − colonne)', Lr.bookKey(true, [5, 4]) === Lr.bookKey(true, [1, 2]))

  // Q1 : départage vers la colonne adorée.
  const q1 = S.q4Bot.decide(tie, BOT, 7, mkRng(1), 1e9, { rate: 1, fav: 2 })
  ok(`Q1 : entre colonnes de même score, il prend la tienne (2) au lieu du centre (${q1.move.col}, ${q1.learned})`, q1.move.col === 2 && q1.learned === 'q1' && S.q4Bot.decide(tie, BOT, 7, mkRng(1), 1e9).move.col === 3)

  // learnRate 0 -> aucun indice.
  ok('Q4 : learnRate 0 -> pas d’indices', Lr.hintsFor(mh, 0, tie, null) === undefined && Lr.hintsFor(mb, 0, after3.x.state.board, after3.log) === undefined)

  // Taille après 500 parties.
  let big = Lr.empty()
  for (let g = 0; g < 500; g++) {
    const { log } = autoLog(S, L, { game, first: g % 2 ? 'me' : 'bot', pickMe: randomCol, pickBot: randomCol })
    big = learn(big, log)
  }
  const size = JSON.stringify(big).length
  ok(`Q4 : mémoire après 500 parties = ${(size / 1024).toFixed(2)} Ko (< 100 Ko), livre ${Object.keys(big.book).length} ≤ 200`, size < 100_000 && Object.keys(big.book).length <= 200)
  globalThis.__sizes = { ...(globalThis.__sizes ?? {}), q4: size }
}
