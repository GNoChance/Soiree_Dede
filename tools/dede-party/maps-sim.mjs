// Validation des tracés + simulation JS simplifiée des 5 plateaux de Dédé Party (document de conception).
// node dp-maps-sim.mjs [parties par config]
const SIMS = Number(process.argv[2] ?? 3000)
const rnd = (n) => Math.floor(Math.random() * n)
const die = () => 1 + rnd(6)
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]] } return a }

const T = { s: 'start', c: 'clap', p: 'pub', e: 'env', l: 'loge', t: 'tombola', u: 'lift', i: 'ice' }
const types = (str) => str.split('').map((ch) => T[ch])
const seq = (from, to) => { const r = []; for (let i = from; i <= to; i++) r.push(i); return r }
const line = (c0, r0, c1, r1) => { const r = []; const dc = Math.sign(c1 - c0), dr = Math.sign(r1 - r0); let c = c0, y = r0; for (;;) { r.push([c, y]); if (c === c1 && y === r1) break; c += dc; y += dr } return r }

const MAPS = {}

// 1. Le Grand Plateau de Dédé (existant)
MAPS.grand = {
  cols: 11, rows: 9, mech: 'forks',
  cells: ['start', 'clap', 'pub', 'loge', 'clap', 'env', 'clap', 'loge', 'pub', 'clap', 'env', 'loge', 'clap', 'clap', 'pub', 'clap', 'env', 'loge', 'clap', 'pub', 'loge', 'clap', 'env', 'clap', 'clap', 'clap', 'env', 'loge', 'clap', 'pub', 'loge', 'clap', 'env', 'loge', 'pub', 'clap', 'clap', 'env', 'loge', 'clap', 'clap', 'pub', 'clap', 'pub', 'env', 'pub', 'clap'],
  next: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, [14, 36], 15, 16, 17, 18, 19, 20, 21, 22, [23, 41], 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 0, 37, 38, 39, 40, 15, 42, 43, 44, 45, 46, 25],
  prev: [35, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 13, 36, 37, 38, 39, 22, 41, 42, 43, 44, 45],
  xy: [[1, 8], [1, 7], [0, 7], [0, 6], [0, 5], [0, 4], [0, 3], [0, 2], [0, 1], [1, 1], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [7, 0], [8, 0], [9, 0], [9, 1], [10, 1], [10, 2], [10, 3], [10, 4], [10, 5], [10, 6], [10, 7], [10, 8], [9, 8], [8, 8], [7, 8], [6, 8], [5, 8], [4, 8], [3, 8], [2, 8], [4, 1], [4, 2], [5, 2], [6, 2], [6, 1], [9, 3], [8, 3], [8, 4], [8, 5], [8, 6], [9, 6]],
  jumps: [], tp: {},
}

// 2. Dédé-sur-Mer : boucle de 36 + Banc de sable (36-44), aiguillage 12 commandé par la marée.
{
  const ring = [...line(0, 8, 0, 0), ...line(1, 0, 10, 0), ...line(10, 1, 10, 8), ...line(9, 8, 1, 8)]
  const bank = [...line(4, 1, 4, 4), [5, 4], ...line(6, 4, 6, 1)]
  const next = seq(1, 35).concat([0]); next[12] = [13, 36]
  const prev = [35].concat(seq(0, 34))
  for (let i = 36; i <= 44; i++) { next.push(i === 44 ? 14 : i + 1); prev.push(i === 36 ? 12 : i - 1) }
  MAPS.mer = {
    cols: 11, rows: 9, mech: 'tide',
    //      0         1         2         3
    //      012345678901234567890123456789012345
    cells: types('scplcecl' + 'p' + 'celcpclecp' + 'lcpeclpc' + 'elcpcelpc' + 'ccecl' + 'cecc'),
    next, prev, xy: [...ring, ...bank], jumps: [], tp: {},
    bank: seq(36, 44), bankLoge: 40, washTo: 14,
  }
}

