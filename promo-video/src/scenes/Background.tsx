// Fond animé global : dégradé vivant aux couleurs de l'app, halos mobiles, pois crème, confettis doux.
import React from 'react'
import { AbsoluteFill, interpolate, random, useCurrentFrame } from 'remotion'
import { C } from '../theme'
import { SEQ } from '../timeline'

// Palette par séquence : [fond, halo 1, halo 2, halo 3]
const PAL = {
  intro: ['#ffb703', '#fb8500', '#ff8fa3', '#8b5cf6'],
  ios: ['#6fd3f5', '#8b5cf6', '#ff8fa3', '#4cc9f0'],
  android: ['#3fe0b0', '#4cc9f0', '#b5e61d', '#06d6a0'],
  outro: ['#ffb703', '#ef476f', '#fb8500', '#8b5cf6'],
}
const STOPS = [0, SEQ.ios.from - 10, SEQ.ios.from + 30, SEQ.android.from - 10, SEQ.android.from + 30, SEQ.outro.from, SEQ.outro.from + 40]
const SETS = [PAL.intro, PAL.intro, PAL.ios, PAL.ios, PAL.android, PAL.android, PAL.outro]
const hex = (h: string) => [1, 3, 5].map((o) => parseInt(h.slice(o, o + 2), 16))
/** Couleur interpolée de la palette (index i) avec alpha a. */
const col = (f: number, i: number, a = 1) => {
  const rgb = [0, 1, 2].map((c) => Math.round(interpolate(f, STOPS, SETS.map((s) => hex(s[i])[c]), { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })))
  return `rgba(${rgb.join(',')},${a})`
}

const BLOBS = [
  { i: 1, x: 0.15, y: 0.18, r: 820, ax: 160, ay: 120, p: 520 },
  { i: 2, x: 0.9, y: 0.45, r: 900, ax: 140, ay: 200, p: 640 },
  { i: 3, x: 0.2, y: 0.85, r: 950, ax: 180, ay: 110, p: 700 },
  { i: 1, x: 0.85, y: 0.95, r: 700, ax: 120, ay: 160, p: 460 },
]

type Shape = 'dot' | 'ring' | 'square' | 'star' | 'pill'
const SHAPES: Shape[] = ['dot', 'ring', 'square', 'star', 'pill']
const CONF_COLORS = [C.paper, '#ffffff', C.sun, C.bubblegum, C.sky, C.mint, C.grape, C.tomato]
const CONFETTI = Array.from({ length: 26 }, (_, k) => ({
  x: random(`cx${k}`) * 1080,
  y: random(`cy${k}`) * 1920,
  size: 16 + random(`cs${k}`) * 34,
  shape: SHAPES[Math.floor(random(`sh${k}`) * SHAPES.length)],
  color: CONF_COLORS[Math.floor(random(`cc${k}`) * CONF_COLORS.length)],
  speed: 0.25 + random(`sp${k}`) * 0.55,
  rot: random(`ro${k}`) * 360,
  spin: (random(`sn${k}`) - 0.5) * 1.6,
  sway: 20 + random(`sw${k}`) * 40,
  depth: random(`dp${k}`),
}))
const STAR = 'polygon(50% 0%,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%)'

export const Background: React.FC = () => {
  const f = useCurrentFrame()
  const base = col(f, 0)
  return (
    <AbsoluteFill style={{ background: base, overflow: 'hidden' }}>
      {BLOBS.map((b, k) => {
        const cx = b.x * 1080 + Math.sin((f / b.p) * Math.PI * 2 + k) * b.ax
        const cy = b.y * 1920 + Math.cos((f / (b.p * 1.3)) * Math.PI * 2 + k * 2) * b.ay
        return (
          <div
            key={k}
            style={{
              position: 'absolute', left: cx - b.r, top: cy - b.r, width: b.r * 2, height: b.r * 2, borderRadius: '50%',
              background: `radial-gradient(circle, ${col(f, b.i)} 0%, ${col(f, b.i, 0.8)} 22%, ${col(f, b.i, 0)} 68%)`,
            }}
          />
        )
      })}
      {/* lumière douce en haut */}
      <AbsoluteFill style={{ background: 'radial-gradient(120% 60% at 50% 0%, rgba(255,246,229,0.38), rgba(255,246,229,0) 60%)' }} />
      {/* pois crème */}
      <AbsoluteFill
        style={{
          backgroundImage: 'radial-gradient(rgba(255,246,229,0.42) 3.2px, transparent 3.8px)',
          backgroundSize: '46px 46px', backgroundPosition: `${(f * 0.25) % 46}px ${(f * 0.4) % 46}px`,
        }}
      />
      {/* confettis */}
      {CONFETTI.map((c, k) => {
        const y = ((c.y - f * c.speed * (0.6 + c.depth)) % 2100 + 2100) % 2100 - 90
        const x = c.x + Math.sin((f + k * 40) / 70) * c.sway
        const r = c.rot + f * c.spin
        const s = c.size * (0.6 + c.depth * 0.6)
        const common: React.CSSProperties = {
          position: 'absolute', left: x, top: y, width: s, height: s, transform: `rotate(${r}deg)`,
          opacity: 0.35 + c.depth * 0.4, filter: c.depth < 0.3 ? 'blur(2px)' : undefined,
        }
        if (c.shape === 'ring') return <div key={k} style={{ ...common, borderRadius: '50%', border: `${Math.max(4, s * 0.18)}px solid ${c.color}`, boxSizing: 'border-box' }} />
        if (c.shape === 'square') return <div key={k} style={{ ...common, borderRadius: s * 0.25, background: c.color }} />
        if (c.shape === 'star') return <div key={k} style={{ ...common, clipPath: STAR, background: c.color }} />
        if (c.shape === 'pill') return <div key={k} style={{ ...common, height: s * 0.38, borderRadius: 999, background: c.color }} />
        return <div key={k} style={{ ...common, borderRadius: '50%', background: c.color }} />
      })}
      {/* vignette légère */}
      <AbsoluteFill style={{ background: 'radial-gradient(130% 90% at 50% 50%, rgba(0,0,0,0) 60%, rgba(40,20,60,0.18) 100%)' }} />
    </AbsoluteFill>
  )
}
