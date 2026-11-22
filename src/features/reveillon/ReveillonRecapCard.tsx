import { motion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { getGame } from '@/games/registry'
import { cn } from '@/lib/cn'
import type { MiniProfile } from '@/features/stats/api'
import { reveillonStandings, type Scenario } from './api'
import { getTheme } from './themes'

/** Résumé d'un scénario pour le récap / la photo souvenir : champion(s), manches, roi·reine des défis. */
export function reveillonSummary(sc: Scenario, profiles: Map<string, MiniProfile>) {
  const theme = getTheme(sc.theme)
  const standings = reveillonStandings(sc)
  const champs = standings.filter((s) => s.rank === 1 && s.total > 0).map((s) => profiles.get(s.profile_id)).filter((p): p is MiniProfile => Boolean(p))
  const maxStars = Math.max(0, ...standings.map((s) => s.stars))
  const starPeople = maxStars > 0 ? standings.filter((s) => s.stars === maxStars).map((s) => profiles.get(s.profile_id)).filter((p): p is MiniProfile => Boolean(p)) : []
  const defis = sc.history.reduce((n, h) => n + (h.bravo?.length ?? 0), 0)
  return { theme, standings, champs, champPoints: standings[0]?.total ?? 0, starPeople, maxStars, defis }
}

/** Carte « Réveillon » du récap de fin de soirée (RecapViewer). */
export function ReveillonRecapCard({ sc, profiles, className }: { sc: Scenario; profiles: Map<string, MiniProfile>; className: string }) {
  const { theme, champs, champPoints, starPeople, maxStars, defis } = reveillonSummary(sc, profiles)
  return (
    <div className={cn(className, 'justify-start')} style={{ backgroundColor: theme.color }}>
      <motion.span className="text-6xl" initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 9 }}>
        {theme.emoji}
      </motion.span>
      <h2 className="text-3xl leading-tight">{theme.name}</h2>
      {champs.length > 0 && (
        <div className="flex flex-col items-center gap-1">
          <p className="font-display text-lg font-extrabold">🏆 {champs.length > 1 ? 'Champions' : 'Champion·ne'} · {champPoints} pts</p>
          <div className="flex flex-wrap justify-center gap-2">
            {champs.map((p, i) => (
              <motion.div key={p.profile_id} className="flex flex-col items-center" initial={{ y: -60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 + i * 0.1, type: 'spring', stiffness: 220, damping: 11 }}>
                <Avatar slug={p.slug} tenue={p.equipped_tenue} size={champs.length > 2 ? 64 : 88} bounce />
                <span className="max-w-[8rem] truncate font-display text-xl font-extrabold">{p.nickname}</span>
              </motion.div>
            ))}
          </div>
        </div>
      )}
      <ul className="flex w-full flex-col gap-1">
        {sc.history.map((h, i) => {
          const g = getGame(h.game_id)
          const who = h.wins.map((id) => profiles.get(id)?.nickname).filter(Boolean)
          return (
            <motion.li
              key={h.round}
              initial={{ x: -30, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.3 + i * 0.06 }}
              className="sticker-sm flex items-center gap-2 bg-white px-2 py-1 text-left text-sm font-bold"
            >
              <span className="text-xl">{g?.emoji ?? '🎲'}</span>
              <span className="min-w-0 flex-1 truncate">
                {h.round}. {g?.name ?? h.game_id}
                {h.double ? ' ×2' : ''}
              </span>
              <span className="max-w-[45%] truncate">{who.length ? `🏆 ${who.join(' & ')}` : '—'}</span>
            </motion.li>
          )
        })}
      </ul>
      <p className="sticker rounded-chip bg-white px-4 py-1 font-display text-xl font-extrabold">
        🎁 {defis} défi{defis > 1 ? 's' : ''} relevé{defis > 1 ? 's' : ''}
      </p>
      {starPeople.length > 0 && (
        <p className="text-lg leading-snug font-bold">
          ⭐ {starPeople.length > 1 ? 'Stars' : 'Star'} des défis :{starPeople.map((p) => p.nickname).join(' & ')} ({maxStars})
        </p>
      )}
    </div>
  )
}
