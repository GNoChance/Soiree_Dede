import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { vibrate } from '@/lib/feedback'

export const HOLD_MS = 600

/**
 * Bouton à appui long (≈ 0,6 s) : une jauge se remplit pendant l'appui, l'action part à la fin ;
 * relâcher avant annule. Évite les appels accidentels sans confirmation (c'est un jeu de vitesse).
 * Clavier : Entrée / Espace maintenus.
 */
export function HoldButton({
  children,
  hint,
  background,
  color,
  onTrigger,
  disabled,
  holdMs = HOLD_MS,
  className,
  labelClass = 'text-3xl',
  ariaLabel,
}: {
  children: ReactNode
  hint?: ReactNode
  background: string
  color: string
  onTrigger: () => void
  disabled?: boolean
  holdMs?: number
  className?: string
  labelClass?: string
  ariaLabel?: string
}) {
  const [p, setP] = useState(0)
  const raf = useRef(0)
  const t0 = useRef(0)
  const trigger = useRef(onTrigger)
  useEffect(() => {
    trigger.current = onTrigger
  }, [onTrigger])
  useEffect(() => () => cancelAnimationFrame(raf.current), [])

  const stop = () => {
    cancelAnimationFrame(raf.current)
    t0.current = 0
    setP(0)
  }
  const start = () => {
    if (disabled || t0.current) return
    t0.current = performance.now()
    vibrate(10)
    const loop = () => {
      const q = (performance.now() - t0.current) / holdMs
      if (q >= 1) {
        t0.current = 0
        setP(1)
        vibrate([30, 30, 60])
        trigger.current()
        window.setTimeout(() => setP(0), 250)
        return
      }
      setP(q)
      raf.current = requestAnimationFrame(loop)
    }
    raf.current = requestAnimationFrame(loop)
  }

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={ariaLabel}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId)
        start()
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onPointerLeave={stop}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) start()
      }}
      onKeyUp={stop}
      style={{ background, color, touchAction: 'none', WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none', transform: p > 0 && p < 1 ? `scale(${1 - p * 0.04})` : undefined }}
      className={cn(
        'relative flex min-h-[5rem] min-w-0 flex-1 basis-0 select-none flex-col items-center justify-center overflow-hidden rounded-bubble border-[3px] border-ink font-display font-extrabold shadow-sticker transition-transform disabled:opacity-50',
        className,
      )}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 bg-black/30" style={{ width: `${p * 100}%` }} />
      <span className={cn('relative whitespace-nowrap leading-none tracking-wide', labelClass)}>{children}</span>
      {hint && <span className="relative mt-1 text-xs font-bold opacity-90">{hint}</span>}
    </button>
  )
}
