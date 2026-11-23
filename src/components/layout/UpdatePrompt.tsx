import { useEffect } from 'react'
import { usePWAUpdate } from '@/hooks/usePWAUpdate'
import { toast, useToasts } from '@/store/toast'
import { useUpdateHold } from '@/store/updateHold'

/**
 * Affiche le toast « Nouvelle version dispo » quand un SW en attente est detecte,
 * mais jamais pendant une partie en cours (useHoldUpdate) : il reapparait a la fin.
 */
export function UpdatePrompt() {
  const { needRefresh, applyUpdate } = usePWAUpdate()
  const held = useUpdateHold((s) => s.holds > 0)
  useEffect(() => {
    if (!needRefresh || held) return
    const id = toast('Nouvelle version dispo !', {
      duration: 0,
      action: { label: 'Mettre à jour', onClick: () => void applyUpdate() },
    })
    return () => useToasts.getState().dismiss(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needRefresh, held])
  return null
}
