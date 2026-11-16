/** Billet maison (style sticker : couleur vive, bordure épaisse, pastille et bande claire). */
import type { CSSProperties } from 'react'
import { cn } from '@/lib/cn'
import { BILL_STYLE, type Denom } from './money'

interface BillProps {
  value: Denom
  /** Largeur en px (hauteur = 56 %). */
  w?: number
  className?: string
  style?: CSSProperties
}

export function Bill({ value, w = 36, className, style }: BillProps) {
  const c = BILL_STYLE[value]
  const h = Math.round(w * 0.56)
  return (
    <span
      aria-hidden
      className={cn('relative block shrink-0 overflow-hidden border-ink font-display leading-none font-extrabold', className)}
      style={{
        width: w,
        height: h,
        borderWidth: w >= 30 ? 2 : 1.5,
        borderRadius: Math.max(3, w * 0.14),
        backgroundColor: c.bg,
        color: c.fg,
        ...style,
      }}
    >
      {/* bande claire en biais + pastille : le « filigrane » du billet */}
      <span className="absolute inset-y-[-20%] left-[58%] w-[26%] rotate-[18deg]" style={{ backgroundColor: c.light, opacity: 0.75 }} />
      <span className="absolute top-1/2 left-[9%] aspect-square w-[20%] -translate-y-1/2 rounded-full" style={{ backgroundColor: c.light }} />
      <span className="absolute inset-0 flex items-center justify-center" style={{ fontSize: Math.max(7, w * (value >= 100 ? 0.33 : 0.38)) }}>
        {value}
      </span>
    </span>
  )
}
