// Les 6 temps « pub » de la vidéo de Noël (après le glaçon). Chaque scène reçoit `f` = images depuis son début (30 FPS).
// Zones à ne pas charger : coin haut-droit (bouton « Passer » de l'appli) et bas-centre sous y ≈ 1150 (bouton 🔊).
import React from 'react'
import { AbsoluteFill, Img, random, staticFile } from 'remotion'
import { C, DISPLAY, sticker } from '../theme'
import { Bubble, ConfettiBurst, Outlined, Panel, Pill, Pop, SPRING, TH, TW, bob, clamp01, easeIn, easeInOut, lerp, nb, ramp, sp, wiggle } from '../tuto/kit'
import { BEAT, Flake, N, Sparkle, shake, step3 } from './fx'
import { F_NOEL, Shards } from './take'
import { Sfx } from './sfx'
import { NOEL } from './script'

export type Scene = React.FC<{ f: number }>

export type Perso = 'kevin' | 'cycy' | 'dede' | 'manon' | 'mika' | 'cecile' | 'carole' | 'marius' | 'nini' | 'cycy2'
export const BAND: Perso[] = ['kevin', 'dede', 'cycy', 'manon', 'mika', 'cecile', 'carole', 'marius', 'nini', 'cycy2']

export const outExpo = (p: number) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp01(p)))
export const outBack = (p: number) => {
  const c1 = 1.9
  const x = clamp01(p) - 1
  return 1 + (c1 + 1) * x * x * x + c1 * x * x
}

// ---------------------------------------------------------------------------
// Briques communes
// ---------------------------------------------------------------------------
const SNOW = Array.from({ length: 16 }, (_, k) => ({
  x: random(`nx${k}`) * TW,
  y: random(`ny${k}`) * TH,
  s: 8 + random(`ns${k}`) * 12,
  v: 1.3 + random(`nv${k}`) * 1.7,
  big: k % 4 === 0,
}))
/** Neige lente (peu de flocons : un fond calme se compresse bien). */
export const Snow: React.FC<{ f: number }> = ({ f }) => (
  <AbsoluteFill style={{ overflow: 'hidden' }}>
    {SNOW.map((c, k) => {
      const y = ((c.y + f * c.v) % (TH + 80)) - 40
      const x = c.x + Math.sin((f + k * 37) / 34) * 18 + f * 0.9
      const xx = ((x % (TW + 60)) + TW + 60) % (TW + 60) - 30
      return c.big ? (
        <Flake key={k} size={c.s * 2.4} style={{ position: 'absolute', left: xx, top: y, opacity: 0.85, transform: `rotate(${f * 0.7 + k * 40}deg)` }} />
      ) : (
        <div key={k} style={{ position: 'absolute', left: xx, top: y, width: c.s, height: c.s, borderRadius: '50%', background: '#ffffff', opacity: 0.8 }} />
      )
    })}
  </AbsoluteFill>
)

export const Ground: React.FC = () => (
  <svg width={TW} height={90} style={{ position: 'absolute', left: 0, top: TH - 90 }}>
    <path d="M-10,40 Q90,4 200,30 T420,26 T620,22 T740,34 L740,100 L-10,100 Z" fill="#ffffff" stroke={C.ink} strokeWidth={5} />
  </svg>
)

/** Fond commun de scène : couleur pleine + halo + pois + neige + sol enneigé. */
export const SceneBg: React.FC<{ f: number; bg?: string; ground?: boolean }> = ({ f, bg, ground = true }) => (
  <>
    {bg && (
      <>
        <AbsoluteFill style={{ background: bg }} />
        <AbsoluteFill style={{ background: 'radial-gradient(circle at 50% 40%, rgba(255,255,255,0.24), rgba(255,255,255,0) 64%)' }} />
        <AbsoluteFill style={{ backgroundImage: 'radial-gradient(rgba(0,0,0,0.1) 3px, transparent 3.6px)', backgroundSize: '40px 40px' }} />
      </>
    )}
    <Snow f={f} />
    {ground && <Ground />}
  </>
)

export const Row: React.FC<{ top: number; children?: React.ReactNode; style?: React.CSSProperties }> = ({ top, children, style }) => (
  <div style={{ position: 'absolute', left: 0, right: 0, top, display: 'flex', justifyContent: 'center', ...style }}>{children}</div>
)

/** Pastille-titre d'un temps. */
export const Header: React.FC<{ f: number; at?: number; top?: number; children?: React.ReactNode }> = ({ f, at = 0, top = 126, children }) => (
  <Row top={top}>
    <Pop f={f} at={at} rot={-3} from={-60}>
      <Pill bg={C.surface} size={46}>{children}</Pill>
    </Pop>
  </Row>
)

