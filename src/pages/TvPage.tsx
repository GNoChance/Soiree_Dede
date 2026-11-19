import { Suspense, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { motion, useReducedMotion } from 'framer-motion'
import { Maximize, Minimize, X } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { useSession } from '@/store/session'
import { getGame } from '@/games/registry'
import type { BaseGameState } from '@/games/types'
import { useCurrentMatch, useGameAction, useMatch, useSoiree, useViewingSoiree } from '@/features/soiree/hooks'
import { mood, playerOrPlaceholder, usePlayers } from '@/features/soiree/players'
import { TvContext, TV_VIEWER_ID, readOnlyAct } from '@/features/tv/tv'
import { isDuelState } from '@/features/duel/tv'
import { useWakeLock } from '@/lib/wakeLock'
import { cn } from '@/lib/cn'

/** Plein écran du navigateur (si disponible). */
function useFullscreen() {
  const [on, setOn] = useState(() => typeof document !== 'undefined' && !!document.fullscreenElement)
  useEffect(() => {
    const sync = () => setOn(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])
  const supported = typeof document !== 'undefined' && !!document.documentElement.requestFullscreen
  const toggle = () => {
    try {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
      else
        void document.documentElement
          .requestFullscreen({ navigationUI: 'hide' })
          // L'appli installée est verrouillée en portrait (manifest) : en plein écran, on autorise le paysage.
          .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('any'))
          .catch(() => {})
    } catch {
      /* refusé : tant pis */
    }
  }
  return { on, supported, toggle }
}

/**
 * Mode télé (`/soiree/:id/tele`) : vue spectateur plein écran qui suit la
 * partie en cours de la soirée (Realtime, comme MatchPage). Pour un jeu en
 * duel ou un jeu qui déclare `tv: true`, le `Play` du jeu est rendu sous TvContext
 * (duel : DuelTv ; Nom de Code : vue grand écran ; lecture seule : id fictif, pas de secret, seuls les ticks sont envoyés). À la fin
 * de la session : le résumé (sacre du champion), jusqu'à la partie suivante.
 */
export function TvPage() {
  const { id: soireeId } = useParams()
  const navigate = useNavigate()
  const reduce = useReducedMotion()
  const me = useSession((s) => s.profile)
  const { data: soireeData, notFound } = useSoiree(soireeId)
  const { match: current, loaded } = useCurrentMatch(soireeId)
  const { byId } = usePlayers()
  const fs = useFullscreen()

  // On garde la dernière partie affichée quand elle se termine (résumé), jusqu'à la suivante.
  const [shownId, setShownId] = useState<string | null>(null)
  if (current && current.id !== shownId) setShownId(current.id)

  const { match, applyState } = useMatch(shownId ?? undefined)
  const { act } = useGameAction(shownId ?? undefined, applyState)
  const tvAct = useMemo(() => readOnlyAct(act), [act])

  useViewingSoiree(soireeId, 'match')
  useWakeLock(true)

  const isHost = Boolean(me && soireeData && soireeData.soiree.host_id === me.id)
  const soireeEnded = soireeData?.soiree.status === 'ended'
  const game = match ? getGame(match.game_id) : undefined
  const state = match && match.id === shownId ? (match.state as unknown as BaseGameState) : undefined
  const tvGame = !!state && (isDuelState(state) || Boolean(game?.tv))
  const finished = match?.status === 'finished'
  const aborted = Boolean(state?.aborted || state?.phase === 'aborted')
  const roundLabel = state && !finished && game?.roundLabel ? game.roundLabel(state) : null

  const exit = () => {
    if (fs.on) fs.toggle()
    if (soireeEnded || notFound || !soireeId) navigate('/', { replace: true })
    else if (current && current.status === 'playing') navigate(`/partie/${current.id}`, { replace: true })
    else navigate(`/soiree/${soireeId}`, { replace: true })
  }

  const players = (soireeData?.playerIds ?? []).map((id) => playerOrPlaceholder(byId, id))

  /** Écran d'attente : les têtes de la soirée qui dansent. */
  const waiting = (title: string, text: string, emoji = '📺') => (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <motion.span
        className="text-7xl"
        animate={reduce ? undefined : { rotate: [-6, 6, -6], scale: [1, 1.08, 1] }}
        transition={{ repeat: Infinity, duration: 2 }}
      >
        {emoji}
      </motion.span>
      <h1 className="text-4xl">{title}</h1>
      <p className="max-w-xl text-lg font-bold text-muted">{text}</p>
      {players.length > 0 && (
        <div className="flex flex-wrap justify-center gap-3 pt-2">
          {players.map((p, i) => (
            <motion.div
              key={p.id}
              animate={reduce ? undefined : { y: [0, -10, 0] }}
              transition={{ repeat: Infinity, duration: 1.2, delay: i * 0.15 }}
              className="flex flex-col items-center gap-1"
            >
              <Avatar slug={p.slug} expression={i % 3 === 0 ? mood(p, 'happy') : i % 3 === 1 ? mood(p, 'sly') : p.equipped} tenue={p.equippedTenue} size={72} />
              <span className="font-display text-sm font-extrabold">{p.nickname}</span>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )

  let body: React.ReactNode
  if (notFound) body = waiting('Soirée introuvable', 'Ce lien ne correspond à aucune soirée.', '🤷')
  else if (soireeEnded && !state) body = waiting('La soirée est terminée', 'Merci d’avoir regardé ! À la prochaine soirée.', '🌙')
  else if (!shownId) body = loaded ? waiting('En attente du prochain jeu…', 'Le mode télé s’allume tout seul dès que l’hôte lance un jeu compatible : un duel (Morpion, 4 à la suite, Bataille navale…) ou Nom de Code.') : <TvSkeleton />
  else if (!state || !match) body = <TvSkeleton />
  else if (!tvGame)
    body = waiting(
      `En ce moment : ${game?.name ?? 'un autre jeu'}`,
      'Le mode télé suit les duels et Nom de Code. Il reprendra automatiquement au prochain jeu compatible.',
      game?.emoji ?? '🎲',
    )
  else if (finished && aborted) body = waiting('Partie annulée', 'L’hôte a annulé la session. On attend la suivante…', '🚫')
  else if (finished) {
    const Summary = game?.Summary
    body = (
      <div className="h-full overflow-y-auto px-3 py-4">
        <div className={cn('mx-auto flex flex-col gap-3', game?.tv ? 'max-w-6xl' : 'max-w-2xl')}>
          {Summary ? (
            <Suspense fallback={<TvSkeleton />}>
              <TvContext.Provider value>
                <Summary state={state} meId={TV_VIEWER_ID} players={byId} />
              </TvContext.Provider>
            </Suspense>
          ) : null}
          <p className="text-center text-sm font-bold text-muted">Le mode télé reprendra automatiquement au prochain jeu compatible 📺</p>
        </div>
      </div>
    )
  } else {
    const Play = game?.Play
    body =
      Play && soireeId ? (
        <TvContext.Provider value>
          <Suspense fallback={<TvSkeleton />}>
            <Play
              matchId={match.id}
              soireeId={soireeId}
              state={state}
              secret={null}
              meId={TV_VIEWER_ID}
              isHost={isHost}
              players={byId}
              act={tvAct}
              pending={false}
            />
          </Suspense>
        </TvContext.Provider>
      ) : (
        waiting('Jeu indisponible', 'Ce jeu n’est pas disponible dans cette version de l’app.', '🤷')
      )
  }

  return (
    <div className="pt-safe pb-safe pl-safe pr-safe fixed inset-0 z-30 flex flex-col bg-paper">
      <header className="flex shrink-0 items-center gap-2 border-b-[3px] border-ink bg-surface px-3 py-1.5">
        <span className="text-2xl">{state && tvGame ? (game?.emoji ?? '📺') : '📺'}</span>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate font-display text-xl font-extrabold">{state && tvGame ? (game?.name ?? 'Mode télé') : 'Mode télé'}</span>
          {roundLabel && tvGame && (
            <Badge tone="sky" tilted={false}>
              {roundLabel}
            </Badge>
          )}
        </div>
        {state && tvGame && !finished && (
          <motion.span
            className="flex shrink-0 items-center gap-1 rounded-full border-2 border-ink bg-tomato px-2 text-xs font-extrabold text-white uppercase"
            animate={reduce ? undefined : { opacity: [1, 0.55, 1] }}
            transition={{ repeat: Infinity, duration: 1.4 }}
          >
            ● en direct
          </motion.span>
        )}
        {fs.supported && (
          <button
            type="button"
            onClick={fs.toggle}
            aria-label={fs.on ? 'Quitter le plein écran' : 'Plein écran'}
            className="flex size-10 shrink-0 items-center justify-center rounded-full border-[3px] border-ink bg-surface shadow-sticker-sm"
          >
            {fs.on ? <Minimize className="size-5" strokeWidth={3} /> : <Maximize className="size-5" strokeWidth={3} />}
          </button>
        )}
        <button
          type="button"
          onClick={exit}
          aria-label="Quitter le mode télé"
          className="flex size-10 shrink-0 items-center justify-center rounded-full border-[3px] border-ink bg-surface shadow-sticker-sm"
        >
          <X className="size-5" strokeWidth={3} />
        </button>
      </header>
      <main className={cn('relative min-h-0 flex-1')}>{body}</main>
      {!fs.on && !shownId && loaded && !notFound && !soireeEnded && (
        <div className="shrink-0 p-3 text-center">
          <Button variant="ghost" size="sm" onClick={exit}>
            Retour au salon
          </Button>
        </div>
      )}
    </div>
  )
}

function TvSkeleton() {
  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <Skeleton className="h-40 w-full" />
      <Skeleton className="w-full flex-1" />
    </div>
  )
}
