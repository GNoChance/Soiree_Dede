// Tuto « Dédé Kart » : circuit stylisé (fausse 3D) dans un téléphone tenu à l'horizontale.
// Conduite + aide, objet (Poule en vadrouille), raccourci au portique violet, défilé des 6 circuits.
import React from 'react'
import { C, DISPLAY, sticker, type Slug } from '../../theme'
import { Avatar, Chibi, Outlined, Panel, Pill, Pop, SPRING, Sfx, TW, bySlug, clamp01, easeInOut, lerp, ramp, sp } from '../kit'
import { Phone } from '../parts'
import type { MockScene, TutoSpec } from '../types'

const PW = 664
const PH = 380
const SW = PW - 34 // écran intérieur ≈ 630 × 346
const SH = PH - 34
const HORIZON = 120
const CX = SW / 2

/** Couleurs d'un circuit (reprises de `tracks.ts`). */
type Theme = { sky: string; ground: string; road: string; kerb: string }
const MEADOW: Theme = { sky: '#7fd4f7', ground: '#7ed957', road: '#6b6485', kerb: '#ffffff' }
const SALON: Theme = { sky: '#9ADCFF', ground: '#F2C894', road: '#5B5F77', kerb: '#FF5A5F' }

const yAt = (t: number) => lerp(HORIZON, SH, t)
/** Demi-largeur de la chaussée à la profondeur `t` (0 = horizon, 1 = bas de l'écran). */
const halfAt = (t: number, w = 1) => lerp(22, 290, t) * w

const Kart: React.FC<{ slug: Slug; x: number; y?: number; tilt?: number; size?: number; boost?: number; expr?: string; f: number }> = ({ slug, x, y = 0, tilt = 0, size = 150, boost = 0, expr = 'gamer', f }) => (
  <div style={{ position: 'absolute', left: CX + x - size / 2, top: SH - size * 1.02 + y, width: size, height: size, transform: `rotate(${tilt}deg) translateY(${Math.sin(f / 2) * 2}px)`, zIndex: 6 }}>
    {boost > 0 && [0, 1].map((k) => (
      <div key={k} style={{ position: 'absolute', left: size * (0.2 + k * 0.42), top: size * 0.86, fontSize: size * 0.32 * (0.8 + boost * 0.5 + 0.2 * Math.sin(f + k)), lineHeight: 1, transform: 'rotate(180deg)' }}>🔥</div>
    ))}
    <div style={{ position: 'absolute', left: 0, top: size * 0.62, width: size * 0.24, height: size * 0.36, borderRadius: size * 0.08, background: C.ink }} />
    <div style={{ position: 'absolute', right: 0, top: size * 0.62, width: size * 0.24, height: size * 0.36, borderRadius: size * 0.08, background: C.ink }} />
    <div style={{ position: 'absolute', left: size * 0.14, top: size * 0.5, width: size * 0.72, height: size * 0.42, borderRadius: `${size * 0.16}px ${size * 0.16}px ${size * 0.08}px ${size * 0.08}px`, background: bySlug(slug).color, border: `4px solid ${C.ink}`, boxSizing: 'border-box' }} />
    <div style={{ position: 'absolute', left: size * 0.3, top: size * 0.72, width: size * 0.4, height: size * 0.1, borderRadius: 6, background: C.ink, opacity: 0.6 }} />
    <div style={{ position: 'absolute', left: size * 0.16, top: -size * 0.04 }}><Chibi slug={slug} expression={expr} size={size * 0.68} thumb /></div>
  </div>
)

