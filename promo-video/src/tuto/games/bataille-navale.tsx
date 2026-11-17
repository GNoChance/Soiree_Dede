// Tuto « Bataille navale » (duel) : grille 10 × 10, flotte de 5 bateaux (5, 4, 3, 3, 2 cases).
import React from 'react'
import { C, sticker } from '../../theme'
import { Avatar, Finger, Outlined, Panel, Pill, Pop, SPRING, Sfx, TW, clamp01, ramp, sp, type Tap } from '../kit'
import { Btn, TimerBar, makeBetting, type DuelCast } from '../parts'
import type { MockScene, TutoSpec } from '../types'

const CELL = 56
const GAP = 4
const N = 10
const BW = N * CELL + (N - 1) * GAP
const BX = (TW - BW) / 2
const STEP = CELL + GAP
const SEA = '#bfe9fb'

type Ship = { x: number; y: number; len: number; dir: 'h' | 'v' }
const ShipShape: React.FC<{ s: Ship; scale?: number; sunk?: boolean }> = ({ s, scale = 1, sunk }) => {
  const w = (s.dir === 'h' ? s.len : 1) * STEP - GAP
  const h = (s.dir === 'v' ? s.len : 1) * STEP - GAP
  return (
    <div
      style={{
        position: 'absolute', left: s.x * STEP + 4, top: s.y * STEP + 4, width: w - 8, height: h - 8, borderRadius: 24, boxSizing: 'border-box',
        background: sunk ? C.tomato : '#8d99ae', border: `4px solid ${C.ink}`, boxShadow: sticker(3), transform: `scale(${scale})`,
        display: 'flex', flexDirection: s.dir === 'h' ? 'row' : 'column', alignItems: 'center', justifyContent: 'space-around',
      }}
    >
      {Array.from({ length: s.len }, (_, k) => <div key={k} style={{ width: 14, height: 14, borderRadius: '50%', background: sunk ? '#ffd0da' : '#edf2f4', border: `3px solid ${C.ink}`, boxSizing: 'border-box' }} />)}
    </div>
  )
}

