// Échecs (2a) : moments clés sur le journal (mat en 1 raté, mat évitable, pièce donnée, menace ignorée,
// défense retirée, deux menaces d'un coup, mauvais échange, roi au centre, repli) et compliments.
import { ME, BOT, marked, mkRng, momentOf } from './util.mjs'

export const SQ = (s) => (8 - Number(s[1])) * 8 + (s.charCodeAt(0) - 97)
const toMove = (u) => (typeof u === 'string' ? { from: SQ(u.slice(0, 2)), to: SQ(u.slice(2, 4)), ...(u[4] ? { promo: u[4] } : {}) } : u)

let seq = 0
/** Journal d'une partie d'échecs depuis une position FEN (ou le départ). me = couleur du joueur. */
export function chessLog(S, { fen = null, me = 'w', moves = [], perso = 'mika', level = 5 }) {
  const L = S.echecs
  let x = S.soloStart(L.local, { a: ME, b: BOT, first: me === 'w' ? ME : BOT, options: { cadence: 'none' } })
  if (fen) {
    const [rows, side, castle, , , full] = fen.split(' ')
    let sq = ''
    for (const ch of rows.replace(/\//g, '')) sq += /\d/.test(ch) ? '.'.repeat(Number(ch)) : ch
    const board = { ...x.state.board, sq, side, castle: castle === '-' ? '' : castle, ep: null, half: 0, full: Number(full ?? 1) }
    x = { ...x, state: { ...x.state, board, duel: { ...x.state.duel, turn: side === 'w' ? board.white : board.black } } }
  }
  const log = { id: `chess-${++seq}`, game: 'echecs', me: ME, bot: BOT, first: me === 'w' ? ME : BOT, perso, level, secret0: null, setup: [], x0: x, entries: [], outcome: null }
  for (const [by, u, learned] of moves) {
    const action = { type: 'move', move: toMove(u) }
    x = S.soloAct(L.local, x, by === 'me' ? ME : BOT, action)
    log.entries.push({ by, action, ...(learned ? { learned } : {}) })
    if (x.state.phase === 'result') break
  }
  if (x.state.phase === 'result') {
    const w = x.state.duel.winner
    log.outcome = w === ME ? 'win' : w === BOT ? 'loss' : 'draw'
  }
  return log
}

const R = { type: 'resign' }
const arrows = (m, kind) => (m?.steps ?? []).flatMap((s) => s.marks.filter((k) => k.kind === kind && k.arrow).map((k) => k.arrow))
const hasArrow = (m, kind, a, b) => arrows(m, kind).some(([p, q]) => p === SQ(a) && q === SQ(b))

export default async function (S, { ok }) {
  const W = S.echecsWhy
  const top = (log, loser = 'me') => S.pick.pickMoment(W.findMoments(log, loser))
  const types = (log, loser = 'me') => W.findMoments(log, loser).map((m) => m.type)

  // 1. Mat en 1 raté (Dxf7#), puis abandon.
  let log = chessLog(S, { fen: 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 0 4', moves: [['me', 'd2d3'], ['bot', 'g8f6'], ['me', R]] })
  ok('Échecs : partie 1 abandonnée (perdue)', log.outcome === 'loss')
  let m = top(log)
  ok('Échecs mat_en_1_rate : bon type', m?.type === 'mat_en_1_rate', JSON.stringify(types(log)))
  ok('Échecs mat_en_1_rate : flèche verte h5 -> f7', hasArrow(m, 'better', 'h5', 'f7'), JSON.stringify(m?.steps))
  let tx = m && W.texts(m, 'me')
  ok('Échecs mat_en_1_rate : « Au coup 4, tu pouvais me faire échec et mat : ta dame en f7 ! »', tx?.lines[0] === 'Au coup 4, tu pouvais me faire échec et mat : ta dame en f7 !', JSON.stringify(tx))

  // 2. Mat évitable (mat du couloir) : Da7?? Te1#.
  log = chessLog(S, { fen: '4r1k1/5ppp/8/8/3Q4/8/5PPP/6K1 w - - 0 20', moves: [['me', 'd4a7'], ['bot', 'e8e1']] })
  ok('Échecs : partie 2 perdue par mat', log.outcome === 'loss')
  m = top(log)
  ok('Échecs mat_evitable : bon type', m?.type === 'mat_evitable', JSON.stringify(types(log)))
  ok('Échecs mat_evitable : mon coup a7 en rouge + flèche jaune du mat e8 -> e1', marked(m, 'played').includes(SQ('a7')) && hasArrow(m, 'threat', 'e8', 'e1'), JSON.stringify(m?.steps))
  ok('Échecs mat_evitable : un coup vert qui évitait le mat', arrows(m, 'better').length === 1, JSON.stringify(m?.steps))
  tx = m && W.texts(m, 'me')
  ok('Échecs mat_evitable : phrase + conseil du couloir', tx?.lines[0] === 'Au coup 20, tu as joué ta dame en a7 : ça m’a laissé le mat avec ma tour.' && /fenêtre/.test(tx?.tip ?? ''), JSON.stringify(tx))

  // 3. Pièce donnée : 1. e4 d5 2. Dg4?? Fxg4.
  log = chessLog(S, { moves: [['me', 'e2e4'], ['bot', 'd7d5'], ['me', 'd1g4'], ['bot', 'c8g4'], ['me', R]] })
  m = top(log)
  ok('Échecs piece_donnee : bon type', m?.type === 'piece_donnee', JSON.stringify(types(log)))
  ok('Échecs piece_donnee : ma dame en g4 + flèche de l’attaquant c8 -> g4', marked(m, 'played').includes(SQ('g4')) && hasArrow(m, 'threat', 'c8', 'g4'), JSON.stringify(m?.steps))
  tx = m && W.texts(m, 'me')
  ok('Échecs piece_donnee : phrase', tx?.lines[0] === 'Au coup 2, tu as posé ta dame en g4, pile sur une case que mon fou attaquait.', JSON.stringify(tx))

  // 4. Menace ignorée : 1. Cf3 e5 2. Cc3 e4 (le pion attaque f3) 3. a3?? exf3 4. gxf3.
  log = chessLog(S, { moves: [['me', 'g1f3'], ['bot', 'e7e5'], ['me', 'b1c3'], ['bot', 'e5e4'], ['me', 'a2a3'], ['bot', 'e4f3'], ['me', 'g2f3'], ['bot', 'd7d5'], ['me', R]] })
  m = top(log)
  ok('Échecs menace_ignoree : bon type', m?.type === 'menace_ignoree', JSON.stringify(types(log)))
  ok('Échecs menace_ignoree : flèche de l’attaquant e4 -> f3 et coup qui sauvait (bouger le cavalier ou prendre e4)', hasArrow(m, 'threat', 'e4', 'f3') && arrows(m, 'better').some(([f, t]) => f === SQ('f3') || t === SQ('e4')), JSON.stringify(m?.steps))
  tx = m && W.texts(m, 'me')
  ok('Échecs menace_ignoree : phrase', tx?.lines[0] === 'Mon pion attaquait ton cavalier et tu as joué autre chose. Je l’ai pris !', JSON.stringify(tx))

  // 5. Défense retirée : la tour d1 protégeait le fou d4, elle part en a1.
  log = chessLog(S, { fen: '3r2k1/5ppp/8/8/3B4/8/5PPP/3R2K1 w - - 0 15', moves: [['me', 'd1a1'], ['bot', 'd8d4'], ['me', R]] })
  m = top(log)
  ok('Échecs defense_retiree : bon type', m?.type === 'defense_retiree', JSON.stringify(types(log)))
  tx = m && W.texts(m, 'me')
  ok('Échecs defense_retiree : phrase', tx?.lines[0] === 'En bougeant ta tour, tu as laissé ton fou sans protection.', JSON.stringify(tx))
  ok('Échecs defense_retiree : pièce abandonnée d4 en jaune', marked(m, 'threat').includes(SQ('d4')), JSON.stringify(m?.steps))

  // 6. Deux menaces d'un coup : Cc2+ attaque le roi et la tour.
  log = chessLog(S, { fen: '4k3/7p/8/8/3n4/8/7P/R3K3 b - - 0 30', moves: [['bot', 'd4c2'], ['me', 'e1e2'], ['bot', 'c2a1'], ['me', R]] })
  m = top(log)
  ok('Échecs fourchette : bon type', m?.type === 'fourchette', JSON.stringify(types(log)))
  ok('Échecs fourchette : 2 flèches jaunes c2 -> e1 et c2 -> a1', hasArrow(m, 'threat', 'c2', 'e1') && hasArrow(m, 'threat', 'c2', 'a1'), JSON.stringify(m?.steps))
  tx = m && W.texts(m, 'me')
  ok('Échecs fourchette : phrase', tx?.lines[0] === 'Mon cavalier attaquait ton roi et ta tour en même temps : tu ne pouvais en sauver qu’une.', JSON.stringify(tx))

  // 7. Mauvais échange : 3. Cxe5?? Cxe5.
  log = chessLog(S, { moves: [['me', 'e2e4'], ['bot', 'e7e5'], ['me', 'g1f3'], ['bot', 'b8c6'], ['me', 'f3e5'], ['bot', 'c6e5'], ['me', R]] })
  m = top(log)
  ok('Échecs mauvais_echange : bon type', m?.type === 'mauvais_echange', JSON.stringify(types(log)))
  tx = m && W.texts(m, 'me')
  ok('Échecs mauvais_echange : phrase', tx?.lines[0] === 'Au coup 3, tu as pris mon pion avec ton cavalier… mais la case était protégée, et j’ai repris ton cavalier.', JSON.stringify(tx))

  // 8. Roi au centre (mat du lion) + repli matériel toujours présent.
  log = chessLog(S, { moves: [['me', 'f2f3'], ['bot', 'e7e5'], ['me', 'g2g4'], ['bot', 'd8h4']] })
  ok('Échecs : mat du lion', log.outcome === 'loss')
  const all = types(log)
  ok('Échecs roi_au_centre : détecté (roi resté en e1, jamais roqué)', all.includes('roi_au_centre') && all.includes('mat_evitable') && all.includes('materiel'), JSON.stringify(all))
  ok('Échecs roi_au_centre : texte', W.texts(momentOf(W.findMoments(log, 'me'), 'roi_au_centre'), 'me').lines[0].startsWith('Ton roi est resté au milieu'))

  // 9. Compliments : mat du berger par le joueur ; pièce gagnée.
  log = chessLog(S, { moves: [['me', 'e2e4'], ['bot', 'e7e5'], ['me', 'd1h5'], ['bot', 'b8c6'], ['me', 'f1c4'], ['bot', 'g8f6'], ['me', 'h5f7']] })
  ok('Échecs : mat du berger par le joueur', log.outcome === 'win')
  m = top(log, 'bot')
  tx = m && W.texts(m, 'bot')
  ok('Échecs compliment mat : « Échec et mat au coup 4 avec ta dame en f7 : je ne l’ai pas vu venir ! »', tx?.lines[0] === 'Échec et mat au coup 4 avec ta dame en f7 : je ne l’ai pas vu venir !' && !tx.tip, JSON.stringify(tx))
  ok('Échecs compliment mat : flèche verte h5 -> f7', hasArrow(m, 'better', 'h5', 'f7'), JSON.stringify(m?.steps))
  log = chessLog(S, { me: 'b', moves: [['bot', 'e2e4'], ['me', 'd7d5'], ['bot', 'd1g4'], ['me', 'c8g4'], ['bot', R]] })
  ok('Échecs : le bot abandonne', log.outcome === 'win')
  m = top(log, 'bot')
  tx = m && W.texts(m, 'bot')
  ok('Échecs compliment pièce gagnée : « Ton coup 2 m’a pris ma dame : … »', tx?.lines[0] === 'Ton coup 2 m’a pris ma dame : c’est là que la partie a tourné.', JSON.stringify({ m, tx }))
  ok('Échecs compliment pièce gagnée : ma prise c8 -> g4 en vert', hasArrow(m, 'better', 'c8', 'g4'), JSON.stringify(m?.steps))

  // 10. Coup appris : le coup décisif du bot portait `learned`.
  log = chessLog(S, { moves: [['me', 'e2e4'], ['bot', 'd7d5'], ['me', 'd1g4'], ['bot', 'c8g4', 'e2'], ['me', R]] })
  ok('Échecs : moment marqué « appris » si le coup décisif l’était', top(log)?.learned === 'e2')

  // 11. Parties bot contre hasard : jamais d'erreur, toujours un moment, bon coup légal, temps.
  const rnd = mkRng(9)
  const N = Number(process.env.CHESS_WHY_GAMES ?? 60)
  let crash = 0
  let none = 0
  let bad = 0
  let longCard = 0
  let maxMs = 0
  let total = 0
  for (let g = 0; g < N; g++) {
    const level = 1 + (g % 10)
    const meW = g % 2 === 0
    let x = S.soloStart(S.echecs.local, { a: ME, b: BOT, first: meW ? ME : BOT, options: { cadence: 'none' } })
    const lg = { id: `rand-${g}`, game: 'echecs', me: ME, bot: BOT, first: meW ? ME : BOT, perso: 'mika', level, secret0: null, setup: [], x0: x, entries: [], outcome: null }
    const maxPly = 30 + (g % 5) * 20
    for (let ply = 0; x.state.phase === 'playing' && ply <= maxPly; ply++) {
      const b = x.state.board
      const turn = b.side === 'w' ? b.white : b.black
      let move
      if (ply === maxPly) move = R
      else if (turn === BOT) move = S.echecsBot.chooseMove(b, BOT, level, rnd, 20)
      else {
        const ms = S.echecs.legalMoves(b)
        move = ms[Math.floor(rnd() * ms.length)]
      }
      const actor = ply === maxPly ? (g % 3 === 0 ? BOT : ME) : turn
      const action = { type: 'move', move }
      x = S.soloAct(S.echecs.local, x, actor, action)
      lg.entries.push({ by: actor === ME ? 'me' : 'bot', action })
    }
    if (x.state.phase !== 'result') continue
    const w = x.state.duel.winner
    lg.outcome = w === ME ? 'win' : w === BOT ? 'loss' : 'draw'
    if (lg.outcome === 'draw') continue
    const loser = lg.outcome === 'loss' ? 'me' : 'bot'
    try {
      const t0 = performance.now()
      const moments = W.findMoments(lg, loser, 1500)
      maxMs = Math.max(maxMs, performance.now() - t0)
      total++
      if (!moments.length) none++
      for (const mo of moments) {
        if (W.texts(mo, loser).lines[0].length > 110) longCard++
        for (const st of mo.steps) {
          for (const k of st.marks) {
            if (k.kind !== 'better' || !k.arrow) continue
            const b = S.log.replayTo(S.echecs.local, lg, st.ply).state.board
            if (!S.echecs.legalMoves(b).some((q) => q.from === k.arrow[0] && q.to === k.arrow[1])) {
              bad++
              if (bad < 3) console.log('  bon coup illégal', mo.type, JSON.stringify(k), b.sq)
            }
          }
        }
      }
    } catch (e) {
      crash++
      if (crash < 3) console.log(e)
    }
  }
  ok(`Échecs ${total} parties bot contre hasard : jamais d’erreur`, crash === 0, `${crash}`)
  ok('Échecs : toujours un moment', none === 0, `${none}`)
  ok('Échecs : « le bon coup » toujours légal', bad === 0, `${bad}`)
  ok('Échecs : 1re phrase ≤ 110 caractères', longCard === 0, `${longCard}`)
  ok(`Échecs : analyse sous le plafond (${maxMs.toFixed(0)} ms ≤ 1600)`, maxMs <= 1600)
}
