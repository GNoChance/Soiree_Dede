import { equippedOf } from '@/data/cadeaux'
import { usePlayersStore } from '@/features/soiree/players'
import { cn } from '@/lib/cn'

/**
 * Titre équipé d'un joueur (cadeau déco), sous son pseudo. Rien si aucun titre.
 * `slug` -> lu dans l'annuaire des profils ; `title` force un id (aperçu).
 */
export function PlayerTitle({ slug, title, className }: { slug?: string; title?: string | null; className?: string }) {
  const items = usePlayersStore((s) => (title === undefined && slug ? s.list.find((p) => p.slug === slug)?.equippedItems : undefined))
  const def = equippedOf(title === undefined ? items : title ? { title } : null, 'title')
  if (!def) return null
  return (
    <span className={cn('inline-flex max-w-full items-center gap-1 truncate text-xs leading-tight font-extrabold text-muted italic', className)}>
      <span aria-hidden className="not-italic">{def.emoji}</span>
      <span className="truncate">{def.label}</span>
    </span>
  )
}
