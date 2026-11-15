import { useRegisterSW } from 'virtual:pwa-register/react'

/** Etat de mise a jour du service worker (registerType: 'prompt'). */
export function usePWAUpdate() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      // Verifie les mises a jour toutes les heures
      if (reg) setInterval(() => void reg.update(), 60 * 60 * 1000)
    },
  })
  return {
    needRefresh,
    dismiss: () => setNeedRefresh(false),
    /** Active la nouvelle version et recharge */
    applyUpdate: () => updateServiceWorker(true),
  }
}