/** Grande phrase cernée d'encre. */
export const Big: React.FC<{ f: number; at?: number; top?: number; size?: number; color?: string; from?: number; children?: React.ReactNode }> = ({ f, at = 8, top = 224, size = 62, color = N.gold, from = 40, children }) => (
  <div style={{ position: 'absolute', left: 12, right: 12, top }}>
    <Pop f={f} at={at} from={from}><Outlined size={size} color={color}>{children}</Outlined></Pop>
  </div>
)

/** Chibi en tenue Père Noël (planche `<slug>/santa`). */
export const Santa: React.FC<{ slug: Perso; expr?: string; size: number; flip?: boolean; style?: React.CSSProperties }> = ({ slug, expr = 'joie', size, flip, style }) => (
  <Img src={staticFile(`chibis/${slug}/santa/${expr}.webp`)} style={{ width: size, height: size, objectFit: 'contain', display: 'block', transform: flip ? 'scaleX(-1)' : undefined, ...style }} />
)
/** Chibi en tenue de base. */
export const Basic: React.FC<{ slug: Perso; expr?: string; size: number; style?: React.CSSProperties }> = ({ slug, expr = 'joie', size, style }) => (
  <Img src={staticFile(`chibis/${slug}/default/${expr}.webp`)} style={{ width: size, height: size, objectFit: 'contain', display: 'block', ...style }} />
)
/** Portrait de Kéké en Père Noël (hotte, traîneau, renne), 3:4. */
export const Portrait: React.FC<{ w: number; style?: React.CSSProperties }> = ({ w, style }) => (
  <Img src={staticFile('chibis/kevin/portraits/santa-hd.webp')} style={{ width: w, height: (w * 4) / 3, display: 'block', ...style }} />
)

/** Titre de l'événement sur deux lignes, entre un sapin et un cadeau. */
export const Logo: React.FC<{ f: number; at: number; top: number; scale?: number; lines: readonly [string, string] }> = ({ f, at, top, scale = 1, lines }) => (
  <div style={{ position: 'absolute', left: 0, right: 0, top, height: 290, transform: `scale(${scale})`, transformOrigin: '50% 0' }}>
    <Pop f={f} at={at} from={-80} rot={-3} cfg={SPRING.pop}><Outlined size={170} color="#ffffff" stroke={7}>{lines[0]}</Outlined></Pop>
    <div style={{ position: 'absolute', left: 0, right: 0, top: 150 }}>
      <Pop f={f} at={at + 5} from={60} rot={-3} cfg={SPRING.pop}><Outlined size={108} color={N.gold} stroke={6}>{lines[1]}</Outlined></Pop>
    </div>
    <Pop f={f} at={at + 9} rot={-12} style={{ position: 'absolute', left: 44, top: 34, fontSize: 104, lineHeight: 1 }}>🎄</Pop>
    <Pop f={f} at={at + 12} rot={12} style={{ position: 'absolute', right: 48, top: 44, fontSize: 96, lineHeight: 1 }}>🎁</Pop>
  </div>
)

const starPoints = (cx: number, cy: number, R: number, r: number) =>
  Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const q = i % 2 ? r : R
    return `${cx + Math.cos(a) * q},${cy + Math.sin(a) * q}`
  }).join(' ')

/** La hotte du Père Noël, ouverte (bord de fourrure blanche). Goulot au centre, à ~28 % de la hauteur. */
export const Sack: React.FC<{ w: number; style?: React.CSSProperties }> = ({ w, style }) => (
  <svg width={w} height={w * 1.1} viewBox="0 0 200 220" style={{ display: 'block', overflow: 'visible', ...style }}>
    <path d="M32,66 C-6,118 0,184 30,202 C62,218 138,218 170,202 C200,184 206,118 168,66 Z" fill="#c1121f" stroke={C.ink} strokeWidth={8} strokeLinejoin="round" />
    <path d="M24,146 C28,172 40,188 56,196" stroke="#ff7b7b" strokeWidth={10} strokeLinecap="round" fill="none" />
    <polygon points={starPoints(104, 142, 34, 15)} fill={N.gold} stroke={C.ink} strokeWidth={6} strokeLinejoin="round" />
    <ellipse cx={100} cy={62} rx={82} ry={29} fill="#ffffff" stroke={C.ink} strokeWidth={8} />
    <ellipse cx={100} cy={60} rx={57} ry={15} fill="#5a0a10" stroke={C.ink} strokeWidth={6} />
  </svg>
)

/** Tampon encreur : tombe de haut (scale 2.4 → 1), choc + onde. */
export const stampK = (f: number, at: number) => {
  const t = f - at
  if (t < 0) return null
  const s = t < 5 ? lerp(2.5, 1, easeIn(t / 5)) : 1 + 0.12 * Math.sin(Math.min(1, (t - 5) / 9) * Math.PI) * (1 - (t - 5) / 12 > 0 ? 1 : 0)
  return { s, op: clamp01(t / 2), ring: t >= 5 ? ramp(t, 5, 15) : 0 }
}

