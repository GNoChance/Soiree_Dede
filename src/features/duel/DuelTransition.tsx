import { useEffect, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { FastForward } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ChibiImage } from '@/components/ui/ChibiImage'
import { mood, pickExpression } from '@/features/soiree/players'
import { fx, vibrate } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import type { PlayerInfo } from '@/games/types'
import { roundNameSingular } from './logic'
import type { DuelInfo, DuelSession } from './types'

export interface DuelTransitionProps {
  duel: DuelInfo
  session: DuelSession
  meId: string
  get: (id: string) => PlayerInfo
  colors: { a: string; b: string }
  /** ms restantes avant le début du duel. */
  left: number
  isHost: boolean
  pending: boolean
  onStart: () => void
  /** Panneau de paris (BetPanel) affiché sous l'affiche. */
  children?: ReactNode
}

/** Affiche « Prochain duel : X vs Y » (5 s, 8 s au premier), paris ouverts. */
export function DuelTransition({ duel, session, meId, get, colors, left, isHost, pending, onStart, children }: DuelTransitionProps) {
  const reduce = useReducedMotion()
  const a = get(duel.a)
  const b = get(duel.b)
  const meIn = meId === duel.a || meId === duel.b
  const secs = Math.ceil(left / 1000)
  const starter = get(duel.first)

  useEffect(() => {
    fx.whoosh()
    if (meIn) vibrate([40, 60, 40])
  }, [duel.no, meIn])
  useEffect(() => {
    if (secs > 0 && secs <= 3) fx.tick()
  }, [secs])

  const sub =
    session.mode === 'tournament' && session.bracket && duel.round != null
      ? `${roundNameSingular(duel.round, session.bracket.rounds.length)}${duel.replay ? ' · revanche après un nul !' : ''}`
      : session.mode === 'king'
        ? duel.no === 1
          ? 'Premier roi de la table ?'
          : `${get(duel.a).nickname} défend sa couronne`
        : session.best_of > 1
          ? `Au meilleur des ${session.best_of} manches`
          : 'Une manche, pas de deuxième chance'

  const side = (p: PlayerInfo, s: 'a' | 'b') => (
    <motion.div
      initial={reduce ? { opacity: 0 } : { x: s === 'a' ? -160 : 160, rotate: s === 'a' ? -25 : 25, opacity: 0 }}
      animate={{ x: 0, rotate: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 200, damping: 14, delay: s === 'a' ? 0.1 : 0.25 }}
      className="flex min-w-0 flex-1 flex-col items-center gap-1"
    >
      <div className="rounded-full border-[3px] border-ink p-1 shadow-sticker" style={{ background: colors[s] }}>
        <ChibiImage
          slug={p.slug}
          expression={s === 'a' ? pickExpression(p, 'cool', 'clin_oeil', 'joie') : mood(p, 'angry')}
          tenue={p.equippedTenue}
          size={104}
          bare
          className={cn(s === 'b' && '-scale-x-100')}
        />
      </div>
      <span className={cn('max-w-full truncate font-display text-xl font-extrabold', p.id === meId && 'text-grape')}>
        {p.id === meId ? 'Toi !' : p.nickname}
      </span>
    </motion.div>
  )

  return (
    <div className="flex flex-col gap-3">
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="sticker relative flex flex-col items-center gap-2 overflow-hidden bg-surface px-3 pt-3 pb-4 text-center"
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{ background: `linear-gradient(115deg, ${colors.a} 0 48%, ${colors.b} 52% 100%)` }}
          aria-hidden
        />
        <span className="relative rounded-full border-2 border-ink bg-sun px-3 font-display text-sm font-extrabold text-[#1f1b2e] uppercase">
          Prochain duel · n°{duel.no}
        </span>
        <span className="relative text-sm font-bold">{sub}</span>
        <div className="relative flex w-full items-center">
          {side(a, 'a')}
          <motion.span
            initial={reduce ? { opacity: 0 } : { scale: 4, rotate: -30, opacity: 0 }}
            animate={{ scale: 1, rotate: -8, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 400, damping: 12, delay: 0.45 }}
            className="font-display text-5xl font-extrabold text-tomato"
            style={{ textShadow: '3px 3px 0 var(--ink)' }}
          >
            VS
          </motion.span>
          {side(b, 'b')}
        </div>
        <p className="relative text-sm font-bold">
          {starter.id === meId ? 'Tu commences !' : `${starter.nickname} commence`}
          {meIn ? '' : ' · Fais tes paris !'}
        </p>
        <motion.span
          key={secs}
          initial={{ scale: 1.8, opacity: 0.4 }}
          animate={{ scale: 1, opacity: 1 }}
          className="relative font-display text-4xl leading-none font-extrabold tabular-nums"
        >
          {secs > 0 ? secs : 'GO !'}
        </motion.span>
      </motion.div>
      {children}
      {isHost && (
        <Button variant="secondary" size="sm" icon={<FastForward className="size-4" />} disabled={pending} onClick={onStart}>
          C’est parti tout de suite
        </Button>
      )}
    </div>
  )
}
