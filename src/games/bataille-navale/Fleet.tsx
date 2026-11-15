import { memo, type CSSProperties } from 'react'
import { cn } from '@/lib/cn'
import { SHIPS, shipSize } from './logic'
import type { BnDir, BnShip, BnShipId } from './types'

/*
 * Bateaux « sticker » dessinés en SVG (contour encre épais, coque claire,
 * bande à la couleur du propriétaire). Dessin horizontal dans un viewBox
 * (taille × 100) × 100, proue à droite ; en vertical on le fait pivoter
 * (proue en bas).
 */

const INK = '#1f1b2e'
const HULL = '#E8EEF4'
const DECK = '#B9C7D5'
const STEEL = '#7B8B9D'
const GLASS = '#4CC9F0'

const hullPath = (L: number) =>
  `M18 16 H${L - 78} C${L - 34} 16 ${L - 10} 38 ${L - 8} 50 C${L - 10} 62 ${L - 34} 84 ${L - 78} 84 H18 Q8 84 8 74 V26 Q8 16 18 16 Z`
const deckPath = (L: number) =>
  `M26 29 H${L - 84} C${L - 52} 29 ${L - 32} 42 ${L - 30} 50 C${L - 32} 58 ${L - 52} 71 ${L - 84} 71 H26 Z`

function Turret({ x, dir = 1 }: { x: number; dir?: 1 | -1 }) {
  return (
    <g>
      <rect x={dir === 1 ? x : x - 34} y={45} width={34} height={10} rx={4} fill={STEEL} stroke={INK} strokeWidth={4} />
      <circle cx={x} cy={50} r={14} fill={HULL} stroke={INK} strokeWidth={5} />
      <circle cx={x} cy={50} r={4} fill={INK} />
    </g>
  )
}

function Stripe({ x, accent }: { x: number; accent: string }) {
  return <rect x={x} y={30} width={13} height={40} rx={4} fill={accent} stroke={INK} strokeWidth={4} />
}

function Drawing({ id, accent }: { id: BnShipId; accent: string }) {
  const L = shipSize(id) * 100
  switch (id) {
    case 'porte-avions':
      return (
        <g strokeLinejoin="round" strokeLinecap="round">
          <path d={hullPath(L)} fill={HULL} stroke={INK} strokeWidth={6} />
          <path d={deckPath(L)} fill="#5D6D7E" stroke={INK} strokeWidth={3} />
          <line x1={46} y1={50} x2={L - 96} y2={50} stroke="#fff" strokeWidth={4} strokeDasharray="20 14" />
          <line x1={70} y1={37} x2={250} y2={37} stroke="#FFB703" strokeWidth={3} />
          {/* petits avions */}
          <path d="M120 58 l18 5 l-18 5 l4 -5 z M190 58 l18 5 l-18 5 l4 -5 z" fill="#fff" stroke={INK} strokeWidth={2} />
          {/* îlot */}
          <rect x={L - 205} y={10} width={58} height={24} rx={6} fill={HULL} stroke={INK} strokeWidth={5} />
          <rect x={L - 196} y={16} width={14} height={8} rx={2} fill={GLASS} />
          <rect x={L - 176} y={16} width={14} height={8} rx={2} fill={GLASS} />
          <Stripe x={22} accent={accent} />
        </g>
      )
    case 'cuirasse':
      return (
        <g strokeLinejoin="round" strokeLinecap="round">
          <path d={hullPath(L)} fill={HULL} stroke={INK} strokeWidth={6} />
          <path d={deckPath(L)} fill={DECK} stroke={INK} strokeWidth={3} />
          <Turret x={88} dir={-1} />
          <rect x={150} y={32} width={70} height={36} rx={8} fill={HULL} stroke={INK} strokeWidth={5} />
          <rect x={160} y={42} width={50} height={9} rx={3} fill={GLASS} />
          <ellipse cx={243} cy={50} rx={13} ry={11} fill={STEEL} stroke={INK} strokeWidth={4} />
          <Turret x={282} />
          <Turret x={322} />
          <Stripe x={22} accent={accent} />
        </g>
      )
    case 'croiseur':
      return (
        <g strokeLinejoin="round" strokeLinecap="round">
          <path d={hullPath(L)} fill={HULL} stroke={INK} strokeWidth={6} />
          <path d={deckPath(L)} fill={DECK} stroke={INK} strokeWidth={3} />
          <Turret x={72} dir={-1} />
          <rect x={108} y={33} width={56} height={34} rx={8} fill={HULL} stroke={INK} strokeWidth={5} />
          <rect x={117} y={42} width={38} height={8} rx={3} fill={GLASS} />
          <line x1={178} y1={50} x2={178} y2={26} stroke={INK} strokeWidth={4} />
          <circle cx={178} cy={24} r={4} fill="#EF476F" stroke={INK} strokeWidth={2} />
          <Turret x={222} />
          <Stripe x={22} accent={accent} />
        </g>
      )
    case 'sous-marin':
      return (
        <g strokeLinejoin="round" strokeLinecap="round">
          <path
            d={`M34 22 H${L - 44} C${L - 14} 22 ${L - 8} 40 ${L - 8} 50 C${L - 8} 60 ${L - 14} 78 ${L - 44} 78 H34 C16 78 8 64 8 50 C8 36 16 22 34 22 Z`}
            fill="#3D5A80"
            stroke={INK}
            strokeWidth={6}
          />
          <path d={`M40 50 H${L - 40}`} stroke="#98C1D9" strokeWidth={4} strokeDasharray="12 10" />
          <rect x={118} y={31} width={62} height={38} rx={14} fill="#2B4562" stroke={INK} strokeWidth={5} />
          <line x1={150} y1={40} x2={150} y2={18} stroke={INK} strokeWidth={4} />
          <line x1={150} y1={18} x2={162} y2={18} stroke={INK} strokeWidth={4} />
          <circle cx={L - 60} cy={50} r={6} fill="#98C1D9" stroke={INK} strokeWidth={3} />
          <Stripe x={30} accent={accent} />
        </g>
      )
    case 'torpilleur':
      return (
        <g strokeLinejoin="round" strokeLinecap="round">
          <path d={hullPath(L)} fill={HULL} stroke={INK} strokeWidth={6} />
          <path d={deckPath(L)} fill={DECK} stroke={INK} strokeWidth={3} />
          <rect x={52} y={34} width={46} height={32} rx={8} fill={HULL} stroke={INK} strokeWidth={5} />
          <rect x={60} y={43} width={30} height={8} rx={3} fill={GLASS} />
          <Turret x={128} />
          <Stripe x={22} accent={accent} />
        </g>
      )
    default:
      return null
  }
}

