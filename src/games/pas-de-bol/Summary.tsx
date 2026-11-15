import { motion, useReducedMotion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { ChibiImage } from '@/components/ui/ChibiImage'
import { mood, pickExpression, playerOrPlaceholder } from '@/features/soiree/players'
import { cn } from '@/lib/cn'
import type { GameSummaryProps } from '../types'
import { PdbCardView } from './Card'
import { sortHand } from './rules'
import type { PdbState } from './types'

const MEDALS = ['🏆', '🥈', '🥉']

/** Fin de partie : ordre de sortie + le perdant (chibi en pleurs) et sa main restante. */
export default function PasDeBolSummary({ state, players, meId }: GameSummaryProps) {
  const s = state as unknown as PdbState
  const reduce = useReducedMotion()
  if (!s.loser) return null
  const loser = playerOrPlaceholder(players, s.loser)
  const hand = sortHand(s.final_hands?.[s.loser] ?? [])
  const n = s.players.length
  const winners = n >= 5 ? 3 : 1

  return (
    <div className="flex flex-col gap-3">
      <motion.div
        initial={{ scale: 0, rotate: 12 }}
        animate={{ scale: 1, rotate: -2 }}
        transition={{ type: 'spring', stiffness: 220, damping: 12, delay: 0.3 }}
        className="sticker relative flex flex-col items-center gap-1 overflow-hidden bg-tomato p-3 text-center text-white"
      >
        <motion.div animate={reduce ? undefined : { rotate: [-3, 3, -3], y: [0, 3, 0] }} transition={{ repeat: Infinity, duration: 0.6 }}>
          <ChibiImage slug={loser.slug} expression={pickExpression(loser, 'pleurs', 'boude', 'colere')} size={130} />
        </motion.div>
        <p className="font-display text-3xl leading-none font-extrabold" style={{ textShadow: '3px 3px 0 #1f1b2e' }}>
          Pas de bol, {s.loser === meId ? 'toi' : loser.nickname} !
        </p>
        <p className="font-bold">
          {s.loser === meId ? 'Tu es resté·e' : 'Resté·e'} avec {hand.length} carte{hand.length > 1 ? 's' : ''} en main.
        </p>
        {hand.length > 0 && (
          <div className="mt-1 flex flex-wrap justify-center gap-1">
            {hand.map((c, i) => (
              <motion.div key={c.id} initial={{ y: -40, opacity: 0, rotate: -20 }} animate={{ y: 0, opacity: 1, rotate: (i % 3) * 4 - 4 }} transition={{ delay: 0.7 + i * 0.06 }}>
                <PdbCardView card={c} w={40} />
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>

      <div className="sticker flex flex-col gap-1.5 bg-surface p-3">
        <p className="font-display font-extrabold">Ordre de sortie</p>
        {[...s.out, s.loser].map((id, i) => {
          const p = playerOrPlaceholder(players, id)
          const last = id === s.loser
          return (
            <motion.div
              key={id}
              initial={{ x: -40, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.2 + i * 0.07 }}
              className={cn('flex items-center gap-2', id === meId && 'font-extrabold')}
            >
              <span className="w-7 text-center text-lg">{last ? '💀' : (MEDALS[i] ?? `${i + 1}.`)}</span>
              <Avatar slug={p.slug} expression={last ? mood(p, 'sad') : i < winners ? mood(p, 'proud') : p.equipped} size={30} />
              <span className="flex-1">{p.nickname}</span>
              <span className="text-sm text-muted">{last ? 'perd' : i < winners ? 'gagne' : `${i + 1}e`}</span>
            </motion.div>
          )
        })}
        <p className="mt-1 text-xs text-muted">
          {n >= 5 ? 'À 5 joueurs et plus, les 3 premiers sortis gagnent.' : 'Le premier sorti gagne.'} Points = joueurs − place.
        </p>
      </div>
    </div>
  )
}
