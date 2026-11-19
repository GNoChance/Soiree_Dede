/**
 * Logique front de Nom de Code (sans React) : forme exacte des actions envoyées à game_action,
 * options de l'écran de lancement et construction de p_options de start_match.
 * Contrat : supabase/games/nom-de-code.sql.
 */
import { TEAM_COLORS, distributeTeams, type TeamColor, type TeamCount } from '@/features/teams/teams'
import type { NdcRounds, NdcTimer } from './types'
import { pickWords } from './words'

export const ndcActions = {
  clue: (word: string, n: number) => ({ type: 'clue', word, n }),
  vote: (index: number | null) => ({ type: 'vote', index }),
  stop: () => ({ type: 'stop' }),
  tick: () => ({ type: 'tick' }),
  skip: () => ({ type: 'skip' }),
  nextRound: () => ({ type: 'next_round' }),
}

/** Durées en secondes (indice / devinettes) ; null = Détendu (sans chrono). */
export const NDC_TIMERS: Record<NdcTimer, { clue: number; guess: number } | null> = {
  relaxed: null,
  normal: { clue: 120, guess: 180 },
  fast: { clue: 60, guess: 120 },
}

export interface NdcOptions {
  teamCount: TeamCount
  teams?: Partial<Record<TeamColor, string[]>>
  rounds: NdcRounds
  timer: NdcTimer
}

export const NDC_DEFAULT_OPTIONS: NdcOptions = { teamCount: 2, rounds: 'one', timer: 'normal' }

export function readNdcOptions(o: Record<string, unknown>): NdcOptions {
  const teamCount = ([2, 3, 4] as const).find((n) => n === o.teamCount) ?? NDC_DEFAULT_OPTIONS.teamCount
  const rounds: NdcRounds = o.rounds === 'each' ? 'each' : 'one'
  const timer: NdcTimer = o.timer === 'relaxed' || o.timer === 'fast' ? o.timer : 'normal'
  const raw = o.teams as Partial<Record<TeamColor, unknown>> | undefined
  const teams =
    raw && typeof raw === 'object'
      ? (Object.fromEntries(
          TEAM_COLORS.filter((c) => Array.isArray(raw[c])).map((c) => [c, (raw[c] as unknown[]).filter((x): x is string => typeof x === 'string')]),
        ) as Partial<Record<TeamColor, string[]>>)
      : undefined
  return { teamCount, rounds, timer, teams }
}

/**
 * Équipes effectives au lancement : la composition stockée, limitée aux joueurs présents ;
 * si une équipe a moins de 2 joueurs (ou rien n'est composé), répartition équilibrée au hasard.
 * Les joueurs non placés restent sur le banc.
 */
export function resolveTeams(o: NdcOptions, playerIds: string[]): Partial<Record<TeamColor, string[]>> {
  const colors = TEAM_COLORS.slice(0, o.teamCount)
  const present = new Set(playerIds)
  const kept = Object.fromEntries(colors.map((c) => [c, (o.teams?.[c] ?? []).filter((id) => present.has(id))])) as Record<TeamColor, string[]>
  if (colors.every((c) => kept[c].length >= 2)) return kept
  return distributeTeams(playerIds, o.teamCount)
}

export async function prepareNdcStart(options: Record<string, unknown>, playerIds: string[]): Promise<Record<string, unknown>> {
  const o = readNdcOptions(options)
  const teams = resolveTeams(o, playerIds)
  const totalRounds = o.rounds === 'each' ? Math.max(...Object.values(teams).map((t) => t?.length ?? 0)) : 1
  return { teams, rounds: o.rounds, timer: o.timer, words: pickWords(25 * totalRounds) }
}
