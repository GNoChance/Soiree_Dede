import { useEffect } from 'react'
import { useLocation } from 'react-router'
import { useRefetchOnFocus } from '@/hooks/useRefetchOnFocus'
import { useSession } from '@/store/session'
import { syncItems } from './api'
import { isGuestProfile } from '@/features/guest/api'

/** Vérifie les cadeaux mérités à l'ouverture, au retour sur l'appli et à chaque changement d'écran (après une partie…). */
export function useItemSync() {
  const { pathname } = useLocation()
  // Invités (mode invité) : ni cadeaux ni pièces.
  const profileId = useSession((s) => (isGuestProfile(s.profile) ? undefined : s.profile?.id))
  useEffect(() => {
    if (profileId) void syncItems()
  }, [pathname, profileId])
  useRefetchOnFocus(() => {
    const p = useSession.getState().profile
    if (p && !isGuestProfile(p)) void syncItems()
  })
}
