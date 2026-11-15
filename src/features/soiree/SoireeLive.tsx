import { useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Home, Hourglass, Play, X } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { ChibiImage } from '@/components/ui/ChibiImage'
import { fx } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import { useSession } from '@/store/session'
import { getGame } from '@/games/registry'
import type { PlayerInfo } from '@/games/types'
import type { SoireeEndReason } from '@/types/db'
import {
  IDLE_WARNING_MS,
  dismissBanner,
  liveBannerMode,
  refetchActiveSoirees,
  soireeEndCopy,
  useActiveSoirees,
  useActiveSoireesStore,
} from './activeSoirees'
import { mood, usePlayers } from './players'
import { serverNow, useCountdown, useServerClock } from './useServerClock'

/* -------------------------------------------------------------------------- */
/* Bandeau global « une partie commence »                                      */
/* -------------------------------------------------------------------------- */

/**
 * Monté UNE fois (Root). Maintient la synchro de mes soirées et affiche, en haut
 * de l'écran, un bandeau persistant quand une partie dont je suis joueur démarre
 * dans une de mes soirées que je ne regarde pas : aucune bascule automatique.
 * Sa hauteur est publiée dans `--live-banner-h` : les layouts décalent la page
 * d'autant (le bandeau ne masque jamais un bouton de la page). Sur une page de
 * partie, il est posé en haut du document au lieu de flotter (liveBannerMode) :
 * il défile avec la page et passe sous les surcouches des jeux, donc ne cache ni
 * leurs en-têtes collants (`sticky top-0`) ni leurs révélations plein écran.
 */
export function LiveSoireeBanner() {
  const meId = useSession((s) => s.profile?.id)
  useActiveSoirees(meId)
  useServerClock()
  const banners = useActiveSoireesStore((s) => s.banners)
  const viewingId = useActiveSoireesStore((s) => s.viewing?.soireeId)
  const mode = useActiveSoireesStore((s) => liveBannerMode(s.viewing))
  const soirees = useActiveSoireesStore((s) => s.soirees)
  const { byId } = usePlayers()
  const navigate = useNavigate()
  const ref = useRef<HTMLDivElement>(null)
  const visible = meId ? banners.filter((b) => b.soireeId !== viewingId).slice(-2) : []

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const root = document.documentElement
    const set = () => root.style.setProperty('--live-banner-h', `${Math.ceil(el.getBoundingClientRect().height)}px`)
    set()
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => {
      ro.disconnect()
      root.style.setProperty('--live-banner-h', '0px')
    }
  }, [])

  return (
    // Page de partie : posé en haut du document (défile avec la page) et SOUS les
    // surcouches des jeux (z-40+) ; ailleurs, flottant au-dessus de la page.
    <div
      className={cn(
        'pt-safe pl-safe pr-safe pointer-events-none inset-x-0 top-0',
        mode === 'inline' ? 'absolute z-[35]' : 'fixed z-[45]',
      )}
    >
      <div ref={ref} className="mx-auto flex max-w-md flex-col px-3">
        <AnimatePresence initial={false}>
          {visible.map((b) => {
            const game = getGame(b.gameId)
            const soiree = soirees.find((s) => s.id === b.soireeId)
            const host = b.hostId === meId ? 'toi' : (byId[b.hostId]?.nickname ?? soiree?.host?.nickname ?? 'l’hôte')
            return (
              <BannerItem
                key={b.matchId}
                emoji={game?.emoji ?? '🎲'}
                color={game?.color ?? '#FFB703'}
                gameName={game?.name ?? 'jeu'}
                host={host}
                onJoin={() => {
                  dismissBanner(b.matchId)
                  fx.whoosh()
                  navigate(`/partie/${b.matchId}`)
                }}
                onDismiss={() => {
                  fx.pop()
                  dismissBanner(b.matchId)
                }}
              />
            )
          })}
        </AnimatePresence>
      </div>
    </div>
  )
}

function BannerItem({ emoji, color, gameName, host, onJoin, onDismiss }: { emoji: string; color: string; gameName: string; host: string; onJoin: () => void; onDismiss: () => void }) {
  const reduce = useReducedMotion()
  useEffect(() => {
    fx.success()
  }, [])
  return (
    <motion.div
      layout
      role="status"
      initial={{ y: -80, opacity: 0, rotate: -3, scale: 0.9 }}
      animate={{ y: 0, opacity: 1, rotate: 0, scale: 1 }}
      exit={{ y: -60, opacity: 0, transition: { duration: 0.2 } }}
      transition={{ type: 'spring', stiffness: 380, damping: 18 }}
      className="sticker pointer-events-auto relative mt-2 flex items-center gap-2 overflow-hidden p-2 pr-11 text-[#1f1b2e]"
      style={{ backgroundColor: color }}
    >
      {!reduce && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute -inset-1/2 opacity-20"
          style={{ background: 'repeating-conic-gradient(#fff 0deg 10deg, transparent 10deg 24deg)' }}
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 14, ease: 'linear' }}
        />
      )}
      <motion.span
        aria-hidden
        className="relative text-4xl leading-none"
        animate={reduce ? undefined : { rotate: [0, -14, 14, 0], scale: [1, 1.15, 1] }}
        transition={{ repeat: Infinity, duration: 1.4 }}
      >
        {emoji}
      </motion.span>
      <div className="relative flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">
        <p className="min-w-[9rem] flex-1 font-display text-base leading-tight font-extrabold">
          🎲 Une partie de {gameName} commence chez {host} !
        </p>
        <Button size="sm" onClick={onJoin} icon={<Play className="size-4 fill-current" />}>
          Rejoindre
        </Button>
      </div>
      <button
        type="button"
        aria-label="Masquer"
        onClick={onDismiss}
        className="absolute top-1.5 right-1.5 flex size-8 items-center justify-center rounded-full border-2 border-ink bg-surface text-text shadow-sticker-sm"
      >
        <X className="size-4" strokeWidth={3} />
      </button>
    </motion.div>
  )
}

