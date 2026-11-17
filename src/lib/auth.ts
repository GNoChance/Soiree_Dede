import { useSession } from '@/store/session'
import { isSupabaseConfigured, supabase } from '@/lib/supabase'
import { isNetworkError } from '@/lib/rpcError'
import { disablePushOnLogout } from '@/features/push/push'
import { levelForXp, type ExpressionId, type LoginResult, type PlayerStatsRow, type ProfileRow } from '@/types/db'

/** Garantit une session anonyme Supabase (réutilise l'existante). */
export async function ensureSession() {
  const { data } = await supabase.auth.getSession()
  if (data.session) return data.session
  const { data: d, error } = await supabase.auth.signInAnonymously()
  if (error) throw error
  return d.session
}

const withLevel = (p: ProfileRow) => ({ ...p, level: levelForXp(p.xp) })

/** Recharge profil + unlocks + stats depuis la base. Retourne false si le profil n'existe plus. */
export async function refreshProfile(id?: string): Promise<boolean> {
  const pid = id ?? useSession.getState().profile?.id
  if (!pid) return false
  const [p, u, s, tu, tr] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', pid).maybeSingle(),
    supabase.from('unlocks').select('*').eq('profile_id', pid),
    supabase.from('player_stats').select('*').eq('profile_id', pid).maybeSingle(),
    supabase.from('tenue_unlocks').select('*').eq('profile_id', pid),
    supabase.from('trophy_unlocks').select('*').eq('profile_id', pid),
  ])
  if (p.error) throw p.error
  if (!p.data) return false
  const unlocks: Partial<Record<ExpressionId, string>> = {}
  for (const row of u.data ?? []) unlocks[row.expression] = row.unlocked_at
  const tenueUnlocks: Record<string, string> = {}
  for (const row of tu.data ?? []) tenueUnlocks[row.tenue_id] = row.unlocked_at
  // serveur pas à jour (table trophy_unlocks absente) : tr.error ignoré, aucun trophée.
  const trophyUnlocks: Record<string, string> = {}
  for (const row of tr.data ?? []) trophyUnlocks[row.trophy_id] = row.unlocked_at
  const st = useSession.getState()
  st.setProfile(withLevel(p.data))
  st.setExtras({ unlocks, tenueUnlocks, trophyUnlocks, stats: (s.data as PlayerStatsRow | null) ?? null })
  return true
}

let bootPromise: Promise<void> | null = null

/** Démarrage : session anonyme, vérification du lien appareil <-> profil, chargement profil. */
export function bootSession(): Promise<void> {
  if (bootPromise) return bootPromise
  bootPromise = (async () => {
    try {
      if (!isSupabaseConfigured) {
        useSession.getState().reset()
        return
      }
      await ensureSession()
      const { data, error } = await supabase.rpc('current_profile_id')
      if (error) throw error
      if (!data) {
        useSession.getState().reset()
        return
      }
      const ok = await refreshProfile(data)
      if (!ok) useSession.getState().reset()
    } catch (e) {
      // Hors ligne : on garde le profil persisté ; sinon on repart propre.
      if (!isNetworkError(e)) useSession.getState().reset()
      console.error('[auth] boot', e)
    } finally {
      useSession.getState().setBooted(true)
    }
  })()
  return bootPromise
}

/** Appelle login_profile et met à jour le store si ok. */
export async function loginWithPin(slug: string, pin: string): Promise<LoginResult> {
  await ensureSession()
  const { data, error } = await supabase.rpc('login_profile', { p_slug: slug, p_pin: pin })
  if (error) throw error
  const res = data as LoginResult
  if (res.ok) {
    useSession.getState().setProfile(res.profile)
    void refreshProfile(res.profile.id).catch(() => undefined)
  }
  return res
}

export async function logout() {
  await disablePushOnLogout()
  try {
    await supabase.rpc('logout_device')
  } catch (e) {
    console.error('[auth] logout', e)
  }
  useSession.getState().reset()
}
