import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/cn'
import { signed, type BoardView } from './anim'
import { CELL_INFO, cellXY, isJump, linksOf } from './board'
import { STAND } from './boards/kermesse'
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
  if (e.t === 'fork') return e.tide ? (e.way === 1 ? '🏝️' : '🌊') : '🔀'
  if (e.t === 'tp') return e.k === 'ice' ? '🧊' : '🚡'
  if (e.t === 'jackpot') return `🎟️ ${signed(e.d ?? 0)}`
  if (e.t === 'toll') return e.d ? `🎟️ ${signed(e.d)}` : '🎟️'
  if (e.t === 'riton') return e.d ? `🦝 ${signed(e.d)}` : '🦝'
  if (typeof e.d === 'number' && e.d !== 0) return signed(e.d)
  return null
}

/**
 * Le plateau de la partie à plat (2D) : repli quand le plateau 3D n'est pas disponible, et plan
 * d'ensemble dans l'aide. Grille du plateau (transposée en portrait), le tracé, les aiguillages (flèche
 * vers la voie ouverte), les grands sauts en pointillés fléchés (télésièges, verglas, Grande Luge),
 * la mécanique (Banc de sable voilé à marée haute, cagnotte au stand, Riton sur sa case), les étoiles
 * et les pions (têtes chibi).
 */
