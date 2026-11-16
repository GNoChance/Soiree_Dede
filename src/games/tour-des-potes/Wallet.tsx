/**
 * Portefeuille sous le plateau : mon argent rangé en billets, du 500 au 1
 * (décomposition gloutonne), avec le nombre par coupure et le total. Les billets
 * entrent / sortent quand l'argent change. Spectateur ou failli : l'argent du
 * joueur au trait.
 */
import { AnimatePresence, motion } from 'framer-motion'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { cn } from '@/lib/cn'
import { Bill } from './Bill'
import { eur } from './format'
import { DENOMS, breakdown, type Denom } from './money'
import type { TdpState } from './types'

const BILL_W = 36
const BILL_H = Math.round(BILL_W * 0.56)
/** Billets dessinés par pile (au-delà, seul le compteur augmente). */
const MAX_SHOWN = 6
const STEP = 3

function Stack({ value, count }: { value: Denom; count: number }) {
  const shown = Math.min(count, MAX_SHOWN)
  return (
    <li className="flex min-w-0 flex-1 flex-col items-center gap-0.5" aria-label={`${count} billet${count > 1 ? 's' : ''} de ${value} €`}>
      <span className="relative block" style={{ width: BILL_W, height: BILL_H + (MAX_SHOWN - 1) * STEP }}>
        {/* emplacement vide : on voit toujours la coupure */}
        <span
          aria-hidden
          className="absolute bottom-0 left-0 flex items-center justify-center rounded-[5px] border-2 border-dashed border-ink/35 font-display text-[11px] leading-none font-extrabold text-muted/70"
          style={{ width: BILL_W, height: BILL_H }}
        >
          {value}
        </span>
        <AnimatePresence initial={false}>
          {Array.from({ length: shown }, (_, k) => (
            <motion.span
              key={k}
              className="absolute left-0"
              style={{ bottom: k * STEP, zIndex: k + 1 }}
              initial={{ y: -26, opacity: 0, rotate: k % 2 ? 10 : -10 }}
              animate={{ y: 0, opacity: 1, rotate: 0 }}
              exit={{ y: -30, x: 10, opacity: 0, rotate: 14, transition: { duration: 0.28, delay: (shown - 1 - k) * 0.03 } }}
              transition={{ type: 'spring', stiffness: 420, damping: 24, delay: k * 0.04 }}
            >
              <Bill value={value} w={BILL_W} className="shadow-[1px_1px_0_0_var(--ink)]" />
            </motion.span>
          ))}
        </AnimatePresence>
      </span>
      <motion.span
        key={count}
        aria-hidden
        initial={{ scale: 1.35 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 500, damping: 18 }}
        className={cn('font-display text-xs leading-none font-extrabold tabular-nums', count === 0 && 'text-muted/60')}
      >
        ×{count}
      </motion.span>
    </li>
  )
}

interface Props {
  s: TdpState
  meId: string
  name: (id: string | null | undefined) => string
}

export default function Wallet({ s, meId, name }: Props) {
  if (s.phase === 'finished' || s.phase === 'aborted') return null
  const playing = s.order.includes(meId) && !s.bankrupt.includes(meId)
  const who = playing ? meId : s.turn
  if (!who || s.bankrupt.includes(who)) return null
  const cash = s.cash[who] ?? 0
  const counts = breakdown(cash)
  const title = playing ? 'Mon argent' : `Argent de ${name(who)}`
  return (
    <section className="sticker-sm flex min-w-0 flex-col gap-1.5 overflow-hidden bg-surface px-2 pt-1.5 pb-2" aria-label={`${title} : ${eur(cash)}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="min-w-0 truncate font-display text-sm leading-none font-extrabold">💰 {title}</h2>
        <p className={cn('shrink-0 font-display text-lg leading-none font-extrabold tabular-nums', cash < 0 && 'text-tomato')}>
          {cash < 0 && '−'}
          <AnimatedNumber value={Math.abs(cash)} duration={0.7} /> €
        </p>
      </div>
      {cash < 0 ? (
        <p className="rounded-chip border-2 border-tomato bg-tomato/10 px-2 py-1.5 text-center text-sm leading-tight font-extrabold text-tomato">
          Dette de {eur(-cash)} : plus un billet en poche !
        </p>
      ) : (
        <ul className="flex min-w-0 items-end gap-1">
          {DENOMS.map((d) => (
            <Stack key={`${who}-${d}`} value={d} count={counts[d]} />
          ))}
        </ul>
      )}
    </section>
  )
}
