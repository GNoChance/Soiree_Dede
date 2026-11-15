import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { motion } from 'framer-motion'
import { Eraser, Pencil, Trash2, Undo2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { fx } from '@/lib/feedback'
import { ConfirmModal } from '@/features/soiree/components'
import { useDrawChannel } from './channel'
import { ERASER_SIZE, PALETTE, SIZES } from './setup'
import type { DrawMessage, Stroke, StrokeChunk } from './types'

/**
 * Canvas de dessin temps réel.
 * - Dessinateur : pointer events (doigt / stylet / souris), points normalisés 0-1,
 *   envoyés par paquets toutes les ~40 ms sur le canal broadcast `match:<id>`.
 * - Spectateurs : rejouent les points reçus avec une animation (file d'attente
 *   vidée progressivement à chaque frame), rattrapage via `sync_request` → `sync`.
 * Les traits du tour sont gardés en mémoire (module) : un remontage du composant
 * ne les perd pas ; un rechargement de page les redemande aux autres.
 */

export interface CanvasHandle {
  /** Image JPEG (dataURL) du dessin complet du tour, ou null si vide. */
  snapshot: (width?: number) => string | null
  strokeCount: () => number
}

interface Props {
  matchId: string
  turn: number
  meId: string
  isDrawer: boolean
  /** Phase de dessin en cours (sinon lecture seule). */
  active: boolean
  className?: string
  ref?: Ref<CanvasHandle>
}

const BG = '#ffffff'
const FLUSH_MS = 40
const ROUND = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000

/* ------------------------------ modèle partagé ----------------------------- */

const models = new Map<string, Stroke[]>()
function modelFor(matchId: string, turn: number): Stroke[] {
  const k = `${matchId}:${turn}`
  let m = models.get(k)
  if (!m) {
    m = []
    models.set(k, m)
    // On ne garde que les derniers tours en mémoire.
    if (models.size > 6) models.delete(models.keys().next().value as string)
  }
  return m
}
function setModel(matchId: string, turn: number, strokes: Stroke[]) {
  models.set(`${matchId}:${turn}`, strokes)
}

/* --------------------------------- rendu ---------------------------------- */

function styleFor(ctx: CanvasRenderingContext2D, s: Stroke, W: number) {
  ctx.strokeStyle = s.e ? BG : s.c
  ctx.fillStyle = s.e ? BG : s.c
  ctx.lineWidth = Math.max(1, s.w * W)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
}

/** Dessine les points [from, to) du trait (lissage quadratique par milieux). */
function drawRange(ctx: CanvasRenderingContext2D, s: Stroke, from: number, to: number, W: number, H: number) {
  const n = Math.min(to, s.p.length / 2)
  if (n <= 0 || from >= n) return
  styleFor(ctx, s, W)
  const X = (i: number) => s.p[i * 2] * W
  const Y = (i: number) => s.p[i * 2 + 1] * H
  if (n === 1) {
    ctx.beginPath()
    ctx.arc(X(0), Y(0), ctx.lineWidth / 2, 0, Math.PI * 2)
    ctx.fill()
    return
  }
  const mx = (i: number) => (X(i) + X(i + 1)) / 2
  const my = (i: number) => (Y(i) + Y(i + 1)) / 2
  ctx.beginPath()
  const start = Math.max(1, from - 1)
  if (start <= 1) {
    ctx.moveTo(X(0), Y(0))
    ctx.lineTo(mx(0), my(0))
  } else {
    ctx.moveTo(mx(start - 1), my(start - 1))
  }
  for (let i = Math.max(1, start); i <= n - 2; i++) ctx.quadraticCurveTo(X(i), Y(i), mx(i), my(i))
  ctx.lineTo(X(n - 1), Y(n - 1))
  ctx.stroke()
}

function renderAll(ctx: CanvasRenderingContext2D, strokes: Stroke[], W: number, H: number, drawn?: Map<string, number>) {
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, W, H)
  for (const s of strokes) drawRange(ctx, s, 0, drawn ? (drawn.get(s.id) ?? 0) : s.p.length / 2, W, H)
}

