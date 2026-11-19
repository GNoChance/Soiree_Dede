// Tuto « Échecs » (duel). Plateau simplifié au look du vrai (cases crème / turquoise, pièces SVG maison).
// Nini porte la tenue Grand Maître (`chess`) dans toute la vidéo ; Keke et les spectateurs restent en tenue par défaut.
import React from 'react'
import { C, sticker } from '../../theme'
import { Avatar, Chibi, ConfettiBurst, Finger, Outlined, Panel, Pill, Pop, Sfx, TW, bob, clamp01, easeInOut, lerp, ramp, sp, type Tap } from '../kit'
import { makeBetting, makeVersus } from '../parts'
import type { MockScene, TutoSpec } from '../types'

const OUTFIT = 'chess'
const INK = '#1f1b2e'
const LIGHT = '#f6e7c1'
const DARK = '#5fb3a6'
const FRAME = '#2a9d8f'
const S = 72
const BOARD = S * 8
const BX = (TW - BOARD) / 2

// --- Pièces (mêmes silhouettes que src/games/echecs/Piece.tsx) ------------------------------
const FILL = { w: '#fff4d6', b: '#3d3358' }
const SHINE = { w: '#ffffff', b: '#7a6aa8' }
const DETAIL = { w: '#c9a96a', b: '#a99ad6' }
const BASE = 'M 22 74 L 78 74 Q 82 74 82 79 L 82 84 Q 82 89 77 89 L 23 89 Q 18 89 18 84 L 18 79 Q 18 74 22 74 Z'
const SHAPES: Record<string, { body: string[]; dots?: Array<[number, number, number]>; lines?: string[]; eye?: [number, number] }> = {
  p: { body: ['M 36 74 C 36 62 40 54 44 50 C 36 46 34 36 40 29 C 46 22 54 22 60 29 C 66 36 64 46 56 50 C 60 54 64 62 64 74 Z', BASE] },
  r: {
    body: ['M 31 74 L 34 44 L 66 44 L 69 74 Z', 'M 26 44 L 26 18 L 37 18 L 37 27 L 45 27 L 45 18 L 55 18 L 55 27 L 63 27 L 63 18 L 74 18 L 74 44 Z', BASE],
    lines: ['M 34 58 L 66 58'],
  },
  n: {
    body: ['M 30 74 C 30 64 36 58 44 52 C 38 52 32 54 26 56 C 18 58 14 50 18 44 C 24 34 30 26 38 20 L 38 10 L 46 17 C 60 18 72 30 74 48 C 76 58 74 66 72 74 Z', BASE],
    lines: ['M 52 22 C 62 28 66 38 66 50'],
    eye: [40, 30],
  },
  b: {
    body: ['M 34 74 C 30 64 32 54 40 48 L 60 48 C 68 54 70 64 66 74 Z', 'M 50 14 C 64 24 68 36 60 48 L 40 48 C 32 36 36 24 50 14 Z', BASE],
    dots: [[50, 11, 6]],
    lines: ['M 55 24 L 46 36'],
  },
  q: {
    body: ['M 30 74 L 18 32 L 36 52 L 34 22 L 47 48 L 50 16 L 53 48 L 66 22 L 64 52 L 82 32 L 70 74 Z', BASE],
    dots: [[18, 30, 6], [34, 20, 6], [50, 13, 6.5], [66, 20, 6], [82, 30, 6]],
    lines: ['M 30 64 L 70 64'],
  },
  k: {
    body: ['M 46 6 L 54 6 L 54 14 L 62 14 L 62 22 L 54 22 L 54 34 L 46 34 L 46 22 L 38 22 L 38 14 L 46 14 Z', 'M 30 74 C 22 62 20 50 26 42 C 32 34 44 34 50 44 C 56 34 68 34 74 42 C 80 50 78 62 70 74 Z', BASE],
    lines: ['M 30 64 L 70 64'],
  },
}

