/**
 * Plateau carré 11×11 du Tour des Potes : 40 cases de bord, centre libre
 * (`center`), pions-chibis posés par-dessus (couche absolue : ils glissent
 * d'une case à l'autre sans recréer les cases).
 */
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { ChibiImage } from '@/components/ui/ChibiImage'
import { playerOrPlaceholder } from '@/features/soiree/players'
import { cn } from '@/lib/cn'
import type { PlayerInfo } from '../types'
import { BOARD, type BoardCell } from './board'
import { levelOf, ownerOf } from './rules'
import type { TdpState } from './types'

/* ------------------------------ géométrie ------------------------------ */

/** Poids des 11 pistes : coins plus grands que les cases courantes. */
const CORNER = 1.5
const TRACKS = [CORNER, 1, 1, 1, 1, 1, 1, 1, 1, 1, CORNER]
const TOTAL = TRACKS.reduce((a, b) => a + b, 0)
const STARTS = TRACKS.map((_, k) => TRACKS.slice(0, k).reduce((a, b) => a + b, 0))

/** (ligne, colonne) 0-10 de la case i (0 = coin bas-droit, sens horaire). */
export function gridPos(i: number): { row: number; col: number } {
  if (i <= 10) return { row: 10, col: 10 - i }
  if (i <= 20) return { row: 20 - i, col: 0 }
  if (i <= 30) return { row: 0, col: i - 20 }
  return { row: i - 30, col: 10 }
}

/** Rectangle de la case, en % du plateau. */
export function cellRect(i: number) {
  const { row, col } = gridPos(i)
  return {
    x: (STARTS[col] / TOTAL) * 100,
    y: (STARTS[row] / TOTAL) * 100,
    w: (TRACKS[col] / TOTAL) * 100,
    h: (TRACKS[row] / TOTAL) * 100,
  }
}

type Side = 'bottom' | 'left' | 'top' | 'right' | 'corner'
const sideOf = (i: number): Side => (i % 10 === 0 ? 'corner' : i < 10 ? 'bottom' : i < 20 ? 'left' : i < 30 ? 'top' : 'right')

/** Le bandeau de couleur est du côté du centre du plateau. */
const BAND_LAYOUT: Record<Side, string> = {
  bottom: 'flex-col',
  top: 'flex-col-reverse',
  left: 'flex-row-reverse',
  right: 'flex-row',
  corner: 'flex-col',
}

const SPECIAL_BG: Partial<Record<BoardCell['type'], string>> = {
  depart: 'bg-sun',
  violon: 'bg-sky/60',
  apero: 'bg-lime/60',
  direction_violon: 'bg-tomato/60',
  hasard: 'bg-grape/30',
  entre_potes: 'bg-bubblegum/50',
  taxe: 'bg-tomato/25',
  potes: 'bg-mint/30',
  service: 'bg-sky/30',
}

const SHORT_LABEL: Partial<Record<BoardCell['type'], string>> = {
  depart: 'Départ',
  violon: 'Violon',
  apero: 'Apéro',
  direction_violon: 'Violon !',
}

/* ------------------------------ pion / visage ------------------------------ */

/** Visage rond d'un joueur (pion, badge de propriétaire) : on cadre la tête du chibi. */
export function MiniFace({ player, px, className }: { player: PlayerInfo; px: number; className?: string }) {
  const S = px * 1.7
  return (
    <span
      className={cn('relative block shrink-0 overflow-hidden rounded-full border-[1.5px] border-ink', className)}
      style={{ width: px, height: px, backgroundColor: player.color }}
    >
      <span className="absolute block" style={{ width: S, height: S, left: px / 2 - S / 2, top: px / 2 - S * 0.4 }}>
        <ChibiImage slug={player.slug} expression={player.equipped} tenue={player.equippedTenue} size={S} bare thumb />
      </span>
    </span>
  )
}

/* ------------------------------ case ------------------------------ */

interface CellProps {
  cell: BoardCell
  owner: PlayerInfo | null
  level: number
  unit: number
  selected: boolean
  onSelect: (i: number) => void
}

const BoardCellView = memo(function BoardCellView({ cell, owner, level, unit, selected, onSelect }: CellProps) {
  const { row, col } = gridPos(cell.i)
  const side = sideOf(cell.i)
  const vertical = side === 'left' || side === 'right'
  const isQuartier = cell.type === 'quartier'
  const tint = owner ? `color-mix(in srgb, ${owner.color} 45%, var(--surface))` : undefined
  const corner = side === 'corner'
  const label =
    `${cell.name}${cell.city ? ` (${cell.city})` : ''}` +
    (cell.price ? `, ${cell.price} €` : '') +
    (owner ? `, propriétaire ${owner.nickname}` : '') +
    (level ? `, ${level >= 5 ? 'hôtel' : `${level} maison${level > 1 ? 's' : ''}`}` : '')
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => onSelect(cell.i)}
      className={cn(
        'relative flex min-h-0 min-w-0 overflow-hidden border-[0.5px] border-ink/60 bg-surface p-0 text-text',
        BAND_LAYOUT[side],
        !isQuartier && SPECIAL_BG[cell.type],
        selected && 'z-10 outline-[3px] -outline-offset-2 outline-sun',
      )}
      style={{ gridRow: row + 1, gridColumn: col + 1, backgroundColor: tint }}
    >
      {isQuartier && (
        <span
          className={cn('flex shrink-0 items-center justify-center gap-px border-ink/60', vertical ? 'w-[34%] flex-col border-x-[0.5px]' : 'h-[34%] border-y-[0.5px]')}
          style={{ backgroundColor: cell.color }}
        >
          {level >= 5 ? (
            <span className="block rounded-[1px] border border-ink bg-tomato" style={{ width: unit * 0.5, height: unit * 0.3 }} />
          ) : (
            Array.from({ length: level }, (_, k) => (
              <span key={k} className="block rounded-[1px] border border-ink bg-[#22c55e]" style={{ width: unit * 0.2, height: unit * 0.2 }} />
            ))
          )}
        </span>
      )}
      <span className="relative flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center leading-none">
        {isQuartier ? (
          <span className="font-display font-extrabold" style={{ fontSize: unit * 0.36 }}>
            {cell.price}
          </span>
        ) : (
          <>
            <span style={{ fontSize: unit * (corner ? 0.62 : 0.5) }}>{cell.emoji}</span>
            {(SHORT_LABEL[cell.type] || cell.amount) && (
              <span className="mt-px font-display font-extrabold" style={{ fontSize: unit * 0.28 }}>
                {cell.amount ? `−${cell.amount}` : SHORT_LABEL[cell.type]}
              </span>
            )}
          </>
        )}
        {owner && <MiniFace player={owner} px={Math.max(10, unit * 0.4)} className={cn('absolute', vertical ? 'bottom-[3%] left-[3%]' : 'right-[3%] bottom-[3%]')} />}
      </span>
    </button>
  )
})

