// Bataille navale (2a) : le plus gros gaspillage de tirs (ligne pas suivie, chasse abandonnée, tir gaspillé,
// bateaux collés, flotte prévisible (2b), course) et compliments (radar, aucun tir perdu).
import { BOT, ME, autoLog, marked, mkRng, momentOf } from './util.mjs'

/** Cases d'une flotte (y × 10 + x). */
const SIZES = { 'porte-avions': 5, cuirasse: 4, croiseur: 3, 'sous-marin': 3, torpilleur: 2 }
export const fleetCells = (fleet) => fleet.flatMap((s) => Array.from({ length: SIZES[s.id] }, (_, k) => (s.dir === 'h' ? s.y * 10 + s.x + k : (s.y + k) * 10 + s.x)))
const xy = (i) => ({ x: i % 10, y: Math.floor(i / 10) })
const C = (name) => (Number(name.slice(1)) - 1) * 10 + (name.charCodeAt(0) - 65)

/** Flotte du bot : rangée dans les lignes 4 à 8, colonnes B à H (loin des coins). */
export const BOT_FLEET = [
  { id: 'porte-avions', x: 1, y: 3, dir: 'h' },
  { id: 'cuirasse', x: 1, y: 5, dir: 'h' },
  { id: 'croiseur', x: 1, y: 7, dir: 'h' },
  { id: 'sous-marin', x: 7, y: 3, dir: 'v' },
  { id: 'torpilleur', x: 5, y: 7, dir: 'h' },
]
/** Flotte du joueur, espacée. */
export const ME_FLEET = [
  { id: 'porte-avions', x: 0, y: 0, dir: 'h' },
  { id: 'cuirasse', x: 0, y: 2, dir: 'h' },
  { id: 'croiseur', x: 0, y: 4, dir: 'h' },
  { id: 'sous-marin', x: 0, y: 6, dir: 'h' },
  { id: 'torpilleur', x: 0, y: 8, dir: 'h' },
]
/** Flotte du joueur, bateaux collés. */
const GLUED = [
  { id: 'porte-avions', x: 2, y: 2, dir: 'h' },
  { id: 'cuirasse', x: 2, y: 3, dir: 'h' },
  { id: 'croiseur', x: 2, y: 4, dir: 'h' },
  { id: 'sous-marin', x: 2, y: 5, dir: 'h' },
  { id: 'torpilleur', x: 2, y: 6, dir: 'h' },
]

/**
 * Partie scriptée : flottes posées, puis chacun tire dans sa liste (cases), à son tour.
 * Liste épuisée -> tir sur une case d'eau encore libre (le joueur) / sur la flotte (le bot).
 */
export function bnGame(S, { me = ME_FLEET, bot = BOT_FLEET, meShots = [], botShots = null, first = 'me', ctx, level = 5 }) {
  const L = S.bn
  const botQ = [...(botShots ?? fleetCells(me))]
  const meQ = [...meShots]
  const botOcc = new Set(fleetCells(bot))
  const shotAt = (b, shooter) => new Set(b.waters[shooter === ME ? BOT : ME].shots.map((s) => s.y * 10 + s.x))
  return autoLog(S, L, {
    game: 'bataille-navale',
    first,
    level,
    ctx,
    setup: [
      ['me', { type: 'move', move: { type: 'place', ships: me } }],
      ['bot', { type: 'move', move: { type: 'place', ships: bot } }],
      ['bot', { type: 'ready' }],
      ['me', { type: 'ready' }],
    ],
    pickMe: (b) => {
      const done = shotAt(b, ME)
      while (meQ.length && done.has(meQ[0])) meQ.shift()
      if (meQ.length) return xy(meQ.shift())
      for (let i = 99; i >= 0; i--) if (!done.has(i) && !botOcc.has(i)) return xy(i)
      for (let i = 0; i < 100; i++) if (!done.has(i)) return xy(i)
    },
    pickBot: (b) => {
      const done = shotAt(b, BOT)
      while (botQ.length && done.has(botQ[0])) botQ.shift()
      if (botQ.length) return xy(botQ.shift())
      const meOcc = new Set(fleetCells(me))
      for (let i = 0; i < 100; i++) if (!done.has(i) && meOcc.has(i)) return xy(i)
      for (let i = 0; i < 100; i++) if (!done.has(i)) return xy(i)
    },
  }).log
}

