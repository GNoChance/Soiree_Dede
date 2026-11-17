// Tuto « Morpion » (duel, variante classique 3×3).
import React from 'react'
import { C, sticker } from '../../theme'
import { Avatar, Bubble, Chibi, ConfettiBurst, Finger, Outlined, Panel, Pill, Pop, SPRING, Sfx, TW, bob, clamp01, easeInOut, lerp, ramp, sp, wiggle, type Tap } from '../kit'
import type { MockScene, TutoSpec } from '../types'

const X_COLOR = C.tomato
const O_COLOR = C.sky
const CELL = 150
const GAP = 14
const BOARD = CELL * 3 + GAP * 2
const BX = (TW - BOARD) / 2

const Mark: React.FC<{ sym: 'X' | 'O'; s: number; size?: number }> = ({ sym, s, size = CELL }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" style={{ transform: `scale(${s}) rotate(${(1 - s) * -60}deg)`, display: 'block' }}>
    {sym === 'X' ? (
      <>
        <path d="M26 26 L74 74 M74 26 L26 74" stroke={C.ink} strokeWidth={26} strokeLinecap="round" />
        <path d="M26 26 L74 74 M74 26 L26 74" stroke={X_COLOR} strokeWidth={14} strokeLinecap="round" />
      </>
    ) : (
      <>
        <circle cx={50} cy={50} r={26} fill="none" stroke={C.ink} strokeWidth={26} />
        <circle cx={50} cy={50} r={26} fill="none" stroke={O_COLOR} strokeWidth={14} />
      </>
    )}
  </svg>
)

type Move = { cell: number; sym: 'X' | 'O'; at: number }
const cellXY = (cell: number) => ({ x: BX + (cell % 3) * (CELL + GAP), y: Math.floor(cell / 3) * (CELL + GAP) })

/** Grille 3×3 ; `line` = cases gagnantes surlignées à partir de `lineAt`. */
const Board: React.FC<{ f: number; top: number; moves: Move[]; line?: number[]; lineAt?: number }> = ({ f, top, moves, line, lineAt = 0 }) => {
  const i = sp(f, 0, SPRING.snappy)
  return (
    <div style={{ position: 'absolute', left: 0, top, width: TW, height: BOARD, transform: `scale(${0.7 + 0.3 * i})`, opacity: clamp01(i * 2) }}>
      <div style={{ position: 'absolute', left: BX - 22, top: -22, width: BOARD + 44, height: BOARD + 44, borderRadius: 40, background: C.sun, border: `5px solid ${C.ink}`, boxShadow: sticker(9), boxSizing: 'border-box' }} />
      {Array.from({ length: 9 }, (_, cell) => {
        const { x, y } = cellXY(cell)
        const m = moves.find((mv) => mv.cell === cell)
        const win = line?.includes(cell) && f >= lineAt
        const pulse = win ? 1 + 0.08 * Math.abs(Math.sin((f - lineAt) / 5)) : 1
        return (
          <div
            key={cell}
            style={{
              position: 'absolute', left: x, top: y, width: CELL, height: CELL, borderRadius: 24, boxSizing: 'border-box', border: `5px solid ${C.ink}`,
              background: win ? C.mint : C.surface, transform: `scale(${pulse})`, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {m && f >= m.at && <Mark sym={m.sym} s={sp(f, m.at)} size={CELL - 20} />}
          </div>
        )
      })}
    </div>
  )
}

const tapOf = (m: Move, top: number): Tap => ({ at: m.at, x: cellXY(m.cell).x + CELL / 2, y: top + cellXY(m.cell).y + CELL / 2 })

/** Bandeau des deux duellistes ; `turn` = symbole dont c'est le tour. */
const Duelists: React.FC<{ f: number; turn: 'X' | 'O' | null; left?: string; right?: string }> = ({ f, turn, left = 'joie', right = 'joie' }) => (
  <div style={{ position: 'absolute', left: 0, right: 0, top: 0, display: 'flex', justifyContent: 'center', gap: 26, alignItems: 'center' }}>
    {(['X', 'O'] as const).map((sym) => {
      const on = turn === sym
      return (
        <Panel key={sym} bg={on ? (sym === 'X' ? '#ffd0da' : '#d3f3fd') : C.surface} radius={28} shadow={on ? 7 : 4}
          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px 10px 12px', fontSize: 36, transform: `scale(${on ? 1.06 + 0.03 * Math.sin(f / 4) : 0.92})`, opacity: on || turn === null ? 1 : 0.65 }}>
          <Avatar slug={sym === 'X' ? 'kevin' : 'cycy'} expression={sym === 'X' ? left : right} size={84} />
          <div>{sym === 'X' ? 'Keke' : 'Cycy'}</div>
          <Mark sym={sym} s={1} size={54} />
        </Panel>
      )
    })}
  </div>
)

// 1 — Deux joueurs face à face
const Versus: MockScene = ({ f }) => {
  const a = sp(f, 2)
  const b = sp(f, 8)
  const vs = sp(f, 18)
  return (
    <>
      <div style={{ position: 'absolute', left: 20 - (1 - a) * 400, top: 120 + bob(f, 0, 12, 26) }}>
        <Chibi slug="kevin" expression="cool" size={310} />
        <div style={{ position: 'absolute', left: -10, top: -30, transform: `rotate(-10deg) scale(${sp(f, 26)})` }}><Mark sym="X" s={1} size={130} /></div>
      </div>
      <div style={{ position: 'absolute', right: 20 - (1 - b) * 400, top: 300 + bob(f, 13, 12, 26) }}>
        <Chibi slug="cycy" expression="clin_oeil" size={310} />
        <div style={{ position: 'absolute', right: -10, top: -30, transform: `rotate(10deg) scale(${sp(f, 32)})` }}><Mark sym="O" s={1} size={130} /></div>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 290, display: 'flex', justifyContent: 'center', transform: `scale(${vs * (1 + 0.05 * Math.sin(f / 5))}) rotate(-8deg)` }}>
        <Outlined size={150} color={C.sun}>VS</Outlined>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 720, display: 'flex', justifyContent: 'center' }}>
        <Pop f={f} at={58} rot={-2}><Pill bg={C.surface} size={44}>❌ commence !</Pill></Pop>
      </div>
      <Sfx name="whoosh" at={2} volume={0.4} />
      <Sfx name="pop" at={20} volume={0.6} />
      <Sfx name="pop" at={60} />
    </>
  )
}

