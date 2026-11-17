// Tuto « Bowling » : piste stylisée vue de derrière la boule (le vrai jeu est en 3D).
import React from 'react'
import { random } from 'remotion'
import { C, sticker, type Slug } from '../../theme'
import { Avatar, ConfettiBurst, Outlined, Panel, Pill, Pop, SPRING, Sfx, TW, clamp01, easeInOut, lerp, ramp, sp } from '../kit'
import { Phone } from '../parts'
import type { MockScene, TutoSpec } from '../types'

// Piste en perspective dans un cadre 720 × 640. t = 0 (devant) → 1 (quilles).
const LW = 720
const LH = 640
const laneY = (t: number) => lerp(540, 120, t)
const laneS = (t: number) => lerp(1, 0.42, t)
const PINS: [number, number][] = [[0, 0], [-1, 1], [1, 1], [-2, 2], [0, 2], [2, 2], [-3, 3], [-1, 3], [1, 3], [3, 3]]

const Pin: React.FC<{ s?: number }> = ({ s = 1 }) => (
  <div style={{ width: 26 * s, height: 58 * s, borderRadius: `${13 * s}px ${13 * s}px ${9 * s}px ${9 * s}px`, background: '#ffffff', border: `${Math.max(2, 3 * s)}px solid ${C.ink}`, boxSizing: 'border-box', position: 'relative', overflow: 'hidden' }}>
    <div style={{ position: 'absolute', left: 0, right: 0, top: '26%', height: '16%', background: C.tomato }} />
  </div>
)
const Ball: React.FC<{ size: number; spin?: number }> = ({ size, spin = 0 }) => (
  <div style={{ width: size, height: size, borderRadius: '50%', background: `radial-gradient(circle at 35% 30%, #b79bff, ${C.grape} 55%, #5b34c4)`, border: `${Math.max(3, size * 0.05)}px solid ${C.ink}`, boxSizing: 'border-box', position: 'relative', transform: `rotate(${spin}deg)` }}>
    {[[38, 26], [56, 30], [46, 46]].map(([x, y], k) => <div key={k} style={{ position: 'absolute', left: `${x}%`, top: `${y}%`, width: '11%', height: '11%', borderRadius: '50%', background: C.ink }} />)}
  </div>
)

type LaneProps = { f: number; ballX?: number; ballT?: number; hitAt?: number; hidePins?: boolean; spin?: number; children?: React.ReactNode }
const Lane: React.FC<LaneProps> = ({ f, ballX = 0, ballT = 0, hitAt, spin = 0, children }) => {
  const s = laneS(ballT)
  const size = 120 * s
  return (
    <div style={{ position: 'relative', width: LW, height: LH }}>
      <svg width={LW} height={LH} viewBox={`0 0 ${LW} ${LH}`} style={{ position: 'absolute', left: 0, top: 0 }}>
        <polygon points="250,60 470,60 690,630 30,630" fill="#3b3560" stroke={C.ink} strokeWidth={6} strokeLinejoin="round" />
        <polygon points="274,60 446,60 620,630 100,630" fill="#f6cf85" stroke={C.ink} strokeWidth={6} strokeLinejoin="round" />
        {[-2, -1, 0, 1, 2].map((k) => <line key={k} x1={360 + k * 28} y1={60} x2={360 + k * 86} y2={630} stroke="#d9a955" strokeWidth={3} />)}
        {[-2, -1, 0, 1, 2].map((k) => <polygon key={`a${k}`} points={`${360 + k * 62},400 ${352 + k * 62},430 ${368 + k * 62},430`} fill="#b9822f" />)}
      </svg>
      {PINS.map(([px, row], k) => {
        const ps = 0.5 + (3 - row) * 0.045
        const x = 360 + px * 20 * (1 - row * 0.03)
        const y = 132 - row * 13
        let dx = 0, dy = 0, rot = 0, op = 1
        if (hitAt !== undefined && f >= hitAt + row * 1.5) {
          const u = f - hitAt - row * 1.5
          dx = (random(`px${k}`) - 0.5 + px * 0.12) * 26 * u
          dy = -random(`py${k}`) * 9 * u + 0.5 * u * u
          rot = (random(`pr${k}`) - 0.5) * 60 * u
          op = 1 - ramp(u, 14, 26)
        }
        return (
          <div key={k} style={{ position: 'absolute', left: x - 13 * ps + dx, top: y - 58 * ps + dy, zIndex: 10 - row, transform: `rotate(${rot}deg)`, opacity: op }}>
            <Pin s={ps} />
          </div>
        )
      })}
      {(hitAt === undefined || f < hitAt + 4) && (
        <div style={{ position: 'absolute', left: 360 + ballX * s - size / 2, top: laneY(ballT) - size / 2, zIndex: 12 }}>
          <Ball size={size} spin={spin} />
        </div>
      )}
      {children}
    </div>
  )
}
const Dot: React.FC<{ x: number; y: number; on: number; press?: boolean }> = ({ x, y, on, press }) => (
  <div style={{ position: 'absolute', left: x - 32, top: y - 32, width: 64, height: 64, borderRadius: '50%', background: 'rgba(255,255,255,0.85)', border: `5px solid ${C.ink}`, boxSizing: 'border-box', boxShadow: sticker(press ? 1 : 5), opacity: on, zIndex: 40 }} />
)

