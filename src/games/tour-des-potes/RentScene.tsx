/**
 * Mini-scène de loyer, sur TOUS les écrans : la maison du propriétaire, son chibi
 * qui réclame le loyer, le payeur qui arrive en sautillant au bout de la file et
 * les billets qui changent de main. Les visiteurs déjà passés chez CE propriétaire
 * pendant le tour de table attendent déjà devant la maison. Overlay compact, ne
 * bloque pas le jeu : fermeture automatique, ou au toucher.
 */
import { useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, animate, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { ChibiImage } from '@/components/ui/ChibiImage'
import { mood, playerOrPlaceholder } from '@/features/soiree/players'
import { fx } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import type { PlayerInfo } from '../types'
import { Bill } from './Bill'
import { BOARD } from './board'
import { cityName, eur } from './format'
import { billsFor } from './money'
import type { RentFx } from './usePlayback'

const RENT_SHOW_MS = 5000
/** Chronologie (s) : arrivée du payeur, bulle, billets, reçu. */
const T_WALK = 0.35
const T_BUBBLE = 1.15
const T_PAY = 1.9
const T_PAID = 2.75

interface Props {
  rent: RentFx | null
  players: Record<string, PlayerInfo>
  meId: string
  name: (id: string | null | undefined) => string
  onClose: () => void
}

export default function RentScene({ rent, players, meId, name, onClose }: Props) {
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-[14dvh] z-[45] px-4">
      <AnimatePresence mode="wait">
        {rent && (
          <motion.div
            key={rent.key}
            role="status"
            aria-live="polite"
            className="pointer-events-auto relative mx-auto w-full max-w-sm"
            initial={{ y: -50, opacity: 0, scale: 0.9, rotate: 2 }}
            animate={{ y: 0, opacity: 1, scale: 1, rotate: 0 }}
            exit={{ y: -30, opacity: 0, transition: { duration: 0.15 } }}
            transition={{ type: 'spring', stiffness: 360, damping: 24 }}
          >
            <Scene rent={rent} players={players} meId={meId} name={name} onClose={onClose} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>,
    document.body,
  )
}

/** Maison dessinée (toit à la couleur du propriétaire, porte à celle du lieu). */
function House({ roof, door }: { roof: string; door: string }) {
  return (
    <svg viewBox="0 0 96 92" width={84} height={80} aria-hidden className="block">
      <rect x="64" y="10" width="11" height="22" rx="2" fill="#fff8e7" stroke="#1f1b2e" strokeWidth="4" />
      <rect x="14" y="40" width="68" height="48" rx="5" fill="#fff8e7" stroke="#1f1b2e" strokeWidth="4" />
      <path d="M48 6 L92 44 H4 Z" fill={roof} stroke="#1f1b2e" strokeWidth="4" strokeLinejoin="round" />
      <rect x="22" y="52" width="18" height="16" rx="3" fill="#a5d8f3" stroke="#1f1b2e" strokeWidth="3.5" />
      <path d="M31 52 V68 M22 60 H40" stroke="#1f1b2e" strokeWidth="2.5" />
      <rect x="52" y="54" width="20" height="34" rx="4" fill={door} stroke="#1f1b2e" strokeWidth="4" />
      <circle cx="67" cy="72" r="2.2" fill="#1f1b2e" />
    </svg>
  )
}

function Scene({ rent, players, meId, name, onClose }: { rent: RentFx } & Omit<Props, 'rent'>) {
  const c = BOARD[rent.cell]
  const owner = playerOrPlaceholder(players, rent.owner)
  const color = c.color ?? (c.type === 'potes' ? '#06d6a0' : '#4cc9f0')
  const visitors = useMemo(() => [...rent.before.map((v) => ({ ...v, fresh: false })), { no: rent.key, payer: rent.payer, amount: rent.amount, fresh: true }], [rent])
  const n = visitors.length
  const sz = Math.max(22, Math.min(52, Math.floor(192 / n)))
  const bills = useMemo(() => billsFor(rent.amount, 3, 5), [rent.amount])

  const stage = useRef<HTMLDivElement>(null)
  const ownerRef = useRef<HTMLDivElement>(null)
  const payerRef = useRef<HTMLLIElement>(null)
  const billRefs = useRef<(HTMLSpanElement | null)[]>([])

  // Fermeture automatique.
  useEffect(() => {
    const t = window.setTimeout(onClose, RENT_SHOW_MS)
    return () => clearTimeout(t)
  }, [onClose])

  // Les billets passent du payeur au propriétaire.
  useEffect(() => {
    const st = stage.current?.getBoundingClientRect()
    const a = payerRef.current?.getBoundingClientRect()
    const b = ownerRef.current?.getBoundingClientRect()
    if (!st || !a || !b) return
    const x0 = a.left + a.width / 2 - st.left - 14
    const y0 = a.top + a.height * 0.4 - st.top
    const x1 = b.left + b.width / 2 - st.left - 14
    const y1 = b.top + b.height * 0.45 - st.top
    const sound = window.setTimeout(() => fx.cash(), T_PAY * 1000)
    const controls = billRefs.current.map((el, i) =>
      el
        ? animate(
            el,
            { x: [x0, (x0 + x1) / 2, x1], y: [y0, Math.min(y0, y1) - 26, y1], rotate: [0, -160, -340], opacity: [0, 1, 1, 0] },
            { duration: 0.6, delay: T_PAY + i * 0.11, ease: 'easeInOut', opacity: { duration: 0.6, delay: T_PAY + i * 0.11, times: [0, 0.1, 0.85, 1] } },
          )
        : null,
    )
    return () => {
      clearTimeout(sound)
      controls.forEach((ct) => ct?.stop())
    }
  }, [])

  const payerMe = rent.payer === meId
  const ownerMe = rent.owner === meId
  return (
    <div className="sticker overflow-hidden bg-surface text-text" onClick={onClose}>
      <div className="flex items-center gap-2.5 border-b-[3px] border-ink px-3 py-2 pr-12 text-[#1f1b2e]" style={{ backgroundColor: color }}>
        <span className="text-3xl leading-none" aria-hidden>
          {c.emoji ?? '🏠'}
        </span>
        <div className="min-w-0">
          <p className="truncate font-display text-lg leading-tight font-extrabold">{c.name}</p>
          <p className="truncate text-xs font-bold">
            Chez {ownerMe ? 'toi' : owner.nickname}
            {cityName(c) ? ` · ${cityName(c)}` : ''}
          </p>
        </div>
      </div>
      <button
        type="button"
        aria-label="Fermer"
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        className="absolute top-1.5 right-1.5 z-10 flex size-9 items-center justify-center rounded-full border-[3px] border-ink bg-surface text-text shadow-sticker-sm"
      >
        <X className="size-4" strokeWidth={3} />
      </button>

      <div ref={stage} className="relative flex h-[132px] items-end gap-1 overflow-hidden bg-linear-to-b from-sky/35 to-sky/10 px-2 pb-2">
        {/* sol */}
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-5 border-t-2 border-ink/30 bg-lime/45" />
        {/* maison + propriétaire sur le pas de la porte */}
        <div className="relative shrink-0" style={{ width: 108, height: 84 }}>
          <span className="absolute bottom-0 left-0">
            <House roof={owner.color} door={color} />
          </span>
          <motion.div
            ref={ownerRef}
            className="absolute bottom-0 left-[50px]"
            animate={{ y: [0, -5, 0] }}
            transition={{ duration: 0.5, delay: T_BUBBLE, repeat: 2, repeatDelay: 0.5 }}
          >
            <ChibiImage slug={owner.slug} expression={mood(owner, 'happy')} tenue={owner.equippedTenue} size={58} thumb alt={owner.nickname} />
          </motion.div>
          <motion.span
            aria-hidden
            className="absolute -bottom-0.5 left-1 rounded-full border-2 border-ink bg-mint px-1.5 py-0.5 font-display text-[11px] leading-none font-extrabold whitespace-nowrap text-[#1f1b2e]"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 16, delay: T_PAID }}
          >
            +{eur(rent.amount)}
          </motion.span>
        </div>
        {/* bulle du propriétaire */}
        <motion.p
          className="absolute top-2 left-[64px] z-[5] max-w-[calc(100%-112px)] rounded-[14px] rounded-bl-[3px] border-[2.5px] border-ink bg-surface px-2.5 py-1 font-display text-[15px] leading-tight font-extrabold shadow-sticker-sm"
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 480, damping: 18, delay: T_BUBBLE }}
          style={{ transformOrigin: '10% 100%' }}
        >
          Ton loyer : {eur(rent.amount)} !
        </motion.p>
        {/* file d'attente : les premiers arrivés sont près de la porte */}
        <ul className="relative flex min-w-0 flex-1 items-end">
          {visitors.map((v) => {
            const p = playerOrPlaceholder(players, v.payer)
            const chip = (
              <span
                className={cn(
                  'rounded-full border-[1.5px] border-ink font-display leading-[1.25] font-extrabold whitespace-nowrap tabular-nums',
                  sz < 34 ? 'px-[2px] text-[8px] tracking-tighter' : 'px-1 text-[10px]',
                  v.fresh ? 'bg-tomato text-white' : 'bg-sunk text-text',
                )}
              >
                {v.fresh && '−'}
                {sz < 34 ? v.amount.toLocaleString('fr-FR') : eur(v.amount)}
              </span>
            )
            return (
              <li key={v.no} ref={v.fresh ? payerRef : undefined} className="flex min-w-0 flex-col items-center" style={{ width: sz }} aria-label={`${p.nickname} : ${eur(v.amount)}`}>
                {v.fresh ? (
                  <>
                    <motion.div
                      initial={{ x: 150, opacity: 0 }}
                      animate={{ x: 0, opacity: 1, y: [0, -13, 0, -11, 0, -7, 0] }}
                      transition={{ x: { duration: 0.85, delay: T_WALK, ease: 'easeOut' }, opacity: { duration: 0.2, delay: T_WALK }, y: { duration: 0.85, delay: T_WALK, ease: 'easeInOut' } }}
                    >
                      <ChibiImage slug={p.slug} expression={mood(p, 'sad')} tenue={p.equippedTenue} size={sz} thumb alt={p.nickname} />
                    </motion.div>
                    <motion.span className="flex max-w-full" initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 16, delay: T_PAID }}>
                      {chip}
                    </motion.span>
                  </>
                ) : (
                  <>
                    <ChibiImage slug={p.slug} expression={mood(p, 'sad')} tenue={p.equippedTenue} size={sz} thumb alt={p.nickname} className="opacity-90" />
                    {chip}
                  </>
                )}
              </li>
            )
          })}
        </ul>
        {/* billets du payeur vers le propriétaire */}
        {bills.map((d, i) => (
          <span
            key={i}
            ref={(el) => {
              billRefs.current[i] = el
            }}
            aria-hidden
            className="pointer-events-none absolute top-0 left-0 z-10 opacity-0"
          >
            <Bill value={d} w={28} className="shadow-[1px_1px_0_0_var(--ink)]" />
          </span>
        ))}
      </div>

      <p className="border-t-[3px] border-ink bg-tomato px-3 py-1.5 text-center text-sm leading-tight font-extrabold text-white">
        💸 {payerMe ? 'Tu paies' : `${name(rent.payer)} paie`} {eur(rent.amount)} de loyer à {ownerMe ? 'toi' : owner.nickname}
        {n > 1 && <span className="block text-[11px] font-bold opacity-90">{n} visiteurs chez {ownerMe ? 'toi' : owner.nickname} ce tour-ci</span>}
      </p>
      <div className="h-1.5 w-full bg-sunk">
        <motion.div className="h-full" style={{ backgroundColor: color }} initial={{ width: '100%' }} animate={{ width: 0 }} transition={{ duration: RENT_SHOW_MS / 1000, ease: 'linear' }} />
      </div>
    </div>
  )
}
