import { useEffect, useState } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { Card } from '@/components/ui/Card'
import { playerOrPlaceholder, usePlayers } from '@/features/soiree/players'
import { useSession } from '@/store/session'
import { hotteBoard, type HotteBoardRow } from './hotteApi'

/** Classement du jour de la Hotte (bonnes réponses, puis temps). board null = chargement. */
export function HotteBoardCard({ board }: { board: HotteBoardRow[] | null }) {
  const { byId } = usePlayers()
  const meId = useSession((s) => s.profile?.id)
  return (
    <Card className="flex flex-col gap-2">
      <p className="font-display text-xl font-extrabold">🏆 Classement du jour</p>
      {board === null && <p className="text-sm font-bold text-muted">Chargement…</p>}
      {board?.map((r, i) => {
        const p = playerOrPlaceholder(byId, r.profile_id)
        return (
          <div key={r.profile_id} className={`flex items-center gap-3 rounded-card p-2 ${r.profile_id === meId ? 'bg-sun/30' : ''}`}>
            <span className="w-6 text-center font-display font-extrabold">{i + 1}</span>
            <Avatar slug={p.slug} tenue={p.equippedTenue} size={40} />
            <span className="min-w-0 flex-1 truncate font-bold">{p.nickname}</span>
            <span className="font-display font-extrabold">{r.score}/5</span>
            <span className="w-12 text-right text-xs font-bold text-muted">{r.secs} s</span>
          </div>
        )
      })}
    </Card>
  )
}

/** Classement du jour, chargé quand `enabled` (le serveur ne le montre qu'après sa propre Hotte). */
export function useHotteBoard(enabled: boolean): HotteBoardRow[] | null {
  const [board, setBoard] = useState<HotteBoardRow[] | null>(null)
  useEffect(() => {
    if (!enabled) return
    let live = true
    hotteBoard()
      .then((b) => live && setBoard(b))
      .catch(() => live && setBoard([]))
    return () => {
      live = false
    }
  }, [enabled])
  return enabled ? board : null
}
