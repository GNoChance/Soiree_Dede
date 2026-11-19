import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/cn'
import { fx, playSound, vibrate } from '@/lib/feedback'
import { serverNow } from '@/features/soiree/useServerClock'
import { DoneStrip } from '../Parts'
import type { BuzzerData } from '../types'
import { fmtSec, useServerNow, type MgPlayProps, type MgTvProps } from './common'

/** Le Buzzer : l'écran passe au vert à un moment surprise, tape le plus vite possible. */
export function BuzzerPlay({ mg, submit, submitted }: MgPlayProps) {
  const data = mg.data as unknown as BuzzerData
  const go = data.go_at ? new Date(data.go_at).getTime() : Number.POSITIVE_INFINITY
  const [green, setGreen] = useState(false)
  const [result, setResult] = useState<{ ms: number } | { false_start: true } | null>(null)
  const goPerf = useRef<number | null>(null)

  // Bascule au vert pile à l'heure serveur (boucle d'animation pour la précision).
  useEffect(() => {
    let raf = 0
    const loop = () => {
      const late = serverNow() - go
      if (late >= 0) {
        goPerf.current = performance.now() - late
        setGreen(true)
        vibrate(30)
        return
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [go])

  const tap = () => {
    if (result || submitted) return
    if (!green || goPerf.current === null) {
      fx.fail()
      setResult({ false_start: true })
      void submit({ false_start: true })
      return
    }
    const ms = Math.round(performance.now() - goPerf.current)
    playSound('success')
    setResult({ ms })
    void submit({ ms })
  }

  const done = result ?? (submitted ? { ms: -1 } : null)
  return (
    <div className="flex flex-col gap-3">
      <motion.button
        type="button"
        onPointerDown={tap}
        animate={green && !done ? { scale: [1, 1.04, 1] } : { scale: 1 }}
        transition={{ repeat: green && !done ? Infinity : 0, duration: 0.3 }}
        className={cn(
          'flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-bubble border-4 border-ink font-display font-extrabold text-[#1f1b2e] shadow-sticker-lg select-none',
          done ? 'bg-surface text-text' : green ? 'bg-mint' : 'bg-tomato text-white',
        )}
      >
        {!done && !green && (
          <>
            <span className="text-7xl">✋</span>
            <span className="text-3xl">Attends le vert…</span>
          </>
        )}
        {!done && green && (
          <>
            <span className="text-8xl">⚡</span>
            <span className="text-5xl">TAPE !</span>
          </>
        )}
        {done && 'false_start' in done && (
          <>
            <span className="text-7xl">😬</span>
            <span className="text-3xl">Faux départ !</span>
          </>
        )}
        {done && 'ms' in done && (
          <>
            <span className="text-7xl">⚡</span>
            <span className="text-4xl">{done.ms >= 0 ? fmtSec(done.ms, 3) : 'Envoyé ✔'}</span>
          </>
        )}
      </motion.button>
      {!done && <p className="text-center font-bold text-muted">Si tu tapes avant le vert : faux départ, tu finis dernier !</p>}
    </div>
  )
}

export function BuzzerTv({ s, mg, get }: MgTvProps) {
  const data = mg.data as unknown as BuzzerData
  const now = useServerNow(50)
  const green = data.go_at ? now >= new Date(data.go_at).getTime() : false
  return (
    <div className="flex w-full flex-col items-center gap-4">
      <div className={cn('flex h-64 w-full items-center justify-center rounded-bubble border-4 border-ink font-display text-6xl font-extrabold shadow-sticker-lg', green ? 'bg-mint text-[#1f1b2e]' : 'bg-tomato text-white')}>
        {green ? '⚡ TAPEZ !' : '✋ Attendez le vert…'}
      </div>
      <DoneStrip ids={s.players} done={mg.submitted} get={get} size={56} />
    </div>
  )
}
