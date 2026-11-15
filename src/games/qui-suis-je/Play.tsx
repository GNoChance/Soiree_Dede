import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Check, RotateCw, SkipForward, Smartphone, X } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { Button } from '@/components/ui/Button'
import { ChibiImage } from '@/components/ui/ChibiImage'
import { burst } from '@/components/ui/confetti'
import { fx, playSound, vibrate } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import { ConfirmModal } from '@/features/soiree/components'
import { mood, pickExpression, playerOrPlaceholder } from '@/features/soiree/players'
import { serverNow, useCountdown } from '@/features/soiree/useServerClock'
import type { GamePlayProps, PlayerInfo } from '../types'
import { fitFontPx } from './deck'
import { enterLandscape, leaveLandscape, useIsPortrait, useTilt, useViewport, useWakeLock, type TiltStatus } from './device'
import { qsjActions, rememberShown, themeInfo } from './setup'
import { DEFAULT_TILT, tiltZone, type TiltGesture } from './tilt'
import type { QsjCard, QsjState } from './types'

type Get = (id: string) => PlayerInfo
type ActFn = GamePlayProps['act']

/** Couleurs fixes (lisibles en plein soleil, indépendantes du thème sombre). */
const INK = '#1f1b2e'
const FOUND_BG = '#06d6a0'
const PASS_BG = '#fb8500'

/* -------------------------------------------------------------------------- */
/* Hooks                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Envoie `{"type":"tick"}` à l'échéance (fin de chrono, fin de récap). Le serveur
 * ignore un tick prématuré. Décalage selon le rôle pour éviter la rafale :
 * devineur d'abord, puis l'hôte, puis les autres (relance toutes les 3 s).
 */
function useAutoTick(s: QsjState, act: ActFn, meId: string, isHost: boolean) {
  const target = s.phase === 'playing' || s.phase === 'recap' ? (s.deadline ? new Date(s.deadline).getTime() : null) : null
  const role = s.guesser === meId ? 0 : isHost ? 1 : 2
  const actRef = useRef(act)
  useEffect(() => {
    actRef.current = act
  })
  useEffect(() => {
    if (target == null) return
    const delay = role === 0 ? 150 : role === 1 ? 600 : 1300 + Math.random() * 1500
    let timer = 0
    const fire = () => {
      void actRef.current(qsjActions.tick())
      timer = window.setTimeout(fire, 3000 + Math.random() * 1000)
    }
    timer = window.setTimeout(fire, Math.max(0, target - serverNow()) + delay)
    return () => clearTimeout(timer)
  }, [target, role])
}

/** Joue `fn(n)` à chaque changement de seconde affichée (n = secondes restantes). */
function useSecondBeat(secs: number, fn: (n: number) => void) {
  const last = useRef(secs)
  const cb = useRef(fn)
  useEffect(() => {
    cb.current = fn
  })
  useEffect(() => {
    if (secs !== last.current) {
      last.current = secs
      cb.current(secs)
    }
  }, [secs])
}

/* -------------------------------------------------------------------------- */
/* Écran principal                                                             */
/* -------------------------------------------------------------------------- */

interface Flash {
  kind: TiltGesture
  key: number
}

