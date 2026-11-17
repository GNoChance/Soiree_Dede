// Boîte à outils des vidéos « Comment on joue ? » (Tuto-<id>).
// Cadre 720×1280 à 30 FPS (léger pour le mobile). Toutes les frames sont locales à la scène.
import React from 'react'
import { AbsoluteFill, Sequence, random, spring } from 'remotion'
import { Audio } from '@remotion/media'
import { SFX, SFX_SECONDS, type SfxName } from '../audio'
import { SPRING, clamp01, easeIn, easeInOut, lerp, ramp, type SpringCfg } from '../motion'
import { C, DISPLAY, sticker } from '../theme'

export { SPRING, clamp01, easeIn, easeInOut, lerp, ramp }
export { Avatar, Chibi, bySlug } from '../app-screens/common'

export const TFPS = 30
export const TW = 720
export const TH = 1280
/** Secondes → frames. */
export const sec = (s: number) => Math.round(s * TFPS)

/** Ressort décalé de `delay` frames (rebondi par défaut). */
export const sp = (f: number, delay = 0, cfg: SpringCfg = SPRING.bouncy) =>
  spring({ frame: Math.max(0, f - delay), fps: TFPS, config: cfg })
/** Sautillement permanent. */
export const bob = (f: number, phase = 0, amp = 10, period = 40) => -Math.abs(Math.sin(((f + phase) / period) * Math.PI)) * amp
export const wiggle = (f: number, phase = 0, deg = 4, period = 36) => Math.sin(((f + phase) / period) * Math.PI * 2) * deg

/** Effet sonore à la frame `at` (30 FPS). */
export const Sfx: React.FC<{ name: SfxName; at: number; volume?: number }> = ({ name, at, volume = 0.5 }) => (
  <Sequence from={Math.max(0, at)} durationInFrames={Math.ceil(SFX_SECONDS[name] * TFPS) + 1} layout="none">
    <Audio src={SFX[name]} volume={volume} />
  </Sequence>
)

// ---------------------------------------------------------------------------
// Fond : papier crème + gros halos à la couleur du jeu + quelques confettis lents.
// (Volontairement calme : un fond peu agité se compresse très bien.)
// ---------------------------------------------------------------------------
const CONF = Array.from({ length: 12 }, (_, k) => ({
  x: random(`tx${k}`) * TW,
  y: random(`ty${k}`) * TH,
  s: 18 + random(`ts${k}`) * 26,
  v: 0.5 + random(`tv${k}`) * 0.8,
  r: random(`tr${k}`) * 360,
  shape: k % 3,
}))
const CONF_COLORS = [C.sun, C.bubblegum, C.sky, C.mint, C.grape, C.tomato]

export const TutoBackground: React.FC<{ f: number; color: string }> = ({ f, color }) => (
  <AbsoluteFill style={{ background: C.paper, overflow: 'hidden' }}>
    <div style={{ position: 'absolute', left: -260, top: -260, width: 760, height: 760, borderRadius: '50%', background: color, opacity: 0.55 }} />
    <div style={{ position: 'absolute', right: -300, bottom: -300, width: 820, height: 820, borderRadius: '50%', background: color, opacity: 0.4 }} />
    <AbsoluteFill style={{ backgroundImage: `radial-gradient(${C.ink}14 3px, transparent 3.6px)`, backgroundSize: '40px 40px' }} />
    {CONF.map((c, k) => {
      const y = (((c.y - f * c.v) % (TH + 80)) + TH + 80) % (TH + 80) - 40
      const st: React.CSSProperties = {
        position: 'absolute', left: c.x + Math.sin((f + k * 30) / 40) * 14, top: y, width: c.s, height: c.shape === 2 ? c.s * 0.4 : c.s,
        background: CONF_COLORS[k % CONF_COLORS.length], border: `3px solid ${C.ink}`, boxSizing: 'border-box',
        borderRadius: c.shape === 1 ? 6 : 999, transform: `rotate(${c.r + f * c.v}deg)`, opacity: 0.55,
      }
      return <div key={k} style={st} />
    })}
  </AbsoluteFill>
)

// ---------------------------------------------------------------------------
// Briques « sticker book »
// ---------------------------------------------------------------------------
/** Apparition en rebond à la frame `at`. */
export const Pop: React.FC<{ f: number; at?: number; rot?: number; from?: number; style?: React.CSSProperties; children?: React.ReactNode; cfg?: SpringCfg }> = ({
  f, at = 0, rot = 0, from = 0, style, children, cfg,
}) => {
  const s = sp(f, at, cfg)
  if (f < at) return null
  return (
    <div style={{ ...style, transform: `${style?.transform ?? ''} translateY(${(1 - s) * from}px) scale(${Math.max(0, s)}) rotate(${rot + (1 - s) * -12}deg)`, opacity: clamp01(s * 3) }}>
      {children}
    </div>
  )
}

/** Carte blanche à contour épais et ombre décalée. */
export const Panel: React.FC<{ bg?: string; radius?: number; shadow?: number; style?: React.CSSProperties; children?: React.ReactNode }> = ({
  bg = C.surface, radius = 32, shadow = 7, style, children,
}) => (
  <div style={{ boxSizing: 'border-box', background: bg, border: `5px solid ${C.ink}`, borderRadius: radius, boxShadow: sticker(shadow), color: C.ink, fontFamily: DISPLAY, fontWeight: 800, ...style }}>
    {children}
  </div>
)

