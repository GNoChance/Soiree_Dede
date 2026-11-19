import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/cn'
import { signed, type BoardView } from './anim'
import { CELLS, CELL_INFO, COLS, FORKS, LINKS, ROWS, cellXY } from './board'
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

/** Petit chiffre qui jaillit au-dessus du pion en vedette. */
const popOf = (e: DpEvent): string | null => {
  if (e.t === 'star') return '⭐'
  if (e.t === 'star_poor') return '😬'
  if (e.t === 'fork') return '🔀'
  if (typeof e.d === 'number' && e.d !== 0) return signed(e.d)
  return null
}

/**
 * Le Grand Plateau de Dédé à plat (2D) : repli quand le plateau 3D n'est pas disponible, et plan
 * d'ensemble dans l'aide. 47 cases sur une grille 11 × 9 (transposée 9 × 11 en portrait), le tracé,
 * les aiguillages (flèche vers la voie ouverte), les étoiles et les pions (têtes chibi).
 */
export function Board({ s, view, get, center, className, portrait = false }: { s: DedePartyState; view: BoardView; get: Get; center?: ReactNode; className?: string; portrait?: boolean }) {
  const [ref, w] = useWidth()
  const cols = portrait ? ROWS : COLS
  const rows = portrait ? COLS : ROWS
  const cell = w / cols
  const snap = view.snap
  const moverId = view.mover?.id ?? null
  const xy = (i: number) => cellXY(i, portrait)

  // Pions par case (le pion en vedette à part, au premier plan).
  const groups = new Map<number, string[]>()
  for (const id of s.order) {
    if (id === moverId) continue
    const c = snap.pos[id] ?? 0
    groups.set(c, [...(groups.get(c) ?? []), id])
  }
  const place = (c: number, idx: number, n: number) => {
    const { col, row } = xy(c)
    const per = n <= 1 ? 1 : n <= 4 ? 2 : 3
    const size = cell * (n <= 1 ? 0.7 : n <= 4 ? 0.5 : 0.36)
    const r = Math.floor(idx / per)
    const k = idx % per
    const span = cell * 0.96
    const ox = n <= 1 ? (cell - size) / 2 : cell * 0.02 + (k * (span - size)) / Math.max(1, per - 1)
    const lines = Math.ceil(n / per)
    const oy = n <= 1 ? (cell - size) / 2 : cell * 0.02 + (lines <= 1 ? (span - size) / 2 : (r * (span - size)) / Math.max(1, lines - 1))
    return { x: col * cell + ox, y: row * cell + oy, size }
  }
  const last = view.events[0]
  const pop = last ? popOf(last) : null
  // Zone libre au milieu du plateau (Dédé, dés…).
  const hole = portrait ? { left: 3, top: 1.2, width: 4, height: 6.4 } : { left: 1.2, top: 3, width: 6.4, height: 4 }

  return (
    <div ref={ref} className={cn('relative w-full select-none', className)} style={{ aspectRatio: `${cols} / ${rows}` }}>
      {w > 0 && (
        <>
          {/* Le tracé. */}
          <svg className="pointer-events-none absolute inset-0 size-full" viewBox={`0 0 ${cols} ${rows}`} aria-hidden>
            {LINKS.map(([a, b]) => {
              const p = xy(a)
              const q = xy(b)
              return <line key={`${a}-${b}`} x1={p.col + 0.5} y1={p.row + 0.5} x2={q.col + 0.5} y2={q.row + 0.5} stroke="var(--ink)" strokeWidth={0.34} strokeLinecap="round" opacity={0.85} />
            })}
            {LINKS.map(([a, b]) => {
              const p = xy(a)
              const q = xy(b)
              return <line key={`d${a}-${b}`} x1={p.col + 0.5} y1={p.row + 0.5} x2={q.col + 0.5} y2={q.row + 0.5} stroke="#FFD166" strokeWidth={0.16} strokeLinecap="round" strokeDasharray="0.02 0.3" />
            })}
          </svg>

          {CELLS.map((t, i) => {
            const { col, row } = xy(i)
            const info = CELL_INFO[t]
            const lit = view.mover && view.mover.cell === i
            return (
              <div key={i} className="absolute" style={{ left: col * cell, top: row * cell, width: cell, height: cell, padding: Math.max(1.5, cell * 0.06) }}>
                <div
                  className={cn('flex size-full flex-col items-center justify-center rounded-[26%] border-ink leading-none text-[#1f1b2e] transition-transform', lit && 'scale-110')}
                  style={{ background: info.color, borderWidth: Math.max(2, cell * 0.05), boxShadow: `${Math.max(1.5, cell * 0.05)}px ${Math.max(1.5, cell * 0.05)}px 0 0 var(--ink)` }}
                  title={`${info.label} : ${info.effect}`}
                >
                  <span style={{ fontSize: cell * 0.46 }}>{info.emoji}</span>
                </div>
              </div>
            )
          })}

          {/* Aiguillages : la flèche montre la voie ouverte. */}
          {FORKS.map((f, k) => {
            const o = xy(f.cell)
            const d = f.ways.map((c) => ({ x: xy(c).col - o.col, y: xy(c).row - o.row }))
            const way = snap.sw?.[k] === 1 ? 1 : 0
            const size = cell * 0.62
            return (
              <div key={k} className="pointer-events-none absolute z-10" style={{ left: (o.col + 0.5 + (d[0].x + d[1].x) * 0.5) * cell - size / 2, top: (o.row + 0.5 + (d[0].y + d[1].y) * 0.5) * cell - size / 2, width: size, height: size }}>
                <motion.div
                  className="flex size-full items-center justify-center rounded-full border-ink bg-sun font-display font-extrabold text-[#1f1b2e]"
                  style={{ borderWidth: Math.max(2, cell * 0.05), fontSize: size * 0.62, lineHeight: 1 }}
                  initial={false}
                  animate={{ rotate: (Math.atan2(d[way].y, d[way].x) * 180) / Math.PI }}
                  transition={{ type: 'spring', stiffness: 260, damping: 12 }}
                >
                  ➜
                </motion.div>
              </div>
            )
          })}

          {/* Les étoiles, chacune sur sa Loge. */}
          {(snap.star_cells ?? []).map((c, k) => {
            const p = xy(c)
            return (
              <motion.div
                key={k}
                className="pointer-events-none absolute z-10 flex items-center justify-center"
                initial={false}
                animate={{ left: p.col * cell, top: p.row * cell - cell * 0.08 }}
                transition={{ type: 'spring', stiffness: 120, damping: 14 }}
                style={{ width: cell, height: cell }}
              >
                <motion.span animate={{ rotate: 360, scale: [1, 1.15, 1] }} transition={{ rotate: { repeat: Infinity, duration: 6, ease: 'linear' }, scale: { repeat: Infinity, duration: 1.2 } }} style={{ fontSize: cell * 0.78, filter: 'drop-shadow(2px 2px 0 var(--ink))' }}>
                  ⭐
                </motion.span>
              </motion.div>
            )
          })}

          {/* Milieu du plateau. */}
          {center && (
            <div className="absolute flex items-center justify-center overflow-hidden" style={{ left: hole.left * cell, top: hole.top * cell, width: hole.width * cell, height: hole.height * cell }}>
              {center}
            </div>
          )}

          {/* Pions. */}
          {[...groups.entries()].flatMap(([c, ids]) =>
            ids.map((id, idx) => {
              const p = get(id)
              const at = place(c, idx, ids.length)
              return (
                <motion.div key={id} className="absolute z-20" initial={false} animate={{ left: at.x, top: at.y, width: at.size, height: at.size }} transition={{ type: 'spring', stiffness: 260, damping: 22 }}>
                  <Avatar slug={p.slug} tenue={p.equippedTenue} size={at.size} />
                </motion.div>
              )
            }),
          )}
          {view.mover && (
            <MoverPawn key={view.mover.id} at={xy(view.mover.cell)} cellIdx={view.mover.cell} cell={cell} player={get(view.mover.id)} pop={pop} popKey={view.events.length} />
          )}
        </>
      )}
    </div>
  )
}

function MoverPawn({ at, cellIdx, cell, player, pop, popKey }: { at: { col: number; row: number }; cellIdx: number; cell: number; player: ReturnType<Get>; pop: string | null; popKey: number }) {
  const size = cell * 0.95
  return (
    <motion.div
      className="absolute z-30"
      initial={false}
      animate={{ left: at.col * cell + (cell - size) / 2, top: at.row * cell + (cell - size) / 2 - cell * 0.14 }}
      transition={{ type: 'spring', stiffness: 520, damping: 26 }}
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
            style={{ fontSize: Math.max(12, cell * 0.34) }}
          >
            {pop}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
