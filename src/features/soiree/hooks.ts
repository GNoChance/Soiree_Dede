import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { GameAction, MatchRow, SoireeJson, SoireeRow } from '@/types/db'
import type { BaseGameState, GameActionPayload } from '@/games/types'
import { toastError } from './errors'

/* -------------------------------------------------------------------------- */
/* Utilitaires                                                                 */
/* -------------------------------------------------------------------------- */

let channelSeq = 0
const channelName = (base: string) => `${base}:${Date.now().toString(36)}:${++channelSeq}`

/**
 * Appelle `fn` quand l'app revient au premier plan / retrouve le réseau :
 * les mobiles coupent les websockets en arrière-plan, on resynchronise.
 */
export function useResync(fn: () => void) {
  const ref = useRef(fn)
  useEffect(() => {
    ref.current = fn
  })
  useEffect(() => {
    let last = 0
    const h = () => {
      if (document.visibilityState !== 'visible') return
      const now = Date.now()
      if (now - last < 800) return // visibilitychange + focus arrivent souvent ensemble
      last = now
      ref.current()
    }
    document.addEventListener('visibilitychange', h)
    window.addEventListener('focus', h)
    window.addEventListener('online', h)
    return () => {
      document.removeEventListener('visibilitychange', h)
      window.removeEventListener('focus', h)
      window.removeEventListener('online', h)
    }
  }, [])
}

/** S'abonne à un channel ; `onSubscribed` est rappelé à chaque (re)connexion pour combler les trous. */
function subscribe(channel: RealtimeChannel, onSubscribed: () => void) {
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') onSubscribed()
  })
  return () => {
    void supabase.removeChannel(channel)
  }
}

/* -------------------------------------------------------------------------- */
/* Soirées actives (multi-soirées : jusqu'à 5 par joueur)                      */
/* -------------------------------------------------------------------------- */

// Liste partagée de TOUTES mes soirées en cours (hub, salon, bandeau global).
export {
  MAX_OPEN_SOIREES,
  IDLE_WARNING_MS,
  leaveSoiree,
  refetchActiveSoirees,
  soireeEndCopy,
  useActiveSoirees,
  useViewingSoiree,
} from './activeSoirees'

/**
 * @deprecated Compat (une seule soirée) : la soirée non terminée la plus
 * récemment rejointe. Un joueur peut désormais être dans plusieurs soirées :
 * utiliser `useActiveSoirees(meId)`, ou la soirée de la page (`useParams().id`).
 */
export function useActiveSoiree(meId: string | undefined) {
  const [soiree, setSoiree] = useState<SoireeJson | null>(null)
  const [loading, setLoading] = useState(true)
  const reqId = useRef(0)

  const refetch = useCallback(async () => {
    if (!meId) return
    const id = ++reqId.current
    const { data, error } = await supabase.rpc('my_active_soiree')
    if (id !== reqId.current) return
    if (!error) setSoiree((data as SoireeJson | null) ?? null)
    setLoading(false)
  }, [meId])

  useEffect(() => {
    if (!meId) return
    const ch = supabase
      .channel(channelName(`me-soiree:${meId}`))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'soiree_players', filter: `profile_id=eq.${meId}` }, () => void refetch())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'soirees' }, () => void refetch())
    return subscribe(ch, () => void refetch())
  }, [meId, refetch])

  useResync(() => void refetch())
  return { soiree, loading, refetch, setSoiree }
}

/* -------------------------------------------------------------------------- */
/* Salon                                                                       */
/* -------------------------------------------------------------------------- */

export interface SoireeData {
  soiree: SoireeRow
  /** Joueurs présents, par ordre d'arrivée. */
  playerIds: string[]
}

