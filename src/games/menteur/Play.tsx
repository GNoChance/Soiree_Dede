import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Minus, Plus, Smartphone, Target, Vibrate } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { ChibiImage } from '@/components/ui/ChibiImage'
import { burst } from '@/components/ui/confetti'
import { supabase } from '@/lib/supabase'
import { fx, vibrate } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import { mood, pickExpression, playerOrPlaceholder } from '@/features/soiree/players'
import { serverNow, useCountdown } from '@/features/soiree/useServerClock'
import type { GamePlayProps, PlayerInfo } from '../types'
import { Cup, Die3D, FaceIcon, HiddenDice } from './Dice'
import { FACES, REVEAL_LIFT_MS, REVEAL_STEP_MS, isValidBid, matches, minQtyFor, mtrActions } from './rules'
import { playCount, playPour, playRattle, useShake } from './shake'
import type { DieFace, MtrAction, MtrBid, MtrReveal, MtrSecret, MtrState } from './types'

type Get = (id: string) => PlayerInfo

/* -------------------------------------------------------------------------- */
/* Mes dés (secret de la manche)                                               */
/* -------------------------------------------------------------------------- */

const isSecret = (x: unknown): x is MtrSecret =>
  !!x && typeof x === 'object' && Array.isArray((x as MtrSecret).dice) && typeof (x as MtrSecret).round === 'number'

/**
 * useMatch reçoit les mises à jour de `match_secrets` en temps réel ; filet de
 * sécurité : si le secret de la manche courante n'est pas arrivé, on le relit.
 */