/* -------------------------------------------------------------------------- */
/* Compte à rebours de fin automatique (20 min sans jeu)                       */
/* -------------------------------------------------------------------------- */

const fmt = (ms: number) => {
  const s = Math.ceil(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * Visible pendant les 5 dernières minutes avant la fin auto (`idle_deadline`).
 * À l'échéance, relance my_active_soirees : le serveur clôt la soirée même sans pg_cron.
 * `salon` : carte (alerte douce à l'apparition) ; `card` : pastille du hub ;
 * `bar` : ligne compacte dans la barre de lancement de l'hôte.
 */
export function IdleCountdown({ deadline, variant, isHost, className }: { deadline: string | null | undefined; variant: 'salon' | 'card' | 'bar'; isHost?: boolean; className?: string }) {
  // Le hook ne sert qu'à re-rendre chaque seconde ; le reste est calculé au rendu
  // (son état a un rendu de retard quand l'échéance arrive : pas de faux « 0:00 »).
  useCountdown(deadline ?? null, 1000)
  const left = deadline ? Math.max(0, new Date(deadline).getTime() - serverNow()) : 0
  const reduce = useReducedMotion()
  const active = Boolean(deadline)
  const expired = active && left <= 0
  const show = active && left <= IDLE_WARNING_MS

  useEffect(() => {
    if (!expired) return
    const t = window.setTimeout(() => void refetchActiveSoirees(), 1500)
    return () => window.clearTimeout(t)
  }, [expired, deadline])

  const warned = useRef(false)
  useEffect(() => {
    if (variant !== 'salon' || !show || expired || warned.current) return
    warned.current = true
    fx.tick()
  }, [variant, show, expired])

  if (!show) return null
  const time = fmt(left)

  if (variant === 'bar') {
    return (
      <p role="timer" className={cn('mb-1.5 flex items-center justify-center gap-1 text-center text-sm font-extrabold', className)}>
        <Hourglass className="size-4 shrink-0" /> {expired ? 'La soirée se termine…' : <>Fin auto dans <span className="tabular-nums">{time}</span> sans jeu</>}
      </p>
    )
  }
  if (variant === 'card') {
    return (
      <motion.p
        role="timer"
        initial={{ scale: 0.6, opacity: 0 }}
        animate={reduce ? { scale: 1, opacity: 1 } : { scale: [1, 1.03, 1], opacity: 1 }}
        transition={reduce ? undefined : { scale: { repeat: Infinity, duration: 2 }, opacity: { duration: 0.2 } }}
        className={cn('flex items-center gap-1.5 rounded-chip border-2 border-ink bg-sun px-3 py-1 font-display text-sm leading-tight font-extrabold text-[#1f1b2e] shadow-sticker-sm', className)}
      >
        <Hourglass className="size-4 shrink-0" />
        <span>{expired ? 'La soirée se termine…' : <>La soirée se termine dans <span className="tabular-nums">{time}</span> si personne ne lance de jeu</>}</span>
      </motion.p>
    )
  }
  return (
    <motion.div
      role="timer"
      initial={{ scale: 0.7, rotate: -3, opacity: 0 }}
      animate={{ scale: 1, rotate: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 320, damping: 15 }}
      className={cn('sticker flex items-center gap-3 p-3 text-[#1f1b2e]', left <= 60_000 ? 'bg-tangerine' : 'bg-sun', className)}
    >
      <motion.span
        aria-hidden
        className="shrink-0"
        animate={reduce ? undefined : { rotate: [0, 0, 180, 180] }}
        transition={{ repeat: Infinity, duration: 3, times: [0, 0.4, 0.6, 1] }}
      >
        <Hourglass className="size-9" strokeWidth={2.5} />
      </motion.span>
      <div className="min-w-0">
        <p className="font-display text-lg leading-tight font-extrabold">
          {expired ? 'La soirée se termine…' : <>La soirée se termine dans <span className="tabular-nums">{time}</span> si personne ne lance de jeu</>}
        </p>
        <p className="text-sm font-bold opacity-80">{isHost ? 'Lance un jeu pour continuer la fête !' : 'Demande à l’hôte de lancer un jeu !'}</p>
      </div>
    </motion.div>
  )
}

/* -------------------------------------------------------------------------- */
/* Sélecteur de soirée (salon)                                                 */
/* -------------------------------------------------------------------------- */

/** Pastilles défilantes pour passer d'une de mes soirées à l'autre (≥ 2 soirées). */
export function SoireeSwitcher({ currentId }: { currentId: string }) {
  const meId = useSession((s) => s.profile?.id)
  const { soirees } = useActiveSoirees(meId)
  const { byId } = usePlayers()
  const navigate = useNavigate()
  const reduce = useReducedMotion()
  if (soirees.length < 2) return null
  return (
    <nav aria-label="Mes soirées" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex w-max gap-2 py-1.5">
        {soirees.map((s, i) => {
          const sel = s.id === currentId
          const host = byId[s.host_id]
          const slug = host?.slug ?? s.host?.slug ?? 'dede'
          const name = s.host_id === meId ? 'Chez toi' : `Chez ${host?.nickname ?? s.host?.nickname ?? '…'}`
          return (
            <motion.button
              key={s.id}
              type="button"
              aria-current={sel ? 'page' : undefined}
              aria-label={`${name}, code ${s.code}${s.current_match ? ', partie en cours' : ''}`}
              onClick={() => {
                if (sel) return
                fx.pop()
                navigate(`/soiree/${s.id}`, { replace: true })
              }}
              initial={{ scale: 0, rotate: -10 }}
              animate={{ scale: sel ? 1.05 : 0.95, rotate: sel ? -2 : 0 }}
              whileTap={sel ? undefined : { scale: 0.88 }}
              transition={{ type: 'spring', stiffness: 420, damping: 16, delay: reduce ? 0 : i * 0.04 }}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-full border-[3px] border-ink py-0.5 pr-3 pl-0.5 font-display text-sm font-extrabold',
                sel ? 'bg-sun text-[#1f1b2e] shadow-sticker-sm' : 'bg-surface text-text opacity-80',
              )}
            >
              <Avatar slug={slug} expression={host?.equipped ?? 'joie'} size={30} />
              <span className="flex flex-col items-start leading-none">
                <span className="max-w-[7rem] truncate">{name}</span>
                <span className="text-[0.65rem] tracking-widest opacity-70">{s.code}</span>
              </span>
              {s.current_match && (
                <span className="relative ml-0.5 flex size-2.5" title="Partie en cours">
                  {!reduce && <span className="absolute inline-flex size-full animate-ping rounded-full bg-tomato opacity-75" />}
                  <span className="relative inline-flex size-2.5 rounded-full border border-ink bg-tomato" />
                </span>
              )}
            </motion.button>
          )
        })}
      </div>
    </nav>
  )
}

/* -------------------------------------------------------------------------- */
/* Écran de fin de soirée (salon)                                              */
/* -------------------------------------------------------------------------- */

/** Message de fin (selon `end_reason`) puis retour au hub (auto après 5 s ou bouton). */
export function SoireeEndedOverlay({ reason, host, me, onDone }: { reason: SoireeEndReason | null; host: string; me: PlayerInfo | undefined; onDone: () => void }) {
  const reduce = useReducedMotion()
  const doneRef = useRef(onDone)
  useEffect(() => {
    doneRef.current = onDone
  })
  useEffect(() => {
    if (reason === 'idle') fx.whoosh()
    else fx.success()
    const t = window.setTimeout(() => doneRef.current(), 5000)
    return () => window.clearTimeout(t)
  }, [reason])
  const { title, text } = soireeEndCopy(reason, host)
  const expression = mood(me, reason === 'idle' ? 'sleepy' : reason === 'abandoned' ? 'sad' : 'happy')
  return createPortal(
    <motion.div
      className="fixed inset-0 z-[65] flex items-center justify-center bg-[#07050f]/60 p-5 backdrop-blur-[2px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="soiree-ended-title"
    >
      <motion.div
        className="sticker flex max-h-[90dvh] w-full max-w-sm flex-col items-center gap-3 overflow-y-auto overscroll-contain rounded-bubble bg-surface p-5 text-center text-text"
        initial={{ scale: 0.5, rotate: -8, y: 60 }}
        animate={{ scale: 1, rotate: 0, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 15 }}
      >
        <motion.div animate={reduce ? undefined : { rotate: [-5, 5, -5], y: [0, -6, 0] }} transition={{ repeat: Infinity, duration: 2.2 }}>
          {me ? <ChibiImage slug={me.slug} expression={expression} tenue={me.equippedTenue} size={130} /> : <span className="text-7xl">{reason === 'idle' ? '😴' : '🎉'}</span>}
        </motion.div>
        <h2 id="soiree-ended-title" className="text-3xl">
          {title}
        </h2>
        <p className="text-lg leading-snug">{text}</p>
        <Button size="lg" fullWidth icon={<Home className="size-6" />} onClick={() => doneRef.current()}>
          Retour au hub
        </Button>
      </motion.div>
    </motion.div>,
    document.body,
  )
}
