import { useState } from 'react'
import { Swords } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { getGame } from '@/games/registry'
import type { PlayerInfo } from '@/games/types'
import { toastError } from '@/features/soiree/errors'
import { playerOrPlaceholder } from '@/features/soiree/players'
import { startChallenge, useSoireeChallenges } from './api'

/**
 * Salon : défis acceptés dont les deux joueurs sont là. L'hôte les lance (duel, 1 manche, eux deux) ;
 * les autres voient qu'un défi attend. `busy` : une partie est en cours / en lancement.
 */
export function ChallengeLaunchCard({ soireeId, isHost, meId, byId, busy, onStarted }: { soireeId: string; isHost: boolean; meId: string; byId: Record<string, PlayerInfo>; busy: boolean; onStarted: (matchId: string, game: string) => void }) {
  const { list, refetch } = useSoireeChallenges(soireeId, String(busy))
  const [starting, setStarting] = useState<string | null>(null)
  if (!list.length || busy) return null
  return (
    <Card accent="var(--color-sky)" className="flex flex-col gap-3 text-[#1f1b2e]">
      <h2 className="flex items-center gap-2 text-2xl">
        <Swords className="size-6" /> Défi{list.length > 1 ? 's' : ''} à jouer
      </h2>
      {list.map((c) => {
        const a = playerOrPlaceholder(byId, c.challenger_id)
        const b = playerOrPlaceholder(byId, c.opponent_id)
        const g = getGame(c.game_id)
        const mine = c.challenger_id === meId || c.opponent_id === meId
        return (
          <div key={c.id} className="sticker flex flex-col gap-2 bg-surface p-3 text-text">
            <div className="flex items-center justify-center gap-2">
              <Avatar slug={a.slug} tenue={a.equippedTenue} expression={a.equipped} size={44} />
              <span className="font-display text-xl font-extrabold">VS</span>
              <Avatar slug={b.slug} tenue={b.equippedTenue} expression={b.equipped} size={44} />
            </div>
            <p className="text-center font-display text-lg leading-tight font-extrabold">
              {a.nickname} vs {b.nickname} · {g ? `${g.emoji} ${g.name}` : c.game_id}
            </p>
            <p className="text-center text-sm font-bold text-muted">{c.stake ? `Pot : ${2 * c.stake} 🪙 pour le gagnant` : 'Pour la gloire'}</p>
            {isHost ? (
              <Button
                size="md"
                fullWidth
                loading={starting === c.id}
                disabled={Boolean(starting)}
                onClick={async () => {
                  if (!g) return
                  setStarting(c.id)
                  try {
                    const ids = [c.challenger_id, c.opponent_id]
                    const base = { ...(g.defaultOptions ?? {}) }
                    const prepared = g.prepareStart ? await g.prepareStart(base, { playerIds: ids }) : base
                    const matchId = await startChallenge(c.id, soireeId, prepared)
                    onStarted(matchId, c.game_id)
                  } catch (e) {
                    toastError(e)
                    void refetch()
                  } finally {
                    setStarting(null)
                  }
                }}
              >
                Lancer le défi
              </Button>
            ) : (
              <p className="text-center text-sm font-bold">{mine ? 'L’hôte peut lancer ton défi quand vous êtes prêts.' : 'L’hôte peut lancer ce défi : prépare tes pièces pour parier ! 🪙'}</p>
            )}
          </div>
        )
      })}
    </Card>
  )
}
