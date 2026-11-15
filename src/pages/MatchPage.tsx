import { Suspense, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { motion } from 'framer-motion'
import { Ban, Home, X } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ChibiImage } from '@/components/ui/ChibiImage'
import { Skeleton } from '@/components/ui/Skeleton'
import { useSession } from '@/store/session'
import { getGame } from '@/games/registry'
import type { BaseGameState } from '@/games/types'
import { soireeEndCopy, useCurrentMatch, useGameAction, useMatch, useSoiree, useViewingSoiree } from '@/features/soiree/hooks'
import { mood, playerOrPlaceholder, usePlayers } from '@/features/soiree/players'
import { ConfirmModal, LaunchCountdown } from '@/features/soiree/components'
import { ResultsScreen } from '@/features/soiree/ResultsScreen'

function PlaySkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-36 w-full" />
      <div className="grid grid-cols-3 gap-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
    </div>
  )
}

export function MatchPage() {
  const { matchId } = useParams()
  const navigate = useNavigate()
  const me = useSession((s) => s.profile)
  const meId = me?.id ?? ''
  const { match, secret, loading, notFound, applyState } = useMatch(matchId)
  const soireeId = match?.soiree_id
  const { data: soireeData } = useSoiree(soireeId)
  const { match: current } = useCurrentMatch(soireeId)
  const { byId } = usePlayers()
  const { act, pending } = useGameAction(matchId, applyState)
  const [confirmAbort, setConfirmAbort] = useState(false)
  const [next, setNext] = useState<{ id: string; game: string } | null>(null)

  // Pas de bandeau « une partie commence » pour cette soirée : l'enchaînement ci-dessous s'en charge.
  useViewingSoiree(soireeId, 'match')

  const isHost = Boolean(soireeData && soireeData.soiree.host_id === meId)
  const game = match ? getGame(match.game_id) : undefined
  const state = match?.state as unknown as BaseGameState | undefined
  const finished = match?.status === 'finished'
  const aborted = Boolean(state?.aborted || state?.phase === 'aborted')
  const soireeEnded = soireeData?.soiree.status === 'ended'
  // Soirée terminée (fin auto, hôte…) : plus de salon, retour au hub.
  const backToSalon = () => navigate(soireeId && !soireeEnded ? `/soiree/${soireeId}` : '/', { replace: true })

  // L'hôte relance une partie pendant que je suis sur les résultats -> on enchaîne.
  useEffect(() => {
    if (current && current.id !== matchId && current.status === 'playing') {
      setNext((n) => n ?? { id: current.id, game: current.game_id })
    }
  }, [current, matchId])

  if (loading && !match) {
    return <PlaySkeleton />
  }
  if (notFound || !match || !state) {
    return (
      <Card className="mt-10 flex flex-col items-center gap-3 text-center">
        <ChibiImage slug={me?.slug ?? 'dede'} expression="surprise" size={120} />
        <h1 className="text-3xl">Partie introuvable</h1>
        <Button icon={<Home className="size-5" />} onClick={() => navigate('/', { replace: true })}>
          Retour au hub
        </Button>
      </Card>
    )
  }

  const nextGame = next ? getGame(next.game) : undefined
  const roundLabel = game?.roundLabel ? game.roundLabel(state) : state.round ? `Manche ${state.round}` : null
  const Play = game?.Play

  return (
    <div className="flex flex-col gap-4">
      {/* En-tête */}
      <div className="flex items-center gap-2">
        <motion.span className="text-4xl" initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 12 }}>
          {game?.emoji ?? '🎲'}
        </motion.span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl">{game?.name ?? match.game_id}</h1>
          {!finished && roundLabel && (
            <motion.div key={roundLabel} initial={{ scale: 1.6 }} animate={{ scale: 1 }}>
              <Badge tone="sky" tilted={false}>
                {roundLabel}
              </Badge>
            </motion.div>
          )}
        </div>
        {isHost && !finished && (
          <button
            type="button"
            aria-label="Annuler la partie"
            onClick={() => setConfirmAbort(true)}
            className="flex size-11 items-center justify-center rounded-full border-[3px] border-ink bg-surface shadow-sticker-sm"
          >
            <X className="size-5" strokeWidth={3} />
          </button>
        )}
        {!isHost && !finished && (
          <button
            type="button"
            aria-label="Retour au salon"
            onClick={backToSalon}
            className="flex size-11 items-center justify-center rounded-full border-[3px] border-ink bg-surface shadow-sticker-sm"
          >
            <Home className="size-5" strokeWidth={3} />
          </button>
        )}
      </div>

      {/* Corps */}
      {finished && aborted ? (
        <Card className="mt-6 flex flex-col items-center gap-3 text-center">
          <motion.div initial={{ rotate: -20, scale: 0 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 12 }}>
            <ChibiImage slug={me?.slug ?? 'dede'} expression={mood(byId[meId], 'sad')} size={130} />
          </motion.div>
          <h2 className="flex items-center gap-2 text-3xl">
            <Ban className="size-7" /> Partie annulée
          </h2>
          <p className="text-muted">
            {soireeEnded && soireeData
              ? soireeData.soiree.end_reason === 'abandoned'
                ? `${soireeEndCopy('abandoned', '').text} Aucun point compté.`
                : soireeEndCopy(soireeData.soiree.end_reason, soireeData.soiree.host_id === meId ? 'toi' : playerOrPlaceholder(byId, soireeData.soiree.host_id).nickname).text
              : 'L’hôte a annulé la partie. Aucun point compté.'}
          </p>
          <Button size="lg" fullWidth icon={<Home className="size-6" />} onClick={backToSalon}>
            {soireeEnded ? 'Retour au hub' : 'Retour au salon'}
          </Button>
        </Card>
      ) : finished ? (
        <ResultsScreen key={match.id} state={state} meId={meId} players={byId} game={game} onBack={backToSalon} />
      ) : Play && soireeId ? (
        <Suspense fallback={<PlaySkeleton />}>
          <Play
            matchId={match.id}
            soireeId={soireeId}
            state={state}
            secret={secret}
            meId={meId}
            isHost={isHost}
            players={byId}
            act={act}
            pending={pending}
            onExit={backToSalon}
          />
        </Suspense>
      ) : (
        <p className="text-center text-muted">Ce jeu n’est pas disponible dans cette version de l’app.</p>
      )}

      <ConfirmModal
        open={confirmAbort}
        onClose={() => setConfirmAbort(false)}
        title="Annuler la partie ?"
        danger
        confirmLabel="Annuler la partie"
        loading={pending}
        onConfirm={async () => {
          await act({ type: 'abort' })
          setConfirmAbort(false)
        }}
      >
        Personne ne marquera de points pour cette partie.
      </ConfirmModal>

      {next && (
        <LaunchCountdown
          emoji={nextGame?.emoji ?? '🎲'}
          name={nextGame?.name ?? 'Nouvelle partie'}
          color={nextGame?.color ?? '#FFB703'}
          onDone={() => navigate(`/partie/${next.id}`, { replace: true })}
        />
      )}
    </div>
  )
}
