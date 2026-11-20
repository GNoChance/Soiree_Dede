// Tests des bots du mode solo (sans base) : node solo-bots.mjs
// Coups toujours légaux, Morpion parfait au niveau 10, 4 à la suite qui gagne / bloque dès le niveau 3,
// Bataille navale plus efficace en haut niveau, Échecs : mat en 1, prise gratuite, temps de calcul, niveau qui s'adapte.
import { loadSolo } from './solo-bundle.mjs'

const S = await loadSolo()
let failed = false
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK   ' : 'ÉCHEC'} ${name}${cond ? '' : ' ' + extra}`)
  if (!cond) failed = true
}
let seed = 7
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x80000000
}
const pick = (a) => a[Math.floor(rnd() * a.length)]
const H = 'humain'
const B = 'bot'
const start = (L, first, options = {}) => S.soloStart(L.local, { a: H, b: B, first, options })
const act = (L, x, actor, move) => S.soloAct(L.local, x, actor, { type: 'move', move })

/** Joue une partie bot (niveau) contre un joueur aléatoire ; renvoie le vainqueur (null = nul). */
function duel(L, bot, legal, level, first, options) {
  let x = start(L, first, options)
  while (x.state.phase === 'playing') {
    const turn = x.state.duel.turn
    const move = turn === B ? bot.chooseMove(x.state.board, B, level, rnd) : pick(legal(x.state.board, turn))
    x = act(L, x, turn, move)
  }
  return x.state.duel.winner
}

// ----------------------------------------------------------------------------- niveau
ok('niveau : +1 victoire, -1 défaite, 0 nul, bornes 1 et 10',
  S.nextLevel(3, 'win') === 4 && S.nextLevel(3, 'loss') === 2 && S.nextLevel(3, 'draw') === 3 && S.nextLevel(10, 'win') === 10 && S.nextLevel(1, 'loss') === 1)
ok('niveau : étoiles (1 -> ½, 7 -> 3½, 10 -> 5)', S.levelStars(1) === 0.5 && S.levelStars(7) === 3.5 && S.levelStars(10) === 5)

// ----------------------------------------------------------------------------- Morpion
{
  let losses = 0
  let wins = 0
  for (let g = 0; g < 200; g++) {
    const w = duel(S.morpion, S.morpionBot, (b) => S.morpion.legalMoves(b).map((cell) => ({ cell })), 10, g % 2 ? H : B)
    if (w === H) losses++
    if (w === B) wins++
  }
  ok(`Morpion niveau 10 : jamais battu sur 200 parties contre le hasard (${wins} victoires du bot)`, losses === 0, `${losses} défaites`)
  let l1 = 0
  for (let g = 0; g < 200; g++) if (duel(S.morpion, S.morpionBot, (b) => S.morpion.legalMoves(b).map((cell) => ({ cell })), 1, g % 2 ? H : B) === H) l1++
  ok(`Morpion niveau 1 : battable (${l1} défaites du bot sur 200)`, l1 > 10)
}

// ----------------------------------------------------------------------------- 4 à la suite
{
  const q4 = (cols) => ({ width: 7, height: 6, cols, a: H, b: B, count: cols.flat().length, last: null, line: null })
  // Le joueur menace d'aligner 4 en bas (colonnes 1-3, case 4 libre) et en colonne 6 (3 jetons empilés).
  const threatRow = q4([[], [H], [H], [H], [], [B], [B]])
  const threatCol = q4([[B], [B], [], [], [], [], [H, H, H]])
  const winNow = q4([[B, B, B], [H], [H], [], [H], [], []])
  let blocked = 0
  let won = 0
  let total = 0
  for (let L = 3; L <= 10; L++) {
    for (let k = 0; k < 10; k++) {
      total++
      if (S.q4Bot.chooseMove(threatRow, B, L, rnd).col === 4 && S.q4Bot.chooseMove(threatCol, B, L, rnd).col === 6) blocked++
      if (S.q4Bot.chooseMove(winNow, B, L, rnd).col === 0) won++
    }
  }
  ok(`4 à la suite niveaux 3-10 : bloque toujours une victoire immédiate (${blocked}/${total})`, blocked === total)
  ok(`4 à la suite niveaux 3-10 : gagne toujours quand il peut (${won}/${total})`, won === total)
  let t = Date.now()
  S.q4Bot.chooseMove(q4([[], [], [], [H], [], [], []]), B, 10, rnd)
  const ms = Date.now() - t
  ok(`4 à la suite niveau 10 : calcul plafonné (${ms} ms ≤ 1100)`, ms <= 1100)
  let wins = 0
  for (let g = 0; g < 30; g++) if (duel(S.q4, S.q4Bot, (b) => S.q4.legalMoves(b).map((col) => ({ col })), 6, g % 2 ? H : B) === B) wins++
  ok(`4 à la suite niveau 6 : bat le hasard (${wins}/30)`, wins >= 29)
  t = Date.now()
  let legalOk = true
  for (let g = 0; g < 10; g++) {
    let x = start(S.q4, g % 2 ? H : B)
    while (x.state.phase === 'playing') {
      const turn = x.state.duel.turn
      const move = S.q4Bot.chooseMove(x.state.board, turn, 1 + (g % 10), rnd, 50)
      if (!S.q4.legalMoves(x.state.board).includes(move.col)) legalOk = false
      x = act(S.q4, x, turn, move)
    }
  }
  ok(`4 à la suite : bot contre bot, coups toujours légaux (${Date.now() - t} ms)`, legalOk)
}