export default async function (S, { ok }) {
  const W = S.bnWhy
  const top = (log, loser = 'me') => S.pick.pickMoment(W.findMoments(log, loser))
  const water = (n) => {
    // n cases d'eau du joueur, pour les tirs ratés du bot
    const occ = new Set(fleetCells(ME_FLEET))
    return Array.from({ length: 100 }, (_, i) => 99 - i).filter((i) => !occ.has(i)).slice(0, n)
  }

  // 1. Ligne pas suivie : B4 et C4 touchés (alignés), puis tir en J1.
  let log = bnGame(S, { meShots: [C('B4'), C('C4'), C('J1')] })
  ok('BN : partie 1 perdue', log.outcome === 'loss')
  let m = top(log)
  ok('BN ligne_pas_suivie : bon type', m?.type === 'ligne_pas_suivie', JSON.stringify(W.findMoments(log, 'me').map((x) => x.type)))
  ok('BN ligne_pas_suivie : D4 (ou A4) dans l’alignement, J1 en rouge', marked(m, 'better').includes(C('D4')) && marked(m, 'played').includes(C('J1')), JSON.stringify(m?.steps))
  ok('BN ligne_pas_suivie : vars B4 / C4 / J1, « 3e tir »', m?.vars.case_a === 'B4' && m?.vars.case_b === 'C4' && m?.vars.case_jouee === 'J1' && m?.vars.coup === '3e tir', JSON.stringify(m?.vars))
  let tx = W.texts(m, 'me')
  ok('BN ligne_pas_suivie : phrase + conseil', tx.lines[0].includes('B4') && tx.lines[0].includes('J1') && /tout droit/.test(tx.tip), JSON.stringify(tx))

  // 2. Chasse abandonnée : B4 touché, puis J1.
  log = bnGame(S, { meShots: [C('B4'), C('J1')] })
  m = top(log)
  ok('BN chasse_abandonnee : bon type', m?.type === 'chasse_abandonnee', JSON.stringify(W.findMoments(log, 'me').map((x) => x.type)))
  ok('BN chasse_abandonnee : les cases autour de B4 en vert', [C('A4'), C('C4'), C('B3'), C('B5')].every((c) => marked(m, 'better').includes(c)) && marked(m, 'played').includes(C('J1')), JSON.stringify(m?.steps))
  tx = W.texts(m, 'me')
  ok('BN chasse_abandonnee : « Tu m’as touché{e} en B4 »', tx.lines[0].startsWith('Tu m’as touché{e} en B4'), JSON.stringify(tx))

  // 3. Tir gaspillé (×2) : A1 puis J1 entourés d'eau, trop petits pour le torpilleur.
  log = bnGame(S, {
    meShots: [C('A2'), C('B1'), C('A1'), C('J2'), C('I1'), C('J1')],
    botShots: [...water(5), ...fleetCells(ME_FLEET)],
  })
  ok('BN : partie 3 perdue', log.outcome === 'loss')
  m = top(log)
  ok('BN tir_gaspille : bon type', m?.type === 'tir_gaspille', JSON.stringify(W.findMoments(log, 'me').map((x) => x.type)))
  ok('BN tir_gaspille : 1er tir gaspillé = A1, nb = 2, taille = 2', marked(m, 'played').includes(C('A1')) && m?.vars.nb === 2 && m?.vars.taille === 2, JSON.stringify(m))
  tx = W.texts(m, 'me')
  ok('BN tir_gaspille : phrase « ne pouvait rien toucher »', tx.lines[0].includes('A1') && tx.lines[0].includes('ne pouvait rien toucher'), JSON.stringify(tx))
  log = bnGame(S, { meShots: [C('A2'), C('B1'), C('A1')], botShots: [...water(3), ...fleetCells(ME_FLEET)] })
  ok('BN tir_gaspille : un seul -> pas de moment', !momentOf(W.findMoments(log, 'me'), 'tir_gaspille'))

  // 4. Bateaux collés + 17 touchés d'affilée.
  log = bnGame(S, { me: GLUED, meShots: [C('J10')] })
  m = top(log)
  ok('BN bateaux_colles : bon type', m?.type === 'bateaux_colles', JSON.stringify(W.findMoments(log, 'me').map((x) => x.type)))
  ok('BN bateaux_colles : sa flotte (eaux du joueur, cases + 100) en jaune', marked(m, 'zone').length >= 4 && marked(m, 'zone').every((c) => c >= 100), JSON.stringify(m?.steps))

  // 5. Flotte prévisible (2b) : contexte « B1 actif » + cases habituelles = sa flotte du jour.
  log = bnGame(S, { meShots: [C('J10')], ctx: { b1: true, cells: fleetCells(ME_FLEET) } })
  m = top(log)
  ok('BN flotte_previsible : bon type (B1 actif)', m?.type === 'flotte_previsible' && m.vars.nb === 10, JSON.stringify(m))
  ok('BN flotte_previsible : cases habituelles en jaune sur ses eaux', marked(m, 'zone').includes(100 + C('A1')))
  log = bnGame(S, { meShots: [C('J10')], ctx: { b1: false, cells: fleetCells(ME_FLEET) } })
  ok('BN flotte_previsible : pas sans B1', !momentOf(W.findMoments(log, 'me'), 'flotte_previsible'))

  // 6. Course : rien de net (il coule le porte-avions proprement puis cherche).
  log = bnGame(S, { meShots: [C('B4'), C('C4'), C('D4'), C('E4'), C('F4'), C('J1')] })
  m = top(log)
  ok('BN course : repli, il manquait 12 touchés', m?.type === 'course' && m.vars.manque === 12, JSON.stringify(m))
  tx = W.texts(m, 'me')
  ok('BN course : phrases + conseil damier', tx.lines[0].includes('12') && /damier/.test(tx.tip), JSON.stringify(tx))

  // 7. « Sans ça, c'était jouable ! » : nb ≥ manque.
  {
    const near = fleetCells(BOT_FLEET).slice(0, 16)
    log = bnGame(S, { meShots: [...near, C('J1')] })
    const mm = W.findMoments(log, 'me')
    const ch = momentOf(mm, 'chasse_abandonnee') ?? momentOf(mm, 'ligne_pas_suivie')
    ok('BN : « sans ça, c’était jouable ! » quand nb ≥ manque', !!ch && /sans ça, c’était jouable !/i.test(W.texts(ch, 'me').lines.join(' ')), JSON.stringify(ch && W.texts(ch, 'me')))
  }

  // 8. Compliments : 17 touchés d'affilée ; suivi propre.
  log = bnGame(S, { meShots: fleetCells(BOT_FLEET) })
  ok('BN : partie 8 gagnée', log.outcome === 'win')
  m = top(log, 'bot')
  tx = W.texts(m, 'bot')
  ok('BN compliment : radar (100 %, 17 d’affilée)', m?.type === 'radar' && tx.lines[0].startsWith('100 % de tirs réussis, dont 17 touchés d’affilée'), JSON.stringify({ m, tx }))
  ok('BN compliment : sans conseil', !tx.tip)
  {
    const shots = []
    for (const c of fleetCells(BOT_FLEET)) shots.push(c)
    // quelques tirs d'eau au début, puis chaque bateau suivi jusqu'au bout
    log = bnGame(S, { meShots: [C('J1'), C('J10'), C('A10'), C('I2'), ...shots], botShots: [...water(4), ...fleetCells(ME_FLEET).slice(0, 10), ...water(30)] })
    ok('BN : partie 9 gagnée', log.outcome === 'win')
    m = top(log, 'bot')
    ok('BN compliment : « Aucun tir perdu »', m?.type === 'suivi' && W.texts(m, 'bot').lines[0].startsWith('Aucun tir perdu'), JSON.stringify(m))
  }

  // 9. 200 parties bot contre hasard : jamais d'erreur, toujours un moment, bon coup = case non visée.
  const rnd = mkRng(9)
  let crash = 0
  let none = 0
  let bad = 0
  let longCard = 0
  let maxMs = 0
  for (let g = 0; g < 200; g++) {
    const level = 1 + (g % 10)
    let lg
    try {
      lg = autoLog(S, S.bn, {
        game: 'bataille-navale',
        first: g % 2 ? 'me' : 'bot',
        level,
        setup: [
          ['bot', { type: 'ready' }],
          ['me', { type: 'ready' }],
        ],
        pickMe: (b) => {
          if (g % 3 === 0) {
            const c = S.bn.legalMoves(b, ME)
            return c[Math.floor(rnd() * c.length)]
          }
          return S.bnBot.chooseMove(b, ME, 1 + ((g * 7) % 10), rnd)
        },
        pickBot: (b) => S.bnBot.decide(b, BOT, level, rnd),
      }).log
      const loser = lg.outcome === 'loss' ? 'me' : 'bot'
      const t0 = performance.now()
      const ms = W.findMoments(lg, loser)
      maxMs = Math.max(maxMs, performance.now() - t0)
      if (!ms.length) none++
      for (const mo of ms) {
        if (W.texts(mo, loser).lines[0].length > 110) longCard++
        for (const st of mo.steps) {
          const better = st.marks.filter((k) => k.kind === 'better').flatMap((k) => k.cells)
          if (!better.length) continue
          const b = S.log.replayTo(S.bn.local, lg, st.ply).state.board
          const done = new Set(b.waters[BOT].shots.map((s) => s.y * 10 + s.x))
          for (const c of better) if (c >= 100 || done.has(c)) bad++
        }
      }
    } catch (e) {
      crash++
      if (crash < 3) console.log(e)
    }
  }
  ok('BN 200 parties : jamais d’erreur', crash === 0, `${crash}`)
  ok('BN 200 parties : toujours un moment', none === 0, `${none}`)
  ok('BN 200 parties : « le bon coup » = case pas encore visée', bad === 0, `${bad}`)
  ok('BN 200 parties : 1re phrase ≤ 110 caractères', longCard === 0, `${longCard}`)
  ok(`BN : analyse rapide (${maxMs.toFixed(1)} ms ≤ 60)`, maxMs <= 60)
}
