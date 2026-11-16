/**
 * Carte partagée sur TOUS les écrans : l'anecdote du lieu où s'arrête un joueur,
 * ou la carte Hasard / Entre potes tirée. Ne bloque jamais le jeu : auto-fermeture
 * (barre de temps), bouton fermer, toucher la carte la ferme aussi.
 */
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { fx } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import { BOARD, DECK_NAMES } from './board'
import { cityName, eur, isPlace } from './format'
import { DICE_MS, walkSteps } from './usePlayback'
import { ownerOf, rentFor } from './rules'
import type { TdpCardDrawn, TdpLastEvent, TdpState } from './types'

type Item = { kind: 'card'; card: TdpCardDrawn } | { kind: 'place'; cell: number }

const SHOW_MS = 7000

function itemsOf(ev: TdpLastEvent): Item[] {
  const items: Item[] = []
  if (ev.card) items.push({ kind: 'card', card: ev.card })
  if (isPlace(BOARD[ev.cell])) items.push({ kind: 'place', cell: ev.cell })
  return items
}

export default function EventCard({ s, initialNo, name, meId }: { s: TdpState; initialNo: number; name: (id: string | null | undefined) => string; meId: string }) {
  const [show, setShow] = useState<{ no: number; idx: number; items: Item[] } | null>(null)
  const ev = s.last_event
  const no = ev?.no ?? 0

  // Nouveau coup : on attend la fin des dés et du déplacement, puis on affiche.
  useEffect(() => {
    if (!ev || no === initialNo) return
    const items = itemsOf(ev)
    if (!items.length) return
    const delay = DICE_MS + walkSteps(ev.from, ev.cell) * 110 + 450
    const t = window.setTimeout(() => {
      fx.whoosh()
      setShow({ no, idx: 0, items })
    }, delay)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ne dépend que du numéro d'évènement
  }, [no, initialNo])

  const key = show ? `${show.no}-${show.idx}` : null
  const next = useCallback(
    () => setShow((cur) => (cur && cur.idx + 1 < cur.items.length ? { ...cur, idx: cur.idx + 1 } : null)),
    [],
  )

  // Auto-fermeture.
  useEffect(() => {
    if (!key) return
    const t = window.setTimeout(next, SHOW_MS)
    return () => clearTimeout(t)
  }, [key, next])

  // Fin de partie : plus de carte.
  const live = show && s.phase !== 'finished' && s.phase !== 'aborted' ? show : null
  const item = live ? live.items[live.idx] : null

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-[14dvh] z-[45] px-4">
      <AnimatePresence mode="wait">
        {live && item && ev && (
          <motion.div
            key={key}
            role="status"
            aria-live="polite"
            className="pointer-events-auto relative mx-auto w-full max-w-sm"
            initial={{ y: -60, opacity: 0, rotate: -4, scale: 0.9 }}
            animate={{ y: 0, opacity: 1, rotate: -1, scale: 1 }}
            exit={{ y: -40, opacity: 0, transition: { duration: 0.15 } }}
            transition={{ type: 'spring', stiffness: 360, damping: 22 }}
          >
            {item.kind === 'place' ? <PlaceCard cell={item.cell} s={s} ev={ev} name={name} meId={meId} onClose={next} /> : <DrawnCard card={item.card} ev={ev} name={name} onClose={next} />}
          </motion.div>
        )}
      </AnimatePresence>
    </div>,
    document.body,
  )
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      aria-label="Fermer la carte"
      onClick={(e) => {
        e.stopPropagation()
        onClose()
      }}
      className="absolute top-2 right-2 z-10 flex size-10 items-center justify-center rounded-full border-[3px] border-ink bg-surface text-text shadow-sticker-sm active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
    >
      <X className="size-5" strokeWidth={3} />
    </button>
  )
}

function TimeBar({ color }: { color: string }) {
  return (
    <div className="h-2 w-full overflow-hidden border-t-[3px] border-ink bg-sunk">
      <motion.div className="h-full" style={{ backgroundColor: color }} initial={{ width: '100%' }} animate={{ width: 0 }} transition={{ duration: SHOW_MS / 1000, ease: 'linear' }} />
    </div>
  )
}

