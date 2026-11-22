import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { usePlayersStore } from '@/features/soiree/players'
import { getItem, type ItemSlot } from '@/data/cadeaux'
import { toast } from '@/store/toast'

/** Miroirs TS des tables / RPC de supabase/features/cadeaux.sql. */
type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
const rpc: Rpc = (fn, args) => (supabase as unknown as { rpc: Rpc }).rpc(fn, args)

type From = (t: string) => {
  select: (c: string) => { eq: (k: string, v: string) => Promise<{ data: { item_id: string }[] | null; error: unknown }> }
}
const from: From = (t) => (supabase as unknown as { from: From }).from(t)

let lastSync = 0
let syncing: Promise<string[]> | null = null

/**
 * Demande au serveur les cadeaux mérités (trophées, niveau, semaine, victoires) et annonce les nouveaux
 * par un toast. Limité à un appel toutes les 15 s sauf `force`. Renvoie les ids nouveaux.
 */
export function syncItems(force = false): Promise<string[]> {
  if (syncing) return syncing
  if (!force && Date.now() - lastSync < 15_000) return Promise.resolve([])
  lastSync = Date.now()
  syncing = (async () => {
    const { data, error } = await rpc('sync_my_items')
    if (error || !Array.isArray(data)) return []
    const ids = data as string[]
    for (const id of ids) {
      const it = getItem(id)
      if (it) toast.success(`🎁 Nouveau cadeau : ${it.emoji} ${it.label} ! (Inventaire › Déco)`)
    }
    if (ids.length) await usePlayersStore.getState().load(true)
    return ids
  })().finally(() => {
    syncing = null
  })
  return syncing
}

/** Ids des cadeaux possédés par ce profil. */
export function useOwnedItems(profileId: string | undefined) {
  const [owned, setOwned] = useState<Set<string>>(new Set())
  const [loaded, setLoaded] = useState(false)
  const load = useCallback(async () => {
    if (!profileId) return
    await syncItems(true)
    const { data } = await from('profile_items').select('item_id').eq('profile_id', profileId)
    setOwned(new Set((data ?? []).map((r) => r.item_id)))
    setLoaded(true)
  }, [profileId])
  useEffect(() => {
    void load()
  }, [load])
  return { owned, loaded, reload: load }
}

/** Équipe (ou retire avec null) un cadeau, puis rafraîchit l'annuaire (cadres / titres visibles partout). */
export async function equipItem(slot: ItemSlot, item: string | null) {
  const { data, error } = await rpc('equip_item', { p_slot: slot, p_item: item })
  if (error) throw error
  await usePlayersStore.getState().load(true)
  return data as Record<string, string>
}