// 3. La Kermesse de Dédé : nœud papillon de 40 cases (grille 11 × 7), 2 cases Tombola (13 et 33).
{
  const xy = [...line(0, 6, 0, 0), ...line(1, 0, 4, 0), ...line(4, 1, 4, 2), [5, 2], ...line(6, 2, 6, 0), ...line(7, 0, 10, 0), ...line(10, 1, 10, 6), ...line(9, 6, 6, 6), ...line(6, 5, 6, 4), [5, 4], ...line(4, 4, 4, 6), ...line(3, 6, 1, 6)]
  MAPS.kermesse = {
    cols: 11, rows: 7, mech: 'tombola',
    cells: types('s' + 'clcpel' + 'cpcl' + 'ce' + 't' + 'clc' + 'pecl' + 'cpcelc' + 'pcel' + 'cp' + 't' + 'cel' + 'cpc'),
    next: seq(1, 39).concat([0]), prev: [39].concat(seq(0, 38)), xy, jumps: [], tp: {},
  }
}

// 4. Le Camping des Pins Penchés : croix de 36 cases, Riton part de la case 18.
{
  const xy = [...line(4, 8, 4, 5), ...line(3, 5, 0, 5), ...line(0, 4, 0, 3), ...line(1, 3, 4, 3), ...line(4, 2, 4, 0), ...line(5, 0, 6, 0), ...line(6, 1, 6, 3), ...line(7, 3, 10, 3), ...line(10, 4, 10, 5), ...line(9, 5, 6, 5), ...line(6, 6, 6, 8), [5, 8]]
  MAPS.camping = {
    cols: 11, rows: 9, mech: 'riton',
    cells: types('s' + 'cpl' + 'cecp' + 'lc' + 'cepl' + 'cec' + 'pl' + 'cce' + 'plcc' + 'ep' + 'lcce' + 'plc' + 'c'),
    next: seq(1, 35).concat([0]), prev: [35].concat(seq(0, 34)), xy, jumps: [], tp: {}, ritonStart: 18,
  }
}

// 5. Dédé 2000 : escargot de 49 cases, grande luge 48 -> 0, télésièges et plaques de verglas.
{
  const xy = [...line(0, 8, 0, 0), ...line(1, 0, 10, 0), ...line(10, 1, 10, 8), ...line(9, 8, 2, 8), ...line(2, 7, 2, 2), ...line(3, 2, 8, 2), ...line(8, 3, 8, 4)]
  MAPS.ski = {
    cols: 11, rows: 9, mech: 'tp',
    cells: types('s' + 'ccULpuec'.toLowerCase() + 'lpcuceulpc' + 'eculpcec' + 'plcecplc' + 'eicplc' + 'ecipci' + 'cl'),
    next: seq(1, 48).concat([0]), prev: [48].concat(seq(0, 47)), xy, jumps: [[48, 0]],
    tp: { 3: 37, 6: 40, 12: 42, 15: 45, 21: 47, 36: 2, 43: 13, 46: 20 },
  }
}

