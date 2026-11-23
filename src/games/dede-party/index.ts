import { lazy, type ComponentType } from 'react'
import type { BaseGameState, GameDefinition, GamePlayProps, GameSummaryProps } from '../types'
import { DedePartyOptions } from './Options'
import { DP_DEFAULT_OPTIONS, prepareDedePartyStart } from './setup'
import { DP_RULES_TEXT } from './rules-text'
import type { DedePartyState } from './types'

const Play = lazy(() => import('./Play')) as ComponentType<GamePlayProps>
const Summary = lazy(() => import('./Summary')) as ComponentType<GameSummaryProps>

export const definition: GameDefinition = {
  id: 'dede-party',
  order: 250,
  name: 'Dédé Party',
  tagline: 'Le jeu télé de Dédé : un plateau, des dés, des étoiles et un mini-jeu à chaque tour !',
  emoji: '🎤',
  color: '#FFB703',
  // seul : au moins 1 bot (option « Bots »)
  minPlayers: 1,
  maxPlayers: 8,
  rules: DP_RULES_TEXT,
  Play,
  tv: true,
  Options: DedePartyOptions,
  Summary,
  defaultOptions: { ...DP_DEFAULT_OPTIONS },
  prepareStart: (options) => prepareDedePartyStart(options),
  roundLabel: (s: BaseGameState) => {
    const g = s as unknown as DedePartyState
    if (!g.rounds || g.phase === 'finished') return null
    if (g.phase === 'intro') return 'Générique'
    if (g.phase === 'awards') return 'Cérémonie'
    return g.round === g.rounds ? `La Finale ! (${g.round}/${g.rounds})` : `Tour ${g.round}/${g.rounds}`
  },
}
