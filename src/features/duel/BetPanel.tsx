import { motion, useReducedMotion } from 'framer-motion'
import { Lock } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { fx } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import type { PlayerInfo } from '@/games/types'
import { BET_WINDOW_S, DUEL_POINTS } from './logic'
import type { DuelInfo } from './types'

export interface BetPanelProps {
  duel: DuelInfo
  meId: string
  /** Je suis spectateur (je peux parier). */
  canBet: boolean
  open: boolean
  /** ms restantes de la fenêtre de 15 s (0 = fermée par le temps ou pas commencée). */
  betsLeft: number
  /** Le duel a commencé (sinon : transition). */
  started: boolean
  get: (id: string) => PlayerInfo
  colors: { a: string; b: string }
  pending: boolean
  onBet: (winner: string) => void
  className?: string
}

/**
 * Paris des spectateurs : choisir le vainqueur du duel (+1 point si juste).
 * Ouverts pendant la transition, puis jusqu'au 1er coup (ou pendant les 15
 * premières secondes du duel). Les paris sont publics : tout le monde voit
 * qui soutient qui.
 */
export function BetPanel({ duel, meId, canBet, open, betsLeft, started, get, colors, pending, onBet, className }: BetPanelProps) {
  const reduce = useReducedMotion()
  const myBet = duel.bets[meId] ?? null
  const backers = (id: string) => Object.entries(duel.bets).filter(([, t]) => t === id).map(([b]) => b)
  const total = Object.keys(duel.bets).length
  const isDuelist = meId === duel.a || meId === duel.b
  if (!canBet && total === 0 && !isDuelist) return null

  const title = canBet
    ? open
      ? myBet
        ? 'Ton pari est posé (tu peux changer d’avis)'
        : `Qui va gagner ? +${DUEL_POINTS.bet} pt si tu as raison`
      : myBet
        ? 'Paris fermés : croise les doigts 🤞'
        : 'Paris fermés'
    : isDuelist
      ? total
        ? 'Le public a parié…'
        : 'Personne n’a encore parié'
      : 'Paris du public'

  return (
    <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className={cn('sticker flex flex-col gap-2 bg-surface p-3', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-display text-base leading-tight font-extrabold">🎟️ {title}</span>
        {open && started && betsLeft > 0 && (
          <span className="shrink-0 rounded-full border-2 border-ink bg-sun px-2 text-xs font-extrabold text-[#1f1b2e] tabular-nums">
            {Math.ceil(betsLeft / 1000)}s
          </span>
        )}
        {!open && <Lock className="size-4 shrink-0 text-muted" />}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {(['a', 'b'] as const).map((side) => {
          const id = duel[side]
          const p = get(id)
          const mine = myBet === id
          const list = backers(id)
          return (
            <motion.button
              key={id}
              type="button"
              disabled={!canBet || !open || pending}
              onClick={() => {
                if (mine) return
                fx.pop()
                onBet(id)
              }}
              whileTap={canBet && open ? { scale: 0.92, rotate: side === 'a' ? -3 : 3 } : undefined}
              animate={mine && !reduce ? { scale: [1, 1.06, 1] } : { scale: 1 }}
              transition={mine ? { repeat: Infinity, duration: 1.4 } : undefined}
              aria-pressed={mine}
              className={cn(
                'relative flex flex-col items-center gap-1 rounded-card border-[3px] border-ink p-2 text-[#1f1b2e] transition-shadow',
                mine ? 'shadow-sticker' : 'shadow-sticker-sm',
                canBet && open ? '' : 'cursor-default',
                canBet && !open && !mine && 'opacity-60',
              )}
              style={{ background: mine ? colors[side] : `color-mix(in srgb, ${colors[side]} 35%, var(--surface))` }}
            >
              <Avatar slug={p.slug} expression={mine ? 'joie' : p.equipped} tenue={p.equippedTenue} size={40} />
              <span className="max-w-full truncate font-display text-sm font-extrabold text-text">{p.nickname}</span>
              <div className="flex min-h-5 flex-wrap justify-center -space-x-1.5">
                {list.slice(0, 6).map((b) => (
                  <motion.span key={b} initial={{ scale: 0, y: -10 }} animate={{ scale: 1, y: 0 }}>
                    <Avatar slug={get(b).slug} expression={get(b).equipped} size={20} />
                  </motion.span>
                ))}
                {list.length > 6 && <span className="pl-2 text-xs font-extrabold">+{list.length - 6}</span>}
              </div>
              {mine && (
                <motion.span
                  initial={{ scale: 0, rotate: -40 }}
                  animate={{ scale: 1, rotate: -8 }}
                  className="absolute -top-2 -right-2 rounded-full border-2 border-ink bg-surface px-1.5 text-[11px] font-extrabold text-text"
                >
                  ton pari
                </motion.span>
              )}
            </motion.button>
          )
        })}
      </div>
      {canBet && open && !started && <p className="text-center text-xs text-muted">Paris ouverts jusqu’au 1er coup (au moins {BET_WINDOW_S} s après le début).</p>}
    </motion.div>
  )
}