// ---------------------------------------------------------------------------- validation
let bad = 0
const ok = (label, cond, extra = '') => { if (!cond) bad++; console.log(`${cond ? 'ok  ' : 'KO  '} ${label}${extra ? ' — ' + extra : ''}`) }
for (const [id, m] of Object.entries(MAPS)) {
  const n = m.cells.length
  const count = (t) => m.cells.filter((x) => x === t).length
  ok(`${id} : tableaux de même taille (${n})`, m.next.length === n && m.prev.length === n && m.xy.length === n, `${m.next.length}/${m.prev.length}/${m.xy.length}`)
  ok(`${id} : cases dans la grille, aucune superposée`, m.xy.every(([c, r]) => c >= 0 && c < m.cols && r >= 0 && r < m.rows) && new Set(m.xy.map((p) => p.join(','))).size === n)
  const links = m.next.flatMap((x, i) => [x].flat().map((j) => [i, j]))
  const isJump = (i, j) => m.jumps.some(([a, b]) => a === i && b === j)
  ok(`${id} : toutes les liaisons relient deux cases voisines (hors sauts)`, links.every(([i, j]) => isJump(i, j) || Math.abs(m.xy[i][0] - m.xy[j][0]) + Math.abs(m.xy[i][1] - m.xy[j][1]) === 1))
  ok(`${id} : PREV inverse de NEXT`, m.prev.every((p, i) => [m.next[p]].flat().includes(i)))
  const reach = new Set([0])
  for (let grew = true; grew;) { grew = false; for (const i of [...reach]) for (const j of [m.next[i]].flat()) if (!reach.has(j)) { reach.add(j); grew = true } }
  ok(`${id} : tout est atteignable`, reach.size === n)
  const forks = m.next.map((x, i) => (Array.isArray(x) ? i : -1)).filter((i) => i >= 0)
  const lap = (way) => { let i = 0, k = 0; do { const nx = m.next[i]; i = Array.isArray(nx) ? nx[way] : nx; k++ } while (i !== 0 && k < 200); return k }
  // cases voisines non reliées (ambiguïté visuelle) : à signaler
  const linked = new Set(links.flatMap(([i, j]) => [`${i}-${j}`, `${j}-${i}`]))
  const amb = []
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (Math.abs(m.xy[i][0] - m.xy[j][0]) + Math.abs(m.xy[i][1] - m.xy[j][1]) === 1 && !linked.has(`${i}-${j}`)) amb.push(`${i}/${j}`)
  ok(`${id} : aucune paire de cases voisines non reliées`, amb.length === 0 || id === 'grand', amb.join(' '))
  ok(`${id} : 1 Départ en 0, Loges >= 6`, m.cells[0] === 'start' && count('start') === 1 && count('loge') >= 6)
  for (const [a, b] of Object.entries(m.tp)) {
    const A = m.xy[a], B = m.xy[b]
    ok(`${id} : téléporteur ${a} -> ${b} à 2 cases en ligne droite, arrivée sans téléporteur`, Math.abs(A[0] - B[0]) + Math.abs(A[1] - B[1]) === 2 && (A[0] === B[0] || A[1] === B[1]) && !(b in m.tp) && ['lift', 'ice'].includes(m.cells[a]) && (m.cells[a] === 'lift') === (b > +a))
  }
  console.log(`     ${id} : ${n} cases · tour ${lap(0)}${forks.length ? ' / ' + lap(1) : ''} · embranchements ${JSON.stringify(forks)} · start ${count('start')} clap ${count('clap')} pub ${count('pub')} env ${count('env')} loge ${count('loge')} tombola ${count('tombola')} lift ${count('lift')} ice ${count('ice')}`)
  console.log(`     CELLS ${JSON.stringify(m.cells)}`)
  console.log(`     NEXT  ${JSON.stringify(m.next)}`)
  console.log(`     PREV  ${JSON.stringify(m.prev)}`)
  console.log(`     XY    ${JSON.stringify(m.xy)}`)
  console.log(`     LOGES ${JSON.stringify(m.cells.map((t, i) => (t === 'loge' ? i : -1)).filter((i) => i >= 0))}`)
}
if (bad) { console.log(`\n${bad} contrôle(s) en échec`); process.exit(1) }

// ---------------------------------------------------------------------------- simulation
const C = { star_price: 30, half_price: 15, start_coins: 10, start_bonus: 5, clap: 3, pub: 3, gains: [10, 6, 4, 2], star_count: [1, 2, 2, 2, 2, 3, 3], toll: 3, pot_seed: 5, wash: 5, riton_steal: 5 }
const CARDS = ['plus8', 'minus5', 'fwd3', 'back3', 'swap_lead', 'steal3', 'charity', 'everyone3', 'star_moves', 'reroll', 'half_price', 'gift_double']

