import { lazy, type ComponentType } from 'react'
import type { BaseGameState, GameDefinition, GamePlayProps, GameSummaryProps } from '../types'
import { PetitBacOptions } from './Options'
import { PB_DEFAULT_OPTIONS, preparePetitBacStart } from './setup'

const Play = lazy(() => import('./Play')) as ComponentType<GamePlayProps>
const Summary = lazy(() => import('./Summary')) as ComponentType<GameSummaryProps>

export const definition: GameDefinition = {
  id: 'petit-bac',
  order: 50,
  name: 'Petit bac',
  tagline: 'Une lettre, des catégories, un chrono qui file… Pays en B ? Vite, vite !',
  emoji: '🔤',
  color: '#B5E61D',
  minPlayers: 2,
  maxPlayers: 9,
  rules:
    'Une lettre est tirée : remplis un mot par catégorie sur ton téléphone avant la fin du chrono. Le premier qui a tout rempli peut crier STOP ! On valide ensemble (👎 pour contester) : réponse unique = 2 pts, réponse partagée = 1 pt.',
  Play,
  Options: PetitBacOptions,
  Summary,
  defaultOptions: PB_DEFAULT_OPTIONS,
  prepareStart: (options) => preparePetitBacStart(options),
  roundLabel: (s: BaseGameState) => (s.round ? `Manche ${s.round}/${s.total_rounds ?? '?'}` : null),
}
