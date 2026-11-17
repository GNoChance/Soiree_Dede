import React from 'react'
import { Img, interpolate, spring, staticFile } from 'remotion'
import { BODY, C, CHARACTERS, DISPLAY, chibiPath, sticker, type Slug } from '../theme'

export const FPS = 60
export type SpringCfg = { stiffness?: number; damping?: number; mass?: number }

/** Spring piloté par une frame locale `t`, décalé de `delay` frames. */
export const sp = (t: number, delay = 0, config: SpringCfg = { stiffness: 300, damping: 12 }) =>
  spring({ frame: Math.max(0, t - delay), fps: FPS, config })

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
export const ramp = (t: number, from: number, to: number, a = 0, b = 1) =>
  interpolate(t, [from, to], [a, b], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

/** Petit sautillement permanent (≈ animation `float`/`bounce` de l'app). */
export const bob = (t: number, phase = 0, amp = 6, period = 84) => -Math.abs(Math.sin(((t + phase) / period) * Math.PI)) * amp
export const wiggle = (t: number, phase = 0, deg = 4, period = 72) => Math.sin(((t + phase) / period) * Math.PI * 2) * deg

export const bySlug = (slug: Slug) => CHARACTERS.find((c) => c.slug === slug)!

export const Chibi: React.FC<{ slug: Slug; expression?: string; size: number; thumb?: boolean; style?: React.CSSProperties }> = ({
  slug, expression = 'joie', size, thumb, style,
}) => (
  <Img
    src={staticFile(chibiPath(slug, expression, thumb ?? size <= 70))}
    style={{ width: size, height: size, objectFit: 'contain', display: 'block', ...style }}
  />
)

/** Disque sticker (couleur du perso) + chibi. */
export const Avatar: React.FC<{
  slug: Slug; expression?: string; size?: number; badge?: React.ReactNode; ring?: boolean; style?: React.CSSProperties
}> = ({ slug, expression = 'joie', size = 56, badge, ring, style }) => (
  <div style={{ position: 'relative', width: size, height: size, flexShrink: 0, ...style }}>
    <div
      style={{
        width: '100%', height: '100%', borderRadius: '50%', overflow: 'hidden', boxSizing: 'border-box',
        border: `3px solid ${C.ink}`, boxShadow: ring ? `${sticker(2)}, 0 0 0 4px ${C.sun}` : sticker(2),
        background: bySlug(slug).color, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <Chibi slug={slug} expression={expression} size={size * 0.92} style={{ marginTop: '6%' }} />
    </div>
    {badge && (
      <span
        style={{
          position: 'absolute', right: -4, bottom: -4, width: '38%', height: '38%', borderRadius: '50%',
          border: `2px solid ${C.ink}`, background: C.surface, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: size * 0.2,
        }}
      >
        {badge}
      </span>
    )}
  </div>
)

export const Badge: React.FC<{ bg?: string; color?: string; rot?: number; children: React.ReactNode; size?: number; style?: React.CSSProperties }> = ({
  bg = C.sun, color = C.ink, rot = -2, children, size = 14, style,
}) => (
  <span
    style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 10px', borderRadius: 999,
      border: `2px solid ${C.ink}`, boxShadow: sticker(2), background: bg, color, fontFamily: DISPLAY, fontWeight: 800,
      fontSize: size, lineHeight: 1.35, transform: `rotate(${rot}deg)`, whiteSpace: 'nowrap', ...style,
    }}
  >
    {children}
  </span>
)

export const Card: React.FC<{ bg?: string; style?: React.CSSProperties; children?: React.ReactNode; radius?: number }> = ({
  bg = C.surface, style, children, radius = 24,
}) => (
  <div
    style={{
      boxSizing: 'border-box', border: `3px solid ${C.ink}`, borderRadius: radius, boxShadow: sticker(4), background: bg,
      color: C.text, padding: 16, ...style,
    }}
  >
    {children}
  </div>
)

export const Button: React.FC<{ children: React.ReactNode; size?: 'md' | 'lg'; bg?: string; style?: React.CSSProperties }> = ({
  children, size = 'lg', bg = C.sun, style,
}) => (
  <div
    style={{
      boxSizing: 'border-box', width: '100%', minHeight: size === 'lg' ? 64 : 48, borderRadius: size === 'lg' ? 32 : 24,
      border: `3px solid ${C.ink}`, boxShadow: sticker(4), background: bg, color: C.ink, fontFamily: DISPLAY, fontWeight: 800,
      fontSize: size === 'lg' ? 24 : 18, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, ...style,
    }}
  >
    {children}
  </div>
)

export const Segmented: React.FC<{ options: string[]; active: number; style?: React.CSSProperties; fontSize?: number }> = ({
  options, active, style, fontSize = 15,
}) => (
  <div
    style={{
      boxSizing: 'border-box', display: 'flex', gap: 4, padding: 4, border: `3px solid ${C.ink}`, borderRadius: 32,
      boxShadow: sticker(4), background: C.sunk, position: 'relative', ...style,
    }}
  >
    {options.map((o, i) => (
      <div
        key={o}
        style={{
          flex: '1 1 0', minWidth: 0, textAlign: 'center', padding: '7px 2px', borderRadius: 24, fontFamily: DISPLAY, fontWeight: 800, fontSize,
          color: i === active ? C.ink : C.muted, background: i === active ? C.sun : 'transparent',
          border: i === active ? `2px solid ${C.ink}` : '2px solid transparent', boxShadow: i === active ? sticker(2) : 'none',
          whiteSpace: 'nowrap',
        }}
      >
        {o}
      </div>
    ))}
  </div>
)

/** Icônes lucide (tracés recopiés). */
const ICONS: Record<string, React.ReactNode> = {
  games: (<><line x1="6" x2="10" y1="11" y2="11" /><line x1="8" x2="8" y1="9" y2="13" /><line x1="15" x2="15.01" y1="12" y2="12" /><line x1="18" x2="18.01" y1="10" y2="10" /><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z" /></>),
  inventory: (<><path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z" /><path d="M12 22V12" /><path d="m3.3 7 8.7 5 8.7-5" /></>),
  trophy: (<><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" /></>),
  users: (<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>),
  settings: (<><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></>),
  lock: (<><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>),
  check: <path d="M20 6 9 17l-5-5" />,
  crown: (<><path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z" /><path d="M5 21h14" /></>),
}
export const Icon: React.FC<{ name: keyof typeof ICONS; size?: number; color?: string; stroke?: number; fill?: string; style?: React.CSSProperties }> = ({
  name, size = 24, color = C.ink, stroke = 2.5, fill = 'none', style,
}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', ...style }}>
    {ICONS[name]}
  </svg>
)

export const TABS = [
  { label: 'Jeux', icon: 'games' },
  { label: 'Inventaire', icon: 'inventory' },
  { label: 'Classement', icon: 'trophy' },
  { label: 'Amis', icon: 'users' },
  { label: 'Réglages', icon: 'settings' },
] as const

export const BottomNav: React.FC<{ active: number; t: number; delay?: number; width: number }> = ({ active, t, delay = 0, width }) => {
  const rise = sp(t, delay, { stiffness: 200, damping: 18 })
  return (
    <div
      style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, padding: '0 12px 26px', pointerEvents: 'none',
        transform: `translateY(${(1 - rise) * 140}px)`,
      }}
    >
      <div
        style={{
          boxSizing: 'border-box', display: 'flex', gap: 4, padding: 6, border: `3px solid ${C.ink}`, borderRadius: 32,
          boxShadow: sticker(4), background: C.surface, width: width - 24,
        }}
      >
        {TABS.map((tab, i) => {
          const on = i === active
          const pop = on ? sp(t, delay + 14, { stiffness: 600, damping: 12 }) : 1
          return (
            <div key={tab.label} style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '6px 2px', borderRadius: 24 }}>
              {on && <div style={{ position: 'absolute', inset: 0, borderRadius: 24, border: `3px solid ${C.ink}`, background: C.sun, boxShadow: sticker(2) }} />}
              <div style={{ position: 'relative', transform: `scale(${0.5 + 0.5 * pop}) rotate(${(1 - pop) * -25}deg)` }}>
                <Icon name={tab.icon} size={24} color={on ? C.ink : C.muted} stroke={on ? 3 : 2.5} />
              </div>
              <span style={{ position: 'relative', fontFamily: DISPLAY, fontWeight: 800, fontSize: 11.2, lineHeight: 1, color: on ? C.ink : C.muted }}>{tab.label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Fond crème à pois + conteneur d'écran. */
export const ScreenBase: React.FC<{ width: number; height: number; children: React.ReactNode; dots?: boolean }> = ({ width, height, children, dots = true }) => (
  <div
    style={{
      position: 'relative', width, height, overflow: 'hidden', background: C.paper, fontFamily: BODY, fontWeight: 600, color: C.text,
      backgroundImage: dots ? 'radial-gradient(rgba(31,27,46,0.07) 2px, transparent 2px)' : undefined, backgroundSize: '22px 22px',
    }}
  >
    {children}
  </div>
)

/** Zone défilante : décalée de `scrollY`. */
export const Scroller: React.FC<{ safeTop: number; scrollY: number; bottomPad?: number; children: React.ReactNode; gap?: number }> = ({
  safeTop, scrollY, bottomPad = 130, children, gap = 16,
}) => (
  <div style={{ position: 'absolute', left: 0, right: 0, top: 0, padding: `${safeTop + 10}px 16px ${bottomPad}px`, transform: `translateY(${-scrollY}px)`, display: 'flex', flexDirection: 'column', gap }}>
    {children}
  </div>
)

/** Entrée « StaggerItem » : monte et grossit avec rebond. */
export const Pop: React.FC<{ t: number; delay: number; children: React.ReactNode; style?: React.CSSProperties; from?: number }> = ({ t, delay, children, style, from = 30 }) => {
  const s = sp(t, delay, { stiffness: 260, damping: 15 })
  return (
    <div style={{ opacity: clamp01(s * 1.6), transform: `translateY(${(1 - s) * from}px) scale(${0.85 + 0.15 * s})`, ...style }}>{children}</div>
  )
}

export const H1: React.FC<{ children: React.ReactNode; size?: number; style?: React.CSSProperties }> = ({ children, size = 36, style }) => (
  <h1 style={{ margin: 0, fontFamily: DISPLAY, fontWeight: 800, fontSize: size, lineHeight: 1.1, color: C.text, ...style }}>{children}</h1>
)

export const GAMES = [
  { id: 'qui-de-nous', name: 'Qui de nous ?', emoji: '🫵', color: '#FF8FA3', tagline: 'Qui finirait les restes du frigo à 3 h du mat’ ? Votez, et visez la majorité !', min: 3 },
  { id: 'undercover', name: 'Undercover', emoji: '🕵️', color: '#8B5CF6', tagline: 'Un mot presque pareil se cache parmi vous… Démasquez l’infiltré !', min: 3 },
  { id: 'pas-de-bol', name: 'Pas de bol !', emoji: '🃏', color: '#FB8500', tagline: 'Vide ta main avant les autres… le dernier a vraiment pas de bol !', min: 2 },
  { id: 'cerveau-en-fete', name: 'Cerveau en fête', emoji: '🧠', color: '#4CC9F0', tagline: 'Le quiz express : tape la réponse avant les autres !', min: 2 },
  { id: 'petit-bac', name: 'Petit bac', emoji: '🔤', color: '#B5E61D', tagline: 'Une lettre, des catégories, un chrono qui file… Vite, vite !', min: 2 },
  { id: 'dessine-devine', name: 'Dessine & devine', emoji: '✏️', color: '#06D6A0', tagline: 'Un crayon, un mot secret, et des amis qui tapent n’importe quoi.', min: 3 },
]
