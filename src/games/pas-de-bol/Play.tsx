import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Hand, Megaphone, RotateCcw, RotateCw, SkipForward, Siren } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { BottomSheet } from '@/components/ui/Modal'
import { supabase } from '@/lib/supabase'
import { fx, vibrate } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import { mood, playerOrPlaceholder } from '@/features/soiree/players'
import { serverNow, useCountdown } from '@/features/soiree/useServerClock'
import type { GamePlayProps, PlayerInfo } from '../types'
import { ColorGlyph, PdbCardView } from './Card'
import { DrawFlights, PeekModal, SplashLayer, useLogSplashes } from './Effects'
import { COLOR_META, PDB_COLORS, PERSOS, hashOf, isPlayable, needsColor, needsTarget, pdbActions, sortHand } from './rules'
import type { PdbAction, PdbCard, PdbColor, PdbSecret, PdbState } from './types'

type Get = (id: string) => PlayerInfo

/* -------------------------------------------------------------------------- */
/* Mon secret (main) : relu dès que state.hand_ver[moi] augmente               */
/* -------------------------------------------------------------------------- */

/**
 * Le moteur met à jour `match_secrets` en cours de partie, mais useMatch ne relit
 * le secret qu'au (re)chargement : on le relit nous-mêmes quand le state public
 * annonce une nouvelle version de notre main (`hand_ver`).
 */
