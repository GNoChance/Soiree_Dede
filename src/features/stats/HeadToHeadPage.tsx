import { ArrowLeft } from 'lucide-react'
import { useNavigate, useParams } from 'react-router'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { StaggerItem, StaggerList } from '@/components/ui/Stagger'
import { getGame } from '@/games/registry'
import { rpcErrorMessage } from '@/lib/rpcError'
import { useSession } from '@/store/session'
import { fmtDate, gameLabel, useHeadToHead, type HeadToHead } from './api'

/** Phrase drôle selon l'écart de victoires. */
export function h2hQuip(h: HeadToHead, nick: string): string {
  if (h.played === 0) return 'Vous n’avez encore jamais joué ensemble. Lancez une partie, qu’on rigole !'
  const d = h.me_wins - h.other_wins
  if (d === 0) return h.me_wins === 0 ? 'Personne n’a encore gagné… à qui le premier sourire ?' : 'Égalité parfaite ! Il va falloir une belle ! 🤝'
  const lead = Math.abs(d)
  if (d > 0) {
    if (lead >= 10) return `Tu écrases ${nick} 😈 Un peu de pitié, offre-lui un goûter !`
    if (lead >= 4) return `Tu domines nettement ${nick}. Il va falloir s’entraîner ! 💪`
    return `Tu mènes, mais ${nick} est dans ton dos… 👀`
  }
  if (lead >= 10) return `${nick} te met la misère 😅 Demande-lui ses secrets !`
  if (lead >= 4) return `${nick} a pris de l’avance. Revanche, vite ! 🔥`
  return `${nick} mène de peu… à toi de renverser la vapeur ! ⚡`
}

function Score({ label, me, other, tone }: { label: string; me: number; other: number; tone: string }) {
  return (
    <div className={`sticker flex flex-1 flex-col items-center rounded-card px-2 py-3 text-[#1f1b2e] ${tone}`}>
      <span className="font-display text-3xl font-extrabold">
        {me} <span className="text-xl">-</span> {other}
      </span>
      <span className="text-center text-sm font-bold leading-tight">{label}</span>
    </div>
  )
}

/** /face-a-face/:id : « Toi vs <pseudo> ». */
export function HeadToHeadPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const profile = useSession((s) => s.profile)
  const { data, error, loading } = useHeadToHead(id)
  const nick = data?.other.nickname ?? ''
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Button variant="secondary" size="sm" aria-label="Retour" onClick={() => navigate(-1)} icon={<ArrowLeft className="size-5" />} />
        <h1 className="text-3xl">{nick ? `Toi vs ${nick}` : 'Face-à-face'}</h1>
      </div>
      {loading && <Skeleton className="h-64 w-full" />}
      {error != null && !data && <Card className="font-bold">{rpcErrorMessage(error)}</Card>}
      {data && profile && (
        <StaggerList className="flex flex-col gap-4">
          <StaggerItem>
            <Card className="flex flex-col items-center gap-3">
              <div className="flex w-full items-center justify-around">
                <div className="flex flex-col items-center">
                  <Avatar slug={profile.slug} tenue={profile.equipped_tenue} size={96} bounce />
                  <span className="max-w-28 truncate font-display text-lg font-extrabold">{profile.nickname}</span>
                </div>
                <span className="font-display text-4xl font-extrabold text-tomato">VS</span>
                <div className="flex flex-col items-center">
                  <Avatar slug={data.other.slug} tenue={data.other.equipped_tenue} size={96} bounce />
                  <span className="max-w-28 truncate font-display text-lg font-extrabold">{nick}</span>
                </div>
              </div>
              <p className="text-center text-lg font-bold leading-snug">{h2hQuip(data, nick)}</p>
            </Card>
          </StaggerItem>
          {data.played > 0 && (
            <>
              <StaggerItem>
                <div className="flex gap-3">
                  <Score label={`victoires (${data.played} partie${data.played > 1 ? 's' : ''} ensemble)`} me={data.me_wins} other={data.other_wins} tone="bg-sun" />
                  <Score label={`duels directs (${data.duels})`} me={data.me_duel_wins} other={data.other_duel_wins} tone="bg-sky" />
                </div>
              </StaggerItem>
              {data.me_best_game && (
                <StaggerItem>
                  <Card>
                    <p className="text-sm font-bold text-muted">Là où tu domines</p>
                    <p className="text-xl font-extrabold">{gameLabel(data.me_best_game.game_id, getGame)}</p>
                  </Card>
                </StaggerItem>
              )}
              {data.other_best_game && (
                <StaggerItem>
                  <Card>
                    <p className="text-sm font-bold text-muted">Là où {nick} te domine</p>
                    <p className="text-xl font-extrabold">{gameLabel(data.other_best_game.game_id, getGame)}</p>
                  </Card>
                </StaggerItem>
              )}
              {data.last && (
                <StaggerItem>
                  <Card>
                    <p className="text-sm font-bold text-muted">Dernière partie ensemble</p>
                    <p className="text-xl font-extrabold">{gameLabel(data.last.game_id, getGame)}</p>
                    <p className="text-sm font-bold text-muted">
                      {data.last.finished_at ? `${fmtDate(data.last.finished_at)} · ` : ''}
                      {data.last.winner === 'me' ? 'Tu as gagné 🏆' : data.last.winner === 'other' ? `${nick} a gagné` : 'Ni l’un ni l’autre n’a gagné'}
                    </p>
                  </Card>
                </StaggerItem>
              )}
            </>
          )}
        </StaggerList>
      )}
    </div>
  )
}
