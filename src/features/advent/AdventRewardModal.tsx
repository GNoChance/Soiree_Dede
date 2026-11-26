import { motion, useReducedMotion } from 'framer-motion'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { adventDayItem, getItem, type ItemDef } from '@/data/cadeaux'
import { Rays } from './AdventEffects'
import { ADVENT_TEXTS } from './texts'

export interface AdventReward {
  day: number
  xp: number
  gifts: string[]
}

const SLOT_NAMES: Record<ItemDef['slot'], string> = {
  frame: 'Cadre d’avatar',
  title: 'Titre sous ton pseudo',
  kart: 'Pour Dédé Kart',
  fx_avatar: 'Effet d’avatar',
  fx_entree: 'Effet d’entrée au salon',
  fx_victoire: 'Effet de victoire',
  fx_salon: 'Effet de salon',
  golf_ball: 'Pour le Mini-golf',
  bowling_ball: 'Pour le Bowling',
  chess: 'Pour les Échecs',
  card_back: 'Dos de cartes',
  dice: 'Dés du Menteur',
  marks: 'Croix et ronds du Morpion',
}

/** Surprise du jour : emoji sur un soleil de rayons dorés, texte, XP et cadeaux de la case. */
export function AdventRewardModal({ shown, onClose }: { shown: AdventReward | null; onClose: () => void }) {
  const navigate = useNavigate()
  const reduce = useReducedMotion()
  const text = shown ? ADVENT_TEXTS[shown.day - 1] : null
  return (
    <Modal open={Boolean(shown)} onClose={onClose} title={shown ? `Case n° ${shown.day}` : undefined}>
      {shown && text && (
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="relative flex h-28 w-full items-center justify-center">
            {!reduce && <Rays size={300} loop />}
            <motion.div
              initial={reduce ? false : { scale: 0, rotate: -40 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 220, damping: 9 }}
              className="relative text-7xl"
              style={{ filter: 'drop-shadow(0 4px 0 rgba(31,27,46,.3))' }}
            >
              {text.emoji}
            </motion.div>
          </div>
          <p className="text-lg font-bold">{text.text}</p>
          {shown.xp > 0 && <p className="rounded-chip border-2 border-ink bg-sun px-3 py-1 font-display font-extrabold text-[#1f1b2e]">+{shown.xp} XP</p>}
          {(() => {
            const gifts = (shown.gifts.length ? shown.gifts.map(getItem) : [adventDayItem(shown.day)]).filter(Boolean) as ItemDef[]
            if (!gifts.length) return null
            return (
              <div className="flex w-full flex-col gap-2">
                <p className="font-display font-extrabold">{shown.gifts.length ? (gifts.length > 1 ? 'Tes cadeaux :' : 'Ton cadeau :') : 'Cadeau de cette case :'}</p>
                {gifts.map((g, i) => (
                  <motion.div
                    key={g.id}
                    initial={reduce ? false : { scale: 0, rotate: 12 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: 'spring', stiffness: 260, damping: 10, delay: 0.3 + i * 0.15 }}
                    className="sticker-sm flex items-center gap-3 rounded-card border-[3px] border-ink bg-mint p-2 text-left text-[#1f1b2e]"
                  >
                    <span className="text-3xl leading-none">{g.emoji}</span>
                    <span className="flex flex-col">
                      <span className="font-extrabold">{g.label}</span>
                      <span className="text-xs font-bold">{SLOT_NAMES[g.slot]}</span>
                    </span>
                  </motion.div>
                ))}
                {shown.gifts.length > 0 && (
                  <Button variant="secondary" fullWidth onClick={() => navigate('/inventaire?onglet=deco')}>
                    Équiper mes cadeaux
                  </Button>
                )}
              </div>
            )
          })()}
          <Button fullWidth onClick={onClose}>
            Merci Père Noël !
          </Button>
        </div>
      )}
    </Modal>
  )
}