function PlaceCard({ cell, s, ev, name, meId, onClose }: { cell: number; s: TdpState; ev: TdpLastEvent; name: (id: string | null | undefined) => string; meId: string; onClose: () => void }) {
  const c = BOARD[cell]
  const who = ev.player === meId ? 'Tu' : name(ev.player)
  const owner = ownerOf(s, cell)
  const text = c.anecdote || c.description || ''
  let outcome: { icon: string; text: string; tone: string }
  if (ev.bought) {
    outcome = { icon: '🏠', text: `${who} ${ev.player === meId ? 'as acheté' : 'a acheté'} ce lieu`, tone: 'bg-mint text-[#1f1b2e]' }
  } else if (ev.rent) {
    outcome = { icon: '💸', text: `${who} ${ev.player === meId ? 'paies' : 'paie'} ${eur(ev.rent.amount)} de loyer à ${ev.rent.to === meId ? 'toi' : name(ev.rent.to)}`, tone: 'bg-tomato text-white' }
  } else if (owner && owner === ev.player) {
    outcome = { icon: '🏡', text: `Chez ${ev.player === meId ? 'toi' : name(owner)} : rien à payer`, tone: 'bg-sky text-[#1f1b2e]' }
  } else if (owner) {
    outcome = { icon: '💸', text: `Propriété de ${owner === meId ? 'toi' : name(owner)} (loyer ${eur(rentFor(s, cell))})`, tone: 'bg-sunk' }
  } else if (s.phase === 'buy' && s.pending?.cell === cell) {
    outcome = { icon: '🤔', text: `Libre ! ${who} ${ev.player === meId ? 'peux' : 'peut'} l’acheter pour ${eur(s.pending.price)}`, tone: 'bg-sun text-[#1f1b2e]' }
  } else {
    outcome = { icon: '🙅', text: `Libre : ${who} ${ev.player === meId ? 'ne l’as pas pris' : 'ne l’a pas pris'}`, tone: 'bg-sunk' }
  }
  const color = c.color ?? (c.type === 'potes' ? '#06d6a0' : '#4cc9f0')
  return (
    <div className="sticker overflow-hidden bg-surface text-text" onClick={onClose}>
      <div className="flex items-center gap-3 border-b-[3px] border-ink px-4 py-3 pr-14" style={{ backgroundColor: color }}>
        <span className="text-4xl leading-none" aria-hidden>
          {c.emoji ?? '📍'}
        </span>
        <div className="min-w-0 text-[#1f1b2e]">
          <p className="line-clamp-2 font-display text-xl leading-tight font-extrabold">{c.name}</p>
          <p className="truncate text-sm font-bold">{cityName(c) ?? 'Le Tour des Potes'}</p>
        </div>
      </div>
      <CloseButton onClose={onClose} />
      <div className="flex flex-col gap-3 p-4">
        <p className={cn('leading-snug', c.anecdote && 'text-lg italic')}>{c.anecdote ? `« ${text} »` : text}</p>
        <p className={cn('flex items-center gap-2 rounded-chip border-2 border-ink px-3 py-2 text-sm font-extrabold', outcome.tone)}>
          <span aria-hidden>{outcome.icon}</span>
          <span className="min-w-0">{outcome.text}</span>
        </p>
      </div>
      <TimeBar color={color} />
    </div>
  )
}

const CARD_AMOUNT_SIGN: Partial<Record<TdpCardDrawn['kind'], 1 | -1>> = { gain: 1, collect_each: 1, friend_gain: 1, pay: -1, pay_each: -1, repairs: -1, friend_pay: -1 }

function DrawnCard({ card, ev, name, onClose }: { card: TdpCardDrawn; ev: TdpLastEvent; name: (id: string | null | undefined) => string; onClose: () => void }) {
  const potes = card.deck === 'potes'
  const color = potes ? '#FF8FA3' : '#8B5CF6'
  const sign = CARD_AMOUNT_SIGN[card.kind]
  return (
    <div className="sticker overflow-hidden bg-surface text-text" onClick={onClose}>
      <div className="flex items-center gap-3 border-b-[3px] border-ink px-4 py-3 pr-14 text-[#1f1b2e]" style={{ backgroundColor: color }}>
        <span className="text-4xl leading-none" aria-hidden>
          {potes ? '🍻' : '❓'}
        </span>
        <div className="min-w-0">
          <p className="truncate font-display text-xl leading-tight font-extrabold">{DECK_NAMES[card.deck]}</p>
          <p className="truncate text-sm font-bold">Carte tirée par {name(ev.player)}</p>
        </div>
      </div>
      <CloseButton onClose={onClose} />
      <div className="flex flex-col gap-3 p-4">
        <p className="font-display text-xl leading-snug font-extrabold">{card.text}</p>
        {card.amount !== null && card.amount !== 0 && sign && (
          <p className={cn('inline-flex w-fit items-center gap-1 rounded-chip border-2 border-ink px-3 py-1.5 font-display text-lg font-extrabold', sign > 0 ? 'bg-mint text-[#1f1b2e]' : 'bg-tomato text-white')}>
            {sign > 0 ? '+' : '−'}
            {eur(Math.abs(card.amount))}
          </p>
        )}
        {(card.kind === 'jail' || card.kind === 'jail_card') && <p className="font-bold text-muted">{card.kind === 'jail' ? '🚔 Direction le violon !' : '🎟️ À garder pour sortir du violon.'}</p>}
      </div>
      <TimeBar color={color} />
    </div>
  )
}
