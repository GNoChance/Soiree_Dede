// Tuto « Dédé Kart » : circuit stylisé (fausse 3D) dans un téléphone tenu à l'horizontale.
import React from 'react'
import { C, sticker, type Slug } from '../../theme'
import { Chibi, Outlined, Pill, Pop, SPRING, Sfx, TW, bySlug, clamp01, lerp, ramp, sp } from '../kit'
import { Phone, ScoreRows, type ScoreRow } from '../parts'
import type { MockScene, TutoSpec } from '../types'

const PW = 664
const PH = 380
const SW = PW - 34 // écran intérieur ≈ 630 × 346
const SH = PH - 34
const HORIZON = 120
const CX = SW / 2

const Kart: React.FC<{ slug: Slug; x: number; tilt?: number; size?: number; boost?: number; sparks?: string | null; f: number }> = ({ slug, x, tilt = 0, size = 150, boost = 0, sparks, f }) => (
  <div style={{ position: 'absolute', left: CX + x - size / 2, top: SH - size * 1.02, width: size, height: size, transform: `rotate(${tilt}deg) translateY(${Math.sin(f / 2) * 2}px)`, zIndex: 6 }}>
    {boost > 0 && [0, 1].map((k) => (
      <div key={k} style={{ position: 'absolute', left: size * (0.2 + k * 0.42), top: size * 0.86, fontSize: size * 0.32 * (0.8 + boost * 0.5 + 0.2 * Math.sin(f + k)), lineHeight: 1, transform: 'rotate(180deg)' }}>🔥</div>
    ))}
    {sparks && [0, 1, 2, 3, 4].map((k) => (
      <div key={k} style={{ position: 'absolute', left: size * (tilt > 0 ? 0.02 : 0.86) + Math.sin(f * 1.7 + k * 2) * 16, top: size * 0.8 - ((f * 5 + k * 13) % 44), width: 14, height: 14, background: sparks, border: `3px solid ${C.ink}`, boxSizing: 'border-box', transform: `rotate(${f * 20 + k * 40}deg)` }} />
    ))}
    <div style={{ position: 'absolute', left: 0, top: size * 0.62, width: size * 0.24, height: size * 0.36, borderRadius: size * 0.08, background: C.ink }} />
    <div style={{ position: 'absolute', right: 0, top: size * 0.62, width: size * 0.24, height: size * 0.36, borderRadius: size * 0.08, background: C.ink }} />
    <div style={{ position: 'absolute', left: size * 0.14, top: size * 0.5, width: size * 0.72, height: size * 0.42, borderRadius: `${size * 0.16}px ${size * 0.16}px ${size * 0.08}px ${size * 0.08}px`, background: bySlug(slug).color, border: `4px solid ${C.ink}`, boxSizing: 'border-box' }} />
    <div style={{ position: 'absolute', left: size * 0.3, top: size * 0.72, width: size * 0.4, height: size * 0.1, borderRadius: 6, background: C.ink, opacity: 0.6 }} />
    <div style={{ position: 'absolute', left: size * 0.16, top: -size * 0.04 }}><Chibi slug={slug} expression="gamer" size={size * 0.68} thumb /></div>
  </div>
)

