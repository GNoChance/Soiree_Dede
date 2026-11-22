import { useState } from 'react'
import { ArrowLeft, Clock, Crown, Gamepad2, PartyPopper } from 'lucide-react'
import { useNavigate, useParams } from 'react-router'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { StaggerItem, StaggerList } from '@/components/ui/Stagger'
import { getGame } from '@/games/registry'
import { SoireeRecap } from '@/features/recap/RecapViewer'
import { rpcErrorMessage } from '@/lib/rpcError'
import { useSession } from '@/store/session'
import { fmtDate, fmtDuration, gameLabel, useHistoryDetail, useMyHistory } from './api'
import { Podium, StandingLine } from './SoireeStandings'

function Header({ title, back }: { title: string; back: string }) {
  const navigate = useNavigate()
  return (
    <div className="flex items-center gap-3">
      <Button variant="secondary" size="sm" aria-label="Retour" onClick={() => navigate(back)} icon={<ArrowLeft className="size-5" />} />
      <h1 className="text-3xl">{title}</h1>
    </div>
  )
}

/** /historique : mes soirées terminées. */
export function HistoryPage() {
  const navigate = useNavigate()
  const { data, error, loading } = useMyHistory()
  return (
    <div className="flex flex-col gap-4">
      <Header title="Mes soirées" back="/" />
      <Button fullWidth onClick={() => navigate('/album')}>
        📖 Album souvenir
      </Button>
      {loading && (
        <>
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </>
      )}
      {error != null && !data && <Card className="font-bold">{rpcErrorMessage(error)}</Card>}
      {data && data.length === 0 && (
        <Card className="flex flex-col items-center gap-2 text-center">
          <span className="text-5xl">🎈</span>
          <p className="text-lg font-bold">Pas encore de soirée terminée.</p>
          <p className="text-muted">Tes soirées passées apparaîtront ici.</p>
        </Card>
      )}
      {data && data.length > 0 && (
        <StaggerList className="flex flex-col gap-4">
          {data.map((s) => (
            <StaggerItem key={s.id}>
              <Card tilt onClick={() => navigate(`/historique/${s.id}`)} className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-lg font-extrabold capitalize">{fmtDate(s.started_at)}</p>
                    <p className="text-sm font-bold text-muted">Chez {s.host?.nickname ?? '?'}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge tone="sky">
                      <Clock className="size-3.5" />
                      {fmtDuration(s.duration_min)}
                    </Badge>
                    <Badge tone="grape">
                      <Gamepad2 className="size-3.5" />
                      {s.games_played} partie{s.games_played > 1 ? 's' : ''}
                    </Badge>
                  </div>
                </div>
                <div className="flex flex-wrap -space-x-2">
                  {s.players.map((p) => (
                    <Avatar key={p.profile_id} slug={p.slug} tenue={p.equipped_tenue} size={40} />
                  ))}
                </div>
                {s.winner ? (
                  <div className="flex items-center gap-2 rounded-card border-2 border-ink bg-sun px-3 py-1.5 text-[#1f1b2e]">
                    <Crown className="size-5" />
                    <span className="font-bold">{s.winner.nickname} a gagné la soirée ({s.winner.points} pts)</span>
                  </div>
                ) : (
                  <p className="text-sm font-bold text-muted">Pas de vainqueur pour cette soirée.</p>
                )}
              </Card>
            </StaggerItem>
          ))}
        </StaggerList>
      )}
    </div>
  )
}

/** /historique/:id : détail d'une soirée. */
export function HistoryDetailPage() {
  const { id } = useParams()
  const meId = useSession((s) => s.profile?.id)
  const { data, error, loading } = useHistoryDetail(id)
  const [recapOpen, setRecapOpen] = useState(false)
  return (
    <div className="flex flex-col gap-4">
      <Header title="Détail de la soirée" back="/historique" />
      {recapOpen && id && <SoireeRecap soireeId={id} doneLabel="Fermer" onDone={() => setRecapOpen(false)} />}
      {loading && <Skeleton className="h-48 w-full" />}
      {error != null && !data && <Card className="font-bold">{rpcErrorMessage(error)}</Card>}
      {data && (
        <StaggerList className="flex flex-col gap-4">
          <StaggerItem>
            <Card className="flex flex-col gap-1">
              <p className="text-lg font-extrabold capitalize">{fmtDate(data.started_at)}</p>
              <p className="font-bold text-muted">
                Chez {data.host?.nickname ?? '?'} · {fmtDuration(data.duration_min)} · {data.matches.length} partie{data.matches.length > 1 ? 's' : ''}
              </p>
              {data.matches.length > 0 && (
                <Button className="mt-2" fullWidth icon={<PartyPopper className="size-6" />} onClick={() => setRecapOpen(true)}>
                  Revoir le récap
                </Button>
              )}
            </Card>
          </StaggerItem>
          {data.winner_ids.length > 0 && (
            <StaggerItem>
              <Card className="flex flex-col gap-3 pb-0">
                <h2 className="text-center text-2xl">Podium</h2>
                <Podium standings={data.standings} />
              </Card>
            </StaggerItem>
          )}
          <StaggerItem>
            <Card className="flex flex-col gap-3">
              <h2 className="text-2xl">Classement final</h2>
              <ul className="flex flex-col gap-2">
                {data.standings.map((r) => (
                  <StandingLine key={r.profile_id} row={r} me={r.profile_id === meId} />
                ))}
              </ul>
            </Card>
          </StaggerItem>
          <StaggerItem>
            <Card className="flex flex-col gap-3">
              <h2 className="text-2xl">Parties jouées</h2>
              {data.matches.length === 0 && <p className="text-muted">Aucune partie terminée.</p>}
              <ol className="flex flex-col gap-2">
                {data.matches.map((m, i) => (
                  <li key={m.id} className="flex items-center gap-3 rounded-card border-2 border-ink bg-sunk px-3 py-2">
                    <span className="w-6 text-center font-display font-extrabold text-muted">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-lg font-bold">{gameLabel(m.game_id, getGame)}</p>
                      <p className="truncate text-sm font-bold text-muted">
                        {m.winners.length ? `🏆 ${m.winners.map((w) => w.nickname).join(', ')}` : 'Pas de gagnant'}
                      </p>
                    </div>
                    <div className="flex -space-x-2">
                      {m.winners.slice(0, 3).map((w) => (
                        <Avatar key={w.profile_id} slug={w.slug} tenue={w.equipped_tenue} size={36} />
                      ))}
                    </div>
                  </li>
                ))}
              </ol>
            </Card>
          </StaggerItem>
        </StaggerList>
      )}
    </div>
  )
}
