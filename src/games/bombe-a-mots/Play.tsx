import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { AnimatePresence, motion, useAnimate, useReducedMotion } from 'framer-motion'
import { Send, Skull } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { ChibiImage } from '@/components/ui/ChibiImage'
import { burst } from '@/components/ui/confetti'
import { fx, playSound, vibrate } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import { supabase } from '@/lib/supabase'
import { mood, playerOrPlaceholder } from '@/features/soiree/players'
import { serverNow, useCountdown } from '@/features/soiree/useServerClock'
import type { GameAction } from '@/types/db'
import type { GamePlayProps, PlayerInfo } from '../types'
import type { BamBroadcast, BamEvent, BamState } from './types'
import { bamActions, checkWord, highlight, nextAlive, rejectLabel } from './setup'
import { useBombeChannel, useThrottled } from './channel'
import { preloadDictionary, useDictionary } from './useDictionary'
import { DictIndicator } from './DictIndicator'

type Get = (id: string) => PlayerInfo

/* -------------------------------------------------------------------------- */
/* Horloge locale (re-rendu périodique)                                        */
/* -------------------------------------------------------------------------- */

function useNow(ms: number, active = true): number {
  const [now, setNow] = useState(() => serverNow())
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setNow(serverNow()), ms)
    return () => clearInterval(id)
  }, [ms, active])
  return now
}

/* -------------------------------------------------------------------------- */
/* Sonde d'explosion (échéance cachée)                                         */
/* -------------------------------------------------------------------------- */

/**
 * Le serveur seul connaît l'heure d'explosion. À partir de fuse_started_at + 5 s,
 * on envoie {"type":"tick","quiet":true} : trop tôt => erreur 'bomb_not_ready' (rien
 * n'est écrit, aucun évènement Realtime). Cadence : joueur actif 350 ms, suivant
 * 900 ms, autres ~2,2 s (secours si l'actif est déconnecté).
 */
