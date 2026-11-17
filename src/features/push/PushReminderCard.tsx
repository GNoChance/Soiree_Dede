import { useEffect, useRef, useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Toggle } from '@/components/ui/Toggle'
import { errorCode, toastError } from '@/features/soiree/errors'
import { useSession } from '@/store/session'
import { toast } from '@/store/toast'
import { disablePush, enablePush, isIOS, pushSupport, readOwner, swRegistration } from './push'

const LABEL = '🔔 Me rappeler le défi à 18 h'

function deniedHelp() {
  const ua = navigator.userAgent
  if (isIOS()) return 'Pour les réactiver : Réglages de l’iPhone → Notifications → Soirées Dédé → Autoriser.'
  if (/Android/i.test(ua)) return 'Pour les réactiver : appui long sur l’icône de l’app → Infos sur l’appli → Notifications → Autoriser.'
  return 'Pour les réactiver : clique sur le cadenas à gauche de l’adresse du site → Notifications → Autoriser.'
}

/**
 * Opt-in au rappel push du défi du jour (Réglages, et page du défi avec `promo`).
 * `promo` : n'affiche rien si le rappel est déjà actif ou impossible sur ce navigateur.
 * Masqué entièrement sans VITE_VAPID_PUBLIC_KEY.
 */
export function PushReminderCard({ promo = false }: { promo?: boolean }) {
  const me = useSession((s) => s.profile?.id)
  const [support] = useState(pushSupport)
  const [permission, setPermission] = useState<NotificationPermission>(() =>
    typeof Notification === 'undefined' ? 'default' : Notification.permission,
  )
  const [enabled, setEnabled] = useState<boolean | null>(support === 'ok' ? null : false)
  const [busy, setBusy] = useState(false)
  const regRef = useRef<ServiceWorkerRegistration | null>(null)

  useEffect(() => {
    if (support !== 'ok' || !me) return
    let alive = true
    swRegistration()
      .then(async (reg) => {
        regRef.current = reg
        const sub = await reg.pushManager.getSubscription()
        if (alive) setEnabled(Boolean(sub) && readOwner() === me && Notification.permission === 'granted')
      })
      .catch(() => alive && setEnabled(false))
    return () => {
      alive = false
    }
  }, [support, me])

  if (support === 'no-key' || !me) return null
  if (promo && (enabled !== false || support === 'unsupported')) return null

  const onChange = (next: boolean) => {
    if (busy || enabled === null) return
    setBusy(true)
    // enablePush demande la permission en tout premier, toujours dans le clic (exigé par iOS).
    const job = next ? enablePush(me, regRef.current) : disablePush(regRef.current)
    job
      .then(() => {
        setEnabled(next)
        if (next) toast.success('C’est noté ! Petit rappel à 18 h si tu n’as pas encore joué 🔔')
      })
      .catch((e) => {
        const code = errorCode(e)
        if (code === 'push_denied') setPermission('denied')
        else toastError(e)
      })
      .finally(() => {
        setBusy(false)
        if (typeof Notification !== 'undefined') setPermission(Notification.permission)
      })
  }

  return (
    <Card className="flex flex-col gap-2">
      {support === 'ok' ? (
        <div className="flex items-center justify-between gap-3">
          <span className="font-display text-lg font-extrabold leading-tight">{LABEL}</span>
          <div className={busy || enabled === null ? 'pointer-events-none opacity-60' : undefined}>
            <Toggle checked={Boolean(enabled)} onChange={onChange} label={LABEL} />
          </div>
        </div>
      ) : (
        <span className="font-display text-lg font-extrabold leading-tight">{LABEL}</span>
      )}

      {support === 'ios-install' && (
        <div className="text-sm font-bold leading-snug">
          <p>Sur iPhone, les rappels marchent seulement avec l’app installée :</p>
          <ol className="mt-1 list-decimal pl-5">
            <li>dans <strong>Safari</strong>, touche le bouton <strong>Partager</strong> ⬆️ ;</li>
            <li>choisis <strong>« Sur l’écran d’accueil »</strong> ;</li>
            <li>ouvre l’app depuis la nouvelle icône et reviens ici.</li>
          </ol>
        </div>
      )}
      {support === 'unsupported' && (
        <p className="text-sm font-bold leading-snug text-muted">
          {isIOS()
            ? 'Mets ton iPhone à jour (iOS 16.4 minimum) pour recevoir les rappels.'
            : 'Ce navigateur ne sait pas recevoir de notifications. Essaie avec Chrome, Firefox, Edge ou Safari.'}
        </p>
      )}
      {support === 'ok' && permission === 'denied' && !enabled && (
        <p className="text-sm font-bold leading-snug">🚫 Les notifications sont bloquées. {deniedHelp()} Puis réessaie ici.</p>
      )}
      {support === 'ok' && permission !== 'denied' && (
        <p className="text-sm leading-snug text-muted">
          {enabled
            ? 'Activé sur cet appareil. Pas de rappel les jours où tu as déjà joué 😉'
            : 'Un petit coup de coude à 18 h, seulement si tu n’as pas encore joué.'}
        </p>
      )}
    </Card>
  )
}
