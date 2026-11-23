import { motion, useReducedMotion } from 'framer-motion'
import { ChibiImage } from '@/components/ui/ChibiImage'
import { mood, pickExpression } from '@/features/soiree/players'
import { cn } from '@/lib/cn'
import type { PlayerInfo } from '@/games/types'
import { fmtTurnClock, winsNeeded } from './logic'
import type { DuelInfo, DuelPhase, DuelSession } from './types'

/** Anneau de minuteur (fraction restante 0..1). */
export function TimerRing({ frac, size, stroke = 5 }: { frac: number; size: number; stroke?: number }) {
  const r = size / 2 - stroke / 2 - 1
  const c = 2 * Math.PI * r
  const color = frac > 0.5 ? '#06D6A0' : frac > 0.2 ? '#FFB703' : '#EF476F'
  return (
    <svg width={size} height={size} className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-90" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--ink)" strokeOpacity=".15" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.max(0, Math.min(1, frac)))}
        style={{ transition: 'stroke-dashoffset .25s linear, stroke .3s' }}
      />
    </svg>
  )
}

/** Pastilles de manches gagnées (meilleur de 3). */
function WinPips({ n, need, color }: { n: number; need: number; color: string }) {
  return (
    <div className="flex gap-1" aria-label={`${n} manche(s) gagnée(s) sur ${need}`}>
      {Array.from({ length: need }, (_, i) => (
        <motion.span
          key={i}
          animate={i < n ? { scale: [1.6, 1] } : { scale: 1 }}
          className="size-3.5 rounded-full border-2 border-ink"
          style={{ background: i < n ? color : 'transparent' }}
        />
      ))}
    </div>
  )
}

interface FighterProps {
  player: PlayerInfo
  side: 'a' | 'b'
  color: string
  me: boolean
  active: boolean
  frac: number
  secLeft: number
  score: number
  wins: number
  need: number
  outcome: 'win' | 'lose' | 'draw' | null
  ready?: boolean
  /** false : pas d'anneau (le jeu a sa propre pendule). */
  ring?: boolean
}

function Fighter({ player, side, color, me, active, frac, secLeft, score, wins, need, outcome, ready, ring = true }: FighterProps) {
  const reduce = useReducedMotion()
  const size = 84
  const expr =
    outcome === 'win'
      ? pickExpression(player, 'cool', 'pouces', 'joie')
      : outcome === 'lose'
        ? mood(player, 'sad')
        : outcome === 'draw'
          ? mood(player, 'shocked')
          : active
            ? mood(player, 'think')
            : player.equipped
  return (
    <motion.div
      initial={{ x: side === 'a' ? -80 : 80, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 260, damping: 18 }}
      className={cn('flex min-w-0 flex-1 flex-col items-center gap-1', side === 'b' && 'order-3')}
    >
      <div className="relative flex items-center justify-center" style={{ width: size + 18, height: size + 18 }}>
        {active && ring && <TimerRing frac={frac} size={size + 18} stroke={6} />}
        <motion.div
          className="relative overflow-hidden rounded-full border-[3px] border-ink shadow-sticker-sm"
          style={{ width: size, height: size, background: color }}
          animate={
            reduce
              ? undefined
              : active
                ? { y: [0, -5, 0], rotate: [0, side === 'a' ? -3 : 3, 0] }
                : outcome === 'win'
                  ? { y: [0, -10, 0], scale: [1, 1.08, 1] }
                  : { y: 0 }
          }
          transition={active || outcome === 'win' ? { repeat: Infinity, duration: active ? 0.9 : 0.7 } : undefined}
        >
          <ChibiImage
            slug={player.slug}
            expression={expr}
            tenue={player.equippedTenue}
            size={size * 0.95}
            bare
            className={cn('mt-[6%]', side === 'b' && '-scale-x-100', outcome === 'lose' && 'grayscale-[60%]')}
          />
        </motion.div>
        {active && (
          <span
            className={cn(
              'absolute -bottom-1 rounded-full border-2 border-ink bg-surface px-2 font-display text-sm leading-tight font-extrabold tabular-nums shadow-sticker-sm',
              secLeft <= 5 && 'bg-tomato text-white',
            )}
          >
            {fmtTurnClock(secLeft)}
          </span>
        )}
        {ready && (
          <span className="absolute -top-1 -right-1 rounded-full border-2 border-ink bg-mint px-1.5 text-xs font-extrabold text-[#1f1b2e]">prêt</span>
        )}
      </div>
      <span className={cn('max-w-full truncate font-display text-base leading-tight font-extrabold', me && 'text-grape')}>
        {me ? 'Toi' : player.nickname}
      </span>
      <div className="flex items-center gap-1.5">
        <span className="size-3 rounded-full border-2 border-ink" style={{ background: color }} aria-hidden />
        <span className="text-xs font-bold text-muted tabular-nums">{score} pt{score > 1 ? 's' : ''}</span>
      </div>
      {need > 1 && <WinPips n={wins} need={need} color={color} />}
    </motion.div>
  )
}

