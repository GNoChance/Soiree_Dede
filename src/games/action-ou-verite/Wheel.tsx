import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { fx } from '@/lib/feedback'
import { mood } from '@/features/soiree/players'
import { serverNow } from '@/features/soiree/useServerClock'
import type { PlayerInfo } from '../types'
import type { AovSpin } from './types'
import { sliceAt, spinEase, wheelFinalAngle } from './setup'

/** Durée de l'animation (= `_aov_const('spin')` côté SQL). */
export const SPIN_MS = 6000

const VIEW = 200
const R = 96
const C = VIEW / 2

/** Point sur le cercle, angle en degrés depuis le haut, sens horaire. */
function pt(deg: number, r = R) {
  const a = (deg * Math.PI) / 180
  return [C + r * Math.sin(a), C - r * Math.cos(a)] as const
}

function slicePath(i: number, n: number) {
  const s = 360 / n
  const [x1, y1] = pt(i * s)
  const [x2, y2] = pt((i + 1) * s)
  return `M${C},${C} L${x1},${y1} A${R},${R} 0 ${s > 180 ? 1 : 0} 1 ${x2},${y2} Z`
}

/**
 * Roue de la chance : une part par joueur (couleur du perso + chibi), pointeur
 * en haut. L'animation est calée sur l'horloge serveur (`spin.until`) : tous les
 * écrans tournent en même temps, et un joueur qui arrive en retard reprend en
 * cours de route. Tic-tic à chaque part franchie, ralentissement réaliste.
 */
export function Wheel({ players, spin, onDone, size = 300 }: { players: PlayerInfo[]; spin: AovSpin; onDone?: () => void; size?: number }) {
  const reduce = useReducedMotion()
  const n = Math.max(1, players.length)
  const index = Math.max(0, players.findIndex((p) => p.id === spin.target))
  const final = useMemo(() => wheelFinalAngle(n, index, spin.turns, spin.offset), [n, index, spin.turns, spin.offset])
  const wheelRef = useRef<HTMLDivElement>(null)
  const pointerRef = useRef<HTMLDivElement>(null)
  const [done, setDone] = useState(false)
  const doneRef = useRef(onDone)
  useEffect(() => {
    doneRef.current = onDone
  }, [onDone])

  useEffect(() => {
    const end = new Date(spin.until).getTime()
    const startAt = end - SPIN_MS
    let raf = 0
    let lastSlice = -1
    let lastTick = 0
    let finished = false

    const finish = () => {
      if (finished) return
      finished = true
      if (wheelRef.current) wheelRef.current.style.transform = `rotate(${final}deg)`
      if (pointerRef.current) pointerRef.current.style.transform = 'rotate(0deg)'
      setDone(true)
      doneRef.current?.()
    }

    if (reduce || end - serverNow() < 400) {
      finish()
      return
    }

    const frame = () => {
      const now = serverNow()
      const t = (now - startAt) / SPIN_MS
      const rot = final * spinEase(t)
      if (wheelRef.current) wheelRef.current.style.transform = `rotate(${rot}deg)`
      const sl = sliceAt(n, rot)
      const wall = performance.now()
      if (sl !== lastSlice) {
        if (lastSlice !== -1 && wall - lastTick > 45) {
          fx.tick()
          lastTick = wall
        }
        lastSlice = sl
      }
      // Le clapet du pointeur se soulève à chaque part puis retombe.
      if (pointerRef.current) {
        const k = Math.max(0, 1 - (wall - lastTick) / 140)
        pointerRef.current.style.transform = `rotate(${-24 * k}deg)`
      }
      if (t >= 1) finish()
      else raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [spin.until, final, n, reduce])

  const s = 360 / n
  const avatarSize = Math.round(size * (n <= 4 ? 0.22 : n <= 6 ? 0.19 : 0.15))

  return (
    <div className="relative mx-auto" style={{ width: size, height: size + 18 }}>
      {/* Pointeur */}
      <div ref={pointerRef} className="absolute top-0 left-1/2 z-20 -ml-4 origin-[50%_20%]" style={{ width: 32, height: 44 }}>
        <svg viewBox="0 0 32 44" className="size-full drop-shadow-[3px_3px_0_var(--ink)]">
          <path d="M16 42 L3 8 Q16 -4 29 8 Z" fill="#EF476F" stroke="var(--ink)" strokeWidth="3.5" strokeLinejoin="round" />
          <circle cx="16" cy="11" r="4" fill="#fff" stroke="var(--ink)" strokeWidth="2.5" />
        </svg>
      </div>

      <div className="absolute left-0" style={{ top: 18, width: size, height: size }}>
        {/* Ombre sticker */}
        <div className="absolute inset-0 translate-x-[5px] translate-y-[5px] rounded-full bg-ink" />
        <div ref={wheelRef} className="absolute inset-0 rounded-full will-change-transform" style={{ transform: 'rotate(0deg)' }}>
          <svg viewBox={`0 0 ${VIEW} ${VIEW}`} className="absolute inset-0 size-full">
            <circle cx={C} cy={C} r={R + 3} fill="var(--ink)" />
            {players.map((p, i) => (
              <path key={p.id} d={slicePath(i, n)} fill={p.color} stroke="var(--ink)" strokeWidth="2.5" strokeLinejoin="round" />
            ))}
            {/* Rayures claires une part sur deux pour le relief */}
            {players.map((p, i) =>
              i % 2 ? <path key={`h${p.id}`} d={slicePath(i, n)} fill="#ffffff" opacity="0.16" /> : null,
            )}
            {/* Clous sur le bord */}
            {players.map((p, i) => {
              const [x, y] = pt(i * s, R - 4)
              return <circle key={`c${p.id}`} cx={x} cy={y} r="3" fill="#fff" stroke="var(--ink)" strokeWidth="1.5" />
            })}
          </svg>
          {players.map((p, i) => {
            const mid = (i + 0.5) * s
            const [x, y] = pt(mid, R * 0.62)
            const win = done && i === index
            return (
              <div
                key={p.id}
                className="absolute flex flex-col items-center"
                style={{
                  left: `${(x / VIEW) * 100}%`,
                  top: `${(y / VIEW) * 100}%`,
                  transform: `translate(-50%, -50%) rotate(${mid}deg)`,
                }}
              >
                <motion.div animate={win ? { scale: [1, 1.35, 1.2] } : { scale: done ? 0.85 : 1, opacity: done ? 0.55 : 1 }} transition={{ duration: 0.5 }}>
                  <Avatar slug={p.slug} expression={win ? mood(p, 'shocked') : mood(p, 'happy')} size={avatarSize} />
                </motion.div>
              </div>
            )
          })}
        </div>
        {/* Moyeu */}
        <motion.div
          animate={done ? { scale: [1, 1.3, 1], rotate: [0, -15, 0] } : { scale: 1 }}
          transition={{ duration: 0.6 }}
          className="absolute top-1/2 left-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[3px] border-ink bg-sun text-3xl shadow-sticker-sm"
          style={{ width: size * 0.2, height: size * 0.2 }}
        >
          🎭
        </motion.div>
      </div>
    </div>
  )
}
