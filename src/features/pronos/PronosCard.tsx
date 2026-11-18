import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/Card'
import { getGame } from '@/games/registry'
import type { PlayerInfo } from '@/games/types'
import { usePronos } from './api'
import { PronosPicker } from './PronosPicker'
import { PRONOS_TTL_MS } from './types'

/** Carte « Qui va gagner ? » du salon (joueurs non hôtes) : visible tant que la manche est ouverte. */
export function PronosCard({ soireeId, meId, byId }: { soireeId: string; meId: string; byId: Record<string, PlayerInfo> }) {
  const { state, pick } = usePronos(soireeId)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  const round = state.round
  // Filet côté client : le serveur ignore déjà une manche de plus de 10 min.
  if (!round || now - new Date(round.opened_at).getTime() > PRONOS_TTL_MS) return null
  const game = getGame(round.game_id)
  return (
    <Card className="flex flex-col gap-3">
      <div>
        <h2 className="text-2xl">🔮 Qui va gagner ?</h2>
        <p className="font-bold text-muted">{game ? `${game.emoji} ${game.name}` : 'Le prochain jeu'}</p>
      </div>
      <PronosPicker playerIds={round.player_ids} byId={byId} meId={meId} myPick={state.my_pick} onPick={(id) => void pick(id)} />
      <p className="text-sm leading-snug text-muted">Touche un joueur pour parier. Tu peux changer d’avis jusqu’au lancement.</p>
    </Card>
  )
}
