import { useEffect, useRef } from 'react'
import { Check } from 'lucide-react'
import { getItem } from '@/data/cadeaux'
import { ItemPreview } from '@/features/cadeaux/ItemPreview'
import { cn } from '@/lib/cn'
import { NOEL_PASS_REWARDS, NOEL_TIER_FLAKES } from './api'

/** Piste horizontale des 30 paliers du Pass de Noël (le palier suivant est centré à l'ouverture). */
export function PassTrack({ tier, flakes }: { tier: number; flakes: number }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>(`[data-tier="${Math.min(30, tier + 1)}"]`)
    el?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [tier])
  return (
    <div ref={ref} className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pt-2 pb-3">
      {NOEL_PASS_REWARDS.map((r, i) => {
        const t = i + 1
        const got = t <= tier
        const next = t === tier + 1
        const it = getItem(r.itemId)
        return (
          <div
            key={t}
            data-tier={t}
            className={cn(
              'sticker relative flex w-28 shrink-0 snap-center flex-col items-center gap-1 rounded-card p-2 text-center',
              got ? 'bg-mint/40' : next ? 'bg-sun/40' : 'bg-surface',
              t === 30 && 'w-36 bg-tomato/20',
            )}
          >
            <span className="font-display text-sm font-extrabold">Palier {t}</span>
            <div className="flex h-16 items-center justify-center text-4xl">
              {it ? <ItemPreview it={it} size={56} /> : <span>{r.emoji}</span>}
            </div>
            <span className="text-xs leading-tight font-bold">{r.label}</span>
            {r.soon && !got && <span className="text-[10px] font-bold text-muted">bientôt dispo</span>}
            <span className="text-[10px] font-bold text-muted">{t * NOEL_TIER_FLAKES} ❄️</span>
            {got && (
              <span className="absolute -top-2 -right-2 flex size-7 items-center justify-center rounded-full border-2 border-ink bg-mint">
                <Check className="size-4" strokeWidth={4} />
              </span>
            )}
            {next && <span className="text-[10px] font-extrabold">encore {t * NOEL_TIER_FLAKES - flakes} ❄️</span>}
          </div>
        )
      })}
    </div>
  )
}
