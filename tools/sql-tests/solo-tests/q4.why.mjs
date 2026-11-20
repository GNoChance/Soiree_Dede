// 4 à la suite (2a) : moments clés (recherche ≤ profondeur 8, 6 coups du joueur au plus) et compliments.
import { BOT, autoLog, marked, mkRng, playLog } from './util.mjs'

export default async function (S, { ok }) {
  const L = S.q4
  const W = S.q4Why
  const game = 'quatre-a-la-suite'
  const cell = (c, r) => c * 6 + r
  const play = (first, cols, learnedAt = {}) =>
    playLog(S, L, { game, first, moves: cols.map(([by, col], i) => [by, { col }, learnedAt[i]]) }).log
  const seq = (first, cols) => {
    let by = first
    return cols.map((c) => {
      const e = [by, c]
      by = by === 'me' ? 'bot' : 'me'
      return e
    })
  }
  const topOf = (log, loser = 'me', budget) => S.pick.pickMoment(W.findMoments(log, loser, budget))

  // 1. Victoire manquée : ma colonne tout à gauche avait 3 jetons, j'ai joué la colonne du milieu.
  let log = play('me', seq('me', [0, 6, 0, 6, 0, 6, 3, 6]))
  ok('4 à la suite : partie 1 perdue', log.outcome === 'loss')
  let top = topOf(log)
  ok('Q4 victoire_manquee : bon type', top?.type === 'victoire_manquee', JSON.stringify(W.findMoments(log, 'me').map((m) => m.type)))
  ok('Q4 victoire_manquee : jeton gagnant en (0, 3), mon jeton en (3, 0)', marked(top, 'better').includes(cell(0, 3)) && marked(top, 'played').includes(cell(3, 0)), JSON.stringify(top?.steps))
  ok('Q4 victoire_manquee : les 4 alignés', [0, 1, 2, 3].every((r) => marked(top, 'line').includes(cell(0, r))), JSON.stringify(top?.steps))
  let tx = W.texts(top, 'me')
  ok('Q4 victoire_manquee : « À ton 4e coup, un jeton dans la colonne tout à gauche… »', tx.lines[0] === 'À ton 4e coup, un jeton dans la colonne tout à gauche et tu alignais quatre !' && !!tx.tip, JSON.stringify(tx))

  // 2. Blocage oublié (horizontal) : le bot a 3 jetons en bas (colonnes 2 à 4), seule la 5e colonne bloque.
  log = play('me', seq('me', [0, 1, 6, 2, 5, 3, 6, 4]))
  ok('4 à la suite : partie 2 perdue', log.outcome === 'loss')
  top = topOf(log)
  ok('Q4 blocage_oublie : bon type', top?.type === 'blocage_oublie', JSON.stringify(W.findMoments(log, 'me').map((m) => m.type)))
  ok('Q4 blocage_oublie : à bloquer (4, 0), ses 3 jetons en jaune', marked(top, 'better').includes(cell(4, 0)) && [1, 2, 3].every((c) => marked(top, 'threat').includes(cell(c, 0))), JSON.stringify(top?.steps))
  ok('Q4 blocage_oublie : {dir} = à l’horizontale, {col} = la 5e colonne', top?.vars.dir === 'à l’horizontale' && top?.vars.col === 'la 5e colonne', JSON.stringify(top?.vars))
  tx = W.texts(top, 'me')
  ok('Q4 blocage_oublie : phrase + conseil (horizontal)', tx.lines[0] === 'J’avais trois jetons alignés à l’horizontale : il fallait jouer la 5e colonne pour me bloquer.' && tx.tip?.startsWith('Compte mes jetons'), JSON.stringify(tx))

  // 3. Cadeau dessous : le bot a (1,1) (2,1) (3,1) ; je pose en (4, 0), il gagne juste au-dessus.
  log = play('me', [['me', 1], ['bot', 0], ['me', 2], ['bot', 3], ['me', 0], ['bot', 1], ['me', 6], ['bot', 2], ['me', 6], ['bot', 3], ['me', 4], ['bot', 4]])
  ok('4 à la suite : partie 3 perdue', log.outcome === 'loss')
  top = topOf(log)
  ok('Q4 cadeau_dessous : bon type', top?.type === 'cadeau_dessous', JSON.stringify(W.findMoments(log, 'me').map((m) => m.type)))
  ok('Q4 cadeau_dessous : mon jeton (4, 0), sa case (4, 1), une colonne sûre ailleurs', marked(top, 'played').includes(cell(4, 0)) && marked(top, 'threat').includes(cell(4, 1)) && marked(top, 'better').length === 1 && Math.floor(marked(top, 'better')[0] / 6) !== 4, JSON.stringify(top?.steps))
  tx = W.texts(top, 'me')
  ok('Q4 cadeau_dessous : « courte échelle »', tx.lines[0].includes('courte échelle') && tx.lines[0].includes('la 5e colonne'), JSON.stringify(tx))

  // 4. Double menace : je laisse le bot faire 3 jetons ouverts en bas.
  log = play('me', seq('me', [0, 2, 6, 3, 6, 4, 1, 5]))
  ok('4 à la suite : partie 4 perdue', log.outcome === 'loss')
  top = topOf(log)
  ok('Q4 double_menace : bon type', top?.type === 'double_menace', JSON.stringify(W.findMoments(log, 'me').map((m) => m.type)))
  ok('Q4 double_menace : mon coup (6, 1), ses 2 cases (1, 0) et (5, 0)', marked(top, 'played').includes(cell(6, 1)) && [cell(1, 0), cell(5, 0)].every((c) => marked(top, 'threat').includes(c)), JSON.stringify(top?.steps))
  ok('Q4 double_menace : la colonne qui tenait (2e ou 5e)', [cell(1, 0), cell(4, 0)].includes(marked(top, 'better')[0]), JSON.stringify(top?.steps))
  ok('Q4 double_menace : coup = « 3e coup »', top?.vars.coup === '3e coup' && top?.vars.col_jouee === 'la colonne tout à droite', JSON.stringify(top?.vars))

  // 5. Repli : sans temps de recherche, les détecteurs immédiats restent, et l'alignement est toujours là.
  const fallback = W.findMoments(log, 'me', 0)
  ok('Q4 repli : alignement (avec sa direction) toujours présent', fallback.some((m) => m.type === 'alignement' && m.vars.dir === 'à l’horizontale'), JSON.stringify(fallback.map((m) => m.type)))

  // 6. Compliments.
  log = play('me', seq('me', [0, 6, 0, 6, 0, 5, 0]))
  ok('4 à la suite : partie 6 gagnée', log.outcome === 'win')
  top = topOf(log, 'bot')
  ok('Q4 compliment : le bot a oublié de bloquer', top?.type === 'blocage_oublie' && W.texts(top, 'bot').lines[0].startsWith('J’ai oublié de te bloquer') && !W.texts(top, 'bot').tip, JSON.stringify(top))
  log = play('bot', seq('bot', [0, 2, 6, 3, 6, 4, 1, 5]))
  ok('4 à la suite : partie 7 gagnée', log.outcome === 'win')
  top = topOf(log, 'bot')
  ok('Q4 compliment : deux menaces d’un coup', top?.type === 'double_menace' && W.texts(top, 'bot').lines[0].includes('deux menaces'), JSON.stringify(top))
  ok('Q4 compliment : mon coup en vert (4, 0)', marked(top, 'better').includes(cell(4, 0)), JSON.stringify(top?.steps))

  // 7. Coup appris : le coup décisif du bot portait `learned`.
  log = play('me', seq('me', [0, 2, 6, 3, 6, 4, 1, 5]), { 5: 'q3' })
  ok('Q4 : moment marqué « appris » si le coup décisif l’était', topOf(log)?.learned === 'q3')

  // 8. 200 parties bot contre hasard.
  const rnd = mkRng(9)
  let crash = 0
  let none = 0
  let bad = 0
  let longCard = 0
  let maxMs = 0
  const types = {}
  for (let g = 0; g < 200; g++) {
    const level = 1 + (g % 10)
    const { log: lg } = autoLog(S, L, {
      game,
      first: g % 2 ? 'me' : 'bot',
      level,
      pickMe: (b) => {
        const legal = L.legalMoves(b)
        return { col: legal[Math.floor(rnd() * legal.length)] }
      },
      pickBot: (b) => S.q4Bot.decide(b, BOT, level, rnd, 15),
    })
    if (lg.outcome === 'draw') continue
    const loser = lg.outcome === 'loss' ? 'me' : 'bot'
    try {
      const t0 = performance.now()
      const ms = W.findMoments(lg, loser, 400)
      maxMs = Math.max(maxMs, performance.now() - t0)
      if (!ms.length) none++
      const t = S.pick.pickMoment(ms)
      if (t) types[`${loser}:${t.type}`] = (types[`${loser}:${t.type}`] ?? 0) + 1
      for (const m of ms) {
        if (W.texts(m, loser).lines[0].length > 110) {
          longCard++
          if (longCard < 4) console.log('  trop long :', W.texts(m, loser).lines[0])
        }
        for (const st of m.steps) {
          const better = st.marks.filter((k) => k.kind === 'better').flatMap((k) => k.cells)
          if (!better.length) continue
          const b = S.log.replayTo(L.local, lg, st.ply).state.board
          for (const c of better) {
            const col = Math.floor(c / 6)
            if (b.cols[col].length !== c % 6) bad++
          }
        }
      }
    } catch (e) {
      crash++
      if (crash < 3) console.log(e)
    }
  }
  console.log('  types choisis :', JSON.stringify(types))
  ok('Q4 200 parties : jamais d’erreur', crash === 0, `${crash}`)
  ok('Q4 200 parties : toujours un moment', none === 0, `${none}`)
  ok('Q4 200 parties : « le bon coup » = un jeton jouable', bad === 0, `${bad}`)
  ok('Q4 200 parties : 1re phrase ≤ 110 caractères', longCard === 0, `${longCard}`)
  ok(`Q4 : analyse sous le plafond (${maxMs.toFixed(0)} ms ≤ 400)`, maxMs <= 400)

  // 9. Parties serrées (bot contre bot) : la recherche travaille vraiment, toujours sous le plafond.
  let slow = 0
  const deep = {}
  for (let g = 0; g < 8; g++) {
    const { log: lg } = autoLog(S, L, {
      game,
      first: g % 2 ? 'me' : 'bot',
      pickMe: (b) => S.q4Bot.decide(b, 'humain', 4 + (g % 3), rnd, 20),
      pickBot: (b) => S.q4Bot.decide(b, BOT, 8, rnd, 20),
    })
    if (lg.outcome === 'draw') continue
    const loser = lg.outcome === 'loss' ? 'me' : 'bot'
    const t0 = performance.now()
    const ms = W.findMoments(lg, loser, 400)
    slow = Math.max(slow, performance.now() - t0)
    const t = S.pick.pickMoment(ms)
    deep[t.type] = (deep[t.type] ?? 0) + 1
  }
  console.log('  parties serrées :', JSON.stringify(deep))
  ok(`Q4 parties serrées : analyse sous le plafond (${slow.toFixed(0)} ms ≤ 400)`, slow <= 400)
}
