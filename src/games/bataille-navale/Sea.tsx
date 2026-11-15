import { memo, useEffect, useMemo, type CSSProperties, type ReactNode, type Ref } from 'react'
import { AnimatePresence, motion, useAnimate, useReducedMotion } from 'framer-motion'
import { cn } from '@/lib/cn'
import { COLS, SIZE, cellIndex, cellName, shipCells, shipName } from './logic'
import { ShipSvg, shipBox } from './Fleet'
import type { BnLast, BnShip, BnShot, BnShotResult } from './types'

/*
 * Grille de mer « sticker » 10 × 10 (coordonnées A–J / 1–10) : bateaux,
 * impacts (plouf, touché, coulé), réticule de visée et effets du dernier tir
 * (obus, gerbe d'eau, explosion + secousse, bateau qui sombre, « COULÉ ! »).
 * Le défilement de la page n'est jamais capturé : seules les cases sont des
 * boutons (tap), aucun geste de glisser ici.
 */

const INK = '#1f1b2e'
const SEA_BG =
  'repeating-linear-gradient(135deg, rgba(255,255,255,.07) 0 5px, transparent 5px 13px), linear-gradient(160deg, #5BC8F2 0%, #3A86FF 58%, #2C6AD8 100%)'
const GRID_LINES =
  'linear-gradient(to right, rgba(255,255,255,.3) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,.3) 1px, transparent 1px)'

export const cellBox = (x: number, y: number): CSSProperties => ({ left: `${x * 10}%`, top: `${y * 10}%`, width: '10%', height: '10%' })

export type ShipLook = 'afloat' | 'sunk' | 'revealed'

export interface SeaShip {
  ship: BnShip
  look: ShipLook
  accent: string
  /** Vient d'être coulé : animation de naufrage. */
  fresh?: boolean
}

export interface SeaFx {
  /** Clé unique du tir (board.count). */
  key: number
  last: BnLast
}

export interface SeaProps {
  /** Tirs reçus par ces eaux. */
  shots: readonly BnShot[]
  ships?: readonly SeaShip[]
  /** Réticule (case visée). */
  target?: { x: number; y: number } | null
  /** Rend les cases cliquables (grille de tir). */
  onCell?: (x: number, y: number) => void
  /** Cases actives (c'est mon tour). */
  interactive?: boolean
  onCellPointerDown?: (pointerType: string) => void
  onHover?: (cell: { x: number; y: number } | null) => void
  /** Dernier tir à animer sur ces eaux. */
  fx?: SeaFx | null
  size?: 'lg' | 'sm'
  /** Couleur de la lueur « sous le feu » (null = aucune). */
  glow?: string | null
  /** Brouillard (préparation vue par un spectateur). */
  fog?: ReactNode
  /** Calques supplémentaires au-dessus des bateaux (placement). */
  children?: ReactNode
  seaRef?: Ref<HTMLDivElement>
  label: string
  className?: string
}

const RESULT_LABEL: Record<BnShotResult, string> = { miss: 'à l’eau', hit: 'touché', sunk: 'coulé' }

/* ---------------------------------------------------------------- impacts */

function Marker({ r, fresh, delay }: { r: BnShotResult; fresh: boolean; delay: number }) {
  const anim = fresh
    ? { initial: { scale: 0, opacity: 0 }, animate: { scale: 1, opacity: 1 }, transition: { delay, type: 'spring' as const, stiffness: 520, damping: 14 } }
    : { initial: false as const }
  if (r === 'miss') {
    return <motion.span {...anim} className="block size-[36%] rounded-full border-2 border-white bg-white/45 shadow-[0_0_0_2px_rgba(31,27,46,.25)]" />
  }
  if (r === 'hit') {
    return (
      <motion.svg {...anim} viewBox="0 0 100 100" className="block size-[84%]" aria-hidden>
        <path d={STAR} fill="#FFB703" stroke={INK} strokeWidth={7} strokeLinejoin="round" />
        <circle cx={50} cy={50} r={15} fill="#EF476F" stroke={INK} strokeWidth={5} />
      </motion.svg>
    )
  }
  return (
    <motion.svg {...anim} viewBox="0 0 100 100" className="block size-[66%]" aria-hidden>
      <path d="M24 24 L76 76 M76 24 L24 76" stroke={INK} strokeWidth={26} strokeLinecap="round" />
      <path d="M24 24 L76 76 M76 24 L24 76" stroke="#EF476F" strokeWidth={13} strokeLinecap="round" />
    </motion.svg>
  )
}

