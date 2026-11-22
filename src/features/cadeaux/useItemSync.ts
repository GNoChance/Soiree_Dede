import { useEffect } from 'react'
import { useLocation } from 'react-router'
import { useRefetchOnFocus } from '@/hooks/useRefetchOnFocus'
import { useSession } from '@/store/session'
import { syncItems } from './api'

/** Vérifie les cadeaux mérités à l'ouverture, au retour sur l'appli et à chaque changement d'écran (après une partie…). */
export function useItemSync() {
  const { pathname } = useLocation()
  const profileId = useSession((s) => s.profile?.id)
  useEffect(() => {
    if (profileId) void syncItems()
  }, [pathname, profileId])
  useRefetchOnFocus(() => {
    if (useSession.getState().profile) void syncItems()
  })
}
