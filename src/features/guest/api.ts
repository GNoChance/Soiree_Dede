import { supabase } from '@/lib/supabase'
import { ensureSession, refreshProfile } from '@/lib/auth'
import { useSession } from '@/store/session'
import { usePlayersStore } from '@/features/soiree/players'
import { isGuestSlug } from '@/data/guests'
import type { ProfileJson } from '@/types/db'

/** Miroirs TS des RPC de supabase/features/guest.sql (hors src/types/db.ts). */
type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
const rpc: Rpc = (fn, args) => (supabase as unknown as { rpc: Rpc }).rpc(fn, args)

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(fn, args)
  if (error) throw error
  return data as T
}

export interface GuestInvite {
  soiree_id: string
  code: string
  token: string
  guests: number
  max_guests: number
}

export interface GuestInviteInfo {
  soiree_id: string
  code: string
  host_nickname: string
  host_slug: string
  players: number
  /** Ce téléphone : aucun profil, déjà invité, ou membre de la bande. */
  me: 'none' | 'guest' | 'member'
  joined: boolean
}

/** Profil connecté = invité ? (colonne is_guest lue par refreshProfile, sinon slug `g-…`). */
export function isGuestProfile(p: ProfileJson | null | undefined): boolean {
  if (!p) return false
  const flag = (p as ProfileJson & { is_guest?: boolean }).is_guest
  return flag ?? isGuestSlug(p.slug)
}

export const useIsGuest = () => useSession((s) => isGuestProfile(s.profile))

/** Hôte : ouvre les invitations de la soirée (jeton du QR code). */
export const openGuestInvites = (soireeId: string) => call<GuestInvite>('open_guest_invites', { p_soiree_id: soireeId })

/** Hôte : ferme les invitations (les invités présents restent). */
export const closeGuestInvites = (soireeId: string) => call<null>('close_guest_invites', { p_soiree_id: soireeId })

/** Aperçu d'une invitation (code à 4 caractères ou jeton du QR). */
export async function guestInviteInfo(code: string): Promise<GuestInviteInfo> {
  await ensureSession()
  return call<GuestInviteInfo>('guest_invite_info', { p_code: code })
}

/** Rejoint la soirée en invité ; met la session à jour. Renvoie l'id de la soirée. */
export async function joinAsGuest(code: string, name: string, avatar: string): Promise<string> {
  await ensureSession()
  const res = await call<{ profile: ProfileJson; soiree: { id: string } }>('join_as_guest', {
    p_code: code,
    p_name: name,
    p_avatar: avatar,
  })
  useSession.getState().setProfile({ ...res.profile, is_guest: true } as ProfileJson)
  await refreshProfile(res.profile.id).catch(() => undefined)
  void usePlayersStore.getState().load(true)
  return res.soiree.id
}

/** URL d'invitation (ouvre directement l'écran « Je suis de passage »). */
export const inviteUrl = (token: string) => `${window.location.origin}/invite/${token}`
