import { LayoutGroup, motion } from 'framer-motion'
import { Trophy } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/cn'
import { mood } from '@/features/soiree/players'
import { useCountdown } from '@/features/soiree/useServerClock'
import { useUrgentTicks } from '@/hooks/useUrgentTicks'
import { useViewport } from '@/features/tv/tv'
import type { PlayerInfo } from '../types'

/** Briques communes des vues télé de « Qui de nous ? » et « Tu préfères ? » (lecture seule, state public). */

export type TvGet = (id: string) => PlayerInfo

/** Taille relative à la hauteur de l'écran (la télé est en paysage). */
export const vh = (n: number) => `${n}vh`

/** Gros chrono : barre (si `totalMs`) + secondes en grand, qui rougit dans les 5 dernières secondes. */
export function TvTimer({ deadline, totalMs, label }: { deadline: string | null | undefined; totalMs?: number; label?: string }) {
  const left = useCountdown(deadline, 100)
  const secs = Math.max(0, Math.ceil(left / 1000))
  useUrgentTicks(secs, Boolean(deadline))
  if (!deadline) return null
  const pct = totalMs ? Math.max(0, Math.min(100, (left / totalMs) * 100)) : 100
  const urgent = secs <= 5
  const color = pct > 50 ? 'bg-mint' : pct > 25 ? 'bg-sun' : 'bg-tomato'
  return (
    <div className="flex items-center gap-[2vh]">
      {totalMs ? (
        <div className="relative flex-1 overflow-hidden rounded-full border-[0.5vh] border-ink bg-sunk shadow-sticker-sm" style={{ height: vh(4.5) }}>
          <motion.div className={cn('h-full rounded-full', color)} animate={{ width: `${pct}%` }} transition={{ ease: 'linear', duration: 0.1 }} />
        </div>
      ) : (
        label && <span className="flex-1 text-center font-display font-extrabold" style={{ fontSize: vh(4) }}>{label}</span>
      )}
      <motion.span
        key={urgent ? secs : 'calm'}
        initial={urgent ? { scale: 1.6, rotate: -8 } : false}
        animate={{ scale: 1, rotate: 0 }}
        className={cn('flex shrink-0 items-center justify-center rounded-full border-[0.6vh] border-ink font-display font-extrabold shadow-sticker', urgent ? 'bg-tomato text-white' : 'bg-surface')}
        style={{ width: vh(11), height: vh(11), fontSize: vh(6) }}
      >
        {secs}
      </motion.span>
    </div>
  )
}

/** Qui a déjà répondu / voté : une tête par joueur, éveillée avec une coche, ou grisée en attente. Jamais le choix. */
export function TvAnswered({ ids, done, get, size = 9 }: { ids: string[]; done: string[]; get: TvGet; size?: number }) {
  const px = Math.round((size * useViewport().h) / 100)
  return (
    <div className="flex flex-wrap items-end justify-center" style={{ gap: vh(2) }}>
      {ids.map((id) => {
        const p = get(id)
        const ok = done.includes(id)
        return (
          <motion.div key={id} animate={ok ? { y: [0, -8, 0], scale: 1 } : { scale: 0.92 }} transition={{ duration: 0.4 }} className={cn('flex flex-col items-center', !ok && 'opacity-45 grayscale')}>
            <Avatar slug={p.slug} tenue={p.equippedTenue} expression={ok ? mood(p, 'happy') : mood(p, 'sleepy')} size={px} badge={ok ? '✓' : undefined} />
            <span className="max-w-[12vh] truncate font-display font-extrabold" style={{ fontSize: vh(2.6) }}>{p.nickname}</span>
          </motion.div>
        )
      })}
    </div>
  )
}

/** Classement cumulé (bande en bas d'écran). `gains` : points de la manche, affichés en « +N ». */
export function TvScores({ players, scores, get, gains, id }: { players: string[]; scores: Record<string, number>; get: TvGet; gains?: Record<string, number>; id: string }) {
  const sorted = [...players].sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0))
  const lead = sorted.length ? (scores[sorted[0]] ?? 0) : 0
  const px = Math.round((useViewport().h * 6) / 100)
  return (
    <LayoutGroup id={id}>
      <div className="flex flex-wrap items-center justify-center" style={{ gap: vh(1.5) }}>
        <Trophy className="shrink-0" style={{ width: vh(4), height: vh(4) }} strokeWidth={3} />
        {sorted.map((pid, i) => {
          const p = get(pid)
          const sc = scores[pid] ?? 0
          const g = gains?.[pid] ?? 0
          return (
            <motion.div
              layout
              key={pid}
              transition={{ type: 'spring', stiffness: 300, damping: 26 }}
              className={cn('sticker-sm flex items-center bg-surface', lead > 0 && sc === lead && 'bg-sun text-[#1f1b2e]')}
              style={{ gap: vh(1), padding: `${vh(0.4)} ${vh(1.6)} ${vh(0.4)} ${vh(0.4)}` }}
            >
              <span className="font-display font-extrabold opacity-60" style={{ fontSize: vh(2.4) }}>{i + 1}</span>
              <Avatar slug={p.slug} tenue={p.equippedTenue} size={px} />
              <span className="max-w-[14vh] truncate font-display font-extrabold" style={{ fontSize: vh(3) }}>{p.nickname}</span>
              <span className="font-display font-extrabold" style={{ fontSize: vh(4) }}>{sc}</span>
              {g > 0 && (
                <motion.span initial={{ scale: 2.5 }} animate={{ scale: 1 }} className="rounded-full bg-mint px-[0.8vh] font-display font-extrabold text-[#1f1b2e]" style={{ fontSize: vh(2.6) }}>
                  +{g}
                </motion.span>
              )}
            </motion.div>
          )
        })}
      </div>
    </LayoutGroup>
  )
}

/** « Dilemme suivant dans N s » en très gros. */
export function TvNextIn({ deadline, label }: { deadline: string | null | undefined; label: string }) {
  const left = useCountdown(deadline)
  if (!deadline) return null
  return (
    <p className="text-center font-display font-extrabold text-muted" style={{ fontSize: vh(3.4) }}>
      {label} {Math.max(0, Math.ceil(left / 1000))} s
    </p>
  )
}