// ---------------------------------------------------------------------------
// 5. Noël débarque (12,0 → 16,0 s) : l'éclat, Kéké en traîneau fonce vers la caméra, « Ho ho ho ! », logo, dates.
// ---------------------------------------------------------------------------
export const Noel: Scene = ({ f }) => {
  const t = NOEL.accroche
  const F = f + F_NOEL
  const q = outExpo(ramp(f, 9, 22))
  const settle = 1 + 0.1 * Math.sin(clamp01((f - 17) / 18) * Math.PI) * (f > 17 ? 1 : 0)
  const beat = f > 36 ? Math.max(0, 1 - (f % BEAT) / 5) : 0
  const kx = lerp(360, 346, q)
  const ky = lerp(560, 836, q) + (f > 34 ? bob(step3(f), 0, 12, 30) : 0)
  const ks = lerp(0.04, 1, q) * settle * (1 + 0.03 * beat)
  const kr = lerp(-14, 0, q) + (f > 34 ? wiggle(step3(f), 0, 1.6, 60) : 0)
  const ringT = ramp(f, 0, 16)
  const flash = [1, 1, 0.7, 0.44, 0.24, 0.1][f] ?? 0
  const sh = shake(f, 0, 14, 16, 'noel')
  const hoOut = 1 - easeIn(ramp(f, 38, 44))
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ transform: `translate(${sh.x}px,${sh.y}px) scale(1.05)` }}>
      <SceneBg f={f} bg={N.green} />
      {/* rayons de lumière qui tournent derrière Kéké */}
      <div style={{ position: 'absolute', left: 360 - 1100, top: 700 - 1100, width: 2200, height: 2200, opacity: clamp01(f / 10) * 0.9, transform: `rotate(8deg) scale(${lerp(0.4, 1, outExpo(ramp(f, 0, 18)))})`, background: 'repeating-conic-gradient(rgba(255,255,255,0.15) 0deg 7.5deg, rgba(255,255,255,0) 7.5deg 15deg)', WebkitMaskImage: 'radial-gradient(circle, #000 0%, #000 22%, transparent 52%)', maskImage: 'radial-gradient(circle, #000 0%, #000 22%, transparent 52%)' }} />
      <Shards f={F} front={false} />
      {/* traits de vitesse : tout fonce vers l'objectif */}
      <svg width={TW} height={TH} style={{ position: 'absolute', left: 0, top: 0, opacity: 1 - ramp(f, 10, 24) }}>
        {Array.from({ length: 26 }, (_, i) => {
          const a = (i / 26) * Math.PI * 2 + random(`sl${i}`) * 0.2
          const r0 = 90 + outExpo(ramp(f, 0, 9)) * (420 + random(`sm${i}`) * 300)
          const r1 = r0 + 150 + random(`sn${i}`) * 260
          const wdt = 0.035 + random(`so${i}`) * 0.03
          const P = (r: number, da: number) => `${360 + Math.cos(a + da) * r},${700 + Math.sin(a + da) * r}`
          return <polygon key={i} points={`${P(r0, -wdt * 0.2)} ${P(r1, 0)} ${P(r0, wdt * 0.2)}`} fill={i % 3 ? '#ffffff' : N.gold} opacity={0.9} />
        })}
      </svg>
      {/* onde de choc */}
      {ringT > 0 && ringT < 1 && (
        <div style={{ position: 'absolute', left: 360 - 60 - ringT * 700, top: 640 - 60 - ringT * 700, width: 120 + ringT * 1400, height: 120 + ringT * 1400, borderRadius: '50%', border: `${Math.round(30 * (1 - ringT)) + 6}px solid #ffffff`, boxShadow: `0 0 0 6px ${C.ink}`, opacity: 1 - ringT * 0.6, boxSizing: 'border-box' }} />
      )}
      <div style={{ position: 'absolute', left: kx - 290, top: ky - 387, width: 580, height: 773, transform: `scale(${ks}) rotate(${kr}deg)`, filter: f < 22 ? `blur(${(1 - q) * 6}px)` : undefined, opacity: ramp(f, 9, 12) }}>
        <Portrait w={580} />
      </div>
      {/* Kéké sort du glaçon TRANSFORMÉ en Père Noël (à la place du Kéké gelé), puis file dans le traîneau */}
      {f < 14 && (() => {
        const pop = f < 6 ? 1 + 0.16 * Math.sin((f / 6) * Math.PI * 0.5) : 1.16
        const away = easeIn(ramp(f, 6, 12))
        const sc = lerp(pop, 0.12, away)
        const x = lerp(445, 360, away)
        const y = lerp(735, 600, away)
        return (
          <div style={{ position: 'absolute', left: x - 270, top: y - 270, width: 540, height: 540, transform: `rotate(${lerp(10, 0, away)}deg) scale(${sc})`, opacity: 1 - ramp(f, 11, 14) }}>
            <Santa slug="kevin" expr={f < 3 ? 'surprise' : 'joie'} size={540} />
          </div>
        )
      })()}
      <Burst f={f} at={0} x={445} y={735} reach={560} seed="tr" />
      <Shards f={F} front />
      {/* « Ho ho ho ! » : un mot par temps fort */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 196, display: 'flex', justifyContent: 'center', gap: 22, transform: `scale(${hoOut})` }}>
        {t.bulle.map((w, k) => (
          <Pop key={k} f={f} at={14 + k * 6} rot={k === 1 ? 4 : -4} from={60} cfg={SPRING.pop}>
            <Outlined size={k === 2 ? 132 : 116} color={k === 1 ? N.gold : '#ffffff'} stroke={6}>{w}</Outlined>
          </Pop>
        ))}
      </div>
      <Logo f={f} at={45} top={112} lines={t.titre} />
      <Pop f={f} at={75} rot={4} cfg={SPRING.pop} style={{ position: 'absolute', right: 20, top: 1044 }}>
        <Panel bg={N.gold} radius={26} shadow={7} style={{ padding: '14px 22px 6px', fontSize: 38, lineHeight: 1.14, textAlign: 'center', whiteSpace: 'nowrap' }}>
          {t.dates[0]}<br />{t.dates[1]}
        </Panel>
      </Pop>
      {[[88, 600, 70, 20], [640, 560, 56, 28], [70, 940, 60, 34], [650, 880, 78, 24]].map(([x, y, s, at], i) => {
        const a = sp(f, at + 20, SPRING.pop)
        const tw = 0.85 + 0.2 * Math.sin((f + i * 7) / 3.5)
        return <Sparkle key={i} size={s * a * tw} style={{ position: 'absolute', left: x - (s * a * tw) / 2, top: y - (s * a * tw) / 2, transform: `rotate(${f * 2}deg)` }} />
      })}
      </AbsoluteFill>
      {flash > 0 && <AbsoluteFill style={{ background: '#ffffff', opacity: flash }} />}
      <Sfx name="shatter" at={0} volume={0.55} />
      <Sfx name="boom" at={0} volume={0.5} />
      <Sfx name="sleigh" at={2} volume={0.4} />
      <Sfx name="whoosh" at={0} volume={0.22} />
      {t.bulle.map((_, k) => <Sfx key={k} name="pop" at={14 + k * 6} volume={0.5} />)}
      <Sfx name="stamp" at={45} volume={0.5} />
      <Sfx name="pop" at={50} volume={0.4} />
      <Sfx name="pop" at={75} volume={0.45} />
    </AbsoluteFill>
  )
}

