import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Check, Pencil, Send, SkipForward } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ChibiImage } from '@/components/ui/ChibiImage'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { burst, confettiRain } from '@/components/ui/confetti'
import { supabase } from '@/lib/supabase'
import { fx, vibrate } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import { ConfirmModal } from '@/features/soiree/components'
import { pickExpression, playerOrPlaceholder } from '@/features/soiree/players'
import { serverNow, useCountdown } from '@/features/soiree/useServerClock'
import type { GamePlayProps, PlayerInfo } from '../types'
import DrawCanvas, { type CanvasHandle } from './Canvas'
import { useDrawChannel } from './channel'
import { addToGallery, setLastGalleryMatch } from './gallery'
import { DIFFICULTY_LABEL, ddActions, hintCells } from './setup'
import type { DrawSecret, DrawState, FeedEntry } from './types'

type Get = (id: string) => PlayerInfo
type ActFn = GamePlayProps['act']

const gamerFace = (p: PlayerInfo) => pickExpression(p, 'gamer', 'cool', 'pouces', 'joie')
const thinkFace = (p: PlayerInfo) => pickExpression(p, 'reflexion', 'clin_oeil', 'surprise')

/* -------------------------------------------------------------------------- */
/* Hooks                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Mon secret, relu à chaque changement de tour/phase et après mes propositions
 * (useMatch ne relit `match_secrets` qu'à la (re)connexion). Un secret d'un
 * autre tour est ignoré.
 */
function useDrawSecret(matchId: string, turn: number, phase: string, propSecret: unknown) {
  const [fetched, setFetched] = useState<DrawSecret | null>(null)
  const reqId = useRef(0)
  const refresh = useCallback(async () => {
    const id = ++reqId.current
    const { data, error } = await supabase.from('match_secrets').select('secret').eq('match_id', matchId).maybeSingle()
    if (id !== reqId.current || error) return
    setFetched((data?.secret as unknown as DrawSecret | null) ?? null)
  }, [matchId])
  useEffect(() => {
    void refresh()
  }, [refresh, turn, phase])
  const prop = propSecret as DrawSecret | null
  const secret = fetched?.turn === turn ? fetched : prop?.turn === turn ? prop : null
  return { secret, refresh }
}

/**
 * Envoie `{"type":"tick"}` aux échéances (deadline, next_hint_at). Le serveur
 * ignore un tick prématuré. Décalage selon le rôle pour éviter la rafale :
 * dessinateur d'abord, puis l'hôte, puis les autres (relance toutes les 3 s).
 */
function useAutoTick(s: DrawState, act: ActFn, meId: string, isHost: boolean) {
  const target = useMemo(() => {
    if (s.phase === 'finished' || s.phase === 'aborted' || !s.deadline) return null
    const d = new Date(s.deadline).getTime()
    const h = s.phase === 'drawing' && s.next_hint_at ? new Date(s.next_hint_at).getTime() : Infinity
    return Math.min(d, h)
  }, [s.phase, s.deadline, s.next_hint_at])
  const role = s.drawer === meId ? 0 : isHost ? 1 : 2
  const actRef = useRef(act)
  useEffect(() => {
    actRef.current = act
  })
  useEffect(() => {
    if (target == null) return
    const delay = role === 0 ? 120 : role === 1 ? 500 : 1300 + Math.random() * 1500
    let timer = 0
    const fire = () => {
      void actRef.current(ddActions.tick())
      timer = window.setTimeout(fire, 3000 + Math.random() * 1000)
    }
    timer = window.setTimeout(fire, Math.max(0, target - serverNow()) + delay)
    return () => clearTimeout(timer)
  }, [target, role])
}

/** Hauteur du viewport visible (clavier mobile déduit, iOS compris). */
function useVisualViewportHeight() {
  const [h, setH] = useState(() => (typeof window === 'undefined' ? 800 : (window.visualViewport?.height ?? window.innerHeight)))
  useEffect(() => {
    const vv = window.visualViewport
    const on = () => setH(vv?.height ?? window.innerHeight)
    vv?.addEventListener('resize', on)
    window.addEventListener('resize', on)
    return () => {
      vv?.removeEventListener('resize', on)
      window.removeEventListener('resize', on)
    }
  }, [])
  return h
}

