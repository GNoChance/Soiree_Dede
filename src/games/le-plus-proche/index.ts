import { lazy, type ComponentType } from 'react'
import type { BaseGameState, GameDefinition, GamePlayProps, GameSummaryProps } from '../types'
import { LppOptionsPanel } from './Options'
import { LPP_DEFAULT_OPTIONS, prepareLppStart } from './setup'

const Play = lazy(() => import('./Play')) as ComponentType<GamePlayProps>
const Summary = lazy(() => import('./Summary')) as ComponentType<GameSummaryProps>

export const definition: GameDefinition = {
  id: 'le-plus-proche',
  order: 130,
  name: 'Le plus proche',
  tagline: 'Personne ne sait ? Tant mieux : vise juste !',
  emoji: '🎯',
  color: '#FFB570',
  minPlayers: 2,
  maxPlayers: 9,
  rules:
    'Une question, un nombre à deviner : chacun tape son estimation en secret. Le plus proche marque 3 points, le 2e 2 points, le 3e 1 point — et +5 en bonus pour une réponse pile exacte !',
  Play,
  tv: true,
  Options: LppOptionsPanel,
  Summary,
  defaultOptions: { ...LPP_DEFAULT_OPTIONS },
  prepareStart: (options) => prepareLppStart(options),
  roundLabel: (s: BaseGameState) => (s.round ? `Manche ${s.round}/${s.total_rounds ?? '?'}` : null),
}
