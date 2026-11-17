import React from 'react'

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
/** Sous-intervalle d'une progression : 0 avant a, 1 après b. */
export const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a))
export const easeOut = (t: number) => 1 - Math.pow(1 - clamp01(t), 3)

/** clip-path polygon d'un squircle (superellipse) façon icône iOS. */
export const squircleClip = (n = 5, steps = 96) => {
  const pts: string[] = []
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2
    const c = Math.cos(a), s = Math.sin(a)
    const x = 50 + 50 * Math.sign(c) * Math.pow(Math.abs(c), 2 / n)
    const y = 50 + 50 * Math.sign(s) * Math.pow(Math.abs(s), 2 / n)
    pts.push(`${x.toFixed(2)}% ${y.toFixed(2)}%`)
  }
  return `polygon(${pts.join(',')})`
}
export const SQUIRCLE_IOS = squircleClip(5)
export const SQUIRCLE_ONEUI = squircleClip(3.6)

const P: Record<string, React.ReactNode> = {
  share: <><path d="M8 10 H6.5 A2 2 0 0 0 4.5 12 V19 A2 2 0 0 0 6.5 21 H17.5 A2 2 0 0 0 19.5 19 V12 A2 2 0 0 0 17.5 10 H16" /><path d="M12 14.5 V3 M8.2 6.6 L12 2.8 L15.8 6.6" /></>,
  bookmark: <path d="M12 6.5 C10 5 7 4.6 3.5 5 V18 C7 17.6 10 18 12 19.5 C14 18 17 17.6 20.5 18 V5 C17 4.6 14 5 12 6.5 Z M12 6.5 V19.5" />,
  star: <path d="M12 3.5 L14.5 9.2 L20.7 9.8 L16 13.9 L17.4 20 L12 16.8 L6.6 20 L8 13.9 L3.3 9.8 L9.5 9.2 Z" />,
  search: <><circle cx="10.5" cy="10.5" r="6" /><path d="M15 15 L20 20" /></>,
  plusSquare: <><rect x="4" y="4" width="16" height="16" rx="4.2" /><path d="M12 8.5 V15.5 M8.5 12 H15.5" /></>,
  plus: <path d="M12 5 V19 M5 12 H19" />,
  copy: <><rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.6" /><path d="M16 8.5 V6.6 A2.6 2.6 0 0 0 13.4 4 H6.6 A2.6 2.6 0 0 0 4 6.6 V13.4 A2.6 2.6 0 0 0 6.6 16 H8.5" /></>,
  glasses: <><circle cx="7" cy="14.5" r="3.5" /><circle cx="17" cy="14.5" r="3.5" /><path d="M10.5 14 Q12 12.6 13.5 14 M3.6 14.5 L5.2 8 M20.4 14.5 L18.8 8" /></>,
  printer: <><path d="M7 9 V4.5 H17 V9" /><rect x="3.5" y="9" width="17" height="8" rx="2.4" /><rect x="7" y="14" width="10" height="6.5" rx="1" /></>,
  chevronLeft: <path d="M15 5 L8 12 L15 19" />,
  chevronRight: <path d="M9 5 L16 12 L9 19" />,
  lock: <><rect x="5.5" y="10.5" width="13" height="9.5" rx="2.6" /><path d="M8.5 10.5 V8 A3.5 3.5 0 0 1 15.5 8 V10.5" /></>,
  x: <path d="M6 6 L18 18 M18 6 L6 18" />,
  forward: <path d="M5 12 H19 M13 6 L19 12 L13 18" />,
  download: <path d="M12 4 V15 M7 11 L12 16 L17 11 M5 20 H19" />,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11 V16.2 M12 7.9 V8.1" /></>,
  refresh: <path d="M19 12 A7 7 0 1 1 16.6 6.7 M19.2 3.8 V8.2 H14.8" />,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7 V12 L15.4 14" /></>,
  incognito: <><path d="M3.5 11 H20.5 M6.2 11 L7.8 5.5 H16.2 L17.8 11" /><circle cx="8" cy="16.3" r="2.6" /><circle cx="16" cy="16.3" r="2.6" /><path d="M10.6 16 Q12 15 13.4 16" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="7.6" strokeDasharray="3.1 2.6" strokeWidth="3.4" /></>,
  addHome: <><rect x="6" y="2.8" width="12" height="18.4" rx="3" /><path d="M12 8.5 V15.5 M8.5 12 H15.5" /></>,
  home: <path d="M4 11 L12 4 L20 11 V19.5 H14.5 V14 H9.5 V19.5 H4 Z" />,
  desktop: <><rect x="3.5" y="5" width="17" height="11" rx="2" /><path d="M8.5 20 H15.5 M12 16 V20" /></>,
  tab: <><rect x="4" y="4" width="16" height="16" rx="4" /></>,
  check: <path d="M5 12.8 L10 17.5 L19 7" />,
  note: <><rect x="5" y="3.5" width="14" height="17" rx="2.5" /><path d="M8.5 8.5 H15.5 M8.5 12 H15.5 M8.5 15.5 H12.5" /></>,
  mail: <><rect x="3.5" y="5.5" width="17" height="13" rx="2.8" /><path d="M4.5 7.5 L12 13 L19.5 7.5" /></>,
  bubble: <path d="M12 4.5 C7.3 4.5 3.5 7.6 3.5 11.5 C3.5 13.6 4.6 15.4 6.3 16.7 C6.1 18 5.4 19.2 4.5 20 C6.3 19.8 7.8 19.2 8.8 18.4 C9.8 18.7 10.9 18.9 12 18.9 C16.7 18.9 20.5 15.8 20.5 11.7 C20.5 7.6 16.7 4.5 12 4.5 Z" />,
  more: <><circle cx="5.5" cy="12" r="1.5" fill="currentColor" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /><circle cx="18.5" cy="12" r="1.5" fill="currentColor" /></>,
  moreV: <><circle cx="12" cy="5.5" r="1.7" fill="currentColor" /><circle cx="12" cy="12" r="1.7" fill="currentColor" /><circle cx="12" cy="18.5" r="1.7" fill="currentColor" /></>,
}
export const Ico: React.FC<{ n: string; size?: number; color?: string; sw?: number; fill?: string; style?: React.CSSProperties }> = ({ n, size = 24, color = 'currentColor', sw = 1.8, fill = 'none', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0, ...style }}>
    {P[n]}
  </svg>
)

export type Pt = { x: number; y: number }
