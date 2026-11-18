import { playerOrPlaceholder, usePlayers } from '@/features/soiree/players'
import { useDevinBoard } from './api'

/** « 🔮 Meilleur devin : … » (ex æquo possibles) ; rien tant que personne n'a vu juste. */
export function DevinLine({ soireeId }: { soireeId: string }) {
  const rows = useDevinBoard(soireeId)
  const { byId } = usePlayers()
  const top = rows[0]?.hits ?? 0
  if (top < 1) return null
  const best = rows.filter((r) => r.hits === top)
  return (
    <p className="text-center font-display text-lg leading-snug font-extrabold">
      🔮 Meilleur devin : {best.map((r) => playerOrPlaceholder(byId, r.profile_id).nickname).join(', ')}
      <span className="block text-sm font-bold text-muted">
        {top} bon{top > 1 ? 's' : ''} pronostic{top > 1 ? 's' : ''}
      </span>
    </p>
  )
}
