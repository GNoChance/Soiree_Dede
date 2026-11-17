import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ExpressionId, PlayerStatsRow, ProfileJson } from '@/types/db'

/** Profil connecté côté front = ligne profiles + niveau calculé. */
export type SessionProfile = ProfileJson

interface SessionState {
  profile: SessionProfile | null
  /** expression -> date de déblocage (ISO) */
  unlocks: Partial<Record<ExpressionId, string>>
  /** tenue -> date de déblocage (ISO) ; 'default' toujours implicite */
  tenueUnlocks: Record<string, string>
  /** trophée -> date d'obtention (ISO) */
  trophyUnlocks: Record<string, string>
  stats: PlayerStatsRow | null
  /** true une fois la vérification de session de démarrage terminée */
  booted: boolean
  setProfile: (p: SessionProfile | null) => void
  patchProfile: (p: Partial<SessionProfile>) => void
  setExtras: (e: { unlocks?: SessionState['unlocks']; tenueUnlocks?: SessionState['tenueUnlocks']; trophyUnlocks?: SessionState['trophyUnlocks']; stats?: PlayerStatsRow | null }) => void
  setBooted: (b: boolean) => void
  /** Reset local uniquement (la session anonyme Supabase est conservée). Voir lib/auth.logout pour l'appel RPC. */
  reset: () => void
}

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      profile: null,
      unlocks: {},
      tenueUnlocks: {},
      trophyUnlocks: {},
      stats: null,
      booted: false,
      setProfile: (profile) => set({ profile }),
      patchProfile: (p) => set((s) => (s.profile ? { profile: { ...s.profile, ...p } } : s)),
      setExtras: (e) => set(e),
      setBooted: (booted) => set({ booted }),
      reset: () => set({ profile: null, unlocks: {}, tenueUnlocks: {}, trophyUnlocks: {}, stats: null }),
    }),
    {
      name: 'dede-session-v2',
      partialize: (s) => ({ profile: s.profile }),
    },
  ),
)
