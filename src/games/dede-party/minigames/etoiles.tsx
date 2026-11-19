import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/lib/cn'
import { playSound, vibrate } from '@/lib/feedback'
import { serverNow } from '@/features/soiree/useServerClock'
import { DoneStrip } from '../Parts'
import type { EtoilesData } from '../types'
import { startedAt, useServerNow, type MgPlayProps, type MgTvProps } from './common'

interface Drop {
  id: number
  star: boolean
  /** Apparition (ms après le départ), colonne (%), durée de chute (ms). */
  t: number
  x: number
  dur: number
}

/** Générateur pseudo-aléatoire à graine (mulberry32) : la même pluie pour tout le monde. */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** `cap` étoiles + un tiers de tomates, réparties sur la durée (la dernière touche le sol avant la fin). */
export function makeRain(seed: number, cap: number, dur: number): Drop[] {
  const r = rng(seed)
  const n = cap + Math.round(cap * 0.4)
  const out: Drop[] = []
  for (let i = 0; i < n; i++) {
    const fall = 2200 + r() * 1200
    out.push({ id: i, star: i < cap, t: 300 + r() * Math.max(0, dur - fall - 500), x: 8 + r() * 84, dur: fall })
  }
  return out
}

const TOMATO_COST = 2

function Rain({ drops, elapsed, caught, onHit, big }: { drops: Drop[]; elapsed: number; caught: Set<number>; onHit?: (d: Drop) => void; big?: boolean }) {
  return (
    <>
      {drops.map((d) => {
        const p = (elapsed - d.t) / d.dur
        if (p < 0 || p > 1 || caught.has(d.id)) return null
        return (
          <button
            key={d.id}
            type="button"
            tabIndex={-1}
            onPointerDown={onHit ? () => onHit(d) : undefined}
            className={cn('absolute -translate-x-1/2 -translate-y-1/2 leading-none', big ? 'text-6xl' : 'p-2 text-5xl', !onHit && 'pointer-events-none')}
            style={{ left: `${d.x}%`, top: `${-6 + p * 106}%`, filter: 'drop-shadow(2px 2px 0 var(--ink))' }}
          >
            {d.star ? '⭐' : '🍅'}
          </button>
        )
      })}
    </>
  )
}

/** Pluie d'étoiles : 15 s pour taper les étoiles qui tombent, en évitant les tomates. */
export function EtoilesPlay({ mg, submit, submitted }: MgPlayProps) {
  const data = mg.data as unknown as EtoilesData
  const drops = useMemo(() => makeRain(data.seed, data.cap, data.dur), [data.seed, data.cap, data.dur])
  const start = startedAt(mg)
  const [elapsed, setElapsed] = useState(() => serverNow() - start)
  const [caught, setCaught] = useState<Set<number>>(() => new Set())
  const [score, setScore] = useState(0)
  const [flash, setFlash] = useState<{ k: number; txt: string; x: number } | null>(null)
  const sent = useRef(false)
  const over = elapsed >= data.dur

  useEffect(() => {
    if (over) return
    let raf = 0
    const loop = () => {
      setElapsed(serverNow() - start)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [start, over])

  useEffect(() => {
    if (!over || sent.current || submitted) return
    sent.current = true
    void submit({ score: Math.max(0, Math.min(data.cap, score)) })
  }, [over, score, submit, submitted, data.cap])

  const hit = (d: Drop) => {
    if (over || caught.has(d.id)) return
    setCaught((c) => new Set(c).add(d.id))
    if (d.star) {
      playSound('pop')
      setScore((s) => s + 1)
      setFlash({ k: d.id, txt: '+1', x: d.x })
    } else {
      playSound('fail')
      vibrate(60)
      setScore((s) => Math.max(0, s - TOMATO_COST))
      setFlash({ k: d.id, txt: `−${TOMATO_COST}`, x: d.x })
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between font-display text-2xl font-extrabold">
        <span>⭐ {score}</span>
        <span className="tabular-nums">{Math.max(0, Math.ceil((data.dur - elapsed) / 1000))} s</span>
      </div>
      <div className="sticker relative h-[min(62vh,480px)] touch-none overflow-hidden bg-[#1f1b4e]">
        {over ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-white">
            <span className="text-7xl">⭐</span>
            <span className="font-display text-4xl font-extrabold">{score} étoile{score > 1 ? 's' : ''} !</span>
          </div>
        ) : (
          <Rain drops={drops} elapsed={elapsed} caught={caught} onHit={hit} />
        )}
        <AnimatePresence>
          {flash && !over && (
            <motion.span
              key={flash.k}
              initial={{ y: 0, opacity: 1 }}
              animate={{ y: -40, opacity: 0 }}
              transition={{ duration: 0.7 }}
              onAnimationComplete={() => setFlash(null)}
              className="pointer-events-none absolute top-1/2 font-display text-3xl font-extrabold text-white"
              style={{ left: `${flash.x}%` }}
            >
              {flash.txt}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      <p className="text-center font-bold text-muted">Tape les ⭐ (+1), évite les 🍅 (−{TOMATO_COST}) !</p>
    </div>
  )
}

/** Télé : la même pluie (non cliquable) + qui a fini. */
export function EtoilesTv({ s, mg, get }: MgTvProps) {
  const data = mg.data as unknown as EtoilesData
  const drops = useMemo(() => makeRain(data.seed, data.cap, data.dur), [data.seed, data.cap, data.dur])
  const now = useServerNow(40)
  const elapsed = now - startedAt(mg)
  return (
    <div className="flex w-full flex-col gap-3">
      <div className="sticker relative h-[52vh] overflow-hidden bg-[#1f1b4e]">
        <Rain drops={drops} elapsed={elapsed} caught={new Set()} big />
        <span className="absolute right-3 top-2 font-display text-4xl font-extrabold text-white tabular-nums">{Math.max(0, Math.ceil((data.dur - elapsed) / 1000))} s</span>
      </div>
      <DoneStrip ids={s.players} done={mg.submitted} get={get} size={52} />
    </div>
  )
}
