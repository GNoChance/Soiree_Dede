import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/cn'
import { mood, playerOrPlaceholder } from '@/features/soiree/players'
import type { GameSummaryProps, PlayerInfo } from '../types'
import type { TpHistoryEntry, TpState } from './types'
import { computeHighlights, percents } from './setup'

/** Bloc fin de partie : le plus rebelle, le plus dans la norme, le devin, et les dilemmes marquants. */
export default function TuPreferesSummary({ state, players }: GameSummaryProps) {
  const s = state as unknown as TpState
  const h = computeHighlights(s)
  const get = (id: string) => playerOrPlaceholder(players, id)
  if (!h.rebel && !h.norm && !h.oracle && !h.split && !h.unanimous) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 1.2 }}
      className="sticker flex flex-col gap-3 bg-surface p-4"
    >
      <p className="font-display text-xl font-extrabold">Les stats qui fâchent 🤔</p>
      <div className="flex flex-col gap-2">
        {h.rebel && <Award p={get(h.rebel.id)} expr="sly" title="Le plus rebelle" detail={`seul·e de son avis ${h.rebel.count} fois`} emoji="🤘" i={0} />}
        {h.norm && (
          <Award p={get(h.norm.id)} expr="happy" title="Le plus dans la norme" detail={`avec la majorité ${h.norm.count}/${h.norm.answered} fois`} emoji="🐑" i={1} />
        )}
        {h.oracle && <Award p={get(h.oracle.id)} expr="proud" title="Le devin" detail={`${h.oracle.count} pari${h.oracle.count > 1 ? 's' : ''} juste${h.oracle.count > 1 ? 's' : ''}`} emoji="🔮" i={2} />}
      </div>
      {h.split && <DilemmaStat h={h.split} title="Le dilemme qui divise" emoji="⚖️" />}
      {h.unanimous && <DilemmaStat h={h.unanimous} title="Le plus unanime" emoji="🤝" />}
    </motion.div>
  )
}

function Award({ p, expr, title, detail, emoji, i }: { p: PlayerInfo; expr: 'sly' | 'happy' | 'proud'; title: string; detail: string; emoji: string; i: number }) {
  return (
    <motion.div
      initial={{ x: -40, opacity: 0, rotate: -3 }}
      animate={{ x: 0, opacity: 1, rotate: 0 }}
      transition={{ delay: 1.4 + i * 0.15, type: 'spring', stiffness: 300, damping: 18 }}
      className="flex items-center gap-3 rounded-chip bg-sunk p-2"
    >
      <Avatar slug={p.slug} expression={mood(p, expr)} size={48} />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-muted">
          {emoji} {title}
        </p>
        <p className="truncate font-display text-lg font-extrabold">
          {p.nickname} <span className="text-sm font-bold text-muted">· {detail}</span>
        </p>
      </div>
    </motion.div>
  )
}

function DilemmaStat({ h, title, emoji }: { h: TpHistoryEntry; title: string; emoji: string }): ReactNode {
  const pct = percents(h.counts)
  return (
    <div className="flex flex-col gap-1.5 rounded-chip bg-sunk p-2">
      <p className="text-sm text-muted">
        {emoji} {title}
      </p>
      <div className="grid grid-cols-2 gap-2 text-sm leading-snug font-bold">
        <span>{h.dilemma.a}</span>
        <span className="text-right">{h.dilemma.b}</span>
      </div>
      <div className="flex h-6 overflow-hidden rounded-full border-2 border-ink">
        {(['a', 'b'] as const).map((side) => (
          <motion.div
            key={side}
            initial={{ width: '50%' }}
            animate={{ width: `${pct[side]}%` }}
            transition={{ delay: 1.8, type: 'spring', stiffness: 120, damping: 16 }}
            className={cn(
              'flex items-center overflow-hidden font-display text-xs font-extrabold whitespace-nowrap',
              side === 'a' ? 'justify-start bg-tomato pl-2 text-white' : 'justify-end bg-sky pr-2 text-[#1f1b2e]',
            )}
          >
            {pct[side] >= 15 && `${pct[side]} %`}
          </motion.div>
        ))}
      </div>
    </div>
  )
}
