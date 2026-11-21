import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router'
import { useReducedMotion } from 'framer-motion'
import { useNoelDecor } from './season'

/** Pages de jeu : aucun décor (on ne gêne jamais une partie). */
const hiddenOn = (path: string) => path.startsWith('/partie/') || path.startsWith('/solo/') || path.endsWith('/tele')

const BULBS = ['#ff4d4d', '#ffd23f', '#3ddc84', '#4da3ff']

/** Décor de Noël : guirlande en haut de l'écran + flocons discrets (canvas, ignore les clics). */
export function NoelDecor() {
  const on = useNoelDecor()
  const reduce = useReducedMotion()
  const { pathname } = useLocation()
  if (!on || hiddenOn(pathname)) return null
  return (
    <>
      <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[5] flex justify-around" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        {Array.from({ length: 14 }, (_, i) => (
          <span key={i} className="flex flex-col items-center">
            <span className="h-2 w-[2px] bg-ink/60" />
            <span
              className={reduce ? 'size-2.5 rounded-full border border-ink' : 'noel-bulb size-2.5 rounded-full border border-ink'}
              style={{ background: BULBS[i % BULBS.length], animationDelay: `${(i % 4) * 0.35}s` }}
            />
          </span>
        ))}
      </div>
      {!reduce && <Snow />}
    </>
  )
}

function Snow() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    const ctx = cv?.getContext('2d')
    if (!cv || !ctx) return
    let w = 0
    let h = 0
    const resize = () => {
      w = cv.width = window.innerWidth
      h = cv.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)
    const flakes = Array.from({ length: 28 }, () => ({
      x: Math.random() * w, y: Math.random() * h, r: 1.5 + Math.random() * 2.5, v: 0.4 + Math.random() * 0.8, p: Math.random() * 6,
    }))
    let raf = 0
    const tick = () => {
      if (!document.hidden) {
        ctx.clearRect(0, 0, w, h)
        ctx.fillStyle = 'rgba(255,255,255,0.85)'
        ctx.strokeStyle = 'rgba(31,27,46,0.25)'
        for (const f of flakes) {
          f.y += f.v
          f.p += 0.02
          f.x += Math.sin(f.p) * 0.4
          if (f.y > h + 6) { f.y = -6; f.x = Math.random() * w }
          ctx.beginPath()
          ctx.arc(f.x, f.y, f.r, 0, 6.3)
          ctx.fill()
          ctx.stroke()
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])
  return <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 z-[4] opacity-80" />
}
