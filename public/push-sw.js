/* Notifications push (rappel du défi du jour). Chargé par le service worker généré
 * (vite.config.ts > workbox.importScripts). JS « nu » : pas de bundler ici. */
/* eslint-disable */

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (e) {
    data = { body: event.data ? event.data.text() : '' }
  }
  const title = data.title || 'Les Soirées de Dédé'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || 'Le défi du jour t’attend !',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      tag: data.tag || 'defi-du-jour', // un seul rappel affiché à la fois
      lang: 'fr',
      data: { url: data.url || '/defi' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const path = (event.notification.data && event.notification.data.url) || '/'
  const url = new URL(path, self.location.origin).href
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const win = wins.find((c) => new URL(c.url).origin === self.location.origin)
      if (win) {
        // Onglet déjà ouvert : on le met devant et l'app navigue elle-même (sans rechargement).
        await win.focus()
        win.postMessage({ type: 'push-open', url: path })
        return
      }
      await self.clients.openWindow(url)
    })(),
  )
})

// Abonnement renouvelé par le navigateur : on se réabonne avec la même clé ;
// l'app enregistre le nouvel abonnement côté serveur à sa prochaine ouverture.
self.addEventListener('pushsubscriptionchange', (event) => {
  const key = event.oldSubscription && event.oldSubscription.options && event.oldSubscription.options.applicationServerKey
  if (!key) return
  event.waitUntil(
    self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }).catch(() => undefined),
  )
})
