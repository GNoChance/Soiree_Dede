import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Check, Crown } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { ChibiImage } from '@/components/ui/ChibiImage'
import { Modal } from '@/components/ui/Modal'
import { burst, confettiRain } from '@/components/ui/confetti'
import { getExpression } from '@/data/expressions'
import { fx } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import type { PlayerInfo } from '@/games/types'

/* -------------------------------------------------------------------------- */
/* Avatar de joueur avec pseudo                                                */
/* -------------------------------------------------------------------------- */

export interface PlayerTokenProps {
  player: PlayerInfo
  expression?: string
  size?: number
  host?: boolean
  bounce?: boolean
  /** Décalage de l'animation de rebond (s) */
  delay?: number
  selected?: boolean
  dimmed?: boolean
  label?: ReactNode
  badge?: ReactNode
  className?: string
}

/** Avatar + pseudo, couronne pour l'hôte. */
export function PlayerToken({ player, expression, size = 64, host, bounce, delay = 0, selected, dimmed, label, badge, className }: PlayerTokenProps) {
  const reduce = useReducedMotion()
  return (
    <div className={cn('flex flex-col items-center gap-1 transition-opacity', dimmed && 'opacity-40 grayscale', className)}>
      <motion.div
        className="relative"
        animate={bounce && !reduce ? { y: [0, -8, 0], rotate: [0, -3, 3, 0] } : undefined}
        transition={bounce ? { repeat: Infinity, duration: 1.3, delay, ease: 'easeInOut' } : undefined}
      >
        {host && (
          <motion.span
            className="absolute -top-4 left-1/2 z-10 -translate-x-1/2 text-sun drop-shadow-[2px_2px_0_var(--ink)]"
            animate={reduce ? undefined : { rotate: [-12, 12, -12] }}
            transition={{ repeat: Infinity, duration: 2.2, ease: 'easeInOut' }}
            aria-label="Hôte"
          >
            <Crown className="size-6 fill-sun" strokeWidth={2.5} />
          </motion.span>
        )}
        <Avatar slug={player.slug} expression={expression ?? player.equipped} size={size} selected={selected} badge={badge} />
      </motion.div>
      <span className="max-w-[5.5rem] truncate font-display text-sm leading-tight font-extrabold">{label ?? player.nickname}</span>
    </div>
  )
}

/** Avatar cochable (sélection de joueurs). */
export function CheckableToken({ player, checked, locked, onToggle, size = 64 }: { player: PlayerInfo; checked: boolean; locked?: boolean; onToggle: () => void; size?: number }) {
  return (
    <motion.button
      type="button"
      onClick={() => {
        if (locked) return
        fx.pop()
        onToggle()
      }}
      whileTap={locked ? undefined : { scale: 0.85, rotate: -6 }}
      animate={checked ? { scale: 1, rotate: 0 } : { scale: 0.92, rotate: 0 }}
      transition={{ type: 'spring', stiffness: 500, damping: 15 }}
      aria-pressed={checked}
      aria-label={player.nickname}
      className={cn('relative flex flex-col items-center gap-1 rounded-card p-1', !checked && 'opacity-50 grayscale')}
    >
      <Avatar slug={player.slug} expression={checked ? player.equipped : 'dodo'} size={size} selected={checked} />
      <AnimatePresence>
        {checked && (
          <motion.span
            initial={{ scale: 0, rotate: -90 }}
            animate={{ scale: 1, rotate: 0 }}
            exit={{ scale: 0, rotate: 90 }}
            transition={{ type: 'spring', stiffness: 600, damping: 14 }}
            className="absolute top-0 right-0 flex size-6 items-center justify-center rounded-full border-2 border-ink bg-mint shadow-sticker-sm"
          >
            <Check className="size-4 text-[#1f1b2e]" strokeWidth={4} />
          </motion.span>
        )}
      </AnimatePresence>
      <span className="max-w-[5rem] truncate font-display text-sm font-extrabold">{player.nickname}</span>
    </motion.button>
  )
}

/* -------------------------------------------------------------------------- */
/* Confirmation                                                                */
/* -------------------------------------------------------------------------- */

export function ConfirmModal({
  open, onClose, onConfirm, title, children, confirmLabel = 'Confirmer', danger, loading,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  children?: ReactNode
  confirmLabel?: string
  danger?: boolean
  loading?: boolean
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="mb-5 text-lg">{children}</div>
      <div className="flex gap-3">
        <Button variant="secondary" className="flex-1" onClick={onClose}>
          Non
        </Button>
        <Button variant={danger ? 'danger' : 'primary'} className="flex-1" onClick={onConfirm} loading={loading}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  )
}

