import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { toastError } from '@/features/soiree/errors'
import { useResync } from '@/features/soiree/hooks'
import type { SoireeMessageRow } from '@/types/db'

export type ChatMessage = Pick<SoireeMessageRow, 'id' | 'profile_id' | 'kind' | 'body' | 'tenue' | 'created_at'>

const FIELDS = 'id, profile_id, kind, body, tenue, created_at'
let channelSeq = 0

/** Fusionne sans doublon, dans l'ordre des ids, en gardant les 200 derniers. */
function merge(prev: ChatMessage[], more: ChatMessage[]) {
  const byId = new Map(prev.map((m) => [m.id, m]))
  for (const m of more) byId.set(m.id, m)
  return [...byId.values()].sort((a, b) => a.id - b.id).slice(-200)
}

/**
 * Chat d'une soirée (supabase/features/chat.sql) : derniers messages + temps réel.
 * `onIncoming` est appelé pour chaque message reçu EN DIRECT (pas pour l'historique).
 */
export function useSoireeChat(soireeId: string, meId: string, onIncoming?: (m: ChatMessage) => void) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [sending, setSending] = useState(false)
  const incoming = useRef(onIncoming)
  useEffect(() => {
    incoming.current = onIncoming
  })

  const refetch = useCallback(async () => {
    const { data, error } = await supabase
      .from('soiree_messages')
      .select(FIELDS)
      .eq('soiree_id', soireeId)
      .order('id', { ascending: false })
      .limit(100)
    if (error || !data) return // réseau ou serveur pas encore à jour : on garde l'existant
    setMessages((prev) => merge(prev, data as ChatMessage[]))
  }, [soireeId])

  useEffect(() => {
    const ch = supabase
      .channel(`chat:${soireeId}:${Date.now().toString(36)}:${++channelSeq}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'soiree_messages', filter: `soiree_id=eq.${soireeId}` }, (p) => {
        const m = p.new as ChatMessage
        if (!m || typeof m.id !== 'number') return
        setMessages((prev) => merge(prev, [m]))
        if (m.profile_id !== meId) incoming.current?.(m)
      })
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') void refetch()
    })
    return () => {
      void supabase.removeChannel(ch)
    }
  }, [soireeId, meId, refetch])

  useResync(() => void refetch())

  const send = useCallback(
    async (kind: ChatMessage['kind'], body: string) => {
      setSending(true)
      try {
        const { data, error } = await supabase.rpc('send_soiree_message', { p_soiree_id: soireeId, p_kind: kind, p_body: body })
        if (error) {
          toastError(error)
          return false
        }
        // affiché tout de suite, sans attendre l'écho temps réel
        if (typeof data === 'number') {
          setMessages((prev) => merge(prev, [{ id: data, profile_id: meId, kind, body, tenue: '', created_at: new Date().toISOString() }]))
        }
        return true
      } catch (e) {
        toastError(e)
        return false
      } finally {
        setSending(false)
      }
    },
    [soireeId, meId],
  )

  return { messages, send, sending }
}
