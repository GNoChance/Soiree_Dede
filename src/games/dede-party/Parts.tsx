import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { ChibiImage } from '@/components/ui/ChibiImage'
import { cn } from '@/lib/cn'
import { useCountdown } from '@/features/soiree/useServerClock'
import type { GamePlayProps, PlayerInfo } from '../types'
import { dpActions, type DedePartyState, type DpSnap } from './types'

export type Get = (id: string) => PlayerInfo

/** Échéance de la phase : un tick idempotent, ré-essayé toutes les 2,5 s tant que rien ne bouge. */
export function useDeadlineTick(s: DedePartyState, act: GamePlayProps['act'], enabled: boolean) {
  const live = s.phase !== 'finished' && s.phase !== 'aborted'
  const left = useCountdown(live ? s.deadline : null)
  const timeUp = enabled && live && Boolean(s.deadline) && left <= 0
  useEffect(() => {
    if (!timeUp) return
    let t = 0
    let cancelled = false
    const send = async () => {
      if (cancelled) return
      await act(dpActions.tick())
      if (!cancelled) t = window.setTimeout(() => void send(), 2500)
    }
    t = window.setTimeout(() => void send(), 150 + Math.random() * 500)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [timeUp, act, s.deadline])
  return left
}

const PIPS: Record<number, Array<[number, number]>> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [0, 2], [2, 0], [2, 2]],
  5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]],
  6: [[0, 0], [0, 2], [1, 0], [1, 2], [2, 0], [2, 2]],
}

/** Dé sticker (faces à points). `rolling` : les faces défilent. */
export function Die({ value, size = 64, rolling, className }: { value: number | null; size?: number; rolling?: boolean; className?: string }) {
  const [face, setFace] = useState(1 + Math.floor(Math.random() * 6))
  useEffect(() => {
    if (!rolling) return
    const id = window.setInterval(() => setFace(1 + Math.floor(Math.random() * 6)), 110)
    return () => clearInterval(id)
  }, [rolling])
  const v = rolling || !value ? face : value
  const pip = size * 0.17
  return (
    <motion.div
      animate={rolling ? { rotate: [0, -12, 10, -6, 0] } : { rotate: 0 }}
      transition={rolling ? { repeat: Infinity, duration: 0.5 } : { type: 'spring', stiffness: 300, damping: 12 }}
      className={cn('relative shrink-0 rounded-[22%] border-[3px] border-ink bg-white shadow-sticker', className)}
      style={{ width: size, height: size }}
      aria-label={value ? `Dé : ${value}` : 'Dé'}
    >
      <div className="grid size-full grid-cols-3 grid-rows-3 p-[14%]">
        {Array.from({ length: 9 }, (_, i) => {
          const on = (PIPS[v] ?? []).some(([r, c]) => r * 3 + c === i)
          return (
            <span key={i} className="flex items-center justify-center">
              {on && <span className="rounded-full bg-[#1f1b2e]" style={{ width: pip, height: pip }} />}
            </span>
          )
        })}
      </div>
    </motion.div>
  )
}