/** Route en fausse perspective ; `curve` décale le point de fuite (px), `speed` anime les bandes. */
const Road: React.FC<{ f: number; curve?: number; speed?: number; children?: React.ReactNode; shake?: number }> = ({ f, curve = 0, speed = 1, children, shake = 0 }) => {
  const vx = CX + curve
  const xAt = (t: number) => lerp(vx, CX, t)
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', transform: `translate(${Math.sin(f * 2.3) * shake}px, ${Math.cos(f * 3.1) * shake}px)` }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: HORIZON, background: 'linear-gradient(#7fd4f7, #d3f3fd)' }} />
      <div style={{ position: 'absolute', left: 60 - curve * 0.3, top: 30, fontSize: 50, lineHeight: 1 }}>☁️</div>
      <div style={{ position: 'absolute', left: 430 - curve * 0.3, top: 50, fontSize: 40, lineHeight: 1 }}>☁️</div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: HORIZON, bottom: 0, background: '#7ed957' }} />
      <svg width={SW} height={SH} style={{ position: 'absolute', left: 0, top: 0 }}>
        <polygon points={`${vx - 26},${HORIZON} ${vx + 26},${HORIZON} ${CX + 330},${SH} ${CX - 330},${SH}`} fill="#fff" />
        <polygon points={`${vx - 22},${HORIZON} ${vx + 22},${HORIZON} ${CX + 290},${SH} ${CX - 290},${SH}`} fill="#6b6485" />
        {[0, 1, 2, 3, 4].map((j) => {
          const t = Math.pow(((f * 0.035 * speed + j / 5) % 1), 2)
          const y = lerp(HORIZON, SH, t)
          return <rect key={j} x={xAt(t) - (3 + t * 10)} y={y} width={6 + t * 20} height={8 + t * 46} fill="#fff6c9" rx={3} />
        })}
      </svg>
      {children}
    </div>
  )
}
const Device: React.FC<{ f: number; top: number; children?: React.ReactNode }> = ({ f, top, children }) => (
  <div style={{ position: 'absolute', left: (TW - PW) / 2, top, transform: `scale(${0.7 + 0.3 * sp(f, 0, SPRING.snappy)})`, opacity: clamp01(sp(f, 0) * 2) }}>
    <Phone w={PW} h={PH}>{children}</Phone>
  </div>
)
const Dot: React.FC<{ x: number; y: number; on: number }> = ({ x, y, on }) => (
  <div style={{ position: 'absolute', left: x - 30, top: y - 30, width: 60, height: 60, borderRadius: '50%', background: 'rgba(255,255,255,0.85)', border: `5px solid ${C.ink}`, boxSizing: 'border-box', boxShadow: sticker(2), opacity: on, zIndex: 20 }} />
)
const ItemSlot: React.FC<{ children?: React.ReactNode; pressed?: boolean; glow?: boolean }> = ({ children, pressed, glow }) => (
  <div style={{ position: 'absolute', right: 14, bottom: 14, width: 96, height: 96, borderRadius: 24, background: glow ? C.sun : '#ffffffcc', border: `4px solid ${C.ink}`, boxSizing: 'border-box', boxShadow: sticker(pressed ? 1 : 4), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 56, lineHeight: 1, zIndex: 10, transform: pressed ? 'translate(3px, 3px)' : undefined }}>
    {children ?? <Outlined size={22} color={C.muted} stroke={0} style={{ WebkitTextStroke: '0', textShadow: 'none', letterSpacing: 0 }}>OBJET</Outlined>}
  </div>
)

// 1 — Tourner : un doigt à gauche ou à droite
const D_TOP = 96
const Steering: MockScene = ({ f }) => {
  const left = f >= 34 && f < 78
  const right = f >= 100 && f < 144
  const dir = (left ? -1 : right ? 1 : 0)
  const turn = ramp(f, 34, 48) * (1 - ramp(f, 78, 90)) * -1 + ramp(f, 100, 114) * (1 - ramp(f, 144, 156))
  return (
    <>
      <Device f={f} top={D_TOP}>
        <Road f={f} curve={turn * 130}>
          {[0, 1].map((k) => (
            <div key={k} style={{ position: 'absolute', left: k ? '50%' : 0, top: 0, width: '50%', height: '100%', background: (k ? right : left) ? '#ffffff55' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: k ? 'flex-end' : 'flex-start', padding: '0 16px', boxSizing: 'border-box', zIndex: 8 }}>
              <Outlined size={70} color={(k ? right : left) ? C.sun : '#ffffff'} stroke={3} style={{ opacity: (k ? right : left) ? 1 : 0.5 }}>{k ? '▶' : '◀'}</Outlined>
            </div>
          ))}
          <Kart slug="kevin" x={turn * 150} tilt={turn * 10} f={f} />
          <Dot x={dir < 0 ? 90 : 540} y={250} on={dir ? 1 : 0} />
        </Road>
      </Device>
      <Pop f={f} at={10} rot={-2} style={{ position: 'absolute', left: 0, right: 0, top: D_TOP + PH + 50, display: 'flex', justifyContent: 'center' }}>
        <Pill bg={C.mint} size={38}>🚀 Ça accélère tout seul !</Pill>
      </Pop>
      <Pop f={f} at={40} rot={2} style={{ position: 'absolute', left: 30, top: D_TOP + PH + 150 }}>
        <Pill bg={left ? C.sun : C.surface} size={32}>👈 doigt à gauche</Pill>
      </Pop>
      <Pop f={f} at={106} rot={-2} style={{ position: 'absolute', left: 384, top: D_TOP + PH + 150 }}>
        <Pill bg={right ? C.sun : C.surface} size={32}>doigt à droite 👉</Pill>
      </Pop>
      <Sfx name="tap" at={34} volume={0.8} />
      <Sfx name="tap" at={100} volume={0.8} />
    </>
  )
}

