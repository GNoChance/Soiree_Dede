import { motion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/cn'
import { mood } from '@/features/soiree/players'
import type { PlayerInfo } from '@/games/types'

/** Un « moment de la partie » : petite carte taquine affichée sur l'écran de fin. */
export interface Moment {
  key: string
  emoji: string
  title: string
  /** Joueurs concernés (ex aequo : plusieurs) ; vide = pas d'avatar. */
  ids?: string[]
  text: string
}

/** Meilleur(s) joueur(s) d'un compteur (ex aequo inclus) ; null si le max est ≤ 0. */
export function topOf(ids: string[], value: (id: string) => number | undefined | null): { ids: string[]; value: number } | null {
  let max = 0
  for (const id of ids) max = Math.max(max, value(id) ?? 0)
  if (max <= 0) return null
  return { ids: ids.filter((id) => (value(id) ?? 0) === max), value: max }
}

/** Liste de noms « A, B et C ». */
export function names(ids: string[], get: (id: string) => PlayerInfo): string {
  const n = ids.map((id) => get(id).nickname)
  return n.length > 1 ? `${n.slice(0, -1).join(', ')} et ${n[n.length - 1]}` : (n[0] ?? '')
}

const TINTS = ['bg-grape/20', 'bg-sky/25', 'bg-sun/30', 'bg-mint/25']

/** Cartes « Moments de la partie » (masquées si la liste est vide). */
export function Moments({ moments, get, tv, title = '🎬 Les moments de la partie' }: { moments: Moment[]; get: (id: string) => PlayerInfo; tv?: boolean; title?: string }) {
  if (!moments.length) return null
  return (
    <div className="flex flex-col gap-1.5">
      <span className={cn('font-display font-extrabold', tv && 'text-xl')}>{title}</span>
      {moments.map((m, i) => {
        const first = m.ids?.[0]
        const p = first ? get(first) : null
        return (
          <motion.div
            key={m.key}
            initial={{ opacity: 0, x: -24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 1.4 + i * 0.12 }}
            className={cn('sticker-sm flex items-center gap-2 px-2 py-1.5', TINTS[i % TINTS.length])}
          >
            {p ? (
              <Avatar slug={p.slug} tenue={p.equippedTenue} expression={mood(p, 'happy')} size={tv ? 48 : 36} />
            ) : (
              <span className={tv ? 'text-4xl' : 'text-3xl'}>{m.emoji}</span>
            )}
            <span className={cn('min-w-0 text-sm leading-tight font-bold', tv && 'text-lg')}>
              <span className="font-display font-extrabold">
                {m.emoji} {m.title}
              </span>
              <br />
              {m.text}
            </span>
          </motion.div>
        )
      })}
    </div>
  )
}
