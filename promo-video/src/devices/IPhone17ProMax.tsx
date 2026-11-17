import React from 'react'

export const IPHONE_SCREEN = { w: 440, h: 956 } as const
const PAD = 10
export const IPHONE_OUTER = { w: IPHONE_SCREEN.w + PAD * 2, h: IPHONE_SCREEN.h + PAD * 2 } as const
const R = 62

export type StatusBarMode = 'light' | 'dark' | 'none'

const IOSStatusBar: React.FC<{ color: string }> = ({ color }) => (
  <div style={{ position: 'absolute', left: 0, top: 0, width: 440, height: 59, color, pointerEvents: 'none', zIndex: 50 }}>
    <div style={{ position: 'absolute', left: 0, width: 150, top: 0, height: 59, display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 1, fontFamily: '-apple-system, "SF Pro Display", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif', fontWeight: 600, fontSize: 17, letterSpacing: -0.2 }}>9:41</div>
    <div style={{ position: 'absolute', right: 0, width: 150, top: 0, height: 59, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, paddingTop: 1 }}>
      <svg width="19" height="12" viewBox="0 0 19 12" fill={color}>
        <rect x="0" y="8" width="3.2" height="4" rx="1" />
        <rect x="5" y="5.4" width="3.2" height="6.6" rx="1" />
        <rect x="10" y="2.8" width="3.2" height="9.2" rx="1" />
        <rect x="15" y="0" width="3.2" height="12" rx="1" />
      </svg>
      <svg width="17" height="12" viewBox="0 0 17 12" fill={color} stroke={color} strokeLinecap="round">
        <path d="M1.8 3.8 A9.6 9.6 0 0 1 15.2 3.8" fill="none" strokeWidth="2.1" />
        <path d="M4.2 6.4 A6.2 6.2 0 0 1 12.8 6.4" fill="none" strokeWidth="2.1" />
        <path d="M8.5 11.6 L6 8.8 A3.6 3.6 0 0 1 11 8.8 Z" strokeWidth="0.6" strokeLinejoin="round" />
      </svg>
      <svg width="28" height="13" viewBox="0 0 28 13" fill="none">
        <rect x="0.5" y="0.5" width="24" height="12" rx="3.8" stroke={color} opacity="0.4" />
        <rect x="2" y="2" width="21" height="9" rx="2.4" fill={color} />
        <path d="M26 4.5 V8.5 C26.9 8.2 27.5 7.4 27.5 6.5 C27.5 5.6 26.9 4.8 26 4.5 Z" fill={color} opacity="0.45" />
      </svg>
    </div>
  </div>
)

const metal = 'linear-gradient(135deg, #5d636c 0%, #c9cdd3 12%, #8a9099 30%, #6b717b 50%, #aeb3bb 72%, #d5d9de 88%, #6a707a 100%)'
const btn = (side: 'l' | 'r', top: number, h: number): React.CSSProperties => ({
  position: 'absolute', top, height: h, width: 5, [side === 'l' ? 'left' : 'right']: -3.5,
  background: side === 'l' ? 'linear-gradient(90deg,#4b5058,#a9aeb6 55%,#7d838c)' : 'linear-gradient(270deg,#4b5058,#a9aeb6 55%,#7d838c)',
  borderRadius: 2.5, boxShadow: '0 0 0 0.5px rgba(0,0,0,0.35)',
})

export const IPhone17ProMax: React.FC<{
  children?: React.ReactNode
  scale?: number
  statusBar?: StatusBarMode
  style?: React.CSSProperties
}> = ({ children, scale = 1, statusBar = 'dark', style }) => {
  const color = statusBar === 'light' ? '#ffffff' : '#0b0b0f'
  return (
    <div style={{ position: 'relative', width: IPHONE_OUTER.w * scale, height: IPHONE_OUTER.h * scale, ...style }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: IPHONE_OUTER.w, height: IPHONE_OUTER.h, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
        {/* ombre portée */}
        <div style={{ position: 'absolute', inset: 6, borderRadius: R + PAD, boxShadow: '0 60px 90px -20px rgba(10,12,30,0.35), 0 30px 50px -10px rgba(10,12,30,0.25), 0 8px 16px rgba(10,12,30,0.18)' }} />
        {/* boutons */}
        <div style={btn('l', 128, 30)} />
        <div style={btn('l', 188, 58)} />
        <div style={btn('l', 258, 58)} />
        <div style={btn('r', 226, 96)} />
        <div style={btn('r', 650, 70)} />
        {/* cadre titane */}
        <div style={{ position: 'absolute', inset: 0, borderRadius: R + PAD, background: metal, boxShadow: 'inset 0 0 0 0.8px rgba(255,255,255,0.45), inset 0 0 6px rgba(0,0,0,0.4), 0 0 0 0.6px rgba(0,0,0,0.55)' }} />
        <div style={{ position: 'absolute', inset: 3.2, borderRadius: R + PAD - 3.2, background: '#040405', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08), 0 0 0 0.6px rgba(0,0,0,0.6)' }} />
        {/* antennes */}
        <div style={{ position: 'absolute', left: 0, top: 300, width: 3.2, height: 1.2, background: '#2a2d33', opacity: 0.8 }} />
        <div style={{ position: 'absolute', right: 0, top: 300, width: 3.2, height: 1.2, background: '#2a2d33', opacity: 0.8 }} />
        {/* écran */}
        <div style={{ position: 'absolute', left: PAD, top: PAD, width: IPHONE_SCREEN.w, height: IPHONE_SCREEN.h, borderRadius: R, overflow: 'hidden', background: '#000', isolation: 'isolate' }}>
          <div style={{ position: 'absolute', inset: 0 }}>{children}</div>
          {statusBar !== 'none' && <IOSStatusBar color={color} />}
          {/* Dynamic Island */}
          <div style={{ position: 'absolute', left: (440 - 126) / 2, top: 11, width: 126, height: 37, borderRadius: 18.5, background: '#000', zIndex: 60, boxShadow: '0 0 0 0.5px rgba(255,255,255,0.04)' }}>
            <div style={{ position: 'absolute', right: 20, top: 11, width: 15, height: 15, borderRadius: 8, background: 'radial-gradient(circle at 35% 35%, #26304f 0%, #0b0e1c 55%, #05060c 100%)', boxShadow: 'inset 0 0 0 1.5px #0a0b12' }}>
              <div style={{ position: 'absolute', left: 3.5, top: 3, width: 3, height: 3, borderRadius: 2, background: 'rgba(120,150,255,0.45)' }} />
            </div>
          </div>
          {/* reflet verre */}
          <div style={{ position: 'absolute', inset: 0, zIndex: 70, pointerEvents: 'none', background: 'linear-gradient(115deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0) 28%, rgba(255,255,255,0) 72%, rgba(255,255,255,0.035) 100%)' }} />
          <div style={{ position: 'absolute', inset: 0, zIndex: 71, pointerEvents: 'none', borderRadius: R, boxShadow: 'inset 0 0 0 0.6px rgba(255,255,255,0.12)' }} />
        </div>
      </div>
    </div>
  )
}
