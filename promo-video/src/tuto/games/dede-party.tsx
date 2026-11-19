// Tuto « Dédé Party » : plateau de 24 cases (cases et couleurs de src/games/dede-party/board.ts), vu de dessus.
// Keke et Dédé portent la tenue Animateur Télé (`host`) ; Manon et Mika restent en tenue par défaut.
import React from 'react'
import { C, DISPLAY, type Slug } from '../../theme'
import { Avatar, Bubble, Chibi, Finger, Panel, Pill, Pop, Sfx, bob, clamp01, easeInOut, lerp, ramp, sp, wiggle } from '../kit'
import { Fly, Phone, Btn } from '../parts'
import type { MockScene, TutoSpec } from '../types'

const OUTFITS: Partial<Record<Slug, string>> = { kevin: 'host', dede: 'host' }
const INK = C.ink

// ---------------------------------------------------------------------------
// Dé dessiné (pastilles en CSS)
// ---------------------------------------------------------------------------
const PIPS: Record<number, number[]> = {
  1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
}
const Die: React.FC<{ v: number; size: number; rot?: number; style?: React.CSSProperties }> = ({ v, size, rot = 0, style }) => (
  <div
    style={{
      width: size, height: size, boxSizing: 'border-box', background: '#ffffff', border: `${Math.max(3, size * 0.06)}px solid ${INK}`, borderRadius: size * 0.2,
      boxShadow: `${size * 0.06}px ${size * 0.06}px 0 0 ${INK}`, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gridTemplateRows: 'repeat(3, 1fr)',
      padding: size * 0.12, transform: `rotate(${rot}deg)`, flexShrink: 0, ...style,
    }}
  >
    {Array.from({ length: 9 }, (_, i) => (
      <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {PIPS[v].includes(i) && <div style={{ width: size * 0.17, height: size * 0.17, borderRadius: '50%', background: INK }} />}
      </div>
    ))}
  </div>
)

/** Dé qui roule jusqu'à `settle` puis se pose sur `end` (avec un petit rebond). */
const RollDie: React.FC<{ f: number; size: number; seed: number; settle: number; end: number; style?: React.CSSProperties }> = ({ f, size, seed, settle, end, style }) => {
  const rolling = f < settle
  const v = rolling ? ((Math.floor(Math.max(0, f) / 3) + seed * 2) % 6) + 1 : end
  const land = clamp01((f - settle) / 10)
  const rot = rolling ? Math.sin(f * 0.8 + seed) * 22 : 0
  const s = rolling ? 1 : 1 + 0.25 * Math.sin(land * Math.PI)
  return <Die v={v} size={size} rot={rot} style={{ transform: `rotate(${rot}deg) scale(${s})`, ...style }} />
}

// ---------------------------------------------------------------------------
// 1 — Tout le monde tape son dé en même temps
// ---------------------------------------------------------------------------
const OTHERS: { slug: Slug; x: number; end: number; settle: number }[] = [
  { slug: 'dede', x: 14, end: 4, settle: 44 },
  { slug: 'manon', x: 250, end: 3, settle: 50 },
  { slug: 'mika', x: 486, end: 3, settle: 56 },
]

