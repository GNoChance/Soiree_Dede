import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { saveLaunch, type LauncherPreset } from '@/features/soiree/rematch'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowLeft, Copy, DoorOpen, Flag, Play, Share2, UserPlus, Users, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ChibiImage } from '@/components/ui/ChibiImage'
import { Skeleton } from '@/components/ui/Skeleton'
import { burst } from '@/components/ui/confetti'
import { supabase } from '@/lib/supabase'
import { fx } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import { toast } from '@/store/toast'
import { useSession } from '@/store/session'
import { GAMES, getGame } from '@/games/registry'
import type { GameDefinition } from '@/games/types'
import type { GameId, GameOptions, NewUnlocks, SoireeEndReason } from '@/types/db'
import { leaveSoiree, refetchActiveSoirees, useActiveSoirees, useCurrentMatch, useSoiree, useViewingSoiree } from '@/features/soiree/hooks'
import { mood, playerOrPlaceholder, useEnsurePlayers, usePlayers } from '@/features/soiree/players'
import { GuestInviteButton } from '@/features/guest/GuestInvite'
import { useIsGuest } from '@/features/guest/api'
import { CheckableToken, ConfirmModal, LaunchCountdown, PlayerToken, UnlockReveal } from '@/features/soiree/components'
import { GameWheel } from '@/features/soiree/GameWheel'
import { closePronos, openPronos, usePronos } from '@/features/pronos/api'
import { PronosCard } from '@/features/pronos/PronosCard'
import { PronosPicker } from '@/features/pronos/PronosPicker'
import { PRONOS_TTL_MS } from '@/features/pronos/types'
import { invitePlayer, kickPlayer, spinWheel, useBannedPlayers, useWheelSpins, type WheelSpin } from '@/features/soiree/hostTools'
import { IdleCountdown, SoireeEndedOverlay, SoireeSwitcher } from '@/features/soiree/SoireeLive'
import { errorCode, toastError } from '@/features/soiree/errors'
import { SoireePodium, SoireeStandingsCard } from '@/features/stats/SoireeStandings'
import { SoireeRecap } from '@/features/recap/RecapViewer'
import { TutoButton } from '@/features/tutos/TutoButton'
import { readScenario } from '@/features/reveillon/api'
import { ReveillonLauncher } from '@/features/reveillon/ReveillonLauncher'
import { ReveillonStage } from '@/features/reveillon/ReveillonStage'
import { ChallengeLaunchCard } from '@/features/mises/ChallengeLaunchCard'

