import { memo, type CSSProperties } from 'react'
import { ChibiImage } from '@/components/ui/ChibiImage'
import { getCharacter } from '@/data/characters'
import { cn } from '@/lib/cn'
import { COLOR_META, PERSOS, cardLabel } from './rules'
import type { PdbCard, PdbColor } from './types'
import { useMyItem } from '@/features/cadeaux/useMyItem'

/**
 * Cartes « Pas de bol ! » dessinées en CSS + SVG (aucune image externe, sauf
 * le chibi de l'app sur les cartes perso). Ratio 1 : 1,45.
 */

const INK = '#1f1b2e'

/* ---------------------------------------------------------------- symboles maison */

/** Symbole de couleur (lisible sans la couleur : daltonisme). */
export function ColorGlyph({ color, size = 16, className }: { color: PdbColor; size?: number; className?: string }) {
  const fill = COLOR_META[color].hex
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden>
      {color === 'tomate' && (
        <>
          <circle cx="12" cy="14" r="8" fill={fill} stroke={INK} strokeWidth="2" />
          <path d="M12 6 L9 3.5 M12 6 L15 3.5 M12 6 L12 2.5" stroke="#06a37a" strokeWidth="2.4" strokeLinecap="round" />
          <circle cx="9" cy="12" r="1.6" fill="#fff" opacity=".8" />
        </>
      )}
      {color === 'soleil' && (
        <>
          {Array.from({ length: 8 }, (_, i) => (
            <line key={i} x1="12" y1="1.8" x2="12" y2="5" stroke={INK} strokeWidth="2" strokeLinecap="round" transform={`rotate(${i * 45} 12 12)`} />
          ))}
          <circle cx="12" cy="12" r="5.6" fill={fill} stroke={INK} strokeWidth="2" />
        </>
      )}
      {color === 'menthe' && (
        <>
          <path d="M4 20 C4 9 11 4 20 4 C20 13 15 20 4 20 Z" fill={fill} stroke={INK} strokeWidth="2" strokeLinejoin="round" />
          <path d="M5 19 L14 10" stroke={INK} strokeWidth="1.8" strokeLinecap="round" />
        </>
      )}
      {color === 'ciel' && (
        <path
          d="M6.5 18.5 H17.5 A4 4 0 0 0 17.2 10.6 A5.6 5.6 0 0 0 6.6 9.6 A4.5 4.5 0 0 0 6.5 18.5 Z"
          fill={fill}
          stroke={INK}
          strokeWidth="2"
          strokeLinejoin="round"
        />
      )}
    </svg>
  )
}

/** Le bol ! Rayé des 4 couleurs (jokers) ou d'une seule. */
export function Bowl({ size = 48, colors = ['tomate', 'soleil', 'menthe', 'ciel'], upside, className }: { size?: number; colors?: PdbColor[]; upside?: boolean; className?: string }) {
  const id = `bowl-${colors.join('')}-${upside ? 'u' : 'd'}`
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-hidden style={upside ? { transform: 'rotate(180deg)' } : undefined}>
      <defs>
        <clipPath id={id}>
          <path d="M6 26 H58 C58 44 47 54 32 54 C17 54 6 44 6 26 Z" />
        </clipPath>
      </defs>
      {/* vapeur */}
      {!upside && (
        <g stroke={INK} strokeWidth="2.6" fill="none" strokeLinecap="round" opacity=".85">
          <path d="M22 18 C18 14 26 11 22 6" />
          <path d="M32 18 C28 14 36 11 32 6" />
          <path d="M42 18 C38 14 46 11 42 6" />
        </g>
      )}
      <g clipPath={`url(#${id})`}>
        {colors.map((c, i) => (
          <rect key={c} x={6 + (52 / colors.length) * i} y="20" width={52 / colors.length + 0.5} height="40" fill={COLOR_META[c].hex} />
        ))}
        <path d="M6 26 H58 C58 30 56 33 54 35 H10 C8 33 6 30 6 26 Z" fill="#fff" opacity=".35" />
      </g>
      <path d="M6 26 H58 C58 44 47 54 32 54 C17 54 6 44 6 26 Z" fill="none" stroke={INK} strokeWidth="3.2" strokeLinejoin="round" />
      <ellipse cx="32" cy="26" rx="26" ry="4.5" fill="#fff6e5" stroke={INK} strokeWidth="3" />
      <path d="M24 54 H40 L38 59 H26 Z" fill={INK} />
    </svg>
  )
}