const Roll: MockScene = ({ f }) => {
  const showOverlay = f >= 74
  const pressed = f >= 62 && f < 74
  const tilt = f < 60 ? wiggle(f, 0, 4, 24) : 0
  const ov = sp(f, 74)
  return (
    <>
      {OTHERS.map((o, k) => (
        <Pop key={o.slug} f={f} at={4 + k * 4} from={-40} style={{ position: 'absolute', left: o.x, top: 6, display: 'flex', alignItems: 'center', gap: 12 }}>
          <Avatar slug={o.slug} expression="joie" size={104} outfit={OUTFITS[o.slug]} />
          <RollDie f={f} size={84} seed={k + 1} settle={o.settle} end={o.end} />
        </Pop>
      ))}
      <Pop f={f} at={0} from={120} style={{ position: 'absolute', left: 130, top: 140 }}>
        <Phone w={460} h={640}>
          <div style={{ position: 'absolute', left: 20, right: 20, top: 24, textAlign: 'center', fontFamily: DISPLAY, fontWeight: 800, fontSize: 36, lineHeight: 1.1, color: INK }}>
            Tour 3 / 9 : tape ton dé !
          </div>
          <div style={{ position: 'absolute', left: 38, top: 150, transform: `rotate(${tilt}deg)` }}>
            <Btn bg={C.sun} w={340} h={220} pressed={false} size={56} style={{ flexDirection: 'column', gap: 6 }}>
              <Die v={5} size={92} />
              <div>Lancer !</div>
            </Btn>
          </div>
          <div style={{ position: 'absolute', left: 38, top: 410 }}>
            <Btn bg={C.surface} w={340} h={92} pressed={pressed} size={34}>🎲🎲 Double dé (1)</Btn>
          </div>
          {showOverlay && (
            <div style={{ position: 'absolute', left: 14, right: 14, top: 130, bottom: 40, transform: `scale(${Math.max(0, ov)})`, opacity: clamp01(ov * 3) }}>
              <Panel bg={C.paper} radius={30} shadow={6} style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
                <div style={{ display: 'flex', gap: 22 }}>
                  <RollDie f={f - 74} size={118} seed={1} settle={16} end={3} />
                  <RollDie f={f - 74} size={118} seed={3} settle={22} end={4} />
                </div>
                {f >= 98 && <Pop f={f} at={98}><div style={{ fontSize: 76, lineHeight: 1, color: C.tangerine }}>3 + 4</div></Pop>}
                {f >= 104 && (
                  <Pop f={f} at={104}>
                    <div style={{ fontSize: 40, lineHeight: 1.1, textAlign: 'center', padding: '0 14px' }}>Tu avances de 7 cases !</div>
                  </Pop>
                )}
              </Panel>
            </div>
          )}
        </Phone>
      </Pop>
      <Pop f={f} at={8} from={100} style={{ position: 'absolute', left: 0, top: 610 }}>
        <Chibi slug="kevin" expression={f >= 98 ? 'joie' : 'cool'} size={150} outfit="host" style={{ transform: `translateY(${bob(f, 0, 8, 30)}px)` }} />
      </Pop>
      {f >= 70 ? (
        <Pop f={f} at={76} rot={2} style={{ position: 'absolute', left: 0, right: 0, top: 806, display: 'flex', justifyContent: 'center' }}>
          <Pill bg={C.bubblegum} size={36}>🎲🎲 Une fois par partie !</Pill>
        </Pop>
      ) : (
        <Pop f={f} at={22} rot={-2} style={{ position: 'absolute', left: 0, right: 0, top: 806, display: 'flex', justifyContent: 'center' }}>
          <Pill bg={C.sun} size={38}>⚡ Tous en même temps !</Pill>
        </Pop>
      )}
      <Finger f={f} taps={[{ at: 62, x: 360, y: 640 }]} />
      <Sfx name="whoosh" at={6} volume={0.3} />
      <Sfx name="tap" at={46} volume={0.4} />
      <Sfx name="tap" at={52} volume={0.4} />
      <Sfx name="tap" at={58} volume={0.4} />
      <Sfx name="tap" at={62} volume={0.6} />
      <Sfx name="tap" at={92} volume={0.4} />
      <Sfx name="pop" at={98} volume={0.5} />
      <Sfx name="success" at={106} volume={0.4} />
    </>
  )
}

// ---------------------------------------------------------------------------
// Plateau (24 cases autour d'une grille 7 × 7, départ en bas à gauche, sens horaire)
// ---------------------------------------------------------------------------
type CellType = 'start' | 'clap' | 'pub' | 'env' | 'loge'
const CELLS: CellType[] = ['start', 'clap', 'loge', 'pub', 'clap', 'env', 'loge', 'clap', 'clap', 'pub', 'loge', 'env', 'clap', 'loge', 'clap', 'pub', 'env', 'clap', 'loge', 'clap', 'pub', 'env', 'loge', 'clap']
const CI: Record<CellType, { e: string; c: string }> = {
  start: { e: '🎬', c: '#FFB703' },
  clap: { e: '👏', c: '#06D6A0' },
  pub: { e: '📺', c: '#EF476F' },
  env: { e: '✉️', c: '#8B5CF6' },
  loge: { e: '✨', c: '#4CC9F0' },
}
const BW = 660
const CELL = BW / 7
const BX = 30
const BY = 8