function game(id, n, rounds, skilled = false) {
  const m = MAPS[id]
  const N = m.cells.length
  const loges = m.cells.map((t, i) => (t === 'loge' ? i : -1)).filter((i) => i >= 0)
  const forks = m.next.map((x, i) => (Array.isArray(x) ? i : -1)).filter((i) => i >= 0)
  const P = seq(0, n - 1)
  const s = {
    pos: P.map(() => 0), dist: P.map(() => 0), coins: P.map(() => C.start_coins), stars: P.map(() => 0), half: P.map(() => true), dbl: P.map(() => 1),
    star_cells: shuffle(loges).slice(0, C.star_count[n - 2]), sw: forks.map(() => rnd(2)), order: shuffle(P), deck: [],
    st: P.map(() => ({ pubs: 0, mg_wins: 0, laps: 0, broke: 0, bought: 0, exact: 0 })),
    ev: { washed: 0, bankTrips: 0, rises: 0, toll: 0, jackpots: 0, jackpotSum: 0, jackpotMax: 0, steals: 0, drops: 0, stolen: 0, nones: 0, lifts: 0, ices: 0, maxSteps: 0 },
  }
  if (m.mech === 'tide') { const ph = rnd(3); s.tide = ph === 2 ? 1 : 0; s.tide_in = ph === 0 ? 2 : 1; s.sw = [1 - s.tide] }
  if (m.mech === 'tombola') s.pot = C.pot_seed
  if (m.mech === 'riton') { s.riton = m.ritonStart; s.sack = 0 }
  const submerged = (c) => m.mech === 'tide' && s.tide === 1 && c === m.bankLoge
  const coin = (p, d) => { const o = s.coins[p]; s.coins[p] = Math.max(0, o + d); if (s.coins[p] === 0 && o > 0) s.st[p].broke = 1; return s.coins[p] - o }
  const moveStar = (from) => { const free = loges.filter((c) => !s.star_cells.includes(c) && !submerged(c)); s.star_cells[s.star_cells.indexOf(from)] = free[rnd(free.length)] }
  const tryStar = (p, exact) => {
    const c = s.pos[p]
    if (!s.star_cells.includes(c)) return
    const price = s.half[p] ? C.half_price : C.star_price
    if (s.coins[p] >= price) { s.coins[p] -= price; s.stars[p]++; s.half[p] = false; s.st[p].bought++; if (exact) s.st[p].exact++; moveStar(c) }
  }
  const riton = (p) => {
    if (s.sack > 0) { coin(p, s.sack); s.ev.drops++; s.sack = 0 } else if (s.coins[p] > 0) { s.sack = -coin(p, -C.riton_steal); s.ev.steals++; s.ev.stolen += s.sack } else s.ev.nones++
  }
  // marche : dice = déplacement de dé (la dernière case aura son effet), sinon carte
  const walk = (p, k, dir, dice) => {
    for (let i = 1; i <= k; i++) {
      if (dir < 0) s.pos[p] = m.prev[s.pos[p]]
      else {
        const nx = m.next[s.pos[p]]
        if (Array.isArray(nx)) {
          const f = forks.indexOf(s.pos[p])
          if (m.mech === 'tide') { const way = s.tide === 0 ? 1 : 0; if (way === 1) s.ev.bankTrips++; s.pos[p] = nx[way] } else { const way = s.sw[f]; s.sw[f] = 1 - way; s.pos[p] = nx[way] }
        } else s.pos[p] = nx
      }
      s.dist[p] += dir
      if (dir > 0 && s.pos[p] === 0) { coin(p, C.start_bonus); s.st[p].laps++ }
      if (m.mech === 'tombola' && dir > 0 && m.cells[s.pos[p]] === 'tombola' && i < k) { s.pot += -coin(p, -C.toll); s.ev.toll++ }
      if (m.mech === 'riton' && s.pos[p] === s.riton) riton(p)
      tryStar(p, i === k && dice)
    }
  }
  const idx = (p) => s.order.indexOf(p)
  const land = (p) => {
    const t = m.cells[s.pos[p]]
    let extra = 0
    if (t === 'clap') coin(p, C.clap)
    else if (t === 'pub') { coin(p, -C.pub); s.st[p].pubs++ }
    else if (t === 'tombola') { s.ev.jackpots++; s.ev.jackpotSum += s.pot; s.ev.jackpotMax = Math.max(s.ev.jackpotMax, s.pot); coin(p, s.pot); s.pot = C.pot_seed }
    else if (t === 'lift' || t === 'ice') {
      const to = m.tp[s.pos[p]]
      s.dist[p] += to - s.pos[p]; s.pos[p] = to; s.ev[t === 'lift' ? 'lifts' : 'ices']++; extra = 1
      tryStar(p, true)
    } else if (t === 'env') {
      if (!s.deck.length) s.deck = shuffle(CARDS)
      const card = s.deck.shift()
      if (card === 'plus8') coin(p, 8)
      else if (card === 'minus5') coin(p, -5)
      else if (card === 'fwd3') { walk(p, 3, 1, false); extra = 3 } else if (card === 'back3') { walk(p, 3, -1, false); extra = 3 } else if (card === 'reroll') { const d = die(); walk(p, d, 1, false); extra = d } else if (card === 'swap_lead') {
        const o = P.filter((x) => x !== p && s.dist[x] > s.dist[p]).sort((a, b) => s.dist[b] - s.dist[a] || idx(a) - idx(b))[0]
        if (o !== undefined) { [s.pos[p], s.pos[o]] = [s.pos[o], s.pos[p]]; [s.dist[p], s.dist[o]] = [s.dist[o], s.dist[p]] }
      } else if (card === 'steal3') {
        const o = P.filter((x) => x !== p && s.coins[x] > 0).sort((a, b) => s.coins[b] - s.coins[a] || idx(a) - idx(b))[0]
        if (o !== undefined) coin(p, -coin(o, -3))
      } else if (card === 'charity') {
        const o = P.slice().sort((a, b) => s.stars[a] - s.stars[b] || s.coins[a] - s.coins[b] || idx(a) - idx(b))[0]
        let sum = 0; for (const x of P) if (x !== o) sum += -coin(x, -2); coin(o, sum)
      } else if (card === 'everyone3') P.forEach((x) => coin(x, 3))
      else if (card === 'star_moves') s.star_cells.slice().forEach((c) => moveStar(c))
      else if (card === 'half_price') s.half[p] = true
      else if (card === 'gift_double') s.dbl[p]++
    }
    return extra
  }
  const lvl = (p) => (skilled ? 1 - p / (n - 1) : 0.5)
  for (let round = 1; round <= rounds; round++) {
    if (round > 1) s.order.push(s.order.shift())
    for (const p of s.order) {
      const useD = s.dbl[p] > 0 && Math.random() < 0.25
      if (useD) s.dbl[p]--
      const k = die() + die() + (useD ? die() : 0)
      walk(p, k, 1, true)
      const extra = land(p)
      s.ev.maxSteps = Math.max(s.ev.maxSteps, k + extra)
    }
    // épilogue
    if (m.mech === 'tide') {
      if (--s.tide_in === 0) {
        s.tide = 1 - s.tide; s.tide_in = s.tide === 0 ? 2 : 1; s.sw = [1 - s.tide]
        if (s.tide === 1) {
          s.ev.rises++
          for (const p of s.order) if (m.bank.includes(s.pos[p])) { s.dist[p] += 45 - s.pos[p]; s.pos[p] = m.washTo; coin(p, -C.wash); s.ev.washed++ }
          if (s.star_cells.includes(m.bankLoge)) moveStar(m.bankLoge)
        }
      }
    }
    if (m.mech === 'riton') {
      for (let k = die(); k > 0; k--) { s.riton = m.prev[s.riton]; for (const p of s.order) if (s.pos[p] === s.riton) riton(p) }
    }
    // mini-jeu : classement tiré au sort (pondéré par le niveau en mode « niveaux »)
    const rank = P.slice().sort((a, b) => (Math.random() + lvl(b) * (skilled ? 1.2 : 0)) - (Math.random() + lvl(a) * (skilled ? 1.2 : 0)))
    rank.forEach((p, r) => coin(p, (C.gains[r] ?? 2) * (round === rounds ? 2 : 1)))
    s.st[rank[0]].mg_wins++
  }
  const bought = s.stars.slice()
  const kmax = Math.max(...P.map((p) => s.st[p].mg_wins)), pmax = Math.max(...P.map((p) => s.st[p].pubs))
  for (const p of P) { if (kmax > 0 && s.st[p].mg_wins === kmax) s.stars[p]++; if (pmax > 0 && s.st[p].pubs === pmax) s.stars[p]++ }
  return { s, bought }
}

