import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, BookOpen, Crosshair, Eye, Fingerprint, Gavel, Heart, Moon as MoonIcon, Shield, Skull, Volume2, VolumeX } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { ChibiImage } from '@/components/ui/ChibiImage'
import { BottomSheet } from '@/components/ui/Modal'
import { burst } from '@/components/ui/confetti'
import { fx, vibrate } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import { ConfirmModal } from '@/features/soiree/components'
import { pickExpression, playerOrPlaceholder } from '@/features/soiree/players'
import { useCountdown } from '@/features/soiree/useServerClock'
import type { GamePlayProps, PlayerInfo } from '../types'
import {
  CAUSE_LABEL,
  ROLE_INFO,
  ROLE_ORDER,
  STEP_INFO,
  isNarratorSecret,
  lgActions,
  type LgDeath,
  type LgNarratorSecret,
  type LgRole,
  type LgSecret,
  type LgState,
  type LgStep,
} from './types'
import { bell, howl, narrationSession, knell, lines, owl, roleWithArticle, speak, speechAvailable, startWind, stopSpeech, stopWind, setVoiceEnabled, unlockNarration, useVoiceEnabled } from './narration'
import { Moon, NightOverlay, SkyPanel } from './Scenery'

type Get = (id: string) => PlayerInfo
type ActFn = GamePlayProps['act']

/** Expression du chibi selon l'état public (mort = pleurs, loup révélé = colère). */
function exprFor(p: PlayerInfo, s: LgState, fallback?: string): string {
  const d = s.dead.find((x) => x.id === p.id)
  if (d) return d.role === 'loup' ? pickExpression(p, 'colere', 'boude') : pickExpression(p, 'pleurs', 'boude')
  return fallback ?? p.equipped
}