/** Soirée + joueurs présents, en temps réel. `notFound` = pas (ou plus) membre. */
export function useSoiree(id: string | undefined) {
  const [data, setData] = useState<SoireeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const reqId = useRef(0)

  const refetch = useCallback(async () => {
    if (!id) return
    const rid = ++reqId.current
    const [s, p] = await Promise.all([
      supabase.from('soirees').select('*').eq('id', id).maybeSingle(),
      supabase.from('soiree_players').select('profile_id, joined_at').eq('soiree_id', id).order('joined_at'),
    ])
    if (rid !== reqId.current) return
    setLoading(false)
    if (s.error || p.error) return // erreur réseau : on garde l'existant
    if (!s.data) {
      setNotFound(true)
      setData(null)
      return
    }
    setNotFound(false)
    setData({ soiree: s.data, playerIds: (p.data ?? []).map((r) => r.profile_id) })
  }, [id])

  useEffect(() => {
    if (!id) return
    const ch = supabase
      .channel(channelName(`soiree:${id}`))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'soirees', filter: `id=eq.${id}` }, (payload) => {
        const row = payload.new as SoireeRow
        setData((d) => (d ? { ...d, soiree: { ...d.soiree, ...row } } : d))
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'soiree_players', filter: `soiree_id=eq.${id}` }, () => void refetch())
      // Les DELETE ne sont pas filtrables côté Realtime : on filtre ici (old = clé primaire).
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'soiree_players' }, (payload) => {
        const old = payload.old as { soiree_id?: string }
        if (!old.soiree_id || old.soiree_id === id) void refetch()
      })
    return subscribe(ch, () => void refetch())
  }, [id, refetch])

  useResync(() => void refetch())
  return { data, loading, notFound, refetch }
}

/* -------------------------------------------------------------------------- */
/* Partie en cours d'une soirée                                                */
/* -------------------------------------------------------------------------- */

export interface MatchHead {
  id: string
  game_id: string
  status: string
  created_at: string
  /** Joueurs de la partie (state.players) : qui joue, les autres de la soirée regardent. */
  player_ids: string[]
}

/** Ligne matches (state inclus) -> MatchHead. */
function toHead(row: { id: string; game_id: string; status: string; created_at: string; state?: unknown }): MatchHead {
  const pl = (row.state as { players?: unknown } | null | undefined)?.players
  return { id: row.id, game_id: row.game_id, status: row.status, created_at: row.created_at, player_ids: Array.isArray(pl) ? (pl as string[]) : [] }
}

/** Partie `playing` la plus récente de la soirée (null si aucune). */
export function useCurrentMatch(soireeId: string | undefined) {
  const [match, setMatch] = useState<MatchHead | null>(null)
  const [loaded, setLoaded] = useState(false)
  const reqId = useRef(0)

  const refetch = useCallback(async () => {
    if (!soireeId) return
    const rid = ++reqId.current
    const { data, error } = await supabase
      .from('matches')
      .select('id, game_id, status, created_at, state')
      .eq('soiree_id', soireeId)
      .eq('status', 'playing')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (rid !== reqId.current) return
    setLoaded(true)
    if (!error) setMatch(data ? toHead(data) : null)
  }, [soireeId])

  useEffect(() => {
    if (!soireeId) return
    const onRow = (row: { id: string; game_id: string; status: string; created_at: string; state?: unknown } | undefined) => {
      if (!row?.id) return
      reqId.current++ // invalide une requête en vol, l'évènement est plus frais
      setLoaded(true)
      setMatch((cur) => {
        if (row.status === 'playing') {
          if (!cur || cur.id === row.id || row.created_at >= cur.created_at) {
            return cur && cur.id === row.id && cur.status === row.status ? cur : toHead(row)
          }
          return cur
        }
        return cur?.id === row.id ? null : cur
      })
    }
    const ch = supabase
      .channel(channelName(`soiree-matches:${soireeId}`))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'matches', filter: `soiree_id=eq.${soireeId}` }, (p) => onRow(p.new as Parameters<typeof onRow>[0]))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches', filter: `soiree_id=eq.${soireeId}` }, (p) => onRow(p.new as Parameters<typeof onRow>[0]))
    return subscribe(ch, () => void refetch())
  }, [soireeId, refetch])

  useResync(() => void refetch())
  return { match, loaded, refetch }
}

/* -------------------------------------------------------------------------- */
/* Une partie : state public + mon secret                                      */
/* -------------------------------------------------------------------------- */

