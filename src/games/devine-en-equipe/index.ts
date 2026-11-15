import { lazy, type ComponentType } from 'react'
import type { BaseGameState, GameDefinition, GamePlayProps, GameSummaryProps } from '../types'
import { TeamOptions } from './Options'
import { ROUND_RULES, TEAM_DEFAULT_OPTIONS, prepareTeamStart } from './setup'
import type { TeamState } from './types'

const Play = lazy(() => import('./Play')) as ComponentType<GamePlayProps>
const Summary = lazy(() => import('./Summary')) as ComponentType<GameSummaryProps>

export const definition: GameDefinition = {
  id: 'devine-en-equipe',
  order: 150,
  name: 'Devine en équipe',
  tagline: 'Rouges contre Bleus : décris, résume en un mot, puis mime. Les mêmes mots, trois fois plus de fous rires.',
  emoji: '🗣️',
  color: '#FF8FA3',
  minPlayers: 4,
  maxPlayers: 9,
  rules:
    'Deux équipes s’affrontent sur une pioche de mots, en 3 manches : on décrit, puis un seul mot d’indice, puis on mime. Chacun son tour, l’orateur a quelques secondes pour faire deviner un max de mots à son équipe… pendant que les adversaires surveillent la triche !',
  Play,
  Options: TeamOptions,
  Summary,
  defaultOptions: { ...TEAM_DEFAULT_OPTIONS },
  prepareStart: (options, ctx) => prepareTeamStart(options, ctx.playerIds),
  roundLabel: (s: BaseGameState) => {
    const t = s as unknown as TeamState
    const r = ROUND_RULES[t.round]
    return r ? `Manche ${t.round}/3 · ${r.name}` : null
  },
}
