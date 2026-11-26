import { useId, type CSSProperties, type ReactNode } from 'react'
import { SnowLayer } from '@/components/ui/SnowLayer'

/**
 * Décor du calendrier : une maison de Noël en carton sous un ciel étoilé.
 * Toit enneigé, cheminée qui fume, guirlande qui court le long du toit (une ampoule par jour ouvert),
 * lucarne et façade qui s'éclairent au fil du mois. Purement présentationnel : `lit` = nombre de cases ouvertes (0 à 24).
 */
const INK = '#1f1b2e'
const BULB_COLORS = ['#ffd23f', '#06d6a0', '#4cc9f0', '#fff3c4', '#ff9f1c', '#c4a7ff']

/** Pseudo-aléatoire stable. */
const rnd = (i: number, k: number) => {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453
  return x - Math.floor(x)
}
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

type Pt = { x: number; y: number }
const ROOF_W = 360
const ROOF_H = 132
const PEAK: Pt = { x: 180, y: 22 }

/** Ancrages de la guirlande : le long des deux pentes (juste à l'intérieur du bord), 12 ampoules de chaque côté. */
function garlandPoints() {
  const left = (t: number): Pt => ({ x: 9.2 + 176 * t, y: 136.6 - 106 * t })
  const mirror = (p: Pt): Pt => ({ x: ROOF_W - p.x, y: p.y })
  const bulbs: Pt[] = []
  for (let k = 0; k < 12; k++) bulbs.push(left(0.14 + (0.78 * k) / 11))
  for (let k = 11; k >= 0; k--) bulbs.push(mirror(left(0.14 + (0.78 * k) / 11)))
  const cord: Pt[] = [left(0.07), ...bulbs.slice(0, 12), { x: 180, y: 33 }, ...bulbs.slice(12), mirror(left(0.07))]
  let d = `M${cord[0].x.toFixed(1)} ${cord[0].y.toFixed(1)}`
  for (let i = 1; i < cord.length; i++) {
    const a = cord[i - 1]
    const b = cord[i]
    d += ` Q${((a.x + b.x) / 2).toFixed(1)} ${((a.y + b.y) / 2 + 5).toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`
  }
  return { bulbs, cord: d }
}
const GARLAND = garlandPoints()

/** Neige du toit : bord inférieur en gouttes arrondies (`edge` = la ligne de gouttes, `fill` = toute la calotte). */
function snowCapPaths(y0 = 54) {
  const seg = 30
  const n = ROOF_W / seg
  const ctrl = (i: number) => y0 + (12 + ((i * 7) % 5) * 3) * 1.9
  let edge = `M0 ${y0}`
  for (let i = 0; i < n; i++) edge += ` Q${i * seg + seg / 2} ${ctrl(i)} ${(i + 1) * seg} ${y0}`
  let fill = `M0 -6 H${ROOF_W} V${y0}`
  for (let i = n - 1; i >= 0; i--) fill += ` Q${i * seg + seg / 2} ${ctrl(i)} ${i * seg} ${y0}`
  return { edge, fill: fill + ' Z' }
}
const SNOW = snowCapPaths()