function useMySecret(matchId: string, propSecret: unknown, ver: number | undefined): PdbSecret | null {
  const [fetched, setFetched] = useState<PdbSecret | null>(null)
  const prop = propSecret && typeof propSecret === 'object' && Array.isArray((propSecret as PdbSecret).hand) ? (propSecret as PdbSecret) : null
  const best = !fetched ? prop : !prop ? fetched : (fetched.v ?? 0) >= (prop.v ?? 0) ? fetched : prop
  const bestV = best?.v ?? 0

  useEffect(() => {
    if (!ver || ver <= bestV) return
    let cancelled = false
    let timer = 0
    const load = async (attempt: number) => {
      const { data } = await supabase.from('match_secrets').select('secret').eq('match_id', matchId).maybeSingle()
      if (cancelled) return
      const sec = (data?.secret ?? null) as unknown as PdbSecret | null
      if (sec && Array.isArray(sec.hand)) setFetched((cur) => (!cur || (sec.v ?? 0) > (cur.v ?? 0) ? sec : cur))
      if ((!sec || (sec.v ?? 0) < ver) && attempt < 4) timer = window.setTimeout(() => void load(attempt + 1), 300 * (attempt + 1))
    }
    void load(0)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [matchId, ver, bestV])

  return best
}

/* -------------------------------------------------------------------------- */
/* Écran de jeu                                                                */
/* -------------------------------------------------------------------------- */

type Choice = { card: PdbCard; step: 'color' | 'target' }

/** Gros symbole qui éclate sur la défausse quand une carte spéciale est posée. */
const IMPACT: Partial<Record<PdbCard['kind'], string>> = { plus2: '+2', wild4: '+4', reverse: '⇄', skip: '⊘', wild: '🌈' }

export default function PasDeBolPlay({ matchId, state, secret, meId, players, act }: GamePlayProps) {
  const s = state as unknown as PdbState
  const get = useCallback((id: string) => playerOrPlaceholder(players, id), [players])
  const isPlayer = s.players.includes(meId)
  const sec = useMySecret(matchId, secret, isPlayer ? s.hand_ver?.[meId] : undefined)
  const reduce = useReducedMotion()

  const myTurn = s.phase === 'playing' && s.turn === meId
  const left = useCountdown(s.phase === 'playing' ? s.deadline : null)
  const total = (s.turn_seconds || 30) * 1000
  const [busy, setBusy] = useState(false)
  const [choice, setChoice] = useState<Choice | null>(null)
  const [ghost, setGhost] = useState<string | null>(null) // carte envoyée, en attente de confirmation

  const send = useCallback(
    async (a: PdbAction) => {
      setBusy(true)
      const r = await act(a)
      setBusy(false)
      return r
    },
    [act],
  )

  /* ---- ticks : à l'échéance, n'importe quel client prévient le serveur ---- */
  useEffect(() => {
    if (s.phase !== 'playing' || !s.deadline) return
    const end = new Date(s.deadline).getTime()
    let timer = 0
    const fire = () => {
      void act(pdbActions.tick())
      timer = window.setTimeout(fire, 4000 + Math.random() * 2000)
    }
    // Le joueur dont c'est le tour envoie en premier ; les autres en renfort, en décalé.
    const delay = Math.max(0, end - serverNow()) + (s.turn === meId ? 200 : 1500 + Math.random() * 2000)
    timer = window.setTimeout(fire, delay)
    return () => clearTimeout(timer)
  }, [s.deadline, s.phase, s.turn, meId, act])

  /* ---- sons du tour ---- */
  const lastTurnSeq = useRef(s.turn_seq)
  useEffect(() => {
    if (s.turn_seq === lastTurnSeq.current) return
    lastTurnSeq.current = s.turn_seq
    if (s.turn === meId) {
      fx.success()
      vibrate([20, 40, 20])
    }
  }, [s.turn_seq, s.turn, meId])
  const secLeft = Math.ceil(left / 1000)
  useEffect(() => {
    if (myTurn && secLeft > 0 && secLeft <= 5) fx.tick()
  }, [myTurn, secLeft])

  const { current: splash, skip } = useLogSplashes(s, meId)

  /* ---- main ---- */
  const hand = useMemo(() => sortHand(sec?.hand ?? []), [sec])
  const drawnId = myTurn && s.turn_phase === 'drawn' ? (sec?.drawn ?? null) : null
  const canPlay = (c: PdbCard) => myTurn && !busy && (drawnId ? c.id === drawnId : true) && isPlayable(s, c)
  const anyPlayable = myTurn && hand.some((c) => canPlay(c))

  const play = async (c: PdbCard, extra: { color?: PdbColor; target?: string } = {}) => {
    if (!canPlay(c)) {
      if (myTurn) {
        fx.fail()
        vibrate(40)
      }
      return
    }
    if (needsColor(c) && !extra.color) return setChoice({ card: c, step: 'color' })
    if (needsTarget(c) && !extra.target) return setChoice({ card: c, step: 'target' })
    setChoice(null)
    setGhost(c.id)
    fx.slap()
    const r = await send(pdbActions.play(c.id, extra))
    setGhost(null)
    if (!r) fx.fail()
  }

  const draw = async () => {
    if (!myTurn || s.turn_phase !== 'play' || busy) return
    fx.deal()
    await send(pdbActions.draw())
  }

  const meOut = s.out.includes(meId)
  const myLastCard = s.last_card?.[meId]
  const openOthers = Object.entries(s.last_card ?? {})
    .filter(([id, st]) => st === 'open' && id !== meId)
    .map(([id]) => id)
  const seats = useMemo(() => {
    const i = Math.max(0, s.order.indexOf(meId))
    return [...s.order.slice(i), ...s.order.slice(0, i)]
  }, [s.order, meId])

  // Origine de la carte qui vole vers la défausse : le siège du joueur qui l'a posée.
  const lastPlay = [...s.log].reverse().find((e) => e.t === 'play')
  const fromSeat = lastPlay && lastPlay.t === 'play' ? seats.indexOf(lastPlay.p) : -1
  const flyFrom = !lastPlay || lastPlay.t !== 'play' || reduce
    ? { x: 0, y: 0 }
    : lastPlay.p === meId
      ? { x: 0, y: 260 }
      : { x: ((fromSeat + 0.5) / Math.max(1, seats.length) - 0.5) * 300, y: -220 }

  return (
    <div className="flex flex-col gap-3 pb-4">
      {/* 2 à 4 joueurs : les adversaires en face (dos de cartes en éventail) ; au-delà : pastilles + nombre de cartes */}
      {s.players.length <= 4 ? (
        <Opponents s={s} seats={seats} get={get} meId={meId} left={left} total={total} canDenounce={isPlayer} onDenounce={(id) => void send(pdbActions.denounce(id))} busy={busy} />
      ) : (
        <PlayerRail s={s} seats={seats} get={get} meId={meId} left={left} total={total} canDenounce={isPlayer} onDenounce={(id) => void send(pdbActions.denounce(id))} busy={busy} />
      )}

      <Table s={s} get={get} meId={meId} flyFrom={flyFrom} canDraw={myTurn && s.turn_phase === 'play' && !busy} shakeDraw={myTurn && s.turn_phase === 'play' && !anyPlayable} onDraw={() => void draw()} />

      <TurnBanner s={s} get={get} meId={meId} left={left} total={total} />

      {/* Dénonciation : quelqu'un a oublié « Dernière carte ! » */}
      <AnimatePresence>
        {isPlayer &&
          openOthers.map((id) => (
            <motion.button
              key={id}
              type="button"
              initial={{ scale: 0, rotate: -8 }}
              animate={reduce ? { scale: 1, rotate: 0 } : { scale: 1, rotate: [-2, 2, -2] }}
              exit={{ scale: 0 }}
              transition={{ rotate: { repeat: Infinity, duration: 0.5 }, scale: { type: 'spring', stiffness: 400, damping: 14 } }}
              disabled={busy}
              onClick={() => {
                fx.pop()
                void send(pdbActions.denounce(id))
              }}
              className="sticker flex items-center gap-3 bg-tomato p-2 pr-4 text-left text-white"
            >
              <Avatar slug={get(id).slug} expression={mood(get(id), 'sly')} size={44} />
              <span className="flex-1 font-display text-lg leading-tight font-extrabold">{get(id).nickname} n’a pas dit « Dernière carte ! »</span>
              <span className="flex items-center gap-1 rounded-full border-2 border-ink bg-sun px-3 py-1 font-display font-extrabold text-[#1f1b2e]">
                <Siren className="size-4" /> Dénoncer !
              </span>
            </motion.button>
          ))}
      </AnimatePresence>

      {isPlayer && myLastCard === 'open' && (
        <motion.div initial={{ scale: 0 }} animate={reduce ? { scale: 1 } : { scale: [1, 1.06, 1] }} transition={{ repeat: Infinity, duration: 0.8 }}>
          <Button
            size="lg"
            variant="danger"
            fullWidth
            disabled={busy}
            icon={<Megaphone className="size-7" />}
            onClick={() => {
              vibrate([30, 30, 60])
              void send(pdbActions.lastCard())
            }}
          >
            Dernière carte !
          </Button>
        </motion.div>
      )}

      {isPlayer && !meOut && (
        <>
          <MyHand hand={hand} canPlay={canPlay} myTurn={myTurn} drawnId={drawnId} ghost={ghost} onPlay={(c) => void play(c)} me={get(meId)} />
          {myTurn && (
            <div className="flex gap-2">
              {s.turn_phase === 'drawn' ? (
                <Button fullWidth variant="secondary" disabled={busy} icon={<SkipForward className="size-5" />} onClick={() => void send(pdbActions.pass())}>
                  Garder et passer
                </Button>
              ) : (
                <Button
                  fullWidth
                  variant={s.pending_draw > 0 ? 'danger' : anyPlayable ? 'secondary' : 'primary'}
                  disabled={busy}
                  icon={<Hand className="size-5" />}
                  onClick={() => void draw()}
                >
                  {s.pending_draw > 0 ? `Piocher ${s.pending_draw} cartes` : 'Piocher'}
                </Button>
              )}
            </div>
          )}
        </>
      )}

      {isPlayer && meOut && (
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="sticker flex items-center gap-3 bg-mint p-3 text-[#1f1b2e]">
          <Avatar slug={get(meId).slug} expression={mood(get(meId), 'proud')} size={56} />
          <p className="font-display text-lg leading-tight font-extrabold">
            Tu es sorti·e n°{s.out.indexOf(meId) + 1} ! 🎉 Regarde qui va avoir… pas de bol.
          </p>
        </motion.div>
      )}
      {!isPlayer && <p className="text-center font-bold text-muted">Tu regardes la partie 👀</p>}

      <ChoiceSheets
        choice={choice}
        s={s}
        get={get}
        meId={meId}
        hand={hand}
        onClose={() => setChoice(null)}
        onColor={(c, color) => void play(c, { color })}
        onTarget={(c, target) => void play(c, { target })}
      />
      <PeekModal peek={sec?.peek} get={get} />
      <DrawFlights s={s} meId={meId} />
      <SplashLayer splash={splash} get={get} meId={meId} onSkip={skip} />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Les joueurs autour de la table                                              */
/* -------------------------------------------------------------------------- */

function TurnRing({ frac, size }: { frac: number; size: number }) {
  const r = size / 2 - 3
  const c = 2 * Math.PI * r
  const color = frac > 0.5 ? '#06D6A0' : frac > 0.2 ? '#FFB703' : '#EF476F'
  return (
    <svg width={size} height={size} className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-90" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--ink)" strokeOpacity=".15" strokeWidth="5" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(1, frac)))} style={{ transition: 'stroke-dashoffset .25s linear, stroke .3s' }} />
    </svg>
  )
}