// 1 — Chacun sa piste
const SOLO: { slug: Slug; name: string; d: number }[] = [{ slug: 'dede', name: 'Dédé', d: 0 }, { slug: 'kevin', name: 'Keke', d: 22 }, { slug: 'cycy', name: 'Cycy', d: 44 }]
const Everyone: MockScene = ({ f }) => (
  <>
    {SOLO.map((p, k) => {
      const t = easeInOut(ramp(f, 30 + p.d, 62 + p.d))
      return (
        <Pop key={p.slug} f={f} at={k * 6} from={80} rot={(k - 1) * 3} style={{ position: 'absolute', left: 22 + k * 232, top: 30 + (k % 2) * 40 }}>
          <Phone w={214} h={420} bg="#2a2458">
            <div style={{ position: 'absolute', left: -6, top: 60, transform: 'scale(0.3)', transformOrigin: '0 0' }}>
              <Lane f={f} ballT={t} ballX={(k - 1) * 30} hitAt={62 + p.d} />
            </div>
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 20, display: 'flex', justifyContent: 'center' }}>
              <Pill bg={C.sun} size={24}>{f >= 66 + p.d ? (k === 1 ? 'STRIKE !' : k ? '8 quilles' : '7 quilles') : 'À toi !'}</Pill>
            </div>
          </Phone>
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}><Avatar slug={p.slug} expression={f >= 66 + p.d ? 'joie' : 'gamer'} size={120} /></div>
        </Pop>
      )
    })}
    <div style={{ position: 'absolute', left: 0, right: 0, top: 700, display: 'flex', justifyContent: 'center' }}>
      <Pop f={f} at={40} rot={-2}><Pill bg={C.surface} size={36}>📱 Pas besoin d’attendre son tour !</Pill></Pop>
    </div>
    {SOLO.map((p, k) => <Sfx key={k} name="pop" at={70 + p.d} volume={0.6} />)}
  </>
)

// 2 — Se placer
const Placing: MockScene = ({ f }) => {
  const drag = ramp(f, 26, 120)
  const x = f < 26 ? 0 : Math.sin(drag * Math.PI * 2) * 170 * (1 - drag * 0.3)
  const on = ramp(f, 12, 20) * (1 - ramp(f, 124, 132))
  return (
    <>
      <div style={{ position: 'absolute', left: 0, top: 30 }}>
        <Lane f={f} ballX={x}>
          <Dot x={360 + x + 14} y={560} on={on} press={f >= 26 && f < 122} />
        </Lane>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 720, display: 'flex', justifyContent: 'center' }}>
        <Pop f={f} at={16}><Outlined size={110} color={C.sun}>⬅ ➡</Outlined></Pop>
      </div>
      <Sfx name="tap" at={26} volume={0.8} />
    </>
  )
}

// 3 — Lancer
const SWIPE0 = 30
const SWIPE1 = 48
const HIT = 86
const Throwing: MockScene = ({ f }) => {
  const sw = easeInOut(ramp(f, SWIPE0, SWIPE1))
  const roll = ramp(f, SWIPE1 - 2, HIT)
  const curve = Math.sin(roll * Math.PI) * 150 - roll * 30
  const fx = 400 + sw * 60 - Math.sin(sw * Math.PI) * 90
  const fy = 570 - sw * 300
  const on = ramp(f, 14, 22) * (1 - ramp(f, SWIPE1 + 4, SWIPE1 + 12))
  return (
    <>
      <div style={{ position: 'absolute', left: 0, top: 30 }}>
        <Lane f={f} ballX={40 + curve} ballT={roll} hitAt={HIT} spin={roll * 900}>
          {f >= SWIPE0 && f < SWIPE1 + 30 && (
            <svg width={LW} height={LH} style={{ position: 'absolute', left: 0, top: 0, opacity: 1 - ramp(f, SWIPE1 + 10, SWIPE1 + 30), zIndex: 30 }}>
              <path d="M400 570 C 300 480, 330 360, 460 270" fill="none" stroke={C.ink} strokeWidth={22} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - sw} />
              <path d="M400 570 C 300 480, 330 360, 460 270" fill="none" stroke={C.sun} strokeWidth={12} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - sw} />
            </svg>
          )}
          <Dot x={fx} y={fy} on={on} press={f >= SWIPE0 && f < SWIPE1} />
        </Lane>
      </div>
      <Pop f={f} at={SWIPE1 + 4} rot={-4} style={{ position: 'absolute', left: 30, top: 300 }}><Pill bg={C.sun} size={34}>⚡ Vite = fort</Pill></Pop>
      <Pop f={f} at={SWIPE1 + 16} rot={4} style={{ position: 'absolute', left: 400, top: 380 }}><Pill bg={C.mint} size={34}>↪️ Courbe = effet</Pill></Pop>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 730, display: 'flex', justifyContent: 'center' }}>
        <Pop f={f} at={HIT + 4} rot={-5}><Outlined size={110} color={C.sun}>Badaboum !</Outlined></Pop>
      </div>
      <Sfx name="swoosh-up" at={SWIPE0} volume={0.6} />
      <Sfx name="whoosh" at={SWIPE1 + 8} volume={0.4} />
      <Sfx name="pop" at={HIT} volume={1} />
      <Sfx name="tap" at={HIT + 3} volume={1} />
      <Sfx name="tap" at={HIT + 7} volume={0.8} />
    </>
  )
}

