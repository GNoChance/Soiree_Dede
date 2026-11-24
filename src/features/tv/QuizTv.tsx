import { useEffect, type ReactNode } from 'react'
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { burst } from '@/components/ui/confetti'
import { cn } from '@/lib/cn'
import { mood } from '@/features/soiree/players'
import { useCountdown } from '@/features/soiree/useServerClock'
import { useUrgentTicks } from '@/hooks/useUrgentTicks'
import { useViewport } from '@/features/tv/tv'
import type { PlayerInfo } from '@/games/types'

/**
 * Briques grand écran partagées par les quiz en vue télé (Cerveau en fête, Le plus proche) :
 * chrono géant, tableau des scores animé, avatars « allumés », podium de fin.
 * Tailles en vmin / px dérivés de la fenêtre : lisible à 3 m. Aucune donnée secrète.
 */

const MEDALS = ['🥇', '🥈', '🥉']

/** Chrono géant : barre épaisse + gros chiffre (rouge et qui pulse sur les 5 dernières secondes). */
export function TvTimer({ deadline, totalMs }: { deadline: string | null; totalMs: number }) {
  const left = useCountdown(deadline, 100)
  const secs = Math.ceil(left / 1000)
  useUrgentTicks(secs, Boolean(deadline))
  const pct = Math.max(0, Math.min(100, (left / totalMs) * 100))
  const urgent = secs <= 5
  const color = pct > 50 ? 'bg-mint' : pct > 25 ? 'bg-sun' : 'bg-tomato'
  return (
    <div className="flex items-center gap-[2vmin]">
      <div className="relative h-[4vmin] flex-1 overflow-hidden rounded-full border-4 border-ink bg-sunk shadow-sticker">
        <motion.div className={cn('h-full rounded-full', color)} animate={{ width: `${pct}%` }} transition={{ ease: 'linear', duration: 0.1 }} />
      </div>
      <motion.span
        key={urgent ? secs : 'calm'}
        initial={urgent ? { scale: 1.5, rotate: -8 } : false}
        animate={{ scale: 1, rotate: 0 }}
        className={cn(
          'flex size-[10vmin] shrink-0 items-center justify-center rounded-full border-4 border-ink font-display text-[5.5vmin] font-extrabold shadow-sticker',
          urgent ? 'bg-tomato text-white' : 'bg-surface',
        )}
      >
        {secs}
      </motion.span>
    </div>
  )
}

export type TvDot = {
  id: string
  /** Allumé (a trouvé / répondu). */
  lit: boolean
  /** Passé / raté : grisé avec une pastille. */
  out?: boolean
  badge?: string
  /** Mini étiquette (rang d'arrivée…). */
  tag?: string
  expression: string
}

/** Rangée d'avatars qui s'allument (sans jamais montrer ce qui a été saisi). */
export function TvDots({ dots, get }: { dots: TvDot[]; get: (id: string) => PlayerInfo }) {
  const { h } = useViewport()
  const size = Math.round(Math.max(56, Math.min(120, h * 0.11)))
  return (
    <div className="flex flex-wrap items-end justify-center gap-[2vmin]">
      {dots.map((d) => {
        const p = get(d.id)
        return (
          <motion.div
            key={d.id}
            animate={d.lit ? { scale: [1, 1.3, 1], y: [0, -16, 0], opacity: 1 } : { scale: 1, opacity: d.out ? 0.4 : 0.7 }}
            transition={{ duration: 0.5 }}
            className={cn('flex flex-col items-center', !d.lit && 'grayscale')}
          >
            <div className={cn('relative rounded-full', d.lit && 'ring-[6px] ring-mint')}>
              <Avatar slug={p.slug} expression={d.expression} size={size} badge={d.badge} />
              {d.tag && (
                <motion.span
                  initial={{ scale: 0, rotate: -40 }}
                  animate={{ scale: 1, rotate: -8 }}
                  transition={{ type: 'spring', stiffness: 600, damping: 12 }}
                  className="absolute -top-3 -right-5 rounded-full border-[3px] border-ink bg-mint px-2 font-display text-[2.2vmin] font-extrabold text-[#1f1b2e] shadow-sticker-sm"
                >
                  {d.tag}
                </motion.span>
              )}
            </div>
            <span className="mt-1 max-w-[16vmin] truncate font-display text-[2.4vmin] font-extrabold">{p.nickname}</span>
          </motion.div>
        )
      })}
    </div>
  )
}

