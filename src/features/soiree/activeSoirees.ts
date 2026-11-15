import { useEffect } from 'react'
import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import { toast } from '@/store/toast'
import type { ActiveSoireeJson, SoireeEndReason, SoireeJson, SoireeRow } from '@/types/db'
import { usePlayersStore } from './players'
import { serverNow } from './useServerClock'

/**
 * « Mes soirées en cours » (multi-soirées) : un seul store + UN seul channel
 * Realtime partagés par le hub, le salon (sélecteur, compte à rebours) et le
 * bandeau global. La synchro démarre au premier `useActiveSoirees(meId)` monté
 * (le bandeau global, dans Root) et s'arrête quand plus personne ne l'utilise.
 *
 * Sources : rpc('my_active_soirees') (cf. supabase/README.md) rafraîchie sur
 *  - UPDATE soirees (RLS : mes soirées ; start_match la met aussi à jour) ;
 *  - INSERT / DELETE soiree_players (invitation, arrivée, départ) ;
 *  - INSERT matches (une partie démarre) et UPDATE matches FILTRÉ côté serveur sur
 *    `status=eq.finished` (fin ou annulation) : jamais les UPDATE de chaque coup ;
 *  - un filet toutes les 60 s + retour au premier plan (websocket coupé en
 *    arrière-plan). Le salon force aussi un rafraîchissement quand SA partie change.
 */

/** Miroirs des constantes SQL (_soiree_max_open, _soiree_idle_timeout). */
export const MAX_OPEN_SOIREES = 5
export const IDLE_TIMEOUT_MS = 20 * 60_000
/** Le compte à rebours de fin auto s'affiche pendant les 5 dernières minutes. */
export const IDLE_WARNING_MS = 5 * 60_000
/** Une partie est « en train de démarrer » (bandeau) pendant 90 s. */
const FRESH_MATCH_MS = 90_000
const POLL_MS = 60_000

export type ViewingKind = 'salon' | 'match'

/** Bandeau « une partie commence » (soirée où je ne suis pas en ce moment). */
export interface MatchBanner {
  matchId: string
  soireeId: string
  gameId: string
  hostId: string
}

interface ActiveSoireesState {
  meId: string | null
  soirees: ActiveSoireeJson[]
  loaded: boolean
  /** Soirée affichée à l'écran (salon ou partie) : pas de bandeau pour elle. */
  viewing: { soireeId: string; kind: ViewingKind } | null
  banners: MatchBanner[]
}

export const useActiveSoireesStore = create<ActiveSoireesState>(() => ({
  meId: null,
  soirees: [],
  loaded: false,
  viewing: null,
  banners: [],
}))

const EMPTY: ActiveSoireeJson[] = []
/** Parties déjà vues (bandeau proposé au plus une fois par partie). */
let seenMatches = new Set<string>()

/**
 * Soirées disparues de la liste SANS départ de ma part (dropActiveSoiree), gardées
 * quelques minutes : c'est souvent MON rechargement qui clôt la soirée (fin auto à
 * l'échéance du compte à rebours) et sa réponse arrive avant l'évènement Realtime
 * de fin. Sans cette table, le message de fin serait perdu.
 */
const GONE_TTL_MS = 5 * 60_000
let recentlyGone = new Map<string, { soiree: ActiveSoireeJson; at: number }>()

function rememberGone(prev: ActiveSoireeJson[], next: ActiveSoireeJson[]) {
  const now = Date.now()
  for (const [id, g] of recentlyGone) if (now - g.at > GONE_TTL_MS) recentlyGone.delete(id)
  for (const s of prev) if (!next.some((n) => n.id === s.id)) recentlyGone.set(s.id, { soiree: s, at: now })
}

/**
 * Remet le store à zéro (changement de profil). `viewing` est conservé : il
 * appartient à la page affichée (useViewingSoiree le retire au démontage), et la
 * page peut le déclarer avant que la synchro démarre (effets enfants d'abord).
 */
function resetStore(meId: string | null) {
  seenMatches = new Set()
  recentlyGone = new Map()
  useActiveSoireesStore.setState({ meId, soirees: [], loaded: false, banners: [] })
}