const PieceSvg: React.FC<{ piece: string; size: number }> = ({ piece, size }) => {
  const side = piece === piece.toUpperCase() ? 'w' : 'b'
  const shape = SHAPES[piece.toLowerCase()]
  const all = (
    <>
      {shape.body.map((d, i) => <path key={i} d={d} />)}
      {shape.dots?.map(([cx, cy, r], i) => <circle key={`d${i}`} cx={cx} cy={cy} r={r} />)}
    </>
  )
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} style={{ display: 'block', overflow: 'visible' }}>
      <g transform="translate(4 4)" fill={INK} stroke={INK} strokeWidth={5} strokeLinejoin="round">{all}</g>
      <g fill={FILL[side]} stroke={INK} strokeWidth={5} strokeLinejoin="round" strokeLinecap="round">{all}</g>
      <path d="M 36 70 C 34 62 36 56 40 52" stroke={SHINE[side]} strokeWidth="4" strokeLinecap="round" fill="none" opacity={side === 'w' ? 0.9 : 0.7} />
      {shape.lines?.map((d, i) => <path key={`l${i}`} d={d} stroke={DETAIL[side]} strokeWidth="4" strokeLinecap="round" fill="none" />)}
      {shape.eye && <circle cx={shape.eye[0]} cy={shape.eye[1]} r="4.5" fill={INK} />}
    </svg>
  )
}

// --- Position -----------------------------------------------------------------------------
type Pc = { p: string; sq: string }
const START = 'RNBQKBNR'
const startPieces = (): Pc[] => {
  const out: Pc[] = []
  for (let c = 0; c < 8; c++) {
    const f = 'abcdefgh'[c]
    out.push({ p: START[c], sq: f + 1 }, { p: 'P', sq: f + 2 }, { p: 'p', sq: f + 7 }, { p: START[c].toLowerCase(), sq: f + 8 })
  }
  return out
}
/** Position de départ + coups déjà joués (« e2e4 », …). */
const position = (played: string[] = []): Pc[] => {
  let ps = startPieces()
  for (const m of played) {
    const from = m.slice(0, 2)
    const to = m.slice(2, 4)
    ps = ps.filter((x) => x.sq !== to)
    ps = ps.map((x) => (x.sq === from ? { ...x, sq: to } : x))
  }
  return ps
}
const col = (sq: string) => sq.charCodeAt(0) - 97
const row = (sq: string) => 8 - Number(sq[1])
const sqXY = (sq: string) => ({ x: BX + col(sq) * S, y: row(sq) * S })

type Anim = { from: string; to: string; at: number; len?: number; arc?: number }
type Mark = { sq: string; kind: 'dot' | 'ring' }

type BoardProps = {
  f: number
  top: number
  pieces: Pc[]
  anims?: Anim[]
  /** Pièce soulevée (touchée) entre `at` et `until`. */
  sel?: { sq: string; at: number; until: number }
  marks?: Mark[]
  marksAt?: number
  marksUntil?: number
  check?: { sq: string; at: number }
  lieAt?: { sq: string; at: number }
}

