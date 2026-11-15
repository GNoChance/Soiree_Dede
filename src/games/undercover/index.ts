import { lazy, type ComponentType } from 'react'
import type { BaseGameState, GameDefinition, GamePlayProps, GameSummaryProps } from '../types'
import { UndercoverOptions } from './Options'
import { UC_DEFAULT_OPTIONS, prepareUndercoverStart } from './setup'

const Play = lazy(() => import('./Play')) as ComponentType<GamePlayProps>
const Summary = lazy(() => import('./Summary')) as ComponentType<GameSummaryProps>

export const definition: GameDefinition = {
  id: 'undercover',
  order: 20,
  name: 'Undercover',
  tagline: 'Un mot presque pareil se cache parmi vous… Démasquez l’infiltré sans vous trahir !',
  emoji: '🕵️',
  color: '#8B5CF6',
  minPlayers: 3,
  maxPlayers: 9,
  rules: 'Chacun reçoit un mot secret, mais l’infiltré a un mot voisin. Décrivez le vôtre à l’oral en un mot, puis votez pour éliminer le suspect.',
  Play,
  Options: UndercoverOptions,
  Summary,
  defaultOptions: UC_DEFAULT_OPTIONS,
  prepareStart: (options) => prepareUndercoverStart(options),
  roundLabel: (s: BaseGameState) => (s.round ? `Manche ${s.round}` : null),
}
