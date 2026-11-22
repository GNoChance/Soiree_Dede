import { useState, type CSSProperties } from 'react'
import { motion } from 'framer-motion'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { StaggerItem } from '@/components/ui/Stagger'
import {
  PASS_TIERS, POINTS_PER_TIER, collectionOf, daysLeft, lastDayLabel, tierRewardLabel,
  type SeasonDef,
} from '@/data/saisons'
import { cn } from '@/lib/cn'
import type { SeasonSync } from './api'

/** Bandeau de saison : titre, sous-titre, emojis qui flottent, compte à rebours. */
export function SeasonBanner({ def, endsAt }: { def: SeasonDef; endsAt: string }) {
  const { days, lastWeek, lastDay } = daysLeft(endsAt)
  const style = { '--season-bg-light': def.bgLight, '--season-bg-dark': def.bgDark } as CSSProperties
  return (
    <StaggerItem
      style={style}
      className="sticker season-banner relative overflow-hidden rounded-card p-4 text-text"
    >
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        {def.floaters.map((e, i) => (
          <motion.span
            key={e}
            className="absolute text-2xl opacity-80"
            style={{ left: `${8 + i * 24}%`, top: i % 2 ? '58%' : '8%' }}
            animate={{ y: [0, -6, 0] }}
            transition={{ repeat: Infinity, duration: 3 + i * 0.5, delay: i * 0.6, ease: 'easeInOut' }}
          >
            {e}
          </motion.span>
        ))}
      </div>
      <div className="relative">
        <h2 className="text-2xl leading-tight font-extrabold">{def.title}</h2>
        <p className="text-sm font-bold">{def.subtitle}</p>
        <p
          className="mt-2 inline-block rounded-chip border-2 border-ink px-2 py-0.5 text-sm font-extrabold"
          style={{ background: lastWeek ? def.accent2 : 'var(--surface)', color: lastWeek ? '#1f1b2e' : undefined }}
        >
          {lastDay ? '⏰ Ça ferme ce soir à minuit !' : lastWeek ? `⏰ Dernière chance : plus que ${days} j !` : `Encore ${days} j`}
        </p>
      </div>
    </StaggerItem>
  )
}

/** Passe de saison : progression, prochaine récompense, piste des 20 paliers. */
export function SeasonPass({ def, info }: { def: SeasonDef; info: SeasonSync | null }) {
  const [open, setOpen] = useState(false)
  const [help, setHelp] = useState(false)
  const points = info?.points ?? 0
  const tier = info?.tier ?? 0
  const done = tier >= PASS_TIERS
  const toNext = (tier + 1) * POINTS_PER_TIER - points
  const pct = done ? 100 : ((points - tier * POINTS_PER_TIER) / POINTS_PER_TIER) * 100
  return (
    <StaggerItem className="sticker flex flex-col gap-3 rounded-card bg-surface p-4">
      <div>
        <h3 className="text-xl font-extrabold">Passe {def.de}</h3>
        <p className="text-sm font-bold text-muted">Gratuit. Tu joues, tu gagnes des ⭐, les cadeaux tombent tout seuls.</p>
      </div>
      <div
        className="h-5 overflow-hidden rounded-full border-[3px] border-ink bg-sunk"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={PASS_TIERS}
        aria-valuenow={tier}
      >
        <div className="h-full transition-[width] duration-500" style={{ width: `${Math.max(pct, 3)}%`, background: def.accent }} />
      </div>
      <p className="text-sm font-extrabold">
        {done
          ? '🏆 Passe terminé ! Tu peux te reposer (ou pas).'
          : tier === 0
            ? 'Palier 0 sur 20 · une partie et c’est parti !'
            : `Palier ${tier} sur 20 · encore ${toNext} ⭐ avant le prochain cadeau`}
      </p>
      {!done && <p className="text-sm font-bold">Prochain cadeau : {tierRewardLabel(def.id, tier + 1)}</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? 'Masquer les paliers' : 'Voir les 20 paliers'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setHelp(true)}>
          Comment gagner des ⭐ ?
        </Button>
      </div>
      {open && (
        <ol className="flex flex-col gap-1.5">
          {Array.from({ length: PASS_TIERS }, (_, i) => i + 1).map((t) => {
            const reached = t <= tier
            const special = t % 5 === 0
            return (
              <li
                key={t}
                className={cn(
                  'flex items-center gap-2 rounded-chip border-2 border-ink px-2 py-1 text-sm font-bold',
                  reached ? 'bg-mint text-[#1f1b2e]' : special ? 'bg-sun text-[#1f1b2e]' : 'bg-sunk',
                )}
              >
                <span className="w-14 shrink-0 font-display font-extrabold">Palier {t}</span>
                <span className="min-w-0 flex-1">{tierRewardLabel(def.id, t)}</span>
                {reached ? <Check className="size-4 shrink-0" strokeWidth={3.5} aria-label="Obtenu" /> : <span className="shrink-0 text-xs">{t * POINTS_PER_TIER} ⭐</span>}
              </li>
            )
          })}
        </ol>
      )}
      <Modal open={help} onClose={() => setHelp(false)} title="Comment gagner des ⭐">
        <div className="flex flex-col gap-2 font-bold">
          <p>🎮 Une partie terminée : +10 ⭐</p>
          <p>🏆 Une victoire : +10 ⭐ de plus</p>
          <p>📅 Le défi du jour : +15 ⭐</p>
          <p>🎉 Une soirée entre amis : +25 ⭐</p>
          <p className="text-sm text-muted">Un palier tous les 40 ⭐. Rien à réclamer, tout arrive tout seul.</p>
          <Button fullWidth onClick={() => setHelp(false)}>
            Compris !
          </Button>
        </div>
      </Modal>
    </StaggerItem>
  )
}

/** En-tête de la section collection (titre, date de fin, complétion). */
export function CollectionHeader({ def, endsAt, ownedCount }: { def: SeasonDef; endsAt: string; ownedCount: number }) {
  const total = collectionOf(def.id).length
  return (
    <StaggerItem>
      <h3 className="text-xl font-extrabold">Collection {def.de}</h3>
      <p className="text-sm font-bold text-muted">Dispo jusqu’au {lastDayLabel(endsAt)}. Après, rendez-vous l’an prochain !</p>
      {ownedCount >= total && total > 0 && (
        <p className="mt-1 text-sm font-extrabold">🎉 Collection complète ! Il ne reste plus rien à te vendre.</p>
      )}
    </StaggerItem>
  )
}