/** Étoile d'explosion à 12 branches (viewBox 100). */
const STAR = (() => {
  const pts: string[] = []
  for (let i = 0; i < 24; i++) {
    const a = (Math.PI * 2 * i) / 24 - Math.PI / 2
    const r = i % 2 === 0 ? 48 : 24
    pts.push(`${(50 + r * Math.cos(a)).toFixed(1)},${(50 + r * Math.sin(a)).toFixed(1)}`)
  }
  return `M${pts.join(' L')} Z`
})()

/* ---------------------------------------------------------------- effets du dernier tir */

const LAND = 0.32 // l'obus touche l'eau (s)

function ShotFx({ last }: { last: BnLast }) {
  const reduce = useReducedMotion()
  const center = 'absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2'
  const labelPos = last.x <= 1 ? 'left-0' : last.x >= SIZE - 2 ? 'right-0' : 'left-1/2 -translate-x-1/2'
  const label = last.r === 'miss' ? 'Plouf !' : last.r === 'hit' ? 'Touché !' : 'Coulé !'
  return (
    <motion.div className="pointer-events-none absolute z-40" style={cellBox(last.x, last.y)} exit={{ opacity: 0 }} aria-hidden>
      {!reduce && (
        <motion.span
          className={cn(center, 'size-[46%] rounded-full bg-[#1f1b2e] shadow-[inset_-2px_-2px_0_rgba(255,255,255,.4)]')}
          initial={{ y: -90, scale: 1.9, opacity: 0 }}
          animate={{ y: 0, scale: 0.7, opacity: [0, 1, 1, 0] }}
          transition={{ duration: LAND, ease: 'easeIn', opacity: { duration: LAND + 0.05, times: [0, 0.2, 0.85, 1] } }}
        />
      )}
      {last.r === 'miss' ? (
        <>
          {[0, 1].map((i) => (
            <motion.span
              key={i}
              className={cn(center, 'size-full rounded-full border-[3px] border-white')}
              initial={{ scale: 0.2, opacity: 0 }}
              animate={{ scale: [0.2, 1.9], opacity: [0, 0.95, 0] }}
              transition={{ delay: LAND + i * 0.14, duration: 0.75, ease: 'easeOut' }}
            />
          ))}
          {!reduce &&
            [-2, -1, 0, 1, 2].map((d) => (
              <motion.span
                key={d}
                className={cn(center, 'size-[20%] rounded-full border border-[#1f1b2e]/30 bg-white')}
                initial={{ x: 0, y: 0, opacity: 0 }}
                animate={{ x: d * 11, y: [0, -22 + Math.abs(d) * 5, 8], opacity: [0, 1, 0] }}
                transition={{ delay: LAND, duration: 0.6, ease: 'easeOut' }}
              />
            ))}
        </>
      ) : (
        <>
          <motion.svg
            viewBox="0 0 100 100"
            className={cn(center, last.r === 'sunk' ? 'size-[260%]' : 'size-[190%]')}
            initial={{ scale: 0, rotate: -25, opacity: 0 }}
            animate={{ scale: [0, 1.15, 0.9], rotate: 12, opacity: [0, 1, 1, 0] }}
            transition={{ delay: LAND, duration: 0.75, opacity: { delay: LAND, duration: 0.85, times: [0, 0.1, 0.7, 1] } }}
          >
            <path d={STAR} fill="#FB8500" stroke={INK} strokeWidth={4} strokeLinejoin="round" />
            <path d={STAR} fill="#FFB703" transform="translate(50 50) scale(.62) translate(-50 -50)" />
            <circle cx={50} cy={50} r={13} fill="#fff" />
          </motion.svg>
          {!reduce &&
            Array.from({ length: 8 }, (_, i) => {
              const a = (Math.PI * 2 * i) / 8
              return (
                <motion.span
                  key={i}
                  className={cn(center, 'size-[16%] rounded-full border border-[#1f1b2e]', i % 2 ? 'bg-tomato' : 'bg-sun')}
                  initial={{ x: 0, y: 0, opacity: 0 }}
                  animate={{ x: Math.cos(a) * 30, y: Math.sin(a) * 30, opacity: [0, 1, 0] }}
                  transition={{ delay: LAND, duration: 0.55, ease: 'easeOut' }}
                />
              )
            })}
          <motion.span
            className={cn(center, 'size-full rounded-full bg-[#6b6485]/50')}
            initial={{ scale: 0.3, opacity: 0 }}
            animate={{ scale: [0.3, 1.7], opacity: [0, 0.7, 0] }}
            transition={{ delay: LAND + 0.25, duration: 1 }}
          />
        </>
      )}
      <motion.span
        className={cn(
          'absolute bottom-full mb-1 rounded-full border-2 border-ink px-1.5 font-display text-xs leading-tight font-extrabold whitespace-nowrap shadow-sticker-sm',
          labelPos,
          last.r === 'miss' ? 'bg-sky text-[#1f1b2e]' : last.r === 'hit' ? 'bg-sun text-[#1f1b2e]' : 'bg-tomato text-white',
        )}
        initial={{ y: 6, opacity: 0, scale: 0.6 }}
        animate={{ y: -4, opacity: [0, 1, 1, 0], scale: 1 }}
        transition={{ delay: LAND + 0.05, duration: 1.4, opacity: { delay: LAND + 0.05, duration: 1.4, times: [0, 0.12, 0.8, 1] } }}
      >
        {label}
      </motion.span>
    </motion.div>
  )
}

