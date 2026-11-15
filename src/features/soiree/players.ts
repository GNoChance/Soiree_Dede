import { useEffect } from 'react'
import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import { CHARACTERS, getCharacter } from '@/data/characters'
import type { PlayerInfo } from '@/games/types'

/**
 * Annuaire des 9 profils (id -> pseudo, slug, expressions), chargé une fois et
 * partagé par le salon, les parties et le lanceur.
 */
interface PlayersState {
  byId: Record<string, PlayerInfo>
  list: PlayerInfo[]
  loaded: boolean
  loading: boolean
  load: (force?: boolean) => Promise<void>
}

export const usePlayersStore = create<PlayersState>((set, get) => ({
  byId: {},
  list: [],
  loaded: false,
  loading: false,
  load: async (force = false) => {
    if (get().loading || (get().loaded && !force)) return
    set({ loading: true })
    const { data, error } = await supabase
      .from('profiles')
      .select('id, slug, nickname, first_name, expressions, equipped_expression, equipped_tenue, sort_order')
      .order('sort_order')
    if (error || !data) {
      set({ loading: false })
      return
    }
    const list: PlayerInfo[] = data.map((p) => ({
      id: p.id,
      slug: p.slug,
      nickname: p.nickname,
      firstName: p.first_name,
      expressions: p.expressions?.length ? p.expressions : (getCharacter(p.slug)?.expressions ?? ['joie']),
      equipped: p.equipped_expression ?? 'joie',
      equippedTenue: p.equipped_tenue ?? 'default',
      color: getCharacter(p.slug)?.color ?? '#FFB703',
    }))
    set({ list, byId: Object.fromEntries(list.map((p) => [p.id, p])), loaded: true, loading: false })
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
