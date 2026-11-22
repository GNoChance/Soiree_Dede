import { useEffect } from 'react'
import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import { CHARACTERS, getCharacter } from '@/data/characters'
import { guestAvatarOf } from '@/data/guests'
import type { PlayerInfo } from '@/games/types'

/**
 * Annuaire des 9 profils (id -> pseudo, slug, expressions), chargé une fois et
 * partagé par le salon, les parties et le lanceur.
 * Invités (mode invité) : présents dans `byId` (affichage en jeu) mais PAS dans `list`
 * (= la bande : invitations, amis, classements…). `useEnsurePlayers` recharge l'annuaire
 * quand un id inconnu apparaît (invité arrivé après le chargement).
 */
interface PlayersState {
  byId: Record<string, PlayerInfo>
  /** La bande seulement (sans les invités). */
  list: PlayerInfo[]
  loaded: boolean
  loading: boolean
  load: (force?: boolean) => Promise<void>
}

interface DirRow {
  id: string
  slug: string
  nickname: string
  first_name: string
  expressions: string[] | null
  equipped_expression: string | null
  equipped_tenue: string | null
  equipped_items: Record<string, string> | null
  is_guest?: boolean | null
}
type DirQuery = { select: (c: string) => { order: (k: string) => Promise<{ data: DirRow[] | null; error: unknown }> } }

export const usePlayersStore = create<PlayersState>((set, get) => ({
  byId: {},
  list: [],
  loaded: false,
  loading: false,
  load: async (force = false) => {
    if (get().loading || (get().loaded && !force)) return
    set({ loading: true })
    // equipped_items (features/cadeaux.sql) n'est pas dans src/types/db.ts : requête typée à la main.
    // Repli sans equipped_items si la colonne n'existe pas encore (SQL pas encore collé).
    const cols = 'id, slug, nickname, first_name, expressions, equipped_expression, equipped_tenue, sort_order'
    const query = (c: string) => (supabase.from('profiles') as unknown as DirQuery).select(c).order('sort_order')
    // is_guest (features/guest.sql) : même repli si la colonne manque encore.
    let { data, error } = await query(`${cols}, equipped_items, is_guest`)
    if (error) ({ data, error } = await query(`${cols}, equipped_items`))
    if (error) ({ data, error } = await query(cols))
    if (error || !data) {
      set({ loading: false })
      return
    }
    const all: PlayerInfo[] = data.map((p) => ({
      id: p.id,
      slug: p.slug,
      nickname: p.nickname,
      firstName: p.first_name,
      expressions: p.expressions?.length ? p.expressions : (getCharacter(p.slug)?.expressions ?? ['joie']),
      equipped: p.equipped_expression ?? 'joie',
      equippedTenue: p.equipped_tenue ?? 'default',
      equippedItems: p.equipped_items ?? {},
      color: getCharacter(p.slug)?.color ?? guestAvatarOf(p.slug)?.color ?? '#FFB703',
      isGuest: !!p.is_guest,
    }))
    set({
      list: all.filter((p) => !p.isGuest),
      byId: Object.fromEntries(all.map((p) => [p.id, p])),
      loaded: true,
      loading: false,
    })
  },
}))

/** Charge l'annuaire si besoin et le renvoie. */
export function usePlayers() {
  const byId = usePlayersStore((s) => s.byId)
  const list = usePlayersStore((s) => s.list)
  const loaded = usePlayersStore((s) => s.loaded)
  const load = usePlayersStore((s) => s.load)
  useEffect(() => {
    void load()
  }, [load])
  return { byId, list, loaded, reload: () => load(true) }
}

let lastEnsure = 0

/**
 * Recharge l'annuaire si un de ces ids est inconnu (invité arrivé après le chargement).
 * Au plus un rechargement toutes les 5 s.
 */
export function useEnsurePlayers(ids: readonly string[] | null | undefined) {
  const byId = usePlayersStore((s) => s.byId)
  const loaded = usePlayersStore((s) => s.loaded)
  const missing = loaded && !!ids?.some((id) => !byId[id])
  useEffect(() => {
    if (!missing || Date.now() - lastEnsure < 5000) return
    lastEnsure = Date.now()
    void usePlayersStore.getState().load(true)
  }, [missing, ids])
}

/** Joueur inconnu (profil pas encore chargé) : affichage neutre. */
export function playerOrPlaceholder(byId: Record<string, PlayerInfo>, id: string): PlayerInfo {
  return (
    byId[id] ?? {
      id,
      slug: CHARACTERS[0].slug,
      nickname: '…',
      firstName: '…',
      expressions: ['joie'],
      equipped: 'joie',
      equippedTenue: 'default',
      color: '#cccccc',
    }
  )
}

/**
 * Choisit la première expression disponible pour ce perso parmi `wanted`
 * (ex. ['cool', 'pouces', 'joie']). En jeu, toutes les expressions du perso
 * sont utilisables, même verrouillées.
 */
export function pickExpression(player: Pick<PlayerInfo, 'expressions'> | undefined, ...wanted: string[]): string {
  const available = player?.expressions ?? []
  for (const w of wanted) if (available.includes(w)) return w
  return available.includes('joie') || !available.length ? 'joie' : available[0]
}

/** Raccourcis d'humeur avec replis. */
export const MOOD = {
  happy: ['joie', 'pouces', 'cool'],
  proud: ['cool', 'pouces', 'gamer', 'joie'],
  sad: ['pleurs', 'boude', 'colere'],
  shocked: ['surprise', 'timide', 'clin_oeil'],
  shy: ['timide', 'surprise', 'bisou'],
  think: ['reflexion', 'clin_oeil', 'surprise'],
  sly: ['clin_oeil', 'cool', 'reflexion'],
  angry: ['colere', 'boude'],
  sleepy: ['dodo', 'reflexion'],
  love: ['amoureux', 'charmee', 'bisou'],
} as const

export function mood(player: Pick<PlayerInfo, 'expressions'> | undefined, m: keyof typeof MOOD): string {
  return pickExpression(player, ...MOOD[m])
}
