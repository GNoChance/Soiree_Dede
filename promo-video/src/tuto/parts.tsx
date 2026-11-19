// Morceaux de maquette partagés par plusieurs tutos (duel VS / paris, chrono, tableau de points, téléphone…).
import React from 'react'
import { C, sticker, type Slug } from '../theme'
import { Avatar, Bubble, Chibi, Outlined, Panel, Pill, Pop, Sfx, TW, bob, easeInOut, lerp, ramp, sp, wiggle } from './kit'
import type { MockScene } from './types'

/** Barre de chrono : `p` = part du temps écoulé (0 → 1). */
export const TimerBar: React.FC<{ p: number; width: number; height?: number }> = ({ p, width, height = 34 }) => (
  <div style={{ width, height, borderRadius: height / 2, background: C.surface, border: `5px solid ${C.ink}`, boxSizing: 'border-box', overflow: 'hidden', boxShadow: sticker(4) }}>
    <div style={{ width: `${(1 - p) * 100}%`, height: '100%', background: p > 0.7 ? C.tomato : C.mint }} />
  </div>
)

/** Objet (emoji, jeton…) qui vole en cloche de `from` à `to` ; visible seulement pendant le vol (sauf `stay`). */
export const Fly: React.FC<{ f: number; at: number; len?: number; from: [number, number]; to: [number, number]; arc?: number; spin?: number; stay?: boolean; size?: number; children?: React.ReactNode }> = ({
  f, at, len = 14, from, to, arc = 100, spin = 0, stay, size = 64, children,
}) => {
  const p = easeInOut(ramp(f, at, at + len))
  if (f < at || (p >= 1 && !stay)) return null
  return (
    <div style={{ position: 'absolute', left: lerp(from[0], to[0], p), top: lerp(from[1], to[1], p) - Math.sin(p * Math.PI) * arc, fontSize: size, lineHeight: 1, transform: `translate(-50%, -50%) rotate(${p * spin}deg)`, zIndex: 20 }}>
      {children}
    </div>
  )
}

/** Téléphone stylisé (coque sombre, écran clair). */
export const Phone: React.FC<{ w: number; h: number; bg?: string; style?: React.CSSProperties; children?: React.ReactNode }> = ({ w, h, bg = C.paper, style, children }) => (
  <div style={{ width: w, height: h, boxSizing: 'border-box', borderRadius: Math.min(w, h) * 0.16, background: C.ink, padding: Math.min(w, h) * 0.045, boxShadow: sticker(8), ...style }}>
    <div style={{ position: 'relative', width: '100%', height: '100%', borderRadius: Math.min(w, h) * 0.12, background: bg, overflow: 'hidden' }}>{children}</div>
  </div>
)

/** Gros bouton de l'appli. */
export const Btn: React.FC<{ bg?: string; color?: string; size?: number; w?: number; h?: number; pressed?: boolean; style?: React.CSSProperties; children?: React.ReactNode }> = ({
  bg = C.sun, color = C.ink, size = 48, w, h, pressed, style, children,
}) => (
  <Panel bg={bg} radius={30} shadow={pressed ? 2 : 8}
    style={{ width: w, height: h, color, fontSize: size, lineHeight: 1.05, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: h ? '6px 16px 0' : '18px 30px 10px', transform: pressed ? 'translate(5px, 5px)' : undefined, ...style }}>
    {children}
  </Panel>
)

// ---------------------------------------------------------------------------
// Tableau de points (une ligne par joueur, compteur qui grimpe).
// ---------------------------------------------------------------------------
export type ScoreRow = { slug: Slug; name: string; pts: number; note: string; at: number; expr?: string; bg?: string; prefix?: string; suffix?: string }
export const ScoreRows: React.FC<{ f: number; rows: ScoreRow[]; top?: number; rowH?: number }> = ({ f, rows, top = 6, rowH = 172 }) => (
  <>
    {rows.map((s, k) => {
      const n = Math.round(s.pts * ramp(f, s.at + 6, s.at + 22))
      return (
        <Pop key={k} f={f} at={s.at} from={50} rot={k % 2 ? 1 : -1} style={{ position: 'absolute', left: 36, top: top + k * (rowH + 28) }}>
          <Panel bg={s.bg ?? C.surface} radius={36} style={{ width: TW - 72, height: rowH, display: 'flex', alignItems: 'center', gap: 18, padding: '0 26px 0 18px' }}>
            <Avatar slug={s.slug} expression={s.expr ?? (s.pts ? 'joie' : 'pleurs')} size={rowH * 0.72} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: rowH * 0.29, lineHeight: 1.05 }}>{s.name}</div>
              <div style={{ fontSize: rowH * 0.165, lineHeight: 1.2, color: C.muted }}>{s.note}</div>
            </div>
            <div style={{ fontSize: rowH * 0.44, lineHeight: 1, color: s.pts ? C.tangerine : C.muted, transform: `scale(${1 + 0.2 * Math.sin(ramp(f, s.at + 20, s.at + 30) * Math.PI)})` }}>
              {s.prefix ?? '+'}{n}{s.suffix ?? ''}
            </div>
          </Panel>
        </Pop>
      )
    })}
    {rows.map((s, k) => <Sfx key={k} name={s.pts ? 'pop' : 'tap'} at={s.at + 8} volume={0.6} />)}
  </>
)

