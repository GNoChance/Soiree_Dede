import { useState } from 'react'
import { ArrowLeft, PlayCircle } from 'lucide-react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/Button'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Skeleton } from '@/components/ui/Skeleton'
import { noelDaysLeft, useNoelState, useNoelStore, type NoelState } from './api'
import { BandPanel } from './BandGauge'
import { useNoelIntro } from './intro'
import { Flakes, MissionList, StreakLine, hotteButtonLabel } from './NoelParts'
import { PassTrack } from './PassTrack'
import { PreviewBar } from './PreviewBar'
import { HotteBoardCard, useHotteBoard } from './HotteBoard'
import { parisDay } from './hotteTime'
import { serverNow } from '@/features/soiree/useServerClock'

type Tab = 'missions' | 'pass' | 'band'

/** Bandeau festif (titre, sous-titre, compte à rebours). */
export function NoelBanner({ st }: { st: NoelState }) {
  const left = noelDaysLeft(st)
  return (
    <div className="sticker relative overflow-hidden rounded-card bg-[linear-gradient(135deg,#C1121F,#9D0208_55%,#2D6A4F)] p-4 text-white">
      <Flakes />
      <p className="relative font-display text-3xl font-extrabold">🎄 Noël chez Dédé</p>
      <p className="relative font-bold text-white/90">
        {st.phase === 'over'
          ? '🎄 C’est fini ! Merci la bande, rendez-vous l’an prochain.'
          : 'Chaque jour, des missions et la Hotte : remplis ton pass et la Grande Hotte de la bande !'}
      </p>
      {st.phase === 'live' && (
        <p className="relative mt-2 inline-block rounded-chip border-2 border-white/80 bg-white/15 px-2 py-0.5 text-sm font-extrabold">
          {left > 1 ? `Encore ${left} jours` : 'Dernier jour !'}
        </p>
      )}
    </div>
  )
}

/** Page « Noël » : missions du jour, Pass de Noël, Grande Hotte de la bande. */
export function NoelPage() {
  const navigate = useNavigate()
  const { state } = useNoelState(true)
  const [tab, setTab] = useState<Tab>('missions')
  const replay = useNoelIntro((s) => s.replay)
  const preview = useNoelStore((s) => s.preview !== null)
  // Classement du jour de la Hotte : visible ici une fois ma Hotte du jour faite (règle du serveur).
  const hotteDone = !preview && state?.phase === 'live' && state.hotte.status === 'done' && state.day === parisDay(serverNow())
  const board = useHotteBoard(hotteDone)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Retour à l’accueil"
          onClick={() => navigate('/')}
          className="flex size-11 items-center justify-center rounded-full border-[3px] border-ink bg-surface shadow-sticker-sm"
        >
          <ArrowLeft className="size-5" strokeWidth={3} />
        </button>
        <h1 className="flex-1 text-3xl">Noël</h1>
      </div>

      <PreviewBar />
      {!state && <Skeleton className="h-64 w-full" />}
      {state && (state.phase === 'off' || state.phase === 'before') && (
        <p className="sticker rounded-card bg-surface p-4 text-center font-bold">
          {state.phase === 'before' ? '🎄 L’événement de Noël commence le 1er décembre. Patience, les lutins s’activent !' : 'Pas d’événement en ce moment.'}
        </p>
      )}
      {state && (state.phase === 'live' || state.phase === 'over') && (
        <>
          <NoelBanner st={state} />
          <SegmentedControl
            ariaLabel="Onglets de Noël"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'missions', label: '✅ Missions' },
              { value: 'pass', label: '🎅 Pass' },
              { value: 'band', label: '🛷 Hotte' },
            ]}
          />

          {tab === 'missions' && (
            <div className="flex flex-col gap-4">
              {state.phase === 'live' ? (
                <>
                  <div className="sticker flex flex-col gap-2 rounded-card bg-surface p-4">
                    <p className="font-display text-xl font-extrabold">Missions du jour</p>
                    <MissionList st={state} link />
                  </div>
                  <Button size="lg" fullWidth onClick={() => navigate('/noel/hotte')}>
                    {hotteButtonLabel(state)}
                  </Button>
                  {hotteDone && <HotteBoardCard board={board} />}
                </>
              ) : (
                <p className="sticker rounded-card bg-surface p-4 text-center font-bold">Les missions sont terminées pour cette année.</p>
              )}
              <div className="sticker rounded-card bg-surface p-4">
                <StreakLine st={state} detailed />
              </div>
              <Button variant="ghost" fullWidth icon={<PlayCircle className="size-5" />} onClick={replay}>
                Revoir la vidéo
              </Button>
            </div>
          )}

          {tab === 'pass' && (
            <div className="flex flex-col gap-3">
              <div className="sticker flex flex-col gap-1 rounded-card bg-surface p-4 text-center">
                <p className="font-display text-3xl font-extrabold">{state.flakes.toLocaleString('fr-FR')} ❄️</p>
                <p className="font-bold">
                  {state.tier >= 30
                    ? '🎅 Pass terminé : tu es un Acharné de Noël !'
                    : `Palier ${state.tier}/30 · encore ${(state.next_at ?? 0) - state.flakes} ❄️ pour le suivant`}
                </p>
              </div>
              <PassTrack tier={state.tier} flakes={state.flakes} />
              <p className="text-center text-sm font-bold text-muted">Réservé aux acharnés : il faut presque tous les jours pour aller au bout !</p>
            </div>
          )}

          {tab === 'band' && <BandPanel st={state} />}
        </>
      )}
    </div>
  )
}
