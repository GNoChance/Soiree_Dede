import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/cn'
import { mood } from '@/features/soiree/players'
import type { PlayerInfo } from '../types'
import { pickedUp } from './holes'
import { MARK_DOT, markOf, ranking } from './logic'
import type { MiniGolfState } from './types'

type Get = (id: string) => PlayerInfo

/** Fin de trou : classement provisoire, coups de chacun sur ce trou, montées / descentes. */
export function HoleEnd({ s, get, meId, left, big }: { s: MiniGolfState; get: Get; meId: string; left: number; big?: boolean }) {
  const rows = useMemo(() => ranking(s, s.hole + 1), [s])
  const before = useMemo(() => Object.fromEntries(ranking(s, s.hole).map((r) => [r.id, r.rank])), [s])
  const par = s.pars[s.hole] ?? 3
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-40 flex items-center justify-center bg-ink/40 p-3">
      <motion.div initial={{ y: 60, scale: 0.9 }} animate={{ y: 0, scale: 1 }} className={cn('sticker flex w-full flex-col gap-2 bg-surface p-3', big ? 'max-w-3xl' : 'max-w-sm')}>
        <div className="flex items-center justify-between gap-2">
          <span className={cn('font-display font-extrabold', big ? 'text-4xl' : 'text-xl')}>Après le trou {s.hole + 1}</span>
          <span className="sticker-sm bg-sun px-2 font-display font-extrabold text-[#1f1b2e] tabular-nums">{Math.ceil(left / 1000)} s</span>
        </div>
        {rows.map((r, i) => {
          const p = get(r.id)
          const sc = s.cards?.[r.id]?.[s.hole]
          const delta = s.hole > 0 ? (before[r.id] ?? r.rank) - r.rank : 0
          return (
            <motion.div
              key={r.id}
              initial={{ x: -30, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.08 * i }}
              className={cn('flex items-center gap-2 rounded-chip border-2 border-ink px-2 py-1', r.id === meId ? 'bg-sun/40' : 'bg-paper')}
            >
              <span className={cn('w-6 text-center font-display font-extrabold', big ? 'text-3xl' : 'text-xl')}>{r.rank}</span>
              <Avatar slug={p.slug} tenue={p.equippedTenue} expression={mood(p, r.rank === 1 ? 'proud' : sc !== undefined && sc > par ? 'sad' : 'happy')} size={big ? 56 : 36} />
              <span className={cn('min-w-0 flex-1 truncate font-extrabold', big && 'text-2xl')}>{p.nickname}</span>
              {sc !== undefined && (
                <span className={cn('font-bold', big ? 'text-xl' : 'text-sm')}>
                  {MARK_DOT[markOf(sc, par)]} {sc >= pickedUp(par) ? `🧺 ${sc}` : sc}
                </span>
              )}
              <span className={cn('w-10 text-right font-display font-extrabold tabular-nums', big ? 'text-3xl' : 'text-xl')}>{r.total}</span>
              <span className={cn('w-5 text-center text-sm font-extrabold', delta > 0 ? 'text-mint' : delta < 0 ? 'text-tomato' : 'text-muted')}>{delta > 0 ? '▲' : delta < 0 ? '▼' : '•'}</span>
            </motion.div>
          )
        })}
      </motion.div>
    </motion.div>
  )
}
