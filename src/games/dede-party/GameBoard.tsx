import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/cn'
import { signed, type BoardView } from './anim'
import { CELLS, CELL_INFO, GRID, cellXY } from './board'
import type { Get } from './Parts'
import type { DedePartyState, DpEvent } from './types'

function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    setW(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

const PCT = 100 / GRID

/** Petit chiffre qui jaillit au-dessus du pion en vedette. */
const popOf = (e: DpEvent): string | null => {
  if (e.t === 'star') return '⭐'
  if (e.t === 'star_poor') return '😬'
  if (typeof e.d === 'number' && e.d !== 0) return signed(e.d)
  return null
}

/**
 * Le Grand Plateau de Dédé : 24 cases autour d'une grille 7 × 7, l'étoile, les pions (têtes chibi
 * dans la tenue équipée) et un contenu au centre (Dédé, dés…). Partagé téléphone / télé.
 */
export function Board({ s, view, get, center, className }: { s: DedePartyState; view: BoardView; get: Get; center?: ReactNode; className?: string }) {
  const [ref, w] = useWidth()
  const cell = w / GRID
  const snap = view.snap
  const moverId = view.mover?.id ?? null

  // Pions par case (le pion en vedette à part, au premier plan).
  const groups = new Map<number, string[]>()
  for (const id of s.order) {
    if (id === moverId) continue
    const c = snap.pos[id] ?? 0
    groups.set(c, [...(groups.get(c) ?? []), id])
  }
  const place = (c: number, idx: number, n: number) => {
    const { col, row } = cellXY(c)
    const per = n <= 1 ? 1 : n <= 4 ? 2 : 3
    const size = cell * (n <= 1 ? 0.66 : n <= 4 ? 0.46 : 0.34)
    const r = Math.floor(idx / per)
    const k = idx % per
    const span = cell * 0.9
    const ox = n <= 1 ? (cell - size) / 2 : cell * 0.05 + (k * (span - size)) / Math.max(1, per - 1)
    const rows = Math.ceil(n / per)
    const oy = n <= 1 ? (cell - size) / 2 : cell * 0.05 + (rows <= 1 ? (span - size) / 2 : (r * (span - size)) / Math.max(1, rows - 1))
    return { x: col * cell + ox, y: row * cell + oy, size }
  }
  const star = cellXY(snap.star_cell)
  const last = view.events[0]
  const pop = last ? popOf(last) : null

  return (
    <div ref={ref} className={cn('relative aspect-square w-full select-none', className)}>
      {w > 0 && (
        <>
          {CELLS.map((t, i) => {
            const { col, row } = cellXY(i)
            const info = CELL_INFO[t]
            const lit = view.mover && view.mover.cell === i
            return (
              <div key={i} className="absolute" style={{ left: `${col * PCT}%`, top: `${row * PCT}%`, width: `${PCT}%`, height: `${PCT}%`, padding: Math.max(1.5, cell * 0.04) }}>
                <div
                  className={cn('flex size-full flex-col items-center justify-center rounded-[24%] border-ink leading-none text-[#1f1b2e] transition-transform', lit && 'scale-110')}
                  style={{ background: info.color, borderWidth: Math.max(2, cell * 0.045), boxShadow: `${Math.max(1.5, cell * 0.05)}px ${Math.max(1.5, cell * 0.05)}px 0 0 var(--ink)` }}
                  title={`${info.label} : ${info.effect}`}
                >
                  <span style={{ fontSize: cell * (t === 'start' ? 0.36 : 0.44) }}>{info.emoji}</span>
                  {t === 'start' && cell > 40 && (
                    <span className="font-display font-extrabold" style={{ fontSize: cell * 0.16 }}>
                      DÉPART
                    </span>
                  )}
                </div>
              </div>
            )
          })}

          {/* L'étoile, sur sa Loge. */}
          <motion.div
            className="pointer-events-none absolute z-10 flex items-center justify-center"
            initial={false}
            animate={{ left: star.col * cell + cell * 0.05, top: star.row * cell + cell * 0.02 }}
            transition={{ type: 'spring', stiffness: 120, damping: 14 }}
            style={{ width: cell * 0.9, height: cell * 0.9 }}
          >
            <motion.span animate={{ rotate: 360, scale: [1, 1.15, 1] }} transition={{ rotate: { repeat: Infinity, duration: 6, ease: 'linear' }, scale: { repeat: Infinity, duration: 1.2 } }} style={{ fontSize: cell * 0.72, filter: 'drop-shadow(2px 2px 0 var(--ink))' }}>
              ⭐
            </motion.span>
          </motion.div>

          {/* Centre du plateau. */}
          <div className="absolute flex items-center justify-center overflow-hidden" style={{ left: `${PCT}%`, top: `${PCT}%`, width: `${PCT * 5}%`, height: `${PCT * 5}%`, padding: cell * 0.18 }}>
            {center}
          </div>

          {/* Pions. */}
          {[...groups.entries()].flatMap(([c, ids]) =>
            ids.map((id, idx) => {
              const p = get(id)
              const at = place(c, idx, ids.length)
              return (
                <motion.div
                  key={id}
                  className="absolute z-20"
                  initial={false}
                  animate={{ left: at.x, top: at.y, width: at.size, height: at.size }}
                  transition={{ type: 'spring', stiffness: 260, damping: 22 }}
                >
                  <Avatar slug={p.slug} tenue={p.equippedTenue} size={at.size} />
                </motion.div>
              )
            }),
          )}
          {view.mover && (
            <MoverPawn key={view.mover.id} cellIdx={view.mover.cell} cell={cell} player={get(view.mover.id)} pop={pop} popKey={view.events.length} />
          )}
        </>
      )}
    </div>
  )
}

function MoverPawn({ cellIdx, cell, player, pop, popKey }: { cellIdx: number; cell: number; player: ReturnType<Get>; pop: string | null; popKey: number }) {
  const { col, row } = cellXY(cellIdx)
  const size = cell * 0.84
  return (
    <motion.div
      className="absolute z-30"
      initial={false}
      animate={{ left: col * cell + (cell - size) / 2, top: row * cell + (cell - size) / 2 - cell * 0.12 }}
      transition={{ type: 'spring', stiffness: 420, damping: 24 }}
      style={{ width: size, height: size }}
    >
      <motion.div key={cellIdx} initial={{ y: -cell * 0.35 }} animate={{ y: 0 }} transition={{ type: 'spring', stiffness: 600, damping: 15 }}>
        <Avatar slug={player.slug} tenue={player.equippedTenue} size={size} selected />
      </motion.div>
      <AnimatePresence>
        {pop && (
          <motion.span
            key={popKey}
            initial={{ y: 0, opacity: 0, scale: 0.4 }}
            animate={{ y: -cell * 0.75, opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 14 }}
            className="sticker-sm absolute left-1/2 top-0 -translate-x-1/2 whitespace-nowrap bg-sun px-1.5 font-display font-extrabold text-[#1f1b2e]"
            style={{ fontSize: Math.max(12, cell * 0.3) }}
          >
            {pop}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