function useBombProbe(s: BamState, meId: string, matchId: string, isHost: boolean) {
  const playing = s.phase === 'playing' && !!s.turn
  const role = s.turn === meId ? 0 : s.turn && nextAlive(s, s.turn) === meId ? 1 : 2
  const canAct = s.players.includes(meId) || isHost
  const { turn_n: n, fuse_started_at: fuse, min_fuse_ms: minFuse } = s
  useEffect(() => {
    if (!playing || !canAct) return
    const every = [350, 900, 2200][role]
    const startAt = new Date(fuse).getTime() + (minFuse || 5000)
    let stopped = false
    let inflight = false
    let timer = 0
    const loop = () => {
      if (stopped) return
      const wait = startAt - serverNow()
      if (wait > 0) {
        timer = window.setTimeout(loop, wait + Math.random() * 120)
        return
      }
      if (!inflight) {
        inflight = true
        void Promise.resolve(
          supabase.rpc('game_action', { p_match_id: matchId, p_action: bamActions.tick(n) as unknown as GameAction }),
        ).finally(() => {
          inflight = false
        })
      }
      timer = window.setTimeout(loop, every * (0.8 + Math.random() * 0.4))
    }
    loop()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [playing, canAct, role, n, fuse, minFuse, matchId])
}

/** Tic-tac qui accélère (avec un peu de hasard) au fil de la mèche. */
function useTickSound(s: BamState) {
  const playing = s.phase === 'playing'
  const { fuse_started_at: fuse, resume_at: resume } = s
  useEffect(() => {
    if (!playing) return
    let stopped = false
    let timer = 0
    const loop = () => {
      if (stopped) return
      const now = serverNow()
      const start = new Date(fuse).getTime()
      const r = resume ? new Date(resume).getTime() : 0
      if (now < Math.max(start, r)) {
        timer = window.setTimeout(loop, Math.max(start, r) - now + 20)
        return
      }
      playSound('tick')
      const el = now - start
      const base = Math.max(95, 720 - el * 0.055)
      timer = window.setTimeout(loop, base * (0.55 + Math.random() * 0.9))
    }
    loop()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [playing, fuse, resume])
}

/* -------------------------------------------------------------------------- */
/* Composant principal                                                         */
/* -------------------------------------------------------------------------- */

interface Remote {
  p: string
  n: number
  t: string
}
interface Reject {
  p: string
  n: number
  w: string
  reason: string
  k: number
}

export default function BombePlay({ matchId, state, meId, isHost, players, act }: GamePlayProps) {
  const s = state as unknown as BamState
  // Précharge le dico chez TOUS les joueurs dès l'arrivée sur l'écran de jeu.
  useEffect(() => {
    void preloadDictionary()
  }, [])
  const get: Get = useCallback((id: string) => playerOrPlaceholder(players, id), [players])
  const reduce = useReducedMotion()
  const [remote, setRemote] = useState<Remote | null>(null)
  const [reject, setReject] = useState<Reject | null>(null)
  const [shakeScope, shake] = useAnimate<HTMLDivElement>()

  const send = useBombeChannel(matchId, (m: BamBroadcast) => {
    if (m.event === 'typing') setRemote(m.payload)
    else setReject({ ...m.payload, k: Date.now() })
  })

  useBombProbe(s, meId, matchId, isHost)
  useTickSound(s)

  const ev = s.last_event
  const evKey = ev ? `${ev.kind}-${ev.n}` : ''
  const pauseLeft = useCountdown(s.resume_at, 100)
  const exploding = s.phase === 'playing' && ev?.kind === 'explosion' && pauseLeft > 0

  // Réactions sonores / visuelles aux évènements (une fois par évènement, s'il est récent).
  const seen = useRef<string>(evKey)
  useEffect(() => {
    if (!ev || seen.current === evKey) return
    seen.current = evKey
    if (serverNow() - new Date(ev.at).getTime() > 4000) return
    if (ev.kind === 'explosion') {
      playSound('whoosh')
      fx.fail()
      vibrate([200, 60, 300])
      if (shakeScope.current && !reduce) {
        void shake(shakeScope.current, { x: [0, -22, 20, -16, 14, -8, 6, 0], y: [0, 14, -12, 10, -6, 4, 0] }, { duration: 0.7 })
      }
    } else {
      fx.whoosh()
      if (ev.bonus_life) {
        window.setTimeout(() => fx.success(), 200)
        burst({ x: 0.5, y: 0.45 }, 70)
      }
    }
  }, [evKey, ev, reduce, shake, shakeScope])

  const finished = s.phase !== 'playing'
  const holder = s.turn ? get(s.turn) : null
  const live = remote && remote.n === s.turn_n && remote.p === s.turn ? remote.t : ''
  const liveReject = reject && reject.n === s.turn_n && reject.p === s.turn ? reject : null

  return (
    <div ref={shakeScope} className="flex flex-col gap-3 pb-6">
      <SyllableBanner s={s} />

      <Table s={s} meId={meId} get={get} />

      {!finished && holder && s.turn !== meId && (
        <LiveTyping s={s} holder={holder} text={live} rejected={liveReject} />
      )}

      {!finished && s.players.includes(meId) && s.alive.includes(meId) && (
        <WordInput key="input" s={s} meId={meId} act={act} send={send} paused={pauseLeft > 0} />
      )}
      {!finished && s.players.includes(meId) && !s.alive.includes(meId) && (
        <div className="sticker flex items-center gap-3 bg-sunk p-3">
          <ChibiImage slug={get(meId).slug} expression={mood(get(meId), 'sad')} size={56} />
          <p className="font-display text-lg font-extrabold">Éliminé·e ! Tu regardes les autres transpirer 🍿</p>
        </div>
      )}

      {s.players.includes(meId) && <MyAlphabet s={s} meId={meId} />}
      <DictIndicator className="self-center" />

      <AnimatePresence>{exploding && ev?.kind === 'explosion' && <ExplosionOverlay key={evKey} ev={ev} get={get} left={pauseLeft} maxLives={s.max_lives} />}</AnimatePresence>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Syllabe                                                                     */
/* -------------------------------------------------------------------------- */

function SyllableBanner({ s }: { s: BamState }) {
  return (
    <div className="flex items-center justify-center gap-2">
      <AnimatePresence mode="popLayout">
        <motion.div
          key={`${s.syllable}-${s.turn_n}`}
          initial={{ scale: 0.2, rotate: -25, opacity: 0 }}
          animate={{ scale: 1, rotate: -3, opacity: 1 }}
          exit={{ scale: 0.4, opacity: 0, y: -30 }}
          transition={{ type: 'spring', stiffness: 420, damping: 13 }}
          className="sticker bg-sun px-6 py-1 text-[#1f1b2e]"
        >
          <span className="font-display text-5xl font-extrabold tracking-widest uppercase">{s.syllable}</span>
        </motion.div>
      </AnimatePresence>
      <div className="flex flex-col items-start gap-0.5">
        <span className="rounded-full border-2 border-ink bg-surface px-2 text-xs font-extrabold">niv. {s.level}</span>
        <span className="text-xs font-bold text-muted">{'🌶️'.repeat(Math.max(1, Math.min(5, s.level)))}</span>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Table : joueurs en cercle autour de la bombe                                */
/* -------------------------------------------------------------------------- */

const angleOf = (i: number, n: number) => -90 + (360 / n) * i

function Table({ s, meId, get }: { s: BamState; meId: string; get: Get }) {
  const n = s.players.length
  const idx = s.turn ? s.players.indexOf(s.turn) : -1
  const target = idx >= 0 ? angleOf(idx, n) + 90 : 0
  // Rotation cumulée : la bombe prend toujours le chemin le plus court (sens horaire au besoin).
  const [rot, setRot] = useState({ key: s.turn, deg: target })
  if (rot.key !== s.turn) {
    const delta = ((((target - rot.deg) % 360) + 540) % 360) - 180
    setRot({ key: s.turn, deg: rot.deg + delta })
  }
  const radius = n <= 4 ? 38 : 40
  const ev = s.last_event

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[26rem]">
      {/* tapis */}
      <div className="absolute inset-[16%] rounded-full border-[3px] border-dashed border-ink/25 bg-sunk/60" />

      {s.players.map((id, i) => {
        const a = (angleOf(i, n) * Math.PI) / 180
        const x = 50 + radius * Math.cos(a)
        const y = 50 + radius * Math.sin(a)
        return <Seat key={id} id={id} s={s} me={id === meId} get={get} x={x} y={y} />
      })}

      {/* bombe au centre, orientée vers le joueur actif */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
        <motion.div animate={{ rotate: rot.deg }} transition={{ type: 'spring', stiffness: 170, damping: 13, mass: 0.9 }}>
          <Bomb s={s} />
        </motion.div>
      </div>

      {/* mot validé qui s'envole */}
      <AnimatePresence>
        {ev?.kind === 'word' && (
          <motion.div
            key={`w${ev.n}`}
            initial={{ scale: 0.3, opacity: 0, y: 20 }}
            animate={{ scale: [0.3, 1.25, 1], opacity: [0, 1, 1, 0], y: [20, 0, -10, -40] }}
            transition={{ duration: 1.6, times: [0, 0.2, 0.75, 1] }}
            className="pointer-events-none absolute top-[63%] left-1/2 -translate-x-1/2 whitespace-nowrap"
          >
            <span className="rounded-full border-[3px] border-ink bg-mint px-3 py-0.5 font-display text-xl font-extrabold text-[#1f1b2e] uppercase shadow-sticker-sm">
              ✓ {ev.w}
              {ev.bonus_life ? ' +❤️' : ''}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Seat({ id, s, me, get, x, y }: { id: string; s: BamState; me: boolean; get: Get; x: number; y: number }) {
  const p = get(id)
  const alive = s.alive.includes(id)
  const active = s.turn === id
  const lives = s.lives[id] ?? 0
  const ev = s.last_event
  const hurt = ev?.kind === 'explosion' && ev.p === id
  const size = s.players.length > 6 ? 48 : 58
  return (
    <motion.div
      className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
      style={{ left: `${x}%`, top: `${y}%` }}
      animate={active ? { scale: 1.18, y: [0, -6, 0] } : { scale: alive ? 1 : 0.85, y: 0 }}
      transition={active ? { y: { repeat: Infinity, duration: 0.6 }, scale: { type: 'spring', stiffness: 400, damping: 14 } } : { type: 'spring', stiffness: 300, damping: 18 }}
    >
      <div className={cn('relative rounded-full', active && 'ring-4 ring-tomato ring-offset-2 ring-offset-paper', !alive && 'grayscale opacity-50')}>
        <Avatar
          slug={p.slug}
          size={size}
          expression={!alive ? mood(p, 'sleepy') : hurt ? mood(p, 'sad') : active ? mood(p, 'shocked') : p.equipped}
          badge={!alive ? <Skull className="size-4" /> : undefined}
        />
      </div>
      <span className={cn('max-w-[4.5rem] truncate font-display text-xs leading-tight font-extrabold', me && 'underline decoration-2')}>{p.nickname}</span>
      <Hearts lives={lives} max={Math.max(s.max_lives, lives)} small />
    </motion.div>
  )
}

function Hearts({ lives, max, small }: { lives: number; max: number; small?: boolean }) {
  return (
    <div className={cn('flex', small ? 'text-[11px] leading-none' : 'text-lg')}>
      {Array.from({ length: max }, (_, i) => (
        <motion.span
          key={i}
          animate={i < lives ? { scale: 1, opacity: 1 } : { scale: 0.8, opacity: 0.35 }}
          transition={{ type: 'spring', stiffness: 500, damping: 12 }}
          className={cn(i >= lives && 'grayscale')}
        >
          {i < lives ? '❤️' : '🖤'}
        </motion.span>
      ))}
    </div>
  )
}

/** Bombe dessinée : mèche qui raccourcit (sur la durée MAX, sans trahir l'échéance), étincelles. */
function Bomb({ s }: { s: BamState }) {
  const reduce = useReducedMotion()
  const playing = s.phase === 'playing'
  const now = useNow(120, playing)
  const start = new Date(s.fuse_started_at).getTime()
  const paused = !!s.resume_at && now < new Date(s.resume_at).getTime()
  const el = Math.max(0, now - start)
  const frac = paused ? 1 : Math.max(0.08, 1 - el / (s.max_fuse_ms || 12000))
  const hot = !paused && el > (s.min_fuse_ms || 5000)
  const fuseLen = 34 * frac
  // extrémité de la mèche (courbe simplifiée : segment incliné)
  const tipX = 62 + fuseLen * 0.55
  const tipY = 22 - fuseLen * 0.83

  return (
    <motion.div
      className="relative"
      animate={playing && !paused && !reduce ? { scale: hot ? [1, 1.07, 1] : [1, 1.03, 1] } : { scale: 1 }}
      transition={{ repeat: Infinity, duration: hot ? 0.28 : 0.7 }}
    >
      <svg width="120" height="120" viewBox="0 0 120 120" aria-label="Bombe" role="img" className="drop-shadow-[4px_4px_0_var(--ink)]">
        {/* mèche */}
        <path d={`M62 24 L${tipX} ${tipY}`} stroke="#8a5a2b" strokeWidth="5" strokeLinecap="round" />
        {/* col */}
        <rect x="50" y="22" width="22" height="14" rx="3" transform="rotate(30 61 29)" fill="#3a3550" stroke="var(--ink)" strokeWidth="3" />
        {/* corps */}
        <circle cx="54" cy="70" r="38" fill={hot ? '#3d2340' : '#2b2840'} stroke="var(--ink)" strokeWidth="4" />
        <circle cx="40" cy="56" r="9" fill="#ffffff" opacity="0.35" />
        <circle cx="35" cy="52" r="3.5" fill="#ffffff" opacity="0.7" />
      </svg>
      {/* étincelles à l'extrémité de la mèche */}
      {playing && !paused && (
        <div className="pointer-events-none absolute" style={{ left: tipX, top: tipY }}>
          {Array.from({ length: hot ? 7 : 4 }, (_, i) => (
            <motion.span
              key={i}
              className="absolute block size-2 rounded-full"
              style={{ backgroundColor: i % 2 ? '#FFB703' : '#FB8500' }}
              initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
              animate={reduce ? { opacity: 1 } : { x: [0, Math.cos(i * 1.7) * 18], y: [0, Math.sin(i * 1.7) * 18 - 6], opacity: [1, 0], scale: [1.2, 0.3] }}
              transition={{ repeat: Infinity, duration: hot ? 0.35 : 0.6, delay: i * 0.07, ease: 'easeOut' }}
            />
          ))}
          <motion.span
            className="absolute -top-2.5 -left-2.5 block size-5 rounded-full bg-sun blur-[2px]"
            animate={{ scale: [1, 1.6, 0.9, 1.4, 1], opacity: [1, 0.7, 1, 0.8, 1] }}
            transition={{ repeat: Infinity, duration: 0.3 }}
          />
        </div>
      )}
      {paused && <PauseCount until={s.resume_at} />}
    </motion.div>
  )
}

function PauseCount({ until }: { until: string | null }) {
  const left = useCountdown(until, 100)
  const n = Math.ceil(left / 1000)
  if (n <= 0) return null
  return (
    <motion.span
      key={n}
      initial={{ scale: 2.2, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className="absolute top-[58%] left-[45%] -translate-x-1/2 -translate-y-1/2 font-display text-4xl font-extrabold text-white"
    >
      {n}
    </motion.span>
  )
}

/* -------------------------------------------------------------------------- */
/* Saisie                                                                      */
/* -------------------------------------------------------------------------- */

function Highlighted({ text, syl, className }: { text: string; syl: string; className?: string }) {
  const h = highlight(text, syl)
  if (!h) return <span className={className}>{text}</span>
  return (
    <span className={className}>
      {h.before}
      <mark className="rounded-md bg-sun px-0.5 text-[#1f1b2e]">{h.match}</mark>
      {h.after}
    </span>
  )
}

const sizeFor = (len: number) => (len > 18 ? 'text-2xl' : len > 12 ? 'text-3xl' : 'text-4xl')

/** Ce que tape le joueur actif, vu par les autres (broadcast). */
function LiveTyping({ s, holder, text, rejected }: { s: BamState; holder: PlayerInfo; text: string; rejected: Reject | null }) {
  const reduce = useReducedMotion()
  return (
    <div className="sticker flex min-h-20 flex-col items-center justify-center gap-1 bg-surface p-3 text-center">
      <p className="text-sm font-bold text-muted">
        💣 {holder.nickname} {text ? 'tape…' : 'réfléchit…'}
      </p>
      <motion.div
        key={rejected?.k ?? 'ok'}
        animate={rejected && !reduce ? { x: [0, -14, 14, -10, 10, -5, 0] } : undefined}
        transition={{ duration: 0.45 }}
        className="min-h-10 font-display font-extrabold tracking-wide uppercase"
      >
        {text ? <Highlighted text={text} syl={s.syllable} className={sizeFor(text.length)} /> : <span className="text-3xl text-muted/50">…</span>}
      </motion.div>
      <AnimatePresence>
        {rejected && (
          <motion.p key={rejected.k} initial={{ scale: 1.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }} className="font-display font-extrabold text-tomato">
            ✗ {rejected.w ? `« ${rejected.w} » : ` : ''}
            {rejectLabel(rejected.reason, s.syllable)}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}

function WordInput({
  s,
  meId,
  act,
  send,
  paused,
}: {
  s: BamState
  meId: string
  act: GamePlayProps['act']
  send: (m: BamBroadcast) => void
  paused: boolean
}) {
  const myTurn = s.turn === meId
  const dict = useDictionary()
  const reduce = useReducedMotion()
  const inputRef = useRef<HTMLInputElement>(null)
  const [scope, animate] = useAnimate<HTMLFormElement>()
  // Brouillon lié au tour : remis à zéro automatiquement quand turn_n change.
  const [draft, setDraft] = useState({ n: s.turn_n, v: '' })
  const text = draft.n === s.turn_n ? draft.v : ''
  const [err, setErr] = useState<{ n: number; msg: string; k: number } | null>(null)
  const error = err && err.n === s.turn_n ? err : null
  const [sending, setSending] = useState(false)
  const played = useMemo(() => s.words.map((w) => w.w), [s.words])

  const broadcast = useThrottled((t: string) => send({ event: 'typing', payload: { p: meId, n: s.turn_n, t } }), 150)

  // Focus auto quand la bombe arrive (le champ reste monté : le clavier mobile ne se ferme pas).
  useEffect(() => {
    if (myTurn) {
      inputRef.current?.focus()
      fx.pop()
      vibrate([30, 30, 30])
    }
  }, [myTurn, s.turn_n])

  const refuse = (reason: string, w: string) => {
    setErr({ n: s.turn_n, msg: rejectLabel(reason, s.syllable), k: Date.now() })
    fx.fail()
    send({ event: 'reject', payload: { p: meId, n: s.turn_n, w, reason } })
    if (scope.current && !reduce) void animate(scope.current, { x: [0, -18, 18, -12, 12, -6, 6, 0] }, { duration: 0.45 })
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!myTurn || sending) return
    if (paused) return
    const c = checkWord(text, s.syllable, played, dict)
    if (!c.ok) {
      refuse(c.reason, text.trim())
      return
    }
    setSending(true)
    const n = s.turn_n
    const res = (await act(bamActions.word(n, c.word))) as unknown as BamState | null
    setSending(false)
    inputRef.current?.focus()
    if (!res) refuse('server', text.trim())
  }

  return (
    <form ref={scope} onSubmit={(e) => void submit(e)} className="flex flex-col gap-1">
      <motion.div
        animate={myTurn ? { scale: 1, opacity: 1 } : { scale: 0.97, opacity: 0.6 }}
        className={cn('sticker relative flex items-center gap-2 p-2', myTurn ? (error ? 'bg-tomato/15' : 'bg-surface') : 'bg-sunk')}
      >
        {myTurn && !paused && (
          <motion.span
            className="pointer-events-none absolute -top-3 left-3 rounded-full border-2 border-ink bg-tomato px-2 font-display text-xs font-extrabold text-white"
            animate={reduce ? undefined : { rotate: [-4, 4, -4] }}
            transition={{ repeat: Infinity, duration: 0.4 }}
          >
            💣 À toi !
          </motion.span>
        )}
        <div className="relative min-w-0 flex-1">
          {/* Calque : le mot tapé avec la syllabe surlignée (l'input est transparent dessous) */}
          <div aria-hidden className={cn('pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden px-2 font-display font-extrabold whitespace-pre uppercase', sizeFor(text.length))}>
            {text ? <Highlighted text={text} syl={s.syllable} /> : null}
          </div>
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => {
              if (!myTurn || paused) return
              const v = e.target.value.slice(0, 30)
              setDraft({ n: s.turn_n, v })
              broadcast(v)
            }}
            enterKeyHint="send"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            maxLength={30}
            placeholder={myTurn ? (paused ? 'Attention…' : `Un mot avec ${s.syllable.toUpperCase()}`) : 'Attends la bombe…'}
            aria-label="Ton mot"
            className={cn(
              'relative w-full bg-transparent px-2 py-3 text-center font-display font-extrabold text-transparent uppercase caret-[var(--text)] outline-none placeholder:text-base placeholder:normal-case placeholder:text-muted/70',
              sizeFor(text.length),
            )}
          />
        </div>
        <motion.button
          type="submit"
          onPointerDown={(e) => e.preventDefault()}
          whileTap={{ scale: 0.85 }}
          disabled={!myTurn || paused || !text.trim() || sending}
          aria-label="Valider"
          className="flex size-14 shrink-0 items-center justify-center rounded-full border-[3px] border-ink bg-mint text-[#1f1b2e] shadow-sticker-sm disabled:opacity-40"
        >
          <Send className="size-6" strokeWidth={3} />
        </motion.button>
      </motion.div>
      <div className="h-6 text-center">
        <AnimatePresence mode="popLayout">
          {error && (
            <motion.p
              key={error.k}
              initial={{ y: -10, opacity: 0, scale: 1.3 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="font-display font-extrabold text-tomato"
            >
              ✗ {error.msg}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </form>
  )
}

/* -------------------------------------------------------------------------- */
/* Alphabet bonus                                                              */
/* -------------------------------------------------------------------------- */

function MyAlphabet({ s, meId }: { s: BamState; meId: string }) {
  const used = s.letters?.[meId] ?? ''
  const alpha = s.bonus_alphabet || 'abcdefghijlmnopqrstuv'
  return (
    <div className="flex flex-col items-center gap-1">
      <p className="text-xs font-bold text-muted">
        Alphabet bonus : {used.length}/{alpha.length} → +1 ❤️
      </p>
      <div className="flex flex-wrap justify-center gap-0.5">
        {Array.from(alpha).map((c) => {
          const on = used.includes(c)
          return (
            <motion.span
              key={c}
              animate={on ? { scale: [1.5, 1], backgroundColor: '#06D6A0' } : { scale: 1, backgroundColor: 'rgba(0,0,0,0)' }}
              transition={{ type: 'spring', stiffness: 500, damping: 15 }}
              className={cn('flex size-5 items-center justify-center rounded border-[1.5px] border-ink/40 font-display text-[10px] font-extrabold uppercase', on ? 'text-[#1f1b2e]' : 'text-muted')}
            >
              {c}
            </motion.span>
          )
        })}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Explosion plein écran                                                       */
/* -------------------------------------------------------------------------- */

function ExplosionOverlay({ ev, get, left, maxLives }: { ev: Extract<BamEvent, { kind: 'explosion' }>; get: Get; left: number; maxLives: number }) {
  const p = get(ev.p)
  const reduce = useReducedMotion()
  return (
    <motion.div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 overflow-hidden px-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.3 } }}
    >
      <motion.div
        className="absolute inset-0"
        initial={{ background: 'radial-gradient(circle, #ffffff 0%, #ffb703 30%, #ef476f 70%)' }}
        animate={{ background: 'radial-gradient(circle, rgba(251,133,0,0.95) 0%, rgba(239,71,111,0.92) 45%, rgba(31,27,46,0.92) 100%)' }}
        transition={{ duration: 0.6 }}
      />
      {!reduce &&
        Array.from({ length: 14 }, (_, i) => (
          <motion.span
            key={i}
            className="absolute top-1/2 left-1/2 text-4xl"
            initial={{ x: 0, y: 0, scale: 0.3, opacity: 1 }}
            animate={{ x: Math.cos((i / 14) * Math.PI * 2) * 260, y: Math.sin((i / 14) * Math.PI * 2) * 300, scale: 1.4, opacity: 0, rotate: i * 40 }}
            transition={{ duration: 1, ease: 'easeOut' }}
          >
            {i % 3 === 0 ? '💥' : i % 3 === 1 ? '🔥' : '⭐'}
          </motion.span>
        ))}
      <motion.p
        className="relative font-display text-7xl font-extrabold text-white [paint-order:stroke] [-webkit-text-stroke:3px_#1f1b2e]"
        initial={{ scale: 4, rotate: -20 }}
        animate={{ scale: 1, rotate: -6 }}
        transition={{ type: 'spring', stiffness: 260, damping: 9 }}
      >
        BOUM !
      </motion.p>
      <motion.div
        className="relative"
        initial={{ y: 80, scale: 0.4, rotate: 30 }}
        animate={{ y: 0, scale: 1, rotate: [30, -8, 6, 0] }}
        transition={{ delay: 0.25, type: 'spring', stiffness: 220, damping: 10 }}
      >
        <ChibiImage slug={p.slug} expression={mood(p, 'sad')} size={170} />
      </motion.div>
      <motion.p
        className="relative rounded-full border-[3px] border-ink bg-surface px-4 py-1 font-display text-2xl font-extrabold text-text shadow-sticker"
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 0.5, type: 'spring', stiffness: 400, damping: 12 }}
      >
        {ev.eliminated ? `☠️ ${p.nickname} est éliminé·e !` : `${p.nickname} : -1 ❤️`}
      </motion.p>
      <p className="relative font-bold text-white/90">
        Syllabe ratée : <span className="font-display text-xl uppercase">{ev.s}</span>
      </p>
      {!ev.eliminated && <div className="relative"><Hearts lives={ev.lives} max={Math.max(ev.lives, maxLives)} /></div>}
      <p className="relative text-sm font-bold text-white/80">On repart dans {Math.max(1, Math.ceil(left / 1000))}…</p>
    </motion.div>
  )
}
