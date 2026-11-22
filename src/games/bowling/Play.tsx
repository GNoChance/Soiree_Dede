import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Flag, Hourglass, ListOrdered, Loader2, RefreshCw, Send } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { BottomSheet } from '@/components/ui/Modal'
import { burst, victoryConfetti } from '@/components/ui/confetti'
import { fx, playSound, vibrate } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import { forceAppUpdate } from '@/lib/forceUpdate'
import { ConfirmModal } from '@/features/soiree/components'
import { mood, playerOrPlaceholder } from '@/features/soiree/players'
import { equippedOf } from '@/data/cadeaux'
import { useCountdown } from '@/features/soiree/useServerClock'
import type { GamePlayProps, PlayerInfo } from '../types'
import { ScoreSheet } from './ScoreSheet'
import { addRoll, nextRoll, pinCount, rollKind, scoreSheet, type RollKind, type Sheet } from './scoring'
import { bwActions, type BowlingState } from './types'
import type { BowlingScene, RollOutcome } from './scene/BowlingScene'

type Get = (id: string) => PlayerInfo
type Flow = 'loading' | 'aim' | 'rolling' | 'result' | 'replay' | 'error' | 'unsupported' | 'outdated'

interface Banner {
  id: number
  kind: RollKind
  pins: number
  gutter: boolean
}