// 2 — On pose son symbole chacun son tour
const PLAY: Move[] = [
  { cell: 4, sym: 'X', at: 26 },
  { cell: 0, sym: 'O', at: 62 },
  { cell: 2, sym: 'X', at: 98 },
]
const BOARD_TOP = 210
const Placing: MockScene = ({ f }) => {
  const turn = f < 26 ? 'X' : f < 62 ? 'O' : f < 98 ? 'X' : 'O'
  const since = f - (turn === 'X' ? (f < 26 ? 0 : 62) : f < 98 ? 26 : 98)
  return (
    <>
      <Duelists f={f} turn={turn} />
      <Board f={f} top={BOARD_TOP} moves={PLAY} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 760, display: 'flex', justifyContent: 'center' }}>
        <Pop f={f} at={6}><Pill bg={C.surface} size={38}>⏱️ {Math.max(1, 30 - Math.floor(since / 12))} s pour jouer</Pill></Pop>
      </div>
      <Finger f={f} taps={PLAY.map((m) => tapOf(m, BOARD_TOP))} />
      {PLAY.map((m) => <Sfx key={m.cell} name="tap" at={m.at + 8} volume={0.8} />)}
      {PLAY.map((m) => <Sfx key={`p${m.cell}`} name="pop" at={m.at + 9} volume={0.35} />)}
    </>
  )
}

// 3 — Aligner 3 symboles
const BEFORE: Move[] = [...PLAY.map((m) => ({ ...m, at: -99 })), { cell: 6, sym: 'O', at: -99 }, { cell: 3, sym: 'X', at: -99 }]
const END: Move[] = [...BEFORE, { cell: 1, sym: 'O', at: 22 }, { cell: 5, sym: 'X', at: 58 }]
const WIN_AT = 72
const Aligning: MockScene = ({ f }) => (
  <>
    <Duelists f={f} turn={f < 22 ? 'O' : 'X'} left={f >= WIN_AT ? 'joie' : 'reflexion'} right={f >= WIN_AT ? 'surprise' : 'joie'} />
    <Board f={f} top={BOARD_TOP} moves={END} line={[3, 4, 5]} lineAt={WIN_AT} />
    <div style={{ position: 'absolute', left: 0, right: 0, top: 740, display: 'flex', justifyContent: 'center' }}>
      <Pop f={f} at={WIN_AT + 4} rot={-4}><Outlined size={96} color={C.mint}>3 alignés !</Outlined></Pop>
    </div>
    <Finger f={f} taps={END.slice(-2).map((m) => tapOf(m, BOARD_TOP))} />
    <ConfettiBurst f={f} at={WIN_AT} y={BOARD_TOP + 240} seed="mp" />
    <Sfx name="tap" at={30} volume={0.8} />
    <Sfx name="tap" at={66} volume={0.8} />
    <Sfx name="success" at={WIN_AT + 8} volume={0.6} />
  </>
)

