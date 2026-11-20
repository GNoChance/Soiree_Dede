// Dédé Party — grands plateaux (tailles S / M / L) : générateur de tracés, contrôles et simulation d'équilibre.
// Document de conception : docs/superpowers/specs/2026-11-20-dede-party-grands-plateaux-design.md
//   node tools/dede-party/grands-plateaux-sim.mjs [parties par config]   → contrôles + simulation
//   node tools/dede-party/grands-plateaux-sim.mjs --dump [map] [taille]  → plans + tableaux CELLS / NEXT / PREV / XY / JUMPS / EXTRA
// Réglages (variables d'environnement) : ONLY=mer,ski (plateaux simulés) · MIX_ILE / MIX_CAMP (motif des cases) · RATONS=2 (un seul raton pour les deux quartiers).
// Les plateaux de base (taille S) sont relus dans src/games/dede-party/boards/<id>.ts : aucune copie ici.
import fs from 'node:fs'

const args = process.argv.slice(2)
const DUMP = args[0] === '--dump'
const SIMS = DUMP ? 0 : Number(args[0] ?? 3000)
const rnd = (n) => Math.floor(Math.random() * n)
const die = () => 1 + rnd(6)
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]] } return a }
const seq = (from, to) => { const r = []; for (let i = from; i <= to; i++) r.push(i); return r }