type Shot = { x: number; y: number; r: 'miss' | 'hit'; at: number }
const Grid: React.FC<{ f: number; top: number; children?: React.ReactNode; shots?: Shot[] }> = ({ f, top, children, shots = [] }) => {
  const i = sp(f, 0, SPRING.snappy)
  return (
    <div style={{ position: 'absolute', left: BX, top, width: BW, height: BW, transform: `scale(${0.7 + 0.3 * i})`, opacity: clamp01(i * 2) }}>
      <div style={{ position: 'absolute', left: -16, top: -16, width: BW + 32, height: BW + 32, borderRadius: 30, background: '#3A86FF', border: `5px solid ${C.ink}`, boxShadow: sticker(9), boxSizing: 'border-box' }} />
      {Array.from({ length: N * N }, (_, k) => (
        <div key={k} style={{ position: 'absolute', left: (k % N) * STEP, top: Math.floor(k / N) * STEP, width: CELL, height: CELL, borderRadius: 10, background: SEA }} />
      ))}
      {children}
      {shots.map((s, k) => {
        if (f < s.at) return null
        const p = sp(f, s.at, SPRING.pop)
        return (
          <div key={k} style={{ position: 'absolute', left: s.x * STEP, top: s.y * STEP, width: CELL, height: CELL, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${p})`, zIndex: 3 }}>
            {s.r === 'miss'
              ? <div style={{ width: 26, height: 26, borderRadius: '50%', background: C.surface, border: `4px solid ${C.ink}`, boxSizing: 'border-box' }} />
              : <div style={{ fontSize: 44, lineHeight: 1 }}>💥</div>}
          </div>
        )
      })}
    </div>
  )
}
const cellTap = (x: number, y: number, top: number, at: number): Tap => ({ at, x: BX + x * STEP + CELL / 2, y: top + y * STEP + CELL / 2 })

// 1 — Placement secret de la flotte (mélange, puis pivot d'un bateau)
const FLEET_A: Ship[] = [
  { x: 1, y: 1, len: 5, dir: 'h' }, { x: 7, y: 3, len: 4, dir: 'v' }, { x: 2, y: 4, len: 3, dir: 'h' }, { x: 0, y: 7, len: 3, dir: 'v' }, { x: 5, y: 8, len: 2, dir: 'h' },
]
const FLEET_B: Ship[] = [
  { x: 8, y: 0, len: 5, dir: 'v' }, { x: 1, y: 2, len: 4, dir: 'h' }, { x: 3, y: 5, len: 3, dir: 'v' }, { x: 6, y: 7, len: 3, dir: 'h' }, { x: 0, y: 6, len: 2, dir: 'v' },
]
const P_TOP = 64
const SHUFFLE_AT = 52
const TURN_AT = 100
const READY_AT = 140
const Placing: MockScene = ({ f, dur }) => {
  const second = f >= SHUFFLE_AT + 5
  const fleet = (second ? FLEET_B : FLEET_A).map((s, k) => (k === 4 && f >= TURN_AT + 4 ? { ...s, dir: 'h' as const } : s))
  return (
    <>
      <div style={{ position: 'absolute', left: BX, top: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ fontSize: 36, lineHeight: 1 }}>⏱️</div>
        <TimerBar p={ramp(f, 0, dur) * 0.5} width={BW - 52} height={30} />
      </div>
      <Grid f={f} top={P_TOP}>
        {fleet.map((s, k) => {
          const pop = second ? sp(f, SHUFFLE_AT + 5 + k * 2) : sp(f, 6 + k * 4) * (1 - ramp(f, SHUFFLE_AT, SHUFFLE_AT + 5))
          const turn = k === 4 && f >= TURN_AT + 4 ? 0.7 + 0.3 * sp(f, TURN_AT + 4) : 1
          return <ShipShape key={k} s={s} scale={pop * turn} />
        })}
      </Grid>
      <div style={{ position: 'absolute', left: 40, top: 716 }}>
        <Pop f={f} at={10}><Btn bg={C.sun} size={40} w={290} h={96} pressed={f >= SHUFFLE_AT && f < SHUFFLE_AT + 8}>🎲 Mélanger</Btn></Pop>
      </div>
      <div style={{ position: 'absolute', left: 390, top: 716 }}>
        <Pop f={f} at={14}><Btn bg={C.mint} size={40} w={290} h={96} pressed={f >= READY_AT && f < READY_AT + 8}>✅ Prêt !</Btn></Pop>
      </div>
      <Pop f={f} at={TURN_AT + 10} rot={-2} style={{ position: 'absolute', left: 130, top: P_TOP + 8 * STEP + 22 }}>
        <Pill bg={C.surface} size={30}>👆 Touche un bateau : il pivote</Pill>
      </Pop>
      <Finger f={f} taps={[{ at: SHUFFLE_AT - 6, x: 190, y: 770 }, { at: TURN_AT - 4, x: BX + 28, y: P_TOP + 6 * STEP + 50 }, { at: READY_AT - 6, x: 540, y: 770 }]} />
      <Sfx name="tap" at={SHUFFLE_AT + 2} volume={0.8} />
      <Sfx name="whoosh" at={SHUFFLE_AT + 6} volume={0.4} />
      <Sfx name="tap" at={TURN_AT + 4} volume={0.8} />
      <Sfx name="pop" at={READY_AT + 4} volume={0.6} />
    </>
  )
}

const Turn: React.FC<{ f: number; who: 'a' | 'b' }> = ({ f, who }) => (
  <div style={{ position: 'absolute', left: 0, right: 0, top: 0, display: 'flex', justifyContent: 'center' }}>
    <Panel bg={who === 'a' ? '#d6e6ff' : '#ffd9e2'} radius={28} shadow={6} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '8px 26px 8px 10px', fontSize: 38, transform: `scale(${1 + 0.03 * Math.sin(f / 4)})` }}>
      <Avatar slug={who === 'a' ? 'marius' : 'cecile'} expression={who === 'a' ? 'reflexion' : 'joie'} size={84} />
      <div>{who === 'a' ? '🎯 Marius tire' : '🎯 À Cécile de tirer'}</div>
    </Panel>
  </div>
)

// 2 — Un tir dans l'eau : la main passe
const S_TOP = 128
const OLD: Shot[] = [{ x: 2, y: 1, r: 'miss', at: -99 }, { x: 7, y: 8, r: 'miss', at: -99 }, { x: 1, y: 6, r: 'miss', at: -99 }]
const MISS_AT = 44
const Shooting: MockScene = ({ f }) => (
  <>
    <Turn f={f} who={f < MISS_AT + 44 ? 'a' : 'b'} />
    <Grid f={f} top={S_TOP} shots={[...OLD, { x: 6, y: 5, r: 'miss', at: MISS_AT }]} />
    <Pop f={f} at={MISS_AT + 4} rot={-5} style={{ position: 'absolute', left: 0, right: 0, top: 780, display: 'flex', justifyContent: 'center' }}>
      <Outlined size={84} color={C.sky}>💦 À l’eau !</Outlined>
    </Pop>
    <Finger f={f} taps={[cellTap(6, 5, S_TOP, MISS_AT - 8)]} />
    <Sfx name="tap" at={MISS_AT} volume={0.8} />
    <Sfx name="whoosh" at={MISS_AT + 4} volume={0.5} />
    <Sfx name="pop" at={MISS_AT + 48} volume={0.5} />
  </>
)

// 3 — Touché, touché… coulé : on rejoue à chaque fois
const HITS: Shot[] = [{ x: 4, y: 3, r: 'hit', at: 26 }, { x: 5, y: 3, r: 'hit', at: 62 }, { x: 6, y: 3, r: 'hit', at: 98 }]
const SUNK_AT = 104
const Hitting: MockScene = ({ f }) => {
  const label = f < 26 ? null : f < 62 ? ['Touché !', 26] as const : f < SUNK_AT ? ['Encore touché !', 62] as const : ['Coulé !', SUNK_AT] as const
  return (
    <>
      <Turn f={f} who="a" />
      <Grid f={f} top={S_TOP} shots={[...OLD, { x: 6, y: 5, r: 'miss', at: -99 }, ...HITS]}>
        {f >= SUNK_AT && <ShipShape s={{ x: 4, y: 3, len: 3, dir: 'h' }} sunk scale={sp(f, SUNK_AT)} />}
      </Grid>
      {label && (
        <Pop key={label[0]} f={f} at={label[1] + 4} rot={-5} style={{ position: 'absolute', left: 0, right: 0, top: 776, display: 'flex', justifyContent: 'center' }}>
          <Outlined size={84} color={label[0] === 'Coulé !' ? C.tomato : C.sun}>💥 {label[0]}</Outlined>
        </Pop>
      )}
      <Pop f={f} at={40} rot={3} style={{ position: 'absolute', left: 392, top: S_TOP + 5 * STEP }}>
        <Pill bg={C.mint} size={34}>🔁 Tu rejoues !</Pill>
      </Pop>
      <Finger f={f} taps={HITS.map((s) => cellTap(s.x, s.y, S_TOP, s.at - 8))} />
      {HITS.map((s, k) => <Sfx key={k} name="tap" at={s.at} volume={0.8} />)}
      {HITS.map((s, k) => <Sfx key={`p${k}`} name="pop" at={s.at + 4} volume={0.7} />)}
      <Sfx name="success" at={SUNK_AT + 6} volume={0.5} />
    </>
  )
}

const DUEL: DuelCast = {
  a: { slug: 'marius', name: 'Marius', tint: '#d6e6ff' },
  b: { slug: 'cecile', name: 'Cécile', tint: '#ffd9e2' },
}

export const batailleNavale: TutoSpec = {
  id: 'bataille-navale',
  name: 'Bataille navale',
  emoji: '🚢',
  color: '#3A86FF',
  players: '2 à 9 joueurs',
  goal: 'Coule toute la flotte adverse !',
  cast: ['marius', 'cecile', 'dede', 'mika'],
  steps: [
    { text: 'Un duel ! En 60 s, place tes 5 bateaux en secret', seconds: 6, Mock: Placing },
    { text: 'Chacun son tour, tire sur une case de la grille adverse', seconds: 4.8, Mock: Shooting },
    { text: 'Touché ou coulé ? Tu rejoues !', seconds: 5.6, Mock: Hitting },
    { text: 'Les autres regardent les deux grilles… et parient !', seconds: 5, Mock: makeBetting(DUEL) },
  ],
  win: {
    text: 'Le premier qui coule toute la flotte adverse gagne !',
    sub: 'Tu as 30 s par tir.',
    winners: ['marius'],
  },
}
