import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/lib/cn'
import { TEAM_INFO, type TeamColor } from '@/features/teams/teams'
import { teamNames } from './logic'
import type { NdcState } from './types'

/**
 * Annonce « 💣 Les Rouges sont éliminés ! » quand une équipe touche la bombe à 3 ou 4 équipes (la manche
 * continue : sans ce message, on ne voit qu'une pastille grisée). Elle n'apparaît que sur un changement vu
 * en direct, pas à l'ouverture de l'écran, ni quand l'élimination termine la manche (le bandeau de fin le dit).
 * `big` : version télé.
 */
export function EliminationNotice({ s, meTeam, big }: { s: NdcState; meTeam?: TeamColor | null; big?: boolean }) {
  const live = s.phase === 'clue' || s.phase === 'guess'
  const seen = useRef<{ round: number; ids: Set<TeamColor> } | null>(null)
  const [notice, setNotice] = useState<{ key: string; ids: TeamColor[] } | null>(null)

  useEffect(() => {
    const ids = new Set(s.teams.filter((t) => t.eliminated).map((t) => t.id))
    const prev = seen.current
    seen.current = { round: s.round, ids }
    if (!prev || prev.round !== s.round || !live) return
    const fresh = [...ids].filter((id) => !prev.ids.has(id))
    if (fresh.length) setNotice({ key: `${s.round}-${fresh.join('-')}`, ids: fresh })
  }, [s.teams, s.round, live])

  useEffect(() => {
    if (!notice) return
    const t = window.setTimeout(() => setNotice(null), 4500)
    return () => clearTimeout(t)
  }, [notice])

  const first = notice ? TEAM_INFO[notice.ids[0]] : null
  const mine = Boolean(notice && meTeam && notice.ids.includes(meTeam))
  return (
    <AnimatePresence>
      {notice && first && (
        <motion.div
          key={notice.key}
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          onClick={() => setNotice(null)}
          role="status"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-[#07050f]/75 p-6 text-center"
        >
          <span className={big ? 'text-8xl' : 'text-6xl'}>💥</span>
          <p
            className={cn('sticker max-w-full rounded-card p-4 font-display font-extrabold', big ? 'text-5xl' : 'text-2xl')}
            style={{ backgroundColor: first.soft, color: '#1f1b2e' }}
          >
            💀 Les {teamNames(notice.ids)} ont touché la bombe : éliminés !
          </p>
          <p className={cn('font-bold text-white', big ? 'text-2xl' : 'text-base')}>
            {mine ? 'Vous ne jouez plus, mais regardez la suite !' : 'La partie continue sans eux.'}
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
