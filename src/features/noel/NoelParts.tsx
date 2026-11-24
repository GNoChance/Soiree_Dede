import { motion, useReducedMotion } from 'framer-motion'
import { Check } from 'lucide-react'
import { Link } from 'react-router'
import { cn } from '@/lib/cn'
import { NOEL_STREAK_BONUS, type NoelState } from './api'
import { hotteFlakes } from './hotteApi'
import { NOEL_MISSIONS, NOEL_MISSION_LINK, missionLabel } from './missions'

/** Flocons qui flottent doucement (décor des bandeaux de Noël). */
export function Flakes({ count = 8 }: { count?: number }) {
  const reduce = useReducedMotion()
  if (reduce) return null
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {Array.from({ length: count }, (_, i) => (
        <motion.span
          key={i}
          className="absolute text-lg text-white/80"
          style={{ left: `${(i * 97) % 100}%`, top: -20 }}
          animate={{ y: [0, 220], rotate: [0, 180] }}
          transition={{ duration: 6 + (i % 4), repeat: Infinity, delay: i * 0.7, ease: 'linear' }}
        >
          ❄
        </motion.span>
      ))}
    </div>
  )
}

/** Une mission du jour (case cochée + « +30 ❄️ »). `link` : la ligne mène là où on la fait. */
export function MissionRow({ id, done, link }: { id: string; done: boolean; link?: boolean }) {
  const fam = NOEL_MISSIONS[id]?.family ?? 'surprise'
  const body = (
    <>
      <span
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-full border-[3px] border-ink',
          done ? 'bg-mint' : 'bg-surface',
        )}
      >
        {done && <Check className="size-4" strokeWidth={4} />}
      </span>
      <span className={cn('min-w-0 flex-1 text-left font-bold', done && 'text-muted line-through')}>{missionLabel(id)}</span>
      <span className={cn('shrink-0 font-display font-extrabold', done ? 'text-text' : 'text-muted')}>{done ? '✅ +30 ❄️' : '+30 ❄️'}</span>
    </>
  )
  if (link && !done && fam !== 'surprise') {
    return (
      <Link to={NOEL_MISSION_LINK[fam]} className="flex min-h-11 items-center gap-3 rounded-card p-1 active:scale-[0.98]">
        {body}
      </Link>
    )
  }
  return <div className="flex min-h-11 items-center gap-3 p-1">{body}</div>
}

/** Missions du jour + mission bonus soirée. */
export function MissionList({ st, link }: { st: NoelState; link?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      {st.missions.map((m) => (
        <MissionRow key={m.id} id={m.id} done={m.done} link={link} />
      ))}
      <div className="flex min-h-11 items-center gap-3 p-1">
        <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-full border-[3px] border-dashed border-ink', st.soiree_bonus ? 'bg-mint' : 'bg-surface')}>
          {st.soiree_bonus ? <Check className="size-4" strokeWidth={4} /> : '🎉'}
        </span>
        <span className="min-w-0 flex-1 font-bold">Bonus : joue une partie en soirée aujourd’hui</span>
        <span className="shrink-0 font-display font-extrabold text-muted">{st.soiree_bonus ? '✅ +30 ❄️' : '+30 ❄️'}</span>
      </div>
    </div>
  )
}

/** Texte du bouton Hotte selon l'état du jour. */
export function hotteButtonLabel(st: NoelState): string {
  if (st.hotte.status === 'done') return `🎁 Hotte faite : ${st.hotte.score}/5 · +${hotteFlakes(st.hotte.score)} ❄️`
  if (st.hotte.status === 'running') return '🎁 Reprendre la Hotte du jour'
  return '🎁 Ouvrir la Hotte du jour'
}

/** « 🔥 12 jours d'affilée » + prochains bonus de série. */
export function StreakLine({ st, detailed }: { st: NoelState; detailed?: boolean }) {
  const n = st.streak.current
  return (
    <div className="flex flex-col gap-1">
      <p className="font-display text-lg font-extrabold">
        🔥 {n} jour{n > 1 ? 's' : ''} d’affilée
      </p>
      {detailed && (
        <div className="flex flex-wrap gap-2">
          {NOEL_STREAK_BONUS.map((b) => (
            <span
              key={b.days}
              className={cn('rounded-chip border-2 border-ink px-2 py-0.5 text-sm font-bold', st.streak.best >= b.days ? 'bg-mint' : 'bg-surface')}
            >
              {b.days} j · +{b.flakes} ❄️ {st.streak.best >= b.days && '✅'}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