// 4 — Strike, spare, feuille de score
const FRAMES: { rolls: [string, string]; total: number; at: number; note: string }[] = [
  { rolls: ['', 'X'], total: 20, at: 34, note: 'Strike : 10 + tes 2 prochains lancers' },
  { rolls: ['7', '/'], total: 39, at: 70, note: 'Spare : 10 + ton prochain lancer' },
  { rolls: ['9', '–'], total: 48, at: 106, note: '' },
]
const Scoring: MockScene = ({ f }) => {
  const note = [...FRAMES].reverse().find((fr) => f >= fr.at && fr.note)
  return (
    <>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, display: 'flex', justifyContent: 'center', transform: `scale(${sp(f, 2, SPRING.pop)}) rotate(-6deg)` }}>
        <Outlined size={150} color={C.sun}>STRIKE !</Outlined>
      </div>
      <ConfettiBurst f={f} at={4} y={120} seed="bw" n={28} />
      <Pop f={f} at={22} from={60} style={{ position: 'absolute', left: 36, top: 230 }}>
        <Panel radius={36} shadow={9} style={{ width: TW - 72, height: 300, padding: '20px 20px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <Avatar slug="kevin" expression="joie" size={70} />
            <div style={{ fontSize: 40, lineHeight: 1, paddingTop: 6 }}>La feuille de Keke</div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            {[0, 1, 2, 3].map((k) => {
              const fr = FRAMES[k]
              const on = fr && f >= fr.at
              return (
                <div key={k} style={{ flex: 1, height: 160, borderRadius: 18, border: `4px solid ${C.ink}`, boxSizing: 'border-box', background: on ? (k === 0 ? '#ffe9bf' : k === 1 ? '#d6fbef' : C.surface) : C.surface, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', height: 62, borderBottom: `4px solid ${C.ink}` }}>
                    {[0, 1].map((i) => (
                      <div key={i} style={{ flex: 1, borderLeft: i ? `4px solid ${C.ink}` : 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 42, lineHeight: 1, paddingTop: 6, color: i && k < 2 ? C.tomato : C.ink }}>
                        {on ? fr.rolls[i] : ''}
                      </div>
                    ))}
                  </div>
                  <div style={{ height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 58, lineHeight: 1, paddingTop: 6, transform: `scale(${on ? 0.6 + 0.4 * sp(f, fr.at + 6) : 1})` }}>
                    {on && f >= fr.at + 6 ? fr.total : k === 3 ? '…' : ''}
                  </div>
                </div>
              )
            })}
          </div>
        </Panel>
      </Pop>
      {note && (
        <Pop key={note.at} f={f} at={note.at + 4} rot={-2} style={{ position: 'absolute', left: 0, right: 0, top: 570, display: 'flex', justifyContent: 'center' }}>
          <Pill bg={note.at === 34 ? C.sun : C.mint} size={32}>{note.note}</Pill>
        </Pop>
      )}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 680, display: 'flex', justifyContent: 'center', gap: 30, opacity: clamp01(sp(f, 30)) }}>
        {[0, 1, 2].map((k) => <div key={k} style={{ transform: `rotate(${(k - 1) * 14}deg) translateY(${k === 1 ? -14 : 0}px)` }}><Pin s={2.4} /></div>)}
      </div>
      <Sfx name="success" at={4} volume={0.6} />
      {FRAMES.map((fr, k) => <Sfx key={k} name="pop" at={fr.at + 8} volume={0.5} />)}
    </>
  )
}

export const bowling: TutoSpec = {
  id: 'bowling',
  name: 'Bowling',
  emoji: '🎳',
  color: '#4CC9F0',
  players: '2 à 9 joueurs',
  goal: 'Fais tomber un max de quilles !',
  cast: ['kevin', 'dede', 'cycy', 'manon'],
  steps: [
    { text: 'Chacun sa piste sur son téléphone, tous en même temps', seconds: 4.6, Mock: Everyone },
    { text: 'Glisse la boule sur le côté pour te placer', seconds: 4.8, Mock: Placing },
    { text: 'Glisse vers le haut pour lancer : vise les quilles !', seconds: 5.4, Mock: Throwing },
    { text: 'Strike, spare… ce sont les vraies règles du bowling', seconds: 5.6, Mock: Scoring },
  ],
  win: {
    text: 'Le meilleur score total gagne !',
    sub: 'Partie en 3, 5 ou 10 frames, avec lancers bonus à la dernière.',
    winners: ['kevin'],
  },
}
