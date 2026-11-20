// Socle 2b : mémoire générique (oubli, purge, plafonds, 90 jours, taille, stockage illisible, Oublier,
// 4 profils), learnRate, niveau par profil (migration), et « sans hints = étape 1 » pour les 4 bots.
import { loadOldBots } from '../solo-bundle.mjs'
import { ME, BOT, fakeStorage, mkRng } from './util.mjs'

export default async function (S, { ok }) {
  const M = S.memory
  ok('learnRate : niveaux 1-2 -> 0', M.learnRate(1, 0) === 0 && M.learnRate(2, 0) === 0)
  ok('learnRate : niveau 5 -> 0,6 ; niveau 10 -> 1', M.learnRate(5, 0) === 0.6 && M.learnRate(10, 0) === 1)
  ok('learnRate : frein après 3 défaites d’affilée -> 0', M.learnRate(8, 3) === 0 && M.learnRate(8, 2) === 1)
  ok('howOften : toujours ≥ 85 %, souvent ≥ 60 %', M.howOften(0.9) === 'toujours' && M.howOften(0.7) === 'souvent' && M.howOften(0.5) === null)

  // Apprenant jouet : table libre `t` plafonnée à 3, tableau fixe `a`.
  const toy = {
    empty: () => ({ ...M.memBase(), a: [0, 0], t: {} }),
    observe: (m, log) => {
      m.a[0] += 1
      for (const k of log.keys ?? []) m.t[k] = (m.t[k] ?? 0) + 1
      return m
    },
    caps: { t: 3 },
    insights: () => [],
    hintsFor: () => undefined,
  }
  const lg = (id, outcome = 'loss', keys = []) => ({ id, outcome, keys })
  let m = toy.empty()
  m = M.learn(toy, m, lg('g1'), 1000)
  ok('learn : n = 1 après une partie, compteur à 1', m.n === 1 && m.a[0] === 1)
  m = M.learn(toy, m, lg('g2'), 2000)
  ok('learn : oubli × 0,9 (n = 1,9 ; compteur 1,9)', m.n === 1.9 && m.a[0] === 1.9, JSON.stringify(m))
  ok('learn : même partie apprise une seule fois', M.learn(toy, m, lg('g2'), 3000) === m)
  ok('learn : partie quittée (pas de résultat) -> rien', M.learn(toy, m, { id: 'g9', outcome: null }, 3000) === m)
  ok('learn : défaites d’affilée comptées, remises à 0 par une victoire', m.streak === 2 && M.learn(toy, m, lg('g3', 'win'), 3000).streak === 0)
  m = M.learn(toy, m, lg('g4', 'loss', ['k1', 'k2', 'k3', 'k4', 'k5']), 4000)
  ok('learn : table plafonnée (3 entrées max)', Object.keys(m.t).length === 3)
  let mm = toy.empty()
  mm = M.learn(toy, mm, lg('h1', 'loss', ['old']), 1)
  for (let i = 0; i < 25; i++) mm = M.learn(toy, mm, lg(`h${i + 2}`), 10 + i)
  ok('learn : entrées < 0,1 purgées (0,9^25 ≈ 0,07)', !('old' in mm.t), JSON.stringify(mm.t))
  const old = { ...toy.empty(), n: 5, at: 1, a: [9, 9], t: { x: 4 } }
  const fresh = M.learn(toy, old, lg('z1'), 1 + 91 * 24 * 3600 * 1000)
  ok('learn : plus de 90 jours sans jouer -> remise à zéro', fresh.n === 1 && fresh.a[0] === 1 && !('x' in fresh.t))
  const big = { ...toy.empty(), t: Object.fromEntries(Array.from({ length: 3000 }, (_, i) => [`key-${i}-${'x'.repeat(40)}`, i + 1])) }
  const small = M.shrinkMem(big, toy.caps)
  ok('taille : garde-fou 100 000 caractères', JSON.stringify(small).length <= 100000 && Object.keys(small.t).length > 100)

  // Stockage
  const st = fakeStorage()
  M.writeMem('jeu', 'p1', { ...toy.empty(), n: 3 })
  ok('stockage : écrit sous solo:mem:<jeu>:<profil>', st.getItem('solo:mem:jeu:p1') !== null)
  ok('stockage : relu', M.readMem(toy, 'jeu', 'p1').n === 3)
  st.setItem('solo:mem:jeu:p2', '{pas du json')
  ok('stockage : illisible -> mémoire vide, sans erreur', M.readMem(toy, 'jeu', 'p2').n === 0)
  st.setItem('solo:mem:jeu:p3', JSON.stringify({ v: 2, n: 4 }))
  ok('stockage : version inconnue -> mémoire vide', M.readMem(toy, 'jeu', 'p3').n === 0)
  st.setItem('solo:mem:jeu:p4', JSON.stringify({ v: 1, n: 4, a: 'oops' }))
  ok('stockage : champ de mauvaise forme -> mémoire vide', M.readMem(toy, 'jeu', 'p4').n === 0)
  M.forgetMem('jeu', 'p1')
  ok('stockage : « Oublier » efface', st.getItem('solo:mem:jeu:p1') === null && M.readMem(toy, 'jeu', 'p1').n === 0)
  st.clear()
  for (let i = 1; i <= 5; i++) M.writeMem('jeu', `pp${i}`, toy.empty(), 1000 + i)
  ok(
    'stockage : 4 profils au plus (le plus ancien est oublié)',
    st.getItem('solo:mem:jeu:pp1') === null && st.getItem('solo:mem:jeu:pp5') !== null && st.getItem('solo:mem:jeu:pp2') !== null,
  )
  const blocked = () => {
    throw new Error('bloqué')
  }
  globalThis.localStorage = { getItem: blocked, setItem: blocked, removeItem: blocked, key: () => null, length: 0 }
  M.writeMem('jeu', 'q1', { ...toy.empty(), n: 7 })
  ok('stockage bloqué : la mémoire vit le temps de la session', M.readMem(toy, 'jeu', 'q1').n === 7)
  ok('stockage bloqué : niveau par défaut sans erreur', S.level.readLevel('morpion', 'q1') === 3)

  // Niveau par profil, migration de l'étape 1
  const st2 = fakeStorage()
  st2.setItem('solo:level:morpion', '6')
  ok(
    'niveau : ancienne clé reprise une fois pour le profil',
    S.level.readLevel('morpion', 'p1') === 6 && st2.getItem('solo:level:morpion') === null && st2.getItem('solo:level:morpion:p1') === '6',
  )
  ok('niveau : un autre profil repart à 3', S.level.readLevel('morpion', 'p2') === 3)
  S.level.writeLevel('morpion', 8, 'p2')
  ok('niveau : par profil', S.level.readLevel('morpion', 'p2') === 8 && S.level.readLevel('morpion', 'p1') === 6)

  // Sans hints : exactement l'étape 1 (mêmes graines). Échecs / 4 à la suite : budget « infini »,
  // profondeur du niveau (plafonnée pour la durée du test) -> déterministe.
  const O = await loadOldBots()
  const games = [
    { name: 'Morpion', L: S.morpion, nb: S.morpionBot, ob: O.morpionBot, legal: (b) => S.morpion.legalMoves(b).map((cell) => ({ cell })), opts: { variant: 'classic' }, n: 120 },
    { name: '4 à la suite', L: S.q4, nb: S.q4Bot, ob: O.q4Bot, legal: (b) => S.q4.legalMoves(b).map((col) => ({ col })), opts: {}, n: 12, budget: 1e9, cap: 6 },
    { name: 'Bataille navale', L: S.bn, nb: S.bnBot, ob: O.bnBot, legal: (b, turn) => S.bn.legalMoves(b, turn), opts: {}, n: 12, setup: true },
    { name: 'Échecs', L: S.echecs, nb: S.echecsBot, ob: O.echecsBot, legal: (b) => S.echecs.legalMoves(b), opts: { cadence: 'none' }, n: 4, budget: 1e9, cap: 5, maxPly: 30 },
  ]
  for (const g of games) {
    let same = 0
    let total = 0
    const r0 = mkRng(11)
    for (let k = 0; k < g.n; k++) {
      let x = S.soloStart(g.L.local, { a: ME, b: BOT, first: k % 2 ? ME : BOT, options: g.opts })
      if (g.setup) {
        x = S.soloAct(g.L.local, x, BOT, { type: 'ready' })
        x = S.soloAct(g.L.local, x, ME, { type: 'ready' })
      }
      const level = Math.min(1 + (k % 10), g.cap ?? 10)
      for (let ply = 0; x.state.phase === 'playing' && ply < (g.maxPly ?? 200); ply++) {
        const turn = x.state.duel.turn
        const b = x.state.board
        let move
        if (turn === BOT) {
          const seed = Math.floor(r0() * 1e9)
          const run = (f) => (g.budget ? f(b, BOT, level, mkRng(seed), g.budget) : f(b, BOT, level, mkRng(seed)))
          const a = run(g.ob.chooseMove)
          const n1 = run(g.nb.chooseMove)
          const n2 = run(g.nb.decide).move
          total++
          if (JSON.stringify(a) === JSON.stringify(n1) && JSON.stringify(a) === JSON.stringify(n2)) same++
          move = a
        } else {
          const ms = g.legal(b, turn)
          move = ms[Math.floor(r0() * ms.length)]
        }
        x = S.soloAct(g.L.local, x, turn, { type: 'move', move })
      }
    }
    ok(`${g.name} : sans hints, mêmes coups qu’à l’étape 1 (${same}/${total})`, same === total && total > 0)
  }
}
