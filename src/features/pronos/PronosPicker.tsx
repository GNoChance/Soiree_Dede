import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Check } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/cn'
import type { PlayerInfo } from '@/games/types'
import { playerOrPlaceholder } from '@/features/soiree/players'

/**
 * Grille d'avatars « Qui va gagner ? » : 1 tap = pari, un autre tap = on change d'avis
 * (pas de bouton Valider). Purement présentationnel. `caption` : ligne optionnelle sous le pseudo
 * (ex. cote et parieurs des mises de pièces, src/features/mises).
 */
export function PronosPicker({ playerIds, byId, meId, myPick, onPick, disabled, caption }: { playerIds: string[]; byId: Record<string, PlayerInfo>; meId: string; myPick: string | null; onPick: (id: string) => void; disabled?: boolean; caption?: (id: string) => ReactNode }) {
  const reduce = useReducedMotion()
  return (
    <div role="radiogroup" aria-label="Qui va gagner ?" className="grid grid-cols-3 gap-3">
      {playerIds.map((id) => {
        const p = playerOrPlaceholder(byId, id)
        const selected = myPick === id
        return (
          <motion.button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            whileTap={reduce || disabled ? undefined : { scale: 0.92 }}
            onClick={() => onPick(id)}
            className={cn(
              'relative flex min-h-[7rem] min-w-24 flex-col items-center justify-center gap-1 rounded-card border-[3px] border-ink p-2 shadow-sticker-sm transition-colors',
              selected ? 'bg-sun text-[#1f1b2e]' : 'bg-surface',
              disabled && 'opacity-60',
            )}
          >
            <Avatar slug={p.slug} tenue={p.equippedTenue} expression={selected ? 'joie' : undefined} size={64} selected={selected} />
            <span className="max-w-full truncate text-base font-extrabold">{id === meId ? 'Moi' : p.nickname}</span>
            {caption?.(id)}
            {selected && (
              <motion.span
                initial={reduce ? false : { scale: 0, rotate: -30 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 400, damping: 14 }}
                className="absolute -top-2 -right-2 flex size-8 items-center justify-center rounded-full border-[3px] border-ink bg-mint text-[#1f1b2e]"
              >
                <Check className="size-5" strokeWidth={4} />
              </motion.span>
            )}
          </motion.button>
        )
      })}
    </div>
  )
}
