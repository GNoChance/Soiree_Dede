// INTRO : deux téléphones en 3D, parade des persos puis aperçu de l'app, gros plan plein cadre, titre.
import React from 'react'
import { AbsoluteFill, useCurrentFrame } from 'remotion'
import { CloseUpParade, HubScreen, InventoryScreen, LeaderboardScreen, OnboardingScreen } from '../app-screens'
import { Sfx } from '../audio'
import { C, DISPLAY, sticker } from '../theme'
import { POSE, SPRING, clamp01, easeIn, easeInOut, mixPose, motionBlur, ramp, sp, type Pose } from '../motion'
import { PhoneRig } from './PhoneRig'

// Repères (frames locales)
export const INTRO = {
  iphoneIn: 6,
  galaxyIn: 20,
  titleAt: 34,
  badgeAt: 104,
  closeIn: 252,
  closeOut: 352,
  outAt: 396,
}
const CLOSE_LEN = 24

// --------------------------------------------------------------------------
// Carrousel d'écrans (transition « push » façon navigation d'app)
// --------------------------------------------------------------------------
export type Slide = { at: number; render: (t: number) => React.ReactNode; cut?: boolean }
export const ScreenCarousel: React.FC<{ f: number; slides: Slide[]; w: number; len?: number }> = ({ f, slides, w, len = 18 }) => {
  let k = 0
  slides.forEach((s, i) => { if (f >= s.at) k = i })
  const cur = slides[k]
  const p = easeInOut(ramp(f, cur.at, cur.at + len))
  const showPrev = k > 0 && p < 1 && !cur.cut
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      {showPrev && (
        <div style={{ position: 'absolute', inset: 0, transform: `translateX(${-p * w * 0.3}px)`, filter: `brightness(${1 - 0.25 * p})` }}>
          {slides[k - 1].render(f - slides[k - 1].at)}
        </div>
      )}
      <div style={{ position: 'absolute', inset: 0, transform: showPrev ? `translateX(${(1 - p) * w}px)` : undefined, boxShadow: showPrev ? '-20px 0 40px rgba(0,0,0,0.25)' : undefined }}>
        {cur.render(f - cur.at)}
      </div>
    </div>
  )
}

// Écrans des deux téléphones
const IP = { width: 440, height: 956, safeTop: 58 }
const GX = { width: 412, height: 915, safeTop: 40 }
export const IPHONE_SLIDES: Slide[] = [
  { at: 0, render: (t) => <OnboardingScreen t={t - 12} {...IP} parade /> },
  { at: 150, render: (t) => <HubScreen t={t + 14} {...IP} /> },
  { at: 206, render: (t) => <LeaderboardScreen t={t + 14} {...IP} /> },
  { at: 330, render: (t) => <HubScreen t={t + 40} {...IP} />, cut: true },
]
export const GALAXY_SLIDES: Slide[] = [
  { at: 0, render: (t) => <OnboardingScreen t={t - 26} {...GX} parade /> },
  { at: 172, render: (t) => <InventoryScreen t={t + 14} {...GX} /> },
  { at: 226, render: (t) => <HubScreen t={t + 14} {...GX} /> },
  { at: 330, render: (t) => <LeaderboardScreen t={t + 40} {...GX} />, cut: true },
]

const ENTER_IP: Pose = { x: 200, y: 2700, s: 0.85, rx: 35, ry: 45, rz: -10 }
const ENTER_GX: Pose = { x: 880, y: 2800, s: 0.85, rx: 35, ry: -45, rz: 10 }

/** Pose animée (entrée + flottement qui s'éteint avant la fin). */
export const introPose = (device: 'iphone' | 'galaxy', f: number): Pose => {
  const iph = device === 'iphone'
  const p = sp(f, iph ? INTRO.iphoneIn : INTRO.galaxyIn, { stiffness: 70, damping: 15, mass: 1.1 })
  const base = mixPose(iph ? ENTER_IP : ENTER_GX, iph ? POSE.introIphone : POSE.introGalaxy, p)
  const float = ramp(f, 60, 120) * (1 - ramp(f, 340, 400))
  const ph = iph ? 0 : 1.7
  return { ...base, y: base.y + Math.sin(f / 46 + ph) * 10 * float, ry: (base.ry ?? 0) + Math.sin(f / 70 + ph) * 3 * float }
}

// --------------------------------------------------------------------------
const WORDS: { w: string; hot?: boolean }[] = [
  { w: 'Vos' }, { w: 'soirées' }, { w: 'passent' }, { w: 'au' }, { w: 'niveau', hot: true }, { w: 'supérieur', hot: true },
]
const LINES = [[0, 1, 2], [3, 4, 5]]