function useMyDice(matchId: string, propSecret: unknown, round: number, enabled: boolean): DieFace[] | null {
  const [fetched, setFetched] = useState<MtrSecret | null>(null)
  const prop = isSecret(propSecret) ? propSecret : null
  const best = prop?.round === round ? prop : fetched?.round === round ? fetched : null
  const have = !!best

  useEffect(() => {
    if (!enabled || have) return
    let cancelled = false
    let timer = 0
    const load = async (attempt: number) => {
      const { data } = await supabase.from('match_secrets').select('secret').eq('match_id', matchId).maybeSingle()
      if (cancelled) return
      const sec = (data?.secret ?? null) as unknown
      if (isSecret(sec)) setFetched(sec)
      if ((!isSecret(sec) || sec.round < round) && attempt < 6) timer = window.setTimeout(() => void load(attempt + 1), 400 * (attempt + 1))
    }
    timer = window.setTimeout(() => void load(0), 700) // d'abord une chance au Realtime
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [matchId, round, enabled, have])

  return best ? best.dice : null
}

const rolledKey = (matchId: string) => `menteur:${matchId}:rolled`
function readRolled(matchId: string): number {
  try {
    return Number(sessionStorage.getItem(rolledKey(matchId)) ?? 0) || 0
  } catch {
    return 0
  }
}
function writeRolled(matchId: string, round: number) {
  try {
    sessionStorage.setItem(rolledKey(matchId), String(round))
  } catch {
    /* stockage indisponible */
  }
}

/* -------------------------------------------------------------------------- */
/* Écran de jeu                                                                */
/* -------------------------------------------------------------------------- */

export default function MenteurPlay({ matchId, state, secret, meId, isHost, players, act }: GamePlayProps) {
  const s = state as unknown as MtrState
  const get = useCallback((id: string) => playerOrPlaceholder(players, id), [players])
  const isPlayer = s.players.includes(meId)
  const alive = s.alive.includes(meId)
  const dice = useMyDice(matchId, secret, s.round, isPlayer && alive)
  const reduce = useReducedMotion()

  const bidding = s.phase === 'bidding'
  const myTurn = bidding && s.turn === meId
  const left = useCountdown(s.phase === 'bidding' || s.phase === 'reveal' ? s.deadline : null)
  const total = (s.turn_seconds || 45) * 1000
  const [busy, setBusy] = useState(false)

  const send = useCallback(
    async (a: MtrAction) => {
      setBusy(true)
      const r = await act(a)
      setBusy(false)
      return r
    },
    [act],
  )

  /* ---- ticks : à l'échéance, n'importe quel client prévient le serveur ---- */
  useEffect(() => {
    if ((s.phase !== 'bidding' && s.phase !== 'reveal') || !s.deadline) return
    const end = new Date(s.deadline).getTime()
    let timer = 0
    const fire = () => {
      if (isPlayer || isHost) void act(mtrActions.tick())
      timer = window.setTimeout(fire, 4000 + Math.random() * 2000)
    }
    const first = s.phase === 'bidding' ? s.turn === meId : isHost
    const delay = Math.max(0, end - serverNow()) + (first ? 200 : 1500 + Math.random() * 2000)
    timer = window.setTimeout(fire, delay)
    return () => clearTimeout(timer)
  }, [s.deadline, s.phase, s.turn, meId, isHost, isPlayer, act])

  /* ---- sons ---- */
  const lastTurnSeq = useRef(s.turn_seq)
  useEffect(() => {
    if (s.turn_seq === lastTurnSeq.current) return
    lastTurnSeq.current = s.turn_seq
    if (s.turn === meId && s.phase === 'bidding') {
      fx.success()
      vibrate([20, 40, 20])
    } else if (s.bid) {
      fx.pop()
    }
  }, [s.turn_seq, s.turn, s.phase, s.bid, meId])
  const secLeft = Math.ceil(left / 1000)
  useEffect(() => {
    if (myTurn && secLeft > 0 && secLeft <= 5) fx.tick()
  }, [myTurn, secLeft])

  const seats = useMemo(() => {
    const i = Math.max(0, s.order.indexOf(meId))
    return [...s.order.slice(i), ...s.order.slice(0, i)]
  }, [s.order, meId])

  const turnPlayer = s.turn ? get(s.turn) : null

  return (
    <div className="flex flex-col gap-3 pb-4">
      <RoundTable s={s} seats={seats} get={get} meId={meId} left={left} total={total} />

      <BidTrail s={s} get={get} />

      {isPlayer && alive && (
        <MyDicePanel key={`${matchId}-${s.round}`} matchId={matchId} round={s.round} dice={dice} highlight={s.bid?.face ?? null} />
      )}

      {myTurn && <BidPicker key={s.turn_seq} s={s} dice={dice} busy={busy} left={left} total={total} onSend={(a) => void send(a)} />}

      {bidding && !myTurn && turnPlayer && (
        <motion.div
          key={s.turn}
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="sticker flex items-center gap-3 bg-surface p-3"
        >
          <motion.div animate={reduce ? undefined : { rotate: [-4, 4, -4] }} transition={{ repeat: Infinity, duration: 1.6 }}>
            <Avatar slug={turnPlayer.slug} expression={mood(turnPlayer, 'think')} size={48} />
          </motion.div>
          <p className="flex-1 font-display text-lg leading-tight font-extrabold">
            {turnPlayer.nickname} réfléchit…{s.absent?.[s.turn ?? ''] ? ' 💤 absent·e' : ''}
            {s.returned && s.turn_seq <= (s.returned_seq ?? 0) + 2 && <span className="block text-sm font-bold text-grape">👋 {s.returned === meId ? 'Te revoilà !' : `${get(s.returned).nickname} est de retour !`}</span>}
            <span className="block text-sm font-bold text-muted">{s.bid ? 'Surenchérir ou crier « Menteur ! » ?' : 'C’est à lui·elle d’ouvrir les enchères.'}</span>
          </p>
          <span className={cn('font-display text-2xl font-extrabold tabular-nums', secLeft <= 5 && 'text-tomato')}>{secLeft}</span>
        </motion.div>
      )}

      {isPlayer && !alive && (
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="sticker flex items-center gap-3 bg-sunk p-3">
          <Avatar slug={get(meId).slug} expression={mood(get(meId), 'sad')} size={56} />
          <p className="font-display text-lg leading-tight font-extrabold">
            Plus de dés… Tu es éliminé·e ({s.eliminated.indexOf(meId) + 1}
            <sup>{s.eliminated.indexOf(meId) === 0 ? 'er' : 'e'}</sup> à sortir). Profite du spectacle ! 🍿
          </p>
        </motion.div>
      )}
      {!isPlayer && <p className="text-center font-bold text-muted">Tu regardes la partie 👀</p>}

      <AnimatePresence>
        {s.phase === 'reveal' && s.reveal && (
          <RevealOverlay
            key={`${s.reveal.round}-${s.reveal.kind}`}
            s={s}
            reveal={s.reveal}
            get={get}
            meId={meId}
            isHost={isHost}
            left={left}
            onNext={() => void send(mtrActions.next())}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Table ronde                                                                 */
/* -------------------------------------------------------------------------- */

function TurnRing({ frac, size }: { frac: number; size: number }) {
  const r = size / 2 - 3
  const c = 2 * Math.PI * r
  const color = frac > 0.5 ? '#06D6A0' : frac > 0.2 ? '#FFB703' : '#EF476F'
  return (
    <svg width={size} height={size} className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-90" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--ink)" strokeOpacity=".15" strokeWidth="5" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.max(0, Math.min(1, frac)))}
        style={{ transition: 'stroke-dashoffset .25s linear, stroke .3s' }}
      />
    </svg>
  )
}

function RoundTable({ s, seats, get, meId, left, total }: { s: MtrState; seats: string[]; get: Get; meId: string; left: number; total: number }) {
  const reduce = useReducedMotion()
  const n = seats.length
  const big = n <= 6
  const av = big ? 46 : 38
  const bidder = s.bid ? get(s.bid.by) : null

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[23rem]">
      {/* tapis */}
      <div
        className="absolute inset-[15%] rounded-full border-[4px] border-ink shadow-sticker"
        style={{ background: 'radial-gradient(circle at 40% 35%, #3fbf8f 0%, #1f8a63 55%, #155e45 100%)' }}
      >
        <div className="absolute inset-[6%] rounded-full border-2 border-dashed border-white/25" />
      </div>

      {/* enchère au centre */}
      <div className="absolute inset-[15%] flex flex-col items-center justify-center text-center text-white">
        <AnimatePresence mode="popLayout">
          {s.bid ? (
            <motion.div
              key={`${s.round}-${s.bids.length}`}
              initial={reduce ? { opacity: 0 } : { scale: 2.4, rotate: -14, opacity: 0 }}
              animate={{ scale: 1, rotate: 0, opacity: 1 }}
              exit={{ scale: 0.5, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 14 }}
              className="flex flex-col items-center"
            >
              <div className="flex items-center gap-1.5">
                <span className="font-display text-6xl leading-none font-extrabold tabular-nums" style={{ textShadow: '3px 3px 0 #1f1b2e' }}>
                  {s.bid.qty}
                </span>
                <span className="font-display text-4xl font-extrabold" style={{ textShadow: '2px 2px 0 #1f1b2e' }}>
                  ×
                </span>
                <FaceIcon value={s.bid.face} size={58} className="drop-shadow-[2px_2px_0_#1f1b2e]" />
              </div>
              <span className="mt-1 max-w-[9rem] truncate rounded-full border-2 border-ink bg-surface px-2 text-xs font-extrabold text-text">
                {bidder?.id === meId ? 'ton enchère' : `par ${bidder?.nickname}`}
                {s.bid.auto ? ' ⏱️' : ''}
              </span>
              {s.bid.face === 1 && <span className="mt-0.5 text-[11px] font-extrabold text-sun">PACO : les 1 seuls</span>}
            </motion.div>
          ) : (
            <motion.div key={`open-${s.round}`} initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="flex flex-col items-center gap-1 px-4">
              <span className="font-display text-2xl leading-tight font-extrabold" style={{ textShadow: '2px 2px 0 #1f1b2e' }}>
                Manche {s.round}
              </span>
              <span className="text-xs font-bold text-white/85">{s.total_dice} dés sur la table</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* joueurs */}
      {seats.map((id, i) => {
        const p = get(id)
        const theta = Math.PI / 2 + (2 * Math.PI * i) / n
        const x = 50 + 41 * Math.cos(theta)
        const y = 50 + 40 * Math.sin(theta)
        const out = !s.alive.includes(id)
        const active = s.phase === 'bidding' && s.turn === id
        const isBidder = s.bid?.by === id
        const count = s.dice_count[id] ?? 0
        const expr = out ? mood(p, 'sad') : active ? mood(p, 'think') : isBidder ? mood(p, 'sly') : p.equipped
        return (
          <motion.div
            key={id}
            className="absolute flex w-[4.6rem] -translate-x-1/2 -translate-y-1/2 flex-col items-center"
            style={{ left: `${x}%`, top: `${y}%` }}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: i * 0.05, type: 'spring', stiffness: 300, damping: 16 }}
          >
            <div className="relative flex items-center justify-center" style={{ width: av + 16, height: av + 16 }}>
              {active && <TurnRing frac={left / total} size={av + 16} />}
              <motion.div animate={active && !reduce ? { y: [0, -4, 0] } : { y: 0 }} transition={{ repeat: active ? Infinity : 0, duration: 0.9 }}>
                <Avatar slug={p.slug} expression={expr} size={av} className={cn(out && 'opacity-60 grayscale')} />
              </motion.div>
              {out && <span className="absolute -right-1 -bottom-1 text-lg">💀</span>}
              {isBidder && !out && (
                <span className="absolute -top-1 -right-2 rounded-full border-2 border-ink bg-sun px-1 text-[10px] leading-tight font-extrabold text-[#1f1b2e]">
                  {s.bid?.qty}×{s.bid?.face}
                </span>
              )}
            </div>
            <span className={cn('max-w-full truncate font-display text-xs leading-tight font-extrabold', id === meId && 'text-grape')}>
              {id === meId ? 'Toi' : p.nickname}{s.absent?.[id] ? ' 💤' : ''}
            </span>
            {!out && (
              <motion.span key={count} initial={{ scale: 1.6 }} animate={{ scale: 1 }} className="mt-0.5">
                <HiddenDice n={count} size={big ? 9 : 7} />
              </motion.span>
            )}
          </motion.div>
        )
      })}
    </div>
  )
}

/** Enchères de la manche en cours (les dernières). */
function BidTrail({ s, get }: { s: MtrState; get: Get }) {
  if (s.phase !== 'bidding' || s.bids.length < 2) return null
  const last = s.bids.slice(-6, -1)
  return (
    <div className="-mx-4 flex items-center gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]">
      <span className="shrink-0 text-xs font-bold text-muted">Avant :</span>
      {last.map((b, i) => (
        <motion.span
          key={`${s.round}-${s.bids.length - last.length + i}`}
          initial={{ x: 30, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          className="flex shrink-0 items-center gap-1 rounded-full border-2 border-ink bg-surface py-0.5 pr-2 pl-0.5 text-sm font-extrabold"
        >
          <Avatar slug={get(b.by).slug} expression={get(b.by).equipped} size={20} />
          {b.qty}×<FaceIcon value={b.face} size={16} />
        </motion.span>
      ))}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Mon gobelet : secouer pour lancer                                           */
/* -------------------------------------------------------------------------- */

type RollStage = 'cup' | 'shaking' | 'shown'

function MyDicePanel({ matchId, round, dice, highlight }: { matchId: string; round: number; dice: DieFace[] | null; highlight: number | null }) {
  const reduce = useReducedMotion()
  const [stage, setStage] = useState<RollStage>(() => (readRolled(matchId) >= round ? 'shown' : 'cup'))
  const [animate, setAnimate] = useState(false)
  const timer = useRef(0)
  const stageRef = useRef(stage)

  const roll = useCallback(
    (manual: boolean) => {
      if (stageRef.current !== 'cup') return
      stageRef.current = 'shaking'
      setStage('shaking')
      writeRolled(matchId, round)
      if (manual) {
        playRattle(0.9)
        vibrate([30, 30, 30, 30, 30, 30, 60])
      }
      timer.current = window.setTimeout(
        () => {
          stageRef.current = 'shown'
          setAnimate(true)
          setStage('shown')
          playPour()
        },
        manual && !reduce ? 950 : 150,
      )
    },
    [matchId, round, reduce],
  )
  useEffect(() => () => clearTimeout(timer.current), [])

  // Pas secoué au bout de 5 s : on dévoile quand même.
  useEffect(() => {
    if (stage !== 'cup') return
    const t = window.setTimeout(() => roll(false), 5000)
    return () => clearTimeout(t)
  }, [stage, roll])

  const { status, enable } = useShake(stage === 'cup', () => roll(true))

  const sorted = useMemo(() => (dice ? [...dice].sort((a, b) => a - b) : null), [dice])

  return (
    <div className="sticker relative overflow-hidden bg-surface p-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-display text-lg font-extrabold">Mes dés</span>
        {stage === 'shown' && sorted && highlight != null && (
          <span className="text-xs font-bold text-muted">
            {sorted.filter((d) => matches(d, highlight)).length} compte{sorted.filter((d) => matches(d, highlight)).length > 1 ? 'nt' : ''} pour l’enchère
          </span>
        )}
      </div>

      <div className="relative flex min-h-[7.5rem] items-center justify-center">
        <AnimatePresence mode="wait">
          {stage === 'shown' ? (
            <motion.div key="dice" className="flex flex-wrap items-end justify-center gap-3 py-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              {sorted
                ? sorted.map((d, i) => (
                    <Die3D
                      key={`${round}-${i}`}
                      value={d}
                      size={48}
                      seed={round * 10 + i}
                      rolling={animate}
                      delay={i * 0.07}
                      lit={highlight != null && matches(d, highlight)}
                    />
                  ))
                : Array.from({ length: 5 }, (_, i) => <div key={i} className="size-12 animate-pulse rounded-xl border-2 border-ink/30 bg-sunk" />)}
            </motion.div>
          ) : (
            <motion.button
              key="cup"
              type="button"
              onClick={() => roll(true)}
              className="flex flex-col items-center gap-1"
              initial={{ y: -40, opacity: 0 }}
              animate={
                stage === 'shaking' && !reduce
                  ? { x: [0, -14, 14, -12, 12, -8, 8, 0], rotate: [0, -12, 12, -10, 10, -6, 6, 0], y: 0, opacity: 1 }
                  : { y: [0, -4, 0], opacity: 1 }
              }
              exit={{ y: -90, opacity: 0, rotate: -20 }}
              transition={stage === 'shaking' ? { duration: 0.9 } : { y: { repeat: Infinity, duration: 1.6 }, opacity: { duration: 0.3 } }}
              aria-label="Lancer les dés"
            >
              <Cup size={92} />
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {stage === 'cup' && (
        <div className="mt-1 flex flex-col items-center gap-2">
          <p className="flex items-center gap-1.5 text-center font-display font-extrabold">
            <Vibrate className="size-5" /> Secoue ton téléphone pour lancer !
          </p>
          <div className="flex w-full gap-2">
            {status === 'needs-permission' && (
              <Button variant="secondary" size="sm" fullWidth icon={<Smartphone className="size-4" />} onClick={() => void enable()}>
                Activer le shake
              </Button>
            )}
            <Button size="sm" fullWidth onClick={() => roll(true)}>
              🎲 Lancer
            </Button>
          </div>
          {status === 'denied' && <p className="text-xs text-muted">Capteur refusé : utilise le bouton « Lancer ».</p>}
        </div>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Sélecteur d'enchère                                                         */
/* -------------------------------------------------------------------------- */

function BidPicker({ s, dice, busy, left, total, onSend }: { s: MtrState; dice: DieFace[] | null; busy: boolean; left: number; total: number; onSend: (a: MtrAction) => void }) {
  const reduce = useReducedMotion()
  const bid = s.bid
  const tot = s.total_dice
  const mins = useMemo(() => Object.fromEntries(FACES.map((f) => [f, minQtyFor(f, bid, tot)])) as Record<DieFace, number | null>, [bid, tot])
  const initialFace: DieFace = bid && mins[bid.face] != null ? bid.face : (FACES.find((f) => f !== 1 && mins[f] != null) ?? 1)
  const [face, setFace] = useState<DieFace>(initialFace)
  const [qty, setQty] = useState<number>(mins[initialFace] ?? 1)
  const valid = isValidBid(qty, face, bid, tot)
  const mine = dice ? dice.filter((d) => matches(d, face)).length : null
  const frac = left / total

  const pickFace = (f: DieFace) => {
    const m = mins[f]
    if (m == null) return
    fx.tick()
    setFace(f)
    setQty((q) => (isValidBid(q, f, bid, tot) ? q : m))
  }

  return (
    <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="sticker flex flex-col gap-3 bg-surface p-3">
      <div className="flex items-center justify-between">
        <span className="font-display text-xl font-extrabold">À toi ! {bid ? 'Surenchéris…' : 'Ouvre les enchères'}</span>
        <span className={cn('font-display text-xl font-extrabold tabular-nums', frac < 0.2 && 'text-tomato')}>{Math.ceil(left / 1000)} s</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full border-2 border-ink bg-sunk">
        <div
          className="h-full transition-[width] duration-200 ease-linear"
          style={{ width: `${Math.max(0, Math.min(1, frac)) * 100}%`, background: frac > 0.5 ? '#06D6A0' : frac > 0.2 ? '#FFB703' : '#EF476F' }}
        />
      </div>

      {/* quantité */}
      <div className="flex items-center justify-center gap-3">
        <button
          type="button"
          aria-label="Moins"
          disabled={!isValidBid(qty - 1, face, bid, tot)}
          onClick={() => {
            fx.tick()
            setQty((q) => q - 1)
          }}
          className="flex size-12 items-center justify-center rounded-full border-[3px] border-ink bg-surface shadow-sticker-sm active:translate-x-0.5 active:translate-y-0.5 active:shadow-none disabled:opacity-30"
        >
          <Minus className="size-6" strokeWidth={3} />
        </button>
        <div className="flex items-center gap-2">
          <motion.span key={qty} initial={{ scale: 1.4 }} animate={{ scale: 1 }} className="w-14 text-center font-display text-5xl leading-none font-extrabold tabular-nums">
            {qty}
          </motion.span>
          <span className="font-display text-3xl font-extrabold">×</span>
          <motion.div key={face} initial={{ rotate: -90, scale: 0.5 }} animate={{ rotate: 0, scale: 1 }}>
            <FaceIcon value={face} size={52} />
          </motion.div>
        </div>
        <button
          type="button"
          aria-label="Plus"
          disabled={qty + 1 > tot}
          onClick={() => {
            fx.tick()
            setQty((q) => q + 1)
          }}
          className="flex size-12 items-center justify-center rounded-full border-[3px] border-ink bg-surface shadow-sticker-sm active:translate-x-0.5 active:translate-y-0.5 active:shadow-none disabled:opacity-30"
        >
          <Plus className="size-6" strokeWidth={3} />
        </button>
      </div>

      {/* valeur */}
      <div className="grid grid-cols-6 gap-1.5">
        {FACES.map((f) => {
          const m = mins[f]
          const disabled = m == null
          const sel = f === face
          return (
            <button
              key={f}
              type="button"
              disabled={disabled}
              onClick={() => pickFace(f)}
              className={cn(
                'flex flex-col items-center gap-0.5 rounded-xl border-[3px] border-ink p-1 transition-all',
                sel ? 'scale-105 bg-sun shadow-sticker-sm' : 'bg-sunk',
                disabled && 'opacity-30 grayscale',
              )}
              aria-pressed={sel}
              aria-label={`Valeur ${f}`}
            >
              <FaceIcon value={f} size={34} tone={disabled ? 'dim' : 'ivory'} />
              <span className="text-[10px] leading-none font-extrabold">{disabled ? '—' : `≥ ${m}`}</span>
            </button>
          )
        })}
      </div>
      <p className="text-center text-xs leading-snug text-muted">
        {face === 1
          ? 'Paco ! Sur les 1, seuls les 1 comptent.'
          : bid?.face === 1
            ? `Pour quitter les 1 : au moins ${2 * bid.qty + 1} dés.`
            : 'Les 1 sont des jokers : ils comptent pour toutes les valeurs.'}
        {mine != null && ` Tu en as ${mine}.`}
      </p>

      <Button size="lg" fullWidth disabled={!valid || busy} onClick={() => onSend(mtrActions.bid(qty, face))}>
        Annoncer {qty} × <FaceIcon value={face} size={30} />
      </Button>

      {bid && (
        <div className="flex gap-2">
          <motion.div
            className="flex-1"
            animate={reduce ? undefined : { rotate: [0, -2, 2, -2, 2, 0], x: [0, -2, 2, -2, 2, 0] }}
            transition={{ repeat: Infinity, duration: 0.6, repeatDelay: 0.9 }}
          >
            <Button
              size="lg"
              variant="danger"
              fullWidth
              disabled={busy}
              onClick={() => {
                vibrate([40, 30, 80])
                onSend(mtrActions.liar())
              }}
              className="text-3xl tracking-wide"
            >
              MENTEUR !
            </Button>
          </motion.div>
          {s.pile_enabled && (
            <Button
              size="lg"
              variant="secondary"
              disabled={busy}
              icon={<Target className="size-6" />}
              onClick={() => {
                vibrate(30)
                onSend(mtrActions.pile())
              }}
            >
              Pile !
            </Button>
          )}
        </div>
      )}
    </motion.div>
  )
}

/* -------------------------------------------------------------------------- */
/* Révélation                                                                  */
/* -------------------------------------------------------------------------- */

function useElapsed(): number {
  const [t, setT] = useState(0)
  useEffect(() => {
    const t0 = performance.now()
    const id = window.setInterval(() => setT(performance.now() - t0), 80)
    return () => clearInterval(id)
  }, [])
  return t
}

function RevealOverlay({ s, reveal, get, meId, isHost, left, onNext }: { s: MtrState; reveal: MtrReveal; get: Get; meId: string; isHost: boolean; left: number; onNext: () => void }) {
  const reduce = useReducedMotion()
  const t = useElapsed()
  const bid: MtrBid = reveal.bid
  const caller = get(reveal.caller)
  const bidder = get(bid.by)

  // Lignes dans l'ordre de la table, dés triés ; ordre d'allumage des dés comptés.
  const rows = useMemo(() => {
    let k = 0
    return s.order
      .filter((id) => reveal.dice[id])
      .map((id) => ({
        id,
        dice: [...reveal.dice[id]].sort((a, b) => a - b).map((d) => ({ d, lit: matches(d, bid.face) ? k++ : -1 })),
      }))
  }, [s.order, reveal.dice, bid.face])

  const lifted = t > 700
  const lit = t < REVEAL_LIFT_MS ? 0 : Math.min(reveal.count, Math.floor((t - REVEAL_LIFT_MS) / REVEAL_STEP_MS) + 1)
  const verdict = t >= REVEAL_LIFT_MS + reveal.count * REVEAL_STEP_MS + 500
  const reached = lit >= bid.qty

  // sons
  const prevLit = useRef(0)
  useEffect(() => {
    if (lit > prevLit.current) {
      prevLit.current = lit
      playCount(lit)
      vibrate(8)
    }
  }, [lit])
  useEffect(() => {
    fx.whoosh()
    vibrate([60, 40, 60])
  }, [])
  useEffect(() => {
    if (!verdict) return
    const meLost = reveal.loser === meId
    if (meLost) fx.fail()
    else fx.success()
    if (reveal.final) burst({ x: 0.5, y: 0.35 }, 140)
  }, [verdict, reveal.loser, reveal.final, meId])

  const loser = reveal.loser ? get(reveal.loser) : null
  const gainer = reveal.gainer ? get(reveal.gainer) : null
  const winnerId = reveal.final ? s.alive[0] : null
  const winner = winnerId ? get(winnerId) : null
  const shout = reveal.kind === 'liar' ? 'MENTEUR !' : 'PILE !'
  // Chibi du verdict : vainqueur « cool » ; perdant en colère (en pleurs s'il est éliminé).
  const featured = winner ?? loser ?? gainer
  const featuredExpr = !featured
    ? 'joie'
    : winner
      ? pickExpression(featured, 'cool', 'pouces', 'joie')
      : loser
        ? reveal.eliminated
          ? pickExpression(featured, 'pleurs', 'boude', 'colere')
          : pickExpression(featured, 'colere', 'boude', 'pleurs')
        : pickExpression(featured, 'cool', 'joie')

  const headline =
    reveal.kind === 'liar'
      ? reveal.loser === reveal.caller
        ? `${bidder.id === meId ? 'Tu disais' : `${bidder.nickname} disait`} vrai !`
        : `${bidder.id === meId ? 'Tu as' : `${bidder.nickname} a`} bluffé !`
      : reveal.exact
        ? 'Pile dans le mille !'
        : 'Raté, pas pile !'
  const sub = loser
    ? reveal.eliminated
      ? `${loser.id === meId ? 'Tu perds' : `${loser.nickname} perd`} son dernier dé… éliminé·e !`
      : `${loser.id === meId ? 'Tu perds' : `${loser.nickname} perd`} un dé.`
    : gainer
      ? `${gainer.id === meId ? 'Tu récupères' : `${gainer.nickname} récupère`} un dé !`
      : `${caller.nickname} a déjà 5 dés : rien ne change.`

  return (
    <motion.div
      className="fixed inset-0 z-40 overflow-y-auto bg-ink/80 px-4 pt-safe pb-safe backdrop-blur-[2px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="mx-auto flex min-h-full max-w-md flex-col gap-3 py-4">
        {/* Le cri */}
        <motion.div
          initial={reduce ? { opacity: 0 } : { scale: 3, rotate: -18, opacity: 0 }}
          animate={{ scale: 1, rotate: -4, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 12 }}
          className={cn('sticker flex items-center gap-3 p-2 pr-4 text-white', reveal.kind === 'liar' ? 'bg-tomato' : 'bg-grape')}
        >
          <Avatar slug={caller.slug} expression={mood(caller, reveal.kind === 'liar' ? 'angry' : 'sly')} size={52} />
          <div className="flex-1">
            <p className="font-display text-3xl leading-none font-extrabold" style={{ textShadow: '3px 3px 0 #1f1b2e' }}>
              {shout}
            </p>
            <p className="text-sm font-bold">
              {caller.id === meId ? 'Tu doutes' : `${caller.nickname} doute`} de {bidder.id === meId ? 'ton ' : 'l’'}enchère
              {bidder.id === meId ? '' : ` de ${bidder.nickname}`}
              {reveal.auto ? ' (temps écoulé ⏱️)' : ''}
            </p>
          </div>
        </motion.div>

        {/* Enchère + compteur */}
        <div className="sticker flex items-center justify-around bg-surface p-3">
          <div className="flex flex-col items-center">
            <span className="text-xs font-bold text-muted">Enchère</span>
            <div className="flex items-center gap-1">
              <span className="font-display text-4xl font-extrabold">{bid.qty}</span>
              <span className="font-display text-2xl font-extrabold">×</span>
              <FaceIcon value={bid.face} size={40} />
            </div>
          </div>
          <div className="flex flex-col items-center">
            <span className="text-xs font-bold text-muted">Sur la table</span>
            <motion.span
              key={lit}
              initial={{ scale: 1.8 }}
              animate={{ scale: 1 }}
              className={cn('font-display text-5xl leading-none font-extrabold tabular-nums', reached ? 'text-mint' : 'text-text')}
            >
              {lit}
            </motion.span>
          </div>
        </div>
        <p className="-mt-1 text-center text-xs font-bold text-white/80">
          {bid.face === 1 ? 'Paco : seuls les 1 comptent.' : `On compte les ${bid.face} et les 1 (jokers).`}
        </p>

        {/* Les gobelets se lèvent */}
        <div className="flex flex-col gap-2">
          {rows.map((row, ri) => {
            const p = get(row.id)
            const isLoser = verdict && reveal.loser === row.id
            const isGainer = verdict && reveal.gainer === row.id
            return (
              <motion.div
                key={row.id}
                initial={{ x: ri % 2 ? 60 : -60, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ delay: ri * 0.05 }}
                className={cn('sticker-sm relative flex items-center gap-2 rounded-2xl bg-surface p-2', isLoser && 'ring-4 ring-tomato', isGainer && 'ring-4 ring-mint')}
              >
                <div className="flex w-14 shrink-0 flex-col items-center">
                  <Avatar slug={p.slug} expression={isLoser ? mood(p, 'angry') : row.id === bid.by ? mood(p, 'sly') : p.equipped} size={36} />
                  <span className="max-w-full truncate text-[11px] font-extrabold">{row.id === meId ? 'Toi' : p.nickname}</span>
                </div>
                <div className="relative flex min-h-12 flex-1 flex-wrap items-center gap-1.5">
                  {row.dice.map((x, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, scale: 0.6 }}
                      animate={lifted ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.6 }}
                      transition={{ delay: lifted ? ri * 0.06 + 0.15 + i * 0.03 : 0, type: 'spring', stiffness: 400, damping: 18 }}
                    >
                      <Die3D
                        value={x.d}
                        size={rows.length > 6 ? 30 : 36}
                        seed={reveal.round * 100 + ri * 10 + i}
                        lit={x.lit >= 0 && x.lit < lit}
                        dim={verdict && x.lit < 0}
                      />
                    </motion.div>
                  ))}
                  {/* dé perdu qui s'envole */}
                  {isLoser && !reduce && (
                    <motion.div
                      className="pointer-events-none absolute right-2"
                      initial={{ y: 0, x: 0, rotate: 0, opacity: 1, scale: 1 }}
                      animate={{ y: -220, x: 90, rotate: 540, opacity: 0, scale: 1.6 }}
                      transition={{ duration: 1.4, ease: 'easeIn' }}
                    >
                      <Die3D value={6} size={34} seed={7} />
                    </motion.div>
                  )}
                  {isGainer && (
                    <motion.div initial={{ scale: 0, rotate: -180 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 12 }}>
                      <span className="rounded-full border-2 border-ink bg-mint px-2 py-0.5 text-sm font-extrabold text-[#1f1b2e]">+1 🎲</span>
                    </motion.div>
                  )}
                  {/* gobelet */}
                  <motion.div
                    className="pointer-events-none absolute inset-0 flex items-center justify-center"
                    initial={{ y: 0, opacity: 1 }}
                    animate={lifted ? { y: -70, opacity: 0, rotate: ri % 2 ? 12 : -12 } : reduce ? { y: 0 } : { y: [0, -3, 0], x: [0, -2, 2, 0] }}
                    transition={lifted ? { duration: 0.55, delay: ri * 0.06, ease: 'easeIn' } : { repeat: Infinity, duration: 0.35 }}
                  >
                    <Cup size={46} color={p.color} />
                  </motion.div>
                </div>
              </motion.div>
            )
          })}
        </div>

        {/* Verdict */}
        <AnimatePresence>
          {verdict && (
            <motion.div
              initial={reduce ? { opacity: 0 } : { scale: 0.3, y: 60, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 14 }}
              className={cn('sticker flex items-center gap-3 p-3', loser ? 'bg-sun text-[#1f1b2e]' : 'bg-mint text-[#1f1b2e]')}
            >
              {featured && (
                <motion.div
                  animate={reduce ? undefined : winner ? { y: [0, -8, 0] } : { rotate: [-4, 4, -4] }}
                  transition={{ repeat: Infinity, duration: winner ? 0.9 : 0.5 }}
                >
                  <ChibiImage slug={featured.slug} expression={featuredExpr} size={96} />
                </motion.div>
              )}
              {winner && loser && (
                <ChibiImage slug={loser.slug} expression={pickExpression(loser, 'pleurs', 'boude', 'colere')} size={56} className="-ml-4 self-end" />
              )}
              <div className="flex-1">
                <p className="font-display text-2xl leading-tight font-extrabold">{headline}</p>
                <p className="font-bold">
                  {reveal.count} dé{reveal.count > 1 ? 's' : ''} pour {bid.qty} annoncé{bid.qty > 1 ? 's' : ''}. {sub}
                </p>
                {winner && (
                  <p className="mt-1 font-display text-xl leading-tight font-extrabold">
                    🏆 {winner.id === meId ? 'Tu remportes' : `${winner.nickname} remporte`} la partie !
                  </p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-auto flex items-center gap-2">
          <p className="flex-1 text-sm font-bold text-white/85">
            {reveal.final ? 'Résultats' : 'Manche suivante'} dans {Math.ceil(left / 1000)} s
            {!reveal.final && reveal.next_starter && ` · ${get(reveal.next_starter).nickname} commence`}
          </p>
          {isHost && verdict && (
            <Button size="sm" onClick={onNext}>
              {reveal.final ? 'Résultats' : 'Suivant'}
            </Button>
          )}
        </div>
      </div>
    </motion.div>
  )
}
