import { useState } from 'react'
import { motion } from 'framer-motion'
import { Check, Lock } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { PlayerTitle } from '@/components/ui/PlayerTitle'
import { StaggerItem } from '@/components/ui/Stagger'
import { ITEMS, SLOTS, equippedOf, type ItemDef, type ItemSlot } from '@/data/cadeaux'
import { usePlayersStore } from '@/features/soiree/players'
import { toastError } from '@/features/soiree/errors'
import { fx } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import { useSession } from '@/store/session'
import { toast } from '@/store/toast'
import { equipItem, useOwnedItems } from './api'

const howToGet = (it: ItemDef) =>
  it.adventDay ? `Case n° ${it.adventDay} du calendrier de l’Avent` : it.adventCount ? `${it.adventCount} cases ouvertes dans le calendrier de l’Avent` : (it.howTo ?? 'Bientôt…')

/** Onglet « Déco » de l'inventaire : cadres, titres et objets de jeu gagnés (calendrier de l'Avent). */
export function DecoTab() {
  const profile = useSession((s) => s.profile)
  const { owned, loaded } = useOwnedItems(profile?.id)
  const equipped = usePlayersStore((s) => (profile ? s.byId[profile.id]?.equippedItems : undefined))
  const [busy, setBusy] = useState(false)
  if (!profile) return null

  const toggle = async (it: ItemDef) => {
    if (!owned.has(it.id)) return void toast(`🔒 ${howToGet(it)}`)
    const on = equipped?.[it.slot] === it.id
    setBusy(true)
    try {
      await equipItem(it.slot, on ? null : it.id)
      fx.pop()
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }

  const ownedCount = ITEMS.filter((i) => owned.has(i.id)).length
  return (
    <div className="flex flex-col gap-5">
      <StaggerItem className="flex flex-col items-center gap-2 text-center">
        <Avatar slug={profile.slug} expression={profile.equipped_expression} tenue={profile.equipped_tenue} size={84} />
        <p className="mt-2 font-display text-xl font-extrabold">{profile.nickname}</p>
        <PlayerTitle slug={profile.slug} className="text-sm" />
        <p className="text-sm font-bold text-muted">
          {loaded ? `${ownedCount}/${ITEMS.length} cadeaux` : 'Chargement…'} · touche un cadeau verrouillé pour savoir comment l’avoir
        </p>
      </StaggerItem>
      {SLOTS.map((slot) => (
        <SlotSection key={slot.id} slot={slot.id} owned={owned} equipped={equipped} busy={busy} onTap={(it) => void toggle(it)} />
      ))}
    </div>
  )
}

function SlotSection({ slot, owned, equipped, busy, onTap }: {
  slot: ItemSlot
  owned: Set<string>
  equipped: Record<string, string> | undefined
  busy: boolean
  onTap: (it: ItemDef) => void
}) {
  const def = SLOTS.find((s) => s.id === slot)!
  const items = ITEMS.filter((i) => i.slot === slot)
  const current = equippedOf(equipped, slot)
  const profile = useSession((s) => s.profile)
  return (
    <StaggerItem className="flex flex-col gap-2">
      <div>
        <h2 className="text-2xl">{def.emoji} {def.label}</h2>
        <p className="text-sm font-bold text-muted">
          {def.hint} {current ? <>Équipé : <b>{current.label}</b> (touche-le pour l’enlever).</> : 'Rien d’équipé.'}
        </p>
      </div>
      <div className={cn('grid gap-3', slot === 'title' ? 'grid-cols-2' : 'grid-cols-3')}>
        {items.map((it) => {
          const have = owned.has(it.id)
          const on = current?.id === it.id
          return (
            <motion.button
              key={it.id}
              type="button"
              disabled={busy}
              whileTap={{ scale: 0.92 }}
              onClick={() => onTap(it)}
              aria-label={`${it.label}${have ? '' : ' (verrouillé)'}`}
              className={cn(
                'sticker-sm relative flex min-h-24 flex-col items-center justify-center gap-1 rounded-card border-[3px] border-ink p-2 text-center',
                on ? 'bg-sun text-[#1f1b2e]' : 'bg-surface',
                !have && 'opacity-55 grayscale',
              )}
            >
              {slot === 'frame' && profile ? (
                <span className="py-2"><Avatar slug={profile.slug} expression={profile.equipped_expression} tenue={profile.equipped_tenue} frame={it.id} size={44} /></span>
              ) : (
                <span className="text-3xl leading-none">{it.emoji}</span>
              )}
              <span className="text-xs leading-tight font-extrabold">{it.label}</span>
              {!have && <Lock className="absolute top-1 right-1 size-4" strokeWidth={3} />}
              {on && <Check className="absolute top-1 right-1 size-5" strokeWidth={3.5} />}
            </motion.button>
          )
        })}
      </div>
    </StaggerItem>
  )
}