function Roof({ lit }: { lit: number }) {
  const uid = useId().replace(/:/g, '')
  const window = clamp01((lit - 3) / 9)
  const complete = lit >= 24
  return (
    <svg viewBox={`0 0 ${ROOF_W} ${ROOF_H}`} className="relative block w-full overflow-visible" aria-hidden>
      <defs>
        <clipPath id={`roof-${uid}`}>
          <path d={`M4 128 L${PEAK.x} ${PEAK.y} L356 128 Z`} />
        </clipPath>
        <pattern id={`tiles-${uid}`} width="22" height="14" patternUnits="userSpaceOnUse">
          <rect width="22" height="14" fill="#d8435d" />
          <path d="M-11 14 Q0 2 11 14 Q22 2 33 14" fill="none" stroke="#a82b45" strokeWidth="2.2" />
        </pattern>
        <radialGradient id={`win-${uid}`}>
          <stop offset="0" stopColor="#fff7c4" />
          <stop offset="1" stopColor="#ffc233" />
        </radialGradient>
      </defs>

      {/* cheminée (derrière le toit) + fumée */}
      <g>
        <rect x="262" y="30" width="36" height="68" fill="#c4553f" stroke={INK} strokeWidth="4" strokeLinejoin="round" />
        <path d="M262 50h36M262 70h36M276 30v20M288 50v20M274 70v20" stroke="#8f3a2a" strokeWidth="2" />
        <rect x="256" y="20" width="48" height="14" rx="4" fill="#fff" stroke={INK} strokeWidth="4" />
        {[0, 1.4, 2.8].map((d, i) => (
          <circle key={i} className="advent-smoke" style={{ '--delay': `${d}s` } as CSSProperties} cx={278 + i * 3} cy="10" r="7" fill="#e6ecff" opacity="0.8" />
        ))}
      </g>

      {/* toit */}
      <path d={`M4 128 L${PEAK.x} ${PEAK.y} L356 128 Z`} fill={`url(#tiles-${uid})`} />
      <g clipPath={`url(#roof-${uid})`}>
        <path d={SNOW.fill} fill="#fff" />
        <path d={SNOW.edge} fill="none" stroke={INK} strokeWidth="3.5" strokeLinecap="round" />
        <path d={SNOW.edge} fill="none" stroke="#bcd4f5" strokeWidth="3" transform="translate(0 6)" opacity="0.7" />
      </g>
      <path d={`M4 128 L${PEAK.x} ${PEAK.y} L356 128 Z`} fill="none" stroke={INK} strokeWidth="4.5" strokeLinejoin="round" />
      {/* avant-toit */}
      <rect x="0" y="124" width="360" height="10" rx="3" fill="#b8324b" stroke={INK} strokeWidth="4" />

      {/* lucarne : s'allume dès la 4e case */}
      <g transform="translate(180 88)">
        <circle r="17" fill="#243055" stroke={INK} strokeWidth="4" />
        <circle r="13.5" fill={`url(#win-${uid})`} opacity={window} style={{ transition: 'opacity 1s' }} />
        <circle r="26" fill="#ffd23f" opacity={window * 0.28} style={{ filter: 'blur(5px)', transition: 'opacity 1s' }} />
        <path d="M-13.5 0h27M0 -13.5v27" stroke={INK} strokeWidth="3" />
        <circle r="17" fill="none" stroke={INK} strokeWidth="4" />
      </g>

      {/* guirlande */}
      <path d={GARLAND.cord} fill="none" stroke={INK} strokeWidth="3.2" strokeLinecap="round" />
      {GARLAND.bulbs.map((p, i) => {
        const on = i < lit
        const color = BULB_COLORS[i % BULB_COLORS.length]
        return (
          <g key={i} transform={`translate(${p.x.toFixed(1)} ${(p.y + 3).toFixed(1)})`}>
            <g
              className={on ? 'advent-bulb advent-bulb-on' : 'advent-bulb'}
              style={{ '--delay': `${(i * 0.05).toFixed(2)}s`, filter: on ? `drop-shadow(0 0 3px ${color})` : undefined } as CSSProperties}
            >
              <rect x="-2.6" y="0" width="5.2" height="4" rx="1" fill="#3a3355" stroke={INK} strokeWidth="1.2" />
              <ellipse cy="9.5" rx="5" ry="6.4" fill={on ? color : '#4b4f7d'} stroke={INK} strokeWidth="1.8" />
              <ellipse cx="-1.6" cy="7.4" rx="1.4" ry="2.2" fill="#fff" opacity={on ? 0.75 : 0.22} />
            </g>
          </g>
        )
      })}

      {/* étoile du sommet : s'illumine quand les 24 cases sont ouvertes */}
      <g transform={`translate(${PEAK.x} ${PEAK.y - 6})`}>
        <path
          className={complete ? 'advent-star-top advent-star-on' : 'advent-star-top'}
          d="M0 -14 L4.2 -4.4 L14.6 -3.6 L6.6 3.2 L9.1 13.2 L0 7.8 L-9.1 13.2 L-6.6 3.2 L-14.6 -3.6 L-4.2 -4.4 Z"
          fill={complete ? '#ffd23f' : '#9b94c4'}
          stroke={INK}
          strokeWidth="3"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  )
}

function Moon() {
  const uid = useId().replace(/:/g, '')
  return (
    <svg viewBox="0 0 40 40" className="absolute top-3 left-4 w-9" aria-hidden>
      <defs>
        <mask id={`moon-${uid}`}>
          <rect width="40" height="40" fill="#000" />
          <circle cx="20" cy="20" r="14" fill="#fff" />
          <circle cx="27" cy="15" r="12" fill="#000" />
        </mask>
      </defs>
      <rect width="40" height="40" fill="#fff3b0" mask={`url(#moon-${uid})`} />
    </svg>
  )
}

function Ground() {
  return (
    <svg viewBox="0 0 360 40" preserveAspectRatio="none" className="relative z-10 -mt-px block h-9 w-full" aria-hidden>
      <path d="M0 10 C30 -4 62 -4 92 8 S152 22 182 9 S242 -4 272 8 S332 20 360 6 V40 H0 Z" fill="#fff" stroke={INK} strokeWidth="3.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <path d="M20 24 C60 18 100 30 150 24 S250 18 340 26" fill="none" stroke="#bcd4f5" strokeWidth="3" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export function AdventScene({ lit, children }: { lit: number; children: ReactNode }) {
  const stars = 8 + lit
  return (
    <section
      aria-label="Calendrier de l’Avent"
      className="advent-sky sticker relative -mx-2 overflow-hidden rounded-bubble pt-9"
      style={{ '--lit': clamp01(lit / 24) } as CSSProperties}
    >
      {Array.from({ length: stars }, (_, i) => (
        <span
          key={i}
          aria-hidden
          className="advent-star"
          style={
            {
              '--x': `${(4 + rnd(i, 1) * 92).toFixed(1)}%`,
              '--y': `${(2 + rnd(i, 2) * 42).toFixed(1)}%`,
              '--s': `${(2 + rnd(i, 3) * 2.4).toFixed(1)}px`,
              '--d': `${(2.2 + rnd(i, 4) * 2.6).toFixed(2)}s`,
              '--delay': `${(-rnd(i, 5) * 4).toFixed(2)}s`,
            } as CSSProperties
          }
        />
      ))}
      <Moon />
      <SnowLayer count={12} size={13} duration={11} />

      <div className="relative z-[2] px-1">
        <Roof lit={lit} />
        <div className="advent-facade relative mx-[5px] -mt-px overflow-visible rounded-b-[14px] border-4 border-t-0 border-ink">
          {/* la façade s'éclaire au fil du mois */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-b-[10px]"
            style={{
              background:
                'radial-gradient(ellipse at 50% 100%, rgba(255, 196, 70, calc(0.55 * var(--lit))), transparent 75%), rgba(28, 32, 110, calc(0.34 * (1 - var(--lit))))',
            }}
          />
          <div className="relative p-2 [container-type:inline-size]">{children}</div>
        </div>
      </div>

      <Ground />
      <SnowLayer count={5} size={10} duration={9} className="z-20" />
    </section>
  )
}