/** Pastille (étiquette arrondie). */
export const Pill: React.FC<{ bg?: string; color?: string; size?: number; style?: React.CSSProperties; children?: React.ReactNode }> = ({
  bg = C.sun, color = C.ink, size = 34, style, children,
}) => (
  <div
    style={{
      display: 'inline-flex', alignItems: 'center', gap: 10, boxSizing: 'border-box', background: bg, color, border: `4px solid ${C.ink}`,
      borderRadius: 999, boxShadow: sticker(5), fontFamily: DISPLAY, fontWeight: 800, fontSize: size, lineHeight: 1.2,
      padding: `${size * 0.22}px ${size * 0.7}px ${size * 0.14}px`, whiteSpace: 'nowrap', ...style,
    }}
  >
    {children}
  </div>
)

/** Gros texte blanc/coloré cerné d'encre. */
export const Outlined: React.FC<{ size: number; color?: string; stroke?: number; style?: React.CSSProperties; children?: React.ReactNode }> = ({
  size, color = '#ffffff', stroke = 5, style, children,
}) => (
  <div
    style={{
      fontFamily: DISPLAY, fontWeight: 800, fontSize: size, lineHeight: 1.05, letterSpacing: -1, color, textAlign: 'center',
      WebkitTextStroke: `${stroke * 2}px ${C.ink}`, paintOrder: 'stroke fill', textShadow: `${stroke + 1}px ${stroke + 1}px 0 ${C.ink}`, ...style,
    }}
  >
    {children}
  </div>
)

/** Bulle de parole avec petite queue. */
export const Bubble: React.FC<{ bg?: string; size?: number; tail?: 'left' | 'right' | 'none'; style?: React.CSSProperties; children?: React.ReactNode }> = ({
  bg = C.surface, size = 34, tail = 'left', style, children,
}) => (
  <div style={{ position: 'relative', display: 'inline-block', ...style }}>
    <Panel bg={bg} radius={26} shadow={5} style={{ padding: `${size * 0.3}px ${size * 0.6}px ${size * 0.2}px`, fontSize: size, lineHeight: 1.15, whiteSpace: 'nowrap', border: `4px solid ${C.ink}` }}>
      {children}
    </Panel>
    {tail !== 'none' && (
      <div
        style={{
          position: 'absolute', bottom: -11, [tail]: 34, width: 22, height: 22, background: bg, boxSizing: 'border-box',
          borderRight: `4px solid ${C.ink}`, borderBottom: `4px solid ${C.ink}`, transform: 'rotate(45deg)',
        }}
      />
    )}
  </div>
)

// ---------------------------------------------------------------------------
// Doigt virtuel : suit une liste de touches {at, x, y}.
// ---------------------------------------------------------------------------
export type Tap = { at: number; x: number; y: number }
export const Finger: React.FC<{ f: number; taps: Tap[] }> = ({ f, taps }) => {
  if (!taps.length) return null
  let k = taps.findIndex((t) => f < t.at + 10)
  if (k === -1) k = taps.length - 1
  const cur = taps[k]
  const prev = k > 0 ? taps[k - 1] : { x: cur.x + 90, y: cur.y + 240, at: cur.at - 30 }
  const m = easeInOut(ramp(f, cur.at - 14, cur.at - 1))
  const x = lerp(prev.x, cur.x, m)
  const y = lerp(prev.y, cur.y, m)
  const first = taps[0].at
  const last = taps[taps.length - 1].at
  const vis = ramp(f, first - 18, first - 10) * (1 - ramp(f, last + 12, last + 20))
  const press = f >= cur.at && f < cur.at + 10 ? (f - cur.at) / 10 : 0
  if (vis <= 0) return null
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: 0, height: 0, opacity: vis, zIndex: 50 }}>
      {press > 0 && (
        <div style={{ position: 'absolute', left: -45, top: -45, width: 90, height: 90, borderRadius: '50%', border: `6px solid ${C.ink}`, boxSizing: 'border-box', transform: `scale(${0.5 + press * 1.3})`, opacity: 1 - press }} />
      )}
      <div
        style={{
          position: 'absolute', left: -32, top: -32, width: 64, height: 64, borderRadius: '50%', background: 'rgba(255,255,255,0.85)',
          border: `5px solid ${C.ink}`, boxSizing: 'border-box', boxShadow: sticker(press > 0 ? 1 : 5), transform: `scale(${1 - 0.18 * Math.sin(press * Math.PI)})`,
        }}
      />
    </div>
  )
}

/** Pluie de confettis déterministe (éclat à partir de `at`). */
export const ConfettiBurst: React.FC<{ f: number; at?: number; x?: number; y?: number; n?: number; seed?: string }> = ({ f, at = 0, x = TW / 2, y = 520, n = 34, seed = 'c' }) => {
  const t = f - at
  if (t < 0 || t > 80) return null
  return (
    <>
      {Array.from({ length: n }, (_, k) => {
        const a = random(`${seed}a${k}`) * Math.PI * 2
        const v = 9 + random(`${seed}v${k}`) * 16
        const px = x + Math.cos(a) * v * t * 0.9
        const py = y + Math.sin(a) * v * t * 0.9 - 6 * t + 0.42 * t * t
        const s = 14 + random(`${seed}s${k}`) * 16
        return (
          <div
            key={k}
            style={{
              position: 'absolute', left: px, top: py, width: s, height: k % 2 ? s : s * 0.5, background: CONF_COLORS[k % CONF_COLORS.length],
              border: `3px solid ${C.ink}`, boxSizing: 'border-box', borderRadius: k % 3 ? 5 : 999, transform: `rotate(${k * 47 + t * 14}deg)`,
              opacity: 1 - ramp(t, 55, 80),
            }}
          />
        )
      })}
    </>
  )
}

/** Typographie française : pas de « ! », « ? » ou « : » orphelin en début de ligne. */
export const nb = (text: string) => text.replace(/ ([!?:;»])/g, ' $1').replace(/« /g, '« ')
