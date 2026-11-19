import { lazy, type ComponentType } from 'react'
import type { BaseGameState, GameDefinition, GamePlayProps, GameSummaryProps } from '../types'
import { MG_DEFAULT_OPTIONS, MiniGolfOptions, normalizeOptions } from './Options'
import type { MiniGolfState } from './types'

// Play charge lui-même la scène 3D (three + cannon-es) en différé.
const Play = lazy(() => import('./Play')) as ComponentType<GamePlayProps>
const Summary = lazy(() => import('./Summary')) as ComponentType<GameSummaryProps>

export const definition: GameDefinition = {
  id: 'mini-golf',
  order: 240,
  name: 'Mini-golf',
  tagline: 'Tous sur le même trou, chacun sa balle : tire, lâche… et plouf !',
  emoji: '⛳',
  color: '#7AE582',
  minPlayers: 2,
  maxPlayers: 9,
  rules:
    'Tout le monde joue le même trou en même temps, chacun sur son téléphone. Pose le doigt n’importe où, tire en arrière comme un lance-pierre et lâche : plus tu tires, plus ça part fort. 6 coups maximum par trou (sinon 7 inscrits), balle à l’eau = 1 coup de pénalité. Le plus petit total gagne !',
  Play,
  tv: true,
  Options: MiniGolfOptions,
  Summary,
  defaultOptions: { ...MG_DEFAULT_OPTIONS },
  prepareStart: async (options) => normalizeOptions(options),
  roundLabel: (s: BaseGameState) => {
    const g = s as unknown as MiniGolfState
    return g.holes?.length && g.phase !== 'finished' ? `Trou ${g.hole + 1}/${g.holes.length}` : null
  },
}
