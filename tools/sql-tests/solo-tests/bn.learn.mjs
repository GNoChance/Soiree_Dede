// Bataille navale (2b) : placement à la main vs « Mélanger », habitudes (cachettes, sens, bateaux collés,
// premiers tirs), oubli, B1 (tire d'abord là où tu ranges tes bateaux), B2 (cache sa flotte loin de tes
// premiers tirs), learnRate 0 -> rien, taille.
import { BOT, ME, autoLog, mkRng } from './util.mjs'
import { fleetCells } from './bn.why.mjs'

const xy = (i) => ({ x: i % 10, y: Math.floor(i / 10) })

/** Flottes fixes du joueur (placées à la main ; HOME : bateaux collés, en haut à gauche, couchés). */
const HOME = [
  { id: 'porte-avions', x: 0, y: 0, dir: 'h' },
  { id: 'cuirasse', x: 0, y: 1, dir: 'h' },
  { id: 'croiseur', x: 6, y: 0, dir: 'h' },
  { id: 'sous-marin', x: 5, y: 2, dir: 'h' },
  { id: 'torpilleur', x: 0, y: 4, dir: 'h' },
]
const VERT = [
  { id: 'porte-avions', x: 9, y: 5, dir: 'v' },
  { id: 'cuirasse', x: 7, y: 6, dir: 'v' },
  { id: 'croiseur', x: 5, y: 7, dir: 'v' },
  { id: 'sous-marin', x: 3, y: 7, dir: 'v' },
  { id: 'torpilleur', x: 1, y: 8, dir: 'v' },
]

const overlaps = (S, fleet) => S.bn.fleetErrorOf(fleet) !== null
/** Actions `place` qui déplacent les bateaux UN PAR UN (comme au doigt) de `from` vers `to`. */
function handMoves(S, from, to) {
  let cur = from.map((s) => ({ ...s }))
  const out = []
  for (let pass = 0; pass < 12; pass++) {
    let moved = false
    for (const t of to) {
      const i = cur.findIndex((s) => s.id === t.id)
      if (cur[i].x === t.x && cur[i].y === t.y && cur[i].dir === t.dir) continue
      const next = cur.map((s, k) => (k === i ? { ...t } : s))
      if (overlaps(S, next)) continue
      cur = next
      out.push(['me', { type: 'move', move: { type: 'place', ships: cur } }])
      moved = true
    }
    if (to.every((t) => cur.some((s) => s.id === t.id && s.x === t.x && s.y === t.y && s.dir === t.dir))) return out
    if (!moved) {
      // débloque : pousse un bateau gênant sur une place libre quelconque
      for (const s of cur) {
        for (let y = 0; y < 10 && !moved; y++)
          for (let x = 0; x < 10 && !moved; x++) {
            const next = cur.map((q) => (q.id === s.id ? { ...q, x, y, dir: 'h' } : q))
            if (!overlaps(S, next) && !to.some((t) => t.id === s.id && t.x === x && t.y === y)) {
              cur = next
              out.push(['me', { type: 'move', move: { type: 'place', ships: cur } }])
              moved = true
            }
          }
        if (moved) break
      }
    }
  }
  return null
}