/** Grand bandeau « COULÉ ! » au centre de la grille (s'efface tout seul). */
function SunkBanner({ last, accent }: { last: BnLast; accent: string }) {
  return (
    <motion.div
      className="pointer-events-none absolute inset-x-[6%] top-1/2 z-50 flex -translate-y-1/2 flex-col items-center gap-1 rounded-2xl border-[3px] border-ink bg-tomato px-2 py-1.5 text-center text-white shadow-sticker"
      initial={{ scale: 0.3, rotate: -10, opacity: 0 }}
      animate={{ scale: [0.3, 1.12, 1, 1, 0.92], rotate: [-10, 3, -2, -2, 0], opacity: [0, 1, 1, 1, 0] }}
      transition={{ delay: LAND + 0.2, duration: 2.3, times: [0, 0.12, 0.22, 0.85, 1] }}
      exit={{ opacity: 0 }}
      aria-hidden
    >
      <span className="font-display text-3xl leading-none font-extrabold tracking-wide" style={{ textShadow: `2px 2px 0 ${INK}` }}>
        COULÉ !
      </span>
      {last.ship && (
        <span className="flex items-center gap-1.5 font-display text-sm font-extrabold">
          <span className="block h-3.5" style={{ width: `${(shipCells({ id: last.ship, x: 0, y: 0, dir: 'h' })?.length ?? 3) * 0.9}rem` }}>
            <ShipSvg id={last.ship} accent={accent} className="grayscale-[40%]" />
          </span>
          {shipName(last.ship)}
        </span>
      )}
    </motion.div>
  )
}

/* ---------------------------------------------------------------- bateaux */

