import { memo } from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/cn'
import { SUIT_GLYPH, cardSpoken, isRed, rankOf, suitOf } from './logic'
import { useMyItem } from '@/features/cadeaux/useMyItem'

const INK = '#1f1b2e'
const RED = '#d62839'

/**
 * Carte classique (valeur + couleur en gros, contour épais). Blanche en thème clair comme sombre
 * pour rester lisible ; ♥♦ rouges, ♠♣ encre. Se dimensionne par sa largeur (container queries).
 */
export const KemsCard = memo(function KemsCard({
  card,
  onClick,
  selected,
  glow,
  dim,
  mini,
  label,
  className,
}: {
  card: string
  onClick?: () => void
  selected?: boolean
  /** Halo doré (carré). */
  glow?: boolean
  dim?: boolean
  /** Petite carte (fil, révélation) : sans interaction. */
  mini?: boolean
  label?: string
  className?: string
}) {
  const color = isRed(card) ? RED : INK
  const glyph = SUIT_GLYPH[suitOf(card)]
  const body = (
    <div className="relative size-full" style={{ containerType: 'inline-size', color }}>
      <span className="absolute left-[9%] top-[3%] flex flex-col items-center font-display font-extrabold leading-[0.95]" style={{ fontSize: '33cqw' }}>
        {rankOf(card)}
        <span style={{ fontSize: '25cqw' }}>{glyph}</span>
      </span>
      <span className="absolute bottom-[4%] right-[9%] leading-none" style={{ fontSize: '58cqw' }}>
        {glyph}
      </span>
    </div>
  )
  const cls = cn(
    'relative block aspect-[5/7] w-full overflow-hidden border-[3px] border-ink bg-white',
    mini ? 'rounded-md border-2' : 'rounded-xl',
    selected ? 'shadow-[0_0_0_4px_#ffb703]' : glow ? 'shadow-[0_0_0_4px_#06d6a0,0_0_18px_4px_#06d6a0aa]' : mini ? '' : 'shadow-sticker-sm',
    dim && 'opacity-50',
    className,
  )
  if (!onClick) return <div className={cls}>{body}</div>
  return (
    <motion.button
      type="button"
      layout
      onClick={onClick}
      aria-label={label ?? cardSpoken(card)}
      aria-pressed={selected}
      animate={{ y: selected ? -10 : 0, scale: selected ? 1.05 : 1 }}
      whileTap={{ scale: 0.94 }}
      transition={{ type: 'spring', stiffness: 520, damping: 22 }}
      className={cls}
    >
      {body}
    </motion.button>
  )
})

/** Dos de carte (pioche). */
export function CardBack({ className }: { className?: string }) {
  // Dos de cartes acheté en boutique (sur mon écran), sinon les rayures d'origine.
  const skin = useMyItem('card_back')?.cardBack
  return (
    <div
      aria-hidden
      className={cn('flex aspect-[5/7] w-full items-center justify-center overflow-hidden rounded-md border-2 border-ink', className)}
      style={{ background: skin?.bg ?? 'repeating-linear-gradient(45deg, #ef476f 0 6px, #ffb703 6px 12px)', containerType: 'inline-size' }}
    >
      {skin?.emoji && <span className="leading-none" style={{ fontSize: '45cqw' }}>{skin.emoji}</span>}
    </div>
  )
}