/** Rendu complet hors écran (snapshot pour la galerie). */
export function renderStrokesToDataUrl(strokes: Stroke[], width = 480): string | null {
  if (!strokes.length) return null
  const c = document.createElement('canvas')
  c.width = width
  c.height = Math.round((width * 3) / 4)
  const ctx = c.getContext('2d')
  if (!ctx) return null
  renderAll(ctx, strokes, c.width, c.height)
  try {
    return c.toDataURL('image/jpeg', 0.72)
  } catch {
    return null
  }
}

const rid = () => Math.random().toString(36).slice(2, 9)

/* ------------------------------- composant -------------------------------- */

export default function DrawCanvas({ matchId, turn, meId, isDrawer, active, className, ref }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sizeRef = useRef({ W: 0, H: 0, dpr: 1 })
  const strokesRef = useRef<Stroke[]>(modelFor(matchId, turn))
  const drawnRef = useRef(new Map<string, number>())
  const fullRef = useRef(true)
  const rafRef = useRef(0)
  const turnRef = useRef(turn)
  const drawerRef = useRef(isDrawer)
  // Envoi par paquets : id -> nombre de points déjà envoyés.
  const sentRef = useRef(new Map<string, number>())
  const dirtyRef = useRef(new Set<string>())
  const currentRef = useRef<{ id: string; pointer: number } | null>(null)
  const syncSeenRef = useRef(0)
  const lastSyncReqRef = useRef(0)

  const [color, setColor] = useState<string>(PALETTE[0])
  const [size, setSize] = useState(1)
  const [eraser, setEraser] = useState(false)
  const [count, setCount] = useState(() => modelFor(matchId, turn).length)
  const [confirmClear, setConfirmClear] = useState(false)

  useEffect(() => {
    drawerRef.current = isDrawer
  }, [isDrawer])

  /* --------------------------- boucle d'animation -------------------------- */
  const schedule = useCallback(() => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(function frame() {
      rafRef.current = 0
      const ctx = canvasRef.current?.getContext('2d')
      const { W, H, dpr } = sizeRef.current
      if (!ctx || !W) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const strokes = strokesRef.current
      const drawn = drawnRef.current
      const instant = drawerRef.current
      if (fullRef.current) {
        fullRef.current = false
        if (instant) for (const s of strokes) drawn.set(s.id, s.p.length / 2)
        renderAll(ctx, strokes, W, H, drawn)
      }
      // Budget de points par frame : rejoue en accélérant si on est en retard.
      let remaining = 0
      for (const s of strokes) remaining += s.p.length / 2 - (drawn.get(s.id) ?? 0)
      if (remaining <= 0) return
      let budget = instant ? Infinity : Math.max(3, Math.ceil(remaining * 0.06))
      for (const s of strokes) {
        if (budget <= 0) break
        const len = s.p.length / 2
        const d = drawn.get(s.id) ?? 0
        if (d >= len) continue
        const next = Math.min(len, d + budget)
        budget -= next - d
        drawRange(ctx, s, d, next, W, H)
        drawn.set(s.id, next)
      }
      if (budget <= 0 || !instant) rafRef.current = requestAnimationFrame(frame)
    })
  }, [])

  const redrawAll = useCallback(() => {
    fullRef.current = true
    schedule()
  }, [schedule])

  /* ------------------------------ changement de tour ------------------------ */
  useEffect(() => {
    turnRef.current = turn
    strokesRef.current = modelFor(matchId, turn)
    drawnRef.current = new Map()
    sentRef.current = new Map(strokesRef.current.map((s) => [s.id, s.p.length / 2]))
    dirtyRef.current = new Set()
    currentRef.current = null
    setCount(strokesRef.current.length)
    redrawAll()
  }, [matchId, turn, redrawAll])

  /* ------------------------------- dimensions ------------------------------ */
  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const resize = () => {
      const W = wrap.clientWidth
      if (!W) return
      const H = Math.round((W * 3) / 4)
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5)
      if (W === sizeRef.current.W && dpr === sizeRef.current.dpr) return
      sizeRef.current = { W, H, dpr }
      canvas.width = Math.round(W * dpr)
      canvas.height = Math.round(H * dpr)
      canvas.style.width = `${W}px`
      canvas.style.height = `${H}px`
      // Après un redimensionnement, tout ce qui était déjà tracé est redessiné d'un coup.
      redrawAll()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [redrawAll])

  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  /* -------------------------------- réseau -------------------------------- */
  const { send, joined } = useDrawChannel(
    matchId,
    (msg: DrawMessage) => {
      const t = turnRef.current
      if (msg.payload.turn !== t) return
      const strokes = strokesRef.current
      switch (msg.event) {
        case 'pts': {
          if (drawerRef.current) return
          let gap = false
          for (const op of msg.payload.ops) if (!applyChunk(strokes, op)) gap = true
          setCount(strokes.length)
          schedule()
          if (gap) requestSync(false)
          break
        }
        case 'undo': {
          if (drawerRef.current) return
          const i = strokes.findIndex((s) => s.id === msg.payload.id)
          if (i >= 0) strokes.splice(i, 1)
          setCount(strokes.length)
          redrawAll()
          break
        }
        case 'clear': {
          if (drawerRef.current) return
          strokes.length = 0
          setCount(0)
          redrawAll()
          break
        }
        case 'sync_request': {
          if (msg.payload.from === meId) return
          if (drawerRef.current) {
            send({ event: 'sync', payload: { turn: t, from: meId, strokes } })
          } else if (msg.payload.fromDrawer && strokes.length) {
            // Le dessinateur a rechargé sa page : un spectateur lui renvoie le dessin.
            const seen = syncSeenRef.current
            window.setTimeout(() => {
              if (syncSeenRef.current === seen) send({ event: 'sync', payload: { turn: t, from: meId, strokes: strokesRef.current } })
            }, 150 + Math.random() * 700)
          }
          break
        }
        case 'sync': {
          syncSeenRef.current++
          if (drawerRef.current) {
            // Seulement pour reconstruire après un rechargement (canvas vide).
            if (strokes.length || !msg.payload.strokes.length) return
            const copy = msg.payload.strokes.map((s) => ({ ...s, p: s.p.slice() }))
            setModel(matchId, t, copy)
            strokesRef.current = copy
            sentRef.current = new Map(copy.map((s) => [s.id, s.p.length / 2]))
            setCount(copy.length)
            redrawAll()
            return
          }
          const incoming = msg.payload.strokes
          // Garde la progression d'animation des traits déjà connus.
          const known = new Map(strokes.map((s) => [s.id, s]))
          const next = incoming.map((s) => {
            const k = known.get(s.id)
            return k && k.p.length >= s.p.length ? k : { ...s, p: s.p.slice() }
          })
          setModel(matchId, t, next)
          strokesRef.current = next
          setCount(next.length)
          redrawAll()
          break
        }
        default:
          break
      }
    },
    () => requestSync(drawerRef.current),
  )

  function applyChunk(strokes: Stroke[], op: StrokeChunk): boolean {
    let s = strokes.find((x) => x.id === op.id)
    if (!s) {
      s = { id: op.id, c: op.c, w: op.w, e: op.e, p: [] }
      strokes.push(s)
    }
    const have = s.p.length / 2
    if (op.n > have) {
      s.p.push(...op.p)
      return false
    }
    const skip = (have - op.n) * 2
    if (skip < op.p.length) s.p.push(...op.p.slice(skip))
    return true
  }

  function requestSync(fromDrawer: boolean) {
    const now = Date.now()
    if (now - lastSyncReqRef.current < 1500) return
    if (fromDrawer && strokesRef.current.length) return
    lastSyncReqRef.current = now
    send({ event: 'sync_request', payload: { turn: turnRef.current, from: meId, fromDrawer } })
  }

  // Nouveau tour / passage en dessin : on demande l'état du dessin (rattrapage).
  useEffect(() => {
    if (!joined || !active) return
    lastSyncReqRef.current = 0
    requestSync(isDrawer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined, active, turn, isDrawer])

  // Envoi groupé des points du dessinateur.
  useEffect(() => {
    if (!isDrawer || !active) return
    const id = window.setInterval(() => {
      if (!dirtyRef.current.size) return
      const ops: StrokeChunk[] = []
      for (const sid of dirtyRef.current) {
        const s = strokesRef.current.find((x) => x.id === sid)
        if (!s) continue
        const sent = sentRef.current.get(sid) ?? 0
        const len = s.p.length / 2
        if (len <= sent) continue
        ops.push({ id: s.id, c: s.c, w: s.w, e: s.e, n: sent, p: s.p.slice(sent * 2) })
        sentRef.current.set(sid, len)
      }
      dirtyRef.current.clear()
      if (ops.length) send({ event: 'pts', payload: { turn: turnRef.current, ops } })
    }, FLUSH_MS)
    return () => clearInterval(id)
  }, [isDrawer, active, send])

  /* -------------------------------- saisie -------------------------------- */
  const canDraw = isDrawer && active

  const point = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect()
    return [ROUND((e.clientX - r.left) / r.width), ROUND((e.clientY - r.top) / r.height)] as const
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canDraw || currentRef.current) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const [x, y] = point(e)
    const s: Stroke = { id: rid(), c: color, w: eraser ? ERASER_SIZE : SIZES[size], e: eraser || undefined, p: [x, y] }
    strokesRef.current.push(s)
    currentRef.current = { id: s.id, pointer: e.pointerId }
    dirtyRef.current.add(s.id)
    setCount(strokesRef.current.length)
    schedule()
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cur = currentRef.current
    if (!cur || cur.pointer !== e.pointerId) return
    const s = strokesRef.current.find((x) => x.id === cur.id)
    if (!s) return
    const evs = typeof e.nativeEvent.getCoalescedEvents === 'function' ? e.nativeEvent.getCoalescedEvents() : []
    const list = evs.length ? evs : [e.nativeEvent]
    let added = false
    for (const ev of list) {
      const [x, y] = point(ev)
      const lx = s.p[s.p.length - 2]
      const ly = s.p[s.p.length - 1]
      if (Math.hypot(x - lx, y - ly) < 0.003) continue
      s.p.push(x, y)
      added = true
    }
    if (added) {
      dirtyRef.current.add(s.id)
      schedule()
    }
  }

  const onPointerEnd = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cur = currentRef.current
    if (!cur || cur.pointer !== e.pointerId) return
    currentRef.current = null
  }

  const undo = () => {
    const strokes = strokesRef.current
    const last = strokes.pop()
    if (!last) return
    fx.pop()
    sentRef.current.delete(last.id)
    dirtyRef.current.delete(last.id)
    setCount(strokes.length)
    redrawAll()
    send({ event: 'undo', payload: { turn: turnRef.current, id: last.id } })
  }

  const clear = () => {
    strokesRef.current.length = 0
    sentRef.current.clear()
    dirtyRef.current.clear()
    setCount(0)
    fx.whoosh()
    redrawAll()
    send({ event: 'clear', payload: { turn: turnRef.current } })
  }

  useImperativeHandle(
    ref,
    () => ({
      snapshot: (width?: number) => renderStrokesToDataUrl(strokesRef.current, width),
      strokeCount: () => strokesRef.current.length,
    }),
    [],
  )

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div ref={wrapRef} className="sticker relative aspect-[4/3] w-full overflow-hidden bg-white p-0">
        <canvas
          ref={canvasRef}
          className={cn('absolute inset-0 block touch-none select-none', canDraw ? 'cursor-crosshair' : 'cursor-default')}
          style={{ touchAction: 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onLostPointerCapture={onPointerEnd}
          onContextMenu={(e) => e.preventDefault()}
          aria-label={canDraw ? 'Zone de dessin' : 'Dessin en cours'}
        />
        {!count && !canDraw && active && (
          <motion.div
            className="pointer-events-none absolute inset-0 flex items-center justify-center font-display text-lg font-extrabold text-[#1f1b2e]/40"
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ repeat: Infinity, duration: 1.6 }}
          >
            Le dessin arrive… ✏️
          </motion.div>
        )}
        {!count && canDraw && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center font-display text-lg font-extrabold text-[#1f1b2e]/30">
            Dessine ici ! 👆
          </div>
        )}
      </div>

      {canDraw && (
        <Toolbar
          color={color}
          size={size}
          eraser={eraser}
          canUndo={count > 0}
          onColor={(c) => {
            fx.tick()
            setColor(c)
            setEraser(false)
          }}
          onSize={(i) => {
            fx.tick()
            setSize(i)
          }}
          onEraser={() => {
            fx.tick()
            setEraser((v) => !v)
          }}
          onUndo={undo}
          onClear={() => setConfirmClear(true)}
        />
      )}
      <ConfirmModal
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="Tout effacer ?"
        danger
        confirmLabel="Effacer"
        onConfirm={() => {
          setConfirmClear(false)
          clear()
        }}
      >
        Le dessin disparaîtra aussi chez les autres.
      </ConfirmModal>
    </div>
  )
}

