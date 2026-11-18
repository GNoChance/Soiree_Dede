import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Star } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Card } from '@/components/ui/Card'
import { cn } from '@/lib/cn'
import type { PlayerInfo } from '@/games/types'
import { playerOrPlaceholder } from '@/features/soiree/players'
import { fetchMatchPronos } from './api'
import type { MatchPronos } from './types'

/**
 * Bande « Les pronostics » de l'écran de fin de partie : qui avait vu juste (étoile + « +1 »),
 * les autres sont grisés. Rien n'est affiché sans pari ni quand la partie est annulée / sans gagnant.
 */
export function PronosResult({ matchId, meId, byId }: { matchId: string; meId: string; byId: Record<string, PlayerInfo> }) {
  const reduce = useReducedMotion()
  const [data, setData] = useState<MatchPronos | null>(null)
  useEffect(() => {
    let alive = true
    void fetchMatchPronos(matchId).then((d) => {
      if (alive) setData(d)
    })
    return () => {
      alive = false
    }
  }, [matchId])
  if (!data || data.void || data.picks.length === 0) return null
  const picks = [...data.picks].sort((a, b) => Number(b.profile_id === meId) - Number(a.profile_id === meId))
  return (
    <Card className="flex flex-col gap-2">
      <h2 className="text-2xl">🔮 Les pronostics</h2>
      <ul className="flex flex-col gap-1.5">
        {picks.map((r, i) => {
          const who = playerOrPlaceholder(byId, r.profile_id)
          const pick = playerOrPlaceholder(byId, r.pick)
          return (
            <motion.li
              key={r.profile_id}
              initial={reduce ? false : { opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: reduce ? 0 : 0.2 + i * 0.12, type: 'spring', stiffness: 300, damping: 20 }}
              className={cn('flex items-center gap-2 rounded-card border-2 border-ink px-3 py-2', r.ok ? 'bg-sun text-[#1f1b2e]' : 'bg-sunk opacity-70')}
            >
              <Avatar slug={who.slug} tenue={who.equippedTenue} size={40} />
              <span className="min-w-0 flex-1 truncate font-bold">
                {r.profile_id === meId ? 'Toi' : who.nickname}
                <span className="font-normal"> → </span>
                {r.pick === meId ? 'toi' : pick.nickname}
              </span>
              {r.ok && (
                <motion.span
                  initial={reduce ? false : { scale: 0, rotate: -40 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ delay: reduce ? 0 : 0.5 + i * 0.12, type: 'spring', stiffness: 380, damping: 12 }}
                  className="flex items-center gap-1 font-display text-lg font-extrabold"
                >
                  <Star className="size-5 fill-current" /> +1
                </motion.span>
              )}
            </motion.li>
          )
        })}
      </ul>
    </Card>
  )
}
