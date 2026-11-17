import React from 'react'
import { C, CHARACTERS, DISPLAY, sticker } from '../theme'
import { Avatar, ScreenBase, clamp01, ramp, sp, wiggle, bob } from './common'

export interface OnboardingScreenProps {
  t: number
  width?: number
  height?: number
  safeTop?: number
  /** Index (0-8) du perso sélectionné : il grossit et passe en « surprise ». */
  highlightIndex?: number
  /** Frame locale à laquelle la sélection démarre (défaut 0). */
  highlightAt?: number
  /** Décalage de défilement vertical (px). */
  scrollY?: number
  /** Entrée spectaculaire : les 9 chibis déboulent en cascade. */
  parade?: boolean
}

export const OnboardingScreen: React.FC<OnboardingScreenProps> = ({
  t, width = 440, height = 956, safeTop = 54, highlightIndex, highlightAt = 0, scrollY = 0, parade = false,
}) => {
  const pad = 16
  const gap = 12
  const cardW = (width - pad * 2 - gap * 2) / 3
  const av = Math.round(cardW * 0.64)
  const titleIn = sp(t, 0, { stiffness: 300, damping: 12 })
  const sub = sp(t, 14, { stiffness: 200, damping: 16 })
  const hl = highlightIndex !== undefined ? sp(t, highlightAt, { stiffness: 400, damping: 10 }) : 0
  const titleSize = Math.round(width * 0.118)

  return (
    <ScreenBase width={width} height={height}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, padding: `${safeTop + 24}px ${pad}px 40px`, transform: `translateY(${-scrollY}px)` }}>
        <header style={{ textAlign: 'center', marginBottom: 22, position: 'relative', zIndex: 10 }}>
          <h1
            style={{
              margin: 0, fontFamily: DISPLAY, fontWeight: 800, fontSize: titleSize, lineHeight: 1.05, color: C.tangerine,
              textShadow: `3px 3px 0 ${C.ink}`, opacity: clamp01(titleIn * 2),
              transform: `scale(${0.5 + 0.5 * titleIn}) rotate(${-8 + 6 * titleIn}deg)`,
            }}
          >
            Les Soirées<br />de Dédé
          </h1>
          <p style={{ margin: '12px 0 0', fontSize: 19, color: C.muted, fontWeight: 600, opacity: sub, transform: `translateY(${(1 - sub) * 12}px)` }}>Qui es-tu ?</p>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap }}>
          {CHARACTERS.map((c, i) => {
            const delay = parade ? 10 + i * 8 : 22 + i * 5
            const s = parade ? sp(t, delay, { stiffness: 170, damping: 9, mass: 1 }) : sp(t, delay, { stiffness: 260, damping: 15 })
            const side = i % 2 === 0 ? -1 : 1
            const fromY = parade ? -900 : 40
            const rot = parade ? side * 50 * (1 - s) : 0
            const x = parade ? side * 160 * (1 - s) : 0
            const selected = highlightIndex === i
            const dim = highlightIndex !== undefined && !selected ? 1 - 0.3 * hl : 1
            const scale = (parade ? 0.3 + 0.7 * s : 0.85 + 0.15 * s) * (selected ? 1 + 0.22 * hl : 1 - 0.04 * hl * (highlightIndex !== undefined ? 1 : 0))
            const expr = selected && hl > 0.15 ? 'surprise' : 'joie'
            // sautillement discret une fois posé
            const settled = ramp(t, delay + 30, delay + 50)
            const hop = bob(t, i * 17, 5) * settled * (selected ? 1.6 : 1)
            return (
              <div
                key={c.slug}
                style={{
                  opacity: clamp01(s * 2) * dim, zIndex: selected ? 5 : 1,
                  transform: `translate(${x}px, ${(1 - s) * fromY}px) rotate(${rot + (selected ? wiggle(t, 0, 3 * hl) : 0)}deg) scale(${scale})`,
                }}
              >
                <div
                  style={{
                    boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '12px 4px',
                    border: `3px solid ${C.ink}`, borderRadius: 24, background: selected && hl > 0.3 ? '#fff3c4' : C.surface,
                    boxShadow: sticker(selected ? 6 : 4),
                  }}
                >
                  <div style={{ transform: `translateY(${hop}px)` }}>
                    <Avatar slug={c.slug} expression={expr} size={av} />
                  </div>
                  <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 19, color: C.text, lineHeight: 1.3 }}>{c.nickname}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginTop: -2 }}>{c.firstName}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </ScreenBase>
  )
}

/** Page web telle qu'elle apparaît avant installation (sans chrome navigateur). */
export const WebPageLanding: React.FC<OnboardingScreenProps> = (props) => <OnboardingScreen {...props} />
