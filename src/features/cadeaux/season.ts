import { create } from 'zustand'
import { getItem, type ItemDef } from '@/data/cadeaux'
import { getSeason, daysLeft } from '@/data/saisons'
import { usePlayersStore } from '@/features/soiree/players'
import { toast } from '@/store/toast'
import { fetchSeasonSync, type SeasonSync } from './api'

/** Modale à afficher : palier à cosmétique / titre, ou résumé de la saison écoulée. */
export type SeasonCelebration =
  | { kind: 'tier'; seasonKey: string; season: string; tier: number; item: ItemDef | null; coins: number }
  | { kind: 'ended'; ended: NonNullable<SeasonSync['ended']>; next: string | null }

interface SeasonState {
  info: SeasonSync | null
  queue: SeasonCelebration[]
  /** 7 derniers jours de la saison en cours : pastille rouge sur l'onglet Boutique. */
  lastWeek: boolean
  shift: () => void
}

export const useSeasonStore = create<SeasonState>((set) => ({
  info: null,
  queue: [],
  lastWeek: false,
  shift: () => set((s) => ({ queue: s.queue.slice(1) })),
}))

const seenKey = (k: string) => `sd.season.ended.${k}`
const announcedKey = 'sd.season.announced'
const safeGet = (k: string) => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const safeSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* sans stockage : la modale peut revenir, sans enjeu */
  }
}
/** La modale de fin a été vue : ne plus la montrer (par appareil). */
export const markEndedSeen = (seasonKey: string) => safeSet(seenKey(seasonKey), '1')

let lastSync = 0
let syncing: Promise<SeasonSync | null> | null = null

/**
 * Synchronise le passe de saison (attribue les paliers gagnés), annonce les récompenses (toast pour les pièces,
 * modale pour les cosmétiques / titres) et mémorise l'état pour l'onglet Boutique. Limité à un appel toutes
 * les 15 s sauf `force`. Silencieux en cas d'erreur (le passe n'est pas critique).
 */
export function syncSeason(force = false): Promise<SeasonSync | null> {
  if (syncing) return syncing
  if (!force && Date.now() - lastSync < 15_000) return Promise.resolve(null)
  lastSync = Date.now()
  syncing = (async () => {
    let r: SeasonSync
    try {
      r = await fetchSeasonSync()
    } catch {
      return null
    }
    if (!r.season) {
      useSeasonStore.setState({ info: r, lastWeek: false })
      return r
    }
    const claims = r.new_claims ?? []
    const queue: SeasonCelebration[] = []
    let coinTiers = 0
    let coinsTotal = 0
    let lastCoinTier = 0
    for (const c of claims) {
      const season = c.season_key.split('-')[0]
      if (c.compensated) {
        toast.success(`⭐ Palier ${c.tier} ! Tu l’avais déjà : +${c.coins} 🪙 à la place`)
      } else if (c.tier % 5 === 0) {
        queue.push({ kind: 'tier', seasonKey: c.season_key, season, tier: c.tier, item: getItem(c.item_id) ?? null, coins: c.coins })
      } else {
        coinTiers++
        coinsTotal += c.coins
        lastCoinTier = c.tier
      }
    }
    if (coinTiers === 1) toast.success(`⭐ Palier ${lastCoinTier} ! +${coinsTotal} 🪙 dans la tirelire`)
    else if (coinTiers > 1) toast.success(`⭐ ${coinTiers} paliers d’un coup ! +${coinsTotal} 🪙 dans la tirelire`)
    if (claims.length) await usePlayersStore.getState().load(true)

    const ended = r.ended && !safeGet(seenKey(r.ended.season_key)) ? r.ended : null
    if (ended) {
      queue.push({ kind: 'ended', ended, next: r.season })
      safeSet(announcedKey, r.season_key ?? '')
    } else if (r.season_key && safeGet(announcedKey) !== r.season_key) {
      safeSet(announcedKey, r.season_key)
      const def = getSeason(r.season)
      if (def) toast(`${def.emoji} Nouvelle saison : ${def.name} ! Va voir la boutique.`)
    }
    useSeasonStore.setState((s) => ({
      info: r,
      lastWeek: r.ends_at ? daysLeft(r.ends_at).lastWeek : false,
      queue: [...s.queue, ...queue],
    }))
    return r
  })().finally(() => {
    syncing = null
  })
  return syncing
}
