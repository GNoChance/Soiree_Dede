import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Toggle } from '@/components/ui/Toggle'
import { toastError } from '@/features/soiree/errors'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/store/session'
import { VAPID_PUBLIC_KEY } from './push'

type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
const rpc: Rpc = (fn, args) => (supabase as unknown as { rpc: Rpc }).rpc(fn, args)

const LABEL = '🎉 Me prévenir quand on m’invite'

/** Préférence (côté serveur, par joueur) : notification quand un hôte m'ajoute à sa soirée. */
export function PushInviteCard() {
  const me = useSession((s) => s.profile?.id)
  const [on, setOn] = useState<boolean | null>(null)
  useEffect(() => {
    if (!me || !VAPID_PUBLIC_KEY) return
    let alive = true
    void rpc('get_push_prefs').then(({ data }) => {
      if (alive) setOn((data as { invites?: boolean } | null)?.invites !== false)
    })
    return () => {
      alive = false
    }
  }, [me])
  if (!me || !VAPID_PUBLIC_KEY) return null
  const change = (next: boolean) => {
    const prev = on
    setOn(next)
    void rpc('set_push_invites', { p_enabled: next }).then(({ error }) => {
      if (error) {
        setOn(prev)
        toastError(error)
      }
    })
  }
  return (
    <Card className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3">
        <span className="font-display text-lg font-extrabold leading-tight">{LABEL}</span>
        <div className={on === null ? 'pointer-events-none opacity-60' : undefined}>
          <Toggle checked={on !== false} onChange={change} label={LABEL} />
        </div>
      </div>
      <p className="text-sm leading-snug text-muted">Une notification quand un ami t’ajoute à sa soirée (si les notifications sont activées juste au-dessus).</p>
    </Card>
  )
}
