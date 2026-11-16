/**
 * Cagnotte des taxes du plateau 2D : le tas de billets au centre (il grossit avec
 * la cagnotte), les billets qui s'envolent de la case du payeur jusqu'au tas (ou
 * du tas vers le joueur qui la ramasse sur « Pause apéro ») et l'annonce partagée.
 */
import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { AnimatePresence, animate, motion } from 'framer-motion'
import { Bill } from './Bill'
import { eur } from './format'
import { billsFor, potBills } from './money'
import { cellRect } from './PlayBoard'
import { TAX_FLY_MS, type TaxFx } from './usePlayback'

const POT_ATTR = 'data-tdp-pot'
const PILE_MAX = 7

/** Tas au centre + étiquette « Cagnotte : X € » (toujours visible, même vide). */
export function TaxPot({ pot }: { pot: number }) {
  const bills = useMemo(() => potBills(pot, PILE_MAX), [pot])
  return (
    <div className="flex max-w-full items-center gap-1.5" aria-label={`Cagnotte des taxes : ${eur(pot)}`}>
      <motion.span
        key={pot}
        {...{ [POT_ATTR]: '' }}
        className="relative block shrink-0"
        style={{ width: 40, height: 28 }}
        initial={{ scale: pot > 0 ? 1.3 : 1 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 420, damping: 14 }}
      >
        {bills.length === 0 && <span aria-hidden className="absolute inset-x-1 bottom-0.5 block h-[17px] rounded-[4px] border-[1.5px] border-dashed border-ink/40" />}
        {bills.map((d, k) => (
          <span key={k} className="absolute" style={{ left: 4 + ((k * 5) % 7) - 3, bottom: k * 1.6, transform: `rotate(${((k * 37) % 31) - 15}deg)`, zIndex: k }}>
            <Bill value={d} w={30} />
          </span>
        ))}
      </motion.span>
      <span className="min-w-0 truncate rounded-chip border-2 border-ink bg-surface px-1.5 py-0.5 font-display text-[11px] leading-none font-extrabold tabular-nums">Cagnotte : {eur(pot)}</span>
    </div>
  )
}

/**
 * Billets en vol : de la case `fx.cell` jusqu'au tas (mesuré dans le plateau `board`) ;
 * `reverse` : du tas vers la case (cagnotte ramassée).
 */
export function TaxFlight({ fx, board, reverse = false }: { fx: TaxFx; board: RefObject<HTMLDivElement | null>; reverse?: boolean }) {
  const bills = useMemo(() => (reverse ? billsFor(fx.amount, 5, 9) : billsFor(fx.amount, 4, 6)), [fx.amount, reverse])
  const refs = useRef<(HTMLSpanElement | null)[]>([])
  const r = cellRect(fx.cell)
  const W = 30
  const H = Math.round(W * 0.56)

  useEffect(() => {
    const root = board.current
    const pot = root?.querySelector(`[${POT_ATTR}]`)
    if (!root || !pot) return
    const b = root.getBoundingClientRect()
    const p = pot.getBoundingClientRect()
    const dx = p.left + p.width / 2 - (b.left + ((r.x + r.w / 2) / 100) * b.width)
    const dy = p.top + p.height / 2 - (b.top + ((r.y + r.h / 2) / 100) * b.height)
    const n = refs.current.length
    const dur = Math.max(0.4, (TAX_FLY_MS - 100) / 1000 - (n - 1) * 0.09)
    const xs = reverse ? [dx, dx * 0.5, 0] : [0, dx * 0.5, dx]
    const ys = reverse ? [dy, dy * 0.5 - 34, 0] : [0, dy * 0.5 - 34, dy]
    const controls = refs.current.map((el, i) =>
      el
        ? animate(
            el,
            { x: xs, y: ys, rotate: [i % 2 ? -20 : 20, i % 2 ? 160 : -160, i % 2 ? 350 : -350], scale: [0.6, 1.25, 0.85], opacity: [0, 1, 1, 0] },
            { duration: dur, delay: i * 0.09, ease: 'easeInOut', opacity: { duration: dur, delay: i * 0.09, times: [0, 0.12, 0.9, 1] } },
          )
        : null,
    )
    return () => controls.forEach((c) => c?.stop())
    // eslint-disable-next-line react-hooks/exhaustive-deps -- une animation par taxe (composant monté avec key = fx.key)
  }, [])

  return (
    <div className="pointer-events-none absolute inset-0 z-30" aria-hidden>
      {bills.map((d, i) => (
        <span
          key={i}
          ref={(el) => {
            refs.current[i] = el
          }}
          className="absolute opacity-0"
          style={{ left: `calc(${r.x + r.w / 2}% - ${W / 2}px)`, top: `calc(${r.y + r.h / 2}% - ${H / 2}px)` }}
        >
          <Bill value={d} w={W} className="shadow-[1px_1px_0_0_var(--ink)]" />
        </span>
      ))}
    </div>
  )
}

/** Annonce partagée « Cagnotte ! +X € » par-dessus le plateau (2D et 3D). */
export function PotToast({ fx, name, meId }: { fx: TaxFx | null; name?: (id: string | null | undefined) => string; meId?: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-40 flex items-end justify-center pb-[13%]" aria-live="polite">
      <AnimatePresence>
        {fx && (
          <motion.div
            key={fx.key}
            role="status"
            className="sticker flex flex-col items-center bg-sun px-3.5 py-1.5 text-center text-[#1f1b2e]"
            initial={{ scale: 0.3, opacity: 0, rotate: -8 }}
            animate={{ scale: 1, opacity: 1, rotate: -3 }}
            exit={{ scale: 0.6, opacity: 0, y: -20, transition: { duration: 0.2 } }}
            transition={{ type: 'spring', stiffness: 420, damping: 16 }}
          >
            <span className="font-display text-base leading-none font-extrabold">🍹 Cagnotte !</span>
            <span className="font-display text-xl leading-tight font-extrabold tabular-nums">+{eur(fx.amount)}</span>
            {name && <span className="text-xs leading-none font-bold">{fx.player === meId ? 'pour toi !' : `pour ${name(fx.player)}`}</span>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
