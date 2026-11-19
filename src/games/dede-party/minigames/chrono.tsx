import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/Button'
import { fx, playSound } from '@/lib/feedback'
import { useCountdown } from '@/features/soiree/useServerClock'
import { DoneStrip } from '../Parts'
import type { ChronoData } from '../types'
import { fmtSec, type MgPlayProps, type MgTvProps } from './common'

/** Top chrono : lance le chrono, il disparaît après 3 s… arrête-le pile à 7,00 s. */
export function ChronoPlay({ mg, submit, submitted }: MgPlayProps) {
  const data = mg.data as unknown as ChronoData
  const [t0, setT0] = useState<number | null>(null)
  const [now, setNow] = useState(0)
  const [stopped, setStopped] = useState<number | null>(null)
  const sent = useRef(false)

  useEffect(() => {
    if (t0 === null || stopped !== null) return
    let raf = 0
    const loop = () => {
      setNow(performance.now())
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [t0, stopped])

  const elapsed = t0 === null ? 0 : (stopped ?? now - t0)
  const hidden = t0 !== null && stopped === null && elapsed >= data.hide_after

  const stop = () => {
    if (t0 === null || stopped !== null || sent.current) return
    const ms = Math.round(performance.now() - t0)
    setStopped(ms)
    sent.current = true
    fx.success()
    void submit({ ms })
  }

  // Filet : chrono oublié au-delà de 15 s -> arrêté d'office.
  useEffect(() => {
    if (t0 !== null && stopped === null && elapsed > 15000) stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed])

  const diff = stopped !== null ? stopped - data.target : null
  return (
    <div className="flex flex-col items-center gap-4">
      <p className="text-center font-display text-xl font-extrabold">
        Objectif : <span className="text-tangerine">{fmtSec(data.target)}</span>
      </p>
      <motion.div
        animate={hidden ? { rotate: [-2, 2, -2] } : { rotate: 0 }}
        transition={{ repeat: hidden ? Infinity : 0, duration: 0.4 }}
        className="sticker flex h-36 w-full items-center justify-center bg-surface font-display text-6xl font-extrabold tabular-nums"
      >
        {hidden ? '❓,❓❓ s' : fmtSec(elapsed)}
      </motion.div>
      {hidden && <p className="font-display text-lg font-extrabold text-muted">Le chrono s’est caché ! Compte dans ta tête…</p>}
      {stopped !== null || submitted ? (
        <div className="sticker w-full bg-mint p-3 text-center text-[#1f1b2e]">
          <p className="font-display text-2xl font-extrabold">{stopped !== null ? `Arrêté à ${fmtSec(stopped)}` : 'Envoyé ✔'}</p>
          {diff !== null && <p className="font-bold">{diff === 0 ? 'PILE ! 🤯' : `${diff > 0 ? 'Trop tard' : 'Trop tôt'} de ${fmtSec(Math.abs(diff))}`}</p>}
        </div>
      ) : t0 === null ? (
        <Button
          size="lg"
          fullWidth
          className="min-h-24 text-3xl"
          onClick={() => {
            playSound('tick')
            setT0(performance.now())
            setNow(performance.now())
          }}
        >
          ▶ Lancer le chrono
        </Button>
      ) : (
        <Button size="lg" variant="danger" fullWidth className="min-h-24 text-4xl" silent onPointerDown={stop}>
          ✋ STOP !
        </Button>
      )}
    </div>
  )
}

export function ChronoTv({ s, mg, get }: MgTvProps) {
  const data = mg.data as unknown as ChronoData
  const left = useCountdown(s.deadline)
  return (
    <div className="flex w-full flex-col items-center gap-4 text-center">
      <p className="font-display text-7xl font-extrabold">⏱️ {fmtSec(data.target)}</p>
      <p className="font-display text-3xl font-extrabold text-muted">Chacun lance son chrono… qui l’arrêtera pile ?</p>
      <p className="font-display text-5xl font-extrabold tabular-nums">{Math.ceil(left / 1000)} s</p>
      <DoneStrip ids={s.players} done={mg.submitted} get={get} size={56} />
    </div>
  )
}