const fmt = (ms: number) => {
  const t = Math.ceil(ms / 1000)
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

/* ========================================================================== */
/* Racine                                                                      */
/* ========================================================================== */

export default function LoupGarouPlay({ state, secret, meId, isHost, players, act, pending }: GamePlayProps) {
  const s = state as unknown as LgState
  const narratorSecret = isNarratorSecret(secret) ? (secret as LgNarratorSecret) : null
  const sec = narratorSecret ? null : ((secret as LgSecret | null) ?? null)
  const get: Get = (id) => playerOrPlaceholder(players, id)
  const isPlayer = s.players.includes(meId)
  const alive = s.alive.includes(meId)
  const [cardOpen, setCardOpen] = useState(false)

  useAutoTick(s, isPlayer || isHost, act)
  useHostNarration(s, get, isHost)

  if (s.phase === 'night') {
    return (
      <>
        <div className="h-[60vh]" />
        <NightOverlay>
          <NightScreen s={s} sec={sec} narrator={narratorSecret} meId={meId} isHost={isHost} isPlayer={isPlayer} alive={alive} get={get} act={act} pending={pending} />
        </NightOverlay>
      </>
    )
  }

  return (
    <div className="flex flex-col gap-4 pb-6">
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        <CompositionChips s={s} />
      </div>
      {isHost && <VoiceToggle />}
      {narratorSecret && <NarratorPanel s={s} n={narratorSecret} get={get} />}
      {isPlayer && !alive && (
        <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="sticker flex items-center gap-2 bg-[#2b1d5e] p-3 text-white">
          <span className="text-3xl">👻</span>
          <p className="font-bold leading-snug">Tu es mort·e : tu deviens un fantôme. Tu vois les rôles révélés, rien de plus. Chut, les fantômes ne parlent pas !</p>
        </motion.div>
      )}

      {s.phase === 'roles' && <RolesPhase s={s} sec={sec} isPlayer={isPlayer} isHost={isHost} get={get} act={act} pending={pending} />}
      {s.phase === 'reveal' && s.reveal && <RevealPhase key={`${s.history.length}-${s.reveal.kind}`} s={s} get={get} isHost={isHost} act={act} pending={pending} />}
      {s.phase === 'hunter' && <HunterPhase s={s} meId={meId} get={get} act={act} pending={pending} />}
      {s.phase === 'day' && <DayPhase s={s} get={get} meId={meId} isHost={isHost} act={act} pending={pending} />}
      {s.phase === 'vote' && <VotePhase s={s} get={get} meId={meId} isHost={isHost} act={act} pending={pending} />}

      {isPlayer && s.phase !== 'roles' && (
        <Button variant="secondary" fullWidth icon={<Fingerprint className="size-5" />} onClick={() => setCardOpen(true)}>
          Ma carte secrète
        </Button>
      )}
      <BottomSheet open={cardOpen} onClose={() => setCardOpen(false)} title="Ma carte secrète">
        <RoleCard sec={sec} get={get} />
        <SecretNotes sec={sec} get={get} />
      </BottomSheet>

      <VillageRoster s={s} get={get} meId={meId} />
    </div>
  )
}

/* ========================================================================== */
/* Minuteurs : tick automatique à l'échéance                                   */
/* ========================================================================== */

function useAutoTick(s: LgState, enabled: boolean, act: ActFn) {
  const live = enabled && s.phase !== 'finished' && s.phase !== 'aborted'
  const left = useCountdown(live ? s.deadline : null, 400)
  const expired = live && Boolean(s.deadline) && left <= 0
  useEffect(() => {
    if (!expired) return
    let stop = false
    const fire = () => {
      if (!stop) void act(lgActions.tick())
    }
    // léger étalement pour éviter que 9 téléphones tirent exactement en même temps
    const t = window.setTimeout(fire, 250 + Math.random() * 900)
    const iv = window.setInterval(fire, 5000)
    return () => {
      stop = true
      clearTimeout(t)
      clearInterval(iv)
    }
  }, [expired, s.deadline, act])
}

/* ========================================================================== */
/* Narration vocale (hôte uniquement, infos publiques seulement)               */
/* ========================================================================== */

function narrationKey(s: LgState): string {
  return [s.phase, s.night, s.step ?? '', s.reveal?.kind ?? '', s.history.length, s.revote ? 'r' : '', s.hunter ?? ''].join('|')
}

function useHostNarration(s: LgState, get: Get, enabled: boolean) {
  const voice = useVoiceEnabled()
  const lastKey = useRef<string | null>(null)
  const lastStep = useRef<LgStep | null>(null)
  const stateRef = useRef(s)
  useEffect(() => {
    stateRef.current = s
  })

  // Déverrouillage audio iOS au premier geste.
  useEffect(() => {
    if (!enabled) return
    const once = () => unlockNarration()
    window.addEventListener('pointerdown', once, { once: true })
    return () => window.removeEventListener('pointerdown', once)
  }, [enabled])

  useEffect(
    () => () => {
      stopWind()
      stopSpeech()
    },
    [],
  )

  const key = narrationKey(s)
  useEffect(() => {
    if (!enabled || !voice) return
    if (key === lastKey.current) return
    const prevKey = lastKey.current
    lastKey.current = key
    const st = stateRef.current
    const name = (id: string) => get(id).nickname
    const deaths = (list: LgDeath[]) => list.map((d) => ({ name: name(d.id), role: d.role, cause: d.cause }))
    const wasNight = prevKey?.startsWith('night|') ?? false
    const out: string[] = []

    if (st.phase === 'roles') {
      out.push(lines.intro())
    } else if (st.phase === 'night' && st.step) {
      if (wasNight && lastStep.current) out.push(lines.sleep(lastStep.current))
      else {
        out.push(lines.nightFalls(st.night))
        startWind()
        window.setTimeout(owl, 1800)
      }
      out.push(lines.wake(st.step))
      if (st.step === 'loups') window.setTimeout(howl, 600)
      lastStep.current = st.step
    } else if (st.phase === 'reveal' && st.reveal) {
      const r = st.reveal
      if (wasNight && lastStep.current) out.push(lines.sleep(lastStep.current))
      lastStep.current = null
      stopWind()
      if (r.kind === 'dawn') {
        bell(3)
        out.push(...lines.dawn(deaths(r.deaths)))
      } else if (r.kind === 'vote') {
        if (r.deaths.length) knell()
        const main = r.deaths.find((d) => d.cause === 'vote')
        out.push(...lines.voteResult(main ? name(main.id) : null, main ? roleWithArticle(main.role) : null, r.outcome, deaths(r.deaths.filter((d) => d.cause !== 'vote'))))
      } else {
        if (r.deaths.length) knell()
        out.push(...lines.hunterResult(deaths(r.deaths)))
      }
      if (st.hunter_pending) out.push(lines.hunter(name(st.hunter_pending)))
    } else if (st.phase === 'hunter' && st.hunter) {
      if (!prevKey?.startsWith('reveal|')) out.push(lines.hunter(name(st.hunter)))
    } else if (st.phase === 'day') {
      out.push(lines.day())
    } else if (st.phase === 'vote') {
      out.push(lines.vote(st.revote))
    }
    if (out.length) speak(out)
  }, [key, enabled, voice, get])

  useEffect(() => {
    narrationSession.host = enabled
  }, [enabled])
}

function VoiceToggle({ dark }: { dark?: boolean }) {
  const on = useVoiceEnabled()
  if (!speechAvailable()) {
    return <p className={cn('text-center text-xs', dark ? 'text-white/60' : 'text-muted')}>Voix indisponible sur ce téléphone : lis les annonces à voix haute !</p>
  }
  return (
    <button
      type="button"
      onClick={() => {
        unlockNarration()
        setVoiceEnabled(!on)
      }}
      className={cn(
        'mx-auto flex items-center gap-2 rounded-full border-[3px] px-4 py-1.5 font-display font-extrabold shadow-sticker-sm',
        dark ? 'border-white/40 bg-white/10 text-white' : 'border-ink bg-surface',
      )}
    >
      {on ? <Volume2 className="size-5" /> : <VolumeX className="size-5" />}
      Voix du conteur : {on ? 'on' : 'off'}
    </button>
  )
}

/* ========================================================================== */
/* Éléments communs                                                            */
/* ========================================================================== */

function CompositionChips({ s, dark }: { s: LgState; dark?: boolean }) {
  const [open, setOpen] = useState<LgRole | null>(null)
  const info = open ? ROLE_INFO[open] : null
  return (
    <>
      {ROLE_ORDER.filter((r) => s.composition[r] > 0).map((r) => (
        <button
          type="button"
          key={r}
          onClick={() => setOpen(r)}
          aria-label={`Que fait ${roleWithArticle(r)} ?`}
          className={cn(
            'flex items-center gap-1 rounded-full border-2 px-2 py-0.5 text-xs font-extrabold active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-grape',
            dark ? 'border-white/30 bg-white/10 text-white' : 'border-ink text-[#1f1b2e]',
          )}
          style={dark ? undefined : { backgroundColor: ROLE_INFO[r].color }}
        >
          {ROLE_INFO[r].emoji} {s.composition[r] > 1 ? `${s.composition[r]} ` : ''}
          {s.composition[r] > 1 ? ROLE_INFO[r].plural : ROLE_INFO[r].label}
          <span aria-hidden className="opacity-60">?</span>
        </button>
      ))}
      <BottomSheet open={open !== null} onClose={() => setOpen(null)} title={open ? `Que fait ${roleWithArticle(open)} ?` : ''}>
        {info && (
          <div className="flex flex-col gap-3 pb-2">
            <div className="flex items-center gap-3">
              <span className="flex size-14 items-center justify-center rounded-full border-[3px] border-ink text-3xl" style={{ backgroundColor: info.color }}>
                {info.emoji}
              </span>
              <p className="font-display text-2xl font-extrabold">{info.label}</p>
            </div>
            <p className="text-lg leading-snug font-bold">{info.power}</p>
            <p className="text-base leading-snug text-muted">Son but : {info.goal}</p>
            <Button fullWidth onClick={() => setOpen(null)}>
              Compris !
            </Button>
          </div>
        )}
      </BottomSheet>
    </>
  )
}

function RoleBadge({ role, className }: { role: LgRole; className?: string }) {
  const info = ROLE_INFO[role]
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border-2 border-ink px-2 text-sm font-extrabold text-[#1f1b2e]', className)} style={{ backgroundColor: info.color }}>
      {info.emoji} {info.label}
    </span>
  )
}

/** Carte de rôle à retourner en maintenant appuyé (anti-regard). */
function RoleCard({ sec, get, big }: { sec: LgSecret | null; get: Get; big?: boolean }) {
  const [shown, setShown] = useState(false)
  const show = (v: boolean) => {
    if (v && !shown) {
      fx.whoosh()
      vibrate(15)
    }
    setShown(v)
  }
  const info = sec ? ROLE_INFO[sec.role] : null
  const mates = sec?.wolves?.filter((id) => id !== undefined) ?? []
  return (
    <div
      className={cn('w-full touch-none select-none [perspective:1100px]', big ? 'h-80' : 'h-72')}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        show(true)
      }}
      onPointerUp={() => show(false)}
      onPointerCancel={() => show(false)}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && show(true)}
      onKeyUp={() => show(false)}
      onBlur={() => show(false)}
      role="button"
      tabIndex={0}
      aria-label="Maintenir appuyé pour voir ton rôle"
    >
      <motion.div className="relative size-full [transform-style:preserve-3d]" animate={{ rotateY: shown ? 180 : 0 }} transition={{ type: 'spring', stiffness: 260, damping: 22 }}>
        <div
          className="sticker absolute inset-0 flex flex-col items-center justify-center gap-3 overflow-hidden text-white [backface-visibility:hidden]"
          style={{ background: 'linear-gradient(160deg, #141040, #2b1d5e 60%, #4b2a7a)' }}
        >
          <div className="absolute inset-3 rounded-[1.1rem] border-2 border-dashed border-white/25" />
          <Moon size={70} />
          <p className="font-display text-2xl font-extrabold">Maintiens appuyé</p>
          <p className="text-sm opacity-80">pour découvrir ton rôle… cache bien ton écran 🤫</p>
        </div>
        <div
          className="sticker absolute inset-0 flex [transform:rotateY(180deg)] flex-col items-center justify-center gap-2 p-4 text-center text-[#1f1b2e] [backface-visibility:hidden]"
          style={{ backgroundColor: info?.color ?? '#ffb703' }}
        >
          {!sec || !info ? (
            <p className="font-display text-xl font-extrabold">Distribution des rôles…</p>
          ) : (
            <>
              <span className="text-6xl drop-shadow-[3px_3px_0_rgba(31,27,46,.6)]">{info.emoji}</span>
              <p className="font-display text-4xl leading-none font-extrabold">{info.label}</p>
              <p className="text-sm leading-snug font-bold">{info.power}</p>
              <p className="rounded-chip bg-white/60 px-2 py-1 text-xs font-extrabold">🎯 {sec.lover?.mixed ? 'Être les deux derniers survivants avec ton amour !' : info.goal}</p>
              {sec.role === 'loup' && mates.length > 1 && (
                <div className="flex items-center gap-1">
                  <span className="text-xs font-extrabold">Ta meute :</span>
                  {mates.map((id) => (
                    <Avatar key={id} slug={get(id).slug} expression={pickExpression(get(id), 'colere')} size={30} />
                  ))}
                </div>
              )}
              {sec.lover && (
                <div className="flex items-center gap-1 rounded-full bg-bubblegum px-2 py-0.5">
                  <Heart className="size-4 fill-tomato text-tomato" />
                  <span className="text-xs font-extrabold">
                    Amoureux·se de {get(sec.lover.id).nickname} ({ROLE_INFO[sec.lover.role].label})
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      </motion.div>
    </div>
  )
}

/** Carnet secret : visions de la voyante, potions, dernier protégé. */
function SecretNotes({ sec, get }: { sec: LgSecret | null; get: Get }) {
  if (!sec) return null
  const items: ReactNode[] = []
  if (sec.seer?.length) {
    items.push(
      <div key="seer" className="flex flex-col gap-1">
        <p className="font-display font-extrabold">🔮 Tes visions</p>
        {sec.seer.map((v) => (
          <div key={`${v.night}-${v.target}`} className="flex items-center gap-2">
            <span className="w-14 text-xs font-bold text-muted">Nuit {v.night}</span>
            <Avatar slug={get(v.target).slug} expression={v.role === 'loup' ? pickExpression(get(v.target), 'colere') : get(v.target).equipped} size={28} />
            <span className="flex-1 font-bold">{get(v.target).nickname}</span>
            <RoleBadge role={v.role} />
          </div>
        ))}
      </div>,
    )
  }
  if (sec.potions) {
    items.push(
      <p key="pot" className="font-bold">
        🧪 Potion de vie : {sec.potions.life ? 'disponible' : 'utilisée'} · Potion de mort : {sec.potions.death ? 'disponible' : 'utilisée'}
      </p>,
    )
  }
  if (sec.role === 'protecteur') {
    items.push(
      <p key="prot" className="font-bold">
        🛡️ {sec.last_protected ? `Nuit dernière : ${get(sec.last_protected).nickname} (interdit cette nuit)` : 'Tu peux protéger n’importe qui cette nuit.'}
      </p>,
    )
  }
  if (!items.length) return null
  return <div className="sticker mt-3 flex flex-col gap-2 bg-sunk p-3 text-sm">{items}</div>
}

/** Le village : vivants et morts (rôles révélés seulement). */
function VillageRoster({ s, get, meId }: { s: LgState; get: Get; meId: string }) {
  return (
    <div className="sticker flex flex-col gap-2 bg-surface p-3">
      <p className="font-display text-lg font-extrabold">
        🏘️ Le village <span className="text-sm text-muted">· {s.alive.length} en vie</span>
      </p>
      <div className="grid grid-cols-3 gap-2">
        {s.players.map((id) => {
          const p = get(id)
          const d = s.dead.find((x) => x.id === id)
          return (
            <motion.div key={id} layout className={cn('flex flex-col items-center gap-0.5 text-center', d && 'opacity-80')}>
              <div className={cn('relative', d && 'grayscale-[60%]')}>
                <Avatar slug={p.slug} expression={exprFor(p, s)} size={52} badge={d ? <Skull className="size-4" /> : undefined} />
              </div>
              <span className={cn('max-w-full truncate font-display text-sm font-extrabold', id === meId && 'text-grape')}>{p.nickname}</span>
              {d ? <RoleBadge role={d.role} className="px-1.5 text-[0.65rem]" /> : <span className="text-[0.65rem] font-bold text-muted">en vie</span>}
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}

/** Grimoire du meneur : tous les rôles (maintenir appuyé). */
function NarratorPanel({ s, n, get, dark }: { s: LgState; n: LgNarratorSecret; get: Get; dark?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={cn('sticker flex flex-col gap-2 p-3', dark ? 'border-white/30 bg-white/10 text-white' : 'bg-sunk')}>
      <p className="flex items-center gap-2 font-display text-lg font-extrabold">
        <BookOpen className="size-5" /> Grimoire du meneur
      </p>
      <div
        role="button"
        tabIndex={0}
        className="touch-none select-none rounded-chip border-2 border-dashed border-current/40 p-2 text-center font-bold"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          setOpen(true)
        }}
        onPointerUp={() => setOpen(false)}
        onPointerCancel={() => setOpen(false)}
        onContextMenu={(e) => e.preventDefault()}
      >
        {open ? (
          <div className="grid grid-cols-2 gap-1 text-left text-sm">
            {s.players.map((id) => (
              <span key={id} className={cn('truncate', !s.alive.includes(id) && 'line-through opacity-60')}>
                {ROLE_INFO[n.roles[id]]?.emoji} {get(id).nickname}
                {n.lovers.includes(id) && ' 💞'}
              </span>
            ))}
          </div>
        ) : (
          'Maintiens appuyé pour voir tous les rôles (cache l’écran !)'
        )}
      </div>
    </div>
  )
}

function Countdown({ deadline, className, label }: { deadline: string | null; className?: string; label?: string }) {
  const left = useCountdown(deadline)
  const urgent = left > 0 && left < 10_000
  return (
    <motion.div
      animate={urgent ? { scale: [1, 1.08, 1] } : { scale: 1 }}
      transition={urgent ? { repeat: Infinity, duration: 0.8 } : undefined}
      className={cn('flex items-center justify-center gap-2 font-display font-extrabold tabular-nums', urgent && 'text-tomato', className)}
    >
      {label && <span className="text-base font-bold opacity-80">{label}</span>}
      {fmt(left)}
    </motion.div>
  )
}

/** Grille de joueurs sélectionnables (thème nuit ou jour). */
function PlayerGrid({
  ids,
  get,
  s,
  selected,
  onPick,
  disabled,
  dark,
  marks,
  expression,
}: {
  ids: string[]
  get: Get
  s: LgState
  selected: string[]
  onPick: (id: string) => void
  disabled?: (id: string) => boolean
  dark?: boolean
  marks?: (id: string) => ReactNode
  expression?: (p: PlayerInfo, sel: boolean) => string
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {ids.map((id, i) => {
        const p = get(id)
        const sel = selected.includes(id)
        const off = disabled?.(id) ?? false
        return (
          <motion.button
            key={id}
            type="button"
            initial={{ scale: 0, rotate: -8 }}
            animate={{ scale: sel ? 1.07 : 1, rotate: sel ? 2 : 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 16, delay: i * 0.03 }}
            whileTap={off ? undefined : { scale: 0.88 }}
            disabled={off}
            aria-pressed={sel}
            onClick={() => onPick(id)}
            className={cn(
              'relative flex flex-col items-center gap-1 rounded-card border-[3px] p-2',
              dark ? (sel ? 'border-sun bg-white/25' : 'border-white/20 bg-white/5') : sel ? 'border-ink bg-tomato text-white shadow-sticker' : 'border-ink bg-surface shadow-sticker-sm',
              off && 'opacity-35',
            )}
          >
            <Avatar slug={p.slug} expression={expression ? expression(p, sel) : exprFor(p, s)} size={58} />
            <span className="max-w-full truncate font-display text-sm font-extrabold">{p.nickname}</span>
            {marks && <div className="absolute -top-2 -right-1 flex -space-x-2">{marks(id)}</div>}
          </motion.button>
        )
      })}
    </div>
  )
}

/* ========================================================================== */
/* Distribution des rôles                                                      */
/* ========================================================================== */

function RolesPhase({ s, sec, isPlayer, isHost, get, act, pending }: { s: LgState; sec: LgSecret | null; isPlayer: boolean; isHost: boolean; get: Get; act: ActFn; pending: boolean }) {
  return (
    <SkyPanel mode="dusk">
      <div className="flex flex-col gap-3">
        <motion.h2 initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="text-center text-3xl text-white">
          Bienvenue au village 🌒
        </motion.h2>
        <p className="text-center text-sm font-bold text-white/85">Découvre ton rôle en secret. Quand tout le monde est prêt, la nuit tombera…</p>
        {isPlayer ? <RoleCard sec={sec} get={get} big /> : <p className="py-6 text-center font-bold text-white/80">{isHost ? 'Tu es le meneur : regarde ton grimoire ci-dessus 📖' : 'Tu regardes : les rôles sont secrets 🤫'}</p>}
        <Countdown deadline={s.deadline} label="Nuit dans" className="text-xl text-white" />
        {isHost ? (
          <Button size="lg" fullWidth loading={pending} icon={<MoonIcon className="size-6" />} onClick={() => void act(lgActions.next())}>
            Que la nuit tombe…
          </Button>
        ) : (
          <p className="text-center font-bold text-white/80">L’hôte fera tomber la nuit.</p>
        )}
      </div>
    </SkyPanel>
  )
}

/* ========================================================================== */
/* Nuit                                                                        */
/* ========================================================================== */

function NightScreen({
  s,
  sec,
  narrator,
  meId,
  isHost,
  isPlayer,
  alive,
  get,
  act,
  pending,
}: {
  s: LgState
  sec: LgSecret | null
  narrator: LgNarratorSecret | null
  meId: string
  isHost: boolean
  isPlayer: boolean
  alive: boolean
  get: Get
  act: ActFn
  pending: boolean
}) {
  const step = s.step as LgStep
  // Le secret est mis à jour juste après le state : on ne s'y fie que s'il concerne l'étape en cours.
  const synced = sec && sec.step === step && sec.night === s.night
  const acting = Boolean(isPlayer && alive && synced && sec!.acting)
  const showLover = Boolean(step === 'amoureux' && synced && sec!.lover)
  const actorDeadline = useMemo(
    () => (s.step_started && s.step_max ? new Date(new Date(s.step_started).getTime() + s.step_max * 1000).toISOString() : null),
    [s.step_started, s.step_max],
  )

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-col items-center gap-2 pt-2 text-center">
        <Moon size={74} />
        <h2 className="text-3xl text-white">Le village dort…</h2>
        <p className="text-sm font-bold text-white/70">Nuit {s.night} · garde les yeux fermés, un doigt sur l’écran</p>
      </div>

      {narrator && (
        <div className="flex flex-col gap-2">
          <p className="text-center font-display font-extrabold text-sun">
            {STEP_INFO[step]?.emoji} Étape : {STEP_INFO[step]?.label}
          </p>
          <NarratorPanel s={s} n={narrator} get={get} dark />
        </div>
      )}

      <AnimatePresence mode="wait">
        <motion.div key={`${s.night}-${step}-${acting ? 'a' : 'f'}-${showLover ? 'l' : ''}`} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="flex flex-col gap-3">
          {acting ? (
            <>
              <ActionPanel s={s} sec={sec!} meId={meId} get={get} act={act} pending={pending} />
              {!(sec!.done && step !== 'loups') && <Countdown deadline={actorDeadline} label="Temps restant" className="text-lg text-white" />}
              {sec!.done && step !== 'loups' && <SleepPanel s={s} get={get} meId={meId} />}
            </>
          ) : showLover ? (
            <LoverReveal sec={sec!} get={get} />
          ) : isPlayer ? (
            <SleepPanel s={s} get={get} meId={meId} />
          ) : null}
        </motion.div>
      </AnimatePresence>

      {isHost && (
        <div className="mt-auto pt-4">
          <VoiceToggle dark />
        </div>
      )}
    </div>
  )
}

/**
 * Fausse action pour tous ceux qui n'agissent pas : on « borde » ses voisins.
 * Même grille, même fond que les vrais pouvoirs : impossible de deviner qui agit.
 * Aucun son ni vibration la nuit.
 */
function SleepPanel({ s, get, meId }: { s: LgState; get: Get; meId: string }) {
  const [zz, setZz] = useState<Array<{ k: number; id: string; x: number }>>([])
  const [count, setCount] = useState(0)
  const n = useRef(0)
  const tap = (id: string) => {
    const k = ++n.current
    setCount((c) => c + 1)
    setZz((list) => [...list.slice(-12), { k, id, x: Math.random() * 40 - 20 }])
    window.setTimeout(() => setZz((list) => list.filter((z) => z.k !== k)), 1400)
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-center font-display text-lg font-extrabold text-white">Borde tes voisins 💤</p>
      <p className="-mt-2 text-center text-xs font-bold text-white/60">Touche les dormeurs pendant que la nuit passe…</p>
      <div className="relative">
        <PlayerGrid
          ids={s.alive.filter((id) => id !== meId)}
          get={get}
          s={s}
          selected={[]}
          onPick={tap}
          dark
          expression={(p) => pickExpression(p, 'dodo', 'reflexion')}
          marks={(id) => (
            <AnimatePresence>
              {zz
                .filter((z) => z.id === id)
                .map((z) => (
                  <motion.span key={z.k} initial={{ y: 0, opacity: 1, x: z.x }} animate={{ y: -50, opacity: 0 }} exit={{ opacity: 0 }} transition={{ duration: 1.3 }} className="absolute text-xl">
                    💤
                  </motion.span>
                ))}
            </AnimatePresence>
          )}
        />
      </div>
      <p className="text-center text-xs font-bold text-white/50">{count > 0 ? `${count} bordée${count > 1 ? 's' : ''}` : ' '}</p>
    </div>
  )
}

function LoverReveal({ sec, get }: { sec: LgSecret; get: Get }) {
  const [shown, setShown] = useState(false)
  const lover = sec.lover!
  const p = get(lover.id)
  return (
    <div
      className="sticker flex touch-none flex-col items-center gap-2 border-white/40 bg-white/10 p-4 text-center select-none"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        setShown(true)
      }}
      onPointerUp={() => setShown(false)}
      onPointerCancel={() => setShown(false)}
      onContextMenu={(e) => e.preventDefault()}
      role="button"
      tabIndex={0}
    >
      {shown ? (
        <>
          <motion.div animate={{ scale: [1, 1.15, 1] }} transition={{ repeat: Infinity, duration: 0.9 }} className="text-5xl">
            💘
          </motion.div>
          <ChibiImage slug={p.slug} expression={pickExpression(p, 'amoureux', 'charmee', 'bisou')} size={120} />
          <p className="font-display text-2xl font-extrabold">Tu es amoureux·se de {p.nickname} !</p>
          <RoleBadge role={lover.role} />
          <p className="text-sm font-bold">
            {lover.mixed ? 'Un loup et un villageois… Votre seul espoir : être les deux derniers survivants !' : 'Si l’un de vous meurt, l’autre meurt de chagrin.'}
          </p>
        </>
      ) : (
        <>
          <span className="text-5xl">💌</span>
          <p className="font-display text-xl font-extrabold">Cupidon t’a choisi·e !</p>
          <p className="text-sm font-bold text-white/70">Maintiens appuyé pour découvrir ton âme sœur</p>
        </>
      )}
    </div>
  )
}

function ActionPanel({ s, sec, meId, get, act, pending }: { s: LgState; sec: LgSecret; meId: string; get: Get; act: ActFn; pending: boolean }) {
  switch (s.step) {
    case 'cupidon':
      return <CupidonAction s={s} sec={sec} get={get} act={act} pending={pending} />
    case 'voyante':
      return <SeerAction s={s} sec={sec} meId={meId} get={get} act={act} pending={pending} />
    case 'protecteur':
      return <ProtectAction s={s} sec={sec} get={get} act={act} pending={pending} />
    case 'loups':
      return <WolfAction s={s} sec={sec} meId={meId} get={get} act={act} />
    case 'sorciere':
      return <WitchAction s={s} sec={sec} meId={meId} get={get} act={act} pending={pending} />
    default:
      return null
  }
}

function NightTitle({ emoji, title, hint }: { emoji: string; title: string; hint?: string }) {
  return (
    <div className="text-center">
      <p className="font-display text-xl font-extrabold text-white">
        {emoji} {title}
      </p>
      {hint && <p className="text-xs font-bold text-white/60">{hint}</p>}
    </div>
  )
}

function DoneNote({ children }: { children: ReactNode }) {
  return (
    <motion.div initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="sticker border-white/40 bg-white/10 p-4 text-center font-display text-lg font-extrabold text-white">
      {children}
    </motion.div>
  )
}

function CupidonAction({ s, sec, get, act, pending }: { s: LgState; sec: LgSecret; get: Get; act: ActFn; pending: boolean }) {
  const [sel, setSel] = useState<string[]>([])
  if (sec.done) return <DoneNote>💘 Les flèches sont parties… Rendors-toi, Cupidon.</DoneNote>
  const pick = (id: string) => setSel((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(-2)))
  return (
    <div className="flex flex-col gap-3">
      <NightTitle emoji="💘" title="Unis deux cœurs" hint="Choisis deux joueurs (toi compris si tu veux)." />
      <PlayerGrid ids={s.alive} get={get} s={s} selected={sel} onPick={pick} dark expression={(p, on) => (on ? pickExpression(p, 'amoureux', 'bisou') : p.equipped)} />
      <Button size="lg" fullWidth silent disabled={sel.length !== 2} loading={pending} icon={<Heart className="size-6" />} onClick={() => void act(lgActions.cupidon(sel[0], sel[1]))}>
        Décocher les flèches
      </Button>
    </div>
  )
}

function SeerAction({ s, sec, meId, get, act, pending }: { s: LgState; sec: LgSecret; meId: string; get: Get; act: ActFn; pending: boolean }) {
  const [sel, setSel] = useState<string | null>(null)
  const vision = sec.done ? sec.seer?.find((v) => v.night === s.night) : undefined
  if (vision) {
    const p = get(vision.target)
    const info = ROLE_INFO[vision.role]
    return (
      <div className="flex flex-col items-center gap-2">
        <NightTitle emoji="🔮" title="Ta boule de cristal révèle…" />
        <div className="h-72 w-full [perspective:1000px]">
          <motion.div className="relative size-full [transform-style:preserve-3d]" initial={{ rotateY: 0 }} animate={{ rotateY: 180 }} transition={{ delay: 0.5, type: 'spring', stiffness: 120, damping: 14 }}>
            <div className="sticker absolute inset-0 flex items-center justify-center bg-grape text-7xl [backface-visibility:hidden]">🔮</div>
            <div className="sticker absolute inset-0 flex [transform:rotateY(180deg)] flex-col items-center justify-center gap-2 p-3 text-[#1f1b2e] [backface-visibility:hidden]" style={{ backgroundColor: info.color }}>
              <ChibiImage slug={p.slug} expression={vision.role === 'loup' ? pickExpression(p, 'colere') : pickExpression(p, 'joie')} size={110} />
              <p className="font-display text-2xl font-extrabold">{p.nickname}</p>
              <p className="font-display text-3xl font-extrabold">
                {info.emoji} {info.label}
              </p>
            </div>
          </motion.div>
        </div>
        <p className="text-sm font-bold text-white/70">Mémorise bien… puis referme les yeux.</p>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      <NightTitle emoji="🔮" title="Quel secret veux-tu percer ?" hint="Tu découvriras le vrai rôle de ce joueur." />
      <PlayerGrid ids={s.alive.filter((id) => id !== meId)} get={get} s={s} selected={sel ? [sel] : []} onPick={setSel} dark />
      <Button size="lg" fullWidth silent disabled={!sel} loading={pending} icon={<Eye className="size-6" />} onClick={() => sel && void act(lgActions.target(sel))}>
        Regarder dans la boule
      </Button>
    </div>
  )
}

function ProtectAction({ s, sec, get, act, pending }: { s: LgState; sec: LgSecret; get: Get; act: ActFn; pending: boolean }) {
  const [sel, setSel] = useState<string | null>(null)
  if (sec.done) return <DoneNote>🛡️ Ton bouclier veille. Rendors-toi, protecteur.</DoneNote>
  return (
    <div className="flex flex-col gap-3">
      <NightTitle emoji="🛡️" title="Qui protèges-tu cette nuit ?" hint={sec.last_protected ? `Pas ${get(sec.last_protected).nickname} : protégé·e la nuit dernière.` : 'Tu peux te protéger toi-même.'} />
      <PlayerGrid ids={s.alive} get={get} s={s} selected={sel ? [sel] : []} onPick={setSel} disabled={(id) => id === sec.last_protected} dark />
      <Button size="lg" fullWidth silent disabled={!sel} loading={pending} icon={<Shield className="size-6" />} onClick={() => sel && void act(lgActions.target(sel))}>
        Protéger
      </Button>
    </div>
  )
}

function WolfAction({ s, sec, meId, get, act }: { s: LgState; sec: LgSecret; meId: string; get: Get; act: ActFn }) {
  const votes = sec.wolf_votes ?? {}
  const wolves = sec.wolves ?? []
  const aliveWolves = wolves.filter((w) => s.alive.includes(w))
  const mine = votes[meId] ?? null
  const [optimistic, setOptimistic] = useState<string | null | undefined>(undefined)
  const chosen = optimistic !== undefined ? optimistic : mine
  const targets = s.alive.filter((id) => !wolves.includes(id))
  const vote = async (id: string) => {
    const next = chosen === id ? null : id
    setOptimistic(next)
    await act(lgActions.target(next))
    setOptimistic(undefined)
  }
  return (
    <div className="flex flex-col gap-3">
      <NightTitle emoji="🐺" title={sec.done ? 'La meute est d’accord !' : 'Choisissez votre victime'} hint={aliveWolves.length > 1 ? 'Mettez-vous d’accord : les votes de la meute s’affichent en direct.' : 'Tu chasses seul·e cette nuit.'} />
      <div className="flex items-center justify-center gap-1">
        {aliveWolves.map((w) => (
          <div key={w} className="flex flex-col items-center">
            <Avatar slug={get(w).slug} expression={pickExpression(get(w), 'colere')} size={34} />
            <span className="text-[0.6rem] font-bold text-white/70">{votes[w] ? '✓' : '…'}</span>
          </div>
        ))}
      </div>
      <PlayerGrid
        ids={targets}
        get={get}
        s={s}
        selected={chosen ? [chosen] : []}
        onPick={(id) => void vote(id)}
        dark
        expression={(p, on) => (on ? pickExpression(p, 'surprise', 'timide') : pickExpression(p, 'dodo'))}
        marks={(id) =>
          aliveWolves
            .filter((w) => votes[w] === id)
            .map((w) => (
              <span key={w} className="rounded-full border-2 border-[#1f1b2e]">
                <Avatar slug={get(w).slug} expression={pickExpression(get(w), 'colere')} size={22} />
              </span>
            ))
        }
      />
      {sec.done && <p className="text-center text-sm font-bold text-sun">Unanimité ! Vous pouvez encore changer d’avis jusqu’à la fin de l’étape.</p>}
    </div>
  )
}

function WitchAction({ s, sec, meId, get, act, pending }: { s: LgState; sec: LgSecret; meId: string; get: Get; act: ActFn; pending: boolean }) {
  const [save, setSave] = useState(false)
  const [kill, setKill] = useState<string | null>(null)
  if (sec.done) return <DoneNote>🧪 Ton chaudron se refroidit. Ferme les yeux, sorcière.</DoneNote>
  const victim = sec.victim ?? null
  const life = Boolean(sec.potions?.life)
  const death = Boolean(sec.potions?.death)
  return (
    <div className="flex flex-col gap-3">
      <NightTitle emoji="🧪" title="Ton grimoire est ouvert" />
      <div className="sticker flex items-center gap-3 border-white/40 bg-white/10 p-3">
        {victim ? (
          <>
            <Avatar slug={get(victim).slug} expression={pickExpression(get(victim), 'pleurs', 'surprise')} size={60} />
            <div className="flex-1">
              <p className="text-xs font-bold text-white/70">Les loups ont attaqué</p>
              <p className="font-display text-xl font-extrabold">{get(victim).nickname}</p>
            </div>
          </>
        ) : (
          <p className="font-bold">Les loups n’ont attaqué personne cette nuit.</p>
        )}
      </div>
      {victim && life && (
        <button
          type="button"
          onClick={() => setSave((v) => !v)}
          className={cn('rounded-card border-[3px] p-3 text-left font-display font-extrabold', save ? 'border-mint bg-mint/30' : 'border-white/30 bg-white/5')}
        >
          💚 Potion de vie : {save ? `je sauve ${get(victim).nickname}` : 'sauver la victime ?'}
        </button>
      )}
      {!life && <p className="text-sm font-bold text-white/60">💚 Potion de vie déjà utilisée.</p>}
      {death ? (
        <>
          <p className="font-display font-extrabold">☠️ Potion de mort {kill ? `: ${get(kill).nickname}` : '(facultatif)'}</p>
          <PlayerGrid ids={s.alive.filter((id) => id !== meId)} get={get} s={s} selected={kill ? [kill] : []} onPick={(id) => setKill((k) => (k === id ? null : id))} dark />
        </>
      ) : (
        <p className="text-sm font-bold text-white/60">☠️ Potion de mort déjà utilisée.</p>
      )}
      <Button size="lg" fullWidth silent loading={pending} onClick={() => void act(lgActions.witch(save, kill))}>
        {save || kill ? 'Verser les potions' : 'Ne rien faire'}
      </Button>
    </div>
  )
}

/* ========================================================================== */
/* Révélations (aube, vote, chasseur)                                          */
/* ========================================================================== */

function DeathCard({ d, get, delay }: { d: LgDeath; get: Get; delay: number }) {
  const p = get(d.id)
  const info = ROLE_INFO[d.role]
  const wolf = d.role === 'loup'
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (wolf) {
        fx.fanfare()
        burst({ x: 0.5, y: 0.45 }, 110)
      } else fx.fail()
    }, (delay + 1.1) * 1000)
    return () => clearTimeout(t)
  }, [wolf, delay])
  return (
    <motion.div initial={{ scale: 0.3, rotate: -15, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ delay, type: 'spring', stiffness: 220, damping: 13 }} className="flex flex-col items-center gap-1">
      <ChibiImage slug={p.slug} expression={wolf ? pickExpression(p, 'colere', 'boude') : pickExpression(p, 'pleurs', 'boude')} size={120} />
      <p className="font-display text-2xl font-extrabold">{p.nickname}</p>
      <p className="text-sm font-bold opacity-80">{CAUSE_LABEL[d.cause]}</p>
      <div className="h-20 w-56 [perspective:900px]">
        <motion.div className="relative size-full [transform-style:preserve-3d]" initial={{ rotateY: 0 }} animate={{ rotateY: 180 }} transition={{ delay: delay + 0.9, type: 'spring', stiffness: 140, damping: 14 }}>
          <div className="sticker absolute inset-0 flex items-center justify-center bg-ink text-4xl text-white [backface-visibility:hidden]">❓</div>
          <div className="sticker absolute inset-0 flex [transform:rotateY(180deg)] items-center justify-center gap-2 text-[#1f1b2e] [backface-visibility:hidden]" style={{ backgroundColor: info.color }}>
            <span className="text-3xl">{info.emoji}</span>
            <span className="font-display text-2xl font-extrabold">{info.label}</span>
          </div>
        </motion.div>
      </div>
    </motion.div>
  )
}