/** Classement vertical animé (colonne de droite). `deltas` = points gagnés à afficher. */
export function TvScores({ ids, scores, deltas, get }: { ids: string[]; scores: (id: string) => number; deltas?: Record<string, number>; get: (id: string) => PlayerInfo }) {
  const { h } = useViewport()
  const sorted = [...ids].sort((a, b) => scores(b) - scores(a))
  const avatar = Math.round(Math.max(34, Math.min(72, (h * 0.8) / Math.max(5, sorted.length) - 14)))
  return (
    <div className="sticker flex min-h-0 flex-col gap-[1vmin] overflow-hidden bg-sunk p-[1.5vmin]">
      <p className="font-display text-[3vmin] font-extrabold">🏆 Classement</p>
      <LayoutGroup>
        <div className="flex min-h-0 flex-1 flex-col justify-around gap-[0.8vmin]">
          {sorted.map((id, i) => {
            const p = get(id)
            const sc = scores(id)
            const d = deltas?.[id]
            return (
              <motion.div
                layout
                key={id}
                transition={{ type: 'spring', stiffness: 320, damping: 26 }}
                className="flex items-center gap-[1.2vmin] rounded-chip bg-surface px-[1vmin] py-[0.6vmin]"
              >
                <span className="w-[4.5vmin] text-center font-display text-[3vmin] font-extrabold">{i === 0 && sc > 0 ? '👑' : i + 1}</span>
                <Avatar slug={p.slug} size={avatar} expression={i === 0 && sc > 0 ? mood(p, 'proud') : p.equipped} />
                <span className="min-w-0 flex-1 truncate font-display text-[2.8vmin] font-extrabold">{p.nickname}</span>
                <AnimatePresence>
                  {d ? (
                    <motion.span
                      key={`d${d}`}
                      initial={{ scale: 0, y: 10 }}
                      animate={{ scale: 1, y: 0 }}
                      exit={{ scale: 0, opacity: 0 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 14 }}
                      className="font-display text-[2.8vmin] font-extrabold text-mint"
                    >
                      +{d}
                    </motion.span>
                  ) : null}
                </AnimatePresence>
                <AnimatedNumber value={sc} className="min-w-[7vmin] text-right font-display text-[3.4vmin] font-extrabold" />
              </motion.div>
            )
          })}
        </div>
      </LayoutGroup>
    </div>
  )
}

/** Mise en page paysage : zone principale + classement à droite (empilé en portrait). */
export function TvLayout({ main, side }: { main: ReactNode; side: ReactNode }) {
  const { w, h } = useViewport()
  const landscape = w > h * 1.15
  return (
    <div className={cn('grid h-full gap-[1.5vmin] overflow-hidden p-[1.5vmin]', landscape ? 'grid-cols-[minmax(0,1fr)_minmax(18rem,28%)]' : 'grid-rows-[minmax(0,1fr)_auto]')}>
      <div className="flex min-h-0 min-w-0 flex-col gap-[1.5vmin]">{main}</div>
      {landscape ? side : <div className="max-h-[35vh] overflow-hidden">{side}</div>}
    </div>
  )
}

/** Grande étiquette (thème, manche…) pour l'en-tête d'une question. */
export function TvChip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('rounded-full border-[3px] border-ink bg-surface px-[1.6vmin] py-[0.5vmin] font-display text-[2.6vmin] font-extrabold shadow-sticker-sm', className)}>{children}</span>
  )
}

