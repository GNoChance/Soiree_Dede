import { usePlayersStore } from '@/features/soiree/players'
import { cn } from '@/lib/cn'

/** Petit badge « ✍️ par Mika » affiché sur une carte maison en jeu (rien si la carte est de base). */
export function AuthorBadge({ by, className }: { by?: string | null; className?: string }) {
  const nickname = usePlayersStore((s) => (by ? s.byId[by]?.nickname : undefined))
  if (!by) return null
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 truncate rounded-chip border-2 border-ink bg-surface px-2 py-0.5 font-display text-xs font-extrabold text-text shadow-sticker-sm',
        className,
      )}
    >
      <span aria-hidden>✍️</span>
      <span className="truncate">par {nickname ?? 'un pote'}</span>
    </span>
  )
}