export default function QuiSuisJePlay({ state, meId, isHost, players, act, pending }: GamePlayProps) {
  const s = state as unknown as QsjState
  const get: Get = (id) => playerOrPlaceholder(players, id)
  const isGuesser = s.guesser === meId
  const guesser = get(s.guesser)
  const [confirmSkip, setConfirmSkip] = useState(false)

  useAutoTick(s, act, meId, isHost)
  useWakeLock(s.phase === 'placing' || s.phase === 'playing' || s.phase === 'recap')

  // Cartes montrées -> historique local (évitées aux prochaines parties).
  useEffect(() => {
    if (s.phase === 'recap') rememberShown(s.turn_log.map((e) => e.card.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.phase, s.turn])

  // Le devineur quitte le paysage / plein écran dès la fin de son tour.
  useEffect(() => {
    if (isGuesser && s.phase !== 'playing' && s.phase !== 'placing') leaveLandscape()
  }, [isGuesser, s.phase])
  useEffect(() => () => leaveLandscape(), [])

  /* ------------------------------------------------------------ chrono */
  useCountdown(s.phase === 'playing' ? s.starts_at : null, 100) // re-rendu toutes les 100 ms pendant le 3-2-1
  // Recalculé à chaque rendu : useCountdown garde l'ancienne valeur au 1er rendu d'un
  // nouveau tour, ce qui afficherait la carte une image avant le 3-2-1.
  const startLeft = s.phase === 'playing' && s.starts_at ? Math.max(0, new Date(s.starts_at).getTime() - serverNow()) : 0
  const left = useCountdown(s.phase === 'playing' || s.phase === 'recap' ? s.deadline : null)
  const started = s.phase === 'playing' && startLeft <= 0
  const timeUp = s.phase === 'playing' && started && left <= 0

  /* ------------------------------------------------------- gestes (devineur) */
  const [sentIndex, setSentIndex] = useState<{ turn: number; index: number } | null>(null)
  const [flash, setFlash] = useState<Flash | null>(null)
  const alreadySent = sentIndex?.turn === s.turn && sentIndex.index >= s.card_index
  const canAnswer = isGuesser && started && !timeUp && Boolean(s.card) && !alreadySent

  const answer = useCallback(
    (g: TiltGesture) => {
      if (!canAnswer) return
      const index = s.card_index
      const turn = s.turn
      setSentIndex({ turn, index })
      setFlash({ kind: g, key: index })
      if (g === 'found') {
        playSound('success')
        vibrate([40, 30, 80])
      } else {
        playSound('whoosh')
        vibrate([25, 40, 25])
      }
      void act(g === 'found' ? qsjActions.found(index) : qsjActions.pass(index)).then((r) => {
        // Échec (réseau…) : on autorise à renvoyer ce même index.
        if (!r) setSentIndex((cur) => (cur && cur.turn === turn && cur.index === index ? null : cur))
      })
    },
    [act, canAnswer, s.card_index, s.turn],
  )

  // Mode test pendant la préparation : on montre le geste détecté, sans rien envoyer.
  const [testGesture, setTestGesture] = useState<Flash | null>(null)
  const tilt = useTilt({
    detect: isGuesser && (s.phase === 'placing' || canAnswer),
    armKey: `${s.turn}-${s.phase}-${started ? 1 : 0}`,
    onGesture: (g) => {
      if (s.phase === 'placing') {
        setTestGesture({ kind: g, key: Date.now() })
        fx.pop()
      } else answer(g)
    },
  })

  useEffect(() => {
    if (!flash) return
    const t = window.setTimeout(() => setFlash(null), 650)
    return () => clearTimeout(t)
  }, [flash])

  /* --------------------------------------------- sons du 3-2-1 / fin de chrono */
  const startSecs = Math.ceil(startLeft / 1000)
  useSecondBeat(s.phase === 'playing' ? startSecs : -1, (n) => {
    if (!isGuesser) return
    if (n > 0 && n <= 3) fx.tick()
    if (n === 0) {
      playSound('whoosh')
      vibrate(250)
    }
  })
  const secs = Math.ceil(left / 1000)
  useSecondBeat(s.phase === 'playing' && started ? secs : -1, (n) => {
    if (n > 0 && n <= 5) {
      if (isGuesser) fx.tick()
    } else if (n === 0) {
      if (isGuesser) {
        playSound('fail')
        vibrate([300, 80, 300])
      } else fx.whoosh()
    }
  })

  /* ------------------------------------------- flash chez les spectateurs */
  const [watchFlash, setWatchFlash] = useState<Flash | null>(null)
  const seenLog = useRef({ turn: s.turn, n: s.turn_log.length })
  useEffect(() => {
    const prev = seenLog.current
    const n = s.turn_log.length
    if (prev.turn === s.turn && n > prev.n && !isGuesser) {
      const last = s.turn_log[n - 1]
      setWatchFlash({ kind: last.r, key: last.i })
      if (last.r === 'found') fx.success()
      else fx.whoosh()
    }
    seenLog.current = { turn: s.turn, n }
  }, [s.turn, s.turn_log, isGuesser])
  useEffect(() => {
    if (!watchFlash) return
    const t = window.setTimeout(() => setWatchFlash(null), 700)
    return () => clearTimeout(t)
  }, [watchFlash])

  /* ---------------------------------------------------------------- rendu */
  return (
    <div className="flex flex-col gap-3 pb-6">
      <AnimatePresence mode="wait">
        {s.phase === 'placing' && (
          <motion.div key={`placing-${s.turn}`} initial={{ opacity: 0, y: 40, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, x: -80, rotate: -6 }}>
            {isGuesser ? (
              <PlacingGuesser s={s} me={guesser} tiltStatus={tilt.status} pitch={tilt.pitch} onEnableTilt={tilt.enable} testGesture={testGesture} act={act} pending={pending} />
            ) : (
              <PlacingWatcher s={s} guesser={guesser} />
            )}
          </motion.div>
        )}

        {s.phase === 'playing' && !isGuesser && (
          <motion.div key={`watch-${s.turn}`} initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, y: -40 }}>
            <WatcherStage s={s} guesser={guesser} startLeft={startLeft} left={left} flash={watchFlash} />
          </motion.div>
        )}

        {s.phase === 'playing' && isGuesser && (
          <motion.div key={`me-${s.turn}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="sticker flex flex-col items-center gap-2 bg-surface p-5 text-center">
              <Smartphone className="size-10" />
              <p className="font-display text-2xl font-extrabold">Téléphone sur le front !</p>
            </div>
          </motion.div>
        )}

        {s.phase === 'recap' && s.last_turn && (
          <motion.div key={`recap-${s.turn}`} initial={{ opacity: 0, scale: 0.7, rotate: -4 }} animate={{ opacity: 1, scale: 1, rotate: 0 }} exit={{ opacity: 0, x: 80, rotate: 6 }} transition={{ type: 'spring', stiffness: 260, damping: 18 }}>
            <Recap s={s} get={get} meId={meId} left={left} />
          </motion.div>
        )}
      </AnimatePresence>

      <Scoreboard s={s} get={get} meId={meId} />

      {isHost && (s.phase === 'placing' || s.phase === 'playing') && (
        <>
          <Button variant="secondary" size="sm" fullWidth icon={<SkipForward className="size-5" />} onClick={() => setConfirmSkip(true)}>
            Passer ce tour
          </Button>
          <ConfirmModal
            open={confirmSkip}
            onClose={() => setConfirmSkip(false)}
            title="Passer ce tour ?"
            confirmLabel="Passer"
            loading={pending}
            onConfirm={async () => {
              await act(qsjActions.skipTurn())
              setConfirmSkip(false)
            }}
          >
            Pratique si {guesser.nickname} est absent·e. Les cartes déjà trouvées sont gardées.
          </ConfirmModal>
        </>
      )}

      {isGuesser && s.phase === 'playing' && (
        <GuesserStage
          s={s}
          startLeft={startLeft}
          left={left}
          timeUp={timeUp}
          flash={flash}
          waiting={alreadySent}
          canAnswer={canAnswer}
          tiltStatus={tilt.status}
          onAnswer={answer}
        />
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Préparation                                                                 */
/* -------------------------------------------------------------------------- */

function PlacingGuesser({
  s, me, tiltStatus, pitch, onEnableTilt, testGesture, act, pending,
}: {
  s: QsjState
  me: PlayerInfo
  tiltStatus: TiltStatus
  pitch: number | null
  onEnableTilt: () => Promise<boolean>
  testGesture: Flash | null
  act: ActFn
  pending: boolean
}) {
  const reduce = useReducedMotion()
  const portrait = useIsPortrait()
  const [busy, setBusy] = useState(false)
  const [lockFailed, setLockFailed] = useState(false)

  const go = async () => {
    setBusy(true)
    // Les deux demandes doivent partir dans le geste utilisateur (iOS / fullscreen).
    const perm = tiltStatus === 'needs-permission' ? onEnableTilt() : Promise.resolve(true)
    const land = portrait ? enterLandscape() : Promise.resolve(true)
    const [, locked] = await Promise.all([perm, land])
    if (!locked) setLockFailed(true)
    await act(qsjActions.ready())
    setBusy(false)
  }

  return (
    <div className="sticker flex flex-col items-center gap-4 bg-surface p-5 text-center">
      <div className="relative">
        <motion.div
          animate={reduce ? undefined : { y: [0, -10, 0], rotate: [0, -4, 4, 0] }}
          transition={{ repeat: Infinity, duration: 1.6, ease: 'easeInOut' }}
        >
          <ChibiImage slug={me.slug} expression={mood(me, 'think')} tenue={me.equippedTenue} size={130} />
        </motion.div>
        <motion.div
          className="absolute -top-3 left-1/2 flex h-9 w-14 -translate-x-1/2 items-center justify-center rounded-lg border-[3px] border-ink bg-sky text-lg shadow-sticker-sm"
          animate={reduce ? undefined : { y: [-30, 0, 0, -30], opacity: [0, 1, 1, 0] }}
          transition={{ repeat: Infinity, duration: 2.6, times: [0, 0.3, 0.8, 1] }}
          aria-hidden
        >
          ❓
        </motion.div>
      </div>
      <div>
        <h2 className="font-display text-3xl leading-tight font-extrabold">À toi de deviner !</h2>
        <p className="mt-1 text-lg font-bold">
          Pose ton téléphone sur ton front, <span className="text-grape">écran vers les autres</span>.
        </p>
      </div>

      <div className="grid w-full grid-cols-2 gap-2">
        <GestureHint kind="found" active={testGesture?.kind === 'found'} key={`f-${testGesture?.key}`} />
        <GestureHint kind="pass" active={testGesture?.kind === 'pass'} key={`p-${testGesture?.key}`} />
      </div>

      <TiltPanel status={tiltStatus} pitch={pitch} onEnable={onEnableTilt} />

      {(portrait || lockFailed) && (
        <motion.p
          className="flex items-center gap-2 rounded-card border-2 border-dashed border-ink bg-sunk px-3 py-2 text-left text-sm font-bold"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <motion.span animate={reduce ? undefined : { rotate: [0, 90, 90, 0] }} transition={{ repeat: Infinity, duration: 2.4 }}>
            <RotateCw className="size-5" />
          </motion.span>
          Tourne ton téléphone en paysage : la carte sera encore plus grande !
        </motion.p>
      )}

      <Button size="lg" fullWidth loading={busy || pending} onClick={() => void go()} icon={<Smartphone className="size-7" />}>
        Je suis prêt·e !
      </Button>
      <p className="-mt-2 text-sm text-muted">
        Compte à rebours de {s.countdown_seconds - 1} s pour le placer, puis {s.turn_seconds} s pour trouver un max de cartes.
      </p>
    </div>
  )
}

function GestureHint({ kind, active }: { kind: TiltGesture; active: boolean }) {
  const found = kind === 'found'
  return (
    <motion.div
      initial={active ? { scale: 1.25, rotate: found ? 4 : -4 } : false}
      animate={{ scale: 1, rotate: 0 }}
      transition={{ type: 'spring', stiffness: 420, damping: 12 }}
      className={cn('flex flex-col items-center gap-0.5 rounded-card border-[3px] border-ink p-2 text-[#1f1b2e] shadow-sticker-sm', active && 'ring-4 ring-grape')}
      style={{ background: found ? FOUND_BG : PASS_BG }}
    >
      <span className="text-3xl" aria-hidden>
        {found ? '⤵️' : '⤴️'}
      </span>
      <span className="font-display text-lg leading-tight font-extrabold">{found ? 'Vers le bas' : 'Vers le haut'}</span>
      <span className="text-sm font-extrabold">{found ? '= Trouvé ✓' : '= Passer'}</span>
    </motion.div>
  )
}

/** État du gyroscope + jauge de test. */
function TiltPanel({ status, pitch, onEnable }: { status: TiltStatus; pitch: number | null; onEnable: () => Promise<boolean> }) {
  if (status === 'needs-permission') {
    return (
      <div className="flex w-full flex-col gap-1.5">
        <Button variant="secondary" fullWidth onClick={() => void onEnable()}>
          📐 Activer l’inclinaison
        </Button>
        <p className="text-sm text-muted">Sinon, les boutons « Trouvé » et « Passer » marchent aussi.</p>
      </div>
    )
  }
  if (status === 'unsupported' || status === 'no-sensor' || status === 'denied') {
    return (
      <p className="w-full rounded-card bg-sunk px-3 py-2 text-sm font-bold">
        {status === 'denied'
          ? 'Inclinaison refusée (réglages du navigateur). '
          : 'Pas de gyroscope détecté. '}
        Utilise les gros boutons <b>Trouvé</b> / <b>Passer</b> sur l’écran.
      </p>
    )
  }
  if (status === 'waiting' || pitch == null) {
    return <p className="w-full rounded-card bg-sunk px-3 py-2 text-sm font-bold">📐 Inclinaison : en attente du capteur…</p>
  }
  const zone = tiltZone(pitch, DEFAULT_TILT)
  // Jauge verticale : haut = écran vers le plafond (passer), bas = vers le sol (trouvé).
  const pos = 50 - (pitch / 90) * 50
  return (
    <div className="flex w-full items-center gap-3 rounded-card bg-sunk px-3 py-2 text-left">
      <div className="relative h-16 w-5 shrink-0 overflow-hidden rounded-full border-2 border-ink bg-surface" aria-hidden>
        <div className="absolute inset-x-0 top-0 h-[28%] bg-tangerine/70" />
        <div className="absolute inset-x-0 bottom-0 h-[28%] bg-mint/70" />
        <motion.div className="absolute left-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink bg-sun" animate={{ top: `${pos}%` }} transition={{ type: 'spring', stiffness: 300, damping: 20 }} />
      </div>
      <p className="text-sm font-bold">
        📐 Inclinaison active ! Pose-le sur ton front et teste :{' '}
        <b>{zone === 'found' ? 'vers le bas ✓' : zone === 'pass' ? 'vers le haut ↷' : zone === 'neutral' ? 'position neutre' : '…'}</b>
      </p>
    </div>
  )
}

function PlacingWatcher({ s, guesser }: { s: QsjState; guesser: PlayerInfo }) {
  const reduce = useReducedMotion()
  return (
    <div className="sticker flex flex-col items-center gap-3 bg-surface p-5 text-center">
      <motion.div animate={reduce ? undefined : { rotate: [0, -6, 6, 0], y: [0, -6, 0] }} transition={{ repeat: Infinity, duration: 1.8 }}>
        <Avatar slug={guesser.slug} expression={mood(guesser, 'think')} size={110} />
      </motion.div>
      <h2 className="font-display text-3xl leading-tight font-extrabold">{guesser.nickname} se prépare…</h2>
      <p className="text-lg font-bold">
        Dès que la carte s’affiche sur son front, faites-la-lui deviner à l’oral.
        <br />
        <span className="text-tomato">Interdit de dire le nom ! 🤫</span>
      </p>
      <p className="text-sm text-muted">
        Tour {s.turn}/{s.total_turns} · {s.turn_seconds} s
      </p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Écran du devineur (plein écran, sur le front)                               */
/* -------------------------------------------------------------------------- */

function GuesserStage({
  s, startLeft, left, timeUp, flash, waiting, canAnswer, tiltStatus, onAnswer,
}: {
  s: QsjState
  startLeft: number
  left: number
  timeUp: boolean
  flash: Flash | null
  waiting: boolean
  canAnswer: boolean
  tiltStatus: TiltStatus
  onAnswer: (g: TiltGesture) => void
}) {
  const reduce = useReducedMotion()
  const vp = useViewport()
  const counting = startLeft > 0
  const n = Math.ceil(startLeft / 1000)
  const secs = Math.ceil(left / 1000)
  const frac = Math.min(1, left / (s.turn_seconds * 1000))
  const urgent = !counting && secs <= 10

  // Bloque le défilement de la page derrière.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  const node = (
    <div className="fixed inset-0 z-[55] flex flex-col overflow-hidden select-none" style={{ background: '#fffdf6', color: INK }} role="dialog" aria-label="Carte à faire deviner">
      {counting ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2" style={{ background: '#ffb703' }}>
          <AnimatePresence mode="popLayout">
            <motion.div
              key={n > 3 ? 'place' : n}
              initial={{ scale: 2.4, opacity: 0, rotate: -12 }}
              animate={{ scale: 1, opacity: 1, rotate: 0 }}
              exit={{ scale: 0.3, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 16 }}
              className="text-center font-display leading-none font-extrabold"
              style={{ fontSize: n > 3 ? 'min(16vw, 22vh)' : 'min(40vw, 60vh)', WebkitTextStroke: '3px #1f1b2e', color: '#fff' }}
            >
              {n > 3 ? 'Sur ton front !' : n}
            </motion.div>
          </AnimatePresence>
          <p className="font-display text-[min(5vw,6vh)] font-extrabold">Écran vers les autres 📱</p>
        </div>
      ) : (
        <>
          {/* Barre du haut : score · chrono */}
          <div className="flex items-center gap-3 px-4 pt-[max(env(safe-area-inset-top),0.6rem)] pb-1">
            <div className="flex items-center gap-1 rounded-full border-[3px] border-ink px-3 py-0.5 font-display text-[min(5vw,7vh)] leading-tight font-extrabold" style={{ background: FOUND_BG }}>
              <Check className="size-[1em]" strokeWidth={4} />
              <AnimatedNumber value={s.turn_found} duration={0.3} />
            </div>
            <div className="h-[min(3vh,1.2rem)] flex-1 overflow-hidden rounded-full border-[3px] border-ink bg-white">
              <div className={cn('h-full transition-[width] duration-300 ease-linear', urgent ? 'bg-tomato' : 'bg-sky')} style={{ width: `${frac * 100}%` }} />
            </div>
            <motion.div
              className={cn('flex min-w-[2.2em] items-center justify-center rounded-full border-[3px] border-ink px-2 font-display text-[min(6vw,9vh)] leading-tight font-extrabold', urgent ? 'bg-tomato text-white' : 'bg-sun')}
              animate={urgent && !reduce ? { scale: [1, 1.18, 1] } : { scale: 1 }}
              transition={urgent ? { repeat: Infinity, duration: 0.6 } : undefined}
            >
              {secs}
            </motion.div>
          </div>

          {/* Carte */}
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-4">
            <AnimatePresence mode="popLayout">
              {s.card && !waiting && (
                <motion.div
                  key={`${s.card_index}-${s.card.id}`}
                  initial={reduce ? { opacity: 0 } : { opacity: 0, y: 60, rotate: -6, scale: 0.7 }}
                  animate={{ opacity: 1, y: 0, rotate: 0, scale: 1 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
                  transition={{ type: 'spring', stiffness: 360, damping: 20 }}
                  className="flex h-full w-full items-center justify-center"
                >
                  <CardFace card={s.card} width={vp.w - 32} height={vp.h * 0.62} />
                </motion.div>
              )}
              {waiting && !flash && (
                <motion.p key="wait" initial={{ opacity: 0 }} animate={{ opacity: 0.6 }} className="font-display text-[min(10vw,14vh)] font-extrabold">
                  …
                </motion.p>
              )}
            </AnimatePresence>
          </div>

          {/* Boutons de secours (toujours disponibles) */}
          <div className="grid grid-cols-2 gap-3 px-3 pt-1 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
            <BigAnswer kind="pass" disabled={!canAnswer} onClick={() => onAnswer('pass')} />
            <BigAnswer kind="found" disabled={!canAnswer} onClick={() => onAnswer('found')} />
          </div>
          {tiltStatus === 'active' && (
            <p className="pointer-events-none absolute bottom-[calc(min(14vh,5rem)+1.2rem)] left-1/2 -translate-x-1/2 rounded-full bg-black/10 px-2 text-xs font-bold">
              📐 bas = trouvé · haut = passer
            </p>
          )}
        </>
      )}

      {/* Flash plein écran */}
      <AnimatePresence>
        {flash && !counting && (
          <motion.div
            key={`flash-${flash.key}`}
            className="absolute inset-0 z-10 flex flex-col items-center justify-center"
            style={{ background: flash.kind === 'found' ? FOUND_BG : PASS_BG }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
          >
            <motion.span
              initial={{ scale: 0.3, rotate: flash.kind === 'found' ? -15 : 15 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 12 }}
              className="text-center font-display leading-none font-extrabold"
              style={{ fontSize: 'min(20vw, 34vh)', color: '#fff', WebkitTextStroke: `4px ${INK}` }}
            >
              {flash.kind === 'found' ? 'Trouvé !' : 'Passé'}
            </motion.span>
          </motion.div>
        )}
        {timeUp && (
          <motion.div
            key="timeup"
            className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2"
            style={{ background: '#ef476f' }}
            initial={{ opacity: 0, scale: 1.2 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            <span className="text-center font-display leading-none font-extrabold" style={{ fontSize: 'min(15vw, 26vh)', color: '#fff', WebkitTextStroke: `4px ${INK}` }}>
              Temps écoulé !
            </span>
            <span className="font-display text-[min(7vw,10vh)] font-extrabold text-white">
              {s.turn_found} carte{s.turn_found > 1 ? 's' : ''} trouvée{s.turn_found > 1 ? 's' : ''}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
  return createPortal(node, document.body)
}

function BigAnswer({ kind, disabled, onClick }: { kind: TiltGesture; disabled: boolean; onClick: () => void }) {
  const found = kind === 'found'
  return (
    <motion.button
      type="button"
      disabled={disabled}
      onClick={onClick}
      whileTap={{ scale: 0.94, x: 3, y: 3 }}
      className="flex min-h-[min(14vh,5rem)] items-center justify-center gap-2 rounded-card border-[3px] border-ink font-display text-[min(6vw,7vh)] font-extrabold shadow-[4px_4px_0_#1f1b2e] disabled:opacity-60"
      style={{ background: found ? FOUND_BG : PASS_BG, color: INK }}
    >
      {found ? <Check className="size-[1.1em]" strokeWidth={4} /> : <SkipForward className="size-[1.1em]" strokeWidth={3} />}
      {found ? 'Trouvé' : 'Passer'}
    </motion.button>
  )
}

/** La carte : nom en très gros (ajusté à la place dispo), sous-titre, chibi éventuel. */
function CardFace({ card, width, height, compact }: { card: QsjCard; width: number; height: number; compact?: boolean }) {
  const theme = themeInfo(card.theme)
  const chibi = card.slug ? Math.min(height * 0.9, width * 0.3) : 0
  const textW = width - chibi - (chibi ? 16 : 0)
  const subH = card.sub ? Math.min(height * 0.18, 60) : 0
  const px = fitFontPx(card.name, textW, height - subH - 28, compact ? 90 : 240, 22)
  return (
    <div className="flex h-full w-full items-center justify-center gap-4">
      {card.slug && <ChibiImage slug={card.slug} expression="joie" size={Math.round(chibi)} className="shrink-0" />}
      <div className="flex min-w-0 flex-col items-center text-center">
        {theme && (
          <span className="mb-1 rounded-full border-2 border-ink bg-sunk px-2 text-sm font-extrabold text-[#1f1b2e]" style={{ background: '#ffe9bf' }}>
            {theme.emoji} {theme.label}
          </span>
        )}
        <span className="font-display font-extrabold break-words" style={{ fontSize: px, lineHeight: 1.05, color: INK, overflowWrap: 'anywhere' }}>
          {card.name}
        </span>
        {card.sub && (
          <span className="font-display font-extrabold opacity-70" style={{ fontSize: Math.max(18, Math.min(subH * 0.8, px * 0.4)), color: INK }}>
            ({card.sub})
          </span>
        )}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Écran des autres joueurs                                                    */
/* -------------------------------------------------------------------------- */

function WatcherStage({ s, guesser, startLeft, left, flash }: { s: QsjState; guesser: PlayerInfo; startLeft: number; left: number; flash: Flash | null }) {
  const reduce = useReducedMotion()
  const vp = useViewport()
  const counting = startLeft > 0
  const n = Math.ceil(startLeft / 1000)
  const secs = Math.ceil(left / 1000)
  const frac = Math.min(1, left / (s.turn_seconds * 1000))
  const urgent = !counting && secs <= 10
  const cardW = Math.min(vp.w, 640) - 64
  const cardH = Math.max(140, Math.min(vp.h * 0.34, 320))
  const log = [...s.turn_log].reverse()

  return (
    <div className="flex flex-col gap-3">
      {/* En-tête : devineur, score, chrono */}
      <div className="sticker flex items-center gap-3 bg-surface p-2.5">
        <motion.div animate={reduce || counting ? undefined : { rotate: [0, -5, 5, 0] }} transition={{ repeat: Infinity, duration: 1.2 }}>
          <Avatar slug={guesser.slug} expression={pickExpression(guesser, 'reflexion', 'surprise', 'joie')} size={52} />
        </motion.div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-sm leading-tight font-extrabold text-muted">Faites deviner</p>
          <p className="truncate font-display text-2xl leading-tight font-extrabold">{guesser.nickname}</p>
        </div>
        <div className="flex items-center gap-1 rounded-full border-[3px] border-ink px-3 py-1 font-display text-2xl font-extrabold text-[#1f1b2e]" style={{ background: FOUND_BG }}>
          <Check className="size-6" strokeWidth={4} />
          <AnimatedNumber value={s.turn_found} duration={0.3} />
        </div>
        <motion.div
          className={cn('flex size-14 shrink-0 items-center justify-center rounded-full border-[3px] border-ink font-display text-2xl font-extrabold shadow-sticker-sm', urgent ? 'bg-tomato text-white' : 'bg-sun text-[#1f1b2e]')}
          animate={urgent && !reduce ? { scale: [1, 1.15, 1] } : { scale: 1 }}
          transition={urgent ? { repeat: Infinity, duration: 0.6 } : undefined}
          aria-label={`${counting ? s.turn_seconds : secs} secondes`}
        >
          {counting ? s.turn_seconds : secs}
        </motion.div>
      </div>
      <div className="h-3 w-full overflow-hidden rounded-full border-2 border-ink bg-sunk">
        <div className={cn('h-full rounded-full transition-[width] duration-300 ease-linear', urgent ? 'bg-tomato' : 'bg-mint')} style={{ width: `${counting ? 100 : frac * 100}%` }} />
      </div>

      {/* Carte en grand */}
      <div className="relative overflow-hidden rounded-bubble border-[4px] border-ink shadow-sticker-lg" style={{ background: '#fffdf6', minHeight: cardH + 32 }}>
        <AnimatePresence mode="popLayout">
          {counting ? (
            <motion.div
              key={`c-${n}`}
              initial={{ scale: 2, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.4, opacity: 0 }}
              className="flex items-center justify-center p-4 text-center font-display font-extrabold"
              style={{ height: cardH + 32, fontSize: n > 3 ? 40 : 120, color: INK }}
            >
              {n > 3 ? `${guesser.nickname} se place…` : n}
            </motion.div>
          ) : s.card ? (
            <motion.div
              key={`${s.card_index}-${s.card.id}`}
              initial={reduce ? { opacity: 0 } : { opacity: 0, x: 120, rotate: 8 }}
              animate={{ opacity: 1, x: 0, rotate: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, x: -120, rotate: -8 }}
              transition={{ type: 'spring', stiffness: 320, damping: 22 }}
              className="flex items-center justify-center p-4"
              style={{ height: cardH + 32 }}
            >
              <CardFace card={s.card} width={cardW} height={cardH} compact />
            </motion.div>
          ) : null}
        </AnimatePresence>
        <AnimatePresence>
          {flash && (
            <motion.div
              key={`wf-${flash.key}`}
              className="absolute inset-0 flex items-center justify-center"
              style={{ background: flash.kind === 'found' ? FOUND_BG : PASS_BG }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <motion.span
                initial={{ scale: 0.3 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 12 }}
                className="font-display text-6xl font-extrabold"
                style={{ color: '#fff', WebkitTextStroke: `3px ${INK}` }}
              >
                {flash.kind === 'found' ? 'Trouvé !' : 'Passé'}
              </motion.span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Historique du tour */}
      {log.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <AnimatePresence initial={false}>
            {log.map((e) => (
              <LogChip key={e.i} name={e.card.name} found={e.r === 'found'} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}

function LogChip({ name, found, delay = 0 }: { name: string; found: boolean; delay?: number }) {
  return (
    <motion.span
      layout
      initial={{ scale: 0, rotate: found ? -10 : 10 }}
      animate={{ scale: 1, rotate: 0 }}
      exit={{ scale: 0 }}
      transition={{ type: 'spring', stiffness: 500, damping: 18, delay }}
      className={cn('inline-flex items-center gap-1 rounded-full border-2 border-ink px-2.5 py-0.5 text-sm font-extrabold text-[#1f1b2e]', !found && 'line-through decoration-2')}
      style={{ background: found ? FOUND_BG : '#e8e3d6' }}
    >
      {found ? <Check className="size-4" strokeWidth={4} /> : <X className="size-4" strokeWidth={3} />}
      {name}
    </motion.span>
  )
}

/* -------------------------------------------------------------------------- */
/* Récap du tour                                                               */
/* -------------------------------------------------------------------------- */

function Recap({ s, get, meId, left }: { s: QsjState; get: Get; meId: string; left: number }) {
  const t = s.last_turn!
  const g = get(t.guesser)
  const mine = t.guesser === meId
  const ref = useRef<HTMLDivElement>(null)
  const frac = Math.min(1, left / (s.recap_seconds * 1000))
  useEffect(() => {
    if (t.found > 0) {
      fx.success()
      if (ref.current) {
        const r = ref.current.getBoundingClientRect()
        burst({ x: (r.left + r.width / 2) / window.innerWidth, y: (r.top + 60) / window.innerHeight }, Math.min(40 + t.found * 12, 160))
      }
    } else fx.fail()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const title: ReactNode = t.skipped && t.found + t.passed === 0
    ? `Tour de ${g.nickname} passé`
    : (
      <>
        {mine ? 'Tu as trouvé' : `${g.nickname} a trouvé`} <AnimatedNumber value={t.found} className="text-grape" /> carte{t.found > 1 ? 's' : ''} !
      </>
    )
  return (
    <div ref={ref} className="sticker flex flex-col items-center gap-3 bg-surface p-4 text-center">
      <Avatar slug={g.slug} expression={t.found >= 5 ? mood(g, 'proud') : t.found > 0 ? mood(g, 'happy') : mood(g, 'sad')} size={96} />
      <h2 className="font-display text-3xl leading-tight font-extrabold">{title}</h2>
      {t.log.length > 0 && (
        <div className="flex flex-wrap justify-center gap-1.5">
          {t.log.map((e, i) => (
            <LogChip key={i} name={e.n} found={e.r === 'found'} delay={0.2 + i * 0.05} />
          ))}
        </div>
      )}
      <div className="h-2 w-full overflow-hidden rounded-full border-2 border-ink bg-sunk">
        <div className="h-full rounded-full bg-grape transition-[width] duration-300 ease-linear" style={{ width: `${frac * 100}%` }} />
      </div>
      <p className="text-sm text-muted">{s.turn >= s.total_turns ? 'Résultats dans un instant…' : `Prochain : ${get(s.order[s.turn % s.order.length]).nickname}`}</p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Scores                                                                      */
/* -------------------------------------------------------------------------- */

function Scoreboard({ s, get, meId }: { s: QsjState; get: Get; meId: string }) {
  const rows = useMemo(
    () => [...s.players].sort((a, b) => (s.scores[b] ?? 0) - (s.scores[a] ?? 0) || s.order.indexOf(a) - s.order.indexOf(b)),
    [s.players, s.scores, s.order],
  )
  return (
    <div className="sticker flex flex-col gap-1.5 bg-surface p-3">
      <p className="font-display text-lg font-extrabold">Cartes trouvées</p>
      {rows.map((id) => {
        const p = get(id)
        const active = id === s.guesser && (s.phase === 'placing' || s.phase === 'playing')
        return (
          <motion.div
            layout
            key={id}
            className={cn('flex items-center gap-2 rounded-card px-2 py-1', active && 'bg-sunk', id === meId && 'font-extrabold')}
          >
            <Avatar slug={p.slug} size={34} />
            <span className="min-w-0 flex-1 truncate font-display text-base font-extrabold">
              {p.nickname}
              {id === meId && <span className="text-muted"> (toi)</span>}
            </span>
            {active && <span className="text-sm font-bold text-grape">devine 🙈</span>}
            <span className="font-display text-xl font-extrabold tabular-nums">
              <AnimatedNumber value={s.scores[id] ?? 0} duration={0.5} />
            </span>
          </motion.div>
        )
      })}
    </div>
  )
}

