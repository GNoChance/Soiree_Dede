import React from 'react'
import { Img, staticFile } from 'remotion'
import { SQUIRCLE_ONEUI, clamp01, type Pt } from '../devices/common'
import { LaunchLayer, pressStyle, type HomeProps } from './shared'

const W = 412
const H = 915
const ICON = 54
const colX = (c: number) => 16 + 38 + c * 76
const rowY = (r: number) => 252 + r * 94
const APP_C = 1
const APP_R = 2

export const ONEUI_HOME_TARGETS = { appIcon: { x: colX(APP_C), y: rowY(APP_R) } as Pt }

const GRADS = [
  ['#7fd1ff', '#3d8bff'], ['#ffb199', '#ff6f6f'], ['#b4f0a8', '#4cc68a'], ['#ffe08a', '#f5a623'],
  ['#d3b9ff', '#8e6bff'], ['#9fb4c7', '#5f7488'], ['#ff9ad5', '#e0509f'], ['#8ef0e0', '#2fb5a8'],
]
const Glyph: React.FC<{ k: number }> = ({ k }) => {
  const c = 'rgba(255,255,255,0.88)'
  switch (k % 4) {
    case 0: return <div style={{ width: 24, height: 24, borderRadius: '50%', border: `4px solid ${c}` }} />
    case 1: return <div style={{ width: 24, height: 24, borderRadius: 7, background: c }} />
    case 2: return <div style={{ width: 26, height: 7, borderRadius: 4, background: c, boxShadow: `0 -10px 0 ${c}, 0 10px 0 ${c}` }} />
    default: return <div style={{ width: 22, height: 22, borderRadius: '50% 50% 50% 4px', background: c, transform: 'rotate(-45deg)' }} />
  }
}
const GenericIcon: React.FC<{ i: number; label?: boolean }> = ({ i, label = true }) => {
  const g = GRADS[i % GRADS.length]
  return (
    <div style={{ width: ICON, display: 'flex', flexDirection: 'column', alignItems: 'center', filter: 'blur(1.2px) saturate(0.6)', opacity: 0.93 }}>
      <div style={{ width: ICON, height: ICON, clipPath: SQUIRCLE_ONEUI, background: `linear-gradient(160deg, ${g[0]}, ${g[1]})`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Glyph k={i} /></div>
      {label && <div style={{ marginTop: 7, width: 28 + ((i * 5) % 16), height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.7)' }} />}
    </div>
  )
}

export const OneUIHome: React.FC<HomeProps> = ({ iconAppear = 1, iconPress = 0, launch = 0, appContent }) => {
  const L = clamp01(launch)
  const slots: { c: number; r: number; i: number }[] = []
  let n = 0
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) { if (r === APP_R && c === APP_C) { n++; continue } slots.push({ c, r, i: n++ }) }
  return (
    <div style={{ position: 'relative', width: W, height: H, overflow: 'hidden', background: '#1c2a52', fontFamily: 'Roboto, "Segoe UI", Arial, sans-serif' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(165deg,#3fb4ff 0%,#5b6bff 38%,#a24dff 72%,#ff6fb5 100%)' }} />
      <div style={{ position: 'absolute', left: -100, top: 40, width: 420, height: 420, borderRadius: '50%', background: 'radial-gradient(circle, rgba(130,255,226,0.7), rgba(130,255,226,0) 68%)' }} />
      <div style={{ position: 'absolute', left: 180, top: 560, width: 460, height: 460, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,205,110,0.65), rgba(255,205,110,0) 66%)' }} />

      <div style={{ position: 'absolute', inset: 0, transform: `scale(${1 + 0.18 * L})`, filter: L > 0 ? `blur(${L * 8}px)` : undefined, transformOrigin: `${ONEUI_HOME_TARGETS.appIcon.x}px ${ONEUI_HOME_TARGETS.appIcon.y}px` }}>
        {/* widget horloge */}
        <div style={{ position: 'absolute', left: 0, right: 0, top: 62, textAlign: 'center', color: '#fff', textShadow: '0 2px 10px rgba(30,20,80,0.3)' }}>
          <div style={{ fontSize: 76, fontWeight: 300, letterSpacing: -2, lineHeight: 1 }}>12:45</div>
          <div style={{ fontSize: 15, fontWeight: 500, marginTop: 8, opacity: 0.95 }}>dim. 15 nov.</div>
        </div>
        {slots.map((s) => (
          <div key={s.i} style={{ position: 'absolute', left: colX(s.c) - ICON / 2, top: rowY(s.r) - ICON / 2 }}><GenericIcon i={s.i} /></div>
        ))}
        <div style={{ position: 'absolute', left: colX(APP_C) - ICON / 2, top: rowY(APP_R) - ICON / 2, width: ICON, display: 'flex', flexDirection: 'column', alignItems: 'center', ...pressStyle(iconAppear, iconPress), opacity: clamp01(iconAppear * 2.5) * (1 - clamp01(L * 6)) }}>
          <div style={{ width: ICON, height: ICON, filter: 'drop-shadow(0 5px 8px rgba(20,10,60,0.4))' }}>
            <div style={{ width: ICON, height: ICON, clipPath: SQUIRCLE_ONEUI, background: '#fff' }}>
              <Img src={staticFile('icons/icon-512.png')} style={{ width: '100%', height: '100%', display: 'block' }} />
            </div>
          </div>
          <div style={{ marginTop: 6, fontSize: 11.5, fontWeight: 500, color: '#fff', whiteSpace: 'nowrap', textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>Soirées Dédé</div>
        </div>
        {/* barre de recherche */}
        <div style={{ position: 'absolute', left: 20, right: 20, top: 726, height: 50, borderRadius: 25, background: 'rgba(255,255,255,0.9)', boxShadow: '0 4px 16px rgba(30,20,80,0.2)', display: 'flex', alignItems: 'center', padding: '0 18px', gap: 12 }}>
          <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'conic-gradient(#ff6b6b, #ffc24b, #4cd68a, #4c9bff, #ff6b6b)', WebkitMask: 'radial-gradient(circle, transparent 6px, #000 7px)', mask: 'radial-gradient(circle, transparent 6px, #000 7px)' }} />
          <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'rgba(60,60,80,0.12)', maxWidth: 140 }} />
        </div>
        {/* dock */}
        <div style={{ position: 'absolute', left: 14, right: 14, top: 800, height: 86, borderRadius: 34, background: 'rgba(255,255,255,0.24)', border: '1px solid rgba(255,255,255,0.3)', backdropFilter: 'blur(24px)' }}>
          {[0, 1, 2, 3, 4].map((c) => <div key={c} style={{ position: 'absolute', left: colX(c) - 14 - ICON / 2, top: 16 }}><GenericIcon i={c + 2} label={false} /></div>)}
        </div>
      </div>

      <LaunchLayer launch={L} cx={ONEUI_HOME_TARGETS.appIcon.x} cy={ONEUI_HOME_TARGETS.appIcon.y} size={ICON} W={W} H={H} r0={16} r1={0} content={appContent} />
    </div>
  )
}
