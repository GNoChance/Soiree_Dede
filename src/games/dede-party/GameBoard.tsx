import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/cn'
import { signed, type BoardView } from './anim'
import { CELL_INFO, cellXY, isJump, linksOf, quarterOf, transportOf } from './board'
import { PACK } from './boards/camping'
import { STAND } from './boards/kermesse'
import { MiniMap, TRANSPORT_LOOK, bankCells, ratonsOf, type GridBox } from './MiniMap'
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

interface BoardProps {
  s: DedePartyState
  view: BoardView
  get: Get
  /** Contenu du milieu du plateau (taille S : dans la zone libre ; grandes tailles au téléphone : en haut de la fenêtre). */
  center?: ReactNode
  className?: string
  portrait?: boolean
  /** Mon joueur (téléphone) : grandes tailles, la fenêtre cadre mon pion pendant le lancer. */
  meId?: string | null
  /** Télé : grandes tailles, le plateau entier à l'échelle (pas de fenêtre). */
  big?: boolean
}

/**
 * Le plateau de la partie à plat (2D) : repli quand le plateau 3D n'est pas disponible, et plan
 * d'ensemble dans l'aide. Grille du plateau (transposée en portrait), le tracé, les aiguillages et portes
 * (flèche vers la voie ouverte), les grands sauts et transports en pointillés fléchés (télésièges, verglas,
 * bacs, télécabines, pistes, Grande Luge), la mécanique (bancs voilés à marée haute, cagnotte au stand et
 * aux guichets, ratons sur leur case), les étoiles et les pions (têtes chibi).
 * Grandes tailles au téléphone : une fenêtre au format du plateau classique qui suit l'action, et la mini-carte.
 */
export function Board(props: BoardProps) {
  if (props.view.board.size === 's' || props.big) return <WholeBoard {...props} />
  return <WindowBoard {...props} />
}

