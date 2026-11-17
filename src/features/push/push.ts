import { supabase } from '@/lib/supabase'
import { useSession } from '@/store/session'

/**
 * Notifications push « rappel du défi du jour » (Web Push, envoi par api/daily-reminder.ts).
 * L'abonnement est propre à l'appareil (navigateur) ; on note dans localStorage quel joueur
 * l'a activé ici, pour ne pas transférer les rappels à un autre perso qui se connecterait.
 */
export const VAPID_PUBLIC_KEY = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined)?.trim() || null

/** ok | navigateur sans push | iPhone/iPad hors écran d'accueil | clé VAPID absente (option masquée). */
export type PushSupport = 'ok' | 'unsupported' | 'ios-install' | 'no-key'

const OWNER_KEY = 'soirees-dede:push-owner'

type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
const rpc: Rpc = (fn, args) => (supabase as unknown as { rpc: Rpc }).rpc(fn, args)

export function isIOS() {
  const ua = navigator.userAgent
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

export function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

export function pushSupport(): PushSupport {
  if (!VAPID_PUBLIC_KEY) return 'no-key'
  // Web Push sur iOS (≥ 16.4) : uniquement dans l'app ajoutée à l'écran d'accueil.
  if (isIOS() && !isStandalone()) return 'ios-install'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported'
  return 'ok'
}

export function readOwner(): string | null {
  try {
    return localStorage.getItem(OWNER_KEY)
  } catch {
    return null
  }
}
function writeOwner(id: string | null) {
  try {
    if (id) localStorage.setItem(OWNER_KEY, id)
    else localStorage.removeItem(OWNER_KEY)
  } catch {
    /* stockage indisponible : tant pis, l'abonnement serveur reste la référence */
  }
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4)
  const bin = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array) {
  if (!a) return false
  const x = new Uint8Array(a)
  return x.length === b.length && x.every((v, i) => v === b[i])
}

/** Service worker actif (absent en `npm run dev` : erreur au bout de 8 s plutôt qu'une attente infinie). */
export function swRegistration(timeoutMs = 8000): Promise<ServiceWorkerRegistration> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('push_no_sw')), timeoutMs)),
  ])
}

/** Abonnement existant (si même clé VAPID) ou nouveau. Permission déjà accordée requise. */
async function ensureSubscription(reg: ServiceWorkerRegistration) {
  const key = keyBytes(VAPID_PUBLIC_KEY!)
  let sub = await reg.pushManager.getSubscription()
  if (sub && !sameKey(sub.options.applicationServerKey, key)) {
    await sub.unsubscribe().catch(() => undefined)
    sub = null
  }
  return sub ?? reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
}

async function saveSubscription(sub: PushSubscription) {
  const j = sub.toJSON()
  const { error } = await rpc('save_push_subscription', {
    p_endpoint: sub.endpoint,
    p_p256dh: j.keys?.p256dh ?? '',
    p_auth: j.keys?.auth ?? '',
    p_user_agent: navigator.userAgent,
  })
  if (error) throw error
}

/**
 * Active le rappel. À appeler DIRECTEMENT dans le gestionnaire de clic : la demande de
 * permission doit être la première chose faite (iOS l'exige). `reg` pré-chargé si possible.
 * Erreurs : push_denied, push_dismissed, push_no_sw, push_failed (+ erreurs RPC).
 */
export async function enablePush(profileId: string, reg: ServiceWorkerRegistration | null) {
  const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
  if (perm === 'denied') throw new Error('push_denied')
  if (perm !== 'granted') throw new Error('push_dismissed')
  const registration = reg ?? (await swRegistration())
  let sub: PushSubscription
  try {
    sub = await ensureSubscription(registration)
  } catch (e) {
    console.warn('[push] subscribe', e)
    throw new Error('push_failed', { cause: e })
  }
  await saveSubscription(sub)
  writeOwner(profileId)
}

/** Désactive le rappel sur CET appareil (serveur + navigateur). */
export async function disablePush(reg: ServiceWorkerRegistration | null) {
  writeOwner(null)
  const registration = reg ?? (await swRegistration().catch(() => null))
  const sub = await registration?.pushManager.getSubscription()
  if (!sub) return
  // Même si l'appel serveur échoue, l'abonnement sera purgé au prochain envoi (410).
  await rpc('delete_push_subscription', { p_endpoint: sub.endpoint }).catch(() => undefined)
  await sub.unsubscribe().catch(() => undefined)
}

/** Avant « Changer de personnage » : le rappel ne suit pas l'appareil vers un autre joueur. */
export async function disablePushOnLogout() {
  const me = useSession.getState().profile?.id
  if (!me || readOwner() !== me || pushSupport() !== 'ok') return
  await disablePush(null).catch((e) => console.warn('[push] logout', e))
}

/**
 * Au démarrage / à la connexion : si ce joueur a activé le rappel sur cet appareil,
 * ré-enregistre l'abonnement (le navigateur a pu le renouveler, ou la clé VAPID changer).
 */
async function syncPush(profileId: string) {
  if (pushSupport() !== 'ok' || readOwner() !== profileId || Notification.permission !== 'granted') return
  try {
    await saveSubscription(await ensureSubscription(await swRegistration(15000)))
  } catch (e) {
    console.warn('[push] sync', e)
  }
}

/** Lancé une fois dans main.tsx. */
export function initPushSync() {
  if (!VAPID_PUBLIC_KEY || typeof window === 'undefined') return
  let last: string | null = null
  const check = (booted: boolean, id: string | undefined) => {
    if (!booted || !id) {
      if (!id) last = null
      return
    }
    if (id === last) return
    last = id
    void syncPush(id)
  }
  const s = useSession.getState()
  check(s.booted, s.profile?.id)
  useSession.subscribe((st) => check(st.booted, st.profile?.id))
}

/** Clic sur une notification alors que l'app est déjà ouverte : public/push-sw.js demande de naviguer. */
export function onPushOpen(navigate: (path: string) => void) {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  navigator.serviceWorker.addEventListener('message', (e: MessageEvent) => {
    const d = e.data as { type?: string; url?: string } | null
    if (d?.type === 'push-open' && typeof d.url === 'string' && d.url.startsWith('/') && !d.url.startsWith('//')) {
      navigate(d.url)
    }
  })
}