const cellXY = (i: number) => {
  const k = ((i % 24) + 24) % 24
  if (k <= 6) return { col: 0, row: 6 - k }
  if (k <= 12) return { col: k - 6, row: 0 }
  if (k <= 18) return { col: 6, row: k - 12 }
  return { col: 24 - k, row: 6 }
}
const cellC = (i: number): [number, number] => {
  const { col, row } = cellXY(i)
  return [BX + col * CELL + CELL / 2, BY + row * CELL + CELL / 2]
}
/** Centre d'un pion à la case fractionnaire `c` (petit saut entre deux cases). */
const pawnC = (c: number): [number, number] => {
  const a = Math.floor(c)
  const t = c - a
  const A = cellC(a)
  const B = cellC(a + 1)
  return [lerp(A[0], B[0], t), lerp(A[1], B[1], t) - Math.sin(t * Math.PI) * 16]
}
/** Case atteinte à la frame f : `hop` frames par case, saut en douceur. */
const hopCell = (f: number, start: number, from: number, to: number, hop: number) => {
  const p = clamp01((f - start) / (hop * (to - from))) * (to - from)
  const k = Math.floor(p)
  return k >= to - from ? to : from + k + easeInOut(p - k)
}

type Pawn = { slug: Slug; c: number; mover?: boolean; expr?: string }

const StarIcon: React.FC<{ f: number; x: number; y: number; size?: number }> = ({ f, x, y, size = 66 }) => (
  <div style={{ position: 'absolute', left: x, top: y, width: 0, height: 0, zIndex: 12 }}>
    <div style={{ position: 'absolute', left: -size / 2, top: -size / 2, width: size, height: size, fontSize: size, lineHeight: 1, textAlign: 'center', transform: `rotate(${f * 2}deg) scale(${1 + 0.12 * Math.sin(f / 5)})` }}>⭐</div>
  </div>
)

