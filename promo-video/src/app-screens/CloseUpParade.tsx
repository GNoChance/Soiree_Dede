import React from 'react'
import { C, CHARACTERS, DISPLAY, sticker } from '../theme'
import { Chibi, ScreenBase, bob, clamp01, ramp, sp, wiggle } from './common'

export interface CloseUpParadeProps {
  t: number
  width?: number
  height?: number
  /** Frames entre deux entrées successives (défaut 14). */
  step?: number
}

const PICKS: Record<string, [string, string]> = {
  kevin: ['cool', 'gamer'],
  cycy: ['bisou', 'joie'],
  dede: ['joie', 'cool'],
  manon: ['clin_oeil', 'amoureux'],
  mika: ['gamer', 'cool'],
  cecile: ['amoureux', 'bisou'],
  carole: ['pouces', 'charmee'],
  marius: ['surprise', 'joie'],
  nini: ['pouces', 'timide'],
}

export const CloseUpParade: React.FC<CloseUpParadeProps> = ({ t, width = 1080, height = 1920, step = 14 }) => {
  const landscape = width / height > 1.15
  const cols = landscape ? 5 : 3
  const rows = Math.ceil(9 / cols)
  const titleH = landscape ? 0 : height * 0.1
  const cellW = width / cols
  const cellH = (height - titleH) / rows
  const chibiS = Math.min(cellW * 0.96, cellH * 0.74)
  const nameS = Math.min(cellW * 0.17, cellH * 0.12)
  const titleIn = sp(t, 0, { stiffness: 300, damping: 12 })

  return (
    <ScreenBase width={width} height={height}>
      {!landscape && (
        <div style={{ position: 'absolute', left: 0, right: 0, top: height * 0.025, textAlign: 'center', opacity: clamp01(titleIn * 2), transform: `scale(${0.6 + 0.4 * titleIn}) rotate(${-2 * titleIn}deg)` }}>
          <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: width * 0.085, color: C.tangerine, textShadow: `${width * 0.006}px ${width * 0.006}px 0 ${C.ink}` }}>
            Les Soirées de Dédé
          </span>
        </div>
      )}
      <div style={{ position: 'absolute', left: 0, right: 0, top: titleH, bottom: 0, display: 'flex', flexWrap: 'wrap', alignContent: 'center', justifyContent: 'center' }}>
        {CHARACTERS.map((c, i) => {
          const delay = 6 + i * step
          const s = sp(t, delay, { stiffness: 200, damping: 9 })
          const local = t - delay
          const side = i % 2 === 0 ? -1 : 1
          const swap = local > 100 && Math.floor((local - 100) / 70) % 2 === 0 ? 1 : 0
          const expr = PICKS[c.slug][swap]
          const hop = bob(t, i * 13, chibiS * 0.035, 70) * ramp(t, delay + 30, delay + 50)
          const nameIn = sp(t, delay + 8, { stiffness: 350, damping: 11 })
          return (
            <div key={c.slug} style={{ width: cellW, height: cellH, position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: clamp01(s * 2) }}>
              <div style={{ position: 'relative', transform: `translateY(${(1 - s) * -cellH * 0.9}px) rotate(${side * 35 * (1 - s) + wiggle(t, i * 11, 2.5, 110) * ramp(t, delay + 30, delay + 45)}deg) scale(${0.3 + 0.7 * s})` }}>
                <div style={{ position: 'absolute', left: '8%', right: '8%', top: '14%', bottom: '2%', borderRadius: '50%', background: c.color, opacity: 0.3 }} />
                <div style={{ transform: `translateY(${hop}px)`, position: 'relative' }}>
                  <Chibi slug={c.slug} expression={expr} size={chibiS} thumb={false} />
                </div>
              </div>
              <div
                style={{
                  marginTop: -cellH * 0.03, padding: `0 ${nameS * 0.55}px`, borderRadius: 999, border: `${Math.max(3, nameS * 0.08)}px solid ${C.ink}`,
                  boxShadow: sticker(Math.max(3, nameS * 0.14)), background: c.color, color: C.ink, fontFamily: DISPLAY, fontWeight: 800,
                  fontSize: nameS, lineHeight: 1.3, transform: `scale(${nameIn}) rotate(${side * -3 * nameIn}deg)`, opacity: clamp01(nameIn * 2),
                }}
              >
                {c.nickname}
              </div>
            </div>
          )
        })}
      </div>
    </ScreenBase>
  )
}