function ReverseGlyph({ size, color }: { size: number; color: string }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden>
      <g fill={color} stroke={INK} strokeWidth="3" strokeLinejoin="round">
        <path d="M10 20 C10 11 18 7 26 8 L26 3 L37 12 L26 21 L26 15 C20 14 16 16 16 21 Z" />
        <path d="M38 28 C38 37 30 41 22 40 L22 45 L11 36 L22 27 L22 33 C28 34 32 32 32 27 Z" />
      </g>
    </svg>
  )
}

function SkipGlyph({ size, color }: { size: number; color: string }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden>
      <circle cx="24" cy="24" r="17" fill="#fff" stroke={INK} strokeWidth="3.5" />
      <circle cx="24" cy="24" r="11.5" fill="none" stroke={color} strokeWidth="5" />
      <path d="M15.5 32.5 L32.5 15.5" stroke={INK} strokeWidth="5.5" strokeLinecap="round" />
      <path d="M15.5 32.5 L32.5 15.5" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

/* ---------------------------------------------------------------- carte */

export interface PdbCardViewProps {
  card?: PdbCard | null
  /** Largeur en px (hauteur = ×1,45). */
  w?: number
  /** Dos de carte. */
  back?: boolean
  /** Couleur choisie (jokers posés sur la défausse). */
  chosen?: PdbColor | null
  dim?: boolean
  glow?: boolean
  className?: string
}

const bigText = (w: number, color: string, scale = 0.46): CSSProperties => ({
  fontSize: w * scale,
  color,
  WebkitTextStroke: `${Math.max(1.5, w * 0.03)}px ${INK}`,
  paintOrder: 'stroke fill',
  textShadow: `${w * 0.025}px ${w * 0.03}px 0 ${INK}`,
  lineHeight: 1,
})

function cornerText(c: PdbCard): string {
  if (c.kind === 'num') return String(c.value)
  if (c.kind === 'plus2') return '+2'
  if (c.kind === 'wild4') return '+4'
  return ''
}

function CardFace({ card, w, chosen }: { card: PdbCard; w: number; chosen?: PdbColor | null }) {
  const h = w * 1.45
  const small = w < 56

  if (card.kind === 'perso' && card.perso) {
    const meta = PERSOS[card.perso]
    const accent = getCharacter(card.perso)?.color ?? '#FFB703'
    return (
      <div className="relative flex size-full flex-col items-center overflow-hidden" style={{ background: `linear-gradient(160deg, ${accent} 0%, #fff6e5 120%)` }}>
        <div className="pointer-events-none absolute inset-[5%] rounded-[10%] border-2 border-dashed border-[#1f1b2e]/50" />
        <div className="pointer-events-none absolute inset-0 opacity-30" style={{ backgroundImage: 'radial-gradient(#fff 1.5px, transparent 1.6px)', backgroundSize: `${w / 6}px ${w / 6}px` }} />
        <span className="relative z-10 mt-[6%] max-w-[92%] truncate font-display leading-none font-extrabold text-[#1f1b2e]" style={{ fontSize: Math.max(9, w * 0.17) }}>
          {meta.name}
        </span>
        <div className="relative z-10 -my-[2%]">
          <ChibiImage slug={card.perso} expression={meta.expression} size={Math.round(w * 0.8)} bare />
        </div>
        {!small && (
          <span className="relative z-10 mx-[6%] rounded-full border-2 border-[#1f1b2e] bg-white px-1.5 text-center font-display leading-tight font-extrabold text-[#1f1b2e]" style={{ fontSize: Math.max(8, w * 0.105) }}>
            {meta.title}
          </span>
        )}
        <span className="absolute top-[3%] right-[5%] z-10" style={{ fontSize: w * 0.17 }}>
          {meta.emoji}
        </span>
        {chosen && <ChosenDot color={chosen} w={w} />}
      </div>
    )
  }

  if (card.kind === 'wild' || card.kind === 'wild4') {
    return (
      <div className="relative flex size-full flex-col items-center justify-center overflow-hidden bg-[#2a2458]">
        <div className="pointer-events-none absolute inset-0 opacity-25" style={{ backgroundImage: 'radial-gradient(#fff 1.4px, transparent 1.5px)', backgroundSize: `${w / 5}px ${w / 5}px` }} />
        <Bowl size={w * 0.72} />
        {card.kind === 'wild4' ? (
          <span className="relative z-10 -mt-[6%] font-display font-extrabold" style={bigText(w, '#ffffff', 0.34)}>
            +4
          </span>
        ) : (
          !small && (
            <span className="relative z-10 font-display font-extrabold tracking-wide text-white" style={{ fontSize: w * 0.15 }}>
              JOKER
            </span>
          )
        )}
        {!small && card.kind === 'wild4' && <span className="absolute top-[4%] left-[8%] font-display font-extrabold text-white" style={{ fontSize: w * 0.16 }}>+4</span>}
        {chosen && <ChosenDot color={chosen} w={w} />}
      </div>
    )
  }

  const meta = COLOR_META[card.color ?? 'tomate']
  const corner = cornerText(card)
  const underline = card.kind === 'num' && (card.value === 6 || card.value === 9)
  return (
    <div className="relative flex size-full items-center justify-center overflow-hidden" style={{ backgroundColor: meta.hex }}>
      <div className="pointer-events-none absolute inset-0 opacity-25" style={{ backgroundImage: 'radial-gradient(#fff 1.5px, transparent 1.6px)', backgroundSize: `${w / 6}px ${w / 6}px` }} />
      {/* médaillon central (un bol vu de dessus) */}
      <div
        className="absolute rounded-full border-[3px] border-[#1f1b2e] bg-[#fff6e5]"
        style={{ width: w * 0.8, height: w * 0.8, top: (h - w * 0.8) / 2, boxShadow: `inset 0 ${-w * 0.06}px 0 ${meta.hex}55` }}
      />
      <div className="relative z-10 flex flex-col items-center">
        {card.kind === 'num' || card.kind === 'plus2' ? (
          <span className={cn('font-display font-extrabold', underline && 'underline decoration-[0.08em] underline-offset-[0.08em]')} style={bigText(w, meta.hex, card.kind === 'plus2' ? 0.4 : 0.52)}>
            {corner}
          </span>
        ) : card.kind === 'reverse' ? (
          <ReverseGlyph size={w * 0.58} color={meta.hex} />
        ) : (
          <SkipGlyph size={w * 0.6} color={meta.hex} />
        )}
      </div>
      {!small && (
        <>
          <span className="absolute top-[3%] left-[7%] font-display font-extrabold" style={bigText(w, '#fff', 0.17)}>
            {corner || (card.kind === 'reverse' ? '⇄' : '⊘')}
          </span>
          <ColorGlyph color={card.color ?? 'tomate'} size={w * 0.2} className="absolute right-[6%] bottom-[4%]" />
        </>
      )}
    </div>
  )
}

function ChosenDot({ color, w }: { color: PdbColor; w: number }) {
  return (
    <span
      className="absolute right-[5%] bottom-[4%] z-20 flex items-center justify-center rounded-full border-2 border-[#1f1b2e] bg-white"
      style={{ width: w * 0.3, height: w * 0.3 }}
    >
      <ColorGlyph color={color} size={w * 0.22} />
    </span>
  )
}

export function CardBack({ w }: { w: number }) {
  // Dos de cartes acheté en boutique (sur mon écran), sinon le dos « Pas de bol » d'origine.
  const skin = useMyItem('card_back')?.cardBack
  return (
    <div className={cn('relative flex size-full flex-col items-center justify-center overflow-hidden', !skin && 'bg-grape')} style={skin ? { background: skin.bg } : undefined}>
      {!skin && <div className="pointer-events-none absolute inset-0 opacity-30" style={{ backgroundImage: 'repeating-linear-gradient(45deg, #fff 0 2px, transparent 2px 10px)' }} />}
      <div className="pointer-events-none absolute inset-[7%] rounded-[12%] border-2 border-white/70" />
      {skin ? (
        skin.emoji && <span className="relative z-10 leading-none drop-shadow-[2px_2px_0_rgba(0,0,0,0.35)]" style={{ fontSize: w * 0.38 }}>{skin.emoji}</span>
      ) : (
        <Bowl size={w * 0.62} upside colors={['tomate', 'soleil', 'menthe', 'ciel']} />
      )}
      {w >= 50 && (
        <span className="relative z-10 -mt-[4%] -rotate-6 font-display leading-none font-extrabold whitespace-nowrap" style={bigText(w, '#FFB703', 0.16)}>
          Pas de bol !
        </span>
      )}
    </div>
  )
}

/** Une carte (face ou dos). */
export const PdbCardView = memo(function PdbCardView({ card, w = 72, back, chosen, dim, glow, className }: PdbCardViewProps) {
  const h = Math.round(w * 1.45)
  return (
    <div
      className={cn('relative shrink-0 overflow-hidden border-[3px] border-[#1f1b2e] bg-white select-none', dim && 'brightness-[.62] saturate-[.6]', className)}
      style={{
        width: w,
        height: h,
        borderRadius: w * 0.14,
        boxShadow: glow ? `0 0 0 3px #fff6e5, 0 0 18px 6px #FFB703, 3px 3px 0 0 ${INK}` : `3px 3px 0 0 ${INK}`,
      }}
      role="img"
      aria-label={back || !card ? 'Carte cachée' : cardLabel(card)}
    >
      {back || !card ? <CardBack w={w} /> : <CardFace card={card} w={w} chosen={chosen} />}
    </div>
  )
})
