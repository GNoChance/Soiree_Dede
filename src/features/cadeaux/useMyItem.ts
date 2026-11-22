import { equippedOf, type ItemDef, type ItemSlot } from '@/data/cadeaux'
import { usePlayersStore } from '@/features/soiree/players'
import { useSession } from '@/store/session'

/**
 * Objet que J'AI équipé dans ce slot. Sert aux styles « sur ton écran » (dos de cartes, dés, croix et ronds) :
 * chacun voit la partie avec son propre style.
 */
export function useMyItem(slot: ItemSlot): ItemDef | null {
  const id = useSession((s) => s.profile?.id)
  const items = usePlayersStore((s) => (id ? s.byId[id]?.equippedItems : undefined))
  return equippedOf(items, slot)
}