/* ------------------------------- barre d'outils ----------------------------- */

function Toolbar({
  color,
  size,
  eraser,
  canUndo,
  onColor,
  onSize,
  onEraser,
  onUndo,
  onClear,
}: {
  color: string
  size: number
  eraser: boolean
  canUndo: boolean
  onColor: (c: string) => void
  onSize: (i: number) => void
  onEraser: () => void
  onUndo: () => void
  onClear: () => void
}) {
  return (
    <div className="sticker flex flex-col gap-2 bg-surface p-2">
      <div className="grid grid-cols-8 gap-1.5">
        {PALETTE.map((c) => {
          const sel = !eraser && c === color
          return (
            <motion.button
              key={c}
              type="button"
              aria-label={`Couleur ${c}`}
              aria-pressed={sel}
              onClick={() => onColor(c)}
              whileTap={{ scale: 0.8 }}
              animate={{ scale: sel ? 1.12 : 1, y: sel ? -3 : 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 18 }}
              className={cn('aspect-square w-full rounded-full border-[3px] border-ink', sel ? 'shadow-sticker-sm ring-2 ring-grape ring-offset-2 ring-offset-surface' : '')}
              style={{ backgroundColor: c }}
            />
          )
        })}
      </div>
      <div className="flex items-center gap-1.5">
        {SIZES.map((w, i) => {
          const sel = !eraser && i === size
          return (
            <motion.button
              key={w}
              type="button"
              aria-label={['Trait fin', 'Trait moyen', 'Trait épais'][i]}
              aria-pressed={sel}
              onClick={() => onSize(i)}
              whileTap={{ scale: 0.85 }}
              className={cn('flex size-11 items-center justify-center rounded-chip border-[3px] border-ink', sel ? 'bg-sun shadow-sticker-sm' : 'bg-sunk')}
            >
              <span className="rounded-full" style={{ width: 4 + i * 6, height: 4 + i * 6, backgroundColor: eraser ? '#1f1b2e' : color, border: '1px solid #1f1b2e' }} />
            </motion.button>
          )
        })}
        <motion.button
          type="button"
          aria-label={eraser ? 'Crayon' : 'Gomme'}
          aria-pressed={eraser}
          onClick={onEraser}
          whileTap={{ scale: 0.85, rotate: -10 }}
          className={cn('flex size-11 items-center justify-center rounded-chip border-[3px] border-ink', eraser ? 'bg-bubblegum shadow-sticker-sm' : 'bg-sunk')}
        >
          {eraser ? <Eraser className="size-5" strokeWidth={2.5} /> : <Pencil className="size-5" strokeWidth={2.5} />}
        </motion.button>
        <div className="flex-1" />
        <motion.button
          type="button"
          aria-label="Annuler le dernier trait"
          onClick={onUndo}
          disabled={!canUndo}
          whileTap={{ scale: 0.85, rotate: -30 }}
          className="flex size-11 items-center justify-center rounded-chip border-[3px] border-ink bg-sky text-[#1f1b2e] shadow-sticker-sm disabled:opacity-40"
        >
          <Undo2 className="size-5" strokeWidth={2.5} />
        </motion.button>
        <motion.button
          type="button"
          aria-label="Tout effacer"
          onClick={onClear}
          disabled={!canUndo}
          whileTap={{ scale: 0.85 }}
          className="flex size-11 items-center justify-center rounded-chip border-[3px] border-ink bg-tomato text-white shadow-sticker-sm disabled:opacity-40"
        >
          <Trash2 className="size-5" strokeWidth={2.5} />
        </motion.button>
      </div>
    </div>
  )
}
