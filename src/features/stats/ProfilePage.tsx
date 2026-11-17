import { ArrowLeft, Flame, Heart, Skull, Star, Trophy } from 'lucide-react'
import type { ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Avatar } from '@/components/ui/Avatar'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { StaggerItem, StaggerList } from '@/components/ui/Stagger'
import { XpBar } from '@/components/ui/XpBar'
import { getGame } from '@/games/registry'
import { rpcErrorMessage } from '@/lib/rpcError'
import { useSession } from '@/store/session'
import { gameLabel, useProfileStats } from './api'

function Stat({ label, value, suffix, tone }: { label: string; value: number; suffix?: string; tone: string }) {
  return (
    <div className={`sticker flex flex-1 flex-col items-center rounded-card px-2 py-3 text-[#1f1b2e] ${tone}`}>
      <span className="font-display text-3xl font-extrabold">
        <AnimatedNumber value={value} />
        {suffix}
      </span>
      <span className="text-center text-sm font-bold leading-tight">{label}</span>
    </div>
  )
}

function Fact({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <Card className="flex items-center gap-3">
      <span className="text-grape">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-muted">{title}</p>
        <div className="text-xl font-extrabold leading-tight">{children}</div>
      </div>
    </Card>
  )
}

/** /profil/:id : statistiques d'un joueur (moi ou un autre). */
export function ProfilePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const me = useSession((s) => s.profile?.id)
  const { data, error, loading } = useProfileStats(id)
  const mine = id === me
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Button variant="secondary" size="sm" aria-label="Retour" onClick={() => navigate(-1)} icon={<ArrowLeft className="size-5" />} />
        <h1 className="text-3xl">{mine ? 'Mon profil' : 'Profil'}</h1>
      </div>
      {loading && <Skeleton className="h-64 w-full" />}
      {error != null && !data && <Card className="font-bold">{rpcErrorMessage(error)}</Card>}
      {data && (
        <StaggerList className="flex flex-col gap-4">
          <StaggerItem>
            <Card className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <Avatar slug={data.profile.slug} tenue={data.profile.equipped_tenue} size={80} bounce />
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-3xl">{data.profile.nickname}</h2>
                  <Badge tone="grape">Niveau {data.profile.level}</Badge>
                </div>
              </div>
              <XpBar xp={data.profile.xp} />
            </Card>
          </StaggerItem>
          <StaggerItem>
            <div className="flex gap-3">
              <Stat label="parties jouées" value={data.games_played} tone="bg-sky" />
              <Stat label="victoires" value={data.wins} tone="bg-sun" />
              <Stat label="de victoires" value={data.win_rate} suffix=" %" tone="bg-mint" />
            </div>
          </StaggerItem>
          {data.games_played === 0 ? (
            <StaggerItem>
              <Card className="text-center text-lg font-bold">Aucune partie jouée pour l’instant.</Card>
            </StaggerItem>
          ) : (
            <>
              {data.favorite_game && (
                <StaggerItem>
                  <Fact icon={<Heart className="size-7" />} title="Jeu préféré">
                    {gameLabel(data.favorite_game.game_id, getGame)}
                    <span className="ml-2 text-sm font-bold text-muted">{data.favorite_game.played} parties</span>
                  </Fact>
                </StaggerItem>
              )}
              {data.best_game && (
                <StaggerItem>
                  <Fact icon={<Star className="size-7" />} title="Meilleur jeu">
                    {gameLabel(data.best_game.game_id, getGame)}
                    <span className="ml-2 text-sm font-bold text-muted">
                      {data.best_game.wins} victoire{data.best_game.wins > 1 ? 's' : ''} sur {data.best_game.played} ({data.best_game.win_rate} %)
                    </span>
                  </Fact>
                </StaggerItem>
              )}
              {data.rival && (
                <StaggerItem>
                  <Card className="flex items-center gap-3">
                    <span className="text-tomato">
                      <Skull className="size-7" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-muted">Rival</p>
                      <p className="truncate text-xl font-extrabold">{data.rival.nickname}</p>
                      <p className="text-sm font-bold text-muted">
                        {mine ? 'T’a battu' : 'L’a battu'} {data.rival.losses} fois
                      </p>
                    </div>
                    <button type="button" aria-label={`Profil de ${data.rival.nickname}`} onClick={() => navigate(`/profil/${data.rival?.profile_id}`)}>
                      <Avatar slug={data.rival.slug} tenue={data.rival.equipped_tenue} size={56} />
                    </button>
                  </Card>
                </StaggerItem>
              )}
              <StaggerItem>
                <Fact icon={<Flame className="size-7" />} title="Soirées">
                  {data.soirees} soirée{data.soirees > 1 ? 's' : ''}
                </Fact>
              </StaggerItem>
              <StaggerItem>
                <Card className="flex flex-col gap-2">
                  <h3 className="flex items-center gap-2 text-xl">
                    <Trophy className="size-5" /> Par jeu
                  </h3>
                  <ul className="flex flex-col gap-1.5">
                    {data.per_game.map((g) => (
                      <li key={g.game_id} className="flex items-center justify-between gap-2 rounded-chip border-2 border-ink bg-sunk px-3 py-1.5">
                        <span className="truncate font-bold">{gameLabel(g.game_id, getGame)}</span>
                        <span className="shrink-0 text-sm font-bold text-muted">
                          {g.wins} / {g.played}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
              </StaggerItem>
            </>
          )}
        </StaggerList>
      )}
    </div>
  )
}
