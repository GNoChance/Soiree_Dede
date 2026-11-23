import { useEffect, useMemo } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { burst } from '@/components/ui/confetti'
import { fx } from '@/lib/feedback'
import { mood } from '@/features/soiree/players'
import type { PlayerInfo } from '../types'
import type { LppReveal } from './types'
import { assignLanes, buildScale, formatCompact, withUnit } from './setup'

type Get = (id: string) => PlayerInfo

const LANE_H = 50
const AVATAR = 34

/** Délais de l'animation (s) : avatars un par un, puis la bonne réponse tombe. */
export function timeline(n: number, reduce: boolean) {
  if (reduce) return { avatar: () => 0, truth: 0, after: 0.2 }
  const step = n > 6 ? 0.25 : 0.35
  const truth = 0.5 + n * step + 0.5
  return { avatar: (i: number) => 0.5 + i * step, truth, after: truth + 0.9 }
}

export function Ruler({ lr, get, meId, unit, fast, tv }: { lr: LppReveal; get: Get; meId: string; unit: string | null; fast: boolean; tv?: boolean }) {
  const reduce = !!useReducedMotion() || fast
  const entries = lr.ranking
  const scale = useMemo(() => buildScale(entries.map((e) => e.value), lr.answer), [entries, lr.answer])
  const positions = entries.map((e) => scale.pos(e.value))
  const lanes = assignLanes(positions)
  const laneCount = Math.max(1, ...lanes.map((l) => l + 1))
  const truthPos = scale.pos(lr.answer)
  // Ordre d'apparition : du plus loin au plus proche (suspense).
  const order = entries.map((_, i) => i).reverse()
  const t = timeline(entries.length, reduce)
  const winners = entries.filter((e) => e.rank === 1)
  const top = laneCount * LANE_H + 24 // hauteur de la zone des avatars au-dessus de la règle

  // Sons synchronisés avec l'animation.
  useEffect(() => {
    const timers: number[] = []
    order.forEach((_, k) => timers.push(window.setTimeout(() => fx.pop(), t.avatar(k) * 1000 + 250)))
    timers.push(window.setTimeout(() => fx.whoosh(), t.truth * 1000))
    timers.push(
      window.setTimeout(() => {
        if (tv) {
          // Télé : pas de « mon » résultat, on fête juste le(s) plus proche(s).
          if (entries.some((e) => e.rank === 1)) burst({ x: 0.5, y: 0.35 }, entries.some((e) => e.exact) ? 140 : 80)
          return
        }
        const mine = entries.find((e) => e.profile_id === meId)
        if (mine?.exact) {
          fx.fanfare()
          burst({ x: 0.5, y: 0.35 }, 140)
        } else if (mine && mine.rank === 1) {
          fx.success()
          burst({ x: 0.5, y: 0.35 }, 80)
        } else if (mine && mine.points > 0) fx.success()
        else fx.fail()
      }, t.truth * 1000 + 450),
    )
    return () => timers.forEach(clearTimeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="sticker overflow-hidden bg-surface px-2 pt-3 pb-2">
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="font-display font-extrabold">📏 Qui est le plus proche ?</span>
        {scale.kind === 'log' && (
          <Badge tone="grape" tilted={false}>
            échelle log
          </Badge>
        )}
      </div>
      <div className="relative mx-5" style={{ height: top + 64 }}>
        {/* Règle */}
        <div className="absolute inset-x-0 h-3 rounded-full border-2 border-ink bg-sunk" style={{ top: top - 6 }} />
        {scale.ticks.map((v) => (
          <div key={v} className="absolute -translate-x-1/2" style={{ left: `${scale.pos(v) * 100}%`, top: top + 6 }}>
            <div className="mx-auto h-2 w-0.5 bg-ink" />
            <span className="block text-center text-[10px] font-bold whitespace-nowrap text-muted">{formatCompact(v)}</span>
          </div>
        ))}

        {/* Écart du (des) gagnant(s) : segment vert entre l'estimation et la réponse */}
        {winners.map((w) => {
          const a = Math.min(scale.pos(w.value), truthPos)
          const b = Math.max(scale.pos(w.value), truthPos)
          return (
            <motion.div
              key={`seg${w.profile_id}`}
              className="absolute h-3 origin-left rounded-full bg-mint"
              style={{ left: `${a * 100}%`, width: `max(${(b - a) * 100}%, 6px)`, top: top - 6 }}
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ delay: t.truth + 0.5, duration: 0.4 }}
            />
          )
        })}

        {/* Avatars des joueurs à leur estimation */}
        {order.map((idx, k) => {
          const e = entries[idx]
          const p = get(e.profile_id)
          const lane = lanes[idx]
          const stem = lane * LANE_H + 10
          return (
            <motion.div
              key={e.profile_id}
              className="absolute flex -translate-x-1/2 flex-col items-center"
              style={{ left: `${positions[idx] * 100}%`, bottom: 64 + 6 }}
              initial={{ y: -220, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: t.avatar(k), type: 'spring', stiffness: 380, damping: 16 }}
            >
              <Avatar
                slug={p.slug}
                size={AVATAR}
                selected={e.profile_id === meId}
                expression={mood(p, e.exact ? 'love' : e.rank === 1 ? 'proud' : 'think')}
              />
              <div className="w-0.5 bg-ink/70" style={{ height: stem }} />
            </motion.div>
          )
        })}

        {/* La bonne réponse tombe */}
        <motion.div
          className="absolute z-10 flex -translate-x-1/2 flex-col items-center"
          style={{ left: `${truthPos * 100}%`, top: top - 40 }}
          initial={{ y: -top - 60, opacity: 0, scale: 1.6 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          transition={{ delay: t.truth, type: 'spring', stiffness: 520, damping: 13 }}
        >
          <span className="text-3xl leading-none drop-shadow">🎯</span>
          <div className="h-3 w-1 rounded bg-tomato" />
        </motion.div>
        <motion.div
          className="absolute z-10 -translate-x-1/2 rounded-full border-2 border-ink bg-tomato px-2 font-display text-sm font-extrabold whitespace-nowrap text-white shadow-sticker-sm"
          style={{ left: `clamp(2.5rem, ${truthPos * 100}%, calc(100% - 2.5rem))`, top: top + 30 }}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: t.truth + 0.3, type: 'spring', stiffness: 500, damping: 14 }}
        >
          {withUnit(lr.answer, unit)}
        </motion.div>
      </div>
      {entries.length === 0 && <p className="text-center text-sm font-bold text-muted">Personne n’a osé une estimation… 🦗</p>}
    </div>
  )
}
