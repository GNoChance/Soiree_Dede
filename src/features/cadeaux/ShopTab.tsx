import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { StaggerItem } from '@/components/ui/Stagger'
import { burst } from '@/components/ui/confetti'
import { SLOTS, getItem, type ItemDef } from '@/data/cadeaux'
import { getSeason } from '@/data/saisons'
import { toastError } from '@/features/soiree/errors'
import { fx } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import { toast } from '@/store/toast'
import { buyItem, equipItem, fetchShop, type ShopState } from './api'
import { ItemPreview } from './ItemPreview'
import { CollectionHeader, SeasonBanner, SeasonPass } from './SeasonSection'
import { syncSeason, useSeasonStore } from './season'

/** Lancement des saisons de boutique : avant cette date, un simple teaser sous le solde. */
const SEASONS_LAUNCH = new Date('2026-12-01T00:00:00+01:00').getTime()

function untilLabel(iso: string) {
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return 'bientôt'
  const h = Math.floor(ms / 3_600_000)
  return h >= 24 ? `${Math.floor(h / 24)} j ${h % 24} h` : `${h} h ${Math.floor((ms % 3_600_000) / 60_000)} min`
}

/** Carte d'un article : vitrine de la semaine ou collection de saison (pastille « Limité »). */
function ShopCard({ it, owned, coins, limited, onTap }: {
  it: ItemDef
  owned: boolean
  coins: number
  /** Couleur de la pastille « Limité » (accent secondaire de la saison) : présent = article de saison. */
  limited?: string
  onTap: (it: ItemDef, owned: boolean) => void
}) {
  const tooExpensive = !owned && (it.price ?? 0) > coins
  return (
    <StaggerItem>
      <motion.button
        type="button"
        whileTap={{ scale: 0.94 }}
        onClick={() => onTap(it, owned)}
        className={cn(
          'sticker-sm relative flex w-full flex-col items-center gap-2 rounded-card border-[3px] border-ink bg-surface p-3 text-center',
          owned && 'opacity-60',
        )}
      >
        {limited && (
          <span
            className="absolute -top-2 -left-1 -rotate-6 rounded-chip border-2 border-ink px-1.5 text-xs font-extrabold text-[#1f1b2e]"
            style={{ background: limited }}
          >
            Limité
          </span>
        )}
        <span className="flex h-16 items-center justify-center"><ItemPreview it={it} size={56} /></span>
        <span className="text-sm leading-tight font-extrabold">{it.label}</span>
        <span className="text-xs font-bold text-muted">{SLOTS.find((s) => s.id === it.slot)?.label}</span>
        {owned ? (
          <span className="flex items-center gap-1 rounded-chip border-2 border-ink bg-mint px-2 py-0.5 text-sm font-extrabold text-[#1f1b2e]">
            <Check className="size-4" strokeWidth={3.5} /> À toi
          </span>
        ) : (
          <span className={cn('rounded-chip border-2 border-ink px-2 py-0.5 font-display font-extrabold text-[#1f1b2e]', tooExpensive ? 'bg-sunk' : 'bg-sun')}>
            {it.price} 🪙
          </span>
        )}
      </motion.button>
    </StaggerItem>
  )
}

