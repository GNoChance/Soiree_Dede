import { useEffect, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { FastForward } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ChibiImage } from '@/components/ui/ChibiImage'
import { pickExpression } from '@/features/soiree/players'
import { fx, vibrate } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import type { PlayerInfo } from '@/games/types'
import { bracketPath, modeInfo, roundNameSingular } from './logic'
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
  /** Grand format (mode télé) : têtes géantes, pas de bouton. */
  tv?: boolean
  /** Diamètre des têtes en px (défaut 118 ; mode télé : selon l'écran). */
  headSize?: number
  /** Panneau de paris (BetPanel) affiché sous l'affiche. */
  children?: ReactNode
}

/**
 * Affiche de combat « Prochain duel : X vs Y » (5 s, 8 s au premier), paris
 * ouverts : deux grosses têtes face à face, VS en éclair, fiche de chaque
 * duelliste (bilan de la session, parcours dans le tournoi), compte à rebours.
 */
export function DuelTransition({ duel, session, meId, get, colors, left, isHost, pending, onStart, tv, headSize = 118, children }: DuelTransitionProps) {
  const reduce = useReducedMotion()
  const a = get(duel.a)
  const b = get(duel.b)
  const meIn = meId === duel.a || meId === duel.b
  const secs = Math.ceil(left / 1000)
  const starter = get(duel.first)
  const tournament = session.mode === 'tournament' && !!session.bracket && duel.round != null
  const roundLabel = tournament ? roundNameSingular(duel.round!, session.bracket!.rounds.length) : null
  const final = roundLabel === 'Finale'
  const head = headSize
  // Mode télé : textes à l'échelle des têtes (petit paysage -> un cran en dessous).
  const xl = tv && head >= 220

  useEffect(() => {
    fx.whoosh()
    if (meIn) vibrate([40, 60, 40])
  }, [duel.no, meIn])
  useEffect(() => {
    if (secs > 0 && secs <= 3) fx.tick()
  }, [secs])

  const kicker = tournament
    ? `🏆 ${modeInfo('tournament').label}`
    : session.mode === 'king'
      ? '👑 Roi de la table'
      : '⚔️ Duel'
  const title = tournament ? roundLabel! : `Combat n°${duel.no}`
  const sub = tournament
    ? duel.replay
      ? 'Revanche ! Le premier match s’est fini sur un nul'
      : final
        ? 'Le vainqueur devient la grosse tête de la soirée !'
        : 'Le perdant est éliminé, le gagnant passe au tour suivant'
    : session.mode === 'king'
      ? duel.no === 1
        ? 'Premier roi de la table ?'
        : `${a.nickname} défend sa couronne`
      : session.best_of > 1
        ? `Au meilleur des ${session.best_of} manches`
        : 'Une manche, pas de deuxième chance'

  /** Fiche du duelliste : bilan de la session ou parcours dans le tableau. */
  const record = (id: string) => {
    if (tournament) {
      const path = bracketPath(session.bracket, id).filter((p) => p.round < (duel.round ?? 0))
      if (!path.length) return 'Premier match'
      return path.map((p) => (p.bye ? 'au repos 😴' : p.random ? `${get(p.opponent!).nickname} 🎲` : `bat ${get(p.opponent!).nickname}`)).join(' · ')
    }
    const st = session.stats[id]
    if (!st || !st.played) return 'Premier duel'
    return `${st.wins} V · ${st.draws} N · ${st.losses} D`
  }

  const side = (p: PlayerInfo, s: 'a' | 'b') => (
    <motion.div
      initial={reduce ? { opacity: 0 } : { x: s === 'a' ? -200 : 200, rotate: s === 'a' ? -25 : 25, opacity: 0 }}
      animate={{ x: 0, rotate: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 200, damping: 14, delay: s === 'a' ? 0.1 : 0.25 }}
      className="flex min-w-0 flex-1 flex-col items-center gap-1"
    >
      <motion.div
        animate={reduce ? undefined : { y: [0, -6, 0], rotate: s === 'a' ? [0, -3, 0] : [0, 3, 0] }}
        transition={{ repeat: Infinity, duration: 1.1, delay: s === 'a' ? 0 : 0.5 }}
        className="relative rounded-full border-4 border-ink shadow-sticker"
        style={{ background: colors[s], width: head, height: head }}
      >
        <div className="size-full overflow-hidden rounded-full">
          <ChibiImage
            slug={p.slug}
            expression={s === 'a' ? pickExpression(p, 'determine', 'cool', 'clin_oeil', 'joie') : pickExpression(p, 'colere', 'determine', 'boude', 'joie')}
            tenue={p.equippedTenue}
            size={head * 0.95}
            bare
            className={cn('mt-[6%]', s === 'b' && '-scale-x-100')}
          />
        </div>
      </motion.div>
      <span
        className={cn(
          '-mt-3 max-w-full -rotate-2 truncate rounded-lg border-[3px] border-ink px-2 font-display font-extrabold text-[#1f1b2e] shadow-sticker-sm',
          tv ? 'text-3xl' : 'text-lg',
          s === 'b' && 'rotate-2',
        )}
        style={{ background: colors[s] }}
      >
        {p.id === meId ? 'Toi !' : p.nickname}
      </span>
      <span className={cn('max-w-full truncate font-bold text-muted', tv ? 'text-base' : 'text-[11px]')}>{record(p.id)}</span>
    </motion.div>
  )

  return (
    <div className="flex flex-col gap-3">
      <motion.div
        initial={reduce ? { opacity: 0 } : { scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className={cn('sticker relative flex flex-col items-center gap-2 overflow-hidden bg-surface px-3 pt-3 pb-4 text-center', xl && 'gap-4 px-6 pt-6 pb-6')}
      >
        {/* fond : deux couleurs coupées en biais + rayons */}
        <div
          className="pointer-events-none absolute inset-0 opacity-35"
          style={{ background: `linear-gradient(115deg, ${colors.a} 0 48%, ${colors.b} 52% 100%)` }}
          aria-hidden
        />
        <motion.div
          className="pointer-events-none absolute top-1/2 left-1/2 aspect-square w-[160%] -translate-x-1/2 -translate-y-1/2 opacity-[.12]"
          style={{ background: 'repeating-conic-gradient(var(--ink) 0 6deg, transparent 6deg 18deg)' }}
          animate={reduce ? undefined : { rotate: 360 }}
          transition={{ repeat: Infinity, duration: 40, ease: 'linear' }}
          aria-hidden
        />
        <span
          className={cn(
            'relative rounded-full border-2 border-ink bg-sun px-3 font-display font-extrabold text-[#1f1b2e] uppercase',
            tv ? 'text-lg' : 'text-xs',
          )}
        >
          {kicker}
        </span>
        <motion.h2
          initial={reduce ? { opacity: 0 } : { scale: 2.4, opacity: 0, rotate: -6 }}
          animate={{ scale: 1, opacity: 1, rotate: -2 }}
          transition={{ type: 'spring', stiffness: 260, damping: 14 }}
          className={cn('relative leading-none text-white', xl ? 'text-6xl' : tv ? 'text-5xl' : 'text-4xl', final && 'text-sun')}
          style={{ textShadow: '3px 3px 0 var(--ink), -2px -2px 0 var(--ink), 2px -2px 0 var(--ink), -2px 2px 0 var(--ink)' }}
        >
          {final ? '🏆 ' : ''}
          {title}
        </motion.h2>
        <span className={cn('relative font-bold', tv ? 'text-xl' : 'text-sm', duel.replay && 'rounded-full border-2 border-ink bg-tangerine px-2 text-white')}>
          {duel.replay ? '🔁 ' : ''}
          {sub}
        </span>
        <div className="relative flex w-full items-start">
          {side(a, 'a')}
          <motion.span
            initial={reduce ? { opacity: 0 } : { scale: 5, rotate: -30, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { scale: [1, 1.12, 1], rotate: -8, opacity: 1 }}
            transition={
              reduce
                ? undefined
                : { scale: { delay: 0.9, repeat: Infinity, duration: 0.9 }, default: { type: 'spring', stiffness: 400, damping: 12, delay: 0.45 } }
            }
            className={cn('shrink-0 self-center font-display font-extrabold text-tomato', xl ? 'text-8xl' : tv ? 'text-6xl' : 'text-5xl')}
            style={{ textShadow: '3px 3px 0 var(--ink)' }}
          >
            ⚡VS
          </motion.span>
          {side(b, 'b')}
        </div>
        <p className={cn('relative font-bold', tv ? 'text-xl' : 'text-sm')}>
          {starter.id === meId ? 'Tu commences !' : `${starter.nickname} commence`}
          {meIn ? '' : ' · Faites vos paris !'}
        </p>
        <motion.span
          key={secs}
          initial={reduce ? false : { scale: 1.8, opacity: 0.4 }}
          animate={{ scale: 1, opacity: 1 }}
          className={cn('relative font-display leading-none font-extrabold tabular-nums', xl ? 'text-7xl' : tv ? 'text-5xl' : 'text-4xl')}
        >
          {secs > 0 ? secs : 'GO !'}
        </motion.span>
      </motion.div>
      {children}
      {isHost && !tv && (
        <Button variant="secondary" size="sm" icon={<FastForward className="size-4" />} disabled={pending} onClick={onStart}>
          C’est parti tout de suite
        </Button>
      )}
    </div>
  )
}
