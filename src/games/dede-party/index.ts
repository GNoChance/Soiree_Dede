import { lazy, type ComponentType } from 'react'
import type { BaseGameState, GameDefinition, GamePlayProps, GameSummaryProps } from '../types'
import { DedePartyOptions } from './Options'
import { DP_DEFAULT_OPTIONS, prepareDedePartyStart } from './setup'
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
  minPlayers: 2,
  maxPlayers: 8,
  rules:
    'Tout le monde tape son dé en même temps, les pions avancent tout seuls sur le Grand Plateau de Dédé. Passe sur l’étoile avec 20 pièces : elle est à toi ! À chaque tour, un mini-jeu rapporte des pièces (1er 10, 2e 6, 3e 4). Le plus d’étoiles gagne !',
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