export function Board({ s, view, get, center, className, portrait = false }: { s: DedePartyState; view: BoardView; get: Get; center?: ReactNode; className?: string; portrait?: boolean }) {
  const [ref, w] = useWidth()
  const b = view.board
  const cols = portrait ? b.rows : b.cols
  const rows = portrait ? b.cols : b.rows
  const cell = w / cols
  const snap = view.snap
  const mech = snap.mech ?? {}
  const moverId = view.mover?.id ?? null
  const xy = (i: number) => cellXY(b, i, portrait)
  const at = (col: number, row: number) => (portrait ? { col: row, row: col } : { col, row })
  const links = linksOf(b)

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
  const last = view.events[0] ?? view.epi?.events[0]
  const pop = last ? popOf(last) : null
  // Zone libre du plateau (Dédé, dés…).
  const h = b.hole
  const hole = portrait ? { left: h.row, top: h.col, width: h.h, height: h.w } : { left: h.col, top: h.row, width: h.w, height: h.h }
  const bank = b.zones.find((z) => z.id === 'banc')
  const flooded = b.id === 'mer' && mech.tide === 1
  // Riton : sa case (en direct pendant sa ronde).
  const ritonCell = b.id === 'camping' && typeof mech.riton === 'number' ? mech.riton : null
  const ritonAt = ritonCell === null ? null : view.epi?.hop ? (view.epi.hop.frac > 0.5 ? view.epi.hop.to : view.epi.hop.from) : ritonCell
  const stand = at(STAND.col, STAND.row)
  // Grands sauts : téléporteurs (Dédé 2000) et liaisons sans ruban (Grande Luge).
  const leaps: Array<{ from: number; to: number; color: string }> = [
    ...Object.entries(b.tp ?? {}).map(([from, x]) => ({ from: Number(from), to: x.to, color: x.to > Number(from) ? '#5E8C00' : '#2A9FD6' })),
    ...b.jumps.map(([from, to]) => ({ from, to, color: '#8B5CF6' })),
  ]

  return (
    <div ref={ref} className={cn('relative w-full select-none', className)} style={{ aspectRatio: `${cols} / ${rows}` }}>
      {w > 0 && (
        <>
          {/* Le tracé. */}
          <svg className="pointer-events-none absolute inset-0 size-full" viewBox={`0 0 ${cols} ${rows}`} aria-hidden>
            <defs>
              <marker id={`dp-arrow-${b.id}`} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="3" markerHeight="3" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--ink)" />
              </marker>
            </defs>
            {links
              .filter(([a, c]) => !isJump(b, a, c))
              .map(([a, c]) => {
                const p = xy(a)
                const q = xy(c)
                return <line key={`${a}-${c}`} x1={p.col + 0.5} y1={p.row + 0.5} x2={q.col + 0.5} y2={q.row + 0.5} stroke="var(--ink)" strokeWidth={0.34} strokeLinecap="round" opacity={0.85} />
              })}
            {links
              .filter(([a, c]) => !isJump(b, a, c))
              .map(([a, c]) => {
                const p = xy(a)
                const q = xy(c)
                return <line key={`d${a}-${c}`} x1={p.col + 0.5} y1={p.row + 0.5} x2={q.col + 0.5} y2={q.row + 0.5} stroke="#FFD166" strokeWidth={0.16} strokeLinecap="round" strokeDasharray="0.02 0.3" />
              })}
            {leaps.map(({ from, to, color }) => {
              const p = xy(from)
              const q = xy(to)
              // Courbe légère vers l'extérieur, pour ne pas masquer les cases du milieu.
              const mx = (p.col + q.col) / 2 + 0.5 + (q.row - p.row) * 0.18
              const my = (p.row + q.row) / 2 + 0.5 - (q.col - p.col) * 0.18
              // La flèche s'arrête au bord des cases (sinon la case d'arrivée la cache).
              const trim = (x: number, y: number, k: number) => {
                const dx = mx - x
                const dy = my - y
                const l = Math.hypot(dx, dy) || 1
                return `${x + (dx / l) * k} ${y + (dy / l) * k}`
              }
              return (
                <path
                  key={`j${from}`}
                  d={`M ${trim(p.col + 0.5, p.row + 0.5, 0.42)} Q ${mx} ${my} ${trim(q.col + 0.5, q.row + 0.5, 0.5)}`}
                  fill="none"
                  stroke={color}
                  strokeWidth={0.13}
                  strokeDasharray="0.18 0.14"
                  strokeLinecap="round"
                  markerEnd={`url(#dp-arrow-${b.id})`}
                  opacity={0.9}
                />
              )
            })}
          </svg>

          {b.cells.map((t, i) => {
            const { col, row } = xy(i)
            const info = CELL_INFO[t]
            const lit = view.mover && view.mover.cell === i
            const wet = flooded && bank?.cells.includes(i)
            return (
              <div key={i} className="absolute" style={{ left: col * cell, top: row * cell, width: cell, height: cell, padding: Math.max(1.5, cell * 0.06) }}>
                <div
                  className={cn('relative flex size-full flex-col items-center justify-center overflow-hidden rounded-[26%] border-ink leading-none text-[#1f1b2e] transition-transform', lit && 'scale-110')}
                  style={{ background: info.color, borderWidth: Math.max(2, cell * 0.05), boxShadow: `${Math.max(1.5, cell * 0.05)}px ${Math.max(1.5, cell * 0.05)}px 0 0 var(--ink)` }}
                  title={`${b.cellNames?.[i] ?? info.label} : ${info.effect}`}
                >
                  <span style={{ fontSize: cell * 0.46 }}>{info.emoji}</span>
                  {wet && <span className="absolute inset-0 bg-[#2EC4F1]/70" aria-label="sous l’eau" />}
                </div>
              </div>
            )
          })}

          {/* Aiguillages : la flèche montre la voie ouverte (Dédé-sur-Mer : elle suit la marée). */}
          {b.forks.map((f, k) => {
            const o = xy(f.cell)
            const d = f.ways.map((c) => ({ x: xy(c).col - o.col, y: xy(c).row - o.row }))
            const way = snap.sw?.[k] === 1 ? 1 : 0
            const size = cell * 0.62
            return (
              <div key={k} className="pointer-events-none absolute z-10" style={{ left: (o.col + 0.5 + (d[0].x + d[1].x) * 0.5) * cell - size / 2, top: (o.row + 0.5 + (d[0].y + d[1].y) * 0.5) * cell - size / 2, width: size, height: size }}>
                <motion.div
                  className={cn('flex size-full items-center justify-center rounded-full border-ink font-display font-extrabold text-[#1f1b2e]', f.mode === 'tide' ? 'bg-sky' : 'bg-sun')}
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

          {/* La Kermesse : la cagnotte au stand de la Tombola. */}
          {b.id === 'kermesse' && (
            <div className="pointer-events-none absolute z-10 flex items-center justify-center" style={{ left: stand.col * cell - cell * 0.3, top: stand.row * cell + cell * 0.12, width: cell * 1.6, height: cell * 0.76 }}>
              <motion.span
                key={mech.pot}
                initial={{ scale: 1.5 }}
                animate={{ scale: 1 }}
                className="sticker-sm bg-[#FF8C42] px-1 font-display font-extrabold leading-none whitespace-nowrap text-[#1f1b2e]"
                style={{ fontSize: Math.max(11, cell * 0.36) }}
              >
                🎟️ {mech.pot ?? 5}
              </motion.span>
            </div>
          )}

          {/* Le Camping : Riton sur sa case, et son sac. */}
          {ritonAt !== null && (
            <motion.div
              className="pointer-events-none absolute z-20 flex items-end justify-center"
              initial={false}
              animate={{ left: xy(ritonAt).col * cell + cell * 0.42, top: xy(ritonAt).row * cell - cell * 0.18 }}
              transition={{ type: 'spring', stiffness: 380, damping: 18 }}
              style={{ width: cell * 0.7, height: cell * 0.7 }}
            >
              <span style={{ fontSize: cell * 0.5, filter: 'drop-shadow(1.5px 1.5px 0 var(--ink))' }}>🦝</span>
              {(mech.sack ?? 0) > 0 && (
                <span className="sticker-sm absolute -right-1 -bottom-1 bg-[#E9C46A] px-0.5 font-display font-extrabold leading-none text-[#1f1b2e]" style={{ fontSize: Math.max(9, cell * 0.24) }}>
                  {mech.sack}🪙
                </span>
              )}
            </motion.div>
          )}

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
              const pl = place(c, idx, ids.length)
              return (
                <motion.div key={id} className="absolute z-20" initial={false} animate={{ left: pl.x, top: pl.y, width: pl.size, height: pl.size }} transition={{ type: 'spring', stiffness: 260, damping: 22 }}>
                  <Avatar slug={p.slug} tenue={p.equippedTenue} size={pl.size} />
                </motion.div>
              )
            }),
          )}
          {view.mover && (
            <MoverPawn key={view.mover.id} at={xy(view.mover.cell)} cellIdx={view.mover.cell} cell={cell} player={get(view.mover.id)} pop={pop} popKey={view.events.length} />
          )}
          {!view.mover && view.epi && pop && (
            <div className="pointer-events-none absolute inset-x-0 top-1 z-30 flex justify-center">
              <motion.span key={view.epi.events.length} initial={{ scale: 0.4 }} animate={{ scale: 1 }} className="sticker-sm bg-sun px-2 font-display font-extrabold text-[#1f1b2e]" style={{ fontSize: Math.max(12, cell * 0.34) }}>
                {pop}
              </motion.span>
            </div>
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
