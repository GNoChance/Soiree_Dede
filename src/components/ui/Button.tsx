import { forwardRef, type ReactNode } from 'react'
import { motion, type HTMLMotionProps } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { fx } from '@/lib/feedback'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
  loading?: boolean
  icon?: ReactNode
  /** Desactive le son/haptique du clic */
  silent?: boolean
  children?: ReactNode
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-sun text-[#1f1b2e] shadow-sticker active:shadow-none-sticker',
  secondary: 'bg-surface text-text shadow-sticker active:shadow-none-sticker',
  danger: 'bg-tomato text-white shadow-sticker active:shadow-none-sticker',
  ghost: 'bg-transparent text-text border-transparent shadow-none',
}
const SIZES: Record<ButtonSize, string> = {
  sm: 'min-h-10 px-4 text-base rounded-chip',
  md: 'min-h-12 px-6 text-lg rounded-card',
  lg: 'min-h-16 px-8 text-2xl rounded-bubble',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', fullWidth, loading, icon, silent, className, children, disabled, onClick, ...rest },
  ref,
) {
  const isGhost = variant === 'ghost'
  return (
    <motion.button
      ref={ref}
      whileHover={disabled ? undefined : { scale: 1.04, rotate: -1 }}
      whileTap={disabled ? undefined : isGhost ? { scale: 0.94 } : { x: 4, y: 4, scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 520, damping: 16 }}
      disabled={disabled || loading}
      onClick={(e) => {
        if (!silent) fx.pop()
        onClick?.(e)
      }}
      className={cn(
        'inline-flex select-none items-center justify-center gap-2 border-[3px] border-ink font-display font-extrabold',
        'transition-shadow duration-75 disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-5 animate-spin" /> : icon}
      {children}
    </motion.button>
  )
})