/**
 * Placement du bandeau global : flottant (fixe, au-dessus de la page) partout, sauf
 * sur une page de partie, où il est posé en haut du document (il défile avec la
 * page, sous les surcouches des jeux) pour ne jamais cacher un en-tête collant ou
 * une révélation plein écran d'un jeu.
 */
export function liveBannerMode(viewing: ActiveSoireesState['viewing']): 'floating' | 'inline' {
  return viewing?.kind === 'match' ? 'inline' : 'floating'
}

/* -------------------------------------------------------------------------- */
/* Chargement                                                                  */
/* -------------------------------------------------------------------------- */

type RpcError = { code?: string; message?: string } | null

/** RPC absente : serveur pas encore à jour (install.sql non recollé). */
function isMissingRpc(e: RpcError): boolean {
  return Boolean(e && (e.code === 'PGRST202' || e.code === '42883' || /could not find the function/i.test(e.message ?? '')))
}

function normalize(s: ActiveSoireeJson): ActiveSoireeJson {
  return {
    ...s,
    player_ids: s.player_ids ?? [],
    end_reason: s.end_reason ?? null,
    last_activity_at: s.last_activity_at ?? s.created_at,
    current_match: s.current_match ?? null,
    idle_deadline: s.idle_deadline ?? null,
    host: s.host ?? null,
    joined_at: s.joined_at ?? s.created_at,
  }
}

async function fetchActive(): Promise<ActiveSoireeJson[] | null> {
  const { data, error } = await supabase.rpc('my_active_soirees')
  if (!error) return ((data as ActiveSoireeJson[] | null) ?? []).map(normalize)
  if (!isMissingRpc(error)) return null
  // Ancien serveur : une seule soirée possible.
  const old = await supabase.rpc('my_active_soiree')
  if (old.error) return null
  const s = old.data as SoireeJson | null
  return s ? [normalize({ ...s, host: null, joined_at: s.created_at } as ActiveSoireeJson)] : []
}

function applyList(list: ActiveSoireeJson[]) {
  const st = useActiveSoireesStore.getState()
  const meId = st.meId
  const now = serverNow()
  // Un bandeau disparaît quand sa partie n'est plus la partie en cours de la soirée.
  const banners = st.banners.filter((b) => list.some((s) => s.id === b.soireeId && s.current_match?.id === b.matchId))
  for (const s of list) {
    const m = s.current_match
    if (!m || seenMatches.has(m.id)) continue
    seenMatches.add(m.id)
    if (!meId || !m.player_ids.includes(meId) || st.viewing?.soireeId === s.id) continue
    if (now - new Date(m.created_at).getTime() > FRESH_MATCH_MS) continue
    banners.push({ matchId: m.id, soireeId: s.id, gameId: m.game_id, hostId: s.host_id })
  }
  rememberGone(st.soirees, list)
  useActiveSoireesStore.setState({ soirees: list, loaded: true, banners })
}

let inflight: Promise<void> | null = null
let again = false

/**
 * Recharge mes soirées. Côté serveur, my_active_soirees() exécute aussi le
 * nettoyage (fin auto) : l'appeler à l'échéance d'un compte à rebours clôt la
 * soirée même sans pg_cron. Les appels simultanés sont regroupés.
 */