/** Écran de fin : podium animé (ex aequo groupés) + le reste du classement. */
export function TvFinal({ ids, scores, get, sub }: { ids: string[]; scores: Record<string, number>; get: (id: string) => PlayerInfo; sub?: (id: string) => string | null }) {
  const reduce = useReducedMotion()
  const { h } = useViewport()
  const sorted = [...ids].sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0))
  const rankOf = (id: string) => sorted.findIndex((x) => (scores[x] ?? 0) === (scores[id] ?? 0))
  const cols = [1, 0, 2]
    .map((r) => ({ r, list: sorted.filter((id) => rankOf(id) === r) }))
    .filter((c) => c.list.length > 0)
  const rest = sorted.filter((id) => rankOf(id) > 2)
  const av = Math.round(Math.max(60, Math.min(130, h * 0.12)))

  useEffect(() => {
    if (reduce) return
    const t = [setTimeout(() => burst({ x: 0.5, y: 0.4 }, 160), 900), setTimeout(() => burst({ x: 0.25, y: 0.5 }, 90), 1500), setTimeout(() => burst({ x: 0.75, y: 0.5 }, 90), 1900)]
    return () => t.forEach(clearTimeout)
  }, [reduce])

  const height = ['h-[30vmin]', 'h-[21vmin]', 'h-[15vmin]']
  const bg = ['bg-sun', 'bg-sky', 'bg-bubblegum']
  return (
    <div className="flex min-h-[75vh] flex-col items-center justify-center gap-[2vmin] p-[2vmin]">
      <motion.h1 initial={{ scale: 0.3, rotate: -8 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 11 }} className="font-display text-[7vmin] font-extrabold">
        🎉 Résultats !
      </motion.h1>
      <div className="flex items-end justify-center gap-[2vmin]">
        {cols.map((c, i) => (
          <motion.div
            key={c.r}
            initial={{ y: 200, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.3 + (c.r === 0 ? 0.9 : i * 0.25), type: 'spring', stiffness: 220, damping: 15 }}
            className="flex w-[26vmin] flex-col items-center"
          >
            <div className="flex flex-wrap justify-center -space-x-3">
              {c.list.map((id) => {
                const p = get(id)
                return <Avatar key={id} slug={p.slug} size={c.r === 0 ? Math.round(av * 1.25) : av} expression={mood(p, c.r === 0 ? 'proud' : 'happy')} />
              })}
            </div>
            <p className="mt-1 max-w-full truncate text-center font-display text-[3vmin] font-extrabold">{c.list.map((id) => get(id).nickname).join(' & ')}</p>
            <div className={cn('mt-1 flex w-full flex-col items-center justify-center rounded-t-chip border-4 border-b-0 border-ink text-[#1f1b2e]', height[c.r], bg[c.r])}>
              <span className="text-[6vmin] leading-none">{MEDALS[c.r]}</span>
              <span className="font-display text-[4vmin] font-extrabold">{(scores[c.list[0]] ?? 0).toLocaleString('fr-FR')}</span>
              {sub && c.list.length === 1 && <span className="text-[2.2vmin] font-bold opacity-80">{sub(c.list[0])}</span>}
            </div>
          </motion.div>
        ))}
      </div>
      {rest.length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2 }} className="flex flex-wrap justify-center gap-[1.5vmin]">
          {rest.map((id) => {
            const p = get(id)
            return (
              <span key={id} className="flex items-center gap-[1vmin] rounded-full border-[3px] border-ink bg-surface py-[0.5vmin] pr-[1.6vmin] pl-[0.5vmin] font-display text-[2.6vmin] font-extrabold shadow-sticker-sm">
                <Avatar slug={p.slug} size={Math.round(av * 0.45)} />
                {rankOf(id) + 1}e · {p.nickname} · {(scores[id] ?? 0).toLocaleString('fr-FR')}
              </span>
            )
          })}
        </motion.div>
      )}
    </div>
  )
}