function SeaShipView({ s, reduce }: { s: SeaShip; reduce: boolean | null }) {
  const { ship, look, accent, fresh } = s
  if (look === 'sunk') {
    return (
      <motion.div
        className="pointer-events-none absolute p-[0.6%]"
        style={shipBox(ship)}
        initial={fresh && !reduce ? { rotate: 0, y: 0, filter: 'grayscale(0) brightness(1)' } : false}
        animate={{ rotate: -4, y: 2, filter: 'grayscale(0.85) brightness(0.62)' }}
        transition={fresh ? { delay: LAND + 0.25, duration: 1.2, ease: 'easeIn' } : { duration: 0 }}
      >
        <ShipSvg id={ship.id} dir={ship.dir} accent={accent} />
        {fresh && !reduce &&
          [0, 1, 2, 3].map((i) => (
            <motion.span
              key={i}
              className="absolute size-[14%] min-h-1 min-w-1 rounded-full border border-white/80 bg-white/30"
              style={ship.dir === 'h' ? { left: `${15 + i * 22}%`, top: '40%' } : { top: `${15 + i * 22}%`, left: '40%' }}
              initial={{ y: 0, opacity: 0 }}
              animate={{ y: -18, opacity: [0, 1, 0] }}
              transition={{ delay: LAND + 0.6 + i * 0.15, duration: 0.9 }}
            />
          ))}
      </motion.div>
    )
  }
  return (
    <motion.div
      className={cn('pointer-events-none absolute p-[0.6%]', look === 'revealed' && 'rounded-md outline-[3px] outline-offset-[-2px] outline-sun outline-dashed')}
      style={shipBox(ship)}
      initial={look === 'revealed' && !reduce ? { opacity: 0, scale: 0.6 } : false}
      animate={look === 'revealed' ? { opacity: 0.85, scale: 1 } : { opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 18 }}
    >
      <ShipSvg id={ship.id} dir={ship.dir} accent={accent} />
    </motion.div>
  )
}

/* ---------------------------------------------------------------- grille */

