import React from 'react'
import type { StatusBarMode } from './IPhone17ProMax'

export const GALAXY_SCREEN = { w: 412, h: 915 } as const
const PAD = 7.5
export const GALAXY_OUTER = { w: GALAXY_SCREEN.w + PAD * 2, h: GALAXY_SCREEN.h + PAD * 2 } as const
const R = 18

const AndroidStatusBar: React.FC<{ color: string }> = ({ color }) => (
  <div style={{ position: 'absolute', left: 0, top: 0, width: 412, height: 32, color, pointerEvents: 'none', zIndex: 50, fontFamily: 'Roboto, "Segoe UI", "Helvetica Neue", Arial, sans-serif' }}>
    <div style={{ position: 'absolute', left: 26, top: 0, height: 30, display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500, fontSize: 14.5, letterSpacing: 0.1 }}>
      12:45
      <svg width="13" height="13" viewBox="0 0 24 24" fill={color} opacity="0.9"><path d="M12 3 C7.5 3 4.5 6.3 4.5 10.5 V13 L2.8 16.5 H21.2 L19.5 13 V10.5 C19.5 6.3 16.5 3 12 3 Z M9.7 18.2 A2.4 2.4 0 0 0 14.3 18.2 Z" /></svg>
    </div>
    <div style={{ position: 'absolute', right: 24, top: 0, height: 30, display: 'flex', alignItems: 'center', gap: 5 }}>
      <svg width="15" height="13" viewBox="0 0 24 21" fill="none" stroke={color} strokeWidth="2.6" strokeLinecap="round">
        <path d="M2.3 7.4 A14.5 14.5 0 0 1 21.7 7.4" /><path d="M5.8 11.4 A9.5 9.5 0 0 1 18.2 11.4" /><path d="M9.2 15.4 A4.6 4.6 0 0 1 14.8 15.4" /><circle cx="12" cy="19" r="0.6" fill={color} />
      </svg>
      <svg width="13" height="13" viewBox="0 0 20 20" fill={color}><path d="M18 2 V18 H2 Z" opacity="0.95" /></svg>
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, fontWeight: 500, fontSize: 13 }}>
        100%
        <svg width="20" height="11" viewBox="0 0 20 11" fill="none"><rect x="0.5" y="0.5" width="16.5" height="10" rx="2.6" stroke={color} opacity="0.5" /><rect x="2" y="2" width="13.5" height="7" rx="1.6" fill={color} /><rect x="17.8" y="3.4" width="1.6" height="4.2" rx="0.8" fill={color} opacity="0.5" /></svg>
      </div>
    </div>
  </div>
)

const sideBtn = (top: number, h: number): React.CSSProperties => ({
  position: 'absolute', right: -3, top, height: h, width: 4.5,
  background: 'linear-gradient(270deg,#575b62,#b4b8be 55%,#80848b)', borderRadius: '0 2px 2px 0', boxShadow: '0 0 0 0.5px rgba(0,0,0,0.35)',
})

export const GalaxyUltra: React.FC<{
  children?: React.ReactNode
  scale?: number
  statusBar?: StatusBarMode
  style?: React.CSSProperties
}> = ({ children, scale = 1, statusBar = 'dark', style }) => {
  const color = statusBar === 'light' ? '#ffffff' : '#111114'
  const outerR = R + PAD
  return (
    <div style={{ position: 'relative', width: GALAXY_OUTER.w * scale, height: GALAXY_OUTER.h * scale, ...style }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: GALAXY_OUTER.w, height: GALAXY_OUTER.h, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
        <div style={{ position: 'absolute', inset: 6, borderRadius: outerR, boxShadow: '0 60px 90px -20px rgba(10,12,30,0.35), 0 30px 50px -10px rgba(10,12,30,0.25), 0 8px 16px rgba(10,12,30,0.18)' }} />
        <div style={sideBtn(220, 72)} />
        <div style={sideBtn(330, 120)} />
        <div style={{ position: 'absolute', inset: 0, borderRadius: outerR, background: 'linear-gradient(135deg,#6e7279 0%,#c4c7cc 14%,#8c9097 34%,#a9adb3 55%,#d0d3d8 80%,#6f737a 100%)', boxShadow: 'inset 0 0 0 0.8px rgba(255,255,255,0.5), inset 0 0 5px rgba(0,0,0,0.35), 0 0 0 0.6px rgba(0,0,0,0.5)' }} />
        <div style={{ position: 'absolute', inset: 2.6, borderRadius: outerR - 2.6, background: '#060607', boxShadow: '0 0 0 0.6px rgba(0,0,0,0.6)' }} />
        <div style={{ position: 'absolute', left: PAD, top: PAD, width: GALAXY_SCREEN.w, height: GALAXY_SCREEN.h, borderRadius: R, overflow: 'hidden', background: '#000', isolation: 'isolate' }}>
          <div style={{ position: 'absolute', inset: 0 }}>{children}</div>
          {statusBar !== 'none' && <AndroidStatusBar color={color} />}
          {/* poinçon caméra */}
          <div style={{ position: 'absolute', left: 206 - 5.5, top: 14 - 5.5, width: 11, height: 11, borderRadius: 6, background: 'radial-gradient(circle at 40% 38%, #1c2238 0%, #07080f 55%, #000 100%)', boxShadow: '0 0 0 1px rgba(0,0,0,0.9)', zIndex: 60 }} />
          <div style={{ position: 'absolute', inset: 0, zIndex: 70, pointerEvents: 'none', background: 'linear-gradient(115deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0) 28%, rgba(255,255,255,0) 72%, rgba(255,255,255,0.03) 100%)' }} />
        </div>
      </div>
    </div>
  )
}
