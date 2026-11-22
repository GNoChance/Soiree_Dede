import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

/** Miroirs TS de la table / des RPC de supabase/features/cartes-maison.sql (hors src/types/db.ts). */
export type CardGame = 'tu-preferes' | 'action-ou-verite' | 'qui-de-nous'
export type CardKind = 'dilemma' | 'action' | 'verite' | 'question'

export type CardPayload =
  | { a: string; b: string } // dilemma
  | { text: string; level: 1 | 2 | 3 } // action / verite
  | { text: string } // question

export interface CustomCard {
  id: string
  author_id: string
  game_id: CardGame
  kind: CardKind
  payload: Record<string, unknown>
  created_at: string
  hidden: boolean
}

type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
const rpc: Rpc = (fn, args) => (supabase as unknown as { rpc: Rpc }).rpc(fn, args)

type Query = {
  select: (c: string) => {
    order: (k: string, o: { ascending: boolean }) => {
      limit: (n: number) => Promise<{ data: CustomCard[] | null; error: unknown }>
    }
  }
}
const from = (t: string) => (supabase as unknown as { from: (t: string) => Query }).from(t)

/** Toutes les cartes visibles de la bande (les masquées ne sont vues que par leur auteur et l'admin). */
export async function fetchCards(): Promise<CustomCard[]> {
  const { data, error } = await from('custom_cards').select('*').order('created_at', { ascending: false }).limit(2000)
  if (error) throw error
  return data ?? []
}

/** Cartes utilisables en partie (non masquées) d'un jeu. Silencieux : une erreur donne une liste vide. */
export async function fetchPlayableCards(game: CardGame): Promise<CustomCard[]> {
  try {
    return (await fetchCards()).filter((c) => c.game_id === game && !c.hidden)
  } catch {
    return []
  }
}

export async function createCard(game: CardGame, kind: CardKind, payload: CardPayload) {
  const { data, error } = await rpc('create_custom_card', { p_game: game, p_kind: kind, p_payload: payload })
  if (error) throw error
  return data as CustomCard
}

export async function updateCard(id: string, payload: CardPayload) {
  const { data, error } = await rpc('update_custom_card', { p_id: id, p_payload: payload })
  if (error) throw error
  return data as CustomCard
}

export async function deleteCard(id: string) {
  const { error } = await rpc('delete_custom_card', { p_id: id })
  if (error) throw error
}

/** Admin : masque / ré-affiche une carte. */
export async function hideCard(id: string, hidden: boolean) {
  const { error } = await rpc('hide_custom_card', { p_id: id, p_hidden: hidden })
  if (error) throw error
}

/** Nombre de cartes jouables par jeu (pour l'option « Cartes de la bande » des écrans de lancement). */
export function useCardCount(game: CardGame): number | null {
  const [n, setN] = useState<number | null>(null)
  const load = useCallback(async () => {
    try {
      setN((await fetchCards()).filter((c) => c.game_id === game && !c.hidden).length)
    } catch {
      setN(0)
    }
  }, [game])
  useEffect(() => {
    void load()
  }, [load])
  return n
}