export function SoireePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  /** Revanche impossible en un clic : lanceur pré-rempli sur le jeu de la partie finie. */
  const preset = (useLocation().state as { preset?: LauncherPreset } | null)?.preset
  const meId = useSession((s) => s.profile?.id) ?? ''
  const { data, loading, notFound } = useSoiree(id)
  const { match, loaded: matchLoaded } = useCurrentMatch(id)
  const { soirees } = useActiveSoirees(meId || undefined)
  const { byId } = usePlayers()
  const [launching, setLaunching] = useState<{ id: string; game: string } | null>(null)
  const [endUnlocks, setEndUnlocks] = useState<NewUnlocks | null>(null)
  /** Podium de fin de soirée : vu (fin reçue en temps réel) / à montrer avant la suite (fin déclenchée par moi). */
  const [podiumSeen, setPodiumSeen] = useState(false)
  const [hostPodium, setHostPodium] = useState<{ next: NewUnlocks | null } | null>(null)
  /** Récap « Wrapped » juste après le podium (hôte : avant les déblocages ; autres : avant l'écran de fin). */
  const [hostRecap, setHostRecap] = useState<{ next: NewUnlocks | null } | null>(null)
  const [recapSeen, setRecapSeen] = useState(false)
  /** Soirée terminée pendant que je suis dans le salon (temps réel) : raison de fin. */
  const [ended, setEnded] = useState<{ reason: SoireeEndReason | null } | null>(null)
  const endingRef = useRef(false)
  /** Vrai dès que j'ai vu mon nom dans le salon : s'il disparaît ensuite, j'ai été exclu·e. */
  const wasMember = useRef(false)
  /** Roue des jeux : dernier tirage reçu (tous les téléphones) + demande de lancement (hôte). */
  const [wheel, setWheel] = useState<WheelSpin | null>(null)
  const lastSpinId = useRef(0)
  const [launchReq, setLaunchReq] = useState<{ id: string; n: number } | null>(null)
  const [kickTarget, setKickTarget] = useState<string | null>(null)
  const initialMatchId = useRef<string | null | undefined>(undefined)
  /** Hauteur de la barre de lancement fixée de l'hôte (0 = pas de barre). */
  const [barH, setBarH] = useState(0)
  // Pas de bandeau « une partie commence » pour la soirée affichée : bascule auto ci-dessous.
  useViewingSoiree(id, 'salon')

  const soiree = data?.soiree
  const isHost = soiree?.host_id === meId
  /** Soirée scénarisée (mode Réveillon) en cours : remplace le panneau de lancement. */
  const scenario = readScenario(soiree)
  const playerIds = useMemo(() => data?.playerIds ?? [], [data])
  useEnsurePlayers(playerIds)
  const isGuest = useIsGuest()
  /** Fin auto prévue (my_active_soirees) ; null pendant une partie. */
  useWheelSpins(id ?? '', (sp) => {
    if (sp.id <= lastSpinId.current) return
    lastSpinId.current = sp.id
    setWheel(sp)
  })
  const { bannedIds, refetchBans } = useBannedPlayers(id ?? '', Boolean(id) && isHost)
  const idleDeadline = soirees.find((s) => s.id === id)?.idle_deadline ?? null

  // La partie en cours de CETTE soirée change (démarrage, fin, annulation) : l'échéance
  // de fin auto change aussi -> on recharge mes soirées.
  useEffect(() => {
    if (matchLoaded) void refetchActiveSoirees()
  }, [matchLoaded, match?.id, match?.status])

  // Une partie démarre -> compte à rebours puis tout le monde y va. Une partie
  // déjà en cours depuis longtemps à mon arrivée -> simple bouton « Rejoindre ».
  useEffect(() => {
    if (!matchLoaded) return
    if (initialMatchId.current === undefined) initialMatchId.current = match?.id ?? null
    if (!match || match.status !== 'playing') return
    const old = Date.now() - new Date(match.created_at).getTime() > 20_000
    if (match.id === initialMatchId.current && old) return
    setLaunching((l) => l ?? { id: match.id, game: match.game_id })
  }, [matchLoaded, match])

  // Soirée terminée (message selon la raison, puis retour au hub) / plus membre -> hub.
  useEffect(() => {
    if (endingRef.current) return
    if (soiree?.status === 'ended') {
      setLaunching(null)
      setEnded((e) => e ?? { reason: soiree.end_reason ?? null })
    } else if (notFound) {
      toast.error(wasMember.current ? 'Tu as été retiré de la soirée.' : 'Tu ne fais pas (ou plus) partie de cette soirée.')
      navigate('/', { replace: true })
    } else if (data && meId && !playerIds.includes(meId) && !isHost) {
      if (wasMember.current) toast.error('Tu as été retiré de la soirée.')
      navigate('/', { replace: true })
    } else if (data && meId && playerIds.includes(meId)) {
      wasMember.current = true
    }
  }, [soiree?.status, soiree?.end_reason, notFound, data, playerIds, meId, isHost, navigate])

  // Accueil des nouveaux arrivants
  const prevCount = useRef(0)
  useEffect(() => {
    if (prevCount.current && playerIds.length > prevCount.current) {
      fx.success()
      burst({ x: 0.5, y: 0.35 }, 50)
    }
    prevCount.current = playerIds.length
  }, [playerIds.length])

  if (loading || !data || !soiree) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const launchGame = launching ? getGame(launching.game) : undefined
  const onHostEnded = (u: NewUnlocks) => {
    endingRef.current = true
    setEnded(null) // l'évènement temps réel a pu arriver avant la réponse
    setHostPodium({ next: Object.values(u).some((l) => l.length) ? u : null })
  }
  return (
    // Hôte : la barre « C'est parti ! » est fixée en bas ; la page réserve sa hauteur
    // mesurée pour que la fin (« Terminer la soirée ») reste atteignable.
    <div className="flex flex-col gap-5 pb-10" style={isHost && barH ? { paddingBottom: barH + 16 } : undefined}>
      <div className="flex items-center gap-2">
        {!isGuest && <button
          type="button"
          aria-label="Retour au hub"
          onClick={() => navigate('/')}
          className="flex size-11 items-center justify-center rounded-full border-[3px] border-ink bg-surface shadow-sticker-sm"
        >
          <ArrowLeft className="size-5" strokeWidth={3} />
        </button>}
        <h1 className="flex-1 text-3xl">Le salon</h1>
        <span className="flex items-center gap-1 font-display font-extrabold">
          <Users className="size-5" /> {playerIds.length}
        </span>
      </div>

      <SoireeSwitcher currentId={soiree.id} />

      {!match && !launching && <IdleCountdown deadline={idleDeadline} variant="salon" isHost={isHost} />}

      <CodeCard code={soiree.code} />

      {isHost && <GuestInviteButton soireeId={soiree.id} code={soiree.code} />}

      <PlayersGrid ids={playerIds} hostId={soiree.host_id} meId={meId} byId={byId} onKick={isHost ? setKickTarget : undefined} noLinks={isGuest} />

      {!scenario && <SoireeStandingsCard soireeId={soiree.id} />}

      {isHost && bannedIds.length > 0 && (
        <BannedList
          ids={bannedIds}
          byId={byId}
          onInvite={async (pid) => {
            const { error } = await invitePlayer(soiree.id, pid)
            if (error) toastError(error)
            else {
              fx.success()
              toast.success(`${playerOrPlaceholder(byId, pid).nickname} est ré-invité·e !`)
            }
            void refetchBans()
          }}
        />
      )}

      {match && match.status === 'playing' && !launching && (
        <div className="flex flex-col gap-1">
          <Button size="lg" fullWidth onClick={() => navigate(`/partie/${match.id}`)} icon={<Play className="size-6" />}>
            {isHost || match.player_ids.includes(meId) ? 'Rejoindre la partie en cours' : '👀 Regarder la partie'}
          </Button>
          {!isHost && !match.player_ids.includes(meId) && <p className="text-center text-sm font-bold text-muted">Tu joueras à la suivante</p>}
        </div>
      )}

      {!scenario && (
        <ChallengeLaunchCard soireeId={soiree.id} isHost={isHost} meId={meId} byId={byId} busy={Boolean(match) || Boolean(launching)} onStarted={(matchId, game) => setLaunching((l) => l ?? { id: matchId, game })} />
      )}

      {scenario ? (
        <ReveillonStage
          soireeId={soiree.id}
          scenario={scenario}
          isHost={isHost}
          meId={meId}
          playerIds={playerIds}
          byId={byId}
          busy={Boolean(match) || Boolean(launching)}
          onStarted={(matchId, game) => setLaunching((l) => l ?? { id: matchId, game })}
          onEnded={onHostEnded}
        />
      ) : isHost ? (
        <>
          <ReveillonLauncher soireeId={soiree.id} playerCount={playerIds.length} disabled={Boolean(match) || Boolean(launching)} />
          <HostPanel
            soireeId={soiree.id}
            playerIds={playerIds}
            byId={byId}
            meId={meId}
            busy={Boolean(match) || Boolean(launching)}
            launchReq={launchReq}
            preset={preset}
            onSpin={async (ids) => {
              const { spin, error } = await spinWheel(soiree.id, ids)
              if (error || !spin) return toastError(error)
              lastSpinId.current = Math.max(lastSpinId.current, spin.id)
              setWheel(spin)
            }}
            idleDeadline={match || launching ? null : idleDeadline}
            onBarHeight={setBarH}
            onStarted={(matchId, game) => setLaunching((l) => l ?? { id: matchId, game })}
          />
        </>
      ) : (
        <>
          {!launching && <PronosCard soireeId={soiree.id} meId={meId} byId={byId} />}
          <WaitingCard hostName={playerOrPlaceholder(byId, soiree.host_id).nickname} meSlug={byId[meId]?.slug} />
        </>
      )}

      <FooterActions
        soireeId={soiree.id}
        isHost={isHost}
        onEnded={onHostEnded}
        onLeft={() => {
          endingRef.current = true
          setEnded(null)
          navigate('/', { replace: true })
        }}
      />

      {launching && (
        <LaunchCountdown
          emoji={launchGame?.emoji ?? '🎲'}
          name={launchGame?.name ?? 'Partie'}
          color={launchGame?.color ?? '#FFB703'}
          onDone={() => navigate(`/partie/${launching.id}`)}
        />
      )}
      {wheel && !launching && !ended && (
        <GameWheel
          spin={wheel}
          isHost={isHost}
          busy={Boolean(match)}
          onClose={() => setWheel(null)}
          onLaunch={(gid) => {
            setWheel(null)
            setLaunchReq({ id: gid, n: Date.now() })
          }}
          onRespin={async () => {
            const { spin, error } = await spinWheel(soiree.id, wheel.game_ids)
            if (error || !spin) return toastError(error)
            lastSpinId.current = Math.max(lastSpinId.current, spin.id)
            setWheel(spin)
          }}
        />
      )}
      <KickModal
        target={kickTarget ? playerOrPlaceholder(byId, kickTarget) : null}
        onClose={() => setKickTarget(null)}
        onConfirm={async () => {
          if (!kickTarget) return
          const wasGuest = byId[kickTarget]?.isGuest
          const { error } = await kickPlayer(soiree.id, kickTarget)
          setKickTarget(null)
          if (error) {
            if (errorCode(error) === 'match_in_progress') toast.error('Impossible d’exclure quelqu’un pendant une partie.')
            else toastError(error)
          } else {
            fx.whoosh()
            if (wasGuest) toast.success('Invitations fermées : l’ancien QR code ne marche plus. Rouvre-les pour inviter quelqu’un d’autre.')
          }
          void refetchBans()
        }}
      />
      {endUnlocks && <UnlockReveal unlocks={endUnlocks} meId={meId} players={byId} onClose={() => navigate('/', { replace: true })} />}
      {hostPodium && (
        <SoireePodium
          soireeId={soiree.id}
          onDone={() => {
            setHostRecap({ next: hostPodium.next })
            setHostPodium(null)
          }}
        />
      )}
      {hostRecap && (
        <SoireeRecap
          soireeId={soiree.id}
          doneLabel="Retour à l’accueil"
          onDone={() => {
            const next = hostRecap.next
            setHostRecap(null)
            if (next) setEndUnlocks(next)
            else navigate('/', { replace: true })
          }}
        />
      )}
      {ended && !podiumSeen && !hostPodium && <SoireePodium soireeId={soiree.id} onDone={() => setPodiumSeen(true)} />}
      {ended && podiumSeen && !recapSeen && !hostRecap && <SoireeRecap soireeId={soiree.id} doneLabel="Retour à l’accueil" onDone={() => setRecapSeen(true)} />}
      {ended && podiumSeen && recapSeen && (
        <SoireeEndedOverlay
          reason={ended.reason}
          host={isHost ? 'toi' : playerOrPlaceholder(byId, soiree.host_id).nickname}
          me={byId[meId]}
          onDone={() => navigate('/', { replace: true })}
        />
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function CodeCard({ code }: { code: string }) {
  const reduce = useReducedMotion()
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      toast.success('Code copié !')
    } catch {
      toast(`Code : ${code}`)
    }
  }
  const share = async () => {
    const text = `Rejoins ma soirée sur Les Soirées de Dédé ! Code : ${code}`
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Soirée de Dédé', text, url: window.location.origin })
      } catch {
        /* partage annulé */
      }
    } else void copy()
  }
  return (
    <Card className="flex flex-col items-center gap-3 bg-sun text-[#1f1b2e]">
      <p className="font-display text-sm font-extrabold tracking-widest uppercase">Code de la soirée</p>
      <button type="button" onClick={() => void copy()} className="flex gap-2" aria-label={`Copier le code ${code}`}>
        {code.split('').map((ch, i) => (
          <motion.span
            key={i}
            initial={{ y: -40, rotate: -20, opacity: 0 }}
            animate={reduce ? { y: 0, rotate: 0, opacity: 1 } : { y: [0, -6, 0], rotate: i % 2 ? 4 : -4, opacity: 1 }}
            transition={reduce ? undefined : { y: { repeat: Infinity, duration: 1.6, delay: i * 0.15 }, rotate: { type: 'spring' }, opacity: { delay: i * 0.08 } }}
            className="sticker flex h-20 w-16 items-center justify-center bg-surface font-display text-5xl font-extrabold text-text"
          >
            {ch}
          </motion.span>
        ))}
      </button>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" icon={<Copy className="size-4" />} onClick={() => void copy()}>
          Copier
        </Button>
        <Button size="sm" variant="secondary" icon={<Share2 className="size-4" />} onClick={() => void share()}>
          Partager
        </Button>
      </div>
    </Card>
  )
}

