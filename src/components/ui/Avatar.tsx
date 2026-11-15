import { motion } from 'framer-motion'
import { getCharacter } from '@/data/characters'
import { cn } from '@/lib/cn'
import { ChibiImage } from './ChibiImage'

export interface AvatarProps {
  slug: string
  expression?: string
  tenue?: string
  size?: number
  /** Pastille de statut (ex: couronne, check) en bas a droite */
  badge?: React.ReactNode
  /** Fait rebondir l'avatar en continu */
  bounce?: boolean
  selected?: boolean
  className?: string
}

/** Disque sticker (couleur d'accent du perso) + chibi dedans. */
export function Avatar({ slug, expression = 'joie', tenue = 'default', size = 56, badge, bounce, selected, className }: AvatarProps) {
  const color = getCharacter(slug)?.color ?? '#FFB703'
  return (
    <motion.div
      animate={bounce ? { y: [0, -6, 0] } : undefined}
      transition={bounce ? { repeat: Infinity, duration: 1.4, ease: 'easeInOut' } : undefined}
      className={cn('relative inline-flex shrink-0', className)}
      style={{ width: size, height: size }}
    >
      <div
        className={cn(
          'flex size-full items-center justify-center overflow-hidden rounded-full border-[3px] border-ink shadow-sticker-sm',
          selected && 'ring-4 ring-sun',
        )}
        style={{ backgroundColor: color }}
      >
        <ChibiImage slug={slug} expression={expression} tenue={tenue} size={size * 0.92} bare className="mt-[6%]" />
      </div>
      {badge && (
        <span className="absolute -right-1 -bottom-1 flex size-[38%] items-center justify-center rounded-full border-2 border-ink bg-surface text-[0.7em]">
          {badge}
        </span>
      )}
    </motion.div>
  )
}
