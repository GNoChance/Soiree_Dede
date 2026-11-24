import { useEffect } from 'react'
import { create } from 'zustand'
import { loose } from '@/features/soiree/hostTools'
import { useResync } from '@/features/soiree/hooks'
import { useSession } from '@/store/session'
import { isGuestProfile } from '@/features/guest/api'

/** Événement de Noël (supabase/features/noel.sql) : état renvoyé par noel_state(). */
export interface NoelClaim {
  kind: 'pass' | 'band'
  tier: number
  coins: number
  item_id: string | null
  compensated: boolean
}

export interface NoelState {
  phase: 'before' | 'live' | 'over' | 'off'
  key: string | null
  day: string
  starts_on: string | null
  ends_on: string | null
  missions: { id: string; done: boolean }[]
  soiree_bonus: boolean
  hotte: { status: 'todo' | 'running' | 'done'; score: number; flakes: number }
  flakes: number
  tier: number
  next_at: number | null
  streak: { current: number; best: number }
  band: { total: number; tier: number; me: number; eligible: boolean; contributors: { profile_id: string; flakes: number }[] }
  new_claims: NoelClaim[]
}

export const NOEL_TIER_FLAKES = 150
export const NOEL_BAND_TIERS = [6000, 14000, 22000, 30000, 38000] as const
export const NOEL_ELIGIBLE = 400
export const NOEL_STREAK_BONUS = [
  { days: 3, flakes: 30 },
  { days: 7, flakes: 70 },
  { days: 14, flakes: 140 },
  { days: 21, flakes: 210 },
] as const

export { NOEL_PASS_REWARDS, NOEL_BAND_REWARDS, type NoelPassReward } from './rewards'

interface NoelStore {
  state: NoelState | null
  loading: boolean
  /** Dernière lecture réussie (ms), pour ne pas rappeler le serveur à chaque retour au premier plan. */
  fetchedAt: number
  /** Récompenses à célébrer : toutes présentées ensemble dans une seule modale (NoelCelebrations). */
  queue: NoelClaim[]
  clearQueue: () => void
  /** Relit l'état, sauf si la dernière lecture date de moins de minAgeMs (0 = toujours). */
  refresh: (minAgeMs?: number) => Promise<void>
}

let inflight: Promise<void> | null = null

export const useNoelStore = create<NoelStore>((set, get) => ({
  state: null,
  loading: false,
  fetchedAt: 0,
  queue: [],
  clearQueue: () => set({ queue: [] }),
  refresh: (minAgeMs = 0) => {
    if (inflight) return inflight
    if (minAgeMs > 0 && Date.now() - get().fetchedAt < minAgeMs) return Promise.resolve()
    inflight = (async () => {
      set({ loading: true })
      try {
        const { data, error } = await loose.rpc('noel_state', {})
        if (error || !data) return
        const st = data as NoelState
        set({ state: st, fetchedAt: Date.now(), queue: [...get().queue, ...(st.new_claims ?? [])] })
      } finally {
        set({ loading: false })
        inflight = null
      }
    })()
    return inflight
  },
}))

/** Hors des pages Noël : au plus une lecture toutes les 30 s (noel_state calcule toute la bande). */
const BACKGROUND_MIN_AGE = 30_000

/**
 * État de l'événement (membres seulement). fresh : relu à chaque montage (pages Noël) ; sinon au plus
 * toutes les 30 s (accueil, vidéo d'annonce). Relu aussi au retour au premier plan (même limite).
 */
export function useNoelState(fresh = false): { state: NoelState | null; refetch: () => Promise<void> } {
  const member = useSession((s) => Boolean(s.profile) && !isGuestProfile(s.profile))
  const state = useNoelStore((s) => (member ? s.state : null))
  const refresh = useNoelStore((s) => s.refresh)
  useEffect(() => {
    if (member) void refresh(fresh ? 0 : BACKGROUND_MIN_AGE)
  }, [member, refresh, fresh])
  useResync(() => {
    if (member) void refresh(BACKGROUND_MIN_AGE)
  })
  return { state, refetch: () => refresh(0) }
}

/** Jours restants avant la fin de l'édition (inclus le jour courant). */
export function noelDaysLeft(st: NoelState): number {
  if (!st.ends_on) return 0
  return Math.max(0, Math.round((Date.parse(st.ends_on) - Date.parse(st.day)) / 86400000) + 1)
}
