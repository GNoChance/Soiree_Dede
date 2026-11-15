import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useParams } from 'react-router'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowLeft, Copy, DoorOpen, Flag, Play, Share2, Users } from 'lucide-react'
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
import type { GameId, GameOptions, NewUnlocks } from '@/types/db'
import { useCurrentMatch, useSoiree } from '@/features/soiree/hooks'
import { mood, playerOrPlaceholder, usePlayers } from '@/features/soiree/players'
import { CheckableToken, ConfirmModal, LaunchCountdown, PlayerToken, UnlockReveal } from '@/features/soiree/components'
import { toastError } from '@/features/soiree/errors'

export function SoireePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const meId = useSession((s) => s.profile?.id) ?? ''
  const { data, loading, notFound } = useSoiree(id)
  const { match, loaded: matchLoaded } = useCurrentMatch(id)
  const { byId } = usePlayers()
  const [launching, setLaunching] = useState<{ id: string; game: string } | null>(null)
  const [endUnlocks, setEndUnlocks] = useState<NewUnlocks | null>(null)
  const endingRef = useRef(false)
  const initialMatchId = useRef<string | null | undefined>(undefined)

  const soiree = data?.soiree
  const isHost = soiree?.host_id === meId
  const playerIds = useMemo(() => data?.playerIds ?? [], [data])

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

  // Soirée terminée / plus membre -> retour au hub.
  useEffect(() => {
    if (endingRef.current) return
    if (soiree?.status === 'ended') {
      toast('La soirée est terminée. Merci d’être venu·e ! 🎉')
      navigate('/', { replace: true })
    } else if (notFound) {
      toast.error('Tu ne fais pas (ou plus) partie de cette soirée.')
      navigate('/', { replace: true })
    } else if (data && meId && !playerIds.includes(meId) && !isHost) {
      navigate('/', { replace: true })
    }
  }, [soiree?.status, notFound, data, playerIds, meId, isHost, navigate])

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
  return (
    <div className="flex flex-col gap-5 pb-10">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Retour au hub"
          onClick={() => navigate('/')}
          className="flex size-11 items-center justify-center rounded-full border-[3px] border-ink bg-surface shadow-sticker-sm"
        >
          <ArrowLeft className="size-5" strokeWidth={3} />
        </button>
        <h1 className="flex-1 text-3xl">Le salon</h1>
        <span className="flex items-center gap-1 font-display font-extrabold">
          <Users className="size-5" /> {playerIds.length}
        </span>
      </div>

      <CodeCard code={soiree.code} />

      <PlayersGrid ids={playerIds} hostId={soiree.host_id} meId={meId} byId={byId} />

      {match && match.status === 'playing' && !launching && (
        <Button size="lg" fullWidth onClick={() => navigate(`/partie/${match.id}`)} icon={<Play className="size-6" />}>
          Rejoindre la partie en cours
        </Button>
      )}

      {isHost ? (
        <HostPanel
          soireeId={soiree.id}
          playerIds={playerIds}
          byId={byId}
          meId={meId}
          busy={Boolean(match) || Boolean(launching)}
          onStarted={(matchId, game) => setLaunching((l) => l ?? { id: matchId, game })}
        />
      ) : (
        <WaitingCard hostName={playerOrPlaceholder(byId, soiree.host_id).nickname} meSlug={byId[meId]?.slug} />
      )}

      <FooterActions
        soireeId={soiree.id}
        isHost={isHost}
        onEnded={(u) => {
          endingRef.current = true
          if (Object.values(u).some((l) => l.length)) setEndUnlocks(u)
          else navigate('/', { replace: true })
        }}
        onLeft={() => {
          endingRef.current = true
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
      {endUnlocks && <UnlockReveal unlocks={endUnlocks} meId={meId} players={byId} onClose={() => navigate('/', { replace: true })} />}
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

function PlayersGrid({ ids, hostId, meId, byId }: { ids: string[]; hostId: string; meId: string; byId: ReturnType<typeof usePlayers>['byId'] }) {
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
              className="flex justify-center"
            >
              <PlayerToken player={p} host={id === hostId} bounce delay={i * 0.17} size={72} label={id === meId ? `${p.nickname} (toi)` : p.nickname} />
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
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

function HostPanel({ soireeId, playerIds, byId, meId, busy, onStarted }: { soireeId: string; playerIds: string[]; byId: ReturnType<typeof usePlayers>['byId']; meId: string; busy: boolean; onStarted: (matchId: string, game: string) => void }) {
  const [gameId, setGameId] = useState<string>(() => {
    try {
      return getGame(localStorage.getItem(LAST_GAME_KEY) ?? '')?.id ?? GAMES[0].id
    } catch {
      return GAMES[0].id
    }
  })
  const game = getGame(gameId) as GameDefinition
  const [optionsByGame, setOptionsByGame] = useState<Record<string, Record<string, unknown>>>({})
  const options = optionsByGame[gameId] ?? game.defaultOptions ?? {}
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set())
  const [starting, setStarting] = useState(false)

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
        return
      }
      try {
        localStorage.setItem(LAST_GAME_KEY, game.id)
      } catch {
        /* ignore */
      }
      onStarted(data as string, game.id)
    } catch (e) {
      toastError(e)
    } finally {
      setStarting(false)
    }
  }

  const Options = game.Options
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-2xl">On joue à quoi ?</h2>
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
          {Options && (
            <Card>
              <Options options={options} onChange={(o) => setOptionsByGame((m) => ({ ...m, [game.id]: o }))} playerCount={playing.length} />
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

      {(tooFew || tooMany) && (
        <p className="text-center font-bold text-tomato">
          {tooFew ? `Il faut au moins ${game.minPlayers} joueurs pour ${game.name}.` : `${game.maxPlayers} joueurs maximum.`}
        </p>
      )}
      {/* Espace réservé pour ne pas masquer la fin de la page sous la barre fixe. */}
      <div aria-hidden className="h-28" />
      {/* Barre de lancement FIXÉE à l'écran (portail vers <body>) : toujours visible,
          quels que soient la longueur de la page, le défilement ou le zoom. */}
      {createPortal(
        <div className="pb-safe fixed inset-x-0 bottom-0 z-40 bg-gradient-to-t from-paper via-paper/95 to-transparent px-4 pt-6 pb-3">
          <div className="mx-auto max-w-md">
            <motion.div animate={!tooFew && !tooMany && !busy ? { scale: [1, 1.04, 1] } : undefined} transition={{ repeat: Infinity, duration: 1.3 }}>
              <Button size="lg" fullWidth loading={starting} disabled={tooFew || tooMany || busy} icon={<Play className="size-7 fill-current" />} onClick={() => void start()}>
                C’est parti ! <span className="text-base opacity-80">{game.emoji}</span>
              </Button>
            </motion.div>
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
      const { error } = await supabase.rpc('leave_soiree')
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
