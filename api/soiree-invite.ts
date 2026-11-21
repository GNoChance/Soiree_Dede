/**
 * Notification push « <hôte> t'invite à sa soirée ! » (fonction serverless Vercel, runtime Node).
 *
 * Appelée par pg_net (trigger sur soiree_players, supabase/features/push_invites.sql) avec
 * `Authorization: Bearer <PUSH_CRON_SECRET>` (même secret et mêmes variables que api/daily-reminder.ts).
 * Lit la file via push_invite_claim() (clé service role), envoie, rend compte via push_report().
 */
import { timingSafeEqual } from 'node:crypto'
import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'

interface Target {
  endpoint: string
  p256dh: string
  auth: string
  profile_id: string
  host_nick: string
  soiree_id: string
}

const json = (body: unknown, status = 200) => Response.json(body, { status })

function authorized(req: Request, secret: string) {
  const got = Buffer.from(req.headers.get('authorization') ?? '')
  const want = Buffer.from(`Bearer ${secret}`)
  return got.length === want.length && timingSafeEqual(got, want)
}

async function handle(req: Request): Promise<Response> {
  const env = process.env
  const cfg = {
    PUSH_CRON_SECRET: env.PUSH_CRON_SECRET,
    VAPID_PUBLIC_KEY: env.VAPID_PUBLIC_KEY ?? env.VITE_VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: env.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: env.VAPID_SUBJECT,
    SUPABASE_URL: env.SUPABASE_URL ?? env.VITE_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
  }
  const missing = Object.entries(cfg).filter(([, v]) => !v).map(([k]) => k)
  if (missing.length) return json({ error: 'missing_config', missing }, 500)
  if (!authorized(req, cfg.PUSH_CRON_SECRET!)) return json({ error: 'unauthorized' }, 401)

  const db = createClient(cfg.SUPABASE_URL!, cfg.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await db.rpc('push_invite_claim')
  if (error) return json({ error: 'rpc_failed', details: error.message }, 500)
  const targets = (data ?? []) as Target[]
  if (!targets.length) return json({ targets: 0, sent: 0 })

  webpush.setVapidDetails(cfg.VAPID_SUBJECT!, cfg.VAPID_PUBLIC_KEY!, cfg.VAPID_PRIVATE_KEY!)
  const results = await Promise.allSettled(
    targets.map((t) =>
      webpush.sendNotification(
        { endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } },
        JSON.stringify({
          title: `🎉 ${t.host_nick} t’invite à sa soirée !`,
          body: 'Viens vite le rejoindre dans le salon, on t’attend pour jouer.',
          url: `/soiree/${t.soiree_id}`,
          tag: `invite-${t.soiree_id}`,
        }),
        { TTL: 3600, urgency: 'high', timeout: 10_000 },
      ),
    ),
  )

  const ok: string[] = []
  const dead: string[] = []
  const errors: string[] = []
  results.forEach((r, i) => {
    const endpoint = targets[i].endpoint
    if (r.status === 'fulfilled') return void ok.push(endpoint)
    const code = (r.reason as { statusCode?: number })?.statusCode
    if (code === 404 || code === 410) dead.push(endpoint)
    else errors.push(`${code ?? '?'} ${String((r.reason as Error)?.message ?? r.reason).slice(0, 120)}`)
  })
  if (ok.length || dead.length) {
    const rep = await db.rpc('push_report', { p_ok: ok, p_dead: dead })
    if (rep.error) errors.push(`push_report: ${rep.error.message}`)
  }
  return json({ targets: targets.length, sent: ok.length, dead: dead.length, failed: errors.length, errors: errors.slice(0, 5) })
}

export { handle as GET, handle as POST }
