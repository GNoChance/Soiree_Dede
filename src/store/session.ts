import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CharacterSlug } from '@/data/characters'
import type { ExpressionId } from '@/data/expressions'

/** Forme minimale du profil connecte cote front (phase 2 : alimente par login_profile / profiles). */
export interface SessionProfile {
  id: string
  slug: CharacterSlug
  first_name: string
  nickname: string
  is_admin: boolean
  equipped_expression: ExpressionId
  xp: number
}

interface SessionState {
  profile: SessionProfile | null
  setProfile: (p: SessionProfile | null) => void
  patchProfile: (p: Partial<SessionProfile>) => void
  logout: () => void
}

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      profile: null,
      setProfile: (profile) => set({ profile }),
      patchProfile: (p) => set((s) => (s.profile ? { profile: { ...s.profile, ...p } } : s)),
      // Phase 2 : appeler aussi supabase.auth.signOut() si besoin
      logout: () => set({ profile: null }),
    }),
    { name: 'dede-session' },
  ),
)
