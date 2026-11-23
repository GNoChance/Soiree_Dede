import { useCallback, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Check } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { mood, pickExpression } from '@/features/soiree/players'
import { supabase } from '@/lib/supabase'
import { useServerClock } from '@/features/soiree/useServerClock'
import { fx as feedback, vibrate } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import type { DuelBoardProps, DuelInfo } from '@/features/duel/types'
import type { GameActionPayload, PlayerInfo } from '@/games/types'
import { BnMatchContext } from './context'
import { FleetStatus, ShipSvg, shipBox } from './Fleet'
import { Sea, type SeaFx, type SeaShip } from './Sea'
import {
  SIZE,
  accuracy,
  canPlace,
  cellIndex,
  cellName,
  clampOrigin,
  fleetMap,
  isCurrentSecret,
  moveShip,
  normalizeFleet,
  randomFleet,
  replaceShip,
  rotateShip,
  sameFleet,
  shipName,
  shipSize,
  shotMap,
} from './logic'
import { listenAudioUnlock, playBoom, playSink, playSonar, playSplash, playWhistle } from './sound'
import type { BnBoard, BnMove, BnSecret, BnShip, BnShipId, BnShot, BnWaters } from './types'

type Props = DuelBoardProps<BnBoard, BnMove>
type Cell = { x: number; y: number }

const NO_SHOTS: BnShot[] = []
const NO_SHIPS: BnShip[] = []
const EMPTY_WATERS: BnWaters = { shots: NO_SHOTS, sunk: NO_SHIPS, left: 5 }
const fleetKey = (f: readonly BnShip[]) => JSON.stringify(normalizeFleet(f))

/* ========================================================================== */
/* Entrée : un plateau par manche (tout l'état local repart de zéro)           */
/* ========================================================================== */

/** Plateau de la bataille navale : préparation (setup), tirs (playing) et révélation (result). */
export default function BnBoardView(props: Props) {
  useEffect(() => listenAudioUnlock(), [])
  return <Round key={`${props.board.duel_no}-${props.board.game_no}`} {...props} />
}

function Round(props: Props) {
  const { board, me, phase, secret } = props
  const ctx = useContext(BnMatchContext)
  const duelist = me === board.a || me === board.b
  const mine = useMySecret(ctx?.matchId ?? null, secret, me, board.duel_no, board.game_no, duelist)
  return (
    <div className="-mx-3 overflow-x-clip px-3">
      {!duelist ? (
        <SpectatorView {...props} />
      ) : phase === 'setup' ? (
        <SetupView {...props} serverFleet={mine?.fleet ?? null} />
      ) : (
        <BattleView {...props} myFleet={mine?.fleet ?? board.reveal?.[me] ?? null} />
      )}
    </div>
  )
}

/**
 * Mon secret de la manche en cours (flotte). Le temps réel le livre en général ;
 * filet : relecture de `match_secrets` s'il tarde (le socle ne supprime jamais
 * un ancien secret : on vérifie duel_no / game_no).
 */
