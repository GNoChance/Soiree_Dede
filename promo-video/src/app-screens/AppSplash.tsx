import React from 'react'
import { Img, staticFile } from 'remotion'
import { C, DISPLAY, sticker } from '../theme'
import { HubScreen } from './HubScreen'
import { ScreenBase, clamp01, ramp, sp } from './common'

export interface AppSplashProps {
  t: number
  width?: number
  height?: number
  safeTop?: number
  /** Frame (locale) où le splash cède la place au Hub (défaut 120 = 2 s). */
  switchAt?: number
}

/** Lancement de l'app installée : splash (icône qui pulse + titre) puis bascule vers le Hub. */
export const AppSplash: React.FC<AppSplashProps> = ({ t, width = 440, height = 956, safeTop = 54, switchAt = 120 }) => {
  const icon = sp(t, 4, { stiffness: 220, damping: 9 })
  const title = sp(t, 22, { stiffness: 300, damping: 12 })
  const pulse = 1 + 0.06 * Math.sin((Math.max(0, t - 30) / 48) * Math.PI * 2)
  const out = ramp(t, switchAt - 6, switchAt + 18)
  const hubT = Math.max(0, t - switchAt)
  const iconS = width * 0.42
  return (
    <div style={{ position: 'relative', width, height, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, opacity: ramp(t, switchAt - 6, switchAt + 10) }}>
        <HubScreen t={hubT} width={width} height={height} safeTop={safeTop} />
      </div>
      {out < 1 && (
        <div style={{ position: 'absolute', inset: 0, opacity: 1 - out, transform: `scale(${1 + out * 0.25})` }}>
          <ScreenBase width={width} height={height}>
            <div
              style={{
                position: 'absolute', left: '-50%', top: '-25%', width: '200%', height: '150%', opacity: 0.5,
                background: 'repeating-conic-gradient(#ffe9bf 0deg 10deg, transparent 10deg 24deg)', transform: `rotate(${(t / 60) * 12}deg)`,
              }}
            />
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 28 }}>
              <div style={{ transform: `scale(${(0.2 + 0.8 * icon) * pulse}) rotate(${(1 - icon) * -25}deg)`, opacity: clamp01(icon * 2) }}>
                <Img
                  src={staticFile('icons/icon-512.png')}
                  style={{ width: iconS, height: iconS, borderRadius: iconS * 0.225, border: `4px solid ${C.ink}`, boxShadow: sticker(8), display: 'block', boxSizing: 'border-box' }}
                />
              </div>
              <h1
                style={{
                  margin: 0, textAlign: 'center', fontFamily: DISPLAY, fontWeight: 800, fontSize: Math.round(width * 0.108), lineHeight: 1.05, color: C.tangerine,
                  textShadow: `3px 3px 0 ${C.ink}`, opacity: clamp01(title * 2), transform: `scale(${0.5 + 0.5 * title}) rotate(${-6 + 4 * title}deg)`,
                }}
              >
                Les Soirées<br />de Dédé
              </h1>
            </div>
          </ScreenBase>
        </div>
      )}
    </div>
  )
}
