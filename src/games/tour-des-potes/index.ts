import { lazy, type ComponentType } from 'react'
import type { BaseGameState, GameDefinition, GamePlayProps, GameSummaryProps } from '../types'
import { TourDesPotesOptions } from './Options'
import { TDP_DEFAULT_OPTIONS, prepareTdpStart } from './rules'
import type { TdpState } from './types'

const Play = lazy(() => import('./Play')) as ComponentType<GamePlayProps>
const Summary = lazy(() => import('./Summary')) as ComponentType<GameSummaryProps>

export const definition: GameDefinition = {
  id: 'tour-des-potes',
  order: 190,
  name: 'Le Tour des Potes',
  tagline: 'Achète les coins préférés de la bande, de Bayon à Bordeaux… et encaisse les loyers !',
  emoji: '🏙️',
  color: '#10B981',
  minPlayers: 2,
  maxPlayers: 9,
  rules:
    'Lance les dés et fais le tour des villes des potes. Achète les lieux libres, réunis un quartier pour construire maisons puis hôtel, et fais payer le loyer aux autres. Gare au violon ! À la fin, la plus grosse fortune gagne.',
  Play,
  Options: TourDesPotesOptions,
  Summary,
  defaultOptions: { ...TDP_DEFAULT_OPTIONS },
  prepareStart: (options) => prepareTdpStart(options),
  roundLabel: (s: BaseGameState) => {
    const t = s as unknown as Partial<TdpState>
    if (!t.round || t.phase === 'finished' || t.phase === 'aborted') return null
    if (t.format === 'tours' && t.total_rounds) return `Tour ${Math.min(t.round, t.total_rounds)}/${t.total_rounds}`
    return `Tour ${t.round}${t.last_turn ? ' · dernier tour !' : ''}`
  },
}
