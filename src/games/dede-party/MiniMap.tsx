/**
 * Mini-carte d'un grand plateau (spec grands plateaux §4.3), dérivée de `BoardThumb` : une pastille par case
 * (couleur du type), le tracé, les transports en pointillés colorés, le nom et l'émoji de chaque quartier,
 * les pions, les étoiles, la mécanique (bancs sous l'eau, ratons, guichets de la Tombola) et les quartiers
 * fermés en gris hachuré (🔒 « à 5 joueurs »). Tout est en coordonnées de grille BRUTES (repère prolongé).
 */
import { useId, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/cn'
import { CELL_INFO, SIZED, isJump, linksOf, transportOf, type BoardDef, type Quarter, type TransportKind } from './board'
import { PACK } from './boards/camping'
import type { Get } from './Parts'
import type { DpSnap } from './types'

/** Orientation : paysage, transposée (comme le plateau 2D en portrait), ou un quart de tour (comme la scène 3D en portrait). */
export type MapOrient = 'land' | 'transpose' | 'ccw'

/** Rectangle de grille brute, bornes comprises (cases). */
export interface GridBox {
  c0: number
  r0: number
  c1: number
  r1: number
}

/** Couleur et véhicule de chaque transport (mini-carte, plateau 2D). */
export const TRANSPORT_LOOK: Record<TransportKind, { color: string; emoji: string }> = {
  boat: { color: '#118AB2', emoji: '⛴️' },
  cabin: { color: '#E63946', emoji: '🚠' },
  slide: { color: '#F77F00', emoji: '⛷️' },
  luge: { color: '#8B5CF6', emoji: '🛷' },
}

/** Cases des bancs de sable (tous les bancs : `extra.banks` en grande taille, `extra.bank` sinon). */
export function bankCells(b: BoardDef): number[] {
  const banks = b.extra.banks as Array<{ cells: number[] }> | undefined
  if (banks) return banks.flatMap((x) => x.cells)
  return (b.extra.bank as number[] | undefined) ?? []
}

/** Les ratons sur le plateau (0 = Riton, 1… = la famille), avec leur case et leur sac. */
export function ratonsOf(b: BoardDef, mech: DpSnap['mech']): Array<{ who: number; cell: number; sack: number }> {
  if (b.id !== 'camping' || !mech || typeof mech.riton !== 'number') return []
  return [{ who: 0, cell: mech.riton, sack: mech.sack ?? 0 }, ...(mech.pack ?? []).map((p, k) => ({ who: k + 1, cell: p.c, sack: p.sack }))]
}

/** Cases (repère brut) d'un quartier fermé : prises dans la plus grande taille du plateau. */
function closedXY(b: BoardDef, q: Quarter): Array<[number, number]> {
  const all = SIZED[b.id]
  const big = all[all.list[all.list.length - 1]] ?? b
  return q.cells.map((i) => big.xy[i]).filter(Boolean)
}

const OPENS_LABEL = { m: 'à 5 joueurs', l: 'à 7 joueurs' } as const

/** Une étiquette sur une ligne, ou deux (coupée à l'espace le plus proche du milieu), si elle tient en `max` lettres ; sinon null. */
function labelLines(label: string, max: number): string[] | null {
  if (label.length <= max) return [label]
  let best = -1
  for (let i = 0; i < label.length; i++) if (label[i] === ' ' && (best < 0 || Math.abs(i - label.length / 2) < Math.abs(best - label.length / 2))) best = i
  if (best < 0) return null
  const two = [label.slice(0, best), label.slice(best + 1)]
  return Math.max(two[0].length, two[1].length) <= max ? two : null
}

interface MiniMapProps {
  board: BoardDef
  /** Plateau affiché (pions, étoiles, mécanique) ; absent : le tracé seul. */
  snap?: DpSnap
  /** Pions à montrer (ordre de jeu) et leurs infos. */
  order?: string[]
  get?: Get
  /** Mon pion (liseré), le pion en vedette (au premier plan). */
  meId?: string | null
  highlight?: string | null
  /** Cadre blanc : ce que montre la caméra ou la fenêtre (grille brute, bornes comprises). */
  frame?: GridBox | null
  /** Toucher la mini-carte : case visée (grille brute, décimales). */
  onPick?: (col: number, row: number) => void
  orient?: MapOrient
  /** Montrer les quartiers fermés (défaut : oui). */
  showClosed?: boolean
  /** S'inscrire dans la boîte du parent (qui a une hauteur), au lieu de prendre toute la largeur. */
  fit?: boolean
  className?: string
}

export function MiniMap({ board: b, snap, order = [], get, meId, highlight, frame, onPick, orient = 'land', showClosed = true, fit, className }: MiniMapProps) {
  const uid = useId().replace(/:/g, '')
  const box = useRef<HTMLDivElement>(null)
  const [px, setPx] = useState(0)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setPx(el.clientWidth))
    ro.observe(el)
    setPx(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // Emprise : cases ouvertes (+ quartiers fermés), marge d'une demi-case et un peu plus pour les étiquettes.
  const closed = showClosed ? b.closed.map((q) => ({ q, xy: closedXY(b, q) })) : []
  let g = { c0: b.col0, r0: b.row0, c1: b.col0 + b.cols - 1, r1: b.row0 + b.rows - 1 }
  for (const { q } of closed) g = { c0: Math.min(g.c0, q.box.c0), r0: Math.min(g.r0, q.box.r0), c1: Math.max(g.c1, q.box.c1), r1: Math.max(g.r1, q.box.r1) }
  const M = 0.75
  // Repère brut → repère de l'image (avant décalage).
  const raw = (c: number, r: number): [number, number] => (orient === 'transpose' ? [r, c] : orient === 'ccw' ? [r, -c] : [c, r])
  const corners = [raw(g.c0 - M, g.r0 - M), raw(g.c1 + M, g.r1 + M)]
  const x0 = Math.min(corners[0][0], corners[1][0])
  const y0 = Math.min(corners[0][1], corners[1][1])
  const W = Math.abs(corners[0][0] - corners[1][0])
  const H = Math.abs(corners[0][1] - corners[1][1])
  const P = (c: number, r: number): [number, number] => {
    const [x, y] = raw(c, r)
    return [x - x0, y - y0]
  }
  const pxy = (i: number) => P(b.xy[i][0], b.xy[i][1])
  /** Rectangle (bornes de cases comprises) dans le repère de l'image. */
  const rectOf = (q: GridBox, pad = 0.5) => {
    const a = P(q.c0 - pad, q.r0 - pad)
    const z = P(q.c1 + pad, q.r1 + pad)
    return { x: Math.min(a[0], z[0]), y: Math.min(a[1], z[1]), w: Math.abs(a[0] - z[0]), h: Math.abs(a[1] - z[1]) }
  }

  // Taille d'une case à l'écran : décide des étiquettes et des têtes.
  const unit = px > 0 ? px / W : 0
  const full = unit >= 10
  const heads = Boolean(get) && unit >= 14
  // Textes : jamais sous ~11 px à l'écran.
  const fs = (k: number, min = 11) => Math.max(k, unit > 0 ? min / unit : k)

  const mech = snap?.mech ?? {}
  const wet = mech.tide === 1 ? bankCells(b) : []
  const ratons = ratonsOf(b, mech)
  const links = linksOf(b).filter(([a, c]) => !isJump(b, a, c))
  const leaps = [
    ...Object.entries(b.tp ?? {}).map(([from, x]) => ({ from: Number(from), to: x.to, color: x.to > Number(from) ? '#5E8C00' : '#2A9FD6', thin: true })),
    ...b.jumps.map(([from, to]) => ({ from, to, color: TRANSPORT_LOOK[transportOf(b, from, to)?.kind ?? 'luge'].color, thin: false })),
  ]

  // Pions groupés par case (le pion en vedette au-dessus).
  const groups = new Map<number, string[]>()
  if (snap) {
    for (const id of order) {
      const c = snap.pos[id]
      if (typeof c !== 'number') continue
      groups.set(c, [...(groups.get(c) ?? []), id])
    }
  }
  const pawns = [...groups.entries()].flatMap(([c, ids]) =>
    ids.map((id, k) => {
      const [x, y] = pxy(c)
      const n = ids.length
      const a = (k / n) * Math.PI * 2 - Math.PI / 2
      const off = n > 1 ? 0.32 : 0
      return { id, x: x + Math.cos(a) * off, y: y + Math.sin(a) * off - (n > 1 ? 0 : 0.12), n }
    }),
  )
  pawns.sort((p, q) => Number(p.id === highlight) - Number(q.id === highlight) || Number(p.id === meId) - Number(q.id === meId))

  const pick = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!onPick || (e.type === 'pointermove' && !e.buttons)) return
    const r = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * W + x0
    const y = ((e.clientY - r.top) / r.height) * H + y0
    // Repère de l'image → repère brut.
    if (orient === 'transpose') onPick(y, x)
    else if (orient === 'ccw') onPick(-y, x)
    else onPick(x, y)
  }

  const inner = (
    <div
      ref={box}
      className={cn('relative overflow-hidden rounded-chip border-[3px] border-ink bg-sunk shadow-sticker-sm', onPick && 'cursor-pointer touch-none', !fit && className)}
      style={fit ? { aspectRatio: `${W} / ${H}`, width: `min(100cqw, calc(100cqh * ${W} / ${H}))` } : { aspectRatio: `${W} / ${H}` }}
      onPointerDown={onPick ? pick : undefined}
      onPointerMove={onPick ? pick : undefined}
      role={onPick ? 'button' : 'img'}
      aria-label={`Carte de ${b.name}`}
    >
      <svg className="absolute inset-0 size-full" viewBox={`0 0 ${W} ${H}`} aria-hidden>
        <defs>
          <pattern id={`mm-hatch-${uid}`} width={0.5} height={0.5} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width={0.5} height={0.5} fill="var(--muted)" opacity={0.18} />
            <line x1={0} y1={0} x2={0} y2={0.5} stroke="var(--muted)" strokeWidth={0.16} opacity={0.55} />
          </pattern>
          <marker id={`mm-arrow-${uid}`} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="3" markerHeight="3" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text)" />
          </marker>
        </defs>

        {/* Quartiers ouverts : un fond teinté discret. */}
        {b.quarters.map((q) => {
          const r = rectOf(q.box, 0.6)
          return <rect key={q.id} x={r.x} y={r.y} width={r.w} height={r.h} rx={0.8} fill={q.road ?? 'var(--surface)'} opacity={0.3} />
        })}

        {/* Quartiers fermés : gris hachuré, cases en silhouette. */}
        {closed.map(({ q, xy }) => {
          const r = rectOf(q.box, 0.6)
          return (
            <g key={q.id}>
              <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={0.8} fill={`url(#mm-hatch-${uid})`} stroke="var(--muted)" strokeWidth={0.12} strokeDasharray="0.4 0.3" />
              {xy.map(([c, rr], k) => {
                const [x, y] = P(c, rr)
                return <circle key={k} cx={x} cy={y} r={0.26} fill="var(--muted)" opacity={0.45} />
              })}
            </g>
          )
        })}

        {/* Le tracé. */}
        {links.map(([a, c]) => {
          const [x1, y1] = pxy(a)
          const [x2, y2] = pxy(c)
          return <line key={`${a}-${c}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--text)" strokeWidth={0.2} strokeLinecap="round" opacity={0.75} />
        })}

        {/* Transports et téléporteurs : pointillés colorés. */}
        {leaps.map(({ from, to, color, thin }) => {
          const [ax, ay] = pxy(from)
          const [bx, by] = pxy(to)
          const mx = (ax + bx) / 2 + (by - ay) * 0.15
          const my = (ay + by) / 2 - (bx - ax) * 0.15
          return (
            <path
              key={`j${from}-${to}`}
              d={`M ${ax} ${ay} Q ${mx} ${my} ${bx} ${by}`}
              fill="none"
              stroke={color}
              strokeWidth={thin ? 0.12 : 0.22}
              strokeDasharray={thin ? '0.2 0.2' : '0.4 0.25'}
              strokeLinecap="round"
              opacity={thin ? 0.7 : 1}
              markerEnd={thin ? undefined : `url(#mm-arrow-${uid})`}
            />
          )
        })}

        {/* Les cases. */}
        {b.cells.map((t, i) => {
          const [x, y] = pxy(i)
          return <circle key={i} cx={x} cy={y} r={0.36} fill={CELL_INFO[t].color} stroke="var(--ink)" strokeWidth={0.1} />
        })}

        {/* Marée haute : tous les bancs sous l'eau. */}
        {wet.map((i) => {
          const [x, y] = pxy(i)
          return <circle key={`w${i}`} cx={x} cy={y} r={0.55} fill="#2EC4F1" opacity={0.75} />
        })}

        {/* Guichets de la Tombola. */}
        {b.id === 'kermesse' &&
          b.cells.map((t, i) => {
            if (t !== 'tombola') return null
            const [x, y] = pxy(i)
            return (
              <text key={`t${i}`} x={x} y={y - 0.45} fontSize={fs(0.8, 10)} textAnchor="middle">
                🎟️
              </text>
            )
          })}

        {/* Les étoiles. */}
        {(snap?.star_cells ?? []).map((c, k) => {
          const [x, y] = pxy(c)
          return (
            <text key={`s${k}`} x={x} y={y + 0.32} fontSize={fs(0.95, 12)} textAnchor="middle" style={{ filter: 'drop-shadow(0.05px 0.05px 0 var(--ink))' }}>
              ⭐
            </text>
          )
        })}

        {/* Les ratons (Rita et Ritou : liseré de la couleur de leur foulard). */}
        {ratons.map((r) => {
          const [x, y] = pxy(r.cell)
          const scarf = r.who > 0 ? PACK[r.who - 1]?.scarf : null
          return (
            <g key={`r${r.who}`}>
              {scarf && <circle cx={x + 0.3} cy={y - 0.3} r={fs(0.45, 7)} fill={scarf} stroke="var(--ink)" strokeWidth={0.08} />}
              <text x={x + 0.3} y={y - 0.3 + fs(0.3, 4)} fontSize={fs(0.8, 11)} textAnchor="middle">
                🦝
              </text>
            </g>
          )
        })}

        {/* Les pions en pastilles (quand les têtes seraient trop petites). */}
        {!heads &&
          pawns.map((p) => (
            <circle
              key={p.id}
              cx={p.x}
              cy={p.y}
              r={p.n > 1 ? 0.3 : 0.4}
              fill={get?.(p.id).color ?? '#FFB703'}
              stroke={p.id === meId || p.id === highlight ? '#FFB703' : 'var(--ink)'}
              strokeWidth={p.id === meId || p.id === highlight ? 0.2 : 0.1}
            />
          ))}

        {/* Noms des quartiers ouverts (au milieu de leur boucle), et 🔒 des quartiers fermés. */}
        {b.quarters.map((q) => {
          const r = rectOf(q.box, 0.6)
          // Le nom (sur une ou deux lignes) s'il tient dans la largeur du quartier (≈ 0,55 em par lettre), sinon l'émoji seul, en grand.
          const f = fs(0.7, 11)
          const lines = full ? labelLines(`${q.emoji} ${q.name}`, (r.w + 1) / (0.55 * f)) : null
          const cx = r.x + r.w / 2
          const cy = r.y + r.h / 2
          const text = { textAnchor: 'middle' as const, fontWeight: 800, fill: 'var(--text)', stroke: 'var(--sunk)', paintOrder: 'stroke' as const, className: 'font-display' }
          if (!lines) {
            const e = fs(1.1, 16)
            return (
              <text key={`n${q.id}`} x={cx} y={cy + e * 0.35} fontSize={e} strokeWidth={e * 0.18} {...text}>
                {q.emoji}
              </text>
            )
          }
          return (
            <text key={`n${q.id}`} x={cx} y={cy + f * 0.35 - ((lines.length - 1) * f * 1.1) / 2} fontSize={f} strokeWidth={f * 0.22} {...text}>
              {lines.map((l, k) => (
                <tspan key={k} x={cx} dy={k ? f * 1.1 : 0}>
                  {l}
                </tspan>
              ))}
            </text>
          )
        })}
        {closed.map(({ q }) => {
          const r = rectOf(q.box, 0.6)
          const f = fs(0.8, 11)
          return (
            <text key={`c${q.id}`} x={r.x + r.w / 2} y={r.y + r.h / 2} fontSize={f} textAnchor="middle" fontWeight={800} fill="var(--muted)" className="font-display">
              <tspan x={r.x + r.w / 2} dy={full ? -f * 0.2 : f * 0.35}>
                🔒{full ? ` ${q.emoji}` : ''}
              </tspan>
              {full && (
                <tspan x={r.x + r.w / 2} dy={f * 1.2}>
                  {OPENS_LABEL[q.opens]}
                </tspan>
              )}
            </text>
          )
        })}

        {/* Cadre de la caméra ou de la fenêtre. */}
        {frame &&
          (() => {
            const r = rectOf(frame, 0.5)
            return (
              <g>
                <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={0.4} fill="none" stroke="var(--ink)" strokeWidth={Math.max(0.36, 4 / (unit || 10))} />
                <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={0.4} fill="none" stroke="#fff" strokeWidth={Math.max(0.18, 2 / (unit || 10))} />
              </g>
            )
          })()}
      </svg>

      {/* Les têtes des pions. */}
      {heads &&
        get &&
        pawns.map((p) => {
          const pl = get(p.id)
          const size = unit * (p.n > 1 ? 0.8 : 1.1)
          return (
            <div
              key={p.id}
              className="pointer-events-none absolute"
              style={{ left: `${(p.x / W) * 100}%`, top: `${(p.y / H) * 100}%`, width: size, height: size, transform: 'translate(-50%, -50%)', zIndex: p.id === highlight ? 3 : p.id === meId ? 2 : 1 }}
            >
              <Avatar slug={pl.slug} tenue={pl.equippedTenue} size={size} selected={p.id === highlight || p.id === meId} />
            </div>
          )
        })}
    </div>
  )

  if (!fit) return inner
  return (
    <div className={cn('flex items-center justify-center', className)} style={{ containerType: 'size' }}>
      {inner}
    </div>
  )
}