/** Route en fausse perspective ; `curve` décale le point de fuite (px), `dist` fait défiler les bandes, `w` = largeur relative. */
const Road: React.FC<{ f: number; curve?: number; dist?: number; w?: number; theme?: Theme; children?: React.ReactNode; shake?: number }> = ({ f, curve = 0, dist = f, w = 1, theme = MEADOW, children, shake = 0 }) => {
  const vx = CX + curve
  const xAt = (t: number) => lerp(vx, CX, t)
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', transform: `translate(${Math.sin(f * 2.3) * shake}px, ${Math.cos(f * 3.1) * shake}px)` }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: HORIZON, background: theme.sky }} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: HORIZON, background: 'linear-gradient(rgba(255,255,255,0), rgba(255,255,255,0.6))' }} />
      <div style={{ position: 'absolute', left: 60 - curve * 0.3, top: 30, fontSize: 50, lineHeight: 1 }}>☁️</div>
      <div style={{ position: 'absolute', left: 430 - curve * 0.3, top: 50, fontSize: 40, lineHeight: 1 }}>☁️</div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: HORIZON, bottom: 0, background: theme.ground }} />
      <svg width={SW} height={SH} style={{ position: 'absolute', left: 0, top: 0 }}>
        <polygon points={`${vx - 26 * w},${HORIZON} ${vx + 26 * w},${HORIZON} ${CX + 330 * w},${SH} ${CX - 330 * w},${SH}`} fill={theme.kerb} />
        <polygon points={`${vx - 22 * w},${HORIZON} ${vx + 22 * w},${HORIZON} ${CX + 290 * w},${SH} ${CX - 290 * w},${SH}`} fill={theme.road} />
        {[0, 1, 2, 3, 4].map((j) => {
          const t = Math.pow((((dist * 0.035 + j / 5) % 1) + 1) % 1, 2)
          const y = yAt(t)
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
/** Petite étiquette posée dans l'écran du téléphone. */
const Tag: React.FC<{ bg?: string; color?: string; left?: number; center?: boolean; children?: React.ReactNode }> = ({ bg = '#ffffff', color = C.ink, left = 12, center, children }) => (
  <div style={{ position: 'absolute', top: 10, left: center ? 0 : left, right: center ? 0 : undefined, display: 'flex', justifyContent: 'center', zIndex: 12 }}>
    <Pill bg={bg} color={color} size={22} style={{ boxShadow: sticker(3), border: `3px solid ${C.ink}` }}>{children}</Pill>
  </div>
)
const Flash: React.FC<{ f: number; at: number }> = ({ f, at }) => (
  <div style={{ position: 'absolute', inset: 0, background: '#ffffff', opacity: f >= at - 3 ? 1 - ramp(f, at, at + 9) : 0, zIndex: 30 }} />
)
/** Bouton OBJET (en bas à gauche comme dans l'appli), nom de l'objet au-dessus. */
const ItemSlot: React.FC<{ children?: React.ReactNode; pressed?: boolean; glow?: boolean; label?: string }> = ({ children, pressed, glow, label }) => (
  <>
    {label && (
      <div style={{ position: 'absolute', left: 12, bottom: 118, zIndex: 10 }}>
        <Pill bg="#ffffff" size={20} style={{ boxShadow: sticker(3), border: `3px solid ${C.ink}` }}>{label}</Pill>
      </div>
    )}
    <div style={{ position: 'absolute', left: 14, bottom: 14, width: 96, height: 96, borderRadius: 24, background: glow ? C.sun : '#ffffffcc', border: `4px solid ${C.ink}`, boxSizing: 'border-box', boxShadow: sticker(pressed ? 1 : 4), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 56, lineHeight: 1, zIndex: 10, transform: pressed ? 'translate(3px, 3px)' : undefined }}>
      {children ?? <Outlined size={22} color={C.muted} stroke={0} style={{ WebkitTextStroke: '0', textShadow: 'none', letterSpacing: 0 }}>OBJET</Outlined>}
    </div>
  </>
)

// 1 — Tourner : un doigt à gauche ou à droite ; écran lâché, le kart se remet droit
const D_TOP = 96
const LET_GO = 114
const Steering: MockScene = ({ f }) => {
  const left = f >= 30 && f < 64
  const right = f >= 80 && f < LET_GO
  const dir = left ? -1 : right ? 1 : 0
  const tl = ramp(f, 30, 42) * (1 - ramp(f, 64, 76))
  const trIn = ramp(f, 80, 92)
  const back = easeInOut(ramp(f, LET_GO + 12, LET_GO + 44))
  const x = -tl * 150 + trIn * 215 * (1 - back)
  const curve = (-tl + trIn * (1 - ramp(f, LET_GO, LET_GO + 12))) * 130
  const tilt = (-tl + trIn * (1 - ramp(f, LET_GO, LET_GO + 8))) * 10 - Math.sin(back * Math.PI) * 7
  const released = f >= LET_GO
  return (
    <>
      <Device f={f} top={D_TOP}>
        <Road f={f} curve={curve}>
          {[0, 1].map((k) => (
            <div key={k} style={{ position: 'absolute', left: k ? '50%' : 0, top: 0, width: '50%', height: '100%', background: (k ? right : left) ? '#ffffff55' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: k ? 'flex-end' : 'flex-start', padding: '0 16px', boxSizing: 'border-box', zIndex: 8 }}>
              <Outlined size={70} color={(k ? right : left) ? C.sun : '#ffffff'} stroke={3} style={{ opacity: (k ? right : left) ? 1 : released ? 0.2 : 0.5 }}>{k ? '▶' : '◀'}</Outlined>
            </div>
          ))}
          <Kart slug="kevin" x={x} tilt={tilt} f={f} />
          {released && back > 0 && back < 1 && (
            <div style={{ position: 'absolute', left: CX + x - 150, top: SH - 120, zIndex: 9 }}><Outlined size={64} color={C.mint} stroke={3}>⬅</Outlined></div>
          )}
          {released && <Tag bg={C.mint} center>✋ Écran lâché</Tag>}
          <Dot x={dir < 0 ? 90 : 540} y={250} on={dir ? 1 : 0} />
        </Road>
      </Device>
      <Pop f={f} at={10} rot={-2} style={{ position: 'absolute', left: 0, right: 0, top: D_TOP + PH + 40, display: 'flex', justifyContent: 'center' }}>
        <Pill bg={C.mint} size={38}>🚀 Ça accélère tout seul !</Pill>
      </Pop>
      <Pop f={f} at={34} rot={2} style={{ position: 'absolute', left: 30, top: D_TOP + PH + 130 }}>
        <Pill bg={left ? C.sun : C.surface} size={32}>👈 doigt à gauche</Pill>
      </Pop>
      <Pop f={f} at={84} rot={-2} style={{ position: 'absolute', left: 384, top: D_TOP + PH + 130 }}>
        <Pill bg={right ? C.sun : C.surface} size={32}>doigt à droite 👉</Pill>
      </Pop>
      <div style={{ position: 'absolute', left: 0, right: 0, top: D_TOP + PH + 218, display: 'flex', justifyContent: 'center' }}>
        <Pop f={f} at={LET_GO + 4} rot={-1} from={40}>
          <Panel bg={C.sun} radius={30} style={{ padding: '18px 34px 10px', fontSize: 38, lineHeight: 1.15, textAlign: 'center' }}>
            ✋ Tu lâches l’écran ?<br />Il se remet droit tout seul !
          </Panel>
        </Pop>
      </div>
      <Sfx name="tap" at={30} volume={0.8} />
      <Sfx name="tap" at={80} volume={0.8} />
      <Sfx name="pop" at={LET_GO + 4} volume={0.6} />
      <Sfx name="success" at={LET_GO + 44} volume={0.4} />
    </>
  )
}

// 2 — Boîtes « ? », bouton OBJET, et une Poule en vadrouille pour celui qui suit
const GRAB = 36
const SPIN = 20
const USE = 80
const SWAP = 102
const HIT = 142
const ROULETTE = ['🧲', '🧈', '🚀', '📯', '🍯', '🎳']
const Items: MockScene = ({ f }) => {
  const t = Math.pow(ramp(f, 4, GRAB), 2)
  const has = f >= GRAB && f < USE
  const spin = f < GRAB + SPIN
  const chase = f >= SWAP
  // vue de Dédé : la poule traverse la piste en zigzag, de plus en plus près
  const ht = lerp(0.1, 0.78, Math.pow(ramp(f, SWAP, HIT), 1.4))
  const hx = Math.sin(f * 0.3) * halfAt(ht) * 0.75 * (1 - ramp(f, HIT - 10, HIT))
  const hs = 34 + ht * 90
  const spun = ramp(f, HIT, HIT + 32)
  const dist = f < HIT ? f : HIT + (f - HIT) * 0.25
  return (
    <>
      <Device f={f} top={D_TOP}>
        {!chase ? (
          <Road f={f}>
            {f < GRAB && (
              <div style={{ position: 'absolute', left: CX - (20 + t * 50), top: lerp(HORIZON - 10, SH - 250, t), width: 40 + t * 100, height: 40 + t * 100, borderRadius: 10 + t * 16, background: C.sun, border: `${2 + t * 4}px solid ${C.ink}`, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `rotate(${Math.sin(f / 5) * 8}deg)`, zIndex: 5 }}>
                <Outlined size={26 + t * 70} color="#ffffff" stroke={2 + t * 2}>?</Outlined>
              </div>
            )}
            {f >= USE + 2 && (
              <div style={{ position: 'absolute', left: CX - 45, top: lerp(SH - 130, SH - 30, ramp(f, USE + 2, USE + 20)), fontSize: 90, lineHeight: 1, zIndex: 7, transform: `rotate(${Math.sin(f) * 10}deg)` }}>🐔</div>
            )}
            <Kart slug="manon" x={0} y={-70} f={f} />
            <Tag>📱 Manon</Tag>
            <ItemSlot glow={has && !spin} pressed={f >= USE && f < USE + 8} label={has && !spin ? 'Poule en vadrouille' : undefined}>
              {has ? <span style={{ transform: `scale(${spin ? 1 : 0.7 + 0.3 * sp(f, GRAB + SPIN, SPRING.pop)})`, display: 'inline-block' }}>{spin ? ROULETTE[Math.floor(Math.max(0, f) / 3) % ROULETTE.length] : '🐔'}</span> : undefined}
            </ItemSlot>
            <Dot x={62} y={SH - 62} on={ramp(f, USE - 14, USE - 6) * (1 - ramp(f, USE + 8, USE + 14))} />
          </Road>
        ) : (
          <Road f={f} dist={dist} shake={f >= HIT ? (1 - spun) * 5 : 0}>
            {f < HIT && (
              <div style={{ position: 'absolute', left: CX + hx - hs / 2, top: yAt(ht) - hs * 0.9 - Math.abs(Math.sin(f * 0.9)) * 10, fontSize: hs, lineHeight: 1, zIndex: 5, transform: `scaleX(${Math.cos(f * 0.3) < 0 ? -1 : 1})` }}>🐔</div>
            )}
            <div style={{ position: 'absolute', inset: 0, transform: `rotate(${(1 - Math.pow(1 - spun, 2)) * 720}deg)`, transformOrigin: `${CX}px ${SH - 70}px`, zIndex: 6 }}>
              <Kart slug="dede" x={0} f={f} expr={f >= HIT ? 'pleurs' : f >= HIT - 22 ? 'surprise' : 'gamer'} />
            </div>
            {f >= HIT && f < HIT + 24 && Array.from({ length: 10 }, (_, k) => {
              const p = ramp(f, HIT, HIT + 24)
              const a = (k / 10) * Math.PI * 2
              return <div key={k} style={{ position: 'absolute', left: CX + Math.cos(a) * p * 190 - 12, top: SH - 110 + Math.sin(a) * p * 130 + p * p * 60, fontSize: 30, lineHeight: 1, opacity: 1 - p * p, transform: `rotate(${k * 50 + f * 14}deg)`, zIndex: 9 }}>🪶</div>
            })}
            <Tag>📱 Dédé, juste derrière…</Tag>
            <ItemSlot />
          </Road>
        )}
        <Flash f={f} at={SWAP} />
      </Device>
      <Pop f={f} at={GRAB + 4} rot={-2} style={{ position: 'absolute', left: 50, top: D_TOP + PH + 40 }}>
        <Pill bg={C.sun} size={38}>🎁 Boîte « ? » = un objet au hasard</Pill>
      </Pop>
      <div style={{ position: 'absolute', left: 0, right: 0, top: D_TOP + PH + 130, display: 'flex', justifyContent: 'center' }}>
        <Pop f={f} at={GRAB + SPIN + 4} rot={2}><Pill bg={C.surface} size={36}>🐔 Poule en vadrouille : lâche-la !</Pill></Pop>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: D_TOP + PH + 222, display: 'flex', justifyContent: 'center' }}>
        <Pop f={f} at={HIT + 4} rot={-5}><Outlined size={88} color={C.tomato}>Tête-à-queue !</Outlined></Pop>
      </div>
      <Sfx name="pop" at={GRAB} volume={0.8} />
      {Array.from({ length: 5 }, (_, k) => <Sfx key={k} name="type" at={GRAB + 2 + k * 4} volume={0.7} />)}
      <Sfx name="success" at={GRAB + SPIN + 2} volume={0.4} />
      <Sfx name="tap" at={USE} volume={0.9} />
      <Sfx name="pop" at={USE + 3} volume={0.7} />
      <Sfx name="whoosh" at={SWAP - 2} volume={0.5} />
      <Sfx name="pop" at={HIT} volume={0.9} />
      <Sfx name="whoosh" at={HIT + 2} volume={0.9} />
    </>
  )
}

// 3 — Le raccourci : portique violet, chemin étroit, et la mini-carte qui montre le gain
const S_TOP = 30
const ENTER = 60
const CUT_COLOR = '#B98A5E' // « Sous le canapé » (Circuit du Salon)
const MAP_W = 600
const MAP_H = 200
type P2 = [number, number]
const MAIN: P2[] = [[30, 160], [200, 160], [200, 44], [400, 44], [400, 160], [570, 160]]
const VIA_CUT: P2[] = [[30, 160], [200, 160], [400, 160], [570, 160]]
const along = (pts: P2[], d: number): P2 => {
  let rest = Math.max(0, d)
  for (let k = 0; k < pts.length - 1; k++) {
    const [ax, ay] = pts[k]
    const [bx, by] = pts[k + 1]
    const len = Math.hypot(bx - ax, by - ay)
    if (rest <= len) return [lerp(ax, bx, rest / len), lerp(ay, by, rest / len)]
    rest -= len
  }
  return pts[pts.length - 1]
}
const Gate: React.FC<{ t: number }> = ({ t }) => {
  const s = 0.2 + t * 1.1
  const ex = CX - halfAt(t)
  const y = yAt(t)
  const gw = 230 * s
  const gh = 190 * s
  const edge = (yy: number) => CX - halfAt((yy - HORIZON) / (SH - HORIZON))
  const y0 = y - 16 * s
  const y1 = y + 34 * s
  const lx = ex - gw * 2
  return (
    <>
      <svg width={SW} height={SH} style={{ position: 'absolute', left: 0, top: 0, zIndex: 2 }}>
        <polygon points={`${ex + gw * 0.36},${y0} ${ex + gw * 0.46},${y1} ${lx},${y1 - 46 * s} ${lx},${y0 - 30 * s}`} fill={CUT_COLOR} stroke={C.grape} strokeWidth={2 + 3 * s} strokeLinejoin="round" />
      </svg>
      <div style={{ position: 'absolute', left: ex - gw * 0.62, top: y - gh + 18 * s, width: gw, height: gh, zIndex: 3 }}>
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 16 * s, background: C.ink, borderRadius: 4 * s }} />
        <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 16 * s, background: C.ink, borderRadius: 4 * s }} />
        <div style={{ position: 'absolute', left: -8 * s, right: -8 * s, top: 0, height: 14 * s, background: `repeating-linear-gradient(90deg, ${C.ink} 0 ${14 * s}px, #ffffff ${14 * s}px ${28 * s}px)`, border: `${2 * s}px solid ${C.ink}`, boxSizing: 'border-box' }} />
        <div style={{ position: 'absolute', left: -8 * s, right: -8 * s, top: 13 * s, height: 62 * s, background: C.grape, border: `${Math.max(2, 4 * s)}px solid ${C.ink}`, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffffff', fontFamily: DISPLAY, fontWeight: 800, fontSize: 36 * s, lineHeight: 1, letterSpacing: 0.5 * s }}>
          <span style={{ transform: 'translateY(8%)' }}>RACCOURCI</span>
        </div>
      </div>
    </>
  )
}
const Shortcut: MockScene = ({ f }) => {
  const inCut = f >= ENTER
  const t = Math.pow(ramp(f, 0, ENTER), 1.5) * 0.66
  const steer = ramp(f, ENTER - 24, ENTER)
  const SPEED = 170 / ENTER
  const [kx, ky] = along(VIA_CUT, Math.max(0, f) * SPEED)
  const [mx, my] = along(MAIN, 70 + Math.max(0, f) * SPEED)
  const ahead = f >= 132
  return (
    <>
      <Device f={f} top={S_TOP}>
        {!inCut ? (
          <Road f={f} theme={SALON} curve={-steer * 60}>
            <Gate t={t} />
            <Kart slug="kevin" x={-steer * 150} tilt={-steer * 12} f={f} />
            <Dot x={70} y={296} on={ramp(f, ENTER - 26, ENTER - 20)} />
          </Road>
        ) : (
          <Road f={f} theme={{ ...SALON, road: CUT_COLOR, kerb: C.grape }} w={0.5} dist={f * 1.3}>
            {[0, 1].map((k) => (
              <div key={k} style={{ position: 'absolute', left: k ? undefined : 16, right: k ? 16 : undefined, top: 190, zIndex: 4, transform: `rotate(${k ? 6 : -6}deg)` }}>
                <Pill bg={C.tomato} color="#ffffff" size={22} style={{ boxShadow: sticker(3), border: `3px solid ${C.ink}` }}>🐌 très lent</Pill>
              </div>
            ))}
            <Kart slug="kevin" x={Math.sin(f / 6) * 34} tilt={Math.cos(f / 6) * 5} f={f} />
            <Tag bg={C.grape} color="#ffffff" center>⚡ Sous le canapé</Tag>
          </Road>
        )}
        <Flash f={f} at={ENTER} />
      </Device>
      <Pop f={f} at={6} from={40} style={{ position: 'absolute', left: (TW - MAP_W - 44) / 2, top: S_TOP + PH + 26 }}>
        <Panel bg="#5b9bc4" radius={34} style={{ width: MAP_W + 44, height: MAP_H + 34, padding: '12px 17px', position: 'relative' }}>
          <svg width={MAP_W} height={MAP_H}>
            <polyline points={MAIN.map((p) => p.join(',')).join(' ')} fill="none" stroke={C.ink} strokeWidth={34} strokeLinejoin="round" strokeLinecap="round" />
            <polyline points={MAIN.map((p) => p.join(',')).join(' ')} fill="none" stroke="#ffffff" strokeWidth={22} strokeLinejoin="round" strokeLinecap="round" />
            <line x1={214} y1={160} x2={386} y2={160} stroke="#5b9bc4" strokeWidth={24} />
            <line x1={206} y1={160} x2={394} y2={160} stroke={inCut ? C.sun : '#d9c8ff'} strokeWidth={9} strokeDasharray="14 10" strokeLinecap="round" />
            <text x={300} y={118} textAnchor="middle" fontSize={26} fontWeight={800} fill="#ffffff" stroke={C.ink} strokeWidth={5} paintOrder="stroke" style={{ fontFamily: DISPLAY }}>RACCOURCI</text>
          </svg>
          <div style={{ position: 'absolute', left: 17 + mx - 27, top: 12 + my - 27 }}><Avatar slug="mika" expression={ahead ? 'surprise' : 'cool'} size={54} /></div>
          <div style={{ position: 'absolute', left: 17 + kx - 30, top: 12 + ky - 30, transform: `scale(${1 + 0.12 * Math.sin(f / 3)})` }}><Avatar slug="kevin" expression="joie" size={60} ring={inCut} /></div>
        </Panel>
      </Pop>
      <Pop f={f} at={ENTER + 6} rot={-2} style={{ position: 'absolute', left: 30, top: S_TOP + PH + 282 }}>
        <Pill bg={C.mint} size={34}>⚡ Plus court…</Pill>
      </Pop>
      <Pop f={f} at={ENTER + 34} rot={2} style={{ position: 'absolute', right: 30, top: S_TOP + PH + 282 }}>
        <Pill bg={C.surface} size={34}>…mais très étroit !</Pill>
      </Pop>
      <div style={{ position: 'absolute', left: 0, right: 0, top: S_TOP + PH + 364, display: 'flex', justifyContent: 'center' }}>
        <Pop f={f} at={ENTER + 62} rot={-1}><Pill bg={C.sun} size={34}>⚠️ Gare à la sortie de route !</Pill></Pop>
      </div>
      <Sfx name="tap" at={ENTER - 24} volume={0.8} />
      <Sfx name="whoosh" at={ENTER - 2} volume={0.8} />
      <Sfx name="pop" at={ENTER + 8} volume={0.6} />
      <Sfx name="pop" at={ENTER + 36} volume={0.6} />
      <Sfx name="success" at={132} volume={0.5} />
    </>
  )
}