// ---------------------------------------------------------------------------
// Jeux en duel : scène « VS » et scène des paris (mêmes que le Morpion, paramétrables).
// ---------------------------------------------------------------------------
type Side = { slug: Slug; name: string; tint: string; outfit?: string }
export type DuelCast = { a: Side; b: Side; tokenA?: React.ReactNode; tokenB?: React.ReactNode }

export const makeVersus = (d: DuelCast, pill: string): MockScene => ({ f }) => {
  const a = sp(f, 2)
  const b = sp(f, 8)
  const vs = sp(f, 18)
  return (
    <>
      <div style={{ position: 'absolute', left: 20 - (1 - a) * 400, top: 120 + bob(f, 0, 12, 26) }}>
        <Chibi slug={d.a.slug} expression="cool" size={310} outfit={d.a.outfit} />
        {d.tokenA && <div style={{ position: 'absolute', left: -10, top: -30, transform: `rotate(-10deg) scale(${sp(f, 26)})` }}>{d.tokenA}</div>}
      </div>
      <div style={{ position: 'absolute', right: 20 - (1 - b) * 400, top: 300 + bob(f, 13, 12, 26) }}>
        <Chibi slug={d.b.slug} expression="clin_oeil" size={310} outfit={d.b.outfit} />
        {d.tokenB && <div style={{ position: 'absolute', right: -10, top: -30, transform: `rotate(10deg) scale(${sp(f, 32)})` }}>{d.tokenB}</div>}
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 290, display: 'flex', justifyContent: 'center', transform: `scale(${vs * (1 + 0.05 * Math.sin(f / 5))}) rotate(-8deg)` }}>
        <Outlined size={150} color={C.sun}>VS</Outlined>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 720, display: 'flex', justifyContent: 'center' }}>
        <Pop f={f} at={58} rot={-2}><Pill bg={C.surface} size={44}>{pill}</Pill></Pop>
      </div>
      <Sfx name="whoosh" at={2} volume={0.4} />
      <Sfx name="pop" at={20} volume={0.6} />
      <Sfx name="pop" at={60} />
    </>
  )
}

type Bet = { slug: Slug; on: 0 | 1; at: number }
const DEFAULT_BETS: Bet[] = [
  { slug: 'dede', on: 0, at: 30 },
  { slug: 'mika', on: 1, at: 52 },
  { slug: 'manon', on: 0, at: 74 },
]
export const makeBetting = (d: DuelCast, bets: Bet[] = DEFAULT_BETS): MockScene => ({ f }) => (
  <>
    {[d.a, d.b].map((side, k) => {
      const n = bets.filter((b) => b.on === k && f >= b.at + 14).length
      return (
        <Pop key={k} f={f} at={2 + k * 5} style={{ position: 'absolute', left: k ? 380 : 40, top: 20 }}>
          <Panel bg={side.tint} radius={36} style={{ width: 300, height: 330, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Avatar slug={side.slug} expression="cool" size={150} outfit={side.outfit} />
            <div style={{ fontSize: 44, lineHeight: 1 }}>{side.name}</div>
            <Pill bg={C.sun} size={34} style={{ transform: `scale(${1 + 0.25 * Math.max(0, ...bets.filter((b) => b.on === k).map((b) => 1 - Math.abs(f - b.at - 16) / 6))})` }}>🪙 × {n}</Pill>
          </Panel>
        </Pop>
      )
    })}
    {bets.map((b, k) => {
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
      <Bubble size={36} bg={C.sun}>Je parie sur {d.a.name} !</Bubble>
    </Pop>
  </>
)