function RevealPhase({ s, get, isHost, act, pending }: { s: LgState; get: Get; isHost: boolean; act: ActFn; pending: boolean }) {
  const r = s.reveal!
  const mode = r.kind === 'dawn' ? 'dawn' : r.kind === 'vote' ? 'dusk' : 'dusk'
  useEffect(() => {
    if (r.kind === 'dawn' && r.deaths.length === 0) {
      fx.success()
      burst({ x: 0.5, y: 0.4 }, 70)
    }
  }, [r.kind, r.deaths.length])

  let title: ReactNode
  if (r.kind === 'dawn') title = r.deaths.length ? 'Le village découvre avec horreur…' : 'Personne n’est mort cette nuit ! 🌅'
  else if (r.kind === 'vote') title = r.eliminated ? 'Le village a tranché !' : r.outcome === 'tie' ? 'Encore égalité : personne n’est éliminé.' : 'Aucun vote : personne n’est éliminé.'
  else title = r.target ? `🏹 ${get(r.hunter ?? '').nickname} tire sur ${get(r.target).nickname} !` : `🏹 ${get(r.hunter ?? '').nickname} baisse son arme…`

  const counts = r.counts ?? {}
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1])
  return (
    <SkyPanel mode={mode}>
      <div className="flex flex-col items-center gap-4 text-center">
        <motion.h2 initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="text-2xl leading-tight">
          {title}
        </motion.h2>
        {r.kind === 'vote' && ranked.length > 0 && (
          <div className="flex w-full flex-col gap-1">
            {ranked.map(([id, n], i) => (
              <motion.div key={id} initial={{ x: -40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: i * 0.1 }} className="flex items-center gap-2">
                <Avatar slug={get(id).slug} expression={get(id).equipped} size={28} />
                <span className="w-20 truncate text-left text-sm font-bold">{get(id).nickname}</span>
                <motion.div className="h-4 rounded-full border-2 border-ink bg-sun" initial={{ width: 0 }} animate={{ width: `${(n / Math.max(1, ranked[0][1])) * 60}%` }} transition={{ delay: 0.3 + i * 0.1 }} />
                <span className="font-display font-extrabold">{n}</span>
              </motion.div>
            ))}
          </div>
        )}
        {r.deaths.map((d, i) => (
          <DeathCard key={d.id} d={d} get={get} delay={0.4 + i * 1.6} />
        ))}
        {s.hunter_pending && (
          <motion.p initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 1 + r.deaths.length * 1.6 }} className="sticker bg-tangerine px-3 py-2 font-display font-extrabold text-[#1f1b2e]">
            🏹 {get(s.hunter_pending).nickname} était chasseur : il va tirer !
          </motion.p>
        )}
        <Countdown deadline={s.deadline} label="Suite dans" className="text-lg" />
        {isHost ? (
          <Button size="lg" fullWidth loading={pending} icon={<ArrowRight className="size-6" />} onClick={() => void act(lgActions.next())}>
            Continuer
          </Button>
        ) : null}
      </div>
    </SkyPanel>
  )
}