// 4 — Les spectateurs parient
const BETS: { slug: 'dede' | 'mika' | 'manon'; on: 0 | 1; at: number }[] = [
  { slug: 'dede', on: 0, at: 30 },
  { slug: 'mika', on: 1, at: 52 },
  { slug: 'manon', on: 0, at: 74 },
]
const Betting: MockScene = ({ f }) => (
  <>
    {[0, 1].map((side) => {
      const n = BETS.filter((b) => b.on === side && f >= b.at + 14).length
      return (
        <Pop key={side} f={f} at={2 + side * 5} style={{ position: 'absolute', left: side ? 380 : 40, top: 20 }}>
          <Panel bg={side ? '#d3f3fd' : '#ffd0da'} radius={36} style={{ width: 300, height: 330, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Avatar slug={side ? 'cycy' : 'kevin'} expression="cool" size={150} />
            <div style={{ fontSize: 44, lineHeight: 1 }}>{side ? 'Cycy' : 'Keke'}</div>
            <Pill bg={C.sun} size={34} style={{ transform: `scale(${1 + 0.25 * Math.max(0, ...BETS.filter((b) => b.on === side).map((b) => 1 - Math.abs(f - b.at - 16) / 6))})` }}>🪙 × {n}</Pill>
          </Panel>
        </Pop>
      )
    })}
    {BETS.map((b, k) => {
      const x = 40 + k * 222
      const p = easeInOut(ramp(f, b.at, b.at + 14))
      const tx = b.on ? 530 : 190
      return (
        <React.Fragment key={b.slug}>
          <div style={{ position: 'absolute', left: x, top: 590 + (1 - sp(f, 10 + k * 4)) * 400 + bob(f, k * 10, f >= b.at ? 22 : 8, 22), transform: `rotate(${wiggle(f, k * 8, 3)}deg)` }}>
            <Chibi slug={b.slug} expression={f >= b.at ? 'joie' : 'reflexion'} size={200} />
          </div>
          {f >= b.at && p < 1 && (
            <div style={{ position: 'absolute', left: lerp(x + 70, tx, p), top: lerp(600, 290, p) - Math.sin(p * Math.PI) * 120, fontSize: 64, lineHeight: 1 }}>🪙</div>
          )}
          <Sfx name="swoosh-up" at={b.at + 8} volume={0.4} />
          <Sfx name="pop" at={b.at + 22} volume={0.5} />
        </React.Fragment>
      )
    })}
    <Pop f={f} at={34} rot={-3} style={{ position: 'absolute', left: 60, top: 470 }}>
      <Bubble size={36} bg={C.sun}>Je parie sur Keke !</Bubble>
    </Pop>
  </>
)

export const morpion: TutoSpec = {
  id: 'morpion',
  name: 'Morpion',
  emoji: '❌',
  color: '#FFB703',
  players: '2 à 9 joueurs',
  goal: 'Aligne 3 symboles avant ton adversaire !',
  cast: ['kevin', 'cycy', 'dede', 'mika'],
  steps: [
    { text: 'Un duel : deux joueurs s’affrontent', seconds: 4.6, Mock: Versus },
    { text: 'Chacun son tour, touche une case pour poser ton symbole', seconds: 5.6, Mock: Placing },
    { text: 'Aligne 3 symboles : en ligne, en colonne ou en diagonale', seconds: 5.4, Mock: Aligning },
    { text: 'Les autres regardent… et parient sur le vainqueur !', seconds: 5.2, Mock: Betting },
  ],
  win: {
    text: 'Le premier qui aligne ses symboles gagne le duel !',
    sub: 'Existe aussi en Géant (aligne-en 5) et en Ultime (9 petits morpions).',
    winners: ['kevin'],
  },
}
