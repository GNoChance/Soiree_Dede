import { motion } from 'framer-motion'
import { getCharacter } from '@/data/characters'
import { guestAvatarOf } from '@/data/guests'
import { cn } from '@/lib/cn'
import { usePlayersStore } from '@/features/soiree/players'
import { ChibiImage } from './ChibiImage'
import { useTenueArt } from './tenueArt'
import { AvatarFrame } from './AvatarFrame'
import { equippedOf } from '@/data/cadeaux'

export interface AvatarProps {
  slug: string
  expression?: string
  /**
   * Tenue du chibi. Non renseignée -> tenue équipée du joueur dans l'annuaire
   * des profils (store `players`), sinon `default`. Tenue sans illustration :
   * repli sur `default` + emoji de la tenue en coin.
   */
  tenue?: string
  /**
   * Cadre (id de cadeau, src/data/cadeaux.ts). Non renseigné -> cadre équipé du joueur dans l'annuaire ;
   * null -> aucun cadre.
   */
  frame?: string | null
  size?: number
  /** Pastille de statut (ex: couronne, check) en bas a droite */
  badge?: React.ReactNode
  /** Fait rebondir l'avatar en continu */
  bounce?: boolean
  selected?: boolean
  className?: string
}

/** Disque sticker (couleur d'accent du perso) + chibi dedans. */
export function Avatar({ slug, expression = 'joie', tenue, frame, size = 56, badge, bounce, selected, className }: AvatarProps) {
  const color = getCharacter(slug)?.color ?? guestAvatarOf(slug)?.color ?? '#FFB703'
  const directoryTenue = usePlayersStore((s) => (tenue === undefined ? s.list.find((p) => p.slug === slug)?.equippedTenue : undefined))
  const wanted = tenue ?? directoryTenue ?? 'default'
  const art = useTenueArt(slug, wanted)
  const directoryItems = usePlayersStore((s) => (frame === undefined ? s.list.find((p) => p.slug === slug)?.equippedItems : undefined))
  const frameDef = equippedOf(frame === undefined ? directoryItems : frame ? { frame } : null, 'frame')?.frame
  return (
    <motion.div
      animate={bounce ? { y: [0, -6, 0] } : undefined}
      transition={bounce ? { repeat: Infinity, duration: 1.4, ease: 'easeInOut' } : undefined}
      className={cn('relative isolate inline-flex shrink-0', className)}
      style={{ width: size, height: size }}
    >
      {frameDef && <AvatarFrame frame={frameDef} size={size} />}
      <div
        className={cn(
          'flex size-full items-center justify-center overflow-hidden rounded-full border-[3px] border-ink shadow-sticker-sm',
          selected && 'ring-4 ring-sun',
        )}
        style={{ backgroundColor: color }}
      >
        <ChibiImage slug={slug} expression={expression} tenue={wanted} size={size * 0.92} bare className="mt-[6%]" />
      </div>
      {art.missingEmoji && (
        <span
          aria-hidden
          className="absolute -bottom-1 -left-1 flex items-center justify-center rounded-full border-2 border-ink bg-surface leading-none"
          style={{ width: Math.max(size * 0.36, 16), height: Math.max(size * 0.36, 16), fontSize: Math.max(size * 0.2, 9) }}
        >
          {art.missingEmoji}
        </span>
      )}
      {badge && (
        <span className="absolute -right-1 -bottom-1 flex size-[38%] items-center justify-center rounded-full border-2 border-ink bg-surface text-[0.7em]">
          {badge}
        </span>
      )}
    </motion.div>
  )
}