function PlayerRail({ s, seats, get, meId, left, total, canDenounce, onDenounce, busy }: { s: PdbState; seats: string[]; get: Get; meId: string; left: number; total: number; canDenounce: boolean; onDenounce: (id: string) => void; busy: boolean }) {
  const reduce = useReducedMotion()
  return (
    <div className="relative">
      <div className="-mx-4 flex gap-1 overflow-x-auto px-4 pt-2 pb-1 [scrollbar-width:none]">
        {seats.map((id, i) => {
          const p = get(id)
          const active = s.turn === id && s.phase === 'playing'
          const out = s.out.includes(id)
          const n = s.counts[id] ?? 0
          const lc = s.last_card?.[id]
          const expr = out ? mood(p, 'proud') : active ? mood(p, 'think') : n === 1 ? mood(p, 'sly') : n >= 12 ? mood(p, 'sad') : p.equipped
          return (
            <motion.div
              key={id}
              initial={{ y: -30, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: i * 0.04 }}
              className={cn('flex w-[4.4rem] shrink-0 flex-col items-center gap-0.5', out && 'opacity-70')}
            >
              <div data-seat={id} className="relative flex size-16 items-center justify-center">
                {active && <TurnRing frac={left / total} size={64} />}
                <motion.div animate={active && !reduce ? { y: [0, -4, 0] } : { y: 0 }} transition={{ repeat: active ? Infinity : 0, duration: 0.9 }}>
                  <Avatar slug={p.slug} expression={expr} size={48} className={cn(out && 'grayscale-[0.4]')} />
                </motion.div>
                {/* nombre de cartes */}
                {!out ? (
                  <motion.span
                    key={n}
                    initial={{ scale: 1.8 }}
                    animate={{ scale: 1 }}
                    className={cn(
                      'absolute -right-0.5 bottom-0 flex h-6 min-w-6 items-center justify-center rounded-md border-2 border-ink px-1 font-display text-sm font-extrabold',
                      n === 1 ? 'bg-tomato text-white' : 'bg-surface',
                    )}
                  >
                    {n}
                  </motion.span>
                ) : (
                  <span className="absolute -right-1 bottom-0 text-xl">{['🏆', '🥈', '🥉'][s.out.indexOf(id)] ?? '🎉'}</span>
                )}
                {lc && (
                  <span className={cn('absolute -top-1 -left-1 rounded-full border-2 border-ink px-1 text-[10px] leading-tight font-extrabold', lc === 'safe' ? 'bg-sun text-[#1f1b2e]' : 'bg-tomato text-white')}>
                    {lc === 'safe' ? '1 !' : '1 ?'}
                  </span>
                )}
              </div>
              <span className={cn('max-w-full truncate text-xs font-extrabold', id === meId && 'text-grape')}>{id === meId ? 'Toi' : p.nickname}{s.absent?.[id] ? ' 💤 absent' : ''}</span>
              {canDenounce && lc === 'open' && id !== meId && (
                <button type="button" disabled={busy} onClick={() => onDenounce(id)} className="rounded-full border-2 border-ink bg-tomato px-1.5 text-[10px] font-extrabold text-white shadow-sticker-sm">
                  Dénoncer !
                </button>
              )}
            </motion.div>
          )
        })}
      </div>
      {/* sens du jeu */}
      <div className="flex items-center justify-center gap-1 text-muted" aria-label={s.direction === 1 ? 'Sens du jeu : vers la droite' : 'Sens du jeu : vers la gauche'}>
        {Array.from({ length: 7 }, (_, i) => (
          <motion.span
            key={`${s.direction}-${i}`}
            className="font-display text-lg leading-none font-extrabold"
            initial={{ opacity: 0.2 }}
            animate={reduce ? { opacity: 0.6 } : { opacity: [0.2, 1, 0.2] }}
            transition={{ repeat: Infinity, duration: 1.2, delay: (s.direction === 1 ? i : 6 - i) * 0.12 }}
          >
            {s.direction === 1 ? '›' : '‹'}
          </motion.span>
        ))}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Le centre de la table : pioche, défausse, couleur, sens, cumul              */
/* -------------------------------------------------------------------------- */

function Table({ s, get, meId, flyFrom, canDraw, shakeDraw, onDraw }: { s: PdbState; get: Get; meId: string; flyFrom: { x: number; y: number }; canDraw: boolean; shakeDraw: boolean; onDraw: () => void }) {
  const reduce = useReducedMotion()
  const color = COLOR_META[s.color]
  const under = s.pile.slice(0, -1)
  const top = s.top
  const lastDraw = [...s.log].reverse().find((e) => e.t === 'draw')
  return (
    <motion.div
      className="sticker relative flex min-h-[15rem] items-center justify-center gap-8 overflow-hidden p-4"
      animate={{ backgroundColor: `${color.hex}40` }}
      transition={{ duration: 0.5 }}
    >
      <div className="pointer-events-none absolute inset-0 opacity-40" style={{ backgroundImage: 'radial-gradient(var(--dot) 2px, transparent 2px)', backgroundSize: '18px 18px' }} />

      {/* couleur demandée */}
      <motion.div key={s.color} initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 14 }} className="absolute top-2 left-2 flex items-center gap-1 rounded-full border-2 border-ink px-2 py-0.5 font-display text-sm font-extrabold" style={{ backgroundColor: color.hex, color: color.text }}>
        <ColorGlyph color={s.color} size={16} /> {color.label}
      </motion.div>

      {/* sens */}
      <div className="absolute top-2 right-2 flex items-center gap-1 rounded-full border-2 border-ink bg-surface px-2 py-0.5 text-sm font-extrabold">
        <motion.span
          key={s.direction}
          initial={{ rotate: s.direction * -180, scale: 1.6 }}
          animate={reduce ? { rotate: 0, scale: 1 } : { rotate: s.direction * 360, scale: 1 }}
          transition={reduce ? undefined : { rotate: { repeat: Infinity, duration: 3, ease: 'linear' }, scale: { type: 'spring' } }}
          className="inline-flex"
        >
          {s.direction === 1 ? <RotateCw className="size-4" /> : <RotateCcw className="size-4" />}
        </motion.span>
        {s.direction === 1 ? 'Horaire' : 'Inverse'}
      </div>

      {/* pioche */}
      <motion.button
        type="button"
        onClick={onDraw}
        disabled={!canDraw}
        aria-label={`Pioche (${s.draw_count} cartes)`}
        data-pdb-pile
        className="relative mt-4 disabled:cursor-default"
        animate={shakeDraw && !reduce ? { rotate: [0, -6, 6, -4, 4, 0], y: [0, -4, 0] } : { rotate: 0 }}
        transition={shakeDraw ? { repeat: Infinity, duration: 0.9, repeatDelay: 0.6 } : undefined}
        whileTap={canDraw ? { scale: 0.92 } : undefined}
      >
        {[2, 1].map((d) => (
          <div key={d} className="absolute" style={{ top: -d * 3, left: d * 3 }}>
            <PdbCardView back w={70} />
          </div>
        ))}
        <motion.div key={lastDraw?.n ?? 0} initial={lastDraw && !reduce ? { y: -12, rotate: -6 } : false} animate={{ y: 0, rotate: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 10 }}>
          <PdbCardView back w={70} glow={canDraw && shakeDraw} />
        </motion.div>
        <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full border-2 border-ink bg-surface px-2 font-display text-xs font-extrabold whitespace-nowrap">{s.draw_count}</span>
      </motion.button>

      {/* défausse */}
      <div className="relative mt-4" style={{ width: 92, height: 133 }}>
        {IMPACT[top.kind] && !reduce && (
          <motion.span
            key={`impact-${top.id}`}
            className="pointer-events-none absolute top-1/2 left-1/2 z-30 -translate-x-1/2 -translate-y-1/2 font-display text-5xl font-extrabold text-white"
            style={{ WebkitTextStroke: '3px #1f1b2e', paintOrder: 'stroke fill', textShadow: '3px 3px 0 #1f1b2e' }}
            initial={{ scale: 0.2, opacity: 1, rotate: -15 }}
            animate={{ scale: [0.2, 1.5, 1.9], opacity: [1, 1, 0], rotate: [-15, 6, 0] }}
            transition={{ duration: 0.9 }}
          >
            {IMPACT[top.kind]}
          </motion.span>
        )}
        {under.map((c, i) => {
          const h = hashOf(c.id + i)
          return (
            <div key={`${c.id}-${i}`} className="absolute top-0 left-0" style={{ transform: `rotate(${(h % 30) - 15}deg) translate(${(h % 9) - 4}px, ${(h % 7) - 3}px)` }}>
              <PdbCardView card={c} w={92} />
            </div>
          )
        })}
        <AnimatePresence initial={false}>
          <motion.div
            key={top.id}
            className="absolute top-0 left-0 z-10"
            initial={{ x: flyFrom.x, y: flyFrom.y, scale: 1.25, rotate: flyFrom.y > 0 ? 25 : -25, opacity: reduce ? 0 : 1 }}
            animate={{ x: 0, y: 0, scale: 1, rotate: (hashOf(top.id) % 16) - 8, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 20 }}
          >
            <PdbCardView card={top} w={92} chosen={top.color ? null : s.color} />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* cumul en attente */}
      <AnimatePresence>
        {s.pending_draw > 0 && (
          <motion.div
            key={s.pending_draw}
            className="absolute bottom-2 left-1/2 z-20 -translate-x-1/2"
            initial={{ scale: 2.4, rotate: -20, opacity: 0 }}
            animate={{ scale: 1, rotate: -6, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 12 }}
          >
            <span className="sticker-sm block bg-tomato px-3 py-0.5 font-display text-2xl font-extrabold text-white" style={{ textShadow: '2px 2px 0 #1f1b2e' }}>
              +{s.pending_draw} pour {s.turn === meId ? 'toi' : s.turn ? get(s.turn).nickname : '…'} !
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function TurnBanner({ s, get, meId, left, total }: { s: PdbState; get: Get; meId: string; left: number; total: number }) {
  if (s.phase !== 'playing' || !s.turn) return null
  const mine = s.turn === meId
  const p = get(s.turn)
  const sec = Math.ceil(left / 1000)
  const urgent = sec <= 5
  return (
    <AnimatePresence mode="popLayout">
      <motion.div
        key={s.turn_seq}
        initial={{ x: 120, opacity: 0, rotate: 4 }}
        animate={{ x: 0, opacity: 1, rotate: mine ? -1 : 0 }}
        exit={{ x: -120, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 22 }}
        className={cn('sticker relative flex items-center gap-3 overflow-hidden p-2 pr-3', mine ? 'bg-sun text-[#1f1b2e]' : 'bg-surface')}
      >
        <Avatar slug={p.slug} expression={mood(p, mine ? 'happy' : 'think')} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-xl leading-tight font-extrabold">
            {mine ? (s.turn_phase === 'drawn' ? 'Pose la carte piochée ?' : 'À toi de jouer !') : `Au tour de ${p.nickname}…`}
          </p>
          {mine && s.pending_draw > 0 && <p className="text-sm leading-tight font-bold">Contre avec un {s.pending_kind === 'wild4' ? '+4' : '+2 ou +4'} (ou la Capuche 🧥), sinon tu pioches {s.pending_draw}.</p>}
        </div>
        <motion.span
          key={urgent ? sec : 'calm'}
          initial={urgent ? { scale: 1.6 } : false}
          animate={{ scale: 1 }}
          className={cn('flex size-11 shrink-0 items-center justify-center rounded-full border-[3px] border-ink font-display text-xl font-extrabold', urgent ? 'bg-tomato text-white' : 'bg-surface text-text')}
        >
          {sec}
        </motion.span>
        <div className="absolute bottom-0 left-0 h-1 bg-ink/40" style={{ width: `${Math.min(100, (left / total) * 100)}%`, transition: 'width .25s linear' }} />
      </motion.div>
    </AnimatePresence>
  )
}

/* -------------------------------------------------------------------------- */
/* Ma main : éventail scrollable, cartes jouables surélevées, taper / glisser    */
/* -------------------------------------------------------------------------- */

/** Largeur disponible d'un élément (suivie au redimensionnement). */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(340)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setW(el.clientWidth || 340)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

/** Taille des cartes et écart entre elles pour que TOUTE la main tienne dans la largeur. */
function fitHand(n: number, avail: number) {
  let w = n <= 5 ? 88 : n <= 8 ? 80 : 72
  if (n <= 1) return { w, step: 0 }
  while (w > 52 && (avail - w) / (n - 1) < w * 0.45) w -= 4
  return { w, step: Math.min(w * 0.85, (avail - w) / (n - 1)) }
}

function MyHand({ hand, canPlay, myTurn, drawnId, ghost, onPlay, me }: { hand: PdbCard[]; canPlay: (c: PdbCard) => boolean; myTurn: boolean; drawnId: string | null; ghost: string | null; onPlay: (c: PdbCard) => void; me: PlayerInfo }) {
  const reduce = useReducedMotion()
  const [ref, width] = useWidth<HTMLDivElement>()
  const n = hand.length
  const { w, step } = fitHand(n, width - 16)
  // beaucoup de cartes : les bandes visibles sont fines → 1er toucher = lever la carte, 2e = la jouer
  const pickMode = n > 1 && step < 30
  const [picked, setPicked] = useState<string | null>(null)
  useEffect(() => setPicked(null), [myTurn, n])
  const mid = (n - 1) / 2
  const spread = Math.min(4, 22 / Math.max(1, n))
  const draggingRef = useRef(false)

  return (
    <div className="relative" data-seat="me">
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="flex shrink-0 items-center gap-2 font-display font-extrabold whitespace-nowrap">
          <Avatar slug={me.slug} expression={myTurn ? mood(me, 'happy') : me.equipped} size={34} />
          Ma main · {n}
        </span>
        {myTurn && <span className="text-right text-xs leading-tight font-bold text-muted">{pickMode ? 'Touche, puis retouche pour jouer' : 'Tape ou glisse vers le haut ↑'}</span>}
      </div>
      <div ref={ref} className="pt-10 pb-2">
        <div className="mx-auto flex w-max items-end">
          <AnimatePresence initial={false}>
            {hand.map((c, i) => {
              const ok = canPlay(c)
              const rot = reduce ? 0 : (i - mid) * spread
              const drop = reduce ? 0 : Math.abs(i - mid) * spread * 0.7
              const isDrawn = drawnId === c.id
              const up = picked === c.id
              return (
                <motion.button
                  key={c.id}
                  type="button"
                  layout={!reduce}
                  initial={{ y: -120, opacity: 0, rotate: -30 }}
                  animate={{
                    y: ghost === c.id ? -180 : up ? -40 : ok ? -18 + drop : drop,
                    opacity: ghost === c.id ? 0 : 1,
                    rotate: up ? 0 : rot,
                    scale: up ? 1.12 : ok && !reduce && !pickMode ? [1, 1.05, 1] : 1,
                  }}
                  exit={{ y: -200, opacity: 0, scale: 0.6, transition: { duration: 0.25 } }}
                  transition={{
                    default: { type: 'spring', stiffness: 380, damping: 26 },
                    scale: ok && !reduce && !pickMode && !up ? { repeat: Infinity, duration: 1.3, ease: 'easeInOut' } : { duration: 0.2 },
                  }}
                  whileTap={ok ? { scale: 0.95 } : { x: [0, -5, 5, 0] }}
                  drag={ok ? 'y' : false}
                  dragSnapToOrigin
                  dragElastic={0.6}
                  dragConstraints={{ top: -160, bottom: 0 }}
                  onDragStart={() => {
                    draggingRef.current = true
                  }}
                  onDragEnd={(_, info) => {
                    window.setTimeout(() => {
                      draggingRef.current = false
                    }, 50)
                    if (info.offset.y < -70) onPlay(c)
                  }}
                  onClick={() => {
                    if (draggingRef.current) return
                    if (ok && pickMode && picked !== c.id) return setPicked(c.id)
                    onPlay(c)
                  }}
                  aria-disabled={!ok}
                  className={cn('relative shrink-0 origin-bottom', ok && 'touch-pan-x')}
                  style={{ marginLeft: i === 0 ? 0 : step - w, zIndex: up ? 100 : i }}
                >
                  <PdbCardView card={c} w={w} glow={ok} dim={myTurn && !ok} />
                  {isDrawn && <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full border-2 border-ink bg-sun px-1.5 text-[10px] font-extrabold whitespace-nowrap text-[#1f1b2e]">Piochée !</span>}
                </motion.button>
              )
            })}
          </AnimatePresence>
          {n === 0 && <p className="py-6 font-bold text-muted">Plus de cartes !</p>}
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Adversaires en face (2 à 4 joueurs) : dos de leurs cartes en éventail         */
/* -------------------------------------------------------------------------- */

function Opponents({ s, seats, get, meId, left, total, canDenounce, onDenounce, busy }: { s: PdbState; seats: string[]; get: Get; meId: string; left: number; total: number; canDenounce: boolean; onDenounce: (id: string) => void; busy: boolean }) {
  const opps = seats.filter((id) => id !== meId)
  const [ref, width] = useWidth<HTMLDivElement>()
  const cols = Math.max(1, opps.length)
  const colW = width / cols - 6
  const cw = cols === 1 ? 54 : cols === 2 ? 46 : cols === 3 ? 38 : 32
  const maxShow = cols === 1 ? 14 : cols === 2 ? 11 : cols === 3 ? 8 : 6
  return (
    <div ref={ref} className="flex items-start justify-around gap-1 pt-1">
      {opps.map((id, i) => (
        <OpponentSeat key={id} s={s} id={id} index={i} get={get} left={left} total={total} cw={cw} fanW={colW} maxShow={maxShow} canDenounce={canDenounce} onDenounce={onDenounce} busy={busy} />
      ))}
    </div>
  )
}

function OpponentSeat({ s, id, index, get, left, total, cw, fanW, maxShow, canDenounce, onDenounce, busy }: { s: PdbState; id: string; index: number; get: Get; left: number; total: number; cw: number; fanW: number; maxShow: number; canDenounce: boolean; onDenounce: (id: string) => void; busy: boolean }) {
  const reduce = useReducedMotion()
  const p = get(id)
  const active = s.turn === id && s.phase === 'playing'
  const out = s.out.includes(id)
  const n = s.counts[id] ?? 0
  const lc = s.last_card?.[id]
  const expr = out ? mood(p, 'proud') : active ? mood(p, 'think') : n === 1 ? mood(p, 'sly') : n >= 12 ? mood(p, 'sad') : p.equipped
  const k = out ? 0 : Math.min(n, maxShow)
  const step = k <= 1 ? 0 : Math.min(cw * 0.6, (fanW - cw) / (k - 1))
  const mid = (k - 1) / 2
  const spread = Math.min(5, 24 / Math.max(1, k))
  return (
    <motion.div
      initial={{ y: -30, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: index * 0.06 }}
      className={cn('flex min-w-0 flex-1 flex-col items-center gap-0.5', out && 'opacity-70')}
    >
      <div data-seat={id} className="relative flex size-14 items-center justify-center">
        {active && <TurnRing frac={left / total} size={56} />}
        <motion.div animate={active && !reduce ? { y: [0, -4, 0] } : { y: 0 }} transition={{ repeat: active ? Infinity : 0, duration: 0.9 }}>
          <Avatar slug={p.slug} expression={expr} size={42} className={cn(out && 'grayscale-[0.4]')} />
        </motion.div>
        {!out ? (
          <motion.span
            key={n}
            initial={{ scale: 1.8 }}
            animate={{ scale: 1 }}
            className={cn('absolute -right-1 bottom-0 flex h-6 min-w-6 items-center justify-center rounded-md border-2 border-ink px-1 font-display text-sm font-extrabold', n === 1 ? 'bg-tomato text-white' : 'bg-surface')}
          >
            {n}
          </motion.span>
        ) : (
          <span className="absolute -right-1 bottom-0 text-xl">{['🏆', '🥈', '🥉'][s.out.indexOf(id)] ?? '🎉'}</span>
        )}
        {lc && (
          <span className={cn('absolute -top-1 -left-1 rounded-full border-2 border-ink px-1 text-[10px] leading-tight font-extrabold', lc === 'safe' ? 'bg-sun text-[#1f1b2e]' : 'bg-tomato text-white')}>{lc === 'safe' ? '1 !' : '1 ?'}</span>
        )}
      </div>
      <span className={cn('max-w-full truncate text-xs font-extrabold', active && 'text-grape')}>{p.nickname}{s.absent?.[id] ? ' 💤 absent' : ''}</span>
      {/* dos de ses cartes : une qui part quand il joue, une qui arrive quand il pioche */}
      {k > 0 && (
        <div className="relative mt-1" style={{ width: cw + (k - 1) * step, height: Math.round(cw * 1.45) + 10 }}>
          <AnimatePresence initial={false}>
            {Array.from({ length: k }, (_, j) => (
              <motion.div
                key={j}
                className="absolute top-0"
                style={{ left: j * step, zIndex: j }}
                initial={{ y: 70, opacity: 0, scale: 0.8 }}
                animate={{ y: reduce ? 0 : (mid - Math.abs(j - mid)) * 1.6, opacity: 1, scale: 1, rotate: reduce ? 0 : -(j - mid) * spread }}
                exit={{ y: 70, opacity: 0, scale: 0.7, transition: { duration: 0.25 } }}
                transition={{ type: 'spring', stiffness: 320, damping: 22 }}
              >
                <PdbCardView back w={cw} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
      {canDenounce && lc === 'open' && (
        <button type="button" disabled={busy} onClick={() => onDenounce(id)} className="rounded-full border-2 border-ink bg-tomato px-1.5 text-[10px] font-extrabold text-white shadow-sticker-sm">
          Dénoncer !
        </button>
      )}
    </motion.div>
  )
}

/* -------------------------------------------------------------------------- */
/* Choix de couleur / de cible                                                 */
/* -------------------------------------------------------------------------- */

function ChoiceSheets({ choice, s, get, meId, hand, onClose, onColor, onTarget }: { choice: Choice | null; s: PdbState; get: Get; meId: string; hand: PdbCard[]; onClose: () => void; onColor: (c: PdbCard, color: PdbColor) => void; onTarget: (c: PdbCard, target: string) => void }) {
  const card = choice?.card
  const perso = card?.kind === 'perso' && card.perso ? PERSOS[card.perso] : null
  const colorTitle = perso?.slug === 'cecile' ? 'Quelle couleur défausser ?' : 'Choisis la couleur'
  const targetTitle = perso?.slug === 'cycy' ? 'Échanger ta main avec…' : perso?.slug === 'manon' ? 'Lire la main de…' : 'Qui pioche 3 cartes ?'
  const targets = s.active.filter((id) => id !== meId)
  const rest = hand.filter((c) => c.id !== card?.id)

  return (
    <>
      <BottomSheet open={choice?.step === 'color'} onClose={onClose} title={colorTitle}>
        {perso && <p className="mb-3 text-sm font-bold text-muted">{perso.emoji} {perso.title} : {perso.effect}</p>}
        <div className="grid grid-cols-2 gap-3">
          {PDB_COLORS.map((col, i) => {
            const m = COLOR_META[col]
            const mine = rest.filter((c) => c.color === col).length
            return (
              <motion.button
                key={col}
                type="button"
                initial={{ scale: 0, rotate: i % 2 ? 10 : -10 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ delay: i * 0.05, type: 'spring', stiffness: 400, damping: 15 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => card && onColor(card, col)}
                className="sticker flex flex-col items-center gap-1 p-4"
                style={{ backgroundColor: m.hex, color: m.text }}
              >
                <ColorGlyph color={col} size={44} />
                <span className="font-display text-2xl font-extrabold">{m.label}</span>
                <span className="text-xs font-bold opacity-80">{mine} en main</span>
              </motion.button>
            )
          })}
        </div>
      </BottomSheet>

      <BottomSheet open={choice?.step === 'target'} onClose={onClose} title={targetTitle}>
        {perso && <p className="mb-3 text-sm font-bold text-muted">{perso.emoji} {perso.title} : {perso.effect}</p>}
        <div className="grid grid-cols-3 gap-3">
          {targets.map((id, i) => {
            const p = get(id)
            return (
              <motion.button
                key={id}
                type="button"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: i * 0.05, type: 'spring', stiffness: 400, damping: 15 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => card && onTarget(card, id)}
                className="sticker flex flex-col items-center gap-1 bg-surface p-2"
              >
                <Avatar slug={p.slug} expression={mood(p, 'shocked')} size={60} />
                <span className="max-w-full truncate font-display font-extrabold">{p.nickname}</span>
                <span className="text-xs font-bold text-muted">{s.counts[id]} carte{s.counts[id] > 1 ? 's' : ''}</span>
              </motion.button>
            )
          })}
        </div>
      </BottomSheet>
    </>
  )
}