/* -------------------------------------------------------------------------- */
/* Écran principal                                                             */
/* -------------------------------------------------------------------------- */

export default function DessinePlay({ matchId, state, secret: propSecret, meId, isHost, players, act, pending }: GamePlayProps) {
  const s = state as unknown as DrawState
  const get: Get = (id) => playerOrPlaceholder(players, id)
  const isPlayer = s.players.includes(meId)
  const isDrawer = s.drawer === meId
  const { secret, refresh } = useDrawSecret(matchId, s.turn, s.phase, propSecret)
  const canvasRef = useRef<CanvasHandle>(null)
  const [confirmSkip, setConfirmSkip] = useState(false)
  const [optimisticWord, setOptimisticWord] = useState<{ turn: number; word: string } | null>(null)

  useAutoTick(s, act, meId, isHost)
  useEffect(() => setLastGalleryMatch(matchId), [matchId])

  // Snapshots du dessinateur (galerie du Summary).
  const { send } = useDrawChannel(matchId, (msg) => {
    if (msg.event !== 'snapshot') return
    addToGallery(matchId, { turn: msg.payload.turn, drawer: msg.payload.drawer, word: msg.payload.word, data: msg.payload.data, official: true })
  })

  // Fin de tour : capture locale + diffusion par le dessinateur.
  const revealWord = s.phase === 'reveal' ? (s.last_turn?.word ?? null) : null
  const revealTurn = s.phase === 'reveal' ? s.turn : null
  useEffect(() => {
    if (revealTurn == null) return
    const data = canvasRef.current?.snapshot(480)
    if (!data) return
    addToGallery(matchId, { turn: revealTurn, drawer: s.drawer, word: revealWord, data, official: isDrawer })
    if (isDrawer) {
      const small = canvasRef.current?.snapshot(360) ?? data
      send({ event: 'snapshot', payload: { turn: revealTurn, drawer: s.drawer, word: revealWord, data: small } })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealTurn])

  const myWord = isDrawer ? (secret?.word ?? (optimisticWord?.turn === s.turn ? optimisticWord.word : null)) : null
  const drawer = get(s.drawer)
  const showCanvas = s.phase === 'drawing' || s.phase === 'reveal'

  return (
    <div className="flex flex-col gap-3 pb-6">
      <TurnHeader s={s} drawer={drawer} isDrawer={isDrawer} myWord={myWord} />

      <AnimatePresence mode="wait">
        {s.phase === 'choosing' && (
          <motion.div key={`choose-${s.turn}`} initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9 }}>
            {isDrawer ? (
              <ChooseCards
                key={s.turn}
                secret={secret}
                pending={pending}
                onChoose={async (i) => {
                  const w = secret?.choices?.[i]?.word
                  if (w) setOptimisticWord({ turn: s.turn, word: w })
                  const r = await act(ddActions.chooseWord(i))
                  if (r) void refresh()
                }}
              />
            ) : (
              <WaitingChoice drawer={drawer} />
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {showCanvas && (
        <DrawingStage
          key={`stage-${s.turn}`}
          s={s}
          matchId={matchId}
          meId={meId}
          isDrawer={isDrawer}
          isPlayer={isPlayer}
          secret={secret}
          canvasRef={canvasRef}
          get={get}
          act={act}
          onGuessed={() => void refresh()}
        />
      )}

      <Scoreboard s={s} get={get} meId={meId} />

      {isHost && (s.phase === 'choosing' || s.phase === 'drawing') && (
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
              await act(ddActions.skipTurn())
              setConfirmSkip(false)
            }}
          >
            Pratique si {drawer.nickname} est absent·e. Les points déjà gagnés sont gardés.
          </ConfirmModal>
        </>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* En-tête : dessinateur, indice, minuteur                                     */
/* -------------------------------------------------------------------------- */

function TurnHeader({ s, drawer, isDrawer, myWord }: { s: DrawState; drawer: PlayerInfo; isDrawer: boolean; myWord: string | null }) {
  const left = useCountdown(s.deadline)
  const total = (s.phase === 'choosing' ? s.choose_seconds : s.phase === 'drawing' ? s.draw_seconds : s.reveal_seconds) * 1000
  const frac = total ? Math.min(1, left / total) : 0
  const secs = Math.ceil(left / 1000)
  const urgent = s.phase === 'drawing' && secs <= 10
  const reduce = useReducedMotion()
  const lastSec = useRef(secs)
  useEffect(() => {
    if (secs !== lastSec.current && urgent && secs > 0 && secs <= 5) fx.tick()
    lastSec.current = secs
  }, [secs, urgent])

  return (
    <div className="sticker flex flex-col gap-2 bg-surface p-2.5">
      <div className="flex items-center gap-2">
        <motion.div
          key={`${s.drawer}-${s.phase}`}
          initial={{ scale: 0, rotate: -30 }}
          animate={reduce ? { scale: 1, rotate: 0 } : { scale: 1, rotate: s.phase === 'drawing' ? [0, -6, 6, 0] : 0 }}
          transition={s.phase === 'drawing' ? { rotate: { repeat: Infinity, duration: 1.4 }, scale: { type: 'spring', stiffness: 300, damping: 14 } } : { type: 'spring', stiffness: 300, damping: 14 }}
        >
          <Avatar slug={drawer.slug} expression={s.phase === 'choosing' ? thinkFace(drawer) : gamerFace(drawer)} size={48} badge={<Pencil className="size-3.5" />} />
        </motion.div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-sm leading-tight font-extrabold text-muted">
            {isDrawer ? 'À toi de dessiner !' : `${drawer.nickname} dessine`}
          </p>
          {isDrawer && myWord && s.phase === 'drawing' ? (
            <motion.p key={myWord} initial={{ scale: 1.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="truncate font-display text-2xl leading-tight font-extrabold text-grape">
              {myWord}
            </motion.p>
          ) : (
            <HintWord hint={s.phase === 'choosing' ? null : s.hint} reveal={s.phase === 'reveal'} length={s.word_length} />
          )}
        </div>
        <motion.div
          className={cn('flex size-12 shrink-0 items-center justify-center rounded-full border-[3px] border-ink font-display text-xl font-extrabold shadow-sticker-sm', urgent ? 'bg-tomato text-white' : 'bg-sun text-[#1f1b2e]')}
          animate={urgent && !reduce ? { scale: [1, 1.15, 1] } : { scale: 1 }}
          transition={urgent ? { repeat: Infinity, duration: 0.6 } : undefined}
          aria-label={`${secs} secondes`}
        >
          {secs}
        </motion.div>
      </div>
      <div className="h-3 w-full overflow-hidden rounded-full border-2 border-ink bg-sunk">
        <div
          className={cn('h-full rounded-full transition-[width] duration-300 ease-linear', urgent ? 'bg-tomato' : s.phase === 'choosing' ? 'bg-sky' : s.phase === 'reveal' ? 'bg-grape' : 'bg-mint')}
          style={{ width: `${frac * 100}%` }}
        />
      </div>
    </div>
  )
}

/** Tirets de l'indice ; les lettres révélées « popent ». */
function HintWord({ hint, reveal, length }: { hint: string | null; reveal: boolean; length: number | null }) {
  const cells = hintCells(hint)
  if (!cells.length) return <p className="font-display text-lg font-extrabold text-muted">Mot mystère…</p>
  const words: Array<Array<{ ch: string; kind: string; i: number }>> = [[]]
  cells.forEach((c, i) => {
    if (c.ch === ' ') words.push([])
    else words[words.length - 1].push({ ...c, i })
  })
  return (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-1" aria-label={reveal ? `Le mot était ${hint}` : `Mot de ${length ?? '?'} lettres`}>
      {words.map((w, wi) => (
        <span key={wi} className="flex items-end gap-[3px]">
          {w.map((c) =>
            c.kind === 'sep' ? (
              <span key={c.i} className="font-display text-xl font-extrabold">
                {c.ch}
              </span>
            ) : (
              <span key={c.i} className="relative flex h-7 w-[1.1rem] items-end justify-center border-b-[3px] border-ink">
                <AnimatePresence>
                  {c.kind === 'letter' && (
                    <motion.span
                      key={c.ch}
                      initial={{ scale: 0, y: -14, rotate: -25 }}
                      animate={{ scale: 1, y: 0, rotate: 0 }}
                      transition={{ type: 'spring', stiffness: 520, damping: 14, delay: reveal ? c.i * 0.04 : 0 }}
                      className={cn('font-display text-xl leading-none font-extrabold uppercase', reveal ? 'text-grape' : 'text-tangerine')}
                    >
                      {c.ch}
                    </motion.span>
                  )}
                </AnimatePresence>
              </span>
            ),
          )}
        </span>
      ))}
      {!reveal && length ? <span className="pb-0.5 text-xs font-bold text-muted">({length})</span> : null}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Choix du mot                                                                */
/* -------------------------------------------------------------------------- */

function ChooseCards({ secret, pending, onChoose }: { secret: DrawSecret | null; pending: boolean; onChoose: (i: number) => void }) {
  const reduce = useReducedMotion()
  const [picked, setPicked] = useState<number | null>(null)
  const [flipped, setFlipped] = useState(false)
  const choices = secret?.choices ?? null
  useEffect(() => {
    if (!choices) return
    const t = window.setTimeout(() => {
      setFlipped(true)
      fx.whoosh()
    }, reduce ? 0 : 450)
    return () => clearTimeout(t)
  }, [choices, reduce])

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-center text-3xl">Choisis ton mot ✏️</h2>
      <p className="text-center text-sm font-bold text-muted">Cache ton écran ! Sans choix, un mot est tiré pour toi.</p>
      <div className="grid grid-cols-3 gap-2.5">
        {[0, 1, 2].map((i) => {
          const c = choices?.[i]
          const d = c ? DIFFICULTY_LABEL[c.difficulty] : null
          const sel = picked === i
          return (
            <motion.button
              key={i}
              type="button"
              disabled={!c || pending || picked != null}
              onClick={() => {
                if (!c) return
                setPicked(i)
                fx.pop()
                vibrate(20)
                onChoose(i)
              }}
              initial={{ y: 80, opacity: 0, rotate: (i - 1) * 8 }}
              animate={{ y: sel ? -10 : 0, opacity: picked != null && !sel ? 0.35 : 1, rotate: sel ? 0 : (i - 1) * 3, scale: sel ? 1.08 : 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 16, delay: picked == null ? i * 0.08 : 0 }}
              whileTap={{ scale: 0.92 }}
              className="h-40 [perspective:900px]"
            >
              <motion.div
                className="relative size-full [transform-style:preserve-3d]"
                animate={{ rotateY: flipped && c ? 180 : 0 }}
                transition={{ type: 'spring', stiffness: 160, damping: 15, delay: i * 0.12 }}
              >
                <div className="sticker absolute inset-0 flex items-center justify-center bg-grape text-5xl text-white [backface-visibility:hidden]">❓</div>
                <div className="sticker absolute inset-0 flex [transform:rotateY(180deg)] flex-col items-center justify-center gap-2 bg-surface p-1.5 [backface-visibility:hidden]">
                  {d && <Badge tone={d.tone} tilted={false}>{d.label}</Badge>}
                  <span className="font-display text-lg leading-tight font-extrabold break-words hyphens-auto">{c?.word}</span>
                </div>
              </motion.div>
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}

function WaitingChoice({ drawer }: { drawer: PlayerInfo }) {
  const reduce = useReducedMotion()
  return (
    <div className="sticker flex flex-col items-center gap-2 bg-sky p-4 text-center text-[#1f1b2e]">
      <motion.div animate={reduce ? undefined : { rotate: [-4, 4, -4], y: [0, -6, 0] }} transition={{ repeat: Infinity, duration: 2 }}>
        <ChibiImage slug={drawer.slug} expression={thinkFace(drawer)} size={130} />
      </motion.div>
      <p className="font-display text-2xl font-extrabold">{drawer.nickname} choisit un mot…</p>
      <motion.p className="text-3xl" animate={reduce ? undefined : { opacity: [0.2, 1, 0.2] }} transition={{ repeat: Infinity, duration: 1.2 }}>
        🤔 💭
      </motion.p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Dessin + propositions + révélation                                          */
/* -------------------------------------------------------------------------- */

interface StageProps {
  s: DrawState
  matchId: string
  meId: string
  isDrawer: boolean
  isPlayer: boolean
  secret: DrawSecret | null
  canvasRef: React.RefObject<CanvasHandle | null>
  get: Get
  act: ActFn
  onGuessed: () => void
}

interface LocalClose {
  n: number
  text: string
}

function DrawingStage({ s, matchId, meId, isDrawer, isPlayer, secret, canvasRef, get, act, onGuessed }: StageProps) {
  const drawing = s.phase === 'drawing'
  const found = s.found.includes(meId)
  const canGuess = drawing && isPlayer && !isDrawer && !found
  const [focused, setFocused] = useState(false)
  const vvh = useVisualViewportHeight()
  const stageRef = useRef<HTMLDivElement>(null)
  const [closes, setCloses] = useState<LocalClose[]>([])
  const [presque, setPresque] = useState<string | null>(null)

  // « Presque ! » : signalé via mon secret (privé).
  const closeN = secret?.close?.n ?? 0
  const closeText = secret?.close?.text ?? ''
  useEffect(() => {
    if (!closeN) return
    setCloses((l) => (l.some((c) => c.n === closeN) ? l : [...l, { n: closeN, text: closeText }]))
    setPresque(closeText)
    fx.tick()
    vibrate([20, 30, 20])
    const t = window.setTimeout(() => setPresque(null), 2200)
    return () => clearTimeout(t)
  }, [closeN, closeText])

  // Confettis à chaque « a trouvé ».
  const lastFound = useRef(s.found.length)
  useEffect(() => {
    if (s.found.length > lastFound.current) {
      const newest = s.found[s.found.length - 1]
      if (newest === meId) {
        fx.fanfare()
        burst({ x: 0.5, y: 0.45 }, 160)
      } else {
        fx.success()
        burst({ x: 0.2 + Math.random() * 0.6, y: 0.35 }, 70)
      }
    }
    lastFound.current = s.found.length
  }, [s.found, meId])

  // Révélation : pluie de confettis si quelqu'un a trouvé, sinon « raté ».
  useEffect(() => {
    if (s.phase !== 'reveal') return
    if ((s.last_turn?.found.length ?? 0) > 0) confettiRain(1200)
    else fx.fail()
  }, [s.phase, s.last_turn])

  // Clavier ouvert : canvas réduit pour rester visible au-dessus du clavier.
  useEffect(() => {
    if (!focused) return
    const t = window.setTimeout(() => stageRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 80)
    return () => clearTimeout(t)
  }, [focused, vvh])
  const canvasMaxWidth = focused ? Math.max(180, ((vvh - 150) * 4) / 3) : undefined

  const feed = useMemo(() => {
    const all: Array<FeedEntry | (LocalClose & { k: 'close' })> = [...s.feed, ...closes.map((c) => ({ ...c, k: 'close' as const }))]
    return all.sort((a, b) => a.n - b.n)
  }, [s.feed, closes])

  return (
    <div ref={stageRef} className="flex scroll-mt-2 flex-col gap-2">
      <div className="relative mx-auto w-full" style={canvasMaxWidth ? { maxWidth: canvasMaxWidth } : undefined}>
        <DrawCanvas ref={canvasRef} matchId={matchId} turn={s.turn} meId={meId} isDrawer={isDrawer} active={drawing} />
        {/* Bulles du fil par-dessus le canvas quand le clavier est ouvert */}
        {focused && <FeedBubbles feed={feed.slice(-3)} get={get} meId={meId} />}
        <AnimatePresence>
          {presque && (
            <motion.div
              key={presque}
              initial={{ scale: 0, rotate: -12 }}
              animate={{ scale: 1, rotate: -4 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 14 }}
              className="sticker pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 bg-tangerine px-4 py-2 text-center text-[#1f1b2e]"
            >
              <p className="font-display text-2xl font-extrabold">Presque ! 🔥</p>
              <p className="text-sm font-bold">« {presque} »</p>
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>{s.phase === 'reveal' && <RevealCard s={s} get={get} />}</AnimatePresence>
      </div>

      {canGuess && <GuessBox key={s.turn} act={act} onGuessed={onGuessed} onFocusChange={setFocused} />}
      {drawing && found && !isDrawer && (
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="sticker flex items-center gap-2 bg-mint p-2.5 text-[#1f1b2e]">
          <Check className="size-6 shrink-0" strokeWidth={3} />
          <p className="font-display text-lg font-extrabold">
            Trouvé ! {secret?.word ? <>C’était « {secret.word} » 🤫</> : 'Chut, laisse chercher les autres 🤫'}
          </p>
        </motion.div>
      )}
      {drawing && isDrawer && (
        <p className="text-center text-sm font-bold text-muted">Pas de lettres ni de chiffres, hein ! 😇 {s.found.length}/{s.players.length - 1} ont trouvé.</p>
      )}

      <Feed feed={feed} get={get} meId={meId} />
    </div>
  )
}

function GuessBox({ act, onGuessed, onFocusChange }: { act: ActFn; onGuessed: () => void; onFocusChange: (f: boolean) => void }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const submit = async () => {
    const t = text.trim()
    if (!t || sending) return
    setSending(true)
    setText('')
    fx.pop()
    const r = await act(ddActions.guess(t))
    setSending(false)
    if (r) onGuessed()
    inputRef.current?.focus()
  }
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => onFocusChange(true)}
        onBlur={() => onFocusChange(false)}
        maxLength={40}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="send"
        placeholder="Ta proposition…"
        className="sticker-sm h-13 min-w-0 flex-1 rounded-card bg-surface px-3 font-display text-xl font-extrabold text-text outline-none focus:ring-2 focus:ring-grape"
        style={{ fontSize: 18 }}
      />
      <motion.button
        type="submit"
        // Garde le focus (et le clavier) en touchant le bouton.
        onPointerDown={(e) => e.preventDefault()}
        disabled={!text.trim()}
        whileTap={{ scale: 0.85, rotate: -8 }}
        className="flex h-13 w-14 shrink-0 items-center justify-center rounded-card border-[3px] border-ink bg-sun text-[#1f1b2e] shadow-sticker-sm disabled:opacity-50"
        aria-label="Envoyer"
      >
        <Send className="size-6" strokeWidth={2.5} />
      </motion.button>
    </form>
  )
}

type FeedItem = FeedEntry | (LocalClose & { k: 'close' })

function FeedLine({ e, get, meId }: { e: FeedItem; get: Get; meId: string }) {
  if (e.k === 'close') {
    return (
      <span className="flex items-center gap-1.5">
        <span className="font-bold text-muted">Toi :</span>
        <span className="font-bold">{e.text}</span>
        <Badge tone="sun" tilted={false}>Presque ! 🔥</Badge>
      </span>
    )
  }
  const p = get(e.p)
  if (e.k === 'found') {
    return (
      <span className="flex items-center gap-1.5 font-display font-extrabold">
        🎉 {e.p === meId ? 'Tu as' : `${p.nickname} a`} trouvé ! {e.pts ? <span className="text-sm">+{e.pts}</span> : null}
      </span>
    )
  }
  return (
    <span className="min-w-0">
      <span className="font-extrabold">{e.p === meId ? 'Toi' : p.nickname} :</span> <span className="break-words">{e.t}</span>
    </span>
  )
}

function Feed({ feed, get, meId }: { feed: FeedItem[]; get: Get; meId: string }) {
  const listRef = useRef<HTMLUListElement>(null)
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [feed.length])
  if (!feed.length) {
    return <p className="text-center text-sm font-bold text-muted">Les propositions apparaîtront ici 💬</p>
  }
  return (
    <ul ref={listRef} className="sticker flex max-h-56 flex-col gap-1 overflow-y-auto bg-sunk p-2" aria-live="polite">
      <AnimatePresence initial={false}>
        {feed.map((e) => {
          const p = e.k === 'close' ? get(meId) : get(e.p)
          return (
            <motion.li
              key={`${e.k}-${e.n}`}
              layout
              initial={{ opacity: 0, x: -30, scale: 0.8 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              transition={{ type: 'spring', stiffness: 420, damping: 22 }}
              className={cn('flex items-center gap-2 rounded-chip px-1.5 py-1', e.k === 'found' ? 'bg-mint/30' : e.k === 'close' ? 'bg-sun/30' : 'bg-surface')}
            >
              <Avatar slug={p.slug} expression={e.k === 'found' ? pickExpression(p, 'joie', 'pouces') : p.equipped} size={26} />
              <FeedLine e={e} get={get} meId={meId} />
            </motion.li>
          )
        })}
      </AnimatePresence>
    </ul>
  )
}

function FeedBubbles({ feed, get, meId }: { feed: FeedItem[]; get: Get; meId: string }) {
  return (
    <div className="pointer-events-none absolute bottom-2 left-2 flex max-w-[85%] flex-col items-start gap-1">
      <AnimatePresence initial={false}>
        {feed.map((e) => (
          <motion.div
            key={`${e.k}-${e.n}`}
            initial={{ opacity: 0, y: 16, scale: 0.8 }}
            animate={{ opacity: 0.95, y: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            className="rounded-chip border-2 border-ink bg-surface/95 px-2 py-0.5 text-sm text-text shadow-sticker-sm"
          >
            <FeedLine e={e} get={get} meId={meId} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

function RevealCard({ s, get }: { s: DrawState; get: Get }) {
  const lt = s.last_turn
  const reduce = useReducedMotion()
  if (!lt) return null
  const drawer = get(lt.drawer)
  const pts = lt.points ?? {}
  const nobody = lt.found.length === 0
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-10 flex items-center justify-center rounded-card bg-ink/45 p-3 backdrop-blur-[2px]"
    >
      <motion.div
        initial={reduce ? { opacity: 0 } : { rotateY: 90, scale: 0.6 }}
        animate={reduce ? { opacity: 1 } : { rotateY: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 14 }}
        className="sticker flex w-full max-w-xs flex-col items-center gap-1.5 bg-surface p-3 text-center"
      >
        <p className="text-sm font-bold text-muted">{lt.skipped ? 'Tour passé' : nobody ? 'Personne n’a trouvé…' : 'C’était…'}</p>
        {lt.word && (
          <motion.p
            initial={{ scale: 0.3 }}
            animate={{ scale: [0.3, 1.25, 1] }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="font-display text-3xl leading-tight font-extrabold break-words text-grape"
          >
            {lt.word}
          </motion.p>
        )}
        <div className="flex flex-wrap justify-center gap-1.5">
          {[lt.drawer, ...lt.found].map((id, i) => {
            const p = get(id)
            const gain = pts[id] ?? 0
            if (id === lt.drawer && !gain) return null
            return (
              <motion.div
                key={id}
                initial={{ scale: 0, y: 10 }}
                animate={{ scale: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 400, damping: 14, delay: 0.5 + i * 0.1 }}
                className="flex items-center gap-1 rounded-full border-2 border-ink bg-sunk py-0.5 pr-2 pl-0.5"
              >
                <Avatar slug={p.slug} expression={id === lt.drawer ? gamerFace(p) : pickExpression(p, 'joie', 'pouces')} size={24} />
                <span className="text-xs font-extrabold">+{gain}</span>
              </motion.div>
            )
          })}
        </div>
        {nobody && !lt.skipped && <ChibiImage slug={drawer.slug} expression={pickExpression(drawer, 'pleurs', 'boude', 'surprise')} size={64} />}
      </motion.div>
    </motion.div>
  )
}

/* -------------------------------------------------------------------------- */
/* Scores                                                                      */
/* -------------------------------------------------------------------------- */

function Scoreboard({ s, get, meId }: { s: DrawState; get: Get; meId: string }) {
  const sorted = [...s.players].sort((a, b) => (s.scores[b] ?? 0) - (s.scores[a] ?? 0))
  return (
    <div className="sticker bg-surface p-2">
      <div className="flex flex-wrap justify-center gap-1.5">
        {sorted.map((id) => {
          const p = get(id)
          const drawing = id === s.drawer && s.phase !== 'reveal'
          const found = s.found.includes(id)
          return (
            <motion.div
              key={id}
              layout
              transition={{ type: 'spring', stiffness: 400, damping: 28 }}
              className={cn(
                'flex items-center gap-1 rounded-full border-2 border-ink py-0.5 pr-2 pl-0.5',
                found ? 'bg-mint text-[#1f1b2e]' : drawing ? 'bg-sun text-[#1f1b2e]' : 'bg-sunk',
                id === meId && 'ring-2 ring-grape',
              )}
            >
              <Avatar slug={p.slug} expression={drawing ? gamerFace(p) : found ? pickExpression(p, 'joie', 'pouces') : p.equipped} size={26} />
              <span className="max-w-[4.5rem] truncate text-xs font-extrabold">{p.nickname}</span>
              <AnimatedNumber value={s.scores[id] ?? 0} className="font-display text-sm font-extrabold" />
              {drawing && <Pencil className="size-3.5" strokeWidth={3} />}
              {found && <Check className="size-3.5" strokeWidth={3} />}
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}