const GBoard: React.FC<{ pawns: Pawn[]; center?: React.ReactNode }> = ({ pawns, center }) => {
  const mover = pawns.find((p) => p.mover)
  const lit = mover ? Math.round(mover.c) % 24 : -1
  return (
    <>
      {CELLS.map((t, i) => {
        const { col, row } = cellXY(i)
        const on = i === lit
        return (
          <div
            key={i}
            style={{
              position: 'absolute', left: BX + col * CELL + 3, top: BY + row * CELL + 3, width: CELL - 6, height: CELL - 6, boxSizing: 'border-box', background: CI[t].c,
              border: `4px solid ${INK}`, borderRadius: '24%', boxShadow: `4px 4px 0 0 ${INK}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              lineHeight: 1, color: INK, fontFamily: DISPLAY, fontWeight: 800, transform: on ? 'scale(1.1)' : undefined, zIndex: on ? 5 : 1,
            }}
          >
            <span style={{ fontSize: t === 'start' ? 34 : 42 }}>{CI[t].e}</span>
            {t === 'start' && <span style={{ fontSize: 15 }}>DÉPART</span>}
          </div>
        )
      })}
      <div style={{ position: 'absolute', left: BX + CELL, top: BY + CELL, width: CELL * 5, height: CELL * 5, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
        {center}
      </div>
      {pawns.map((p) => {
        const [x, y] = pawnC(p.c)
        const size = p.mover ? CELL * 0.84 : CELL * 0.66
        return (
          <div key={p.slug} style={{ position: 'absolute', left: x - size / 2, top: y - size / 2 - (p.mover ? 8 : 0), width: size, height: size, zIndex: p.mover ? 30 : 20 }}>
            <Avatar slug={p.slug} expression={p.expr ?? 'joie'} size={size} outfit={OUTFITS[p.slug]} ring={p.mover} />
          </div>
        )
      })}
    </>
  )
}

const DedeHost: React.FC<{ f: number; expr: string; size?: number }> = ({ f, expr, size = 200 }) => (
  <Chibi slug="dede" expression={expr} size={size} outfit="host" style={{ transform: `translateY(${bob(f, 0, 8, 28)}px)` }} />
)
const Say: React.FC<{ f: number; at: number; children: React.ReactNode }> = ({ f, at, children }) => (
  <Pop f={f} at={at} from={30}>
    <Bubble size={30} tail="none">{children}</Bubble>
  </Pop>
)
const Label: React.FC<{ f: number; from: number; to: number; bg: string; color?: string; children: React.ReactNode; top?: number }> = ({ f, from, to, bg, color, children, top = 716 }) =>
  f >= from && f < to ? (
    <Pop f={f} at={from} rot={-2} from={30} style={{ position: 'absolute', left: 0, right: 0, top, display: 'flex', justifyContent: 'center' }}>
      <Pill bg={bg} color={color} size={40}>{children}</Pill>
    </Pop>
  ) : null

// ---------------------------------------------------------------------------
// 2 — Les pions avancent tout seuls : à chaque case son effet
// ---------------------------------------------------------------------------
const Effects: MockScene = ({ f }) => {
  const manon = hopCell(f, 6, 8, 12, 5)
  const mika = hopCell(f, 58, 17, 20, 5)
  const dede = hopCell(f, 108, 2, 5, 5)
  const pawns: Pawn[] = [
    { slug: 'kevin', c: 7, expr: 'cool' },
    { slug: 'manon', c: manon, mover: f >= 6 && f < 58, expr: f >= 30 ? 'joie' : 'cool' },
    { slug: 'mika', c: mika, mover: f >= 58 && f < 108, expr: f >= 76 ? 'boude' : 'cool' },
    { slug: 'dede', c: dede, mover: f >= 108, expr: f >= 126 ? 'joie' : 'cool' },
  ]
  const phase = f < 58 ? 'a' : f < 108 ? 'b' : 'c'
  const center =
    phase === 'a' ? (
      <>
        {f >= 34 && <Say f={f} at={34}>Le public adore Manon !</Say>}
        <DedeHost f={f} expr="joie" />
      </>
    ) : phase === 'b' ? (
      <>
        {f >= 82 && <Say f={f} at={82}>Coupure publicitaire !</Say>}
        <DedeHost f={f} expr="cool" />
      </>
    ) : f < 124 ? (
      <DedeHost f={f} expr="surprise" />
    ) : f < 134 ? (
      <Pop f={f} at={124} from={20}><div style={{ fontSize: 150, lineHeight: 1 }}>✉️</div></Pop>
    ) : (
      <Pop f={f} at={134} rot={-3} from={30}>
        <Panel bg={C.surface} radius={26} shadow={7} style={{ width: 380, padding: '14px 12px 12px', textAlign: 'center', lineHeight: 1.1 }}>
          <div style={{ fontSize: 26, color: C.muted }}>✉️ Carte surprise</div>
          <div style={{ fontSize: 38, marginTop: 4 }}>Cachet de star :</div>
          <div style={{ fontSize: 50, color: C.tangerine }}>+8 pièces !</div>
        </Panel>
      </Pop>
    )
  const loge13 = cellC(13)
  const [dx, dy] = cellC(5)
  return (
    <>
      <GBoard pawns={pawns} center={center} />
      <StarIcon f={f} x={loge13[0]} y={loge13[1]} />
      <Label f={f} from={28} to={58} bg={C.mint}>👏 Bravo : +3 🪙</Label>
      <Label f={f} from={76} to={108} bg={C.tomato} color="#ffffff">📺 Page de pub : −3 🪙</Label>
      <Label f={f} from={140} to={999} bg={C.sun}>Dédé : +8 🪙</Label>
      {[0, 1, 2].map((k) => (
        <Fly key={k} f={f} at={146 + k * 4} len={14} from={[360, 340]} to={[dx, dy]} arc={80} size={54}>🪙</Fly>
      ))}
      <Sfx name="tap" at={10} volume={0.4} />
      <Sfx name="tap" at={15} volume={0.4} />
      <Sfx name="tap" at={20} volume={0.4} />
      <Sfx name="pop" at={28} volume={0.5} />
      <Sfx name="tap" at={62} volume={0.4} />
      <Sfx name="tap" at={67} volume={0.4} />
      <Sfx name="pop" at={76} volume={0.5} />
      <Sfx name="tap" at={112} volume={0.4} />
      <Sfx name="tap" at={117} volume={0.4} />
      <Sfx name="pop" at={124} volume={0.5} />
      <Sfx name="success" at={134} volume={0.45} />
      <Sfx name="swoosh-up" at={146} volume={0.35} />
    </>
  )
}

// ---------------------------------------------------------------------------
// 3 — Passer sur l'étoile avec 20 pièces
// ---------------------------------------------------------------------------
const StarBuy: MockScene = ({ f }) => {
  const keke = hopCell(f, 20, 7, 14, 4)
  const bought = f >= 46
  const loge13 = cellC(13)
  const loge22 = cellC(22)
  const kp = pawnC(14)
  const flash = ramp(f, 44, 56)
  const pawns: Pawn[] = [
    { slug: 'manon', c: 12 },
    { slug: 'mika', c: 20 },
    { slug: 'dede', c: 5 },
    { slug: 'kevin', c: keke, mover: f >= 20, expr: bought ? 'joie' : 'cool' },
  ]
  const center =
    f < 74 ? (
      <Pop f={f} at={2} from={30}>
        <Panel bg={C.surface} radius={28} shadow={7} style={{ padding: '14px 28px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: 42, lineHeight: 1.1 }}>C’est à Keke !</div>
          <div style={{ display: 'flex', gap: 18, justifyContent: 'center', marginTop: 10 }}>
            <Die v={3} size={84} rot={-6} />
            <Die v={4} size={84} rot={6} />
          </div>
        </Panel>
      </Pop>
    ) : (
      <>
        {f >= 80 && (
          <Pop f={f} at={80} from={30}>
            <Bubble size={30} tail="none">UNE ÉTOILE POUR KEKE !<br />Le public est debout !</Bubble>
          </Pop>
        )}
        <DedeHost f={f} expr="surprise" />
      </>
    )
  const stars = bought ? 1 : 0
  const coins = bought ? 1 : 21
  return (
    <>
      <GBoard pawns={pawns} center={center} />
      {f < 46 && <StarIcon f={f} x={loge13[0]} y={loge13[1]} />}
      {f >= 44 && f < 70 && (
        <div style={{ position: 'absolute', left: loge13[0] - 120, top: loge13[1] - 120, width: 240, height: 240, borderRadius: '50%', background: '#ffffff', border: `6px solid ${C.sun}`, boxSizing: 'border-box', opacity: 0.8 * (1 - flash), transform: `scale(${0.3 + flash})`, zIndex: 40 }} />
      )}
      <Fly f={f} at={46} len={14} from={[loge13[0], loge13[1]]} to={[kp[0], kp[1]]} arc={50} spin={360} size={66}>⭐</Fly>
      <Fly f={f} at={126} len={22} from={[kp[0], kp[1]]} to={[loge22[0], loge22[1]]} arc={150} spin={360} stay size={66}>⭐</Fly>
      <Pop f={f} at={6} from={40} style={{ position: 'absolute', left: BX, top: 700 }}>
        <Panel bg={C.surface} radius={28} shadow={6} style={{ height: 96, display: 'flex', alignItems: 'center', gap: 14, padding: '0 26px 0 12px' }}>
          <Avatar slug="kevin" expression={bought ? 'joie' : 'cool'} size={72} outfit="host" />
          <div style={{ fontSize: 44, lineHeight: 1, transform: `scale(${1 + 0.18 * Math.sin(ramp(f, 62, 74) * Math.PI)})` }}>
            ⭐ {stars} · 🪙 {coins}
          </div>
        </Panel>
      </Pop>
      <Label f={f} from={46} to={118} bg={C.sun} top={806}>⭐ Étoile achetée (20 🪙) !</Label>
      <Label f={f} from={128} to={999} bg={C.sky} top={806}>✨ Puis l’étoile déménage !</Label>
      <Sfx name="tap" at={24} volume={0.4} />
      <Sfx name="tap" at={32} volume={0.4} />
      <Sfx name="tap" at={40} volume={0.4} />
      <Sfx name="success" at={46} volume={0.55} />
      <Sfx name="pop" at={62} volume={0.5} />
      <Sfx name="pop" at={80} volume={0.5} />
      <Sfx name="whoosh" at={126} volume={0.4} />
      <Sfx name="pop" at={148} volume={0.5} />
    </>
  )
}

// ---------------------------------------------------------------------------
// 4 — Un mini-jeu à chaque tour : le Buzzer
// ---------------------------------------------------------------------------
const ROULETTE: { e: string; name: string; c: string }[] = [
  { e: '❓', name: 'Questions pour un Dédé', c: '#4CC9F0' },
  { e: '🎯', name: 'Au pif', c: '#FFB570' },
  { e: '🫵', name: 'Comme tout le monde', c: '#FF8FA3' },
  { e: '🌠', name: 'Pluie d’étoiles', c: '#8B5CF6' },
  { e: '⏱️', name: 'Top chrono', c: '#06D6A0' },
  { e: '🚨', name: 'Le Buzzer', c: '#EF476F' },
]
const ROULETTE_AT = [4, 9, 15, 22, 30, 39]

const PODIUM: { slug: Slug; name: string; medal: string; gain: string; bg: string }[] = [
  { slug: 'kevin', name: 'Keke', medal: '🥇', gain: '+10', bg: C.sun },
  { slug: 'manon', name: 'Manon', medal: '🥈', gain: '+6', bg: C.surface },
  { slug: 'dede', name: 'Dédé', medal: '🥉', gain: '+4', bg: C.surface },
  { slug: 'mika', name: 'Mika', medal: '4', gain: '+2', bg: C.surface },
]

const Mini: MockScene = ({ f }) => {
  let j = -1
  ROULETTE_AT.forEach((t, k) => { if (f >= t) j = k })
  const card = ROULETTE[Math.max(0, j)]
  const last = j === 5
  const lockP = sp(f, 39)
  const green = f >= 70
  const showPhone = f >= 46 && f < 112
  const ph = sp(f, 46)
  return (
    <>
      <Pop f={f} at={0} rot={-2} from={-40} style={{ position: 'absolute', left: 0, right: 0, top: 0, display: 'flex', justifyContent: 'center' }}>
        <Pill bg={C.sun} size={34}>Mini-jeu n°3</Pill>
      </Pop>
      {f >= 4 && (
        <div style={{ position: 'absolute', left: 60, top: 70, width: 600, transform: last ? `scale(${0.9 + 0.1 * lockP})` : undefined }}>
          <Panel bg={card.c} radius={34} shadow={8} style={{ height: 130, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 18, padding: '0 16px', fontSize: last ? 54 : 40, lineHeight: 1.05, textAlign: 'center' }}>
            <span style={{ fontSize: 70 }}>{card.e}</span>
            <span>{card.name}</span>
          </Panel>
        </div>
      )}
      {showPhone && (
        <div style={{ position: 'absolute', left: 190, top: 240, transform: `scale(${Math.max(0, ph)})`, transformOrigin: '50% 50%', opacity: 1 - ramp(f, 104, 112) }}>
          <Phone w={340} h={540} bg={green ? C.mint : C.tomato}>
            <div style={{ position: 'absolute', left: 12, right: 12, top: 150, textAlign: 'center', fontFamily: DISPLAY, fontWeight: 800, color: green ? INK : '#ffffff', fontSize: green ? 84 : 46, lineHeight: 1.05 }}>
              {green ? '⚡ TAPE !' : '✋ Attends le vert…'}
            </div>
            {f >= 88 && (
              <Pop f={f} at={88} from={40} style={{ position: 'absolute', left: 20, right: 20, top: 330 }}>
                <Panel bg={C.surface} radius={24} shadow={5} style={{ textAlign: 'center', fontSize: 58, padding: '10px 0 4px', lineHeight: 1.1 }}>0,287 s</Panel>
              </Pop>
            )}
          </Phone>
        </div>
      )}
      {f >= 46 && f < 112 && <Finger f={f} taps={[{ at: 84, x: 360, y: 640 }]} />}
      {PODIUM.map((r, k) => (
        <Pop key={r.slug} f={f} at={114 + k * 6} from={50} rot={k % 2 ? 1 : -1} style={{ position: 'absolute', left: 40, top: 230 + k * 124 }}>
          <Panel bg={r.bg} radius={30} shadow={6} style={{ width: 640, height: 108, display: 'flex', alignItems: 'center', gap: 16, padding: '0 28px 0 20px' }}>
            <div style={{ width: 70, textAlign: 'center', fontSize: r.medal === '4' ? 54 : 62, lineHeight: 1 }}>{r.medal}</div>
            <Avatar slug={r.slug} expression={k === 0 ? 'joie' : k === 3 ? 'boude' : 'cool'} size={84} outfit={OUTFITS[r.slug]} />
            <div style={{ flex: 1, fontSize: 42, lineHeight: 1 }}>{r.name}</div>
            <div style={{ fontSize: 50, lineHeight: 1, color: C.tangerine }}>{r.gain} 🪙</div>
          </Panel>
        </Pop>
      ))}
      <Pop f={f} at={22} rot={2} from={30} style={{ position: 'absolute', left: 0, right: 0, top: 802, display: 'flex', justifyContent: 'center' }}>
        <Pill bg={C.bubblegum} size={36}>🎮 6 mini-jeux différents !</Pill>
      </Pop>
      {ROULETTE_AT.map((t) => <Sfx key={t} name="tap" at={t} volume={0.3} />)}
      <Sfx name="pop" at={39} volume={0.55} />
      <Sfx name="whoosh" at={46} volume={0.3} />
      <Sfx name="pop" at={70} volume={0.5} />
      <Sfx name="tap" at={84} volume={0.6} />
      <Sfx name="success" at={90} volume={0.4} />
      {PODIUM.map((_, k) => <Sfx key={k} name="pop" at={116 + k * 6} volume={0.45} />)}
    </>
  )
}

// ---------------------------------------------------------------------------
// Victoire : étoiles bonus + classement
// ---------------------------------------------------------------------------
const RANK: { slug: Slug; name: string; stars: number; bg: string }[] = [
  { slug: 'kevin', name: 'Keke', stars: 3, bg: C.sun },
  { slug: 'manon', name: 'Manon', stars: 2, bg: C.surface },
  { slug: 'mika', name: 'Mika', stars: 2, bg: C.surface },
  { slug: 'dede', name: 'Dédé', stars: 1, bg: C.surface },
]
const Board: React.FC<{ f: number }> = ({ f }) => (
  <>
    <Pop f={f} at={14} from={-60} rot={-2} style={{ position: 'absolute', left: 0, right: 0, top: 0, display: 'flex', justifyContent: 'center' }}>
      <Pill bg={C.sun} size={32}>👑 ⭐ Roi des mini-jeux : Keke</Pill>
    </Pop>
    <Pop f={f} at={26} from={-60} rot={2} style={{ position: 'absolute', left: 0, right: 0, top: 68, display: 'flex', justifyContent: 'center' }}>
      <Pill bg={C.sun} size={32}>📺 ⭐ Prix de la poisse : Mika</Pill>
    </Pop>
    {RANK.map((r, i) => (
      <Pop key={r.slug} f={f} at={40 + i * 5} from={40} style={{ position: 'absolute', left: 20 + i * 170, top: 146, width: 162 }}>
        <Panel bg={r.bg} radius={24} shadow={6} style={{ height: 100, display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px 0 8px' }}>
          <Avatar slug={r.slug} expression={i === 0 ? 'joie' : 'cool'} size={58} outfit={OUTFITS[r.slug]} />
          <div style={{ flex: 1, lineHeight: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 24 }}>{r.name}</div>
            <div style={{ fontSize: 34, marginTop: 4, whiteSpace: 'nowrap' }}>⭐ {r.stars}</div>
          </div>
        </Panel>
      </Pop>
    ))}
    <Sfx name="pop" at={14} volume={0.5} />
    <Sfx name="pop" at={26} volume={0.5} />
    <Sfx name="pop" at={42} volume={0.4} />
  </>
)

export const dedeParty: TutoSpec = {
  id: 'dede-party',
  name: 'Dédé Party',
  emoji: '🎤',
  color: '#FFB703',
  players: '2 à 8 joueurs',
  goal: 'Décroche le plus d’étoiles dans le jeu télé de Dédé !',
  cast: ['kevin', 'dede', 'manon', 'mika'],
  outfits: OUTFITS,
  steps: [
    { text: 'Tout le monde tape son dé en même temps !', seconds: 5.4, Mock: Roll },
    { text: 'Les pions avancent tout seuls : à chaque case son effet', seconds: 6, Mock: Effects },
    { text: 'Passe sur l’étoile avec 20 pièces : elle est à toi !', seconds: 5.4, Mock: StarBuy },
    { text: 'Un mini-jeu à chaque tour : le 1er rafle 10 pièces !', seconds: 5.6, Mock: Mini },
  ],
  win: {
    text: 'Le plus d’étoiles gagne !',
    sub: 'En 6, 9 ou 12 tours. À la fin, 2 étoiles bonus surprise !',
    winners: ['kevin'],
    Board,
  },
}
