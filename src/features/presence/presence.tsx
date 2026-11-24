import { useCallback, useEffect, useState } from 'react'
import { useSession } from '@/store/session'
import { isGuestProfile } from '@/features/guest/api'
import { useResync } from '@/features/soiree/hooks'
import { loose } from '@/features/soiree/hostTools'
import { serverNow } from '@/features/soiree/useServerClock'
import { cn } from '@/lib/cn'
import { presenceLabel } from './label'

/** Présence (supabase/features/presence.sql) : un signal par minute tant que l'app est à l'écran. */
const PING_MS = 60_000
const POLL_MS = 60_000

/** À monter une fois (Root) : envoie le signal « je suis là » tant que l'app est visible. Membres seulement. */
export function PresencePinger() {
  const meId = useSession((s) => (isGuestProfile(s.profile) ? null : s.profile?.id ?? null))
  useEffect(() => {
    if (!meId) return
    const ping = () => {
      // await obligatoire : le client Supabase n'envoie la requête qu'au then() (sinon rien ne part).
      if (document.visibilityState === 'visible') void (async () => { await loose.rpc('ping_presence', {}) })()
    }
    ping()
    const t = window.setInterval(ping, PING_MS)
    document.addEventListener('visibilitychange', ping)
    return () => {
      window.clearInterval(t)
      document.removeEventListener('visibilitychange', ping)
    }
  }, [meId])
  return null
}

/** Dernière activité des membres de la bande : { <profile_id>: horodatage ms }. Relue chaque minute. */
export function useBandPresence(): Record<string, number> {
  const [seen, setSeen] = useState<Record<string, number>>({})
  const refetch = useCallback(async () => {
    const { data, error } = await loose.rpc('band_presence', {})
    if (error || !Array.isArray(data)) return
    setSeen(Object.fromEntries((data as { profile_id: string; last_seen_at: string }[]).map((r) => [r.profile_id, Date.parse(r.last_seen_at)])))
  }, [])
  useEffect(() => {
    void refetch()
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refetch()
    }, POLL_MS)
    return () => window.clearInterval(t)
  }, [refetch])
  useResync(() => void refetch())
  return seen
}

/** Pastille verte « en ligne » à poser en coin d'un avatar (parent en `relative`). */
export function OnlineDot({ lastSeen, className }: { lastSeen: number | undefined; className?: string }) {
  if (!presenceLabel(lastSeen, serverNow())?.online) return null
  return (
    <span
      aria-hidden
      className={cn('absolute -right-0.5 -bottom-0.5 size-4 rounded-full border-[3px] border-ink bg-mint', className)}
    />
  )
}

/** « En ligne » (vert) ou « Vu il y a 3 h » ; rien si jamais vu. */
export function PresenceText({ lastSeen, className }: { lastSeen: number | undefined; className?: string }) {
  const l = presenceLabel(lastSeen, serverNow())
  if (!l) return null
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-bold', l.online ? 'text-text' : 'text-muted', className)}>
      {l.online && <span aria-hidden className="size-2 rounded-full border border-ink bg-mint" />}
      {l.text}
    </span>
  )
}
