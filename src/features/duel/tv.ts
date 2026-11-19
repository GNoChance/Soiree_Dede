/** Mode télé : le socle est générique (`@/features/tv/tv`) ; alias conservés pour les duels. */
import { TvContext, useTv } from '@/features/tv/tv'

export { TV_VIEWER_ID, readOnlyAct } from '@/features/tv/tv'
export const DuelTvContext = TvContext
export const useDuelTv = useTv

/** Le state est-il celui d'un jeu en duel (socle duel.sql) ? */
export function isDuelState(state: unknown): boolean {
  const s = state as { session?: { mode?: unknown } } | null
  return !!s && typeof s.session === 'object' && s.session !== null && typeof s.session.mode === 'string'
}
