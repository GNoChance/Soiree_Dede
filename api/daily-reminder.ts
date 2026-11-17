/**
 * Rappel push du « Défi du jour » (fonction serverless Vercel, runtime Node).
 *
 * Appelée à 18 h (Paris) par pg_cron + pg_net (supabase/features/push.sql), avec
 * `Authorization: Bearer <PUSH_CRON_SECRET>`. GET ou POST.
 *   - sans paramètre : envoie aux joueurs n'ayant pas joué aujourd'hui (une fois par jour max) ;
 *   - `?dry=1`       : liste seulement le nombre de destinataires, n'envoie rien ;
 *   - `?test=<slug>` : envoie un rappel de test à tous les appareils de ce joueur, sans condition.
 * Variables : VAPID_PUBLIC_KEY (ou VITE_VAPID_PUBLIC_KEY), VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:),
 * SUPABASE_URL (ou VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY, PUSH_CRON_SECRET.
 */
import { timingSafeEqual } from 'node:crypto'
import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'

interface Target {
  endpoint: string
  p256dh: string
  auth: string
  profile_id: string
  nickname: string
  streak: number
}

const TITLES = [
  '🗓️ Le défi du jour t’attend !',
  '⏰ Psst… le défi du jour !',
  '🧠 Ton cerveau a rendez-vous',
  '🎉 Dédé s’impatiente !',
]
const BODIES = [
  '6 manches, 2 minutes : la bande t’attend au classement !',
  'Dédé a préparé ses questions, il ne manque plus que toi.',
  'Deux minutes chrono pour briller (ou pour rigoler). On y va ?',
  'Le classement du jour a un trou à ta place. Viens le boucher !',
  'Petite gym du cerveau : 6 manches et c’est plié.',
  'Une seule tentative, zéro excuse. À toi de jouer, {nick} !',
]
const STREAK_BODIES = [
  'Ta série de {n} jours est en jeu ! Ne la laisse pas filer 🔥',
  '{n} jours d’affilée… ce serait bête de s’arrêter là, non ?',
  '🔥 {n} jours de suite ! Le défi de ce soir t’attend pour le {n1}e.',
  '{nick}, ta série de {n} jours compte sur toi ce soir !',
]

function pick<T>(a: readonly T[]): T {
  return a[Math.floor(Math.random() * a.length)]
}

function buildMessage(t: Target, test: boolean) {
  const nick = t.nickname || 'toi'
  const body = (t.streak > 1 ? pick(STREAK_BODIES) : pick(BODIES))
    .replaceAll('{n1}', String(t.streak + 1))
    .replaceAll('{n}', String(t.streak))
    .replaceAll('{nick}', nick)
  return {
    title: test ? '🧪 Test : ' + pick(TITLES) : pick(TITLES),
    body,
    url: '/defi',
    tag: 'defi-du-jour',
  }
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

  const params = new URL(req.url).searchParams
  const testSlug = params.get('test')?.trim() || null
  const dry = params.get('dry') === '1'

  const db = createClient(cfg.SUPABASE_URL!, cfg.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = testSlug
    ? await db.rpc('push_test_targets', { p_slug: testSlug })
    : await db.rpc('push_daily_reminder_targets', { p_claim: !dry })
  if (error) return json({ error: 'rpc_failed', details: error.message }, 500)
  const targets = (data ?? []) as Target[]
  if (dry) return json({ mode: 'dry', targets: targets.length })

  webpush.setVapidDetails(cfg.VAPID_SUBJECT!, cfg.VAPID_PUBLIC_KEY!, cfg.VAPID_PRIVATE_KEY!)
  const results = await Promise.allSettled(
    targets.map((t) =>
      webpush.sendNotification(
        { endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } },
        JSON.stringify(buildMessage(t, Boolean(testSlug))),
        // Rappel inutile après minuit : expire au bout de 5 h. `topic` remplace un rappel encore en attente.
        { TTL: 5 * 3600, urgency: 'normal', topic: 'defi-du-jour', timeout: 10_000 },
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
  return json({ mode: testSlug ? 'test' : 'daily', targets: targets.length, sent: ok.length, dead: dead.length, failed: errors.length, errors: errors.slice(0, 5) })
}

export { handle as GET, handle as POST }
