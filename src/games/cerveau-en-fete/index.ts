import { lazy, type ComponentType } from 'react'
import type { BaseGameState, GameDefinition, GamePlayProps, GameSummaryProps } from '../types'
import { CerveauOptions } from './Options'
import { CEF_DEFAULT_OPTIONS, prepareCerveauStart } from './setup'

const Play = lazy(() => import('./Play')) as ComponentType<GamePlayProps>
const Summary = lazy(() => import('./Summary')) as ComponentType<GameSummaryProps>

export const definition: GameDefinition = {
  id: 'cerveau-en-fete',
  order: 40,
  name: 'Cerveau en fête',
  tagline: 'Le quiz express : tape la réponse avant les autres !',
  emoji: '🧠',
  color: '#4CC9F0',
  minPlayers: 2,
  maxPlayers: 9,
  rules:
    'Une question, un chrono : tape ta réponse (autant d’essais que tu veux, les petites fautes passent) ou choisis-la en QCM (un seul essai). Plus tu es rapide, plus tu marques, +20 pour le premier !',
  Play,
  Options: CerveauOptions,
  Summary,
  defaultOptions: { ...CEF_DEFAULT_OPTIONS },
  prepareStart: (options) => prepareCerveauStart(options),
  roundLabel: (s: BaseGameState) => (s.round ? `Question ${s.round}/${s.total_rounds ?? '?'}` : null),
}