function useMySecret(matchId: string | null, propSecret: unknown, me: string, duelNo: number, gameNo: number, enabled: boolean): BnSecret | null {
  const [fetched, setFetched] = useState<unknown>(null)
  const prop = isCurrentSecret(propSecret, me, duelNo, gameNo) ? propSecret : null
  const best = prop ?? (isCurrentSecret(fetched, me, duelNo, gameNo) ? fetched : null)
  const have = !!best
  useEffect(() => {
    if (!enabled || have || !matchId) return
    let cancelled = false
    let timer = 0
    const load = async (attempt: number) => {
      const { data } = await supabase.from('match_secrets').select('secret').eq('match_id', matchId).maybeSingle()
      if (cancelled) return
      const sec = (data?.secret ?? null) as unknown
      if (isCurrentSecret(sec, me, duelNo, gameNo)) setFetched(sec)
      else if (attempt < 6) timer = window.setTimeout(() => void load(attempt + 1), 500 * (attempt + 1))
    }
    timer = window.setTimeout(() => void load(0), 900) // d'abord une chance au temps réel
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [enabled, have, matchId, me, duelNo, gameNo])
  return best
}

/**
 * Dernier tir à animer (obus, plouf / boum) + sons et vibrations. Rien n'est
 * rejoué au montage (rechargement de page) : seuls les nouveaux tirs comptent.
 */
function useShotFx(board: BnBoard, me: string): SeaFx | null {
  const seen = useRef(board.count)
  const [state, setState] = useState<SeaFx | null>(null)
  // Vibrations programmées : annulées seulement au démontage. Le même state
  // arrive souvent deux fois (réponse de game_action puis écho temps réel, ou un
  // pari) : relancer l'effet ne doit pas annuler la vibration du tir en cours.
  const timers = useRef<number[]>([])
  useEffect(
    () => () => {
      for (const t of timers.current) window.clearTimeout(t)
      timers.current = []
    },
    [],
  )
  useEffect(() => {
    const last = board.last
    if (!last || board.count <= seen.current) {
      seen.current = Math.max(seen.current, board.count)
      return
    }
    seen.current = board.count
    setState({ key: board.count, last })
    playWhistle()
    if (last.r === 'miss') {
      playSplash(0.3)
      return
    }
    playBoom(last.r === 'sunk', 0.3)
    if (last.r === 'sunk') playSink(1)
    const hitMe = (me === board.a || me === board.b) && last.by !== me
    const pattern = hitMe ? (last.r === 'sunk' ? [120, 60, 220] : [70, 40, 120]) : last.r === 'sunk' ? [40, 40, 90] : [35]
    const t = window.setTimeout(() => {
      timers.current = timers.current.filter((x) => x !== t)
      vibrate(pattern)
    }, 320)
    timers.current.push(t)
  }, [board.count, board.last, board.a, board.b, me])
  return state
}

/* ========================================================================== */
/* Petits morceaux communs                                                     */
/* ========================================================================== */

/** Voile sur une grille (préparation) : balayage de sonar + texte. */
function Fog({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion()
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center overflow-hidden rounded-lg bg-[#15122b]/45">
      <motion.div
        className="absolute inset-[6%] rounded-full"
        style={{ background: 'conic-gradient(from 0deg, rgba(6,214,160,.55), rgba(6,214,160,0) 28%)' }}
        animate={reduce ? undefined : { rotate: 360 }}
        transition={{ repeat: Infinity, duration: 2.6, ease: 'linear' }}
        aria-hidden
      />
      <div className="absolute inset-[22%] rounded-full border-2 border-mint/40" aria-hidden />
      <div className="absolute inset-[38%] rounded-full border-2 border-mint/40" aria-hidden />
      <span className="relative rounded-full border-2 border-ink bg-surface px-2 py-0.5 text-center font-display text-xs leading-tight font-extrabold shadow-sticker-sm">
        {children}
      </span>
    </div>
  )
}

function LastShot({ board, duel, me, get }: { board: BnBoard; duel: DuelInfo<BnMove>; me: string; get: (id: string) => PlayerInfo }) {
  const reduce = useReducedMotion()
  const last = board.last
  if (!last) {
    return (
      <p className="flex h-[1.6em] items-center justify-center text-center text-xs font-bold text-muted">
        {duel.starter === me ? 'Tu tires en premier 🎯' : `${get(duel.starter).nickname} tire en premier 🎯`}
      </p>
    )
  }
  const by = last.by === me ? 'Toi' : get(last.by).nickname
  const auto = !!duel.last_move?.auto && duel.last_move.by === last.by
  const what = last.r === 'miss' ? 'à l’eau 💦' : last.r === 'hit' ? 'touché ! 💥' : `coulé ! ${shipName(last.ship)} 🔥`
  return (
    <motion.p
      key={board.count}
      initial={reduce ? false : { y: -6, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.35 }}
      className="flex h-[1.6em] items-center justify-center gap-1 truncate text-center text-sm font-extrabold"
    >
      <span className="truncate">
        {by} → {cellName(last.x, last.y)} : <span className={last.r === 'miss' ? 'text-sky' : 'text-tomato'}>{what}</span>
        {auto && <span className="ml-1 text-xs text-muted">(tir auto ⏱️)</span>}
      </span>
    </motion.p>
  )
}

/** Précision et meilleure série de la manche (fin de manche). */
function StatsLine({ board, me, get }: { board: BnBoard; me: string; get: (id: string) => PlayerInfo }) {
  return (
    <div className="sticker-sm grid grid-cols-[auto_1fr_1fr] items-center gap-x-2 gap-y-0.5 bg-surface px-2 py-1.5 text-xs font-bold">
      <span />
      <span className="text-center text-muted">🎯 Précision</span>
      <span className="text-center text-muted">🔥 Série</span>
      {[board.a, board.b].map((id) => {
        const st = board.stats[id]
        const acc = accuracy(st)
        return (
          <div key={id} className="contents">
            <span className="truncate font-extrabold">{id === me ? 'Toi' : get(id).nickname}</span>
            <span className="text-center tabular-nums">
              {acc === null ? '—' : `${acc} %`} <span className="text-muted">({st?.hits ?? 0}/{st?.shots ?? 0})</span>
            </span>
            <span className="text-center tabular-nums">{st?.best ?? 0} touché{(st?.best ?? 0) > 1 ? 's' : ''}</span>
          </div>
        )
      })}
    </div>
  )
}

/* ========================================================================== */
/* Préparation : placer sa flotte (glisser / toucher pour pivoter)             */
/* ========================================================================== */

interface Drag {
  id: BnShipId
  pid: number
  sx: number
  sy: number
  /** Point saisi, en cases, relatif à l'origine du bateau. */
  gx: number
  gy: number
  moved: boolean
}

function SetupView({ board, me, duel, colors, get, onMove, onReady, serverFleet }: Props & { serverFleet: BnShip[] | null }) {
  const reduce = useReducedMotion()
  const ctx = useContext(BnMatchContext)
  const ready = duel.ready.includes(me)
  const opp = me === board.a ? board.b : board.a
  const oppReady = duel.ready.includes(opp)
  const myColor = me === board.a ? colors.a : colors.b
  const [draft, setDraft] = useState<BnShip[] | null>(null)
  const fleet = draft ?? serverFleet
  const [busy, setBusy] = useState(false)
  const locked = ready || busy || !fleet

  /* ---- envoi au serveur : file ordonnée (« place » puis « ready ») ---- */
  const handlers = useRef({ onMove, onReady })
  useEffect(() => {
    handlers.current = { onMove, onReady }
  })
  const send = useCallback(
    async (a: GameActionPayload): Promise<boolean> => {
      if (ctx) return (await ctx.act(a)) !== null
      if (a.type === 'ready') handlers.current.onReady()
      else handlers.current.onMove((a as unknown as { move: BnMove }).move)
      return true
    },
    [ctx],
  )
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const enqueue = useCallback(<T,>(job: () => Promise<T>): Promise<T> => {
    const p = queue.current.then(job, job)
    queue.current = p.catch(() => undefined)
    return p
  }, [])
  const alive = useRef(true)
  const timer = useRef(0)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      window.clearTimeout(timer.current)
    }
  }, [])
  const serverNow = useServerClock()
  const deadlineRef = useRef<string | null>(null)
  useEffect(() => {
    deadlineRef.current = ctx?.deadline ?? null
  })
  const latest = useRef<BnShip[] | null>(null)
  const acked = useRef('')
  /** Envoie la flotte locale si le serveur ne l'a pas déjà. */
  const flush = useCallback(
    () =>
      enqueue(async () => {
        const d = latest.current
        if (!d || !alive.current) return true
        const k = fleetKey(d)
        if (k === acked.current) return true
        const ok = await send({ type: 'move', move: { type: 'place', ships: d } })
        if (ok) acked.current = k
        return ok
      }),
    [enqueue, send],
  )
  const commit = useCallback(
    (f: BnShip[]) => {
      latest.current = f
      setDraft(f)
      window.clearTimeout(timer.current)
      // Dans les 3 dernières secondes : envoi immédiat (le serveur valide la flotte à l'échéance).
      const dl = deadlineRef.current
      const lastSecs = dl ? new Date(dl).getTime() - serverNow() < 3000 : false
      if (lastSecs) void flush()
      else timer.current = window.setTimeout(() => void flush(), 450)
    },
    [flush, serverNow],
  )

  // Filet : pas de flotte reçue au bout de 2,5 s -> placement auto local, envoyé au serveur.
  useEffect(() => {
    if (fleet || ready) return
    const t = window.setTimeout(() => commit(randomFleet()), 2500)
    return () => window.clearTimeout(t)
  }, [fleet, ready, commit])

  useEffect(() => {
    playSonar()
  }, [])

  const confirm = async () => {
    if (locked) return
    window.clearTimeout(timer.current)
    setBusy(true)
    const ok = await flush()
    if (ok && alive.current) await enqueue(() => send({ type: 'ready' }))
    if (alive.current) setBusy(false)
  }

  const shuffle = () => {
    if (locked) return
    commit(randomFleet())
    playSonar()
    vibrate(12)
  }

  /* ---- glisser-déposer (uniquement sur un bateau : touch-action ciblé) ---- */
  const seaRef = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const [ghost, setGhost] = useState<{ ship: BnShip; valid: boolean } | null>(null)
  const ghostRef = useRef(ghost)
  const [shake, setShake] = useState<{ id: BnShipId; n: number } | null>(null)
  const bump = (id: BnShipId) => setShake((s) => ({ id, n: (s?.n ?? 0) + 1 }))

  const geometry = () => {
    const r = seaRef.current?.getBoundingClientRect()
    return r && r.width > 0 ? { r, cell: r.width / SIZE } : null
  }
  const rotate = (id: BnShipId) => {
    if (!fleet) return
    const next = rotateShip(fleet, id)
    if (next) {
      commit(next)
      feedback.pop()
    } else {
      feedback.fail()
      bump(id)
    }
  }
  const endDrag = () => {
    drag.current = null
    ghostRef.current = null
    setGhost(null)
  }
  const onDown = (e: PointerEvent<HTMLDivElement>, ship: BnShip) => {
    if (locked || drag.current || (e.pointerType === 'mouse' && e.button !== 0)) return
    const g = geometry()
    if (!g) return
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* capture indisponible : le glisser marche tant que le doigt reste sur le bateau */
    }
    drag.current = {
      id: ship.id,
      pid: e.pointerId,
      sx: e.clientX,
      sy: e.clientY,
      gx: (e.clientX - g.r.left) / g.cell - ship.x,
      gy: (e.clientY - g.r.top) / g.cell - ship.y,
      moved: false,
    }
  }
  const onMovePtr = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.pid !== e.pointerId || !fleet) return
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 8) return
      d.moved = true
    }
    const g = geometry()
    const ship = fleet.find((s) => s.id === d.id)
    if (!g || !ship) return
    const o = clampOrigin(ship.id, ship.dir, (e.clientX - g.r.left) / g.cell - d.gx, (e.clientY - g.r.top) / g.cell - d.gy)
    const prev = ghostRef.current
    if (prev && prev.ship.x === o.x && prev.ship.y === o.y) return
    const cand: BnShip = { ...ship, x: o.x, y: o.y }
    const next = { ship: cand, valid: canPlace(fleet, cand) }
    ghostRef.current = next
    setGhost(next)
    vibrate(4)
  }
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.pid !== e.pointerId) return
    const gh = ghostRef.current
    endDrag()
    if (!d.moved) {
      rotate(d.id) // simple toucher : pivoter
      return
    }
    if (gh?.valid && fleet) {
      const cur = fleet.find((s) => s.id === d.id)
      if (cur && (cur.x !== gh.ship.x || cur.y !== gh.ship.y)) commit(replaceShip(fleet, gh.ship))
      feedback.pop()
    } else {
      feedback.fail()
      bump(d.id)
    }
  }
  const onCancel = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pid === e.pointerId) endDrag()
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>, ship: BnShip) => {
    if (locked || !fleet) return
    const steps: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    const step = steps[e.key]
    if (step) {
      e.preventDefault()
      const next = moveShip(fleet, ship.id, ship.x + step[0], ship.y + step[1])
      if (next && !sameFleet(next, fleet)) commit(next)
      else {
        feedback.fail()
        bump(ship.id)
      }
    } else if (e.key === 'Enter' || e.key === ' ' || e.key === 'r' || e.key === 'R') {
      e.preventDefault()
      rotate(ship.id)
    }
  }

  const oppP = get(opp)
  return (
    <div className="flex flex-col gap-2">
      <p className="text-center text-xs font-bold text-muted">
        {ready
          ? oppReady
            ? 'Les deux flottes sont prêtes !'
            : `Flotte validée ✅ ${oppP.nickname} se prépare…`
          : 'Glisse un bateau pour le déplacer · touche-le pour le pivoter'}
      </p>

      <Sea
        shots={NO_SHOTS}
        size="lg"
        label="Ma flotte : placement des bateaux"
        seaRef={seaRef}
        fog={!fleet ? <Fog>Ta flotte arrive… ⚓</Fog> : null}
      >
        {fleet?.map((ship) => {
          const dragging = ghost?.ship.id === ship.id
          const shaking = shake?.id === ship.id
          return (
            <motion.div
              key={ship.id}
              layout={reduce ? false : 'position'}
              transition={{ type: 'spring', stiffness: 420, damping: 30 }}
              initial={reduce ? false : { opacity: 0, scale: 0.5 }}
              animate={{ opacity: dragging ? 0.3 : 1, scale: 1 }}
              role="button"
              tabIndex={locked ? -1 : 0}
              aria-disabled={locked || undefined}
              aria-label={`${shipName(ship.id)} (${shipSize(ship.id)} cases) en ${cellName(ship.x, ship.y)}, ${ship.dir === 'h' ? 'horizontal' : 'vertical'}. Glisser pour déplacer, toucher pour pivoter.`}
              className={cn(
                'absolute z-10 rounded-md p-[0.6%] outline-none select-none focus-visible:ring-[3px] focus-visible:ring-sun',
                !locked && 'cursor-grab active:cursor-grabbing',
              )}
              style={{ ...shipBox(ship), touchAction: locked ? undefined : 'none', WebkitTouchCallout: 'none' }}
              onPointerDown={(e) => onDown(e, ship)}
              onPointerMove={onMovePtr}
              onPointerUp={onUp}
              onPointerCancel={onCancel}
              onKeyDown={(e) => onKey(e, ship)}
            >
              <motion.div
                key={shaking ? `s${shake.n}` : 's'}
                className="size-full"
                initial={{ x: 0 }}
                animate={shaking && !reduce ? { x: [0, -6, 6, -4, 4, 0] } : { x: 0 }}
                transition={{ duration: 0.35 }}
              >
                <ShipSvg id={ship.id} dir={ship.dir} accent={myColor} />
              </motion.div>
            </motion.div>
          )
        })}
        {ghost && (
          <div
            className={cn(
              'pointer-events-none absolute z-20 rounded-md border-[3px] border-dashed p-[0.2%]',
              ghost.valid ? 'border-[#04a77c] bg-mint/45' : 'border-tomato bg-tomato/50',
            )}
            style={shipBox(ghost.ship)}
            aria-hidden
          >
            <ShipSvg id={ghost.ship.id} dir={ghost.ship.dir} accent={myColor} className={ghost.valid ? undefined : 'opacity-60'} />
          </div>
        )}
        {ready && (
          <span className="pointer-events-none absolute -top-2 -right-2 z-30 rounded-full border-2 border-ink bg-mint px-2 font-display text-xs font-extrabold text-[#1f1b2e] shadow-sticker-sm">
            ✅ Validée
          </span>
        )}
      </Sea>

      <FleetStatus sunk={new Set()} accent={myColor} names className="justify-center" />
      <p className="text-center text-[11px] font-bold text-muted">À la main, les bateaux peuvent se toucher (pas se chevaucher).</p>

      {/* Actions épinglées en bas de l'écran : toujours atteignables, même sur un petit téléphone. */}
      {/* flex-wrap : avec une police agrandie, « Prêt ! » passe sur sa propre ligne au lieu d'être écrasé. */}
      <div className="sticky bottom-0 z-30 -mx-1 flex flex-wrap items-center gap-2 bg-linear-to-t from-paper via-paper to-paper/80 px-1 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {ready ? (
          <div className="flex min-h-12 w-full items-center justify-center gap-2 rounded-card border-[3px] border-ink bg-mint px-3 text-center font-display text-lg font-extrabold text-[#1f1b2e] shadow-sticker-sm">
            <Check className="size-5 shrink-0" strokeWidth={3} />
            {oppReady ? 'C’est parti !' : 'Prêt ! On attend l’adversaire…'}
          </div>
        ) : (
          <>
            <Button variant="secondary" silent className="grow whitespace-nowrap" style={{ paddingInline: '0.75rem' }} disabled={locked} onClick={shuffle}>
              Mélanger 🎲
            </Button>
            <Button
              className="grow-[2] basis-28 whitespace-nowrap"
              style={{ paddingInline: '0.75rem' }}
              loading={busy}
              disabled={locked}
              icon={<Check className="size-5" strokeWidth={3} />}
              onClick={() => void confirm()}
            >
              Prêt&nbsp;!
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

/* ========================================================================== */
/* Bataille : grille adverse (viser / tirer) + ma flotte                       */
/* ========================================================================== */

function BattleView({ board, me, isMyTurn, onMove, pending, duel, phase, get, colors, myFleet }: Props & { myFleet: BnShip[] | null }) {
  const opp = me === board.a ? board.b : board.a
  const myColor = me === board.a ? colors.a : colors.b
  const oppColor = me === board.a ? colors.b : colors.a
  const oppW = board.waters[opp] ?? EMPTY_WATERS
  const myW = board.waters[me] ?? EMPTY_WATERS
  const result = phase === 'result'
  const interactive = isMyTurn && !pending && phase === 'playing'
  const oppP = get(opp)
  const fxs = useShotFx(board, me)
  const fxOpp = fxs && fxs.last.by === me ? fxs : null
  const fxMine = fxs && fxs.last.by === opp ? fxs : null

  /* ---- visée : toucher = réticule, retoucher = feu (souris : clic direct) ---- */
  const [armed, setArmed] = useState<Cell | null>(null)
  const [hover, setHover] = useState<Cell | null>(null)
  const pointerType = useRef('mouse')
  const armKey = `${board.count}-${isMyTurn}`
  const [lastArmKey, setLastArmKey] = useState(armKey)
  if (armKey !== lastArmKey) {
    setLastArmKey(armKey)
    setArmed(null)
  }
  const target = interactive ? (armed ?? hover) : null
  const shotOpp = useMemo(() => shotMap(oppW.shots), [oppW.shots])

  const fire = useCallback(
    (c: Cell) => {
      setArmed(null)
      setHover(null)
      onMove({ x: c.x, y: c.y })
    },
    [onMove],
  )
  const live = useRef({ interactive, armed, shotOpp, fire })
  useEffect(() => {
    live.current = { interactive, armed, shotOpp, fire }
  })
  const onCell = useCallback((x: number, y: number) => {
    const l = live.current
    if (!l.interactive) return
    if (l.shotOpp.has(cellIndex(x, y))) {
      feedback.fail() // déjà visée
      return
    }
    if (pointerType.current === 'mouse' || (l.armed?.x === x && l.armed?.y === y)) l.fire({ x, y })
    else {
      setArmed({ x, y })
      playSonar()
      vibrate(8)
    }
  }, [])
  const onCellPointerDown = useCallback((t: string) => {
    pointerType.current = t
  }, [])

  /* ---- bateaux affichés ---- */
  const oppSunk = useMemo(() => new Set<string>(oppW.sunk.map((s) => s.id)), [oppW.sunk])
  const oppShips = useMemo<SeaShip[]>(() => {
    const list: SeaShip[] = oppW.sunk.map((s) => ({
      ship: s,
      look: 'sunk',
      accent: oppColor,
      fresh: !!fxOpp && fxOpp.last.r === 'sunk' && fxOpp.last.ship === s.id,
    }))
    for (const s of board.reveal?.[opp] ?? []) if (!oppSunk.has(s.id)) list.push({ ship: s, look: 'revealed', accent: oppColor })
    return list
  }, [oppW.sunk, board.reveal, opp, oppColor, fxOpp, oppSunk])
  const mySunk = useMemo(() => new Set<string>(myW.sunk.map((s) => s.id)), [myW.sunk])
  const myShips = useMemo<SeaShip[]>(
    () =>
      (myFleet ?? []).map((s) => ({
        ship: s,
        look: mySunk.has(s.id) ? 'sunk' : 'afloat',
        accent: myColor,
        fresh: !!fxMine && fxMine.last.r === 'sunk' && fxMine.last.ship === s.id,
      })),
    [myFleet, mySunk, myColor, fxMine],
  )
  const damage = useMemo(() => {
    const occ = fleetMap(myFleet)
    const out: Partial<Record<BnShipId, number>> = {}
    for (const s of myW.shots) {
      const id = s.r === 'miss' ? undefined : occ.get(cellIndex(s.x, s.y))
      if (id) out[id] = (out[id] ?? 0) + 1
    }
    return out
  }, [myFleet, myW.shots])

  const myStats = board.stats[me]
  const won = result && duel.winner === me
  return (
    <div className="flex flex-col gap-1.5">
      {/* Bandeau adverse */}
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 font-display text-sm font-extrabold">
          <Avatar slug={oppP.slug} expression={result ? (won ? mood(oppP, 'sad') : pickExpression(oppP, 'cool', 'pouces', 'joie')) : mood(oppP, 'think')} size={28} />
          <span className="truncate">{oppP.nickname}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <span className="font-display text-sm font-extrabold tabular-nums" title="Bateaux encore à flot">
            ⚓ {oppW.left}/5
          </span>
          <FleetStatus sunk={oppSunk} accent={oppColor} unit={0.5} />
        </span>
      </div>

      {/* Barre de visée : hauteur fixe, la grille ne bouge pas entre les deux touchers. */}
      <div className="flex h-[2.4em] items-center justify-center gap-2 overflow-hidden text-sm font-extrabold whitespace-nowrap">
        {interactive ? (
          armed ? (
            <>
              <span className="truncate">
                🎯 <span className="tabular-nums">{cellName(armed.x, armed.y)}</span> · retouche pour tirer
              </span>
              <button
                type="button"
                onClick={() => fire(armed)}
                className="shrink-0 rounded-full border-2 border-ink bg-tomato px-3 py-0.5 font-display text-sm font-extrabold text-white shadow-sticker-sm active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
              >
                Feu ! 💥
              </button>
            </>
          ) : (
            <span className="truncate text-muted">Touche une case pour viser 🎯</span>
          )
        ) : phase === 'playing' ? (
          <span className="truncate text-muted">{isMyTurn ? 'Tir en cours…' : `${oppP.nickname} vise ta flotte… 👀`}</span>
        ) : result ? (
          <span className="truncate">{won ? 'Flotte adverse au fond ! 🏆' : 'Voilà où se cachaient ses bateaux 👀'}</span>
        ) : null}
      </div>

      <Sea
        shots={oppW.shots}
        ships={oppShips}
        target={target}
        onCell={onCell}
        interactive={interactive}
        onCellPointerDown={onCellPointerDown}
        onHover={setHover}
        fx={fxOpp}
        size="lg"
        glow={interactive ? myColor : null}
        label={`Eaux de ${oppP.nickname} : touche une case pour viser, retouche pour tirer`}
      />

      <LastShot board={board} duel={duel} me={me} get={get} />
      {result && <StatsLine board={board} me={me} get={get} />}

      {/* Ma flotte (petite) + état */}
      <div className="flex items-start gap-3">
        <div className="w-[46%] max-w-[13rem] shrink-0">
          <p className="mb-0.5 text-center font-display text-xs font-extrabold">Ma flotte</p>
          <Sea
            shots={myW.shots}
            ships={myShips}
            fx={fxMine}
            size="sm"
            glow={phase === 'playing' && !isMyTurn ? oppColor : null}
            label="Ma flotte et les tirs reçus"
            fog={!myFleet ? <Fog>…</Fog> : null}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-5">
          <FleetStatus sunk={mySunk} damage={damage} accent={myColor} names vertical />
          <p className="text-[11px] leading-tight font-bold text-muted tabular-nums">
            ⚓ {myW.left}/5 à flot · {myStats?.shots ?? 0} tir{(myStats?.shots ?? 0) > 1 ? 's' : ''}
            {accuracy(myStats) !== null && ` · ${accuracy(myStats)} % au but`}
          </p>
        </div>
      </div>
    </div>
  )
}

/* ========================================================================== */
/* Spectateurs : les deux grilles de tirs                                      */
/* ========================================================================== */

function SpectatorView({ board, me, duel, phase, get, colors }: Props) {
  const fxs = useShotFx(board, me)
  const result = phase === 'result'
  return (
    <div className="flex flex-col gap-1.5">
      {phase === 'setup' ? (
        <p className="flex h-[1.6em] items-center justify-center text-center text-xs font-bold text-muted">Chacun place sa flotte en secret… 🤫</p>
      ) : (
        <LastShot board={board} duel={duel} me={me} get={get} />
      )}
      <div className="grid grid-cols-2 gap-2">
        {[board.a, board.b].map((owner) => {
          const shooter = owner === board.a ? board.b : board.a
          return (
            <SpectatorSea
              key={owner}
              board={board}
              owner={owner}
              player={get(owner)}
              color={owner === board.a ? colors.a : colors.b}
              shooterColor={owner === board.a ? colors.b : colors.a}
              underFire={phase === 'playing' && duel.turn === shooter}
              fx={fxs && fxs.last.by === shooter ? fxs : null}
              setup={phase === 'setup'}
              ready={duel.ready.includes(owner)}
              winner={result ? duel.winner : null}
            />
          )
        })}
      </div>
      {result && <StatsLine board={board} me={me} get={get} />}
    </div>
  )
}

interface SpectatorSeaProps {
  board: BnBoard
  owner: string
  player: PlayerInfo
  color: string
  shooterColor: string
  underFire: boolean
  fx: SeaFx | null
  setup: boolean
  ready: boolean
  winner: string | null
}

function SpectatorSea({ board, owner, player, color, shooterColor, underFire, fx, setup, ready, winner }: SpectatorSeaProps) {
  const w = board.waters[owner] ?? EMPTY_WATERS
  const sunk = useMemo(() => new Set<string>(w.sunk.map((s) => s.id)), [w.sunk])
  const ships = useMemo<SeaShip[]>(() => {
    const list: SeaShip[] = w.sunk.map((s) => ({ ship: s, look: 'sunk', accent: color, fresh: !!fx && fx.last.r === 'sunk' && fx.last.ship === s.id }))
    for (const s of board.reveal?.[owner] ?? []) if (!sunk.has(s.id)) list.push({ ship: s, look: 'revealed', accent: color })
    return list
  }, [w.sunk, board.reveal, owner, color, fx, sunk])
  const expr = winner ? (winner === owner ? pickExpression(player, 'cool', 'pouces', 'joie') : mood(player, 'sad')) : underFire ? mood(player, 'shocked') : player.equipped
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-center gap-1">
        <Avatar slug={player.slug} expression={expr} size={24} />
        <span className="min-w-0 flex-1 truncate font-display text-xs font-extrabold">{player.nickname}</span>
        <span className="shrink-0 text-[11px] font-extrabold tabular-nums">⚓{w.left}</span>
      </div>
      <Sea
        shots={w.shots}
        ships={ships}
        fx={fx}
        size="sm"
        glow={underFire ? shooterColor : null}
        label={`Flotte de ${player.nickname}`}
        fog={setup ? <Fog>{ready ? 'Prête ✅' : 'Placement…'}</Fog> : null}
      />
      <FleetStatus sunk={sunk} accent={color} className="justify-center" />
    </div>
  )
}
