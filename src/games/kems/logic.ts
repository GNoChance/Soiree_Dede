/** Logique pure de Kems (cartes, mains, équipes) — sans React. Contrat : supabase/games/kems.sql. */
import type { TeamColor } from '@/features/teams/teams'
import type { KemsCall, KemsState, KemsTeam } from './types'

export type Suit = 'S' | 'H' | 'D' | 'C'

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']
export const SUIT_GLYPH: Record<Suit, string> = { S: '♠︎', H: '♥︎', D: '♦︎', C: '♣︎' }
const SUIT_ORDER: Suit[] = ['S', 'H', 'D', 'C']
const SUIT_NAME: Record<Suit, string> = { S: 'pique', H: 'coeur', D: 'carreau', C: 'trèfle' }

export const rankOf = (card: string): string => card.slice(0, -1)
export const suitOf = (card: string): Suit => card.slice(-1) as Suit
export const isRed = (card: string): boolean => suitOf(card) === 'H' || suitOf(card) === 'D'
export const cardLabel = (card: string): string => `${rankOf(card)}${SUIT_GLYPH[suitOf(card)]}`
export const cardSpoken = (card: string): string => `${rankOf(card)} de ${SUIT_NAME[suitOf(card)]}`

/** Quatre cartes de même valeur. */
export const isSquare = (hand: readonly string[]): boolean => hand.length === 4 && new Set(hand.map(rankOf)).size === 1

/** Trie : valeurs identiques regroupées, de la plus forte à la plus faible, puis par couleur. */
export function sortHand(hand: readonly string[]): string[] {
  return [...hand].sort((a, b) => RANKS.indexOf(rankOf(b)) - RANKS.indexOf(rankOf(a)) || SUIT_ORDER.indexOf(suitOf(a)) - SUIT_ORDER.indexOf(suitOf(b)))
}

export const teamOf = (s: KemsState, pid: string): KemsTeam | null => s.teams.find((t) => t.players.includes(pid)) ?? null
export const partnerOf = (s: KemsState, pid: string): string | null => teamOf(s, pid)?.players.find((p) => p !== pid) ?? null
export const teamColorOf = (s: KemsState, pid: string): TeamColor | null => teamOf(s, pid)?.id ?? null

/** Remplace `from` par `to` dans une liste, à la même position (échange optimiste). */
export function applySwap(list: readonly string[], from: string, to: string): string[] {
  return list.map((c) => (c === from ? to : c))
}

/** Titre de la révélation. */
export function callHeadline(call: KemsCall): string {
  if (call.type === 'timeout') return 'Manche blanche…'
  if (call.type === 'kems') return call.ok ? (call.double ? 'DOUBLE KEMS !' : 'KEMS !') : 'Faux Kems… raté !'
  return call.ok ? 'CONTRE-KEMS réussi !' : 'Contre-Kems raté…'
}
