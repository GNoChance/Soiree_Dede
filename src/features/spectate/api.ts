import { useCallback, useEffect, useState } from 'react'
import { useResync } from '@/features/soiree/hooks'
import { loose } from '@/features/soiree/hostTools'

/** Un ami en pleine partie (RPC friends_playing, supabase/features/spectateur.sql). */
export interface FriendPlaying {
  profile_id: string
  match_id: string
  soiree_id: string
  game_id: string
}

let seq = 0

/**
 * Mes amis qui jouent en ce moment : { <profile_id de l'ami>: sa partie }. Relu au retour au premier plan
 * et quand une partie démarre ou se termine (Realtime : un ami reçoit les parties qu'il peut lire).
 */
export function useFriendsPlaying(): { playing: Record<string, FriendPlaying>; ready: boolean } {
  const [playing, setPlaying] = useState<Record<string, FriendPlaying>>({})
  const [ready, setReady] = useState(false)

  const refetch = useCallback(async () => {
    const { data, error } = await loose.rpc('friends_playing', {})
    if (error || !Array.isArray(data)) return
    setPlaying(Object.fromEntries((data as FriendPlaying[]).map((f) => [f.profile_id, f])))
    setReady(true)
  }, [])

  useEffect(() => {
    void refetch()
  }, [refetch])
  useResync(() => void refetch())

  useEffect(() => {
    const ch = loose
      .channel(`friends-playing:${Date.now().toString(36)}:${++seq}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'matches' }, () => void refetch())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches' }, () => void refetch())
    ch.subscribe()
    return () => {
      void loose.removeChannel(ch)
    }
  }, [refetch])

  return { playing, ready }
}
