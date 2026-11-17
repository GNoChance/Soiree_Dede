/**
 * Met l'appli installée à jour tout de suite, puis recharge la page.
 * Sert quand une ancienne version réclame un fichier que la dernière mise en ligne a remplacé
 * (recharger seul ne suffit pas : le service worker resservirait la même ancienne version).
 */
export async function forceAppUpdate() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    if (reg) {
      await reg.update().catch(() => undefined)
      const worker = reg.waiting ?? reg.installing
      if (worker) {
        await new Promise<void>((done) => {
          const timeout = setTimeout(done, 5000)
          navigator.serviceWorker.addEventListener(
            'controllerchange',
            () => {
              clearTimeout(timeout)
              done()
            },
            { once: true },
          )
          // vite-plugin-pwa (registerType 'prompt') : le nouveau service worker attend ce message pour prendre la main
          const activate = () => worker.postMessage({ type: 'SKIP_WAITING' })
          if (worker.state === 'installed') activate()
          else worker.addEventListener('statechange', () => worker.state === 'installed' && activate())
        })
      }
    }
  } catch {
    /* pas de service worker (navigateur simple) : un rechargement suffit */
  }
  window.location.reload()
}
