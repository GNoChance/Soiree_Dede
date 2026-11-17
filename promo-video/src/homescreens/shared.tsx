import React from 'react'
import { Img, staticFile } from 'remotion'
import { clamp01, easeOut, lerp, seg } from '../devices/common'

export type HomeProps = {
  /** 0→1 : apparition (pop) de l'icône, calculée par l'appelant. */
  iconAppear?: number
  /** 0→1 : effet d'enfoncement. */
  iconPress?: number
  /** 0→1 : zoom plein écran révélant appContent. */
  launch?: number
  appContent?: React.ReactNode
}

/** Couche de lancement : un rectangle qui grandit de l'icône à l'écran complet. */
export const LaunchLayer: React.FC<{
  launch: number; cx: number; cy: number; size: number; W: number; H: number; r0: number; r1: number; content: React.ReactNode
}> = ({ launch, cx, cy, size, W, H, r0, r1, content }) => {
  if (launch <= 0) return null
  const t = easeOut(launch)
  const w = lerp(size, W, t)
  const h = lerp(size, H, t)
  const left = lerp(cx - size / 2, 0, t)
  const top = lerp(cy - size / 2, 0, t)
  const s = Math.max(w / W, h / H)
  const iconFade = 1 - seg(launch, 0.04, 0.3)
  return (
    <div style={{ position: 'absolute', left, top, width: w, height: h, borderRadius: lerp(r0, r1, t), overflow: 'hidden', background: '#fff', boxShadow: `0 ${20 * t}px ${60 * t}px rgba(0,0,0,${0.25 * t})`, zIndex: 40 }}>
      <div style={{ position: 'absolute', left: (w - W * s) / 2, top: (h - H * s) / 2, width: W, height: H, transform: `scale(${s})`, transformOrigin: '0 0', opacity: seg(launch, 0.02, 0.22) }}>{content}</div>
      <Img src={staticFile('icons/icon-512.png')} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: iconFade, display: 'block' }} />
    </div>
  )
}

export const pressStyle = (appear: number, press: number): React.CSSProperties => {
  const a = clamp01(appear)
  return {
    transform: `scale(${(0.2 + 0.8 * a) * (1 - 0.1 * press)})`,
    opacity: clamp01(a * 2.5),
    filter: press > 0 ? `brightness(${1 - 0.16 * press})` : undefined,
  }
}
