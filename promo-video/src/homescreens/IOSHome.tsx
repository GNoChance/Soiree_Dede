import React from 'react'
import { Img, staticFile } from 'remotion'
import { SQUIRCLE_IOS, lerp, clamp01, type Pt } from '../devices/common'
import { LaunchLayer, pressStyle, type HomeProps } from './shared'

const W = 440
const H = 956
const ICON = 62
const colX = (c: number) => 28 + 31 + c * ((W - 56 - ICON) / 3)
const rowY = (r: number) => 112 + r * 104
const APP_C = 1
const APP_R = 3

export const IOS_HOME_TARGETS = { appIcon: { x: colX(APP_C), y: rowY(APP_R) } as Pt }

const GRADS = [
  ['#ff9a8b', '#ff6a88'], ['#a1c4fd', '#6b8cff'], ['#fbc2eb', '#a18cd1'], ['#84fab0', '#46c7b8'],
  ['#ffd89b', '#f6a04d'], ['#cfd9df', '#9aa7b8'], ['#f093fb', '#c06ad8'], ['#8fd3f4', '#4da0e0'],
]
const Glyph: React.FC<{ k: number }> = ({ k }) => {
  const c = 'rgba(255,255,255,0.85)'
  switch (k % 5) {
    case 0: return <div style={{ width: 26, height: 26, borderRadius: '50%', border: `4px solid ${c}` }} />
    case 1: return <div style={{ width: 26, height: 26, borderRadius: 7, background: c }} />
    case 2: return <div style={{ width: 0, height: 0, borderLeft: '14px solid transparent', borderRight: '14px solid transparent', borderBottom: `24px solid ${c}` }} />
    case 3: return <div style={{ width: 28, height: 8, borderRadius: 4, background: c, boxShadow: `0 -11px 0 ${c}, 0 11px 0 ${c}` }} />
    default: return <div style={{ width: 24, height: 24, borderRadius: '50% 50% 50% 4px', background: c, transform: 'rotate(-45deg)' }} />
  }
}
const GenericIcon: React.FC<{ i: number; label?: boolean }> = ({ i, label = true }) => {
  const g = GRADS[i % GRADS.length]
  return (
    <div style={{ width: ICON, display: 'flex', flexDirection: 'column', alignItems: 'center', filter: 'blur(1.4px) saturate(0.55)', opacity: 0.92 }}>
      <div style={{ width: ICON, height: ICON, clipPath: SQUIRCLE_IOS, background: `linear-gradient(160deg, ${g[0]}, ${g[1]})`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Glyph k={i} /></div>
      {label && <div style={{ marginTop: 7, width: 30 + ((i * 7) % 18), height: 7, borderRadius: 4, background: 'rgba(255,255,255,0.7)' }} />}
    </div>
  )
}

export const IOSHome: React.FC<HomeProps> = ({ iconAppear = 1, iconPress = 0, launch = 0, appContent }) => {
  const L = clamp01(launch)
  const slots: { c: number; r: number; i: number }[] = []
  let n = 0
  for (let r = 0; r < 6; r++) for (let c = 0; c < 4; c++) { if (r === APP_R && c === APP_C) { n++; continue } slots.push({ c, r, i: n++ }) }
  return (
    <div style={{ position: 'relative', width: W, height: H, overflow: 'hidden', background: '#2a2f6b', fontFamily: '-apple-system, "SF Pro Text", "Segoe UI", Roboto, Arial, sans-serif' }}>
      {/* fond abstrait */}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(170deg,#ff9a76 0%,#ff6f91 30%,#8f6bff 62%,#2d6bff 100%)' }} />
      <div style={{ position: 'absolute', left: -120, top: 80, width: 460, height: 460, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,214,102,0.9), rgba(255,214,102,0) 68%)' }} />
      <div style={{ position: 'absolute', left: 160, top: 520, width: 520, height: 520, borderRadius: '50%', background: 'radial-gradient(circle, rgba(70,220,255,0.75), rgba(70,220,255,0) 66%)' }} />
      <div style={{ position: 'absolute', left: -140, top: 600, width: 420, height: 420, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,80,180,0.65), rgba(255,80,180,0) 66%)' }} />

      <div style={{ position: 'absolute', inset: 0, transform: `scale(${1 + 0.18 * L})`, opacity: 1 - 0.0 * L, filter: L > 0 ? `blur(${L * 8}px)` : undefined, transformOrigin: `${IOS_HOME_TARGETS.appIcon.x}px ${IOS_HOME_TARGETS.appIcon.y}px` }}>
        {/* grille */}
        {slots.map((s) => (
          <div key={s.i} style={{ position: 'absolute', left: colX(s.c) - ICON / 2, top: rowY(s.r) - ICON / 2 }}><GenericIcon i={s.i} /></div>
        ))}
        {/* nouvelle icône */}
        <div style={{ position: 'absolute', left: colX(APP_C) - ICON / 2, top: rowY(APP_R) - ICON / 2, width: ICON, display: 'flex', flexDirection: 'column', alignItems: 'center', ...pressStyle(iconAppear, iconPress), opacity: clamp01(iconAppear * 2.5) * (1 - clamp01(L * 6)) }}>
          <div style={{ width: ICON, height: ICON, filter: 'drop-shadow(0 6px 10px rgba(20,10,60,0.4))' }}>
            <div style={{ width: ICON, height: ICON, clipPath: SQUIRCLE_IOS, background: '#fff' }}>
              <Img src={staticFile('icons/icon-512.png')} style={{ width: '100%', height: '100%', display: 'block' }} />
            </div>
          </div>
          <div style={{ marginTop: 6, fontSize: 12, fontWeight: 500, color: '#fff', whiteSpace: 'nowrap', textShadow: '0 1px 3px rgba(0,0,0,0.35)', letterSpacing: -0.1 }}>Soirées Dédé</div>
        </div>
        {/* points de page */}
        <div style={{ position: 'absolute', left: 0, right: 0, top: 790, display: 'flex', justifyContent: 'center', gap: 9 }}>
          {[0, 1, 2].map((i) => <div key={i} style={{ width: 7, height: 7, borderRadius: 4, background: i === 0 ? '#fff' : 'rgba(255,255,255,0.45)' }} />)}
        </div>
        {/* dock */}
        <div style={{ position: 'absolute', left: 16, right: 16, top: 826, height: 96, borderRadius: 38, background: 'rgba(255,255,255,0.26)', border: '1px solid rgba(255,255,255,0.35)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.4)', backdropFilter: 'blur(24px)' }}>
          {[0, 1, 2, 3].map((c) => <div key={c} style={{ position: 'absolute', left: colX(c) - 16 - ICON / 2, top: 17 }}><GenericIcon i={c + 3} label={false} /></div>)}
        </div>
      </div>

      <LaunchLayer launch={L} cx={IOS_HOME_TARGETS.appIcon.x} cy={IOS_HOME_TARGETS.appIcon.y} size={ICON} W={W} H={H} r0={14} r1={lerp(14, 0, 1)} content={appContent} />
    </div>
  )
}
