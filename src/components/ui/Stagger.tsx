import type { ReactNode } from 'react'
import { motion, type HTMLMotionProps, type Variants } from 'framer-motion'

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
}
const item: Variants = {
  hidden: { opacity: 0, y: 40, scale: 0.85, rotate: -2 },
  show: { opacity: 1, y: 0, scale: 1, rotate: 0, transition: { type: 'spring', stiffness: 380, damping: 20 } },
}

/** Conteneur qui fait apparaitre ses <StaggerItem> en cascade. */
export function StaggerList({ children, ...rest }: { children: ReactNode } & Omit<HTMLMotionProps<'div'>, 'children' | 'variants'>) {
  return (
    <motion.div variants={container} initial="hidden" animate="show" {...rest}>
      {children}
    </motion.div>
  )
}

export function StaggerItem({ children, ...rest }: { children: ReactNode } & Omit<HTMLMotionProps<'div'>, 'children' | 'variants'>) {
  return (
    <motion.div variants={item} {...rest}>
      {children}
    </motion.div>
  )
}
