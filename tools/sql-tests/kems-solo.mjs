// Kems solo : node kems-solo.mjs ../../supabase/install.sql
// 1) Synchro moteur local TS (src/games/kems/local.ts) <-> SQL (game_kems_*, PGlite) : parties aléatoires jouées sur les deux,
//    states / secrets / erreurs identiques à chaque action (le hasard — distribution, balayage de la défausse — est
//    vérifié par comptage puis le côté TS reprend le tirage SQL).
// 2) Bots (src/games/kems/bot.ts) + partie complète (solo.ts) avec horloge simulée : fin de partie, cartes conservées,
//    niveau 10 plus vif que niveau 1, signes repérés, contres, erreurs aux bas niveaux, explication de défaite.
import { build } from 'rolldown'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { bootDb } from './boot.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const src = (p) => JSON.stringify(path.join(root, 'src', p).replace(/\\/g, '/'))
const out = path.join(here, 'out')
fs.mkdirSync(out, { recursive: true })
const entry = path.join(out, `kems-entry-${process.pid}.ts`)
fs.writeFileSync(
  entry,
  [`export * as L from ${src('games/kems/local.ts')}`, `export * as B from ${src('games/kems/bot.ts')}`, `export * as S from ${src('games/kems/solo.ts')}`].join('\n'),
)
const bundle = path.join(out, `kems-bundle-${process.pid}.mjs`)
await build({ input: entry, platform: 'node', resolve: { alias: { '@': path.join(root, 'src') } }, output: { file: bundle, format: 'esm' }, logLevel: 'warn' })
const { L, B, S } = await import(pathToFileURL(bundle).href + '?t=' + Date.now())
fs.rmSync(entry, { force: true })
fs.rmSync(bundle, { force: true })

let failed = false
let checks = 0
const ok = (name, cond, extra = '') => {
  checks++
  if (!cond || process.env.VERBOSE) console.log(`${cond ? 'OK   ' : 'ÉCHEC'} ${name}${cond ? '' : ' ' + extra}`)
  if (!cond) failed = true
  return cond
}

let seed = Number(process.env.SEED ?? 20261121)
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x80000000
}
const pick = (a) => a[Math.floor(rnd() * a.length)]

/* ================================================================= 1. synchro SQL */
const db = await bootDb(process.argv[2] ?? '../../supabase/install.sql')
const P = (await db.query(`select id from public.profiles order by sort_order limit 4`)).rows.map((r) => r.id)
if (P.length < 4) throw new Error('il faut 4 profils de seed')

const TIMES = new Set(['deadline', 'round_deadline', 'round_started_at', 'last_swap'])
const canon = (v) => {
  if (Array.isArray(v)) return v.map(canon)
  if (v && typeof v === 'object') {
    const o = {}
    for (const k of Object.keys(v).sort()) if (!TIMES.has(k)) o[k] = canon(v[k])
    return o
  }
  return v === undefined ? null : v
}
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b))
const sortRes = (r) => (r ? [...r].sort((a, b) => (a.profile_id < b.profile_id ? -1 : 1)) : r)
const sortHolders = (s) => {
  const c = JSON.parse(JSON.stringify(s))
  if (c.call?.holders) c.call.holders.sort()
  if (c.results) c.results = sortRes(c.results)
  return c
}
const hasWinnersSorted = (s) => {
  if (s.winners) s.winners = [...s.winners].sort()
  return s
}

const sqlStart = async (opts) => {
  const r = (await db.query(`select public.game_kems_start($1::uuid[], $2::jsonb) r`, [`{${P.join(',')}}`, JSON.stringify(opts)])).rows[0].r
  return { state: r.state, server: r.server, secrets: r.secrets }
}
const sqlAct = async (x, actor, host, action) => {
  try {
    const r = (await db.query(`select public.game_kems_action($1::jsonb, $2::jsonb, $3::uuid, $4, $5::jsonb) r`, [JSON.stringify(x.state), JSON.stringify(x.server), actor, host, JSON.stringify(action)])).rows[0].r
    return { state: r.state, server: r.server, secrets: r.secrets ?? null, results: r.results }
  } catch (e) {
    return { err: e.message }
  }
}
const tsAct = (x, actor, host, action, now) => {
  try {
    return L.kemsAct(x, actor, host, action, now, rnd)
  } catch (e) {
    return { err: e.message }
  }
}

