// Tuto « 4 à la suite » (duel) : grille 7 × 6, les jetons portent la tête du joueur.
import React from 'react'
import { C, sticker } from '../../theme'
import { Avatar, Chibi, ConfettiBurst, Finger, Outlined, Panel, Pill, Pop, SPRING, Sfx, TW, bySlug, clamp01, ramp, sp, type Tap } from '../kit'
import { makeBetting, makeVersus, type DuelCast } from '../parts'
import type { MockScene, TutoSpec } from '../types'

type Who = 'a' | 'b'
const SLUG = { a: 'kevin', b: 'cycy' } as const
const CELL = 80
const GAP = 9
const COLS = 7
const ROWS = 6
const BW = COLS * CELL + (COLS - 1) * GAP
const BH = ROWS * CELL + (ROWS - 1) * GAP
const BX = (TW - BW) / 2

const Token: React.FC<{ who: Who; size?: number; win?: boolean; f?: number }> = ({ who, size = CELL, win, f = 0 }) => (
  <div
    style={{
      width: size, height: size, borderRadius: '50%', boxSizing: 'border-box', border: `${size > 100 ? 6 : 4}px solid ${C.ink}`, overflow: 'hidden',
      background: bySlug(SLUG[who]).color, display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: win ? `0 0 0 6px ${C.sun}` : undefined, transform: win ? `scale(${1 + 0.1 * Math.abs(Math.sin(f / 5))})` : undefined,
    }}
  >
    <Chibi slug={SLUG[who]} expression={win ? 'joie' : 'cool'} size={size * 0.8} thumb style={{ marginTop: '10%' }} />
  </div>
)

type Move = { col: number; row: number; who: Who; at: number }
const colX = (col: number) => BX + col * (CELL + GAP)
const rowY = (row: number) => (ROWS - 1 - row) * (CELL + GAP)

const Board: React.FC<{ f: number; top: number; moves: Move[]; line?: [number, number][]; lineAt?: number }> = ({ f, top, moves, line, lineAt = 0 }) => {
  const i = sp(f, 0, SPRING.snappy)
  return (
    <div style={{ position: 'absolute', left: 0, top, width: TW, height: BH, transform: `scale(${0.7 + 0.3 * i})`, opacity: clamp01(i * 2) }}>
      <div style={{ position: 'absolute', left: BX - 20, top: -20, width: BW + 40, height: BH + 40, borderRadius: 36, background: '#4a37c9', border: `5px solid ${C.ink}`, boxShadow: sticker(9), boxSizing: 'border-box' }} />
      {Array.from({ length: COLS * ROWS }, (_, k) => (
        <div key={k} style={{ position: 'absolute', left: colX(k % COLS), top: rowY(Math.floor(k / COLS)), width: CELL, height: CELL, borderRadius: '50%', background: '#2a1f7a', border: `4px solid ${C.ink}`, boxSizing: 'border-box' }} />
      ))}
      {moves.map((m, k) => {
        if (f < m.at) return null
        const fall = sp(f, m.at, { stiffness: 110, damping: 9 })
        const y = -110 + (rowY(m.row) + 110) * fall
        const win = line?.some(([c, r]) => c === m.col && r === m.row) && f >= lineAt
        return (
          <div key={k} style={{ position: 'absolute', left: colX(m.col), top: Math.min(y, rowY(m.row) + 6), zIndex: win ? 2 : 1 }}>
            <Token who={m.who} win={win} f={f - lineAt} />
          </div>
        )
      })}
    </div>
  )
}

const Duelists: React.FC<{ f: number; turn: Who; a?: string; b?: string }> = ({ f, turn, a = 'joie', b = 'joie' }) => (
  <div style={{ position: 'absolute', left: 0, right: 0, top: 0, display: 'flex', justifyContent: 'center', gap: 26, alignItems: 'center' }}>
    {(['a', 'b'] as const).map((who) => {
      const on = turn === who
      return (
        <Panel key={who} bg={on ? (who === 'a' ? '#d3f3fd' : '#ffe0e6') : C.surface} radius={28} shadow={on ? 7 : 4}
          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 22px 10px 12px', fontSize: 36, transform: `scale(${on ? 1.06 + 0.03 * Math.sin(f / 4) : 0.92})`, opacity: on ? 1 : 0.65 }}>
          <Avatar slug={SLUG[who]} expression={who === 'a' ? a : b} size={84} />
          <div>{who === 'a' ? 'Keke' : 'Cycy'}</div>
        </Panel>
      )
    })}
  </div>
)