export interface DuelStageProps {
  duel: DuelInfo
  session: DuelSession
  phase: DuelPhase
  meId: string
  get: (id: string) => PlayerInfo
  colors: { a: string; b: string }
  /** ms restantes avant l'échéance de la phase. */
  left: number
  /** Le plateau a sa propre pendule (échecs) : pas d'anneau basé sur turn_seconds. */
  ownClock?: boolean
  className?: string
}

/**
 * En-tête du duel : les deux duellistes face à face (chibis, couleurs),
 * chrono du joueur au trait, points de session et manches gagnées.
 */
export function DuelStage({ duel, session, phase, meId, get, colors, left, ownClock = false, className }: DuelStageProps) {
  const reduce = useReducedMotion()
  const total = (session.turn_seconds || 30) * 1000
  const frac = left / total
  const secLeft = Math.ceil(left / 1000)
  const need = winsNeeded(session.best_of)
  const outcomeFor = (id: string): FighterProps['outcome'] => {
    if (phase !== 'result') return null
    const res = duel.result
    if (res) return res.draw ? 'draw' : res.winner === id ? 'win' : 'lose'
    if (duel.outcome === 'draw') return 'draw'
    return duel.winner === id ? 'win' : 'lose'
  }
  const fighter = (id: string, side: 'a' | 'b') => (
    <Fighter
      key={id}
      player={get(id)}
      side={side}
      color={colors[side]}
      me={id === meId}
      active={phase === 'playing' && duel.turn === id}
      frac={frac}
      ring={!ownClock}
      secLeft={secLeft}
      score={session.scores[id] ?? 0}
      wins={duel.wins[id] ?? 0}
      need={need}
      outcome={outcomeFor(id)}
      ready={phase === 'setup' && duel.ready.includes(id)}
    />
  )
  return (
    <div className={cn('sticker relative flex items-start gap-1 overflow-hidden bg-surface px-2 pt-2 pb-2', className)}>
      <div
        className="pointer-events-none absolute inset-0 opacity-25"
        style={{ background: `linear-gradient(100deg, ${colors.a} 0%, transparent 45%, transparent 55%, ${colors.b} 100%)` }}
        aria-hidden
      />
      {fighter(duel.a, 'a')}
      <div className="relative z-10 order-2 flex flex-col items-center self-center pt-2">
        <motion.span
          className="font-display text-3xl font-extrabold text-tomato"
          style={{ textShadow: '2px 2px 0 var(--ink)' }}
          animate={reduce ? undefined : { rotate: [-8, 8, -8], scale: [1, 1.12, 1] }}
          transition={{ repeat: Infinity, duration: 1.8 }}
        >
          VS
        </motion.span>
        {phase === 'setup' && (
          <span className="mt-1 rounded-full border-2 border-ink bg-sun px-2 text-xs font-extrabold text-[#1f1b2e] tabular-nums">{secLeft}s</span>
        )}
      </div>
      {fighter(duel.b, 'b')}
    </div>
  )
}