// 2 — Dérapage et mini-turbo
const LEVELS = [{ at: 24, color: C.sky, name: 'bleu' }, { at: 56, color: C.tangerine, name: 'orange' }, { at: 88, color: C.grape, name: 'violet' }]
const RELEASE = 118
const Drifting: MockScene = ({ f }) => {
  const drifting = f >= 14 && f < RELEASE
  const level = LEVELS.filter((l) => f >= l.at).length
  const boost = f >= RELEASE ? 1 - ramp(f, RELEASE + 30, RELEASE + 44) : 0
  const lean = ramp(f, 8, 20) * (1 - ramp(f, RELEASE, RELEASE + 8))
  return (
    <>
      <Device f={f} top={D_TOP}>
        <Road f={f} curve={lean * 190} speed={1 + boost * 2} shake={boost * 3}>
          <Kart slug="kevin" x={lean * 110} tilt={lean * 24} f={f} sparks={drifting && level ? LEVELS[level - 1].color : null} boost={boost} />
          <Dot x={540} y={250} on={drifting ? 1 : 0} />
          {boost > 0 && [0, 1, 2, 3, 4, 5].map((k) => (
            <div key={k} style={{ position: 'absolute', left: k % 2 ? 20 + k * 14 : SW - 40 - k * 14, top: ((f * 26 + k * 60) % SH), width: 8, height: 70, borderRadius: 4, background: '#ffffffcc', zIndex: 7 }} />
          ))}
          <div style={{ position: 'absolute', left: 16, bottom: 16, display: 'flex', gap: 6, padding: 8, borderRadius: 16, background: '#ffffffcc', border: `4px solid ${C.ink}`, zIndex: 10 }}>
            {LEVELS.map((l, k) => <div key={k} style={{ width: 44, height: 22, borderRadius: 8, border: `3px solid ${C.ink}`, boxSizing: 'border-box', background: level > k && f < RELEASE + 30 ? l.color : '#ffffff' }} />)}
          </div>
        </Road>
      </Device>
      <Pop f={f} at={18} rot={-2} style={{ position: 'absolute', left: 40, top: D_TOP + PH + 46 }}>
        <Pill bg={C.surface} size={34}>↪️ Grand virage : ça dérape tout seul</Pill>
      </Pop>
      <div style={{ position: 'absolute', left: 0, right: 0, top: D_TOP + PH + 136, display: 'flex', justifyContent: 'center', gap: 14 }}>
        {LEVELS.map((l, k) => (
          <Pop key={k} f={f} at={l.at} rot={(k - 1) * 3}><Pill bg={l.color} color={k === 2 ? '#ffffff' : C.ink} size={36}>✨ {l.name}</Pill></Pop>
        ))}
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: D_TOP + PH + 226, display: 'flex', justifyContent: 'center' }}>
        <Pop f={f} at={RELEASE + 2} rot={-5}><Outlined size={96} color={C.sun}>Mini-turbo !</Outlined></Pop>
      </div>
      {LEVELS.map((l, k) => <Sfx key={k} name="pop" at={l.at + 8} volume={0.5} />)}
      <Sfx name="whoosh" at={RELEASE} volume={0.9} />
      <Sfx name="success" at={RELEASE + 4} volume={0.5} />
    </>
  )
}

