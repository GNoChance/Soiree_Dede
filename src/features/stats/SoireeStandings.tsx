import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { Crown, Home, Trophy } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { victoryConfetti } from '@/components/ui/confetti'
import { fx } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import { useSession } from '@/store/session'
import { fetchStandings, useSoireeStandings, type SoireeStandings, type StandingRow } from './api'

const RANK_EMOJI: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' }
export const pts = (n: number) => `${n} pt${n > 1 ? 's' : ''}`

/** Ligne de classement (avatar chibi, rang, points). */
export function StandingLine({ row, me, delay = 0 }: { row: StandingRow; me?: boolean; delay?: number }) {
  return (
    <motion.li
      initial={{ opacity: 0, x: -24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, type: 'spring', stiffness: 300, damping: 20 }}
      className={cn('flex items-center gap-3 rounded-card border-2 border-ink px-3 py-2', me ? 'bg-sun text-[#1f1b2e]' : 'bg-sunk')}
    >
      <span className="w-8 text-center font-display text-xl font-extrabold">{RANK_EMOJI[row.rank] ?? row.rank}</span>
      <Avatar slug={row.slug} tenue={row.equipped_tenue} size={44} />
      <span className="min-w-0 flex-1 truncate text-lg font-bold">{row.nickname}</span>
      <span className="font-display text-xl font-extrabold">{pts(row.points)}</span>
    </motion.li>
  )
}

/** Encart « Classement de la soirée » du salon, mis à jour en temps réel. */
export function SoireeStandingsCard({ soireeId }: { soireeId: string }) {
  const meId = useSession((s) => s.profile?.id)
  const { data } = useSoireeStandings(soireeId)
  if (!data || data.games_played === 0) return null
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Trophy className="size-6 text-tangerine" />
        <h2 className="flex-1 text-2xl">Classement de la soirée</h2>
        <span className="text-sm font-bold text-muted">
          {data.games_played} partie{data.games_played > 1 ? 's' : ''}
        </span>
      </div>
      <ul className="flex flex-col gap-2">
        {data.standings.map((r) => (
          <StandingLine key={r.profile_id} row={r} me={r.profile_id === meId} />
        ))}
      </ul>
      <p className="text-xs leading-snug text-muted">Victoire = 3 pts, 2e place = 2 pts, 3e = 1 pt.</p>
    </Card>
  )
}

const STEP_H = { 1: 150, 2: 110, 3: 80 } as const
const STEP_COLOR = { 1: 'bg-sun', 2: 'bg-sky', 3: 'bg-bubblegum' } as const

/** Podium 3 marches (2 - 1 - 3), ex-aequo sur la même marche. */
export function Podium({ standings }: { standings: StandingRow[] }) {
  const reduce = useReducedMotion()
  const by = (n: number) => standings.filter((s) => s.rank === n && s.points > 0)
  const steps = [2, 1, 3] as const
  return (
    <div className="flex items-end justify-center gap-2">
      {steps.map((n) => {
        const list = by(n)
        if (!list.length) return <div key={n} className="w-20" />
        return (
          <div key={n} className="flex w-28 flex-col items-center">
            <div className="flex flex-wrap justify-center">
              {list.map((r, i) => (
                <motion.div
                  key={r.profile_id}
                  initial={{ y: -260, opacity: 0, scale: 0.6 }}
                  animate={{ y: 0, opacity: 1, scale: 1 }}
                  transition={{ delay: reduce ? 0 : 0.4 + (n === 1 ? 1.6 : n === 2 ? 1.0 : 0.5) + i * 0.1, type: 'spring', stiffness: 220, damping: 12 }}
                  className="flex flex-col items-center"
                >
                  <div className="relative">
                    {n === 1 && (
                      <motion.span
                        className="absolute -top-7 left-1/2 -translate-x-1/2"
                        animate={reduce ? undefined : { rotate: [-8, 8, -8], y: [0, -3, 0] }}
                        transition={{ repeat: Infinity, duration: 1.6 }}
                      >
                        <Crown className="size-8 fill-sun text-ink" />
                      </motion.span>
                    )}
                    <Avatar slug={r.slug} tenue={r.equipped_tenue} expression={n === 1 ? 'joie' : undefined} size={n === 1 ? 92 : 72} bounce={n === 1} />
                  </div>
                  <span className="max-w-[7rem] truncate text-base font-extrabold">{r.nickname}</span>
                </motion.div>
              ))}
            </div>
            <motion.div
              initial={{ height: 0 }}
              animate={{ height: STEP_H[n] }}
              transition={{ delay: reduce ? 0 : n === 1 ? 1.5 : n === 2 ? 0.9 : 0.4, type: 'spring', stiffness: 160, damping: 14 }}
              className={cn('sticker mt-1 flex w-full flex-col items-center justify-start gap-0.5 overflow-hidden rounded-t-card pt-2 text-[#1f1b2e]', STEP_COLOR[n])}
            >
              <span className="text-3xl">{RANK_EMOJI[n]}</span>
              <span className="font-display text-lg font-extrabold">{pts(list[0].points)}</span>
            </motion.div>
          </div>
        )
      })}
    </div>
  )
}