/** Dédé, l'animatrice (tenue Animateur Télé ; repli : tenue de base + 🎤), et sa bulle. */
export function DedeHost({ line, size = 96, expression = 'joie', side = 'right', big }: { line: string; size?: number; expression?: string; side?: 'right' | 'top'; big?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2', side === 'top' && 'flex-col-reverse')}>
      <motion.div animate={{ rotate: [-3, 3, -3] }} transition={{ repeat: Infinity, duration: 2.4, ease: 'easeInOut' }} className="relative shrink-0">
        <ChibiImage slug="dede" tenue="host" expression={expression} size={size} tenueBadge />
      </motion.div>
      <AnimatePresence mode="popLayout">
        <motion.div
          key={line}
          initial={{ scale: 0.6, opacity: 0, rotate: -4 }}
          animate={{ scale: 1, opacity: 1, rotate: -1 }}
          exit={{ scale: 0.8, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 420, damping: 20 }}
          className={cn('sticker relative min-w-0 bg-surface px-3 py-2 font-display font-extrabold leading-tight', big ? 'text-2xl' : 'text-base')}
        >
          {line}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

/** Pastilles ⭐ / 🪙. */
export function StarsCoins({ stars, coins, big, className }: { stars: number; coins: number; big?: boolean; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 font-display font-extrabold tabular-nums', big ? 'text-2xl' : 'text-base', className)}>
      <span>⭐ {stars}</span>
      <span>🪙 {coins}</span>
    </span>
  )
}

/** Classement courant (étoiles puis pièces), avec rangs ex aequo. */
export function liveRanking(s: DedePartyState, snap: DpSnap) {
  const rows = s.players
    .map((id) => ({ id, stars: snap.stars[id] ?? 0, coins: snap.coins[id] ?? 0 }))
    .sort((a, b) => b.stars - a.stars || b.coins - a.coins || s.order.indexOf(a.id) - s.order.indexOf(b.id))
  return rows.map((r) => ({ ...r, rank: rows.findIndex((x) => x.stars === r.stars && x.coins === r.coins) + 1 }))
}

/** Bandeau des scores : vertical (télé) ou en grille compacte (téléphone). */
export function Scoreboard({ s, snap, get, meId, highlight, big, note }: { s: DedePartyState; snap: DpSnap; get: Get; meId?: string; highlight?: string | null; big?: boolean; note?: (id: string) => React.ReactNode }) {
  const rows = liveRanking(s, snap)
  return (
    <div className={cn('grid gap-1.5', big ? 'grid-cols-1' : 'grid-cols-2')}>
      {rows.map((r) => {
        const p = get(r.id)
        return (
          <motion.div
            layout
            key={r.id}
            className={cn(
              'sticker-sm flex min-w-0 items-center gap-2 px-2 py-1',
              highlight === r.id ? 'bg-sun text-[#1f1b2e]' : r.id === meId ? 'bg-sky/25' : 'bg-surface',
            )}
          >
            <span className={cn('w-5 shrink-0 text-center font-display font-extrabold', big ? 'text-2xl' : 'text-sm')}>{r.rank}</span>
            <Avatar slug={p.slug} tenue={p.equippedTenue} size={big ? 46 : 30} />
            <div className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className={cn('truncate font-extrabold', big ? 'text-xl' : 'text-sm')}>{p.nickname}</span>
              {note && <span className={cn('truncate font-bold opacity-75', big ? 'text-base' : 'text-xs')}>{note(r.id)}</span>}
            </div>
            <span className={cn('flex shrink-0 flex-col items-end font-display font-extrabold tabular-nums leading-tight', big ? 'text-2xl' : 'text-sm')}>
              <span>⭐ {r.stars}</span>
              <span className={cn(big ? 'text-lg' : 'text-xs')}>🪙 {r.coins}</span>
            </span>
          </motion.div>
        )
      })}
    </div>
  )
}

/** Avatars des joueurs qui ont déjà répondu / lancé (les autres grisés). */
export function DoneStrip({ ids, done, get, size = 34 }: { ids: string[]; done: string[]; get: Get; size?: number }) {
  return (
    <div className="flex flex-wrap justify-center gap-1.5">
      {ids.map((id) => {
        const p = get(id)
        const ok = done.includes(id)
        return (
          <motion.div key={id} animate={{ scale: ok ? 1 : 0.85, opacity: ok ? 1 : 0.4 }} className="relative">
            <Avatar slug={p.slug} tenue={p.equippedTenue} size={size} badge={ok ? '✔' : undefined} />
          </motion.div>
        )
      })}
    </div>
  )
}

/** Secondes restantes, en gros. */
export function Countdown({ left, big, className }: { left: number; big?: boolean; className?: string }) {
  const sec = Math.max(0, Math.ceil(left / 1000))
  return (
    <span className={cn('sticker-sm inline-flex items-center justify-center px-2 font-display font-extrabold tabular-nums', sec <= 3 ? 'bg-tomato text-white' : 'bg-surface', big ? 'min-w-16 text-4xl' : 'min-w-10 text-xl', className)}>
      {sec}
    </span>
  )
}
