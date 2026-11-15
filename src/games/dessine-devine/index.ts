import { lazy, type ComponentType } from 'react'
import type { BaseGameState, GameDefinition, GamePlayProps, GameSummaryProps } from '../types'
import { DessineOptions } from './Options'
import { DD_DEFAULT_OPTIONS, prepareDessineStart } from './setup'
import type { DrawState } from './types'

const Play = lazy(() => import('./Play')) as ComponentType<GamePlayProps>
const Summary = lazy(() => import('./Summary')) as ComponentType<GameSummaryProps>

export const definition: GameDefinition = {
  id: 'dessine-devine',
  order: 60,
  name: 'Dessine & devine',
  tagline: 'Un crayon, un mot secret, et des amis qui tapent n’importe quoi. Qui reconnaîtra ton chef-d’œuvre ?',
  emoji: '✏️',
  color: '#06D6A0',
  minPlayers: 3,
  maxPlayers: 9,
  rules: 'À tour de rôle, un joueur choisit un mot secret et le dessine sur son téléphone. Les autres tapent leurs propositions : plus tu trouves vite, plus tu marques. Le dessinateur gagne des points pour chaque joueur qui trouve.',
  Play,
  Options: DessineOptions,
  Summary,
  defaultOptions: { ...DD_DEFAULT_OPTIONS },
  prepareStart: (options, ctx) => prepareDessineStart(options, ctx.playerIds.length),
  roundLabel: (s: BaseGameState) => {
    const d = s as unknown as DrawState
    return d.turn && d.total_turns ? `Dessin ${d.turn}/${d.total_turns}` : null
  },
}