const Board: React.FC<BoardProps> = ({ f, top, pieces, anims = [], sel, marks = [], marksAt = 0, marksUntil = 9999, check, lieAt }) => {
  const i = sp(f, 0)
  const showMarks = f >= marksAt && f < marksUntil
  const mk = clamp01((f - marksAt) / 6)
  return (
    <div style={{ position: 'absolute', left: 0, top, width: TW, height: BOARD, transform: `scale(${0.75 + 0.25 * i})`, opacity: clamp01(i * 2) }}>
      <div style={{ position: 'absolute', left: BX - 14, top: -14, width: BOARD + 28, height: BOARD + 28, borderRadius: 26, background: FRAME, border: `5px solid ${C.ink}`, boxShadow: sticker(8), boxSizing: 'border-box' }} />
      {Array.from({ length: 64 }, (_, k) => {
        const c = k % 8
        const r = Math.floor(k / 8)
        const dark = (c + (7 - r)) % 2 === 0
        const sq = 'abcdefgh'[c] + (8 - r)
        const isSel = sel && sel.sq === sq && f >= sel.at && f < sel.until
        const isCheck = check && check.sq === sq && f >= check.at
        const pulse = isCheck ? 0.55 + 0.25 * Math.sin((f - check!.at) / 3) : 0
        return (
          <div key={k} style={{ position: 'absolute', left: BX + c * S, top: r * S, width: S, height: S, background: dark ? DARK : LIGHT }}>
            {isSel && <div style={{ position: 'absolute', inset: 0, background: '#ffb703b3', boxShadow: 'inset 0 0 0 4px #ffb703' }} />}
            {isCheck && <div style={{ position: 'absolute', inset: 0, background: C.tomato, opacity: pulse }} />}
          </div>
        )
      })}
      {pieces.map((pc) => {
        const a = anims.find((x) => x.from === pc.sq)
        const captured = anims.find((x) => x.to === pc.sq && f >= x.at + (x.len ?? 14) * 0.6)
        if (captured) return null
        const base = sqXY(pc.sq)
        let x = base.x
        let y = base.y
        let lift = 0
        if (a) {
          const t = easeInOut(ramp(f, a.at, a.at + (a.len ?? 14)))
          const to = sqXY(a.to)
          x = lerp(base.x, to.x, t)
          y = lerp(base.y, to.y, t) - Math.sin(t * Math.PI) * (a.arc ?? 0)
        }
        if (sel && sel.sq === pc.sq && f >= sel.at && f < sel.until) lift = ramp(f, sel.at, sel.at + 5)
        const lie = lieAt && lieAt.sq === pc.sq && f >= lieAt.at ? easeInOut(ramp(f, lieAt.at, lieAt.at + 10)) : 0
        return (
          <div key={`${pc.p}${pc.sq}`} style={{ position: 'absolute', left: x, top: y - lift * 8, width: S, height: S, zIndex: a || lift ? 5 : 2, transform: `scale(${1 + 0.1 * lift}) rotate(${lie * 90}deg)`, transformOrigin: '50% 80%' }}>
            <PieceSvg piece={pc.p} size={S} />
          </div>
        )
      })}
      {showMarks && marks.map((m) => {
        const { x, y } = sqXY(m.sq)
        return m.kind === 'dot' ? (
          <div key={m.sq} style={{ position: 'absolute', left: x + S * 0.33, top: y + S * 0.33, width: S * 0.34, height: S * 0.34, borderRadius: '50%', background: '#1f1b2e66', transform: `scale(${mk})`, zIndex: 6 }} />
        ) : (
          <div key={m.sq} style={{ position: 'absolute', left: x + S * 0.04, top: y + S * 0.04, width: S * 0.92, height: S * 0.92, borderRadius: '50%', border: `5px solid #1f1b2e8c`, boxSizing: 'border-box', transform: `scale(${mk})`, zIndex: 6 }} />
        )
      })}
    </div>
  )
}

const tapSq = (sq: string, at: number, top: number): Tap => ({ at, x: sqXY(sq).x + S / 2, y: top + sqXY(sq).y + S / 2 })
const mm = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

// --- 1 — Duel avec pendules ----------------------------------------------------------------
const Clock: React.FC<{ f: number; secs: number; on: boolean; bg: string }> = ({ f, secs, on, bg }) => (
  <Panel bg={bg} radius={26} shadow={on ? 6 : 4} style={{ padding: '8px 22px 2px', fontSize: 54, lineHeight: 1.1, transform: `scale(${on ? 1.06 + 0.02 * Math.sin(f / 4) : 1})` }}>
    ⏱️ {mm(secs)}
  </Panel>
)

const nini = { slug: 'nini' as const, name: 'Nini', tint: '#d7f7da', outfit: OUTFIT }
const keke = { slug: 'kevin' as const, name: 'Keke', tint: '#d3f3fd' }
const VersusBase = makeVersus(
  { a: nini, b: keke, tokenA: <PieceSvg piece="K" size={120} />, tokenB: <PieceSvg piece="k" size={120} /> },
  '⚪ Nini a les Blancs',
)
const Versus: MockScene = ({ f, dur }) => {
  const run = Math.max(0, Math.floor((f - 70) / 10))
  return (
    <>
      <VersusBase f={f} dur={dur} />
      <Pop f={f} at={36} rot={-3} style={{ position: 'absolute', left: 40, top: 450 }}><Clock f={f} secs={300 - run} on={f >= 70} bg={C.surface} /></Pop>
      <Pop f={f} at={42} rot={3} style={{ position: 'absolute', right: 40, top: 628 }}><Clock f={f} secs={300} on={false} bg={C.surface} /></Pop>
    </>
  )
}