// 4 — Les six circuits, chacun avec ses obstacles qui traversent
type Circuit = { emoji: string; name: string; theme: Theme; decor: string; mover: string; moverName: string; roll?: boolean }
const CIRCUITS: Circuit[] = [
  { emoji: '🛋️', name: 'Circuit du Salon', theme: SALON, decor: '🛋️', mover: '🤖', moverName: 'aspirateurs robots' },
  { emoji: '🏖️', name: 'Plage Tongs-Palace', theme: { sky: '#7FD1FF', ground: '#F7D9A0', road: '#6E4A33', kerb: '#2EC4B6' }, decor: '⛱️', mover: '🦀', moverName: 'crabes' },
  { emoji: '🏔️', name: 'Montagne Raclette', theme: { sky: '#8EC5F4', ground: '#EEF4FF', road: '#5B5F77', kerb: '#3A86FF' }, decor: '🌲', mover: '🧀', moverName: 'meules de fromage', roll: true },
  { emoji: '🥕', name: 'Potager Turbo-Carotte', theme: { sky: '#A6E3FF', ground: '#8FD46A', road: '#B8875A', kerb: '#FF8C42' }, decor: '🌻', mover: '🎃', moverName: 'citrouilles', roll: true },
  { emoji: '🛒', name: 'Hyper Dédé Promo', theme: { sky: '#DDEBFA', ground: '#E9E4DA', road: '#4D556B', kerb: '#E63946' }, decor: '🏷️', mover: '🛒', moverName: 'caddies fous' },
  { emoji: '🏰', name: 'Château Saint-Glinglin', theme: { sky: '#FFC9A3', ground: '#7FB069', road: '#8A8578', kerb: '#9D2235' }, decor: '🏰', mover: '🛢️', moverName: 'tonneaux', roll: true },
]
const EACH = 25
const Circuits: MockScene = ({ f }) => {
  const ff = Math.max(0, f)
  const k = Math.min(CIRCUITS.length - 1, Math.floor(ff / EACH))
  const c = CIRCUITS[k]
  const local = ff - k * EACH
  const p = clamp01(local / EACH)
  const side = k % 2 ? -1 : 1
  return (
    <>
      <Device f={f} top={S_TOP}>
        <Road f={f} theme={c.theme} dist={f * 1.2}>
          {[0, 1].map((j) => (
            <div key={j} style={{ position: 'absolute', left: j ? SW - 150 : 70, top: HORIZON - 62, fontSize: 64, lineHeight: 1, zIndex: 1 }}>{c.decor}</div>
          ))}
          <div style={{ position: 'absolute', left: CX + side * lerp(-230, 230, p) - 36, top: 150 - Math.abs(Math.sin(local * 0.6)) * 8, fontSize: 64, lineHeight: 1, zIndex: 5, transform: c.roll ? `rotate(${side * local * 22}deg)` : `scaleX(${-side})` }}>{c.mover}</div>
          <Kart slug="kevin" x={Math.sin(f / 8) * 46} tilt={Math.cos(f / 8) * 5} f={f} />
          <div key={k} style={{ position: 'absolute', left: 0, right: 0, top: 10, display: 'flex', justifyContent: 'center', zIndex: 12, transform: `scale(${0.6 + 0.4 * sp(ff, k * EACH, SPRING.snappy)})` }}>
            <Pill bg="#ffffff" size={26} style={{ boxShadow: sticker(3), border: `3px solid ${C.ink}` }}>{c.emoji} {c.name}</Pill>
          </div>
          {k > 0 && <Flash f={ff} at={k * EACH + 1} />}
        </Road>
      </Device>
      {CIRCUITS.map((ci, j) => (
        <Pop key={j} f={f} at={j * EACH + 2} from={30} rot={j % 2 ? 1 : -1} style={{ position: 'absolute', left: 30 + (j % 2) * 336, top: S_TOP + PH + 30 + Math.floor(j / 2) * 136 }}>
          <Panel bg={j === k ? C.sun : C.surface} radius={28} shadow={6} style={{ width: 324, height: 118, display: 'flex', alignItems: 'center', gap: 12, padding: '6px 12px 0 14px' }}>
            <div style={{ fontSize: 50, lineHeight: 1, width: 58, textAlign: 'center', flexShrink: 0 }}>{ci.emoji}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 27, lineHeight: 1.02 }}>{ci.name}</div>
              <div style={{ fontSize: 22, lineHeight: 1.2, color: j === k ? C.ink : C.muted, whiteSpace: 'nowrap' }}>{ci.mover} {ci.moverName}</div>
            </div>
          </Panel>
        </Pop>
      ))}
      {CIRCUITS.map((_, j) => <Sfx key={j} name="pop" at={j * EACH + 4} volume={0.55} />)}
    </>
  )
}

