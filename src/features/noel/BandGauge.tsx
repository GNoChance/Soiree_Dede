import { motion, useReducedMotion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { playerOrPlaceholder, usePlayers } from '@/features/soiree/players'
import { cn } from '@/lib/cn'
import { NOEL_BAND_REWARDS, NOEL_BAND_TIERS, NOEL_ELIGIBLE, type NoelState } from './api'

const MAX = NOEL_BAND_TIERS[NOEL_BAND_TIERS.length - 1]
const fmt = (n: number) => n.toLocaleString('fr-FR')

/** Jauge de la Grande Hotte (avec ses 5 paliers). `compact` : version de la carte d'accueil. */
export function BandBar({ total, compact }: { total: number; compact?: boolean }) {
  const reduce = useReducedMotion()
  const pct = Math.min(100, (total / MAX) * 100)
  return (
    <div className={cn('relative overflow-visible rounded-full border-[3px] border-ink bg-sunk', compact ? 'h-4' : 'h-7')}>
      <motion.div
        className="h-full rounded-full bg-[linear-gradient(90deg,#C1121F,#E63946,#2D6A4F,#06D6A0)]"
        initial={{ width: reduce ? `${pct}%` : 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: reduce ? 0 : 1.2, ease: 'easeOut' }}
      />
      {NOEL_BAND_TIERS.map((t, i) => (
        <span
          key={t}
          aria-hidden
          className={cn('absolute top-1/2 -translate-x-1/2 -translate-y-1/2', compact ? 'text-sm' : 'text-xl', total >= t ? '' : 'grayscale opacity-70')}
          style={{ left: `${(t / MAX) * 100}%` }}
        >
          {i === NOEL_BAND_TIERS.length - 1 ? '🎁' : '⭐'}
        </span>
      ))}
    </div>
  )
}

/** Onglet « La Grande Hotte » : jauge, paliers, éligibilité, contributeurs. */
export function BandPanel({ st }: { st: NoelState }) {
  const { byId } = usePlayers()
  const b = st.band
  return (
    <div className="flex flex-col gap-4">
      <div className="sticker flex flex-col gap-3 rounded-card bg-surface p-4">
        <p className="text-center font-display text-3xl font-extrabold">{fmt(b.total)} ❄️</p>
        <BandBar total={b.total} />
        <p className="text-center text-sm font-bold text-muted">Tous les flocons de la bande remplissent la même Hotte !</p>
      </div>
      <div className="sticker flex flex-col gap-2 rounded-card bg-surface p-4">
        {NOEL_BAND_REWARDS.map((r, i) => {
          const reached = b.total >= NOEL_BAND_TIERS[i]
          return (
            <div key={i} className={cn('flex items-center gap-3 rounded-card p-2', reached && 'bg-mint/30')}>
              <span className="text-3xl">{r.emoji}</span>
              <div className="min-w-0 flex-1">
                <p className="font-display font-extrabold">
                  Palier {i + 1} · {fmt(NOEL_BAND_TIERS[i])} ❄️ {reached && '✅'}
                </p>
                <p className="text-sm font-bold">{r.label}</p>
                {r.soon && <p className="text-xs font-bold text-muted">bientôt dispo (donné dès qu’il arrive)</p>}
              </div>
            </div>
          )
        })}
      </div>
      <p className={cn('sticker rounded-card p-3 text-center font-bold', b.eligible ? 'bg-mint/40' : 'bg-sun/40')}>
        {b.eligible
          ? `Tu as apporté ${fmt(b.me)} ❄️ : tu touches les récompenses de la bande ! 🎉`
          : st.phase === 'over'
            ? `Tu as apporté ${fmt(b.me)} ❄️ cette année. Il en fallait ${fmt(NOEL_ELIGIBLE)} pour les récompenses de la bande : rendez-vous l’an prochain !`
            : `Tu as apporté ${fmt(b.me)} ❄️. Apporte encore ${fmt(NOEL_ELIGIBLE - b.me)} ❄️ pour toucher les récompenses de la bande.`}
      </p>
      <div className="sticker flex flex-col gap-1 rounded-card bg-surface p-4">
        <p className="mb-1 font-display text-xl font-extrabold">🛷 Les lutins de la bande</p>
        {b.contributors.length === 0 && <p className="text-sm font-bold text-muted">Personne n’a encore rien apporté… à toi de lancer la Hotte !</p>}
        {b.contributors.map((c, i) => {
          const p = playerOrPlaceholder(byId, c.profile_id)
          return (
            <div key={c.profile_id} className="flex items-center gap-3 p-1">
              <span className="w-6 text-center font-display font-extrabold">{i + 1}</span>
              <Avatar slug={p.slug} tenue={p.equippedTenue} size={40} />
              <span className="min-w-0 flex-1 truncate font-bold">{p.nickname}</span>
              <span className="font-display font-extrabold">{fmt(c.flakes)} ❄️</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