/* ========================================================================== */
/* Chasseur                                                                    */
/* ========================================================================== */

function HunterPhase({ s, meId, get, act, pending }: { s: LgState; meId: string; get: Get; act: ActFn; pending: boolean }) {
  const [sel, setSel] = useState<string | null>(null)
  const hunter = get(s.hunter ?? '')
  const me = s.hunter === meId
  return (
    <SkyPanel mode="dusk">
      <div className="flex flex-col items-center gap-3 text-center">
        <motion.div animate={{ rotate: [-4, 4, -4] }} transition={{ repeat: Infinity, duration: 1.2 }}>
          <ChibiImage slug={hunter.slug} expression={pickExpression(hunter, 'colere', 'boude')} size={110} />
        </motion.div>
        <h2 className="text-2xl">{me ? 'Ton dernier souffle… qui emportes-tu ?' : `${hunter.nickname}, le chasseur, met en joue…`}</h2>
        <Countdown deadline={s.deadline} className="text-2xl" />
        {me && (
          <>
            <div className="w-full text-[#1f1b2e]">
              <PlayerGrid ids={s.alive} get={get} s={s} selected={sel ? [sel] : []} onPick={setSel} expression={(p, on) => (on ? pickExpression(p, 'surprise') : p.equipped)} />
            </div>
            <Button size="lg" fullWidth variant="danger" disabled={!sel} loading={pending} icon={<Crosshair className="size-6" />} onClick={() => sel && void act(lgActions.hunterShot(sel))}>
              Tirer !
            </Button>
            <Button variant="ghost" fullWidth disabled={pending} onClick={() => void act(lgActions.hunterShot(null))}>
              <span className="text-white">Ne pas tirer</span>
            </Button>
          </>
        )}
      </div>
    </SkyPanel>
  )
}

