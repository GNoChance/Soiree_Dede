import { useSession } from '@/store/session'
import type { StartContext } from '../types'
import { LG_DEFAULT_OPTIONS, compositionError, suggestComposition, type LgCompositionInput, type LgOptions } from './types'

export function readOptions(o: Record<string, unknown>): LgOptions {
  return { ...LG_DEFAULT_OPTIONS, ...(o as Partial<LgOptions>) }
}

/** Nombre de joueurs réels (l'hôte meneur ne joue pas). Écran d'options : on suppose l'hôte sélectionné. */
export function effectiveCount(playerCount: number, hostPlays: boolean) {
  return hostPlays ? playerCount : playerCount - 1
}

/** Composition effective : celle de l'hôte si valide pour n joueurs, sinon la suggestion. */
export function effectiveComposition(opts: LgOptions, n: number): { comp: LgCompositionInput; auto: boolean } {
  if (opts.composition && !compositionError(opts.composition, n)) return { comp: opts.composition, auto: false }
  return { comp: suggestComposition(n), auto: true }
}

/**
 * p_options de start_match : {composition, debate_seconds, host_plays}.
 * Le nombre exact de joueurs est recalculé ici (l'hôte peut s'être exclu de la
 * sélection) ; une composition devenue invalide retombe sur la suggestion.
 */
export async function prepareLoupGarouStart(options: Record<string, unknown>, ctx: StartContext): Promise<Record<string, unknown>> {
  const opts = readOptions(options)
  const hostId = useSession.getState().profile?.id
  const hostIn = Boolean(hostId && ctx.playerIds.includes(hostId))
  const n = ctx.playerIds.length - (hostIn && !opts.host_plays ? 1 : 0)
  const { comp } = effectiveComposition(opts, n)
  return { composition: comp, debate_seconds: opts.debate_seconds, host_plays: opts.host_plays }
}
