import { useLayoutEffect, useRef } from 'react'
import { useLocation, useOutlet } from 'react-router'
import { AnimatePresence, motion, type Variants } from 'framer-motion'
import { tabIndex } from './BottomNav'
import { releaseScrollIfIdle } from '@/components/ui/Modal'

const variants: Variants = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 70, scale: 0.92, rotate: dir * 2 }),
  center: {
    opacity: 1, x: 0, scale: 1, rotate: 0,
    transition: { type: 'spring', stiffness: 320, damping: 24 },
  },
  exit: (dir: number) => ({
    opacity: 0, x: dir * -70, scale: 0.92, rotate: dir * -2,
    transition: { duration: 0.16 },
  }),
}

/** <Outlet/> avec transition de page (slide + rebond), direction selon l'ordre des onglets. */
export function AnimatedOutlet({ className }: { className?: string }) {
  const { pathname } = useLocation()
  const outlet = useOutlet()
  const prev = useRef(tabIndex(pathname))
  const idx = tabIndex(pathname)
  const dir = idx === -1 || prev.current === -1 || idx === prev.current ? 1 : idx > prev.current ? 1 : -1

  useLayoutEffect(() => {
    prev.current = idx
  }, [idx])

  // Une page ne doit jamais hériter d'un défilement bloqué par une modale de la page précédente.
  useLayoutEffect(() => {
    releaseScrollIfIdle()
  }, [pathname])

  return (
    <AnimatePresence mode="wait" initial={false} custom={dir}>
      <motion.div
        key={pathname}
        custom={dir}
        variants={variants}
        initial="enter"
        animate="center"
        exit="exit"
        className={className}
      >
        {outlet}
      </motion.div>
    </AnimatePresence>
  )
}