/* -------------------------------------------------------------------------- */
/* Compte à rebours de lancement de partie (3-2-1)                             */
/* -------------------------------------------------------------------------- */

export function LaunchCountdown({ emoji, name, color, onDone }: { emoji: string; name: string; color: string; onDone: () => void }) {
  const reduce = useReducedMotion()
  const [step, setStep] = useState(0) // 0 = titre, 1..3 = 3,2,1, 4 = Go
  const doneRef = useRef(onDone)
  useEffect(() => {
    doneRef.current = onDone
  })

  useEffect(() => {
    const dt = reduce ? 350 : 750
    fx.whoosh()
    const timers: number[] = []
    for (let i = 1; i <= 4; i++) {
      timers.push(
        window.setTimeout(() => {
          setStep(i)
          if (i < 4) fx.tick()
          else {
            fx.success()
            burst({ x: 0.5, y: 0.55 }, 120)
          }
        }, dt * i),
      )
    }
    timers.push(window.setTimeout(() => doneRef.current(), dt * 4 + (reduce ? 250 : 650)))
    return () => timers.forEach(clearTimeout)
  }, [reduce])

  const label = step === 0 ? null : step < 4 ? String(4 - step) : 'Go !'
  return createPortal(
    <motion.div
      className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-6 overflow-hidden"
      style={{ backgroundColor: color }}
      initial={{ clipPath: 'circle(0% at 50% 50%)' }}
      animate={{ clipPath: 'circle(150% at 50% 50%)' }}
      transition={{ duration: reduce ? 0 : 0.5, ease: 'easeOut' }}
    >
      {/* rayons qui tournent */}
      {!reduce && (
        <motion.div
          className="pointer-events-none absolute inset-[-50%] opacity-20"
          style={{ background: 'repeating-conic-gradient(#fff 0deg 12deg, transparent 12deg 30deg)' }}
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 12, ease: 'linear' }}
        />
      )}
      <motion.div
        className="relative text-8xl"
        initial={{ scale: 0, rotate: -180 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 12 }}
      >
        {emoji}
      </motion.div>
      <motion.h1
        className="relative text-center text-5xl text-[#1f1b2e] drop-shadow-[3px_3px_0_#fff]"
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.15, type: 'spring', stiffness: 300, damping: 16 }}
      >
        {name}
      </motion.h1>
      <div className="relative h-40">
        <AnimatePresence mode="popLayout">
          {label && (
            <motion.span
              key={label}
              className="block font-display text-[9rem] leading-none font-extrabold text-white [-webkit-text-stroke:5px_#1f1b2e] [paint-order:stroke]"
              initial={{ scale: 3, opacity: 0, rotate: -20 }}
              animate={{ scale: 1, opacity: 1, rotate: 0 }}
              exit={{ scale: 0.3, opacity: 0, rotate: 20 }}
              transition={{ type: 'spring', stiffness: 400, damping: 14 }}
            >
              {label}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </motion.div>,
    document.body,
  )
}

/* -------------------------------------------------------------------------- */
/* Déblocage d'expression : carte qui se retourne                              */
/* -------------------------------------------------------------------------- */

function FlipCard({ slug, expression, delay }: { slug: string; expression: string; delay: number }) {
  const reduce = useReducedMotion()
  const [flipped, setFlipped] = useState(Boolean(reduce))
  useEffect(() => {
    const t = window.setTimeout(() => {
      setFlipped(true)
      fx.fanfare()
      burst({ x: 0.5, y: 0.45 }, 110)
    }, reduce ? 0 : delay)
    return () => clearTimeout(t)
  }, [delay, reduce])
  const def = getExpression(expression)
  return (
    <div className="h-64 w-48 [perspective:900px]">
      <motion.div
        className="relative size-full [transform-style:preserve-3d]"
        animate={{ rotateY: flipped ? 180 : 0 }}
        transition={{ type: 'spring', stiffness: 120, damping: 14 }}
      >
        <div className="sticker absolute inset-0 flex items-center justify-center bg-grape text-7xl [backface-visibility:hidden]">
          <motion.span animate={reduce ? undefined : { scale: [1, 1.15, 1] }} transition={{ repeat: Infinity, duration: 0.6 }}>
            🎁
          </motion.span>
        </div>
        <div className="sticker absolute inset-0 flex [transform:rotateY(180deg)] flex-col items-center justify-center gap-2 bg-sun p-3 text-[#1f1b2e] [backface-visibility:hidden]">
          <ChibiImage slug={slug} expression={expression} size={140} />
          <span className="font-display text-2xl font-extrabold">
            {def?.emoji} {def?.label ?? expression}
          </span>
        </div>
      </motion.div>
    </div>
  )
}