/* ------------------------------ pions ------------------------------ */

interface PawnProps {
  s: TdpState
  players: Record<string, PlayerInfo>
  shownPos: Record<string, number>
  width: number
}

function Pawns({ s, players, shownPos, width }: PawnProps) {
  const placed = useMemo(() => {
    const byCell = new Map<number, string[]>()
    for (const id of s.order) {
      if (s.bankrupt.includes(id)) continue
      const c = shownPos[id] ?? s.pos[id] ?? 0
      byCell.set(c, [...(byCell.get(c) ?? []), id])
    }
    const out: { id: string; x: number; y: number; d: number }[] = []
    for (const [c, ids] of byCell) {
      const r = cellRect(c)
      const side = Math.min(r.w, r.h)
      const n = ids.length
      const k = Math.ceil(Math.sqrt(n))
      const rows = Math.ceil(n / k)
      const d = n === 1 ? side * 0.66 : (side * 0.96) / k
      ids.forEach((id, j) => {
        const rowItems = j >= (rows - 1) * k ? n - (rows - 1) * k : k
        const col = j % k
        const row = Math.floor(j / k)
        // dernière ligne centrée si incomplète
        const x = r.x + r.w / 2 - (rowItems * d) / 2 + col * d
        const y = r.y + r.h / 2 - (rows * d) / 2 + row * d
        out.push({ id, x, y, d })
      })
    }
    return out
  }, [s.order, s.bankrupt, s.pos, shownPos])

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {placed.map(({ id, x, y, d }) => {
        const p = playerOrPlaceholder(players, id)
        const px = Math.max(8, (width * d) / 100)
        const turn = s.turn === id
        return (
          <motion.div
            key={id}
            initial={false}
            animate={{ left: `${x}%`, top: `${y}%` }}
            transition={{ duration: 0.1, ease: 'linear' }}
            className="absolute"
            style={{ width: `${d}%`, height: `${d}%`, zIndex: turn ? 2 : 1 }}
          >
            <motion.div
              animate={turn ? { y: [0, -2, 0], scale: [1, 1.12, 1] } : undefined}
              transition={turn ? { repeat: Infinity, duration: 1.1 } : undefined}
              className={cn('size-full', turn && 'rounded-full ring-2 ring-sun')}
            >
              <MiniFace player={p} px={px} className="shadow-[1px_1px_0_0_var(--ink)]" />
              {s.jail[id] !== undefined && (
                <span className="absolute -right-0.5 -bottom-0.5 rounded-full bg-surface leading-none" style={{ fontSize: Math.max(7, px * 0.5) }}>
                  🚔
                </span>
              )}
            </motion.div>
          </motion.div>
        )
      })}
    </div>
  )
}

/* ------------------------------ plateau ------------------------------ */

export interface BoardProps {
  s: TdpState
  players: Record<string, PlayerInfo>
  shownPos: Record<string, number>
  selected: number | null
  onCell: (i: number) => void
  /** Contenu du centre (joueur au trait, dés, minuteur…). */
  center: ReactNode
}

export function Board({ s, players, shownPos, selected, onCell, center }: BoardProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(328)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const unit = width / 12

  return (
    <div
      ref={ref}
      role="group"
      aria-label="Plateau du Tour des Potes"
      className="sticker relative aspect-square w-full overflow-hidden bg-sunk"
      style={{
        display: 'grid',
        gridTemplateColumns: TRACKS.map((t) => `${t}fr`).join(' '),
        gridTemplateRows: TRACKS.map((t) => `${t}fr`).join(' '),
      }}
    >
      {/* Centre libre */}
      <div className="relative z-0 flex min-h-0 min-w-0 items-stretch justify-stretch p-1.5" style={{ gridRow: '2 / 11', gridColumn: '2 / 11' }}>
        {center}
      </div>
      {BOARD.map((cell) => {
        const o = ownerOf(s, cell.i)
        return (
          <BoardCellView
            key={cell.i}
            cell={cell}
            owner={o ? playerOrPlaceholder(players, o) : null}
            level={levelOf(s, cell.i)}
            unit={unit}
            selected={selected === cell.i}
            onSelect={onCell}
          />
        )
      })}
      <Pawns s={s} players={players} shownPos={shownPos} width={width} />
    </div>
  )
}
