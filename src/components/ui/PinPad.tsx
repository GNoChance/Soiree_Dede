import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, useAnimationControls } from 'framer-motion'
import { Delete } from 'lucide-react'
import { cn } from '@/lib/cn'
import { fx } from '@/lib/feedback'

export interface PinPadProps {
  /** Appele quand le code est complet. Retourner `false` (ou throw) = erreur : secousse + reset. */
  onComplete: (pin: string) => void | boolean | Promise<void | boolean>
  length?: number
  disabled?: boolean
  /** Message d'erreur externe (une nouvelle valeur non nulle declenche aussi la secousse) */
  error?: string | null
  className?: string
}

export function PinPad({ onComplete, length = 4, disabled, error, className }: PinPadProps) {
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const controls = useAnimationControls()
  const lastError = useRef<string | null | undefined>(null)

  const shake = useCallback(async () => {
    fx.fail()
    await controls.start({ x: [0, -16, 16, -12, 12, -6, 6, 0], transition: { duration: 0.45 } })
    setPin('')
  }, [controls])

  useEffect(() => {
    if (error && error !== lastError.current) void shake()
    lastError.current = error
  }, [error, shake])

  const submit = async (code: string) => {
    setBusy(true)
    try {
      const res = await onComplete(code)
      if (res === false) await shake()
    } catch {
      await shake()
    } finally {
      setBusy(false)
    }
  }

  const press = (d: string) => {
    if (disabled || busy || pin.length >= length) return
    fx.tick()
    const next = pin + d
    setPin(next)
    if (next.length === length) void submit(next)
  }
  const back = () => {
    if (disabled || busy) return
    fx.tick()
    setPin((p) => p.slice(0, -1))
  }

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

  return (
    <div className={cn('mx-auto w-full max-w-xs select-none', className)}>
      <motion.div animate={controls} className="mb-5 flex justify-center gap-4" aria-live="polite">
        {Array.from({ length }).map((_, i) => {
          const filled = i < pin.length
          return (
            <motion.span
              key={i}
              animate={{ scale: filled ? [1, 1.35, 1] : 1 }}
              transition={{ duration: 0.25 }}
              className={cn(
                'size-6 rounded-full border-[3px] border-ink shadow-sticker-sm',
                filled ? (error ? 'bg-tomato' : 'bg-sun') : 'bg-surface',
              )}
            />
          )
        })}
      </motion.div>
      {error && <p className="mb-3 text-center font-display text-base font-bold text-tomato">{error}</p>}
      <div className="grid grid-cols-3 gap-3">
        {keys.map((k) => (
          <Key key={k} onClick={() => press(k)} disabled={disabled || busy}>{k}</Key>
        ))}
        <span />
        <Key onClick={() => press('0')} disabled={disabled || busy}>0</Key>
        <Key onClick={back} disabled={disabled || busy} aria-label="Effacer" tone="muted">
          <Delete className="size-7" strokeWidth={2.5} />
        </Key>
      </div>
    </div>
  )
}

function Key({
  children, onClick, disabled, tone, ...rest
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  tone?: 'muted'
  'aria-label'?: string
}) {
  return (
    <motion.button
      type="button"
      whileTap={{ x: 3, y: 3, scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 600, damping: 18 }}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex aspect-[4/3] items-center justify-center rounded-card border-[3px] border-ink text-3xl font-extrabold shadow-sticker transition-shadow duration-75 active:shadow-none-sticker disabled:opacity-60',
        tone === 'muted' ? 'bg-sunk text-muted' : 'bg-surface text-text',
      )}
      {...rest}
    >
      {children}
    </motion.button>
  )
}