const Title: React.FC<{ f: number }> = ({ f }) => {
  const out = easeIn(ramp(f, INTRO.outAt, INTRO.outAt + 20))
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top: 120, display: 'flex', flexDirection: 'column', alignItems: 'center', transform: `translateY(${-out * 420}px)`, opacity: 1 - out }}>
      {LINES.map((line, li) => (
        <div key={li} style={{ display: 'flex', gap: 26, justifyContent: 'center' }}>
          {line.map((wi) => {
            const w = WORDS[wi]
            const s = sp(f, INTRO.titleAt + wi * 7, SPRING.bouncy)
            const wob = Math.sin((f - wi * 9) / 26) * 1.6 * ramp(f, 120, 160)
            return (
              <span
                key={wi}
                style={{
                  display: 'inline-block', fontFamily: DISPLAY, fontWeight: 800, fontSize: 104, lineHeight: 1.08, letterSpacing: -1,
                  color: w.hot ? C.sun : '#ffffff', WebkitTextStroke: `4px ${C.ink}`, paintOrder: 'stroke fill',
                  textShadow: `6px 6px 0 ${C.ink}`,
                  transform: `translateY(${(1 - s) * 140}px) scale(${0.4 + 0.6 * s}) rotate(${(1 - s) * (wi % 2 ? 14 : -14) + wob}deg)`,
                  opacity: clamp01(s * 3),
                }}
              >
                {w.w}
              </span>
            )
          })}
        </div>
      ))}
    </div>
  )
}

const Badge: React.FC<{ f: number }> = ({ f }) => {
  const s = sp(f, INTRO.badgeAt, SPRING.bouncy)
  const out = easeIn(ramp(f, INTRO.outAt, INTRO.outAt + 18))
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top: 1640, display: 'flex', justifyContent: 'center', transform: `translateY(${out * 400}px)`, opacity: 1 - out }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 18, background: C.surface, border: `4px solid ${C.ink}`, borderRadius: 999, boxShadow: sticker(7),
          padding: '14px 36px 12px', fontFamily: DISPLAY, fontWeight: 800, fontSize: 40, color: C.ink, lineHeight: 1.1, whiteSpace: 'nowrap',
          transform: `scale(${s}) rotate(${(1 - s) * 8 - 1.5}deg)`, opacity: clamp01(s * 2),
        }}
      >
        <span>Aucun store requis</span>
        <span style={{ width: 14, height: 14, borderRadius: 7, background: C.tangerine, border: `3px solid ${C.ink}`, flexShrink: 0 }} />
        <span>Installation en <span style={{ color: C.tangerine }}>5 secondes</span></span>
      </div>
    </div>
  )
}

/** Gros plan plein cadre : ouverture puis fermeture en iris. */
const CloseUp: React.FC<{ f: number }> = ({ f }) => {
  const a = f - INTRO.closeIn
  if (a < 0 || f > INTRO.closeOut + CLOSE_LEN) return null
  const open = sp(f, INTRO.closeIn, { stiffness: 90, damping: 18 })
  const close = easeInOut(ramp(f, INTRO.closeOut, INTRO.closeOut + CLOSE_LEN))
  const R = 1180
  const r = R * open * (1 - close)
  const zoom = 1.18 - 0.18 * open + 0.12 * close
  const ring = clamp01(open * 3) * (1 - ramp(close, 0.85, 1))
  const cy = 960 + 40 * zoom
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ clipPath: `circle(${r}px at 540px 1000px)`, transform: `scale(${zoom})` }}>
        <CloseUpParade t={a} width={1080} height={1920} step={4} />
      </AbsoluteFill>
      {r < R - 20 && r > 4 && (
        <div style={{ position: 'absolute', left: 540 - r * zoom - 6, top: cy - r * zoom - 6, width: r * 2 * zoom + 12, height: r * 2 * zoom + 12, borderRadius: '50%', border: `12px solid ${C.ink}`, boxSizing: 'border-box', opacity: ring }} />
      )}
    </AbsoluteFill>
  )
}

export const Intro: React.FC = () => {
  const f = useCurrentFrame()
  return (
    <AbsoluteFill>
      <Title f={f} />
      <PhoneRig device="galaxy" pose={introPose('galaxy', f)} blur={motionBlur((x) => introPose('galaxy', x), f)}>
        <ScreenCarousel f={f} slides={GALAXY_SLIDES} w={412} />
      </PhoneRig>
      <PhoneRig device="iphone" pose={introPose('iphone', f)} blur={motionBlur((x) => introPose('iphone', x), f)}>
        <ScreenCarousel f={f} slides={IPHONE_SLIDES} w={440} />
      </PhoneRig>
      <Badge f={f} />
      <CloseUp f={f} />

      <Sfx name="whoosh" at={INTRO.iphoneIn} volume={0.55} />
      <Sfx name="whoosh" at={INTRO.galaxyIn} volume={0.45} />
      {WORDS.map((_, i) => <Sfx key={i} name="pop" at={INTRO.titleAt + i * 7 + 3} volume={0.22} />)}
      <Sfx name="pop" at={INTRO.badgeAt + 2} volume={0.45} />
      <Sfx name="swoosh-up" at={150} volume={0.25} />
      <Sfx name="swoosh-up" at={206} volume={0.25} />
      <Sfx name="whoosh" at={INTRO.closeIn} volume={0.6} />
      {Array.from({ length: 9 }, (_, i) => <Sfx key={`c${i}`} name="pop" at={INTRO.closeIn + 8 + i * 6} volume={0.18} />)}
      <Sfx name="whoosh" at={INTRO.closeOut} volume={0.5} />
    </AbsoluteFill>
  )
}
