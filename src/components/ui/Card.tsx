import type { ReactNode } from 'react'
import { motion, type HTMLMotionProps } from 'framer-motion'
import { cn } from '@/lib/cn'
import { useTilt } from '@/hooks/useTilt'
import { fx } from '@/lib/feedback'

export interface CardProps extends Omit<HTMLMotionProps<'div'>, 'children'> {
  /** Couleur de fond (any CSS color ou var). Defaut : surface */
  accent?: string
  /** Inclinaison 3D au toucher */
  tilt?: boolean
  /** Rebond + press au clic (si onClick) */
  interactive?: boolean
  children?: ReactNode
}

export function Card({ accent, tilt, interactive, className, style, onClick, children, ...rest }: CardProps) {
  const t = useTilt(8)
  const clickable = Boolean(onClick) || interactive
  return (
    <motion.div
      {...(tilt ? t.handlers : {})}
      whileTap={clickable ? { scale: 0.97 } : undefined}
      whileHover={clickable ? { y: -3 } : undefined}
      transition={{ type: 'spring', stiffness: 400, damping: 18 }}
      onClick={
        onClick
          ? (e) => {
              fx.pop()
              onClick(e)
            }
          : undefined
      }
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={cn(
        'sticker bg-surface p-4 text-text',
        clickable && 'cursor-pointer',
        className,
      )}
      style={{ ...(accent ? { backgroundColor: accent } : null), ...(tilt ? t.style : null), ...style }}
      {...rest}
    >
      {children}
    </motion.div>
  )
}