/* ========================================================================== */
/* Jour : débat puis vote                                                      */
/* ========================================================================== */

function DayPhase({ s, get, meId, isHost, act, pending }: { s: LgState; get: Get; meId: string; isHost: boolean; act: ActFn; pending: boolean }) {
  const reduce = useReducedMotion()
  return (
    <SkyPanel mode="day">
      <div className="flex flex-col items-center gap-3 text-center">
        <h2 className="text-3xl">☀️ Jour {s.night} : le débat</h2>
        <p className="text-sm font-bold">Qui agit bizarrement ? Accusez, défendez-vous… les loups mentent !</p>
        <Countdown deadline={s.deadline} className="text-5xl" />
        <div className="flex flex-wrap justify-center gap-1">
          {s.alive.map((id, i) => (
            <motion.div key={id} animate={reduce ? undefined : { y: [0, -5, 0] }} transition={{ repeat: Infinity, duration: 1.6, delay: i * 0.15 }}>
              <Avatar slug={get(id).slug} expression={id === meId ? get(id).equipped : pickExpression(get(id), 'reflexion', 'joie')} size={44} />
            </motion.div>
          ))}
        </div>
        {isHost ? (
          <Button size="lg" fullWidth loading={pending} icon={<Gavel className="size-6" />} onClick={() => void act(lgActions.endDebate())}>
            Passer au vote
          </Button>
        ) : (
          <p className="font-bold">Le vote commencera à la fin du minuteur (ou quand l’hôte le décide).</p>
        )}
      </div>
    </SkyPanel>
  )
}

