import { lazy, type ComponentType } from 'react'
import type { BaseGameState, GameDefinition, GamePlayProps, GameSummaryProps } from '../types'
import { QuiDeNousOptions } from './Options'
import { QDN_DEFAULT_OPTIONS, prepareQuiDeNousStart } from './setup'

const Play = lazy(() => import('./Play')) as ComponentType<GamePlayProps>
const Summary = lazy(() => import('./Summary')) as ComponentType<GameSummaryProps>

export const definition: GameDefinition = {
  id: 'qui-de-nous',
  order: 10,
  name: 'Qui de nous ?',
  tagline: 'Qui finirait les restes du frigo à 3 h du mat’ ? Votez, et visez la majorité !',
  emoji: '🫵',
  color: '#FF8FA3',
  minPlayers: 3,
  maxPlayers: 9,
  rules: 'Une question s’affiche : chacun désigne en secret le joueur qui y correspond le mieux. 1 point si tu votes comme la majorité !',
  Play,
  tv: true,
  Options: QuiDeNousOptions,
  Summary,
  defaultOptions: QDN_DEFAULT_OPTIONS,
  prepareStart: (options) => prepareQuiDeNousStart(options),
  roundLabel: (s: BaseGameState) => (s.round ? `Question ${s.round}/${s.total_rounds ?? '?'}` : null),
}
