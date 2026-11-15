import { useMotionValue, useReducedMotion, useSpring, useTransform } from 'framer-motion'
import type { PointerEvent } from 'react'

/** Inclinaison 3D au toucher / survol. Spread `style` + handlers sur un motion.* */
export function useTilt(max = 10) {
  const reduce = useReducedMotion()
  const px = useMotionValue(0)
  const py = useMotionValue(0)
  const sx = useSpring(px, { stiffness: 300, damping: 18 })
  const sy = useSpring(py, { stiffness: 300, damping: 18 })
  const rotateY = useTransform(sx, [-0.5, 0.5], [-max, max])
  const rotateX = useTransform(sy, [-0.5, 0.5], [max, -max])

  const move = (e: PointerEvent<HTMLElement>) => {
    if (reduce) return
    const r = e.currentTarget.getBoundingClientRect()
    px.set((e.clientX - r.left) / r.width - 0.5)
    py.set((e.clientY - r.top) / r.height - 0.5)
  }
  const reset = () => {
    px.set(0)
    py.set(0)
  }

  return {
    style: { rotateX, rotateY, transformPerspective: 700 },
    handlers: { onPointerMove: move, onPointerDown: move, onPointerLeave: reset, onPointerUp: reset, onPointerCancel: reset },
  }
}
