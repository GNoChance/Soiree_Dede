import { useEffect } from 'react'
import { usePWAUpdate } from '@/hooks/usePWAUpdate'
import { toast, useToasts } from '@/store/toast'

/** Affiche le toast « Nouvelle version dispo » quand un SW en attente est detecte. */
export function UpdatePrompt() {
  const { needRefresh, applyUpdate, dismiss } = usePWAUpdate()
  useEffect(() => {
    if (!needRefresh) return
    const id = toast('Nouvelle version dispo !', {
      duration: 0,
      action: { label: 'Mettre à jour', onClick: () => void applyUpdate() },
    })
    return () => {
      useToasts.getState().dismiss(id)
      dismiss()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needRefresh])
  return null
}