const pct = (a, b) => `${((100 * a) / Math.max(1, b)).toFixed(0)} %`
const f = (x, d = 2) => x.toFixed(d)
for (const [n, rounds, skilled] of [[2, 9, false], [4, 9, false], [6, 9, false], [8, 9, false], [4, 6, false], [4, 12, false], [6, 9, true]]) {
  console.log(`\n=== ${n} joueurs, ${rounds} tours${skilled ? ' (niveaux)' : ''} — ${SIMS} parties ===`)
  for (const id of Object.keys(MAPS)) {
    let stars = 0, boughtSum = 0, none = 0, win = 0, laps = 0, broke = 0, coins = 0, pubs3 = 0, exact = 0, best = 0, worst = 0, max = 0
    const ev = {}
    for (let g = 0; g < SIMS; g++) {
      const { s, bought } = game(id, n, rounds, skilled)
      for (let p = 0; p < n; p++) { stars += s.stars[p]; boughtSum += bought[p]; if (s.stars[p] === 0) none++; laps += s.st[p].laps; broke += s.st[p].broke; coins += s.coins[p]; if (s.st[p].pubs >= 3) pubs3++; if (s.st[p].exact) exact++ }
      win += Math.max(...s.stars); best += s.stars[0]; worst += s.stars[n - 1]
      for (const k in s.ev) ev[k] = k === 'jackpotMax' || k === 'maxSteps' ? Math.max(ev[k] ?? 0, s.ev[k]) : (ev[k] ?? 0) + s.ev[k]
      max = Math.max(max, s.ev.maxSteps)
    }
    const G = SIMS, PG = SIMS * n
    let l = `${id.padEnd(9)} étoiles/joueur ${f(stars / PG)} (achetées ${f(boughtSum / PG)}) · vainqueur ${f(win / G)} · sans étoile ${pct(none, PG)} · Départ/joueur ${f(laps / PG)} · fauché ${pct(broke, PG)} · pubs>=3 ${pct(pubs3, PG)} · pile ${pct(exact, PG)} · pièces fin ${f(coins / PG, 1)} · pas max ${max}`
    if (skilled) l += ` · meilleur ${f(best / G)} / pire ${f(worst / G)}`
    if (id === 'mer') l += `\n          marée : ${f(ev.rises / G)} montées, ${f(ev.bankTrips / G)} passages par le banc, ${f(ev.washed / G)} pions emportés par partie (${f(ev.washed / PG)} par joueur)`
    if (id === 'kermesse') l += `\n          tombola : ${f(ev.toll / G)} péages, ${f(ev.jackpots / G)} gros lots par partie, gros lot moyen ${f(ev.jackpotSum / Math.max(1, ev.jackpots), 1)}, record ${ev.jackpotMax}`
    if (id === 'camping') l += `\n          Riton : ${f(ev.steals / G)} vols (${f(ev.stolen / Math.max(1, ev.steals), 1)} pièces en moyenne), ${f(ev.drops / G)} sacs lâchés, ${f(ev.nones / G)} bredouilles par partie`
    if (id === 'ski') l += `\n          ski : ${f(ev.lifts / G)} télésièges, ${f(ev.ices / G)} glissades par partie`
    console.log(l)
  }
}