/**
 * Révèle mes nouvelles expressions (une carte à la fois) et liste celles des autres.
 * `unlocks` = new_unlocks du serveur ({profile_id: [expr]}).
 */
export function UnlockReveal({
  unlocks, meId, players, onClose, delay = 600,
}: {
  unlocks: Record<string, string[]> | null | undefined
  meId: string
  players: Record<string, PlayerInfo>
  onClose: () => void
  delay?: number
}) {
  const mine = unlocks?.[meId] ?? []
  const others = Object.entries(unlocks ?? {}).filter(([id, list]) => id !== meId && list.length)
  const [idx, setIdx] = useState(0)
  const me = players[meId]
  const open = mine.length > 0 || others.length > 0

  useEffect(() => {
    if (mine.length) confettiRain(2200)
  }, [mine.length])

  if (!open) return null
  const current = mine[idx]
  return (
    <Modal open onClose={onClose} title={mine.length ? 'Nouvelle expression débloquée !' : 'Déblocages'}>
      <div className="flex flex-col items-center gap-4">
        {current && me && <FlipCard key={current} slug={me.slug} expression={current} delay={idx === 0 ? delay : 250} />}
        {mine.length > 1 && (
          <p className="font-display font-extrabold text-muted">
            {idx + 1} / {mine.length}
          </p>
        )}
        {others.length > 0 && (
          <div className="w-full rounded-card border-2 border-ink/30 bg-sunk p-3">
            <p className="mb-2 font-display font-extrabold">Chez les autres :</p>
            <ul className="flex flex-col gap-1">
              {others.map(([id, list]) => (
                <li key={id} className="flex items-center gap-2">
                  {players[id] && <Avatar slug={players[id].slug} expression={list[0]} size={32} />}
                  <span className="font-bold">
                    {players[id]?.nickname ?? '?'} : {list.map((e) => getExpression(e)?.label ?? e).join(', ')}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {idx < mine.length - 1 ? (
          <Button fullWidth onClick={() => setIdx((i) => i + 1)}>
            Suivante !
          </Button>
        ) : (
          <Button fullWidth onClick={onClose}>
            Trop bien !
          </Button>
        )}
      </div>
    </Modal>
  )
}

/* -------------------------------------------------------------------------- */
/* Divers                                                                      */
/* -------------------------------------------------------------------------- */

/** Pastille « x/y ont voté » avec avatars qui s'allument. */
export function VoterStrip({ ids, voters, players, label = 'ont voté' }: { ids: string[]; voters: string[]; players: Record<string, PlayerInfo>; label?: string }) {
  const set = new Set(voters)
  return (
    <div className="sticker flex flex-col gap-2 bg-surface p-3">
      <div className="flex items-center justify-between">
        <span className="font-display text-lg font-extrabold">
          <motion.span key={voters.length} initial={{ scale: 1.8, color: '#EF476F' }} animate={{ scale: 1, color: 'var(--text)' }} className="inline-block">
            {voters.length}
          </motion.span>
          /{ids.length} {label}
        </span>
        <div className="h-3 w-24 overflow-hidden rounded-full border-2 border-ink bg-sunk">
          <motion.div className="h-full bg-mint" animate={{ width: `${ids.length ? (voters.length / ids.length) * 100 : 0}%` }} />
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {ids.map((id) => {
          const p = players[id]
          const on = set.has(id)
          return (
            <motion.div key={id} animate={on ? { scale: [1, 1.3, 1], opacity: 1 } : { scale: 1, opacity: 0.35 }} transition={{ duration: 0.35 }} className={cn(!on && 'grayscale')}>
              {p && <Avatar slug={p.slug} expression={on ? 'joie' : 'reflexion'} size={34} badge={on ? '✓' : undefined} />}
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}

/** Gros titre qui « tombe » façon sticker. */
export function DropCard({ children, k, accent = 'var(--surface)', className }: { children: ReactNode; k: string | number; accent?: string; className?: string }) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={k}
        className={cn('sticker p-5 text-center', className)}
        style={{ backgroundColor: accent }}
        initial={{ y: -260, rotate: -14, scale: 0.6, opacity: 0 }}
        animate={{ y: 0, rotate: -1.5, scale: 1, opacity: 1 }}
        exit={{ y: 200, rotate: 10, opacity: 0, transition: { duration: 0.2 } }}
        transition={{ type: 'spring', stiffness: 260, damping: 13 }}
        onAnimationStart={() => fx.whoosh()}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