const TOP = 200
const tapOf = (m: Move): Tap => ({ at: m.at - 8, x: colX(m.col) + CELL / 2, y: TOP - 60 })

// 2 — Les jetons tombent au fond de la colonne
const PLAY: Move[] = [
  { col: 3, row: 0, who: 'a', at: 28 },
  { col: 2, row: 0, who: 'b', at: 62 },
  { col: 4, row: 0, who: 'a', at: 96 },
  { col: 3, row: 1, who: 'b', at: 130 },
]
const Dropping: MockScene = ({ f }) => {
  const next = PLAY.find((m) => f < m.at)
  return (
    <>
      <Duelists f={f} turn={next ? next.who : 'a'} />
      <Board f={f} top={TOP} moves={PLAY} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 792, display: 'flex', justifyContent: 'center' }}>
        <Pop f={f} at={40}><Pill bg={C.surface} size={38}>⬇️ Le jeton tombe tout en bas</Pill></Pop>
      </div>
      <Finger f={f} taps={PLAY.map(tapOf)} />
      {PLAY.map((m, k) => <Sfx key={k} name="tap" at={m.at} volume={0.8} />)}
      {PLAY.map((m, k) => <Sfx key={`p${k}`} name="pop" at={m.at + 16} volume={0.4} />)}
    </>
  )
}

// 3 — 4 jetons alignés (ici en diagonale)
const old = (col: number, row: number, who: Who): Move => ({ col, row, who, at: -99 })
const END: Move[] = [
  old(3, 0, 'a'), old(2, 0, 'b'), old(4, 0, 'a'), old(3, 1, 'b'), old(5, 0, 'a'), old(6, 0, 'b'),
  old(2, 1, 'a'), old(5, 1, 'b'), old(4, 1, 'a'), old(2, 2, 'b'), old(3, 2, 'a'),
  { col: 1, row: 0, who: 'b', at: 26 },
  { col: 2, row: 3, who: 'a', at: 62 },
]
const LINE: [number, number][] = [[5, 0], [4, 1], [3, 2], [2, 3]]
const WIN_AT = 82
const Aligning: MockScene = ({ f }) => (
  <>
    <Duelists f={f} turn={f < 26 ? 'b' : 'a'} a={f >= WIN_AT ? 'joie' : 'reflexion'} b={f >= WIN_AT ? 'surprise' : 'joie'} />
    <Board f={f} top={TOP} moves={END} line={LINE} lineAt={WIN_AT} />
    <div style={{ position: 'absolute', left: 0, right: 0, top: 770, display: 'flex', justifyContent: 'center' }}>
      <Pop f={f} at={WIN_AT + 4} rot={-4}><Outlined size={92} color={C.mint}>4 à la suite !</Outlined></Pop>
    </div>
    <Finger f={f} taps={END.slice(-2).map(tapOf)} />
    <ConfettiBurst f={f} at={WIN_AT} y={TOP + 260} seed="q4" />
    <Sfx name="tap" at={26} volume={0.8} />
    <Sfx name="tap" at={62} volume={0.8} />
    <Sfx name="success" at={WIN_AT + 6} volume={0.6} />
  </>
)

const DUEL: DuelCast = {
  a: { slug: 'kevin', name: 'Keke', tint: '#d3f3fd' },
  b: { slug: 'cycy', name: 'Cycy', tint: '#ffe0e6' },
  tokenA: <Token who="a" size={120} />,
  tokenB: <Token who="b" size={120} />,
}

export const quatreALaSuite: TutoSpec = {
  id: 'quatre-a-la-suite',
  name: '4 à la suite',
  emoji: '🔴',
  color: '#EF476F',
  players: '2 à 9 joueurs',
  goal: 'Aligne 4 jetons avant ton adversaire !',
  cast: ['kevin', 'cycy', 'dede', 'mika'],
  steps: [
    { text: 'Un duel : deux joueurs s’affrontent', seconds: 4.4, Mock: makeVersus(DUEL, 'Chacun ses jetons !') },
    { text: 'Chacun son tour, touche une colonne pour lâcher un jeton', seconds: 5.8, Mock: Dropping },
    { text: 'Aligne-en 4 : en ligne, en colonne ou en diagonale', seconds: 5.4, Mock: Aligning },
    { text: 'Les autres regardent… et parient sur le vainqueur !', seconds: 5, Mock: makeBetting(DUEL) },
  ],
  win: {
    text: 'Le premier qui aligne 4 jetons gagne le duel !',
    sub: 'Grille pleine : match nul. Tu as 30 s par coup.',
    winners: ['kevin'],
  },
}
