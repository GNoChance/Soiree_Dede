import React from 'react'

/** Curseur tactile (coordonnées = points écran du device parent). */
export const TapIndicator: React.FC<{ x: number; y: number; visible: number; press?: number }> = ({ x, y, visible, press = 0 }) => {
  const D = 46
  const shrink = 1 - 0.16 * press
  const rip = press > 0 && press < 1
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: 0, height: 0, opacity: visible, zIndex: 999, pointerEvents: 'none' }}>
      {rip && (
        <div style={{ position: 'absolute', left: -D / 2, top: -D / 2, width: D, height: D, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.9)', background: 'rgba(255,255,255,0.18)', transform: `scale(${1 + press * 1.7})`, opacity: (1 - press) * 0.85, boxShadow: '0 0 0 1px rgba(0,0,0,0.06)' }} />
      )}
      <div style={{
        position: 'absolute', left: -D / 2, top: -D / 2, width: D, height: D, borderRadius: '50%',
        background: 'radial-gradient(circle at 38% 32%, rgba(255,255,255,0.78), rgba(255,255,255,0.5))',
        border: '1.5px solid rgba(255,255,255,0.95)',
        boxShadow: `0 ${6 - 3 * press}px ${16 - 6 * press}px rgba(10,12,30,0.35), 0 1px 3px rgba(10,12,30,0.3), inset 0 0 0 1px rgba(0,0,0,0.04)`,
        transform: `scale(${shrink})`,
      }} />
    </div>
  )
}