// Scène finale : le barème d'une course (15, 12, 10, 8…)
const BOARD: { slug: Slug; name: string; pts: number; medal: string }[] = [
  { slug: 'manon', name: 'Manon', pts: 15, medal: '🥇' },
  { slug: 'kevin', name: 'Keke', pts: 12, medal: '🥈' },
  { slug: 'mika', name: 'Mika', pts: 10, medal: '🥉' },
  { slug: 'dede', name: 'Dédé', pts: 8, medal: '4e' },
]
const Board: React.FC<{ f: number }> = ({ f }) => (
  <>
    {BOARD.map((b, i) => (
      <Pop key={b.slug} f={f} at={14 + i * 4} from={40} style={{ position: 'absolute', left: 36 + (i % 2) * 330, top: Math.floor(i / 2) * 112, width: 318 }}>
        <Panel bg={i === 0 ? C.sun : C.surface} radius={26} shadow={6} style={{ height: 98, display: 'flex', alignItems: 'center', gap: 8, padding: '0 16px 0 12px' }}>
          <Avatar slug={b.slug} expression={i === 3 ? 'boude' : i === 0 ? 'joie' : 'cool'} size={70} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 32, lineHeight: 1 }}>{b.name}</div>
            <div style={{ fontSize: 22, lineHeight: 1.1, color: i === 0 ? C.ink : C.muted }}>{b.medal}</div>
          </div>
          <div style={{ fontSize: 46, lineHeight: 1, color: i === 0 ? C.ink : C.tangerine }}>+{Math.round(b.pts * ramp(f, 20 + i * 4, 36 + i * 4))}</div>
        </Panel>
      </Pop>
    ))}
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
    { text: 'Pose le doigt à gauche ou à droite pour tourner', seconds: 6, Mock: Steering },
    { text: 'Roule sur les boîtes « ? » et touche OBJET pour l’utiliser', seconds: 6.2, Mock: Items },
    { text: 'Portique violet = raccourci : plus court, mais risqué !', seconds: 5.6, Mock: Shortcut },
    { text: 'Six circuits, chacun avec ses pièges et son raccourci', seconds: 5.4, Mock: Circuits },
  ],
  win: {
    text: 'Le meilleur total gagne la coupe !',
    // espaces insécables : la 2e phrase passe d'un bloc à la ligne
    sub: 'Des points à chaque course. En 1 course ou en coupe de 3.',
    winners: ['manon'],
    Board,
  },
}
