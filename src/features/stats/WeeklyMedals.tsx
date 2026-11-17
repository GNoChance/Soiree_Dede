import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Card } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { fx } from '@/lib/feedback'
import { fmtWeek, useWeeklyWins, type WeeklyWin } from './weekly'

/** Rangée de médailles « Victorieux de la semaine » du profil. Rien si aucune médaille. */
export function WeeklyMedals({ profileId, mine }: { profileId: string | undefined; mine: boolean }) {
  const wins = useWeeklyWins(profileId)
  const reduce = useReducedMotion()
  const [open, setOpen] = useState<WeeklyWin | null>(null)
  if (!wins) return null

  if (wins.length === 0) {
    if (!mine) return null
    return (
      <Card className="flex items-center gap-3">
        <span className="text-4xl opacity-30 grayscale" aria-hidden>🏅</span>
        <p className="text-sm font-bold text-muted">Gagne le plus de parties dans la semaine pour décrocher ta médaille.</p>
      </Card>
    )
  }

  return (
    <Card className="flex flex-col gap-2">
      <h3 className="text-xl">
        Médailles de la semaine <span className="text-base text-muted">×{wins.length}</span>
      </h3>
      <div className="flex flex-wrap gap-2">
        {wins.map((w, i) => (
          <motion.button
            key={w.week_start}
            type="button"
            aria-label={`Victorieux de la semaine ${fmtWeek(w.week_start, w.week_end)}`}
            onClick={() => {
              fx.pop()
              setOpen(w)
            }}
            initial={reduce ? false : { scale: 0, rotate: -40 }}
            animate={{ scale: 1, rotate: 0 }}
            whileTap={{ scale: 0.85 }}
            whileHover={reduce ? undefined : { scale: 1.15, rotate: 8 }}
            transition={{ type: 'spring', stiffness: 400, damping: 12, delay: reduce ? 0 : 0.1 + Math.min(i, 8) * 0.07 }}
            className="sticker-sm flex size-14 items-center justify-center rounded-full bg-sun text-3xl"
          >
            🏅
          </motion.button>
        ))}
      </div>
      <p className="text-sm font-bold text-muted">Touche une médaille pour voir la semaine.</p>
      <Modal open={open != null} onClose={() => setOpen(null)} title="🏅 Victorieux de la semaine">
        {open && (
          <div className="flex flex-col items-center gap-2 text-center">
            <motion.div
              initial={reduce ? false : { scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 200, damping: 10 }}
              className="text-7xl"
            >
              🏅
            </motion.div>
            <p className="text-lg font-extrabold">Semaine {fmtWeek(open.week_start, open.week_end)}</p>
            <p className="font-bold text-muted">
              {open.wins} victoire{open.wins > 1 ? 's' : ''} cette semaine-là
            </p>
          </div>
        )}
      </Modal>
    </Card>
  )
}