/** Une mer 10 × 10 avec ses coordonnées. Mémoïsée : DuelPlay se re-rend 4×/s (chrono). */
export const Sea = memo(function Sea({
  shots,
  ships,
  target,
  onCell,
  interactive,
  onCellPointerDown,
  onHover,
  fx,
  size = 'lg',
  glow,
  fog,
  children,
  seaRef,
  label,
  className,
}: SeaProps) {
  const reduce = useReducedMotion()
  const [scope, animate] = useAnimate<HTMLDivElement>()
  const res = useMemo(() => {
    const m = new Map<number, BnShotResult>()
    for (const s of shots) m.set(cellIndex(s.x, s.y), s.r)
    return m
  }, [shots])
  const freshIdx = fx ? cellIndex(fx.last.x, fx.last.y) : -1
  const freshSunk = useMemo(() => {
    const out = new Set<number>()
    const f = ships?.find((s) => s.fresh)
    for (const [x, y] of (f && shipCells(f.ship)) || []) out.add(cellIndex(x, y))
    return out
  }, [ships])
  const sunkAccent = ships?.find((s) => s.fresh)?.accent ?? '#FFB703'

  // Secousse de la grille quand ça explose.
  const fxKey = fx?.key ?? null
  const fxR = fx?.last.r ?? null
  useEffect(() => {
    if (fxKey === null || fxR === 'miss' || reduce || !scope.current) return
    const big = fxR === 'sunk'
    void animate(
      scope.current,
      { x: big ? [0, -10, 9, -7, 5, -2, 0] : [0, -6, 5, -3, 0], rotate: big ? [0, -1.2, 1, -0.5, 0] : [0, -0.5, 0.4, 0] },
      { duration: big ? 0.6 : 0.4, delay: LAND },
    )
  }, [fxKey, fxR, reduce, animate, scope])

  const lg = size === 'lg'
  const labelCls = cn('flex items-center justify-center font-display leading-none font-extrabold text-muted select-none', lg ? 'text-[11px]' : 'text-[8px]')

  return (
    <div ref={scope} className={cn('grid grid-cols-[1.15em_minmax(0,1fr)] gap-0.5', lg ? 'text-[11px]' : 'text-[8px]', className)}>
      <span aria-hidden />
      <div className="grid grid-cols-10" aria-hidden>
        {[...COLS].map((c) => (
          <span key={c} className={cn(labelCls, 'h-[1.3em]')}>
            {c}
          </span>
        ))}
      </div>
      <div className="grid grid-rows-10" aria-hidden>
        {Array.from({ length: SIZE }, (_, y) => (
          <span key={y} className={labelCls}>
            {y + 1}
          </span>
        ))}
      </div>
      <div
        ref={seaRef}
        role="group"
        aria-label={label}
        className={cn(
          'relative aspect-square rounded-lg shadow-sticker transition-shadow',
          lg ? 'ring-[3px] ring-ink' : 'ring-2 ring-ink',
        )}
        style={glow ? { boxShadow: `0 0 0 3px var(--ink), 0 0 0 7px ${glow}, 4px 4px 0 7px var(--ink)` } : undefined}
        onPointerLeave={onHover ? () => onHover(null) : undefined}
      >
        <div className="absolute inset-0 overflow-hidden rounded-lg" style={{ background: SEA_BG }} aria-hidden>
          <div className="absolute inset-0" style={{ backgroundImage: GRID_LINES, backgroundSize: '10% 10%' }} />
        </div>

        {target && (
          <>
            <div className="pointer-events-none absolute inset-y-0 bg-white/20" style={{ left: `${target.x * 10}%`, width: '10%' }} aria-hidden />
            <div className="pointer-events-none absolute inset-x-0 bg-white/20" style={{ top: `${target.y * 10}%`, height: '10%' }} aria-hidden />
          </>
        )}

        {ships?.map((s) => <SeaShipView key={s.ship.id} s={s} reduce={reduce} />)}

        {children}

        {shots.map((s) => {
          const i = cellIndex(s.x, s.y)
          const fresh = !reduce && !!fx && (i === freshIdx || (s.r === 'sunk' && freshSunk.has(i)))
          return (
            <span key={`${i}-${s.r}`} className="pointer-events-none absolute flex items-center justify-center" style={cellBox(s.x, s.y)}>
              <Marker r={s.r} fresh={fresh} delay={i === freshIdx ? LAND : LAND + 0.2} />
            </span>
          )
        })}

        {onCell && (
          <div className="absolute inset-0 grid grid-cols-10 grid-rows-10">
            {Array.from({ length: SIZE * SIZE }, (_, i) => {
              const x = i % SIZE
              const y = Math.floor(i / SIZE)
              const r = res.get(i)
              return (
                <button
                  key={i}
                  type="button"
                  disabled={!interactive}
                  aria-label={`${cellName(x, y)} : ${r ? RESULT_LABEL[r] : 'pas encore visée'}`}
                  className={cn(
                    'size-full rounded-[3px] outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-inset disabled:cursor-default',
                    interactive && !r && 'cursor-crosshair',
                  )}
                  onPointerDown={onCellPointerDown ? (e) => onCellPointerDown(e.pointerType) : undefined}
                  onPointerEnter={onHover ? (e) => e.pointerType === 'mouse' && onHover({ x, y }) : undefined}
                  onClick={() => onCell(x, y)}
                />
              )
            })}
          </div>
        )}

        {target && (
          <div className="pointer-events-none absolute z-30" style={cellBox(target.x, target.y)} aria-hidden>
            <motion.svg
              viewBox="0 0 100 100"
              className="absolute top-1/2 left-1/2 size-[170%] -translate-x-1/2 -translate-y-1/2"
              animate={reduce ? undefined : { rotate: 90, scale: [1, 0.88, 1] }}
              transition={{ rotate: { repeat: Infinity, duration: 4, ease: 'linear' }, scale: { repeat: Infinity, duration: 0.9 } }}
            >
              <g fill="none" strokeLinecap="round">
                <circle cx={50} cy={50} r={27} stroke="#fff" strokeWidth={11} />
                <path d="M50 8 V28 M50 72 V92 M8 50 H28 M72 50 H92" stroke="#fff" strokeWidth={11} />
                <circle cx={50} cy={50} r={27} stroke="#EF476F" strokeWidth={6} />
                <path d="M50 8 V28 M50 72 V92 M8 50 H28 M72 50 H92" stroke="#EF476F" strokeWidth={6} />
              </g>
            </motion.svg>
          </div>
        )}

        {fog}

        <AnimatePresence>{fx && <ShotFx key={fx.key} last={fx.last} />}</AnimatePresence>
        <AnimatePresence>{fx && fx.last.r === 'sunk' && <SunkBanner key={`b${fx.key}`} last={fx.last} accent={sunkAccent} />}</AnimatePresence>
      </div>
    </div>
  )
})