/** Le plateau entier, à l'échelle de la largeur disponible. */
function WholeBoard({ s, view, get, center, className, portrait = false }: BoardProps) {
  const [ref, w] = useWidth()
  const b = view.board
  const cols = portrait ? b.rows : b.cols
  const rows = portrait ? b.cols : b.rows
  const cell = w / cols
  // Zone libre du plateau (Dédé, dés…) : plateau classique seulement.
  const h = b.hole
  const hole = portrait ? { left: h.row, top: h.col, width: h.h, height: h.w } : { left: h.col, top: h.row, width: h.w, height: h.h }
  const last = view.events[0] ?? view.epi?.events[0]
  const pop = last ? popOf(last) : null
  return (
    <div ref={ref} className={cn('relative w-full select-none', className)} style={{ aspectRatio: `${cols} / ${rows}` }}>
      {w > 0 && (
        <>
          <Layer s={s} view={view} get={get} cell={cell} portrait={portrait} />
          {/* Milieu du plateau. */}
          {center && b.size === 's' && (
            <div className="absolute flex items-center justify-center overflow-hidden" style={{ left: hole.left * cell, top: hole.top * cell, width: hole.width * cell, height: hole.height * cell }}>
              {center}
            </div>
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

/** Fenêtre du téléphone : 9 colonnes × 11 lignes en portrait (11 × 9 en paysage), comme le plateau classique. */
const WIN = { portrait: [9, 11], landscape: [11, 9] } as const

/** Case à garder au centre de la fenêtre : pion en vedette, mon pion, le banc ou le raton de l'épilogue. */
function focusOf(s: DedePartyState, view: BoardView, meId?: string | null): { key: string; cell: number } | null {
  const b = view.board
  const snap = view.snap
  if (view.mover) return { key: `m:${view.mover.id}:${view.mover.cell}`, cell: view.mover.cell }
  const mine = meId && s.players.includes(meId) ? snap.pos[meId] : undefined
  const near = (cells: number[], from: number | undefined) => {
    if (!cells.length) return null
    if (typeof from !== 'number') return cells[0]
    const [fc, fr] = b.xy[from]
    return cells.reduce((best, c) => (Math.hypot(b.xy[c][0] - fc, b.xy[c][1] - fr) < Math.hypot(b.xy[best][0] - fc, b.xy[best][1] - fr) ? c : best), cells[0])
  }
  if (view.epi) {
    const d = view.epi.data
    if (d.t === 'tide') {
      // Mon pion s'il est emporté, sinon le banc le plus proche de moi.
      if (meId && typeof mine === 'number' && d.washed.some((x) => x.id === meId)) return { key: `w:${mine}`, cell: mine }
      const c = near(bankCells(b), mine)
      if (c !== null) return { key: `b:${c}`, cell: c }
    } else {
      // Le raton de ma zone (Riton sur le camp, Rita au Sous-bois, Ritou à la Rivière).
      const ratons = ratonsOf(b, snap.mech)
      const zone = typeof mine === 'number' ? (quarterOf(b, mine)?.id ?? null) : null
      const r = ratons.find((x) => (quarterOf(b, x.cell)?.id ?? null) === zone) ?? ratons[0]
      if (r) return { key: `r:${r.who}:${r.cell}`, cell: r.cell }
    }
  }
  if (typeof mine === 'number') return { key: `me:${mine}`, cell: mine }
  return null
}

const clamp = (x: number, a: number, z: number) => Math.max(a, Math.min(z, x))

/** Grandes tailles au téléphone : la fenêtre qui glisse, la mini-carte dessous, « Tout voir ». */
function WindowBoard({ s, view, get, center, className, portrait = false, meId }: BoardProps) {
  const [ref, w] = useWidth()
  const b = view.board
  const cols = portrait ? b.rows : b.cols
  const rows = portrait ? b.cols : b.rows
  const [all, setAll] = useState(false)
  const [pick, setPick] = useState<{ x: number; y: number; key: string } | null>(null)
  const [wc, wr] = WIN[portrait ? 'portrait' : 'landscape']
  const winC = Math.min(cols, wc)
  const winR = Math.min(rows, wr)
  const cell = w / (all ? cols : winC)

  // Centre de la fenêtre (repère affiché) : la case suivie, ou l'endroit touché sur la mini-carte (tant que l'action ne bouge pas).
  const focus = focusOf(s, view, meId)
  const key = focus?.key ?? 'none'
  let cx: number
  let cy: number
  if (pick && pick.key === key) {
    cx = pick.x
    cy = pick.y
  } else {
    const p = cellXY(b, focus?.cell ?? 0, portrait)
    cx = p.col + 0.5
    cy = p.row + 0.5
  }
  const ox = clamp(cx - winC / 2, 0, cols - winC)
  const oy = clamp(cy - winR / 2, 0, rows - winR)
  // La fenêtre en grille brute (cadre de la mini-carte).
  const frame: GridBox = portrait
    ? { c0: b.col0 + oy, c1: b.col0 + oy + winR - 1, r0: b.row0 + ox, r1: b.row0 + ox + winC - 1 }
    : { c0: b.col0 + ox, c1: b.col0 + ox + winC - 1, r0: b.row0 + oy, r1: b.row0 + oy + winR - 1 }
  const onPick = (c: number, r: number) => {
    const x = (portrait ? r - b.row0 : c - b.col0) + 0.5
    const y = (portrait ? c - b.col0 : r - b.row0) + 0.5
    setPick({ x, y, key })
  }

  const last = view.events[0] ?? view.epi?.events[0]
  const pop = last ? popOf(last) : null

  return (
    <div className={cn('flex w-full flex-col items-center gap-2 select-none', className)}>
      <div
        ref={ref}
        className="relative w-full overflow-hidden rounded-card border-[3px] border-ink bg-sunk/50"
        style={{ aspectRatio: all ? `${cols} / ${rows}` : `${winC} / ${winR}` }}
      >
        {w > 0 && (
          <div
            className="absolute top-0 left-0"
            style={{
              width: cols * cell,
              height: rows * cell,
              transform: all ? undefined : `translate3d(${-ox * cell}px, ${-oy * cell}px, 0)`,
              transition: 'transform 300ms ease-out',
            }}
          >
            <Layer s={s} view={view} get={get} cell={cell} portrait={portrait} />
          </div>
        )}
        {/* Milieu (qui joue, dés…) : en surimpression en haut de la fenêtre. */}
        {center && !all && (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-40 flex justify-center p-1.5">
            <div className="flex max-w-[94%] justify-center rounded-card bg-paper/85 px-2 py-1 shadow-sticker-sm backdrop-blur-[2px]" style={{ zoom: 0.85 }}>
              {center}
            </div>
          </div>
        )}
        {!view.mover && view.epi && pop && (
          <div className="pointer-events-none absolute inset-x-0 bottom-2 z-30 flex justify-center">
            <motion.span key={view.epi.events.length} initial={{ scale: 0.4 }} animate={{ scale: 1 }} className="sticker-sm bg-sun px-2 font-display text-lg font-extrabold text-[#1f1b2e]">
              {pop}
            </motion.span>
          </div>
        )}
      </div>
      <div className="flex w-full items-center justify-center gap-3">
        {!all && (
          <MiniMap
            board={b}
            snap={view.snap}
            order={s.order}
            get={get}
            meId={meId}
            highlight={view.mover?.id ?? null}
            frame={frame}
            onPick={onPick}
            orient={portrait ? 'transpose' : 'land'}
            className="h-[112px] max-w-[64%]"
          />
        )}
        <button
          type="button"
          onClick={() => setAll((x) => !x)}
          className="sticker-sm shrink-0 bg-surface px-3 py-2 font-display text-base font-extrabold leading-tight active:translate-y-0.5"
        >
          {all ? '🔍 Zoomer' : '🗺️ Tout voir'}
        </button>
      </div>
    </div>
  )
}

/** Tout ce qui est posé sur le plateau, à l'échelle `cell` (px par case), dans le repère de l'emprise. */
function Layer({ s, view, get, cell, portrait }: { s: DedePartyState; view: BoardView; get: Get; cell: number; portrait: boolean }) {
  const b = view.board
  const big = b.size !== 's'
  const cols = portrait ? b.rows : b.cols
  const rows = portrait ? b.cols : b.rows
  const snap = view.snap
  const mech = snap.mech ?? {}
  const moverId = view.mover?.id ?? null
  const xy = (i: number) => cellXY(b, i, portrait)
  // Coordonnées brutes (décor) → repère affiché.
  const at = (col: number, row: number) => (portrait ? { col: row - b.row0, row: col - b.col0 } : { col: col - b.col0, row: row - b.row0 })
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
  // Marée haute : tous les bancs de sable sous l'eau.
  const wet = b.id === 'mer' && mech.tide === 1 ? new Set(bankCells(b)) : null
  // Les ratons : leur case (en direct pendant la ronde).
  const ratons = ratonsOf(b, mech).map((r) => {
    const hop = r.who === 0 ? view.epi?.hop : view.epi?.packs.find((p) => p.who === r.who)?.hop
    return { ...r, at: hop ? (hop.frac > 0.5 ? hop.to : hop.from) : r.cell }
  })
  const stand = at(STAND.col, STAND.row)
  // Guichets de la Tombola dans les quartiers (grande Kermesse) : une plaque avec la cagnotte.
  const booths = b.id === 'kermesse' && big ? b.cells.flatMap((t, i) => (t === 'tombola' && quarterOf(b, i) ? [i] : [])) : []
  // Grands sauts : téléporteurs (Dédé 2000) et transports (Grande Luge, bacs, télécabines, pistes).
  const leaps: Array<{ from: number; to: number; color: string; emoji?: string }> = [
    ...Object.entries(b.tp ?? {}).map(([from, x]) => ({ from: Number(from), to: x.to, color: x.to > Number(from) ? '#5E8C00' : '#2A9FD6' })),
    ...b.jumps.map(([from, to]) => {
      const look = TRANSPORT_LOOK[transportOf(b, from, to)?.kind ?? 'luge']
      return { from, to, color: look.color, emoji: big ? look.emoji : undefined }
    }),
  ]
  const marker = `dp-arrow-${b.id}-${b.size}`

  return (
    <>
      {/* Le tracé. */}
      <svg className="pointer-events-none absolute top-0 left-0" style={{ width: cols * cell, height: rows * cell }} viewBox={`0 0 ${cols} ${rows}`} aria-hidden>
        <defs>
          <marker id={marker} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="3" markerHeight="3" orient="auto-start-reverse">
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
        {leaps.map(({ from, to, color, emoji }) => {
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
          // Milieu de la courbe : le véhicule.
          const ex = 0.25 * (p.col + 0.5) + 0.5 * mx + 0.25 * (q.col + 0.5)
          const ey = 0.25 * (p.row + 0.5) + 0.5 * my + 0.25 * (q.row + 0.5)
          return (
            <g key={`j${from}-${to}`}>
              <path
                d={`M ${trim(p.col + 0.5, p.row + 0.5, 0.42)} Q ${mx} ${my} ${trim(q.col + 0.5, q.row + 0.5, 0.5)}`}
                fill="none"
                stroke={color}
                strokeWidth={0.13}
                strokeDasharray="0.18 0.14"
                strokeLinecap="round"
                markerEnd={`url(#${marker})`}
                opacity={0.9}
              />
              {emoji && (
                <>
                  <circle cx={ex} cy={ey} r={0.3} fill="var(--surface)" stroke={color} strokeWidth={0.07} />
                  <text x={ex} y={ey + 0.14} fontSize={0.38} textAnchor="middle">
                    {emoji}
                  </text>
                </>
              )}
            </g>
          )
        })}
      </svg>

      {b.cells.map((t, i) => {
        const { col, row } = xy(i)
        const info = CELL_INFO[t]
        const lit = view.mover && view.mover.cell === i
        return (
          <div key={i} className="absolute" style={{ left: col * cell, top: row * cell, width: cell, height: cell, padding: Math.max(1.5, cell * 0.06) }}>
            <div
              className={cn('relative flex size-full flex-col items-center justify-center overflow-hidden rounded-[26%] border-ink leading-none text-[#1f1b2e] transition-transform', lit && 'scale-110')}
              style={{ background: info.color, borderWidth: Math.max(2, cell * 0.05), boxShadow: `${Math.max(1.5, cell * 0.05)}px ${Math.max(1.5, cell * 0.05)}px 0 0 var(--ink)` }}
              title={`${b.cellNames?.[i] ?? info.label} : ${info.effect}`}
            >
              <span style={{ fontSize: cell * 0.46 }}>{info.emoji}</span>
              {wet?.has(i) && <span className="absolute inset-0 bg-[#2EC4F1]/70" aria-label="sous l’eau" />}
            </div>
          </div>
        )
      })}

      {/* Aiguillages et portes : la flèche montre la voie ouverte (Dédé-sur-Mer : elle suit la marée). */}
      {b.forks.map((f, k) => {
        const o = xy(f.cell)
        // Direction de chaque voie (un bac ou une cabine part loin : on garde la direction, pas la distance).
        const d = f.ways.map((c) => {
          const x = xy(c).col - o.col
          const y = xy(c).row - o.row
          const l = Math.hypot(x, y)
          return l > 1.5 ? { x: x / l, y: y / l } : { x, y }
        })
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
      {/* … et un rappel sur chaque guichet de quartier (même cagnotte). */}
      {booths.map((i) => {
        const p = xy(i)
        return (
          <span
            key={`g${i}`}
            className="sticker-sm pointer-events-none absolute z-10 bg-[#FF8C42] px-0.5 font-display font-extrabold leading-none whitespace-nowrap text-[#1f1b2e]"
            style={{ left: p.col * cell + cell * 0.42, top: p.row * cell + cell * 0.62, fontSize: Math.max(9, cell * 0.24) }}
          >
            🎟️ {mech.pot ?? 5}
          </span>
        )
      })}

      {/* Le Camping : Riton (et sa famille) sur sa case, et son sac. */}
      {ratons.map((r) => {
        const fam = r.who > 0 ? PACK[r.who - 1] : null
        const k = fam?.scale ?? 1
        return (
          <motion.div
            key={r.who}
            className="pointer-events-none absolute z-20 flex items-end justify-center"
            initial={false}
            animate={{ left: xy(r.at).col * cell + cell * 0.42, top: xy(r.at).row * cell - cell * 0.18 }}
            transition={{ type: 'spring', stiffness: 380, damping: 18 }}
            style={{ width: cell * 0.7, height: cell * 0.7 }}
            title={fam?.name ?? 'Riton'}
          >
            {fam ? (
              <span
                className="flex items-center justify-center rounded-full border-2 border-ink leading-none"
                style={{ background: fam.scarf, width: cell * 0.62 * k, height: cell * 0.62 * k, fontSize: cell * 0.44 * k }}
              >
                🦝
              </span>
            ) : (
              <span style={{ fontSize: cell * 0.5, filter: 'drop-shadow(1.5px 1.5px 0 var(--ink))' }}>🦝</span>
            )}
            {r.sack > 0 && (
              <span className="sticker-sm absolute -right-1 -bottom-1 bg-[#E9C46A] px-0.5 font-display font-extrabold leading-none text-[#1f1b2e]" style={{ fontSize: Math.max(9, cell * 0.24) }}>
                {r.sack}🪙
              </span>
            )}
          </motion.div>
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
      {view.mover && <MoverPawn key={view.mover.id} at={xy(view.mover.cell)} cellIdx={view.mover.cell} cell={cell} player={get(view.mover.id)} pop={pop} popKey={view.events.length} />}
    </>
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
