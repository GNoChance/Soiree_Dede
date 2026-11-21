import { useMemo } from 'react'
import { CHARACTERS } from '@/data/characters'
import { playerOrPlaceholder } from '@/features/soiree/players'
import type { PlayerInfo } from '../types'
import type { DedePartyState } from './types'

/** Nombre de bots ajoutés (0 à 8 − joueurs ; seul, au moins 1) — même règle que game_dede_party_start. */
export const effectiveBots = (wanted: number, players: number) => Math.max(0, Math.min(Math.max(wanted, 2 - players), 8 - players))

/**
 * Fiche joueur d'un participant, bots compris (ids 'bot1'…, joués par le serveur) : chaque bot prend un perso
 * que personne ne joue (Dédé en dernier : c'est l'animatrice), dans le même ordre sur tous les écrans.
 */
export function makeGet(players: Record<string, PlayerInfo>, s: Pick<DedePartyState, 'players' | 'bots'>) {
  const bots = s.bots ?? []
  const taken = new Set(s.players.filter((id) => !bots.includes(id)).map((id) => players[id]?.slug))
  const free = CHARACTERS.filter((c) => !taken.has(c.slug)).sort((a, b) => Number(a.slug === 'dede') - Number(b.slug === 'dede'))
  const pool = free.length ? free : CHARACTERS
  const info: Record<string, PlayerInfo> = {}
  bots.forEach((id, k) => {
    const c = pool[k % pool.length]
    info[id] = {
      id,
      slug: c.slug,
      nickname: `${c.nickname} 🤖`,
      firstName: c.firstName,
      expressions: c.expressions,
      equipped: 'joie',
      equippedTenue: 'default',
      color: c.color,
    }
  })
  return (id: string): PlayerInfo => info[id] ?? playerOrPlaceholder(players, id)
}

/** makeGet mémorisé : ne change que si l'annuaire ou la liste des participants change (pas à chaque état). */
export function useGet(players: Record<string, PlayerInfo>, s: Pick<DedePartyState, 'players' | 'bots'>) {
  const roster = `${s.players.join(',')}|${(s.bots ?? []).join(',')}`
  return useMemo(() => {
    const [p, b] = roster.split('|')
    return makeGet(players, { players: p ? p.split(',') : [], bots: b ? b.split(',') : [] })
  }, [players, roster])
}