export interface ShipSvgProps {
  id: BnShipId
  dir?: BnDir
  /** Couleur du propriétaire (bande à la poupe). */
  accent?: string
  className?: string
  style?: CSSProperties
}

/** Un bateau dessiné, qui remplit son conteneur (taille × 1 case, ou 1 × taille en vertical). */
export const ShipSvg = memo(function ShipSvg({ id, dir = 'h', accent = '#FFB703', className, style }: ShipSvgProps) {
  const L = shipSize(id) * 100
  const vertical = dir === 'v'
  return (
    <svg
      viewBox={vertical ? `0 0 100 ${L}` : `0 0 ${L} 100`}
      className={cn('block size-full', className)}
      style={style}
      aria-hidden
    >
      {vertical ? (
        <g transform="translate(100 0) rotate(90)">
          <Drawing id={id} accent={accent} />
        </g>
      ) : (
        <Drawing id={id} accent={accent} />
      )}
    </svg>
  )
})

/** Position (en % de la grille 10 × 10) d'un bateau. */
export function shipBox(ship: Pick<BnShip, 'id' | 'x' | 'y' | 'dir'>): CSSProperties {
  const size = shipSize(ship.id)
  return {
    left: `${ship.x * 10}%`,
    top: `${ship.y * 10}%`,
    width: `${(ship.dir === 'h' ? size : 1) * 10}%`,
    height: `${(ship.dir === 'v' ? size : 1) * 10}%`,
  }
}

export interface FleetStatusProps {
  /** Bateaux coulés. */
  sunk: ReadonlySet<string>
  /** Cases touchées par bateau (ma flotte seulement). */
  damage?: Partial<Record<BnShipId, number>>
  accent: string
  /** Affiche les noms (sinon icônes seules). */
  names?: boolean
  /** Une ligne par bateau. */
  vertical?: boolean
  /** Largeur d'une case de bateau (rem). */
  unit?: number
  className?: string
}

/** Les 5 bateaux d'une flotte : à flot, endommagés (ma flotte) ou coulés. */
export function FleetStatus({ sunk, damage, accent, names, vertical, unit = 0.75, className }: FleetStatusProps) {
  return (
    <ul
      className={cn('flex gap-x-2 gap-y-1', vertical ? 'flex-col items-start' : 'flex-wrap items-center', className)}
      aria-label="État de la flotte"
    >
      {SHIPS.map((def) => {
        const down = sunk.has(def.id)
        const hits = damage?.[def.id] ?? 0
        return (
          <li
            key={def.id}
            className={cn('flex items-center gap-1', down && 'opacity-45')}
            aria-label={`${def.name} : ${down ? 'coulé' : hits ? `touché ${hits} fois` : 'à flot'}`}
          >
            <span className="relative block h-3 shrink-0" style={{ width: `${def.size * unit}rem` }}>
              <ShipSvg id={def.id} accent={accent} className={cn(down && 'grayscale')} />
              {down && (
                <span className="absolute inset-0 flex items-center justify-center text-[0.7rem] leading-none font-black text-tomato" aria-hidden>
                  ✕
                </span>
              )}
            </span>
            {names && (
              <span className={cn('text-[11px] leading-tight font-bold', down && 'line-through')}>
                {def.name}
                {!down && hits > 0 && <span className="ml-0.5 text-tomato">{'•'.repeat(hits)}</span>}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
