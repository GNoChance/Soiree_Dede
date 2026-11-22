import { memo } from 'react'
import { cn } from '@/lib/cn'

/**
 * Les 12 pièces en SVG maison, style « sticker book » : contour épais, ombre
 * décalée, couleurs franches (crème / prune, jamais blanc ou noir purs) pour
 * rester lisibles sur les deux couleurs de cases, en thème clair comme sombre.
 * viewBox 100 × 100 ; `piece` = lettre FEN (K Q R B N P, minuscule = Noirs).
 */

const INK = '#1f1b2e'
const FILL = { w: '#fff4d6', b: '#3d3358' }
const SHINE = { w: '#ffffff', b: '#7a6aa8' }
const DETAIL = { w: '#c9a96a', b: '#a99ad6' }

/** Thème « pain d'épice » (cadeau de l'Avent c_pain_epice) : biscuit clair / foncé, détails en glaçage. */
const GINGER = {
  fill: { w: '#E2A56B', b: '#8B4A24' },
  shine: { w: '#FFE3C2', b: '#C47A48' },
  detail: { w: '#FFFFFF', b: '#FFFFFF' },
}
const ICING = 'M 25 81 Q 31 77 37 81 T 49 81 T 61 81 T 73 81'
export type PieceTheme = 'gingerbread'

const BASE = 'M 22 74 L 78 74 Q 82 74 82 79 L 82 84 Q 82 89 77 89 L 23 89 Q 18 89 18 84 L 18 79 Q 18 74 22 74 Z'

/** Silhouettes (remplies) et détails (traits) de chaque pièce. */
const SHAPES: Record<string, { body: string[]; dots?: Array<[number, number, number]>; lines?: string[]; eye?: [number, number] }> = {
  p: {
    body: ['M 36 74 C 36 62 40 54 44 50 C 36 46 34 36 40 29 C 46 22 54 22 60 29 C 66 36 64 46 56 50 C 60 54 64 62 64 74 Z', BASE],
  },
  r: {
    body: [
      'M 31 74 L 34 44 L 66 44 L 69 74 Z',
      'M 26 44 L 26 18 L 37 18 L 37 27 L 45 27 L 45 18 L 55 18 L 55 27 L 63 27 L 63 18 L 74 18 L 74 44 Z',
      BASE,
    ],
    lines: ['M 34 58 L 66 58'],
  },
  n: {
    body: [
      'M 30 74 C 30 64 36 58 44 52 C 38 52 32 54 26 56 C 18 58 14 50 18 44 C 24 34 30 26 38 20 L 38 10 L 46 17 C 60 18 72 30 74 48 C 76 58 74 66 72 74 Z',
      BASE,
    ],
    lines: ['M 52 22 C 62 28 66 38 66 50'],
    eye: [40, 30],
  },
  b: {
    body: [
      'M 34 74 C 30 64 32 54 40 48 L 60 48 C 68 54 70 64 66 74 Z',
      'M 50 14 C 64 24 68 36 60 48 L 40 48 C 32 36 36 24 50 14 Z',
      BASE,
    ],
    dots: [[50, 11, 6]],
    lines: ['M 55 24 L 46 36'],
  },
  q: {
    body: ['M 30 74 L 18 32 L 36 52 L 34 22 L 47 48 L 50 16 L 53 48 L 66 22 L 64 52 L 82 32 L 70 74 Z', BASE],
    dots: [
      [18, 30, 6],
      [34, 20, 6],
      [50, 13, 6.5],
      [66, 20, 6],
      [82, 30, 6],
    ],
    lines: ['M 30 64 L 70 64'],
  },
  k: {
    body: [
      'M 46 6 L 54 6 L 54 14 L 62 14 L 62 22 L 54 22 L 54 34 L 46 34 L 46 22 L 38 22 L 38 14 L 46 14 Z',
      'M 30 74 C 22 62 20 50 26 42 C 32 34 44 34 50 44 C 56 34 68 34 74 42 C 80 50 78 62 70 74 Z',
      BASE,
    ],
    lines: ['M 30 64 L 70 64'],
  },
}

export interface PieceProps {
  /** Lettre FEN : K Q R B N P (Blancs) / k q r b n p (Noirs). */
  piece: string
  className?: string
  /** Pas d'ombre (petites pièces prises). */
  flat?: boolean
  theme?: PieceTheme
}

export const Piece = memo(function Piece({ piece, className, flat, theme }: PieceProps) {
  const side = piece === piece.toUpperCase() ? 'w' : 'b'
  const shape = SHAPES[piece.toLowerCase()]
  if (!shape) return null
  const ginger = theme === 'gingerbread'
  const fill = ginger ? GINGER.fill[side] : FILL[side]
  const shine = ginger ? GINGER.shine[side] : SHINE[side]
  const detail = ginger ? GINGER.detail[side] : DETAIL[side]
  const sw = flat ? 6 : 5
  const all = (
    <>
      {shape.body.map((d, i) => (
        <path key={i} d={d} />
      ))}
      {shape.dots?.map(([cx, cy, r], i) => (
        <circle key={`d${i}`} cx={cx} cy={cy} r={r} />
      ))}
    </>
  )
  return (
    <svg viewBox="0 0 100 100" className={cn('block size-full overflow-visible', className)} aria-hidden>
      {!flat && (
        <g transform="translate(4 4)" fill={INK} stroke={INK} strokeWidth={sw} strokeLinejoin="round">
          {all}
        </g>
      )}
      <g fill={fill} stroke={INK} strokeWidth={sw} strokeLinejoin="round" strokeLinecap="round">
        {all}
      </g>
      {/* reflet « sticker » */}
      {!flat && <path d="M 36 70 C 34 62 36 56 40 52" stroke={shine} strokeWidth="4" strokeLinecap="round" fill="none" opacity={side === 'w' ? 0.9 : 0.7} />}
      {shape.lines?.map((d, i) => (
        <path key={`l${i}`} d={d} stroke={detail} strokeWidth="4" strokeLinecap="round" fill="none" />
      ))}
      {ginger && !flat && <path d={ICING} stroke="#FFFFFF" strokeWidth="3.5" strokeLinecap="round" fill="none" />}
      {shape.eye && <circle cx={shape.eye[0]} cy={shape.eye[1]} r="4.5" fill={INK} />}
    </svg>
  )
})

export default Piece
