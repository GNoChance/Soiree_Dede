// Socle 2a : choix du moment (poids, fin, anti-rabâchage) et composition des répliques.
export default async function (S, { ok }) {
  const m = (type, weight, ply) => ({ type, weight, steps: [{ ply, marks: [] }], vars: {} })
  const { pickMoment } = S.pick
  ok('pick : plus gros poids', pickMoment([m('a', 50, 9), m('b', 90, 2)]).type === 'b')
  ok('pick : à poids égal, le plus proche de la fin', pickMoment([m('a', 70, 3), m('b', 70, 8)]).type === 'b')
  ok('pick : anti-rabâchage (même type 2 fois, autre à ≤ 20 points)', pickMoment([m('a', 90, 3), m('b', 75, 8)], ['a', 'a']).type === 'b')
  ok('pick : anti-rabâchage ignoré si l’autre est trop loin', pickMoment([m('a', 90, 3), m('b', 60, 8)], ['a', 'a']).type === 'a')
  ok('pick : rien -> null', pickMoment([]) === null)

  const why = {
    findMoments: () => [],
    texts: (mo, loser) =>
      loser === 'me'
        ? { lines: ['Je me suis servi{e} en {case}.', 'Deuxième phrase.'], tip: 'Un conseil.' }
        : { lines: ['J’ai oublié de te bloquer… et tu n’as pas raté ça. Bien vu !'] },
  }
  const mo = { type: 'blocage_oublie', weight: 90, steps: [{ ply: 3, marks: [] }], vars: { case: 'le centre', coup: '3e coup' } }
  const loss = S.voice.explain({ slug: 'carole', why, outcome: 'loss', moments: [mo], seed: 'x1' })
  ok(
    'voix : défaite -> intro + phrase (+ 2e phrase), 3 phrases max',
    loss.lines.length <= 3 && loss.lines.length >= 2 && S.voice.VOICES.carole.intros.includes(loss.lines[0]),
    JSON.stringify(loss.lines),
  )
  ok('voix : accord {e} du perso (Karo -> servie)', [...loss.lines, loss.card].join(' ').includes('servie'), JSON.stringify(loss))
  ok('voix : conseil présent en défaite', loss.tip === 'Un conseil.')
  const lossM = S.voice.explain({ slug: 'mika', why, outcome: 'loss', moments: [mo], seed: 'x1' })
  ok('voix : accord {e} (Mika -> servi)', [...lossM.lines, lossM.card].join(' ').includes('servi en'))
  const learned = S.voice.explain({ slug: 'mika', why, outcome: 'loss', moments: [{ ...mo, learned: 'm1' }], seed: 'x2' })
  ok('voix : coup appris -> « Et je me doutais… »', learned.lines.at(-1) === S.voice.LEARNED_LINE)
  const win = S.voice.explain({ slug: 'mika', why, outcome: 'win', moments: [mo], seed: 'x3' })
  ok('voix : victoire -> bravo + compliment, sans conseil', win.card.startsWith('Respect, bien vu !') && !win.tip && win.title === 'Ton meilleur coup')
  const draw = S.voice.explain({ slug: 'mika', why, outcome: 'draw', moments: [mo], seed: 'x4' })
  ok('voix : nul sans victoire manquée -> phrase neutre, pas de plateau', draw.card === S.voice.DRAW_NEUTRAL && draw.moment === null)
  const drawM = S.voice.explain({ slug: 'mika', why, outcome: 'draw', moments: [{ ...mo, type: 'victoire_manquee' }], seed: 'x5' })
  ok('voix : nul avec victoire manquée -> « Égalité… mais à ton 3e coup, tu pouvais gagner ! »', drawM.card === 'Égalité… mais à ton 3e coup, tu pouvais gagner !' && !!drawM.moment)
  let banned = false
  for (const v of Object.values(S.voice.VOICES)) for (const s of [...v.intros, ...v.chutes, v.bravo, v.learned]) if (/\b(nul|facile|raté)\b/i.test(s)) banned = true
  ok('voix : jamais « nul », « facile », « raté »', !banned)
  ok('voix : accroche « j’ai appris » + minuscule', S.voice.learnedLine('mika', 'Tu commences toujours par le centre.') === 'J’ai capté un truc : tu commences toujours par le centre.')
}