/** Onglet « Boutique » de l'inventaire : collection + passe de la saison, puis 6 articles par semaine, achetés avec les pièces 🪙. */
export function ShopTab() {
  const [shop, setShop] = useState<ShopState | null>(null)
  const [error, setError] = useState(false)
  const [pick, setPick] = useState<ItemDef | null>(null)
  const [bought, setBought] = useState<ItemDef | null>(null)
  const [busy, setBusy] = useState(false)
  const seasonInfo = useSeasonStore((s) => s.info)

  const load = useCallback(async () => {
    try {
      setShop(await fetchShop())
      setError(false)
    } catch {
      setError(true)
    }
  }, [])
  useEffect(() => {
    // Attribue d'abord les paliers du passe (pièces / cadeaux), puis charge la boutique avec le solde à jour.
    void syncSeason(true).finally(() => void load())
  }, [load])

  const buy = async (it: ItemDef) => {
    setBusy(true)
    try {
      await buyItem(it.id)
      fx.cash()
      burst()
      setPick(null)
      setBought(it)
      await load()
    } catch (e) {
      toastError(e)
      await load()
    } finally {
      setBusy(false)
    }
  }

  const equipNow = async (it: ItemDef) => {
    try {
      await equipItem(it.slot, it.id)
      fx.pop()
      toast.success(`${it.emoji} ${it.label} équipé !`)
      setBought(null)
    } catch (e) {
      toastError(e)
    }
  }

  const tapItem = (it: ItemDef, owned: boolean) => (owned ? toast('Déjà à toi ! Équipe-le dans l’onglet Déco.') : setPick(it))

  if (error) return <p className="text-center font-bold text-muted">La boutique est fermée pour le moment. Réessaie plus tard !</p>
  if (!shop) return <p className="text-center font-bold text-muted">Ouverture de la boutique…</p>
  const items = shop.items.map(getItem).filter(Boolean) as ItemDef[]
  const seasonDef = getSeason(shop.season)
  const seasonItems = (shop.season_items ?? []).map(getItem).filter(Boolean) as ItemDef[]
  const pickSeason = pick?.season ? getSeason(pick.season) : undefined

  return (
    <div className="flex flex-col gap-4">
      <StaggerItem className="sticker flex items-center justify-between gap-3 rounded-card bg-sun p-4 text-[#1f1b2e]">
        <div>
          <p className="text-sm font-extrabold">Tes pièces</p>
          <p className="font-display text-4xl leading-none font-extrabold">{shop.coins} 🪙</p>
        </div>
        <p className="max-w-[9rem] text-right text-xs font-bold">
          +5 par partie · +15 par victoire · +10 défi du jour · +20 trophée
        </p>
      </StaggerItem>

      {!seasonDef && Date.now() < SEASONS_LAUNCH && (
        <StaggerItem>
          <p className="text-center text-sm font-extrabold">⛷️ Le 1er décembre, la boutique part au chalet. Garde quelques pièces !</p>
        </StaggerItem>
      )}

      {seasonDef && shop.season_ends_at && (
        <>
          <SeasonBanner def={seasonDef} endsAt={shop.season_ends_at} />
          <SeasonPass def={seasonDef} info={seasonInfo} />
          <CollectionHeader def={seasonDef} endsAt={shop.season_ends_at} ownedCount={shop.season_owned.length} />
          <div className="grid grid-cols-2 gap-3">
            {seasonItems.map((it) => (
              <ShopCard key={it.id} it={it} owned={shop.season_owned.includes(it.id)} coins={shop.coins} limited={seasonDef.accent2} onTap={tapItem} />
            ))}
          </div>
          <StaggerItem>
            <h3 className="text-xl font-extrabold">Vitrine de la semaine</h3>
          </StaggerItem>
        </>
      )}

      <StaggerItem>
        <p className="text-center text-sm font-bold text-muted">Nouvelle vitrine dans {untilLabel(shop.ends_at)} 🛍️</p>
      </StaggerItem>
      <div className="grid grid-cols-2 gap-3">
        {items.map((it) => (
          <ShopCard key={it.id} it={it} owned={shop.owned.includes(it.id)} coins={shop.coins} onTap={tapItem} />
        ))}
      </div>

      <Modal open={Boolean(pick)} onClose={() => setPick(null)} title={pick?.label}>
        {pick && (
          <div className="flex flex-col items-center gap-4 text-center">
            <ItemPreview it={pick} size={96} />
            <p className="font-bold">{SLOTS.find((s) => s.id === pick.slot)?.hint}</p>
            <p className="font-display text-2xl font-extrabold">{pick.price} 🪙</p>
            {(pick.price ?? 0) > shop.coins ? (
              <p className="font-bold text-muted">Il te manque {(pick.price ?? 0) - shop.coins} 🪙. Encore quelques parties !</p>
            ) : (
              <Button
                fullWidth
                loading={busy}
                onClick={() => void buy(pick)}
                style={pickSeason ? { background: pickSeason.accent, color: pickSeason.onAccent } : undefined}
              >
                Acheter
              </Button>
            )}
            <Button variant="ghost" fullWidth onClick={() => setPick(null)}>
              Plus tard
            </Button>
          </div>
        )}
      </Modal>

      <Modal open={Boolean(bought)} onClose={() => setBought(null)} title="C’est à toi ! 🎉">
        {bought && (
          <div className="flex flex-col items-center gap-4 text-center">
            <motion.div initial={{ scale: 0, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 10 }}>
              <ItemPreview it={bought} size={96} />
            </motion.div>
            <p className="text-lg font-extrabold">{bought.label}</p>
            <Button fullWidth onClick={() => void equipNow(bought)}>
              L’équiper maintenant
            </Button>
            <Button variant="ghost" fullWidth onClick={() => setBought(null)}>
              Plus tard
            </Button>
          </div>
        )}
      </Modal>
    </div>
  )
}
