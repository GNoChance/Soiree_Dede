// Légendes : pastille plateforme, étape numérotée, barre de progression.
import React from 'react'
import { C, DISPLAY, sticker } from '../theme'
import { SPRING, clamp01, easeIn, ramp, sp } from '../motion'

export type Step = { from: number; text: string }

/** Pastille « iOS • Safari ». */
export const PlatformBadge: React.FC<{ f: number; label: string; color: string; at?: number; out?: number; top?: number }> = ({ f, label, color, at = 0, out = 1e9, top = 56 }) => {
  const i = sp(f, at, SPRING.bouncy)
  const o = easeIn(ramp(f, out, out + 14))
  if (i <= 0.001 || o >= 1) return null
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
      <div
        style={{
          fontFamily: DISPLAY, fontWeight: 800, fontSize: 42, lineHeight: 1.25, color: C.ink, background: color,
          border: `4px solid ${C.ink}`, boxShadow: sticker(6), borderRadius: 999, padding: '4px 34px 2px',
          transform: `translateY(${-o * 160}px) scale(${i}) rotate(${-2 * i}deg)`, opacity: clamp01(i * 2) * (1 - o),
        }}
      >
        {label}
      </div>
    </div>
  )
}

const StepCard: React.FC<{ n: number; text: string; inP: number; outP: number; accent: string }> = ({ n, text, inP, outP, accent }) => (
  <div
    style={{
      position: 'absolute', left: 0, right: 0, top: 0, display: 'flex', justifyContent: 'center',
      transform: `translateY(${(1 - inP) * 40 - outP * 60}px) scale(${0.8 + 0.2 * inP - 0.08 * outP})`,
      opacity: clamp01(inP * 2) * (1 - outP), filter: outP > 0.02 ? `blur(${outP * 6}px)` : undefined,
    }}
  >
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 22, maxWidth: 1000, boxSizing: 'border-box', padding: '16px 34px 16px 18px',
        background: C.surface, border: `4px solid ${C.ink}`, borderRadius: 36, boxShadow: sticker(8),
      }}
    >
      <div
        style={{
          width: 84, height: 84, flexShrink: 0, borderRadius: '50%', background: accent, border: `4px solid ${C.ink}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: DISPLAY, fontWeight: 800, fontSize: 54, color: C.ink, lineHeight: 1,
          paddingTop: 4, boxSizing: 'border-box', transform: `rotate(${(1 - inP) * -90}deg)`,
        }}
      >
        {n}
      </div>
      <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 56, lineHeight: 1.08, color: C.ink, letterSpacing: -0.5 }}>{text}</div>
    </div>
  </div>
)

/** Étape courante (numérotée), avec transition entre étapes. */
export const StepCaption: React.FC<{ f: number; steps: Step[]; accent: string; top?: number; out?: number }> = ({ f, steps, accent, top = 150, out = 1e9 }) => {
  const sceneOut = easeIn(ramp(f, out, out + 14))
  let idx = -1
  steps.forEach((s, i) => { if (f >= s.from) idx = i })
  if (idx < 0 || sceneOut >= 1) return null
  const cur = steps[idx]
  const prev = idx > 0 ? steps[idx - 1] : null
  const prevOut = ramp(f, cur.from, cur.from + 10)
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top, height: 200, pointerEvents: 'none', opacity: 1 - sceneOut, transform: `translateY(${-sceneOut * 120}px)` }}>
      {prev && prevOut < 1 && <StepCard n={idx} text={prev.text} inP={1} outP={easeIn(prevOut)} accent={accent} />}
      <StepCard n={idx + 1} text={cur.text} inP={sp(f, cur.from + 6, SPRING.bouncy)} outP={0} accent={accent} />
    </div>
  )
}

/** Barre de progression en 4 segments sous le téléphone. */
export const StepProgress: React.FC<{ f: number; steps: Step[]; doneAt: number; accent: string; top: number; at?: number; out?: number }> = ({ f, steps, doneAt, accent, top, at = 0, out = 1e9 }) => {
  const i = sp(f, at, SPRING.snappy)
  const o = easeIn(ramp(f, out, out + 14))
  const W = 150
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top, display: 'flex', justifyContent: 'center', gap: 18, opacity: clamp01(i * 1.5) * (1 - o), transform: `translateY(${(1 - i) * 60 + o * 120}px)` }}>
      {steps.map((s, k) => {
        const end = k + 1 < steps.length ? steps[k + 1].from : doneAt
        const p = ramp(f, s.from, end)
        return (
          <div key={k} style={{ width: W, height: 22, borderRadius: 11, background: 'rgba(255,255,255,0.55)', border: `3px solid ${C.ink}`, overflow: 'hidden', boxShadow: sticker(3) }}>
            <div style={{ width: `${p * 100}%`, height: '100%', background: accent }} />
          </div>
        )
      })}
    </div>
  )
}