// ---------------------------------------------------------------------------- plateaux de base (boards/<id>.ts)
const tsConst = (src, name) => JSON.parse(src.match(new RegExp(`export const ${name}[^=]*= (.+)\\n`))[1].replace(/'/g, '"'))
const BASE = {}
for (const id of ['grand', 'mer', 'kermesse', 'camping', 'ski']) {
  const src = fs.readFileSync(new URL(`../../src/games/dede-party/boards/${id}.ts`, import.meta.url), 'utf8')
  BASE[id] = { cells: tsConst(src, 'CELLS'), next: tsConst(src, 'NEXT'), prev: tsConst(src, 'PREV'), xy: tsConst(src, 'XY'), extra: tsConst(src, 'EXTRA') }
  BASE[id].forks = BASE[id].next.map((x, i) => (Array.isArray(x) ? i : -1)).filter((i) => i >= 0)
}

// ---------------------------------------------------------------------------- outils de tracé
const T = { s: 'start', c: 'clap', p: 'pub', e: 'env', l: 'loge', t: 'tombola', u: 'lift', i: 'ice', h: 'halt' }
const LETTER = { start: 'D', clap: 'A', pub: 'P', env: 'E', loge: 'L', tombola: 'T', lift: 'M', ice: 'G', halt: 'H' }
/** Segment droit, extrémités comprises. */
const seg = (c0, r0, c1, r1) => { const r = []; const dc = Math.sign(c1 - c0), dr = Math.sign(r1 - r0); let c = c0, y = r0; for (;;) { r.push([c, y]); if (c === c1 && y === r1) break; c += dc; y += dr } return r }
const path = (...segs) => segs.flat()
/** Types d'un chemin : motif répété, puis cases imposées ({rang: lettre}). */
const types = (n, pattern, over = {}) => { const a = []; for (let i = 0; i < n; i++) a.push(over[i] ?? pattern[i % pattern.length]); return a.map((ch) => T[ch]) }
/** Motif courant d'un quartier : 50 % d'Applaudissements, 1 Loge / 1 Enveloppe / 1 Pub toutes les 6 cases. */
const MIX = 'cclcepclcecp'
/** Îles de Dédé-sur-Mer : moins d'Applaudissements, plus de Loges (la Halte d'arrivée rapporte déjà 5 pièces). */
const MIX_ILE = process.env.MIX_ILE ?? 'clcpelcecplc'
/** Quartiers du Camping : un peu plus généreux (le plateau de base est le plus dense en Loges et en Départs). */
const MIX_CAMP = process.env.MIX_CAMP ?? 'cclcepclcecc'

function start(id) {
  const b = BASE[id]
  return {
    id, cells: b.cells.slice(), next: JSON.parse(JSON.stringify(b.next)), prev: b.prev.slice(), xy: b.xy.map((p) => p.slice()),
    jumps: id === 'ski' ? [[48, 0]] : [], modes: {}, tp: Object.fromEntries(Object.entries(b.extra.tp ?? {}).map(([a, c]) => [a, c])), quarters: [], zones: [], banks: [], starts: null, ritons: [],
  }
}
/**
 * Ajoute un chemin (quartier, banc…) : cases à la suite, entrée par `gate`, sortie vers `to`.
 * - gate devient un embranchement [tout droit, chemin] (mode toggle ou tide) ; avec `replace`, le chemin
 *   remplace la suite de gate (passage obligé, pas d'embranchement) ;
 * - jumpIn / jumpOut : la liaison d'entrée / de sortie est un transport (pas de ruban).
 */
function addPath(m, name, coords, typ, { gate = null, mode = 'toggle', to, jumpIn = false, jumpOut = false, zone = true, emoji = '', replace = false, stars = 1 } = {}) {
  if (coords.length !== typ.length) throw new Error(`${m.id}/${name} : ${coords.length} cases, ${typ.length} types`)
  const f = m.cells.length
  coords.forEach((xy, k) => {
    m.cells.push(typ[k]); m.xy.push(xy)
    m.next.push(k === coords.length - 1 ? to : f + k + 1)
    m.prev.push(k === 0 ? gate : f + k - 1)
  })
  const last = m.cells.length - 1
  if (gate !== null) {
    if (Array.isArray(m.next[gate])) throw new Error(`${name} : ${gate} est déjà un embranchement`)
    if (replace) m.next[gate] = f
    else { m.next[gate] = [m.next[gate], f]; m.modes[gate] = mode }
    if (jumpIn) m.jumps.push([gate, f])
  }
  if (jumpOut) m.jumps.push([last, to])
  const q = { name, emoji, first: f, last, cells: seq(f, last), gate, to, stars }
  if (zone) m.quarters.push(q)
  return q
}
const at = (m, c, r) => { const i = m.xy.findIndex((p) => p[0] === c && p[1] === r); if (i < 0) throw new Error(`${m.id} : pas de case en (${c},${r})`); return i }
const logesOf = (m, cells) => cells.filter((i) => m.cells[i] === 'loge')

// ---------------------------------------------------------------------------- les plateaux, taille par taille
const SIZES = { grand: ['s', 'm'], mer: ['s', 'm', 'l'], kermesse: ['s', 'm'], camping: ['s', 'm'], ski: ['s', 'm', 'l'] }
const big = (size) => size !== 's'
/** Taille d'une partie : figée au départ selon le nombre de joueurs (comme _dp_size). */
const sizeFor = (id, n) => (n >= 7 && SIZES[id].includes('l') ? 'l' : n >= 5 ? 'm' : 's')

function build(id, size) {
  const m = start(id)
  m.size = size
  m.n0 = m.cells.length
  if (id === 'grand') buildGrand(m, size)
  if (id === 'mer') buildMer(m, size)
  if (id === 'kermesse') buildKermesse(m, size)
  if (id === 'camping') buildCamping(m, size)
  if (id === 'ski') buildSki(m, size)
  // Zones d'étoiles (grandes tailles) : la base (n = 0 → star_count du nombre de joueurs, soit 2 ou 3) + chaque quartier.
  if (big(size)) {
    const inQuarter = new Set(m.quarters.flatMap((q) => q.cells))
    m.zones = [{ name: 'base', n: 0, loges: logesOf(m, seq(0, m.cells.length - 1).filter((i) => !inQuarter.has(i))) }, ...m.quarters.map((q) => ({ name: q.name, n: q.stars, loges: logesOf(m, q.cells) }))]
  }
  m.forks = m.next.map((x, i) => (Array.isArray(x) ? i : -1)).filter((i) => i >= 0)
  // Modes dans l'ordre des embranchements (comme _dp_map(...).forks).
  BASE[id].forks.forEach((c, k) => { m.modes[c] = (BASE[id].extra.forks ?? [])[k] })
  m.forkModes = m.forks.map((c) => m.modes[c])
  return m
}

// 1. Le Grand Plateau — M : « Les Coulisses » (côté jardin, à gauche) + « La Régie » (devant).
function buildGrand(m, size) {
  if (!big(size)) return
  // Les Coulisses : aiguillage en 4 (0,5), retour en 7 (0,2).
  const c1 = path(seg(-1, 5, -2, 5), seg(-2, 6, -2, 8), seg(-3, 8, -7, 8), seg(-7, 7, -7, 0), seg(-6, 0, -2, 0), seg(-2, 1, -2, 2), [[-1, 2]])
  addPath(m, 'Les Coulisses', c1, types(c1.length, 'cclcecpclcec', { 0: 'c', [c1.length - 1]: 'c' }), { gate: 4, to: 7, emoji: '👗' })
  // La Régie : aiguillage en 28 (9,8), retour en 32 (5,8).
  const c2 = path(seg(9, 9, 9, 10), seg(10, 10, 11, 10), seg(11, 11, 11, 14), seg(10, 14, 1, 14), seg(1, 13, 1, 10), seg(2, 10, 5, 10), [[5, 9]])
  addPath(m, 'La Régie', c2, types(c2.length, 'cepclcepcelp', { 0: 'c', [c2.length - 1]: 'c' }), { gate: 28, to: 32, emoji: '🎛️' })
}

// 2. Dédé-sur-Mer — M : l'Île aux Mouettes + l'Île Coco ; L : + le Piton Fumant, la Crique des Pirates, l'Îlot des Crabes.
function buildMer(m, size) {
  m.banks = [{ name: 'Le Banc de sable', cells: seq(36, 44), washTo: 14, end: 45 }]
  if (!big(size)) return
  const island = (name, emoji, coords, over, gate, to) => addPath(m, name, coords, types(coords.length, MIX_ILE, { 0: 'h', ...over }), { gate, to, jumpIn: true, jumpOut: true, emoji })
  const bank = (name, q, coords, fromXY, toXY, pattern) => {
    const gate = at(m, ...fromXY), back = at(m, ...toXY)
    const b = addPath(m, name, coords, types(coords.length, pattern), { gate, mode: 'tide', to: back, zone: false })
    q.cells.push(...b.cells)
    m.banks.push({ name, cells: b.cells, washTo: back, end: b.last + 1 })
  }
  // L'Île aux Mouettes (ouest, en haut) : bac en 4 (0,4), retour en 8 (0,0). Banc « La Langue des Mouettes » au sud.
  const mou = path(seg(-3, 0, -3, 2), seg(-4, 2, -9, 2), seg(-9, 1, -9, -4), seg(-8, -4, -3, -4), seg(-3, -3, -3, -2))
  const qMou = island('L’Île aux Mouettes', '🐦', mou, { 4: 'c' }, 4, 8)
  bank('La Langue des Mouettes', qMou, [[-5, 3], [-5, 4], [-6, 4], [-7, 4], [-7, 3]], [-5, 2], [-7, 2], 'cclec')
  // L'Île Coco (nord) : bac en 9 (1,0), retour en 11 (3,0).
  const coco = path(seg(2, -2, 0, -2), seg(0, -3, 0, -6), seg(1, -6, 10, -6), seg(10, -5, 10, -2), seg(9, -2, 4, -2))
  island('L’Île Coco', '🥥', coco, {}, 9, 11)
  if (size !== 'l') return
  // Le Piton Fumant (est, en haut) : bac en 20 (10,2), retour en 22 (10,4).
  const pit = path(seg(12, 1, 12, 2), seg(13, 2, 20, 2), seg(20, 1, 20, -6), seg(19, -6, 12, -6), seg(12, -5, 12, -1))
  island('Le Piton Fumant', '🌋', pit, {}, 20, 22)
  // La Crique des Pirates (est, en bas) : bac en 26 (10,8), retour en 28 (8,8). Banc « Le Gué du Trésor » dans la crique.
  const pir = path(seg(12, 8, 12, 6), seg(13, 6, 20, 6), seg(20, 7, 20, 13), seg(19, 13, 12, 13), seg(12, 12, 12, 10))
  const qPir = island('La Crique des Pirates', '🏴‍☠️', pir, { 12: 'c', 14: 'c' }, 26, 28)
  bank('Le Gué du Trésor', qPir, [[19, 8], [18, 8], [17, 8], [17, 9], [17, 10], [18, 10], [19, 10]], [20, 8], [20, 10], 'ccelccc')
  // L'Îlot des Crabes (ouest, en bas) : bac en 31 (5,8), retour en 33 (3,8). Banc « Le Gué des Crabes » dans le lagon.
  const cra = path(seg(-3, 8, -3, 6), seg(-4, 6, -10, 6), seg(-10, 7, -10, 13), seg(-9, 13, -3, 13), seg(-3, 12, -3, 10))
  const qCra = island('L’Îlot des Crabes', '🦀', cra, { 11: 'c', 13: 'c' }, 31, 33)
  bank('Le Gué des Crabes', qCra, [[-9, 8], [-8, 8], [-7, 8], [-7, 9], [-7, 10], [-8, 10], [-9, 10]], [-10, 8], [-10, 10], 'ccceclc')
  // Départs répartis : par deux, sur les pontons d'îles tirées au sort parmi les 5.
  m.starts = m.quarters.map((q) => q.first)
}

// 3. La Kermesse — M : « Le Train Fantôme » (à gauche) + « Le Grand Huit » (devant, à droite). 4 guichets de Tombola, une cagnotte.
function buildKermesse(m, size) {
  if (!big(size)) return
  // Le Train Fantôme : tourniquet en 3 (0,3), retour en 5 (0,1).
  const tf = path(seg(-1, 3, -2, 3), seg(-2, 4, -2, 7), seg(-3, 7, -9, 7), seg(-9, 6, -9, -1), seg(-8, -1, -2, -1), seg(-2, 0, -2, 1), [[-1, 1]])
  addPath(m, 'Le Train Fantôme', tf, types(tf.length, MIX, { 0: 'c', 15: 't', [tf.length - 1]: 'c' }), { gate: 3, to: 5, emoji: '👻' })
  // Le Grand Huit : tourniquet en 26 (10,6), retour en 28 (8,6).
  const gh = path(seg(10, 7, 10, 8), seg(11, 8, 13, 8), seg(13, 9, 13, 12), seg(12, 12, 3, 12), seg(3, 11, 3, 8), seg(4, 8, 8, 8), [[8, 7]])
  addPath(m, 'Le Grand Huit', gh, types(gh.length, MIX, { 0: 'c', 14: 't', [gh.length - 1]: 'c' }), { gate: 26, to: 28, emoji: '🎢' })
}

// 4. Le Camping — M : « Le Sous-bois aux Champignons » (ouest) + « La Rivière aux Castors » (nord). Rita, 2e raton, y fait sa ronde.
function buildCamping(m, size) {
  m.ritons = [{ name: 'Riton', start: BASE.camping.extra.riton_start, circuit: null }]
  if (!big(size)) return
  // Le Sous-bois : barrière en 7 (0,5), retour en 9 (0,3).
  const sb = path(seg(-1, 5, -2, 5), seg(-2, 6, -2, 8), seg(-3, 8, -9, 8), seg(-9, 7, -9, 0), seg(-8, 0, -2, 0), seg(-2, 1, -2, 3), [[-1, 3]])
  const q1 = addPath(m, 'Le Sous-bois aux Champignons', sb, types(sb.length, MIX_CAMP, { 0: 'c', [sb.length - 1]: 'c' }), { gate: 7, to: 9, emoji: '🍄' })
  // La Rivière aux Castors : barrière en 16 (4,0), retour en 18 (6,0).
  const rv = path(seg(4, -1, 4, -2), seg(3, -2, 0, -2), seg(0, -3, 0, -8), seg(1, -8, 10, -8), seg(10, -7, 10, -2), seg(9, -2, 6, -2), [[6, -1]])
  const q2 = addPath(m, 'La Rivière aux Castors', rv, types(rv.length, MIX_CAMP, { 0: 'c', [rv.length - 1]: 'c' }), { gate: 16, to: 18, emoji: '🦫' })
  // La famille Raton : un raton par quartier, chacun sa ronde fermée à contresens (le quartier à l'envers, en boucle).
  // RATONS=2 : variante à un seul raton (Rita) pour les deux quartiers.
  if (process.env.RATONS === '2') m.ritons.push({ name: 'Rita', start: q2.cells[Math.floor(q2.cells.length / 2)], circuit: [...q1.cells.slice().reverse(), ...q2.cells.slice().reverse()] })
  else {
    m.ritons.push({ name: 'Rita', start: q1.cells[Math.floor(q1.cells.length / 2)], circuit: q1.cells.slice().reverse() })
    m.ritons.push({ name: 'Ritou', start: q2.cells[Math.floor(q2.cells.length / 2)], circuit: q2.cells.slice().reverse() })
  }
}

// 5. Dédé 2000 — M : « Dédé 2500 » (la Combe aux Chamois + les Alpages) ; L : + « Dédé 3000 » (le Glacier, la Crête des Aigles) et le Pic.
function buildSki(m, size) {
  if (!big(size)) return
  const sector = (name, emoji, coords, lifts, ices, plain, opts) => {
    const over = { 0: 'h' }
    const k = (c, r) => coords.findIndex((p) => p[0] === c && p[1] === r)
    for (const [c, r] of lifts) { over[k(c, r)] = 'u'; over[k(c, r - 2)] = 'c' }
    for (const [c, r] of ices) { over[k(c, r)] = 'i'; over[k(c, r + 2)] = 'c' }
    for (const [c, r] of plain) over[k(c, r)] = 'c'
    const q = addPath(m, name, coords, types(coords.length, MIX, over), { ...opts, emoji })
    for (const [c, r] of lifts) m.tp[at(m, c, r)] = at(m, c, r - 2)
    for (const [c, r] of ices) m.tp[at(m, c, r)] = at(m, c, r + 2)
    return q
  }
  // La Combe aux Chamois (bas, ouest) : télécabine en 11 (3,0), une cabine sur deux ; au bout, la piste ramène en 14 (6,0).
  const cw = path(seg(4, -2, -9, -2), [[-9, -3]], seg(-9, -4, 3, -4))
  const qCw = sector('La Combe aux Chamois', '🐐', cw, [[-2, -2], [-7, -2]], [[-5, -4]], [[3, -4]], { gate: 11, to: 14, jumpIn: true, jumpOut: true })
  // Les Alpages (bas, est) : en 13 (5,0), tous ceux qui ont continué prennent la télécabine ; la piste ramène en 18 (10,0).
  const ce = path(seg(6, -2, 19, -2), [[19, -3]], seg(19, -4, 7, -4))
  const qCe = sector('Les Alpages', '🐄', ce, [[12, -2], [17, -2]], [[15, -4]], [[7, -4]], { gate: 13, replace: true, to: 18, jumpIn: true, jumpOut: true })
  m.prev[14] = qCw.last // la case 14 ne se rejoint plus que par la piste de la Combe
  if (size !== 'l') return
  // Le Glacier (haut, ouest) : télécabine au bout de la Combe (une sur deux) ; piste rouge au bout du 2e lacet (retour 20) ; arête ouest jusqu'au Pic.
  const gw = path(seg(4, -6, -8, -6), [[-8, -7]], seg(-8, -8, 3, -8), [[3, -9]], seg(3, -10, -6, -10), [[-6, -11]], seg(-6, -12, 5, -12))
  const qGw = sector('Le Glacier', '🧊', gw, [[0, -6], [-5, -6], [-2, -8], [2, -10]], [[-4, -10], [0, -12]], [[3, -8]], { gate: qCw.last, to: 0, jumpIn: true, jumpOut: true, stars: 2 })
  m.cells[qGw.last] = 'loge' // la Loge du Pic (case commune aux deux arêtes)
  const summit = qGw.last
  // La Crête des Aigles (haut, est) : symétrique ; son arête rejoint le Pic.
  const ge = path(seg(6, -6, 18, -6), [[18, -7]], seg(18, -8, 7, -8), [[7, -9]], seg(7, -10, 16, -10), [[16, -11]], seg(16, -12, 6, -12))
  const qGe = sector('La Crête des Aigles', '🦅', ge, [[10, -6], [15, -6], [12, -8], [8, -10]], [[14, -10], [10, -12]], [[7, -8]], { gate: qCe.last, to: summit, jumpIn: true, stars: 2 })
  // Pistes rouges : au bout du 2e lacet, un pion sur deux redescend à la Station.
  const fork = (cell, to) => { m.next[cell] = [m.next[cell], to]; m.modes[cell] = 'toggle'; m.jumps.push([cell, to]) }
  fork(at(m, 3, -8), 20)
  fork(at(m, 7, -8), 24)
  m.starts = [qCw.first, qCe.first, qGw.first, qGe.first]
}

// ---------------------------------------------------------------------------- contrôles
let bad = 0
const ok = (label, cond, extra = '') => { if (!cond) bad++; if (!cond || !DUMP) console.log(`${cond ? 'ok  ' : 'KO  '} ${label}${extra ? ' — ' + extra : ''}`) }
const MAPS = {}
for (const id of Object.keys(SIZES)) for (const size of SIZES[id]) MAPS[`${id}:${size}`] = build(id, size)

function bbox(m) { const cs = m.xy.map((p) => p[0]), rs = m.xy.map((p) => p[1]); return { c0: Math.min(...cs), c1: Math.max(...cs), r0: Math.min(...rs), r1: Math.max(...rs) } }
function plan(m, what = 'type') {
  const b = bbox(m)
  const w = what === 'type' ? 2 : 4
  const rows = [' '.repeat(5) + seq(b.c0, b.c1).map((c) => String(c).padStart(w)).join('')]
  for (let r = b.r0; r <= b.r1; r++) {
    let s = String(r).padStart(4) + ' '
    for (let c = b.c0; c <= b.c1; c++) {
      const i = m.xy.findIndex((p) => p[0] === c && p[1] === r)
      s += i < 0 ? '·'.padStart(w) : what === 'type' ? ' ' + LETTER[m.cells[i]] : String(i).padStart(w)
    }
    rows.push(s)
  }
  return rows.join('\n')
}

for (const [key, m] of Object.entries(MAPS)) {
  const n = m.cells.length
  const count = (t) => m.cells.filter((x) => x === t).length
  ok(`${key} : tableaux de même taille (${n})`, m.next.length === n && m.prev.length === n && m.xy.length === n)
  ok(`${key} : aucune case superposée`, new Set(m.xy.map((p) => p.join(','))).size === n)
  const links = m.next.flatMap((x, i) => [x].flat().map((j) => [i, j]))
  const isJump = (i, j) => m.jumps.some(([a, b]) => a === i && b === j)
  const adj = (i, j) => Math.abs(m.xy[i][0] - m.xy[j][0]) + Math.abs(m.xy[i][1] - m.xy[j][1]) === 1
  const far = links.filter(([i, j]) => !isJump(i, j) && !adj(i, j))
  ok(`${key} : liaisons entre cases voisines (hors ${m.jumps.length} transports)`, far.length === 0, JSON.stringify(far))
  ok(`${key} : aucun transport entre cases voisines, tous les transports sont des liaisons`, m.jumps.every(([i, j]) => !adj(i, j) && links.some(([a, b]) => a === i && b === j)))
  ok(`${key} : PREV inverse de NEXT`, m.prev.every((p, i) => [m.next[p]].flat().includes(i)), JSON.stringify(m.prev.map((p, i) => ([m.next[p]].flat().includes(i) ? -1 : i)).filter((i) => i >= 0)))
  const reach = new Set([0])
  for (let grew = true; grew;) { grew = false; for (const i of [...reach]) for (const j of [m.next[i]].flat()) if (!reach.has(j)) { reach.add(j); grew = true } }
  ok(`${key} : tout est atteignable depuis le Départ`, reach.size === n, seq(0, n - 1).filter((i) => !reach.has(i)).join(' '))
  const back = new Set([0])
  for (let grew = true; grew;) { grew = false; for (let i = 0; i < n; i++) if (!back.has(i) && [m.next[i]].flat().some((j) => back.has(j))) { back.add(i); grew = true } }
  ok(`${key} : toute case ramène au Départ`, back.size === n)
  const linked = new Set(links.flatMap(([i, j]) => [`${i}-${j}`, `${j}-${i}`]))
  const amb = []
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (adj(i, j) && !linked.has(`${i}-${j}`) && !(m.id === 'grand' && i < m.n0 && j < m.n0) && !(m.id === 'ski' && i === 13 && j === 14)) amb.push(`${i}/${j}`)
  ok(`${key} : aucune paire de cases voisines non reliées`, amb.length === 0, amb.join(' '))
  const newForks = m.forks.filter((c) => !BASE[m.id].forks.includes(c))
  ok(`${key} : Départ en 0 ; nouveaux embranchements jamais sur une Loge, un téléporteur, une Tombola ou une Halte`, m.cells[0] === 'start' && count('start') === 1 && newForks.every((c) => !['loge', 'lift', 'ice', 'tombola', 'halt'].includes(m.cells[c])), newForks.map((c) => `${c}:${m.cells[c]}`).join(' '))
  ok(`${key} : téléporteurs cohérents (${Object.keys(m.tp).length})`, Object.entries(m.tp).every(([a, b]) => ['lift', 'ice'].includes(m.cells[a]) && !(b in m.tp) && m.cells[b] === 'clap' && !Array.isArray(m.next[a]) && !Array.isArray(m.next[b])) && m.cells.every((t, i) => !['lift', 'ice'].includes(t) || String(i) in m.tp))
  for (const z of m.zones) ok(`${key} : zone « ${z.name} » : ${z.loges.length} Loges pour ${z.n || '2-3'} étoile(s)`, z.loges.length >= (z.n || 3) + 2, JSON.stringify(z.loges))
  for (const b of m.banks) ok(`${key} : ${b.name} — banc sans Pub, retour ${b.washTo}`, b.cells.every((c) => m.cells[c] !== 'pub') && m.next[b.cells[b.cells.length - 1]] === b.washTo)
  const small = MAPS[`${m.id}:${SIZES[m.id][SIZES[m.id].indexOf(m.size) - 1]}`]
  if (small) ok(`${key} : la taille précédente est un préfixe (types et coordonnées)`, JSON.stringify(m.cells.slice(0, small.cells.length)) === JSON.stringify(small.cells) && JSON.stringify(m.xy.slice(0, small.xy.length)) === JSON.stringify(small.xy))
  const b = bbox(m)
  if (!DUMP) console.log(`     ${key} : ${n} cases · grille ${b.c1 - b.c0 + 1} × ${b.r1 - b.r0 + 1} (col ${b.c0}..${b.c1}, lig ${b.r0}..${b.r1}) · embranchements ${JSON.stringify(m.forks)} ${JSON.stringify(m.forkModes)} · transports ${m.jumps.length} · start ${count('start')} halt ${count('halt')} clap ${count('clap')} pub ${count('pub')} env ${count('env')} loge ${count('loge')} tombola ${count('tombola')} lift ${count('lift')} ice ${count('ice')}`)
  if (!DUMP) for (const q of m.quarters) console.log(`       ${q.emoji} ${q.name} : ${q.cells.length} cases (${q.first}-${q.last}${q.cells.length > q.last - q.first + 1 ? ' + banc ' + q.cells.filter((c) => c > q.last).join(',') : ''}) · entrée ${q.gate} · sortie ${JSON.stringify(m.next[q.last])}`)
}
if (bad) { console.log(`\n${bad} contrôle(s) en échec`); process.exit(1) }

/** Fiche de mécanique (miroir de _dp_map(map, size)) ; les transports (JUMPS) ne servent qu'au rendu. */
function extra(m) {
  if (m.size === 's') return BASE[m.id].extra
  const e = { ...BASE[m.id].extra, forks: m.forkModes, size: m.size }
  e.stars = m.zones.map((z) => ({ n: z.n, loges: z.loges }))
  if (m.starts) e.starts = m.starts
  if (m.id === 'mer') { e.banks = m.banks.map((b) => ({ cells: b.cells, wash_to: b.washTo, end: b.end })); delete e.bank; delete e.wash_to }
  if (m.id === 'camping') e.pack = m.ritons.slice(1).map((r) => ({ name: r.name, start: r.start, path: r.circuit }))
  if (m.id === 'ski') e.tp = Object.fromEntries(Object.entries(m.tp).map(([a, b]) => [String(a), b]))
  return e
}

if (DUMP) {
  for (const [key, m] of Object.entries(MAPS)) {
    const [id, size] = key.split(':')
    if (size === 's' || (args[1] && args[1] !== id) || (args[2] && args[2] !== size)) continue
    const S = size.toUpperCase()
    const count = (t) => m.cells.filter((x) => x === t).length
    console.log(`\n===== ${key} — ${m.cells.length} cases =====`)
    console.log(Object.keys(LETTER).filter((t) => count(t)).map((t) => `${LETTER[t]} ${t} ${count(t)}`).join(' · '))
    console.log(plan(m, 'type'))
    console.log('')
    console.log(plan(m, 'index'))
    console.log(`CELLS_${S} = ${JSON.stringify(m.cells).replace(/"/g, "'")}`)
    console.log(`NEXT_${S} = ${JSON.stringify(m.next)}`)
    console.log(`PREV_${S} = ${JSON.stringify(m.prev)}`)
    console.log(`XY_${S} = ${JSON.stringify(m.xy)}`)
    console.log(`JUMPS_${S} = ${JSON.stringify(m.jumps)}`)
    console.log(`EXTRA_${S} = ${JSON.stringify(extra(m))}`)
    console.log(`forks : ${m.forks.map((c, k) => `${c}→${JSON.stringify(m.next[c])} ${m.forkModes[k]}`).join(' · ')}`)
    for (const q of m.quarters) console.log(`  ${q.emoji} ${q.name} : ${q.first}-${q.last}${q.cells.length > q.last - q.first + 1 ? ' + banc ' + q.cells.filter((c) => c > q.last).join(',') : ''} (${q.cells.length} cases), entrée ${q.gate}, sortie ${JSON.stringify(m.next[q.last])}, Loges ${JSON.stringify(logesOf(m, q.cells))}`)
  }
  process.exit(0)
}

// ---------------------------------------------------------------------------- simulation (modèle JS simplifié des règles)
const C = { star_price: 30, half_price: 15, start_coins: 10, start_bonus: 5, clap: 3, pub: 3, gains: [10, 6, 4, 2], star_count: [1, 2, 2, 2, 2, 3, 3], toll: 3, pot_seed: 5, wash: 5, riton_steal: 5 }
const CARDS = ['plus8', 'minus5', 'fwd3', 'back3', 'swap_lead', 'steal3', 'charity', 'everyone3', 'star_moves', 'reroll', 'half_price', 'gift_double']
const OPT = { spread: true, zones: true }

function game(m, n, rounds, skilled = false) {
  const mech = BASE[m.id].extra.mech
  const loges = m.cells.map((t, i) => (t === 'loge' ? i : -1)).filter((i) => i >= 0)
  const P = seq(0, n - 1)
  const qOf = new Map()
  m.quarters.forEach((q, k) => q.cells.forEach((c) => qOf.set(c, k)))
  const zoneNo = (c) => (qOf.has(c) ? qOf.get(c) : -1)
  const order = shuffle(P)
  const s = {
    pos: P.map(() => 0), dist: P.map(() => 0), coins: P.map(() => C.start_coins), stars: P.map(() => 0), half: P.map(() => true), dbl: P.map(() => 1),
    star_cells: [], sw: m.forks.map(() => rnd(2)), order, deck: [],
    st: P.map(() => ({ pubs: 0, mg_wins: 0, laps: 0, halts: 0, broke: 0, bought: 0, visited: new Set(), rivals: new Set(), together: 0, steps: 0 })),
    ev: { washed: 0, rises: 0, toll: 0, jackpots: 0, jackpotSum: 0, jackpotMax: 0, steals: 0, drops: 0, stolen: 0, nones: 0, lifts: 0, ices: 0, maxSteps: 0, transports: 0, summit: 0 },
    qv: m.quarters.map(() => new Set()),
  }
  // Départs répartis (taille L) : les joueurs, par deux, sur des haltes tirées au sort.
  if (m.starts && OPT.spread) { const spots = shuffle(m.starts).slice(0, Math.ceil(n / 2)); order.forEach((p, k) => { s.pos[p] = spots[k % spots.length] }) }
  const seen = (p) => { const c = s.pos[p]; if (qOf.has(c)) { s.st[p].visited.add(qOf.get(c)); s.qv[qOf.get(c)].add(p) } }
  P.forEach(seen)
  if (mech === 'tide') { const ph = rnd(3); s.tide = ph === 2 ? 1 : 0; s.tide_in = ph === 0 ? 2 : 1 }
  const wet = () => (mech === 'tide' && s.tide === 1 ? m.banks.flatMap((b) => b.cells) : [])
  // Étoiles : par zone (grandes tailles) ou star_count (taille S).
  const base = C.star_count[n - 2]
  const zones = m.zones.length && OPT.zones ? m.zones.map((z) => ({ ...z, n: z.n || Math.max(2, base) })) : [{ n: m.zones.length ? m.zones.reduce((a, z) => a + (z.n || Math.max(2, base)), 0) : base, loges }]
  const zoneOf = (c) => zones.find((z) => z.loges.includes(c))
  for (const z of zones) s.star_cells.push(...shuffle(z.loges.filter((c) => !wet().includes(c))).slice(0, z.n))
  s.nStars = s.star_cells.length
  if (mech === 'tombola') s.pot = C.pot_seed
  if (mech === 'riton') s.ritons = m.ritons.map((r) => ({ ...r, cell: r.start, sack: 0, k: r.circuit ? r.circuit.indexOf(r.start) : 0 }))
  const coin = (p, d) => { const o = s.coins[p]; s.coins[p] = Math.max(0, o + d); if (s.coins[p] === 0 && o > 0) s.st[p].broke = 1; return s.coins[p] - o }
  const moveStar = (from) => { const z = zoneOf(from); const free = z.loges.filter((c) => !s.star_cells.includes(c) && !wet().includes(c)); if (free.length) s.star_cells[s.star_cells.indexOf(from)] = free[rnd(free.length)] }
  const tryStar = (p) => {
    const c = s.pos[p]
    if (!s.star_cells.includes(c)) return
    const price = s.half[p] ? C.half_price : C.star_price
    if (s.coins[p] >= price) { s.coins[p] -= price; s.stars[p]++; s.half[p] = false; s.st[p].bought++; moveStar(c) }
  }
  const riton = (p, r) => {
    if (r.sack > 0) { coin(p, r.sack); s.ev.drops++; r.sack = 0 } else if (s.coins[p] > 0) { r.sack = -coin(p, -C.riton_steal); s.ev.steals++; s.ev.stolen += r.sack } else s.ev.nones++
  }
  const walk = (p, k, dir) => {
    for (let i = 1; i <= k; i++) {
      const from = s.pos[p]
      if (dir < 0) s.pos[p] = m.prev[from]
      else {
        const nx = m.next[from]
        if (Array.isArray(nx)) {
          const f = m.forks.indexOf(from)
          let way
          if (m.forkModes[f] === 'tide') way = s.tide === 0 ? 1 : 0
          else { way = s.sw[f]; s.sw[f] = 1 - way }
          s.pos[p] = nx[way]
        } else s.pos[p] = nx
        if (m.jumps.some(([a, b]) => a === from && b === s.pos[p])) { s.ev.transports++; if (m.id === 'ski' && s.pos[p] === 0 && from !== 48) s.ev.summit++ }
      }
      s.dist[p] += dir
      s.st[p].steps++
      if (dir > 0 && s.pos[p] === 0) { coin(p, C.start_bonus); s.st[p].laps++ }
      if (dir > 0 && m.cells[s.pos[p]] === 'halt') { coin(p, C.start_bonus); s.st[p].halts++ }
      if (mech === 'tombola' && dir > 0 && m.cells[s.pos[p]] === 'tombola' && i < k) { s.pot += -coin(p, -C.toll); s.ev.toll++ }
      if (mech === 'riton') for (const r of s.ritons) if (s.pos[p] === r.cell) riton(p, r)
      tryStar(p)
      seen(p)
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
      s.dist[p] += t === 'lift' ? 12 : -12; s.pos[p] = m.tp[s.pos[p]]; s.ev[t === 'lift' ? 'lifts' : 'ices']++; extra = 1
      tryStar(p); seen(p)
    } else if (t === 'env') {
      if (!s.deck.length) s.deck = shuffle(CARDS)
      const card = s.deck.shift()
      if (card === 'plus8') coin(p, 8)
      else if (card === 'minus5') coin(p, -5)
      else if (card === 'fwd3') { walk(p, 3, 1); extra = 3 } else if (card === 'back3') { walk(p, 3, -1); extra = 3 } else if (card === 'reroll') { const d = die(); walk(p, d, 1); extra = d } else if (card === 'swap_lead') {
        const o = P.filter((x) => x !== p && s.dist[x] > s.dist[p]).sort((a, b) => s.dist[b] - s.dist[a] || idx(a) - idx(b))[0]
        if (o !== undefined) { [s.pos[p], s.pos[o]] = [s.pos[o], s.pos[p]]; [s.dist[p], s.dist[o]] = [s.dist[o], s.dist[p]]; seen(p); seen(o) }
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
      walk(p, k, 1)
      const extra = land(p)
      s.ev.maxSteps = Math.max(s.ev.maxSteps, k + extra)
    }
    if (mech === 'tide') {
      if (--s.tide_in === 0) {
        s.tide = 1 - s.tide; s.tide_in = s.tide === 0 ? 2 : 1
        if (s.tide === 1) {
          s.ev.rises++
          for (const p of s.order) for (const b of m.banks) if (b.cells.includes(s.pos[p])) { s.dist[p] += b.end - s.pos[p]; s.pos[p] = b.washTo; coin(p, -C.wash); s.ev.washed++; break }
          for (const c of s.star_cells.slice()) if (wet().includes(c)) moveStar(c)
        }
      }
    }
    if (mech === 'riton') {
      for (const r of s.ritons) for (let k = die(); k > 0; k--) {
        if (r.circuit) { r.k = (r.k + 1) % r.circuit.length; r.cell = r.circuit[r.k] } else r.cell = m.prev[r.cell]
        for (const p of s.order) if (s.pos[p] === r.cell) riton(p, r)
      }
    }
    // Voisinage en fin de tour : qui partage ma zone (la base, ou mon quartier) ?
    for (const p of P) { const mates = P.filter((o) => o !== p && zoneNo(s.pos[o]) === zoneNo(s.pos[p])); if (mates.length) s.st[p].together++; mates.forEach((o) => s.st[p].rivals.add(o)) }
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
function report(key, n, rounds, skilled = false, label = '') {
  const m = MAPS[key]
  let stars = 0, boughtSum = 0, none = 0, noBuy = 0, win = 0, laps = 0, halts = 0, broke = 0, coins = 0, pubs3 = 0, best = 0, worst = 0, max = 0, noQ = 0, qSum = 0, rivals = 0, together = 0, steps = 0, nStars = 0
  const ev = {}
  const qv = m.quarters.map(() => 0)
  for (let g = 0; g < SIMS; g++) {
    const { s, bought } = game(m, n, rounds, skilled)
    nStars = s.nStars
    for (let p = 0; p < n; p++) { stars += s.stars[p]; boughtSum += bought[p]; if (s.stars[p] === 0) none++; if (bought[p] === 0) noBuy++; laps += s.st[p].laps; halts += s.st[p].halts; broke += s.st[p].broke; coins += s.coins[p]; if (s.st[p].pubs >= 3) pubs3++; if (s.st[p].visited.size === 0) noQ++; qSum += s.st[p].visited.size; rivals += s.st[p].rivals.size; together += s.st[p].together; steps += s.st[p].steps }
    win += Math.max(...s.stars); best += s.stars[0]; worst += s.stars[n - 1]
    for (const k in s.ev) ev[k] = k === 'jackpotMax' || k === 'maxSteps' ? Math.max(ev[k] ?? 0, s.ev[k]) : (ev[k] ?? 0) + s.ev[k]
    s.qv.forEach((set, k) => { qv[k] += set.size })
    max = Math.max(max, s.ev.maxSteps)
  }
  const G = SIMS, PG = SIMS * n
  let l = `${(key + label).padEnd(13)} ${n} j. (${m.cells.length} cases, ${nStars} étoiles) · étoiles/joueur ${f(stars / PG)} (achetées ${f(boughtSum / PG)}) · vainqueur ${f(win / G)} · sans étoile ${pct(none, PG)} (aucun achat ${pct(noBuy, PG)}) · Départ ${f(laps / PG)} + haltes ${f(halts / PG)} · fauché ${pct(broke, PG)} · pubs>=3 ${pct(pubs3, PG)} · pièces fin ${f(coins / PG, 1)} · pas max ${max}`
  if (skilled) l += ` · meilleur ${f(best / G)} / pire ${f(worst / G)}`
  l += `\n              voisinage : accompagné ${pct(together, PG * rounds)} des tours, ${f(rivals / PG, 1)} rivaux différents par joueur`
  if (m.quarters.length) l += ` · quartiers : ${f(qSum / PG)} par joueur, aucun ${pct(noQ, PG)} · visiteurs : ${m.quarters.map((q, k) => `${q.emoji} ${f(qv[k] / G, 1)}`).join('  ')} · transports ${f(ev.transports / PG)} par joueur`
  const mech = BASE[m.id].extra.mech
  if (mech === 'tide') l += `\n              marée : ${f(ev.rises / G)} montées, ${f(ev.washed / G)} pions emportés par partie (${f(ev.washed / PG)} par joueur)`
  if (mech === 'tombola') l += `\n              tombola : ${f(ev.toll / PG)} péages par joueur, ${f(ev.jackpots / G)} gros lots par partie, moyen ${f(ev.jackpotSum / Math.max(1, ev.jackpots), 1)}, record ${ev.jackpotMax}`
  if (mech === 'riton') l += `\n              ratons : ${f(ev.steals / G)} vols, ${f(ev.drops / G)} sacs lâchés par partie (${f((ev.steals + ev.drops + ev.nones) / PG)} croisements par joueur)`
  if (mech === 'tp') l += `\n              ski : ${f(ev.lifts / PG)} télésièges et ${f(ev.ices / PG)} glissades par joueur · Grande Descente du Pic ${f((ev.summit ?? 0) / G)} par partie`
  console.log(l)
}

console.log(`\n=== 9 tours — ${SIMS} parties par ligne — référence = le plateau actuel (taille S) au même nombre de joueurs ===`)
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : Object.keys(SIZES)
for (const id of ONLY) {
  for (const n of [5, 6, 7, 8]) { report(`${id}:s`, n, 9, false, ' (réf.)'); report(`${id}:${sizeFor(id, n)}`, n, 9) }
  console.log('')
}
if (process.env.ONLY) process.exit(0)
console.log('=== variantes (ce que les leviers apportent), 8 joueurs en L, 6 en M ===')
OPT.spread = false; for (const key of ['mer:l', 'ski:l']) report(key, 8, 9, false, ' départ commun'); OPT.spread = true
OPT.zones = false; for (const key of ['mer:m', 'mer:l', 'ski:m', 'ski:l', 'camping:m']) report(key, key.endsWith(':l') ? 8 : 6, 9, false, ' étoiles libres'); OPT.zones = true
console.log('\n=== durées 6 et 12 tours, niveaux ===')
for (const key of ['grand:m', 'kermesse:m', 'camping:m', 'mer:m', 'ski:m', 'mer:l', 'ski:l']) {
  const n = key.endsWith(':l') ? 8 : 6
  const ref = key.split(':')[0] + ':s'
  report(ref, n, 6, false, ' 6 t. (réf.)'); report(key, n, 6, false, ' 6 t.')
  report(ref, n, 12, false, ' 12 t. (réf.)'); report(key, n, 12, false, ' 12 t.')
  report(ref, n, 9, true, ' niveaux (réf.)'); report(key, n, 9, true, ' niveaux')
}
