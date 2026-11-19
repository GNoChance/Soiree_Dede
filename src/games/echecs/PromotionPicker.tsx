import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import { fx } from '@/lib/feedback'
import { PROMOS } from './logic'
import { Piece } from './Piece'
import type { ChessSide, Promo } from './types'

/** Choix de la promotion : 4 gros boutons (dame en premier) par-dessus l'échiquier ; fermer = annuler. */
export function PromotionPicker({ side, onPick, onCancel }: { side: ChessSide; onPick: (p: Promo) => void; onCancel: () => void }) {
  return (
    <motion.div
      className="absolute inset-0 z-20 flex items-center justify-center rounded-[1.1rem] bg-[#1f1b2e]/55 p-3"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onCancel}
    >
      <motion.div
        className="sticker relative flex w-full max-w-xs flex-col gap-2 bg-surface p-3"
        initial={{ scale: 0.7, rotate: -4 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 420, damping: 18 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Promotion du pion"
      >
        <button
          type="button"
          onClick={onCancel}
          className="absolute -top-3 -right-3 flex size-9 items-center justify-center rounded-full border-[3px] border-ink bg-surface shadow-sticker-sm"
          aria-label="Annuler"
        >
          <X className="size-5" />
        </button>
        <p className="text-center font-display text-lg leading-tight font-extrabold">👑 Ton pion devient…</p>
        <div className="grid grid-cols-2 gap-2">
          {PROMOS.map((p, i) => (
            <motion.button
              key={p.id}
              type="button"
              whileTap={{ scale: 0.9 }}
              onClick={() => {
                fx.pop()
                onPick(p.id)
              }}
              className={
                'flex flex-col items-center gap-1 rounded-card border-[3px] border-ink p-2 font-display font-extrabold shadow-sticker-sm ' +
                (i === 0 ? 'bg-sun text-[#1f1b2e]' : 'bg-sunk')
              }
            >
              <span className="size-14">
                <Piece piece={side === 'w' ? p.id.toUpperCase() : p.id} />
              </span>
              {p.label}
            </motion.button>
          ))}
        </div>
      </motion.div>
    </motion.div>
  )
}
