// Morpion (2a) : moments clés exacts (minimax) et compliments.
import { ME, BOT, autoLog, marked, mkRng, momentOf, playLog } from './util.mjs'

export default async function (S, { ok }) {
  const L = S.morpion
  const W = S.morpionWhy
  const game = 'morpion'
  const opts = { variant: 'classic' }
  const mv = (seq) => seq.map(([by, cell]) => [by, { cell }])
  const play = (first, seq) => playLog(S, L, { game, first, options: opts, moves: mv(seq) }).log

  // 1. Victoire manquée : je pouvais finir en 2 (0-1-2) à mon 3e coup, j'ai joué 8 ; le bot gagne en 5.
  let log = play('me', [['me', 0], ['bot', 3], ['me', 1], ['bot', 4], ['me', 8], ['bot', 5]])
  ok('Morpion : partie 1 perdue', log.outcome === 'loss')
  let ms = W.findMoments(log, 'me')
  let top = S.pick.pickMoment(ms)
  ok('Morpion victoire_manquee : bon type', top?.type === 'victoire_manquee', JSON.stringify(ms.map((m) => m.type)))
  ok('Morpion victoire_manquee : bonne case (2) et coup joué (8)', marked(top, 'better').includes(2) && marked(top, 'played').includes(8), JSON.stringify(top?.steps))
  ok('Morpion victoire_manquee : « 3e coup », « le coin en haut à droite »', top?.vars.coup === '3e coup' && top?.vars.case === 'le coin en haut à droite', JSON.stringify(top?.vars))
  let tx = W.texts(top, 'me')
  ok('Morpion victoire_manquee : phrase + conseil', tx.lines[0].includes('le coin en haut à droite') && tx.tip?.includes('aligner trois'), JSON.stringify(tx))

  // 2. Blocage oublié : le bot menace 6 (2-4-6), je joue 7.
  log = play('me', [['me', 0], ['bot', 4], ['me', 8], ['bot', 2], ['me', 7], ['bot', 6]])
  ms = W.findMoments(log, 'me')
  top = S.pick.pickMoment(ms)
  ok('Morpion blocage_oublie : bon type', top?.type === 'blocage_oublie', JSON.stringify(ms.map((m) => m.type)))
  ok('Morpion blocage_oublie : case à bloquer 6, jouée 7, ligne du bot (2, 4) en jaune', marked(top, 'better').includes(6) && marked(top, 'played').includes(7) && [2, 4].every((c) => marked(top, 'threat').includes(c)), JSON.stringify(top?.steps))
  tx = W.texts(top, 'me')
  ok('Morpion blocage_oublie : phrase avec le coin en bas à gauche', tx.lines.join(' ').includes('le coin en bas à gauche') && /bloquer/.test(tx.lines[0]), JSON.stringify(tx))

  // 3. Fourchette : le bot ouvre au coin, je joue un bord (1), il fait deux menaces plus tard.
  log = play('bot', [['bot', 0], ['me', 1], ['bot', 4], ['me', 8], ['bot', 6], ['me', 3], ['bot', 2]])
  ok('Morpion : partie 3 perdue', log.outcome === 'loss')
  ms = W.findMoments(log, 'me')
  top = S.pick.pickMoment(ms)
  ok('Morpion fourchette : bon type', top?.type === 'fourchette', JSON.stringify(ms.map((m) => m.type)))
  ok('Morpion fourchette : le bon coup était le centre, mon coup le bord du haut', marked(top, 'better').includes(4) && marked(top, 'played').includes(1), JSON.stringify(top?.steps))
  ok('Morpion fourchette : les 2 menaces du bot (2 et 3) en jaune', [2, 3].every((c) => marked(top, 'threat').includes(c)), JSON.stringify(top?.steps))
  ok('Morpion fourchette : coup = « 1er coup »', top?.vars.coup === '1er coup', JSON.stringify(top?.vars))

  // 4. Compliments : le bot oublie de bloquer ; le joueur fait deux menaces.
  log = play('me', [['me', 0], ['bot', 1], ['me', 4], ['bot', 2], ['me', 8]])
  ok('Morpion : partie 4 gagnée', log.outcome === 'win')
  top = S.pick.pickMoment(W.findMoments(log, 'bot'))
  ok('Morpion compliment : le bot a oublié de bloquer', top?.type === 'blocage_oublie' && W.texts(top, 'bot').lines[0].startsWith('J’ai oublié de te bloquer'), JSON.stringify(top))
  ok('Morpion compliment : pas de conseil', !W.texts(top, 'bot').tip)
  log = play('me', [['me', 0], ['bot', 1], ['me', 4], ['bot', 8], ['me', 6], ['bot', 2], ['me', 3]])
  ok('Morpion : partie 5 gagnée', log.outcome === 'win')
  top = S.pick.pickMoment(W.findMoments(log, 'bot'))
  ok('Morpion compliment : deux menaces d’un coup', top?.type === 'fourchette' && W.texts(top, 'bot').lines[0].includes('deux menaces'), JSON.stringify(top))
  ok('Morpion compliment : mon coup qui fait deux menaces (6) en vert', marked(top, 'better').includes(6), JSON.stringify(top?.steps))

  // 5. Nul avec victoire manquée (à mon 3e coup, 7 gagnait).
  log = play('me', [['me', 0], ['bot', 4], ['me', 8], ['bot', 2], ['me', 6], ['bot', 3], ['me', 5], ['bot', 7], ['me', 1]])
  ok('Morpion : partie 6 nulle', log.outcome === 'draw')
  const ex = S.voice.explain({ slug: 'mika', why: W, outcome: 'draw', moments: W.findMoments(log, 'me'), seed: log.id })
  ok('Morpion nul : « Égalité… mais à ton 4e coup, tu pouvais gagner ! » + case 7', ex.card === 'Égalité… mais à ton 4e coup, tu pouvais gagner !' && marked(ex.moment, 'better').includes(7), JSON.stringify(ex))

  // 6. Coup appris : le coup décisif du bot portait `learned`.
  log = playLog(S, L, { game, first: 'me', options: opts, moves: [['me', { cell: 0 }], ['bot', { cell: 3 }], ['me', { cell: 1 }], ['bot', { cell: 4 }], ['me', { cell: 8 }], ['bot', { cell: 5 }, 'm3']] }).log
  ok('Morpion : moment marqué « appris » si le coup décisif l’était', !!S.pick.pickMoment(W.findMoments(log, 'me'))?.learned)

  // 7. 200 parties bot contre hasard : jamais d'erreur, toujours un moment, « le bon coup » légal et parmi les meilleurs au minimax.
  const rnd = mkRng(5)
  let crash = 0
  let none = 0
  let badBetter = 0
  let longCard = 0
  let maxMs = 0
  for (let g = 0; g < 200; g++) {
    const level = 1 + (g % 10)
    const { log: lg } = autoLog(S, L, {
      game,
      first: g % 2 ? 'me' : 'bot',
      level,
      options: opts,
      pickMe: (b) => {
        const legal = L.legalMoves(b)
        return { cell: legal[Math.floor(rnd() * legal.length)] }
      },
      pickBot: (b) => S.morpionBot.decide(b, BOT, level, rnd),
    })
    for (const loser of lg.outcome === 'draw' ? ['me'] : [lg.outcome === 'loss' ? 'me' : 'bot']) {
      try {
        const t0 = performance.now()
        const moments = W.findMoments(lg, loser)
        maxMs = Math.max(maxMs, performance.now() - t0)
        if (lg.outcome !== 'draw' && !moments.length) none++
        for (const m of moments) {
          const tx2 = W.texts(m, loser)
          if (tx2.lines[0].length > 110) longCard++
          for (const st of m.steps) {
            const better = st.marks.filter((k) => k.kind === 'better').flatMap((k) => k.cells)
            if (!better.length) continue
            const x = S.log.replayTo(L.local, lg, st.ply)
            const b = x.state.board
            const legal = L.legalMoves(b)
            const mover = b.count % 2 === 0 ? b.x : b.o
            const sym = mover === b.x ? 'x' : 'o'
            const scores = S.morpionBot.scoreMoves(b, sym)
            for (const c of better) {
              if (!legal.includes(c)) badBetter++
              const sc = scores.find((s) => s.cell === c)
              const topS = Math.max(...scores.map((q) => q.score))
              if (sc && sc.score < topS && x.state.phase === 'playing') {
                badBetter++
                if (badBetter < 4) console.log('  mauvais bon coup', m.type, loser, c, JSON.stringify(scores), b.cells.join())
              }
            }
          }
        }
      } catch (e) {
        crash++
        if (crash < 3) console.log(e)
      }
    }
  }
  ok('Morpion 200 parties : jamais d’erreur', crash === 0, `${crash}`)
  ok('Morpion 200 parties : toujours un moment', none === 0, `${none}`)
  ok('Morpion 200 parties : « le bon coup » légal et non perdant', badBetter === 0, `${badBetter}`)
  ok('Morpion 200 parties : 1re phrase ≤ 110 caractères', longCard === 0, `${longCard}`)
  ok(`Morpion : analyse rapide (${maxMs.toFixed(1)} ms ≤ 50)`, maxMs <= 50)
  void ME
}
