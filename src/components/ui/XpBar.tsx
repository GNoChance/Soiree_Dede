import { motion } from 'framer-motion'
import { xpProgress } from '@/lib/xp'
import { AnimatedNumber } from './AnimatedNumber'

/** Barre d'XP animée vers le niveau suivant. */
export function XpBar({ xp }: { xp: number }) {
  const p = xpProgress(xp)
  return (
    <div className="w-full">
      <div className="h-4 overflow-hidden rounded-full border-[3px] border-ink bg-sunk">
        <motion.div
          className="h-full rounded-full bg-mint"
          initial={{ width: 0 }}
          animate={{ width: `${Math.max(p.ratio * 100, 4)}%` }}
          transition={{ type: 'spring', stiffness: 90, damping: 16, delay: 0.3 }}
        />
      </div>
      <p className="mt-1 text-xs font-bold text-muted">
        <AnimatedNumber value={xp} /> / {p.next.toLocaleString('fr-FR')} XP
      </p>
    </div>
  )
}