// ----------------------------------------------------------------------------- Bataille navale
{
  const shotsToWin = (level, games = 30) => {
    let total = 0
    for (let g = 0; g < games; g++) {
      let x = start(S.bn, H)
      x = S.soloAct(S.bn.local, x, B, { type: 'ready' })
      x = S.soloAct(S.bn.local, x, H, { type: 'ready' })
      let n = 0
      while (x.state.phase === 'playing') {
        const turn = x.state.duel.turn
        if (turn === H) {
          // le joueur rate toujours (on ne mesure que le bot) : il tire sur une case vide de la flotte du bot
          const fleet = x.server.board.fleets[B]
          const occupied = new Set(fleet.flatMap((s) => Array.from({ length: S.bn.SHIP_DEFS.find((d) => d.id === s.id).size }, (_, k) => (s.dir === 'h' ? s.y * 10 + s.x + k : (s.y + k) * 10 + s.x))))
          const free = S.bn.legalMoves(x.state.board, H).filter(({ x: cx, y }) => !occupied.has(y * 10 + cx))
          x = act(S.bn, x, H, pick(free))
        } else {
          const m = S.bnBot.chooseMove(x.state.board, B, level, rnd)
          if (!S.bn.legalMoves(x.state.board, B).some((c) => c.x === m.x && c.y === m.y)) return -1
          x = act(S.bn, x, B, m)
          n++
        }
      }
      total += n
    }
    return total / games
  }
  const lo = shotsToWin(1)
  const hi = shotsToWin(10)
  ok(`Bataille navale : tirs toujours légaux`, lo > 0 && hi > 0)
  ok(`Bataille navale : niveau 10 plus efficace que niveau 1 (${hi.toFixed(1)} tirs contre ${lo.toFixed(1)})`, hi < lo - 10 && hi < 60)
}

// ----------------------------------------------------------------------------- Échecs
{
  const fromFen = (fen) => {
    const [rows, side, castle, ep] = fen.split(' ')
    let sq = ''
    for (const ch of rows.replace(/\//g, '')) sq += /\d/.test(ch) ? '.'.repeat(Number(ch)) : ch
    const x = start(S.echecs, side === 'w' ? B : H, { cadence: 'none' })
    const b = { ...x.state.board, sq, side, castle: castle === '-' ? '' : castle, ep: ep === '-' ? null : ep }
    return b
  }
  const SQ = (s) => (8 - Number(s[1])) * 8 + (s.charCodeAt(0) - 97)
  // Mat en 1 : Dh5xf7# (mat du berger)
  const mate1 = fromFen('r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 0 1')
  let found = 0
  for (let L = 5; L <= 10; L++) {
    const m = S.echecsBot.chooseMove(mate1, B, L, rnd)
    if (m.from === SQ('h5') && m.to === SQ('f7')) found++
  }
  ok(`Échecs niveaux 5-10 : trouve le mat en 1 (${found}/6)`, found === 6)
  // Dame noire en prise gratuite en d4 (Cf3xd4)
  const hang = fromFen('rnb1kbnr/pppp1ppp/8/4p3/3q4/5N2/PPPPPPPP/RNBQKB1R w KQkq - 0 1')
  const m = S.echecsBot.chooseMove(hang, B, 10, rnd)
  ok('Échecs niveau 10 : prend la dame gratuite', m.from === SQ('f3') && m.to === SQ('d4'), JSON.stringify(m))
  let t = Date.now()
  S.echecsBot.chooseMove(start(S.echecs, B, { cadence: 'none' }).state.board, B, 10, rnd)
  let ms = Date.now() - t
  ok(`Échecs niveau 10 : calcul plafonné au départ (${ms} ms ≤ 1100)`, ms <= 1100)
  const mid = fromFen('r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP1B1PPP/R2QKB1R w KQ - 0 1')
  t = Date.now()
  S.echecsBot.chooseMove(mid, B, 10, rnd)
  ms = Date.now() - t
  ok(`Échecs niveau 10 : calcul plafonné en milieu de partie (${ms} ms ≤ 1100)`, ms <= 1100)
  // Bot contre joueur aléatoire : coups légaux, et le bot niveau 6 gagne
  let wins = 0
  let illegal = 0
  for (let g = 0; g < 4; g++) {
    let x = start(S.echecs, g % 2 ? H : B, { cadence: 'none' })
    for (let ply = 0; x.state.phase === 'playing' && ply < 300; ply++) {
      const b = x.state.board
      const turn = b.side === 'w' ? b.white : b.black
      const move = turn === B ? S.echecsBot.chooseMove(b, B, 6, rnd, 150) : pick(S.echecs.legalMoves(b))
      try {
        x = act(S.echecs, x, turn, move)
      } catch (e) {
        illegal++
        break
      }
    }
    if (x.state.duel.winner === B) wins++
  }
  ok('Échecs : coups du bot toujours légaux', illegal === 0)
  ok(`Échecs niveau 6 : bat le hasard (${wins}/4)`, wins >= 3)
  // Nulle proposée : acceptée seulement si le bot n'est pas mieux
  const offer = { ...start(S.echecs, H, { cadence: 'none' }).state.board, draw_offer: H, side: 'b' }
  ok('Échecs : nulle acceptée en position égale', S.echecsBot.chooseMove(offer, B, 5, rnd).type === 'accept_draw')
  const winning = { ...fromFen('4k3/8/8/8/8/8/8/QQQQK3 w - - 0 1'), draw_offer: H }
  ok('Échecs : nulle refusée quand il gagne', S.echecsBot.chooseMove(winning, B, 5, rnd).type !== 'accept_draw')
}

if (failed) {
  console.log('\nDES TESTS ONT ÉCHOUÉ')
  process.exit(1)
}
console.log('\nTous les tests des bots passent.')
