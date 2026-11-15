import { lazy, type ComponentType } from 'react'
import type { BaseGameState, GameDefinition, GamePlayProps, GameSummaryProps } from '../types'
import { MenteurOptions } from './Options'
import { MTR_DEFAULT_OPTIONS, prepareMenteurStart } from './rules'
import type { MtrState } from './types'

const Play = lazy(() => import('./Play')) as ComponentType<GamePlayProps>
const Summary = lazy(() => import('./Summary')) as ComponentType<GameSummaryProps>

export const definition: GameDefinition = {
  id: 'menteur',
  order: 90,
  name: 'Menteur',
  tagline: 'Secoue ton gobelet, annonce ce que personne ne voit… et ose crier « Menteur ! »',
  emoji: '🎲',
  color: '#8B5CF6',
  minPlayers: 2,
  maxPlayers: 9,
  rules:
    'Chacun cache 5 dés sous son gobelet. À ton tour, monte l’enchère (« 4 dés de 5 » sur toute la table, les 1 sont des jokers) ou crie « Menteur ! » : on soulève tout. Celui qui s’est trompé perd un dé. Le dernier à avoir des dés gagne.',
  Play,
  Options: MenteurOptions,
  Summary,
  defaultOptions: { ...MTR_DEFAULT_OPTIONS },
  prepareStart: (options) => prepareMenteurStart(options),
  roundLabel: (s: BaseGameState) => {
    const m = s as unknown as Partial<MtrState>
    if ((m.phase !== 'bidding' && m.phase !== 'reveal') || !m.round) return null
    return `Manche ${m.round} · ${m.total_dice ?? 0} dés`
  },
}