/** Rang d'un state : on n'accepte jamais un state plus ancien que celui affiché. */
function isNewer(cur: MatchRow | null, next: Pick<MatchRow, 'status' | 'state'>): boolean {
  if (!cur) return true
  const curFinished = cur.status === 'finished'
  const nextFinished = next.status === 'finished'
  if (curFinished && !nextFinished) return false
  if (nextFinished && !curFinished) return true
  const a = (cur.state as { seq?: number } | null | undefined)?.seq
  const b = (next.state as { seq?: number } | null | undefined)?.seq
  if (typeof a !== 'number' || typeof b !== 'number') return true
  return b >= a
}

export function useMatch(matchId: string | undefined) {
  const [match, setMatch] = useState<MatchRow | null>(null)
  const [secret, setSecret] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const accept = useCallback((next: Partial<MatchRow> & Pick<MatchRow, 'status' | 'state'>) => {
    setMatch((cur) => (isNewer(cur, next) ? ({ ...(cur ?? {}), ...next } as MatchRow) : cur))
  }, [])

  const refetch = useCallback(async () => {
    if (!matchId) return
    const [m, s] = await Promise.all([
      supabase.from('matches').select('*').eq('id', matchId).maybeSingle(),
      supabase.from('match_secrets').select('secret').eq('match_id', matchId).maybeSingle(),
    ])
    setLoading(false)
    if (m.error) return
    if (!m.data) {
      setNotFound(true)
      return
    }
    setNotFound(false)
    accept(m.data)
    if (!s.error) setSecret(s.data?.secret ?? null)
  }, [matchId, accept])

  useEffect(() => {
    if (!matchId) return
    const ch = supabase
      .channel(channelName(`match:${matchId}`))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` }, (p) => {
        const row = p.new as Partial<MatchRow> | null
        // State volumineux (ex. Tour des Potes) : Realtime l'omet du message -> on relit la ligne.
        if (!row || !row.state || typeof row.state !== 'object' || !row.status) {
          void refetch()
          return
        }
        accept(row as MatchRow)
      })
      // Secrets mis à jour en cours de partie (mains de cartes, mot du dessinateur…).
      // Realtime applique la RLS : on ne reçoit que SA propre ligne.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_secrets', filter: `match_id=eq.${matchId}` }, (p) => {
        const row = p.new as { secret?: unknown } | null
        if (row && 'secret' in row) setSecret(row.secret ?? null)
      })
    return subscribe(ch, () => void refetch())
  }, [matchId, refetch, accept])

  useResync(() => void refetch())

  /** Applique le state renvoyé par game_action (sans attendre le Realtime). */
  const applyState = useCallback(
    (state: BaseGameState) => {
      const finished = state.phase === 'finished' || state.phase === 'aborted'
      accept({ state: state as unknown as MatchRow['state'], status: finished ? 'finished' : 'playing' })
    },
    [accept],
  )

  return { match, secret, loading, notFound, refetch, applyState }
}

/* -------------------------------------------------------------------------- */
/* Actions de jeu                                                              */
/* -------------------------------------------------------------------------- */

/** Wrapper de game_action : état pending, toast d'erreur, state appliqué localement. */
export function useGameAction(matchId: string | undefined, onState?: (s: BaseGameState) => void) {
  const [pending, setPending] = useState(0)
  const onStateRef = useRef(onState)
  useEffect(() => {
    onStateRef.current = onState
  })

  const act = useCallback(
    async (action: GameActionPayload): Promise<BaseGameState | null> => {
      if (!matchId) return null
      setPending((n) => n + 1)
      try {
        const { data, error } = await supabase.rpc('game_action', {
          p_match_id: matchId,
          p_action: action as unknown as GameAction,
        })
        if (error) {
          // Un tick est une relance automatique : jamais de toast (trop tôt / trop tard = normal).
          if ((action as { type?: string }).type !== 'tick') toastError(error)
          return null
        }
        const state = data as unknown as BaseGameState
        onStateRef.current?.(state)
        return state
      } catch (e) {
        if ((action as { type?: string }).type !== 'tick') toastError(e)
        return null
      } finally {
        setPending((n) => n - 1)
      }
    },
    [matchId],
  )

  return { act, pending: pending > 0 }
}