// 3 — Boîtes « ? » et bouton OBJET
const GRAB = 46
const USE = 104
const ROULETTE = ['🍯', '🎳', '🌈', '☁️', '🚀']
const Items: MockScene = ({ f }) => {
  const t = Math.pow(ramp(f, 6, GRAB), 2)
  const has = f >= GRAB && f < USE
  const spin = f < GRAB + 24
  const boost = f >= USE ? 1 - ramp(f, USE + 34, USE + 46) : 0
  return (
    <>
      <Device f={f} top={D_TOP}>
        <Road f={f} speed={1 + boost * 2.2} shake={boost * 3}>
          {f < GRAB && (
            <div style={{ position: 'absolute', left: CX - (20 + t * 50), top: lerp(HORIZON - 10, SH - 190, t), width: 40 + t * 100, height: 40 + t * 100, borderRadius: 10 + t * 16, background: C.sun, border: `${2 + t * 4}px solid ${C.ink}`, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `rotate(${Math.sin(f / 5) * 8}deg)`, zIndex: 5 }}>
              <Outlined size={26 + t * 70} color="#ffffff" stroke={2 + t * 2}>?</Outlined>
            </div>
          )}
          <Kart slug="manon" x={0} f={f} boost={boost} />
          {boost > 0 && [0, 1, 2, 3, 4, 5].map((k) => (
            <div key={k} style={{ position: 'absolute', left: k % 2 ? 20 + k * 14 : SW - 40 - k * 14, top: ((f * 26 + k * 60) % SH), width: 8, height: 70, borderRadius: 4, background: '#ffffffcc', zIndex: 7 }} />
          ))}
          <ItemSlot glow={has && !spin} pressed={f >= USE && f < USE + 8}>
            {has ? <span style={{ transform: `scale(${spin ? 1 : 0.7 + 0.3 * sp(f, GRAB + 24, SPRING.pop)})`, display: 'inline-block' }}>{spin ? ROULETTE[Math.floor(f / 3) % ROULETTE.length] : '🚀'}</span> : undefined}
          </ItemSlot>
          <Dot x={SW - 62} y={SH - 62} on={ramp(f, USE - 16, USE - 8) * (1 - ramp(f, USE + 10, USE + 18))} />
        </Road>
      </Device>
      <Pop f={f} at={GRAB + 4} rot={-2} style={{ position: 'absolute', left: 50, top: D_TOP + PH + 46 }}>
        <Pill bg={C.sun} size={38}>🎁 Boîte « ? » = un objet au hasard</Pill>
      </Pop>
      <Pop f={f} at={GRAB + 30} rot={2} style={{ position: 'absolute', left: 90, top: D_TOP + PH + 140 }}>
        <Pill bg={C.surface} size={36}>🚀 turbo · 🍯 glue · 🎳 boule…</Pill>
      </Pop>
      <div style={{ position: 'absolute', left: 0, right: 0, top: D_TOP + PH + 226, display: 'flex', justifyContent: 'center' }}>
        <Pop f={f} at={USE + 4} rot={-5}><Outlined size={84} color={C.tomato}>Touche OBJET !</Outlined></Pop>
      </div>
      <Sfx name="pop" at={GRAB} volume={0.8} />
      {Array.from({ length: 6 }, (_, k) => <Sfx key={k} name="type" at={GRAB + 2 + k * 4} volume={0.7} />)}
      <Sfx name="success" at={GRAB + 26} volume={0.4} />
      <Sfx name="tap" at={USE} volume={0.9} />
      <Sfx name="whoosh" at={USE + 2} volume={0.9} />
    </>
  )
}

// 4 — Les points de la course
const ROWS: ScoreRow[] = [
  { slug: 'manon', name: 'Manon', pts: 15, note: '🥇 1re', at: 8 },
  { slug: 'kevin', name: 'Keke', pts: 12, note: '🥈 2e', at: 28 },
  { slug: 'mika', name: 'Mika', pts: 10, note: '🥉 3e', at: 48 },
  { slug: 'dede', name: 'Dédé', pts: 8, note: '4e', at: 68, expr: 'boude' },
]
const Standings: MockScene = ({ f }) => (
  <>
    <div style={{ position: 'absolute', left: 0, right: 0, top: 0, display: 'flex', justifyContent: 'center' }}>
      <Pop f={f} at={0} rot={-2}><Pill bg={C.surface} size={40}>🏁 Arrivée de la course 1/3</Pill></Pop>
    </div>
    <ScoreRows f={f} rows={ROWS} top={90} rowH={150} />
  </>
)

export const dedeKart: TutoSpec = {
  id: 'dede-kart',
  name: 'Dédé Kart',
  emoji: '🏎️',
  color: '#FF8C42',
  players: '2 à 12 joueurs',
  goal: 'Franchis la ligne d’arrivée avant les autres !',
  cast: ['kevin', 'manon', 'mika', 'dede'],
  steps: [
    { text: 'Pose le doigt à gauche ou à droite pour tourner', seconds: 5.6, Mock: Steering },
    { text: 'Dans un grand virage, redresse pour le mini-turbo !', seconds: 5.8, Mock: Drifting },
    { text: 'Roule sur les boîtes « ? » et touche OBJET pour l’utiliser', seconds: 5.4, Mock: Items },
    { text: 'Des points à chaque course', seconds: 4.6, Mock: Standings },
  ],
  win: {
    text: 'Le meilleur total gagne la coupe !',
    sub: 'En 1 course ou en coupe de 3 courses.',
    winners: ['manon'],
  },
}
