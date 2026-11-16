import { lazy, type ComponentType } from 'react'
import type { BaseGameState, GameDefinition, GamePlayProps, GameSummaryProps } from '../types'
import { BowlingOptions, BW_DEFAULT_OPTIONS, normalizeOptions } from './Options'

// Play charge lui-même la scène 3D (three + cannon-es) en différé.
const Play = lazy(() => import('./Play')) as ComponentType<GamePlayProps>
const Summary = lazy(() => import('./Summary')) as ComponentType<GameSummaryProps>

export const definition: GameDefinition = {
  id: 'bowling',
  order: 100,
  name: 'Bowling',
  tagline: 'Chacun sa piste, tous en même temps : glisse, vise, STRIKE !',
  emoji: '🎳',
  color: '#4CC9F0',
  minPlayers: 2,
  maxPlayers: 9,
  rules:
    'Chacun joue sa partie sur son téléphone, en même temps. Glisse vers le haut pour lancer (plus vite = plus fort, une courbe = de l’effet), glisse la boule sur le côté pour te placer. Règles officielles : strike, spare, bonus à la dernière frame.',
  Play,
  Options: BowlingOptions,
  Summary,
  defaultOptions: { ...BW_DEFAULT_OPTIONS },
  prepareStart: async (options) => normalizeOptions(options),
  roundLabel: (s: BaseGameState) => {
    const frames = (s as unknown as { frames?: number }).frames
    return frames ? `${frames} frames` : null
  },
}