function PlayersGrid({ ids, hostId, meId, byId, onKick, noLinks }: { ids: string[]; hostId: string; meId: string; byId: ReturnType<typeof usePlayers>['byId']; onKick?: (id: string) => void; noLinks?: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-y-5 pt-3">
      <AnimatePresence>
        {ids.map((id, i) => {
          const p = playerOrPlaceholder(byId, id)
          return (
            <motion.div
              key={id}
              layout
              initial={{ scale: 0, rotate: -30 }}
              animate={{ scale: 1, rotate: 0 }}
              exit={{ scale: 0, rotate: 30, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 14 }}
              className="relative flex justify-center"
            >
              {/* Invités (mode invité) : pas de page profil, ni pour eux ni pour les voir. */}
              {noLinks || p.isGuest ? (
                <PlayerToken player={p} host={id === hostId} bounce delay={i * 0.17} size={72} showTitle label={id === meId ? `${p.nickname} (toi)` : p.isGuest ? `${p.nickname} 👋` : p.nickname} />
              ) : (
                <Link to={`/profil/${id}`} aria-label={`Voir le profil de ${p.nickname}`} className="rounded-2xl">
                  <PlayerToken player={p} host={id === hostId} bounce delay={i * 0.17} size={72} showTitle label={id === meId ? `${p.nickname} (toi)` : p.nickname} />
                </Link>
              )}
              {onKick && id !== meId && (
                <button
                  type="button"
                  aria-label={`Exclure ${p.nickname}`}
                  onClick={() => {
                    fx.pop()
                    onKick(id)
                  }}
                  className="absolute top-0 right-2 flex size-7 items-center justify-center rounded-full border-2 border-ink bg-surface text-text opacity-80 shadow-sticker-sm"
                >
                  <X className="size-4" strokeWidth={3} />
                </button>
              )}
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}

function BannedList({ ids, byId, onInvite }: { ids: string[]; byId: ReturnType<typeof usePlayers>['byId']; onInvite: (id: string) => Promise<void> }) {
  const [busyId, setBusyId] = useState<string | null>(null)
  return (
    <Card className="flex flex-col gap-2">
      <p className="font-display text-lg font-extrabold">Retirés de la soirée</p>
      {ids.map((pid) => {
        const p = playerOrPlaceholder(byId, pid)
        return (
          <div key={pid} className="flex items-center gap-2">
            <ChibiImage slug={p.slug} expression="sad" tenue={p.equippedTenue} size={40} />
            <span className="min-w-0 flex-1 truncate font-display font-extrabold">{p.nickname}</span>
            <Button
              size="sm"
              variant="secondary"
              loading={busyId === pid}
              icon={<UserPlus className="size-4" />}
              onClick={async () => {
                setBusyId(pid)
                await onInvite(pid)
                setBusyId(null)
              }}
            >
              Ré-inviter
            </Button>
          </div>
        )
      })}
    </Card>
  )
}

function KickModal({ target, onClose, onConfirm }: { target: ReturnType<typeof playerOrPlaceholder> | null; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  // on garde le dernier joueur affiché pendant l'animation de fermeture
  const last = useRef(target)
  if (target) last.current = target
  const p = target ?? last.current
  return (
    <ConfirmModal
      open={Boolean(target)}
      onClose={onClose}
      loading={busy}
      danger
      title={`Exclure ${p?.nickname ?? ''} ?`}
      confirmLabel="Exclure"
      onConfirm={async () => {
        setBusy(true)
        await onConfirm()
        setBusy(false)
      }}
    >
      <div className="flex items-center gap-3">
        {p && <ChibiImage slug={p.slug} expression="sad" tenue={p.equippedTenue} size={72} />}
        <p>{p?.nickname} sera retiré·e du salon et ne pourra revenir que si tu le ou la ré-invites.</p>
      </div>
    </ConfirmModal>
  )
}

function WaitingCard({ hostName, meSlug }: { hostName: string; meSlug?: string }) {
  const reduce = useReducedMotion()
  return (
    <Card className="flex items-center gap-3">
      <motion.div animate={reduce ? undefined : { rotate: [-5, 5, -5] }} transition={{ repeat: Infinity, duration: 2 }}>
        <ChibiImage slug={meSlug ?? 'dede'} expression="reflexion" size={80} />
      </motion.div>
      <div>
        <p className="font-display text-xl leading-tight font-extrabold">En attente de {hostName}…</p>
        <p className="text-muted">L’hôte choisit le prochain jeu. Ton téléphone basculera tout seul !</p>
      </div>
    </Card>
  )
}

/* -------------------------------------------------------------------------- */
/* Panneau de l'hôte : jeu, options, joueurs, lancement                         */
/* -------------------------------------------------------------------------- */

const LAST_GAME_KEY = 'dede:last-game'

function HostPanel({ soireeId, playerIds, byId, meId, busy, launchReq, preset, onSpin, idleDeadline, onBarHeight, onStarted }: { preset?: LauncherPreset; launchReq: { id: string; n: number } | null; onSpin: (gameIds: string[]) => Promise<void>; soireeId: string; playerIds: string[]; byId: ReturnType<typeof usePlayers>['byId']; meId: string; busy: boolean; idleDeadline: string | null; onBarHeight: (h: number) => void; onStarted: (matchId: string, game: string) => void }) {
  // Hauteur réelle de la barre fixée (police agrandie, compte à rebours, message d'erreur…).
  const barRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = barRef.current
    if (!el) return
    const report = () => onBarHeight(Math.ceil(el.getBoundingClientRect().height))
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => {
      ro.disconnect()
      onBarHeight(0)
    }
  }, [onBarHeight])
  const [gameId, setGameId] = useState<string>(() => {
    if (preset && getGame(preset.gameId)) return preset.gameId
    try {
      return getGame(localStorage.getItem(LAST_GAME_KEY) ?? '')?.id ?? GAMES[0].id
    } catch {
      return GAMES[0].id
    }
  })
  const game = getGame(gameId) as GameDefinition
  const [optionsByGame, setOptionsByGame] = useState<Record<string, Record<string, unknown>>>(() => (preset?.options && getGame(preset.gameId) ? { [preset.gameId]: preset.options } : {}))
  const options = optionsByGame[gameId] ?? game.defaultOptions ?? {}
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set())
  const [starting, setStarting] = useState(false)
  // Étape Pronostics : ouverte = une manche existe sur le serveur (même après un rechargement de la page).
  const [opening, setOpening] = useState(false)
  const pronosOpenRef = useRef(false)
  const { state: pronosState, pick: pickProno, refetch: refetchPronos } = usePronos(soireeId)
  const roundOpen = Boolean(pronosState.round) && Date.now() - new Date(pronosState.round?.opened_at ?? 0).getTime() <= PRONOS_TTL_MS
  useEffect(() => {
    pronosOpenRef.current = roundOpen
  })

  const playing = playerIds.filter((id) => !excluded.has(id))
  const tooFew = playing.length < game.minPlayers
  const tooMany = playing.length > game.maxPlayers

  const toggle = useCallback((id: string) => {
    setExcluded((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }, [])

  const start = async () => {
    setStarting(true)
    try {
      const prepared = game.prepareStart ? await game.prepareStart(options, { playerIds: playing }) : { ...options }
      const p_options = excluded.size ? { ...prepared, player_ids: playing } : prepared
      const { data, error } = await supabase.rpc('start_match', {
        p_soiree_id: soireeId,
        p_game_id: game.id as GameId,
        p_options: p_options as unknown as GameOptions,
      })
      if (error) {
        toastError(error)
        // Échéance de fin auto dépassée : le serveur annule sa clôture avec l'erreur ;
        // on la redemande (my_active_soirees) -> évènement 'ended' -> écran de fin.
        if (errorCode(error) === 'soiree_ended') void refetchActiveSoirees()
        return
      }
      try {
        localStorage.setItem(LAST_GAME_KEY, game.id)
      } catch {
        /* ignore */
      }
      pronosOpenRef.current = false
      saveLaunch(data as string, { gameId: game.id, options, playerIds: playing })
      onStarted(data as string, game.id)
    } catch (e) {
      toastError(e)
    } finally {
      setStarting(false)
    }
  }

  // « C'est parti ! » : ouvre les pronostics chez tous les joueurs (le lancement vient après).
  // Avec moins de 2 joueurs, pas de pronostic possible : on lance directement.
  const beginPronos = async () => {
    if (playing.length < 2) return void start()
    setOpening(true)
    const { error } = await openPronos(soireeId, game.id, playing)
    setOpening(false)
    if (error) return toastError(error)
    await refetchPronos()
  }
  const cancelPronos = async () => {
    pronosOpenRef.current = false
    await closePronos(soireeId)
    await refetchPronos()
  }
  // Le jeu ou les joueurs changent pendant l'étape : les paris repartent de zéro (nouvelle manche).
  const playingKey = playing.join(',')
  useEffect(() => {
    if (!pronosOpenRef.current) return
    void openPronos(soireeId, gameId, playing).then(({ error }) => {
      if (error) {
        toastError(error)
        pronosOpenRef.current = false
        // la manche précédente ne doit pas rester ouverte avec des paris sur des joueurs qui ne jouent plus
        void closePronos(soireeId).then(() => refetchPronos())
      } else void refetchPronos()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seulement quand le jeu ou la liste des joueurs change
  }, [gameId, playingKey])
  // L'hôte quitte l'écran sans lancer : on referme la manche (sinon elle expire après 10 min).
  useEffect(
    () => () => {
      if (pronosOpenRef.current) void closePronos(soireeId)
    },
    [soireeId],
  )

  // « Lancer ce jeu » depuis la roue : on sélectionne le jeu puis on ouvre les pronostics au rendu suivant.
  const [pendingStart, setPendingStart] = useState<string | null>(null)
  const beginRef = useRef(beginPronos)
  useEffect(() => {
    beginRef.current = beginPronos
  })
  useEffect(() => {
    if (!launchReq) return
    setGameId(launchReq.id)
    setPendingStart(launchReq.id)
  }, [launchReq])
  useEffect(() => {
    if (!pendingStart || gameId !== pendingStart) return
    setPendingStart(null)
    if (busy || tooFew || tooMany) {
      toast.error(tooFew ? `Il faut au moins ${game.minPlayers} joueurs pour ${game.name}.` : tooMany ? `${game.maxPlayers} joueurs maximum.` : 'Une partie est déjà en cours !')
      return
    }
    void beginRef.current()
  }, [pendingStart, gameId, busy, tooFew, tooMany, game])

  const [spinning, setSpinning] = useState(false)
  const spin = async () => {
    const ids = GAMES.filter((g) => playing.length >= g.minPlayers && playing.length <= g.maxPlayers).map((g) => g.id)
    if (ids.length < 2) {
      toast.error('Pas assez de jeux pour ce nombre de joueurs.')
      return
    }
    fx.whoosh()
    setSpinning(true)
    try {
      await onSpin(ids)
    } finally {
      setSpinning(false)
    }
  }

  const Options = game.Options
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-2xl">On joue à quoi ?</h2>
        <Button size="sm" variant="secondary" loading={spinning} disabled={busy} onClick={() => void spin()}>
          🎡 Roue
        </Button>
      </div>
      {/* Carrousel horizontal compact : la page reste courte même avec beaucoup de jeux. */}
      <div className="-mx-4 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex w-max gap-2.5">
          {GAMES.map((g) => {
            const sel = g.id === gameId
            return (
              <motion.button
                key={g.id}
                type="button"
                onClick={() => {
                  fx.pop()
                  setGameId(g.id)
                }}
                animate={{ scale: sel ? 1.06 : 0.95, rotate: sel ? -2 : 0 }}
                whileTap={{ scale: 0.9 }}
                transition={{ type: 'spring', stiffness: 420, damping: 15 }}
                aria-pressed={sel}
                className={cn('sticker flex w-24 shrink-0 flex-col items-center gap-0.5 p-2 text-center text-[#1f1b2e]', !sel && 'opacity-60 saturate-50')}
                style={{ backgroundColor: g.color }}
              >
                <span className="text-3xl leading-none">{g.emoji}</span>
                <span className="font-display text-[0.8rem] leading-tight font-extrabold">{g.name}</span>
                <span className="text-[0.65rem] font-bold">
                  {g.minPlayers}–{g.maxPlayers} j.
                </span>
              </motion.button>
            )
          })}
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={game.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="flex flex-col gap-4">
          <p className="text-sm leading-snug">{game.rules ?? game.tagline}</p>
          {/* Vidéo d'explication (seulement si elle existe : src/data/tutos.ts). */}
          <TutoButton gameId={game.id} gameName={game.name} className="self-start" />
          {Options && (
            <Card>
              <Options options={options} onChange={(o) => setOptionsByGame((m) => ({ ...m, [game.id]: o }))} playerCount={playing.length} playingIds={playing} />
            </Card>
          )}
        </motion.div>
      </AnimatePresence>

      {playerIds.length > 1 && (
        <Card className="flex flex-col gap-2">
          <p className="font-display text-lg font-extrabold">Qui joue ? ({playing.length})</p>
          <div className="grid grid-cols-4 gap-1">
            {playerIds.map((id) => (
              <CheckableToken key={id} player={playerOrPlaceholder(byId, id)} checked={!excluded.has(id)} onToggle={() => toggle(id)} size={52} />
            ))}
          </div>
          {excluded.has(meId) && <p className="text-sm text-muted">Tu animes sans jouer (tu gardes les boutons de l’hôte).</p>}
        </Card>
      )}

      {roundOpen && pronosState.round && (
        <Card className="flex flex-col gap-3">
          <h2 className="text-2xl">🔮 Qui va gagner ?</h2>
          <PronosPicker playerIds={pronosState.round.player_ids} byId={byId} meId={meId} myPick={pronosState.my_pick} onPick={(id) => void pickProno(id)} />
          <p className="text-sm leading-snug text-muted">Si tu changes de jeu ou de joueurs, les pronostics repartent de zéro.</p>
        </Card>
      )}

      {(tooFew || tooMany) && (
        <p className="text-center font-bold text-tomato">
          {tooFew ? `Il faut au moins ${game.minPlayers} joueurs pour ${game.name}.` : `${game.maxPlayers} joueurs maximum.`}
        </p>
      )}
      {/* Barre de lancement FIXÉE à l'écran (portail vers <body>) : toujours visible,
          quels que soient la longueur de la page, le défilement ou le zoom. Sa hauteur
          est réservée en bas de la page (onBarHeight), après « Terminer la soirée ». */}
      {createPortal(
        <div ref={barRef} className="pb-safe fixed inset-x-0 bottom-0 z-40 bg-gradient-to-t from-paper via-paper/95 to-transparent px-4 pt-6 pb-3">
          <div className="mx-auto max-w-md">
            <IdleCountdown deadline={idleDeadline} variant="bar" />
            <motion.div animate={!tooFew && !tooMany && !busy ? { scale: [1, 1.04, 1] } : undefined} transition={{ repeat: Infinity, duration: 1.3 }}>
              {roundOpen ? (
                <Button size="lg" fullWidth loading={starting} disabled={tooFew || tooMany || busy} icon={<Play className="size-7 fill-current" />} onClick={() => void start()}>
                  Lancer la partie <span className="text-base opacity-80">{game.emoji}</span>
                </Button>
              ) : (
                <Button size="lg" fullWidth loading={starting || opening} disabled={tooFew || tooMany || busy} icon={<Play className="size-7 fill-current" />} onClick={() => void beginPronos()}>
                  C’est parti ! <span className="text-base opacity-80">{game.emoji}</span>
                </Button>
              )}
            </motion.div>
            {roundOpen && (
              <div className="mt-1 flex items-center justify-between gap-2 text-sm font-bold">
                <span>
                  🔮 {pronosState.round?.bets ?? 0}/{playerIds.length} ont parié
                </span>
                <button type="button" className="min-h-11 px-2 underline" onClick={() => void cancelPronos()}>
                  Annuler les pronostics
                </button>
              </div>
            )}
            {!roundOpen && !tooFew && !tooMany && !busy && (
              <div className="mt-1 text-center">
                <button type="button" className="min-h-11 px-3 text-sm font-bold text-muted underline" disabled={starting || opening} onClick={() => void start()}>
                  Lancer sans pronostics
                </button>
              </div>
            )}
            {(tooFew || tooMany) && (
              <p className="mt-1 text-center text-sm font-bold text-tomato">
                {tooFew ? `Il faut au moins ${game.minPlayers} joueurs pour ${game.name}.` : `${game.maxPlayers} joueurs maximum.`}
              </p>
            )}
            {busy && <p className="mt-1 text-center text-sm text-muted">Une partie est en cours.</p>}
          </div>
        </div>,
        document.body,
      )}
    </section>
  )
}

/* -------------------------------------------------------------------------- */

function FooterActions({ soireeId, isHost, onEnded, onLeft }: { soireeId: string; isHost: boolean; onEnded: (u: NewUnlocks) => void; onLeft: () => void }) {
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const meSlug = useSession((s) => s.profile?.slug)
  const { byId } = usePlayers()
  const me = Object.values(byId).find((p) => p.slug === meSlug)

  const run = async () => {
    setBusy(true)
    if (isHost) {
      const { data, error } = await supabase.rpc('end_soiree', { p_soiree_id: soireeId })
      setBusy(false)
      setConfirm(false)
      if (error) return toastError(error)
      fx.fanfare()
      onEnded((data as { new_unlocks?: NewUnlocks } | null)?.new_unlocks ?? {})
    } else {
      // Multi-soirées : on quitte CETTE soirée (leave_soiree(p_soiree_id)).
      const { error } = await leaveSoiree(soireeId)
      setBusy(false)
      setConfirm(false)
      if (error) return toastError(error)
      fx.whoosh()
      onLeft()
    }
  }

  return (
    <>
      <Button variant={isHost ? 'danger' : 'secondary'} fullWidth icon={isHost ? <Flag className="size-5" /> : <DoorOpen className="size-5" />} onClick={() => setConfirm(true)}>
        {isHost ? 'Terminer la soirée' : 'Quitter la soirée'}
      </Button>
      <ConfirmModal
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => void run()}
        loading={busy}
        danger={isHost}
        title={isHost ? 'Terminer la soirée ?' : 'Quitter la soirée ?'}
        confirmLabel={isHost ? 'Terminer' : 'Quitter'}
      >
        <div className="flex items-center gap-3">
          {me && <ChibiImage slug={me.slug} expression={mood(me, isHost ? 'sleepy' : 'sad')} size={72} />}
          <p>{isHost ? 'La soirée sera terminée pour tout le monde (une partie en cours sera annulée).' : 'Tu pourras revenir avec le code de la soirée.'}</p>
        </div>
      </ConfirmModal>
    </>
  )
}
