// Scènes génériques d'un tuto : titre, but, étape (avec maquette sur-mesure), victoire, final.
import React from 'react'
import { AbsoluteFill } from 'remotion'
import { C, DISPLAY, sticker } from '../theme'
import { Chibi, ConfettiBurst, Outlined, Panel, Pill, Pop, SPRING, Sfx, TW, bob, clamp01, easeIn, nb, ramp, sp, wiggle } from './kit'
import type { TutoSpec, TutoStep } from './types'

/** Sortie commune : la scène s'envole vers le haut sur ses 7 dernières frames. */
const Shell: React.FC<{ f: number; dur: number; children?: React.ReactNode }> = ({ f, dur, children }) => {
  const out = easeIn(ramp(f, dur - 7, dur))
  return <AbsoluteFill style={{ opacity: 1 - out, transform: `translateY(${-out * 90}px)` }}>{children}</AbsoluteFill>
}

const CastRow: React.FC<{ f: number; spec: TutoSpec; at: number; top: number; size?: number; jump?: boolean }> = ({ f, spec, at, top, size = 190, jump }) => {
  const n = spec.cast.length
  const gap = Math.min(size * 0.86, (TW - 40 - size) / Math.max(1, n - 1))
  const x0 = (TW - (gap * (n - 1) + size)) / 2
  return (
    <>
      {spec.cast.map((slug, k) => {
        const s = sp(f, at + k * 4)
        return (
          <div
            key={slug}
            style={{
              position: 'absolute', left: x0 + k * gap, top: top + (k % 2) * 26 + (1 - s) * 320 + bob(f, k * 11, jump ? 34 : 12, jump ? 14 : 30),
              transform: `rotate(${wiggle(f, k * 9, 3)}deg)`, zIndex: k % 2,
            }}
          >
            <Chibi slug={slug} expression={jump ? 'joie' : k % 2 ? 'clin_oeil' : 'joie'} size={size} outfit={spec.outfits?.[slug]} />
          </div>
        )
      })}
    </>
  )
}

// ---------------------------------------------------------------------------
export const TitleScene: React.FC<{ f: number; dur: number; spec: TutoSpec }> = ({ f, dur, spec }) => {
  const e = sp(f, 4, SPRING.bouncy)
  return (
    <Shell f={f} dur={dur}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 96, display: 'flex', justifyContent: 'center' }}>
        <Pop f={f} at={0} rot={-3}><Pill bg={C.surface} size={38}>❓ Comment on joue ?</Pill></Pop>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 230, display: 'flex', justifyContent: 'center' }}>
        <div
          style={{
            width: 280, height: 280, borderRadius: 70, background: spec.color, border: `7px solid ${C.ink}`, boxShadow: sticker(12), boxSizing: 'border-box',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 170, lineHeight: 1,
            transform: `scale(${e}) rotate(${-6 + (1 - e) * -40 + wiggle(f, 0, 2.5)}deg)`,
          }}
        >
          {spec.emoji}
        </div>
      </div>
      <div style={{ position: 'absolute', left: 30, right: 30, top: 560 }}>
        <Pop f={f} at={12} from={60}>
          <Outlined size={spec.name.length > 12 ? 92 : 118} color={C.sun}>{spec.name}</Outlined>
        </Pop>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 800, display: 'flex', justifyContent: 'center' }}>
        <Pop f={f} at={24} rot={2}><Pill bg={C.mint} size={36}>👥 {spec.players}</Pill></Pop>
      </div>
      <CastRow f={f} spec={spec} at={28} top={960} size={210} />
      <Sfx name="jingle" at={2} volume={0.45} />
      <Sfx name="pop" at={14} />
      <Sfx name="pop" at={26} volume={0.35} />
    </Shell>
  )
}

// ---------------------------------------------------------------------------
export const GoalScene: React.FC<{ f: number; dur: number; spec: TutoSpec }> = ({ f, dur, spec }) => (
  <Shell f={f} dur={dur}>
    <div style={{ position: 'absolute', left: 0, right: 0, top: 210, display: 'flex', justifyContent: 'center' }}>
      <Pop f={f} at={0} rot={-4}><Pill bg={spec.color} size={54}>🎯 Le but</Pill></Pop>
    </div>
    <div style={{ position: 'absolute', left: 40, right: 40, top: 370 }}>
      <Pop f={f} at={6} from={80}>
        <Panel radius={44} shadow={10} style={{ padding: '44px 36px 36px', fontSize: 58, lineHeight: 1.12, textAlign: 'center' }}>{nb(spec.goal)}</Panel>
      </Pop>
    </div>
    <div style={{ position: 'absolute', left: TW / 2 - 170, top: 850 + (1 - sp(f, 14)) * 500 + bob(f, 0, 14, 28), transform: `rotate(${wiggle(f, 0, 3)}deg)` }}>
      <Chibi slug={spec.cast[0]} expression={f < 50 ? 'reflexion' : 'joie'} size={340} outfit={spec.outfits?.[spec.cast[0]]} />
    </div>
    <Sfx name="whoosh" at={0} volume={0.4} />
    <Sfx name="pop" at={8} />
  </Shell>
)

