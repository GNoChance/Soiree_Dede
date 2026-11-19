import { lazy, type ComponentType } from 'react'
import type { BaseGameState, GameDefinition, GameOptionsProps, GamePlayProps, GameSummaryProps } from '@/games/types'
import { DuelOptions } from './DuelOptions'
import { DUEL_DEFAULT_OPTIONS, duelHeadline, prepareDuelOptions } from './logic'
import type { DuelBoardOptionsProps, DuelMode, DuelState } from './types'

/**
 * Fabrique la `GameDefinition` d'un jeu en duel. Le jeu fournit :
 *  - son identité (id, nom, emoji, couleur, ordre, règles) ;
 *  - `Play` : composant LAZY qui rend <DuelPlay {...props} Board={Plateau} /> ;
 *  - optionnellement `Summary` (lazy ; défaut = DuelSummary), `BoardOptions`
 *    (options propres, stockées sous `options.board`), `defaultBoardOptions`
 *    et `defaultMode` (format de session proposé, défaut : Roi de la table).
 * Le reste (Options communes, prepareStart, roundLabel, 2-9 joueurs) est fourni.
 *
 * Exemple (src/games/<id>/index.ts) :
 *   const Play = lazy(() => import('./Play')) as ComponentType<GamePlayProps>
 *   export const definition = makeDuelGame({ id: '<id>', order: 170, name: '…', tagline: '…', emoji: '…', color: '#…', Play })
 */
export interface DuelGameConfig {
  id: string
  order?: number
  name: string
  tagline: string
  emoji: string
  color: string
  rules?: string
  minPlayers?: number
  maxPlayers?: number
  Play: ComponentType<GamePlayProps>
  Summary?: ComponentType<GameSummaryProps>
  BoardOptions?: ComponentType<DuelBoardOptionsProps>
  defaultBoardOptions?: Record<string, unknown>
  /** Format de session présélectionné (défaut 'king' ; ex. échecs : 'duel', une session « roi » serait trop longue). */
  defaultMode?: DuelMode
  /** Transforme les options propres avant envoi (tirage de contenu…). */
  prepareBoard?: (board: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>
}

const DefaultSummary = lazy(() => import('./DuelSummary')) as ComponentType<GameSummaryProps>

export function makeDuelGame(cfg: DuelGameConfig): GameDefinition {
  const BoardOptions = cfg.BoardOptions
  const Options = BoardOptions
    ? function DuelGameOptions(props: GameOptionsProps) {
        return <DuelOptions {...props} BoardOptions={BoardOptions} />
      }
    : DuelOptions
  return {
    id: cfg.id,
    order: cfg.order,
    name: cfg.name,
    tagline: cfg.tagline,
    emoji: cfg.emoji,
    color: cfg.color,
    minPlayers: cfg.minPlayers ?? 2,
    maxPlayers: cfg.maxPlayers ?? 9,
    rules: cfg.rules,
    Play: cfg.Play,
    Options,
    Summary: cfg.Summary ?? DefaultSummary,
    defaultOptions: { ...DUEL_DEFAULT_OPTIONS, mode: cfg.defaultMode ?? DUEL_DEFAULT_OPTIONS.mode, board: { ...(cfg.defaultBoardOptions ?? {}) } },
    prepareStart: async (options, ctx) => {
      const out = prepareDuelOptions(options, ctx.playerIds)
      if (cfg.prepareBoard) out.board = await cfg.prepareBoard((out.board as Record<string, unknown>) ?? {})
      return out
    },
    roundLabel: (s: BaseGameState) => duelHeadline(s as unknown as DuelState),
  }
}