// --- 2 — Toucher une pièce, puis la case ---------------------------------------------------
const T2 = 108
const Header: React.FC<{ f: number; turn: 'w' | 'b'; w: number; b: number }> = ({ f, turn, w, b }) => (
  <div style={{ position: 'absolute', left: 0, right: 0, top: 0, display: 'flex', justifyContent: 'center', gap: 24 }}>
    {(['w', 'b'] as const).map((s) => {
      const on = turn === s
      return (
        <Panel key={s} bg={on ? C.sun : C.surface} radius={26} shadow={on ? 6 : 3}
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 18px 6px 8px', fontSize: 34, transform: `scale(${on ? 1.04 : 0.94})`, opacity: on ? 1 : 0.75 }}>
          <Avatar slug={s === 'w' ? 'nini' : 'kevin'} expression="joie" size={64} outfit={s === 'w' ? OUTFIT : undefined} />
          <div style={{ fontVariantNumeric: 'tabular-nums' }}>{s === 'w' ? '⚪' : '⚫'} {mm(s === 'w' ? w : b)}</div>
        </Panel>
      )
    })}
  </div>
)

const TOP = 104
const Touch: MockScene = ({ f }) => {
  const turn = f < 66 ? 'w' : f < 90 ? 'b' : 'w'
  const wSecs = 300 - Math.floor(Math.min(f, 66) / 14) - (f > 90 ? Math.floor((f - 90) / 14) : 0)
  const bSecs = 300 - (f > 66 ? Math.floor((Math.min(f, 90) - 66) / 14) : 0)
  const anims: Anim[] = [
    { from: 'e2', to: 'e4', at: 54, len: 12 },
    { from: 'e7', to: 'e5', at: 78, len: 12 },
    { from: 'g1', to: 'f3', at: 140, len: 16, arc: 36 },
  ]
  const marks: Mark[] = f < 90
    ? [{ sq: 'e3', kind: 'dot' }, { sq: 'e4', kind: 'dot' }]
    : [{ sq: 'e2', kind: 'dot' }, { sq: 'f3', kind: 'dot' }, { sq: 'h3', kind: 'dot' }]
  const sel = f < 90 ? { sq: 'e2', at: 24, until: 54 } : { sq: 'g1', at: T2 + 4, until: 140 }
  const marksAt = f < 90 ? 26 : T2 + 6
  const marksUntil = f < 90 ? 54 : 140
  // la position avant le coup du pion noir doit avoir e4 joué : on la fait évoluer avec les animations
  const base = f < 70 ? position() : f < 130 ? position(['e2e4']) : position(['e2e4', 'e7e5'])
  const taps = [tapSq('e2', 24, TOP), tapSq('e4', 54, TOP), tapSq('g1', T2 + 4, TOP), tapSq('f3', 140, TOP)]
  const animsNow = anims.filter((a) => (a.from === 'e2' ? f < 70 : a.from === 'e7' ? f >= 70 && f < 130 : f >= 130))
  return (
    <>
      <Header f={f} turn={turn} w={wSecs} b={bSecs} />
      <Board f={f} top={TOP} pieces={base} anims={animsNow} sel={sel} marks={marks} marksAt={marksAt} marksUntil={marksUntil} />
      <Pop f={f} at={20} rot={-2} style={{ position: 'absolute', left: 0, right: 0, top: 706, display: 'flex', justifyContent: 'center' }}>
        <div style={{ transform: `translateY(${bob(f, 0, 8, 30)}px)` }}>
          <Panel bg={C.sky} radius={30} shadow={6} style={{ padding: '8px 30px 2px', fontSize: 38, lineHeight: 1.2 }}>❓ Les pièces</Panel>
        </div>
      </Pop>
      <Pop f={f} at={30} rot={2} style={{ position: 'absolute', left: 0, right: 0, top: 796, display: 'flex', justifyContent: 'center' }}>
        <Pill bg={C.surface} size={32}>❓ Perdu ? La fiche des pièces</Pill>
      </Pop>
      <Finger f={f} taps={taps} />
      {taps.map((t, k) => <Sfx key={k} name="tap" at={t.at + 8} volume={0.8} />)}
      <Sfx name="pop" at={54 + 10} volume={0.4} />
      <Sfx name="pop" at={140 + 12} volume={0.4} />
    </>
  )
}

