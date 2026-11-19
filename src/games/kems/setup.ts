/**
 * Logique front de Kems (sans React) : forme exacte des actions envoyées à game_action,
 * options de l'écran de lancement et construction de p_options de start_match.
 * Contrat : supabase/games/kems.sql.
 */
import { TEAM_COLORS, distributeTeams, type TeamColor, type TeamCount } from '@/features/teams/teams'
import { KEMS_SIGNS } from './signs'
import type { KemsTarget } from './types'

export const KEMS_TEAM_SIZE = 2

export const kemsActions = {
  ready: () => ({ type: 'ready' }),
  swap: (give: string, take: string) => ({ type: 'swap', give, take }),
  sweep: () => ({ type: 'sweep' }),
  kems: () => ({ type: 'kems' }),
  counter: (team?: TeamColor) => (team ? { type: 'counter', team } : { type: 'counter' }),
  tick: () => ({ type: 'tick' }),
  next: () => ({ type: 'next' }),
}

export interface KemsOptions {
  teamCount: TeamCount
  teams?: Partial<Record<TeamColor, string[]>>
  target: KemsTarget
}

export const KEMS_DEFAULT_OPTIONS: KemsOptions = { teamCount: 2, target: 5 }

export function readKemsOptions(o: Record<string, unknown>): KemsOptions {
  const teamCount = ([2, 3, 4] as const).find((n) => n === o.teamCount) ?? KEMS_DEFAULT_OPTIONS.teamCount
  const target = ([3, 5, 7] as const).find((n) => n === o.target) ?? KEMS_DEFAULT_OPTIONS.target
  const raw = o.teams as Partial<Record<TeamColor, unknown>> | undefined
  const teams =
    raw && typeof raw === 'object'
      ? (Object.fromEntries(
          TEAM_COLORS.filter((c) => Array.isArray(raw[c])).map((c) => [c, (raw[c] as unknown[]).filter((x): x is string => typeof x === 'string')]),
        ) as Partial<Record<TeamColor, string[]>>)
      : undefined
  return { teamCount, target, teams }
}

/** Nombre d'équipes réalisable avec ces joueurs (2 à 4, deux joueurs chacune). */
export const feasibleTeamCount = (nPlayers: number): TeamCount => Math.min(4, Math.max(2, Math.floor(nPlayers / KEMS_TEAM_SIZE))) as TeamCount

/**
 * Équipes effectives au lancement : la composition stockée, limitée aux joueurs présents ;
 * si une équipe n'a pas exactement 2 joueurs (ou rien n'est composé), répartition au hasard par paires.
 * Les joueurs non placés restent sur le banc.
 */
export function resolveTeams(o: KemsOptions, playerIds: string[]): Partial<Record<TeamColor, string[]>> {
  const colors = TEAM_COLORS.slice(0, o.teamCount)
  const present = new Set(playerIds)
  const kept = Object.fromEntries(colors.map((c) => [c, (o.teams?.[c] ?? []).filter((id) => present.has(id))])) as Record<TeamColor, string[]>
  if (colors.every((c) => kept[c].length === KEMS_TEAM_SIZE)) return kept
  return distributeTeams(playerIds, Math.min(o.teamCount, feasibleTeamCount(playerIds.length)) as TeamCount, KEMS_TEAM_SIZE)
}

export async function prepareKemsStart(options: Record<string, unknown>, playerIds: string[]): Promise<Record<string, unknown>> {
  const o = readKemsOptions(options)
  return { teams: resolveTeams(o, playerIds), target: o.target, signs: KEMS_SIGNS }
}