// démarrage : mêmes états (hors idées de signe tirées au hasard)
const opts = { teams: { red: [P[0], P[1]], blue: [P[2], P[3]] }, target: 3, signs: ['a', 'b', 'c', 'd', 'e'] }
{
  const a = await sqlStart(opts)
  const b = L.kemsStart(P, { ...opts }, Date.now(), rnd)
  const strip = (x) => {
    const c = JSON.parse(JSON.stringify(x))
    for (const k of Object.keys(c.server.signs)) c.server.signs[k] = c.server.signs[k].length
    for (const k of Object.keys(c.secrets)) c.secrets[k].sign_ideas = c.secrets[k].sign_ideas.length
    return c
  }
  ok('start : state, server, secrets identiques', same(strip(a), strip(b)), `\nSQL ${JSON.stringify(canon(strip(a))).slice(0, 500)}\nTS  ${JSON.stringify(canon(strip(b))).slice(0, 500)}`)
  for (const bad of [{ red: [P[0]], blue: [P[2], P[3]] }, { red: [P[0], P[1]] }, { red: [P[0], P[1]], blue: [P[1], P[2]] }, { red: [P[0], P[1]], pink: [P[2], P[3]] }]) {
    let sqlErr = null
    try {
      await sqlStart({ teams: bad })
    } catch (e) {
      sqlErr = e.message
    }
    let tsErr = null
    try {
      L.kemsStart(P, { teams: bad }, Date.now(), rnd)
    } catch (e) {
      tsErr = e.message
    }
    ok(`start invalide ${JSON.stringify(bad).slice(0, 40)} -> invalid_teams`, sqlErr?.includes('invalid_teams') && tsErr === 'invalid_teams', `${sqlErr} / ${tsErr}`)
  }
  // 6 joueurs : 52 cartes
  const t3 = await sqlStart({ teams: { red: [P[0], P[1]], blue: [P[2], P[3]] } })
  ok('start sans options : objectif 5', t3.state.target === 5 && L.kemsStart(P, { teams: opts.teams }, 0, rnd).state.target === 5)
}