// --- 3 — Échec et mat (mat du berger) ------------------------------------------------------
const PLAYED = ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6']
const QUEEN_MARKS: Mark[] = [
  { sq: 'h6', kind: 'dot' }, { sq: 'g6', kind: 'dot' }, { sq: 'g5', kind: 'dot' }, { sq: 'f5', kind: 'dot' }, { sq: 'h4', kind: 'dot' },
  { sq: 'h3', kind: 'dot' }, { sq: 'g4', kind: 'dot' }, { sq: 'f3', kind: 'dot' }, { sq: 'e2', kind: 'dot' }, { sq: 'd1', kind: 'dot' },
  { sq: 'h7', kind: 'ring' }, { sq: 'f7', kind: 'ring' }, { sq: 'e5', kind: 'ring' },
]
const TOP3 = 40
const CHECK_AT = 68
const MATE_AT = 108
const Mate: MockScene = ({ f }) => {
  const taps = [tapSq('h5', 20, TOP3), tapSq('f7', 50, TOP3)]
  const anims: Anim[] = [{ from: 'h5', to: 'f7', at: 54, len: 14, arc: 22 }]
  return (
    <>
      <Board f={f} top={TOP3} pieces={position(PLAYED)} anims={anims} sel={{ sq: 'h5', at: 20, until: 54 }} marks={QUEEN_MARKS} marksAt={22} marksUntil={54}
        check={{ sq: 'e8', at: CHECK_AT }} lieAt={{ sq: 'e8', at: MATE_AT }} />
      {f >= 30 && f < 54 && (
        <Pop f={f} at={30} rot={-3} style={{ position: 'absolute', left: 0, right: 0, top: 640, display: 'flex', justifyContent: 'center' }}>
          <Pill bg={C.surface} size={34}>⭕ = prise</Pill>
        </Pop>
      )}
      {f >= CHECK_AT && f < MATE_AT && (
        <Pop f={f} at={CHECK_AT} rot={-3} style={{ position: 'absolute', left: 0, right: 0, top: 640, display: 'flex', justifyContent: 'center' }}>
          <Outlined size={80} color={C.sun}>Échec !</Outlined>
        </Pop>
      )}
      {f >= MATE_AT && (
        <Pop f={f} at={MATE_AT} rot={-3} style={{ position: 'absolute', left: 0, right: 0, top: 640, display: 'flex', justifyContent: 'center' }}>
          <Outlined size={78} color={C.mint}>Échec et mat !</Outlined>
        </Pop>
      )}
      <div style={{ position: 'absolute', left: 16, top: 735 + bob(f, 0, f >= MATE_AT ? 20 : 4, 18) }}>
        <Chibi slug="nini" expression={f >= MATE_AT ? 'joie' : 'reflexion'} size={160} outfit={OUTFIT} />
      </div>
      <div style={{ position: 'absolute', right: 16, top: 735 }}>
        <Chibi slug="kevin" expression={f >= MATE_AT ? 'pleurs' : f >= CHECK_AT ? 'surprise' : 'reflexion'} size={160} />
      </div>
      <Finger f={f} taps={taps} />
      <ConfettiBurst f={f} at={MATE_AT} y={TOP3 + 300} seed="ec" />
      <Sfx name="tap" at={28} volume={0.8} />
      <Sfx name="tap" at={58} volume={0.8} />
      <Sfx name="pop" at={CHECK_AT} volume={0.6} />
      <Sfx name="success" at={MATE_AT + 2} volume={0.6} />
    </>
  )
}

// --- 4 — Les spectateurs parient -----------------------------------------------------------
const Betting = makeBetting({ a: nini, b: keke })

export const echecs: TutoSpec = {
  id: 'echecs',
  name: 'Échecs',
  emoji: '♟️',
  color: '#2A9D8F',
  players: '2 à 9 joueurs',
  goal: 'Mets le roi adverse échec et mat !',
  cast: ['nini', 'kevin', 'dede', 'mika', 'manon'],
  outfits: { nini: OUTFIT },
  steps: [
    { text: 'Un duel ! Les Blancs commencent, chacun a sa pendule', seconds: 4.6, Mock: Versus },
    { text: 'Touche une pièce, ses cases s’allument : touche la case !', seconds: 6, Mock: Touch },
    { text: 'Roi attaqué : échec ! Sans issue : échec et mat !', seconds: 5.8, Mock: Mate },
    { text: 'Les autres regardent… et parient sur le vainqueur !', seconds: 5.2, Mock: Betting },
  ],
  win: {
    text: 'Échec et mat : tu gagnes le duel !',
    sub: 'Pendule à zéro : perdu ! 3, 5 ou 10 min, ou sans pendule.',
    winners: ['nini'],
  },
}