// ---------------------------------------------------------------------------
/** Étape numérotée : bandeau de texte en haut, maquette au centre, progression en bas. */
export const StepScene: React.FC<{ f: number; dur: number; spec: TutoSpec; step: TutoStep; index: number }> = ({ f, dur, spec, step, index }) => {
  const i = sp(f, 0, SPRING.bouncy)
  const Mock = step.Mock
  return (
    <Shell f={f} dur={dur}>
      <div style={{ position: 'absolute', left: 26, right: 26, top: 56, transform: `translateY(${(1 - i) * -220}px) rotate(${(1 - i) * -4}deg)` }}>
        <Panel radius={40} shadow={9} style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '0 24px 0 18px', height: 196 }}>
          <div
            style={{
              width: 96, height: 96, flexShrink: 0, borderRadius: '50%', background: spec.color, border: `5px solid ${C.ink}`, boxSizing: 'border-box',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 64, lineHeight: 1, paddingTop: 6,
              transform: `rotate(${(1 - sp(f, 4)) * -180}deg)`,
            }}
          >
            {index + 1}
          </div>
          <div style={{ fontSize: step.text.length > 40 ? 43 : 50, lineHeight: 1.1, letterSpacing: -0.5 }}>{nb(step.text)}</div>
        </Panel>
      </div>
      <div style={{ position: 'absolute', left: 0, top: 286, width: TW, height: 880 }}>
        <Mock f={f - 8} dur={dur - 8} />
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 1200, display: 'flex', justifyContent: 'center', gap: 14 }}>
        {spec.steps.map((_, k) => (
          <div key={k} style={{ width: 96, height: 24, borderRadius: 12, background: '#ffffffaa', border: `4px solid ${C.ink}`, boxSizing: 'border-box', overflow: 'hidden', boxShadow: sticker(3) }}>
            <div style={{ width: `${(k < index ? 1 : k === index ? clamp01(f / dur) : 0) * 100}%`, height: '100%', background: spec.color }} />
          </div>
        ))}
      </div>
      <Sfx name="swoosh-up" at={0} volume={0.35} />
      <Sfx name="pop" at={5} volume={0.4} />
    </Shell>
  )
}

// ---------------------------------------------------------------------------
export const WinScene: React.FC<{ f: number; dur: number; spec: TutoSpec }> = ({ f, dur, spec }) => {
  const w = spec.win.winners
  const Board = spec.win.Board
  const size = w.length > 2 ? 230 : 300
  const gap = size * 0.82
  const x0 = (TW - (gap * (w.length - 1) + size)) / 2
  return (
    <Shell f={f} dur={dur}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 120, display: 'flex', justifyContent: 'center' }}>
        <Pop f={f} at={0} rot={-4}><Pill bg={C.sun} size={56}>🏆 Pour gagner</Pill></Pop>
      </div>
      <div style={{ position: 'absolute', left: 36, right: 36, top: 280 }}>
        <Pop f={f} at={6} from={80}>
          <Panel radius={44} shadow={10} style={{ padding: '40px 32px 32px', fontSize: 54, lineHeight: 1.12, textAlign: 'center' }}>
            {nb(spec.win.text)}
            {spec.win.sub && <div style={{ marginTop: 18, fontSize: 34, lineHeight: 1.2, color: C.muted }}>{nb(spec.win.sub)}</div>}
          </Panel>
        </Pop>
      </div>
      {Board && <div style={{ position: 'absolute', left: 0, right: 0, top: 610 }}><Board f={f} /></div>}
      {w.map((slug, k) => (
        <div key={slug} style={{ position: 'absolute', left: x0 + k * gap, top: 860 + (1 - sp(f, 16 + k * 5)) * 500 + bob(f, k * 9, 40, 15), transform: `rotate(${wiggle(f, k * 7, 4)}deg)` }}>
          <Chibi slug={slug} expression="joie" size={size} outfit={spec.outfits?.[slug]} />
        </div>
      ))}
      <ConfettiBurst f={f} at={18} y={820} seed={spec.id} />
      <Sfx name="success" at={16} volume={0.6} />
      <Sfx name="pop" at={8} />
    </Shell>
  )
}

// ---------------------------------------------------------------------------
const OUTRO_WORDS = ['À', 'vous', 'de', 'jouer', '!']
export const OutroScene: React.FC<{ f: number; spec: TutoSpec }> = ({ f, spec }) => (
  <AbsoluteFill>
    <div style={{ position: 'absolute', left: 0, right: 0, top: 150, display: 'flex', justifyContent: 'center' }}>
      <Pop f={f} at={0} rot={-5}>
        <div
          style={{
            width: 200, height: 200, borderRadius: 52, background: spec.color, border: `6px solid ${C.ink}`, boxShadow: sticker(10), boxSizing: 'border-box',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 120, lineHeight: 1,
          }}
        >
          {spec.emoji}
        </div>
      </Pop>
    </div>
    <div style={{ position: 'absolute', left: 20, right: 20, top: 420, display: 'flex', flexWrap: 'wrap', justifyContent: 'center', columnGap: 24 }}>
      {OUTRO_WORDS.map((word, k) => {
        const s = sp(f, 6 + k * 4)
        return (
          <Outlined
            key={k}
            size={k >= 3 ? 150 : 112}
            color={k >= 3 ? C.sun : '#ffffff'}
            style={{ transform: `translateY(${(1 - s) * 120 + bob(f, k * 6, 10, 20)}px) scale(${0.4 + 0.6 * s}) rotate(${(k % 2 ? 3 : -3) + wiggle(f, k * 5, 1.5)}deg)`, opacity: clamp01(s * 3) }}
          >
            {word}
          </Outlined>
        )
      })}
    </div>
    <CastRow f={f} spec={spec} at={16} top={900} size={220} jump />
    <div style={{ position: 'absolute', left: 0, right: 0, top: 1180, display: 'flex', justifyContent: 'center' }}>
      <Pop f={f} at={30}><div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 34, color: C.ink }}>Les Soirées de Dédé</div></Pop>
    </div>
    <ConfettiBurst f={f} at={20} y={700} seed={`${spec.id}o`} n={40} />
    <Sfx name="jingle" at={4} volume={0.5} />
    {OUTRO_WORDS.map((_, k) => <Sfx key={k} name="pop" at={7 + k * 4} volume={0.3} />)}
  </AbsoluteFill>
)
