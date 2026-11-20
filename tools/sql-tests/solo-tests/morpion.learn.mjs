// Morpion (2b) : ouverture favorite repérée à la 3e partie, oubliée en 5 ; M1 (réponse sans bruit),
// M2 (ouverture qui marche), M3 (piège) ; blocages oubliés ; learnRate 0 -> pas d'indices ; taille.
import { BOT, ME, autoLog, mkRng, playLog } from './util.mjs'

export default async function (S, { ok }) {
  const L = S.morpion
  const Lr = S.morpionLearner
  const M = S.memory
  const opts = { variant: 'classic' }
  const rnd = mkRng(3)
  let now = 1_000_000
  const learn = (mem, log) => M.learn(Lr, mem, log, (now += 60_000))
  const randomMe = (b) => {
    const legal = L.legalMoves(b)
    return { cell: legal[Math.floor(rnd() * legal.length)] }
  }
  /** Partie où le joueur commence par `open` puis joue au hasard, contre le bot niveau 5. */
  const gameFrom = (open, first = 'me') =>
    autoLog(S, L, {
      game: 'morpion',
      first,
      options: opts,
      pickMe: (b) => (b.count === 0 ? { cell: open } : randomMe(b)),
      pickBot: (b) => S.morpionBot.decide(b, BOT, 5, rnd),
    }).log
  const has = (mem, id) => Lr.insights(mem).some((i) => i.id === id)

  // Habitude : 3 parties qui commencent au centre -> repérée ; 5 parties ailleurs -> oubliée.
  let mem = Lr.empty()
  mem = learn(mem, gameFrom(4))
  mem = learn(mem, gameFrom(4))
  ok('Morpion : pas d’habitude après 2 parties', !has(mem, 'open:4'))
  mem = learn(mem, gameFrom(4))
  const ins = Lr.insights(mem).find((i) => i.id === 'open:4')
  ok('Morpion : « Tu commences toujours par le centre. » à la 3e partie', ins?.text === 'Tu commences toujours par le centre.' && ins.use, JSON.stringify(Lr.insights(mem)))
  for (const c of [0, 1, 2, 3, 5]) mem = learn(mem, gameFrom(c))
  ok('Morpion : habitude oubliée après 5 parties différentes', !has(mem, 'open:4'), JSON.stringify(mem.open))
  ok('Morpion : oubli × 0,9 (n après 8 parties ≈ 5,7)', Math.abs(mem.n - (1 - 0.9 ** 8) / 0.1) < 0.02, String(mem.n))

  // Parties alternées (le joueur ne commence qu'une fois sur deux) : repérée dès la 3e partie.
  let ma = Lr.empty()
  for (const f of ['me', 'bot', 'me']) ma = learn(ma, gameFrom(4, f))
  ok('Morpion : parties alternées -> habitude repérée à la 3e partie', has(ma, 'open:4'), JSON.stringify(ma.open))

  // Type d'ouverture : coins variés -> « dans un coin ».
  let mc = Lr.empty()
  for (const c of [0, 2, 6, 8, 0]) mc = learn(mc, gameFrom(c))
  ok('Morpion : « Tu commences souvent dans un coin. »', Lr.insights(mc).some((i) => i.id === 'open:corner' && i.text === 'Tu commences souvent dans un coin.'), JSON.stringify(Lr.insights(mc)))

  // Blocages oubliés (👀) : 4 occasions dont 2 oublis.
  let mb = Lr.empty()
  const forgot = () => playLog(S, L, { game: 'morpion', first: 'me', options: opts, moves: [['me', { cell: 0 }], ['bot', { cell: 4 }], ['me', { cell: 8 }], ['bot', { cell: 2 }], ['me', { cell: 7 }], ['bot', { cell: 6 }]] }).log
  const blocked = playLog(S, L, { game: 'morpion', first: 'me', options: opts, moves: [['me', { cell: 0 }], ['bot', { cell: 4 }], ['me', { cell: 8 }], ['bot', { cell: 2 }], ['me', { cell: 6 }], ['bot', { cell: 3 }], ['me', { cell: 5 }], ['bot', { cell: 7 }], ['me', { cell: 1 }]] }).log
  for (const lg of [forgot(), blocked, forgot()]) mb = learn(mb, lg)
  ok('Morpion : blocages comptés (oubliés / occasions)', mb.block[0] > 1.5 && mb.block[1] > mb.block[0], JSON.stringify(mb.block))
  ok('Morpion : position piège retenue (clé canonique, symétries)', Object.keys(mb.traps).length >= 1 && Object.values(mb.traps).some((v) => v >= 1.8), JSON.stringify(mb.traps))
  ok('Morpion : « Le coup des deux menaces marche bien sur toi. » si piège ≥ 2… (pas encore : 1,9)', !Lr.insights(mb).some((i) => i.id === 'traps'))
  mb = learn(mb, forgot())
  ok('Morpion : « Tu oublies parfois de me bloquer. » (👀, 4 occasions)', Lr.insights(mb).some((i) => i.id === 'block' && !i.use), JSON.stringify(Lr.insights(mb)))
  ok('Morpion : … puis repéré à la 4e fois', Lr.insights(mb).some((i) => i.id === 'traps' && i.use), JSON.stringify(mb.traps))

  // learnRate 0 (niveaux 1-2, frein) -> aucun indice : le bot joue comme à l'étape 1.
  const b1 = playLog(S, L, { game: 'morpion', first: 'me', options: opts, moves: [['me', { cell: 4 }]] }).x.state.board
  let m3 = Lr.empty()
  for (let i = 0; i < 3; i++) m3 = learn(m3, gameFrom(4))
  ok('Morpion : indices m1 quand le joueur joue son ouverture favorite', Lr.hintsFor(m3, 0.6, b1, null)?.m1 === true)
  ok('Morpion : learnRate 0 -> pas d’indices', Lr.hintsFor(m3, 0, b1, null) === undefined)
  const braked = { ...m3, streak: 3 }
  ok('Morpion : frein (3 défaites) -> learnRate 0', M.learnRate(7, braked.streak) === 0)
  const lowLevel = Lr.insights({ ...m3 }).length > 0 && M.learnRate(2, 0) === 0
  ok('Morpion : niveau 2 : il le sait (habitudes affichées) mais learnRate 0', lowLevel)

  // M1 : il contre l'ouverture favorite (réponse optimale bien plus souvent qu'au hasard du niveau 3).
  const bestFor = (b) => {
    const sc = S.morpionBot.scoreMoves(b, 'o')
    const top = Math.max(...sc.map((s) => s.score))
    return sc.filter((s) => s.score === top).map((s) => s.cell)
  }
  const bCorner = playLog(S, L, { game: 'morpion', first: 'me', options: opts, moves: [['me', { cell: 0 }]] }).x.state.board
  let mk = Lr.empty()
  for (let i = 0; i < 3; i++) mk = learn(mk, gameFrom(0))
  const h = Lr.hintsFor(mk, M.learnRate(4, 0), bCorner, null)
  let withH = 0
  let without = 0
  let learnedTag = 0
  const r2 = mkRng(17)
  for (let i = 0; i < 400; i++) {
    const a = S.morpionBot.decide(bCorner, BOT, 4, r2, h)
    if (bestFor(bCorner).includes(a.move.cell)) withH++
    if (a.learned === 'm1') learnedTag++
    if (bestFor(bCorner).includes(S.morpionBot.decide(bCorner, BOT, 4, r2).move.cell)) without++
  }
  ok(`Morpion M1 : ouverture favorite contrée (${withH}/400 avec mémoire contre ${without}/400 sans)`, withH > without + 40 && learnedTag > 100, `${learnedTag}`)

  // M2 : le bot commence au type d'ouverture qui marche contre ce joueur.
  const m2 = { ...Lr.empty(), n: 5, botOpen: [[0, 2, 1], [3, 0, 0], [0, 1, 2]] }
  const empty = S.soloStart(L.local, { a: ME, b: BOT, first: BOT, options: opts }).state.board
  const h2 = Lr.hintsFor(m2, 1, empty, null)
  let corner = 0
  for (let i = 0; i < 100; i++) if ([0, 2, 6, 8].includes(S.morpionBot.decide(empty, BOT, 10, r2, h2).move.cell)) corner++
  ok(`Morpion M2 : ouvre dans un coin (meilleur bilan) (${corner}/100)`, h2?.m2 === 'corner' && corner === 100)
  ok('Morpion M2 : « Tu es moins à l’aise quand je commence dans un coin. »', Lr.insights(m2).some((i) => i.id === 'botOpen:corner'))

  // Taille : 500 parties simulées.
  let big = Lr.empty()
  for (let g = 0; g < 500; g++) big = learn(big, gameFrom(Math.floor(rnd() * 9), g % 2 ? 'me' : 'bot'))
  const size = JSON.stringify(big).length
  ok(`Morpion : mémoire après 500 parties = ${(size / 1024).toFixed(2)} Ko (< 100 Ko)`, size < 100_000)
  ok('Morpion : 30 pièges au plus', Object.keys(big.traps).length <= 30)
  globalThis.__sizes = { ...(globalThis.__sizes ?? {}), morpion: size }
}