/** Éclat d'explosion : onde de choc blanche cernée d'encre + traits radiaux (blancs / or). */
export const Burst: React.FC<{ f: number; at: number; x: number; y: number; reach?: number; seed?: string }> = ({ f, at, x, y, reach = 700, seed = 'bu' }) => {
  const t = f - at
  if (t < 0 || t > 20) return null
  const q = outExpo(t / 12)
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <svg width={TW} height={TH} style={{ position: 'absolute', left: 0, top: 0, opacity: 1 - ramp(t, 8, 18) }}>
        {Array.from({ length: 22 }, (_, i) => {
          const a = (i / 22) * Math.PI * 2 + random(`${seed}l${i}`) * 0.2
          const r0 = 70 + q * reach * (0.35 + random(`${seed}m${i}`) * 0.3)
          const r1 = r0 + 110 + random(`${seed}n${i}`) * 200
          const w = 0.035 + random(`${seed}o${i}`) * 0.03
          const P = (r: number, da: number) => `${x + Math.cos(a + da) * r},${y + Math.sin(a + da) * r}`
          return <polygon key={i} points={`${P(r0, -w * 0.2)} ${P(r1, 0)} ${P(r0, w * 0.2)}`} fill={i % 3 ? '#ffffff' : N.gold} />
        })}
      </svg>
      <div style={{ position: 'absolute', left: x - 60 - q * reach, top: y - 60 - q * reach, width: 120 + q * reach * 2, height: 120 + q * reach * 2, borderRadius: '50%', border: `${Math.round(26 * (1 - t / 20)) + 4}px solid #ffffff`, boxShadow: `0 0 0 6px ${C.ink}`, opacity: 1 - ramp(t, 6, 20), boxSizing: 'border-box' }} />
    </AbsoluteFill>
  )
}
