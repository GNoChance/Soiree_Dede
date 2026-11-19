import { AnimatePresence, motion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/cn'
import { playerOrPlaceholder } from '@/features/soiree/players'
import { TEAM_INFO } from '@/features/teams/teams'
import type { PlayerInfo } from '../types'
import { SUIT_GLYPH, isRed, rankOf, suitOf } from './logic'
import type { KemsFeedItem, KemsState } from './types'

/** Petite carte en texte (« 7♥ ») pour le fil des échanges. */
export function CardChip({ card, big }: { card: string; big?: boolean }) {
  return (
    <span
      className={cn('inline-flex items-center rounded-md border-2 border-ink bg-white px-1 font-display font-extrabold leading-tight', big ? 'text-2xl' : 'text-sm')}
      style={{ color: isRed(card) ? '#d62839' : '#1f1b2e' }}
    >
      {rankOf(card)}
      {SUIT_GLYPH[suitOf(card)]}
    </span>
  )
}

/** Scores par équipe (pastilles) + objectif. */
export function ScorePills({ s, meTeam, big }: { s: KemsState; meTeam?: string | null; big?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {s.teams.map((t) => {
        const meta = TEAM_INFO[t.id]
        const mine = meTeam === t.id
        return (
          <span
            key={t.id}
            className={cn('sticker-sm flex items-center gap-1.5 rounded-full px-3 py-1 font-display font-extrabold', big ? 'text-4xl' : 'text-lg', mine && 'ring-4 ring-sun')}
            style={{ backgroundColor: meta.soft, color: '#1f1b2e' }}
            aria-label={`${meta.short} : ${t.score} sur ${s.target}`}
          >
            {meta.emoji}
            <motion.span key={t.score} initial={{ scale: 1.8 }} animate={{ scale: 1 }} className="tabular-nums">
              {t.score}
            </motion.span>
            <span className={cn('font-bold opacity-60', big ? 'text-2xl' : 'text-xs')}>/{s.target}</span>
          </span>
        )
      })}
    </div>
  )
}

/** Fil des derniers échanges (public, comme à la vraie table). */
export function Feed({ items, players, count = 3, big }: { items: KemsFeedItem[]; players: Record<string, PlayerInfo>; count?: number; big?: boolean }) {
  return (
    <ul className={cn('flex flex-col', big ? 'gap-2' : 'gap-1')} aria-label="Derniers échanges">
      <AnimatePresence initial={false} mode="popLayout">
        {items.slice(0, count).map((f) => {
          const p = playerOrPlaceholder(players, f.by)
          return (
            <motion.li
              key={f.n}
              layout
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              className={cn('flex items-center gap-1.5 font-bold', big ? 'text-xl' : 'text-xs')}
            >
              <Avatar slug={p.slug} tenue={p.equippedTenue} size={big ? 40 : 22} />
              <span className="max-w-[6.5rem] truncate">{p.nickname}</span>
              <span className="text-muted">prend</span>
              <CardChip card={f.took} big={big} />
              <span className="text-muted">pose</span>
              <CardChip card={f.gave} big={big} />
            </motion.li>
          )
        })}
      </AnimatePresence>
      {items.length === 0 && <li className={cn('text-muted', big ? 'text-xl' : 'text-xs')}>Aucun échange pour l’instant… à vos cartes !</li>}
    </ul>
  )
}