export default async function (S, { ok }) {
  const L = S.bn
  const Lr = S.bnLearner
  const M = S.memory
  const rnd = mkRng(21)
  let now = 5_000_000
  const learn = (mem, log) => M.learn(Lr, mem, log, (now += 60_000))

  /**
   * Partie : le joueur range sa flotte (`fleet` à la main, 'shuffle' = Mélanger, null = laisse le hasard),
   * tire d'abord dans `aim` puis au hasard ; le bot (niveau 5) tire comme d'habitude.
   */
  function game({ fleet = null, aim = [], hints = null, botLevel = 5 } = {}) {
    let setup = []
    if (fleet === 'shuffle') setup = [['me', { type: 'move', move: { type: 'place', ships: L.local.boardNew({ duel_no: 1, game_no: 1, a: ME, b: BOT, starter: ME, options: {} }, ME, BOT).server.fleets[ME] } }]]
    else if (fleet) {
      // autoLog tire sa propre flotte de départ : on part d'un « mélange » vers une flotte connue
      // (aucun bateau déjà à sa place), puis on déplace les bateaux un par un
      const start = fleet === HOME ? VERT : HOME
      const moves = handMoves(S, start, fleet)
      if (!moves) return null
      setup = [['me', { type: 'move', move: { type: 'place', ships: start } }], ...moves]
    }
    const q = [...aim]
    const { log } = autoLog(S, L, {
      game: 'bataille-navale',
      first: 'me',
      setup: [...setup, ['bot', { type: 'ready' }], ['me', { type: 'ready' }]],
      pickMe: (b) => {
        const done = new Set(b.waters[BOT].shots.map((s) => s.y * 10 + s.x))
        while (q.length && done.has(q[0])) q.shift()
        if (q.length) return xy(q.shift())
        const c = L.legalMoves(b, ME)
        return c[Math.floor(rnd() * c.length)]
      },
      pickBot: (b) => S.bnBot.decide(b, BOT, botLevel, rnd, hints ?? undefined),
    })
    return log
  }
  const ids = (mem) => Lr.insights(mem).map((i) => i.id)

  // Placement à la main vs mélange
  let mh = Lr.empty()
  const g1 = game({ fleet: HOME })
  ok('BN : partie test jouable (placement à la main)', !!g1 && g1.outcome !== null)
  mh = learn(mh, g1)
  ok('BN : bateaux placés à la main comptés (hand = 1, place sur la flotte)', mh.hand === 1 && fleetCells(HOME).every((c) => mh.place[c] === 1), JSON.stringify({ hand: mh.hand, auto: mh.auto }))
  let ms = learn(Lr.empty(), game({ fleet: 'shuffle' }))
  ok('BN : « Mélanger » -> rien appris des cases (auto = 1)', ms.hand === 0 && ms.auto === 1 && ms.place.every((v) => v === 0))
  ms = learn(Lr.empty(), game())
  ok('BN : flotte laissée au hasard -> auto', ms.hand === 0 && ms.auto === 1)

  // Habitude repérée à la 3e partie identique, oubliée en 5 parties différentes
  let mem = Lr.empty()
  mem = learn(mem, game({ fleet: HOME }))
  mem = learn(mem, game({ fleet: HOME }))
  ok('BN : pas d’habitude après 2 parties', !ids(mem).includes('same'))
  mem = learn(mem, game({ fleet: HOME }))
  const ins = Lr.insights(mem)
  ok('BN : « Tes bateaux sont presque toujours au même endroit. » à la 3e', ins.some((i) => i.id === 'same' && i.use), JSON.stringify(ins))
  ok('BN : « Tu caches souvent tes bateaux en haut … »', ins.some((i) => i.id.startsWith('zone:') && /en haut/.test(i.text)), JSON.stringify(ins))
  ok('BN : « Tu poses presque toujours tes bateaux couchés. »', ins.some((i) => i.id === 'orient:h' && i.text === 'Tu poses presque toujours tes bateaux couchés.'))
  ok('BN : « Tu colles tes bateaux les uns aux autres. »', ins.some((i) => i.id === 'touch:yes'), JSON.stringify(mem.touch))
  for (let k = 0; k < 5; k++) mem = learn(mem, game({ fleet: k % 2 ? VERT : 'shuffle' }))
  ok('BN : habitude « même endroit » oubliée après 5 parties différentes', !ids(mem).includes('same'), JSON.stringify(ids(mem)))
  let ma = Lr.empty()
  for (let k = 0; k < 4; k++) ma = learn(ma, game())
  ok('BN : « Tu laisses le hasard ranger tes bateaux : rien à deviner, malin ! » (👀)', Lr.insights(ma).some((i) => i.id === 'auto' && !i.use))

  // Premiers tirs : toujours en bas à droite
  const BR = Array.from({ length: 25 }, (_, k) => (5 + Math.floor(k / 5)) * 10 + 5 + (k % 5))
  let mt = Lr.empty()
  for (let k = 0; k < 3; k++) mt = learn(mt, game({ aim: BR.slice(0, 15) }))
  ok('BN : « Tu tires d’abord en bas à droite. »', Lr.insights(mt).some((i) => i.id === 'aim:br' && i.text === 'Tu tires d’abord en bas à droite.'), JSON.stringify(Lr.insights(mt)))

  // learnRate 0 -> ni indices ni flotte apprise
  const b0 = S.soloStart(L.local, { a: ME, b: BOT, first: ME }).state.board
  ok('BN : learnRate 0 -> hintsFor undefined', Lr.hintsFor(mem, 0, b0, null) === undefined)
  ok('BN : learnRate 0 -> botSetup null', Lr.botSetup(mt, 0, b0, BOT) === null)
  ok('BN : learnRate > 0 -> indices B1 (cartes des cases) ', Array.isArray(Lr.hintsFor(learn(learn(learn(Lr.empty(), game({ fleet: HOME })), game({ fleet: HOME })), game({ fleet: HOME })), 0.9, b0, null)?.place))

  // B2 : sa flotte évite tes premiers tirs habituels
  {
    const r = mkRng(4)
    let cover = 0
    let cover0 = 0
    for (let k = 0; k < 40; k++) {
      const acts = Lr.botSetup(mt, 1, b0, BOT, r)
      const f = acts?.[0]?.move?.ships
      cover += fleetCells(f).filter((c) => BR.slice(0, 15).includes(c)).length
      cover0 += fleetCells(S.bn.local.boardNew({ duel_no: 1, game_no: 1, a: ME, b: BOT, starter: ME, options: {} }, ME, BOT).server.fleets[BOT]).filter((c) => BR.slice(0, 15).includes(c)).length
    }
    ok(`BN B2 : flotte du bot loin de tes premiers tirs (${cover} cases touchées contre ${cover0} au hasard, sur 40)`, cover < cover0 * 0.5)
    const acts = Lr.botSetup(mt, 1, b0, BOT, r)
    ok('BN B2 : action « place » valide', acts?.length === 1 && acts[0].type === 'move' && acts[0].move.type === 'place' && S.bn.fleetErrorOf(acts[0].move.ships) === null)
  }

  // B1 : contre une flotte toujours identique, le bot niveau 7 finit en moins de tirs ; rien contre le hasard.
  {
    let mm = Lr.empty()
    for (let k = 0; k < 4; k++) mm = learn(mm, game({ fleet: HOME }))
    const rate = M.learnRate(7, 0)
    const shotsToWin = (fleetOf, withMem, games = 40) => {
      const r = mkRng(77)
      let total = 0
      for (let g = 0; g < games; g++) {
        let x = S.soloStart(L.local, { a: ME, b: BOT, first: BOT })
        x = S.soloAct(L.local, x, ME, { type: 'move', move: { type: 'place', ships: fleetOf() } })
        x = S.soloAct(L.local, x, BOT, { type: 'ready' })
        x = S.soloAct(L.local, x, ME, { type: 'ready' })
        let n = 0
        while (x.state.phase === 'playing') {
          const turn = x.state.duel.turn
          if (turn === ME) {
            const occ = new Set(fleetCells(x.server.board.fleets[BOT]))
            const free = L.legalMoves(x.state.board, ME).filter(({ x: cx, y }) => !occ.has(y * 10 + cx))
            x = S.soloAct(L.local, x, ME, { type: 'move', move: free[Math.floor(r() * free.length)] })
          } else {
            const h = withMem ? Lr.hintsFor(mm, rate, x.state.board, null) : undefined
            x = S.soloAct(L.local, x, BOT, { type: 'move', move: S.bnBot.decide(x.state.board, BOT, 7, r, h).move })
            n++
          }
        }
        total += n
      }
      return total / games
    }
    const same = () => HOME
    const rand = () => S.bn.local.boardNew({ duel_no: 1, game_no: 1, a: ME, b: BOT, starter: ME, options: {} }, ME, BOT).server.fleets[ME]
    const a = shotsToWin(same, false)
    const b = shotsToWin(same, true)
    ok(`BN B1 : flotte toujours identique -> ${b.toFixed(1)} tirs avec mémoire contre ${a.toFixed(1)} sans`, b < a - 10, `${a} ${b}`)
    const c = shotsToWin(rand, false)
    const d = shotsToWin(rand, true)
    ok(`BN B1 : flottes au hasard -> rien gagné (${d.toFixed(1)} avec contre ${c.toFixed(1)} sans)`, d >= c - 3, `${c} ${d}`)
    // tir « appris » signalé
    const hb = Lr.hintsFor(mm, rate, S.soloStart(L.local, { a: ME, b: BOT, first: BOT }).state.board, null)
    let tagged = 0
    for (let k = 0; k < 50; k++) if (S.bnBot.decide(b0, BOT, 7, rnd, hb).learned === 'b1') tagged++
    ok(`BN B1 : tir appris signalé (learned = 'b1', ${tagged}/50)`, tagged > 10)
  }

  // Taille : 500 parties simulées (mélange de flottes à la main / au hasard)
  let big = Lr.empty()
  const t0 = Date.now()
  for (let g = 0; g < 500; g++) {
    const lg = game({ fleet: g % 3 === 0 ? HOME : g % 3 === 1 ? 'shuffle' : null, aim: g % 2 ? BR.slice(0, 15) : [] })
    if (lg) big = learn(big, lg)
  }
  const size = JSON.stringify(big).length
  ok(`BN : mémoire après 500 parties = ${(size / 1024).toFixed(2)} Ko (< 100 Ko) [${((Date.now() - t0) / 1000).toFixed(1)} s]`, size < 100_000)
  globalThis.__sizes = { ...(globalThis.__sizes ?? {}), bn: size }
}