/** Titre neutre, identique pour tout le monde. */
export function crownTitle(winners: StandingRow[]) {
  return winners.length !== 1 ? 'Stars de la soirée' : 'Star de la soirée'
}

/**
 * Écran de fin de soirée : podium animé + confettis. Si personne n'a de point,
 * appelle `onDone` aussitôt. `onDone` est aussi appelé par le bouton.
 */
export function SoireePodium({ soireeId, onDone }: { soireeId: string; onDone: () => void }) {
  const [data, setData] = useState<SoireeStandings | null>(null)
  const doneRef = useRef(onDone)
  useEffect(() => {
    doneRef.current = onDone
  })
  useEffect(() => {
    let alive = true
    fetchStandings(soireeId)
      .then((d) => {
        if (!alive) return
        if (!d.winner_ids.length) doneRef.current()
        else setData(d)
      })
      .catch(() => {
        if (alive) doneRef.current()
      })
    return () => {
      alive = false
    }
  }, [soireeId])
  useEffect(() => {
    if (!data) return
    fx.fanfare()
    const t = window.setTimeout(() => victoryConfetti(2600), 1700)
    return () => window.clearTimeout(t)
  }, [data])
  if (!data) return null
  const winners = data.standings.filter((s) => s.rank === 1 && s.points > 0)
  const rest = data.standings.filter((s) => s.rank > 3 || s.points === 0)
  return createPortal(
    <motion.div
      className="fixed inset-0 z-[66] flex items-center justify-center bg-[#07050f]/70 p-4 backdrop-blur-[2px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="podium-title"
    >
      <motion.div
        className="sticker flex max-h-[94dvh] w-full max-w-sm flex-col items-center gap-4 overflow-y-auto overscroll-contain rounded-bubble bg-surface p-5 pt-8 text-center text-text"
        initial={{ scale: 0.6, rotate: -6, y: 60 }}
        animate={{ scale: 1, rotate: 0, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 15 }}
      >
        <motion.h2
          id="podium-title"
          className="text-4xl leading-tight"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 1.7, type: 'spring', stiffness: 300, damping: 10 }}
        >
          👑 {crownTitle(winners)}
        </motion.h2>
        <Podium standings={data.standings} />
        {rest.length > 0 && (
          <ul className="flex w-full flex-col gap-1.5">
            {rest.map((r, i) => (
              <StandingLine key={r.profile_id} row={r} delay={2 + i * 0.1} />
            ))}
          </ul>
        )}
        <Button size="lg" fullWidth icon={<Home className="size-6" />} onClick={() => doneRef.current()}>
          Continuer
        </Button>
      </motion.div>
    </motion.div>,
    document.body,
  )
}
