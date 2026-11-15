import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { ChibiImage } from '@/components/ui/ChibiImage'
import { burst } from '@/components/ui/confetti'
import { mood, pickExpression } from '@/features/soiree/players'
import { fx } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import type { DuelBoardProps } from '@/features/duel/types'
import type { PlayerInfo } from '@/games/types'
import { Mark, symEmoji, symName } from './Mark'
import { bubbleAnchor, cellRC, moveError, needsConfirm, playableBoards, symOf, type Grid, type Sym } from './logic'
import { notePointer, useTouch } from './pointer'
import { playCapture, playScribble } from './sound'
import type { MorpionBoard, MorpionMove } from './types'

const tint = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`

/* -------------------------------------------------------------------------- */
/* Géométrie commune (viewBox = n × 100 unités ; centre de la case i)          */
/* -------------------------------------------------------------------------- */

const center = (i: number, n: number): [number, number] => [((i % n) + 0.5) * 100, (Math.floor(i / n) + 0.5) * 100]

/** Milieu (0..1) du premier segment gagnant, pour lancer les confettis au bon endroit. */
function segmentMid(seg: number[], n: number): [number, number] {
  const [x1, y1] = center(seg[0], n)
  const [x2, y2] = center(seg[seg.length - 1], n)
  return [(x1 + x2) / 2 / (n * 100), (y1 + y2) / 2 / (n * 100)]
}

/** Lignes de la grille (traits « à main levée » si `wobble`). Épaisseur en px (non mise à l'échelle). */
function GridLines({ n, width, wobble, opacity = 1 }: { n: number; width: number; wobble?: boolean; opacity?: number }) {
  const size = n * 100
  const paths: string[] = []
  for (let k = 1; k < n; k++) {
    const p = k * 100
    if (wobble) {
      paths.push(`M ${p - 2} 6 C ${p + 4} ${size * 0.32}, ${p - 4} ${size * 0.68}, ${p + 1} ${size - 6}`)
      paths.push(`M 6 ${p + 2} C ${size * 0.32} ${p - 4}, ${size * 0.68} ${p + 4}, ${size - 6} ${p - 1}`)
    } else {
      paths.push(`M ${p} 0 L ${p} ${size}`, `M 0 ${p} L ${size} ${p}`)
    }
  }
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="pointer-events-none absolute inset-0 size-full overflow-visible text-text" aria-hidden>
      {paths.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="currentColor" strokeOpacity={opacity} strokeWidth={width} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  )
}

/** Trait de victoire qui barre le(s) alignement(s), aux couleurs du gagnant. */
function WinLines({ segs, n, color, width, delay, under }: { segs: number[][]; n: number; color: string; width: number; delay: number; under?: boolean }) {
  const reduce = useReducedMotion()
  const size = n * 100
  const ext = 34
  const ds = segs.map((seg) => {
    const [x1, y1] = center(seg[0], n)
    const [x2, y2] = center(seg[seg.length - 1], n)
    const len = Math.hypot(x2 - x1, y2 - y1) || 1
    const ux = (x2 - x1) / len
    const uy = (y2 - y1) / len
    return `M ${x1 - ux * ext} ${y1 - uy * ext} L ${x2 + ux * ext} ${y2 + uy * ext}`
  })
  const layer = (outline: boolean) =>
    ds.map((d, i) => (
      <motion.path
        key={`${outline}-${i}`}
        d={d}
        fill="none"
        stroke={outline ? 'var(--ink)' : color}
        strokeWidth={outline ? width + 6 : width}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        initial={reduce ? false : { pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ pathLength: { duration: 0.5, delay: delay + i * 0.25, ease: 'easeInOut' }, opacity: { duration: 0.01, delay: delay + i * 0.25 } }}
      />
    ))
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className={cn('pointer-events-none absolute inset-0 size-full overflow-visible', !under && 'z-20')} aria-hidden>
      {layer(true)}
      {layer(false)}
    </svg>
  )
}

/** Pastille ronde avec mini-chibi (signature d'un symbole / d'un petit morpion gagné). */
function ChibiBadge({ player, color, expression, className, pop }: { player: PlayerInfo; color: string; expression: string; className?: string; pop?: boolean }) {
  const reduce = useReducedMotion()
  return (
    <motion.span
      initial={pop && !reduce ? { scale: 0, rotate: -30 } : false}
      animate={{ scale: 1, rotate: 0 }}
      transition={{ type: 'spring', stiffness: 420, damping: 14, delay: pop ? 0.35 : 0 }}
      className={cn('pointer-events-none absolute flex items-end justify-center overflow-hidden rounded-full border-2 border-ink shadow-sticker-sm', className)}
      style={{ background: color }}
      aria-hidden
    >
      <ChibiImage slug={player.slug} expression={expression} tenue={player.equippedTenue} size={40} thumb bare className="h-[92%]! w-[92%]!" />
    </motion.span>
  )
}

/* -------------------------------------------------------------------------- */
/* Case                                                                        */
/* -------------------------------------------------------------------------- */

interface CellProps {
  i: number
  value: Sym | null
  color: string
  /** Symbole fantôme (visée / envoi en cours). */
  ghost: Sym | null
  ghostColor: string
  /** Visée tactile : il faut retoucher pour jouer. */
  armed: boolean
  /** Bulle « Retouche » de la case visée : ancrage horizontal, et sous la case (1re rangée) plutôt qu'au-dessus. */
  bubble: { anchor: 'left' | 'center' | 'right'; below: boolean } | null
  isLast: boolean
  /** Dernier coup très visible (géant : beaucoup de cases). */
  strongLast: boolean
  win: boolean
  dim: boolean
  /** Tracer le symbole (coup qui vient d'arriver). */
  draw: boolean
  disabled: boolean
  weight: number
  label: string
  /** Mini-chibi en signature (classique). */
  badge: ReactNode
  onPick: (i: number) => void
  onAim: (i: number | null, pointerType: string) => void
  onPointer: (pointerType: string) => void
}

const Cell = memo(function Cell({ i, value, color, ghost, ghostColor, armed, bubble, isLast, strongLast, win, dim, draw, disabled, weight, label, badge, onPick, onAim, onPointer }: CellProps) {
  const reduce = useReducedMotion()
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onPointerDown={(e) => onPointer(e.pointerType)}
      onPointerEnter={(e) => onAim(i, e.pointerType)}
      onClick={() => onPick(i)}
      className={cn('relative aspect-square min-w-0 rounded-[18%] outline-offset-[-3px]', disabled ? 'cursor-default' : 'cursor-pointer')}
      style={armed ? { background: tint(ghostColor, 28), boxShadow: `inset 0 0 0 2px ${ghostColor}` } : undefined}
    >
      {isLast && !win && (
        <span className={cn('pointer-events-none absolute inset-[7%] rounded-[22%] ring-2', strongLast ? 'bg-sun/50 ring-sun' : 'bg-sun/25 ring-sun/60')} aria-hidden />
      )}
      {value ? (
        <motion.span
          className={cn('pointer-events-none absolute inset-[13%] block', dim && 'opacity-35')}
          animate={win && !reduce ? { scale: [1, 1.14, 1] } : undefined}
          transition={win ? { repeat: Infinity, duration: 0.7, ease: 'easeInOut' } : undefined}
        >
          <Mark sym={value} color={color} draw={draw} weight={weight} />
        </motion.span>
      ) : ghost ? (
        <span className={cn('pointer-events-none absolute inset-[13%] block', armed ? 'opacity-60' : 'opacity-35')}>
          <Mark sym={ghost} color={ghostColor} weight={weight} />
        </span>
      ) : null}
      {badge}
      {bubble && (
        // Dans le bouton : la toucher joue aussi la case. Posée sur le plateau, elle reste
        // visible quand le défilement aligne le bas du plateau sur le bas de l'écran.
        <motion.span
          initial={reduce ? false : { scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 520, damping: 18 }}
          className={cn(
            'absolute z-30 rounded-full border-2 border-ink bg-sun px-2 py-0.5 font-display text-xs leading-tight font-extrabold whitespace-nowrap text-[#1f1b2e] shadow-sticker-sm',
            bubble.below ? 'top-[calc(100%+3px)]' : 'bottom-[calc(100%+3px)]',
            bubble.anchor === 'left' ? 'left-0' : bubble.anchor === 'right' ? 'right-0' : 'left-1/2 -translate-x-1/2',
          )}
        >
          Retouche pour jouer ✍️
        </motion.span>
      )}
    </button>
  )
})

/* -------------------------------------------------------------------------- */
/* Légende : qui a les ❌ / les ⭕                                             */
/* -------------------------------------------------------------------------- */

function Legend({ board, duel, phase, me, get, colorOf }: Pick<DuelBoardProps<MorpionBoard, MorpionMove>, 'board' | 'duel' | 'phase' | 'me' | 'get'> & { colorOf: (id: string) => string }) {
  const reduce = useReducedMotion()
  const finished = phase === 'result'
  return (
    <div className="grid grid-cols-2 gap-2">
      {/* Même ordre que le face-à-face du socle : a à gauche, b à droite. */}
      {[board.a, board.b].map((id, side) => {
        const sym: Sym = id === board.x ? 'x' : 'o'
        const p = get(id)
        const color = colorOf(id)
        const active = phase === 'playing' && duel.turn === id
        const expr = finished
          ? duel.outcome === 'draw'
            ? mood(p, 'shocked')
            : duel.winner === id
              ? pickExpression(p, 'cool', 'pouces', 'joie')
              : mood(p, 'sad')
          : active
            ? mood(p, 'think')
            : p.equipped
        return (
          <motion.div
            key={side}
            animate={active && !reduce ? { y: [0, -3, 0] } : { y: 0 }}
            transition={active ? { repeat: Infinity, duration: 0.9 } : undefined}
            className={cn(
              'flex min-w-0 items-center gap-1.5 rounded-full border-[3px] border-ink py-0.5 pr-2.5 pl-1',
              active ? 'shadow-sticker-sm' : 'bg-surface',
              side === 1 && 'flex-row-reverse pr-1 pl-2.5',
            )}
            style={active ? { background: tint(color, 38) } : undefined}
            aria-label={`${id === me ? 'Toi' : p.nickname} : ${symName(sym)}${sym === 'x' ? ' (commence)' : ''}`}
          >
            <span className="relative flex size-8 shrink-0 items-end justify-center overflow-hidden rounded-full border-2 border-ink" style={{ background: color }}>
              <ChibiImage slug={p.slug} expression={expr} tenue={p.equippedTenue} size={32} thumb bare className={cn('h-[94%]! w-[94%]!', side === 1 && '-scale-x-100')} />
            </span>
            <span className="size-6 shrink-0">
              <Mark sym={sym} color={color} weight={13} />
            </span>
            <span className={cn('min-w-0 flex-1 truncate font-display text-sm leading-tight font-extrabold', side === 1 && 'text-right', id === me && 'text-grape')}>
              {id === me ? 'Toi' : p.nickname}
            </span>
          </motion.div>
        )
      })}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Plateau                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Plateau du Morpion (3 variantes). Souris : survol + clic. Tactile : en
 * classique, un toucher joue ; en géant / ultime (petites cases), un toucher
 * vise et un second toucher sur la même case joue. Aucun geste ne capture le
 * défilement : la page reste défilable, le plateau revient à l'écran à ton tour.
 */
export default function MorpionBoardView({ board, me, isMyTurn, onMove, pending, duel, phase, get, colors }: DuelBoardProps<MorpionBoard, MorpionMove>) {
  const reduce = useReducedMotion()
  const areaRef = useRef<HTMLDivElement>(null)
  /** Plateau + consigne : ce qui doit être à l'écran à mon tour. */
  const scrollRef = useRef<HTMLDivElement>(null)
  const touch = useTouch()
  const pointerType = useRef('mouse')
  const [hover, setHover] = useState<number | null>(null)
  const [armed, setArmed] = useState<number | null>(null)
  const [sent, setSent] = useState<number | null>(null)
  const [nudge, setNudge] = useState(0)

  const ult = board.variant === 'ultimate'
  const n = board.size
  const grid: Grid = { variant: board.variant, size: n, align: board.align, cells: board.cells, boards: board.boards, next: board.next }
  const finished = phase === 'result'
  const interactive = isMyTurn && !pending && phase === 'playing'
  const needConfirm = board.variant !== 'classic'
  const mySym = symOf(board, me)
  const colorOf = useCallback((id: string) => (id === board.a ? colors.a : colors.b), [board.a, colors.a, colors.b])
  const colorOfSym = (s: Sym) => colorOf(s === 'x' ? board.x : board.o)
  const myColor = colorOf(me)
  const turnColor = duel.turn ? colorOf(duel.turn) : myColor
  const winnerSym = finished && duel.outcome === 'win' ? symOf(board, duel.winner) : null
  const lineSet = new Set(ult ? [] : (board.lines ?? []).flat())
  const boardLineSet = new Set(ult ? (board.lines ?? []).flat() : [])
  const playable = new Set(ult && phase === 'playing' ? playableBoards(grid) : [])
  const roundKey = `${duel.no}-${duel.game_no}`

  // La visée / l'envoi n'ont plus de sens dès que le plateau ou le tour change.
  const resetKey = `${roundKey}-${board.count}-${isMyTurn}`
  const [lastResetKey, setLastResetKey] = useState(resetKey)
  if (resetKey !== lastResetKey) {
    setLastResetKey(resetKey)
    setArmed(null)
    setSent(null)
    setHover(null)
  }

  /* ---- sons : un « scritch » par symbole tracé, un carillon par petit morpion gagné ---- */
  const prev = useRef({ key: roundKey, count: board.count, boards: board.boards })
  useEffect(() => {
    const p = prev.current
    if (p.key === roundKey && board.count > p.count && board.last) {
      const s = board.cells[board.last.cell]
      if (s) playScribble(s)
      if (board.boards && p.boards && board.boards.some((v, i) => (v === 'x' || v === 'o') && p.boards?.[i] !== v)) playCapture(0.32)
    }
    prev.current = { key: roundKey, count: board.count, boards: board.boards }
  }, [roundKey, board.count, board.boards, board.cells, board.last])

  /* ---- victoire : confettis là où la ligne se trace (une fois par manche) ---- */
  const celebrated = useRef<string | null>(null)
  useEffect(() => {
    const seg = board.lines?.[0]
    if (!seg || celebrated.current === roundKey) return
    celebrated.current = roundKey
    const lineN = ult ? 3 : n
    window.setTimeout(
      () => {
        const r = areaRef.current?.getBoundingClientRect()
        if (!r || typeof window === 'undefined') return
        const [mx, my] = segmentMid(seg, lineN)
        burst({ x: (r.left + mx * r.width) / window.innerWidth, y: (r.top + my * r.height) / window.innerHeight }, 70)
      },
      reduce ? 50 : 900,
    )
  }, [board.lines, roundKey, ult, n, reduce])

  /* ---- à mon tour : le plateau ET sa consigne reviennent à l'écran s'ils en dépassent (petits téléphones) ---- */
  useEffect(() => {
    if (!isMyTurn) return
    // Petit délai : laisser la mise en page se stabiliser (entrée du face-à-face, consigne…).
    const t = window.setTimeout(() => {
      const el = scrollRef.current
      if (!el || typeof el.scrollIntoView !== 'function') return
      const r = el.getBoundingClientRect()
      if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' })
    }, 350)
    return () => clearTimeout(t)
  }, [isMyTurn, reduce])

  /* ---- interactions ---- */
  const pick = (i: number) => {
    if (!interactive) return
    const err = moveError(grid, i)
    if (err) {
      fx.fail()
      if (err === 'wrong_board' || err === 'board_closed') setNudge((k) => k + 1)
      setArmed(null)
      return
    }
    if (needConfirm && pointerType.current !== 'mouse' && armed !== i) {
      fx.tick()
      setArmed(i)
      return
    }
    setArmed(null)
    setSent(i)
    onMove({ cell: i })
  }
  // Gestionnaires stables pour les cases mémoïsées (la dernière version de `pick` via une ref).
  const pickRef = useRef(pick)
  useLayoutEffect(() => {
    pickRef.current = pick
  })
  const onPick = useCallback((i: number) => pickRef.current(i), [])
  const onAim = useCallback((i: number | null, pt: string) => {
    if (pt === 'mouse') setHover(i)
  }, [])
  const onPointer = useCallback((pt: string) => {
    pointerType.current = pt
    notePointer(pt)
  }, [])

  const target = interactive ? (armed ?? hover) : null
  const ghostCell = pending && sent !== null ? sent : target !== null && moveError(grid, target) === null ? target : null

  const lastBy = board.last ? board.last.cell : -1
  const cellWeight = board.variant === 'classic' ? 10 : board.variant === 'giant' ? 13 : 12

  const bubbleFor = (i: number) => {
    const [r, c] = cellRC(board.variant, n, i)
    return { anchor: bubbleAnchor(c, n), below: r === 0 }
  }

  const renderCell = (i: number) => {
    const v = board.cells[i] ?? null
    const win = finished && !!v && (ult ? false : lineSet.has(i))
    const owner = v ? (v === 'x' ? board.x : board.o) : null
    let label: string
    if (ult) label = `Petit morpion ${Math.floor(i / 9) + 1}, case ${(i % 9) + 1} : ${symName(v)}`
    else label = `Ligne ${Math.floor(i / n) + 1}, colonne ${(i % n) + 1} : ${symName(v)}`
    let badge: ReactNode = null
    if (board.variant === 'classic' && owner) {
      const p = get(owner)
      const expr = finished && duel.outcome === 'win' ? (owner === duel.winner ? pickExpression(p, 'cool', 'pouces', 'joie') : mood(p, 'sad')) : p.equipped
      badge = <ChibiBadge player={p} color={colorOf(owner)} expression={expr} pop={i === lastBy} className="right-[5%] bottom-[5%] size-[30%]" />
    }
    return (
      <Cell
        key={i}
        i={i}
        value={v}
        color={v ? colorOfSym(v) : myColor}
        ghost={ghostCell === i && mySym ? mySym : null}
        ghostColor={myColor}
        armed={interactive && armed === i}
        bubble={interactive && armed === i ? bubbleFor(i) : null}
        isLast={i === lastBy && !finished}
        strongLast={board.variant === 'giant'}
        win={win}
        dim={finished && !!winnerSym && !ult && !lineSet.has(i)}
        draw={i === lastBy}
        disabled={!interactive}
        weight={cellWeight}
        label={label}
        badge={badge}
        onPick={onPick}
        onAim={onAim}
        onPointer={onPointer}
      />
    )
  }

  /* ---- rendu : classique / géant ---- */
  let body: ReactNode
  if (!ult) {
    body = (
      <div ref={areaRef} className="relative" onPointerLeave={() => setHover(null)}>
        <GridLines n={n} width={board.variant === 'classic' ? 6 : 1.25} wobble={board.variant === 'classic'} opacity={board.variant === 'classic' ? 0.9 : 0.3} />
        {board.lines && winnerSym && board.variant === 'giant' && <WinLines key={roundKey} segs={board.lines} n={n} color={colorOfSym(winnerSym)} width={5} delay={0.35} under />}
        <div className="relative grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
          {board.cells.map((_, i) => renderCell(i))}
        </div>
        {board.lines && winnerSym && board.variant === 'classic' && <WinLines key={roundKey} segs={board.lines} n={n} color={colorOfSym(winnerSym)} width={9} delay={0.35} />}
      </div>
    )
  } else {
    /* ---- rendu : ultime (9 petits morpions) ---- */
    body = (
      <div ref={areaRef} className="relative" onPointerLeave={() => setHover(null)}>
        <GridLines n={3} width={4.5} wobble opacity={0.9} />
        <div className="relative grid grid-cols-3">
          {Array.from({ length: 9 }, (_, b) => {
            const status = board.boards?.[b] ?? null
            const open = status === null
            const isPlayable = playable.has(b)
            const forced = phase === 'playing' && board.next !== null
            const inLine = finished && boardLineSet.has(b)
            const fade = (phase === 'playing' && forced && !isPlayable) || (finished && !!board.lines && !inLine)
            const wonBy: Sym | null = status === 'x' || status === 'o' ? status : null
            const owner = wonBy ? (wonBy === 'x' ? board.x : board.o) : null
            const justWon = !!owner && board.last !== null && Math.floor(board.last.cell / 9) === b
            return (
              <div key={b} className="relative aspect-square p-[6%]">
                {isPlayable && (
                  <motion.div
                    key={`hl-${nudge}`}
                    className="pointer-events-none absolute inset-[3%] rounded-[14%]"
                    style={{ background: tint(turnColor, forced ? 30 : 16), boxShadow: `inset 0 0 0 ${forced ? 3 : 2}px ${tint(turnColor, forced ? 100 : 55)}` }}
                    initial={nudge && !reduce ? { scale: 1.12 } : false}
                    animate={forced && !reduce ? { scale: 1, opacity: [0.65, 1, 0.65] } : { scale: 1, opacity: 1 }}
                    transition={forced ? { opacity: { repeat: Infinity, duration: 1.2 }, scale: { type: 'spring', stiffness: 500, damping: 12 } } : { type: 'spring', stiffness: 500, damping: 12 }}
                    aria-hidden
                  />
                )}
                <div className={cn('relative grid grid-cols-3 transition-opacity', (!open || fade) && (open ? 'opacity-55' : 'opacity-25'))}>
                  <GridLines n={3} width={1.5} opacity={0.45} />
                  {Array.from({ length: 9 }, (_, k) => renderCell(9 * b + k))}
                </div>
                {owner && wonBy && (
                  <motion.div
                    className="pointer-events-none absolute inset-[5%]"
                    animate={inLine && !reduce ? { scale: [1, 1.08, 1] } : undefined}
                    transition={inLine ? { repeat: Infinity, duration: 0.8 } : undefined}
                  >
                    <Mark sym={wonBy} color={colorOf(owner)} draw={justWon} delay={0.25} weight={10} className={cn(finished && !!board.lines && !inLine && 'opacity-40')} />
                    <ChibiBadge
                      player={get(owner)}
                      color={colorOf(owner)}
                      expression={pickExpression(get(owner), 'cool', 'pouces', 'joie')}
                      pop={justWon}
                      className="right-0 bottom-0 size-[34%]"
                    />
                  </motion.div>
                )}
                {status === 'draw' && (
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
                    <span className="rounded-full border-2 border-ink bg-surface px-1.5 font-display text-xs font-extrabold text-muted shadow-sticker-sm">nul</span>
                  </span>
                )}
              </div>
            )
          })}
        </div>
        {board.lines && winnerSym && <WinLines key={roundKey} segs={board.lines} n={3} color={colorOfSym(winnerSym)} width={10} delay={0.6} />}
      </div>
    )
  }

  /* ---- consigne sous le plateau (incluse dans le retour à l'écran ; la bulle « Retouche » est, elle, sur le plateau) ---- */
  let hint: ReactNode = null
  if (phase === 'playing') {
    const turnP = duel.turn ? get(duel.turn) : null
    const turnSym = symOf(board, duel.turn)
    if (interactive && armed !== null) hint = <span className="font-extrabold">Retouche la case (ou la bulle) pour jouer ✍️</span>
    // Consigne du double toucher : au doigt seulement (à la souris, un clic joue).
    else if (isMyTurn && needsConfirm(board.variant, touch) && board.count < 2) hint = 'Touche une case pour viser, retouche-la pour jouer.'
    else if (!isMyTurn && ult && turnP)
      hint = board.next === null ? `${symEmoji(turnSym)} ${turnP.nickname} peut jouer n’importe où.` : `${symEmoji(turnSym)} ${turnP.nickname} doit jouer dans le petit morpion en surbrillance.`
    else if (!isMyTurn && board.count === 0)
      hint = board.variant === 'giant' ? 'Aligne 5 symboles (ou plus) pour gagner la manche.' : 'Aligne 3 symboles (ligne, colonne ou diagonale) pour gagner.'
  }

  return (
    <div className={cn('mx-auto flex w-full flex-col gap-2 select-none', board.variant === 'classic' ? 'max-w-[22rem]' : 'max-w-[26rem]')}>
      <Legend board={board} duel={duel} phase={phase} me={me} get={get} colorOf={colorOf} />
      <div ref={scrollRef} className="flex scroll-my-4 flex-col gap-2">
        <div className={cn('relative rounded-[1.4rem] border-[3px] border-ink bg-surface shadow-sticker-lg', board.variant === 'classic' ? 'p-2' : 'p-1')}>{body}</div>
        {hint && (
          <p className="text-center text-sm leading-snug text-muted" aria-live="polite">
            {hint}
          </p>
        )}
      </div>
    </div>
  )
}
