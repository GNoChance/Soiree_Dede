import { lazy, type ComponentType } from 'react'
import type { BaseGameState, GameDefinition, GamePlayProps, GameSummaryProps } from '../types'
import { ActionVeriteOptions } from './Options'
import { AOV_DEFAULT_OPTIONS, prepareActionVeriteStart } from './setup'

const Play = lazy(() => import('./Play')) as ComponentType<GamePlayProps>
const Summary = lazy(() => import('./Summary')) as ComponentType<GameSummaryProps>

export const definition: GameDefinition = {
  id: 'action-ou-verite',
  order: 140,
  name: 'Action ou vérité',
  tagline: 'La roue choisit la victime, la bande choisit son destin. Courage… ou gage !',
  emoji: '🎭',
  color: '#FF8FA3',
  minPlayers: 3,
  maxPlayers: 9,
  rules:
    'La roue désigne un joueur : il choisit ACTION ou VÉRITÉ. Les autres votent en secret pour l’une des 3 cartes proposées. Réussi (majorité de 👍) = +1 point ; refuser = un gage !',
  Play,
  Options: ActionVeriteOptions,
  Summary,
  defaultOptions: { ...AOV_DEFAULT_OPTIONS },
  prepareStart: (options) => prepareActionVeriteStart(options),
  roundLabel: (s: BaseGameState) => (s.round ? (s.total_rounds ? `Tour ${s.round}/${s.total_rounds}` : `Tour ${s.round}`) : null),
}