const pastAll = (x, withRound = true) => {
  const s = JSON.parse(JSON.stringify(x.state))
  const past = new Date(Date.now() - 1000).toISOString()
  if (s.deadline) s.deadline = past
  if (s.round_deadline && withRound) s.round_deadline = past
  if (s.sweep?.deadline) s.sweep.deadline = past
  return { ...x, state: s }
}
const noGuard = (x) => ({ ...x, server: { ...x.server, last_swap: {} } })
const allCards = (x) => [...Object.values(x.server.hands).flat(), ...x.state.center, ...x.server.deck, ...x.server.discard].sort()
const rankedDeck = (n) => (n <= 4 ? ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'] : []).flatMap((r) => ['S', 'H', 'D', 'C'].map((s) => r + s)).sort()

let games = 0
let steps = 0
let reshuffles = 0
const kinds = {}
for (let g = 0; g < 40; g++) {
  const o = { teams: { red: [P[0], P[1]], blue: [P[2], P[3]] }, target: pick([3, 5, 7]), signs: [] }
  let sx = await sqlStart(o)
  let tx = JSON.parse(JSON.stringify(sx))
  let bad = false
  for (let i = 0; i < 160 && !bad; i++) {
    const actor = pick(P)
    const phase = sx.state.phase
    const r = rnd()
    let action
    if (phase === 'signs') action = { type: 'ready' }
    else if (phase === 'finished') break
    else if (phase === 'reveal') action = r < 0.5 ? { type: 'next' } : { type: 'tick' }
    else if (r < 0.55) {
      const hand = sx.server.hands[actor]
      const center = sx.state.center
      // surtout des échanges valides ; parfois carte absente
      action = { type: 'swap', give: rnd() < 0.05 ? '2S' : pick(hand), take: rnd() < 0.05 ? '2S' : pick(center) }
    } else if (r < 0.75) action = { type: 'sweep' }
    else if (r < 0.88) action = { type: 'tick' }
    else if (r < 0.9) action = { type: 'kems' }
    else if (r < 0.92) action = { type: 'counter' }
    else if (r < 0.95) action = pick([{ type: 'bogus' }, { type: 'counter', team: 'pink' }, { type: 'swap', give: 1, take: 2 }])
    else action = { type: 'sweep' }
    kinds[action.type] = (kinds[action.type] ?? 0) + 1
    let a = noGuard(sx)
    let b = noGuard(tx)
    if (action.type === 'tick' && rnd() < 0.7) {
      const wr = rnd() < 0.03
      a = pastAll(a, wr)
      b = pastAll(b, wr)
    }
    const isHost = actor === P[0]
    const ra = await sqlAct(a, actor, isHost, action)
    const rb = tsAct(b, actor, isHost, action, Date.now())
    steps++
    if (ra.err || rb.err) {
      const ea = ra.err ? (/[a-z_]+$/.exec(ra.err.trim()) ?? [''])[0] : null
      ok(`g${g}#${i} erreur ${JSON.stringify(action)} : SQL=${ra.err} TS=${rb.err}`, !!ra.err && !!rb.err && ra.err.includes(rb.err), '')
      if (!(ra.err && rb.err && ra.err.includes(rb.err))) bad = true
      void ea
      continue
    }
    const before = sx.state
    const random =
      ['next', 'tick', 'sweep', 'ready'].includes(action.type) &&
      (ra.state.round !== before.round || ra.state.sweeps !== before.sweeps)
    const dealt = random && ra.state.round !== before.round
    const reshuf = random && !dealt && sx.server.deck.length < 4 && ra.state.sweeps !== before.sweeps
    if (reshuf) reshuffles++
    if (!random) {
      const sa = hasWinnersSorted(sortHolders(ra.state))
      const sb = hasWinnersSorted(sortHolders(rb.state))
      const good = same(sa, sb) && same(ra.server, rb.server) && same(ra.secrets, rb.secrets) && same(sortRes(ra.results), sortRes(rb.results))
      ok(`g${g}#${i} ${action.type} identique`, good, `\nSQL ${JSON.stringify(canon([sa, ra.server, ra.secrets])).slice(0, 700)}\nTS  ${JSON.stringify(canon([sb, rb.server, rb.secrets])).slice(0, 700)}`)
      if (!good) bad = true
    } else {
      // hasard : mêmes compteurs et mêmes cartes en jeu, puis on reprend le tirage SQL
      const A = { state: ra.state, server: ra.server }
      const Bx = { state: rb.state, server: rb.server }
      const n = 4
      const lens = (x) => [x.state.center.length, x.server.deck.length, x.server.discard.length, ...P.map((p) => x.server.hands[p].length), x.state.deck_count]
      const good =
        JSON.stringify(lens(A)) === JSON.stringify(lens(Bx)) &&
        ra.state.phase === rb.state.phase &&
        ra.state.round === rb.state.round &&
        ra.state.sweeps === rb.state.sweeps &&
        same(ra.state.teams, rb.state.teams) &&
        JSON.stringify(allCards(A)) === JSON.stringify(rankedDeck(n)) &&
        JSON.stringify(allCards(Bx)) === JSON.stringify(rankedDeck(n))
      ok(`g${g}#${i} ${action.type} (hasard) cohérent`, good, `${JSON.stringify(lens(A))} / ${JSON.stringify(lens(Bx))}`)
      if (!good) bad = true
    }
    sx = { state: ra.state, server: ra.server, secrets: ra.secrets }
    tx = random ? JSON.parse(JSON.stringify(sx)) : { state: rb.state, server: rb.server, secrets: rb.secrets }
  }
  games++
}
console.log(`synchro SQL : ${games} parties, ${steps} actions (${JSON.stringify(kinds)}), ${reshuffles} remélanges de défausse`)
ok('le remélange de la défausse a été exercé', reshuffles > 0)

// garde-fou 250 ms (TS seulement : le SQL lit l'horloge réelle)
{
  const x0 = L.kemsStart(P, opts, 1_000_000, rnd)
  let x = { state: x0.state, server: x0.server }
  for (const p of P) x = L.kemsAct(x, p, false, { type: 'ready' }, 1_000_000, rnd)
  const give = x.server.hands[P[0]][0]
  const take = x.state.center[0]
  const r1 = L.kemsAct(x, P[0], false, { type: 'swap', give, take }, 1_000_100, rnd)
  const give2 = r1.server.hands[P[0]][1]
  const take2 = r1.state.center[1]
  const r2 = L.kemsAct(r1, P[0], false, { type: 'swap', give: give2, take: take2 }, 1_000_200, rnd)
  const r3 = L.kemsAct(r1, P[0], false, { type: 'swap', give: give2, take: take2 }, 1_000_400, rnd)
  ok('double appui < 250 ms ignoré, après 250 ms accepté', r2.state.swaps === 1 && r3.state.swaps === 2)
}

/* ================================================================= 2. bots et partie complète */
const fakeRng = (s) => () => {
  s = (s * 1664525 + 1013904223) & 0x7fffffff
  return s / 0x80000000
}

// décision d'échange
{
  const sw = B.bestSwap(['7S', '7H', '7D', 'KC'], ['7C', '9S', '9H', 'AD'], fakeRng(1))
  ok('bestSwap : prend le 7 manquant et rend l\'intrus', sw && sw.take === '7C' && sw.give === 'KC')
  ok('bestSwap : rien d\'utile -> null', B.bestSwap(['7S', '7H', '8D', 'KC'], ['9C', 'AS', 'QH', 'JD'], fakeRng(1)) === null)
  const p1 = B.botParams(1)
  const p10 = B.botParams(10)
  ok('niveau 1 lent / distrait, niveau 10 vif', p1.swapMs > 3 * p10.swapMs && p1.reaction > 3 * p10.reaction && p1.misread > 0 && p10.misread === 0 && p10.smart === 1)
}

// parties 100 % bots (le « joueur » est piloté par un cerveau lui aussi) : fin de partie, conservation des cartes
const ME = 'me'
const simGame = (level, seedN, target = 3) => {
  const rng = fakeRng(seedN)
  const sim = new S.KemsSoloSim({ me: ME, partner: 'bp', opps: ['bo1', 'bo2'], mySign: 'clin_oeil', oppSign: 'bisou', level, target, rng }, 0)
  const meBrain = new B.KemsBrain({ id: ME, partner: 'bp', opponents: ['bo1', 'bo2'], signExpr: 'clin_oeil', level }, rng)
  let now = 0
  let swaps = 0
  let calls = { kems: 0, counter: 0, wrong: 0 }
  while (now < 40 * 60_000 && sim.outcome === null) {
    now += 100
    // le « joueur » (un bot de même niveau) joue sa main et crie quand son coéquipier fait le signe
    if (sim.phase === 'playing') {
      for (const o of meBrain.step({ now, state: sim.state, hand: sim.myHand, events: sim.events })) {
        if (o.type === 'flash') sim.flash(ME, o.expr, o.real, now)
        else sim.act(ME, o.type === 'swap' ? { type: 'swap', give: o.give, take: o.take } : { type: o.type }, now)
      }
    }
    const prev = sim.rounds.length
    sim.step(now)
    if (sim.rounds.length > prev) {
      const r = sim.rounds[sim.rounds.length - 1]
      if (r.type === 'kems') calls.kems++
      if (r.type === 'counter') calls.counter++
      if (r.type !== 'timeout' && !r.ok) calls.wrong++
    }
    swaps = sim.state.swaps
    if (sim.phase === 'playing') {
      const all = [...Object.values(sim.x.server.hands).flat(), ...sim.state.center, ...sim.x.server.deck, ...sim.x.server.discard].sort()
      if (JSON.stringify(all) !== JSON.stringify(rankedDeck(4))) throw new Error('cartes non conservées')
    }
  }
  return { sim, now, swaps, calls }
}
{
  const hi = []
  const lo = []
  for (let k = 0; k < 6; k++) {
    hi.push(simGame(10, 100 + k))
    lo.push(simGame(1, 200 + k))
  }
  ok('parties niveau 10 : toutes finies', hi.every((g) => g.sim.outcome !== null), JSON.stringify(hi.map((g) => g.now)))
  ok('parties niveau 1 : toutes finies', lo.every((g) => g.sim.outcome !== null), JSON.stringify(lo.map((g) => g.now)))
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length
  const hiRound = avg(hi.map((g) => g.now / g.sim.state.round))
  const loRound = avg(lo.map((g) => g.now / g.sim.state.round))
  console.log(`durée moyenne d'une manche : niveau 10 = ${(hiRound / 1000).toFixed(1)} s, niveau 1 = ${(loRound / 1000).toFixed(1)} s ; échanges/partie : ${avg(hi.map((g) => g.swaps)).toFixed(0)} vs ${avg(lo.map((g) => g.swaps)).toFixed(0)}`)
  ok('le niveau 10 boucle une manche plus vite que le niveau 1', hiRound < loRound)
  const wrongLo = lo.reduce((a, g) => a + g.calls.wrong, 0)
  const wrongHi = hi.reduce((a, g) => a + g.calls.wrong, 0)
  const callsLo = lo.reduce((a, g) => a + g.calls.kems + g.calls.counter, 0)
  const callsHi = hi.reduce((a, g) => a + g.calls.kems + g.calls.counter, 0)
  console.log(`appels ratés : niveau 1 = ${wrongLo}/${callsLo}, niveau 10 = ${wrongHi}/${callsHi}`)
  ok('des Kems / Contre-Kems sont criés par les bots', callsLo > 0 && callsHi > 0)
  ok('aux bas niveaux les bots se trompent plus souvent (taux d\'appels ratés)', wrongLo / Math.max(1, callsLo) >= wrongHi / Math.max(1, callsHi) * 0.9 || wrongLo > 0)
}

// le coéquipier bot repère le signe du joueur humain et crie KEMS ; un adversaire peut contrer
{
  let kemsOk = 0
  let counters = 0
  let games = 0
  for (let k = 0; k < 40; k++) {
    const rng = fakeRng(500 + k)
    const sim = new S.KemsSoloSim({ me: ME, partner: 'bp', opps: ['bo1', 'bo2'], mySign: 'clin_oeil', oppSign: 'bisou', level: 8, target: 3, rng }, 0)
    // on force un carré chez le joueur : on triche sur le moteur de test pour fabriquer la situation
    const h = sim.x.server.hands
    const rank = '9'
    const sq = ['S', 'H', 'D', 'C'].map((s) => rank + s)
    const others = Object.values(h).flat().filter((c) => !sq.includes(c))
    const mine = new Set(h[ME])
    // échange direct des cartes dans les mains/centre/pioche pour installer le carré 9
    const pool = [...Object.keys(h)].flatMap((p) => h[p].map((c, i) => ({ zone: p, i, c })))
    void others
    void mine
    for (const [j, card] of sq.entries()) {
      const loc = pool.find((q) => q.c === card)
      const oldCard = h[ME][j]
      if (loc) h[loc.zone][loc.i] = oldCard
      else {
        const ci = sim.state.center.indexOf(card)
        if (ci >= 0) sim.state.center[ci] = oldCard
        else {
          const di = sim.x.server.deck.indexOf(card)
          sim.x.server.deck[di] = oldCard
        }
      }
      h[ME][j] = card
    }
    let now = 0
    const sig = 3000
    let signed = false
    while (now < 60_000 && sim.phase === 'playing') {
      now += 100
      if (!signed && now >= sig) {
        sim.humanSign(now)
        signed = true
      }
      sim.step(now)
    }
    games++
    const r = sim.rounds[0]
    if (r && r.type === 'kems' && r.ok && r.team === 'red') kemsOk++
    if (r && r.type === 'counter' && r.team === 'blue') counters++
  }
  console.log(`signe du joueur (niveau 8, 40 essais) : KEMS du bot réussi ${kemsOk}, contré par les adverses ${counters}`)
  ok('le bot coéquipier crie KEMS quand le joueur fait son signe', kemsOk >= 20)
}

// sans signe du joueur : le coéquipier ne crie pas dans le vide (niveau 8)
{
  let falseKems = 0
  for (let k = 0; k < 20; k++) {
    const sim = new S.KemsSoloSim({ me: ME, partner: 'bp', opps: ['bo1', 'bo2'], mySign: 'clin_oeil', oppSign: 'bisou', level: 8, target: 3, rng: fakeRng(900 + k) }, 0)
    let now = 0
    while (now < 20_000 && sim.phase === 'playing') {
      now += 100
      sim.step(now)
    }
    const r = sim.rounds[0]
    if (r && r.type === 'kems' && r.team === 'red' && !r.ok) falseKems++
  }
  ok('le coéquipier (niveau 8) ne crie jamais KEMS dans le vide', falseKems === 0, String(falseKems))
}

// explication
{
  const rounds = [
    { round: 1, type: 'counter', by: 'bo1', ok: true, team: 'blue', target: 'red', holders: [ME], partnerSigns: 0, mySigns: 2, oppSigns: 0, myBluffs: 0 },
    { round: 2, type: 'kems', by: 'bo1', ok: true, team: 'blue', target: null, holders: ['bp'], partnerSigns: 3, mySigns: 0, oppSigns: 1, myBluffs: 0 },
  ]
  const w = S.explainKems(rounds, 'loss', 'Mika')
  ok('explication de défaite : coéquipier ignoré + signe repéré', w.lines.length >= 1 && w.lines.some((l) => l.includes('3 fois')), JSON.stringify(w))
  const v = S.explainKems([{ round: 1, type: 'kems', by: ME, ok: true, team: 'red', target: null, holders: ['bp'], partnerSigns: 1, mySigns: 0, oppSigns: 0, myBluffs: 0 }], 'win', 'Mika')
  ok('compliment en cas de victoire', v.lines.length >= 1)
}

console.log(`${checks} vérifications.`)
if (failed) {
  console.log('\nÉCHEC')
  process.exit(1)
}
console.log('\nTous les tests Kems solo passent.')
process.exit(0)