function VotePhase({ s, get, meId, isHost, act, pending }: { s: LgState; get: Get; meId: string; isHost: boolean; act: ActFn; pending: boolean }) {
  const [confirm, setConfirm] = useState(false)
  const alive = s.alive.includes(meId)
  const mine = s.votes[meId] ?? null
  const voters = Object.keys(s.votes).filter((v) => s.alive.includes(v))
  const all = voters.length >= s.alive.length
  const vote = async (id: string) => {
    if (id === mine || id === meId) return
    fx.pop()
    await act(lgActions.dayVote(id))
  }
  return (
    <div className="flex flex-col gap-3">
      <AnimatePresence>
        {s.revote && s.first_vote && (
          <motion.div initial={{ scale: 0, rotate: 8 }} animate={{ scale: 1, rotate: -2 }} className="sticker bg-tangerine p-3 text-center text-[#1f1b2e]">
            <p className="font-display text-2xl font-extrabold">Égalité ! ⚖️</p>
            <p className="font-bold">Revote entre {s.candidates.map((id) => get(id).nickname).join(' et ')}. Nouvelle égalité = personne n’est éliminé.</p>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex items-center justify-between">
        <h2 className="text-2xl">🗳️ Qui éliminer ?</h2>
        <Countdown deadline={s.deadline} className="text-2xl" />
      </div>
      <p className="text-sm font-bold text-muted">
        {alive ? (mine ? 'Vote public : tu peux changer d’avis tant que tout le monde n’a pas voté.' : 'Touche le joueur que tu veux éliminer.') : 'Les vivants votent…'} ({voters.length}/{s.alive.length})
      </p>
      <PlayerGrid
        ids={s.candidates}
        get={get}
        s={s}
        selected={mine ? [mine] : []}
        onPick={(id) => alive && void vote(id)}
        disabled={(id) => !alive || id === meId || pending}
        expression={(p, on) => (on ? pickExpression(p, 'surprise', 'timide') : p.equipped)}
        marks={(id) =>
          Object.entries(s.votes)
            .filter(([, t]) => t === id)
            .map(([v]) => (
              <motion.span key={v} initial={{ scale: 0 }} animate={{ scale: 1 }} className="rounded-full border-2 border-ink">
                <Avatar slug={get(v).slug} expression={get(v).equipped} size={22} />
              </motion.span>
            ))
        }
      />
      {isHost && (
        <>
          <Button variant={all ? 'primary' : 'secondary'} fullWidth loading={pending} icon={<Gavel className="size-5" />} onClick={() => (all ? void act(lgActions.closeVote()) : setConfirm(true))}>
            Clore le vote
          </Button>
          <ConfirmModal
            open={confirm}
            onClose={() => setConfirm(false)}
            title="Clore le vote ?"
            confirmLabel="Dépouiller"
            onConfirm={() => {
              setConfirm(false)
              void act(lgActions.closeVote())
            }}
          >
            {voters.length}/{s.alive.length} joueurs ont voté. On dépouille avec les votes reçus ?
          </ConfirmModal>
        </>
      )}
    </div>
  )
}