export function refetchActiveSoirees(): Promise<void> {
  if (inflight) {
    again = true
    return inflight
  }
  inflight = (async () => {
    try {
      do {
        again = false
        const meId = useActiveSoireesStore.getState().meId
        if (!meId) return
        const list = await fetchActive()
        if (useActiveSoireesStore.getState().meId !== meId) return
        if (list) applyList(list)
        else useActiveSoireesStore.setState({ loaded: true }) // erreur réseau : on garde la liste
      } while (again)
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/** Retire une soirée de la liste sans attendre le serveur (départ, fin). */
export function dropActiveSoiree(soireeId: string) {
  recentlyGone.delete(soireeId)
  useActiveSoireesStore.setState((st) => ({
    soirees: st.soirees.filter((s) => s.id !== soireeId),
    banners: st.banners.filter((b) => b.soireeId !== soireeId),
  }))
}

/* -------------------------------------------------------------------------- */
/* Fin d'une soirée                                                            */
/* -------------------------------------------------------------------------- */

/** Textes de fin selon la raison. `host` = « toi » si je suis l'hôte. */
export function soireeEndCopy(reason: SoireeEndReason | null | undefined, host: string): { title: string; text: string } {
  switch (reason) {
    case 'idle':
      return { title: 'Soirée terminée faute de jeu', text: 'Personne n’a lancé de jeu pendant 20 minutes. À la prochaine !' }
    case 'abandoned':
      return { title: 'Soirée terminée', text: 'La partie en cours était abandonnée depuis plus de 3 heures.' }
    case 'host':
      return { title: 'Soirée terminée', text: `${host === 'toi' ? 'Tu as' : `${host} a`} terminé la soirée. Merci d’être venu·e ! 🎉` }
    default:
      return { title: 'Soirée terminée', text: 'Merci d’être venu·e ! 🎉' }
  }
}

function hostLabel(hostId: string, meId: string | null, fallback?: string | null): string {
  if (hostId === meId) return 'toi'
  return usePlayersStore.getState().byId[hostId]?.nickname ?? fallback ?? 'l’hôte'
}

/** Une de mes soirées vient de se terminer (Realtime). Le salon affiché gère son propre écran. */
function onSoireeEnded(row: SoireeRow) {
  const st = useActiveSoireesStore.getState()
  // Encore listée (cas normal), ou déjà retirée par un rechargement qui l'a close.
  const gone = recentlyGone.get(row.id)
  const known = st.soirees.find((s) => s.id === row.id) ?? (gone && Date.now() - gone.at <= GONE_TTL_MS ? gone.soiree : undefined)
  if (!known) return
  dropActiveSoiree(row.id) // retire aussi de recentlyGone : un seul message par fin
  if (st.viewing?.kind === 'salon' && st.viewing.soireeId === row.id) return
  if (row.end_reason === 'empty') return // dernier départ : c'était moi
  if (row.end_reason === 'host' && row.host_id === st.meId) return // terminée par moi
  const host = hostLabel(row.host_id, st.meId, known.host?.nickname)
  const where = host === 'toi' ? 'chez toi' : `chez ${host}`
  const msg =
    row.end_reason === 'idle'
      ? `La soirée ${where} est terminée faute de jeu 😴`
      : row.end_reason === 'abandoned'
        ? `La soirée ${where} est terminée : la partie était abandonnée.`
        : row.end_reason === 'host'
          ? `${host} a terminé la soirée. Merci d’être venu·e ! 🎉`
          : `La soirée ${where} est terminée.`
  toast(msg, { duration: 5000 })
}

/* -------------------------------------------------------------------------- */
/* Synchro (un channel, partagé, compté)                                       */
/* -------------------------------------------------------------------------- */

function startSync(meId: string): () => void {
  useActiveSoireesStore.setState({ meId })
  let timer: number | undefined
  const schedule = (delay = 250) => {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => void refetchActiveSoirees(), delay)
  }
  const ch = supabase
    .channel(`me-soirees:${meId}:${Date.now().toString(36)}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'soirees' }, (p) => {
      const row = p.new as SoireeRow
      if (row?.status === 'ended') onSoireeEnded(row)
      schedule()
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'soiree_players' }, () => schedule())
    // Les DELETE ne sont pas filtrés par la RLS côté Realtime : on trie ici (old = clé primaire).
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'soiree_players' }, (p) => {
      const old = p.old as { soiree_id?: string; profile_id?: string }
      const mineNow = useActiveSoireesStore.getState().soirees
      if (!old.soiree_id || old.profile_id === meId || mineNow.some((s) => s.id === old.soiree_id)) schedule()
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'matches' }, () => schedule())
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches', filter: 'status=eq.finished' }, (p) => {
      const row = p.new as { id?: string; soiree_id?: string }
      const mineNow = useActiveSoireesStore.getState().soirees
      if (mineNow.some((s) => s.id === row.soiree_id && (!s.current_match || s.current_match.id === row.id))) schedule()
    })
  ch.subscribe((status) => {
    if (status === 'SUBSCRIBED') schedule(0)
  })
  const poll = window.setInterval(() => {
    if (document.visibilityState === 'visible') void refetchActiveSoirees()
  }, POLL_MS)
  let last = 0
  const onWake = () => {
    if (document.visibilityState !== 'visible') return
    const now = Date.now()
    if (now - last < 800) return
    last = now
    schedule(0)
  }
  document.addEventListener('visibilitychange', onWake)
  window.addEventListener('focus', onWake)
  window.addEventListener('online', onWake)
  return () => {
    window.clearTimeout(timer)
    window.clearInterval(poll)
    document.removeEventListener('visibilitychange', onWake)
    window.removeEventListener('focus', onWake)
    window.removeEventListener('online', onWake)
    void supabase.removeChannel(ch)
  }
}

let sync: { meId: string; users: number; stop: () => void; stopTimer?: number } | null = null

/**
 * Démarre (ou rejoint) la synchro de mes soirées ; renvoie la fonction de
 * libération. Utilisée par `useActiveSoirees` (et utilisable hors React).
 */
export function syncActiveSoirees(meId: string): () => void {
  if (sync && sync.meId !== meId) {
    window.clearTimeout(sync.stopTimer)
    sync.stop()
    sync = null
  }
  // Changement de profil, y compris après l'arrêt différé de l'ancienne synchro
  // (le store garde l'ancien meId) : rien de l'ancien profil ne doit rester.
  if (useActiveSoireesStore.getState().meId !== meId) resetStore(meId)
  if (!sync) sync = { meId, users: 0, stop: startSync(meId) }
  window.clearTimeout(sync.stopTimer)
  sync.users++
  const mine = sync
  return () => {
    if (sync !== mine) return
    mine.users--
    // Arrêt différé : un remontage immédiat (StrictMode, changement de page) garde le channel.
    if (mine.users <= 0) {
      mine.stopTimer = window.setTimeout(() => {
        if (sync === mine && mine.users <= 0) {
          mine.stop()
          sync = null
        }
      }, 2000)
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Hooks                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Toutes mes soirées non terminées (5 au plus), la plus récente d'abord, tenues à
 * jour en temps réel. `loading` = premier chargement pas encore terminé.
 */
export function useActiveSoirees(meId: string | undefined) {
  const soirees = useActiveSoireesStore((s) => (meId && s.meId === meId ? s.soirees : EMPTY))
  const loaded = useActiveSoireesStore((s) => Boolean(meId) && s.meId === meId && s.loaded)
  useEffect(() => (meId ? syncActiveSoirees(meId) : undefined), [meId])
  return { soirees, loading: !loaded, refetch: refetchActiveSoirees }
}

/** Déclare la soirée affichée (salon ou partie) : ses bandeaux sont retirés. */
export function useViewingSoiree(soireeId: string | undefined, kind: ViewingKind) {
  useEffect(() => {
    if (!soireeId) return
    const v = { soireeId, kind }
    useActiveSoireesStore.setState((st) => ({ viewing: v, banners: st.banners.filter((b) => b.soireeId !== soireeId) }))
    return () => {
      if (useActiveSoireesStore.getState().viewing === v) useActiveSoireesStore.setState({ viewing: null })
    }
  }, [soireeId, kind])
}

export function dismissBanner(matchId: string) {
  useActiveSoireesStore.setState((st) => ({ banners: st.banners.filter((b) => b.matchId !== matchId) }))
}

/**
 * Quitte une soirée précise (leave_soiree(p_soiree_id)). Repli sur l'ancienne
 * signature sans paramètre si le serveur n'est pas encore à jour.
 */
export async function leaveSoiree(soireeId: string): Promise<{ error: unknown }> {
  let { error } = await supabase.rpc('leave_soiree', { p_soiree_id: soireeId })
  if (error && isMissingRpc(error)) ({ error } = await supabase.rpc('leave_soiree'))
  if (!error) {
    dropActiveSoiree(soireeId)
    void refetchActiveSoirees()
  }
  return { error }
}
