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

/** Vitrine de la semaine (shop_state). */
export interface ShopState {
  coins: number
  week_start: string
  ends_at: string
  items: string[]
  /** Articles de la vitrine déjà possédés. */
  owned: string[]
  /** Saison en cours (null avant le lancement), clé d'édition, fermeture, collection (par prix) et articles déjà possédés. */
  season: string | null
  season_key: string | null
  season_ends_at: string | null
  season_items: string[]
  season_owned: string[]
}

export async function fetchShop() {
  const { data, error } = await rpc('shop_state')
  if (error) throw error
  return data as ShopState
}

/** Achète un article de la vitrine (buy_item). */
export async function buyItem(item: string) {
  const { data, error } = await rpc('buy_item', { p_item: item })
  if (error) throw error
  return data as { item: string; coins: number }
}

/** Un palier du passe de saison attribué par season_sync. */
export interface SeasonClaim {
  season_key: string
  tier: number
  coins: number
  /** Article gagné (null : palier à pièces, ou article déjà possédé -> `compensated`). */
  item_id: string | null
  compensated: boolean
}

/** Réponse de season_sync (supabase/features/saisons.sql). `season` est null hors saison (avant le 1er déc. 2026). */
export interface SeasonSync {
  season: string | null
  season_key?: string
  starts_at?: string
  ends_at?: string
  points?: number
  tier?: number
  new_claims: SeasonClaim[]
  /** Saison précédente à résumer (si le joueur y a gagné des points). */
  ended: { season: string; season_key: string; tier: number; coins_total: number; collection_owned: number } | null
}

export async function fetchSeasonSync() {
  const { data, error } = await rpc('season_sync')
  if (error) throw error
  return data as SeasonSync
}
