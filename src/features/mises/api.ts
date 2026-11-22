import { useCallback, useEffect, useRef, useState } from 'react'
import { useResync } from '@/features/soiree/hooks'
import { loose } from '@/features/soiree/hostTools'
import { getGame } from '@/games/registry'
import type { GameDefinition } from '@/games/types'

/* Miroirs TS des RPC de supabase/features/mises.sql (wrappers typés à la main). */

/** Mises possibles sur une partie. */
export const WAGER_STAKES = [10, 25, 50] as const
/** Enjeux possibles d'un défi. */
export const CHALLENGE_STAKES = [0, 10, 25, 50, 100] as const
/** Jeux en duel jouables en défi (le serveur vérifie : jeu du socle duel). */
export const CHALLENGE_GAME_IDS = ['morpion', 'quatre-a-la-suite', 'bataille-navale', 'echecs'] as const

export const challengeGames = (): GameDefinition[] => CHALLENGE_GAME_IDS.map((id) => getGame(id)).filter(Boolean) as GameDefinition[]

/** « ×2,5 » */
export const fmtOdds = (o: number) => `×${Number(o).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}`

export type WagerStatus = 'open' | 'won' | 'lost' | 'refunded'
export interface MyWager {
  pick: string
  stake: number
  odds: number
  status: WagerStatus
  /** Pièces rendues (gain ou remboursement), 0 si perdu / pas encore réglé. */
  payout: number
  /** Gain si le joueur choisi gagne (floor(mise × cote)). */
  gain: number
}
export interface WagerState {
  can_bet: boolean
  open: boolean
  closes_at: string
  coins: number
  stakes: number[]
  odds: Record<string, number>
  backers: Record<string, number>
  total: number
  mine: MyWager | null
}

export type ChallengeStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired' | 'finished' | 'void'
export interface Challenge {
  id: string
  challenger_id: string
  opponent_id: string
  game_id: string
  stake: number
  status: ChallengeStatus
  match_id: string | null
  winner_id: string | null
  created_at: string
  expires_at: string
  accepted_at: string | null
  settled_at: string | null
  role: 'sent' | 'received'
  other_id: string
  match_status: 'lobby' | 'playing' | 'finished' | null
}
export interface ChallengeOptions {
  coins: number
  friends: { id: string; max_stake: number; open: boolean }[]
}

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await loose.rpc(fn, args ?? {})
  if (error) throw error
  return data as T
}

export const placeWager = (matchId: string, pick: string, stake: number) =>
  call<WagerState>('place_wager', { p_match_id: matchId, p_pick: pick, p_stake: stake })
export const fetchChallengeOptions = () => call<ChallengeOptions>('challenge_options')
export const createChallenge = (other: string, game: string, stake: number) =>
  call<Challenge>('create_challenge', { p_other: other, p_game: game, p_stake: stake })
export const respondChallenge = (id: string, accept: boolean) => call<Challenge>('respond_challenge', { p_id: id, p_accept: accept })
export const cancelChallenge = (id: string) => call<Challenge>('cancel_challenge', { p_id: id })
export const playChallenge = (id: string) => call<{ soiree_id: string }>('play_challenge', { p_id: id })
export const startChallenge = (id: string, soireeId: string, options: Record<string, unknown>) =>
  call<string>('start_challenge', { p_id: id, p_soiree_id: soireeId, p_options: options })

/**
 * Paris d'une partie (spectateurs). Relu à chaque changement de `refreshKey` (fin de partie)
 * et toutes les 4 s tant que les paris sont ouverts (compteurs de parieurs, fermeture).
 * `enabled = false` (je joue la partie) : aucun appel.
 */
export function useMatchWagers(matchId: string | undefined, enabled: boolean, refreshKey: string) {
  const [data, setData] = useState<WagerState | null>(null)
  const ask = useRef(0)
  const refetch = useCallback(async () => {
    if (!matchId || !enabled) return
    const n = ++ask.current
    const { data: d, error } = await loose.rpc('match_wagers', { p_match_id: matchId })
    if (n === ask.current && !error && d) setData(d as WagerState)
  }, [matchId, enabled])
  useEffect(() => {
    void refetch()
  }, [refetch, refreshKey])
  useResync(() => void refetch())
  const open = Boolean(data?.open)
  useEffect(() => {
    if (!open) return
    const t = window.setInterval(() => void refetch(), 4_000)
    return () => clearInterval(t)
  }, [open, refetch])
  const place = useCallback(
    async (pick: string, stake: number) => {
      if (!matchId) return
      ask.current++
      setData(await placeWager(matchId, pick, stake))
    },
    [matchId],
  )
  return { data, refetch, place }
}

/** Mes défis (reçus, envoyés, à jouer, historique) + mon solde. Relu au retour sur l'app et chaque minute. */
export function useMyChallenges(enabled = true) {
  const [data, setData] = useState<{ coins: number; challenges: Challenge[] } | null>(null)
  const [error, setError] = useState(false)
  const refetch = useCallback(async () => {
    if (!enabled) return
    const { data: d, error: e } = await loose.rpc('my_challenges', {})
    if (e) setError(true)
    else {
      setError(false)
      setData(d as { coins: number; challenges: Challenge[] })
    }
  }, [enabled])
  useEffect(() => {
    void refetch()
    const t = window.setInterval(() => void refetch(), 60_000)
    return () => clearInterval(t)
  }, [refetch])
  useResync(() => void refetch())
  return { data, error, refetch }
}

/** Défis acceptés jouables dans cette soirée (les deux joueurs y sont). */
export function useSoireeChallenges(soireeId: string | undefined, refreshKey: string) {
  const [list, setList] = useState<Challenge[]>([])
  const refetch = useCallback(async () => {
    if (!soireeId) return
    const { data, error } = await loose.rpc('soiree_challenges', { p_soiree_id: soireeId })
    if (!error && Array.isArray(data)) setList(data as Challenge[])
  }, [soireeId])
  useEffect(() => {
    void refetch()
  }, [refetch, refreshKey])
  useResync(() => void refetch())
  return { list, refetch }
}

/** « dans 31 h » / « dans 12 min » */
export function untilLabel(iso: string, now = Date.now()) {
  const ms = new Date(iso).getTime() - now
  if (ms <= 0) return 'bientôt'
  const h = Math.floor(ms / 3_600_000)
  return h >= 1 ? `${h} h` : `${Math.max(1, Math.floor(ms / 60_000))} min`
}
