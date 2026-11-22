import { supabase } from '@/lib/supabase'

/** Miroirs TS des RPC de supabase/features/idees.sql (hors src/types/db.ts). */
type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
const rpc: Rpc = (fn, args) => (supabase as unknown as { rpc: Rpc }).rpc(fn, args)

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(fn, args)
  if (error) throw error
  return data as T
}

export interface IdeaBoxState {
  total: number
  mine: number
  is_admin: boolean
  unread: number
}

export type IdeaStatus = 'new' | 'done'

export interface Idea {
  id: string
  body: string
  status: IdeaStatus
  created_at: string
  anonymous: boolean
  author_id: string | null
  author_slug: string | null
  author_nickname: string | null
}

export const ideaBoxState = () => call<IdeaBoxState>('idea_box_state')
export const submitIdea = (body: string, anonymous: boolean) =>
  call<IdeaBoxState>('submit_idea', { p_body: body, p_anonymous: anonymous })
export const adminListIdeas = () => call<Idea[]>('admin_list_ideas')
export const adminSetIdeaStatus = (id: string, status: IdeaStatus) =>
  call<null>('admin_set_idea_status', { p_id: id, p_status: status })
export const adminDeleteIdea = (id: string) => call<null>('admin_delete_idea', { p_id: id })