interface Pending {
  frame: number
  roll: number
  mask: number
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export default function BowlingPlay({ state, meId, isHost, players, act, pending }: GamePlayProps) {
  const s = state as unknown as BowlingState
  const n = s.frames
  const get = useCallback((id: string) => playerOrPlaceholder(players, id), [players])
  const isPlayer = s.players.includes(meId)
  const serverSheet: Sheet = useMemo(() => s.sheets?.[meId] ?? [], [s.sheets, meId])
  const myDone = isPlayer && nextRoll(serverSheet, n) === null
  // Garde la piste affichée pendant l'animation de mon dernier lancer.
  const [busy, setBusy] = useState(false)

  const [board, setBoard] = useState(false)
  const [confirmEnd, setConfirmEnd] = useState(false)

  // Échéance globale : n'importe quel client envoie `tick`.
  const left = useCountdown(s.deadline)
  const ticked = useRef<string | null>(null)
  useEffect(() => {
    if (s.phase === 'playing' && s.deadline && left <= 0 && ticked.current !== s.deadline) {
      ticked.current = s.deadline
      void act(bwActions.tick())
    }
  }, [left, s.deadline, s.phase, act])

  // Coups d'éclat des autres joueurs.
  const [shout, setShout] = useState<{ key: string; text: string; player: string } | null>(null)
  const lastKey = useRef<string | null>(null)
  useEffect(() => {
    const lr = s.last_roll
    const key = lr ? `${lr.player}:${lr.at}` : null
    const first = lastKey.current === null
    lastKey.current = key ?? ''
    if (first || !lr || lr.player === meId) return
    if (lr.kind === 'strike' || lr.kind === 'spare') {
      setShout({ key: key!, player: lr.player, text: lr.kind === 'strike' ? 'STRIKE ! 💥' : 'SPARE ! ✨' })
      playSound('pop')
    }
  }, [s.last_roll, meId])
  useEffect(() => {
    if (!shout) return
    const t = window.setTimeout(() => setShout(null), 2400)
    return () => clearTimeout(t)
  }, [shout])

  const ranked = useMemo(
    () => [...s.players].sort((a, b) => (s.scores?.[b] ?? 0) - (s.scores?.[a] ?? 0)),
    [s.players, s.scores],
  )

  return (
    <div className="flex flex-col gap-3 pb-4">
      <MiniBoard s={s} ranked={ranked} meId={meId} get={get} left={s.deadline ? left : null} onOpen={() => setBoard(true)} />

      {isPlayer && (!myDone || busy) ? (
        <Lane s={s} meId={meId} me={get(meId)} serverSheet={serverSheet} act={act} onBusy={setBusy} />
      ) : (
        <Waiting s={s} meId={meId} isPlayer={isPlayer} get={get} />
      )}

      {isHost && (
        <Button variant={myDone || !isPlayer ? 'danger' : 'secondary'} size="sm" icon={<Flag className="size-4" />} onClick={() => setConfirmEnd(true)}>
          Terminer la partie
        </Button>
      )}

      <AnimatePresence>
        {shout && (
          <motion.div
            key={shout.key}
            initial={{ y: -80, opacity: 0, rotate: -6 }}
            animate={{ y: 0, opacity: 1, rotate: -2 }}
            exit={{ y: -80, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 18 }}
            className="sticker pointer-events-none fixed inset-x-0 top-3 z-50 mx-auto flex w-max max-w-[90vw] items-center gap-2 bg-sun px-3 py-1.5 text-[#1f1b2e]"
          >
            <Avatar slug={get(shout.player).slug} expression={mood(get(shout.player), 'proud')} size={36} />
            <span className="font-display text-lg font-extrabold">
              {get(shout.player).nickname} : {shout.text}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <BottomSheet open={board} onClose={() => setBoard(false)} title="Tableau des scores">
        <div className="flex flex-col gap-2">
          {ranked.map((id, i) => (
            <ScoreSheet
              key={id}
              player={get(id)}
              sheet={s.sheets?.[id] ?? []}
              frames={n}
              current={s.next?.[id]?.frame ?? null}
              rank={i + 1}
              me={id === meId}
              done={s.done?.includes(id)}
            />
          ))}
        </div>
      </BottomSheet>

      <ConfirmModal
        open={confirmEnd}
        onClose={() => setConfirmEnd(false)}
        title="Terminer la partie ?"
        danger={!myDone && isPlayer}
        confirmLabel="Terminer"
        loading={pending}
        onConfirm={async () => {
          await act(bwActions.endGame())
          setConfirmEnd(false)
        }}
      >
        {s.done.length < s.players.length
          ? `${s.players.length - s.done.length} joueur(s) n’ont pas fini : leurs lancers manquants compteront 0.`
          : 'Tout le monde a fini.'}
      </ConfirmModal>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Mini tableau en haut                                                        */
/* -------------------------------------------------------------------------- */

function MiniBoard({ s, ranked, meId, get, left, onOpen }: { s: BowlingState; ranked: string[]; meId: string; get: Get; left: number | null; onOpen: () => void }) {
  const mm = left !== null ? `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}` : null
  return (
    <button type="button" onClick={onOpen} className="sticker-sm flex w-full items-center gap-1.5 overflow-hidden bg-surface p-1.5 text-left" aria-label="Voir le tableau des scores">
      <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto [scrollbar-width:none]">
        {ranked.map((id, i) => {
          const done = s.done?.includes(id)
          const nx = s.next?.[id]
          return (
            <motion.div
              key={id}
              layout
              className={cn('flex shrink-0 items-center gap-1 rounded-full border-2 border-ink py-0.5 pr-2 pl-0.5', id === meId ? 'bg-sun text-[#1f1b2e]' : 'bg-paper')}
            >
              <Avatar slug={get(id).slug} size={26} />
              <span className="flex flex-col leading-none">
                <span className="max-w-16 truncate text-[11px] font-bold">
                  {i === 0 && (s.scores?.[id] ?? 0) > 0 ? '👑 ' : ''}
                  {get(id).nickname}
                </span>
                <span className="font-display text-sm font-extrabold tabular-nums">
                  {s.scores?.[id] ?? 0}
                  <span className="ml-1 text-[10px] font-bold opacity-70">{done ? '✅' : nx ? `F${nx.frame}` : ''}</span>
                </span>
              </span>
            </motion.div>
          )
        })}
      </div>
      {mm && (
        <span className={cn('flex shrink-0 items-center gap-0.5 rounded-full border-2 border-ink px-1.5 font-display text-sm font-extrabold tabular-nums', (left ?? 0) < 30000 ? 'bg-tomato text-white' : 'bg-paper')}>
          <Hourglass className="size-3.5" />
          {mm}
        </span>
      )}
      <ListOrdered className="size-5 shrink-0" />
    </button>
  )
}

/* -------------------------------------------------------------------------- */
/* Ma piste (scène 3D)                                                         */
/* -------------------------------------------------------------------------- */

function Lane({ s, meId, me, serverSheet, act, onBusy }: { s: BowlingState; meId: string; me: PlayerInfo; serverSheet: Sheet; act: GamePlayProps['act']; onBusy: (b: boolean) => void }) {
  const n = s.frames
  const host = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<BowlingScene | null>(null)
  const [flow, setFlow] = useState<Flow>('loading')
  const [updating, setUpdating] = useState(false)
  const [banner, setBanner] = useState<Banner | null>(null)
  const [pendingRoll, setPendingRoll] = useState<Pending | null>(null)
  const [nudge, setNudge] = useState(0)
  const [throws, setThrows] = useState(0)
  /** Quilles encore debout après le lancer affiché (phases résultat). */
  const [after, setAfter] = useState<number | null>(null)
  const replayDone = useRef<(() => void) | null>(null)

  // Feuille affichée : serveur + lancer local pas encore confirmé.
  const sheet = useMemo(() => {
    if (!pendingRoll) return serverSheet
    if (serverSheet[pendingRoll.frame - 1]?.[pendingRoll.roll - 1] !== undefined) return serverSheet
    return addRoll(serverSheet, pendingRoll.frame, pendingRoll.mask)
  }, [serverSheet, pendingRoll])
  const next = nextRoll(sheet, n)

  // Références pour les callbacks de la scène (créée une seule fois).
  const live = useRef({ s, serverSheet, sheet, flow })
  useEffect(() => {
    live.current = { s, serverSheet, sheet, flow }
  })
  const retryRef = useRef<(() => void) | null>(null)

  /** Envoie le lancer ; renvoie le nouveau state ou null. */
  const send = useCallback(async (p: Pending) => {
    const res = (await act(bwActions.roll(p.frame, p.roll, p.mask))) as unknown as BowlingState | null
    return res
  }, [act])

  /** Prépare le lancer suivant à partir de la feuille confirmée. */
  const resume = useCallback((fresh: Sheet) => {
    setPendingRoll(null)
    setAfter(null)
    onBusy(false)
    const nx = nextRoll(fresh, n)
    if (!nx) return // partie finie pour moi : le parent bascule sur l'attente
    sceneRef.current?.prepare(nx.standing, true)
    setFlow('aim')
  }, [n, onBusy])

  const onRollEnd = useCallback(async (o: RollOutcome) => {
    const cur = live.current
    const nx = nextRoll(cur.sheet, n)
    if (!nx) return
    const mask = o.mask & nx.standing
    const p: Pending = { frame: nx.frame, roll: nx.roll, mask }
    const local = addRoll(cur.sheet, nx.frame, mask)
    const kind = rollKind(local, nx.frame, nx.roll, n)
    const pins = pinCount(mask)
    setPendingRoll(p)
    setAfter(nx.standing & ~mask)
    onBusy(true)
    setFlow('result')
    setBanner({ id: Date.now(), kind, pins, gutter: o.gutter })
    celebrate(kind, o.gutter, pins)

    // Dernier lancer de la partie (tous les autres ont fini) : on envoie APRÈS
    // les effets, sinon l'écran de résultats coupe l'animation.
    const othersDone = cur.s.players.every((id) => id === meId || cur.s.done?.includes(id))
    const finalRoll = nextRoll(local, n) === null && othersDone
    let sending: Promise<BowlingState | null> | null = finalRoll ? null : send(p)

    await wait(kind === 'strike' ? 1500 : 1900)
    setBanner(null)
    if (kind === 'strike' && sceneRef.current) {
      setFlow('replay')
      await new Promise<void>((resolve) => {
        replayDone.current = resolve
        sceneRef.current!.replay()
      })
    }
    if (!sending) sending = send(p)

    const attempt = async (pr: Promise<BowlingState | null>) => {
      const res = await pr
      if (res && res.sheets) {
        retryRef.current = null
        resume(res.sheets[meId] ?? [])
        return
      }
      // Échec (réseau ou désynchronisation) : bouton « Renvoyer » / « Reprendre ».
      retryRef.current = () => {
        setFlow('result')
        void attempt(send(p))
      }
      setFlow('error')
    }
    await attempt(sending)
  }, [n, meId, send, resume, onBusy])

  const callbacks = useRef({ onRollEnd })
  useEffect(() => {
    callbacks.current = { onRollEnd }
  })

  // Montage de la scène (three + cannon chargés à la demande).
  useEffect(() => {
    let alive = true
    let scene: BowlingScene | null = null
    import('./scene/BowlingScene')
      .then(({ BowlingScene: Scene }) => {
        if (!alive || !host.current) return
        try {
          scene = new Scene(host.current, {
            ballColor: me.color,
            ballStyle: equippedOf(me.equippedItems, 'bowling_ball')?.id === 'bb_noel' ? 'noel' : undefined,
            dark: document.documentElement.classList.contains('dark'),
            callbacks: {
              onThrow: () => {
                setFlow('rolling')
                setThrows((t) => t + 1)
              },
              onRollEnd: (o) => void callbacks.current.onRollEnd(o),
              onInvalidSwipe: () => setNudge((x) => x + 1),
              onReplayEnd: () => {
                replayDone.current?.()
                replayDone.current = null
              },
            },
          })
        } catch (e) {
          console.warn('[bowling] WebGL indisponible', e)
          setFlow('unsupported')
          return
        }
        sceneRef.current = scene
        const nx = nextRoll(live.current.sheet, n)
        scene.prepare(nx?.standing ?? 1023, !!nx)
        setFlow('aim')
      })
      .catch((e) => {
        // Fichier de la scène introuvable : l'appli installée est une ancienne version
        // (son fichier 3D a été remplacé par une mise en ligne). Ce n'est PAS un souci de 3D.
        console.warn('[bowling] chargement de la scène impossible', e)
        if (alive) setFlow('outdated')
      })
    return () => {
      alive = false
      sceneRef.current = null
      scene?.dispose()
    }
    // La scène est créée une seule fois (couleur du joueur figée au montage).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Désynchronisation (ex. autre appareil) : la feuille serveur a avancé sans nous.
  const serverNextKey = JSON.stringify(nextRoll(serverSheet, n))
  const preparedKey = useRef<string | null>(null)
  useEffect(() => {
    if (flow !== 'aim' || pendingRoll || !sceneRef.current) return
    if (preparedKey.current === null) {
      preparedKey.current = serverNextKey
      return
    }
    if (preparedKey.current === serverNextKey) return
    preparedKey.current = serverNextKey
    const nx = JSON.parse(serverNextKey) as { standing: number } | null
    if (nx) sceneRef.current.prepare(nx.standing, true)
  }, [serverNextKey, flow, pendingRoll])

  const myScore = scoreSheet(sheet, n).total

  return (
    <div className="flex flex-col gap-2">
      <div ref={host} className="sticker relative h-[calc(100dvh-15rem)] max-h-[720px] min-h-[380px] w-full overflow-hidden bg-sunk select-none">
        {/* HUD */}
        <div className="pointer-events-none absolute inset-x-2 top-2 z-10 flex items-start justify-between gap-2">
          <div className="sticker-sm flex flex-col bg-surface/90 px-2 py-1 leading-tight">
            <span className="font-display text-base font-extrabold">
              {next ? `Frame ${next.frame}/${n}` : 'Terminé !'}
              {next && next.roll > 1 && <span className="text-muted"> · lancer {next.roll}</span>}
            </span>
            <span className="text-xs font-bold text-muted">
              Score <span className="font-display text-sm text-text">{myScore}</span>
            </span>
          </div>
          <PinDiagram standing={after ?? next?.standing ?? 0} />
        </div>

        {flow === 'loading' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted">
            <Loader2 className="size-8 animate-spin" />
            <span className="font-display font-extrabold">Préparation de la piste…</span>
          </div>
        )}
        {flow === 'outdated' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <span className="text-5xl">🔄</span>
            <span className="font-display text-xl font-extrabold">L’appli doit être mise à jour.</span>
            <span className="text-sm text-muted">Une nouvelle version est sortie : mets à jour pour retrouver la piste (ta partie continue).</span>
            <Button
              disabled={updating}
              onClick={() => {
                setUpdating(true)
                void forceAppUpdate()
              }}
            >
              {updating ? 'Mise à jour…' : 'Mettre à jour'}
            </Button>
          </div>
        )}
        {flow === 'unsupported' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
            <span className="text-5xl">😵</span>
            <span className="font-display text-xl font-extrabold">La 3D ne démarre pas sur cet appareil.</span>
            <span className="text-sm text-muted">Ferme les autres applis et rouvre celle-ci ; sinon l’hôte peut terminer la partie (tes lancers compteront 0).</span>
          </div>
        )}

        {/* Aide */}
        <AnimatePresence>
          {flow === 'aim' && (
            <motion.div
              key={`hint${nudge}`}
              initial={{ opacity: 0, y: 20 }}
              animate={nudge ? { opacity: 1, y: 0, x: [0, -10, 10, -6, 6, 0] } : { opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex flex-col items-center gap-1"
            >
              <motion.span
                animate={{ y: [0, -14, 0] }}
                transition={{ repeat: Infinity, duration: 1.3 }}
                className="font-display text-4xl leading-none font-extrabold text-[#1f1b2e] drop-shadow-[2px_2px_0_white]"
              >
                ↑
              </motion.span>
              <span className="sticker-sm bg-surface/90 px-2 py-0.5 text-center text-sm font-extrabold">
                {throws < 2 ? 'Glisse vers le haut pour lancer · courbe = effet' : 'Glisse vers le haut !'}
              </span>
              {throws < 2 && <span className="sticker-sm bg-surface/80 px-2 py-0.5 text-xs font-bold">↔ fais glisser la boule pour te placer</span>}
            </motion.div>
          )}
        </AnimatePresence>

        {flow === 'replay' && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center">
            <motion.span animate={{ opacity: [1, 0.4, 1] }} transition={{ repeat: Infinity, duration: 1 }} className="sticker-sm bg-tomato px-2 py-0.5 font-display text-sm font-extrabold text-white">
              ● REPLAY · touche pour passer
            </motion.span>
          </div>
        )}

        {flow === 'error' && (
          <div className="absolute inset-x-3 bottom-3 z-20 flex flex-col gap-2">
            <Button fullWidth icon={<Send className="size-5" />} onClick={() => retryRef.current?.()}>
              Renvoyer mon lancer
            </Button>
            <Button
              fullWidth
              variant="secondary"
              size="sm"
              icon={<RefreshCw className="size-4" />}
              onClick={() => {
                retryRef.current = null
                resume(live.current.serverSheet)
              }}
            >
              Reprendre depuis le serveur
            </Button>
          </div>
        )}

        <AnimatePresence>{banner && <RollBanner key={banner.id} b={banner} />}</AnimatePresence>
      </div>
    </div>
  )
}

/** Effets sonores / haptiques / confettis d'un lancer. */
function celebrate(kind: RollKind, gutter: boolean, pins: number) {
  if (kind === 'strike') {
    playSound('fanfare')
    vibrate([40, 30, 40, 30, 160])
    victoryConfetti(1400)
  } else if (kind === 'spare') {
    fx.success()
    burst({ x: 0.5, y: 0.45 }, 110)
  } else if (kind === 'zero') {
    if (gutter) {
      // Trombone triste
      import('./scene/audio').then(({ BowlingAudio }) => {
        const a = new BowlingAudio()
        a.sad()
        setTimeout(() => a.dispose(), 2500)
      }).catch(() => undefined)
      vibrate([80, 60, 160])
    } else fx.fail()
  } else {
    playSound(pins >= 7 ? 'success' : 'pop')
  }
}

function RollBanner({ b }: { b: Banner }) {
  const conf =
    b.kind === 'strike'
      ? { text: 'STRIKE !', sub: '💥 Toutes les quilles !', bg: 'bg-tomato text-white', size: 'text-7xl' }
      : b.kind === 'spare'
        ? { text: 'SPARE !', sub: '✨ Bien rattrapé', bg: 'bg-sky text-[#1f1b2e]', size: 'text-6xl' }
        : b.kind === 'zero'
          ? { text: b.gutter ? 'Gouttière…' : 'Raté !', sub: b.gutter ? '😢 Ça arrive aux meilleurs' : '🙈 Aucune quille', bg: 'bg-grape text-white', size: 'text-5xl' }
          : { text: `${b.pins} quille${b.pins > 1 ? 's' : ''}`, sub: b.pins >= 8 ? '🔥 Joli !' : b.pins >= 5 ? '👍 Pas mal' : '🙂 On continue', bg: 'bg-sun text-[#1f1b2e]', size: 'text-5xl' }
  return (
    <motion.div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.25 } }}>
      <motion.div
        initial={{ scale: b.kind === 'strike' ? 5 : 3, rotate: -25 }}
        animate={{ scale: 1, rotate: -6 }}
        exit={{ scale: 0.4, rotate: 15, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 360, damping: b.kind === 'strike' ? 9 : 13 }}
        className={cn('sticker px-6 py-3 text-center', conf.bg)}
        style={{ boxShadow: '7px 7px 0 0 var(--ink)' }}
      >
        <div className={cn('font-display leading-none font-extrabold tracking-tight', conf.size)}>{conf.text}</div>
        <div className="mt-1 font-display text-lg font-extrabold">{conf.sub}</div>
      </motion.div>
    </motion.div>
  )
}

/** Triangle des quilles debout (vue du joueur : 7-8-9-10 au fond). */
function PinDiagram({ standing }: { standing: number }) {
  const rows = [[7, 8, 9, 10], [4, 5, 6], [2, 3], [1]]
  return (
    <div className="sticker-sm flex flex-col items-center gap-0.5 bg-surface/90 p-1.5">
      {rows.map((r, i) => (
        <div key={i} className="flex gap-0.5">
          {r.map((p) => {
            const up = (standing >> (p - 1)) & 1
            return (
              <motion.span
                key={p}
                animate={{ scale: up ? 1 : 0.7, opacity: up ? 1 : 0.25 }}
                className={cn('size-2.5 rounded-full border-[1.5px] border-ink', up ? 'bg-white' : 'bg-ink')}
              />
            )
          })}
        </div>
      ))}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* J'ai fini / spectateur                                                      */
/* -------------------------------------------------------------------------- */

function Waiting({ s, meId, isPlayer, get }: { s: BowlingState; meId: string; isPlayer: boolean; get: Get }) {
  const waitingFor = s.players.filter((id) => !s.done?.includes(id))
  const ranked = [...s.players].sort((a, b) => (s.scores?.[b] ?? 0) - (s.scores?.[a] ?? 0))
  return (
    <div className="flex flex-col gap-3">
      {isPlayer && (
        <motion.div initial={{ scale: 0.6, rotate: -8 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 14 }} className="sticker flex items-center gap-3 bg-mint p-3 text-[#1f1b2e]">
          <Avatar slug={get(meId).slug} expression={mood(get(meId), 'proud')} size={64} bounce />
          <div>
            <p className="font-display text-xl font-extrabold">Partie terminée !</p>
            <p className="font-display text-4xl leading-none font-extrabold tabular-nums">{s.scores?.[meId] ?? 0} pts</p>
          </div>
        </motion.div>
      )}
      {waitingFor.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-muted">
          <Hourglass className="size-4 animate-spin [animation-duration:3s]" />
          En attente de
          {waitingFor.map((id) => (
            <span key={id} className="flex items-center gap-1">
              <Avatar slug={get(id).slug} size={24} />
              {get(id).nickname}
              <span className="text-xs">F{s.next?.[id]?.frame ?? '?'}</span>
            </span>
          ))}
        </div>
      )}
      {ranked.map((id, i) => (
        <ScoreSheet key={id} player={get(id)} sheet={s.sheets?.[id] ?? []} frames={s.frames} current={s.next?.[id]?.frame ?? null} rank={i + 1} me={id === meId} done={s.done?.includes(id)} compact />
      ))}
    </div>
  )
}
